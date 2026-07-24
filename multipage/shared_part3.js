// ── Pipeline data refresh ──────────────────────────────────────────
async function refreshPipelineData(btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '↺ Refreshing…'; }
  _appsScriptCache = null;
  _appsScriptFetch = null;
  window._pipelineHistory = {};
  LIVE_PIPELINE = {};
  try {
    await Promise.all([fetchPipelineHistory(), fetchPipelinePerJob()]);
  } catch(e) { console.error('[Refresh] failed:', e); }
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = '↺ Refresh'; }
  if (currentRecruiter) try { renderRecruiterView(currentRecruiter); } catch(e) {}
}

// ── Tab navigation ─────────────────────────────────────────────────
function initTabNav() {
  const nav = document.getElementById('tabNav');
  nav.innerHTML =
    `<a href="../" class="tab-btn" style="text-decoration:none">← All Teams</a>` +
    `<div class="tab-sep"></div>` +
    `<button class="tab-btn active" onclick="switchTab('team',this)">Team Overview</button>` +
    `<div class="tab-sep"></div>` +
    RECRUITERS.map((r, i) => `<button class="tab-btn" onclick="switchTab(${i},this)">${r.name}</button>`).join('');
}

function switchTab(nameOrIdx, el) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const teamView = document.getElementById('teamView');
  const recView  = document.getElementById('recruiterView');
  if (nameOrIdx === 'team') {
    teamView.style.display = 'block';
    recView.style.display  = 'none';
  } else {
    teamView.style.display = 'none';
    recView.style.display  = 'block';
    currentRecruiter = RECRUITERS[nameOrIdx];
    try { renderRecruiterView(currentRecruiter); } catch(e) { console.error('renderRecruiterView:', e); document.getElementById('recruiterContent').innerHTML = `<div class="container" style="padding:32px;color:var(--red)">Error rendering tab: ${e.message}</div>`; }
  }
}

// ── Per-recruiter health & projection ─────────────────────────────
function recruiterHealth(r) {
  // Use projected total (accepted + pipeline) for goal score — reflects where they'll end up
  const projected = recruiterProjected(r);
  const goalScore = Math.min(50, 50 * Math.min(1, projected / r.goal));
  const oarScore  = Math.min(30, 30 * (r.oar / 95));
  const pipeScore = 20;
  return Math.round(goalScore + oarScore + pipeScore);
}
// ── Global PTR helpers (used by recruiterProjected + renderRecruiterView) ──
const BENCH3 = { rsToIR: 0.18, irToHC: 0.50, hcToOff: 0.85 };

function reqPT(req) {
  const h = (window._pipelineHistory || {})[req.reqId] || {};
  const rsToIR  = (h.rsToIR  != null && h.rs  >= 5 && h.ir  >= 1) ? h.rsToIR  : BENCH3.rsToIR;
  const irToHC  = (h.irToHC  != null && h.ir  >= 2 && h.hc  >= 1) ? h.irToHC  : BENCH3.irToHC;
  const hcToOff = (h.hcToOff != null && h.hc  >= 1 && h.offer >= 1) ? h.hcToOff : BENCH3.hcToOff;
  return {
    rsToIR, irToHC, hcToOff,
    rsToOff: rsToIR * irToHC * hcToOff,
    src: {
      rsToIR:  (h.rsToIR  != null && h.rs  >= 5 && h.ir  >= 1) ? 'hist' : 'bench',
      irToHC:  (h.irToHC  != null && h.ir  >= 2 && h.hc  >= 1) ? 'hist' : 'bench',
      hcToOff: (h.hcToOff != null && h.hc  >= 1 && h.offer >= 1) ? 'hist' : 'bench',
    }
  };
}

function projectedOffersFromPipe(req) {
  const pt = reqPT(req);
  return (
    ((req.rs||0) + (req.ia||0)) * pt.rsToIR * pt.irToHC * pt.hcToOff +
    (req.ir    || 0) * pt.irToHC * pt.hcToOff +
    (req.hc    || 0) * pt.hcToOff +
    (req.offer || 0)
  );
}

function recruiterProjected(r) {
  // If live pipeline data is loaded, use funnel-based projection (candidates × PTRs)
  // This matches what the pipeline per req section shows and is more accurate.
  const liveReqs = LIVE_PIPELINE[r.name];
  if (liveReqs && liveReqs.length > 0) {
    const pipeTotal = liveReqs.reduce((s, req) => s + projectedOffersFromPipe(req), 0);
    return parseFloat((r.accepted + pipeTotal).toFixed(1));
  }
  // Fallback: pace-based extrapolation when pipeline data isn't loaded yet
  if (daysElapsed <= 0) return r.accepted;
  const monthlyPace = r.accepted / (daysElapsed / 30);
  return r.accepted + Math.round(monthlyPace * monthsLeft);
}

// ── Predictive analysis action items ──────────────────────────────
// Pipeline History columns (updated):
//   Application Review → Recruiter Screen → Interview Round → Hiring Committee → Offer
// Live pipeline stages: RS, IA, IR, HC, Offer
//   RS+IA → use rsToIR rate (both in pre-interview screening)
//   IR    → use irToHC * hcToOff
//   HC    → use hcToOff
//   Offer → count as projected offer (multiply by OAR for acceptance)
function buildPredictiveInsight(r, liveReqs) {
  const needed = Math.max(0, r.goal - r.accepted);
  // Bench PTRs (fallbacks only when no historical data)
  const B = { rsToIR: 0.18, irToHC: 0.50, hcToOff: 0.85 };
  // Bench RS→Offer = 0.18 * 0.50 * 0.85 ≈ 7.65% → ~13 RS per offer

  if (needed === 0) {
    return `<div class="pred-item"><span class="pred-icon">🎉</span><div class="pred-text"><strong>Goal achieved!</strong> ${r.accepted}/${r.goal} hires confirmed — focus on smooth onboarding for pending starts.</div></div>`;
  }

  const reqs    = liveReqs || [];
  const hist    = window._pipelineHistory || {};
  const hasHist = Object.keys(hist).length > 0;
  const oar     = r.oar ? r.oar / 100 : 0.90;

  // ── Step 1: Fleet rate from reqs that have actually produced offers ──
  // Only reqs with offer ≥ 1 AND rs ≥ 5 have meaningful RS→Offer data.
  // Using offer/rs directly avoids compounding errors across 3 multiplied rates.
  const offerReqs = reqs.filter(q => (hist[q.reqId]?.offer || 0) >= 1 && (hist[q.reqId]?.rs || 0) >= 5);
  const fleetRS   = offerReqs.reduce((s, q) => s + hist[q.reqId].rs,    0);
  const fleetOff  = offerReqs.reduce((s, q) => s + hist[q.reqId].offer, 0);
  // Fleet RS→Offer rate (e.g. 33 offers from 520 RS = 6.3%)
  const fleetRsToOff  = fleetRS > 0 && fleetOff > 0 ? fleetOff / fleetRS : B.rsToIR * B.irToHC * B.hcToOff;
  const rsPerOffer    = fleetRsToOff > 0 ? Math.round(1 / fleetRsToOff) : 14; // e.g. ~16 RS per offer
  // Fleet IR→HC and HC→Offer for mid/late-stage projections
  const fleetHistIR   = offerReqs.reduce((s, q) => s + hist[q.reqId].ir,    0);
  const fleetHistHC   = offerReqs.reduce((s, q) => s + hist[q.reqId].hc,    0);
  const fleetIrToHC   = fleetHistIR  > 0 ? fleetHistHC  / fleetHistIR  : B.irToHC;
  const fleetHcToOff  = fleetHistHC  > 0 ? fleetOff     / fleetHistHC  : B.hcToOff;

  // ── Step 2: Per-req projection using historical rates where available ──
  let totalProjOffers = 0;
  const reqBreakdowns = [];

  for (const req of reqs) {
    const h = hist[req.reqId] || {};

    // RS→Offer: use req's direct historical rate if it has produced offers; else fleet avg
    const reqRsToOff = (h.offer >= 1 && h.rs >= 5) ? h.rsToOff : fleetRsToOff;
    // IR→HC: use req's rate if ≥2 IR; else fleet
    const irToHC  = (h.irToHC  != null && h.ir >= 2) ? h.irToHC  : fleetIrToHC;
    // HC→Offer: use req's rate if ≥1 HC and ≥1 offer (avoid 0% from reqs with no offers yet)
    const hcToOff = (h.hcToOff != null && h.hc >= 1 && h.offer >= 1) ? h.hcToOff : fleetHcToOff;

    const rs  = req.rs    || 0;
    const ia  = req.ia    || 0;
    const ir  = req.ir    || 0;
    const hc  = req.hc    || 0;
    const off = req.offer || 0;

    const proj = off * oar
               + hc  * hcToOff
               + ir  * irToHC * hcToOff
               + (rs + ia) * reqRsToOff;
    totalProjOffers += proj;

    const hasData = (h.offer >= 1 && h.rs >= 5);
    reqBreakdowns.push({
      name: req.name, reqId: req.reqId, proj,
      reqRsToOff, irToHC, hcToOff, hasData, h,
      rs, ia, ir, hc, off
    });
  }

  const pipeGap   = Math.max(0, needed - totalProjOffers);
  const addlRS    = Math.ceil(pipeGap * rsPerOffer);
  const totalRS   = Math.ceil(needed * rsPerOffer); // total RS to hit goal from scratch
  const dataLabel = offerReqs.length > 0
    ? `~${rsPerOffer} RS per offer (${fleetOff} offers from ${fleetRS} RS across ${offerReqs.length} req${offerReqs.length !== 1 ? 's' : ''})`
    : `~${rsPerOffer} RS per offer (benchmark)`;

  const items = [];

  // 1 — Sourcing gap
  if (pipeGap > 0.3) {
    items.push({ icon: '🎯', badge: 'HIGH PRIORITY', badgeCls: 'pred-badge-high',
      text: `<strong>Source ~${addlRS} more Recruiter Screen${addlRS !== 1 ? 's' : ''} to close the gap</strong> — current pipeline projects <strong>${totalProjOffers.toFixed(1)}</strong> more offers vs. <strong>${needed}</strong> needed. <span style="color:var(--text2)">${dataLabel}.</span>` });
  } else {
    items.push({ icon: '✅', badge: 'ON TRACK', badgeCls: 'pred-badge-ok',
      text: `<strong>Pipeline projects ${totalProjOffers.toFixed(1)} more offers</strong> — covers the ${needed}-hire gap. Focus on protecting late-stage quality. <span style="color:var(--text2)">${dataLabel}.</span>` });
  }

  // 2 — RS needed to hit full goal (context item)
  if (needed > 0 && rsPerOffer > 0) {
    items.push({ icon: '📊', badge: 'CONTEXT', badgeCls: 'pred-badge-action',
      text: `<strong>${rsPerOffer} RS needed per offer</strong> based on your req mix — to make ${needed} more hire${needed !== 1 ? 's' : ''} entirely from new RS, you'd need ~${totalRS} more screens. Late-stage candidates (HC/IR) reduce that need significantly.` });
  }

  // 3 — Weakest IR→HC per req with live IR candidates
  const weakIrToHC = reqBreakdowns
    .filter(q => q.hasData && q.h.ir >= 3 && q.irToHC < fleetIrToHC * 0.65 && (q.ir + q.hc) > 0)
    .sort((a, b) => a.irToHC - b.irToHC)[0];
  if (weakIrToHC) {
    items.push({ icon: '📉', badge: 'CONVERT', badgeCls: 'pred-badge-warn',
      text: `<strong>${weakIrToHC.name}: ${Math.round(weakIrToHC.irToHC*100)}% IR→HC</strong> — below your ${Math.round(fleetIrToHC*100)}% fleet avg. ${weakIrToHC.ir} mid-funnel candidates stalling. Audit debrief speed and panel availability.` });
  }

  // 4 — Weakest HC→Offer per req with live HC candidates
  const weakHcToOff = reqBreakdowns
    .filter(q => q.hasData && q.h.hc >= 2 && q.hcToOff < fleetHcToOff * 0.70 && q.hc > 0)
    .sort((a, b) => a.hcToOff - b.hcToOff)[0];
  if (weakHcToOff) {
    items.push({ icon: '💰', badge: 'COMP RISK', badgeCls: 'pred-badge-warn',
      text: `<strong>${weakHcToOff.name}: ${Math.round(weakHcToOff.hcToOff*100)}% HC→Offer</strong> — below ${Math.round(fleetHcToOff*100)}% fleet avg. ${weakHcToOff.hc} HC candidate${weakHcToOff.hc !== 1 ? 's' : ''} at risk. Validate comp band with HM before panel debrief.` });
  }

  // 5 — Quick win: HC candidates
  const totHC = reqs.reduce((s, q) => s + (q.hc || 0), 0);
  if (totHC > 0) {
    items.push({ icon: '⚡', badge: 'QUICK WIN', badgeCls: 'pred-badge-action',
      text: `<strong>Push ${totHC} HC-stage candidate${totHC !== 1 ? 's' : ''} to offer</strong> — highest-probability close. Prep comp approvals and offer letters now.` });
  }

  // 6 — Advance IR candidates
  const totIR = reqs.reduce((s, q) => s + (q.ir || 0), 0);
  if (totIR >= 2) {
    items.push({ icon: '→', badge: 'ACTION', badgeCls: 'pred-badge-action',
      text: `<strong>Advance ${totIR} IR candidate${totIR !== 1 ? 's' : ''} to HC</strong> — schedule debriefs and panels this week.` });
  }

  // 7 — OAR risk
  if (r.oar < 75 && r.extended > 0) {
    const lost = r.extended - r.accepted;
    items.push({ icon: '⚠️', badge: 'RISK', badgeCls: 'pred-badge-high',
      text: `<strong>Fix ${r.oar}% OAR</strong> — ${lost} offer${lost !== 1 ? 's' : ''} declined. Validate comp with HM before next offer.` });
  }

  // 8 — Deadline
  if (daysRemaining <= 50 && needed > 0) {
    items.push({ icon: '📅', badge: 'DEADLINE', badgeCls: 'pred-badge-warn',
      text: `<strong>${daysRemaining} days left in Q1</strong> — factor 2–3 week offer-to-start lag. RS started this week won't convert before mid-July without fast-tracking.` });
  }

  return items.map(it => `
    <div class="pred-item">
      <span class="pred-icon">${it.icon}</span>
      <div class="pred-text">${it.text}</div>
      <span class="pred-badge ${it.badgeCls}">${it.badge}</span>
    </div>`).join('');
}

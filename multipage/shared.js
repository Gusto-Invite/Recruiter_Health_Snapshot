// ── Recruiter view renderer ────────────────────────────────────────
function renderRecruiterView(r) {
  currentRecruiter = r;
  const health    = recruiterHealth(r);
  const hColor    = healthColor(health);
  const hLabel    = healthLabel(health);
  const projected = recruiterProjected(r);
  const gap       = Math.max(0, r.goal - projected);
  const pct       = Math.round(r.accepted / r.goal * 100);
  const barColor  = pct >= 80 ? '#00B094' : pct >= 50 ? '#F5A623' : '#F45D48';
  const projColor = projected >= r.goal ? '#00B094' : projected >= r.goal * 0.75 ? '#F5A623' : '#F45D48';

  // OAR by level
  let oarHtml = '';
  const levels = Object.keys(r.oarByLevel);
  if (levels.length === 0) {
    oarHtml = `<div style="color:var(--text2);font-size:12px;padding:8px 0;font-style:italic">No offer data in Q1 yet</div>`;
  } else {
    levels.forEach(lvl => {
      const d = r.oarByLevel[lvl];
      const col = d.oar >= 85 ? '#00B094' : d.oar >= 75 ? '#F5A623' : '#F45D48';
      const rej = d.ext - d.acc;
      oarHtml += `
        <div class="oar-item">
          <div class="oar-item-label">${lvl}</div>
          <div class="oar-item-bar-wrap"><div class="oar-item-bar" style="width:${d.oar}%;background:${col}">${d.oar}%</div></div>
          <div class="oar-item-val" style="color:${col}">${d.oar}%</div>
          <div style="font-size:10px;color:var(--text2);white-space:nowrap;flex-shrink:0;width:80px;text-align:right">${d.acc}/${d.ext} <span style="color:#F45D48">(−${rej})</span></div>
        </div>`;
    });
  }

  // Decline reasons
  let declHtml = '';
  if (r.declines.length === 0) {
    declHtml = `<div style="padding:20px 0;text-align:center;color:var(--green);font-size:12px;font-weight:600">✓ No Q1 declines</div>`;
  } else {
    const maxD = r.declines[0][1];
    const reasonColors = {'Cash Compensation':'#F45D48','Equity Compensation':'#e67e22','Role Misalignment':'#9b59b6','Timeline Misalignment':'#00B094',"Gusto's Product/Industry":'#F5A623'};
    r.declines.forEach(([reason, count]) => {
      const barW = Math.round(count / maxD * 100);
      const col = reasonColors[reason] || '#4a5568';
      declHtml += `
        <div class="decline-bar-row">
          <div class="decline-label">${reason}</div>
          <div class="decline-bar-wrap"><div class="decline-bar" style="width:${barW}%;background:${col}">${count}</div></div>
          <div class="decline-count" style="color:${col}">${count}</div>
        </div>`;
    });
  }

  function fmtPct(v, src) {
    const s = src === 'hist' ? '' : '<span style="color:var(--text2);font-style:italic">*</span>';
    return `${Math.round(v*100)}%${s}`;
  }

  const hiresNeeded  = Math.max(0, r.goal - r.accepted);
  const liveReqs     = LIVE_PIPELINE[r.name];
  const isLive       = liveReqs && liveReqs.length > 0;

  const pipeOnlyTotal = (liveReqs || r.reqs).reduce((s, req) => s + projectedOffersFromPipe(req), 0);
  const totalProjAll  = pipeOnlyTotal; // pipeline-only (no accepted) — used for gap/insight calcs
  const remainingGap  = Math.max(0, hiresNeeded - totalProjAll);

  const STAGE_COLORS = {
    rs:    { bg: 'rgba(244,93,72,0.12)',   text: '#D03A28',  label: 'RS' },
    ia:    { bg: 'rgba(107,94,248,0.12)',  text: '#5548D9',  label: 'IA' },
    ir:    { bg: 'rgba(245,166,35,0.15)',  text: '#C47A0A',  label: 'IR' },
    hc:    { bg: 'rgba(0,176,148,0.12)',   text: '#00876E',  label: 'HC' },
    offer: { bg: 'rgba(244,93,72,0.18)',   text: '#D03A28',  label: 'Offer' },
  };

  const reqRows = isLive
    ? liveReqs.map((req, qi) => {
        const pt           = reqPT(req);
        const rsPO         = 1 / Math.max(0.001, pt.rsToOff);
        const proj         = projectedOffersFromPipe(req);
        const insightId    = `ins_${r.name.replace(/\W/g,'')}_${qi}`;
        const allHist      = Object.values(pt.src).every(s => s === 'hist');
        const addlRSNeeded = proj >= 1 ? 0 : Math.ceil((1 - proj) * rsPO);
        const projColor    = proj >= 0.85 ? 'var(--green)' : proj >= 0.4 ? 'var(--yellow)' : 'var(--red)';
        const projBg       = proj >= 0.85 ? 'rgba(0,176,148,0.1)' : proj >= 0.4 ? 'rgba(245,166,35,0.12)' : 'rgba(208,58,40,0.1)';

        const stagesHtml = Object.entries(STAGE_COLORS).map(([key, sc], i) => {
          const val = req[key] || 0;
          const arrow = i < 4 ? `<span class="req-stage-arrow">→</span>` : '';
          return `
            <div class="req-stage-badge">
              <div class="req-stage-label">${sc.label}</div>
              <div class="req-stage-val" style="background:${val > 0 ? sc.bg : 'rgba(0,0,0,0.04)'};color:${val > 0 ? sc.text : 'var(--text2)'}">
                ${val > 0 ? val : '—'}
              </div>
            </div>
            ${arrow}`;
        }).join('');

        return `
        <div class="req-pill" onclick="toggleInsight('${insightId}')">
          <div class="req-pill-row">
            <div style="flex:1;min-width:0">
              <div class="req-pill-name"><span style="color:var(--text2);font-weight:500;margin-right:6px;font-size:11px">${qi + 1}.</span>${req.name}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                <span class="req-pill-id">${req.reqId || ''}</span>
                ${req.ghJobId ? `<a href="https://gusto.greenhouse.io/sdash/${req.ghJobId}" target="_blank" class="req-gh-link" onclick="event.stopPropagation()">↗ GH</a>` : ''}
              </div>
            </div>
            <div class="req-pill-stages">${stagesHtml}</div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;margin-left:10px">
              <div class="req-proj-badge" style="background:${projBg};color:${projColor}">~${proj.toFixed(1)} proj.</div>
              <button class="req-insight-btn" onclick="event.stopPropagation();toggleInsight('${insightId}')">Insights ▶</button>
            </div>
          </div>
          <div id="${insightId}" class="req-pill-insight">
            <div style="font-size:10px;font-weight:700;color:var(--purple);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">
              Pipeline Insight <span style="font-weight:400;text-transform:none;color:${allHist?'var(--green)':'var(--text2)'}"> · ${allHist?'rates from history':'some benchmarks*'}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <div style="font-size:10px;color:var(--text2);margin-bottom:3px">RS to generate 1 offer</div>
                <div style="font-size:13px;font-weight:700;color:var(--text)">~${Math.ceil(rsPO)} screens</div>
                <div style="font-size:10px;color:var(--text2);margin-top:5px;line-height:1.6">
                  RS→IR <strong>${fmtPct(pt.rsToIR,pt.src.rsToIR)}</strong> · IR→HC <strong>${fmtPct(pt.irToHC,pt.src.irToHC)}</strong> · HC→Offer <strong>${fmtPct(pt.hcToOff,pt.src.hcToOff)}</strong>
                </div>
                <div style="font-size:10px;color:var(--text2);margin-top:5px">
                  ${proj >= 1 ? `<span style="color:var(--green)">✓ Pipeline projects ≥1 offer already</span>`
                    : addlRSNeeded > 0 ? `Need <strong style="color:var(--accent)">${addlRSNeeded} more RS</strong> to project 1 offer`
                    : `~${proj.toFixed(2)} projected — nearly there`}
                </div>
                ${!allHist ? `<div style="font-size:10px;color:var(--text2);font-style:italic;margin-top:3px">* using benchmark rate (insufficient history)</div>` : ''}
              </div>
              <div>
                <div style="font-size:10px;color:var(--text2);margin-bottom:3px">Recruiter gap</div>
                <div style="font-size:11px;color:var(--text);line-height:1.6">
                  ${remainingGap > 0
                    ? `Needs <strong>${hiresNeeded}</strong> more · All reqs project <strong>${totalProjAll.toFixed(1)}</strong> · <span style="color:var(--red)">~${remainingGap.toFixed(1)} short</span><br>→ <strong style="color:var(--accent)">~${Math.ceil(remainingGap * rsPO)} more RS</strong> needed to close`
                    : `<span style="color:var(--green)">✓ Pipeline on track to meet goal</span>`}
                </div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('')
    : (r.reqs.length > 0
        ? r.reqs.map((req, i) => `
            <tr>
              <td><input class="req-name-input" value="${(req.name||'').replace(/"/g,'&quot;')}" placeholder="Req name" onchange="updateReqData(${i},'name',this.value)"></td>
              <td><input class="req-input" type="number" min="0" value="${req.rs||''}"    placeholder="–" onchange="updateReqData(${i},'rs',this.value)"></td>
              <td><input class="req-input" type="number" min="0" value="${req.ia||''}"    placeholder="–" onchange="updateReqData(${i},'ia',this.value)"></td>
              <td><input class="req-input" type="number" min="0" value="${req.ir||''}"    placeholder="–" onchange="updateReqData(${i},'ir',this.value)"></td>
              <td><input class="req-input" type="number" min="0" value="${req.hc||''}"    placeholder="–" onchange="updateReqData(${i},'hc',this.value)"></td>
              <td><input class="req-input" type="number" min="0" value="${req.offer||''}" placeholder="–" onchange="updateReqData(${i},'offer',this.value)"></td>
              <td><button onclick="removeReq(${i})" style="border:none;background:none;color:var(--text2);cursor:pointer;font-size:16px;line-height:1" title="Remove">×</button></td>
            </tr>`).join('')
        : `<tr><td colspan="7" style="color:var(--text2);font-size:11px;padding:14px 0;text-align:center;font-style:italic">No open reqs found — data loading or no active reqs assigned</td></tr>`);

  // OAR analysis note
  const oarNote = r.oar < 70
    ? `<div class="analysis-note risk"><strong>⚠ At risk:</strong> ${r.oar}% OAR — below 75% threshold. ${r.declines.map(([n,c]) => `${c} ${n.toLowerCase()} decline${c>1?'s':''}`).join(', ')}.${r.declines.length ? ' Comp is the driver.' : ''}</div>`
    : r.oar >= 90
      ? `<div class="analysis-note ok"><strong>✓ Healthy OAR:</strong> ${r.oar}% — no comp declines to address in Q1.</div>`
      : `<div class="analysis-note"><strong>Watch:</strong> ${r.oar}% OAR. Monitor for comp-driven declines as more offers go out.</div>`;

  document.getElementById('recruiterContent').innerHTML = `
    <div class="rec-header">
      <div class="rec-name">${r.name}</div>
      <div class="rec-badge" style="background:${hColor}22;color:${hColor}">${hLabel}</div>
      <div style="font-size:11px;color:var(--text2);margin-left:auto">Q1 FY27 · May–Jul 2026 · <strong>${daysRemaining}</strong>d remaining</div>
    </div>

    <div class="rec-status-card">
      <!-- Header: Health Score -->
      <div class="rec-status-header">
        <div class="rec-health-block">
          <div class="rec-health-score-big" style="color:${hColor}">${health}</div>
          <div class="rec-health-info">
            <div class="rec-health-tag">Health Score
              <button class="health-info-btn" tabindex="0" aria-label="Health score methodology">i
                <div class="health-tooltip">Weighted score (0–100):<br>
                  <strong>50pts</strong> Projected attainment (accepted + pipeline conversion ÷ goal)<br>
                  <strong>30pts</strong> OAR vs. 95% benchmark<br>
                  <strong>20pts</strong> Pipeline depth (base credit)<br>
                  <br>≥80 = On Track · 65–79 = At Risk · 50–64 = Needs Attention · &lt;50 = Critical
                </div>
              </button>
            </div>
            <div class="rec-health-desc-text" style="color:${hColor}">${hLabel}</div>
          </div>
        </div>
        <div class="rec-health-divider"></div>
        <div class="rec-health-note">
          <strong>${daysRemaining}</strong> days left in Q1 &nbsp;·&nbsp; ${pctThrough}% elapsed<br>
          Need <strong>${Math.max(0,r.goal-r.accepted)}</strong> more accepted offers by Jul 31
        </div>
        <div style="flex:1"></div>
        <canvas id="recGaugeCanvas" style="display:none"></canvas>
      </div>
      <!-- Metric blocks -->
      <div class="rec-status-metrics">
        <!-- Q1 Goal -->
        <div class="rec-metric-block" style="border-top: 3px solid ${barColor}">
          <div class="rec-metric-label">Q1 Goal</div>
          <div class="rec-metric-value" style="color:var(--text)">${r.goal}</div>
          <div class="rec-metric-sub">FTE hires by Jul 31</div>
          <div class="goal-bar-wrap" style="margin-top:6px"><div class="goal-bar" style="width:${OFFERS_LIVE_LOADED ? Math.min(100,pct) : 0}%;background:${barColor}"></div></div>
          <div class="goal-pct" style="color:${barColor};margin-top:3px">${OFFERS_LIVE_LOADED ? pct+'% confirmed' : '– pending data'}</div>
          <div class="rec-metric-note">${OFFERS_LIVE_LOADED ? `${r.accepted} accepted · ${Math.max(0,r.goal-r.accepted)} more needed` : '– accepted · loading…'}</div>
        </div>
        <!-- Accepted Offers -->
        <div class="rec-metric-block" style="border-top: 3px solid var(--green)">
          <div class="rec-metric-label">Accepted Offers</div>
          <div class="rec-metric-value" style="color:var(--green)">${OFFERS_LIVE_LOADED ? r.accepted : '–'}</div>
          <div class="rec-metric-sub">Q1 · FTE only · excl. interns</div>
          <div class="rec-metric-note">${OFFERS_LIVE_LOADED ? `${r.accepted} accepted of ${r.extended} extended` : 'Loading from Greenhouse…'}</div>
        </div>
        <!-- OAR -->
        ${OFFERS_LIVE_LOADED ? `
        <div class="rec-metric-block" style="border-top: 3px solid ${r.oar >= 90 ? 'var(--green)' : r.oar >= 75 ? 'var(--yellow)' : 'var(--red)'}">
          <div class="rec-metric-label">OAR</div>
          <div class="rec-metric-value" style="color:${r.oar >= 90 ? 'var(--green)' : r.oar >= 75 ? 'var(--yellow)' : 'var(--red)'}">${r.oar}%</div>
          <div class="rec-metric-sub">Offer Acceptance Rate</div>
          <div class="rec-metric-note">${r.accepted}/${r.extended} offers accepted</div>
          ${r.oar < 75 ? `<div class="analysis-note risk" style="margin-top:6px"><strong>⚠</strong> Below 75% threshold</div>` : r.oar >= 90 ? `<div class="analysis-note ok" style="margin-top:6px"><strong>✓</strong> Strong close rate</div>` : `<div class="analysis-note" style="margin-top:6px;font-size:10px;color:var(--yellow)">Watch — monitor for comp declines</div>`}
        </div>` : `
        <div class="rec-metric-block" style="border-top: 3px solid var(--border)">
          <div class="rec-metric-label">OAR</div>
          <div class="rec-metric-value" style="color:var(--text2)">–</div>
          <div class="rec-metric-sub">Pending live data</div>
          <div class="analysis-note" style="margin-top:6px;font-size:10px">Loading from Greenhouse…</div>
        </div>`}
        <!-- FTE Projected -->
        <div class="rec-metric-block" style="border-top: 3px solid ${OFFERS_LIVE_LOADED ? projColor : 'var(--border)'}">
          <div class="rec-metric-label">FTE Projected</div>
          <div class="rec-metric-value" style="color:${OFFERS_LIVE_LOADED ? projColor : 'var(--text2)'}">${OFFERS_LIVE_LOADED ? projected.toFixed(1) : '–'}</div>
          <div class="rec-metric-sub">${OFFERS_LIVE_LOADED ? (gap > 0 ? `<span class="kpi-badge badge-red">−${gap.toFixed(1)} vs goal</span>` : `<span class="kpi-badge badge-green">On target</span>`) : 'Pending accepted data'}</div>
          <div class="rec-metric-note">${OFFERS_LIVE_LOADED ? `${r.accepted} accepted + ${pipeOnlyTotal.toFixed(1)} pipeline · ${monthsLeft.toFixed(1)} mo left` : 'Waiting for Offers sheet…'}</div>
          ${OFFERS_LIVE_LOADED ? (projected < r.goal ? `<div class="analysis-note risk" style="margin-top:6px"><strong>⚠</strong> Need to accelerate by ${(r.goal - projected).toFixed(1)} hire${(r.goal - projected) !== 1?'s':''}</div>` : `<div class="analysis-note ok" style="margin-top:6px"><strong>✓</strong> On pace to hit goal</div>`) : ''}
        </div>
      </div>
    </div>

    <div class="pred-wrap">
      <div class="pred-note">
        <div class="pred-title">📋 What It Takes to Hit Goal <div class="pred-divider"></div></div>
        <div class="pred-items">${buildPredictiveInsight(r, liveReqs)}</div>
      </div>
    </div>

    ${(function() {
      const myAccepts = (window._acceptedOffersList || []).filter(a => a.recruiter === r.name);
      if (myAccepts.length === 0) return '';
      return `<div class="rec-section" style="margin-bottom:16px">
        <div class="rec-section-title">Accepted Offers <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--green)">· ${myAccepts.length} FTE${myAccepts.length !== 1 ? 's' : ''}</span></div>
        ${buildAcceptsTableHTML(myAccepts, false)}
      </div>`;
    })()}
    <div class="rec-mid">
      <div class="rec-section">
        <div class="rec-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>Pipeline per Req ${isLive ? `<span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--green)">· 🟢 live</span>` : `<span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text2)">· manual</span>`}</span>
          <button onclick="refreshPipelineData(this)" style="flex-shrink:0;font-size:10px;font-weight:600;color:var(--accent);background:rgba(244,93,72,0.08);border:1px solid rgba(244,93,72,0.2);border-radius:6px;padding:3px 9px;cursor:pointer;font-family:inherit;transition:all 0.15s" onmouseover="this.style.background='rgba(244,93,72,0.14)'" onmouseout="this.style.background='rgba(244,93,72,0.08)'">↺ Refresh</button>
        </div>
        <div class="req-pills">${reqRows}</div>
        ${isLive
          ? `<div style="font-size:10px;color:var(--text2);margin-top:8px">Updated ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})} · ${liveReqs.length} open req${liveReqs.length !== 1 ? 's' : ''}</div>`
          : `<button class="add-req-btn" onclick="addReqRow()">+ Add Req</button>`}
      </div>
    </div>

    <div class="rec-bottom">
      <div class="rec-section">
        <div class="rec-section-title">OAR by Level <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text2)">· Q1 actuals</span></div>
        <div class="oar-row" style="gap:10px">${oarHtml}</div>
        ${oarNote}
      </div>
      <div class="rec-section">
        <div class="rec-section-title">Offer Decline Reasons <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text2)">· Q1</span></div>
        ${declHtml}
        ${r.declines.length > 0 ? `<div class="analysis-note risk" style="margin-top:10px"><strong>⚠ Pattern:</strong> ${r.declines.length === 1 ? 'All declines are comp-driven' : 'Multiple comp-related declines'}. Work with HM/comp team to validate bands before next offer.</div>` : ''}
      </div>
      <div class="rec-section">
        <div class="rec-section-title">⚡ Recruiter Playbook</div>

        ${(() => {
          // ── Quarter Pulse ──
          const paceStatus = projected >= r.goal * 0.85 ? 'on-track'
                           : projected >= r.goal * 0.6  ? 'watch' : 'behind';
          const paceColor  = paceStatus === 'on-track' ? 'var(--green)' : paceStatus === 'watch' ? 'var(--yellow)' : 'var(--red)';
          const paceBg     = paceStatus === 'on-track' ? 'rgba(0,176,148,0.09)' : paceStatus === 'watch' ? 'rgba(245,166,35,0.09)' : 'rgba(244,93,72,0.09)';
          const paceBorder = paceStatus === 'on-track' ? 'rgba(0,176,148,0.28)' : paceStatus === 'watch' ? 'rgba(245,166,35,0.32)' : 'rgba(244,93,72,0.28)';
          const paceLabel  = paceStatus === 'on-track' ? '✓ On Pace' : paceStatus === 'watch' ? '⚠ Needs Push' : '↓ Behind';

          // ── Win Now — reqs with candidates deepest in funnel ──
          const deepReqs = (liveReqs || [])
            .filter(req => (req.hc||0) + (req.ir||0) > 0)
            .sort((a, b) => ((b.hc||0)*4 + (b.ir||0)*2 + (b.ia||0)) - ((a.hc||0)*4 + (a.ir||0)*2 + (a.ia||0)))
            .slice(0, 3);

          // ── Funnel health — recruiter avg rates vs bench ──
          const histRates = (liveReqs||[]).map(req => (window._pipelineHistory||{})[req.reqId]).filter(h => h && h.rs >= 5);
          const avgOf = (arr, key, minKey, minVal) => {
            const valid = arr.filter(h => h[minKey] >= minVal && h[key] != null);
            return valid.length > 0 ? valid.reduce((s,h) => s + h[key], 0) / valid.length : null;
          };
          const avgRsIR  = avgOf(histRates, 'rsToIR',  'rs', 5);
          const avgIrHC  = avgOf(histRates, 'irToHC',  'ir', 2);
          const avgHcOff = avgOf(histRates, 'hcToOff', 'hc', 1);
          const stageComps = [
            { label:'RS→IR',   val:avgRsIR,  bench:0.18, icon:'🔍' },
            { label:'IR→HC',   val:avgIrHC,  bench:0.50, icon:'🤝' },
            { label:'HC→Off',  val:avgHcOff, bench:0.85, icon:'📝' },
          ].filter(s => s.val !== null);
          const weakest = stageComps.length > 0
            ? stageComps.reduce((w, s) => (s.val / s.bench < w.val / w.bench ? s : w))
            : null;

          // ── Action Alerts ──
          const alerts = [];
          if (remainingGap >= 1.5) {
            const topRS = (liveReqs||[]).sort((a,b)=>(b.rs||0)-(a.rs||0))[0];
            alerts.push({ type:'source', icon:'📊',
              msg:`${remainingGap.toFixed(1)} offer gap remains — concentrate sourcing${topRS && topRS.rs > 0 ? ` on <strong>${topRS.name}</strong> (${topRS.rs} in RS)` : ' at top of funnel'}` });
          }
          if (r.oar < 75 && r.extended >= 2) {
            alerts.push({ type:'oar', icon:'⚠️',
              msg:`${r.oar}% OAR is below 75% — align with HM on comp positioning before the next extend` });
          }
          if (r.declines.length > 0 && r.declines[0][0].toLowerCase().includes('comp')) {
            alerts.push({ type:'comp', icon:'💸',
              msg:`Comp is the #1 decline driver (${r.declines[0][1]} decline${r.declines[0][1]>1?'s':''}) — flag to HM now to protect active offers` });
          }
          if (weakest && weakest.val < weakest.bench * 0.75) {
            alerts.push({ type:'funnel', icon:'🔦',
              msg:`${weakest.label} conversion is <strong>${Math.round(weakest.val*100)}%</strong> vs ${Math.round(weakest.bench*100)}% bench — this is your biggest funnel leak` });
          }
          if (deepReqs.some(req => (req.hc||0) > 0)) {
            alerts.push({ type:'win', icon:'🎯',
              msg:`You have candidates at HC — protect them: confirm comp, prep offer, align with HM on timeline` });
          }
          if (projected >= r.goal && r.accepted < r.goal) {
            alerts.push({ type:'close', icon:'🏁',
              msg:`Pipeline is projected to close — focus on converting active pipeline, not more sourcing` });
          }
          if (alerts.length === 0) {
            alerts.push({ type:'green', icon:'✅', msg:'No urgent actions — pipeline looks healthy, keep the momentum going' });
          }

          const alertColors = {
            source: { bg:'rgba(107,94,248,0.07)', border:'var(--purple)', text:'var(--purple)' },
            oar:    { bg:'rgba(245,166,35,0.08)', border:'var(--yellow)', text:'var(--yellow)' },
            comp:   { bg:'rgba(244,93,72,0.07)',  border:'var(--accent)', text:'var(--accent)' },
            funnel: { bg:'rgba(245,166,35,0.08)', border:'var(--yellow)', text:'var(--yellow)' },
            win:    { bg:'rgba(0,176,148,0.07)',  border:'var(--green)',  text:'var(--green)' },
            close:  { bg:'rgba(0,176,148,0.07)',  border:'var(--green)',  text:'var(--green)' },
            green:  { bg:'rgba(0,176,148,0.07)',  border:'var(--green)',  text:'var(--green)' },
          };

          return `
            <!-- Quarter Pulse -->
            <div style="margin-bottom:16px">
              <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:7px">Quarter Pulse</div>
              <div style="display:flex;gap:7px">
                <div style="flex:1;background:var(--bg3);border-radius:9px;padding:10px;text-align:center">
                  <div style="font-size:20px;font-weight:800;color:${barColor};line-height:1">${r.accepted}<span style="font-size:13px;font-weight:600;color:var(--text2)">/${r.goal}</span></div>
                  <div style="font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Accepted</div>
                </div>
                <div style="flex:1;background:var(--bg3);border-radius:9px;padding:10px;text-align:center">
                  <div style="font-size:20px;font-weight:800;color:${projColor};line-height:1">${projected.toFixed(1)}</div>
                  <div style="font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Projected</div>
                </div>
                <div style="flex:1.1;background:${paceBg};border:1.5px solid ${paceBorder};border-radius:9px;padding:10px;text-align:center">
                  <div style="font-size:13px;font-weight:800;color:${paceColor};line-height:1.2">${paceLabel}</div>
                  <div style="font-size:9px;color:var(--text2);margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Q Pace</div>
                </div>
              </div>
            </div>

            <!-- Win Now -->
            ${deepReqs.length > 0 ? `
            <div style="margin-bottom:16px">
              <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:7px">🎯 Win Now — Closest to Offer</div>
              ${deepReqs.map(req => {
                const stage = (req.hc||0) > 0 ? { label:'At HC', color:'var(--green)', bg:'rgba(0,176,148,0.1)', cta:'→ Prep offer' }
                            : (req.ir||0) > 0 ? { label:'At IR',  color:'var(--yellow)', bg:'rgba(245,166,35,0.1)', cta:'→ Push to HC' }
                            : { label:'At IA', color:'var(--purple)', bg:'rgba(107,94,248,0.1)', cta:'→ Schedule IR' };
                const depth = (req.hc||0)*4 + (req.ir||0)*2 + (req.ia||0);
                return `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 11px;background:var(--bg3);border-radius:9px;margin-bottom:5px;border-left:3px solid ${stage.color}">
                  <div style="flex:1;min-width:0">
                    <div style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${req.name || req.reqId}</div>
                    <div style="font-size:10px;color:var(--text2);margin-top:2px">
                      ${(req.hc||0)>0?`<span style="color:var(--green);font-weight:700">${req.hc} HC</span>`:''}
                      ${(req.ir||0)>0?`<span style="color:var(--yellow);font-weight:600;margin-left:5px">${req.ir} IR</span>`:''}
                      ${(req.ia||0)>0?`<span style="color:var(--text2);margin-left:5px">${req.ia} IA</span>`:''}
                      ${(req.rs||0)>0?`<span style="color:var(--text2);margin-left:5px">${req.rs} RS</span>`:''}
                    </div>
                  </div>
                  <div style="font-size:10px;font-weight:700;color:${stage.color};flex-shrink:0;background:${stage.bg};padding:3px 8px;border-radius:5px">${stage.cta}</div>
                </div>`;
              }).join('')}
            </div>` : ''}

            <!-- Action Alerts -->
            <div>
              <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:7px">📋 Action Items</div>
              ${alerts.map(a => {
                const c = alertColors[a.type] || alertColors.green;
                return `<div style="display:flex;align-items:flex-start;gap:9px;padding:8px 11px;border-radius:9px;margin-bottom:6px;background:${c.bg};border-left:3px solid ${c.border}">
                  <span style="font-size:14px;flex-shrink:0;margin-top:1px">${a.icon}</span>
                  <span style="font-size:11px;color:var(--text);line-height:1.55">${a.msg}</span>
                </div>`;
              }).join('')}
            </div>
          `;
        })()}
      </div>
    </div>
  `;

  // Render mini health gauge
  if (recGaugeChart) { recGaugeChart.destroy(); recGaugeChart = null; }
  const gaugeEl = document.getElementById('recGaugeCanvas');
  if (gaugeEl) {
    recGaugeChart = new Chart(gaugeEl, {
      type: 'doughnut',
      data: { datasets: [{ data: [health, 100-health], backgroundColor: [hColor,'rgba(0,0,0,0.06)'], borderWidth: 0, circumference: 180, rotation: 270 }] },
      options: { responsive:true, maintainAspectRatio:false, cutout:'72%', plugins:{legend:{display:false},tooltip:{enabled:false}}, animation:{duration:400} }
    });
  }

  // Screen effect based on health score
  setTimeout(() => triggerHealthEffect(health, r.name), 200);
}

// ── Insight toggle ─────────────────────────────────────────────────
function toggleInsight(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display === 'block';
  el.style.display = isOpen ? 'none' : 'block';
  const pill = el.closest('.req-pill');
  if (pill) {
    const btn = pill.querySelector('.req-insight-btn');
    if (btn) btn.textContent = isOpen ? 'Insights ▶' : 'Insights ▼';
  }
}

// ── Req table helpers ──────────────────────────────────────────────
function addReqRow() {
  if (!currentRecruiter) return;
  currentRecruiter.reqs.push({ name:'', rs:0, ia:0, ir:0, hc:0, offer:0 });
  renderRecruiterView(currentRecruiter);
}
function removeReq(idx) {
  if (!currentRecruiter) return;
  currentRecruiter.reqs.splice(idx, 1);
  renderRecruiterView(currentRecruiter);
}
function updateReqData(idx, field, val) {
  if (!currentRecruiter || !currentRecruiter.reqs[idx]) return;
  currentRecruiter.reqs[idx][field] = field === 'name' ? val : (parseInt(val) || 0);
}

// ── Health Score Screen Effects ────────────────────────────────────
let _lastEffectKey = null;

function triggerHealthEffect(score, recruiterName, bigMode) {
  const key = `${recruiterName}:${score}`;
  if (_lastEffectKey === key) return;
  _lastEffectKey = key;
  _clearHealthEffects();
  if (score >= 80)      _launchConfetti(score, bigMode);
  else if (score >= 60) _launchWarning('yellow', score);
  else                  _launchWarning('red', score);
}

function _clearHealthEffects() {
  ['__he-overlay','__he-beacon-l','__he-beacon-r','__he-badge','__he-canvas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

function _launchConfetti(score, bigMode) {
  const canvas = document.createElement('canvas');
  canvas.id = '__he-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const cols = ['#F45D48','#00876E','#F5A623','#F8D5CB','#6B5EF8','#FCEAE5','#00B094','#FFFFFF','#FFD700','#FF8C69'];
  const shapes = ['rect','circle','ribbon','star'];
  const count   = bigMode ? 380 : 140;
  const fadeAt  = bigMode ? 200 : 110;
  const maxF    = bigMode ? 300 : 180;
  const pts = Array.from({length:count}, () => ({
    x: Math.random() * canvas.width,
    y: -30 - Math.random() * (bigMode ? 400 : 250),
    vx: (Math.random()-0.5) * (bigMode ? 5 : 3.5),
    vy: (bigMode ? 1.2 : 1.8) + Math.random() * (bigMode ? 5 : 3.5),
    rot: Math.random()*Math.PI*2, rotV: (Math.random()-0.5)*0.2,
    w: (bigMode ? 5 : 7) + Math.random()*(bigMode ? 12 : 9),
    h: 4 + Math.random()*5,
    col: cols[Math.floor(Math.random()*cols.length)],
    shape: shapes[Math.floor(Math.random()*shapes.length)],
    alpha: 1,
  }));
  // Extra burst from center-top for big mode
  if (bigMode) {
    const cx = canvas.width / 2;
    for (let i = 0; i < 80; i++) {
      const angle = -Math.PI/2 + (Math.random()-0.5)*Math.PI;
      const speed = 4 + Math.random()*10;
      pts.push({
        x: cx + (Math.random()-0.5)*100, y: 80,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        rot:0, rotV:(Math.random()-0.5)*0.3,
        w:6+Math.random()*10, h:4+Math.random()*5,
        col: cols[Math.floor(Math.random()*cols.length)],
        shape: shapes[Math.floor(Math.random()*shapes.length)],
        alpha:1,
      });
    }
  }
  function drawStar(ctx, r) {
    ctx.beginPath();
    for (let i=0;i<5;i++) {
      const a = (i*4*Math.PI/5) - Math.PI/2;
      const b = ((i*4+2)*Math.PI/5) - Math.PI/2;
      i===0 ? ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r) : ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
      ctx.lineTo(Math.cos(b)*(r*0.4), Math.sin(b)*(r*0.4));
    }
    ctx.closePath(); ctx.fill();
  }
  let frame = 0;
  function tick() {
    if (!document.getElementById('__he-canvas')) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    frame++;
    pts.forEach(p => {
      p.x += p.vx + Math.sin(frame*0.04+p.y*0.01)*0.5;
      p.y += p.vy; p.vy += 0.08;
      p.rot += p.rotV;
      if (frame > fadeAt) p.alpha = Math.max(0, p.alpha - 0.018);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      if (p.shape==='circle') {
        ctx.beginPath(); ctx.arc(0,0,p.w/2,0,Math.PI*2); ctx.fill();
      } else if (p.shape==='ribbon') {
        ctx.beginPath(); ctx.ellipse(0,0,p.w/2,p.h/4,0,0,Math.PI*2); ctx.fill();
      } else if (p.shape==='star') {
        drawStar(ctx, p.w/2);
      } else {
        ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      }
      ctx.restore();
    });
    if (frame < maxF) requestAnimationFrame(tick); else canvas.remove();
  }
  requestAnimationFrame(tick);
  _showBadge('🎉', `${score} Health Score — On fire!`, '#00876E');
}

function _launchWarning(level, score) {
  const isRed = level === 'red';
  const accent = isRed ? '#F45D48' : '#F5A623';
  const label  = isRed ? `🚨 ${score} — Needs attention` : `⚠️ ${score} — Worth watching`;

  // Full-screen edge overlay
  const ov = document.createElement('div');
  ov.id = '__he-overlay';
  ov.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:9990;border:3px solid ${accent};
    animation:${isRed ? '__policeFlash 0.55s ease-in-out 5' : '__pulseAmber 1.4s ease-in-out 3'};`;
  document.body.appendChild(ov);

  const dur = isRed ? 3000 : 4500;
  setTimeout(() => ov.remove(), dur);
  _showBadge(isRed ? '🚨' : '⚠️', label, accent);
}

function _showBadge(icon, text, color) {
  const b = document.createElement('div');
  b.id = '__he-badge';
  b.style.cssText = `position:fixed;top:68px;right:20px;z-index:10001;background:#fff;
    border:2px solid ${color};border-radius:12px;padding:9px 14px;
    display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:${color};
    box-shadow:0 4px 24px ${color}55;pointer-events:none;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    animation:__healthSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both,
              __healthFadeOut 0.45s ease 2.6s forwards;`;
  b.innerHTML = `<span style="font-size:17px">${icon}</span><span>${text}</span>`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 3200);
}

// Fire init immediately if DOM already ready (common in sandboxed iframes),
// otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

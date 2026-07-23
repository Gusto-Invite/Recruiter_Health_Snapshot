// ── Team Config (overridden by each team page) ──────────────────────
const _TC = window.TEAM_CONFIG || {
  key: 'Engineering', name: 'Engineering', color: '#F45D48',
  lead: 'Jaime Tavarez', goal: 46
};

const TOOL = 'mcp__c61042c2-2fb3-4e2e-888c-dce52a6a8c86__fetch';
const PIPELINE_SHEET = '1jFTGmMfMgsnkCbPPhgwZDPtbNM0-wIM1Ee-FLvTOZVU';

let currentScenario = 'base';
let projectionChart = null, gaugeChart = null, histChart = null, declineCompChart = null;

const FALLBACK = {
  // _TC.goal is explicitly null for teams whose Q1 hiring goal isn't known yet
  // (GTM, CX, SpecTech, Foundation) — HAS_GOAL below gates every goal-relative
  // calculation/display so those teams show "no goal set" instead of a
  // fabricated number, rather than falling back to Engineering's 46.
  q1Goal: _TC.goal === null ? null : (_TC.goal || 46),
  q1Predicted: 27,           // FTE offers accepted in Q1 (by resolved/acceptance date, excl. interns & apprentices)
  hiresQ1ToDate: 29,         // FTE starts through Jun 9 (excl. interns/apprentices, used for pace projection)
  acceptedTotal: 27,         // offers accepted in Q1 (resolved date in May–Jul 2026, excl. interns & apprentices)
  acceptedMay: 23,           // accepted in May
  acceptedJun: 4,            // accepted in June so far
  acceptedPending: 14,       // not yet started (future start dates)
  baseRecruiterCount: 9,
  basePPR: 1.44,
  baseOAR: 0.85,
  // oarByLevel / declineReasons intentionally removed — team-wide OAR and decline
  // reasons are now computed live per team by aggregateTeamStats() from each
  // team's own RECRUITERS data (see renderOARByLevel/renderDeclineSection/renderRisks),
  // instead of a single hardcoded Engineering-only breakdown shared by every page.
  pipeline: {
    weeks: ['Apr 13','Apr 20','Apr 27','May 4','May 11','May 18','May 25','Jun 1','Jun 8'],
    rs:    [273,260,263,221,242,225,199,262,250],
    ia:    [54,43,41,41,50,44,44,45,46],
    ir:    [69,62,51,31,22,27,33,34,23],
    hc:    [8,13,13,10,10,4,3,3,4],
    offer: [9,9,11,12,13,12,6,9,7],
    openJobs: [89,76,73,69,51,47,55,60,65]
  }
};

// True only for teams with a known Q1 hiring goal (currently just Engineering).
// Every goal-relative calculation/display below checks this instead of
// assuming a number, so GTM/CX/SpecTech/Foundation show honest "no goal set"
// text rather than NaN/Infinity or a fabricated percentage.
const HAS_GOAL = FALLBACK.q1Goal != null;

// ── Date math ──────────────────────────────────────────────────────
const today      = new Date();
const qStart     = new Date('2026-05-01');
const qEnd       = new Date('2026-07-31');
const daysElapsed   = Math.max(0, Math.floor((today - qStart) / 86400000));
const daysTotal     = Math.floor((qEnd - qStart) / 86400000) + 1;
const daysRemaining = Math.max(0, Math.floor((qEnd - today) / 86400000));
const pctThrough    = (daysElapsed / daysTotal * 100).toFixed(1);
const monthsLeft    = daysRemaining / 30.0;

// ── Helpers ────────────────────────────────────────────────────────
function extractSheetContent(r) {
  if (!r || r.isError) return '';
  if (r.structuredContent?.content) return r.structuredContent.content;
  const arr = Array.isArray(r.content) ? r.content : [];
  const blk = arr.find(b => b?.type === 'text');
  if (blk?.text) { try { return JSON.parse(blk.text)?.content || blk.text; } catch { return blk.text; } }
  if (typeof r.content === 'string') { try { return JSON.parse(r.content)?.content || r.content; } catch { return r.content; } }
  return '';
}

function lines(txt) {
  return txt.split('\n').map(l => l.split('\t').map(c => c.trim())).filter(r => r.some(c => c.length));
}

function parsePipelineSnapshot(txt) {
  const data = { weeks:[], rs:[], ia:[], ir:[], hc:[], offer:[], openJobs:[] };
  const rows = lines(txt);
  let headerRow = null;

  // Week header cells may be text ("Week of Apr 13") OR date strings ("4/13/2026")
  // — the latter happens when Apps Script getValues() returns Date objects which
  //   JSON.stringify converts to ISO strings that arrayToTSV formats as M/D/YYYY
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const isDateStr = s => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s);
  const isWeekCell = s => s.startsWith('Week of') || isDateStr(s);
  const toWeekLabel = s => {
    if (s.startsWith('Week of')) return s;
    const [m, d] = s.split('/');
    return `Week of ${MONTHS[parseInt(m)-1]} ${parseInt(d)}`;
  };

  for (const r of rows) {
    if (r.some(c => isWeekCell(c))) { headerRow = r; break; }
  }
  if (!headerRow) return null;

  const weekCols = headerRow.slice(1).filter(c => isWeekCell(c));
  data.weeks = weekCols.map(toWeekLabel);

  const map = { 'Recruiter Screen':'rs', 'Initial Assessment':'ia', 'Interview Round':'ir', 'Hiring Committee':'hc', 'Offer':'offer', 'Open Jobs':'openJobs' };
  for (const row of rows) {
    const key = map[row[0]];
    if (key) data[key] = weekCols.map((_, i) => { const v = parseInt(row[i+1]); return isNaN(v) ? 0 : v; });
  }

  // Trim trailing weeks with no data (future week columns show as all-zeros)
  // Use RS as the signal — find the last week with a non-zero RS value
  if (data.rs && data.rs.length > 0) {
    let lastIdx = data.rs.length - 1;
    while (lastIdx > 0 && data.rs[lastIdx] === 0) lastIdx--;
    if (lastIdx < data.rs.length - 1) {
      const trim = i => i ? i.slice(0, lastIdx + 1) : i;
      data.weeks = data.weeks.slice(0, lastIdx + 1);
      data.rs    = trim(data.rs);
      data.ia    = trim(data.ia);
      data.ir    = trim(data.ir);
      data.hc    = trim(data.hc);
      data.offer = trim(data.offer);
      data.openJobs = trim(data.openJobs);
    }
  }

  return data.weeks.length > 0 ? data : null;
}

// ── Projection model ───────────────────────────────────────────────
function computeProjection(oar, rec, ppr) {
  const baseMonthly = rec * ppr * (oar / FALLBACK.baseOAR);
  const remaining   = Math.round(baseMonthly * monthsLeft);
  const total       = FALLBACK.hiresQ1ToDate + remaining;
  // gap/paceNeeded are meaningless without a known goal — leave them null so
  // every caller has to explicitly handle the no-goal case instead of
  // silently computing NaN/Infinity from FALLBACK.q1Goal - null.
  if (!HAS_GOAL) return { baseMonthly, remaining, total, gap: null, paceNeeded: null };
  const gap         = Math.max(0, FALLBACK.q1Goal - total);
  const paceNeeded  = monthsLeft > 0 ? (FALLBACK.q1Goal - FALLBACK.hiresQ1ToDate) / monthsLeft : 0;
  return { baseMonthly, remaining, total, gap, paceNeeded };
}

function getMonthBreakdown(oar, rec, ppr, mult) {
  const monthly = rec * ppr * (oar / FALLBACK.baseOAR) * mult;
  const mayActual      = Math.round(FALLBACK.hiresQ1ToDate * (31/40));
  const juneActual     = FALLBACK.hiresQ1ToDate - mayActual;
  const juneRemaining  = Math.round(monthly * (21/30));
  return [mayActual, juneActual + juneRemaining, Math.round(monthly)];
}

const SCENARIOS = {
  pessimistic: { mult: 0.75, color: '#F45D48' },
  base:        { mult: 1.00, color: '#F45D48' },
  optimistic:  { mult: 1.35, color: '#00B094' }
};

// ── Health score ───────────────────────────────────────────────────
function currentOfferCount() {
  // Prefer the live snapshot (built from Current Pipeline per Job in
  // fetchPipelinePerJob) — falls back to the FALLBACK seed only until that
  // live fetch resolves.
  const live = window._livePipelineData;
  if (live && Array.isArray(live.offer) && live.offer.length) return live.offer.slice(-1)[0];
  return FALLBACK.pipeline.offer.slice(-1)[0];
}
function currentIRCount() {
  const live = window._livePipelineData;
  if (live && Array.isArray(live.ir) && live.ir.length) return live.ir.slice(-1)[0];
  return FALLBACK.pipeline.ir.slice(-1)[0];
}

function computeHealth(oar, rec, ppr) {
  const proj = computeProjection(oar, rec, ppr);
  // Without a goal there's no "pace vs. goal" to score, so that component's
  // 50 points get redistributed across OAR and pipeline depth instead of
  // just silently dropping to a max score of 50.
  if (!HAS_GOAL) {
    return Math.round(
      Math.min(60, 60 * (oar / 0.95)) +
      Math.min(40, 40 * Math.min(1, currentOfferCount() / 8))
    );
  }
  return Math.round(
    Math.min(50, 50 * (proj.baseMonthly / proj.paceNeeded)) +
    Math.min(30, 30 * (oar / 0.95)) +
    Math.min(20, 20 * Math.min(1, currentOfferCount() / 8))
  );
}
function healthColor(s) { return s >= 80 ? '#00B094' : s >= 60 ? '#F5A623' : '#F45D48'; }
function healthLabel(s) { return s >= 80 ? 'On Track' : s >= 65 ? 'At Risk' : s >= 50 ? 'Needs Attention' : 'Critical'; }

Chart.defaults.color = '#7A6E65';
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 11;

// ── Gauge ──────────────────────────────────────────────────────────
function renderGauge(score) {
  const col = healthColor(score);
  document.getElementById('healthValue').textContent = score;
  document.getElementById('healthValue').style.color = col;
  document.getElementById('healthLabel').textContent = healthLabel(score);
  if (gaugeChart) gaugeChart.destroy();
  gaugeChart = new Chart(document.getElementById('gaugeChart'), {
    type: 'doughnut',
    data: { datasets: [{ data: [score, 100-score], backgroundColor: [col,'rgba(0,0,0,0.06)'], borderWidth: 0, circumference: 180, rotation: 270 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'72%', plugins:{ legend:{display:false}, tooltip:{enabled:false} }, animation:{duration:600} }
  });
  // Screen effect — use 'team-overview' as the key so it retriggers if score changes
  setTimeout(() => triggerHealthEffect(score, `team:${score}`, true), 400);
}

// ── Projection chart ───────────────────────────────────────────────
function renderProjectionChart(oar, rec, ppr) {
  const s = SCENARIOS[currentScenario];
  const data = getMonthBreakdown(oar, rec, ppr, s.mult);
  if (projectionChart) projectionChart.destroy();
  projectionChart = new Chart(document.getElementById('projectionChart'), {
    type: 'bar',
    data: {
      labels: ['May', 'June', 'July'],
      datasets: [
        { label: 'Projected FTE Hires', data, backgroundColor: ['rgba(244,93,72,0.5)','rgba(244,93,72,0.7)',s.color+'99'], borderColor: ['rgba(244,93,72,0.8)','rgba(244,93,72,0.9)',s.color], borderWidth:2, borderRadius:6 },
        { label: 'Monthly Goal Pace', data:[18,18,18], type:'line', borderColor:'rgba(0,0,0,0.2)', borderDash:[6,4], borderWidth:2, pointRadius:0, fill:false }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:true,position:'top',labels:{boxWidth:12,padding:12}} }, scales:{ x:{grid:{color:'rgba(0,0,0,0.05)'}}, y:{grid:{color:'rgba(0,0,0,0.05)'},beginAtZero:true,max:25,ticks:{stepSize:5}} } }
  });
}

// ── Historical pipeline reference (Pipeline History per Dept) ───────
// This sheet has exactly one row per real Greenhouse department with
// lifetime (current + previous fiscal year) stage totals — there is no
// week column and no recruiter column anywhere in the spreadsheet, so this
// can never be a live "this quarter" number or a per-recruiter number.
// It is rendered purely as a historical reference next to (not instead of)
// the live Funnel card above, which already reflects current pipeline
// state from Current Pipeline per Job.
function renderHistoricalReference(dept, teamName) {
  const subtitleEl = document.getElementById('trendCardSubtitle');
  const noteEl      = document.getElementById('trendAnalysisNote');
  const container    = document.getElementById('trendChartContainer');
  if (!container) return;

  if (!dept) {
    if (subtitleEl) subtitleEl.textContent = 'no matching Greenhouse department';
    container.innerHTML = `<div style="padding:24px 4px;text-align:center;color:var(--text2);font-size:12px;font-style:italic">
      No department-level historical data for "${teamName}" — ${teamName} isn't tracked as its own Greenhouse department in Pipeline History per Dept (only Engineering, Sales, Marketing, Design, Data, etc. are).
    </div>`;
    if (noteEl) noteEl.style.display = 'none';
    return;
  }

  const stages = [
    { name:'Application',   val:dept.application, color:'#8b95b0' },
    { name:'Assessment',    val:dept.assessment,  color:'#9b59b6' },
    { name:'Face to Face',  val:dept.faceToFace,   color:'#F5A623' },
    { name:'Offer',         val:dept.offer,        color:'#00B094' },
    { name:'Hired',         val:dept.hired,        color:'#F45D48' }
  ];
  const maxVal = Math.max(dept.application || 1, 1);
  let html = '';
  stages.forEach((s, i) => {
    const barPct = Math.max(3, (s.val / maxVal) * 100);
    if (i > 0) {
      const prev = stages[i-1].val;
      const rate = prev > 0 ? ((s.val / prev) * 100).toFixed(1) : '—';
      html += `<div class="funnel-arrow">↓ ${rate}% conversion</div>`;
    }
    html += `<div class="funnel-row"><div class="funnel-label">${s.name}</div><div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${barPct}%;background:${s.color}">${s.val.toLocaleString()}</div></div><div class="funnel-rate">${s.val.toLocaleString()}</div></div>`;
  });
  container.innerHTML = html;

  if (subtitleEl) subtitleEl.textContent = `${dept.name} · current + previous year · Greenhouse dept-level`;
  if (noteEl) {
    const overallRate = dept.application > 0 ? (dept.hired / dept.application * 100) : 0;
    noteEl.style.display = 'block';
    noteEl.className = 'analysis-note';
    noteEl.innerHTML = `<strong>📊 Historical reference:</strong> Across ${dept.application.toLocaleString()} applications logged for ${dept.name} over the current + previous year, ${dept.hired.toLocaleString()} converted to hires (${overallRate.toFixed(2)}% overall). This is lifetime, org-wide data for context — see the Funnel card above for this team's live current-pipeline state.`;
  }
}

// ── Funnel ─────────────────────────────────────────────────────────
function renderFunnel(pd) {
  console.log('[Funnel] renderFunnel called — rs:', pd && pd.rs, 'offer:', pd && pd.offer);
  if (!pd || !pd.rs || !pd.rs.length) { console.warn('[Funnel] bad data, skipping'); return; }
  const latest = { rs:pd.rs.slice(-1)[0], ia:pd.ia.slice(-1)[0], ir:pd.ir.slice(-1)[0], hc:pd.hc.slice(-1)[0], offer:pd.offer.slice(-1)[0] };
  const stages = [
    { name:'Recruiter Screen',   val:latest.rs,    color:'#F45D48' },
    { name:'Initial Assessment', val:latest.ia,    color:'#9b59b6' },
    { name:'Interview Round',    val:latest.ir,    color:'#F5A623' },
    { name:'Hiring Committee',   val:latest.hc,    color:'#00B094' },
    { name:'Offer',              val:latest.offer, color:'#F45D48' }
  ];
  const maxVal = Math.max(latest.rs || 1, 1);
  let html = '';
  stages.forEach((s, i) => {
    const barPct = Math.max(3, (s.val / maxVal) * 100);
    if (i > 0) {
      const prev = stages[i-1].val;
      const rate = prev > 0 ? ((s.val / prev) * 100).toFixed(0) : '—';
      html += `<div class="funnel-arrow">↓ ${rate}% conversion</div>`;
    }
    html += `<div class="funnel-row"><div class="funnel-label">${s.name}</div><div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${barPct}%;background:${s.color}">${s.val}</div></div><div class="funnel-rate">${s.val}</div></div>`;
  });
  document.getElementById('funnelContainer').innerHTML = html;
  // Date from the latest week column header, or today if not available
  const latestWeek = pd.weeks && pd.weeks.length > 0 ? pd.weeks.slice(-1)[0] : null;
  const dateLabel = latestWeek ? latestWeek.replace('Week of ', '') : new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
  document.getElementById('funnelDate').textContent = `as of ${dateLabel}`;
}

// ── Historical chart ───────────────────────────────────────────────
// Stored live quarterly history once loaded
let _liveHistData = null;

// Gusto fiscal quarter: Q1=May-Jul, Q2=Aug-Oct, Q3=Nov-Jan, Q4=Feb-Apr
function getFQLabel(mo, yr) {
  if (mo >= 5 && mo <= 7)  return `Q1 FY${(yr + 1) - 2000}`;
  if (mo >= 8 && mo <= 10) return `Q2 FY${(yr + 1) - 2000}`;
  if (mo >= 11)            return `Q3 FY${(yr + 1) - 2000}`;
  if (mo === 1)            return `Q3 FY${yr - 2000}`;
  if (mo >= 2 && mo <= 4)  return `Q4 FY${yr - 2000}`;
  return null;
}

// Ordered list of completed history quarters to show
const HISTORY_QUARTERS = ['Q1 FY26','Q2 FY26','Q3 FY26','Q4 FY26'];

function renderHistChart(projected, liveHist) {
  if (liveHist) _liveHistData = liveHist;
  const hd = _liveHistData;
  const histLabels   = hd ? hd.labels    : ['Q2 FY26','Q3 FY26','Q4 FY26'];
  const histAccepted = hd ? hd.accepted  : [72, 41, 76];
  const histExtended = hd ? hd.extended  : [91, 53, 91];
  const nullPad      = histLabels.map(() => null);

  if (histChart) histChart.destroy();
  histChart = new Chart(document.getElementById('histChart'), {
    type: 'bar',
    data: {
      labels: [...histLabels, 'Q1 FY27 (Current)'],
      datasets: [
        { label:'Accepted',          data:[...histAccepted, null],     backgroundColor:'rgba(244,93,72,0.6)',   borderColor:'#F45D48',              borderWidth:2, borderRadius:6 },
        { label:'Extended',          data:[...histExtended, null],     backgroundColor:'rgba(244,93,72,0.15)',  borderColor:'rgba(244,93,72,0.4)',   borderWidth:1, borderRadius:6 },
        { label:'Projected Accepted',data:[...nullPad, projected],     backgroundColor:'rgba(245,166,35,0.4)', borderColor:'#F5A623',              borderWidth:2, borderRadius:6 },
        // No goal line for teams without a known Q1 goal yet.
        ...(HAS_GOAL ? [{ label:`Goal (${FALLBACK.q1Goal})`, data:[...nullPad, FALLBACK.q1Goal], type:'line', borderColor:'rgba(0,0,0,0.2)', borderDash:[6,4], borderWidth:2, pointRadius:0, fill:false }] : [])
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:true,position:'top',labels:{boxWidth:12,padding:12}},
        tooltip:{ callbacks:{ footer: (items) => {
          const i = items[0]; const qi = i.dataIndex;
          if (qi < histLabels.length && hd) {
            const acc = hd.accepted[qi], ext = hd.extended[qi];
            const oar = ext > 0 ? Math.round(acc/ext*100) : 0;
            return `OAR: ${oar}% (${acc}/${ext}) · ${_TC.name} only`;
          }
          return hd ? `Live · ${_TC.name} Invite team` : 'Hardcoded fallback';
        }}}
      },
      scales:{ x:{grid:{color:'rgba(0,0,0,0.05)'}}, y:{grid:{color:'rgba(0,0,0,0.05)'},beginAtZero:true,ticks:{stepSize:20}} }
    }
  });

  // Update analysis note
  if (hd && hd.labels.length >= 2) {
    const lastHist  = hd.accepted[hd.labels.length - 1];
    const prevHist  = hd.accepted[hd.labels.length - 2];
    const lastLabel = hd.labels[hd.labels.length - 1];
    const lastExt   = hd.extended[hd.labels.length - 1];
    const lastOAR   = lastExt > 0 ? Math.round(lastHist/lastExt*100) : '–';
    const prevOAR   = hd.extended[hd.labels.length-2] > 0 ? Math.round(prevHist/hd.extended[hd.labels.length-2]*100) : '–';
    const trend     = lastHist > prevHist ? '↑' : lastHist < prevHist ? '↓' : '→';
    const note      = document.querySelector('#histChart')?.closest('.card')?.querySelector('.analysis-note');
    if (note) note.innerHTML = `<strong>🟢 Live · ${_TC.name} only:</strong> ${lastLabel} saw ${lastHist} accepted of ${lastExt} extended (${lastOAR}% OAR). ${trend} vs prior quarter (${prevHist} accepted, ${prevOAR}% OAR). Q1 FY27 projected: ${projected}.`;
  }
}

// ── Team-wide offer stats, aggregated from RECRUITERS ───────────────
// RECRUITERS is scoped to whichever team's page is loaded (window.TEAM_RECRUITERS
// set in each team's index.html), and each recruiter's accepted/extended/oarByLevel/
// declines fields are populated live from the Offers sheet in fetchAcceptedOffers()
// — filtered to that same team's recruiters. So this aggregate is always this team's
// own real numbers, never another team's.
function aggregateTeamStats() {
  let totalAcc = 0, totalExt = 0;
  const byLevel = {};   // lvl -> {acc, ext}
  const reasons = {};   // reason -> count
  RECRUITERS.forEach(r => {
    totalAcc += r.accepted || 0;
    totalExt += r.extended || 0;
    if (r.oarByLevel) {
      Object.entries(r.oarByLevel).forEach(([lvl, v]) => {
        if (!byLevel[lvl]) byLevel[lvl] = { acc: 0, ext: 0 };
        byLevel[lvl].acc += v.acc || 0;
        byLevel[lvl].ext += v.ext || 0;
      });
    }
    if (r.declines && r.declines.length) {
      r.declines.forEach(([reason, count]) => {
        reasons[reason] = (reasons[reason] || 0) + count;
      });
    }
  });
  const levels = {};
  Object.entries(byLevel).forEach(([lvl, v]) => {
    levels[lvl] = { oar: v.ext > 0 ? Math.round(v.acc / v.ext * 100) : 0, accepted: v.acc, extended: v.ext };
  });
  const reasonList = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const totalDeclines = reasonList.reduce((s, [, c]) => s + c, 0);
  return {
    totalAcc, totalExt,
    oarPct: totalExt > 0 ? Math.round(totalAcc / totalExt * 100) : null,
    levels, reasonList, totalDeclines
  };
}

// ── Decline reasons (this team's own recruiters, real reasons only) ──
function renderDeclineSection() {
  const stats = aggregateTeamStats();
  const container = document.getElementById('l4DeclineContainer');
  if (!container) return;
  const card = container.closest('.card');
  const cardTitleEl = card ? card.querySelector('.card-title') : null;
  const titleSpan   = cardTitleEl ? cardTitleEl.querySelector('span') : null;
  const callout     = card ? card.querySelector('.insight-callout') : null;
  if (cardTitleEl && cardTitleEl.firstChild) cardTitleEl.firstChild.textContent = `${_TC.name} Offer Decline Reasons `;
  if (titleSpan) titleSpan.textContent = `Q1 · ${stats.totalDeclines} total decline${stats.totalDeclines !== 1 ? 's' : ''}${stats.oarPct != null ? ` · OAR ${stats.oarPct}%` : ''}`;

  const reasonColors = {
    'Cash Compensation':       '#F45D48',
    'Equity Compensation':     '#e67e22',
    'Role Misalignment':       '#9b59b6',
    'Duplicate Application':   '#3d4f7a',
    'Moving to headcount req': '#3d4f7a',
    'Timeline Misalignment':   '#00B094',
    "Gusto's Product/Industry":'#F5A623',
    'Level Misalignment':      '#3d4f7a',
    'Other':                   '#4a5568'
  };

  if (stats.totalDeclines === 0) {
    container.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--green);font-size:12px;font-weight:600">✓ No Q1 declines for ${_TC.name}</div>`;
    if (callout) callout.style.display = 'none';
  } else {
    if (callout) {
      callout.style.display = 'block';
      const top = stats.reasonList[0];
      const topPct = Math.round(top[1] / stats.totalDeclines * 100);
      const breakdown = stats.reasonList.map(([r, c]) => `${r} ${Math.round(c / stats.totalDeclines * 100)}% (${c} of ${stats.totalDeclines})`).join('; ');
      callout.innerHTML = `<strong>⚠️ ${topPct}% of Q1 ${_TC.name} declines are "${top[0]}".</strong> ${breakdown}.`;
    }
    const maxCount = stats.reasonList[0][1];
    let html = '';
    stats.reasonList.forEach(([reason, count]) => {
      const pct = Math.round(count / stats.totalDeclines * 100);
      const barW = Math.round(count / maxCount * 100);
      const col = reasonColors[reason] || '#4a5568';
      html += `
        <div class="decline-bar-row">
          <div class="decline-label">${reason}</div>
          <div class="decline-bar-wrap">
            <div class="decline-bar" style="width:${barW}%;background:${col}">${pct}%</div>
          </div>
          <div class="decline-count" style="color:${col}">${count}</div>
        </div>`;
    });
    container.innerHTML = html;
  }

  // Second chart: reasons broken out by recruiter (real, team-scoped). Greenhouse's
  // Level Anchor field is populated for well under 5% of offers, so a reliable
  // by-level split isn't available from source data — by-recruiter is.
  const chartCanvas = document.getElementById('declineCompChart');
  const chartCard   = chartCanvas ? chartCanvas.closest('.card') : null;
  const chartTitleEl = chartCard ? chartCard.querySelector('.card-title') : null;
  const chartTitleSpan = chartTitleEl ? chartTitleEl.querySelector('span') : null;
  if (chartTitleEl && chartTitleEl.firstChild) chartTitleEl.firstChild.textContent = 'Decline Reasons by Recruiter ';
  if (chartTitleSpan) chartTitleSpan.textContent = 'Q1 (May–Jul 2026) · excl. interns';

  if (declineCompChart) { declineCompChart.destroy(); declineCompChart = null; }
  const recNames = RECRUITERS.filter(r => r.declines && r.declines.length).map(r => r.name);
  if (recNames.length === 0 || !chartCanvas) return;
  const topReasons = stats.reasonList.slice(0, 3).map(([r]) => r);
  const palette = ['#F45D48', '#e67e22', '#9b59b6'];
  const datasets = topReasons.map((reason, ri) => ({
    label: reason,
    data: recNames.map(name => {
      const r = RECRUITERS.find(x => x.name === name);
      const found = (r?.declines || []).find(([rr]) => rr === reason);
      return found ? found[1] : 0;
    }),
    backgroundColor: palette[ri % palette.length] + 'cc',
    borderColor: palette[ri % palette.length],
    borderWidth: 1,
    borderRadius: 4
  }));
  declineCompChart = new Chart(chartCanvas, {
    type: 'bar',
    data: { labels: recNames, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 11, padding: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` } }
      },
      scales: {
        x: { stacked: false, grid: { color: 'rgba(0,0,0,0.05)' } },
        y: { stacked: false, grid: { color: 'rgba(0,0,0,0.05)' }, beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

// ── OAR by level (this team's own recruiters) ────────────────────────
// Falls back to the team's real overall OAR when Greenhouse's Level Anchor
// field isn't populated for this team's offers (the common case), rather than
// fabricating a level split that doesn't exist in the source data.
function renderOARByLevel() {
  const stats = aggregateTeamStats();
  const container = document.getElementById('oarByLevel');
  if (!container) return;

  if (stats.totalExt === 0) {
    container.innerHTML = `<div style="padding:16px 4px;text-align:center;color:var(--text2);font-size:12px;font-style:italic">No offers extended for ${_TC.name} yet this quarter.</div>`;
    return;
  }

  const levelEntries = Object.entries(stats.levels).sort(([a], [b]) => a.localeCompare(b));
  let html = '';
  if (levelEntries.length > 0) {
    levelEntries.forEach(([lvl, d]) => {
      const col = d.oar >= 85 ? '#00B094' : d.oar >= 75 ? '#F5A623' : '#F45D48';
      const rejected = d.extended - d.accepted;
      html += `
        <div class="oar-item">
          <div class="oar-item-label">${lvl}</div>
          <div class="oar-item-bar-wrap">
            <div class="oar-item-bar" style="width:${d.oar}%;background:${col}">${d.oar}%</div>
          </div>
          <div class="oar-item-val" style="color:${col}">${d.oar}%</div>
          <div style="font-size:10px;color:var(--text2);white-space:nowrap;flex-shrink:0;width:80px;text-align:right">${d.accepted}/${d.extended} <span style="color:#F45D48">(−${rejected})</span></div>
        </div>`;
    });
  } else {
    const col = stats.oarPct >= 85 ? '#00B094' : stats.oarPct >= 75 ? '#F5A623' : '#F45D48';
    const rejected = stats.totalExt - stats.totalAcc;
    html = `
      <div class="oar-item">
        <div class="oar-item-label">All</div>
        <div class="oar-item-bar-wrap">
          <div class="oar-item-bar" style="width:${stats.oarPct}%;background:${col}">${stats.oarPct}%</div>
        </div>
        <div class="oar-item-val" style="color:${col}">${stats.oarPct}%</div>
        <div style="font-size:10px;color:var(--text2);white-space:nowrap;flex-shrink:0;width:80px;text-align:right">${stats.totalAcc}/${stats.totalExt} <span style="color:#F45D48">(−${rejected})</span></div>
      </div>
      <div style="font-size:10px;color:var(--text2);font-style:italic;margin-top:6px">Level-by-level split isn't available — Greenhouse's Level Anchor field is empty for nearly all ${_TC.name} offers this quarter, so this shows overall team OAR instead.</div>`;
  }
  container.innerHTML = html;
}

// ── Risk flags (this team's own goal, OAR, and pipeline depth) ───────
const RISK_LEVEL_RANK = { 'risk-high': 0, 'risk-mid': 1, 'risk-low': 2 };

function computeRisks(proj) {
  const gap = proj.gap;
  const stats = aggregateTeamStats();
  const offerCount = currentOfferCount();
  const latestIR = currentIRCount();
  const pending = FALLBACK.acceptedPending || 0;
  return [
    !HAS_GOAL ? {
      // No Q1 goal set yet for this team — an informational card instead of
      // a fabricated gap-to-goal risk (which would need FALLBACK.q1Goal).
      level: 'risk-low',
      icon: 'ℹ️',
      title: `${FALLBACK.acceptedTotal} FTE Accepted This Quarter`,
      desc: `No Q1 hiring goal has been set yet for ${_TC.name} — tracking accepted offers and pace only.`
    } : {
      level: gap >= 15 ? 'risk-high' : gap >= 8 ? 'risk-mid' : 'risk-low',
      icon: gap >= 15 ? '🔴' : gap >= 8 ? '🟡' : '🟢',
      title: gap > 0 ? `${gap}-Hire FTE Gap to Goal` : 'FTE Goal Within Reach',
      desc: gap > 0
        ? `At current FTE pace (${proj.baseMonthly.toFixed(1)}/mo), Q1 projects to ~${proj.total} vs goal of ${FALLBACK.q1Goal}. Need ${proj.paceNeeded.toFixed(1)}/mo.`
        : `Projected to meet or exceed the ${FALLBACK.q1Goal}-hire Q1 FTE goal.`
    },
    stats.totalExt > 0 ? {
      level: stats.oarPct < 70 ? 'risk-high' : stats.oarPct < 85 ? 'risk-mid' : 'risk-low',
      icon: stats.oarPct < 70 ? '🔴' : stats.oarPct < 85 ? '🟡' : '🟢',
      title: `${_TC.name} OAR at ${stats.oarPct}%`,
      desc: stats.totalDeclines > 0
        ? `${stats.totalAcc}/${stats.totalExt} offers accepted this quarter. Top decline reason: "${stats.reasonList[0][0]}" (${stats.reasonList[0][1]} of ${stats.totalDeclines}).`
        : `${stats.totalAcc}/${stats.totalExt} offers accepted this quarter — no declines recorded yet.`
    } : {
      level: 'risk-mid',
      icon: '⚪',
      title: `No offers extended yet for ${_TC.name}`,
      desc: `Team OAR will populate once offers are extended and resolved in Greenhouse this quarter.`
    },
    {
      level: offerCount < 6 ? 'risk-high' : offerCount < 10 ? 'risk-mid' : 'risk-low',
      icon: offerCount < 6 ? '🔴' : offerCount < 10 ? '🟡' : '🟢',
      title: `${offerCount} Active Offer${offerCount !== 1 ? 's' : ''}${pending > 0 ? ` + ${pending} Upcoming Start${pending !== 1 ? 's' : ''}` : ''}`,
      desc: `${offerCount} in Offer stage${pending > 0 ? `, ${pending} accepted offer${pending !== 1 ? 's' : ''} with future start dates (through Jul 31)` : ''}. IR pipeline (${latestIR}) feeding offer stage.`
    }
  ];
}

function renderRisks(proj) {
  const risks = computeRisks(proj);
  const el = document.getElementById('risksContainer');
  if (!el) return;
  el.innerHTML = risks.map(r =>
    `<div class="risk-card ${r.level}"><div class="risk-icon">${r.icon}</div><div><div class="risk-title">${r.title}</div><div class="risk-desc">${r.desc}</div></div></div>`
  ).join('');
}

// ── Insight strip (top of team overview) — real per-team risk + win ──
function renderInsightStrip(proj) {
  const deadlineEl = document.getElementById('insightDeadlineText');
  if (deadlineEl) deadlineEl.textContent = `${daysRemaining} days left in Q1`;

  const riskTextEl = document.getElementById('insightRiskText');
  const riskSubEl  = document.getElementById('insightRiskSub');
  if (riskTextEl) {
    const risks = computeRisks(proj);
    const worst = risks.slice().sort((a, b) => (RISK_LEVEL_RANK[a.level] ?? 9) - (RISK_LEVEL_RANK[b.level] ?? 9))[0];
    riskTextEl.textContent = worst.title;
    if (riskSubEl) riskSubEl.textContent = worst.desc;
  }

  const winTextEl = document.getElementById('insightWinText');
  const winSubEl  = document.getElementById('insightWinSub');
  if (winTextEl) {
    const perfect = RECRUITERS.filter(r => (r.extended || 0) > 0 && r.oar === 100).map(r => r.name);
    const stats = aggregateTeamStats();
    if (perfect.length > 0) {
      winTextEl.textContent = perfect.length === 1 ? `${perfect[0]} at 100% OAR` : `${perfect.length} recruiters at 100% OAR`;
      if (winSubEl) winSubEl.textContent = `${perfect.join(', ')} — no Q1 declines.`;
    } else if (stats.oarPct != null && stats.oarPct >= 90) {
      winTextEl.textContent = `${_TC.name} OAR at ${stats.oarPct}%`;
      if (winSubEl) winSubEl.textContent = `${stats.totalAcc}/${stats.totalExt} offers accepted this quarter — strong close rate.`;
    } else if (HAS_GOAL && proj.gap <= 0) {
      winTextEl.textContent = 'On pace to hit Q1 goal';
      if (winSubEl) winSubEl.textContent = `Projected to meet or exceed the ${FALLBACK.q1Goal}-hire goal at current pace.`;
    } else {
      winTextEl.textContent = HAS_GOAL
        ? `${FALLBACK.acceptedTotal}/${FALLBACK.q1Goal} FTE hires confirmed`
        : `${FALLBACK.acceptedTotal} FTE hires confirmed`;
      if (winSubEl) winSubEl.textContent = 'No stand-out win flagged yet this quarter — check back as more offers resolve.';
    }
  }
}

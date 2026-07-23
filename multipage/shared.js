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

// ── Analysis notes (Projection / Funnel / OAR-by-level / Decline pattern) ──
// All four were static HTML strings quoting Engineering's own Q1 numbers,
// copy-pasted onto every team's page with no element ID — so every team
// (GTM, CX, SpecTech, Foundation, Engineering) showed the identical "~43
// FTE, 11-hire gap, L4 at 56%, 18 closes/month" text regardless of that
// team's actual data. Wiring them here makes each one read from this
// team's own live-computed proj/stats instead.
function renderAnalysisNotes(proj) {
  // Projection card
  const projNote = document.getElementById('projectionNote');
  if (projNote) {
    if (!HAS_GOAL) {
      projNote.className = 'analysis-note';
      projNote.innerHTML = `<strong>No Q1 goal set:</strong> Base scenario projects ~${proj.total} FTE for ${_TC.name} this quarter. Set a Q1 goal to see gap-to-goal tracking here.`;
    } else if (proj.gap > 0) {
      projNote.className = 'analysis-note risk';
      projNote.innerHTML = `<strong>⚠ Risk:</strong> Base scenario projects ~${proj.total} FTE — a ${proj.gap}-hire gap to goal. Closing the gap requires accelerating offer volume significantly.`;
    } else {
      projNote.className = 'analysis-note';
      projNote.innerHTML = `<strong>✅ On track:</strong> Base scenario projects ~${proj.total} FTE, at or above the ${FALLBACK.q1Goal}-hire goal.`;
    }
  }

  // Funnel bottleneck note
  const funnelNote = document.getElementById('funnelNote');
  if (funnelNote) {
    const offerCount = currentOfferCount();
    const irCount = currentIRCount();
    const irMin = Math.min(...FALLBACK.pipeline.ir);
    const paceBit = HAS_GOAL ? ` against a pace requiring ~${proj.paceNeeded.toFixed(1)} closes/month` : '';
    funnelNote.innerHTML = `<strong>${offerCount < 6 ? '⚠ Bottleneck' : 'Funnel'}:</strong> ${offerCount} active offer${offerCount !== 1 ? 's' : ''}${paceBit}. ` +
      (irCount <= irMin ? `IR pool is at a multi-week low.` : `IR pipeline currently at ${irCount}.`);
  }

  // OAR-by-level note — only meaningful when a level split actually exists;
  // otherwise the container above already explains why it's showing overall
  // OAR instead, so leave this one hidden rather than duplicate/contradict it.
  const oarNote = document.getElementById('oarByLevelNote');
  if (oarNote) {
    const stats = aggregateTeamStats();
    const levelEntries = Object.entries(stats.levels).filter(([, d]) => d.extended > 0);
    if (levelEntries.length === 0) {
      oarNote.style.display = 'none';
    } else {
      oarNote.style.display = '';
      const [worstLvl, worstD] = levelEntries.reduce((min, cur) => cur[1].oar < min[1].oar ? cur : min);
      if (worstD.oar >= 85) {
        oarNote.className = 'analysis-note';
        oarNote.innerHTML = `<strong>On track:</strong> Every level is at or above 85% OAR — lowest is ${worstLvl} at ${worstD.oar}%.`;
      } else {
        oarNote.className = 'analysis-note risk';
        oarNote.innerHTML = `<strong>⚠ Critical — ${worstLvl}:</strong> ${worstD.oar}% OAR (${worstD.accepted}/${worstD.extended}) is the lowest of any level for ${_TC.name} this quarter. This is the highest-leverage level to address.`;
      }
    }
  }

  // Decline pattern note — this chart is broken out by recruiter (not level,
  // per the comment in renderDeclineSection above), so describe the pattern
  // in those same terms instead of the old level-based Engineering text.
  const patternNote = document.getElementById('declinePatternNote');
  if (patternNote) {
    const stats = aggregateTeamStats();
    if (stats.totalDeclines === 0) {
      patternNote.innerHTML = `<strong>Pattern:</strong> No declines recorded for ${_TC.name} in Q1.`;
    } else {
      const recruitersWithDeclines = RECRUITERS.filter(r => r.declines && r.declines.length).length;
      const [topReason, topCount] = stats.reasonList[0];
      const topPct = Math.round(topCount / stats.totalDeclines * 100);
      patternNote.innerHTML = `<strong>Pattern:</strong> "${topReason}" accounts for ${topPct}% (${topCount} of ${stats.totalDeclines}) of Q1 ${_TC.name} declines, spread across ${recruitersWithDeclines} recruiter${recruitersWithDeclines !== 1 ? 's' : ''}.`;
    }
  }
}

// ── Slider baselines ──────────────────────────────────────────────
// Syncs each what-if slider's starting position/label to this team's actual
// FALLBACK/RECRUITERS-derived baseline instead of a number typed into the
// shared HTML template once (85% / 9 / 1.44 for every team regardless of
// that team's real recruiter count). Run once at init().
function syncSliderBaselines() {
  const oarPct = Math.round(FALLBACK.baseOAR * 100);
  const rec = FALLBACK.baseRecruiterCount;
  const ppr = FALLBACK.basePPR;

  const oarSlider = document.getElementById('oarSlider');
  if (oarSlider) oarSlider.value = oarPct;
  const oarCurrentLabel = document.getElementById('oarCurrentLabel');
  if (oarCurrentLabel) oarCurrentLabel.textContent = oarPct + '%';
  const oarSliderVal = document.getElementById('oarSliderVal');
  if (oarSliderVal) oarSliderVal.textContent = oarPct + '%';

  const recSlider = document.getElementById('recSlider');
  if (recSlider) recSlider.value = rec;
  const recCurrentLabel = document.getElementById('recCurrentLabel');
  if (recCurrentLabel) recCurrentLabel.textContent = rec;
  const recSliderVal = document.getElementById('recSliderVal');
  if (recSliderVal) recSliderVal.textContent = rec;

  const pprSlider = document.getElementById('pprSlider');
  if (pprSlider) pprSlider.value = ppr;
  const pprCurrentLabel = document.getElementById('pprCurrentLabel');
  if (pprCurrentLabel) pprCurrentLabel.textContent = ppr.toFixed(2);
  const pprSliderVal = document.getElementById('pprSliderVal');
  if (pprSliderVal) pprSliderVal.textContent = ppr.toFixed(2);
}

// ── Update KPIs ────────────────────────────────────────────────────
function updateKPIs(proj) {
  const goal = FALLBACK.q1Goal;
  const accepted = FALLBACK.acceptedTotal;
  const started  = FALLBACK.hiresQ1ToDate;
  const pending  = FALLBACK.acceptedPending;

  // ── Team status card header ──────────────────────────────────────
  document.getElementById('teamDaysHeader').textContent = daysRemaining;
  document.getElementById('teamPctHeader').textContent = pctThrough;
  if (HAS_GOAL) {
    const stillLeft0 = Math.max(0, goal - accepted);
    document.getElementById('teamGoalSummary').textContent =
      stillLeft0 === 0 ? `✓ Goal covered by accepted offers` : `${accepted} accepted · ${stillLeft0} more needed by Jul 31`;
  } else {
    document.getElementById('teamGoalSummary').textContent = `${accepted} accepted this quarter · no Q1 goal set yet`;
  }
  const remaining0 = proj.total - started;
  document.getElementById('teamProjBreakdown').textContent = `${started} accepted + ~${Math.max(0,remaining0)} projected = ${proj.total}`;

  // Goal card — progress bar
  if (HAS_GOAL) {
    const confirmedPct = Math.round(accepted / goal * 100);
    const barColor = confirmedPct >= 90 ? '#00B094' : confirmedPct >= 60 ? '#F5A623' : '#F45D48';
    document.getElementById('goalBar').style.width = Math.min(100, confirmedPct) + '%';
    document.getElementById('goalBar').style.background = barColor;
    document.getElementById('goalPct').textContent = confirmedPct + '% of goal accepted in Q1';
    document.getElementById('goalPct').style.color = barColor;
    const stillNeeded = Math.max(0, goal - accepted);
    document.getElementById('goalNote').textContent = `${accepted} accepted in Q1 · ${stillNeeded} more needed by Jul 31`;
  } else {
    document.getElementById('goalBar').style.width = '0%';
    document.getElementById('goalBar').style.background = '#B8B0A8';
    document.getElementById('goalPct').textContent = 'No Q1 goal set yet';
    document.getElementById('goalPct').style.color = '#8A8078';
    document.getElementById('goalNote').textContent = `${accepted} accepted in Q1 — goal not yet assigned for ${_TC.name}`;
  }

  // Projected card
  if (HAS_GOAL) {
    const projPct = Math.round(proj.total / goal * 100);
    const projColor = proj.total >= goal ? '#00B094' : proj.total >= Math.round(goal * 0.9) ? '#F5A623' : '#F45D48';
    document.getElementById('kpiProjected').textContent = proj.total;
    document.getElementById('kpiProjected').style.color = projColor;
    document.getElementById('kpiGapLabel').innerHTML = proj.gap > 0
      ? `<span class="kpi-badge badge-red">−${proj.gap} FTE vs goal</span>`
      : `<span class="kpi-badge badge-green">On target</span>`;
    document.getElementById('kpiProjectedNote').textContent =
      `${projPct}% to goal · ${proj.gap > 0 ? `${proj.gap} hire${proj.gap > 1 ? 's' : ''} short at current pace` : 'Goal within reach at base pace'}`;
  } else {
    document.getElementById('kpiProjected').textContent = proj.total;
    document.getElementById('kpiProjected').style.color = '#222525';
    document.getElementById('kpiGapLabel').innerHTML = `<span class="kpi-badge">No goal set</span>`;
    document.getElementById('kpiProjectedNote').textContent = `Projected FTE hires this quarter at current pace — no Q1 goal set yet for ${_TC.name}`;
  }

  // Accepted pace insight (dynamic — only show once live data is available)
  const watchAcc = document.getElementById('watchAccepted');
  if (watchAcc && accepted > 0 && FALLBACK.acceptedMay > 0) {
    const junCount = FALLBACK.acceptedJun;
    const mayCount = FALLBACK.acceptedMay;
    if (junCount > 0 && mayCount > 0) {
      const pctDiff = Math.round((junCount - mayCount) / mayCount * 100);
      if (pctDiff < -30) {
        watchAcc.className = 'analysis-note risk';
        watchAcc.innerHTML = `<strong>⚠ Watch:</strong> Jun pace (${junCount}) is ${Math.abs(pctDiff)}% below May (${mayCount}). Confirm timing lag vs. slowdown.`;
      } else if (pctDiff > 20) {
        watchAcc.className = 'analysis-note ok';
        watchAcc.innerHTML = `<strong>✓ Accelerating:</strong> Jun (${junCount}) is ahead of May (${mayCount}) pace.`;
      } else {
        watchAcc.className = 'analysis-note';
        watchAcc.innerHTML = `May: ${mayCount} · Jun: ${junCount} · pace consistent`;
      }
    }
  }

  // Pace card (may be absent from team view; paceNeeded is null without a goal)
  const kpiPaceEl = document.getElementById('kpiPace');
  if (kpiPaceEl && HAS_GOAL) {
    const paceRatio = Math.round(proj.baseMonthly / proj.paceNeeded * 100);
    kpiPaceEl.textContent = proj.baseMonthly.toFixed(1) + '/mo';
    kpiPaceEl.style.color = proj.baseMonthly >= proj.paceNeeded ? '#00B094' : proj.baseMonthly >= proj.paceNeeded * 0.8 ? '#F5A623' : '#F45D48';
    const kpiPaceNeeded = document.getElementById('kpiPaceNeeded');
    if (kpiPaceNeeded) kpiPaceNeeded.textContent = `Need ${proj.paceNeeded.toFixed(1)}/mo to hit goal`;
    const kpiPaceNote = document.getElementById('kpiPaceNote');
    if (kpiPaceNote) kpiPaceNote.textContent = `${paceRatio}% of needed pace · 9 recruiters × 1.44 PPR`;
  } else if (kpiPaceEl) {
    kpiPaceEl.textContent = proj.baseMonthly.toFixed(1) + '/mo';
    const kpiPaceNeeded = document.getElementById('kpiPaceNeeded');
    if (kpiPaceNeeded) kpiPaceNeeded.textContent = 'No Q1 goal set yet';
  }

  // Days card (may be absent from team view; goal-based "remaining needed" only applies with a goal)
  const hiresWithPipeline = started + pending;
  const remainingAfterPipeline = HAS_GOAL ? Math.max(0, goal - hiresWithPipeline) : null;
  const kpiDaysEl = document.getElementById('kpiDays');
  if (kpiDaysEl) {
    kpiDaysEl.textContent = daysRemaining;
    const kpiDaysPct = document.getElementById('kpiDaysPct');
    if (kpiDaysPct) kpiDaysPct.textContent = `${pctThrough}% of Q1 elapsed`;
  }
  
  // Team OAR
  const teamOAREl = document.getElementById('teamOARVal');
  const teamOARNote = document.getElementById('teamOARNote');
  const teamOARWatch = document.getElementById('watchOAR');
  if (teamOAREl) {
    const stats = aggregateTeamStats();
    const oarPct = stats.oarPct != null ? stats.oarPct : 0;
    teamOAREl.textContent = stats.oarPct != null ? oarPct+'%' : '–';
    teamOAREl.style.color = oarPct>=90?'var(--green)':oarPct>=75?'var(--yellow)':'var(--red)';
    if (teamOARNote) teamOARNote.textContent = stats.totalExt>0 ? stats.totalAcc+'/'+stats.totalExt+' offers accepted' : 'No offers extended yet';
    if (teamOARWatch && stats.totalExt>0 && oarPct<75) teamOARWatch.innerHTML='<strong>⚠ Watch:</strong> OAR below 75% threshold — comp bands driving declines.';
  }

  const kpiDaysNote = document.getElementById('kpiDaysNote');
  if (kpiDaysNote) kpiDaysNote.textContent = HAS_GOAL
    ? `${hiresWithPipeline} confirmed · ${remainingAfterPipeline} more needed in ${daysRemaining}d`
    : `${hiresWithPipeline} confirmed · no Q1 goal set yet`;

  // ── Dynamic analysis notes ────────────────────────────────────────
  // Guarded like watchPace/watchDays below — #watchGoal/#watchProjected don't
  // exist on any of the 5 team pages (including Engineering's), so calling
  // .className on them unconditionally threw and aborted the rest of this
  // function every time live data loaded, before it could reach the OAR-by-
  // level / decline-reasons / accepted-offers-count updates further down.
  const goalW = document.getElementById('watchGoal');
  if (goalW && HAS_GOAL) {
    const stillLeft = Math.max(0, goal - accepted);
    if (stillLeft === 0) {
      goalW.className = 'analysis-note ok';
      goalW.innerHTML = '<strong>✓ On track:</strong> Goal is covered by accepted offers.';
    } else if (accepted / goal >= 0.6) {
      goalW.className = 'analysis-note';
      goalW.innerHTML = `<strong>Watch:</strong> ${stillLeft} more offers need to be accepted before Jul 31 to hit goal. Focus on converting active pipeline to offers in June.`;
    } else {
      goalW.className = 'analysis-note risk';
      goalW.innerHTML = `<strong>⚠ At risk:</strong> Only ${Math.round(accepted/goal*100)}% of goal confirmed. Requires ${stillLeft} more accepts in ${daysRemaining} days — a significant acceleration from current pace.`;
    }
  }

  const projW = document.getElementById('watchProjected');
  if (projW && HAS_GOAL) {
    if (proj.gap <= 0) {
      projW.className = 'analysis-note ok';
      projW.innerHTML = '<strong>✓ On pace:</strong> Base projection meets or exceeds goal at current recruiter count and OAR.';
    } else if (proj.gap <= 5) {
      projW.className = 'analysis-note';
      projW.innerHTML = `<strong>Watch:</strong> ${proj.gap}-hire gap is closable — improving OAR by ~5pp or adding one recruiter brings projection to goal.`;
    } else {
      projW.className = 'analysis-note risk';
      projW.innerHTML = `<strong>⚠ At risk:</strong> ${proj.gap}-hire gap requires meaningful intervention. Use the what-if sliders below to model scenarios.`;
    }
  }

  const paceW = document.getElementById('watchPace');
  if (paceW && HAS_GOAL) {
    const paceRatio2 = proj.baseMonthly / proj.paceNeeded;
    if (paceRatio2 >= 1) {
      paceW.className = 'analysis-note ok';
      paceW.innerHTML = '<strong>✓ Sufficient pace:</strong> Current monthly rate is enough to close the quarter on goal.';
    } else if (paceRatio2 >= 0.8) {
      paceW.className = 'analysis-note';
      paceW.innerHTML = `<strong>Watch:</strong> Current pace is ${Math.round(paceRatio2*100)}% of what's needed. A modest OAR improvement or pipeline push in June could close the gap.`;
    } else {
      paceW.className = 'analysis-note risk';
      paceW.innerHTML = `<strong>⚠ Below pace:</strong> Running at ${Math.round(paceRatio2*100)}% of required rate. Without acceleration, Q1 will fall short regardless of pipeline volume.`;
    }
  }

  const daysW = document.getElementById('watchDays');
  if (daysW && HAS_GOAL) {
    const impliedMonthlyNeeded = daysRemaining > 0 ? remainingAfterPipeline / (daysRemaining / 30) : 0;
    if (remainingAfterPipeline <= 0) {
      daysW.className = 'analysis-note ok';
      daysW.innerHTML = '<strong>✓ Pipeline covers goal:</strong> Confirmed + pending starts are sufficient to hit 46.';
    } else if (impliedMonthlyNeeded <= proj.baseMonthly * 1.2) {
      daysW.className = 'analysis-note';
      daysW.innerHTML = `<strong>Watch:</strong> Need ${remainingAfterPipeline} more hires in ${daysRemaining}d (~${impliedMonthlyNeeded.toFixed(1)}/mo). Achievable if July offer pace improves.`;
    } else {
      daysW.className = 'analysis-note risk';
      daysW.innerHTML = `<strong>⚠ Urgent:</strong> Need ${remainingAfterPipeline} more hires in ${daysRemaining}d. Implied pace of ${impliedMonthlyNeeded.toFixed(1)}/mo is ${Math.round(impliedMonthlyNeeded/proj.baseMonthly*100)}% above current capacity.`;
    }
  }
}

// ── What-if display ────────────────────────────────────────────────
function updateWhatIfDisplay(oar, rec, ppr) {
  const proj = computeProjection(oar, rec, ppr);
  const goal = FALLBACK.q1Goal;

  document.getElementById('wiMonthlyPace').textContent = proj.baseMonthly.toFixed(1) + '/mo';
  document.getElementById('wiHiresRemaining').textContent = proj.remaining;
  document.getElementById('wiTotal').textContent = proj.total;

  if (!HAS_GOAL) {
    // No Q1 goal set for this team — show pace/projection without any
    // gap-to-goal framing, instead of dividing by a null goal.
    const wiGapLabelEl = document.getElementById('wiGapLabel');
    if (wiGapLabelEl) wiGapLabelEl.textContent = 'Gap to Goal (no goal set)';
    document.getElementById('wiMonthlyPace').style.color = '#222525';
    document.getElementById('wiTotal').style.color = '#222525';
    document.getElementById('kpiProjected').textContent = proj.total;
    document.getElementById('kpiProjected').style.color = '#222525';
    document.getElementById('kpiProjectedNote').textContent = `Projected FTE hires this quarter at current pace — no Q1 goal set yet for ${_TC.name}`;
    const remaining1b = proj.total - FALLBACK.hiresQ1ToDate;
    document.getElementById('teamProjBreakdown').textContent = `${FALLBACK.hiresQ1ToDate} started + ~${Math.max(0,remaining1b)} projected = ${proj.total}`;
    const wiGapEl = document.getElementById('wiGap');
    if (wiGapEl) { wiGapEl.textContent = 'N/A'; wiGapEl.style.color = '#8A8078'; }
    return;
  }

  const projPct = Math.round(proj.total / goal * 100);
  const projColor = proj.total >= goal ? '#00B094' : proj.total >= goal * 0.9 ? '#F5A623' : '#F45D48';

  const wiGapLabelEl = document.getElementById('wiGapLabel');
  if (wiGapLabelEl) wiGapLabelEl.textContent = `Gap to Goal (${goal})`;

  document.getElementById('wiMonthlyPace').style.color = proj.baseMonthly >= proj.paceNeeded ? '#00B094' : proj.baseMonthly >= proj.paceNeeded * 0.8 ? '#F5A623' : '#F45D48';
  document.getElementById('wiTotal').style.color = projColor;

  // Also update projected KPI + breakdown live
  document.getElementById('kpiProjected').textContent = proj.total;
  document.getElementById('kpiProjected').style.color = projColor;
  document.getElementById('kpiProjectedNote').textContent =
    `${projPct}% to goal · ${proj.gap > 0 ? `${proj.gap} hire${proj.gap > 1 ? 's' : ''} short at current pace` : 'Goal within reach'}`;
  const remaining1 = proj.total - FALLBACK.hiresQ1ToDate;
  document.getElementById('teamProjBreakdown').textContent = `${FALLBACK.hiresQ1ToDate} started + ~${Math.max(0,remaining1)} projected = ${proj.total}`;
  const paceRatio = Math.round(proj.baseMonthly / proj.paceNeeded * 100);
  const kpiPaceEl2 = document.getElementById('kpiPace');
  if (kpiPaceEl2) {
    kpiPaceEl2.textContent = proj.baseMonthly.toFixed(1) + '/mo';
    kpiPaceEl2.style.color = proj.baseMonthly >= proj.paceNeeded ? '#00B094' : proj.baseMonthly >= proj.paceNeeded * 0.8 ? '#F5A623' : '#F45D48';
    const kpiPaceNote2 = document.getElementById('kpiPaceNote');
    if (kpiPaceNote2) kpiPaceNote2.textContent = `${paceRatio}% of needed pace · ${rec} recruiters × ${ppr.toFixed(2)} PPR`;
  }

  if (proj.gap > 0) { document.getElementById('wiGap').textContent = '−' + proj.gap; document.getElementById('wiGap').style.color = '#F45D48'; }
  else { document.getElementById('wiGap').textContent = '+' + Math.abs(proj.gap); document.getElementById('wiGap').style.color = '#00B094'; }
}

// ── Slider handler ─────────────────────────────────────────────────
function onSliderChange() {
  const oar = parseInt(document.getElementById('oarSlider').value) / 100;
  const rec = parseInt(document.getElementById('recSlider').value);
  const ppr = parseFloat(document.getElementById('pprSlider').value);
  document.getElementById('oarSliderVal').textContent = (oar*100).toFixed(0) + '%';
  document.getElementById('recSliderVal').textContent = rec;
  document.getElementById('pprSliderVal').textContent = ppr.toFixed(2);
  const oarDelta = ((oar - FALLBACK.baseOAR) * 100).toFixed(0);
  document.getElementById('oarImpact').textContent = oarDelta > 0 ? `↑ ${oarDelta}pp above baseline` : oarDelta < 0 ? `↓ ${Math.abs(oarDelta)}pp below baseline` : 'Baseline OAR';
  const recDelta = rec - FALLBACK.baseRecruiterCount;
  document.getElementById('recImpact').textContent = recDelta !== 0 ? `${recDelta > 0 ? '+' : ''}${recDelta} vs baseline · ~${Math.abs(Math.round(recDelta * ppr * monthsLeft))} Q1 hire impact` : 'Baseline recruiter count';
  updateWhatIfDisplay(oar, rec, ppr);
  renderGauge(computeHealth(oar, rec, ppr));
  renderRisks(computeProjection(oar, rec, ppr));
  renderInsightStrip(computeProjection(oar, rec, ppr));
  renderProjectionChart(oar, rec, ppr);
}

// ── Scenario selector ──────────────────────────────────────────────
function setScenario(scenario, el) {
  currentScenario = scenario;
  document.querySelectorAll('.scenario-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const oar = parseInt(document.getElementById('oarSlider').value) / 100;
  const rec = parseInt(document.getElementById('recSlider').value);
  const ppr = parseFloat(document.getElementById('pprSlider').value);
  renderProjectionChart(oar, rec, ppr);
}

// ── Dual-mode data fetching (Cowork MCP or Apps Script JSONP) ────────
// Standalone (GitHub Pages) fetches each sheet individually via ?sheet=
// parameter — avoids combined response size limits and isolates failures.
const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/gusto.com/s/AKfycbw1GDnQXS_r7ZG2zGyU8w7jjqi6GUzqfHOCzMirkb4jnbOeKQd7GUL2MizKI-soLGA/exec';
var _sheetCache = {};   // sheetName → resolved rows array
var _sheetFetches = {}; // sheetName → in-flight Promise

function fetchSheetFromAppsScript(sheetName) {
  if (_sheetCache[sheetName]) return Promise.resolve(_sheetCache[sheetName]);
  if (_sheetFetches[sheetName]) return _sheetFetches[sheetName];
  _sheetFetches[sheetName] = new Promise((resolve, reject) => {
    const cbName = '_gscb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      delete window[cbName];
      try { document.head.removeChild(script); } catch(e) {}
      delete _sheetFetches[sheetName];
      reject(new Error('Apps Script timed out — make sure you are signed into your Gusto Google account in this browser'));
    }, 25000);
    window[cbName] = (data) => {
      clearTimeout(timer);
      delete window[cbName];
      try { document.head.removeChild(script); } catch(e) {}
      const rows = data[sheetName] || [];
      _sheetCache[sheetName] = rows;
      delete _sheetFetches[sheetName];
      console.log(`[AppsScript] Loaded "${sheetName}": ${rows.length} rows`);
      resolve(rows);
    };
    script.onerror = () => {
      clearTimeout(timer);
      delete window[cbName];
      delete _sheetFetches[sheetName];
      reject(new Error('Apps Script failed — make sure you are signed into your Gusto Google account in this browser'));
    };
    script.src = `${APPS_SCRIPT_URL}?callback=${cbName}&sheet=${encodeURIComponent(sheetName)}`;
    document.head.appendChild(script);
  });
  return _sheetFetches[sheetName];
}

function arrayToTSV(rows) {
  return rows.map(row => row.map(cell => {
    if (cell == null) return '';
    // Date object (direct from getValues in Cowork/local context)
    if (cell instanceof Date) {
      return `${cell.getMonth()+1}/${cell.getDate()}/${cell.getFullYear()}`;
    }
    // ISO string — JSON.stringify converts Date objects to ISO strings,
    // so JSONP callbacks receive "2026-05-07T07:00:00.000Z" not a Date object
    if (typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(cell)) {
      const d = new Date(cell);
      if (!isNaN(d.getTime())) return `${d.getUTCMonth()+1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    }
    return String(cell);
  }).join('\t')).join('\n');
}

function parseCSVToTSV(csv) {
  const rows = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  for (const rowStr of rows) {
    if (!rowStr.trim()) continue;
    const cols = [];
    let field = '', inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const ch = rowStr[i], nx = rowStr[i+1];
      if (inQuotes) {
        if (ch === '"' && nx === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { cols.push(field); field = ''; }
        else { field += ch; }
      }
    }
    cols.push(field);
    if (cols.some(c => c.length)) result.push(cols.join('\t'));
  }
  return result.join('\n');
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]);
}

async function fetchSheetRows(sheetName) {
  if (window.cowork && window.cowork.callMcpTool) {
    // Inside Cowork — use MCP connector (12s timeout so we never hang forever)
    const res = await withTimeout(
      window.cowork.callMcpTool(TOOL, {
        spreadsheet_id: PIPELINE_SHEET,
        range: `${sheetName}!A1:Z500`,
        include_hidden_rows: false
      }),
      12000
    );
    return extractSheetContent(res);
  }
  // Standalone (GitHub Pages) — per-sheet Apps Script JSONP fetch
  const rows = await fetchSheetFromAppsScript(sheetName);
  if (!rows || rows.length === 0) throw new Error(`Sheet "${sheetName}" returned no data`);
  return arrayToTSV(rows);
}

async function fetchAcceptedOffers() {
  try {
    const txt = await fetchSheetRows('Offers');
    console.log('[Offers] txt length:', txt ? txt.length : 'null');
    if (!txt || txt.length < 100) { console.warn('[Offers] txt too short, aborting'); return; }
    const rows = lines(txt);
    console.log('[Offers] row count:', rows.length, '| first row sample:', rows[0] && rows[0].slice(0,3));
    let headerIdx = -1, statCol = -1, resCol = -1, jobCol = -1,
        candCol = -1, firstCol = -1, lastCol = -1, reqIdCol = -1, recCol = -1, startCol = -1, appIdCol = -1,
        declReasonCol = -1, lvlCol = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some(c => /^status/i.test(c)) && rows[i].includes('Resolved')) {
        headerIdx = i;
        const h = rows[i];
        statCol       = h.findIndex(c => /^status/i.test(c));
        resCol        = h.indexOf('Resolved');
        jobCol        = h.findIndex(c => /^job/i.test(c));
        candCol       = h.indexOf('Candidate');
        firstCol      = h.indexOf('First Name');
        lastCol       = h.indexOf('Last Name');
        reqIdCol      = h.indexOf('Requisition ID');
        recCol        = h.indexOf('Recruiter');
        startCol      = h.findIndex(c => /^start date/i.test(c));
        appIdCol      = h.indexOf('Application ID');
        declReasonCol = h.findIndex(c => /decline.?reason/i.test(c) || /reason.?declin/i.test(c) || /rejection.?reason/i.test(c));
        lvlCol        = h.findIndex(c => /^level$/i.test(c) || /job.?level/i.test(c) || /^grade$/i.test(c) || /^level anchor$/i.test(c));
        break;
      }
    }
    console.log('[Offers] headerIdx:', headerIdx, '| statCol:', statCol, '| resCol:', resCol, '| recCol:', recCol);
    if (headerIdx < 0) { console.error('[Offers] Header row not found — aborting'); return; }

    const isNonFTE = t => /\bintern\b/.test(t) || /apprentice/.test(t) || /temporary/.test(t);
    const today  = new Date(); today.setHours(0,0,0,0);
    const q1End  = new Date(2026, 6, 31); // Jul 31 2026
    const teamRecruiterNames = new Set(RECRUITERS.map(r => r.name));

    let total = 0, may = 0, jun = 0, jul = 0, startedCount = 0, pendingCount = 0;
    window._acceptedOffersList = [];

    // Per-recruiter live tracking { accepted, extended, byLevel:{L4:{acc,ext}}, declReasons:{reason:count} }
    const recLive = {};
    // Quarterly history buckets (this team's own recruiters only) { label → {accepted, extended} }
    const qBuckets = {};

    let _dbg = 0, _dbgSkipStatus=0, _dbgSkipNonFTE=0, _dbgSkipDate=0, _dbgSkipYr=0;
    for (const row of rows.slice(headerIdx + 1)) {
      const status = (row[statCol] || '').trim();
      if (!status) { _dbgSkipStatus++; continue; }
      const jobStr   = (row[jobCol] || '').trim();
      const jobTitle = jobStr.toLowerCase();
      if (isNonFTE(jobTitle)) { _dbgSkipNonFTE++; continue; }
      const rd = row[resCol];
      let mo = 0, yr = 0;
      if (rd != null && rd !== '') {
        const s = String(rd);
        let _m;
        if ((_m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
          mo = +_m[1]; yr = +_m[3];
        } else if ((_m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
          mo = +_m[2]; yr = +_m[1];
        } else {
          const n = Number(rd);
          if (!isNaN(n) && n > 40000) {
            const _d = new Date(Math.round((n - 25569) * 86400000));
            mo = _d.getUTCMonth()+1; yr = _d.getUTCFullYear();
          }
        }
      }
      if (_dbg < 3) console.log(`[Offers] row debug v2: status="${status}" rd="${rd}" rdType=${typeof rd} mo=${mo} yr=${yr} job="${jobStr.slice(0,30)}"`);
      _dbg++;
      if (!mo || !yr) { _dbgSkipDate++; continue; }
      if (!(yr === 2025 || yr === 2026)) { _dbgSkipYr++; }
      // Accept 2025-2026 data for history; 2026 Q1 FY27 for current quarter
      if (!(yr === 2025 || yr === 2026)) continue;

      const recruiter = recCol >= 0 ? (row[recCol] || '').trim() : '';

      // Quarterly history — this team's own recruiters only
      const fqLabel = getFQLabel(mo, yr);
      if (fqLabel && teamRecruiterNames.has(recruiter)) {
        if (!qBuckets[fqLabel]) qBuckets[fqLabel] = { accepted: 0, extended: 0 };
        if (status === 'Accepted') qBuckets[fqLabel].accepted++;
        qBuckets[fqLabel].extended++; // count all extended (Accepted + Declined + etc.)
      }

      // Current Q1 FY27 data — proceed with existing logic
      if (!(yr === 2026 && mo >= 5 && mo <= 7)) continue;
      // Derive level from dedicated column or job title
      let levelKey = lvlCol >= 0 ? (row[lvlCol] || '').trim() : '';
      if (!levelKey) {
        const m = jobStr.match(/\b(L[1-9])\b/i);
        if (m) levelKey = m[1].toUpperCase();
      }

      if (recruiter && !recLive[recruiter])
        recLive[recruiter] = { accepted:0, extended:0, byLevel:{}, declReasons:{} };

      // Team-scoped totals/list — only count offers owned by this team's recruiters
      if (!teamRecruiterNames.has(recruiter)) continue;

      if (status === 'Accepted') {
        total++;
        if (mo === 5) may++; else if (mo === 6) jun++; else jul++;
        // Count all accepted offers (by accept date, not start date)
        startedCount = total; // updated each iteration; final value = total accepted

        if (recruiter) {
          recLive[recruiter].accepted++;
          recLive[recruiter].extended++;
          if (levelKey) {
            if (!recLive[recruiter].byLevel[levelKey]) recLive[recruiter].byLevel[levelKey] = {acc:0,ext:0};
            recLive[recruiter].byLevel[levelKey].acc++;
            recLive[recruiter].byLevel[levelKey].ext++;
          }
        }

        const candidateName = candCol >= 0
          ? (row[candCol] || '').trim()
          : `${firstCol >= 0 ? (row[firstCol] || '').trim() : ''} ${lastCol >= 0 ? (row[lastCol] || '').trim() : ''}`.trim();
        window._acceptedOffersList.push({
          candidate: candidateName,
          reqId:     reqIdCol >= 0 ? (row[reqIdCol] || '').trim() : '',
          appId:     appIdCol >= 0 ? (row[appIdCol] || '').toString().trim() : '',
          job:       jobStr,
          recruiter,
          resolved:  rd,
          startDate: startCol >= 0 ? (row[startCol] || '').trim() : '',
        });
      } else if (status === 'Rejected' || status === 'Declined') {
        // Resolved-but-declined offer. "Deprecated"/"Sent" rows are intentionally
        // excluded here — Deprecated rows are superseded duplicate versions of an
        // offer that also has a final Accepted/Rejected row (counting them would
        // double-count the same real offer), and "Sent" offers haven't resolved yet.
        if (recruiter) {
          recLive[recruiter].extended++;
          if (levelKey) {
            if (!recLive[recruiter].byLevel[levelKey]) recLive[recruiter].byLevel[levelKey] = {acc:0,ext:0};
            recLive[recruiter].byLevel[levelKey].ext++;
          }
          if (declReasonCol >= 0) {
            const reason = (row[declReasonCol] || '').trim();
            if (reason) recLive[recruiter].declReasons[reason] = (recLive[recruiter].declReasons[reason] || 0) + 1;
          }
        }
      }
      // else: Deprecated / Sent / other non-resolved statuses — skip, not a resolved offer
    }

    // Sort accepted list by date desc
    const toMs = d => { const p = (d||'').split('/'); return p.length===3 ? new Date(+p[2],+p[0]-1,+p[1]).getTime() : 0; };
    window._acceptedOffersList.sort((a, b) => toMs(b.resolved) - toMs(a.resolved));

    // Pending starts = accepted offers (this team only) whose start date hasn't
    // arrived yet — computed from real start dates, not a frozen seed number.
    const todayMs = today.getTime();
    pendingCount = window._acceptedOffersList.filter(a => {
      const ms = toMs(a.startDate);
      return ms > 0 && ms > todayMs;
    }).length;

    console.log('[Offers] loop done — total:', total, 'skipStatus:', _dbgSkipStatus, 'skipNonFTE:', _dbgSkipNonFTE, 'skipDate:', _dbgSkipDate, 'skipYr:', _dbgSkipYr, 'passed:', _dbg);
    // ── Build quarterly history from live data (this team's recruiters only) ────
    const histLabels = [], histAccepted = [], histExtended = [];
    for (const ql of HISTORY_QUARTERS) {
      const b = qBuckets[ql];
      if (b && (b.accepted > 0 || b.extended > 0)) {
        histLabels.push(ql);
        histAccepted.push(b.accepted);
        histExtended.push(b.extended);
      }
    }
    if (histLabels.length > 0) {
      console.log('[Hist] Quarterly history:', histLabels, histAccepted, histExtended);
      const proj0 = computeProjection(FALLBACK.baseOAR, FALLBACK.baseRecruiterCount, FALLBACK.basePPR);
      renderHistChart(proj0.total, { labels: histLabels, accepted: histAccepted, extended: histExtended });
    }

    // ── Update FALLBACK with live values ──────────────────────────────
    if (total > 0) {
      FALLBACK.acceptedTotal    = total;
      FALLBACK.acceptedMay      = may;
      FALLBACK.acceptedJun      = jun;
      if (startedCount > 0) FALLBACK.hiresQ1ToDate  = startedCount;
      // Always overwrite — 0 upcoming starts is a real, honest value for a team,
      // not a "no data" signal, so it shouldn't be skipped in favor of the seed.
      FALLBACK.acceptedPending = pendingCount;
      console.log(`[Offers] FALLBACK updated — total:${total} started:${startedCount} pending:${pendingCount}`);
    }

    // ── Update per-recruiter data from live Offers sheet ─────────────
    RECRUITERS.forEach(r => {
      const d = recLive[r.name];
      if (!d) return;
      r.accepted = d.accepted;
      r.extended = d.extended;
      r.oar      = d.extended > 0 ? Math.round(d.accepted / d.extended * 100) : 0;
      const newOAL = {};
      Object.entries(d.byLevel).forEach(([lvl, v]) => {
        newOAL[lvl] = { oar: v.ext > 0 ? Math.round(v.acc/v.ext*100) : 0, acc: v.acc, ext: v.ext };
      });
      if (Object.keys(newOAL).length > 0) r.oarByLevel = newOAL;
      if (Object.keys(d.declReasons).length > 0)
        r.declines = Object.entries(d.declReasons).sort((a,b) => b[1]-a[1]);
    });

    // ── Re-render KPIs + health with live data ────────────────────────
    // renderOARByLevel/renderDeclineSection/renderRisks/renderInsightStrip all
    // read from RECRUITERS[].oarByLevel/.declines, which the loop above just
    // populated from this team's own live Offers rows — re-rendering them here
    // is what replaces the initial "no data yet" state with real numbers.
    if (total > 0) {
      OFFERS_LIVE_LOADED = true;
      const oar = FALLBACK.baseOAR, rec = FALLBACK.baseRecruiterCount, ppr = FALLBACK.basePPR;
      const liveProj = computeProjection(oar, rec, ppr);
      updateKPIs(liveProj);
      renderGauge(computeHealth(oar, rec, ppr));
      renderOARByLevel();
      renderDeclineSection();
      renderRisks(liveProj);
      renderInsightStrip(liveProj);
      try { renderAnalysisNotes(liveProj); } catch(e) { console.warn('renderAnalysisNotes (live):', e); }
      document.getElementById('kpiAccepted').textContent = total;
      // Each month gets its own pill so May/Jun/Jul are easy to tell apart at
      // a glance, instead of concatenating Jun+Jul into one pill's text.
      document.getElementById('pillStarted').textContent = 'May: ' + may;
      document.getElementById('pillPending').textContent = 'Jun: ' + jun;
      const pillJulEl = document.getElementById('pillJul');
      if (pillJulEl) {
        if (jul > 0) { pillJulEl.textContent = 'Jul: ' + jul; pillJulEl.style.display = ''; }
        else { pillJulEl.style.display = 'none'; }
      }
    }

    // Re-render funnel with live data in case Chart.js resize event blanked it
    try { renderFunnel(window._livePipelineData || FALLBACK.pipeline); } catch(e) {}

    renderTeamAcceptedOffers();
    if (currentRecruiter && document.getElementById('recruiterView').style.display !== 'none') {
      renderRecruiterView(currentRecruiter);
    }
  } catch(e) {
    console.error('[Offers] fetchAcceptedOffers failed:', e);
    const el = document.getElementById('updatedTime');
    if (el) el.innerHTML = `<span style="color:#F45D48">⚠ Data load failed: ${e.message}</span>`;
  }
}

// ── Accepted offers table helpers ──────────────────────────────────
function buildAcceptsTableHTML(accepts, showRecruiter) {
  if (!accepts || accepts.length === 0) return '';
  const rowsHtml = accepts.map((a, ai) => {
    const ghId = window._ghJobIdMap && window._ghJobIdMap[a.reqId];
    const ghUrl = ghId
      ? `https://gusto.greenhouse.io/sdash/${ghId}`
      : (a.appId ? `https://app.greenhouse.io/applications/${a.appId}` : null);
    const reqCell = ghUrl
      ? `<a href="${ghUrl}" target="_blank" class="accept-req-link">↗ ${a.reqId || 'GH'}</a>`
      : `<span class="accept-req-id">${a.reqId || '—'}</span>`;
    return `<tr>
      <td><div class="accept-candidate"><span style="color:var(--text2);font-weight:500;font-size:11px;margin-right:6px">${ai + 1}.</span>${a.candidate}</div><div class="accept-job" style="padding-left:18px">${a.job}</div></td>
      <td>${reqCell}</td>
      ${showRecruiter ? `<td class="accept-date">${a.recruiter}</td>` : ''}
      <td class="accept-date">${a.resolved}</td>
      <td class="accept-start">${a.startDate || '—'}</td>
    </tr>`;
  }).join('');
  const showHint = accepts.length > 4;
  return `<div class="scroll-table-wrap"><table class="accepts-table">
    <thead><tr>
      <th>Candidate</th><th>Req ID</th>
      ${showRecruiter ? '<th>Recruiter</th>' : ''}
      <th>Accepted</th><th>Start Date</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>${showHint ? `<div class="scroll-hint-bar"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2v6M2 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Scroll for more</div>` : ''}`;
}

// ── Open Headcount Table ──────────────────────────────────────────
function populateHCFilter(id, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">All</option>' +
    [...values].sort().map(v => `<option value="${v}"${v===cur?' selected':''}>${v}</option>`).join('');
}

function renderOpenHCTable() {
  const data = window._openReqsData || [];
  const tbody = document.getElementById('openHCTableBody');
  const subtitle = document.getElementById('openHCSubtitle');
  if (!tbody) return;

  // Build filter option sets from full dataset
  const orgs    = new Set(data.map(r => r.dept).filter(Boolean));
  const recs    = new Set(data.map(r => r.recruiter).filter(Boolean));
  const levels  = new Set(data.map(r => r.level).filter(Boolean));
  const pes     = new Set(data.map(r => r.hiringPE).filter(Boolean));
  populateHCFilter('hcFilterOrg',   orgs);
  populateHCFilter('hcFilterRec',   recs);
  populateHCFilter('hcFilterLevel', levels);
  populateHCFilter('hcFilterPE',    pes);

  const fOrg   = (document.getElementById('hcFilterOrg')   || {}).value || '';
  const fRec   = (document.getElementById('hcFilterRec')   || {}).value || '';
  const fLevel = (document.getElementById('hcFilterLevel') || {}).value || '';
  const fPE    = (document.getElementById('hcFilterPE')    || {}).value || '';

  const filtered = data.filter(r =>
    (!fOrg   || r.dept      === fOrg)   &&
    (!fRec   || r.recruiter === fRec)   &&
    (!fLevel || r.level     === fLevel) &&
    (!fPE    || r.hiringPE  === fPE)
  );

  const PRIORITY_ORDER = { P0:0, P1:1, P2:2, P3:3, '':9 };
  filtered.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.jobName.localeCompare(b.jobName);
  });

  if (subtitle) subtitle.textContent = `Q1 FY27 · ${filtered.length} open req${filtered.length !== 1 ? 's' : ''}${data.length !== filtered.length ? ' (filtered)' : ''}`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:20px 10px;color:var(--text2);text-align:center;font-style:italic;font-size:11px">${data.length ? 'No reqs match current filters' : 'No open reqs found'}</td></tr>`;
    return;
  }

  const PRIORITY_COLOR = { P0:'var(--red)', P1:'#e08000', P2:'var(--text2)', P3:'var(--text2)' };
  const levelShort = l => l.replace('Level ', 'L');
  const ghLink = r => r.ghJobId
    ? `<a href="https://app.greenhouse.io/sdash/${r.ghJobId}" target="_blank" style="color:var(--accent);text-decoration:none">${r.reqId}</a>`
    : r.reqId;

  tbody.innerHTML = filtered.map((r, i) => `
    <tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'rgba(128,128,128,.04)'}">
      <td style="padding:5px 10px;white-space:nowrap;font-family:monospace;font-size:10.5px">${ghLink(r)}</td>
      <td style="padding:5px 10px;max-width:220px;font-size:11.5px">${r.jobName || '—'}</td>
      <td style="padding:5px 10px;white-space:nowrap;font-size:10.5px">${r.dept || '—'}</td>
      <td style="padding:5px 10px;font-size:10.5px;color:var(--text2)">${r.fdsTeam || '—'}</td>
      <td style="padding:5px 10px;white-space:nowrap">
        ${r.level ? `<span style="font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:8px;background:var(--accent-faint);color:var(--accent)">${levelShort(r.level)}</span>` : '—'}
      </td>
      <td style="padding:5px 10px;white-space:nowrap;font-size:10.5px">${r.recruiter || '—'}</td>
      <td style="padding:5px 10px;white-space:nowrap;font-size:10.5px">${r.hiringPE || '—'}</td>
      <td style="padding:5px 10px;white-space:nowrap;text-align:center">
        ${r.priority ? `<span style="font-size:10.5px;font-weight:700;color:${PRIORITY_COLOR[r.priority]||'var(--text2)'}">${r.priority}</span>` : '—'}
      </td>
      <td style="padding:5px 10px;white-space:nowrap;font-size:10.5px;color:var(--text2)">${r.startDate || '—'}</td>
    </tr>`).join('');

  // Show scroll hint if content overflows
  const hint = document.getElementById('openHCScrollHint');
  if (hint) hint.style.display = filtered.length > 5 ? 'flex' : 'none';
}

function clearHCFilters() {
  ['hcFilterOrg','hcFilterRec','hcFilterLevel','hcFilterPE'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderOpenHCTable();
}

window._openReqsData = window._openReqsData || [];

function renderTeamAcceptedOffers() {
  const container = document.getElementById('teamAcceptedOffers');
  if (!container) return;
  const accepts = window._acceptedOffersList || [];
  if (accepts.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  container.innerHTML = `<div class="card" style="margin-bottom:16px">
    <div class="card-title">Accepted Offers <span>Q1 FY27 · ${accepts.length} FTE${accepts.length !== 1 ? 's' : ''} accepted</span></div>
    ${buildAcceptsTableHTML(accepts, true)}
  </div>`;
}

// ── Main init ──────────────────────────────────────────────────────
async function init() {
  const now = new Date();
  document.getElementById('updatedTime').textContent =
    `Updated ${now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})} · ${now.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  // ── Apply team branding from window.TEAM_CONFIG ──────────────────
  if (_TC.color) document.documentElement.style.setProperty('--org', _TC.color);
  const $logoSub = document.querySelector('.logo-sub');
  if ($logoSub) $logoSub.textContent = _TC.name + ' Recruiting';
  const $eyebrow = document.querySelector('.org-banner-eyebrow');
  if ($eyebrow) $eyebrow.textContent = _TC.name.toUpperCase() + ' · Q1 FY27';
  document.title = 'Hiring at a Glance · ' + _TC.name;
  const $goalVal = document.getElementById('teamGoalValue');
  if ($goalVal) $goalVal.textContent = HAS_GOAL ? FALLBACK.q1Goal : 'N/A';
  const $bbGoal = document.getElementById('bbGoal');
  if ($bbGoal) $bbGoal.textContent = HAS_GOAL ? FALLBACK.q1Goal : 'N/A';
  // Update FALLBACK counts to reflect team-specific recruiter count
  FALLBACK.baseRecruiterCount = RECRUITERS.length;

  // ── Render immediately with fallback data so the page is never blocked ──
  document.getElementById('loadingOverlay').style.display = 'none';

  const oar = FALLBACK.baseOAR, rec = FALLBACK.baseRecruiterCount, ppr = FALLBACK.basePPR;
  const proj = computeProjection(oar, rec, ppr);

  // Each render is wrapped so a chart failure never blocks tabs from appearing
  try { renderGauge(computeHealth(oar, rec, ppr)); } catch(e) { console.warn('renderGauge:', e); }
  try { updateKPIs(proj); } catch(e) { console.warn('updateKPIs:', e); }
  try { renderProjectionChart(oar, rec, ppr); } catch(e) { console.warn('renderProjectionChart:', e); }
  // Historical reference card keeps its HTML "Loading…" placeholder until
  // fetchPipelineHistory() resolves below — no fallback numbers to paint here.
  try { renderFunnel(FALLBACK.pipeline); } catch(e) { console.warn('renderFunnel:', e); }
  try { renderHistChart(proj.total); } catch(e) { console.warn('renderHistChart:', e); }
  try { renderOARByLevel(); } catch(e) { console.warn('renderOARByLevel:', e); }
  try { renderDeclineSection(); } catch(e) { console.warn('renderDeclineSection:', e); }
  try { renderRisks(proj); } catch(e) { console.warn('renderRisks:', e); }
  try { renderInsightStrip(proj); } catch(e) { console.warn('renderInsightStrip:', e); }
  try { renderAnalysisNotes(proj); } catch(e) { console.warn('renderAnalysisNotes:', e); }
  try { syncSliderBaselines(); } catch(e) { console.warn('syncSliderBaselines:', e); }
  try { updateWhatIfDisplay(oar, rec, ppr); } catch(e) { console.warn('updateWhatIfDisplay:', e); }

  document.getElementById('footerText').textContent =
    `Gusto ${_TC.name} Recruiting · ${daysElapsed}d elapsed (${pctThrough}% of Q1) · ${daysRemaining}d remaining`;

  // Build recruiter tab nav — runs unconditionally
  initTabNav();

  // ── Live data fetches run in background and update the page when ready ──
  // Note: there is no dedicated weekly "Pipeline Snapshot" sheet, so the funnel
  // is populated from a live aggregate of Current Pipeline per Job (see
  // fetchPipelinePerJob). The Historical Reference card is populated live from
  // Pipeline History per Dept (see fetchPipelineHistory / renderHistoricalReference) —
  // nothing on this page is a permanently-frozen hardcoded number anymore.

  // Accepted offers — with visible sign-in prompt if auth fails after 20s
  fetchAcceptedOffers();
  setTimeout(() => {
    if (!OFFERS_LIVE_LOADED) {
      const el = document.getElementById('updatedTime');
      if (el) el.innerHTML = `<span style="color:#F45D48;font-weight:600">⚠ Data not loading — <a href="https://accounts.google.com" target="_blank" style="color:#F45D48">sign into your Gusto Google account</a>, then reload this page</span>`;
    }
  }, 20000);

  // Pipeline History PTRs (fetch first so they're ready when recruiter tabs open)
  fetchPipelineHistory();

  // Per-job pipeline (recruiter tabs)
  fetchPipelinePerJob();
}

// ── Recruiter data (Q1 FY27 actuals from Greenhouse) ──────────────
// Each team page sets window.TEAM_RECRUITERS before loading this file.
// Engineering data below is the fallback used when no override is set.
const RECRUITERS = window.TEAM_RECRUITERS || [
  { name:'Angeline Lo',        goal: 5,  accepted: 1, extended: 2,  oar: 50,
    oarByLevel: { L4:{oar:0,acc:0,ext:1}, L5:{oar:100,acc:1,ext:1} },
    declines: [['Cash Compensation',1]], reqs: [] },
  { name:'Ellison DeCastro',   goal: 4,  accepted: 1, extended: 1,  oar: 100,
    oarByLevel: { L4:{oar:100,acc:1,ext:1} },
    declines: [], reqs: [] },
  { name:'Jacob Epstein',      goal: 5,  accepted: 1, extended: 2,  oar: 50,
    oarByLevel: { L4:{oar:0,acc:0,ext:1}, L5:{oar:100,acc:1,ext:1} },
    declines: [['Cash Compensation',1]], reqs: [] },
  { name:'Jeff Dunn',          goal: 6,  accepted: 4, extended: 5,  oar: 80,
    oarByLevel: { L3:{oar:100,acc:2,ext:2}, L4:{oar:67,acc:2,ext:3} },
    declines: [['Cash Compensation',1]], reqs: [] },
  { name:'Jeff Myers',         goal: 5,  accepted: 1, extended: 2,  oar: 50,
    oarByLevel: { L3:{oar:100,acc:1,ext:1}, L4:{oar:0,acc:0,ext:1} },
    declines: [['Cash Compensation',1]], reqs: [] },
  { name:'Kevin Gadd',         goal: 5,  accepted: 2, extended: 3,  oar: 67,
    oarByLevel: { L3:{oar:100,acc:1,ext:1}, L4:{oar:50,acc:1,ext:2} },
    declines: [['Cash Compensation',1]], reqs: [] },
  { name:'Khetsun Tenzin',     goal: 5,  accepted: 3, extended: 4,  oar: 75,
    oarByLevel: { L4:{oar:67,acc:2,ext:3}, L5:{oar:100,acc:1,ext:1} },
    declines: [['Equity Compensation',1]], reqs: [] },
  { name:'Mike Galligan',      goal: 6,  accepted: 3, extended: 5,  oar: 60,
    oarByLevel: { L3:{oar:100,acc:1,ext:1}, L4:{oar:50,acc:2,ext:4} },
    declines: [['Cash Compensation',1],['Equity Compensation',1]], reqs: [] },
  { name:'Nicholas Watson',    goal: 5,  accepted: 3, extended: 3,  oar: 100,
    oarByLevel: { L3:{oar:100,acc:1,ext:1}, L4:{oar:100,acc:2,ext:2} },
    declines: [], reqs: [] },
]; // end Engineering fallback — window.TEAM_RECRUITERS overrides this if set

let recGaugeChart = null;
let currentRecruiter = null;
let LIVE_PIPELINE = {};       // keyed by recruiter name, value: [{name,rs,ia,ir,hc,offer}]
let OFFERS_LIVE_LOADED = false; // true once fetchAcceptedOffers has updated RECRUITERS from sheet
window._acceptedOffersList = [];  // full accepted offer records
window._ghJobIdMap = {};          // reqId → Greenhouse job ID
window._pipelineHistory = {};     // reqId → { assess, f2f, offer, hired, assessToF2f, f2fToOffer, offerToHire }

// ── Pipeline History per Dept fetch (historical reference only) ─────
// Actual columns in this sheet: Department Name | Application | Assessment |
// Face to Face | Offer | Hired — one row per real Greenhouse department,
// lifetime totals for "current + previous year". There is no Requisition ID,
// no Recruiter Screen/Interview Round/Hiring Committee breakdown, and no
// week column in this sheet at all, so it cannot feed per-req PTR math or a
// live weekly trend — window._pipelineHistory (used by reqPT() for the
// req-level RS→IR/IR→HC/HC→Offer benchmarks) is intentionally left empty;
// reqPT() already falls back to labeled benchmark rates (marked "*" in the
// UI) when no per-req history exists, which is the honest state here since
// no per-req history exists anywhere in this spreadsheet.
async function fetchPipelineHistory() {
  try {
    const txt = await withTimeout(
      fetchSheetRows('Pipeline History per Dept'),
      14000
    );
    if (!txt || txt.length < 50) { console.warn('[PipelineHistory] empty'); renderHistoricalReference(null, _TC.name); return; }
    const rows = lines(txt);
    let hdrIdx = -1, deptCol = -1, appCol = -1, assessCol = -1, f2fCol = -1, offCol = -1, hireCol = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].includes('Department Name') && rows[i].includes('Application')) {
        hdrIdx    = i;
        const h   = rows[i];
        deptCol   = h.indexOf('Department Name');
        appCol    = h.indexOf('Application');
        assessCol = h.indexOf('Assessment');
        f2fCol    = h.indexOf('Face to Face');
        offCol    = h.indexOf('Offer');
        hireCol   = h.indexOf('Hired');
        break;
      }
    }
    if (hdrIdx < 0) { console.warn('[PipelineHistory] header not found'); renderHistoricalReference(null, _TC.name); return; }

    const deptMap = {};
    for (const row of rows.slice(hdrIdx + 1)) {
      const name = (row[deptCol] || '').trim();
      if (!name) continue;
      deptMap[name.toLowerCase()] = {
        name,
        application: parseInt(row[appCol])   || 0,
        assessment:  parseInt(row[assessCol]) || 0,
        faceToFace:  parseInt(row[f2fCol])    || 0,
        offer:       parseInt(row[offCol])    || 0,
        hired:       parseInt(row[hireCol])   || 0,
      };
    }
    window._deptHistoricalRef = deptMap;
    console.log('[PipelineHistory] departments loaded:', Object.keys(deptMap));

    const match = deptMap[(_TC.name || '').toLowerCase()] || null;
    renderHistoricalReference(match, _TC.name);
  } catch(e) {
    console.error('[PipelineHistory] fetch failed:', e);
    renderHistoricalReference(null, _TC.name);
  }
}

// ── Live pipeline per job fetch ────────────────────────────────────
async function fetchPipelinePerJob() {
  try {
    // Fetch both sheets in parallel
    const [pipeTxt, reqTxt] = await Promise.all([
      fetchSheetRows('Current Pipeline per Job'),
      fetchSheetRows('Open Reqs')
    ]);
    if (!pipeTxt || !reqTxt) return;

    // ── Parse Pipeline Per Job ──────────────────────────────────
    const pipeRows = lines(pipeTxt);
    let pHdr = null, pHdrIdx = -1;
    for (let i = 0; i < pipeRows.length; i++) {
      if (pipeRows[i][0] === 'Job Name') { pHdr = pipeRows[i]; pHdrIdx = i; break; }
    }
    if (!pHdr) { console.error('[Pipeline] Could not find header row in Pipeline Per Job. First row:', pipeRows[0]); return; }
    console.log('[Pipeline] Pipeline Per Job headers:', pHdr);

    const pJob   = pHdr.indexOf('Job Name');
    const pReq   = pHdr.indexOf('Requisition ID');
    const pRS    = pHdr.indexOf('Recruiter Screen');
    const pIA    = pHdr.indexOf('Initial Assessment');
    const pIR    = pHdr.indexOf('Interview Round');
    const pHC    = pHdr.indexOf('Hiring Committee');
    const pOffer = pHdr.indexOf('Offer');
    console.log('[Pipeline] col indices — pReq:', pReq, 'pRS:', pRS, 'pIA:', pIA, 'pIR:', pIR, 'pHC:', pHC, 'pOffer:', pOffer);

    const pipeByReq = {};
    for (const row of pipeRows.slice(pHdrIdx + 1)) {
      const reqId = row[pReq];
      if (!reqId || reqId.startsWith('TEST') || !reqId.trim()) continue;
      const jobName = row[pJob] || '';
      // Skip interns/apprentices
      const jl = jobName.toLowerCase();
      if (/\bintern\b/.test(jl) || /apprentice/.test(jl)) continue;
      pipeByReq[reqId.trim()] = {
        name:  jobName,
        reqId: reqId.trim(),
        rs:    parseInt(row[pRS])    || 0,
        ia:    parseInt(row[pIA])    || 0,
        ir:    parseInt(row[pIR])    || 0,
        hc:    parseInt(row[pHC])    || 0,
        offer: parseInt(row[pOffer]) || 0
      };
    }

    // ── Parse Open Reqs for recruiter assignments ───────────────
    const reqRows2 = lines(reqTxt);
    let rHdr = null, rHdrIdx = -1;
    for (let i = 0; i < reqRows2.length; i++) {
      if (reqRows2[i][0] === 'Job Name') { rHdr = reqRows2[i]; rHdrIdx = i; break; }
    }
    if (!rHdr) { console.error('[Pipeline] Could not find header row in Open Reqs. First row:', reqRows2[0]); return; }
    console.log('[Pipeline] Open Reqs headers:', rHdr);

    const rReqCol      = rHdr.indexOf('Requisition ID');
    const rRecCol      = rHdr.indexOf('Primary Recruiter');
    const rStatCol     = rHdr.indexOf('Status (Job)');
    const rJobIdCol    = rHdr.indexOf('Job ID');
    const rJobNameCol  = rHdr.indexOf('Job Name');
    const rDeptCol     = rHdr.indexOf('Department');
    const rLevelCol    = rHdr.indexOf('Level');
    const rHiringPECol = rHdr.indexOf('Hiring PE');
    const rFDSTeamCol  = rHdr.indexOf('FDS Team');
    const rPriorityCol = rHdr.indexOf('Position Priority');
    const rStartDateCol= rHdr.indexOf('Recruiting Start Date');
    console.log('[Pipeline] Open Reqs col indices — rReq:', rReqCol, 'rRec:', rRecCol, 'rStat:', rStatCol, 'rJobId:', rJobIdCol);
    window._openReqsData = [];

    // Team is determined by who's assigned as Primary Recruiter on the req —
    // include the team lead too, since leads sometimes carry their own reqs
    // (e.g. Kebone Moloko/Teresa Waggoner/Jaime Tavarez all show up as Primary
    // Recruiter on some rows). Without this filter every team's page showed
    // the exact same org-wide open-headcount list instead of its own reqs.
    const teamRecruiterNames = new Set([...RECRUITERS.map(r => r.name), _TC.lead].filter(Boolean));

    const liveByRec = {};
    for (const row of reqRows2.slice(rHdrIdx + 1)) {
      const reqId    = (row[rReqCol] || '').trim();
      const recruiter = (row[rRecCol] || '').trim();
      const status   = row[rStatCol] || '';
      const ghJobId  = rJobIdCol >= 0 ? (row[rJobIdCol] || '').toString().trim() : '';
      if (!reqId) continue;
      // Always build ghJobId map for ALL reqs (including closed) so accepted offers get links
      if (ghJobId) window._ghJobIdMap[reqId] = ghJobId;
      // Capture this team's own open reqs for the headcount table (exclude
      // E-reqs, regardless of pipeline entry) — scoped to this team's own
      // recruiters/lead, not the whole org.
      if (status === 'Open' && !reqId.startsWith('E') && teamRecruiterNames.has(recruiter)) {
        window._openReqsData.push({
          reqId,
          recruiter,
          ghJobId,
          jobName:   (row[rJobNameCol]   || '').trim(),
          dept:      (row[rDeptCol]      || '').trim(),
          level:     (row[rLevelCol]     || '').trim(),
          hiringPE:  (row[rHiringPECol]  || '').trim(),
          fdsTeam:   (row[rFDSTeamCol]   || '').trim(),
          priority:  (row[rPriorityCol]  || '').trim(),
          startDate: (row[rStartDateCol] || '').trim(),
        });
      }
      // Only add to live pipeline for open reqs with a known recruiter and pipeline entry
      if (status !== 'Open' || !recruiter) continue;
      const pipe = pipeByReq[reqId];
      if (!pipe) continue;
      pipe.ghJobId = ghJobId;
      if (!liveByRec[recruiter]) liveByRec[recruiter] = [];
      liveByRec[recruiter].push(pipe);
    }

    console.log('[Pipeline] liveByRec keys:', Object.keys(liveByRec));
    console.log('[Pipeline] sample LIVE_PIPELINE:', JSON.stringify(liveByRec).slice(0, 400));
    LIVE_PIPELINE = liveByRec;

    // ── Build a live funnel snapshot from Current Pipeline per Job ──────
    // There's no historical weekly sheet, so this aggregates *current* stage
    // counts across this team's open reqs (via LIVE_PIPELINE) into the same
    // shape renderFunnel() expects — gives a real, live funnel instead of the
    // frozen FALLBACK.pipeline numbers. (The separate Historical Reference
    // card is populated from Pipeline History per Dept — see fetchPipelineHistory.)
    const agg = { rs:0, ia:0, ir:0, hc:0, offer:0 };
    let openJobsCount = 0;
    RECRUITERS.forEach(r => {
      const reqs = LIVE_PIPELINE[r.name] || [];
      openJobsCount += reqs.length;
      reqs.forEach(req => {
        agg.rs    += req.rs    || 0;
        agg.ia    += req.ia    || 0;
        agg.ir    += req.ir    || 0;
        agg.hc    += req.hc    || 0;
        agg.offer += req.offer || 0;
      });
    });
    const nowLabel = `Week of ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    const liveSnapshot = {
      weeks: [nowLabel], rs: [agg.rs], ia: [agg.ia], ir: [agg.ir], hc: [agg.hc], offer: [agg.offer], openJobs: [openJobsCount]
    };
    window._livePipelineData = liveSnapshot;
    try { renderFunnel(liveSnapshot); } catch(e) { console.warn('[Pipeline] renderFunnel from live snapshot failed:', e); }
    // Health score (pipeline-depth component) and risk cards read the last
    // offer/IR counts via currentOfferCount()/currentIRCount() — now that a
    // live snapshot exists, re-render both so they reflect it instead of the
    // FALLBACK seed values.
    try {
      const oar0 = FALLBACK.baseOAR, rec0 = FALLBACK.baseRecruiterCount, ppr0 = FALLBACK.basePPR;
      const proj0 = computeProjection(oar0, rec0, ppr0);
      renderGauge(computeHealth(oar0, rec0, ppr0));
      renderRisks(proj0);
      renderInsightStrip(proj0);
      renderAnalysisNotes(proj0);
    } catch(e) { console.warn('[Pipeline] re-render gauge/risks from live snapshot failed:', e); }
    const footerEl = document.getElementById('footerText');
    if (footerEl) footerEl.textContent =
      `🟢 Live · ${_TC.name} Recruiting · ${daysElapsed}d elapsed (${pctThrough}% of Q1) · ${daysRemaining}d remaining`;

    // Render open headcount table
    renderOpenHCTable();

    // Re-render accepted offers table now that _ghJobIdMap is populated
    renderTeamAcceptedOffers();

    // Re-render the current recruiter tab if one is open
    if (currentRecruiter && document.getElementById('recruiterView').style.display !== 'none') {
      try { renderRecruiterView(currentRecruiter); } catch(e) { console.error('renderRecruiterView after pipeline:', e); }
    }
  } catch(e) { console.error('[Pipeline] fetchPipelinePerJob failed:', e); }
}

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

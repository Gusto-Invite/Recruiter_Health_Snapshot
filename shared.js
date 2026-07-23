// ── Team Config (overridden by each team page) ──────────────────────
const _TC = window.TEAM_CONFIG || {
  key: 'Engineering', name: 'Engineering', color: '#F45D48',
  lead: 'Jaime Tavarez', goal: 46
};

const TOOL = 'mcp__c61042c2-2fb3-4e2e-888c-dce52a6a8c86__fetch';
const PIPELINE_SHEET = '1jFTGmMfMgsnkCbPPhgwZDPtbNM0-wIM1Ee-FLvTOZVU';

let currentScenario = 'base';
let projectionChart = null, trendChart = null, gaugeChart = null, histChart = null, declineCompChart = null;

const FALLBACK = {
  q1Goal: _TC.goal || 46,
  q1Predicted: 27,           // FTE offers accepted in Q1 (by resolved/acceptance date, excl. interns & apprentices)
  hiresQ1ToDate: 29,         // FTE starts through Jun 9 (excl. interns/apprentices, used for pace projection)
  acceptedTotal: 27,         // offers accepted in Q1 (resolved date in May–Jul 2026, excl. interns & apprentices)
  acceptedMay: 23,           // accepted in May
  acceptedJun: 4,            // accepted in June so far
  acceptedPending: 14,       // not yet started (future start dates)
  baseRecruiterCount: 9,
  basePPR: 1.44,
  baseOAR: 0.85,
  oarByLevel: {
    L1: { oar: 100, accepted: 6,  extended: 6  },
    L3: { oar: 100, accepted: 6,  extended: 6  },
    L4: { oar: 56,  accepted: 10, extended: 18 },
    L5: { oar: 83,  accepted: 5,  extended: 6  }
  }, // Q1 (May–Jul 2026) from Greenhouse Offers data
  declineReasons: {
    L1: { total: 0,  reasons: [] },
    L3: { total: 0,  reasons: [] },
    L4: { total: 8,  reasons: [['Cash Compensation',6],['Equity Compensation',2]] },
    L5: { total: 1,  reasons: [['Cash Compensation',1]] }
  },
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
function computeHealth(oar, rec, ppr) {
  const proj = computeProjection(oar, rec, ppr);
  return Math.round(
    Math.min(50, 50 * (proj.baseMonthly / proj.paceNeeded)) +
    Math.min(30, 30 * (oar / 0.95)) +
    Math.min(20, 20 * Math.min(1, FALLBACK.pipeline.offer.slice(-1)[0] / 8))
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

// ── Pipeline trend ─────────────────────────────────────────────────
function renderTrendChart(pd) {
  const labels = pd.weeks.map(w => w.replace('Week of ',''));
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Recruiter Screen', data:pd.rs, borderColor:'#F45D48', borderWidth:2, pointRadius:3, fill:false, yAxisID:'yLeft' },
        { label:'Initial Assessment', data:pd.ia, borderColor:'#9b59b6', borderWidth:2, pointRadius:3, fill:false, yAxisID:'yRight' },
        { label:'Interview Round', data:pd.ir, borderColor:'#F5A623', borderWidth:2, pointRadius:3, fill:false, yAxisID:'yRight' },
        { label:'Hiring Committee', data:pd.hc, borderColor:'#00B094', borderWidth:2, pointRadius:3, fill:false, yAxisID:'yRight' },
        { label:'Offer', data:pd.offer, borderColor:'#F45D48', borderWidth:2.5, pointRadius:4, fill:false, yAxisID:'yRight' }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true,position:'top',labels:{boxWidth:12,padding:12}}},
      scales:{
        yLeft: { position:'left', grid:{color:'rgba(0,0,0,0.05)'}, title:{display:true,text:'Recruiter Screen',color:'#F45D48',font:{size:10}} },
        yRight: { position:'right', grid:{display:false}, beginAtZero:true, title:{display:true,text:'All Other Stages',color:'#8b95b0',font:{size:10}} },
        x: { grid:{color:'rgba(0,0,0,0.05)'} }
      }
    }
  });
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
        { label:'Goal (46)',         data:[...nullPad, FALLBACK.q1Goal], type:'line', borderColor:'rgba(0,0,0,0.2)', borderDash:[6,4], borderWidth:2, pointRadius:0, fill:false }
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
            return `OAR: ${oar}% (${acc}/${ext}) · Engineering only`;
          }
          return hd ? 'Live · Engineering Invite team' : 'Hardcoded fallback';
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
    if (note) note.innerHTML = `<strong>🟢 Live · Engineering only:</strong> ${lastLabel} saw ${lastHist} accepted of ${lastExt} extended (${lastOAR}% OAR). ${trend} vs prior quarter (${prevHist} accepted, ${prevOAR}% OAR). Q1 FY27 projected: ${projected}.`;
  }
}

// ── Decline reasons ────────────────────────────────────────────────
function renderDeclineSection() {
  // FALLBACK.declineReasons.L4 may legitimately be absent (no L4 declines this
  // period) — don't assume it exists or that it has any reasons.
  const l4 = FALLBACK.declineReasons.L4 || { total: 0, reasons: [] };
  const maxCount = l4.reasons.length > 0 ? l4.reasons[0][1] : 0;
  const reasonColors = {
    'Cash Compensation':     '#F45D48',
    'Equity Compensation':   '#e67e22',
    'Role Misalignment':     '#9b59b6',
    'Duplicate Application': '#3d4f7a',
    'Moving to headcount req': '#3d4f7a',
    'Timeline Misalignment': '#00B094',
    "Gusto's Product/Industry": '#F5A623',
    'Other':                 '#4a5568'
  };

  // L4 horizontal bars
  let html = '';
  l4.reasons.forEach(([reason, count]) => {
    const pct = l4.total > 0 ? (count / l4.total * 100).toFixed(0) : 0;
    const barW = maxCount > 0 ? (count / maxCount * 100).toFixed(0) : 0;
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
  if (l4.reasons.length === 0) html = `<div style="padding:12px 4px;color:var(--text2);font-size:12px;font-style:italic">No L4 declines this quarter.</div>`;
  document.getElementById('l4DeclineContainer').innerHTML = html;

  // L4 card subtitle + callout — computed from the same l4 object driving the
  // bars above, so it can never disagree with what's plotted.
  const l4OarLive = FALLBACK.oarByLevel.L4;
  const l4Subtitle = document.getElementById('l4DeclineSubtitle');
  if (l4Subtitle) {
    l4Subtitle.textContent = `Q1 · ${l4.total} total decline${l4.total === 1 ? '' : 's'}` +
      (l4OarLive ? ` · OAR ${l4OarLive.oar}%` : '');
  }
  const l4Callout = document.getElementById('l4DeclineCallout');
  if (l4Callout) {
    if (l4.total > 0) {
      const compReasons = l4.reasons.filter(([r]) => /compensation/i.test(r));
      const compCount = compReasons.reduce((s, [,c]) => s + c, 0);
      const compPct = Math.round(compCount / l4.total * 100);
      const breakdown = l4.reasons.map(([r, c]) => `${r} accounts for ${Math.round(c/l4.total*100)}% (${c} of ${l4.total})`).join('; ');
      l4Callout.innerHTML = `<strong>⚠️ ${compPct}% of Q1 L4 declines are compensation-related.</strong> ${breakdown}.`;
    } else {
      l4Callout.innerHTML = `<strong>✅ No L4 declines recorded in Q1.</strong>`;
    }
  }

  // Cross-level comparison grouped bar chart
  const levels = ['L1','L3','L4','L5'];
  const topReasons = ['Cash Compensation','Equity Compensation'];
  const palette = ['#F45D48','#e67e22'];

  const datasets = topReasons.map((reason, ri) => ({
    label: reason,
    data: levels.map(lvl => {
      const d = FALLBACK.declineReasons[lvl];
      if (!d) return 0;
      const found = d.reasons.find(([r]) => r === reason);
      return found ? found[1] : 0;
    }),
    backgroundColor: palette[ri] + 'cc',
    borderColor: palette[ri],
    borderWidth: 1,
    borderRadius: 4
  }));

  if (declineCompChart) declineCompChart.destroy();
  declineCompChart = new Chart(document.getElementById('declineCompChart'), {
    type: 'bar',
    data: { labels: levels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 11, padding: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` } }
      },
      scales: {
        x: { stacked: false, grid: { color: 'rgba(0,0,0,0.05)' } },
        y: { stacked: false, grid: { color: 'rgba(0,0,0,0.05)' }, beginAtZero: true, ticks: { stepSize: 5 } }
      }
    }
  });

  // Pattern note — which level(s) actually carry the Q1 decline volume,
  // recomputed from FALLBACK.declineReasons every time (never a fixed level/count).
  const patternNote = document.getElementById('declinePatternNote');
  if (patternNote) {
    const withDeclines = Object.entries(FALLBACK.declineReasons)
      .filter(([, d]) => d.total > 0)
      .sort((a, b) => b[1].total - a[1].total);
    if (withDeclines.length === 0) {
      patternNote.innerHTML = `<strong>Pattern:</strong> No declines recorded at any level in Q1.`;
    } else {
      const [topLvl, topD] = withDeclines[0];
      const clean = Object.keys(FALLBACK.declineReasons).filter(lvl => !FALLBACK.declineReasons[lvl].total);
      patternNote.innerHTML = `<strong>Pattern:</strong> ${topLvl} ${withDeclines.length > 1 ? 'has the most' : 'is the only level with'} Q1 decline volume (${topD.total})` +
        (clean.length ? `. ${clean.join(' and ')} ${clean.length > 1 ? 'are' : 'is'} accepting at 100%` : '') + `.`;
    }
  }
}

// ── OAR by level ───────────────────────────────────────────────────
// FALLBACK.oarByLevel is populated purely from live accepted/extended counts
// (see the org-level aggregation in fetchAcceptedOffers, or the static
// snapshot in FALLBACK before live data has loaded) — no level's % here is
// ever a fixed constant; it's always accepted÷extended for whatever the
// current data says, the same formula for every level.
function renderOARByLevel() {
  let html = '';
  Object.entries(FALLBACK.oarByLevel).forEach(([lvl, d]) => {
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
  document.getElementById('oarByLevel').innerHTML = html;

  // Critical-level note — whichever level currently has the lowest OAR (with
  // at least one extended offer), computed fresh every render. Nothing here
  // names a specific level or % up front; it just reports what the data shows.
  const oarNote = document.getElementById('oarByLevelNote');
  if (oarNote) {
    const levels = Object.entries(FALLBACK.oarByLevel).filter(([, d]) => d.extended > 0);
    if (levels.length === 0) {
      oarNote.innerHTML = `<strong>OAR by Level:</strong> No offers extended yet this quarter.`;
    } else {
      const [worstLvl, worstD] = levels.reduce((min, cur) => cur[1].oar < min[1].oar ? cur : min);
      if (worstD.oar >= 85) {
        oarNote.className = 'analysis-note';
        oarNote.innerHTML = `<strong>On track:</strong> Every level is at or above 85% OAR — lowest is ${worstLvl} at ${worstD.oar}%.`;
      } else {
        const declines = FALLBACK.declineReasons[worstLvl];
        const reasonBit = declines && declines.reasons.length > 0
          ? `, ${declines.reasons.length === 1 && declines.total === declines.reasons[0][1] ? 'exclusively' : 'primarily'} to ${declines.reasons[0][0].toLowerCase()}`
          : '';
        oarNote.className = 'analysis-note risk';
        oarNote.innerHTML = `<strong>⚠ Critical — ${worstLvl}:</strong> ${worstD.oar}% OAR (${worstD.accepted}/${worstD.extended}) is the lowest of any level${reasonBit}. This is the highest-leverage level to address this quarter.`;
      }
    }
  }
}

// ── Risk flags ─────────────────────────────────────────────────────
function renderRisks(proj) {
  const gap = proj.gap;
  const goal = FALLBACK.q1Goal;
  const offerCount = FALLBACK.pipeline.offer.slice(-1)[0];
  const latestIR = FALLBACK.pipeline.ir.slice(-1)[0];

  // Whichever level currently has the lowest OAR (min 1 extended offer) — not
  // fixed to L4. If a different level ever ends up weakest, this card follows.
  const levelsWithData = Object.entries(FALLBACK.oarByLevel).filter(([, d]) => d.extended > 0);
  const [worstLvl, worstD] = levelsWithData.length > 0
    ? levelsWithData.reduce((min, cur) => cur[1].oar < min[1].oar ? cur : min)
    : [null, { oar: null }];

  const risks = [
    {
      level: gap >= 15 ? 'risk-high' : gap >= 8 ? 'risk-mid' : 'risk-low',
      icon: gap >= 15 ? '🔴' : gap >= 8 ? '🟡' : '🟢',
      title: gap > 0 ? `${gap}-Hire FTE Gap to Goal` : 'FTE Goal Within Reach',
      desc: gap > 0
        ? `At current FTE pace (${proj.baseMonthly.toFixed(1)}/mo), Q1 projects to ~${proj.total} vs goal of ${goal}. Need ${proj.paceNeeded.toFixed(1)}/mo.`
        : `Projected to meet or exceed the ${goal}-hire Q1 FTE goal.`
    }
  ];

  if (worstLvl) {
    risks.push({
      level: worstD.oar < 70 ? 'risk-high' : worstD.oar < 85 ? 'risk-mid' : 'risk-low',
      icon: worstD.oar < 70 ? '🔴' : worstD.oar < 85 ? '🟡' : '🟢',
      title: `${worstLvl} OAR at ${worstD.oar}%`,
      desc: worstD.oar < 85
        ? `${worstLvl} offers accepting at ${worstD.oar}% (${worstD.accepted}/${worstD.extended}) — the lowest of any level. Compensation or competing offers likely driving rejections.`
        : `${worstLvl} is the lowest level at ${worstD.oar}% OAR, but every level is still at or above 85%.`
    });
  }

  risks.push({
    level: offerCount < 6 ? 'risk-high' : offerCount < 10 ? 'risk-mid' : 'risk-low',
    icon: offerCount < 6 ? '🔴' : '🟡',
    title: `${offerCount} Active Offers + ${FALLBACK.acceptedPending} Upcoming Starts`,
    desc: `${offerCount} in Offer stage, ${FALLBACK.acceptedPending} accepted offers with future start dates (through Jul 31). IR pipeline (${latestIR}) feeding offer stage.`
  });

  document.getElementById('risksContainer').innerHTML = risks.map(r =>
    `<div class="risk-card ${r.level}"><div class="risk-icon">${r.icon}</div><div><div class="risk-title">${r.title}</div><div class="risk-desc">${r.desc}</div></div></div>`
  ).join('');
}

// ── Dynamic notes/insight-chips ──────────────────────────────────────
// Every number below is read from FALLBACK/proj/pipeline at render time —
// nothing here is a snapshot string. Called once at init() with fallback
// data and again once live Offers data has loaded, so these never go stale
// the way baked-in HTML text would.
function renderDynamicNotes(proj) {
  const goal = FALLBACK.q1Goal;

  // Deadline chip
  const deadlineEl = document.getElementById('insightDeadlineText');
  if (deadlineEl) deadlineEl.textContent = `${daysRemaining} days left in Q1`;

  // Risk / Win chips — driven by whichever level currently has the lowest
  // and highest OAR, not a level named in advance.
  const levelsWithData = Object.entries(FALLBACK.oarByLevel).filter(([, d]) => d.extended > 0);
  if (levelsWithData.length > 0) {
    const [worstLvl, worstD] = levelsWithData.reduce((min, cur) => cur[1].oar < min[1].oar ? cur : min);
    const bestOar = Math.max(...levelsWithData.map(([, d]) => d.oar));
    const bestLevels = levelsWithData.filter(([, d]) => d.oar === bestOar).map(([lvl]) => lvl);

    const riskText = document.getElementById('insightRiskText');
    const riskSub  = document.getElementById('insightRiskSub');
    if (riskText) riskText.textContent = `${worstLvl} OAR at ${worstD.oar}%`;
    if (riskSub) {
      const decl = FALLBACK.declineReasons[worstLvl];
      if (worstD.oar >= 85) {
        riskSub.textContent = `Healthy — every level is at or above 85% OAR.`;
      } else if (decl && decl.reasons.length > 0) {
        const compPct = Math.round(decl.reasons.filter(([r]) => /compensation/i.test(r)).reduce((s,[,c])=>s+c,0) / decl.total * 100);
        riskSub.textContent = compPct > 0
          ? `${compPct}% of declines are comp—escalate band review immediately.`
          : `${decl.reasons[0][0]} is the leading decline reason.`;
      } else {
        riskSub.textContent = `Lowest OAR of any level this quarter.`;
      }
    }

    const winText = document.getElementById('insightWinText');
    const winSub  = document.getElementById('insightWinSub');
    if (winText) winText.textContent = bestLevels.length > 1
      ? `${bestLevels.join(' & ')} at ${bestOar}% OAR`
      : `${bestLevels[0]} at ${bestOar}% OAR`;
    if (winSub) winSub.textContent = bestOar >= 100
      ? `No declines at ${bestLevels.length > 1 ? 'those levels' : 'that level'} in Q1—strong close rate.`
      : `Best-performing level${bestLevels.length > 1 ? 's' : ''} this quarter.`;
  }

  // Projection risk note (Monthly FTE Hire Projection card)
  const projNote = document.getElementById('projectionNote');
  if (projNote) {
    if (proj.gap > 0) {
      projNote.className = 'analysis-note risk';
      projNote.innerHTML = `<strong>⚠ Risk:</strong> Base scenario projects ~${proj.total} FTE — a ${proj.gap}-hire gap to goal. Closing the gap requires accelerating offer volume significantly.`;
    } else {
      projNote.className = 'analysis-note';
      projNote.innerHTML = `<strong>✅ On track:</strong> Base scenario projects ~${proj.total} FTE, at or above the ${goal}-hire goal.`;
    }
  }

  // Funnel bottleneck note — prefers the live per-job pipeline snapshot when
  // it's available, falls back to the last known FALLBACK.pipeline week.
  const funnelNote = document.getElementById('funnelNote');
  if (funnelNote) {
    const pd = window._livePipelineData || FALLBACK.pipeline;
    const offerCount = pd.offer.slice(-1)[0];
    const irCount = pd.ir.slice(-1)[0];
    const irMin = Math.min(...FALLBACK.pipeline.ir);
    funnelNote.innerHTML = `<strong>⚠ Bottleneck:</strong> Only ${offerCount} active offers against a pace requiring ~${proj.paceNeeded.toFixed(1)} closes/month. ` +
      (irCount <= irMin ? `IR pool is at a multi-week low.` : `IR pipeline currently at ${irCount}.`);
  }

  // Pipeline stage trend note (Interview Round drop over the tracked weeks)
  const trendNote = document.getElementById('trendNote');
  if (trendNote) {
    const ir = FALLBACK.pipeline.ir;
    const first = ir[0], last = ir[ir.length - 1];
    const pctChange = first > 0 ? Math.round((last - first) / first * 100) : 0;
    const weeks = ir.length - 1;
    if (pctChange < 0) {
      trendNote.innerHTML = `<strong>⚠ Watch:</strong> Interview Round dropped ${Math.abs(pctChange)}% over ${weeks} weeks (${first} → ${last}), directly compressing the offer stage. This trend needs to reverse to generate sufficient offer volume.`;
    } else {
      trendNote.className = 'analysis-note';
      trendNote.innerHTML = `<strong>Stable/up:</strong> Interview Round moved ${pctChange >= 0 ? '+' : ''}${pctChange}% over ${weeks} weeks (${first} → ${last}).`;
    }
  }

  // What-if sliders — "current" impact text, read from live baseline every time
  const worst = getWorstOARLevel();
  const oarImpact = document.getElementById('oarImpact');
  if (oarImpact) oarImpact.textContent = worst
    ? `Baseline OAR · ${worst[0]} currently at ${worst[1].oar}%`
    : `Baseline OAR`;
  const recImpact = document.getElementById('recImpact');
  if (recImpact) recImpact.textContent = `Each recruiter adds ~${FALLBACK.basePPR.toFixed(2)} FTE hires/month`;
}

// ── Slider baselines ──────────────────────────────────────────────
// Syncs each what-if slider's starting position/label to the actual
// FALLBACK assumption it represents, instead of a number typed into the
// HTML once and left behind. Run once at init() — these are planning
// assumptions (not derived from the Offers sheet), so they don't need to
// re-sync after live data loads the way OAR-by-level does.
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
  const stillLeft0 = Math.max(0, goal - accepted);
  document.getElementById('teamGoalSummary').textContent =
    stillLeft0 === 0 ? `✓ Goal covered by accepted offers` : `${accepted} accepted · ${stillLeft0} more needed by Jul 31`;
  const remaining0 = proj.total - started;
  document.getElementById('teamProjBreakdown').textContent = `${started} accepted + ~${Math.max(0,remaining0)} projected = ${proj.total}`;

  // Goal card — progress bar
  const confirmedPct = Math.round(accepted / goal * 100);
  const barColor = confirmedPct >= 90 ? '#00B094' : confirmedPct >= 60 ? '#F5A623' : '#F45D48';
  document.getElementById('goalBar').style.width = Math.min(100, confirmedPct) + '%';
  document.getElementById('goalBar').style.background = barColor;
  document.getElementById('goalPct').textContent = confirmedPct + '% of goal accepted in Q1';
  document.getElementById('goalPct').style.color = barColor;
  const stillNeeded = Math.max(0, goal - accepted);
  document.getElementById('goalNote').textContent = `${accepted} accepted in Q1 · ${stillNeeded} more needed by Jul 31`;

  // Projected card
  const projPct = Math.round(proj.total / goal * 100);
  const projColor = proj.total >= goal ? '#00B094' : proj.total >= Math.round(goal * 0.9) ? '#F5A623' : '#F45D48';
  document.getElementById('kpiProjected').textContent = proj.total;
  document.getElementById('kpiProjected').style.color = projColor;
  document.getElementById('kpiGapLabel').innerHTML = proj.gap > 0
    ? `<span class="kpi-badge badge-red">−${proj.gap} FTE vs goal</span>`
    : `<span class="kpi-badge badge-green">On target</span>`;
  document.getElementById('kpiProjectedNote').textContent =
    `${projPct}% to goal · ${proj.gap > 0 ? `${proj.gap} hire${proj.gap > 1 ? 's' : ''} short at current pace` : 'Goal within reach at base pace'}`;

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

  // Pace card (may be absent from team view)
  const paceRatio = Math.round(proj.baseMonthly / proj.paceNeeded * 100);
  const kpiPaceEl = document.getElementById('kpiPace');
  if (kpiPaceEl) {
    kpiPaceEl.textContent = proj.baseMonthly.toFixed(1) + '/mo';
    kpiPaceEl.style.color = proj.baseMonthly >= proj.paceNeeded ? '#00B094' : proj.baseMonthly >= proj.paceNeeded * 0.8 ? '#F5A623' : '#F45D48';
    const kpiPaceNeeded = document.getElementById('kpiPaceNeeded');
    if (kpiPaceNeeded) kpiPaceNeeded.textContent = `Need ${proj.paceNeeded.toFixed(1)}/mo to hit goal`;
    const kpiPaceNote = document.getElementById('kpiPaceNote');
    if (kpiPaceNote) kpiPaceNote.textContent = `${paceRatio}% of needed pace · ${FALLBACK.baseRecruiterCount} recruiters × ${FALLBACK.basePPR.toFixed(2)} PPR`;
  }

  // Days card (may be absent from team view)
  const hiresWithPipeline = started + pending;
  const remainingAfterPipeline = Math.max(0, goal - hiresWithPipeline);
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
    const ext = parseInt(document.getElementById('kpiAccepted').textContent)||0;
    const dec = FALLBACK.oarByLevel;
    let totalAcc=0,totalExt=0;
    Object.values(dec).forEach(v=>{totalAcc+=v.accepted;totalExt+=v.extended;});
    const oarPct = totalExt>0 ? Math.round(totalAcc/totalExt*100) : 0;
    teamOAREl.textContent = oarPct+'%';
    teamOAREl.style.color = oarPct>=90?'var(--green)':oarPct>=75?'var(--yellow)':'var(--red)';
    if (teamOARNote) teamOARNote.textContent = totalAcc+'/'+totalExt+' offers accepted';
    if (teamOARWatch && oarPct<75) teamOARWatch.innerHTML='<strong>⚠ Watch:</strong> OAR below 75% threshold — comp bands driving declines.';
  }

  const kpiDaysNote = document.getElementById('kpiDaysNote');
  if (kpiDaysNote) kpiDaysNote.textContent =
    `${hiresWithPipeline} confirmed · ${remainingAfterPipeline} more needed in ${daysRemaining}d`;

  // ── Dynamic analysis notes ────────────────────────────────────────
  // (goalW/projW previously had no null-guard — since #watchGoal and
  // #watchProjected don't exist on this page layout, that threw on every
  // single render and silently skipped watchPace/watchDays below it too.)
  const goalW = document.getElementById('watchGoal');
  const stillLeft = Math.max(0, goal - accepted);
  if (goalW) {
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
  if (projW) {
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
  if (paceW) {
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
  if (daysW) {
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
  const projPct = Math.round(proj.total / goal * 100);
  const projColor = proj.total >= goal ? '#00B094' : proj.total >= 44 ? '#F5A623' : '#F45D48';

  document.getElementById('wiMonthlyPace').textContent = proj.baseMonthly.toFixed(1) + '/mo';
  document.getElementById('wiMonthlyPace').style.color = proj.baseMonthly >= proj.paceNeeded ? '#00B094' : proj.baseMonthly >= proj.paceNeeded * 0.8 ? '#F5A623' : '#F45D48';
  document.getElementById('wiHiresRemaining').textContent = proj.remaining;
  document.getElementById('wiTotal').textContent = proj.total;
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

// Whichever level currently has the lowest OAR (≥1 extended offer) — shared
// by renderDynamicNotes() and onSliderChange() so neither ever falls back to
// a hardcoded level/%.
function getWorstOARLevel() {
  const levels = Object.entries(FALLBACK.oarByLevel).filter(([, d]) => d.extended > 0);
  return levels.length > 0 ? levels.reduce((min, cur) => cur[1].oar < min[1].oar ? cur : min) : null;
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
  const worst = getWorstOARLevel();
  const baselineOarText = worst ? `Baseline OAR · ${worst[0]} currently at ${worst[1].oar}%` : 'Baseline OAR';
  document.getElementById('oarImpact').textContent = oarDelta > 0 ? `↑ ${oarDelta}pp above baseline` : oarDelta < 0 ? `↓ ${Math.abs(oarDelta)}pp below baseline` : baselineOarText;
  const recDelta = rec - FALLBACK.baseRecruiterCount;
  document.getElementById('recImpact').textContent = recDelta !== 0 ? `${recDelta > 0 ? '+' : ''}${recDelta} vs baseline · ~${Math.abs(Math.round(recDelta * ppr * monthsLeft))} Q1 hire impact` : `Each recruiter adds ~${FALLBACK.basePPR.toFixed(2)} FTE hires/month`;
  updateWhatIfDisplay(oar, rec, ppr);
  renderGauge(computeHealth(oar, rec, ppr));
  renderRisks(computeProjection(oar, rec, ppr));
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

// ── Fetch accepted offers live ─────────────────────────────────────
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
    const engRecruiters = new Set(RECRUITERS.map(r => r.name));

    let total = 0, may = 0, jun = 0, jul = 0, startedCount = 0, pendingCount = 0;
    window._acceptedOffersList = [];

    // Per-recruiter live tracking { accepted, extended, byLevel:{L4:{acc,ext}}, declReasons:{reason:count} }
    const recLive = {};
    // Quarterly history buckets (Engineering only) { label → {accepted, extended} }
    const qBuckets = {};
    // Org-wide (team) level tracking — this is what drives the "OAR by Level" card,
    // the L4 decline chart, and every note that quotes an OAR/decline number. It is
    // rebuilt from the live Offers rows below; FALLBACK.oarByLevel/declineReasons are
    // only the pre-load snapshot and are overwritten once real rows are available, so
    // no level's OAR is ever hardcoded — it's always acc/ext computed from the data.
    const orgByLevel = {};       // { L4: { acc, ext } }
    const orgDeclineByLevel = {}; // { L4: { total, reasons: { reasonName: count } } }

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

      // Quarterly history — Engineering recruiters only
      const fqLabel = getFQLabel(mo, yr);
      if (fqLabel && engRecruiters.has(recruiter)) {
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
      if (!engRecruiters.has(recruiter)) continue;

      if (status === 'Accepted') {
        total++;
        if (mo === 5) may++; else if (mo === 6) jun++; else jul++;
        // Count all accepted offers (by accept date, not start date)
        startedCount = total; // updated each iteration; final value = total accepted
        pendingCount = 0;

        if (recruiter) {
          recLive[recruiter].accepted++;
          recLive[recruiter].extended++;
          if (levelKey) {
            if (!recLive[recruiter].byLevel[levelKey]) recLive[recruiter].byLevel[levelKey] = {acc:0,ext:0};
            recLive[recruiter].byLevel[levelKey].acc++;
            recLive[recruiter].byLevel[levelKey].ext++;
          }
        }
        if (levelKey) {
          if (!orgByLevel[levelKey]) orgByLevel[levelKey] = { acc: 0, ext: 0 };
          orgByLevel[levelKey].acc++;
          orgByLevel[levelKey].ext++;
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
      } else {
        // Extended but not accepted (Declined, Rescinded, etc.)
        if (recruiter) {
          recLive[recruiter].extended++;
          if (levelKey) {
            if (!recLive[recruiter].byLevel[levelKey]) recLive[recruiter].byLevel[levelKey] = {acc:0,ext:0};
            recLive[recruiter].byLevel[levelKey].ext++;
          }
          if (status === 'Declined' && declReasonCol >= 0) {
            const reason = (row[declReasonCol] || '').trim();
            if (reason) recLive[recruiter].declReasons[reason] = (recLive[recruiter].declReasons[reason] || 0) + 1;
          }
        }
        if (levelKey) {
          if (!orgByLevel[levelKey]) orgByLevel[levelKey] = { acc: 0, ext: 0 };
          orgByLevel[levelKey].ext++;
        }
        if (status === 'Declined' && declReasonCol >= 0 && levelKey) {
          const reason = (row[declReasonCol] || '').trim();
          if (reason) {
            if (!orgDeclineByLevel[levelKey]) orgDeclineByLevel[levelKey] = { total: 0, reasons: {} };
            orgDeclineByLevel[levelKey].total++;
            orgDeclineByLevel[levelKey].reasons[reason] = (orgDeclineByLevel[levelKey].reasons[reason] || 0) + 1;
          }
        }
      }
    }

    // Sort accepted list by date desc
    window._acceptedOffersList.sort((a, b) => {
      const toMs = d => { const p = (d||'').split('/'); return p.length===3 ? new Date(+p[2],+p[0]-1,+p[1]).getTime() : 0; };
      return toMs(b.resolved) - toMs(a.resolved);
    });

    console.log('[Offers] loop done — total:', total, 'skipStatus:', _dbgSkipStatus, 'skipNonFTE:', _dbgSkipNonFTE, 'skipDate:', _dbgSkipDate, 'skipYr:', _dbgSkipYr, 'passed:', _dbg);
    // ── Build quarterly history from live data (Engineering only) ────
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
      if (pendingCount  > 0) FALLBACK.acceptedPending = pendingCount;
      console.log(`[Offers] FALLBACK updated — total:${total} started:${startedCount} pending:${pendingCount}`);
    }

    // ── Recompute org-wide OAR-by-level purely from live acc/ext counts ──
    // No level's OAR is a hardcoded number: every level (L1, L3, L4, L5, ...)
    // is derived the same way — accepted ÷ extended for that level, from
    // whatever the sheet actually contains this run. If a level has no rows
    // yet, it's simply absent (not defaulted to some baked-in %).
    const newOrgOAL = {};
    Object.entries(orgByLevel).forEach(([lvl, v]) => {
      newOrgOAL[lvl] = {
        oar: v.ext > 0 ? Math.round(v.acc / v.ext * 100) : 0,
        accepted: v.acc,
        extended: v.ext
      };
    });
    if (Object.keys(newOrgOAL).length > 0) {
      FALLBACK.oarByLevel = newOrgOAL;
      console.log('[Offers] Live oarByLevel:', newOrgOAL);
    }

    // ── Recompute org-wide decline reasons by level from live rows ───────
    const newOrgDecl = {};
    Object.entries(orgDeclineByLevel).forEach(([lvl, v]) => {
      newOrgDecl[lvl] = {
        total: v.total,
        reasons: Object.entries(v.reasons).sort((a, b) => b[1] - a[1])
      };
    });
    if (Object.keys(newOrgDecl).length > 0) {
      FALLBACK.declineReasons = newOrgDecl;
      console.log('[Offers] Live declineReasons:', newOrgDecl);
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
    if (total > 0) {
      OFFERS_LIVE_LOADED = true;
      const oar = FALLBACK.baseOAR, rec = FALLBACK.baseRecruiterCount, ppr = FALLBACK.basePPR;
      const liveProj = computeProjection(oar, rec, ppr);
      updateKPIs(liveProj);
      renderGauge(computeHealth(oar, rec, ppr));
      renderOARByLevel();
      // These previously only ran once at init() against fallback data and
      // never refreshed once live numbers arrived — re-run them here so the
      // risk cards and decline chart reflect the same live oarByLevel/
      // declineReasons that were just rebuilt above.
      try { renderDeclineSection(); } catch(e) { console.warn('renderDeclineSection (live):', e); }
      try { renderRisks(liveProj); } catch(e) { console.warn('renderRisks (live):', e); }
      try { renderDynamicNotes(liveProj); } catch(e) { console.warn('renderDynamicNotes (live):', e); }
      document.getElementById('kpiAccepted').textContent = total;
      document.getElementById('pillStarted').textContent = 'May: ' + may;
      document.getElementById('pillPending').textContent = 'Jun: ' + jun + (jul > 0 ? ' · Jul: ' + jul : '');
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


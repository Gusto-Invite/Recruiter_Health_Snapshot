
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

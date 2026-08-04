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

  // Build filter option sets from full dataset. A req with two team owners
  // (Primary + Secondary Recruiter) carries both names in `recruiters` —
  // each should be selectable in the filter and match this one shared row,
  // without that row being counted twice anywhere.
  const orgs    = new Set(data.map(r => r.dept).filter(Boolean));
  const recs    = new Set();
  data.forEach(r => (r.recruiters && r.recruiters.length ? r.recruiters : [r.recruiter]).forEach(n => n && recs.add(n)));
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
    (!fRec   || (r.recruiters && r.recruiters.length ? r.recruiters.includes(fRec) : r.recruiter === fRec)) &&
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
  // Sync the "Active Recruiters" what-if slider to this team's actual roster
  // size — the HTML ships with Engineering's numbers (9, range 6–14) baked
  // in as a template default, so every other team page showed "9" here
  // until this ran. OAR (85%) and PPR (1.44) sliders are intentionally left
  // alone — those are shared Gusto-wide baselines, not per-team facts.
  (function syncRecruiterSlider() {
    const count = FALLBACK.baseRecruiterCount;
    const lo = Math.max(1, count - 3);
    const hi = count + 5;
    const recSliderEl = document.getElementById('recSlider');
    if (recSliderEl) {
      recSliderEl.min = lo;
      recSliderEl.max = hi;
      recSliderEl.value = count;
      const minmaxSpans = recSliderEl.parentElement?.querySelector('.slider-minmax')?.querySelectorAll('span');
      if (minmaxSpans && minmaxSpans[0]) minmaxSpans[0].textContent = lo;
      if (minmaxSpans && minmaxSpans[1]) minmaxSpans[1].textContent = hi;
    }
    const recSliderValEl = document.getElementById('recSliderVal');
    if (recSliderValEl) recSliderValEl.textContent = count;
    const recCurrentEl = document.getElementById('recCurrentVal');
    if (recCurrentEl) recCurrentEl.textContent = count;
  })();

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
    const rSecRecCol   = rHdr.indexOf('Secondary Recruiters');
    console.log('[Pipeline] Open Reqs col indices — rReq:', rReqCol, 'rRec:', rRecCol, 'rStat:', rStatCol, 'rJobId:', rJobIdCol, 'rSecRec:', rSecRecCol);
    window._openReqsData = [];

    // Team is determined by who's assigned as Primary Recruiter on the req —
    // include the team lead too, since leads sometimes carry their own reqs
    // (e.g. Kebone Moloko/Teresa Waggoner/Jaime Tavarez all show up as Primary
    // Recruiter on some rows). Without this filter every team's page showed
    // the exact same org-wide open-headcount list instead of its own reqs.
    // Some reqs staff a team member only as a Secondary Recruiter (comma-
    // separated in that column) rather than Primary — those should still
    // count toward this team. A req with two team members on it (one
    // Primary, one Secondary) should show up in EACH of their individual
    // recruiter tabs, but should only count once toward this team's totals
    // (open headcount count, funnel stage counts) — so we resolve the full
    // list of team owners here, fan the req out per-recruiter below, and
    // dedupe by reqId wherever a team-wide total is computed.
    const teamRecruiterNames = new Set([...RECRUITERS.map(r => r.name), _TC.lead].filter(Boolean));
    function resolveTeamOwners(primary, secondaryRaw) {
      const owners = [];
      if (teamRecruiterNames.has(primary)) owners.push(primary);
      const secondaries = (secondaryRaw || '').split(',').map(s => s.trim()).filter(Boolean);
      secondaries.forEach(n => { if (teamRecruiterNames.has(n) && !owners.includes(n)) owners.push(n); });
      return owners;
    }

    const liveByRec = {};
    for (const row of reqRows2.slice(rHdrIdx + 1)) {
      const reqId    = (row[rReqCol] || '').trim();
      const recruiter = (row[rRecCol] || '').trim();
      const secRecruitersRaw = rSecRecCol >= 0 ? (row[rSecRecCol] || '').trim() : '';
      const status   = row[rStatCol] || '';
      const ghJobId  = rJobIdCol >= 0 ? (row[rJobIdCol] || '').toString().trim() : '';
      if (!reqId) continue;
      // Always build ghJobId map for ALL reqs (including closed) so accepted offers get links
      if (ghJobId) window._ghJobIdMap[reqId] = ghJobId;
      const owners = resolveTeamOwners(recruiter, secRecruitersRaw);
      // Capture this team's own open reqs for the headcount table (exclude
      // E-reqs, regardless of pipeline entry) — scoped to this team's own
      // recruiters/lead (via Primary or Secondary Recruiter), not the whole
      // org. Pushed ONCE per req (not once per owner) so the table's total
      // count never double-counts a dual-owned req; `recruiters` carries the
      // full owner list so the recruiter filter still surfaces it for each.
      if (status === 'Open' && !reqId.startsWith('E') && owners.length) {
        window._openReqsData.push({
          reqId,
          recruiter: owners.join(' / '),
          recruiters: owners,
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
      // Only add to live pipeline for open reqs with a known team owner and pipeline entry
      if (status !== 'Open' || !owners.length) continue;
      const pipe = pipeByReq[reqId];
      if (!pipe) continue;
      pipe.ghJobId = ghJobId;
      // Fan out to EACH team owner's individual tab — but tag with the reqId
      // so team-wide aggregation (below) can dedupe before summing.
      owners.forEach(owner => {
        if (!liveByRec[owner]) liveByRec[owner] = [];
        liveByRec[owner].push(pipe);
      });
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
    // Dedupe by reqId before summing — a req staffed by two team recruiters
    // (one Primary, one Secondary) appears in both of their LIVE_PIPELINE
    // arrays so each sees it on their own tab, but must only be counted once
    // in the team-wide totals below.
    const agg = { rs:0, ia:0, ir:0, hc:0, offer:0 };
    const seenReqIds = new Set();
    RECRUITERS.forEach(r => {
      const reqs = LIVE_PIPELINE[r.name] || [];
      reqs.forEach(req => {
        if (seenReqIds.has(req.reqId)) return;
        seenReqIds.add(req.reqId);
        agg.rs    += req.rs    || 0;
        agg.ia    += req.ia    || 0;
        agg.ir    += req.ir    || 0;
        agg.hc    += req.hc    || 0;
        agg.offer += req.offer || 0;
      });
    });
    let openJobsCount = seenReqIds.size;
    const nowLabel = `Week of ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    const liveSnapshot = {
      weeks: [nowLabel], rs: [agg.rs], ia: [agg.ia], ir: [agg.ir], hc: [agg.hc], offer: [agg.offer], openJobs: [openJobsCount]
    };
    window._livePipelineData = liveSnapshot;
    try {
      if (openJobsCount === 0) renderFunnelEmpty(_TC.name);
      else renderFunnel(liveSnapshot);
    } catch(e) { console.warn('[Pipeline] renderFunnel from live snapshot failed:', e); }
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

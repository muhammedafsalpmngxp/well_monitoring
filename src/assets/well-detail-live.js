/**
 * well-detail-live.js
 * Overrides window.awShowDetail (defined by app-globals.js) to fetch real
 * per-well data from the .NET Wells API and render the full detail overlay
 * with live WMR data instead of the hardcoded WD lookup table.
 *
 * Loaded AFTER app-globals.js via GlobalsLoaderService.
 * Falls back to the original awShowDetail for any well not found in the API.
 */
(function () {
  'use strict';

  /* ── Formatting helpers (mirror app-globals.js) ───────────────────── */
  function wdFmtPct(v) {
    return v == null ? '\u2014' : (+v).toFixed(1) + '%';
  }
  function wdFmtDate(s) {
    if (!s) return '\u2014';
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      var parts = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
      if (parts) d = new Date(parts[2] + ' ' + parts[1] + ', ' + parts[3]);
      if (isNaN(d.getTime())) return s;
    }
    var dd  = String(d.getDate()).padStart(2, '0');
    var mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return dd + '-' + mmm + '-' + d.getFullYear();
  }
  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── Theme-aware colour palette (mirrors app-globals.js T object) ─── */
  function buildColors() {
    var isLight = document.documentElement.classList.contains('navbar-light') ||
                  !document.documentElement.classList.contains('navbar-dark');
    if (isLight) return {
      isLight:true,
      overlayBg:'#f5f5f7', headerBg:'#ffffff', headerBdr:'1px solid rgba(0,0,0,0.08)',
      navy2:'#ffffff', cream:'#1F3864', dimtext:'#7F7F7F', mutedTxt:'#A5A5A5',
      codeTxt:'#A5A5A5', accent:'#29378d',
      backBtnCol:'#1F3864', backBtnBg:'rgba(0,0,0,0.04)', backBtnBdr:'1px solid rgba(0,0,0,0.1)',
      breadcrumb:'#7F7F7F',
      tagBg:'rgba(41,55,141,0.08)',  tagBdr:'rgba(41,55,141,0.25)',  tagCol:'#29378d',
      tag2Bg:'rgba(0,176,80,0.08)',   tag2Bdr:'rgba(0,176,80,0.2)',    tag2Col:'#00B050',
      pdoBg:'rgba(0,0,0,0.05)', pdoBdr:'1px solid rgba(0,0,0,0.1)', pdoCol:'#7F7F7F',
      liveCol:'#00B050', cardBdr:'1px solid rgba(0,0,0,0.08)',
      cellBg:'#ffffff', cellBdr:'1px solid rgba(0,0,0,0.06)',
      barTrack:'rgba(0,0,0,0.06)', gridLine:'rgba(0,0,0,0.06)', phLine:'rgba(0,0,0,0.10)',
      circleBgOff:'rgba(0,0,0,0.04)', circleBdrOff:'2px solid rgba(0,0,0,0.14)',
      ringTrack:'rgba(0,0,0,0.08)',
      tooltipBg:'rgba(255,255,255,0.98)', tooltipTitleCol:'#7F7F7F',
      tooltipBodyCol:'#1F3864', tooltipBdr:'rgba(0,0,0,0.12)',
      targetLine:'rgba(165,165,165,0.5)',
      mapBg:'#D6E4F0', mapBdr:'1px solid rgba(41,55,141,0.15)',
      infoBg:'rgba(41,55,141,0.06)', infoBdr:'1px solid rgba(41,55,141,0.15)',
      histHighBg:'rgba(255,192,0,0.08)', histHighBdr:'1px solid rgba(255,192,0,0.18)',
      reasonBg:'rgba(0,0,0,0.03)', reasonBdr:'1px solid rgba(0,0,0,0.06)',
      remarkBg:'#f8f9fb', remarkBdr:'1px solid rgba(0,0,0,0.06)',
      remarkDotCol:'#00B0F0', remarkPillBg:'rgba(0,0,0,0.05)',
      remarkPillCol:'#7F7F7F', remarkPillBdr:'1px solid rgba(0,0,0,0.08)',
      cyanCol:'#00B0F0', purpleCol:'#1F3864', goldCol:'#FFC000',
      greenCol:'#00B050', redCol:'#FF0000', amberCol:'#FFC000',
      notStartBg:'rgba(165,165,165,0.08)', notStartCol:'#A5A5A5', notStartBdr:'1px solid rgba(165,165,165,0.2)',
      inProgBg:'rgba(0,176,240,0.08)',   inProgCol:'#00B0F0',  inProgBdr:'1px solid rgba(0,176,240,0.2)',
      completeBg:'rgba(0,176,80,0.08)',  completeCol:'#00B050', completeBdr:'1px solid rgba(0,176,80,0.2)',
      svgMapDot:'#00B0F0'
    };
    return {
      isLight:false,
      overlayBg:'#0b1538', headerBg:'#091726', headerBdr:'1px solid rgba(41,55,141,0.22)',
      navy2:'#112448', cream:'#D6E4F0', dimtext:'rgba(214,228,240,0.6)', mutedTxt:'rgba(200,215,240,0.5)',
      codeTxt:'rgba(200,215,240,0.25)', accent:'#29378d',
      backBtnCol:'rgba(200,215,240,0.7)', backBtnBg:'rgba(255,255,255,0.04)', backBtnBdr:'1px solid rgba(255,255,255,0.1)',
      breadcrumb:'rgba(200,215,240,0.7)',
      tagBg:'rgba(41,55,141,0.15)',  tagBdr:'rgba(41,55,141,0.3)',  tagCol:'#29378d',
      tag2Bg:'rgba(0,176,80,0.1)',    tag2Bdr:'rgba(0,176,80,0.25)', tag2Col:'#00B050',
      pdoBg:'rgba(255,255,255,0.07)', pdoBdr:'1px solid rgba(255,255,255,0.12)', pdoCol:'rgba(200,215,240,0.65)',
      liveCol:'#00B050', cardBdr:'1px solid rgba(41,55,141,0.28)',
      cellBg:'rgba(10,24,48,0.45)', cellBdr:'1px solid rgba(255,255,255,0.05)',
      barTrack:'rgba(255,255,255,0.06)', gridLine:'rgba(255,255,255,0.04)', phLine:'rgba(255,255,255,0.08)',
      circleBgOff:'rgba(255,255,255,0.05)', circleBdrOff:'2px solid rgba(255,255,255,0.1)',
      ringTrack:'rgba(255,255,255,0.07)',
      tooltipBg:'rgba(9,23,38,0.95)', tooltipTitleCol:'rgba(200,215,240,0.7)',
      tooltipBodyCol:'#fff', tooltipBdr:'rgba(255,255,255,0.1)',
      targetLine:'rgba(200,215,240,0.35)',
      mapBg:'rgba(12,30,62,0.7)', mapBdr:'1px solid rgba(255,255,255,0.05)',
      infoBg:'rgba(41,55,141,0.09)', infoBdr:'1px solid rgba(41,55,141,0.2)',
      histHighBg:'rgba(255,192,0,0.15)', histHighBdr:'1px solid rgba(255,192,0,0.28)',
      reasonBg:'rgba(10,24,48,0.6)', reasonBdr:'1px solid rgba(255,255,255,0.06)',
      remarkBg:'rgba(10,24,48,0.5)', remarkBdr:'1px solid rgba(255,255,255,0.06)',
      remarkDotCol:'#00B0F0', remarkPillBg:'rgba(255,255,255,0.06)',
      remarkPillCol:'rgba(200,215,240,0.6)', remarkPillBdr:'1px solid rgba(255,255,255,0.1)',
      cyanCol:'#00B0F0', purpleCol:'#29378d', goldCol:'#FFC000',
      greenCol:'#00B050', redCol:'#FF0000', amberCol:'#FFC000',
      notStartBg:'rgba(255,255,255,0.06)',  notStartCol:'rgba(200,215,240,0.45)', notStartBdr:'1px solid rgba(255,255,255,0.1)',
      inProgBg:'rgba(0,176,240,0.12)',      inProgCol:'#00B0F0',  inProgBdr:'1px solid rgba(0,176,240,0.25)',
      completeBg:'rgba(0,176,80,0.12)',     completeCol:'#00B050', completeBdr:'1px solid rgba(0,176,80,0.25)',
      svgMapDot:'#00B0F0'
    };
  }

  /* ── Status helpers ──────────────────────────────────────────────── */
  var STATUS_LABELS = { completed:'COMPLETED', inprogress:'IN PROGRESS', early:'EARLY STAGE', planned:'PLANNED', onhold:'ON HOLD', critical:'CRITICAL', due:'OVERDUE', delayed:'DELAYED (AT RISK)', ontime:'ON TIME', accelerated:'ACCELERATED' };
  var STATUS_STYLES = {
    'COMPLETED':         {bg:'rgba(0,176,80,0.1)',   border:'rgba(0,176,80,0.3)',   color:'#00B050'},
    'COMPLETED (EARLY)': {bg:'rgba(0,176,80,0.1)',   border:'rgba(0,176,80,0.3)',   color:'#00B050'},
    'COMPLETED (ON TIME)':{bg:'rgba(0,176,80,0.1)',  border:'rgba(0,176,80,0.3)',   color:'#00B050'},
    'COMPLETED (LATE)':  {bg:'rgba(255,192,0,0.1)',  border:'rgba(255,192,0,0.3)', color:'#FFC000'},
    'IN PROGRESS':       {bg:'rgba(0,176,240,0.1)',  border:'rgba(0,176,240,0.3)', color:'#00B0F0'},
    'EARLY STAGE':       {bg:'rgba(255,192,0,0.1)',  border:'rgba(255,192,0,0.3)', color:'#FFC000'},
    'PLANNED':           {bg:'rgba(41,55,141,0.1)', border:'rgba(41,55,141,0.3)',color:'#29378d'},
    'ON HOLD':           {bg:'rgba(255,0,0,0.1)',    border:'rgba(255,0,0,0.3)',   color:'#FF0000'},
    'CRITICAL':          {bg:'rgba(255,0,0,0.1)',    border:'rgba(255,0,0,0.3)',   color:'#FF0000'},
    'OVERDUE':            {bg:'rgba(255,0,0,0.1)',    border:'rgba(255,0,0,0.3)',   color:'#DC2626'},
    'DELAYED (AT RISK)': {bg:'rgba(255,0,0,0.1)',    border:'rgba(255,0,0,0.3)',   color:'#FF0000'},
    'ON TIME':           {bg:'rgba(0,176,80,0.1)',   border:'rgba(0,176,80,0.3)',  color:'#00B050'},
    'ACCELERATED':       {bg:'rgba(0,176,240,0.1)',  border:'rgba(0,176,240,0.3)', color:'#00B0F0'}
  };

  function phaseBadge(status, T) {
    if (!status) return T.notStartBg + ';color:' + T.notStartCol + ';border:' + T.notStartBdr;
    var u = (status || '').toUpperCase();
    if (u === 'COMPLETED' || u === 'COMPLETE')
      return T.completeBg + ';color:' + T.completeCol + ';border:' + T.completeBdr;
    if (u === 'IN PROGRESS')
      return T.inProgBg + ';color:' + T.inProgCol + ';border:' + T.inProgBdr;
    return T.notStartBg + ';color:' + T.notStartCol + ';border:' + T.notStartBdr;
  }
  function phaseLabel(status) {
    if (!status) return 'NOT STARTED';
    var u = (status || '').toUpperCase();
    if (u === 'COMPLETED' || u === 'COMPLETE') return 'COMPLETE';
    if (u === 'IN PROGRESS') return 'IN PROGRESS';
    return 'NOT STARTED';
  }

  /* ── Full HTML renderer ──────────────────────────────────────────── */
  function renderDetail(name, d) {
    // Cache live data so wellReportShow can use it
    window._wdLiveCache = window._wdLiveCache || {};
    window._wdLiveCache[name] = d;
    // Store current detail for KPI cards (variance, askRate, ratePerDay)
    window._wdCurrentDetail = d;

    var overlay = document.getElementById('awDetailOverlay');
    var inner   = document.getElementById('awDetailInner');
    if (!overlay || !inner) return;

    var T    = buildColors();
    var isLight  = T.isLight;
    var navy2    = T.navy2;
    var dimtext  = T.dimtext;
    var cream    = T.cream;
    var accent   = T.accent;

    // Status — use wellStatus from workgroups API (Due/Delayed/On Time/Accelerated/Completed)
    // if available. Falls back to AW_WELLS grid status, then API status.
    var sCls = d.status || 'planned';
    var sLabel = '';
    var ss = null;
    // Priority 1: wellStatus from workgroups API (business rule derived)
    var wgStatus = d.wellStatus || (window._wdWellStatus && window._wdWellStatus[String(name)]);
    if (wgStatus) {
      sLabel = wgStatus.toUpperCase();
      if (sLabel === 'DUE') sLabel = 'OVERDUE';
      ss = STATUS_STYLES[sLabel] || null;
      // Map wellStatus to sCls for downstream logic
      if (wgStatus.indexOf('Completed') !== -1) sCls = 'completed';
      else if (wgStatus === 'Due') sCls = 'due';
      else if (wgStatus === 'Delayed (At Risk)') sCls = 'delayed';
      else if (wgStatus === 'On Time') sCls = 'ontime';
      else if (wgStatus === 'Accelerated') sCls = 'accelerated';
    }
    // Priority 2: AW_WELLS grid status (legacy operational status)
    if (!ss) {
      try {
        var awRows = (window.AW_WELLS && window.AW_WELLS.length) ? window.AW_WELLS : [];
        var awRow = null;
        for (var _i = 0; _i < awRows.length; _i++) {
          if (String(awRows[_i].wellId) === String(name)) { awRow = awRows[_i]; break; }
        }
        if (awRow && awRow.status && STATUS_LABELS[awRow.status]) sCls = awRow.status;
      } catch (e) { /* keep API status on any lookup error */ }
      sLabel = STATUS_LABELS[sCls] || sCls.toUpperCase();
      ss = STATUS_STYLES[sLabel] || STATUS_STYLES['PLANNED'];
    }
    // For completed wells, show the specific completion category (Due Completed vs
    // Not Due Accelerated) instead of the generic "COMPLETED", keeping the green style.
    if (sCls === 'completed' && d.completionCategory) {
      sLabel = String(d.completionCategory).toUpperCase();
    }
    var isCritical = (sCls === 'critical');
    var progressCol    = isCritical ? '#FF0000' : accent;
    var ringStrokeCol  = isCritical ? '#FF0000' : ss.color;

    // Computed derived values
    var ov           = d.overallProgressPct || 0;
    var locPrepPct   = (d.locPrepPct > 0) ? d.locPrepPct : (sCls === 'completed' || ov >= 100 ? 100 : 0);
    var flConstr     = d.constructionPct || 0;
    var flComm       = d.commissioningPct || 0;
    var flReadiness  = Math.round((flConstr + flComm) / 2);
    var infraCompletion = Math.round((locPrepPct + flConstr) / 2);

    // Completion risk
    var completionRisk, riskDesc, rcCol;
    if (sCls === 'completed') {
      completionRisk = 'Low'; riskDesc = 'Completed'; rcCol = T.greenCol;
    } else if (ov >= 60) {
      completionRisk = 'Low'; riskDesc = 'On track'; rcCol = T.greenCol;
    } else if (ov >= 30) {
      completionRisk = 'Medium'; riskDesc = 'Monitor closely'; rcCol = T.goldCol;
    } else {
      completionRisk = d.isDelayed ? 'High' : 'Medium';
      riskDesc = d.isDelayed ? 'Delayed — action needed' : 'Early stage';
      rcCol = d.isDelayed ? T.redCol : T.goldCol;
    }

    // Data completeness: count non-null / 12 key fields
    var fields = [d.pdoWellId, d.wellType, d.rigNo, d.wellLocation, d.projectId,
                  d.weekNumber, d.northing, d.easting, d.flowLineDl,
                  d.rigOnDate, d.rigOffDate, d.remarks];
    var filledCount = fields.filter(function(f){ return f && String(f).trim() !== ''; }).length;
    var dataCompleteness = Math.round((filledCount / fields.length) * 100);

    // Velocity: last two timeline points delta
    var velocity = '+0%';
    if (d.timeline && d.timeline.length >= 2) {
      var last  = d.timeline[d.timeline.length - 1].progressPct;
      var prev  = d.timeline[d.timeline.length - 2].progressPct;
      var delta = Math.round(last - prev);
      velocity  = (delta >= 0 ? '+' : '') + delta + '%';
    }

    // Planned % and Variance from backend (same formula as wells list)
    var plannedPct = (d.plannedPct != null) ? Math.round(d.plannedPct) : 0;
    var pvVariance   = (d.variance != null) ? Math.round(d.variance) : Math.round(ov - plannedPct);
    var pvVarStr     = (pvVariance >= 0 ? '+' : '') + pvVariance + '%';
    var pvVarCol     = pvVariance >= 0 ? T.greenCol : T.redCol;
    var pvVarLabel   = pvVariance > 0 ? 'ahead of plan' : pvVariance < 0 ? 'behind plan' : 'on plan';

    // WMR status label
    var wmrStatus = sCls === 'completed' ? 'Closed' : (sCls === 'onhold' ? 'On Hold' : 'Open');

    // Phase 8 breakdown
    var phases8 = [
      { l:'Loc. Prep',    v: d.locPrepStatus === 'Completed' ? true : locPrepPct },
      { l:'Drilling',     v: null },
      { l:'Procurement',  v: null },
      { l:'Commissioning',v: d.flCommissioningStatus === 'Completed' ? true : (flComm > 0 ? flComm : null) },
      { l:'Mechanical',   v: null },
      { l:'Construction', v: d.flConstructionStatus === 'Completed' ? true : (flConstr > 0 ? flConstr : null) },
      { l:'Civil',        v: null },
      { l:'Completion',   v: ov >= 95 ? true : (ov > 0 ? ov : null) }
    ];
    var phasesComplete = phases8.filter(function(p){ return p.v === true; }).length;
    var phaseSum = 0;
    phases8.forEach(function(p){ phaseSum += p.v === true ? 100 : (typeof p.v === 'number' ? p.v : 0); });
    var avgPhase = Math.round(phaseSum / 8);

    var html = '';

    // Set overlay background
    overlay.style.background = T.overlayBg;

    /* ── HEADER ─────────────────────────────────────────────────────── */
    html += '<div style="background:' + T.headerBg + ';border-bottom:' + T.headerBdr + ';padding:10px">';

    // Row 1 — Breadcrumb
    html += '<div style="display:flex;align-items:center;gap:8px;font-size:9.5pt;margin-bottom:14px;flex-wrap:wrap">' +
      '<span onclick="awCloseDetail()" style="display:inline-flex;align-items:center;gap:4px;color:var(--txt-2,#64748b);font-size:9pt;font-weight:500;cursor:pointer;margin-right:4px;flex-shrink:0">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Back to All Wells</span>' +
      '<a style="color:' + accent + ';cursor:pointer;text-decoration:none" onclick="awNavTo(\'cmdoverview\')">Overview</a>' +
      '<span style="color:' + dimtext + '">›</span>' +
      '<a style="color:' + accent + ';cursor:pointer;text-decoration:none" onclick="awCloseDetail()">All Wells</a>' +
      '<span style="color:' + dimtext + '">›</span>' +
      '<span style="color:' + T.breadcrumb + '">' + esc(name) + '</span>' +
    '</div>';

    // Row 2 — Title + status (left) · Actions (right)
    var wellNameStr = (d.wellName && String(d.wellName).trim()) ? String(d.wellName).trim() : '';
    var titleStr    = wellNameStr ? (String(name) + ' - ' + wellNameStr) : String(name);
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px;flex-wrap:wrap">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<span style="color:' + cream + ';font-size:18pt;font-weight:700;letter-spacing:0.3px;line-height:1">' + esc(titleStr) + '</span>' +
        '<div id="wdStatusBadge" style="display:inline-flex;align-items:center;gap:6px;font-size:9pt;font-weight:700;padding:4px 12px;border-radius:6px;white-space:nowrap;background:' + ss.bg + ';border:1px solid ' + ss.border + ';color:' + ss.color + '">' +
          '<div style="width:7px;height:7px;border-radius:50%;background:' + ss.color + ';animation:pulse 1.8s ease-in-out infinite;flex-shrink:0"></div>' +
          sLabel +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">' +
        '<button type="button" id="wdFilterBtn" class="aw-well-report-btn" title="Filters" onclick="window._wdToggleFilterPanel()" style="padding:6px 10px">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>' +
        '</button>' +
        '<button type="button" class="aw-well-report-btn" title="Open Well Report" onclick="wellReportShow(\'' + name.replace(/'/g, "\\'") + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
          '<span>Well Report</span>' +
        '</button>' +
        '<button type="button" class="aw-ai-rec-btn" title="AI Recovery Assistant" onclick="aiRecoveryShow(\'' + name.replace(/'/g, "\\'") + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
          '<span style="margin-left:6px;font-size:10pt;font-weight:600">Recovery Assistant</span>' +
        '</button>' +
      '</div>' +
    '</div>';

    // Filter sidebar panel (slides from right)
    html += '<div id="wdFilterPanel" style="display:none;position:fixed;top:0;right:0;bottom:0;width:320px;background:var(--surface,#fff);' +
      'border-left:1px solid var(--border,#e2e8f0);box-shadow:-4px 0 20px rgba(0,0,0,0.08);z-index:10000;overflow-y:auto;transition:transform 0.2s ease">' +
      '<div style="padding:16px 20px;border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:11pt;font-weight:700;color:var(--txt-1)">Filters</span>' +
        '<button type="button" onclick="window._wdToggleFilterPanel()" style="border:none;background:none;cursor:pointer;color:var(--txt-muted,#64748b);padding:4px">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div style="padding:16px 20px;display:flex;flex-direction:column;gap:16px">' +
        // Cluster
        '<div>' +
          '<label style="font-size:8.5pt;font-weight:600;color:var(--txt-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Cluster</label>' +
          '<select id="wdFilterCluster" class="wd-filter-select" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 12px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)">' +
            '<option value="">—</option>' +
          '</select>' +
        '</div>' +
        // Site
        '<div>' +
          '<label style="font-size:8.5pt;font-weight:600;color:var(--txt-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Site</label>' +
          '<select id="wdFilterSite" class="wd-filter-select" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 12px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)">' +
            '<option value="">—</option>' +
          '</select>' +
        '</div>' +
        // Well Type
        '<div>' +
          '<label style="font-size:8.5pt;font-weight:600;color:var(--txt-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Well Type</label>' +
          '<select id="wdFilterWellType" class="wd-filter-select" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 12px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)">' +
            '<option value="">—</option>' +
          '</select>' +
        '</div>' +
        // Well ID
        '<div>' +
          '<label style="font-size:8.5pt;font-weight:600;color:var(--txt-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Well ID</label>' +
          '<div style="position:relative">' +
            '<input id="wdFilterWellIdSearch" type="text" placeholder="Search Well ID..." autocomplete="off" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 12px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)" />' +
            '<div id="wdFilterWellIdList" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:6px;margin-top:2px;z-index:10;box-shadow:0 4px 12px rgba(0,0,0,0.1)"></div>' +
          '</div>' +
          '<input type="hidden" id="wdFilterWellId" />' +
        '</div>' +
        // Project
        '<div>' +
          '<label style="font-size:8.5pt;font-weight:600;color:var(--txt-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Project</label>' +
          '<select id="wdProjectSelect" class="wd-filter-select" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 12px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)">' +
            '<option value="">All Projects</option>' +
          '</select>' +
        '</div>' +
        // Timeline Date Range
        '<div>' +
          '<label style="font-size:8.5pt;font-weight:600;color:var(--txt-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px">Timeline Date Range</label>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<input id="wdTimelineFrom" type="date" class="wd-filter-select" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 10px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)" />' +
            '<input id="wdTimelineTo" type="date" class="wd-filter-select" style="width:100%;font-size:9.5pt;font-family:var(--font-family);padding:7px 10px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--txt-1)" />' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">' +
            '<button type="button" id="wdTimelineClear" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border,#e2e8f0);background:transparent;color:var(--txt-muted,#64748b);font-size:9pt;cursor:pointer">Clear</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Row 3 — Metadata strip + Live indicator
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
      '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;font-size:9pt;color:' + dimtext + '">' +
        (d.rigNo        ? '<span style="letter-spacing:0.5px">RIG NO <b style="color:' + cream + ';font-weight:500;margin-left:3px;letter-spacing:0">' + esc(d.rigNo) + '</b></span>' : '') +
        '<span style="letter-spacing:0.5px">PROJECT <b id="wdMetaProjectName" style="color:' + cream + ';font-weight:500;margin-left:3px;letter-spacing:0">' + esc(d.projectId || '—') + '</b></span>' +
        (d.rigOnDate    ? '<span style="letter-spacing:0.5px">RIG ON <b style="color:' + cream + ';font-weight:500;margin-left:3px;letter-spacing:0">' + esc(wdFmtDate(d.rigOnDate)) + '</b></span>' : '') +
        (d.rigOffDate   ? '<span style="letter-spacing:0.5px">RIG OFF <b style="color:' + cream + ';font-weight:500;margin-left:3px;letter-spacing:0">' + esc(wdFmtDate(d.rigOffDate)) + '</b></span>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:5px;color:' + T.liveCol + ';font-size:9pt;flex-shrink:0">' +
        '<div style="width:6px;height:6px;border-radius:50%;background:' + T.liveCol + '"></div> Live · WMR data' +
      '</div>' +
    '</div>';

    html += '</div>';

    /* ── 5 KPI CARDS ─ standardised .kpi pattern (matches execsummary / allwells) ─ */
    html += '<div class="kpi-grid" style="padding:10px;margin-bottom:0">';

    var ovStatus  = ov >= 100 ? 'COMPLETED' : ov > 0 ? 'IN PROGRESS' : 'NOT STARTED';
    var flStatus  = flReadiness >= 95 ? 'COMPLETED' : flReadiness > 0 ? 'IN PROGRESS' : 'NOT STARTED';

    // Helper — renders a label+icon row with inline sizing so it works without
    // page-scoped CSS (the standard .kpi-icon styles only apply inside specific
    // page IDs; this overlay isn't one of them).
    var kpiHead = function(label, svgInner, mainCol, softBg, infoId) {
      var infoBtn = wdRelBadge(infoId);
      return '<div class="kpi-head" style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:6px">' +
        '<span style="display:inline-flex;align-items:center;gap:6px;min-width:0;flex:1">' +
          '<span class="kpi-label" style="font-size:10pt;font-weight:900;letter-spacing:0.7px;margin:0;line-height:1.2">' + label + '</span>' + infoBtn +
        '</span>' +
        '<span class="kpi-icon" aria-hidden="true" style="width:32px;height:32px;flex-shrink:0;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;background:' + softBg + ';color:' + mainCol + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svgInner + '</svg>' +
        '</span>' +
      '</div>';
    };

    var blueCol = isCritical ? T.redCol : accent;
    var blueSoft = isCritical ? (isLight ? 'rgba(255,0,0,0.10)' : 'rgba(255,0,0,0.16)') : (isLight ? 'rgba(41,55,141,0.12)' : 'rgba(41,55,141,0.16)');
    var tealSoft = isLight ? 'rgba(0,176,240,0.12)' : 'rgba(0,176,240,0.16)';
    var purpleSoft = isLight ? 'rgba(41,55,141,0.10)' : 'rgba(41,55,141,0.16)';
    var goldSoft = isLight ? 'rgba(255,192,0,0.14)' : 'rgba(255,192,0,0.18)';
    var greenSoft = isLight ? 'rgba(0,176,80,0.12)' : 'rgba(0,176,80,0.16)';
    var redSoft = isLight ? 'rgba(255,0,0,0.10)' : 'rgba(255,0,0,0.16)';

    // 1: Overall Well Progress (PMS-based)
    var ovTarget = plannedPct || 100;
    var ovGap = Math.round(ov - ovTarget);
    // Badge shows well status (Due/Delayed/On Time/Accelerated/Completed)
    var ovBadge = sLabel || 'OVERDUE';
    var ovBadgeCol = (sCls === 'completed' || sCls === 'accelerated') ? T.greenCol
      : (sCls === 'ontime') ? T.greenCol
      : (sCls === 'due') ? T.redCol
      : (sCls === 'delayed' || sCls === 'critical') ? T.redCol
      : T.goldCol;
    var ovBadgeBg = (sCls === 'completed' || sCls === 'accelerated' || sCls === 'ontime') ? 'rgba(0,176,80,0.1)'
      : (sCls === 'due') ? 'rgba(255,0,0,0.1)'
      : (sCls === 'delayed' || sCls === 'critical') ? 'rgba(255,0,0,0.1)'
      : 'rgba(255,192,0,0.1)';
    html += '<div class="kpi k-blue" style="display:flex;flex-direction:column">' +
      kpiHead('Overall Well Progress', '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', blueCol, blueSoft, 'kpiOverallProgress') +
      '<div class="kpi-val" id="kpiOverallVal" style="color:' + blueCol + '">' + wdFmtPct(ov) + '</div>' +
      '<div class="kpi-bar-track" style="margin-top:8px"><div class="kpi-bar-fill" id="kpiOverallBar" style="background:' + blueCol + ';width:' + Math.min(ov,100) + '%"></div></div>' +
      '<div style="flex:1"></div>' +
      '<div id="kpiOverallBadge" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:8.5pt;font-weight:600;padding:2px 8px;border-radius:4px;background:' + ovBadgeBg + ';color:' + ovBadgeCol + ';width:fit-content">' + ovBadge + '</div>' +
      (d.rigOnDate ? '<div class="kpi-unit" style="margin-top:4px">Rig On: ' + wdFmtDate(d.rigOnDate) + '</div>' : '') +
    '</div>';

    // 2: Variance (Asking Rate - Current Rate)
    html += '<div class="kpi k-gold" id="kpiVarianceCard" style="display:flex;flex-direction:column">' +
      kpiHead('Variance', '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>', T.goldCol, goldSoft, 'kpiVariance') +
      '<div class="kpi-val" id="kpiVarianceVal" style="color:' + T.goldCol + '">\u2014</div>' +
      '<div id="kpiVarianceBadge" style="margin-top:6px"></div>' +
      '<div id="kpiVarianceChildren" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>' +
      '<div style="flex:1"></div>' +
    '</div>';

    // 3: Total WBS (not started, in-progress, completed)
    html += '<div class="kpi k-teal" id="kpiWbsCard" style="display:flex;flex-direction:column">' +
      kpiHead('Total WBS', '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>', T.cyanCol, tealSoft, 'kpiTotalWbs') +
      '<div class="kpi-val" id="kpiWbsVal" style="color:' + T.cyanCol + '">\u2014</div>' +
      '<div id="kpiWbsBar" style="margin-top:8px"></div>' +
      '<div style="flex:1"></div>' +
      '<div class="wd-leg" id="kpiWbsUnit">Loading\u2026</div>' +
    '</div>';

    // 4: Total Activities (not started, in-progress, completed)
    html += '<div class="kpi k-blue" id="kpiActivitiesCard" style="display:flex;flex-direction:column">' +
      kpiHead('Total Activities', '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>', T.purpleCol, purpleSoft, 'kpiTotalActivities') +
      '<div class="kpi-val" id="kpiActivitiesVal" style="color:' + T.purpleCol + '">\u2014</div>' +
      '<div id="kpiActBar" style="margin-top:8px"></div>' +
      '<div style="flex:1"></div>' +
      '<div class="wd-leg" id="kpiActivitiesUnit">Loading\u2026</div>' +
    '</div>';

    // 5: Completion Risk (initial render, updated async with asking/norms ratio)
    var rcKpiCls = completionRisk === 'High' ? 'red' : completionRisk === 'Medium' ? 'amber' : 'green';
    var rcMainCol = rcKpiCls === 'red' ? T.redCol : rcKpiCls === 'amber' ? T.goldCol : T.greenCol;
    var rcSoft    = rcKpiCls === 'red' ? redSoft : rcKpiCls === 'amber' ? goldSoft : greenSoft;
    var rcBadgeBg = rcKpiCls === 'red' ? 'rgba(255,0,0,0.1)' : rcKpiCls === 'amber' ? 'rgba(255,192,0,0.1)' : 'rgba(0,176,80,0.1)';
    html += '<div class="kpi k-' + (rcKpiCls === 'amber' ? 'gold' : rcKpiCls) + '" id="kpiRiskCard" style="display:flex;flex-direction:column">' +
      kpiHead('Completion Risk', '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', rcMainCol, rcSoft, 'kpiCompletionRisk') +
      '<div class="kpi-val" id="kpiRiskVal" style="color:' + rcMainCol + '">' + completionRisk + '</div>' +
      '<div style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:8.5pt;font-weight:600;padding:2px 8px;border-radius:4px;background:' + rcBadgeBg + ';color:' + rcMainCol + ';width:fit-content" id="kpiRiskBadge">' + pvVarLabel + '</div>' +
      '<div style="flex:1"></div>' +
      '<div class="kpi-bar-track"><div class="kpi-bar-fill" id="kpiRiskBar" style="background:' + progressCol + ';width:' + Math.min(ov,100) + '%"></div></div>' +
      '<div class="kpi-unit" id="kpiRiskUnit">planned ' + wdFmtPct(plannedPct) + ' / actual ' + wdFmtPct(ov) + '</div>' +
    '</div>';

    html += '</div>';

    /* ── ROW 1b: Workgroup Progress (average activity progress per group) ─── */
    html += '<div style="padding:0 10px 10px">' +
      '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px">' +
          '<div>' +
            '<div style="display:inline-flex;align-items:center;gap:6px;color:' + cream + ';font-size:13pt;font-weight:700;line-height:1.2">Job Progress' +
              wdRelBadge('workProgress') +
            '</div>' +
            '<div style="color:' + dimtext + ';font-size:9pt;margin-top:2px">PMS completed per workgroup</div>' +
          '</div>' +
          // Status legend (matches the per-bar colours).
          '<div style="display:inline-flex;align-items:center;gap:14px;flex-shrink:0;font-size:8.5pt;color:' + T.mutedTxt + ';font-weight:500">' +
            '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#00B050"></span>Completed</span>' +
            '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#29378d"></span>In Progress</span>' +
            '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#DC2626"></span>Overdue</span>' +
            '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#9CA3AF"></span>Not Started</span>' +
          '</div>' +
        '</div>' +
        '<div id="detailWorkgroupChart" style="width:100%;height:420px"></div>' +
      '</div>' +
    '</div>';

    /* ── ROW 1c: Activity Gantt (mirrors Well Execution Dashboard) ───── */
    var wbsHeadBg = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
    var wbsRowAlt = isLight ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.02)';
    var wbsBorder = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    html += '<div style="padding:0 10px 10px">' +
      '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
        '<div style="margin-bottom:10px">' +
          '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:13pt;font-weight:700;line-height:1.2">Activity Gantt' +
            wdRelBadge('activityGantt') +
          '</div>' +
          '<div style="color:' + dimtext + ';font-size:9pt;margin-top:2px">Activity / WBS schedule — plan vs actual progress</div>' +
        '</div>' +
        '<div style="display:flex;align-items:stretch;border:1px solid ' + wbsBorder + ';border-radius:10px;overflow:hidden">' +
          '<div style="width:380px;flex:none;border-right:1px solid ' + wbsBorder + ';display:flex;flex-direction:column;background:' + (isLight?'#fff':navy2) + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 12px;height:36px;border-bottom:1px solid ' + wbsBorder + '">' +
              '<span style="font-size:10pt;font-weight:700;color:var(--txt-1)">Activity / WBS</span>' +
              '<div style="display:inline-flex;align-items:center;background:' + wbsHeadBg + ';border:1px solid ' + wbsBorder + ';border-radius:8px;padding:2px;gap:2px">' +
                '<button id="agModeTree" type="button" onclick="agSetMode(\'tree\')" style="display:inline-flex;align-items:center;gap:4px;border:0;border-radius:6px;padding:3px 8px;font-size:8.5pt;font-weight:600;cursor:pointer;background:' + (isLight?'#fff':'rgba(41,55,141,0.18)') + ';color:#29378d;box-shadow:0 1px 2px rgba(0,0,0,0.06)">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="14" y1="18" x2="20" y2="18"/></svg>Tree' +
                '</button>' +
                '<button id="agModeList" type="button" onclick="agSetMode(\'list\')" style="display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;border-radius:6px;padding:3px 8px;font-size:8.5pt;font-weight:600;cursor:pointer;color:' + dimtext + '">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>List' +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 70px 100px;align-items:center;height:24px;padding:0 12px;border-bottom:1px solid ' + wbsBorder + ';font-size:8.5pt;font-weight:600;color:' + dimtext + '">' +
              '<span></span><span>Plan</span><span>Actual</span>' +
            '</div>' +
            '<div id="agWbsBody" style="flex:1;overflow-y:auto"></div>' +
          '</div>' +
          '<div style="flex:1;min-width:0;position:relative">' +
            '<div id="agChart" style="width:100%"></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:center;gap:28px;margin-top:12px;font-size:9pt;color:' + T.mutedTxt + ';font-weight:500">' +
          '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#00B050"></span>Completed</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#29378d"></span>In Progress</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#F59E0B"></span>Delayed</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#9CA3AF"></span>Not Started</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    /* ── ROW 2: Operational Status + Timeline ────────────────────────── */
    html += '<div style="display:grid;grid-template-columns:1fr;gap:10px;padding:0 10px 10px;margin-bottom:0">';

    // Operational Status — 3-column layout: Donut · Phase rows · Pipeline stepper
    var C34 = 2 * Math.PI * 34;
    var opsOff = C34 * (1 - ov / 100);
    var opPhases = [
      { l:'Location Preparation',     v: locPrepPct },
      { l:'Flowline Construction',    v: flConstr },
      { l:'Flowline Commissioning',   v: flComm },
      { l:'Overall Commissioning',    v: ov }
    ];
    var steps    = ['Loc. Prep.','FL Const.','FL Comm.','Commissioned'];
    var stepPcts = [locPrepPct, flConstr, flComm, ov];
    var colDivider = isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.06)';

    html += '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
      // Section title
      '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:12px">Operational Status' +
        wdRelBadge('operationalStatus', 'letter-spacing:0') +
      '</div>' +

      // 3-column body
      '<div style="display:grid;grid-template-columns:auto 1fr 1.6fr;gap:18px;align-items:center">' +

        // Column 1: Donut
        '<div style="position:relative;width:100px;height:100px;flex-shrink:0">' +
          '<svg width="100" height="100" viewBox="0 0 100 100">' +
            '<circle cx="50" cy="50" r="38" fill="none" stroke="' + T.ringTrack + '" stroke-width="10"/>' +
            '<circle id="kpiOverallRing" cx="50" cy="50" r="38" fill="none" stroke="' + progressCol + '" stroke-width="10" stroke-dasharray="' + (2 * Math.PI * 38).toFixed(2) + ' ' + (2 * Math.PI * 38).toFixed(2) + '" stroke-dashoffset="' + ((2 * Math.PI * 38) * (1 - ov / 100)).toFixed(2) + '" stroke-linecap="round" transform="rotate(-90 50 50)"/>' +
          '</svg>' +
          '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none">' +
            '<div id="kpiOverallRingPct" style="font-size:13pt;font-weight:700;color:' + (isCritical?'#FF0000':cream) + ';line-height:1">' + wdFmtPct(ov) + '</div>' +
            '<div style="font-size:8.5pt;color:' + dimtext + ';text-transform:uppercase;letter-spacing:1.2px;margin-top:3px">Overall</div>' +
          '</div>' +
        '</div>' +

        // Column 2: Phase rows (full labels, mini bars, %)
        '<div style="border-left:' + colDivider + ';border-right:' + colDivider + ';padding:0 18px">' +
          opPhases.map(function(ph) {
            if (ph.v > 0) {
              return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:9pt">' +
                '<span style="color:' + T.mutedTxt + ';flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + ph.l + '</span>' +
                '<div style="width:70px;height:4px;background:' + T.barTrack + ';border-radius:2px;overflow:hidden;flex-shrink:0"><div style="height:100%;border-radius:2px;background:' + progressCol + ';width:' + Math.min(ph.v,100) + '%"></div></div>' +
                '<span style="font-size:9pt;font-weight:600;color:' + progressCol + ';min-width:42px;text-align:right">' + wdFmtPct(ph.v) + '</span>' +
              '</div>';
            }
            return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:9pt">' +
              '<span style="color:' + T.mutedTxt + ';flex:1">' + ph.l + '</span>' +
              '<span style="color:' + dimtext + ';min-width:42px;text-align:right">—</span></div>';
          }).join('').replace(/margin-bottom:8px(?=[^]*$)/, 'margin-bottom:0') +
        '</div>' +

        // Column 3: Pipeline stepper
        '<div style="display:flex;align-items:flex-start">' +
          steps.map(function(s, i) {
            var sp = stepPcts[i];
            var isDone = sp >= 100;
            var isOn   = sp > 0;
            var circle = isOn ? 'background:' + progressCol + ';color:#fff' : 'background:' + T.circleBgOff + ';color:' + T.mutedTxt + ';border:' + T.circleBdrOff;
            var pctCol = isOn ? progressCol : dimtext;
            var connector = '';
            if (i > 0) {
              var prevPct = Math.min(stepPcts[i - 1], 100);
              connector = '<div style="position:relative;height:2px;flex:1;margin-top:15px;background:' + T.phLine + ';border-radius:1px;overflow:hidden">' +
                '<div style="position:absolute;inset:0;width:' + prevPct + '%;background:' + progressCol + '"></div>' +
              '</div>';
            }
            return connector +
              '<div style="display:flex;flex-direction:column;align-items:center;flex:0 0 auto;min-width:64px;gap:4px">' +
                '<div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9.5pt;font-weight:700;flex-shrink:0;' + circle + '">' +
                  (isDone ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : String(i + 1)) +
                '</div>' +
                '<div style="font-size:9pt;color:' + T.mutedTxt + ';text-align:center;line-height:1.25">' + s + '</div>' +
                '<div style="font-size:9pt;font-weight:600;color:' + pctCol + '">' + wdFmtPct(sp) + '</div>' +
              '</div>';
          }).join('') +
        '</div>' +

      '</div>' +
    '</div>';

    // Right: Week-wise Progress Timeline (Highcharts)
    html += '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2.5px;text-transform:uppercase">Well Progress Timeline' +
          wdRelBadge('weekTimeline', 'letter-spacing:0') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="color:' + dimtext + ';font-size:9pt"><span data-week-count>' + (d.timeline ? d.timeline.length : 0) + ' weeks</span> · Actual</span>' +
          '<div style="display:inline-flex;align-items:center;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:2px">' +
            '<button id="wdTlRangeDay" onclick="window._wdSetTimelineView(\'day\')" style="background:transparent;color:' + dimtext + ';border:0;border-radius:6px;padding:4px 12px;font-size:9pt;font-weight:600;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s">Day</button>' +
            '<button id="wdTlRangeWeek" onclick="window._wdSetTimelineView(\'week\')" style="background:#29378d;color:#fff;border:0;border-radius:6px;padding:4px 12px;font-size:9pt;font-weight:600;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.08);transition:background .15s,color .15s,box-shadow .15s">Week</button>' +
            '<button id="wdTlRangeMonth" onclick="window._wdSetTimelineView(\'month\')" style="background:transparent;color:' + dimtext + ';border:0;border-radius:6px;padding:4px 12px;font-size:9pt;font-weight:600;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s">Month</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="detailTimelineChart" style="width:100%;height:260px"></div>' +
      '<div style="display:flex;align-items:center;justify-content:flex-end;margin-top:4px">' +
        '<div data-velocity style="font-size:9pt;color:' + dimtext + '">Progress Velocity: <span style="color:' + T.greenCol + ';font-weight:600">↗ ' + velocity + '</span> / week</div>' +
      '</div>' +
    '</div>';
    html += '</div>';

    /* ── ROW 3: Location + Infrastructure + Historical ───────────────── */
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 10px 10px;margin-bottom:0">';

    // Location & Coordinates
    html += '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
      '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:10px">Location &amp; Coordinates' +
        wdRelBadge('locationCoords', 'letter-spacing:0') +
      '</div>' +
      '<div style="background:' + T.mapBg + ';border:' + T.mapBdr + ';border-radius:8px;height:90px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">' +
        '<svg width="100%" height="100%" style="position:absolute;top:0;left:0;opacity:0.12"><defs><pattern id="wdgrid2" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="' + accent + '" stroke-width="0.5"/></pattern></defs><rect width="100%" height="100%" fill="url(#wdgrid2)"/></svg>' +
        '<div style="width:12px;height:12px;border-radius:50%;background:' + T.svgMapDot + ';box-shadow:0 0 12px ' + (isLight?'rgba(0,176,240,0.5)':'rgba(0,176,240,0.7)') + ';position:relative;z-index:1"></div>' +
      '</div>' +
      [
        ['Northing (N)', 'northing', d.northing || '—'],
        ['Easting (E)',  'easting',  d.easting  || '—'],
        ['LocationDD',  'locationdd', d.locationDd || '—'],
        ['Well Location','well_location', d.wellLocation || '—'],
        ['Project ID',  'project_id',  d.projectId || '—']
      ].map(function(r) {
        return '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:5px 0;border-bottom:1px solid ' + T.gridLine + ';font-size:9pt;gap:8px">' +
          '<span style="color:' + dimtext + '">' + r[0] + '<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">' + r[1] + '</small></span>' +
          '<span style="color:' + cream + ';text-align:right">' + esc(r[2]) + '</span></div>';
      }).join('') +
    '</div>';

    // Infrastructure Details
    html += '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
      '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:10px">Infrastructure Details' +
        wdRelBadge('infrastructureDetails', 'letter-spacing:0') +
      '</div>' +
      '<div style="background:' + T.infoBg + ';border:' + T.infoBdr + ';border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="color:' + dimtext + ';font-size:9pt">FLOW_LINEDL<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">Flowline Identifier</small></div>' +
        '<div style="color:' + cream + ';font-size:11pt;font-weight:700;white-space:nowrap">' + esc(d.flowLineDl || '—') + '</div>' +
      '</div>' +
      [
        ['FL Construction',  'flow_line_const._status', wdFmtPct(flConstr),  d.flConstructionStatus  || (flConstr >= 95 ? 'Completed' : flConstr > 0 ? 'In Progress' : 'Not Started')],
        ['FL Commissioning', 'flow_line_commi._status', wdFmtPct(flComm),   d.flCommissioningStatus || (flComm  >= 95 ? 'Completed' : flComm  > 0 ? 'In Progress' : 'Not Started')],
        ['Connected Trunk',  'station_name_no',         d.stationName || '—', null],
        ['Cluster (POD/FOG)','cluster_id',              d.clusterId || '—',  null],
        ['Rig No',           'rig_no',                  d.rigNo || '—',      null],
        ['Connection Type',  'conn_type',               d.wellType || '—',   null]
        ].map(function(r) {
          var pill = '';
          if (r[3]) {
            var pc = phaseBadge(r[3], T);
            var lbl = phaseLabel(r[3]);
            pill = '<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:9pt;font-weight:600;background:' + pc + '">' + lbl + '</span>';
          }
          return '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:5px 0;border-bottom:1px solid ' + T.gridLine + ';font-size:9pt;gap:8px">' +
            '<div style="color:' + dimtext + '">' + r[0] + '<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">' + r[1] + '</small></div>' +
            '<div style="display:flex;align-items:center;gap:7px">' + (r[3] ? '<span style="color:' + dimtext + ';font-size:9pt">' + esc(r[2]) + '</span>' + pill : '<span style="color:' + cream + ';text-align:right">' + esc(r[2]) + '</span>') + '</div></div>';
        }).join('') +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:5px 0;font-size:9pt;gap:8px">' +
        '<div style="color:' + dimtext + '">infra_ready_flag<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">infra_ready</small></div>' +
        (d.infraReadyFlag
          ? '<div style="color:' + T.greenCol + ';display:flex;align-items:center;gap:4px;justify-content:flex-end"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Ready</div>'
          : '<div style="color:' + T.amberCol + ';display:flex;align-items:center;gap:4px;justify-content:flex-end"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Not Ready</div>') +
      '</div>' +
    '</div>';

    // Historical & Planning
    html += '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
      '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:10px">Historical &amp; Planning' +
        wdRelBadge('historicalPlanning', 'letter-spacing:0') +
      '</div>' +
      '<div style="background:' + T.histHighBg + ';border:' + T.histHighBdr + ';border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="color:' + dimtext + ';font-size:9pt">WELL_YEAR_WHITE_SPACE<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">Year Classification</small></div>' +
        '<div style="color:' + cream + ';font-size:16pt;font-weight:700">' + esc(d.wellYear || '—') + '</div>' +
      '</div>' +
      [
        ['Week Number',  'Week_Number',        d.weekNumber || '—',            accent],
        ['Rig Start',    'actual_rig_on_date',  wdFmtDate(d.rigOnDate),         null],
        ['Rig End',      'actual_rig_off_date', wdFmtDate(d.rigOffDate),        null]
      ].map(function(r) {
        return '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:5px 0;border-bottom:1px solid ' + T.gridLine + ';font-size:9pt;gap:8px">' +
          '<div style="color:' + dimtext + '">' + r[0] + '<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">' + r[1] + '</small></div>' +
          '<span style="color:' + (r[3] || cream) + ';text-align:right;' + (r[3] ? 'font-weight:600' : '') + '">' + esc(r[2]) + '</span></div>';
      }).join('') +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:5px 0;border-bottom:1px solid ' + T.gridLine + ';font-size:9pt;gap:8px">' +
        '<div style="color:' + dimtext + '">is_delayed<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">delay_flag</small></div>' +
        (d.isDelayed
          ? '<span style="color:' + T.redCol + ';display:flex;align-items:center;gap:4px">⚠ Delayed</span>'
          : '<div style="color:' + T.greenCol + ';display:flex;align-items:center;gap:4px;justify-content:flex-end"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>On Schedule</div>') +
      '</div>' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:5px 0;border-bottom:1px solid ' + T.gridLine + ';font-size:9pt;gap:8px">' +
        '<div style="color:' + dimtext + '">buffer_status<small style="display:block;font-size:9pt;color:' + T.codeTxt + ';font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:1px">completion_category</small></div>' +
        '<span style="color:' + cream + '">' + esc(d.bufferStatus || '—') + '</span>' +
      '</div>' +
      '<div style="background:' + T.reasonBg + ';border:' + T.reasonBdr + ';border-radius:7px;padding:8px 10px;margin-top:8px;font-size:9pt;color:' + T.mutedTxt + ';line-height:1.5">' +
        '<div style="color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif)">REASONS_FOR_YEAR / DELAY_INDICATOR</div>' +
        esc(d.delayReason || (d.isDelayed ? 'Delay recorded.' : 'No significant delays recorded. Progress aligned with planned schedule.')) +
      '</div>' +
    '</div>';
    html += '</div>';

    /* ── REMARKS & NOTES + PHASE BREAKDOWN ───────────────────────────── */
    var nowStr = (function(){
      var ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      return ist.toISOString().replace('T', ' ').substring(0, 16) + ' IST';
    }());
    html += '<div style="padding:0 10px 10px">' +
      '<div style="background:' + navy2 + ';border:' + T.cardBdr + ';border-radius:10px;padding:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<div style="display:inline-flex;align-items:center;gap:6px;color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2.5px;text-transform:uppercase">Remarks &amp; Notes' +
            wdRelBadge('remarksNotes', 'letter-spacing:0') +
          '</div>' +
          '<span style="background:' + T.infoBg + ';border:' + T.infoBdr + ';color:' + accent + ';font-size:9pt;font-weight:700;padding:3px 10px;border-radius:5px;letter-spacing:0.5px">digital_wmr_import_remarks</span>' +
        '</div>' +
        '<div style="background:' + T.remarkBg + ';border:' + T.remarkBdr + ';border-radius:8px;padding:8px 10px;margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
            '<div style="display:flex;align-items:center;gap:6px;font-size:9pt;color:' + T.remarkDotCol + ';font-weight:600;letter-spacing:1px"><div style="width:6px;height:6px;border-radius:50%;background:' + T.remarkDotCol + '"></div>PRIMARY WMR REMARK · ' + esc(d.weekNumber || '') + '</div>' +
            '<span style="font-size:9pt;padding:3px 10px;border-radius:5px;background:' + T.remarkPillBg + ';color:' + T.remarkPillCol + ';border:' + T.remarkPillBdr + '">' + wmrStatus + '</span>' +
          '</div>' +
          '<div style="color:' + cream + ';font-size:10pt;line-height:1.55">' + esc(d.remarks || 'No remarks recorded for this well.') + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:10px">' +
          (function() {
            var avgPhaseCol  = avgPhase >= 70 ? T.greenCol : avgPhase >= 40 ? T.goldCol : T.redCol;
            var avgPhaseSoft = avgPhase >= 70 ? greenSoft  : avgPhase >= 40 ? goldSoft  : redSoft;
            var greySoft     = isLight ? 'rgba(127,127,127,0.10)' : 'rgba(255,255,255,0.06)';
            return [
              // [label, code, value, mainColor, softBg, svgInner]
              ['WMR Status',      'wmr_status',     wmrStatus,                accent,       blueSoft,     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'],
              ['Import Source',   'import_source',  'Weekly Progress Report', T.cyanCol,    tealSoft,     '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'],
              ['Data Source',     'data_source',    'PDO-WellTrack',          T.purpleCol,  purpleSoft,   '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'],
              ['Phases Complete', 'phases_done',    phasesComplete + '/8',    accent,       blueSoft,     '<polyline points="20 6 9 17 4 12"/>'],
              ['Avg Phase %',     'avg_phase',      wdFmtPct(avgPhase),       avgPhaseCol,  avgPhaseSoft, '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'],
              ['Last Sync',       'last_sync',      nowStr,                   T.mutedTxt,   greySoft,     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>']
            ].map(function(m) {
              return '<div style="background:' + T.cellBg + ';border:' + T.cellBdr + ';border-left:3px solid ' + m[3] + ';border-radius:7px;padding:8px 10px">' +
                kpiHead(m[0], m[5], m[3], m[4]) +
                '<div style="color:' + m[3] + ';font-size:11pt;font-weight:700;line-height:1.2;word-break:break-word">' + esc(m[2]) + '</div>' +
                '<div style="color:' + T.codeTxt + ';font-size:9pt;font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);margin-top:3px">' + m[1] + '</div>' +
              '</div>';
            }).join('');
          })() +
        '</div>' +
        '<div style="color:var(--txt-1);font-size:9pt;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Phase Breakdown</div>' +
        '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px">' +
          phases8.map(function(ph) {
            var isDone = ph.v === true;
            var pct    = isDone ? 100 : (typeof ph.v === 'number' ? ph.v : 0);
            var vh, vCol;
            if (isDone) {
              vh = '<span style="color:' + T.greenCol + '">100%</span>';
            } else if (ph.v === null || ph.v === undefined) {
              vh = '<span style="color:' + dimtext + '">—</span>';
            } else {
              vCol = pct >= 70 ? T.greenCol : pct >= 40 ? T.goldCol : T.redCol;
              vh = '<span style="color:' + vCol + '">' + wdFmtPct(pct) + '</span>';
            }
            var hasBar = ph.v !== null && ph.v !== undefined;
            var barCol = isDone ? T.greenCol : (vCol || T.greenCol);
            return '<div style="background:' + T.cellBg + ';border:' + T.cellBdr + ';border-radius:7px;padding:8px 10px;display:flex;flex-direction:column;gap:6px">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
                '<span style="color:' + T.mutedTxt + ';font-size:9pt">' + ph.l + '</span>' +
                '<span style="font-size:10pt;font-weight:600">' + vh + '</span>' +
              '</div>' +
              (hasBar
                ? '<div style="height:3px;background:' + T.barTrack + ';border-radius:2px;overflow:hidden"><div style="height:100%;width:' + Math.min(pct,100) + '%;background:' + barCol + ';border-radius:2px"></div></div>'
                : '') +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>';

    /* ── Inject and show ──────────────────────────────────────────────── */
    inner.innerHTML = html;
    overlay.style.display = 'block';
    overlay.scrollTop = 0;

    // Hide filter dock (same as original)
    var dock = document.getElementById('hfbDock');
    if (dock) dock.style.display = 'none';
    var chip = document.getElementById('hfbChip');
    if (chip) chip.style.display = 'none';
    document.querySelectorAll('.hfb-scope-banner').forEach(function(b) { b.style.display = 'none'; });

    /* ── Draw timeline chart (Highcharts, legend at bottom) ──────────── */
    var _wdTimelineView = 'week';

    function _wdNormalizeTimelineView(viewType, fallback) {
      var fb = String(fallback || _wdTimelineView || 'week').toLowerCase();
      if (viewType == null) return fb;

      if (typeof viewType === 'number') {
        if (viewType === 1) return 'day';
        if (viewType === 2) return 'week';
        if (viewType === 3) return 'month';
        return fb;
      }

      var s = String(viewType).toLowerCase();
      if (s === '1' || s === 'day') return 'day';
      if (s === '2' || s === 'week') return 'week';
      if (s === '3' || s === 'month') return 'month';
      return fb;
    }

    window._wdSetTimelineView = function(key) {
      _wdTimelineView = _wdNormalizeTimelineView(key, 'week');

      ['day','week','month'].forEach(function(k) {
        var b = document.getElementById('wdTlRange' + k.charAt(0).toUpperCase() + k.slice(1));
        if (!b) return;
        var active = (k === _wdTimelineView);
        b.style.background = active ? '#29378d' : 'transparent';
        b.style.color = active ? '#fff' : 'var(--txt-muted,#64748b)';
        b.style.boxShadow = active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none';
      });

      if (window._wdTlState && typeof window._wdFetchWeeklyProgress === 'function') {
        var s = window._wdTlState;
        window._wdFetchWeeklyProgress(s.wellId, s.projectId, s.from, s.to, _wdTimelineView);
      }
    };

    window._wdRebuildTimeline = function(timelineData, velocityOverride, viewType) {
      var el = document.getElementById('detailTimelineChart');
      if (!el || typeof Highcharts === 'undefined') return;

      var activeView = _wdNormalizeTimelineView(viewType, 'week');
      var T2 = buildColors();
      var timeline = timelineData || [];

      // Week/Month views collapse raw daily rows into one point per bucket.
      if ((activeView === 'week' || activeView === 'month') && timeline.length) {
        if (activeView === 'week') {
          var weekMap = {};
          timeline.forEach(function(t) {
            var rawDate = t.week || t.progressDate;
            var dt = new Date(rawDate);
            if (isNaN(dt.getTime())) return;

            // Week bucket: Monday -> Sunday.
            var day = dt.getDay(); // 0=Sun..6=Sat
            var diffToMonday = (day + 6) % 7;
            var monday = new Date(dt);
            monday.setDate(dt.getDate() - diffToMonday);
            var weekKey = monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');

            var v = t.progressPct != null ? t.progressPct : t.progressPercentage;
            // Keep latest record in each week so one point represents the week.
            if (!weekMap[weekKey] || dt > weekMap[weekKey]._dt) {
              weekMap[weekKey] = {
                week: dt.toISOString(),
                progressPct: v,
                _dt: dt
              };
            }
          });

          timeline = Object.keys(weekMap)
            .map(function(k) { return weekMap[k]; })
            .sort(function(a, b) { return a._dt - b._dt; });
        }

        if (activeView === 'month') {
        var monthMap = {};
        timeline.forEach(function(t) {
          var rawDate = t.week || t.progressDate;
          var dt = new Date(rawDate);
          if (isNaN(dt.getTime())) return;
          var monthKey = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
          var v = t.progressPct != null ? t.progressPct : t.progressPercentage;
          // Keep latest record in each month (greatest date).
          if (!monthMap[monthKey] || dt > monthMap[monthKey]._dt) {
            monthMap[monthKey] = {
              week: dt.toISOString(),
              progressPct: v,
              _dt: dt
            };
          }
        });

          timeline = Object.keys(monthMap)
            .map(function(k) { return monthMap[k]; })
            .sort(function(a, b) { return a._dt - b._dt; });

          // Keep only the latest 12 months on x-axis.
          if (timeline.length > 12) timeline = timeline.slice(timeline.length - 12);
        }
      }

      var categories = timeline.map(function(t) { return t.week || t.progressDate; });
      var actualRaw  = timeline.map(function(t) {
        var v = t.progressPct != null ? t.progressPct : t.progressPercentage;
        return Number(v);
      });

      // Some API payloads return fractional progress (0..1) while the chart is
      // rendered on a 0..100% axis. Auto-normalize so rendering always matches.
      var finiteVals = actualRaw.filter(function(v) { return Number.isFinite(v); });
      var maxActual = finiteVals.length ? Math.max.apply(null, finiteVals) : 0;
      var isFractional = finiteVals.length > 0 && maxActual <= 1;
      var actual = actualRaw.map(function(v) {
        if (!Number.isFinite(v)) return null;
        var p = isFractional ? (v * 100) : v;
        if (p < 0) p = 0;
        if (p > 100) p = 100;
        return Math.round(p * 100) / 100;
      });

      // Linear target: 0 → 100 over the same number of points
      var n = categories.length;
      var target = categories.map(function(_, i) { return n > 1 ? Math.round((i / (n - 1)) * 100) : 0; });

      // Update subtitle badge
      var weekCountEl = el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.querySelector('[data-week-count]');
      var countLabel = activeView === 'day'
        ? (n + ' day' + (n !== 1 ? 's' : ''))
        : activeView === 'month'
          ? (n + ' month' + (n !== 1 ? 's' : ''))
          : (n + ' week' + (n !== 1 ? 's' : ''));
      if (weekCountEl) weekCountEl.textContent = countLabel;

      // Update velocity display
      if (velocityOverride != null) {
        var velEl = el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.querySelector('[data-velocity]');
        if (velEl) {
          var velVal = Number(velocityOverride);
          if (Number.isFinite(velVal) && isFractional) velVal = velVal * 100;
          if (!Number.isFinite(velVal)) velVal = 0;
          velVal = Math.round(velVal * 100) / 100;
          var sign = velVal >= 0 ? '+' : '';
          var icon = velVal >= 0 ? '↗' : '↘';
          var col = velVal >= 0 ? T2.greenCol : T2.redCol;
          velEl.innerHTML = 'Progress Velocity: <span style="color:' + col + ';font-weight:600">' + icon + ' ' + sign + velVal + '%</span> / week';
        }
      }

      // Format labels per selected timeline view.
      var formattedCategories = categories.map(function(c) {
        if (!c) return '';
        var dt = new Date(c);
        if (isNaN(dt.getTime())) return c; // already formatted / non-date string
        var mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        if (activeView === 'month') return mmm[dt.getMonth()];
        var dd = String(dt.getDate()).padStart(2, '0');
        var yy = String(dt.getFullYear()).slice(-2);
        return dd + '-' + mmm[dt.getMonth()] + '-' + yy;
      });

      Highcharts.chart(el, {
        chart: {
          backgroundColor: 'transparent',
          spacing: [10, 10, 10, 10],
          style: { fontFamily: "'Inter','Calibri','Arial',sans-serif" }
        },
        title: { text: undefined },
        credits: { enabled: false },
        legend: {
          align: 'center',
          verticalAlign: 'bottom',
          layout: 'horizontal',
          itemStyle: { fontSize: '9pt', fontWeight: '500', color: T2.mutedTxt },
          itemHoverStyle: { color: T2.cream },
          symbolHeight: 10,
          symbolWidth: 10,
          symbolRadius: 2,
          margin: 10
        },
        xAxis: {
          categories: formattedCategories,
          labels: { style: { fontSize: '8.5pt', color: T2.mutedTxt }, rotation: -45 },
          lineColor: T2.gridLine,
          tickColor: T2.gridLine
        },
        yAxis: {
          min: 0, max: 100, tickInterval: 20,
          title: { text: undefined },
          labels: { format: '{value}%', style: { fontSize: '8.5pt', color: T2.mutedTxt } },
          gridLineColor: T2.gridLine
        },
        tooltip: {
          shared: true,
          useHTML: true,
          backgroundColor: T2.tooltipBg,
          borderColor: T2.tooltipBdr,
          style: { color: T2.tooltipBodyCol },
          pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y}%</b><br/>'
        },
        plotOptions: {
          series: { marker: { radius: 3 } },
          areaspline: { fillOpacity: T2.isLight ? 0.08 : 0.12 }
        },
        series: [
          {
            type: 'areaspline',
            name: 'Actual Progress',
            data: actual,
            color: T2.accent,
            lineWidth: 2,
            marker: { fillColor: T2.accent }
          },
          {
            type: 'spline',
            name: 'Target',
            data: target,
            color: T2.targetLine,
            lineWidth: 1.5,
            dashStyle: 'Dash',
            marker: { enabled: false }
          }
        ]
      });

      if (!timeline.length) {
        el.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:' + T2.mutedTxt + ';font-size:9pt">No weekly progress data found for selected filters.</div>';
      }
    };

    // Fetch timeline progress for a given projectId/date range/view type.
    window._wdFetchWeeklyProgress = function(wellId, projectId, from, to, viewType) {
      if (!wellId || !projectId) return;
      var view = _wdNormalizeTimelineView(viewType, 'week');
      window._wdTlState = { wellId: wellId, projectId: projectId, from: from || null, to: to || null };
      var params = 'projectId=' + encodeURIComponent(projectId) + '&viewType=' + encodeURIComponent(view.charAt(0).toUpperCase() + view.slice(1));
      if (from) params += '&from=' + encodeURIComponent(from);
      if (to)   params += '&to='   + encodeURIComponent(to);
      var url = '/api/v1/wells/wells/' + encodeURIComponent(wellId) + '/progress/weekly?' + params;
      console.debug('[well-detail-live][timeline] request', { wellId: wellId, projectId: projectId, from: from || null, to: to || null, view: view, url: url });
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function(res) {
          console.debug('[well-detail-live][timeline] response', res);
          var dataPoints = (res.dataPoints || []).map(function(pt) {
            return { week: pt.progressDate, progressPct: Number(pt.progressPercentage || 0) };
          });
          var vel = res.progressVelocityPerWeek != null ? Number(res.progressVelocityPerWeek) : null;
          var responseView = _wdNormalizeTimelineView(res.viewType, view);
          console.debug('[well-detail-live][timeline] mapped', { points: dataPoints.length, velocity: vel, view: responseView });
          window._wdRebuildTimeline(dataPoints, vel, responseView);
        })
        .catch(function(err) {
          console.warn('[well-detail-live][timeline] weekly progress fetch failed:', err);
          window._wdRebuildTimeline([], null, view);
        });
    };

    // Initial render
    requestAnimationFrame(function() {
      window._wdSetTimelineView('week');
      window._wdRebuildTimeline(d.timeline || [], null, 'week');
    });

    /* ── Filter Panel toggle + populate ──────────────────────────────── */
    window._wdToggleFilterPanel = function() {
      var panel = document.getElementById('wdFilterPanel');
      if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    };

    // Populate filters from cluster-wells API (same source as global HFB filters)
    // Initial selection mirrors the global HFB filter state.
    (function() {
      var clusterSel = document.getElementById('wdFilterCluster');
      var siteSel = document.getElementById('wdFilterSite');
      var wellTypeSel = document.getElementById('wdFilterWellType');
      var wellIdSel = document.getElementById('wdFilterWellId');
      var projectSel = document.getElementById('wdProjectSelect');

      // Read current global filter state
      var hfb = (window.hfbState) || {};
      var initCluster = hfb.cluster || d.clusterId || '';
      var initSite = hfb.site || '';
      var initWellType = hfb.location || '';
      var initWellId = name || '';

      var _allClusters = null;

      function rebuildCascade() {
        if (!_allClusters) return;
        var selCluster = clusterSel ? clusterSel.value : '';
        var selSite = siteSel ? siteSel.value : '';
        var selWellType = wellTypeSel ? wellTypeSel.value : '';
        var selWellId = wellIdSel ? wellIdSel.value : '';

        // Find cluster data
        var cData = _allClusters.find(function(c) { return c.cluster === selCluster; });

        // Site — filtered by cluster
        if (siteSel) {
          var prevSite = selSite;
          var siteHtml = '<option value="">All Sites</option>';
          if (cData && cData.sites) {
            cData.sites.forEach(function(s) {
              siteHtml += '<option value="' + esc(s.site) + '"' + (s.site === prevSite ? ' selected' : '') + '>' + esc(s.site) + '</option>';
            });
          }
          siteSel.innerHTML = siteHtml;
        }

        // Well Type — filtered by cluster
        if (wellTypeSel) {
          var prevWt = selWellType;
          var wtHtml = '<option value="">All Well Types</option>';
          if (cData && cData.wellTypes) {
            cData.wellTypes.forEach(function(wt) {
              var wtName = wt.wellType || '';
              wtHtml += '<option value="' + esc(wtName) + '"' + (wtName === prevWt ? ' selected' : '') + '>' + esc(wtName) + '</option>';
            });
          }
          wellTypeSel.innerHTML = wtHtml;
        }

        // Well ID — searchable dropdown with scroll
        var wellIdSearch = document.getElementById('wdFilterWellIdSearch');
        var wellIdList = document.getElementById('wdFilterWellIdList');
        var wellIdHidden = document.getElementById('wdFilterWellId');
        if (wellIdSearch && wellIdList && wellIdHidden) {
          var allFilteredWells = [];
          if (cData && cData.wells) {
            allFilteredWells = cData.wells.filter(function(w) {
              if (selWellType && w.wellType && w.wellType !== selWellType) return false;
              if (selSite && w.site && w.site !== selSite) return false;
              return true;
            });
          }
          // Set current well in search input
          wellIdSearch.value = wellIdHidden.value || initWellId || '';

          var _loadedCount = 0;
          var _currentMatches = [];
          var BATCH_SIZE = 20;

          function renderBatch() {
            var start = _loadedCount;
            var end = Math.min(_loadedCount + BATCH_SIZE, _currentMatches.length);
            var html = '';
            for (var i = start; i < end; i++) {
              var w = _currentMatches[i];
              html += '<div data-well="' + esc(w.id) + '" style="padding:7px 12px;cursor:pointer;font-size:9.5pt;border-bottom:1px solid var(--border,#f1f5f9)"' +
                ' onmousedown="event.preventDefault()" onclick="this.parentNode._onSelect(this.dataset.well)">' + esc(w.id) + '</div>';
            }
            _loadedCount = end;
            return html;
          }

          function showWellList(query) {
            var q = (query || '').toLowerCase();
            _currentMatches = allFilteredWells.filter(function(w) { return w.id.toLowerCase().indexOf(q) !== -1; });
            if (_currentMatches.length === 0 || (_currentMatches.length === 1 && _currentMatches[0].id === wellIdSearch.value)) {
              wellIdList.style.display = 'none';
              return;
            }
            _loadedCount = 0;
            wellIdList.innerHTML = renderBatch();
            wellIdList.style.display = '';
            wellIdList._onSelect = function(wellId) {
              wellIdSearch.value = wellId;
              wellIdHidden.value = wellId;
              wellIdList.style.display = 'none';
              if (wellId && wellId !== name && typeof window.awShowDetail === 'function') {
                window._wdToggleFilterPanel();
                window.awShowDetail(wellId);
              }
            };
          }

          // Lazy load more on scroll
          wellIdList.onscroll = function() {
            if (_loadedCount >= _currentMatches.length) return;
            if (wellIdList.scrollTop + wellIdList.clientHeight >= wellIdList.scrollHeight - 20) {
              wellIdList.innerHTML += renderBatch();
            }
          };

          wellIdSearch.onfocus = function() { showWellList(wellIdSearch.value); };
          wellIdSearch.oninput = function() { showWellList(wellIdSearch.value); };
          wellIdSearch.onblur = function() { setTimeout(function() { wellIdList.style.display = 'none'; }, 200); };
        }
      }

      function buildFilters(clusters) {
        if (!clusters || !clusters.length) return;
        _allClusters = clusters;

        // Cluster dropdown
        if (clusterSel) {
          clusterSel.innerHTML = '<option value="">All Clusters</option>';
          var seenClusters = {};
          clusters.forEach(function(c) {
            if (c.cluster && !seenClusters[c.cluster]) {
              seenClusters[c.cluster] = true;
              var selected = (initCluster && c.cluster.toLowerCase() === initCluster.toLowerCase()) ? ' selected' : '';
              clusterSel.innerHTML += '<option value="' + esc(c.cluster) + '"' + selected + '>' + esc(c.cluster) + '</option>';
            }
          });
          clusterSel.onchange = function() {
            // Reset downstream filters when cluster changes
            if (siteSel) siteSel.value = '';
            if (wellTypeSel) wellTypeSel.value = '';
            rebuildCascade();
          };
        }

        // Set initial values
        if (siteSel) siteSel.onchange = function() { rebuildCascade(); };
        if (wellTypeSel) wellTypeSel.onchange = function() { rebuildCascade(); };

        // Build cascade with initial selections
        rebuildCascade();

        // Force initial well type + site from global filter
        if (siteSel && initSite) siteSel.value = initSite;
        if (wellTypeSel && initWellType) wellTypeSel.value = initWellType;
        rebuildCascade();
      }

      // Use cached cluster-wells data if available, otherwise fetch
      var clusterData = (window._hfbApiClusters) || null;
      if (clusterData) {
        buildFilters(clusterData);
      } else {
        fetch('/api/v1/wells/dashboard/cluster-wells', { headers: { Accept: 'application/json' } })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(clusters) {
            if (clusters) {
              window._hfbApiClusters = clusters;
              buildFilters(clusters);
            }
          }).catch(function() {});
      }
    })();

    /* ── KPI Cards async data fetch (Variance, WBS, Activities) ────────── */
    requestAnimationFrame(function() {
      if (!name) return;
      var kpiWellId = String(name || '');
      var _currentProjectId = '';  // empty = all projects

      function readTimelineDates() {
        var fromEl = document.getElementById('wdTimelineFrom');
        var toEl = document.getElementById('wdTimelineTo');
        var from = fromEl && fromEl.value ? fromEl.value : null;
        var to = toEl && toEl.value ? toEl.value : null;
        return { from: from, to: to };
      }

      function refreshTimelineFromFilters(wellId, projectId) {
        if (!projectId || typeof window._wdFetchWeeklyProgress !== 'function') return;
        var dRange = readTimelineDates();
        // Important: when dates are blank, do not send them. Backend returns full data.
        window._wdFetchWeeklyProgress(wellId, projectId, dRange.from, dRange.to);
      }

      function bindTimelineDateFilters(wellId) {
        var fromEl = document.getElementById('wdTimelineFrom');
        var toEl = document.getElementById('wdTimelineTo');
        var clearBtn = document.getElementById('wdTimelineClear');

        // Match other filters behavior: apply immediately on date selection/change.
        [fromEl, toEl].forEach(function(el) {
          if (!el) return;
          el.onchange = function() {
            refreshTimelineFromFilters(wellId, _currentProjectId);
          };
        });

        if (clearBtn) {
          clearBtn.onclick = function() {
            if (fromEl) fromEl.value = '';
            if (toEl) toEl.value = '';
            refreshTimelineFromFilters(wellId, _currentProjectId);
          };
        }

        // Enter key support when user types date manually.
        [fromEl, toEl].forEach(function(el) {
          if (!el) return;
          el.onkeydown = function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              refreshTimelineFromFilters(wellId, _currentProjectId);
            }
          };
        });
      }

      // Populate project filter dropdown from the workgroups response (distinct project_ids)
      function populateProjectFilter(wellId) {
        // Fetch distinct projects for this well from WMR_TaskPlan_csv_imported via a lightweight query
        // We use the same endpoint without projectId to get all data, then extract unique project_ids from activities
        // Instead, fetch project list from a dedicated lightweight source
        fetch('/api/v1/wells/dashboard/wells/' + encodeURIComponent(wellId) + '/projects', {
          headers: { Accept: 'application/json' }
        }).then(function(r) { return r.ok ? r.json() : null; })
          .then(function(projects) {
            var sel = document.getElementById('wdProjectSelect');
            if (!sel || !projects || !projects.length) return;

            sel.innerHTML = '';
            projects.forEach(function(p, idx) {
              var pName = p.projectName || '';
              // Show only project name (remove cluster prefix if present)
              if (pName.indexOf(d.clusterId) === 0) pName = pName.substring(d.clusterId.length).trim();
              // Fallback to projectType if stripped name is empty
              if (!pName) pName = p.projectType || p.projectCode || p.projectId || 'Project ' + (idx + 1);
              var opt = '<option value="' + p.projectId + '"' + (idx === 0 ? ' selected' : '') + '>' + pName + '</option>';
              sel.innerHTML += opt;
            });
            // Auto-select first project and fetch its data
            _currentProjectId = projects[0].projectId;
            // Update the project name in the metadata strip
            var metaNameEl = document.getElementById('wdMetaProjectName');
            if (metaNameEl) {
              var firstName = projects[0].projectName || '';
              if (firstName.indexOf(d.clusterId) === 0) firstName = firstName.substring(d.clusterId.length).trim();
              if (!firstName) firstName = projects[0].projectType || projects[0].projectCode || projects[0].projectId;
              metaNameEl.textContent = firstName;
            }
            fetchWorkgroups(wellId, projects[0].projectId);
            if (typeof window._wgRebuildChart === 'function') {
              window._wgRebuildChart(projects[0].projectId);
            }
            // Fetch weekly progress for the initially selected project
            refreshTimelineFromFilters(wellId, projects[0].projectId);
            sel.onchange = function() {
              _currentProjectId = sel.value;
              // Update metadata strip project name
              var metaN = document.getElementById('wdMetaProjectName');
              if (metaN) metaN.textContent = sel.options[sel.selectedIndex].text || sel.value;
              fetchWorkgroups(wellId, sel.value || null);
              if (typeof window._wgRebuildChart === 'function') {
                window._wgRebuildChart(sel.value || null);
              }
              // Re-fetch weekly progress timeline for the selected project
              refreshTimelineFromFilters(wellId, sel.value);
            };
          }).catch(function(){});
      }

      function fetchWorkgroups(wellId, projectId) {
        var url = '/api/v1/wells/dashboard/well-workgroups/' + encodeURIComponent(wellId);
        if (projectId) url += '?projectId=' + encodeURIComponent(projectId);
        fetch(url, { headers: { Accept: 'application/json' } })
          .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(j) { processWorkgroupsData(j); })
          .catch(function(err) { console.warn('[well-detail-live] workgroup fetch failed:', err); });
      }

      function processWorkgroupsData(j) {
          var workgroups = (j && j.workgroups) || [];
          var allActivities = [];
          workgroups.forEach(function(g) {
            (g.activities || []).forEach(function(a) { allActivities.push(a); });
          });

          // Store wellStatus for the badge (used by renderDetail)
          if (j && j.wellStatus) {
            window._wdWellStatus = window._wdWellStatus || {};
            window._wdWellStatus[String(kpiWellId)] = j.wellStatus;
            // Update badge immediately if already rendered
            var badgeEl = document.getElementById('wdStatusBadge');
            if (badgeEl) {
              var wsLabel = j.wellStatus.toUpperCase();
              if (wsLabel === 'DUE') wsLabel = 'OVERDUE';
              var wsStyle = STATUS_STYLES[wsLabel] || {bg:'rgba(255,0,0,0.1)', border:'rgba(255,0,0,0.3)', color:'#DC2626'};
              badgeEl.innerHTML = '<div style="width:7px;height:7px;border-radius:50%;background:' + wsStyle.color + ';animation:pulse 1.8s ease-in-out infinite;flex-shrink:0"></div>' + wsLabel;
              badgeEl.style.background = wsStyle.bg;
              badgeEl.style.border = '1px solid ' + wsStyle.border;
              badgeEl.style.color = wsStyle.color;
            }
          }

          // --- Variance KPI (Avg Asking Rate - Avg Current Rate) ---
          var varianceEl = document.getElementById('kpiVarianceVal');
          var varianceUnitEl = document.getElementById('kpiVarianceUnit');
          var varianceChildrenEl = document.getElementById('kpiVarianceChildren');
          if (varianceEl) {
            // Use backend-computed values from well detail API (stored in window._wdCurrentDetail)
            var detailData = window._wdCurrentDetail || {};
            var apiAskRate = detailData.askRate;
            var apiCurrentRate = detailData.ratePerDay;
            var displayAskRate = (apiAskRate != null) ? apiAskRate : 0;
            var displayCurrentRate = (apiCurrentRate != null) ? apiCurrentRate : 0;
            var displayVariance = displayCurrentRate - displayAskRate;
            var varSign = displayVariance >= 0 ? '+' : '';
            var T3 = buildColors();
            var varCol = displayVariance >= 0 ? T3.greenCol : T3.redCol;
            varianceEl.style.color = varCol;
            varianceEl.textContent = varSign + displayVariance.toFixed(2);
            if (varianceUnitEl) varianceUnitEl.textContent = 'Current Rate - Asking Rate';
            // Health badge for variance
            var varBadgeEl = document.getElementById('kpiVarianceBadge');
            if (varBadgeEl) {
              var varHealth = displayVariance >= 0 ? 'HEALTHY' : (displayVariance >= -10 ? 'MONITOR' : 'CRITICAL');
              var varHCol = displayVariance >= 0 ? T3.greenCol : (displayVariance >= -10 ? T3.goldCol : T3.redCol);
              var varHBg = displayVariance >= 0 ? 'rgba(0,176,80,0.1)' : (displayVariance >= -10 ? 'rgba(255,192,0,0.1)' : 'rgba(255,0,0,0.1)');
              varBadgeEl.innerHTML = '<span style="display:inline-flex;align-items:center;font-size:8.5pt;font-weight:600;padding:2px 8px;border-radius:4px;background:' + varHBg + ';color:' + varHCol + '">' + varHealth + '</span>';
            }
            if (varianceChildrenEl) {
              varianceChildrenEl.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;font-size:9pt;color:' + T3.cream + '">' +
                  '<span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:#29378d;flex-shrink:0"></span>Asking Rate</span>' +
                  '<b>' + displayAskRate.toFixed(2) + '</b>' +
                '</div>' +
                '<div style="display:flex;align-items:center;justify-content:space-between;font-size:9pt;color:' + T3.cream + '">' +
                  '<span style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:#00B050;flex-shrink:0"></span>Current Rate</span>' +
                  '<b>' + displayCurrentRate.toFixed(2) + '</b>' +
                '</div>';
            }
          }

          // --- Total Activities KPI ---
          var actValEl = document.getElementById('kpiActivitiesVal');
          var actUnitEl = document.getElementById('kpiActivitiesUnit');
          if (actValEl) {
            var actTotal = allActivities.length;
            var actCompleted = 0, actInProgress = 0, actNotStarted = 0;
            allActivities.forEach(function(a) {
              var p = a.progress || a.currentProgress || 0;
              var s = (a.status || '').toLowerCase();
              if (p >= 100 || s === 'completed' || s === 'complete') actCompleted++;
              else if (p > 0 || s === 'in progress') actInProgress++;
              else actNotStarted++;
            });
            actValEl.textContent = actTotal;
            // Stacked bar
            var actBarEl = document.getElementById('kpiActBar');
            if (actBarEl && actTotal > 0) {
              var aPctC = Math.round(actCompleted / actTotal * 100);
              var aPctI = Math.round(actInProgress / actTotal * 100);
              actBarEl.innerHTML =
                '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:rgba(156,163,175,0.2)">' +
                  '<div style="width:' + aPctC + '%;background:#00B050"></div>' +
                  '<div style="width:' + aPctI + '%;background:#29378d"></div>' +
                '</div>';
            }
            if (actUnitEl) actUnitEl.innerHTML =
              '<span class="wd-leg-chip"><span class="wd-leg-sw" style="background:#9CA3AF"></span>Not Started <b>' + actNotStarted + '</b></span>' +
              '<span class="wd-leg-chip"><span class="wd-leg-sw" style="background:#29378d"></span>In Progress <b>' + actInProgress + '</b></span>' +
              '<span class="wd-leg-chip"><span class="wd-leg-sw" style="background:#00B050"></span>Completed <b>' + actCompleted + '</b></span>';
          }

          // --- Total WBS KPI (from workgroups with activities) ---
          var activeWorkgroups = workgroups.filter(function(g) { return (g.activityCount || 0) > 0; });
          var wbsTotal = activeWorkgroups.length;
          var wbsCompleted = 0, wbsInProgress = 0, wbsNotStarted = 0;
          activeWorkgroups.forEach(function(g) {
            var s = (g.status || '').toLowerCase();
            if (s === 'completed' || s === 'complete') wbsCompleted++;
            else if (s === 'in progress' || g.progress > 0) wbsInProgress++;
            else wbsNotStarted++;
          });
          var wbsValEl = document.getElementById('kpiWbsVal');
          var wbsUnitEl = document.getElementById('kpiWbsUnit');
          if (wbsValEl) wbsValEl.textContent = wbsTotal;
          // Stacked bar
          var wbsBarEl = document.getElementById('kpiWbsBar');
          if (wbsBarEl && wbsTotal > 0) {
            var wPctC = Math.round(wbsCompleted / wbsTotal * 100);
            var wPctI = Math.round(wbsInProgress / wbsTotal * 100);
            wbsBarEl.innerHTML =
              '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:rgba(156,163,175,0.2)">' +
                '<div style="width:' + wPctC + '%;background:#00B050"></div>' +
                '<div style="width:' + wPctI + '%;background:#29378d"></div>' +
              '</div>';
          }
          if (wbsUnitEl) wbsUnitEl.innerHTML =
            '<span class="wd-leg-chip"><span class="wd-leg-sw" style="background:#9CA3AF"></span>Not Started <b>' + wbsNotStarted + '</b></span>' +
            '<span class="wd-leg-chip"><span class="wd-leg-sw" style="background:#29378d"></span>In Progress <b>' + wbsInProgress + '</b></span>' +
            '<span class="wd-leg-chip"><span class="wd-leg-sw" style="background:#00B050"></span>Completed <b>' + wbsCompleted + '</b></span>';

          // --- Overall Progress recalc using activity-level PMS ---
          // Overall Progress = Σ(act_weightage × act_progress) / Σ(act_weightage)
          var totalCompletedPms = 0;
          var totalWeightage = 0;
          activeWorkgroups.forEach(function(g) {
            (g.activities || []).forEach(function(a) {
              var w = a.weightage || 0;
              totalCompletedPms += w * (a.progress || 0);
              totalWeightage += w;
            });
          });
          if (totalWeightage > 0) {
            var pmsProgress = Math.round(totalCompletedPms / totalWeightage * 10) / 10;
            var ovValEl = document.getElementById('kpiOverallVal');
            var ovBarEl = document.getElementById('kpiOverallBar');
            var ovBadgeEl2 = document.getElementById('kpiOverallBadge');
            var ovRingEl = document.getElementById('kpiOverallRing');
            var ovRingPctEl = document.getElementById('kpiOverallRingPct');
            if (ovValEl) ovValEl.textContent = pmsProgress.toFixed(1) + '%';
            if (ovBarEl) ovBarEl.style.width = Math.min(pmsProgress, 100) + '%';
            // Badge shows well status from workgroups API
            if (ovBadgeEl2 && j && j.wellStatus) {
              var wsLabel = j.wellStatus.toUpperCase();
              if (wsLabel === 'DUE') wsLabel = 'OVERDUE';
              var wsCol = (wsLabel.indexOf('COMPLETED') !== -1 || wsLabel === 'ACCELERATED' || wsLabel === 'ON TIME') ? '#00B050'
                : (wsLabel === 'DUE' || wsLabel === 'OVERDUE') ? '#DC2626'
                : (wsLabel.indexOf('DELAYED') !== -1 || wsLabel === 'CRITICAL') ? '#DC2626'
                : '#EAB308';
              var wsBg = (wsLabel.indexOf('COMPLETED') !== -1 || wsLabel === 'ACCELERATED' || wsLabel === 'ON TIME') ? 'rgba(0,176,80,0.1)'
                : (wsLabel === 'DUE' || wsLabel === 'OVERDUE') ? 'rgba(255,0,0,0.1)'
                : (wsLabel.indexOf('DELAYED') !== -1 || wsLabel === 'CRITICAL') ? 'rgba(255,0,0,0.1)'
                : 'rgba(255,192,0,0.1)';
              ovBadgeEl2.textContent = wsLabel;
              ovBadgeEl2.style.color = wsCol;
              ovBadgeEl2.style.background = wsBg;
            }
            // Update the header donut ring
            if (ovRingEl) {
              var circ = 2 * Math.PI * 38;
              ovRingEl.setAttribute('stroke-dashoffset', (circ * (1 - pmsProgress / 100)).toFixed(2));
            }
            if (ovRingPctEl) ovRingPctEl.textContent = pmsProgress.toFixed(1) + '%';
          }

          // --- Completion Risk KPI (Asking Rate / Current Rate Ratio) ---
          var riskValEl = document.getElementById('kpiRiskVal');
          var riskUnitEl = document.getElementById('kpiRiskUnit');
          var riskBarEl = document.getElementById('kpiRiskBar');
          var riskBadgeEl = document.getElementById('kpiRiskBadge');
          var avgAsking = displayAskRate;
          var avgCurrent = displayCurrentRate;
          if (riskValEl && avgCurrent > 0) {
            var ratio = avgAsking / avgCurrent;
            var riskLabel, riskCol, riskDesc, riskAction;
            var T4 = buildColors();
            if (ratio <= 1.0) {
              riskLabel = 'Low'; riskCol = T4.greenCol; riskDesc = 'no intervention needed'; riskAction = 'can finish at normal pace';
            } else if (ratio <= 1.5) {
              riskLabel = 'Medium'; riskCol = T4.goldCol; riskDesc = 'monitor closely'; riskAction = 'Need ' + Math.round(ratio * 100) + '% of norm';
            } else if (ratio <= 2.0) {
              riskLabel = 'High'; riskCol = T4.redCol; riskDesc = 'intervention needed'; riskAction = 'Need ' + ratio.toFixed(1) + 'x faster';
            } else {
              riskLabel = 'Critical'; riskCol = T4.redCol; riskDesc = 'recovery unlikely'; riskAction = 'Need ' + ratio.toFixed(1) + 'x faster';
            }
            var riskBg = riskLabel === 'Low' ? 'rgba(0,176,80,0.1)' : riskLabel === 'Medium' ? 'rgba(255,192,0,0.1)' : 'rgba(255,0,0,0.1)';
            riskValEl.innerHTML = '<span style="color:' + riskCol + '">' + riskLabel + '</span>';
            if (riskBadgeEl) riskBadgeEl.innerHTML = riskAction;
            if (riskBadgeEl) { riskBadgeEl.style.background = riskBg; riskBadgeEl.style.color = riskCol; }
            if (riskUnitEl) riskUnitEl.textContent = riskDesc + ' \u00b7 ratio ' + ratio.toFixed(2) + 'x';
            if (riskBarEl) {
              riskBarEl.style.background = riskCol;
              riskBarEl.style.width = Math.min(ratio * 50, 100) + '%';
            }
          }
      } // end processWorkgroupsData

      // Initial fetch (all projects)
      fetchWorkgroups(kpiWellId, null);
      // Bind date filter actions for timeline.
      bindTimelineDateFilters(kpiWellId);
      // Populate project filter dropdown
      populateProjectFilter(kpiWellId);
    });

    /* ── Planned vs Actual Progress & Revenue (Highcharts dual-axis) ─── */
    // Capture the wellId for the lifetime of this overlay so the chart fetches and the
    // Day/Week/Month buttons can target the right well.
    var _currentWellId = String(name || '');

    /* ── Workgroup Progress (Highcharts horizontal bar) ──────────────────
       One bar per distinct workgroup (type 'W'); bar length = average of its
       activities' progress; colour = group status. Tooltip lists each activity
       with its own progress. Source: GET /dashboard/well-workgroups/{wellId}. */
    requestAnimationFrame(function() {
      var wgEl = document.getElementById('detailWorkgroupChart');
      if (!wgEl || typeof Highcharts === 'undefined') return;
      var WT = buildColors();
      // Group-bar colour from the progress rollup status.
      var STATUS_COL = { 'Completed': '#00B050', 'In Progress': '#29378d', 'Not Started': '#9CA3AF' };
      // Progress-based dot colour for the tooltip activity list.
      function progCol(p) { p = p || 0; return p >= 100 ? '#00B050' : p > 0 ? '#29378d' : '#9CA3AF'; }

      function wgEmpty(msg) {
        wgEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
          'color:' + WT.mutedTxt + ';font-size:10pt">' + (msg || 'No workgroup data for this well.') + '</div>';
      }

      // Spinner shown while the workgroup data is being fetched. Highcharts.chart()
      // (wgBuild) and wgEmpty() both overwrite wgEl, so this clears automatically.
      function wgLoading() {
        wgEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px">' +
          '<div style="width:34px;height:34px;border:3px solid ' + WT.gridLine + ';border-top-color:#29378d;border-radius:50%;animation:wgSpin .8s linear infinite"></div>' +
          '<div style="color:' + WT.mutedTxt + ';font-size:9.5pt">Loading workgroup progress…</div>' +
          '<style>@keyframes wgSpin{to{transform:rotate(360deg)}}</style>' +
        '</div>';
      }

      function wgBuild(groups) {
        // Only chart workgroups that actually have activities — progress is the average of
        // their activities, so groups with none (milestone/header rows) carry no signal.
        groups = (groups || []).filter(function(g) { return (g.activityCount || 0) > 0; });
        if (!groups.length) { wgEmpty(); return; }
        // Grow the container so bars stay legible when a well has many workgroups.
        wgEl.style.height = Math.max(320, groups.length * 34 + 70) + 'px';

        var categories = groups.map(function(g) { return g.name; });
        // Build two series: completed PMS (green) + remaining PMS (grey) stacked
        var completedData = [];
        var remainingData = [];
        groups.forEach(function(g) {
          var acts = g.activities || [];
          var completedPms = 0;
          var totalPms = 0;
          acts.forEach(function(a) {
            completedPms += (a.weightage || 0) * (a.progress || 0) / 100;
            totalPms += (a.weightage || 0);
          });
          var completedVal = Math.round(completedPms * 10000) / 100;
          var totalVal = Math.round(totalPms * 10000) / 100;
          var remainingVal = Math.round((totalVal - completedVal) * 100) / 100;
          if (remainingVal < 0) remainingVal = 0;
          var hasOverdue = acts.some(function(a) { return a.status === 'Overdue'; });
          completedData.push({
            y: completedVal,
            color: hasOverdue ? '#FF0000' : '#00B050',
            custom: g
          });
          remainingData.push({
            y: remainingVal,
            color: '#CBD2DC',
            custom: g
          });
        });

        // Dynamic x-axis max: highest total PMS (weightage) among all workgroups
        var maxPms = 0;
        groups.forEach(function(g) {
          var totalWg = 0;
          (g.activities || []).forEach(function(a) { totalWg += (a.weightage || 0); });
          var wgPms = Math.round(totalWg * 10000) / 100;
          if (wgPms > maxPms) maxPms = wgPms;
        });
        var yMax = maxPms > 0 ? Math.ceil(maxPms) : 10;

        Highcharts.chart(wgEl, {
          chart: { type: 'bar', backgroundColor: 'transparent', spacing: [12, 14, 10, 8],
                   style: { fontFamily: "'Inter','Calibri','Arial',sans-serif" } },
          title:   { text: undefined },
          credits: { enabled: false },
          legend:  { enabled: true, itemStyle: { fontSize: '9pt', color: WT.mutedTxt } },
          xAxis: {
            categories: categories,
            labels: { style: { fontSize: '9pt', color: WT.mutedTxt } },
            lineColor: WT.gridLine, tickColor: WT.gridLine
          },
          yAxis: {
            min: 0, max: yMax,
            title:  { text: 'PMS (%)', style: { color: WT.mutedTxt, fontSize: '8.5pt' } },
            labels: { format: '{value}%', style: { fontSize: '8.5pt', color: WT.mutedTxt } },
            gridLineColor: WT.gridLine
          },
          tooltip: {
            useHTML: true, backgroundColor: WT.tooltipBg, borderColor: WT.tooltipBdr,
            style: { color: WT.tooltipBodyCol, fontSize: '9pt' },
            formatter: function() {
              var g = (this.point && this.point.custom) || {};
              var acts = g.activities || [];
              // Workgroup status for the tooltip: Overdue if ANY activity is overdue,
              // otherwise the progress-based rollup (Completed when all activities are done).
              var anyOverdue = acts.some(function(a){ return a.status === 'Overdue'; });
              var wgStatus = anyOverdue ? 'Overdue' : (g.status || '');
              var wgStatusCol = wgStatus === 'Overdue' ? '#DC2626'
                              : wgStatus === 'Completed' ? '#00B050'
                              : wgStatus === 'In Progress' ? '#29378d'
                              : '#9CA3AF';
              var rows = acts.slice(0, 12).map(function(a) {
                var c = progCol(a.progress);
                var p = Math.round((a.progress || 0) * 10) / 10;
                return '<div style="display:flex;align-items:center;gap:6px;margin-top:3px">' +
                  '<span style="width:8px;height:8px;border-radius:2px;background:' + c + ';flex:none"></span>' +
                  '<span style="flex:1;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                  (a.name || '') + '</span>' +
                  '<span style="font-weight:600;margin-left:8px">' + p + '%</span></div>';
              }).join('');
              if (!rows) rows = '<div style="opacity:.7;margin-top:3px">No activities</div>';
              else if (acts.length > 12) rows += '<div style="opacity:.7;margin-top:3px">+' + (acts.length - 12) + ' more…</div>';
              // Completed PMS = sum of each activity's earned PMS (act_weightage * act_progress/100 * 100)
              var completedPms = 0;
              acts.forEach(function(a) { completedPms += (a.weightage || 0) * (a.progress || 0); });
              return '<div style="min-width:210px">' +
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
                  '<span style="font-weight:700">' + (g.name || '') + '</span>' +
                  '<span style="font-weight:700;font-size:8.5pt;color:' + wgStatusCol + '">' + wgStatus + '</span>' +
                '</div>' +
                '<div style="font-size:8.5pt;opacity:.8;margin-bottom:2px">' +
                (g.completedCount || 0) + '/' + (g.activityCount || 0) + ' activities · avg ' +
                (Math.round((g.progress || 0) * 10) / 10) + '%' +
                (g.weightage != null ? ' · PMS: ' + (g.weightage * 100).toFixed(2) + '%' : '') +
                '</div>' +
                (g.weightage != null ? '<div style="font-size:8.5pt;opacity:.8;margin-bottom:2px">Completed PMS: ' + (Math.round(completedPms * 100) / 100).toFixed(2) + '%</div>' : '') +
                rows +
                '</div>';
            }
          },
          plotOptions: {
            bar: {
              stacking: 'normal',
              borderWidth: 0, borderRadius: 3, pointPadding: 0.12, groupPadding: 0.08,
              cursor: 'pointer',
              point: { events: { click: function() { wgOpenActivities(this.custom); } } }
            },
            series: { animation: { duration: 500 } }
          },
          series: [
            { name: 'Remaining', data: remainingData, color: '#CBD2DC',
              dataLabels: { enabled: false } },
            { name: 'Completed', data: completedData, color: '#00B050',
              dataLabels: { enabled: true, format: '{y}%', style: { fontSize: '8.5pt', fontWeight: '600', textOutline: 'none', color: '#1F3864' } } }
          ]
        });
      }

      /**
       * Renders every activity in a workgroup (all columns from the source query) INTO the
       * well-detail container (#awDetailInner), so it inherits the same layout — sidebar and
       * top bar stay visible — and the app theme via buildColors(). "Back" re-renders the
       * well detail from its live cache.
       */
      function wgOpenActivities(group) {
        if (!group) return;
        var inner   = document.getElementById('awDetailInner');
        var overlay = document.getElementById('awDetailOverlay');
        if (!inner) return;
        var T = buildColors();
        var acts = group.activities || [];

        var esc2 = function(s) {
          if (s === null || s === undefined) return '';
          return String(s).replace(/&amp;/g, '&').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        var dash = function(v) { return (v === null || v === undefined || v === '') ? '<span style="opacity:.4">—</span>' : esc2(v); };
        var num  = function(v, d) { return (v === null || v === undefined) ? '<span style="opacity:.4">—</span>' : (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)); };

        // Schedule-status chip styling, tinted to match the app's pill aesthetic.
        var schedChip = function(s) {
          if (s === 'Completed')     return 'background:' + T.completeBg + ';color:' + T.completeCol + ';border:' + T.completeBdr;
          if (s === 'Overdue')       return 'background:rgba(255,0,0,0.10);color:' + T.redCol + ';border:1px solid rgba(255,0,0,0.30)';
          if (s === 'Due Today')     return 'background:rgba(249,115,22,0.12);color:#F97316;border:1px solid rgba(249,115,22,0.30)';
          if (s === 'Due This Week') return 'background:rgba(255,192,0,0.12);color:' + T.goldCol + ';border:1px solid rgba(255,192,0,0.30)';
          if (s === 'Not Started')   return 'background:' + T.notStartBg + ';color:' + T.notStartCol + ';border:' + T.notStartBdr;
          if (s === 'Not Planned')   return 'background:' + T.pdoBg + ';color:' + T.pdoCol + ';border:' + T.pdoBdr;
          return 'background:' + T.tagBg + ';color:' + T.tagCol + ';border:1px solid ' + T.tagBdr; // On Track / default
        };

        // Status text colour only (no chip/border) — used by the Status column.
        var schedColor = function(s) {
          if (!s) return T.tagCol;
          if (s.indexOf('Completed') === 0) return T.completeCol;
          if (s === 'At Risk (Delayed)')    return T.redCol;
          if (s === 'Due')                  return '#DC2626';
          if (s === 'Accelerated')          return '#22C55E';
          if (s === 'On Track')             return T.tagCol;
          return T.tagCol;
        };

        var isDark = !document.documentElement.classList.contains('navbar-light');
        var MONO  = "font-family:var(--font-family-mono,'Inter','Calibri',monospace)";

        // ── ag-Grid cell renderers (mirror the Wells Summary Grid look) ──
        function rIdx(p)    { return '<span style="' + MONO + ';color:var(--txt-muted)">' + (((p.node && p.node.rowIndex) || 0) + 1) + '</span>'; }
        function rName(p)   {
          var a = p.data || {};
          return '<div style="line-height:1.3;padding:4px 0">' +
            '<div style="font-weight:600;color:var(--txt-1);white-space:normal">' + esc2(a.name || a.code || '') + '</div>' +
            ((a.activityCode || a.code) ? '<div style="font-size:8pt;color:var(--txt-muted);' + MONO + '">' + esc2(a.activityCode || a.code || '') + '</div>' : '') +
            '</div>';
        }
        function rStatus(p) {
          var val = p.value || '';
          var match = val.match(/^(.+?)\s*\((.+)\)$/);
          if (match) {
            var main = match[1].trim();
            var sub = match[2].trim();
            var mainColor = main === 'Completed' ? '#15803D' : main === 'At Risk' ? '#DC2626' : '#64748b';
            var subColor = sub === 'Late' ? '#DC2626' : sub === 'Early' ? '#15803D' : sub === 'On Time' ? '#29378d' : sub === 'Delayed' ? '#DC2626' : '#64748b';
            return '<div style="line-height:1.4;padding:2px 0">' +
              '<div style="font-size:9pt;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:' + mainColor + '">' + esc2(main) + '</div>' +
              '<div style="font-size:8pt;font-weight:600;color:' + subColor + ';margin-top:1px">' + esc2(sub) + '</div></div>';
          }
          var color = val === 'Accelerated' ? '#15803D' : val === 'Due' ? '#DC2626' : val === 'On Track' ? '#64748b' : schedColor(val);
          return '<span style="font-size:9pt;font-weight:700;letter-spacing:.3px;text-transform:uppercase;' +
            'color:' + color + '">' + esc2(val) + '</span>';
        }
        function rProg(p)   {
          var v = Math.round((p.value || 0) * 10) / 10;
          return '<div style="display:flex;align-items:center;gap:8px;width:100%">' +
            '<span style="' + MONO + ';font-size:9pt;font-weight:700;color:' + progCol(v) + ';min-width:36px">' + v + '%</span>' +
            '<div style="flex:1;height:7px;border-radius:4px;background:' + T.barTrack + ';overflow:hidden">' +
            '<div style="height:100%;width:' + Math.min(v, 100) + '%;background:' + progCol(v) + '"></div></div></div>';
        }
        function rDate(p)   { return p.value ? '<span style="' + MONO + ';font-size:9pt;color:var(--txt-2)">' + esc2(p.value) + '</span>' : '<span style="color:var(--txt-muted)">—</span>'; }
        function rNum(dec)  { return function(p) {
          if (p.value === null || p.value === undefined || p.value === '') return '<span style="color:var(--txt-muted)">—</span>';
          var v = Math.round(p.value * Math.pow(10, dec)) / Math.pow(10, dec);
          return '<span style="' + MONO + ';font-size:9pt;color:var(--txt-1)">' + v + '</span>';
        }; }
        function rText(p)   { return p.value ? '<span style="color:var(--txt-2);font-size:8.5pt">' + esc2(p.value) + '</span>' : '<span style="color:var(--txt-muted)">—</span>'; }
        var numFilter = 'agNumberColumnFilter';

        var columnDefs = [
          { headerName:'#', colId:'idx', width:60, sortable:false, filter:false, pinned:'left',
            valueGetter:function(p){ return ((p.node && p.node.rowIndex) || 0) + 1; }, cellRenderer:rIdx, cellStyle:{ textAlign:'center' } },
          { headerName:'Activity', field:'name', width:300, pinned:'left', cellRenderer:rName, wrapText:true, autoHeight:true,
            valueGetter:function(p){ return (p.data && (p.data.name || p.data.code)) || ''; } },
          { headerName:'PMS', field:'pms', width:100, filter:numFilter, cellRenderer:rNum(2),
            valueGetter:function(p){ var w = p.data && p.data.weightage; return (w != null) ? w * 100 : null; } },
          { headerName:'Qty', field:'qty', width:100, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Norm', field:'norm', width:110, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Hours Required', field:'manhoursPlanned', width:140, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Days Required', field:'daysRequired', width:130, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Norms Rate/Day', field:'normsRate', width:140, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Start Date', field:'startDate', width:130, cellRenderer:rDate },
          { headerName:'End Date', field:'endDate', width:130, cellRenderer:rDate },
          { headerName:'Target Start', field:'targetStart', width:130, cellRenderer:rDate },
          { headerName:'Target End', field:'targetEnd', width:130, cellRenderer:rDate },
          { headerName:'Actual Start', field:'actualStart', width:130, cellRenderer:rDate },
          { headerName:'Actual End', field:'actualEnd', width:130, cellRenderer:rDate },
          { headerName:'As Per Norm End', field:'asperNormEnd', width:140, cellRenderer:rDate },
          { headerName:'Days Completed', field:'daysCompleted', width:130, filter:numFilter, cellRenderer:rNum(0) },
          { headerName:'Qty Completed', field:'qtyCompleted', width:130, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Current Progress', field:'currentProgress', width:150, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Qty Remaining', field:'qtyRemaining', width:130, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Days Remaining', field:'daysRemaining', width:140, filter:numFilter, cellRenderer:rNum(0) },
          { headerName:'Current Rate', field:'currentRate', width:130, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Asking Rate', field:'askingRateQty', width:130, filter:numFilter, cellRenderer:rNum(4) },
          { headerName:'Status', field:'status', width:150, cellRenderer:rStatus },
          { headerName:'Can Complete With Actual Rate', field:'canCompleteWithActualRate', width:200, cellRenderer:rText }
        ];

        var gridIcon = '<svg style="width:12px;height:12px;color:var(--txt-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';

        inner.innerHTML =
          '<div style="padding:14px 16px 30px">' +
            // Header — breadcrumb matches the well detail "Back to All Wells" style.
            '<div style="display:flex;align-items:center;gap:8px;font-size:9.5pt;margin-bottom:14px;flex-wrap:wrap">' +
              '<span onclick="awCloseDetail()" style="display:inline-flex;align-items:center;gap:4px;color:var(--txt-2,#64748b);font-size:9pt;font-weight:500;cursor:pointer;margin-right:4px;flex-shrink:0">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Back to All Wells</span>' +
              '<a style="color:' + T.accent + ';cursor:pointer;text-decoration:none" onclick="awNavTo(\'cmdoverview\')">Overview</a>' +
              '<span style="color:' + T.dimtext + '">›</span>' +
              '<a style="color:' + T.accent + ';cursor:pointer;text-decoration:none" onclick="awCloseDetail()">All Wells</a>' +
              '<span style="color:' + T.dimtext + '">›</span>' +
              '<a id="wgBackBtn" style="color:' + T.accent + ';cursor:pointer;text-decoration:none">' + esc2(_currentWellId) + '</a>' +
              '<span style="color:' + T.dimtext + '">›</span>' +
              '<span style="color:' + T.breadcrumb + '">' + esc2(group.name || '') + '</span>' +
            '</div>' +
            // Title + subtitle
            '<div style="margin-bottom:14px">' +
              '<div style="font-size:14pt;font-weight:700;color:' + T.cream + ';line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc2(group.name || '') + '</div>' +
              '<div style="font-size:9pt;color:' + T.dimtext + ';margin-top:3px">' +
                'Well ' + esc2(_currentWellId) + ' · ' + (group.completedCount || 0) + '/' + (group.activityCount || 0) + ' activities completed · avg progress ' +
                  (Math.round((group.progress || 0) * 10) / 10) + '%' +
                  (group.targetStart || group.targetEnd ? ' · target ' + dash(group.targetStart) + ' → ' + dash(group.targetEnd) : '') +
                '</div>' +
            '</div>' +
            // Grid card — mirrors the All-Wells "WELLS SUMMARY GRID" toolbar + ag-Grid pattern.
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)">' +
                gridIcon +
                '<span style="font-size:10pt;font-weight:700;color:var(--txt-1)">ACTIVITY DETAILS</span>' +
                '<span style="background:var(--blue-soft);color:var(--blue);border:1px solid var(--blue-bd);font-size:9pt;font-weight:700;padding:2px 9px;border-radius:10px;' + MONO + '">' + acts.length + ' activities</span>' +
                '<span style="font-size:9pt;color:var(--txt-muted);margin-left:auto">Sort &amp; filter via column headers · Drag to reorder</span>' +
              '</div>' +
              '<div id="wgActsGrid" class="' + (isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + '" style="width:100%;height:calc(100vh - 250px);min-height:340px"></div>' +
            '</div>' +
          '</div>';

        // One-time stylesheet replicating the #awWellsGrid theme overrides for #wgActsGrid.
        if (!document.getElementById('wgActsGridStyle')) {
          var stl = document.createElement('style');
          stl.id = 'wgActsGridStyle';
          stl.textContent =
            '#wgActsGrid.ag-theme-alpine-dark{--ag-background-color:#112448;--ag-header-background-color:#0d1c3a;' +
              '--ag-odd-row-background-color:rgba(255,255,255,0.02);--ag-row-hover-color:rgba(96,165,250,0.06);' +
              '--ag-border-color:rgba(255,255,255,0.08);--ag-header-foreground-color:rgba(200,215,240,0.55);' +
              '--ag-foreground-color:#e8ecf5;--ag-row-border-color:rgba(255,255,255,0.04);' +
              '--ag-selected-row-background-color:rgba(59,130,246,0.10);--ag-font-family:var(--font-family);--ag-font-size:9pt;' +
              '--ag-header-height:44px;--ag-grid-size:6px;--ag-cell-horizontal-padding:14px;--ag-alpine-active-color:#29378d}' +
            '#wgActsGrid.ag-theme-alpine-dark .ag-paging-panel{color:rgba(200,215,240,0.55);font-size:9pt;background:#0d1c3a}' +
            '#wgActsGrid.ag-theme-alpine{--ag-background-color:#ffffff;--ag-header-background-color:#f8fafc;' +
              '--ag-odd-row-background-color:#fafbfc;--ag-row-hover-color:rgba(41,55,141,0.05);--ag-border-color:#e2e8f0;' +
              '--ag-header-foreground-color:#7F7F7F;--ag-foreground-color:#1e293b;--ag-row-border-color:#f1f5f9;' +
              '--ag-selected-row-background-color:rgba(41,55,141,0.08);--ag-font-family:var(--font-family);--ag-font-size:9pt;' +
              '--ag-header-height:44px;--ag-grid-size:6px;--ag-cell-horizontal-padding:14px;--ag-alpine-active-color:#29378d}' +
            '#wgActsGrid .ag-header-cell-text{font-size:9pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase}';
          document.head.appendChild(stl);
        }

        // Build the ag-Grid (same global + API as the rest of the app).
        var gridDiv = document.getElementById('wgActsGrid');
        if (window._wgActsGrid) { try { window._wgActsGrid.destroy(); } catch (e) {} window._wgActsGrid = null; }
        if (gridDiv && typeof agGrid !== 'undefined' && typeof agGrid.createGrid === 'function') {
          window._wgActsGrid = agGrid.createGrid(gridDiv, {
            columnDefs: columnDefs,
            rowData: acts,
            defaultColDef: { resizable: true, sortable: true, filter: true },
            animateRows: true,
            pagination: true,
            paginationPageSize: 20,
            paginationPageSizeSelector: [10, 20, 50, 100],
            headerHeight: 44,
            rowHeight: 50,
            suppressCellFocus: false,
            enableCellTextSelection: true,
            suppressMovableColumns: false,
            overlayNoRowsTemplate: '<span style="color:var(--txt-muted)">No activities in this workgroup.</span>'
          });
        } else if (gridDiv) {
          gridDiv.innerHTML = '<div style="padding:24px;color:var(--txt-muted);font-size:10pt">Grid library not loaded — please refresh.</div>';
        }

        if (overlay) overlay.scrollTop = 0;

        var backBtn = document.getElementById('wgBackBtn');
        if (backBtn) backBtn.addEventListener('click', function() {
          if (window._wgActsGrid) { try { window._wgActsGrid.destroy(); } catch (e) {} window._wgActsGrid = null; }
          var cache = (window._wdLiveCache || {})[_currentWellId];
          if (typeof window._wdRenderDetail === 'function' && cache) {
            window._wdRenderDetail(_currentWellId, cache);
          } else if (typeof window.awShowDetail === 'function') {
            window.awShowDetail(_currentWellId); // fallback: refetch + re-render
          }
        });
      }
      window.wgOpenActivities = wgOpenActivities;

      function wgFetch(wid, projectId) {
        var url = '/api/v1/wells/dashboard/well-workgroups/' + encodeURIComponent(wid);
        if (projectId) url += '?projectId=' + encodeURIComponent(projectId);
        return fetch(url, {
          headers: { Accept: 'application/json' }
        }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(j) { return (j && j.workgroups) || []; });
      }

      // Expose for project filter re-fetch
      window._wgRebuildChart = function(projectId) {
        if (!_currentWellId) return;
        wgLoading();
        wgFetch(_currentWellId, projectId).then(wgBuild).catch(function() { wgEmpty('Unable to load workgroup data.'); });
      };

      if (!_currentWellId) { wgEmpty(); return; }
      wgLoading();
      wgFetch(_currentWellId).then(wgBuild).catch(function(err) {
        console.warn('[well-detail-live] workgroup chart fetch failed:', err);
        wgEmpty('Unable to load workgroup data.');
      });
    });

    /* ── Planned vs Actual Progress & Revenue (legacy, hidden) ───────────
       Superseded by the Workgroup Progress chart above. The #detailRevenueChart
       container is no longer rendered, so this block self-disables (el is null). */
    requestAnimationFrame(function() {
      var el = document.getElementById('detailRevenueChart');
      if (!el || typeof Highcharts === 'undefined') return;

      var T2 = buildColors();
      // Palette matches wellexecution.component.ts `buildWexecParChart` so the
      // overlay chart and the dashboard chart are visually identical.
      var PLANNED_COL  = '#3B82F6';  // planned progress line (dashed blue)
      var ACTUAL_COL   = '#00B050';  // actual progress line (green)
      var PLANNED_BAR  = '#BFDBFE';  // planned revenue column (pale blue)
      var ACTUAL_BAR   = '#00B050';  // actual revenue column (green)
      var VARIANCE_COL = '#C4B5FD';  // variance band (lavender)
      var milestoneCol = '#475569';

      /**
       * Fetch real per-well chart data from /dashboard/well-execution-kpi.
       * Returns { categories, plannedProgress, actualProgress, plannedRevenue,
       *           actualRevenue, milestones } in the shape the existing chart code expects.
       * Falls back to the hardcoded RANGE entry on error.
       */
      function fetchChartDataFor(wid, period) {
        var today  = new Date();
        var from   = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
        var fmt = function(d) {
          return d.getFullYear() + '-' +
                 String(d.getMonth() + 1).padStart(2, '0') + '-' +
                 String(d.getDate()).padStart(2, '0');
        };
        var qs = 'period='   + encodeURIComponent(period) +
                 '&from='    + fmt(from) +
                 '&to='      + fmt(today) +
                 '&chartOnly=true' +
                 (wid ? '&wellId=' + encodeURIComponent(wid) : '');
        return fetch('/api/v1/wells/dashboard/well-execution-kpi?' + qs, {
          headers: { Accept: 'application/json' }
        }).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(j) {
          var series = (j && j.chartSeries) || [];
          if (series.length === 0) return null;
          return {
            categories:      series.map(function(p){ return p.label; }),
            plannedProgress: series.map(function(p){ return p.plannedPct; }),
            actualProgress:  series.map(function(p){ return p.actualPct; }),
            plannedRevenue:  series.map(function(p){ return p.plannedRevM; }),
            actualRevenue:   series.map(function(p){ return p.actualRevM; }),
            // The /well-execution-kpi endpoint doesn't yet return milestones, so we keep
            // the existing 5 fixed phase markers spread evenly across the available points.
            milestones: [
              { x: 0,                                        label: 'Rig Move In' },
              { x: Math.floor(series.length * 0.20),         label: 'FLAF' },
              { x: Math.floor(series.length * 0.50),         label: 'Flowline Complete' },
              { x: Math.floor(series.length * 0.70),         label: 'Hook-Up' },
              { x: Math.max(0, series.length - 1),           label: 'Commissioning' }
            ]
          };
        });
      }
      // Expose so the global prSetRange handler can call it.
      window._prFetch = fetchChartDataFor;
      window._prWellId = _currentWellId;

      // ── Datasets keyed by range (Day / Week / Month) ─────────────────
      var RANGE = {
        day: {
          categories: (function() {
            var out = [], names = ['Apr','May','Jun','Jul'];
            // 30 daily points spanning ~Apr–early-Jul
            for (var i = 0; i < 30; i++) {
              var d = new Date(2026, 3, 20 + i);
              out.push(d.getDate() + ' ' + names[d.getMonth() - 3]);
            }
            return out;
          })(),
          plannedProgress: Array.from({length:30}, function(_,i){ return Math.round((i / 29) * 100); }),
          actualProgress:  Array.from({length:30}, function(_,i){ return Math.round((i / 29) * 95); }),
          plannedRevenue:  Array.from({length:30}, function(_,i){ return +(((i + 1) / 30) * 12.45).toFixed(2); }),
          actualRevenue:   Array.from({length:30}, function(_,i){ return +(((i + 1) / 30) * 8.32).toFixed(2); }),
          milestones: [
            { x: 0,  label: 'Rig Move In' },
            { x: 7,  label: 'FLAF' },
            { x: 14, label: 'Flowline Complete' },
            { x: 22, label: 'Hook-Up' },
            { x: 28, label: 'Commissioning' }
          ]
        },
        week: {
          categories:      ['20 Apr \'26','27 Apr \'26','04 May \'26','11 May \'26','18 May \'26','25 May \'26','01 Jun \'26','08 Jun \'26','15 Jun \'26','22 Jun \'26','29 Jun \'26','06 Jul \'26'],
          plannedProgress: [8, 15, 23, 32, 40, 48, 56, 64, 72, 80, 90, 100],
          actualProgress:  [5, 10, 17, 26, 33, 43, 47, 57, 67, 75, 85, 100],
          plannedRevenue:  [0.6, 1.2, 1.95, 2.85, 3.85, 4.9, 6.1, 7.35, 8.75, 10.2, 11.35, 12.45],
          actualRevenue:   [0.35, 0.7, 1.1, 1.6, 2.2, 3.1, 3.95, 4.8, 5.7, 6.65, 7.5, 8.32],
          milestones: [
            { x: 0,  label: 'Rig Move In' },
            { x: 2,  label: 'FLAF' },
            { x: 5,  label: 'Flowline Complete' },
            { x: 8,  label: 'Hook-Up' },
            { x: 10, label: 'Commissioning' }
          ]
        },
        month: {
          categories:      ['Apr \'26','May \'26','Jun \'26','Jul \'26'],
          plannedProgress: [25, 55, 85, 100],
          actualProgress:  [18, 45, 75, 100],
          plannedRevenue:  [2.85, 6.1, 10.2, 12.45],
          actualRevenue:   [1.6, 3.95, 6.65, 8.32],
          milestones: [
            { x: 0, label: 'Rig Move In' },
            { x: 1, label: 'FLAF · Flowline Complete' },
            { x: 2, label: 'Hook-Up · Commissioning' }
          ]
        }
      };

      // Currently-active range — default Week to match the active button.
      var currentRange = 'week';
      var data = RANGE[currentRange];
      var categories      = data.categories;
      var plannedProgress = data.plannedProgress;
      var actualProgress  = data.actualProgress;
      var plannedRevenue  = data.plannedRevenue;
      var actualRevenue   = data.actualRevenue;
      var variance        = plannedProgress.map(function(p, i) { return [Math.min(p, actualProgress[i]), Math.max(p, actualProgress[i])]; });
      var milestones      = data.milestones;
      var chart;

      chart = Highcharts.chart(el, {
        chart: {
          backgroundColor: 'transparent',
          spacing: [40, 10, 10, 10],
          style: { fontFamily: "'Inter','Calibri','Arial',sans-serif" }
        },
        title:   { text: undefined },
        credits: { enabled: false },
        legend: {
          align: 'center',
          verticalAlign: 'bottom',
          layout: 'horizontal',
          itemStyle: { fontSize: '9pt', fontWeight: '500', color: T2.mutedTxt },
          itemHoverStyle: { color: T2.cream },
          symbolHeight: 10,
          symbolWidth: 12,
          symbolRadius: 2,
          margin: 12
        },
        xAxis: {
          categories: categories,
          labels: { style: { fontSize: '8.5pt', color: T2.mutedTxt } },
          lineColor: T2.gridLine,
          tickColor: T2.gridLine,
          plotLines: milestones.map(function(m) {
            return {
              color: T2.gridLine,
              value: m.x,
              width: 1,
              dashStyle: 'Dash',
              zIndex: 2,
              label: {
                text: '◆ ' + m.label,
                rotation: 0,
                y: -10,
                align: 'center',
                style: { color: milestoneCol, fontSize: '8.5pt', fontWeight: '600' }
              }
            };
          })
        },
        yAxis: [
          {
            min: 0, max: 100, tickInterval: 20,
            title: { text: 'Progress (%)', style: { color: T2.mutedTxt, fontSize: '8.5pt' } },
            labels: { format: '{value}%', style: { fontSize: '8.5pt', color: T2.mutedTxt } },
            gridLineColor: T2.gridLine
          },
          {
            min: 0, max: 15,
            title: { text: 'Revenue', style: { color: T2.mutedTxt, fontSize: '8.5pt' } },
            labels: { format: '{value}M', style: { fontSize: '8.5pt', color: T2.mutedTxt } },
            gridLineWidth: 0,
            opposite: true
          }
        ],
        tooltip: {
          shared: true,
          useHTML: true,
          backgroundColor: T2.tooltipBg,
          borderColor: T2.tooltipBdr,
          style: { color: T2.tooltipBodyCol, fontSize: '9pt' }
        },
        plotOptions: {
          series: { animation: { duration: 600 } },
          column: {
            grouping: true,
            pointPadding: 0.06,
            groupPadding: 0.18,
            borderWidth: 0,
            dataLabels: {
              enabled: true,
              format: '{y}M',
              style: { fontSize: '8pt', fontWeight: '600', textOutline: 'none', color: T2.cream }
            }
          },
          spline: {
            marker: { radius: 4, lineWidth: 2, lineColor: '#fff' },
            dataLabels: {
              enabled: true,
              format: '{y}%',
              style: { fontSize: '8pt', fontWeight: '600', textOutline: 'none' }
            }
          },
          arearange: { enableMouseTracking: false }
        },
        series: [
          {
            type: 'arearange',
            name: 'Progress Variance',
            data: variance,
            color: VARIANCE_COL,
            fillOpacity: 0.45,
            lineWidth: 0,
            yAxis: 0,
            zIndex: 1,
            marker: { enabled: false },
            showInLegend: true,
            legendSymbol: 'rectangle'
          },
          {
            type: 'column',
            name: 'Planned Revenue',
            data: plannedRevenue,
            color: PLANNED_BAR,
            yAxis: 1,
            zIndex: 2,
            dataLabels: { style: { color: PLANNED_COL } }
          },
          {
            type: 'column',
            name: 'Actual Revenue',
            data: actualRevenue,
            color: ACTUAL_BAR,
            yAxis: 1,
            zIndex: 3,
            dataLabels: { style: { color: ACTUAL_COL } }
          },
          {
            type: 'spline',
            name: 'Planned Progress (%)',
            data: plannedProgress,
            color: PLANNED_COL,
            dashStyle: 'Dash',
            lineWidth: 2,
            yAxis: 0,
            zIndex: 4,
            marker: { fillColor: '#fff', lineColor: PLANNED_COL, symbol: 'circle' },
            dataLabels: { style: { color: PLANNED_COL } }
          },
          {
            type: 'spline',
            name: 'Actual Progress (%)',
            data: actualProgress,
            color: ACTUAL_COL,
            lineWidth: 2.5,
            yAxis: 0,
            zIndex: 5,
            marker: { fillColor: '#fff', lineColor: ACTUAL_COL, symbol: 'circle' },
            dataLabels: { style: { color: ACTUAL_COL } }
          },
          {
            type: 'scatter',
            name: 'Milestone',
            data: [],
            color: milestoneCol,
            marker: { symbol: 'diamond', radius: 5 },
            showInLegend: true
          }
        ]
      });

      // ── Day / Week / Month tab switcher ──────────────────────────────
      // Stash the chart + datasets on window so the inline onclick handlers
      // (declared on the buttons via `onclick="prSetRange('day')"`) can reach
      // them — same global-function pattern the rest of this file uses.
      window._prState = {
        chart:        chart,
        ranges:       RANGE,
        accent:       '#29378d',  // active-tab blue, matches wellexecution
        dimtext:      dimtext,
        gridLineCol:  T2.gridLine,
        milestoneCol: milestoneCol,
        wellId:       _currentWellId
      };

      // Helper to render a zero-state inside the Planned vs Actual chart container
      // when the per-well API returns no data. Keeps the categorical x-axis from the
      // current range and zeros out every series so the user sees the same chart
      // skeleton, no bars, no fill — making it clear no progress has been recorded.
      function _prShowEmptyState() {
        if (!chart || chart.renderer == null) return;
        var rangeNow = (window._prState && window._prState.ranges && window._prState.ranges[window._prState.currentKey || 'week']) || RANGE.week;
        var zero = rangeNow.categories.map(function() { return 0; });
        var zeroVar = rangeNow.categories.map(function() { return [0, 0]; });
        chart.xAxis[0].update({ categories: rangeNow.categories, plotLines: [] }, false);
        chart.series[0].setData(zeroVar, false);
        chart.series[1].setData(zero,    false);
        chart.series[2].setData(zero,    false);
        chart.series[3].setData(zero,    false);
        chart.series[4].setData(zero,    false);
        chart.redraw();
      }
      window._prShowEmptyState = _prShowEmptyState;

      // ── Initial fetch: replace the hardcoded RANGE['week'] data with real per-well
      // values from /dashboard/well-execution-kpi. If the API returns no chart series,
      // render an empty-state message instead of leaving the demo data on screen.
      fetchChartDataFor(_currentWellId, 'week').then(function(real) {
        if (!chart || chart.renderer == null) return;
        if (!real) { _prShowEmptyState(); return; }
        window._prState.ranges.week = real;
        var v = real.plannedProgress.map(function(p, i) {
          return [Math.min(p, real.actualProgress[i]), Math.max(p, real.actualProgress[i])];
        });
        chart.xAxis[0].update({
          categories: real.categories,
          plotLines: real.milestones.map(function(m) {
            return {
              color: T2.gridLine, value: m.x, width: 1, dashStyle: 'Dash', zIndex: 2,
              label: { text: '◆ ' + m.label, rotation: 0, y: -10, align: 'center',
                       style: { color: milestoneCol, fontSize: '8.5pt', fontWeight: '600' } }
            };
          })
        }, false);
        chart.series[0].setData(v, false);
        chart.series[1].setData(real.plannedRevenue, false);
        chart.series[2].setData(real.actualRevenue,  false);
        chart.series[3].setData(real.plannedProgress, false);
        chart.series[4].setData(real.actualProgress,  false);
        chart.redraw();
      }).catch(function(err) {
        console.warn('[well-detail-live] initial chart fetch failed:', err);
        _prShowEmptyState();
      });
    });

    /* ── Activity Gantt — same data + Highcharts xrange as wellexecution ─ */
    requestAnimationFrame(function() {
      if (typeof Highcharts === 'undefined') return;
      if (!document.getElementById('agChart')) return;

      // WBS data — mirrors wellexecution.component.ts `activityWbs`
      var activityWbs = [
        { id:'1',   name:'Location Preparation',  plan:'01 May', actual:'01 May',        color:'#00B050', hasChildren:true,  expanded:false, level:0, startDay:1,  endDay:8,  pct:1.0 },
        { id:'1.1', name:'Site Survey',           plan:'01 May', actual:'01 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:1,  endDay:3,  pct:1.0 },
        { id:'1.2', name:'Access Road',           plan:'03 May', actual:'04 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:3,  endDay:6,  pct:1.0 },
        { id:'1.3', name:'Pad Construction',      plan:'05 May', actual:'08 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:5,  endDay:8,  pct:1.0 },
        { id:'2',   name:'Engineering & Design',  plan:'02 May', actual:'03 May',        color:'#00B050', hasChildren:true,  expanded:false, level:0, startDay:2,  endDay:11, pct:1.0 },
        { id:'2.1', name:'Layout Design',         plan:'02 May', actual:'04 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:2,  endDay:6,  pct:1.0 },
        { id:'2.2', name:'Approval',              plan:'07 May', actual:'11 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:7,  endDay:11, pct:1.0 },
        { id:'3',   name:'Material Procurement',  plan:'03 May', actual:'05 May',        color:'#00B050', hasChildren:true,  expanded:false, level:0, startDay:3,  endDay:15, pct:1.0 },
        { id:'3.1', name:'PO Issued',             plan:'03 May', actual:'05 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:3,  endDay:7,  pct:1.0 },
        { id:'3.2', name:'Material Delivered',    plan:'08 May', actual:'15 May (100%)', color:'#00B050', hasChildren:false, level:1, startDay:8,  endDay:15, pct:1.0 },
        { id:'4',   name:'Flowline Construction', plan:'08 May', actual:'11 May',        color:'#29378d', hasChildren:true,  expanded:true,  level:0, startDay:8,  endDay:19, pct:0.6 },
        { id:'4.1', name:'Trenching',             plan:'08 May', actual:'10 May (60%)',  color:'#3B82F6', hasChildren:false, level:1, startDay:8,  endDay:15, pct:0.6 },
        { id:'4.2', name:'Pipe Laying',           plan:'10 May', actual:'11 May (40%)',  color:'#3B82F6', hasChildren:false, level:1, startDay:10, endDay:17, pct:0.4 },
        { id:'4.3', name:'Welding',               plan:'12 May', actual:'– (0%)',        color:'#F59E0B', hasChildren:false, level:1, startDay:12, endDay:19, pct:0.0 },
        { id:'4.4', name:'Coating & Lowering',    plan:'13 May', actual:'– (0%)',        color:'#9CA3AF', hasChildren:false, level:1, startDay:13, endDay:19, pct:0.0 },
        { id:'5',   name:'OHL Construction',      plan:'14 May', actual:'– (0%)',        color:'#F59E0B', hasChildren:true,  expanded:false, level:0, startDay:14, endDay:19, pct:0.0 },
        { id:'5.1', name:'Tower Erection',        plan:'14 May', actual:'– (0%)',        color:'#F59E0B', hasChildren:false, level:1, startDay:14, endDay:17, pct:0.0 },
        { id:'5.2', name:'Stringing',             plan:'17 May', actual:'– (0%)',        color:'#F59E0B', hasChildren:false, level:1, startDay:17, endDay:19, pct:0.0 },
        { id:'6',   name:'Pre-Commissioning',     plan:'20 May', actual:'– (0%)',        color:'#D1D5DB', hasChildren:true,  expanded:false, level:0, startDay:20, endDay:27, pct:0.0 },
        { id:'6.1', name:'Pressure Test',         plan:'20 May', actual:'– (0%)',        color:'#D1D5DB', hasChildren:false, level:1, startDay:20, endDay:23, pct:0.0 },
        { id:'6.2', name:'Hydrostatic Test',      plan:'23 May', actual:'– (0%)',        color:'#D1D5DB', hasChildren:false, level:1, startDay:23, endDay:27, pct:0.0 },
        { id:'7',   name:'Commissioning',         plan:'24 May', actual:'– (0%)',        color:'#D1D5DB', hasChildren:true,  expanded:false, level:0, startDay:24, endDay:27, pct:0.0 },
        { id:'7.1', name:'Start-up',              plan:'24 May', actual:'– (0%)',        color:'#D1D5DB', hasChildren:false, level:1, startDay:24, endDay:26, pct:0.0 },
        { id:'7.2', name:'Handover',              plan:'26 May', actual:'– (0%)',        color:'#D1D5DB', hasChildren:false, level:1, startDay:26, endDay:27, pct:0.0 }
      ];

      window._agState = {
        wbs: activityWbs,
        mode: 'tree',
        chart: null,
        T2: buildColors(),
        wellId: _currentWellId
      };

      window.agRender();

      // ── Replace the hardcoded WBS with real per-well ActivityTaskPlan rows.
      // Hits /api/v1/wells/dashboard/well-stages/{wellId}, filters to type A/M, dedups
      // by (stageType, stageName), sorts by plan date, and groups A rows under their
      // preceding M row with the 1, 1.1, 1.2 numbering pattern.
      // If the API returns no rows for this well, fall back to the hardcoded activity
      // template but with the Plan / Actual columns blanked and progress zeroed, so the
      // user can still see the canonical activity list while it's clear nothing has
      // been recorded against this well yet.
      var _blankTemplate = function() {
        return activityWbs.map(function(r) {
          return Object.assign({}, r, {
            plan:   '',
            actual: '',
            pct:    0,
            color:  '#9CA3AF'   // grey "not started" colour
          });
        });
      };
      if (_currentWellId) {
        fetchActivityGanttFor(_currentWellId).then(function(realWbs) {
          window._agState.wbs = (realWbs && realWbs.length > 0) ? realWbs : _blankTemplate();
          window.agRender();
        }).catch(function(err) {
          console.warn('[well-detail-live] activity gantt fetch failed:', err);
          window._agState.wbs = _blankTemplate();
          window.agRender();
        });
      }
    });
  }

  /**
   * Fetch the per-well stage list and reshape it into the WBS rows the existing
   * Activity Gantt code consumes. Adds absolute `startTs` / `endTs` timestamps
   * so the chart can use a dynamic x-axis matching the well's real schedule.
   */
  function fetchActivityGanttFor(wid) {
    return fetch('/api/v1/wells/dashboard/well-stages/' + encodeURIComponent(wid), {
      headers: { Accept: 'application/json' }
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(j) {
      var stages = (j && j.stages) || [];
      // 1. Keep only Activity / Milestone rows.
      var items = stages.filter(function(s) {
        var t = (s.stageType || '').toUpperCase();
        return t === 'A' || t === 'M';
      });
      // 2. Sort chronologically by targetStart; tie-break milestones before activities.
      items.sort(function(a, b) {
        var ta = a.targetStart ? Date.parse(a.targetStart) : Number.POSITIVE_INFINITY;
        var tb = b.targetStart ? Date.parse(b.targetStart) : Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        var ma = (a.stageType || '').toUpperCase() === 'M' ? 0 : 1;
        var mb = (b.stageType || '').toUpperCase() === 'M' ? 0 : 1;
        if (ma !== mb) return ma - mb;
        return (a.stageName || '').localeCompare(b.stageName || '');
      });
      // 3. Dedupe — DB stores N copies per phase template.
      var seen = {}, unique = [];
      for (var i = 0; i < items.length; i++) {
        var key = (items[i].stageType || '').toUpperCase() + '|' + (items[i].stageName || '').trim().toLowerCase();
        if (seen[key]) continue;
        seen[key] = 1;
        unique.push(items[i]);
      }
      // 4. Group A rows under preceding M rows; build WBS rows with `1`, `1.1`, … ids.
      var out = [];
      var milestoneIdx = 0, activityIdx = 0, currentMid = null;
      var fmtDate = function(s) {
        if (!s) return '–';
        var d = new Date(s);
        if (isNaN(d.getTime())) return '–';
        return String(d.getDate()).padStart(2, '0') + ' ' +
               ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
      };
      for (var k = 0; k < unique.length; k++) {
        var s = unique[k];
        var type = (s.stageType || '').toUpperCase();
        var pct = Math.max(0, Math.min(1, (s.progress || 0) / 100));
        var pctTxt = Math.round(pct * 100) + '%';
        var actualTs = s.actualStart ? Date.parse(s.actualStart) : NaN;
        var actualOk = !isNaN(actualTs);
        // Colour mirrors wellexecution chart palette.
        var color = '#9CA3AF';
        if (pct >= 1)             color = '#00B050';
        else if (pct > 0)         color = '#29378d';
        else if (actualOk)        color = '#F59E0B';
        var startTs = s.targetStart ? Date.parse(s.targetStart) : NaN;
        var endTs   = s.targetEnd   ? Date.parse(s.targetEnd)   : startTs;
        if (isNaN(endTs)) endTs = startTs;

        if (type === 'M') {
          milestoneIdx++;
          activityIdx = 0;
          currentMid = String(milestoneIdx);
          out.push({
            id: currentMid,
            name: s.stageName || '',
            plan:   fmtDate(s.targetStart),
            actual: actualOk ? (fmtDate(s.actualStart) + ' (' + pctTxt + ')') : ('– (' + pctTxt + ')'),
            color: color,
            hasChildren: true,   // milestones group activities, support expand/collapse
            expanded: milestoneIdx === 1, // open the first one so user sees content
            level: 0,
            startDay: 1, endDay: 1,
            startTs: !isNaN(startTs) ? startTs : undefined,
            endTs:   !isNaN(endTs)   ? endTs   : undefined,
            pct: pct,
            isMilestone: true
          });
        } else {
          activityIdx++;
          var aid = currentMid ? (currentMid + '.' + activityIdx) : String(++milestoneIdx);
          out.push({
            id: aid,
            name: s.stageName || '',
            plan:   fmtDate(s.targetStart),
            actual: actualOk ? (fmtDate(s.actualStart) + ' (' + pctTxt + ')') : ('– (' + pctTxt + ')'),
            color: color,
            hasChildren: false,
            level: 1,
            startDay: 1, endDay: 1,
            startTs: !isNaN(startTs) ? startTs : undefined,
            endTs:   !isNaN(endTs)   ? endTs   : undefined,
            pct: pct,
            isMilestone: false
          });
        }
      }
      return out;
    });
  }

  /* ── Global handlers for the Activity Gantt (Tree/List, expand rows) ── */
  function _agVisibleWbs() {
    var st = window._agState;
    if (!st) return [];
    if (st.mode === 'list') return st.wbs.filter(function(r) { return !r.hasChildren; });
    // Tree mode: show level-0 always; show level-1 only if parent is expanded
    var out = [];
    var suppressLevel = -1;
    for (var i = 0; i < st.wbs.length; i++) {
      var r = st.wbs[i];
      if (suppressLevel >= 0 && r.level > suppressLevel) continue;
      suppressLevel = -1;
      out.push(r);
      if (r.hasChildren && !r.expanded) suppressLevel = r.level;
    }
    return out;
  }

  window.agRender = function() {
    var st = window._agState;
    if (!st) return;
    var T2 = st.T2;
    var rows = _agVisibleWbs();

    // 1) Render WBS rows list
    var body = document.getElementById('agWbsBody');
    if (body) {
      var rowBorder = T2.isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
      var childBg   = T2.isLight ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.02)';
      body.innerHTML = rows.map(function(r, i) {
        var isChild  = r.level > 0;
        var realIdx  = st.wbs.indexOf(r);
        var clickAttr = r.hasChildren ? ' onclick="agToggleRow(' + realIdx + ')"' : '';
        var cursor    = r.hasChildren ? 'pointer' : 'default';
        return '<div' + clickAttr + ' style="display:grid;grid-template-columns:1fr 70px 100px;align-items:center;height:36px;padding:0 12px;font-size:9pt;color:var(--txt-1);border-bottom:1px solid ' + rowBorder + ';cursor:' + cursor + ';user-select:none;' + (isChild ? 'background:' + childBg + ';' : '') + '">' +
          '<span style="display:flex;align-items:center;gap:6px;min-width:0">' +
            (r.hasChildren
              ? '<svg style="width:14px;height:14px;color:' + T2.mutedTxt + ';flex-shrink:0;transition:transform 0.15s ease;transform:rotate(' + (r.expanded ? '90' : '0') + 'deg)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 6 15 12 9 18"/></svg>'
              : '<span style="width:14px;flex-shrink:0"></span>') +
            '<span style="font-weight:' + (isChild ? '500' : '600') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (isChild ? 'padding-left:14px;color:' + r.color : '') + '">' + r.id + '. ' + r.name + '</span>' +
            '<span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-left:4px;background:' + r.color + '"></span>' +
          '</span>' +
          '<span style="font-size:8.5pt;color:' + T2.mutedTxt + '">' + r.plan + '</span>' +
          '<span style="font-size:8.5pt;color:' + T2.mutedTxt + '">' + r.actual + '</span>' +
        '</div>';
      }).join('');
    }

    // 2) (Re)build the Highcharts xrange chart
    var el = document.getElementById('agChart');
    if (!el || typeof Highcharts === 'undefined') return;

    if (st.chart) { try { st.chart.destroy(); } catch (_) {} st.chart = null; }

    var day = function(d) { return Date.UTC(2026, 4, d); }; // May 2026 fallback
    var categories = rows.map(function(r) { return r.level > 0 ? '   ' + r.id + ' ' + r.name : r.id + '. ' + r.name; });

    // If ANY row carries real timestamps (from the API), use absolute dates with a
    // dynamic axis range; otherwise fall back to the legacy May-2026 day window.
    var useTs = rows.some(function(r) { return r.startTs !== undefined && r.endTs !== undefined; });
    var xOf  = function(r) { return useTs ? (r.startTs != null ? r.startTs : (r.endTs != null ? r.endTs : Date.now())) : day(r.startDay); };
    var x2Of = function(r) { return useTs ? (r.endTs   != null ? r.endTs   : (r.startTs != null ? r.startTs : Date.now())) : day(r.endDay); };
    var data = rows.map(function(r, i) {
      return { x: xOf(r), x2: x2Of(r), y: i, partialFill: r.pct, color: r.color, name: r.name };
    });

    // Dynamic axis range — 5th/95th percentile of start dates so a far-out outlier
    // milestone doesn't compress the whole chart.
    var axisMin = day(1), axisMax = day(27);
    if (useTs) {
      var starts = rows.map(function(r){ return r.startTs; }).filter(function(t){ return t != null; }).sort(function(a,b){ return a - b; });
      if (starts.length > 0) {
        var pick = function(p) { return starts[Math.min(starts.length - 1, Math.max(0, Math.floor(p * (starts.length - 1))))]; };
        var p05 = pick(0.05), p95 = pick(0.95);
        var dayMs = 24 * 3600 * 1000;
        var span = Math.max(p95 - p05, 7 * dayMs);
        var pad  = Math.min(30 * dayMs, Math.max(3 * dayMs, span * 0.05));
        axisMin = p05 - pad;
        axisMax = p95 + pad;
      }
    }
    var today = useTs ? Date.now() : day(20);
    var HEADER = 60, FOOTER = 4, ROW = 36;
    var height = HEADER + FOOTER + rows.length * ROW;

    st.chart = Highcharts.chart(el, {
      chart: {
        type: 'xrange',
        backgroundColor: 'transparent',
        height: height,
        spacingTop: HEADER,
        spacingBottom: FOOTER,
        spacingLeft: 0,
        spacingRight: 8,
        style: { fontFamily: "'Inter','Calibri','Arial',sans-serif" }
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        min: axisMin,
        max: axisMax,
        opposite: true,
        // Day ticks while the window is short, monthly labels once it spans > 2 months.
        tickInterval: (axisMax - axisMin) > 60 * 24 * 3600 * 1000 ? undefined : 24 * 3600 * 1000,
        labels: {
          format: (axisMax - axisMin) > 60 * 24 * 3600 * 1000 ? '{value:%b %y}' : '{value:%d %b}',
          style: { fontSize: '8.5px', color: T2.mutedTxt }
        },
        gridLineWidth: 1,
        gridLineColor: T2.gridLine,
        plotLines: [
          {
            value: today, color: '#29378d', width: 2, zIndex: 5,
            label: { text: 'Today', align: 'center', y: -4, style: { color: '#29378d', fontSize: '8.5px', fontWeight: '700' } }
          }
        ]
      },
      yAxis: {
        categories: categories,
        reversed: true,
        title: { text: undefined },
        labels: { enabled: false },
        gridLineColor: T2.gridLine,
        lineWidth: 0,
        tickWidth: 0
      },
      tooltip: {
        useHTML: true,
        backgroundColor: T2.tooltipBg,
        borderColor: T2.tooltipBdr,
        style: { color: T2.tooltipBodyCol },
        formatter: function() {
          var start = Highcharts.dateFormat('%e %b', this.point.x);
          var end   = Highcharts.dateFormat('%e %b', this.point.x2);
          var pct   = Math.round((this.point.partialFill || 0) * 100);
          return '<b>' + this.point.name + '</b><br/>' + start + ' → ' + end + '<br/>Progress: <b>' + pct + '%</b>';
        }
      },
      plotOptions: {
        xrange: {
          borderRadius: 6,
          borderWidth: 0,
          pointPadding: 0.15,
          groupPadding: 0,
          dataLabels: {
            enabled: true,
            inside: false,
            align: 'right',
            formatter: function() { return Math.round((this.point.partialFill || 0) * 100) + '%'; },
            style: { fontSize: '8.5px', fontWeight: '700', textOutline: 'none', color: T2.cream },
            x: 32
          }
        }
      },
      series: [{ name: 'Activities', pointWidth: 14, data: data }]
    });
  };

  window.agSetMode = function(mode) {
    var st = window._agState;
    if (!st || st.mode === mode) return;
    st.mode = mode;
    // Update toggle button styling
    var tree = document.getElementById('agModeTree');
    var list = document.getElementById('agModeList');
    var isLight = st.T2.isLight;
    var dim = st.T2.dimtext || st.T2.mutedTxt;
    if (tree && list) {
      var activeBg = isLight ? '#fff' : 'rgba(41,55,141,0.18)';
      tree.style.background = mode === 'tree' ? activeBg : 'transparent';
      tree.style.color      = mode === 'tree' ? '#29378d' : dim;
      tree.style.boxShadow  = mode === 'tree' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none';
      list.style.background = mode === 'list' ? activeBg : 'transparent';
      list.style.color      = mode === 'list' ? '#29378d' : dim;
      list.style.boxShadow  = mode === 'list' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none';
    }
    window.agRender();
  };

  window.agToggleRow = function(idx) {
    var st = window._agState;
    if (!st || st.mode !== 'tree') return;
    var r = st.wbs[idx];
    if (!r || !r.hasChildren) return;
    r.expanded = !r.expanded;
    // Collapsing a parent should also collapse any nested expanded children
    if (!r.expanded) {
      for (var i = idx + 1; i < st.wbs.length && st.wbs[i].level > r.level; i++) {
        if (st.wbs[i].hasChildren) st.wbs[i].expanded = false;
      }
    }
    window.agRender();
  };

  /* ── Global handler used by the Day/Week/Month buttons inline onclick ── */
  window.prSetRange = function(key) {
    console.log('[well-detail-live] prSetRange called with key =', key);
    var st = window._prState;
    if (!st || !st.chart) {
      console.warn('[well-detail-live] prSetRange aborted — _prState or chart missing', { hasState: !!st, hasChart: !!(st && st.chart) });
      return;
    }
    console.log('[well-detail-live] _prState.wellId =', st.wellId, '_prFetch type =', typeof window._prFetch);

    // Update the active-button styling immediately for snappy UI feedback.
    ['day','week','month'].forEach(function(k) {
      var b = document.getElementById('prRange' + k.charAt(0).toUpperCase() + k.slice(1));
      if (!b) return;
      var active = (k === key);
      b.style.background = active ? st.accent  : 'transparent';
      b.style.color      = active ? '#fff'     : st.dimtext;
      b.style.boxShadow  = active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none';
    });

    var applyRange = function(r) {
      console.log('[well-detail-live] applyRange called with', r && r.categories ? r.categories.length + ' points' : 'null', 'chartValid:', !!(st.chart && st.chart.renderer));
      if (!r || !st.chart || st.chart.renderer == null) return;
      var v = r.plannedProgress.map(function(p, i) {
        return [Math.min(p, r.actualProgress[i]), Math.max(p, r.actualProgress[i])];
      });
      st.chart.xAxis[0].update({
        categories: r.categories,
        plotLines: r.milestones.map(function(m) {
          return {
            color: st.gridLineCol, value: m.x, width: 1, dashStyle: 'Dash', zIndex: 2,
            label: { text: '◆ ' + m.label, rotation: 0, y: -10, align: 'center',
                     style: { color: st.milestoneCol, fontSize: '8.5pt', fontWeight: '600' } }
          };
        })
      }, false);
      st.chart.series[0].setData(v, false);
      st.chart.series[1].setData(r.plannedRevenue, false);
      st.chart.series[2].setData(r.actualRevenue,  false);
      st.chart.series[3].setData(r.plannedProgress, false);
      st.chart.series[4].setData(r.actualProgress,  false);
      st.chart.redraw();
    };

    // Prefer the live per-well API data when available; fall back to the local
    // hardcoded RANGE entry while the network call is in flight or if it fails.
    if (typeof window._prFetch === 'function') {
      console.log('[well-detail-live] fetching real data for wellId=' + st.wellId + ' period=' + key);
      window._prFetch(st.wellId, key).then(function(real) {
        console.log('[well-detail-live] fetch resolved, real =', real && real.categories ? real.categories.length + ' points' : 'null');
        if (real) {
          st.ranges[key] = real;   // cache so subsequent toggles are instant
          applyRange(real);
        } else if (typeof window._prShowEmptyState === 'function') {
          // No real data for this well in this period — surface an explicit empty
          // state instead of silently falling back to the dummy hardcoded RANGE.
          window._prShowEmptyState();
        }
      }).catch(function(err) {
        console.warn('[well-detail-live] prSetRange fetch failed for', key, err);
        if (typeof window._prShowEmptyState === 'function') window._prShowEmptyState();
      });
    } else if (st.ranges[key]) {
      console.log('[well-detail-live] _prFetch missing, using local RANGE[' + key + ']');
      applyRange(st.ranges[key]);
    }
  };

  /* ── Install override ────────────────────────────────────────────── */
  // ── Well Report helpers — derive real MILESTONES/ACTIVITY_MASTER from WMR ──

  function _wrptStatusFromPctAndLabel(pct, label) {
    var u = (label || '').toUpperCase();
    if (u === 'COMPLETED' || pct >= 95) return 'done';
    if (pct > 0) return 'inprogress';
    return 'upcoming';
  }

  function buildMilestonesFromWmr(wellId, d) {
    var ms = [];
    var push = function(msName, owner, actualDate, pct, label) {
      var st = _wrptStatusFromPctAndLabel(pct, label);
      ms.push({
        well:     wellId,
        ms:       msName,
        owner:    owner,
        planned:  actualDate || '—',
        forecast: st === 'done' ? null : actualDate || null,
        actual:   (st === 'done' && actualDate) ? actualDate : null,
        status:   st,
        varDays:  0
      });
    };
    push('Location Preparation', 'Civil Team',          d.rigOnDate  || null, d.locPrepPct,     d.locPrepStatus);
    push('Flowline Construction', 'Mechanical Team',    null,                  d.constructionPct, d.flConstructionStatus);
    push('Flowline Commissioning', 'Commissioning Team', null,                 d.commissioningPct, d.flCommissioningStatus);
    push('OHL Work',              'Electrical Team',    null,                  d.ohlPct,          null);
    push('Rig On',                'PDO Operations',     d.rigOnDate  || null, d.rigOnDate  ? 100 : 0, null);
    push('Rig Off / Completion',  'PDO Closeout',       d.rigOffDate || null, d.rigOffDate ? 100 : (d.overallProgressPct >= 95 ? 100 : 0), null);
    return ms;
  }

  function buildActivitiesFromWmr(wellId, d) {
    var acts = [];
    var push = function(code, desc, group, pct, label) {
      var u = (label || '').toUpperCase();
      var st = (u === 'COMPLETED' || pct >= 95) ? 'completed'
             : (pct > 0)                         ? 'inprogress'
             :                                     'notstarted';
      acts.push({ well: wellId, code: code, description: desc, status: st, group: group, crewName: '—', pct: Math.round(pct) });
    };
    push('WMR-LOC-01', 'Location Preparation',   'Civil',          d.locPrepPct,      d.locPrepStatus);
    push('WMR-FLC-01', 'Flowline Construction',  'Mechanical',     d.constructionPct,  d.flConstructionStatus);
    push('WMR-FLM-01', 'Flowline Commissioning', 'Commissioning',  d.commissioningPct, d.flCommissioningStatus);
    push('WMR-OHL-01', 'OHL Work',               'Electrical',     d.ohlPct,           null);
    return acts;
  }

  function buildWrptBodyHtml(wellId, d, rd) {
    // rd = WellReportDataDto from /wells/{id}/report-data (may be null if API call failed)
    var sapRows  = (rd && rd.drillingSequence)  || [];
    var atpRows  = (rd && rd.activityTasks)      || [];
    var dailyRows = (rd && rd.dailyTasks)        || [];
    var DA   = '\u2014';
    var pct  = Math.round(d.overallProgressPct || 0);
    var locP = Math.round(d.locPrepPct || 0);
    var conP = Math.round(d.constructionPct || 0);
    var comP = Math.round(d.commissioningPct || 0);
    var ohlP = Math.round(d.ohlPct || 0);

    // Status
    var statusLabel = ({ completed:'Completed', inprogress:'In Progress', critical:'Critical',
                         onhold:'On Hold', planned:'Planned' })[d.status] || (d.status || DA);
    var statusCol = d.status === 'completed' ? '#00B050' : d.status === 'critical' ? '#FF0000' :
                    d.status === 'onhold' ? '#FFC000' : '#29378d';
    var priority = d.status === 'critical'   ? 'P1 \u00b7 CRITICAL'
                 : d.status === 'onhold'     ? 'P2 \u00b7 BLOCKED'
                 : d.status === 'inprogress' ? 'P3 \u00b7 ACTIVE'
                 : d.status === 'completed'  ? 'P5 \u00b7 DELIVERED'
                 : 'P4 \u00b7 STANDARD';
    var execStatus = d.status === 'completed' ? 'DELIVERED'
                   : d.status === 'critical'  ? 'CRITICAL'
                   : d.status === 'onhold'    ? 'AT RISK'
                   : d.status === 'inprogress'? 'ACTIVE'
                   : 'PLANNED';
    var execStatusCol = execStatus === 'CRITICAL' ? '#FF0000'
                      : execStatus === 'AT RISK'  ? '#FFC000'
                      : execStatus === 'DELIVERED'? '#00B050' : '#29378d';

    // Risk
    var risk = d.isDelayed ? 'High' : pct >= 80 ? 'Low' : pct >= 50 ? 'Medium' : 'High';
    var riskCol = risk === 'High' ? '#FF0000' : risk === 'Medium' ? '#FFC000' : '#00B050';

    // Data completeness
    var allFields = [d.pdoWellId, d.wellType, d.rigNo, d.wellLocation, d.stationName,
                     d.projectId, d.weekNumber, d.wellYear, d.bufferStatus,
                     d.rigOnDate, d.rigOffDate, d.northing, d.easting, d.locationDd, d.flowLineDl];
    var filled = allFields.filter(function(f){ return f && String(f).trim() !== ''; }).length;
    var dataComp = Math.round((filled / allFields.length) * 100);

    // Velocity
    var tl = d.timeline || [];
    var velocity = 0;
    if (tl.length >= 2) velocity = tl[tl.length-1].progressPct - tl[tl.length-2].progressPct;
    var velocityStr = velocity !== 0 ? (velocity > 0 ? '+' : '') + velocity.toFixed(1) + '%' : '+0%';

    // Key issue + action
    var keyIssue, execAction;
    if (d.status === 'completed') {
      keyIssue = 'Handover complete \u00b7 zero issues'; execAction = 'No action required';
    } else if (d.isDelayed && d.delayReason) {
      keyIssue = d.delayReason; execAction = 'Review delay cause and update recovery plan';
    } else if (pct < 30) {
      keyIssue = 'Early stage \u2014 monitor progress closely'; execAction = 'Ensure resource allocation is confirmed';
    } else if (risk === 'High') {
      keyIssue = 'Progress below target \u2014 recovery needed'; execAction = 'Escalate to cluster manager';
    } else {
      keyIssue = 'On track \u2014 continue planned activities'; execAction = 'Continue as planned';
    }

    // Forecast completion
    var forecastTxt = DA, delayForecastDays = 0, currentRateTxt = DA;
    if (velocity > 0 && pct < 100) {
      var weeksLeft = Math.ceil((100 - pct) / velocity);
      var fd = new Date(2026, 4, 18);
      fd.setDate(fd.getDate() + weeksLeft * 7);
      forecastTxt = fd.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      delayForecastDays = weeksLeft * 7;
      currentRateTxt = '+' + velocity.toFixed(1) + '%';
    } else if (pct >= 100) {
      forecastTxt = 'Completed'; delayForecastDays = 0; currentRateTxt = '+0%';
    }

    // ── Helpers ──────────────────────────────────────────────────────
    var v = function(val) {
      return (val !== null && val !== undefined && String(val).trim() !== '') ? esc(String(val)) : DA;
    };
    var phSt = function(p, lbl) {
      var u = (lbl || '').toUpperCase();
      return u === 'COMPLETED' || p >= 95 ? 'Complete' : p > 0 ? 'Ongoing' : 'Not Started';
    };
    var statusColor = function(s) {
      var k = String(s || '').toLowerCase();
      if (k.indexOf('complet') >= 0 || k.indexOf('deliver') >= 0) return '#00B050';
      if (k.indexOf('overdue') >= 0 || k.indexOf('critical') >= 0) return '#FF0000';
      if (k.indexOf('risk') >= 0 || k.indexOf('block') >= 0) return '#FFC000';
      if (k.indexOf('ongoing') >= 0 || k.indexOf('on track') >= 0) return '#29378d';
      return '#6B7280';
    };
    var secHdr = function(num, title, sub, infoId) {
      var infoBtn = wdRelBadge(infoId, 'margin-left:6px;vertical-align:middle');
      return '<div class="wrpt-section-head">' +
        '<span class="wrpt-section-num">' + num + '</span>' +
        '<div>' +
          '<div class="wrpt-section-title" style="display:inline-flex;align-items:center">' + title + infoBtn + '</div>' +
          (sub ? '<div class="wrpt-section-sub">' + sub + '</div>' : '') +
        '</div>' +
      '</div>';
    };
    var kpiTile = function(lbl, val, sub, col) {
      return '<div class="wrpt-kpi-tile" style="--accent:' + col + '">' +
        '<div class="wrpt-kpi-lbl">' + lbl + '</div>' +
        '<div class="wrpt-kpi-val" style="color:' + col + '">' + val + '</div>' +
        '<div class="wrpt-kpi-sub">' + sub + '</div>' +
      '</div>';
    };
    var dotStatus = function(s) {
      var c = statusColor(s);
      return '<span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;font-size:9pt;color:' + c + '">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + c + ';flex-shrink:0;display:inline-block"></span>' +
        esc(s) + '</span>';
    };
    var pbar = function(p, col) {
      return '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;width:' + p + '%;background:' + (col || '#29378d') + ';border-radius:3px"></div>' +
        '</div>' +
        '<span style="font-size:9pt;font-weight:600;min-width:32px;text-align:right;color:' + (col || '#29378d') + '">' + p + '%</span>' +
      '</div>';
    };
    var th = 'padding:8px 10px;font-size:8.5pt;color:#64748b;font-weight:600;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;background:#f8fafc';
    var td = 'padding:7px 10px;font-size:9pt;border-bottom:1px solid #f1f5f9;vertical-align:middle';
    var gridTable = function(cols, rows) {
      var ths = cols.map(function(c) { return '<th style="' + th + '">' + esc(c) + '</th>'; }).join('');
      var trs = (!rows || rows.length === 0)
        ? '<tr><td colspan="' + cols.length + '" style="' + td + ';text-align:center;color:#94a3b8;padding:20px">' + DA + ' No data available in WMR</td></tr>'
        : rows.map(function(row) {
            return '<tr>' + row.map(function(cell) { return '<td style="' + td + '">' + cell + '</td>'; }).join('') + '</tr>';
          }).join('');
      return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table></div>';
    };
    var kv = function(lbl, val) {
      var display = (val !== null && val !== undefined && String(val).trim() !== '') ? esc(String(val)) : DA;
      return '<div style="display:flex;padding:6px 0;border-bottom:1px solid #f1f5f9">' +
        '<span style="min-width:180px;flex-shrink:0;color:#64748b;font-size:9pt">' + esc(lbl) + '</span>' +
        '<span style="font-size:9pt;font-weight:500">' + display + '</span>' +
      '</div>';
    };

    var html = '';

    // ══════════════════════════════════════════════════════════════════
    // EXECUTIVE VIEW
    // ══════════════════════════════════════════════════════════════════
    html += '<div class="wrpt-tier-label">Executive View</div>';

    // Section 1: Well Overview
    html += '<section class="wrpt-section">' +
      secHdr(1, 'Well Overview', 'Quick identity &amp; current status', 'execWellOverview') +
      '<div class="wrpt-overview-card">' +
        '<div class="wrpt-overview-id">' +
          '<div class="wrpt-overview-name">' + esc(String(wellId)) + '</div>' +
          '<div class="wrpt-overview-tags">' +
            (d.wellType ? '<span class="wrpt-chip">' + esc(d.wellType) + '</span>' : '') +
            '<span class="wrpt-chip">GREENSIDE</span>' +
            (d.rigNo ? '<span class="wrpt-chip">' + esc(d.rigNo) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="wrpt-overview-grid">' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Cluster &middot; Location</div><div class="wrpt-of-val">' + v(d.wellLocation) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Project ID</div><div class="wrpt-of-val">' + v(d.projectId) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Rig &middot; Contractor</div><div class="wrpt-of-val">' + (d.rigNo ? esc(d.rigNo) + ' &middot; Al Tasnim' : DA) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Status</div><div class="wrpt-of-val" style="color:' + statusCol + ';font-weight:700">' + esc(statusLabel) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Completion</div><div class="wrpt-of-val">' + pct + '%</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Priority</div><div class="wrpt-of-val">' + esc(priority) + '</div></div>' +
          (d.wellFunction ? '<div class="wrpt-of"><div class="wrpt-of-lbl">Well Function</div><div class="wrpt-of-val">' + esc(d.wellFunction) + '</div></div>' : '') +
          (d.wellCategory ? '<div class="wrpt-of"><div class="wrpt-of-lbl">Well Category</div><div class="wrpt-of-val">' + esc(d.wellCategory) + '</div></div>' : '') +
          (d.pcapCategory ? '<div class="wrpt-of"><div class="wrpt-of-lbl">PCAP Category</div><div class="wrpt-of-val">' + esc(d.pcapCategory) + '</div></div>' : '') +
          (d.pdoWellType  ? '<div class="wrpt-of"><div class="wrpt-of-lbl">PDO Well Type</div><div class="wrpt-of-val">' + esc(d.pdoWellType)  + '</div></div>' : '') +
        '</div>' +
      '</div>' +
    '</section>';

    // Section 2: Progress Summary KPIs
    html += '<section class="wrpt-section">' +
      secHdr(2, 'Progress Summary', 'Snapshot performance KPIs', 'execProgressSummary') +
      '<div class="wrpt-kpi-grid">' +
        kpiTile('OVERALL PROGRESS', pct + '%', 'Plan ' + pct + '%', '#29378d') +
        kpiTile('COMPLETION RISK', risk, risk === 'Low' ? 'On track' : risk === 'Medium' ? 'Monitor closely' : 'Recovery needed', riskCol) +
        kpiTile('DATA COMPLETENESS', dataComp + '%', 'WMR fields filled', '#7c3aed') +
        kpiTile('VELOCITY', velocityStr, 'progress / week', '#00B0F0') +
        kpiTile('WEEK NO.', v(d.weekNumber), 'current WMR week', '#0891b2') +
      '</div>' +
    '</section>';

    // Section 16: Executive Summary
    html += '<section class="wrpt-section wrpt-summary">' +
      secHdr(16, 'Executive Summary', 'Quick decision', 'execSummary') +
      '<div class="wrpt-summary-grid">' +
        '<div class="wrpt-summary-status" style="border-color:' + execStatusCol + '">' +
          '<div class="wrpt-summary-eyebrow">Status</div>' +
          '<div class="wrpt-summary-status-val" style="color:' + execStatusCol + '">' + esc(execStatus) + '</div>' +
        '</div>' +
        '<div class="wrpt-summary-block">' +
          '<div class="wrpt-summary-eyebrow">Key Issue</div>' +
          '<div class="wrpt-summary-text">' + esc(keyIssue) + '</div>' +
        '</div>' +
        '<div class="wrpt-summary-block">' +
          '<div class="wrpt-summary-eyebrow">Recommended Action</div>' +
          '<div class="wrpt-summary-text">' + esc(execAction) + '</div>' +
        '</div>' +
      '</div>' +
    '</section>';

    // ══════════════════════════════════════════════════════════════════
    // OPERATIONAL VIEW
    // ══════════════════════════════════════════════════════════════════
    html += '<div class="wrpt-tier-label">Operational View</div>';

    // Section 3: Timeline & Milestones (SAP drilling sequence when available, else WMR dates)
    var msTblRows;
    if (sapRows.length > 0) {
      msTblRows = sapRows.map(function(r) {
        var stCol = statusColor(r.systemStatus || '');
        return [
          '<span style="font-weight:600">' + (r.operationShort ? esc(r.operationShort) : DA) + '</span>',
          r.workCenter ? esc(r.workCenter) : DA,
          r.plannedStart || DA,
          r.plannedEnd   || DA,
          r.duration ? esc(r.duration) + (r.durationUnit ? ' ' + esc(r.durationUnit) : '') : DA,
          r.systemStatus ? '<span style="color:' + stCol + ';font-weight:600">' + esc(r.systemStatus) + '</span>' : DA
        ];
      });
      html += '<section class="wrpt-section">' +
        secHdr(3, 'Timeline &amp; Milestones', 'SAP drilling sequence &middot; ' + sapRows.length + ' operations', 'opTimeline') +
        gridTable(['Operation', 'Work Center', 'Planned Start', 'Planned End', 'Duration', 'Status'], msTblRows) +
      '</section>';
    } else {
      var msRows = [
        { ms:'Pre-Drill',         owner:'PDO Wells',        planned:v(d.rigOnDate),  forecast:v(d.rigOnDate),  st:d.rigOnDate ? 'Complete' : 'Not Started' },
        { ms:'Rig On',            owner:'PDO Operations',   planned:v(d.rigOnDate),  forecast:v(d.rigOnDate),  st:d.rigOnDate ? 'Complete' : 'Not Started' },
        { ms:'Drilling Start',    owner:'Drilling Team',    planned:DA,              forecast:DA,              st:'Not Started' },
        { ms:'Target Depth (TD)', owner:'Drilling Team',    planned:DA,              forecast:DA,              st:'Not Started' },
        { ms:'Completion Start',  owner:'Commissioning',    planned:DA,              forecast:DA,              st:phSt(comP, d.flCommissioningStatus) },
        { ms:'Final Completion',  owner:'PDO Closeout',     planned:v(d.rigOffDate), forecast:v(d.rigOffDate), st:d.rigOffDate ? 'Complete' : (pct >= 95 ? 'Complete' : 'Pending') }
      ];
      msTblRows = msRows.map(function(r) {
        return ['<span style="font-weight:600">' + esc(r.ms) + '</span>', esc(r.owner), r.planned, r.forecast, DA, dotStatus(r.st)];
      });
      html += '<section class="wrpt-section">' +
        secHdr(3, 'Timeline &amp; Milestones', 'WMR rig dates &middot; SAP sequence not available', 'opTimeline') +
        gridTable(['Milestone', 'Owner', 'Planned', 'Forecast / Actual', 'Variance', 'Status'], msTblRows) +
      '</section>';
    }

    // Section 4: Activity-Level Progress (ActivityTaskPlan when available, else WMR phases)
    var actTblRows;
    if (atpRows.length > 0) {
      actTblRows = atpRows.map(function(r) {
        var p = r.progressPct || 0;
        var col = p >= 95 ? '#00B050' : p >= 50 ? '#FFC000' : p > 0 ? '#29378d' : '#cbd5e1';
        return [
          '<span style="color:#29378d;font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);font-size:8.5pt">' + (r.code ? esc(r.code) : DA) + '</span>',
          r.text ? esc(r.text) : DA,
          r.type ? esc(r.type) : DA,
          r.plannedStart || DA,
          r.plannedEnd   || DA,
          r.crewType ? esc(r.crewType) : DA,
          pbar(p, col),
          dotStatus(p >= 95 ? 'Complete' : p > 0 ? 'Ongoing' : 'Pending')
        ];
      });
      html += '<section class="wrpt-section">' +
        secHdr(4, 'Activity-Level Progress', 'ActivityTaskPlan &middot; ' + atpRows.length + ' tasks', 'opActivityProgress') +
        gridTable(['Activity ID', 'Activity', 'Type', 'Start', 'End', 'Crew', 'Progress', 'Status'], actTblRows) +
      '</section>';
    } else {
      var actData = [
        { code:'F-1-101',    desc:'Location Preparation',   disc:'Civil',         p:locP,  st:d.locPrepStatus,           start:d.rigOnDate, end:d.rigOnDate },
        { code:'F-1-170-P',  desc:'Flowline Construction',  disc:'Mechanical',    p:conP,  st:d.flConstructionStatus,    start:null, end:null },
        { code:'F-2-5-FBC',  desc:'Flowline Commissioning', disc:'Commissioning', p:comP,  st:d.flCommissioningStatus,   start:null, end:null },
        { code:'F-3-OHL-01', desc:'OHL Work',               disc:'Electrical',    p:ohlP,  st:null,                      start:null, end:null }
      ];
      actTblRows = actData.map(function(r) {
        var p = r.p, col = p >= 95 ? '#00B050' : p >= 50 ? '#FFC000' : p > 0 ? '#29378d' : '#cbd5e1';
        var stLabel = r.st ? (r.st.toLowerCase().indexOf('completed') >= 0 || p >= 95 ? 'Comp.' : r.st.toLowerCase().indexOf('progress') >= 0 || p > 0 ? 'Ongoing' : 'Pending') : (p >= 95 ? 'Comp.' : p > 0 ? 'Ongoing' : 'Pending');
        return [
          '<span style="color:#29378d;font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);font-size:8.5pt">' + esc(r.code) + '</span>',
          esc(r.desc), esc(r.disc),
          v(r.start), v(r.end),
          DA, pbar(p, col), dotStatus(stLabel)
        ];
      });
      html += '<section class="wrpt-section">' +
        secHdr(4, 'Activity-Level Progress', 'Phase progress from WMR', 'opActivityProgress') +
        gridTable(['Activity ID', 'Activity', 'Discipline', 'Start', 'End', 'Crew', 'Progress', 'Status'], actTblRows) +
      '</section>';
    }

    // Section 5: Crew Performance (task_daily crew data when available)
    var crewMap = {};
    dailyRows.forEach(function(r) {
      var key = (r.crewCode || r.crewType || 'Unknown');
      if (!crewMap[key]) crewMap[key] = { crewId: key, crewType: r.crewType || DA, tasks: 0, hours: 0, qty: 0, completed: 0 };
      crewMap[key].tasks++;
      crewMap[key].hours    += r.actualHours    || 0;
      crewMap[key].qty      += r.actualQuantity || 0;
      if (r.dailyCompleted) crewMap[key].completed++;
    });
    var crewKeys = Object.keys(crewMap);
    var crewRows;
    if (crewKeys.length > 0) {
      crewRows = crewKeys.map(function(k) {
        var c = crewMap[k];
        var compRate = c.tasks > 0 ? Math.round(c.completed / c.tasks * 100) : 0;
        var compCol  = compRate >= 80 ? '#00B050' : compRate >= 50 ? '#FFC000' : '#FF0000';
        return [
          '<span style="font-family:var(--font-family-mono, \'Inter\',\'Calibri\',\'Arial\',sans-serif);font-size:8pt;color:#64748b">' + esc(c.crewId) + '</span>',
          '<span style="font-weight:600">' + esc(c.crewType) + '</span>',
          DA,
          '<span style="color:' + compCol + ';font-weight:600">' + compRate + '%</span>',
          c.tasks.toString(),
          c.hours.toFixed(1) + ' hrs',
          c.qty.toFixed(1)
        ];
      });
    } else {
      crewRows = [
        ['CR-001', DA, 'Mechanical', DA, DA, DA, DA],
        ['CR-002', DA, 'Mechanical', DA, DA, DA, DA],
        ['CR-003', DA, 'Civil',      DA, DA, DA, DA],
        ['CR-004', DA, 'Instrument', DA, DA, DA, DA]
      ];
    }
    html += '<section class="wrpt-section">' +
      secHdr(5, 'Crew Performance', crewKeys.length > 0 ? 'task_daily &middot; ' + crewKeys.length + ' crew(s) assigned to well ' + esc(String(wellId)) : 'Crews &middot; PI ratings &middot; trend', 'opCrewPerformance') +
      gridTable(['Crew ID', 'Crew Type', 'Discipline', 'Task Completion %', 'Tasks', 'Actual Hours', 'Actual Qty'], crewRows) +
    '</section>';

    // Section 7: NPT — Non-Productive Time (no WMR data)
    var nptRows = [
      [DA, DA, DA, DA, DA],
      [DA, DA, DA, DA, DA]
    ];
    html += '<section class="wrpt-section">' +
      secHdr(7, 'NPT \u2014 Non-Productive Time', 'Cost + delay tracking', 'opNpt') +
      gridTable(['Date', 'Hours', 'Category', 'Reason', 'Schedule Impact'], nptRows) +
    '</section>';

    // Section 8: Materials & Equipment (no WMR data)
    var matRows = [
      [DA, DA, DA, DA, DA, DA],
      [DA, DA, DA, DA, DA, DA]
    ];
    html += '<section class="wrpt-section">' +
      secHdr(8, 'Materials &amp; Equipment', 'Dependency tracking', 'opMaterials') +
      gridTable(['Material', 'Category', 'Vendor', 'PO Status', 'Readiness', 'Risk'], matRows) +
    '</section>';

    // Section 9: Dependency / Predecessor Status
    var predData = [
      { stage:'Location Preparation',   act:'Civil ground prep + material delivery',  p:locP, st:phSt(locP, d.locPrepStatus),             blocked:'' },
      { stage:'Rig On',                 act:'Rig handover and acceptance from PDO',   p:d.rigOnDate?100:0, st:d.rigOnDate?'Complete':'Not Started', blocked:'' },
      { stage:'Flowline Construction',  act:'Mechanical construction + pipe welding', p:conP, st:phSt(conP, d.flConstructionStatus),          blocked:conP > 0 ? '' : 'Loc Prep' },
      { stage:'Flowline Commissioning', act:'Commissioning + hook-up',                p:comP, st:phSt(comP, d.flCommissioningStatus),          blocked:comP > 0 ? '' : 'FL Const' }
    ];
    html += '<section class="wrpt-section">' +
      secHdr(9, 'Dependency / Predecessor Status', 'Flow tracking and blockers', 'opDependency') +
      '<div class="wrpt-pred-list">' +
      predData.map(function(r) {
        var col = statusColor(r.st);
        var blk = r.blocked
          ? '<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:8pt">\u2296 ' + esc(r.blocked) + '</span>'
          : DA;
        return '<div class="wrpt-pred-row">' +
          '<div class="wrpt-pred-stage">' +
            '<div class="wrpt-pred-name">' + esc(r.stage) + '</div>' +
            '<div class="wrpt-pred-act">' + esc(r.act) + '</div>' +
          '</div>' +
          '<div class="wrpt-pred-bar"><div class="wrpt-pred-fill" style="width:' + r.p + '%;background:' + col + '"></div></div>' +
          '<div class="wrpt-pred-pct" style="color:' + col + '">' + r.p + '%</div>' +
          '<div class="wrpt-pred-status" style="color:' + col + '">' + dotStatus(r.st) + '</div>' +
          '<div class="wrpt-pred-blocked">' + blk + '</div>' +
        '</div>';
      }).join('') +
      '</div>' +
    '</section>';

    // Section 10: Blockers & Risks
    var blockers = [];
    if (d.isDelayed && d.delayReason) {
      blockers.push({ cat:'DELAY', sev:'High', text:d.delayReason, owner:'Operations Lead' });
    }
    if (blockers.length === 0) {
      blockers.push({ cat:'STATUS', sev:'Low', text:'No blockers or risks recorded in WMR', owner:DA });
    }
    html += '<section class="wrpt-section">' +
      secHdr(10, 'Blockers &amp; Risks', 'Decision support items', 'opBlockers') +
      '<div class="wrpt-blockers">' +
      blockers.map(function(b) {
        var sc = b.sev === 'High' ? '#FF0000' : b.sev === 'Medium' ? '#FFC000' : '#00B050';
        return '<div class="wrpt-blocker">' +
          '<div class="wrpt-blocker-head">' +
            '<span class="wrpt-blocker-cat">' + esc(b.cat) + '</span>' +
            '<span class="wrpt-blocker-sev" style="color:' + sc + '">' + esc(b.sev) + '</span>' +
          '</div>' +
          '<div class="wrpt-blocker-text">' + esc(b.text) + '</div>' +
          '<div class="wrpt-blocker-owner">Owner &middot; ' + esc(b.owner) + '</div>' +
        '</div>';
      }).join('') +
      '</div>' +
    '</section>';

    // Section 11: Location & Mapping
    html += '<section class="wrpt-section">' +
      secHdr(11, 'Location &amp; Mapping', 'Field visibility', 'opLocationMapping') +
      '<div class="wrpt-loc-grid">' +
        '<div class="wrpt-loc-map">' +
          '<svg viewBox="0 0 200 110" width="100%" height="110" preserveAspectRatio="none">' +
            '<defs><pattern id="wrptmap2" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#cbd5e1" stroke-width="0.5"/></pattern></defs>' +
            '<rect width="100%" height="100%" fill="#f3f4f6"/>' +
            '<rect width="100%" height="100%" fill="url(#wrptmap2)"/>' +
            '<circle cx="100" cy="55" r="6" fill="#0891b2"/>' +
            '<circle cx="100" cy="55" r="14" fill="none" stroke="#0891b2" stroke-width="1" opacity="0.4"/>' +
            '<circle cx="60"  cy="35" r="3" fill="#94a3b8"/>' +
            '<circle cx="140" cy="75" r="3" fill="#94a3b8"/>' +
            '<circle cx="155" cy="30" r="3" fill="#94a3b8"/>' +
            '<circle cx="40"  cy="80" r="3" fill="#94a3b8"/>' +
          '</svg>' +
        '</div>' +
        '<div class="wrpt-loc-info">' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Northing (N)</div><div class="wrpt-of-val">' + v(d.northing) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Easting (E)</div><div class="wrpt-of-val">' + v(d.easting) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Decimal Degrees</div><div class="wrpt-of-val">' + v(d.locationDd) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Station</div><div class="wrpt-of-val">' + v(d.stationName) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Well Location</div><div class="wrpt-of-val">' + v(d.wellLocation) + '</div></div>' +
          '<div class="wrpt-of"><div class="wrpt-of-lbl">Flow Line DL</div><div class="wrpt-of-val">' + v(d.flowLineDl) + '</div></div>' +
        '</div>' +
      '</div>' +
    '</section>';

    // ══════════════════════════════════════════════════════════════════
    // ANALYTICAL VIEW
    // ══════════════════════════════════════════════════════════════════
    html += '<div class="wrpt-tier-label">Analytical View</div>';

    // Section 12: Predictive Insights
    var delayCol = delayForecastDays === 0 ? '#00B050' : delayForecastDays > 14 ? '#FF0000' : '#FFC000';
    html += '<section class="wrpt-section">' +
      secHdr(12, 'Predictive Insights', 'Future visibility \u2014 derived from WMR velocity', 'opPredictive') +
      '<div class="wrpt-kpi-grid">' +
        kpiTile('FORECAST COMPLETION', forecastTxt, velocity > 0 ? 'model output' : 'insufficient data', '#29378d') +
        kpiTile('CURRENT RATE', currentRateTxt, '7-day avg', '#00B0F0') +
        kpiTile('DELAY FORECAST', delayForecastDays + 'd', 'vs plan', delayCol) +
        kpiTile('OVERALL PROGRESS', pct + '%', 'WMR actual', '#7c3aed') +
        kpiTile('COMPLETION RISK', risk, 'assessment', riskCol) +
      '</div>' +
    '</section>';

    // Section 17: Cost & Revenue (no WMR data)
    html += '<section class="wrpt-section">' +
      secHdr(17, 'Cost &amp; Revenue', 'Programme financials &middot; budget vs actual', 'opCostRevenue') +
      '<div class="wrpt-kpi-grid wrpt-fin-tiles">' +
        kpiTile('CONTRACT REVENUE', DA, 'Not in WMR', '#29378d') +
        kpiTile('COST', DA, 'Not in WMR', '#7c3aed') +
        kpiTile('PENALTY EXPOSURE', DA, 'Not in WMR', '#FF0000') +
        kpiTile('BONUS EARNED', DA, 'Not in WMR', '#00B050') +
        kpiTile('NET P&amp;L', DA, 'Not in WMR', '#0891b2') +
      '</div>' +
    '</section>';

    // Section 6: Anomalies & Alerts
    var anomalyRows = [];
    if (d.isDelayed && d.delayReason) {
      anomalyRows.push([DA, 'Delay', esc(d.delayReason), '<span style="color:#FF0000;font-weight:600">High</span>', '<span style="color:#FF0000">Open</span>']);
    }
    if (anomalyRows.length === 0) {
      anomalyRows.push([DA, DA, DA, DA, DA]);
    }
    html += '<section class="wrpt-section">' +
      secHdr(6, 'Anomalies &amp; Alerts', 'Issues that need attention', 'opAnomalies') +
      gridTable(['Date', 'Type', 'Description', 'Severity', 'Status'], anomalyRows) +
    '</section>';

    // Section 13: Recommendations (derived from WMR)
    var recs = [];
    if (d.status === 'completed') {
      recs.push({ rank:1, title:'Conduct post-completion review and close all open punch items', effort:'Low', impact:'High' });
    } else if (d.isDelayed) {
      recs.push({ rank:1, title:'Initiate recovery plan — identify root cause and assign corrective actions', effort:'High', impact:'High' });
      recs.push({ rank:2, title:'Escalate delay to cluster manager for resource reallocation', effort:'Medium', impact:'High' });
    } else if (pct < 50) {
      recs.push({ rank:1, title:'Confirm resource mobilisation for upcoming phases', effort:'Medium', impact:'High' });
      recs.push({ rank:2, title:'Validate planned vs actual schedule alignment for next 2 weeks', effort:'Low', impact:'Medium' });
    } else {
      recs.push({ rank:1, title:'Continue current pace — monitor velocity weekly', effort:'Low', impact:'Medium' });
      recs.push({ rank:2, title:'Pre-mobilise commissioning crew ahead of construction completion', effort:'Medium', impact:'High' });
    }
    recs.push({ rank: recs.length + 1, title:'Update WMR with latest field progress data', effort:'Low', impact:'Medium' });
    html += '<section class="wrpt-section">' +
      secHdr(13, 'Recommendations', 'WMR-derived actions &middot; based on current status', 'opRecommendations') +
      '<ol class="wrpt-rec-list">' +
      recs.map(function(r) {
        var effortCol = r.effort === 'Low' ? '#00B050' : r.effort === 'Medium' ? '#FFC000' : '#FF0000';
        var impactCol = r.impact === 'High' ? '#29378d' : r.impact === 'Medium' ? '#7c3aed' : '#94a3b8';
        return '<li class="wrpt-rec">' +
          '<div class="wrpt-rec-rank">' + r.rank + '</div>' +
          '<div class="wrpt-rec-body">' +
            '<div class="wrpt-rec-title">' + esc(r.title) + '</div>' +
            '<div class="wrpt-rec-meta">' +
              '<span class="wrpt-rec-pill" style="background:rgba(0,176,80,0.10);color:' + effortCol + ';border-color:' + effortCol + '">Effort: ' + esc(r.effort) + '</span>' +
              '<span class="wrpt-rec-pill" style="background:rgba(41,55,141,0.08);color:' + impactCol + ';border-color:' + impactCol + '">Impact: ' + esc(r.impact) + '</span>' +
              '<span class="wrpt-rec-pill grey">Source: WMR</span>' +
            '</div>' +
          '</div>' +
        '</li>';
      }).join('') +
      '</ol>' +
    '</section>';

    // Section 14: Historical Data (weekly progress from WMR)
    // Compute SAP linear planned % helper
    var sapStart = d.sapPlannedStart ? new Date(d.sapPlannedStart) : null;
    var sapEnd   = d.sapPlannedEnd   ? new Date(d.sapPlannedEnd)   : null;
    var sapTotalMs = (sapStart && sapEnd && sapEnd > sapStart) ? (sapEnd - sapStart) : null;
    function getPlannedPct(weekLabel) {
      if (!sapStart || !sapTotalMs) return null;
      // Parse "dd-MMM-yy" e.g. "11-Jun-26"
      var parts = weekLabel.split('-');
      if (parts.length !== 3) return null;
      var months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
      var mo = months[parts[1]]; if (mo === undefined) return null;
      var yr = 2000 + parseInt(parts[2], 10);
      var dt = new Date(yr, mo, parseInt(parts[0], 10));
      if (isNaN(dt)) return null;
      if (dt < sapStart) return 0;
      if (dt >= sapEnd)  return 100;
      return Math.round(((dt - sapStart) / sapTotalMs) * 100);
    }

    var tlLast = tl.slice(-12);
    var tlBody;
    if (tlLast.length === 0) {
      tlBody = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:9pt">' + DA + ' No weekly timeline data in WMR</div>';
    } else {
      var tlRows = tlLast.map(function(e) {
        var wp  = Math.round(e.progressPct || 0);
        var col = wp >= 80 ? '#00B050' : wp >= 50 ? '#FFC000' : '#29378d';
        var idx = tlLast.indexOf(e);
        var prev = idx > 0 ? Math.round(tlLast[idx - 1].progressPct || 0) : 0;
        var variance = wp - prev;
        var varStr = idx === 0 ? DA : (variance >= 0 ? '+' : '') + variance + '%';
        var varCol = variance > 0 ? '#00B050' : variance < 0 ? '#FF0000' : '#6B7280';
        var planned = getPlannedPct(e.week);
        var plannedStr = planned !== null ? planned + '%' : DA;
        var plannedCol = planned !== null ? '#94a3b8' : '#94a3b8';
        return '<tr>' +
          '<td style="' + td + ';white-space:nowrap">' + esc(e.week) + '</td>' +
          '<td style="' + td + ';text-align:right;color:' + plannedCol + '">' + plannedStr + '</td>' +
          '<td style="' + td + ';font-weight:600;text-align:right;color:' + col + '">' + wp + '%</td>' +
          '<td style="' + td + ';font-weight:600;color:' + varCol + ';text-align:right">' + varStr + '</td>' +
          '<td style="' + td + ';width:40%">' + pbar(wp, col) + '</td>' +
        '</tr>';
      }).join('');
      tlBody = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
        '<thead><tr>' +
          '<th style="' + th + '">Week</th>' +
          '<th style="' + th + ';text-align:right">Planned %</th>' +
          '<th style="' + th + ';text-align:right">Actual %</th>' +
          '<th style="' + th + ';text-align:right">Variance</th>' +
          '<th style="' + th + ';width:40%">Progress</th>' +
        '</tr></thead><tbody>' + tlRows + '</tbody></table></div>';
    }
    html += '<section class="wrpt-section">' +
      secHdr(14, 'Historical Data', 'Weekly progress &middot; variance &middot; WMR actual data', 'opHistorical') +
      tlBody +
    '</section>';

    // Section 15: Audit / Approvals
    var auditRows = [
      [DA, DA, DA, DA, DA],
      [DA, DA, DA, DA, DA]
    ];
    html += '<section class="wrpt-section">' +
      secHdr(15, 'Audit / Approvals', 'Governance log', 'opAudit') +
      gridTable(['Timestamp', 'User', 'Action', 'Entity', 'Note'], auditRows) +
    '</section>';

    // Footer
    html +=
      '<div class="wrpt-foot">' +
        '<div class="wrpt-foot-meta">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          '<span>End of report &mdash; ' + esc(String(wellId)) + ' &middot; Source: WMR Database</span>' +
        '</div>' +
        '<div class="wrpt-foot-actions">' +
          '<button type="button" class="wrpt-btn ghost" onclick="wellReportPrint()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Print' +
          '</button>' +
          '<button type="button" class="wrpt-btn primary" onclick="wellReportExport()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export' +
          '</button>' +
          '<button type="button" class="wrpt-btn close-bottom" onclick="wellReportClose()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Close report' +
          '</button>' +
        '</div>' +
      '</div>';

    return html;
  }

  // Expose render function for WellDetailOverlayComponent (Angular) to call.
  // The Angular component handles data fetching; this function handles HTML rendering only.
  window._wdRenderDetail = renderDetail;

  /* ── Widget DB issues (to report back to the client) ───────────────────────
   * Keyed by a stable widget id. Add one entry per widget you worked on; the
   * red (i) button + modal are wired generically off this map. Each issue is
   * field-level: { field, category, detail }. When a widget uses more than one
   * table the modal shows a tab per table; a single table shows a flat list.
   * Categories: Data Type Mismatch | No Standardization | Null Values |
   *             Primary Key | Foreign Key | Other
   */
  var WD_WIDGET_INFO = {
    opCostRevenue: {
      title: 'Cost & Revenue',
      summary: 'Programme financials (contract revenue, cost, penalty, bonus, net P&L) for the well.',
      tables: [
        {
          table: '— (no financials source table)',
          reliability: 'Low', reliabilityPct: 0,
          issues: [
            { field: 'Contract Revenue, Cost, Penalty Exposure, Bonus Earned, Net P&L', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'None of these financial figures exist in the database — every tile shows "Not in WMR". WMR holds only physical progress, no commercial data. To implement this section the client must provide a financials dataset per well (contract value, actual cost, penalty/bonus terms) so net P&L can be computed.' }
          ]
        }
      ]
    },
    opAudit: {
      title: 'Audit / Approvals',
      summary: 'Governance log (timestamp, user, action, entity, note) for the well.',
      tables: [
        {
          table: '— (no audit source table)',
          reliability: 'Low', reliabilityPct: 0,
          issues: [
            { field: 'Timestamp, User, Action, Entity, Note', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'There is no audit / approvals (governance) table in the database — the whole section is placeholder ("—"). To implement it the client must capture an audit trail with one row per event (timestamp, user, action, affected entity and a note). No WMR column carries who-changed-what or approval history.' }
          ]
        }
      ]
    },
    opAnomalies: {
      title: 'Anomalies & Alerts',
      summary: 'Issues that need attention for the well. Generated in code — there is no anomalies/alerts ' +
               'table in the database.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 15,
          issues: [
            { field: 'Date, Type, Description, Severity, Status', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'There is no anomalies / alerts table — the section is generated in code: it shows a single "Delay" row when a delay reason exists, otherwise all "—". Real anomaly tracking needs an alerts dataset (date, type, description, severity, status).' },
            { field: 'reasons_for_year_2018', category: 'Null Values',
              detail: 'The only anomaly that can ever appear is derived from this legacy-named, usually-blank delay-reason column.' }
          ]
        }
      ]
    },
    opRecommendations: {
      title: 'Recommendations',
      summary: 'Suggested next actions for the well. These are canned, code-side recommendations — not ' +
               'stored or rules-engine driven.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 20,
          issues: [
            { field: 'Recommendations', category: 'Other', type: 'Hard-coded', severity: 'High',
              detail: 'The recommendations are hard-coded text chosen by code from status/progress (e.g. "Continue current pace", "Pre-mobilise commissioning crew"); they are not stored or generated by a rules/AI engine. The "Source: WMR" tag is cosmetic. A recommendations/rules table would make these data-driven.' },
            { field: 'Effort / Impact', category: 'Other', type: 'Hard-coded',
              detail: 'The Effort and Impact pills are fixed values attached to each canned recommendation in code, not computed or stored.' }
          ]
        }
      ]
    },
    opHistorical: {
      title: 'Historical Data',
      summary: 'Weekly Planned % vs Actual % with variance for the well. Actual comes from WMR; the ' +
               'planned baseline is interpolated from SAP planned dates.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'over_all_progress_percentages (Actual %)', category: 'No Standardization', severity: 'High',
              detail: 'The "Actual %" is the single overall progress value repeated for every week (it sits flat at 49%/85%, not a true per-week cumulative), so the weekly history is not a real time series.' },
            { field: 'Variance', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'The "Variance" column is the week-over-week change in ACTUAL (this week − last week), NOT actual-vs-planned variance as the header implies — that is why it shows +0% / +36% / -36% even though a Planned % is displayed beside it.' },
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR; needs TRY_CAST AS FLOAT and blank weeks distort the series.' },
            { field: 'Week_Number', category: 'No Standardization',
              detail: 'Week labels are parsed from a mixed-format free-text column rather than a real DATE.' }
          ]
        },
        {
          table: 'dbo.SAP_DRILLING_SEQUENCE_History',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'Earl_start_date, EarliestEndDate (Planned %)', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'Planned % is a straight-line interpolation between the SAP planned start and end dates — an assumed linear curve, not a real planned S-curve. If either date is missing the whole Planned column shows "—".' },
            { field: 'Earl_start_date, EarliestEndDate', category: 'Data Type Mismatch',
              detail: 'The planned dates are NVARCHAR / inconsistently typed and must be parsed before interpolation.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'Joined to WMR by string well id with no enforced FK; a well missing here loses its planned baseline.' }
          ]
        }
      ]
    },
    opBlockers: {
      title: 'Blockers & Risks',
      summary: 'Decision-support blockers and risks for the well. This is generated in code — there is ' +
               'no risk register in the database.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 20,
          issues: [
            { field: 'Blockers / Risks', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'There is no blockers / risk-register table — the section is generated in code. When a delay exists it surfaces the single free-text delay reason; otherwise it shows "No blockers or risks recorded". Real risk tracking needs a register (item, severity, owner, status, date).' },
            { field: 'Owner', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'Owner is always "—" — there is no owner / assignee field for blockers.' },
            { field: 'reasons_for_year_2018', category: 'Null Values',
              detail: 'The only possible blocker text comes from this legacy-named, usually-blank delay-reason column.' }
          ]
        }
      ]
    },
    opLocationMapping: {
      title: 'Location & Mapping',
      summary: 'Field-visibility map and coordinates for the well. The map markers are decorative; the ' +
               'coordinate fields come from WMR.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'map markers', category: 'Other', type: 'Hard-coded', severity: 'High',
              detail: 'The map dots are decorative, hard-coded SVG positions — they do not reflect the real northing/easting. A genuine map needs lat/long (or northing/easting + a coordinate reference system) to plot the well.' },
            { field: 'locationdd', category: 'Null Values', severity: 'High',
              detail: 'Decimal Degrees is blank ("—") — no lat/long is stored, so no real coordinate can be mapped.' },
            { field: 'northing, easting', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR text; need parsing and a CRS/UTM zone to be usable for mapping.' },
            { field: 'station_name_no', category: 'Null Values',
              detail: 'Station is frequently blank ("—").' },
            { field: 'well_location, flow_linedl', category: 'Null Values',
              detail: 'Free-text identifiers that may be blank or inconsistent between rows.' }
          ]
        }
      ]
    },
    opPredictive: {
      title: 'Predictive Insights',
      summary: 'Forecast completion, current rate, delay forecast, progress and risk for the well — all ' +
               'derived in code from WMR progress/velocity, not stored predictions.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 25,
          issues: [
            { field: 'Forecast Completion', category: 'Other', type: 'Hard-coded', severity: 'High',
              detail: 'The forecast date is projected from a HARD-CODED base date (18 May 2026) plus weeks-left from velocity — it is not anchored to a real "as-of" date, so it drifts as that base date ages.' },
            { field: 'Current Rate / Velocity', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'Computed from only the last two weekly progress points; with blank/0 weeks it swings wildly (e.g. +31% / -31%) and is not a true 7-day average despite the label.' },
            { field: 'Delay Forecast', category: 'Other', type: 'Derived',
              detail: 'Labelled "vs plan" but is simply weeks-left × 7 days to reach 100% — there is no plan to compare against, so it is not a real schedule variance.' },
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Overall Progress (the basis for every forecast here) is NVARCHAR and must be TRY_CAST/normalised; blank weeks distort velocity and therefore the forecast.' },
            { field: 'Completion Risk', category: 'Other', type: 'Derived',
              detail: 'Risk is a code-side threshold on progress plus the derived delay flag, not a stored assessment.' }
          ]
        }
      ]
    },
    opNpt: {
      title: 'NPT — Non-Productive Time',
      summary: 'Non-productive-time log (date, hours, category, reason, schedule impact) for the well.',
      tables: [
        {
          table: '— (no NPT source table)',
          reliability: 'Low', reliabilityPct: 0,
          issues: [
            { field: 'Date, Hours, Category, Reason, Schedule Impact', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'There is no NPT / non-productive-time table in the database — the whole section is placeholder ("—"). To implement it the client must provide an NPT log with one row per event (date, lost hours, category, reason and schedule impact).' }
          ]
        }
      ]
    },
    opMaterials: {
      title: 'Materials & Equipment',
      summary: 'Material / equipment dependency tracking (vendor, PO status, readiness, risk) for the well.',
      tables: [
        {
          table: '— (no materials source table)',
          reliability: 'Low', reliabilityPct: 0,
          issues: [
            { field: 'Material, Category, Vendor, PO Status, Readiness, Risk', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'There is no materials / procurement table in the database — the whole section is placeholder ("—"). Implementing it needs a materials & equipment dataset (material, category, vendor, PO status, readiness and risk per item).' }
          ]
        }
      ]
    },
    opDependency: {
      title: 'Dependency / Predecessor Status',
      summary: 'Stage flow and predecessor blockers for the well. Stage progress comes from WMR, but the ' +
               'dependency relationships themselves are not stored in the database.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 35,
          issues: [
            { field: 'Stage, Activity, Predecessor', category: 'Other', type: 'Missing table', severity: 'High',
              detail: 'The 4 stages and their predecessor/blocker links (e.g. "Loc Prep", "FL Const") are hard-coded in code — there is no dependency/predecessor table. Real flow tracking needs a stored predecessor-relationship dataset.' },
            { field: 'blocked (indicator)', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'The "blocked" badge is computed from a % threshold (Flowline Construction shows blocked by "Loc Prep" only because its % is 0), not from an actual dependency status.' },
            { field: 'overall_loc._preparation_10_100, overall_const._10_100, overall_comm_progress_100', category: 'Data Type Mismatch',
              detail: 'Stage progress comes from these NVARCHAR WMR columns and needs TRY_CAST AS FLOAT.' },
            { field: 'actual_rig_on_date', category: 'Null Values',
              detail: 'The Rig On stage is 100% only if a rig-on date exists; a blank date forces it to 0% / Not Started regardless of reality.' }
          ]
        }
      ]
    },
    opTimeline: {
      title: 'Timeline & Milestones',
      summary: 'SAP drilling-sequence operations for the well (planned start/end, duration, status). ' +
               'When no SAP rows exist it falls back to WMR rig dates.',
      tables: [
        {
          table: 'dbo.SAP_DRILLING_SEQUENCE_History',
          reliability: 'Low', reliabilityPct: 50,
          issues: [
            { field: 'Opr_System_status', category: 'No Standardization', severity: 'High',
              detail: 'Status shows raw SAP codes ("MCNF PCNF REL") with no lookup/decoding — not human-readable. A status-code mapping (or decoded column) is needed.' },
            { field: 'Operation_Short + Well_ID', category: 'Primary Key', severity: 'High',
              detail: 'No unique key on (well, operation) — duplicate sequence rows appear (the same operation L128-24665 is listed twice with different end dates / durations).' },
            { field: 'Normal_duration, Norm_duratn_un', category: 'Data Type Mismatch',
              detail: 'Duration is stored as text with its unit in a separate column ("12.8" + "DAY") rather than a single numeric duration.' },
            { field: 'Earl_start_date, EarliestEndDate', category: 'Data Type Mismatch',
              detail: 'Only planned dates exist (no actuals), and their type is handled inconsistently across endpoints (read as datetime here but TRY_CAST AS DATE elsewhere) — a real DATE column is needed.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'No FK to WMR, joined by string well id; capped at TOP 200 operations.' },
            { field: 'Work_Center, Operation_Short, Activity', category: 'Null Values',
              detail: 'Free-text fields that may be blank.' }
          ]
        }
      ]
    },
    opActivityProgress: {
      title: 'Activity-Level Progress',
      summary: 'Per-activity progress for the well. ActivityTaskPlan is not actually queried (see below), ' +
               'so the rows are hard-coded and only their percentages come from WMR.',
      tables: [
        {
          table: 'dbo.ActivityTaskPlan',
          reliability: 'Low', reliabilityPct: 25,
          issues: [
            { field: 'Well_ID', category: 'Other', type: 'Missing index', severity: 'High',
              detail: 'ActivityTaskPlan is NOT queried for this section — the server skips it because there is no index on Well_ID, so a per-well scan is too slow. As a result no real activities are shown. Add a Well_ID index to surface genuine activity rows.' },
            { field: '(table-level)', category: 'Primary Key', severity: 'High',
              detail: 'Without a usable per-well key/index the activity list cannot be fetched per well at all.' }
          ]
        },
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'Activity ID, Activity, Discipline', category: 'Other', type: 'Hard-coded', severity: 'High',
              detail: 'The 4 rows (F-1-101 Location Preparation, F-1-170-P Flowline Construction, F-2-5-FBC Flowline Commissioning, F-3-OHL-01 OHL Work) are hard-coded in code; only their % comes from WMR.' },
            { field: 'overall_loc._preparation_10_100, overall_const._10_100, overall_comm_progress_100, ohl_progress', category: 'Data Type Mismatch',
              detail: 'The progress values are NVARCHAR and need TRY_CAST AS FLOAT.' },
            { field: 'actual_rig_on_date (Start/End)', category: 'No Standardization', severity: 'High',
              detail: 'Start/End render a raw unformatted timestamp (e.g. "2026-05-22T00:00:00.000000+00:00") because the rig date is free text shown as-is, not a clean DATE.' },
            { field: 'Crew', category: 'Other', type: 'Missing column',
              detail: 'Crew is always "—" — WMR has no per-activity crew linkage.' }
          ]
        }
      ]
    },
    opCrewPerformance: {
      title: 'Crew Performance',
      summary: 'Per-crew task counts, completion %, hours and quantity from task_daily. Most of the ' +
               'productivity columns are empty in the source, as listed below.',
      tables: [
        {
          table: 'dbo.task_daily',
          reliability: 'Low', reliabilityPct: 30,
          issues: [
            { field: 'daily_completed', category: 'Null Values', severity: 'High',
              detail: 'Task Completion % is always 0% because daily_completed is 0/null on every row — the completion flag is not populated, so crew completion cannot be measured.' },
            { field: 'daily_actual_hours, daily_actual_quantity', category: 'Null Values', severity: 'High',
              detail: 'Always 0.0 — hours and quantity are not recorded, so the Actual Hours / Actual Qty columns are meaningless.' },
            { field: 'Discipline', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'Discipline is always "—": task_daily has no discipline field, yet the column is shown.' },
            { field: 'crew_code', category: 'No Standardization',
              detail: 'Crew identifiers are inconsistent free text ("3522-LCP-0511-111017428", "KAB_CWL0511_R1") and some rows have none, so they collapse into a single "Unknown" crew.' },
            { field: 'progress', category: 'Data Type Mismatch',
              detail: 'Progress is NVARCHAR — read via TRY_CAST(progress AS FLOAT) × 100.' },
            { field: 'well_id', category: 'Foreign Key',
              detail: 'String join with no FK to the well master; capped at TOP 60 rows.' }
          ]
        }
      ]
    },
    execWellOverview: {
      title: 'Well Overview',
      summary: 'Quick identity & current status for the well. Identity/progress fields come from WMR; ' +
               'the Function / Category / PCAP / PDO-type fields come from the SAP drilling sequence.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Medium', reliabilityPct: 55,
          issues: [
            { field: 'GREENSIDE (tag)', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'The "GREENSIDE" chip is a hard-coded constant in code, not a value from the database.' },
            { field: 'priority', category: 'Other', type: 'Derived', severity: 'Medium',
              detail: '"P3 · ACTIVE" is derived from the status class in code; there is no priority column in the source.' },
            { field: 'well_location', category: 'No Standardization',
              detail: 'Labelled "Cluster · Location" but only stores the well-location text; the real cluster lives in ProjectIDs and is not shown here.' },
            { field: 'project_id', category: 'Foreign Key',
              detail: 'Raw GUID with no enforced FK to dbo.ProjectIDs; shown as the GUID itself when not joined.' },
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Completion % is stored as NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows per well; the latest snapshot must be selected.' }
          ]
        },
        {
          table: 'dbo.SAP_DRILLING_SEQUENCE_History',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'Well_Function, Well_Category, PCAP_Category, PDO_Well_Type', category: 'No Standardization',
              detail: 'Free-text SAP classification fields, MAX-aggregated per well; values are inconsistent and frequently blank.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'Joined as pdo_well_id = Well_ID with no enforced FK; a well missing from the sequence history shows no Function/Category/PCAP/PDO type.' }
          ]
        }
      ]
    },
    execProgressSummary: {
      title: 'Progress Summary',
      summary: 'Snapshot KPI tiles (Overall Progress, Completion Risk, Data Completeness, Velocity, ' +
               'Week No.). Most of these are computed in code — the real-data gaps are below.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'Plan % (Overall Progress tile)', category: 'Other', type: 'Missing column', severity: 'High',
              detail: '"Plan 85%" simply repeats the actual % — there is no planned/target value in the source, so the plan label is not a real baseline.' },
            { field: 'Completion Risk', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'Risk is computed in code from progress thresholds + the (also derived) delay flag; there is no risk column.' },
            { field: 'Data Completeness', category: 'Other', type: 'Derived', severity: 'Medium',
              detail: '"WMR fields filled" is a count over 15 hand-picked WMR columns — a UI metric, not a stored value; it changes if the chosen field list changes.' },
            { field: 'Velocity', category: 'Other', type: 'Derived', severity: 'Medium',
              detail: 'Computed from the last two weekly points; when weeks are blank/0 it produces misleading values (e.g. -31%).' },
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Overall Progress % is NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'Week_Number', category: 'No Standardization',
              detail: 'Week No. comes from Week_Number, which is free text in mixed formats rather than a real DATE.' }
          ]
        }
      ]
    },
    execSummary: {
      title: 'Executive Summary',
      summary: 'Status, Key Issue and Recommended Action for quick decisions. None of this is stored — ' +
               'it is all generated in code from progress/status heuristics.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 30,
          issues: [
            { field: 'Status, Key Issue, Recommended Action', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'All three are generated in code from status & progress rules; there is no executive-summary, key-issue or recommendation data in the database. Curated narratives would need their own column/table.' },
            { field: 'reasons_for_year_2018', category: 'Null Values', severity: 'Medium',
              detail: 'When a delay exists the Key Issue uses this free-text reason column, which is legacy-named (per-year) and usually blank.' },
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'The generated status/action keys off progress %, which is NVARCHAR and must be cast/normalised first.' }
          ]
        }
      ]
    },
    remarksNotes: {
      title: 'Remarks & Notes',
      summary: 'WMR remark, status tiles and the 8-phase breakdown for the well. Much of this card is ' +
               'computed or hard-coded because the source columns do not exist — those gaps are listed below.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 35,
          issues: [
            { field: 'Drilling, Procurement, Mechanical, Civil', category: 'Other', type: 'Missing column', severity: 'High',
              detail: '4 of the 8 phases have NO source column — they are hard-coded null and always show "—". Only Loc Prep, Construction, Commissioning and Completion have data. The client must supply progress columns for the other 4 phases.' },
            { field: 'avg_phase', category: 'Other', type: 'Calculation', severity: 'High',
              detail: 'Avg Phase % divides the total by 8 even though 4 phases are always 0 (no data), so the average is structurally understated. It should average only the phases that actually have data.' },
            { field: 'import_source, data_source', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'Import Source ("Weekly Progress Report") and Data Source ("PDO-WellTrack") are hard-coded constants in code, not columns — they cannot reflect the real source per well.' },
            { field: 'last_sync', category: 'Other', type: 'Missing column', severity: 'Medium',
              detail: 'Last Sync shows the current browser time, not a real import/refresh timestamp from the DB. A last-updated column is needed to show genuine data freshness.' },
            { field: 'wmr_status', category: 'Other', type: 'Derived', severity: 'Medium',
              detail: 'WMR Status is derived from the status class (Open / Closed / On Hold), not read from a wmr_status column; there is no authoritative status field in the source.' },
            { field: 'digital_wmr_import_remarks', category: 'Null Values', severity: 'Medium',
              detail: 'Remark text is free-form and frequently empty (shows "No remarks recorded"); there is no structured or categorised remark.' },
            { field: 'overall_loc._preparation_10_100, overall_const._10_100, overall_comm_progress_100', category: 'No Standardization',
              detail: 'The phases that do have data mix a free-text *_status column with a separate NVARCHAR % column that can disagree (a phase can show a % yet a contradictory status).' }
          ]
        }
      ]
    },
    locationCoords: {
      title: 'Location & Coordinates',
      summary: 'Well coordinates and identifiers from the latest WMR row, with a marker meant to be ' +
               'plotted from northing/easting. The items below are what blocks a real map.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'locationdd', category: 'Other', type: 'Missing data', severity: 'High',
              detail: 'No decimal lat/long is stored (locationdd is almost always blank), so there is no real geographic point — the panel shows a synthetic grid, not a map. A true map needs lat/long.' },
            { field: 'northing, easting', category: 'No Standardization', severity: 'High',
              detail: 'No coordinate reference system / UTM zone is recorded, so northing/easting cannot be converted to lat/long to place a real marker.' },
            { field: 'northing, easting', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR text, not numeric; must be parsed before the marker can be positioned, and non-numeric values cannot be plotted.' },
            { field: 'northing, easting', category: 'Null Values',
              detail: 'Frequently blank (shown as —); without both values the coordinate cannot be mapped.' },
            { field: 'project_id', category: 'Foreign Key',
              detail: 'Stored as a raw GUID with no enforced FK to dbo.ProjectIDs; a readable project/cluster name requires a join, and an unmatched id shows only the GUID.' },
            { field: 'well_location', category: 'Null Values',
              detail: 'Free-text location label with no controlled values; may be blank or inconsistent between rows.' }
          ]
        }
      ]
    },
    infrastructureDetails: {
      title: 'Infrastructure Details',
      summary: 'Flowline, rig, cluster and readiness details for the well. Reads mostly from WMR, ' +
               'with the cluster name derived from a join to ProjectIDs.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'infra_ready', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'infra_ready does NOT exist in WMR — the flag is hard-coded to false in code, so the widget always shows "Not Ready". A real infrastructure-readiness column is required.' },
            { field: 'conn_type', category: 'Other', type: 'Missing column', severity: 'High',
              detail: '"Connection Type" is labelled conn_type but there is no conn_type column in WMR; the value is actually taken from well_type as a proxy. A dedicated conn_type column is needed.' },
            { field: 'flow_line_const._status, flow_line_commi._status', category: 'No Standardization', severity: 'High',
              detail: 'Status is free text with no controlled vocabulary and the column names embed a literal "."; it also often contradicts the matching % column (e.g. 100% but "Not Started", 0% but "In Progress").' },
            { field: 'overall_const._10_100, overall_comm_progress_100', category: 'Data Type Mismatch',
              detail: 'The FL Construction / Commissioning percentages are NVARCHAR and need TRY_CAST AS FLOAT.' },
            { field: 'flow_linedl', category: 'Null Values',
              detail: 'Flowline identifier is free text and often blank.' },
            { field: 'station_name_no', category: 'Null Values',
              detail: 'Connected Trunk is frequently blank (shown as —).' }
          ]
        },
        {
          table: 'dbo.ProjectIDs',
          reliability: 'Low', reliabilityPct: 50,
          issues: [
            { field: 'ID, column2', category: 'Foreign Key',
              detail: 'Cluster (POD/FOG) comes from joining WMR.project_id = ProjectIDs.ID; there is no enforced FK, so an unmatched project_id yields no cluster.' },
            { field: 'column2', category: 'No Standardization', severity: 'High',
              detail: 'The cluster name is buried in a generic free-text column ("column2") and extracted by taking the text before the first space (LEFT(column2, CHARINDEX(\' \' ...))). A dedicated, normalised cluster column is needed.' }
          ]
        }
      ]
    },
    historicalPlanning: {
      title: 'Historical & Planning',
      summary: 'Year classification, week, rig dates, delay flag and reasons for the well — all from ' +
               'the latest WMR row. Several of these fields are missing or non-standard in the source.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 50,
          issues: [
            { field: 'delay_flag', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'is_delayed has no backing delay_flag column — it is computed in code from SAP planned dates vs progress. A real, authoritative delay flag (or an agreed threshold) from the client would make this reliable.' },
            { field: 'actual_rig_on_date, actual_rig_off_date', category: 'Data Type Mismatch', severity: 'High',
              detail: 'Rig Start / End are stored as NVARCHAR free text (e.g. "22-May-2026"), not DATE; they must be parsed and the formats are inconsistent.' },
            { field: 'actual_rig_off_date', category: 'Null Values',
              detail: 'Rig End is frequently blank (shown as —).' },
            { field: 'well_year_white_space', category: 'No Standardization',
              detail: 'The Year Classification column name literally contains "white_space" (non-standard) and the value is often blank (shown as —).' },
            { field: 'reasons_for_year_2018', category: 'No Standardization',
              detail: 'The delay-reason column is named for a specific year (reasons_for_year_2018) — a legacy/hard-coded name that will not generalise to other years.' },
            { field: 'buffer_status / completion_category', category: 'No Standardization',
              detail: 'Shown under two different names and holds free-text values with no controlled set.' },
            { field: 'Week_Number', category: 'No Standardization',
              detail: 'Same mixed-format issue as elsewhere — not a real DATE, and multiple formats appear in one column.' }
          ]
        }
      ]
    },
    weekTimeline: {
      title: 'Week-wise Progress Timeline',
      summary: 'Actual weekly progress for the well (one point per WMR row, x-axis = Week_Number) ' +
               'plotted against a Target line. Resolving the items below is what is needed to ' +
               'implement this widget correctly.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'Target / planned progress', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'There is NO planned/target progress in the source data — the dashed "Target" line is a synthetic linear 0→100 ramp generated in code, not a real plan. To show a genuine target the client must supply a planned weekly progress baseline (S-curve / planned % per week).' },
            { field: 'over_all_progress_percentages', category: 'Null Values', severity: 'High',
              detail: 'Weeks with a blank/missing progress entry cast to 0, so the line drops to 0% on those weeks (the repeated dips in the chart) instead of holding the previous value. Every week needs a value, or a flag to tell "0%" apart from "not reported".' },
            { field: 'Week_Number', category: 'Data Type Mismatch',
              detail: 'The x-axis is built from Week_Number, which is NVARCHAR free text rather than a DATE; it needs a custom 4-way parser just to place each point. A real week-ending DATE column would remove this entirely.' },
            { field: 'Week_Number', category: 'No Standardization',
              detail: 'The same column holds multiple formats — "2026-02-05", "26-04-06" and "W15". "W##" values carry no real date, so they cannot be ordered chronologically and are plotted in arrival order. One consistent date format is required.' },
            { field: 'Week_Number', category: 'Null Values',
              detail: 'Blank/garbled weeks cannot be placed; ordering then falls back to a synthetic DATEADD(WEEK, n, "2020-01-01"), which can mis-sequence the line.' },
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'The Actual-line value is stored as NVARCHAR and needs TRY_CAST AS FLOAT; it also mixes 0–1 fractions with 0–100 percentages and must be normalised.' },
            { field: 'pdo_well_id + Week_Number', category: 'Primary Key',
              detail: 'No uniqueness on well + week — duplicate WMR rows for the same week produce duplicate points on the timeline. A unique (well, week) key is needed.' }
          ]
        }
      ]
    },
    operationalStatus: {
      title: 'Operational Status',
      summary: 'Overall ring plus the phase rows and pipeline stepper (Location Prep, Flowline ' +
               'Construction, Flowline Commissioning, Overall Commissioning) for the well — each read ' +
               'directly from the latest WMR row.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Medium', reliabilityPct: 60,
          issues: [
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Drives the overall ring, the "Overall Commissioning" row and the final stepper node; stored as NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'overall_loc._preparation_10_100', category: 'Data Type Mismatch',
              detail: 'Location Preparation %; stored as NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'overall_const._10_100', category: 'Data Type Mismatch',
              detail: 'Flowline Construction %; stored as NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'overall_comm_progress_100', category: 'Data Type Mismatch',
              detail: 'Flowline / Overall Commissioning %; stored as NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'overall_loc._preparation_10_100, overall_const._10_100, overall_comm_progress_100', category: 'No Standardization',
              detail: 'Column names embed a literal "." and the values mix 0–1 fractions with 0–100 percentages, so each must be normalised before the ring / bars / stepper are correct.' },
            { field: 'all four progress columns', category: 'Null Values',
              detail: 'A blank value casts to 0, so the phase shows 0% / "—" and the stepper marks the step "not started" rather than "no data reported".' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows per well; the latest snapshot must be selected for the displayed values.' }
          ]
        }
      ]
    },
    activityGantt: {
      title: 'Activity Gantt',
      summary: 'Activity / WBS schedule for the well — plan vs actual bars per activity and milestone. ' +
               'Served from an in-memory stages cache warmed at startup, with a direct query on ' +
               'ActivityTaskPlan as the fallback.',
      tables: [
        {
          table: 'dbo.ActivityTaskPlan',
          reliability: 'Medium', reliabilityPct: 65,
          issues: [
            { field: 'progress', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR (may include a "%" sign) instead of a numeric column; must be parsed before use.' },
            { field: 'progress', category: 'No Standardization',
              detail: 'Mixes 0–1 fractions and 0–100 values across rows; needs normalising (≤1 → ×100) to render a correct %.' },
            { field: 'target_start, target_end, actual_start, actual_end', category: 'Null Values',
              detail: 'Missing dates are stored as a 1901-01-01 sentinel instead of NULL, so the sentinel must be filtered out or bars render at the epoch.' },
            { field: 'Well_ID', category: 'Data Type Mismatch',
              detail: 'Matched as a string; a format mismatch returns no rows and the gantt renders empty. A consistent typed key is needed.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'No enforced FK to the well master — orphan rows or id mismatches silently drop activities.' },
            { field: 'type', category: 'No Standardization',
              detail: 'Free-text row type ("A" activity / "M" milestone / "T" excluded) drives ordering and shape; a mistyped value is dropped or mis-placed.' },
            { field: '(table-level)', category: 'Primary Key',
              detail: 'No primary key; the query relies on TOP 500 + Well_ID filter, so wells with more than 500 rows are silently truncated.' }
          ]
        }
      ]
    },
    workProgress: {
      title: 'Job Progress',
      summary: 'Average activity progress (%) per workgroup for the well. Built by self-joining ' +
               'WMR_TaskPlan_csv_imported — workgroup rows (type "W") to their child activity rows ' +
               '(type "A") — then averaging each group’s activity progress.',
      tables: [
        {
          table: 'AppMasterDB.dbo.WMR_TaskPlan_csv_imported',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'parent_WBS, text', category: 'Foreign Key',
              detail: 'Workgroup↔activity link is a text match (act.parent_WBS = wg.text) — there is no real foreign key, so renamed, duplicated or whitespace-different text breaks the join or double-counts.' },
            { field: 'type', category: 'No Standardization',
              detail: 'A single table is split into workgroups vs activities only by a "W"/"A" type string; there is no structural separation between the two.' },
            { field: 'progress, weightage, manhoursactual, manhourforacst', category: 'Data Type Mismatch',
              detail: 'All numeric values are stored as NVARCHAR and need TRY_CONVERT to decimal; invalid values become NULL and drop out of the average.' },
            { field: 'target_start, target_end, actual_start, actual_end', category: 'Data Type Mismatch',
              detail: 'Dates are stored as text and need TRY_CONVERT(DATE, ...); a mistyped date mislabels a bar’s status colour.' },
            { field: 'New_Well_ID', category: 'Data Type Mismatch',
              detail: 'Joined as a string; an id-format mismatch drops a workgroup’s activities and understates its progress.' },
            { field: 'activities (child rows)', category: 'Null Values',
              detail: 'A workgroup with no matching activities yields NULL activity columns and shows 0% even when work simply is not logged yet.' },
            { field: '(table-level)', category: 'Primary Key',
              detail: 'No primary key or index on the join columns — this is effectively a full-table self-scan, guarded by a 30s timeout.' }
          ]
        }
      ]
    },
    kpiOverallProgress: {
      title: 'Overall Progress',
      summary: 'Overall % progress for the well, read straight from the latest WMR row ' +
               '(over_all_progress_percentages).',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Medium', reliabilityPct: 75,
          issues: [
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR, not numeric — needs TRY_CAST AS FLOAT. Should be a numeric column.' },
            { field: 'over_all_progress_percentages', category: 'No Standardization',
              detail: 'Stored as a 0–1 fraction on some rows and 0–100 on others; must be normalised before display.' },
            { field: 'over_all_progress_percentages', category: 'Null Values',
              detail: 'Blank / non-numeric values cast to 0, which reads as "0% progress" rather than "no data".' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows exist per well, so the latest snapshot must be selected each time.' }
          ]
        }
      ]
    },
    kpiCommProgress: {
      title: 'Overall Comm. Progress',
      summary: 'Commissioning progress %, read from the latest WMR row (overall_comm_progress_100).',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Medium', reliabilityPct: 65,
          issues: [
            { field: 'overall_comm_progress_100', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR; needs TRY_CAST AS FLOAT. Should be numeric.' },
            { field: 'overall_comm_progress_100', category: 'No Standardization',
              detail: 'The _100 suffix implies a 0–100 scale, but some rows hold 0–1 fractions; values must be normalised.' },
            { field: 'overall_comm_progress_100', category: 'Null Values',
              detail: 'Often back-filled late or left blank, so the tile reads 0 even when work is well advanced.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows per well; the latest snapshot must be picked each time.' }
          ]
        }
      ]
    },
    kpiFlowlineReadiness: {
      title: 'Flowline Readiness',
      summary: 'Derived metric — the average of flowline construction (fl_const) and flowline ' +
               'commissioning (fl_commi) from the latest WMR row.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 55,
          issues: [
            { field: 'overall_const._10_100, overall_comm_progress_100', category: 'Data Type Mismatch',
              detail: 'Both stored as NVARCHAR; need TRY_CAST AS FLOAT before they can be averaged into a readiness %.' },
            { field: 'overall_const._10_100, overall_comm_progress_100', category: 'No Standardization',
              detail: 'Column names embed a literal "." (e.g. overall_const._10_100) and are not validated to share the same 0–100 scale, which skews the average.' },
            { field: 'overall_const._10_100, overall_comm_progress_100', category: 'Null Values',
              detail: 'Either field being blank casts to 0 and silently halves the readiness instead of being excluded from the average.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows per well; the latest snapshot must be selected.' }
          ]
        }
      ]
    },
    kpiInfraCompletion: {
      title: 'Infra Completion',
      summary: 'Derived metric — the average of location preparation (loc_prep) and flowline ' +
               'construction (fl_const) from the latest WMR row.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Low', reliabilityPct: 50,
          issues: [
            { field: 'overall_loc._preparation_10_100, overall_const._10_100', category: 'Data Type Mismatch',
              detail: 'Both stored as NVARCHAR; need TRY_CAST AS FLOAT before averaging.' },
            { field: 'overall_loc._preparation_10_100', category: 'Null Values',
              detail: 'Frequently empty for older wells; the UI then infers 100% when the well is completed, mixing real and inferred values.' },
            { field: 'overall_loc._preparation_10_100, overall_const._10_100', category: 'No Standardization',
              detail: 'Column names embed a literal "." and the two columns are not validated to share the same scale before averaging.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows per well; the latest snapshot must be selected.' }
          ]
        }
      ]
    },
    kpiCompletionRisk: {
      title: 'Completion Risk',
      summary: 'Compares planned progress (from the SAP drilling sequence dates) against actual ' +
               'progress (WMR). The planned-vs-actual gap drives the Low / Medium / High rating.',
      tables: [
        {
          table: 'dbo.WMR',
          reliability: 'Medium', reliabilityPct: 70,
          issues: [
            { field: 'over_all_progress_percentages', category: 'Data Type Mismatch',
              detail: 'Supplies the "actual" side of the risk; stored as NVARCHAR and needs TRY_CAST AS FLOAT.' },
            { field: 'over_all_progress_percentages', category: 'No Standardization',
              detail: 'Fraction-vs-percentage inconsistency must be normalised, otherwise the gap vs planned is wrong by 100×.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No primary key — multiple rows per well; the latest snapshot must be selected.' }
          ]
        },
        {
          table: 'dbo.SAP_DRILLING_SEQUENCE_History',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'Earl_start_date, EarliestEndDate', category: 'Data Type Mismatch',
              detail: 'Planned dates are stored as NVARCHAR and read via TRY_CAST AS DATE (aggregated MIN/MAX per well); invalid strings become NULL and the planned baseline is lost.' },
            { field: 'Earl_start_date, EarliestEndDate', category: 'Null Values',
              detail: 'Supply the planned % baseline. When a well has no scheduled dates, planned % falls back to 0 and the risk reads artificially negative.' },
            { field: 'Earl_start_date, EarliestEndDate', category: 'No Standardization',
              detail: 'Free-text and frequently revised between SAP imports, so planned % — and the risk rating — can jump between page loads even though actual progress is unchanged.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'No enforced key shared with WMR (join is pdo_well_id = Well_ID); an id mismatch — or a well missing from the sequence history — silently drops the planned baseline.' }
          ]
        }
      ]
    }
  };

  /* ── DB-issues drawer (right-side slide-in) ────────────────────────────────
   * Shared by every widget. Data is field-level { field, category, detail };
   * the Type label, Severity and per-table Reliability are derived from the
   * category here (each can be overridden per issue/table). Used by both the
   * vanilla-JS well-detail widgets and the Angular pages (via wdWidgetInfoShowData).
   */
  var _wdDqInfo = null;            // info currently shown (for Export CSV)

  // Map a category to the short Type-column label + severity chip.
  function wdIssueType(i) {
    if (i.type) return i.type;
    switch (i.category) {
      case 'Data Type Mismatch': return 'Data type';
      case 'No Standardization': return 'Standardisation';
      case 'Null Values':        return 'Null / malformed';
      case 'Primary Key':        return 'PK missing';
      case 'Foreign Key':        return 'FK missing';
      default:                   return 'Consistency';
    }
  }
  function wdIssueSeverity(i) {
    if (i.severity) return i.severity;
    switch (i.category) {
      case 'Data Type Mismatch':
      case 'Foreign Key':        return 'High';
      case 'No Standardization':
      case 'Primary Key':
      case 'Null Values':        return 'Medium';
      default:                   return 'Low';
    }
  }
  function wdSevStyle(s) {
    if (s === 'High')   return 'background:#fee2e2;color:#b91c1c';
    if (s === 'Medium') return 'background:#fef3c7;color:#b45309';
    return 'background:#eef2f7;color:#475569';
  }
  // Per-table reliability: explicit if provided, else derived from issue severities.
  function wdTableReliability(t) {
    if (t.reliability && typeof t.reliabilityPct === 'number') {
      return { label: t.reliability, pct: t.reliabilityPct };
    }
    var penalty = 0;
    t.issues.forEach(function(i) {
      var s = wdIssueSeverity(i);
      penalty += (s === 'High') ? 18 : (s === 'Medium') ? 10 : 4;
    });
    var pct = Math.max(0, 100 - penalty);
    var label = pct >= 75 ? 'High' : pct >= 50 ? 'Medium' : 'Low';
    return { label: label, pct: pct };
  }
  // Component-level reliability: the average of every referenced table's
  // reliability %. With a single table it is just that table's score.
  function wdOverallReliability(info) {
    var tables = (info && info.tables) || [];
    if (!tables.length) return { label: 'Low', pct: 0 };
    var sum = 0;
    tables.forEach(function(t) { sum += wdTableReliability(t).pct; });
    var pct = Math.round(sum / tables.length);
    var label = pct >= 75 ? 'High' : pct >= 50 ? 'Medium' : 'Low';
    return { label: label, pct: pct };
  }
  function wdRelStyle(label) {
    if (label === 'High')   return 'background:#dcfce7;color:#15803d';
    if (label === 'Medium') return 'background:#fef3c7;color:#b45309';
    return 'background:#fee2e2;color:#b91c1c';
  }
  // Reliability-score pill that replaces the old plain "i" button. Shows the
  // widget's overall reliability % (average across its tables), coloured by
  // band, and opens the same right-side DB-integration drawer on click.
  // Falls back to a red info dot when the widget has no entry in WD_WIDGET_INFO.
  function wdRelBadge(infoId, extraStyle) {
    if (!infoId) return '';
    extraStyle = extraStyle || '';
    var ico = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    var info = WD_WIDGET_INFO[infoId];
    if (!info) {
      return '<button type="button" title="DB integration & reliability info" aria-label="DB integration & reliability info" onclick="wdWidgetInfoShow(\'' + infoId + '\')" style="border:none;background:transparent;color:#ef4444;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;' + extraStyle + '">' + ico + '</button>';
    }
    var rel = wdOverallReliability(info);
    return '<button type="button" title="Data reliability: ' + rel.label + ' · ' + rel.pct + '% — click for DB integration details" aria-label="Data reliability ' + rel.label + ' ' + rel.pct + ' percent. Click for details." onclick="wdWidgetInfoShow(\'' + infoId + '\')" style="display:inline-flex;align-items:center;border:none;border-radius:999px;cursor:pointer;font-size:10px;font-weight:700;line-height:1;padding:3px 8px;white-space:nowrap;' + wdRelStyle(rel.label) + ';' + extraStyle + '">' + rel.pct + '%</button>';
  }
  function wdEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // One table panel: reliability badge + issue grid.
  function wdTablePanelHtml(t, idx) {
    var rel = wdTableReliability(t);
    var rows = t.issues.map(function(i, r) {
      var sev = wdIssueSeverity(i);
      var bg = (r % 2 === 1) ? 'background:#f8fafc;' : '';
      return '<tr style="' + bg + '">' +
        '<td style="padding:9px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:700;color:#0f172a;word-break:break-word">' + wdEsc(i.field) + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #eef2f7;vertical-align:top;font-size:12px;line-height:1.5;color:#334155">' + wdEsc(i.detail) + '</td>' +
        '<td style="padding:9px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;font-size:11px;color:#475569">' + wdEsc(wdIssueType(i)) + '</td>' +
        '<td style="padding:9px 10px;border-bottom:1px solid #eef2f7;vertical-align:top"><span style="font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap;' + wdSevStyle(sev) + '">' + sev + '</span></td>' +
      '</tr>';
    }).join('');

    return '<div class="wd-wii-panel" data-idx="' + idx + '"' + (idx === 0 ? '' : ' style="display:none"') + '>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:6px 0 4px">' +
        '<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;font-weight:700;color:#1a1a2e">' + wdEsc(t.table) + '</span>' +
        '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;' + wdRelStyle(rel.label) + '">Reliability: ' + rel.label + ' · ' + rel.pct + '%</span>' +
      '</div>' +
      '<div style="height:1px;background:#e5e7eb;margin:8px 0 12px"></div>' +
      '<div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:10px">' +
        '<table style="border-collapse:collapse;width:100%;min-width:540px;table-layout:fixed">' +
          '<colgroup>' +
            '<col style="width:21%">' +
            '<col style="width:51%">' +
            '<col style="width:15%">' +
            '<col style="width:13%">' +
          '</colgroup>' +
          '<thead><tr style="background:#1f3551;color:#fff">' +
            '<th style="text-align:left;padding:9px 10px;font-size:10.5px;letter-spacing:0.04em;text-transform:uppercase">Field(s)</th>' +
            '<th style="text-align:left;padding:9px 12px;font-size:10.5px;letter-spacing:0.04em;text-transform:uppercase">Issue / Validation Concern</th>' +
            '<th style="text-align:left;padding:9px 10px;font-size:10.5px;letter-spacing:0.04em;text-transform:uppercase">Type</th>' +
            '<th style="text-align:left;padding:9px 10px;font-size:10.5px;letter-spacing:0.04em;text-transform:uppercase">Severity</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  function wdWidgetInfoHtml(info) {
    var multi = info.tables.length > 1;
    var overall = wdOverallReliability(info);

    var tabs = multi
      ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;border-bottom:1px solid #e5e7eb">' +
          info.tables.map(function(t, i) {
            return '<button type="button" class="wd-wii-tab" data-idx="' + i + '" onclick="wdWidgetInfoTab(' + i + ')" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;font-weight:600;padding:8px 12px;border:none;border-bottom:2px solid ' + (i === 0 ? '#29378d' : 'transparent') + ';background:transparent;color:' + (i === 0 ? '#29378d' : '#64748b') + ';cursor:pointer;margin-bottom:-1px">' + wdEsc(t.table) + '</button>';
          }).join('') +
        '</div>'
      : '';

    var panels = info.tables.map(function(t, i) { return wdTablePanelHtml(t, i); }).join('');

    // Drawer panel (slides in from the right). Starts off-screen; animated in after mount.
    return '<div id="wdDqPanel" onclick="event.stopPropagation()" role="dialog" aria-modal="true" ' +
      'style="position:fixed;top:0;right:0;height:100%;width:560px;max-width:94vw;background:#fff;color:#1a1a2e;' +
      'box-shadow:-12px 0 40px rgba(0,0,0,0.25);display:flex;flex-direction:column;' +
      'transform:translateX(100%);transition:transform 0.28s ease">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 22px;border-bottom:1px solid #e5e7eb">' +
        '<div>' +
          '<div style="font-size:18px;font-weight:700">' + wdEsc(info.title) + '</div>' +
          '<div style="font-size:12px;color:#64748b;margin-top:2px">DB integration notes &amp; reliability</div>' +
          '<div style="margin-top:8px"><span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;' + wdRelStyle(overall.label) + '">Overall reliability: ' + overall.label + ' · ' + overall.pct + '%' + (multi ? ' (avg of ' + info.tables.length + ' tables)' : '') + '</span></div>' +
        '</div>' +
        '<button type="button" title="Close" aria-label="Close" onclick="wdWidgetInfoClose()" style="width:30px;height:30px;flex-shrink:0;border-radius:50%;background:#f1f5f9;border:none;color:#475569;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div style="padding:18px 22px;overflow-y:auto;flex:1">' +
        '<p style="font-size:13px;line-height:1.5;color:#475569;margin:0 0 16px">' + wdEsc(info.summary) + '</p>' +
        tabs +
        panels +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid #e5e7eb">' +
        '<button type="button" onclick="wdWidgetInfoExportCsv()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#1f3551;font-size:13px;font-weight:600;cursor:pointer">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export CSV</button>' +
        '<button type="button" onclick="wdWidgetInfoClose()" style="padding:8px 18px;border-radius:8px;border:none;background:#1f3551;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Close</button>' +
      '</div>' +
    '</div>';
  }

  // Tab switch inside the open drawer (multi-table widgets).
  window.wdWidgetInfoTab = function(idx) {
    var root = document.getElementById('wdWidgetInfoOverlay');
    if (!root) return;
    var panels = root.querySelectorAll('.wd-wii-panel');
    for (var i = 0; i < panels.length; i++) {
      panels[i].style.display = (parseInt(panels[i].getAttribute('data-idx'), 10) === idx) ? '' : 'none';
    }
    var tabs = root.querySelectorAll('.wd-wii-tab');
    for (var j = 0; j < tabs.length; j++) {
      var on = parseInt(tabs[j].getAttribute('data-idx'), 10) === idx;
      tabs[j].style.color = on ? '#29378d' : '#64748b';
      tabs[j].style.borderBottomColor = on ? '#29378d' : 'transparent';
    }
  };

  // Export the open widget's issues (all tables) as a CSV file.
  window.wdWidgetInfoExportCsv = function() {
    var info = _wdDqInfo;
    if (!info) return;
    var q = function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [['Widget', 'Table', 'Reliability', 'Reliability %', 'Field(s)', 'Issue / Validation Concern', 'Type', 'Severity'].map(q).join(',')];
    info.tables.forEach(function(t) {
      var rel = wdTableReliability(t);
      t.issues.forEach(function(i) {
        lines.push([info.title, t.table, rel.label, rel.pct, i.field, i.detail, wdIssueType(i), wdIssueSeverity(i)].map(q).join(','));
      });
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'db-issues-' + String(info.title).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  };

  // Open the drawer for a registered widget id (vanilla-JS widgets).
  window.wdWidgetInfoShow = function(id) {
    var info = WD_WIDGET_INFO[id];
    if (info) window.wdWidgetInfoShowData(info);
  };

  // Open the drawer directly from a data object (used by Angular pages).
  window.wdWidgetInfoShowData = function(info) {
    if (!info || !info.tables) return;
    window.wdWidgetInfoClose();
    _wdDqInfo = info;
    var ov = document.createElement('div');
    ov.id = 'wdWidgetInfoOverlay';
    ov.setAttribute('style', 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;opacity:0;transition:opacity 0.28s ease');
    ov.onclick = window.wdWidgetInfoClose;
    ov.innerHTML = wdWidgetInfoHtml(info);
    document.body.appendChild(ov);
    // Animate in on the next frame (fade overlay + slide panel).
    requestAnimationFrame(function() {
      ov.style.opacity = '1';
      var panel = document.getElementById('wdDqPanel');
      if (panel) panel.style.transform = 'translateX(0)';
    });
  };

  window.wdWidgetInfoClose = function() {
    var ov = document.getElementById('wdWidgetInfoOverlay');
    if (!ov) return;
    var panel = document.getElementById('wdDqPanel');
    ov.style.opacity = '0';
    if (panel) panel.style.transform = 'translateX(100%)';
    _wdDqInfo = null;
    setTimeout(function() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }, 280);
  };

  function install() {
    // NOTE: window.awShowDetail is now managed by WellDetailOverlayComponent (Angular).
    // This install() only sets up wellReportShow (the Well Report modal).

    // ── Well Report override — render real WMR data directly ─────────
    window.wellReportShow = function(wellId) {
      var live = (window._wdLiveCache || {})[String(wellId)];

      var openReport = function(d, rd) {
        var ov      = document.getElementById('wrptOverlay'); if (!ov) return;
        var titleEl = document.getElementById('wrptTitle');
        var subEl   = document.getElementById('wrptSub');
        var body    = document.getElementById('wrptBody');  if (!body) return;

        var pct = Math.round(d.overallProgressPct || 0);
        var statusLabel = ({ completed:'Completed', inprogress:'In Progress', critical:'Critical',
                             onhold:'On Hold', planned:'Planned' })[d.status] || (d.status || 'Unknown');

        if (titleEl) titleEl.textContent = 'Well Report \u2014 ' + wellId;
        if (subEl)   subEl.textContent   = (d.wellLocation || d.stationName || d.projectId || '') +
                                           ' \u00b7 ' + statusLabel + ' \u00b7 ' + pct + '%';

        body.innerHTML = buildWrptBodyHtml(wellId, d, rd || null);

        ov.classList.remove('fullscreen');
        ov.classList.add('open');
        ov.scrollTop = 0;
        if (typeof window._wrptUpdateExpandIcon === 'function') window._wrptUpdateExpandIcon(false);
      };

      // Show overlay with spinner immediately
      var ov      = document.getElementById('wrptOverlay');
      var body    = document.getElementById('wrptBody');
      var titleEl = document.getElementById('wrptTitle');
      var subEl   = document.getElementById('wrptSub');
      if (ov && body) {
        if (titleEl) titleEl.textContent = 'Well Report \u2014 ' + wellId;
        if (subEl)   subEl.textContent   = 'Loading\u2026';
        body.innerHTML = '<div style="padding:80px 32px;text-align:center;color:#64748b;font-size:10pt">Loading well report data\u2026</div>';
        ov.classList.add('open');
        ov.scrollTop = 0;
      }

      // Always fetch both: WMR detail + supplementary report data in parallel
      var fetchWmr  = live
        ? Promise.resolve(live)
        : fetch('/api/v1/wells/dashboard/wells/' + encodeURIComponent(wellId))
            .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

      var fetchRd = fetch('/api/v1/wells/wells/' + encodeURIComponent(wellId) + '/report-data')
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function() { return null; }); // graceful fallback if API is down

      Promise.all([fetchWmr, fetchRd])
        .then(function(results) {
          var d  = results[0];
          var rd = results[1];
          window._wdLiveCache = window._wdLiveCache || {};
          window._wdLiveCache[String(wellId)] = d;
          window._wdRdCache = window._wdRdCache || {};
          window._wdRdCache[String(wellId)] = rd;
          openReport(d, rd);
        })
        .catch(function(err) {
          console.warn('[well-detail-live] wellReportShow fetch failed for', wellId, err);
          if (body) body.innerHTML = '<div style="padding:48px;text-align:center;color:#ef4444">Failed to load report data. Please try again.</div>';
        });
    };
    // window.awShowDetail is now managed by WellDetailOverlayComponent (Angular).
  }

  // Always install wellReportShow
  install();
})();

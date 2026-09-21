// RunSafe Rochester: heatmap + safety card drawn on top of Google Maps.
// Google Maps has no overlay API for extensions, so we read the map's center and zoom from the page URL
// (https://www.google.com/maps/@lat,lng,ZOOMz) and project incidents onto a canvas ourselves.
(function () {
  'use strict';
  if (window.__runsafeLoaded) return;
  window.__runsafeLoaded = true;

  const S = RunSafe.score;
  const F = RunSafe.format;
  const RADIUS_M = 200;
  const COVERAGE = { south: 43.1074, west: -77.7026, north: 43.2669, east: -77.5354 };
  const inCoverage = (lat, lng) => lat >= COVERAGE.south && lat <= COVERAGE.north && lng >= COVERAGE.west && lng <= COVERAGE.east;
  const PREF_KEY = 'runsafe.prefs.v1';
  const DEFAULT_PREFS = { days: 90, group: 'violent', tod: 'any', heat: true, collapsed: false, hidden: false };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS),
    all: null,
    status: 'loading', // loading | ready | error
    error: '',
    filtered: [],
    scoreIdx: null,
    ref: [],
    view: null,
    route: null, // { key, status, coords, analysis, error }
    lastHref: '',
    interacting: false,
    pendingSettle: null,
    inset: 0,
    selected: null, // incident chosen by clicking a dot or a list row
    listOpen: { area: false, route: false },
    byId: new Map(),
    histIdx: null, // last 365 days with the current type/time filters, for "last reported" lines
  };

  // ---------- storage ----------
  function loadPrefs() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(PREF_KEY, (v) => {
          if (v && v[PREF_KEY]) Object.assign(state.prefs, v[PREF_KEY]);
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }
  function savePrefs() {
    try { chrome.storage.local.set({ [PREF_KEY]: state.prefs }); } catch (e) { /* ignore */ }
  }

  // ---------- URL parsing ----------
  function parseView(href) {
    const m = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), z: parseFloat(m[3]) };
  }

  // Waypoints of a directions URL, as [lng, lat] pairs.
  function parseWaypoints(href) {
    if (!/\/maps\/dir\//.test(href)) return [];
    const decoded = decodeURIComponent(href);
    const pts = [];
    const re = /!2m2!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(decoded))) pts.push([parseFloat(m[1]), parseFloat(m[2])]);
    if (pts.length >= 2) return pts;
    const after = decoded.split('/maps/dir/')[1] || '';
    const segs = after.split('/').filter((s) => s && !s.startsWith('@') && !s.startsWith('data='));
    const coords = segs.map((s) => s.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/)).filter(Boolean);
    if (coords.length >= 2 && coords.length === segs.length) return coords.map((c) => [parseFloat(c[2]), parseFloat(c[1])]);
    return [];
  }

  // ---------- projection ----------
  function project(lat, lng, z) {
    const scale = 256 * Math.pow(2, z);
    const sin = Math.sin((lat * Math.PI) / 180);
    return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
  }
  function makeProjector(view, w, h) {
    const c = project(view.lat, view.lng, view.z);
    return (lat, lng) => {
      const p = project(lat, lng, view.z);
      return { x: w / 2 + (p.x - c.x), y: h / 2 + (p.y - c.y) };
    };
  }
  const metersPerPx = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.id = 'runsafe-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      canvas { position: fixed; left: 0; top: 0; pointer-events: none; }
      #heat { opacity: .62; transition: opacity .15s; }
      #marks { transition: opacity .15s; }
      .hide { opacity: 0 !important; }
      .card { position: fixed; right: 12px; top: 76px; width: 292px; pointer-events: auto; background: #fff; color: #202124;
        font: 13px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,.3); overflow: hidden; }
      .head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #1f5eff; color: #fff; cursor: pointer; user-select: none; }
      .head b { font-size: 14px; flex: 1; }
      .head span { font-size: 12px; opacity: .85; }
      .body { padding: 10px 12px 12px; }
      .row { display: flex; gap: 6px; margin-bottom: 8px; }
      .row label { flex: 1; font-size: 11px; color: #5f6368; display: flex; flex-direction: column; gap: 2px; }
      select { font: inherit; padding: 4px 2px; border: 1px solid #dadce0; border-radius: 6px; background: #fff; color: #202124; }
      .check { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 8px; }
      .box { border: 1px solid #e3e5e8; border-radius: 8px; padding: 8px 10px; margin-top: 8px; }
      .box h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #5f6368; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; color: #fff; font-weight: 600; font-size: 12px; }
      .muted { color: #5f6368; font-size: 12px; }
      ul { margin: 4px 0 0; padding-left: 16px; }
      li { margin: 1px 0; }
      .note { margin-top: 8px; font-size: 10.5px; color: #80868b; line-height: 1.35; }
      button { font: inherit; border: 1px solid #dadce0; background: #fff; border-radius: 6px; padding: 3px 8px; cursor: pointer; color: #1f5eff; }
      .link { border: 0; background: none; padding: 0; color: #1f5eff; font-size: 12px; text-decoration: underline; margin-left: auto; }
      a { color: #1f5eff; }
      .last { margin-top: 4px; font-weight: 600; }
      .rows { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
      .rows button { display: flex; gap: 6px; text-align: left; width: 100%; color: #202124; font-size: 12px; padding: 4px 6px; }
      .rows button:hover { background: #f1f3f4; }
      .rows button.on { border-color: #1f5eff; background: #eef3ff; }
      .rows .k { font-weight: 600; white-space: nowrap; }
      .rows .s { color: #5f6368; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sel { border-color: #1f5eff; background: #f5f8ff; }
      .sel h4 { display: flex; align-items: center; justify-content: space-between; }
      .x { border: 0; background: none; color: #5f6368; padding: 0 2px; font-size: 14px; line-height: 1; }
      .legend { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #5f6368; margin-top: 4px; }
      .bar { flex: 1; height: 6px; border-radius: 3px; background: linear-gradient(90deg, #7fd36b, #f5d63d, #f28a30, #d12b2b); }
    </style>
    <canvas id="heat"></canvas>
    <canvas id="marks"></canvas>
    <div class="card" id="card"></div>`;
  document.documentElement.appendChild(host);

  const heatCanvas = shadow.getElementById('heat');
  const marksCanvas = shadow.getElementById('marks');
  const card = shadow.getElementById('card');

  // ---------- heat rendering ----------
  const PALETTE = (function () {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, 'rgba(127,211,107,0)');
    grad.addColorStop(0.15, 'rgba(127,211,107,0.9)');
    grad.addColorStop(0.4, 'rgba(245,214,61,1)');
    grad.addColorStop(0.7, 'rgba(242,138,48,1)');
    grad.addColorStop(1.0, 'rgba(209,43,43,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1, 256);
    return g.getImageData(0, 0, 1, 256).data;
  })();

  function sprite(radius) {
    const c = document.createElement('canvas');
    c.width = c.height = radius * 2;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, radius * 2, radius * 2);
    return c;
  }

  function sizeCanvases() {
    const w = window.innerWidth, h = window.innerHeight;
    heatCanvas.width = w; heatCanvas.height = h;
    heatCanvas.style.width = w + 'px'; heatCanvas.style.height = h + 'px';
    const dpr = window.devicePixelRatio || 1;
    marksCanvas.width = w * dpr; marksCanvas.height = h * dpr;
    marksCanvas.style.width = w + 'px'; marksCanvas.style.height = h + 'px';
    return { w, h, dpr };
  }

  function drawHeat(project, view, w, h) {
    // We read the pixels back on every redraw, so tell Chrome to keep this canvas readable (avoids a console warning).
    const g = heatCanvas.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, w, h);
    if (!state.prefs.heat || !state.filtered.length) return;
    const radius = Math.max(10, Math.min(48, Math.round(300 / metersPerPx(view.lat, view.z))));
    const sp = sprite(radius);
    for (const it of state.filtered) {
      const p = project(it.lat, it.lng);
      if (p.x < -radius || p.y < -radius || p.x > w + radius || p.y > h + radius) continue;
      g.globalAlpha = Math.min(0.9, 0.06 + it.w * 0.035);
      g.drawImage(sp, p.x - radius, p.y - radius);
    }
    g.globalAlpha = 1;
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      if (!a) continue;
      const k = a * 4;
      d[i - 3] = PALETTE[k];
      d[i - 2] = PALETTE[k + 1];
      d[i - 1] = PALETTE[k + 2];
      d[i] = PALETTE[k + 3];
    }
    g.putImageData(img, 0, 0);
  }

  function drawMarks(project, view, w, h, dpr) {
    const g = marksCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // Route colored by nearby incident density.
    const r = state.route;
    if (r && r.status === 'ready' && r.analysis) {
      const coords = r.coords;
      const samples = r.analysis.samples;
      const pts = coords.map((c) => project(c[1], c[0]));
      let cum = 0;
      const segs = [];
      for (let i = 1; i < coords.length; i++) {
        cum += S.meters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        const idx = Math.min(samples.length - 1, Math.floor(cum / 100));
        segs.push({ a: pts[i - 1], b: pts[i], color: S.level(samples[idx].pct).color });
      }
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = '#fff'; g.lineWidth = 9;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      g.lineWidth = 5;
      for (const s of segs) {
        g.strokeStyle = s.color;
        g.beginPath(); g.moveTo(s.a.x, s.a.y); g.lineTo(s.b.x, s.b.y); g.stroke();
      }
    }

    // Individual incidents once zoomed in.
    if (state.prefs.heat && view.z >= 16) {
      for (const it of state.filtered) {
        const p = project(it.lat, it.lng);
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
        g.beginPath();
        g.arc(p.x, p.y, it.w >= 6 ? 5 : 3.5, 0, Math.PI * 2);
        g.fillStyle = it.w >= 6 ? 'rgba(201,48,44,.9)' : 'rgba(232,119,46,.85)';
        g.fill();
        g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
      }
    }

    // Ring around the incident picked in the card.
    if (state.selected) {
      const p = project(state.selected.lat, state.selected.lng);
      if (p.x > 0 && p.y > 0 && p.x < w && p.y < h) {
        g.beginPath(); g.arc(p.x, p.y, 13, 0, Math.PI * 2);
        g.lineWidth = 6; g.strokeStyle = '#fff'; g.stroke();
        g.lineWidth = 3; g.strokeStyle = '#1f5eff'; g.stroke();
      }
    }

    // Ring showing the area behind the card's numbers.
    if (view.z >= 13) {
      const rad = RADIUS_M / metersPerPx(view.lat, view.z);
      g.beginPath();
      g.arc(w / 2, h / 2, Math.max(rad, 4), 0, Math.PI * 2);
      g.setLineDash([6, 5]);
      g.lineWidth = 2; g.strokeStyle = 'rgba(31,94,255,.9)';
      g.stroke();
      g.setLineDash([]);
    }
  }

  function redraw() {
    const { w, h, dpr } = sizeCanvases();
    const view = state.view;
    if (view && state.status === 'ready' && !state.prefs.hidden) {
      const project = makeProjector(view, w, h);
      drawHeat(project, view, w, h);
      drawMarks(project, view, w, h, dpr);
    }
    heatCanvas.classList.remove('hide');
    marksCanvas.classList.remove('hide');
    renderCard();
  }

  function hideOverlay() {
    heatCanvas.classList.add('hide');
    marksCanvas.classList.add('hide');
  }

  // ---------- data pipeline ----------
  function recompute() {
    if (!state.all) return;
    const p = state.prefs;
    state.filtered = S.filterIncidents(state.all, p);
    state.scoreIdx = new S.GridIndex(state.filtered);
    state.byId = new Map(state.filtered.map((it) => [it.id, it]));
    if (state.selected && !state.byId.has(state.selected.id)) state.selected = null;
    state.histIdx = new S.GridIndex(S.filterIncidents(state.all, { days: 365, group: p.group, tod: p.tod }));
    const maskIdx = new S.GridIndex(S.filterIncidents(state.all, { days: p.days, group: 'all', tod: 'any' }));
    state.ref = S.buildReference(state.scoreIdx, maskIdx, RADIUS_M);
    analyzeRouteIfReady();
  }

  function loadData(force) {
    state.status = 'loading';
    renderCard();
    chrome.runtime.sendMessage({ type: 'incidents', force: !!force }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        state.status = 'error';
        state.error = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Could not load data';
      } else {
        state.all = res.rows;
        state.status = 'ready';
        recompute();
      }
      redraw();
    });
  }

  // ---------- route scoring ----------
  function currentWaypoints() { return parseWaypoints(location.href); }

  function analyzeRouteIfReady() {
    const r = state.route;
    if (!r || r.status !== 'ready' || !state.scoreIdx) return;
    const latlngs = r.coords.map((c) => ({ lat: c[1], lng: c[0] }));
    r.analysis = S.analyzeRoute(latlngs, state.scoreIdx, state.ref, { radiusM: RADIUS_M });
  }

  function syncRoute() {
    const wps = currentWaypoints();
    if (wps.length < 2 || wps.length > 25) { state.route = null; return; }
    const key = wps.map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');
    if (state.route && state.route.key === key) return;
    state.route = { key, status: 'loading' };
    chrome.runtime.sendMessage({ type: 'route', coords: wps }, (res) => {
      if (!state.route || state.route.key !== key) return;
      if (chrome.runtime.lastError || !res || !res.ok) {
        state.route = { key, status: 'error', error: (res && res.error) || 'Routing failed' };
      } else {
        state.route = { key, status: 'ready', coords: res.coords };
        analyzeRouteIfReady();
      }
      redraw();
    });
  }

  // ---------- card ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PERIODS = [[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']];
  const GROUPS = [['violent', 'Violent (robbery, assault)'], ['property', 'Property (theft, burglary)'], ['all', 'All reported']];
  const TODS = [['any', 'Any time'], ['day', 'Daylight (6a-6p)'], ['dark', 'After dark (6p-6a)']];
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('');

  function catList(byCat) {
    const rows = Object.keys(byCat).sort((a, b) => S.CATEGORIES[b].weight - S.CATEGORIES[a].weight)
      .map((c) => `<li>${byCat[c]} × ${esc(S.CATEGORIES[c].label)}</li>`);
    return rows.length ? `<ul>${rows.join('')}</ul>` : '';
  }
  const periodLabel = () => (PERIODS.find((p) => p[0] === state.prefs.days) || PERIODS[1])[1].toLowerCase();
  const short = (c) => ({ 1: 'Homicide', 3: 'Robbery', 4: 'Assault', 5: 'Burglary', 6: 'Larceny', 7: 'Vehicle theft' }[c] || 'Incident');

  // "Last reported: 12 days ago (Aug 15)" from the most recent incident in a list.
  function lastLine(incidents, prefix) {
    if (!incidents.length) return '';
    const latest = incidents.reduce((m, it) => (it.t > m.t ? it : m));
    return `<div class="last">${prefix} ${F.timeAgo(latest.t)} <span class="muted">(${F.fmtDate(latest.t)}, ${F.esc(short(latest.c).toLowerCase())})</span></div>`;
  }

  function incidentRows(incidents, key) {
    if (!incidents.length) return '';
    if (!state.listOpen[key]) return `<div style="margin-top:6px"><button class="link" style="margin-left:0" data-toggle="${key}">Show incidents ▾</button></div>`;
    const rows = incidents.slice().sort((a, b) => b.t - a.t).slice(0, 8).map((it) =>
      `<button data-id="${it.id}"${state.selected && state.selected.id === it.id ? ' class="on"' : ''}><span class="k">${F.esc(short(it.c))}</span><span>${F.timeAgo(it.t)}</span><span class="s">${F.esc(F.lower(it.s))}</span></button>`).join('');
    const more = incidents.length > 8 ? `<div class="muted">Showing the 8 most recent of ${incidents.length}. Open the full heatmap for all of them.</div>` : '';
    return `<div class="rows">${rows}</div>${more}<div style="margin-top:4px"><button class="link" style="margin-left:0" data-toggle="${key}">Hide incidents ▴</button></div>`;
  }

  function selectedBox() {
    const it = state.selected;
    if (!it) return '';
    return `<div class="box sel"><h4>Selected incident <button class="x" id="clearSel" title="Clear">✕</button></h4>
      <div><b>${F.esc(S.CATEGORIES[it.c].label)}</b>: ${F.esc(F.lower(it.d))}</div>
      <div class="muted">${F.fmtDateTime(it.t)} (${F.timeAgo(it.t)})</div>
      <div class="muted">${F.esc(F.lower(it.s))}${it.lt ? ' · ' + F.esc(F.lower(it.lt)) : ''}</div>
      <div style="margin-top:4px"><a href="${F.recordUrl(it.id)}" target="_blank" rel="noopener">See the raw police record ↗</a></div>
    </div>`;
  }

  function areaBox() {
    const v = state.view;
    if (!v) return `<div class="box"><h4>Map center</h4><span class="muted">Move the map to a spot in Rochester.</span></div>`;
    if (!inCoverage(v.lat, v.lng)) {
      return `<div class="box"><h4>Map center</h4><span class="muted">Outside the City of Rochester, NY. Data comes from the Rochester Police Department, so suburbs and other cities are not covered.</span></div>`;
    }
    if (v.z < 12) return `<div class="box"><h4>Map center</h4><span class="muted">Zoom in to see a rating for a specific area.</span></div>`;
    const a = S.summarizeArea(state.scoreIdx, state.ref, v.lat, v.lng, RADIUS_M);
    // Last report over the whole year, whatever period is selected, so a quiet area still shows when it last happened.
    const hist = [];
    state.histIdx.within(v.lat, v.lng, RADIUS_M, (it) => hist.push(it));
    const last = hist.length ? lastLine(hist, 'Last reported:') : '<div class="last">None reported here in the past year.</div>';
    return `<div class="box"><h4>Around the dashed circle (${RADIUS_M} m)</h4>
      <span class="badge" style="background:${a.level.color}">${a.level.label}</span>
      <span class="muted"> vs. rest of city</span>
      <div style="margin-top:4px">${a.incidents.length} reported incident${a.incidents.length === 1 ? '' : 's'}, ${periodLabel()}</div>
      ${last}
      ${catList(a.byCategory)}
      ${incidentRows(a.incidents, 'area')}
    </div>`;
  }

  function routeBox() {
    const r = state.route;
    if (!r) return '';
    if (r.status === 'loading') return `<div class="box"><h4>Route</h4><span class="muted">Scoring route...</span></div>`;
    if (r.status === 'error') return `<div class="box"><h4>Route</h4><span class="muted">${F.esc(r.error)}</span></div>`;
    if (!r.analysis) return '';
    const a = r.analysis;
    const miles = a.lengthM / 1609.34;
    const outside = r.coords.some((c) => !inCoverage(c[1], c[0]));
    return `<div class="box"><h4>Your route (${miles.toFixed(1)} mi)</h4>
      <span class="badge" style="background:${a.level.color}">${a.level.label}</span>
      <span class="muted"> vs. rest of city</span>
      <div style="margin-top:4px">${a.incidents.length} reported incident${a.incidents.length === 1 ? '' : 's'} within ${RADIUS_M} m, ${periodLabel()}</div>
      ${lastLine(a.incidents, 'Most recent along the route:')}
      ${catList(a.byCategory)}
      ${incidentRows(a.incidents, 'route')}
      ${a.hotspotM ? `<div class="muted" style="margin-top:4px">About ${a.hotspotM >= 1000 ? (a.hotspotM / 1609.34).toFixed(1) + ' mi' : a.hotspotM + ' m'} of it passes through the highest-incident 10% of the city.</div>` : ''}
      ${outside ? `<div class="muted" style="margin-top:4px">Part of this route is outside Rochester, where there is no data.</div>` : ''}
      <div class="legend"><span>fewer</span><div class="bar"></div><span>more</span></div>
      <div class="muted" style="margin-top:4px">Colored line is an approximate on-foot route between your start and end. Google's line may differ slightly.</div>
    </div>`;
  }

  function renderCard() {
    const p = state.prefs;
    card.style.display = p.hidden ? 'none' : '';
    const status = state.status === 'loading' ? 'loading data...' : state.status === 'error' ? 'data error' : `${state.filtered.length.toLocaleString()} incidents`;
    let body = '';
    if (!p.collapsed) {
      if (state.status === 'error') {
        body = `<div class="body"><div class="muted">${esc(state.error)}</div><div style="margin-top:8px"><button id="retry">Retry</button></div></div>`;
      } else {
        body = `<div class="body">
          <div class="row">
            <label>Period<select id="days">${opts(PERIODS, p.days)}</select></label>
            <label>Time of day<select id="tod">${opts(TODS, p.tod)}</select></label>
          </div>
          <div class="row"><label>Show<select id="group">${opts(GROUPS, p.group)}</select></label></div>
          <div class="check"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="heat"${p.heat ? ' checked' : ''}> Show heatmap</label><button class="link" id="open">Full heatmap and sources ↗</button></div>
          ${state.status === 'ready' ? selectedBox() + areaBox() + routeBox() : ''}
          <div class="note">Reported Part I incidents from the Rochester Police Department, preliminary and unverified. Rape is excluded from the public data. Counts reflect reports and policing, not a guarantee of safety. Trust your instincts. <a href="${F.PORTAL}" target="_blank" rel="noopener">Data source ↗</a></div>
        </div>`;
      }
    }
    card.innerHTML = `<div class="head" id="head"><b>RunSafe · Rochester</b><span>${status}</span><span>${p.collapsed ? '▸' : '▾'}</span></div>${body}`;
    bind();
  }

  function bind() {
    const $ = (id) => card.querySelector('#' + id);
    $('head').onclick = () => { state.prefs.collapsed = !state.prefs.collapsed; savePrefs(); renderCard(); };
    const retry = $('retry');
    if (retry) retry.onclick = () => loadData(true);
    const change = (id, key, parse) => {
      const el = $(id);
      if (!el) return;
      el.onchange = () => {
        state.prefs[key] = parse(el);
        savePrefs();
        recompute();
        redraw();
      };
    };
    change('days', 'days', (el) => parseInt(el.value, 10));
    change('group', 'group', (el) => el.value);
    change('tod', 'tod', (el) => el.value);
    change('heat', 'heat', (el) => el.checked);

    const open = $('open');
    if (open) open.onclick = () => chrome.runtime.sendMessage({ type: 'openHeatmap', view: state.view });
    const clear = $('clearSel');
    if (clear) clear.onclick = () => { state.selected = null; redraw(); };
    card.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = () => { state.listOpen[b.dataset.toggle] = !state.listOpen[b.dataset.toggle]; renderCard(); };
    });
    card.querySelectorAll('[data-id]').forEach((b) => {
      b.onclick = () => {
        const it = state.byId.get(Number(b.dataset.id));
        if (it) { state.selected = it; redraw(); }
      };
    });
  }

  // ---------- staying aligned with the map ----------
  // Google updates the URL only after a pan/zoom settles, so hide the overlay while the user is moving the map.
  let downAt = null;
  const inCard = (e) => e.composedPath && e.composedPath().includes(host);
  window.addEventListener('pointerdown', (e) => {
    if (inCard(e) || state.prefs.hidden) return;
    downAt = { x: e.clientX, y: e.clientY };
    state.interacting = true;
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!state.interacting || !downAt) return;
    if (Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 4) hideOverlay();
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (!state.interacting) return;
    state.interacting = false;
    const moved = downAt && Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 4;
    if (moved) settle();
  }, true);
  window.addEventListener('wheel', (e) => {
    if (inCard(e) || state.prefs.hidden) return;
    hideOverlay();
    settle();
  }, { passive: true, capture: true });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (/^(Arrow|\+|-|=|PageUp|PageDown)/.test(e.key)) { hideOverlay(); settle(); }
  }, true);
  // Clicking an incident dot (zoom 16+) selects it. Google still handles the click too; we only listen.
  window.addEventListener('click', (e) => {
    if (inCard(e) || state.prefs.hidden || state.status !== 'ready' || !state.prefs.heat) return;
    if (!state.view || state.view.z < 16 || e.clientX < state.inset) return;
    if (downAt && Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 4) return;
    const project = makeProjector(state.view, window.innerWidth, window.innerHeight);
    let best = null, bestD = 14;
    for (const it of state.filtered) {
      const p = project(it.lat, it.lng);
      const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (best) {
      state.selected = best;
      state.prefs.collapsed = false;
      redraw();
    }
  }, true);
  window.addEventListener('resize', () => redraw());

  // Google's left rail and directions/search pane sit on top of the map. Find their right edge so the overlay can stay off them.
  function leftInset() {
    const h = window.innerHeight;
    let inset = 0;
    for (let i = 0; i < 4; i++) {
      let next = inset;
      for (const el of document.elementsFromPoint(inset + 4, h / 2)) {
        if (el === host) continue;
        const r = el.getBoundingClientRect();
        if (r.left <= inset + 1 && r.height >= h * 0.85 && r.width > 40 && r.width < 800 && r.right > next) next = r.right;
      }
      if (next <= inset) break;
      inset = next;
    }
    return Math.round(inset);
  }

  function applyInset() {
    const inset = leftInset();
    if (inset === state.inset) return;
    state.inset = inset;
    const clip = 'inset(0 0 0 ' + inset + 'px)';
    heatCanvas.style.clipPath = clip;
    marksCanvas.style.clipPath = clip;
  }

  function settle() {
    state.pendingSettle = { href: location.href, until: Date.now() + 1800 };
  }

  function onUrlChange() {
    state.lastHref = location.href;
    const v = parseView(location.href);
    if (v) state.view = v;
    syncRoute();
    state.pendingSettle = null;
    redraw();
  }

  setInterval(() => {
    applyInset();
    if (location.href !== state.lastHref) onUrlChange();
    else if (state.pendingSettle && Date.now() > state.pendingSettle.until) {
      state.pendingSettle = null;
      redraw();
    }
  }, 200);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle') {
      state.prefs.hidden = !state.prefs.hidden;
      savePrefs();
      redraw();
    }
  });

  // ---------- start ----------
  loadPrefs().then(() => {
    state.lastHref = location.href;
    state.view = parseView(location.href);
    renderCard();
    loadData(false);
    syncRoute();
  });
})();

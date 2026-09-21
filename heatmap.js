// Full-page heatmap for RunSafe. Every number on the page traces back to a public police record.
// Data is fetched live for the map view and kept in memory only.
(function () {
  'use strict';

  const S = RunSafe.score;
  const F = RunSafe.format;
  const Src = RunSafe.sources;
  const A = RunSafe.adapters;
  const Live = RunSafe.live;
  const PREF_KEY = 'runsafe.prefs.v2'; // shared with the Google Maps overlay
  const GROUPS = [['violent', 'Violent (robbery, assault, homicide)'], ['property', 'Property (theft, burglary)'], ['all', 'All reported']];
  const TODS = [['any', 'Any time'], ['day', 'Daylight (6a-6p)'], ['dark', 'After dark (6p-6a)']];
  const SHORT = { 1: 'Homicide', 3: 'Robbery', 4: 'Assault', 5: 'Burglary', 6: 'Larceny', 7: 'Vehicle theft', 8: 'Assault (minor)' };
  const RED = '#c9302c', ORANGE = '#e8772e';
  const STALE_WARNING_DAYS = 7;

  const prefs = { group: 'violent', tod: 'any', heat: true, dots: true };
  const $ = (id) => document.getElementById(id);
  const esc = F.esc;
  const live = new Live.LiveSession((source, op, args) => A.run(source, op, args));

  let filtered = [];
  let map, heat, dotLayer, canvas, loadTimer, loadSeq = 0;
  let countInfo = null; // { sourceId, windowKey, count, url }

  // ---------- prefs (filter choices only) ----------
  async function loadPrefs() {
    try {
      let v;
      if (window.chrome && chrome.storage && chrome.storage.local) v = (await chrome.storage.local.get(PREF_KEY))[PREF_KEY];
      else v = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (v) Object.assign(prefs, v);
    } catch (e) { /* defaults */ }
  }
  async function savePrefs() {
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) {
        const cur = (await chrome.storage.local.get(PREF_KEY))[PREF_KEY] || {};
        await chrome.storage.local.set({ [PREF_KEY]: Object.assign(cur, prefs) });
      } else localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (e) { /* ignore */ }
  }

  // ---------- map ----------
  const centerOf = (s) => [(s.bounds.south + s.bounds.north) / 2, (s.bounds.west + s.bounds.east) / 2];

  function initMap() {
    let center = centerOf(Src.SOURCES[0]), zoom = 12;
    const m = location.hash.match(/#(-?[\d.]+),(-?[\d.]+),([\d.]+)/);
    if (m) { center = [+m[1], +m[2]]; zoom = Math.max(10, Math.round(+m[3])); }
    canvas = L.canvas({ padding: 0.5 });
    map = L.map('map', { renderer: canvas, minZoom: 9 }).setView(center, zoom);
    // OpenStreetMap tiles need no key. If they refuse to load (their usage policy can block some clients), fall back to Esri's gray map.
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
    }).addTo(map);
    let tileErrors = 0;
    osm.on('tileerror', () => {
      if (++tileErrors !== 6) return;
      map.removeLayer(osm);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors', maxNativeZoom: 16, maxZoom: 19,
      }).addTo(map);
    });
    for (const s of Src.SOURCES) {
      const b = s.bounds;
      L.rectangle([[b.south, b.west], [b.north, b.east]], { color: '#1f5eff', weight: 1, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
    }
    heat = L.heatLayer([], {
      radius: 22, blur: 18, maxZoom: 14, minOpacity: 0.35,
      gradient: { 0.2: '#7fd36b', 0.45: '#f5d63d', 0.7: '#f28a30', 1: '#d12b2b' },
    });
    dotLayer = L.layerGroup().addTo(map);
    map.on('moveend zoomend', () => { refreshDots(); scheduleLoad(); });
  }

  function popupHtml(it) {
    return `<div class="pop"><b>${esc(S.CATEGORIES[it.c].label)}</b><br>${esc(F.lower(it.d))}
      <div class="m">${F.fmtDateTime(it.t)} (${F.timeAgo(it.t)})<br>${esc(F.lower(it.s))}${it.lt ? ' · ' + esc(F.lower(it.lt)) : ''}</div>
      <div style="margin-top:6px"><a href="${esc(live.source.recordUrl(it.id))}" target="_blank" rel="noopener">Raw police record ↗</a></div></div>`;
  }

  function showIncident(it) {
    L.popup({ maxWidth: 280 }).setLatLng([it.lat, it.lng]).setContent(popupHtml(it)).openOn(map);
  }

  function refreshDots() {
    dotLayer.clearLayers();
    if (!prefs.dots || map.getZoom() < 14 || !live.source) return;
    const b = map.getBounds().pad(0.1);
    let n = 0;
    for (const it of filtered) {
      if (!b.contains([it.lat, it.lng])) continue;
      if (++n > 2000) break;
      L.circleMarker([it.lat, it.lng], {
        renderer: canvas, radius: it.w >= 6 ? 7 : 5, color: '#fff', weight: 1.5,
        fillColor: it.w >= 6 ? RED : ORANGE, fillOpacity: 0.92,
      }).on('click', () => showIncident(it)).addTo(dotLayer);
    }
  }

  // ---------- loading ----------
  function scheduleLoad() {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => load(false), 400);
  }

  async function load(force) {
    const seq = ++loadSeq;
    if (force) live.invalidate();
    const c = map.getCenter();
    const b = map.getBounds();
    const pending = live.ensure({
      lat: c.lat, lng: c.lng, group: prefs.group, tod: prefs.tod,
      bbox: { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() },
    });
    renderChips();
    const status = await pending;
    if (status === 'stale' || seq !== loadSeq) return;
    render();
    if (status === 'ready') fetchCount();
  }

  // The citywide record count for the same window, with a link that asks the data server the same question.
  async function fetchCount() {
    const src = live.source;
    if (!src || !live.window) return;
    const key = src.id + '|' + live.asOf;
    if (countInfo && countInfo.key === key) return;
    countInfo = { key, count: null };
    try {
      const r = await A.run(src, 'count', live.window);
      if (live.source && live.source.id === src.id) { countInfo = { key, count: r.count, url: r.url }; renderChips(); renderTrust(); }
    } catch (e) { countInfo = { key, count: null, failed: true }; }
  }

  // ---------- rendering ----------
  const groupLabel = () => GROUPS.find((g) => g[0] === prefs.group)[1].replace(/ \(.*/, '').toLowerCase();
  const todLabel = () => TODS.find((t) => t[0] === prefs.tod)[1].toLowerCase();

  function renderChips() {
    const chips = [];
    const src = live.source;
    if (src) chips.push(`<span class="chip">Source: <b><a href="${esc(src.portal)}" target="_blank" rel="noopener">${esc(src.agency)}</a></b></span>`);
    if (live.status === 'loading') chips.push('<span class="chip">Loading live data...</span>');
    if (live.status === 'uncovered') chips.push('<span class="chip warn">No data source for this area yet</span>');
    if (live.status === 'error') chips.push(`<span class="chip warn">Could not load data: ${esc(live.error)} <button class="linkbtn" id="retry">Retry</button></span>`);
    if (live.asOf && src) {
      const stale = live.lagDays() >= STALE_WARNING_DAYS;
      chips.push(`<span class="chip${stale ? ' warn' : ''}">Data through <b>${F.fmtDate(live.asOf)}</b>${stale ? ` (${live.lagDays()} days behind)` : ''}</span>`);
      if (countInfo && countInfo.count != null) chips.push(`<span class="chip">Records in the 30 days, whole city: <b>${countInfo.count.toLocaleString()}</b></span>`);
      if (live.truncated) chips.push('<span class="chip warn">Too many to load here. Zoom in.</span>');
      if (live.loadedAt) chips.push(`<span class="chip">Fetched ${new Date(live.loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} <button class="linkbtn" id="refresh">Refresh</button></span>`);
    }
    $('chips').innerHTML = chips.join('');
    const r = $('refresh');
    if (r) r.onclick = () => load(true);
    const t = $('retry');
    if (t) t.onclick = () => load(true);
  }

  function renderTrust() {
    const src = live.source;
    const links = [];
    if (src) {
      links.push(`<li><a href="${esc(src.portal)}" target="_blank" rel="noopener">${esc(src.agency)} open data portal ↗</a></li>`);
      links.push(`<li><a href="${esc(src.datasetPage)}" target="_blank" rel="noopener">Dataset page: ${esc(src.datasetName)} ↗</a></li>`);
      const raw = src.type === 'arcgis' ? src.dataUrl : 'https://' + src.domain + '/resource/' + src.dataset + '.json';
      links.push(`<li><a href="${esc(raw)}" target="_blank" rel="noopener">Raw data service ↗</a></li>`);
    }
    $('srcLinks').innerHTML = links.join('') || '<li class="fine">Move the map to a covered area to see its source.</li>';
    $('srcSetup').textContent = src ? (src.verified ? 'How this source was set up (which fields and offense types are used) was checked by hand.' : 'This source was set up automatically and has not been reviewed.') : '';
    $('srcNotes').innerHTML = src ? src.notes.map((n) => `<li>${esc(n)}</li>`).join('') : '';
    const cl = $('countLink');
    if (countInfo && countInfo.url) cl.href = countInfo.url;
    $('freshness').textContent = live.asOf
      ? `The newest record occurred on ${F.fmtDate(live.asOf)} (${F.timeAgo(live.asOf)}). This page shows the 30 days ending then. Agencies add records after reports are filed, so very recent incidents can be missing.`
      : '';
    $('windowNote').textContent = live.asOf ? `Showing the 30 days ending ${F.fmtDate(live.asOf)}.` : '';
  }

  function renderSummary() {
    const src = live.source;
    if (!src) {
      $('summary').textContent = live.status === 'uncovered'
        ? 'No crime data source for this area yet. Covered now: ' + Src.SOURCES.map((s) => s.name).join('; ') + '.'
        : live.status === 'error' ? '' : 'Loading...';
      $('bycat').innerHTML = ''; $('hours').innerHTML = ''; $('latest').innerHTML = '';
      return;
    }
    $('summary').textContent = `${filtered.length.toLocaleString()} reported incident${filtered.length === 1 ? '' : 's'} in view · ${groupLabel()} · ${todLabel()}`;

    const counts = {};
    for (const it of filtered) counts[it.c] = (counts[it.c] || 0) + 1;
    const max = Math.max(1, ...Object.values(counts));
    $('bycat').innerHTML = S.categoriesFor(prefs.group)
      .filter((c) => prefs.group === 'all' || S.CATEGORIES[c].group === prefs.group)
      .map((c) => `<div class="catrow"><span>${esc(S.CATEGORIES[c].label)}</span><span class="track"><span class="fill ${S.CATEGORIES[c].group === 'violent' ? 'v' : ''}" style="display:block;width:${((counts[c] || 0) / max) * 100}%"></span></span><span class="n">${counts[c] || 0}</span></div>`)
      .join('');

    // Hour-of-day chart ignores the time filter so you can see when incidents happen.
    const byHour = new Array(24).fill(0);
    for (const it of S.filterIncidents(live.rows, { group: prefs.group, tod: 'any' })) if (it.h >= 0) byHour[it.h]++;
    const hmax = Math.max(1, ...byHour);
    const label = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
    $('hours').innerHTML = byHour.map((n, h) => `<i class="${h < 6 || h >= 18 ? 'dark' : ''}" style="height:${Math.max(4, (n / hmax) * 100)}%" title="${label(h)}: ${n} incident${n === 1 ? '' : 's'}"></i>`).join('');

    const latest = filtered.slice().sort((a, b) => b.t - a.t).slice(0, 10);
    $('latest').innerHTML = latest.length ? latest.map((it, i) =>
      `<button data-i="${i}"><span class="k">${esc(SHORT[it.c])}</span><span>${F.timeAgo(it.t)}</span><span class="m">${esc(F.lower(it.s))} · ${F.fmtDateTime(it.t)}</span></button>`).join('')
      : '<span class="fine">Nothing matches these filters in view.</span>';
    $('latest').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const it = latest[Number(b.dataset.i)];
        map.setView([it.lat, it.lng], Math.max(map.getZoom(), 16));
        showIncident(it);
      };
    });
  }

  function render() {
    filtered = live.source ? S.filterIncidents(live.rows, { group: prefs.group, tod: prefs.tod }) : [];
    heat.setLatLngs(filtered.map((it) => [it.lat, it.lng, Math.min(1, it.w / 10 + 0.05)]));
    if (prefs.heat && live.source) { if (!map.hasLayer(heat)) heat.addTo(map); } else if (map.hasLayer(heat)) map.removeLayer(heat);
    $('city').value = live.source ? live.source.id : '';
    refreshDots();
    renderChips();
    renderSummary();
    renderTrust();
  }

  // ---------- CSV ----------
  function downloadCsv() {
    if (!live.source) return;
    const q = (s) => {
      let v = String(s == null ? '' : s);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // stop spreadsheets from running text as a formula
      return '"' + v.replace(/"/g, '""') + '"';
    };
    const lines = [['record_id', 'occurred_eastern_time', 'hour', 'category', 'description', 'street_or_area', 'location_type', 'latitude', 'longitude', 'raw_record_url'].join(',')];
    for (const it of filtered.slice().sort((a, b) => b.t - a.t)) {
      lines.push([q(it.id), q(F.fmtDateTime(it.t)), it.h, q(S.CATEGORIES[it.c].label), q(it.d), q(it.s), q(it.lt), it.lat, it.lng, q(live.source.recordUrl(it.id))].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${live.source.id}-${prefs.group}-${prefs.tod}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- setup ----------
  function fillSelect(id, list, cur) {
    $(id).innerHTML = list.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }

  function renderWeights() {
    $('weights').innerHTML = '<tr><th>Type</th><th>Group</th><th>Weight</th></tr>' + Object.values(S.CATEGORIES)
      .sort((a, b) => b.weight - a.weight)
      .map((c) => `<tr><td>${esc(c.label)}</td><td>${c.group}</td><td>${c.weight}</td></tr>`).join('');
  }

  async function init() {
    await loadPrefs();
    fillSelect('group', GROUPS, prefs.group);
    fillSelect('tod', TODS, prefs.tod);
    fillSelect('city', [['', 'Other area (no data yet)']].concat(Src.SOURCES.map((s) => [s.id, s.name])), '');
    $('heat').checked = prefs.heat;
    $('dots').checked = prefs.dots;
    renderWeights();
    initMap();

    const bind = (id, key, parse, reload) => {
      $(id).onchange = () => { prefs[key] = parse($(id)); savePrefs(); if (reload) load(false); else render(); };
    };
    bind('group', 'group', (el) => el.value, true);
    bind('tod', 'tod', (el) => el.value, true);
    bind('heat', 'heat', (el) => el.checked, false);
    bind('dots', 'dots', (el) => el.checked, false);
    $('city').onchange = () => {
      const s = Src.byId($('city').value);
      if (s) map.setView(centerOf(s), 12); // picking the blank entry does nothing
    };
    $('csv').onclick = downloadCsv;

    renderTrust();
    load(false);
  }

  init();
})();

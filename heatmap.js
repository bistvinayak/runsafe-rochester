// Full-page heatmap for RunSafe Rochester. Every number on the page traces back to a public RPD record.
(function () {
  'use strict';

  const S = RunSafe.score;
  const F = RunSafe.format;
  const D = RunSafe.data;
  const PREF_KEY = 'runsafe.prefs.v1'; // shared with the Google Maps overlay
  const PERIODS = [[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']];
  const GROUPS = [['violent', 'Violent (robbery, assault, homicide)'], ['property', 'Property (theft, burglary)'], ['all', 'All reported']];
  const TODS = [['any', 'Any time'], ['day', 'Daylight (6a-6p)'], ['dark', 'After dark (6p-6a)']];
  const SHORT = { 1: 'Homicide', 3: 'Robbery', 4: 'Assault', 5: 'Burglary', 6: 'Larceny', 7: 'Vehicle theft' };
  const RED = '#c9302c', ORANGE = '#e8772e';

  const prefs = { days: 90, group: 'violent', tod: 'any', heat: true, dots: true };
  const $ = (id) => document.getElementById(id);
  const esc = F.esc;

  let all = [];
  let meta = null;
  let filtered = [];
  let map, heat, dotLayer, canvas;

  // ---------- prefs ----------
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
  function initMap() {
    let center = [43.1566, -77.61], zoom = 12;
    const m = location.hash.match(/#(-?[\d.]+),(-?[\d.]+),([\d.]+)/);
    if (m && D.inCoverage(+m[1], +m[2])) { center = [+m[1], +m[2]]; zoom = Math.round(+m[3]); }
    canvas = L.canvas({ padding: 0.5 });
    map = L.map('map', { renderer: canvas, minZoom: 10 }).setView(center, zoom);
    // OpenStreetMap tiles need no key. If they refuse to load (their usage policy can block some clients), fall back to Esri's gray map.
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    let tileErrors = 0;
    osm.on('tileerror', () => {
      if (++tileErrors !== 6) return;
      map.removeLayer(osm);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors', maxNativeZoom: 16, maxZoom: 19,
      }).addTo(map);
    });
    const c = D.COVERAGE;
    L.rectangle([[c.south, c.west], [c.north, c.east]], { color: '#1f5eff', weight: 1, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
    heat = L.heatLayer([], {
      radius: 22, blur: 18, maxZoom: 14, minOpacity: 0.35,
      gradient: { 0.2: '#7fd36b', 0.45: '#f5d63d', 0.7: '#f28a30', 1: '#d12b2b' },
    });
    dotLayer = L.layerGroup().addTo(map);
    map.on('moveend zoomend', refreshDots);
  }

  function popupHtml(it) {
    return `<div class="pop"><b>${esc(S.CATEGORIES[it.c].label)}</b><br>${esc(F.lower(it.d))}
      <div class="m">${F.fmtDateTime(it.t)} (${F.timeAgo(it.t)})<br>${esc(F.lower(it.s))}${it.lt ? ' · ' + esc(F.lower(it.lt)) : ''}</div>
      <div style="margin-top:6px"><a href="${F.recordUrl(it.id)}" target="_blank" rel="noopener">Raw RPD record ↗</a></div></div>`;
  }

  function showIncident(it) {
    L.popup({ maxWidth: 280 }).setLatLng([it.lat, it.lng]).setContent(popupHtml(it)).openOn(map);
  }

  function refreshDots() {
    dotLayer.clearLayers();
    if (!prefs.dots || map.getZoom() < 14) return;
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

  // ---------- rendering ----------
  const periodLabel = () => PERIODS.find((p) => p[0] === prefs.days)[1].toLowerCase();
  const groupLabel = () => GROUPS.find((g) => g[0] === prefs.group)[1].replace(/ \(.*/, '').toLowerCase();
  const todLabel = () => TODS.find((t) => t[0] === prefs.tod)[1].toLowerCase();

  function renderChips() {
    const chips = [];
    chips.push(`<span class="chip">Source: <b><a href="${F.PORTAL}" target="_blank" rel="noopener">Rochester Police Department</a></b></span>`);
    if (meta) {
      const latest = all.reduce((m, r) => (r.t > m ? r.t : m), 0);
      chips.push(`<span class="chip">Latest incident: <b>${latest ? F.timeAgo(latest) : 'n/a'}</b></span>`);
      chips.push(`<span class="chip">Records, past year: <b>${meta.total.toLocaleString()}</b></span>`);
      const skipped = meta.total - all.length;
      if (skipped > 0) chips.push(`<span class="chip warn">${skipped} without a location are not mapped</span>`);
      chips.push(`<span class="chip">Loaded ${meta.fromCache ? 'from cache, ' : ''}${new Date(meta.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} <button class="linkbtn" id="refresh">Refresh</button></span>`);
    }
    $('chips').innerHTML = chips.join('');
    const r = $('refresh');
    if (r) r.onclick = () => load(true);
    if (meta) {
      const latest = all.reduce((m, x) => (x.t > m.t ? x : m), all[0]);
      $('freshness').textContent = latest
        ? `The newest record occurred ${F.fmtDateTime(latest.t)} Rochester time (${F.timeAgo(latest.t)}). RPD adds records after reports are filed, so very recent incidents can be missing.`
        : '';
    }
  }

  function renderSummary() {
    $('summary').textContent = `${filtered.length.toLocaleString()} reported incident${filtered.length === 1 ? '' : 's'} · ${periodLabel()} · ${groupLabel()} · ${todLabel()}`;

    const counts = {};
    for (const it of filtered) counts[it.c] = (counts[it.c] || 0) + 1;
    const max = Math.max(1, ...Object.values(counts));
    $('bycat').innerHTML = Object.keys(S.CATEGORIES)
      .filter((c) => prefs.group === 'all' || S.CATEGORIES[c].group === prefs.group)
      .map((c) => `<div class="catrow"><span>${esc(S.CATEGORIES[c].label)}</span><span class="track"><span class="fill ${S.CATEGORIES[c].group === 'violent' ? 'v' : ''}" style="display:block;width:${((counts[c] || 0) / max) * 100}%"></span></span><span class="n">${counts[c] || 0}</span></div>`)
      .join('');

    // Hour-of-day chart ignores the time filter so you can see when incidents happen.
    const byHour = new Array(24).fill(0);
    for (const it of S.filterIncidents(all, { days: prefs.days, group: prefs.group, tod: 'any' })) if (it.h >= 0) byHour[it.h]++;
    const hmax = Math.max(1, ...byHour);
    const label = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
    $('hours').innerHTML = byHour.map((n, h) => `<i class="${h < 6 || h >= 18 ? 'dark' : ''}" style="height:${Math.max(4, (n / hmax) * 100)}%" title="${label(h)}: ${n} incident${n === 1 ? '' : 's'}"></i>`).join('');

    const latest = filtered.slice().sort((a, b) => b.t - a.t).slice(0, 10);
    $('latest').innerHTML = latest.length ? latest.map((it, i) =>
      `<button data-i="${i}"><span class="k">${esc(SHORT[it.c])}</span><span>${F.timeAgo(it.t)}</span><span class="m">${esc(F.lower(it.s))} · ${F.fmtDateTime(it.t)}</span></button>`).join('')
      : '<span class="fine">Nothing matches these filters.</span>';
    $('latest').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const it = latest[Number(b.dataset.i)];
        map.setView([it.lat, it.lng], Math.max(map.getZoom(), 16));
        showIncident(it);
      };
    });
  }

  function refresh() {
    filtered = S.filterIncidents(all, prefs);
    heat.setLatLngs(filtered.map((it) => [it.lat, it.lng, Math.min(1, it.w / 10 + 0.05)]));
    if (prefs.heat) { if (!map.hasLayer(heat)) heat.addTo(map); } else if (map.hasLayer(heat)) map.removeLayer(heat);
    refreshDots();
    renderSummary();
  }

  // ---------- CSV ----------
  function downloadCsv() {
    const q = (s) => {
      let v = String(s == null ? '' : s);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // stop spreadsheets from running text as a formula
      return '"' + v.replace(/"/g, '""') + '"';
    };
    const lines = [['record_id', 'occurred_rochester_time', 'hour', 'category', 'description', 'street', 'location_type', 'latitude', 'longitude', 'raw_record_url'].join(',')];
    for (const it of filtered.slice().sort((a, b) => b.t - a.t)) {
      lines.push([it.id, q(F.fmtDateTime(it.t)), it.h, q(S.CATEGORIES[it.c].label), q(it.d), q(it.s), q(it.lt), it.lat, it.lng, q(F.recordUrl(it.id))].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rochester-incidents-${prefs.days}d-${prefs.group}-${prefs.tod}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- setup ----------
  function fillSelect(id, list, cur) {
    $(id).innerHTML = list.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('');
  }

  function renderWeights() {
    $('weights').innerHTML = '<tr><th>Type</th><th>Group</th><th>Weight</th></tr>' + Object.values(S.CATEGORIES)
      .sort((a, b) => b.weight - a.weight)
      .map((c) => `<tr><td>${esc(c.label)}</td><td>${c.group}</td><td>${c.weight}</td></tr>`).join('');
  }

  async function load(force) {
    $('chips').innerHTML = '<span class="chip">Loading data from the Rochester Police Department...</span>';
    try {
      const res = await D.loadIncidents({ force: !!force });
      all = res.rows;
      meta = res;
      renderChips();
      refresh();
    } catch (e) {
      $('chips').innerHTML = `<span class="chip warn">Could not load data: ${esc(e.message)} <button class="linkbtn" id="retry">Retry</button></span>`;
      $('retry').onclick = () => load(true);
    }
  }

  async function init() {
    await loadPrefs();
    fillSelect('days', PERIODS, prefs.days);
    fillSelect('group', GROUPS, prefs.group);
    fillSelect('tod', TODS, prefs.tod);
    $('heat').checked = prefs.heat;
    $('dots').checked = prefs.dots;
    $('countLink').href = F.countUrl(D.HISTORY_DAYS);
    renderWeights();
    initMap();

    const bind = (id, key, parse) => {
      $(id).onchange = () => { prefs[key] = parse($(id)); savePrefs(); if (meta) refresh(); };
    };
    bind('days', 'days', (el) => parseInt(el.value, 10));
    bind('group', 'group', (el) => el.value);
    bind('tod', 'tod', (el) => el.value);
    bind('heat', 'heat', (el) => el.checked);
    bind('dots', 'dots', (el) => el.checked);
    $('csv').onclick = downloadCsv;

    load(false);
  }

  init();
})();

// Fetches Part I crime incidents from the Rochester Police Department's public ArcGIS layer.
(function (root) {
  'use strict';

  const LAYER = 'https://maps.cityofrochester.gov/arcgis/rest/services/RPD/RPD_Part_I_Crime/FeatureServer/3';
  const FIELDS = [
    'OBJECTID', 'OccurredFrom_Timestamp', 'OccurredFrom_Time', 'Statute_CrimeCategory',
    'Statute_Description', 'Location_Type', 'Geocode_Street',
  ].join(',');
  const CACHE_KEY = 'runsafe.roc.incidents.v3';
  const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  const PAGE = 2000;
  const HISTORY_DAYS = 365;

  // City of Rochester, NY (from the RPD dataset extent). Outside this box there is no data.
  const COVERAGE = { south: 43.1074, west: -77.7026, north: 43.2669, east: -77.5354 };

  async function readCache() {
    try {
      let v;
      if (root.chrome && chrome.storage && chrome.storage.local) {
        v = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
      } else {
        const raw = root.localStorage.getItem(CACHE_KEY);
        v = raw ? JSON.parse(raw) : null;
      }
      if (v && Date.now() - v.savedAt < CACHE_TTL_MS && Array.isArray(v.rows)) return v;
    } catch (e) { /* cache is optional */ }
    return null;
  }

  async function writeCache(rows, total) {
    const v = { savedAt: Date.now(), rows, total };
    try {
      if (root.chrome && chrome.storage && chrome.storage.local) await chrome.storage.local.set({ [CACHE_KEY]: v });
      else root.localStorage.setItem(CACHE_KEY, JSON.stringify(v));
    } catch (e) { /* cache is optional */ }
  }

  function parseHour(s) {
    if (!s) return -1;
    const h = parseInt(String(s).padStart(4, '0').slice(0, 2), 10);
    return h >= 0 && h < 24 ? h : -1;
  }

  // RPD masks some fields as "***". Treat those as missing rather than showing asterisks.
  const clean = (v) => {
    const s = (v || '').trim();
    return /^[*\s]*$/.test(s) ? '' : s;
  };

  function toRow(f) {
    const a = f.attributes;
    const g = f.geometry;
    if (!g || !isFinite(g.x) || !isFinite(g.y)) return null;
    return {
      id: a.OBJECTID,
      t: a.OccurredFrom_Timestamp, // epoch ms (UTC); h below is the local hour from RPD's own time field
      h: parseHour(a.OccurredFrom_Time),
      c: a.Statute_CrimeCategory,
      d: clean(a.Statute_Description),
      lt: clean(a.Location_Type),
      s: clean(a.Geocode_Street),
      lat: g.y,
      lng: g.x,
    };
  }

  async function fetchPage(offset) {
    const params = new URLSearchParams({
      where: 'OccurredFrom_Timestamp > CURRENT_TIMESTAMP - ' + HISTORY_DAYS,
      outFields: FIELDS,
      outSR: '4326',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: 'json',
    });
    const res = await fetch(LAYER + '/query?' + params.toString());
    if (!res.ok) throw new Error('RPD data request failed (' + res.status + ')');
    const json = await res.json();
    if (json.error) throw new Error('RPD data error: ' + (json.error.message || json.error.code));
    return json;
  }

  // Returns { rows, total, savedAt, fromCache }. `total` counts every record RPD returned, including any without coordinates.
  async function loadIncidents(opts) {
    if (!(opts && opts.force)) {
      const cached = await readCache();
      if (cached) return { rows: cached.rows, total: cached.total || cached.rows.length, savedAt: cached.savedAt, fromCache: true };
    }
    const rows = [];
    let total = 0;
    let offset = 0;
    for (;;) {
      const json = await fetchPage(offset);
      total += (json.features || []).length;
      for (const f of json.features || []) {
        const r = toRow(f);
        if (r) rows.push(r);
      }
      if (!json.exceededTransferLimit || !(json.features || []).length) break;
      offset += json.features.length;
    }
    await writeCache(rows, total);
    return { rows, total, savedAt: Date.now(), fromCache: false };
  }

  function inCoverage(lat, lng) {
    return lat >= COVERAGE.south && lat <= COVERAGE.north && lng >= COVERAGE.west && lng <= COVERAGE.east;
  }

  const api = { loadIncidents, inCoverage, COVERAGE, HISTORY_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.data = api; }
})(typeof self !== 'undefined' ? self : this);

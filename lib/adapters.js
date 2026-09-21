// Network adapters. Each data-system type (ArcGIS, Socrata) answers the same five questions for a source:
//   newest    when is the newest record?
//   window    incidents in a time window, optionally inside a map box
//   reference incident counts per small map cell across the whole city (for ratings)
//   last      the most recent incident near a point
//   count     how many mapped records the whole city has in the window (for the trust page)
// Nothing here stores anything. Results go back to the caller and are dropped when it is done.
(function (root) {
  'use strict';

  const S = typeof require === 'function' ? require('./score.js') : root.RunSafe.score;
  const DAY = 86400000;
  const PAGE = 5000;
  const DEFAULT_LIMIT = 25000;

  const pad = (n) => String(n).padStart(2, '0');
  const clean = (v) => {
    const s = (v || '').trim();
    return /^[*\s]*$/.test(s) || /^\(null\)$/i.test(s) ? '' : s; // agencies mask fields as "***" or write "(null)"
  };
  const parseHour = (s) => {
    if (!s) return -1;
    const h = parseInt(String(s).padStart(4, '0').slice(0, 2), 10);
    return h >= 0 && h < 24 ? h : -1;
  };

  async function getJson(url, what) {
    const res = await fetch(url, { signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined });
    if (!res.ok) throw new Error(what + ' request failed (' + res.status + ')');
    const json = await res.json();
    if (json && json.error) throw new Error(what + ' error: ' + (json.error.message || json.error.code || json.message));
    return json;
  }

  // ---------- time zones (only needed for sources that publish local date and time separately) ----------
  function tzParts(epoch, tz) {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(epoch))) p[part.type] = part.value;
    return p;
  }
  const tzOffsetMs = (epoch, tz) => {
    const p = tzParts(epoch, tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - epoch;
  };
  // Local wall-clock time in `tz` to a UTC epoch. `cache` avoids repeating the slow Intl lookups for every row.
  function zonedToEpoch(y, mo, d, h, mi, s, tz, cache) {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    const key = y + '-' + mo + '-' + d + '-' + h;
    let off = cache && cache.get(key);
    if (off === undefined) {
      off = tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
      if (cache) cache.set(key, off);
    }
    return guess - off;
  }
  const localYmd = (ms, tz) => {
    const p = tzParts(ms, tz);
    return p.year + '-' + p.month + '-' + p.day;
  };

  // ---------- ArcGIS (Rochester) ----------
  const sqlTs = (ms) => {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  };
  const arcTod = (tod) => (tod === 'day' ? " AND OccurredFrom_Time >= '0600' AND OccurredFrom_Time < '1800'"
    : tod === 'dark' ? " AND (OccurredFrom_Time < '0600' OR OccurredFrom_Time >= '1800')" : '');
  const arcWhere = (from, to, group, tod) =>
    "OccurredFrom_Timestamp >= timestamp '" + sqlTs(from) + "' AND OccurredFrom_Timestamp <= timestamp '" + sqlTs(to + 60000) +
    "' AND Statute_CrimeCategory IN (" + S.categoriesFor(group).join(',') + ')' + arcTod(tod);
  const ARC_FIELDS = 'OBJECTID,OccurredFrom_Timestamp,OccurredFrom_Time,Statute_CrimeCategory,Statute_Description,Location_Type,Geocode_Street';

  function arcRow(f) {
    const a = f.attributes;
    const g = f.geometry;
    if (!g || !isFinite(g.x) || !isFinite(g.y)) return null;
    return {
      id: String(a.OBJECTID), t: a.OccurredFrom_Timestamp, h: parseHour(a.OccurredFrom_Time), c: a.Statute_CrimeCategory,
      d: clean(a.Statute_Description), lt: clean(a.Location_Type), s: clean(a.Geocode_Street), lat: g.y, lng: g.x,
    };
  }
  const envelope = (b) => [b.west, b.south, b.east, b.north].join(',');

  const arcgis = {
    async newest(src) {
      const params = new URLSearchParams({
        where: "OccurredFrom_Timestamp <= timestamp '" + sqlTs(Date.now() + DAY) + "'",
        outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'OccurredFrom_Timestamp', outStatisticFieldName: 'm' }]),
        f: 'json',
      });
      const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
      const m = json.features && json.features[0] && json.features[0].attributes.m;
      if (!m) throw new Error('Could not read the newest record date');
      return { asOf: m };
    },

    async window(src, { bbox, from, to, group, tod, limit }) {
      limit = limit || DEFAULT_LIMIT;
      const rows = [];
      let truncated = false;
      for (let offset = 0; ;) {
        const params = new URLSearchParams({
          where: arcWhere(from, to, group, tod || 'any'), outFields: ARC_FIELDS, outSR: '4326', orderByFields: 'OBJECTID',
          resultOffset: String(offset), resultRecordCount: String(PAGE), f: 'json',
        });
        if (bbox) {
          params.set('geometry', envelope(bbox));
          params.set('geometryType', 'esriGeometryEnvelope');
          params.set('inSR', '4326');
          params.set('spatialRel', 'esriSpatialRelIntersects');
        }
        const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
        const feats = json.features || [];
        for (const f of feats) { const r = arcRow(f); if (r) rows.push(r); }
        if (!json.exceededTransferLimit || !feats.length) break;
        offset += feats.length;
        if (rows.length >= limit) { truncated = true; break; }
      }
      return { rows, truncated };
    },

    async reference(src, { from, to, group, tod }) {
      const { rows } = await arcgis.window(src, { from, to, group, tod, limit: 100000 });
      return rows.map((r) => ({ lat: r.lat, lng: r.lng, c: r.c, n: 1 }));
    },

    async last(src, { lat, lng, radiusM, group, tod, to }) {
      const params = new URLSearchParams({
        where: 'Statute_CrimeCategory IN (' + S.categoriesFor(group).join(',') + ')' + arcTod(tod || 'any') +
          " AND OccurredFrom_Timestamp <= timestamp '" + sqlTs((to || Date.now()) + 60000) + "'",
        geometry: lng + ',' + lat, geometryType: 'esriGeometryPoint', inSR: '4326', distance: String(radiusM), units: 'esriSRUnit_Meter',
        spatialRel: 'esriSpatialRelIntersects', outFields: ARC_FIELDS, outSR: '4326', orderByFields: 'OccurredFrom_Timestamp DESC',
        resultRecordCount: '1', f: 'json',
      });
      const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
      const f = json.features && json.features[0];
      return f ? arcRow(f) : null;
    },

    async count(src, { from, to }) {
      const params = new URLSearchParams({ where: arcWhere(from, to, 'all', 'any'), returnCountOnly: 'true', f: 'json' });
      const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
      return { count: json.count, url: src.dataUrl + '/query?' + params };
    },
  };

  // ---------- Socrata (New York) ----------
  const socUrl = (src, q) => 'https://' + src.domain + '/resource/' + src.dataset + '.json?' + q;
  const soql = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
  const quote = (names) => names.map((n) => "'" + n.replace(/'/g, "''") + "'").join(',');
  const socNames = (src, group) => {
    const cats = new Set(S.categoriesFor(group));
    return Object.keys(src.categoryMap).filter((n) => cats.has(src.categoryMap[n]));
  };
  const socTod = (tod) => (tod === 'day' ? " AND cmplnt_fr_tm >= '06:00:00' AND cmplnt_fr_tm < '18:00:00'"
    : tod === 'dark' ? " AND (cmplnt_fr_tm < '06:00:00' OR cmplnt_fr_tm >= '18:00:00')" : '');
  const socBox = (b) => (b ? ' AND latitude between ' + b.south + ' and ' + b.north + ' AND longitude between ' + b.west + ' and ' + b.east : '');
  // Window days are local calendar days. Starting one day after `from` gives exactly 30 days when `to` is the end of a day.
  const socWhere = (src, from, to, group, tod, bbox) =>
    "cmplnt_fr_dt >= '" + localYmd(from + DAY, src.timezone) + "T00:00:00' AND cmplnt_fr_dt <= '" + localYmd(to, src.timezone) +
    "T00:00:00' AND ofns_desc in(" + quote(socNames(src, group)) + ')' + socTod(tod) + socBox(bbox);
  const SOC_FIELDS = 'cmplnt_num,cmplnt_fr_dt,cmplnt_fr_tm,ofns_desc,pd_desc,prem_typ_desc,parks_nm,boro_nm,latitude,longitude';

  function socRow(src, r, cache) {
    const lat = parseFloat(r.latitude);
    const lng = parseFloat(r.longitude);
    const c = src.categoryMap[r.ofns_desc];
    const d = /^(\d{4})-(\d\d)-(\d\d)/.exec(r.cmplnt_fr_dt || '');
    if (!c || !d || !isFinite(lat) || !isFinite(lng)) return null;
    const tm = /^(\d\d):(\d\d)(?::(\d\d))?/.exec(r.cmplnt_fr_tm || '') || [0, '0', '0', '0'];
    const hh = (+tm[1]) % 24;
    return {
      id: String(r.cmplnt_num), t: zonedToEpoch(+d[1], +d[2], +d[3], hh, +tm[2], +(tm[3] || 0), src.timezone, cache), h: hh, c,
      d: clean(r.pd_desc) || r.ofns_desc, lt: clean(r.prem_typ_desc), s: clean(r.parks_nm) || clean(r.boro_nm), lat, lng,
    };
  }

  const socrata = {
    async newest(src) {
      const json = await getJson(socUrl(src, soql({
        $select: 'max(cmplnt_fr_dt)', $where: "cmplnt_fr_dt <= '" + localYmd(Date.now(), src.timezone) + "T00:00:00'",
      })), src.agency);
      const m = /^(\d{4})-(\d\d)-(\d\d)/.exec((json[0] && json[0].max_cmplnt_fr_dt) || '');
      if (!m) throw new Error('Could not read the newest record date');
      return { asOf: zonedToEpoch(+m[1], +m[2], +m[3], 23, 59, 0, src.timezone) }; // the data has whole days, so count the day as complete
    },

    async window(src, { bbox, from, to, group, tod, limit }) {
      limit = limit || DEFAULT_LIMIT;
      const json = await getJson(socUrl(src, soql({
        $select: SOC_FIELDS, $where: socWhere(src, from, to, group, tod || 'any', bbox), $order: 'cmplnt_fr_dt DESC', $limit: String(limit),
      })), src.agency);
      const cache = new Map();
      const rows = [];
      for (const r of json) { const row = socRow(src, r, cache); if (row) rows.push(row); }
      return { rows, truncated: json.length >= limit };
    },

    async reference(src, { from, to, group, tod }) {
      const json = await getJson(socUrl(src, soql({
        $select: 'round(latitude,3) as la, round(longitude,3) as lo, ofns_desc, count(*) as n',
        $where: socWhere(src, from, to, group, tod || 'any', null), $group: 'la,lo,ofns_desc', $limit: '50000',
      })), src.agency);
      const pts = [];
      for (const r of json) {
        const c = src.categoryMap[r.ofns_desc];
        const lat = parseFloat(r.la), lng = parseFloat(r.lo);
        if (c && isFinite(lat) && isFinite(lng)) pts.push({ lat, lng, c, n: parseInt(r.n, 10) });
      }
      return pts;
    },

    async last(src, { lat, lng, radiusM, group, tod, to }) {
      const dLat = radiusM / 111320;
      const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
      const box = { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
      const json = await getJson(socUrl(src, soql({
        $select: SOC_FIELDS,
        $where: "cmplnt_fr_dt <= '" + localYmd(to || Date.now(), src.timezone) + "T00:00:00' AND ofns_desc in(" + quote(socNames(src, group)) + ')' + socTod(tod || 'any') + socBox(box),
        $order: 'cmplnt_fr_dt DESC, cmplnt_fr_tm DESC', $limit: '100',
      })), src.agency);
      const cache = new Map();
      for (const r of json) {
        const row = socRow(src, r, cache);
        if (row && S.meters(lat, lng, row.lat, row.lng) <= radiusM) return row; // results are newest first
      }
      return null;
    },

    async count(src, { from, to }) {
      const q = soql({ $select: 'count(*)', $where: socWhere(src, from, to, 'all', 'any', null) });
      const json = await getJson(socUrl(src, q), src.agency);
      return { count: parseInt(json[0].count, 10), url: socUrl(src, q) };
    },
  };

  const TYPES = { arcgis, socrata };

  // Entry point used by the background worker and the heatmap page.
  function run(src, op, args) {
    const adapter = src && TYPES[src.type];
    if (!adapter || !adapter[op]) return Promise.reject(new Error('Unsupported source operation: ' + op));
    return adapter[op](src, args || {});
  }

  const api = { run, zonedToEpoch, localYmd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.adapters = api; }
})(typeof self !== 'undefined' ? self : this);

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
  const LOOKBACK_DAYS = 730; // "last reported" only searches this far back; older searches are slow on big datasets

  const pad = (n) => String(n).padStart(2, '0');
  const clean = (v) => {
    const s = (v || '').trim();
    return /^[*\s]*$/.test(s) || /^(\(null\)|redacted|-)$/i.test(s) ? '' : s; // agencies mask fields as "***", "(null)" or "REDACTED"
  };
  const parseHour = (s) => {
    if (!s) return -1;
    const h = parseInt(String(s).padStart(4, '0').slice(0, 2), 10);
    return h >= 0 && h < 24 ? h : -1;
  };

  // Data entry mistakes happen (a point at 0,0 or in another state). Drop anything well outside the source's own area,
  // otherwise one stray point can stretch every map calculation across the planet.
  const KEEP_PAD = 0.05;
  const keep = (src, lat, lng) => {
    const b = src.bounds;
    return !b || (lat >= b.south - KEEP_PAD && lat <= b.north + KEEP_PAD && lng >= b.west - KEEP_PAD && lng <= b.east + KEEP_PAD);
  };

  // One retry on a network failure: data servers sit behind several addresses and one can be briefly unreachable.
  async function fetchRetry(url) {
    const opts = () => ({ signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined });
    try { return await fetch(url, opts()); } catch (e) { return fetch(url, opts()); }
  }

  async function getJson(url, what) {
    const res = await fetchRetry(url);
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

  // ---------- ArcGIS (Rochester and other cities that publish ArcGIS feature layers) ----------
  // Configured per source: src.dataUrl is the layer, src.fields names the columns (fields.when is the date field, fields.timeField
  // an optional text time like '1430', fields.offense the offense column, fields.numeric true when that column is a number),
  // src.categoryMap turns offense values into our category codes, and src.whenKind says whether epoch dates are true UTC
  // ('utc') or local wall-clock time stored as if it were UTC ('wall'). Esri dates are epoch milliseconds.
  const sqlTs = (ms) => {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  };
  // In 'wall' sources the stored number already is local time, so queries use local time expressed as if it were UTC.
  const arcIn = (src, ms) => (src.whenKind === 'wall' ? ms + tzOffsetMs(ms, src.timezone) : ms);
  const arcOut = (src, ms) => (src.whenKind === 'wall' ? zonedToEpoch(...utcParts(ms), src.timezone) : ms);
  const utcParts = (ms) => { const d = new Date(ms); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]; };
  const arcQuote = (src, v) => (src.fields.numeric ? String(Number(v)) : "'" + String(v).replace(/'/g, "''") + "'");
  const arcNames = (src, group) => {
    const cats = new Set(S.categoriesFor(group));
    return Object.keys(src.categoryMap).filter((n) => cats.has(src.categoryMap[n]));
  };
  // Server-side time-of-day only when the layer has a plain text time; otherwise it is filtered after loading.
  const arcTod = (src, tod) => {
    const t = src.fields.timeField;
    if (!t || (tod !== 'day' && tod !== 'dark')) return '';
    return tod === 'day' ? ' AND ' + t + " >= '0600' AND " + t + " < '1800'" : ' AND (' + t + " < '0600' OR " + t + " >= '1800')";
  };
  const todOk = (r, tod) => tod !== 'day' && tod !== 'dark' ? true : r.h >= 0 && (tod === 'day' ? r.h >= 6 && r.h < 18 : r.h < 6 || r.h >= 18);
  const arcWhere = (src, from, to, group, tod) =>
    src.fields.when + " >= timestamp '" + sqlTs(arcIn(src, from)) + "' AND " + src.fields.when + " <= timestamp '" + sqlTs(arcIn(src, to) + 60000) +
    "' AND " + src.fields.offense + ' IN (' + arcNames(src, group).map((n) => arcQuote(src, n)).join(',') + ')' + arcTod(src, tod);
  const arcFields = (src) => {
    const f = src.fields;
    return Array.from(new Set([f.id, f.when, f.timeField, f.offense, f.detail].concat(f.place || [], f.area || []).filter(Boolean))).join(',');
  };

  function arcRow(src, f) {
    const a = f.attributes;
    const g = f.geometry;
    const fl = src.fields;
    const c = src.categoryMap[a[fl.offense]];
    if (!g || !isFinite(g.x) || !isFinite(g.y) || !c || a[fl.when] == null) return null;
    let t = a[fl.when];
    let h;
    if (fl.timeField) h = parseHour(a[fl.timeField]);
    if (src.whenKind === 'wall') { t = arcOut(src, t); if (h === undefined) h = new Date(a[fl.when]).getUTCHours(); }
    else if (h === undefined) h = +tzParts(t, src.timezone).hour % 24;
    const pick = (names) => { for (const n of [].concat(names || [])) { const v = clean(a[n]); if (v) return v; } return ''; };
    return { id: String(a[fl.id]), t, h, c, d: clean(a[fl.detail]) || String(a[fl.offense]), lt: pick(fl.place), s: pick(fl.area), lat: g.y, lng: g.x };
  }
  const envelope = (b) => [b.west, b.south, b.east, b.north].join(',');

  const arcgis = {
    async newest(src) {
      const params = new URLSearchParams({
        // Some layers contain rows dated in the future; never let them make a source look newer than it is.
        where: src.fields.when + " <= timestamp '" + sqlTs(arcIn(src, Date.now() + 3600000)) + "'",
        outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: src.fields.when, outStatisticFieldName: 'm' }]),
        f: 'json',
      });
      const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
      const m = json.features && json.features[0] && json.features[0].attributes.m;
      if (!m) throw new Error('Could not read the newest record date');
      return { asOf: arcOut(src, m) };
    },

    async window(src, { bbox, from, to, group, tod, limit }) {
      limit = limit || DEFAULT_LIMIT;
      const rows = [];
      let truncated = false;
      for (let offset = 0; ;) {
        const params = new URLSearchParams({
          where: arcWhere(src, from, to, group, tod || 'any'), outFields: arcFields(src), outSR: '4326', orderByFields: src.fields.id,
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
        for (const f of feats) { const r = arcRow(src, f); if (r && keep(src, r.lat, r.lng) && todOk(r, tod || 'any')) rows.push(r); }
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
      const end = to || Date.now();
      const params = new URLSearchParams({
        where: src.fields.offense + ' IN (' + arcNames(src, group).map((n) => arcQuote(src, n)).join(',') + ')' + arcTod(src, tod || 'any') +
          ' AND ' + src.fields.when + " <= timestamp '" + sqlTs(arcIn(src, end) + 60000) + "'" +
          ' AND ' + src.fields.when + " >= timestamp '" + sqlTs(arcIn(src, end) - LOOKBACK_DAYS * DAY) + "'",
        geometry: lng + ',' + lat, geometryType: 'esriGeometryPoint', inSR: '4326', distance: String(radiusM), units: 'esriSRUnit_Meter',
        spatialRel: 'esriSpatialRelIntersects', outFields: arcFields(src), outSR: '4326', orderByFields: src.fields.when + ' DESC',
        resultRecordCount: '50', f: 'json',
      });
      const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
      for (const f of json.features || []) {
        const r = arcRow(src, f);
        if (r && keep(src, r.lat, r.lng) && todOk(r, tod || 'any')) return r; // newest first
      }
      return null;
    },

    async count(src, { from, to }) {
      const params = new URLSearchParams({ where: arcWhere(src, from, to, 'all', 'any'), returnCountOnly: 'true', f: 'json' });
      const json = await getJson(src.dataUrl + '/query?' + params, src.agency);
      return { count: json.count, url: src.dataUrl + '/query?' + params };
    },
  };

  // ---------- Socrata (New York, Chicago, Los Angeles, ...) ----------
  // Configured per source: src.when = { field, kind: 'floating' | 'split', timeField? } says how the date is stored,
  // src.fields names the columns, and src.categoryMap turns the offense column's values into our category codes.
  const socUrl = (src, q) => 'https://' + src.domain + '/resource/' + src.dataset + '.json?' + q;
  const soql = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
  const quote = (names) => names.map((n) => "'" + String(n).replace(/'/g, "''") + "'").join(',');
  const socNames = (src, group) => {
    const cats = new Set(S.categoriesFor(group));
    return Object.keys(src.categoryMap).filter((n) => cats.has(src.categoryMap[n]));
  };
  // 'YYYY-MM-DDTHH:MM:SS' in the source's local time, the format Socrata floating timestamps compare against.
  const localTs = (ms, tz) => { const p = tzParts(ms, tz); return p.year + '-' + p.month + '-' + p.day + 'T' + pad(+p.hour % 24) + ':' + p.minute + ':' + p.second; };
  const socTod = (src, tod) => {
    if (tod !== 'day' && tod !== 'dark') return '';
    const w = src.when;
    if (w.kind === 'split') {
      return tod === 'day' ? ' AND ' + w.timeField + " >= '06:00:00' AND " + w.timeField + " < '18:00:00'"
        : ' AND (' + w.timeField + " < '06:00:00' OR " + w.timeField + " >= '18:00:00')";
    }
    const h = 'date_extract_hh(' + w.field + ')';
    return tod === 'day' ? ' AND ' + h + ' >= 6 AND ' + h + ' < 18' : ' AND (' + h + ' < 6 OR ' + h + ' >= 18)';
  };
  // Some portals store coordinates as text; `fields.cast` says to compare them as numbers. If it is a string, that text
  // marks hidden locations (for example 'REDACTED'), and those rows are excluded first because casting them would fail.
  const socGuard = (src) => (typeof src.fields.cast === 'string'
    ? ' AND ' + src.fields.lat + " != '" + src.fields.cast + "' AND " + src.fields.lon + " != '" + src.fields.cast + "'" : '');
  const num = (src, col) => src.fields[col] + (src.fields.cast ? '::number' : '');
  const socBox = (src, b) => (b ? ' AND ' + num(src, 'lat') + ' between ' + b.south + ' and ' + b.north + ' AND ' + num(src, 'lon') + ' between ' + b.west + ' and ' + b.east : '');
  // Split date+time sources hold whole local days. Starting one day after `from` gives exactly 30 days when `to` ends a day.
  const socWhen = (src, from, to) => {
    const w = src.when;
    if (w.kind === 'split') return w.field + " >= '" + localYmd(from + DAY, src.timezone) + "T00:00:00' AND " + w.field + " <= '" + localYmd(to, src.timezone) + "T00:00:00'";
    return w.field + " >= '" + localTs(from, src.timezone) + "' AND " + w.field + " <= '" + localTs(to, src.timezone) + "'";
  };
  const socWhere = (src, from, to, group, tod, bbox) =>
    socWhen(src, from, to) + ' AND ' + src.fields.offense + ' in(' + quote(socNames(src, group)) + ')' + socTod(src, tod) + socGuard(src) + socBox(src, bbox);
  const socSelect = (src) => {
    const f = src.fields;
    const list = [f.id, src.when.field, src.when.timeField, f.offense, f.detail, f.lat, f.lon].concat(f.place || [], f.area || []);
    return Array.from(new Set(list.filter(Boolean))).join(',');
  };
  const socOrder = (src) => src.when.field + ' DESC' + (src.when.kind === 'split' ? ', ' + src.when.timeField + ' DESC' : '');

  function socRow(src, r, cache) {
    const f = src.fields;
    const lat = parseFloat(r[f.lat]);
    const lng = parseFloat(r[f.lon]);
    const c = src.categoryMap[r[f.offense]];
    const w = src.when;
    const d = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?/.exec(r[w.field] || '');
    if (!c || !d || !isFinite(lat) || !isFinite(lng)) return null;
    let hh, mi, ss;
    if (w.kind === 'split') {
      const tm = /^(\d\d):(\d\d)(?::(\d\d))?/.exec(r[w.timeField] || '') || [0, '0', '0', '0'];
      hh = +tm[1]; mi = +tm[2]; ss = +(tm[3] || 0);
    } else { hh = +(d[4] || 0); mi = +(d[5] || 0); ss = +(d[6] || 0); }
    hh %= 24;
    const pick = (names) => { for (const n of [].concat(names || [])) { const v = clean(r[n]); if (v) return v; } return ''; };
    return {
      id: String(r[f.id]), t: zonedToEpoch(+d[1], +d[2], +d[3], hh, mi, ss, src.timezone, cache), h: hh, c,
      d: clean(r[f.detail]) || String(r[f.offense]), lt: pick(f.place), s: pick(f.area), lat, lng,
    };
  }

  const socrata = {
    async newest(src) {
      const w = src.when;
      const now = w.kind === 'split' ? localYmd(Date.now(), src.timezone) + 'T00:00:00' : localTs(Date.now(), src.timezone);
      const json = await getJson(socUrl(src, soql({ $select: 'max(' + w.field + ') as m', $where: w.field + " <= '" + now + "'" })), src.agency);
      const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?/.exec((json[0] && json[0].m) || '');
      if (!m) throw new Error('Could not read the newest record date');
      // Whole-day sources count the day as complete; timestamped sources use the exact moment.
      return { asOf: w.kind === 'split' ? zonedToEpoch(+m[1], +m[2], +m[3], 23, 59, 0, src.timezone) : zonedToEpoch(+m[1], +m[2], +m[3], +(m[4] || 0) % 24, +(m[5] || 0), +(m[6] || 0), src.timezone) };
    },

    async window(src, { bbox, from, to, group, tod, limit }) {
      limit = limit || DEFAULT_LIMIT;
      const json = await getJson(socUrl(src, soql({
        $select: socSelect(src), $where: socWhere(src, from, to, group, tod || 'any', bbox), $order: socOrder(src), $limit: String(limit),
      })), src.agency);
      const cache = new Map();
      const rows = [];
      for (const r of json) { const row = socRow(src, r, cache); if (row && keep(src, row.lat, row.lng)) rows.push(row); }
      return { rows, truncated: json.length >= limit };
    },

    async reference(src, { from, to, group, tod }) {
      const f = src.fields;
      const json = await getJson(socUrl(src, soql({
        $select: 'round(' + num(src, 'lat') + ',3) as la, round(' + num(src, 'lon') + ',3) as lo, ' + f.offense + ' as off, count(*) as n',
        $where: socWhere(src, from, to, group, tod || 'any', null), $group: 'la,lo,off', $limit: '50000',
      })), src.agency);
      const pts = [];
      for (const r of json) {
        const c = src.categoryMap[r.off];
        const lat = parseFloat(r.la), lng = parseFloat(r.lo);
        if (c && isFinite(lat) && isFinite(lng) && keep(src, lat, lng)) pts.push({ lat, lng, c, n: parseInt(r.n, 10) });
      }
      return pts;
    },

    async last(src, { lat, lng, radiusM, group, tod, to }) {
      const dLat = radiusM / 111320;
      const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
      const box = { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
      const w = src.when;
      const end = to || Date.now();
      const upTo = w.kind === 'split'
        ? w.field + " <= '" + localYmd(end, src.timezone) + "T00:00:00' AND " + w.field + " >= '" + localYmd(end - LOOKBACK_DAYS * DAY, src.timezone) + "T00:00:00'"
        : w.field + " <= '" + localTs(end, src.timezone) + "' AND " + w.field + " >= '" + localTs(end - LOOKBACK_DAYS * DAY, src.timezone) + "'";
      const json = await getJson(socUrl(src, soql({
        $select: socSelect(src),
        $where: upTo + ' AND ' + src.fields.offense + ' in(' + quote(socNames(src, group)) + ')' + socTod(src, tod || 'any') + socGuard(src) + socBox(src, box),
        $order: socOrder(src), $limit: '100',
      })), src.agency);
      const cache = new Map();
      for (const r of json) {
        const row = socRow(src, r, cache);
        if (row && keep(src, row.lat, row.lng) && S.meters(lat, lng, row.lat, row.lng) <= radiusM) return row; // results are newest first
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

// Turn an ArcGIS layer spec into a validated source config (the ArcGIS counterpart of build-city.js).
//   node tools/build-arcgis.js philadelphia-pa
// It reads the offense values in use, maps them to our categories, finds the city's bounds from the data, works out whether
// the layer's dates are true UTC or local wall-clock time, then checks the finished config against the live server.
const fs = require('fs');
const path = require('path');
const A = require('../lib/adapters.js');
const S = require('../lib/score.js');
const specs = require('./specs-arcgis.js');

// Standard NIBRS offense codes -> our categories. Anything not listed is left out.
const NIBRS = { '09A': 1, '120': 3, '13A': 4, '13B': 8, '220': 5, '23A': 6, '23B': 6, '23C': 6, '23D': 6, '23E': 6, '23F': 6, '23G': 6, '23H': 6, '240': 7 };
const RULES = [
  [1, /\b(MURDER|HOMICIDE|MANSLAUGHTER)\b/i], [3, /\bROBBERY\b/i],
  [4, /(AGG(RAVATED)?[ .-]*(ASSAULT|BATTERY)|FELONY ASSAULT|ASSAULT.*(DEADLY|WEAPON|FIREARM|GUN|KNIFE)|SHOOTING)/i],
  [8, /\b(SIMPLE )?(ASSAULT|BATTERY)\b/i], [5, /\b(BURGLARY|BREAKING)\b/i],
  [7, /(MOTOR VEHICLE THEFT|AUTO(MOBILE)? THEFT|VEHICLE THEFT|STOLEN VEHICLE|THEFT OF (A )?VEHICLE|VEHICLE - STOLEN|GRAND THEFT AUTO)/i],
  [6, /(LARCENY|THEFT|SHOPLIFT|POCKET|PURSE)/i],
];
const EXCLUDE = /(SEX|RAPE|PORN|CHILD|PROSTITUT|OBSCEN|DRUG|NARCOTIC|WEAPON LAW|WEAPONS VIOLATION|TRESPASS|FRAUD|FORGERY|COUNTERFEIT|VANDAL|MISCHIEF|ARSON)/i;

const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(90000) }); if (!r.ok) throw new Error(r.status); const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j; };
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))];
const sqlTs = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

(async () => {
  const spec = specs.find((s) => s.id === process.argv[2]);
  if (!spec) throw new Error('unknown spec; known: ' + specs.map((s) => s.id).join(', '));
  const f = spec.config.fields;
  const url = spec.dataUrl;
  const now = Date.now();
  const sane = `${f.when} <= timestamp '${sqlTs(now)}'`; // some layers hold junk future dates
  const recent = `${f.when} > timestamp '${sqlTs(now - 365 * 864e5)}' AND ${sane}`;

  // 1. offense values in the last year and how we map them
  const q = new URLSearchParams({ where: recent, groupByFieldsForStatistics: f.offense, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: f.id, outStatisticFieldName: 'n' }]), f: 'json' });
  const rows = (await get(url + '/query?' + q)).features.map((x) => x.attributes).sort((a, b) => b.n - a.n);
  const map = {}, table = [];
  for (const r of rows) {
    const v = r[f.offense];
    if (v == null) continue;
    const key = String(v).trim();
    let code = null;
    if (spec.explicit && Object.prototype.hasOwnProperty.call(spec.explicit, key)) code = spec.explicit[key];
    else if (spec.nibris) code = NIBRS[key] || null;
    else if (!spec.noRules && !EXCLUDE.test(key)) for (const [c, re] of RULES) if (re.test(key)) { code = c; break; }
    if (code) map[v] = code;
    table.push([r.n, String(v), code || '-']);
  }
  const total = table.reduce((s, t) => s + t[0], 0);
  const mapped = table.filter((t) => t[2] !== '-').reduce((s, t) => s + t[0], 0);
  console.log(`\n== ${spec.id}: ${table.length} offense values in the last year, ${total} rows; ${((mapped / total) * 100).toFixed(0)}% mapped`);
  console.log('MAPPED:');
  for (const t of table.filter((x) => x[2] !== '-')) console.log('  ', String(t[0]).padStart(7), S.CATEGORIES[t[2]].label.padEnd(30), t[1]);
  console.log('LEFT OUT (top 14):');
  for (const t of table.filter((x) => x[2] === '-').slice(0, 14)) console.log('  ', String(t[0]).padStart(7), t[1]);

  // 2. bounds from a sample of points (up to 8 pages)
  const page = spec.pageSize || 1000;
  const lats = [], lons = [];
  for (let p = 0; p < 8; p++) {
    const j = await get(url + '/query?' + new URLSearchParams({ where: recent, outFields: f.id, returnGeometry: 'true', outSR: '4326', orderByFields: f.id, resultOffset: String(p * page), resultRecordCount: String(page), f: 'json' }));
    for (const ft of j.features || []) if (ft.geometry && isFinite(ft.geometry.x) && ft.geometry.y > 15 && ft.geometry.y < 60 && ft.geometry.x < -60 && ft.geometry.x > -170) { lats.push(ft.geometry.y); lons.push(ft.geometry.x); }
    if (!j.exceededTransferLimit) break;
  }
  lats.sort((a, b) => a - b); lons.sort((a, b) => a - b);
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const bounds = { south: r4(pct(lats, 0.003) - 0.01), west: r4(pct(lons, 0.003) - 0.01), north: r4(pct(lats, 0.997) + 0.01), east: r4(pct(lons, 0.997) + 0.01) };
  console.log('bounds from', lats.length, 'points:', JSON.stringify(bounds));

  // 3. are dates true UTC, or local wall-clock time stored as UTC? Compare hour-of-day shapes.
  const tz = spec.config.timezone;
  let whenKind = spec.whenKind || 'utc';
  if (!f.timeField && !spec.whenKind) {
    const j = await get(url + '/query?' + new URLSearchParams({ where: `${f.when} > timestamp '${sqlTs(now - 60 * 864e5)}' AND ${sane}`, outFields: f.when, returnGeometry: 'false', resultRecordCount: String(page), orderByFields: f.id, f: 'json' }));
    const shape = (fn) => { const h = new Array(24).fill(0); for (const ft of j.features) { const v = ft.attributes[f.when]; if (v) h[fn(v)]++; } const night = h.slice(2, 6).reduce((a, b) => a + b, 0), eve = h.slice(17, 22).reduce((a, b) => a + b, 0); return { h, ratio: night / Math.max(1, eve) }; };
    const utc = shape((v) => +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).format(new Date(v)) % 24);
    const wall = shape((v) => new Date(v).getUTCHours());
    whenKind = wall.ratio < utc.ratio ? 'wall' : 'utc';
    console.log(`date style: true-UTC night/evening ${utc.ratio.toFixed(2)} vs wall-clock ${wall.ratio.toFixed(2)} -> ${whenKind}`);
  }

  // 4. finished config, checked against the live server
  const src = Object.assign({ verified: false, type: 'arcgis', bounds, categoryMap: map, whenKind, dataUrl: url, hosts: [new URL(url).origin + '/*'], notes: spec.notes || [] }, spec.config, spec.noTimeOfDay ? { timeOfDay: false } : {});
  const { asOf } = await A.run(src, 'newest');
  const lag = Math.round((now - asOf) / 864e5);
  const win = { from: asOf - 30 * 864e5, to: asOf };
  const all = await A.run(src, 'window', Object.assign({ group: 'all', bbox: bounds }, win));
  const inside = all.rows.filter((r) => r.lat >= bounds.south && r.lat <= bounds.north && r.lng >= bounds.west && r.lng <= bounds.east).length;
  const cnt = await A.run(src, 'count', win);
  const ref = await A.run(src, 'reference', Object.assign({ group: 'violent', tod: 'any' }, win));
  const dark = await A.run(src, 'window', Object.assign({ group: 'all', tod: 'dark', bbox: bounds }, win));
  const hours = new Array(24).fill(0);
  for (const r of all.rows) hours[r.h]++;
  const shares = {};
  for (const r of all.rows) shares[r.c] = (shares[r.c] || 0) + 1;
  console.log(`newest ${new Date(asOf).toISOString().slice(0, 16)}Z (${lag} days behind) | window rows ${all.rows.length}${all.truncated ? ' (TRUNCATED)' : ''} | citywide count ${cnt.count} | reference pts ${ref.length}`);
  console.log('category shares:', Object.keys(shares).map((c) => `${S.CATEGORIES[c].label}=${shares[c]}`).join(', '));
  console.log('hours:', hours.join(' '));
  const checks = {
    'fresh (<=14 days, or a known lagging source)': lag <= 14 || spec.allowLag,
    'rows inside bounds >= 99%': all.rows.length > 0 && inside / all.rows.length >= 0.99,
    'core categories all present (robbery, agg. assault, burglary, larceny, vehicle theft)': [3, 4, 5, 6, 7].every((c) => shares[c] > 0),
    'enough incidents (>= 200 citywide in 30 days)': cnt.count >= 200,
    'reference table built': ref.length >= 50,
  };
  if (!spec.noTimeOfDay) {
    checks['after-dark filter only returns dark hours'] = dark.rows.every((r) => r.h < 6 || r.h >= 18) && dark.rows.length > 0;
    checks['hours look human (night quieter than evening)'] = hours.slice(2, 6).reduce((a, b) => a + b, 0) < hours.slice(17, 22).reduce((a, b) => a + b, 0);
  } else {
    checks['dates only: every incident is at midnight, as declared'] = all.rows.every((r) => r.h === 0);
  }
  let ok = true;
  for (const [k, v] of Object.entries(checks)) { console.log(v ? '  PASS' : '  FAIL', k); ok = ok && v; }
  fs.writeFileSync(path.join(__dirname, 'out', spec.id + '.json'), JSON.stringify({ id: spec.id, ok, lag, bounds, whenKind, timeOfDay: spec.noTimeOfDay ? false : undefined, categoryMap: map }, null, 1));
  console.log(ok ? `\nOK: wrote tools/out/${spec.id}.json` : '\nNOT READY: fix the spec, then rerun');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

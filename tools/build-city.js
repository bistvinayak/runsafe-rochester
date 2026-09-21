// Turn a Socrata dataset spec into a validated source config.
//   node tools/build-city.js chicago-il
// It reads the offense values in use, maps them to our categories, finds the city's bounds from the data, then checks the
// finished config against the live server (freshness, rows inside bounds, hour-of-day shape, counts). It prints what it
// decided so a person can review the mapping before the config is trusted.
const fs = require('fs');
const path = require('path');
const A = require('../lib/adapters.js');
const S = require('../lib/score.js');
const specs = require('./specs.js');

const RULES = [ // first match wins; anything unmatched is left out of the map
  [1, /\b(MURDER|HOMICIDE|MANSLAUGHTER)\b/i],
  [3, /\bROBBERY\b/i],
  [4, /(AGG(RAVATED)?[ .-]*(ASSAULT|BATTERY)|FELONY ASSAULT|ASSAULT.*(DEADLY|WEAPON|FIREARM|GUN|KNIFE)|SHOOTING)/i],
  [8, /\b(SIMPLE )?(ASSAULT|BATTERY)\b/i],
  [5, /\b(BURGLARY|BREAKING)\b/i],
  [7, /(MOTOR VEHICLE THEFT|AUTO(MOBILE)? THEFT|VEHICLE THEFT|STOLEN VEHICLE|THEFT OF (A )?VEHICLE|VEHICLE - STOLEN)/i],
  [6, /(LARCENY|THEFT|SHOPLIFT|POCKET|PURSE)/i],
];
const EXCLUDE = /(SEX|RAPE|PORN|CHILD|PROSTITUT|OBSCEN|DRUG|NARCOTIC|WEAPON LAW|WEAPONS VIOLATION|TRESPASS|FRAUD|FORGERY|COUNTERFEIT|VANDAL|MISCHIEF|ARSON)/i;

const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(90000) }); if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); };
const q = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))];

(async () => {
  const spec = specs.find((s) => s.id === process.argv[2]);
  if (!spec) throw new Error('unknown spec; known: ' + specs.map((s) => s.id).join(', '));
  const base = `https://${spec.domain}/resource/${spec.dataset}.json?`;
  const w = spec.when;
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 19);
  const recent = `${w.field} > '${yearAgo}'`;

  // 1. offense values in the last year, and how we map them
  const rows = await get(base + q({ $select: `${spec.fields.offense} as v, count(*) as n`, $where: recent, $group: 'v', $order: 'n DESC', $limit: '500' }));
  const map = {};
  const table = [];
  for (const r of rows) {
    const v = r.v;
    if (v == null) continue;
    let code = spec.explicit && Object.prototype.hasOwnProperty.call(spec.explicit, v) ? spec.explicit[v] : null;
    if (code === null && !(spec.explicit && Object.prototype.hasOwnProperty.call(spec.explicit, v)) && !(spec.noRules)) {
      if (!EXCLUDE.test(v)) for (const [c, re] of RULES) if (re.test(v)) { code = c; break; }
    }
    if (code) map[v] = code;
    table.push([r.n, v, code || '-']);
  }
  const total = table.reduce((s, t) => s + +t[0], 0);
  const mapped = table.filter((t) => t[2] !== '-').reduce((s, t) => s + +t[0], 0);
  console.log(`\n== ${spec.id}: ${table.length} offense values in the last year, ${total} rows; ${((mapped / total) * 100).toFixed(0)}% mapped to our categories`);
  console.log('MAPPED:');
  for (const t of table.filter((x) => x[2] !== '-')) console.log('  ', String(t[0]).padStart(7), S.CATEGORIES[t[2]].label.padEnd(30), t[1]);
  console.log('LEFT OUT (top 25 by volume, review these):');
  for (const t of table.filter((x) => x[2] === '-').slice(0, 25)) console.log('  ', String(t[0]).padStart(7), t[1]);

  // 2. bounds from the data (trim the odd bad coordinate)
  const cast = spec.config.fields.cast ? '::number' : '';
  const guard = typeof spec.config.fields.cast === 'string' ? ` AND ${spec.fields.lat} != '${spec.config.fields.cast}' AND ${spec.fields.lon} != '${spec.config.fields.cast}'` : '';
  const pts = await get(base + q({ $select: `${spec.fields.lat},${spec.fields.lon}`, $where: `${recent}${guard} AND ${spec.fields.lat}${cast} between 15 and 60 AND ${spec.fields.lon}${cast} between -170 and -60`, $limit: '30000' }));
  const lats = pts.map((p) => +p[spec.fields.lat]).filter(isFinite).sort((a, b) => a - b);
  const lons = pts.map((p) => +p[spec.fields.lon]).filter(isFinite).sort((a, b) => a - b);
  const pad = 0.01;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const bounds = { south: r4(pct(lats, 0.003) - pad), west: r4(pct(lons, 0.003) - pad), north: r4(pct(lats, 0.997) + pad), east: r4(pct(lons, 0.997) + pad) };
  console.log('bounds from', lats.length, 'points:', JSON.stringify(bounds));

  // 3. finished config, checked against the live server
  const src = Object.assign({ verified: false, type: 'socrata', bounds, categoryMap: map, hosts: ['https://' + spec.domain + '/*'], notes: spec.notes || [] }, spec.config);
  src.recordUrl = function (id) { return 'https://' + this.domain + '/resource/' + this.dataset + '.json?' + this.fields.id + '=' + encodeURIComponent(id); };
  const { asOf } = await A.run(src, 'newest');
  const lag = Math.round((Date.now() - asOf) / 864e5);
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
  console.log('category shares in window:', Object.keys(shares).map((c) => `${S.CATEGORIES[c].label}=${shares[c]}`).join(', '));
  console.log('hour histogram:', hours.join(' '));
  const darkOk = dark.rows.every((r) => r.h < 6 || r.h >= 18);
  const checks = {
    'fresh (<=14 days, or a known lagging source)': lag <= 14 || spec.allowLag,
    'rows inside bounds >= 99%': all.rows.length > 0 && inside / all.rows.length >= 0.99,
    'mapped share of last year >= 60%': mapped / total >= 0.6,
    'enough incidents (>= 200 citywide in 30 days)': cnt.count >= 200,
    'reference table built': ref.length >= 50,
    'after-dark filter only returns dark hours': darkOk && dark.rows.length > 0,
    'hours look human (night quieter than evening)': hours.slice(2, 6).reduce((a, b) => a + b, 0) < hours.slice(17, 22).reduce((a, b) => a + b, 0),
  };
  let ok = true;
  for (const [k, v] of Object.entries(checks)) { console.log(v ? '  PASS' : '  FAIL', k); ok = ok && v; }

  const out = { id: spec.id, ok, lag, bounds, categoryMap: map };
  fs.writeFileSync(path.join(__dirname, 'out', spec.id + '.json'), JSON.stringify(out, null, 1));
  console.log(ok ? `\nOK: wrote tools/out/${spec.id}.json` : `\nNOT READY: fix the spec, then rerun`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

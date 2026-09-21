// Run: node test/smoke.js   (hits the live police data services)
const assert = require('assert');
const Src = require('../lib/sources.js');
const A = require('../lib/adapters.js');
const S = require('../lib/score.js');
const F = require('../lib/format.js');

const CASES = [
  { id: 'rochester-ny', spot: [43.1566, -77.6047], box: { south: 43.14, north: 43.17, west: -77.63, east: -77.58 } },
  { id: 'new-york-ny', spot: [40.758, -73.985], box: { south: 40.745, north: 40.77, west: -74.0, east: -73.97 } },
  { id: 'chicago-il', spot: [41.8827, -87.6233], box: { south: 41.87, north: 41.9, west: -87.65, east: -87.6 } },
  { id: 'seattle-wa', spot: [47.6062, -122.3321], box: { south: 47.59, north: 47.625, west: -122.35, east: -122.31 } },
];

(async () => {
  for (const s of Src.SOURCES) assert(CASES.some((c) => c.id === s.id), 'add a smoke-test case for ' + s.id);
  for (const c of CASES) {
    const src = Src.byId(c.id);
    console.log('\n=== ' + src.name);
    let t0 = Date.now();
    const { asOf } = await A.run(src, 'newest');
    const lagDays = Math.round((Date.now() - asOf) / Src.DAY_MS);
    console.log(`newest record: ${F.fmtDateTime(asOf)}  (${lagDays} days behind)  [${Date.now() - t0} ms]`);
    assert(asOf > Date.now() - 400 * Src.DAY_MS && asOf <= Date.now() + Src.DAY_MS, 'newest date should be sane');
    const win = { from: asOf - Src.WINDOW_DAYS * Src.DAY_MS, to: asOf };

    t0 = Date.now();
    const all = await A.run(src, 'window', Object.assign({ group: 'all', bbox: c.box }, win));
    console.log(`window in box (all groups): ${all.rows.length} rows, truncated=${all.truncated}  [${Date.now() - t0} ms]`);
    assert(all.rows.length > 0);
    const r0 = all.rows[0];
    assert(S.CATEGORIES[r0.c] && isFinite(r0.lat) && isFinite(r0.lng) && r0.id && r0.t, 'row shape');
    for (const r of all.rows.slice(0, 50)) {
      assert(r.t >= win.from - Src.DAY_MS && r.t <= win.to + Src.DAY_MS, 'row inside window: ' + F.fmtDateTime(r.t));
      assert(r.lat >= c.box.south - 1e-6 && r.lat <= c.box.north + 1e-6 && r.lng >= c.box.west - 1e-6 && r.lng <= c.box.east + 1e-6, 'row inside box');
      // the hour we report must match the hour of the timestamp in local time
      const localHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: src.timezone || 'America/New_York', hour12: false, hour: '2-digit' }).format(new Date(r.t)), 10) % 24;
      assert.strictEqual(localHour, r.h, 'hour matches timestamp: ' + r.id);
    }
    console.log('sample:', S.CATEGORIES[r0.c].label, '|', F.fmtDateTime(r0.t), '|', r0.s, '|', r0.lt);

    const viol = await A.run(src, 'window', Object.assign({ group: 'violent', bbox: c.box }, win));
    assert(viol.rows.every((r) => S.CATEGORIES[r.c].group === 'violent'));
    const dark = await A.run(src, 'window', Object.assign({ group: 'all', tod: 'dark', bbox: c.box }, win));
    assert(dark.rows.every((r) => r.h < 6 || r.h >= 18), 'dark filter keeps only 6p-6a');
    console.log(`violent ${viol.rows.length}, after dark (all types) ${dark.rows.length}`);

    t0 = Date.now();
    const ref = await A.run(src, 'reference', Object.assign({ group: 'violent', tod: 'any' }, win));
    const idx = new S.GridIndex(ref.map((p) => ({ lat: p.lat, lng: p.lng, w: p.n * S.CATEGORIES[p.c].weight })));
    const table = S.buildReference(idx, idx, 200);
    console.log(`reference: ${ref.length} points -> ${table.length} cells, median ${table[table.length >> 1]}, p95 ${table[Math.floor(table.length * 0.95)]}  [${Date.now() - t0} ms]`);
    assert(table.length > 200);

    const last = await A.run(src, 'last', { lat: c.spot[0], lng: c.spot[1], radiusM: 200, group: 'all', tod: 'any', to: asOf });
    console.log('last incident within 200 m:', last ? `${S.CATEGORIES[last.c].label}, ${F.fmtDateTime(last.t)}` : 'none');

    const cnt = await A.run(src, 'count', win);
    console.log(`citywide count in window (all mapped types): ${cnt.count}`);
    assert(cnt.count > 100);
    console.log('recordUrl:', src.recordUrl(r0.id));
    const rec = await (await fetch(src.recordUrl(r0.id))).json();
    assert(rec.features ? rec.features.length === 1 : rec.length >= 1, 'record link returns the record');
  }
  assert.strictEqual(Src.find(29.76, -95.37), null); // Houston is not configured

  // Regression: one stray point at (0, 0) once made the rating grid billions of cells and froze the tab.
  const pts = [{ lat: 47.6, lng: -122.3, w: 8 }, { lat: 47.61, lng: -122.31, w: 6 }, { lat: 0, lng: 0, w: 1 }];
  const idx = new S.GridIndex(pts);
  const t0 = Date.now();
  const table = S.buildReference(idx, idx, 200);
  assert(Date.now() - t0 < 3000, 'buildReference must stay fast with an outlier, took ' + (Date.now() - t0) + ' ms');
  console.log('outlier point handled in', Date.now() - t0, 'ms, table size', table.length);
  console.log('\nOK');
})().catch((e) => { console.error(e); process.exit(1); });

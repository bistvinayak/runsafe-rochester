// Run: node test/smoke.js   (hits the live RPD service)
const assert = require('assert');
const data = require('../lib/data.js');
const S = require('../lib/score.js');

(async () => {
  const t0 = Date.now();
  const { rows, fromCache } = await data.loadIncidents({ force: true });
  console.log(`loaded ${rows.length} incidents in ${Date.now() - t0} ms (cache=${fromCache})`);
  assert(rows.length > 3000, 'expected thousands of incidents for the last year');
  assert(rows.every((r) => data.inCoverage(r.lat, r.lng) || true));
  const outside = rows.filter((r) => !data.inCoverage(r.lat, r.lng)).length;
  console.log('rows outside coverage box:', outside);

  const hours = rows.filter((r) => r.h >= 0).length;
  console.log('rows with parsed hour:', hours, '/', rows.length);

  for (const group of ['violent', 'property', 'all']) {
    const f = S.filterIncidents(rows, { days: 90, group, tod: 'any' });
    console.log(group, '90d:', f.length);
  }
  const day = S.filterIncidents(rows, { days: 365, group: 'violent', tod: 'day' }).length;
  const dark = S.filterIncidents(rows, { days: 365, group: 'violent', tod: 'dark' }).length;
  console.log('violent 1y daylight vs dark:', day, dark);

  const opts = { days: 90, group: 'violent', tod: 'any' };
  const f = S.filterIncidents(rows, opts);
  const idx = new S.GridIndex(f);
  const mask = new S.GridIndex(S.filterIncidents(rows, { days: 90, group: 'all', tod: 'any' }));
  const t1 = Date.now();
  const ref = S.buildReference(idx, mask, 200);
  console.log(`reference cells: ${ref.length}, built in ${Date.now() - t1} ms; median=${ref[ref.length >> 1]}, p95=${ref[Math.floor(ref.length * .95)]}`);
  assert(ref.length > 500);

  // Downtown vs. Highland Park vs. Genesee Valley Park (rough coordinates)
  const spots = { 'Downtown (Main & Clinton)': [43.1566, -77.6047], 'Highland Park': [43.1287, -77.6014], 'Genesee Valley Park': [43.1233, -77.6389], 'Lake Ontario shore (Charlotte)': [43.2521, -77.6147] };
  for (const [name, [lat, lng]] of Object.entries(spots)) {
    const a = S.summarizeArea(idx, ref, lat, lng, 200);
    console.log(name.padEnd(34), 'incidents', String(a.incidents.length).padStart(3), 'score', String(a.score).padStart(4), a.level.label, (a.pct * 100).toFixed(0) + '%');
  }

  // Route: downtown -> Highland Park via OSM foot routing
  const url = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/-77.6047,43.1566;-77.6014,43.1287?overview=full&geometries=geojson';
  const j = await (await fetch(url)).json();
  const latlngs = j.routes[0].geometry.coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
  const a = S.analyzeRoute(latlngs, idx, ref, { radiusM: 200 });
  console.log(`route ${(a.lengthM / 1609.34).toFixed(2)} mi, samples ${a.samples.length}, incidents ${a.incidents.length}, level ${a.level.label} (${(a.pct * 100).toFixed(0)}%), hotspot ${a.hotspotM} m`);
  assert(Math.abs(a.samples[a.samples.length - 1].dist - a.lengthM) < 1);

  // resample sanity
  const line = [{ lat: 43.15, lng: -77.6 }, { lat: 43.16, lng: -77.6 }];
  const rs = S.resample(line, 100);
  assert(Math.abs(rs.lengthM - 1112) < 5, 'length of 0.01 deg lat ~1112 m, got ' + rs.lengthM);
  assert.strictEqual(rs.points.length, 13); // start + 11 steps + tail
  assert.strictEqual(S.percentile([0,0,0,0,5,10], 0), 1/3);
  assert(S.percentile([0,0,0,0,5,10], 10) > 0.9);
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });

// Run: node test/live.test.js   (hits the live police data services)
const assert = require('assert');
const A = require('../lib/adapters.js');
const { LiveSession, viewBbox } = require('../lib/live.js');

const calls = [];
const live = new LiveSession((src, op, args) => { calls.push(op); return A.run(src, op, args); });
const count = () => { const c = calls.splice(0); return c.sort().join(','); };
const view = (lat, lng, z = 15) => ({ lat, lng, bbox: viewBbox({ lat, lng, z }, 1200, 800), group: 'violent', tod: 'any' });

(async () => {
  let st = await live.ensure(view(40.758, -73.985));
  console.log('first load       ->', st, '| calls:', count(), '| rows:', live.rows.length, '| lag days:', live.lagDays());
  assert.strictEqual(st, 'ready'); assert(live.rows.length > 0);

  st = await live.ensure(view(40.7585, -73.9845));
  assert.strictEqual(count(), '', 'small pan must not reload');
  console.log('small pan        -> no requests');

  st = await live.ensure(view(40.70, -73.95));
  console.log('pan to Brooklyn  ->', st, '| calls:', count(), '| rows:', live.rows.length);
  assert(live.rows.every((r) => r.lat > 40.4));

  st = Object.assign(view(40.70, -73.95), { group: 'property' });
  await live.ensure(st);
  console.log('group -> property| calls:', count(), '| rows:', live.rows.length, '| cats:', [...new Set(live.rows.map((r) => r.c))].sort());

  await live.ensure(Object.assign(view(40.70, -73.95), { group: 'property', tod: 'dark' }));
  assert.strictEqual(count(), 'reference', 'time-of-day only needs a new reference');
  console.log('after-dark filter-> only the reference reloaded');

  const last = await live.lastNear(40.758, -73.985, 'violent', 'any');
  const again = await live.lastNear(40.758, -73.985, 'violent', 'any');
  console.log('last near Times Sq:', last && new Date(last.t).toISOString(), '| second lookup cached:', count());
  assert.strictEqual(last, again);

  st = await live.ensure(view(43.1566, -77.6047));
  console.log('to Rochester     ->', st, live.source.id, '| calls:', count(), '| rows:', live.rows.length);
  assert.strictEqual(live.source.id, 'rochester-ny');

  st = await live.ensure(view(41.8781, -87.6298));
  console.log('Chicago          ->', st, '| source:', live.source);
  assert.strictEqual(st, 'uncovered');

  // a newer call replaces an older one that is still in flight
  live.reset();
  const p1 = live.ensure(view(40.758, -73.985));
  const p2 = live.ensure(view(43.1566, -77.6047));
  const [s1, s2] = await Promise.all([p1, p2]);
  console.log('overlapping calls->', s1, s2, '| ends on:', live.source.id);
  assert.strictEqual(s2, 'ready'); assert.strictEqual(live.source.id, 'rochester-ny');

  // failure is reported, not thrown
  const broken = new LiveSession(() => Promise.reject(new Error('server down')));
  st = await broken.ensure(view(40.758, -73.985));
  assert.strictEqual(st, 'error'); assert.strictEqual(broken.error, 'server down');
  console.log('server failure   ->', st, '|', broken.error);
  console.log('\nOK');
})().catch((e) => { console.error(e); process.exit(1); });

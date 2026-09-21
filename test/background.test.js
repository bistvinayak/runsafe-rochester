// Run: node test/background.test.js
// Loads background.js the way Chrome's service worker does (importScripts, no require) with a fake `chrome`,
// then checks the message handlers and that the manifest matches what the code needs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const listeners = { message: null, click: null };
const created = [];
const sandbox = {
  chrome: {
    runtime: { onMessage: { addListener: (fn) => { listeners.message = fn; } }, getURL: (p) => 'chrome-extension://test/' + p },
    action: { onClicked: { addListener: (fn) => { listeners.click = fn; } } },
    tabs: { create: (o) => created.push(o.url), sendMessage: () => Promise.reject(new Error('no receiver')) },
  },
  fetch, URLSearchParams, AbortSignal, Intl, Date, Math, JSON, Map, Set, Promise, Error, isFinite, parseInt, parseFloat, encodeURIComponent, String, Number, Object, Array, console,
};
sandbox.self = sandbox;
vm.createContext(sandbox);
sandbox.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });

const ask = (msg) => new Promise((resolve) => {
  const keep = listeners.message(msg, {}, resolve);
  assert.strictEqual(keep, true, 'async handlers must return true so the channel stays open');
});

(async () => {
  assert(listeners.message && listeners.click, 'background registered its listeners');

  const nyc = await ask({ type: 'src', id: 'new-york-ny', op: 'newest', args: {} });
  assert(nyc.ok && nyc.result.asOf > 0, 'NYC newest: ' + JSON.stringify(nyc));
  const roc = await ask({ type: 'src', id: 'rochester-ny', op: 'window', args: { group: 'violent', from: Date.now() - 30 * 864e5, to: Date.now(), bbox: { south: 43.14, north: 43.17, west: -77.63, east: -77.58 } } });
  assert(roc.ok && Array.isArray(roc.result.rows), 'Rochester window: ' + JSON.stringify(roc).slice(0, 200));
  console.log('src handler: NYC newest', new Date(nyc.result.asOf).toISOString().slice(0, 10), '| Rochester rows', roc.result.rows.length);

  const bad = await new Promise((resolve) => listeners.message({ type: 'src', id: 'nowhere', op: 'newest', args: {} }, {}, resolve));
  assert.strictEqual(bad.ok, false);
  assert(/Unknown data source/.test(bad.error));
  console.log('unknown source ->', bad.error);

  const route = await ask({ type: 'route', coords: [[-73.9855, 40.758], [-73.9819, 40.7681]] });
  assert(route.ok && route.coords.length > 5, 'route');
  console.log('route handler: ', route.coords.length, 'points');

  assert.strictEqual(listeners.message({ type: 'openHeatmap', view: { lat: 40.7, lng: -73.9, z: 14 } }, {}, () => {}), false);
  assert.deepStrictEqual(created, ['chrome-extension://test/heatmap.html#40.7,-73.9,14']);
  await listeners.click({ id: 1, url: 'https://example.com/' });
  assert.strictEqual(created.length, 2, 'toolbar icon opens the heatmap page away from Google Maps');
  console.log('openHeatmap + toolbar click OK');

  // manifest matches the code
  const hosts = new Set(manifest.host_permissions);
  const Src = require('../lib/sources.js');
  for (const s of Src.SOURCES) for (const h of s.hosts) assert(hosts.has(h), 'manifest missing host permission for ' + h);
  assert(hosts.has('https://routing.openstreetmap.de/*'));
  for (const f of manifest.content_scripts[0].js.concat([manifest.background.service_worker, 'heatmap.html', 'heatmap.js', 'heatmap.css'])) {
    assert(fs.existsSync(path.join(root, f)), 'missing file ' + f);
  }
  const html = fs.readFileSync(path.join(root, 'heatmap.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) assert(fs.existsSync(path.join(root, m[1])), 'heatmap.html references missing ' + m[1]);
  assert(!fs.existsSync(path.join(root, 'lib/data.js')), 'old data.js should be gone');
  console.log('manifest: host permissions and files match the code');
  console.log('\nOK');
})().catch((e) => { console.error(e); process.exit(1); });

// Look for police incident layers on ArcGIS for the cities that are not configured yet, and check each candidate:
// point layer? a date field? how fresh? Prints the best few per city. Build-time tool only.
//   node tools/discover-arcgis.js > /tmp/arcgis.log
const cities = require('./cities.js');
const Src = require('../lib/sources.js');

const live = new Set(['New York', 'Chicago', 'Seattle']);
const get = async (u, ms = 20000) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (e) { return null; } };
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const GOOD = /(crime|incident|offense|offence|police|nibrs|ucr)/i;
const BAD = /(crash|collision|traffic|arrest|calls? for service|dispatch|use of force|citation|officer|personnel|fire|ems|311|shots? ?fired|gunshot|sex offender|district|beat|precinct|boundar|station|facility|patrol|camera|complaint|parking|court|jail|park)/i;

async function inspectLayer(url) {
  const meta = await get(url + '?f=json');
  if (!meta || meta.error || !meta.fields) return null;
  const fields = meta.fields;
  const dates = fields.filter((f) => f.type === 'esriFieldTypeDate');
  const strs = fields.filter((f) => f.type === 'esriFieldTypeString');
  if (meta.geometryType !== 'esriGeometryPoint' || !dates.length) return null;
  // newest of each date field, ignoring obviously bad future dates
  let best = null;
  for (const d of dates.slice(0, 4)) {
    const q = new URLSearchParams({ where: `${d.name} <= CURRENT_TIMESTAMP`, outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: d.name, outStatisticFieldName: 'm' }]), f: 'json' });
    const j = await get(url + '/query?' + q);
    const m = j && j.features && j.features[0] && j.features[0].attributes.m;
    if (m && (!best || m > best.max)) best = { field: d.name, max: m };
  }
  if (!best) return null;
  const off = strs.filter((f) => /(offen|crime|type|categ|desc|ucr|nibrs|charge|class)/i.test(f.name + ' ' + (f.alias || ''))).map((f) => f.name).slice(0, 6);
  return { name: meta.name, url, dateField: best.field, newest: new Date(best.max).toISOString().slice(0, 10), ageDays: Math.round((Date.now() - best.max) / 864e5), offenseFields: off, maxRec: meta.maxRecordCount, sr: (meta.extent && meta.extent.spatialReference && meta.extent.spatialReference.wkid) || null };
}

async function candidates(name, st) {
  const k = key(name);
  const seen = new Map();
  for (const q of [`${name} ${st} police incidents`, `${name} crime incidents`, `${name} police crime data`]) {
    const j = await get('https://www.arcgis.com/sharing/rest/search?' + new URLSearchParams({ q: `${q} AND type:"Feature Service"`, num: '30', f: 'json' }));
    for (const it of (j && j.results) || []) {
      const hay = key(it.title + ' ' + it.owner + ' ' + (it.orgId || '') + ' ' + (it.snippet || '') + ' ' + (it.tags || []).join(''));
      if (!hay.includes(k) || !GOOD.test(it.title) || BAD.test(it.title) || !it.url) continue;
      seen.set(it.url, it);
    }
  }
  return [...seen.values()];
}

(async () => {
  const todo = cities.filter(([n]) => !live.has(n));
  let idx = 0;
  const results = {};
  async function worker() {
    while (idx < todo.length) {
      const [name, st] = todo[idx++];
      const found = [];
      for (const it of (await candidates(name, st)).slice(0, 8)) {
        let layerUrls = [];
        if (/\/(Feature|Map)Server\/\d+$/.test(it.url)) layerUrls = [it.url];
        else {
          const svc = await get(it.url + '?f=json');
          layerUrls = ((svc && svc.layers) || []).slice(0, 4).map((l) => it.url.replace(/\/$/, '') + '/' + l.id);
        }
        for (const lu of layerUrls) { const r = await inspectLayer(lu); if (r) found.push(Object.assign({ item: it.title }, r)); }
      }
      found.sort((a, b) => a.ageDays - b.ageDays);
      results[name] = found.slice(0, 3);
      const b = results[name][0];
      console.log(`${name.padEnd(16)} ${b ? `${String(b.ageDays).padStart(5)}d  ${b.name.slice(0, 34).padEnd(34)} ${b.dateField.padEnd(22)} ${b.offenseFields.join(',').slice(0, 40)}  ${b.url}` : '(nothing usable found)'}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  require('fs').writeFileSync('/tmp/arcgis-candidates.json', JSON.stringify(results, null, 1));
  console.log('\ncities with at least one candidate:', Object.values(results).filter((r) => r.length).length, 'of', todo.length);
})();

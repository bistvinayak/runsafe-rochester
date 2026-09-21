// Show an ArcGIS layer's fields, feature count and a sample row, so a spec can be written from facts.
//   node tools/arc-columns.js <layer-url> [more urls...]
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(40000) }); return r.json(); };
(async () => {
  for (const url of process.argv.slice(2)) {
    try {
      const m = await get(url + '?f=json');
      const cnt = await get(url + '/query?where=1%3D1&returnCountOnly=true&f=json');
      const f = m.fields || [];
      const short = (t) => t.replace('esriFieldType', '').replace('String', 'str').replace('Integer', 'int').replace('Double', 'dbl').replace('SmallInt', 'int').replace('Date', 'DATE');
      console.log(`\n=== ${m.name} | ${cnt.count} features | maxRecordCount ${m.maxRecordCount}`);
      console.log(url);
      console.log(f.map((x) => `${x.name}:${short(x.type)}`).join('  ').slice(0, 900));
      const s = await get(url + '/query?where=1%3D1&outFields=*&resultRecordCount=1&orderByFields=' + encodeURIComponent((f.find((x) => x.type === 'esriFieldTypeDate') || f[0]).name) + '+DESC&returnGeometry=false&f=json');
      const a = (s.features && s.features[0] && s.features[0].attributes) || {};
      console.log('sample:', JSON.stringify(Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== '').slice(0, 14))).slice(0, 600));
    } catch (e) { console.log('\n=== FAILED', url, e.message); }
  }
})();

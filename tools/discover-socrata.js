// Find police incident datasets on Socrata portals and check them: recent data, a place, a date, an offense field.
// Usage: node tools/discover-socrata.js > out.json
const cities = require('./cities.js');
const get = async (u) => (await fetch(u, { signal: AbortSignal.timeout(60000) })).json();
const QUERIES = ['police incident reports', 'crime incidents', 'offense reports police', 'crime data offenses', 'police reported crime'];
const BAD = /(crash|collision|traffic|arrest|calls? for service|dispatch|use of force|citation|stop|complaint(?!.*crime)|pedestrian|fire|311|animal|shooting victim|officer|personnel|budget|jail|inmate)/i;

(async () => {
  const seen = new Map();
  for (const q of QUERIES) {
    for (let offset = 0; offset < 300; offset += 100) {
      const j = await get('https://api.us.socrata.com/api/catalog/v1?only=dataset&limit=100&offset=' + offset + '&q=' + encodeURIComponent(q));
      for (const r of j.results || []) seen.set(r.resource.id + '@' + r.metadata.domain, r);
    }
  }
  const out = [];
  for (const r of seen.values()) {
    const res = r.resource, dom = r.metadata.domain, cols = res.columns_field_name || [], types = res.columns_datatype || [];
    const lc = cols.map((c) => c.toLowerCase());
    const has = (re) => cols.findIndex((c) => re.test(c));
    out.push({
      domain: dom, id: res.id, name: res.name, updated: (res.data_updated_at || '').slice(0, 10), rows: res.page_views && null,
      bad: BAD.test(res.name), lat: has(/^(lat|latitude|y_?coord.*|latitude_?.*)$/i) >= 0, lon: has(/^(lon|lng|long|longitude|x_?coord.*)$/i) >= 0,
      point: types.some((t) => t === 'point' || t === 'location'), cols,
    });
  }
  console.log(JSON.stringify(out));
})();

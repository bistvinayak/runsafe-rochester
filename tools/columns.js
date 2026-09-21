// Show a Socrata dataset's name, freshness, columns and one sample row.
// Usage: node tools/columns.js data.cityofchicago.org ijzp-q8t2 [more domain/id pairs...]
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
(async () => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const [dom, id] = [args[i], args[i + 1]];
    try {
      const m = await get(`https://${dom}/api/views/${id}.json`);
      const cols = (m.columns || []).filter((c) => !c.fieldName.startsWith(':@'));
      console.log(`\n=== ${dom}/${id}: ${m.name}  (rows updated ${new Date(m.rowsUpdatedAt * 1000).toISOString().slice(0, 10)})`);
      console.log(cols.map((c) => `${c.fieldName}:${c.dataTypeName}`).join('  '));
      const sample = await get(`https://${dom}/resource/${id}.json?$limit=1&$order=:id DESC`);
      console.log('sample:', JSON.stringify(sample[0]).slice(0, 700));
    } catch (e) { console.log(`\n=== ${dom}/${id}: FAILED ${e.message}`); }
  }
})();

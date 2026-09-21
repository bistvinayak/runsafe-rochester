// Stand-in for the extension APIs so content.js can run on a plain web page for testing.
// Requests that the background worker would make are made directly here.
window.chrome = {
  storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
  runtime: {
    lastError: null,
    onMessage: { addListener: () => {} },
    sendMessage: (msg, cb) => {
      if (msg.type === 'src') {
        RunSafe.adapters.run(RunSafe.sources.byId(msg.id), msg.op, msg.args)
          .then((result) => cb && cb({ ok: true, result })).catch((e) => cb && cb({ ok: false, error: e.message }));
      } else if (msg.type === 'route') {
        fetch('https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + msg.coords.map((c) => c.join(',')).join(';') + '?overview=full&geometries=geojson')
          .then((r) => r.json()).then((j) => cb({ ok: true, coords: j.routes[0].geometry.coordinates })).catch((e) => cb({ ok: false, error: e.message }));
      } else if (msg.type === 'openHeatmap') {
        console.log('openHeatmap requested', JSON.stringify(msg.view));
      }
    },
  },
};

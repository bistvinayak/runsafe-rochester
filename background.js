// Network requests live here so they are not subject to the page's CORS or CSP.
importScripts('lib/data.js');

const ROUTE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

async function fetchRoute(coords) {
  const path = coords.map((c) => c[0] + ',' + c[1]).join(';');
  const res = await fetch(ROUTE_URL + path + '?overview=full&geometries=geojson');
  if (!res.ok) throw new Error('Routing request failed (' + res.status + ')');
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes || !json.routes.length) throw new Error('No walking route found');
  return json.routes[0].geometry.coordinates;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'incidents') {
    RunSafe.data.loadIncidents({ force: !!msg.force })
      .then((r) => sendResponse({ ok: true, rows: r.rows, savedAt: r.savedAt, fromCache: r.fromCache }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'route') {
    fetchRoute(msg.coords)
      .then((coords) => sendResponse({ ok: true, coords }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'openHeatmap') {
    openHeatmap(msg.view);
    return false;
  }
  return false;
});

function openHeatmap(view) {
  const hash = view ? '#' + [view.lat, view.lng, view.z].join(',') : '';
  chrome.tabs.create({ url: chrome.runtime.getURL('heatmap.html') + hash });
}

// On Google Maps the toolbar icon shows or hides the overlay. Anywhere else it opens the full heatmap page.
chrome.action.onClicked.addListener((tab) => {
  const onMaps = tab.url && /^https:\/\/www\.google\.com\/maps/.test(tab.url);
  if (onMaps && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => openHeatmap());
  else openHeatmap();
});

// Formatting helpers and source links shared by the Google Maps overlay and the heatmap page.
(function (root) {
  'use strict';

  const PORTAL = 'https://data-rpdny.opendata.arcgis.com/';
  const DATASET_PAGE = 'https://www.arcgis.com/home/item.html?id=74c62e65e3b347e289a07d02d4b8c899';
  const LAYER = 'https://maps.cityofrochester.gov/arcgis/rest/services/RPD/RPD_Part_I_Crime/FeatureServer/3';
  const TZ = 'America/New_York';

  function timeAgo(t) {
    const diff = Date.now() - t;
    if (diff < 0) return 'just now';
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (hours < 1) return 'less than an hour ago';
    if (days < 1) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    if (days === 1) return 'yesterday';
    if (days < 14) return days + ' days ago';
    if (days < 60) return Math.floor(days / 7) + ' weeks ago';
    return Math.floor(days / 30) + ' months ago';
  }

  // Timestamps from RPD are true UTC; show them in Rochester time.
  const fmt = (t, o) => new Date(t).toLocaleString('en-US', Object.assign({ timeZone: TZ }, o));
  const fmtDate = (t) => fmt(t, { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtDateTime = (t) => fmt(t, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  // The unmodified record as published by RPD.
  const recordUrl = (id) => LAYER + '/query?where=OBJECTID%3D' + encodeURIComponent(id) + '&outFields=*&outSR=4326&f=json';
  const countUrl = (days) => LAYER + '/query?where=' + encodeURIComponent('OccurredFrom_Timestamp > CURRENT_TIMESTAMP - ' + days) + '&returnCountOnly=true&f=json';

  const lower = (s) => String(s || '').toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const api = { PORTAL, DATASET_PAGE, LAYER, timeAgo, fmtDate, fmtDateTime, recordUrl, countUrl, lower, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.format = api; }
})(typeof self !== 'undefined' ? self : this);

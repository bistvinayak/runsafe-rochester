// Formatting helpers and source links shared by the Google Maps overlay and the heatmap page.
(function (root) {
  'use strict';

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

  // Timestamps are true UTC; show them in Eastern time (both current sources are in that zone).
  const fmt = (t, o) => new Date(t).toLocaleString('en-US', Object.assign({ timeZone: TZ }, o));
  const fmtDate = (t) => fmt(t, { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtDay = (t) => fmt(t, { month: 'short', day: 'numeric' });
  const fmtDateTime = (t) => fmt(t, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const lower = (s) => String(s || '').toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const api = { timeAgo, fmtDate, fmtDay, fmtDateTime, lower, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.format = api; }
})(typeof self !== 'undefined' ? self : this);

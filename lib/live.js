// Live data session. Decides what to fetch for the map view, holds it in memory only, and reloads when you move.
// Used by both the Google Maps overlay (requests go through the background worker) and the heatmap page (direct).
// Nothing is written to disk here.
(function (root) {
  'use strict';

  const Src = typeof require === 'function' ? require('./sources.js') : root.RunSafe.sources;
  const STALE_MS = 10 * 60 * 1000; // reload after 10 minutes so a long-open tab does not show old data
  const PAD = 0.5; // load half a screen beyond each edge so small pans need no new request
  const LAST_RADIUS_M = 200;

  // ---------- map math ----------
  function mercator(lat, lng, z) {
    const scale = 256 * Math.pow(2, z);
    const sin = Math.sin((lat * Math.PI) / 180);
    return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
  }
  function unmercator(x, y, z) {
    const scale = 256 * Math.pow(2, z);
    const n = Math.PI - (2 * Math.PI * y) / scale;
    return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: (x / scale) * 360 - 180 };
  }
  // The lat/lng box visible in a w x h pixel map centered on `view` ({ lat, lng, z }).
  function viewBbox(view, w, h) {
    const c = mercator(view.lat, view.lng, view.z);
    const tl = unmercator(c.x - w / 2, c.y - h / 2, view.z);
    const br = unmercator(c.x + w / 2, c.y + h / 2, view.z);
    return { south: br.lat, north: tl.lat, west: tl.lng, east: br.lng };
  }
  const expand = (b, f) => {
    const dLat = (b.north - b.south) * f;
    const dLng = (b.east - b.west) * f;
    return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLng, east: b.east + dLng };
  };
  const covers = (outer, inner) => outer.south <= inner.south && outer.north >= inner.north && outer.west <= inner.west && outer.east >= inner.east;
  // Nothing exists outside a source's area, so never ask for more than that.
  const clamp = (b, area) => ({
    south: Math.max(b.south, area.south), north: Math.min(b.north, area.north),
    west: Math.max(b.west, area.west), east: Math.min(b.east, area.east),
  });
  const union = (a, b) => (b ? { south: Math.min(a.south, b.south), north: Math.max(a.north, b.north), west: Math.min(a.west, b.west), east: Math.max(a.east, b.east) } : a);

  class LiveSession {
    // transport(source, op, args) -> Promise: runs an adapter operation somewhere (background worker or directly).
    constructor(transport) {
      this.transport = transport;
      this.token = 0;
      this.reset();
    }

    reset() {
      this.source = null;
      this.status = 'idle'; // idle | loading | ready | error | uncovered
      this.error = '';
      this.invalidate();
      this.rows = [];
      this.truncated = false;
    }

    // Forget what was loaded so the next ensure() fetches fresh data.
    invalidate() {
      this.asOf = 0;
      this.window = null;
      this.loaded = null; // { bbox, group }
      this.refPts = null;
      this.refKey = '';
      this.loadedAt = 0;
      this.lastCache = new Map();
    }

    call(op, args) { return this.transport(this.source, op, args); }

    lagDays() { return this.asOf ? Math.floor((Date.now() - this.asOf) / Src.DAY_MS) : 0; }

    // v: { lat, lng, bbox, group, tod }. Loads whatever is missing for this view. Returns the resulting status,
    // or 'stale' if a newer call replaced this one while it was waiting.
    async ensure(v) {
      const src = Src.find(v.lat, v.lng);
      if (!src) { this.reset(); this.status = 'uncovered'; return this.status; }
      if (!this.source || this.source.id !== src.id) { this.reset(); this.source = src; }
      if (this.loadedAt && Date.now() - this.loadedAt > STALE_MS) this.invalidate();

      if (src.timeOfDay === false) v = Object.assign({}, v, { tod: 'any' }); // this source publishes dates only, no times
      const want = clamp(v.bbox, src.bounds);
      const needRows = !this.loaded || this.loaded.group !== v.group || !covers(this.loaded.bbox, want);
      const refKey = v.group + '|' + v.tod;
      const needRef = this.refKey !== refKey;
      if (this.asOf && !needRows && !needRef) { this.status = 'ready'; return this.status; }

      const token = ++this.token;
      this.status = 'loading';
      this.error = '';
      try {
        if (!this.asOf) {
          const n = await this.call('newest', {});
          if (token !== this.token) return 'stale';
          this.asOf = n.asOf;
          this.window = { from: n.asOf - Src.WINDOW_DAYS * Src.DAY_MS, to: n.asOf };
        }
        const { from, to } = this.window;
        const bbox = clamp(expand(want, PAD), src.bounds);
        const [win, ref] = await Promise.all([
          needRows ? this.call('window', { bbox, from, to, group: v.group }) : null,
          needRef ? this.call('reference', { from, to, group: v.group, tod: v.tod }) : null,
        ]);
        if (token !== this.token) return 'stale';
        if (win) { this.rows = win.rows; this.truncated = win.truncated; this.loaded = { bbox, group: v.group }; }
        if (ref) { this.refPts = ref; this.refKey = refKey; }
        this.loadedAt = Date.now();
        this.status = 'ready';
      } catch (e) {
        if (token !== this.token) return 'stale';
        this.status = 'error';
        this.error = e.message || String(e);
      }
      return this.status;
    }

    // Most recent incident within 200 m of a point, over the whole dataset (not just the 30-day window).
    async lastNear(lat, lng, group, tod) {
      if (!this.source || !this.asOf) return null;
      const key = [this.source.id, group, tod, lat.toFixed(3), lng.toFixed(3)].join('|');
      if (this.lastCache.has(key)) return this.lastCache.get(key);
      const row = await this.call('last', { lat, lng, radiusM: LAST_RADIUS_M, group, tod, to: this.asOf });
      this.lastCache.set(key, row);
      return row;
    }
  }

  const api = { LiveSession, viewBbox, expand, union, clamp, covers, mercator, LAST_RADIUS_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.live = api; }
})(typeof self !== 'undefined' ? self : this);

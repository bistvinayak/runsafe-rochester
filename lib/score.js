// Pure scoring logic: no DOM, no network. Works in the browser (window.RunSafe.score) and in Node.
(function (root) {
  'use strict';

  // RPD Statute_CrimeCategory codes (UCR Part I). Rape is excluded from the public dataset.
  const CATEGORIES = {
    1: { label: 'Homicide', group: 'violent', weight: 10 },
    3: { label: 'Robbery', group: 'violent', weight: 8 },
    4: { label: 'Aggravated assault / menacing', group: 'violent', weight: 6 },
    5: { label: 'Burglary', group: 'property', weight: 1 },
    6: { label: 'Larceny', group: 'property', weight: 0.5 },
    7: { label: 'Vehicle theft', group: 'property', weight: 0.5 },
    // Lower-level assault (for example New York's "Assault 3"). Only shown under "All reported".
    8: { label: 'Assault (lower level)', group: 'other', weight: 2 },
  };

  // Category codes that belong to a filter group ('violent', 'property' or 'all').
  function categoriesFor(group) {
    return Object.keys(CATEGORIES).map(Number).filter((c) => group === 'all' || CATEGORIES[c].group === group);
  }

  const EARTH_R = 6371000;
  const CELL_DEG = 0.0025; // ~275 m grid buckets

  function meters(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
    const y = (lat2 - lat1) * rad;
    return Math.sqrt(x * x + y * y) * EARTH_R;
  }

  const cellKey = (iy, ix) => iy + ',' + ix;

  class GridIndex {
    constructor(items) {
      this.items = items;
      this.cells = new Map();
      for (const it of items) {
        const k = cellKey(Math.floor(it.lat / CELL_DEG), Math.floor(it.lng / CELL_DEG));
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(it);
        else this.cells.set(k, [it]);
      }
    }

    // Calls cb(item, distanceM) for every item within radiusM of the point.
    within(lat, lng, radiusM, cb) {
      const dLat = radiusM / 111320;
      const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
      const y0 = Math.floor((lat - dLat) / CELL_DEG);
      const y1 = Math.floor((lat + dLat) / CELL_DEG);
      const x0 = Math.floor((lng - dLng) / CELL_DEG);
      const x1 = Math.floor((lng + dLng) / CELL_DEG);
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const bucket = this.cells.get(cellKey(iy, ix));
          if (!bucket) continue;
          for (const it of bucket) {
            const d = meters(lat, lng, it.lat, it.lng);
            if (d <= radiusM) cb(it, d);
          }
        }
      }
    }

    scoreAt(lat, lng, radiusM) {
      let s = 0;
      this.within(lat, lng, radiusM, (it) => { s += it.w; });
      return s;
    }

    hasAny(lat, lng, radiusM) {
      let found = false;
      this.within(lat, lng, radiusM, () => { found = true; });
      return found;
    }
  }

  // opts: { days?, group: 'violent'|'property'|'all', tod: 'any'|'day'|'dark' }
  // `days` is optional: the live loader already limits rows to the data window.
  // Returns a new array of incidents with a weight `w` attached.
  function filterIncidents(all, opts, now) {
    const cutoff = opts.days ? (now || Date.now()) - opts.days * 86400000 : -Infinity;
    const out = [];
    for (const r of all) {
      if (r.t < cutoff) continue;
      const cat = CATEGORIES[r.c];
      if (!cat) continue;
      if (opts.group !== 'all' && cat.group !== opts.group) continue;
      if (opts.tod !== 'any') {
        if (r.h < 0) continue;
        const daylight = r.h >= 6 && r.h < 18;
        if (opts.tod === 'day' ? !daylight : daylight) continue;
      }
      out.push(Object.assign({}, r, { w: cat.weight }));
    }
    return out;
  }

  // Points along a polyline every stepM meters (always includes the first and last point).
  function resample(latlngs, stepM) {
    if (latlngs.length === 0) return { points: [], lengthM: 0 };
    const points = [{ lat: latlngs[0].lat, lng: latlngs[0].lng, dist: 0 }];
    let travelled = 0;
    let nextAt = stepM;
    for (let i = 1; i < latlngs.length; i++) {
      const a = latlngs[i - 1];
      const b = latlngs[i];
      const segLen = meters(a.lat, a.lng, b.lat, b.lng);
      while (segLen > 0 && nextAt <= travelled + segLen) {
        const f = (nextAt - travelled) / segLen;
        points.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, dist: nextAt });
        nextAt += stepM;
      }
      travelled += segLen;
    }
    const last = latlngs[latlngs.length - 1];
    const tail = points[points.length - 1];
    if (travelled - tail.dist > 1) points.push({ lat: last.lat, lng: last.lng, dist: travelled });
    return { points, lengthM: travelled };
  }

  // Scores every point on a 200 m grid over the urban area so a route can be ranked against the city.
  // scoreIdx holds the filtered incidents; maskIdx (all types) limits the grid to places that have crime data nearby.
  function buildReference(scoreIdx, maskIdx, radiusM) {
    const items = maskIdx.items;
    if (items.length === 0) return [];
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const it of items) {
      if (it.lat < minLat) minLat = it.lat;
      if (it.lat > maxLat) maxLat = it.lat;
      if (it.lng < minLng) minLng = it.lng;
      if (it.lng > maxLng) maxLng = it.lng;
    }
    const midLat = (minLat + maxLat) / 2;
    let stepM = 200;
    // Safety cap: never build more than about 300,000 grid points, however far apart the incidents are.
    const cells = ((maxLat - minLat) * 111320 / stepM) * ((maxLng - minLng) * 111320 * Math.cos((midLat * Math.PI) / 180) / stepM);
    if (cells > 300000) stepM *= Math.sqrt(cells / 300000);
    const stepLat = stepM / 111320;
    const stepLng = stepM / (111320 * Math.cos((midLat * Math.PI) / 180));
    const scores = [];
    for (let lat = minLat; lat <= maxLat; lat += stepLat) {
      for (let lng = minLng; lng <= maxLng; lng += stepLng) {
        if (!maskIdx.hasAny(lat, lng, 400)) continue;
        scores.push(scoreIdx.scoreAt(lat, lng, radiusM));
      }
    }
    scores.sort((a, b) => a - b);
    return scores;
  }

  // Mid-rank percentile: share of reference cells scoring below x, plus half of the ties.
  // Mid-rank matters because most cells score exactly 0, and a zero-incident area should rank as low, not typical.
  function percentile(ref, x) {
    if (ref.length === 0) return 0;
    const bound = (strict) => {
      let lo = 0, hi = ref.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (strict ? ref[mid] < x - 1e-9 : ref[mid] <= x + 1e-9) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const below = bound(true);
    const atOrBelow = bound(false);
    return (below + atOrBelow) / 2 / ref.length;
  }

  const LEVELS = [
    { max: 0.5, key: 'low', label: 'Lower than typical', color: '#2e9e5b' },
    { max: 0.8, key: 'typical', label: 'Typical', color: '#d4a20f' },
    { max: 0.95, key: 'elevated', label: 'Elevated', color: '#e8772e' },
    { max: Infinity, key: 'high', label: 'High', color: '#c9302c' },
  ];

  function level(p) {
    return LEVELS.find((l) => p < l.max) || LEVELS[LEVELS.length - 1];
  }

  // Walks the route, scoring every sample point by nearby weighted incidents.
  function analyzeRoute(latlngs, scoreIdx, ref, opts) {
    const radius = (opts && opts.radiusM) || 150;
    const { points, lengthM } = resample(latlngs, 100);
    const seen = new Map();
    const samples = points.map((p) => {
      let score = 0;
      scoreIdx.within(p.lat, p.lng, radius, (it) => {
        score += it.w;
        seen.set(it.id, it);
      });
      return { lat: p.lat, lng: p.lng, dist: p.dist, score, pct: percentile(ref, score) };
    });
    const mean = samples.length ? samples.reduce((s, x) => s + x.score, 0) / samples.length : 0;
    const peak = samples.reduce((m, x) => Math.max(m, x.score), 0);
    const byCategory = {};
    for (const it of seen.values()) byCategory[it.c] = (byCategory[it.c] || 0) + 1;
    const pct = percentile(ref, mean);
    // Hotspots: consecutive samples in the top 10% of the city.
    const hot = samples.filter((s) => s.pct >= 0.9).length;
    return {
      lengthM, samples, mean, peak, pct, level: level(pct),
      incidents: Array.from(seen.values()),
      byCategory,
      hotspotM: Math.min(lengthM, hot * 100), // samples are 100 m apart, so the last one can overshoot the route
    };
  }

  // Everything near one spot (used when the user taps the map).
  function summarizeArea(scoreIdx, ref, lat, lng, radiusM) {
    const found = [];
    let score = 0;
    scoreIdx.within(lat, lng, radiusM, (it, d) => { found.push(Object.assign({ dist: d }, it)); score += it.w; });
    found.sort((a, b) => b.t - a.t);
    const byCategory = {};
    for (const it of found) byCategory[it.c] = (byCategory[it.c] || 0) + 1;
    const pct = percentile(ref, score);
    return { incidents: found, byCategory, score, pct, level: level(pct) };
  }

  const api = {
    CATEGORIES, categoriesFor, GridIndex, meters, filterIncidents, resample,
    buildReference, percentile, level, analyzeRoute, summarizeArea, LEVELS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.score = api; }
})(typeof self !== 'undefined' ? self : this);

// Registry of crime data sources. Each entry says where a place's data lives and how to read it.
// Pure configuration, safe to load anywhere (page, background worker, heatmap page).
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const WINDOW_DAYS = 30; // the map always shows the 30 days ending at the newest record

  const SOURCES = [
    {
      id: 'rochester-ny',
      name: 'Rochester, NY',
      agency: 'Rochester Police Department',
      type: 'arcgis',
      verified: true,
      bounds: { south: 43.1074, west: -77.7026, north: 43.2669, east: -77.5354 },
      portal: 'https://data-rpdny.opendata.arcgis.com/',
      datasetPage: 'https://www.arcgis.com/home/item.html?id=74c62e65e3b347e289a07d02d4b8c899',
      dataUrl: 'https://maps.cityofrochester.gov/arcgis/rest/services/RPD/RPD_Part_I_Crime/FeatureServer/3',
      timezone: 'America/New_York',
      whenKind: 'utc',
      fields: { id: 'OBJECTID', when: 'OccurredFrom_Timestamp', timeField: 'OccurredFrom_Time', offense: 'Statute_CrimeCategory', numeric: true, detail: 'Statute_Description', place: 'Location_Type', area: 'Geocode_Street' },
      categoryMap: { 1: 1, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 },
      hosts: ['https://maps.cityofrochester.gov/*'],
      datasetName: 'RPD Part I Crime, 2011 to Present',
      notes: [
        'Part I crimes only. Rape is excluded from the public data for privacy.',
        'Only the City of Rochester is covered. Suburbs are separate agencies.',
      ],
      recordUrl(id) { return this.dataUrl + '/query?where=OBJECTID%3D' + encodeURIComponent(id) + '&outFields=*&outSR=4326&f=json'; },
    },
    {
      id: 'new-york-ny',
      name: 'New York City',
      agency: 'New York City Police Department (NYPD)',
      type: 'socrata',
      verified: true,
      bounds: { south: 40.477, west: -74.26, north: 40.918, east: -73.7 },
      portal: 'https://opendata.cityofnewyork.us/',
      datasetPage: 'https://data.cityofnewyork.us/d/5uac-w243',
      domain: 'data.cityofnewyork.us',
      dataset: '5uac-w243',
      when: { field: 'cmplnt_fr_dt', kind: 'split', timeField: 'cmplnt_fr_tm' },
      fields: { id: 'cmplnt_num', lat: 'latitude', lon: 'longitude', offense: 'ofns_desc', detail: 'pd_desc', place: 'prem_typ_desc', area: ['parks_nm', 'boro_nm'] },
      hosts: ['https://data.cityofnewyork.us/*'],
      datasetName: 'NYPD Complaint Data Current (Year To Date)',
      timezone: 'America/New_York',
      // NYPD offense name -> our category code. Anything not listed is left out (rape and sex crimes, harassment, drugs and so on).
      categoryMap: {
        'MURDER & NON-NEGL. MANSLAUGHTER': 1,
        'ROBBERY': 3,
        'FELONY ASSAULT': 4,
        'ASSAULT 3 & RELATED OFFENSES': 8,
        'BURGLARY': 5,
        'GRAND LARCENY': 6,
        'PETIT LARCENY': 6,
        'GRAND LARCENY OF MOTOR VEHICLE': 7,
        'PETIT LARCENY OF MOTOR VEHICLE': 7,
        'UNAUTHORIZED USE OF A VEHICLE': 7,
      },
      notes: [
        'NYPD publishes this data with a delay of weeks to months, so the map shows the 30 days ending at the newest record, not today.',
        'Rape, sex crimes, harassment, drug and similar offenses are left out so the categories match other cities.',
        'Only NYPD-reported incidents inside the five boroughs are covered. Nearby places such as Jersey City are not.',
        'Suspect and victim details are not loaded.',
      ],
      recordUrl(id) { return 'https://' + this.domain + '/resource/' + this.dataset + '.json?' + this.fields.id + '=' + encodeURIComponent(id); },
    },
  ];

  // Cities generated and validated by tools/build-city.js.
  const GENERATED = typeof require === 'function' ? require('./cities.js') : (root.RunSafe && root.RunSafe.cities) || [];
  for (const g of GENERATED) SOURCES.push(g);
  for (const s of SOURCES) {
    // Link to the unmodified record for any Socrata source.
    if (s.type === 'arcgis' && !s.recordUrl) s.recordUrl = function (id) {
      // ID columns are sometimes text (e.g. Denver's OFFENSE_ID), not just numeric OBJECTIDs, so quote unless it's a plain number.
      const lit = /^-?\d+$/.test(id) ? String(id) : "'" + String(id).replace(/'/g, "''") + "'";
      return this.dataUrl + '/query?where=' + encodeURIComponent(this.fields.id + '=' + lit) + '&outFields=*&outSR=4326&f=json';
    };
    if (s.type === 'socrata' && !s.recordUrl) s.recordUrl = function (id) { return 'https://' + this.domain + '/resource/' + this.dataset + '.json?' + this.fields.id + '=' + encodeURIComponent(id); };
  }

  const area = (b) => (b.north - b.south) * (b.east - b.west);
  const inside = (b, lat, lng) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;

  // The most specific source whose area contains the point, or null.
  function find(lat, lng) {
    let best = null;
    for (const s of SOURCES) if (inside(s.bounds, lat, lng) && (!best || area(s.bounds) < area(best.bounds))) best = s;
    return best;
  }
  const byId = (id) => SOURCES.find((s) => s.id === id) || null;

  const api = { SOURCES, WINDOW_DAYS, DAY_MS, find, byId, inside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RunSafe = root.RunSafe || {}; root.RunSafe.sources = api; }
})(typeof self !== 'undefined' ? self : this);

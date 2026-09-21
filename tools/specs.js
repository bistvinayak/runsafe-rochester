// Hand-written dataset specs: where each city's data lives and which columns to read.
// build-city.js validates each one against the live server before it is added to lib/cities.js.
module.exports = [
  {
    id: 'chicago-il',
    domain: 'data.cityofchicago.org', dataset: 'ijzp-q8t2',
    when: { field: 'date', kind: 'floating' },
    fields: { id: 'id', lat: 'latitude', lon: 'longitude', offense: 'fbi_code' },
    // Chicago's FBI codes separate serious from simple assault, which the offense names alone do not.
    explicit: { '01A': 1, '01B': 1, '03': 3, '04A': 4, '04B': 4, '08A': 8, '08B': 8, '05': 5, '06': 6, '07': 7 }, noRules: true,
    config: {
      name: 'Chicago', agency: 'Chicago Police Department', timezone: 'America/Chicago',
      portal: 'https://data.cityofchicago.org/', datasetPage: 'https://data.cityofchicago.org/d/ijzp-q8t2', datasetName: 'Crimes - 2001 to Present',
      domain: 'data.cityofchicago.org', dataset: 'ijzp-q8t2',
      when: { field: 'date', kind: 'floating' },
      fields: { id: 'id', lat: 'latitude', lon: 'longitude', offense: 'fbi_code', detail: 'description', place: 'location_description', area: 'block' },
    },
    notes: ['Chicago publishes reported incidents with the block address, not the exact address. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'san-francisco-ca',
    domain: 'data.sfgov.org', dataset: 'wg3w-h783',
    when: { field: 'incident_datetime', kind: 'floating' },
    fields: { id: 'row_id', lat: 'latitude', lon: 'longitude', offense: 'incident_subcategory' },
    config: {
      name: 'San Francisco', agency: 'San Francisco Police Department', timezone: 'America/Los_Angeles',
      portal: 'https://datasf.org/opendata/', datasetPage: 'https://data.sfgov.org/d/wg3w-h783', datasetName: 'Police Department Incident Reports: 2018 to Present',
      domain: 'data.sfgov.org', dataset: 'wg3w-h783',
      when: { field: 'incident_datetime', kind: 'floating' },
      fields: { id: 'row_id', lat: 'latitude', lon: 'longitude', offense: 'incident_subcategory', detail: 'incident_description', place: 'analysis_neighborhood', area: 'intersection' },
    },
    notes: ['San Francisco reports include supplemental reports, so one incident can appear more than once.', 'Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'seattle-wa',
    domain: 'cos-data.seattle.gov', dataset: 'tazs-3rd5',
    when: { field: 'offense_date', kind: 'floating' },
    fields: { id: 'offense_id', lat: 'latitude', lon: 'longitude', offense: 'offense_sub_category' },
    explicit: { 'JUSTIFIABLE HOMICIDE': null },
    config: {
      name: 'Seattle', agency: 'Seattle Police Department', timezone: 'America/Los_Angeles',
      portal: 'https://data.seattle.gov/', datasetPage: 'https://cos-data.seattle.gov/d/tazs-3rd5', datasetName: 'SPD Crime Data: 2008-Present',
      domain: 'cos-data.seattle.gov', dataset: 'tazs-3rd5',
      when: { field: 'offense_date', kind: 'floating' },
      fields: { id: 'offense_id', lat: 'latitude', lon: 'longitude', cast: 'REDACTED', offense: 'offense_sub_category', detail: 'nibrs_offense_code_description', place: 'neighborhood', area: 'block_address' },
    },
    notes: ['Seattle hides the location of some records (marked REDACTED); those cannot be mapped.', 'Sex crimes are left out so categories match other cities.'],
  },
];

// Hand-written ArcGIS layer specs, validated by build-arcgis.js before they are added to lib/cities.js.
const cfg = (o) => Object.assign({ verified: false }, o);
module.exports = [
  {
    id: 'philadelphia-pa', dataUrl: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Philadelphia_Crime_Map_WFL1/FeatureServer/0', pageSize: 10000,
    config: cfg({ name: 'Philadelphia', agency: 'Philadelphia Police Department', timezone: 'America/New_York', portal: 'https://opendataphilly.org/', datasetPage: 'https://opendataphilly.org/datasets/crime-incidents/', datasetName: 'Crime Incidents',
      fields: { id: 'ID', when: 'DISPATCH_DATE_TIME', offense: 'UCR_GENERAL', detail: 'TEXT_GENERAL_CODE', area: 'LOCATION_BLOCK' } }),
    explicit: { '100': 1, '300': 3, '400': 4, '500': 5, '600': 6, '700': 7, '800': 8 },
    notes: ['Philadelphia reports incidents by dispatch time and block address. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'charlotte-nc', dataUrl: 'https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0', pageSize: 2500, nibris: true, noTimeOfDay: true, whenKind: 'utc',
    config: cfg({ name: 'Charlotte', agency: 'Charlotte-Mecklenburg Police Department', timezone: 'America/New_York', portal: 'https://data.charlottenc.gov/', datasetPage: 'https://data.charlottenc.gov/', datasetName: 'CMPD Incidents',
      fields: { id: 'OBJECTID', when: 'DATE_INCIDENT_BEGAN', offense: 'HIGHEST_NIBRS_CODE', detail: 'HIGHEST_NIBRS_DESCRIPTION', place: 'LOCATION_TYPE_DESCRIPTION', area: 'LOCATION' } }),
    notes: ['Charlotte publishes the date of an incident but not the time, so time-of-day filtering is off.', 'Charlotte lists the most serious offense per incident. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'baltimore-md', dataUrl: 'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/NIBRS_GroupA_Crime_Data/FeatureServer/0', pageSize: 2000, nibris: true,
    config: cfg({ name: 'Baltimore', agency: 'Baltimore Police Department', timezone: 'America/New_York', portal: 'https://data.baltimorecity.gov/', datasetPage: 'https://data.baltimorecity.gov/', datasetName: 'NIBRS Group A Crime Data',
      fields: { id: 'RowID', when: 'CrimeDateTime', offense: 'CrimeCode', detail: 'Description', place: 'PremiseType', area: 'Location' } }),
    notes: ['Victim age, race and gender fields are never loaded. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'boston-ma', dataUrl: 'https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Boston_Crime_Incidents__App_View/FeatureServer/0', pageSize: 2000, nibris: true,
    config: cfg({ name: 'Boston', agency: 'Boston Police Department', timezone: 'America/New_York', portal: 'https://data.boston.gov/', datasetPage: 'https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system', datasetName: 'Crime Incident Reports',
      fields: { id: 'OBJECTID', when: 'FROM_DATE', offense: 'NIBRS_CODE', detail: 'NIBRS_DESC', place: 'PREMISE_DESC', area: 'BLOCK' } }),
    notes: ['Boston lists one row per offense in an incident, so one incident can appear more than once. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'raleigh-nc', dataUrl: 'https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Raleigh_Police_Incidents_Last_90_Days/FeatureServer/0', pageSize: 2000,
    explicit: { 'MV THEFT': 7 },
    config: cfg({ name: 'Raleigh', agency: 'Raleigh Police Department', timezone: 'America/New_York', portal: 'https://data.raleighnc.gov/', datasetPage: 'https://data.raleighnc.gov/', datasetName: 'Raleigh Police Incidents (last 90 days)',
      fields: { id: 'OBJECTID', when: 'reported_date', offense: 'crime_category', detail: 'crime_description', area: 'reported_block_address' } }),
    notes: ['Raleigh publishes the last 90 days only, by the time the incident was reported. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'las-vegas-nv', dataUrl: 'https://services.arcgis.com/jjSk6t82vIntwDbs/arcgis/rest/services/Weekly_Public_Crimes/FeatureServer/0', pageSize: 2000, nibris: true,
    config: cfg({ name: 'Las Vegas', agency: 'Las Vegas Metropolitan Police Department', timezone: 'America/Los_Angeles', portal: 'https://opendata-lvmpd.hub.arcgis.com/', datasetPage: 'https://opendata-lvmpd.hub.arcgis.com/', datasetName: 'Reported NIBRS Crime',
      fields: { id: 'OBJECTID', when: 'ReportedOn', offense: 'NIBRSOffenseCode', detail: 'Offense', place: 'LocationType', area: 'Location' } }),
    notes: ['This is the Las Vegas Metropolitan Police Department, which also covers unincorporated Clark County. Times are when the incident was reported. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'fort-worth-tx', dataUrl: 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Crime_Data/MapServer/0', pageSize: 1000, nibris: true,
    config: cfg({ name: 'Fort Worth', agency: 'Fort Worth Police Department', timezone: 'America/Chicago', portal: 'https://data.fortworthtexas.gov/', datasetPage: 'https://data.fortworthtexas.gov/', datasetName: 'Crime Data',
      fields: { id: 'OBJECTID', when: 'From_Date', offense: 'Offense', detail: 'Offense_Desc', place: 'LocationTypeDescription', area: 'BLOCK_ADDRESS' } }),
    notes: ['Some Fort Worth records carry only a date, so they show as midnight. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'long-beach-ca', dataUrl: 'https://services6.arcgis.com/yCArG7wGXGyWLqav/arcgis/rest/services/Police_Crime_Mapping/FeatureServer/0', pageSize: 2000,
    config: cfg({ name: 'Long Beach', agency: 'Long Beach Police Department', timezone: 'America/Los_Angeles', portal: 'https://data.longbeach.gov/', datasetPage: 'https://data.longbeach.gov/', datasetName: 'Police Crime Mapping',
      fields: { id: 'OBJECTID', when: 'ReportedDateTimeDate', offense: 'CrimeType', detail: 'CrimeType', area: 'Address' } }),
    notes: ['Long Beach publishes recent reports by the time they were reported. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'detroit-mi', dataUrl: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer/0', pageSize: 2000,
    config: cfg({ name: 'Detroit', agency: 'Detroit Police Department', timezone: 'America/New_York', portal: 'https://data.detroitmi.gov/', datasetPage: 'https://data.detroitmi.gov/', datasetName: 'RMS Crime Incidents',
      fields: { id: 'ESRI_OID', when: 'incident_occurred_at', offense: 'offense_category', detail: 'offense_description', area: 'nearest_intersection' } }),
    notes: ['Detroit lists one row per offense, so one incident can appear more than once. Sex crimes are left out so categories match other cities.'],
  },
];

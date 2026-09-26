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
  {
    id: 'denver-co', dataUrl: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer/324', pageSize: 2000,
    explicit: { 'murder': 1, 'robbery': 3, 'aggravated-assault': 4, 'burglary': 5, 'larceny': 6, 'theft-from-motor-vehicle': 6, 'auto-theft': 7 },
    config: cfg({ name: 'Denver', agency: 'Denver Police Department', timezone: 'America/Denver', portal: 'https://opendata-geospatialdenver.hub.arcgis.com/', datasetPage: 'https://opendata-geospatialdenver.hub.arcgis.com/datasets/crime', datasetName: 'Crime',
      fields: { id: 'OFFENSE_ID', when: 'FIRST_OCCURRENCE_DATE', offense: 'OFFENSE_CATEGORY_ID', detail: 'OFFENSE_TYPE_ID', area: 'INCIDENT_ADDRESS' } }),
    notes: ['Denver reports use the geographic layer\'s own GEO_LAT/GEO_LON coordinates. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'nashville-tn', dataUrl: 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0', pageSize: 2000, nibris: true,
    config: cfg({ name: 'Nashville', agency: 'Metro Nashville Police Department', timezone: 'America/Chicago', portal: 'https://data.nashville.gov/', datasetPage: 'https://data.nashville.gov/', datasetName: 'Metro Nashville Police Department Incidents',
      fields: { id: 'Primary_Key', when: 'Incident_Occurred', offense: 'Offense_NIBRS', detail: 'Offense_Description', place: 'Location_Description', area: 'Incident_Location' } }),
    notes: ['Nashville lists one row per offense in an incident, so one incident can appear more than once. Victim demographic fields are never loaded. Sex crimes are left out so categories match other cities.'],
  },
  {
    id: 'tucson-az', dataUrl: 'https://services3.arcgis.com/9coHY2fvuFjG9HQX/arcgis/rest/services/TPD_ReportedCrimesLast45Days/FeatureServer/0', pageSize: 1000,
    // Tucson's own numeric UCR-summary codes, not NIBRS.
    explicit: { '01': 1, '03': 3, '04': 4, '05': 5, '06': 6, '07': 7 },
    config: cfg({ name: 'Tucson', agency: 'Tucson Police Department', timezone: 'America/Phoenix', portal: 'https://gisdata.tucsonaz.gov/', datasetPage: 'https://gisdata.tucsonaz.gov/', datasetName: 'Reported Crimes, Last 45 Days',
      fields: { id: 'IncidentNumber', when: 'OccurredDate', whenIsDateOnly: true, timeField: 'OccurredHour', offense: 'UCRSummary', numeric: false, detail: 'StatuteDescription', place: 'NeighborhoodAssociation' } }),
    notes: ['Tucson publishes only the last 45 days. Sex crimes are left out so categories match other cities.'],
  },
];

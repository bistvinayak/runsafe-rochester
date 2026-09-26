# Coverage: the 50 largest US cities

Status as of 2026-09-21. "Live" means the source is configured and its setup passed the automated checks in `tools/build-city.js` (Socrata) or `tools/build-arcgis.js` (ArcGIS) against the live data service: fresh data, points inside the city, sensible hour-of-day shape, all core crime categories present, and an offense mapping I read through. Generated setups are labeled "automatic, not reviewed" in the card until a person has checked them.

## Live: 15 of the 50 (plus Rochester, NY, which is not in the top 50)

| City | Agency | Data system | Data lag when checked | Notes |
|---|---|---|---|---|
| New York | NYPD | Socrata | about 12 weeks | Checked by hand. Data ends June 30, 2026. |
| Chicago | Chicago PD | Socrata | about 9 days | FBI codes separate serious from minor assault. Block-level locations. |
| Seattle | Seattle PD | Socrata | 1 day | Some locations are hidden and cannot be mapped. |
| Philadelphia | Philadelphia PD | ArcGIS | under 1 day | Layer contains future-dated rows, which are ignored. Local time stored as UTC, detected automatically. |
| Charlotte | Charlotte-Mecklenburg PD | ArcGIS | 3 days | Dates only, so time-of-day filtering is off. |
| Baltimore | Baltimore PD | ArcGIS | 6 days | NIBRS Group A. |
| Boston | Boston PD | ArcGIS | 7 days | One row per offense. |
| Raleigh | Raleigh PD | ArcGIS | under 1 day | Last 90 days only. |
| Las Vegas | Las Vegas Metro PD | ArcGIS | 8 days | Also covers unincorporated Clark County. |
| Fort Worth | Fort Worth PD | ArcGIS | 1 day | Some records carry only a date. Times in the data may be slightly off. |
| Long Beach | Long Beach PD | ArcGIS | 6 days | Rolling recent window. |
| Detroit | Detroit PD | ArcGIS | 2 days | One row per offense. |
| Denver | Denver PD | ArcGIS | 2 days | Category slugs use hyphens (e.g. `auto-theft`), mapped explicitly rather than by the general text rules. |
| Nashville | Metro Nashville PD | ArcGIS | 1 day | One row per offense. |
| Tucson | Tucson PD | ArcGIS | 0 days (publishes last 45 days only) | Uses its own numeric UCR-summary codes, not NIBRS; mapped explicitly. Dates only, no time field beyond an hour bucket. |
| Rochester, NY | Rochester PD | ArcGIS | 3 days | Checked by hand. |

## Looked at, not live yet (24)

| City | Why not yet |
|---|---|
| Los Angeles | The fresh layer I found is the LA County Sheriff (records are in San Dimas), not LAPD. LAPD's dataset covers 2024 to 2025 with raw penal-code text. |
| San Francisco | Clean columns and fresh data, but the server returned 403 for every structured query from my machine. Retry later and test from the extension. |
| Austin | The public dataset has no latitude or longitude, only census block groups. It cannot be mapped at street level. |
| Dallas | The offense column has about 500 distinct free-text values. The adapter maps offenses to an `IN (...)` list for its live queries, and that list gets too long for the server to accept (400 Bad Request) once enough values are mapped. Needs pattern-based (`LIKE`) filtering support instead of a literal list; the spec, its bounds and its offense mapping are already written in `tools/specs.js` for whoever picks this up. |
| Kansas City | Data is split into one dataset per year, which the adapter has no support for combining. |
| Columbus | Records are classified by subject ("Domestic Violence"), not standard offense types. |
| Sacramento, Albuquerque, Omaha | Fresh, but offense categories are coarse or need a review before mapping (for example one combined "assault"). |
| Tampa | Only about 5,000 rows a year, which looks incomplete. |
| Houston | Its NIBRS layers are split by offense group (Person, Property, Society, Group B) across four separate ArcGIS layers with no single combined view. The adapter handles one layer per city, so this needs support for merging several layers into one source. |
| Atlanta, Miami, Oakland, Memphis, Colorado Springs, Portland, Milwaukee, Minneapolis, Tulsa, Mesa | The layers I found are stale (5 months to 7 years old) or cover something else (Mesa's was opioid overdoses). |

## No police incident layer found on ArcGIS (14)

Phoenix, San Antonio, Jacksonville, San Diego, San Jose, Indianapolis, Oklahoma City, El Paso, Washington DC, Louisville, Fresno, Virginia Beach, Bakersfield, Arlington. These may use other data systems (CKAN, Carto, Socrata) or publish downloadable files only. Not checked further.

## How a city gets added

1. Look at its dataset: `node tools/columns.js <domain> <dataset-id>` (Socrata) or `node tools/arc-columns.js <layer-url>` (ArcGIS). `node tools/discover-arcgis.js` scans for candidate ArcGIS layers.
2. Write a spec in `tools/specs.js` (Socrata) or `tools/specs-arcgis.js` (ArcGIS): columns, date style, offense field.
3. Run `node tools/build-city.js <id>` or `node tools/build-arcgis.js <id>`. It maps offenses, finds the city's bounds from the data, works out whether dates are true UTC or local time, and checks the result against the live server. Read the mapping table it prints.
4. Run `node tools/gen-cities.js`, which writes `lib/cities.js`, then add the host to `manifest.json` (a script in the README's development notes does this) and run the tests.

# Coverage: the 50 largest US cities

Status as of 2026-09-21. "Live" means the source is configured, and its setup passed the automated checks in `tools/build-city.js` against the live data service (fresh data, points inside the city, sensible hour-of-day shape, offense mapping reviewed). Live setups are labeled "automatic, not reviewed" in the card until a person has checked them.

## Live (3 of the 50, plus Rochester, NY)

| City | Agency | Data lag when checked | Notes |
|---|---|---|---|
| New York | NYPD | about 12 weeks | Checked by hand. Data ends June 30, 2026. |
| Chicago | Chicago PD | about 1 week | Offense mapping uses FBI codes to separate serious from minor assault. Locations are block-level. |
| Seattle | Seattle PD | 1 day | Some records have hidden locations and cannot be mapped. |
| Rochester, NY (not in the top 50) | Rochester PD | 3 days | Checked by hand. |

## Looked at, not live yet

| City | Why not yet | What it needs |
|---|---|---|
| Los Angeles | The dataset I found covers 2024 to 2025, and its offense text is raw penal-code strings. | Find the current dataset, then map by NIBRS code. |
| San Francisco | Clean columns and fresh data, but the server returned 403 for every structured query (`$select`, `$where`, counts) from my machine. Plain requests worked. | Retry later, and test from the extension itself. |
| Austin | The public "Crime Reports" dataset has no latitude or longitude, only a census block group. | Nothing on our side: it cannot be mapped at street level. |
| Dallas | Dates are stored as text and the location is a special point column. | Adapter support for text dates and point columns. |
| Fort Worth | The "Crime Data" dataset was last updated July 2025. | A newer dataset, if one exists. |
| Kansas City, MO | Data is split into one dataset per year, and the newest I saw was updated January 2026. | Support for a source made of several datasets. |
| Colorado Springs | The dataset has only a point column for location. | Adapter support for point columns. |

## Not looked at yet (40)

Houston, Phoenix, Philadelphia, San Antonio, San Diego, Jacksonville, San Jose, Charlotte, Columbus, Indianapolis, Denver, Oklahoma City, Nashville, Washington DC, El Paso, Las Vegas, Boston, Detroit, Portland, Louisville, Memphis, Baltimore, Milwaukee, Albuquerque, Tucson, Fresno, Sacramento, Mesa, Atlanta, Omaha, Raleigh, Miami, Virginia Beach, Long Beach, Oakland, Minneapolis, Bakersfield, Tulsa, Tampa, Arlington.

Many of these use other data systems (ArcGIS, CKAN, Carto) that the extension has no adapter for yet, and some may publish only downloadable files, which cannot be queried live. That has not been checked city by city.

## How a city gets added

1. Look at its dataset: `node tools/columns.js <domain> <dataset-id>`.
2. Write a spec in `tools/specs.js` (columns, date style, offense field).
3. Run `node tools/build-city.js <id>`. It maps offenses, finds the city's bounds from the data, and checks the result against the live server. Read the mapping table it prints.
4. Run `node tools/gen-cities.js`, which writes `lib/cities.js`, then add the host to `manifest.json` and a case to `test/smoke.js`.

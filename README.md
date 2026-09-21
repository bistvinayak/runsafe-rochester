# RunSafe Rochester

Chrome extension that overlays recent reported crime on Google Maps and rates running routes. Rochester, NY only for now.

## Install

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. Open https://www.google.com/maps and go to Rochester. A blue RunSafe card appears at the top right.

On Google Maps, the extension's toolbar icon shows or hides the overlay. On any other tab it opens the full heatmap page.

## What it does

- **Heatmap** of Part I incidents from the Rochester Police Department, filtered by period (30 days, 90 days, 1 year), type (violent, property, all) and time of day (any, daylight, after dark). Zoom in past level 16 to see individual incidents.
- **Area rating** for the dashed circle at the middle of the map (200 m radius): how it ranks against the rest of the city, with counts by crime type.
- **When it last happened:** each area and route shows how long ago the most recent incident was ("Last reported: 4 weeks ago"). For areas, this looks back a full year even if you picked a shorter period, so a quiet spot still tells you when something last happened.
- **Clickable incidents:** click a dot on the map (zoom 16+) or a row in the card's incident list. The card shows the type, description, exact date and time, street, and a link to the unmodified police record. A ring marks the incident on the map.
- **Route rating** on Google's directions pages: once a start and end are set, it fetches an on-foot route between them (OpenStreetMap routing), colors it green to red by nearby incident density, and summarizes it. This is an approximation of Google's line, not a copy of it.
- **Full heatmap page** (button in the card, or the toolbar icon on any other tab): a dedicated page with a large map, filters, counts by crime type, an hour-of-day chart, the most recent incidents, and a section explaining where the data comes from, how ratings are computed and what they cannot tell you. Every dot links to its raw RPD record, the header shows the live record count with a link that asks RPD's server for the same count, and the filtered incidents can be downloaded as CSV.

## Data

- Incidents: RPD "Part I Crime, 2011 to Present" ArcGIS layer (`maps.cityofrochester.gov`). The extension pulls the last 365 days and caches them for 3 hours.
- Rape is excluded from the public data. Records are preliminary and unverified.
- Ratings compare against a 200 m grid over the urban part of the city, using the same filters. Scores weight homicide, robbery and aggravated assault far above property crime. Weights are in `lib/score.js`.

## How the overlay lines up with the map

Google Maps has no overlay API for extensions. The content script reads the map center and zoom from the URL (`/@lat,lng,15z`) and projects incidents onto a canvas with the standard Web Mercator formula. Google only updates the URL after a pan or zoom ends, so the overlay hides while you drag and reappears when the map settles.

## Limits

- Only works when the URL has a `z` zoom value. Satellite or 3D views use an altitude in meters instead, and the overlay stays blank there.
- No data outside the City of Rochester. Suburbs (Brighton, Greece, Irondequoit) are separate agencies.
- Crime counts reflect reporting and policing patterns, not a guarantee of safety.
- Clicking a dot also lets Google Maps handle the click, so its own pin or place card may appear too.
- The full heatmap page uses OpenStreetMap tiles, falling back to Esri's gray map if those are refused.
- Not tested on other browsers. Apple Maps has no extension hook.

## Development

- `node test/smoke.js` runs the fetch, filter, scoring and route logic against live data.
- The heatmap page (`heatmap.html`) also runs from any static server (for example `python3 -m http.server`), falling back to `localStorage` and direct fetches when the extension APIs are missing.
- `lib/score.js`, `lib/data.js` and `lib/format.js` have no DOM dependencies.
- Adding a city means adding a data adapter that returns `{ id, t, h, c, d, s, lat, lng }` rows, plus a coverage box.

## Next ideas

- Lit-path and greenway layer from OpenStreetMap.
- Time-of-day filter based on actual sunset.
- Run route suggestions that avoid hotspots.
- More cities (Chicago, NYC, LA and others publish open incident data).

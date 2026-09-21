# RunSafe

Chrome extension that shows recent reported crime from police open data as a heatmap on Google Maps, and rates running routes. Covers Rochester, NY and New York City so far.

RunSafe is an independent project. It is not made, checked or endorsed by any police department or city.

## Install

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder. (After pulling changes, click the reload arrow on the RunSafe card, then refresh your Google Maps tab.)
3. Open https://www.google.com/maps and go to Rochester or New York City. A blue RunSafe card appears at the top right.

On Google Maps, the toolbar icon shows or hides the overlay. On any other tab it opens the full heatmap page.

## What it does

- **Heatmap** of reported incidents for the 30 days ending at the newest record, filtered by type (violent, property, all) and time of day (any, daylight, after dark). Zoom in past level 16 to see individual incidents.
- **Area rating** for the dashed circle at the middle of the map (200 m radius): how it ranks against the rest of the same city, with counts by crime type.
- **Last reported:** a live lookup of the most recent incident within 200 m, over the whole dataset, so a quiet spot still says when something last happened.
- **Clickable incidents:** click a dot on the map (zoom 16+) or a row in the card's list to see the type, description, exact date and time, and a link to the unmodified police record.
- **Route rating** on Google's directions pages: it fetches an approximate on-foot route between your start and end (OpenStreetMap routing), colors it green to red by nearby incident density, and summarizes it.
- **Clear states:** the card says when data is loading, when the source is unreachable, and when an area is not covered yet (with a link to request it as a GitHub issue).
- **Freshness warning:** if a source's newest record is more than a week old, the card says so and words "last" times as "last in the data".
- **Full heatmap page** (button in the card): a large map with the same filters, a city switcher, counts by crime type, an hour-of-day chart, the most recent incidents, CSV download, and a section on where the data comes from and what it cannot tell you. Every dot links to its raw record, and the header shows a live citywide record count with a link that asks the data server the same question.

## How data is loaded

Nothing about incidents is stored on the computer. When you open a covered area:

1. The overlay asks the background worker for the newest record date of that area's source.
2. It then asks for the incidents inside the visible map (plus a margin) for the 30 days ending at that date, and one small per-cell count table for the whole city, used only for ratings.
3. Filtering, scoring and drawing happen in the tab, in memory. Panning within the loaded margin makes no new request; moving far or changing the type or time filter does. A tab that has been open for 10 minutes reloads on its next move.
4. Only your filter choices are saved in the browser.

## Sources

| Area | Agency | Dataset | Notes |
|---|---|---|---|
| Rochester, NY | Rochester Police Department | Part I Crime (ArcGIS) | Data is a day or two behind. Rape is excluded from the public data. |
| New York City | NYPD | Complaint Data Current Year To Date (Socrata) | Published with a delay of weeks to months. Rape, sex crimes, harassment, drugs and similar offenses are left out. Suspect and victim fields are never loaded. |

Ratings only compare places within the same city. Different departments define and count crimes differently, so do not compare one city with another.

## How the overlay lines up with the map

Google Maps has no overlay API for extensions. The content script reads the map center and zoom from the URL (`/@lat,lng,15z`) and projects incidents onto a canvas with the standard Web Mercator formula. Google only updates the URL after a pan or zoom ends, so the overlay hides while you drag and reappears when the map settles.

## Limits

- Only works when the URL has a `z` zoom value. Satellite or 3D views use an altitude in meters instead, and the overlay stays blank there.
- No data outside the covered areas. Suburbs are separate agencies. The New York coverage box also overlaps nearby New Jersey, where NYPD data does not apply.
- Crime counts reflect reporting and policing patterns, not a guarantee of safety.
- Clicking a dot also lets Google Maps handle the click, so its own pin or place card may appear too.
- The full heatmap page uses OpenStreetMap tiles, falling back to Esri's gray map if those are refused.
- The free OpenStreetMap routing server is meant for light use.
- Not tested on other browsers. Apple Maps has no extension hook.

## Development

- `node test/smoke.js` runs both adapters against the live data services.
- `node test/live.test.js` checks the load-on-demand logic (small pans, far pans, filter changes, city changes, stale requests, failures).
- `node test/background.test.js` loads the background worker with a fake `chrome`, and checks the manifest against the code.
- `test/overlay.html` runs the real overlay code on a plain page for manual checks: serve the folder (for example `python3 -m http.server`) and open `test/overlay.html?/maps/@40.758,-73.9855,15z`.
- `lib/score.js`, `lib/format.js`, `lib/sources.js`, `lib/adapters.js` and `lib/live.js` have no dependency on the browser extension APIs.

### Adding an area

1. Add an entry to `lib/sources.js`: bounds, portal and dataset links, the data system (`arcgis` or `socrata`), the fields, and for Socrata the offense-to-category map.
2. Add its host to `host_permissions` in `manifest.json` (the background test fails if you forget).
3. If it uses a new data system, add an adapter to `lib/adapters.js` that answers `newest`, `window`, `reference`, `last` and `count`.
4. Run the tests, and check the offense mapping by hand before setting `verified: true`.

## Next ideas

- Find sources automatically for places that are not configured yet, then review them.
- Rate the place you click in Google Maps, not only the map center.
- Lit-path and greenway layer from OpenStreetMap.
- A shared caching service if many people use it.

# San Diego County Housing Access dashboard

An operations prototype for a government affordable-homeownership program. The dashboard now
includes an application review queue and the original interactive San Diego County affordability
map. It is built with plain HTML, CSS, and JavaScript and has no build step.

All applicant records included in the repository are fictional demonstration records. The HLB
source records used for the map are synthetic households, not identifiable people.

## Application management

The default view gives program staff a working application queue with:

- Search, status, household-size, and priority filters.
- A complete household panel with reviewer-controlled document verification.
- Reviewer notes and workflow actions for `New`, `In review`, `Needs info`, and `Approved`.
- A manual-intake form for paper, phone, or partner-assisted applications.
- Device-local persistence for demo status changes, notes, and newly added records.
- Keyboard-accessible queue rows, responsive layouts, and clear data-use warnings.

### Explainable review order

Priority is a transparent 100-point review-order score, not an eligibility or approval model:

| Factor | Maximum | What it measures |
|---|---:|---|
| Financial gap | 40 | Reported income compared with the modeled household living budget |
| Housing instability | 30 | Homelessness, eviction risk, temporary housing, or severe rent burden |
| Household needs | 18 | Children, very young children, single caregivers, and larger households |
| Time waiting | 12 | One point per completed week, capped at twelve weeks |

Name, preferred language, geography, and protected characteristics do not affect the score. Every
factor is shown to the reviewer. The prototype never automatically approves, denies, or determines
eligibility, and approval is disabled until all required documents and a reviewer note are present.

## Site planning map

- **Color** = the % of households in that PUMA that are economically vulnerable
  (`economically_vulnerable` density — i.e. the vulnerability *rate*, not a raw headcount, so
  large and small PUMAs are comparable).
- **Hover** = a tooltip with the PUMA name, vulnerability rate, household counts, median income,
  and median required income.
- **Click/hover** also updates the detail panel on the right with the same figures plus the
  median annual income gap for vulnerable households in that area.

## Project structure

```
.
├── index.html                 # accessible application shell and views
├── assets/
│   ├── app.js                 # review workflow, priority logic, and map behavior
│   └── styles.css             # responsive dashboard design
├── data/
│   ├── applications.json      # fictional application records for the prototype
│   └── puma_stats.json        # small (22-row) precomputed PUMA-level summary
├── scripts/
│   └── build_data.py          # regenerates data/puma_stats.json from the raw CSV
└── README.md
```

The full ~175MB source CSV never ships in this repo or the browser — only the small aggregated
JSON does. PUMA *boundaries* (the map shapes) are **not** stored in the repo either; `assets/app.js`
fetches them when the map opens, using the U.S. Census Bureau's public TIGERweb ArcGIS REST API.

## Running it locally

You need to serve the folder over HTTP — opening `index.html` directly (`file://`) will fail,
because browsers block `fetch()` of local files from a `file://` origin.

```bash
cd affordability-dashboard
python3 -m http.server 8000
# then open http://localhost:8000 in a browser
```

Any static server works (`npx serve`, VS Code's "Live Server" extension, etc.) — it just has to
be `http://`, not `file://`.

## Regenerating the data

If you get an updated CSV, or want to add more metrics to the tooltip:

```bash
pip install pandas
python scripts/build_data.py /path/to/san_diego_ca_hlb_hackathon_2024_20260811.csv
```

This overwrites `data/puma_stats.json`. Commit the updated file — nothing else needs to change.


## Data notes / caveats

- Every row in the source dataset is a *synthetic* household (ACS + PUMS based) — valid for
  distributions and patterns, not individual cases.
- Vulnerability rate is `hh_income < hlb_year`, aggregated per PUMA after dropping the 5 census
  tracts flagged as statistically unreliable (< 100 sampled households) in the data dictionary.
- `housing_cost_month` (baked into `median_hlb_year`) is *required* market rent, not rent
  actually paid — it's an imputed value for homeowners too.
- PUMA boundaries are fetched live from Census TIGERweb when the map opens. If your network blocks
  `tigerweb.geo.census.gov` (some corporate/campus wifi does), the map won't render — the page
  will show an error message explaining this. Workaround: download the GeoJSON once from
  [the TIGERweb query API](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/0)
  and swap the `fetch(geoUrl)` call in `assets/app.js` for a local file.

## Tech

Plain HTML/CSS/JS + [Plotly.js](https://plotly.com/javascript/) (loaded from CDN) for the map —
no build step, no npm install, no framework. `scripts/build_data.py` is the only place pandas is
used, and it only runs when you regenerate the data.

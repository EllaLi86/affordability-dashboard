# San Diego County Housing Access dashboard

An operations prototype for a government affordable-homeownership program. The dashboard now
includes an application review queue and the original interactive San Diego County affordability
map. It is built with plain HTML, CSS, and JavaScript and has no build step.

All applicant records included in the repository are fictional demonstration records. The HLB
source records used for the map are synthetic households, not identifiable people.

## Application management

The default view gives program staff a working application queue with:

- Search, status, household-size, and eligibility-result filters.
- A complete household panel with reviewer-controlled document verification.
- Reviewer notes and workflow actions for `New`, `In review`, `Needs info`, and `Eligible`.
- A manual-intake form for paper, phone, or partner-assisted applications.
- Device-local persistence for demo status changes, notes, and newly added records.
- Keyboard-accessible queue rows, responsive layouts, and clear data-use warnings.

### Explainable eligibility pre-screen

The dashboard uses independent, visible checks instead of an urgency score or opaque ranking:

| Draft rule | What it checks |
|---|---|
| Income fit | Reported income is below the modeled household living budget |
| County residency | Accepted San Diego County residency evidence is verified |
| Property ownership | The household does not already own a suitable residential property |
| Primary residence | The purchased home will be the household's primary residence |
| Household and unit fit | Household size fits the family-sized homes currently planned |
| Purchase readiness | A financing, assistance, or homebuyer-counseling pathway is confirmed |
| Evidence complete | Identity, income, residency, ownership, and purchase-readiness evidence is verified |

The result is `Likely eligible`, `Needs verification`, or `Policy review`. The prototype never
automatically approves or denies. A reviewer must verify every required document and save an
eligibility note before marking a household eligible. Name, preferred language, race, gender,
disability, and other protected characteristics are not used.

The HLB comparison is a prototype screening rule, not an adopted legal income standard. A real
program must replace it with criteria approved by housing counsel, such as the program's adopted
AMI limits, ownership exceptions, occupancy rules, and resale restrictions.

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
│   ├── app.js                 # eligibility workflow, review rules, and map behavior
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

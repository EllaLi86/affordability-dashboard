# San Diego County Housing Access dashboard

An operations prototype for a government affordable-housing matching program. The dashboard
supports the full `TARGET → MATCH → APPLY → TRACK` journey: identify high-need communities,
review applicant information, compare potential properties, resolve missing documents, and track
applications through placement. It is built with plain HTML, CSS, and JavaScript and has no build
step.

All applicant records included in the repository are fictional demonstration records. The HLB
source records used for the map are synthetic households, not identifiable people.

## Application management

The default view gives program staff a high-volume case-management queue with:

- Search plus priority, household-size, workflow-stage, bedroom, document, and match filters.
- Plain-language income, Household Living Budget, and annual affordability-gap context.
- A complete applicant panel with next actions and reviewer-controlled document verification.
- Potential property matches with explainable income, occupancy, bedroom, location, and evidence checks.
- Workflow stages from `New` and `Ready to match` through property submission, waitlist, and `Housed`.
- A manual-intake form for paper, phone, or partner-assisted applications.
- Device-local persistence for demo status changes, notes, and newly added records.
- Keyboard-accessible queue rows, responsive layouts, and clear data-use warnings.

### Priority and property eligibility are separate

Priority helps staff decide which case to review first. It uses financial gap, housing instability,
household needs, and time waiting, but displays a plain-language category rather than a prominent
number. Priority never decides who receives housing.

Potential property matches compare applicant information with each property's published criteria:

| Matching factor | What it checks |
|---|---|
| Income | Reported income is compared with the property's published income limit |
| Occupancy | Household size fits the property's minimum and maximum occupancy rules |
| Bedroom need | The unit has enough bedrooms for the household's stated need |
| Location | The property is compared with the applicant's preferred area |
| Evidence | Missing income or application documents remain visible to staff |
| Availability | The property shows whether applications or its waitlist are open |

Results use cautious labels such as `Potential match`, `Likely eligible`, `Verification required`,
and `Not suitable`, always with a reason. These are staff decision aids—not approvals, denials, or
final eligibility findings. HLB remains context for affordability need and does not replace a
property's formal income requirements.

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
│   ├── app.js                 # case workflow, matching rules, priority support, and map behavior
│   └── styles.css             # responsive dashboard design
├── data/
│   ├── applications.json      # fictional application records for the prototype
│   ├── properties.json        # fictional properties and published matching criteria
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

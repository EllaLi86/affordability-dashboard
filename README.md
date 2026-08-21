# San Diego County affordability dashboard

Interactive choropleth map of San Diego County, colored by the share of households that are
**economically vulnerable** (income below the basic-needs budget required to live in that area),
by PUMA (Public Use Microdata Area). Hover any area to see its vulnerability rate and other
stats. Built from the San Diego HLB Hackathon 2024 dataset.

**[Live dashboard →](#)** *(fill in your GitHub Pages URL once deployed — see below)*

## What it shows

- **Color** = the % of households in that PUMA that are economically vulnerable
  (`economically_vulnerable` density — i.e. the vulnerability *rate*, not a raw headcount, so
  large and small PUMAs are comparable).
- **Hover** = a tooltip with the PUMA name, vulnerability rate, household counts, median income,
  and median required income.
- **Click/hover** also updates the detail panel on the right with the same figures plus the
  median annual income gap for vulnerable households in that area.
- **Vulnerability rank vs. low-mid income rank** — a scatter chart comparing each PUMA's rank by
  raw vulnerability against its rank by low-mid income priority, showing which areas move once you
  shift focus from "most vulnerable overall" to "closest to self-sufficient."
- **Age composition** — real Census age data for our low-mid income target PUMA (Rancho Bernardo &
  Poway), used to inform outreach method (mail vs. digital).

## Project structure

```
```
.
├── index.html                       # the whole dashboard (Plotly.js + Chart.js + vanilla JS, no build step)
├── data/
│   ├── puma_stats.json              # precomputed PUMA-level summary
│   ├── low_mid_income_priority.json # PUMAs ranked by low-mid income (near-miss) priority
│   └── tract_age_demographics.json  # real Census age data for Rancho Bernardo & Poway tracts
├── scripts/
│   ├── build_data.py                # regenerates data/puma_stats.json from the raw CSV
│   ├── build_tract_affordability.py # regenerates census-tract-level affordability stats
│   ├── rank_low_mid_income.py       # regenerates data/low_mid_income_priority.json
│   └── fetch_age_demographics.py    # regenerates data/tract_age_demographics.json (needs a Census API key)
└── README.md
```
```

The full ~175MB source CSV never ships in this repo or the browser — only the small aggregated
JSON does. PUMA *boundaries* (the map shapes) are **not** stored in the repo either; `index.html`
fetches them live, in the browser, from the U.S. Census Bureau's public TIGERweb ArcGIS REST API.

## Running it locally

You need to serve the folder over HTTP — opening `index.html` directly (`file://`) will fail,
because browsers block `fetch()` of local files from a `file://` origin.

```bash
cd san-diego-affordability-dashboard
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

## Additional targeting views

Two more lenses beyond the base vulnerability map:

- **Low-mid income priority** (`data/low_mid_income_priority.json`) — PUMAs re-ranked by share of
  "near-miss" households (80–100% of required income) instead of raw vulnerability rate, since
  near-miss households are less likely to already be served by existing low-income assistance.
  Chula Vista (West) & National City — our #1 priority PUMA by raw vulnerability — actually ranks
  **last (#22)** here, since its vulnerable households are mostly deep-need, not near-miss.
  Rancho Bernardo & Poway ranks #1 instead (28.3% near-miss share).
- **Age composition** (`data/tract_age_demographics.json`) — real Census ACS 5-Year age data
  (table S0101) for Rancho Bernardo & Poway specifically, our #1 priority PUMA for a low-mid
  income program, since the synthetic HLB dataset has no real age breakdown. Used to inform
  outreach method (mail vs. digital) there.

```bash
python scripts/rank_low_mid_income.py /path/to/san_diego_ca_hlb_hackathon_2024_20260811.csv
```

This overwrites `data/low_mid_income_priority.json`.

```bash
python scripts/fetch_age_demographics.py --api-key YOUR_CENSUS_API_KEY
```

Requires a free [Census API key](https://api.census.gov/data/key_signup.html) and
`tract_level_affordability.csv` (regenerate with `scripts/build_tract_affordability.py` if
missing). Overwrites `data/tract_age_demographics.json`. Add `--puma 07330` to target a different
PUMA instead of the default (Rancho Bernardo & Poway).

## Data notes / caveats

- Every row in the source dataset is a *synthetic* household (ACS + PUMS based) — valid for
  distributions and patterns, not individual cases.
- Vulnerability rate is `hh_income < hlb_year`, aggregated per PUMA after dropping the 5 census
  tracts flagged as statistically unreliable (< 100 sampled households) in the data dictionary.
- `housing_cost_month` (baked into `median_hlb_year`) is *required* market rent, not rent
  actually paid — it's an imputed value for homeowners too.
- PUMA boundaries are fetched live from Census TIGERweb at load time. If your network blocks
  `tigerweb.geo.census.gov` (some corporate/campus wifi does), the map won't render — the page
  will show an error message explaining this. Workaround: download the GeoJSON once from
  [the TIGERweb query API](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/0)
  and swap the `fetch(geoUrl)` call in `index.html` for a local file.

## Tech

Plain HTML/CSS/JS + [Plotly.js](https://plotly.com/javascript/) (loaded from CDN) for the map —
no build step, no npm install, no framework. `scripts/build_data.py` is the only place pandas is
used, and it only runs when you regenerate the data.

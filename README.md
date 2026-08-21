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

## Mortgage and purchase-assistance matching

The Mortgage matching view focuses on first-time buyers in the program's intended low-to-moderate
income segment: households with stable income that may support homeownership, but that still face a
purchase-price or upfront-cash gap in San Diego's market. It gives staff:

- A one-to-one link back to the main program application through `applicationId`; household income,
  household composition, documents, and workflow stage are read from that application record.
- A searchable buyer pipeline with 80%–120% and 120%–150% AMI filters.
- Buyer-readiness checks for income evidence, homebuyer education, and participating-lender
  preapproval.
- A transparent affordability-bridge estimate with an editable planning rate, target price,
  estimated price capacity, purchase gap, and upfront-cash gap.
- Preliminary matches to official local, state, and federal purchase-assistance or mortgage
  programs, with the reason, preparation steps, and a direct link to current official requirements.
- A clear recommended staff action for moving each buyer toward a verified program submission.

The calculations and matches are planning support only. They do not produce a credit decision,
preapproval, loan estimate, final program-eligibility determination, or promise of funding. Staff
must verify the target property's exact jurisdiction and current program rules with the administering
agency or a participating lender. An applicant appears in this pipeline only when the main
application has `financingPath: "mortgage-matching"` and a corresponding buyer profile. Other
applications remain in ownership and financing review; absence from Mortgage matching is not a
denial.

## Outreach planning

The Outreach view turns the full Household Living Budget synthetic population into an anonymous
campaign-planning audience. It does not claim that the rows are real people or provide contact
information. The default `Market first` audience is defined transparently as:

- Exactly four or five household members.
- Modeled annual household income from $75,000 through $150,000.
- Income below that row's modeled Household Living Budget, while covering at least 50% of it.

This prototype rule targets the team's intended low-to-middle-income, family-sized ownership
segment: households with meaningful income that remain priced out. It is not an official AMI band,
program eligibility rule, urgency score, or permission to contact anyone. The dashboard displays a
small deterministic sample across all 22 PUMAs, full modeled audience counts, broad channel ideas,
area concentrations, filters, and device-local campaign-planning statuses.

The market-first population is split into six mutually exclusive marketing groups by life stage and
campaign income band: young families with a child under six, school-age families, and adult-only
households, each split into $75,000–$110,000 and $110,000–$150,000 modeled-income groups. Each group
has its own audience size, top planning areas, recommended community channel, and message. These
descriptions use household composition only; they do not claim family relationships that the
synthetic dataset does not contain.

Staff can add entire groups to a device-local Mailing & Partner List plan, see the combined modeled
reach and number of channel plans, remove groups, and move representative rows through `Not on
list`, `Mailing plan`, and `Partner list` stages. This workflow does not create a real mailing list:
the synthetic source contains no names, addresses, email, phone, or contact consent. Production use
would require a separate authorized contact system to match consented residents to the selected
audience definitions.

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
│   ├── app.js                 # case workflow, mortgage matching, priority support, and map behavior
│   └── styles.css             # responsive dashboard design
├── data/
│   ├── applications.json      # fictional application records for the prototype
│   ├── buyer_profiles.json     # fictional buyer-readiness and purchase-planning inputs
│   ├── mortgage_programs.json  # published program features and official source links
│   ├── outreach_households.json # modeled counts and representative synthetic outreach rows
│   ├── properties.json        # fictional properties and published matching criteria
│   └── puma_stats.json        # small (22-row) precomputed PUMA-level summary
├── scripts/
│   ├── build_data.py          # regenerates data/puma_stats.json from the raw CSV
│   └── build_outreach_data.py # regenerates the compact outreach-planning dataset
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

To regenerate the outreach audience from the same source CSV:

```bash
python scripts/build_outreach_data.py /path/to/san_diego_ca_hlb_hackathon_2024_20260811.csv
```


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

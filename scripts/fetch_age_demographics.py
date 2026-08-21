"""
fetch_age_demographics.py

Pulls REAL (not synthetic) age-distribution data for San Diego County census
tracts from the Census Bureau's American Community Survey (ACS 5-Year,
Table S0101 "Age and Sex"), then filters down to PUMA 07330 (Chula Vista
West & National City) -- the most economically vulnerable PUMA in the HLB
dataset (63.0% vulnerable, the highest of any San Diego area).

Why this table/dataset: the HLB synthetic data only tells us a household has
"19+ adults" -- no real age breakdown, which we need for an actual mail vs.
digital outreach decision. The Census Bureau's real ACS data fills that gap.

Why Chula Vista specifically: it's our #1 priority target (highest
vulnerability rate + largest raw count of vulnerable households), so that's
where we're starting the age/outreach analysis. If we later want other
areas, change CHULA_VISTA_ONLY to False below to keep all 732 tracts.

Get a free API key (required as of 2026) at:
    https://api.census.gov/data/key_signup.html

Usage:
    python3 fetch_age_demographics.py --api-key YOUR_KEY_HERE

Outputs:
    tract_age_demographics.csv        -- raw ACS pull (all San Diego County tracts)
    tract_level_with_demographics.csv -- merged with tract_level_affordability.csv,
                                          filtered to Chula Vista tracts only
"""

import argparse
import json
import requests
import pandas as pd

# San Diego County FIPS codes
STATE_FIPS = "06"
COUNTY_FIPS = "073"

ACS_YEAR = "2023"  # most recent 5-year release with full tract coverage at time of writing

# Set to False if you later want ALL San Diego County tracts instead of just Chula Vista
CHULA_VISTA_ONLY = True

# The 40 census tracts inside PUMA 07330 (Chula Vista West & National City).
CHULA_VISTA_TRACTS = [
    "003204", "011601", "011602", "011700", "011801", "011802", "011902",
    "012002", "012003", "012101", "012102", "012200", "012302", "012303",
    "012304", "012401", "012402", "012501", "012502", "012600", "012700",
    "012800", "012900", "013000", "013102", "013103", "013104", "013203",
    "013204", "013205", "013206", "013301", "013302", "013303", "013306",
    "013307", "013308", "013401", "021900", "022000",
]

# S0101 "Percent" columns (C02) give pre-computed percentages, so no manual math needed.
# Full variable list: https://api.census.gov/data/2023/acs/acs5/subject/groups/S0101.html
VARS = {
    "S0101_C01_001E": "total_population",
    "S0101_C02_023E": "pct_age_18_24",     # SELECTED AGE CATEGORIES: 18 to 24 years
    "S0101_C02_026E": "pct_age_18_plus",   # SELECTED AGE CATEGORIES: 18 years and over
    "S0101_C02_030E": "pct_age_65_plus",   # SELECTED AGE CATEGORIES: 65 years and over
    "S0101_C01_032E": "median_age",
}


def fetch_acs_age_data(api_key: str) -> pd.DataFrame:
    var_codes = ",".join(VARS.keys())
    # Census API doesn't support filtering to a specific list of tracts in one
    # call, so we pull the whole county (still a single fast call) and filter
    # down to just Chula Vista afterward, below.
    url = (
        f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5/subject"
        f"?get=NAME,{var_codes}"
        f"&for=tract:*"
        f"&in=state:{STATE_FIPS}+county:{COUNTY_FIPS}"
        f"&key={api_key}"
    )

    resp = requests.get(url, timeout=30)
    if resp.status_code != 200:
        print(f"Census API returned HTTP {resp.status_code}")
        print(f"Response body (first 500 chars):\n{resp.text[:500]}")
        resp.raise_for_status()
    try:
        rows = resp.json()
    except ValueError:
        print("Census API did not return valid JSON. Raw response (first 500 chars):")
        print(resp.text[:500])
        raise

    header, *data_rows = rows
    df = pd.DataFrame(data_rows, columns=header)

    # build the same GEOID format used in the HLB dataset: state+county+tract, 11 digits
    df["geoid"] = df["state"] + df["county"] + df["tract"]

    df = df.rename(columns=VARS)
    numeric_cols = list(VARS.values())
    for c in numeric_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # --- Chula Vista filter ---
    # This is the only real difference from a "pull everything" script: we
    # narrow down to our #1 priority PUMA (07330, Chula Vista West & National
    # City) right here, right after the raw pull. Flip CHULA_VISTA_ONLY to
    # False at the top of this file to skip this and keep all 732 tracts.
    if CHULA_VISTA_ONLY:
        df = df[df["tract"].isin(CHULA_VISTA_TRACTS)].copy()

    # Outreach-lean heuristic (not a precise prediction). Uses 65+ share of
    # ADULTS specifically, not 65+ vs 18-24, so working-age-heavy tracts
    # aren't mislabeled as "mail-leaning."
    df["pct_65_plus_of_adults"] = (df["pct_age_65_plus"] / df["pct_age_18_plus"] * 100).round(1)
    df["outreach_lean"] = df["pct_65_plus_of_adults"].apply(
        lambda v: "mail-leaning" if v >= 20 else "digital-leaning"
    )

    return df[["geoid", "NAME", "total_population", "median_age",
               "pct_age_18_24", "pct_age_65_plus", "pct_65_plus_of_adults",
               "outreach_lean"]].sort_values("geoid")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True, help="Census API key (required as of 2026)")
    parser.add_argument("--merge-with", default="tract_level_affordability.csv",
                         help="Existing tract-level CSV to merge onto (skipped if not found)")
    args = parser.parse_args()

    age_df = fetch_acs_age_data(args.api_key)
    age_df.to_csv("tract_age_demographics.csv", index=False)
    scope = "Chula Vista / National City tracts" if CHULA_VISTA_ONLY else "San Diego County tracts"
    print(f"Wrote tract_age_demographics.csv ({len(age_df)} {scope})")

    lean_counts = age_df["outreach_lean"].value_counts()
    print(f"\nOutreach lean breakdown:")
    print(lean_counts.to_string())

    try:
        base = pd.read_csv(args.merge_with, dtype={"geoid": str})
        age_df["geoid"] = age_df["geoid"].astype(str)
        merged = base.merge(age_df.drop(columns=["NAME"]), on="geoid", how="inner")
        merged = merged.sort_values("priority_rank")
        merged.to_csv("tract_level_with_demographics.csv", index=False)

        # JSON export -- this is what the dashboard chart reads, with ALL
        # Chula Vista tracts (not a hardcoded sample), sorted by priority.
        json_cols = ["geoid", "priority_rank", "vulnerability_rate", "n_vulnerable",
                     "median_age", "pct_age_18_24", "pct_age_65_plus",
                     "pct_65_plus_of_adults", "outreach_lean"]
        with open("tract_age_demographics.json", "w") as f:
            json.dump(merged[json_cols].to_dict(orient="records"), f, indent=2)

        print(f"\nWrote tract_level_with_demographics.csv "
              f"({len(merged)} tracts, sorted by priority_rank)")
        print(f"Wrote tract_age_demographics.json (same {len(merged)} tracts, for the dashboard chart)")
        print(merged[["geoid", "priority_rank", "vulnerability_rate",
                       "n_vulnerable", "median_age", "pct_age_65_plus",
                       "pct_age_18_24", "outreach_lean"]].head(10).to_string(index=False))
    except FileNotFoundError:
        print(f"\n{args.merge_with} not found -- skipping merge, "
              f"tract_age_demographics.csv is still ready to use on its own")


if __name__ == "__main__":
    main()
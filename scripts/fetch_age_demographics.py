"""
fetch_age_demographics.py

Pulls REAL (not synthetic) age-distribution data for San Diego County census
tracts from the Census Bureau's American Community Survey (ACS 5-Year,
Table S0101 "Age and Sex"), then filters down to a target PUMA -- by default,
Chula Vista (West) & National City (07330), the single most economically
vulnerable PUMA in San Diego County (63.0% vulnerability rate, the highest
of any PUMA and the largest raw count of vulnerable households).

Why this table/dataset: the HLB synthetic data only tells us a household has
"19+ adults" -- no real age breakdown, which we need for an actual mail vs.
digital outreach decision. The Census Bureau's real ACS data fills that gap.

Get a free API key (required as of 2026) at:
    https://api.census.gov/data/key_signup.html

Usage:
    python3 fetch_age_demographics.py --api-key YOUR_KEY_HERE
    python3 fetch_age_demographics.py --api-key YOUR_KEY_HERE --puma 07308  # target a different PUMA

Outputs:
    data/tract_age_demographics.json  -- data for the target PUMA, feeds the dashboard chart
"""

import argparse
import json
import requests
import pandas as pd

# San Diego County FIPS codes
STATE_FIPS = "06"
COUNTY_FIPS = "073"

ACS_YEAR = "2023"  # most recent 5-year release with full tract coverage at time of writing

# Default target: Chula Vista (West) & National City -- the single most
# economically vulnerable PUMA in San Diego County (63.0% vulnerability
# rate, highest of any PUMA, and the largest raw count of vulnerable
# households: 35,545). Override with --puma to target a different PUMA.
DEFAULT_PUMA = "07330"

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


def get_puma_tracts(merge_with_path: str, puma: str) -> list:
    """Look up which census tracts belong to a given PUMA, using the
    tract-level CSV (which already has a puma column) instead of a
    hardcoded tract list."""
    base = pd.read_csv(merge_with_path, dtype={"geoid": str, "puma": str})
    return base[base["puma"] == puma]["geoid"].tolist()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True, help="Census API key (required as of 2026)")
    parser.add_argument("--puma", default=DEFAULT_PUMA,
                         help=f"PUMA code to filter to (default: {DEFAULT_PUMA}, Chula Vista West & National City)")
    parser.add_argument("--merge-with", default="tract_level_affordability.csv",
                         help="Existing tract-level CSV to merge onto (skipped if not found)")
    args = parser.parse_args()

    age_df = fetch_acs_age_data(args.api_key)
    print(f"Pulled ACS data for {len(age_df)} San Diego County tracts")

    try:
        puma_tracts = get_puma_tracts(args.merge_with, args.puma)
        age_df_filtered = age_df[age_df["geoid"].isin(puma_tracts)].copy()
    except FileNotFoundError:
        print(f"\n{args.merge_with} not found -- can't filter to PUMA {args.puma}")
        return

    lean_counts = age_df_filtered["outreach_lean"].value_counts()
    print(f"\nPUMA {args.puma}: {len(age_df_filtered)} tracts")
    print("Outreach lean breakdown:")
    print(lean_counts.to_string())

    base = pd.read_csv(args.merge_with, dtype={"geoid": str})
    merged = base.merge(age_df_filtered.drop(columns=["NAME"]), on="geoid", how="inner")
    merged = merged.sort_values("priority_rank")

    json_cols = ["geoid", "priority_rank", "vulnerability_rate", "n_vulnerable",
                 "median_age", "pct_age_18_24", "pct_age_65_plus",
                 "pct_65_plus_of_adults", "outreach_lean"]
    with open("data/tract_age_demographics.json", "w") as f:
        json.dump(merged[json_cols].to_dict(orient="records"), f, indent=2)

    print(f"\nWrote data/tract_age_demographics.json ({len(merged)} tracts, sorted by priority_rank)")
    print(merged[["geoid", "priority_rank", "vulnerability_rate",
                   "n_vulnerable", "median_age", "pct_age_65_plus",
                   "pct_age_18_24", "outreach_lean"]].head(10).to_string(index=False))


if __name__ == "__main__":
    main()
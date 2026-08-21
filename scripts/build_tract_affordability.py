"""
build_tract_affordability.py

Aggregates the San Diego HLB household-level dataset up to census-tract level,
producing one row per tract with the stats needed to drive a targeting/outreach
dashboard: vulnerability rate, household composition, cost drivers, and a
priority score for outreach.

Usage:
    python build_tract_affordability.py

Expects, in the same folder (or edit MAIN_CSV below):
    san_diego_ca_hlb_hackathon_2024_20260811.csv

Outputs:
    tract_level_affordability.csv
"""

import pandas as pd
import numpy as np

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MAIN_CSV = "san_diego_ca_hlb_hackathon_2024_20260811.csv"
OUTPUT_CSV = "tract_level_affordability.csv"

# A tract with fewer sampled households than this is flagged low-confidence.
# 30 is a common rule-of-thumb minimum sample size; raise it if you want to
# be more conservative, lower it if you want more tracts included.
MIN_RELIABLE_HOUSEHOLDS = 30

COST_COLS = [
    "food_cost_month",
    "childcare_cost_month",
    "housing_cost_month",
    "transp_cost_month",
    "broadband_cost_month",
    "healthcare_cost_month",
    "other_cost_month",
]


def load_data(path: str) -> pd.DataFrame:
    dtype_map = {
        "synpop_hh_id": "int64",
        "geoid": "string",
        "puma": "string",
        "hh_income_cat": "category",
        "economically_vulnerable": "int8",
    }
    return pd.read_csv(path, dtype=dtype_map)


def add_household_flags(df: pd.DataFrame) -> pd.DataFrame:
    """Add per-household boolean/derived columns used later for aggregation."""

    young_child_cols = ["no_preschooler", "no_toddler", "no_infant"]
    child_cols = [
        "no_teenager", "no_schooler", "no_preschooler", "no_toddler", "no_infant",
    ]

    df["has_young_child"] = df[young_child_cols].sum(axis=1) > 0
    df["has_children"] = df[child_cols].sum(axis=1) > 0
    df["is_single_parent"] = (df["no_adult"] == 1) & (df["has_children"])

    # how far each household is from the required budget income
    df["income_ratio"] = df["hh_income"] / df["hlb_year"]

    # only meaningful for vulnerable households -- among the vulnerable,
    # "near miss" = pretty close to affording it (>=80% of what's required),
    # "deep need" = well short of it (<80%)
    df["is_near_miss"] = (df["economically_vulnerable"] == 1) & (df["income_ratio"] >= 0.8)
    df["is_deep_need"] = (df["economically_vulnerable"] == 1) & (df["income_ratio"] < 0.8)

    # dollar gap to close (0 for non-vulnerable households)
    df["gap"] = np.where(
        df["economically_vulnerable"] == 1, df["hlb_year"] - df["hh_income"], 0
    )

    # housing cost as a share of the total monthly budget, per household
    df["total_cost_month"] = df[COST_COLS].sum(axis=1)
    df["housing_share_pct"] = df["housing_cost_month"] / df["total_cost_month"] * 100

    # Housing is the #1 cost component in nearly every household, so it's not
    # useful for telling tracts apart. The SECOND-largest cost component is
    # more informative (e.g. childcare vs. transportation-heavy areas).
    ranked = df[COST_COLS].rank(axis=1, ascending=False, method="first")
    is_second = ranked == 2

    def second_largest_component(row: pd.Series) -> str:
        cols = row.index[row]
        return cols[0].replace("_cost_month", "") if len(cols) else np.nan

    df["second_cost_component"] = is_second.apply(second_largest_component, axis=1)

    return df


def mode_or_na(s: pd.Series):
    m = s.mode()
    return m.iloc[0] if len(m) else np.nan


def aggregate_to_tract(df: pd.DataFrame) -> pd.DataFrame:
    tract = df.groupby("geoid").agg(
        puma=("puma", "first"),
        n_households=("synpop_hh_id", "count"),
        n_vulnerable=("economically_vulnerable", "sum"),
        vulnerability_rate=("economically_vulnerable", "mean"),
        median_hh_income=("hh_income", "median"),
        median_hlb_year=("hlb_year", "median"),
        median_gap_vulnerable=("gap", lambda s: s[s > 0].median() if (s > 0).any() else 0),
        total_annual_gap=("gap", "sum"),
        avg_hh_size=("hh_size", "mean"),
        avg_housing_share_pct=("housing_share_pct", "mean"),
        pct_single_parent=("is_single_parent", "mean"),
        pct_with_young_child=("has_young_child", "mean"),
        pct_near_miss_of_vulnerable=(
            "is_near_miss",
            lambda s: s.sum() / max(df.loc[s.index, "economically_vulnerable"].sum(), 1),
        ),
        pct_deep_need_of_vulnerable=(
            "is_deep_need",
            lambda s: s.sum() / max(df.loc[s.index, "economically_vulnerable"].sum(), 1),
        ),
        second_cost_driver=("second_cost_component", mode_or_na),
    ).reset_index()

    return tract


def add_priority_and_rounding(tract: pd.DataFrame) -> pd.DataFrame:
    # convert 0-1 rates to 0-100 percentages
    pct_cols = [
        "vulnerability_rate",
        "pct_single_parent",
        "pct_with_young_child",
        "pct_near_miss_of_vulnerable",
        "pct_deep_need_of_vulnerable",
    ]
    for c in pct_cols:
        tract[c] = (tract[c] * 100).round(1)

    tract["avg_housing_share_pct"] = tract["avg_housing_share_pct"].round(1)
    tract["median_hh_income"] = tract["median_hh_income"].round(0)
    tract["median_hlb_year"] = tract["median_hlb_year"].round(0)
    tract["median_gap_vulnerable"] = tract["median_gap_vulnerable"].round(0)
    tract["total_annual_gap"] = tract["total_annual_gap"].round(0)
    tract["avg_hh_size"] = tract["avg_hh_size"].round(2)

    # Priority score: blend of HOW BAD (vulnerability rate) and HOW MANY
    # (raw count of vulnerable households), 50/50 weighted, scaled 0-100.
    # Rationale: a tiny tract at 100% vulnerable matters less to a government
    # outreach team than a large tract at 60% vulnerable with far more
    # affected households -- this score balances both.
    # Feel free to change the 0.5/0.5 weights if your team wants to weight
    # rate vs. raw count differently.
    tract["priority_score"] = (
        (tract["vulnerability_rate"] / tract["vulnerability_rate"].max()) * 0.5
        + (tract["n_vulnerable"] / tract["n_vulnerable"].max()) * 0.5
    ) * 100
    tract["priority_score"] = tract["priority_score"].round(1)
    tract["priority_rank"] = tract["priority_score"].rank(ascending=False, method="min").astype(int)

    tract["reliable_sample"] = tract["n_households"] >= MIN_RELIABLE_HOUSEHOLDS

    return tract


def main():
    df = load_data(MAIN_CSV)
    df = add_household_flags(df)
    tract = aggregate_to_tract(df)
    tract = add_priority_and_rounding(tract)

    tract = tract.sort_values("priority_rank")

    col_order = [
        "geoid", "puma", "priority_rank", "priority_score", "reliable_sample",
        "n_households", "n_vulnerable", "vulnerability_rate",
        "median_hh_income", "median_hlb_year", "median_gap_vulnerable", "total_annual_gap",
        "avg_hh_size", "avg_housing_share_pct", "second_cost_driver",
        "pct_single_parent", "pct_with_young_child",
        "pct_near_miss_of_vulnerable", "pct_deep_need_of_vulnerable",
    ]
    tract = tract[col_order]

    tract.to_csv(OUTPUT_CSV, index=False)

    print(f"Wrote {len(tract)} tracts to {OUTPUT_CSV}")
    print(f"Tracts below reliable-sample threshold ({MIN_RELIABLE_HOUSEHOLDS} hh): "
          f"{(~tract['reliable_sample']).sum()}")
    print()
    print(tract.head(10).to_string(index=False))


if __name__ == "__main__":
    main()
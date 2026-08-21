#!/usr/bin/env python3
"""Build a compact, anonymous outreach-planning dataset from the HLB release."""

from __future__ import annotations

import csv
import heapq
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT_ROOT.parent / "san_diego_ca_hlb_hackathon_2024_20260811.csv"
OUTPUT_PATH = PROJECT_ROOT / "data" / "outreach_households.json"
PUMA_STATS_PATH = PROJECT_ROOT / "data" / "puma_stats.json"

MARKET_FIRST_INCOME_MIN = 75_000
MARKET_FIRST_INCOME_MAX = 150_000
MARKET_FIRST_COVERAGE_MIN = 0.50
NEXT_INCOME_MIN = 60_000
NEXT_INCOME_MAX = 175_000
NEXT_COVERAGE_MIN = 0.40
SAMPLE_LIMITS = {"market-first": 4, "consider-next": 2}


def stable_sample_key(synthetic_id: int) -> int:
    """Small deterministic pseudo-random key for representative sampling."""
    return (synthetic_id * 2_654_435_761) % (2**32)


def audience_tier(size: int, income: float, coverage: float, vulnerable: bool) -> str | None:
    if size not in (4, 5) or not vulnerable:
        return None
    if (
        MARKET_FIRST_INCOME_MIN <= income <= MARKET_FIRST_INCOME_MAX
        and MARKET_FIRST_COVERAGE_MIN <= coverage < 1
    ):
        return "market-first"
    if NEXT_INCOME_MIN <= income <= NEXT_INCOME_MAX and NEXT_COVERAGE_MIN <= coverage < 1:
        return "consider-next"
    return None


def channel_for(row: dict[str, str]) -> tuple[str, str]:
    young_children = sum(int(row[field]) for field in ("no_infant", "no_toddler", "no_preschooler"))
    school_age = int(row["no_schooler"]) + int(row["no_teenager"])
    if young_children:
        return (
            "Family resource partners",
            "Coordinate with childcare providers, family resource centers, and pediatric or parent networks.",
        )
    if school_age:
        return (
            "School & family networks",
            "Use school-family newsletters, district partners, and community education events.",
        )
    return (
        "Community & employer partners",
        "Use neighborhood organizations, workforce partners, and first-time-buyer workshops.",
    )


def make_household(row: dict[str, str], puma_names: dict[str, str], tier: str) -> dict[str, object]:
    income = round(float(row["hh_income"]))
    hlb = round(float(row["hlb_year"]))
    adults = int(row["no_adult"])
    size = int(row["hh_size"])
    channel, channel_reason = channel_for(row)
    return {
        "id": f"SYN-{int(row['synpop_hh_id']):07d}",
        "puma": row["puma"],
        "pumaName": puma_names.get(row["puma"], f"PUMA {row['puma']}"),
        "tract": row["geoid"],
        "householdSize": size,
        "adults": adults,
        "children": max(0, size - adults),
        "income": income,
        "hlb": hlb,
        "annualGap": max(0, hlb - income),
        "coveragePercent": round(income / hlb * 100) if hlb else 0,
        "housingCostMonth": round(float(row["housing_cost_month"])),
        "tier": tier,
        "recommendedChannel": channel,
        "channelReason": channel_reason,
    }


def main() -> None:
    source_path = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source_path.exists():
        raise SystemExit(f"Source CSV not found: {source_path}")

    with PUMA_STATS_PATH.open(encoding="utf-8") as handle:
        puma_stats = json.load(handle)
    puma_names = {item["puma_code"]: item["puma_name"] for item in puma_stats["pumas"]}

    total_rows = 0
    family_rows = 0
    tier_counts: dict[str, int] = defaultdict(int)
    puma_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    target_incomes: list[float] = []
    target_gaps: list[float] = []
    sample_heaps: dict[tuple[str, str], list[tuple[int, dict[str, object]]]] = defaultdict(list)

    with source_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            total_rows += 1
            size = int(row["hh_size"])
            if size not in (4, 5):
                continue
            family_rows += 1
            income = float(row["hh_income"])
            hlb = float(row["hlb_year"])
            coverage = income / hlb if hlb else 0
            tier = audience_tier(size, income, coverage, row["economically_vulnerable"] == "1")
            if not tier:
                continue

            tier_counts[tier] += 1
            puma_counts[row["puma"]][tier] += 1
            if tier == "market-first":
                target_incomes.append(income)
                target_gaps.append(max(0, hlb - income))

            household = make_household(row, puma_names, tier)
            sample_key = stable_sample_key(int(row["synpop_hh_id"]))
            heap_key = (row["puma"], tier)
            heap = sample_heaps[heap_key]
            candidate = (-sample_key, household)
            if len(heap) < SAMPLE_LIMITS[tier]:
                heapq.heappush(heap, candidate)
            elif sample_key < -heap[0][0]:
                heapq.heapreplace(heap, candidate)

    households = [
        household
        for heap in sample_heaps.values()
        for _, household in heap
    ]
    households.sort(key=lambda item: (0 if item["tier"] == "market-first" else 1, item["puma"], item["id"]))

    areas = []
    for puma, counts in puma_counts.items():
        market_first = counts["market-first"]
        areas.append(
            {
                "puma": puma,
                "name": puma_names.get(puma, f"PUMA {puma}"),
                "marketFirst": market_first,
                "considerNext": counts["consider-next"],
                "shareOfMarketFirst": round(market_first / tier_counts["market-first"] * 100, 1),
            }
        )
    areas.sort(key=lambda item: (-item["marketFirst"], item["puma"]))

    output = {
        "method": {
            "source": source_path.name,
            "unit": "Synthetic household; not a real person or contact record",
            "marketFirst": (
                "Household size 4 or 5; modeled income $75,000–$150,000; income below the Household "
                "Living Budget but covering at least 50% of it"
            ),
            "considerNext": (
                "Household size 4 or 5; modeled income $60,000–$175,000; income below the Household "
                "Living Budget but covering at least 40% of it; outside the market-first band"
            ),
            "note": "Audience tiers support campaign planning only. They are not program eligibility, urgency, or contact permission.",
        },
        "summary": {
            "sourceHouseholds": total_rows,
            "familyFourToFive": family_rows,
            "marketFirst": tier_counts["market-first"],
            "considerNext": tier_counts["consider-next"],
            "medianMarketFirstIncome": round(statistics.median(target_incomes)),
            "medianMarketFirstGap": round(statistics.median(target_gaps)),
            "recordsShown": len(households),
            "areasRepresented": len(areas),
        },
        "areas": areas,
        "households": households,
    }

    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT_PATH} with {len(households)} representative rows; "
        f"{tier_counts['market-first']:,} market-first households and {tier_counts['consider-next']:,} consider-next households."
    )


if __name__ == "__main__":
    main()

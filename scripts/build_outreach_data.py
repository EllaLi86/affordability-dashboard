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
SAMPLE_LIMITS = {"market-first": 1, "consider-next": 2}
SEGMENT_INCOME_SPLIT = 110_000

SEGMENT_META = {
    "young-emerging": {
        "priority": 1,
        "name": "Young families building stability",
        "subtitle": "Child under 6 · $75K–$110K income",
        "channel": "Childcare & family resource partners",
        "message": "Lead with family-sized homes, predictable ownership costs, and a simple first-time-buyer pathway.",
    },
    "school-emerging": {
        "priority": 2,
        "name": "Growing school-age families",
        "subtitle": "Children 6–18 · $75K–$110K income",
        "channel": "Schools & family networks",
        "message": "Emphasize stable school communities, enough bedrooms, and purchase support for working families.",
    },
    "young-moderate": {
        "priority": 3,
        "name": "Young families priced out at mid-income",
        "subtitle": "Child under 6 · $110K–$150K income",
        "channel": "Family networks & employer benefits",
        "message": "Show how below-market pricing and purchase assistance can close the remaining ownership gap.",
    },
    "school-moderate": {
        "priority": 4,
        "name": "School-age families blocked by prices",
        "subtitle": "Children 6–18 · $110K–$150K income",
        "channel": "Schools, employers & community events",
        "message": "Focus on long-term neighborhood stability and the gap between solid income and market home prices.",
    },
    "adult-emerging": {
        "priority": 5,
        "name": "Adult households sharing costs",
        "subtitle": "All members 19+ · $75K–$110K income",
        "channel": "Workforce & community partners",
        "message": "Use first-time-buyer workshops to explain household eligibility, shared purchasing, and unit options.",
    },
    "adult-moderate": {
        "priority": 6,
        "name": "Adult households facing the market gap",
        "subtitle": "All members 19+ · $110K–$150K income",
        "channel": "Employer & housing-counseling partners",
        "message": "Lead with the price difference between program homes and the open market, plus financing guidance.",
    },
}


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


def segment_for(row: dict[str, str], income: float) -> str:
    young_children = sum(int(row[field]) for field in ("no_infant", "no_toddler", "no_preschooler"))
    school_age = int(row["no_schooler"]) + int(row["no_teenager"])
    life_stage = "young" if young_children else "school" if school_age else "adult"
    income_stage = "emerging" if income < SEGMENT_INCOME_SPLIT else "moderate"
    return f"{life_stage}-{income_stage}"


def make_household(
    row: dict[str, str], puma_names: dict[str, str], tier: str, segment_id: str | None
) -> dict[str, object]:
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
        "segmentId": segment_id,
        "segmentName": SEGMENT_META[segment_id]["name"] if segment_id else "Consider-next audience",
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
    segment_counts: dict[str, int] = defaultdict(int)
    segment_puma_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    segment_incomes: dict[str, list[float]] = defaultdict(list)
    segment_gaps: dict[str, list[float]] = defaultdict(list)
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
            segment_id = segment_for(row, income) if tier == "market-first" else None
            if tier == "market-first":
                target_incomes.append(income)
                gap = max(0, hlb - income)
                target_gaps.append(gap)
                segment_counts[segment_id] += 1
                segment_puma_counts[segment_id][row["puma"]] += 1
                segment_incomes[segment_id].append(income)
                segment_gaps[segment_id].append(gap)

            household = make_household(row, puma_names, tier, segment_id)
            sample_key = stable_sample_key(int(row["synpop_hh_id"]))
            heap_key = (row["puma"], tier, segment_id)
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

    segments = []
    for segment_id, meta in SEGMENT_META.items():
        top_areas = sorted(
            segment_puma_counts[segment_id].items(), key=lambda item: (-item[1], item[0])
        )[:3]
        segments.append(
            {
                "id": segment_id,
                **meta,
                "count": segment_counts[segment_id],
                "share": round(segment_counts[segment_id] / tier_counts["market-first"] * 100, 1),
                "medianIncome": round(statistics.median(segment_incomes[segment_id])),
                "medianGap": round(statistics.median(segment_gaps[segment_id])),
                "topAreas": [
                    {
                        "puma": puma,
                        "name": puma_names.get(puma, f"PUMA {puma}"),
                        "count": count,
                    }
                    for puma, count in top_areas
                ],
            }
        )
    segments.sort(key=lambda item: item["priority"])

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
            "segments": (
                "Market-first households are grouped by young children under 6, school-age members 6–18, "
                "or adult-only composition, then split at $110,000 modeled annual income"
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
            "audienceGroups": len(segments),
        },
        "segments": segments,
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

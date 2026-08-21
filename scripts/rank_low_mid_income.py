"""
rank_low_mid_income.py

Ranks San Diego PUMAs by low-mid income priority: share of vulnerable
households that are "near-miss" (80-100% of required income, close to
self-sufficient) rather than "deep-need" (below 80%, further from
self-sufficient and more likely already served by existing low-income
assistance programs).

Simple, direct ranking -- sorts PUMAs by pct_near_miss_of_vulnerable, no
custom weighting formula.

Usage:
    python3 rank_low_mid_income.py path/to/san_diego_ca_hlb_hackathon_2024_20260811.csv

Outputs:
    low_mid_income_priority.csv  -- one row per PUMA, ranked
    low_mid_income_priority.json -- same data as JSON, same field names/shape
                                     as data/puma_stats.json for easy merging
"""

import sys
import json
import pandas as pd

PUMA_NAMES = {
    '07301': 'Oceanside & Camp Pendleton',
    '07302': 'Fallbrook, Alpine & Valley Center',
    '07306': 'Escondido (East)',
    '07307': 'Lakeside, Winter Gardens & Ramona',
    '07308': 'Rancho Bernardo & Poway',
    '07310': 'San Diego City (SW / Central Coastal)',
    '07311': 'San Diego City (NW / Del Mar Mesa)',
    '07312': 'Mira Mesa & University Heights',
    '07313': 'El Cajon & Santee',
    '07314': 'Navajo & La Mesa',
    '07315': 'Clairemont & Kearny Mesa',
    '07316': 'Centre City & Balboa Park',
    '07317': 'Mid-City (City Heights area)',
    '07322': 'South San Diego / Otay Mesa & South Bay',
    '07323': 'Vista',
    '07324': 'Carlsbad',
    '07325': 'San Marcos & Escondido (West)',
    '07326': 'San Dieguito & Encinitas',
    '07327': 'San Diego City SE (Encanto & Skyline)',
    '07328': 'Lemon Grove, La Presa & Spring Valley',
    '07329': 'Sweetwater / Chula Vista (East)',
    '07330': 'Chula Vista (West) & National City',
}


def rank(csv_path: str, out_csv_path: str, out_json_path: str) -> None:
    df = pd.read_csv(csv_path, dtype={'geoid': str, 'puma': str})

    # same reliability filter as build_data.py -- drop tracts with < 100 sampled households
    tract_counts = df.groupby('geoid').size()
    reliable = tract_counts[tract_counts >= 100].index
    df = df[df['geoid'].isin(reliable)].copy()

    vuln = df[df['economically_vulnerable'] == 1].copy()
    vuln['income_ratio'] = vuln['hh_income'] / vuln['hlb_year']
    vuln['is_near_miss'] = vuln['income_ratio'] >= 0.8

    g = df.groupby('puma').agg(
        n_households=('economically_vulnerable', 'size'),
        n_vulnerable=('economically_vulnerable', 'sum'),
        vulnerability_rate=('economically_vulnerable', 'mean'),
    )
    near_miss_by_puma = vuln.groupby('puma')['is_near_miss'].mean().rename('pct_near_miss_of_vulnerable')
    g = g.join(near_miss_by_puma)

    g['puma_name'] = g.index.map(PUMA_NAMES)
    g['vulnerability_rate'] = (g['vulnerability_rate'] * 100).round(1)
    g['pct_near_miss_of_vulnerable'] = (g['pct_near_miss_of_vulnerable'] * 100).round(1)
    g['pct_deep_need_of_vulnerable'] = (100 - g['pct_near_miss_of_vulnerable']).round(1)

    g['vulnerability_rank'] = g['vulnerability_rate'].rank(ascending=False, method='min').astype(int)
    g['low_mid_priority_rank'] = g['pct_near_miss_of_vulnerable'].rank(ascending=False, method='min').astype(int)
    g['rank_shift'] = g['vulnerability_rank'] - g['low_mid_priority_rank']

    g = g.reset_index().rename(columns={'puma': 'puma_code'})
    g = g[['puma_code', 'puma_name', 'n_households', 'n_vulnerable', 'vulnerability_rate',
           'vulnerability_rank', 'pct_near_miss_of_vulnerable', 'pct_deep_need_of_vulnerable',
           'low_mid_priority_rank', 'rank_shift']]
    g = g.sort_values('low_mid_priority_rank')

    g.to_csv(out_csv_path, index=False)

    county_summary = {
        'county_vulnerability_rate': round(df['economically_vulnerable'].mean() * 100, 1),
        'total_households': int(len(df)),
        'total_vulnerable': int(df['economically_vulnerable'].sum()),
    }
    out = {'county_summary': county_summary, 'pumas': g.to_dict(orient='records')}
    with open(out_json_path, 'w') as f:
        json.dump(out, f, indent=2)

    print(f"Wrote {out_csv_path} and {out_json_path} ({len(g)} PUMAs)\n")
    print("Ranked by low-mid income priority (near-miss share):")
    print(g[['puma_name', 'low_mid_priority_rank', 'vulnerability_rank',
              'rank_shift', 'pct_near_miss_of_vulnerable']].to_string(index=False))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    rank(sys.argv[1], 'low_mid_income_priority.csv', 'low_mid_income_priority.json')
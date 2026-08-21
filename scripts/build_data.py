"""
Build data/puma_stats.json from the raw HLB hackathon CSV.

Usage:
    python scripts/build_data.py path/to/san_diego_ca_hlb_hackathon_2024_20260811.csv

Produces a small (22-row) PUMA-level summary that the dashboard (index.html)
loads directly -- the multi-hundred-MB source CSV never needs to touch the repo
or the browser.
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


def build(csv_path: str, out_path: str) -> None:
    df = pd.read_csv(csv_path, dtype={'geoid': str, 'puma': str})

    # Drop census tracts with fewer than 100 sampled households -- flagged as
    # statistically unreliable in the data dictionary.
    tract_counts = df.groupby('geoid').size()
    reliable = tract_counts[tract_counts >= 100].index
    df = df[df['geoid'].isin(reliable)].copy()

    vuln = df[df['economically_vulnerable'] == 1].copy()
    vuln['gap'] = vuln['hlb_year'] - vuln['hh_income']

    g = df.groupby('puma').agg(
        n_households=('economically_vulnerable', 'size'),
        n_vulnerable=('economically_vulnerable', 'sum'),
        vulnerability_rate=('economically_vulnerable', 'mean'),
        median_income=('hh_income', 'median'),
        median_hlb_year=('hlb_year', 'median'),
        median_housing_cost_month=('housing_cost_month', 'median'),
    )
    gap_by_puma = vuln.groupby('puma')['gap'].median().rename('median_gap_vulnerable')
    g = g.join(gap_by_puma)
    g['puma_name'] = g.index.map(PUMA_NAMES)
    g['vulnerability_rate'] = (g['vulnerability_rate'] * 100).round(1)
    for col in ['median_income', 'median_hlb_year', 'median_housing_cost_month', 'median_gap_vulnerable']:
        g[col] = g[col].round(0)

    g = g.reset_index().rename(columns={'puma': 'puma_code'})
    g = g[['puma_code', 'puma_name', 'n_households', 'n_vulnerable', 'vulnerability_rate',
           'median_income', 'median_hlb_year', 'median_housing_cost_month', 'median_gap_vulnerable']]
    g = g.sort_values('vulnerability_rate', ascending=False)

    county_summary = {
        'county_vulnerability_rate': round(df['economically_vulnerable'].mean() * 100, 1),
        'total_households': int(len(df)),
        'total_vulnerable': int(df['economically_vulnerable'].sum()),
    }

    out = {'county_summary': county_summary, 'pumas': g.to_dict(orient='records')}
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {out_path} ({len(g)} PUMAs, county vulnerability rate "
          f"{county_summary['county_vulnerability_rate']}%)")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1], 'data/puma_stats.json')

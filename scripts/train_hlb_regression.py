#!/usr/bin/env python3
"""Train and export an explainable Household Living Budget ridge regression.

The model intentionally uses only fields available during application intake:
PUMA, adults, children, household size, and the youngest child's age band.
Household income is excluded because HLB is a needs benchmark; income is only
used after prediction to calculate the affordability gap.

Usage:
    python3 scripts/train_hlb_regression.py /path/to/san_diego_hlb.csv
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT_ROOT.parent / "san_diego_ca_hlb_hackathon_2024_20260811.csv"
PUMA_STATS_PATH = PROJECT_ROOT / "data" / "puma_stats.json"
OUTPUT_PATH = PROJECT_ROOT / "data" / "hlb_regression_model.json"

RIDGE_ALPHA = 1.0
TRAINING_CHUNK_SIZE = 25_000
EVALUATION_CHUNK_SIZE = 50_000
TEST_MODULUS = 10
YOUNGEST_BANDS = ["none", "infant", "toddler", "preschooler", "schooler", "teenager"]


def feature_schema(pumas: list[str]) -> dict[str, object]:
    offsets = {
        "intercept": 0,
        "numeric": 1,
        "puma": 6,
        "householdSize": 6 + len(pumas),
        "youngestBand": 6 + len(pumas) + 5,
        "sizeYoungest": 6 + len(pumas) + 5 + len(YOUNGEST_BANDS),
        "pumaSize": 6 + len(pumas) + 5 + len(YOUNGEST_BANDS) + 5 * len(YOUNGEST_BANDS),
    }
    dimension = offsets["pumaSize"] + len(pumas) * 5
    return {
        "pumas": pumas,
        "youngestBands": YOUNGEST_BANDS,
        "sizeBuckets": [1, 2, 3, 4, 5],
        "numericFeatures": ["adults", "children", "adultsSquared", "childrenSquared", "adultsChildren"],
        "offsets": offsets,
        "dimension": dimension,
    }


def youngest_band_codes(frame: pd.DataFrame) -> np.ndarray:
    counts = [
        frame["no_infant"].to_numpy(),
        frame["no_toddler"].to_numpy(),
        frame["no_preschooler"].to_numpy(),
        frame["no_schooler"].to_numpy(),
        frame["no_teenager"].to_numpy(),
    ]
    codes = np.zeros(len(frame), dtype=np.int64)
    # Assign oldest-to-youngest so a younger child overrides an older child.
    for code, count in reversed(list(enumerate(counts, start=1))):
        codes[count > 0] = code
    return codes


def design_matrix(frame: pd.DataFrame, schema: dict[str, object]) -> np.ndarray:
    pumas = schema["pumas"]
    offsets = schema["offsets"]
    puma_indexes = {puma: index for index, puma in enumerate(pumas)}
    row_indexes = np.arange(len(frame))
    matrix = np.zeros((len(frame), schema["dimension"]), dtype=np.float64)

    adults = frame["no_adult"].to_numpy(dtype=np.float64)
    children = frame[["no_teenager", "no_schooler", "no_preschooler", "no_toddler", "no_infant"]].sum(axis=1).to_numpy(dtype=np.float64)
    size_codes = np.clip(frame["hh_size_recode"].to_numpy(dtype=np.int64), 1, 5) - 1
    band_codes = youngest_band_codes(frame)
    puma_codes = frame["puma"].map(puma_indexes).to_numpy(dtype=np.int64)

    matrix[:, offsets["intercept"]] = 1
    numeric_offset = offsets["numeric"]
    matrix[:, numeric_offset:numeric_offset + 5] = np.column_stack(
        [adults, children, adults * adults, children * children, adults * children]
    )
    matrix[row_indexes, offsets["puma"] + puma_codes] = 1
    matrix[row_indexes, offsets["householdSize"] + size_codes] = 1
    matrix[row_indexes, offsets["youngestBand"] + band_codes] = 1
    matrix[row_indexes, offsets["sizeYoungest"] + size_codes * len(YOUNGEST_BANDS) + band_codes] = 1
    matrix[row_indexes, offsets["pumaSize"] + puma_codes * 5 + size_codes] = 1
    return matrix


def main() -> None:
    source_path = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source_path.exists():
        raise SystemExit(f"Source CSV not found: {source_path}")

    puma_stats = json.loads(PUMA_STATS_PATH.read_text(encoding="utf-8"))
    pumas = sorted(item["puma_code"] for item in puma_stats["pumas"])
    schema = feature_schema(pumas)
    dimension = schema["dimension"]
    columns = [
        "synpop_hh_id", "puma", "no_adult", "no_teenager", "no_schooler",
        "no_preschooler", "no_toddler", "no_infant", "hh_size_recode", "hlb_year",
    ]

    xtx = np.zeros((dimension, dimension), dtype=np.float64)
    xty = np.zeros(dimension, dtype=np.float64)
    training_rows = 0
    for frame in pd.read_csv(source_path, usecols=columns, dtype={"puma": str}, chunksize=TRAINING_CHUNK_SIZE):
        training_mask = frame["synpop_hh_id"].to_numpy() % TEST_MODULUS != 0
        training_frame = frame.loc[training_mask]
        matrix = design_matrix(training_frame, schema)
        target = training_frame["hlb_year"].to_numpy(dtype=np.float64)
        xtx += matrix.T @ matrix
        xty += matrix.T @ target
        training_rows += len(target)

    penalty = np.eye(dimension, dtype=np.float64) * RIDGE_ALPHA
    penalty[schema["offsets"]["intercept"], schema["offsets"]["intercept"]] = 0
    coefficients = np.linalg.solve(xtx + penalty, xty)

    absolute_errors: list[np.ndarray] = []
    errors_by_size: dict[int, list[np.ndarray]] = {size: [] for size in range(1, 6)}
    squared_error_sum = 0.0
    absolute_percentage_error_sum = 0.0
    target_sum = 0.0
    target_square_sum = 0.0
    test_rows = 0
    for frame in pd.read_csv(source_path, usecols=columns, dtype={"puma": str}, chunksize=EVALUATION_CHUNK_SIZE):
        test_mask = frame["synpop_hh_id"].to_numpy() % TEST_MODULUS == 0
        test_frame = frame.loc[test_mask]
        matrix = design_matrix(test_frame, schema)
        target = test_frame["hlb_year"].to_numpy(dtype=np.float64)
        predictions = matrix @ coefficients
        errors = predictions - target
        absolute = np.abs(errors)
        absolute_errors.append(absolute)
        squared_error_sum += float(np.sum(errors * errors))
        absolute_percentage_error_sum += float(np.sum(absolute / target))
        target_sum += float(np.sum(target))
        target_square_sum += float(np.sum(target * target))
        test_rows += len(target)

        size_buckets = np.clip(test_frame["hh_size_recode"].to_numpy(dtype=np.int64), 1, 5)
        for size in range(1, 6):
            errors_by_size[size].append(absolute[size_buckets == size])

    all_absolute_errors = np.concatenate(absolute_errors)
    target_mean = target_sum / test_rows
    total_sum_squares = target_square_sum - test_rows * target_mean * target_mean
    metrics_by_size = {}
    for size, chunks in errors_by_size.items():
        values = np.concatenate(chunks)
        metrics_by_size[str(size)] = {
            "mae": round(float(np.mean(values))),
            "p90AbsoluteError": round(float(np.quantile(values, 0.9))),
            "testRows": int(len(values)),
        }

    output = {
        "modelType": "ridge-regression",
        "modelVersion": 1,
        "target": "hlb_year",
        "moneyYear": 2024,
        "source": source_path.name,
        "purpose": "Planning estimate of annual Household Living Budget from application-style household and location inputs",
        "excludedInputs": ["hh_income", "economically_vulnerable", "individual cost components"],
        "training": {
            "split": f"synpop_hh_id modulo {TEST_MODULUS}; remainder 0 held out",
            "ridgeAlpha": RIDGE_ALPHA,
            "trainingRows": training_rows,
            "testRows": test_rows,
        },
        "metrics": {
            "mae": round(float(np.mean(all_absolute_errors))),
            "rmse": round(math.sqrt(squared_error_sum / test_rows)),
            "mapePercent": round(absolute_percentage_error_sum / test_rows * 100, 2),
            "rSquared": round(1 - squared_error_sum / total_sum_squares, 4),
            "p90AbsoluteError": round(float(np.quantile(all_absolute_errors, 0.9))),
            "byHouseholdSize": metrics_by_size,
        },
        "featureSchema": schema,
        "coefficients": [round(float(value), 6) for value in coefficients],
        "limitations": [
            "PUMA is a broad location; the model cannot capture tract-level housing-cost variation.",
            "Youngest-child age band does not describe every child's age, so childcare estimates remain uncertain.",
            "The target is a modeled 2024 needs benchmark, not observed household spending or an eligibility threshold.",
        ],
    }
    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT_PATH} from {training_rows:,} training rows and {test_rows:,} held-out rows; "
        f"MAE ${output['metrics']['mae']:,}, MAPE {output['metrics']['mapePercent']}%, "
        f"R² {output['metrics']['rSquared']}."
    )


if __name__ == "__main__":
    main()

import gzip
import json
import sys
from pathlib import Path

import joblib


SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "sign-language-recognition"
DESTINATION = Path(__file__).resolve().parents[1] / "public" / "models"


def export_forest(filename: str) -> dict:
    saved = joblib.load(SOURCE / filename)
    forest = saved["classifier"]
    class_count = len(saved["labels"])
    trees = []

    for estimator in forest.estimators_:
        tree = estimator.tree_
        left = tree.children_left.tolist()
        right = tree.children_right.tolist()
        feature = tree.feature.tolist()
        threshold = tree.threshold.tolist()
        probability_offsets = [-1] * tree.node_count
        leaf_probabilities = []

        for node in range(tree.node_count):
            if left[node] != -1:
                continue

            values = tree.value[node][0]
            total = float(values.sum())
            probability_offsets[node] = len(leaf_probabilities)
            leaf_probabilities.extend(
                float(value / total) if total else 0.0 for value in values
            )

        trees.append({
            "left": left,
            "right": right,
            "feature": feature,
            "threshold": threshold,
            "probabilityOffsets": probability_offsets,
            "leafProbabilities": leaf_probabilities,
        })

    return {
        "format": 1,
        "labels": [str(label) for label in saved["labels"]],
        "featureCount": forest.n_features_in_,
        "classCount": class_count,
        "trees": trees,
    }


def main() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for source, target in (
        ("sign_model.pkl", "sign-model.json.gz"),
        ("number_model.pkl", "number-model.json.gz"),
        ("sequence_model.pkl", "sequence-model.json.gz"),
    ):
        model = export_forest(source)
        output = DESTINATION / target
        with output.open("wb") as raw_file:
            with gzip.GzipFile(fileobj=raw_file, mode="wb", mtime=0, compresslevel=9) as compressed:
                compressed.write(json.dumps(model, separators=(",", ":")).encode("utf-8"))
        print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

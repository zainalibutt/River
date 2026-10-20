"""Writes the fixture that pins the server's value network maths to PyTorch's.

A tiny strength-bucket network with seeded random weights, and for a few spots the
inputs train_river_buckets.py builds and the outputs PyTorch computes. The spots come
from records the data factory wrote with run seed `parity`, so the TypeScript test
can rebuild each spot from its seed and check both the inputs and the maths
(apps/server/src/bot-value-network.test.ts).

    python ml/export_value_parity.py <data dir written with run seed parity> <fixture.json>
    npx biome format --write <fixture.json>

The second step lays the fixture out as the repository's linter expects.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch

from river_value_data import load_records, load_bucket_ids
from train_river_buckets import bucket_features, mlp

BUCKETS = 16


def main() -> None:
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    if "--d3-model" in sys.argv:
        export_d3(data, out, Path(sys.argv[sys.argv.index("--d3-model") + 1]))
        return
    records = load_records(data)
    features = bucket_features(records, BUCKETS)
    torch.manual_seed(0)
    model = mlp(features["x"].shape[1], features["y"].shape[1], 16, 2)
    # Nudge the slopes off PyTorch's default, so a slope read wrongly shows.
    with torch.no_grad():
        for layer in model:
            if isinstance(layer, torch.nn.PReLU):
                layer.weight.fill_(0.17)
        outputs = model(torch.from_numpy(features["x"])).numpy()
    tensors, values, offset = [], [], 0
    for name, tensor in model.state_dict().items():
        array = tensor.numpy().astype("<f4")
        tensors.append({"name": name, "shape": list(array.shape), "offset": offset})
        offset += array.size * 4
        values.extend(float(v) for v in array.ravel())
    cases = [
        {
            "seed": f"parity:{int(record['worker'])}:{int(record['spot'])}",
            "inputs": [float(v) for v in features["x"][i]],
            "outputs": [float(v) for v in outputs[i]],
        }
        for i, record in enumerate(records)
    ]
    out.write_text(
        json.dumps({"buckets": BUCKETS, "tensors": tensors, "weights": values, "cases": cases}) + "\n",
        newline="\n",
    )
    print(f"{len(cases)} cases, {len(values)} weights, written to {out}")


def export_d3(data: Path, out: Path, stem: Path) -> None:
    """Actual trainer features and PyTorch outputs, from real rows and exported weights.
    TS independently rebuilds layouts from board/ranks, never consumes cached ids.
    Four real cases plus a synthetic empty-player-range case.
    """
    description = json.loads(stem.with_suffix(".json").read_text())
    records = load_records(data, limit=4)
    ids = load_bucket_ids(data, "flop-buckets-v1-32x4")[:len(records)] if "flopBuckets" in description else None
    records = np.concatenate([records, records[:1]])
    records["ranges"][-1, 0, :] = 0
    if ids is not None:
        ids = np.concatenate([ids, ids[:1]])
    features = bucket_features(records, description["buckets"], ids)
    model = mlp(description["inputs"], description["outputs"], description["width"], description["depth"])
    weights = np.fromfile(stem.with_suffix(".bin"), dtype="<f4")
    state = {}
    for tensor in description["tensors"]:
        start = tensor["offset"] // 4
        size = int(np.prod(tensor["shape"]))
        state[tensor["name"]] = torch.from_numpy(weights[start:start + size].reshape(tensor["shape"]).copy())
    model.load_state_dict(state)
    with torch.no_grad():
        predicted = model(torch.from_numpy(features["x"])).numpy()
    cases = []
    for i, row in enumerate(records):
        cases.append({"board": row["board"][:3].tolist(), "ranks": row["strength_rank"].tolist(),
                      "ranges": row["ranges"].tolist(), "pot": float(row["pot"]), "stack": float(row["stack"]),
                      "bucket": features["bucket"][i].tolist(), "inputs": features["x"][i].tolist(),
                      "outputs": predicted[i].tolist()})
    out.write_text(json.dumps({"model": str(stem), "cases": cases}) + "\n")


if __name__ == "__main__":
    main()

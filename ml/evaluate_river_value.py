"""How far an exported river value network is from the solver, broken down.

Rebuilds the network from its .bin and .json, takes the same held-out spots
train_river_value.py held out (same seed, same records), and reports the error
in pots: over every live holding, weighted by how often each holding is held,
and by how deep the stacks are, each beside the yardstick of guessing every
holding's average value.

    python ml/evaluate_river_value.py <data dir> <model stem, without .bin> [--seed 0]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from river_value_data import load_records
from train_river_value import OUTPUTS, ValueNet, features

BANDS = [("under 1 pot behind", 0.0, 1.0), ("1 to 10 pots", 1.0, 10.0), ("over 10 pots", 10.0, 1e9)]


def load_model(stem: Path, device: torch.device) -> ValueNet:
    description = json.loads(stem.with_suffix(".json").read_text())
    weights = np.fromfile(stem.with_suffix(".bin"), dtype="<f4")
    model = ValueNet(description["width"], description["depth"])
    state = {}
    for tensor in description["tensors"]:
        size = int(np.prod(tensor["shape"]))
        start = tensor["offset"] // 4
        state[tensor["name"]] = torch.from_numpy(weights[start : start + size].reshape(tensor["shape"]).copy())
    model.load_state_dict(state)
    return model.to(device).eval()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("data", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    records = load_records(args.data)
    order = np.random.default_rng(args.seed).permutation(len(records))
    held = max(10, len(records) // 10)
    validation, training = records[order[:held]], order[held:]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(args.model, device)

    sums = np.zeros(OUTPUTS)
    counts = np.zeros(OUTPUTS)
    for start in range(0, len(training), 4096):
        _, y, m = features(records[training[start : start + 4096]])
        sums += (y * m).sum(0)
        counts += m.sum(0)
    average = (sums / np.maximum(counts, 1)).astype(np.float32)

    x, y, mask = features(validation)
    with torch.no_grad():
        predicted = np.concatenate(
            [model(torch.from_numpy(x[s : s + 2048]).to(device)).cpu().numpy() for s in range(0, len(x), 2048)]
        )
    error = np.abs(predicted - y) * mask
    guess = np.abs(average - y) * mask
    held_weight = validation["ranges"].reshape(len(validation), -1)
    depth = validation["stack"] / validation["pot"]

    def row(name: str, rows: np.ndarray) -> None:
        live = mask[rows].sum()
        weight = held_weight[rows].sum()
        print(
            f"{name:22s} {rows.sum():6d} spots | every holding {error[rows].sum() / live * 100:6.2f}% "
            f"(guess {guess[rows].sum() / live * 100:6.2f}%) | held hands {(error[rows] * held_weight[rows]).sum() / weight * 100:6.2f}% "
            f"(guess {(guess[rows] * held_weight[rows]).sum() / weight * 100:6.2f}%)"
        )

    print(f"held-out error in pots, {args.model.name}:")
    row("all spots", np.ones(len(validation), dtype=bool))
    for name, low, high in BANDS:
        row(name, (depth >= low) & (depth < high))


if __name__ == "__main__":
    main()

"""Trains v9's river value network on the data factory's solved rivers.

docs/bots.md describes the plan. This is the first, plain
version: both ranges, the board and the stack-to-pot ratio go in, and every holding's
value for both players comes out, in pots. The loss counts only the holdings the
board leaves possible. It reports how far the network is from the solver on spots
held out from training, and exports the weights as raw little-endian float32
numbers with a JSON description, for the TypeScript side to read.

    python ml/train_river_value.py <data dir> <out dir> [--epochs 40] [--width 512] [--depth 3]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from river_value_data import COMBOS, check_manifest, live_holdings, load_records

INPUTS = 2 * COMBOS + 52 + 1
OUTPUTS = 2 * COMBOS


def features(records: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Network inputs, target values and the mask of live holdings for a batch of records."""
    n = len(records)
    x = np.zeros((n, INPUTS), dtype=np.float32)
    # A range spreads one unit over about a thousand holdings; scaled, a flat range is about one each.
    x[:, : 2 * COMBOS] = records["ranges"].reshape(n, -1) * COMBOS
    rows = np.repeat(np.arange(n), 5)
    x[rows, 2 * COMBOS + records["board"].reshape(-1).astype(np.int64)] = 1
    x[:, -1] = np.log(records["stack"] / records["pot"])
    y = records["values"].reshape(n, -1).astype(np.float32)
    live = live_holdings(records)
    mask = np.concatenate([live, live], axis=1).astype(np.float32)
    return x, y, mask


class ValueNet(nn.Module):
    """A plain multi-layer perceptron: `depth` hidden layers of `width`, each with a PReLU."""

    def __init__(self, width: int, depth: int) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        size = INPUTS
        for _ in range(depth):
            layers += [nn.Linear(size, width), nn.PReLU()]
            size = width
        layers.append(nn.Linear(size, OUTPUTS))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def masked_mean(error: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return (error * mask).sum() / mask.sum()


def export(model: ValueNet, stem: Path, meta: dict) -> None:
    """Writes every tensor, in order, as little-endian float32 to stem.bin, and their shapes to stem.json."""
    layers = []
    arrays = []
    offset = 0
    for name, tensor in model.state_dict().items():
        array = tensor.detach().cpu().numpy().astype("<f4")
        layers.append({"name": name, "shape": list(array.shape), "offset": offset})
        offset += array.size * 4
        arrays.append(array.ravel())
    np.concatenate(arrays).tofile(stem.with_suffix(".bin"))
    description = {"format": "float32-le", "bytes": offset, "inputs": INPUTS, "outputs": OUTPUTS, "tensors": layers}
    stem.with_suffix(".json").write_text(json.dumps({**description, **meta}, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("data", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--limit", type=int, default=None, help="use at most this many records")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    manifest = check_manifest(args.data)
    records = load_records(args.data, args.limit)
    if len(records) < 20:
        raise SystemExit(f"{args.data}: only {len(records)} records")
    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    order = rng.permutation(len(records))
    held = max(10, len(records) // 10)
    # Training batches are gathered by index, so the records are never copied whole.
    validation, training = records[order[:held]], order[held:]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    xv, yv, mv = (torch.from_numpy(a).to(device) for a in features(validation))
    # The yardstick: guessing every holding's average value over the training spots.
    sums = np.zeros(OUTPUTS)
    counts = np.zeros(OUTPUTS)
    for start in range(0, len(training), 4096):
        _, y, m = features(records[training[start : start + 4096]])
        sums += (y * m).sum(0)
        counts += m.sum(0)
    average = torch.from_numpy((sums / np.maximum(counts, 1)).astype(np.float32)).to(device)
    guess_error = masked_mean((average - yv).abs(), mv).item()

    model = ValueNet(args.width, args.depth).to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=args.lr)
    steps = args.epochs * max(1, len(training) // args.batch)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, steps)
    huber = nn.SmoothL1Loss(reduction="none", beta=0.1)
    best = float("inf")
    args.out.mkdir(parents=True, exist_ok=True)
    stem = args.out / "river-value"
    started = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        shuffled = rng.permutation(len(training))
        total = 0.0
        batches = 0
        for start in range(0, len(shuffled) - args.batch + 1, args.batch):
            x, y, m = (torch.from_numpy(a).to(device, non_blocking=True) for a in features(records[training[shuffled[start : start + args.batch]]]))
            loss = masked_mean(huber(model(x), y), m)
            optimiser.zero_grad()
            loss.backward()
            optimiser.step()
            schedule.step()
            total += loss.item()
            batches += 1
        model.eval()
        with torch.no_grad():
            error = masked_mean((model(xv) - yv).abs(), mv).item()
        if error < best:
            best = error
            export(model, stem, {"epoch": epoch, "validationError": error, "guessError": guess_error, "data": str(args.data), "commit": manifest.get("commit"), "width": args.width, "depth": args.depth})
        print(f"epoch {epoch:3d}: training loss {total / max(1, batches):.4f}, held-out error {error * 100:.2f}% of the pot (guessing the average: {guess_error * 100:.2f}%), {time.time() - started:.0f} s", flush=True)
    print(f"best held-out error {best * 100:.2f}% of the pot over {len(validation)} spots; weights in {stem}.bin")


if __name__ == "__main__":
    main()

"""Trains the river value network on ranges sorted by hand strength.

The plain network (train_river_value.py) sees each holding as two of 52 cards, so it
must learn poker's hand rankings before it can learn anything about betting, and on
200,600 spots it stalled at 27% of the pot. On the river a holding's strength is known
exactly: the records carry every holding's showdown rank. Here each player's range is
summarised as its mass in each of B buckets of strength, the weakest first, and the
network learns each bucket's value. A bucket is a slice of the board's live holdings by
strength percentile, and holdings of equal strength always share one. Values go back
to holdings through their buckets, and the error is reported holding by holding, as
the plain network's is. See docs/bots.md.

    python ml/train_river_buckets.py <data dir> [<data dir> ...] <out dir> [--buckets 128] [--epochs 300]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from river_value_data import COMBOS, check_manifest, load_bucket_ids, load_checked, load_records

BANDS = [("under 1 pot behind", 0.0, 1.0), ("1 to 10 pots", 1.0, 10.0), ("over 10 pots", 10.0, 1e9)]


def bucket_features(
    records: np.ndarray,
    buckets: int,
    ids: np.ndarray | None = None,
    checked: np.ndarray | None = None,
    checked_inputs: str | None = None,
) -> dict[str, np.ndarray]:
    """Inputs, bucket targets, bucket masks and each holding's bucket, for a batch of records.
    With `ids` (one row of 1,326 per record, 255 where blocked), holdings take those buckets,
    as the turn's two-dimensional ones; otherwise buckets are slices of the strength rank.
    With `checked` (each holding's value if nobody bets again, shape (n, 2, 1326)), the targets
    are the values less the checked-down ones: the network learns only what betting adds, while
    each holding keeps its own exact checked-down value. With `checked_inputs` as well, it is
    also given each bucket's mean checked-down value for both players: over the bucket's live
    holdings ("live"), or weighted by the player's own range there ("range", 0 where the range has
    none), which a solver can work out from the ranges' holdings alone."""
    n = len(records)
    if ids is not None:
        bucket = ids.astype(np.int64)
        bucket[bucket == 255] = -1
        live = bucket >= 0
        live_count = np.maximum(live.sum(1), 1)
    else:
        rank = records["strength_rank"].astype(np.int64)
        live = rank > 0
        live_count = np.maximum(live.sum(1), 1)
        ranks = COMBOS + 1
        flat_rank = (np.arange(n)[:, None] * ranks + rank).reshape(-1)
        counts = np.bincount(flat_rank, minlength=n * ranks).reshape(n, ranks)
        counts[:, 0] = 0
        below = np.cumsum(counts, axis=1) - counts
        # Each holding sits at the middle of its tie group, so equal strengths share a bucket.
        middle = np.take_along_axis(below, rank, 1) + np.take_along_axis(counts, rank, 1) / 2
        bucket = np.minimum((middle / live_count[:, None] * buckets).astype(np.int64), buckets - 1)
        bucket[~live] = -1

    rows = np.repeat(np.arange(n)[:, None], COMBOS, 1)[live]
    flat = rows * buckets + bucket[live]
    size = n * buckets
    held = np.bincount(flat, minlength=size).reshape(n, buckets)
    x = [np.log(records["stack"] / records["pot"])[:, None].astype(np.float32)]
    y = []
    for player in (0, 1):
        weight = records["ranges"][:, player, :][live].astype(np.float64)
        value = records["values"][:, player, :][live].astype(np.float64)
        if checked is not None:
            value = value - checked[:, player, :][live].astype(np.float64)
        mass = np.bincount(flat, weights=weight, minlength=size).reshape(n, buckets)
        weighted = np.bincount(flat, weights=weight * value, minlength=size).reshape(n, buckets)
        x.append((mass * buckets).astype(np.float32))
        y.append(np.where(mass > 0, weighted / np.maximum(mass, 1e-300), 0).astype(np.float32))
    x.append((held / live_count[:, None] * buckets).astype(np.float32))
    if checked is not None and checked_inputs is not None:
        for player in (0, 1):
            value = checked[:, player, :][live].astype(np.float64)
            if checked_inputs == "range":
                weight = records["ranges"][:, player, :][live].astype(np.float64)
                mass = np.bincount(flat, weights=weight, minlength=size).reshape(n, buckets)
                total = np.bincount(flat, weights=weight * value, minlength=size).reshape(n, buckets)
                x.append(np.where(mass > 0, total / np.maximum(mass, 1e-300), 0).astype(np.float32))
            else:
                total = np.bincount(flat, weights=value, minlength=size).reshape(n, buckets)
                x.append(np.where(held > 0, total / np.maximum(held, 1), 0).astype(np.float32))
    mask = (held > 0).astype(np.float32)
    return {
        "x": np.concatenate(x, axis=1),
        "y": np.concatenate(y, axis=1),
        "mask": np.concatenate([mask, mask], axis=1),
        "bucket": bucket.astype(np.int16),
    }


def mlp(inputs: int, outputs: int, width: int, depth: int) -> nn.Sequential:
    layers: list[nn.Module] = []
    size = inputs
    for _ in range(depth):
        layers += [nn.Linear(size, width), nn.PReLU()]
        size = width
    layers.append(nn.Linear(size, outputs))
    return nn.Sequential(*layers)


def build(
    records: np.ndarray,
    buckets: int,
    ids: np.ndarray | None = None,
    checked: np.ndarray | None = None,
    checked_inputs: str | None = None,
) -> dict[str, np.ndarray]:
    parts = [
        bucket_features(
            records[start : start + 4096],
            buckets,
            None if ids is None else ids[start : start + 4096],
            None if checked is None else checked[start : start + 4096],
            checked_inputs,
        )
        for start in range(0, len(records), 4096)
    ]
    return {key: np.concatenate([part[key] for part in parts]) for key in parts[0]}


def holding_errors(
    predicted: np.ndarray, records: np.ndarray, bucket: np.ndarray, buckets: int, checked: np.ndarray | None = None
) -> dict[str, np.ndarray]:
    """Each holding's error in pots when it takes its bucket's predicted value, plus its own
    checked-down value when the network learns what betting adds."""
    n = len(records)
    out = {}
    for player in (0, 1):
        safe = np.where(bucket >= 0, bucket, 0).astype(np.int64)
        value = np.take_along_axis(predicted[:, player * buckets : (player + 1) * buckets], safe, 1)
        if checked is not None:
            value = value + checked[:, player, :]
        out[f"error{player}"] = np.where(bucket >= 0, np.abs(value - records["values"][:, player, :]), 0)
    return out


def report(
    name: str,
    predicted: np.ndarray,
    records: np.ndarray,
    bucket: np.ndarray,
    buckets: int,
    checked: np.ndarray | None = None,
) -> None:
    errors = holding_errors(predicted, records, bucket, buckets, checked)
    live = (bucket >= 0).astype(np.float64)
    depth = records["stack"] / records["pot"]
    print(name)
    for band, low, high in [("all spots", 0.0, 1e9), *BANDS]:
        rows = (depth >= low) & (depth < high)
        every = sum(errors[f"error{p}"][rows].sum() for p in (0, 1)) / (2 * live[rows].sum())
        held = sum((errors[f"error{p}"][rows] * records["ranges"][rows][:, p, :]).sum() for p in (0, 1)) / (2 * rows.sum())
        print(f"  {band:20s} {rows.sum():6d} spots | every holding {every * 100:6.2f}% | held hands {held * 100:6.2f}%")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("data", type=Path, nargs="+", help="one or more data folders, then the output folder")
    parser.add_argument("--buckets", type=int, default=128)
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--batch", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--turn-buckets", default=None, help="e.g. 32x4: use the two-dimensional turn buckets' side files")
    parser.add_argument(
        "--checked",
        action="store_true",
        help="learn what betting adds to each holding's checked-down value (side files from bot-turn-checked-run.ts)",
    )
    parser.add_argument(
        "--checked-inputs",
        nargs="?",
        const="live",
        choices=["live", "range"],
        default=None,
        help="with --checked, also give the network each bucket's mean checked-down value: over its live holdings, or weighted by the range",
    )
    args = parser.parse_args()

    *folders, args.out = args.data
    if not folders:
        raise SystemExit("give at least one data folder and an output folder")
    manifest = check_manifest(folders[0])
    records = load_records(folders)
    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    order = rng.permutation(len(records))
    held = max(10, len(records) // 10)
    validation_index, training_index = order[:held], order[held:]
    started = time.time()
    ids = None
    turn_buckets = None
    if args.turn_buckets is not None:
        strength, potential = (int(part) for part in args.turn_buckets.split("x"))
        if strength * potential != args.buckets:
            raise SystemExit(f"{args.turn_buckets} turn buckets do not make {args.buckets}")
        ids = load_bucket_ids(folders, f"buckets{args.turn_buckets}")
        turn_buckets = {"strength": strength, "potential": potential}
    if args.checked_inputs and not args.checked:
        raise SystemExit("--checked-inputs needs --checked")
    checked = load_checked(folders) if args.checked else None
    data = build(records, args.buckets, ids, checked, args.checked_inputs)
    print(f"bucketed {len(records)} spots into {args.buckets} buckets in {time.time() - started:.0f} s", flush=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tensors = {key: torch.from_numpy(data[key]).to(device) for key in ("x", "y", "mask")}
    train = torch.from_numpy(training_index).to(device)
    valid = torch.from_numpy(validation_index).to(device)
    inputs, outputs = data["x"].shape[1], data["y"].shape[1]

    model = mlp(inputs, outputs, args.width, args.depth).to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=args.lr)
    steps = args.epochs * max(1, len(train) // args.batch)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, steps)
    huber = nn.SmoothL1Loss(reduction="none", beta=0.1)
    best = (float("inf"), None)
    for epoch in range(1, args.epochs + 1):
        model.train()
        shuffled = train[torch.randperm(len(train), device=device)]
        for start in range(0, len(shuffled) - args.batch + 1, args.batch):
            index = shuffled[start : start + args.batch]
            x, y, m = tensors["x"][index], tensors["y"][index], tensors["mask"][index]
            loss = (huber(model(x), y) * m).sum() / m.sum()
            optimiser.zero_grad()
            loss.backward()
            optimiser.step()
            schedule.step()
        model.eval()
        with torch.no_grad():
            x, y, m = tensors["x"][valid], tensors["y"][valid], tensors["mask"][valid]
            error = (((model(x) - y).abs() * m).sum() / m.sum()).item()
        if error < best[0]:
            best = (error, {k: v.detach().clone() for k, v in model.state_dict().items()})
        if epoch == 1 or epoch % 25 == 0:
            print(f"epoch {epoch:3d}: held-out bucket error {error * 100:.2f}% of the pot, {time.time() - started:.0f} s", flush=True)

    model.load_state_dict(best[1])
    model.eval()
    with torch.no_grad():
        predicted = model(tensors["x"][valid]).cpu().numpy()
    validation = records[validation_index]
    bucket = data["bucket"][validation_index]
    held_checked = None if checked is None else checked[validation_index]
    report("held-out error of the network, holding by holding:", predicted, validation, bucket, args.buckets, held_checked)
    report(
        "the floor, if every bucket's value were exact:",
        data["y"][validation_index],
        validation,
        bucket,
        args.buckets,
        held_checked,
    )

    args.out.mkdir(parents=True, exist_ok=True)
    stem = args.out / f"river-buckets-{args.buckets}"
    arrays, tensors_out, offset = [], [], 0
    for name, tensor in model.state_dict().items():
        array = tensor.detach().cpu().numpy().astype("<f4")
        tensors_out.append({"name": name, "shape": list(array.shape), "offset": offset})
        offset += array.size * 4
        arrays.append(array.ravel())
    np.concatenate(arrays).tofile(stem.with_suffix(".bin"))
    stem.with_suffix(".json").write_text(
        json.dumps(
            {
                "format": "float32-le",
                "bytes": offset,
                "inputs": inputs,
                "outputs": outputs,
                "buckets": args.buckets,
                **({} if turn_buckets is None else {"turnBuckets": turn_buckets}),
                **({} if checked is None else {"checked": True, "checkedInputs": args.checked_inputs or False}),
                "width": args.width,
                "depth": args.depth,
                "validationBucketError": best[0],
                "data": [str(folder) for folder in folders],
                "commit": manifest.get("commit"),
                "tensors": tensors_out,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"weights in {stem}.bin")


if __name__ == "__main__":
    main()

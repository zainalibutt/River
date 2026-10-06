"""Reads the river value network's training data (docs/bots.md).

The data factory (apps/server/src/bot-river-value-data-run.ts) writes fixed-size,
little-endian records in shards named river-wNN-NNNNN.bin, beside a manifest.json
that describes the layout. Holdings are numbered 0 to 1,325 by their two card keys,
in the order (0, 1), (0, 2) ... (50, 51), where a card key is the card's place in the
engine's makeDeck(). Player 0 acts first, out of position.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

COMBOS = 1326

RECORD = np.dtype(
    [
        ("board", "u1", (5,)),
        ("_pad", "u1", (3,)),
        ("pot", "<f4"),
        ("stack", "<f4"),
        ("spot", "<u4"),
        ("worker", "<u2"),
        ("rounds", "<u2"),
        ("exploitability", "<f4"),
        ("solve_ms", "<f4"),
        ("ranges", "<f4", (2, COMBOS)),
        ("values", "<f4", (2, COMBOS)),
        ("strength_rank", "<u2", (COMBOS,)),
    ]
)

# Where each field starts, as the TypeScript side lays it out (RIVER_RECORD_LAYOUT).
OFFSETS = {
    "board": 0,
    "pot": 8,
    "stack": 12,
    "spot": 16,
    "worker": 20,
    "iterations": 22,
    "exploitability": 24,
    "solveMs": 28,
    "ranges": 32,
    "values": 32 + 8 * COMBOS,
    "strengthRank": 32 + 16 * COMBOS,
}

if RECORD.itemsize != 23_900:
    raise AssertionError(f"record is {RECORD.itemsize} bytes, the data factory writes 23,900")


def check_manifest(directory: Path) -> dict:
    """The run's manifest, after checking it describes the records this module reads."""
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest["recordBytes"] != RECORD.itemsize:
        raise ValueError(f"{directory}: records are {manifest['recordBytes']} bytes, expected {RECORD.itemsize}")
    offsets = {field["field"]: field["offset"] for field in manifest["layout"]}
    if offsets != OFFSETS:
        raise ValueError(f"{directory}: record layout changed: {offsets}")
    return manifest


def shards(directory: Path) -> list[Path]:
    """The run's finished shards, in name order; a .part file is still being written."""
    return sorted(directory.glob("*-w[0-9][0-9]-*.bin"))


def load_records(directory: Path | list[Path], limit: int | None = None) -> np.ndarray:
    """Every finished record of one run or several, read into memory, at most `limit` of them."""
    directories = directory if isinstance(directory, list) else [directory]
    paths = []
    for each in directories:
        check_manifest(each)
        paths += shards(each)
    counts = [path.stat().st_size // RECORD.itemsize for path in paths]
    total = sum(counts) if limit is None else min(limit, sum(counts))
    # Filled shard by shard, so a large run is held in memory once, not twice.
    records = np.empty(total, dtype=RECORD)
    filled = 0
    for path, count in zip(paths, counts):
        if filled >= total:
            break
        take = min(count, total - filled)
        records[filled : filled + take] = np.fromfile(path, dtype=RECORD, count=take)
        filled += take
    return records


def load_bucket_ids(directory: Path | list[Path], suffix: str) -> np.ndarray:
    """Each record's bucket ids from the side files beside its shards (X.bin, X.<suffix>), in
    load_records order: shape (n, 1326), 255 where blocked."""
    directories = directory if isinstance(directory, list) else [directory]
    paths = [path for each in directories for path in shards(each)]
    parts = []
    for path in paths:
        side = path.with_suffix(f".{suffix}")
        if not side.exists():
            raise FileNotFoundError(f"{side}: bucket ids not written yet")
        ids = np.fromfile(side, dtype=np.uint8).reshape(-1, COMBOS)
        if len(ids) != path.stat().st_size // RECORD.itemsize:
            raise ValueError(f"{side}: {len(ids)} rows for a shard of {path.stat().st_size // RECORD.itemsize}")
        parts.append(ids)
    return np.concatenate(parts) if parts else np.zeros((0, COMBOS), dtype=np.uint8)


def combo_cards() -> np.ndarray:
    """The two card keys of every holding, in holding order: shape (1326, 2)."""
    return np.array([(a, b) for a in range(52) for b in range(a + 1, 52)], dtype=np.int64)


def live_holdings(records: np.ndarray) -> np.ndarray:
    """Which holdings each record's board leaves possible: shape (n, 1326), True where live."""
    return records["strength_rank"] > 0

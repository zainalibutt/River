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
        # Turn-start extension: byte 5 tags the target; legacy factories write zero.
        ("target", "u1"),
        ("_pad", "u1", (2,)),
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


TURN_START_TARGETS = {"turn-start/turn-end-v1": 1, "turn-start/per-river-v1": 2}


def check_manifest(directory: Path) -> dict:
    """The run's manifest, after checking it describes the records this module reads."""
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest["recordBytes"] != RECORD.itemsize:
        raise ValueError(f"{directory}: records are {manifest['recordBytes']} bytes, expected {RECORD.itemsize}")
    offsets = {field["field"]: field["offset"] for field in manifest["layout"]}
    expected = dict(OFFSETS)
    if manifest.get("kind") == "turn-start":
        expected["target"] = 5
        if (
            manifest.get("target") not in TURN_START_TARGETS
            or TURN_START_TARGETS[manifest["target"]] != manifest.get("targetCode")
        ):
            raise ValueError(f"{directory}: unknown turn-start target")
    if offsets != expected:
        raise ValueError(f"{directory}: record layout changed: {offsets}")
    return manifest


def check_manifests(directories: list[Path]) -> dict:
    """Keep turn-start teachers and legacy end-of-street targets in separate runs."""
    manifests = [check_manifest(each) for each in directories]
    targets = {each.get("target", each.get("kind", "river")) for each in manifests}
    if len(targets) > 1 and any(each.get("kind") == "turn-start" for each in manifests):
        raise ValueError("cannot mix turn-start targets or end-of-street records")
    return manifests[0]


def records_for(path: Path, count: int) -> np.ndarray:
    """Read a shard and verify its target bytes against its manifest (including legacy zero)."""
    manifest = check_manifest(path.parent)
    if path.stat().st_size % RECORD.itemsize:
        raise ValueError(f"{path}: incomplete record")
    records = np.fromfile(path, dtype=RECORD, count=count)
    expected = manifest.get("targetCode", 0) if manifest.get("kind") == "turn-start" else 0
    if np.any(records["target"] != expected):
        raise ValueError(f"{path}: record target disagrees with manifest")
    return records


def shards(directory: Path) -> list[Path]:
    """The run's finished shards, in name order; a .part file is still being written."""
    return sorted(directory.glob("*-w[0-9][0-9]*-*.bin"))


def load_records(directory: Path | list[Path], limit: int | None = None) -> np.ndarray:
    """Every finished record of one run or several, read into memory, at most `limit` of them."""
    directories = directory if isinstance(directory, list) else [directory]
    check_manifests(directories)
    paths = []
    for each in directories:
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
        records[filled : filled + take] = records_for(path, take)
        filled += take
    return records


def checked_for(path: Path, count: int) -> np.ndarray:
    """One shard's checked-down values from its side file: shape (count, 2, 1326)."""
    side = path.with_suffix(".checked")
    if not side.exists():
        raise FileNotFoundError(f"{side}: checked-down values not written yet")
    if side.stat().st_size != count * 2 * COMBOS * 4:
        raise ValueError(f"{side}: wrong size for a shard of {count} records")
    return np.fromfile(side, dtype="<f4").reshape(count, 2, COMBOS)


def bucket_ids_for(path: Path, suffix: str, count: int) -> np.ndarray:
    """One shard's bucket ids from its side file: shape (count, 1326), 255 where blocked."""
    side = path.with_suffix(f".{suffix}")
    if not side.exists():
        raise FileNotFoundError(f"{side}: bucket ids not written yet")
    ids = np.fromfile(side, dtype=np.uint8).reshape(-1, COMBOS)
    if len(ids) != count:
        raise ValueError(f"{side}: {len(ids)} rows for a shard of {count}")
    return ids


def load_checked(directory: Path | list[Path]) -> np.ndarray:
    """Each record's checked-down values from the side files beside its shards (X.bin, X.checked,
    written by bot-turn-checked-run.ts), in load_records order: shape (n, 2, 1326), in pots,
    each holding's value if nobody bets again, 0 where blocked. Filled shard by shard."""
    directories = directory if isinstance(directory, list) else [directory]
    paths = [path for each in directories for path in shards(each)]
    counts = [path.stat().st_size // RECORD.itemsize for path in paths]
    out = np.empty((sum(counts), 2, COMBOS), dtype=np.float32)
    filled = 0
    for path, count in zip(paths, counts):
        side = path.with_suffix(".checked")
        if not side.exists():
            raise FileNotFoundError(f"{side}: checked-down values not written yet")
        if side.stat().st_size != count * 2 * COMBOS * 4:
            raise ValueError(f"{side}: wrong size for a shard of {count} records")
        out[filled : filled + count] = np.fromfile(side, dtype="<f4").reshape(count, 2, COMBOS)
        filled += count
    return out


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

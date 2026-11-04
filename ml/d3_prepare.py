"""Freeze a bounded, de-duplicated flop2 snapshot INSIDE this worktree.

Record identity is (runSeed, worker, spot); conflicting copies fail closed.
Only finished shards are read. Reuse requires every stored shard hash to match.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD_BYTES = 23900


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inside(path: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"output must be inside {ROOT}")
    return path


def prepare(sources: list[Path], out: Path, limit: int) -> dict:
    out = inside(out)
    requested = {"sources": [str(p.resolve()) for p in sources], "limit": limit}
    index = out / "snapshot.json"
    if index.exists():
        saved = json.loads(index.read_text())
        if saved["request"] != requested:
            raise ValueError("snapshot parameters changed; use a new output directory")
        for name, expected in saved["sha256"].items():
            if digest((out / name).read_bytes()) != expected:
                raise ValueError(f"snapshot changed: {name}")
        return saved
    manifests = [json.loads((p / "manifest.json").read_text()) for p in sources]
    manifest = manifests[0]
    for other in manifests:
        if other.get("kind") != "flop-end" or other.get("recordBytes") != RECORD_BYTES:
            raise ValueError("requires flop-end records")
        for key in ("runSeed", "turnNetwork", "turnCards", "turn", "settings", "layout"):
            if other.get(key) != manifest.get(key):
                raise ValueError(f"incompatible sources: {key}")
    out.mkdir(parents=True, exist_ok=True)
    seen: dict[tuple, str] = {}
    hashes = {}
    pending = bytearray()
    count = duplicates = part = 0

    def flush() -> None:
        nonlocal pending, part
        if not pending:
            return
        name = f"flopend-w00-{part:05d}.bin"
        target = out / name
        target.with_suffix(".part").write_bytes(pending)
        target.with_suffix(".part").replace(target)
        hashes[name] = digest(pending)
        part += 1
        pending = bytearray()

    for source in sources:
        for path in sorted(source.glob("flopend-w[0-9][0-9]*-*.bin")):
            raw = path.read_bytes()
            if len(raw) % RECORD_BYTES:
                raise ValueError(f"incomplete shard: {path}")
            for offset in range(0, len(raw), RECORD_BYTES):
                row = raw[offset:offset + RECORD_BYTES]
                if row[3:6] != bytes([255, 255, 0]):
                    raise ValueError("wrong street or target tag")
                spot, worker = struct.unpack_from("<IH", row, 16)
                identity = (manifest["runSeed"], worker, spot)
                hashed = digest(row)
                if identity in seen:
                    if seen[identity] != hashed:
                        raise ValueError(f"conflicting duplicate: {identity}")
                    duplicates += 1
                    continue
                seen[identity] = hashed
                if count >= limit:
                    continue
                pending.extend(row)
                count += 1
                if len(pending) >= RECORD_BYTES * 250:
                    flush()
    flush()
    # An interrupted, unfinished snapshot may have left surplus named shards.
    for stale in out.glob("flopend-w00-*.bin"):
        if stale.name not in hashes:
            stale.unlink()
    if count < 20:
        raise ValueError("need at least 20 distinct spots")
    manifest = {**manifest, "d3Snapshot": 1}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    hashes["manifest.json"] = digest((out / "manifest.json").read_bytes())
    saved = {"request": requested, "spots": count, "availableDistinct": len(seen), "duplicates": duplicates, "sha256": hashes}
    index.write_text(json.dumps(saved, indent=2) + "\n")
    return saved


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--limit", type=int, default=75000)
    args = parser.parse_args()
    print(json.dumps(prepare(args.sources, args.out, args.limit)))

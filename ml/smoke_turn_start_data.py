"""Smoke-check real factory shards: python ml/smoke_turn_start_data.py <turn-end dir> <per-river dir>."""

import json
from pathlib import Path
import shutil
import sys
import tempfile

import numpy as np

from river_value_data import RECORD, check_manifests, load_records, shards


def rejected(action):
    try:
        action()
    except ValueError:
        return
    raise AssertionError("invalid or mixed target was accepted")


def main():
    directories = [Path(arg) for arg in sys.argv[1:]]
    assert len(directories) == 2, "give one factory output directory per teacher"
    for directory, code in zip(directories, (1, 2)):
        records = load_records(directory)
        assert len(records) >= 3
        assert np.all(records["target"] == code)
        assert np.all(records["board"][:, 4] == 255)
        assert np.all(records["rounds"] == 100)
        assert np.all(np.isfinite(records["values"]))
        np.testing.assert_allclose(records["ranges"].sum(axis=2), 1, atol=1e-6)
        assert np.all(records["values"][records["ranges"] == 0] == 0)
        print(f"{directory}: {len(records)} records, target {code}, {RECORD.itemsize} bytes")
    rejected(lambda: check_manifests(directories))
    # Temporary test data stays inside the caller's worktree.
    with tempfile.TemporaryDirectory(prefix="turn-start-smoke-", dir=Path.cwd()) as temporary:
        bad = Path(temporary) / "bad"
        bad.mkdir()
        manifest = json.loads((directories[0] / "manifest.json").read_text())
        (bad / "manifest.json").write_text(json.dumps(manifest))
        path = bad / "turnstart-w123-00000.bin"
        shutil.copyfile(shards(directories[0])[0], path)
        assert len(load_records(bad)) >= 3  # Worker indices wider than two digits.
        raw = bytearray(path.read_bytes())
        raw[5] = 2
        path.write_bytes(raw)
        rejected(lambda: load_records(bad))
        # Legacy records keep byte 5 zero and retain the exact old offsets.
        manifest["kind"] = "turn-end"
        manifest.pop("target")
        manifest.pop("targetCode")
        manifest["layout"] = [field for field in manifest["layout"] if field["field"] != "target"]
        (bad / "manifest.json").write_text(json.dumps(manifest))
        rejected(lambda: load_records(bad))
        for offset in range(5, len(raw), RECORD.itemsize):
            raw[offset] = 0
        path.write_bytes(raw)
        assert np.all(load_records(bad)["target"] == 0)
        rejected(lambda: load_records([directories[0], bad]))
    print("PASS: both teachers, binary offsets, legacy compatibility, mixed targets and corrupt tags")


if __name__ == "__main__":
    main()

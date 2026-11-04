"""Standard-library snapshot guard tests, runnable without training dependencies."""
import json
import struct
import tempfile
import unittest
from pathlib import Path

from d3_prepare import RECORD_BYTES, ROOT, inside, prepare


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / "art" / "out")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.source.mkdir()
        manifest = {"kind": "flop-end", "recordBytes": RECORD_BYTES, "runSeed": "flop2"}
        (self.source / "manifest.json").write_text(json.dumps(manifest))
        rows = bytearray(RECORD_BYTES * 20)
        for i in range(20):
            rows[i * RECORD_BYTES + 3:i * RECORD_BYTES + 6] = bytes([255, 255, 0])
            struct.pack_into("<IH", rows, i * RECORD_BYTES + 16, i, 0)
        (self.source / "flopend-w00-00000.bin").write_bytes(rows)

    def test_dedup_and_restart_hash(self):
        # Mutation: remove identity de-duplication, or hash validation on reuse.
        snapshot = prepare([self.source, self.source], self.base / "out", 100)
        self.assertEqual(snapshot["spots"], 20)
        self.assertEqual(snapshot["duplicates"], 20)
        self.assertEqual(prepare([self.source, self.source], self.base / "out", 100), snapshot)
        shard = self.base / "out" / "flopend-w00-00000.bin"
        shard.write_bytes(bytes(shard.stat().st_size))
        with self.assertRaisesRegex(ValueError, "changed"):
            prepare([self.source, self.source], self.base / "out", 100)

    def test_conflicting_copies(self):
        # Mutation: accept identity collisions without comparing content hashes.
        path = self.source / "flopend-w00-00000.bin"
        rows = bytearray(path.read_bytes())
        rows[8] = 1
        (self.source / "flopend-w00-00001.bin").write_bytes(rows)
        with self.assertRaisesRegex(ValueError, "conflicting"):
            prepare([self.source], self.base / "out", 20)

    def test_layout_and_output_guards(self):
        # Mutations: omit incomplete-record check; omit worktree containment guard.
        path = self.source / "flopend-w00-00000.bin"
        path.write_bytes(path.read_bytes()[:-1])
        with self.assertRaisesRegex(ValueError, "incomplete"):
            prepare([self.source], self.base / "out", 20)
        with self.assertRaisesRegex(ValueError, "inside"):
            inside(ROOT.parent / "outside-d3")


if __name__ == "__main__":
    (ROOT / "art" / "out").mkdir(parents=True, exist_ok=True)
    unittest.main()

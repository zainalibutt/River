"""Bounded mutation audit; restores original bytes in finally, never invokes git."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TS = "apps/server/src/bot-flop-buckets.ts"
NET = "apps/server/src/bot-value-network.ts"
PY = "ml/d3_prepare.py"
CLI = "apps/server/src/bot-flop-buckets-run.ts"
MUTANTS = [
    ("variance", TS, "+ p * p", "+ p"),
    ("ties", TS, "((start + end) / 2 / members.length)", "(start / members.length)"),
    ("missing-futures", TS, "if (count === 0)", "if (false)"),
    ("sentinel", TS, "strength * potential > 255", "strength * potential > 256"),
    ("player-order", NET, "const at = 1 + player * buckets + bucket", "const at = 1 + (1 - player) * buckets + bucket"),
    ("metadata", NET, "{ flopBuckets: description.flopBuckets }", "{}"),
    ("turn-guard", TS, "if (network.turnBuckets !== undefined)", "if (false)"),
    ("cache-hash", CLI, "meta.sha256 === hash(cached)", "true"),
    ("dedup", PY, "if identity in seen:", "if False:"),
    ("snapshot-hash", PY, 'if digest((out / name).read_bytes()) != expected:', "if False:"),
    ("conflict", PY, 'raise ValueError(f"conflicting duplicate: {identity}")', "pass"),
    ("incomplete-record", PY, "if len(raw) % RECORD_BYTES:", "if False:"),
    ("containment", PY, "if not path.is_relative_to(ROOT):", "if False:"),
]


def main() -> None:
    out = ROOT / "art/out/d3-mutations"
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for name, file, before, after in MUTANTS:
        path = ROOT / file
        original = path.read_bytes()
        content = original.decode()
        if content.count(before) != 1:
            raise AssertionError(f"mutation anchor changed: {name}")
        test_file = "apps/server/src/bot-flop-buckets-run.test.ts" if file == CLI else "apps/server/src/bot-flop-buckets.test.ts"
        command = ([sys.executable, "ml/test_d3_prepare.py"] if file == PY else
                   ["node", "node_modules/vitest/vitest.mjs", "run", test_file])
        try:
            path.write_bytes(content.replace(before, after, 1).encode())
            run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45)
        finally:
            path.write_bytes(original)
        (out / f"{name}.log").write_text(run.stdout + run.stderr, encoding="utf-8")
        killed = run.returncode != 0 and ("AssertionError" in run.stdout + run.stderr or "FAIL" in run.stdout + run.stderr)
        results.append({"mutation": name, "exit": run.returncode, "killedByAssertion": killed})
        print(results[-1], flush=True)
        if not killed:
            raise AssertionError(f"surviving or invalid mutation: {name}")
    (out / "summary.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()

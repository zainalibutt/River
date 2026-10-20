"""ONE matched D3 ablation. Sequential GPU jobs; six-hour wall-clock guard.

Estimated 75k / RTX 2060 Super: snapshot 2-10m; cache 75-100m on one CPU;
two 100-epoch width-512 fits 10-40m each; two 1800-spot TS exams 5-20m each.
Allow 3-5h total, abort at 6h. Estimates, not measured full-run timings.
--smoke uses 256 training / 8 exam spots, width 32, two epochs, five-minute guard.
Exam is never used for model selection. Best held-out checkpoint rule is identical.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from d3_prepare import ROOT, inside, prepare


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", nargs="+", type=Path, required=True)
    parser.add_argument("--exam", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=75000)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--batch", type=int, default=512)
    parser.add_argument("--seed", type=int, default=203)
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    if args.smoke:
        args.limit, args.epochs, args.width, args.batch = 256, 2, 32, 64
    import numpy  # fail before the expensive cache stage if dependencies are absent
    import torch
    if not args.smoke:
        if not torch.cuda.is_available():
            raise RuntimeError("night run requires CUDA; use --smoke for CPU")
    out = inside(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + (295 if args.smoke else 6 * 3600)
    environment = {**os.environ, "CUBLAS_WORKSPACE_CONFIG": ":4096:8", "OMP_NUM_THREADS": "2"}
    stages = {}

    def run(name: str, command: list[str]) -> str:
        print(f"{name}: {' '.join(command)}", flush=True)
        t = time.monotonic()
        with (out / f"{name}.log").open("w") as log:
            result = subprocess.run(command, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                    timeout=max(1, deadline - t), check=False)
        stages[name] = round(time.monotonic() - t, 3)
        text = (out / f"{name}.log").read_text()
        print(text[-3000:], flush=True)
        if result.returncode:
            raise RuntimeError(f"{name}: exit {result.returncode}; see {out / (name + '.log')}")
        return text

    snapshot = prepare(args.data, out / "data", args.limit)
    exam_manifest = json.loads((args.exam / "manifest.json").read_text())
    if exam_manifest.get("turnCards") != 0:
        raise ValueError("exam must use all 49 turn cards (turnCards=0)")
    exam = prepare([args.exam], out / "exam", 20 if args.smoke else 1000000)
    # The regular snapshot helper needs >=20 training rows; smoke exams use 20 then grade 8.
    training_ids = set()
    import struct
    from d3_prepare import RECORD_BYTES
    for folder, collecting in ((out / "data", True), (out / "exam", False)):
        seed = json.loads((folder / "manifest.json").read_text())["runSeed"]
        for path in folder.glob("*.bin"):
            raw = path.read_bytes()
            for at in range(0, len(raw), RECORD_BYTES):
                identity = (seed, *struct.unpack_from("<IH", raw, at + 16))
                if collecting:
                    training_ids.add(identity)
                elif identity in training_ids:
                    raise ValueError("training/exam identity overlap")
    tsx = ["node", "--import", "tsx"]
    run("cache", [*tsx, "apps/server/src/bot-flop-buckets-run.ts", str(out / "data")])
    results = []
    descriptions = []
    for name in ("baseline", "potential"):
        model_dir = out / name
        command = [sys.executable, "ml/train_river_buckets.py", str(out / "data"), str(model_dir),
                   "--epochs", str(args.epochs), "--width", str(args.width), "--batch", str(args.batch),
                   "--seed", str(args.seed), "--depth", "3", "--buckets", "128"]
        if name == "potential":
            command += ["--flop-buckets", "32x4"]
        run(f"train-{name}", command)
        stem = model_dir / "river-buckets-128"
        descriptions.append(json.loads(stem.with_suffix(".json").read_text()))
        parity = out / f"parity-{name}.json"
        run(f"export-parity-{name}", [sys.executable, "ml/export_value_parity.py", str(out / "data"), str(parity), "--d3-model", str(stem)])
        run(f"check-parity-{name}", [*tsx, "apps/server/src/bot-d3-parity-run.ts", str(parity)])
        grading = [*tsx, "apps/server/src/bot-flop-end-check.ts", str(out / "exam"), str(stem)]
        if args.smoke:
            grading += ["8"]
        text = run(f"exam-{name}", grading)
        for band, spots, every, held in re.findall(
                r"^\s+(.*?)\s+(\d+) spots \| every holding\s+([\d.]+)% \| held hands\s+([\d.]+)%", text, re.M):
            results.append({"model": name, "band": band, "spots": int(spots), "every_pct": float(every), "held_pct": float(held)})
    for key in ("seed", "epochs", "width", "depth", "inputs", "outputs", "splitSHA256", "trainingSpots", "validationSpots"):
        if descriptions[0][key] != descriptions[1][key]:
            raise AssertionError(f"unmatched {key}")
    if not results or len([r for r in results if r["band"] == "all spots"]) != 2:
        raise RuntimeError("missing exam results")
    with (out / "summary.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(results[0]))
        writer.writeheader()
        writer.writerows(results)
    summary = {"smoke": args.smoke, "settings": vars(args), "trainSpots": snapshot["spots"],
               "examSnapshotSpots": exam["spots"], "splitSHA256": descriptions[0]["splitSHA256"],
               "stagesSeconds": stages, "elapsedSeconds": time.monotonic() - started, "results": results}
    (out / "summary.json").write_text(json.dumps(summary, default=str, indent=2) + "\n")
    print((out / "summary.csv").read_text())


if __name__ == "__main__":
    main()

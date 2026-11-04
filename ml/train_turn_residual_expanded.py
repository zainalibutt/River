"""D8 part 3. Sequential matched held-hand fits; exact c1/c2 evaluation.

Baseline is retrained from the historical c1 checkpoint. Each seed's residual
variants start from that seed's newly retrained baseline, including joint mode.
"""
from __future__ import annotations
import os
import sys
sys.dont_write_bytecode = True
for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[name] = '2'
os.environ['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'
import argparse
import hashlib
import json
import threading
import time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from turn_residual import INPUTS, TurnResidual, export_mlp, load_mlp
from train_turn_residual import exact_evaluation, feature_parity, inside
from turn_residual_expanded import C1_SHA, ExpandedCache


def train(args):
    out = inside(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = out / f'{args.model}-{args.seed}'
    result_path = stem.with_suffix('.result.json')
    result_path.unlink(missing_ok=True)
    cache = ExpandedCache(inside(args.cache))
    feature_error = feature_parity(cache.root)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    if args.require_cuda and device.type != 'cuda':
        raise RuntimeError('CUDA required')
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    model = TurnResidual(args.model == 'residual', 128, 2, 0., args.joint).to(device)
    source_meta = json.loads(args.bucket_model.with_suffix('.json').read_text())
    expected_split = C1_SHA if args.model == 'baseline' else cache.split['splitSHA256']
    if source_meta.get('splitSHA256') != expected_split or source_meta.get('target') != 'turn-start/per-river-v1':
        raise ValueError('bucket checkpoint split/target mismatch')
    if args.model == 'residual' and (source_meta.get('seed') != args.seed or source_meta.get('experiment') != 'd8-expanded'):
        raise ValueError('residual must start from its matched, retrained baseline seed')
    if args.model == 'residual' and source_meta.get('snapshotSHA256') != cache.meta['snapshotSHA256']:
        raise ValueError('baseline was trained on a different source snapshot')
    reference = load_mlp(args.bucket_model).to(device).requires_grad_(False)
    model.bucket.load_state_dict(reference.state_dict(), strict=True)
    bucket_sha = hashlib.sha256(args.bucket_model.with_suffix('.bin').read_bytes() + args.bucket_model.with_suffix('.json').read_bytes()).hexdigest()
    started = time.monotonic()
    timeout_path = out / f'{args.model}-{args.seed}-timeout.json'
    timeout_path.unlink(missing_ok=True)
    def timeout():
        timeout_path.write_text(json.dumps(dict(complete=False, deadlineSeconds=args.max_seconds)))
        os._exit(124)
    timer = threading.Timer(args.max_seconds, timeout)
    timer.daemon = True
    timer.start()
    train_index = np.array(cache.split['training'], dtype=np.int64)
    calibration_sets = {name: np.array(ids, dtype=np.int64) for name, ids in cache.split['calibrationSets'].items()}
    optimiser = torch.optim.Adam((p for p in model.parameters() if p.requires_grad), lr=args.lr)
    steps = (len(train_index) + 511) // 512
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, args.epochs * steps)
    rng = np.random.default_rng(args.seed + 12345)
    loss_fn = nn.SmoothL1Loss(beta=.1)
    best, state, best_epoch, best_calibration = float('inf'), None, None, None
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = rng.permutation(train_index)
        for start in range(0, len(order), 512):
            batch = cache.batch(order[start:start+512], device)
            prediction = model(batch['x'], batch['holding'], batch['bucket'])
            loss = loss_fn(prediction, batch['y'])
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
            schedule.step()
        model.eval()
        totals, counts, calibration = {}, {}, {}
        with torch.no_grad():
            for name, ids in calibration_sets.items():
                totals[name], counts[name] = 0., 0
                for start in range(0, len(ids), 512):
                    batch = cache.batch(ids[start:start+512], device)
                    errors = (model(batch['x'], batch['holding'], batch['bucket']) - batch['y']).abs()
                    totals[name] += errors.sum().item()
                    counts[name] += errors.numel()
                calibration[name] = 100 * totals[name] / counts[name]
        error = sum(totals.values()) / sum(counts.values())
        if error < best:
            best, best_epoch, best_calibration = error, epoch, calibration
            state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
        if epoch == 1 or epoch % 10 == 0:
            print(f'{args.model} seed {args.seed} epoch {epoch}: calibration c1={calibration["c1"]:.4f}, c2={calibration["c2"]:.4f}, {time.monotonic()-started:.1f}s', flush=True)
    model.load_state_dict(state)
    fit_seconds = time.monotonic() - started
    metadata = dict(experiment='d8-expanded', seed=args.seed, epochs=args.epochs, hidden=128, layers=2,
                    dropout=0, lr=args.lr, joint=args.joint, bucketSHA256=bucket_sha,
                    splitSHA256=cache.split['splitSHA256'], historicalSplitSHA256=C1_SHA,
                    snapshotSHA256=cache.meta['snapshotSHA256'], target='turn-start/per-river-v1')
    export_mlp(model.bucket, Path(str(stem) + '-bucket'), **metadata)
    if model.head is not None:
        export_mlp(model.head, Path(str(stem) + '-head'), **metadata)
        stem.with_suffix('.json').write_text(json.dumps(dict(version=1, inputs=INPUTS, headShape=[INPUTS, 128, 128, 1], **metadata), indent=2) + '\n')
    # Evaluate both cohorts in one streaming pass, full holdings and range weights.
    metrics, reference_metrics = exact_evaluation(model, cache.root, cache.split, device, reference,
                                                  test_sets=cache.split['testSets'])
    tests = {name: dict(spots=len(ids), metrics=metrics[name], baselineMetrics=reference_metrics[name])
             for name, ids in cache.split['testSets'].items()}
    result = dict(model=args.model, **metadata, bestEpoch=best_epoch, calibrationMAE=100*best,
                  calibrationByCohort=best_calibration, featureParityMax=feature_error, complete=True,
                  device=str(device), tests=tests, fitSeconds=fit_seconds,
                  evaluationSeconds=time.monotonic()-started-fit_seconds, seconds=time.monotonic()-started)
    if result['seconds'] >= args.max_seconds:
        timeout()
    result_path.write_text(json.dumps(result, indent=2) + '\n')
    timer.cancel()
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--model', choices=['baseline', 'residual'], required=True)
    parser.add_argument('--seed', type=int, choices=(0, 1, 2), required=True)
    parser.add_argument('--bucket-model', type=Path, required=True)
    parser.add_argument('--joint', action='store_true')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--lr', type=float, default=.001)
    parser.add_argument('--max-seconds', type=int, default=3600)
    parser.add_argument('--require-cuda', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.max_seconds <= 3600 or args.epochs < 1 or not 0 < args.lr < float('inf') or (args.joint and args.model != 'residual'):
        parser.error('invalid hyperparameters')
    train(args)

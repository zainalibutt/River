"""Matched D8 experiment. All writes remain in the worktree; no git operations.

First run the TS diagnose/prepare commands in ml/D8.md. Train one model per
process; the 540-second wall deadline stops BEFORE ten minutes, with incomplete
runs recorded as failures (never accepted as a matched 50-epoch ablation).
"""
from __future__ import annotations
import os
import sys
sys.dont_write_bytecode = True
os.environ['OMP_NUM_THREADS'] = '2'
os.environ['MKL_NUM_THREADS'] = '2'
os.environ['OPENBLAS_NUM_THREADS'] = '2'
os.environ['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'
import argparse
import hashlib
import json
import time
import threading
from pathlib import Path
import numpy as np
import torch
from torch import nn
from turn_residual import INPUTS, TurnResidual, export_mlp, residual_features, static_features
from river_value_data import RECORD
from train_river_buckets import bucket_features

ROOT = Path(__file__).resolve().parents[1]


def inside(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('all outputs must be inside this worktree')
    return path


def read_cache(out):
    meta = json.loads((out / 'cache.json').read_text())
    snapshot = (out / 'snapshot.json').read_bytes()
    if hashlib.sha256(snapshot).hexdigest() != meta['snapshotSHA256']:
        raise ValueError('snapshot changed')
    arrays = {key: [] for key in ('x', 'holding', 'bucket', 'y')}
    rows = []
    for part in range(meta['parts']):
        stem = out / f'sample-{part:05d}'
        info = json.loads(stem.with_suffix('.json').read_text())
        n, k = len(info['rows']), info['samples']
        rows.extend(info['rows'])
        shapes = dict(x=(n, 385), holding=(n, 2, k, INPUTS), bucket=(n, 2, k), y=(n, 2, k))
        for key, shape in shapes.items():
            raw = Path(str(stem) + f'-{key}.bin').read_bytes()
            if hashlib.sha256(raw).hexdigest() != info['sha256'][key]:
                raise ValueError(f'cache changed: {stem}-{key}')
            arrays[key].append(np.frombuffer(raw, dtype=np.uint8 if key == 'bucket' else '<f4').reshape(shape))
    if rows != list(range(meta['spots'])):
        raise ValueError('cache row order changed')
    return {key: torch.from_numpy(np.concatenate(parts)) for key, parts in arrays.items()}


def feature_parity(out):
    """Independently rebuild TS features before trusting any training cache."""
    fixture = json.loads((out / 'feature-cases.json').read_text())
    worst = 0.0
    for c in fixture['cases']:
        ranks = np.array(c['ranks'], dtype=np.uint16)
        static = static_features(np.array(c['board']), ranks)
        expected = np.array(c['static'], dtype=np.float32).reshape(1326, 19)
        error = float(np.max(np.abs(static - expected)))
        worst = max(worst, error)
        features = residual_features(static, np.array(c['ranges']), np.array(c['bucketOutputs']), np.array(c['bucket']), c['stack'], c['pot'])
        worst = max(worst, float(np.max(np.abs(features.ravel() - np.array(c['residualInputs'])))))
    if worst > 1e-6:
        raise AssertionError(f'TS/NumPy features disagree: {worst}')
    return worst


def exact_evaluation(model, out, split, device):
    """Report every legal holding, range-weighted; never sampled-cache test MAE."""
    snapshot = json.loads((out / 'snapshot.json').read_text())
    selected = set(split['test'])
    metrics = {}
    offset = 0
    model.eval()
    with torch.no_grad():
        for shard in snapshot['shards']:
            path = Path(shard['path'])
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != shard['sha256']:
                raise ValueError(f'source changed: {path}')
            n = shard['rows']
            keep = [i for i in range(n) if offset + i in selected]
            offset += n
            if not keep:
                continue
            records = np.frombuffer(raw, dtype=RECORD)[keep].copy()
            base = bucket_features(records, 128)
            for i, row in enumerate(records):
                static = static_features(row['board'][:4], row['strength_rank'])
                ids = base['bucket'][i]
                features = residual_features(static, row['ranges'], np.zeros(256), ids, float(row['stack']), float(row['pot']))
                x = torch.from_numpy(base['x'][i:i+1]).to(device)
                f = torch.from_numpy(features[None]).to(device)
                b = torch.from_numpy(np.tile(np.maximum(ids, 0)[None, None, :], (1, 2, 1))).to(device)
                predicted = model(x, f, b).cpu().numpy()[0]
                error = np.abs(predicted - row['values'])
                weights = row['ranges'].astype(np.float64) * (ids >= 0)[None, :]
                weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-300)
                masks = {'all': ids >= 0, 'flush-draw': static[:, 4] > 0, 'straight-draw': static[:, 5] > 0,
                         'trips-or-better': static[:, 3] >= 3 / 8, 'nut-flush-blocker': static[:, 12] > 0}
                counts = np.bincount(row['board'][:4] // 13, minlength=4)
                texture = 'monotone' if counts.max() >= 3 else 'two-tone' if counts.max() == 2 else 'rainbow'
                masks[texture] = ids >= 0
                masks['paired' if len(set(row['board'][:4] % 13)) < 4 else 'unpaired'] = ids >= 0
                if float(row['stack'] / row['pot']) > 10:
                    masks['over10pots'] = ids >= 0
                for name, mask in masks.items():
                    total, mass = metrics.get(name, (0., 0.))
                    metrics[name] = (total + float((error * weights * mask).sum()), mass + float((weights * mask).sum()))
    return {name: 100 * total / mass for name, (total, mass) in metrics.items() if mass > 0}


def train(args):
    out = inside(args.out)
    feature_error = feature_parity(out)
    split = json.loads((out / 'split.json').read_text())
    order = np.random.default_rng(0).permutation(53550)
    if (hashlib.sha256(order.astype('<i8').tobytes()).hexdigest() != split['splitSHA256']
        or split['test'] != order[:5355].tolist()
        or split['calibration'] != order[5355:8032].tolist()
        or split['training'] != order[8032:].tolist()):
        raise ValueError('frozen split changed')
    if args.seed not in split['seeds']:
        raise ValueError('use the frozen seeds')
    data = read_cache(out)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    if device.type == 'cuda':
        torch.backends.cuda.matmul.allow_tf32 = False
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    model = TurnResidual(args.model == 'residual').to(device)
    # Fit clock includes transfer, epoch selection and exact test scoring.
    # Independent watchdog enforces a hard process bound even during a slow op.
    started = time.monotonic()
    def timeout():
        (out / f'{args.model}-{args.seed}-timeout.json').write_text(json.dumps({'complete': False, 'deadlineSeconds': 540}))
        os._exit(124)
    timer = threading.Timer(540, timeout)
    timer.daemon = True
    timer.start()
    data = {key: value.to(device) for key, value in data.items()}
    train_index = torch.tensor(split['training'], device=device)
    valid = torch.tensor(split['calibration'], device=device)
    optimiser = torch.optim.Adam(model.parameters(), lr=1e-3)
    steps_per_epoch = (len(train_index) + 511) // 512
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, 50 * steps_per_epoch)
    generator = torch.Generator(device=device).manual_seed(args.seed + 12345)
    loss_fn = nn.SmoothL1Loss(beta=0.1)
    best, state, best_epoch = float('inf'), None, None
    for epoch in range(1, 51):
        model.train()
        order = train_index[torch.randperm(len(train_index), generator=generator, device=device)]
        for index in order.split(512):
            prediction = model(data['x'][index], data['holding'][index], data['bucket'][index])
            loss = loss_fn(prediction, data['y'][index])
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
            schedule.step()
        model.eval()
        total, count = 0., 0
        with torch.no_grad():
            for index in valid.split(512):
                errors = (model(data['x'][index], data['holding'][index], data['bucket'][index]) - data['y'][index]).abs()
                total += errors.sum().item()
                count += errors.numel()
        error = total / count
        if error < best:
            best, best_epoch = error, epoch
            state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        if epoch == 1 or epoch % 10 == 0:
            print(f'{args.model} seed {args.seed} epoch {epoch}: calibration {100*error:.4f}%, {time.monotonic()-started:.1f}s', flush=True)
    model.load_state_dict(state)
    stem = out / f'{args.model}-{args.seed}'
    metadata = dict(seed=args.seed, epochs=50, splitSHA256=split['splitSHA256'], target='turn-start/per-river-v1')
    export_mlp(model.bucket, Path(str(stem) + '-bucket'), **metadata)
    if model.head is not None:
        export_mlp(model.head, Path(str(stem) + '-head'), **metadata)
        stem.with_suffix('.json').write_text(json.dumps(dict(version=1, inputs=INPUTS, **metadata), indent=2) + '\n')
    del data
    result = dict(model=args.model, seed=args.seed, epochs=50, bestEpoch=best_epoch,
                  calibrationMAE=100*best, featureParityMax=feature_error, complete=True,
                  splitSHA256=split['splitSHA256'], device=str(device), metrics=exact_evaluation(model, out, split, device), seconds=time.monotonic()-started)
    stem.with_suffix('.result.json').write_text(json.dumps(result, indent=2) + '\n')
    timer.cancel()
    print(json.dumps(result), flush=True)


def summarise(out):
    out = inside(out)
    rows = [json.loads((out / f'{m}-{s}.result.json').read_text()) for m in ('baseline', 'residual') for s in (0, 1, 2)]
    if not all(r['complete'] and r['epochs'] == 50 and r['seconds'] < 600 for r in rows) or len({r['splitSHA256'] for r in rows}) != 1:
        raise ValueError('incomplete or unmatched experiment')
    result = {}
    for name in rows[0]['metrics']:
        result[name] = {}
        for model in ('baseline', 'residual'):
            values = np.array([r['metrics'][name] for r in rows if r['model'] == model])
            result[name][model] = dict(mean=float(values.mean()), sd=float(values.std(ddof=1)), minimum=float(values.min()), maximum=float(values.max()), seeds=values.tolist())
        result[name]['improvementPct'] = 100 * (1 - result[name]['residual']['mean'] / result[name]['baseline']['mean'])
    (out / 'ablation.json').write_text(json.dumps(dict(slices=result, clearsD8=result['all']['improvementPct'] >= 20), indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--model', choices=['baseline', 'residual'])
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--summary', action='store_true')
    args = parser.parse_args()
    if args.summary:
        summarise(args.out)
    elif args.model:
        train(args)
    else:
        parser.error('--model or --summary required')

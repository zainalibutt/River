"""D8 live-leaf student: all legal holdings, fixed teacher, solver + residual loss."""
from turn_residual_distill import PackedCache, features, holding_partition, distillation_loss, score
import argparse
import json
import shutil
import time
from pathlib import Path
import numpy as np
import torch
from train_turn_residual import inside, feature_parity
from turn_residual import TurnResidual, export_mlp, load_mlp


def train(args):
    started = time.monotonic()
    out = inside(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = out / f'residual-{args.seed}'
    stem.with_suffix('.result.json').unlink(missing_ok=True)
    cache = PackedCache(args.packed, args.cache, args.teacher)
    feature_error = feature_parity(args.cache)
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA required; no CPU training fallback')
    device = torch.device('cuda')
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    teacher = load_mlp(Path(str(args.teacher) + '-head')).to(device).requires_grad_(False).eval()
    student = TurnResidual(True, args.hidden, args.layers).head.to(device)
    optimiser = torch.optim.Adam(student.parameters(), lr=args.lr)
    ids = np.sort(np.asarray(cache.split['training'], dtype=np.int64))
    blocks = [ids[i:i+512] for i in range(0, len(ids), 512)]
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, args.passes*len(blocks))
    rng = np.random.default_rng(args.seed + 12345)
    # Every pass trains a disjoint holding stripe. No early stopping: the full
    # 16-pass coverage must finish, and selection only sees calibration sets.
    examples = 0
    for epoch in range(args.passes):
        student.train()
        holdings = holding_partition(epoch, args.passes)
        for block in rng.permutation(len(blocks)):
            local, shared = cache.batch(blocks[block], holdings, device)
            x = features(local, shared)
            loss = distillation_loss(student, teacher, x, local[..., 29:31].transpose(1, 2), args.alpha)
            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
            scheduler.step()
            examples += len(blocks[block])*2*len(holdings)
        print(f'pass {epoch+1}/{args.passes}: {time.monotonic()-started:.1f}s, all-holding rows {examples}', flush=True)
    expected = len(ids)*2*1128
    if examples != expected:
        raise AssertionError('all-holding coverage incomplete')
    torch.cuda.synchronize()
    fit_seconds = time.monotonic()-started
    calibration = score(student, cache, cache.split['calibrationSets'], device)
    # Test cohorts do not participate in architecture selection.
    tests = score(student, cache, cache.split['testSets'], device)
    metadata = dict(experiment='d8-distill', seed=args.seed, hidden=args.hidden, layers=args.layers,
                    passes=args.passes, alpha=args.alpha, lr=args.lr, joint=False,
                    splitSHA256=cache.meta['splitSHA256'], snapshotSHA256=cache.meta['snapshotSHA256'],
                    teacherSHA256=cache.meta['teacherSHA256'], target='turn-start/per-river-v1')
    for suffix in ('.json', '.bin'):
        shutil.copyfile(Path(str(args.teacher)+'-bucket'+suffix), Path(str(stem)+'-bucket'+suffix))
    export_mlp(student, Path(str(stem)+'-head'), **metadata)
    stem.with_suffix('.json').write_text(json.dumps(dict(version=1, inputs=65,
        headShape=[65]+[args.hidden]*args.layers+[1], **metadata), indent=2)+'\n')
    result = dict(**metadata, complete=True, device='cuda', featureParityMax=feature_error,
                  coverageRows=examples, expectedRows=expected, fitSeconds=fit_seconds,
                  seconds=time.monotonic()-started, calibration=calibration,
                  tests={k: dict(spots=len(cache.split['testSets'][k]), metrics=v) for k,v in tests.items()})
    stem.with_suffix('.result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('out', 'packed', 'cache', 'teacher'):
        parser.add_argument('--'+key, type=Path, required=True)
    parser.add_argument('--seed', type=int, choices=(0,1,2), required=True)
    parser.add_argument('--hidden', type=int, choices=(16,32), required=True)
    parser.add_argument('--layers', type=int, choices=(1,2), default=1)
    parser.add_argument('--passes', type=int, default=16)
    parser.add_argument('--lr', type=float, default=.001)
    parser.add_argument('--alpha', type=float, default=1.)
    args = parser.parse_args()
    if not 1 <= args.passes <= 1128 or not 0 < args.lr < 1 or not 0 <= args.alpha < float('inf'):
        parser.error('invalid coverage/loss settings')
    train(args)

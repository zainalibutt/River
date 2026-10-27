"""D8 live-leaf student: all legal holdings, fixed teacher, solver + residual loss."""
from turn_residual_distill import (PackedCache, holding_partition, cached_distillation_loss,
                                   row_features, stripe_rows, score)
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
    if not args.smoke:
        stem.with_suffix('.result.json').unlink(missing_ok=True)
    cache = PackedCache(inside(args.packed), args.cache, args.teacher)
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
    chunks = []
    steps = 0
    for start in range(0, cache.meta['spots'], args.chunk_spots):
        stop = min(start + args.chunk_spots, cache.meta['spots'])
        count = int(np.searchsorted(ids, stop) - np.searchsorted(ids, start))
        if count:
            chunks.append((start, stop))
            steps += sum((count*2*len(holding_partition(e, args.passes)) + args.batch_rows-1)
                         // args.batch_rows for e in range(args.passes))
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, steps)
    # Chunk-major traversal intentionally changes SGD order. Each chunk stays on
    # GPU for all 16 disjoint stripes; every training row still appears once.
    # Smoke runs stripe 0 of the same 16-stripe plan, never a one-stripe refit.
    examples = 0
    pass_seconds = [0.] * (1 if args.smoke else args.passes)
    load_seconds = target_seconds = target_read_seconds = 0.
    new_target_chunks = 0
    setup_seconds = time.monotonic() - started
    student.train()
    for chunk, (start, stop) in enumerate(chunks):
        tick = time.monotonic()
        local, shared = cache.training_chunk(start, stop, ids, device)
        torch.cuda.synchronize()
        load_seconds += time.monotonic() - tick
        tick = time.monotonic()
        targets, created = cache.teacher_targets(teacher, local, shared, start, stop, args.batch_rows)
        torch.cuda.synchronize()
        target_seconds += time.monotonic() - tick
        new_target_chunks += int(created)
        if args.smoke:
            # Measure a warm target read as well, rather than pretending cached
            # targets have zero cost in the full-plan projection.
            tick = time.monotonic()
            targets, rebuilt = cache.teacher_targets(teacher, local, shared, start, stop, args.batch_rows)
            torch.cuda.synchronize()
            target_read_seconds += time.monotonic() - tick
            if rebuilt:
                raise AssertionError('fresh teacher-target shard failed reuse validation')
        for epoch in range(len(pass_seconds)):
            tick = time.monotonic()
            rows = stripe_rows(len(local), epoch, args.passes, device)
            rows = rows[torch.randperm(len(rows), device=device)]
            for offset in range(0, len(rows), args.batch_rows):
                batch = rows[offset:offset+args.batch_rows]
                x, solver = row_features(local, shared, batch)
                loss = cached_distillation_loss(student, x, solver, targets[batch], args.alpha)
                optimiser.zero_grad(set_to_none=True)
                loss.backward()
                optimiser.step()
                scheduler.step()
            examples += len(rows)
            torch.cuda.synchronize()
            pass_seconds[epoch] += time.monotonic() - tick
        del local, shared, targets, rows, batch, x, solver, loss
        print(f'chunk {chunk+1}/{len(chunks)}: elapsed {(time.monotonic()-started)/60:.2f} min; '
              f'load {load_seconds:.1f}s, targets {target_seconds:.1f}s, '
              f'student {sum(pass_seconds):.1f}s, rows {examples}', flush=True)
    expected = len(ids)*2*1128
    if examples != (len(ids)*2*len(holding_partition(0, args.passes)) if args.smoke else expected):
        raise AssertionError('all-holding coverage incomplete')
    torch.cuda.synchronize()
    fit_seconds = time.monotonic()-started
    timing = dict(setupSeconds=setup_seconds, chunkLoadSeconds=load_seconds,
                  teacherTargetSeconds=target_seconds, newTeacherChunks=new_target_chunks,
                  cachedTargetReadSeconds=target_read_seconds,
                  studentPassSeconds=pass_seconds, batchRows=args.batch_rows, chunkSpots=args.chunk_spots)
    if args.smoke:
        # The 70-row first stripe is slightly smaller than the other stripes.
        full_student = pass_seconds[0] * 1128 / len(holding_partition(0, args.passes))
        smoke = dict(complete=True, smoke=True, device='cuda', seed=args.seed, hidden=args.hidden,
                     layers=args.layers, passes=1, planPasses=args.passes, coverageRows=examples,
                     expectedRows=expected, seconds=fit_seconds, secondsPerPass=pass_seconds[0],
                     amortizedSecondsPerPass=fit_seconds,
                     warmH16FitSeconds=setup_seconds+load_seconds+target_read_seconds+full_student,
                     projectionNote='Student-only stripe time; warm fit includes measured setup and chunk loads. '
                                    'Teacher targets are now cached; timing is a projection, not a speed guarantee.',
                     **timing)
        (out / 'smoke.json').write_text(json.dumps(smoke, indent=2)+'\n')
        print(json.dumps(smoke), flush=True)
        return
    evaluation_started = time.monotonic()
    calibration = score(student, cache, cache.split['calibrationSets'], device)
    # Test cohorts do not participate in architecture selection.
    tests = score(student, cache, cache.split['testSets'], device)
    metadata = dict(experiment='d8-distill', seed=args.seed, hidden=args.hidden, layers=args.layers,
                    passes=args.passes, alpha=args.alpha, lr=args.lr, joint=False,
                    splitSHA256=cache.meta['splitSHA256'], snapshotSHA256=cache.meta['snapshotSHA256'],
                    teacherSHA256=cache.meta['teacherSHA256'], target='turn-start/per-river-v1',
                    feedVersion=2, traversal='chunk-major/disjoint-holding-stripes')
    for suffix in ('.json', '.bin'):
        shutil.copyfile(Path(str(args.teacher)+'-bucket'+suffix), Path(str(stem)+'-bucket'+suffix))
    export_mlp(student, Path(str(stem)+'-head'), **metadata)
    stem.with_suffix('.json').write_text(json.dumps(dict(version=1, inputs=65,
        headShape=[65]+[args.hidden]*args.layers+[1], **metadata), indent=2)+'\n')
    result = dict(**metadata, complete=True, device='cuda', featureParityMax=feature_error,
                  coverageRows=examples, expectedRows=expected, fitSeconds=fit_seconds,
                  evaluationSeconds=time.monotonic()-evaluation_started, timing=timing,
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
    parser.add_argument('--batch-rows', type=int, default=65536)
    parser.add_argument('--chunk-spots', type=int, default=2048)
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    if (not 1 <= args.passes <= 1128 or not 0 < args.lr < 1 or not 0 <= args.alpha < float('inf')
            or not 1 <= args.batch_rows <= 65536 or not 1 <= args.chunk_spots <= 2048):
        parser.error('invalid coverage/loss settings')
    if args.smoke and (args.hidden != 16 or args.layers != 1 or args.seed != 0 or args.passes != 16):
        parser.error('smoke measures h16 seed 0, one pass of the 16-pass plan')
    train(args)

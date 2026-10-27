"""Accept nine completed matched fits; always report both held-out cohorts."""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import numpy as np
from train_turn_residual import inside
from turn_residual_expanded import C1_SHA


def summarise(out, epochs, max_seconds):
    fits, rows = {}, []
    for config in ('baseline', 'frozen', 'joint'):
        model = 'baseline' if config == 'baseline' else 'residual'
        fits[config] = [json.loads((out / config / f'{model}-{seed}.result.json').read_text()) for seed in range(3)]
        for seed, result in enumerate(fits[config]):
            if (not result['complete'] or result['epochs'] != epochs or result['seed'] != seed or
                result['seconds'] >= max_seconds or result['device'] != 'cuda' or
                result['historicalSplitSHA256'] != C1_SHA or result['model'] != model or
                result['joint'] != (config == 'joint') or result['hidden'] != 128 or result['layers'] != 2 or
                set(result['tests']) != {'c1', 'c2'} or result['tests']['c1']['spots'] != 5355):
                raise ValueError(f'incomplete/unmatched {config} seed {seed}')
    all_fits = sum(fits.values(), [])
    for key in ('splitSHA256', 'snapshotSHA256', 'lr'):
        if len({r[key] for r in all_fits}) != 1:
            raise ValueError(f'unmatched {key}')
    if len({r['bucketSHA256'] for r in fits['baseline']}) != 1:
        raise ValueError('baseline fits have different initial checkpoints')
    import hashlib
    for seed in range(3):
        stem = out / 'baseline' / f'baseline-{seed}-bucket'
        digest = hashlib.sha256(stem.with_suffix('.bin').read_bytes() + stem.with_suffix('.json').read_bytes()).hexdigest()
        for config in ('frozen', 'joint'):
            result = fits[config][seed]
            if result['bucketSHA256'] != digest:
                raise ValueError('residual source is not the matched retrained baseline')
            for cohort in ('c1', 'c2'):
                if not np.isclose(result['tests'][cohort]['baselineMetrics']['all'], fits['baseline'][seed]['tests'][cohort]['metrics']['all'], atol=1e-6, rtol=1e-7):
                    raise ValueError('exact reference score differs from matched baseline')
            if config == 'frozen':
                frozen = out / config / f'residual-{seed}-bucket.bin'
                if frozen.read_bytes() != stem.with_suffix('.bin').read_bytes():
                    raise ValueError('frozen bucket weights changed')
    for cohort in ('c1', 'c2'):
        sizes = {r['tests'][cohort]['spots'] for r in all_fits}
        if len(sizes) != 1 or next(iter(sizes)) < 1:
            raise ValueError('test cohort sizes differ')
        slices = set(fits['baseline'][0]['tests'][cohort]['metrics'])
        if any(set(r['tests'][cohort]['metrics']) != slices for r in all_fits):
            raise ValueError('test slices differ')
        for name in sorted(slices):
            base = np.array([r['tests'][cohort]['metrics'][name] for r in fits['baseline']])
            for config in ('baseline', 'frozen', 'joint'):
                values = np.array([r['tests'][cohort]['metrics'][name] for r in fits[config]])
                if not np.isfinite(values).all() or not np.isfinite(base).all() or base.mean() <= 0:
                    raise ValueError('non-finite/invalid score')
                improvement = 100 * (1 - values.mean() / base.mean())
                rows.append(dict(cohort=cohort, testSpots=next(iter(sizes)), slice=name, config=config,
                    seeds=3, epochs=epochs, baselineMAE=float(base.mean()), maeMean=float(values.mean()),
                    maeSD=float(values.std(ddof=1)), minimum=float(values.min()), maximum=float(values.max()),
                    improvementPct=float(improvement), clears20Pct=bool(improvement >= 20),
                    fitSecondsMean=float(np.mean([r['fitSeconds'] for r in fits[config]])),
                    evaluationSecondsMean=float(np.mean([r['evaluationSeconds'] for r in fits[config]]))))
    with (out / 'summary.csv').open('w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    report = dict(rows=rows, fits=fits, historicalSplitSHA256=C1_SHA,
                  note='Both cohorts reported separately. All configurations predeclared; no test-based selection.')
    (out / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
    lines = ['| Test cohort | Spots | Config | MAE mean | Sample SD | Improvement % | 20% gate | Fit s | Evaluation s |',
             '| --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: |']
    for row in rows:
        if row['slice'] == 'all':
            lines.append('| {cohort} | {testSpots} | {config} | {maeMean:.4f} | {maeSD:.4f} | {improvementPct:.2f} | {clears20Pct} | {fitSecondsMean:.1f} | {evaluationSecondsMean:.1f} |'.format(**row))
    lines += ['', 'All holding/board/deep-stack slices and per-seed results for both cohorts are in summary.csv/json.',
              'Baseline is retrained with held-hand loss on c1+c2; residuals start from the same-seed baseline.',
              'Calibration pools c1+c2 by spot count; tests never choose epochs or configurations.']
    (out / 'summary.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--epochs', type=int, required=True)
    parser.add_argument('--max-seconds', type=int, required=True)
    args = parser.parse_args()
    summarise(inside(args.out), args.epochs, args.max_seconds)

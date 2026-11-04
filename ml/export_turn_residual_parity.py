"""Actual CPU PyTorch forward fixtures for trained D8 exports (absolute 1e-5 gate)."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from turn_residual import load_mlp, residual_features, static_features
from train_turn_residual import ROOT, inside, feature_parity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--cache', type=Path)
    args = parser.parse_args()
    out = inside(args.out)
    cache = inside(args.cache or out)
    feature_error = feature_parity(cache)
    stem = out / f'residual-{args.seed}'
    bucket = load_mlp(Path(str(stem)+'-bucket'))
    head = load_mlp(Path(str(stem)+'-head'))
    cases = json.loads((cache/'feature-cases.json').read_text())['cases']
    # Add an empty-opponent stress case without using target values.
    empty = dict(cases[0])
    empty['ranges'] = [cases[0]['ranges'][0], [0.0] * 1326]
    # Rebuild bucket inputs independently for the empty range.
    empty['inputs'] = list(cases[0]['inputs'])
    empty['inputs'][129:257] = [0.0] * 128
    cases.append(empty)
    result = []
    with torch.no_grad():
        for c in cases:
            base = bucket(torch.tensor(c['inputs'], dtype=torch.float32)[None]).numpy()[0]
            static = static_features(np.array(c['board']), np.array(c['ranks'], dtype=np.uint16))
            ids = np.array(c['bucket'])
            local = residual_features(static, np.array(c['ranges']), base, ids, c['stack'], c['pot'])
            delta = head(torch.from_numpy(local)).squeeze(-1).numpy()
            values = np.stack([base[p * 128 + np.maximum(ids, 0)] for p in (0, 1)]) + delta
            values[:, ids < 0] = 0
            result.append({k: c[k] for k in ('board', 'ranks', 'ranges', 'stack', 'pot')} | dict(static=static.ravel().tolist(), inputs=local.ravel().tolist(), values=values.tolist()))
    target = out / f'parity-{args.seed}.json'
    target.write_text(json.dumps(dict(model=stem.relative_to(ROOT).as_posix(), featureParityMax=feature_error, cases=result)) + '\n')
    print(f'{target}: {len(result)} actual PyTorch cases, feature max {feature_error}')


if __name__ == '__main__':
    main()

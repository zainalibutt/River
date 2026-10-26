"""Actual CPU PyTorch forward fixtures for trained D8 exports (absolute 1e-5 gate)."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from turn_residual import INPUTS, residual_features, static_features
from train_turn_residual import inside, feature_parity
from train_river_buckets import mlp


def load(stem, inputs, outputs, width, depth):
    model = mlp(inputs, outputs, width, depth)
    meta = json.loads(stem.with_suffix('.json').read_text())
    raw = np.fromfile(stem.with_suffix('.bin'), dtype='<f4')
    state = {}
    for tensor in meta['tensors']:
        start = tensor['offset'] // 4
        n = int(np.prod(tensor['shape']))
        state[tensor['name']] = torch.from_numpy(raw[start:start+n].reshape(tensor['shape']).copy())
    model.load_state_dict(state)
    return model.eval()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=0)
    args = parser.parse_args()
    out = inside(args.out)
    feature_error = feature_parity(out)
    stem = out / f'residual-{args.seed}'
    bucket = load(Path(str(stem)+'-bucket'), 385, 256, 512, 3)
    head = load(Path(str(stem)+'-head'), INPUTS, 1, 16, 1)
    cases = json.loads((out/'feature-cases.json').read_text())['cases']
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
    target.write_text(json.dumps(dict(model=str(stem), featureParityMax=feature_error, cases=result)) + '\n')
    print(f'{target}: {len(result)} actual PyTorch cases, feature max {feature_error}')


if __name__ == '__main__':
    main()

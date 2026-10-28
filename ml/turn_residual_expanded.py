"""Version-2 D8 cache: verified RAM arrays, only one minibatch copied to CUDA."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
import torch

C1_SPOTS = 53550
C1_SHA = 'e70b66b41f6d7c1dbf145e849efc3eed401cb6058e5abe77f5e8d2d2f62e4f1c'


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def validate_split(split, spots):
    c1 = np.random.default_rng(0).permutation(C1_SPOTS)
    if hashlib.sha256(c1.astype('<i8').tobytes()).hexdigest() != C1_SHA:
        raise ValueError('NumPy historical permutation changed')
    c2 = np.random.default_rng(0).permutation(spots - C1_SPOTS) + C1_SPOTS
    test_end = len(c2) // 10
    calibration_end = test_end + len(c2) // 20
    tests = dict(c1=c1[:5355].tolist(), c2=c2[:test_end].tolist())
    calibrations = dict(c1=c1[5355:8032].tolist(), c2=c2[test_end:calibration_end].tolist())
    training = np.concatenate((c1[8032:], c2[calibration_end:])).tolist()
    calibration = calibrations['c1'] + calibrations['c2']
    # Same property order and compact JSON as the TS preparer.
    payload = dict(training=training, calibration=calibration, testSets=tests)
    digest = hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest()
    if (split.get('version') != 2 or split.get('historicalSplitSHA256') != C1_SHA or
        split.get('splitSHA256') != digest or split.get('training') != training or
        split.get('calibration') != calibration or split.get('calibrationSets') != calibrations or
        split.get('testSets') != tests or split.get('test') != tests['c1'] + tests['c2'] or
        split.get('seeds') != [0, 1, 2]):
        raise ValueError('expanded split changed; historical c1 and separate c2 must be exact')


class ExpandedCache:
    def __init__(self, root, verify_sources=True, load_into_ram=True):
        self.root = Path(root)
        self.meta = json.loads((self.root / 'cache.json').read_text())
        if self.meta.get('version') != 2 or self.meta.get('samples') != 16 or self.meta.get('inputs') != 65:
            raise ValueError('requires version-2 expanded cache, 16 samples, 65 inputs')
        for name, key in [('snapshot.json', 'snapshotSHA256'), ('split.json', 'splitFileSHA256'),
                          ('feature-cases.json', 'featureSHA256')]:
            if file_sha(self.root / name) != self.meta[key]:
                raise ValueError(f'cache changed: {name}')
        self.snapshot = json.loads((self.root / 'snapshot.json').read_text())
        self.split = json.loads((self.root / 'split.json').read_text())
        n = self.meta['spots']
        validate_split(self.split, n)
        if (self.snapshot['spots'] != n or self.snapshot['c1Spots'] != C1_SPOTS or
            self.snapshot['splitSHA256'] != self.split['splitSHA256'] or
            self.snapshot['target'] != 'turn-start/per-river-v1' or
            self.snapshot['historicalSplitSHA256'] != C1_SHA):
            raise ValueError('snapshot/split mismatch')
        if sum(s['rows'] for s in self.snapshot['shards']) != n:
            raise ValueError('snapshot row count changed')
        self.arrays = {}
        shapes = dict(x=(n, 385), holding=(n, 2, 16, 65), bucket=(n, 2, 16), y=(n, 2, 16))
        for key, shape in shapes.items():
            path = self.root / f'{key}.bin'
            dtype = np.dtype('u1' if key == 'bucket' else '<f4')
            if path.stat().st_size != int(np.prod(shape)) * dtype.itemsize or file_sha(path) != self.meta['sha256'][key]:
                raise ValueError(f'cache changed: {key}')
            if load_into_ram:
                # Sequential reads avoid random HDD faults during shuffled batches.
                array = np.fromfile(path, dtype=dtype).reshape(shape)
                array.flags.writeable = False
                self.arrays[key] = array
            else:
                self.arrays[key] = np.memmap(path, mode='r', dtype=dtype, shape=shape)
        if verify_sources:
            for shard in self.snapshot['shards']:
                if Path(shard['path']).stat().st_size != shard['rows'] * 23900 or file_sha(shard['path']) != shard['sha256']:
                    raise ValueError(f'source changed: {shard["path"]}')
            for entry in self.snapshot['manifests']:
                if file_sha(Path(entry['path']) / 'manifest.json') != entry['sha256']:
                    raise ValueError('source manifest changed')

    def batch(self, indices, device):
        # Fancy indexing copies only this batch from read-only host arrays (RAM
        # by default); tensor conversion and device transfer stay batch-sized.
        return {key: torch.from_numpy(array[indices]).to(device) for key, array in self.arrays.items()}

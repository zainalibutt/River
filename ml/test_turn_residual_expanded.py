"""Run by Claude with unittest; no GPU or production data required."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import torch
from river_value_data import RECORD
from turn_residual import CARDS
from turn_residual_expanded import C1_SHA, ExpandedCache, file_sha, validate_split
from train_turn_residual import ROOT, exact_evaluation
from summarise_turn_residual_expanded import summarise


def fixture_split(c2_spots=20):
    c1 = np.random.default_rng(0).permutation(53550)
    c2 = np.random.default_rng(0).permutation(c2_spots) + 53550
    end = c2_spots // 10
    calibration_end = end + c2_spots // 20
    tests = dict(c1=c1[:5355].tolist(), c2=c2[:end].tolist())
    calibrations = dict(c1=c1[5355:8032].tolist(), c2=c2[end:calibration_end].tolist())
    payload = dict(training=c1[8032:].tolist() + c2[calibration_end:].tolist(),
                   calibration=calibrations['c1'] + calibrations['c2'], testSets=tests)
    return dict(version=2, historicalSplitSHA256=C1_SHA, **payload, calibrationSets=calibrations,
                splitSHA256=hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest(),
                test=tests['c1'] + tests['c2'], seeds=[0, 1, 2])


class ExpandedTests(unittest.TestCase):
    def test_summary_preserves_both_cohorts_and_rejects_unmatched_frozen_weights(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            out = Path(folder)
            digests = []
            for seed in range(3):
                directory = out / 'baseline'
                directory.mkdir(exist_ok=True)
                stem = directory / f'baseline-{seed}-bucket'
                stem.with_suffix('.bin').write_bytes(f'weights-{seed}'.encode())
                stem.with_suffix('.json').write_text('{}')
                digests.append(hashlib.sha256(stem.with_suffix('.bin').read_bytes() + b'{}').hexdigest())
            for config in ('baseline', 'frozen', 'joint'):
                directory = out / config
                directory.mkdir(exist_ok=True)
                for seed in range(3):
                    model = 'baseline' if config == 'baseline' else 'residual'
                    tests = {}
                    for name, score, count in [('c1', 10 + seed, 5355), ('c2', 20 + seed, 17302)]:
                        tests[name] = dict(spots=count, metrics={'all': score * (1 if config == 'baseline' else .7)},
                                           baselineMetrics={'all': score})
                    result = dict(complete=True, epochs=50, seed=seed, seconds=20, device='cuda',
                                  historicalSplitSHA256=C1_SHA, model=model, joint=config == 'joint',
                                  hidden=128, layers=2, tests=tests, splitSHA256='split', snapshotSHA256='snapshot',
                                  lr=.001, bucketSHA256='initial' if config == 'baseline' else digests[seed],
                                  fitSeconds=10, evaluationSeconds=10)
                    (directory / f'{model}-{seed}.result.json').write_text(json.dumps(result))
                    if config == 'frozen':
                        (directory / f'residual-{seed}-bucket.bin').write_bytes(f'weights-{seed}'.encode())
            summarise(out, 50, 3600)
            rows = json.loads((out / 'summary.json').read_text())['rows']
            self.assertEqual({r['cohort'] for r in rows}, {'c1', 'c2'})
            self.assertEqual(len(rows), 6)
            self.assertTrue(all(r['clears20Pct'] for r in rows if r['config'] != 'baseline'))
            (out / 'frozen' / 'residual-0-bucket.bin').write_bytes(b'mutated')
            with self.assertRaisesRegex(ValueError, 'frozen bucket weights changed'):
                summarise(out, 50, 3600)

    def test_historical_and_new_cohorts_reject_membership_mutations(self):
        split = fixture_split()
        validate_split(split, 53570)
        for name in ('training', 'calibration', 'test'):
            changed = copy.deepcopy(split)
            changed[name].reverse()
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_split(changed, 53570)
        changed = copy.deepcopy(split)
        changed['testSets']['c2'][0] = changed['testSets']['c1'][0]
        with self.assertRaises(ValueError):
            validate_split(changed, 53570)

    def test_numpy_matches_typescript_expanded_split_golden(self):
        split = fixture_split(173025)
        self.assertEqual(split['splitSHA256'], '7bec7f1fb1378fcc75fd691f4eca67646542067eb3f504bc8cbec633010025dd')
        self.assertEqual(split['testSets']['c2'][:5], [153463, 208736, 111500, 79490, 143402])
        validate_split(split, 226575)

    def test_readonly_maps_copy_only_selected_batch(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            cache = ExpandedCache.__new__(ExpandedCache)
            cache.arrays = {}
            for key, shape in dict(x=(9, 385), holding=(9, 2, 16, 65), bucket=(9, 2, 16), y=(9, 2, 16)).items():
                path = root / f'{key}.bin'
                source = np.arange(np.prod(shape)).astype(np.uint8 if key == 'bucket' else np.float32).reshape(shape)
                source.tofile(path)
                cache.arrays[key] = np.memmap(path, mode='r', dtype=source.dtype, shape=shape)
            before = file_sha(root / 'x.bin')
            batch = cache.batch(np.array([7, 1]), torch.device('cpu'))
            np.testing.assert_array_equal(batch['x'].numpy(), cache.arrays['x'][[7, 1]])
            self.assertEqual(tuple(batch['holding'].shape), (2, 2, 16, 65))
            batch['x'].zero_()
            self.assertEqual(file_sha(root / 'x.bin'), before)
            # Windows cannot remove open mmap files.
            for array in cache.arrays.values():
                array._mmap.close()

    def test_exact_scores_separate_cohorts_and_legacy_api(self):
        class Zero(torch.nn.Module):
            def forward(self, x, features, ids):
                return torch.zeros_like(ids, dtype=torch.float32)
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root = Path(folder)
            records = np.zeros(3, dtype=RECORD)
            board = np.array([0, 5, 24, 49])
            live = ~np.isin(CARDS, board).any(axis=1)
            records['board'][:, :4] = board
            records['board'][:, 4] = 255
            records['pot'] = records['stack'] = 10
            records['strength_rank'] = live
            records['ranges'] = live / live.sum()
            # Row 0 must be excluded; unequal test values expose cohort mixing.
            records['values'][0] = 99
            records['values'][1] = .1
            records['values'][2] = .3
            path = root / 'source.bin'
            records.tofile(path)
            (root / 'snapshot.json').write_text(json.dumps(dict(shards=[dict(path=str(path), rows=3, sha256=file_sha(path))])))
            split = dict(test=[1, 2])
            metrics, _ = exact_evaluation(Zero(), root, split, 'cpu', test_sets=dict(c1=[1], c2=[2]))
            self.assertAlmostEqual(metrics['c1']['all'], 10, places=5)
            self.assertAlmostEqual(metrics['c2']['all'], 30, places=5)
            legacy, _ = exact_evaluation(Zero(), root, split, 'cpu')
            self.assertAlmostEqual(legacy['all'], 20, places=5)
            with self.assertRaises(ValueError):
                exact_evaluation(Zero(), root, split, 'cpu', test_sets=dict(c1=[1], c2=[1]))
            with path.open('ab') as source:
                source.write(b'changed')
            with self.assertRaises(ValueError):
                exact_evaluation(Zero(), root, split, 'cpu')


if __name__ == '__main__':
    unittest.main()

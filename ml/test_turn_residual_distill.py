"""CPU-only tests for Claude; never train or require the full 35GB packed cache."""
import json
import unittest
from pathlib import Path
import numpy as np
import torch
from torch import nn
from turn_residual_distill import features, holding_partition, distillation_loss, score


class DistillationTests(unittest.TestCase):
    def test_exact_score_keeps_cohorts_players_and_range_weights_separate(self):
        local = torch.zeros((2, 1128, 34))
        shared = torch.zeros((2, 295))
        shared[:, 39:167] = .5
        shared[:, 167:] = -.5
        local[0, 0, 29], local[0, 1, 29] = .1, .3
        local[0, 0, 30] = -.2
        local[:, 0, 31], local[:, 1, 31] = .25, .75
        local[:, 0, 32] = 1.
        local[1, :, 29], local[1, :, 30] = .5, -.5
        class FakeCache:
            def batch(self, ids, holdings, device):
                return local[ids].to(device), shared[ids].to(device)
        head = nn.Linear(65, 1)
        nn.init.zeros_(head.weight)
        nn.init.zeros_(head.bias)
        result = score(head, FakeCache(), dict(c1=[0], c2=[1]), torch.device('cpu'))
        self.assertAlmostEqual(result['c1']['all'], 27.5, places=5)
        self.assertEqual(result['c2']['all'], 0.)

    def test_full_coverage_no_duplicates_for_every_player_and_spot(self):
        for passes in (1, 16, 50):
            ids = np.concatenate([holding_partition(e, passes) for e in range(passes)])
            np.testing.assert_array_equal(ids, np.arange(1128))
        with self.assertRaises(ValueError):
            holding_partition(16, 16)

    def test_factorisation_matches_independent_ts_golden_on_all_legal_holdings(self):
        fixture = Path(__file__).resolve().parents[1] / 'art/out/d8-expanded/feature-cases.json'
        if not fixture.exists():
            self.skipTest('expanded feature fixtures unavailable')
        for case in json.loads(fixture.read_text())['cases']:
            legal = np.asarray(case['bucket']) >= 0
            expected = np.asarray(case['residualInputs'], dtype=np.float32).reshape(2, 1326, 65)[:, legal]
            local = np.zeros((1, 1128, 34), dtype=np.float32)
            shared = np.zeros((1, 295), dtype=np.float32)
            local[0, :, :19] = expected[0, :, 3:22]
            local[0, :, 19:24] = expected[0, :, 22:27]
            local[0, :, 24:29] = expected[1, :, 22:27]
            local[0, :, 33] = np.asarray(case['bucket'])[legal]
            shared[0, 0] = expected[0, 0, 2]
            shared[0, 1:39] = expected[0, 0, 27:]
            shared[0, 39:] = case['bucketOutputs']
            actual = features(torch.from_numpy(local), torch.from_numpy(shared)).numpy()[0]
            np.testing.assert_array_equal(actual, expected)

    def test_teacher_is_fixed_both_losses_drive_student(self):
        teacher = nn.Linear(65, 1).requires_grad_(False)
        student = nn.Linear(65, 1)
        with torch.no_grad():
            teacher.weight.fill_(.2)
            teacher.bias.fill_(.1)
            student.weight.zero_()
            student.bias.zero_()
        x = torch.zeros((2, 2, 71, 65))
        x[..., 0] = .5
        target = torch.ones((2, 2, 71))
        before = {k: v.clone() for k, v in teacher.state_dict().items()}
        solver_only = distillation_loss(student, teacher, x, target, 0.)
        both = distillation_loss(student, teacher, x, target, 1.)
        self.assertGreater(both.item(), solver_only.item())
        both.backward()
        self.assertIsNotNone(student.weight.grad)
        for key, value in teacher.state_dict().items():
            self.assertTrue(torch.equal(before[key], value))
        self.assertTrue(all(p.grad is None for p in teacher.parameters()))


if __name__ == '__main__':
    unittest.main()

"""Meaningful independent D8 feature and mutation checks, bounded to two CPU threads."""
import unittest
import tempfile
from pathlib import Path
import numpy as np
import torch
from turn_residual import CARDS, INPUTS, TurnResidual, export_mlp, load_mlp, residual_features, static_features


def index(a, b):
    return int(np.flatnonzero((CARDS == sorted((a, b))).all(axis=1))[0])


class TurnResidualTests(unittest.TestCase):
    def test_frozen_and_joint_gradients_and_cached_base(self):
        for joint in (False, True):
            with self.subTest(joint=joint):
                model = TurnResidual(True, hidden=64, layers=2, joint=joint)
                x = torch.randn(2, 385)
                local = torch.randn(2, 2, 4, INPUTS)
                ids = torch.arange(4).expand(2, 2, 4)
                before = [p.detach().clone() for p in model.bucket.parameters()]
                optimiser = torch.optim.Adam((p for p in model.parameters() if p.requires_grad), lr=.001)
                prediction = model(x, local, ids)
                if not joint:
                    with torch.no_grad():
                        base = model.bucket(x).reshape(2, 2, 128).gather(2, ids)
                    torch.testing.assert_close(prediction, model(x, local, ids, base))
                else:
                    with self.assertRaises(ValueError):
                        model(x, local, ids, torch.zeros(2, 2, 4))
                prediction.square().mean().backward()
                self.assertEqual(any(p.grad is not None for p in model.bucket.parameters()), joint)
                optimiser.step()
                changed = any(not torch.equal(old, new) for old, new in zip(before, model.bucket.parameters()))
                self.assertEqual(changed, joint)

    def test_configurable_export_roundtrip_with_dropout_removed(self):
        for hidden, layers in ((16, 1), (64, 2), (128, 2), (16, 3)):
            with self.subTest(hidden=hidden, layers=layers), tempfile.TemporaryDirectory(
                    dir=Path(__file__).resolve().parents[1]) as folder:
                model = TurnResidual(True, hidden=hidden, layers=layers, dropout=.2)
                # Avoid a vacuous all-zero output parity check.
                with torch.no_grad():
                    model.head[-1].weight.fill_(.01)
                model.eval()
                x = torch.randn(5, INPUTS)
                stem = Path(folder) / 'head'
                export_mlp(model.head, stem)
                exported = load_mlp(stem)
                torch.testing.assert_close(model.head(x), exported(x), atol=1e-7, rtol=1e-6)
                self.assertFalse(any(isinstance(layer, torch.nn.Dropout) for layer in exported))

    def setUp(self):
        # 2s 7s Kh Qc, As Js
        self.board = np.array([0, 5, 24, 49])
        self.ranks = np.where(np.isin(CARDS, self.board).any(axis=1), 0, 1).astype(np.uint16)
        self.static = static_features(self.board, self.ranks)

    def test_flush_draw_and_blocker_inclusion_exclusion(self):
        h = index(12, 9)
        self.assertEqual(self.static[h, 4], 1)
        self.assertAlmostEqual(float(self.static[h, 15]), 9/46, places=7)
        ranges = np.zeros((2, 1326))
        ranges[0, h] = 1
        ranges[1, index(12, 38)] = .6  # As Ad
        ranges[1, index(9, 8)] = .4   # Js Ts
        features = residual_features(self.static, ranges, np.zeros(256), np.where(self.ranks > 0, 64, -1), 10, 10)
        np.testing.assert_allclose(features[0, h, 22:25], [.6, .4, 1.], atol=1e-7)
        self.assertEqual(features.shape, (2, 1326, INPUTS))

    def test_already_made_straight_flush_survives_off_suit_rivers(self):
        board = np.array([12, 11, 10, 9])
        ranks = np.where(np.isin(CARDS, board).any(axis=1), 0, 1).astype(np.uint16)
        static = static_features(board, ranks)
        self.assertEqual(static[index(8, 39), 1], 1)
        self.assertEqual(static[index(8, 39), 2], 0)

    def test_dropping_head_changes_values(self):
        torch.manual_seed(3)
        model = TurnResidual(True)
        with torch.no_grad():
            model.head[-1].bias.fill_(.125)
            x = torch.zeros(1, 385)
            local = torch.zeros(1, 2, 2, INPUTS)
            ids = torch.zeros(1, 2, 2, dtype=torch.long)
            full = model(x, local, ids)
            base = model.bucket(x).reshape(1, 2, 128).gather(2, ids)
        torch.testing.assert_close(full - base, torch.full_like(base, .125), atol=1e-7, rtol=0)


if __name__ == '__main__':
    unittest.main()

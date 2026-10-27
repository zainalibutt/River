"""Independent NumPy D8 features and shared PyTorch holding encoder.

Suit permutations are tied analytically: no raw suit identifiers enter the model.
The full 24-permutation augmentation orbit has identical inputs after reindexing.
Potential is exact FINAL-CATEGORY mean/std over 46 rivers, not percentile variance.
"""
from __future__ import annotations

import os
import sys
sys.dont_write_bytecode = True
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
import json
from pathlib import Path
import numpy as np
import torch

# Configure interop once on import, before any other Torch setup or local imports.
# An embedding process may already have configured it or started parallel work.
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass
torch.set_num_threads(2)

from torch import nn
from river_value_data import COMBOS, combo_cards
from train_river_buckets import mlp

STATIC = 19
INPUTS = 65
CARDS = combo_cards()
STRAIGHT = np.zeros(8192, dtype=bool)
for mask in range(8192):
    STRAIGHT[mask] = (mask & 0x100F == 0x100F) or any((mask >> low) & 31 == 31 for low in range(9))


def category(pairs, trips, quads, mask):
    return np.where(quads > 0, 7, np.where((trips >= 2) | ((trips > 0) & (pairs > 0)), 6,
                    np.where(STRAIGHT[mask], 4, np.where(trips > 0, 3, np.minimum(pairs, 2)))))


def static_features(board: np.ndarray, ranks: np.ndarray) -> np.ndarray:
    board = np.asarray(board, dtype=np.int64)
    if board.shape != (4,) or len(set(board)) != 4 or np.any((board < 0) | (board >= 52)):
        raise ValueError("four distinct turn cards required")
    legal = ~np.isin(CARDS, board).any(axis=1)
    if not np.array_equal(legal, ranks > 0):
        raise ValueError("board/ranks legality mismatch")
    a, b = CARDS.T
    ar, br = a % 13, b % 13
    sa, sb = a // 13, b // 13
    board_rank = np.bincount(board % 13, minlength=13)
    board_suit = np.bincount(board // 13, minlength=4)
    board_masks = np.zeros(4, dtype=np.int64)
    for k in board:
        board_masks[k // 13] |= 1 << (k % 13)
    counts = np.tile(board_rank, (COMBOS, 1))
    suits = np.tile(board_suit, (COMBOS, 1))
    masks = np.tile(board_masks, (COMBOS, 1))
    idx = np.arange(COMBOS)
    counts[idx, ar] += 1
    counts[idx, br] += 1
    suits[idx, sa] += 1
    suits[idx, sb] += 1
    masks[idx, sa] |= 1 << ar
    masks[idx, sb] |= 1 << br
    rankmask = ((counts > 0) * (1 << np.arange(13))).sum(axis=1)
    pairs, trips, quads = [(counts == n).sum(axis=1) for n in (2, 3, 4)]
    flush_suit = suits.argmax(axis=1)
    flush_count = suits[idx, flush_suit]
    flush_mask = masks[idx, flush_suit]
    made = category(pairs, trips, quads, rankmask)
    made = np.where(flush_count >= 5, np.maximum(made, np.where(STRAIGHT[flush_mask], 8, 5)), made)
    total = np.zeros(COMBOS)
    square = np.zeros(COMBOS)
    straight_outs = np.zeros(COMBOS)
    flush_outs = np.zeros(COMBOS)
    for r in range(13):
        n = counts[:, r]
        cat = category(pairs + (n == 1) - (n == 2), trips + (n == 2) - (n == 3), quads + (n == 3), rankmask | (1 << r))
        cat = np.where(flush_count >= 5, np.maximum(cat, made), cat)
        total += (4 - n) * cat
        square += (4 - n) * cat * cat
        straight_outs += (~STRAIGHT[rankmask] & STRAIGHT[rankmask | (1 << r)]) * (4 - n)
        missing = (flush_count >= 4) & ((flush_mask & (1 << r)) == 0)
        flush_cat = np.maximum(cat, np.where(STRAIGHT[flush_mask | (1 << r)], 8, 5))
        total += missing * (flush_cat - cat)
        square += missing * (flush_cat * flush_cat - cat * cat)
        flush_outs += missing & (flush_count == 4)
    fd = (flush_count == 4) & ((sa == flush_suit) | (sb == flush_suit))
    nut = np.zeros(COMBOS)
    for rank, suit in ((ar, sa), (br, sb)):
        high = np.array([max(r for r in range(13) if not board_masks[s] & (1 << r)) for s in range(4)])
        nut += (board_suit[suit] >= 2) & (rank == high[suit])
    freq = np.bincount(ranks.astype(np.int64), minlength=COMBOS + 1)
    freq[0] = 0
    percentile = (np.cumsum(freq) - freq / 2) / legal.sum()
    result = np.stack([
        percentile[ranks], total / (46 * 8), np.sqrt(np.maximum(0, square / 46 - (total / 46) ** 2)) / 8,
        made / 8, fd, straight_outs > 0, sa == sb, np.maximum(ar, br) / 12, np.minimum(ar, br) / 12,
        ar == br, np.maximum(board_suit[sa], board_suit[sb]) / 4, np.minimum(board_suit[sa], board_suit[sb]) / 4,
        nut / 2, (board_rank[ar] + board_rank[br]) / 8, straight_outs / 46, np.where(fd, flush_outs / 46, 0),
        np.full(COMBOS, np.any(board_rank > 1)), np.full(COMBOS, board_suit.max() / 4), np.abs(ar - br) / 12,
    ], axis=1).astype(np.float32)
    result[~legal] = 0
    return result


def residual_features(static: np.ndarray, ranges: np.ndarray, bucket_values: np.ndarray,
                      buckets: np.ndarray, stack: float, pot: float) -> np.ndarray:
    live = buckets >= 0
    weights = np.where(live[None, :], ranges, 0).astype(np.float64)
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-300)
    pool = weights @ static.astype(np.float64)
    mass = np.empty((2, 3, 52))
    strong = static[:, 0] >= 0.9
    draws = np.maximum(static[:, 4], static[:, 5])
    for p in (0, 1):
        for j, flag in enumerate((np.ones(COMBOS), strong, draws)):
            mass[p, j] = np.bincount(CARDS.ravel(), weights=np.repeat(weights[p] * flag, 2), minlength=52)
    out = np.zeros((2, COMBOS, INPUTS), dtype=np.float32)
    a, b = CARDS.T
    for p in (0, 1):
        opp = 1 - p
        out[p, :, 0] = bucket_values[p * 128 + np.maximum(buckets, 0)]
        out[p, :, 1] = p
        out[p, :, 2] = np.log(np.clip(stack / pot, 0.05, 50))
        out[p, :, 3:3 + STATIC] = static
        at = 3 + STATIC
        ma, mb = mass[opp, 0, a], mass[opp, 0, b]
        out[p, :, at:at + 5] = np.stack([
            np.maximum(ma, mb), np.minimum(ma, mb), ma + mb - weights[opp],
            mass[opp, 1, a] + mass[opp, 1, b] - weights[opp] * strong,
            mass[opp, 2, a] + mass[opp, 2, b] - weights[opp] * draws,
        ], axis=1)
        out[p, :, at + 5:at + 5 + STATIC] = pool[p]
        out[p, :, at + 5 + STATIC:] = pool[opp]
    out[:, ~live] = 0
    return out


class TurnResidual(nn.Module):
    def __init__(self, residual: bool, hidden=16, layers=1, dropout=0., joint=False):
        super().__init__()
        if hidden < 1 or layers not in (1, 2, 3) or not 0 <= dropout < 1:
            raise ValueError('hidden > 0, layers 1-3, dropout in [0, 1) required')
        self.bucket = mlp(385, 256, 512, 3)
        self.bucket.requires_grad_(not residual or joint)
        modules = []
        for layer in range(layers):
            modules.extend([nn.Linear(INPUTS if layer == 0 else hidden, hidden), nn.PReLU()])
            if dropout:
                modules.append(nn.Dropout(dropout))
        modules.append(nn.Linear(hidden, 1))
        self.head = nn.Sequential(*modules) if residual else None
        if self.head is not None:
            nn.init.zeros_(self.head[-1].weight)
            nn.init.zeros_(self.head[-1].bias)

    def forward(self, x, features, ids, cached_base=None):
        if cached_base is None:
            values = self.bucket(x).reshape(-1, 2, 128)
            base = values.gather(2, ids.long())
        else:
            if any(p.requires_grad for p in self.bucket.parameters()):
                raise ValueError('cached base is only valid for a frozen bucket network')
            base = cached_base
        if self.head is None:
            return base
        # requires_grad controls freezing; joint mode retains both gradient paths.
        local = torch.cat((base[..., None], features[..., 1:]), dim=-1)
        return base + self.head(local).squeeze(-1)


def export_mlp(model: nn.Sequential, stem: Path, **metadata) -> None:
    # Dropout is training-only. Compact indices retain the existing TS Linear/PReLU ABI.
    model = nn.Sequential(*(layer for layer in model if not isinstance(layer, nn.Dropout)))
    tensors, arrays, offset = [], [], 0
    for name, value in model.state_dict().items():
        array = value.detach().cpu().numpy().astype('<f4')
        tensors.append(dict(name=name, shape=list(array.shape), offset=offset))
        arrays.append(array.ravel())
        offset += array.nbytes
    np.concatenate(arrays).tofile(stem.with_suffix('.bin'))
    shape = [model[0].in_features] + [layer.out_features for layer in model if isinstance(layer, nn.Linear)]
    stem.with_suffix('.json').write_text(json.dumps(dict(format='float32-le', buckets=128, tensors=tensors, bytes=offset, **metadata, shape=shape), indent=2) + '\n')


def load_mlp(stem: Path) -> nn.Sequential:
    """Load exported Linear/PReLU tensors of any width/depth, including legacy exports."""
    meta = json.loads(stem.with_suffix('.json').read_text())
    raw = np.fromfile(stem.with_suffix('.bin'), dtype='<f4')
    tensors = {t['name'].removeprefix('net.'): t for t in meta['tensors']}
    modules, state = [], {}
    index = 0
    while f'{index}.bias' in tensors:
        shape = tensors[f'{index}.weight']['shape']
        modules.append(nn.Linear(shape[1], shape[0]))
        if f'{index + 1}.weight' in tensors:
            modules.append(nn.PReLU())
        index += 2
    model = nn.Sequential(*modules)
    for name, tensor in tensors.items():
        start = tensor['offset'] // 4
        n = int(np.prod(tensor['shape']))
        state[name] = torch.from_numpy(raw[start:start+n].reshape(tensor['shape']).copy())
    model.load_state_dict(state, strict=True)
    if model[0].in_features < 1:
        raise ValueError('invalid network dimensions')
    return model.eval()

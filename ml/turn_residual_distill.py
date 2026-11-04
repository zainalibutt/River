"""Factorised all-legal-holding D8 data and bounded distillation helpers."""
from __future__ import annotations
import os
import sys
sys.dont_write_bytecode = True
for _name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[_name] = '2'
os.environ['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
from torch import nn
from turn_residual import INPUTS
from turn_residual_expanded import file_sha, validate_split


def teacher_sha(stem):
    digest = hashlib.sha256()
    for suffix in ('.json', '-bucket.json', '-bucket.bin', '-head.json', '-head.bin'):
        digest.update(Path(str(stem) + suffix).read_bytes())
    return digest.hexdigest()


def holding_partition(epoch, passes=16, legal=1128):
    """Disjoint, exhaustive contiguous partitions; no sampled-holding shortcut."""
    if not 0 <= epoch < passes <= legal:
        raise ValueError('invalid coverage partition')
    return np.arange(epoch * legal // passes, (epoch + 1) * legal // passes)


def features(local, shared):
    """[N,H,34] + [N,295] -> [N,2,H,65], exact f32 ABI."""
    n, h, _ = local.shape
    out = torch.empty((n, 2, h, INPUTS), dtype=local.dtype, device=local.device)
    ids = local[..., 33].long()
    for p in (0, 1):
        out[:, p, :, 0] = shared[:, 39+p*128:39+(p+1)*128].gather(1, ids)
        out[:, p, :, 1] = p
        out[:, p, :, 2] = shared[:, 0, None]
        out[:, p, :, 3:22] = local[..., :19]
        out[:, p, :, 22:27] = local[..., 19+p*5:24+p*5]
        out[:, p, :, 27:46] = shared[:, None, 1+p*19:20+p*19]
        out[:, p, :, 46:] = shared[:, None, 1+(1-p)*19:20+(1-p)*19]
    return out


def distillation_loss(student, teacher, x, solver, alpha=1.):
    with torch.no_grad():
        target = teacher(x).squeeze(-1)
    return cached_distillation_loss(student, x, solver, target, alpha)


def cached_distillation_loss(student, x, solver, target, alpha=1.):
    delta = student(x).squeeze(-1)
    loss = nn.functional.smooth_l1_loss(delta, target, beta=.1)
    loss = alpha * loss + nn.functional.smooth_l1_loss(x[..., 0] + delta, solver, beta=.1)
    return loss


def row_features(local, shared, rows):
    """Vectorised flat (spot, player, holding) rows, built entirely on device."""
    legal = local.shape[1]
    spot = rows // (2 * legal)
    player = rows // legal % 2
    holding = rows % legal
    values = local[spot, holding]
    bucket = values[:, 33].long()
    x = torch.empty((len(rows), INPUTS), dtype=local.dtype, device=local.device)
    x[:, 0] = shared[spot, 39 + player * 128 + bucket]
    x[:, 1] = player
    x[:, 2] = shared[spot, 0]
    x[:, 3:22] = values[:, :19]
    x[:, 22:27] = values.gather(1, 19 + player[:, None] * 5 + torch.arange(5, device=rows.device))
    pools = torch.arange(19, device=rows.device)
    x[:, 27:46] = shared[spot[:, None], 1 + player[:, None] * 19 + pools]
    x[:, 46:] = shared[spot[:, None], 1 + (1-player[:, None]) * 19 + pools]
    solver = values.gather(1, (29 + player)[:, None]).squeeze(1)
    return x, solver


def stripe_rows(spots, epoch, passes, device, legal=1128):
    holdings = torch.as_tensor(holding_partition(epoch, passes, legal), device=device)
    return (torch.arange(spots * 2, device=device)[:, None] * legal + holdings).flatten()


class PackedCache:
    def __init__(self, root, expanded, teacher):
        self.root = Path(root)
        self.meta = json.loads((self.root / 'packed.json').read_text())
        expanded = Path(expanded)
        meta = json.loads((expanded / 'cache.json').read_text())
        self.split = json.loads((expanded / 'split.json').read_text())
        validate_split(self.split, meta['spots'])
        if (self.meta.get('complete') is not True or self.meta.get('holdingOrder') != 'stride37' or
                self.meta['version'] != 1 or self.meta['spots'] != meta['spots'] or
                self.meta['legal'] != 1128 or self.meta['localWidth'] != 34 or self.meta['sharedWidth'] != 295 or
                self.meta['snapshotSHA256'] != meta['snapshotSHA256'] or
                file_sha(expanded / 'snapshot.json') != meta['snapshotSHA256'] or
                file_sha(expanded / 'split.json') != meta['splitFileSHA256'] or
                self.meta['splitSHA256'] != self.split['splitSHA256'] or
                self.meta['teacherSHA256'] != teacher_sha(teacher)):
            raise ValueError('packed cache/split/teacher mismatch')
        model = json.loads(Path(str(teacher) + '.json').read_text())
        if (model.get('joint') is not False or model.get('splitSHA256') != self.meta['splitSHA256'] or
                model.get('snapshotSHA256') != self.meta['snapshotSHA256'] or
                model.get('headShape') != [65, 128, 128, 1]):
            raise ValueError('requires matching frozen 128x2 teacher')
        self.arrays = {}
        for key, shape in dict(local=(meta['spots'], 1128, 34), shared=(meta['spots'], 295)).items():
            path = self.root / f'{key}.bin'
            if path.stat().st_size != int(np.prod(shape))*4 or file_sha(path) != self.meta['sha256'][key]:
                raise ValueError(f'packed array changed: {key}')
            self.arrays[key] = np.memmap(path, mode='r', dtype='<f4', shape=shape)

    def training_chunk(self, start, stop, ids, device):
        """Read each contiguous disk span once; pin and transfer in bulk."""
        selected = ids[np.searchsorted(ids, start):np.searchsorted(ids, stop)] - start
        if not len(selected):
            return None
        index = torch.as_tensor(selected, device=device)
        result = []
        for key in ('local', 'shared'):
            host = torch.from_numpy(np.array(self.arrays[key][start:stop], copy=True))
            if device.type == 'cuda':
                host = host.pin_memory()
            result.append(host.to(device, non_blocking=True).index_select(0, index))
        return tuple(result)

    def teacher_targets(self, teacher, local, shared, start, stop, batch_rows):
        """One persistent target shard per contiguous chunk; JSON commits it last.

        Training split, teacher and packed hashes bind the cache. No target disk
        access or teacher inference occurs inside a student's pass/batch loop.
        """
        root = self.root / 'teacher-targets-v2'
        root.mkdir(exist_ok=True)
        stem = root / f'{start:08d}-{stop:08d}'
        data, manifest = stem.with_suffix('.bin'), stem.with_suffix('.json')
        rows = len(local) * 2 * 1128
        identity = dict(version=2, start=start, stop=stop, rows=rows,
                        splitSHA256=self.meta['splitSHA256'], teacherSHA256=self.meta['teacherSHA256'],
                        packedSHA256=self.meta['sha256'])
        try:
            info = json.loads(manifest.read_text())
            if (all(info.get(k) == v for k, v in identity.items()) and
                    data.stat().st_size == rows * 4 and file_sha(data) == info['sha256']):
                host = torch.from_numpy(np.fromfile(data, dtype='<f4'))
                if local.device.type == 'cuda':
                    host = host.pin_memory()
                return host.to(local.device, non_blocking=True), False
        except (OSError, ValueError, KeyError):
            pass
        targets = torch.empty(rows, device=local.device)
        with torch.no_grad():
            for offset in range(0, rows, batch_rows):
                indices = torch.arange(offset, min(offset + batch_rows, rows), device=local.device)
                x, _ = row_features(local, shared, indices)
                targets[offset:offset+len(indices)] = teacher(x).squeeze(-1)
        if not torch.isfinite(targets).all():
            raise ValueError('nonfinite teacher targets')
        temp = stem.with_suffix('.tmp')
        targets.cpu().numpy().astype('<f4', copy=False).tofile(temp)
        temp.replace(data)
        temp = stem.with_suffix('.json.tmp')
        temp.write_text(json.dumps(dict(**identity, sha256=file_sha(data))) + '\n')
        temp.replace(manifest)
        return targets, True

    def batch(self, ids, holdings, device):
        # Evaluation-only small gathers; training uses contiguous chunks above.
        ids = np.asarray(ids)
        local = self.arrays['local'][ids[:, None], np.asarray(holdings)[None, :], :]
        shared = self.arrays['shared'][ids]
        return torch.from_numpy(local).to(device), torch.from_numpy(shared).to(device)


def score(head, cache, groups, device):
    """Exact normalised range-weighted MAE; both cohorts and D8 slices."""
    result = {}
    head.eval()
    with torch.no_grad():
        for cohort, ids in groups.items():
            totals, masses = {}, {}
            for start in range(0, len(ids), 16):
                local, shared = cache.batch(ids[start:start+16], np.arange(1128), device)
                x = features(local, shared)
                prediction = x[..., 0] + head(x).squeeze(-1)
                error = (prediction - local[..., 29:31].transpose(1, 2)).abs().double()
                weight = local[..., 31:33].transpose(1, 2).double()
                weight = weight / weight.sum(-1, keepdim=True).clamp_min(1e-300)
                static = local[..., :19]
                masks = dict(all=torch.ones_like(static[..., 0], dtype=torch.bool))
                masks.update({'flush-draw': static[..., 4] > 0, 'straight-draw': static[..., 5] > 0,
                              'trips-or-better': static[..., 3] >= 3/8, 'nut-flush-blocker': static[..., 12] > 0,
                              'paired': static[..., 16] > 0, 'unpaired': static[..., 16] == 0,
                              'monotone': static[..., 17] >= .75, 'two-tone': static[..., 17] == .5,
                              'rainbow': static[..., 17] == .25,
                              'over10pots': (shared[:, 0, None] > np.log(10)).expand_as(static[..., 0])})
                for name, mask in masks.items():
                    w = weight * mask[:, None, :]
                    totals[name] = totals.get(name, 0.) + (error*w).sum().item()
                    masses[name] = masses.get(name, 0.) + w.sum().item()
            result[cohort] = {k: 100*totals[k]/mass for k, mass in masses.items() if mass > 0}
    return result

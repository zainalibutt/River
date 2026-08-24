import os
import sys

PIPELINE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPELINE)

import check_assets
from values import BUDGET

OUT = os.path.abspath(os.path.join(PIPELINE, '..', 'out'))
ROOFTOP = os.path.join(OUT, 'rooftop_assets.glb')
BASEMENT = os.path.join(OUT, 'basement_assets.glb')

ORIGINAL = dict(BUDGET)
ROOFTOP_CASES = [
    ('props_triangles', 100),
    ('props_triangles', 0),
    ('scene_triangles', 4000),
    ('scene_triangles', 0),
    ('environment_triangles', 100),
    ('environment_triangles', 0),
    ('max_materials', 19),
    ('max_materials', 0),
    ('max_draw_calls', 40),
    ('max_draw_calls', 0),
]
BASEMENT_CASES = [
    ('max_texture_dim', 64),
    ('max_texture_dim', 1),
    ('texture_mb', 0),
]


def run_cases(target, cases):
    failures = 0
    for key, value in cases:
        BUDGET.update(ORIGINAL)
        BUDGET[key] = value
        try:
            check_assets.check(target)
        except SystemExit as exc:
            if exc.code != 1:
                print('BAD_EXIT %s=%s code=%s' % (key, value, exc.code))
                failures += 1
            else:
                print('NEG_OK %s=%s' % (key, value))
        else:
            print('MISSED %s=%s' % (key, value))
            failures += 1
    return failures


def main():
    failures = 0
    failures += run_cases(ROOFTOP, ROOFTOP_CASES)
    failures += run_cases(BASEMENT, BASEMENT_CASES)
    BUDGET.update(ORIGINAL)
    check_assets.check(ROOFTOP)
    print('POS_OK')
    if failures:
        raise SystemExit(1)
    print('ALL_NEGATIVE_OK')


if __name__ == '__main__':
    main()
import os
import sys

PIPELINE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPELINE)

import check_assets
from values import BUDGET

OUT = os.path.abspath(os.path.join(PIPELINE, '..', 'out'))
FIXTURE = os.path.join(OUT, 'char_fixture.glb')

ORIGINAL = dict(BUDGET)

NEGATIVE = [
    ('character_triangles', 100),
    ('character_triangles', 0),
    ('character_bones_min', 61),
    ('character_bones_min', 1000),
]


def expect_fail(key, value):
    BUDGET.update(ORIGINAL)
    BUDGET[key] = value
    try:
        check_assets.check(FIXTURE)
    except SystemExit as exc:
        if exc.code != 1:
            print('BAD_EXIT %s=%s code=%s' % (key, value, exc.code))
            return False
        print('NEG_OK %s=%s' % (key, value))
        return True
    print('MISSED %s=%s' % (key, value))
    return False


def expect_pass():
    BUDGET.update(ORIGINAL)
    BUDGET['character_bones_min'] = 1
    BUDGET['character_triangles'] = 1000
    try:
        check_assets.check(FIXTURE)
    except SystemExit:
        print('POS_FAILED')
        return False
    print('POS_OK')
    return True


def main():
    failures = 0
    for key, value in NEGATIVE:
        if not expect_fail(key, value):
            failures += 1
    if not expect_pass():
        failures += 1
    if failures:
        raise SystemExit(1)
    print('ALL_CHAR_NEGATIVE_OK')


if __name__ == '__main__':
    main()
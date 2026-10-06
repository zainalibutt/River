"""Read where a seat's chips and hole cards belong, out of the file the clips were authored in.

The browser owns the chips and the cards; the character GLB carries only him. So the chip
push pushed nothing and the peek lifted nothing: the browser was drawing a player's chips a
quarter of the way across the felt, and drawing no hole cards at all, while his hands
reached for props that only exist in the Blender file.

Those props are still in it, on their own tracks beside the clips, so their places are
measurable rather than a matter of taste. This reads them, in the character's own metres,
with him facing -Y, and writes them for write_seat_timing.mjs to turn into a module.

Nothing is written to the candidate; it is opened read-only.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/read_seat_props.py -- \\
      --candidate <silver-integration-candidate.blend> --out <seat-prop-places.json>
"""
import argparse
import json
import os
import sys

import bpy

CARD_OBJECTS = ('A44d proof card 0', 'A44d proof card 1')
CHIP_OBJECT = 'A47 proof chip 00'
CARD_ACTIONS = ('A44d proof card motion 0', 'A44d proof card motion 1')
CHIP_ACTIONS = tuple('A47 proof stack %d' % index for index in range(6))
ALLIN_ACTIONS = tuple('A49 ALLIN proof stack %d' % index for index in range(6))
PEEK_LAST_FRAME = 48
CHIP_LAST_FRAME = 30
ALLIN_LAST_FRAME = 90
# The proof stage's felt, which every one of these places sits on. The browser puts its own
# felt height under them, so what travels is the plan position and the lift above the felt.
PROOF_FELT_Z = 0.7935


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--out', required=True)
    return parser.parse_args(argv)


def curves(action):
    return [c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]


def sample(action, frame):
    """Location and rotation of the object this action drives, at one frame."""
    location = [0.0, 0.0, 0.0]
    quaternion = [1.0, 0.0, 0.0, 0.0]
    for curve in curves(action):
        if curve.data_path == 'location':
            location[curve.array_index] = curve.evaluate(frame)
        elif curve.data_path == 'rotation_quaternion':
            quaternion[curve.array_index] = curve.evaluate(frame)
    return location, quaternion


def main():
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.candidate))
    missing = [name for name in CARD_ACTIONS + CHIP_ACTIONS + ALLIN_ACTIONS if name not in bpy.data.actions]
    if missing:
        raise SystemExit('FAIL: the candidate has no %s' % ', '.join(missing))

    cards = []
    for name in CARD_ACTIONS:
        action = bpy.data.actions[name]
        track = []
        for frame in range(PEEK_LAST_FRAME + 1):
            location, quaternion = sample(action, frame)
            track.append([round(value, 5) for value in location + quaternion])
        cards.append({'action': name, 'rest': track[0], 'peek': track})

    chips = []
    for name in CHIP_ACTIONS:
        location, _ = sample(bpy.data.actions[name], 0)
        pushed, _ = sample(bpy.data.actions[name], CHIP_LAST_FRAME)
        chips.append({'action': name, 'rest': [round(v, 5) for v in location],
                      'pushed': [round(v, 5) for v in pushed]})
    allin = []
    for name in ALLIN_ACTIONS:
        location, _ = sample(bpy.data.actions[name], 0)
        pushed, _ = sample(bpy.data.actions[name], ALLIN_LAST_FRAME)
        allin.append({'action': name, 'rest': [round(v, 5) for v in location],
                      'pushed': [round(v, 5) for v in pushed]})

    # Where the stack is on every frame of the push and the shove, not only where it starts
    # and ends: the chips a player bets travel with his hand, and his hand is not moving for
    # the whole clip. The bottom chip of each stack stands for the stack; they are keyed
    # together.
    def travel(name, last):
        rows = []
        for frame in range(last + 1):
            location, _ = sample(bpy.data.actions[name], frame)
            rows.append([round(value, 5) for value in location])
        return rows

    push_track = travel(CHIP_ACTIONS[0], CHIP_LAST_FRAME)
    shove_track = travel(ALLIN_ACTIONS[0], ALLIN_LAST_FRAME)
    for name, track in ((CHIP_ACTIONS[0], push_track), (ALLIN_ACTIONS[0], shove_track)):
        moving = [frame for frame in range(1, len(track)) if track[frame] != track[frame - 1]]
        if not moving:
            raise SystemExit('FAIL: %s never moves the stack' % name)
        print('TRAVEL %s moves from frame %d to %d' % (name, moving[0] - 1, moving[-1]))

    # The props are the size a real one is, and the browser must draw them at that size or
    # the hand closes on the wrong place. Measured rather than restated.
    sizes = []
    for name in CARD_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise SystemExit('FAIL: the candidate has no %s to measure' % name)
        sizes.append(tuple(round(value, 5) for value in obj.dimensions))
    if sizes[0][:2] != sizes[1][:2]:
        raise SystemExit('FAIL: the two hole cards are different sizes, %s and %s' % sizes)
    chip = bpy.data.objects.get(CHIP_OBJECT)
    if chip is None:
        raise SystemExit('FAIL: the candidate has no %s to measure' % CHIP_OBJECT)

    document = {
        'source': os.path.basename(args.candidate),
        'units': 'metres in the character frame, before any venue scale; he faces -y',
        'proofFeltZ': PROOF_FELT_Z,
        'peekLastFrame': PEEK_LAST_FRAME,
        'cardSize': {'width': sizes[0][0], 'length': sizes[0][1]},
        'chipSize': {'diameter': round(chip.dimensions[0], 5), 'height': round(chip.dimensions[2], 5)},
        'holeCards': cards,
        'chipStack': chips,
        'allInChips': allin,
        'chipPushTrack': push_track,
        'allInShoveTrack': shove_track,
    }
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as handle:
        json.dump(document, handle, indent=1)
    print('SEAT PROPS %s' % out)
    for card in cards:
        print('CARD %s rest %s, highest %.4f'
              % (card['action'], card['rest'][:3], max(row[2] for row in card['peek'])))
    print('CHIPS rest %s pushed %s' % (chips[0]['rest'], chips[0]['pushed']))
    print('ALLIN rest %s pushed %s' % (allin[0]['rest'], allin[0]['pushed']))


if __name__ == '__main__':
    main()

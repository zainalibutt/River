"""Read where Gold's chips and hole cards belong, out of the file her clips were authored in.

read_seat_props.py does this for Silver and stays as it was when it produced his module. Gold
is not a second copy of him: she was authored on the venue's own table rather than on his
proof stage, so her felt is 0.76 rather than 0.7935 and she needs no venue scale at all; her
fold has its own card track, which his does not; and her all-in never pushes a stack, which
his does. The two stages carry different objects, so they get one reader each rather than one
reader with a character flag and four branches inside every step.

What is the same is the shape of what comes out, so write_seat_props.mjs and
write_seat_timing.mjs turn either character's measurements into a module.

Her chair also moves on tracks beside the sit, the leave and the all-in, so those are read
here too - the browser owns the chair, and a chair that follows his timing under her would
stand up half a second before she does.

Nothing is written to the master; it is opened read-only.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/read_gold_seat_props.py -- \\
      --master <a72-gold-parity-master.blend> --out <gold-seat-prop-places.json> \\
      --timing <gold-seat-transition-timing.json>
"""
import argparse
import json
import os
import sys

import bpy

CARD_OBJECTS = ('A63 inward palm card 0', 'A63 inward palm card 1')
CARD_ACTIONS = ('A63 inward palm card 0Action', 'A63 inward palm card 1Action')
# The stack is an empty with the chips parented to it, so the empty carries the travel and
# the bottom chip carries the offset from it. Silver's bottom chip is the point his module
# calls the stack's place, and this keeps the two the same kind of point.
CHIP_STACK_ACTION = 'A65 relaxed chip push stackAction'
CHIP_OBJECT = 'A64 push chip 00'
# The cards she pushes away when she folds, which is a track of its own rather than the chip
# push borrowed - see FOLD_muck.
FOLD_ACTION = 'A66 fold card rootAction'
CHAIR_ACTIONS = {
    'ALLIN_standup': ('A67 proof chair retreat', 90),
    'SIT_enter': ('A72 SIT_enter chair', 108),
    'LEAVE_getup': ('A72 LEAVE_getup chair', 132),
}
PEEK_LAST_FRAME = 48
CHIP_LAST_FRAME = 30
FOLD_LAST_FRAME = 35
FPS = 30
# The table she was authored against is this venue's own, so her felt is the Rooftop's table
# top and her chair its seat height. That is what lets her go into a seat at world scale.
GOLD_FELT_Z = 0.76
GOLD_PAN_Z = 0.46


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--master', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--timing', required=True)
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


def travel(name, last, offset=(0.0, 0.0, 0.0)):
    rows = []
    for frame in range(last + 1):
        location, _ = sample(bpy.data.actions[name], frame)
        rows.append([round(value + offset[index], 5) for index, value in enumerate(location)])
    return rows


def moving_frames(track, name):
    moving = [frame for frame in range(1, len(track)) if track[frame] != track[frame - 1]]
    if not moving:
        raise SystemExit('FAIL: %s never moves' % name)
    return moving[0] - 1, moving[-1]


def main():
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.master))
    wanted = list(CARD_ACTIONS) + [CHIP_STACK_ACTION, FOLD_ACTION] + [name for name, _ in CHAIR_ACTIONS.values()]
    missing = [name for name in wanted if name not in bpy.data.actions]
    if missing:
        raise SystemExit('FAIL: the master has no %s' % ', '.join(missing))

    cards = []
    for name in CARD_ACTIONS:
        action = bpy.data.actions[name]
        track = []
        for frame in range(PEEK_LAST_FRAME + 1):
            location, quaternion = sample(action, frame)
            track.append([round(value, 5) for value in location + quaternion])
        cards.append({'action': name, 'rest': track[0], 'peek': track})
    for card in cards:
        rest = card['rest']
        if abs(rest[2] - GOLD_FELT_Z) > 0.01:
            raise SystemExit('FAIL: %s rests %.0fmm off the felt she was authored on'
                             % (card['action'], (rest[2] - GOLD_FELT_Z) * 1000.0))

    chip = bpy.data.objects.get(CHIP_OBJECT)
    if chip is None:
        raise SystemExit('FAIL: the master has no %s to measure' % CHIP_OBJECT)
    # The chip's own place is relative to the stack it hangs off, so its offset rides along
    # with the stack's travel and the track comes out where a chip actually is.
    offset = tuple(chip.location)
    push_track = travel(CHIP_STACK_ACTION, CHIP_LAST_FRAME, offset)
    fold_track = travel(FOLD_ACTION, FOLD_LAST_FRAME)
    chips = [{'action': CHIP_STACK_ACTION, 'rest': push_track[0], 'pushed': push_track[-1]}]
    for name, track in ((CHIP_STACK_ACTION, push_track), (FOLD_ACTION, fold_track)):
        first, last = moving_frames(track, name)
        print('TRAVEL %s moves from frame %d to %d' % (name, first, last))

    sizes = []
    for name in CARD_OBJECTS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise SystemExit('FAIL: the master has no %s to measure' % name)
        sizes.append(tuple(round(value, 5) for value in obj.dimensions))
    if sizes[0][:2] != sizes[1][:2]:
        raise SystemExit('FAIL: the two hole cards are different sizes, %s and %s' % sizes)

    document = {
        'source': os.path.basename(args.master),
        'character': 'gold',
        'units': 'metres in the character frame, before any venue scale; she faces -y',
        'proofFeltZ': GOLD_FELT_Z,
        'proofPanZ': GOLD_PAN_Z,
        'peekLastFrame': PEEK_LAST_FRAME,
        'cardSize': {'width': sizes[0][0], 'length': sizes[0][1]},
        'chipSize': {'diameter': round(chip.dimensions[0], 5), 'height': round(chip.dimensions[2], 5)},
        'holeCards': cards,
        'chipStack': chips,
        'chipPushTrack': push_track,
        'muckPushTrack': fold_track,
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
    print('MUCK rest %s pushed %s' % (fold_track[0], fold_track[-1]))

    clips = {}
    for clip, (name, last) in CHAIR_ACTIONS.items():
        rows = []
        for frame in range(last + 1):
            location, _ = sample(bpy.data.actions[name], frame)
            # Away from the table is +y in her frame, which is the way a chair is pushed to
            # stand up; the browser wants that one number a frame.
            rows.append([frame, round(location[1], 5)])
        clips[clip] = {'action': name, 'lastFrame': last, 'backAway': rows}
        print('CHAIR %s %s from %.3fm to %.3fm' % (clip, name, rows[0][1], rows[-1][1]))
    timing = {
        'source': os.path.basename(args.master),
        'character': 'gold',
        'fps': FPS,
        'units': 'metres in the character frame; positive is away from the table',
        'clips': clips,
    }
    timing_out = os.path.abspath(args.timing)
    os.makedirs(os.path.dirname(timing_out), exist_ok=True)
    with open(timing_out, 'w', encoding='utf-8') as handle:
        json.dump(timing, handle, indent=1)
    print('SEAT TIMING %s' % timing_out)


if __name__ == '__main__':
    main()

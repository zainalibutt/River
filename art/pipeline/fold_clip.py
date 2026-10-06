"""The fold, authored on top of the accepted chip push.

The Silver character had no fold. For a while the browser played the chip push for one,
which is closer than it sounds: his idle rests the left hand on his two cards, so the push
slides the cards forward exactly as a player sliding them to the dealer would. What makes
it a fold rather than a bet is what happens after the slide - the hand lets go, the wrist
flicks the cards away, and the player turns away from a hand he is no longer in - and
that is what is authored here.

The arm's path is the accepted push, frame for frame, up to the release; the return is the
same push's return played slower, because a fold is not in a hurry to get back. On top of
that, keyed as rotations about each bone's own axis:

- the fingers uncurl from the push's cupped hand to lie flat on the cards, then relax back;
- the wrist extends, lifting the back of the hand: the flick that sends the cards off;
- he looks down at the cards as he lets them go, then away and a little up - done with it;
- and no sit-back: the chair he is already leaning on will not let him (see LAYERS).

The first pass read as a bet from the gameplay camera: the arm went to the stack and back
and the torso never moved. Its fingers were a fixed turn at every knuckle, which carried
them past straight and fanned them out. So the head now does the talking - a look down
as the cards go and a turn away after - and the fingers are not given an angle at all: each
knuckle is turned about its own axis until its finger lines up with its metacarpal in the
push's own pose, which is straight and never past it, and each middle joint is set to a
relaxed 15 degrees of bend.

Every axis and sign here was measured, not assumed: wrist.L +X lifts the fingertips;
finger*-1.L +X curls a fingertip towards the palm; spine03 and spine05 +X lean forward;
neck02 and head +X nod down; neck01 and neck02 +Z turn the face to his right. Every layer
is exactly zero on the first and last frame, so the fold starts and ends on the push's own
first frame, which is the idle's, and layers over the idle the way the push does.
"""
import math

import numpy as np
from mathutils import Euler, Quaternion

FOLD_CLIP = 'FOLD_muck'
FOLD_LAST_FRAME = 35
# The push as accepted up to here: frame 16 is the end of its forward travel.
PUSH_UNTIL = 16
PUSH_LAST_FRAME = 30
# The frame the hand lets go. The browser sends the cards off to the muck from here.
FOLD_RELEASE_FRAME = 16

# (bone, local axis, [(frame, degrees)]) - keys eased between with a smoothstep.
LAYERS = (
    # The flick: the back of the hand comes up as the fingers let go.
    ('wrist.L', 'X', ((0, 0), (12, 0), (17, 30), (22, 18), (30, 0), (35, 0))),
    # No sit-back through the spine. He is already against the backrest in the idle, and
    # measured in the Rooftop chair a twelve-degree lean put his back 37mm into it against
    # 2.8mm for every other clip. The chair decides how far he can sit back, and the answer
    # is not at all; the look away below carries being out of the hand instead.
    # A look down at the cards as they go, then away and a touch up: done with the hand.
    ('neck02', 'X', ((0, 0), (10, 0), (15, 5), (19, 5), (24, -2.5), (30, -2.5), (35, 0))),
    ('head', 'X', ((0, 0), (10, 0), (15, 5), (19, 5), (24, -2.5), (30, -2.5), (35, 0))),
    ('neck01', 'Z', ((0, 0), (18, 0), (24, 7.5), (30, 7.5), (35, 0))),
    ('neck02', 'Z', ((0, 0), (18, 0), (24, 7.5), (30, 7.5), (35, 0))),
)

# The fingers are shaped rather than turned: each is measured in the push's pose at the
# release. Knuckle and middle joint per finger, and the metacarpal the finger hangs from.
FINGERS = (
    ('finger2-1.L', 'finger2-2.L', 'metacarpal1.L'),
    ('finger3-1.L', 'finger3-2.L', 'metacarpal2.L'),
    ('finger4-1.L', 'finger4-2.L', 'metacarpal3.L'),
    ('finger5-1.L', 'finger5-2.L', 'metacarpal4.L'),
)
# Where the hand is flat on the cards, how bent the middle joints are there, and the frames
# the fingers uncurl over, hold through the flick, and relax back from.
MIDDLE_JOINT_BEND_DEG = 15.0
FINGER_FRAMES = ((10, 0.0), (16, 1.0), (17, 1.0), (19, 0.6), (25, 0.0), (35, 0.0))

AXES = {'X': (1.0, 0.0, 0.0), 'Y': (0.0, 1.0, 0.0), 'Z': (0.0, 0.0, 1.0)}


def envelope(keys, frame):
    """Degrees at `frame`, eased between the surrounding keys."""
    if frame <= keys[0][0]:
        return keys[0][1]
    for (f0, v0), (f1, v1) in zip(keys, keys[1:]):
        if f0 <= frame <= f1:
            t = (frame - f0) / (f1 - f0) if f1 > f0 else 1.0
            t = t * t * (3.0 - 2.0 * t)
            return v0 + (v1 - v0) * t
    return keys[-1][1]


def push_frame(frame):
    """The push frame the fold shows at `frame`: the push itself, then its return, slower."""
    if frame <= PUSH_UNTIL:
        return float(frame)
    span = (PUSH_LAST_FRAME - PUSH_UNTIL) / (FOLD_LAST_FRAME - PUSH_UNTIL)
    return PUSH_UNTIL + (frame - PUSH_UNTIL) * span


def sample_channels(push, frame):
    """The push's channels at a fractional frame: location and scale lerped, rotation slerped."""
    first = int(math.floor(frame))
    second = min(push.shape[0] - 1, first + 1)
    mix = frame - first
    a = push[first]
    b = push[second]
    out = a * (1.0 - mix) + b * mix
    if mix > 0.0:
        for bone in range(push.shape[1]):
            qa = Euler(a[bone, 3:6].tolist(), 'XYZ').to_quaternion()
            qb = Euler(b[bone, 3:6].tolist(), 'XYZ').to_quaternion()
            if qa.dot(qb) < 0.0:
                qb.negate()
            q = qa.slerp(qb, mix)
            out[bone, 3:6] = q.to_euler('XYZ', Euler(a[bone, 3:6].tolist(), 'XYZ'))
    return out


def _axes(posed, frame, index):
    """A bone's X and Y axes in armature space, from its posed matrix (row-major 4x4)."""
    m = posed[frame, index]
    x = np.array([m[0], m[4], m[8]], dtype=np.float64)
    y = np.array([m[1], m[5], m[9]], dtype=np.float64)
    return x / np.linalg.norm(x), y / np.linalg.norm(y)


def _signed_angle(a, b, axis):
    return math.degrees(math.atan2(float(np.dot(axis, np.cross(a, b))), float(np.dot(a, b))))


def finger_shape(posed, bone_names, frame):
    """Per finger, the turns about each joint's X that make the hand lie flat.

    The knuckle turns until the finger lines up with its metacarpal as closely as a turn
    about its own X allows - straight, and never past it, whichever way it was bent - and
    the middle joint is set to MIDDLE_JOINT_BEND_DEG of bend (+X curls towards the palm).
    """
    index = {name: i for i, name in enumerate(bone_names)}
    shape = {}
    for knuckle, middle, metacarpal in FINGERS:
        x1, y1 = _axes(posed, frame, index[knuckle])
        _, ym = _axes(posed, frame, index[metacarpal])
        target = ym - np.dot(ym, x1) * x1
        target /= np.linalg.norm(target)
        straighten = _signed_angle(y1, target, x1)
        x2, y2 = _axes(posed, frame, index[middle])
        bent = _signed_angle(y1, y2, x2)
        shape[knuckle] = straighten
        shape[middle] = MIDDLE_JOINT_BEND_DEG - bent
    return shape


def author_fold(push, push_posed, bone_names):
    """The fold's channels, frames x bones x (location, rotation_euler, scale).

    `push` is the accepted CHIP_toss as the build bakes it - every bone, every frame - and
    `push_posed` its posed matrices, which the fingers are measured on.
    """
    if push.shape[0] != PUSH_LAST_FRAME + 1:
        raise SystemExit('FAIL: the push has %d frames, the fold expects %d'
                         % (push.shape[0], PUSH_LAST_FRAME + 1))
    index = {name: i for i, name in enumerate(bone_names)}
    finger_bones = [bone for row in FINGERS for bone in row]
    missing = [bone for bone, _, _ in LAYERS if bone not in index]
    missing += [bone for bone in finger_bones if bone not in index]
    if missing:
        raise SystemExit('FAIL: the rig has no %s to author the fold on' % ', '.join(missing))
    frames = FOLD_LAST_FRAME + 1
    fold = np.empty((frames, push.shape[1], push.shape[2]), dtype=np.float64)
    for frame in range(frames):
        fold[frame] = sample_channels(push.astype(np.float64), push_frame(frame))
    # Measured at the frame the hand lets go, and eased in and out over FINGER_FRAMES.
    shape = finger_shape(push_posed, bone_names, PUSH_UNTIL)
    finger_layers = tuple(
        (bone, 'X', tuple((frame, degrees * weight) for frame, weight in FINGER_FRAMES))
        for bone, degrees in shape.items()
    )
    peaks = {}
    for bone, axis, keys in LAYERS + finger_layers:
        column = index[bone]
        previous = None
        for frame in range(frames):
            degrees = envelope(keys, frame)
            base = Euler(fold[frame, column, 3:6].tolist(), 'XYZ')
            turned = base.to_quaternion() @ Quaternion(AXES[axis], math.radians(degrees))
            compat = previous if previous is not None else base
            euler = turned.to_euler('XYZ', compat)
            fold[frame, column, 3:6] = (euler.x, euler.y, euler.z)
            previous = euler
            peaks[bone] = max(peaks.get(bone, 0.0), abs(degrees))
    return fold.astype(np.float32), {
        'clip': FOLD_CLIP,
        'frames': frames,
        'releaseFrame': FOLD_RELEASE_FRAME,
        'pushUntil': PUSH_UNTIL,
        'authoredPeaksDeg': {bone: round(value, 2) for bone, value in peaks.items()},
        'fingerShapeDeg': {bone: round(value, 2) for bone, value in shape.items()},
    }

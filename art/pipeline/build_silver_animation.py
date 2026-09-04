"""Author the silver male's motion set as keyposed, multi-bone, multi-axis clips.

The existing generator drives every clip from one sine on one axis:

    rads = magnitude * sin(pi * t)
    pose_bone.rotation_euler = (rads, 0.0, 0.0)

Every bone in a clip therefore moves on the same phase, on the same axis, out and
straight back. There is no anticipation, no overshoot, no settle, and no offset between
the shoulder and the hand - which is most of why the F3A packet calls those clips
scaffolding rather than motion.

This authors poses instead. Each clip is a list of (time, {bone: (x, y, z) degrees})
keys; the bones move on independent phases, on all three axes, and every action carries a
counter-move before it and a recovery after it.

THE SEATED BASE. build_assets.apply_seated_rest_pose sets pose-space rotations on the
spine, head, arms, wrists and fingers when a character is seated in a venue. A clip that
keys those same bones with absolute values would overwrite the seated pose and stand the
character up mid-hand. So every keypose here is the seated base plus a delta, and the base
is obtained by calling that function and reading the result rather than by copying its
numbers - the numbers live in one place.

Run: blender --background --python-exit-code 1 --python art/pipeline/build_silver_animation.py
"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-silver')
SOURCE = os.path.join(OUT, 'native-silver-character.blend')
ANIMATED = os.path.join(OUT, 'native-silver-animated.blend')
STRIPS = os.path.join(OUT, 'clips')

FPS = 30

# Clip names are a contract with apps/web/src/lib/animation.ts. A name the rig does not
# carry is a build error there rather than a silent no-op, so this list must match CLIPS.
CLIPS = {
    'IDLE_breathe': {
        'seconds': 5.0,
        'loop': True,
        # Two breaths and one slow gaze drift, deliberately on different periods so the
        # loop does not read as a metronome. The gaze is the thing that makes a seated
        # figure look alive; breathing alone reads as a machine.
        'keys': [
            (0.00, {}),
            (0.13, {'spine04': (1.3, 0, 0), 'spine03': (0.9, 0, 0), 'spine01': (0.7, 0, 0),
                    'clavicle.L': (-1.1, 0, 0), 'clavicle.R': (-1.1, 0, 0)}),
            (0.26, {'spine04': (0.2, 0, 0), 'spine03': (0.1, 0, 0)}),
            (0.34, {'head': (0.5, 2.6, 0.8), 'neck02': (0.3, 1.6, 0.4)}),
            (0.50, {'spine04': (1.3, 0, 0), 'spine03': (0.9, 0, 0), 'spine01': (0.7, 0, 0),
                    'clavicle.L': (-1.1, 0, 0), 'clavicle.R': (-1.1, 0, 0),
                    'head': (0.8, 3.1, 1.0), 'neck02': (0.4, 1.8, 0.5)}),
            (0.63, {'spine04': (0.2, 0, 0), 'head': (0.4, 1.2, 0.4)}),
            (0.76, {'head': (-0.3, -1.8, -0.6), 'neck02': (-0.2, -1.1, -0.3)}),
            (0.88, {'spine04': (0.9, 0, 0), 'spine03': (0.6, 0, 0),
                    'head': (-0.1, -0.7, -0.2)}),
            (1.00, {}),
        ],
    },
    'PEEK_card': {
        'seconds': 1.4,
        'loop': False,
        'keys': [
            (0.00, {}),
            (0.10, {'lowerarm01.R': (-4, 0, 0), 'head': (-1.5, 0, 0)}),
            (0.40, {'lowerarm01.R': (26, 0, -6), 'wrist.R': (14, 0, 8),
                    'head': (9, -4, 2), 'neck02': (5, -2, 1), 'spine01': (2, 0, 0)}),
            (0.55, {'lowerarm01.R': (23, 0, -5), 'wrist.R': (12, 0, 7),
                    'head': (8, -3.5, 1.6), 'neck02': (4.5, -1.8, 0.9)}),
            (0.74, {'lowerarm01.R': (24, 0, -5), 'wrist.R': (13, 0, 7),
                    'head': (8.4, -3.7, 1.8)}),
            (0.90, {'lowerarm01.R': (6, 0, -1), 'wrist.R': (3, 0, 2),
                    'head': (2, -1, 0.5)}),
            (1.00, {}),
        ],
    },
    'PRESET_reach': {
        'seconds': 1.1,
        'loop': False,
        'keys': [
            (0.00, {}),
            (0.13, {'upperarm01.R': (-4, 0, 2), 'lowerarm01.R': (-6, 0, 0)}),
            (0.46, {'upperarm01.R': (12, 0, -6), 'lowerarm01.R': (18, 0, 0),
                    'wrist.R': (10, 0, 4), 'clavicle.R': (2, 0, -2),
                    'spine01': (1.5, -2, 0), 'head': (2, -3, 0)}),
            (0.60, {'upperarm01.R': (13.5, 0, -6.5), 'lowerarm01.R': (20, 0, 0),
                    'wrist.R': (11, 0, 5)}),
            (0.80, {'upperarm01.R': (5, 0, -2), 'lowerarm01.R': (7, 0, 0),
                    'wrist.R': (4, 0, 2), 'head': (1, -1, 0)}),
            (1.00, {}),
        ],
    },
    'CHIP_toss': {
        'seconds': 1.0,
        'loop': False,
        # The push is the clearest place to show anticipation and recoil: the hand draws
        # back before it goes forward, overshoots the release, then comes back past
        # neutral before settling.
        'keys': [
            (0.00, {}),
            (0.15, {'upperarm01.R': (-7, 0, 3), 'lowerarm01.R': (-9, 0, 0),
                    'clavicle.R': (-2, 0, 1), 'spine01': (-1, 1, 0)}),
            (0.42, {'upperarm01.R': (16, 0, -8), 'lowerarm01.R': (30, 0, -4),
                    'wrist.R': (18, 0, 10), 'clavicle.R': (4, 0, -3),
                    'spine01': (2, -3, 0), 'head': (3, -4, 1)}),
            (0.54, {'upperarm01.R': (19, 0, -9), 'lowerarm01.R': (34, 0, -5),
                    'wrist.R': (22, 0, 12), 'head': (3.5, -4.5, 1.2)}),
            (0.72, {'upperarm01.R': (3, 0, -1), 'lowerarm01.R': (5, 0, 0),
                    'wrist.R': (2, 0, 1), 'clavicle.R': (-1, 0, 0)}),
            (0.88, {'upperarm01.R': (1, 0, 0), 'lowerarm01.R': (1.5, 0, 0)}),
            (1.00, {}),
        ],
    },
    'DEAL_toss': {
        'seconds': 1.2,
        'loop': False,
        'keys': [
            (0.00, {}),
            (0.14, {'upperarm01.L': (-6, 0, -3), 'lowerarm01.L': (-8, 0, 0)}),
            (0.44, {'upperarm01.L': (14, 0, 7), 'lowerarm01.L': (26, 0, 4),
                    'wrist.L': (16, 0, -9), 'clavicle.L': (3, 0, 2),
                    'spine01': (1.5, 3, 0), 'head': (2, 4, -1)}),
            (0.56, {'upperarm01.L': (16, 0, 8), 'lowerarm01.L': (30, 0, 5),
                    'wrist.L': (20, 0, -11)}),
            (0.76, {'upperarm01.L': (4, 0, 2), 'lowerarm01.L': (6, 0, 1),
                    'wrist.L': (2, 0, -1)}),
            (1.00, {}),
        ],
    },
    'FOLD_muck': {
        'seconds': 0.9,
        'loop': False,
        'keys': [
            (0.00, {}),
            (0.12, {'wrist.R': (-3, 0, -8), 'lowerarm01.R': (-4, 0, 0)}),
            (0.34, {'lowerarm01.R': (16, 0, -6), 'wrist.R': (8, 0, 26),
                    'upperarm01.R': (6, 0, -3), 'head': (2, -3, 1)}),
            (0.48, {'lowerarm01.R': (18, 0, -7), 'wrist.R': (10, 0, 32),
                    'head': (1, -2, 0.5)}),
            (0.70, {'lowerarm01.R': (5, 0, -2), 'wrist.R': (2, 0, 8),
                    'head': (-0.5, 1, 0)}),
            (1.00, {}),
        ],
    },
    'REACT_win': {
        'seconds': 1.8,
        'loop': False,
        # Restrained by contract: the packet puts a smug forward point at the ceiling for
        # ordinary play, so this is a chest lift, a chin raise and one small nod.
        'keys': [
            (0.00, {}),
            (0.14, {'spine04': (1.6, 0, 0), 'head': (2, 0, 0)}),
            (0.38, {'spine04': (-3.2, 0, 0), 'spine03': (-2.2, 0, 0), 'spine01': (-2.6, 0, 0),
                    'clavicle.L': (-3, 0, 0), 'clavicle.R': (-3, 0, 0),
                    'head': (-6, 2, -1.5), 'neck02': (-3, 1, -0.8)}),
            (0.54, {'spine04': (-2.6, 0, 0), 'head': (-2.5, 2.5, -1.2)}),
            (0.66, {'head': (-6.5, 1.5, -1.8), 'neck02': (-3.2, 0.8, -0.9)}),
            (0.84, {'spine04': (-1.2, 0, 0), 'spine01': (-1, 0, 0),
                    'head': (-2, 0.6, -0.6)}),
            (1.00, {}),
        ],
    },
    'REACT_lose': {
        'seconds': 1.6,
        'loop': False,
        'keys': [
            (0.00, {}),
            (0.13, {'head': (-2.5, 0, 0), 'spine04': (-1, 0, 0)}),
            (0.36, {'head': (11, 0, 0), 'neck02': (5, 0, 0), 'spine04': (3.2, 0, 0),
                    'spine03': (2.2, 0, 0), 'spine01': (2, 0, 0),
                    'clavicle.L': (4, 0, 0), 'clavicle.R': (4, 0, 0)}),
            (0.52, {'head': (10, 5, 2.5), 'neck02': (4.6, 2.4, 1.2)}),
            (0.66, {'head': (10, -5, -2.5), 'neck02': (4.6, -2.4, -1.2)}),
            (0.80, {'head': (9, 2, 1), 'neck02': (4, 1, 0.5)}),
            (0.92, {'head': (4, 0.5, 0), 'spine04': (1.4, 0, 0),
                    'clavicle.L': (1.6, 0, 0), 'clavicle.R': (1.6, 0, 0)}),
            (1.00, {}),
        ],
    },
    'ALLIN_standup': {
        'seconds': 2.0,
        'loop': False,
        # Ends held, not returned: the character is standing at the end of this one.
        'keys': [
            (0.00, {}),
            (0.16, {'upperleg01.L': (6, 0, 0), 'upperleg01.R': (6, 0, 0),
                    'spine04': (3.5, 0, 0), 'spine03': (2, 0, 0), 'head': (2.5, 0, 0)}),
            (0.52, {'upperleg01.L': (-30, 0, 0), 'upperleg01.R': (-30, 0, 0),
                    'lowerleg01.L': (-14, 0, 0), 'lowerleg01.R': (-14, 0, 0),
                    'spine04': (-6, 0, 0), 'spine03': (-3, 0, 0), 'spine01': (-4, 0, 0),
                    'clavicle.L': (-2.5, 0, 0), 'clavicle.R': (-2.5, 0, 0),
                    'head': (-8, 0, 0), 'neck02': (-3, 0, 0)}),
            (0.68, {'upperleg01.L': (-33, 0, 0), 'upperleg01.R': (-33, 0, 0),
                    'lowerleg01.L': (-16, 0, 0), 'lowerleg01.R': (-16, 0, 0),
                    'spine04': (-7, 0, 0), 'head': (-9.5, 0, 0)}),
            (0.86, {'upperleg01.L': (-30, 0, 0), 'upperleg01.R': (-30, 0, 0),
                    'lowerleg01.L': (-14, 0, 0), 'lowerleg01.R': (-14, 0, 0),
                    'spine04': (-6, 0, 0), 'spine01': (-4, 0, 0), 'head': (-7.5, 0, 0)}),
            (1.00, {'upperleg01.L': (-30, 0, 0), 'upperleg01.R': (-30, 0, 0),
                    'lowerleg01.L': (-14, 0, 0), 'lowerleg01.R': (-14, 0, 0),
                    'spine04': (-6, 0, 0), 'spine01': (-4, 0, 0), 'head': (-8, 0, 0),
                    'neck02': (-3, 0, 0)}),
        ],
    },
}


def apply_seated_rest(armature):
    """Bake the venue's seated pose into this rig's rest pose.

    apply_seated_rest_pose ends in bpy.ops.pose.armature_apply, so the seated pose becomes
    the rest pose and every pose channel returns to zero. That is what makes the clips
    below safe to author as plain deltas: a pose-space rotation of zero is the seated
    character, not a standing one, so nothing here can stand him up mid-hand.

    It is called rather than copied so the seated numbers live in exactly one place.
    """
    sys.path.insert(0, HERE)
    os.environ.setdefault('RIVER_OUT', os.path.join(ROOT, 'out'))
    import build_assets

    probe = 'upperleg01.L'
    before = armature.data.bones[probe].matrix_local.copy()
    build_assets.apply_seated_rest_pose(armature)
    after = armature.data.bones[probe].matrix_local
    delta = max(abs(a - b) for row_a, row_b in zip(before, after)
                for a, b in zip(row_a, row_b))
    posed = sum(1 for bone in armature.pose.bones
                if any(abs(v) > 1e-6 for v in bone.rotation_euler))
    print('SEATED_REST rest_delta=%.4f residual_pose_channels=%d' % (delta, posed))
    if delta < 1e-3:
        raise SystemExit('FAIL: the seated pose did not reach the rest pose')
    if posed:
        raise SystemExit('FAIL: %d pose channels survived the rest bake, so clip deltas '
                         'would not start from the seated pose' % posed)


def action_fcurves(action):
    """Every F-curve on an action, across both Action layouts.

    Blender 5.2 moved to slotted actions: curves now live under layers, strips and
    channelbags, and Action.fcurves is gone. Older files still have the flat list.
    """
    flat = getattr(action, 'fcurves', None)
    if flat is not None:
        return list(flat)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', ()):
                curves.extend(bag.fcurves)
    return curves


def reset_pose(armature):
    """Zero every pose channel.

    Authoring leaves the rig at the last clip's final keyframe, and a later clip only
    keys the bones it owns - so ALLIN_standup's -30 degree thighs stayed under every
    subsequent clip and tipped the figure backwards in all of its frames. Clips must be
    authored from, and previewed from, a clean pose.
    """
    for bone in armature.pose.bones:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.location = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)


def author_clip(armature, name, spec):
    reset_pose(armature)
    duration = max(1, int(round(spec['seconds'] * FPS)))
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data_create().action = action

    owned = sorted({bone for _, pose in spec['keys'] for bone in pose})
    missing = [bone for bone in owned if armature.pose.bones.get(bone) is None]
    if missing:
        raise SystemExit('FAIL: clip %s references missing bone(s): %s'
                         % (name, ', '.join(missing)))
    if spec['loop'] and spec['keys'][0][1] != spec['keys'][-1][1]:
        raise SystemExit('FAIL: looping clip %s does not close on its first pose' % name)

    for time, pose in spec['keys']:
        frame = round(time * duration)
        for bone_name in owned:
            bone = armature.pose.bones[bone_name]
            bone.rotation_mode = 'XYZ'
            delta = pose.get(bone_name, (0.0, 0.0, 0.0))
            bone.rotation_euler = tuple(math.radians(value) for value in delta)
            bone.keyframe_insert('rotation_euler', frame=frame)

    # Bezier with automatic-clamped handles: eased in and out, and it will not overshoot
    # between two keys that already encode a deliberate overshoot of their own.
    curves = action_fcurves(action)
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = 'BEZIER'
            point.handle_left_type = 'AUTO_CLAMPED'
            point.handle_right_type = 'AUTO_CLAMPED'
    action.frame_range = (0, duration)
    expected = len(owned) * 3
    if len(curves) != expected:
        raise SystemExit('FAIL: clip %s produced %d curves, expected %d - a bone is not '
                         'being keyed on all three axes' % (name, len(curves), expected))
    print('CLIP %-16s frames=%d bones=%d curves=%d keys=%d'
          % (name, duration, len(owned), len(curves), len(spec['keys'])))
    return action


def push_to_nla(armature, actions):
    animation = armature.animation_data
    animation.action = None
    for track in list(animation.nla_tracks):
        animation.nla_tracks.remove(track)
    for action in actions:
        track = animation.nla_tracks.new()
        track.name = action.name
        track.strips.new(action.name, int(action.frame_range[0]), action)
    print('NLA tracks=%d' % len(animation.nla_tracks))


STRIP_FRAMES = 6


def setup_strip_render(scene):
    """Flat light, seated three-quarter framing, small - these are motion contact sheets,
    not beauty renders."""
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT':
            obj.hide_render = not obj.name.startswith('flat_')
    scene.render.resolution_x, scene.render.resolution_y = 360, 460
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.15
    scene.world.color = (0.055, 0.058, 0.062)
    camera = scene.camera
    # Long and far back. A 38-degree lens at 1.85m leaned the figure backwards hard
    # enough that the perspective read as part of the animation.
    camera.data.angle = math.radians(24.0)
    camera.location = (2.60, -4.60, 1.12)
    from mathutils import Vector
    target = Vector((0.0, 0.0, 1.00))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()


def render_strip(scene, armature, action, name):
    """One image per clip: STRIP_FRAMES evenly spaced poses laid side by side.

    A single frame cannot show whether a clip has anticipation and recovery, and stepping
    through nine clips one render at a time is how a motion pass quietly never gets
    looked at.
    """
    import numpy as np

    reset_pose(armature)
    armature.animation_data.action = action
    start, end = action.frame_range
    frames = [round(start + (end - start) * i / (STRIP_FRAMES - 1))
              for i in range(STRIP_FRAMES)]
    tiles = []
    os.makedirs(STRIPS, exist_ok=True)
    for index, frame in enumerate(frames):
        scene.frame_set(int(frame))
        path = os.path.join(STRIPS, '%s_%02d.png' % (name, index))
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        width, height = image.size
        tiles.append(np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4))
        bpy.data.images.remove(image)
        os.remove(path)
    strip = np.hstack(tiles)
    out = bpy.data.images.new('strip_' + name, strip.shape[1], strip.shape[0], alpha=True)
    out.pixels = strip.reshape(-1).tolist()
    out.filepath_raw = os.path.join(OUT, 'native-silver-clip-' + name + '.png')
    out.file_format = 'PNG'
    out.save()
    print('STRIP %-16s frames=%s' % (name, ','.join(str(f) for f in frames)))


def main():
    if not os.path.exists(SOURCE):
        raise SystemExit('FAIL: missing silver source ' + SOURCE)
    bpy.ops.wm.open_mainfile(filepath=SOURCE)
    armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if armature is None:
        raise SystemExit('FAIL: silver source has no armature')

    # Deliberately NOT calling apply_seated_rest here. It ends in pose.armature_apply,
    # which makes the seated pose the rest pose and zeroes every pose channel - so the
    # armature deformation becomes identity and the mesh renders in its original standing
    # shape rather than seated. It is also unnecessary: these clips are pose-space deltas,
    # and the venue bakes the seated pose into the rest before playing them, so a delta of
    # zero is already the seated character there.
    #
    # The consequence is that these strips verify MOTION, not seating. ALLIN_standup in
    # particular reads as a backward lean here and only reads as rising from a chair once
    # the venue's seated rest is under it.
    actions = [author_clip(armature, name, spec) for name, spec in CLIPS.items()]

    scene = bpy.context.scene
    setup_strip_render(scene)
    for action in actions:
        render_strip(scene, armature, action, action.name)

    push_to_nla(armature, actions)
    bpy.ops.wm.save_as_mainfile(filepath=ANIMATED)
    print('ANIMATED %s clips=%d' % (ANIMATED, len(actions)))


if __name__ == '__main__':
    main()

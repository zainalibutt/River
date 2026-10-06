"""Author Gold's all-in: the push she has, then a poised stand instead of the hands at her chest.

Gold's accepted all-in pushes with both hands, rises, and from frame 48 holds both hands at
her chest without moving for the rest of the clip. The push and the rise stay exactly as they
are - the chip flight is timed to the push, and the seat corrective on her dress is driven by
how far the pelvis has lifted. From the end of the push her arms are re-authored:

- as she rises her left hand travels to her left hip, elbow out, and her right arm settles
  relaxed at her side;
- once she is up her weight goes onto her left leg: the pelvis shifts over it and tips, left
  hip high, the shoulders tip the other way, and her head tilts with the chin a little up;
- the hold carries a slow sway, so it is a stance rather than a still.

The arms are solved with IK to hand targets that move with her pelvis, and the legs with IK to
her feet as authored, so the hand lands on the hip and the feet stay planted while the pelvis
moves over them. Everything is baked back into plain keys on every bone and frame, and the
constraints are removed. The accepted clip is kept in the file under another name.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/author_gold_allin.py -- \\
      --source <gold master .blend> --output <out .blend> --report <report .json>
"""
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from public_save import save_public  # noqa: E402

RIG = 'river_native_gold_body.rig'
DRESS = 'river_native_gold_dress'
CLIP = 'ALLIN_standup'
ACCEPTED = 'A72 ALLIN_standup hands at chest'
LAST = 90
ARMS_IN = (18.0, 26.0)      # arm IK takes over from the push
HANDS_SET = 48.0            # hands reach the stance
LEGS_IN = (38.0, 44.0)      # leg IK holds the feet before the pelvis moves over them
STANCE = (44.0, 58.0)       # weight onto the left leg
SWAY_PERIOD = 64.0          # frames, from the end of the stance
# The stance, in metres and degrees. Her left is +X and she faces -Y.
HIP_SHIFT_M = 0.028
HIP_TILT_DEG = 4.0          # left hip up
SHOULDER_COUNTER_DEG = 6.5  # spread over the spine, so the shoulders tip the other way
HEAD_TILT_DEG = 7.0         # towards her right shoulder
CHIN_UP_DEG = 4.0
SWAY_M = 0.005
SWAY_TILT_DEG = 0.8
# Hand targets (wrist joints), measured from her standing body at the accepted hold.
WAIST_BAND_M = (0.08, 0.14)  # above the pelvis joint: where a hand rests on the hip
LEFT_ON_WAIST = (0.03, 0.02, 0.02)   # from the side of the dress there: out, back, up
RIGHT_HANG = (-0.105, -0.01, 0.02)   # from the right hip joint: beside the thigh
# How each hand is held at the stance, in world axes: the direction the fingers point and the
# direction the palm faces. On the waist the fingers point forward and down with the palm on
# her side; the hanging hand points down with the palm to her thigh.
HAND_POSE = {'L': ((0.0, -0.55, -0.83), (-1.0, 0.0, 0.0)),
             'R': ((0.0, -0.15, -0.99), (1.0, 0.0, 0.0))}
HANDS_TURN = (30.0, 48.0)
SIDES = ('L', 'R')


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    return parser.parse_args(argv)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def ease(edge0, edge1, x):
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def frame(scene, f):
    scene.frame_set(int(f))
    bpy.context.view_layer.update()


def world(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].matrix


def about(axis, degrees, pivot):
    """A world-space rotation about an axis through a point."""
    return (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(degrees), 4, axis)
            @ Matrix.Translation(-pivot))


def set_world(rig, name, matrix):
    bone = rig.pose.bones[name]
    bone.matrix = rig.matrix_world.inverted() @ matrix
    bpy.context.view_layer.update()


def key_bone(bone, f):
    bone.keyframe_insert('location', frame=f)
    if bone.rotation_mode == 'QUATERNION':
        bone.keyframe_insert('rotation_quaternion', frame=f)
    else:
        bone.keyframe_insert('rotation_euler', frame=f)


def empty(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def key_world(obj, matrix, f):
    obj.matrix_world = matrix
    obj.keyframe_insert('location', frame=f)
    obj.keyframe_insert('rotation_euler', frame=f)


def ik(rig, bone, target, pole, chain):
    constraint = rig.pose.bones[bone].constraints.new('IK')
    constraint.target = target
    constraint.pole_target = pole
    constraint.chain_count = chain
    constraint.use_tail = True
    constraint.use_stretch = False
    return constraint


def calibrate_pole(rig, scene, constraint, joint, f):
    """The pole angle that leaves the joint where FK put it, when the target sits on the FK end."""
    frame(scene, f)
    best = None
    for angle in (-180.0, -90.0, 0.0, 90.0):
        constraint.pole_angle = math.radians(angle)
        constraint.influence = 1.0
        bpy.context.view_layer.update()
        placed = world(rig, joint).translation.copy()
        constraint.influence = 0.0
        bpy.context.view_layer.update()
        free = world(rig, joint).translation.copy()
        error = (placed - free).length
        if best is None or error < best[1]:
            best = (angle, error)
    constraint.pole_angle = math.radians(best[0])
    return best


def hand_frame(rig, side):
    """The wrist, the direction the fingers point and the direction the palm faces.

    Fingers run from the wrist to the middle finger's knuckle; the thumb's knuckle gives the
    side of the hand, and the palm faces fingers x thumb-side on the left hand and the mirror of
    that on the right.
    """
    wrist = world(rig, 'wrist.' + side).translation.copy()
    fingers = (world(rig, 'finger3-1.' + side).translation - wrist).normalized()
    thumb = world(rig, 'finger1-1.' + side).translation - wrist
    thumb = (thumb - fingers * thumb.dot(fingers)).normalized()
    palm = fingers.cross(thumb) if side == 'L' else thumb.cross(fingers)
    return wrist, fingers, palm


def dress_bvh(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    polygons = [tuple(p.vertices) for p in mesh.polygons]
    evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(points, polygons), np.array([tuple(p) for p in points])


def main():
    args = arguments()
    source = os.path.abspath(args.source)
    bpy.ops.wm.open_mainfile(filepath=source, load_ui=False)
    scene = bpy.context.scene
    rig = bpy.data.objects[RIG]
    accepted = bpy.data.actions[CLIP]
    accepted.name = ACCEPTED
    work = accepted.copy()
    work.name = CLIP
    if work.name != CLIP or accepted.name != ACCEPTED:
        raise SystemExit('FAIL: could not set the clip names (%s, %s)' % (work.name, accepted.name))
    rig.animation_data.action = work
    if work.slots:
        rig.animation_data.action_slot = work.slots[0]
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)

    # What the accepted clip does, before anything moves.
    original = {}
    for f in range(LAST + 1):
        frame(scene, f)
        original[f] = {name: world(rig, name).copy() for name in
                       ('root', 'foot.L', 'foot.R', 'wrist.L', 'wrist.R', 'lowerarm01.L', 'lowerarm01.R',
                        'lowerleg01.L', 'lowerleg01.R', 'upperleg01.L', 'upperleg01.R', 'head')}
    stand = int(HANDS_SET) + 6
    frame(scene, stand)
    tree, points = dress_bvh(bpy.data.objects[DRESS])
    root_stand = original[stand]['root']
    hip_z = original[stand]['upperleg01.L'].translation.z
    pelvis_z = root_stand.translation.z
    band = points[(points[:, 2] > pelvis_z + WAIST_BAND_M[0]) & (points[:, 2] < pelvis_z + WAIST_BAND_M[1])]
    side = band[np.argmax(band[:, 0])]
    left_wrist_world = Vector(side) + Vector(LEFT_ON_WAIST)
    right_wrist_world = original[stand]['upperleg01.R'].translation + Vector(RIGHT_HANG)
    to_root = root_stand.inverted()
    final_local = {'L': to_root @ left_wrist_world, 'R': to_root @ right_wrist_world}

    # 1. The stance, on the FK bones: pelvis over the left leg, shoulders and head against it.
    # Every frame is posed from the accepted clip, never from keys written here: the accepted hold
    # is sparsely keyed, so a key written on one frame would move the next frame's reading.
    forward = Vector((0.0, -1.0, 0.0))
    right_axis = Vector((1.0, 0.0, 0.0))
    stance_bones = ('root', 'spine03', 'spine01', 'head')
    rig.animation_data.action = accepted
    if accepted.slots:
        rig.animation_data.action_slot = accepted.slots[0]
    posed = {}
    for f in range(LAST + 1):
        w = ease(STANCE[0], STANCE[1], f)
        sway = 0.0
        if f > STANCE[1]:
            sway = math.sin(2.0 * math.pi * (f - STANCE[1]) / SWAY_PERIOD)
        frame(scene, f)
        if w <= 0.0:
            posed[f] = {name: rig.pose.bones[name].matrix_basis.copy() for name in stance_bones}
            continue
        root = world(rig, 'root')
        pivot = root.translation.copy()
        # Her left hip rises: a turn about the forward axis that lifts +X.
        tilt = HIP_TILT_DEG * w + SWAY_TILT_DEG * sway
        moved = Matrix.Translation(Vector((HIP_SHIFT_M * w + SWAY_M * sway, 0.0, 0.0))) @ about(forward, tilt, pivot) @ root
        set_world(rig, 'root', moved)
        # The spine takes the pelvis's tip and its sway back out, and tips the shoulders past level.
        for name, share in (('spine03', 0.35), ('spine01', 0.65)):
            matrix = world(rig, name)
            set_world(rig, name, about(forward, -(tilt + SHOULDER_COUNTER_DEG * w) * share,
                                       matrix.translation.copy()) @ matrix)
        # A positive turn about the forward axis takes the top of her head to her right.
        head = world(rig, 'head')
        drift = 0.0 if f <= STANCE[1] else math.sin(2.0 * math.pi * (f - STANCE[1]) / SWAY_PERIOD + 1.3)
        turned = about(forward, HEAD_TILT_DEG * w + SWAY_TILT_DEG * drift, head.translation.copy()) @ head
        turned = about(right_axis, -CHIN_UP_DEG * w, head.translation.copy()) @ turned
        set_world(rig, 'head', turned)
        posed[f] = {name: rig.pose.bones[name].matrix_basis.copy() for name in stance_bones}
    rig.animation_data.action = work
    if work.slots:
        rig.animation_data.action_slot = work.slots[0]
    for name in stance_bones:
        bone = rig.pose.bones[name]
        previous = None
        for f in range(LAST + 1):
            location, rotation, _ = posed[f][name].decompose()
            bone.location = location
            if bone.rotation_mode == 'QUATERNION':
                bone.rotation_quaternion = rotation
            else:
                euler = rotation.to_euler(bone.rotation_mode, previous) if previous else rotation.to_euler(bone.rotation_mode)
                bone.rotation_euler = euler
                previous = euler
            key_bone(bone, f)
    frame(scene, 0)

    # 2. Targets. Hands move in the pelvis's frame, so the hip hand rides the stance.
    targets = {side: empty('gold allin hand ' + side) for side in SIDES}
    elbows = {side: empty('gold allin elbow ' + side) for side in SIDES}
    feet = {side: empty('gold allin foot ' + side) for side in SIDES}
    knees = {side: empty('gold allin knee ' + side) for side in SIDES}
    start_local = {side: original[int(ARMS_IN[0])]['root'].inverted() @ original[int(ARMS_IN[0])]['wrist.' + side].translation
                   for side in SIDES}
    # The left hand passes the front of the waist on its way to the hip, clear of the dress. The
    # offset is out and forward in the world, turned into the pelvis's frame at the stance.
    via_left = (final_local['L'].lerp(start_local['L'], 0.5)
                + to_root.to_3x3() @ Vector((0.05, -0.10, 0.0)))
    for f in range(LAST + 1):
        frame(scene, f)
        root = world(rig, 'root')
        t = ease(ARMS_IN[0], HANDS_SET, f)
        for side in SIDES:
            if side == 'L' and t < 0.5:
                local = start_local['L'].lerp(via_left, ease(0.0, 0.5, t))
            elif side == 'L':
                local = via_left.lerp(final_local['L'], ease(0.5, 1.0, t))
            else:
                local = start_local['R'].lerp(final_local['R'], t)
            hand = root @ local
            key_world(targets[side], Matrix.Translation(hand), f)
            # Elbow poles in world axes: the hip hand's elbow out to her left, the
            # hanging arm's elbow behind her.
            offset = Vector((0.42, 0.06, 0.20)) if side == 'L' else Vector((-0.12, 0.30, 0.22))
            key_world(elbows[side], Matrix.Translation(hand + offset), f)
            key_world(feet[side], original[f]['foot.' + side], f)
            knee = original[f]['lowerleg01.' + side].translation + Vector((0.0, -0.5, 0.0))
            key_world(knees[side], Matrix.Translation(knee), f)

    # 3. Constraints, blended in over the clip.
    report = {'source': os.path.basename(source), 'sourceSha256': sha256_file(source), 'poles': {}}
    constraints = []
    for side in SIDES:
        for locked in ('upperarm02.' + side, 'lowerarm02.' + side, 'upperleg02.' + side, 'lowerleg02.' + side):
            bone = rig.pose.bones[locked]
            bone.lock_ik_x = bone.lock_ik_y = bone.lock_ik_z = True
        arm = ik(rig, 'lowerarm02.' + side, targets[side], elbows[side], 4)
        leg = ik(rig, 'lowerleg02.' + side, feet[side], knees[side], 4)
        planted = rig.pose.bones['foot.' + side].constraints.new('COPY_ROTATION')
        planted.target = feet[side]
        for label, constraint, joint, reference in (('arm', arm, 'lowerarm01.' + side, ARMS_IN[0]),
                                                    ('leg', leg, 'lowerleg01.' + side, LEGS_IN[1])):
            angle, error = calibrate_pole(rig, scene, constraint, joint, int(reference))
            report['poles']['%s %s' % (label, side)] = {'angle': angle, 'jointShiftMm': error * 1000.0}
        for constraint, span in ((arm, ARMS_IN), (leg, LEGS_IN), (planted, LEGS_IN)):
            for f in range(LAST + 1):
                constraint.influence = ease(span[0], span[1], f)
                constraint.keyframe_insert('influence', frame=f)
            constraints.append(constraint)

    # 4. Bake every bone on every frame, then drop the helpers.
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=0, frame_end=LAST, step=1, only_selected=False, visual_keying=True,
                     clear_constraints=True, clear_parents=False, use_current_action=True,
                     clean_curves=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    for side in SIDES:
        for bone in ('upperarm02.' + side, 'lowerarm02.' + side, 'upperleg02.' + side, 'lowerleg02.' + side):
            b = rig.pose.bones[bone]
            b.lock_ik_x = b.lock_ik_y = b.lock_ik_z = False
    left = sum(len(b.constraints) for b in rig.pose.bones)
    if left:
        raise SystemExit('FAIL: %d constraints survived the bake' % left)
    # The influence keys were written into the clip; with the constraints gone they point nowhere.
    for layer in work.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in [c for c in bag.fcurves if '.constraints[' in c.data_path]:
                    bag.fcurves.remove(curve)
    for group in (targets, elbows, feet, knees):
        for obj in group.values():
            bpy.data.objects.remove(obj, do_unlink=True)
    if rig.animation_data.action != work or work.name != CLIP:
        raise SystemExit('FAIL: the bake did not land in %s' % CLIP)

    # 5. Turn each hand into its stance, about the wrist, from where the IK left it.
    for f in range(LAST + 1):
        w = ease(HANDS_TURN[0], HANDS_TURN[1], f)
        if w <= 0.0:
            continue
        frame(scene, f)
        for side in SIDES:
            wrist, fingers, palm = hand_frame(rig, side)
            want_fingers, want_palm = (Vector(v).normalized() for v in HAND_POSE[side])
            want_palm = (want_palm - want_fingers * want_palm.dot(want_fingers)).normalized()
            have = Matrix((fingers, palm, fingers.cross(palm))).transposed()
            want = Matrix((want_fingers, want_palm, want_fingers.cross(want_palm))).transposed()
            turn = Quaternion().slerp((want @ have.transposed()).to_quaternion(), w)
            bone = rig.pose.bones['wrist.' + side]
            matrix = world(rig, 'wrist.' + side)
            set_world(rig, 'wrist.' + side, Matrix.Translation(wrist) @ turn.to_matrix().to_4x4()
                      @ Matrix.Translation(-wrist) @ matrix)
            bone.keyframe_insert('rotation_euler' if bone.rotation_mode != 'QUATERNION' else 'rotation_quaternion',
                                 frame=f)

    # 6. Measure what was made.
    checks = {'feetMaxMm': 0.0, 'pushChangedMm': 0.0, 'liftChangedMm': 0.0}
    for f in range(LAST + 1):
        frame(scene, f)
        for side in SIDES:
            drift = (world(rig, 'foot.' + side).translation - original[f]['foot.' + side].translation).length
            checks['feetMaxMm'] = max(checks['feetMaxMm'], drift * 1000.0)
            if f <= ARMS_IN[0]:
                moved = (world(rig, 'wrist.' + side).translation - original[f]['wrist.' + side].translation).length
                checks['pushChangedMm'] = max(checks['pushChangedMm'], moved * 1000.0)
        if f < STANCE[0]:
            lift = abs(world(rig, 'root').translation.z - original[f]['root'].translation.z)
            checks['liftChangedMm'] = max(checks['liftChangedMm'], lift * 1000.0)
    hold = int(STANCE[1]) + 2
    frame(scene, hold)
    tree, _ = dress_bvh(bpy.data.objects[DRESS])
    wrist = world(rig, 'wrist.L').translation
    nearest = tree.find_nearest(wrist)
    checks['leftWristToDressMm'] = nearest[3] * 1000.0 if nearest[0] is not None else None
    checks['leftWristTargetMissMm'] = (wrist - (world(rig, 'root') @ final_local['L'])).length * 1000.0
    checks['hipsAtHold'] = {'leftMinusRightMm': (world(rig, 'upperleg01.L').translation.z
                                                 - world(rig, 'upperleg01.R').translation.z) * 1000.0,
                            'shiftMm': (world(rig, 'root').translation.x - original[hold]['root'].translation.x) * 1000.0}
    report['checks'] = checks
    print('GOLD ALLIN checks', json.dumps(checks))
    if checks['feetMaxMm'] > 3.0:
        raise SystemExit('FAIL: her feet slide %.1f mm' % checks['feetMaxMm'])
    if checks['pushChangedMm'] > 0.5 or checks['liftChangedMm'] > 0.5:
        raise SystemExit('FAIL: the push or the rise changed (%.2f, %.2f mm)' % (checks['pushChangedMm'],
                                                                                checks['liftChangedMm']))

    frame(scene, 0)
    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    save_public(output)
    report['output'] = os.path.basename(output)
    report['outputSha256'] = sha256_file(output)
    with open(args.report, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2)
        handle.write('\n')
    print('GOLD ALLIN PASS %s' % output)


main()

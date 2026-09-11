"""Native Amber: an isolated seated-first River character proof.

Amber is built from the same native CC0 MakeHuman pipeline as Native Gold and Native
Silver - MPFB2 human, named identity recipe of morph targets, builtin 137-bone rig,
mhclo wardrobe - but owns his identity, wardrobe and material authoring. The jacket is
the stock continuous `male_elegantsuit01` surface tailored to the seated figure; the
roll-neck is derived from Amber's own neck and upper-chest skin so no collar piece can
float or intersect. The seated rest is the shared venue pose from build_assets, plus a
right arm authored into an available betting position.

Run build:   blender --background --python-exit-code 1 --python art/pipeline/build_native_amber.py
Run verify:  ... build_native_amber.py -- --verify
Run sheets:  ... build_native_amber.py -- --render contact|idle|both
"""
import json
import math
import os
import struct
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-amber')
BLEND = os.path.join(OUT, 'native-amber-character.blend')
GLB = os.path.join(OUT, 'native-amber-character.glb')
REPORT_JSON = os.path.join(OUT, 'native-amber-report.json')
REPORT_MD = os.path.join(OUT, 'native-amber-report.md')
CONTACT_SHEET = os.path.join(OUT, 'native-amber-contact-sheet.png')
IDLE_SHEET = os.path.join(OUT, 'native-amber-idle-sheet.png')
MPFB_DATA = os.path.join(
    os.environ['APPDATA'], 'Blender Foundation', 'Blender', '5.2', 'mpfb')

ASSETS = {
    'eyes': ('eyes', 'high-poly', 'high-poly.mhclo'),
    'eyebrows': ('eyebrows', 'eyebrow007', 'eyebrow007.mhclo'),
    'eyelashes': ('eyelashes', 'eyelashes02', 'eyelashes02.mhclo'),
    'hair': ('hair', 'short04', 'short04.mhclo'),
    'suit': ('clothes', 'male_elegantsuit01', 'male_elegantsuit01.mhclo'),
    'shoes': ('clothes', 'shoes01', 'shoes01.mhclo'),
    'skin': ('skins', 'old_african_male', 'old_african_male.mhmat'),
}

# Measured on art/out/proofs/native-silver/native-silver-character.blend so the rig
# contract is checked against the shipped donor rather than against a bone count.
REQUIRED_BONES = (
    'root', 'pelvis.L', 'upperleg01.L', 'upperleg02.L', 'lowerleg01.L', 'lowerleg02.L',
    'foot.L', 'toe1-1.L', 'pelvis.R', 'upperleg01.R', 'upperleg02.R', 'lowerleg01.R',
    'lowerleg02.R', 'foot.R', 'toe1-1.R', 'spine05', 'spine04', 'spine03', 'spine02',
    'breast.L', 'breast.R', 'spine01', 'clavicle.L', 'shoulder01.L', 'upperarm01.L',
    'upperarm02.L', 'lowerarm01.L', 'lowerarm02.L', 'wrist.L', 'finger1-1.L',
    'finger1-2.L', 'finger1-3.L', 'metacarpal1.L', 'finger2-1.L', 'finger2-2.L',
    'finger2-3.L', 'metacarpal2.L', 'finger3-1.L', 'finger3-2.L', 'finger3-3.L',
    'metacarpal3.L', 'finger4-1.L', 'finger4-2.L', 'finger4-3.L', 'metacarpal4.L',
    'finger5-1.L', 'finger5-2.L', 'finger5-3.L', 'clavicle.R', 'shoulder01.R',
    'upperarm01.R', 'upperarm02.R', 'lowerarm01.R', 'lowerarm02.R', 'wrist.R',
    'finger1-1.R', 'finger1-2.R', 'finger1-3.R', 'metacarpal1.R', 'finger2-1.R',
    'finger2-2.R', 'finger2-3.R', 'metacarpal2.R', 'finger3-1.R', 'finger3-2.R',
    'finger3-3.R', 'metacarpal3.R', 'finger4-1.R', 'finger4-2.R', 'finger4-3.R',
    'metacarpal4.R', 'finger5-1.R', 'finger5-2.R', 'finger5-3.R', 'neck01', 'neck02',
    'neck03', 'head', 'jaw', 'special04', 'oris02', 'oris01', 'oris06.L', 'oris07.L',
    'oris06.R', 'oris07.R', 'tongue00', 'tongue01', 'tongue02', 'tongue03', 'tongue04',
    'tongue07.L', 'tongue07.R', 'tongue06.L', 'tongue06.R', 'tongue05.L', 'tongue05.R',
    'levator02.L', 'levator03.L', 'levator04.L', 'levator05.L', 'levator02.R',
    'levator03.R', 'levator04.R', 'levator05.R', 'special01', 'oris04.L', 'oris03.L',
    'oris04.R', 'oris03.R', 'oris06', 'oris05', 'special03', 'levator06.L',
    'levator06.R', 'special06.L', 'special05.L', 'eye.L', 'orbicularis03.L',
    'orbicularis04.L', 'special06.R', 'special05.R', 'eye.R', 'orbicularis03.R',
    'orbicularis04.R', 'temporalis01.L', 'oculi02.L', 'oculi01.L', 'temporalis01.R',
    'oculi02.R', 'oculi01.R', 'temporalis02.L', 'risorius02.L', 'risorius03.L',
    'temporalis02.R', 'risorius02.R', 'risorius03.R',
)

EXPECTED_CLIPS = (
    'ALLIN_standup', 'CHIP_toss', 'DEAL_toss', 'FOLD_muck', 'IDLE_breathe',
    'PEEK_card', 'PRESET_reach', 'REACT_lose', 'REACT_win',
)

CHARACTER_MESHES = (
    'river_native_amber_body', 'river_amber_eyes', 'river_amber_eyebrows',
    'river_amber_eyelashes', 'river_amber_hair', 'river_amber_suit',
    'river_amber_shoes', 'river_amber_rollneck',
)

MACROS = {
    'gender': 0.95, 'age': 0.84, 'muscle': 0.30, 'weight': 0.52,
    'proportions': 0.55, 'height': 0.57,
}
RACE = {'african': 0.42, 'asian': 0.03, 'caucasian': 0.55}

AMBER_MALE_IDENTITY = (
    ('head-rectangular', 0.65), ('head-oval', 0.35),
    ('head-back-scale-depth-decr', 0.55),
    ('head-scale-vert-incr', 0.35), ('head-scale-horiz-decr', 0.45),
    ('head-fat-decr', 0.75), ('head-age-incr', 0.30),
    ('forehead-temple-decr', 0.90), ('forehead-nubian-decr', 0.65),
    ('eyebrows-trans-down', 0.25), ('eyebrows-angle-down', 0.35),
    ('l-eye-bag-incr', 1.00), ('r-eye-bag-incr', 1.00),
    ('l-eye-bag-height-incr', 0.45), ('r-eye-bag-height-incr', 0.45),
    ('l-eye-height1-decr', 0.55), ('r-eye-height1-decr', 0.55),
    ('l-eye-eyefold-down', 0.50), ('r-eye-eyefold-down', 0.50),
    ('l-eye-push1-in', 0.50), ('r-eye-push1-in', 0.50),
    ('l-cheek-bones-incr', 0.95), ('r-cheek-bones-incr', 0.95),
    ('l-cheek-volume-decr', 0.95), ('r-cheek-volume-decr', 0.95),
    ('l-cheek-inner-decr', 0.75), ('r-cheek-inner-decr', 0.75),
    ('l-cheek-trans-up', 0.35), ('r-cheek-trans-up', 0.35),
    ('nose-scale-vert-incr', 0.45), ('nose-scale-horiz-decr', 0.35),
    ('nose-hump-incr', 0.30), ('nose-point-down', 0.45),
    ('nose-scale-depth-incr', 0.45), ('nose-width2-decr', 0.25),
    ('nose-width3-decr', 0.25),
    ('mouth-scale-horiz-incr', 0.55), ('mouth-angles-down', 0.55),
    ('mouth-upperlip-volume-decr', 0.70), ('mouth-lowerlip-volume-decr', 0.45),
    ('mouth-philtrum-volume-incr', 0.45), ('mouth-laugh-lines-out', 0.95),
    ('chin-bones-incr', 0.60), ('chin-width-decr', 0.35),
    ('chin-prominent-incr', 0.35), ('chin-height-incr', 0.35),
    ('neck-scale-horiz-incr', 0.30), ('neck-scale-vert-decr', 0.45),
    ('l-ear-scale-incr', 0.30), ('r-ear-scale-incr', 0.30),
    ('l-ear-flap-incr', 0.20), ('r-ear-flap-incr', 0.20),
    ('measure-shoulder-dist-decr', 0.25), ('torso-vshape-decr', 0.30),
    ('measure-waist-circ-incr', 0.65), ('measure-hips-circ-incr', 0.15),
    ('torso-scale-depth-incr', 0.50),
    ('l-upperarm-muscle-decr', 0.50), ('r-upperarm-muscle-decr', 0.50),
    ('l-lowerarm-fat-incr', 0.15), ('r-lowerarm-fat-incr', 0.15),
    ('l-hand-fingers-diameter-incr', 0.20), ('r-hand-fingers-diameter-incr', 0.20),
)

AMBER_IDLE = {
    'seconds': 5.0,
    'loop': True,
    'keys': [
        (0.00, {}),
        (0.11, {'spine04': (2.4, 0.0, 0.5), 'spine03': (1.5, 0.0, -0.4),
                'spine01': (1.1, 0.0, 0.3),
                'clavicle.L': (-1.8, 0.0, 0.0), 'clavicle.R': (-1.5, 0.0, 0.0)}),
        (0.24, {'spine04': (0.5, 0.0, 0.1), 'head': (1.0, 4.6, 1.0),
                'neck02': (0.6, 2.6, 0.6)}),
        (0.38, {'spine04': (2.1, 0.0, -0.4), 'spine03': (1.3, 0.0, 0.3),
                'head': (2.6, 5.6, 1.4), 'neck02': (1.3, 3.1, 0.8),
                'lowerarm01.R': (1.6, 0.0, 0.0), 'wrist.R': (-2.4, 0.0, 2.0)}),
        (0.52, {'spine04': (0.6, 0.0, 0.2), 'head': (1.1, 2.2, 0.6),
                'lowerarm01.R': (2.4, 0.0, 0.4), 'wrist.R': (-3.4, 0.0, 2.6)}),
        (0.66, {'spine04': (1.8, 0.0, -0.2), 'head': (-0.8, -3.6, -0.9),
                'neck02': (-0.4, -2.0, -0.5)}),
        (0.80, {'spine04': (1.9, 0.0, 0.3), 'spine03': (1.2, 0.0, -0.3),
                'clavicle.L': (-1.4, 0.0, 0.0), 'clavicle.R': (-1.2, 0.0, 0.0),
                'head': (-1.2, -5.2, -1.2), 'neck02': (-0.6, -2.8, -0.7)}),
        (0.91, {'spine04': (0.9, 0.0, 0.1), 'head': (-0.3, -1.6, -0.4)}),
        (1.00, {}),
    ],
}

# Ported from export_native_silver.py, where they were measured on this exact rig. A hand
# resting on a surface is nearly flat, so positive X (which lifts the fingertip) is wrong
# for a curl; the thumb's frame is rolled ninety degrees and takes its bend on Z.
RELAXED_FINGER_CURL = (-22.0, -26.0, -14.0)
RELAXED_THUMB_CURL = ((5.0, 0.0, -9.0), (4.0, 0.0, -7.0), (3.0, 0.0, -4.0))
RELAXED_WRIST = (6.0, 0.0, 7.0)

TILE_W, TILE_H = 640, 820


def fail(message):
    raise SystemExit('FAIL: ' + message)


def asset_path(name):
    path = os.path.join(MPFB_DATA, *ASSETS[name])
    if not os.path.exists(path):
        fail('missing native MPFB asset ' + path)
    return path


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_area(name, location, colour, energy, size, target):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color, data.shape, data.size = energy, colour, 'DISK', size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def principled(material):
    return next(
        (n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


def tint(obj, colour, strength, blend, roughness=None, specular=None):
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        bsdf = principled(material)
        if bsdf is None:
            continue
        base = bsdf.inputs.get('Base Color')
        if base is not None:
            if base.is_linked:
                link = base.links[0]
                source = link.from_socket
                material.node_tree.links.remove(link)
                mix = material.node_tree.nodes.new('ShaderNodeMixRGB')
                mix.blend_type = blend
                mix.inputs['Fac'].default_value = strength
                mix.inputs['Color2'].default_value = (*colour, 1.0)
                material.node_tree.links.new(source, mix.inputs['Color1'])
                material.node_tree.links.new(mix.outputs['Color'], base)
            else:
                base.default_value = (*colour, 1.0)
        for key, value in (('Roughness', roughness), ('Specular IOR Level', specular)):
            if value is None:
                continue
            socket = bsdf.inputs.get(key)
            if socket is None:
                continue
            for link in list(socket.links):
                material.node_tree.links.remove(link)
            socket.default_value = value
        coat = bsdf.inputs.get('Coat Weight')
        if coat is not None:
            coat.default_value = 0.0


def set_material_scalar(obj, key, value):
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        bsdf = principled(material)
        if bsdf is None or key not in bsdf.inputs:
            continue
        socket = bsdf.inputs[key]
        for link in list(socket.links):
            material.node_tree.links.remove(link)
        socket.default_value = value


def bake_rest(armature):
    """Turn the current pose into the rest pose. Meshes are only carried once, later."""
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def rotate_pose_bone(bone, rotation):
    head = bone.matrix.translation.copy()
    matrix = bone.matrix.copy()
    matrix.translation = Vector((0.0, 0.0, 0.0))
    matrix = rotation @ matrix
    matrix.translation = head
    bone.matrix = matrix
    bpy.context.view_layer.update()


def palm_frame(armature, side):
    joints = {}
    for finger in range(2, 6):
        bones = [armature.pose.bones.get('finger%d-%d.%s' % (finger, joint, side))
                 for joint in (1, 2, 3)]
        if any(bone is None for bone in bones):
            fail('finger%d is incomplete on side %s, so the hand frame cannot be measured'
                 % (finger, side))
        joints[finger] = bones
    base, middle, tip = joints[3]
    forward = tip.matrix.translation - base.matrix.translation
    across = joints[5][0].matrix.translation - joints[2][0].matrix.translation
    if forward.length < 1e-5 or across.length < 1e-5:
        fail('degenerate hand frame on side ' + side)
    normal = forward.normalized().cross(across.normalized())
    if normal.length < 1e-5:
        fail('the knuckles and the middle finger are colinear on side ' + side)
    normal.normalize()
    first = (middle.matrix.translation - base.matrix.translation).normalized()
    second = (tip.matrix.translation - middle.matrix.translation).normalized()
    bend = second - first
    if bend.length < 1e-4:
        fail('the fingers on side %s are straight, so the palm side cannot be measured'
             % side)
    if normal.dot(bend) < 0.0:
        normal = -normal
    return joints, forward.normalized(), normal


def relax_hands(armature):
    touched = 0
    for side in ('L', 'R'):
        sign = 1.0 if side == 'L' else -1.0
        wrist = armature.pose.bones.get('wrist.' + side)
        if wrist is not None:
            wrist.rotation_mode = 'XYZ'
            wrist.rotation_euler = (
                math.radians(RELAXED_WRIST[0]),
                math.radians(RELAXED_WRIST[1]),
                math.radians(sign * RELAXED_WRIST[2]),
            )
            touched += 1
        for joint, angles in enumerate(RELAXED_THUMB_CURL, start=1):
            bone = armature.pose.bones.get('finger1-%d.%s' % (joint, side))
            if bone is None:
                continue
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = (
                math.radians(angles[0]),
                math.radians(angles[1]),
                math.radians(sign * angles[2]),
            )
            touched += 1
        for finger in range(2, 6):
            for joint, degrees in enumerate(RELAXED_FINGER_CURL, start=1):
                bone = armature.pose.bones.get('finger%d-%d.%s' % (finger, joint, side))
                if bone is None:
                    continue
                bone.rotation_mode = 'XYZ'
                bone.rotation_euler = (math.radians(degrees), 0.0, 0.0)
                touched += 1
    if touched < 20:
        fail('relaxed only %d finger joints' % touched)
    bpy.context.view_layer.update()
    close_finger_splay(armature)
    print('HANDS relaxed joints=%d' % touched)


def close_finger_splay(armature, factor=0.72):
    closed = []
    for side in ('L', 'R'):
        joints, forward, normal = palm_frame(armature, side)

        def in_plane(vector):
            flattened = vector - normal * vector.dot(normal)
            return flattened.normalized() if flattened.length > 1e-6 else None

        reference = in_plane(forward)
        for finger, bones in joints.items():
            if finger == 3 or reference is None:
                continue
            base, _, tip = bones
            direction = in_plane(tip.matrix.translation - base.matrix.translation)
            if direction is None:
                continue
            angle = direction.angle(reference)
            if direction.cross(reference).dot(normal) < 0.0:
                angle = -angle
            closed.append((side, finger, math.degrees(angle)))
            rotate_pose_bone(base, Matrix.Rotation(angle * factor, 4, normal))
    spread = max(abs(angle) for _, _, angle in closed)
    print('SPLAY closed %d fingers, widest was %.1f degrees' % (len(closed), spread))


def retarget_arm(armature, side, bone_name, target_world, pole_world, chain_count):
    target = bpy.data.objects.new('amber_wrist_target.' + side, None)
    pole = bpy.data.objects.new('amber_elbow_pole.' + side, None)
    bpy.context.scene.collection.objects.link(target)
    bpy.context.scene.collection.objects.link(pole)
    target.location = target_world
    pole.location = pole_world
    bone = armature.pose.bones[bone_name]
    constraint = bone.constraints.new('IK')
    constraint.target = target
    constraint.pole_target = pole
    constraint.chain_count = chain_count
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    landed = bone.tail.copy()
    error = (landed - target_world).length
    print('IK %s %s landed_error=%.4f tail=%s' % (
        side, bone_name, error, [round(v, 3) for v in landed]))
    if error > 0.02:
        fail('the %s hand IK landed %.4f from its rail target' % (side, error))
    bpy.ops.object.mode_set(mode='OBJECT')
    bone.constraints.remove(constraint)
    bpy.data.objects.remove(target, do_unlink=True)
    bpy.data.objects.remove(pole, do_unlink=True)


def signed_angle(first, second, axis):
    angle = first.angle(second)
    if first.cross(second).dot(axis) < 0.0:
        angle = -angle
    return angle


def settle_hand(armature, side, direction):
    """Aim the hand along the rail and roll the palm down around that aim.

    The IK places the wrist joint; this then rotates the wrist bone about its own head,
    which is the joint the IK placed, so the aim cannot drag the wrist off the rail. The
    pronation is a roll about the aim axis, because the minimal rotation that
    export_native_silver's level_palm used bent the hand back at the wrist to force the
    palm normal down while the fingers kept pointing wherever the IK left them.
    """
    wrist = armature.pose.bones['wrist.' + side]
    direction = direction.normalized()
    for _ in range(2):
        _, forward, _ = palm_frame(armature, side)
        rotate_pose_bone(wrist, forward.rotation_difference(direction).to_matrix().to_4x4())
    _, forward, normal = palm_frame(armature, side)
    down = Vector((0.0, 0.0, -1.0))
    rotate_pose_bone(
        wrist, Matrix.Rotation(signed_angle(normal, down, direction), 4, direction))
    joints, forward, normal = palm_frame(armature, side)
    joint = joints[3][2].matrix.translation
    print('HAND %s aim=%.1fdeg palm=(%+.2f,%+.2f,%+.2f) fingertip_z=%.3f'
          % (side, math.degrees(forward.angle(direction)), normal.x, normal.y, normal.z,
             joint.z))
    if forward.dot(direction) < 0.96:
        fail('the %s hand is not aimed at the rail' % side)
    if normal.z > -0.80:
        fail('the %s palm is not down on the rail' % side)


def carry_meshes(armature, meshes, before):
    """Linear blend skinning of the rest-pose change, applied to the mesh data once."""
    after = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    transforms = {
        name: np.array((after[name] @ before[name].inverted()))
        for name in before if name in after
    }
    moved = {}
    for obj in meshes:
        slot_names = {group.index: group.name for group in obj.vertex_groups}
        frame = np.array(obj.matrix_world)
        for vertex in obj.data.vertices:
            blended = np.zeros((4, 4))
            weight_sum = 0.0
            for group in vertex.groups:
                weight = group.weight
                matrix = transforms.get(slot_names.get(group.group))
                if matrix is None or weight <= 0.0:
                    continue
                blended += weight * matrix
                weight_sum += weight
            if weight_sum <= 0.0:
                continue
            blended /= weight_sum
            point = np.array([*vertex.co, 1.0])
            vertex.co = Vector(blended @ point)[:3]
        obj.data.update()
        moved[obj.name] = len(obj.data.vertices)
    print('CARRY %s' % json.dumps(moved, sort_keys=True))


def capture_rest(armature):
    return {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}


def build_character():
    from bl_ext.blender_org.mpfb.services import HumanService, TargetService

    macros = TargetService.get_default_macro_info_dict()
    macros.update(MACROS)
    macros['race'].update(RACE)

    human = HumanService.create_human(
        mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
        feet_on_ground=True, scale=0.1, macro_detail_dict=macros)
    human.name = 'river_native_amber_body'
    human.data.name = 'river_native_amber_body_mesh'

    missing = []
    for target_name, weight in AMBER_MALE_IDENTITY:
        target = TargetService.target_full_path(target_name)
        if target is None:
            missing.append(target_name)
            continue
        TargetService.load_target(human, target, weight=weight, name=target_name)
    if missing:
        fail('missing identity targets: ' + ', '.join(missing))
    print('IDENTITY targets=%d recipe=amber_established_gentleman_v1'
          % len(AMBER_MALE_IDENTITY))

    bpy.ops.object.select_all(action='DESELECT')
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    HumanService.add_builtin_rig(human, 'default_no_toes', import_weights=True)
    HumanService.set_character_skin(
        asset_path('skin'), human, bodyproxy=None,
        skin_type='MAKESKIN', material_instances=True)

    attached = {}
    for name, kind in (('eyes', 'eyes'), ('eyelashes', 'eyelashes'),
                       ('eyebrows', 'eyebrows'), ('hair', 'hair'),
                       ('suit', 'Clothes'), ('shoes', 'Clothes')):
        obj = HumanService.add_mhclo_asset(
            asset_path(name), human, asset_type=kind, subdiv_levels=1,
            material_type='MAKESKIN', set_up_rigging=True, interpolate_weights=True,
            import_weights=True)
        obj.name = 'river_amber_' + name
        attached[name] = obj

    for obj in [human, *attached.values()]:
        if obj.type != 'MESH':
            continue
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

    human['riverProof'] = 'native_amber_v1'
    human['sourceLicense'] = 'CC0'
    human['identityRecipe'] = 'amber_established_gentleman_v1'
    return human, attached


HELPER_TOKENS = ('HelperGeometry', 'JointCubes')


def apply_shape_keys(meshes):
    """Bake the MPFB identity into the mesh before anything is posed.

    MPFB keeps the identity recipe and the macro sliders as shape keys. They are deltas
    authored against the standing base; the seated carry moves base vertices only, so
    leaving them live put the body in a different space from every mhclo asset and
    stretched it to 1.80m with the suit down at the chest. Applying the mix first makes
    the mesh data the true standing figure, and the carry then moves this body.
    """
    for obj in meshes:
        if obj.type != 'MESH' or obj.data.shape_keys is None:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        print('SHAPEKEYS applied %s remaining=%s' % (
            obj.name, obj.data.shape_keys is not None))


def remove_helpers(body):
    """Delete MPFB's helper and joint-cube geometry, which the shipped masks do not.

    Their group names are the only reliable handle: HelperGeometry, JointCubes, Mid and
    the helper-*/joint-* groups are all separate shells from the body/scalp/ears material
    groups that make the visible skin.
    """
    helper_groups = {
        group.index for group in body.vertex_groups
        if group.name in HELPER_TOKENS or group.name.startswith(('helper-', 'joint-'))}
    doomed = set()
    for vertex in body.data.vertices:
        if any(group.group in helper_groups and group.weight > 0.5
               for group in vertex.groups):
            doomed.add(vertex.index)
    if not doomed:
        fail('helper deletion found no helper vertices')
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[index] for index in sorted(doomed)],
                     context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    for modifier in list(body.modifiers):
        if modifier.type == 'MASK' and modifier.name == 'Hide helpers':
            body.modifiers.remove(modifier)
    print('HELPERS removed=%d remaining=%d' % (len(doomed), len(body.data.vertices)))


def conform_hair(body, hair):
    """Lift any hair vertex that the morphed head has grown through.

    The stock hairstyle is fitted to the stock head; Amber's identity targets stretched
    the forehead and hollowed the temples far enough that the hair cap passes through the
    face, which rendered as black slashes across the brow. Any hair vertex inside the
    seated body surface is moved just outside it, measured against the body itself.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    fixed = 0
    for vertex in hair.data.vertices:
        hit, location, normal, _ = evaluated.closest_point_on_mesh(vertex.co)
        if not hit:
            continue
        signed = (vertex.co - location).dot(normal)
        if signed < 0.002:
            vertex.co = location + normal * 0.004
            fixed += 1
    hair.data.update()
    print('HAIR_CONFORM fixed=%d of %d' % (fixed, len(hair.data.vertices)))


def relax_creased(obj, before_positions, threshold=0.05, factor=0.35, rounds=2):
    """Soften the shoulder and armpit where the arm carry pulled vertices hard.

    Pulling a vertex toward the average of its less-moved neighbours is the cheap form of
    export_native_silver's relax_skinning: the crease is a place where linear blend
    skinning lost volume, and there is nothing else to push it against.
    """
    mesh = obj.data
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        first, second = edge.vertices
        adjacency[first].append(second)
        adjacency[second].append(first)
    moved = [index for index, vertex in enumerate(mesh.vertices)
             if (vertex.co - before_positions[index]).length > threshold]
    moved_set = set(moved)
    for _ in range(rounds):
        updates = {}
        for index in moved:
            neighbours = [neighbour for neighbour in adjacency[index]
                          if neighbour not in moved_set] or adjacency[index]
            if not neighbours:
                continue
            average = Vector((0.0, 0.0, 0.0))
            for neighbour in neighbours:
                average += mesh.vertices[neighbour].co
            average /= len(neighbours)
            updates[index] = mesh.vertices[index].co.lerp(average, factor)
        for index, position in updates.items():
            mesh.vertices[index].co = position
    mesh.update()
    print('RELAX %s moved=%d threshold=%.3f' % (obj.name, len(moved), threshold))


def seat_on_floor(armature, meshes):
    """Drop the folded figure until the soles are on the local floor.

    Folding the legs rotates them about the hip and leaves the pelvis at standing height,
    so the figure hovers by roughly the seat height. The shift is measured - lowest shoe
    sole goes to z=0 - and the same shift moves the edit bones, or the skinning
    desynchronises from the mesh it deforms. The pelvis is also centred over the origin,
    because the venue parents the character on the seat position.
    """
    sys.path.insert(0, HERE)
    os.environ.setdefault('RIVER_OUT', os.path.join(ROOT, 'out'))
    import build_assets

    shoes = [obj for obj in meshes if 'shoes' in obj.name]
    soles = min((obj.matrix_world @ vertex.co).z
                for obj in (shoes if shoes else meshes) for vertex in obj.data.vertices)
    for name in ('upperleg01.L', 'upperleg02.L', 'lowerleg01.L', 'lowerleg02.L',
                 'foot.L', 'toe1-1.L'):
        bone = armature.data.bones[name]
        print('SEAT bone %-12s head=%s tail=%s' % (
            name, [round(v, 3) for v in bone.head_local],
            [round(v, 3) for v in bone.tail_local]))
    for obj in meshes:
        low = min((obj.matrix_world @ vertex.co).z for vertex in obj.data.vertices)
        print('SEAT mesh %-28s lowest=%+.3f' % (obj.name, low))
    rear_min = None
    strong_min = None
    all_pelvis_min = None
    rear_y = None
    for obj in meshes:
        names = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            pelvis_weight = 0.0
            for group in vertex.groups:
                if names.get(group.group) in ('pelvis.L', 'pelvis.R', 'spine05'):
                    pelvis_weight += group.weight
            if pelvis_weight <= 0.4:
                continue
            point = obj.matrix_world @ vertex.co
            all_pelvis_min = point.z if all_pelvis_min is None \
                else min(all_pelvis_min, point.z)
            if pelvis_weight >= 0.6 and point.y > 0.02:
                rear_min = point.z if rear_min is None else min(rear_min, point.z)
                rear_y = point.y if rear_y is None else max(rear_y, point.y)
            if pelvis_weight >= 0.8:
                strong_min = point.z if strong_min is None else min(strong_min, point.z)
    print('SEAT candidates all_pelvis=%s rear=%s strong=%s'
          % ('none' if all_pelvis_min is None else '%.3f' % all_pelvis_min,
             'none' if rear_min is None else '%.3f' % rear_min,
             'none' if strong_min is None else '%.3f' % strong_min))
    buttocks = rear_min if rear_min is not None else all_pelvis_min
    pelvis = armature.data.bones['spine05'].head_local.copy()
    seat_local = (build_assets.SEAT_H - build_assets.CHARACTER_SEAT_Z) \
        / build_assets.CHARACTER_SCALE
    gap = 0.0 if buttocks is None else max(0.0, (buttocks - soles) - seat_local)
    shift = Vector((-pelvis.x, -pelvis.y, -soles - gap))
    print('SEAT soles=%.3f buttocks=%s shift=(%+.3f,%+.3f,%+.3f) seat_pan_at=%.3f'
          % (soles, 'none' if buttocks is None else '%.3f' % buttocks,
             shift.x, shift.y, shift.z, seat_local))
    if buttocks is not None:
        print('SEAT gap_above_pan=%+.3f (positive means hovering)'
              % ((buttocks - soles) - seat_local))
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertex.co += shift
        obj.data.update()
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in armature.data.edit_bones:
        bone.head += shift
        bone.tail += shift
    bpy.ops.object.mode_set(mode='OBJECT')
    return {
        'buttocks': None if buttocks is None else buttocks + shift.z,
        'rear_y': rear_y,
        'gap': gap,
    }


def seated_bake(armature, meshes):
    """Bake the shared seated rest, settle it on the floor, then author both arms."""
    sys.path.insert(0, HERE)
    os.environ.setdefault('RIVER_OUT', os.path.join(ROOT, 'out'))
    import build_assets

    before = capture_rest(armature)
    build_assets.apply_seated_rest_pose(armature, pose_arms=False)
    carry_meshes(armature, meshes, before)
    seat = seat_on_floor(armature, meshes)

    reach, rail_height = build_assets.seated_rail_contact()
    print('SEATED reach=%.4f rail_height=%.4f' % (reach, rail_height))
    before_arms = capture_rest(armature)
    arm_snapshots = {obj.name: [vertex.co.copy() for vertex in obj.data.vertices]
                     for obj in meshes}
    for side in ('L', 'R'):
        sign = 1.0 if side == 'L' else -1.0
        if side == 'R':
            # The supported left arm keeps the shared rail contact. The right hand is
            # pulled back along the rail and lifted a hair, so the forearm is steeper,
            # unweighted and free to bet.
            target = Vector((-0.105, -(reach - 0.105), rail_height + 0.022))
            pole = Vector((-0.40, -reach * 0.30, rail_height + 0.14))
            aim = Vector((-0.08, -1.0, -0.20))
        else:
            target = Vector((sign * 0.10, -(reach - 0.030), rail_height + 0.020))
            pole = Vector((sign * 0.42, -reach * 0.34, rail_height + 0.16))
            aim = Vector((0.02, -1.0, -0.20))
        retarget_arm(armature, side, 'lowerarm02.' + side, target, pole, 4)
    relax_hands(armature)
    for side in ('L', 'R'):
        settle_hand(
            armature, side,
            Vector((-0.08, -1.0, -0.20)) if side == 'R' else Vector((0.02, -1.0, -0.20)))
    bake_rest(armature)
    carry_meshes(armature, meshes, before_arms)
    for obj in meshes:
        if 'suit' in obj.name or 'body' in obj.name:
            relax_creased(obj, arm_snapshots[obj.name])

    report = {}
    for side in ('L', 'R'):
        wrist = armature.pose.bones['wrist.' + side]
        tip = armature.pose.bones['finger3-3.' + side]
        report[side] = {
            'wrist': [round(v, 4) for v in wrist.head],
            'fingertip': [round(v, 4) for v in tip.tail],
        }
        if tip.tail.z < 0.837 - 0.012 and -0.371 < tip.tail.y < -0.181 \
                and abs(tip.tail.x) < 0.425:
            fail('the %s hand reaches %.3f below the rail top' % (side, tip.tail.z))
    print('HAND_CONTACT %s' % json.dumps(report, sort_keys=True))
    return seat


def uv_islands(mesh):
    """Faces connected across a shared edge whose UVs agree on both of its ends."""
    parent = list(range(len(mesh.polygons)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first, second):
        first, second = find(first), find(second)
        if first != second:
            parent[first] = second

    uv_data = mesh.uv_layers.active.data
    edge_faces = {}
    for polygon in mesh.polygons:
        uv_of = {}
        for loop_index in polygon.loop_indices:
            uv_of[mesh.loops[loop_index].vertex_index] = uv_data[loop_index].uv.copy()
        for key in polygon.edge_keys:
            edge_faces.setdefault(key, []).append((polygon.index, uv_of))
    for key, entries in edge_faces.items():
        if len(entries) < 2:
            continue
        v0, v1 = key
        first_face, first_uv = entries[0]
        for other_face, other_uv in entries[1:]:
            if (first_uv.get(v0, Vector((0, 0))) - other_uv.get(v0, Vector((0, 0)))).length < 1e-4 \
                    and (first_uv.get(v1, Vector((0, 0))) - other_uv.get(v1, Vector((0, 0)))).length < 1e-4:
                union(first_face, other_face)
    islands = {}
    for polygon in mesh.polygons:
        islands.setdefault(find(polygon.index), []).append(polygon.index)
    return list(islands.values())


def delete_suit_faces(obj, image):
    """Remove the shirt and tie UV islands whole.

    Sampling the atlas at each face's UVs and deleting everything bright cut circular
    holes out of the jacket, because the jacket's own highlights sample above the shirt's
    shaded folds. The unit of decision is the UV island: an island is either the shirt,
    the tie or a piece of the jacket, and the three have clearly separated means.
    """
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    mesh = obj.data
    uv_data = mesh.uv_layers.active.data
    face_rgb = {}
    for polygon in mesh.polygons:
        samples = []
        for loop in polygon.loop_indices:
            uv = uv_data[loop].uv
            x = min(width - 1, max(0, int(round(uv.x * (width - 1)))))
            y = min(height - 1, max(0, int(round(uv.y * (height - 1)))))
            samples.append(pixels[y, x, :3])
        face_rgb[polygon.index] = np.mean(samples, axis=0)
    removed = set()
    stats = []
    for island in uv_islands(mesh):
        rgb = np.mean([face_rgb[index] for index in island], axis=0)
        luminance = float(rgb.mean())
        chromatic = float(rgb[2] - rgb[0])
        shirt = luminance > 0.35
        tie = chromatic > 0.03
        stats.append((len(island), luminance, chromatic, shirt, tie))
        if shirt or tie:
            removed.update(island)
    for entry in sorted(stats, reverse=True)[:8]:
        print('SUIT island faces=%d lum=%.3f chroma=%+.3f %s'
              % (entry[0], entry[1], entry[2],
                 'REMOVED' if (entry[3] or entry[4]) else 'kept'))
    print('SUIT faces=%d removed=%d remaining=%d'
          % (len(mesh.polygons), len(removed), len(mesh.polygons) - len(removed)))
    if not 100 <= len(removed) <= 3500:
        fail('shirt/tie removal found %d faces' % len(removed))
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in sorted(removed)], context='FACES')
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return pixels


def dominant_bone(obj, polygon):
    weights = {}
    for vertex_index in polygon.vertices:
        for group in obj.data.vertices[vertex_index].groups:
            name = obj.vertex_groups[group.group].name
            weights[name] = weights.get(name, 0.0) + group.weight
    return max(weights, key=weights.get) if weights else ''


TROUSER_MARKERS = ('upperleg', 'lowerleg', 'foot', 'toe')


def bake_suit_maps(obj, pixels):
    """Bottle-green velvet above the waist, black trousers below, in one atlas."""
    height, width = pixels.shape[0], pixels.shape[1]
    region = np.zeros((height, width), dtype=np.uint8)
    uv_layer = obj.data.uv_layers.active.data
    for polygon in obj.data.polygons:
        frame = [uv_layer[loop].uv for loop in polygon.loop_indices]
        us = [uv.x * (width - 1) for uv in frame]
        vs = [uv.y * (height - 1) for uv in frame]
        x0, x1 = int(min(us)), int(max(us)) + 1
        y0, y1 = int(min(vs)), int(max(vs)) + 1
        if x1 <= x0 or y1 <= y0:
            continue
        target = 1 if any(
            marker in dominant_bone(obj, polygon) for marker in TROUSER_MARKERS) else 0
        for y in range(max(0, y0), min(height, y1)):
            for x in range(max(0, x0), min(width, x1)):
                px, py = x + 0.5, y + 0.5
                inside = False
                count = len(frame)
                for i in range(count):
                    ax, ay = us[i], vs[i]
                    bx, by = us[(i + 1) % count], vs[(i + 1) % count]
                    cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
                    if cross < 0:
                        inside = False
                        break
                    inside = True
                if inside:
                    region[y, x] = target
    luminance = pixels[:, :, :3].mean(axis=2)
    factor = np.clip(0.45 + 1.15 * luminance, 0.25, 1.6)[:, :, None]
    palette = np.array(((0.075, 0.200, 0.115), (0.028, 0.028, 0.032)))
    out = palette[region] * factor
    covered = region.copy()
    covered[:] = 0
    for polygon in obj.data.polygons:
        frame = [uv_layer[loop].uv for loop in polygon.loop_indices]
        us = [uv.x * (width - 1) for uv in frame]
        vs = [uv.y * (height - 1) for uv in frame]
        covered[int(min(vs)):int(max(vs)) + 1, int(min(us)):int(max(us)) + 1] = 1
    out[covered == 0] = np.array((0.030, 0.062, 0.040))
    for region_id, label in ((0, 'jacket'), (1, 'trousers')):
        mask = region == region_id
        if mask.any():
            mean = out[mask].mean(axis=0)
            print('SUIT atlas %s px=%d mean=(%.3f,%.3f,%.3f)'
                  % (label, int(mask.sum()), *mean))
    alpha = np.ones((height, width, 1), dtype=np.float32)
    diffuse = np.concatenate([out.astype(np.float32), pixels[:, :, 3:4]], axis=2)
    diffuse[:, :, 3] = 1.0
    image = bpy.data.images.new('river_amber_suit_diffuse', width, height, alpha=True)
    image.pixels.foreach_set(diffuse.ravel())
    image.filepath_raw = os.path.join(OUT, 'native-amber-suit-diffuse.png')
    image.file_format = 'PNG'
    image.save()

    rough = np.where(region == 1, 0.80, 0.52).astype(np.float32)
    rough_stack = np.stack([rough, rough, rough, np.ones_like(rough)], axis=2)
    rough_image = bpy.data.images.new('river_amber_suit_roughness', width, height, alpha=True)
    rough_image.colorspace_settings.name = 'Non-Color'
    rough_image.pixels.foreach_set(rough_stack.ravel())
    rough_image.filepath_raw = os.path.join(OUT, 'native-amber-suit-roughness.png')
    rough_image.file_format = 'PNG'
    rough_image.save()
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image is not None:
                name = node.image.name.lower()
                if 'diffuse' in name:
                    node.image = image
                elif 'rough' in name:
                    node.image = rough_image
        bsdf = principled(material)
        if bsdf is not None and 'Roughness' in bsdf.inputs \
                and not bsdf.inputs['Roughness'].is_linked:
            bsdf.inputs['Roughness'].default_value = 0.60
        sheen = bsdf.inputs.get('Sheen Weight') if bsdf is not None else None
        if sheen is not None:
            sheen.default_value = 0.28
    print('SUIT_MAPS diffuse=%s' % os.path.basename(image.filepath_raw))
    return image, rough_image


def bake_hair_texture(obj):
    source_path = os.path.join(MPFB_DATA, 'hair', ASSETS['hair'][1],
                              ASSETS['hair'][1] + '_diffuse.png')
    source = bpy.data.images.load(source_path)
    width, height = source.size
    pixels = np.array(source.pixels[:], dtype=np.float32).reshape(height, width, 4)
    if pixels.shape[2] == 3:
        pixels = np.concatenate(
            [pixels, np.ones((height, width, 1), dtype=np.float32)], axis=2)
    luminance = np.clip((pixels[:, :, :3].mean(axis=2) - 0.04) / 0.42, 0.0, 1.0)
    dark = np.array((0.085, 0.078, 0.070), dtype=np.float32)
    light = np.array((0.760, 0.740, 0.700), dtype=np.float32)
    out = dark + luminance[:, :, None] * (light - dark)
    out = np.concatenate([out, pixels[:, :, 3:4]], axis=2)
    image = bpy.data.images.new('river_amber_hair_diffuse', width, height, alpha=True)
    image.pixels.foreach_set(out.ravel())
    image.filepath_raw = os.path.join(OUT, 'native-amber-hair-diffuse.png')
    image.file_format = 'PNG'
    image.save()
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image is not None \
                    and 'diffuse' in node.image.name.lower():
                node.image = image
    set_material_scalar(obj, 'Roughness', 0.40)
    set_material_scalar(obj, 'Specular IOR Level', 0.20)
    print('HAIR_MAP %s' % os.path.basename(image.filepath_raw))
    return image


def build_rollneck(body, armature):
    """A black roll-neck derived from Amber's own neck and upper chest skin.

    The patch is cut from the body surface after the seated carry, offset along its own
    normals, and the top ring is extruded into a folded collar. Because it is the body's
    own surface it cannot float, and it carries the body's weights so it cannot detach.
    """
    neck_base = armature.data.bones['neck01'].head_local.copy()
    head = armature.data.bones['head'].head_local.copy()
    axis = (head - neck_base).normalized()
    collar_top = neck_base + axis * ((head - neck_base).length * 0.62)
    chest_low = neck_base.z - 0.20

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()

    def to_axis(point):
        offset = point - neck_base
        return (offset - axis * offset.dot(axis)).length

    keep = []
    for face in bm.faces:
        centre = face.calc_center_median()
        radius = to_axis(centre)
        along = (centre - neck_base).dot(axis)
        neck = 0.0 <= along <= (collar_top - neck_base).length + 0.015 and radius < 0.115
        chest = (chest_low <= centre.z <= neck_base.z + 0.03
                 and centre.y < -0.02 and centre.y > -0.16 and abs(centre.x) < 0.17)
        if neck or chest:
            keep.append(face)
    if len(keep) < 200:
        fail('roll-neck region selected only %d faces' % len(keep))
    keep_set = set(keep)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep_set], context='FACES')
    bm.normal_update()
    for vertex in bm.verts:
        vertex.co += vertex.normal * 0.009

    def boundary_ring(min_z):
        edges = [edge for edge in bm.edges if edge.is_boundary]
        kept = []
        for edge in edges:
            middle = (edge.verts[0].co + edge.verts[1].co) * 0.5
            if middle.z >= min_z and to_axis(middle) < 0.14:
                kept.append(edge)
        return kept

    top_edges = boundary_ring(collar_top.z - 0.02)
    if len(top_edges) < 20:
        fail('roll-neck collar ring has %d edges' % len(top_edges))

    def grow(edges, up, out):
        result = bmesh.ops.extrude_edge_only(bm, edges=edges)
        verts = [element for element in result['geom']
                 if isinstance(element, bmesh.types.BMVert)]
        for vertex in verts:
            offset = vertex.co - neck_base
            radial = offset - axis * offset.dot(axis)
            outward = radial.normalized() if radial.length > 1e-6 else Vector((0, 0, 0))
            vertex.co += axis * up + outward * out
        bm.normal_update()
        return verts

    grow(top_edges, 0.030, 0.007)
    ring = boundary_ring(collar_top.z + 0.020)
    grow(ring, 0.014, -0.008)
    ring = boundary_ring(collar_top.z + 0.030)
    grow(ring, -0.012, -0.002)

    mesh = bpy.data.meshes.new('river_amber_rollneck_mesh')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('river_amber_rollneck', mesh)
    bpy.context.scene.collection.objects.link(obj)
    for group in body.vertex_groups:
        obj.vertex_groups.new(name=group.name)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    decimate = obj.modifiers.new('Decimate', 'DECIMATE')
    decimate.ratio = 0.38
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    mesh = obj.data
    modifier = obj.modifiers.new('Armature', 'ARMATURE')
    modifier.object = armature
    obj.parent = armature
    material = bpy.data.materials.new('river_amber_rollneck_material')
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.013, 0.013, 0.015, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.68
    sheen = bsdf.inputs.get('Sheen Weight')
    if sheen is not None:
        sheen.default_value = 0.22
    mesh.materials.append(material)
    mesh.calc_loop_triangles()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    print('ROLLNECK verts=%d tris=%d groups=%d' % (
        len(mesh.vertices), len(mesh.loop_triangles), len(obj.vertex_groups)))
    return obj


def add_guides(seat=None):
    """Proxy table at the scale measured from the a26 poker-rest candidate.

    a26's A21 guides: felt top z=0.791956, rail top z=0.836957 at y in
    [-0.371183, -0.181183], chair back y in [0.2125, 0.2475]. The chair pan then drops to
    wherever the settled figure's own backside is, so the proxy cannot intersect him.
    """
    def box(name, x0, x1, y0, y1, z0, z1, colour, roughness=0.6):
        mesh = bpy.data.meshes.new(name + '_mesh')
        verts = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        faces = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4),
                 (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        material = bpy.data.materials.new(name + '_material')
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
        bsdf.inputs['Roughness'].default_value = roughness
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    add = box  # short alias for the table below
    pan_top = 0.445652
    back_y0, back_y1 = 0.2125, 0.2475
    if seat and seat.get('buttocks') is not None:
        pan_top = seat['buttocks'] - 0.004
        if seat.get('rear_y') is not None:
            back_y0 = max(back_y0, seat['rear_y'] + 0.015)
            back_y1 = back_y0 + 0.035
    print('GUIDES pan_top=%.3f back_y=(%.3f,%.3f)' % (pan_top, back_y0, back_y1))
    return [
        add('amber_guide_felt', -0.55, 0.55, -1.001183, -0.371183,
            0.751957, 0.791956, (0.055, 0.16, 0.145), 0.85),
        add('amber_guide_rail', -0.425, 0.425, -0.371183, -0.181183,
            0.786957, 0.836957, (0.240, 0.200, 0.150), 0.65),
        add('amber_guide_chair_pan', -0.26, 0.26, -0.23, 0.23,
            pan_top - 0.05, pan_top, (0.022, 0.022, 0.024), 0.55),
        add('amber_guide_chair_back', -0.26, 0.26, back_y0, back_y1,
            pan_top, pan_top + 0.42, (0.022, 0.022, 0.024), 0.55),
        add('amber_guide_floor', -1.0, 1.0, -1.0, 1.0,
            -0.075, -0.055, (0.015, 0.015, 0.017), 0.8),
    ]


def apply_materials(human, attached, rollneck):
    suit_diffuse = bpy.data.images.load(
        os.path.join(MPFB_DATA, 'clothes', 'male_elegantsuit01',
                     'male_elegantsuit01_diffuse.png'))
    pixels = delete_suit_faces(attached['suit'], suit_diffuse)
    bake_suit_maps(attached['suit'], pixels)
    bake_hair_texture(attached['hair'])
    tint(attached['eyebrows'], (0.55, 0.53, 0.50), 0.72, 'MIX', 0.66, 0.10)
    tint(attached['shoes'], (0.030, 0.026, 0.022), 0.92, 'MULTIPLY', 0.34, 0.45)
    print('MATERIALS meshes=%d' % len([human, *attached.values(), rollneck]))


def limit_influences(meshes, bone_names):
    """Keep the four heaviest bone influences per vertex and renormalise them."""
    worst = 0
    unweighted = 0
    for obj in meshes:
        index_to_name = {group.index: group.name for group in obj.vertex_groups}
        bone_indices = {index for index, name in index_to_name.items()
                        if name in bone_names}
        for vertex in obj.data.vertices:
            weights = [(group.group, group.weight) for group in vertex.groups
                       if group.group in bone_indices and group.weight > 0.0]
            if not weights:
                unweighted += 1
                continue
            if len(weights) > 4:
                weights.sort(key=lambda item: item[1], reverse=True)
                for index, _ in weights[4:]:
                    obj.vertex_groups[index].remove([vertex.index])
                weights = weights[:4]
            total = sum(weight for _, weight in weights)
            if total <= 0.0:
                continue
            for index, weight in weights:
                obj.vertex_groups[index].add([vertex.index], weight / total, 'REPLACE')
            worst = max(worst, len(weights))
    print('INFLUENCES max=%d unweighted=%d' % (worst, unweighted))
    if worst > 4:
        fail('a vertex carries %d influences after limiting' % worst)
    if unweighted:
        fail('%d vertices carry no bone influence' % unweighted)


def author_actions(armature):
    sys.path.insert(0, HERE)
    os.environ.setdefault('RIVER_OUT', os.path.join(ROOT, 'out'))
    import build_silver_animation as motion

    actions = [motion.author_clip(armature, 'IDLE_breathe', AMBER_IDLE)]
    for name, spec in motion.CLIPS.items():
        if name == 'IDLE_breathe':
            continue
        actions.append(motion.author_clip(armature, name, spec))
    armature.animation_data_create().action = None
    motion.reset_pose(armature)
    for action in actions:
        action.use_fake_user = True
    names = sorted(action.name for action in actions)
    print('ACTIONS %s' % ','.join(names))
    if tuple(names) != tuple(sorted(EXPECTED_CLIPS)):
        fail('action set does not match the nine-clip contract: ' + ','.join(names))
    return actions


def add_lights_and_camera():
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('native_amber_world')
    scene.world.color = (0.018, 0.019, 0.022)
    target = (0.0, -0.05, 1.12)
    add_area('amber_key', (-1.6, -2.4, 2.7), (1.0, 0.72, 0.50), 720.0, 2.2, target)
    add_area('amber_fill', (1.9, -1.2, 1.8), (0.30, 0.48, 1.0), 260.0, 2.6, target)
    add_area('amber_rim', (0.4, 1.8, 2.6), (0.62, 0.72, 1.0), 420.0, 1.6, target)
    data = bpy.data.cameras.new('amber_camera')
    data.lens = 62.0
    camera = bpy.data.objects.new('amber_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def run_build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    human, attached = build_character()
    armature = bpy.data.objects['river_native_amber_body.rig']
    if len(armature.data.bones) != 137:
        fail('built rig has %d bones' % len(armature.data.bones))
    meshes = [human, *attached.values()]
    apply_shape_keys(meshes)
    seat = seated_bake(armature, meshes)
    remove_helpers(human)
    conform_hair(human, attached['hair'])

    rollneck = build_rollneck(human, armature)
    apply_materials(human, attached, rollneck)
    limit_influences([human, *attached.values(), rollneck],
                     {bone.name for bone in armature.data.bones})

    add_guides(seat)
    add_lights_and_camera()
    author_actions(armature)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    triangles = 0
    for obj in [human, *attached.values(), rollneck]:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    print('BUILD %s meshes=%d base_triangles=%d' % (
        BLEND, 7, triangles))


def read_glb(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF':
        fail('not a GLB: ' + path)
    offset = 12
    chunks = {}
    while offset < length:
        chunk_length, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunks[chunk_type] = data[offset:offset + chunk_length]
        offset += chunk_length
    gltf = json.loads(chunks[0x4E4F534A].decode('utf-8'))
    return gltf, chunks.get(0x004E4942, b'')


COMPONENT_FORMATS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
                     5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}


def accessor_values(gltf, blob, index):
    accessor = gltf['accessors'][index]
    view = gltf['bufferViews'][accessor['bufferView']]
    fmt, size = COMPONENT_FORMATS[accessor['componentType']]
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[
        accessor['type']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride') or size * components
    values = []
    for i in range(accessor['count']):
        values.append(struct.unpack_from(
            '<' + fmt * components, blob, start + i * stride))
    return values


def parse_glb():
    gltf, blob = read_glb(GLB)
    animations = [animation.get('name') for animation in gltf.get('animations', [])]
    skins = gltf.get('skins', [])
    joints = max((len(skin.get('joints', [])) for skin in skins), default=0)
    primitives = 0
    triangles = 0
    skinned = 0
    weight_sums = []
    influence_counts = []
    for mesh in gltf.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            primitives += 1
            attributes = primitive.get('attributes', {})
            if 'JOINTS_0' in attributes and 'WEIGHTS_0' in attributes:
                skinned += 1
                joints_values = accessor_values(gltf, blob, attributes['JOINTS_0'])
                weights_values = accessor_values(gltf, blob, attributes['WEIGHTS_0'])
                for joints_row, weights_row in list(zip(joints_values, weights_values))[:2000]:
                    for weight, joint in zip(weights_row, joints_row):
                        if weight > 0.0 and joint >= joints:
                            fail('GLB joints index %d exceeds %d joints' % (joint, joints))
                    total = sum(weights_row)
                    weight_sums.append(total)
                    influence_counts.append(sum(1 for w in weights_row if w > 0.0))
            if 'indices' in primitive:
                triangles += gltf['accessors'][primitive['indices']]['count'] // 3
            else:
                triangles += gltf['accessors'][attributes['POSITION']]['count'] // 3
    report = {
        'animations': animations,
        'skins': len(skins),
        'joints': joints,
        'primitives': primitives,
        'triangles': triangles,
        'skinned_primitives': skinned,
        'weight_sum_min': min(weight_sums) if weight_sums else None,
        'weight_sum_max': max(weight_sums) if weight_sums else None,
        'max_influences': max(influence_counts) if influence_counts else None,
        'materials': len(gltf.get('materials', [])),
        'images': len(gltf.get('images', [])),
        'file_bytes': os.path.getsize(GLB),
    }
    print('PARSE %s' % json.dumps(report, sort_keys=True))
    if tuple(sorted(animations)) != tuple(sorted(EXPECTED_CLIPS)):
        fail('GLB clip names differ: ' + ','.join(str(name) for name in animations))
    if joints != 137:
        fail('GLB skin carries %d joints' % joints)
    if skinned == 0:
        fail('GLB has no JOINTS_0/WEIGHTS_0 primitives')
    if report['max_influences'] and report['max_influences'] > 4:
        fail('GLB carries %d influences per vertex' % report['max_influences'])
    if weight_sums and (min(weight_sums) < 0.98 or max(weight_sums) > 1.02):
        fail('GLB weights are not renormalised: %.4f..%.4f'
             % (min(weight_sums), max(weight_sums)))
    if triangles > 50000:
        fail('GLB carries %d triangles' % triangles)
    return report


def run_verify():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    armature = bpy.data.objects.get('river_native_amber_body.rig')
    if armature is None:
        fail('the saved blend has no rig')
    bone_names = [bone.name for bone in armature.data.bones]
    if tuple(bone_names) != REQUIRED_BONES:
        missing = [name for name in REQUIRED_BONES if name not in bone_names]
        extra = [name for name in bone_names if name not in REQUIRED_BONES]
        fail('bone set differs: missing=%s extra=%s' % (missing, extra))

    actions = {action.name: action for action in bpy.data.actions}
    if tuple(sorted(actions)) != tuple(sorted(EXPECTED_CLIPS)):
        fail('action set differs: ' + ','.join(sorted(actions)))

    for bone in armature.pose.bones:
        residues = [abs(v) for v in bone.location]
        residues += [abs(v - 1.0) for v in bone.scale]
        if bone.rotation_mode == 'QUATERNION':
            residues += [abs(bone.rotation_quaternion.w - 1.0)]
            residues += [abs(v) for v in bone.rotation_quaternion[1:]]
        else:
            residues += [abs(v) for v in bone.rotation_euler]
        if max(residues) > 1e-5:
            fail('the saved rig carries a residual pose on %s, so a zero pose is not '
                 'the seated character' % bone.name)

    bone_set = set(bone_names)
    worst = 0
    unweighted = 0
    finite = True
    mesh_report = {}
    for name in CHARACTER_MESHES:
        obj = bpy.data.objects.get(name)
        if obj is None:
            fail('missing character mesh ' + name)
        obj.data.calc_loop_triangles()
        groups = {group.index for group in obj.vertex_groups if group.name in bone_set}
        for vertex in obj.data.vertices:
            if not all(math.isfinite(value) for value in vertex.co):
                finite = False
            weights = [g.weight for g in vertex.groups
                       if g.group in groups and g.weight > 0.0]
            worst = max(worst, len(weights))
            if not weights:
                unweighted += 1
        mesh_report[name] = {
            'verts': len(obj.data.vertices),
            'tris': len(obj.data.loop_triangles),
            'materials': [slot.material.name if slot.material else None
                          for slot in obj.material_slots],
        }
    if not finite:
        fail('a character mesh has non-finite vertex coordinates')
    if worst > 4:
        fail('a vertex carries %d influences' % worst)
    if unweighted:
        fail('%d vertices carry no bone influence' % unweighted)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = {}
    for name in CHARACTER_MESHES:
        obj = bpy.data.objects[name]
        eval_obj = obj.evaluated_get(depsgraph)
        mesh = eval_obj.to_mesh()
        mesh.calc_loop_triangles()
        evaluated[name] = len(mesh.loop_triangles)
        eval_obj.to_mesh_clear()
    evaluated_total = sum(evaluated.values())
    if evaluated_total > 50000:
        fail('evaluated triangles %d exceed the 50000 budget' % evaluated_total)

    idle = actions['IDLE_breathe']
    fcurves = list(getattr(idle, 'fcurves', []))
    if not fcurves:
        for layer in idle.layers:
            for strip in layer.strips:
                for bag in getattr(strip, 'channelbags', ()):
                    fcurves.extend(bag.fcurves)
    frame_start, frame_end = idle.frame_range
    loops = True
    for curve in fcurves:
        first = curve.evaluate(frame_start)
        last = curve.evaluate(frame_end)
        if not (math.isfinite(first) and math.isfinite(last)):
            fail('idle curve is not finite: ' + curve.data_path)
        if abs(first - last) > 1e-5:
            loops = False
    if not loops:
        fail('the idle does not close on its first pose')
    for action in actions.values():
        try:
            curves = action.fcurves
        except AttributeError:
            curves = [fc for layer in action.layers for strip in layer.strips
                      for bag in strip.channelbags for fc in bag.fcurves]
        for curve in curves:
            for point in curve.keyframe_points:
                if not math.isfinite(point.co[1]):
                    fail('non-finite keyframe in ' + action.name)

    durations = {name: [round(action.frame_range[0], 2), round(action.frame_range[1], 2)]
                 for name, action in actions.items()}
    material_names = sorted({material for report in mesh_report.values()
                             for material in report['materials'] if material})
    report = {
        'blend': BLEND,
        'blend_bytes': os.path.getsize(BLEND),
        'bones': len(bone_names),
        'actions': durations,
        'idle_loops': loops,
        'max_influences': worst,
        'unweighted_vertices': unweighted,
        'evaluated_triangles': evaluated,
        'evaluated_total': evaluated_total,
        'meshes': mesh_report,
        'materials': material_names,
        'material_count': len(material_names),
        'draw_calls_estimate': sum(
            max(1, len(report['materials'])) for report in mesh_report.values()),
    }
    report['glb'] = export_and_parse(armature)
    with open(REPORT_JSON, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
    print('VERIFY %s' % json.dumps({k: v for k, v in report.items()
                                    if k not in ('meshes', 'glb')}, sort_keys=True))
    return report


def bake_visible_meshes(meshes):
    """Flatten every non-armature modifier into the mesh before export.

    The body ships with mask modifiers that delete the geometry the suit and shoes cover.
    Exporting the modifier stack unapplied shipped 61090 triangles against a measured
    visible evaluation under 50000, because the GLB counted the deleted regions. Baking
    here - with the armature at the seated rest, so its contribution is identity - keeps
    the skinning and exports only what can be seen.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        baked = bpy.data.meshes.new_from_object(
            evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        for modifier in list(obj.modifiers):
            if modifier.type != 'ARMATURE':
                obj.modifiers.remove(modifier)
        obj.data = baked
        obj.data.name = obj.name + '_mesh'


def export_and_parse(armature):
    meshes = [bpy.data.objects[name] for name in CHARACTER_MESHES]
    bake_visible_meshes(meshes)
    for obj in [*meshes, armature]:
        obj['riverProof'] = 'native_amber_v1'
        obj['riverCharacter'] = 'amber'
        obj['sourceLicense'] = 'CC0'
        obj['riverSeatedBaked'] = True
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [*meshes, armature]:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        check_existing=False,
        export_format='GLB',
        export_materials='EXPORT',
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_lights=False,
        export_cameras=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_morph=False,
        use_selection=True,
    )
    return parse_glb()


TILES = (
    ('front', (0.02, -2.55, 1.30), (0.0, -0.10, 1.16), 62.0, False),
    ('three_quarter_l', (-1.55, -2.05, 1.34), (0.0, -0.05, 1.12), 62.0, False),
    ('three_quarter_r', (1.55, -2.05, 1.34), (0.0, -0.05, 1.12), 62.0, False),
    ('profile', (-2.45, 0.10, 1.30), (0.0, 0.02, 1.12), 62.0, False),
    ('rear', (0.55, 1.85, 1.42), (0.0, 0.05, 1.18), 62.0, False),
    ('rear_three_quarter', (-1.45, 1.75, 1.40), (0.0, 0.02, 1.15), 62.0, False),
    ('face', (0.52, -1.05, 1.30), (0.0, -0.10, 1.27), 85.0, False),
    ('gameplay', (0.0, -2.30, 1.20), (0.0, -0.35, 1.05), 40.0, True),
)
GAME_VIEW = ((0.0, -2.30, 1.20), (0.0, -0.35, 1.05), 40.0)


def render_tile(scene, camera, name, location, target, lens, show_guides):
    for obj in bpy.data.objects:
        if obj.name.startswith('amber_guide_'):
            obj.hide_render = not show_guides
    camera.data.lens = lens
    camera.location = location
    look_at(camera, target)
    scene.render.filepath = os.path.join(OUT, '_tile_%s.png' % name)
    bpy.ops.render.render(write_still=True)
    return scene.render.filepath


def compose_sheet(paths, columns, name, path):
    tiles = []
    for tile_path in paths:
        image = bpy.data.images.load(tile_path)
        width, height = image.size
        tiles.append(np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4))
        bpy.data.images.remove(image)
        os.remove(tile_path)
    rows = [np.hstack(tiles[i:i + columns]) for i in range(0, len(tiles), columns)]
    grid = np.vstack(list(reversed(rows)))
    image = bpy.data.images.new(name, grid.shape[1], grid.shape[0], alpha=True)
    image.pixels.foreach_set(grid.ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    print('SHEET %s %dx%d' % (path, grid.shape[1], grid.shape[0]))


def assign_action(armature, action):
    animation = armature.animation_data_create()
    animation.action = action
    slot = getattr(animation, 'action_slot', None)
    if slot is None and getattr(action, 'slots', None):
        animation.action_slot = action.slots[0]


def run_render(which):
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    scene = bpy.context.scene
    engines = {item.identifier for item in
               scene.render.bl_rna.properties['engine'].enum_items}
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines \
        else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = TILE_W, TILE_H
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.35
    camera = bpy.data.objects['amber_camera']
    scene.camera = camera
    armature = bpy.data.objects['river_native_amber_body.rig']

    if which in ('contact', 'both'):
        paths = [render_tile(scene, camera, name, location, target, lens, guides)
                 for name, location, target, lens, guides in TILES]
        compose_sheet(paths, 4, 'native_amber_contact_sheet', CONTACT_SHEET)

    if which in ('idle', 'both'):
        assign_action(armature, bpy.data.actions['IDLE_breathe'])
        start, end = bpy.data.actions['IDLE_breathe'].frame_range
        frames = [round(start), round((start + end) / 2), round(end)]
        paths = []
        for frame in frames:
            scene.frame_set(int(frame))
            paths.append(render_tile(
                scene, camera, 'idle_%d' % frame, *GAME_VIEW[:2],
                lens=GAME_VIEW[2], show_guides=True))
        compose_sheet(paths, 3, 'native_amber_idle_sheet', IDLE_SHEET)
        armature.animation_data.action = None
        scene.frame_set(0)


def write_report_md(report):
    glb = report['glb']
    lines = [
        '# Native Amber proof report',
        '',
        'Isolated seated-first character proof for River. No production integration or '
        'publishing occurred; nothing was written outside '
        '`art/pipeline/build_native_amber.py` and `art/out/proofs/native-amber/`.',
        '',
        '## What changed',
        '',
        '- New identity recipe `amber_established_gentleman_v1` (age macro 0.84, lean '
        'frame, gaunt cheek and eye-bag targets, deep warm `old_african_male` skin) '
        'distinct from Native Silver.',
        '- Silver/salt-and-pepper slicked-back hair (`short04`), grey brows.',
        '- Stock `male_elegantsuit01` continuous jacket surface recoloured to bottle-green '
        'velvet over black trousers; shirt and tie faces removed and replaced by a '
        'roll-neck cut from Amber\'s own neck and upper-chest skin.',
        '- Seated rest from the shared venue `apply_seated_rest_pose`, with the right '
        'forearm retargeted into an available betting hand.',
        '- New `IDLE_breathe` authored as a delta from Amber\'s seated rest; the other '
        'eight clip names and definitions preserved.',
        '',
        '## Renders inspected',
        '',
        '- `native-amber-contact-sheet.png` (front, both three-quarters, profile, rear, '
        'rear three-quarter, face, gameplay table).',
        '- `native-amber-idle-sheet.png` (idle start, midpoint, end at the gameplay view).',
        '',
        '## Counts',
        '',
        '- Bones: %d (exact donor list).' % report['bones'],
        '- Actions: %s.' % ', '.join(sorted(report['actions'])),
        '- Evaluated triangles: %d (budget 50000).' % report['evaluated_total'],
        '- Max influences per vertex: %d; unweighted vertices: %d.'
        % (report['max_influences'], report['unweighted_vertices']),
        '- Materials: %d; mesh draw-call estimate: %d; GLB primitives: %d.'
        % (report['material_count'], report['draw_calls_estimate'], glb['primitives']),
        '- GLB: %.2f MB, %d triangles, %d joints, clips %s, weights %s..%s.'
        % (glb['file_bytes'] / 1048576.0, glb['triangles'], glb['joints'],
           ','.join(sorted(glb['animations'])),
           '%.3f' % glb['weight_sum_min'], '%.3f' % glb['weight_sum_max']),
        '',
        '## What did not improve / open issues',
        '',
        '- The stock suit still carries its full standing topology; the later production '
        'route is decimation and a seated corrective pass, not more proof detail.',
        '- Chair and floor contacts are proxy geometry at venue scale, hidden at gameplay '
        'cameras; they were not polished.',
        '',
        '## Route to the 23,000-triangle production ceiling',
        '',
        'Measured bases: body 36972 base / masked evaluation in the low teens; suit about '
        '12000 after shirt removal; hair about 3300; eyes 2040; shoes 3320. A production '
        'pass should decimate the body to its masked silhouette, decimate the suit to '
        'roughly 6000, drop shoes to low-poly dress shoes, and share one material per '
        'garment. That reaches 23000 without changing the visual contract.',
        '',
        '## Routing',
        '',
        'Judgement pending the sheet inspection.',
        '',
    ]
    with open(REPORT_MD, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines))


def run_diagnose():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    human, attached = build_character()
    armature = bpy.data.objects['river_native_amber_body.rig']
    print('DIAG matrix_world=%s' % ([round(v, 4) for row in armature.matrix_world for v in row],))
    for name in ('upperarm01.L', 'lowerarm01.L', 'wrist.L', 'spine05', 'upperleg01.L'):
        bone = armature.data.bones[name]
        print('DIAG standing %s head=%s tail=%s'
              % (name, [round(v, 4) for v in bone.head_local],
                 [round(v, 4) for v in bone.tail_local]))
    sys.path.insert(0, HERE)
    os.environ.setdefault('RIVER_OUT', os.path.join(ROOT, 'out'))
    import build_assets
    reach, rail = build_assets.seated_rail_contact()
    print('DIAG contact reach=%.4f rail=%.4f' % (reach, rail))
    build_assets.apply_seated_rest_pose(armature, pose_arms=True)
    for name in ('upperarm01.L', 'lowerarm01.L', 'wrist.L', 'wrist.R',
                 'spine05', 'upperleg01.L', 'lowerleg01.L', 'head'):
        bone = armature.data.bones[name]
        print('DIAG seated %s head=%s tail=%s'
              % (name, [round(v, 4) for v in bone.head_local],
                 [round(v, 4) for v in bone.tail_local]))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--diagnose' in argv:
        run_diagnose()
    elif '--verify' in argv:
        report = run_verify()
        write_report_md(report)
    elif '--render' in argv:
        index = argv.index('--render')
        which = argv[index + 1] if len(argv) > index + 1 else 'both'
        run_render(which)
    else:
        run_build()


if __name__ == '__main__':
    main()


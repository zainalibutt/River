"""Export the silver male source as a rigged GLB the Rooftop build can seat.

Mirrors export_native_gold.py's shape without importing from it. Two deliberate
differences:

1. Alpha. The gold exporter forces every material to alphaMode OPAQUE, which discards the
   hair's alpha strand cutouts in the browser and leaves a smooth shell. Silver exports
   hair, brows and lashes as MASK with a cutoff instead. MASK is order-independent, so it
   keeps the cutouts without reintroducing the alpha-card sorting the F3A packet rules
   out.

2. Naming. build_assets.import_native_gold_template() finds the body by the mesh data
   name prefix 'char_native_gold_body', and duplicate_native_gold() derives runtime names
   by stripping 'river_native_gold_'. Silver adopts both so the Rooftop build can seat it
   through RIVER_NATIVE_GOLD_ASSET without any edit to the gold lane's importer. The
   loader should really take the prefix as a parameter; that is noted for the Codex lane
   rather than changed here.

Run: blender --background --python art/pipeline/export_native_silver.py
"""
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
SOURCE = os.path.join(OUT, 'proofs', 'native-silver', 'native-silver-character.blend')
GLB = os.path.join(OUT, 'char_native_silver.glb')

BODY_TRIANGLE_CEILING = 23000
# 'eye' is here for the cornea. The MakeHuman high-poly eye puts a clear corneal surface
# in front of the iris; forcing it OPAQUE renders it as a solid white shell and the
# character comes out blank-eyed. MASK drops the transparent cornea instead of painting
# over the iris with it.
# 'high-poly' is the eye asset. MakeHuman names its material after the asset folder, not
# after what it is, so it arrives as "<body>.high-poly" and matches no obvious token. It
# needs masking because the asset puts a clear corneal surface in front of the iris:
# forced OPAQUE, that surface renders as a solid white shell and the character comes out
# blank-eyed.
MASK_MATERIALS = ('hair', 'eyebrow', 'eyelash', 'high-poly')

# See normalise_alpha_modes. 0.08 was tried against the head turntable on the theory that
# the cutoff was eating the thinner occiput strands, and changed nothing at all - so the
# bare patch on the back of the skull is not an alpha problem and this stays where the
# fringe wants it.
HAIR_ALPHA_CUTOFF = 0.28


def glb_json(path):
    with open(path, 'rb') as handle:
        header = handle.read(12)
        if len(header) != 12 or header[:4] != b'glTF':
            raise SystemExit('FAIL: invalid GLB header ' + path)
        length, kind = struct.unpack('<II', handle.read(8))
        if kind != 0x4E4F534A:
            raise SystemExit('FAIL: first GLB chunk is not JSON')
        return json.loads(handle.read(length).decode('utf-8'))


def normalise_alpha_modes(path):
    """Opaque everywhere except the cut-out grooming meshes, which become MASK.

    Forcing these to OPAQUE is what flattens a hair shell into a moulded cap in the
    browser: MakeHuman hair links Alpha to its diffuse texture, so OPAQUE throws every
    strand cutout away.
    """
    with open(path, 'rb') as handle:
        data = handle.read()
    _, version, _ = struct.unpack_from('<4sII', data, 0)
    offset = 12
    json_length, json_type = struct.unpack_from('<II', data, offset)
    offset += 8
    if version != 2 or json_type != 0x4E4F534A:
        raise SystemExit('FAIL: cannot normalise invalid GLB ' + path)
    gltf = json.loads(data[offset:offset + json_length].decode('utf-8'))
    offset += json_length
    binary_length, binary_type = struct.unpack_from('<II', data, offset)
    offset += 8
    binary = data[offset:offset + binary_length]
    if binary_type != 0x004E4942:
        raise SystemExit('FAIL: native silver GLB has no binary chunk')

    masked = 0
    for material in gltf.get('materials', []):
        name = material.get('name', '').lower()
        if any(token in name for token in MASK_MATERIALS):
            material['alphaMode'] = 'MASK'
            # 0.5 cuts the fringe. The strands at a hairline carry partial alpha, so a
            # half cutoff deletes exactly the soft edge that stops the shell reading as a
            # cap, and leaves a pale band of scalp along the forehead.
            #
            # 0.28 still ate the back of the head: the occiput strands are thinner than
            # the fringe, so a cutoff tuned on the hairline opened a hard-edged hole
            # across the back of the skull with a visible seam down the middle. It looked
            # like a bald patch and survived every proof, because until the head got its
            # own turntable nothing was pointed at the back of his skull.
            material['alphaCutoff'] = HAIR_ALPHA_CUTOFF
            masked += 1
        else:
            material['alphaMode'] = 'OPAQUE'
            material.pop('alphaCutoff', None)
    print('ALPHA masked=%d of %d materials' % (masked, len(gltf.get('materials', []))))
    # The hair material is the entire reason this function is not just "force OPAQUE".
    # It shipped once matching nothing, because the stock material is called
    # "Human.short02" and carries no token this list looks for.
    if masked < 1:
        raise SystemExit('FAIL: no material matched the alpha mask list, so the hair '
                         'cutouts would export flattened')

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    binary += b'\x00' * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack('<4sII', b'glTF', 2, total))
    output.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    output.extend(json_bytes)
    output.extend(struct.pack('<II', len(binary), 0x004E4942))
    output.extend(binary)
    with open(path, 'wb') as handle:
        handle.write(output)


def bake_shape_keys(obj):
    """Fold the identity morphs into the base mesh.

    The identity is 66 loaded targets, each of which arrives as a shape key. Exported as
    morph targets they would multiply the vertex payload by 66 for deltas that never
    animate. Silver carries no expression shapes yet, so everything bakes flat.
    """
    keys = obj.data.shape_keys
    if keys is None or not keys.key_blocks:
        return 0
    count = len(keys.key_blocks)
    mixed = obj.shape_key_add(name='__baked', from_mix=True)
    coords = [point.co.copy() for point in mixed.data]
    for block in list(obj.data.shape_keys.key_blocks):
        obj.shape_key_remove(block)
    for index, vertex in enumerate(obj.data.vertices):
        vertex.co = coords[index]
    return count


def apply_non_armature_modifiers(obj):
    """Collapse everything except skinning into the mesh.

    MPFB builds the body with helper/proxy geometry for fitting clothes and hides it
    behind a Mask modifier. glTF export runs with export_apply=False so that skinning
    survives, which also means that Mask never runs - and the helper strips ship. In the
    venue they appear as large skin-coloured ribbons hanging off the head and shoulders.

    Must run after shape keys are baked: Blender refuses to apply a modifier to a mesh
    that still has them.
    """
    bpy.context.view_layer.objects.active = obj
    applied = []
    # Name and type are read up front: applying or removing a modifier invalidates the
    # reference, and reading through it afterwards yields empty strings at best.
    for name, kind in [(m.name, m.type) for m in obj.modifiers]:
        if kind == 'ARMATURE':
            continue
        # Blender raises rather than skipping when a modifier is disabled, and "disabled"
        # covers both render flags and invalid settings - a Mask pointing at a vertex
        # group the asset does not have, for instance. There is no reliable predicate for
        # the second case, so the outcome is the test. Either way it must not survive
        # into the GLB, so a failure drops it.
        try:
            bpy.ops.object.modifier_apply(modifier=name)
            applied.append(kind)
        except RuntimeError:
            existing = obj.modifiers.get(name)
            if existing is not None:
                obj.modifiers.remove(existing)
            print('DROPPED %-28s %s (disabled)' % (obj.name, kind))
    if applied:
        print('APPLIED %-28s %s' % (obj.name, ','.join(applied)))
    return applied


# The seated rest pose curls every finger by 15 + 8*joint degrees and the thumb by
# 12/24/30, which on a hand resting on a rail rather than gripping anything reads as a
# claw. A relaxed hand on a surface is nearly flat: the knuckle takes most of what little
# bend there is and the tip almost none.
# Signs measured, not assumed - see probe_hand_axes. On this rig a POSITIVE X rotation
# lifts the fingertip (+0.020 up for +20 degrees), so every earlier pass, which curled with
# positive values, was straightening the fingers upward and calling it a relaxed hand.
# Negative X closes them onto the surface underneath.
# Per joint, base to tip. 13/17/12 was tuned when apply_seated_rest_pose was also curling
# the fingers by 23/31/39 underneath it, so what shipped was a nearly straight hand with
# the fingers fanned out - a gesture, not a rest. A hand lying on a table keeps a shallow
# arch: most of it at the knuckle and the middle joint, almost none at the tip.
RELAXED_FINGER_CURL = (-22.0, -26.0, -14.0)
# Finger bones point along local +Y, so flexion is rotation about local X - which is right
# for the four fingers and wrong for the thumb. The thumb's rest frame is rolled about
# ninety degrees against the others, so the same X rotation swings it ACROSS the palm to
# meet the index tip. Rendered, that is an "OK" sign on a man waiting for cards. The thumb
# therefore stays nearly straight and takes its small bend on Z.
# The thumb's frame is rolled against the fingers: +X pulls its tip backward (-0.023) and
# +Z lifts it (+0.023). So it takes a small positive X to lie back alongside the index and
# a negative Z to come down to the surface rather than stand off the hand.
RELAXED_THUMB_CURL = ((5.0, 0.0, -9.0), (4.0, 0.0, -7.0), (3.0, 0.0, -4.0))
# The seated rest twists the wrist by 55 degrees, which supinates the palm until it faces
# up like an offering. Pronating to 18 lays the palm toward the rail while keeping the
# forearm roll the seated arm pose depends on.
# On the wrist, +Z drops the hand (-0.043) and +X swings it forward (+0.049). The seated
# rest supinated it 55 degrees the other way, which turned the palm face-up like an
# offering. A little of each lays the hand down onto the rail it is already level with.
RELAXED_WRIST = (6.0, 0.0, 7.0)

# What fraction of the arm's rotation each shoulder girdle bone takes before upperarm01
# takes the remainder. Two bones carry it - clavicle and shoulder01 - so the upper arm is
# left with roughly what these two do not absorb.
#
# The point is not anatomy for its own sake. Linear blend skinning averages a vertex
# between the transforms of the bones that own it, and the error in that average grows
# with the angle between those transforms. One joint doing all the work is the worst case
# available, and it is what the shipped build does: the sleeve around that joint balloons.
# Three joints doing a third each is the same final hand position with a third of the
# angle at every neighbourhood of vertices.
GIRDLE_SHARE = 0.22

# What the body masks down to when the suit's delete group is left exactly as the asset
# ships it. Recorded so keep_forearm_inside_cuffs can report what it actually saved
# rather than what it asked to save - the two differ, because much of what sits near the
# wrist is helper geometry that the helper mask removes regardless.
CUFFLESS_BODY_VERTICES = 7824

# How far the elbow sits outboard of the shoulder-to-wrist line. Bracketed on a
# turntable, not guessed: 0.38 lays the upper arms flat against the ribs and arm and
# jacket read as one mass; 1.05 wings the elbows out and lifts them to 0.829. 0.66 sat
# between those and was right for the shoulder, but it leaves the sleeve pressed into the
# jacket's side panel and the armpit keeps a fold. 0.78 opens that angle without the
# elbow riding up.
ELBOW_OUTWARD = 0.78


def smooth_shoulder_weights(obj, armature, radius=0.17, rounds=5, factor=0.55):
    """Blend the skin weights around the shoulder so the armpit stops creasing.

    The pose is as good as it is going to get: the rotation is shared across the girdle,
    the elbow is bracketed, and the skinning that applies it agrees with Blender's own to
    a micron. What is left is the weights themselves. MPFB fits a garment by matching each
    of its vertices to the nearest vertex on the body and copying that vertex's weights,
    which is fine on a shirt lying against skin and poor on a tailored jacket that stands
    off it - a vertex on the outside of the shoulder can be nearest to a point on the
    chest, and then it does not follow the arm at all. The boundary between what follows
    the arm and what follows the ribs ends up abrupt, and an abrupt boundary under a
    ninety degree rotation is a crease.

    Averaging each weight with its neighbours' turns that step into a ramp. It is done on
    the weights rather than on the geometry: smoothing the mesh afterwards pulls the
    sleeve in and thins it, which is how an earlier pass made the arms look fused to the
    body while removing the crease it was aimed at.
    """
    joints = [armature.matrix_world @ armature.data.bones['upperarm01.' + side].head_local
              for side in ('L', 'R')]
    matrix = obj.matrix_world
    inside = {vertex.index for vertex in obj.data.vertices
              if min((matrix @ vertex.co - joint).length for joint in joints) < radius}
    if len(inside) < 100:
        raise SystemExit('FAIL: only %d %s vertices sit within %.0fmm of a shoulder, so '
                         'the weight smoothing has nothing to work on'
                         % (len(inside), obj.name, radius * 1000.0))

    neighbours = {index: set() for index in inside}
    for edge in obj.data.edges:
        first, second = edge.vertices
        if first in neighbours:
            neighbours[first].add(second)
        if second in neighbours:
            neighbours[second].add(first)

    weights = {vertex.index: {group.group: group.weight for group in vertex.groups}
               for vertex in obj.data.vertices}
    moved = 0.0
    for _ in range(rounds):
        updated = {}
        for index in inside:
            blended = dict(weights[index])
            around = neighbours[index]
            if not around:
                continue
            for other in around:
                for group, weight in weights[other].items():
                    blended[group] = blended.get(group, 0.0) + weight / len(around)
            mixed = {}
            for group in set(weights[index]) | set(blended):
                own = weights[index].get(group, 0.0)
                near = blended.get(group, 0.0) - own
                mixed[group] = own * (1.0 - factor) + near * factor
            total = sum(mixed.values())
            if total > 1e-6:
                updated[index] = {group: value / total for group, value in mixed.items()
                                  if value / total > 0.0005}
        for index, values in updated.items():
            moved = max(moved, max(
                abs(values.get(group, 0.0) - weights[index].get(group, 0.0))
                for group in set(values) | set(weights[index])))
            weights[index] = values

    groups = {group.index: group for group in obj.vertex_groups}
    for index in inside:
        for group in list(groups):
            groups[group].remove([index])
        for group, weight in weights[index].items():
            if group in groups:
                groups[group].add([index], weight, 'REPLACE')
    print('WEIGHTS %-24s smoothed %d vertices around the shoulders, largest change %.3f'
          % (obj.name, len(inside), moved))
    return len(inside)


def keep_forearm_inside_cuffs(body, armature, keep=0.19):
    """Stop the sleeves being open tubes you can see down.

    MakeHuman clothing carries a list of body vertices to delete underneath it, and
    male_elegantsuit01's runs all the way to the wrist. The sleeve itself is an open
    cylinder - garments in this library have no inside - so once the forearm under it is
    gone there is nothing behind the cuff, and every close view has a dark hole at the
    end of each arm with the white shirt cuff around it like a pipe collar.

    Capping the sleeve would close the hole with a disc that is visibly a disc. Keeping
    the forearm is what is actually meant to be in there, so this takes the vertices near
    the wrist back out of the delete group before the mask is applied. They only have to
    reach far enough up the arm to be hidden by the sleeve.
    """
    wrists = [armature.matrix_world @ armature.data.bones['wrist.' + side].head_local
              for side in ('L', 'R')]
    deleters = {group.index for group in body.vertex_groups
                if group.name.lower().startswith('delete')}
    if not deleters:
        raise SystemExit('FAIL: the body has no delete group, so the suit is not masking '
                         'anything and this is measuring the wrong mesh')
    matrix = body.matrix_world
    freed = 0
    for vertex in body.data.vertices:
        point = matrix @ vertex.co
        if min((point - wrist).length for wrist in wrists) > keep:
            continue
        for group in vertex.groups:
            if group.group in deleters:
                body.vertex_groups[group.group].remove([vertex.index])
                freed += 1
    print('CUFFS kept %d forearm vertices within %.0fmm of the wrists'
          % (freed, keep * 1000.0))
    if freed < 50:
        raise SystemExit('FAIL: only %d vertices were taken back out of the delete '
                         'group, which will not fill a cuff' % freed)
    return freed


def rotate_pose_bone(bone, rotation):
    """Rotate a pose bone about its own head, in armature space.

    Armature space rather than the bone's local frame, because local axes differ between
    the fingers and the thumb and between the two hands, and every pass that assumed one
    of them produced a different wrong hand.
    """
    head = bone.matrix.translation.copy()
    matrix = bone.matrix.copy()
    matrix.translation = Vector((0.0, 0.0, 0.0))
    matrix = rotation @ matrix
    matrix.translation = head
    bone.matrix = matrix
    bpy.context.view_layer.update()


def palm_frame(armature, side):
    """Measure the hand's own frame: where it points, and which way the palm faces.

    Returned as (joints, forward, normal), all in armature space, with `normal` pointing
    OUT of the palm rather than out of the back of the hand.

    That last part is measured rather than chosen, and it is the whole reason this
    function exists. The cross product of the knuckle line and the middle finger gives
    the palm plane, but its sign flips between the two hands, and picking a convention
    produced one hand right and one hand backwards. The fingers curl towards the palm, so
    the direction the second phalanx bends away from the first says which side the palm
    is on, whatever the rig's local axes happen to be doing.
    """
    joints = {}
    for finger in range(2, 6):
        bones = [armature.pose.bones.get('finger%d-%d.%s' % (finger, joint, side))
                 for joint in (1, 2, 3)]
        if any(bone is None for bone in bones):
            raise SystemExit('FAIL: finger%d is incomplete on side %s, so the hand frame '
                             'cannot be measured' % (finger, side))
        joints[finger] = bones

    base, middle, tip = joints[3]
    forward = tip.matrix.translation - base.matrix.translation
    across = joints[5][0].matrix.translation - joints[2][0].matrix.translation
    if forward.length < 1e-5 or across.length < 1e-5:
        raise SystemExit('FAIL: degenerate hand frame on side ' + side)
    normal = forward.normalized().cross(across.normalized())
    if normal.length < 1e-5:
        raise SystemExit('FAIL: the knuckles and the middle finger are colinear on side '
                         '%s, so there is no palm plane to measure in' % side)
    normal.normalize()

    first = (middle.matrix.translation - base.matrix.translation).normalized()
    second = (tip.matrix.translation - middle.matrix.translation).normalized()
    bend = second - first
    if bend.length < 1e-4:
        raise SystemExit('FAIL: the fingers on side %s are straight, so which side the '
                         'palm is on cannot be measured - curl them first' % side)
    if normal.dot(bend) < 0.0:
        normal = -normal
    return joints, forward.normalized(), normal


def level_palm(armature, facing=Vector((0.0, 0.0, -1.0))):
    """Turn each palm to face the table.

    apply_seated_rest_pose used to pronate the wrist by 55 degrees, and that was the only
    thing turning the palms down. Skipping its arm pass to stop the sleeves being
    deformed twice took the pronation with it, and the hands came back up on edge with
    the palms facing each other - which reads as a man explaining something, not a man
    sitting still.

    The rotation is the minimal one that takes the measured palm normal onto `facing`, so
    it changes the pronation and leaves where the fingers point alone.

    It is spread over the forearm twist bone and the wrist rather than landing entirely
    on the wrist. Real pronation happens along the forearm - the radius crossing over the
    ulna - which is what lowerarm02 is for, and a 90-degree rotation on a single joint
    wrings the mesh around it exactly the way the shoulder was being wrung.
    """
    from mathutils import Quaternion

    turned = []
    for side in ('L', 'R'):
        total = 0.0
        for name, share in (('lowerarm02.' + side, 0.6), ('wrist.' + side, 1.0)):
            bone = armature.pose.bones.get(name)
            if bone is None:
                raise SystemExit('FAIL: %s is missing, so pronation cannot be spread'
                                 % name)
            _, _, normal = palm_frame(armature, side)
            rotation = normal.rotation_difference(facing)
            if share < 1.0:
                rotation = Quaternion().slerp(rotation, share)
            total += math.degrees(2.0 * math.acos(min(1.0, abs(rotation.w))))
            rotate_pose_bone(bone, rotation.to_matrix().to_4x4())
        turned.append((side, total))

    # Report where the hand ACTUALLY ended up, not how far it was asked to turn. Which
    # side of the palm plane is the palm is inferred from the way the fingers bend, and
    # if that inference is backwards the hand turns over and every number above still
    # looks perfect - 81.7 degrees on both sides reads as a clean symmetric pronation
    # whether the palms finished downward or upward.
    for side, degrees in turned:
        joints, _, normal = palm_frame(armature, side)
        knuckle = joints[3][0].matrix.translation
        fingertip = joints[3][2].matrix.translation
        print('PALM %s pronated %.1f degrees, normal=(%+.2f,%+.2f,%+.2f), '
              'fingertip %+.0fmm relative to the knuckle'
              % (side, degrees, normal.x, normal.y, normal.z,
                 (fingertip.z - knuckle.z) * 1000.0))
        if normal.z > -0.55:
            raise SystemExit(
                'FAIL: the %s palm faces (%+.2f,%+.2f,%+.2f) after levelling - it is not '
                'pointing at the table, so the palm side was identified backwards'
                % (side, normal.x, normal.y, normal.z))
    # A symmetric pose needs the same correction on both hands. Different numbers mean
    # the frame was measured wrong on one of them, which is how a backwards hand shipped
    # before, and it is invisible at any distance a proof camera has ever sat at.
    if abs(turned[0][1] - turned[1][1]) > 6.0:
        raise SystemExit('FAIL: the palms needed %.1f and %.1f degrees - the hand frame '
                         'disagrees between sides' % (turned[0][1], turned[1][1]))
    return max(degrees for _, degrees in turned)


def close_finger_splay(armature, factor=0.72):
    """Bring the fingers together, and say by how much.

    relax_hands curls the fingers and leaves their spread exactly as the bind pose had
    it, which on this mesh is a fan. A hand resting on a table has its fingers close to
    parallel, so a fanned hand reads as a gesture rather than a rest.

    factor is short of 1.0 because real fingers are not parallel - the little finger sits
    a few degrees off - and closing them completely reads as a mitten.
    """
    from mathutils import Matrix

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
    print('SPLAY closed %d fingers, widest was %.1f degrees off the middle finger'
          % (len(closed), spread))
    return spread


def probe_hand_axes(armature):
    """Find out which local axis actually flexes a finger, by moving it and looking.

    Every hand pass so far has guessed. Finger bones point along local +Y so flexion is
    rotation about local X - true for the four fingers, false for the thumb, whose rest
    frame is rolled about ninety degrees against them, and unverified for the wrist. The
    result was an OK sign, then a claw, then a hand hovering palm-up.

    This rotates one joint at a time by twenty degrees and reports where the fingertip
    went, in armature space. The axis whose displacement points most steeply downward is
    the one that closes the hand onto a surface it is resting on.
    """
    from mathutils import Vector

    for bone_name, tip_name in (('finger3-1.L', 'finger3-3.L'),
                                ('finger1-1.L', 'finger1-3.L'),
                                ('wrist.L', 'finger3-3.L')):
        bone = armature.pose.bones.get(bone_name)
        tip = armature.pose.bones.get(tip_name)
        if bone is None or tip is None:
            continue
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        origin = tip.matrix.translation.copy()
        readings = []
        for axis, label in enumerate('XYZ'):
            euler = [0.0, 0.0, 0.0]
            euler[axis] = math.radians(20.0)
            bone.rotation_euler = euler
            bpy.context.view_layer.update()
            delta = tip.matrix.translation - origin
            readings.append('%s=(%+.3f,%+.3f,%+.3f)' % (label, delta.x, delta.y, delta.z))
            bone.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        print('HANDAXIS %-12s tip %-12s %s' % (bone_name, tip_name, '  '.join(readings)))


def relax_hands(armature):
    """Open the seated hand out of its default claw, then bake it into the rest pose.

    Called between apply_seated_rest_pose and the rest-to-rest measurement, so the hand
    correction rides along in the same skinning bake rather than needing a second one.
    """
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
        raise SystemExit('FAIL: relaxed only %d finger joints' % touched)
    # The splay is a property of the hand alone, so it can be settled here. Pronation
    # cannot: reach_to_rail rotates the whole arm afterwards and carries the hand with it,
    # so a palm levelled at this point does not stay level. It is done there instead.
    bpy.context.view_layer.update()
    close_finger_splay(armature)
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    print('HANDS relaxed joints=%d' % touched)


def bake_seated_pose(armature, meshes):
    """Put the character in the chair, in the mesh, permanently.

    apply_seated_rest_pose poses the rig and then calls bpy.ops.pose.armature_apply,
    which makes that pose the REST pose and zeroes every pose channel. The armature
    modifier then computes pose x rest-inverse, which is identity, so the mesh reverts to
    the standing vertices it was authored with. The seated pose is calculated and thrown
    away, which is why the character stands beside the chair with his arms hanging.

    The venue compounds it: it bakes the other meshes from the depsgraph AFTER that apply,
    so it bakes the identity result, and it skips the body mesh altogether.

    The fix is to do the skinning by hand. Every vertex is moved by the blended
    rest-to-rest transform of the bones that own it - ordinary linear blend skinning,
    exactly what the modifier would have done had it been evaluated while the rig was
    still posed. Afterwards mesh, rest pose and zero pose all agree on a seated character,
    and clip deltas of zero leave him seated.

    The seated numbers are not copied. apply_seated_rest_pose is called and the difference
    between the rest pose before and after is measured.
    """
    from mathutils import Vector

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault('RIVER_OUT', OUT)
    import build_assets

    before = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    # The legs and spine come from the shared seated pose; the arms do not. That function
    # places them with a two-bone IK chain and a pole target - the same under-constrained
    # solve reach_to_rail exists to replace - and then bakes it into the rest pose, after
    # which reach_to_rail poses the arms all over again from there.
    #
    # The result is a sleeve deformed twice. Skinning error does not undo itself when a
    # limb is rotated back, so the jacket keeps the damage of an intermediate pose that no
    # longer exists anywhere: the shipped forearms measured 152 degrees of rotation on the
    # left against 72 on the right, for a final pose whose wrists both land within a
    # tenth of a millimetre and whose rolls agree to 0.3 degrees. The asymmetry was never
    # in the result, it was in the discarded middle step.
    build_assets.apply_seated_rest_pose(armature, pose_arms=False)
    probe_hand_axes(armature)
    relax_hands(armature)
    after = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    transforms = {
        name: after[name] @ before[name].inverted()
        for name in before if name in after
    }
    changed = sum(
        1 for name, matrix in transforms.items()
        if max(abs(a - b) for row_a, row_b in zip(matrix, [[1, 0, 0, 0], [0, 1, 0, 0],
                                                          [0, 0, 1, 0], [0, 0, 0, 1]])
               for a, b in zip(row_a, row_b)) > 1e-4)
    print('SEATED bones_moved=%d of %d' % (changed, len(transforms)))
    if changed < 8:
        raise SystemExit('FAIL: the seated pose moved only %d bones' % changed)

    for obj in meshes:
        names = {group.index: group.name for group in obj.vertex_groups}
        moved = 0.0
        for vertex in obj.data.vertices:
            accumulated = Vector((0.0, 0.0, 0.0))
            weight_total = 0.0
            for group in vertex.groups:
                matrix = transforms.get(names.get(group.group))
                if matrix is None or group.weight <= 0.0:
                    continue
                accumulated += (matrix @ vertex.co) * group.weight
                weight_total += group.weight
            if weight_total > 1e-6:
                target = accumulated / weight_total
                moved += (target - vertex.co).length
                vertex.co = target
        print('SEATED %-30s mean_shift=%.4f' % (
            obj.name, moved / max(1, len(obj.data.vertices))))

    seat_on_chair(armature, meshes)
    report_seated_geometry(armature, 'after seating')
    reach_to_rail(armature, meshes)
    report_seated_geometry(armature, 'after rail reach')


def _carry_meshes(armature, meshes, before):
    """Move every vertex by the blended rest-to-rest transform of the bones that own it.

    Linear blend skinning by hand: what the armature modifier would have done had it been
    evaluated while the rig was still posed, rather than after armature_apply zeroed the
    pose and made the deformation identity.
    """
    import numpy as np
    from mathutils import Vector

    travelled = {obj.name: [] for obj in meshes}
    after = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    transforms = {
        name: after[name] @ before[name].inverted()
        for name in before if name in after
    }
    for obj in meshes:
        names = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            accumulated = Vector((0.0, 0.0, 0.0))
            weight_total = 0.0
            for group in vertex.groups:
                matrix = transforms.get(names.get(group.group))
                if matrix is None or group.weight <= 0.0:
                    continue
                accumulated += (matrix @ vertex.co) * group.weight
                weight_total += group.weight
            if weight_total > 1e-6:
                target = accumulated / weight_total
                travelled[obj.name].append((target - vertex.co).length)
                vertex.co = target
            else:
                travelled[obj.name].append(0.0)
    return {name: np.array(values) for name, values in travelled.items()}


def relax_skinning(obj, moved, threshold=0.04, factor=0.4, rounds=4):
    """Smooth out the pinch where a mesh had to follow a large joint rotation.

    Linear blend skinning collapses on the inside of a big rotation, and the shoulder is
    the biggest one in this pose: the upper arm swings from a near-A-pose rest to hanging
    forward, and the jacket creases diagonally across the shoulder blade. It is invisible
    from the front and from both three-quarters and obvious from behind.

    Weighted by how far each vertex actually travelled, so the relaxation lands on the
    shoulder that needs it and leaves the lapel, the collar and the hem - which barely
    moved - alone.
    """
    import numpy as np

    vertices = obj.data.vertices
    count = len(vertices)
    if count == 0 or moved is None:
        return
    weight = np.clip((moved - threshold) / max(threshold, 1e-6), 0.0, 1.0)
    if float(weight.max()) <= 0.0:
        return
    neighbours = [[] for _ in range(count)]
    for edge in obj.data.edges:
        a, b = edge.vertices
        neighbours[a].append(b)
        neighbours[b].append(a)
    coords = np.array([vertex.co[:] for vertex in vertices], dtype=np.float64)
    for _ in range(rounds):
        average = np.array([
            coords[neighbours[i]].mean(axis=0) if neighbours[i] else coords[i]
            for i in range(count)
        ])
        coords += (average - coords) * (factor * weight)[:, None]
    for index, vertex in enumerate(vertices):
        vertex.co = coords[index]
    print('RELAX %-30s vertices=%d' % (obj.name, int((weight > 0).sum())))


def reach_to_rail(armature, meshes):
    """Author the resting arms, rather than solving for a wrist point.

    This replaces an IK pass. A point target constrains three degrees of freedom and an
    arm has roughly seven, so the solver was free to choose forearm roll and elbow height
    and did: roll came out 43.9 degrees on the left against 138.6 on the right, which is a
    ninety degree corkscrew in opposite directions, and the elbow sat at 0.957 against a
    shoulder joint at 0.964 - the arm held out horizontally instead of hanging. Neither is
    a tuning problem, so no pole vector fixes it.

    Every joint is chosen here instead. The elbow comes from a closed-form two-link solve,
    each bone is aimed by building its orientation directly with world up as the roll
    reference, and the twist bones stay neutral. Runs after the figure is settled on the
    seat, because the settle shifts everything down and a target set before it means
    nothing after it.

    The legs and spine still come from build_assets.apply_seated_rest_pose. Only the arms
    are owned here.
    """
    from mathutils import Matrix, Quaternion, Vector

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault('RIVER_OUT', OUT)
    import build_assets

    reach, rail_height = build_assets.seated_rail_contact()
    # This is the rest pose the arms are posed AWAY from, not the character's original
    # bind: bake_seated_pose has already carried the meshes once, so the mesh and the rest
    # pose agree on a seated figure with the arms still hanging. Rotation away from here
    # is therefore exactly what this stage's skinning has to survive, and it is reported
    # below rather than described - the shoulder was called "about 75 degrees" on no
    # evidence at all.
    before = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}

    def turn(bone, rotation):
        """Rotate a bone about its own head, in armature space."""
        head = bone.matrix.translation.copy()
        matrix = bone.matrix.copy()
        matrix.translation = Vector((0.0, 0.0, 0.0))
        matrix = rotation @ matrix
        matrix.translation = head
        bone.matrix = matrix
        bpy.context.view_layer.update()

    def swing(bone, joint, destination):
        """Rotate `bone` about its head so that `joint` lands on `destination`.

        Aiming a bone's own Y axis at a target is not the same thing, because the joint
        that has to arrive is two bones further down the chain and the rest pose is not
        perfectly straight - upperarm01 and lowerarm01 each carry a twist bone before the
        next real joint. Aiming left the wrist 82mm out, and feeding that residual back
        made it worse rather than better, because moving the aim moves the whole solve.
        Rotating by the angle between where the joint IS and where it must GO is exact
        whatever the chain does in between.
        """
        head = bone.matrix.translation.copy()
        current = joint.matrix.translation - head
        wanted = destination - head
        if current.length < 1e-6 or wanted.length < 1e-6:
            return
        turn(bone, current.rotation_difference(wanted).to_matrix().to_4x4())

    def level_roll(bone, up=Vector((0.0, 0.0, 1.0))):
        """Roll a bone about its own length until its Z axis points as up as it can.

        This is the degree of freedom a position target cannot touch, and the one the
        twisted sleeves were made of: the solver had it at 43.9 degrees on one side and
        138.6 on the other."""
        axis = (bone.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
        current = bone.matrix.to_3x3() @ Vector((0.0, 0.0, 1.0))
        wanted = up - axis * up.dot(axis)
        if wanted.length < 1e-5:
            return
        wanted.normalize()
        current = (current - axis * current.dot(axis))
        if current.length < 1e-5:
            return
        current.normalize()
        angle = current.angle(wanted)
        if angle < 1e-5:
            return
        if current.cross(wanted).dot(axis) < 0:
            angle = -angle
        turn(bone, Matrix.Rotation(angle, 4, axis))

    report = []
    for side in ('L', 'R'):
        sign = 1.0 if side == 'L' else -1.0
        chain = [armature.pose.bones.get(name + side) for name in
                 ('upperarm01.', 'upperarm02.', 'lowerarm01.', 'lowerarm02.', 'wrist.')]
        if any(bone is None for bone in chain):
            raise SystemExit('FAIL: incomplete arm chain on side ' + side)
        upper, upper_twist, fore, fore_twist, wrist = chain
        girdle = [bone for bone in (armature.pose.bones.get('clavicle.' + side),
                                    armature.pose.bones.get('shoulder01.' + side))
                  if bone is not None]
        if not girdle:
            raise SystemExit('FAIL: no shoulder girdle bones on side ' + side)
        for bone in chain + girdle:
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()

        rest = armature.data.bones
        upper_len = (rest['lowerarm01.' + side].head_local
                     - rest['upperarm01.' + side].head_local).length
        fore_len = (rest['wrist.' + side].head_local
                    - rest['lowerarm01.' + side].head_local).length
        # Shoulder width, not clasped in the middle. At 0.11 the wrists met in front of
        # the sternum, which drags each upper arm hard across the body - the deltoid
        # collapsed into a lump and the sleeve creased, which is what a broken right arm
        # looked like up close. Forearms resting parallel on a rail is both what a player
        # does and what the skinning can take.
        target = Vector((sign * 0.21, -reach, rail_height))

        # Give the shoulder girdle its share of the rotation before the upper arm takes
        # the rest.
        #
        # Everything below this used to land on upperarm01 alone, with the clavicle and
        # shoulder01 left at zero. The skinning carry is exact - it agrees with Blender's
        # armature modifier to a micron - so the ballooned shoulder in the shipped build
        # is not an error in the deformation, it is linear blend skinning doing what it
        # honestly does when one joint is asked to swallow the whole rotation: the
        # vertices around that joint are averaged between two very different transforms
        # and the sleeve loses its shape.
        #
        # A real shoulder does not work that way either. The clavicle and the scapula
        # carry a meaningful share of any arm movement, and spreading the rotation over
        # three joints leaves each one with a smaller angle for its neighbourhood of
        # vertices to survive.
        aim = target - upper.matrix.translation
        have = fore.matrix.translation - upper.matrix.translation
        if aim.length > 1e-6 and have.length > 1e-6:
            full = have.rotation_difference(aim)
            for bone in girdle:
                turn(bone, Quaternion().slerp(full, GIRDLE_SHARE).to_matrix().to_4x4())

        # After the girdle has moved, because rotating the clavicle moves the shoulder
        # joint itself - solving from where it used to be would put the elbow in the
        # wrong place by exactly the distance the clavicle travelled.
        shoulder = upper.matrix.translation.copy()

        # Solve, look, correct. The two-link maths assumes the chain is exactly two rigid
        # segments, and it is not: upperarm01 and lowerarm01 each carry a twist bone
        # between them and the next joint, so the effective lengths differ slightly from
        # the head-to-head distances measured off the rest pose. Feeding the residual back
        # absorbs that instead of pretending it away - the first attempt landed 82mm out.
        adjusted = target.copy()
        landed = None
        for _ in range(6):
            span = (adjusted - shoulder)
            distance = min(span.length, (upper_len + fore_len) * 0.999)
            direction = span.normalized()
        # Law of cosines for the angle between the upper arm and the shoulder-to-wrist
        # line. Clamped because a target the arm cannot reach is a straight arm, not a
        # crash.
            cosine = ((upper_len ** 2 + distance ** 2 - fore_len ** 2)
                      / (2 * upper_len * distance))
            angle = math.acos(max(-1.0, min(1.0, cosine)))
            # The elbow swings below the shoulder-to-wrist line, which is where a resting
            # arm puts it. Choosing that side explicitly is what a pole vector kept
            # failing to do - it put the elbow level with the shoulder.
            # Down, and well clear of the ribs. At 0.38 outward the upper arms lay flat
            # against the torso and merged into it - on a turntable the arm and the jacket
            # body read as one mass with no separation between them, which is what "the
            # arms are broken" actually looked like. A seated player's elbows sit outside
            # the ribcage, not pinned to it.
            # Bracketed on the turntable rather than guessed. At 0.38 outward the upper
            # arms lay flat against the torso and merged into it - arm and jacket read as
            # one mass with no separation, which is what "the arms are broken" actually
            # looked like. At 1.05 the elbows winged out and rode up to 0.829. 0.66 keeps
            # them clear of the ribs and still hanging.
            down = Vector((sign * ELBOW_OUTWARD, -0.10, -1.0)).normalized()
            perpendicular = down - direction * down.dot(direction)
            if perpendicular.length < 1e-5:
                perpendicular = Vector((sign, 0.0, 0.0))
            perpendicular.normalize()
            elbow = (shoulder + direction * (upper_len * math.cos(angle))
                     + perpendicular * (upper_len * math.sin(angle)))

            for twist in (upper_twist, fore_twist):
                twist.rotation_euler = (0.0, 0.0, 0.0)
            bpy.context.view_layer.update()
            swing(upper, fore, elbow)
            # The upper arm's roll is exactly as free as the forearm's was, and nothing
            # constrained it: swing produces the minimal rotation that lands the elbow and
            # says nothing about the twist around it. That wrings the deltoid and the
            # sleeve across the shoulder blade, which is invisible from the front and from
            # both three-quarters and obvious from directly behind.
            level_roll(upper)
            swing(upper, fore, elbow)
            swing(fore, wrist, adjusted)
            level_roll(fore)
            # Rolling moves the joint below it slightly, so each swing is re-run once its
            # roll is set rather than the other way round.
            swing(fore, wrist, adjusted)

            landed = wrist.matrix.translation.copy()
            error = target - landed
            if error.length < 0.004:
                break
            adjusted = adjusted + error

        report.append((side, (landed - target).length, elbow.z, shoulder.z))

    # Here rather than in relax_hands, because the arm has only now stopped moving.
    # Levelling the palm before this ran turned the hands down in a pose the arm then
    # rotated 90 degrees out of, which put them back on edge.
    level_palm(armature)

    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # How far each joint actually had to rotate, now that the girdle shares it. This is
    # the number that governs how badly the sleeve around a joint deforms, and it was
    # never measured - the shoulder was described as "about 75 degrees" from nothing but
    # impression. Reported per bone so a regression shows up as a number rather than as a
    # lump somebody notices in a screenshot three rounds later.
    after_rest = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    worst_joint, worst_angle = None, 0.0
    for stem in ('clavicle.', 'shoulder01.', 'upperarm01.', 'lowerarm01.'):
        angles = []
        for side in ('L', 'R'):
            name = stem + side
            if name not in before or name not in after_rest:
                continue
            delta = (after_rest[name].to_3x3().to_quaternion()
                     .rotation_difference(before[name].to_3x3().to_quaternion()))
            # Take the short way round. A quaternion and its negation are the same
            # rotation, so Quaternion.angle reports anything up to 360 degrees and a
            # 92-degree forearm reads as 268. That number is wrong in the direction that
            # looks alarming rather than harmless, which is the worst kind to print.
            angles.append(math.degrees(2.0 * math.acos(min(1.0, abs(delta.w)))))
        if not angles:
            continue
        print('ROTATION %-12s L=%.1f R=%.1f degrees' % (stem.rstrip('.'), *angles))
        if max(angles) > worst_angle:
            worst_joint, worst_angle = stem.rstrip('.'), max(angles)
    print('ROTATION worst joint %s at %.1f degrees' % (worst_joint, worst_angle))

    travelled = _carry_meshes(armature, meshes, before)
    # Smoothing is deliberately light now. It was added to hide a shoulder crush that the
    # pose itself was causing, and at strength it shrank the sleeves - which made the arms
    # read as fused to the torso rather than resting beside it. With the elbows clear of
    # the ribs there is little left to hide, and hiding it was the wrong instinct anyway.
    for obj in meshes:
        if 'suit' in obj.name or 'body' in obj.name:
            relax_skinning(obj, travelled.get(obj.name), threshold=0.09, factor=0.2,
                           rounds=2)

    # Gate on all three, because each one has shipped broken while the other two looked
    # fine, and none of them was visible in anything the build printed.
    for side, error, elbow_z, shoulder_z in report:
        print('ARM %s wrist_error=%.4f elbow=%.3f shoulder=%.3f'
              % (side, error, elbow_z, shoulder_z))
        if error > 0.008:
            raise SystemExit('FAIL: %s wrist landed %.4f from the rail' % (side, error))
        if elbow_z >= shoulder_z:
            raise SystemExit('FAIL: %s elbow is not below the shoulder' % side)
    # Both segments, not just the forearm. Gating only the forearm passed a build whose
    # upper arm was wrung round at the shoulder, which showed as a twisted sleeve across
    # the shoulder blade from directly behind and from nowhere else.
    for bone_name in ('lowerarm01.', 'upperarm01.'):
        rolls = []
        for side in ('L', 'R'):
            axis = (armature.data.bones[bone_name + side].matrix_local.to_3x3()
                    @ Vector((1.0, 0.0, 0.0)))
            rolls.append(math.degrees(math.acos(max(-1.0, min(1.0, axis.normalized().z)))))
        print('ARM %-11s roll L=%.1f R=%.1f (90 is level)'
              % (bone_name.rstrip('.'), rolls[0], rolls[1]))
        if max(abs(roll - 90.0) for roll in rolls) > 22.0:
            raise SystemExit('FAIL: %s roll %.1f/%.1f is a twist, not a rest'
                             % (bone_name.rstrip('.'), rolls[0], rolls[1]))
        # Compare how far each side is from level, not the raw angles. The arms are
        # mirrored, so a symmetric pose reads as reflections about 90 - 97.5 against 82.4
        # is the same roll on both sides, and comparing the raw numbers called it a
        # 15-degree twist when the deviations were 7.5 and 7.6.
        if abs(abs(rolls[0] - 90.0) - abs(rolls[1] - 90.0)) > 8.0:
            raise SystemExit('FAIL: %s roll is asymmetric, %.1f against %.1f'
                             % (bone_name.rstrip('.'), rolls[0], rolls[1]))



def seat_on_chair(armature, meshes):
    """Put the folded figure back on the ground.

    The source origin is at the character's STANDING feet, because the human is built with
    feet_on_ground. Folding the legs rotates them about the hip, which moves the knees and
    feet but leaves the pelvis where it was - about 0.9m up. A seated pelvis belongs at
    roughly chair height, so the whole figure ends up hovering by the difference, and the
    venue then parents it at CHARACTER_SEAT_Z = 0.05 which is floor level, not seat level.

    Measured rather than assumed: the lowest vertex after folding is the shoe sole, so
    shifting everything until that sits at z=0 lands the feet on the floor and drops the
    pelvis to whatever height the pose actually implies.

    The armature's rest bones move by the same delta, or the skinning desynchronises from
    the mesh it deforms.
    """
    from mathutils import Vector

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault('RIVER_OUT', OUT)
    import build_assets

    # One frame, stated once, because getting it wrong cost a pass: the venue parents the
    # character at CHARACTER_SEAT_Z and scales by CHARACTER_SCALE, so a local height l
    # renders at CHARACTER_SEAT_Z + CHARACTER_SCALE * l. Local zero is therefore the
    # floor, and everything else in this file - the rail reach included - is measured
    # from it.
    soles = min((obj.matrix_world @ vertex.co).z
                for obj in meshes for vertex in obj.data.vertices)
    # Where the backside actually is. An earlier attempt built the group-index set across
    # every mesh at once, but group indices are per-mesh, so it matched nothing and
    # silently reported the soles instead. Indices are resolved per mesh here.
    buttocks = None
    for obj in meshes:
        names = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            if not any(names.get(group.group) in ('pelvis.L', 'pelvis.R', 'spine05')
                       and group.weight > 0.4 for group in vertex.groups):
                continue
            z = (obj.matrix_world @ vertex.co).z
            buttocks = z if buttocks is None else min(buttocks, z)
    pelvis = armature.data.bones['spine05'].head_local.copy()
    # Origin also centres on the pelvis horizontally. The venue puts the origin on the
    # seat position, and for a standing figure that is under the feet and under the hips
    # at once. Once the legs fold it is only under the feet, which perches him on the
    # front lip of the stool.
    # Close the last of the gap under him. Anchoring on the soles alone left the backside
    # 14mm clear of the pan, which is small but is exactly the difference between sitting
    # on a stool and hovering over one. The feet drop the same 14mm, which the sole
    # thickness absorbs and the table hides.
    seat_local = (build_assets.SEAT_H - build_assets.CHARACTER_SEAT_Z) \
        / build_assets.CHARACTER_SCALE
    gap = 0.0 if buttocks is None else max(0.0, (buttocks - soles) - seat_local)
    shift = Vector((-pelvis.x, -pelvis.y, -soles - gap))
    print('SEAT soles=%.3f buttocks=%s shift_z=%+.3f pelvis_after=%.3f seat_pan_at=%.3f'
          % (soles, 'none' if buttocks is None else '%.3f' % buttocks,
             shift.z, pelvis.z - soles, seat_local))
    if buttocks is not None:
        print('SEAT gap_above_pan=%+.3f (positive means hovering)'
              % ((buttocks - soles) - seat_local))
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertex.co += shift
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in armature.data.edit_bones:
        bone.head += shift
        bone.tail += shift
    bpy.ops.object.mode_set(mode='OBJECT')
    after = armature.data.bones['spine05'].head_local
    print('ANCHOR shift=(%+.4f, %+.4f, %+.4f) pelvis (%.3f, %.3f, %.3f) -> (%.3f, %.3f, %.3f)'
          % (shift.x, shift.y, shift.z, pelvis.x, pelvis.y, pelvis.z,
             after.x, after.y, after.z))


def author_motion_set(armature):
    """Put the clips on the rig here, after the seated pose has been baked into the rest.

    They used to be authored on the standing source, which was correct while the venue
    applied its own seated rest on import. It no longer does - the seated pose is baked
    into this GLB - so a clip authored against the standing rest would play its deltas
    from the wrong starting pose. Authoring last means a delta of zero is this character
    sitting at this table with his forearms on this rail.

    The definitions live in build_silver_animation so the motion set is described in one
    place and can still be previewed as contact sheets there.
    """
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_silver_animation as motion

    actions = []
    for name, spec in motion.CLIPS.items():
        action = motion.author_clip(armature, name, spec)
        action.use_fake_user = True
        actions.append(action)

    # Deliberately NOT pushed to NLA. Stacking all nine as simultaneously enabled tracks
    # means the exporter samples every clip with the others layered underneath it, and
    # ALLIN_standup holds its final pose rather than returning to rest - so spine01 and
    # head came out pinned to that hold in every other clip, including the idle. They
    # shipped as channels full of a constant, which is indistinguishable from a bone that
    # simply never moves. Exporting actions individually samples each one alone.
    armature.animation_data_create().action = None
    print('MOTION clips=%d (exported as individual actions)' % len(actions))
    return actions


def report_seated_geometry(armature, label):
    """Print where the seated skeleton actually is, against the furniture it sits at.

    Every seating defect so far survived because nothing measured the pose - it was
    judged by eye from cameras that could not see the failure, and each fix compensated
    for the last one. These are the numbers that decide whether a character is sitting:
    hips on the seat, knees bent, feet down, forearms on the rail.
    """
    from mathutils import Vector

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault('RIVER_OUT', OUT)
    import build_assets

    def world(bone_name):
        bone = armature.data.bones.get(bone_name)
        if bone is None:
            return None
        head = bone.head_local
        return (build_assets.CHARACTER_SEAT_Z
                + build_assets.CHARACTER_SCALE * head.z,
                build_assets.CHARACTER_SCALE * head.y)

    joints = ('spine05', 'upperleg01.L', 'lowerleg01.L', 'foot.L',
              'shoulder01.L', 'upperarm01.L', 'upperarm02.L',
              'lowerarm01.L', 'lowerarm02.L', 'wrist.L', 'head')
    print('GEOMETRY %s  (world z, forward y)' % label)
    for name in joints:
        place = world(name)
        if place is None:
            continue
        print('  %-14s z=%.3f  y=%+.3f' % (name, place[0], place[1]))
    rail_top = build_assets.TABLE_TOP + build_assets.RAIL_T
    print('  targets        seat=%.3f rail=%.3f floor=0.000'
          % (build_assets.SEAT_H, rail_top))
    # Forearm roll is the degree of freedom an IK target cannot pin, and it is the one a
    # twisted sleeve is made of. Reported as the angle between the forearm's own X axis
    # and world up: near 90 means the palm faces down, which is what resting on a rail
    # looks like. Anything far from that is a corkscrew no wrist position will reveal.
    for side in ('L', 'R'):
        bone = armature.data.bones.get('lowerarm01.' + side)
        if bone is None:
            continue
        axis = bone.matrix_local.to_3x3() @ Vector((1.0, 0.0, 0.0))
        roll = math.degrees(math.acos(max(-1.0, min(1.0, axis.normalized().z))))
        print('  forearm %s roll_from_up=%.1f deg' % (side, roll))


def reduce_body(obj, ratio):
    modifier = obj.modifiers.new('river_silver_decimate', 'DECIMATE')
    modifier.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


# Only the suit diffuse earns a full 1024: it is the one map carrying information the
# silhouette cannot - the white shirt, the black tie and the satin/barathea split. The
# roughness map is three flat values, so it costs nothing to store small.
TEXTURE_BUDGET = (
    ('river_silver_suit_diffuse', 1024),
    ('river_silver_suit_roughness', 256),
    ('short02_diffuse', 512),
    ('middleage_lightskinned_male_diffuse', 512),
)
TEXTURE_DEFAULT = 512


def limit_texture_dimensions(objects):
    seen = set()
    for obj in objects:
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            material = slot.material
            if material is None or not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type != 'TEX_IMAGE' or node.image is None:
                    continue
                image = node.image
                if image.name in seen:
                    continue
                seen.add(image.name)
                maximum = next(
                    (size for token, size in TEXTURE_BUDGET if token in image.name),
                    TEXTURE_DEFAULT,
                )
                width, height = image.size
                if max(width, height) <= maximum:
                    continue
                scale = maximum / float(max(width, height))
                image.scale(max(1, int(width * scale)), max(1, int(height * scale)))
                print('TEXTURE %s -> %dx%d' % (image.name, *image.size))


def merge_skin_materials(obj):
    """Collapse the MakeHuman body's split slots to skin plus lips.

    The body ships a slot per face region. Each one is a separate material in the venue
    GLB and the Rooftop build has a hard budget of 30 for the whole scene.
    """
    materials = list(obj.data.materials)
    skin_index = next(
        (i for i, m in enumerate(materials)
         if m and m.name.lower().endswith('.body')), 0)
    lips_index = next(
        (i for i, m in enumerate(materials)
         if m and m.name.lower().endswith('.lips')), skin_index)
    skin, lips = materials[skin_index], materials[lips_index]
    for polygon in obj.data.polygons:
        polygon.material_index = (
            1 if polygon.material_index == lips_index and lips is not skin else 0)
    obj.data.materials.clear()
    obj.data.materials.append(skin)
    if lips is not skin:
        obj.data.materials.append(lips)
    print('MERGED body materials %d -> %d' % (len(materials), len(obj.data.materials)))


def flatten_material(name, colour, roughness, specular, *objects):
    """Replace textured materials with one shared flat one.

    Brows, lashes and patent shoes carry textures whose only real content is a colour and
    a cutout. At table distance the texture buys nothing and costs both a material slot
    and its share of the download budget.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*colour, 1.0)
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Specular IOR Level'].default_value = specular
    for obj in objects:
        if obj is None:
            continue
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return material


def main():
    if not os.path.exists(SOURCE):
        raise SystemExit('FAIL: missing silver source ' + SOURCE
                         + ' (run build_native_silver_proof.py first)')
    bpy.ops.wm.open_mainfile(filepath=SOURCE)

    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for modifier in obj.modifiers:
            modifier.show_viewport = modifier.show_render

    body = bpy.data.objects.get('river_native_silver_body')
    if body is None:
        raise SystemExit('FAIL: silver source has no body')
    armature = next(
        (m.object for m in body.modifiers
         if m.type == 'ARMATURE' and m.object is not None),
        None,
    )
    if armature is None:
        raise SystemExit('FAIL: silver body has no armature')

    meshes = [obj for obj in bpy.data.objects
              if obj.type == 'MESH' and obj.name.startswith('river_')]
    baked = sum(bake_shape_keys(obj) for obj in meshes)
    print('BAKED shape_keys=%d across %d meshes' % (baked, len(meshes)))

    before = len(body.data.vertices)
    # Before the masks are applied, because after that the vertices are gone.
    keep_forearm_inside_cuffs(body, armature)
    for obj in meshes:
        apply_non_armature_modifiers(obj)
    # After the modifiers, so the weights being smoothed belong to the vertices that
    # actually ship rather than to helper geometry that is about to be masked away.
    smooth_shoulder_weights(next(obj for obj in meshes if 'suit' in obj.name), armature)
    # How many of the freed vertices actually survived. Most of the first attempt's were
    # helper geometry that the helper mask removed anyway, so the delete group reported
    # 96 vertices released and the body grew by 14 - one ring, which does not fill a cuff.
    print('CUFFS body kept %d more vertices than the suit asked to delete'
          % (len(body.data.vertices) - CUFFLESS_BODY_VERTICES))
    bake_seated_pose(armature, meshes)
    print('HELPERS body vertices %d -> %d' % (before, len(body.data.vertices)))
    if len(body.data.vertices) >= before:
        raise SystemExit('FAIL: no helper geometry was masked away, so the proxy strips '
                         'would ship into the venue')

    # Decimation is a last resort, not a routine step. Masking the helper geometry away
    # already halves the body, and this is the hero character - spend the headroom on it
    # rather than throwing away resolution to hit a number it is already under.
    body.data.calc_loop_triangles()
    body_triangles = len(body.data.loop_triangles)
    if body_triangles > BODY_TRIANGLE_CEILING:
        ratio = (BODY_TRIANGLE_CEILING * 0.95) / float(body_triangles)
        body_triangles = reduce_body(body, ratio)
        print('REDUCED body to %d triangles at ratio %.3f' % (body_triangles, ratio))
    if body_triangles > BODY_TRIANGLE_CEILING:
        raise SystemExit('FAIL: silver body %d triangles over the %d ceiling'
                         % (body_triangles, BODY_TRIANGLE_CEILING))
    print('BODY triangles=%d ceiling=%d' % (body_triangles, BODY_TRIANGLE_CEILING))

    merge_skin_materials(body)
    lookup = {obj.name.removeprefix('river_silver_'): obj for obj in meshes}
    # Rename rather than hope: MASK is selected by material name, and the stock hair
    # material is "Human.short02", which matches no sensible token.
    hair = lookup.get('hair')
    if hair is None or not hair.data.materials:
        raise SystemExit('FAIL: silver source has no hair material to mask')
    hair.data.materials[0].name = 'native_silver_hair'
    flatten_material('native_silver_face_detail', (0.030, 0.020, 0.014), 0.62, 0.08,
                     lookup.get('eyebrows'), lookup.get('eyelashes'))
    flatten_material('native_silver_patent', (0.022, 0.022, 0.026), 0.20, 0.60,
                     lookup.get('shoes'))

    # See the module docstring: these names are the gold importer's contract, not a claim
    # that this character is the gold one.
    body.data.name = 'char_native_gold_body_silver'
    for obj in meshes:
        suffix = obj.name.removeprefix('river_silver_').removeprefix('river_native_silver_')
        obj.name = 'river_native_gold_silver_' + suffix

    exported = [*meshes, armature]
    limit_texture_dimensions(exported)
    for obj in exported:
        obj['nativeGold'] = True
        obj['riverCharacter'] = 'silver'
        # Tells the venue importer the seated pose is already in this asset's rest pose
        # and mesh, so it must not run its own seated pass over the top. That pass poses
        # spine01, spine02 and head and then calls armature_apply, which bakes over the
        # animation channels of exactly the bones it touches - the head and spine01
        # arrived in the venue with 151 keyframes flattened to 2 constant ones.
        obj['riverSeatedBaked'] = True

    bpy.ops.object.select_all(action='DESELECT')
    for obj in exported:
        obj.hide_render = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body

    author_motion_set(armature)

    os.makedirs(os.path.dirname(GLB), exist_ok=True)
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
    normalise_alpha_modes(GLB)

    gltf = glb_json(GLB)
    skins = gltf.get('skins', [])
    if not skins or max(len(skin.get('joints', [])) for skin in skins) < 60:
        raise SystemExit('FAIL: silver GLB lost its rig')
    bones = max(len(skin.get('joints', [])) for skin in skins)
    # The runtime treats a missing clip as a build error rather than a silent no-op, so
    # the export checks the same contract here rather than letting the venue discover it.
    import build_silver_animation as motion

    shipped = {animation.get('name') for animation in gltf.get('animations', [])}
    missing = sorted(set(motion.CLIPS) - shipped)
    if missing:
        raise SystemExit('FAIL: silver GLB is missing clips: ' + ', '.join(missing))
    print('NATIVE_GLTF %s bytes=%d meshes=%d body_triangles=%d bones=%d clips=%d' % (
        GLB, os.path.getsize(GLB), len(gltf.get('meshes', [])), body_triangles, bones,
        len(shipped)))


if __name__ == '__main__':
    main()

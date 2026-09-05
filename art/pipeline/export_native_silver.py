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
            # cap, and leaves a pale band of scalp along the forehead. 0.28 keeps them.
            material['alphaCutoff'] = 0.28
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
RELAXED_FINGER_CURL = (10.0, 14.0, 10.0)
# Finger bones point along local +Y, so flexion is rotation about local X - which is right
# for the four fingers and wrong for the thumb. The thumb's rest frame is rolled about
# ninety degrees against the others, so the same X rotation swings it ACROSS the palm to
# meet the index tip. Rendered, that is an "OK" sign on a man waiting for cards. The thumb
# therefore stays nearly straight and takes its small bend on Z.
RELAXED_THUMB_CURL = ((3.0, 0.0, 6.0), (4.0, 0.0, 5.0), (4.0, 0.0, 0.0))
# The seated rest twists the wrist by 55 degrees, which supinates the palm until it faces
# up like an offering. Pronating to 18 lays the palm toward the rail while keeping the
# forearm roll the seated arm pose depends on.
RELAXED_WRIST = (8.0, 0.0, 18.0)


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
                math.radians(-sign * RELAXED_WRIST[2]),
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
    build_assets.apply_seated_rest_pose(armature)
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
    from mathutils import Vector

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
                vertex.co = accumulated / weight_total
    return transforms


def reach_to_rail(armature, meshes):
    """Put the wrists on the rail, in final coordinates.

    This has to run AFTER the figure is settled onto the seat. The seated pose sets its
    wrist IK target in the pre-settle frame, and the settle then shifts everything down by
    the better part of half a metre - which dragged the hands the same distance below the
    rail and left the arms hanging between his knees. Reaching once the origin has stopped
    moving is the only way the target means what it says.
    """
    from mathutils import Vector

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault('RIVER_OUT', OUT)
    import build_assets

    reach, rail_height = build_assets.seated_rail_contact()

    before = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    items = []
    wanted = {}
    for side in ('L', 'R'):
        sign = 1.0 if side == 'L' else -1.0
        # The chain ends on the wrist, not the forearm. An IK constraint drives the TAIL
        # of the bone it sits on, so a chain rooted at lowerarm01 controls the forearm's
        # end and leaves the wrist hanging two bones further down, outside the solve. The
        # correction loop then pushed the target forever against a residual it could not
        # move: the solver was never steering the joint being measured.
        forearm = armature.pose.bones.get('wrist.' + side)
        if forearm is None:
            continue
        target = bpy.data.objects.new('rail_wrist.' + side, None)
        pole = bpy.data.objects.new('rail_elbow.' + side, None)
        bpy.context.scene.collection.objects.link(target)
        bpy.context.scene.collection.objects.link(pole)
        wanted[side] = Vector((sign * 0.11, -reach, rail_height))
        target.location = armature.matrix_world @ wanted[side]
        # Pole BELOW the shoulder-to-wrist line, so the elbow hangs and points down and
        # out the way a resting arm does. It was above, which lifted the elbow over the
        # rail and left the forearm sloping down into it - the wrist finished 76mm under
        # the rail top and the character read as gripping the table edge.
        pole.location = armature.matrix_world @ Vector(
            (sign * 0.46, -reach * 0.20, rail_height - 0.30))
        constraint = forearm.constraints.new('IK')
        constraint.target = target
        constraint.pole_target = pole
        # wrist, lowerarm02, lowerarm01, upperarm02, upperarm01 - the whole arm below the
        # shoulder blade, so reaching forward rotates the upper arm instead of only
        # unfolding the elbow.
        constraint.chain_count = 5
        items.append((forearm, constraint, target, pole))
    if len(items) != 2:
        raise SystemExit('FAIL: could not build a rail IK chain for both arms')

    # Solve, measure, correct, repeat. An IK chain lands where the joint limits and the
    # pole let it, not where the target is, and the previous pass simply assumed the two
    # were the same - the wrists finished 76mm low and nothing said so. Feeding the
    # residual back into the target converges in a couple of rounds and, more importantly,
    # fails loudly when it cannot.
    solved = {}
    for attempt in range(8):
        bpy.context.view_layer.update()
        worst = 0.0
        for side in ('L', 'R'):
            wrist = armature.pose.bones.get('wrist.' + side)
            target = next(t for f, c, t, p in items if f.name.endswith(side))
            achieved = wrist.matrix.translation
            error = wanted[side] - achieved
            solved[side] = achieved.copy()
            worst = max(worst, error.length)
            target.location = target.location + (armature.matrix_world.to_3x3() @ error)
        if worst < 0.004:
            print('RAIL converged attempt=%d residual=%.4f' % (attempt, worst))
            break
    else:
        raise SystemExit('FAIL: rail IK did not converge, residual %.4f' % worst)

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    bpy.ops.object.mode_set(mode='OBJECT')
    for forearm, constraint, target, pole in items:
        forearm.constraints.remove(constraint)
        bpy.data.objects.remove(target, do_unlink=True)
        bpy.data.objects.remove(pole, do_unlink=True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    _carry_meshes(armature, meshes, before)
    wrist = armature.data.bones['wrist.L'].head_local.z
    print('RAIL reach=%.3f height=%.3f wrist_local=%.3f world=%.3f'
          % (reach, rail_height, wrist,
             build_assets.SEAT_H + build_assets.CHARACTER_SCALE * wrist))


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
    pelvis = armature.data.bones['spine05'].head_local.copy()
    # Origin also centres on the pelvis horizontally. The venue puts the origin on the
    # seat position, and for a standing figure that is under the feet and under the hips
    # at once. Once the legs fold it is only under the feet, which perches him on the
    # front lip of the stool.
    shift = Vector((-pelvis.x, -pelvis.y, -soles))
    seat_local = (build_assets.SEAT_H - build_assets.CHARACTER_SEAT_Z) \
        / build_assets.CHARACTER_SCALE
    print('SEAT soles=%.3f shift_z=%+.3f pelvis_after=%.3f seat_pan_at=%.3f'
          % (soles, shift.z, pelvis.z - soles, seat_local))
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


def report_seated_geometry(armature, label):
    """Print where the seated skeleton actually is, against the furniture it sits at.

    Every seating defect so far survived because nothing measured the pose - it was
    judged by eye from cameras that could not see the failure, and each fix compensated
    for the last one. These are the numbers that decide whether a character is sitting:
    hips on the seat, knees bent, feet down, forearms on the rail.
    """
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
              'shoulder01.L', 'lowerarm01.L', 'wrist.L', 'head')
    print('GEOMETRY %s  (world z, forward y)' % label)
    for name in joints:
        place = world(name)
        if place is None:
            continue
        print('  %-14s z=%.3f  y=%+.3f' % (name, place[0], place[1]))
    rail_top = build_assets.TABLE_TOP + build_assets.RAIL_T
    print('  targets        seat=%.3f rail=%.3f floor=0.000'
          % (build_assets.SEAT_H, rail_top))


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
    for obj in meshes:
        apply_non_armature_modifiers(obj)
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

    bpy.ops.object.select_all(action='DESELECT')
    for obj in exported:
        obj.hide_render = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body

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
        export_animations=False,
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
    print('NATIVE_GLTF %s bytes=%d meshes=%d body_triangles=%d bones=%d' % (
        GLB, os.path.getsize(GLB), len(gltf.get('meshes', [])), body_triangles, bones))


if __name__ == '__main__':
    main()

"""Give Silver's outfit a 'standing' shape key: on while he stands, off while he sits.

Every garment was fitted in the seated rest, so standing unbends it by linear skinning: the
jacket skirt and the trouser crotch bunch into a pouch at the hips and the back gathers into
lumps. The accepted A11 standing suit shares the outfit's topology and skeleton, and posed
into the all-in hold it hangs as a standing suit should at the hips, the skirt, the back and
the upper arms. Posed that far from its own rest it is not right everywhere, though: its
sleeves twist to a point at the wrist and its jacket crumples under the lapels. So the
standing shape is a blend, vertex by vertex, of the two:

    standing = seated fit skinned + share * (A11 posed - seated fit skinned)

with the share read from the bones a vertex follows (STANDING_SHARE): all of A11 on the hips,
the legs, the lower spine and the upper arms, none on the chest, the neck and the hands, and
eased along the forearm from the elbow to the wrist. Both shapes are the same mesh in the same
pose, so every share between them is the same garment.

The silk facings and the button ride on the jacket instead: bound to it as they sit in the
seated fit skinned to the hold, then carried by the jacket onto its standing shape, so the fit
between them survives. A11's own facings would be pierced by its jacket in this pose.

Each target is moved back to rest through the candidate's own skin at the hold and stored as a
key relative to the mesh's current key mix, so value 1 reproduces the target exactly there and
the mix's own keys are cancelled while he stands. The candidate is then posed with every key on
and compared against the targets; past TOLERANCE_M the run fails. The exporter drives the key
from the pelvis's lift off the seat, and refuses a Silver candidate without it
(export_silver_integration.STANDING). In the file a driver does the same, so the all-in, the
sit and the leave play in Blender as they ship.

A11 comes from art/source/native-silver/a11-standing-outfit, written by
extract_a11_standing_outfit.py. Re-run this whenever the all-in hold changes.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/add_silver_standing_shapes.py -- \\
      --candidate <silver integration candidate .blend> \\
      --a11-outfit art/source/native-silver/a11-standing-outfit/a11-standing-outfit.npz \\
      --output <out .blend> --report <report .json>
"""
import argparse
import hashlib
import importlib.util
import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from public_save import save_public  # noqa: E402

# The key, the pose it is exact at, the outfit and the seat band are the exporter's, so the two
# cannot disagree about what ships.
_spec = importlib.util.spec_from_file_location(
    'export_silver_integration', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'export_silver_integration.py'))
exporter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(exporter)
RIG = exporter.RIG
KEY = exporter.STANDING['key']
CLIP, FRAME = exporter.STANDING['capture']
IDLE, IDLE_FRAME = exporter.IDLE_CAPTURE
JACKET = 'A11 tailored dinner jacket'
ON_JACKET = ('A11 fitted silk facing L', 'A11 fitted silk facing R', 'A11 jacket button')
TOLERANCE_M = 1e-4
# How much of A11's standing shape a vertex takes, by the bones it follows (side suffix dropped).
# Bones not named here - the chest, the neck, the head and the hands - take none of it.
STANDING_SHARE = {
    'root': 1.0, 'pelvis': 1.0, 'upperleg01': 1.0, 'upperleg02': 1.0, 'lowerleg01': 1.0,
    'lowerleg02': 1.0, 'foot': 1.0, 'toe1-1': 1.0,
    'spine05': 1.0, 'spine04': 1.0, 'spine03': 0.5,
    'shoulder01': 0.5, 'upperarm01': 1.0, 'upperarm02': 1.0,
}
# Forearm bones take all of A11 at the elbow and none of it from this far along to the wrist on.
FOREARM = ('lowerarm01', 'lowerarm02', 'wrist')
FOREARM_EASE = (0.1, 0.6)


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--a11-outfit', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    return parser.parse_args(argv)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def assign_clip(rig, clip, frame):
    action = bpy.data.actions[clip]
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def armature_only(obj, enabled):
    """Switch every modifier but the armature off, or back to how it was."""
    if enabled:
        obj['_saved'] = [m.show_viewport for m in obj.modifiers]
        for m in obj.modifiers:
            m.show_viewport = m.type == 'ARMATURE'
    else:
        for m, was in zip(obj.modifiers, obj['_saved']):
            m.show_viewport = was
        del obj['_saved']
    bpy.context.view_layer.update()


def posed_world(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    matrix = np.array(evaluated.matrix_world)
    evaluated.to_mesh_clear()
    return co.reshape(-1, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]


def a11_posed(outfit, i, pose, rig_world):
    """A11's mesh i in the candidate's pose, in world space, by the same blend Blender uses."""
    bones = [str(name) for name in outfit['bones']]
    deform = np.array([pose[name] @ np.linalg.inv(outfit['bone_rest'][b]) for b, name in enumerate(bones)])
    rest, vertex, bone, weight = (outfit['%d_%s' % (i, part)] for part in ('rest', 'vertex', 'bone', 'weight'))
    moved = np.einsum('vij,vj->vi', deform[bone][:, :3, :3], rest[vertex]) + deform[bone][:, :3, 3]
    total = np.zeros(len(rest))
    np.add.at(total, vertex, weight)
    posed = np.zeros_like(rest)
    np.add.at(posed, vertex, moved * weight[:, None])
    posed /= total[:, None]
    return posed @ rig_world[:3, :3].T + rig_world[:3, 3]


def skin_weights(obj, rig):
    """Each vertex's weights on the deforming bones, normalised as Blender's armature does."""
    names = [bone.name for bone in rig.data.bones if bone.use_deform]
    column = {name: c for c, name in enumerate(names)}
    weights = np.zeros((len(obj.data.vertices), len(names)))
    for v in obj.data.vertices:
        for g in v.groups:
            name = obj.vertex_groups[g.group].name
            if name in column and g.weight > 0.0:
                weights[v.index, column[name]] += g.weight
    total = weights.sum(axis=1)
    if (total <= 1e-4).any():
        raise SystemExit('FAIL: %s has %d vertices with no deforming weight' % (obj.name, int((total <= 1e-4).sum())))
    return names, weights / total[:, None]


def key_mix(obj):
    """The mesh's rest shape as its current keys mix it, and its basis."""
    count = len(obj.data.vertices)
    keys = obj.data.shape_keys.key_blocks
    basis = np.empty(count * 3, dtype=np.float32)
    keys[0].data.foreach_get('co', basis)
    basis = basis.reshape(-1, 3).astype(np.float64)
    mix = basis.copy()
    for block in keys[1:]:
        if block.mute or block.value == 0.0:
            continue
        data = np.empty(count * 3, dtype=np.float32)
        block.data.foreach_get('co', data)
        mix += block.value * (data.reshape(-1, 3) - basis)
    return basis, mix


def standing_share(rig, names, weights, rest_rig):
    """Per vertex, how much of A11 it takes: the weighted share of the bones it follows."""
    share = np.zeros(len(weights))
    for c, name in enumerate(names):
        column = weights[:, c]
        if not column.any():
            continue
        stem, _, side = name.rpartition('.')
        stem = stem or name
        if stem in FOREARM:
            elbow = np.array(rig.data.bones['lowerarm01.' + side].head_local)
            wrist = np.array(rig.data.bones['wrist.' + side].head_local)
            axis = wrist - elbow
            t = (rest_rig - elbow) @ axis / axis.dot(axis)
            share += column * (1.0 - smoothstep(FOREARM_EASE[0], FOREARM_EASE[1], t))
        else:
            share += column * STANDING_SHARE.get(stem, 0.0)
    return share


def unskin(obj, rig, names, weights, pose, points_world):
    """Move posed world points back to rest through the mesh's blended skin at the hold."""
    to_object = np.linalg.inv(np.array(obj.matrix_world))
    rig_world = np.array(rig.matrix_world)
    frame = to_object @ rig_world
    back = np.linalg.inv(rig_world) @ np.array(obj.matrix_world)
    skins = np.array([frame @ pose[name] @ np.linalg.inv(np.array(rig.data.bones[name].matrix_local)) @ back
                      for name in names])
    blend = (weights @ skins.reshape(len(names), 16)).reshape(-1, 4, 4)
    local = points_world @ to_object[:3, :3].T + to_object[:3, 3]
    homogeneous = np.concatenate([local, np.ones((len(local), 1))], axis=1)
    return np.einsum('vij,vj->vi', np.linalg.inv(blend), homogeneous)[:, :3]


def ride_on_jacket(piece, jacket):
    """The piece carried by the jacket from its seated fit skinned to the hold onto its standing shape."""
    jacket_key = jacket.data.shape_keys.key_blocks[KEY]
    jacket_key.value = 0.0
    armature_only(jacket, True)
    armature_only(piece, True)
    ride = piece.modifiers.new('ride on jacket', 'SURFACE_DEFORM')
    ride.target = jacket
    bpy.context.view_layer.update()
    with bpy.context.temp_override(object=piece, active_object=piece):
        bpy.ops.object.surfacedeform_bind(modifier=ride.name)
    bpy.context.view_layer.update()
    if not ride.is_bound:
        raise SystemExit('FAIL: %s could not be bound to the jacket' % piece.name)
    jacket_key.value = 1.0
    bpy.context.view_layer.update()
    carried = posed_world(piece)
    jacket_key.value = 0.0
    piece.modifiers.remove(ride)
    armature_only(piece, False)
    armature_only(jacket, False)
    return carried


def main():
    args = arguments()
    candidate = os.path.abspath(args.candidate)
    outfit_path = os.path.abspath(args.a11_outfit)
    outfit = np.load(outfit_path, allow_pickle=False)
    meshes = [str(name) for name in outfit['meshes']]
    if meshes[0] != JACKET:
        raise SystemExit('FAIL: the jacket must come first; the pieces riding on it need its key')
    if sorted(meshes) != sorted(exporter.STANDING_OUTFIT):
        raise SystemExit('FAIL: the A11 data covers %s, the exporter ships %s' % (meshes, exporter.STANDING_OUTFIT))

    bpy.ops.wm.open_mainfile(filepath=candidate, load_ui=False)
    scene = bpy.context.scene
    rig = bpy.data.objects[RIG]
    saved_action = rig.animation_data.action
    saved_slot = rig.animation_data.action_slot
    saved_frame = scene.frame_current
    assign_clip(rig, CLIP, FRAME)
    pose = {bone.name: np.array(bone.matrix) for bone in rig.pose.bones}
    rig_world = np.array(rig.matrix_world)
    rig_inverse = np.linalg.inv(rig_world)

    report = {'candidate': os.path.basename(candidate), 'candidateSha256': sha256_file(candidate),
              'a11Outfit': os.path.basename(outfit_path), 'a11OutfitSha256': sha256_file(outfit_path),
              'capture': [CLIP, FRAME], 'standingShare': STANDING_SHARE, 'forearm': list(FOREARM),
              'forearmEase': list(FOREARM_EASE), 'meshes': {}}
    targets = {}
    for i, name in enumerate(meshes):
        obj = bpy.data.objects[name]
        if len(obj.data.vertices) != len(outfit['%d_rest' % i]):
            raise SystemExit('FAIL: %s has %d vertices, A11 has %d' % (name, len(obj.data.vertices),
                                                                         len(outfit['%d_rest' % i])))
        modifier = next(m for m in obj.modifiers if m.type == 'ARMATURE')
        if modifier.use_deform_preserve_volume or modifier.use_bone_envelopes or modifier.use_multi_modifier:
            raise SystemExit('FAIL: %s deforms in a way a linear inverse would get wrong' % name)
        if obj.data.shape_keys is None:
            obj.shape_key_add(name='Basis', from_mix=False)
        keys = obj.data.shape_keys
        if keys.animation_data is not None:
            # A driver left from an earlier run would follow the new key by name and hold it on
            # through the binding below; any other driven key would make the mix pose-dependent.
            for curve in list(keys.animation_data.drivers):
                if curve.data_path != 'key_blocks["%s"].value' % KEY:
                    raise SystemExit('FAIL: %s has a driven key (%s); the rest mix would not be fixed'
                                     % (name, curve.data_path))
                keys.animation_data.drivers.remove(curve)
        old = keys.key_blocks.get(KEY)
        if old is not None:
            obj.shape_key_remove(old)
        bpy.context.view_layer.update()
        armature_only(obj, True)
        seated = posed_world(obj)
        armature_only(obj, False)
        a11 = a11_posed(outfit, i, pose, rig_world)
        names, weights = skin_weights(obj, rig)
        basis, mix = key_mix(obj)
        entry = {'vertices': len(mix), 'a11FromSeatedMaxMm': float(np.linalg.norm(a11 - seated, axis=1).max()) * 1000}
        if name in ON_JACKET:
            target = ride_on_jacket(obj, bpy.data.objects[JACKET])
            entry['share'] = 'rides on the jacket'
        else:
            mix_world = mix @ np.array(obj.matrix_world)[:3, :3].T + np.array(obj.matrix_world)[:3, 3]
            share = standing_share(rig, names, weights, mix_world @ rig_inverse[:3, :3].T + rig_inverse[:3, 3])
            target = seated + share[:, None] * (a11 - seated)
            entry['share'] = {'all': int((share > 0.999).sum()), 'none': int((share < 0.001).sum()),
                              'between': int(((share >= 0.001) & (share <= 0.999)).sum())}
        rest = unskin(obj, rig, names, weights, pose, target)
        key = obj.shape_key_add(name=KEY, from_mix=False)
        key.data.foreach_set('co', (basis + rest - mix).astype(np.float32).ravel())
        key.value = 0.0
        targets[name] = target
        entry['restMoveMaxMm'] = float(np.linalg.norm(rest - mix, axis=1).max()) * 1000
        entry['targetFromSeatedMaxMm'] = float(np.linalg.norm(target - seated, axis=1).max()) * 1000
        report['meshes'][name] = entry

    # Every key on at the hold must land exactly on its target.
    worst = 0.0
    for name in meshes:
        obj = bpy.data.objects[name]
        obj.data.shape_keys.key_blocks[KEY].value = 1.0
    bpy.context.view_layer.update()
    for name in meshes:
        obj = bpy.data.objects[name]
        armature_only(obj, True)
        error = float(np.linalg.norm(posed_world(obj) - targets[name], axis=1).max())
        armature_only(obj, False)
        report['meshes'][name]['checkErrorM'] = error
        worst = max(worst, error)
        entry = report['meshes'][name]
        print('STANDING %-32s rest moves up to %6.1f mm, target %6.1f mm from the seated fit, check %.2e m'
              % (name, entry['restMoveMaxMm'], entry['targetFromSeatedMaxMm'], error))
    for name in meshes:
        bpy.data.objects[name].data.shape_keys.key_blocks[KEY].value = 0.0
    if worst > TOLERANCE_M:
        raise SystemExit('FAIL: a standing key misses its target by %.2e m' % worst)

    # So the file plays in Blender as the build ships it, each key follows the pelvis's lift off
    # the seat through the exporter's band. The exporter removes these before it samples.
    assign_clip(rig, IDLE, IDLE_FRAME)
    seated_z = (rig.matrix_world @ rig.pose.bones['root'].head).z
    low, high = seated_z + exporter.SEAT_ON_MM / 1000.0, seated_z + exporter.SEAT_OFF_MM / 1000.0
    for name in meshes:
        driver = bpy.data.objects[name].data.shape_keys.key_blocks[KEY].driver_add('value').driver
        driver.type = 'SCRIPTED'
        lift = driver.variables.new()
        lift.name = 'pelvis'
        lift.type = 'TRANSFORMS'
        lift.targets[0].id = rig
        lift.targets[0].bone_target = 'root'
        lift.targets[0].transform_type = 'LOC_Z'
        lift.targets[0].transform_space = 'WORLD_SPACE'
        driver.expression = 'smoothstep(%.6f, %.6f, pelvis)' % (low, high)
        if not driver.is_simple_expression:
            raise SystemExit('FAIL: the standing driver would need Python auto-run to play')
    played = {}
    for frame in (0, FRAME):
        assign_clip(rig, CLIP, frame)
        played[frame] = bpy.data.objects[JACKET].data.shape_keys.key_blocks[KEY].value
    if played[0] > 1e-6 or played[FRAME] < 1.0 - 1e-6:
        raise SystemExit('FAIL: the standing driver plays %s, expected 0 seated and 1 at the hold' % played)
    report['driver'] = {'seatedRootZ': seated_z, 'band': [low, high], 'played': played}

    rig.animation_data.action = saved_action
    if saved_action is not None and saved_slot is not None:
        rig.animation_data.action_slot = saved_slot
    scene.frame_set(saved_frame)
    bpy.context.view_layer.update()
    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    save_public(output)
    report['output'] = os.path.basename(output)
    report['outputSha256'] = sha256_file(output)
    report['worstCheckErrorM'] = worst
    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2)
        handle.write('\n')
    print('SILVER STANDING PASS %s' % output)


main()

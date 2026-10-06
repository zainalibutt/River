"""Keep the accepted A11 standing suit as data the Silver build can pose.

A11 is the black-tie Silver accepted standing, and its outfit meshes share their topology and
skeleton with the shipping Silver, so posed into a standing frame of a Silver clip A11 shows
how that suit should hang there. The A11 file itself lives among the git-ignored proofs, so
the build keeps what it needs from it instead: each outfit mesh at rest in the rig's space,
its weights on the deforming bones, and each bone's rest matrix. That is enough to pose the
suit exactly as Blender's armature would, with nothing else from the file.

The written data is checked before it is trusted: A11's rig is put in a test pose that turns
every deforming bone, each outfit mesh is evaluated by Blender through its armature alone,
and the same pose is applied to the extracted arrays. Past 1e-6 m anywhere the run fails.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/extract_a11_standing_outfit.py -- \\
      --a11 <a11-silver-black-tie-final.blend> \\
      --out art/source/native-silver/a11-standing-outfit/a11-standing-outfit.npz
"""
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

RIG = 'river_native_silver_body.rig'
OUTFIT = ('A11 tailored dinner jacket', 'A11 tailored trousers', 'A11 fitted silk facing L',
          'A11 fitted silk facing R', 'A11 jacket button', 'A11 fitted dress shirt', 'A11 fitted shirt cuff L',
          'A11 fitted shirt cuff R', 'A11 continuous shirt collar', 'A11 fitted bow knot')
TOLERANCE_M = 1e-6


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--a11', required=True)
    parser.add_argument('--out', required=True)
    return parser.parse_args(argv)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def only_armature(obj, rig):
    """The outfit is posed through its armature alone; refuse a modifier setup the arrays cannot follow."""
    armatures = [m for m in obj.modifiers if m.type == 'ARMATURE']
    if len(armatures) != 1 or armatures[0].object != rig:
        raise SystemExit('FAIL: %s needs exactly one armature modifier on the rig' % obj.name)
    modifier = armatures[0]
    if (not modifier.use_vertex_groups or modifier.use_bone_envelopes or modifier.use_deform_preserve_volume
            or modifier.use_multi_modifier or modifier.vertex_group):
        raise SystemExit('FAIL: %s deforms in a way a linear blend of vertex groups cannot reproduce' % obj.name)
    if obj.data.shape_keys is not None:
        raise SystemExit('FAIL: %s carries shape keys; the rest shape would be ambiguous' % obj.name)
    for m in obj.modifiers:
        m.show_viewport = m.type == 'ARMATURE'


def posed_in_rig(obj, rig):
    """Blender's own evaluation of the mesh, in the rig's space."""
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    to_rig = np.array(rig.matrix_world.inverted() @ evaluated.matrix_world)
    evaluated.to_mesh_clear()
    return co.reshape(-1, 3).astype(np.float64) @ to_rig[:3, :3].T + to_rig[:3, 3]


def blend(rest, vertex, bone, weight, deform):
    """Linear blend skinning with Blender's normalisation: the weighted mean of each bone's move."""
    moved = np.einsum('vij,vj->vi', deform[bone][:, :3, :3], rest[vertex]) + deform[bone][:, :3, 3]
    total = np.zeros(len(rest))
    np.add.at(total, vertex, weight)
    out = np.zeros_like(rest)
    np.add.at(out, vertex, moved * weight[:, None])
    if (total <= 1e-4).any():
        raise SystemExit('FAIL: %d vertices carry no deforming weight' % int((total <= 1e-4).sum()))
    return out / total[:, None]


def main():
    args = arguments()
    source = os.path.abspath(args.a11)
    bpy.ops.wm.open_mainfile(filepath=source, load_ui=False)
    rig = bpy.data.objects[RIG]
    if rig.animation_data is not None:
        rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    bones = [bone for bone in rig.data.bones if bone.use_deform]
    if any(bone.bbone_segments > 1 for bone in bones):
        raise SystemExit('FAIL: a deforming bone is a B-Bone; the arrays assume straight bones')
    index = {bone.name: i for i, bone in enumerate(bones)}
    rest_matrix = np.array([np.array(bone.matrix_local) for bone in bones])

    data = {'meshes': np.array(OUTFIT), 'bones': np.array([bone.name for bone in bones]),
            'bone_rest': rest_matrix}
    for i, name in enumerate(OUTFIT):
        obj = bpy.data.objects[name]
        only_armature(obj, rig)
        bpy.context.view_layer.update()
        co = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
        obj.data.vertices.foreach_get('co', co)
        to_rig = np.array(rig.matrix_world.inverted() @ obj.matrix_world)
        rest = co.reshape(-1, 3) @ to_rig[:3, :3].T + to_rig[:3, 3]
        vertex, bone, weight = [], [], []
        for v in obj.data.vertices:
            for g in v.groups:
                group = obj.vertex_groups[g.group].name
                if group in index and g.weight > 0.0:
                    vertex.append(v.index)
                    bone.append(index[group])
                    weight.append(g.weight)
        data['%d_rest' % i] = rest
        data['%d_vertex' % i] = np.array(vertex, dtype=np.int32)
        data['%d_bone' % i] = np.array(bone, dtype=np.int32)
        data['%d_weight' % i] = np.array(weight, dtype=np.float64)
        print('OUTFIT %-32s %5d vertices, %6d weights' % (name, len(rest), len(weight)))

    # The test pose: every deforming bone turned by a different small rotation.
    for n, pose_bone in enumerate(rig.pose.bones):
        pose_bone.rotation_mode = 'QUATERNION'
        axis = Vector((math.sin(n * 1.7), math.cos(n * 0.9), math.sin(n * 0.4 + 1.0))).normalized()
        pose_bone.rotation_quaternion = Quaternion(axis, math.radians(8.0 + (n % 7) * 3.0))
    bpy.context.view_layer.update()
    deform = np.array([np.array(rig.pose.bones[bone.name].matrix) @ np.linalg.inv(rest_matrix[i])
                       for i, bone in enumerate(bones)])
    worst = 0.0
    for i, name in enumerate(OUTFIT):
        expected = posed_in_rig(bpy.data.objects[name], rig)
        got = blend(data['%d_rest' % i], data['%d_vertex' % i], data['%d_bone' % i], data['%d_weight' % i], deform)
        error = float(np.linalg.norm(expected - got, axis=1).max())
        moved = float(np.linalg.norm(expected - data['%d_rest' % i], axis=1).max())
        worst = max(worst, error)
        print('CHECK %-32s test pose moves up to %.1f mm, arrays differ by %.2e m' % (name, moved * 1000.0, error))
    if worst > TOLERANCE_M:
        raise SystemExit('FAIL: the extracted arrays miss Blender by %.2e m' % worst)

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    np.savez_compressed(out, **data)
    manifest = {
        'data': os.path.basename(out),
        'dataSha256': sha256_file(out),
        'source': os.path.basename(source),
        'sourceSha256': sha256_file(source),
        'script': 'art/pipeline/extract_a11_standing_outfit.py',
        'deformingBones': len(bones),
        'meshes': {name: int(len(data['%d_rest' % i])) for i, name in enumerate(OUTFIT)},
        'testPoseWorstErrorM': worst,
    }
    with open(os.path.splitext(out)[0] + '.json', 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(manifest, handle, indent=2)
        handle.write('\n')
    print('WROTE %s %s' % (out, manifest['dataSha256']))


main()

import json
import os
import sys

os.environ.setdefault('RIVER_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy

from values import (
    BUDGET,
    CHARACTER_CULL_FRACTION,
    CHARACTER_MESH_PREFIX,
)

OUT_DIR = os.environ['RIVER_OUT']

MALE = 'char_male'
FEMALE = 'char_female'
CHARACTERS = [MALE, FEMALE]

MPFB_MODULE = 'bl_ext.blender_org.mpfb'


def have_mpfb():
    ops = getattr(bpy.ops, 'mpfb', None)
    if ops is None:
        return False
    for name in ('create_human', 'add_standard_rig'):
        try:
            poll_result = getattr(ops, name).poll()
        except Exception:
            return False
    return True


def require_mpfb():
    if not have_mpfb():
        raise SystemExit(
            'BLOCKED: MPFB is not enabled in this Blender. Enable the extension '
            + MPFB_MODULE
            + ' (extensions.blender.org) before running character generation.'
        )


def clear_scene():
    scene = bpy.context.scene
    coll = scene.collection
    for obj in list(coll.objects):
        coll.objects.unlink(obj)
        bpy.data.objects.remove(obj)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def mesh_stats(mesh):
    counts = {'QUADS': 0, 'TRIS': 0, 'N-GON': 0}
    for polygon in mesh.polygons:
        sides = len(polygon.vertices)
        if sides == 4:
            counts['QUADS'] += 1
        elif sides == 3:
            counts['TRIS'] += 1
        else:
            counts['N-GON'] += 1
    faces = sum(counts.values())
    quad_ratio = (counts['QUADS'] / faces) if faces else 0.0
    return quad_ratio


def build_character(name):
    require_mpfb()
    bpy.ops.mpfb.create_human()
    human = bpy.context.active_object
    if human is None:
        raise SystemExit('FAIL: create_human produced no active object')
    human.name = name

    bpy.ops.mpfb.add_standard_rig()

    bpy.ops.mpfb.bake_shapekeys()
    if human.data.shape_keys is not None:
        mix = human.shape_key_add(name='residual', from_mix=True)
        human.data.shape_keys.key_blocks.remove(mix)

    decimate = human.modifiers.new('cull', 'DECIMATE')
    decimate.decimate_type = 'UNSUBDIV'
    decimate.iterations = 1
    bpy.context.view_layer.objects.active = human
    bpy.ops.object.modifier_apply(modifier='cull')

    mesh = human.data
    z_vals = [v.co.z for v in mesh.vertices]
    z_min = min(z_vals)
    z_max = max(z_vals)
    cut = z_min + (z_max - z_min) * CHARACTER_CULL_FRACTION

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.delete(
        bm,
        geom=[v for v in bm.verts if v.co.z < cut],
        context='VERTS',
    )
    bm.to_mesh(mesh)
    bm.free()

    quad_ratio = mesh_stats(mesh)
    if quad_ratio < BUDGET['character_quad_min']:
        raise SystemExit(
            'FAIL: {} quad ratio {:.2f} below minimum {}'.format(
                name, quad_ratio, BUDGET['character_quad_min']
            )
        )
    vertex_groups = len(human.vertex_groups)
    if vertex_groups < BUDGET['character_groups_min']:
        raise SystemExit(
            'FAIL: {} vertex-group count {} below minimum {}'.format(
                name, vertex_groups, BUDGET['character_groups_min']
            )
        )
    armature = next((m for m in human.modifiers if m.type == 'ARMATURE'), None)
    if armature is None:
        raise SystemExit('FAIL: {} has no bound ARMATURE modifier'.format(name))
    bones = len(armature.object.data.bones)
    if bones < BUDGET['character_bones_min']:
        raise SystemExit(
            'FAIL: {} bone count {} below minimum {}'.format(name, bones, BUDGET['character_bones_min'])
        )
    return human


def export(name):
    glb = os.path.join(OUT_DIR, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=glb,
        check_existing=False,
        export_format='GLB',
        export_materials='EXPORT',
        export_yup=True,
        export_apply=False,
    )
    return glb


def main():
    require_mpfb()
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {'characters': []}
    for name in CHARACTERS:
        clear_scene()
        human = build_character(name)
        mesh = human.data
        glb = export(name)
        manifest['characters'].append({
            'name': name,
            'glb': os.path.basename(glb),
            'tris': len(mesh.polygons),
        })
        print('CHAR %s tris=%d quads=%.3f groups=%d bones=%d' % (
            name,
            len(mesh.polygons),
            mesh_stats(mesh),
            len(human.vertex_groups),
            len(next(m for m in human.modifiers if m.type == 'ARMATURE').object.data.bones),
        ))
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as handle:
        json.dump(manifest, handle, indent=2)


if __name__ == '__main__':
    main()
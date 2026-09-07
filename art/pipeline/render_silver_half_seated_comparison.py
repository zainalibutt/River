"""A4: compare the accepted A3 fits immediately before open_creases, without tuning.

Run: blender --background --python-exit-code 1 --python art/pipeline/render_silver_half_seated_comparison.py
Both branches retain sleeve relief and the baseline's suit smoothing selection.
Only garment geometry is rendered, with identical neutral material, light and cameras.
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe_silver_half_seated_fit as probe
from build_native_silver_proof import OUT, asset_path
from diagnose_silver_shell import look_at
from render_silver_seating_proof import add_area


def snapshot(suit):
    return ([tuple(v.co) for v in suit.data.vertices],
            [tuple(p.vertices) for p in suit.data.polygons], suit.matrix_world.copy())


def build_pair():
    from bl_ext.blender_org.mpfb.services import HumanService

    silver = probe.silver
    body, rig, meshes = probe.open_source()
    suit = probe.prepare(body, rig, meshes)
    captured = {}
    relax = silver.relax_skinning

    def capture(obj, moved, **kwargs):
        if obj is suit:
            captured['selection'] = moved.copy()
        return relax(obj, moved, **kwargs)

    silver.relax_skinning = capture
    try:
        silver.bake_seated_pose(rig, meshes)
    finally:
        silver.relax_skinning = relax
    final = probe.rest_matrices(rig)
    silver.relieve_sleeve_intersection(suit, rig)
    current = snapshot(suit)
    focus = sum((rig.matrix_world @ rig.data.bones['upperarm01.' + side].head_local
                 for side in ('L', 'R')), Vector()) * 0.5
    focus.z -= 0.07

    body, rig, meshes = probe.open_source()
    for obj in meshes:
        if obj is not body:
            bpy.data.objects.remove(obj, do_unlink=True)
    silver.bake_shape_keys(body)
    probe.pose_and_bake(rig, [body], final, fraction=0.5)
    garments = []
    for name in ('suit', 'shoes'):
        obj = HumanService.add_mhclo_asset(
            asset_path(name), body, asset_type='Clothes', subdiv_levels=1,
            material_type='MAKESKIN', set_up_rigging=True,
            interpolate_weights=True, import_weights=True)
        obj.name = 'river_silver_' + name
        garments.append(obj)
    meshes = [body, *garments]
    suit = probe.prepare(body, rig, meshes)
    _, _, travelled = probe.pose_and_bake(rig, meshes, final)
    for obj in meshes:
        if obj is suit or obj is body:
            moved = captured['selection'] if obj is suit else travelled[obj.name]
            if len(moved) != len(obj.data.vertices):
                raise RuntimeError('Smoothing selection topology differs')
            silver.relax_skinning(obj, moved, threshold=0.09, factor=0.2, rounds=2)
    silver.relieve_sleeve_intersection(suit, rig)
    print('A4_STAGE both branches after sleeve relief, before open_creases', flush=True)
    return current, snapshot(suit), focus


def main(pair=None, labels=('Current fit', 'Half-seated fit'),
         stage='After sleeve relief; before open_creases', prefix='a4'):
    current, half, focus = build_pair() if pair is None else pair
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 900, 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.3
    scene.world = bpy.data.worlds.new('a4_world')
    scene.world.color = (0.04, 0.045, 0.05)
    material = bpy.data.materials.new('a4_neutral_garment')
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.18, 0.20, 0.23, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.75
    garments = []
    for label, (vertices, faces, matrix) in zip(labels, (current, half)):
        mesh = bpy.data.meshes.new(label)
        mesh.from_pydata(vertices, [], faces)
        obj = bpy.data.objects.new(label, mesh)
        scene.collection.objects.link(obj)
        obj.matrix_world = matrix
        mesh.materials.append(material)
        for face in mesh.polygons:
            face.use_smooth = True
        obj.hide_render = True
        garments.append(obj)
    for name, offset, energy in (
            ('front_key', (-1.1, -1.0, 0.9), 350),
            ('back_key', (-1.1, 1.0, 0.9), 350),
            ('fill', (1.2, 0, 0.4), 100)):
        add_area(name, focus + Vector(offset), (1, 1, 1), energy, 1.1, focus)
    camera = bpy.data.objects.new('a4_camera', bpy.data.cameras.new('a4_camera'))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 0.70
    camera.data.sensor_fit = 'HORIZONTAL'
    scene.collection.objects.link(camera)
    scene.camera = camera
    text = bpy.data.curves.new('a4_caption', 'FONT')
    text.size = 0.014
    label = bpy.data.objects.new('a4_caption', text)
    scene.collection.objects.link(label)
    label.parent = camera
    label.location = (-0.33, 0.265, -0.5)
    ink = bpy.data.materials.new('a4_caption_ink')
    ink.use_nodes = True
    tree = ink.node_tree
    tree.nodes.clear()
    emission = tree.nodes.new('ShaderNodeEmission')
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    text.materials.append(ink)
    rows = []
    for view, direction in (('Front', -1), ('Back', 1)):
        camera.location = focus + Vector((0, direction * 1.5, 0))
        look_at(camera, focus)
        tiles = []
        for index, obj in enumerate(garments):
            obj.hide_render = False
            text.body = obj.name + ' | ' + view + '\n' + stage
            path = os.path.join(OUT, '%s-armpit-%s-%d.png' % (prefix, view.lower(), index))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(path, check_existing=False)
            tiles.append(np.array(image.pixels[:], dtype=np.float32).reshape(760, 900, 4))
            bpy.data.images.remove(image)
            obj.hide_render = True
        rows.append(np.hstack(tiles))
    pixels = np.vstack(rows[::-1])
    image = bpy.data.images.new('a4_armpit_comparison', 1800, 1520, alpha=True)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = os.path.join(OUT, prefix + '-armpit-comparison.png')
    image.file_format = 'PNG'
    image.save()
    print(prefix.upper() + '_SHEET ' + image.filepath_raw, flush=True)


if __name__ == '__main__':
    main()

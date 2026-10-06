"""Compare fitted MakeHuman short hair on the staged silver source, without exporting.

Run: blender --background --python-exit-code 1 --python art/pipeline/compare_hair_shells.py
The staged character's unavailable texture links are replaced by neutral clay
in memory, exposing the actual skull surface without a scalp-shadow disguise.
Hair uses each asset's native texture and the builder's common tint; no texture
authoring or production asset is changed by this comparison.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_native_silver_proof import MPFB_DATA, OUT, add_area, conform_hair, look_at, tint


CUTS = ('short01', 'short02', 'short03', 'short04')
EXPECTED = ((2984, 1839), (1755, 1672), (1011, 961), (865, 525))
VIEWS = (('rear-left', -45.0), ('directly-behind', 0.0), ('rear-right', 45.0))
SIZE = (560, 620)


def add_caption(camera):
    curve = bpy.data.curves.new('hair_comparison_caption', 'FONT')
    curve.size = 0.011
    curve.space_line = 1.2
    label = bpy.data.objects.new('hair_comparison_caption', curve)
    bpy.context.scene.collection.objects.link(label)
    label.parent = camera
    label.location = (-0.17, 0.174, -0.5)
    material = bpy.data.materials.new('hair_comparison_label')
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    emission = tree.nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (0.85, 0.88, 0.93, 1.0)
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    curve.materials.append(material)
    return curve


def main():
    from bl_ext.blender_org.mpfb.services import HumanService

    source = os.path.join(OUT, 'native-silver-character.blend')
    bpy.ops.wm.open_mainfile(filepath=source)
    human = bpy.data.objects['river_native_silver_body']
    bpy.data.objects.remove(bpy.data.objects['river_silver_hair'], do_unlink=True)
    for obj in list(bpy.data.objects):
        if obj.type in {'LIGHT', 'CAMERA'}:
            bpy.data.objects.remove(obj, do_unlink=True)
    clay = bpy.data.materials.new('hair_comparison_neutral_character')
    clay.use_nodes = True
    bsdf = clay.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.32, 0.27, 0.22, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.7
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.data.materials.clear()
            obj.data.materials.append(clay)

    shells = []
    bounds = []
    for cut, expected in zip(CUTS, EXPECTED):
        path = os.path.join(MPFB_DATA, 'hair', cut, cut + '.mhclo')
        hair = HumanService.add_mhclo_asset(
            path, human, asset_type='hair', subdiv_levels=1,
            material_type='MAKESKIN', set_up_rigging=True,
            interpolate_weights=True, import_weights=True)
        actual = (len(hair.data.vertices), len(hair.data.polygons))
        if actual != expected or any(len(p.vertices) != 4 for p in hair.data.polygons):
            raise RuntimeError('%s topology differs: %r, expected %r quads' %
                               (cut, actual, expected))
        conform_hair(hair)
        tint(hair, (0.038, 0.026, 0.018), 0.94, 'MULTIPLY', 0.54, 0.18)
        for polygon in hair.data.polygons:
            polygon.use_smooth = True
        bpy.context.view_layer.update()
        evaluated = hair.evaluated_get(bpy.context.evaluated_depsgraph_get())
        bounds.extend(evaluated.matrix_world @ Vector(corner)
                      for corner in evaluated.bound_box)
        hair.hide_render = True
        shells.append(hair)
        print('FITTED %s vertices=%d quad_faces=%d base_triangles=%d' %
              (cut, actual[0], actual[1], actual[1] * 2), flush=True)

    lower = Vector(tuple(min(point[i] for point in bounds) for i in range(3)))
    upper = Vector(tuple(max(point[i] for point in bounds) for i in range(3)))
    target = (lower + upper) * 0.5
    target.z -= 0.015
    print('CAMERA_TARGET %r FITTED_BOUNDS %r %r' %
          (tuple(target), tuple(lower), tuple(upper)), flush=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.15
    scene.view_settings.gamma = 1.0
    scene.world = bpy.data.worlds.new('hair_comparison_world')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (0.045, 0.05, 0.06, 1.0)
    background.inputs['Strength'].default_value = 0.5
    for name, offset, energy, size in (
            ('key', (-0.8, 1.0, 0.8), 100.0, 1.2),
            ('fill', (0.8, 0.8, 0.3), 65.0, 1.2),
            ('crown', (0.0, -0.4, 1.0), 75.0, 1.0)):
        add_area('hair_comparison_' + name, target + Vector(offset),
                 (1.0, 1.0, 1.0), energy, size, target)
    data = bpy.data.cameras.new('hair_comparison_camera')
    data.type = 'ORTHO'
    data.ortho_scale = 0.36
    data.sensor_fit = 'HORIZONTAL'
    camera = bpy.data.objects.new('hair_comparison_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    caption = add_caption(camera)
    rows = []
    for cut, hair, expected in zip(CUTS, shells, EXPECTED):
        hair.hide_render = False
        tiles = []
        for view, degrees in VIEWS:
            angle = math.radians(degrees)
            camera.location = target + Vector((math.sin(angle) * 0.8,
                                                math.cos(angle) * 0.8, 0.04))
            look_at(camera, target)
            caption.body = '%s | %d quad faces\n%s | neutral skin' % (
                cut, expected[1], view)
            path = os.path.join(OUT, 'hair-%s-%s.png' % (cut, view))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(path, check_existing=False)
            width, height = image.size
            if (width, height) != SIZE:
                raise RuntimeError('Unexpected render dimensions: %s' % path)
            tiles.append(np.array(image.pixels[:], dtype=np.float32)
                         .reshape(height, width, 4))
            bpy.data.images.remove(image)
            print('RENDER ' + path, flush=True)
        rows.append(np.hstack(tiles))
        hair.hide_render = True
    sheet = np.vstack(rows[::-1])
    image = bpy.data.images.new('hair_comparison_sheet', sheet.shape[1],
                                sheet.shape[0], alpha=True)
    image.pixels.foreach_set(sheet.ravel())
    image.filepath_raw = os.path.join(OUT, 'hair-contact-sheet.png')
    image.file_format = 'PNG'
    image.save()
    print('SHEET ' + image.filepath_raw, flush=True)


if __name__ == '__main__':
    main()

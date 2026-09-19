"""Render a built venue GLB for review, lit by its own lighting sidecar.

The browser is the final word on how a venue looks, but a hidden browser pane cannot
zoom and a gameplay frame shows the felt at a few dozen pixels. This imports the exported
GLB - the file the browser loads, not the scene that made it - lights it with the
sidecar's rig and shoots it from where a player sits, from above, and close on the
places being changed. It hides what the browser hides: the instancing source meshes that
sit at the origin.

  node art/pipeline/run_blender.mjs art/pipeline/render_venue_review.py -- \\
      --glb <venue>_assets.glb --lighting <lighting.json> --venue rooftop --out <folder> --prefix after
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

VIEWS = {
    # name: (camera position, look-at target, lens mm or None for ortho, ortho scale)
    'player': ((0.0, -3.1, 1.55), (0.0, 0.05, 0.76), 26.0, None),
    'felt': ((0.0, 0.0, 4.0), (0.0, 0.0, 0.76), None, 2.75),
    'dealer': ((0.42, -0.05, 1.28), (0.0, 0.62, 0.78), 38.0, None),
    'rail': ((1.05, -1.18, 1.12), (0.62, -0.5, 0.78), 38.0, None),
}


def hex_colour(value):
    value = value.lstrip('#')
    srgb = [int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--glb', required=True)
    parser.add_argument('--lighting', required=True)
    parser.add_argument('--venue', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--prefix', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    os.makedirs(args.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
    for obj in bpy.data.objects:
        if obj.name == 'board_card_pool' or ('chip' in obj.name and 'pool' in obj.name):
            obj.hide_render = True

    rig = json.load(open(args.lighting, encoding='utf-8'))[args.venue]
    scene = bpy.context.scene
    world = bpy.data.worlds.new('review world')
    world.use_nodes = True
    background = world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (*hex_colour(rig['world']['colour']), 1.0)
    background.inputs['Strength'].default_value = rig['world']['strength']
    scene.world = world
    for light in rig['lights']:
        data = bpy.data.lights.new(light['name'], 'AREA')
        data.energy = light['energy']
        data.size = light['size']
        data.color = hex_colour(light['colour'])
        data.use_shadow = bool(light.get('shadow', False))
        obj = bpy.data.objects.new(light['name'], data)
        obj.location = light['position']
        obj.rotation_euler = Euler([math.radians(v) for v in light.get('rotation_deg', [0, 0, 0])])
        scene.collection.objects.link(obj)

    camera_data = bpy.data.cameras.new('review camera')
    camera = bpy.data.objects.new('review camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'

    for name, (position, target, lens, ortho) in VIEWS.items():
        camera.location = position
        camera.rotation_euler = (Vector(target) - Vector(position)).to_track_quat('-Z', 'Y').to_euler()
        if ortho is None:
            camera_data.type = 'PERSP'
            camera_data.lens = lens
        else:
            camera_data.type = 'ORTHO'
            camera_data.ortho_scale = ortho
        scene.render.filepath = os.path.join(os.path.abspath(args.out), '%s-%s.png' % (args.prefix, name))
        bpy.ops.render.render(write_still=True)
        print('REVIEW', args.prefix, name, flush=True)


main()

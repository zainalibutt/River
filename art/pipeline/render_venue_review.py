"""Render a built venue GLB for review, lit by its own lighting sidecar.

The browser is the final word on how a venue looks, but a hidden browser pane cannot
zoom and a gameplay frame shows the felt at a few dozen pixels. This imports the exported
GLB - the file the browser loads, not the scene that made it - lights it with the
sidecar's rig and shoots it from where a player sits, from above, and close on the
places being changed. It hides what the browser hides: the instancing source meshes that
sit at the origin.

The skyline views put the browser's sky behind the city. That sky is a shader in the
scene component, not part of the venue, so its colours and bands are read out of the
component itself: a review against a sky of its own would be judging a different picture.
The camera sees the dome and the room is lit by the rig's world colour, as in the browser.

  node art/pipeline/run_blender.mjs art/pipeline/render_venue_review.py -- \\
      --glb <venue>_assets.glb --lighting <lighting.json> --venue rooftop --out <folder> \\
      --prefix after [--views table|skyline]
"""
import argparse
import json
import math
import os
import re
import sys

import bpy
from mathutils import Euler, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCENE_COMPONENT = os.path.join(ROOT, 'apps', 'web', 'src', 'components', 'river-venue-scene.tsx')


def _outward(azimuth_degrees, elevation_degrees=3.0, eye=1.5):
    """A camera at the table looking out over the parapet, 3 degrees above the horizon."""
    azimuth = math.radians(azimuth_degrees)
    elevation = math.radians(elevation_degrees)
    return ((0.0, 0.0, eye),
            (100.0 * math.cos(azimuth), 100.0 * math.sin(azimuth), eye + 100.0 * math.tan(elevation)))


VIEW_SETS = {
    'table': {
        'resolution': (960, 540),
        'views': {
            'player': {'at': ((0.0, -3.1, 1.55), (0.0, 0.05, 0.76)), 'lens': 26.0},
            'felt': {'at': ((0.0, 0.0, 4.0), (0.0, 0.0, 0.76)), 'ortho': 2.75},
            'dealer': {'at': ((0.42, -0.05, 1.28), (0.0, 0.62, 0.78)), 'lens': 38.0},
            'rail': {'at': ((1.05, -1.18, 1.12), (0.62, -0.5, 0.78)), 'lens': 38.0},
        },
    },
    'skyline': {
        # The browser's frame: 64 degrees across at 16:9, from the play camera and from the
        # flattest the orbit allows (85 degrees from vertical), then straight out each way.
        'resolution': (1280, 720),
        'views': {
            'play': {'at': ((0.0, -3.2, 1.5), (0.0, 0.0, 0.76)), 'fov': 64.0},
            'play-flat': {'at': ((0.0, -3.272, 1.046), (0.0, 0.0, 0.76)), 'fov': 64.0},
            'out-north': {'at': _outward(90.0), 'fov': 64.0},
            'out-west': {'at': _outward(180.0), 'fov': 64.0},
            'out-south': {'at': _outward(270.0), 'fov': 64.0},
            'out-east': {'at': _outward(0.0), 'fov': 64.0},
        },
    },
}


def hex_colour(value):
    value = value.lstrip('#')
    srgb = [int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def browser_sky(venue):
    """The dome's four colours and four smoothstep bands, as the scene component has them."""
    with open(SCENE_COMPONENT, encoding='utf-8') as handle:
        source = handle.read()
    colour = r"'(#[0-9a-fA-F]{6})'"
    match = re.search(r'%s:\s*\{\s*low:\s*%s,\s*band:\s*%s,\s*hot:\s*%s,\s*high:\s*%s' % ((venue,) + (colour,) * 4),
                      source)
    bands = re.findall(r'smoothstep\(([\d.]+),\s*([\d.]+),\s*h\)', source)
    if match is None:
        return None
    if len(bands) != 4:
        raise SystemExit('FAIL: expected four sky bands in %s, found %d' % (SCENE_COMPONENT, len(bands)))
    return [hex_colour(value) for value in match.groups()], [(float(a), float(b)) for a, b in bands]


def build_world(scene, rig, sky):
    world = bpy.data.worlds.new('review world')
    world.use_nodes = True
    tree = world.node_tree
    nodes, links = tree.nodes, tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputWorld')
    ambient = nodes.new('ShaderNodeBackground')
    ambient.inputs['Color'].default_value = (*hex_colour(rig['world']['colour']), 1.0)
    ambient.inputs['Strength'].default_value = rig['world']['strength']
    scene.world = world
    if sky is None:
        links.new(ambient.outputs['Background'], output.inputs['Surface'])
        return
    (low, band, hot, high), bands = sky
    coord = nodes.new('ShaderNodeTexCoord')
    split = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coord.outputs['Generated'], split.inputs['Vector'])
    h = nodes.new('ShaderNodeMath')
    h.operation = 'MULTIPLY_ADD'
    links.new(split.outputs['Z'], h.inputs[0])
    h.inputs[1].default_value = 0.5
    h.inputs[2].default_value = 0.5

    def smoothstep(edge0, edge1):
        node = nodes.new('ShaderNodeMapRange')
        node.interpolation_type = 'SMOOTHSTEP'
        node.inputs['From Min'].default_value = edge0
        node.inputs['From Max'].default_value = edge1
        links.new(h.outputs['Value'], node.inputs['Value'])
        return node.outputs['Result']

    def constant(rgb):
        node = nodes.new('ShaderNodeRGB')
        node.outputs['Color'].default_value = (*rgb, 1.0)
        return node.outputs['Color']

    def mix(a, b, t):
        difference = nodes.new('ShaderNodeVectorMath')
        difference.operation = 'SUBTRACT'
        links.new(b, difference.inputs[0])
        links.new(a, difference.inputs[1])
        scaled = nodes.new('ShaderNodeVectorMath')
        scaled.operation = 'SCALE'
        links.new(difference.outputs['Vector'], scaled.inputs[0])
        links.new(t, scaled.inputs['Scale'])
        total = nodes.new('ShaderNodeVectorMath')
        total.operation = 'ADD'
        links.new(a, total.inputs[0])
        links.new(scaled.outputs['Vector'], total.inputs[1])
        return total.outputs['Vector']

    # The fragment shader, node for node: low to band, the hot band fading back out, then high.
    first, second, third, fourth = bands
    colour = mix(constant(low), constant(band), smoothstep(*first))
    fade = nodes.new('ShaderNodeMath')
    fade.operation = 'SUBTRACT'
    fade.inputs[0].default_value = 1.0
    links.new(smoothstep(*third), fade.inputs[1])
    glow = nodes.new('ShaderNodeMath')
    glow.operation = 'MULTIPLY'
    links.new(smoothstep(*second), glow.inputs[0])
    links.new(fade.outputs['Value'], glow.inputs[1])
    colour = mix(colour, constant(hot), glow.outputs['Value'])
    colour = mix(colour, constant(high), smoothstep(*fourth))
    dome = nodes.new('ShaderNodeBackground')
    links.new(colour, dome.inputs['Color'])
    path = nodes.new('ShaderNodeLightPath')
    choose = nodes.new('ShaderNodeMixShader')
    links.new(path.outputs['Is Camera Ray'], choose.inputs['Fac'])
    links.new(ambient.outputs['Background'], choose.inputs[1])
    links.new(dome.outputs['Background'], choose.inputs[2])
    links.new(choose.outputs['Shader'], output.inputs['Surface'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--glb', required=True)
    parser.add_argument('--lighting', required=True)
    parser.add_argument('--venue', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--prefix', required=True)
    parser.add_argument('--views', default='table', choices=sorted(VIEW_SETS))
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    os.makedirs(args.out, exist_ok=True)
    view_set = VIEW_SETS[args.views]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
    # The browser's rule for instancing sources, applied to every object under one: Blender
    # imports an instanced node as an empty with a mesh per instance.
    for obj in bpy.data.objects:
        node = obj
        while node is not None and not (node.name == 'board_card_pool'
                                        or ('chip' in node.name and 'pool' in node.name)):
            node = node.parent
        if node is not None:
            obj.hide_render = True

    with open(args.lighting, encoding='utf-8') as handle:
        rig = json.load(handle)[args.venue]
    scene = bpy.context.scene
    build_world(scene, rig, browser_sky(args.venue))
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
    # The browser's camera draws to a kilometre; Blender's stops at a hundred metres, which
    # would cut the city off at its nearest ring.
    camera_data.clip_start = 0.1
    camera_data.clip_end = 1000.0
    camera = bpy.data.objects.new('review camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = view_set['resolution']
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'

    for name, view in view_set['views'].items():
        position, target = view['at']
        camera.location = position
        camera.rotation_euler = (Vector(target) - Vector(position)).to_track_quat('-Z', 'Y').to_euler()
        if 'ortho' in view:
            camera_data.type = 'ORTHO'
            camera_data.ortho_scale = view['ortho']
        else:
            camera_data.type = 'PERSP'
            if 'fov' in view:
                camera_data.sensor_fit = 'HORIZONTAL'
                camera_data.angle = math.radians(view['fov'])
            else:
                camera_data.sensor_fit = 'AUTO'
                camera_data.lens = view['lens']
        scene.render.filepath = os.path.join(os.path.abspath(args.out), '%s-%s.png' % (args.prefix, name))
        bpy.ops.render.render(write_still=True)
        print('REVIEW', args.prefix, name, flush=True)


main()

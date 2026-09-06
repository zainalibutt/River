"""Render the still that sits behind the front-door menu.

The menu backdrop was rendered once by hand and committed, with no script behind
it, so it froze while the venue kept moving. By the time anyone looked at it
again it showed two brazier flames floating free of their bowls, chips strewn
across the felt, palms so tall their canopies left the frame, and a black sky -
every one of those a defect that had already been fixed in the pipeline.

A still that cannot be regenerated is a screenshot, not an asset. This regenerates
it from whatever the venue currently is.

The sky is the one thing here that is not simply the venue: the room ships with a
flat near-black world because three.js takes a single background colour from
lighting.json, and a flat colour is honest at night but gives the menu nothing to
look at. The still is a rendered image and can carry a gradient for free, so it
gets a soft sunset behind the skyline. The live scene still has the flat colour -
matching them means a gradient sky in three.js as well, which is a separate job.

Run: blender --background --python-exit-code 1 --python art/pipeline/render_menu_stills.py
"""
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.normpath(os.path.join(ROOT, '..', 'apps', 'web', 'public', 'menu'))

# Warm at the horizon, deepening overhead. Sampled to read as dusk rather than a
# postcard: the menu type sits over this and has to stay legible, so the brightest
# band is kept low in frame and well under the ivory the folio uses.
SUNSET = (
    (0.00, (0.020, 0.024, 0.045)),
    (0.42, (0.055, 0.045, 0.080)),
    (0.60, (0.230, 0.115, 0.115)),
    (0.72, (0.520, 0.235, 0.130)),
    (0.80, (0.720, 0.380, 0.170)),
    (0.88, (0.400, 0.230, 0.180)),
    (1.00, (0.070, 0.070, 0.110)),
)

VENUES = ('rooftop',)


def sunset_world(scene, horizon=0.34, spread=0.62):
    """A vertical gradient world, so the skyline has something to sit against.

    Built from the view vector rather than a texture, so there is no image to ship
    and no resolution to band at. The ramp is interpolated smoothly and Blender
    dithers the result, which is what keeps a gradient across 1080 pixels from
    stepping - the failure mode to watch for here is banding, not colour.
    """
    world = bpy.data.worlds.new('menu_sky')
    world.use_nodes = True
    scene.world = world
    tree = world.node_tree
    tree.nodes.clear()

    coord = tree.nodes.new('ShaderNodeTexCoord')
    separate = tree.nodes.new('ShaderNodeSeparateXYZ')
    # Map the vertical component of the view direction into 0..1 across the band
    # the camera actually sees, so the whole ramp is used rather than its middle.
    remap = tree.nodes.new('ShaderNodeMapRange')
    remap.inputs['From Min'].default_value = horizon - spread
    remap.inputs['From Max'].default_value = horizon + spread
    remap.clamp = True
    ramp = tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'B_SPLINE'
    while len(ramp.color_ramp.elements) > 1:
        ramp.color_ramp.elements.remove(ramp.color_ramp.elements[-1])
    for index, (position, colour) in enumerate(SUNSET):
        element = (ramp.color_ramp.elements[0] if index == 0
                   else ramp.color_ramp.elements.new(position))
        element.position = position
        element.color = (*colour, 1.0)
    background = tree.nodes.new('ShaderNodeBackground')
    background.inputs['Strength'].default_value = 1.0
    output = tree.nodes.new('ShaderNodeOutputWorld')

    tree.links.new(coord.outputs['Window'], separate.inputs['Vector'])
    tree.links.new(separate.outputs['Y'], remap.inputs['Value'])
    tree.links.new(remap.outputs['Result'], ramp.inputs['Fac'])
    tree.links.new(ramp.outputs['Color'], background.inputs['Color'])
    tree.links.new(background.outputs['Background'], output.inputs['Surface'])
    return world


def hide_people(venue_id):
    """The menu room is empty. Nobody is at the table yet - that is the invitation."""
    hidden = 0
    for obj in bpy.data.objects:
        if obj.type not in {'MESH', 'ARMATURE'}:
            continue
        name = (obj.name + '|' + (obj.data.name if obj.data else '')).lower()
        if any(token in name for token in ('char_', 'river_male', 'river_female',
                                           'native_gold', 'native_silver', 'silver_')):
            obj.hide_render = True
            hidden += 1
    print('MENU hid %d character objects' % hidden)
    if hidden == 0:
        print('MENU no characters found - the venue was built empty')
    return hidden


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def render_venue(venue_id):
    asset = os.path.normpath(os.path.join(ROOT, 'out', '%s_assets.glb' % venue_id))
    if not os.path.exists(asset):
        raise SystemExit('FAIL: missing %s - build the venue first' % asset)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=asset)
    hide_people(venue_id)

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    scene.render.image_settings.file_format = 'JPEG'
    # The published stills sit around 100KB each and are scaled to fill a stage
    # roughly 1500px wide, so quality is spent on the gradient rather than on
    # detail nobody sees behind a menu.
    scene.render.image_settings.quality = 82
    scene.view_settings.look = 'AgX - Base Contrast'
    # The room is dressed almost entirely in dark leather and dark felt, so at the
    # venue's own exposure the terrace reads as one brown mass and only the sky and
    # the skyline windows carry any information. The still is a backdrop, not a
    # lighting reference, and it has to survive being scaled down behind a menu.
    scene.view_settings.exposure = 1.35
    sunset_world(scene)

    data = bpy.data.cameras.new('menu_camera')
    data.sensor_fit = 'HORIZONTAL'
    data.angle = math.radians(62.0)
    camera = bpy.data.objects.new('menu_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    # Low and outside the table, looking across the felt at the skyline. The menu
    # folio occupies the left third of the screen, so the table is placed right of
    # centre and the horizon kept high enough that the gradient reads behind it.
    camera.location = Vector((-2.55, -3.35, 1.72))
    look_at(camera, (0.35, 0.30, 0.92))

    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, '%s.jpg' % venue_id)
    bpy.ops.render.render(write_still=True)
    size = os.path.getsize(scene.render.filepath)
    print('MENU rendered %s.jpg %dx%d %.0fKB'
          % (venue_id, scene.render.resolution_x, scene.render.resolution_y, size / 1024.0))
    if size > 400 * 1024:
        raise SystemExit('FAIL: %s.jpg is %.0fKB, too heavy for a menu backdrop'
                         % (venue_id, size / 1024.0))


def main():
    for venue_id in VENUES:
        render_venue(venue_id)


if __name__ == '__main__':
    main()

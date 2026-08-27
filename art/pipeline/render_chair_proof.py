import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET = os.path.join(ROOT, 'out', 'rooftop_assets.glb')
PROOFS = os.path.join(ROOT, 'out', 'proofs')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_area(name, location, colour, energy, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.color = colour
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, (0.0, 0.0, 0.6))


def camera_at(location, target):
    data = bpy.data.cameras.new('proof_camera')
    data.sensor_fit = 'HORIZONTAL'
    data.angle = math.radians(67.0)
    camera = bpy.data.objects.new('proof_camera', data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = location
    look_at(camera, target)
    bpy.context.scene.camera = camera
    return camera


def render(name):
    bpy.context.scene.render.filepath = os.path.join(PROOFS, name)
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + bpy.context.scene.render.filepath)


def visible_only(name):
    for obj in bpy.context.scene.objects:
        obj.hide_render = obj.type == 'MESH' and obj.name != name


def reveal_all():
    for obj in bpy.context.scene.objects:
        obj.hide_render = False


def hide_player_characters():
    for root in bpy.context.scene.objects:
        if not root.name.startswith('river_character_'):
            continue
        root.hide_render = True
        for child in root.children_recursive:
            child.hide_render = True


os.makedirs(PROOFS, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ASSET)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('proof_world')
scene.world.color = (0.012, 0.018, 0.030)
add_area('proof_key', (-1.8, -2.3, 3.4), (1.0, 0.72, 0.48), 750.0, 3.0)
add_area('proof_fill', (2.0, 1.2, 2.6), (0.32, 0.52, 1.0), 420.0, 2.5)
camera = camera_at((0.0, -3.2, 1.5), (0.0, 0.0, 0.76))
chair = bpy.data.objects.get('rooftop_chair_4')
if chair is None:
    raise SystemExit('FAIL: proof chair rooftop_chair_4 was not imported')
visible_only(chair.name)
camera.location = chair.location + Vector((0.0, -3.2, 1.5))
look_at(camera, chair.location + Vector((0.0, 0.0, 0.76)))
render('rooftop-chair-isolated.png')
reveal_all()
camera.location = (0.0, -3.2, 1.5)
look_at(camera, (0.0, 0.0, 0.76))
hide_player_characters()
render('rooftop-chairs-empty.png')
reveal_all()
render('rooftop-chairs-occupied.png')

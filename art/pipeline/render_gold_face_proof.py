import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET = os.path.join(ROOT, 'out', 'char_female.glb')
PROOFS = os.path.join(ROOT, 'out', 'proofs')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_area(name, location, colour, energy, size, target):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.color = colour
    data.shape = 'DISK'
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    look_at(light, target)


if not os.path.exists(ASSET):
    raise SystemExit('FAIL: missing character asset ' + ASSET)

os.makedirs(PROOFS, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ASSET)

body = next(
    (
        obj for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and (obj.name == 'char_female' or obj.data.name.endswith('_body'))
    ),
    None,
)
eyes = next(
    (obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.name.endswith('_eyes')),
    None,
)
if body is None or eyes is None:
    raise SystemExit('FAIL: gold proof requires body and replacement eyes')

for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and (obj.name.startswith('garment_') or '_hair_' in obj.name):
        obj.hide_render = True
        obj.hide_viewport = True

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('gold_face_world')
scene.world.color = (0.006, 0.008, 0.010)
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -0.9

target = (0.0, -0.075, 1.565)
add_area('gold_key', (-0.72, -0.85, 2.15), (1.0, 0.75, 0.56), 70.0, 1.25, target)
add_area('gold_fill', (0.75, -0.38, 1.82), (0.30, 0.48, 0.95), 24.0, 1.0, target)
add_area('gold_rim', (0.20, 0.75, 1.95), (0.55, 0.70, 1.0), 42.0, 0.9, target)

camera_data = bpy.data.cameras.new('gold_face_camera')
camera_data.sensor_fit = 'HORIZONTAL'
camera_data.angle = math.radians(30.0)
camera = bpy.data.objects.new('gold_face_camera', camera_data)
bpy.context.scene.collection.objects.link(camera)
scene.camera = camera

views = (
    ('front', (0.0, -0.72, 1.57)),
    ('three-quarter', (0.48, -0.58, 1.59)),
    ('profile', (0.72, -0.02, 1.59)),
)
for view, location in views:
    camera.location = location
    look_at(camera, target)
    path = os.path.join(PROOFS, 'gold-face-%s.png' % view)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + path)

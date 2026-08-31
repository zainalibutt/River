import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET = os.path.join(ROOT, 'out', 'char_female.glb')
PROOFS = os.path.join(ROOT, 'out', 'proofs')
CRITICAL_EXPRESSIONS = ('face_blink', 'face_soft_smile', 'face_frustration')


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
if body is None or body.data.shape_keys is None:
    raise SystemExit('FAIL: exported gold character has no facial morph targets')

keys = body.data.shape_keys.key_blocks
missing = [name for name in CRITICAL_EXPRESSIONS if keys.get(name) is None]
if missing:
    raise SystemExit('FAIL: exported gold character missing morph targets: ' + ', '.join(missing))
for name in CRITICAL_EXPRESSIONS:
    changed = [
        index for index, point in enumerate(keys[name].data)
        if (point.co - keys['Basis'].data[index].co).length > 0.0001
    ]
    coordinates = [keys['Basis'].data[index].co for index in changed]
    print('MORPH %s changed=%d x=(%.3f,%.3f) y=(%.3f,%.3f) z=(%.3f,%.3f)' % (
        name,
        len(changed),
        min(point.x for point in coordinates), max(point.x for point in coordinates),
        min(point.y for point in coordinates), max(point.y for point in coordinates),
        min(point.z for point in coordinates), max(point.z for point in coordinates),
    ))
if os.environ.get('RIVER_MORPH_INSPECT_ONLY') == '1':
    raise SystemExit(0)

for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and (obj.name.startswith('garment_') or '_hair_' in obj.name):
        obj.hide_render = True
        obj.hide_viewport = True

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 700
scene.render.resolution_y = 700
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('gold_expression_world')
scene.world.color = (0.006, 0.008, 0.010)
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -0.85

target = (0.0, -0.075, 1.555)
add_area('expression_key', (-0.72, -0.85, 2.15), (1.0, 0.75, 0.56), 72.0, 1.25, target)
add_area('expression_fill', (0.75, -0.38, 1.82), (0.30, 0.48, 0.95), 28.0, 1.0, target)
add_area('expression_rim', (0.20, 0.75, 1.95), (0.55, 0.70, 1.0), 44.0, 0.9, target)

camera_data = bpy.data.cameras.new('gold_expression_camera')
camera_data.angle = math.radians(29.0)
camera = bpy.data.objects.new('gold_expression_camera', camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (0.0, -0.72, 1.565)
look_at(camera, target)
scene.camera = camera

for expression in ('neutral',) + CRITICAL_EXPRESSIONS:
    for key in keys:
        if key.name != 'Basis':
            key.value = 0.0
    if expression != 'neutral':
        keys[expression].value = 1.0
    path = os.path.join(PROOFS, 'gold-expression-%s.png' % expression.replace('face_', ''))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + path)

print('EXPRESSIONS exported=' + ','.join(key.name for key in keys if key.name != 'Basis'))

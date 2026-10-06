import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-gold')
BLEND = os.path.join(OUT, 'native-gold-character.blend')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def apply_expression(values):
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.data.shape_keys is None:
            continue
        for key in obj.data.shape_keys.key_blocks:
            if key.name.startswith('!ex-'):
                key.value = 0.0
        for name, weight in values.items():
            key = obj.data.shape_keys.key_blocks.get('!ex-' + name)
            if key is not None:
                key.value = weight


if not os.path.exists(BLEND):
    raise SystemExit('FAIL: missing native proof blend ' + BLEND)

bpy.ops.wm.open_mainfile(filepath=BLEND)
body = bpy.data.objects.get('river_native_gold_body')
if body is None or body.data.shape_keys is None:
    raise SystemExit('FAIL: native expression proof requires body shape keys')

scene = bpy.context.scene
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
camera = scene.camera
camera.data.angle = math.radians(29.0)
camera.location = (0.0, -1.42, 1.50)
look_at(camera, (0.0, 0.0, 1.47))

expressions = (
    ('neutral', {}),
    ('blink', {'eyeBlinkLeft': 1.0, 'eyeBlinkRight': 1.0}),
    ('soft-smile', {
        'mouthSmileLeft': 0.58,
        'mouthSmileRight': 0.58,
        'cheekSquintLeft': 0.18,
        'cheekSquintRight': 0.18,
    }),
    ('frustration', {
        'browDownLeft': 0.52,
        'browDownRight': 0.52,
        'mouthFrownLeft': 0.36,
        'mouthFrownRight': 0.36,
    }),
)
for name, values in expressions:
    apply_expression(values)
    scene.render.filepath = os.path.join(OUT, 'native-gold-expression-' + name + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + scene.render.filepath)

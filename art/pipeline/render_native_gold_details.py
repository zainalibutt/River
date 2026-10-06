import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-gold')
BLEND = os.path.join(OUT, 'native-gold-character.blend')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


if not os.path.exists(BLEND):
    raise SystemExit('FAIL: missing native proof blend ' + BLEND)

bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
camera = scene.camera
camera.data.angle = math.radians(31.0)

views = (
    ('portrait-front', (0.0, -1.58, 1.50), (0.0, 0.0, 1.46)),
    ('portrait-three-quarter', (0.82, -1.28, 1.52), (0.0, 0.0, 1.45)),
    ('wardrobe-three-quarter', (1.55, -2.35, 1.18), (0.0, 0.0, 1.05)),
)
for name, location, target in views:
    camera.location = location
    look_at(camera, target)
    scene.render.filepath = os.path.join(OUT, 'native-gold-' + name + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + scene.render.filepath)

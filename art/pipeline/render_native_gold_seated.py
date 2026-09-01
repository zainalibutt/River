import math
import os
import sys

import bpy
from mathutils import Vector


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'art', 'out', 'proofs', 'native-gold')
BLEND = os.path.join(OUT, 'native-gold-character.blend')

sys.path.insert(0, HERE)
from build_assets import apply_seated_rest_pose


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_material(name, colour, roughness, metallic=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*colour, 1.0)
    material.roughness = roughness
    material.metallic = metallic
    return material


def add_block(name, location, scale, material, bevel):
    bpy.ops.mesh.primitive_cube_add(location=location, scale=scale)
    block = bpy.context.object
    block.name = name
    block.data.materials.append(material)
    modifier = block.modifiers.new(name + '_bevel', 'BEVEL')
    modifier.width = bevel
    modifier.segments = 3
    return block


if not os.path.exists(BLEND):
    raise SystemExit('FAIL: missing native proof blend ' + BLEND)

bpy.ops.wm.open_mainfile(filepath=BLEND)
armature = next((obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'), None)
if armature is None:
    raise SystemExit('FAIL: native seated proof requires an armature')

plinth = bpy.data.objects.get('native_gold_plinth')
if plinth is not None:
    plinth.hide_render = True
    plinth.hide_viewport = True

apply_seated_rest_pose(armature, pose_legs=True)

leather = add_material('native_seat_leather', (0.025, 0.035, 0.055), 0.34)
felt = add_material('native_table_felt', (0.025, 0.11, 0.075), 0.72)
brass = add_material('native_table_brass', (0.35, 0.22, 0.07), 0.28, 0.62)
add_block('native_seat', (0.0, 0.08, 0.53), (0.31, 0.30, 0.06), leather, 0.08)
add_block('native_seat_back', (0.0, 0.31, 0.94), (0.34, 0.07, 0.43), leather, 0.10)
add_block('native_table', (0.0, -0.31, 0.82), (0.90, 0.40, 0.025), felt, 0.035)
add_block('native_rail', (0.0, -0.68, 0.88), (0.94, 0.11, 0.075), brass, 0.065)

scene = bpy.context.scene
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
camera = scene.camera
camera.data.angle = math.radians(38.0)

views = (
    ('front', (0.0, -3.0, 1.30), (0.0, -0.02, 0.98)),
    ('profile', (2.55, -0.22, 1.20), (0.0, -0.02, 0.98)),
    ('table', (1.65, -2.45, 1.75), (0.0, -0.24, 0.94)),
)
for name, location, target in views:
    camera.location = location
    look_at(camera, target)
    scene.render.filepath = os.path.join(OUT, 'native-gold-seated-' + name + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + scene.render.filepath)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'native-gold-seated.blend'))

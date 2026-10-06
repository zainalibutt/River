import math
import os
import sys

import bpy
from mathutils import Vector


HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from build_assets import apply_seated_rest_pose


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET = os.path.join(ROOT, 'out', 'char_female.glb')
PROOFS = os.path.join(ROOT, 'out', 'proofs')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_material(name, colour, roughness):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*colour, 1.0)
    material.roughness = roughness
    return material


def add_block(name, location, scale, material, bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(location=location, scale=scale)
    block = bpy.context.active_object
    block.name = name
    block.data.materials.append(material)
    modifier = block.modifiers.new('proof_bevel', 'BEVEL')
    modifier.width = bevel
    modifier.segments = 3
    return block


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

armature = next((obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'), None)
if armature is None:
    raise SystemExit('FAIL: gold pose proof requires an armature')

for hair in [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and '_hair_' in obj.name]:
    hair.hide_render = True
    hair.hide_viewport = True
for garment in [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.name.startswith('garment_')]:
    garment.hide_render = False
    garment.hide_viewport = False

apply_seated_rest_pose(armature, pose_legs=True)
for side in ('L', 'R'):
    wrist = armature.pose.bones.get('wrist.' + side)
    if wrist is not None:
        print('POSE_WRIST %s head=(%.4f,%.4f,%.4f)' % (side, wrist.head.x, wrist.head.y, wrist.head.z))

leather = add_material('proof_leather', (0.035, 0.045, 0.065), 0.38)
felt = add_material('proof_felt', (0.025, 0.11, 0.075), 0.72)
wood = add_material('proof_wood', (0.11, 0.035, 0.025), 0.34)
add_block('proof_seat', (0.0, 0.08, 0.53), (0.31, 0.30, 0.06), leather, 0.08)
add_block('proof_back', (0.0, 0.31, 0.94), (0.34, 0.07, 0.43), leather, 0.10)
add_block('proof_felt', (0.0, -0.29, 0.82), (0.88, 0.38, 0.025), felt, 0.03)
add_block('proof_rail', (0.0, -0.61, 0.88), (0.92, 0.10, 0.075), wood, 0.07)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('gold_pose_world')
scene.world.color = (0.005, 0.007, 0.010)
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -0.75

target = (0.0, -0.02, 0.98)
add_area('pose_key', (-1.4, -2.2, 2.6), (1.0, 0.72, 0.52), 250.0, 2.3, target)
add_area('pose_fill', (1.5, -0.4, 1.8), (0.30, 0.48, 1.0), 90.0, 1.8, target)
add_area('pose_rim', (0.0, 1.5, 2.1), (0.55, 0.72, 1.0), 130.0, 1.5, target)

camera_data = bpy.data.cameras.new('gold_pose_camera')
camera_data.angle = math.radians(38.0)
camera = bpy.data.objects.new('gold_pose_camera', camera_data)
bpy.context.scene.collection.objects.link(camera)
scene.camera = camera

for view, location in (
    ('front', (0.0, -3.0, 1.30)),
    ('profile', (2.55, -0.22, 1.20)),
    ('table', (1.65, -2.45, 1.75)),
):
    camera.location = location
    look_at(camera, (0.0, -0.24, 0.94) if view == 'table' else target)
    path = os.path.join(PROOFS, 'gold-pose-%s.png' % view)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDER ' + path)

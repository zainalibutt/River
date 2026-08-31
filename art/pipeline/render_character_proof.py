import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from build_assets import apply_seated_rest_pose, atlas_cell, project_garment_uv
from build_characters import OUTFIT_RECIPE_CELLS


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET = os.path.join(ROOT, 'out', 'char_male.glb')
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
    look_at(obj, (0.0, 0.0, 1.18))


if not os.path.exists(ASSET):
    raise SystemExit('FAIL: missing character asset ' + ASSET)

os.makedirs(PROOFS, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ASSET)

armature = next((obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'), None)
body = next(
    (
        obj
        for obj in bpy.context.scene.objects
        if obj.type == 'MESH' and '_hair' not in obj.name and not obj.name.startswith('garment_')
    ),
    None,
)
if armature is None or body is None:
    raise SystemExit('FAIL: proof character has no armature or body')

for hair in [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and '_hair_' in obj.name]:
    visible = hair.get('hairStyle') == 'side_part'
    hair.hide_render = not visible
    hair.hide_viewport = not visible

for garment in [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.name.startswith('garment_')]:
    visible = garment.get('outfitStyle') == 'm1_dinner'
    garment.hide_render = not visible
    garment.hide_viewport = not visible
    if visible:
        project_garment_uv(garment, atlas_cell(*OUTFIT_RECIPE_CELLS['m1_dinner']))

apply_seated_rest_pose(armature, pose_legs=True)

bpy.ops.mesh.primitive_cube_add(location=(0.0, 0.18, 0.735), scale=(1.25, 0.72, 0.025))
table = bpy.context.active_object
table.name = 'proof_table'
table_material = bpy.data.materials.new('proof_felt')
table_material.diffuse_color = (0.025, 0.08, 0.06, 1.0)
table.data.materials.append(table_material)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('proof_world')
scene.world.color = (0.008, 0.010, 0.012)
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -1.0

add_area('proof_key', (-1.6, -2.2, 3.0), (1.0, 0.72, 0.48), 420.0, 2.8)
add_area('proof_fill', (1.8, -0.2, 2.3), (0.28, 0.48, 1.0), 180.0, 2.2)
add_area('proof_rim', (0.0, 1.4, 2.4), (0.55, 0.68, 1.0), 260.0, 1.8)

camera_data = bpy.data.cameras.new('proof_camera')
camera_data.sensor_fit = 'HORIZONTAL'
camera_data.angle = math.radians(38.0)
camera = bpy.data.objects.new('proof_camera', camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (0.55, -2.35, 1.52)
look_at(camera, (0.0, 0.0, 1.16))
scene.camera = camera

full_path = os.path.join(PROOFS, 'char-hero.png')
scene.render.filepath = full_path
bpy.ops.render.render(write_still=True)

image = bpy.data.images.load(full_path, check_existing=False)
image.scale(300, 367)
image.filepath_raw = os.path.join(PROOFS, 'char-hero-distance.png')
image.file_format = 'PNG'
image.save()

scene.render.resolution_x = 700
scene.render.resolution_y = 700
camera.location = (0.0, -0.74, 1.57)
look_at(camera, (0.0, -0.055, 1.55))
face_front_path = os.path.join(PROOFS, 'char-face-front.png')
scene.render.filepath = face_front_path
bpy.ops.render.render(write_still=True)

camera.location = (0.72, -0.08, 1.57)
look_at(camera, (0.0, -0.055, 1.55))
face_profile_path = os.path.join(PROOFS, 'char-face-profile.png')
scene.render.filepath = face_profile_path
bpy.ops.render.render(write_still=True)
hair_proofs = []
for style in ('crop', 'side_part', 'bob', 'slick_back', 'quiff', 'bun'):
    for hair in [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and '_hair_' in obj.name]:
        visible = hair.get('hairStyle') == style
        hair.hide_render = not visible
        hair.hide_viewport = not visible
    for view, location in (
        ('front', (0.0, -0.74, 1.57)),
        ('profile', (0.72, -0.08, 1.57)),
    ):
        camera.location = location
        look_at(camera, (0.0, -0.055, 1.55))
        proof_path = os.path.join(PROOFS, 'char-hair-%s-%s.png' % (style, view))
        scene.render.filepath = proof_path
        bpy.ops.render.render(write_still=True)
        hair_proofs.append(proof_path)
print('RENDER ' + full_path)
print('RENDER ' + image.filepath_raw)
print('RENDER ' + face_front_path)
print('RENDER ' + face_profile_path)
for proof_path in hair_proofs:
    print('RENDER ' + proof_path)

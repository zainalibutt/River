"""Render the seated silver male from behind and from the side, out of the shipped venue.

The seating defect that mattered - a character hovering in front of his chair rather than
sitting on it - is invisible from the front, from the gold review camera, and from every
proof the character pipeline renders in isolation. It is only visible from behind, where
the gap between the seat pan and the figure shows.

So this reads the published venue GLB rather than the character source. Whatever is
actually shipping is what gets photographed, including the chair it is meant to be sitting
on.

Run: blender --background --python-exit-code 1 --python art/pipeline/render_silver_seating_proof.py
"""
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUE = os.path.join(ROOT, '..', 'apps', 'web', 'public', 'assets', 'rooftop_assets.glb')
VENUE = os.path.normpath(os.path.join(ROOT, 'out', 'rooftop_assets.glb'))
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-silver')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_area(name, location, colour, energy, size, target):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color, data.shape, data.size = energy, colour, 'DISK', size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    look_at(light, target)


def main():
    if not os.path.exists(VENUE):
        raise SystemExit('FAIL: missing venue build ' + VENUE)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=VENUE)

    character = [
        obj for obj in bpy.data.objects
        if obj.type == 'MESH' and 'silver' in obj.name.lower()
    ]
    if not character:
        character = [
            obj for obj in bpy.data.objects
            if obj.type == 'MESH' and 'char_native_gold' in obj.name.lower()
        ]
    if not character:
        raise SystemExit('FAIL: no seated character found in the venue build')

    points = [obj.matrix_world @ Vector(corner)
              for obj in character for corner in obj.bound_box]
    centre = sum(points, Vector((0, 0, 0))) / len(points)
    low = min(point.z for point in points)
    high = max(point.z for point in points)
    print('CHARACTER meshes=%d centre=(%.3f, %.3f, %.3f) z=%.3f..%.3f'
          % (len(character), centre.x, centre.y, centre.z, low, high))

    # The character faces the table centre, so "behind" is directly away from the origin.
    outward = Vector((centre.x, centre.y, 0.0))
    if outward.length < 1e-4:
        outward = Vector((0.0, -1.0, 0.0))
    outward.normalize()
    side = Vector((-outward.y, outward.x, 0.0))
    hips = Vector((centre.x, centre.y, low + (high - low) * 0.32))

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_x, scene.render.resolution_y = 900, 900
    scene.world = bpy.data.worlds.new('proof_world')
    scene.world.color = (0.02, 0.024, 0.03)
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.9
    add_area('key', tuple(hips + outward * 2.2 + Vector((0, 0, 2.4))),
             (1.0, 0.92, 0.84), 900.0, 3.0, tuple(hips))
    add_area('fill', tuple(hips + side * 2.6 + Vector((0, 0, 1.6))),
             (0.7, 0.8, 1.0), 500.0, 3.0, tuple(hips))

    data = bpy.data.cameras.new('proof_camera')
    data.sensor_fit = 'HORIZONTAL'
    data.angle = math.radians(34.0)
    camera = bpy.data.objects.new('proof_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    os.makedirs(OUT, exist_ok=True)
    # The venue is small in world units - the seated figure spans about a metre - so a
    # camera 1.6m out lands inside the table or against the next chair back.
    views = (
        ('behind', hips + outward * 3.4 + Vector((0.0, 0.0, 1.55))),
        ('side', hips + side * 3.4 + Vector((0.0, 0.0, 1.05))),
        ('quarter-back', hips + (outward * 2.6 + side * 2.2) + Vector((0.0, 0.0, 1.25))),
        # The hands sit on the rail, which every other camera either looks past or has a
        # chair back in front of. They are the closest thing to camera in play and the
        # first place a bad rest pose shows.
    )
    # Aim at the wrists themselves. Deriving a hand camera from the character's bounding
    # box put it on the felt twice: the hands are a small feature well inboard of the
    # body, and the rail sits between them and any sensible outside viewpoint. The rig
    # ships in the venue GLB, so the bones can just be asked.
    hand_target = None
    for obj in bpy.data.objects:
        if obj.type != 'ARMATURE':
            continue
        wrists = [obj.matrix_world @ bone.head_local
                  for bone in obj.data.bones if bone.name.startswith('wrist')]
        if len(wrists) >= 2:
            hand_target = sum(wrists, Vector((0, 0, 0))) / len(wrists)
            print('WRISTS n=%d target=(%.3f, %.3f, %.3f)'
                  % (len(wrists), hand_target.x, hand_target.y, hand_target.z))
            break
    if hand_target is None:
        print('WRISTS none found, falling back to a rail-height guess')
        hand_target = Vector((centre.x, centre.y, 0.86)) - outward * 0.26
    views = views + (
        ('hands', hand_target - outward * 0.62 + side * 0.30 + Vector((0.0, 0.0, 0.42))),
    )
    others = [obj for obj in bpy.data.objects
              if obj.type == 'MESH' and obj not in character]
    for name, location in views:
        # The hands sit within a couple of centimetres of the rail top, so every camera
        # outside the table has the rail across them. Judging the hand POSE does not need
        # the furniture, so the venue is hidden for that frame only - the seating frames
        # keep it, because there the furniture is the point.
        for obj in others:
            obj.hide_render = (name == 'hands')
        camera.location = location
        look_at(camera, tuple(hand_target if name == 'hands' else hips))
        camera.data.angle = math.radians(26.0 if name == 'hands' else 34.0)
        scene.render.filepath = os.path.join(OUT, 'native-silver-seating-' + name + '.png')
        bpy.ops.render.render(write_still=True)
        print('RENDER ' + scene.render.filepath)


if __name__ == '__main__':
    main()

"""Render the Rooftop with the Silver cast seated, through the cameras a player sees it with.

The browser does not seat the cast yet, so this puts the exported character on every seat
anchor of the built venue, lights it with the venue's own rig and frames it with the
game's own camera numbers: the opening shot, and the shot from behind a seated player.
Close views of one seat then show what those cameras show small - where the forearms meet
the rail, and the knees and feet under the table - across the clips that touch the table.

It is a Blender render of the two files the browser loads, not a browser capture.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/render_silver_table_review.py -- \\
      --venue art/out/rooftop_assets.glb --character art/out/char_native_silver.glb --out <folder>
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
TABLE_SURFACE_HEIGHT = 0.76
# The web's seat ring and camera, from apps/web/src/lib/venue.ts: the camera orbits the
# felt at this radius and height, and a seated player's camera sits on the same azimuth
# as their seat on this ring.
WEB_SEAT_RING = (1.24 * 1.42, 0.72 * 1.58)
WEB_CAMERA = {'radius': 3.2, 'height': 1.5, 'fov': 64.0}
CLOSE_SEAT = 4
HERO_SEAT = 0
POSES = (
    ('IDLE_thinking_readable', 0),
    ('CHECK_tap', 18),
    ('PEEK_card', 24),
    ('CHIP_toss', 15),
    ('ALLIN_standup', 90),
)


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--venue', required=True)
    parser.add_argument('--character', required=True)
    parser.add_argument('--out', required=True)
    return parser.parse_args(argv)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def render(scene, camera, location, target, angle_degrees, size, path):
    camera.location = location
    look_at(camera, target)
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.angle = math.radians(angle_degrees)
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED %s' % path)
    return path


def main():
    args = arguments()
    # Absolute, always. Given a relative path, the first run of this wrote its renders under
    # C:\art\out while the folder Python had made for them in the worktree stayed empty -
    # Blender's image writer and Python did not agree on what the path was relative to.
    args.out = os.path.abspath(args.out)
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # Before any import: the glTF importer keys clips at the rate the scene has then.
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.venue))
    anchors = {int(obj['seatIndex']): obj for obj in bpy.data.objects
               if 'seatIndex' in obj.keys() and obj.get('riverCast') == 'native_silver'}
    if sorted(anchors) != list(range(8)):
        raise SystemExit('FAIL: the venue has native Silver anchors for seats %s' % sorted(anchors))
    # The chip and card pools are instancing sources parked at the origin, and the browser
    # hides them. Rendered, they are loose chips on the floor under the table.
    for obj in bpy.data.objects:
        if 'pool' in obj.name:
            obj.hide_render = True

    sys.path.insert(0, HERE)
    import build_assets
    lights = build_assets.build_lighting('rooftop')
    if not lights:
        raise SystemExit('FAIL: no Rooftop light rig to render with')
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.eevee.taa_render_samples = 48

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.character))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    rig = next(obj for obj in imported if obj.type == 'ARMATURE')
    meshes = [obj for obj in imported if obj.type == 'MESH' and obj.parent == rig]
    if len(meshes) != 20:
        raise SystemExit('FAIL: the character has %d meshes on its rig' % len(meshes))
    clips = {}
    for track in rig.animation_data.nla_tracks:
        clips[track.name] = (track.strips[0].action, track.strips[0].action_slot)
        track.mute = True

    # Each pose baked once to static meshes, then shared by every seat that shows it.
    baked = {}
    for clip, frame in POSES:
        action, slot = clips[clip]
        rig.animation_data.action = action
        rig.animation_data.action_slot = slot
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        baked[(clip, frame)] = [
            (obj.name, bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph),
             obj.matrix_world.copy())
            for obj in meshes
        ]
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)

    seated = {}
    for seat, anchor in anchors.items():
        placed = []
        for name, data, local in baked[POSES[0]]:
            obj = bpy.data.objects.new('seat%d %s' % (seat, name), data)
            scene.collection.objects.link(obj)
            obj.matrix_world = anchor.matrix_world @ local
            placed.append(obj)
        seated[seat] = placed

    camera = bpy.data.objects.new('review camera', bpy.data.cameras.new('review camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    target = Vector((0.0, 0.0, TABLE_SURFACE_HEIGHT))
    radius, height, fov = WEB_CAMERA['radius'], WEB_CAMERA['height'], WEB_CAMERA['fov']
    outputs = []

    outputs.append(render(scene, camera, Vector((0.0, -radius, height)), target, fov, (1920, 1080),
                          os.path.join(args.out, '01-opening-camera.png')))

    angle = math.pi / 2 + 2.0 * math.pi * (HERO_SEAT + 1) / 9
    seat_x, seat_y = WEB_SEAT_RING[0] * math.cos(angle), WEB_SEAT_RING[1] * math.sin(angle)
    azimuth = math.atan2(seat_x, -seat_y)
    outputs.append(render(scene, camera, Vector((radius * math.sin(azimuth), -radius * math.cos(azimuth), height)),
                          target, fov, (1920, 1080), os.path.join(args.out, '02-seated-player-camera.png')))

    anchor = anchors[CLOSE_SEAT]
    origin = anchor.matrix_world.translation.copy()
    outward = Vector((origin.x, origin.y, 0.0)).normalized()
    lateral = Vector((-outward.y, outward.x, 0.0))
    front_from = origin - outward * 1.05 + Vector((0.0, 0.0, 1.18))
    front_at = origin - outward * 0.22 + Vector((0.0, 0.0, 0.82))
    panels = []
    for pose in POSES:
        for obj, (name, data, local) in zip(seated[CLOSE_SEAT], baked[pose]):
            obj.data = data
        panels.append(render(scene, camera, front_from, front_at, 44.0, (960, 720),
                             os.path.join(args.out, 'close-%s-%03d.png' % pose)))
    for obj, (name, data, local) in zip(seated[CLOSE_SEAT], baked[POSES[0]]):
        obj.data = data

    # Side on, low, with the neighbours' characters and chairs out of the way.
    hidden = []
    for neighbour in ((CLOSE_SEAT - 1) % 8, (CLOSE_SEAT + 1) % 8):
        hidden.extend(seated[neighbour])
        chair = bpy.data.objects.get('rooftop_chair_%d' % (neighbour + 1))
        if chair is not None:
            hidden.append(chair)
    for obj in hidden:
        obj.hide_render = True
    outputs.append(render(scene, camera, origin + lateral * 1.75 - outward * 0.10 + Vector((0.0, 0.0, 0.34)),
                          origin - outward * 0.22 + Vector((0.0, 0.0, 0.30)), 40.0, (1280, 960),
                          os.path.join(args.out, '04-side-knees-and-feet.png')))
    for obj in hidden:
        obj.hide_render = False

    tiles = []
    for path in panels:
        image = bpy.data.images.load(path)
        width, tall = image.size
        tiles.append(np.array(image.pixels[:], dtype=np.float32).reshape(tall, width, 4))
        bpy.data.images.remove(image)
    blank = np.zeros_like(tiles[0])
    blank[..., 3] = 1.0
    rows = [np.hstack(tiles[:3]), np.hstack(tiles[3:] + [blank] * (6 - len(tiles)))]
    sheet = np.vstack(list(reversed(rows)))
    image = bpy.data.images.new('close sheet', sheet.shape[1], sheet.shape[0], alpha=True)
    image.pixels.foreach_set(sheet.reshape(-1))
    image.filepath_raw = os.path.join(args.out, '03-seat-%d-close-sheet.png' % CLOSE_SEAT)
    image.file_format = 'PNG'
    image.save()
    outputs.append(image.filepath_raw)
    for path in outputs:
        print('REVIEW %s' % path)


if __name__ == '__main__':
    main()

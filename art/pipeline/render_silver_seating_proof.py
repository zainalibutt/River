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


def render_turntable(scene, camera, character, others, centre, radius, height, tag,
                     steps=8, size=(420, 520)):
    """One image, the character from every side.

    Adding a camera at a time and declaring the pose fixed when that camera looked clean
    has now failed three times running - the seating hover hid from the front, the twisted
    forearm hid from behind, and a collapsed shoulder hid from both because the close arm
    cameras looked at it side-on. A defect that is visible from one bearing and not another
    is not a defect anyone can chase one render at a time.

    So: a full circle, close, with the venue hidden, tiled into a single contact sheet.
    """
    import numpy as np

    for obj in others:
        obj.hide_render = True
    scene.render.resolution_x, scene.render.resolution_y = size
    camera.data.angle = math.radians(30.0)
    strip = os.path.join(OUT, '_turn')
    os.makedirs(strip, exist_ok=True)
    tiles = []
    for index in range(steps):
        angle = 2.0 * math.pi * index / steps
        camera.location = centre + Vector((math.sin(angle) * radius,
                                           math.cos(angle) * radius,
                                           height))
        look_at(camera, tuple(centre))
        path = os.path.join(strip, '%02d.png' % index)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(path)
        width, tall = image.size
        tiles.append(np.array(image.pixels[:], dtype=np.float32).reshape(tall, width, 4))
        bpy.data.images.remove(image)
        os.remove(path)
    half = steps // 2
    sheet = np.vstack([np.hstack(tiles[:half]), np.hstack(tiles[half:])])
    out = bpy.data.images.new('turntable_' + tag, sheet.shape[1], sheet.shape[0],
                              alpha=True)
    out.pixels = sheet.reshape(-1).tolist()
    out.filepath_raw = os.path.join(OUT, 'native-silver-turntable-' + tag + '.png')
    out.file_format = 'PNG'
    out.save()
    print('TURNTABLE %s %d angles' % (tag, steps))
    for obj in others:
        obj.hide_render = False


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
    # Front, back and both three-quarters, every time. Defects on this character have
    # hidden from single angles repeatedly: the hover was invisible except from behind,
    # the twisted forearms were invisible except from the front, and a flattering side
    # view was reported as finished twice. A pose is not checked until all four agree.
    views = (
        ('front', hips - outward * 2.7 + Vector((0.0, 0.0, 1.45))),
        ('front-quarter', hips + (-outward * 2.4 + side * 2.1)
         + Vector((0.0, 0.0, 1.35))),
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
    # From the geometry, not from the rig. Aiming at the wrist bones' head_local put the
    # camera on the sternum: whatever the venue does to the armature between import and
    # export, those bone positions do not land where the hands visibly are, and a camera
    # named "hands" spent several review rounds photographing a lapel.
    #
    # The body mesh is a head, a neck and two hands - the suit's delete groups removed
    # everything else - so the hands are simply its lower half.
    hand_target = None
    body = next((obj for obj in character
                 if 'body' in (obj.name + obj.data.name).lower()), None)
    if body is not None:
        # The forwardmost of them, not the lowest: the shoes' delete group leaves the
        # ankles behind, so "the lower half of the body mesh" is feet, not hands. With
        # the arms out on the table the hands are the part of him nearest the felt, and
        # nothing else on that mesh competes.
        points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
        crown = max(point.z for point in points)
        # Below the chin first. A seated man leaning slightly forward puts his FACE as
        # far over the table as his hands, and the face carries far more vertices than
        # both hands together, so "the most forward part of the body mesh" is a nose.
        below = [point for point in points if point.z < crown - 0.30]
        reach = sorted(below, key=lambda point: point.dot(outward))
        forward = reach[:max(200, len(reach) // 4)]
        if len(forward) > 200:
            hand_target = sum(forward, Vector((0, 0, 0))) / len(forward)
            span = max((point - hand_target).length for point in forward)
            print('HANDS %d of %d body vertices, target=(%.3f, %.3f, %.3f), spread '
                  '%.0fmm, %.0fmm in front of the body centre'
                  % (len(forward), len(points), hand_target.x, hand_target.y,
                     hand_target.z, span * 1000.0,
                     (centre - hand_target).dot(outward) * 1000.0))
            # Two hands side by side span about 300mm. Anything much wider means the
            # selection caught something else as well and the camera would be aimed at
            # the average of two unrelated places - which is exactly how this camera
            # ended up photographing a lapel and then a lap.
            if span > 0.30:
                raise SystemExit('FAIL: the vertices taken for hands spread %.0fmm, '
                                 'which is not a pair of hands' % (span * 1000.0))
    if hand_target is None:
        raise SystemExit(
            'FAIL: could not locate the hands from the body mesh, so the hand camera '
            'would be pointed at a guess. body=%r, character meshes were: %s'
            % (body and body.name, ', '.join(sorted(
                '%s/%s' % (obj.name, obj.data.name) for obj in character))))
    # Close on each arm, from both sides.
    #
    # Every camera above sits 3.4m out and only ever shoots one side of the character. A
    # shoulder that deforms badly reads as fine at that distance, and the far arm is never
    # photographed at all - which is how a visibly broken right arm survived a proof that
    # was reported complete. Distance and one-sidedness were both hiding it.
    shoulders = {}
    for armature_object in bpy.data.objects:
        if armature_object.type != 'ARMATURE':
            continue
        for suffix in ('L', 'R'):
            bone = armature_object.data.bones.get('upperarm01.' + suffix)
            elbow = armature_object.data.bones.get('lowerarm01.' + suffix)
            if bone is not None and elbow is not None:
                shoulders[suffix] = (armature_object.matrix_world @ bone.head_local,
                                     armature_object.matrix_world @ elbow.head_local)
        if shoulders:
            break
    arm_targets = {}
    for suffix, (shoulder, elbow) in shoulders.items():
        focus = (shoulder + elbow) * 0.5
        # Out to the character's own left or right, not to a fixed world side.
        lateral = side if suffix == 'L' else -side
        views = views + (
            ('arm-' + suffix.lower(),
             focus + lateral * 1.05 - outward * 0.45 + Vector((0.0, 0.0, 0.30))),
        )
        arm_targets['arm-' + suffix.lower()] = focus

    # Above and in front, looking down at the wrists. The previous placement carried a
    # 0.30 sideways offset that swung the camera across the table, so the frame filled
    # with jacket and thigh and the hands were not in it at all - which is how a pair of
    # fanned, palm-on-edge hands survived several rounds of review while the camera named
    # "hands" was pointing at a lapel.
    views = views + (
        ('hands', hand_target - outward * 0.34 + Vector((0.0, 0.0, 0.30))),
    )
    others = [obj for obj in bpy.data.objects
              if obj.type == 'MESH' and obj not in character]
    for name, location in views:
        # The hands sit within a couple of centimetres of the rail top, so every camera
        # outside the table has the rail across them. Judging the hand POSE does not need
        # the furniture, so the venue is hidden for that frame only - the seating frames
        # keep it, because there the furniture is the point.
        # Hide the venue for the close reads. The rail and the neighbouring stools sit
        # between every outside camera and the thing being judged.
        for obj in others:
            obj.hide_render = (name == 'hands' or name in arm_targets)
        camera.location = location
        if name == 'hands':
            aim_at = hand_target
        elif name in arm_targets:
            aim_at = arm_targets[name]
        else:
            aim_at = hips
        look_at(camera, tuple(aim_at))
        camera.data.angle = math.radians(
            26.0 if name == 'hands' or name in arm_targets else 34.0)
        scene.render.filepath = os.path.join(OUT, 'native-silver-seating-' + name + '.png')
        bpy.ops.render.render(write_still=True)
        print('RENDER ' + scene.render.filepath)

    # The hands get their own circle. The single "hands" camera has now been aimed at a
    # lapel and at a lap across successive builds, and each time the fix was another
    # guess at a position. A ring of eight cannot all be pointing at the wrong thing, and
    # the same code already works for the torso.
    render_turntable(scene, camera, character, others, hand_target, 0.55, 0.26, 'hands',
                     size=(460, 460))

    # The head, for the hair. The back of the skull is the one part of him no seating
    # camera has ever framed - every one of them is aimed at the pose - and it is where
    # the stock hair shell ends in a hard cut across the nape.
    render_turntable(scene, camera, character, others,
                     Vector((centre.x, centre.y, high - (high - low) * 0.09)),
                     0.62, 0.06, 'head', size=(460, 460))

    torso = Vector((centre.x, centre.y, low + (high - low) * 0.72))
    render_turntable(scene, camera, character, others, torso, 1.15, 0.12, 'torso')
    render_turntable(scene, camera, character, others,
                     Vector((centre.x, centre.y, low + (high - low) * 0.5)),
                     2.10, 0.35, 'whole')


if __name__ == '__main__':
    main()

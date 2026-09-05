"""Measure where the silver character's body escapes his suit, and where he enters the table.

Two defects were being argued about by eye and neither could be settled that way:

  - a lump and a corkscrew crease at the shoulder and armpit, which could be the suit
    deforming badly or the naked body underneath pushing through it, and
  - hands and forearms passing into the table rail.

Both are the same question - does surface A end up on the wrong side of surface B - so
both get the same instrument: a signed-distance test against a BVH of the other surface.
It reports a count and a depth rather than an opinion, and it renders the two shells
separately so the answer to "is it the suit or him" is a picture rather than a claim.

MakeHuman clothing carries a delete list for the body underneath it, but
male_elegantsuit01's covers only part of the torso - it does not touch the arms. So the
naked arms ship inside the sleeves, skinned by a different weight set to the sleeve that
covers them, and the two surfaces come apart wherever the pose is far from rest.

Run: blender --background --python-exit-code 1 --python art/pipeline/diagnose_silver_shell.py
"""
import math
import os

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUE = os.path.normpath(os.path.join(ROOT, 'out', 'rooftop_assets.glb'))
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-silver')

BODY = 'body_silver'
SUIT = 'silver_suit'
TABLE = ('rooftop_rail', 'rooftop_felt', 'rooftop_wood')


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def world_mesh(obj):
    """Vertices and polygons in world space, ready for a BVH."""
    matrix = obj.matrix_world
    verts = [matrix @ v.co for v in obj.data.vertices]
    polys = [tuple(p.vertices) for p in obj.data.polygons]
    return verts, polys


def exposure(inner, outer, reach=0.06):
    """For each vertex of `inner`, whether `outer` covers it, by casting along its normal.

    The first version of this compared each vertex against the normal of the nearest face
    of the suit. That reads as "94% of the torso is 140mm outside the jacket", which is
    nonsense: the suit is an open shell - sleeves are tubes, the jacket has a hem, a
    collar hole and two lapel edges - so for a vertex deep in the chest the nearest face
    is often an edge whose normal points sideways, and the sign means nothing.

    A vertex is covered if a short ray along its own outward normal hits the garment.
    That is exactly the question being asked - would you see this bit of skin - and it
    handles the open shell correctly: a knuckle past the cuff sends its ray into free
    air, so hands stay classified as exposed, which they should be.

    Returns (covered, exposed) as lists of (distance_to_garment, world_point).
    """
    verts, polys = world_mesh(outer)
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    matrix = inner.matrix_world
    rotation = matrix.to_3x3()
    covered, exposed = [], []
    for vertex in inner.data.vertices:
        point = matrix @ vertex.co
        direction = (rotation @ vertex.normal).normalized()
        location, normal, index, distance = tree.ray_cast(point, direction, reach)
        if location is None:
            exposed.append((0.0, point))
        else:
            covered.append((distance, point))
    return covered, exposed


def render_source_shoulder():
    """The same shoulder on the character as built, before anything posed it.

    This is the question one level down from "is it the suit or him": the suit shoulder
    is clearly wrong in the shipped build, but that is either how MakeHuman's
    male_elegantsuit01 is shaped, or something the seated bake did to it. Those have
    completely different fixes - one is an asset problem, the other is a skinning problem
    - and no amount of looking at the shipped build distinguishes them.

    The character source is saved unposed, in the bind pose, so it can just be opened.
    """
    source = os.path.join(OUT, 'native-silver-character.blend')
    if not os.path.exists(source):
        print('SOURCE missing %s - cannot compare against the bind pose' % source)
        return
    bpy.ops.wm.open_mainfile(filepath=source)
    suit = next((o for o in bpy.data.objects
                 if o.type == 'MESH' and 'suit' in (o.name + o.data.name).lower()), None)
    armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if suit is None or armature is None:
        print('SOURCE suit=%r armature=%r' % (suit, armature))
        return
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.hide_render = obj is not suit

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_x, scene.render.resolution_y = 760, 760
    scene.world = bpy.data.worlds.new('diagnostic_source')
    scene.world.color = (0.05, 0.05, 0.06)
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 1.1
    for light in [o for o in bpy.data.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(light, do_unlink=True)

    data = bpy.data.cameras.new('source_camera')
    data.angle = math.radians(38.0)
    camera = bpy.data.objects.new('source_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    for suffix in ('L', 'R'):
        bone = armature.data.bones.get('upperarm01.' + suffix)
        elbow = armature.data.bones.get('lowerarm01.' + suffix)
        if bone is None or elbow is None:
            continue
        shoulder = armature.matrix_world @ bone.head_local
        focus = shoulder.lerp(armature.matrix_world @ elbow.head_local, 0.45)
        lateral = Vector((1.0 if suffix == 'L' else -1.0, 0.0, 0.0))
        for light in [o for o in bpy.data.objects if o.type == 'LIGHT']:
            bpy.data.objects.remove(light, do_unlink=True)
        for name, offset, energy in (('key', lateral * 1.1 + Vector((0, 0, 0.9)), 260.0),
                                     ('rim', Vector((0, -1.2, 0.5)), 160.0)):
            light_data = bpy.data.lights.new(name, 'AREA')
            light_data.energy, light_data.size = energy, 1.4
            light = bpy.data.objects.new(name, light_data)
            scene.collection.objects.link(light)
            light.location = focus + offset
            look_at(light, tuple(focus))
        camera.location = focus + lateral * 0.95 + Vector((0.0, -0.55, 0.28))
        look_at(camera, tuple(focus))
        scene.render.filepath = os.path.join(
            OUT, 'native-silver-shell-%s-source.png' % suffix.lower())
        bpy.ops.render.render(write_still=True)
        print('RENDER ' + scene.render.filepath)


def main():
    if not os.path.exists(VENUE):
        raise SystemExit('FAIL: missing venue build ' + VENUE)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=VENUE)

    # Match on the object name AND the mesh datablock name. The glTF importer names the
    # two independently, and matching only the object silently found nothing.
    meshes = {obj.name: obj for obj in bpy.data.objects if obj.type == 'MESH'}

    def find(token):
        for name, obj in meshes.items():
            if token in name or token in obj.data.name:
                return obj
        return None

    body, suit = find(BODY), find(SUIT)
    if body is None or suit is None:
        print('MESHES ' + ', '.join(sorted(meshes)))
        raise SystemExit('FAIL: body=%r suit=%r - cannot compare shells'
                         % (body and body.name, suit and suit.name))

    covered, exposed = exposure(body, suit)
    if not covered:
        raise SystemExit('FAIL: not one body vertex reads as covered by the suit, so the '
                         'coverage test measured nothing')
    total = len(covered) + len(exposed)
    print('BODY verts=%d  covered-by-the-suit=%d (%.1f%%)  exposed=%d'
          % (total, len(covered), 100.0 * len(covered) / total, len(exposed)))

    # Exposed skin is correct at the head, hands and ankles and wrong anywhere the suit
    # is meant to be. Split by height so the report names a place.
    zs = [p.z for _, p in covered + exposed]
    low, high = min(zs), max(zs)
    for name, lo, hi in (('hip/thigh', 0.20, 0.42), ('waist', 0.42, 0.58),
                         ('chest', 0.58, 0.72), ('shoulder/armpit', 0.72, 0.86),
                         ('head/neck', 0.86, 1.01)):
        band = [p for _, p in exposed
                if low + (high - low) * lo <= p.z < low + (high - low) * hi]
        under = [p for _, p in covered
                 if low + (high - low) * lo <= p.z < low + (high - low) * hi]
        print('   %-16s exposed %5d   under the suit %5d' % (name, len(band), len(under)))

    # The same test again, against the furniture. This is what "collision" should mean
    # for a character whose pose is baked and never simulated: not a runtime solver, but
    # a build-time gate that fails when a hand is inside the rail.
    character = [o for n, o in meshes.items()
                 if 'silver' in (n + o.data.name).lower()
                 or 'char_native' in (n + o.data.name).lower()]
    for part in TABLE:
        furniture = next((o for n, o in meshes.items()
                          if part in n or part in o.data.name), None)
        if furniture is None:
            print('TABLE %-16s NOT FOUND - nothing was tested against it' % part)
            continue
        verts, polys = world_mesh(furniture)
        tree = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
        worst_depth, worst_at, count = 0.0, None, 0
        for obj in character:
            for vertex in obj.data.vertices:
                point = obj.matrix_world @ vertex.co
                location, normal, index, distance = tree.find_nearest(point, 0.12)
                if location is None:
                    continue
                depth = (location - point).dot(normal)
                if depth > 0.0005:
                    count += 1
                    if depth > worst_depth:
                        worst_depth, worst_at = depth, point
        if count:
            print('TABLE %-16s %d character verts inside it, worst %.1fmm at '
                  '(%.3f, %.3f, %.3f)'
                  % (part, count, worst_depth * 1000.0,
                     worst_at.x, worst_at.y, worst_at.z))
        else:
            print('TABLE %-16s clear' % part)

    # Now the picture: the same shoulder, three times - both shells, the suit alone, the
    # body alone. Whichever one carries the lump is the one at fault.
    armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if armature is None:
        raise SystemExit('FAIL: no armature in the venue build')
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_x, scene.render.resolution_y = 760, 760
    scene.world = bpy.data.worlds.new('diagnostic')
    scene.world.color = (0.05, 0.05, 0.06)
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 1.1

    data = bpy.data.cameras.new('diagnostic_camera')
    data.angle = math.radians(24.0)
    camera = bpy.data.objects.new('diagnostic_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    os.makedirs(OUT, exist_ok=True)

    # Straight on, front and back, at the armpits.
    #
    # Every camera aimed at this shoulder so far has been side-on or a three-quarter, and
    # a fold in the armpit closes up into the silhouette from both. Reporting the crease
    # fixed off those views has now been wrong twice. An armpit is a crease between two
    # surfaces that meet edge-on to a side camera and face-on to a front or back one, so
    # these are the two bearings that can actually see it.
    pits = []
    for suffix in ('L', 'R'):
        bone = armature.data.bones.get('upperarm01.' + suffix)
        spine = armature.data.bones.get('spine03') or armature.data.bones.get('spine02')
        if bone is None or spine is None:
            continue
        joint = armature.matrix_world @ bone.head_local
        middle = armature.matrix_world @ spine.head_local
        pits.append(joint.lerp(Vector((middle.x, middle.y, joint.z)), 0.30)
                    - Vector((0.0, 0.0, 0.045)))
    if pits:
        focus = sum(pits, Vector((0, 0, 0))) / len(pits)
        facing = Vector((focus.x, focus.y, 0.0))
        facing = facing.normalized() if facing.length > 1e-4 else Vector((0.0, 1.0, 0.0))
        for tag, offset in (('front', -facing * 0.85), ('back', facing * 0.85)):
            for light in [o for o in bpy.data.objects if o.type == 'LIGHT']:
                bpy.data.objects.remove(light, do_unlink=True)
            for name, place, energy in (('key', offset + Vector((0, 0, 0.7)), 320.0),
                                        ('fill', -offset * 0.5 + Vector((0, 0, 0.4)), 150.0)):
                light_data = bpy.data.lights.new(name, 'AREA')
                light_data.energy, light_data.size = energy, 1.6
                light = bpy.data.objects.new(name, light_data)
                scene.collection.objects.link(light)
                light.location = focus + place
                look_at(light, tuple(focus))
            camera.data.angle = math.radians(40.0)
            camera.location = focus + offset + Vector((0.0, 0.0, 0.16))
            look_at(camera, tuple(focus))
            for obj in meshes.values():
                obj.hide_render = obj not in (body, suit)
            scene.render.filepath = os.path.join(
                OUT, 'native-silver-armpit-%s.png' % tag)
            bpy.ops.render.render(write_still=True)
            print('RENDER ' + scene.render.filepath)

    for suffix in ('L', 'R'):
        bone = armature.data.bones.get('upperarm01.' + suffix)
        elbow = armature.data.bones.get('lowerarm01.' + suffix)
        if bone is None or elbow is None:
            continue
        shoulder = armature.matrix_world @ bone.head_local
        focus = shoulder.lerp(armature.matrix_world @ elbow.head_local, 0.45)
        outward = Vector((focus.x, focus.y, 0.0)).normalized()
        side = Vector((-outward.y, outward.x, 0.0))
        lateral = side if suffix == 'L' else -side

        for light in [o for o in bpy.data.objects if o.type == 'LIGHT']:
            bpy.data.objects.remove(light, do_unlink=True)
        for name, offset, energy in (('key', lateral * 1.1 + Vector((0, 0, 0.9)), 260.0),
                                     ('rim', -outward * 1.2 + Vector((0, 0, 0.5)), 160.0)):
            light_data = bpy.data.lights.new(name, 'AREA')
            light_data.energy, light_data.size = energy, 1.4
            light = bpy.data.objects.new(name, light_data)
            scene.collection.objects.link(light)
            light.location = focus + offset
            look_at(light, tuple(focus))

        # Far enough back to hold the whole shoulder, the armpit and the top of the arm
        # in frame. The first pass sat 0.5m out at a 24 degree lens and filled the frame
        # with a lapel, which cannot show whether a shoulder is the right shape.
        camera.data.angle = math.radians(38.0)
        camera.location = focus + lateral * 0.95 - outward * 0.55 + Vector((0, 0, 0.28))
        look_at(camera, tuple(focus))
        for tag, shown in (('both', (body, suit)), ('suit', (suit,)), ('body', (body,))):
            for obj in meshes.values():
                obj.hide_render = obj not in shown
            scene.render.filepath = os.path.join(
                OUT, 'native-silver-shell-%s-%s.png' % (suffix.lower(), tag))
            bpy.ops.render.render(write_still=True)
            print('RENDER ' + scene.render.filepath)


if __name__ == '__main__':
    main()
    # Last, because opening the character source discards the venue scene.
    render_source_shoulder()

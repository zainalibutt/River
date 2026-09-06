"""Find surfaces that pass through each other, in the build that ships.

Two defects on the silver character are the same fault wearing different clothes: the
sleeve passing through the jacket's back panel at the armpit, and hands passing into the
table rail. Both are one surface ending up on the wrong side of another, and neither is
visible to any measurement the pipeline currently takes - the armpit survived a day of
pose tuning and a shoulder weight pass because every camera aimed at it met the crease
edge-on, and the table clipping has only ever been reported by a person looking at it.

Runtime collision is the wrong tool for either. The character's pose is baked; nothing is
simulated, so there is nothing for a solver to resolve. What is needed is a build-time
test that fails when two surfaces occupy the same space, which is what this is.

Both jobs use BVHTree.overlap, which does real triangle-triangle intersection rather than
comparing bounding volumes. For one mesh against itself, faces that share a vertex touch
by construction and are excluded; anything left is geometry folded through itself.

Run: blender --background --python-exit-code 1 --python art/pipeline/check_penetration.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUE = os.path.normpath(os.path.join(ROOT, 'out', 'rooftop_assets.glb'))

FURNITURE = ('rooftop_rail', 'rooftop_felt', 'rooftop_wood', 'rooftop_chair')


def world_geometry(obj):
    matrix = obj.matrix_world
    verts = [matrix @ vertex.co for vertex in obj.data.vertices]
    polys = [tuple(polygon.vertices) for polygon in obj.data.polygons]
    return verts, polys


def self_intersections(obj):
    """Face pairs of one mesh that pass through each other.

    Neighbours are excluded by shared vertex rather than by distance: two faces of a
    folded sleeve can be a millimetre apart and genuinely intersecting, so any threshold
    that removes adjacency also removes the defect.
    """
    verts, polys = world_geometry(obj)
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    corners = [set(poly) for poly in polys]
    found = []
    for first, second in tree.overlap(tree):
        if first >= second:
            continue
        if corners[first] & corners[second]:
            continue
        found.append((first, second))
    return found, verts, polys


def nearest_bone(armature, point, limit=0.25):
    best, distance = None, limit
    for bone in armature.data.bones:
        if not bone.use_deform:
            continue
        head = armature.matrix_world @ bone.head_local
        tail = armature.matrix_world @ bone.tail_local
        span = tail - head
        length = span.length
        if length < 1e-6:
            continue
        along = max(0.0, min(1.0, (point - head).dot(span) / (length * length)))
        gap = (point - (head + span * along)).length
        if gap < distance:
            best, distance = bone.name, gap
    return best, distance


def cluster(points, reach=0.09):
    """Group intersection sites so a report names places, not thousands of faces."""
    groups = []
    for point in points:
        for group in groups:
            if (group[0] - point).length < reach:
                group[1].append(point)
                break
        else:
            groups.append((point, [point]))
    return sorted(groups, key=lambda group: -len(group[1]))


def main():
    if not os.path.exists(VENUE):
        raise SystemExit('FAIL: missing venue build ' + VENUE)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=VENUE)

    meshes = {obj.name: obj for obj in bpy.data.objects if obj.type == 'MESH'}
    armature = next((obj for obj in bpy.data.objects if obj.type == 'ARMATURE'), None)

    def find(token):
        for name, obj in meshes.items():
            if token in name or token in obj.data.name:
                return obj
        return None

    failures = []

    suit = find('silver_suit')
    if suit is None:
        raise SystemExit('FAIL: no silver suit in the venue build to test')
    pairs, verts, polys = self_intersections(suit)
    print('SELF %-28s %d intersecting face pairs of %d faces'
          % (suit.name, len(pairs), len(polys)))
    if pairs:
        sites = []
        for first, second in pairs:
            centre = sum((verts[index] for index in polys[first]), Vector((0, 0, 0)))
            sites.append(centre / len(polys[first]))
        for centre, members in cluster(sites)[:14]:
            where = ''
            if armature is not None:
                bone, gap = nearest_bone(armature, centre)
                if bone is not None:
                    where = '  nearest bone %s at %.0fmm' % (bone, gap * 1000.0)
            print('   %4d faces around (%.3f, %.3f, %.3f)%s'
                  % (len(members), centre.x, centre.y, centre.z, where))
        failures.append('%s intersects itself in %d places' % (suit.name, len(pairs)))

    # The character against the furniture. Same test, different pair of surfaces - and
    # the reason the earlier attempt at this produced numbers clamped at its own search
    # radius is that it asked which side of a nearest FACE NORMAL a point was on. On an
    # open shell, or a slab, that normal means nothing. Triangle-triangle intersection
    # asks the question directly and has no threshold to get wrong.
    people = [obj for name, obj in meshes.items()
              if 'silver' in (name + obj.data.name).lower()]
    for token in FURNITURE:
        props = [obj for name, obj in meshes.items()
                 if token in name or token in obj.data.name]
        if not props:
            print('CLEAR %-16s NOT FOUND - nothing was tested against it' % token)
            continue
        hits = 0
        worst = None
        for prop in props:
            prop_verts, prop_polys = world_geometry(prop)
            tree = BVHTree.FromPolygons(prop_verts, prop_polys, all_triangles=False,
                                        epsilon=0.0)
            for person in people:
                person_verts, person_polys = world_geometry(person)
                other = BVHTree.FromPolygons(person_verts, person_polys,
                                             all_triangles=False, epsilon=0.0)
                overlaps = tree.overlap(other)
                if overlaps:
                    hits += len(overlaps)
                    face = overlaps[0][1]
                    centre = sum((person_verts[i] for i in person_polys[face]),
                                 Vector((0, 0, 0))) / len(person_polys[face])
                    worst = (person.name, centre)
        if hits:
            print('CLEAR %-16s %d intersecting faces, e.g. %s at (%.3f, %.3f, %.3f)'
                  % (token, hits, worst[0], worst[1].x, worst[1].y, worst[1].z))
            failures.append('the character passes through %s in %d faces' % (token, hits))
        else:
            print('CLEAR %-16s clear' % token)

    if failures:
        for line in failures:
            print('PENETRATION ' + line)
        raise SystemExit('FAIL: %d surface(s) pass through something they should not'
                         % len(failures))
    print('PENETRATION none')


if __name__ == '__main__':
    main()

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

The counts are held to a budget rather than to zero. See BUDGET below for why.

Run: npm run check:penetration
  or blender --background --python-exit-code 1 --python art/pipeline/check_penetration.py
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

# What the build currently does wrong, measured on 2026-09-08, so that it cannot
# start doing it more.
#
# A gate that fails on a known-bad state blocks every branch until somebody fixes
# a defect that predates their change, and the usual next step is to delete the
# gate. So this one is a ratchet: the numbers below are a budget, exceeding one
# fails the build, and coming in under one prints the lower figure to move it to.
# It does not claim any of this is acceptable. It claims it will not get worse
# without somebody saying so in a diff.
#
# The count is faces, not depth. Two surfaces grazing by a tenth of a millimetre
# and an arm buried to the elbow both count as one face each, so a fall in these
# numbers is evidence of less penetration and not of shallower penetration. If
# that distinction ever matters, it needs a different measurement rather than a
# reinterpretation of this one.
BUDGET = {
    'self': 1449,
    'rooftop_rail': 277,
    'rooftop_chair': 205,
    'rooftop_wood': 192,
    'rooftop_felt': 49,
}


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

    measured = {}

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
    measured['self'] = len(pairs)

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
            # A gate that passes because it looked at nothing is worse than no
            # gate, and this project has shipped one of those before. If the
            # furniture is renamed, this must fail rather than report clear.
            raise SystemExit('FAIL: no mesh named %s in the venue build, so nothing '
                             'was tested against it' % token)
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
        else:
            print('CLEAR %-16s clear' % token)
        measured[token] = hits

    regressions, gains = [], []
    for name, budget in sorted(BUDGET.items()):
        if name not in measured:
            raise SystemExit('FAIL: %s has a budget but was never measured' % name)
        count = measured[name]
        if count > budget:
            regressions.append('%s %d faces, budget %d, worse by %d'
                               % (name, count, budget, count - budget))
        elif count < budget:
            gains.append('%s %d faces, budget %d, lower it by %d'
                         % (name, count, budget, budget - count))
    for name in sorted(set(measured) - set(BUDGET)):
        raise SystemExit('FAIL: %s was measured at %d faces and has no budget, so a '
                         'regression in it could not be caught' % (name, measured[name]))

    for line in gains:
        print('BUDGET improved ' + line)
    if regressions:
        for line in regressions:
            print('BUDGET regressed ' + line)
        raise SystemExit('FAIL: %d penetration budget(s) exceeded' % len(regressions))
    total = sum(measured.values())
    print('PENETRATION within budget, %d intersecting faces in total across %d sites'
          % (total, len(measured)))


if __name__ == '__main__':
    main()

"""Measure where the jacket creases, and how badly, through every shipping clip.

"Clustered creasing" is a judgement until it is a number. A garment creases where the skin
weights fold it: two faces sharing an edge swing past each other and the surface pleats into
a fan of hard edges in one small place, which is what an elbow or a shoulder does to a
sleeve the rig was not weighted for. That reads as a crumpled bin bag from the gameplay
camera even though every bone is exactly where it was authored.

So this measures the fold directly. For each frame of each clip it evaluates the deformed
mesh and takes the angle between the two faces of every interior edge. An edge folded past
the threshold is a crease; creases are grouped by the bone that owns most of their weight,
so the report says "the right elbow" rather than "somewhere on 4,000 faces". The rest pose
is measured too and subtracted: a tailored jacket has seams and a collar that are folded
before anybody moves, and those are not what anyone is complaining about.

Read-only. Nothing is written to the candidate.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/check_jacket_creasing.py -- \\
      --candidate <silver-integration-candidate.blend> --out <report.json>
"""
import argparse
import json
import math
import os
import sys
from collections import defaultdict

import bpy
from mathutils import Vector

CLIPS = {
    'IDLE_thinking_readable': 120,
    'CHECK_tap': 36,
    'PEEK_card': 48,
    'CHIP_toss': 30,
    'ALLIN_standup': 90,
    'SIT_enter': 108,
    'LEAVE_getup': 132,
}
GARMENT = 'A11 tailored dinner jacket'
# Past this the two faces have folded over far enough to catch the light as a hard pleat.
# A smooth-shaded bend runs well under it; a candy-wrapper pinch runs past 120.
CREASE_DEGREES = 100.0
STEP = 3


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--garment', default=GARMENT)
    parser.add_argument('--threshold', type=float, default=CREASE_DEGREES)
    return parser.parse_args(argv)


def find_garment(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        candidates = [o.name for o in bpy.data.objects if o.type == 'MESH']
        raise SystemExit('FAIL: no %s among %s' % (name, ', '.join(sorted(candidates))))
    return obj


def nearest_bone(point, rig):
    """The bone a crease is sitting on, by distance to the bone itself.

    Asked of the posed armature rather than of the vertex groups, because the garment is
    evaluated through its modifiers before it is measured and an evaluated mesh has more
    vertices than the one carrying the weights - indexing one with the other's numbers reads
    a different part of the body, when it does not simply fall off the end.
    """
    best, closest = 'nowhere', None
    for bone in rig.pose.bones:
        head = rig.matrix_world @ bone.head
        tail = rig.matrix_world @ bone.tail
        along = tail - head
        length = along.length_squared
        if length == 0.0:
            distance = (point - head).length
        else:
            mix = max(0.0, min(1.0, (point - head).dot(along) / length))
            distance = (point - (head + along * mix)).length
        if closest is None or distance < closest:
            best, closest = bone.name, distance
    return best


def creases(mesh, matrix, threshold_cos):
    """Interior edges whose two faces have folded past the threshold, and where they are."""
    faces_by_edge = defaultdict(list)
    for polygon in mesh.polygons:
        for key in polygon.edge_keys:
            faces_by_edge[key].append(polygon.index)
    normals = [Vector(polygon.normal) for polygon in mesh.polygons]
    found = {}
    for key, faces in faces_by_edge.items():
        if len(faces) != 2:
            continue
        left, right = normals[faces[0]], normals[faces[1]]
        if left.length == 0.0 or right.length == 0.0:
            continue
        if left.normalized().dot(right.normalized()) > threshold_cos:
            continue
        first = matrix @ mesh.vertices[key[0]].co
        second = matrix @ mesh.vertices[key[1]].co
        found[key] = (first + second) / 2.0
    return found


def measure(obj, depsgraph, threshold_cos):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return creases(mesh, evaluated.matrix_world, threshold_cos)
    finally:
        evaluated.to_mesh_clear()


def main():
    args = arguments()
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.candidate))
    jacket = find_garment(args.garment)
    rig = jacket.find_armature()
    if rig is None:
        raise SystemExit('FAIL: %s is not skinned to an armature' % args.garment)
    threshold_cos = math.cos(math.radians(args.threshold))
    depsgraph = bpy.context.evaluated_depsgraph_get()

    # The garment's own seams, measured with the rig in its rest pose. Anything here is
    # tailoring, not a rig fault, and is taken off every count below.
    was = rig.data.pose_position
    rig.data.pose_position = 'REST'
    depsgraph.update()
    tailoring = measure(jacket, depsgraph, threshold_cos)
    rig.data.pose_position = was
    depsgraph.update()

    report = {
        'source': os.path.basename(args.candidate),
        'garment': args.garment,
        'thresholdDegrees': args.threshold,
        'frameStep': STEP,
        'tailoringCreases': len(tailoring),
        'clips': {},
    }
    for clip, last in sorted(CLIPS.items()):
        action = bpy.data.actions.get(clip)
        if action is None:
            raise SystemExit('FAIL: the candidate has no %s' % clip)
        if rig.animation_data is None:
            rig.animation_data_create()
        rig.animation_data.action = action
        slots = list(action.slots)
        if slots:
            rig.animation_data.action_slot = slots[0]
        worst = {'frame': 0, 'creases': 0, 'bones': {}}
        total = 0
        for frame in range(0, last + 1, STEP):
            bpy.context.scene.frame_set(frame)
            depsgraph.update()
            found = measure(jacket, depsgraph, threshold_cos)
            folded = {key: place for key, place in found.items() if key not in tailoring}
            total += len(folded)
            if len(folded) > worst['creases']:
                posed = rig.evaluated_get(depsgraph)
                bones = defaultdict(int)
                for place in folded.values():
                    bones[nearest_bone(place, posed)] += 1
                worst = {
                    'frame': frame,
                    'creases': len(folded),
                    'bones': dict(sorted(bones.items(), key=lambda row: -row[1])[:5]),
                }
        samples = len(range(0, last + 1, STEP))
        report['clips'][clip] = {
            'worstFrame': worst['frame'],
            'worstCreases': worst['creases'],
            'meanCreases': round(total / samples, 1),
            'worstBones': worst['bones'],
        }
        print('CREASE %-24s worst %4d at frame %3d, mean %6.1f  %s'
              % (clip, worst['creases'], worst['frame'], total / samples,
                 ', '.join('%s %d' % row for row in worst['bones'].items())))

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=1)
    print('CREASE REPORT %s (tailoring %d)' % (out, len(tailoring)))


if __name__ == '__main__':
    main()

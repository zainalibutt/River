"""Check the hand-written skinning carry against Blender's own armature deformation.

export_native_silver bakes the seated pose into the mesh by moving every vertex through
the blended rest-to-rest transform of the bones that own it - linear blend skinning,
written by hand, because bpy.ops.pose.armature_apply zeroes the pose and makes the
modifier's deformation identity before it can be evaluated.

That routine has never been checked against anything. Every pose number in reach_to_rail
has been tuned on top of it, and the shipped character's suit balloons at the shoulder
while the same suit in the bind pose is clean - so the deformation between those two
states is the entire suspect list, and this is the part of it nobody has verified.

The test poses the arms by roughly what the seated pose asks for, records what Blender's
armature modifier produces, then applies the pose to the rest and runs the real
_carry_meshes over the same meshes. If the hand-written version is correct the two agree
to within floating point. If it does not, every pose number tuned on top of it was tuned
against a moving target.

It calls the shipping function rather than a copy of it, so it cannot pass against code
that is not the code that runs.

Run: blender --background --python-exit-code 1 --python art/pipeline/test_skinning_carry.py
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import export_native_silver as silver

# A vertex that lands within a tenth of a millimetre of where the modifier put it is the
# same vertex. This is a correctness check against a reference implementation, not a
# tolerance to be negotiated: linear blend skinning is a closed-form calculation and two
# correct implementations of it agree to floating point.
TOLERANCE = 0.0001

# Close to what reach_to_rail actually asks of the shoulder - the arm swings down, forward
# and outward from a near-A-pose bind. Testing a one-degree nudge would pass against
# almost any wrong implementation, because every skinning scheme agrees near the bind
# pose. The error being hunted only appears at the angles the seated pose really uses.
POSE = {
    'upperarm01.L': (-38.0, 0.0, 22.0),
    'upperarm01.R': (-38.0, 0.0, -22.0),
    'lowerarm01.L': (-52.0, 0.0, 0.0),
    'lowerarm01.R': (-52.0, 0.0, 0.0),
    'clavicle.L': (-8.0, 0.0, 6.0),
    'clavicle.R': (-8.0, 0.0, -6.0),
    'spine01': (-14.0, 0.0, 0.0),
    'head': (6.0, 0.0, 0.0),
}


def evaluated_positions(objects):
    """What the armature modifier actually produces, in each object's own local space.

    The vertex counts are checked rather than assumed. If any modifier other than the
    armature is still live - a subdivision that failed to apply, say - the evaluated mesh
    has a different topology to the one the carry writes into, the two are compared by
    index, and every number that follows is meaningless while still looking plausible.
    That is precisely how a wrong measurement gets believed, so it fails here instead.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    out = {}
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        positions = [vertex.co.copy() for vertex in mesh.vertices]
        evaluated.to_mesh_clear()
        if len(positions) != len(obj.data.vertices):
            raise SystemExit(
                'FAIL: %s evaluates to %d vertices but its mesh has %d, so something '
                'other than the armature is still deforming it and a per-index '
                'comparison would compare unrelated vertices'
                % (obj.name, len(positions), len(obj.data.vertices)))
        out[obj.name] = positions
    return out


def main():
    if not os.path.exists(silver.SOURCE):
        raise SystemExit('FAIL: missing silver source ' + silver.SOURCE)
    bpy.ops.wm.open_mainfile(filepath=silver.SOURCE)

    # Mirror main() up to the point the carry happens, so the meshes under test are the
    # meshes the carry really runs on - same vertex count, same modifier stack.
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for modifier in obj.modifiers:
            modifier.show_viewport = modifier.show_render

    body = bpy.data.objects.get('river_native_silver_body')
    if body is None:
        raise SystemExit('FAIL: silver source has no body')
    armature = next((m.object for m in body.modifiers
                     if m.type == 'ARMATURE' and m.object is not None), None)
    if armature is None:
        raise SystemExit('FAIL: silver body has no armature')

    meshes = [obj for obj in bpy.data.objects
              if obj.type == 'MESH' and obj.name.startswith('river_')]
    for obj in meshes:
        silver.bake_shape_keys(obj)
        silver.apply_non_armature_modifiers(obj)

    # The carry works in each mesh's local space using bone matrices that are in the
    # ARMATURE's space. That is only the same space when the two objects share a
    # transform, and nothing in the pipeline guarantees they do - so check rather than
    # assume, because a mismatch here would deform every mesh by a constant error that
    # looks exactly like bad weighting.
    for obj in meshes:
        difference = max(abs(a - b)
                         for row_a, row_b in zip(obj.matrix_world, armature.matrix_world)
                         for a, b in zip(row_a, row_b))
        if difference > 1e-6:
            raise SystemExit(
                'FAIL: %s does not share the armature transform (max element difference '
                '%.6f), so armature-space bone matrices cannot be applied to its local '
                'coordinates' % (obj.name, difference))

    rest = {obj.name: [vertex.co.copy() for vertex in obj.data.vertices]
            for obj in meshes}

    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    posed = 0
    for name, angles in POSE.items():
        bone = armature.pose.bones.get(name)
        if bone is None:
            continue
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = tuple(math.radians(angle) for angle in angles)
        posed += 1
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    if posed < len(POSE) - 1:
        raise SystemExit('FAIL: only %d of %d test bones exist on this rig'
                         % (posed, len(POSE)))

    reference = evaluated_positions(meshes)

    # A test that poses nothing passes against any implementation. Prove the reference
    # actually moved before comparing anything to it - but only the meshes this pose is
    # supposed to move. The pose is arms, spine and head, so the shoes correctly stay
    # exactly where they were, and demanding otherwise fails the test for being right.
    exercised = 0
    for obj in meshes:
        shifted = max((reference[obj.name][i] - rest[obj.name][i]).length
                      for i in range(len(rest[obj.name])))
        print('POSED %-34s max_reference_shift=%.4f%s'
              % (obj.name, shifted, '' if shifted >= 0.01 else '   (not exercised)'))
        if shifted >= 0.01:
            exercised += 1
    for required in ('river_silver_suit', 'river_native_silver_body'):
        obj = bpy.data.objects.get(required)
        if obj is None:
            raise SystemExit('FAIL: %s is missing, and it is the mesh under '
                             'investigation' % required)
        shifted = max((reference[required][i] - rest[required][i]).length
                      for i in range(len(rest[required])))
        if shifted < 0.05:
            raise SystemExit('FAIL: the test pose moved %s by at most %.4f - the mesh '
                             'whose shoulder is broken is barely being deformed, so a '
                             'pass would prove nothing' % (required, shifted))
    print('POSE exercises %d of %d meshes' % (exercised, len(meshes)))

    before = {bone.name: bone.matrix_local.copy() for bone in armature.data.bones}
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    silver._carry_meshes(armature, meshes, before)

    failures = []
    for obj in meshes:
        errors = [(reference[obj.name][index] - vertex.co).length
                  for index, vertex in enumerate(obj.data.vertices)]
        if not errors:
            continue
        worst = max(range(len(errors)), key=lambda i: errors[i])
        mean = sum(errors) / len(errors)
        over = sum(1 for error in errors if error > TOLERANCE)
        print('CARRY %-34s max=%.6f mean=%.6f over_tolerance=%d of %d'
              % (obj.name, errors[worst], mean, over, len(errors)))
        if errors[worst] > TOLERANCE:
            groups = {group.group: round(group.weight, 4)
                      for group in obj.data.vertices[worst].groups}
            names = {group.index: group.name for group in obj.vertex_groups}
            print('   worst vertex %d at %s' % (worst, tuple(round(v, 4) for v in
                                                             obj.data.vertices[worst].co)))
            print('   its groups: %s'
                  % ', '.join('%s=%s' % (names.get(index, index), weight)
                              for index, weight in sorted(groups.items())))
            failures.append((obj.name, errors[worst], over))

    if failures:
        for name, worst, over in failures:
            print('MISMATCH %-30s worst=%.6f over_tolerance=%d' % (name, worst, over))
        raise SystemExit('FAIL: the hand-written carry disagrees with the armature '
                         'modifier on %d mesh(es)' % len(failures))
    print('SKINNING CARRY MATCHES the armature modifier on %d meshes' % len(meshes))


if __name__ == '__main__':
    main()

"""Measure a half-seated garment fit against the current silver build, without export.

Run with Blender --background --python-exit-code 1 --python and this script path.
The default measures the baseline; append -- --experiment for the 50% fit.
The existing GLB count is reported separately from the identical-topology source
comparison. A3 viability gates and existing correction failures are distinct:
a correction failure is reported with the final counts and retains a failing exit.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_native_silver as silver
from check_penetration import self_intersections


def report(tag, data):
    print(tag + ' ' + json.dumps(data), flush=True)


def rest_matrices(rig):
    return {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}


def rotation_degrees(first, second):
    delta = second.to_quaternion() @ first.to_quaternion().inverted()
    return math.degrees(2 * math.acos(min(1.0, abs(delta.normalized().w))))


def angles(before, after):
    return {stem: {side: rotation_degrees(before[stem + '.' + side],
                                         after[stem + '.' + side]) for side in ('L', 'R')}
            for stem in ('clavicle', 'shoulder01', 'upperarm01', 'lowerarm01', 'upperleg01')}


def intersections(obj, triangulate=False):
    if triangulate:
        import bmesh
        mesh = obj.data.copy()
        obj = obj.copy()
        obj.data = mesh
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
    pairs, _, polys = self_intersections(obj)
    result = {'pairs': len(pairs), 'faces': len(polys), 'vertices': len(obj.data.vertices)}
    if triangulate:
        bpy.data.objects.remove(obj)
        bpy.data.meshes.remove(mesh)
    return result


def open_source():
    bpy.ops.wm.open_mainfile(filepath=silver.SOURCE)
    body = bpy.data.objects['river_native_silver_body']
    rig = next(m.object for m in body.modifiers if m.type == 'ARMATURE')
    keep = {body.name, rig.name, 'river_silver_suit', 'river_silver_shoes'}
    for obj in list(bpy.data.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    for obj in meshes:
        for modifier in obj.modifiers:
            modifier.show_viewport = modifier.show_render
    return body, rig, meshes


def prepare(body, rig, meshes):
    for obj in meshes:
        silver.bake_shape_keys(obj)
    silver.keep_forearm_inside_cuffs(body, rig)
    for obj in meshes:
        silver.apply_non_armature_modifiers(obj)
    suit = next(obj for obj in meshes if 'suit' in obj.name)
    silver.smooth_shoulder_weights(suit, rig)
    return suit


def baseline():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=silver.GLB)
    suit = next(obj for obj in bpy.data.objects
                if obj.type == 'MESH' and 'silver_suit' in (obj.name + obj.data.name))
    built = intersections(suit)
    report('CURRENT_GLB', {'path': silver.GLB, **built})
    body, rig, meshes = open_source()
    initial = rest_matrices(rig)
    suit = prepare(body, rig, meshes)
    source_fit = intersections(suit)
    capture = {}
    reach = silver.reach_to_rail
    relax = silver.relax_skinning

    def capture_reach(armature, objects):
        capture['before_reach'] = rest_matrices(armature)
        return reach(armature, objects)

    def capture_relax(obj, moved, **kwargs):
        if obj is suit:
            capture['suit_relax_travelled'] = moved.copy()
        return relax(obj, moved, **kwargs)

    silver.reach_to_rail = capture_reach
    silver.relax_skinning = capture_relax
    try:
        silver.bake_seated_pose(rig, meshes)
    finally:
        silver.reach_to_rail = reach
        silver.relax_skinning = relax
    final = rest_matrices(rig)
    before_corrections = intersections(suit)
    silver.relieve_sleeve_intersection(suit, rig)
    silver.open_creases(suit, rig)
    data = {'current_glb': built, 'bind_fit': source_fit,
            'before_corrections': before_corrections,
            'final_polygons': intersections(suit),
            'final_triangles': intersections(suit, triangulate=True),
            'bind_to_seated_degrees': angles(initial, final),
            'rail_carry_degrees': angles(capture['before_reach'], final)}
    report('BASELINE', data)
    data['suit_relax_travelled'] = capture['suit_relax_travelled']
    return final, data


def pose_and_bake(rig, meshes, target, fraction=1.0):
    before = rest_matrices(rig)
    bones = sorted(rig.pose.bones, key=lambda bone: len(bone.parent_recursive))
    for bone in bones:
        bone.matrix = target[bone.name]
        bpy.context.view_layer.update()
    basis = {bone.name: bone.matrix_basis.copy() for bone in bones}
    for bone in bones:
        bone.matrix_basis = Matrix.Identity(4).lerp(basis[bone.name], fraction)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    travelled = silver._carry_meshes(rig, meshes, before)
    for obj in meshes:
        obj.data.update()
    return before, rest_matrices(rig), travelled


def experiment(final, baseline_data):
    from bl_ext.blender_org.mpfb.services import HumanService
    from build_native_silver_proof import asset_path

    body, rig, meshes = open_source()
    original_suit = bpy.data.objects['river_silver_suit']
    original_coordinates = np.array([tuple(v.co) for v in original_suit.data.vertices])
    for obj in meshes:
        if obj is not body:
            bpy.data.objects.remove(obj, do_unlink=True)
    silver.bake_shape_keys(body)
    original_body_count = len(body.data.vertices)
    before, halfway, _ = pose_and_bake(rig, [body], final, fraction=0.5)
    report('PREPOSE', {'fraction': 0.5, 'body_vertices': original_body_count,
                       'rotation_from_bind': angles(before, halfway)})
    garments = []
    try:
        for name in ('suit', 'shoes'):
            obj = HumanService.add_mhclo_asset(
                asset_path(name), body, asset_type='Clothes', subdiv_levels=1,
                material_type='MAKESKIN', set_up_rigging=True,
                interpolate_weights=True, import_weights=True)
            obj.name = 'river_silver_' + name
            garments.append(obj)
            report('MPFB_FIT', {'garment': name, 'vertices': len(obj.data.vertices),
                                'faces': len(obj.data.polygons),
                                'weighted_vertices': sum(bool(v.groups) for v in obj.data.vertices)})
    except Exception as error:
        report('FIT_BLOCKED', {'type': type(error).__name__, 'message': str(error)})
        raise SystemExit('MPFB could not fit the baked body; no workaround attempted')
    suit = garments[0]
    fitted_coordinates = np.array([tuple(v.co) for v in suit.data.vertices])
    if fitted_coordinates.shape != original_coordinates.shape:
        raise SystemExit('MPFB fit changed garment topology; cannot compare this attempt')
    shifts = np.linalg.norm(fitted_coordinates - original_coordinates, axis=1)
    report('FIT_DISPLACEMENT', {'median_mm': float(np.median(shifts) * 1000),
                                'maximum_mm': float(shifts.max() * 1000)})
    if not np.isfinite(fitted_coordinates).all() or shifts.max() < 0.05:
        raise SystemExit('MPFB did not meaningfully fit the posed body; no workaround attempted')
    meshes = [body, *garments]
    suit = prepare(body, rig, meshes)
    fit_pairs = intersections(suit)
    before, after, travelled = pose_and_bake(rig, meshes, final)
    carried = angles(before, after)
    reduction = {side: 1 - carried['upperarm01'][side]
                  / baseline_data['bind_to_seated_degrees']['upperarm01'][side]
                  for side in ('L', 'R')}
    symmetry = abs(carried['upperarm01']['L'] - carried['upperarm01']['R'])
    target_error = max((after[name].translation - final[name].translation).length
                       for name in final)
    target_rotation_error = max(rotation_degrees(after[name], final[name]) for name in final)
    report('CARRY_GATE', {'rotation_degrees': carried, 'reduction_fraction': reduction,
                          'side_difference_degrees': symmetry,
                          'final_target_position_error_mm': target_error * 1000,
                          'final_target_rotation_error_degrees': target_rotation_error})
    if min(reduction.values()) < 1 / 3 or symmetry > 1:
        raise SystemExit('APPROACH FAILED: carried rotation or symmetry gate')
    if target_error > 0.0001 or target_rotation_error > 0.1:
        raise SystemExit('APPROACH FAILED: final pose differs from the measured baseline')
    for obj in meshes:
        if 'suit' in obj.name or 'body' in obj.name:
            # Fix the baseline selection: remaining seat translation otherwise makes
            # the candidate smooth 7477 vertices against the baseline's 2170.
            moved = (baseline_data['suit_relax_travelled'] if obj is suit
                     else travelled.get(obj.name))
            if len(moved) != len(obj.data.vertices):
                raise SystemExit('Correction selection topology differs from the baseline')
            silver.relax_skinning(obj, moved, threshold=0.09,
                                  factor=0.2, rounds=2)
    before_corrections = intersections(suit)
    silver.relieve_sleeve_intersection(suit, rig)
    correction_failure = None
    try:
        silver.open_creases(suit, rig)
    except SystemExit as error:
        correction_failure = str(error)
    polygons = intersections(suit)
    triangles = intersections(suit, triangulate=True)
    passed = (polygons['pairs'] <= baseline_data['final_polygons']['pairs']
              and triangles['pairs'] <= baseline_data['final_triangles']['pairs'])
    report('FIT_GATE', {'halfway_fit': fit_pairs, 'before_corrections': before_corrections,
                        'final_polygons': polygons, 'final_triangles': triangles,
                        'a3_gates_passed': passed,
                        'correction_failure': correction_failure,
                        'pipeline_passed': passed and correction_failure is None})
    if correction_failure:
        raise SystemExit('PIPELINE STOPPED after A3 measurements: ' + correction_failure)
    if not passed:
        raise SystemExit('APPROACH FAILED: self-intersections increased; no tuning attempted')
    report('VIABLE', {'fraction': 0.5, 'scope': 'garment fitting only; armpit appearance unclaimed'})


if __name__ == '__main__':
    measured = baseline()
    if '--experiment' in sys.argv:
        experiment(*measured)

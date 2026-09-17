"""Measure every Silver clip, at every seat, against the Rooftop that ships.

check_penetration.py reads the venue at rest, and the native Silver cast has no rest pose
in the venue at all: the browser instances him into the seat anchors and every pose he
takes comes from a clip. So this imports the two files the browser loads - the venue and
the character - puts the character on each seat's anchor, and walks each clip in steps.

None of the Rooftop furniture is a closed mesh (each is checked, and none passes), so there
is no inside to test a point against and a depth measured by nearest-face normals is
meaningless: that version read a thigh under the felt as buried in the felt. Every depth
here is measured against a surface along a known direction instead:

- table: the table top as two height fields, its top surface and the underside of that top
  layer. A point of him between the two is inside the tabletop - a forearm sunk into the
  rail from above, or a knee pushed up into it from below - and its depth is the distance
  to the nearer of the two.
- backrest: how far his back passes the backrest's front face along the seat axis.
- seat: the lowest part of the trousers over the chair's seat, against the seat.
- feet: the lowest part of the shoes, against the floor.
- joins: that the frames the runtime cuts between are the same pose in the exported file.

Chairs move along their A53 and A49 tracks for the sit, the leave and the all-in, exactly as
the browser moves them. Face crossings are counted as well, but a count is not a depth.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/check_silver_seating.py -- \\
      --venue art/out/rooftop_assets.glb --character art/out/char_native_silver.glb \\
      --timing art/out/silver-integration/seat-transition-timing.json --out <report folder>
"""
import argparse
import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CLIPS = {
    'IDLE_thinking_readable': 120,
    'CHECK_tap': 36,
    'PEEK_card': 48,
    'CHIP_toss': 30,
    'ALLIN_standup': 90,
    'SIT_enter': 108,
    'LEAVE_getup': 132,
}
SEATED_CLIPS = ('IDLE_thinking_readable', 'CHECK_tap', 'PEEK_card', 'CHIP_toss')
CHAIR_CLIPS = ('ALLIN_standup', 'SIT_enter', 'LEAVE_getup')
STEP = 6
FPS = 30
SEAT_HEIGHT = 0.46
TABLE_PARTS = ('table_rail', 'table_felt', 'table_base')
# The height fields only describe the flat top. The base's skirt is a vertical wall, and seen
# from above a wall reads as a solid column its full height tall, which measured a thigh
# beside it as 155mm inside the table. The skirt is measured along the seat axis instead.
TABLE_TOP_PARTS = ('table_rail', 'table_felt')
SKIRT_PART = 'table_base'
FIELD_STEP = 0.01
DOWN = Vector((0.0, 0.0, -1.0))
# Past these a contact is a defect a player would see from the gameplay camera, not an
# imperfection.
SEVERE_DEPTH_MM = 25.0
SEVERE_SEAT_GAP_MM = 20.0
SEVERE_FEET_GAP_MM = 20.0


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--venue', required=True)
    parser.add_argument('--character', required=True)
    parser.add_argument('--timing', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--step', type=int, default=STEP)
    return parser.parse_args(argv)


def world_mesh(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    matrix = np.array(evaluated.matrix_world, dtype=np.float64)
    points = co.reshape(-1, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]
    mesh.calc_loop_triangles()
    triangles = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get('vertices', triangles)
    evaluated.to_mesh_clear()
    return points, triangles.reshape(-1, 3)


def tree_of(points, triangles):
    return BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True)


def is_closed(triangles):
    edges = np.sort(np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return bool(np.all(counts == 2))


def frames_of(last, step):
    return sorted(set(range(0, last + 1, step)) | {last})


def backaway(timing, clip, frame):
    rows = timing['clips'].get(clip, {}).get('backAway') or []
    if not rows:
        return 0.0
    index = min(len(rows) - 1, max(0, int(round(frame))))
    return float(rows[index][1])


def first_hit(trees, origin, direction, limit=5.0):
    best = None
    for tree in trees:
        location, _normal, _face, distance = tree.ray_cast(origin, direction, limit)
        if location is not None and (best is None or distance < best[1]):
            best = (location, distance)
    return best


def table_fields(parts):
    """The table top's upper surface and the underside of that top layer, sampled on a grid."""
    points = np.concatenate([part['points'] for part in parts])
    lower, upper = points.min(axis=0), points.max(axis=0)
    xs = np.arange(lower[0], upper[0] + FIELD_STEP, FIELD_STEP)
    ys = np.arange(lower[1], upper[1] + FIELD_STEP, FIELD_STEP)
    top = np.full((len(ys), len(xs)), np.nan)
    under = np.full((len(ys), len(xs)), np.nan)
    trees = [part['tree'] for part in parts]
    start = upper[2] + 0.5
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            hit = first_hit(trees, Vector((x, y, start)), DOWN)
            if hit is None:
                continue
            top[j, i] = hit[0].z
            below = first_hit(trees, Vector((x, y, hit[0].z - 1e-4)), DOWN)
            if below is not None:
                under[j, i] = below[0].z
    return {'x0': xs[0], 'y0': ys[0], 'top': top, 'under': under}


def table_depth(fields, points):
    """Deepest point inside the table top, and whether it came from above or below."""
    i = np.rint((points[:, 0] - fields['x0']) / FIELD_STEP).astype(int)
    j = np.rint((points[:, 1] - fields['y0']) / FIELD_STEP).astype(int)
    rows, columns = fields['top'].shape
    valid = (i >= 0) & (i < columns) & (j >= 0) & (j < rows)
    depth = np.zeros(len(points))
    source = np.zeros(len(points), dtype=int)
    top = np.full(len(points), np.nan)
    under = np.full(len(points), np.nan)
    top[valid] = fields['top'][j[valid], i[valid]]
    under[valid] = fields['under'][j[valid], i[valid]]
    inside = valid & ~np.isnan(top) & ~np.isnan(under) & (points[:, 2] < top) & (points[:, 2] > under)
    from_above = top - points[:, 2]
    from_below = points[:, 2] - under
    depth[inside] = np.minimum(from_above[inside], from_below[inside])
    source[inside] = np.where(from_above[inside] <= from_below[inside], 1, -1)
    if not inside.any():
        return 0.0, None, None
    index = int(np.argmax(depth))
    return float(depth[index]), ('above' if source[index] == 1 else 'below'), index


def main():
    args = arguments()
    started = time.time()
    os.makedirs(args.out, exist_ok=True)
    with open(args.timing, encoding='utf-8') as handle:
        timing = json.load(handle)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The glTF importer turns seconds into frames at the scene's rate during the import.
    # Setting 30 afterwards left the clips keyed at 24, so every sampled frame was a quarter
    # further into its clip than it said - which measured two exact joins as 103mm and
    # 216mm apart.
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.venue))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    anchors = {int(obj['seatIndex']): obj for obj in bpy.data.objects
               if 'seatIndex' in obj.keys() and obj.get('riverCast') == 'native_silver'}
    if sorted(anchors) != list(range(8)):
        raise SystemExit('FAIL: the venue has native Silver anchors for seats %s' % sorted(anchors))
    furniture = {}
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and (any(part in obj.name for part in TABLE_PARTS) or '_chair_' in obj.name):
            points, triangles = world_mesh(obj, depsgraph)
            furniture[obj.name] = {'tree': tree_of(points, triangles), 'points': points, 'triangles': triangles,
                                   'origin': np.array(obj.matrix_world.translation),
                                   'closed': is_closed(triangles)}
    table = [entry for name, entry in furniture.items() if any(part in name for part in TABLE_TOP_PARTS)]
    skirt = next((entry for name, entry in furniture.items() if SKIRT_PART in name), None)
    if len(table) < 2 or skirt is None:
        raise SystemExit('FAIL: expected the rail, the felt and the table base')
    fields = table_fields(table)
    if np.isnan(fields['top']).all():
        raise SystemExit('FAIL: the table height field found no table')
    # Prove the instrument on the table itself before measuring anything with it: a point
    # 5mm under the top surface of the thickest part of the top must read 5mm deep, and a
    # point 5mm over it must read clear.
    thickness = np.nan_to_num(fields['top'] - fields['under'], nan=-1.0)
    j, i = np.unravel_index(int(np.argmax(thickness)), thickness.shape)
    probe_xy = (fields['x0'] + i * FIELD_STEP, fields['y0'] + j * FIELD_STEP)
    sunk = table_depth(fields, np.array([[probe_xy[0], probe_xy[1], fields['top'][j, i] - 0.005]]))[0]
    clear = table_depth(fields, np.array([[probe_xy[0], probe_xy[1], fields['top'][j, i] + 0.005]]))[0]
    if abs(sunk - 0.005) > 1e-4 or clear != 0.0:
        raise SystemExit('FAIL: the table depth instrument read %.4f for a 5mm sink and %.4f for a 5mm clearance'
                         % (sunk, clear))

    floors = []
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.name not in furniture:
            points, triangles = world_mesh(obj, depsgraph)
            if len(triangles) and points[:, 2].max() < 0.25:
                floors.append((obj.name, tree_of(points, triangles)))

    seats = {}
    for seat, anchor in anchors.items():
        matrix = np.array(anchor.matrix_world, dtype=np.float64)
        origin = matrix[:3, 3]
        outward = np.array([origin[0], origin[1], 0.0])
        outward /= np.linalg.norm(outward)
        lateral = np.array([-outward[1], outward[0], 0.0])
        chair_name = next((name for name in furniture if name.endswith('_chair_%d' % (seat + 1))), None)
        if chair_name is None:
            raise SystemExit('FAIL: seat %d has no chair in the venue' % seat)
        chair = furniture[chair_name]
        centre = chair['origin']
        pan = chair['tree'].ray_cast(Vector((centre[0], centre[1], 0.7)), DOWN, 10.0)
        # The backrest's front face, looking out along the seat axis from the seat's centre
        # through the height a back rests at.
        faces = []
        for height in np.arange(SEAT_HEIGHT + 0.10, SEAT_HEIGHT + 0.42, 0.02):
            hit = chair['tree'].ray_cast(Vector((centre[0], centre[1], height)), Vector(outward), 1.0)
            if hit[0] is not None:
                faces.append(float(np.dot(np.array(hit[0]), outward)))
        along = chair['points'] @ outward
        backrest = chair['points'][along > (min(faces) if faces else along.max()) - 0.01]
        half_width = float(np.abs((backrest - centre) @ lateral).max()) if len(backrest) else 0.0
        # The skirt's outer face in front of the seat, sampled up the height a knee can reach.
        skirt_faces = {}
        for height in np.arange(0.30, 0.74, 0.02):
            hit = skirt['tree'].ray_cast(Vector((origin[0], origin[1], height)), Vector(-outward), 1.5)
            if hit[0] is not None:
                skirt_faces[round(float(height), 2)] = float(np.dot(np.array(hit[0]), outward))
        behind = origin + outward * 0.75
        floor = None
        for name, tree in floors:
            hit = tree.ray_cast(Vector((behind[0], behind[1], 1.0)), DOWN, 5.0)
            if hit[0] is not None and (floor is None or hit[0].z > floor[0]):
                floor = (hit[0].z, name)
        if pan[0] is None or not faces or floor is None:
            raise SystemExit('FAIL: seat %d could not find its seat, backrest or floor' % seat)
        seats[seat] = {
            'matrix': matrix, 'scale': float(np.linalg.norm(matrix[:3, 0])), 'outward': outward,
            'lateral': lateral, 'chair': chair_name, 'centre': centre, 'pan_z': pan[0].z,
            'backrest': min(faces), 'backrest_half_width': half_width, 'floor_z': floor[0], 'floor': floor[1],
            'skirt': skirt_faces,
        }

    objects_before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.character))
    imported = [obj for obj in bpy.data.objects if obj not in objects_before]
    rig = next(obj for obj in imported if obj.type == 'ARMATURE')
    meshes = sorted((obj for obj in imported if obj.type == 'MESH' and obj.parent == rig), key=lambda obj: obj.name)
    if len(meshes) != 20:
        raise SystemExit('FAIL: the character has %d meshes on its rig, expected 20' % len(meshes))
    clips = {}
    for track in rig.animation_data.nla_tracks:
        for strip in track.strips:
            if track.name in CLIPS:
                clips[track.name] = (strip.action, strip.action_slot)
        track.mute = True
    if sorted(clips) != sorted(CLIPS):
        raise SystemExit('FAIL: the character carries %s' % sorted(clips))
    for clip, (action, _slot) in clips.items():
        if abs(action.frame_range[1] - CLIPS[clip]) > 1e-3:
            raise SystemExit('FAIL: %s imported as frames %s, expected 0-%d; the frame rate is wrong'
                             % (clip, tuple(action.frame_range), CLIPS[clip]))

    def pose(clip, frame):
        action, slot = clips[clip]
        rig.animation_data.action = action
        rig.animation_data.action_slot = slot
        scene.frame_set(frame)
        bpy.context.view_layer.update()

    def bones_at(clip, frame):
        pose(clip, frame)
        return np.array([list(rig.matrix_world @ bone.head) for bone in rig.pose.bones])

    report = {
        'furniture_closed': {name: entry['closed'] for name, entry in sorted(furniture.items())},
        'placement': {}, 'joins': {}, 'clips': {}, 'severe': [],
    }
    for seat, entry in seats.items():
        report['placement'][seat] = {
            'scale': round(entry['scale'], 5), 'origin_mm': [round(v * 1000.0, 1) for v in entry['matrix'][:3, 3]],
            'chair': entry['chair'], 'pan_top_mm': round(entry['pan_z'] * 1000.0, 1),
            'floor_mm': round(entry['floor_z'] * 1000.0, 1), 'floor': entry['floor'],
        }
    for label, first, second in (('LEAVE_getup 78 vs ALLIN_standup 90', ('LEAVE_getup', 78), ('ALLIN_standup', 90)),
                                 ('SIT_enter 40 vs ALLIN_standup 90', ('SIT_enter', 40), ('ALLIN_standup', 90)),
                                 ('SIT_enter 108 vs idle 0', ('SIT_enter', 108), ('IDLE_thinking_readable', 0)),
                                 ('LEAVE_getup 0 vs idle 0', ('LEAVE_getup', 0), ('IDLE_thinking_readable', 0))):
        moved = np.linalg.norm(bones_at(*first) - bones_at(*second), axis=1)
        report['joins'][label] = round(float(moved.max()) * 1000.0, 3)

    names = [obj.name for obj in meshes]
    legs = [i for i, name in enumerate(names) if 'trousers' in name]
    shoes = [i for i, name in enumerate(names) if 'shoes' in name]
    for clip, last in CLIPS.items():
        rows = []
        for frame in frames_of(last, args.step):
            pose(clip, frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            parts = [world_mesh(obj, depsgraph) for obj in meshes]
            offsets = np.cumsum([0] + [len(points) for points, _ in parts])
            local = np.concatenate([points for points, _ in parts])
            triangles = np.concatenate([tri + offsets[i] for i, (_, tri) in enumerate(parts)])
            owner = np.concatenate([np.full(len(points), i) for i, (points, _) in enumerate(parts)])
            homogeneous = np.c_[local, np.ones(len(local))]
            for seat, entry in seats.items():
                placed = (homogeneous @ entry['matrix'].T)[:, :3]
                shift = backaway(timing, clip, frame) * entry['scale'] if clip in CHAIR_CLIPS else 0.0
                chair_offset = entry['outward'] * shift
                row = {'frame': frame, 'seat': seat, 'chair_backaway_mm': round(shift * 1000.0, 1)}

                depth, side, index = table_depth(fields, placed)
                row['table_depth_mm'] = round(depth * 1000.0, 1)
                row['table_depth_from'] = side
                row['table_depth_mesh'] = names[owner[index]] if index is not None else None

                relative = placed - (entry['centre'] + chair_offset)
                in_band = (placed[:, 2] > SEAT_HEIGHT + 0.10) & (placed[:, 2] < SEAT_HEIGHT + 0.42)
                beside = np.abs(relative @ entry['lateral']) < entry['backrest_half_width']
                past = placed @ entry['outward'] - (entry['backrest'] + shift)
                candidates = past[in_band & beside]
                row['backrest_intrusion_mm'] = round(max(0.0, float(candidates.max())) * 1000.0, 1) if len(candidates) else 0.0

                row['skirt_intrusion_mm'] = 0.0
                if entry['skirt']:
                    heights = np.array(sorted(entry['skirt']))
                    faces = np.array([entry['skirt'][h] for h in heights])
                    near_table = (placed[:, 2] >= heights[0] - 0.01) & (placed[:, 2] <= heights[-1] + 0.01)
                    ahead = np.abs((placed - entry['matrix'][:3, 3]) @ entry['lateral']) < 0.30
                    chosen = placed[near_table & ahead]
                    if len(chosen):
                        face = faces[np.clip(np.rint((chosen[:, 2] - heights[0]) / 0.02).astype(int), 0, len(faces) - 1)]
                        row['skirt_intrusion_mm'] = round(max(0.0, float((face - chosen @ entry['outward']).max())) * 1000.0, 1)

                trousers = placed[np.isin(owner, legs)]
                over_pan = trousers[np.linalg.norm(trousers[:, :2] - (entry['centre'][:2] + chair_offset[:2]), axis=1) < 0.20]
                row['seat_gap_mm'] = round(float(over_pan[:, 2].min() - entry['pan_z']) * 1000.0, 1) if len(over_pan) else None
                row['feet_gap_mm'] = round(float(placed[np.isin(owner, shoes)][:, 2].min() - entry['floor_z']) * 1000.0, 1)
                rows.append(row)
        worst_table = max(rows, key=lambda row: row['table_depth_mm'])
        worst_back = max(rows, key=lambda row: row['backrest_intrusion_mm'])
        worst_skirt = max(rows, key=lambda row: row['skirt_intrusion_mm'])
        seat_gaps = [row['seat_gap_mm'] for row in rows if row['seat_gap_mm'] is not None]
        feet = [row['feet_gap_mm'] for row in rows]
        summary = {
            'frames': len(frames_of(last, args.step)),
            'table_depth_mm': worst_table['table_depth_mm'],
            'table_worst': {k: worst_table[k] for k in ('seat', 'frame', 'table_depth_from', 'table_depth_mesh')},
            'backrest_intrusion_mm': worst_back['backrest_intrusion_mm'],
            'backrest_worst': {k: worst_back[k] for k in ('seat', 'frame', 'chair_backaway_mm')},
            'skirt_intrusion_mm': worst_skirt['skirt_intrusion_mm'],
            'skirt_worst': {k: worst_skirt[k] for k in ('seat', 'frame')},
            'seat_gap_mm': [min(seat_gaps), max(seat_gaps)] if seat_gaps else None,
            'feet_gap_mm': [min(feet), max(feet)],
        }
        report['clips'][clip] = {'summary': summary, 'rows': rows}
        if summary['table_depth_mm'] > SEVERE_DEPTH_MM:
            report['severe'].append('%s: %s %.0fmm into the table from %s (seat %d, frame %d)' % (
                clip, worst_table['table_depth_mesh'], worst_table['table_depth_mm'],
                worst_table['table_depth_from'], worst_table['seat'], worst_table['frame']))
        if summary['skirt_intrusion_mm'] > SEVERE_DEPTH_MM:
            report['severe'].append('%s: %.0fmm through the table skirt (seat %d, frame %d)' % (
                clip, worst_skirt['skirt_intrusion_mm'], worst_skirt['seat'], worst_skirt['frame']))
        if summary['backrest_intrusion_mm'] > SEVERE_DEPTH_MM:
            report['severe'].append('%s: %.0fmm through the backrest (seat %d, frame %d)' % (
                clip, worst_back['backrest_intrusion_mm'], worst_back['seat'], worst_back['frame']))
        if clip in SEATED_CLIPS and seat_gaps and max(abs(gap) for gap in seat_gaps) > SEVERE_SEAT_GAP_MM:
            report['severe'].append('%s: seated %s mm off the chair' % (clip, summary['seat_gap_mm']))
        if clip in SEATED_CLIPS and max(abs(gap) for gap in feet) > SEVERE_FEET_GAP_MM:
            report['severe'].append('%s: feet %s mm off the floor while seated' % (clip, summary['feet_gap_mm']))
        if clip in CHAIR_CLIPS and max(abs(gap) for gap in feet) > SEVERE_FEET_GAP_MM:
            report['severe'].append('%s: feet %s mm off the floor during the transition' % (clip, summary['feet_gap_mm']))
        print('SEATING %-24s top %5.1fmm (%s, %s)  skirt %5.1fmm  backrest %5.1fmm  seat %s  feet %s' % (
            clip, summary['table_depth_mm'], worst_table['table_depth_mesh'], worst_table['table_depth_from'],
            summary['skirt_intrusion_mm'], summary['backrest_intrusion_mm'], summary['seat_gap_mm'],
            summary['feet_gap_mm']))

    report['seconds'] = round(time.time() - started, 1)
    with open(os.path.join(args.out, 'seating-report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=1)
    for label, moved in report['joins'].items():
        print('JOIN %-36s %.3f mm' % (label, moved))
    for seat, placement in report['placement'].items():
        print('SEAT %d pan %.0fmm floor %.0fmm' % (seat, placement['pan_top_mm'], placement['floor_mm']))
    for line in report['severe']:
        print('SEVERE ' + line)
    print('SEATING REPORT %s' % os.path.join(args.out, 'seating-report.json'))


if __name__ == '__main__':
    main()

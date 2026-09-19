"""Build one of Gold's looks on her accepted baseline, prove it moved nothing it should not,
and render it for review.

The look comes from gold_looks.json. The gates: every action and the rest rig are
identical to the baseline's; her body's rest coordinates are untouched (a face is shape-key
values, never an edit to the mesh); and the boots she now wears are measured against the
floor in the seated pose her clips start from, because a pose fitted barefoot does not
know it now has soles.

Renders are the turntable the character lessons ask for - front, back and both
three-quarters - standing and seated, plus a portrait and the table view.

  node art/pipeline/run_blender.mjs art/pipeline/build_gold_look.py -- --look default --out <folder> \\
      [--accent '#12d67c'] [--no-render]
"""
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gold_look  # noqa: E402

FURNITURE = ('river_rooftop_', 'rooftop_chair_', 'A55 static chip')


def digest(value):
    return hashlib.sha256(repr(value).encode()).hexdigest()


def curves(action):
    return [c for layer in action.layers for strip in layer.strips for bag in strip.channelbags
            for c in bag.fcurves]


def protected():
    """What a look may never change."""
    rig = bpy.data.objects[gold_look.RIG]
    body = bpy.data.objects[gold_look.BODY]
    return {
        'actions': {a.name: digest((list(a.frame_range), [(c.data_path, c.array_index,
                                                            [tuple(k.co) for k in c.keyframe_points])
                                                           for c in curves(a)]))
                    for a in bpy.data.actions},
        'rest_rig': digest([(b.name, b.parent.name if b.parent else None, tuple(map(tuple, b.matrix_local)))
                            for b in rig.data.bones]),
        'body_rest': digest([tuple(v.co) for v in body.data.vertices]),
        # Deform weights only: a dress or shoes add a Delete group that hides the body under
        # them, which is masking, not skinning.
        'body_weights': digest([[(body.vertex_groups[g.group].name, g.weight) for g in v.groups
                                 if not body.vertex_groups[g.group].name.startswith('Delete.')]
                                for v in body.data.vertices]),
    }


def world_points(obj):
    masks = [m for m in obj.modifiers if m.type == 'MASK' and m.show_viewport]
    for modifier in masks:
        modifier.show_viewport = False
    try:
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
        evaluated.to_mesh_clear()
    finally:
        for modifier in masks:
            modifier.show_viewport = True
    return points


def seated(rig):
    rig.data.pose_position = 'POSE'
    rig.animation_data.action = bpy.data.actions['IDLE_thinking_readable']
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def boot_contact(rig):
    """Lowest boot point against the floor's top, seated."""
    seated(rig)
    floor = bpy.data.objects.get('A55 floor')
    if floor is None:
        raise SystemExit('FAIL: the review floor is missing')
    floor_top = max(p.z for p in world_points(floor))
    boots = world_points(bpy.data.objects[gold_look.SHOES])
    lowest = min(p.z for p in boots)
    return {'floor_top_m': round(floor_top, 4), 'lowest_boot_m': round(lowest, 4),
            'clearance_mm': round((lowest - floor_top) * 1000.0, 1)}


def furniture(hidden):
    for obj in bpy.data.objects:
        if obj.name.startswith(FURNITURE):
            obj.hide_render = hidden


def head_frame(body):
    head_group = body.vertex_groups['head'].index
    source = body.data.vertices
    points = world_points(body)
    head = [points[i] for i in range(len(source))
            if any(g.group == head_group and g.weight > 0.5 for g in source[i].groups)]
    eyes = world_points(bpy.data.objects['river_native_gold_eyes'])
    centre = sum(head, Vector()) / len(head)
    eye_centre = sum(eyes, Vector()) / len(eyes)
    forward = eye_centre - centre
    forward.z = 0.0
    return centre, forward.normalized(), eye_centre


def aim(camera, position, target):
    camera.location = position
    camera.rotation_euler = (Vector(target) - Vector(position)).to_track_quat('-Z', 'Y').to_euler()


def render(path, size=640):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def turn(vector, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, 'Z') @ vector


def shoot(out, rig, body):
    cam = bpy.context.scene.camera
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24.0
    shots = []

    rig.data.pose_position = 'REST'
    furniture(True)
    _, forward, eyes = head_frame(body)
    target = eyes - Vector((0.0, 0.0, 0.04))
    cam.data.lens = 85.0
    for name, degrees in (('portrait-front', 0.0), ('portrait-three-quarter', 32.0)):
        aim(cam, target + turn(forward, degrees) * 1.0, target)
        render(os.path.join(out, name + '.png'))
        shots.append(name)
    points = world_points(body)
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    centre = (low + high) / 2.0
    cam.data.lens = 50.0
    distance = (high.z - low.z) * 0.56 / (12.0 / 50.0)
    for name, degrees in (('standing-front', 0.0), ('standing-left', 60.0), ('standing-back', 180.0),
                          ('standing-right', -60.0)):
        aim(cam, centre + turn(forward, degrees) * distance + Vector((0.0, 0.0, 0.1)), centre)
        render(os.path.join(out, name + '.png'))
        shots.append(name)
    cam.data.lens = 50.0
    feet = Vector((centre.x, centre.y, low.z + 0.14))
    aim(cam, feet + turn(forward, 30.0) * 1.1 + Vector((0.0, 0.0, 0.2)), feet)
    render(os.path.join(out, 'boots.png'))
    shots.append('boots')

    furniture(False)
    seated(rig)
    head, forward, _ = head_frame(body)
    cam.data.lens = 40.0
    table = head - Vector((0.0, 0.0, 0.3))
    aim(cam, table + turn(forward, 24.0) * 1.7 + Vector((0.0, 0.0, 0.45)), table)
    render(os.path.join(out, 'table.png'))
    shots.append('table')
    furniture(True)
    middle = head - Vector((0.0, 0.0, 0.45))
    cam.data.lens = 35.0
    for name, degrees in (('seated-front', 0.0), ('seated-left', 70.0), ('seated-back', 180.0),
                          ('seated-right', -70.0)):
        aim(cam, middle + turn(forward, degrees) * 2.1 + Vector((0.0, 0.0, 0.25)), middle)
        render(os.path.join(out, name + '.png'))
        shots.append(name)
    furniture(False)
    return shots


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--look', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--accent')
    parser.add_argument('--no-render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    gold_look.open_baseline()
    before = protected()
    body, rig, report = gold_look.apply_look(args.look, args.accent)
    after = protected()
    report['gates'] = {
        'actions_unchanged': before['actions'] == after['actions'],
        'rest_rig_unchanged': before['rest_rig'] == after['rest_rig'],
        'body_rest_unchanged': before['body_rest'] == after['body_rest'],
        'body_weights_unchanged': before['body_weights'] == after['body_weights'],
    }
    report['boots'] = boot_contact(rig)
    blend = os.path.join(out, 'gold-%s.blend' % args.look)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    if not args.no_render:
        report['renders'] = shoot(out, rig, body)
    with open(os.path.join(out, 'report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=1)
    print('LOOK %s gates %s boots %s skin %s' % (args.look, json.dumps(report['gates']),
                                                 json.dumps(report['boots']), json.dumps(report['skin'])))
    if not all(report['gates'].values()):
        raise SystemExit('FAIL: the look changed what a look may not: %s' % report['gates'])


main()

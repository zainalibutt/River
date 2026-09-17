"""Build the Silver integration candidate from the accepted A51 and A53 files.

Neither accepted file is written. The candidate is a new .blend holding every A51 action,
A53's sit and leave clips with their chair tracks, and one self-contained copy of each clip
that ships to the browser. The accepted A51 file stays the rollback baseline.

Why the shipping clips are rebaked instead of exported as authored
------------------------------------------------------------------
Three of the five accepted A51 clips key only a handful of bones: the thinking idle keys
7 of 137, the check tap 6 and the peek 20. Everything else about the seated man - the hand
at his chin, the forearm on the rail, the bent knees - is not in those clips. It is the pose
the file was saved in, because Blender writes evaluated channels back into the pose bones
and a save keeps them. The A53 master was saved on the first frame of SIT_enter, and in
that file the thinking idle plays with 50 bones standing. The glTF exporter's
export_reset_pose_bones, on by default, puts unkeyed bones back to rest between actions,
which is a third answer again.

So each shipping clip is sampled here, frame by frame, in the file it was accepted in and
from a fresh open of that file, and written back as a clip that keys every channel of every
bone. Having a key on every bone is not the gate. The gate is that the rebaked clip
evaluates to the accepted bone transforms on every frame after the stored pose has been
deliberately poisoned, so nothing can be borrowed from it. The same poison is applied to
one of the original sparse clips first, which must fail: a comparison that cannot fail
proves nothing.

The skin texture was packed seven times by the A51 texture repair. Identical packed images
are merged here, with material assignments, UVs and a render compared before and after.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/build_silver_integration_candidate.py -- \\
      --a51 <copy of the A51 master> --a53 <copy of the A53 master> --out <output folder> \\
      [--original-a51 <accepted A51 path>] [--original-a53 <accepted A53 path>]
"""
import argparse
import hashlib
import json
import os
import sys
import time

import bpy
import numpy as np

RIG = 'river_native_silver_body.rig'
A51_SHA256 = 'c5c76f04e72ad65a5c092f9147deff4174b70a3bfc3f0d57d1f9a3396160330d'
A53_SHA256 = 'c8ea021a89f2b6709db08d2f5915380f58b5f694a5f725e7ec3eb4a2cae71971'
FPS = 30
MESH_COUNT = 20

# Every shipping clip starts on frame 0. The number is its last frame.
SHIPPING = {
    'IDLE_thinking_readable': ('a51', 120),
    'CHECK_tap': ('a51', 36),
    'PEEK_card': ('a51', 48),
    'CHIP_toss': ('a51', 30),
    'ALLIN_standup': ('a51', 90),
    'SIT_enter': ('a53', 108),
    'LEAVE_getup': ('a53', 132),
}
A53_APPENDED = (
    'SIT_enter',
    'LEAVE_getup',
    'A53 SIT_enter A21 chair back',
    'A53 SIT_enter A21 chair pan',
    'A53 LEAVE_getup A21 chair back',
    'A53 LEAVE_getup A21 chair pan',
)
CHAIRS = ('A21 chair back', 'A21 chair pan')
CHAIR_TRACKS = {
    'ALLIN_standup': ('A49 A21 chair back retreat', 'A49 A21 chair pan retreat'),
    'SIT_enter': ('A53 SIT_enter A21 chair back', 'A53 SIT_enter A21 chair pan'),
    'LEAVE_getup': ('A53 LEAVE_getup A21 chair back', 'A53 LEAVE_getup A21 chair pan'),
}
CHANNELS = (('location', 0), ('rotation_euler', 3), ('scale', 6))

# Keys are written from the float32 values Blender itself evaluated, so a correct rebake
# reproduces them to the bit on integer frames. The tolerances only absorb float32 matrix
# arithmetic.
ROTATION_TOLERANCE_DEG = 1e-3
TRANSLATION_TOLERANCE_MM = 1e-3
SCALE_TOLERANCE = 1e-5
GEOMETRY_TOLERANCE_MM = 1e-2

# The one garment this build is allowed to change, and the only thing in the file that is
# not required to come out bit-identical to the accepted clips.
#
# The jacket creases where the weights fold it, and measured with check_jacket_creasing.py
# it creases most on the clips that stand him up: 399 folded edges at the worst frame of the
# all-in and 414 on the leave, against 111 in the seated idle, gathered at the pelvis and
# the tops of the legs - the skirt fanning as the hips open. Smoothing the jacket's weights,
# everywhere but the sleeve, takes the all-in to 164 and the leave and the sit with it.
#
# Nothing else in the character moves: no bone is touched, and every other mesh is still
# held to the geometry tolerance above. The ceiling is a guard against a smoothing pass that
# collapses the garment rather than settles it.
JACKET = 'A11 tailored dinner jacket'
JACKET_SMOOTH_FACTOR = 0.5
JACKET_MOVEMENT_CEILING_MM = 60.0
# The sleeve is left alone. Smoothing the whole garment takes the creases down but lifts the
# sleeve off the elbow, and at the top of the all-in the arm comes through it: rendered at
# frame 66, skin visible through the sleeve goes from 17 pixels to 70. Holding these groups
# back both closes that - 18 pixels, which is the accepted file's own - and takes more
# creases off the standing clips than smoothing everywhere did, because the fold that was
# being smoothed into the sleeve is the sleeve's own shape.
JACKET_SMOOTH_EXCLUDES = (
    'lowerarm01.L', 'lowerarm02.L', 'lowerarm01.R', 'lowerarm02.R',
    'upperarm02.L', 'upperarm02.R',
)
# How much of a frame one refitted garment may repaint. The jacket is most of his upper body
# from this camera, and only its edges move, so a few percent is generous; a material fault
# would take the whole figure.
RENDER_GARMENT_FRACTION = 0.10


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--a51', required=True)
    parser.add_argument('--a53', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--original-a51')
    parser.add_argument('--original-a53')
    parser.add_argument('--smooth-jacket', type=int, default=4,
                        help='passes of weight smoothing over the jacket; 0 leaves it as accepted')
    return parser.parse_args(argv)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def open_file(path):
    bpy.ops.wm.open_mainfile(filepath=path)
    rig = bpy.data.objects.get(RIG)
    if rig is None or len(rig.pose.bones) != 137:
        raise SystemExit('FAIL: %s does not carry the 137-bone Silver rig' % path)
    return bpy.context.scene, rig


def character_meshes(rig):
    meshes = sorted(
        (obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.parent == rig and not obj.hide_render),
        key=lambda obj: obj.name,
    )
    if len(meshes) != MESH_COUNT:
        raise SystemExit('FAIL: expected %d visible character meshes, found %d' % (MESH_COUNT, len(meshes)))
    return meshes


def skin_meshes(rig, enabled):
    # Hiding an object in the viewport takes it out of the depsgraph, so a pass that only
    # reads bones does not pay for skinning twenty meshes on every frame. Only ever used in a
    # session that is never saved.
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.parent == rig:
            obj.hide_viewport = not enabled
    bpy.context.view_layer.update()


def assign(obj, action):
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = action
    if action.slots:
        obj.animation_data.action_slot = action.slots[0]


def set_frame(scene, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def capture_pose(scene, rig, action_name, last):
    assign(rig, bpy.data.actions[action_name])
    bones = list(rig.pose.bones)
    frames = last + 1
    channels = np.zeros((frames, len(bones), 9), dtype=np.float64)
    basis = np.zeros((frames, len(bones), 16), dtype=np.float64)
    posed = np.zeros((frames, len(bones), 16), dtype=np.float64)
    for frame in range(frames):
        set_frame(scene, frame)
        for index, bone in enumerate(bones):
            channels[frame, index, 0:3] = bone.location
            channels[frame, index, 3:6] = bone.rotation_euler
            channels[frame, index, 6:9] = bone.scale
            basis[frame, index] = [value for row in bone.matrix_basis for value in row]
            posed[frame, index] = [value for row in bone.matrix for value in row]
    return [bone.name for bone in bones], channels, basis, posed


def capture_geometry(scene, rig, frames):
    meshes = character_meshes(rig)
    captured = {}
    for frame in frames:
        set_frame(scene, frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        shapes = {}
        for obj in meshes:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
            mesh.vertices.foreach_get('co', co)
            matrix = np.array(evaluated.matrix_world, dtype=np.float64)
            shapes[obj.name] = co.reshape(-1, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]
            evaluated.to_mesh_clear()
        captured[frame] = shapes
    return captured


def sample_frames(last):
    return sorted({0, last // 2, last})


def matrix_differences(reference, candidate):
    ref = reference.reshape(reference.shape[0], reference.shape[1], 4, 4)
    cand = candidate.reshape(candidate.shape[0], candidate.shape[1], 4, 4)
    translation = np.linalg.norm(ref[..., :3, 3] - cand[..., :3, 3], axis=-1) * 1000.0
    ref_scale = np.linalg.norm(ref[..., :3, :3], axis=-2)
    cand_scale = np.linalg.norm(cand[..., :3, :3], axis=-2)
    scale = np.abs(ref_scale - cand_scale).max(axis=-1)
    ref_rotation = ref[..., :3, :3] / ref_scale[..., None, :]
    cand_rotation = cand[..., :3, :3] / cand_scale[..., None, :]
    relative = np.einsum('...ji,...jk->...ik', ref_rotation, cand_rotation)
    cosine = np.clip((np.trace(relative, axis1=-2, axis2=-1) - 1.0) / 2.0, -1.0, 1.0)
    rotation = np.degrees(np.arccos(cosine))
    return rotation, translation, scale


def worst(values, bone_names):
    frame, bone = np.unravel_index(int(np.argmax(values)), values.shape)
    return {'value': float(values[frame, bone]), 'frame': int(frame), 'bone': bone_names[bone]}


def compare_pose(reference, candidate, bone_names):
    report = {}
    for label, index in (('basis', 2), ('posed', 3)):
        rotation, translation, scale = matrix_differences(reference[index], candidate[index])
        report[label] = {
            'rotation_deg': worst(rotation, bone_names),
            'translation_mm': worst(translation, bone_names),
            'scale': worst(scale, bone_names),
        }
    report['within_tolerance'] = all(
        report[label]['rotation_deg']['value'] <= ROTATION_TOLERANCE_DEG
        and report[label]['translation_mm']['value'] <= TRANSLATION_TOLERANCE_MM
        and report[label]['scale']['value'] <= SCALE_TOLERANCE
        for label in ('basis', 'posed')
    )
    return report


def compare_geometry(reference, candidate, allowed=()):
    """How far the candidate's surface is from the accepted one, mesh by mesh.

    A mesh in `allowed` is measured and reported like every other, and then left out of the
    verdict: this build deliberately changes one garment, and a gate that cannot be told
    which one is being changed either has to pass everything or fail the whole build.
    """
    report = {'worst_mm': 0.0, 'worst_mesh': None, 'worst_frame': None, 'meshes': {},
              'allowed': sorted(allowed)}
    for frame, shapes in reference.items():
        for name, points in shapes.items():
            other = candidate[frame][name]
            if other.shape != points.shape:
                raise SystemExit('FAIL: %s has %d vertices at frame %d in the candidate and %d in the source'
                                 % (name, len(other), frame, len(points)))
            distance = float(np.linalg.norm(points - other, axis=1).max() * 1000.0)
            report['meshes'][name] = max(report['meshes'].get(name, 0.0), distance)
            if name in allowed:
                continue
            if distance >= report['worst_mm']:
                report.update(worst_mm=distance, worst_mesh=name, worst_frame=frame)
    report['within_tolerance'] = report['worst_mm'] <= GEOMETRY_TOLERANCE_MM
    return report


def smooth_jacket(scene, rig, passes):
    """Settle the jacket's skin weights, and measure what that did to the garment.

    The creasing is not an animation fault - every bone is where it was authored - it is the
    skin: neighbouring vertices of the skirt are weighted to bones that swing apart when he
    stands, so the surface pleats into a fan of hard edges across the hips. Smoothing each
    vertex's weights towards its neighbours' is the smallest thing that addresses that, and
    it is done here rather than by hand so the jacket in the candidate is a function of the
    accepted file plus a number.

    Returns how far every mesh moved at three frames of the clip that creases worst, so the
    report can say what changed rather than asserting that nothing did.
    """
    jacket = bpy.data.objects.get(JACKET)
    if jacket is None:
        raise SystemExit('FAIL: no %s to fit; the file carries %s'
                         % (JACKET, ', '.join(sorted(o.name for o in bpy.data.objects if o.type == 'MESH'))))
    frames = sample_frames(SHIPPING['ALLIN_standup'][1])
    assign(rig, bpy.data.actions['ALLIN_standup'])
    before = capture_geometry(scene, rig, frames)

    bpy.context.view_layer.objects.active = jacket
    for obj in bpy.context.view_layer.objects:
        obj.select_set(obj is jacket)
    # Everything except the sleeve, chosen per vertex by the bone that owns most of it.
    smoothed = 0
    for vertex in jacket.data.vertices:
        held, weight = None, 0.0
        for group in vertex.groups:
            if group.weight > weight:
                held, weight = jacket.vertex_groups[group.group].name, group.weight
        vertex.select = held not in JACKET_SMOOTH_EXCLUDES
        smoothed += 1 if vertex.select else 0
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=JACKET_SMOOTH_FACTOR,
                                       repeat=passes, expand=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    jacket.select_set(False)
    bpy.context.view_layer.update()
    if smoothed == 0 or smoothed == len(jacket.data.vertices):
        raise SystemExit('FAIL: the sleeve exclusion selected %d of %d jacket vertices'
                         % (smoothed, len(jacket.data.vertices)))

    after = capture_geometry(scene, rig, frames)
    moved = {}
    for frame, shapes in before.items():
        for name, points in shapes.items():
            distance = np.linalg.norm(points - after[frame][name], axis=1)
            moved[name] = {
                'max_mm': max(moved.get(name, {}).get('max_mm', 0.0), float(distance.max() * 1000.0)),
                'rms_mm': max(moved.get(name, {}).get('rms_mm', 0.0),
                              float(np.sqrt((distance ** 2).mean()) * 1000.0)),
            }
    return {'garment': JACKET, 'passes': passes, 'factor': JACKET_SMOOTH_FACTOR,
            'vertices_smoothed': smoothed, 'vertices': len(jacket.data.vertices),
            'held_back': list(JACKET_SMOOTH_EXCLUDES), 'moved': moved}


def pose_distance(first, second, bone_names):
    rotation, translation, _ = matrix_differences(first[None, ...], second[None, ...])
    return {'rotation_deg': worst(rotation, bone_names), 'translation_mm': worst(translation, bone_names)}


def bake_clip(rig, name, bone_names, channels):
    frames = channels.shape[0]
    action = bpy.data.actions.new(name)
    if action.name != name:
        raise SystemExit('FAIL: the rebaked clip could not take the name %s (got %s)' % (name, action.name))
    action.use_fake_user = True
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = frames - 1
    slot = action.slots.new(id_type='OBJECT', name=rig.name)
    layer = action.layers.new('Layer')
    strip = layer.strips.new(type='KEYFRAME')
    bag = strip.channelbag(slot, ensure=True)
    frame_numbers = np.arange(frames, dtype=np.float32)
    varying = 0
    for bone_index, bone_name in enumerate(bone_names):
        group = bag.groups.new(bone_name)
        escaped = bpy.utils.escape_identifier(bone_name)
        for prop, offset in CHANNELS:
            for axis in range(3):
                values = channels[:, bone_index, offset + axis].astype(np.float32)
                curve = bag.fcurves.new('pose.bones["%s"].%s' % (escaped, prop), index=axis)
                try:
                    curve.group = group
                except (AttributeError, TypeError):
                    # Grouping only tidies the channel list in Blender's editors; it changes
                    # nothing about evaluation or export.
                    pass
                # A channel that never moves keeps two keys holding its exact value, which
                # evaluates identically on every frame and keeps the file a sane size.
                if np.all(values == values[0]):
                    keys = np.array([0.0, values[0], frames - 1.0, values[0]], dtype=np.float32)
                else:
                    keys = np.empty(frames * 2, dtype=np.float32)
                    keys[0::2] = frame_numbers
                    keys[1::2] = values
                    varying += 1
                curve.keyframe_points.add(len(keys) // 2)
                curve.keyframe_points.foreach_set('co', keys)
                curve.update()
    return action, varying


def poison(rig):
    # A pose no accepted clip holds. Anything a clip still borrows from the stored pose will
    # come out visibly and measurably wrong.
    for bone in rig.pose.bones:
        bone.location = (0.05, -0.04, 0.03)
        bone.rotation_euler = (0.7, -0.5, 0.3)
        bone.scale = (1.2, 0.9, 1.1)
    bpy.context.view_layer.update()


def material_fingerprint():
    return {
        obj.name: [slot.material.name if slot.material else None for slot in obj.material_slots]
        for obj in bpy.data.objects if obj.type == 'MESH'
    }


def uv_fingerprint():
    prints = {}
    for mesh in bpy.data.meshes:
        for layer in mesh.uv_layers:
            data = np.empty(len(layer.data) * 2, dtype=np.float32)
            layer.data.foreach_get('uv', data)
            prints[mesh.name + '/' + layer.name] = hashlib.sha256(data.tobytes()).hexdigest()
    return prints


def packed_digest(image):
    return hashlib.sha256(bytes(image.packed_file.data)).hexdigest()


def texture_content_fingerprint():
    # What each material actually samples, by packed content rather than by datablock name.
    prints = {}
    for material in bpy.data.materials:
        if material.node_tree is None:
            continue
        sampled = []
        for node in material.node_tree.nodes:
            if node.bl_idname == 'ShaderNodeTexImage' and node.image is not None:
                image = node.image
                content = packed_digest(image) if image.packed_file else 'unpacked:' + image.filepath
                sampled.append((node.name, content, image.colorspace_settings.name, image.alpha_mode))
        prints[material.name] = sorted(sampled)
    return prints


def image_table():
    return {
        image.name: {
            'sha256': packed_digest(image) if image.packed_file else None,
            'bytes': image.packed_file.size if image.packed_file else None,
            'users': image.users,
        }
        for image in bpy.data.images
    }


def merge_identical_images():
    groups = {}
    for image in bpy.data.images:
        if image.packed_file is not None:
            groups.setdefault(packed_digest(image), []).append(image)
    merged, refused = [], []
    for digest, images in groups.items():
        if len(images) < 2:
            continue
        keep = min(images, key=lambda image: (len(image.name), image.name))
        for image in images:
            if image is keep:
                continue
            same_settings = (
                image.colorspace_settings.name == keep.colorspace_settings.name
                and image.alpha_mode == keep.alpha_mode
                and image.source == keep.source
            )
            if not same_settings:
                refused.append({'image': image.name, 'kept': keep.name, 'reason': 'colour space, alpha or source differ'})
                continue
            merged.append({'removed': image.name, 'kept': keep.name, 'sha256': digest, 'bytes': image.packed_file.size})
            image.user_remap(keep)
            bpy.data.images.remove(image)
    return merged, refused


def render_still(scene, path):
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 360
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    pixels = np.empty(360 * 480 * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels


def chair_timing(scene, rig):
    skin_meshes(rig, False)
    chairs = [bpy.data.objects[name] for name in CHAIRS]
    for chair in chairs:
        if chair.animation_data is not None:
            chair.animation_data.action = None
    base = {chair.name: chair.location.copy() for chair in chairs}
    timing = {}
    for clip, tracks in CHAIR_TRACKS.items():
        last = SHIPPING[clip][1]
        for chair, track in zip(chairs, tracks):
            assign(chair, bpy.data.actions[track])
        samples = {chair.name: [] for chair in chairs}
        for frame in range(last + 1):
            set_frame(scene, frame)
            for chair in chairs:
                offset = chair.location - base[chair.name]
                samples[chair.name].append([frame, offset.x, offset.y, offset.z])
        pan = samples['A21 chair pan']
        back = samples['A21 chair back']
        # Compared before any rounding. Rounding first and then comparing at the rounding
        # step reports the rounding.
        disagreement = max(max(abs(a[i] - b[i]) for i in (1, 2, 3)) for a, b in zip(pan, back))
        sideways = max(max(abs(row[1]), abs(row[3])) for row in pan)
        pan = [[row[0], round(row[1], 6), round(row[2], 6), round(row[3], 6)] for row in pan]
        beats = []
        pan_action = bpy.data.actions[tracks[1]]
        for layer in pan_action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        if curve.data_path == 'location' and curve.array_index == 1:
                            beats = [[round(key.co.x, 3), round(key.co.y - base['A21 chair pan'].y, 6)]
                                     for key in curve.keyframe_points]
        timing[clip] = {
            'lastFrame': last,
            'beats': beats,
            'backAway': [[row[0], row[2]] for row in pan],
            'panAndBackDisagreeM': disagreement,
            'largestSidewaysOrVerticalM': sideways,
        }
        for chair in chairs:
            chair.animation_data.action = None
            chair.location = base[chair.name]
    return timing


def main():
    args = arguments()
    started = time.time()
    out = os.path.abspath(args.out)
    reports = os.path.join(out, 'reports')
    os.makedirs(reports, exist_ok=True)
    candidate_path = os.path.join(out, 'silver-integration-candidate.blend')
    sources = {'a51': os.path.abspath(args.a51), 'a53': os.path.abspath(args.a53)}
    report = {'inputs': {}, 'gates': {}}
    failures = []

    for key, expected in (('a51', A51_SHA256), ('a53', A53_SHA256)):
        actual = sha256_file(sources[key])
        report['inputs'][key] = {'sha256': actual, 'bytes': os.path.getsize(sources[key])}
        if actual != expected:
            raise SystemExit('FAIL: %s input is not the accepted file: %s, expected %s' % (key, actual, expected))

    # 1. What the accepted files do, each clip from a fresh open of the file it was accepted in.
    references, geometry, bone_names, mesh_names = {}, {}, None, None
    for clip, (source, last) in SHIPPING.items():
        scene, rig = open_file(sources[source])
        if scene.render.fps != FPS:
            raise SystemExit('FAIL: %s runs at %d fps' % (source, scene.render.fps))
        names = [bone.name for bone in rig.pose.bones]
        if bone_names is None:
            bone_names = names
        elif names != bone_names:
            raise SystemExit('FAIL: the A51 and A53 rigs order their bones differently')
        meshes = [obj.name for obj in character_meshes(rig)]
        if mesh_names is None:
            mesh_names = meshes
        elif meshes != mesh_names:
            raise SystemExit('FAIL: the A51 and A53 files carry different character meshes')
        skin_meshes(rig, False)
        references[clip] = capture_pose(scene, rig, clip, last)
        skin_meshes(rig, True)
        geometry[clip] = capture_geometry(scene, rig, sample_frames(last))
        print('REFERENCE %-24s %3d frames from %s' % (clip, last + 1, source))

    # Rendered twice from two separate opens of the same accepted file. Whatever differs
    # between those two is the renderer, and the candidate is judged against that floor
    # rather than against zero.
    accepted_renders = []
    for attempt in range(2):
        scene, rig = open_file(sources['a51'])
        assign(rig, bpy.data.actions['IDLE_thinking_readable'])
        set_frame(scene, 0)
        accepted_renders.append(render_still(scene, os.path.join(reports, 'render-a51-idle-frame0-%d.png' % attempt)))
    accepted_render = accepted_renders[0]

    # 2. The candidate: A51, plus A53's clips and chair tracks, plus a rebaked copy of every
    #    shipping clip under its shipping name.
    scene, rig = open_file(sources['a51'])
    with bpy.data.libraries.load(sources['a53'], link=False) as (data_from, data_to):
        missing = [name for name in A53_APPENDED if name not in data_from.actions]
        if missing:
            raise SystemExit('FAIL: the A53 file is missing %s' % ', '.join(missing))
        data_to.actions = list(A53_APPENDED)
    for name in A53_APPENDED:
        action = bpy.data.actions.get(name)
        if action is None:
            raise SystemExit('FAIL: %s did not arrive from the A53 file under its own name' % name)
        action.use_fake_user = True
    for clip, (source, _) in SHIPPING.items():
        bpy.data.actions[clip].name = 'SOURCE %s %s' % (source.upper(), clip)
    report['bake'] = {}
    for clip in SHIPPING:
        _, channels, _, _ = references[clip]
        action, varying = bake_clip(rig, clip, bone_names, channels)
        report['bake'][clip] = {'frames': channels.shape[0], 'curves': 137 * 9, 'curves_keyed_every_frame': varying}

    # The one deliberate change to the accepted character, measured as it is made.
    if args.smooth_jacket > 0:
        report['wardrobe'] = smooth_jacket(scene, rig, args.smooth_jacket)
        garment = report['wardrobe']['moved'][JACKET]
        others = {name: entry['max_mm'] for name, entry in report['wardrobe']['moved'].items()
                  if name != JACKET and entry['max_mm'] > GEOMETRY_TOLERANCE_MM}
        print('WARDROBE %s smoothed %d passes over %d of %d vertices: moved %.1fmm rms, %.1fmm at most'
              % (JACKET, args.smooth_jacket, report['wardrobe']['vertices_smoothed'],
                 report['wardrobe']['vertices'], garment['rms_mm'], garment['max_mm']))
        if others:
            failures.append('wardrobe: smoothing the jacket moved %s'
                            % ', '.join('%s by %.2fmm' % row for row in sorted(others.items())))
        if garment['max_mm'] > JACKET_MOVEMENT_CEILING_MM:
            failures.append('wardrobe: the jacket moved %.1fmm, past the %.0fmm ceiling'
                            % (garment['max_mm'], JACKET_MOVEMENT_CEILING_MM))
    else:
        report['wardrobe'] = {'garment': JACKET, 'passes': 0}

    before = {
        'materials': material_fingerprint(),
        'uvs': uv_fingerprint(),
        'content': texture_content_fingerprint(),
        'images': image_table(),
    }
    merged, refused = merge_identical_images()
    after = {
        'materials': material_fingerprint(),
        'uvs': uv_fingerprint(),
        'content': texture_content_fingerprint(),
        'images': image_table(),
    }
    report['textures'] = {
        'merged': merged,
        'refused': refused,
        'images_before': before['images'],
        'images_after': after['images'],
        'material_assignments_unchanged': before['materials'] == after['materials'],
        'uvs_unchanged': before['uvs'] == after['uvs'],
        'sampled_content_unchanged': before['content'] == after['content'],
        'packed_bytes_before': sum(v['bytes'] or 0 for v in before['images'].values()),
        'packed_bytes_after': sum(v['bytes'] or 0 for v in after['images'].values()),
    }
    for check in ('material_assignments_unchanged', 'uvs_unchanged', 'sampled_content_unchanged'):
        if not report['textures'][check]:
            failures.append('textures: ' + check)

    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = SHIPPING['IDLE_thinking_readable'][1]
    assign(rig, bpy.data.actions['IDLE_thinking_readable'])
    set_frame(scene, 0)
    bpy.context.preferences.filepaths.save_version = 0
    # Compressed, like both accepted files. The first uncompressed save of this candidate was
    # 84,855,514 bytes.
    bpy.ops.wm.save_as_mainfile(filepath=candidate_path, check_existing=False, compress=True)
    report['candidate'] = {'path': candidate_path, 'bytes': os.path.getsize(candidate_path),
                           'sha256': sha256_file(candidate_path)}

    # 3. Chair timing, read out of the candidate before anything else has moved the chairs.
    scene, rig = open_file(candidate_path)
    timing = chair_timing(scene, rig)
    for clip, entry in timing.items():
        if entry['panAndBackDisagreeM'] > 1e-6:
            failures.append('chair: pan and back disagree during %s' % clip)

    # 4. The accepted look against the candidate's, from the same camera.
    scene, rig = open_file(candidate_path)
    assign(rig, bpy.data.actions['IDLE_thinking_readable'])
    set_frame(scene, 0)
    candidate_render = render_still(scene, os.path.join(reports, 'render-candidate-idle-frame0.png'))
    def render_difference(first, second):
        difference = np.abs(first - second).reshape(-1, 4)
        return {
            'max_abs': float(difference.max()),
            'mean_abs': float(difference.mean()),
            'pixels_over_2_of_255': int((difference.max(axis=1) > 2.0 / 255.0).sum()),
        }

    floor = render_difference(accepted_renders[0], accepted_renders[1])
    measured = render_difference(accepted_render, candidate_render)
    report['render_idle_frame0'] = {'a51_against_itself': floor, 'a51_against_candidate': measured}
    if args.smooth_jacket > 0:
        # The jacket has been deliberately refitted, so the frame is expected to differ where
        # the garment is and nowhere else. A changed material, a lost texture or a broken
        # material assignment repaints far more of the frame than one garment covers, which
        # is what this is still able to catch.
        pixels = accepted_render.size // 4
        report['render_idle_frame0']['fraction_changed'] = measured['pixels_over_2_of_255'] / pixels
        if report['render_idle_frame0']['fraction_changed'] > RENDER_GARMENT_FRACTION:
            failures.append('render: %.1f%% of the frame changed, more than one garment covers'
                            % (100.0 * report['render_idle_frame0']['fraction_changed']))
    elif measured['max_abs'] > floor['max_abs'] + 1.0 / 255.0 or measured['pixels_over_2_of_255'] > max(
            2 * floor['pixels_over_2_of_255'], 4):
        failures.append('render: the candidate differs from A51 by more than A51 differs from itself')

    # 5. The gates. The negative control goes first: an original sparse clip with the stored
    #    pose poisoned must fail, or the comparison cannot tell a pass from a fail.
    scene, rig = open_file(candidate_path)
    skin_meshes(rig, False)
    poison(rig)
    control = compare_pose(references['IDLE_thinking_readable'],
                           capture_pose(scene, rig, 'SOURCE A51 IDLE_thinking_readable', 120), bone_names)
    report['negative_control'] = control
    if control['within_tolerance']:
        failures.append('negative control passed: the comparison cannot detect a borrowed pose')

    report['gates']['pose'] = {}
    for clip, (_, last) in SHIPPING.items():
        poison(rig)
        result = compare_pose(references[clip], capture_pose(scene, rig, clip, last), bone_names)
        report['gates']['pose'][clip] = result
        if not result['within_tolerance']:
            failures.append('pose: %s does not reproduce the accepted clip' % clip)

    skin_meshes(rig, True)
    report['gates']['geometry'] = {}
    for clip, (_, last) in SHIPPING.items():
        poison(rig)
        assign(rig, bpy.data.actions[clip])
        result = compare_geometry(geometry[clip], capture_geometry(scene, rig, sample_frames(last)),
                                  allowed=(JACKET,) if args.smooth_jacket > 0 else ())
        report['gates']['geometry'][clip] = result
        if not result['within_tolerance']:
            failures.append('geometry: %s moves a vertex %.4f mm from the accepted clip' % (clip, result['worst_mm']))

    # 6. Facts the runtime needs, measured rather than assumed.
    posed = {clip: references[clip][3] for clip in SHIPPING}
    idle = posed['IDLE_thinking_readable']
    report['joins'] = {
        'CHECK_tap frame 0 vs idle frame 0': pose_distance(posed['CHECK_tap'][0], idle[0], bone_names),
        'CHECK_tap frame 36 vs idle frame 0': pose_distance(posed['CHECK_tap'][36], idle[0], bone_names),
        'PEEK_card frame 0 vs idle frame 0': pose_distance(posed['PEEK_card'][0], idle[0], bone_names),
        'PEEK_card frame 48 vs idle frame 0': pose_distance(posed['PEEK_card'][48], idle[0], bone_names),
        'CHIP_toss frame 0 vs idle frame 0': pose_distance(posed['CHIP_toss'][0], idle[0], bone_names),
        'CHIP_toss frame 30 vs idle frame 0': pose_distance(posed['CHIP_toss'][30], idle[0], bone_names),
        'ALLIN_standup frame 0 vs idle frame 0': pose_distance(posed['ALLIN_standup'][0], idle[0], bone_names),
        'SIT_enter frame 108 vs idle frame 0': pose_distance(posed['SIT_enter'][108], idle[0], bone_names),
        'LEAVE_getup frame 0 vs idle frame 0': pose_distance(posed['LEAVE_getup'][0], idle[0], bone_names),
        'SIT_enter frame 40 vs ALLIN_standup frame 90': pose_distance(posed['SIT_enter'][40], posed['ALLIN_standup'][90], bone_names),
        'idle frame 120 vs idle frame 0': pose_distance(idle[120], idle[0], bone_names),
    }

    for key in ('a51', 'a53'):
        report['inputs'][key]['unchanged_at_end'] = sha256_file(sources[key]) == report['inputs'][key]['sha256']
        if not report['inputs'][key]['unchanged_at_end']:
            failures.append('input copy %s changed' % key)
    for key, path, expected in (('a51', args.original_a51, A51_SHA256), ('a53', args.original_a53, A53_SHA256)):
        if path:
            report['inputs'][key]['original_unchanged'] = sha256_file(path) == expected
            if not report['inputs'][key]['original_unchanged']:
                failures.append('accepted original %s changed' % key)

    timing_document = {
        'source': {'a51Sha256': A51_SHA256, 'a53Sha256': A53_SHA256},
        'fps': FPS,
        'units': 'metres in the character frame, before any venue scale; positive backAway moves the chair away from the table',
        'clips': timing,
    }
    with open(os.path.join(out, 'seat-transition-timing.json'), 'w', encoding='utf-8') as handle:
        json.dump(timing_document, handle, indent=1)

    report['failures'] = failures
    report['seconds'] = round(time.time() - started, 1)
    with open(os.path.join(reports, 'candidate-report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=1)

    for clip in SHIPPING:
        pose_gate = report['gates']['pose'][clip]['posed']
        print('GATE %-24s rot %.2e deg  trans %.2e mm  geometry %.2e mm'
              % (clip, pose_gate['rotation_deg']['value'], pose_gate['translation_mm']['value'],
                 report['gates']['geometry'][clip]['worst_mm']))
    print('CONTROL sparse idle with poisoned stored pose: rot %.1f deg, trans %.1f mm'
          % (control['posed']['rotation_deg']['value'], control['posed']['translation_mm']['value']))
    print('TEXTURES merged %d, packed bytes %d -> %d, candidate %d bytes'
          % (len(merged), report['textures']['packed_bytes_before'], report['textures']['packed_bytes_after'],
             report['candidate']['bytes']))
    print('RENDER idle frame 0: A51 against itself max %.4f (%d pixels), against candidate max %.4f (%d pixels)'
          % (floor['max_abs'], floor['pixels_over_2_of_255'], measured['max_abs'], measured['pixels_over_2_of_255']))
    if failures:
        for failure in failures:
            print('FAIL ' + failure)
        raise SystemExit('FAIL: %d integration candidate gate(s) failed' % len(failures))
    print('CANDIDATE PASS %s' % candidate_path)


if __name__ == '__main__':
    main()

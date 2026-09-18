"""Export the Silver integration candidate as the character GLB the Rooftop build imports.

Only the clips in SHIPPING leave this file. The candidate also carries the sparse A51
originals, A53's authored originals, the proof chips, cards and chairs and their actions,
three cameras, three lights and the A21 stage; none of that is selected, and
check_character_glb reads the written file afterwards to prove none of it leaked.

Geometry and materials follow the recipe A42b proved and Zain accepted by eye:

- Each visible mesh is copied at frame 0 of the idle with its shape-key mix and modifiers
  applied, then moved back to rest by the inverse of its own four-weight skin matrix. The
  seated idle - the pose on screen most of the time - therefore reproduces exactly. Every
  other frame is measured against Blender after a reimport, because modifiers that run
  after the armature (the jacket's solidify, the trousers' subdivision) cannot follow the
  skeleton inside a glTF and are frozen at that frame.
- Materials whose base colour is a node graph are baked to a packed texture per object and
  replaced by a plain Principled material. Flat materials are copied as values. Hair,
  eyes, eyebrows and eyelashes are alpha-masked; the silk facing keeps A42b's roughness.

Each clip is exported as its own NLA track, so a clip exists in the file because it was
named here and for no other reason.

Run:
  node art/pipeline/run_blender.mjs art/pipeline/export_silver_integration.py -- \\
      --candidate <silver-integration-candidate.blend> --out <report folder> \\
      --glb art/out/char_native_silver.glb
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import struct
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = 'river_native_silver_body.rig'
EXPORT_RIG = 'river_native_silver_rig'
BODY_DATA = 'char_native_silver_body'
BODY_SOURCE = 'A11 anatomical visibility'
SHIPPING = {
    'IDLE_thinking_readable': 120,
    'CHECK_tap': 36,
    'PEEK_card': 48,
    'CHIP_toss': 30,
    'ALLIN_standup': 90,
    'SIT_enter': 108,
    'LEAVE_getup': 132,
    # Authored in the candidate build on the accepted push - see fold_clip.py.
    'FOLD_muck': 35,
}
FPS = 30
MESH_COUNT = 20
MASKED_PARTS = ('hair', 'eyebrow', 'eyelash', 'eyes', 'high-poly')
HAIR_ALPHA_CUTOFF = 0.28
FRAME0_COPY_TOLERANCE_M = 1e-5
# Nearest-vertex distance after reimport. Past this a limb is not merely approximated, it is
# broken, and the export stops rather than handing a broken character to the venue build.
BROKEN_GEOMETRY_MM = 25.0


def load_checker():
    spec = importlib.util.spec_from_file_location('check_character_glb', os.path.join(HERE, 'check_character_glb.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--out', required=True, help='folder for the export report')
    parser.add_argument('--glb', help='where to write the character; defaults to <out>/char_native_silver.glb')
    return parser.parse_args(argv)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def assign(obj, action, slot=None):
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = action
    if action is not None:
        chosen = slot if slot is not None else (action.slots[0] if action.slots else None)
        if chosen is not None:
            obj.animation_data.action_slot = chosen


def set_frame(scene, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def character_meshes(rig):
    meshes = sorted(
        (obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.parent == rig and not obj.hide_render),
        key=lambda obj: obj.name,
    )
    if len(meshes) != MESH_COUNT:
        raise SystemExit('FAIL: expected %d visible character meshes, found %d' % (MESH_COUNT, len(meshes)))
    return meshes


def world_points(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    matrix = np.array(evaluated.matrix_world, dtype=np.float64)
    points = co.reshape(-1, 3).astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]
    evaluated.to_mesh_clear()
    return points


def sample_frames(last):
    return sorted({0, last // 4, last // 2, (3 * last) // 4, last})


def slug(name):
    return ''.join(ch if ch.isalnum() else '_' for ch in name.lower().replace('a11 ', '').replace('river_', '')).strip('_')


def build_export_meshes(source_scene, source_rig, export_scene, rig, meshes):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    exported, weights = [], {}
    for original in meshes:
        evaluated = original.evaluated_get(depsgraph)
        data = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        obj = original.copy()
        obj.data = data
        obj.animation_data_clear()
        export_scene.collection.objects.link(obj)
        obj.name = 'silver_' + slug(original.name)
        obj['sourceName'] = original.name
        if original.name == BODY_SOURCE:
            data.name = BODY_DATA
        obj.parent = rig
        obj.matrix_world = original.matrix_world.copy()
        for modifier in list(obj.modifiers):
            obj.modifiers.remove(modifier)
        skin = {
            group.index: (original.matrix_world.inverted() @ source_rig.matrix_world
                          @ source_rig.pose.bones[group.name].matrix
                          @ source_rig.data.bones[group.name].matrix_local.inverted()
                          @ source_rig.matrix_world.inverted() @ original.matrix_world)
            for group in obj.vertex_groups if group.name in source_rig.pose.bones
        }
        limited, discarded = 0, 0.0
        for vertex in obj.data.vertices:
            influences = sorted(((g.group, g.weight) for g in vertex.groups if g.group in skin and g.weight > 0),
                                key=lambda pair: pair[1], reverse=True)
            if not influences:
                raise SystemExit('FAIL: %s vertex %d has no bone weight' % (original.name, vertex.index))
            kept = influences[:4]
            total = sum(weight for _, weight in kept)
            discarded = max(discarded, sum(weight for _, weight in influences[4:]))
            if len(influences) > 4 or abs(total - 1.0) > 1e-6:
                limited += 1
            blend = Matrix([[0.0] * 4 for _ in range(4)])
            for group, weight in kept:
                for row in range(4):
                    for column in range(4):
                        blend[row][column] += skin[group][row][column] * (weight / total)
            vertex.co = blend.inverted() @ vertex.co
            for group in list(vertex.groups):
                obj.vertex_groups[group.group].remove([vertex.index])
            for group, weight in kept:
                obj.vertex_groups[group].add([vertex.index], weight / total, 'REPLACE')
        modifier = obj.modifiers.new('Silver skin', 'ARMATURE')
        modifier.object = rig
        weights[original.name] = {'vertices': len(data.vertices), 'limited_or_normalised': limited,
                                  'largest_discarded_weight': discarded}
        exported.append(obj)
    return exported, weights


def translate_materials(export_meshes):
    translation, cache = {}, {}
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False
    for obj in export_meshes:
        originals = list(obj.data.materials)
        linked = any(
            material and material.node_tree and any(
                node.type == 'BSDF_PRINCIPLED' and node.inputs['Base Color'].is_linked for node in material.node_tree.nodes)
            for material in originals)
        baked = None
        if linked:
            size = 1024 if any(part in obj.name for part in ('anatomical', 'hair')) else 512
            baked = bpy.data.images.new(obj.name + ' colour', width=size, height=size, alpha=True, float_buffer=False)
            alpha = bpy.data.images.new(obj.name + ' alpha', width=size, height=size, alpha=True, float_buffer=True)
            alpha.colorspace_settings.name = 'Non-Color'
            working = []
            for index, material in enumerate(originals):
                private = material.copy()
                obj.data.materials[index] = private
                nodes, links = private.node_tree.nodes, private.node_tree.links
                bsdf = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
                output = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL' and node.is_active_output)
                emission = nodes.new('ShaderNodeEmission')
                target = nodes.new('ShaderNodeTexImage')
                target.image = baked
                nodes.active = target
                for link in list(output.inputs['Surface'].links):
                    links.remove(link)
                links.new(emission.outputs[0], output.inputs['Surface'])
                socket = bsdf.inputs['Base Color']
                if socket.is_linked:
                    links.new(socket.links[0].from_socket, emission.inputs['Color'])
                else:
                    emission.inputs['Color'].default_value = socket.default_value
                working.append((private, bsdf, emission, target))
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.bake(type='EMIT')
            pixels = np.empty(size * size * 4, dtype=np.float32)
            baked.pixels.foreach_get(pixels)
            if any(any(part in material.name.lower() for part in MASKED_PARTS) for material in originals):
                for private, bsdf, emission, target in working:
                    for link in list(emission.inputs['Color'].links):
                        private.node_tree.links.remove(link)
                    socket = bsdf.inputs['Alpha']
                    if socket.is_linked:
                        private.node_tree.links.new(socket.links[0].from_socket, emission.inputs['Color'])
                    else:
                        emission.inputs['Color'].default_value = (socket.default_value,) * 3 + (1.0,)
                    target.image = alpha
                bpy.ops.object.bake(type='EMIT')
                alphas = np.empty(size * size * 4, dtype=np.float32)
                alpha.pixels.foreach_get(alphas)
                pixels[3::4] = np.clip(alphas[0::4], 0.0, 1.0)
            else:
                pixels[3::4] = 1.0
            baked.pixels.foreach_set(pixels)
            baked.pack()
            bpy.data.images.remove(alpha)
        for index, original in enumerate(originals):
            key = original.name
            # A baked texture belongs to the object it was baked from, so a baked material is
            # never shared with another object's UVs.
            cache_key = (key, obj.name) if baked is not None else (key, None)
            if cache_key not in cache:
                safe = bpy.data.materials.new(key + ' PBR')
                safe.use_nodes = True
                nodes = safe.node_tree.nodes
                bsdf = nodes.get('Principled BSDF')
                source = next(node for node in original.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
                for name in ('Base Color', 'Metallic', 'Roughness', 'IOR', 'Specular IOR Level'):
                    bsdf.inputs[name].default_value = source.inputs[name].default_value
                bsdf.inputs['Alpha'].default_value = 1.0
                bsdf.inputs['Transmission Weight'].default_value = 0.0
                bsdf.inputs['Coat Weight'].default_value = 0.0
                masked = any(part in key.lower() for part in MASKED_PARTS)
                if 'silk' in key.lower():
                    bsdf.inputs['Roughness'].default_value = 0.50
                    bsdf.inputs['Specular IOR Level'].default_value = 0.18
                if baked is not None:
                    texture = nodes.new('ShaderNodeTexImage')
                    texture.image = baked
                    safe.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
                    if masked:
                        safe.node_tree.links.new(texture.outputs['Alpha'], bsdf.inputs['Alpha'])
                cache[cache_key] = safe
                translation[safe.name] = {
                    'source': key,
                    'object': obj.name if baked is not None else None,
                    'baked_texture': baked.name if baked is not None else None,
                    'alpha_mode': 'MASK' if masked else 'OPAQUE',
                    'alpha_cutoff': HAIR_ALPHA_CUTOFF if 'hair' in key.lower() else (0.5 if masked else None),
                }
            obj.data.materials[index] = cache[cache_key]
    scene.render.engine = 'BLENDER_EEVEE'
    return translation


def rewrite_alpha_modes(path, translation):
    with open(path, 'rb') as handle:
        raw = handle.read()
    offset, document, binary = 12, None, None
    while offset < len(raw):
        length, kind = struct.unpack_from('<II', raw, offset)
        offset += 8
        chunk = raw[offset:offset + length]
        offset += length
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
    for material in document.get('materials', []):
        policy = translation.get(material.get('name'))
        if policy is None:
            raise SystemExit('FAIL: exported material %r has no translation record' % material.get('name'))
        material['alphaMode'] = policy['alpha_mode']
        if policy['alpha_mode'] == 'MASK':
            material['alphaCutoff'] = policy['alpha_cutoff']
        else:
            material.pop('alphaCutoff', None)
    body = json.dumps(document, separators=(',', ':')).encode()
    body += b' ' * ((-len(body)) % 4)
    binary = (binary or b'') + b'\x00' * ((-len(binary or b'')) % 4)
    raw = (struct.pack('<4sII', b'glTF', 2, 28 + len(body) + len(binary))
           + struct.pack('<II', len(body), 0x4E4F534A) + body
           + struct.pack('<II', len(binary), 0x004E4942) + binary)
    with open(path, 'wb') as handle:
        handle.write(raw)


def main():
    args = arguments()
    started = time.time()
    out = os.path.abspath(args.out)
    reports = os.path.join(out, 'reports')
    os.makedirs(reports, exist_ok=True)
    glb = os.path.abspath(args.glb) if args.glb else os.path.join(out, 'char_native_silver.glb')
    os.makedirs(os.path.dirname(glb), exist_ok=True)
    candidate = os.path.abspath(args.candidate)
    candidate_sha = sha256_file(candidate)
    report = {'candidate': {'path': candidate, 'sha256': candidate_sha}}
    failures = []

    bpy.ops.wm.open_mainfile(filepath=candidate)
    source_scene = bpy.context.scene
    source_scene_name = source_scene.name
    source_rig = bpy.data.objects[RIG]
    for clip, last in SHIPPING.items():
        action = bpy.data.actions.get(clip)
        if action is None:
            raise SystemExit('FAIL: the candidate has no %s' % clip)
        if action.frame_range[1] != last:
            raise SystemExit('FAIL: %s ends on frame %s, expected %d' % (clip, action.frame_range[1], last))
    meshes = character_meshes(source_rig)

    # What Blender shows, for every clip at five frames, before anything is converted.
    source_geometry = {}
    for clip, last in SHIPPING.items():
        assign(source_rig, bpy.data.actions[clip])
        for frame in sample_frames(last):
            set_frame(source_scene, frame)
            source_geometry[(clip, frame)] = {obj.name: world_points(obj) for obj in meshes}
    assign(source_rig, bpy.data.actions['IDLE_thinking_readable'])
    set_frame(source_scene, 0)
    frame0 = {obj.name: world_points(obj) for obj in meshes}

    export_scene = bpy.data.scenes.new('Silver integration export')
    export_scene.render.fps = FPS
    export_scene.frame_start = 0
    export_scene.frame_end = max(SHIPPING.values())
    rig = source_rig.copy()
    rig.data = source_rig.data.copy()
    rig.animation_data_clear()
    export_scene.collection.objects.link(rig)
    rig.name = EXPORT_RIG
    # The venue build reads this and leaves the rig alone: the seated pose is already in every
    # clip and in the rest, and posing it again would bake over the animation channels.
    rig['riverSeatedBaked'] = True
    exported, weights = build_export_meshes(source_scene, source_rig, export_scene, rig, meshes)
    report['weights'] = weights

    bpy.context.window.scene = export_scene
    set_frame(export_scene, 0)
    copy_error = {}
    for obj in exported:
        points = world_points(obj)
        target = frame0[obj['sourceName']]
        if points.shape != target.shape:
            raise SystemExit('FAIL: %s changed vertex count in the export copy' % obj.name)
        copy_error[obj['sourceName']] = float(np.linalg.norm(points - target, axis=1).max())
    report['frame0_copy_error_m'] = copy_error
    if max(copy_error.values()) > FRAME0_COPY_TOLERANCE_M:
        raise SystemExit('FAIL: the rest-converted copies do not reproduce frame 0: %s' % copy_error)

    translation = translate_materials(exported)
    report['materials'] = translation

    rig.animation_data_create()
    rig.animation_data.action = None
    for clip in SHIPPING:
        action = bpy.data.actions[clip]
        track = rig.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 0, action)
        strip.name = clip
        if hasattr(strip, 'action_slot') and action.slots:
            strip.action_slot = action.slots[0]

    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rig, *exported]:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    options = dict(
        filepath=glb, check_existing=False, export_format='GLB', use_selection=True, use_active_scene=True,
        export_yup=True, export_apply=False, export_extras=True, export_cameras=False, export_lights=False,
        export_materials='EXPORT', export_skins=True, export_all_influences=False, export_influence_nb=4,
        export_def_bones=False, export_leaf_bone=False, export_morph=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=True, export_reset_pose_bones=False,
        export_anim_slide_to_zero=False, export_bake_animation=False,
    )
    available = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    unknown = sorted(key for key in options if key not in available)
    if unknown:
        raise SystemExit('FAIL: this Blender glTF exporter has no option %s' % ', '.join(unknown))
    bpy.ops.export_scene.gltf(**options)
    rewrite_alpha_modes(glb, translation)

    checker = load_checker()
    stats, problems = checker.inspect(glb, list(SHIPPING), 137)
    report['structure'] = {'stats': stats, 'problems': problems}
    failures.extend('structure: ' + problem for problem in problems)
    for clip, last in SHIPPING.items():
        seconds = stats['animations'].get(clip, {}).get('seconds')
        if seconds is None or abs(seconds - last / FPS) > 1e-3:
            failures.append('structure: %s lasts %s s, expected %.4f' % (clip, seconds, last / FPS))

    # Reimport and compare every clip at five frames against what Blender showed.
    import_scene = bpy.data.scenes.new('Silver integration reimport')
    import_scene.render.fps = FPS
    bpy.context.window.scene = import_scene
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    import_rig = next(obj for obj in imported if obj.type == 'ARMATURE')
    import_meshes = {obj['sourceName']: obj for obj in imported if obj.type == 'MESH' and 'sourceName' in obj.keys()}
    if len(import_meshes) != MESH_COUNT:
        raise SystemExit('FAIL: reimport found %d character meshes' % len(import_meshes))
    clips = {}
    for track in import_rig.animation_data.nla_tracks:
        for strip in track.strips:
            for clip in SHIPPING:
                if clip in (track.name, strip.name) or (strip.action and strip.action.name.startswith(clip)):
                    clips[clip] = (strip.action, getattr(strip, 'action_slot', None))
        track.mute = True
    missing = [clip for clip in SHIPPING if clip not in clips]
    if missing:
        raise SystemExit('FAIL: reimport did not recover %s' % ', '.join(missing))

    report['reimport_geometry_mm'] = {}
    for clip, last in SHIPPING.items():
        action, slot = clips[clip]
        assign(import_rig, action, slot)
        per_clip = {'worst_mm': 0.0, 'worst_mesh': None, 'worst_frame': None, 'rms_mm': {}}
        for frame in sample_frames(last):
            set_frame(import_scene, frame)
            for name, obj in import_meshes.items():
                source = source_geometry[(clip, frame)][name]
                tree = KDTree(len(source))
                for index, point in enumerate(source):
                    tree.insert(point, index)
                tree.balance()
                distances = np.array([tree.find(point)[2] for point in world_points(obj)])
                worst = float(distances.max() * 1000.0)
                per_clip['rms_mm'][name] = max(per_clip['rms_mm'].get(name, 0.0),
                                               float(math.sqrt((distances ** 2).mean()) * 1000.0))
                if worst >= per_clip['worst_mm']:
                    per_clip.update(worst_mm=worst, worst_mesh=name, worst_frame=frame)
        report['reimport_geometry_mm'][clip] = per_clip
        if per_clip['worst_mm'] > BROKEN_GEOMETRY_MM:
            failures.append('geometry: %s is %.1f mm from Blender on %s at frame %d'
                            % (clip, per_clip['worst_mm'], per_clip['worst_mesh'], per_clip['worst_frame']))

    report['glb'] = {'path': glb, 'bytes': os.path.getsize(glb), 'sha256': sha256_file(glb)}
    report['candidate_unchanged'] = sha256_file(candidate) == candidate_sha
    if not report['candidate_unchanged']:
        failures.append('the candidate file changed during export')
    report['failures'] = failures
    report['seconds'] = round(time.time() - started, 1)
    with open(os.path.join(reports, 'export-report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=1)

    for clip in SHIPPING:
        entry = report['reimport_geometry_mm'][clip]
        print('REIMPORT %-24s worst %.2f mm on %s at frame %s'
              % (clip, entry['worst_mm'], entry['worst_mesh'], entry['worst_frame']))
    print('GLB %d bytes, %d triangles, %d primitives, %d materials, %d clips'
          % (report['glb']['bytes'], stats['triangles'], stats['primitives'], len(stats['materials']),
             len(stats['animations'])))
    if failures:
        for failure in failures:
            print('FAIL ' + failure)
        raise SystemExit('FAIL: %d export gate(s) failed' % len(failures))
    print('EXPORT PASS %s' % glb)


if __name__ == '__main__':
    main()

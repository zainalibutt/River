"""Export the Silver integration candidate as the character GLB the Rooftop build imports.

Only the clips in SHIPPING leave this file. The candidate also carries the sparse A51
originals, A53's authored originals, the proof chips, cards and chairs and their actions,
three cameras, three lights and the A21 stage; none of that is selected, and
check_character_glb reads the written file afterwards to prove none of it leaked.

Geometry and materials follow the recipe A42b proved and that was accepted by eye:

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

The outfit's standing shape ships as a morph each clip drives (POSE_SHAPES), so the candidate
must have been through add_silver_standing_shapes.py.

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
import re
import struct
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = 'river_native_silver_body.rig'
EXPORT_RIG = 'river_native_silver_rig'
BODY_DATA = 'char_native_silver_body'
BODY_SOURCE = 'A11 anatomical visibility'
EXPORT_PREFIX = 'silver'
RELOAD_EXPORT_SCENE = False
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
# Garment shapes that ship as morph targets and are driven frame by frame, rather than baked
# into the mesh at one value. {source mesh name: shape key name} for a seated corrective, or a
# spec (see shape_spec). A seated corrective is right while the character sits and wrong once
# they stand, so every clip carries the shape's weight on every frame, read from how far the
# pelvis has lifted off the seat.
#
# Silver's outfit was fitted seated, and skinned upright it bunches into a pouch at the hips.
# Every outfit mesh therefore ships the standing shape add_silver_standing_shapes.py gives it,
# on once he has left the seat and exact at the all-in hold, and a candidate without it is
# refused rather than exported with the pouch back. Gold's wrapper replaces this with her own.
STANDING_OUTFIT = ('A11 tailored dinner jacket', 'A11 tailored trousers', 'A11 fitted silk facing L',
                   'A11 fitted silk facing R', 'A11 jacket button', 'A11 fitted dress shirt',
                   'A11 fitted shirt cuff L', 'A11 fitted shirt cuff R', 'A11 continuous shirt collar',
                   'A11 fitted bow knot')
STANDING = {'key': 'standing', 'on': 'standing', 'capture': ('ALLIN_standup', 66)}
POSE_SHAPES = {name: STANDING for name in STANDING_OUTFIT}
# Measured on Gold's clips: every seated clip lifts the pelvis 0mm, standing lifts it 252mm, and
# the sit, the leave and the all-in cross this band in seven to ten frames.
SEAT_ON_MM = 10.0
SEAT_OFF_MM = 90.0
# Filled while the meshes are built: per pose-shape node, the rest positions and the normals that
# are exact where the shape is fully on, written into the file's morph normals after export.
POSE_NORMALS = {}


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


def seat_weight(lift_mm):
    """1 while the pelvis sits within SEAT_ON_MM of its idle height, 0 once it has lifted SEAT_OFF_MM."""
    t = min(1.0, max(0.0, (lift_mm - SEAT_ON_MM) / (SEAT_OFF_MM - SEAT_ON_MM)))
    return 1.0 - t * t * (3.0 - 2.0 * t)


IDLE_CAPTURE = ('IDLE_thinking_readable', 0)


def shape_spec(mesh_name):
    """A pose shape's key, when it is on, and the pose it is captured at.

    A plain key name is a seated corrective: on while the pelvis sits, captured at the idle.
    A standing shape is on once the pelvis has left the seat, and is captured at a standing
    frame, so the morph is exact where it is fully on.
    """
    value = POSE_SHAPES.get(mesh_name)
    if value is None:
        return None
    if isinstance(value, str):
        return {'key': value, 'on': 'seated', 'capture': IDLE_CAPTURE}
    return {'key': value['key'], 'on': value.get('on', 'seated'),
            'capture': tuple(value.get('capture', IDLE_CAPTURE))}


def pose_shape_weights(scene, rig, meshes):
    """Every pose shape's weight on every frame of every clip, from the pelvis's lift off the seat.

    The meshes are taken out of the depsgraph while the skeleton is sampled, since only bones
    are read, and put back afterwards.
    """
    hidden = [(obj, obj.hide_viewport) for obj in meshes]
    for obj, _ in hidden:
        obj.hide_viewport = True
    try:
        assign(rig, bpy.data.actions['IDLE_thinking_readable'])
        set_frame(scene, 0)
        seated = (rig.matrix_world @ rig.pose.bones['root'].head).z
        weights = {}
        for clip, last in SHIPPING.items():
            assign(rig, bpy.data.actions[clip])
            rows = []
            for frame in range(last + 1):
                set_frame(scene, frame)
                lift = ((rig.matrix_world @ rig.pose.bones['root'].head).z - seated) * 1000.0
                rows.append(seat_weight(lift))
            weights[clip] = rows
    finally:
        for obj, was in hidden:
            obj.hide_viewport = was
        bpy.context.view_layer.update()
    return {name: {clip: rows if shape_spec(name)['on'] == 'seated' else [1.0 - w for w in rows]
                   for clip, rows in weights.items()}
            for name in POSE_SHAPES}


def set_pose_shapes(meshes, weights, clip, frame):
    for obj in meshes:
        spec = shape_spec(obj.name)
        if spec is not None:
            obj.data.shape_keys.key_blocks[spec['key']].value = weights[obj.name][clip][frame]
    bpy.context.view_layer.update()


def add_pose_shape_tracks(exported, weights):
    """Give every clip a track of the same name carrying each pose shape's weight per frame.

    The exporter merges tracks by name across the rig and the shape keys, so each clip ships
    with the weight channel inside it. Every clip carries one, constant or not, because a clip
    without it would leave the weight wherever the previous clip ended.
    """
    for obj in exported:
        spec = shape_spec(obj['sourceName'])
        if spec is None:
            continue
        key_name = spec['key']
        keys = obj.data.shape_keys
        keys.animation_data_create()
        keys.animation_data.action = None
        path = 'key_blocks["%s"].value' % bpy.utils.escape_identifier(key_name)
        for clip in SHIPPING:
            values = np.asarray(weights[obj['sourceName']][clip], dtype=np.float32)
            action = bpy.data.actions.new('%s %s' % (clip, key_name))
            slot = action.slots.new(id_type='KEY', name=keys.name)
            strip = action.layers.new('Layer').strips.new(type='KEYFRAME')
            curve = strip.channelbag(slot, ensure=True).fcurves.new(path, index=0)
            points = np.empty(len(values) * 2, dtype=np.float32)
            points[0::2] = np.arange(len(values), dtype=np.float32)
            points[1::2] = values
            curve.keyframe_points.add(len(values))
            curve.keyframe_points.foreach_set('co', points)
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
            curve.update()
            track = keys.animation_data.nla_tracks.new()
            track.name = clip
            nla = track.strips.new(clip, 0, action)
            nla.name = clip
            if hasattr(nla, 'action_slot'):
                nla.action_slot = slot


def slug(name):
    return ''.join(ch if ch.isalnum() else '_' for ch in name.lower().replace('a11 ', '').replace('river_', '')).strip('_')


def build_export_meshes(source_scene, source_rig, export_collection, rig, meshes):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    exported, weights = [], {}
    for original in meshes:
        # A pose shape is taken fully on at the pose it is captured at and moved back to rest
        # through the skin of that pose, so the shipped morph is exact where it is fully on. The
        # mesh itself is taken with the shape off at the idle, as every other mesh is.
        spec = shape_spec(original.name)
        key_name = spec['key'] if spec is not None else None
        target = None
        if spec is not None:
            block = original.data.shape_keys.key_blocks[key_name]
            idle_value = block.value
            moved = spec['capture'] != IDLE_CAPTURE
            if moved:
                assign(source_rig, bpy.data.actions[spec['capture'][0]])
                set_frame(source_scene, spec['capture'][1])
            block.value = 1.0
            bpy.context.view_layer.update()
            evaluated = original.evaluated_get(bpy.context.evaluated_depsgraph_get())
            posed = evaluated.to_mesh()
            target = np.empty(len(posed.vertices) * 3, dtype=np.float32)
            posed.vertices.foreach_get('co', target)
            target = target.reshape(-1, 3)
            target_normals = np.empty(len(posed.loops) * 3, dtype=np.float32)
            posed.corner_normals.foreach_get('vector', target_normals)
            target_normals = target_normals.reshape(-1, 3).astype(np.float64)
            evaluated.to_mesh_clear()
            capture_bones = {bone.name: bone.matrix.copy() for bone in source_rig.pose.bones}
            if moved:
                assign(source_rig, bpy.data.actions[IDLE_CAPTURE[0]])
                set_frame(source_scene, IDLE_CAPTURE[1])
            block.value = 0.0
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = original.evaluated_get(depsgraph)
        data = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        if key_name is not None:
            block.value = idle_value
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            if len(target) != len(data.vertices):
                raise SystemExit('FAIL: %s has %d vertices with %s on and %d with it off'
                                 % (original.name, len(target), key_name, len(data.vertices)))
            target_rest = np.zeros_like(target)
        obj = original.copy()
        obj.data = data
        obj.animation_data_clear()
        export_collection.objects.link(obj)
        obj.name = EXPORT_PREFIX + '_' + slug(original.name)
        obj['sourceName'] = original.name
        if original.name == BODY_SOURCE:
            data.name = BODY_DATA
        elif spec is not None:
            # Blender's importer names a node carrying shape-key animation after its mesh and
            # drops the node's extras, so the mesh takes the node's unique name to be found again.
            data.name = obj.name
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
        if target is not None:
            skin_capture = {
                group.index: (original.matrix_world.inverted() @ source_rig.matrix_world
                              @ capture_bones[group.name]
                              @ source_rig.data.bones[group.name].matrix_local.inverted()
                              @ source_rig.matrix_world.inverted() @ original.matrix_world)
                for group in obj.vertex_groups if group.name in source_rig.pose.bones
            }
            capture_inverse = np.zeros((len(data.vertices), 3, 3))
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
            inverse = blend.inverted()
            vertex.co = inverse @ vertex.co
            if target is not None:
                capture = Matrix([[0.0] * 4 for _ in range(4)])
                for group, weight in kept:
                    for row in range(4):
                        for column in range(4):
                            capture[row][column] += skin_capture[group][row][column] * (weight / total)
                capture = capture.inverted()
                target_rest[vertex.index] = capture @ Vector(target[vertex.index])
                capture_inverse[vertex.index] = np.array(capture.to_3x3())
            for group in list(vertex.groups):
                obj.vertex_groups[group.group].remove([vertex.index])
            for group, weight in kept:
                obj.vertex_groups[group].add([vertex.index], weight / total, 'REPLACE')
        if target is not None:
            # The browser skins a normal with its vertex's blended matrix, so the normal that is
            # exact where the shape is fully on is the posed surface's own normal moved back to
            # rest through the inverse of that pose's blend. The exporter would otherwise derive
            # the morph's normals from the rest-space shape, which that inverse folds wherever
            # bones blend steeply. They are written into the file after export.
            loop_vertex = np.empty(len(data.loops), dtype=np.int32)
            data.loops.foreach_get('vertex_index', loop_vertex)
            if len(target_normals) != len(loop_vertex):
                raise SystemExit('FAIL: %s has %d corners posed and %d at rest'
                                 % (original.name, len(target_normals), len(loop_vertex)))
            shape_normals = np.einsum('lij,lj->li', capture_inverse[loop_vertex], target_normals)
            shape_normals /= np.linalg.norm(shape_normals, axis=1, keepdims=True)
            rest = np.empty(len(data.vertices) * 3, dtype=np.float32)
            data.vertices.foreach_get('co', rest)
            base_normals = np.empty(len(data.loops) * 3, dtype=np.float32)
            data.corner_normals.foreach_get('vector', base_normals)
            POSE_NORMALS[obj.name] = {'rest': rest.reshape(-1, 3).astype(np.float64), 'corner_vertex': loop_vertex,
                                      'target': shape_normals, 'base': base_normals.reshape(-1, 3).astype(np.float64)}
            obj.shape_key_add(name='Basis', from_mix=False)
            shape = obj.shape_key_add(name=key_name, from_mix=False)
            shape.data.foreach_set('co', target_rest.astype(np.float32).ravel())
            shape.value = idle_value
            data.update()
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


def read_glb(path):
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
    return document, binary


def write_glb(path, document, binary):
    body = json.dumps(document, separators=(',', ':')).encode()
    body += b' ' * ((-len(body)) % 4)
    binary = bytes(binary) + b'\x00' * ((-len(binary)) % 4)
    raw = (struct.pack('<4sII', b'glTF', 2, 28 + len(body) + len(binary))
           + struct.pack('<II', len(body), 0x4E4F534A) + body
           + struct.pack('<II', len(binary), 0x004E4942) + binary)
    with open(path, 'wb') as handle:
        handle.write(raw)


def vec3_at(document, index):
    accessor = document['accessors'][index]
    if accessor.get('componentType') != 5126 or accessor.get('type') != 'VEC3' or 'sparse' in accessor:
        raise SystemExit('FAIL: accessor %d is not a dense float VEC3' % index)
    view = document['bufferViews'][accessor['bufferView']]
    if view.get('byteStride', 12) != 12:
        raise SystemExit('FAIL: accessor %d is interleaved' % index)
    return view.get('byteOffset', 0) + accessor.get('byteOffset', 0), accessor['count']


def write_pose_normals(path):
    """Replace each pose shape's morph normals with the ones exact at the pose it was captured at.

    Every vertex in the file is matched to the Blender corners at its rest position, and to the
    corner among them whose normal it shipped with; a vertex smooth across its corners takes
    their shape normals averaged.
    """
    document, binary = read_glb(path)
    binary = bytearray(binary)
    report = {}
    for node_name, data in POSE_NORMALS.items():
        node = next((n for n in document['nodes'] if n.get('name') == node_name), None)
        if node is None or 'mesh' not in node:
            raise SystemExit('FAIL: pose shape node %s is not in the file' % node_name)

        def gltf(vectors):
            # Blender to glTF axes, as the exporter writes them with +Y up.
            return np.stack([vectors[:, 0], vectors[:, 2], -vectors[:, 1]], axis=1)

        linear, offset = data['to_armature'][:3, :3], data['to_armature'][:3, 3]
        normal_matrix = np.linalg.inv(linear).T

        def directions(vectors):
            moved = vectors @ normal_matrix.T
            return gltf(moved / np.linalg.norm(moved, axis=1, keepdims=True))

        corner_position = gltf(data['rest'] @ linear.T + offset)[data['corner_vertex']]
        corner_base, corner_shape = directions(data['base']), directions(data['target'])
        # The exporter can also bake a uniform scale into a skinned mesh (Gold's rig is scaled in
        # her source), which the object and rig matrices do not show. Fitted from the bounds and
        # then held to the same per-vertex match as everything else.
        first = document['meshes'][node['mesh']]['primitives'][0]['attributes']['POSITION']
        start, count = vec3_at(document, first)
        exported = np.frombuffer(bytes(binary[start:start + count * 12]), dtype='<f4').reshape(-1, 3)
        span = corner_position.max(0) - corner_position.min(0)
        scale = float(np.mean((exported.max(0) - exported.min(0)) / span))
        shift = (exported.max(0) + exported.min(0)) / 2 - scale * (corner_position.max(0) + corner_position.min(0)) / 2
        if abs(scale - 1.0) > 1e-4 or np.abs(shift).max() > 1e-5:
            corner_position = corner_position * scale + shift
        tree = KDTree(len(corner_position))
        for index, point in enumerate(corner_position):
            tree.insert(point, index)
        tree.balance()
        worst_distance, worst_agreement, averaged, written = 0.0, 1.0, 0, 0
        for primitive in document['meshes'][node['mesh']]['primitives']:
            targets = primitive.get('targets') or []
            if len(targets) != 1 or 'NORMAL' not in targets[0]:
                raise SystemExit('FAIL: %s has no morph normals to replace' % node_name)
            p_start, count = vec3_at(document, primitive['attributes']['POSITION'])
            n_start, n_count = vec3_at(document, primitive['attributes']['NORMAL'])
            t_start, t_count = vec3_at(document, targets[0]['NORMAL'])
            if not count == n_count == t_count:
                raise SystemExit('FAIL: %s accessors disagree on vertex count' % node_name)
            positions = np.frombuffer(bytes(binary[p_start:p_start + count * 12]), dtype='<f4').reshape(-1, 3)
            normals = np.frombuffer(bytes(binary[n_start:n_start + count * 12]), dtype='<f4').reshape(-1, 3)
            deltas = np.empty((count, 3), dtype=np.float32)
            for i in range(count):
                matches = tree.find_range(positions[i], 1e-5) or [tree.find(positions[i])]
                worst_distance = max(worst_distance, min(match[2] for match in matches))
                best, corner = max((float(np.dot(corner_base[match[1]], normals[i])), match[1]) for match in matches)
                if best < 0.999:
                    shape = corner_shape[[match[1] for match in matches]].mean(axis=0)
                    averaged += 1
                else:
                    shape = corner_shape[corner]
                worst_agreement = min(worst_agreement, best)
                deltas[i] = shape / np.linalg.norm(shape) - normals[i]
            binary[t_start:t_start + count * 12] = deltas.astype('<f4').tobytes()
            written += count
        report[node_name] = {'vertices': written, 'worst_position_match_m': worst_distance,
                             'worst_normal_agreement': round(worst_agreement, 6), 'averaged': averaged,
                             'fitted_scale': round(scale, 6)}
        if worst_distance > 1e-4:
            np.savez(path + '.%s.mismatch.npz' % node_name, blender=corner_position, exported=positions)
            raise SystemExit('FAIL: %s vertices matched Blender corners only within %.6f m (armature transform %s)'
                             % (node_name, worst_distance, np.round(data['to_armature'], 4).tolist()))
    write_glb(path, document, binary)
    return report


def main():
    args = arguments()
    POSE_NORMALS.clear()
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

    shape_weights = {}
    if POSE_SHAPES:
        by_name = {obj.name: obj for obj in meshes}
        for mesh_name in POSE_SHAPES:
            spec = shape_spec(mesh_name)
            obj = by_name.get(mesh_name)
            keys = obj.data.shape_keys if obj is not None else None
            if keys is None or spec['key'] not in keys.key_blocks:
                hint = ' - run add_silver_standing_shapes.py on it first' if POSE_SHAPES[mesh_name] is STANDING else ''
                raise SystemExit('FAIL: pose shape %s on %s is not in the candidate%s' % (spec['key'], mesh_name, hint))
            if spec['capture'][0] not in bpy.data.actions:
                raise SystemExit('FAIL: %s is captured on %s, which the candidate lacks' % (mesh_name, spec['capture'][0]))
            if keys.animation_data is not None:
                # Anything left driving the key in the source would overwrite the per-frame weight,
                # including the driver that lets the file play the key in Blender.
                keys.animation_data.action = None
                for track in keys.animation_data.nla_tracks:
                    track.mute = True
                path = 'key_blocks["%s"].value' % bpy.utils.escape_identifier(spec['key'])
                for curve in [c for c in keys.animation_data.drivers if c.data_path == path]:
                    keys.animation_data.drivers.remove(curve)
            keys.key_blocks[spec['key']].mute = False
        shape_weights = pose_shape_weights(source_scene, source_rig, meshes)
        report['pose_shapes'] = {
            mesh_name: {'key': shape_spec(mesh_name)['key'], 'on': shape_spec(mesh_name)['on'],
                        'capture': list(shape_spec(mesh_name)['capture']),
                        'seat_on_mm': SEAT_ON_MM, 'seat_off_mm': SEAT_OFF_MM,
                        'clips': {clip: {'first': round(rows[0], 4), 'last': round(rows[-1], 4),
                                         'min': round(min(rows), 4), 'max': round(max(rows), 4)}
                                  for clip, rows in shape_weights[mesh_name].items()}}
            for mesh_name in POSE_SHAPES}

    # What Blender shows, for every clip at five frames, before anything is converted. Pose
    # shapes are set to the weight that frame will ship with.
    source_geometry = {}
    for clip, last in SHIPPING.items():
        assign(source_rig, bpy.data.actions[clip])
        for frame in sample_frames(last):
            set_frame(source_scene, frame)
            if shape_weights:
                set_pose_shapes(meshes, shape_weights, clip, frame)
            source_geometry[(clip, frame)] = {obj.name: world_points(obj) for obj in meshes}
    assign(source_rig, bpy.data.actions['IDLE_thinking_readable'])
    set_frame(source_scene, 0)
    if shape_weights:
        set_pose_shapes(meshes, shape_weights, 'IDLE_thinking_readable', 0)
    frame0 = {obj.name: world_points(obj) for obj in meshes}

    export_scene = bpy.data.scenes.new('Silver integration export')
    export_collection = bpy.data.collections.new('Character export')
    export_scene.collection.children.link(export_collection)
    export_scene.render.fps = FPS
    export_scene.frame_start = 0
    export_scene.frame_end = max(SHIPPING.values())
    rig = source_rig.copy()
    rig.data = source_rig.data.copy()
    rig.animation_data_clear()
    rig.parent = None
    rig.matrix_world = source_rig.matrix_world.copy()
    export_collection.objects.link(rig)
    rig.name = EXPORT_RIG
    # The venue build reads this and leaves the rig alone: the seated pose is already in every
    # clip and in the rest, and posing it again would bake over the animation channels.
    rig['riverSeatedBaked'] = True
    exported, weights = build_export_meshes(source_scene, source_rig, export_collection, rig, meshes)
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
    if shape_weights:
        add_pose_shape_tracks(exported, shape_weights)

    if RELOAD_EXPORT_SCENE:
        stage = os.path.join(out, 'character-export-stage.blend')
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=stage, check_existing=False)
        bpy.ops.wm.open_mainfile(filepath=stage)
        export_scene = bpy.context.scene
        rig = bpy.data.objects[EXPORT_RIG]
        exported = sorted((obj for obj in export_scene.objects if obj.type == 'MESH'
                           and 'sourceName' in obj), key=lambda obj: obj.name)

    mesh_names = {obj.name: obj.data.name for obj in exported}
    # The file holds a skinned mesh in its armature's space. Read after an update: matrix_world
    # is stale straight after parenting.
    bpy.context.view_layer.update()
    for obj in exported:
        if obj.name in POSE_NORMALS:
            POSE_NORMALS[obj.name]['to_armature'] = np.array(rig.matrix_world.inverted() @ obj.matrix_world)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rig, *exported]:
        obj.hide_render = False
        obj.hide_viewport = False
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
    if POSE_SHAPES:
        # Dense morph accessors, so their normals can be replaced in place after export.
        options.update(export_morph=True, export_morph_normal=True, export_morph_animation=True,
                       export_try_sparse_sk=False)
    available = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    unknown = sorted(key for key in options if key not in available)
    if unknown:
        raise SystemExit('FAIL: this Blender glTF exporter has no option %s' % ', '.join(unknown))
    bpy.ops.export_scene.gltf(**options)
    rewrite_alpha_modes(glb, translation)
    if POSE_NORMALS:
        report['pose_normals'] = write_pose_normals(glb)
        for name, entry in report['pose_normals'].items():
            print('POSE NORMALS %-34s %d vertices, positions within %.2e m, %d averaged'
                  % (name, entry['vertices'], entry['worst_position_match_m'], entry['averaged']))

    checker = load_checker()
    shaped_nodes = {EXPORT_PREFIX + '_' + slug(name): 1 for name in POSE_SHAPES}
    stats, problems = checker.inspect(glb, list(SHIPPING), 137, pose_shapes=shaped_nodes)
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
    # Blender's importer names a mesh that carries shape-key animation after its mesh data and
    # leaves its node extras behind, so those are matched by mesh name, suffix ignored.
    def unsuffixed(name):
        return re.sub(r'\.\d{3}$', '', name)
    by_exact = {mesh_names[obj.name]: obj['sourceName'] for obj in exported}
    by_node = {obj.name: obj['sourceName'] for obj in exported}
    by_mesh = {}
    for obj in exported:
        by_mesh.setdefault(unsuffixed(mesh_names[obj.name]), []).append(obj['sourceName'])
    import_meshes = {}
    for obj in imported:
        if obj.type != 'MESH':
            continue
        # A pose-shape mesh is exported under its node's unique name, which the importer gives
        # the object, renumbered if the name is already taken in this session.
        source = obj.get('sourceName') or by_exact.get(obj.name) or by_node.get(unsuffixed(obj.name))
        if source is None:
            owners = by_mesh.get(unsuffixed(obj.data.name), [])
            if len(owners) > 1:
                raise SystemExit('FAIL: reimported mesh %s could belong to %s' % (obj.data.name, owners))
            source = owners[0] if owners else None
        if source is not None:
            import_meshes[source] = obj
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

    # The pose shapes' weights come back as shape-key animation. Without playing them the
    # comparison would hold every shape at its default and measure the wrong garment.
    shape_clips = {}
    for mesh_name in POSE_SHAPES:
        key_name = shape_spec(mesh_name)['key']
        keys = import_meshes[mesh_name].data.shape_keys
        if keys is None or key_name not in keys.key_blocks:
            raise SystemExit('FAIL: reimport lost the %s shape on %s' % (key_name, mesh_name))
        found = {}
        if keys.animation_data is not None:
            for track in keys.animation_data.nla_tracks:
                for strip in track.strips:
                    for clip in SHIPPING:
                        if clip in (track.name, strip.name) or (strip.action and strip.action.name.startswith(clip)):
                            found[clip] = (strip.action, getattr(strip, 'action_slot', None))
                track.mute = True
        for clip in SHIPPING:
            if clip not in found:
                action, _ = clips[clip]
                slot = next((s for s in action.slots if getattr(s, 'target_id_type', '') == 'KEY'), None)
                if slot is not None:
                    found[clip] = (action, slot)
        lost = [clip for clip in SHIPPING if clip not in found]
        if lost:
            raise SystemExit('FAIL: reimport did not recover the %s weights for %s' % (key_name, ', '.join(lost)))
        shape_clips[mesh_name] = found

    report['reimport_geometry_mm'] = {}
    for clip, last in SHIPPING.items():
        action, slot = clips[clip]
        assign(import_rig, action, slot)
        for mesh_name, found in shape_clips.items():
            keys = import_meshes[mesh_name].data.shape_keys
            keys.animation_data_create()
            shape_action, shape_slot = found[clip]
            keys.animation_data.action = shape_action
            if shape_slot is not None:
                keys.animation_data.action_slot = shape_slot
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

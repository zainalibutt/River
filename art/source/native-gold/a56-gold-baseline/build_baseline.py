"""Preserve Zain's amended A56 Gold file as the baseline, self-contained.

The file as saved names its six textures relative to the folder it was saved in, and they
live in the local MPFB asset install, so a copy anywhere else opens pink. This packs them
into the file - they are MakeHuman CC0 assets - and changes nothing else: every action,
the rest rig, every mesh, shape key, weight and UV is compared before and after, from a
fresh open of each.

  node art/pipeline/run_blender.mjs art/source/native-gold/a56-gold-baseline/build_baseline.py -- \\
      --source <a56-check-review.blend as Zain saved it>
"""
import argparse
import hashlib
import json
import os
import re
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(HERE, 'a56-gold-master.blend')
SOURCE_SHA256 = '590f4214d12fcf1e219f33af29536fb013cc16b80a77297bdfa2ed5fa2bd71c3'
MPFB_ASSETS = os.path.join(os.environ.get('APPDATA', ''), 'Blender Foundation', 'Blender', '5.2', 'mpfb')


def digest(value):
    return hashlib.sha256(repr(value).encode()).hexdigest()


def curves(action):
    return [curve for layer in action.layers for strip in layer.strips
            for bag in strip.channelbags for curve in bag.fcurves]


def signature():
    rig = bpy.data.objects['river_native_gold_body.rig']
    meshes = {}
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        meshes[obj.name] = digest((
            [tuple(v.co) for v in mesh.vertices],
            [tuple(p.vertices) for p in mesh.polygons],
            [[(g.group, g.weight) for g in v.groups] for v in mesh.vertices],
            [[tuple(loop.uv) for loop in uv.data] for uv in mesh.uv_layers],
            {k.name: ([tuple(v.co) for v in k.data], k.value) for k in mesh.shape_keys.key_blocks}
            if mesh.shape_keys else {},
            [(m.name, m.type) for m in obj.modifiers],
            [slot.material.name if slot.material else None for slot in obj.material_slots],
            tuple(map(tuple, obj.matrix_world)),
        ))
    actions = {action.name: digest((list(action.frame_range),
                                    [(c.data_path, c.array_index, [tuple(k.co) for k in c.keyframe_points])
                                     for c in curves(action)]))
               for action in bpy.data.actions}
    return {
        'meshes': meshes,
        'actions': actions,
        'rest_rig': digest([(b.name, b.parent.name if b.parent else None, tuple(map(tuple, b.matrix_local)))
                            for b in rig.data.bones]),
        'bones': len(rig.data.bones),
    }


LOCAL_PATH = re.compile(r'(?<![a-z])[A-Za-z]:[\\/]|[\\/]Users[\\/]|AppData', re.IGNORECASE)
BINARY_LOCAL_PATHS = (
    re.compile(rb'[A-Za-z]:[\\/]Users[\\/]', re.IGNORECASE),
    re.compile(rb'[\\/]Users[\\/]', re.IGNORECASE),
    re.compile(rb'AppData[\\/]', re.IGNORECASE),
)


def local_paths():
    """Every string property on every datablock, and the render and image paths, that names
    a drive, a home directory or AppData. URLs are not paths."""
    found = []
    for collection_name in dir(bpy.data):
        collection = getattr(bpy.data, collection_name, None)
        if not isinstance(collection, bpy.types.bpy_prop_collection):
            continue
        for datablock in collection:
            if not isinstance(datablock, bpy.types.ID):
                continue
            owners = [datablock]
            if isinstance(datablock, bpy.types.Scene):
                owners += [datablock.render, datablock.render.image_settings]
            for owner in owners:
                for prop in owner.bl_rna.properties:
                    if prop.type != 'STRING':
                        continue
                    try:
                        value = getattr(owner, prop.identifier)
                    except Exception:
                        continue
                    if isinstance(value, str) and '://' not in value and LOCAL_PATH.search(value):
                        found.append('%s.%s' % (datablock.name, prop.identifier))
            for key in datablock.keys():
                text = str(datablock[key])
                if '://' not in text and LOCAL_PATH.search(text):
                    found.append('%s["%s"]' % (datablock.name, key))
            if isinstance(datablock, bpy.types.Image):
                for index, packed in enumerate(datablock.packed_files):
                    if LOCAL_PATH.search(packed.filepath):
                        found.append('%s.packed_files[%d].filepath' % (datablock.name, index))
    return found


def binary_local_paths():
    with open(MASTER, 'rb') as handle:
        contents = handle.read()
    return [pattern.pattern.decode() for pattern in BINARY_LOCAL_PATHS if pattern.search(contents)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    with open(args.source, 'rb') as handle:
        if hashlib.sha256(handle.read()).hexdigest() != SOURCE_SHA256:
            raise SystemExit('FAIL: the source is not the file Zain amended')

    bpy.ops.wm.open_mainfile(filepath=args.source)
    before = signature()
    for image in bpy.data.images:
        if not image.filepath:
            continue
        if not image.packed_file:
            normalised = image.filepath.replace('/', '\\')
            if '\\mpfb\\' not in normalised:
                raise SystemExit('FAIL: %s is not an MPFB texture: %s' % (image.name, image.filepath))
            path = os.path.join(MPFB_ASSETS, normalised.split('\\mpfb\\', 1)[1])
            if not os.path.exists(path):
                raise SystemExit('FAIL: texture %s not found at %s' % (image.name, path))
            image.filepath_raw = path
            image.reload()
            image.pack()
        # Packed, the path is only a label; keep it free of this machine's layout.
        clean_path = '//textures/' + os.path.basename(image.filepath)
        image.filepath_raw = clean_path
        for packed in image.packed_files:
            packed.filepath = clean_path
    unpacked = [image.name for image in bpy.data.images if image.filepath and not image.packed_file]
    if unpacked:
        raise SystemExit('FAIL: textures left unpacked: %s' % unpacked)
    # The repository is public and its hygiene gate cannot read a .blend. The file as saved
    # carries the absolute path its last review render was written to; clear it, then
    # refuse to write anything that still names a local path.
    for scene in bpy.data.scenes:
        scene.render.filepath = '//'
    leaks = local_paths()
    if leaks:
        raise SystemExit('FAIL: the master would carry local paths: %s' % leaks)
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.wm.save_as_mainfile(filepath=MASTER, compress=True, relative_remap=False)

    binary_leaks = binary_local_paths()
    if binary_leaks:
        raise SystemExit('FAIL: the saved master contains local path bytes: %s' % binary_leaks)

    bpy.ops.wm.open_mainfile(filepath=MASTER)
    after = signature()
    gates = {
        'actions_identical': before['actions'] == after['actions'],
        'rest_rig_identical': before['rest_rig'] == after['rest_rig'],
        'meshes_identical': before['meshes'] == after['meshes'],
        'bones': after['bones'],
        'textures_packed': all(image.packed_file for image in bpy.data.images if image.filepath),
        'no_local_paths': not local_paths(),
        'no_binary_local_paths': not binary_local_paths(),
    }
    with open(MASTER, 'rb') as handle:
        master_sha = hashlib.sha256(handle.read()).hexdigest()
    print('BASELINE', json.dumps({'gates': gates, 'masterSha256': master_sha,
                                  'actions': sorted(after['actions'])}))
    if not all(value for key, value in gates.items() if key != 'bones') or gates['bones'] != 137:
        raise SystemExit('FAIL: the packed baseline is not the amended file: %s' % gates)


main()

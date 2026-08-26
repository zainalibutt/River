import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.environ.get('RIVER_OUT', os.path.join(HERE, '..', 'out'))

sys.path.insert(0, HERE)

from build_characters import build_animations


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action, do_unlink=True)


def rebuild(source):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=source)
    imported = list(bpy.context.scene.objects)
    armature = next((obj for obj in imported if obj.type == 'ARMATURE'), None)
    if armature is None:
        raise SystemExit('FAIL: character asset has no armature ' + source)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action, do_unlink=True)
    actions = build_animations(armature)
    target = source.replace('.glb', '.clips.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in imported:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=target,
        check_existing=False,
        export_format='GLB',
        export_materials='EXPORT',
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
    )
    print('CLIPS %s actions=%d output=%s' % (os.path.basename(source), len(actions), target))
    return target


def main():
    sources = [os.path.join(OUT_DIR, 'char_male.glb'), os.path.join(OUT_DIR, 'char_female.glb')]
    for source in sources:
        if not os.path.exists(source):
            raise SystemExit('FAIL: missing character asset ' + source)
    rebuilt = [(source, rebuild(source)) for source in sources]
    for source, target in rebuilt:
        os.replace(target, source)
        print('REPLACED ' + source)


main()

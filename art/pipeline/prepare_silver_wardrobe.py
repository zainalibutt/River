"""Restore stock-masked skin and bake the existing seated pose for authored clothes.

Run from the repository root with Blender --background --python-exit-code 1
--python art/pipeline/prepare_silver_wardrobe.py. No shipped asset is written.
"""
import os
import sys
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_native_silver as silver


def main():
    bpy.ops.wm.open_mainfile(filepath=silver.SOURCE)
    body = bpy.data.objects['river_native_silver_body']
    rig = next(m.object for m in body.modifiers if m.type == 'ARMATURE')
    for modifier in list(body.modifiers):
        if modifier.type == 'MASK' and 'elegant' in modifier.name.lower():
            body.modifiers.remove(modifier)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH'
              and o.name.startswith('river_') and 'suit' not in o.name]
    for obj in list(bpy.data.objects):
        if obj not in meshes and obj != rig:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in meshes:
        silver.bake_shape_keys(obj)
        for modifier in obj.modifiers:
            modifier.show_viewport = modifier.show_render
        silver.apply_non_armature_modifiers(obj)
    silver.bake_seated_pose(rig, meshes)
    print('RESTORED_SKIN', len(body.data.vertices), 'vertices; stock suit mask removed')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('art/out/proofs/native-silver/a7-body.blend'))


if __name__ == '__main__':
    main()

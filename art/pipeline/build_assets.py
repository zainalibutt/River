import json
import math
import os
import sys

os.environ.setdefault('RIVER_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from geo import felt_disc, wood_drum, rail_ring, chip_face, chip_rim, card_body
from values import (
    FELT_HEX,
    RAIL_HEX,
    WOOD_HEX,
    CARD_FACE_HEX,
    CHIP_DENOMS,
    CHIP_THICK,
)


def clear_scene():
    for scene in list(bpy.data.scenes):
        collection = scene.collection
        for obj in list(collection.objects):
            collection.objects.unlink(obj)
            bpy.data.objects.remove(obj)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def add_material(name, hex_value):
    material = bpy.data.materials.new(name)
    rgb = tuple(int(hex_value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    material.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    return material


def build_mesh(name, geo, material):
    verts, faces = geo
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    if material is not None:
        mesh.materials.append(material)
    return mesh


def shared_mesh(source_mesh, material):
    mesh = source_mesh.copy()
    mesh.name = source_mesh.name + '_variant'
    mesh.materials.clear()
    mesh.materials.append(material)
    return mesh


def object_at(name, mesh, location, parent=None):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = list(location)
    if parent is not None:
        obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    return obj


def write_manifest(out_dir, glb_path, stats):
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as handle:
        json.dump({'scene': glb_path, 'stats': stats}, handle, indent=2)


def main():
    out_dir = os.environ['RIVER_OUT']
    os.makedirs(out_dir, exist_ok=True)
    clear_scene()
    felt_mat = add_material('river_felt', FELT_HEX)
    rail_mat = add_material('river_rail', RAIL_HEX)
    wood_mat = add_material('river_wood', WOOD_HEX)
    card_face_mat = add_material('river_card_face', CARD_FACE_HEX)
    chip_matrices = {}
    for denom, face_hex, rim_hex in CHIP_DENOMS:
        chip_matrices[denom] = (
            add_material(denom + '_face', face_hex),
            add_material(denom + '_rim', rim_hex),
        )
    felt_mesh = build_mesh('river_felt', felt_disc(), felt_mat)
    wood_mesh = build_mesh('river_wood', wood_drum(), wood_mat)
    rail_mesh = build_mesh('river_rail', rail_ring(), rail_mat)
    object_at('river_felt', felt_mesh, (0.0, 0.0, 0.0))
    object_at('river_wood', wood_mesh, (0.0, 0.0, 0.0))
    object_at('river_rail', rail_mesh, (0.0, 0.0, 0.0))
    base_face = build_mesh('chip_base_face', chip_face(), None)
    base_rim = build_mesh('chip_base_rim', chip_rim(), None)
    patron_meshes = {}
    for denom, (face_mat, rim_mat) in chip_matrices.items():
        face = shared_mesh(base_face, face_mat)
        rim = shared_mesh(base_rim, rim_mat)
        patron_meshes[denom] = (face, rim)
    pot_positions = []
    for stack_index in range(8):
        angle = 2.0 * math.pi * stack_index / 8
        pot_positions.append((0.35 * math.cos(angle), 0.35 * math.sin(angle)))
    for index, (pot_x, pot_y) in enumerate(pot_positions):
        denom = list(CHIP_DENOMS)[index % len(CHIP_DENOMS)][0]
        face, rim = patron_meshes[denom]
        height = (index + 1) * CHIP_THICK
        object_at('pot_chip_' + str(index), face, (pot_x, pot_y, height))
        object_at('pot_chip_' + str(index) + '_rim', rim, (pot_x, pot_y, height))
    deck = build_mesh('river_card', card_body(), card_face_mat)
    card_offsets = [
        (0.0, 0.0, CHIP_THICK * 3),
        (0.09, 0.0, CHIP_THICK * 3),
        (-0.09, 0.0, CHIP_THICK * 3),
    ]
    for index, offset in enumerate(card_offsets):
        object_at('river_card_' + str(index), deck, offset)
    blend = os.path.join(out_dir, 'river_assets.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    glb = os.path.join(out_dir, 'river_assets.glb')
    bpy.ops.export_scene.gltf(
        filepath=glb,
        check_existing=False,
        export_format='GLB',
        export_copyright='',
        export_apply=False,
        export_yup=True,
        export_materials='EXPORT',
    )
    stats = {
        'objects': len(bpy.data.objects),
        'meshes': len(bpy.data.meshes),
        'materials': len(bpy.data.materials),
    }
    write_manifest(out_dir, glb, stats)
    print('OUT ' + glb)
    print(json.dumps(stats))


main()
import json
import math
import os
import struct
import sys

os.environ.setdefault('RIVER_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import check_assets as checker
from buildkit import (
    add_emissive_material,
    add_material,
    add_metal_material,
    build_mesh_from_geo,
    clear_scene,
    colorramp_material,
    hex_to_rgb,
    make_checker_material,
    object_at,
    retint,
    seat_positions,
    smooth_mesh_by_angle,
)
from build_characters import build_animations
from geo import (
    concat,
    mountain_range,
    fire_bowl,
    palm,
    skyline_towers,
    translate_geo,
    transform_geo,
    balustrade,
    bar_back,
    card_body,
    box,
    checkerboard_plane,
    bar_bottle,
    basement_counter,
    chair_dining,
    chair_folding,
    chair_swivel,
    chandelier,
    chip_face,
    chip_rim,
    crate_stack,
    felt_oval,
    machine_unit,
    ceiling_pipes,
    room_walls,
    laundry_cart,
    suite_baluster,
    suite_handrail,
    suite_scroll,
    chandelier_rods,
    suite_sconces,
    standing_patron,
    parapet_ring,
    planter,
    rail_ring_oval,
    stepladder,
    string_light_run,
    terrace_disc,
    wall_panel,
    wall_sconce,
    wood_pedestal,
)
from values import (
    BUDGET,
    VENUE_CAMERA,
    VENUE_LIGHTS,
    CHIP_DENOMS,
    CHIP_THICK,
    FELT_RX,
    FELT_RY,
    SEAT_H,
    VENUES,
    WOOD_HEX,
)

OUT_DIR = os.environ['RIVER_OUT']
TEX_DIR = os.path.join(OUT_DIR, 'textures')

VENUE_CHAIR = {
    'rooftop': chair_swivel,
    'basement': chair_folding,
    'suite': chair_dining,
}

CHARACTER_SCALE = 0.73
CHARACTER_SEAT_Z = 0.05
CHARACTER_VARIANTS = ('male', 'female')
CHARACTER_BODY_LOD_RATIO = 0.42
CHARACTER_GARMENT_LOD_RATIO = 0.24
DOWNLOAD_BUDGET_KB = 6144
CHARACTER_ATLAS_SIZE = 1024
CHARACTER_ATLAS_COLUMNS = 8
CHARACTER_ATLAS_ROWS = 4

BASE_ATLAS_CELLS = {
    'skin': (0, 0),
    'torso': (1, 0),
    'head': (2, 0),
    'face': (3, 0),
    'hands': (4, 0),
    'accent': (5, 0),
}

COSMETIC_ATLAS = {
    'cap-grey': {'slot': 'head', 'paletteIndex': 0, 'colour': (0.22, 0.24, 0.25, 1.0)},
    'cap-navy': {'slot': 'head', 'paletteIndex': 1, 'colour': (0.08, 0.14, 0.25, 1.0)},
    'cap-tan': {'slot': 'head', 'paletteIndex': 2, 'colour': (0.58, 0.38, 0.18, 1.0)},
    'cap-silk': {'slot': 'head', 'paletteIndex': 3, 'colour': (0.25, 0.08, 0.12, 1.0)},
    'glasses-round': {'slot': 'face', 'paletteIndex': 4, 'colour': (0.08, 0.08, 0.09, 1.0)},
    'glasses-shade': {'slot': 'face', 'paletteIndex': 5, 'colour': (0.04, 0.18, 0.20, 1.0)},
    'glasses-mono': {'slot': 'face', 'paletteIndex': 6, 'colour': (0.67, 0.48, 0.16, 1.0)},
    'jacket-leather': {'slot': 'torso', 'paletteIndex': 7, 'colour': (0.06, 0.07, 0.08, 1.0)},
    'jacket-bomb': {'slot': 'torso', 'paletteIndex': 8, 'colour': (0.28, 0.31, 0.34, 1.0)},
    'jacket-pinstripe': {'slot': 'torso', 'paletteIndex': 9, 'colour': (0.12, 0.13, 0.15, 1.0)},
    'jacket-cardinal': {'slot': 'torso', 'paletteIndex': 10, 'colour': (0.46, 0.05, 0.07, 1.0)},
    'ring-signet': {'slot': 'hands', 'paletteIndex': 11, 'colour': (0.75, 0.48, 0.10, 1.0)},
    'ring-silver': {'slot': 'hands', 'paletteIndex': 12, 'colour': (0.63, 0.67, 0.70, 1.0)},
    'ring-jade': {'slot': 'hands', 'paletteIndex': 13, 'colour': (0.06, 0.42, 0.25, 1.0)},
    'ring-pearl': {'slot': 'hands', 'paletteIndex': 14, 'colour': (0.86, 0.82, 0.71, 1.0)},
    'bandana-red': {'slot': 'accent', 'paletteIndex': 15, 'colour': (0.63, 0.05, 0.04, 1.0)},
    'chain-gold': {'slot': 'accent', 'paletteIndex': 16, 'colour': (0.82, 0.55, 0.10, 1.0)},
    'watch-brass': {'slot': 'accent', 'paletteIndex': 17, 'colour': (0.55, 0.31, 0.08, 1.0)},
    'scarf-plaid': {'slot': 'accent', 'paletteIndex': 18, 'colour': (0.19, 0.32, 0.20, 1.0)},
    'pin-diamond': {'slot': 'accent', 'paletteIndex': 19, 'colour': (0.26, 0.62, 0.68, 1.0)},
    'beanie-wool': {'slot': 'head', 'paletteIndex': 20, 'colour': (0.35, 0.16, 0.24, 1.0)},
    'scarf-silk': {'slot': 'accent', 'paletteIndex': 21, 'colour': (0.42, 0.16, 0.38, 1.0)},
}

COSMETIC_PREVIEW_LOADOUTS = (
    {
        'head': 'cap-grey',
        'face': 'glasses-round',
        'torso': 'jacket-leather',
        'hands': 'ring-signet',
        'accent': 'chain-gold',
    },
    {
        'head': 'cap-silk',
        'face': 'glasses-mono',
        'torso': 'jacket-cardinal',
        'hands': 'ring-jade',
        'accent': 'scarf-silk',
    },
)

DEALER_LOADOUT = {
    'head': 'cap-navy',
    'face': 'glasses-round',
    'torso': 'jacket-bomb',
    'hands': 'ring-silver',
    'accent': 'bandana-red',
}


def atlas_cell(column, row):
    return (
        column / CHARACTER_ATLAS_COLUMNS,
        row / CHARACTER_ATLAS_ROWS,
        1.0 / CHARACTER_ATLAS_COLUMNS,
        1.0 / CHARACTER_ATLAS_ROWS,
    )


def atlas_region_for_slot(slot):
    return atlas_cell(*BASE_ATLAS_CELLS[slot])


def atlas_region_for_cosmetic(cosmetic_id):
    cosmetic = COSMETIC_ATLAS[cosmetic_id]
    index = cosmetic['paletteIndex']
    return atlas_cell(index % CHARACTER_ATLAS_COLUMNS, 1 + index // CHARACTER_ATLAS_COLUMNS)


def cosmetic_metadata(cosmetic_id):
    cosmetic = COSMETIC_ATLAS[cosmetic_id]
    return {
        'id': cosmetic_id,
        'slot': cosmetic['slot'],
        'paletteIndex': cosmetic['paletteIndex'],
        'region': list(atlas_region_for_cosmetic(cosmetic_id)),
    }


def remap_character_uv(obj, region, face_region=None):
    if obj.type != 'MESH':
        return
    uv_layer = obj.data.uv_layers[0] if obj.data.uv_layers else obj.data.uv_layers.new(name='UVMap')
    u0, v0, width, height = region
    inset_u = width * 0.08
    inset_v = height * 0.08
    for loop_index, uv in enumerate(uv_layer.data):
        vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
        active_region = region
        if face_region is not None and vertex.z > 1.34 and abs(vertex.x) < 0.18 and -0.159 < vertex.y < -0.08:
            active_region = face_region
        active_u0, active_v0, active_width, active_height = active_region
        active_inset_u = active_width * 0.08
        active_inset_v = active_height * 0.08
        if active_region == face_region:
            source_u = 0.5 + max(-0.5, min(0.5, vertex.x / 0.62)) * 0.42
            source_v = 0.18 + max(0.0, min(1.0, (vertex.z - 1.0) / 0.67)) * 0.66
        else:
            source_u = float(uv.uv.x) % 1.0
            source_v = float(uv.uv.y) % 1.0
        uv.uv.x = active_u0 + active_inset_u + source_u * (active_width - active_inset_u * 2.0)
        uv.uv.y = active_v0 + active_inset_v + source_v * (active_height - active_inset_v * 2.0)


def apply_seated_rest_pose(armature, pose_legs=False):
    for side, rotation in (('L', -0.38), ('R', 0.38)):
        bone = armature.pose.bones.get('upperarm01.' + side)
        if bone is not None:
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = (math.radians(-7.0), 0.0, rotation)
        forearm = armature.pose.bones.get('lowerarm01.' + side)
        if forearm is not None:
            forearm.rotation_mode = 'XYZ'
            forearm.rotation_euler = (math.radians(8.0), 0.0, 0.0)
        if pose_legs:
            thigh = armature.pose.bones.get('upperleg02.' + side)
            if thigh is not None:
                thigh.rotation_mode = 'XYZ'
                thigh.rotation_euler = (math.radians(-70.0), 0.0, 0.0)
            shin = armature.pose.bones.get('lowerleg01.' + side)
            if shin is not None:
                shin.rotation_mode = 'XYZ'
                shin.rotation_euler = (math.radians(75.0), 0.0, 0.0)
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def shape_seated_arms(obj):
    if obj.type != 'MESH':
        return
    arm_groups = {
        group.index
        for group in obj.vertex_groups
        if any(token in group.name.lower() for token in ('upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal'))
    }
    if not arm_groups:
        return
    for vertex in obj.data.vertices:
        if any(element.group in arm_groups and element.weight > 0.2 for element in vertex.groups):
            vertex.co.x *= 0.70
            vertex.co.y -= 0.07
            vertex.co.z -= 0.015


def strip_opaque_hair_planes(obj):
    mesh = obj.data
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        first, second = edge.vertices
        adjacency[first].append(second)
        adjacency[second].append(first)
    components = []
    seen = set()
    for vertex in mesh.vertices:
        if vertex.index in seen:
            continue
        component = set()
        pending = [vertex.index]
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            seen.add(current)
            pending.extend(adjacency[current])
        components.append(component)
    hair_vertices = set()
    hair_faces = 0
    hair_components = 0
    for component in components:
        points = [mesh.vertices[index].co for index in component]
        z_min = min(point.z for point in points)
        z_max = max(point.z for point in points)
        faces = sum(1 for face in mesh.polygons if all(index in component for index in face.vertices))
        if len(component) <= 18 and faces <= 16 and z_max >= 1.62 and z_max - z_min >= 0.18:
            hair_vertices.update(component)
            hair_faces += faces
            hair_components += 1
    if not hair_vertices:
        return 0, 0, 0
    mesh_data = bmesh.new()
    mesh_data.from_mesh(mesh)
    mesh_data.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh_data, geom=[mesh_data.verts[index] for index in sorted(hair_vertices)], context='VERTS')
    mesh_data.to_mesh(mesh)
    mesh_data.free()
    obj['removedOpaqueHairComponents'] = hair_components
    obj['removedOpaqueHairFaces'] = hair_faces
    obj['removedOpaqueHairVertices'] = len(hair_vertices)
    return hair_components, hair_faces, len(hair_vertices)


def build_chip_meshes():
    face_geo = chip_face()
    rim_geo = chip_rim()
    face_faces = len(face_geo[1])
    pooled_geo = concat([face_geo, rim_geo])
    lookup = {}
    for denom, face_hex, rim_hex in CHIP_DENOMS:
        face_mat = add_material(denom + '_face', face_hex)
        rim_mat = add_material(denom + '_rim', rim_hex)
        mesh = build_mesh_from_geo(denom + '_chip_pool', pooled_geo)
        mesh.materials.append(face_mat)
        mesh.materials.append(rim_mat)
        for polygon in mesh.polygons[:face_faces]:
            polygon.material_index = 0
        for polygon in mesh.polygons[face_faces:]:
            polygon.material_index = 1
        lookup[denom] = mesh
    return lookup


def build_cards():
    back_mat = add_material('river_card_back', '5A2733')
    card = build_mesh_from_geo('river_card', card_body())
    card.materials.append(back_mat)
    return card


def add_board_cards(card_mesh, count=5):
    spacing = 0.09
    total = (count - 1) * spacing
    instances = []
    for i in range(count):
        x = -total / 2 + i * spacing
        instances.append({
            'id': 'card_%d' % i,
            'translation': [x, 0.0, 0.9],
            'rotation': [0.0, 0.0, 0.0, 1.0],
            'scale': [1.0, 1.0, 1.0],
        })
    return instances


def build_table(venue, rail_mat, wood_mat):
    felt_mat, _ramp = colorramp_material(venue['id'] + '_felt', [(0.0, venue['felt']), (1.0, venue['felt'])])
    felt = build_mesh_from_geo('river_' + venue['id'] + '_felt', felt_oval())
    felt.materials.append(felt_mat)
    object_at('river_' + venue['id'] + '_table_felt', felt, (0.0, 0.0, 0.0))
    rail = build_mesh_from_geo('river_' + venue['id'] + '_rail', rail_ring_oval())
    rail.materials.append(rail_mat)
    object_at('river_' + venue['id'] + '_table_rail', rail, (0.0, 0.0, 0.0))
    pedestal = build_mesh_from_geo('river_' + venue['id'] + '_wood', wood_pedestal())
    pedestal.materials.append(wood_mat)
    object_at('river_' + venue['id'] + '_table_base', pedestal, (0.0, 0.0, 0.0))


def build_chairs(venue, chair_fn, chair_mat, count=9):
    positions = seat_positions(count)
    for index, (x, y) in enumerate(positions):
        chair_geo = chair_fn()
        leather_faces = None
        if venue['id'] == 'rooftop':
            chair_geo, leather_faces = chair_geo
        mesh = build_mesh_from_geo('%s_chair_%d' % (venue['id'], index), chair_geo)
        mesh.materials.append(chair_mat)
        if leather_faces is not None:
            # The chair's chrome is the chair's own. This used to reach for
            # 'chip_100_rim' - a poker chip's edge - so every chair pedestal and
            # foot ring in the venue was painted whatever colour the 100 chip
            # happened to be, and restyling the chips would silently restyle the
            # furniture. The palette has defined 'chrome' the whole time.
            chrome = bpy.data.materials.get('rooftop_chrome')
            if chrome is None:
                chrome = add_metal_material('rooftop_chrome', venue['chrome'])
            mesh.materials.append(chrome)
            for polygon in mesh.polygons[leather_faces:]:
                polygon.material_index = 1
            angle = math.atan2(-x, y)
        else:
            angle = math.atan2(-y, -x)
        object_at(
            '%s_chair_%d' % (venue['id'], index),
            mesh,
            (x, y, 0.0),
            (0.0, 0.0, angle + math.pi),
        )


def character_seat_positions(venue, count=9):
    if venue['id'] == 'suite':
        return seat_positions(count, FELT_RX * 1.30, FELT_RY * 1.44)
    return seat_positions(count, FELT_RX * 1.42, FELT_RY * 1.58)


def apply_seated_lod(obj):
    if obj.type != 'MESH':
        return
    ratio = CHARACTER_BODY_LOD_RATIO if obj.data.name.startswith('base') else CHARACTER_GARMENT_LOD_RATIO
    modifier = obj.modifiers.new('river_seated_lod', 'DECIMATE')
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = False
    modifier_index = obj.modifiers.find(modifier.name)
    if modifier_index > 0:
        obj.modifiers.move(modifier_index, 0)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def atlas_blend(a, b, amount):
    return tuple(a[index] * (1.0 - amount) + b[index] * amount for index in range(3)) + (1.0,)


def atlas_pixel(base, x, y, male, variant, face_details=True):
    skin_warm = (0.72, 0.43, 0.29)
    skin_cool = (0.36, 0.28, 0.27)
    skin = atlas_blend(skin_cool, skin_warm, 0.34 + 0.32 * (variant % 3) / 2.0)
    grain = 0.018 * math.sin((x + variant * 17) * 0.31) * math.sin((y + variant * 11) * 0.19)
    colour = tuple(max(0.0, min(1.0, channel + grain)) for channel in skin[:3]) + (1.0,)
    if face_details and 0.22 < x < 0.78 and 0.16 < y < 0.92:
        brow = ((x < 0.47 and 0.61 < y < 0.68) or (x > 0.53 and 0.61 < y < 0.68))
        lashes = ((x < 0.47 and 0.57 < y < 0.625) or (x > 0.53 and 0.57 < y < 0.625))
        eye = ((x < 0.47 and 0.585 < y < 0.64) or (x > 0.53 and 0.585 < y < 0.64))
        nose = 0.46 < x < 0.54 and 0.47 < y < 0.58
        lips = 0.43 < x < 0.57 and 0.39 < y < 0.45
        hairline = y > 0.875 - 0.018 * math.cos((x - 0.5) * 14.0)
        stubble = male and 0.34 < x < 0.66 and 0.28 < y < 0.46
        if hairline:
            hair = (0.08 + 0.06 * (variant % 4), 0.035, 0.025)
            colour = atlas_blend(colour, hair, 0.92)
        elif brow or lashes:
            colour = atlas_blend(colour, (0.07, 0.025, 0.02), 0.94)
        elif eye:
            colour = atlas_blend(colour, (0.015, 0.02, 0.018), 0.98)
        elif nose:
            colour = atlas_blend(colour, (0.40, 0.20, 0.16), 0.22)
        elif lips:
            lip_tone = (0.52 + 0.05 * (variant % 3), 0.15, 0.16)
            colour = atlas_blend(colour, lip_tone, 0.72)
        elif stubble and math.sin(x * 480.0 + y * 271.0 + variant) > 0.12:
            colour = atlas_blend(colour, (0.16, 0.09, 0.07), 0.36)
    if base is not None:
        colour = atlas_blend(colour, base[:3], 0.13)
    return colour


def build_character_atlas():
    image = bpy.data.images.new('river_character_atlas', width=CHARACTER_ATLAS_SIZE, height=CHARACTER_ATLAS_SIZE, alpha=True)
    base_colours = {
        'skin': (0.60, 0.40, 0.29, 1.0),
        'torso': (0.16, 0.20, 0.23, 1.0),
        'head': (0.08, 0.055, 0.045, 1.0),
        'face': (0.63, 0.42, 0.15, 1.0),
        'hands': (0.60, 0.40, 0.29, 1.0),
        'accent': (0.63, 0.42, 0.15, 1.0),
    }
    cell_width = CHARACTER_ATLAS_SIZE // CHARACTER_ATLAS_COLUMNS
    cell_height = CHARACTER_ATLAS_SIZE // CHARACTER_ATLAS_ROWS
    pixels = []
    for y in range(CHARACTER_ATLAS_SIZE):
        for x in range(CHARACTER_ATLAS_SIZE):
            column = x // cell_width
            row = y // cell_height
            cell_x = (x % cell_width) / cell_width
            cell_y = (y % cell_height) / cell_height
            if row == 0 and column in (0, 4):
                pixels.extend(atlas_pixel(base_colours['skin'], cell_x, cell_y, False, column, False))
            elif row == 0 and column in (1, 2, 3, 5):
                slot = next(name for name, cell in BASE_ATLAS_CELLS.items() if cell == (column, row))
                pixels.extend(base_colours[slot])
            elif row > 0 and column < CHARACTER_ATLAS_COLUMNS:
                palette_index = (row - 1) * CHARACTER_ATLAS_COLUMNS + column
                cosmetic = next((item for item in COSMETIC_ATLAS.values() if item['paletteIndex'] == palette_index), None)
                pixels.extend(atlas_pixel(cosmetic['colour'] if cosmetic else None, cell_x, cell_y, palette_index % 2 == 1, palette_index))
            else:
                pixels.extend((0.025, 0.025, 0.03, 1.0))
    for y in range(8):
        for x in range(8):
            offset = (y * CHARACTER_ATLAS_SIZE + x) * 4
            pixels[offset:offset + 4] = [1.0, 1.0, 1.0, 1.0]
    image.pixels = pixels
    image.filepath_raw = os.path.join(TEX_DIR, 'character_atlas.png')
    image.file_format = 'PNG'
    image.save_render(image.filepath_raw)
    material = bpy.data.materials.new('river_character_atlas_material')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    texture = nodes.new('ShaderNodeTexImage')
    texture.name = 'river_character_atlas'
    texture.image = image
    bsdf = nodes.get('Principled BSDF')
    if bsdf is not None:
        links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.62
    material['atlasSchema'] = '8x4 shared atlas: base regions row 0, catalogue cosmetics rows 1-3'
    material['paletteProperty'] = 'paletteIndex'
    material['atlasColumns'] = CHARACTER_ATLAS_COLUMNS
    material['atlasRows'] = CHARACTER_ATLAS_ROWS
    material['cosmeticRegions'] = json.dumps({
        cosmetic_id: cosmetic_metadata(cosmetic_id) for cosmetic_id in COSMETIC_ATLAS
    }, sort_keys=True, separators=(',', ':'))
    return material


def build_garment_material():
    material = bpy.data.materials.new('river_garment_flat_material')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    colour = nodes.new('ShaderNodeVertexColor')
    colour.name = 'river_garment_palette_colour'
    colour.layer_name = 'Color'
    if bsdf is not None:
        links.new(colour.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.82
    material['paletteProperty'] = 'paletteIndex'
    material['paletteSource'] = 'vertex colour Color'
    return material


def import_character_templates(atlas_material, pose_legs=False):
    templates = {}
    animation_actions = []
    for variant in CHARACTER_VARIANTS:
        path = os.path.join(OUT_DIR, 'char_' + variant + '.glb')
        if not os.path.exists(path):
            raise SystemExit('FAIL: missing character asset ' + path)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        imported_all = [obj for obj in bpy.data.objects if obj not in before]
        imported = [
            obj for obj in bpy.data.objects
            if obj not in before and (
                obj.type == 'ARMATURE'
                or (obj.type == 'MESH' and (obj.data is not None and (
                    obj.data.name.startswith('base') or obj.name.startswith('garment_')
                )))
            )
        ]
        if not imported:
            raise SystemExit('FAIL: character asset imported no renderable objects ' + path)
        for obj in imported_all:
            if obj not in imported:
                bpy.data.objects.remove(obj, do_unlink=True)
        body = next((obj for obj in imported if obj.type == 'MESH'), None)
        if body is not None:
            components, faces, vertices = strip_opaque_hair_planes(body)
            print('CHAR %s stripped hair components=%d faces=%d vertices=%d' % (
                variant, components, faces, vertices
            ))
        for obj in imported:
            apply_seated_lod(obj)
            if obj.type == 'MESH' and (obj.name.startswith('garment_') or obj.data.name.startswith('garment_')):
                evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                mesh = evaluated.to_mesh()
                try:
                    triangles = sum(1 if len(poly.vertices) == 3 else 2 for poly in mesh.polygons)
                    ratio = len(mesh.vertices) / triangles if triangles else 0.0
                    print('GARMENT %s vertices=%d triangles=%d vertices_per_triangle=%.3f' % (
                        variant, len(mesh.vertices), triangles, ratio
                    ))
                finally:
                    evaluated.to_mesh_clear()
        armature = next((obj for obj in imported if obj.type == 'ARMATURE'), None)
        if body is not None and armature is not None:
            apply_seated_rest_pose(armature, pose_legs)
            shape_seated_arms(body)
            smooth_mesh_by_angle(body.data)
        if variant == 'male' and armature is not None:
            for action in list(bpy.data.actions):
                bpy.data.actions.remove(action, do_unlink=True)
            animation_actions = [bpy.data.actions[name] for name in build_animations(armature)]
        templates[variant] = imported
    return templates, animation_actions


def apply_garment_palette(obj, colour):
    if obj.type != 'MESH':
        return
    for layer in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(layer)
    layer = obj.data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    for item in layer.data:
        item.color = colour
    obj.data.color_attributes.active_color_index = 0
    obj.data.color_attributes.render_color_index = 0


def duplicate_character(template, animation_actions, seat_index, variant, x, y, angle, atlas_material, garment_material, loadout, root_name=None, role='player'):
    mapping = {}
    face_cosmetic_id = loadout.get('face') or loadout.get('head')
    body_region = atlas_region_for_cosmetic(face_cosmetic_id) if face_cosmetic_id is not None else atlas_region_for_slot('skin')
    body_palette_index = COSMETIC_ATLAS[face_cosmetic_id]['paletteIndex'] if face_cosmetic_id is not None else 0
    garment_colour = COSMETIC_ATLAS[loadout['torso']]['colour']
    for source in template:
        clone = source.copy()
        garment = source.type == 'MESH' and (source.name.startswith('garment_') or source.data.name.startswith('garment_'))
        if source.data is not None:
            slot = source.get('cosmeticSlot')
            cosmetic_id = loadout.get(slot) if slot is not None else None
            clone.data = source.data.copy() if source.type == 'MESH' else source.data
            if cosmetic_id is not None and not garment:
                remap_character_uv(clone, atlas_region_for_cosmetic(cosmetic_id))
        bpy.context.scene.collection.objects.link(clone)
        mapping[source] = clone
    for source, clone in mapping.items():
        clone.parent = mapping.get(source.parent)
        if clone.type == 'ARMATURE':
            if seat_index == 0:
                animation_data = clone.animation_data_create()
                animation_data.action = None
                for track in list(animation_data.nla_tracks):
                    animation_data.nla_tracks.remove(track)
                for action in animation_actions:
                    track = animation_data.nla_tracks.new()
                    track.name = action.name
                    track.strips.new(action.name, int(action.frame_range[0]), action)
                clone['animationOwner'] = True
            else:
                clone.animation_data_clear()
                clone['animationOwner'] = False
        for modifier in clone.modifiers:
            if modifier.type == 'ARMATURE' and modifier.object in mapping:
                modifier.object = mapping[modifier.object]
        if clone.type == 'MESH':
            is_garment = source.name.startswith('garment_') or source.data.name.startswith('garment_')
            if clone.data.uv_layers and not is_garment:
                clone.data.uv_layers[0].name = 'UVMap'
            if not is_garment:
                remap_character_uv(clone, atlas_region_for_slot('skin'), body_region)
            if is_garment:
                apply_garment_palette(clone, garment_colour)
            if source.get('characterFeature'):
                clone.data.name = 'river_' + variant + '_feature'
            elif source.name.startswith('char_') or source.data.name.startswith('base'):
                clone.data.name = 'char_' + variant + '_body'
            else:
                clone.data.name = 'char_' + variant + '_garment'
            clone.data.materials.clear()
            clone.data.materials.append(garment_material if is_garment else atlas_material)
            slot = source.get('cosmeticSlot')
            cosmetic_id = loadout.get(slot) if slot is not None else None
            clone['paletteIndex'] = body_palette_index
            clone['cosmeticId'] = cosmetic_id or ''
            clone['cosmeticSlot'] = slot or ''
            clone['atlasRegion'] = list(atlas_region_for_cosmetic(cosmetic_id)) if cosmetic_id is not None else list(atlas_region_for_slot('skin'))
            clone['atlasMaterial'] = atlas_material.name if not is_garment else ''
            clone['garmentMaterial'] = garment_material.name if is_garment else ''
    root = bpy.data.objects.new(root_name or 'river_character_%02d' % seat_index, None)
    bpy.context.scene.collection.objects.link(root)
    for source, clone in mapping.items():
        if source.parent is None:
            clone.parent = root
    root.location = (x, y, CHARACTER_SEAT_Z)
    root.rotation_euler = (0.0, 0.0, angle)
    root.scale = (CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE)
    if seat_index is not None:
        root['seatIndex'] = seat_index
    if role != 'player':
        root['role'] = role
    root['variant'] = variant
    root['paletteIndex'] = body_palette_index
    root['paletteIndices'] = json.dumps({
        slot: COSMETIC_ATLAS[cosmetic_id]['paletteIndex']
        for slot, cosmetic_id in loadout.items()
    }, sort_keys=True, separators=(',', ':'))
    root['loadout'] = json.dumps(loadout, sort_keys=True, separators=(',', ':'))
    root['atlasMaterial'] = atlas_material.name
    return root


def build_dealer_uniform(root, garment_material):
    waistcoat = concat([
        box((-0.205, -0.245, 0.74), (0.165, 0.035, 0.50)),
        box((0.040, -0.245, 0.74), (0.165, 0.035, 0.50)),
        box((-0.165, -0.245, 1.18), (0.330, 0.035, 0.06)),
    ])
    bow_tie = concat([
        box((-0.150, -0.275, 1.255), (0.115, 0.025, 0.065)),
        box((0.035, -0.275, 1.255), (0.115, 0.025, 0.065)),
        box((-0.035, -0.285, 1.265), (0.070, 0.030, 0.045)),
    ])
    for name, geometry, colour in (
        ('river_dealer_waistcoat', waistcoat, (0.025, 0.035, 0.050, 1.0)),
        ('river_dealer_bow_tie', bow_tie, (0.48, 0.025, 0.035, 1.0)),
    ):
        mesh = build_mesh_from_geo(name, geometry)
        mesh.materials.append(garment_material)
        uniform = object_at(name, mesh, parent=root)
        apply_garment_palette(uniform, colour)
        uniform['role'] = 'dealer'


def build_rooftop_dealer(templates, animation_actions, atlas_material, garment_material):
    position = character_seat_positions({'id': 'rooftop'})[0]
    dealer = duplicate_character(
        templates['male'],
        animation_actions,
        None,
        'male',
        position[0],
        position[1],
        0.0,
        atlas_material,
        garment_material,
        DEALER_LOADOUT,
        root_name='river_dealer',
        role='dealer',
    )
    build_dealer_uniform(dealer, garment_material)
    return dealer


def build_venue_characters(venue):
    atlas_material = build_character_atlas()
    garment_material = build_garment_material()
    templates, animation_actions = import_character_templates(atlas_material, venue['id'] == 'rooftop')
    positions = character_seat_positions(venue)
    for seat_index, (x, y) in enumerate(positions):
        variant = CHARACTER_VARIANTS[seat_index % len(CHARACTER_VARIANTS)]
        angle = math.atan2(-x, y)
        loadout = COSMETIC_PREVIEW_LOADOUTS[seat_index % len(COSMETIC_PREVIEW_LOADOUTS)]
        seat_offset = 0.12 if venue['id'] == 'rooftop' else 0.0
        duplicate_character(
            templates[variant],
            animation_actions,
            seat_index,
            variant,
            x + math.sin(angle) * seat_offset,
            y - math.cos(angle) * seat_offset,
            angle,
            atlas_material,
            garment_material,
            loadout,
        )
    if venue['id'] == 'rooftop':
        build_rooftop_dealer(templates, animation_actions, atlas_material, garment_material)
    for template in templates.values():
        for obj in template:
            bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        if action.users == 0:
            bpy.data.actions.remove(action)


def _surface_colour(mesh, colour_fn):
    for existing in list(mesh.color_attributes):
        mesh.color_attributes.remove(existing)
    layer = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            layer.data[loop_index].color = colour_fn(vertex)
    mesh.color_attributes.active_color_index = 0
    mesh.color_attributes.render_color_index = 0


def _use_vertex_colour(material):
    if material.get('riverVertexColour'):
        return tuple(material['riverVertexColourBase'])
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None or any(node.type == 'TEX_IMAGE' for node in nodes):
        return None
    base = tuple(bsdf.inputs['Base Color'].default_value[:3])
    colour = nodes.new('ShaderNodeVertexColor')
    colour.layer_name = 'Color'
    base_input = bsdf.inputs['Base Color']
    if base_input.links:
        links.remove(base_input.links[0])
    links.new(colour.outputs['Color'], base_input)
    material['riverVertexColour'] = True
    material['riverVertexColourBase'] = base
    return base


def _detail_factor(point, venue_id, role):
    radius = math.sqrt(point.x * point.x + point.y * point.y)
    noise = math.sin(point.x * 3.71 + point.y * 5.13) * 0.035
    noise += math.sin(point.x * 10.19 - point.y * 7.37) * 0.018
    if venue_id == 'rooftop' and role == 'floor':
        edge = min(1.0, radius / 4.0)
        return 0.95 - edge * 0.28 + noise
    if venue_id == 'rooftop' and role == 'parapet':
        return 0.76 + noise * 1.4 - max(0.0, point.z - 0.75) * 0.05
    if role == 'floor':
        return 0.88 - min(1.0, radius / 7.0) * 0.16 + noise
    if role == 'wall':
        return 0.83 + noise * 1.2 - min(0.13, max(0.0, point.z) * 0.035)
    return 0.90 + noise


def _surface_bvh():
    vertices = []
    polygons = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.data.name.startswith('char_') or obj.name.startswith('char_'):
            continue
        if obj.name in {'river_card', 'board_card_pool'} or obj.name.startswith('chip_'):
            continue
        offset = len(vertices)
        matrix = obj.matrix_world
        vertices.extend(matrix @ vertex.co for vertex in obj.data.vertices)
        polygons.extend(tuple(offset + index for index in polygon.vertices) for polygon in obj.data.polygons)
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def _ambient_factor(bvh, obj, point, normal):
    matrix = obj.matrix_world
    world_point = matrix @ point
    world_normal = (matrix.to_3x3() @ normal).normalized()
    tangent = world_normal.cross(Vector((0.0, 0.0, 1.0)))
    if tangent.length < 0.001:
        tangent = world_normal.cross(Vector((0.0, 1.0, 0.0)))
    tangent.normalize()
    bitangent = world_normal.cross(tangent).normalized()
    directions = [
        world_normal,
        (world_normal + tangent * 0.55).normalized(),
        (world_normal - tangent * 0.55).normalized(),
        (world_normal + bitangent * 0.55).normalized(),
        (world_normal - bitangent * 0.55).normalized(),
    ]
    hits = 0
    origin = world_point + world_normal * 0.025
    for direction in directions:
        _location, _normal, _index, distance = bvh.ray_cast(origin, direction, 1.35)
        if distance is not None:
            hits += 1
    return 1.0 - hits / len(directions) * 0.28


def add_venue_surface_detail(venue_id):
    roles = {
        'rooftop': {
            'floor': ['rooftop_terrace'],
            'parapet': ['rooftop_parapet', 'rooftop_brazier_0', 'rooftop_brazier_1'],
            'wall': ['rooftop_planter_0', 'rooftop_planter_1', 'rooftop_planter_2', 'rooftop_planter_3', 'rooftop_planter_4', 'rooftop_planter_5', 'rooftop_palms'],
        },
        'basement': {
            'floor': ['basement_floor'],
            'wall': ['basement_room_walls', 'basement_ceiling', 'basement_ceiling_pipes', 'basement_machine_bank', 'basement_counter', 'basement_carts', 'basement_crates', 'basement_ladder'],
        },
        'suite': {
            'floor': ['suite_floor'],
            'wall': ['suite_room_walls', 'suite_ceiling', 'suite_bar', 'suite_balusters', 'suite_handrail', 'suite_scroll_ornaments', 'suite_standing_patrons'],
        },
    }[venue_id]
    targets = []
    for role, names in roles.items():
        for name in names:
            obj = bpy.data.objects.get(name)
            if obj is not None:
                targets.append((obj, role))
    bvh = _surface_bvh()
    for obj, role in targets:
        if _use_vertex_colour(obj.data.materials[0]) is None:
            continue
        def colour(vertex, obj=obj, role=role):
            factor = _detail_factor(vertex.co, venue_id, role) * _ambient_factor(bvh, obj, vertex.co, vertex.normal)
            return (factor, factor, factor, 1.0)
        _surface_colour(obj.data, colour)


def build_rooftop(venue):
    floor_mat = add_material('rooftop_floor', venue['floor'])
    floor = build_mesh_from_geo('rooftop_terrace', terrace_disc())
    floor.materials.append(floor_mat)
    object_at('rooftop_terrace', floor, (0.0, 0.0, -0.02))
    parapet_mat = add_material('rooftop_parapet', venue['parapet'])
    parapet = build_mesh_from_geo('rooftop_parapet', parapet_ring())
    parapet.materials.append(parapet_mat)
    object_at('rooftop_parapet', parapet, (0.0, 0.0, 0.0))
    # A strip of light along the top of the parapet, which is what an edge is.
    #
    # This was the whole parapet ring built a second time, at full height, made
    # emissive and raised 1.1m - so the terrace was walled in by an 8.2m glowing
    # box standing from 1.1m to 2.22m, directly at eye level for a camera at
    # 1.5m. It filled the top sixth of every frame with a flat tan band and hid
    # the skyline, which sits 26m further out and is 85m wide. The room read as
    # a beige studio cyclorama because it was standing inside one.
    PARAPET_TOP = 1.12
    LIT_EDGE_HEIGHT = 0.05
    lit_mat = add_emissive_material('rooftop_lit_edge', venue['parapet_lit'], 0.35)
    lit = build_mesh_from_geo('rooftop_lit_edge', parapet_ring())
    lit.materials.append(lit_mat)
    lit_object = object_at('rooftop_lit_edge', lit, (0.0, 0.0, PARAPET_TOP - LIT_EDGE_HEIGHT))
    lit_object.scale = (1.001, 1.001, LIT_EDGE_HEIGHT / PARAPET_TOP)
    planter_mat = add_material('rooftop_planter', venue['planter'])
    for index in range(6):
        angle = 2.0 * math.pi * index / 6
        x = 3.2 * math.cos(angle)
        y = 3.2 * math.sin(angle)
        planter_mesh = build_mesh_from_geo('rooftop_planter_%d' % index, planter())
        planter_mesh.materials.append(planter_mat)
        object_at('rooftop_planter_%d' % index, planter_mesh, (x, y, 0.0), (0.0, 0.0, -angle))
    # Strength 3 clipped these to pure white and six segments made them
    # hexagons, so the first honest venue render showed two floating white
    # blobs at head height that read as characters with no faces.
    fire_mat = add_emissive_material('rooftop_fire', venue['fire'], 0.55)
    bowl_geo, flame_geo = fire_bowl()
    for index in range(2):
        angle = -0.55 + index * 1.1
        x = 3.15 * math.cos(angle)
        y = 3.15 * math.sin(angle)
        bowl_mesh = build_mesh_from_geo('rooftop_brazier_%d' % index, bowl_geo)
        bowl_mesh.materials.append(parapet_mat)
        object_at('rooftop_brazier_%d' % index, bowl_mesh, (x, y, 0.0))
        flame_mesh = build_mesh_from_geo('rooftop_fire_%d' % index, flame_geo)
        flame_mesh.materials.append(fire_mat)
        object_at('rooftop_fire_%d' % index, flame_mesh, (x, y, 0.0))
    strand = build_mesh_from_geo('rooftop_string_lights', string_light_run())
    strand.materials.append(lit_mat)
    object_at('rooftop_string_lights', strand, (0.0, 0.0, 0.0))
    # The skyline is the venue's identity - a rooftop without a city is a patio.
    # Built as merged meshes: 27 towers and their windows cost two draw calls
    # rather than fifty-four, which matters against a budget of 120.
    mountain_mat = add_material('rooftop_mountain', venue['mountain'])
    mountains = build_mesh_from_geo('rooftop_mountains', mountain_range())
    mountains.materials.append(mountain_mat)
    object_at('rooftop_mountains', mountains, (0.0, 0.0, 0.0))

    skyline_mat = add_material('rooftop_skyline', venue['skyline'])
    tower_geo, window_geo = skyline_towers()
    towers = build_mesh_from_geo('rooftop_skyline', tower_geo)
    towers.materials.append(skyline_mat)
    object_at('rooftop_skyline', towers, (0.0, 0.0, 0.0))

    # Windows reuse the parapet emissive rather than adding a material.
    windows = build_mesh_from_geo('rooftop_skyline_windows', window_geo)
    windows.materials.append(lit_mat)
    object_at('rooftop_skyline_windows', windows, (0.0, 0.0, 0.0))

    foliage_mat = add_material('rooftop_foliage', venue['foliage'])
    palms = []
    for index in range(6):
        angle = 2.0 * math.pi * index / 6
        palms.append(
            translate_geo(
                palm(1.45 + 0.15 * (index % 3), fronds=10, seed=41 + index * 7),
                3.2 * math.cos(angle),
                3.2 * math.sin(angle),
                0.0,
            )
        )
    palm_mesh = build_mesh_from_geo('rooftop_palms', concat(palms))
    palm_mesh.materials.append(foliage_mat)
    object_at('rooftop_palms', palm_mesh, (0.0, 0.0, 0.0))

    water_mat = add_material('rooftop_water', venue['water'])
    water = build_mesh_from_geo('rooftop_pool', terrace_disc(1.4, 24))
    water.materials.append(water_mat)
    object_at('rooftop_pool', water, (0.0, 3.4, -0.03))


def build_basement(venue):
    checker_mat, _image, _path = make_checker_material(
        'basement_checker', 128, venue['checker_a'], venue['checker_b'], TEX_DIR
    )
    plane = build_mesh_from_geo('basement_floor', checkerboard_plane(12.0, 9.6))
    plane.materials.append(checker_mat)
    object_at('basement_floor', plane, (0.0, 0.0, -0.02))
    wall_mat = add_material('basement_wall', venue['wall'])
    walls = build_mesh_from_geo('basement_room_walls', room_walls(12.0, 9.6, 3.1))
    walls.materials.append(wall_mat)
    object_at('basement_room_walls', walls, (0.0, 0.2, 0.0))
    ceiling_surface = build_mesh_from_geo('basement_ceiling', checkerboard_plane(12.0, 9.6))
    ceiling_surface.materials.append(wall_mat)
    object_at('basement_ceiling', ceiling_surface, (0.0, 0.2, 3.35))
    ceiling = build_mesh_from_geo('basement_ceiling_pipes', ceiling_pipes())
    ceiling.materials.append(wall_mat)
    object_at('basement_ceiling_pipes', ceiling, (0.0, 0.0, 0.0))
    machine_mat = add_material('basement_machine', venue['machine'])
    machines = []
    for row in range(2):
        z = 0.42 + row * 0.94
        for index in range(7):
            x = -5.55 + index * 1.70
            machines.append(transform_geo(machine_unit(), x, 4.05, z))
            y = -3.95 + index * 1.18
            machines.append(transform_geo(machine_unit(), -5.72, y, z, math.pi / 2.0))
    machine_mesh = build_mesh_from_geo('basement_machine_bank', concat(machines))
    machine_mesh.materials.append(machine_mat)
    object_at('basement_machine_bank', machine_mesh, (0.0, 0.0, 0.0))
    counter_mat = add_material('basement_counter', venue['wood'])
    counter = build_mesh_from_geo('basement_counter', basement_counter())
    counter.materials.append(counter_mat)
    object_at('basement_counter', counter, (0.0, 0.0, 0.0))
    carts = build_mesh_from_geo(
        'basement_carts',
        concat([transform_geo(laundry_cart(), 2.9, -3.1, 0.0), transform_geo(laundry_cart(), 2.9, 2.35, 0.0)]),
    )
    carts.materials.append(machine_mat)
    object_at('basement_carts', carts, (0.0, 0.0, 0.0))
    crate_mat = add_material('basement_crate', venue['crate'])
    crates = build_mesh_from_geo(
        'basement_crates',
        concat([transform_geo(crate_stack(), 3.5, 2.7, 0.0), transform_geo(crate_stack(), 4.1, 2.7, 0.0, 0.2)]),
    )
    crates.materials.append(crate_mat)
    object_at('basement_crates', crates, (0.0, 0.0, 0.0))
    ladder_mat = add_material('basement_ladder', venue['ladder'])
    ladder = build_mesh_from_geo('basement_ladder', stepladder())
    ladder.materials.append(ladder_mat)
    object_at('basement_ladder', ladder, (2.3, -3.8, 0.0))


def build_suite(venue):
    bal_mat = add_material('suite_balustrade', venue['balustrade'])
    wall_mat = add_material('suite_wall', venue['wall'])
    floor = build_mesh_from_geo('suite_floor', terrace_disc(8.2, 64))
    floor.materials.append(wall_mat)
    object_at('suite_floor', floor, (0.0, 0.0, -0.02))
    walls = build_mesh_from_geo('suite_room_walls', room_walls(16.4, 16.4, 4.4))
    walls.materials.append(wall_mat)
    object_at('suite_room_walls', walls, (0.0, 0.0, 0.0))
    ceiling = build_mesh_from_geo('suite_ceiling', checkerboard_plane(16.4, 16.4))
    ceiling.materials.append(wall_mat)
    object_at('suite_ceiling', ceiling, (0.0, 0.0, 4.4))
    balusters = []
    scrolls = []
    for index in range(56):
        angle = 2.0 * math.pi * index / 56.0
        x = 5.4 * math.cos(angle)
        y = 5.4 * math.sin(angle)
        balusters.append(transform_geo(suite_baluster(), x, y, 0.0))
        scrolls.append(transform_geo(suite_scroll(), x, y, 0.0, angle))
    baluster_mesh = build_mesh_from_geo('suite_balusters', concat(balusters))
    baluster_mesh.materials.append(bal_mat)
    object_at('suite_balusters', baluster_mesh, (0.0, 0.0, 0.0))
    scroll_mesh = build_mesh_from_geo('suite_scroll_ornaments', concat(scrolls))
    scroll_mesh.materials.append(bal_mat)
    object_at('suite_scroll_ornaments', scroll_mesh, (0.0, 0.0, 0.0))
    handrail = build_mesh_from_geo('suite_handrail', suite_handrail())
    handrail.materials.append(bal_mat)
    object_at('suite_handrail', handrail, (0.0, 0.0, 0.0))
    bar_mat = add_material('suite_bar', venue['bar_wood'])
    bar = build_mesh_from_geo('suite_bar', bar_back())
    bar.materials.append(bar_mat)
    object_at('suite_bar', bar, (6.6, -1.0, 0.0), (0.0, 0.0, math.pi / 2))
    bar_light = add_emissive_material('suite_bar_lit', venue['bar_lit'], 2.0)
    shelf = build_mesh_from_geo('suite_bar_lit', bar_back())
    shelf.materials.append(bar_light)
    object_at('suite_bar_lit', shelf, (6.6, -1.0, 1.2), (0.0, 0.0, math.pi / 2))
    bottles = build_mesh_from_geo('suite_bar_bottles', bar_bottle())
    bottles.materials.append(bar_light)
    object_at('suite_bar_bottles', bottles, (0.0, 0.0, 0.0))
    sconce_mat = add_emissive_material('suite_sconce', venue['sconce'], 1.2)
    sconces = build_mesh_from_geo('suite_wall_sconces', suite_sconces())
    sconces.materials.append(sconce_mat)
    object_at('suite_wall_sconces', sconces, (0.0, 0.0, 0.0))
    chandelier_mat = add_material('suite_chandelier', venue['chandelier'])
    chandelier_lit = add_emissive_material('suite_chandelier_lit', venue['sconce'], 1.5)
    rods = build_mesh_from_geo('suite_chandelier_rods', chandelier_rods())
    rods.materials.append(chandelier_mat)
    object_at('suite_chandelier_rods', rods, (6.0, 0.0, 0.0))
    chandy = build_mesh_from_geo('suite_chandelier', chandelier())
    chandy.materials.append(chandelier_mat)
    object_at('suite_chandelier', chandy, (6.0, 0.0, 2.4))
    chandy_lit = build_mesh_from_geo('suite_chandelier_lit', chandelier())
    chandy_lit.materials.append(chandelier_lit)
    object_at('suite_chandelier_lit', chandy_lit, (6.0, 0.0, 2.4))
    patrons = []
    for degrees in (40, 95, 150, 215, 300):
        angle = math.radians(degrees)
        patrons.append(transform_geo(standing_patron(), 6.9 * math.cos(angle), 6.9 * math.sin(angle), 0.0, angle + math.pi))
    patron_mesh = build_mesh_from_geo('suite_standing_patrons', concat(patrons))
    patron_mesh.materials.append(wall_mat)
    object_at('suite_standing_patrons', patron_mesh, (0.0, 0.0, 0.0))


def hex_to_linear(hex_rgb):
    # Kept as a name because the lighting code reads better for it, but the
    # conversion lives in one place now. There were two of these - this one,
    # correct, used for lights and the world; and buildkit's hex_to_rgb, which
    # skipped the transfer curve entirely and was used for every material in
    # every venue. Two functions for one job is how one of them stays wrong.
    return hex_to_rgb(hex_rgb)


def build_lighting(venue_id):
    """Add the measured light rig and world for a venue.

    The pipeline previously exported geometry and emissive materials only, with
    no lights at all, so every venue rendered flat. These values are measured
    from the lookdev builds - see docs/design/14-venue-build-spec.md.
    """
    import math

    spec = VENUE_LIGHTS.get(venue_id)
    if spec is None:
        return []

    world_hex, world_strength = spec['world']
    world = bpy.data.worlds.new('world_' + venue_id)
    world.use_nodes = True
    background = world.node_tree.nodes.get('Background')
    if background is not None:
        background.inputs[0].default_value = hex_to_linear(world_hex) + (1.0,)
        background.inputs[1].default_value = world_strength

    stops = spec.get('world_gradient')
    if stops and background is not None:
        # TexCoord > SeparateXYZ > ColorRamp > Background. The Rooftop sky is a
        # vertical gradient; a flat colour reads as a grey lid over the skyline.
        tree = world.node_tree
        coord = tree.nodes.new('ShaderNodeTexCoord')
        separate = tree.nodes.new('ShaderNodeSeparateXYZ')
        ramp = tree.nodes.new('ShaderNodeValToRGB')
        tree.links.new(coord.outputs['Generated'], separate.inputs[0])
        tree.links.new(separate.outputs['Z'], ramp.inputs['Fac'])
        tree.links.new(ramp.outputs['Color'], background.inputs[0])
        elements = ramp.color_ramp.elements
        while len(elements) > 1:
            elements.remove(elements[-1])
        for index, (position, colour) in enumerate(stops):
            element = elements[0] if index == 0 else elements.new(position)
            element.position = position
            element.color = hex_to_linear(colour) + (1.0,)

    bpy.context.scene.world = world

    created = []
    for name, kind, colour, energy, size, shadow, loc, rot in spec['lights']:
        data = bpy.data.lights.new('lgt_%s_%s' % (venue_id, name), type=kind)
        data.color = hex_to_linear(colour)
        data.energy = energy
        if hasattr(data, 'size'):
            data.size = size
        data.use_shadow = shadow
        obj = bpy.data.objects.new('lgt_%s_%s' % (venue_id, name), data)
        obj.location = loc
        obj.rotation_euler = tuple(math.radians(a) for a in rot)
        bpy.context.scene.collection.objects.link(obj)
        created.append(obj.name)
    return created


def clear_radius_violations(venue_id):
    """Flag geometry that would ruin the orbit camera.

    Two distinct hazards, both drawn from things that actually went wrong:

    1. Orbit intrusion - geometry sitting on the camera's circular path and tall
       enough to reach it. A Rooftop palm at 6.0m against a 6.1m orbit put the
       camera inside the foliage, and the fronds read convincingly as shadow
       artifacts across three diagnostic passes.
    2. Occlusion - geometry inside the orbit that rises above the sight line
       from the camera down to the table, putting a wall between the player and
       the felt.

    Measured per vertex, not from the bounding box. An axis-aligned box around a
    ring has its corners at R*sqrt(2), so bound_box reports a 4.1m parapet as
    5.8m and a 45m skyline as 64m. The parapet is exactly the case a blunt
    height rule condemns wrongly - it is 2.2m tall but the camera looks well
    over it.
    """
    import math

    from mathutils import Vector

    camera = VENUE_CAMERA.get(venue_id)
    if camera is None:
        return []

    # bound_box and matrix_world are stale until the dependency graph catches
    # up. Without this the gate reads zeros and silently passes everything.
    bpy.context.view_layer.update()

    orbit = camera['radius']
    height = camera['height']
    table_top = 0.76
    # The camera is a point plus near-plane clearance, not a two-metre band.
    # A room wall outside the orbit is correct architecture, not an intrusion.
    tube_inner = orbit - 0.4
    tube_outer = orbit + 0.4
    tube_floor = height - 1.5

    offenders = []
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or obj.data is None:
            continue
        matrix = obj.matrix_world
        worst_tube = None
        worst_occlude = None
        for vertex in obj.data.vertices:
            point = matrix @ Vector(vertex.co)
            radius = math.hypot(point.x, point.y)
            if radius < 0.35:
                continue
            if tube_inner <= radius <= tube_outer and point.z >= tube_floor:
                if worst_tube is None or point.z > worst_tube[1]:
                    worst_tube = (radius, point.z)
            elif radius < tube_inner:
                sight = table_top + (height - table_top) * (radius / orbit)
                if point.z > sight and (worst_occlude is None or point.z - sight > worst_occlude[2]):
                    worst_occlude = (radius, point.z, point.z - sight)

        if worst_tube is not None:
            offenders.append(
                '%s crosses the camera orbit at r=%.2f z=%.2f (orbit %.2f, camera height %.2f)'
                % (obj.name, worst_tube[0], worst_tube[1], orbit, height)
            )
        if worst_occlude is not None:
            offenders.append(
                '%s blocks the table view at r=%.2f z=%.2f, %.2fm above the sight line'
                % (obj.name, worst_occlude[0], worst_occlude[1], worst_occlude[2])
            )
    return offenders


def lighting_sidecar():
    """Emit the light rigs as JSON beside the GLBs.

    glTF carries only KHR_lights_punctual - point, spot and directional - so the
    exporter drops every area light with 'Unsupported light source AREA'. three.js
    has RectAreaLight, which is what these actually are, so the rig travels as a
    sidecar rather than being degraded to point lights on the way out.
    """
    out = {}
    for venue_id, spec in VENUE_LIGHTS.items():
        world_hex, world_strength = spec['world']
        entry = {
            'world': {'colour': '#' + world_hex, 'strength': world_strength},
            'camera': VENUE_CAMERA[venue_id],
            'lights': [
                {
                    'name': name,
                    'type': kind.lower(),
                    'colour': '#' + colour,
                    'energy': energy,
                    'size': size,
                    'shadow': shadow,
                    'position': list(loc),
                    'rotation_deg': list(rot),
                }
                for name, kind, colour, energy, size, shadow, loc, rot in spec['lights']
            ],
        }
        gradient = spec.get('world_gradient')
        if gradient:
            entry['world']['gradient'] = [
                {'position': position, 'colour': '#' + colour} for position, colour in gradient
            ]
        out[venue_id] = entry
    path = os.path.join(OUT_DIR, 'lighting.json')
    # newline='' keeps LF on Windows. Biome lints this file once it is published
    # into the web app, and CRLF fails the shared lint gate.
    with open(path, 'w', newline='') as handle:
        json.dump(out, handle, indent=2)
        handle.write(chr(10))
    return path


def _append_accessor(gltf, binary, values, accessor_type):
    component_count = {'VEC3': 3, 'VEC4': 4}[accessor_type]
    payload = struct.pack('<%sf' % (len(values) * component_count), *[
        component for value in values for component in value
    ])
    padding = (-len(binary)) % 4
    binary += b'\0' * padding
    offset = len(binary)
    binary += payload
    view_index = len(gltf.setdefault('bufferViews', []))
    gltf['bufferViews'].append({
        'buffer': 0,
        'byteOffset': offset,
        'byteLength': len(payload),
        'target': 34962,
    })
    accessor_index = len(gltf.setdefault('accessors', []))
    gltf['accessors'].append({
        'bufferView': view_index,
        'componentType': 5126,
        'count': len(values),
        'type': accessor_type,
    })
    return accessor_index, binary


def append_gpu_instances(glb, pools):
    with open(glb, 'rb') as handle:
        raw = handle.read()
    _version, _length = struct.unpack_from('<II', raw, 4)
    offset = 12
    json_chunk = None
    binary = b''
    while offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from('<II', raw, offset)
        offset += 8
        chunk = raw[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            json_chunk = chunk
        elif chunk_type == 0x004E4942:
            binary += chunk
    if json_chunk is None:
        raise SystemExit('FAIL: exported GLB has no JSON chunk')
    gltf = json.loads(json_chunk.decode('utf-8'))
    for pool in pools:
        node = next((candidate for candidate in gltf.get('nodes', []) if candidate.get('name') == pool['node']), None)
        if node is None:
            raise SystemExit('FAIL: pooled node missing from export: ' + pool['node'])
        translations = [instance['translation'] for instance in pool['instances']]
        rotations = [instance['rotation'] for instance in pool['instances']]
        scales = [instance['scale'] for instance in pool['instances']]
        translation_accessor, binary = _append_accessor(gltf, binary, translations, 'VEC3')
        rotation_accessor, binary = _append_accessor(gltf, binary, rotations, 'VEC4')
        scale_accessor, binary = _append_accessor(gltf, binary, scales, 'VEC3')
        node.setdefault('extensions', {})['EXT_mesh_gpu_instancing'] = {
            'attributes': {
                'TRANSLATION': translation_accessor,
                'ROTATION': rotation_accessor,
                'SCALE': scale_accessor,
            }
        }
        node['extras'] = {
            'riverInstanceIds': [instance['id'] for instance in pool['instances']],
            'riverInstanceCount': len(pool['instances']),
            'riverInstanceOrder': 'stable per node; update the matching instance matrix for animation',
        }
    gltf['extensionsUsed'] = sorted(set(gltf.get('extensionsUsed', [])) | {'EXT_mesh_gpu_instancing'})
    gltf.setdefault('buffers', [{}])[0]['byteLength'] = len(binary)
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    binary += b'\0' * ((-len(binary)) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray()
    output.extend(struct.pack('<4sII', b'glTF', 2, total_length))
    output.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    output.extend(json_bytes)
    output.extend(struct.pack('<II', len(binary), 0x004E4942))
    output.extend(binary)
    with open(glb, 'wb') as handle:
        handle.write(output)


def dedupe_materials(glb):
    with open(glb, 'rb') as handle:
        raw = handle.read()
    offset = 12
    json_chunk = None
    binary = b''
    while offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from('<II', raw, offset)
        offset += 8
        chunk = raw[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            json_chunk = chunk
        elif chunk_type == 0x004E4942:
            binary += chunk
    if json_chunk is None:
        raise SystemExit('FAIL: exported GLB has no JSON chunk')
    gltf = json.loads(json_chunk.decode('utf-8'))

    def normalise(value):
        if isinstance(value, dict):
            return {
                key: normalise(item)
                for key, item in value.items()
                if not (key == 'texCoord' and item == -1)
            }
        if isinstance(value, list):
            return [normalise(item) for item in value]
        return value

    materials = gltf.get('materials', [])
    canonical = []
    mapping = {}
    seen = {}
    for index, material in enumerate(materials):
        key = json.dumps(normalise(material), sort_keys=True, separators=(',', ':'))
        target = seen.get(key)
        if target is None:
            target = len(canonical)
            seen[key] = target
            canonical.append(material)
        mapping[index] = target
    if len(canonical) == len(materials):
        return
    gltf['materials'] = canonical
    for mesh in gltf.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            if 'material' in primitive:
                primitive['material'] = mapping[primitive['material']]
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack('<4sII', b'glTF', 2, total_length))
    output.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    output.extend(json_bytes)
    output.extend(struct.pack('<II', len(binary), 0x004E4942))
    output.extend(binary)
    with open(glb, 'wb') as handle:
        handle.write(output)


def restore_vertex_colour_base_factors(glb):
    with open(glb, 'rb') as handle:
        raw = handle.read()
    offset = 12
    json_chunk = None
    binary = b''
    while offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from('<II', raw, offset)
        offset += 8
        chunk = raw[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            json_chunk = chunk
        elif chunk_type == 0x004E4942:
            binary += chunk
    if json_chunk is None:
        raise SystemExit('FAIL: exported GLB has no JSON chunk')
    gltf = json.loads(json_chunk.decode('utf-8'))
    for material in gltf.get('materials', []):
        base = material.get('extras', {}).get('riverVertexColourBase')
        if not isinstance(base, list) or len(base) != 3:
            continue
        material.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = [
            float(base[0]), float(base[1]), float(base[2]), 1.0,
        ]
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack('<4sII', b'glTF', 2, total_length))
    output.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    output.extend(json_bytes)
    output.extend(struct.pack('<II', len(binary), 0x004E4942))
    output.extend(binary)
    with open(glb, 'wb') as handle:
        handle.write(output)


def build_venue(venue, chip_meshes, card_mesh):
    shared_meshes = list(chip_meshes.values()) + [card_mesh]
    keep_names = {mesh.name for mesh in shared_meshes}
    clear_scene(keep_names)
    chair_fn = VENUE_CHAIR[venue['id']]
    rail_mat = colorramp_material(venue['id'] + '_rail', [(0.0, venue['rail']), (1.0, venue['rail'])])[0]
    wood_mat = colorramp_material(venue['id'] + '_wood', [(0.0, venue['wood']), (1.0, venue['wood'])])[0]
    chair_mat = colorramp_material(venue['id'] + '_chair', [(0.0, venue['chair']), (1.0, venue['chair'])])[0]
    build_table(venue, rail_mat, wood_mat)
    build_chairs(venue, chair_fn, chair_mat)
    build_venue_characters(venue)
    chip_instances = {}
    for index in range(4):
        denom = list(CHIP_DENOMS)[index % len(CHIP_DENOMS)][0]
        chip_instances.setdefault(denom, [])
        for stack in range(2):
            z = 0.77 + stack * CHIP_THICK
            x = 0.3 + index * 0.1 - 0.18
            y = 0.4
            chip_instances[denom].append({
                'id': 'chip_%d_%d' % (index, stack),
                'translation': [x, y, z],
                'rotation': [0.0, 0.0, 0.0, 1.0],
                'scale': [1.0, 1.0, 1.0],
            })
    pools = []
    for denom, instances in chip_instances.items():
        node_name = 'chip_pool_' + denom
        object_at(node_name, chip_meshes[denom])
        pools.append({'node': node_name, 'instances': instances})
    card_instances = add_board_cards(card_mesh)
    object_at('board_card_pool', card_mesh)
    pools.append({'node': 'board_card_pool', 'instances': card_instances})
    if venue['id'] == 'rooftop':
        build_rooftop(venue)
    elif venue['id'] == 'basement':
        build_basement(venue)
    else:
        build_suite(venue)
    add_venue_surface_detail(venue['id'])
    lights = build_lighting(venue['id'])
    intrusions = clear_radius_violations(venue['id'])
    glb = os.path.join(OUT_DIR, venue['id'] + '_assets.glb')
    bpy.ops.export_scene.gltf(
        filepath=glb,
        check_existing=False,
        export_format='GLB',
        export_copyright='',
        export_apply=False,
        export_yup=True,
        export_materials='EXPORT',
        export_lights=False,
        export_extras=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
    )
    append_gpu_instances(glb, pools)
    dedupe_materials(glb)
    restore_vertex_colour_base_factors(glb)
    report = checker.Report()
    # File size is a budget too. Triangles, materials and draw calls were all
    # gated while the download grew from 185KB to 12MB unnoticed, because
    # nothing measured the thing a player actually waits for.
    glb_kb = os.path.getsize(glb) / 1024.0
    report.glb_kb = glb_kb
    gltf, binary = checker.read_glb(glb)
    checker.compute_counts(gltf, binary, report)
    failures = []
    checker_check_fail(venue['id'], report, failures, gltf)
    if not lights:
        failures.append('no light rig built for ' + venue['id'])
    for intrusion in intrusions:
        failures.append('orbit clear radius: ' + intrusion)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action, do_unlink=True)
    return glb, report, failures


def checker_check_fail(venue_id, report, failures, gltf):
    punctual = gltf.get('extensions', {}).get('KHR_lights_punctual', {}).get('lights', [])
    if punctual or 'KHR_lights_punctual' in gltf.get('extensionsUsed', []):
        names = ', '.join(light.get('name', 'unnamed') for light in punctual)
        failures.append('punctual light export prohibited: ' + (names or 'KHR_lights_punctual'))
    if report.glb_kb > DOWNLOAD_BUDGET_KB:
        failures.append('download budget exceeded: %.0fKB > %dKB' % (report.glb_kb, DOWNLOAD_BUDGET_KB))
    if report.total_triangles > 250000:
        failures.append('scene triangle budget exceeded: %d' % report.total_triangles)
    # Read the budget rather than restating it. This was a hardcoded 24 while
    # values.py held the real number, so raising the budget in the one place it
    # is documented left the build still failing on a copy of it - two numbers
    # for one rule, which is the same fault as two colour conversions.
    if report.materials > BUDGET['max_materials']:
        failures.append('material budget exceeded: %d' % report.materials)
    if report.draw_calls > 120:
        failures.append('draw-call budget exceeded: %d' % report.draw_calls)
    if report.max_texture_dim > 2048:
        failures.append('texture dimension exceeded: %d' % report.max_texture_dim)
    if report.texture_bytes > 128 * 1024 * 1024:
        failures.append('texture memory exceeded: %d' % report.texture_bytes)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TEX_DIR, exist_ok=True)
    clear_scene()
    chip_meshes = build_chip_meshes()
    card_mesh = build_cards()
    manifest = {}
    overall_failures = []
    for venue in VENUES:
        glb, report, failures = build_venue(venue, chip_meshes, card_mesh)
        manifest[venue['id']] = report.to_dict(glb)
        if failures:
            overall_failures.append(venue['id'] + ': ' + '; '.join(failures))
        print('VENUE %s triangles=%d materials=%d draw_calls=%d download=%.0fKB' % (
            venue['id'],
            report.total_triangles,
            report.materials,
            report.draw_calls,
            getattr(report, 'glb_kb', 0.0),
        ))
    manifest['lighting'] = lighting_sidecar()
    manifest['verdict'] = 'PASS' if not overall_failures else 'FAIL'
    manifest['failures'] = overall_failures
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as handle:
        json.dump(manifest, handle, indent=2)
    if overall_failures:
        for failure in overall_failures:
            print('FAIL ' + failure)
        raise SystemExit(1)
    print('OUT ' + os.path.join(OUT_DIR, 'manifest.json'))


main()

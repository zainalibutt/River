import json
import math
import os
import struct
import sys

os.environ.setdefault('RIVER_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import check_assets as checker
from buildkit import (
    add_emissive_material,
    add_material,
    build_mesh_from_geo,
    clear_scene,
    colorramp_material,
    make_checker_material,
    object_at,
    retint,
    seat_positions,
)
from geo import (
    concat,
    mountain_range,
    palm,
    skyline_towers,
    translate_geo,
    transform_geo,
    balustrade,
    bar_back,
    card_body,
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
    sphere,
    stepladder,
    string_light_run,
    terrace_disc,
    wall_panel,
    wall_sconce,
    wood_pedestal,
)
from values import (
    VENUE_CAMERA,
    VENUE_LIGHTS,
    CHIP_DENOMS,
    CHIP_THICK,
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
        mesh = build_mesh_from_geo('%s_chair_%d' % (venue['id'], index), chair_geo)
        mesh.materials.append(chair_mat)
        angle = math.atan2(-y, -x)
        object_at(
            '%s_chair_%d' % (venue['id'], index),
            mesh,
            (x, y, 0.0),
            (0.0, 0.0, angle + math.pi),
        )


def build_rooftop(venue):
    floor_mat = add_material('rooftop_floor', venue['floor'])
    floor = build_mesh_from_geo('rooftop_terrace', terrace_disc())
    floor.materials.append(floor_mat)
    object_at('rooftop_terrace', floor, (0.0, 0.0, -0.02))
    parapet_mat = add_material('rooftop_parapet', venue['parapet'])
    parapet = build_mesh_from_geo('rooftop_parapet', parapet_ring())
    parapet.materials.append(parapet_mat)
    object_at('rooftop_parapet', parapet, (0.0, 0.0, 0.0))
    lit_mat = add_emissive_material('rooftop_lit_edge', venue['parapet_lit'], 0.8)
    lit = build_mesh_from_geo('rooftop_lit_edge', parapet_ring())
    lit.materials.append(lit_mat)
    object_at('rooftop_lit_edge', lit, (0.0, 0.0, 1.1))
    planter_mat = add_material('rooftop_planter', venue['planter'])
    for index in range(6):
        angle = 2.0 * math.pi * index / 6
        x = 3.2 * math.cos(angle)
        y = 3.2 * math.sin(angle)
        planter_mesh = build_mesh_from_geo('rooftop_planter_%d' % index, planter())
        planter_mesh.materials.append(planter_mat)
        object_at('rooftop_planter_%d' % index, planter_mesh, (x, y, 0.0), (0.0, 0.0, -angle))
    fire_mat = add_emissive_material('rooftop_fire', venue['fire'], 3.0)
    for index in range(2):
        fire_mesh = build_mesh_from_geo('rooftop_fire_%d' % index, sphere(0.18, 0.0, 0.0, 0.5, 6, 4))
        fire_mesh.materials.append(fire_mat)
        object_at('rooftop_fire_%d' % index, fire_mesh, (1.6 + index * 0.8, 2.4, 0.0))
    strand_mat = add_emissive_material('rooftop_string', venue['parapet_lit'], 1.5)
    strand = build_mesh_from_geo('rooftop_string_lights', string_light_run())
    strand.materials.append(strand_mat)
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
        angle = 2.0 * math.pi * index / 6 + 0.4
        palms.append(
            translate_geo(
                palm(2.6 + 0.35 * (index % 3), seed=41 + index * 7),
                9.9 * math.cos(angle),
                9.9 * math.sin(angle),
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
    out = []
    for i in (0, 2, 4):
        c = int(hex_rgb[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


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
        handle.write('
')
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
        export_lights=True,
    )
    append_gpu_instances(glb, pools)
    report = checker.Report()
    gltf, binary = checker.read_glb(glb)
    checker.compute_counts(gltf, binary, report)
    failures = []
    checker_check_fail(venue['id'], report, failures)
    if not lights:
        failures.append('no light rig built for ' + venue['id'])
    for intrusion in intrusions:
        failures.append('orbit clear radius: ' + intrusion)
    return glb, report, failures


def checker_check_fail(venue_id, report, failures):
    if report.total_triangles > 250000:
        failures.append('scene triangle budget exceeded: %d' % report.total_triangles)
    if report.materials > 24:
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
        print('VENUE %s triangles=%d materials=%d draw_calls=%d' % (
            venue['id'], report.total_triangles, report.materials, report.draw_calls
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

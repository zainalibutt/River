BUDGET = {
    'scene_triangles': 250000,
    'props_triangles': 60000,
    'environment_triangles': 80000,
    'texture_mb': 128,
    'max_texture_dim': 2048,
    'max_materials': 24,
    'max_draw_calls': 120,
    'character_triangles': 15000,
    'character_quad_min': 0.85,
    'character_groups_min': 100,
    'character_bones_min': 60,
}

CHARACTER_CULL_FRACTION = 0.34
CHARACTER_MESH_PREFIX = 'char_'

FELT_RX = 1.24
FELT_RY = 0.72
TABLE_TOP = 0.76
SEAT_H = 0.46
SEAT_RING_X = FELT_RX * 1.42
SEAT_RING_Y = FELT_RY * 1.58
RAIL_X = FELT_RX * 1.05
RAIL_Y = FELT_RY * 1.09
RAIL_T = 0.06

CHIP_D = 0.039
CHIP_THICK = 0.0115
CHIP_SEG = 24

CARD_W = 0.0635
CARD_H = 0.0889
CARD_TH = 0.001

TABLE_SEG = 40
CHAIR_SEG = 14
PLANTER_SEG = 10

FELT_HEX = '1C4232'
RAIL_HEX = '3B2A1F'
WOOD_HEX = '24190A'
CARD_FACE_HEX = 'F7F3EC'
CARD_BACK_HEX = '5A2733'
CARD_EDGE_HEX = 'D9D2C6'

CHIP_DENOMS = [
    ('chip_100', 'E8E2D6', 'B9B3A4'),
    ('chip_500', 'B03E33', '7C2822'),
    ('chip_1k', '2A5C8F', '1C3F63'),
    ('chip_5k', '2C7A50', '1C5236'),
    ('chip_25k', '22262B', '0E1114'),
    ('chip_100k', '8A5A2B', '5E3C1B'),
]

ROOFTOP = {
    'id': 'rooftop',
    'felt': '0A121E',
    'felt_pattern': 'D9B45B',
    'rail': '12161C',
    'wood': '141210',
    'chair': '17181B',
    'chrome': 'B9BEC4',
    'floor': 'D9D4C6',
    'floor_pattern': 'B9B2A4',
    'parapet': '2A2F3A',
    'parapet_lit': 'FFD9A0',
    'planter': '3A4046',
    'foliage': '16241C',
    'fire': 'FF7A3C',
    'water': '2A4A6A',
}

BASEMENT = {
    'id': 'basement',
    'felt': '4E5A53',
    'rail': '5C4A35',
    'wood': '3A3A38',
    'chair': '6A7075',
    'machine': 'D9D9D4',
    'machine_dark': '2E3133',
    'crate': '7A6A4A',
    'ladder': '8A857A',
    'checker_a': '2A4A6A',
    'checker_b': 'D9D9D4',
    'wall': '232B30',
}

SUITE = {
    'id': 'suite',
    'felt': 'A6A93C',
    'rail': '241A14',
    'wood': '1A120E',
    'chair': '7A3B2B',
    'chair_accent': 'D9A941',
    'balustrade': 'D9B45B',
    'bar_wood': '2E1F12',
    'bar_lit': 'FFC96B',
    'sconce': 'FFE0B0',
    'wall': '5A2E2A',
    'chandelier': 'E8C969',
}

VENUES = [ROOFTOP, BASEMENT, SUITE]

# Measured light rigs, extracted from the lookdev builds and recorded in
# docs/design/14-venue-build-spec.md. Geometry alone renders flat - these are
# what make a venue read as its room. Energies are Blender area-light watts.
# type, colour, energy, size, shadow, (x, y, z), (rot_x_deg, rot_y_deg, rot_z_deg)
VENUE_LIGHTS = {
    'rooftop': {
        # Vertical gradient, not a flat colour. A flat background read gives a
        # misleading value - see docs/design/14-venue-build-spec.md.
        'world': ('101613', 1.5),
        'world_gradient': [(0.46, '8E3A6B'), (0.55, '4A2352'), (0.68, '0E0A18')],
        'lights': [
            ('table',     'AREA', 'FFE2BC', 240.0,  5.5, True,  (0.0, 0.0, 3.9),  (0, 0, 0)),
            ('sky_fill',  'AREA', '5C74B8', 300.0, 14.0, False, (0.0, 1.0, 7.0),  (0, 0, 0)),
            ('fire_key',  'AREA', 'FF7A22', 320.0,  6.0, False, (-4.2, 3.0, 1.6), (64, 0, -58)),
            ('pool',      'AREA', '3F9BFF', 190.0,  5.0, False, (-5.0, 5.6, 0.9), (20, 0, 0)),
            ('back_fill', 'AREA', '6E5C9E', 130.0,  7.0, False, (0.0, 6.5, 3.2),  (-58, 0, 0)),
        ],
    },
    'basement': {
        'world': ('0E1614', 0.35),
        'lights': [
            # One soft realtime caster per venue is the whole shadow budget.
            # The lookdev had all four fluoros casting; fluoro_2 is nearest the
            # table centre, so it keeps the shadow and the rest become fill.
            ('fluoro_0', 'AREA', 'CFEDE2',  90.0, 2.2, False, (-2.6,  2.2, 2.92), (0, 0, 0)),
            ('fluoro_1', 'AREA', 'CFEDE2',  90.0, 2.2, False, ( 2.6,  2.2, 2.92), (0, 0, 0)),
            ('fluoro_2', 'AREA', 'CFEDE2',  90.0, 2.2, True,  (-2.6, -1.6, 2.92), (0, 0, 0)),
            ('fluoro_3', 'AREA', 'CFEDE2',  90.0, 2.2, False, ( 2.6, -1.6, 2.92), (0, 0, 0)),
            ('ambient',  'AREA', '7FA89A',  70.0, 9.0, False, (0.0,  0.0, 2.70), (0, 0, 0)),
        ],
    },
    'suite': {
        'world': ('1A0A0E', 0.6),
        'lights': [
            ('chandelier', 'AREA', 'FFD9A0', 260.0,  2.2, True,  (0.0, 0.0, 3.3), (0, 0, 0)),
            ('sconce_0',   'AREA', 'FFC98A',  90.0,  1.6, False, ( 3.31,  6.06, 2.5), (72, 0, -28)),
            ('sconce_1',   'AREA', 'FFC98A',  90.0,  1.6, False, ( 6.06, -3.31, 2.5), (72, 0, -118)),
            ('sconce_2',   'AREA', 'FFC98A',  90.0,  1.6, False, (-3.31, -6.06, 2.5), (72, 0, -208)),
            ('sconce_3',   'AREA', 'FFC98A',  90.0,  1.6, False, (-6.06,  3.31, 2.5), (72, 0, -298)),
            ('bar',        'AREA', '9FE8D0', 120.0,  4.5, False, (0.0, 6.0, 1.9), (-70, 0, 0)),
            ('ambient',    'AREA', '7A3E44',  80.0, 10.0, False, (0.0, 0.0, 3.9), (0, 0, 0)),
        ],
    },
}

# Orbit camera per venue, from docs/design/06-interaction.md. The interaction
# model is common; these numbers are not. clear_radius is the annulus that must
# stay free of anything over 2m tall - the Rooftop camera once rendered from
# inside a palm tree because a prop sat at 6.0m against a 6.1m orbit.
VENUE_CAMERA = {
    'rooftop':  {'radius': 6.1, 'height': 4.05, 'pitch': 62.0, 'fov': 64.0, 'clear_radius': 8.4},
    'basement': {'radius': 3.6, 'height': 2.45, 'pitch': 72.0, 'fov': 66.0, 'clear_radius': 6.0},
    'suite':    {'radius': 3.9, 'height': 2.85, 'pitch': 68.0, 'fov': 66.0, 'clear_radius': 5.4},
}
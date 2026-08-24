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
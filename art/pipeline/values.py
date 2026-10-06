BUDGET = {
    'scene_triangles': 250000,
    'props_triangles': 60000,
    'environment_triangles': 80000,
    'texture_mb': 128,
    'max_texture_dim': 2048,
    # 25 since the Rooftop chairs stopped borrowing a poker chip's rim as their
    # chrome and were given a chrome material of their own. Paid for
    # deliberately rather than absorbed: draw calls, the number that actually
    # costs frame time, sit at 58 of 120, and a material shared between a chair
    # pedestal and a 100 chip means restyling the chips restyles the furniture.
    # 26 since the characters wear the atlas they were painted with rather
    # than a flat one the assembly painted over the top. Male and female carry
    # a face each, which is two textured materials where there had been one
    # untextured; the flat spare is dropped when nothing falls back to it.
    # Two 1024 atlases is 8MB against a 128MB budget and draw calls sit at 65
    # of 120, so the cost is a material slot and nothing else. Merging the two
    # faces into one atlas would buy the slot back and is the obvious next
    # economy if this ever gets tight.
    # 27 reserves one measured slot for the native character's eyes and shared
    # brow/lash treatment. 28 carries the native gold hairstyle's clipped alpha
    # texture instead of flattening its cards into an opaque helmet. 29 keeps
    # the approved native eyebrow and eyelash alpha textures separate: merging
    # them would require an atlas and UV rewrite on the approved face. 30
    # gives the browser proof one flat brown iris material rather than sampling
    # a whole Blender eye shader graph that glTF cannot reproduce faithfully.
    # The isolated review remains below half of the draw-call gate and under 6MB.
    'max_materials': 30,
    'max_draw_calls': 120,
    # Full legs replaced the old upper-thigh cut after the permitted orbit
    # camera proved that the lower body is visible. The source is allowed 23k;
    # venue LOD and the 250k scene ceiling remain the shipping gates.
    'character_triangles': 23000,
    'character_quad_min': 0.85,
    'character_groups_min': 100,
    'character_bones_min': 60,
}

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
    # The felt's printed marks - the board boxes and the pot ring - in an ink a few shades
    # off the cloth, the way a card room prints its layout: read, not shouted.
    'felt_ink': '5E7BA3',
    'rail': '12161C',
    # Padded leather has a satin sheen along its crown; 0.72 read as a matte rubber hoop.
    'rail_roughness': 0.52,
    'wood': '21150E',
    'chair': '17181B',
    'chrome': 'B9BEC4',
    # Pale lavender-grey stone, which is what the reference terrace is made of
    # and what the shot-composition study recorded. It was 121A1D -
    # near-black rock, within 1.11 contrast of a near-black parapet, so the two
    # largest surfaces in the venue read as one shape. They only ever appeared
    # to separate because the sRGB-as-linear bug lifted them by different
    # amounts; correcting the colour space made the room's real palette visible
    # for the first time, and the palette gate caught this within a minute.
    'floor': '3A3742',
    # The joints between the floor's stone tiles - see stone.py.
    'floor_grout': '221F28',
    'floor_pattern': 'B9B2A4',
    'parapet': '0A0C0E',
    # The coping stone: a shade of the floor's lavender-grey, so the edge of the terrace
    # reads against the city without becoming a bright band across the frame.
    'coping': '4A4652',
    'parapet_lit': 'FFD9A0',
    # The strip under the coping is a quarter of the height it was when it sat on the wall's
    # face, and hidden under a lip, so it burns brighter to read as the same line.
    'parapet_lit_strength': 0.6,
    # Festoon bulbs: warm enough to read as lamps, not beige dots in the sky. Past about 1.5
    # the tone curve bleaches them white.
    'festoon': 'FFB35C',
    'festoon_strength': 1.4,
    'planter': '3A4046',
    # Olive and box: a silvery grey-green that catches the terrace's light rather than going to
    # a black silhouette.
    'foliage': '4B5B48',
    'fire': 'FF7A3C',
    'water': '2A4A6A',
    # The pool is lit from inside: a soft teal, well below the strength at which it would
    # compete with the table for the eye.
    'pool_glow': '1F6F8B',
    'pool_glow_strength': 0.55,
    # The statues behind the pool: dark bronze that the city and the pool light edge.
    'bronze': '6E4E30',
    # The lounge's upholstery: a warm taupe, the one thing on the terrace that is not black
    # leather, stone or steel.
    'fabric': '4E3C31',
    # The city is painted rather than lit - see skyline.py. Its haze is the sky's own band
    # colour from VENUE_SKY, so it is not repeated here; the ridge is the hills' colour
    # before any haze.
    'skyline_ridge': '22162A',
    'skyline_emission': 1.0,
    'skyline_beacon': 'FF3B2F',
    # Past about two the tone curve bleaches a red light towards salmon.
    'skyline_beacon_strength': 1.8,
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
# docs/art-pipeline.md. Geometry alone renders flat - these are
# what make a venue read as its room. Energies are Blender area-light watts.
# type, colour, energy, size, shadow, (x, y, z), (rot_x_deg, rot_y_deg, rot_z_deg)
VENUE_LIGHTS = {
    'rooftop': {
        # Vertical gradient, not a flat colour. A flat background read gives a
        # misleading value - see docs/art-pipeline.md.
        'world': ('101613', 1.5),
        'world_gradient': [(0.46, '8E3A6B'), (0.55, '4A2352'), (0.68, '0E0A18')],
        'lights': [
            ('table',     'AREA', 'FFE2BC', 240.0,  5.5, True,  (0.0, 0.0, 3.9),  (0, 0, 0)),
            ('sky_fill',  'AREA', '5C74B8', 180.0, 10.0, False, (0.0, 0.8, 4.8),  (0, 0, 0)),
            # Over the braziers, facing down. It stood on the far side of the terrace from
            # both fires, tilted across the room, and in the browser a rect light lights
            # nothing behind its own plane: that plane ran down through the parapet and cut
            # a hard diagonal edge across the wall. Facing down, the plane is a ceiling at
            # 2.25m that only palm crowns and festoon posts reach.
            # Wide enough to reach the lounge beyond the braziers as well as the table's
            # near chairs.
            ('fire_key',  'AREA', 'FF7A22', 190.0,  4.5, False, (3.6, 0.0, 2.4), (0, 0, 0)),
            # Over the pool behind the dealer, since the terrace grew to hold it.
            ('pool',      'AREA', '5B88A5',  90.0,  3.2, False, (0.0, 5.2, 1.9), (0, 0, 0)),
            # The fire run between the table and the pool, facing down like the fire key so
            # that its plane cannot cut an edge across anything a player looks at.
            ('fire_run',  'AREA', 'FF7A2A', 110.0,  3.0, False, (0.0, 3.8, 1.7), (0, 0, 0)),
            # Over the bar on the far side from the lounge, under its pendants.
            ('bar',       'AREA', 'FFC98A',  95.0,  3.0, False, (-6.1, 0.0, 2.6), (0, 0, 0)),
            # Under the arc lamp over the blackjack table.
            ('blackjack', 'AREA', 'FFD2A0',  65.0,  1.6, False, (0.0, -5.4, 2.0), (0, 0, 0)),
            ('back_fill', 'AREA', '6E5C9E',  70.0,  4.5, False, (0.0, 3.05, 2.8),  (-58, 0, 0)),
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

# The dusk dome the browser draws behind an open-air venue: four colours, and the four
# smoothstep bands between them in h = sin(elevation) / 2 + 0.5 - low to band, the hot
# glow rising and fading back out, then high overhead. Written into lighting.json, where
# the scene component, the review renders and the skyline's haze all read it, so the sky
# and the air the city sinks into cannot drift apart.
#
# Below the horizon the dome is the band colour, and so is the haze at the foot of every
# tower. The dome's underside was a navy that nothing on the Rooftop matched, and a camera
# raised to the top of the orbit looks far enough over the parapet to see under the city:
# it saw the city stop, then a navy band, then the parapet - two horizons. Now anything it
# can see under the skyline is more of the same air.
VENUE_SKY = {
    'rooftop': {
        'low': '3B1D24',
        'band': '3B1D24',
        'hot': 'B85F2B',
        'high': '12121D',
        'bands': ((0.40, 0.50), (0.48, 0.56), (0.62, 0.78), (0.74, 0.97)),
    },
}

# Orbit camera per venue, from River's interaction design. The interaction
# model is common; these numbers are not. clear_radius is the annulus that must
# stay free of anything over 2m tall - the Rooftop camera once rendered from
# inside a palm tree because a prop sat at 6.0m against a 6.1m orbit.
# Kept in step with apps/web/src/lib/venue.ts, which is what the browser
# actually reads. This carried 6.1m out and 4.05m up long after the client moved
# to 3.2 and 1.5, so lighting.json shipped a camera nothing used and anyone
# reading the pipeline for the truth got the old shot. Two places holding one
# number is how the colour space went wrong; the fix is the same both times.
VENUE_CAMERA = {
    'rooftop':  {'radius': 3.2, 'height': 1.5, 'pitch': 73.5, 'fov': 64.0, 'clear_radius': 8.4},
    'basement': {'radius': 3.6, 'height': 2.45, 'pitch': 72.0, 'fov': 66.0, 'clear_radius': 6.0},
    'suite':    {'radius': 3.9, 'height': 2.85, 'pitch': 68.0, 'fov': 66.0, 'clear_radius': 5.4},
}

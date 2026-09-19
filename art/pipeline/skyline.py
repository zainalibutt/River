"""The city around the Rooftop: its towers, their windows and the haze between them.

A player at the table sees the city through a strip of sky about ten degrees deep. The
parapet hides everything more than three degrees below the horizon, and the play camera's
frame ends six degrees above it - fourteen at the flattest the orbit allows. The skyline
this replaces stood twenty to forty-five metres out and rose past fifty degrees, so the
strip held the blank middles of a ring of boxes and a scatter of window bars, and never a
rooftop.

So the city is built for the strip. Towers stand where real ones would, from 260 metres out
to 820, at real sizes, and each one's top is placed by the elevation it reaches from the
table rather than by a height in metres. Three rings fade into the horizon glow with
distance, and two ridges of hills close part of the far edge.

Windows are painted rather than modelled. Every facade samples one atlas in world units -
four texels a metre, a storey every fifteen - so a window is the same size on every
building, and the whole city is one mesh drawn in one call. The atlas holds four facade
styles at three depths of haze, painted in by height because the air is thickest near the
ground that lights it from below.

Pure Python and numpy: build_assets.py turns the lists into meshes and the array into an
image, and nothing here imports bpy.
"""
import math
import struct
import zlib

import numpy as np
from geo import _lcg

ATLAS = 2048
TILE_W = 256
TILE_H = 1024
PX_PER_M = 4.0
FLOOR_PX = 15
BAY_PX = 6
FLOOR_M = FLOOR_PX / PX_PER_M
# The world height of a facade tile's bottom row. Floors line up across the whole city
# because every facade reads its rows from the same heights. Low enough that the far
# ring's bases stay under the parapet's sight line, which is 41 metres down at 820.
Z_BASE = -64.0
Z_CEILING = Z_BASE + TILE_H / PX_PER_M
# Kept clear at a tile's edges, so the coarser mip levels do not borrow a neighbour's
# windows.
GUTTER_PX = 8
SOLID_PX = 32

# The play camera's height, and how far below the horizon the parapet cuts the view.
EYE = 1.5
PARAPET_DIP_DEG = 3.0

# Haze by height: full below HAZE_Z0, thinning with an e-folding height of HAZE_H. Each
# ring paints it at its own strength, and lit windows keep more of themselves through it
# than walls do, which is why a far city at night is a band of lights and not a wall.
HAZE_Z0 = -25.0
HAZE_H = 55.0
HAZE_STRENGTH = (0.28, 0.52, 0.80)
LIGHT_HAZE = 0.4

RIDGE_Z0 = -120.0
RIDGE_PX_PER_M = 2.0

STYLES = (
    # name, wall, unlit glass, window within its cell (x0, x1, y0, y1), lit colours by weight.
    # The walls are near black on purpose: the tone curve lifts them, and a city at dusk is
    # silhouettes and lights, not lit facades.
    ('office', '0F131B', '161C28', (1, 6, 3, 13),
     (('DCE6FF', 4), ('EEF2FF', 3), ('FFF0D8', 2), ('C9DBFF', 1))),
    ('residential', '13100F', '1B1716', (1, 5, 4, 12),
     (('FFB45A', 4), ('FFC47C', 4), ('FFD6A0', 3), ('FFE6C2', 1), ('9CB4FF', 1))),
    ('glass', '0A1115', '0F1C22', (0, 6, 3, 12),
     (('CFE3DC', 3), ('BFD8D2', 2), ('E6E2D2', 2))),
    ('dark', '0C0D11', '13151B', (1, 6, 3, 13),
     (('FFD49A', 2), ('DCE6FF', 2))),
)
# Crown lighting, the one place the city is allowed a colour of its own.
ACCENTS = ('45E0D2', 'FFB24A', 'FF4FA8', 'E4ECFF')
ROOF_HEX = '15161E'
MAST_HEX = '0B0C10'

ACCENT_TILE = (4, 1)
SOLID_TILE = (5, 1)
RIDGE_TILE = (6, 1)
SOLIDS = {'roof0': (0, 0), 'roof1': (1, 0), 'roof2': (2, 0), 'mast': (3, 0), 'haze': (4, 0)}

RINGS = (
    # radius, count, top elevation in degrees, footprint width, haze level, style weights.
    # Tops sit low in the strip so the glow shows above them: a skyline is its outline.
    {'radius': (260.0, 420.0), 'count': 26, 'elevation': (0.6, 4.6), 'width': (16.0, 34.0),
     'level': 0, 'styles': (0.35, 0.25, 0.25, 0.15)},
    {'radius': (440.0, 620.0), 'count': 56, 'elevation': (-0.4, 3.4), 'width': (18.0, 40.0),
     'level': 1, 'styles': (0.35, 0.3, 0.2, 0.15)},
    {'radius': (640.0, 820.0), 'count': 120, 'elevation': (-1.6, 2.0), 'width': (22.0, 46.0),
     'level': 2, 'styles': (0.3, 0.35, 0.15, 0.2)},
)
# Where the towers bunch. A seated player looks across the table from behind their own
# seat, so every direction is somebody's view; the clusters only vary how full it is.
# The default camera looks toward +Y, over the dealer, and the tallest cluster is there.
CLUSTERS = ((math.pi / 2.0, 0.55, 1.2), (math.radians(215.0), 0.5, 0.8), (math.radians(335.0), 0.45, 0.6))
BACKGROUND_DENSITY = 0.6
# One landmark per cluster, tall enough to leave the default frame and come back into it
# when the orbit flattens.
LANDMARK_AZIMUTHS = (80.0, 205.0, 335.0)
LANDMARK_ELEVATION = (6.5, 11.0)

RIDGES = (
    # radius, elevation range, atlas column (0 nearer and darker, 1 hazier), seed offset.
    # Inside the browser camera's one-kilometre far plane.
    (880.0, (-2.5, 3.0), 0, 0),
    (950.0, (-1.5, 4.2), 1, 1),
)
RIDGE_SEGMENTS = 360
# Hills stand behind part of the city, not all of it: a ring of them reads as a wall.
RIDGE_REACHES = ((math.radians(150.0), 0.75), (math.radians(20.0), 0.55))


def _hex(value):
    value = value.lstrip('#')
    return np.array([int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def facade_tile(style, level):
    """Which atlas tile holds a style at a depth of haze: the two nearer rings fill the
    bottom row, the far ring the start of the top one."""
    if level < 2:
        return style + 4 * level, 0
    return style, 1


# --- the atlas -----------------------------------------------------------------------


def _runs(count, p_on, stickiness, rng):
    """On and off in runs: a lit floor tends to sit next to another lit floor."""
    out = np.zeros(count, dtype=bool)
    state = rng.rand() < p_on
    for index in range(count):
        if rng.rand() > stickiness:
            state = rng.rand() < p_on
        out[index] = state
    return out


def _lit_cells(name, floors, bays, rng):
    # About a third of a city's windows are lit after dark. Much more and the facades read
    # as striped panels rather than buildings.
    if name == 'office':
        on = _runs(floors, 0.34, 0.6, rng)[:, None]
        lit = np.where(on, rng.rand(floors, bays) < 0.72, rng.rand(floors, bays) < 0.05)
        level = 0.55 + 0.35 * rng.rand(floors, bays)
    elif name == 'residential':
        lit = rng.rand(floors, bays) < 0.3
        level = 0.45 + 0.55 * rng.rand(floors, bays)
    elif name == 'glass':
        lit = np.stack([_runs(bays, 0.28, 0.85, rng) for _ in range(floors)])
        level = np.repeat(0.5 + 0.3 * rng.rand(floors, 1), bays, axis=1)
    else:
        on = _runs(floors, 0.1, 0.5, rng)[:, None]
        lit = np.where(on, rng.rand(floors, bays) < 0.5, rng.rand(floors, bays) < 0.015)
        level = 0.6 + 0.4 * rng.rand(floors, bays)
    return np.where(lit, level, 0.0).astype(np.float32)


def _pick(palette, shape, rng):
    colours = np.array([_hex(colour) for colour, _ in palette])
    weights = np.array([weight for _, weight in palette], dtype=np.float64)
    return colours[rng.choice(len(palette), size=shape, p=weights / weights.sum())]


def _facade(style, strength, haze, rng):
    name, wall_hex, glass_hex, (x0, x1, y0, y1), palette = style
    floors = TILE_H // FLOOR_PX + 1
    bays = TILE_W // BAY_PX + 1
    intensity = _lit_cells(name, floors, bays, rng)
    colours = _pick(palette, (floors, bays), rng) * (0.94 + 0.12 * rng.rand(floors, bays, 1))
    rows = np.arange(TILE_H)
    columns = np.arange(TILE_W)
    floor, row_in = rows // FLOOR_PX, rows % FLOOR_PX
    bay, column_in = columns // BAY_PX, columns % BAY_PX
    window = ((row_in >= y0) & (row_in < y1))[:, None] & ((column_in >= x0) & (column_in < x1))[None, :]
    lit = intensity[floor][:, bay]
    lit_colour = colours[floor][:, bay] * lit[..., None]
    glass = np.broadcast_to(_hex(glass_hex), lit_colour.shape)
    wall = np.broadcast_to(_hex(wall_hex), lit_colour.shape)
    tile = np.where(window[..., None], np.where(lit[..., None] > 0.0, lit_colour, glass), wall)
    z = Z_BASE + (rows + 0.5) / PX_PER_M
    fog = np.repeat((strength * np.clip(np.exp(-(z - HAZE_Z0) / HAZE_H), 0.0, 1.0))[:, None], TILE_W, axis=1)
    fog = np.where(window & (lit > 0.0), fog * LIGHT_HAZE, fog)
    return tile * (1.0 - fog[..., None]) + haze * fog[..., None]


def _accent(accent_hex, wall_hex, size=256):
    """A lit crown: sixteen vertical fins across a face, brightening toward a cap line."""
    accent = _hex(accent_hex)
    wall = _hex(wall_hex)
    t = ((np.arange(size) + 0.5) / size)[:, None, None]
    fin = ((np.arange(size) % 16) < 5)[None, :, None]
    base = wall * (1.0 - 0.35 * t) + accent * (0.18 * t)
    lit = accent * (0.08 + 0.92 * t ** 2.2)
    patch = np.where(fin, lit, base)
    patch[-10:] = accent
    return patch


def _ridge_column(ridge, haze, strength, top):
    z = RIDGE_Z0 + (np.arange(TILE_H) + 0.5) / RIDGE_PX_PER_M
    fog = np.clip(1.0 - (z - RIDGE_Z0) / (top - RIDGE_Z0), 0.0, 1.0) ** 1.3
    fog = strength + (1.0 - strength) * fog
    return ridge * (1.0 - fog)[:, None] + haze * fog[:, None]


def atlas(haze_hex, ridge_hex, seed=1907):
    """The skyline's one texture, sRGB-encoded, row 0 at the bottom (Blender's order)."""
    rng = np.random.RandomState(seed)
    haze = _hex(haze_hex)
    image = np.empty((ATLAS, ATLAS, 3), dtype=np.float32)
    image[:] = haze

    def put(tile, x, y, patch):
        x0 = tile[0] * TILE_W + x
        y0 = tile[1] * TILE_H + y
        image[y0:y0 + patch.shape[0], x0:x0 + patch.shape[1]] = patch

    for level, strength in enumerate(HAZE_STRENGTH):
        for index, style in enumerate(STYLES):
            put(facade_tile(index, level), 0, 0, _facade(style, strength, haze, rng))
    for index, accent in enumerate(ACCENTS):
        put(ACCENT_TILE, 0, index * 256, _accent(accent, STYLES[0][1]))
    roof = _hex(ROOF_HEX)
    for level, strength in enumerate(HAZE_STRENGTH):
        colour = roof * (1.0 - strength * 0.8) + haze * strength * 0.8
        x, y = SOLIDS['roof%d' % level]
        put(SOLID_TILE, x * SOLID_PX, y * SOLID_PX, np.broadcast_to(colour, (SOLID_PX, SOLID_PX, 3)))
    x, y = SOLIDS['mast']
    put(SOLID_TILE, x * SOLID_PX, y * SOLID_PX, np.broadcast_to(_hex(MAST_HEX), (SOLID_PX, SOLID_PX, 3)))
    ridge = _hex(ridge_hex)
    for column, (strength, top) in enumerate(((0.3, 200.0), (0.5, 260.0))):
        patch = np.repeat(_ridge_column(ridge, haze, strength, top)[:, None, :], TILE_W // 2, axis=1)
        put(RIDGE_TILE, column * (TILE_W // 2), 0, patch)
    return np.clip(image, 0.0, 1.0)


def png_bytes(pixels):
    """An 8-bit RGB PNG of an atlas, written here rather than by Blender.

    The windows need a lossless file - a JPEG rings around every lit pane - and Blender's
    image save leaves its compression to settings that differ between save paths, one of
    which also runs the pixels through the scene's view transform. Rows are filtered
    whichever of Sub and Up leaves less to compress, which the window grid favours heavily:
    most rows repeat the one below and most windows are runs of one colour.
    """
    rows = np.flipud(np.clip(np.round(pixels * 255.0), 0, 255).astype(np.uint8))
    height, width, _ = rows.shape
    flat = rows.reshape(height, width * 3).astype(np.int16)
    sub = flat.copy()
    sub[:, 3:] = flat[:, 3:] - flat[:, :-3]
    up = flat.copy()
    up[1:] = flat[1:] - flat[:-1]

    def cost(residual):
        return np.abs(((residual + 128) % 256) - 128).sum(axis=1)

    use_up = cost(up) < cost(sub)
    filtered = np.where(use_up[:, None], up, sub).astype(np.int64) % 256
    kinds = np.where(use_up, 2, 1).astype(np.uint8)[:, None]
    raw = np.concatenate([kinds, filtered.astype(np.uint8)], axis=1).tobytes()

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


# --- geometry ------------------------------------------------------------------------


class Geometry:
    """Triangles with a UV per corner. Quads share their four corners between two triangles."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []

    def triangle(self, points, uvs=None):
        base = len(self.verts)
        self.verts.extend(points)
        self.faces.append((base, base + 1, base + 2))
        if uvs is not None:
            self.uvs.extend(uvs)

    def quad(self, points, uvs=None):
        base = len(self.verts)
        self.verts.extend(points)
        self.faces.append((base, base + 1, base + 2))
        self.faces.append((base, base + 2, base + 3))
        if uvs is not None:
            a, b, c, d = uvs
            self.uvs.extend((a, b, c, a, c, d))


def _uv(px, py):
    return px / ATLAS, py / ATLAS


def _solid_uv(name):
    x, y = SOLIDS[name]
    return _uv(SOLID_TILE[0] * TILE_W + (x + 0.5) * SOLID_PX, SOLID_TILE[1] * TILE_H + (y + 0.5) * SOLID_PX)


def _rectangle(cx, cy, half_w, half_d, angle):
    """Corners anticlockwise from above, so every side faces out when wound bottom-left first."""
    cosine, sine = math.cos(angle), math.sin(angle)
    return [(cx + x * cosine - y * sine, cy + x * sine + y * cosine)
            for x, y in ((-half_w, -half_d), (half_w, -half_d), (half_w, half_d), (-half_w, half_d))]


def _sides(geo, corners, z0, z1, uv_for_side):
    for index in range(4):
        (ax, ay), (bx, by) = corners[index], corners[(index + 1) % 4]
        length = math.hypot(bx - ax, by - ay)
        geo.quad([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], uv_for_side(length, z0, z1))


def _roof(geo, corners, z, name):
    uv = _solid_uv(name)
    geo.quad([(x, y, z) for x, y in corners], [uv] * 4)


def _facade_uvs(tile, rand, phase):
    """A facade maps into its tile in world units, from a bay boundary picked at random so
    no two buildings show the same windows, and a storey lifted by the tower's own phase
    so neighbours do not share floor lines."""
    def uv_for_side(length, z0, z1):
        span = length * PX_PER_M
        room = TILE_W - 2 * GUTTER_PX - span
        offset = GUTTER_PX + BAY_PX * math.floor(rand() * (max(room, 0.0) // BAY_PX + 1))
        u0 = tile[0] * TILE_W + offset
        v0 = tile[1] * TILE_H + (z0 - Z_BASE + phase) * PX_PER_M
        v1 = tile[1] * TILE_H + (z1 - Z_BASE + phase) * PX_PER_M
        return [_uv(u0, v0), _uv(u0 + span, v0), _uv(u0 + span, v1), _uv(u0, v1)]
    return uv_for_side


def _accent_uvs(accent):
    """A crown maps its whole face onto one lit patch, whatever its width."""
    x0 = ACCENT_TILE[0] * TILE_W + GUTTER_PX
    x1 = (ACCENT_TILE[0] + 1) * TILE_W - GUTTER_PX
    y0 = ACCENT_TILE[1] * TILE_H + accent * 256 + 2
    y1 = y0 + 252

    def uv_for_side(_length, _z0, _z1):
        return [_uv(x0, y0), _uv(x1, y0), _uv(x1, y1), _uv(x0, y1)]
    return uv_for_side


def _solid_uvs(name):
    uv = _solid_uv(name)

    def uv_for_side(_length, _z0, _z1):
        return [uv] * 4
    return uv_for_side


def _octahedron(geo, x, y, z, radius):
    points = [(x + radius, y, z), (x, y + radius, z), (x - radius, y, z), (x, y - radius, z)]
    top = (x, y, z + radius)
    bottom = (x, y, z - radius)
    for index in range(4):
        a, b = points[index], points[(index + 1) % 4]
        geo.triangle((a, b, top))
        geo.triangle((b, a, bottom))


def _snap_to_floor(z, phase):
    """End a tier at one of its own floor lines, so its top storey is whole and a strip of
    wall reads as the parapet above it."""
    return Z_BASE - phase + round((z - Z_BASE + phase) / FLOOR_M) * FLOOR_M


def _pick_index(weights, rand):
    roll = rand() * sum(weights)
    for index, weight in enumerate(weights):
        roll -= weight
        if roll <= 0.0:
            return index
    return len(weights) - 1


def _crown(ring, landmark, rand):
    if landmark:
        return ('spire', 'led', 'pyramid', 'led')[_pick_index((1.0, 1.0, 0.7, 0.5), rand)]
    choices = {
        0: (('penthouse', 0.35), ('led', 0.12), ('pyramid', 0.08), ('mast', 0.15), ('flat', 0.30)),
        1: (('penthouse', 0.40), ('led', 0.08), ('mast', 0.15), ('flat', 0.37)),
        2: (('mast', 0.10), ('flat', 0.90)),
    }[ring]
    return choices[_pick_index([weight for _, weight in choices], rand)][0]


def _beacon_radius(distance):
    # A warning light has to stay a visible point at six hundred metres.
    return 0.9 + 0.0025 * distance


def _tower(geo, beacons, spec, rand):
    cx, cy, angle = spec['x'], spec['y'], spec['angle']
    level = spec['level']
    distance = math.hypot(cx, cy)
    style = _pick_index(spec['styles'], rand)
    tile = facade_tile(style, level)
    half_w, half_d = spec['width'] / 2.0, spec['depth'] / 2.0
    base, top, phase = spec['base'], spec['top'], spec['phase']
    # Setbacks are placed in the upper part of the building, because the lower part is
    # behind the parapet and a step nobody can see is only triangles.
    tiers = 1
    if top - base > 30.0 and rand() < 0.45:
        tiers = 2
        if top - base > 55.0 and rand() < 0.4:
            tiers = 3
    z0 = base
    for tier in range(tiers):
        last = tier == tiers - 1
        z1 = top if last else _snap_to_floor(z0 + (top - z0) * (0.6 + 0.2 * rand()), phase)
        corners = _rectangle(cx, cy, half_w, half_d, angle)
        _sides(geo, corners, z0, z1, _facade_uvs(tile, rand, phase))
        _roof(geo, corners, z1, 'roof%d' % level)
        if not last:
            inset = 0.1 + 0.1 * rand()
            half_w *= 1.0 - inset
            half_d *= 1.0 - inset
        z0 = z1
    crown = _crown(level, spec['landmark'], rand)
    corners = _rectangle(cx, cy, half_w, half_d, angle)
    beacon_radius = _beacon_radius(distance)
    if crown == 'penthouse':
        scale = 0.35 + 0.2 * rand()
        box = _rectangle(cx, cy, half_w * scale, half_d * scale, angle)
        z1 = top + 4.0 + 5.0 * rand()
        _sides(geo, box, top, z1, _facade_uvs(facade_tile(3, level), rand, phase))
        _roof(geo, box, z1, 'roof%d' % level)
    elif crown == 'led':
        band = 6.0 + 8.0 * rand()
        box = _rectangle(cx, cy, half_w * 0.95, half_d * 0.95, angle)
        _sides(geo, box, top, top + band, _accent_uvs(int(rand() * len(ACCENTS)) % len(ACCENTS)))
        _roof(geo, box, top + band, 'roof%d' % level)
        if rand() < 0.5:
            _mast(geo, beacons, cx, cy, top + band, 10.0 + 14.0 * rand(), beacon_radius)
    elif crown == 'pyramid':
        apex = (cx, cy, top + min(half_w, half_d) * (0.9 + 0.7 * rand()))
        lit = rand() < 0.5
        accent = int(rand() * len(ACCENTS)) % len(ACCENTS)
        for index in range(4):
            (ax, ay), (bx, by) = corners[index], corners[(index + 1) % 4]
            if lit:
                x0 = ACCENT_TILE[0] * TILE_W + GUTTER_PX
                x1 = (ACCENT_TILE[0] + 1) * TILE_W - GUTTER_PX
                y0 = ACCENT_TILE[1] * TILE_H + accent * 256 + 2
                uvs = (_uv(x0, y0), _uv(x1, y0), _uv((x0 + x1) / 2.0, y0 + 252))
            else:
                uvs = (_solid_uv('roof%d' % level),) * 3
            geo.triangle(((ax, ay, top), (bx, by, top), apex), uvs)
        if not lit:
            # A dark cap needs its warning light; a lit one is already the brightest thing there.
            _octahedron(beacons, apex[0], apex[1], apex[2] + beacon_radius, beacon_radius)
    elif crown == 'spire':
        plinth = _rectangle(cx, cy, half_w * 0.4, half_d * 0.4, angle)
        z1 = top + 5.0 + 4.0 * rand()
        _sides(geo, plinth, top, z1, _facade_uvs(facade_tile(3, level), rand, phase))
        _roof(geo, plinth, z1, 'roof%d' % level)
        needle = _rectangle(cx, cy, 1.6, 1.6, angle)
        tip = (cx, cy, z1 + 22.0 + 24.0 * rand())
        mast = _solid_uv('mast')
        for index in range(4):
            (ax, ay), (bx, by) = needle[index], needle[(index + 1) % 4]
            geo.triangle(((ax, ay, z1), (bx, by, z1), tip), (mast, mast, mast))
        _octahedron(beacons, tip[0], tip[1], tip[2] + beacon_radius, beacon_radius)
    elif crown == 'mast':
        _mast(geo, beacons, cx, cy, top, 10.0 + 16.0 * rand(), beacon_radius)
    elif spec['landmark'] or (top - EYE > 20.0 and rand() < 0.3):
        # A flat roof on a tall building still carries its warning lights, one each end.
        for index in (0, 2):
            x, y = corners[index]
            _octahedron(beacons, x + (cx - x) * 0.08, y + (cy - y) * 0.08, top + beacon_radius, beacon_radius)


def _mast(geo, beacons, cx, cy, z0, height, beacon_radius):
    corners = _rectangle(cx, cy, 0.6, 0.6, 0.0)
    _sides(geo, corners, z0, z0 + height, _solid_uvs('mast'))
    _octahedron(beacons, cx, cy, z0 + height + beacon_radius, beacon_radius)


def _wrapped(angle):
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _azimuth(rand):
    peak = BACKGROUND_DENSITY + sum(weight for _, _, weight in CLUSTERS)
    while True:
        angle = rand() * 2.0 * math.pi
        weight = BACKGROUND_DENSITY + sum(w * math.exp(-0.5 * (_wrapped(angle - centre) / spread) ** 2)
                                          for centre, spread, w in CLUSTERS)
        if rand() * peak < weight:
            return angle


def _elevation_to_z(distance, degrees):
    return EYE + distance * math.tan(math.radians(degrees))


def layout(seed=20260919):
    """Every tower's footprint, height and ring, before any geometry is made."""
    rand = _lcg(seed)
    grid = math.radians(12.0)
    towers = []
    for level, ring in enumerate(RINGS):
        for index in range(ring['count']):
            landmark = level == 0 and index < len(LANDMARK_AZIMUTHS)
            if landmark:
                angle = math.radians(LANDMARK_AZIMUTHS[index]) + (rand() - 0.5) * 0.08
            else:
                angle = _azimuth(rand)
            r0, r1 = ring['radius']
            distance = r0 + (r1 - r0) * rand()
            e0, e1 = LANDMARK_ELEVATION if landmark else ring['elevation']
            # Weight toward the low end: most of a skyline is the ordinary buildings.
            elevation = e0 + (e1 - e0) * rand() ** 1.6
            w0, w1 = ring['width']
            width = w0 + (w1 - w0) * rand()
            depth = width * (0.7 + 0.5 * rand())
            base = max(Z_BASE + 1.0, _elevation_to_z(distance, -(PARAPET_DIP_DEG + 1.5)) - 4.0)
            phase = FLOOR_M * rand()
            top = min(Z_CEILING - 1.0 - FLOOR_M, _snap_to_floor(_elevation_to_z(distance, elevation), phase))
            if top < base + 12.0:
                top = _snap_to_floor(base + 12.0 + FLOOR_M, phase)
            turn = grid + (math.radians(45.0) if rand() < 0.2 else 0.0) + math.radians(8.0) * (rand() - 0.5)
            towers.append({
                'x': distance * math.cos(angle), 'y': distance * math.sin(angle), 'angle': turn,
                'width': min(width, 56.0), 'depth': min(depth, 56.0), 'base': base, 'top': top,
                'level': level, 'styles': ring['styles'], 'landmark': landmark, 'phase': phase,
            })
    return towers


def _ridge(geo, radius, elevations, column, seed_offset):
    """Hills as a painted flat: a curtain facing the table, its top a sum of slow waves.

    At seven hundred metres the orbit moves the camera by less than a third of a degree,
    so a curtain and a range of real hills draw the same pixels.
    """
    rand = _lcg(4471 + 97 * seed_offset)
    # Whole cycles round the ring, or the profile jumps where the ring closes.
    waves = [(float(1 + int(5.0 * rand() * (octave + 1))), rand() * 2.0 * math.pi, 0.55 ** octave)
             for octave in range(5)]
    total = sum(amplitude for _, _, amplitude in waves)
    e0, e1 = elevations
    x = RIDGE_TILE[0] * TILE_W + column * (TILE_W // 2) + TILE_W // 4
    hidden = -(PARAPET_DIP_DEG + 3.0)
    bottom = _elevation_to_z(radius, hidden)

    def top_at(angle):
        height = sum(amplitude * (0.5 + 0.5 * math.sin(frequency * angle + phase))
                     for frequency, phase, amplitude in waves) / total
        reach = max(math.exp(-0.5 * (_wrapped(angle - centre) / spread) ** 2) for centre, spread in RIDGE_REACHES)
        # Outside its reaches the ridge sinks below the parapet's sight line and is gone.
        return _elevation_to_z(radius, hidden + (e0 + (e1 - e0) * height - hidden) * min(1.0, reach * 1.6))

    def uv(z):
        return _uv(x, RIDGE_TILE[1] * TILE_H + (z - RIDGE_Z0) * RIDGE_PX_PER_M)

    for index in range(RIDGE_SEGMENTS):
        a0 = 2.0 * math.pi * index / RIDGE_SEGMENTS
        a1 = 2.0 * math.pi * (index + 1) / RIDGE_SEGMENTS
        z0, z1 = top_at(a0), top_at(a1)
        p0 = (radius * math.cos(a0), radius * math.sin(a0))
        p1 = (radius * math.cos(a1), radius * math.sin(a1))
        # Wound to face the centre: the table is the only place it is seen from.
        geo.quad([(p1[0], p1[1], bottom), (p0[0], p0[1], bottom), (p0[0], p0[1], z0), (p1[0], p1[1], z1)],
                 [uv(bottom), uv(bottom), uv(z0), uv(z1)])


def city(seed=20260919):
    """The skyline and its warning lights: (skyline, beacons) as two Geometry objects."""
    rand = _lcg(seed + 1)
    skyline = Geometry()
    beacons = Geometry()
    for spec in layout(seed):
        _tower(skyline, beacons, spec, rand)
    for radius, elevations, column, offset in RIDGES:
        _ridge(skyline, radius, elevations, column, offset)
    return skyline, beacons

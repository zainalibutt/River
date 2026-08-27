import math
from values import (
    FELT_RX,
    FELT_RY,
    TABLE_TOP,
    SEAT_H,
    RAIL_X,
    RAIL_Y,
    RAIL_T,
    CHIP_D,
    CHIP_THICK,
    CHIP_SEG,
    CARD_W,
    CARD_H,
    CARD_TH,
    TABLE_SEG,
    CHAIR_SEG,
    PLANTER_SEG,
)


def box(origin, size):
    x0, y0, z0 = origin
    sx, sy, sz = size
    verts = [
        (x0, y0, z0), (x0 + sx, y0, z0), (x0 + sx, y0 + sy, z0), (x0, y0 + sy, z0),
        (x0, y0, z0 + sz), (x0 + sx, y0, z0 + sz), (x0 + sx, y0 + sy, z0 + sz), (x0, y0 + sy, z0 + sz),
    ]
    faces = [
        (0, 2, 1), (0, 3, 2),
        (4, 5, 6), (4, 6, 7),
        (0, 1, 5), (0, 5, 4),
        (1, 2, 6), (1, 6, 5),
        (2, 3, 7), (2, 7, 6),
        (3, 0, 4), (3, 4, 7),
    ]
    return verts, faces


def ring(rx, ry, z, segments):
    return [
        (rx * math.cos(2.0 * math.pi * i / segments), ry * math.sin(2.0 * math.pi * i / segments), z)
        for i in range(segments)
    ]


def polygon_disc(vertices_ring):
    verts = []
    faces = []
    centre = len(verts)
    verts.append((vertices_ring[0][0], vertices_ring[0][1], vertices_ring[0][2]))
    verts.extend(vertices_ring)
    n = len(vertices_ring)
    for i in range(n):
        a = centre + 1 + i
        b = centre + 1 + (i + 1) % n
        faces.append((centre, a, b))
    return verts, faces


def cylinder(radius, z_top, z_bottom, segments, closed_bottom=True, closed_top=True):
    bottom = ring(radius, radius, z_bottom, segments)
    top = ring(radius, radius, z_top, segments)
    verts = []
    faces = []
    if closed_bottom:
        verts.append((0.0, 0.0, z_bottom))
    base = 1 if closed_bottom else 0
    verts.extend(bottom)
    if closed_bottom:
        for i in range(segments):
            a = base + i
            b = base + (i + 1) % segments
            faces.append((0, b, a))
    side_top = len(verts)
    verts.extend(top)
    for i in range(segments):
        a = base + i
        b = base + (i + 1) % segments
        c = side_top + (i + 1) % segments
        d = side_top + i
        faces.append((a, b, c))
        faces.append((a, c, d))
    if closed_top:
        centre_top = len(verts)
        verts.append((0.0, 0.0, z_top))
        top_base = len(verts)
        verts.extend(top)
        for i in range(segments):
            a = top_base + i
            b = top_base + (i + 1) % segments
            faces.append((centre_top, a, b))
    return verts, faces


def cone(radius_bottom, radius_top, z_top, z_bottom, segments):
    bottom = ring(radius_bottom, radius_bottom, z_bottom, segments)
    top = ring(radius_top, radius_top, z_top, segments)
    verts = []
    faces = []
    verts.append((0.0, 0.0, z_bottom))
    base = 1
    verts.extend(bottom)
    for i in range(segments):
        a = base + i
        b = base + (i + 1) % segments
        faces.append((0, b, a))
    centre_top = len(verts)
    verts.append((0.0, 0.0, z_top))
    top_base = len(verts)
    verts.extend(top)
    for i in range(segments):
        a = base + i
        b = base + (i + 1) % segments
        c = top_base + i
        d = top_base + (i + 1) % segments
        faces.append((a, b, d))
        faces.append((a, d, c))
    for i in range(segments):
        a = top_base + i
        b = top_base + (i + 1) % segments
        faces.append((centre_top, a, b))
    return verts, faces


def sphere(radius, cx, cy, cz, u_seg=8, v_seg=6):
    verts = []
    faces = []
    for i in range(v_seg + 1):
        phi = math.pi * i / v_seg
        for j in range(u_seg + 1):
            theta = 2.0 * math.pi * j / u_seg
            verts.append((
                cx + radius * math.sin(phi) * math.cos(theta),
                cy + radius * math.sin(phi) * math.sin(theta),
                cz + radius * math.cos(phi),
            ))
    for i in range(v_seg):
        for j in range(u_seg):
            a = i * (u_seg + 1) + j
            b = a + 1
            c = a + u_seg + 1
            d = c + 1
            faces.append((a, b, d))
            faces.append((a, d, c))
    return verts, faces


def translate_geo(geo, dx, dy, dz):
    verts, faces = geo
    return [(x + dx, y + dy, z + dz) for (x, y, z) in verts], faces


def transform_geo(geo, dx=0.0, dy=0.0, dz=0.0, angle=0.0):
    cosine = math.cos(angle)
    sine = math.sin(angle)
    vertices = []
    for x, y, z in geo[0]:
        vertices.append((x * cosine - y * sine + dx, x * sine + y * cosine + dy, z + dz))
    return vertices, geo[1]


def concat(geometries):
    verts = []
    faces = []
    for single in geometries:
        v, f = single
        offset = len(verts)
        verts.extend(v)
        faces.extend(tuple(i + offset for i in triple) for triple in f)
    return verts, faces


def felt_oval():
    return polygon_disc(ring(FELT_RX, FELT_RY, TABLE_TOP, TABLE_SEG))


def wood_pedestal():
    top = ring(FELT_RX, FELT_RY, TABLE_TOP, TABLE_SEG)
    mid = ring(FELT_RX * 0.85, FELT_RY * 0.85, TABLE_TOP - 0.35, TABLE_SEG)
    bottom = ring(FELT_RX * 0.95, FELT_RY * 0.95, 0.0, TABLE_SEG)
    verts = []
    faces = []
    base = 0
    verts.extend(top)
    verts.extend(mid)
    for i in range(TABLE_SEG):
        a = base + i
        b = base + (i + 1) % TABLE_SEG
        c = base + TABLE_SEG + i
        d = base + TABLE_SEG + (i + 1) % TABLE_SEG
        faces.append((a, b, d))
        faces.append((b, c, d))
    second = len(verts)
    verts.extend(mid)
    verts.extend(bottom)
    for i in range(TABLE_SEG):
        a = second + i
        b = second + (i + 1) % TABLE_SEG
        c = second + TABLE_SEG + i
        d = second + TABLE_SEG + (i + 1) % TABLE_SEG
        faces.append((a, b, d))
        faces.append((b, c, d))
    centre = len(verts)
    verts.append((0.0, 0.0, 0.0))
    bbase = len(verts)
    verts.extend(bottom)
    for i in range(TABLE_SEG):
        a = bbase + i
        b = bbase + (i + 1) % TABLE_SEG
        faces.append((centre, b, a))
    return verts, faces


def rail_ring_oval():
    verts = []
    faces = []
    ib = ring(RAIL_X, RAIL_Y, TABLE_TOP, TABLE_SEG)
    ob = ring(FELT_RX + 0.05, FELT_RY + 0.05, TABLE_TOP, TABLE_SEG)
    it = ring(RAIL_X, RAIL_Y, TABLE_TOP + RAIL_T, TABLE_SEG)
    ot = ring(FELT_RX + 0.05, FELT_RY + 0.05, TABLE_TOP + RAIL_T, TABLE_SEG)
    verts.extend(ib)
    verts.extend(ob)
    verts.extend(it)
    verts.extend(ot)
    n = TABLE_SEG
    for i in range(n):
        a = i
        b = (i + 1) % n
        c = n + (i + 1) % n
        d = n + i
        faces.append((a, b, c))
        faces.append((a, c, d))
        e = 2 * n + i
        f = 2 * n + (i + 1) % n
        g = 3 * n + (i + 1) % n
        h = 3 * n + i
        faces.append((e, f, g))
        faces.append((e, g, h))
        faces.append((f, h, g))
        faces.append((b, f, e))
    return verts, faces


def chip_face():
    return polygon_disc(ring(CHIP_D / 2.0, CHIP_D / 2.0, CHIP_THICK / 2.0, CHIP_SEG))


def chip_rim():
    verts = []
    faces = []
    bottom = ring(CHIP_D / 2.0, CHIP_D / 2.0, -CHIP_THICK / 2.0, CHIP_SEG)
    top = ring(CHIP_D / 2.0, CHIP_D / 2.0, CHIP_THICK / 2.0, CHIP_SEG)
    verts.extend(bottom)
    verts.extend(top)
    n = CHIP_SEG
    for i in range(n):
        a = i
        b = (i + 1) % n
        c = n + (i + 1) % n
        d = n + i
        faces.append((a, b, c))
        faces.append((a, c, d))
    return verts, faces


def card_body():
    wx = CARD_W / 2.0
    wy = CARD_H / 2.0
    hz = CARD_TH / 2.0
    corners = [
        (-wx, -wy, hz), (wx, -wy, hz), (wx, wy, hz), (-wx, wy, hz),
        (-wx, -wy, -hz), (wx, -wy, -hz), (wx, wy, -hz), (-wx, wy, -hz),
    ]
    faces = [
        (0, 1, 2), (0, 2, 3),
        (4, 6, 5), (4, 7, 6),
        (0, 5, 1), (1, 5, 6),
        (2, 6, 7), (3, 7, 4),
        (3, 4, 0), (4, 5, 0),
    ]
    return corners, faces


def chair_swivel():
    leather = [
        cylinder(0.20, SEAT_H, SEAT_H - 0.08, CHAIR_SEG),
        translate_geo(torus(0.157, 0.014, CHAIR_SEG, 4), 0.0, 0.0, SEAT_H),
        chair_back_shell(),
    ]
    chrome = [
        cylinder(0.033, SEAT_H - 0.08, 0.07, 8),
        cylinder(0.12, 0.07, 0.025, 16),
        translate_geo(torus(0.145, 0.017, 16, 4), 0.0, 0.0, 0.145),
        crown_emblem(),
    ]
    leather_geo = concat(leather)
    chrome_geo = concat(chrome)
    return concat([leather_geo, chrome_geo]), len(leather_geo[1])


def chair_back_shell():
    segments = 12
    levels = [
        (SEAT_H - 0.04, 0.17, 0.17),
        (SEAT_H + 0.04, 0.20, 0.19),
        (SEAT_H + 0.34, 0.19, 0.20),
        (SEAT_H + 0.42, 0.14, 0.21),
    ]
    verts = []
    for z, half_width, centre_y in levels:
        for layer in (0.0, 0.045):
            for index in range(segments + 1):
                fraction = index / segments * 2.0 - 1.0
                x = fraction * half_width
                y = centre_y + abs(fraction) ** 2 * 0.10 + layer
                verts.append((x, y, z))
    faces = []
    row = (segments + 1) * 2
    for level in range(len(levels) - 1):
        current = level * row
        following = (level + 1) * row
        for index in range(segments):
            faces.extend((
                (current + index, following + index, following + index + 1),
                (current + index, following + index + 1, current + index + 1),
                (current + segments + 1 + index + 1, following + segments + 1 + index + 1, following + segments + 1 + index),
                (current + segments + 1 + index + 1, following + segments + 1 + index, current + segments + 1 + index),
            ))
        for index in (0, segments):
            faces.extend((
                (current + index, following + index, following + segments + 1 + index),
                (current + index, following + segments + 1 + index, current + segments + 1 + index),
            ))
    bottom = 0
    top = (len(levels) - 1) * row
    for index in range(segments):
        faces.extend((
            (bottom + index, bottom + index + 1, bottom + segments + 1 + index + 1),
            (bottom + index, bottom + segments + 1 + index + 1, bottom + segments + 1 + index),
            (top + index + 1, top + index, top + segments + 1 + index),
            (top + index + 1, top + segments + 1 + index, top + segments + 1 + index + 1),
        ))
    return verts, faces


def crown_emblem():
    return concat([
        box((-0.052, 0.197, SEAT_H + 0.16), (0.104, 0.018, 0.020)),
        box((-0.044, 0.197, SEAT_H + 0.18), (0.024, 0.018, 0.045)),
        box((-0.012, 0.197, SEAT_H + 0.18), (0.024, 0.018, 0.067)),
        box((0.020, 0.197, SEAT_H + 0.18), (0.024, 0.018, 0.045)),
    ])


def chair_folding():
    parts = [
        box((-0.22, -0.22, 0.0), (0.44, 0.44, SEAT_H + 0.04)),
        box((-0.24, -0.22, SEAT_H), (0.48, 0.44, 0.05)),
        box((-0.22, -0.18, SEAT_H), (0.44, 0.04, 0.5)),
    ]
    return concat(parts)


def chair_dining():
    parts = []
    for origin in [(-0.2, -0.2, 0.0), (0.16, -0.2, 0.0), (-0.2, 0.16, 0.0), (0.16, 0.16, 0.0)]:
        parts.append(box(origin, (0.04, 0.04, SEAT_H)))
    parts.append(box((-0.24, -0.22, SEAT_H), (0.48, 0.44, 0.06)))
    parts.append(box((-0.22, 0.18, SEAT_H + 0.06), (0.44, 0.05, 0.44)))
    return concat(parts)


def planter():
    parts = [
        cylinder(0.2, 0.38, 0.0, PLANTER_SEG),
        cylinder(0.17, 0.42, 0.37, PLANTER_SEG),
    ]
    return concat(parts)


def terrace_disc(radius=4.0, segments=32):
    return polygon_disc(ring(radius, radius, 0.0, segments))


def parapet_ring():
    parts = [
        cylinder(3.9, 1.1, 0.0, 40, closed_bottom=False, closed_top=False),
        cylinder(4.1, 1.12, 1.1, 40, closed_bottom=False, closed_top=False),
    ]
    return concat(parts)


def string_light_run(count=48, radius=3.82):
    """A ring of bulbs around the terrace edge.

    This previously ran a line of eight bulbs from the centre out to x=-6 at
    head height, straight across the table and through the camera orbit, and
    then briefly sat at the spec's 8.40m - which assumes a terrace scaled 1.62x
    that the pipeline does not apply, leaving the strand hanging in open air
    beyond the parapet. It rings just inside the parapet instead.
    """
    parts = []
    for i in range(count):
        angle = 2.0 * math.pi * i / count
        # Swag between posts: bulbs dip midway along each span of six.
        swag = 0.22 * abs(math.sin(math.pi * (i % 6) / 6.0))
        z = 2.62 - swag
        parts.append(
            sphere(0.035, radius * math.cos(angle), radius * math.sin(angle), z, 6, 4)
        )
    return concat(parts)


def machine_unit():
    body = box((0.0, 0.0, 0.0), (0.78, 0.72, 0.88))
    door = box((0.70, 0.14, 0.20), (0.08, 0.44, 0.48))
    control = box((0.12, 0.08, 0.73), (0.52, 0.12, 0.08))
    handle = cylinder(0.018, 0.36, 0.0, 6)
    return concat([body, door, control, transform_geo(handle, 0.77, 0.36, 0.38, math.pi / 2.0)])


def crate_stack():
    parts = []
    for i in range(3):
        parts.append(box((0.0, 0.0, i * 0.35), (0.5, 0.5, 0.35)))
    return concat(parts)


def stepladder():
    parts = [
        box((0.0, 0.0, 0.0), (0.05, 0.4, 1.3)),
        box((0.55, 0.0, 0.0), (0.05, 0.4, 1.3)),
    ]
    for rung_z in (0.4, 0.8, 1.2):
        parts.append(box((0.05, 0.14, rung_z), (0.5, 0.12, 0.04)))
    return concat(parts)


def wall_panel():
    return box((0.0, 0.0, 0.0), (4.0, 0.05, 2.4))


def balustrade():
    parts = [
        box((-1.5, 0.0, 0.9), (3.0, 0.06, 0.06)),
        box((-1.5, 0.06, 0.96), (3.0, 0.03, 0.03)),
    ]
    for x in (-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5):
        parts.append(box((x, 0.0, 0.0), (0.06, 0.08, 0.9)))
    return concat(parts)


def bar_back():
    parts = [
        box((0.0, 0.0, 0.0), (2.0, 0.7, 1.1)),
        box((0.0, 0.5, 1.1), (2.0, 0.35, 0.9)),
    ]
    for x in (0.3, 1.0, 1.7):
        parts.append(cylinder(0.04, 1.5, 1.35, 8))
    return concat(parts)


def wall_sconce():
    parts = [
        box((-0.05, -0.05, 0.0), (0.1, 0.25, 0.45)),
        sphere(0.06, 0.0, 0.05, 0.5, 6, 4),
    ]
    return concat(parts)


def chandelier():
    parts = [
        cylinder(0.02, 0.6, 0.35, 6),
        cylinder(0.02, 0.35, 0.35, 12, closed_bottom=False, closed_top=False),
    ]
    for i in range(6):
        angle = 2.0 * math.pi * i / 6
        parts.append(sphere(0.03, 0.16 * math.cos(angle), 0.16 * math.sin(angle), 0.35, 6, 4))
    return concat(parts)


def checkerboard_plane(width=12.0, depth=9.6):
    half_width = width / 2.0
    half_depth = depth / 2.0
    return [
        (-half_width, -half_depth, 0.0),
        (half_width, -half_depth, 0.0),
        (half_width, half_depth, 0.0),
        (-half_width, half_depth, 0.0),
    ], [(0, 1, 2), (0, 2, 3)]


def room_walls(width, depth, height, thickness=0.12):
    half_width = width / 2.0
    half_depth = depth / 2.0
    return concat([
        box((-half_width, -half_depth, 0.0), (thickness, depth, height)),
        box((half_width - thickness, -half_depth, 0.0), (thickness, depth, height)),
        box((-half_width, -half_depth, 0.0), (width, thickness, height)),
        box((-half_width, half_depth - thickness, 0.0), (width, thickness, height)),
    ])


def ceiling_pipes(count=4, length=11.5, radius=0.055):
    pipes = []
    for index in range(count):
        x = -4.5 + index * 3.0
        pipes.append(transform_geo(cylinder(radius, length, 0.0, 8, closed_bottom=False, closed_top=False), x, -4.55, 3.02, -math.pi / 2.0))
    return concat(pipes)


def basement_counter():
    return concat([
        box((3.9, -2.8, 0.0), (1.5, 5.0, 0.95)),
        box((3.75, -2.8, 0.95), (1.8, 5.0, 0.12)),
        box((3.9, -2.55, 1.07), (1.5, 0.08, 1.15)),
    ])


def laundry_cart():
    return concat([
        box((-0.35, -0.28, 0.55), (0.7, 0.56, 0.06)),
        box((-0.3, -0.23, 0.0), (0.05, 0.05, 0.55)),
        box((0.25, -0.23, 0.0), (0.05, 0.05, 0.55)),
        box((-0.3, 0.18, 0.0), (0.05, 0.05, 0.55)),
        box((0.25, 0.18, 0.0), (0.05, 0.05, 0.55)),
    ])


def suite_baluster():
    return cylinder(0.028, 0.52, 0.0, 8)


def torus(major, minor, major_segments=16, minor_segments=6):
    vertices = []
    faces = []
    for i in range(major_segments):
        major_angle = 2.0 * math.pi * i / major_segments
        for j in range(minor_segments):
            minor_angle = 2.0 * math.pi * j / minor_segments
            radius = major + minor * math.cos(minor_angle)
            vertices.append((radius * math.cos(major_angle), radius * math.sin(major_angle), minor * math.sin(minor_angle)))
    for i in range(major_segments):
        for j in range(minor_segments):
            a = i * minor_segments + j
            b = ((i + 1) % major_segments) * minor_segments + j
            c = ((i + 1) % major_segments) * minor_segments + (j + 1) % minor_segments
            d = i * minor_segments + (j + 1) % minor_segments
            faces.extend(((a, b, c), (a, c, d)))
    return vertices, faces


def suite_scroll():
    return concat([torus(0.12, 0.018, 10, 4), cylinder(0.018, 0.72, 0.52, 6)])


def suite_handrail(radius=5.4, z=1.06):
    return translate_geo(torus(radius, 0.045, 56, 6), 0.0, 0.0, z)


def chandelier_rods(count=34):
    rods = []
    for index in range(count):
        angle = 2.0 * math.pi * index / count
        radius = 0.55 + 0.44 * (index % 5) / 4.0
        rods.append(transform_geo(cylinder(0.012, 0.35, 0.0, 6), radius * math.cos(angle), radius * math.sin(angle), 3.05))
    return concat(rods)


def bar_bottle(count=66):
    bottles = []
    for index in range(count):
        angle = 2.0 * math.pi * index / count
        radius = 7.15 + 0.33 * (index % 4) / 3.0
        height = 1.7 + 1.1 * (index % 6) / 5.0
        bottle = concat([cylinder(0.07, height - 0.16, 0.0, 8), cone(0.07, 0.035, height, height - 0.16, 8)])
        bottles.append(transform_geo(bottle, radius * math.cos(angle), radius * math.sin(angle), 0.0))
    return concat(bottles)


def suite_sconces(count=8, radius=7.7, z=2.35):
    sconces = []
    for index in range(count):
        angle = 2.0 * math.pi * index / count
        sconces.append(transform_geo(wall_sconce(), radius * math.cos(angle), radius * math.sin(angle), z, angle))
    return concat(sconces)


def standing_patron():
    return concat([
        cylinder(0.18, 1.3, 0.0, 8),
        box((-0.24, -0.14, 1.18), (0.48, 0.28, 0.48)),
        sphere(0.14, 0.0, 0.0, 1.72, 8, 5),
    ])

def _lcg(seed):
    """Deterministic pseudo-random source.

    The pipeline must produce the same skyline on every run, so the scatter
    below is seeded rather than drawn from `random`.
    """
    state = seed & 0xFFFFFFFF

    def next_float():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state / float(0x7FFFFFFF)

    return next_float


def skyline_towers(count=27, inner_radius=20.8, outer_radius=45.4, seed=20260824):
    """A ring of towers seen over the parapet, plus their lit windows.

    Returns (mass, windows) as two merged geometries so the whole skyline costs
    two draw calls rather than fifty-four. Bases sit below the parapet line so
    only the upper storeys read, which is what makes them look distant.
    """
    rand = _lcg(seed)
    mass = []
    windows = []
    for index in range(count):
        angle = 2.0 * math.pi * index / count + rand() * 0.06
        radius = inner_radius + (outer_radius - inner_radius) * rand()
        base_z = -5.9 + 3.9 * rand()
        width = 2.4 + 5.2 * rand()
        depth = 2.4 + 4.4 * rand()
        height = 7.0 + 21.0 * rand()
        x = radius * math.cos(angle) - width * 0.5
        y = radius * math.sin(angle) - depth * 0.5
        mass.append(box((x, y, base_z), (width, depth, height)))

        # A stepped setback on the taller towers reads as a skyline rather than
        # a row of slabs.
        if height > 18.0:
            inset = width * 0.22
            mass.append(
                box(
                    (x + inset, y + inset, base_z + height),
                    (width - inset * 2.0, depth - inset * 2.0, 2.0 + 4.0 * rand()),
                )
            )

        rows = int(4 + 9 * rand())
        for row in range(rows):
            wz = base_z + height * (0.25 + 0.68 * (row / max(rows - 1, 1)))
            inward = 1.0 if math.cos(angle) < 0 else -1.0
            wy = y + (depth + 0.06 if inward < 0 else -0.06)
            windows.append(box((x + width * 0.18, wy, wz), (width * 0.64, 0.06, 0.30)))
    return concat(mass), concat(windows)


def mountain_range(count=9, inner_radius=88.0, outer_radius=142.0, seed=770511):
    """Low-poly peaks on the far horizon.

    Deliberately coarse - they sit past 88m and exist to close the horizon, not
    to be looked at.
    """
    rand = _lcg(seed)
    peaks = []
    for index in range(count):
        angle = 2.0 * math.pi * index / count + rand() * 0.18
        radius = inner_radius + (outer_radius - inner_radius) * rand()
        height = 16.0 + 26.0 * rand()
        spread = 22.0 + 26.0 * rand()
        peak = cone(spread, spread * 0.06, height, -8.0, 7)
        peaks.append(
            translate_geo(peak, radius * math.cos(angle), radius * math.sin(angle), 0.0)
        )
    return concat(peaks)


def palm(height=3.0, fronds=7, seed=41):
    rand = _lcg(seed)
    parts = [cylinder(0.075, height, 0.38, 8)]
    for index in range(fronds):
        angle = 2.0 * math.pi * index / fronds + rand() * 0.3
        length = 0.72 + 0.32 * rand()
        droop = -0.24 - 0.18 * rand()
        width = 0.075 + 0.025 * rand()
        forward = (math.cos(angle), math.sin(angle))
        side = (-forward[1], forward[0])
        mid_x = forward[0] * length * 0.52
        mid_y = forward[1] * length * 0.52
        tip_x = forward[0] * length
        tip_y = forward[1] * length
        mid_z = height - 0.07
        tip_z = height + droop
        verts = [
            (0.0, 0.0, height),
            (side[0] * width * 0.45, side[1] * width * 0.45, height - 0.025),
            (mid_x + side[0] * width, mid_y + side[1] * width, mid_z),
            (tip_x, tip_y, tip_z),
            (mid_x - side[0] * width, mid_y - side[1] * width, mid_z),
            (-side[0] * width * 0.45, -side[1] * width * 0.45, height - 0.025),
        ]
        parts.append((verts, [(0, 1, 2), (0, 2, 4), (0, 4, 5), (0, 5, 1), (2, 3, 4)]))
    return concat(parts)


def fire_bowl(radius=0.26, height=0.42):
    """A brazier with a flame sitting in it.

    Returns (bowl, flame) so the two can take different materials: the bowl is
    ordinary metal and only the flame is emissive.
    """
    bowl = concat([
        cone(radius, radius * 0.45, height, 0.0, 12),
        cylinder(radius * 0.16, 0.06, 0.0, 6),
    ])
    flame = sphere(0.15, 0.0, 0.0, height + 0.07, 12, 8)
    return bowl, flame

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


def cylinder(radius, z_top, z_bottom, segments, closed_bottom=True):
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
    parts = []
    parts.append(cylinder(0.03, SEAT_H - 0.02, 0.04, 6))
    for i in range(5):
        angle = 2.0 * math.pi * i / 5
        foot = box((0.18 * math.cos(angle) - 0.02, 0.18 * math.sin(angle) - 0.02, 0.0), (0.05, 0.05, 0.04))
        parts.append(foot)
    parts.append(cylinder(0.24, SEAT_H, SEAT_H - 0.045, CHAIR_SEG))
    parts.append(cylinder(0.21, SEAT_H + 0.5, SEAT_H, CHAIR_SEG))
    return concat(parts)


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
        cone(0.26, 0.04, 0.78, 0.38, PLANTER_SEG),
    ]
    return concat(parts)


def terrace_disc(radius=4.0, segments=32):
    return polygon_disc(ring(radius, radius, 0.0, segments))


def parapet_ring():
    parts = [
        cylinder(3.9, 1.1, 0.0, 40, closed_bottom=False),
        cylinder(4.1, 1.12, 1.1, 40, closed_bottom=False),
    ]
    return concat(parts)


def string_light_run():
    parts = []
    for i in range(8):
        angle = math.pi * i / 7
        x = 3.0 * math.cos(angle) - 3.0
        z = 2.6 + 0.25 * math.sin(angle * 2)
        parts.append(sphere(0.03, x, 0.0, z, 6, 4))
    return concat(parts)


def machine_unit():
    body = box((0.1, 0.1, 0.0), (0.6, 0.6, 0.8))
    door = box((0.56, 0.2, 0.2), (0.1, 0.4, 0.5))
    return concat([body, door])


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
        cylinder(0.02, 0.35, 0.35, 12, closed_bottom=False),
    ]
    for i in range(6):
        angle = 2.0 * math.pi * i / 6
        parts.append(sphere(0.03, 0.16 * math.cos(angle), 0.16 * math.sin(angle), 0.35, 6, 4))
    return concat(parts)


def checkerboard_plane():
    return [(-2.0, -2.0, 0.0), (2.0, -2.0, 0.0), (2.0, 2.0, 0.0), (-2.0, 2.0, 0.0)], [(0, 1, 2), (0, 2, 3)]
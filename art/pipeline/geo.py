import math
from values import (
    FELT_R,
    RAIL_R,
    BODY_R,
    BODY_H,
    RAIL_T,
    CHIP_D,
    CHIP_THICK,
    CHIP_SEG,
    CARD_W,
    CARD_H,
    CARD_TH,
    TABLE_SEG,
)


def ring_points(radius, z, segments):
    return [
        (radius * math.cos(2.0 * math.pi * i / segments),
         radius * math.sin(2.0 * math.pi * i / segments),
         z)
        for i in range(segments)
    ]


def felt_disc():
    verts = []
    faces = []
    centre = len(verts)
    verts.append((0.0, 0.0, 0.0))
    verts.extend(ring_points(FELT_R, 0.0, TABLE_SEG))
    for i in range(TABLE_SEG):
        a = centre + 1 + i
        b = centre + 1 + (i + 1) % TABLE_SEG
        faces.append((centre, a, b))
    return verts, faces


def wood_drum():
    verts = []
    faces = []
    top = []
    bottom = []
    for i in range(TABLE_SEG):
        px = BODY_R * math.cos(2.0 * math.pi * i / TABLE_SEG)
        py = BODY_R * math.sin(2.0 * math.pi * i / TABLE_SEG)
        top.append((px, py, 0.0))
        bottom.append((px, py, -BODY_H))
    base = len(verts)
    verts.extend(top)
    verts.extend(bottom)
    for i in range(TABLE_SEG):
        a = base + i
        b = base + (i + 1) % TABLE_SEG
        c = base + TABLE_SEG + i
        d = base + TABLE_SEG + (i + 1) % TABLE_SEG
        faces.append((a, b, d))
        faces.append((d, c, a))
    return verts, faces


def rail_ring():
    verts = []
    faces = []
    inner_bottom = []
    outer_bottom = []
    inner_top = []
    outer_top = []
    for i in range(TABLE_SEG):
        angle = 2.0 * math.pi * i / TABLE_SEG
        ix = math.cos(angle)
        iy = math.sin(angle)
        inner_bottom.append((FELT_R * ix, FELT_R * iy, 0.0))
        outer_bottom.append((RAIL_R * ix, RAIL_R * iy, 0.0))
        inner_top.append((FELT_R * ix, FELT_R * iy, RAIL_T))
        outer_top.append((RAIL_R * ix, RAIL_R * iy, RAIL_T))
    base = len(verts)
    verts.extend(inner_bottom)
    verts.extend(outer_bottom)
    verts.extend(inner_top)
    verts.extend(outer_top)
    count = TABLE_SEG
    ib = base
    ob = base + count
    it = base + 2 * count
    ot = base + 3 * count
    for i in range(count):
        n = (i + 1) % count
        a = it + i
        b = it + n
        c = ot + n
        d = ot + i
        faces.append((a, b, c))
        faces.append((a, c, d))
        a = ib + i
        b = ib + n
        c = ob + n
        d = ob + i
        faces.append((a, b, c))
        faces.append((a, c, d))
    for i in range(count):
        n = (i + 1) % count
        a = ot + i
        b = ot + n
        c = ob + n
        d = ob + i
        faces.append((a, b, c))
        faces.append((a, c, d))
    return verts, faces


def chip_face():
    verts = []
    faces = []
    centre = len(verts)
    radius = CHIP_D / 2.0
    verts.append((0.0, 0.0, CHIP_THICK / 2.0))
    verts.extend(ring_points(radius, CHIP_THICK / 2.0, CHIP_SEG))
    for i in range(CHIP_SEG):
        a = centre + 1 + i
        b = centre + 1 + (i + 1) % CHIP_SEG
        faces.append((centre, a, b))
    return verts, faces


def chip_rim():
    verts = []
    faces = []
    z_top = CHIP_THICK / 2.0
    z_bot = -CHIP_THICK / 2.0
    top = ring_points(CHIP_D / 2.0, z_top, CHIP_SEG)
    bottom = ring_points(CHIP_D / 2.0, z_bot, CHIP_SEG)
    total = len(verts)
    verts.extend(bottom)
    verts.extend(top)
    for i in range(CHIP_SEG):
        a = total + i
        b = total + (i + 1) % CHIP_SEG
        c = total + CHIP_SEG + i
        d = total + CHIP_SEG + (i + 1) % CHIP_SEG
        faces.append((c, d, b))
        faces.append((a, c, d))
    return verts, faces


def card_body():
    verts = []
    faces = []
    wx = CARD_W / 2.0
    wy = CARD_H / 2.0
    hz = CARD_TH / 2.0
    corners = [
        (-wx, -wy, hz), (wx, -wy, hz), (wx, wy, hz), (-wx, wy, hz),
        (-wx, -wy, -hz), (wx, -wy, -hz), (wx, wy, -hz), (-wx, wy, -hz),
    ]
    base = len(verts)
    verts.extend(corners)
    face = [
        (0, 1, 2), (0, 2, 3), (4, 5, 6), (4, 6, 7),
        (0, 1, 4), (1, 2, 5), (2, 3, 6), (3, 0, 7),
    ]
    for triplet in face:
        faces.append((base + triplet[0], base + triplet[1], base + triplet[2]))
    return verts, faces


def triangle_count(faces):
    return len(faces)
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
    verts.append((0.0, 0.0, vertices_ring[0][2]))
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


def oval_band(inner_rx, inner_ry, outer_rx, outer_ry, z, segments):
    inner = ring(inner_rx, inner_ry, z, segments)
    outer = ring(outer_rx, outer_ry, z, segments)
    verts = inner + outer
    faces = []
    for i in range(segments):
        following = (i + 1) % segments
        faces.append((i, segments + i, segments + following))
        faces.append((i, segments + following, following))
    return verts, faces


def felt_inlay_oval():
    return oval_band(
        FELT_RX * 0.78,
        FELT_RY * 0.68,
        FELT_RX * 0.79,
        FELT_RY * 0.69,
        TABLE_TOP + 0.002,
        TABLE_SEG,
    )


def oval_loft(profiles, segments, close_profile=False, cap_bottom=False, cap_top=False):
    verts = []
    faces = []
    for rx, ry, z in profiles:
        verts.extend(ring(rx, ry, z, segments))
    profile_pairs = len(profiles) if close_profile else len(profiles) - 1
    for level in range(profile_pairs):
        following_level = (level + 1) % len(profiles)
        current = level * segments
        following = following_level * segments
        for i in range(segments):
            next_i = (i + 1) % segments
            a = current + i
            b = current + next_i
            c = following + i
            d = following + next_i
            faces.append((a, b, d))
            faces.append((a, d, c))
    if cap_bottom:
        centre = len(verts)
        verts.append((0.0, 0.0, profiles[0][2]))
        for i in range(segments):
            faces.append((centre, (i + 1) % segments, i))
    if cap_top:
        centre = len(verts)
        top = (len(profiles) - 1) * segments
        verts.append((0.0, 0.0, profiles[-1][2]))
        for i in range(segments):
            faces.append((centre, top + i, top + (i + 1) % segments))
    return verts, faces


def wood_pedestal():
    """The table body, from the felt down to the floor.

    The old body carried the full felt oval almost to the floor, so the gameplay
    camera saw one black wall. The profile now keeps the load-bearing apron,
    narrows into a central stem and opens back into a low foot. Its bands use
    the same oval-loft triangulation as the upholstered rail, so the earlier
    alternating open-facet defect cannot return through a second formula.
    """
    return oval_loft([
        (FELT_RX, FELT_RY, TABLE_TOP),
        (FELT_RX, FELT_RY, TABLE_TOP - 0.08),
        (FELT_RX * 0.86, FELT_RY * 0.86, TABLE_TOP - 0.14),
        (FELT_RX * 0.62, FELT_RY * 0.68, TABLE_TOP - 0.27),
        (FELT_RX * 0.46, FELT_RY * 0.55, 0.18),
        (FELT_RX * 0.68, FELT_RY * 0.72, 0.06),
        (FELT_RX * 0.70, FELT_RY * 0.74, 0.0),
    ], TABLE_SEG, cap_bottom=True)


def rail_ring_oval():
    inner_rx = FELT_RX * 0.985
    inner_ry = FELT_RY * 0.985
    outer_rx = max(RAIL_X, FELT_RX + 0.08)
    outer_ry = max(RAIL_Y, FELT_RY + 0.08)
    return oval_loft([
        (inner_rx, inner_ry, TABLE_TOP - 0.012),
        (inner_rx + 0.018, inner_ry + 0.018, TABLE_TOP + RAIL_T * 0.62),
        (outer_rx - 0.028, outer_ry - 0.028, TABLE_TOP + RAIL_T * 1.05),
        (outer_rx, outer_ry, TABLE_TOP + RAIL_T * 0.58),
        (outer_rx - 0.012, outer_ry - 0.012, TABLE_TOP - 0.018),
    ], TABLE_SEG, close_profile=True)


def _chips_on_edge(centre_x, length, base_z):
    """A column of chips stood on edge in a rack groove: a cylinder along y."""
    verts, faces = cylinder(CHIP_D / 2.0, length / 2.0, -length / 2.0, 12)
    # Swapping y and z turns the column onto its side and mirrors it, so the winding is
    # reversed with it to keep the faces pointing out.
    verts = [(x + centre_x, z, y + base_z + CHIP_D / 2.0) for (x, y, z) in verts]
    faces = [(a, c, b) for (a, b, c) in faces]
    return verts, faces


def dealer_rack(slots=8, chip_run=0.1):
    """The dealer's chip rack: a low tray against the rail with a column of chips on edge
    in each groove. Returns the tray and one column per slot, centred on the origin at felt
    height, long side along x."""
    pitch = CHIP_D + 0.006
    width = slots * pitch + 0.024
    depth = chip_run + 0.022
    height = 0.024
    tray = box((-width / 2.0, -depth / 2.0, TABLE_TOP), (width, depth, height))
    columns = []
    for slot in range(slots):
        centre_x = -width / 2.0 + 0.012 + pitch * (slot + 0.5)
        columns.append(_chips_on_edge(centre_x, chip_run, TABLE_TOP + height - CHIP_D * 0.55))
    return tray, columns


def card_shoe():
    """A shoe: a block whose top slopes down towards the table, where the next card waits."""
    width, depth, back, front = 0.095, 0.17, 0.085, 0.042
    z = TABLE_TOP
    verts = [
        (-width / 2, -depth / 2, z), (width / 2, -depth / 2, z), (width / 2, depth / 2, z), (-width / 2, depth / 2, z),
        (-width / 2, -depth / 2, z + front), (width / 2, -depth / 2, z + front),
        (width / 2, depth / 2, z + back), (-width / 2, depth / 2, z + back),
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


def discard_holder():
    """A shallow holder beside the dealer with the mucked cards in it, face down."""
    tray = box((-0.045, -0.06, TABLE_TOP), (0.09, 0.12, 0.018))
    cards = box((-CARD_W / 2, -CARD_H / 2, TABLE_TOP + 0.018), (CARD_W, CARD_H, 0.014))
    return tray, cards


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


CHAIR_DETAIL = 28


def chair_swivel():
    """The Rooftop's leather swivel chair: a padded seat on a chrome column, a curved shell
    back with channel tufting, and a foot ring.

    Detailed without moving anything the seated players depend on. The seat's top is still
    SEAT_H, the back shell's front face is where it was at its centre - the channels are
    recessed into it, never raised toward the person sitting against it - and the foot ring
    keeps its height and radius. The ring was floating; it now has spokes to the column.
    """
    leather = [
        oval_loft([
            (0.18, 0.17, SEAT_H - 0.095),
            (0.212, 0.198, SEAT_H - 0.08),
            (0.228, 0.212, SEAT_H - 0.055),
            (0.233, 0.217, SEAT_H - 0.03),
            (0.229, 0.213, SEAT_H - 0.012),
            (0.218, 0.203, SEAT_H - 0.003),
            (0.2, 0.186, SEAT_H),
        ], CHAIR_DETAIL, cap_bottom=True, cap_top=True),
        translate_geo(torus(0.232, 0.008, CHAIR_DETAIL, 6), 0.0, 0.0, SEAT_H - 0.03),
        chair_back_shell(),
    ]
    ring_z, ring_radius = 0.145, 0.145
    chrome = [
        cylinder(0.03, SEAT_H - 0.1, 0.08, 16),
        cone(0.052, 0.034, SEAT_H - 0.095, SEAT_H - 0.16, 16),
        cone(0.165, 0.13, 0.035, 0.0, 32),
        cone(0.13, 0.04, 0.085, 0.035, 32),
        translate_geo(torus(ring_radius, 0.017, 24, 6), 0.0, 0.0, ring_z),
        crown_emblem(),
    ]
    for index in range(3):
        angle = 2.0 * math.pi * index / 3 + math.pi / 2.0
        chrome.append(_tube([(0.028 * math.cos(angle), 0.028 * math.sin(angle), ring_z),
                             (ring_radius * math.cos(angle), ring_radius * math.sin(angle), ring_z)], 0.008, 5))
    leather_geo = concat(leather)
    chrome_geo = concat(chrome)
    return concat([leather_geo, chrome_geo]), len(leather_geo[1])


def _catmull(p0, p1, p2, p3, t):
    return tuple(0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t * t
                        + (3.0 * b - a - 3.0 * c + d) * t * t * t)
                 for a, b, c, d in zip(p0, p1, p2, p3))


def chair_back_shell(segments=24, channels=5):
    """The curved shell back: its five measured sections, with a smoothed one between each
    pair, a front face tufted in vertical channels and a piped top edge."""
    measured = [
        (SEAT_H - 0.04, 0.18, 0.17),
        (SEAT_H + 0.05, 0.225, 0.18),
        (SEAT_H + 0.28, 0.235, 0.19),
        (SEAT_H + 0.40, 0.205, 0.20),
        (SEAT_H + 0.46, 0.145, 0.21),
    ]
    levels = []
    for index in range(len(measured) - 1):
        before = measured[max(index - 1, 0)]
        after = measured[min(index + 2, len(measured) - 1)]
        levels.append(measured[index])
        levels.append(_catmull(before, measured[index], measured[index + 1], after, 0.5))
    levels.append(measured[-1])

    def front_y(centre_y, fraction):
        groove = 0.006 * (0.5 - 0.5 * math.cos(2.0 * math.pi * channels * fraction))
        return centre_y + abs(fraction) ** 2 * 0.10 + groove

    verts = []
    for z, half_width, centre_y in levels:
        for layer in (0.0, 0.055):
            for index in range(segments + 1):
                fraction = index / segments * 2.0 - 1.0
                y = front_y(centre_y, fraction) if layer == 0.0 else centre_y + abs(fraction) ** 2 * 0.10 + layer
                verts.append((fraction * half_width, y, z))
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
    z, half_width, centre_y = levels[-1]
    piping = [(fraction * half_width, front_y(centre_y, fraction) + 0.012, z)
              for fraction in (index / segments * 2.0 - 1.0 for index in range(segments + 1))]
    return concat([(verts, faces), _tube(piping, 0.009, 5)])


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


def _band(r_bottom, r_top, z_bottom, z_top, segments, inward=False, start=0.0):
    """An open ring of quads between two circles: a wall, a lip, a section of trunk. It faces
    outward unless `inward`, which is what a wall seen from inside its ring wants."""
    verts = []
    faces = []
    for i in range(segments):
        a = start + 2.0 * math.pi * i / segments
        verts.append((r_bottom * math.cos(a), r_bottom * math.sin(a), z_bottom))
        verts.append((r_top * math.cos(a), r_top * math.sin(a), z_top))
    for i in range(segments):
        b0, t0 = 2 * i, 2 * i + 1
        b1, t1 = 2 * ((i + 1) % segments), 2 * ((i + 1) % segments) + 1
        if inward:
            faces += [(b0, t1, b1), (b0, t0, t1)]
        else:
            faces += [(b0, b1, t1), (b0, t1, t0)]
    return verts, faces


def _annulus(r_inner, r_outer, z, segments, down=False, start=0.0):
    """A flat ring facing up, or down."""
    verts = []
    faces = []
    for i in range(segments):
        a = start + 2.0 * math.pi * i / segments
        verts.append((r_inner * math.cos(a), r_inner * math.sin(a), z))
        verts.append((r_outer * math.cos(a), r_outer * math.sin(a), z))
    for i in range(segments):
        i0, o0 = 2 * i, 2 * i + 1
        i1, o1 = 2 * ((i + 1) % segments), 2 * ((i + 1) % segments) + 1
        if down:
            faces += [(i0, o1, o0), (i0, i1, o1)]
        else:
            faces += [(i0, o0, o1), (i0, o1, i1)]
    return verts, faces


def _tube(points, radius, sides=3):
    """A thin tube along a polyline: a cable, a wire."""
    verts = []
    faces = []
    for (ax, ay, az), (bx, by, bz) in zip(points, points[1:]):
        dx, dy, dz = bx - ax, by - ay, bz - az
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length < 1e-6:
            continue
        dx, dy, dz = dx / length, dy / length, dz / length
        # A side vector square to the run, and a second square to both.
        ux, uy, uz = dy, -dx, 0.0
        norm = math.hypot(ux, uy)
        if norm < 1e-6:
            ux, uy, uz, norm = 1.0, 0.0, 0.0, 1.0
        ux, uy = ux / norm, uy / norm
        wx, wy, wz = dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux
        base = len(verts)
        for end in ((ax, ay, az), (bx, by, bz)):
            for side in range(sides):
                theta = 2.0 * math.pi * side / sides
                c, s = math.cos(theta) * radius, math.sin(theta) * radius
                verts.append((end[0] + ux * c + wx * s, end[1] + uy * c + wy * s, end[2] + uz * c + wz * s))
        for side in range(sides):
            a0, a1 = base + side, base + (side + 1) % sides
            b0, b1 = a0 + sides, a1 + sides
            faces += [(a0, a1, b1), (a0, b1, b0)]
    return verts, faces


def planter(width=0.46, foot=0.36, height=0.52):
    """A square concrete pot, tapered, with a rim and the soil line inside it.

    It was a drum a hand's width taller than the floor, which from the table read as a
    bollard with a pole in it. Built with a flat face to the table when turned to it.
    """
    corner = math.pi / 4.0
    half_top = width / math.sqrt(2.0)
    half_foot = foot / math.sqrt(2.0)
    rim = 0.035
    lip = half_top + 0.02
    return concat([
        _band(half_foot, half_top, 0.0, height - rim, 4, start=corner),
        _band(lip, lip, height - rim, height, 4, start=corner),
        _annulus(half_top - 0.03, lip, height, 4, start=corner),
        _band(half_top - 0.03, half_top - 0.03, height - 0.06, height, 4, inward=True, start=corner),
        polygon_disc([((half_top - 0.03) * math.cos(corner + k * math.pi / 2.0),
                       (half_top - 0.03) * math.sin(corner + k * math.pi / 2.0), height - 0.06) for k in range(4)]),
    ])


def terrace_disc(radius=4.0, segments=32):
    return polygon_disc(ring(radius, radius, 0.0, segments))


def terrace_inlay():
    return concat([
        oval_band(2.46, 2.46, 2.48, 2.48, 0.004, 48),
        oval_band(3.38, 3.38, 3.40, 3.40, 0.004, 56),
    ])


# The terrace is 7.5m across the radius since the room became a place rather than a disc -
# see build_rooftop. The parapet stands at its edge.
PARAPET_INNER = 7.4
PARAPET_OUTER = 7.6
# The seated camera's sight line over the parapet is measured to this height - see skyline.py.
PARAPET_TOP = 1.12
COPING_DEPTH = 0.06
COPING_OVERHANG = 0.04
PARAPET_SEGMENTS = 128


def parapet_ring():
    """The wall under the coping: its inner face.

    Plain on purpose. Ribs every thirty degrees gave it a rhythm in a close review frame, but
    at the table the lit wall turned them into a dark post behind every chair, cutting through
    the silhouettes of the people sitting in front of it. The coping and the strip light
    under it carry the wall instead.
    """
    return _band(PARAPET_INNER, PARAPET_INNER, 0.0, PARAPET_TOP - COPING_DEPTH, PARAPET_SEGMENTS, inward=True)


def parapet_coping():
    """The stone cap: a flat top overhanging both faces, and the underside of its inner lip,
    where the strip light hides."""
    inner = PARAPET_INNER - COPING_OVERHANG
    outer = PARAPET_OUTER + COPING_OVERHANG
    low = PARAPET_TOP - COPING_DEPTH
    return concat([
        _annulus(inner, outer, PARAPET_TOP, PARAPET_SEGMENTS),
        _band(inner, inner, low, PARAPET_TOP, PARAPET_SEGMENTS, inward=True),
        _band(outer, outer, low, PARAPET_TOP, PARAPET_SEGMENTS),
        _annulus(inner, PARAPET_INNER, low, PARAPET_SEGMENTS, down=True),
    ])


def parapet_lit_band(height=0.025, inset=0.004):
    """The strip light tucked under the coping's inner lip, built at its own size.

    It was the parapet ring itself, squashed to five centimetres by its node's scale. That
    draws the same, but anything reading the mesh rather than the scene measures a 1.1m
    wall: the palette gate did, and found a lit wall the size of the parapet beside it.
    """
    top = PARAPET_TOP - COPING_DEPTH
    radius = PARAPET_INNER - inset
    return _band(radius, radius, top - height, top, PARAPET_SEGMENTS, inward=True)


def festoon(count=96, spans=16, radius=7.3, post_radius=7.45, post_top=2.9, hang=2.78, sag=0.28,
            turn=math.pi / 16.0):
    """Festoon lighting: bulbs on a sagging wire between posts on the parapet.

    Returns (bulbs, rig) so the bulbs can glow and the posts and wire stay dark metal.

    The bulbs were a ring of spheres at head height with nothing holding them up, and read as
    dots floating in the sky. The ring is turned half a span so that no post stands among the
    palms, which grow on the diagonals, and it hangs along the parapet, far outside the
    camera's orbit.
    """
    per_span = count // spans
    bulbs = []
    rig = []
    wire = []
    for span in range(spans):
        post_angle = turn + 2.0 * math.pi * span / spans
        px, py = post_radius * math.cos(post_angle), post_radius * math.sin(post_angle)
        rig.append(translate_geo(cylinder(0.022, post_top, PARAPET_TOP, 6, closed_bottom=False), px, py, 0.0))
        wire.append((px, py, post_top - 0.03))
        for step in range(per_span):
            angle = turn + 2.0 * math.pi * (span * per_span + step) / count
            z = hang - sag * math.sin(math.pi * step / per_span)
            x, y = radius * math.cos(angle), radius * math.sin(angle)
            wire.append((x, y, z))
            bulbs.append(sphere(0.042, x, y, z - 0.05, 6, 4))
    wire.append(wire[0])
    rig.append(_tube(wire, 0.005))
    return concat(bulbs), concat(rig)


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

    The pipeline must produce the same venue on every run, so every scatter -
    the palms here, the city in skyline.py - is seeded rather than drawn from
    `random`.
    """
    state = seed & 0xFFFFFFFF

    def next_float():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state / float(0x7FFFFFFF)

    return next_float


def fire_bowl(radius=0.26, height=0.42):
    """A brazier with a flame sitting in it.

    Returns (bowl, flame) so the two can take different materials: the bowl is
    ordinary metal and only the flame is emissive.
    """
    bowl = concat([
        cone(radius, radius * 0.45, height, 0.0, 12),
        cylinder(radius * 0.16, 0.06, 0.0, 6),
    ])
    # A tapered flame rising out of the bowl, not a ball hovering over it.
    #
    # This was a sphere of radius 0.15 centred 0.07 ABOVE the bowl's rim, so it
    # touched nothing. That is invisible in a lit render and unmistakable at
    # dusk: the flame is emissive and the bowl is dark metal against a dark
    # parapet, so the bowl disappears and the sphere reads as an orange ball
    # floating over the terrace. It survived in the menu backdrop for days.
    #
    # Sinking it means the bowl always occludes the base, so the two read as one
    # object whatever the lighting does.
    #
    # It stays a sphere rather than becoming a tapered cone. A cone was tried and
    # the brazier went dark: the emissive area is what carries a small light at
    # this distance, and a slender flame has about a third of it, so the fix for a
    # ball that floated was a bowl with no fire in it. The shape was never the
    # problem - the height was.
    flame = sphere(0.15, 0.0, 0.0, height - 0.02, 12, 8)
    return bowl, flame

"""The Rooftop's set pieces: the things that make the terrace a place rather than a disc.

A shot-composition study measured a genre reference's rooftop - a bar with a
bartender, statues, fire running along a pool, pendant ring lights, a second table - against
River's disc, parapet, palms and braziers, and named the gap the largest in the room. The
terrace grew to make space for them: see TERRACE_RADIUS in build_assets.py.

Each function returns plain geometry (verts, faces) in metres, built where it stands in the
venue so that build_assets.py only has to give it a material. Nothing here imports bpy.
"""
import math

from geo import _lcg, box, concat, cone, cylinder, polygon_disc, sphere, transform_geo, translate_geo


def _quad(verts, faces, a, b, c, d):
    base = len(verts)
    verts.extend((a, b, c, d))
    faces.extend(((base, base + 1, base + 2), (base, base + 2, base + 3)))


def _rectangle_ring(x0, y0, x1, y1, inset, z):
    """The flat rim of a rectangle: the outer box less an inner one `inset` smaller, facing up."""
    verts, faces = [], []
    ix0, iy0, ix1, iy1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    _quad(verts, faces, (x0, y0, z), (x1, y0, z), (ix1, iy0, z), (ix0, iy0, z))
    _quad(verts, faces, (x1, y0, z), (x1, y1, z), (ix1, iy1, z), (ix1, iy0, z))
    _quad(verts, faces, (x1, y1, z), (x0, y1, z), (ix0, iy1, z), (ix1, iy1, z))
    _quad(verts, faces, (x0, y1, z), (x0, y0, z), (ix0, iy0, z), (ix0, iy1, z))
    return verts, faces


def _walls(x0, y0, x1, y1, z0, z1, inward=False):
    """Four vertical walls round a rectangle, facing out unless `inward`."""
    verts, faces = [], []
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for index in range(4):
        (ax, ay), (bx, by) = corners[index], corners[(index + 1) % 4]
        if inward:
            _quad(verts, faces, (bx, by, z0), (ax, ay, z0), (ax, ay, z1), (bx, by, z1))
        else:
            _quad(verts, faces, (ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1))
    return verts, faces


def raised_pool(x0, y0, x1, y1, height=0.5, rim=0.22, water_drop=0.06):
    """A raised stone pool: outer walls, a flat rim and inner walls down to the water.

    Returns (stone, water). The water sits just under the rim so a seated player, looking
    across the table at it from nine metres, sees a lit strip of it over the edge.
    """
    water_z = height - water_drop
    stone = concat([
        _walls(x0, y0, x1, y1, 0.0, height),
        _rectangle_ring(x0, y0, x1, y1, rim, height),
        _walls(x0 + rim, y0 + rim, x1 - rim, y1 - rim, water_z - 0.02, height, inward=True),
    ])
    verts, faces = [], []
    _quad(verts, faces, (x0 + rim, y0 + rim, water_z), (x1 - rim, y0 + rim, water_z),
          (x1 - rim, y1 - rim, water_z), (x0 + rim, y1 - rim, water_z))
    return stone, (verts, faces)


def fire_run(x0, x1, y, depth=0.24, height=0.3, seed=7):
    """A linear fire trough: a low stone trough, a glowing bed of embers along its top, and a
    row of flame tongues standing in it at varied heights and turns.

    Returns (trough, bed, flames), so the bed can burn hotter than the flames. The bed
    carries the fire at distance - a flame's emissive area is what reads at nine metres - and
    the flames are two curtains along the run whose tops lick up and fall, as a gas run
    burns. Separate tongues were tried first: tall, they stood behind the table like a row of
    cut-card spikes; short, they still read as a sawtooth from the front door's camera.
    """
    rand = _lcg(seed)
    y0, y1 = y - depth / 2.0, y + depth / 2.0
    trough = concat([
        _walls(x0, y0, x1, y1, 0.0, height),
        _rectangle_ring(x0, y0, x1, y1, 0.04, height),
        _walls(x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.04, height - 0.05, height, inward=True),
    ])
    verts, faces = [], []
    bed = height - 0.04
    _quad(verts, faces, (x0 + 0.04, y0 + 0.04, bed), (x1 - 0.04, y0 + 0.04, bed),
          (x1 - 0.04, y1 - 0.04, bed), (x0 + 0.04, y1 - 0.04, bed))
    flames = [_flame_curtain(x0 + 0.06, x1 - 0.06, y + offset, bed, rand) for offset in (-0.035, 0.035)]
    return trough, (verts, faces), concat(flames)


def _flame_curtain(x0, x1, y, z, rand, segments=140):
    """A sheet of flame along a run, its top a sum of slow and quick waves so that it licks
    up in tongues and falls between them, tapering to nothing at both ends."""
    waves = [(2.0 + 3.0 * rand(), rand() * 6.3, 0.05), (9.0 + 5.0 * rand(), rand() * 6.3, 0.045),
             (23.0 + 9.0 * rand(), rand() * 6.3, 0.03)]
    verts, faces = [], []
    for step in range(segments + 1):
        x = x0 + (x1 - x0) * step / segments
        taper = min(1.0, (x - x0) / 0.25, (x1 - x) / 0.25)
        height = 0.1 + sum(depth * math.sin(rate * x + phase) for rate, phase, depth in waves)
        verts += [(x, y, z), (x, y, z + max(0.02, height) * taper)]
    for step in range(segments):
        a, b = 2 * step, 2 * step + 1
        faces += [(a, a + 2, a + 3), (a, a + 3, b)]
    return verts, faces


def plinth(x, y, width=0.55, height=0.9):
    """A stone plinth, square, with a thin cap."""
    return concat([
        box((x - width / 2.0, y - width / 2.0, 0.0), (width, width, height - 0.04)),
        box((x - width / 2.0 - 0.03, y - width / 2.0 - 0.03, height - 0.04), (width + 0.06, width + 0.06, 0.04)),
    ])


def standing_figure(x, y, z, height=1.55, facing=0.0, seed=3):
    """An elongated standing figure in bronze - long thin legs and arms, a narrow torso and a
    small head - of the kind that reads as sculpture rather than as a person at a glance."""
    rand = _lcg(seed)
    parts = []
    leg = height * 0.5
    torso = height * 0.34
    stance = 0.07
    for side in (-1.0, 1.0):
        parts.append(translate_geo(cone(0.045, 0.03, leg, 0.0, 6), side * stance, 0.0, 0.0))
        parts.append(translate_geo(cone(0.028, 0.02, leg + torso * 0.95, leg + torso * 0.2, 6),
                                   side * (0.13 + 0.02 * rand()), 0.0, 0.0))
    parts.append(translate_geo(cone(0.1, 0.065, leg + torso, leg - 0.02, 7), 0.0, 0.0, 0.0))
    parts.append(cylinder(0.025, leg + torso + 0.07, leg + torso - 0.01, 6))
    parts.append(sphere(0.065, 0.0, 0.0, leg + torso + 0.12, 8, 6))
    return transform_geo(concat(parts), x, y, z, facing)


def ring_sculpture(x, y, z, radius=0.55, thickness=0.07, facing=0.0, segments=36, sides=10):
    """A bronze ring standing on its edge, which frames a piece of the skyline through it."""
    verts, faces = [], []
    for i in range(segments):
        a = 2.0 * math.pi * i / segments
        for j in range(sides):
            b = 2.0 * math.pi * j / sides
            reach = radius + thickness * math.cos(b)
            verts.append((reach * math.cos(a), thickness * math.sin(b), radius + thickness + reach * math.sin(a)))
    for i in range(segments):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            c = ((i + 1) % segments) * sides + (j + 1) % sides
            d = ((i + 1) % segments) * sides + j
            faces += [(a, b, c), (a, c, d)]
    foot = box((-0.12, -0.06, 0.0), (0.24, 0.12, thickness))
    return transform_geo(concat([(verts, faces), foot]), x, y, z, facing)


# --- the bar ---------------------------------------------------------------------------


def _arc_points(radius, a0, a1, segments):
    return [(radius * math.cos(a0 + (a1 - a0) * i / segments), radius * math.sin(a0 + (a1 - a0) * i / segments))
            for i in range(segments + 1)]


def _arc_solid(r_inner, r_outer, a0, a1, z0, z1, segments):
    """A curved slab between two radii and two heights: inner and outer faces, top, bottom
    and both ends. Used for the counter, its top and the back bar's shelves."""
    verts, faces = [], []
    inner = _arc_points(r_inner, a0, a1, segments)
    outer = _arc_points(r_outer, a0, a1, segments)
    for i in range(segments):
        (ix0, iy0), (ix1, iy1) = inner[i], inner[i + 1]
        (ox0, oy0), (ox1, oy1) = outer[i], outer[i + 1]
        _quad(verts, faces, (ix1, iy1, z0), (ix0, iy0, z0), (ix0, iy0, z1), (ix1, iy1, z1))
        _quad(verts, faces, (ox0, oy0, z0), (ox1, oy1, z0), (ox1, oy1, z1), (ox0, oy0, z1))
        _quad(verts, faces, (ix0, iy0, z1), (ox0, oy0, z1), (ox1, oy1, z1), (ix1, iy1, z1))
        _quad(verts, faces, (ix0, iy0, z0), (ix1, iy1, z0), (ox1, oy1, z0), (ox0, oy0, z0))
    for (ix, iy), (ox, oy), flip in ((inner[0], outer[0], False), (inner[-1], outer[-1], True)):
        if flip:
            _quad(verts, faces, (ix, iy, z0), (ox, oy, z0), (ox, oy, z1), (ix, iy, z1))
        else:
            _quad(verts, faces, (ox, oy, z0), (ix, iy, z0), (ix, iy, z1), (ox, oy, z1))
    return verts, faces


def bar_counter(r_front, r_back, a0, a1, height=1.08, segments=24):
    """A curved bar counter: the wooden body, a stone top overhanging the customers' side, and
    a strip of light under that overhang.

    Returns (body, top, strip)."""
    body = _arc_solid(r_front + 0.04, r_back, a0, a1, 0.0, height - 0.05, segments)
    top = _arc_solid(r_front - 0.06, r_back + 0.02, a0 - 0.004, a1 + 0.004, height - 0.05, height, segments)
    strip = _arc_solid(r_front + 0.035, r_front + 0.05, a0 + 0.01, a1 - 0.01, height - 0.09, height - 0.06, segments)
    return body, top, strip


def back_bar(r_front, r_back, a0, a1, height=2.1, shelves=(0.95, 1.35, 1.75), segments=24, seed=17):
    """The back bar against the parapet: a lit panel, shelves across it and bottles standing on
    them as silhouettes against the light - which is how a bar reads from across a room at night.

    Returns (frame, glow, bottles)."""
    rand = _lcg(seed)
    frame = [
        _arc_solid(r_front + 0.02, r_back, a0, a1, 0.0, 0.9, segments),
        _arc_solid(r_front, r_back, a0 - 0.012, a1 + 0.012, height, height + 0.06, segments),
    ]
    for side in (a0 - 0.012, a1):
        frame.append(_arc_solid(r_front, r_back, side, side + 0.012, 0.0, height + 0.06, 1))
    for z in shelves:
        frame.append(_arc_solid(r_front, r_back - 0.02, a0, a1, z - 0.025, z, segments))
    glow = _arc_solid(r_back - 0.03, r_back - 0.01, a0, a1, 0.9, height, segments)
    bottles = []
    for z in shelves:
        a = a0 + 0.01
        while a < a1 - 0.012:
            r = (r_front + r_back) / 2.0 - 0.02
            x, y = r * math.cos(a), r * math.sin(a)
            tall = 0.2 + 0.14 * rand()
            width = 0.032 + 0.018 * rand()
            # Five sides is plenty for a silhouette against a lit panel nine metres away.
            bottles.append(translate_geo(cylinder(width, tall * 0.62, 0.0, 5, closed_bottom=False), x, y, z))
            bottles.append(translate_geo(cone(width, width * 0.35, tall * 0.8, tall * 0.62, 5), x, y, z))
            bottles.append(translate_geo(cylinder(width * 0.35, tall, tall * 0.8, 5, closed_bottom=False), x, y, z))
            a += (0.08 + 0.1 * rand()) / r
    return concat(frame), glow, concat(bottles)


def bar_stool(x, y, facing=0.0, seat_height=0.76):
    """A bar stool: a round padded seat on a chrome column, with a foot ring at the height a
    seated foot actually rests.

    Returns (seat, chrome)."""
    seat = concat([
        cylinder(0.2, seat_height + 0.07, seat_height, 16),
        cylinder(0.17, seat_height, seat_height - 0.03, 16),
    ])
    chrome = [
        cylinder(0.03, seat_height - 0.03, 0.05, 8),
        cylinder(0.22, 0.03, 0.0, 16),
    ]
    ring_z = 0.3
    for i in range(12):
        a0 = 2.0 * math.pi * i / 12
        a1 = 2.0 * math.pi * (i + 1) / 12
        p0 = (0.18 * math.cos(a0), 0.18 * math.sin(a0), ring_z)
        p1 = (0.18 * math.cos(a1), 0.18 * math.sin(a1), ring_z)
        chrome.append(_rod(p0, p1, 0.012))
    for i in range(3):
        a = 2.0 * math.pi * i / 3 + 0.3
        chrome.append(_rod((0.03 * math.cos(a), 0.03 * math.sin(a), ring_z),
                           (0.18 * math.cos(a), 0.18 * math.sin(a), ring_z), 0.01))
    return transform_geo(seat, x, y, 0.0, facing), transform_geo(concat(chrome), x, y, 0.0, facing)


def _rod(a, b, radius, sides=5):
    """A straight round bar between two points."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    dx, dy, dz = dx / length, dy / length, dz / length
    ux, uy, uz = dy, -dx, 0.0
    norm = math.hypot(ux, uy)
    if norm < 1e-6:
        ux, uy, uz, norm = 1.0, 0.0, 0.0, 1.0
    ux, uy = ux / norm, uy / norm
    wx, wy, wz = dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux
    verts, faces = [], []
    for end in (a, b):
        for side in range(sides):
            t = 2.0 * math.pi * side / sides
            c, s = math.cos(t) * radius, math.sin(t) * radius
            verts.append((end[0] + ux * c + wx * s, end[1] + uy * c + wy * s, end[2] + uz * c + wz * s))
    for side in range(sides):
        p, q = side, (side + 1) % sides
        faces += [(p, q, q + sides), (p, q + sides, p + sides)]
    return verts, faces


def pergola(radius, a0, a1, height=2.95, segments=24):
    """A dark steel beam curving over the bar on two posts, for the pendants to hang from."""
    return concat([
        _arc_solid(radius - 0.05, radius + 0.05, a0, a1, height - 0.12, height, segments),
        translate_geo(box((-0.05, -0.05, 0.0), (0.1, 0.1, height - 0.12)), radius * math.cos(a0), radius * math.sin(a0), 0.0),
        translate_geo(box((-0.05, -0.05, 0.0), (0.1, 0.1, height - 0.12)), radius * math.cos(a1), radius * math.sin(a1), 0.0),
    ])


def ring_pendant(x, y, z, beam_z, radius=0.34, thickness=0.028, segments=28, sides=6):
    """A glowing ring hung level on a cable: the reference's pendant ring light.

    Returns (ring, cable)."""
    verts, faces = [], []
    for i in range(segments):
        a = 2.0 * math.pi * i / segments
        for j in range(sides):
            b = 2.0 * math.pi * j / sides
            reach = radius + thickness * math.cos(b)
            verts.append((x + reach * math.cos(a), y + reach * math.sin(a), z + thickness * math.sin(b)))
    for i in range(segments):
        for j in range(sides):
            p = i * sides + j
            q = i * sides + (j + 1) % sides
            r = ((i + 1) % segments) * sides + (j + 1) % sides
            s = ((i + 1) % segments) * sides + j
            faces += [(p, q, r), (p, r, s)]
    cables = concat([_rod((x + radius * math.cos(a), y + radius * math.sin(a), z), (x, y, beam_z), 0.004, 3)
                     for a in (0.0, 2.0 * math.pi / 3.0, 4.0 * math.pi / 3.0)])
    return (verts, faces), cables


# --- the lounge ------------------------------------------------------------------------


def _pillow(x, y, z, facing, width=0.36, height=0.3, thickness=0.12):
    """A throw pillow leaning back: a squashed, slightly lumpy ball."""
    verts, faces = sphere(1.0, 0.0, 0.0, 0.0, 10, 7)
    shaped = [(px * width / 2.0, py * thickness / 2.0, pz * height / 2.0) for px, py, pz in verts]
    return transform_geo((shaped, faces), x, y, z, facing)


def banquette(r_front, r_back, a0, a1, cushions=4, seat=0.42, segments=6):
    """A curved banquette along the parapet: a dark plinth, separate seat and back cushions
    with softened tops, rolled arms and a few throw pillows.

    Returns (upholstery, plinth). It was one slab in the fabric, which read as a big rectangle."""
    upholstery = []
    gap = 0.012
    span = (a1 - a0) / cushions
    mid_seat = r_back - 0.2
    for index in range(cushions):
        c0 = a0 + index * span + gap / 2.0
        c1 = c0 + span - gap
        upholstery.append(_arc_solid(r_front, mid_seat, c0, c1, 0.14, seat - 0.035, segments))
        upholstery.append(_arc_solid(r_front + 0.025, mid_seat - 0.02, c0 + 0.006, c1 - 0.006, seat - 0.035, seat,
                                     segments))
        upholstery.append(_arc_solid(mid_seat, r_back - 0.06, c0, c1, seat, seat + 0.34, segments))
        upholstery.append(_arc_solid(mid_seat + 0.02, r_back - 0.08, c0 + 0.006, c1 - 0.006, seat + 0.34,
                                     seat + 0.38, segments))
    upholstery.append(_arc_solid(r_back - 0.06, r_back, a0 - 0.04, a1 + 0.04, 0.14, seat + 0.44, cushions * segments))
    for side, (s0, s1) in enumerate(((a0 - 0.04, a0), (a1, a1 + 0.04))):
        upholstery.append(_arc_solid(r_front, r_back - 0.06, s0, s1, 0.14, seat + 0.16, 2))
        upholstery.append(_arc_solid(r_front + 0.01, r_back - 0.07, s0 + 0.004, s1 - 0.004, seat + 0.16,
                                     seat + 0.2, 2))
    for index, fraction in enumerate((0.12, 0.36, 0.63, 0.88)):
        angle = a0 + (a1 - a0) * fraction
        r = mid_seat + 0.02
        upholstery.append(_pillow(r * math.cos(angle), r * math.sin(angle), seat + 0.17,
                                  angle + math.pi / 2.0 + (0.18 if index % 2 else -0.14)))
    plinth = _arc_solid(r_front + 0.03, r_back, a0 - 0.04, a1 + 0.04, 0.0, 0.14, cushions * segments)
    return concat(upholstery), plinth


def low_table(x, y, radius=0.36, height=0.4):
    """A low round table: a stone top on a dark drum. Returns (top, base)."""
    top = translate_geo(cylinder(radius, height, height - 0.04, 24), x, y, 0.0)
    base = translate_geo(cylinder(radius * 0.55, height - 0.04, 0.0, 16, closed_bottom=False), x, y, 0.0)
    return top, base


def armchair(x, y, facing, seat=0.42):
    """A club chair: a tub back that wraps round into its arms, a thick round seat cushion and
    four short legs, facing `facing` (the way a sitter looks).

    Returns (upholstery, legs)."""
    wrap0, wrap1 = math.radians(-35.0), math.radians(215.0)
    upholstery = [
        _arc_solid(0.26, 0.4, wrap0, wrap1, 0.1, seat + 0.3, 18),
        _arc_solid(0.28, 0.38, wrap0 + 0.03, wrap1 - 0.03, seat + 0.3, seat + 0.34, 18),
        cylinder(0.33, seat - 0.06, 0.1, 22),
        cone(0.3, 0.28, seat, seat - 0.06, 22),
    ]
    legs = [translate_geo(cone(0.022, 0.016, 0.1, 0.0, 6), 0.27 * math.cos(a), 0.27 * math.sin(a), 0.0)
            for a in (math.radians(45.0), math.radians(135.0), math.radians(225.0), math.radians(315.0))]
    # Built with the sitter looking toward -y; turned to look along `facing`.
    turn = facing + math.pi / 2.0
    return transform_geo(concat(upholstery), x, y, 0.0, turn), transform_geo(concat(legs), x, y, 0.0, turn)


# --- the second table -----------------------------------------------------------------


def blackjack_table(cx, cy, radius=0.95, height=0.78, segments=36):
    """A half-moon blackjack table: the players round the curve, the dealer on the straight
    side facing them. Built with the straight edge along x at cy and the curve toward +y.

    Returns (felt, rail, wood). The felt is a half-disc whose UVs the build maps onto its own
    printed layout."""
    arc = [(radius * math.cos(math.pi * i / segments), radius * math.sin(math.pi * i / segments))
           for i in range(segments + 1)]
    # polygon_disc fans from the origin, which is the middle of the straight edge: drawn there
    # and moved.
    felt = translate_geo(polygon_disc([(x, y, height) for x, y in arc]), cx, cy, 0.0)
    verts, faces = [], []
    tube, sides = 0.055, 8
    for i, (ax, ay) in enumerate(arc):
        a = math.pi * i / segments
        for j in range(sides):
            b = 2.0 * math.pi * j / sides
            reach = radius + tube + tube * math.cos(b)
            verts.append((cx + reach * math.cos(a), cy + reach * math.sin(a), height + 0.01 + tube * math.sin(b)))
    for i in range(segments):
        for j in range(sides):
            p = i * sides + j
            q = i * sides + (j + 1) % sides
            r = (i + 1) * sides + (j + 1) % sides
            s = (i + 1) * sides + j
            faces += [(p, q, r), (p, r, s)]
    wood = [
        box((cx - radius - 0.11, cy - 0.14, height - 0.06), (2.0 * radius + 0.22, 0.14, 0.08)),
        _arc_solid(radius * 0.72, radius + 0.03, 0.0, math.pi, height - 0.18, height - 0.02, segments),
        translate_geo(cone(0.4, 0.14, 0.05, 0.0, 20), cx - radius * 0.45, cy + radius * 0.35, 0.0),
        translate_geo(cone(0.4, 0.14, 0.05, 0.0, 20), cx + radius * 0.45, cy + radius * 0.35, 0.0),
        translate_geo(cylinder(0.07, height - 0.17, 0.05, 12, closed_bottom=False), cx - radius * 0.45,
                      cy + radius * 0.35, 0.0),
        translate_geo(cylinder(0.07, height - 0.17, 0.05, 12, closed_bottom=False), cx + radius * 0.45,
                      cy + radius * 0.35, 0.0),
    ]
    wood[1] = translate_geo(wood[1], cx, cy, 0.0)
    return felt, (verts, faces), concat(wood)


def chip_stack(x, y, z, count, radius=0.0195, thick=0.0033):
    """A short stack of chips standing on the felt."""
    return translate_geo(cylinder(radius, count * thick, 0.0, 14), x, y, z)


def dealt_card(x, y, z, turn, width=0.0635, length=0.0889):
    """A card lying face down on the felt."""
    return transform_geo(box((-width / 2.0, -length / 2.0, 0.0), (width, length, 0.0008)), x, y, z, turn)


def arc_lamp(foot_x, foot_y, head_x, head_y, height=2.25, shade_radius=0.24):
    """An arc floor lamp: a dark steel post that rises and reaches over to hang a shade above a
    table. Returns (steel, diffuser) - the diffuser is the glowing disc under the shade."""
    steel = [translate_geo(cylinder(0.2, 0.03, 0.0, 16), foot_x, foot_y, 0.0)]
    points = []
    for step in range(13):
        t = step / 12.0
        points.append((foot_x + (head_x - foot_x) * (t ** 1.8), foot_y + (head_y - foot_y) * (t ** 1.8),
                       0.03 + (height + 0.25 - 0.03) * math.sin(math.pi / 2.0 * min(t * 1.25, 1.0)) - 0.25 * max(0.0, t - 0.8) / 0.2))
    for a, b in zip(points, points[1:]):
        steel.append(_rod(a, b, 0.02, 6))
    hang = points[-1]
    steel.append(translate_geo(cone(shade_radius, 0.05, hang[2], hang[2] - 0.2, 20), hang[0], hang[1], 0.0))
    diffuser = translate_geo(polygon_disc([((shade_radius - 0.01) * math.cos(2.0 * math.pi * i / 20),
                                            (shade_radius - 0.01) * math.sin(2.0 * math.pi * i / 20), hang[2] - 0.19)
                                           for i in range(19, -1, -1)]), hang[0], hang[1], 0.0)
    return concat(steel), diffuser

# --- planting ------------------------------------------------------------------------


def _blob(cx, cy, cz, radius, rand, squash=0.8, u_seg=9, v_seg=6):
    """A lumpy ball of foliage: a sphere with every vertex pushed in or out a little."""
    verts, faces = sphere(radius, 0.0, 0.0, 0.0, u_seg, v_seg)
    moved = []
    for x, y, z in verts:
        wobble = 1.0 + 0.3 * (rand() - 0.5)
        moved.append((cx + x * wobble, cy + y * wobble, cz + z * wobble * squash))
    return moved, faces


def olive_tree(x, y, base_z, height=2.2, seed=5):
    """A potted olive: a leaning, splitting trunk and a loose canopy of grey-green clumps,
    low enough to sit inside a seated player's frame - the palms it replaces were bare poles
    whose crowns stood above it.

    Returns (trunk, canopy)."""
    rand = _lcg(seed)
    lean = rand() * 2.0 * math.pi
    trunk_top = base_z + height * 0.55
    points = [(x, y, base_z)]
    for step in range(1, 5):
        t = step / 4.0
        points.append((x + 0.12 * t * math.cos(lean) + 0.03 * (rand() - 0.5),
                       y + 0.12 * t * math.sin(lean) + 0.03 * (rand() - 0.5),
                       base_z + (trunk_top - base_z) * t))
    trunk = [_rod(a, b, 0.065 - 0.02 * index / 4.0, 7) for index, (a, b) in enumerate(zip(points, points[1:]))]
    crown = points[-1]
    tips = []
    for branch in range(3):
        angle = lean + branch * 2.1 + (rand() - 0.5) * 0.6
        reach = 0.28 + 0.12 * rand()
        tip = (crown[0] + reach * math.cos(angle), crown[1] + reach * math.sin(angle),
               crown[2] + 0.3 + 0.2 * rand())
        trunk.append(_rod(crown, tip, 0.035, 6))
        tips.append(tip)
    # Many small rough clumps round each branch tip rather than a few big balls: an olive's
    # crown is broken and airy, and a handful of smooth spheres read as balloons.
    canopy = []
    for tip in tips:
        for _ in range(5):
            angle = rand() * 2.0 * math.pi
            spread = 0.08 + 0.2 * rand()
            canopy.append(_blob(tip[0] + spread * math.cos(angle), tip[1] + spread * math.sin(angle),
                                tip[2] + 0.05 + 0.25 * rand(), 0.12 + 0.1 * rand(), rand, u_seg=7, v_seg=5))
    for _ in range(4):
        angle = rand() * 2.0 * math.pi
        canopy.append(_blob(crown[0] + 0.18 * math.cos(angle), crown[1] + 0.18 * math.sin(angle),
                            base_z + height - 0.25 - 0.2 * rand(), 0.14 + 0.08 * rand(), rand, u_seg=7, v_seg=5))
    return concat(trunk), concat(canopy)


def topiary_ball(x, y, base_z, radius=0.34, seed=9):
    """A clipped boxwood ball sitting in its pot."""
    return _blob(x, y, base_z + radius * 0.85, radius, _lcg(seed), squash=0.92, u_seg=12, v_seg=8)

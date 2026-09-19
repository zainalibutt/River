"""The Rooftop felt, printed.

The felt was a flat colour with one gold line, so the table - the thing in frame for the
whole game - read as a dark hole. A real card room prints its felt: boxes for the board,
a place for the pot, a pinstripe inside the rail and the room's name. This draws that
texture from signed distance fields, so every mark is anti-aliased at any size, the
result is the same bytes on every build, and no font file comes into the repository -
the wordmark is lettered here, stroke by stroke.

Every position is in the table's own metres, taken from values.py and from where the
browser puts things: the board cards are laid across the middle of the felt a card width
and 20mm apart, and the pot is stacked 260mm beyond them towards the dealer. The boxes
and the ring are drawn around those spots, so what is printed is where the cards and
chips actually land.

Pure numpy, no bpy: build_assets.py turns the array into the felt's image.
"""
import numpy as np

# Where the browser deals the board and stacks the pot (river-venue-scene.tsx), in the
# table's plane: +X along the long axis, +Y towards the dealer.
BOARD_CARD_WIDTH = 0.126
BOARD_CARD_LENGTH = 0.176
BOARD_CARD_GAP = 0.02
POT_CENTRE = (0.0, 0.26)


def hex_rgb(value):
    return np.array([int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


class Canvas:
    """A felt-sized image and the metres each pixel stands for."""

    def __init__(self, width, felt_rx, felt_ry):
        self.width = width
        self.height = int(round(width * felt_ry / felt_rx))
        self.rx = felt_rx
        self.ry = felt_ry
        self.metres_per_pixel = 2.0 * felt_rx / width
        xs = (np.arange(self.width, dtype=np.float32) + 0.5) / self.width * 2.0 * felt_rx - felt_rx
        # Row 0 is the bottom of the image, as Blender stores pixels: y = -ry.
        ys = (np.arange(self.height, dtype=np.float32) + 0.5) / self.height * 2.0 * felt_ry - felt_ry
        self.x, self.y = np.meshgrid(xs, ys)

    def window(self, x0, y0, x1, y1):
        """The pixel slices covering a box in metres, so a mark only costs its own area."""
        def column(value):
            return int(np.clip((value + self.rx) / (2.0 * self.rx) * self.width, 0, self.width))

        def row(value):
            return int(np.clip((value + self.ry) / (2.0 * self.ry) * self.height, 0, self.height))

        return slice(row(y0), row(y1) + 1), slice(column(x0), column(x1) + 1)


def upsample(small, height, width):
    """Bilinear resize of a small noise field, so slow variation has no block edges."""
    rows = np.linspace(0.0, small.shape[0] - 1.0, height)
    cols = np.linspace(0.0, small.shape[1] - 1.0, width)
    across = np.stack([np.interp(cols, np.arange(small.shape[1]), row) for row in small])
    return np.stack([np.interp(rows, np.arange(small.shape[0]), across[:, j]) for j in range(width)], axis=1)


def coverage(distance, half_width, metres_per_pixel):
    """Anti-aliased cover of a stroke `half_width` wide either side of a distance field."""
    return np.clip((half_width - distance) / metres_per_pixel + 0.5, 0.0, 1.0)


def segment_distance(x, y, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / length_sq, 0.0, 1.0) if length_sq > 0 else 0.0
    return np.hypot(x - (ax + t * dx), y - (ay + t * dy))


def arc_distance(x, y, centre, radius, start, end):
    """Distance to a circular arc from angle `start` to `end` (radians, anticlockwise)."""
    cx, cy = centre
    angle = np.arctan2(y - cy, x - cx)
    span = (end - start) % (2.0 * np.pi)
    inside = ((angle - start) % (2.0 * np.pi)) <= span
    on_circle = np.abs(np.hypot(x - cx, y - cy) - radius)
    ends = np.minimum(
        np.hypot(x - (cx + radius * np.cos(start)), y - (cy + radius * np.sin(start))),
        np.hypot(x - (cx + radius * np.cos(end)), y - (cy + radius * np.sin(end))),
    )
    return np.where(inside, on_circle, ends)


def rounded_box_distance(x, y, centre, half_w, half_h, radius):
    """Distance to the outline of a rounded rectangle."""
    qx = np.abs(x - centre[0]) - (half_w - radius)
    qy = np.abs(y - centre[1]) - (half_h - radius)
    outside = np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0))
    inside = np.minimum(np.maximum(qx, qy), 0.0)
    return np.abs(outside + inside - radius)


def ellipse_distance(x, y, rx, ry):
    """First-order distance to an ellipse outline: accurate for the thin lines drawn here."""
    f = (x / rx) ** 2 + (y / ry) ** 2 - 1.0
    gradient = np.hypot(2.0 * x / (rx * rx), 2.0 * y / (ry * ry))
    return np.abs(f) / np.maximum(gradient, 1e-6)


def paint(image, canvas, rows, cols, cover, colour, opacity):
    alpha = (cover * opacity)[..., None]
    image[rows, cols] = image[rows, cols] * (1.0 - alpha) + colour * alpha


# The wordmark, lettered as strokes in a unit box: x across, y up, cap height 1.
def _letter_strokes(letter, width):
    if letter == 'R':
        bowl = 0.25
        return [
            ('line', (0.0, 0.0), (0.0, 1.0)),
            ('line', (0.0, 1.0), (width - bowl, 1.0)),
            ('arc', (width - bowl, 1.0 - bowl), bowl, -np.pi / 2.0, np.pi / 2.0),
            ('line', (width - bowl, 0.5), (0.0, 0.5)),
            ('line', (width * 0.42, 0.5), (width, 0.0)),
        ]
    if letter == 'I':
        return [('line', (0.0, 0.0), (0.0, 1.0))]
    if letter == 'V':
        return [('line', (0.0, 1.0), (width / 2.0, 0.0)), ('line', (width / 2.0, 0.0), (width, 1.0))]
    if letter == 'E':
        return [
            ('line', (0.0, 0.0), (0.0, 1.0)),
            ('line', (0.0, 1.0), (width, 1.0)),
            ('line', (0.0, 0.5), (width * 0.82, 0.5)),
            ('line', (0.0, 0.0), (width, 0.0)),
        ]
    raise ValueError('no strokes for ' + letter)


LETTER_WIDTH = {'R': 0.62, 'I': 0.0, 'V': 0.78, 'E': 0.58}


def wordmark_strokes(text, centre, cap_height, tracking):
    """Strokes in metres for `text` centred on `centre`, reading from the -Y side of the
    table: its up is +Y and its left-to-right is +X."""
    advance = []
    for letter in text:
        advance.append(LETTER_WIDTH[letter] * cap_height)
    total = sum(advance) + tracking * (len(text) - 1)
    x = centre[0] - total / 2.0
    y0 = centre[1] - cap_height / 2.0
    strokes = []
    for letter, width in zip(text, advance):
        for stroke in _letter_strokes(letter, width / cap_height):
            if stroke[0] == 'line':
                _, (ax, ay), (bx, by) = stroke
                strokes.append(('line', (x + ax * cap_height, y0 + ay * cap_height),
                                (x + bx * cap_height, y0 + by * cap_height)))
            else:
                _, (cx, cy), radius, start, end = stroke
                strokes.append(('arc', (x + cx * cap_height, y0 + cy * cap_height),
                                radius * cap_height, start, end))
        x += width + tracking
    return strokes


def render_felt(width, felt_rx, felt_ry, felt_hex, ink_hex, gold_hex, seed=19):
    """The printed felt as an (height, width, 3) sRGB array in 0-1, bottom row first."""
    canvas = Canvas(width, felt_rx, felt_ry)
    felt = hex_rgb(felt_hex)
    ink = hex_rgb(ink_hex)
    gold = hex_rgb(gold_hex)
    rng = np.random.default_rng(seed)
    x, y = canvas.x, canvas.y
    step = canvas.metres_per_pixel

    # Cloth: a fine fibre grain and a slow unevenness, both multiplicative and small.
    grain = rng.normal(0.0, 1.0, (canvas.height, canvas.width)).astype(np.float32)
    coarse = upsample(rng.normal(0.0, 1.0, (canvas.height // 48 + 2, canvas.width // 48 + 2)).astype(np.float32),
                      canvas.height, canvas.width)
    shade = 1.0 + 0.04 * grain + 0.035 * coarse
    # Worn and shadowed where the rail meets the cloth.
    edge = np.clip((np.sqrt((x / felt_rx) ** 2 + (y / felt_ry) ** 2) - 0.90) / 0.10, 0.0, 1.0)
    shade *= 1.0 - 0.22 * edge * edge
    image = np.clip(felt[None, None, :] * shade[..., None], 0.0, 1.0)

    everywhere = (slice(None), slice(None))

    # The pinstripe inside the rail.
    cover = coverage(ellipse_distance(x, y, felt_rx * 0.935, felt_ry * 0.91), 0.0014, step)
    paint(image, canvas, *everywhere, cover, gold, 0.55)

    # Boxes where the board is dealt.
    half_w = (BOARD_CARD_WIDTH + 0.012) / 2.0
    half_h = (BOARD_CARD_LENGTH + 0.012) / 2.0
    for index in range(5):
        cx = -(BOARD_CARD_WIDTH + BOARD_CARD_GAP) * 2.0 + index * (BOARD_CARD_WIDTH + BOARD_CARD_GAP)
        rows, cols = canvas.window(cx - half_w - 0.01, -half_h - 0.01, cx + half_w + 0.01, half_h + 0.01)
        distance = rounded_box_distance(x[rows, cols], y[rows, cols], (cx, 0.0), half_w, half_h, 0.012)
        paint(image, canvas, rows, cols, coverage(distance, 0.0012, step), ink, 0.42)

    # The pot's place, towards the dealer.
    radius = 0.115
    rows, cols = canvas.window(POT_CENTRE[0] - radius - 0.01, POT_CENTRE[1] - radius - 0.01,
                               POT_CENTRE[0] + radius + 0.01, POT_CENTRE[1] + radius + 0.01)
    distance = np.abs(np.hypot(x[rows, cols] - POT_CENTRE[0], y[rows, cols] - POT_CENTRE[1]) - radius)
    paint(image, canvas, rows, cols, coverage(distance, 0.0012, step), ink, 0.42)

    # The room's name, in gold, on the players' side of the board.
    strokes = wordmark_strokes('RIVER', (0.0, -0.40), 0.066, 0.05)
    xs = [point for stroke in strokes for point in ((stroke[1][0],) if stroke[0] == 'arc' else
                                                    (stroke[1][0], stroke[2][0]))]
    rows, cols = canvas.window(min(xs) - 0.06, -0.40 - 0.06, max(xs) + 0.06, -0.40 + 0.06)
    local_x, local_y = x[rows, cols], y[rows, cols]
    distance = np.full(local_x.shape, np.inf, dtype=np.float32)
    for stroke in strokes:
        if stroke[0] == 'line':
            distance = np.minimum(distance, segment_distance(local_x, local_y, stroke[1], stroke[2]))
        else:
            distance = np.minimum(distance, arc_distance(local_x, local_y, *stroke[1:]))
    paint(image, canvas, rows, cols, coverage(distance, 0.0034, step), gold, 0.72)
    # A diamond either side of the name.
    for side in (-1.0, 1.0):
        cx = side * (max(abs(min(xs)), abs(max(xs))) + 0.055)
        half = 0.012
        diamond = np.abs(local_x - cx) + np.abs(local_y + 0.40) - half
        paint(image, canvas, rows, cols, coverage(diamond, 0.0, step), gold, 0.72)

    return np.clip(image, 0.0, 1.0)

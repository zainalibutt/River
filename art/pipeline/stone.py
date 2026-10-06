"""The Rooftop's terrace floor, printed: large-format stone tiles, each its own shade.

The floor sits under every chair in the frame and was a flat colour with its shading baked
into the thirty-three vertices of a disc - too coarse to hold anything but a gradient. The
reference terrace is pale lavender-grey stone laid in large tiles, so the floor is drawn
the way the felt is (see felt.py): tile by tile, with a slow cloud through the stone, a fine
speckle, thin grout joints, and the same darkening toward the parapet the vertex shading
carried.

Pure numpy: build_assets.py turns the array into an image.
"""
import numpy as np
from felt import Canvas, coverage, hex_rgb, paint, upsample


def render_floor(width, radius, stone_hex, grout_hex, tile=0.9, seed=23):
    """The floor as an (height, width, 3) sRGB array in 0-1, bottom row first."""
    canvas = Canvas(width, radius, radius)
    stone = hex_rgb(stone_hex)
    grout = hex_rgb(grout_hex)
    rng = np.random.default_rng(seed)
    x, y = canvas.x, canvas.y
    step = canvas.metres_per_pixel

    # One shade per tile, and a slight lean toward warm or cool, as cut stone varies.
    count = int(2.0 * radius / tile) + 2
    column = np.floor((x + radius) / tile).astype(int)
    row = np.floor((y + radius) / tile).astype(int)
    value = 1.0 + 0.06 * rng.normal(0.0, 1.0, (count, count))
    lean = 0.025 * rng.normal(0.0, 1.0, (count, count))
    shade = value[row, column]

    # The stone itself: a slow cloud and a fine speckle, both small and multiplicative.
    cloud = upsample(rng.normal(0.0, 1.0, (canvas.height // 64 + 2, canvas.width // 64 + 2)).astype(np.float32),
                     canvas.height, canvas.width)
    speckle = rng.normal(0.0, 1.0, (canvas.height, canvas.width)).astype(np.float32)
    shade = shade * (1.0 + 0.05 * cloud + 0.02 * speckle)
    # Darker toward the wall, which is what the vertex shading carried: 0.95 at the centre,
    # 0.67 at the parapet.
    shade = shade * (0.95 - 0.28 * np.clip(np.hypot(x, y) / radius, 0.0, 1.0))
    image = stone[None, None, :] * shade[..., None]
    warm = lean[row, column]
    image[..., 0] *= 1.0 + warm
    image[..., 2] *= 1.0 - warm

    # Grout: joints six millimetres wide on the tile grid.
    u = (x + radius) / tile
    v = (y + radius) / tile
    joint = np.minimum(np.abs(u - np.round(u)), np.abs(v - np.round(v))) * tile
    paint(image, canvas, slice(None), slice(None), coverage(joint, 0.003, step), grout, 0.8)
    return np.clip(image, 0.0, 1.0)

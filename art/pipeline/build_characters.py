import json
import math
import os
import struct
import sys
import tempfile
import zlib

os.environ.setdefault('RIVER_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import bpy

from buildkit import smooth_mesh_by_angle
from values import (
    BUDGET,
)

OUT_DIR = os.environ['RIVER_OUT']

MALE = 'char_male'
FEMALE = 'char_female'
MPFB_MODULE = 'bl_ext.blender_org.mpfb'

POISON_NAMES = ('body', 'left', 'right', 'helpergeometry')
GARMENT_BONES = ('spine', 'clavicle', 'shoulder', 'upperarm', 'lowerarm', 'breast', 'pelvis')
GARMENT_WELD_DISTANCE = 0.0005
ATLAS_SIZE = 1024
ATLAS_COLUMNS = 8
ATLAS_ROWS = 4

FACE_RECIPE_CELLS = {
    'young_everyday': (3, 0),
    'established_everyday': (0, 3),
    'older_everyday': (2, 3),
    'young_glamorous': (5, 3),
    'established_glamorous': (3, 2),
    'older_glamorous': (5, 2),
}

HAIR_STYLES = ('slick_back', 'side_part', 'crop', 'quiff', 'bob', 'bun', 'bald')

OUTFIT_RECIPE_CELLS = {
    'dealer_ivory': (4, 1),
    'm1_dinner': (5, 1),
    'f1_cocktail_everyday': (6, 1),
    'f1_cocktail_glamorous': (7, 2),
    'm5_leather': (7, 3),
}

GOLD_FEMALE_IDENTITY = (
    ('head-oval', 0.62),
    ('head-invertedtriangular', 0.34),
    ('forehead-temple-incr', 0.16),
    ('l-eye-scale-decr', 0.08),
    ('r-eye-scale-decr', 0.08),
    ('l-eye-height1-decr', 0.12),
    ('r-eye-height1-decr', 0.12),
    ('l-eye-eyefold-up', 0.22),
    ('r-eye-eyefold-up', 0.22),
    ('l-eye-corner2-up', 0.14),
    ('r-eye-corner2-up', 0.14),
    ('l-cheek-bones-incr', 0.62),
    ('r-cheek-bones-incr', 0.62),
    ('l-cheek-volume-incr', 0.16),
    ('r-cheek-volume-incr', 0.16),
    ('nose-scale-horiz-decr', 0.30),
    ('nose-point-width-decr', 0.24),
    ('nose-scale-depth-decr', 0.12),
    ('mouth-scale-horiz-incr', 0.14),
    ('mouth-cupidsbow-incr', 0.46),
    ('mouth-upperlip-volume-incr', 0.42),
    ('mouth-lowerlip-volume-incr', 0.50),
    ('mouth-angles-up', 0.12),
    ('chin-width-decr', 0.42),
    ('chin-height-decr', 0.18),
    ('chin-prominent-decr', 0.08),
)


def have_mpfb():
    ops = getattr(bpy.ops, 'mpfb', None)
    if ops is None:
        return False
    try:
        getattr(ops, 'create_human').poll()
    except Exception:
        return False
    return True


def require_mpfb():
    if not have_mpfb():
        raise SystemExit(
            'BLOCKED: MPFB not enabled. Set BLENDER_USER_EXTENSIONS to the profile '
            'containing extensions/blender_org/mpfb and enable ' + MPFB_MODULE
        )


def clear_scene():
    """Full reset between characters.

    The previous version unlinked scene objects but left armature, action and
    orphan datablocks behind, so the second character was built into the residue
    of the first - char_female shipped with char_male.rig, two stray Icospheres
    and one action instead of nine.
    """
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.actions,
        bpy.data.shape_keys if hasattr(bpy.data, 'shape_keys') else (),
    ):
        for block in list(collection):
            try:
                collection.remove(block)
            except Exception:
                pass
    # orphan purge catches anything still referenced by a zero-user chain
    for _ in range(3):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def add_diffuse_material(name, hex_rgb):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    if bsdf is not None:
        r = int(hex_rgb[0:2], 16) / 255.0
        g = int(hex_rgb[2:4], 16) / 255.0
        b = int(hex_rgb[4:6], 16) / 255.0
        bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
        bsdf.inputs['Roughness'].default_value = 0.62
    return material


def png_chunk(chunk_type, data):
    return (
        struct.pack('>I', len(data))
        + chunk_type
        + data
        + struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
    )


def write_png(path, width, height, pixels):
    stride = width * 4
    scanlines = bytearray()
    for row in range(height):
        scanlines.append(0)
        start = row * stride
        scanlines.extend(pixels[start:start + stride])
    payload = bytearray(b'\x89PNG\r\n\x1a\n')
    payload.extend(png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)))
    payload.extend(png_chunk(b'IDAT', zlib.compress(bytes(scanlines), 9)))
    payload.extend(png_chunk(b'IEND', b''))
    with open(path, 'wb') as handle:
        handle.write(payload)


def set_pixel(pixels, x, y, colour):
    if x < 0 or y < 0 or x >= ATLAS_SIZE or y >= ATLAS_SIZE:
        return
    offset = ((ATLAS_SIZE - 1 - y) * ATLAS_SIZE + x) * 4
    pixels[offset:offset + 4] = bytes(colour)


def blend_pixel(pixels, x, y, colour, amount):
    """Mix a colour into what is already there, rather than replacing it.

    Every painter here wrote whole bytes, so any shape with an edge that was not
    axis-aligned came out as a staircase - and the atlas cell is 128 by 256
    magnified across a whole chest, so each of those steps is several pixels
    wide on screen. Coverage has to be carried as a fraction and mixed in.
    """
    if amount <= 0.0 or x < 0 or y < 0 or x >= ATLAS_SIZE or y >= ATLAS_SIZE:
        return
    amount = min(1.0, amount)
    offset = ((ATLAS_SIZE - 1 - y) * ATLAS_SIZE + x) * 4
    for channel in range(3):
        current = pixels[offset + channel]
        pixels[offset + channel] = round(current + (colour[channel] - current) * amount)


def fill_rect(pixels, x0, y0, x1, y1, colour):
    row = bytes(colour) * max(0, x1 - x0)
    for y in range(max(0, y0), min(ATLAS_SIZE, y1)):
        offset = ((ATLAS_SIZE - 1 - y) * ATLAS_SIZE + max(0, x0)) * 4
        pixels[offset:offset + len(row)] = row


def fill_gradient(pixels, cell_x, cell_y, lower, upper):
    width = ATLAS_SIZE // ATLAS_COLUMNS
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = cell_x * width
    y0 = cell_y * height
    for local_y in range(height):
        blend = local_y / max(1, height - 1)
        colour = tuple(round(lower[index] * (1.0 - blend) + upper[index] * blend) for index in range(3)) + (255,)
        fill_rect(pixels, x0, y0 + local_y, x0 + width, y0 + local_y + 1, colour)


def shade_ellipse(pixels, centre_x, centre_y, radius_x, radius_y, darken, softness=0.45):
    """Darken a soft-edged oval, rather than drawing a line on top of the skin.

    A face at this camera is about ninety pixels tall, and the atlas cell that
    paints it is 128 by 256 - so every texel is downsampled roughly three to one
    on its way to the screen. Line work does not survive that. A two-pixel brow
    and a three-pixel lip average back into flat skin, which is why the faces
    read as blank ovals with two dots however carefully the features were drawn.

    What survives downsampling is mass: broad regions of value with soft edges.
    A head reads as a lit oval with darker sockets, a darker band under the brow
    ridge and darker sides, and that structure is legible at any size because
    averaging preserves it. This darkens rather than paints a colour, so it
    works over any skin tone the palette supplies.
    """
    for y in range(centre_y - radius_y, centre_y + radius_y + 1):
        normal_y = (y - centre_y) / max(1, radius_y)
        for x in range(centre_x - radius_x, centre_x + radius_x + 1):
            normal_x = (x - centre_x) / max(1, radius_x)
            distance = math.sqrt(normal_x * normal_x + normal_y * normal_y)
            if distance > 1.0:
                continue
            # Full strength in the middle, easing to nothing at the rim.
            falloff = 1.0 if distance < softness else (1.0 - distance) / max(1e-6, 1.0 - softness)
            amount = darken * falloff
            if x < 0 or y < 0 or x >= ATLAS_SIZE or y >= ATLAS_SIZE:
                continue
            # Same row order as set_pixel: the buffer's first row is the bottom
            # of the image. Indexing without the flip writes every shadow into
            # the mirrored cell, which put this one silently in the palette
            # swatches and left the face exactly as it was.
            index = ((ATLAS_SIZE - 1 - y) * ATLAS_SIZE + x) * 4
            for channel in range(3):
                pixels[index + channel] = max(0, min(255, int(pixels[index + channel] * (1.0 - amount))))


def tint_ellipse(pixels, centre_x, centre_y, radius_x, radius_y, colour, strength, softness=0.55):
    for y in range(centre_y - radius_y, centre_y + radius_y + 1):
        normal_y = (y - centre_y) / max(1, radius_y)
        for x in range(centre_x - radius_x, centre_x + radius_x + 1):
            normal_x = (x - centre_x) / max(1, radius_x)
            distance = math.sqrt(normal_x * normal_x + normal_y * normal_y)
            if distance > 1.0:
                continue
            falloff = 1.0 if distance < softness else (1.0 - distance) / max(1e-6, 1.0 - softness)
            blend_pixel(pixels, x, y, colour, strength * falloff)


def paint_ellipse(pixels, centre_x, centre_y, radius_x, radius_y, colour):
    for y in range(centre_y - radius_y, centre_y + radius_y + 1):
        normal_y = (y - centre_y) / max(1, radius_y)
        for x in range(centre_x - radius_x, centre_x + radius_x + 1):
            normal_x = (x - centre_x) / max(1, radius_x)
            if normal_x * normal_x + normal_y * normal_y <= 1.0:
                set_pixel(pixels, x, y, colour)


def paint_line(pixels, x0, y0, x1, y1, thickness, colour):
    steps = max(abs(x1 - x0), abs(y1 - y0), 1)
    for step in range(steps + 1):
        blend = step / steps
        x = round(x0 + (x1 - x0) * blend)
        y = round(y0 + (y1 - y0) * blend)
        paint_ellipse(pixels, x, y, thickness, thickness, colour)


def skin_tone(female):
    """One skin colour, for every island that is skin.

    The face island had its own, eleven points lighter than the one the skin and
    hands islands used, so the face met the head at a hard colour step and read
    as a mask laid over it. Same fault as the two atlas painters and the two
    camera tables: one property written twice, and the copies drifting.
    """
    return (202, 153, 122) if female else (194, 145, 108)


def paint_face_cell(pixels, female, cell_x=3, cell_y=0, age='young', glamorous=False):
    cell_width = ATLAS_SIZE // ATLAS_COLUMNS
    width = cell_width * 2
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = cell_x * cell_width
    y0 = cell_y * height
    skin = skin_tone(female) + (255,)
    # Flat, not graded. A gradient across the face island is a second value
    # gradient fighting the shading below, and its top edge lands where the face
    # meets the scalp.
    fill_rect(pixels, x0, y0, x0 + width, y0 + height, skin)
    eye_y = y0 + round(height * 0.58)
    brow_y = y0 + round(height * 0.67)
    lip_y = y0 + round(height * 0.31)
    centre_x = x0 + width // 2

    # Features, not form.
    #
    # The head is geometry and it is lit, so the renderer already shades the
    # sides of a face. Painting side and crown masses into the texture as well
    # shaded it twice - and worse, those masses darkened the outermost texels of
    # the island, which are exactly where the face wraps round and meets the
    # head's skin UVs. A thirty-point colour step at that boundary is what made
    # every character look like it was wearing a mask; it is one point now.
    #
    # What is left is what geometry at this triangle count cannot give: a band
    # under the brow ridge, a socket around each eye, shadow beside and beneath
    # the nose, and one under the lip. All of them sit well inside the island.
    for fraction in (0.32, 0.68):
        eye_x = x0 + round(width * fraction)
        shade_ellipse(pixels, eye_x, eye_y + 2, 30, 15, 0.23, 0.30)
        shade_ellipse(pixels, eye_x, eye_y, 15, 5, 0.42, 0.54)
        shade_ellipse(pixels, eye_x, brow_y, 23, 5, 0.29, 0.58)
    shade_ellipse(pixels, centre_x - 11, y0 + round(height * 0.47), 13, round(height * 0.09), 0.17, 0.24)
    shade_ellipse(pixels, centre_x, y0 + round(height * 0.375), 20, 6, 0.21, 0.28)
    shade_ellipse(pixels, centre_x, y0 + round(height * 0.265), round(width * 0.16), 7, 0.20, 0.25)
    warmth = (224, 128, 96)
    for fraction in (0.30, 0.70):
        tint_ellipse(pixels, x0 + round(width * fraction), y0 + round(height * 0.43), 28, 24, warmth, 0.13 if glamorous and female else 0.08)
    tint_ellipse(pixels, centre_x, y0 + round(height * 0.50), 18, 34, warmth, 0.06)
    lip_strength = 0.78 if glamorous and female else 0.58
    tint_ellipse(pixels, centre_x, lip_y, round(width * 0.13), 6, (142, 48, 58), lip_strength, 0.62)
    if glamorous and female:
        brow = (68, 42, 34, 255)
        paint_line(pixels, x0 + round(width * 0.235), brow_y, x0 + round(width * 0.385), brow_y + 3, 2, brow)
        paint_line(pixels, x0 + round(width * 0.615), brow_y + 3, x0 + round(width * 0.765), brow_y, 2, brow)
    shade_ellipse(pixels, centre_x, y0 + round(height * 0.985), round(width * 0.43), 14, 0.06, 0.68)
    if age in {'established', 'older'}:
        age_strength = 0.07 if age == 'established' else 0.12
        for fraction in (0.32, 0.68):
            shade_ellipse(pixels, x0 + round(width * fraction), eye_y - 9, 27, 8, age_strength, 0.62)
    if age == 'older':
        for fraction in (0.42, 0.58):
            shade_ellipse(pixels, x0 + round(width * fraction), y0 + round(height * 0.39), 8, 24, 0.08, 0.66)
    if not female:
        shade_ellipse(pixels, centre_x, y0 + round(height * 0.29), round(width * 0.31), round(height * 0.13), 0.11, 0.30)


def paint_garment_cell(pixels, base, cell_x=1, cell_y=0):
    """Paint one jacket swatch: dark mass, ivory wedge, lapels bounding it.

    This used to paint a single cell, because the character it was written for
    was the only one anybody looked at. Every character actually seated at a
    table has its UVs remapped onto a cosmetic swatch in rows 1 to 3 by
    `remap_character_uv` in the venue build, and those swatches were flat
    gradients - so the structure painted here reached the proof render and
    nothing else. Nine people at a table wore plain rectangles of colour while
    the character in the lookdev shot wore a shirt.

    So the cell is a parameter and every jacket swatch gets the same treatment.
    """
    width = ATLAS_SIZE // ATLAS_COLUMNS
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = cell_x * width
    y0 = cell_y * height
    # A character is three values at this distance: a dark garment mass, an
    # ivory triangle, and the head. Every previous version of this cell was a
    # midtone, so skin, cloth and hair all sat within a few points of each other
    # and the whole figure collapsed into one grey-pink shape the moment it was
    # seen from the table. The garment is the largest area on screen, so it is
    # the one that has to go dark for the other two to mean anything.
    fill_gradient(pixels, cell_x, cell_y, tuple(max(0, channel - 8) for channel in base), tuple(min(255, channel + 9) for channel in base))

    # The shirt front, as a shape rather than a stripe.
    #
    # This was a pair of thin near-white lines meeting in a Y whose stem ran the
    # full height of the cell, which put a bright seam down to the navel and read
    # as a decal printed on a t-shirt. What the eye is looking for is the wedge
    # of shirt a jacket leaves open, so that is what is painted: widest at the
    # collar, closing at the sternum, and stopping there. Nothing below the
    # button stance.
    #
    # Painted top-down in cell space, which is bottom-up on the model - the atlas
    # writer flips rows - so the wide end sits at the high v where the collar is.
    ivory = (210, 199, 176)
    lapel = (13, 15, 19)
    centre = x0 + width / 2.0
    top = height * 0.95
    apex = height * 0.72
    half_at_collar = width * 0.12
    feather = 2.4

    for local_y in range(height):
        # 0 at the collar, 1 at the sternum, outside that range beyond the wedge.
        down = (top - local_y) / (top - apex)
        if down < -0.3 or down > 1.3:
            continue
        half = half_at_collar * (1.0 - max(0.0, min(1.0, down)))
        if local_y > top:
            vertical = max(0.0, 1.0 - (local_y - top) / feather)
        elif local_y < apex:
            vertical = max(0.0, 1.0 - (apex - local_y) / feather)
        else:
            vertical = 1.0
        if vertical <= 0.0:
            continue
        for local_x in range(width):
            x = x0 + local_x
            across = abs((x + 0.5) - centre)
            # Coverage falls off over `feather` texels, so a diagonal edge
            # arrives as a gradient rather than as a staircase.
            coverage = max(0.0, min(1.0, (half - across) / feather + 0.5)) * vertical
            if coverage > 0.0:
                blend_pixel(pixels, x, y0 + local_y, ivory, coverage)
            # The lapel edge rides the boundary of the ivory, so it stays a
            # bounding line rather than a stripe drawn near one.
            edge_amount = max(0.0, 1.0 - abs(half - across) / feather) * 0.85 * vertical
            if edge_amount > 0.0:
                blend_pixel(pixels, x, y0 + local_y, lapel, edge_amount)

    # The placket, barely present: a seam is a change of plane, not a highlight.
    for local_y in range(round(apex), round(top)):
        blend_pixel(pixels, round(centre), y0 + local_y, (198, 188, 168), 0.55)

    # The collar band across the top of the chest.
    for local_y in range(round(height * 0.95), round(height * 0.99)):
        for local_x in range(8, width - 8):
            blend_pixel(pixels, x0 + local_x, y0 + local_y, lapel, 0.9)


def paint_hair_cell(pixels, base, skin, cell_x=2, cell_y=0):
    width = ATLAS_SIZE // ATLAS_COLUMNS
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = cell_x * width
    y0 = cell_y * height
    fill_gradient(
        pixels,
        cell_x,
        cell_y,
        tuple(max(0, channel - 3) for channel in base),
        tuple(min(255, channel + 12) for channel in base),
    )
    transition = tuple(round(channel * 0.85) for channel in skin)
    highlight = tuple(min(255, channel + 18) for channel in base)
    shadow = tuple(max(0, channel - 7) for channel in base)
    for local_y in range(height):
        hairline = min(1.0, local_y / 6.0)
        hairline = hairline * hairline * (3.0 - 2.0 * hairline)
        for local_x in range(width):
            if hairline < 1.0:
                blend_pixel(pixels, x0 + local_x, y0 + local_y, transition, 1.0 - hairline)
            u = local_x / width
            v = local_y / height
            broad = 0.0
            for centre in (0.22, 0.51, 0.80):
                distance = abs(u - (centre + 0.07 * (v - 0.5)))
                broad += 0.21 * max(0.0, 1.0 - distance / 0.11) ** 2
            strand_phase = (u + 0.105 * (v - 0.5)) * 34.0 * math.pi
            ridge = max(0.0, math.sin(strand_phase)) ** 8
            groove = max(0.0, -math.sin(strand_phase)) ** 10
            blend_pixel(pixels, x0 + local_x, y0 + local_y, highlight, (broad + 0.24 * ridge) * hairline)
            blend_pixel(pixels, x0 + local_x, y0 + local_y, shadow, 0.17 * groove * hairline)


def paint_wave_one_outfit_cell(pixels, style, cell_x, cell_y):
    width = ATLAS_SIZE // ATLAS_COLUMNS
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = cell_x * width
    y0 = cell_y * height
    centre = x0 + width // 2
    if style == 'dealer_ivory':
        fill_gradient(pixels, cell_x, cell_y, (215, 202, 181), (239, 228, 208))
        dark = (12, 14, 16)
        fill_rect(
            pixels,
            x0 + round(width * 0.41),
            y0 + round(height * 0.86),
            x0 + round(width * 0.59),
            y0 + round(height * 0.99),
            dark + (255,),
        )
        paint_line(
            pixels,
            x0 + round(width * 0.38),
            y0 + round(height * 0.96),
            centre - 3,
            y0 + round(height * 0.68),
            7,
            dark + (255,),
        )
        paint_line(
            pixels,
            x0 + round(width * 0.62),
            y0 + round(height * 0.96),
            centre + 3,
            y0 + round(height * 0.68),
            7,
            dark + (255,),
        )
        paint_ellipse(pixels, centre - 7, y0 + round(height * 0.87), 8, 5, dark + (255,))
        paint_ellipse(pixels, centre + 7, y0 + round(height * 0.87), 8, 5, dark + (255,))
        return
    if style == 'm1_dinner':
        paint_garment_cell(pixels, (18, 24, 40), cell_x, cell_y)
        return
    if style.startswith('f1_cocktail'):
        base = (70, 24, 36) if style.endswith('everyday') else (118, 14, 30)
        fill_gradient(
            pixels,
            cell_x,
            cell_y,
            tuple(max(0, channel - 8) for channel in base),
            tuple(min(255, channel + 13) for channel in base),
        )
        skin = (181, 128, 98)
        for local_y in range(round(height * 0.89), height):
            half = width * (0.13 + (local_y / height - 0.89) * 0.85)
            for local_x in range(width):
                if abs((x0 + local_x + 0.5) - centre) < half:
                    blend_pixel(pixels, x0 + local_x, y0 + local_y, skin, 0.96)
        for local_y in range(height):
            band = 0.5 + 0.5 * math.cos((local_y / height - 0.52) * math.pi * 1.8)
            for local_x in range(round(width * 0.43), round(width * 0.58)):
                blend_pixel(pixels, x0 + local_x, y0 + local_y, (176, 54, 62), 0.09 * band)
        for local_y in range(round(height * 0.345), round(height * 0.375)):
            for local_x in range(5, width - 5):
                edge = min(1.0, min(local_x - 4, width - 5 - local_x) / 5.0)
                blend_pixel(pixels, x0 + local_x, y0 + local_y, (151, 116, 55), 0.72 * edge)
        return
    if style == 'm5_leather':
        fill_gradient(pixels, cell_x, cell_y, (13, 13, 16), (28, 27, 30))
        for local_y in range(height):
            diagonal = round(width * (0.34 + 0.28 * local_y / height))
            for offset in range(-2, 3):
                blend_pixel(pixels, x0 + diagonal + offset, y0 + local_y, (82, 72, 64), 0.52 - abs(offset) * 0.09)
        for local_y in range(round(height * 0.91), round(height * 0.99)):
            for local_x in range(5, width - 5):
                blend_pixel(pixels, x0 + local_x, y0 + local_y, (7, 8, 10), 0.85)
        for local_y in range(round(height * 0.74), round(height * 0.90)):
            strength = 0.10 * math.sin((local_y / height - 0.74) / 0.16 * math.pi)
            for local_x in range(width):
                blend_pixel(pixels, x0 + local_x, y0 + local_y, (86, 80, 74), strength)


def create_character_atlas(name, female):
    pixels = bytearray((38, 38, 40, 255)) * (ATLAS_SIZE * ATLAS_SIZE)
    palettes = [
        (68, 77, 86), (32, 52, 73), (128, 93, 62), (79, 61, 88),
        (102, 42, 44), (35, 74, 64), (113, 103, 80), (56, 56, 60),
    ]
    for row in range(1, ATLAS_ROWS):
        for column, colour in enumerate(palettes):
            shift = (row - 1) * 12
            lower = tuple(max(0, channel - 16 + shift) for channel in colour)
            upper = tuple(min(255, channel + 14 + shift) for channel in colour)
            fill_gradient(pixels, column, row, lower, upper)
    skin = skin_tone(female)
    fill_gradient(pixels, 0, 0, tuple(max(0, channel - 12) for channel in skin), tuple(min(255, channel + 10) for channel in skin))
    paint_garment_cell(pixels, (42, 18, 24) if female else (22, 26, 32))

    # The swatches a seated character is actually remapped onto.
    #
    # This atlas is the one that ships: the venue build keeps each character's
    # own material and only falls back to its own when there is none, so these
    # cells are what nine people at a table are wearing. `remap_character_uv`
    # sends every head to one of the four cap cosmetics and every torso to one
    # of the four jackets, and both sets were flat gradients from the palette
    # list below - which is why hair came out tan. It was the colour of a cap
    # because it was literally painted with one.
    #
    # Columns come from paletteIndex in build_assets.py: index modulo eight
    # across, one plus index over eight down. They are written out here rather
    # than imported because the venue build imports this module, not the other
    # way round.
    for cell, jacket in (
        ((7, 1), (24, 26, 30)),
        ((0, 2), (18, 30, 27)),
        ((1, 2), (18, 24, 40)),
        ((2, 2), (46, 18, 22)),
    ):
        paint_garment_cell(pixels, jacket, cell[0], cell[1])

    # Hair reads as hair when it is darker than the skin it sits against.
    for cell, strands in (
        ((0, 1), (24, 22, 22)),
        ((1, 1), (46, 33, 26)),
        ((2, 1), (74, 42, 28)),
        ((3, 1), (96, 84, 74)),
        ((4, 3), (30, 26, 32)),
    ):
        fill_gradient(
            pixels,
            cell[0],
            cell[1],
            tuple(max(0, channel - 7) for channel in strands),
            tuple(min(255, channel + 10) for channel in strands),
        )

    # Hair, and the third value of the three. At (72, 49, 36) it was a tan that
    # landed between the skin and the shirt, which is most of why a shell over
    # the skull read as a cap rather than as hair - it was the colour of one.
    paint_hair_cell(pixels, (24, 18, 15), skin)
    for recipe, cell in FACE_RECIPE_CELLS.items():
        age, presentation = recipe.split('_', 1)
        paint_face_cell(pixels, female, cell[0], cell[1], age, presentation == 'glamorous')
    for style, cell in OUTFIT_RECIPE_CELLS.items():
        paint_wave_one_outfit_cell(pixels, style, cell[0], cell[1])
    fill_gradient(pixels, 5, 0, tuple(max(0, channel - 10) for channel in skin), tuple(min(255, channel + 12) for channel in skin))
    fill_gradient(
        pixels,
        6,
        0,
        (74, 9, 21) if female else (30, 36, 48),
        (132, 20, 38) if female else (56, 64, 78),
    )
    fill_gradient(pixels, 7, 0, (9, 10, 13), (22, 24, 29))
    handle = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    handle.close()
    try:
        write_png(handle.name, ATLAS_SIZE, ATLAS_SIZE, pixels)
        image = bpy.data.images.load(handle.name, check_existing=False)
        image.name = name + '_atlas'
        image.colorspace_settings.name = 'sRGB'
        image.pack()
    finally:
        os.unlink(handle.name)
    return image


def add_atlas_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    # The single-atlas character material is judged under Rooftop's broad key.
    # At 0.62 its highlight broke the procedural hair shell into skin-coloured
    # polygon islands and blew facial planes flat. A restrained matte response
    # keeps the authored value shapes legible until dedicated skin/hair maps
    # land without spending another material slot.
    bsdf.inputs['Roughness'].default_value = 0.78
    return material


def atlas_uv(cell_x, cell_y, local_u, local_v, span_x=1):
    margin_u = 0.015
    margin_v = 0.012
    local_u = min(1.0 - margin_u, max(margin_u, local_u))
    local_v = min(1.0 - margin_v, max(margin_v, local_v))
    return ((cell_x + local_u * span_x) / ATLAS_COLUMNS, (cell_y + local_v) / ATLAS_ROWS)


def apply_body_atlas(obj, material, face_cell=(3, 0)):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(material)
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name='RiverCharacterAtlas')
    for polygon in mesh.polygons:
        centre = polygon.center
        if abs(centre.x) > 0.37 and centre.z < 1.12:
            face = False
            cell = (5, 0)
        elif centre.z < 0.18:
            face = False
            cell = (7, 0)
        elif centre.z < 0.96:
            face = False
            cell = (6, 0)
        elif centre.z > 1.46:
            face = centre.y < -0.035
            cell = face_cell if face else (2, 0)
        else:
            face = False
            cell = (0, 0)
        for loop_index in polygon.loop_indices:
            coordinate = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if face:
                local_u = (coordinate.x + 0.115) / 0.23
                local_v = (coordinate.z - 1.475) / 0.17
            else:
                local_u = coordinate.x + 0.5
                local_v = (coordinate.z - 0.52) / 1.16
            layer.data[loop_index].uv = atlas_uv(cell[0], cell[1], local_u, local_v, 2 if face else 1)


def remove_eye_shells(obj):
    """Remove MPFB's six disconnected eye shells.

    The face atlas carries the gameplay-scale eye read. Retaining any of the
    overlapping cornea, iris or eyeball shells produces intersecting triangular
    fragments in profile, while a replacement sphere intersects the source
    eyelids for the same reason.
    """
    mesh = obj.data
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        first, second = edge.vertices
        adjacency[first].append(second)
        adjacency[second].append(first)
    seen = set()
    eye_components = []
    eye_spikes = []
    head_top = max(vertex.co.z for vertex in mesh.vertices)
    for vertex in mesh.vertices:
        if vertex.index in seen:
            continue
        component = set()
        pending = [vertex.index]
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            seen.add(current)
            pending.extend(adjacency[current])
        points = [mesh.vertices[index].co for index in component]
        if (
            30 <= len(component) <= 40
            and max(abs(point.x) for point in points) < 0.06
            and max(point.y for point in points) < -0.09
            and min(point.z for point in points) > head_top - 0.18
            and max(point.z for point in points) < head_top - 0.06
        ):
            eye_components.append(component)
        if (
            len(component) == 4
            and 0.020 < min(abs(point.x) for point in points)
            and max(abs(point.x) for point in points) < 0.040
            and max(point.y for point in points) < -0.12
            and min(point.z for point in points) > head_top - 0.18
            and max(point.z for point in points) < head_top - 0.05
        ):
            eye_spikes.append(component)
    if len(eye_components) != 6:
        raise RuntimeError('expected 6 source eye shells, found %d' % len(eye_components))
    if len(eye_spikes) < 6:
        raise RuntimeError('expected at least 6 source eye spikes, found %d' % len(eye_spikes))
    eye_spikes = sorted(
        eye_spikes,
        key=lambda component: sum(mesh.vertices[index].co.y for index in component) / len(component),
    )[:6]
    eye_specs = []
    for side in (-1, 1):
        candidates = [
            component for component in eye_components
            if sum(mesh.vertices[index].co.x for index in component) / len(component) * side > 0.0
        ]
        sclera_component = max(
            candidates,
            key=lambda component: max(mesh.vertices[index].co.y for index in component)
            - min(mesh.vertices[index].co.y for index in component),
        )
        coordinates = [mesh.vertices[index].co for index in sclera_component]
        centre = tuple(
            sum(coordinate[axis] for coordinate in coordinates) / len(coordinates)
            for axis in range(3)
        )
        radii = tuple(
            (max(coordinate[axis] for coordinate in coordinates)
             - min(coordinate[axis] for coordinate in coordinates)) * 0.47
            for axis in range(3)
        )
        eye_specs.append((centre, radii))

    discarded = {
        index
        for component in eye_components + eye_spikes
        for index in component
    }
    removed_faces = sum(
        1
        for polygon in mesh.polygons
        if any(index in discarded for index in polygon.vertices)
    )
    mesh_data = bmesh.new()
    mesh_data.from_mesh(mesh)
    mesh_data.verts.ensure_lookup_table()
    bmesh.ops.delete(
        mesh_data,
        geom=[mesh_data.verts[index] for index in sorted(discarded)],
        context='VERTS',
    )

    mesh_data.to_mesh(mesh)
    mesh_data.free()
    obj['eyeShellsRemoved'] = len(eye_components)
    obj['eyeSpikesRemoved'] = len(eye_spikes)
    print('EYE_SHELLS %s: shells_removed=%d spikes_removed=%d faces_removed=%d' % (
        obj.name, len(eye_components), len(eye_spikes), removed_faces
    ))
    return removed_faces, eye_specs


def add_gold_eyes(obj, eye_specs):
    vertices = []
    faces = []
    colours = []

    def add_vertex(coordinate, colour):
        vertices.append(coordinate)
        colours.append(colour)
        return len(vertices) - 1

    def add_ellipsoid(center, radii, colour, segments=16, rings=8):
        bottom = add_vertex((center[0], center[1], center[2] - radii[2]), colour)
        ring_starts = []
        for ring in range(1, rings):
            latitude = -math.pi / 2.0 + math.pi * ring / rings
            ring_starts.append(len(vertices))
            for segment in range(segments):
                longitude = 2.0 * math.pi * segment / segments
                add_vertex((
                    center[0] + radii[0] * math.cos(latitude) * math.cos(longitude),
                    center[1] + radii[1] * math.cos(latitude) * math.sin(longitude),
                    center[2] + radii[2] * math.sin(latitude),
                ), colour)
        top = add_vertex((center[0], center[1], center[2] + radii[2]), colour)
        first = ring_starts[0]
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((bottom, first + following, first + segment))
        for ring in range(len(ring_starts) - 1):
            lower = ring_starts[ring]
            upper = ring_starts[ring + 1]
            for segment in range(segments):
                following = (segment + 1) % segments
                faces.append((lower + segment, lower + following, upper + following, upper + segment))
        last = ring_starts[-1]
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((last + segment, last + following, top))

    def add_disc(center, radius, colour, segments=16):
        middle = add_vertex(center, colour)
        rim = []
        for segment in range(segments):
            angle = 2.0 * math.pi * segment / segments
            rim.append(add_vertex((
                center[0] + radius * math.cos(angle),
                center[1],
                center[2] + radius * math.sin(angle),
            ), colour))
        for segment in range(segments):
            faces.append((middle, rim[segment], rim[(segment + 1) % segments]))

    sclera = (0.82, 0.79, 0.72, 1.0)
    iris = (0.22, 0.095, 0.035, 1.0)
    pupil = (0.012, 0.009, 0.008, 1.0)
    catchlight = (1.0, 0.94, 0.82, 1.0)
    for centre, source_radii in eye_specs:
        side = -1.0 if centre[0] < 0.0 else 1.0
        radii = (
            source_radii[0],
            max(0.010, source_radii[1]),
            source_radii[2],
        )
        add_ellipsoid(centre, radii, sclera)
        eye_front = centre[1] - radii[1] - 0.0008
        iris_radius = radii[0] * 0.43
        pupil_radius = iris_radius * 0.45
        add_disc((centre[0], eye_front, centre[2]), iris_radius, iris)
        add_disc((centre[0], eye_front - 0.0003, centre[2]), pupil_radius, pupil)
        add_disc((centre[0] - side * iris_radius * 0.27, eye_front - 0.0006, centre[2] + iris_radius * 0.30), iris_radius * 0.14, catchlight, segments=8)

    mesh = bpy.data.meshes.new(obj.name + '_eyes')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    colour_layer = mesh.color_attributes.new(name='EyeColour', type='BYTE_COLOR', domain='CORNER')
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            colour_layer.data[loop_index].color = colours[mesh.loops[loop_index].vertex_index]

    material = bpy.data.materials.new(obj.name + '_eye_mat')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    vertex_colour = nodes.new('ShaderNodeVertexColor')
    vertex_colour.layer_name = 'EyeColour'
    links.new(vertex_colour.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(vertex_colour.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.38
    mesh.materials.append(material)

    eyes = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(eyes)
    eyes.parent = obj
    head_group = eyes.vertex_groups.new(name='head')
    head_group.add(list(range(len(vertices))), 1.0, 'REPLACE')
    modifier = eyes.modifiers.new('armature', 'ARMATURE')
    modifier.object = armature_of(obj)
    eyes['characterFeature'] = True
    eyes['cosmeticSlot'] = 'eyes'
    smooth_mesh_by_angle(mesh)
    return eyes


def add_gold_expressions(obj, eye_specs):
    if not eye_specs:
        return []
    basis = obj.shape_key_add(name='Basis')
    basis.interpolation = 'KEY_LINEAR'
    eye_z = sum(spec[0][2] for spec in eye_specs) / len(eye_specs)
    eye_y = sum(spec[0][1] for spec in eye_specs) / len(eye_specs)
    eye_x = max(abs(spec[0][0]) for spec in eye_specs)
    eye_rx = max(spec[1][0] for spec in eye_specs)
    eye_rz = max(spec[1][2] for spec in eye_specs)
    mouth_z = eye_z - 0.105
    expressions = []

    def add_expression(name, deform):
        key = obj.shape_key_add(name=name, from_mix=False)
        key.interpolation = 'KEY_LINEAR'
        for index, source in enumerate(basis.data):
            key.data[index].co = deform(source.co.copy())
        expressions.append(name)

    def eyelid_deform(amount, brow=False):
        def deform(co):
            for centre, _ in eye_specs:
                dx = abs(co.x - centre[0]) / max(eye_rx * 1.45, 0.001)
                dz = abs(co.z - centre[2]) / max(eye_rz * 1.75, 0.001)
                if dx < 1.0 and dz < 1.0 and co.y < eye_y + 0.012:
                    weight = (1.0 - dx * dx) * (1.0 - dz * dz)
                    co.z += (centre[2] - co.z) * amount * weight
                    co.y -= 0.0015 * weight
            if brow and co.y < eye_y + 0.018 and eye_z + 0.018 < co.z < eye_z + 0.075:
                span = abs(co.x) / max(eye_x + eye_rx, 0.001)
                if span < 1.0:
                    co.z -= 0.010 * (1.0 - span) ** 2
            return co
        return deform

    def smile_deform(co, side_bias=0.0):
        if co.y < eye_y + 0.015 and abs(co.x) < 0.075 and abs(co.z - mouth_z) < 0.042:
            horizontal = min(1.0, abs(co.x) / 0.068)
            vertical = max(0.0, 1.0 - abs(co.z - mouth_z) / 0.042)
            side = 1.0 + side_bias * (1.0 if co.x > 0.0 else -1.0)
            co.z += 0.020 * horizontal * vertical * side
            co.x += math.copysign(0.007 * horizontal * vertical, co.x if co.x else 1.0)
            co.y -= 0.0025 * vertical
        cheek_z = mouth_z + 0.045
        if co.y < eye_y + 0.020 and 0.045 < abs(co.x) < 0.115 and abs(co.z - cheek_z) < 0.050:
            cheek = max(0.0, 1.0 - abs(co.z - cheek_z) / 0.050)
            co.z += 0.005 * cheek
            co.y -= 0.002 * cheek
        return co

    def frustration_deform(co):
        co = eyelid_deform(0.22, brow=True)(co)
        if co.y < eye_y + 0.015 and abs(co.x) < 0.075 and abs(co.z - mouth_z) < 0.042:
            horizontal = min(1.0, abs(co.x) / 0.068)
            vertical = max(0.0, 1.0 - abs(co.z - mouth_z) / 0.042)
            co.z -= 0.006 * horizontal * horizontal * vertical
        return co

    def surprise_deform(co):
        if co.y < eye_y + 0.015 and abs(co.x) < 0.060 and abs(co.z - mouth_z) < 0.044:
            vertical = max(0.0, 1.0 - abs(co.z - mouth_z) / 0.044)
            direction = 1.0 if co.z >= mouth_z else -1.0
            co.z += direction * 0.008 * vertical
            co.x *= 0.985
        if co.y < eye_y + 0.018 and eye_z + 0.018 < co.z < eye_z + 0.075 and abs(co.x) < eye_x + eye_rx:
            co.z += 0.006
        return co

    add_expression('face_blink', eyelid_deform(0.92))
    add_expression('face_soft_smile', lambda co: smile_deform(co))
    add_expression('face_frustration', frustration_deform)
    add_expression('face_squint', eyelid_deform(0.46, brow=True))
    add_expression('face_smirk', lambda co: smile_deform(co, side_bias=0.70))
    add_expression('face_surprise', surprise_deform)
    obj['facialExpressions'] = ','.join(expressions)
    return expressions


def apply_garment_atlas(obj, material, cell=(1, 0)):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(material)
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name='RiverCharacterAtlas')
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            coordinate = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            local_u = 0.5 + coordinate.x / 1.1
            local_v = (coordinate.z - 0.58) / 0.88
            layer.data[loop_index].uv = atlas_uv(cell[0], cell[1], local_u, local_v)


def build_hair(obj, material, female, style):
    if style == 'bald':
        return None
    segments = 20 if style == 'crop' else 40 if style == 'bob' else 24
    rings = 6 if style == 'crop' else 15 if style == 'bob' else 9
    centre_y = -0.044
    centre_z = 1.558
    if style == 'bob':
        radius_x, radius_y, radius_z = 0.113, 0.111, 0.135
    elif style == 'crop':
        radius_x, radius_y, radius_z = 0.113, 0.114, 0.118
    elif style == 'bun':
        radius_x, radius_y, radius_z = 0.113, 0.115, 0.126
    else:
        radius_x, radius_y, radius_z = 0.116, 0.120, 0.134
    vertices = []
    faces = []
    for ring in range(rings):
        span = ring / (rings - 1)
        for segment in range(segments):
            around = 2.0 * math.pi * segment / segments
            front = max(0.0, -math.sin(around))
            back = max(0.0, math.sin(around))
            side = abs(math.cos(around))
            left = max(0.0, -math.cos(around))
            right = max(0.0, math.cos(around))
            middle = math.sin(math.pi * span)
            width = 1.0
            lift = 0.0
            forward = 0.0
            sideways = 0.0
            if style == 'crop':
                limit = 1.32 + 0.18 * back - 0.50 * front - 0.10 * side
                limit += 0.28 * front * side
                width += 0.018 * side * middle
                lift += 0.004 * front * middle
            elif style == 'side_part':
                limit = 1.43 + 0.19 * back - 0.52 * front - 0.16 * side
                limit += 0.34 * left * front - 0.15 * right * front
                width += (0.045 * left - 0.020 * right) * middle
                lift += (0.012 * left + 0.006 * back) * middle
                forward += 0.004 * front * left * middle
                sideways -= 0.006 * middle
            elif style == 'bob':
                curtain = front * side
                # The gold bob is an asymmetric salon cut measured against the
                # accepted front/profile reference board: a broad centre part,
                # one longer face-framing sweep and one ear-tucked side. The old
                # symmetric curtain made a geometrically clean helmet.
                limit = 1.42 + 0.48 * back - 0.70 * front + 0.38 * side
                limit += 0.68 * left * curtain + 0.10 * right * curtain
                limit += 0.06 * front
                width += 0.055 * side * span + 0.020 * left * middle
                lift += 0.007 * left * middle
                forward += (0.012 * left - 0.003 * right) * curtain * span
            elif style == 'slick_back':
                limit = 1.42 + 0.28 * back - 0.60 * front - 0.18 * side
                limit += 0.28 * front * side
                width += (0.018 * back - 0.030 * front) * middle
                lift += (0.008 * front + 0.006 * back) * middle
                forward += 0.010 * middle
            elif style == 'quiff':
                limit = 1.35 + 0.16 * back - 0.58 * front - 0.16 * side
                limit += 0.15 * front * side
                width += 0.062 * front * middle
                lift += 0.037 * front * middle * (0.74 + 0.26 * left)
                forward -= 0.020 * front * middle
                sideways -= 0.008 * front * middle
            elif style == 'bun':
                limit = 1.35 + 0.18 * back - 0.42 * front - 0.16 * side
                limit += 0.25 * front * side
                width -= 0.025 * middle
                lift += 0.006 * back * middle
            else:
                base_limit = 1.82 if female else 1.66
                limit = base_limit - 0.98 * front * front
                limit += 0.18 * math.cos(around) * front
            front_drop = {
                'bob': 0.24,
                'side_part': 0.20,
                'slick_back': 0.16,
                'quiff': 0.20,
                'crop': 0.16,
                'bun': 0.18,
            }.get(style, 0.16)
            temple_drop = 0.0 if style == 'bob' else 0.28
            rear_drop = {
                'crop': 0.16,
                'side_part': 0.12,
                'bob': 0.06,
                'slick_back': 0.14,
                'quiff': 0.08,
                'bun': 0.11,
            }.get(style, 0.0)
            limit += front_drop * front * front + temple_drop * side * side + rear_drop * back * back
            angle = 0.14 + span * (limit - 0.14)
            boundary = max(0.0, min(1.0, (span - 0.64) / 0.36))
            boundary = boundary * boundary * (3.0 - 2.0 * boundary)
            # The old bob edge was shrunk to 89% of the shell and therefore
            # sat inside the forehead. The body cut through it as a row of dark
            # triangles. A measured 2% clearance keeps one continuous salon
            # edge without making the whole style float away from the skull.
            boundary_fit = 1.02 if style == 'bob' else 0.87
            edge_taper = 1.0 - (1.0 - boundary_fit) * boundary
            rear_fit = {
                'bob': 0.20,
                'side_part': 0.13,
                'slick_back': 0.08,
                'quiff': 0.05,
            }.get(style, 0.0)
            depth_taper = 1.0 - rear_fit * back * middle
            x = sideways + radius_x * width * edge_taper * math.sin(angle) * math.cos(around)
            y = centre_y + radius_y * depth_taper * edge_taper * math.sin(angle) * math.sin(around) + forward
            z = centre_z + radius_z * math.cos(angle) + lift
            if style == 'bob':
                flow = math.sin(13.0 * around + 5.5 * span)
                z += 0.0017 * flow * middle
                y += 0.0012 * flow * middle
            vertices.append((x, y, z))
    crown = len(vertices)
    vertices.append((0.0, centre_y, centre_z + radius_z + (0.0015 if style == 'bob' else 0.0)))
    for segment in range(segments):
        following = (segment + 1) % segments
        faces.append((crown, following, segment))
    for ring in range(rings - 1):
        first = ring * segments
        second = (ring + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((first + segment, first + following, second + following, second + segment))

    if style == 'bun':
        bun_start = len(vertices)
        bun_segments = 16
        bun_latitudes = tuple(math.radians(value) for value in (-60, -30, 0, 30, 60))
        bottom = len(vertices)
        vertices.append((0.0, 0.058, 1.566))
        for latitude in bun_latitudes:
            for segment in range(bun_segments):
                around = 2.0 * math.pi * segment / bun_segments
                base_join = 1.20 if latitude < math.radians(-45) else 1.0
                vertices.append((
                    0.052 * base_join * math.cos(latitude) * math.cos(around),
                    0.058 + 0.046 * base_join * math.cos(latitude) * math.sin(around),
                    1.620 + 0.054 * math.sin(latitude),
                ))
        top = len(vertices)
        vertices.append((0.0, 0.058, 1.674))
        first_ring = bun_start + 1
        for segment in range(bun_segments):
            following = (segment + 1) % bun_segments
            faces.append((bottom, first_ring + following, first_ring + segment))
        for ring in range(len(bun_latitudes) - 1):
            first = first_ring + ring * bun_segments
            second = first + bun_segments
            for segment in range(bun_segments):
                following = (segment + 1) % bun_segments
                faces.append((first + segment, first + following, second + following, second + segment))
        last_ring = first_ring + (len(bun_latitudes) - 1) * bun_segments
        for segment in range(bun_segments):
            following = (segment + 1) % bun_segments
            faces.append((last_ring + segment, last_ring + following, top))

    faces = [tuple(reversed(face)) for face in faces]
    hair_mesh = bpy.data.meshes.new(obj.name + '_hair_' + style)
    hair_mesh.from_pydata(vertices, [], faces)
    hair_mesh.materials.append(material)
    hair_obj = bpy.data.objects.new(hair_mesh.name, hair_mesh)
    bpy.context.scene.collection.objects.link(hair_obj)
    hair_obj.parent = obj
    head_group = hair_obj.vertex_groups.new(name='head')
    head_group.add(list(range(len(vertices))), 1.0, 'REPLACE')
    armature = armature_of(obj)
    modifier = hair_obj.modifiers.new('armature', 'ARMATURE')
    modifier.object = armature
    hair_obj['hairStyle'] = style
    hair_obj['characterFeature'] = True
    hair_obj['cosmeticSlot'] = 'head'
    layer = hair_mesh.uv_layers.new(name='RiverCharacterAtlas')
    for polygon in hair_mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = hair_mesh.loops[loop_index].vertex_index
            coordinate = hair_mesh.vertices[vertex_index].co
            local_u = 0.5 + coordinate.x / 0.24
            if vertex_index < segments * rings:
                local_v = 1.0 - (vertex_index // segments) / (rings - 1)
            else:
                local_v = 0.5
            layer.data[loop_index].uv = atlas_uv(2, 0, local_u, local_v)
    # Hair is one continuous groomed mass. The general 35-degree prop rule
    # split the crown normals into bright polygon islands under the Rooftop key,
    # which looked like missing scalp patches despite intact geometry and UVs.
    smooth_mesh_by_angle(hair_mesh, 180.0)
    return hair_obj


def mesh_stats(mesh):
    polys = mesh.polygons
    quads = sum(1 for p in polys if len(p.vertices) == 4)
    faces = len(polys)
    return faces, (quads / faces if faces else 0.0)


def armature_of(obj):
    arm = next((m for m in obj.modifiers if m.type == 'ARMATURE'), None)
    if arm is None or not arm.object:
        return None
    return arm.object


def reduce_body(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.mpfb.bake_shapekeys()
    sk = obj.data.shape_keys
    if sk is not None and len(sk.key_blocks):
        mix = obj.shape_key_add(name='residual', from_mix=True)
        if mix is not None:
            obj.shape_key_remove(mix)
    decimate = obj.modifiers.new('reduce', 'DECIMATE')
    decimate.decimate_type = 'UNSUBDIV'
    decimate.iterations = 1
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier='reduce')
    return obj


def strip_opaque_hair_planes(obj):
    mesh = obj.data
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        first, second = edge.vertices
        adjacency[first].append(second)
        adjacency[second].append(first)
    components = []
    seen = set()
    for vertex in mesh.vertices:
        if vertex.index in seen:
            continue
        component = set()
        pending = [vertex.index]
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            seen.add(current)
            pending.extend(adjacency[current])
        components.append(component)
    hair_vertices = set()
    hair_faces = 0
    hair_components = 0
    for component in components:
        points = [mesh.vertices[index].co for index in component]
        z_min = min(point.z for point in points)
        z_max = max(point.z for point in points)
        faces = sum(1 for face in mesh.polygons if all(index in component for index in face.vertices))
        if len(component) <= 18 and faces <= 16 and z_max >= 1.62 and z_max - z_min >= 0.18:
            hair_vertices.update(component)
            hair_faces += faces
            hair_components += 1
    if not hair_vertices:
        return 0, 0, 0
    mesh_data = bmesh.new()
    mesh_data.from_mesh(mesh)
    mesh_data.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh_data, geom=[mesh_data.verts[index] for index in sorted(hair_vertices)], context='VERTS')
    mesh_data.to_mesh(mesh)
    mesh_data.free()
    return hair_components, hair_faces, len(hair_vertices)


def shape_hash(obj):
    """Positional fingerprint. Face counts cannot distinguish two bases whose
    proportions differ, because moving vertices does not change topology."""
    import hashlib
    digest = hashlib.sha256()
    for vertex in obj.data.vertices:
        digest.update(('%.4f,%.4f,%.4f;' % (vertex.co.x, vertex.co.y, vertex.co.z)).encode())
    return digest.hexdigest()[:16]


def checks_for(obj):
    faces, quad = mesh_stats(obj.data)
    tris = sum((1 if len(p.vertices) == 3 else 2) for p in obj.data.polygons)
    groups = len(obj.vertex_groups)
    arm = armature_of(obj)
    bones = len(arm.data.bones) if arm else 0
    checks = []
    if tris > BUDGET['character_triangles']:
        checks.append('triangle budget exceeded {} > {}'.format(tris, BUDGET['character_triangles']))
    if quad < BUDGET['character_quad_min']:
        checks.append('quad ratio {} below {}'.format(round(quad, 3), BUDGET['character_quad_min']))
    if groups < BUDGET['character_groups_min']:
        checks.append('vertex groups {} below {}'.format(groups, BUDGET['character_groups_min']))
    if bones < BUDGET['character_bones_min']:
        checks.append('bones {} below {}'.format(bones, BUDGET['character_bones_min']))
    return {
        'faces': faces,
        'tris': tris,
        'quad': round(quad, 3),
        'groups': groups,
        'bones': bones,
        'checks': checks,
    }


def apply_female_proportions(obj):
    shoulder_group_ids = set()
    hip_group_ids = set()
    for group in obj.vertex_groups:
        low = group.name.lower()
        if any(p in low for p in POISON_NAMES):
            continue
        if any(b in low for b in ('clavicle', 'shoulder', 'upperarm')):
            shoulder_group_ids.add(group.index)
        elif any(b in low for b in ('pelvis', 'thigh', 'thigh01', 'leg0')):
            hip_group_ids.add(group.index)
    if not shoulder_group_ids and not hip_group_ids:
        return obj
    for vertex in obj.data.vertices:
        fx = fy = None
        for element in vertex.groups:
            if element.group in shoulder_group_ids and fx is None:
                fx = 0.9
                fy = 0.95
            elif element.group in hip_group_ids and fx is None:
                fx = 1.08
                fy = 1.03
        if fx is not None:
            vertex.co.x *= fx
            vertex.co.y *= fy
    return obj


def apply_gold_female_identity(human, target_service):
    loaded = []
    for target_name, weight in GOLD_FEMALE_IDENTITY:
        target_path = target_service.target_full_path(target_name)
        if target_path is None:
            raise RuntimeError('missing MPFB identity target ' + target_name)
        target_service.load_target(
            human,
            target_path,
            weight=weight,
            name=target_name,
        )
        loaded.append(target_name)
    human['identityRecipe'] = 'gold_glamorous_female_v1'
    human['identityTargetCount'] = len(loaded)
    print('IDENTITY %s targets=%d recipe=%s' % (
        human.name,
        len(loaded),
        human['identityRecipe'],
    ))
    return human


def create_base(name, female=False):
    from bl_ext.blender_org.mpfb.services import HumanService, TargetService

    macro_details = TargetService.get_default_macro_info_dict()
    macro_details.update({
        'gender': 0.06 if female else 0.94,
        'age': 0.46 if female else 0.50,
        'muscle': 0.36 if female else 0.52,
        'weight': 0.46 if female else 0.50,
        'proportions': 0.56 if female else 0.50,
        'height': 0.58 if female else 0.54,
        'cupsize': 0.58 if female else 0.50,
        'firmness': 0.64 if female else 0.50,
    })
    if female:
        macro_details['race'].update({
            'african': 0.48,
            'asian': 0.12,
            'caucasian': 0.40,
        })
    human = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
        macro_detail_dict=macro_details,
    )
    if female:
        apply_gold_female_identity(human, TargetService)
    human.name = name
    human.data.name = name + '_body'
    bpy.context.view_layer.objects.active = human
    human.select_set(True)
    bpy.ops.mpfb.add_standard_rig()

    # MPFB leaves helper primitives parented to the human. use_selection alone
    # does not exclude them because glTF follows children of selected objects,
    # which is how an 80-triangle Icosphere kept reaching the shipped GLB.
    rig = armature_of(human)
    keep = {human, rig} - {None}
    for obj in list(bpy.data.objects):
        if obj in keep:
            continue
        if obj.type in {'MESH', 'EMPTY'}:
            bpy.data.objects.remove(obj, do_unlink=True)

    return human


def garment_weights(obj, full_sleeves=True, sleeveless=False):
    group_lookup = {}
    for group in obj.vertex_groups:
        low = group.name.lower()
        if any(p in low for p in POISON_NAMES):
            continue
        for bone in GARMENT_BONES:
            if sleeveless and bone in {'upperarm', 'lowerarm'}:
                continue
            if bone == 'lowerarm' and not full_sleeves:
                continue
            if bone in low:
                group_lookup[group.index] = group.name
                break
    if not group_lookup:
        return {}
    vert_weights = {}
    for vertex in obj.data.vertices:
        total = 0.0
        for element in vertex.groups:
            if element.group in group_lookup:
                total += element.weight
        if total > 0.0:
            vert_weights[vertex.index] = total
    return vert_weights


def garment_vert_indices(obj, threshold=0.25):
    return {index for index, weight in garment_weights(obj).items() if weight >= threshold}


def weld_garment_sources(source, indices, distance):
    source_indices = sorted(indices)
    parents = list(range(len(source_indices)))
    coordinates = [source.vertices[index].co.copy() for index in source_indices]
    buckets = {}
    distance_squared = distance * distance

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def join(left, right):
        left = root(left)
        right = root(right)
        if left != right:
            parents[right] = left

    for local_index, coordinate in enumerate(coordinates):
        cell = tuple(math.floor(component / distance) for component in coordinate)
        for x in range(cell[0] - 1, cell[0] + 2):
            for y in range(cell[1] - 1, cell[1] + 2):
                for z in range(cell[2] - 1, cell[2] + 2):
                    for candidate in buckets.get((x, y, z), ()):
                        if (coordinate - coordinates[candidate]).length_squared <= distance_squared:
                            join(local_index, candidate)
        buckets.setdefault(cell, []).append(local_index)

    clusters = {}
    for local_index, source_index in enumerate(source_indices):
        clusters.setdefault(root(local_index), []).append(source_index)
    return list(clusters.values())


def smooth_garment_boundaries(obj, iterations=4):
    mesh_data = bmesh.new()
    mesh_data.from_mesh(obj.data)
    boundary = {vertex for edge in mesh_data.edges if len(edge.link_faces) == 1 for vertex in edge.verts}
    for _ in range(iterations):
        bmesh.ops.smooth_vert(
            mesh_data,
            verts=list(boundary),
            factor=0.45,
            use_axis_x=True,
            use_axis_y=True,
            use_axis_z=True,
        )
    mesh_data.to_mesh(obj.data)
    mesh_data.free()
    return len(boundary)


def drape_garment(obj, iterations=6, factor=0.5):
    """Let the cloth hang instead of shrink-wrapping the anatomy.

    The garment is built by pushing body vertices along their own normals, so it
    inherits every contour the body has - including the ones a shirt does not
    show. On the rendered character that is legible as pectorals and a navel
    through an opaque shirt, which reads as a wet t-shirt and was mistaken twice
    for the body poking through the cloth. It is not: it is the cloth, correctly
    drawn, in the shape of a torso.

    Real cloth spans between the points that carry it - shoulders, chest, the
    hem - and ignores everything shallower than its own stiffness. Laplacian
    smoothing on the interior is the cheapest expression of that: it flattens
    high-frequency detail while leaving the overall mass alone, because a
    smoothed vertex moves towards the average of its neighbours, and on a broad
    curve that average is already where it sits.

    Only interior vertices move. The boundary is the hem, the collar and the
    sleeve openings, and those are shaped deliberately.

    Smoothing shrinks a surface slightly, which would once have pulled the cloth
    back inside the body. Over the torso it cannot do any harm now, because
    `uncover_body_under_garment` has taken the body out from under it. The
    sleeves are the limit: they wrap an arm that is still there, and at fourteen
    iterations they shrink far enough to sit inside it, putting a patch of bare
    shoulder through each one. Six is the most this takes before that shows.
    """
    mesh_data = bmesh.new()
    mesh_data.from_mesh(obj.data)
    boundary = {
        vertex for edge in mesh_data.edges if len(edge.link_faces) == 1 for vertex in edge.verts
    }
    interior = [vertex for vertex in mesh_data.verts if vertex not in boundary]
    if not interior:
        mesh_data.free()
        return 0, 0.0
    before = {vertex.index: vertex.co.copy() for vertex in interior}
    for _ in range(iterations):
        bmesh.ops.smooth_vert(
            mesh_data,
            verts=interior,
            factor=factor,
            use_axis_x=True,
            use_axis_y=True,
            use_axis_z=True,
        )
    moved = sum((vertex.co - before[vertex.index]).length for vertex in interior) / len(interior)
    mesh_data.to_mesh(obj.data)
    mesh_data.free()
    return len(interior), moved


def boundary_edge_count(mesh):
    mesh_data = bmesh.new()
    mesh_data.from_mesh(mesh)
    count = sum(1 for edge in mesh_data.edges if len(edge.link_faces) == 1)
    mesh_data.free()
    return count


def uncover_body_under_garment(obj, indices, margin=1):
    """Delete the body faces the cloth covers.

    The clearance pass below pushes garment vertices out of the body, but it
    cannot finish the job: in a crevice narrower than twice the cloth thickness
    there is no position that clears both walls, so a residue of points stays
    behind the surface no matter how many passes run. Measured on the shipped
    character that residue is 29 of 2,112, and it sits exactly where the body is
    most convex - the pectorals and the navel. Those are the points that show,
    and they read as a wet shirt.

    Chasing them with a larger offset makes the cloth balloon. The cheaper and
    more honest fix is the same one that dressed the character in the first
    place: geometry that is not there cannot push through anything. The body
    under the cloth is never seen, so it is deleted.

    A margin of face rings around the opening is kept, because the garment sits
    20mm outside the body and the two boundaries do not coincide. Without it the
    hem and the sleeve ends would look into an open torso, and the material is
    double-sided, so that interior would render rather than disappear.

    Vertices are kept - only faces are removed - so vertex indices stay valid for
    the weight transfer that has already run against them.
    """
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)

    covered = {face for face in bm.faces if all(v.index in indices for v in face.verts)}
    if not covered:
        bm.free()
        return 0, 0

    # Where the cloth stops: a covered vertex that also belongs to an uncovered
    # face is on the rim, and everything within `margin` rings of it stays.
    rim = {
        v.index
        for face in bm.faces
        if face not in covered
        for v in face.verts
        if v.index in indices
    }
    for _ in range(margin):
        rim |= {
            v.index
            for face in bm.faces
            if any(v.index in rim for v in face.verts)
            for v in face.verts
        }

    doomed = [face for face in covered if not any(v.index in rim for v in face.verts)]
    before = len(bm.faces)
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context='FACES_ONLY')
    bm.to_mesh(mesh)
    bm.free()
    return len(doomed), before


def build_garment(
    obj,
    material,
    thickness=0.020,
    threshold=0.25,
    full_sleeves=True,
    sleeveless=False,
):
    weights = garment_weights(obj, full_sleeves, sleeveless)
    indices = {i for i, w in weights.items() if w >= threshold}
    if not indices:
        return None
    source = obj.data
    garment_name = obj.name.replace('char_', 'garment_')
    garment_mesh = bpy.data.meshes.new(garment_name)
    new_verts = []
    vertex_map = {}
    for cluster in weld_garment_sources(source, indices, GARMENT_WELD_DISTANCE):
        coordinates = [source.vertices[index].co for index in cluster]
        normals = [source.vertices[index].normal for index in cluster]
        coordinate = sum(coordinates, start=coordinates[0].copy() * 0.0) / len(coordinates)
        normal = sum(normals, start=normals[0].copy() * 0.0)
        if normal.length > 0.0:
            normal.normalize()
        new_verts.append(tuple(coordinate + normal * thickness))
        target_index = len(new_verts) - 1
        for source_index in cluster:
            vertex_map[source_index] = target_index
    new_faces = []
    seen_faces = set()
    for poly in source.polygons:
        verts = list(poly.vertices)
        if all(i in indices for i in verts):
            face = [vertex_map[i] for i in verts]
            face_key = tuple(sorted(face))
            if len(set(face)) >= 3 and face_key not in seen_faces:
                new_faces.append(face)
                seen_faces.add(face_key)
    # Clear the whole body, not just the vertex each point came from.
    #
    # Offsetting along a vertex normal only guarantees clearance from the
    # surface that vertex belongs to. Near the armpit and the inner shoulder the
    # nearest body surface is the torso rather than the arm the vertex came off,
    # so a point pushed 20mm along the arm's normal still lands inside the
    # chest. Measured on the shipped character: 82 of 2,112 garment vertices sat
    # inside the body, the worst 19.4mm behind the surface, and that is the
    # clipping visible at the sleeves.
    #
    # So the body is queried as a whole. Any point that ends up behind it is
    # pushed back out along the surface normal at the nearest point until it
    # clears. Points already outside are left exactly where they were, so this
    # tightens nothing that was already correct.
    body_points = [obj.matrix_world @ vertex.co for vertex in source.vertices]
    body_polygons = [tuple(polygon.vertices) for polygon in source.polygons]
    tree = BVHTree.FromPolygons(body_points, body_polygons, all_triangles=False)
    inverse = obj.matrix_world.inverted()
    # A few passes, because moving one point changes which body surface is
    # nearest to it: in the armpit and the inner elbow the closest surface after
    # a push is a different one from before.
    #
    # It does not converge, and it is not meant to. In a crevice narrower than
    # twice the cloth thickness there is no position that clears both walls, so
    # those points oscillate. What matters is not whether every vertex reaches
    # full clearance but whether any of them are left *behind* the body, and
    # three passes takes that from 82 of 2,112 to 29. The rest is a lower bound
    # set by the geometry, not by the number of passes.
    for _ in range(3):
        moved = 0
        for index, local in enumerate(new_verts):
            world = obj.matrix_world @ Vector(local)
            nearest = tree.find_nearest(world)
            if nearest[0] is None:
                continue
            location, surface_normal, _, _ = nearest
            if (world - location).dot(surface_normal) >= thickness:
                continue
            new_verts[index] = tuple(inverse @ (location + surface_normal * thickness))
            moved += 1
        if moved == 0:
            break
    behind = sum(
        1
        for local in new_verts
        for nearest in [tree.find_nearest(obj.matrix_world @ Vector(local))]
        if nearest[0] is not None
        and ((obj.matrix_world @ Vector(local)) - nearest[0]).dot(nearest[1]) < 0.0
    )
    print('GARMENT %s: %d of %d vertices left inside the body'
          % (garment_name, behind, len(new_verts)))

    garment_mesh.from_pydata(new_verts, [], new_faces)
    garment_mesh.materials.append(material)
    garment_obj = bpy.data.objects.new(garment_name, garment_mesh)
    bpy.context.scene.collection.objects.link(garment_obj)
    garment_obj.parent = obj

    # The garment is a subset of body vertices, so the body already holds the
    # correct weights. Previously they were dropped on the duplicate and the
    # garment exported with zero vertex groups - it stayed rigid while the body
    # animated, tearing the character apart on every clip.
    for group in obj.vertex_groups:
        garment_obj.vertex_groups.new(name=group.name)
    for source_index, target_index in vertex_map.items():
        for element in source.vertices[source_index].groups:
            group_name = obj.vertex_groups[element.group].name
            garment_obj.vertex_groups[group_name].add(
                [target_index], element.weight, 'REPLACE'
            )

    armature = armature_of(obj)
    if armature is not None:
        modifier = garment_obj.modifiers.new('armature', 'ARMATURE')
        modifier.object = armature

    # Last, because it invalidates the polygon list the weight transfer above
    # reads. Faces only, so the vertex indices that transfer used stay valid.
    removed, total = uncover_body_under_garment(obj, indices)
    print('BODY %s: %d of %d faces removed from under the garment'
          % (obj.name, removed, total))

    return garment_obj


def add_divided_trousers(garment):
    mesh = garment.data
    start = len(mesh.vertices)
    vertices = []
    faces = []
    weights = []
    segments = 12
    rings = (
        (0.10, 0.080, 0.082, 'lowerleg01'),
        (0.48, 0.096, 0.100, 'lowerleg01'),
        (0.92, 0.118, 0.132, 'upperleg01'),
    )
    for side, centre_x in (('L', -0.105), ('R', 0.105)):
        leg_start = len(vertices)
        for z, radius_x, radius_y, bone in rings:
            for segment in range(segments):
                angle = 2.0 * math.pi * segment / segments
                vertices.append((
                    centre_x + radius_x * math.cos(angle),
                    radius_y * math.sin(angle),
                    z,
                ))
                weights.append(bone + '.' + side)
        for ring in range(len(rings) - 1):
            first = leg_start + ring * segments
            second = first + segments
            for segment in range(segments):
                following = (segment + 1) % segments
                faces.append((first + segment, first + following, second + following, second + segment))
        faces.append(tuple(leg_start + segment for segment in range(segments - 1, -1, -1)))

    bm = bmesh.new()
    bm.from_mesh(mesh)
    new_vertices = [bm.verts.new(coordinate) for coordinate in vertices]
    bm.verts.index_update()
    for face in faces:
        bm.faces.new(tuple(new_vertices[index] for index in face))
    bm.to_mesh(mesh)
    bm.free()

    groups = {group.name: group for group in garment.vertex_groups}
    for offset, bone_name in enumerate(weights):
        group = groups.get(bone_name)
        if group is not None:
            group.add([start + offset], 1.0, 'REPLACE')
    garment['trouserStyle'] = 'divided_basic'
    garment['trouserVertexStart'] = start
    garment['trouserVertexCount'] = len(vertices)
    return len(vertices), len(faces)


def add_evening_skirt(garment):
    mesh = garment.data
    start = len(mesh.vertices)
    segments = 24
    rings = (
        (1.04, 0.225, 0.165),
        (0.82, 0.245, 0.175),
        (0.52, 0.270, 0.190),
        (0.04, 0.305, 0.215),
    )
    vertices = []
    faces = []
    for z, radius_x, radius_y in rings:
        for segment in range(segments):
            angle = 2.0 * math.pi * segment / segments
            vertices.append((
                radius_x * math.cos(angle),
                radius_y * math.sin(angle),
                z,
            ))
    for ring in range(len(rings) - 1):
        first = ring * segments
        second = first + segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((
                first + segment,
                second + segment,
                second + following,
                first + following,
            ))

    bm = bmesh.new()
    bm.from_mesh(mesh)
    new_vertices = [bm.verts.new(coordinate) for coordinate in vertices]
    bm.verts.index_update()
    for face in faces:
        bm.faces.new(tuple(new_vertices[index] for index in face))
    bm.to_mesh(mesh)
    bm.free()

    pelvis = next(
        (group for group in garment.vertex_groups if 'pelvis' in group.name.lower()),
        None,
    )
    if pelvis is None:
        raise RuntimeError('evening skirt requires a pelvis vertex group')
    pelvis.add(list(range(start, start + len(vertices))), 1.0, 'REPLACE')
    garment['skirtStyle'] = 'fitted_column'
    garment['skirtVertexStart'] = start
    garment['skirtVertexCount'] = len(vertices)
    return len(vertices), len(faces)


def reshape_m5_leather(garment):
    for vertex in garment.data.vertices:
        if vertex.co.z > 1.14:
            vertex.co.x *= 1.10
            vertex.co.y *= 1.045
        elif vertex.co.z > 0.88:
            vertex.co.x *= 1.045
    garment['silhouette'] = 'boxy_squared_shoulders'


def reshape_f1_cocktail(garment):
    garment['trouserStyle'] = 'none_sheath'
    garment['silhouette'] = 'sleeveless_column_evening_gown'


def build_outfit_variants(garment, female):
    if garment is None:
        return []
    if female:
        garment.name = garment.name + '_f1_cocktail'
        garment.data.name = garment.data.name + '_f1_cocktail'
        garment['outfitStyle'] = 'f1_cocktail'
        reshape_f1_cocktail(garment)
        apply_garment_atlas(
            garment,
            garment.data.materials[0],
            OUTFIT_RECIPE_CELLS['f1_cocktail_glamorous'],
        )
        return [garment]

    garment.name = garment.name + '_m1_dinner'
    garment.data.name = garment.data.name + '_m1_dinner'
    garment['outfitStyle'] = 'm1_dinner'
    garments = [garment]
    for style in ('m5_leather', 'dealer_ivory'):
        clone = garment.copy()
        clone.data = garment.data.copy()
        clone.name = garment.name.replace('m1_dinner', style)
        clone.data.name = garment.data.name.replace('m1_dinner', style)
        clone['outfitStyle'] = style
        bpy.context.scene.collection.objects.link(clone)
        if style == 'm5_leather':
            reshape_m5_leather(clone)
        else:
            clone['silhouette'] = 'ivory_shawl_dinner_jacket'
        garments.append(clone)
    return garments


def apply_character_materials(obj, material):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(material)
    return obj


def main():
    require_mpfb()
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {'characters': []}
    for name, female in [(MALE, False), (FEMALE, True)]:
        clear_scene()
        obj = create_base(name, female)
        atlas = create_character_atlas(name, female)
        material = add_atlas_material(name + '_atlas_mat', atlas)
        obj = apply_character_materials(obj, material)
        obj = reduce_body(obj)
        hair_components, hair_faces, hair_vertices = strip_opaque_hair_planes(obj)
        # after the bake, not before - bake_shapekeys rewrites vertex positions
        # from the shapekey mix and would discard these edits
        if female:
            apply_female_proportions(obj)
        apply_body_atlas(
            obj,
            material,
            FACE_RECIPE_CELLS['young_glamorous'] if female else FACE_RECIPE_CELLS['young_everyday'],
        )
        eye_faces, eye_specs = remove_eye_shells(obj)
        eyes = add_gold_eyes(obj, eye_specs)
        garment = build_garment(
            obj,
            material,
            full_sleeves=not female,
            sleeveless=female,
        )
        if garment is not None:
            if female:
                trouser_vertices, trouser_faces = add_evening_skirt(garment)
            else:
                trouser_vertices, trouser_faces = add_divided_trousers(garment)
            apply_garment_atlas(garment, material)
        else:
            trouser_vertices, trouser_faces = 0, 0
        hairs = [
            hair
            for style in HAIR_STYLES
            for hair in [build_hair(obj, material, female, style)]
            if hair is not None
        ]
        if garment is not None:
            draped, drape_shift = drape_garment(garment)
            print('DRAPE %s: %d interior vertices, mean shift %.4fm'
                  % (garment.name, draped, drape_shift))
        garment_boundary_vertices = smooth_garment_boundaries(garment) if garment is not None else 0
        smooth_mesh_by_angle(obj.data, 180.0)
        if garment is not None:
            smooth_mesh_by_angle(garment.data, 180.0)
        facial_expressions = add_gold_expressions(obj, eye_specs)
        outfits = build_outfit_variants(garment, female)
        armature = armature_of(obj)
        actions = build_animations(armature) if armature else []
        stats = checks_for(obj)
        hair_faces_total = sum(mesh_stats(hair.data)[0] for hair in hairs)
        hair_quads = sum(
            1
            for hair in hairs
            for polygon in hair.data.polygons
            if len(polygon.vertices) == 4
        )
        hair_tris_by_style = {
            hair['hairStyle']: sum((1 if len(poly.vertices) == 3 else len(poly.vertices) - 2) for poly in hair.data.polygons)
            for hair in hairs
        }
        hair_tris = sum(hair_tris_by_style.values())
        eye_face_count = len(eyes.data.polygons)
        eye_quads = sum(1 for polygon in eyes.data.polygons if len(polygon.vertices) == 4)
        eye_tris = sum(max(1, len(polygon.vertices) - 2) for polygon in eyes.data.polygons)
        if eye_faces == 0:
            stats['checks'].append('eye mass found no source faces')
        if len(hairs) != len(HAIR_STYLES) - 1:
            stats['checks'].append('hair style set incomplete {} != {}'.format(len(hairs), len(HAIR_STYLES) - 1))
        body_quads = sum(1 for polygon in obj.data.polygons if len(polygon.vertices) == 4)
        combined_faces = stats['faces'] + hair_faces_total + eye_face_count
        combined_quad = (body_quads + hair_quads + eye_quads) / combined_faces if combined_faces else 0.0
        character_tris = stats['tris'] + hair_tris + eye_tris
        if character_tris > BUDGET['character_triangles']:
            stats['checks'].append('triangle budget exceeded {} > {}'.format(character_tris, BUDGET['character_triangles']))
        if combined_quad < BUDGET['character_quad_min']:
            stats['checks'].append('quad ratio {} below {}'.format(round(combined_quad, 3), BUDGET['character_quad_min']))
        garment_verts = len(garment.data.vertices) if garment is not None else 0
        garment_tris = sum((1 if len(poly.vertices) == 3 else 2) for poly in garment.data.polygons) if garment is not None else 0
        garment_ratio = garment_verts / garment_tris if garment_tris else 0.0
        garment_boundary_edges = boundary_edge_count(garment.data) if garment is not None else 0
        shape = shape_hash(obj)
        outfit_tris_by_style = {
            outfit['outfitStyle']: sum((1 if len(poly.vertices) == 3 else len(poly.vertices) - 2) for poly in outfit.data.polygons)
            for outfit in outfits
        }
        glb = export_glb(obj, extra=tuple(outfits + hairs + [eyes]))
        manifest['characters'].append({
            'name': name,
            'glb': os.path.basename(glb),
            'faces': stats['faces'],
            'tris': character_tris,
            'body_tris': stats['tris'],
            'hair_tris': hair_tris,
            'hair_tris_by_style': hair_tris_by_style,
            'outfit_tris_by_style': outfit_tris_by_style,
            'eye_faces': eye_faces,
            'replacement_eye_faces': eye_face_count,
            'replacement_eye_tris': eye_tris,
            'facial_expressions': facial_expressions,
            'quad_pct': round(combined_quad, 3),
            'atlas_dimensions': [ATLAS_SIZE, ATLAS_SIZE],
            'vertex_groups': stats['groups'],
            'bones': stats['bones'],
            'actions': actions,
            'garment': garment is not None,
            'checks': stats['checks'],
            'garment_verts': garment_verts,
            'garment_tris': garment_tris,
            'garment_vertex_ratio': garment_ratio,
            'garment_boundary_edges': garment_boundary_edges,
            'garment_boundary_vertices': garment_boundary_vertices,
            'trouser_vertices': trouser_vertices,
            'trouser_faces': trouser_faces,
            'garment_groups': len(garment.vertex_groups) if garment is not None else 0,
            'shape_hash': shape,
        })
        print('CHAR %s faces=%d tris=%d quad=%.3f groups=%d bones=%d garment=%d actions=%d checks=%s' % (
            name, combined_faces, character_tris, combined_quad,
            stats['groups'], stats['bones'], len(garment_vert_indices(obj)),
            len(actions), stats['checks']
        ))
        print('ATLAS %s dimensions=%dx%d hair_triangles=%d styles=%s' % (
            name, ATLAS_SIZE, ATLAS_SIZE, hair_tris, hair_tris_by_style
        ))
        print('EYES %s faces=%d' % (name, eye_faces))
        print('GARMENT %s vertices=%d triangles=%d vertices_per_triangle=%.3f' % (
            name, garment_verts, garment_tris, garment_ratio
        ))
        print('GARMENT_BOUNDARY %s edges=%d vertices=%d' % (
            name, garment_boundary_edges, garment_boundary_vertices
        ))
        print('TROUSERS %s vertices=%d faces=%d' % (name, trouser_vertices, trouser_faces))
        print('HAIR %s components=%d faces=%d vertices=%d' % (
            name, hair_components, hair_faces, hair_vertices
        ))
    with open(os.path.join(OUT_DIR, 'char_manifest.json'), 'w') as handle:
        json.dump(manifest, handle, indent=2)

    # The checker previously recorded violations and exported anyway, which is a
    # log line rather than a gate. Budgets are policy - fail the build.
    failures = [
        '{}: {}'.format(entry['name'], '; '.join(entry['checks']))
        for entry in manifest['characters'] if entry['checks']
    ]
    bases = manifest['characters']
    if len(bases) == 2 and bases[0]['shape_hash'] == bases[1]['shape_hash']:
        failures.append(
            'male and female bases share vertex positions (hash {}) - the '
            'customisation model needs two distinct bases'.format(bases[0]['shape_hash'])
        )
    for entry in manifest['characters']:
        if entry.get('garment') and not entry.get('garment_groups'):
            failures.append(
                '{}: garment has no vertex groups and will not deform'.format(entry['name'])
            )
    if failures:
        for line in failures:
            print('CHECK FAILED ' + line)
        raise SystemExit(1)


FPS = 30
CLIP_SPECS = [
    ('IDLE_breathe', 4.0, True),
    ('PEEK_card', 1.2, False),
    ('PRESET_reach', 0.9, False),
    ('CHIP_toss', 0.8, False),
    ('DEAL_toss', 1.1, False),
    ('ALLIN_standup', 1.8, False),
    ('REACT_win', 1.6, False),
    ('REACT_lose', 1.4, False),
    ('FOLD_muck', 0.7, False),
]


def generate_clip(armature, name, seconds, loop):
    duration = max(1, int(seconds * FPS))
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data_create().action = action
    tracks = {
        'IDLE_breathe': [('spine01', 1.0, 0.5), ('spine02', 1.4, 2.1), ('head', 1.2, 2.0)],
        'PEEK_card': [('head', 8.0, 1.0), ('lowerarm01.L', 28.0, 1.0)],
        'PRESET_reach': [('upperarm01.R', 18.0, 1.0), ('lowerarm01.R', 32.0, 1.0)],
        'CHIP_toss': [('upperarm01.R', 24.0, 1.0), ('lowerarm01.R', 46.0, 1.0)],
        'DEAL_toss': [('upperarm01.L', 22.0, 1.0), ('lowerarm01.L', 40.0, 1.0)],
        'ALLIN_standup': [('upperleg01.L', 42.0, 1.0), ('upperleg01.R', 42.0, 1.0), ('spine01', 18.0, 1.0), ('head', 12.0, 1.0)],
        'REACT_win': [('head', 12.0, 1.0), ('spine01', 16.0, 1.0), ('upperarm01.R', 38.0, 1.0)],
        'REACT_lose': [('head', 16.0, 1.0), ('spine01', 14.0, 1.0), ('upperarm01.L', 28.0, 1.0)],
        'FOLD_muck': [('head', 10.0, 1.0), ('lowerarm01.R', 35.0, 1.0)],
    }
    targets = list(tracks.get(name, []))
    probe = os.environ.get('RIVER_CLIP_PROBE_MISSING_BONE')
    if probe:
        targets.append((probe, 1.0, 1.0))
    missing = [bone_name for bone_name, _, _ in targets if armature.pose.bones.get(bone_name) is None]
    if missing:
        raise SystemExit('FAIL: animation %s references missing bone(s): %s' % (name, ', '.join(missing)))
    for frame in range(duration + 1):
        t = frame / duration
        for bone_name, magnitude, frequency in targets:
            pose_bone = armature.pose.bones.get(bone_name)
            pose_bone.rotation_mode = 'XYZ'
            if loop:
                rads = math.radians(magnitude * math.sin(2.0 * math.pi * frequency * t))
            else:
                rads = math.radians(magnitude * math.sin(math.pi * t))
            pose_bone.rotation_euler = (rads, 0.0, 0.0)
            pose_bone.keyframe_insert('rotation_euler', frame=frame)
    action.frame_range = (0, duration)
    return action


def build_animations(armature):
    actions = []
    for name, seconds, loop in CLIP_SPECS:
        action = generate_clip(armature, name, seconds, loop)
        actions.append(action.name)
    return actions


def export_glb(obj, extra=()):
    """Export only the named pipeline objects.

    The previous version exported the entire scene, which is how the MPFB
    Icosphere scaffolding and a stale armature reached the shipped GLB.
    """
    glb = os.path.join(OUT_DIR, obj.name + '.glb')
    wanted = [obj]
    armature = armature_of(obj)
    if armature is not None:
        wanted.append(armature)
    wanted.extend(o for o in extra if o is not None)

    # Strays are created at several points in the MPFB pipeline, not just at
    # base creation, and use_selection does not exclude children of selected
    # objects. Remove anything not on the manifest immediately before export.
    keep = set(wanted)
    for stray in list(bpy.data.objects):
        if stray not in keep and stray.type in {'MESH', 'EMPTY'}:
            bpy.data.objects.remove(stray, do_unlink=True)

    bpy.ops.object.select_all(action='DESELECT')
    for target in wanted:
        target.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=glb,
        check_existing=False,
        export_format='GLB',
        export_materials='EXPORT',
        export_yup=True,
        export_apply=False,
        export_extras=True,
        use_selection=True,
    )
    return glb


if __name__ == '__main__':
    main()

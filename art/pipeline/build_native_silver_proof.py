"""Deterministic source build for the River silver male ("silver" is the male gold
standard; the female counterpart is "gold" and is owned by the Codex lane).

Mirrors the method of build_native_gold_proof.py - native CC0 MakeHuman assets through
MPFB2, a named identity recipe of morph targets, a builtin rig at River's measured scale
- but owns its own identity, wardrobe and material authoring. It does not import from or
modify the gold builder.

Run: blender --background --python art/pipeline/build_native_silver_proof.py
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-silver')
MPFB_DATA = os.path.join(
    os.environ['APPDATA'], 'Blender Foundation', 'Blender', '5.2', 'mpfb')

# Every weight here was set by rendering and looking, not by estimation. The comments
# record which pass rejected which value, because the failures were not obvious and
# re-deriving them costs a render each.
SILVER_MALE_IDENTITY = (
    # Cranium. v1 used head-scale-depth-incr with head-rectangular and produced a
    # conehead - the occiput ballooned back and up while the face plane stayed small.
    ('head-oval', 0.38), ('head-square', 0.28), ('head-rectangular', 0.06),
    ('head-back-scale-depth-decr', 0.15), ('head-scale-vert-decr', 0.18),
    ('head-scale-horiz-decr', 0.08),
    # Forehead is plane definition and backward rake only. Rescaling forehead height to
    # chase a badly placed hairline displaces the brow and breaks the skull.
    ('forehead-nubian-decr', 0.22), ('forehead-temple-incr', 0.12),
    # Brow ridge projection is the single strongest male cue and no pass before v5 used
    # it. v5 set it to 0.48, which built a shelf and sank the eyes behind it.
    ('eyebrows-trans-forward', 0.20), ('eyebrows-trans-down', 0.14),
    ('eyebrows-angle-down', 0.16),
    ('l-eye-scale-decr', 0.06), ('r-eye-scale-decr', 0.06),
    ('l-eye-push1-in', 0.24), ('r-eye-push1-in', 0.24),
    ('l-eye-eyefold-down', 0.22), ('r-eye-eyefold-down', 0.22),
    ('l-eye-height1-decr', 0.12), ('r-eye-height1-decr', 0.12),
    ('l-eye-bag-incr', 0.10), ('r-eye-bag-incr', 0.10),
    ('l-cheek-bones-incr', 0.50), ('r-cheek-bones-incr', 0.50),
    ('l-cheek-trans-up', 0.15), ('r-cheek-trans-up', 0.15),
    ('l-cheek-volume-decr', 0.34), ('r-cheek-volume-decr', 0.34),
    ('l-cheek-inner-decr', 0.28), ('r-cheek-inner-decr', 0.28),
    # The nose narrows in one pass. Earlier passes widened it, which is the wrong
    # direction for this character: the reference's bulbous tip is what River avoids.
    ('nose-scale-vert-incr', 0.20), ('nose-scale-horiz-decr', 0.20),
    ('nose-width1-decr', 0.18), ('nose-width2-decr', 0.16), ('nose-width3-decr', 0.14),
    ('nose-nostrils-width-decr', 0.16), ('nose-point-width-decr', 0.26),
    ('nose-greek-decr', 0.24), ('nose-hump-decr', 0.08),
    ('nose-scale-depth-incr', 0.18), ('nose-point-down', 0.08),
    ('mouth-scale-horiz-incr', 0.30), ('mouth-upperlip-volume-decr', 0.14),
    ('mouth-lowerlip-volume-decr', 0.22), ('mouth-philtrum-volume-incr', 0.26),
    ('mouth-cupidsbow-incr', 0.12), ('mouth-laugh-lines-out', 0.15),
    # Gonial corner carries the jaw. chin-width goes DOWN - v2 raised it to 0.30 and the
    # lower face read as a slab.
    ('chin-bones-incr', 0.52), ('chin-width-decr', 0.10),
    ('chin-prominent-incr', 0.34), ('chin-prognathism-incr', 0.16),
    ('chin-height-incr', 0.10),
    ('neck-scale-horiz-incr', 0.22), ('neck-scale-depth-incr', 0.16),
    ('neck-scale-vert-decr', 0.14), ('measure-neck-circ-incr', 0.22),
    ('l-ear-scale-decr', 0.12), ('r-ear-scale-decr', 0.12),
    ('l-ear-flap-decr', 0.20), ('r-ear-flap-decr', 0.20),
    ('l-ear-trans-forward', 0.06), ('r-ear-trans-forward', 0.06),
    # Breadth is one budget. Shoulder stays restrained and the pelvis narrows so the
    # shoulder overhangs it; stacking three separate "slight" widenings makes a superhero.
    ('torso-vshape-incr', 0.34), ('measure-shoulder-dist-incr', 0.20),
    ('measure-hips-circ-decr', 0.18), ('torso-scale-depth-incr', 0.20),
    ('measure-waist-circ-decr', 0.14),
)

# Age sits at 0.45 rather than the late-thirties value the character reads as, because a
# higher age macro quietly rounds off the gonial corner the male read depends on. Age is
# carried by the eye bag and nasolabial targets above instead.
MACROS = {'gender': 0.96, 'age': 0.45, 'muscle': 0.52, 'weight': 0.44,
          'proportions': 0.72, 'height': 0.58}
RACE = {'african': 0.18, 'asian': 0.12, 'caucasian': 0.70}

ASSETS = {
    'eyes': ('eyes', 'high-poly', 'high-poly.mhclo'),
    'eyelashes': ('eyelashes', 'eyelashes01', 'eyelashes01.mhclo'),
    'eyebrows': ('eyebrows', 'eyebrow007', 'eyebrow007.mhclo'),
    # short04, the slick-back, deliberately mirroring the gold character's slick bun: a
    # controlled mass with directional flow reads far better at table distance than a
    # textured crop, whose value is all in strand breakup that the downscale eats.
    #
    # It was rejected in an earlier pass for showing white scalp through the alpha gaps at
    # the crown. That was never the hair's fault - the gaps were revealing bright forehead
    # skin, and the scalp shadow in match_extremity_skin_tone now sits underneath. The
    # reason it looked worse than short02 is gone.
    'hair': ('hair', 'short04', 'short04.mhclo'),
    'suit': ('clothes', 'male_elegantsuit01', 'male_elegantsuit01.mhclo'),
    'shoes': ('clothes', 'shoes01', 'shoes01.mhclo'),
    'skin': ('skins', 'middleage_caucasian_male', 'middleage_caucasian_male.mhmat'),
}
SUIT_DIFFUSE = ('clothes', 'male_elegantsuit01', 'male_elegantsuit01_diffuse.png')


def asset_path(name):
    path = os.path.join(MPFB_DATA, *ASSETS[name])
    if not os.path.exists(path):
        raise SystemExit('FAIL: missing native MPFB asset ' + path)
    return path


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_area(name, location, colour, energy, size, target):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color, data.shape, data.size = energy, colour, 'DISK', size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def principled(material):
    return next(
        (n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


def tint(obj, colour, strength, blend, roughness, specular):
    """Recolour every material on obj.

    MakeHuman assets are inconsistent about whether Base Color carries a texture or a
    flat value - the garments are textured, shoes01 is flat. Handling only the linked
    case leaves the shoes brown while still applying the new roughness, which produced
    glossy tan brogues under a black dinner suit.
    """
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        bsdf = principled(material)
        if bsdf is None:
            continue
        base = bsdf.inputs.get('Base Color')
        if base is not None:
            if base.is_linked:
                link = base.links[0]
                source = link.from_socket
                material.node_tree.links.remove(link)
                mix = material.node_tree.nodes.new('ShaderNodeMixRGB')
                mix.blend_type = blend
                mix.inputs['Fac'].default_value = strength
                mix.inputs['Color2'].default_value = (*colour, 1.0)
                material.node_tree.links.new(source, mix.inputs['Color1'])
                material.node_tree.links.new(mix.outputs['Color'], base)
            else:
                base.default_value = (*colour, 1.0)
        for key, value in (('Roughness', roughness), ('Specular IOR Level', specular)):
            socket = bsdf.inputs.get(key)
            if socket is None:
                continue
            for link in list(socket.links):
                material.node_tree.links.remove(link)
            socket.default_value = value
        coat = bsdf.inputs.get('Coat Weight')
        if coat is not None:
            coat.default_value = 0.0


def _dilate(mask, iterations):
    grown = mask.copy()
    for _ in range(iterations):
        step = grown.copy()
        step[1:, :] |= grown[:-1, :]
        step[:-1, :] |= grown[1:, :]
        step[:, 1:] |= grown[:, :-1]
        step[:, :-1] |= grown[:, 1:]
        grown = step
    return grown


def author_black_tie_maps():
    """Convert the stock business suit atlas into black tie.

    The atlas is already a near-black barathea, so the only element standing between it
    and black tie is the navy striped tie - the one chromatic island in an otherwise
    greyscale texture. It is therefore located by measurement (blue channel above red)
    rather than by hardcoded coordinates, which would silently rot if the asset changed.

    Taking the bounding box of the blue pixels and filling it recoloured 152,838 pixels
    against 5,821 actually-blue ones and painted a rectangular satin slab across the
    chest. Dilating the mask bridges the white stripes between the navy ones without
    reaching the shirt, and the guard below fails the build rather than shipping a slab.
    """
    source = bpy.data.images.load(os.path.join(MPFB_DATA, *SUIT_DIFFUSE))
    width, height = source.size
    pixels = np.array(source.pixels[:], dtype=np.float32).reshape(height, width, 4)
    rgb = pixels[:, :, :3]
    luminance = rgb.mean(axis=2)

    blue = (rgb[:, :, 2] - rgb[:, :, 0]) > 0.045
    if int(blue.sum()) < 500:
        raise SystemExit('FAIL: tie island not found (%d chromatic px)' % int(blue.sum()))
    tie = _dilate(blue, 7) & (luminance > 0.06)
    print('TIE blue=%d recoloured=%d' % (int(blue.sum()), int(tie.sum())))
    if int(tie.sum()) > 80000:
        raise SystemExit('FAIL: tie mask leaked (%d px)' % int(tie.sum()))

    out = pixels.copy()
    out[tie, 0], out[tie, 1], out[tie, 2] = 0.030, 0.029, 0.033

    cloth = (~tie) & (luminance < 0.35)
    for channel, multiplier, floor in ((0, 0.50, 0.020), (1, 0.52, 0.020),
                                       (2, 0.56, 0.024)):
        out[cloth, channel] = np.maximum(out[cloth, channel] * multiplier, floor)
    print('CLOTH floored=%d' % int(cloth.sum()))

    diffuse_path = os.path.join(OUT, 'river_silver_suit_diffuse.png')
    diffuse = bpy.data.images.new('river_silver_suit_diffuse', width, height, alpha=True)
    diffuse.pixels = out.reshape(-1).tolist()
    diffuse.filepath_raw = diffuse_path
    diffuse.file_format = 'PNG'
    diffuse.save()

    # Barathea wool, cotton shirt and satin tie cannot share one roughness scalar.
    rough = np.full((height, width), 0.72, dtype=np.float32)
    rough[luminance > 0.55] = 0.56
    rough[tie] = 0.21
    stack = np.stack([rough, rough, rough, np.ones_like(rough)], axis=2)
    rough_path = os.path.join(OUT, 'river_silver_suit_roughness.png')
    roughness = bpy.data.images.new('river_silver_suit_roughness', width, height,
                                    alpha=True, is_data=True)
    roughness.pixels = stack.reshape(-1).tolist()
    roughness.filepath_raw = rough_path
    roughness.file_format = 'PNG'
    roughness.save()
    return diffuse_path, rough_path


def apply_black_tie(obj, diffuse_path, rough_path):
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        bsdf = principled(material)
        if bsdf is None:
            continue
        tree = material.node_tree
        for node in tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and \
                    'diffuse' in node.image.name.lower():
                node.image = bpy.data.images.load(diffuse_path)
        texture = tree.nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(rough_path)
        texture.image.colorspace_settings.name = 'Non-Color'
        texture.location = (-600, -300)
        socket = bsdf.inputs.get('Roughness')
        for link in list(socket.links):
            tree.links.remove(link)
        tree.links.new(texture.outputs['Color'], socket)
        specular = bsdf.inputs.get('Specular IOR Level')
        if specular is not None:
            for link in list(specular.links):
                tree.links.remove(link)
            specular.default_value = 0.26
        coat = bsdf.inputs.get('Coat Weight')
        if coat is not None:
            coat.default_value = 0.0


def _region_triangles(obj, tokens, threshold=0.5):
    """UV triangles of every polygon owned entirely by the named vertex groups."""
    mesh = obj.data
    indices = {g.index for g in obj.vertex_groups
               if any(token in g.name.lower() for token in tokens)}
    if not indices:
        return []
    owned = set()
    for vertex in mesh.vertices:
        for group in vertex.groups:
            if group.group in indices and group.weight > threshold:
                owned.add(vertex.index)
                break
    uv_layer = mesh.uv_layers.active.data
    triangles = []
    for polygon in mesh.polygons:
        if not all(index in owned for index in polygon.vertices):
            continue
        loops = list(polygon.loop_indices)
        for corner in range(1, len(loops) - 1):
            triangles.append((
                tuple(uv_layer[loops[0]].uv),
                tuple(uv_layer[loops[corner]].uv),
                tuple(uv_layer[loops[corner + 1]].uv),
            ))
    return triangles


def _rasterise(triangles, width, height):
    mask = np.zeros((height, width), dtype=bool)
    for a, b, c in triangles:
        xs = np.array([a[0], b[0], c[0]], dtype=np.float64) * width
        ys = np.array([a[1], b[1], c[1]], dtype=np.float64) * height
        x0 = int(max(0, math.floor(xs.min())))
        x1 = int(min(width - 1, math.ceil(xs.max())))
        y0 = int(max(0, math.floor(ys.min())))
        y1 = int(min(height - 1, math.ceil(ys.max())))
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        denominator = ((ys[1] - ys[2]) * (xs[0] - xs[2])
                       + (xs[2] - xs[1]) * (ys[0] - ys[2]))
        if abs(denominator) < 1e-12:
            continue
        px, py = gx + 0.5, gy + 0.5
        w0 = ((ys[1] - ys[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (py - ys[2])) / denominator
        w1 = ((ys[2] - ys[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (py - ys[2])) / denominator
        inside = (w0 >= -0.003) & (w1 >= -0.003) & ((1.0 - w0 - w1) >= -0.003)
        mask[gy[inside], gx[inside]] = True
    return mask


def _dilate(mask, iterations):
    grown = mask.copy()
    for _ in range(iterations):
        step = grown.copy()
        step[1:, :] |= grown[:-1, :]
        step[:-1, :] |= grown[1:, :]
        step[:, 1:] |= grown[:, :-1]
        step[:, :-1] |= grown[:, 1:]
        grown = step
    return grown


def _blur(field, iterations):
    out = field
    for _ in range(iterations):
        padded = np.pad(out, 1, mode='edge')
        out = (padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2]
               + padded[1:-1, 2:] + out) / 5.0
    return out


def _scalp_weights(obj, hair, near=0.020, far=0.065):
    """Per-vertex 0..1 weight for how covered by hair a body vertex is.

    Measured by distance to the hair surface rather than by height, so it follows the
    actual hairline the asset has - including the temple recession - instead of a
    horizontal band that would cut across the forehead.
    """
    to_hair = hair.matrix_world.inverted() @ obj.matrix_world
    weights = np.zeros(len(obj.data.vertices), dtype=np.float32)
    distances = np.full(len(obj.data.vertices), np.inf, dtype=np.float32)
    for index, vertex in enumerate(obj.data.vertices):
        point = to_hair @ vertex.co
        hit, location, _, _ = hair.closest_point_on_mesh(point)
        if not hit:
            continue
        distances[index] = (location - point).length
    finite = distances[np.isfinite(distances)]
    if finite.size:
        print('SCALP distance mm p1=%.1f p5=%.1f p10=%.1f p25=%.1f median=%.1f'
              % tuple(np.percentile(finite, [1, 5, 10, 25, 50]) * 1000.0))
    weights = np.clip((far - distances) / (far - near), 0.0, 1.0).astype(np.float32)
    weights[~np.isfinite(distances)] = 0.0
    return weights


def _rasterise_weighted(obj, weights, width, height):
    """Rasterise per-vertex weights into the atlas, so the shadow fades with the hairline."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active.data
    field = np.zeros((height, width), dtype=np.float32)
    for polygon in mesh.polygons:
        loops = list(polygon.loop_indices)
        corner_weights = [weights[mesh.loops[loop].vertex_index] for loop in loops]
        if max(corner_weights) <= 0.0:
            continue
        value = float(sum(corner_weights) / len(corner_weights))
        uvs = [tuple(uv_layer[loop].uv) for loop in loops]
        for corner in range(1, len(uvs) - 1):
            triangle = (uvs[0], uvs[corner], uvs[corner + 1])
            mask = _rasterise([triangle], width, height)
            field[mask] = np.maximum(field[mask], value)
    return field


def darken_scalp_under_hair(pixels, obj, hair, width, height):
    """Lay a hair-shadow gradient on the scalp beneath and just past the hair edge.

    The hair shell is alpha-cut, so its fringe is partially transparent and its edge is
    ragged by design. Over bright forehead skin that reads as a hard scalloped band -
    the single most cap-like thing left on the character. Darkening the skin underneath
    means a gap shows shadow rather than lit scalp, and the transition softens instead of
    terminating.

    This is not a painted transition standing in for geometry: the shell is already
    conformed to the skull. It is the shading half of the same fix.
    """
    weights = _scalp_weights(obj, hair)
    covered = int((weights > 0).sum())
    if covered < 200:
        raise SystemExit('FAIL: scalp weighting found only %d covered vertices' % covered)
    field = _blur(_rasterise_weighted(obj, weights, width, height), 6)
    field = np.clip(field, 0.0, 1.0)[:, :, None]
    shadow = np.array([0.26, 0.20, 0.17], dtype=np.float32)
    pixels[:, :, :3] = (pixels[:, :, :3] * (1.0 - field)
                        + pixels[:, :, :3] * shadow * field)
    print('SCALP covered_verts=%d shaded_px=%d' % (covered, int((field > 0.02).sum())))
    return pixels


def match_extremity_skin_tone(obj, hair=None):
    """Bring the hands and feet to the face's tone in the skin atlas.

    MakeHuman paints the head islands warm and saturated and the hand and foot islands
    noticeably paler and greyer. Measured on this atlas: head mean (0.794, 0.526, 0.432)
    against hands (0.800, 0.621, 0.519) - 11% brighter and far less red, which is why
    the hands read as pale gloves against the face in every render.

    The correction is derived from those measurements at build time rather than hardcoded,
    so it stays correct if the skin asset is swapped. The regions are rasterised from the
    mesh's own UV triangles: the hand and head UV bounding boxes overlap almost completely
    in this atlas, so a box mask would desaturate the face along with the hands.
    """
    image = next(
        (node.image for slot in obj.material_slots
         if slot.material is not None and slot.material.use_nodes
         for node in slot.material.node_tree.nodes
         if node.type == 'TEX_IMAGE' and node.image is not None
         and 'diffuse' in node.image.name.lower()),
        None,
    )
    if image is None:
        raise SystemExit('FAIL: silver body has no skin diffuse to correct')
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)

    extremity = _rasterise(
        _region_triangles(obj, ('hand', 'finger', 'thumb', 'foot', 'toe')), width, height)
    face = _rasterise(_region_triangles(obj, ('head',)), width, height)
    if extremity.sum() < 1000 or face.sum() < 1000:
        raise SystemExit('FAIL: skin regions did not rasterise (hands=%d face=%d)'
                         % (int(extremity.sum()), int(face.sum())))
    # The islands must not overlap, or the correction would fight itself.
    face = face & ~extremity

    face_mean = pixels[face][:, :3].mean(axis=0)
    hand_mean = pixels[extremity][:, :3].mean(axis=0)
    ratio = np.clip(face_mean / np.maximum(hand_mean, 1e-4), 0.5, 1.5)
    print('SKIN face=(%.3f,%.3f,%.3f) hands=(%.3f,%.3f,%.3f) ratio=(%.3f,%.3f,%.3f)'
          % (*face_mean, *hand_mean, *ratio))

    corrected = pixels.copy()
    blend = _dilate(extremity, 3)
    for channel in range(3):
        corrected[blend, channel] = np.clip(
            corrected[blend, channel] * ratio[channel], 0.0, 1.0)

    if hair is not None:
        corrected = darken_scalp_under_hair(corrected, obj, hair, width, height)

    out_path = os.path.join(OUT, 'river_silver_skin_diffuse.png')
    authored = bpy.data.images.new('river_silver_skin_diffuse', width, height, alpha=True)
    authored.pixels = corrected.reshape(-1).tolist()
    authored.filepath_raw = out_path
    authored.file_format = 'PNG'
    authored.save()

    replaced = 0
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image is not None \
                    and node.image.name == image.name:
                node.image = bpy.data.images.load(out_path)
                replaced += 1
    print('SKIN corrected px=%d slots=%d' % (int(blend.sum()), replaced))
    if replaced == 0:
        raise SystemExit('FAIL: corrected skin was authored but never bound')


def conform_hair(obj):
    """Pull the stock hair shell onto the skull.

    It balloons behind and above the head and terminates at a hard horizontal cut across
    the nape, which is most of why a solid hair mesh reads as a moulded cap. The fringe
    is deliberately untouched - only the back, the crown and the nape boundary move.
    """
    coords = np.array([v.co[:] for v in obj.data.vertices], dtype=np.float32)
    centre = Vector((float((coords[:, 0].min() + coords[:, 0].max()) / 2.0),
                     float((coords[:, 1].min() + coords[:, 1].max()) / 2.0),
                     float((coords[:, 2].min() + coords[:, 2].max()) / 2.0)))
    z_min, z_max = float(coords[:, 2].min()), float(coords[:, 2].max())
    nape_top = z_min + (z_max - z_min) * 0.28
    moved = 0
    for vertex in obj.data.vertices:
        delta = vertex.co - centre
        # 0.86/0.93 pulled the crown and occiput inside the skull, and the scalp came
        # through as a bald patch that is only visible from behind the seat.
        if delta.y > 0:
            delta.y *= 0.93
        delta.x *= 0.98
        if delta.z > 0:
            delta.z *= 0.975
        if vertex.co.z < nape_top:
            delta.x *= 0.90
            delta.y *= 0.90
            moved += 1
        vertex.co = centre + delta
    print('HAIR_CONFORM nape_verts=%d of %d' % (moved, len(obj.data.vertices)))


def build_character():
    from bl_ext.blender_org.mpfb.services import HumanService, TargetService

    macros = TargetService.get_default_macro_info_dict()
    macros.update(MACROS)
    macros['race'].update(RACE)

    human = HumanService.create_human(
        mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
        feet_on_ground=True, scale=0.1, macro_detail_dict=macros)
    human.name = 'river_native_silver_body'
    human.data.name = 'river_native_silver_body_mesh'

    missing = []
    for target_name, weight in SILVER_MALE_IDENTITY:
        target = TargetService.target_full_path(target_name)
        if target is None:
            missing.append(target_name)
            continue
        TargetService.load_target(human, target, weight=weight, name=target_name)
    if missing:
        raise SystemExit('FAIL: missing identity targets: ' + ', '.join(missing))
    print('IDENTITY targets=%d recipe=silver_bond_lead_v1' % len(SILVER_MALE_IDENTITY))

    bpy.ops.object.select_all(action='DESELECT')
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    HumanService.add_builtin_rig(human, 'default_no_toes', import_weights=True)
    HumanService.set_character_skin(asset_path('skin'), human, bodyproxy=None,
                                    skin_type='MAKESKIN', material_instances=True)

    attached = {}
    for name, kind in (('eyes', 'eyes'), ('eyelashes', 'eyelashes'),
                       ('eyebrows', 'eyebrows'), ('hair', 'hair'),
                       ('suit', 'Clothes'), ('shoes', 'Clothes')):
        obj = HumanService.add_mhclo_asset(
            asset_path(name), human, asset_type=kind, subdiv_levels=1,
            material_type='MAKESKIN', set_up_rigging=True, interpolate_weights=True,
            import_weights=True)
        obj.name = 'river_silver_' + name
        attached[name] = obj

    conform_hair(attached['hair'])
    # After the shell is conformed, so the scalp shadow follows where the hair actually
    # sits rather than where the stock asset put it.
    match_extremity_skin_tone(human, attached['hair'])
    diffuse_path, rough_path = author_black_tie_maps()
    apply_black_tie(attached['suit'], diffuse_path, rough_path)

    tint(attached['hair'], (0.038, 0.026, 0.018), 0.94, 'MULTIPLY', 0.54, 0.18)
    tint(attached['eyebrows'], (0.070, 0.048, 0.034), 0.85, 'MULTIPLY', 0.68, 0.10)
    tint(human, (0.90, 0.76, 0.66), 0.70, 'MULTIPLY', 0.58, 0.32)
    # Replaced rather than tinted. The stock shoe material survived a MULTIPLY at full
    # strength and still rendered polished mahogany, so something in its node graph
    # bypasses the base-colour rewire. The export flattens it to patent black anyway;
    # doing the same here keeps the proof and the shipped asset from disagreeing about
    # what colour the shoes are.
    patent = bpy.data.materials.new('river_silver_patent')
    patent.use_nodes = True
    patent_bsdf = patent.node_tree.nodes.get('Principled BSDF')
    patent_bsdf.inputs['Base Color'].default_value = (0.022, 0.022, 0.026, 1.0)
    patent_bsdf.inputs['Roughness'].default_value = 0.20
    patent_bsdf.inputs['Specular IOR Level'].default_value = 0.60
    attached['shoes'].data.materials.clear()
    attached['shoes'].data.materials.append(patent)

    for obj in [human, *attached.values()]:
        if obj.type != 'MESH':
            continue
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

    human['riverProof'] = 'native_silver_v1'
    human['sourceLicense'] = 'CC0'
    human['identityRecipe'] = 'silver_bond_lead_v1'
    return human, attached


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    human, attached = build_character()

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('native_silver_world')

    # Flat neutral for judging form, then the gold lane's venue rig so the black-on-black
    # risk is judged where it actually bites rather than under studio light.
    flat = [
        add_area('flat_key', (-1.1, -2.0, 1.95), (1.0, 0.97, 0.94), 300.0, 3.0, (0, 0, 1.6)),
        add_area('flat_fill', (1.3, -1.7, 1.75), (0.95, 0.96, 1.0), 220.0, 3.0, (0, 0, 1.6)),
        add_area('flat_top', (0.0, -0.5, 3.00), (1.0, 1.0, 1.0), 180.0, 2.5, (0, 0, 1.6)),
        add_area('flat_rim', (0.7, 1.6, 2.10), (0.72, 0.80, 1.0), 260.0, 1.4, (0, 0, 1.6)),
    ]
    venue = [
        add_area('venue_key', (-1.5, -2.2, 2.8), (1.0, 0.72, 0.50), 520.0, 2.4, (0, 0, 1.18)),
        add_area('venue_fill', (1.7, -1.0, 2.2), (0.30, 0.48, 1.0), 250.0, 2.0, (0, 0, 1.18)),
        add_area('venue_rim', (0.5, 1.7, 2.5), (0.55, 0.68, 1.0), 420.0, 1.6, (0, 0, 1.18)),
    ]
    for light in venue:
        light.hide_render = True

    data = bpy.data.cameras.new('native_silver_camera')
    data.sensor_fit = 'HORIZONTAL'
    data.angle = math.radians(28.0)
    camera = bpy.data.objects.new('native_silver_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    def render(tag, location, target, resolution=(780, 980)):
        scene.render.resolution_x, scene.render.resolution_y = resolution
        camera.location = location
        look_at(camera, target)
        scene.render.filepath = os.path.join(OUT, 'native-silver-' + tag + '.png')
        bpy.ops.render.render(write_still=True)
        print('RENDER ' + scene.render.filepath)

    scene.world.color = (0.055, 0.058, 0.062)
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.15
    render('face-front', (0.00, -1.25, 1.615), (0.0, 0.0, 1.585))
    render('face-three-quarter', (0.80, -1.00, 1.630), (0.0, 0.0, 1.585))
    render('face-profile', (1.28, -0.06, 1.620), (0.0, 0.0, 1.575))
    render('body-front', (0.00, -4.30, 1.05), (0.0, 0.0, 0.95), (820, 1150))
    render('body-three-quarter', (2.55, -3.45, 1.15), (0.0, 0.0, 0.95), (820, 1150))

    for light in flat:
        light.hide_render = True
    for light in venue:
        light.hide_render = False
    scene.world.color = (0.004, 0.006, 0.009)
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.45
    render('venue-bust', (0.55, -1.55, 1.52), (0.0, 0.0, 1.45), (820, 1000))
    render('venue-body', (2.30, -3.30, 1.30), (0.0, 0.0, 1.00), (820, 1150))

    blend = os.path.join(OUT, 'native-silver-character.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    total = 0
    for obj in [human, *attached.values()]:
        if obj.type != 'MESH':
            continue
        obj.data.calc_loop_triangles()
        count = len(obj.data.loop_triangles)
        total += count
        print('MESH %-34s tris=%d' % (obj.name, count))
    print('PROOF %s meshes=%d triangles=%d' % (blend, 1 + len(attached), total))


if __name__ == '__main__':
    main()

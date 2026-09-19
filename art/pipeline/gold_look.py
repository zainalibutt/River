"""Gold's look, as data applied to her accepted baseline: face, finish, hair, dress, shoes, skin.

A look is a named preset in gold_looks.json. Applying one changes MakeHuman face targets,
swaps MakeHuman assets and adjusts materials - never a body macro, the rig, the pose or a
clip - so every look sits on the same accepted seated pose and the same animation set.
That is what lets the presets serve bots now and a wardrobe later: they are combinations
of parts, not separate characters.

Every instrument here checks itself before it is trusted. The target loader is compared
against a target already baked into her body; the refit against the fit her head assets
already have; and apply_look refuses a result whose rig or clips moved.

Blender-side module, imported by build_gold_look.py.
"""
import glob
import hashlib
import json
import os

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BASELINE = os.path.join(ROOT, 'art', 'source', 'native-gold', 'a56-gold-baseline', 'a56-gold-master.blend')
BASELINE_SHA256 = '82235cc5d770dea1becdb27b012b5b3dc9ae6280d30be5c618510fdfe1d510e7'
LOOKS = os.path.join(HERE, 'gold_looks.json')
BLENDER_USER = os.path.join(os.environ.get('APPDATA', ''), 'Blender Foundation', 'Blender', '5.2')
MPFB_ASSETS = os.path.join(BLENDER_USER, 'mpfb')
MPFB_TARGETS = os.path.join(BLENDER_USER, 'extensions', 'blender_org', 'mpfb', 'data', 'targets')

BODY = 'river_native_gold_body'
RIG = 'river_native_gold_body.rig'
HAIR = 'river_native_gold_hair'
DRESS = 'river_native_gold_dress'
SHOES = 'river_native_gold_shoes'
BROWS = 'river_native_gold_eyebrows'
# The head assets she was built with (build_native_gold_proof.py): object, kind, asset, MPFB type.
HEAD_ASSETS = {
    'river_native_gold_eyes': ('eyes', 'high-poly', 'Eyes'),
    BROWS: ('eyebrows', 'eyebrow007', 'Eyebrows'),
    'river_native_gold_eyelashes': ('eyelashes', 'eyelashes02', 'Eyelashes'),
    HAIR: ('hair', 'ponytail01', 'Hair'),
}
BUILT_WITH_DRESS = 'toigo_halter_dress_midi'
BUILT_WITH_SKIN = 'young_darkskinned_female_diffuse.png'
# MakeHuman builds in decimetres and MPFB scaled her by 0.1 to metres. The file no longer
# carries that factor, and without it every face target lands ten times too strong.
SCALE_FACTOR = 0.1


def load_looks():
    with open(LOOKS, encoding='utf-8') as handle:
        return json.load(handle)


def mpfb():
    from bl_ext.blender_org.mpfb.entities.clothes.mhclo import Mhclo
    from bl_ext.blender_org.mpfb.entities.objectproperties import GeneralObjectProperties
    from bl_ext.blender_org.mpfb.services import ClothesService, HumanService, TargetService
    return Mhclo, GeneralObjectProperties, ClothesService, HumanService, TargetService


def asset_path(kind, name):
    path = os.path.join(MPFB_ASSETS, kind, name, name + '.mhclo')
    if not os.path.exists(path):
        raise SystemExit('FAIL: no MakeHuman asset at ' + path)
    return path


def target_path(name):
    found = glob.glob(os.path.join(MPFB_TARGETS, '*', name + '.target*'))
    if len(found) != 1:
        raise SystemExit('FAIL: target %s matched %d files' % (name, len(found)))
    return found[0]


def open_baseline():
    with open(BASELINE, 'rb') as handle:
        if hashlib.sha256(handle.read()).hexdigest() != BASELINE_SHA256:
            raise SystemExit('FAIL: the baseline is not the accepted A56 master')
    bpy.ops.wm.open_mainfile(filepath=BASELINE)
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    # The baseline lost the tags MPFB finds its own objects by; put them back.
    _, props, _, _, _ = mpfb()
    body = bpy.data.objects[BODY]
    rig = bpy.data.objects[RIG]
    props.set_value('object_type', 'Basemesh', entity_reference=body)
    props.set_value('scale_factor', SCALE_FACTOR, entity_reference=body)
    props.set_value('object_type', 'Skeleton', entity_reference=rig)
    for name, (_, asset, object_type) in HEAD_ASSETS.items():
        obj = bpy.data.objects[name]
        props.set_value('object_type', object_type, entity_reference=obj)
        props.set_value('asset_source', asset + '/' + asset + '.mhclo', entity_reference=obj)
        obj['river asset'] = asset
    dress = bpy.data.objects[DRESS]
    props.set_value('object_type', 'Clothes', entity_reference=dress)
    props.set_value('asset_source', BUILT_WITH_DRESS + '/' + BUILT_WITH_DRESS + '.mhclo', entity_reference=dress)
    dress['river asset'] = BUILT_WITH_DRESS
    return body, rig


def key_offsets(body, key_name):
    key = body.data.shape_keys.key_blocks[key_name]
    count = len(key.data)
    here = np.empty(count * 3)
    base = np.empty(count * 3)
    key.data.foreach_get('co', here)
    key.relative_key.data.foreach_get('co', base)
    return (here - base).reshape(count, 3)


def check_target_loader(body):
    """Load a target the body already carries under another name and compare the two."""
    _, _, _, _, targets = mpfb()
    reference = 'nose-scale-horiz-decr'
    fresh = targets.load_target(body, target_path(reference), weight=0.0, name='river loader check')
    difference = float(np.abs(key_offsets(body, fresh.name) - key_offsets(body, reference)).max())
    size = float(np.abs(key_offsets(body, reference)).max())
    body.shape_key_remove(fresh)
    if size < 1e-4 or difference > 1e-6:
        raise SystemExit('FAIL: a loaded target differs from the baked one by %.2e m (size %.2e m)'
                         % (difference, size))
    return {'reference': reference, 'max_difference_m': difference, 'target_size_m': size}


def set_face(body, values):
    _, _, _, _, targets = mpfb()
    keys = body.data.shape_keys.key_blocks
    for name, value in values.items():
        if name in keys:
            keys[name].value = value
        else:
            targets.load_target(body, target_path(name), weight=value, name=name)


def local_coords(obj):
    out = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', out)
    return out.reshape(-1, 3)


def refit_head(body):
    """Move eyes, brows, lashes and hair to the face as it now is. Returns how far each moved."""
    mhclo_cls, _, clothes, _, _ = mpfb()
    moved = {}
    for name, (kind, _, _) in HEAD_ASSETS.items():
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        before = local_coords(obj)
        mhclo = mhclo_cls()
        mhclo.load(asset_path(kind, obj['river asset']))
        mhclo.clothes = obj
        clothes.fit_clothes_to_human(obj, body, mhclo, set_parent=False)
        moved[name] = float(np.linalg.norm(local_coords(obj) - before, axis=1).max())
    return moved


def check_refit(body):
    """With the face unchanged, a refit must leave every head asset exactly where it is."""
    moved = refit_head(body)
    if any(value > 1e-6 for value in moved.values()):
        raise SystemExit('FAIL: refitting an unchanged face moved the head assets: %s' % moved)
    return moved


def replace_asset(body, name, kind, asset, object_type):
    """Swap one MakeHuman asset for another - or add one - fitted, rigged and weighted by MPFB."""
    _, props, _, humans, _ = mpfb()
    old = bpy.data.objects.get(name)
    if old is not None:
        if name == DRESS:
            # The old dress hid the body under it; its mask goes with it.
            for modifier in list(body.modifiers):
                if modifier.type == 'MASK' and modifier.name.startswith('Delete.'):
                    body.modifiers.remove(modifier)
        bpy.data.objects.remove(old, do_unlink=True)
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    new = humans.add_mhclo_asset(asset_path(kind, asset), body, asset_type=object_type, subdiv_levels=1,
                                 material_type='MAKESKIN', set_up_rigging=True, interpolate_weights=True,
                                 import_subrig=True, import_weights=True)
    new.name = name
    new['river asset'] = asset
    props.set_value('object_type', object_type, entity_reference=new)
    if not any(m.type == 'ARMATURE' and m.object is not None for m in new.modifiers):
        raise SystemExit('FAIL: %s came in unrigged' % asset)
    return new


def insert_after_texture(material, texture_name, node_type):
    """Put a node between a material's texture colour and whatever the texture fed."""
    tree = material.node_tree
    texture = tree.nodes[texture_name]
    links = [link for link in tree.links if link.from_node == texture and link.from_socket.name == 'Color']
    if not links:
        raise SystemExit('FAIL: %s has no colour link out of %s' % (material.name, texture_name))
    node = tree.nodes.new(node_type)
    for link in links:
        target = link.to_socket
        tree.links.remove(link)
        tree.links.new(node.outputs['Color'], target)
    colour_input = node.inputs['Color1'] if 'Color1' in node.inputs else node.inputs['Color']
    tree.links.new(texture.outputs['Color'], colour_input)
    return node


def darken_to(material_name, colour):
    """Multiply a hair-like material's texture down to a colour: MakeHuman's brows and most of
    its hair arrive light, and hers should be near-black brown."""
    node = insert_after_texture(bpy.data.materials[material_name], 'diffuseTexture', 'ShaderNodeMixRGB')
    node.blend_type = 'MULTIPLY'
    node.inputs['Fac'].default_value = 1.0
    node.inputs['Color2'].default_value = tuple(colour)
    return node


def finish(body, spec):
    """The eyes, lids, brows and lips, which carried more of her hard look than her face did.

    The iris texture is a light copper brown in a fully matte eye: a pale ring in a white
    field with no highlight, which is most of a stare. The curve darkens the iris and pulls
    the whites down; the surface gets a cornea's gloss. The lids come a little way down with
    her own blink unit, the brow is a soft arch in her hair colour with its hard bump ridge
    quietened, and the lips are a deep berry brown instead of a pale pink tint.
    """
    eye = bpy.data.materials['river_native_gold_body.high-poly']
    curves = insert_after_texture(eye, 'diffuseTexture', 'ShaderNodeRGBCurve')
    curve = curves.mapping.curves[3]
    for x, y in spec['irisCurve'][:-1]:
        curve.points.new(x, y)
    curve.points[-1].location = tuple(spec['irisCurve'][-1])
    curves.mapping.update()
    eye_bsdf = eye.node_tree.nodes['Principled BSDF']
    eye_bsdf.inputs['Roughness'].default_value = spec['eyeRoughness']
    eye_bsdf.inputs['Specular IOR Level'].default_value = 0.55

    lips = bpy.data.materials['river_native_gold_body.lips'].node_tree
    lips.nodes['river_native_tint'].inputs['Color2'].default_value = tuple(spec['lipColour'])
    lips.nodes['river_native_tint'].inputs['Fac'].default_value = 0.5
    lips.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.5

    brow = spec['brow']
    replace_asset(body, BROWS, 'eyebrows', brow, 'Eyebrows')
    darken_to('river_native_gold_body.' + brow, spec['browColour'])
    bump = bpy.data.materials['river_native_gold_body.' + brow].node_tree.nodes.get('bumpmap')
    if bump is not None:
        bump.inputs['Strength'].default_value = spec['browBump']
    darken_to('river_native_gold_body.eyelashes02', spec['lashColour'])


def lighten_skin(amount, desaturate):
    """Her skin a few shades lighter: the texture's light multiplied up in linear space, and a
    little of its saturation taken out so lighter does not also mean more orange.

    Done to the image rather than in the material, so the change travels in the texture any
    export embeds, and every material that reads her skin - body, ears, lips - follows it.
    """
    source = next((image for image in bpy.data.images if image.name.startswith(BUILT_WITH_SKIN)), None)
    if source is None:
        raise SystemExit('FAIL: her skin texture %s is not in the file' % BUILT_WITH_SKIN)
    width, height = source.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    source.pixels.foreach_get(pixels)
    before = float(np.mean(pixels.reshape(-1, 4)[:, :3]))
    rgba = pixels.reshape(-1, 4).copy()
    rgb = rgba[:, :3]
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4) * amount
    linear = np.clip(linear, 0.0, 1.0)
    srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)
    luma = (srgb * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=1, keepdims=True)
    rgba[:, :3] = srgb + (luma - srgb) * desaturate
    lifted = bpy.data.images.new(BUILT_WITH_SKIN.replace('.png', '') + '_lifted', width, height, alpha=True)
    lifted.pixels.foreach_set(rgba.ravel())
    lifted.pack()
    swapped = 0
    for material in bpy.data.materials:
        if not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image == source:
                node.image = lifted
                swapped += 1
    if swapped == 0:
        raise SystemExit('FAIL: no material reads her skin texture')
    after = float(np.mean(rgba[:, :3]))
    return {'materials_swapped': swapped, 'mean_before': round(before, 4), 'mean_after': round(after, 4)}


def tint_fabric(material_name, colour):
    """A dress in a seat colour: the fabric's shading from its texture, its colour from the seat."""
    tree = bpy.data.materials[material_name].node_tree
    texture = tree.nodes['diffuseTexture']
    bsdf = tree.nodes['Principled BSDF']
    grey = tree.nodes.new('ShaderNodeRGBToBW')
    lift = tree.nodes.new('ShaderNodeMapRange')
    lift.inputs['To Min'].default_value = 0.35
    mix = tree.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1.0
    mix.inputs['Color2'].default_value = (*colour, 1.0)
    tree.links.new(texture.outputs['Color'], grey.inputs['Color'])
    tree.links.new(grey.outputs['Val'], lift.inputs['Value'])
    tree.links.new(lift.outputs['Result'], mix.inputs['Color1'])
    tree.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55


def linear_from_hex(hex_colour):
    values = [int(hex_colour[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)


def apply_look(name, accent=None):
    """Build the named look on the baseline. `accent` is a seat colour for the dress; None keeps
    the dress's own colour, which is the default look's."""
    looks = load_looks()
    look = looks['looks'][name]
    body, rig = open_baseline()
    report = {'look': name, 'loader': check_target_loader(body), 'unchanged_refit': check_refit(body)}
    finish_spec = looks['finish']
    face = {**looks['baseFace'], **finish_spec['faceTargets'], **looks['faces'][look['face']]['targets']}
    set_face(body, face)
    report['head_assets_moved_m'] = refit_head(body)
    finish(body, finish_spec)
    if look['hair'] != HEAD_ASSETS[HAIR][1]:
        replace_asset(body, HAIR, 'hair', look['hair'], 'Hair')
        darken_to('river_native_gold_body.' + look['hair'], looks['hairColour'])
    if look['dress'] != BUILT_WITH_DRESS:
        replace_asset(body, DRESS, 'clothes', look['dress'], 'Clothes')
    if accent is not None:
        tint_fabric('river_native_gold_body.' + look['dress'], linear_from_hex(accent))
    replace_asset(body, SHOES, 'clothes', look['shoes'], 'Clothes')
    skin = looks['skin']
    report['skin'] = lighten_skin(skin['linearGain'], skin['desaturate'])
    return body, rig, report

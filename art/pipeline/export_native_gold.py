import json
import os
import struct

import bpy
from mathutils.kdtree import KDTree


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
PROOF = os.path.join(OUT, 'proofs', 'native-gold', 'native-gold-character.blend')
GLB = os.path.join(OUT, 'char_native_gold.glb')
EXPRESSIONS = {
    'face_blink': {
        'eyeBlinkLeft': 1.0,
        'eyeBlinkRight': 1.0,
    },
    'face_soft_smile': {
        'mouthSmileLeft': 0.58,
        'mouthSmileRight': 0.58,
        'cheekSquintLeft': 0.18,
        'cheekSquintRight': 0.18,
    },
    'face_frustration': {
        'browDownLeft': 0.52,
        'browDownRight': 0.52,
        'mouthFrownLeft': 0.36,
        'mouthFrownRight': 0.36,
    },
}


def glb_json(path):
    with open(path, 'rb') as handle:
        magic, version, _ = struct.unpack('<4sII', handle.read(12))
        if magic != b'glTF' or version != 2:
            raise SystemExit('FAIL: invalid GLB header ' + path)
        chunk_length, chunk_type = struct.unpack('<II', handle.read(8))
        if chunk_type != 0x4E4F534A:
            raise SystemExit('FAIL: first GLB chunk is not JSON')
        return json.loads(handle.read(chunk_length).decode('utf-8'))


def normalise_alpha_modes(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    _, version, _ = struct.unpack_from('<4sII', data, 0)
    offset = 12
    json_length, json_type = struct.unpack_from('<II', data, offset)
    offset += 8
    if version != 2 or json_type != 0x4E4F534A:
        raise SystemExit('FAIL: cannot normalise invalid GLB ' + path)
    gltf = json.loads(data[offset:offset + json_length].decode('utf-8'))
    offset += json_length
    binary_length, binary_type = struct.unpack_from('<II', data, offset)
    offset += 8
    binary = data[offset:offset + binary_length]
    if binary_type != 0x004E4942:
        raise SystemExit('FAIL: native GLB has no binary chunk')

    for material in gltf.get('materials', []):
        name = material.get('name', '').lower()
        if 'bob02' in name:
            material['alphaMode'] = 'BLEND'
            material.pop('alphaCutoff', None)
        else:
            material['alphaMode'] = 'OPAQUE'
            material.pop('alphaCutoff', None)

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    binary += b'\x00' * ((-len(binary)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack('<4sII', b'glTF', 2, total))
    output.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    output.extend(json_bytes)
    output.extend(struct.pack('<II', len(binary), 0x004E4942))
    output.extend(binary)
    with open(path, 'wb') as handle:
        handle.write(output)


def bake_identity_and_compose_expressions(obj):
    shape_keys = obj.data.shape_keys
    if shape_keys is None:
        raise SystemExit('FAIL: native gold body has no shape keys')
    blocks = shape_keys.key_blocks
    basis = blocks.get('Basis')
    if basis is None:
        raise SystemExit('FAIL: native gold body has no Basis shape key')

    basis_coords = [point.co.copy() for point in basis.data]
    identity_keys = [
        key for key in blocks
        if key is not basis and not key.name.startswith('!ex-') and abs(key.value) > 0.000001
    ]
    unit_keys = {
        name: blocks.get('!ex-' + name)
        for expression in EXPRESSIONS.values()
        for name in expression
    }
    missing = sorted(name for name, key in unit_keys.items() if key is None)
    if missing:
        raise SystemExit('FAIL: native gold source missing expression units: ' + ', '.join(missing))

    baked = []
    unit_deltas = {name: [] for name in unit_keys}
    for index, basis_co in enumerate(basis_coords):
        coordinate = basis_co.copy()
        for key in identity_keys:
            coordinate += (key.data[index].co - basis_co) * key.value
        baked.append(coordinate)
        for name, key in unit_keys.items():
            unit_deltas[name].append(key.data[index].co - basis_co)

    for index, coordinate in enumerate(baked):
        basis.data[index].co = coordinate

    composed = []
    for expression_name, weights in EXPRESSIONS.items():
        key = obj.shape_key_add(name=expression_name, from_mix=False)
        for index, coordinate in enumerate(baked):
            result = coordinate.copy()
            for unit_name, weight in weights.items():
                result += unit_deltas[unit_name][index] * weight
            key.data[index].co = result
        key.value = 0.0
        composed.append(key)

    keep = {basis, *composed}
    for key in list(blocks)[::-1]:
        if key not in keep:
            obj.shape_key_remove(key)
    return tuple(EXPRESSIONS)


def reduce_body_keep_expressions(obj, ratio=0.60):
    blocks = obj.data.shape_keys.key_blocks
    basis = blocks.get('Basis')
    morph_names = [key.name for key in blocks if key is not basis]
    source_positions = [point.co.copy() for point in basis.data]
    source_deltas = {
        name: [
            blocks[name].data[index].co - basis.data[index].co
            for index in range(len(basis.data))
        ]
        for name in morph_names
    }

    obj.shape_key_clear()

    modifier = obj.modifiers.new('river_native_gold_lod', 'DECIMATE')
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = False
    modifier_index = obj.modifiers.find(modifier.name)
    if modifier_index > 0:
        obj.modifiers.move(modifier_index, 0)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    tree = KDTree(len(source_positions))
    for index, coordinate in enumerate(source_positions):
        tree.insert(coordinate, index)
    tree.balance()
    source_for_vertex = [tree.find(vertex.co)[1] for vertex in obj.data.vertices]

    if obj.data.shape_keys is None or obj.data.shape_keys.key_blocks.get('Basis') is None:
        obj.shape_key_add(name='Basis', from_mix=False)
    for morph_name in morph_names:
        key = obj.shape_key_add(name=morph_name, from_mix=False)
        for vertex_index, source_index in enumerate(source_for_vertex):
            key.data[vertex_index].co = (
                obj.data.vertices[vertex_index].co + source_deltas[morph_name][source_index]
            )
    duplicate_basis = obj.data.shape_keys.key_blocks.get('Basis.001')
    if duplicate_basis is not None:
        obj.shape_key_remove(duplicate_basis)
    obj.select_set(False)
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def simplify_export_material(obj, colour, roughness, specular_level):
    for slot in obj.material_slots:
        material = slot.material
        if material is None or material.node_tree is None:
            continue
        principled = next(
            (node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'),
            None,
        )
        if principled is None:
            continue
        base_colour = principled.inputs.get('Base Color')
        for link in list(base_colour.links):
            material.node_tree.links.remove(link)
        base_colour.default_value = (*colour, 1.0)
        principled.inputs['Roughness'].default_value = roughness
        specular = principled.inputs.get('Specular IOR Level')
        if specular is not None:
            specular.default_value = specular_level


def limit_texture_dimensions(objects, maximum=1024):
    images = {
        node.image
        for obj in objects
        if obj.type == 'MESH'
        for material in obj.data.materials
        if material is not None and material.node_tree is not None
        for node in material.node_tree.nodes
        if node.type == 'TEX_IMAGE' and node.image is not None
    }
    for image in images:
        width, height = image.size
        largest = max(width, height)
        if largest <= maximum:
            continue
        scale = maximum / largest
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))


def merge_skin_materials(obj):
    materials = list(obj.data.materials)
    skin_index = next(
        (index for index, material in enumerate(materials) if material and material.name.lower().endswith('.body')),
        0,
    )
    lips_index = next(
        (index for index, material in enumerate(materials) if material and material.name.lower().endswith('.lips')),
        skin_index,
    )
    skin = materials[skin_index]
    lips = materials[lips_index]
    for polygon in obj.data.polygons:
        polygon.material_index = 1 if polygon.material_index == lips_index and lips is not skin else 0
    obj.data.materials.clear()
    obj.data.materials.append(skin)
    if lips is not skin:
        obj.data.materials.append(lips)


def share_face_detail_material(*objects):
    material = bpy.data.materials.new('native_gold_face_detail')
    material.use_nodes = True
    principled = material.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (0.025, 0.008, 0.006, 1.0)
    principled.inputs['Roughness'].default_value = 0.48
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(material)


if not os.path.exists(PROOF):
    raise SystemExit('FAIL: missing seated native proof ' + PROOF)

bpy.ops.wm.open_mainfile(filepath=PROOF)
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    for modifier in obj.modifiers:
        modifier.show_viewport = modifier.show_render
body = bpy.data.objects.get('river_native_gold_body')
if body is None:
    raise SystemExit('FAIL: seated proof has no native gold body')

armature = next(
    (
        modifier.object
        for modifier in body.modifiers
        if modifier.type == 'ARMATURE' and modifier.object is not None
    ),
    None,
)
if armature is None:
    raise SystemExit('FAIL: native gold body has no armature')

export_morphs = bake_identity_and_compose_expressions(body)
body_triangles = reduce_body_keep_expressions(body)
body.data.name = 'char_native_gold_body'
merge_skin_materials(body)

hair = bpy.data.objects.get('river_native_gold_hair')
dress = bpy.data.objects.get('river_native_gold_dress')
eyebrows = bpy.data.objects.get('river_native_gold_eyebrows')
eyelashes = bpy.data.objects.get('river_native_gold_eyelashes')
if hair is None or dress is None or eyebrows is None or eyelashes is None:
    raise SystemExit('FAIL: native gold export is missing a required component')
simplify_export_material(hair, (0.035, 0.012, 0.008), 0.43, 0.18)
simplify_export_material(dress, (0.32, 0.012, 0.018), 0.50, 0.22)
share_face_detail_material(eyebrows, eyelashes)

wanted = [
    obj
    for obj in bpy.data.objects
    if obj.name.startswith('river_native_gold_') and obj.type == 'MESH'
]
wanted.append(armature)
if len(wanted) < 7:
    raise SystemExit('FAIL: incomplete native gold export selection')
limit_texture_dimensions(wanted)
for obj in wanted:
    obj['nativeGold'] = True

bpy.ops.object.select_all(action='DESELECT')
for obj in wanted:
    obj.hide_render = False
    obj.select_set(True)
bpy.context.view_layer.objects.active = body

bpy.ops.export_scene.gltf(
    filepath=GLB,
    check_existing=False,
    export_format='GLB',
    export_materials='EXPORT',
    export_yup=True,
    export_apply=False,
    export_extras=True,
    export_lights=False,
    export_cameras=False,
    export_animations=False,
    export_skins=True,
    export_morph=True,
    export_morph_normal=True,
    use_selection=True,
)
normalise_alpha_modes(GLB)

gltf = glb_json(GLB)
target_names = sorted({
    name
    for mesh in gltf.get('meshes', [])
    for name in mesh.get('extras', {}).get('targetNames', [])
})
required = set(export_morphs)
missing = sorted(required - set(target_names))
if missing:
    raise SystemExit('FAIL: native gold GLB missing morphs: ' + ', '.join(missing))
skins = gltf.get('skins', [])
if not skins or max(len(skin.get('joints', [])) for skin in skins) < 60:
    raise SystemExit('FAIL: native gold GLB lost its rig')

print('NATIVE_GLTF %s bytes=%d meshes=%d body_triangles=%d bones=%d morphs=%d' % (
    GLB,
    os.path.getsize(GLB),
    len(gltf.get('meshes', [])),
    body_triangles,
    max(len(skin.get('joints', [])) for skin in skins),
    len(target_names),
))

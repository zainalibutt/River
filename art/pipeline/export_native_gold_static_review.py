import json
import os
import struct

import bpy


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
SOURCE = os.path.join(OUT, 'proofs', 'native-gold', 'native-gold-seated.blend')
GLB = os.path.join(OUT, 'native-review', 'char_native_gold_static.glb')
NAMES = (
    'river_native_gold_body',
    'river_native_gold_dress',
    'river_native_gold_eyes',
    'river_native_gold_hair',
    'river_native_gold_eyebrows',
    'river_native_gold_eyelashes',
)


def simple_material(name, colour, roughness, specular_level=0.20):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*colour, 1.0)
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Specular IOR Level'].default_value = specular_level
    return material


def textured_material(name, image_name, roughness, specular_level, alpha=False):
    image = bpy.data.images.get(image_name)
    if image is None:
        raise SystemExit('FAIL: faithful static review missing texture ' + image_name)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get('Principled BSDF')
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    links.new(texture.outputs['Color'], principled.inputs['Base Color'])
    if alpha:
        links.new(texture.outputs['Alpha'], principled.inputs['Alpha'])
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Specular IOR Level'].default_value = specular_level
    return material


def replace_materials(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.material_index = 0


def add_review_irises(eyes, material):
    vertices = [eyes.matrix_world @ vertex.co for vertex in eyes.data.vertices]
    irises = []
    for side, prefix in ((-1, 'left'), (1, 'right')):
        eye_vertices = [vertex for vertex in vertices if vertex.x * side > 0]
        x_min = min(vertex.x for vertex in eye_vertices)
        x_max = max(vertex.x for vertex in eye_vertices)
        z_min = min(vertex.z for vertex in eye_vertices)
        z_max = max(vertex.z for vertex in eye_vertices)
        radius = min((x_max - x_min) * 0.200, (z_max - z_min) * 0.220)
        centre = (
            (x_min + x_max) * 0.5,
            min(vertex.y for vertex in eye_vertices) - 0.0005,
            (z_min + z_max) * 0.5 - 0.0004,
        )
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=16,
            ring_count=8,
            location=centre,
            scale=(radius, 0.0008, radius),
        )
        iris = bpy.context.object
        iris.name = 'review_native_gold_' + prefix + '_iris'
        iris.data.materials.append(material)
        for uv in iris.data.uv_layers.active.data:
            uv.uv = (0.62, 0.70)
        iris['nativeGold'] = True
        irises.append(iris)
    return irises


def limit_images(objects, maximum=1024):
    images = {
        node.image
        for obj in objects
        for material in obj.data.materials
        if material is not None and material.node_tree is not None
        for node in material.node_tree.nodes
        if node.type == 'TEX_IMAGE' and node.image is not None
    }
    for image in images:
        width, height = image.size
        if max(width, height) <= maximum:
            continue
        scale = maximum / max(width, height)
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))


def make_opaque(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    _, _, _ = struct.unpack_from('<4sII', data, 0)
    offset = 12
    json_length, _ = struct.unpack_from('<II', data, offset)
    offset += 8
    gltf = json.loads(data[offset:offset + json_length].decode('utf-8'))
    offset += json_length
    binary_length, _ = struct.unpack_from('<II', data, offset)
    offset += 8
    binary = data[offset:offset + binary_length]
    for material in gltf.get('materials', []):
        name = material.get('name', '').lower()
        if 'native_gold_static_hair' in name:
            material['alphaMode'] = 'BLEND'
            material.pop('alphaCutoff', None)
            material['doubleSided'] = True
            pbr = material.setdefault('pbrMetallicRoughness', {})
            pbr['baseColorFactor'] = [0.08, 0.025, 0.012, 1.0]
        elif any(token in name for token in ('native_gold_static_brows', 'native_gold_static_lashes')):
            material['alphaMode'] = 'MASK'
            material['alphaCutoff'] = 0.08
            material['doubleSided'] = True
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


if not os.path.exists(SOURCE):
    raise SystemExit('FAIL: missing seated native gold source ' + SOURCE)
os.makedirs(os.path.dirname(GLB), exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SOURCE)
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    for modifier in obj.modifiers:
        modifier.show_viewport = modifier.show_render
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()

baked = []
for name in NAMES:
    source = bpy.data.objects.get(name)
    if source is None:
        raise SystemExit('FAIL: static review missing ' + name)
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(
        evaluated,
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    obj = bpy.data.objects.new('review_native_gold_' + name.rsplit('_', 1)[-1], mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = source.matrix_world.copy()
    obj['nativeGold'] = True
    baked.append(obj)

body, dress, eyes, hair, eyebrows, eyelashes = baked
body.data.name = 'review_native_gold_body'

materials = (
    (body, textured_material('native_gold_static_skin', 'young_darkskinned_female_diffuse.png', 0.48, 0.26)),
    (dress, textured_material('native_gold_static_dress', 'DressClothUV.png', 0.50, 0.22)),
    (eyes, textured_material('native_gold_static_eyes', 'brown_eye.png', 0.24, 0.42)),
    (hair, textured_material('native_gold_static_hair', 'ponytail01_diffuse.png', 0.43, 0.18, True)),
    (eyebrows, textured_material('native_gold_static_brows', 'eyebrow007.png', 0.50, 0.10, True)),
    (eyelashes, textured_material('native_gold_static_lashes', 'eyelashes02.png', 0.50, 0.08, True)),
)
for obj, material in materials:
    replace_materials(obj, material)
iris_material = simple_material('native_gold_static_iris', (0.18, 0.045, 0.018), 0.38, 0.22)
baked.extend(add_review_irises(eyes, iris_material))

for obj in baked:
    if not any(material is not None for material in obj.data.materials):
        raise SystemExit('FAIL: faithful static review lost materials on ' + obj.name)

limit_images(baked)
bpy.ops.object.select_all(action='DESELECT')
for obj in baked:
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
    use_selection=True,
)
make_opaque(GLB)
print('STATIC_NATIVE_GLTF %s bytes=%d meshes=%d' % (GLB, os.path.getsize(GLB), len(baked)))

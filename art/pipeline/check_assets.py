import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from values import BUDGET

GLB_MAGIC = b'glTF'
JSON_TYPE = 0x4E4F534A


def read_glb(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    if len(data) < 12 or data[:4] != GLB_MAGIC:
        raise SystemExit('FAIL: not a GLB file: ' + path)
    version, length = struct.unpack_from('<II', data, 4)
    if version != 2:
        raise SystemExit('FAIL: unsupported GLB version ' + str(version))
    if length != len(data):
        raise SystemExit('FAIL: GLB length mismatch')
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk = data[offset:offset + chunk_length]
        if chunk_type == JSON_TYPE:
            return json.loads(chunk.decode('utf-8'))
        offset += chunk_length
    raise SystemExit('FAIL: no JSON chunk in ' + path)


def triangles_for(gltf):
    accessors = gltf.get('accessors', [])
    total = 0
    for mesh in gltf.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            indices = primitive.get('indices')
            if indices is None:
                attributes = primitive.get('attributes', {})
                position = attributes.get('POSITION')
                if position is None:
                    continue
                count = accessors[position].get('count', 0)
                total += count // 3
            else:
                count = accessors[indices].get('count', 0)
                total += count // 3
    return total


def check(path):
    failures = []
    if not os.path.exists(path):
        raise SystemExit('FAIL: export missing at ' + path)
    gltf = read_glb(path)
    triangles = triangles_for(gltf)
    materials = len(gltf.get('materials', []))
    images = len(gltf.get('images', []))
    if triangles > BUDGET['props_triangles']:
        failures.append(
            'props triangle budget exceeded: {} > {}'.format(triangles, BUDGET['props_triangles'])
        )
    if triangles > BUDGET['scene_triangles']:
        failures.append(
            'scene triangle budget exceeded: {} > {}'.format(triangles, BUDGET['scene_triangles'])
        )
    if materials > BUDGET['max_materials']:
        failures.append(
            'material budget exceeded: {} > {}'.format(materials, BUDGET['max_materials'])
        )
    for image in gltf.get('images', []):
        for attr in ('bufferView', 'uri'):
            if attr in image and len(image[attr]) == 0:
                continue
    if images > 0:
        failures.append('unexpected embedded images: ' + str(images))
    print('CHECK ' + path)
    print('  triangles: ' + str(triangles) + ' / ' + str(BUDGET['props_triangles']))
    print('  materials: ' + str(materials) + ' / ' + str(BUDGET['max_materials']))
    print('  images: ' + str(images))
    if failures:
        for failure in failures:
            print('FAIL ' + failure)
        raise SystemExit(1)
    print('PASS')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: check_assets.py <export.glb>')
    check(sys.argv[1])
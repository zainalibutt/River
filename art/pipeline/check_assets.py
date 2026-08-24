import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from values import BUDGET, CHARACTER_MESH_PREFIX

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
    chunks = {}
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk = data[offset:offset + chunk_length]
        chunks.setdefault(chunk_type, []).append(chunk)
        offset += chunk_length
    json_chunk = chunks.get(JSON_TYPE)
    if not json_chunk:
        raise SystemExit('FAIL: no JSON chunk in ' + path)
    gltf = json.loads(json_chunk[0].decode('utf-8'))
    binary = b''.join(chunks.get(0x004E4942, []))
    return gltf, binary


def png_size(data):
    if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    width, height = struct.unpack_from('>II', data, 16)
    return width, height


def jpeg_size(data):
    if len(data) < 4 or data[:2] != b'\xff\xd8':
        return None
    offset = 2
    while offset + 9 < len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            height, width = struct.unpack_from('>HH', data, offset + 3)
            return width, height
        if 0xD0 <= marker <= 0xD9:
            continue
        length = struct.unpack_from('>H', data, offset)[0]
        offset += length
    return None


def texture_size(data):
    for parser in (png_size, jpeg_size):
        size = parser(data)
        if size is not None:
            return size
    return None


class Report:
    def __init__(self):
        self.per_asset = []
        self.total_triangles = 0
        self.props_triangles = 0
        self.environment_triangles = 0
        self.character_triangles = 0
        self.materials = 0
        self.draw_calls = 0
        self.images = 0
        self.texture_bytes = 0
        self.max_texture_dim = 0
        self.texture_dims = []
        self.characters = []
        self.failures = []
        self.notes = []

    def fail(self, message):
        self.failures.append(message)

    def add_character(self, entry):
        self.characters.append(entry)

    def to_dict(self, path):
        return {
            'asset': os.path.basename(path),
            'per_asset_triangles': self.per_asset,
            'total_triangles': self.total_triangles,
            'props_triangles': self.props_triangles,
            'environment_triangles': self.environment_triangles,
            'character_triangles': self.character_triangles,
            'characters': self.characters,
            'materials': self.materials,
            'draw_calls': self.draw_calls,
            'objects': self.draw_calls,
            'images': self.images,
            'texture_dims': self.texture_dims,
            'max_texture_dim': self.max_texture_dim,
            'texture_bytes': self.texture_bytes,
            'budget': BUDGET,
            'failures': self.failures,
            'verdict': 'PASS' if not self.failures else 'FAIL',
        }


PROPS_PREFIX = 'river_'
CHAR_PREFIX = 'chair_'


def mesh_triangles_for(gltf, accessors, mesh):
    mesh_total = 0
    for primitive in mesh.get('primitives', []):
        indices = primitive.get('indices')
        if indices is None:
            attributes = primitive.get('attributes', {})
            position = attributes.get('POSITION')
            if position is None:
                continue
            count = accessors[position].get('count', 0)
            mesh_total += count // 3
        else:
            count = accessors[indices].get('count', 0)
            mesh_total += count // 3
    return mesh_total


def character_bone_summary(gltf):
    meshes = gltf.get('meshes', [])
    skins = gltf.get('skins', [])
    summary = {}
    for node in gltf.get('nodes', []):
        if 'mesh' not in node or 'skin' not in node:
            continue
        mesh_index = node['mesh']
        mesh_name = meshes[mesh_index].get('name', '') if 0 <= mesh_index < len(meshes) else ''
        if not mesh_name.startswith(CHARACTER_MESH_PREFIX):
            continue
        skin = skins[node['skin']]
        summaries = summary.setdefault(mesh_name, {'bones': 0, 'skinned': True})
        summaries['bones'] = max(summaries['bones'], len(skin.get('joints', [])))
    return summary


def check_characters(gltf, report):
    accessors = gltf.get('accessors', [])
    nodes = gltf.get('nodes', [])
    mesh_by_name = character_meshes(gltf)
    if not mesh_by_name:
        return report
    bone_summary = character_bone_summary(gltf)
    for mesh_name, mesh in mesh_by_name.items():
        tris = mesh_triangles_for(gltf, accessors, mesh)
        primitives = mesh.get('primitives', [])
        has_weights = False
        skinned = False
        for primitive in primitives:
            attributes = primitive.get('attributes', {})
            if 'JOINTS_0' in attributes and 'WEIGHTS_0' in attributes:
                has_weights = True
            if 'JOINTS_0' in attributes:
                skinned = True
        summary = bone_summary.get(mesh_name)
        bones = summary['bones'] if summary else 0
        node_skinned = summary is not None
        entry = {
            'mesh': mesh_name,
            'triangles': tris,
            'skinned': skinned or node_skinned,
            'has_weights': has_weights,
            'bones': bones,
        }
        report.add_character(entry)
    for entry in report.characters:
        if entry['triangles'] > BUDGET['character_triangles']:
            report.fail(
                '{}: triangle budget exceeded {} > {}'.format(
                    entry['mesh'], entry['triangles'], BUDGET['character_triangles']
                )
            )
        if not (entry['skinned'] and entry['has_weights']):
            report.fail(entry['mesh'] + ': no armature binding (skin/weights missing)')
        if entry['bones'] < BUDGET['character_bones_min']:
            report.fail(
                '{}: bone count {} below minimum {}'.format(
                    entry['mesh'], entry['bones'], BUDGET['character_bones_min']
                )
            )
    return report


def compute_counts(gltf, binary, report):
    accessors = gltf.get('accessors', [])
    buffer_views = gltf.get('bufferViews', [])
    buffers = gltf.get('buffers', [])
    mesh_triangles = {}
    for mesh in gltf.get('meshes', []):
        name = mesh.get('name', 'mesh_%d' % len(mesh_triangles))
        mesh_total = mesh_triangles_for(gltf, accessors, mesh)
        mesh_triangles[name] = mesh_total
        report.total_triangles += mesh_total
        if name.startswith(PROPS_PREFIX):
            report.props_triangles += mesh_total
        elif name.startswith(CHARACTER_MESH_PREFIX):
            report.character_triangles += mesh_total
        else:
            report.environment_triangles += mesh_total
    node_meshes = []
    for node in gltf.get('nodes', []):
        if 'mesh' in node:
            node_meshes.append(node.get('name', node.get('mesh', 'node')))
    report.draw_calls = len(node_meshes)
    report.materials = len(gltf.get('materials', []))
    report.images = len(gltf.get('images', []))
    for image in gltf.get('images', []):
        image_data = None
        if 'uri' in image and image['uri'].startswith('data:'):
            import base64
            image_data = base64.b64decode(image['uri'].split(',', 1)[1])
        elif 'bufferView' in image:
            view = buffer_views[image['bufferView']]
            start = view.get('buffer', 0)
            offset = view.get('byteOffset', 0)
            length = view.get('byteLength', 0)
            buffer_bytes = binary
            if buffer_bytes == b'' and 'uri' in buffers[start]:
                raise SystemExit('FAIL: external buffer not supported for images')
            image_data = buffer_bytes[offset:offset + length]
        else:
            report.notes.append('image without embedded content: ' + str(image.get('name')))
            continue
        size = texture_size(image_data)
        report.texture_bytes += len(image_data)
        report.texture_dims.append(size)
        if size is not None:
            report.max_texture_dim = max(report.max_texture_dim, size[0], size[1])
    report.per_asset = [(name, count) for name, count in mesh_triangles.items()]
    check_characters(gltf, report)
    return report


def character_meshes(gltf):
    names = {}
    for mesh in gltf.get('meshes', []):
        name = mesh.get('name', '')
        if name.startswith(CHARACTER_MESH_PREFIX):
            names[name] = mesh
    return names


def check_characters(gltf, report):
    accessors = gltf.get('accessors', [])
    mesh_by_name = character_meshes(gltf)
    if not mesh_by_name:
        return report
    bone_summary = character_bone_summary(gltf)
    for mesh_name, mesh in mesh_by_name.items():
        tris = mesh_triangles_for(gltf, accessors, mesh)
        primitives = mesh.get('primitives', [])
        has_weights = False
        skinned = False
        for primitive in primitives:
            attributes = primitive.get('attributes', {})
            if 'JOINTS_0' in attributes and 'WEIGHTS_0' in attributes:
                has_weights = True
            if 'JOINTS_0' in attributes:
                skinned = True
        summary = bone_summary.get(mesh_name)
        bones = summary['bones'] if summary else 0
        node_skinned = summary is not None
        entry = {
            'mesh': mesh_name,
            'triangles': tris,
            'skinned': skinned or node_skinned,
            'has_weights': has_weights,
            'bones': bones,
        }
        report.add_character(entry)
    for entry in report.characters:
        if entry['triangles'] > BUDGET['character_triangles']:
            report.fail(
                '{}: triangle budget exceeded {} > {}'.format(
                    entry['mesh'], entry['triangles'], BUDGET['character_triangles']
                )
            )
        if not (entry['skinned'] and entry['has_weights']):
            report.fail(entry['mesh'] + ': no armature binding (skin/weights missing)')
        if entry['bones'] < BUDGET['character_bones_min']:
            report.fail(
                '{}: bone count {} below minimum {}'.format(
                    entry['mesh'], entry['bones'], BUDGET['character_bones_min']
                )
            )
    return report


def check(path):
    if not os.path.exists(path):
        raise SystemExit('FAIL: export missing at ' + path)
    gltf, binary = read_glb(path)
    report = Report()
    compute_counts(gltf, binary, report)
    if report.total_triangles > BUDGET['scene_triangles']:
        report.fail(
            'scene triangle budget exceeded: {} > {}'.format(
                report.total_triangles, BUDGET['scene_triangles']
            )
        )
    if report.props_triangles > BUDGET['props_triangles']:
        report.fail(
            'props (table/rail/chips/cards) triangle budget exceeded: {} > {}'.format(
                report.props_triangles, BUDGET['props_triangles']
            )
        )
    if report.environment_triangles > BUDGET['environment_triangles']:
        report.fail(
            'environment triangle budget exceeded: {} > {}'.format(
                report.environment_triangles, BUDGET['environment_triangles']
            )
        )
    if report.materials > BUDGET['max_materials']:
        report.fail(
            'material budget exceeded: {} > {}'.format(report.materials, BUDGET['max_materials'])
        )
    if report.draw_calls > BUDGET['max_draw_calls']:
        report.fail(
            'draw-call budget exceeded: {} > {}'.format(
                report.draw_calls, BUDGET['max_draw_calls']
            )
        )
    if report.max_texture_dim > BUDGET['max_texture_dim']:
        report.fail(
            'texture dimension exceeded: {} > {}'.format(
                report.max_texture_dim, BUDGET['max_texture_dim']
            )
        )
    if report.texture_bytes > BUDGET['texture_mb'] * 1024 * 1024:
        report.fail(
            'texture memory exceeded: {} > {}'.format(
                report.texture_bytes, BUDGET['texture_mb'] * 1024 * 1024
            )
        )
    print('CHECK ' + os.path.basename(path))
    for name, count in report.per_asset:
        print('  asset %-28s %5d tris' % (name, count))
    print('  total        %5d / %d tris' % (report.total_triangles, BUDGET['scene_triangles']))
    print('  props        %5d / %d tris' % (report.props_triangles, BUDGET['props_triangles']))
    print('  environment  %5d / %d tris' % (report.environment_triangles, 80000))
    if report.character_triangles:
        print('  character    %5d tris' % report.character_triangles)
    print('  materials    %3d / %d' % (report.materials, BUDGET['max_materials']))
    print('  draw calls   %3d / %d (objects)' % (report.draw_calls, BUDGET['max_draw_calls']))
    for character in report.characters:
        print(
            '  char %-24s %5d tris  bones %3d  skin=%s  weights=%s' % (
                character['mesh'],
                character['triangles'],
                character['bones'],
                character['skinned'],
                character['has_weights'],
            )
        )
    for dim in report.texture_dims:
        if dim is not None:
            print('  texture      %dx%d' % dim)
    print('  tex memory   %d bytes / %d MB' % (report.texture_bytes, BUDGET['texture_mb']))
    if report.failures:
        for failure in report.failures:
            print('FAIL ' + failure)
        print(json.dumps(report.to_dict(path), indent=2))
        raise SystemExit(1)
    print('PASS')
    print(json.dumps(report.to_dict(path), indent=2))
    return report


def check_all(glob_pattern='*.glb'):
    import glob
    failures = 0
    for path in sorted(
        glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', glob_pattern))
    ):
        try:
            check(path)
        except SystemExit:
            failures += 1
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: check_assets.py <export.glb> [<export.glb> ...]')
    overall_failures = 0
    for target in sys.argv[1:]:
        try:
            check(target)
        except SystemExit as exit_code:
            overall_failures += 1
    if overall_failures:
        raise SystemExit(1)
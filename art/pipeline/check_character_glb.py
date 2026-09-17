"""Check what a character GLB ships, by reading the file rather than asking Blender.

The exporter is told what to export. This reads what it actually wrote: which animations
exist and exactly once, whether every animated node is a joint of the one skin, whether any
helper geometry, camera or light came along, and whether the skinning data is sane. A
character file that animates a proof chip, or carries a floor, fails here instead of in a
browser where it only looks slightly wrong.

Plain Python, no Blender, so it can gate a file wherever it lands.

Run: python art/pipeline/check_character_glb.py <file.glb> --clips A,B,C [--joints 137] [--json out.json]
"""
import argparse
import json
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENTS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
NORMALISED = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}
# Names that belong to the proof stage or the review rig, never to the character.
FORBIDDEN_NAME_PARTS = ('proof', 'chip', 'card', 'chair', 'camera', 'light', 'floor', 'felt', 'rail',
                        'a21 ', 'a44', 'a47', 'a49', 'a53 ')


def read_glb(path):
    with open(path, 'rb') as handle:
        raw = handle.read()
    magic, version, total = struct.unpack_from('<4sII', raw)
    if magic != b'glTF' or version != 2 or total != len(raw):
        raise ValueError('%s is not a complete glTF 2 binary' % path)
    offset, document, binary = 12, None, None
    while offset < len(raw):
        length, kind = struct.unpack_from('<II', raw, offset)
        offset += 8
        chunk = raw[offset:offset + length]
        offset += length
        if kind == JSON_CHUNK:
            document = json.loads(chunk)
        elif kind == BIN_CHUNK:
            binary = chunk
    if document is None:
        raise ValueError('%s has no JSON chunk' % path)
    return raw, document, binary or b''


def accessor(document, binary, index):
    spec = document['accessors'][index]
    view = document['bufferViews'][spec['bufferView']]
    code, size = COMPONENTS[spec['componentType']]
    width = WIDTHS[spec['type']]
    stride = view.get('byteStride', width * size)
    start = view.get('byteOffset', 0) + spec.get('byteOffset', 0)
    rows = [struct.unpack_from('<' + code * width, binary, start + i * stride) for i in range(spec['count'])]
    if spec.get('normalized'):
        divisor = NORMALISED[spec['componentType']]
        rows = [tuple(max(-1.0, value / divisor) for value in row) for row in rows]
    return rows


def inspect(path, clips, joint_count):
    raw, document, binary = read_glb(path)
    problems = []
    nodes = document.get('nodes', [])
    skins = document.get('skins', [])
    stats = {
        'bytes': len(raw),
        'nodes': len(nodes),
        'meshes': len(document.get('meshes', [])),
        'primitives': 0,
        'triangles': 0,
        'materials': [material.get('name') for material in document.get('materials', [])],
        'alpha_modes': {material.get('name'): material.get('alphaMode', 'OPAQUE') for material in document.get('materials', [])},
        'images': len(document.get('images', [])),
        'image_bytes': sum(document['bufferViews'][image['bufferView']]['byteLength']
                           for image in document.get('images', []) if 'bufferView' in image),
        'skins': len(skins),
        'joints': [len(skin['joints']) for skin in skins],
        'animations': {},
        'morph_targets': 0,
        'maximum_influences': 0,
        'unweighted_vertices': 0,
        'maximum_weight_sum_error': 0.0,
        'invalid_joint_references': 0,
        'seated_flag_nodes': [],
    }

    if len(skins) != 1:
        problems.append('expected exactly one skin, found %d' % len(skins))
    joints = set(skins[0]['joints']) if skins else set()
    if skins and len(skins[0]['joints']) != joint_count:
        problems.append('the skin has %d joints, expected %d' % (len(skins[0]['joints']), joint_count))

    names = [animation.get('name') for animation in document.get('animations', [])]
    for clip in clips:
        if names.count(clip) != 1:
            problems.append('clip %s appears %d times' % (clip, names.count(clip)))
    for name in sorted(set(names) - set(clips)):
        problems.append('clip %s is not on the allow-list' % name)
    for animation in document.get('animations', []):
        name = animation.get('name')
        targets = set()
        for channel in animation.get('channels', []):
            node = channel['target'].get('node')
            targets.add(node)
            if node not in joints:
                problems.append('%s animates node %r, which is not a joint of the skin'
                                % (name, nodes[node].get('name') if node is not None else None))
        end = max(max(row[0] for row in accessor(document, binary, sampler['input']))
                  for sampler in animation.get('samplers', []))
        stats['animations'][name] = {'seconds': round(end, 4), 'animated_nodes': len(targets),
                                     'channels': len(animation.get('channels', []))}

    if document.get('cameras'):
        problems.append('the file carries %d cameras' % len(document['cameras']))
    if 'KHR_lights_punctual' in document.get('extensionsUsed', []):
        problems.append('the file carries punctual lights')

    for index, node in enumerate(nodes):
        name = node.get('name', '')
        lowered = name.lower()
        if any(part in lowered for part in FORBIDDEN_NAME_PARTS):
            problems.append('node %r looks like proof or review content' % name)
        if 'camera' in node:
            problems.append('node %r is a camera' % name)
        if 'mesh' in node and node.get('skin') != 0:
            problems.append('mesh node %r is not skinned to the character' % name)
        if (node.get('extras') or {}).get('riverSeatedBaked') is True:
            stats['seated_flag_nodes'].append(name)
    if not stats['seated_flag_nodes']:
        problems.append('no node carries riverSeatedBaked, so the venue build would pose the rig again')

    for mesh in document.get('meshes', []):
        for primitive in mesh['primitives']:
            stats['primitives'] += 1
            if primitive.get('mode', 4) != 4:
                problems.append('%s has a primitive that is not triangles' % mesh.get('name'))
                continue
            stats['triangles'] += document['accessors'][primitive['indices']]['count'] // 3
            stats['morph_targets'] += len(primitive.get('targets', []))
            attributes = primitive['attributes']
            if 'JOINTS_0' not in attributes or 'WEIGHTS_0' not in attributes:
                problems.append('%s has an unskinned primitive' % mesh.get('name'))
                continue
            if 'JOINTS_1' in attributes or 'WEIGHTS_1' in attributes:
                problems.append('%s uses more than four influences' % mesh.get('name'))
            for bones, weights in zip(accessor(document, binary, attributes['JOINTS_0']),
                                      accessor(document, binary, attributes['WEIGHTS_0'])):
                count = sum(weight > 1e-8 for weight in weights)
                stats['maximum_influences'] = max(stats['maximum_influences'], count)
                stats['unweighted_vertices'] += int(count == 0)
                stats['maximum_weight_sum_error'] = max(stats['maximum_weight_sum_error'], abs(sum(weights) - 1.0))
                stats['invalid_joint_references'] += sum(
                    weight > 0 and (bone < 0 or bone >= joint_count) for bone, weight in zip(bones, weights))
    if stats['morph_targets']:
        problems.append('%d morph targets shipped' % stats['morph_targets'])
    if stats['unweighted_vertices']:
        problems.append('%d vertices have no weight' % stats['unweighted_vertices'])
    if stats['invalid_joint_references']:
        problems.append('%d weights point at joints that do not exist' % stats['invalid_joint_references'])
    if stats['maximum_weight_sum_error'] > 1e-4:
        problems.append('weights sum as far as %.6f from one' % stats['maximum_weight_sum_error'])
    return stats, problems


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('glb')
    parser.add_argument('--clips', required=True)
    parser.add_argument('--joints', type=int, default=137)
    parser.add_argument('--json')
    args = parser.parse_args(argv)
    clips = [clip for clip in args.clips.split(',') if clip]
    stats, problems = inspect(args.glb, clips, args.joints)
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as handle:
            json.dump({'stats': stats, 'problems': problems}, handle, indent=1)
    print(json.dumps(stats, indent=1))
    for problem in problems:
        print('FAIL ' + problem)
    if problems:
        return 1
    print('CHARACTER GLB PASS %d clips, %d joints, %d triangles, %d primitives'
          % (len(stats['animations']), stats['joints'][0], stats['triangles'], stats['primitives']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

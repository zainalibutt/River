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
import bpy

from buildkit import smooth_mesh_by_angle
from values import (
    BUDGET,
    CHARACTER_CULL_FRACTION,
)

OUT_DIR = os.environ['RIVER_OUT']

MALE = 'char_male'
FEMALE = 'char_female'
MPFB_MODULE = 'bl_ext.blender_org.mpfb'

POISON_NAMES = ('body', 'left', 'right', 'helpergeometry')
GARMENT_BONES = ('spine', 'clavicle', 'shoulder', 'upperarm', 'breast', 'pelvis')
GARMENT_WELD_DISTANCE = 0.0005
ATLAS_SIZE = 1024
ATLAS_COLUMNS = 8
ATLAS_ROWS = 4


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


def paint_face_cell(pixels, female):
    width = ATLAS_SIZE // ATLAS_COLUMNS
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = 3 * width
    skin = skin_tone(female) + (255,)
    # Flat, not graded. A gradient across the face island is a second value
    # gradient fighting the shading below, and its top edge lands where the face
    # meets the scalp.
    fill_gradient(pixels, 3, 0, skin[:3], skin[:3])
    eye_y = round(height * 0.58)
    brow_y = round(height * 0.67)
    lip_y = round(height * 0.31)
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
    shade_ellipse(pixels, centre_x, brow_y - 4, round(width * 0.40), round(height * 0.045), 0.20, 0.30)
    for fraction in (0.32, 0.68):
        shade_ellipse(pixels, x0 + round(width * fraction), eye_y + 2, 22, 15, 0.22, 0.20)
    shade_ellipse(pixels, centre_x - 7, round(height * 0.47), 9, round(height * 0.09), 0.20, 0.20)
    shade_ellipse(pixels, centre_x, round(height * 0.375), 15, 6, 0.24, 0.25)
    shade_ellipse(pixels, centre_x, round(height * 0.265), round(width * 0.16), 7, 0.20, 0.25)
    for fraction in (0.32, 0.68):
        eye_x = x0 + round(width * fraction)
        paint_ellipse(pixels, eye_x, eye_y, 12, 7, (91, 59, 43, 255))
        paint_ellipse(pixels, eye_x, eye_y, 9, 4, (181, 168, 145, 255))
        paint_ellipse(pixels, eye_x, eye_y, 3, 4, (35, 27, 24, 255))
        paint_line(pixels, eye_x - 14, eye_y + 6, eye_x + 13, eye_y + 6, 2, (61, 39, 29, 255))
        paint_line(pixels, eye_x - 15, brow_y, eye_x + 14, brow_y + 2, 3, (61, 39, 29, 255))
    paint_line(pixels, x0 + width // 2, round(height * 0.55), x0 + width // 2 - 3, round(height * 0.39), 2, (166, 112, 86, 255))
    paint_line(pixels, x0 + round(width * 0.38), lip_y, x0 + round(width * 0.62), lip_y, 3, (128, 64, 61, 255))
    paint_line(pixels, x0 + 5, round(height * 0.84), x0 + width - 6, round(height * 0.84), 9, (55, 37, 29, 255))
    if not female:
        for y in range(round(height * 0.18), round(height * 0.38), 5):
            for x in range(x0 + round(width * 0.23), x0 + round(width * 0.78), 7):
                if (x * 13 + y * 7) % 5 < 2:
                    paint_ellipse(pixels, x, y, 1, 1, (119, 87, 70, 255))


def paint_garment_cell(pixels, female):
    width = ATLAS_SIZE // ATLAS_COLUMNS
    height = ATLAS_SIZE // ATLAS_ROWS
    x0 = width
    base = (70, 35, 42) if female else (30, 43, 54)
    fill_gradient(pixels, 1, 0, tuple(max(0, channel - 14) for channel in base), tuple(min(255, channel + 12) for channel in base))
    edge = (68, 73, 76, 255)
    paint_line(pixels, x0 + width // 2, round(height * 0.18), x0 + width // 2, round(height * 0.72), 1, edge)
    paint_line(pixels, x0 + round(width * 0.35), round(height * 0.84), x0 + width // 2, round(height * 0.72), 2, edge)
    paint_line(pixels, x0 + round(width * 0.65), round(height * 0.84), x0 + width // 2, round(height * 0.72), 2, edge)
    paint_line(pixels, x0 + 8, round(height * 0.13), x0 + width - 9, round(height * 0.13), 1, edge)
    paint_line(pixels, x0 + 8, round(height * 0.31), x0 + 8, round(height * 0.45), 2, edge)
    paint_line(pixels, x0 + width - 9, round(height * 0.31), x0 + width - 9, round(height * 0.45), 2, edge)


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
    paint_garment_cell(pixels, female)
    fill_gradient(pixels, 2, 0, (37, 25, 21), (72, 49, 36))
    paint_face_cell(pixels, female)
    fill_gradient(pixels, 4, 0, tuple(max(0, channel - 10) for channel in skin), tuple(min(255, channel + 12) for channel in skin))
    fill_gradient(pixels, 5, 0, (118, 89, 46), (205, 169, 93))
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
    nodes = material.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.62
    return material


def atlas_uv(cell_x, cell_y, local_u, local_v):
    margin_u = 0.015
    margin_v = 0.012
    local_u = min(1.0 - margin_u, max(margin_u, local_u))
    local_v = min(1.0 - margin_v, max(margin_v, local_v))
    return ((cell_x + local_u) / ATLAS_COLUMNS, (cell_y + local_v) / ATLAS_ROWS)


def apply_body_atlas(obj, material):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(material)
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name='RiverCharacterAtlas')
    for polygon in mesh.polygons:
        centre = polygon.center
        if centre.z > 1.46:
            face = centre.y < -0.035
            cell = (3, 0) if face else (2, 0)
        elif abs(centre.x) > 0.37 and centre.z < 1.12:
            face = False
            cell = (4, 0)
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
            layer.data[loop_index].uv = atlas_uv(cell[0], cell[1], local_u, local_v)


def apply_garment_atlas(obj, material):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(material)
    layer = mesh.uv_layers.new(name='RiverCharacterAtlas')
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            coordinate = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            local_u = 0.5 + coordinate.x / 1.1
            local_v = (coordinate.z - 0.58) / 0.88
            layer.data[loop_index].uv = atlas_uv(1, 0, local_u, local_v)


def build_hair(obj, material, female):
    segments = 16
    ring_angles = (0.18, 0.46, 0.74, 1.02, 1.28)
    centre_y = -0.044
    centre_z = 1.558
    radius_x = 0.108
    radius_y = 0.112
    radius_z = 0.122
    vertices = []
    faces = []
    for angle in ring_angles:
        for segment in range(segments):
            around = 2.0 * math.pi * segment / segments
            vertices.append((
                radius_x * math.sin(angle) * math.cos(around),
                centre_y + radius_y * math.sin(angle) * math.sin(around),
                centre_z + radius_z * math.cos(angle),
            ))
    faces.append(tuple(range(segments - 1, -1, -1)))
    for ring in range(len(ring_angles) - 1):
        first = ring * segments
        second = (ring + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((first + segment, first + following, second + following, second + segment))

    def add_sweep():
        start = len(vertices)
        sections = 5
        sides = 6
        for section in range(sections):
            blend = section / (sections - 1)
            x = -0.082 + blend * 0.164
            arch = math.sin(math.pi * blend)
            sweep_y = centre_y - radius_y - 0.002 - arch * 0.012
            sweep_z = 1.625 + arch * (0.03 if female else 0.024)
            for side in range(sides):
                around = 2.0 * math.pi * side / sides
                vertices.append((
                    x,
                    sweep_y + math.cos(around) * 0.016,
                    sweep_z + math.sin(around) * 0.017,
                ))
        faces.append(tuple(start + side for side in range(sides - 1, -1, -1)))
        for section in range(sections - 1):
            first = start + section * sides
            second = first + sides
            for side in range(sides):
                following = (side + 1) % sides
                faces.append((first + side, first + following, second + following, second + side))
        final = start + (sections - 1) * sides
        faces.append(tuple(final + side for side in range(sides)))

    add_sweep()
    hair_mesh = bpy.data.meshes.new(obj.name + '_hair')
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
    layer = hair_mesh.uv_layers.new(name='RiverCharacterAtlas')
    for polygon in hair_mesh.polygons:
        for loop_index in polygon.loop_indices:
            coordinate = hair_mesh.vertices[hair_mesh.loops[loop_index].vertex_index].co
            local_u = 0.5 + coordinate.x / 0.24
            local_v = (coordinate.z - 1.57) / 0.13
            layer.data[loop_index].uv = atlas_uv(2, 0, local_u, local_v)
    smooth_mesh_by_angle(hair_mesh)
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
    zs = [v.co.z for v in obj.data.vertices]
    zmin = min(zs)
    zmax = max(zs)
    cut = zmin + (zmax - zmin) * CHARACTER_CULL_FRACTION
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        dist=0.0001,
        plane_co=(0.0, 0.0, cut),
        plane_no=(0.0, 0.0, 1.0),
        clear_inner=True,
        clear_outer=False,
        use_snap_center=False,
    )
    bm.to_mesh(obj.data)
    bm.free()
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


def create_base(gender_value, name, female=False):
    bpy.ops.mpfb.create_human()
    human = bpy.context.active_object
    try:
        setattr(human, 'MPFB_HUM_gender', float(gender_value))
    except Exception:
        pass
    human.name = name
    human.data.name = name + '_body'
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


def garment_weights(obj):
    group_lookup = {}
    for group in obj.vertex_groups:
        low = group.name.lower()
        if any(p in low for p in POISON_NAMES):
            continue
        for bone in GARMENT_BONES:
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


def boundary_edge_count(mesh):
    mesh_data = bmesh.new()
    mesh_data.from_mesh(mesh)
    count = sum(1 for edge in mesh_data.edges if len(edge.link_faces) == 1)
    mesh_data.free()
    return count


def build_garment(obj, material, thickness=0.020, threshold=0.25):
    weights = garment_weights(obj)
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

    return garment_obj


def apply_character_materials(obj, material):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(material)
    return obj


def main():
    require_mpfb()
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {'characters': []}
    for name, gender, female in [(MALE, 0.1, False), (FEMALE, 0.85, True)]:
        clear_scene()
        obj = create_base(gender, name, female)
        atlas = create_character_atlas(name, female)
        material = add_atlas_material(name + '_atlas_mat', atlas)
        obj = apply_character_materials(obj, material)
        obj = reduce_body(obj)
        hair_components, hair_faces, hair_vertices = strip_opaque_hair_planes(obj)
        # after the bake, not before - bake_shapekeys rewrites vertex positions
        # from the shapekey mix and would discard these edits
        if female:
            apply_female_proportions(obj)
        apply_body_atlas(obj, material)
        garment = build_garment(obj, material)
        if garment is not None:
            apply_garment_atlas(garment, material)
        hair = build_hair(obj, material, female)
        garment_boundary_vertices = smooth_garment_boundaries(garment) if garment is not None else 0
        smooth_mesh_by_angle(obj.data)
        if garment is not None:
            smooth_mesh_by_angle(garment.data)
        armature = armature_of(obj)
        actions = build_animations(armature) if armature else []
        stats = checks_for(obj)
        hair_faces_total, _ = mesh_stats(hair.data)
        hair_quads = sum(1 for polygon in hair.data.polygons if len(polygon.vertices) == 4)
        hair_tris = sum((1 if len(poly.vertices) == 3 else len(poly.vertices) - 2) for poly in hair.data.polygons)
        body_quads = sum(1 for polygon in obj.data.polygons if len(polygon.vertices) == 4)
        combined_faces = stats['faces'] + hair_faces_total
        combined_quad = (body_quads + hair_quads) / combined_faces if combined_faces else 0.0
        character_tris = stats['tris'] + hair_tris
        if character_tris > BUDGET['character_triangles']:
            stats['checks'].append('triangle budget exceeded {} > {}'.format(character_tris, BUDGET['character_triangles']))
        if combined_quad < BUDGET['character_quad_min']:
            stats['checks'].append('quad ratio {} below {}'.format(round(combined_quad, 3), BUDGET['character_quad_min']))
        garment_verts = len(garment.data.vertices) if garment is not None else 0
        garment_tris = sum((1 if len(poly.vertices) == 3 else 2) for poly in garment.data.polygons) if garment is not None else 0
        garment_ratio = garment_verts / garment_tris if garment_tris else 0.0
        garment_boundary_edges = boundary_edge_count(garment.data) if garment is not None else 0
        shape = shape_hash(obj)
        glb = export_glb(obj, extra=(garment, hair))
        manifest['characters'].append({
            'name': name,
            'glb': os.path.basename(glb),
            'faces': stats['faces'],
            'tris': character_tris,
            'body_tris': stats['tris'],
            'hair_tris': hair_tris,
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
            'garment_groups': len(garment.vertex_groups) if garment is not None else 0,
            'shape_hash': shape,
        })
        print('CHAR %s faces=%d tris=%d quad=%.3f groups=%d bones=%d garment=%d actions=%d checks=%s' % (
            name, combined_faces, character_tris, combined_quad,
            stats['groups'], stats['bones'], len(garment_vert_indices(obj)),
            len(actions), stats['checks']
        ))
        print('ATLAS %s dimensions=%dx%d hair_triangles=%d' % (
            name, ATLAS_SIZE, ATLAS_SIZE, hair_tris
        ))
        print('GARMENT %s vertices=%d triangles=%d vertices_per_triangle=%.3f' % (
            name, garment_verts, garment_tris, garment_ratio
        ))
        print('GARMENT_BOUNDARY %s edges=%d vertices=%d' % (
            name, garment_boundary_edges, garment_boundary_vertices
        ))
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
        use_selection=True,
    )
    return glb


if __name__ == '__main__':
    main()

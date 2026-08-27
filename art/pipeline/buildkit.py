import math
import os

import bpy
from values import SEAT_RING_X, SEAT_RING_Y


def hex_to_rgb(hex_value):
    """Convert an sRGB hex colour to the linear values Blender actually wants.

    Every colour input this pipeline touches is linear: a Principled BSDF's
    Base Color, an Emission node's Color, a colour ramp element, an object's
    diffuse_color, and the float buffer behind image.pixels. glTF's
    baseColorFactor is linear too. The palette in values.py is written the way
    a person reads colour, which is sRGB.

    This used to divide by 255 and stop, which feeds an sRGB number into a
    linear input. The sRGB transfer curve is steep in the shadows, so that does
    not darken or brighten evenly - it lifts dark values by around ten times
    while barely moving light ones, which pulls every surface in a venue toward
    the same middle grey and flattens the contrast between them.

    The Rooftop was authored with a near-black navy felt at 0A121E and shipped
    a GLB whose felt reads 384B60. Its floor, rail, chairs, parapet, mountains
    and skyline all landed within a factor of three of each other and of the
    felt - the table was measurably darker than the ground it stood on. No
    amount of relighting could separate surfaces that had no contrast left to
    separate, which is why several passes at the lighting never helped.
    """
    value = hex_value.lstrip('#')
    out = []
    for index in (0, 2, 4):
        channel = int(value[index:index + 2], 16) / 255.0
        out.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def clear_scene(keep=()):
    keep = set(keep)
    for scene in list(bpy.data.scenes):
        collection = scene.collection
        for obj in list(collection.objects):
            collection.objects.unlink(obj)
            bpy.data.objects.remove(obj)
    kept_materials = []
    for mesh in list(bpy.data.meshes):
        if mesh.name in keep:
            for material in mesh.materials:
                kept_materials.append(material.name)
            continue
        bpy.data.meshes.remove(mesh)
    kept_materials = set(kept_materials)
    for material in list(bpy.data.materials):
        if material.name in kept_materials:
            continue
        bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        bpy.data.images.remove(image)


def add_material(name, hex_value):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = hex_to_rgb(hex_value)
    bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    return material


def add_metal_material(name, hex_value, roughness=0.28):
    """A material that is actually metal.

    Every surface in every venue ships at metallic 0, which is right for felt,
    wood, leather and stone and wrong for the one thing in the room that is
    meant to reflect. A chrome pedestal with a diffuse albedo and no metallic
    response is a white plastic ring, and at night it is the brightest object in
    frame - the chair feet were pulling the eye to the floor while the table sat
    dark.

    Metal takes its colour from its specular response rather than from diffuse,
    so a dark room gives dark chrome with bright highlights, which is what
    chrome does.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = hex_to_rgb(hex_value)
    bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = roughness
    return material


def add_emissive_material(name, hex_value, strength=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    emission = nodes.new('ShaderNodeEmission')
    rgb = hex_to_rgb(hex_value)
    emission.inputs['Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    emission.inputs['Strength'].default_value = strength
    links = material.node_tree.links
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return material


def colorramp_material(name, stops):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements.new(0.5)
    ramp.color_ramp.elements.new(1.0)
    while len(ramp.color_ramp.elements) > len(stops):
        ramp.color_ramp.elements.remove(ramp.color_ramp.elements[-1])
    elements = ramp.color_ramp.elements
    for index, (position, hex_value) in enumerate(stops):
        rgb = hex_to_rgb(hex_value)
        if index < len(elements):
            element = elements[index]
            element.position = position
            element.color = (rgb[0], rgb[1], rgb[2], 1.0)
        else:
            element = elements.new(position)
            element.color = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return material, ramp


def retint(material, stops):
    tree = material.node_tree
    if tree is None:
        rgb = hex_to_rgb(stops[0][1])
        material.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
        return material
    ramp = next((n for n in tree.nodes if n.type == 'VALTORGB' or n.bl_idname == 'ShaderNodeValToRGB'), None)
    if ramp is None:
        bsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is not None:
            rgb = hex_to_rgb(stops[0][1])
            bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        return material
    elements = ramp.color_ramp.elements
    existing_positions = [element.position for element in elements]
    target_positions = [position for position, _ in stops]
    while len(elements) > len(stops):
        elements.remove(elements[-1])
    existing_positions = [element.position for element in elements]
    for index, (position, hex_value) in enumerate(stops):
        rgb = hex_to_rgb(hex_value)
        if index < len(elements):
            element = elements[index]
            element.position = position
            element.color = (rgb[0], rgb[1], rgb[2], 1.0)
        else:
            element = elements.new(position)
            element.color = (rgb[0], rgb[1], rgb[2], 1.0)
    return material


def build_mesh(name, geo, material):
    verts, faces = geo
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    smooth_mesh_by_angle(mesh)
    if material is not None:
        mesh.materials.append(material)
    return mesh


def build_mesh_from_geo(name, geo):
    verts, faces = geo
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    smooth_mesh_by_angle(mesh)
    return mesh


def smooth_mesh_by_angle(mesh, angle_degrees=35.0):
    mesh.shade_smooth()
    mesh.set_sharp_from_angle(angle=math.radians(angle_degrees))
    mesh.update()
    normals = [(corner.vector.x, corner.vector.y, corner.vector.z) for corner in mesh.corner_normals]
    mesh.normals_split_custom_set(normals)
    sharp_edges = mesh.attributes.get('sharp_edge')
    if sharp_edges is not None:
        mesh.attributes.remove(sharp_edges)
    mesh.update()
    return mesh


def shared_variant(source_mesh, material, name):
    mesh = source_mesh.copy()
    mesh.name = name
    mesh.materials.clear()
    if material is not None:
        mesh.materials.append(material)
    return mesh


def object_at(name, mesh, location=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), parent=None):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = list(location)
    obj.rotation_euler = list(rotation)
    if parent is not None:
        obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_checker_image(name, size, color_a, color_b, directory):
    rgb_a = hex_to_rgb(color_a)
    rgb_b = hex_to_rgb(color_b)
    image = bpy.data.images.new(name, width=size, height=size)
    pixels = []
    for y in range(size):
        for x in range(size):
            if (x // 8 + y // 8) % 2 == 0:
                pixels.extend((rgb_a[0], rgb_a[1], rgb_a[2], 1.0))
            else:
                pixels.extend((rgb_b[0], rgb_b[1], rgb_b[2], 1.0))
    image.pixels = pixels
    os.makedirs(directory, exist_ok=True)
    filepath = os.path.join(directory, name + '.png')
    image.filepath_raw = filepath
    image.file_format = 'PNG'
    image.save_render(filepath)
    return image, filepath


def checker_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return material


def make_checker_material(name, size, color_a, color_b, directory):
    image, filepath = make_checker_image(name + '_tex', size, color_a, color_b, directory)
    material = checker_material(name, image)
    return material, image, filepath


def seat_positions(count, ring_x=None, ring_y=None):
    import math
    if ring_x is None:
        ring_x = SEAT_RING_X
    if ring_y is None:
        ring_y = SEAT_RING_Y
    positions = []
    for i in range(count):
        angle = math.pi / 2 + 2.0 * math.pi * i / count
        positions.append((ring_x * math.cos(angle), ring_y * math.sin(angle)))
    return positions

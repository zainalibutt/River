import math
import os
import sys

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out', 'proofs', 'native-gold')
MPFB_DATA = os.path.join(
    os.environ['APPDATA'],
    'Blender Foundation',
    'Blender',
    '5.2',
    'mpfb',
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_characters import GOLD_FEMALE_IDENTITY


ASSETS = {
    'eyes': ('eyes', 'high-poly', 'high-poly.mhclo'),
    'eyebrows': ('eyebrows', 'eyebrow007', 'eyebrow007.mhclo'),
    'eyelashes': ('eyelashes', 'eyelashes02', 'eyelashes02.mhclo'),
    'hair': ('hair', 'ponytail01', 'ponytail01.mhclo'),
    'dress': ('clothes', 'toigo_halter_dress_midi', 'toigo_halter_dress_midi.mhclo'),
    'skin': ('skins', 'young_african_female', 'young_african_female.mhmat'),
}

NATIVE_EXPRESSION_UNITS = (
    'eyeBlinkLeft',
    'eyeBlinkRight',
    'mouthSmileLeft',
    'mouthSmileRight',
    'cheekSquintLeft',
    'cheekSquintRight',
    'browDownLeft',
    'browDownRight',
    'mouthFrownLeft',
    'mouthFrownRight',
)


def asset_path(name):
    path = os.path.join(MPFB_DATA, *ASSETS[name])
    if not os.path.exists(path):
        raise SystemExit('FAIL: missing native MPFB asset ' + path)
    return path


def faceunit_path(name):
    path = os.path.join(MPFB_DATA, 'targets', 'faceunits', name + '.target')
    if not os.path.exists(path):
        raise SystemExit('FAIL: missing Faceunits01 target ' + path)
    return path


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def add_area(name, location, colour, energy, size, target):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.color = colour
    data.shape = 'DISK'
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    look_at(light, target)


def add_ground():
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.05, depth=0.035, location=(0, 0, -0.025))
    ground = bpy.context.object
    ground.name = 'native_gold_plinth'
    material = bpy.data.materials.new('native_gold_plinth_material')
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.015, 0.022, 0.027, 1.0)
    bsdf.inputs['Metallic'].default_value = 0.38
    bsdf.inputs['Roughness'].default_value = 0.30
    ground.data.materials.append(material)


def apply_identity(human, target_service):
    for target_name, weight in GOLD_FEMALE_IDENTITY:
        target = target_service.target_full_path(target_name)
        if target is None:
            raise SystemExit('FAIL: missing identity target ' + target_name)
        target_service.load_target(human, target, weight=weight, name=target_name)


def tint_textured_materials(obj, colour, strength, blend_type, roughness, specular_level):
    for slot in obj.material_slots:
        material = slot.material
        if material is None or not material.use_nodes:
            continue
        principled = next(
            (node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'),
            None,
        )
        if principled is None:
            continue
        base_colour = principled.inputs.get('Base Color')
        if base_colour is None or not base_colour.is_linked:
            continue
        source_link = base_colour.links[0]
        source_socket = source_link.from_socket
        material.node_tree.links.remove(source_link)
        mix = material.node_tree.nodes.new('ShaderNodeMixRGB')
        mix.name = 'river_native_tint'
        mix.blend_type = blend_type
        mix.inputs['Fac'].default_value = strength
        mix.inputs['Color2'].default_value = (*colour, 1.0)
        material.node_tree.links.new(source_socket, mix.inputs['Color1'])
        material.node_tree.links.new(mix.outputs['Color'], base_colour)
        roughness_input = principled.inputs.get('Roughness')
        if roughness_input is not None:
            for link in list(roughness_input.links):
                material.node_tree.links.remove(link)
            roughness_input.default_value = roughness
        specular_input = principled.inputs.get('Specular IOR Level')
        if specular_input is not None:
            for link in list(specular_input.links):
                material.node_tree.links.remove(link)
            specular_input.default_value = specular_level
        coat_input = principled.inputs.get('Coat Weight')
        if coat_input is not None:
            coat_input.default_value = 0.0


def refine_character_materials(human, attached):
    by_name = {obj.name.rsplit('_', 1)[-1]: obj for obj in attached}
    tint_textured_materials(
        by_name['hair'],
        colour=(0.035, 0.010, 0.004),
        strength=0.99,
        blend_type='MULTIPLY',
        roughness=0.43,
        specular_level=0.18,
    )
    tint_textured_materials(
        by_name['dress'],
        colour=(0.19, 0.008, 0.012),
        strength=0.76,
        blend_type='MIX',
        roughness=0.50,
        specular_level=0.22,
    )
    for slot in human.material_slots:
        material = slot.material
        if material is None or not material.name.lower().endswith('.lips'):
            continue
        proxy = type('MaterialProxy', (), {'material_slots': [slot]})()
        tint_textured_materials(
            proxy,
            colour=(0.28, 0.025, 0.035),
            strength=0.36,
            blend_type='MIX',
            roughness=0.42,
            specular_level=0.30,
        )


def build_character():
    from bl_ext.blender_org.mpfb.services import FaceService, HumanService, TargetService

    macros = TargetService.get_default_macro_info_dict()
    macros.update({
        'gender': 0.04,
        'age': 0.44,
        'muscle': 0.34,
        'weight': 0.43,
        'proportions': 0.57,
        'height': 0.59,
        'cupsize': 0.56,
        'firmness': 0.64,
    })
    macros['race'].update({'african': 0.46, 'asian': 0.12, 'caucasian': 0.42})

    human = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
        macro_detail_dict=macros,
    )
    human.name = 'river_native_gold_body'
    human.data.name = 'river_native_gold_body_mesh'
    apply_identity(human, TargetService)
    for face_unit in NATIVE_EXPRESSION_UNITS:
        TargetService.load_target(
            human,
            faceunit_path(face_unit),
            weight=0.0,
            name=TargetService.expression_name_to_shapekey_name(face_unit),
        )
    FaceService.clear_expression(human)

    bpy.ops.object.select_all(action='DESELECT')
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    HumanService.add_builtin_rig(human, 'default_no_toes', import_weights=True)

    HumanService.set_character_skin(
        asset_path('skin'),
        human,
        bodyproxy=None,
        skin_type='MAKESKIN',
        material_instances=True,
    )

    attached = []
    for name, object_type in (
        ('eyes', 'eyes'),
        ('eyebrows', 'eyebrows'),
        ('eyelashes', 'eyelashes'),
        ('hair', 'hair'),
        ('dress', 'Clothes'),
    ):
        obj = HumanService.add_mhclo_asset(
            asset_path(name),
            human,
            asset_type=object_type,
            subdiv_levels=1,
            material_type='MAKESKIN',
            set_up_rigging=True,
            interpolate_weights=True,
            import_subrig=True,
            import_weights=True,
        )
        obj.name = 'river_native_gold_' + name
        attached.append(obj)

    FaceService.interpolate_targets(human)

    for obj in [human, *attached]:
        if obj.type != 'MESH':
            continue
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

    refine_character_materials(human, attached)

    human['riverProof'] = 'native_gold_v2'
    human['sourceLicense'] = 'CC0'
    human['expressionUnits'] = list(NATIVE_EXPRESSION_UNITS)
    return human, attached


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new('native_gold_world')
    scene.world.color = (0.004, 0.006, 0.009)
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.45

    target = (0.0, 0.0, 1.18)
    add_area('native_gold_key', (-1.5, -2.2, 2.8), (1.0, 0.72, 0.50), 520.0, 2.4, target)
    add_area('native_gold_fill', (1.7, -1.0, 2.2), (0.30, 0.48, 1.0), 250.0, 2.0, target)
    add_area('native_gold_rim', (0.5, 1.7, 2.5), (0.55, 0.68, 1.0), 420.0, 1.6, target)

    data = bpy.data.cameras.new('native_gold_camera')
    data.sensor_fit = 'HORIZONTAL'
    data.angle = math.radians(35.0)
    camera = bpy.data.objects.new('native_gold_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, camera


def render_views(scene, camera):
    target = (0.0, 0.0, 1.10)
    views = (
        ('front', (0.0, -4.15, 1.22)),
        ('three-quarter', (2.45, -3.30, 1.30)),
        ('profile', (4.05, -0.05, 1.30)),
    )
    for name, location in views:
        camera.location = location
        look_at(camera, target)
        path = os.path.join(OUT, 'native-gold-' + name + '.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('RENDER ' + path)


def main():
    os.makedirs(OUT, exist_ok=True)
    clear_scene()
    human, attached = build_character()
    add_ground()
    scene, camera = setup_render()
    blend = os.path.join(OUT, 'native-gold-character.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    render_views(scene, camera)
    triangles = sum(
        len(obj.data.loop_triangles)
        for obj in [human, *attached]
        if obj.type == 'MESH' and not obj.data.calc_loop_triangles()
    )
    print('PROOF %s meshes=%d triangles=%d' % (blend, 1 + len(attached), triangles))


if __name__ == '__main__':
    main()

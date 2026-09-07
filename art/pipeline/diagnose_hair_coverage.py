"""Measure silver occiput coverage before and after the production hair conform.

Run: blender --background --python-exit-code 1 --python art/pipeline/diagnose_hair_coverage.py
Distances use the evaluated body surface in world metres. The paired base-vertex
cohort is selected before conforming, so moving a vertex cannot remove a failure.
"""
import ast
import json
import math
import os
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_native_silver_proof import MPFB_DATA, OUT, add_area, conform_hair, look_at, tint
from compare_hair_shells import SIZE, VIEWS, add_caption


CUTS = ('short01', 'short02', 'short03', 'short04')
HAIR_ALPHA_CUTOFF = 0.28
PERCENTILES = (0, 5, 25, 50, 75, 95, 100)
BASELINE_REF = 'b19e9d0972d76339ad995af8c7a22fb1d0108ab8'


def report(name, value):
    print(name + ' ' + json.dumps(value), flush=True)


def distribution(values):
    if not len(values):
        raise RuntimeError('Empty measurement distribution')
    return dict(zip(('p%d' % p for p in PERCENTILES),
                    np.percentile(values, PERCENTILES).tolist()))


class Surface:
    def __init__(self, obj):
        bpy.context.view_layer.update()
        self.obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        self.matrix = self.obj.matrix_world.copy()
        self.inverse = self.matrix.inverted()
        self.normal_matrix = self.matrix.to_3x3().inverted().transposed()

    def nearest(self, point):
        hit, location, normal, _ = self.obj.closest_point_on_mesh(self.inverse @ point)
        if not hit:
            raise RuntimeError('No closest surface point on ' + self.obj.name)
        location = self.matrix @ location
        normal = (self.normal_matrix @ normal).normalized()
        return location, normal, (point - location).dot(normal)

    def points(self):
        return [self.matrix @ v.co for v in self.obj.data.vertices]


class Occiput:
    def __init__(self, human, body):
        group = human.vertex_groups.get('head')
        if group is None:
            raise RuntimeError('Body has no head group; occiput vertex count=0')
        head = [v for v in body.obj.data.vertices
                if any(g.group == group.index and g.weight >= 0.5 for g in v.groups)]
        if not head:
            raise RuntimeError('Head selection empty; occiput vertex count=0')
        points = [body.matrix @ v.co for v in head]
        self.lower = np.min(np.array([tuple(p) for p in points]), axis=0)
        self.upper = np.max(np.array([tuple(p) for p in points]), axis=0)
        self.y_min = float((self.lower[1] + self.upper[1]) * 0.5)
        self.z_min = float(self.lower[2] + (self.upper[2] - self.lower[2]) * 0.35)
        self.points = [p for p in points if self.contains(p)]
        report('OCCIPUT', {
            'definition': 'head weight >=0.5; posterior half (+Y); upper 65% of head height',
            'head_vertices': len(head), 'body_vertices': len(self.points),
            'head_min_m': self.lower.tolist(), 'head_max_m': self.upper.tolist(),
            'y_min_m': self.y_min, 'z_min_m': self.z_min})
        if not self.points:
            raise RuntimeError('Occiput region empty; vertex count=0')
        nose = min(head, key=lambda v: (body.matrix @ v.co).y)
        point = body.matrix @ nose.co
        normal = (body.normal_matrix @ nose.normal).normalized()
        outside = body.nearest(point + normal * 0.010)[2]
        inside = body.nearest(point - normal * 0.002)[2]
        report('SIGN_VALIDATION', {'nose_m': tuple(point),
                                  'outward_10mm_signed_mm': outside * 1000,
                                  'inward_2mm_signed_mm': inside * 1000})
        if outside <= 0 or inside >= 0:
            raise RuntimeError('Signed-distance validation failed')

    def contains(self, point):
        return point.y >= self.y_min and point.z >= self.z_min


def buried(distances):
    distances = np.asarray(distances)
    if not distances.size:
        raise RuntimeError('Empty hair occiput cohort')
    return {'vertices': int(distances.size), 'inside': int((distances < 0).sum()),
            'inside_fraction': float((distances < 0).mean()),
            'deepest_mm': max(0.0, float(-distances.min() * 1000)),
            'signed_mm': distribution(distances * 1000)}


def alpha_samples(hair, region, cut):
    path = (os.path.join(OUT, 'river_silver_hair_diffuse.png') if cut == 'short02'
            else os.path.join(MPFB_DATA, 'hair', cut, cut + '_diffuse.png'))
    image = bpy.data.images.load(path, check_existing=False)
    width, height = image.size
    if width <= 0 or height <= 0:
        raise RuntimeError('Hair alpha image unavailable: ' + path)
    alpha = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)[:, :, 3]
    uv = hair.data.uv_layers.active
    if uv is None:
        raise RuntimeError('No UV layer on ' + cut)
    samples = []
    areas = []
    faces = 0
    for face in hair.data.polygons:
        points = [hair.matrix_world @ hair.data.vertices[i].co for i in face.vertices]
        if not region.contains(sum(points, Vector()) / len(points)):
            continue
        if len(points) != 4:
            raise RuntimeError('Expected quad hair face')
        faces += 1
        area = ((points[1] - points[0]).cross(points[2] - points[0]).length
                + (points[2] - points[0]).cross(points[3] - points[0]).length) * 0.5
        corners = [uv.data[i].uv.copy() for i in face.loop_indices]
        for s in (1 / 6, 0.5, 5 / 6):
            for t in (1 / 6, 0.5, 5 / 6):
                coord = ((1 - s) * (1 - t) * corners[0] + s * (1 - t) * corners[1]
                         + s * t * corners[2] + (1 - s) * t * corners[3])
                x, y = coord.x * width - 0.5, coord.y * height - 0.5
                ix, iy = int(np.floor(x)), int(np.floor(y))
                fx, fy = x - ix, y - iy
                value = ((1 - fx) * (1 - fy) * alpha[iy % height, ix % width]
                         + fx * (1 - fy) * alpha[iy % height, (ix + 1) % width]
                         + fx * fy * alpha[(iy + 1) % height, (ix + 1) % width]
                         + (1 - fx) * fy * alpha[(iy + 1) % height, ix % width])
                samples.append(value)
                areas.append(area / 9)
    if not samples or sum(areas) <= 0:
        raise RuntimeError('Empty occiput alpha sample set')
    below = np.array(samples) < HAIR_ALPHA_CUTOFF
    return {'map': os.path.basename(path), 'faces': faces, 'samples': len(samples),
            'method': '3x3 bilinear UV samples per quad; bilinear image filtering; repeat',
            'cutoff': HAIR_ALPHA_CUTOFF, 'below_fraction': float(below.mean()),
            'below_area_weighted_fraction': float(np.average(below, weights=areas))}


def measure(hair, body, region, cohort):
    points = [hair.matrix_world @ v.co for v in hair.data.vertices]
    paired = buried([body.nearest(points[i])[2] for i in cohort])
    surface = Surface(hair)
    distances = [body.nearest(p) for p in surface.points()]
    rendered = buried([signed for point, normal, signed in distances
                       if region.contains(point)])
    absent = [(p - surface.nearest(p)[0]).length * 1000 for p in region.points]
    return {'paired_base_vertices': paired, 'evaluated_vertices': rendered,
            'body_to_hair_mm': distribution(absent)}


def baseline_conform():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    source = subprocess.run(
        ['git', '-C', root, 'show', BASELINE_REF + ':art/pipeline/build_native_silver_proof.py'],
        check=True, capture_output=True, text=True).stdout
    function = next(node for node in ast.parse(source).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'conform_hair')
    namespace = {'np': np, 'Vector': Vector}
    exec(compile(ast.Module(body=[function], type_ignores=[]), BASELINE_REF, 'exec'), namespace)
    return namespace['conform_hair']


def restore(hair, coordinates):
    for vertex, point in zip(hair.data.vertices, coordinates):
        vertex.co = point
    hair.data.update()
    bpy.context.view_layer.update()


def proof_setup(region):
    for image in bpy.data.images:
        path = os.path.join(OUT, os.path.basename(image.filepath.replace('\\', '/')))
        if image.source == 'FILE' and os.path.isfile(path):
            image.filepath = path
            image.reload()
    for obj in list(bpy.data.objects):
        if obj.type in {'LIGHT', 'CAMERA'}:
            bpy.data.objects.remove(obj, do_unlink=True)
    target = Vector((region.lower + region.upper) * 0.5)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'
    scene.view_settings.exposure = 0.15
    scene.view_settings.gamma = 1.0
    scene.world = bpy.data.worlds.new('hair_diagnosis_world')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (0.045, 0.05, 0.06, 1.0)
    background.inputs['Strength'].default_value = 0.5
    for name, offset, energy, size in (
            ('key', (-0.8, 1.0, 0.8), 100.0, 1.2),
            ('fill', (0.8, 0.8, 0.3), 65.0, 1.2),
            ('crown', (0.0, -0.4, 1.0), 75.0, 1.0)):
        add_area('hair_diagnosis_' + name, target + Vector(offset),
                 (1.0, 1.0, 1.0), energy, size, target)
    data = bpy.data.cameras.new('hair_diagnosis_camera')
    data.type = 'ORTHO'
    data.ortho_scale = 0.36
    data.sensor_fit = 'HORIZONTAL'
    camera = bpy.data.objects.new('hair_diagnosis_camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, camera, add_caption(camera), target


def render_pair(hair, cut, before, after, setup):
    scene, camera, caption, target = setup
    tint(hair, (0.038, 0.026, 0.018), 0.94, 'MULTIPLY', 0.54, 0.18)
    for face in hair.data.polygons:
        face.use_smooth = True
    if cut == 'short02':
        for slot in hair.material_slots:
            for node in slot.material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image and 'diffuse' in node.image.name:
                    node.image = bpy.data.images.load(
                        os.path.join(OUT, 'river_silver_hair_diffuse.png'), check_existing=True)
    views = []
    for view, degrees in VIEWS:
        angle = math.radians(degrees)
        camera.location = target + Vector((math.sin(angle) * 0.8,
                                            math.cos(angle) * 0.8, 0.04))
        look_at(camera, target)
        pair = []
        for state, coordinates in (('before', before), ('after', after)):
            restore(hair, coordinates)
            caption.body = '%s | %s\n%s' % (cut, state, view)
            path = os.path.join(OUT, 'hair-a2-%s-%s-%s.png' % (cut, view, state))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(path, check_existing=False)
            width, height = image.size
            pair.append(np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4))
            bpy.data.images.remove(image)
        views.append(np.hstack(pair))
    return views


def main():
    from bl_ext.blender_org.mpfb.services import HumanService

    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, 'native-silver-character.blend'))
    human = bpy.data.objects['river_native_silver_body']
    bpy.data.objects.remove(bpy.data.objects['river_silver_hair'], do_unlink=True)
    body = Surface(human)
    region = Occiput(human, body)
    legacy = baseline_conform()
    report('BASELINE_REF', BASELINE_REF)
    render = '--render' in sys.argv
    setup = proof_setup(region) if render else None
    sheets = {}
    for cut in CUTS:
        hair = HumanService.add_mhclo_asset(
            os.path.join(MPFB_DATA, 'hair', cut, cut + '.mhclo'), human,
            asset_type='hair', subdiv_levels=1, material_type='MAKESKIN',
            set_up_rigging=True, interpolate_weights=True, import_weights=True)
        body = Surface(human)
        cohort = [v.index for v in hair.data.vertices
                  if region.contains(body.nearest(hair.matrix_world @ v.co)[0])]
        original = [v.co.copy() for v in hair.data.vertices]
        raw = measure(hair, body, region, cohort)
        legacy(hair)
        hair.data.update()
        body = Surface(human)
        conformed = measure(hair, body, region, cohort)
        conformed['alpha'] = alpha_samples(hair, region, cut)
        report('COVERAGE', {'cut': cut, 'unconformed': raw, 'conformed': conformed})
        before = [v.co.copy() for v in hair.data.vertices]
        restore(hair, original)
        conform_hair(hair)
        body = Surface(human)
        fixed = measure(hair, body, region, cohort)
        report('CURRENT_CONFORM', {'cut': cut, **fixed})
        if fixed['paired_base_vertices']['inside'] or fixed['evaluated_vertices']['inside']:
            raise RuntimeError('Current conform still buries occiput vertices: ' + cut)
        if render and cut in {'short01', 'short02'}:
            after = [v.co.copy() for v in hair.data.vertices]
            sheets[cut] = render_pair(hair, cut, before, after, setup)
        bpy.data.objects.remove(hair, do_unlink=True)
    if render:
        rows = [np.hstack((sheets['short02'][i], sheets['short01'][i])) for i in range(3)]
        pixels = np.vstack(rows[::-1])
        image = bpy.data.images.new('hair_a2_before_after', pixels.shape[1], pixels.shape[0],
                                    alpha=True)
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw = os.path.join(OUT, 'hair-a2-before-after.png')
        image.file_format = 'PNG'
        image.save()
        report('SHEET', image.filepath_raw)


if __name__ == '__main__':
    main()

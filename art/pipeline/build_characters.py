import json
import math
import os
import sys

os.environ.setdefault('RIVER_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy

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
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    return obj


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


def build_garment(obj, thickness=0.020, fabric_hex='3A2B26', threshold=0.25):
    weights = garment_weights(obj)
    indices = {i for i, w in weights.items() if w >= threshold}
    if not indices:
        return None
    source = obj.data
    garment_name = obj.name.replace('char_', 'garment_')
    garment_mesh = bpy.data.meshes.new(garment_name)
    new_verts = []
    vertex_map = {}
    for index in sorted(indices):
        v = source.vertices[index]
        co = v.co
        n = v.normal
        new_verts.append((co[0] + n[0] * thickness, co[1] + n[1] * thickness, co[2] + n[2] * thickness))
        vertex_map[index] = len(new_verts) - 1
    new_faces = []
    for poly in source.polygons:
        verts = list(poly.vertices)
        if all(i in indices for i in verts):
            new_faces.append([vertex_map[i] for i in verts])
    garment_mesh.from_pydata(new_verts, [], new_faces)
    garment_mat = add_diffuse_material(garment_name + '_mat', fabric_hex)
    garment_mesh.materials.append(garment_mat)
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


def apply_character_materials(obj, skin_hex='C9A27E'):
    mesh = obj.data
    if len(mesh.materials) == 0:
        mesh.materials.append(None)
    if mesh.materials[0] is None:
        mesh.materials[0] = add_diffuse_material(obj.name + '_skin', skin_hex)
    return obj


def main():
    require_mpfb()
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {'characters': []}
    for name, gender, female in [(MALE, 0.1, False), (FEMALE, 0.85, True)]:
        clear_scene()
        obj = create_base(gender, name, female)
        obj = apply_character_materials(obj)
        obj = reduce_body(obj)
        # after the bake, not before - bake_shapekeys rewrites vertex positions
        # from the shapekey mix and would discard these edits
        if female:
            apply_female_proportions(obj)
        garment = build_garment(obj)
        armature = armature_of(obj)
        actions = build_animations(armature) if armature else []
        stats = checks_for(obj)
        garment_verts = len(garment.data.vertices) if garment is not None else 0
        shape = shape_hash(obj)
        glb = export_glb(obj, extra=(garment,))
        manifest['characters'].append({
            'name': name,
            'glb': os.path.basename(glb),
            'faces': stats['faces'],
            'tris': stats['tris'],
            'quad_pct': stats['quad'],
            'vertex_groups': stats['groups'],
            'bones': stats['bones'],
            'actions': actions,
            'garment': garment is not None,
            'checks': stats['checks'],
            'garment_verts': garment_verts,
            'garment_groups': len(garment.vertex_groups) if garment is not None else 0,
            'shape_hash': shape,
        })
        print('CHAR %s faces=%d tris=%d quad=%.3f groups=%d bones=%d garment=%d actions=%d checks=%s' % (
            name, stats['faces'], stats['tris'], stats['quad'],
            stats['groups'], stats['bones'], len(garment_vert_indices(obj)),
            len(actions), stats['checks']
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
        'IDLE_breathe': [('spine01', 0.03, 0.5), ('spine02', 0.04, 2.1), ('head', 0.05, 2.0)],
        'PEEK_card': [('head', 0.35, 1.0), ('lowerarm01.L', 0.4, 1.0)],
        'PRESET_reach': [('upperarm01.R', 0.5, 1.0), ('lowerarm01.R', 0.5, 1.0)],
        'CHIP_toss': [('upperarm01.R', 0.6, 1.0), ('lowerarm01.R', 0.8, 1.0)],
        'DEAL_toss': [('upperarm01.L', 0.6, 1.0), ('lowerarm01.L', 0.8, 1.0)],
        'ALLIN_standup': [('upperleg01.L', 12.0, 1.0), ('upperleg01.R', 12.0, 1.0), ('spine01', 0.6, 1.0), ('head', 0.5, 1.0)],
        'REACT_win': [('head', 0.4, 1.0), ('spine01', 0.4, 1.0), ('upperarm01.R', 0.5, 1.0)],
        'REACT_lose': [('head', 0.5, 1.0), ('spine01', 0.5, 1.0), ('upperarm01.L', 0.5, 1.0)],
        'FOLD_muck': [('head', 0.6, 1.0), ('lowerarm01.R', 0.5, 1.0)],
    }
    for frame in range(duration + 1):
        t = frame / duration
        for bone_name, magnitude, frequency in tracks.get(name, []):
            pose_bone = armature.pose.bones.get(bone_name)
            if pose_bone is None:
                continue
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
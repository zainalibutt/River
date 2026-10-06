"""Conservative animated coverage mask for the authored silver wardrobe.

A vertex is eligible only when clothing intercepts three outward rays at rest
and at every authored clip key and intervening midpoint. Two edge rings are
retained around the resulting boundary. This is sampled coverage, not a claim
of visual acceptance or continuous collision clearance between samples.
"""
import json
import math
import os
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def garment_tree(garments, depsgraph):
    points=[]; faces=[]
    for obj in garments:
        evaluated=obj.evaluated_get(depsgraph)
        offset=len(points)
        points.extend(evaluated.matrix_world @ v.co for v in evaluated.data.vertices)
        faces.extend(tuple(offset+i for i in p.vertices) for p in evaluated.data.polygons)
    return BVHTree.FromPolygons(points,faces)


def covered(tree, point, normal, reach=.065):
    tangent=normal.cross(Vector((0,0,1)))
    if tangent.length<.01: tangent=normal.cross(Vector((1,0,0)))
    tangent.normalize()
    for direction in (normal,(normal+tangent*.20).normalized(),(normal-tangent*.20).normalized()):
        hit,_,_,_=tree.ray_cast(point+direction*.0002,direction,reach)
        if hit is None: return False
    return True


def author_mask(body, rig, garments, actions):
    import build_silver_animation as motion
    names={g.index:g.name for g in body.vertex_groups}
    eligible={v.index for v in body.data.vertices
              if sum(g.weight for g in v.groups if names[g.group].startswith(
                  ('spine','pelvis','clavicle','shoulder','upperarm','lowerarm','upperleg','lowerleg')))>.75}
    initial=len(eligible)
    samples=[]
    for action,(name,spec) in zip(actions,motion.CLIPS.items()):
        frames=sorted({round(t*spec['seconds']*motion.FPS) for t,_ in spec['keys']}
                      |{round((a[0]+b[0])*.5*spec['seconds']*motion.FPS)
                        for a,b in zip(spec['keys'],spec['keys'][1:])})
        samples.extend((action,frame) for frame in frames)
    retained_by_clip={}
    for action,frame in [(None,0),*samples]:
        motion.reset_pose(rig); rig.animation_data.action=action
        bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
        depsgraph=bpy.context.evaluated_depsgraph_get()
        tree=garment_tree(garments,depsgraph)
        evaluated=body.evaluated_get(depsgraph)
        normal_matrix=evaluated.matrix_world.to_3x3().inverted().transposed()
        eligible={i for i in eligible if covered(tree,evaluated.matrix_world@evaluated.data.vertices[i].co,
                  (normal_matrix@evaluated.data.vertices[i].normal).normalized())}
        retained_by_clip[action.name if action else 'rest']=len(eligible)
    for _ in range(2):
        border=set()
        for edge in body.data.edges:
            a,b=edge.vertices
            if (a in eligible)!=(b in eligible): border.update((a,b))
        eligible.difference_update(border)
    if not eligible: raise RuntimeError('No vertices passed animated wardrobe coverage')
    motion.reset_pose(rig); rig.animation_data.action=None
    bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
    before=len(body.data.vertices)
    group=body.vertex_groups.new(name='Delete.silver_authored_black_tie')
    group.add(sorted(eligible),1,'REPLACE')
    mask=body.modifiers.new('Authored wardrobe coverage','MASK')
    mask.vertex_group=group.name; mask.invert_vertex_group=True
    bpy.context.view_layer.update()
    after=len(body.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices)
    if before-after!=len(eligible): raise RuntimeError('Body mask did not remove its selected vertices')
    report={'initial_candidates':initial,'masked_vertices':len(eligible),'body_before':before,'body_after':after,
            'pose_samples':len(samples)+1,'rays_per_vertex':3,'ray_reach_mm':65,'boundary_rings_retained':2,
            'cumulative_candidates_by_clip':retained_by_clip}
    path=os.path.abspath('art/out/proofs/native-silver/a8-mask-report.json')
    with open(path,'w') as output: json.dump(report,output,indent=2)
    print('A8_MASK',json.dumps(report),flush=True)
    return report

"""Photograph the authored draft in the published rooftop, without rebuilding it."""
import json
import math
import os
import sys
import bpy
import numpy as np
from mathutils import Vector, Matrix

sys.dont_write_bytecode=True
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from render_silver_seating_proof import look_at
OUT=os.path.abspath('art/out/proofs/native-silver')
PACKET=os.environ.get('RIVER_WARDROBE_PACKET','a8')


def colour(value):
    srgb=[int(value.lstrip('#')[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in srgb)


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,PACKET+'-wardrobe.blend'))
    actions={name:bpy.data.actions.get(name) for name in __import__('build_silver_animation').CLIPS}
    draft=list(bpy.data.objects)
    rig=next(o for o in draft if o.type=='ARMATURE')
    import build_silver_animation as motion
    motion.reset_pose(rig)
    rig.animation_data.action=None
    bpy.context.view_layer.update()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath('apps/web/public/assets/rooftop_assets.glb'))
    venue=[o for o in bpy.data.objects if o not in draft]
    old=next(o for o in venue if o.type=='MESH' and 'silver_body' in o.name)
    oldrig=next(m.object for m in old.modifiers if m.type=='ARMATURE')
    names=['spine03','head','wrist.L','wrist.R','foot.L','foot.R']
    source=np.array([tuple(rig.matrix_world @ rig.data.bones[n].head_local) for n in names])
    target=np.array([tuple(oldrig.matrix_world @ oldrig.data.bones[n].head_local) for n in names])
    a=source-source.mean(axis=0); b=target-target.mean(axis=0)
    u,s,v=np.linalg.svd(a.T@b)
    rotation=v.T@u.T
    if np.linalg.det(rotation)<0: v[-1]*=-1; rotation=v.T@u.T
    scale=s.sum()/(a*a).sum()
    translation=target.mean(axis=0)-scale*rotation@source.mean(axis=0)
    transform=Matrix.Identity(4)
    for i in range(3):
        for j in range(3): transform[i][j]=scale*rotation[i,j]
        transform[i][3]=translation[i]
    matrices={o:o.matrix_world.copy() for o in draft}
    for o in sorted(draft,key=lambda o:o.parent is not None): o.matrix_world=transform@matrices[o]
    bpy.context.view_layer.update()
    print('ALIGNMENT scale',scale,'rms metres',float(np.sqrt(np.mean((source@(scale*rotation).T+translation-target)**2))),flush=True)
    for o in venue:
        if o==oldrig or o.parent==oldrig or 'silver' in o.name.lower(): o.hide_render=True
    for o in draft:
        if o.type in ('CAMERA','LIGHT'): o.hide_render=True
    scene=bpy.context.scene
    lighting=json.load(open('apps/web/public/assets/lighting.json'))['rooftop']
    scene.world=bpy.data.worlds.new('Published rooftop world'); scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value=(*colour(lighting['world']['colour']),1)
    bg.inputs['Strength'].default_value=lighting['world']['strength']
    for lamp in lighting['lights']:
        data=bpy.data.lights.new(lamp['name'],'AREA')
        data.energy=lamp['energy']; data.color=colour(lamp['colour']); data.shape='SQUARE'; data.size=lamp['size']
        data.use_shadow=lamp['shadow']
        o=bpy.data.objects.new(PACKET+'_'+lamp['name'],data); scene.collection.objects.link(o)
        o.location=lamp['position']; o.rotation_euler=tuple(math.radians(v) for v in lamp['rotation_deg'])
    scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=900; scene.render.resolution_y=900; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'; scene.view_settings.exposure=.9
    camera=bpy.data.objects.new(PACKET+'_proof_camera',bpy.data.cameras.new(PACKET+'_proof_camera'))
    scene.collection.objects.link(camera); scene.camera=camera; camera.data.angle=math.radians(34)
    hips=rig.matrix_world@rig.data.bones['spine03'].head_local
    targetpoint=rig.matrix_world@Vector((0,-.07,.90))
    outward=Vector((hips.x,hips.y,0)).normalized(); side=Vector((-outward.y,outward.x,0))
    views=[('front',-outward*2.7+Vector((0,0,1.05))),
           ('front-quarter',-outward*2.4+side*2.1+Vector((0,0,1.05))),
           ('back',outward*3.0+Vector((0,0,1.25))),
           ('back-quarter',outward*2.6+side*2.2+Vector((0,0,1.15)))]
    wardrobe=[o for o in draft if o.type=='MESH' and any(m.name=='Existing seated rig' for m in o.modifiers)]
    base={o.name:np.array([tuple(v.co) for v in o.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices]) for o in wardrobe}
    report={'wardrobe_meshes':len(wardrobe),'materials':len({m.name for o in wardrobe for m in o.data.materials}),
            'evaluated_triangles':0,'clips':{},'body_delete_vertices':json.load(open(os.path.join(OUT,PACKET+'-mask-report.json')))['masked_vertices'],
            'status':'A8 changes rendered without image inspection; awaiting user acceptance'}
    for o in wardrobe:
        evaluated=o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        evaluated.data.calc_loop_triangles()
        report['evaluated_triangles']+=len(evaluated.data.loop_triangles)
        for vertex in o.data.vertices:
            total=sum(g.weight for g in vertex.groups if o.vertex_groups[g.group].name in rig.data.bones)
            if abs(total-1)>1e-5: raise RuntimeError('Wardrobe weights are not normalised')
    tiles=[]
    for name,offset in views:
        camera.location=hips+offset; look_at(camera,targetpoint)
        scene.render.filepath=os.path.join(OUT,PACKET+'-wardrobe-'+name+'.png')
        bpy.ops.render.render(write_still=True)
        img=bpy.data.images.load(scene.render.filepath,check_existing=False)
        tiles.append(np.array(img.pixels[:],dtype=np.float32).reshape(900,900,4)); bpy.data.images.remove(img)
    pixels=np.vstack((np.hstack(tiles[2:]),np.hstack(tiles[:2])))
    img=bpy.data.images.new(PACKET+'_wardrobe_sheet',1800,1800,alpha=True); img.pixels.foreach_set(pixels.ravel())
    img.filepath_raw=os.path.join(OUT,PACKET+'-wardrobe-sheet.png'); img.file_format='PNG'; img.save()
    print(PACKET.upper()+'_SHEET',img.filepath_raw,flush=True)
    scene.render.resolution_x=600; scene.render.resolution_y=600
    camera.location=hips-outward*2.2+Vector((0,0,.9)); look_at(camera,targetpoint)
    labeldata=bpy.data.curves.new('clip_label','FONT'); labeldata.size=.012
    label=bpy.data.objects.new('clip_label',labeldata); scene.collection.objects.link(label)
    label.parent=camera; label.location=(-.145,.135,-.5)
    ink=bpy.data.materials.new('proof_label'); ink.use_nodes=True
    nodes=ink.node_tree.nodes; nodes.clear()
    emission=nodes.new('ShaderNodeEmission'); output=nodes.new('ShaderNodeOutputMaterial')
    ink.node_tree.links.new(emission.outputs[0],output.inputs['Surface']); labeldata.materials.append(ink)
    cliptiles=[]
    for name,spec in motion.CLIPS.items():
        motion.reset_pose(rig); rig.animation_data.action=actions[name]
        times=sorted(set([t for t,_ in spec['keys']]+[(a[0]+b[0])*.5 for a,b in zip(spec['keys'],spec['keys'][1:])]))
        maximum=0
        for t in times:
            scene.frame_set(round(t*spec['seconds']*motion.FPS))
            depsgraph=bpy.context.evaluated_depsgraph_get()
            for o in wardrobe:
                coords=np.array([tuple(v.co) for v in o.evaluated_get(depsgraph).data.vertices])
                if not np.isfinite(coords).all(): raise RuntimeError('Non-finite animated geometry')
                maximum=max(maximum,float(np.linalg.norm(coords-base[o.name],axis=1).max()))
        report['clips'][name]={'sampled_frames':len(times),'maximum_local_travel_mm':maximum*1000}
        peak=max(spec['keys'],key=lambda key:sum(sum(v*v for v in angles) for angles in key[1].values()))[0]
        scene.frame_set(round(peak*spec['seconds']*motion.FPS)); labeldata.body=name
        scene.render.filepath=os.path.join(OUT,PACKET+'-clip-'+name+'.png')
        bpy.ops.render.render(write_still=True)
        tile=bpy.data.images.load(scene.render.filepath,check_existing=False)
        cliptiles.append(np.array(tile.pixels[:],dtype=np.float32).reshape(600,600,4)); bpy.data.images.remove(tile)
    pixels=np.vstack([np.hstack(cliptiles[i:i+3]) for i in (6,3,0)])
    img=bpy.data.images.new(PACKET+'_clip_sheet',1800,1800,alpha=True); img.pixels.foreach_set(pixels.ravel())
    img.filepath_raw=os.path.join(OUT,PACKET+'-clips-sheet.png'); img.file_format='PNG'; img.save()
    with open(os.path.join(OUT,PACKET+'-wardrobe-report.json'),'w') as output: json.dump(report,output,indent=2)
    print(PACKET.upper()+'_REPORT',json.dumps(report),flush=True)
    rig.animation_data.action=actions['ALLIN_standup']
    spec=motion.CLIPS['ALLIN_standup']
    peak=max(spec['keys'],key=lambda key:sum(sum(v*v for v in angles) for angles in key[1].values()))[0]
    scene.frame_set(round(peak*spec['seconds']*motion.FPS))
    scene.render.resolution_x=900; scene.render.resolution_y=900
    for bearing,offset in (('front-quarter',-outward*2.4+side*2.1+Vector((0,0,1.05))),
                           ('back-quarter',outward*2.6+side*2.2+Vector((0,0,1.15)))):
        camera.location=hips+offset; look_at(camera,targetpoint)
        labeldata.body='ALLIN | '+bearing
        scene.render.filepath=os.path.join(OUT,PACKET+'-allin-'+bearing+'.png')
        bpy.ops.render.render(write_still=True)


if __name__=='__main__': main()

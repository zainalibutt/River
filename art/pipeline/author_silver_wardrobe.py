"""Author a seated black-tie wardrobe draft; no stock suit geometry is used.

Run after prepare_silver_wardrobe.py with Blender --python-exit-code 1.
Dimensions are first-pass tailoring choices in metres around the seated rig.
"""
import json
import math
import os
import sys
import bpy
import bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath('art/out/proofs/native-silver')


def material(name, colour, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Roughness'].default_value = roughness
    return m


def mesh(name, vertices, faces, mat, rig, body, thickness=.002, subdiv=1, fit=True):
    if fit and name.startswith(('dinner_', 'dress_shirt', 'shirt_cuff')):
        tree = BVHTree.FromPolygons([v.co for v in body.data.vertices],
                                   [tuple(p.vertices) for p in body.data.polygons])
        clearance = .016 if name.startswith('dinner_') else .007
        fitted = []
        for point in vertices:
            point = Vector(point)
            near, normal, _, _ = tree.find_nearest(point)
            if near is not None and (point-near).dot(normal) < clearance:
                point = near + normal*clearance
            fitted.append(point)
        vertices = fitted
    if name.startswith(('satin_lapel_', 'shirt_collar_')):
        surfaces=[]
        for candidate in bpy.data.objects:
            if candidate.name in ('river_silver_dinner_jacket','river_silver_dress_shirt'):
                evaluated=candidate.evaluated_get(bpy.context.evaluated_depsgraph_get())
                surfaces.append(BVHTree.FromPolygons([v.co for v in evaluated.data.vertices],
                                [tuple(p.vertices) for p in evaluated.data.polygons]))
        fitted=[]
        for point in vertices:
            point=Vector(point)
            for tree in surfaces:
                hit, _, _, _=tree.ray_cast(Vector((point.x,-1,point.z)),Vector((0,1,0)))
                if hit is not None: point.y=min(point.y,hit.y-.004)
            fitted.append(point)
        vertices=fitted
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new(); bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data); bm.free()
    obj = bpy.data.objects.new('river_silver_' + name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    for p in data.polygons: p.use_smooth = True
    kd = KDTree(len(body.data.vertices))
    for v in body.data.vertices: kd.insert(v.co, v.index)
    kd.balance()
    groups = {g.index: obj.vertex_groups.new(name=g.name) for g in body.vertex_groups if g.name in rig.data.bones}
    for v in data.vertices:
        accumulated = {}
        for _, i, distance in kd.find_n(v.co, 4):
            for g in body.data.vertices[i].groups:
                if g.group in groups:
                    accumulated[g.group] = accumulated.get(g.group, 0) + g.weight / max(distance, .003)**2
        total = sum(accumulated.values())
        if not total: raise RuntimeError('Unweighted wardrobe vertex')
        for group, value in accumulated.items(): groups[group].add([v.index], value / total, 'REPLACE')
    obj.parent = rig
    arm = obj.modifiers.new('Existing seated rig', 'ARMATURE'); arm.object = rig
    if subdiv:
        sub = obj.modifiers.new('Tailored surface', 'SUBSURF'); sub.levels = subdiv; sub.render_levels = subdiv
    if thickness:
        solid = obj.modifiers.new('Cloth thickness and closed hems', 'SOLIDIFY')
        solid.thickness = thickness; solid.offset = -1
    return obj


def loft(name, rings, mat, rig, body, count=40, opening=False):
    verts=[]; faces=[]
    stride=count+1 if opening else count
    for z, cy, rx, ry, gap in rings:
        for j in range(stride):
            a = gap + (2*math.pi-2*gap)*j/count
            verts.append((rx*math.sin(a), cy-ry*math.cos(a), z))
    for i in range(len(rings)-1):
        for j in range(count):
            first=i*stride+j
            second=i*stride+(j+1)%stride
            faces.append((first,second,second+stride,first+stride))
    return mesh(name,verts,faces,mat,rig,body)


def tube(name, controls, radii, mat, rig, body, count=24):
    verts=[]; faces=[]
    for i, centre in enumerate(controls):
        direction=(controls[min(i+1,len(controls)-1)]-controls[max(0,i-1)]).normalized()
        u=direction.cross(Vector((0,1,0))).normalized(); v=direction.cross(u).normalized()
        for j in range(count):
            a=2*math.pi*j/count
            verts.append(centre + radii[i]*(math.cos(a)*u+math.sin(a)*v))
    for i in range(len(controls)-1):
        for j in range(count):
            a=i*count+j; b=i*count+(j+1)%count
            faces.append((a,b,b+count,a+count))
    return mesh(name,verts,faces,mat,rig,body,thickness=.003)


def join_shoulders(garments, rig, body):
    torso=next(o for o in garments if o.name=='river_silver_dinner_jacket')
    sleeves=[next(o for o in garments if o.name=='river_silver_dinner_sleeve_'+side) for side in ('L','R')]
    vertices=[v.co.copy() for v in torso.data.vertices]
    faces=[]
    # A7 torso has 40 columns and 41 vertices per open ring. Each 4 by 8
    # armhole has 24 boundary vertices, matching the authored sleeve ring.
    holes=((5,9,6,14),(5,9,26,34))
    for polygon in torso.data.polygons:
        row,column=divmod(polygon.index,40)
        if not any(lo<=row<hi and left<=column<right for lo,hi,left,right in holes):
            faces.append(tuple(polygon.vertices))
    bridge_edges=set()
    for sleeve,(lo,hi,left,right) in zip(sleeves,holes):
        boundary=([lo*41+j for j in range(left,right+1)]
                  +[i*41+right for i in range(lo+1,hi+1)]
                  +[hi*41+j for j in range(right-1,left-1,-1)]
                  +[i*41+left for i in range(hi-1,lo,-1)])
        offset=len(vertices)
        vertices.extend(v.co.copy() for v in sleeve.data.vertices)
        faces.extend(tuple(offset+i for i in polygon.vertices) for polygon in sleeve.data.polygons)
        alternatives=[]
        for direction in (1,-1):
            for phase in range(24):
                ring=[offset+(phase+direction*j)%24 for j in range(24)]
                cost=sum((vertices[a]-vertices[b]).length_squared for a,b in zip(boundary,ring))
                alternatives.append((cost,ring))
        ring=min(alternatives,key=lambda item:item[0])[1]
        for j in range(24):
            k=(j+1)%24
            face=(boundary[j],boundary[k],ring[k],ring[j])
            faces.append(face)
            bridge_edges.update(tuple(sorted((face[a],face[(a+1)%4]))) for a in range(4))
    result=mesh('dinner_jacket_joined',vertices,faces,torso.data.materials[0],rig,body,fit=False)
    bm=bmesh.new(); bm.from_mesh(result.data)
    nonmanifold=sum(len(e.link_faces)!=2 for e in bm.edges
                    if tuple(sorted(v.index for v in e.verts)) in bridge_edges)
    if nonmanifold: raise RuntimeError('Shoulder bridge has an open or non-manifold edge')
    bm.free()
    for old in [torso,*sleeves]:
        garments.remove(old); bpy.data.objects.remove(old,do_unlink=True)
    garments.append(result)
    print('SHOULDER_JOIN',48,'bridge quads; shared vertex connections; non-manifold bridge edges',nonmanifold,flush=True)


def trouser_seat(body, rig, cloth):
    allowed={g.index for g in body.vertex_groups if g.name.startswith(('pelvis','upperleg','spine05'))}
    selected={v.index for v in body.data.vertices
              if sum(g.weight for g in v.groups if g.group in allowed)>.45 and v.co.z<.70}
    faces=[tuple(p.vertices) for p in body.data.polygons if all(i in selected for i in p.vertices)]
    used=sorted({i for face in faces for i in face})
    mapping={old:new for new,old in enumerate(used)}
    vertices=[body.data.vertices[i].co+body.data.vertices[i].normal*.014 for i in used]
    obj=mesh('dinner_trouser_seat',vertices,[tuple(mapping[i] for i in f) for f in faces],
             cloth,rig,body,subdiv=0,fit=False)
    for group in list(obj.vertex_groups): obj.vertex_groups.remove(group)
    groups={g.index:obj.vertex_groups.new(name=g.name) for g in body.vertex_groups if g.name in rig.data.bones}
    for new,old in enumerate(used):
        weights=[g for g in body.data.vertices[old].groups if g.group in groups]
        total=sum(g.weight for g in weights)
        if total<=0: raise RuntimeError('Trouser seat inherited an unweighted body vertex')
        for g in weights: groups[g.group].add([new],g.weight/total,'REPLACE')
    print('TROUSER_SEAT',len(vertices),'body-derived vertices with identical normalised bone influences',flush=True)
    return obj


def lapel(side, sign, dz, satin, rig, body):
    controls=[(.014,.024,.825),(.023,.046,.88),(.036,.071,.94),
              (.05,.097,.99),(.059,.111,1.026),(.050,.090,1.048),(.041,.063,1.069)]
    vertices=[]; faces=[]
    for inner,outer,z in controls:
        for j in range(4):
            t=j/3
            vertices.append((sign*(inner+(outer-inner)*t),-.145-.004*math.sin(t*math.pi),z+dz))
    for i in range(len(controls)-1):
        for j in range(3):
            a=i*4+j; faces.append((a,a+1,a+5,a+4))
    return mesh('satin_lapel_'+side,vertices,faces,satin,rig,body,thickness=.002,subdiv=1)


def author(body, rig):
    cloth=material('silver_dinner_wool',(.009,.011,.017),.62)
    satin=material('silver_black_satin',(.016,.018,.025),.25)
    white=material('silver_dress_cotton',(.72,.73,.70),.68)
    top=rig.data.bones['upperarm01.L'].head_local.z
    dz=top-.97731
    def rings(rows): return [(z+dz,cy,rx,ry,gap) for z,cy,rx,ry,gap in rows]
    garments=[]
    garments.append(loft('dinner_jacket', rings([
        (.59,.01,.175,.12,0),(.60,.01,.175,.12,0),(.66,0,.17,.12,0),
        (.75,-.01,.155,.118,0),(.80,-.025,.16,.125,.03),(.86,-.035,.18,.132,.2),
        (.93,-.05,.205,.135,.32),(.99,-.065,.22,.126,.37),
        (1.035,-.07,.205,.107,.40),(1.062,-.07,.13,.08,.46),
        (1.08,-.075,.061,.062,.48)]),cloth,rig,body,opening=True))
    garments.append(loft('dress_shirt',rings([
        (.72,-.025,.145,.118,0),(.8,-.04,.155,.122,0),(.92,-.06,.18,.12,0),
        (1.01,-.075,.19,.11,0),(1.065,-.075,.075,.063,0),
        (1.085,-.075,.058,.057,0)]),white,rig,body))
    garments.append(trouser_seat(body,rig,cloth))
    for sign,side in ((1,'L'),(-1,'R')):
        shoulder=rig.data.bones['upperarm01.'+side].head_local.copy()
        elbow=rig.data.bones['lowerarm01.'+side].head_local.copy()
        wrist=rig.data.bones['wrist.'+side].head_local.copy()
        axis=(elbow-shoulder).normalized()
        controls=[shoulder-axis*.04,shoulder-axis*.02,shoulder,shoulder.lerp(elbow,.28),
                  shoulder.lerp(elbow,.65),elbow,elbow.lerp(wrist,.25),elbow.lerp(wrist,.65),
                  elbow.lerp(wrist,.89),elbow.lerp(wrist,.91)]
        garments.append(tube('dinner_sleeve_'+side,controls,[.060,.079,.085,.083,.072,.061,.056,.049,.045,.045],cloth,rig,body))
        garments.append(tube('shirt_cuff_'+side,[elbow.lerp(wrist,.9),elbow.lerp(wrist,.92),wrist,wrist+(wrist-elbow).normalized()*.008],
                             [.043,.043,.041,.041],white,rig,body))
        garments.append(lapel(side,sign,dz,satin,rig,body))
        collar=[(sign*.006,-.14,1.083+dz),(sign*.057,-.127,1.085+dz),
                (sign*.063,-.154,1.03+dz),(sign*.029,-.158,1.045+dz)]
        garments.append(mesh('shirt_collar_'+side,collar,[(0,1,2,3)],white,rig,body,subdiv=0))
        hip=rig.data.bones['upperleg01.'+side].head_local.copy()
        knee=rig.data.bones['lowerleg01.'+side].head_local.copy()
        ankle=rig.data.bones['foot.'+side].head_local.copy()
        garments.append(tube('dinner_trousers_'+side,[hip,hip.lerp(knee,.15),hip.lerp(knee,.55),knee,
            knee.lerp(ankle,.18),knee.lerp(ankle,.65),knee.lerp(ankle,.93),ankle],
            [.105,.109,.093,.075,.069,.055,.047,.047],cloth,rig,body))
        for suffix,loc,scale in [('wing',(sign*.027,-.164,1.059+dz),(.029,.012,.020)),
                                 ('knot',(0,-.171,1.059+dz),(.011,.012,.013))]:
            if suffix=='knot' and sign<0: continue
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=loc)
            o=bpy.context.object
            vertices=[Vector(loc)+Vector((v.co.x*scale[0],v.co.y*scale[1],v.co.z*scale[2])) for v in o.data.vertices]
            faces=[tuple(p.vertices) for p in o.data.polygons]
            bpy.data.objects.remove(o,do_unlink=True)
            garments.append(mesh('bow_'+suffix+'_'+side,vertices,faces,satin,rig,body,thickness=0,subdiv=0))
    join_shoulders(garments,rig,body)
    return garments


def main():
    import export_native_silver as silver
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,'a7-body.blend'))
    body=bpy.data.objects['river_native_silver_body']
    rig=next(m.object for m in body.modifiers if m.type=='ARMATURE')
    garments=author(body,rig)
    actions=silver.author_motion_set(rig)
    from mask_silver_wardrobe import author_mask
    author_mask(body,rig,garments,actions)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'a8-wardrobe.blend'))


if __name__=='__main__': main()

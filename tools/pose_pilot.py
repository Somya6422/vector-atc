# Relaxes an A-pose character into a natural standing pose (arms down at the sides) and exports it again.
# Run with Blender:  blender -b --python tools/pose_pilot.py -- in.glb out.glb preview.png
# A temporary armature (body + upper/lower arm bones) is skinned with automatic weights, the arms are rotated down,
# the pose is applied to the mesh and the armature is removed, so the exported model stays a plain textured mesh.
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, out, preview = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj
bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
zmin = min(v.z for v in vs); zmax = max(v.z for v in vs); H = zmax - zmin
xc = sum(v.x for v in vs) / len(vs)
band = [v for v in vs if zmin + 0.40 * H < v.z < zmin + 0.78 * H]

arms = {}
for side in (1, -1):
    tip = max(band, key=lambda v: side * (v.x - xc))
    sh = Vector((xc + side * 0.105 * H, sum(v.y for v in vs) / len(vs), zmin + 0.815 * H))
    d = (tip - sh); wrist = sh + d * 0.86; elbow = sh + d * 0.47
    arms[side] = (sh, elbow, wrist, tip)
    print('ARM', side, 'shoulder', tuple(round(c / H, 3) for c in (sh.x - xc, sh.z - zmin)), 'tip', tuple(round(c / H, 3) for c in (tip.x - xc, tip.z - zmin)))

arm_data = bpy.data.armatures.new('rig'); rig = bpy.data.objects.new('rig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
body = eb.new('body'); body.head = Vector((xc, arms[1][0].y, zmin + 0.05 * H)); body.tail = Vector((xc, arms[1][0].y, zmin + 0.93 * H))
chest = eb.new('chest'); chest.head = Vector((xc, arms[1][0].y, zmin + 0.62 * H)); chest.tail = Vector((xc, arms[1][0].y, zmin + 0.84 * H)); chest.parent = body
for side, (sh, el, wr, tip) in arms.items():
    n = 'L' if side > 0 else 'R'
    clav = eb.new('clav.' + n); clav.head = Vector((xc, sh.y, sh.z)); clav.tail = sh.copy(); clav.parent = chest
    up = eb.new('upper.' + n); up.head = sh.copy(); up.tail = el.copy(); up.parent = clav
    lo = eb.new('lower.' + n); lo.head = el.copy(); lo.tail = wr.copy(); lo.parent = up; lo.use_connect = True
    hd = eb.new('hand.' + n); hd.head = wr.copy(); hd.tail = tip.copy(); hd.parent = lo; hd.use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE')
# explicit weights (automatic bone-heat weighting fails on these scanned meshes): every vertex outside the torso and
# above the hips follows its shoulder, blended across the armpit so the sleeve seam bends smoothly
def ramp(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
groups = {side: obj.vertex_groups.new(name='upper.' + ('L' if side > 0 else 'R')) for side in (1, -1)}
inv = obj.matrix_world
for v in obj.data.vertices:
    p = inv @ v.co; dx = p.x - xc; side = 1 if dx > 0 else -1
    # below the waist only the far-out hands/forearms belong to the arm (the hips are wide there)
    lowk = 1 - ramp(zmin + 0.52 * H, zmin + 0.6 * H, p.z)
    x0 = 0.095 * H + lowk * 0.075 * H
    w = ramp(x0, x0 + 0.04 * H, abs(dx)) * ramp(zmin + 0.36 * H, zmin + 0.42 * H, p.z)
    if w > 0.001: groups[side].add([v.index], w, 'REPLACE')
print('WEIGHTED', {('L' if s > 0 else 'R'): sum(1 for v in obj.data.vertices for g in v.groups if g.group == grp.index) for s, grp in groups.items()})

bpy.ops.object.mode_set(mode='POSE')
for side, (sh, el, wr, tip) in arms.items():
    n = 'L' if side > 0 else 'R'
    d = wr - sh
    d = tip - sh
    cur = math.atan2(abs(d.x), -d.z)                 # arm angle from straight down (shoulder to fingertips)
    want = math.radians(9)
    a = side * (cur - want)                           # rotation about +Y brings the arm towards the body
    pb = rig.pose.bones['upper.' + n]
    R = Matrix.Translation(sh) @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Translation(-sh)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()
    print('ROTATED', n, round(math.degrees(cur), 1), '->', 9)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.context.view_layer.objects.active = obj
for m in obj.modifiers:
    if m.type == 'ARMATURE': bpy.ops.object.modifier_apply(modifier=m.name)
obj.parent = None
bpy.data.objects.remove(rig)
for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85)

cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
cam.location = (xc, -H * 2.4, zmin + H * 0.5); cam.rotation_euler = (math.radians(90), 0, 0)
sun = bpy.data.objects.new('l', bpy.data.lights.new('l', 'SUN')); bpy.context.scene.collection.objects.link(sun); sun.rotation_euler = (math.radians(50), 0, math.radians(30))
sc = bpy.context.scene; sc.render.resolution_x = 400; sc.render.resolution_y = 600; sc.render.filepath = preview
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
bpy.ops.render.render(write_still=True)

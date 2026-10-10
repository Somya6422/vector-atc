# Run with Blender:  blender -b model.blend --python tools/blend_export.py -- out.glb preview.png [target_tris]
# Joins the meshes, decimates to a game-friendly triangle count, shrinks textures to 1024 px, exports a textured .glb
# and renders a quick preview image so the orientation can be checked.
import bpy, sys, math

argv = sys.argv[sys.argv.index('--') + 1:]
out, preview = argv[0], argv[1]
target = int(argv[2]) if len(argv) > 2 else 20000

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('MESHES', [(o.name, len(o.data.polygons)) for o in meshes])
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
print('TRIS', tris)
if tris > target:
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.ratio = target / tris
    bpy.ops.object.modifier_apply(modifier='dec')
print('TRIS_AFTER', sum(len(p.vertices) - 2 for p in obj.data.polygons))
for img in bpy.data.images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        img.scale(1024, 1024)
d = obj.dimensions
print('DIMS', tuple(round(x, 3) for x in d))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85, use_selection=False)

# preview render from the front (-Y) and side
cam_data = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cam_data); bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
h = max(d)
cam.location = (0, -h * 2.2, d.z * 0.5 + obj.location.z)
cam.rotation_euler = (math.radians(90), 0, 0)
light = bpy.data.objects.new('l', bpy.data.lights.new('l', 'SUN')); bpy.context.scene.collection.objects.link(light)
light.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.context.scene.render.resolution_x = 400; bpy.context.scene.render.resolution_y = 600
bpy.context.scene.render.filepath = preview
bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
bpy.context.scene.display.shading.light = 'STUDIO'
bpy.context.scene.display.shading.color_type = 'TEXTURE'
bpy.ops.render.render(write_still=True)

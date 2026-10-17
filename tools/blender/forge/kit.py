"""
THE FORGE KIT — what every Forge script shares (docs/forge.md).

Spaces. Everything here is authored in GAME space — three's frame for the
rig group a piece hangs on: +y up, front −z, x across — and converted to
Blender's Z-up frame only when a mesh is made (`to_blender`). The glTF
exporter maps Blender (x, y, z) → (x, z, −y), so game (X, Y, Z) is Blender
(X, −Z, Y). A script never has to think about Blender's axes.

UVs. glTF flips v on export, and the game loads Forge textures with
flipY = false (like the hand kit) but bakes PAINT into canvases with
flipY = true. So a mesh whose paint UV must read (u, v) in the game — v up,
the old loft's convention — is written to Blender as (u, 1 − v). `uv_game`
does that.
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PUBLIC = os.path.join(REPO, "public", "forge")
RENDERS = "C:/Users/alexv/Desktop/blendercyber/renders/forge"
WORK = "C:/Users/alexv/Desktop/blendercyber/bake_work/forge"


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.unit_settings.scale_length = 1.0
    return scn


def set_gpu(scn):
    scn.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scn.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001
        print("GPU setup failed:", e)


def to_blender(p):
    """Game (x, y, z) → Blender (x, −z, y)."""
    return (p[0], -p[2], p[1])


def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_object(name, verts_game, faces, uvs_game=None, smooth=True):
    """A mesh from game-space vertices and faces (vertex-index tuples).
    `uvs_game` is per-face-corner (u, v) in the GAME's convention (v up) and
    is written as (u, 1 − v) — see the module note."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([to_blender(v) for v in verts_game], [], faces)
    if uvs_game is not None:
        uvl = me.uv_layers.new(name="UVMap")
        flat = np.asarray(uvs_game, dtype=np.float32).reshape(-1, 2).copy()
        flat[:, 1] = 1.0 - flat[:, 1]
        uvl.data.foreach_set("uv", flat.ravel())
    me.validate()
    me.update()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    return link(ob)


def apply_all(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


# ---------------------------------------------------------------------------
# Node helpers (the hand kit's)
# ---------------------------------------------------------------------------

def N(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k.startswith("_"):
            setattr(n, k[1:], v)
        else:
            n.inputs[k].default_value = v
    return n


def op(nt, kind, a, b=None, c=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = kind
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def maprange(nt, v, a, b, c=0.0, d=1.0, clamp=True):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.clamp = clamp
    n.inputs["From Min"].default_value = a
    n.inputs["From Max"].default_value = b
    n.inputs["To Min"].default_value = c
    n.inputs["To Max"].default_value = d
    nt.links.new(v, n.inputs["Value"])
    return n.outputs[0]


def sock(nt, v):
    if isinstance(v, (int, float)):
        n = N(nt, "ShaderNodeValue")
        n.outputs[0].default_value = v
        return n.outputs[0]
    return v


# ---------------------------------------------------------------------------
# Finishes. Each returns (material, taps) where taps feed the bake:
#   orm  = (occlusion, roughness, metalness)   — roughness is RELATIVE for
#          the shell (the game multiplies by the tone's own roughness)
#   nrm  = the shaded BSDF's normal (bevel + bump), baked tangent-space
# ---------------------------------------------------------------------------

FINISH_PREVIEW = {
    # preview colour, roughness, metalness — what the review renders show
    "shell": ((0.86, 0.85, 0.83), 0.55, 0.0),
    "shell_onyx": ((0.018, 0.018, 0.02), 0.38, 0.25),
    "trim": ((0.16, 0.165, 0.175), 0.32, 1.0),
    "steel": ((0.55, 0.56, 0.58), 0.22, 1.0),
    "rubber": ((0.025, 0.025, 0.027), 0.8, 0.0),
    "glow": ((1.0, 0.48, 0.1), 0.4, 0.0),
}


def make_finish(name, kind, bevel=0.0012, ao_dist=0.03, micro=1.0, edge_wear=True):
    """kind: 'shell' | 'trim' | 'steel' | 'rubber' | 'glow'."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links.new
    tc = N(nt, "ShaderNodeTexCoord")
    geo = N(nt, "ShaderNodeNewGeometry")
    co = tc.outputs["Object"]

    bev = N(nt, "ShaderNodeBevel", Radius=bevel)
    bev.samples = 16
    dot = N(nt, "ShaderNodeVectorMath", _operation="DOT_PRODUCT")
    L(geo.outputs["Normal"], dot.inputs[0])
    L(bev.outputs["Normal"], dot.inputs[1])
    edge = maprange(nt, dot.outputs["Value"], 0.996, 0.9)

    ao = N(nt, "ShaderNodeAmbientOcclusion", Distance=ao_dist)
    ao.samples = 24
    aov = maprange(nt, ao.outputs["AO"], 0.0, 1.0, 0.18, 1.0)

    n_fine = N(nt, "ShaderNodeTexNoise", Scale=700.0, Detail=6.0, Roughness=0.6)
    L(co, n_fine.inputs["Vector"])
    n_mid = N(nt, "ShaderNodeTexNoise", Scale=90.0, Detail=4.0, Roughness=0.55)
    L(co, n_mid.inputs["Vector"])
    n_big = N(nt, "ShaderNodeTexNoise", Scale=14.0, Detail=3.0, Roughness=0.5)
    L(co, n_big.inputs["Vector"])

    # Hairline scratches: stretched noise thresholded to lines.
    sc_vec = N(nt, "ShaderNodeVectorMath", _operation="MULTIPLY")
    sc_vec.inputs[1].default_value = (1.0, 0.05, 1.0)
    L(co, sc_vec.inputs[0])
    sc_rot = N(nt, "ShaderNodeVectorRotate", _rotation_type="Z_AXIS")
    sc_rot.inputs["Angle"].default_value = 0.6
    L(sc_vec.outputs[0], sc_rot.inputs["Vector"])
    n_scr = N(nt, "ShaderNodeTexNoise", Scale=900.0, Detail=1.0)
    L(sc_rot.outputs[0], n_scr.inputs["Vector"])
    scr_line = maprange(nt, op(nt, "ABSOLUTE", op(nt, "SUBTRACT", n_scr.outputs["Fac"], 0.5)), 0.005, 0.0)
    scr_gate = maprange(nt, n_mid.outputs["Fac"], 0.6, 0.64)
    scratch = op(nt, "MULTIPLY", scr_line, scr_gate)

    # Height: an orange-peel on coats, lathe/brush on steel, pebble on rubber.
    if kind == "shell":
        height = op(nt, "MULTIPLY", n_fine.outputs["Fac"], 0.08 * micro)
        height = op(nt, "MULTIPLY_ADD", scratch, -0.12 * micro, height)
    elif kind in ("trim", "steel"):
        brush = N(nt, "ShaderNodeTexNoise", Scale=2500.0, Detail=2.0)
        bv = N(nt, "ShaderNodeVectorMath", _operation="MULTIPLY")
        bv.inputs[1].default_value = (0.02, 1.0, 1.0)
        L(co, bv.inputs[0])
        L(bv.outputs[0], brush.inputs["Vector"])
        height = op(nt, "MULTIPLY", brush.outputs["Fac"], 0.05 * micro)
        height = op(nt, "MULTIPLY_ADD", scratch, -0.25 * micro, height)
    elif kind == "rubber":
        height = op(nt, "MULTIPLY", n_fine.outputs["Fac"], 0.3 * micro)
    else:
        height = op(nt, "MULTIPLY", n_fine.outputs["Fac"], 0.0)
    bump = N(nt, "ShaderNodeBump", Strength=0.35, Distance=0.0003)
    L(height, bump.inputs["Height"])
    L(bev.outputs["Normal"], bump.inputs["Normal"])

    # ORM taps.
    if kind == "shell":
        # Relative roughness ~1 (the game scales by the tone's own), a
        # touch glossier on worn high edges, rougher in the crevices.
        rough = op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.1, 0.9)
        if edge_wear:
            rough = op(nt, "SUBTRACT", rough, op(nt, "MULTIPLY", edge, 0.12))
        rough = op(nt, "ADD", rough, op(nt, "MULTIPLY", scratch, 0.08))
        metal = 1.0
    elif kind in ("trim", "steel"):
        base_r = 0.3 if kind == "trim" else 0.2
        rough = op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.12, base_r)
        rough = op(nt, "ADD", rough, op(nt, "MULTIPLY", scratch, 0.12))
        rough = op(nt, "ADD", rough, op(nt, "MULTIPLY", n_big.outputs["Fac"], 0.06))
        metal = 1.0
    elif kind == "rubber":
        rough = op(nt, "MULTIPLY_ADD", n_fine.outputs["Fac"], 0.1, 0.78)
        metal = 0.0
    else:  # glow
        rough = 0.4
        metal = 0.0
    rough, metal = sock(nt, rough), sock(nt, metal)

    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    col, r0, m0 = FINISH_PREVIEW[kind]
    bsdf.inputs["Base Color"].default_value = (*col, 1)
    if kind == "shell":
        L(op(nt, "MULTIPLY", rough, r0), bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = m0
    else:
        L(rough, bsdf.inputs["Roughness"])
        L(metal, bsdf.inputs["Metallic"])
    if kind == "glow":
        bsdf.inputs["Emission Color"].default_value = (*col, 1)
        bsdf.inputs["Emission Strength"].default_value = 6.0
    L(bump.outputs["Normal"], bsdf.inputs["Normal"])
    out = N(nt, "ShaderNodeOutputMaterial")
    L(bsdf.outputs[0], out.inputs["Surface"])
    img = N(nt, "ShaderNodeTexImage")
    nt.nodes.active = img
    emit = N(nt, "ShaderNodeEmission")
    comb = N(nt, "ShaderNodeCombineColor")
    mat["finish"] = kind
    taps = dict(orm=[aov, rough, metal])
    return mat, dict(nt=nt, out=out, bsdf=bsdf, emit=emit, comb=comb, img=img, taps=taps, kind=kind)


def route(t, chan):
    """Point a finish's output at the shaded BSDF ('nrm') or at a tap set
    through an emission shader (EMIT bake)."""
    nt, out = t["nt"], t["out"]
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    if chan == "shade":
        nt.links.new(t["bsdf"].outputs[0], out.inputs["Surface"])
        return
    for i, s in enumerate(t["taps"][chan]):
        for l in list(t["comb"].inputs[i].links):
            nt.links.remove(l)
        nt.links.new(s, t["comb"].inputs[i])
    for l in list(t["emit"].inputs["Color"].links):
        nt.links.remove(l)
    nt.links.new(t["comb"].outputs[0], t["emit"].inputs["Color"])
    nt.links.new(t["emit"].outputs[0], out.inputs["Surface"])


# ---------------------------------------------------------------------------
# UVs + bakes
# ---------------------------------------------------------------------------

def smart_uv(objs, margin=0.004, angle=55.0):
    """One atlas over every object, islands sized by real area so ink and
    texel density are even across the piece."""
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=1.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def new_image(name, size, chan):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=chan == "nrm")
    im.colorspace_settings.name = "Non-Color"
    return im


def bake(objs, taps_list, chan, im, samples=32, high=None, extrusion=0.004, margin=8):
    """Bake one channel of `objs` (sharing one UV atlas) into `im`.
    chan 'nrm' bakes the shaded normal (bevel + bump), or the high mesh's
    surface when `high` is given (selected → active); anything else bakes
    the finish taps through emission."""
    scn = bpy.context.scene
    for t in taps_list:
        t["img"].image = im
        t["nt"].nodes.active = t["img"]
        route(t, "shade" if chan == "nrm" else chan)
    scn.cycles.samples = samples
    if high is not None:
        select_only(list(high) + list(objs), active=objs[0])
        if len(objs) != 1:
            raise ValueError("a high → low bake takes one low object")
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_selected_to_active=True,
                            cage_extrusion=extrusion, max_ray_distance=extrusion * 2.5, margin=margin, use_clear=True)
    else:
        select_only(objs)
        if chan == "nrm":
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=margin, use_clear=True)
        else:
            bpy.ops.object.bake(type="EMIT", margin=margin, use_clear=True)
    for t in taps_list:
        route(t, "shade")
    print("baked", chan, im.name, flush=True)


def pixels(im):
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


def write_webp(path, arr, quality=90):
    """arr: H×W×4 float 0..1, written byte-for-byte (no colour transform)."""
    scn = bpy.context.scene
    h, w = arr.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = "WEBP"
    scn.render.image_settings.quality = quality
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save()
    bpy.data.images.remove(im)
    print("wrote", path, flush=True)


def export_glb(objs, path):
    """Unmaterialled GLB of `objs` (each keeps its name, which the game
    reads as its finish). Tangents are left to the game (derivative
    tangents), like the hand kit."""
    for o in objs:
        if o.type == "MESH":
            o.data.materials.clear()
    select_only(objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_materials="NONE",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_yup=True,
        export_apply=True,
    )
    print("wrote", path, flush=True)


# ---------------------------------------------------------------------------
# Review renders: a studio, a primer bust, a turntable of cameras
# ---------------------------------------------------------------------------

def studio(scn, bg=(0.05, 0.05, 0.06), strength=1.0, transparent=False):
    set_gpu(scn)
    scn.cycles.use_denoising = True
    scn.render.film_transparent = transparent
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*bg, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scn.world = world
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Medium High Contrast"

    def area(name, loc, rot, size, power, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.size = size
        ld.energy = power * strength
        ld.color = color
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = rot
        link(lo)
        return lo

    # Key high front-left, a cool rim behind right, a soft fill low front.
    # (Blender frame: the game's front −z is Blender +Y.)
    area("key", (-1.6, 2.4, 2.6), (math.radians(-50), 0, math.radians(-150)), 1.6, 420)
    area("rim", (1.8, -2.0, 2.2), (math.radians(55), 0, math.radians(40)), 1.2, 380, (0.75, 0.85, 1.0))
    area("fill", (1.8, 2.2, 0.9), (math.radians(-75), 0, math.radians(140)), 2.4, 120)
    area("top", (0, 0, 3.4), (0, 0, 0), 2.0, 140)


def camera(scn, target_game, dist, yaw_deg, pitch_deg=8.0, lens=85.0, name="cam"):
    """A camera looking at a game-space point from `dist` metres, `yaw`
    degrees round from the front (0 = dead ahead, +90 = the figure's left)."""
    tx, ty, tz = to_blender(target_game)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    # Front is Blender +Y; yaw turns about Z.
    x = tx + dist * math.cos(pitch) * math.sin(yaw)
    y = ty + dist * math.cos(pitch) * math.cos(yaw)
    z = tz + dist * math.sin(pitch)
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    co = bpy.data.objects.new(name, cd)
    co.location = (x, y, z)
    d = Vector((tx, ty, tz)) - Vector((x, y, z))
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    link(co)
    scn.camera = co
    return co


def render_to(scn, path, res=(900, 1200), samples=96):
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.cycles.samples = samples
    scn.render.image_settings.file_format = "PNG"
    scn.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("rendered", path, flush=True)

"""
THE IRON â€” the fireball's core: a cast-iron shot, pitted and scaled by the
forge, split by cracks that glow molten from inside.

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/fireball_iron.py [-- --render]

Writes public/arena/fire/:

    iron.glb          the sphere (radius 1 â€” fire.ts scales it to FIREBALL.radius)
                      with its own UVs, so the maps land exactly where baked
    iron_albedo.jpg   sRGB base colour: blackened iron, oxide scale, bright
                      wear on the high spots
    iron_nrm.webp     tangent-space normal: pits, hammer facets, the cracks'
                      sunken lips
    iron_orm.jpg      R = cavity occlusion, G = roughness, B = metalness
                      (three's aoMap/roughnessMap/metalnessMap channels)
    iron_heat.jpg     R = the crack glow (molten), G = the pit glow (embers
                      in the hollows), B = a slow noise the shader pans for
                      the heat crawling through the cracks

Every surface pattern is 3D noise on object coordinates, so there is no
seam and no pole pinch in the pattern itself â€” the bake just samples it
through the sphere's UVs.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "public", "arena", "fire")
RENDERS = "C:/Users/alexv/Desktop/blendercyber/renders/fire"
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--render" in argv
SIZE = 1024


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith("_"):
            setattr(n, k[1:], v)
        else:
            n.inputs[k].default_value = v
    return n


def build_material():
    mat = bpy.data.materials.new("iron")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links.new
    tc = node(nt, "ShaderNodeTexCoord")
    co = tc.outputs["Object"]

    # Warp the coordinates a touch so every pattern reads cast, not stamped.
    warp = node(nt, "ShaderNodeTexNoise", Scale=1.6, Detail=3.0, Roughness=0.5)
    L(co, warp.inputs["Vector"])
    wv = node(nt, "ShaderNodeVectorMath", _operation="MULTIPLY_ADD")
    wv.inputs[1].default_value = (0.18, 0.18, 0.18)
    L(warp.outputs["Color"], wv.inputs[0])
    L(co, wv.inputs[2])
    p = wv.outputs[0]

    # CRACKS: voronoi cell edges, gated by a broad mask so the ball splits
    # in a few long seams rather than crazing like an eggshell. Each seam's
    # width wanders (distance / a noise), and it has two readings: the
    # GROOVE (wide — the sunken, scorched lips, for height and albedo) and
    # the CORE (thin — the molten line that glows).
    vor = node(nt, "ShaderNodeTexVoronoi", Scale=2.6, Randomness=1.0, _feature="DISTANCE_TO_EDGE")
    L(p, vor.inputs["Vector"])
    wid = node(nt, "ShaderNodeTexNoise", Scale=4.0, Detail=4.0, Roughness=0.6)
    L(co, wid.inputs["Vector"])
    wid_r = node(nt, "ShaderNodeMapRange", **{"From Min": 0.3, "From Max": 0.7, "To Min": 0.15, "To Max": 1.6})
    L(wid.outputs["Fac"], wid_r.inputs["Value"])
    dist = node(nt, "ShaderNodeMath", _operation="DIVIDE")
    L(vor.outputs["Distance"], dist.inputs[0])
    L(wid_r.outputs[0], dist.inputs[1])
    # jag the edge with fine noise so the seam is torn, not drawn
    jag = node(nt, "ShaderNodeTexNoise", Scale=40.0, Detail=6.0, Roughness=0.7)
    L(co, jag.inputs["Vector"])
    jd = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(jag.outputs["Fac"], jd.inputs[0])
    jd.inputs[1].default_value = 0.03
    L(dist.outputs[0], jd.inputs[2])
    groove_r = node(nt, "ShaderNodeMapRange", **{"From Min": 0.012, "From Max": 0.05, "To Min": 1.0, "To Max": 0.0})
    L(jd.outputs[0], groove_r.inputs["Value"])
    core_r = node(nt, "ShaderNodeMapRange", **{"From Min": 0.008, "From Max": 0.05, "To Min": 1.0, "To Max": 0.0})
    L(jd.outputs[0], core_r.inputs["Value"])
    mask = node(nt, "ShaderNodeTexNoise", Scale=1.2, Detail=2.0)
    L(co, mask.inputs["Vector"])
    mask_r = node(nt, "ShaderNodeMapRange", **{"From Min": 0.47, "From Max": 0.6})
    L(mask.outputs["Fac"], mask_r.inputs["Value"])
    g1 = node(nt, "ShaderNodeMath", _operation="MULTIPLY")
    L(groove_r.outputs[0], g1.inputs[0])
    L(mask_r.outputs[0], g1.inputs[1])
    c1 = node(nt, "ShaderNodeMath", _operation="MULTIPLY")
    L(core_r.outputs[0], c1.inputs[0])
    L(mask_r.outputs[0], c1.inputs[1])
    # Hairline checks branching off the seams: groove only, a faint glow.
    vor2 = node(nt, "ShaderNodeTexVoronoi", Scale=9.0, Randomness=1.0, _feature="DISTANCE_TO_EDGE")
    L(p, vor2.inputs["Vector"])
    hair = node(nt, "ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 0.012, "To Min": 1.0, "To Max": 0.0})
    L(vor2.outputs["Distance"], hair.inputs["Value"])
    mask2_r = node(nt, "ShaderNodeMapRange", **{"From Min": 0.58, "From Max": 0.66})
    L(mask.outputs["Fac"], mask2_r.inputs["Value"])
    h2m = node(nt, "ShaderNodeMath", _operation="MULTIPLY")
    L(hair.outputs[0], h2m.inputs[0])
    L(mask2_r.outputs[0], h2m.inputs[1])
    gmax = node(nt, "ShaderNodeMath", _operation="MAXIMUM")
    L(g1.outputs[0], gmax.inputs[0])
    L(h2m.outputs[0], gmax.inputs[1])
    crack = gmax.outputs[0]  # the groove
    hglow = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(h2m.outputs[0], hglow.inputs[0])
    hglow.inputs[1].default_value = 0.3
    L(c1.outputs[0], hglow.inputs[2])
    hcl = node(nt, "ShaderNodeClamp")
    L(hglow.outputs[0], hcl.inputs["Value"])
    crack_core = hcl.outputs[0]  # the molten line

    # PITS: casting porosity â€” small voronoi craters, sparse.
    pits = node(nt, "ShaderNodeTexVoronoi", Scale=26.0, Randomness=1.0, _feature="F1")
    L(p, pits.inputs["Vector"])
    pit_r = node(nt, "ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 0.22, "To Min": 1.0, "To Max": 0.0})
    L(pits.outputs["Distance"], pit_r.inputs["Value"])
    pit_sel = node(nt, "ShaderNodeMapRange", **{"From Min": 0.8, "From Max": 0.95})
    L(pits.outputs["Color"], pit_sel.inputs["Value"])  # only some cells are pits
    pit = node(nt, "ShaderNodeMath", _operation="MULTIPLY")
    L(pit_r.outputs[0], pit.inputs[0])
    L(pit_sel.outputs[0], pit.inputs[1])
    pit = pit.outputs[0]

    # HAMMER FACETS: broad, shallow planes from the forge.
    facet = node(nt, "ShaderNodeTexVoronoi", Scale=5.0, Randomness=1.0, _feature="SMOOTH_F1")
    facet.inputs["Smoothness"].default_value = 0.6
    L(p, facet.inputs["Vector"])
    # Grain: fine fbm.
    grain = node(nt, "ShaderNodeTexNoise", Scale=60.0, Detail=8.0, Roughness=0.62)
    L(co, grain.inputs["Vector"])
    scale_n = node(nt, "ShaderNodeTexNoise", Scale=7.0, Detail=6.0, Roughness=0.58)
    L(p, scale_n.inputs["Vector"])

    # HEIGHT = facets + grain + scale - pits - cracks.
    h = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(facet.outputs["Distance"], h.inputs[0])
    h.inputs[1].default_value = 0.6
    L(grain.outputs["Fac"], h.inputs[2])
    h2 = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(scale_n.outputs["Fac"], h2.inputs[0])
    h2.inputs[1].default_value = 0.5
    L(h.outputs[0], h2.inputs[2])
    h3 = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(pit, h3.inputs[0])
    h3.inputs[1].default_value = -0.9
    L(h2.outputs[0], h3.inputs[2])
    h4 = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(crack, h4.inputs[0])
    h4.inputs[1].default_value = -1.4
    L(h3.outputs[0], h4.inputs[2])
    height = h4.outputs[0]

    bump = node(nt, "ShaderNodeBump", Strength=0.55, Distance=0.02)
    L(height, bump.inputs["Height"])

    # ALBEDO: blackened iron with rust-brown oxide scale; worn bright where
    # the scale has flaked off the high spots.
    scale_mask = node(nt, "ShaderNodeMapRange", **{"From Min": 0.45, "From Max": 0.62})
    L(scale_n.outputs["Fac"], scale_mask.inputs["Value"])
    base = node(nt, "ShaderNodeMix", _data_type="RGBA")
    base.inputs["A"].default_value = (0.035, 0.034, 0.036, 1)  # blackened
    base.inputs["B"].default_value = (0.11, 0.065, 0.04, 1)  # oxide scale
    L(scale_mask.outputs[0], base.inputs["Factor"])
    wear = node(nt, "ShaderNodeMapRange", **{"From Min": 0.66, "From Max": 0.95, "To Max": 0.55})
    L(facet.outputs["Distance"], wear.inputs["Value"])
    worn = node(nt, "ShaderNodeMix", _data_type="RGBA")
    L(wear.outputs[0], worn.inputs["Factor"])
    L(base.outputs["Result"], worn.inputs["A"])
    worn.inputs["B"].default_value = (0.23, 0.22, 0.21, 1)  # bare iron
    # Scorch: cracks and pits blacken their rims.
    rim = node(nt, "ShaderNodeMath", _operation="MAXIMUM")
    L(crack, rim.inputs[0])
    L(pit, rim.inputs[1])
    scorch = node(nt, "ShaderNodeMix", _data_type="RGBA")
    L(rim.outputs[0], scorch.inputs["Factor"])
    L(worn.outputs["Result"], scorch.inputs["A"])
    scorch.inputs["B"].default_value = (0.012, 0.01, 0.01, 1)
    albedo = scorch.outputs["Result"]

    # ROUGHNESS: scale is matte, bare iron satin.
    rough = node(nt, "ShaderNodeMapRange", **{"To Min": 0.78, "To Max": 0.42})
    L(wear.outputs[0], rough.inputs["Value"])
    rough_g = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(grain.outputs["Fac"], rough_g.inputs[0])
    rough_g.inputs[1].default_value = 0.18
    L(rough.outputs[0], rough_g.inputs[2])
    rough_c = node(nt, "ShaderNodeMath", _operation="SUBTRACT")
    L(rough_g.outputs[0], rough_c.inputs[0])
    rough_c.inputs[1].default_value = 0.09
    roughness = rough_c.outputs[0]

    # METALNESS: oxide scale is not metal; bare iron is.
    metal = node(nt, "ShaderNodeMapRange", **{"To Min": 0.35, "To Max": 0.95})
    L(wear.outputs[0], metal.inputs["Value"])

    # CAVITY: the deep bits.
    cav = node(nt, "ShaderNodeMapRange", **{"From Min": -0.9, "From Max": 0.9, "To Min": 0.35, "To Max": 1.0})
    L(height, cav.inputs["Value"])

    # PIT GLOW: embers at the bottom of the hollows (softer, wider than pit).
    pit_glow = node(nt, "ShaderNodeMapRange", **{"From Min": 0.0, "From Max": 0.09, "To Min": 1.0, "To Max": 0.0})
    L(pits.outputs["Distance"], pit_glow.inputs["Value"])
    pg = node(nt, "ShaderNodeMath", _operation="MULTIPLY")
    L(pit_glow.outputs[0], pg.inputs[0])
    L(pit_sel.outputs[0], pg.inputs[1])
    # CRAWL: a slow noise the shader pans so heat pulses along the cracks.
    crawl = node(nt, "ShaderNodeTexNoise", Scale=2.4, Detail=2.0)
    L(co, crawl.inputs["Vector"])

    bsdf = node(nt, "ShaderNodeBsdfPrincipled")
    L(albedo, bsdf.inputs["Base Color"])
    L(roughness, bsdf.inputs["Roughness"])
    L(metal.outputs[0], bsdf.inputs["Metallic"])
    L(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # A preview of the molten glow (renders only â€” the bake writes masks).
    glow = node(nt, "ShaderNodeMath", _operation="MULTIPLY_ADD")
    L(pg.outputs[0], glow.inputs[0])
    glow.inputs[1].default_value = 0.25
    L(crack_core, glow.inputs[2])
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.32, 0.04, 1)
    gs = node(nt, "ShaderNodeMath", _operation="MULTIPLY")
    L(glow.outputs[0], gs.inputs[0])
    gs.inputs[1].default_value = 6.0
    L(gs.outputs[0], bsdf.inputs["Emission Strength"])

    out = node(nt, "ShaderNodeOutputMaterial")
    L(bsdf.outputs[0], out.inputs["Surface"])

    # Channel taps the bake swaps into the output, one at a time.
    emit = node(nt, "ShaderNodeEmission")
    comb = node(nt, "ShaderNodeCombineColor")
    taps = {
        "albedo": albedo,
        "orm": None,
        "heat": None,
    }
    return mat, nt, out, bsdf, emit, comb, {
        "albedo": albedo,
        "cav": cav.outputs[0],
        "rough": roughness,
        "metal": metal.outputs[0],
        "crack": crack_core,
        "pitglow": pg.outputs[0],
        "crawl": crawl.outputs["Fac"],
    }


def bake_image(name, colorspace="sRGB"):
    img = bpy.data.images.new(name, SIZE, SIZE // 2 if False else SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    return img


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 16
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scn.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001
        print("GPU setup failed:", e)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=48, ring_count=24)
    ball = bpy.context.object
    ball.name = "IRON"
    bpy.ops.object.shade_smooth()
    mat, nt, out, bsdf, emit, comb, taps = build_material()
    ball.data.materials.append(mat)
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = tex
    L = nt.links.new

    os.makedirs(OUT, exist_ok=True)

    def bake_emit(name, rgb_sockets, colorspace):
        img = bake_image(name, colorspace)
        tex.image = img
        for l in list(out.inputs["Surface"].links):
            nt.links.remove(l)
        if len(rgb_sockets) == 1:
            L(rgb_sockets[0], emit.inputs["Color"])
        else:
            for i, s in enumerate(rgb_sockets):
                L(s, comb.inputs[i])
            L(comb.outputs[0], emit.inputs["Color"])
        L(emit.outputs[0], out.inputs["Surface"])
        bpy.ops.object.bake(type="EMIT", margin=8)
        return img

    def save(img, fname, fmt):
        img.filepath_raw = os.path.join(OUT, fname)
        img.file_format = fmt
        if fmt in ("JPEG", "WEBP"):
            scn.render.image_settings.quality = 92
        img.save()
        print("wrote", fname, flush=True)

    bpy.context.view_layer.objects.active = ball
    ball.select_set(True)

    save(bake_emit("albedo", [taps["albedo"]], "sRGB"), "iron_albedo.jpg", "JPEG")
    save(bake_emit("orm", [taps["cav"], taps["rough"], taps["metal"]], "Non-Color"), "iron_orm.jpg", "JPEG")
    save(bake_emit("heat", [taps["crack"], taps["pitglow"], taps["crawl"]], "Non-Color"), "iron_heat.jpg", "JPEG")

    # Normal: the real BSDF back on the output, bump and all.
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    L(bsdf.outputs[0], out.inputs["Surface"])
    nimg = bake_image("nrm", "Non-Color")
    tex.image = nimg
    scn.cycles.samples = 4
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=8)
    save(nimg, "iron_nrm.webp", "WEBP")

    # The mesh, UVs and normals only â€” the game builds the material.
    tex.image = None
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "iron.glb"),
        use_selection=True,
        export_materials="NONE",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_yup=True,
    )

    if RENDER:
        os.makedirs(RENDERS, exist_ok=True)
        cam_data = bpy.data.cameras.new("cam")
        cam_data.lens = 85
        cam = bpy.data.objects.new("cam", cam_data)
        scn.collection.objects.link(cam)
        cam.location = (0, -6.5, 0.6)
        cam.rotation_euler = (math.radians(85), 0, 0)
        scn.camera = cam
        key = bpy.data.lights.new("key", "AREA")
        key.energy = 600
        key.size = 3
        k = bpy.data.objects.new("key", key)
        scn.collection.objects.link(k)
        k.location = (-3, -3, 3)
        k.rotation_euler = (math.radians(50), 0, math.radians(-45))
        world = bpy.data.worlds.new("w")
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.02, 0.025, 1)
        scn.world = world
        scn.render.resolution_x = scn.render.resolution_y = 768
        scn.cycles.samples = 128
        scn.render.filepath = os.path.join(RENDERS, "iron_preview.png")
        bpy.ops.render.render(write_still=True)


main()

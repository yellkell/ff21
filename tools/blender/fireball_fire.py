"""
THE FIREBALL'S FIRE — a real Mantaflow fire sim around an iron ball,
rendered into a looping flipbook the game gradient-maps (src/fx/fire.ts).

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/fireball_fire.py -- [--test] [--rerender]

Then pack the frames:

    py -3.11 tools/blender/fireball_pack.py

THE SIM: a sphere of radius 1 (the iron core, at the scene origin) breathes
fuel off its whole surface through a cloud-noise mask, so it burns in
tongues rather than a smooth shell. The fuel ignites into flame that licks
up and tears off; there is NO smoke (the game draws fire additively, and a
smoke layer would need sorting it can't afford in stereo).

THE RENDER: an orthographic camera looks along +Y at the ball. Every frame
renders twice, grayscale (emission = flame intensity, white), on black:

    front   the sphere is a HOLDOUT — inside its silhouette only the fire
            IN FRONT of the iron survives. Drawn over the ball in game, it
            composites exactly: flames wrap round the iron, and the iron
            shows through where nothing burns in front of it.
    full    the sphere is invisible — the whole fire, for the trail puffs
            and impact bursts, which have no ball inside them.

The packer folds the two into one atlas (R = front, G = full).
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORK = "C:/Users/alexv/Desktop/blendercyber/bake_work/fireball"
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEST = "--test" in argv
RERENDER = "--rerender" in argv


def opt(name, default):
    """--name value overrides (sim tuning experiments)."""
    return type(default)(argv[argv.index("--" + name) + 1]) if "--" + name in argv else default


TAG = opt("tag", "")

# Frame window: settle, then LOOP + BLEND frames (the packer crossfades the
# tail into the head so the flipbook loops with no seam).
SETTLE = 40
LOOP = 64
BLEND = 16
LAST = SETTLE + LOOP + BLEND
# Framing (scene units, ball radius = 1): x in [-HALF, HALF], z from
# BOTTOM up by 2*HALF. Mirrored in fire.ts (FIRE_FRAME).
HALF = 2.9
BOTTOM = -1.9
PX = 384  # rendered per frame; the packer downsamples to the atlas cell


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build():
    scn = bpy.context.scene
    scn.frame_start = 1
    scn.frame_end = LAST if not TEST else 90
    scn.render.fps = 30

    # --- the iron (emitter + holdout) -----------------------------------
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=64, ring_count=32)
    ball = bpy.context.object
    ball.name = "IRON"
    bpy.ops.object.shade_smooth()

    # Fuel breathes through a cloud mask so the ball burns in tongues.
    tex = bpy.data.textures.new("fuel_mask", type="CLOUDS")
    tex.noise_scale = 0.45
    tex.noise_depth = 2
    tex.noise_basis = "BLENDER_ORIGINAL"
    flow = ball.modifiers.new("Fluid", "FLUID")
    flow.fluid_type = "FLOW"
    fs = flow.flow_settings
    fs.flow_type = "FIRE"
    fs.flow_behavior = "INFLOW"
    fs.flow_source = "MESH"
    fs.surface_distance = 0.12
    fs.volume_density = 0.0
    fs.fuel_amount = 2.0
    fs.temperature = 1.6
    fs.use_texture = True
    fs.noise_texture = tex
    fs.texture_map_type = "AUTO"
    fs.texture_size = 1.4
    fs.use_initial_velocity = True
    fs.velocity_normal = 0.6

    # Drift the mask through the sphere so the tongues never stand still.
    fs.texture_offset = 0.0
    fs.keyframe_insert("texture_offset", frame=1)
    fs.texture_offset = 6.0
    fs.keyframe_insert("texture_offset", frame=LAST + 20)
    for fc in getattr(ball.animation_data.action, "fcurves", []) if ball.animation_data else []:
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"

    # --- the domain -----------------------------------------------------
    top = BOTTOM + 2 * HALF
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    dom = bpy.context.object
    dom.name = "DOMAIN"
    dom.scale = (2 * HALF, 2 * HALF, top - BOTTOM)
    dom.location = (0, 0, (top + BOTTOM) / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    dmod = dom.modifiers.new("Fluid", "FLUID")
    dmod.fluid_type = "DOMAIN"
    ds = dmod.domain_settings
    ds.domain_type = "GAS"
    ds.resolution_max = opt("res", 96 if TEST else 160)
    ds.use_adaptive_domain = False
    ds.time_scale = 1.0
    ds.vorticity = opt("vort", 0.65)
    ds.alpha = 0.6  # density buoyancy
    ds.beta = opt("beta", 5.6)  # heat buoyancy — flame climbs fast
    ds.use_dissolve_smoke = True
    ds.dissolve_speed = 8
    ds.burning_rate = opt("burn", 0.37)
    ds.flame_smoke = 0.0
    ds.flame_vorticity = opt("fvort", 1.4)
    ds.flame_ignition = 1.25
    ds.flame_max_temp = 3.0
    # NO noise upres: Mantaflow's upres burns the flame out about a radius
    # off the iron, where the base grid's fire licks two and a half radii up.
    ds.use_noise = bool(opt("noise", 0))
    ds.noise_scale = 2
    ds.noise_strength = 1.4
    ds.noise_time_anim = 0.25
    # Open top and sides: flame tips leave the frame instead of pooling
    # against a lid.
    ds.use_collision_border_top = False
    ds.use_collision_border_front = False
    ds.use_collision_border_back = False
    ds.use_collision_border_left = False
    ds.use_collision_border_right = False
    ds.cache_type = "ALL"
    ds.cache_directory = os.path.join(WORK, ("cache_test" if TEST else "cache") + TAG)
    ds.cache_frame_start = 1
    ds.cache_frame_end = scn.frame_end
    ds.cache_data_format = "OPENVDB"

    # The fire's shader: emission only, white, strength = flame. Gradient
    # mapping happens in game, so the render stays a scalar.
    mat = bpy.data.materials.new("flame")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1, 1, 1, 1)
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "flame"
    # A gentle curve: thin flame edges stay faint, cores saturate.
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 1.35
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 2.0
    nt.links.new(attr.outputs["Fac"], pw.inputs[0])
    nt.links.new(pw.outputs[0], mul.inputs[0])
    # SHELL MASK: the fuel shell hugging the iron shows the emitter's mask
    # pattern, not fire. Fade emission out below ~1.4 radii — fully for the
    # 'front' pass (so the iron's own face reads), partly for 'full'
    # (render() sets the `shell` amount per pass).
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    rad = nt.nodes.new("ShaderNodeVectorMath")
    rad.operation = "LENGTH"
    nt.links.new(geo.outputs["Position"], rad.inputs[0])
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 1.06
    fade.inputs["From Max"].default_value = 1.42
    nt.links.new(rad.outputs["Value"], fade.inputs["Value"])
    shell = nt.nodes.new("ShaderNodeValue")
    shell.name = "shell"
    shell.outputs[0].default_value = 1.0
    keep = nt.nodes.new("ShaderNodeMix")
    keep.data_type = "FLOAT"
    keep.inputs["A"].default_value = 1.0
    nt.links.new(shell.outputs[0], keep.inputs["Factor"])
    nt.links.new(fade.outputs[0], keep.inputs["B"])
    masked = nt.nodes.new("ShaderNodeMath")
    masked.operation = "MULTIPLY"
    nt.links.new(mul.outputs[0], masked.inputs[0])
    nt.links.new(keep.outputs["Result"], masked.inputs[1])
    nt.links.new(masked.outputs[0], emit.inputs["Strength"])
    nt.links.new(emit.outputs[0], out.inputs["Volume"])
    dom.data.materials.append(mat)

    # The ball's holdout material (the 'front' pass).
    hold = bpy.data.materials.new("holdout")
    hold.use_nodes = True
    hn = hold.node_tree
    hn.nodes.clear()
    ho = hn.nodes.new("ShaderNodeOutputMaterial")
    hh = hn.nodes.new("ShaderNodeHoldout")
    hn.links.new(hh.outputs[0], ho.inputs["Surface"])
    ball.data.materials.append(hold)

    # --- camera + render ------------------------------------------------
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2 * HALF
    cam = bpy.data.objects.new("cam", cam_data)
    scn.collection.objects.link(cam)
    cam.location = (0, -20, BOTTOM + HALF)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scn.camera = cam

    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    scn.world = world

    r = scn.render
    r.engine = "CYCLES"
    r.resolution_x = r.resolution_y = PX
    r.film_transparent = False
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "BW"
    r.image_settings.color_depth = "16"
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    cy = scn.cycles
    cy.samples = 24 if TEST else 96
    cy.use_denoising = False
    cy.volume_step_rate = 0.5
    cy.volume_max_steps = 512
    cy.max_bounces = 0
    cy.volume_bounces = 0
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cy.device = "GPU"
    except Exception as e:  # noqa: BLE001
        print("GPU setup failed, CPU render:", e)
    return scn, ball, dom


def bake(dom):
    with bpy.context.temp_override(object=dom, active_object=dom, selected_objects=[dom]):
        bpy.ops.fluid.bake_all()


def render(scn, ball):
    first = 1 if TEST else SETTLE + 1
    for pass_name in ("front", "full"):
        outdir = os.path.join(WORK, ("test" if TEST else "frames") + TAG, pass_name)
        os.makedirs(outdir, exist_ok=True)
        ball.visible_camera = pass_name == "front"
        bpy.data.objects["DOMAIN"].data.materials[0].node_tree.nodes["shell"].outputs[0].default_value = 1.0 if pass_name == "front" else 0.6
        frames = range(first, scn.frame_end + 1, 1 if not TEST else 11)
        for f in frames:
            path = os.path.join(outdir, f"{f - first:03d}.png")
            if os.path.exists(path) and not RERENDER:
                continue
            scn.frame_set(f)
            scn.render.filepath = path
            bpy.ops.render.render(write_still=True)
            print("rendered", pass_name, f, flush=True)


def main():
    clear()
    scn, ball, dom = build()
    cache = dom.modifiers["Fluid"].domain_settings.cache_directory
    if not os.path.isdir(os.path.join(cache, "data")) or RERENDER is False and not os.listdir(os.path.join(cache, "data")):
        print("baking sim into", cache, flush=True)
        bake(dom)
    else:
        print("sim cache found:", cache, flush=True)
    render(scn, ball)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, f"fireball_fire{TAG}.blend"))


main()

"""
THE NEON TRIDENT — the DJ's weapon, drawn as a neon sign.

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/trident.py [-- --norender]

Writes public/arena/titans/trident.glb with two meshes the rave shader
(src/rave/arena/trident.ts) draws additively:

    TRIDENT_CORE   the drawing at thickness t = 1   (the white-hot line)
    TRIDENT_HALO   the SAME drawing, every radius x2.6 (the coloured glow)

Everything is a stroke: tubes swept along Catmull-Rom splines (tapering
where a barb sharpens) and faceted crystal points. Positions never change
with thickness — only radii (tube radius, a collar's ring radius because it
hugs the shaft, a crystal's width) — so the white line always sits inside
its own glow.

TRIDENT SPACE: y up the shaft, grip (the fist) at the origin, butt spike at
y = -0.62, centre tip at y = 1.36, drawn flat in x/y. Blender is Z-up, so the
drawing is authored in Blender's XZ plane (Blender z = trident y); the glTF
exporter maps (x, y, z) -> (x, z, -y), landing it back in trident space.
No object transforms: every vertex is baked where it belongs.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "titans"))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import kit  # noqa: E402

TAU = math.tau
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "public", "arena", "titans", "trident.glb")
RENDERS = "C:/Users/alexv/Desktop/blendercyber/renders/titans"
HALO = 2.6

BOTTOM, TOP = -0.62, 1.36
OUT_OF_PLANE = Vector((0, 1, 0))  # Blender Y: the drawing's depth axis


def P(x, y):
    """Trident (x, y) -> Blender point in the XZ drawing plane."""
    return Vector((x, 0.0, y))


def smooth01(a):
    a = max(0.0, min(1.0, a))
    return a * a * (3 - 2 * a)


def keys(k, u):
    """Piecewise-smooth interpolation through (u, value) keys."""
    if u <= k[0][0]:
        return k[0][1]
    for (u0, v0), (u1, v1) in zip(k, k[1:]):
        if u <= u1:
            return v0 + (v1 - v0) * smooth01((u - u0) / max(u1 - u0, 1e-9))
    return k[-1][1]


class Pen:
    """Draws strokes into one bmesh at thickness `t`."""

    def __init__(self, t):
        self.t = t
        self.bm = bmesh.new()
        self.flat = []  # faces kept faceted (crystals)

    # ── a swept tube ──────────────────────────────────────────────────────
    def sweep(self, path, radii, segs=6, start="flat", end="flat", closed=False, phase=0.0):
        """Sweep a round tube through `path` (Blender points, in the XZ
        plane) with per-point radii (unscaled). A radius of 0 at an end
        becomes a single apex vertex — a sharpened point."""
        bm, t = self.bm, self.t
        n = len(path)
        rings = []
        for i, p in enumerate(path):
            if closed:
                tan = path[(i + 1) % n] - path[(i - 1) % n]
            else:
                tan = path[min(i + 1, n - 1)] - path[max(i - 1, 0)]
            tan.normalize()
            nrm = OUT_OF_PLANE.cross(tan).normalized()  # in-plane normal
            r = radii[i] * t
            if r < 1e-7:
                rings.append([bm.verts.new(p)])
                continue
            rings.append([bm.verts.new(p + (nrm * math.cos(a) + OUT_OF_PLANE * math.sin(a)) * r)
                          for a in (phase + j / segs * TAU for j in range(segs))])
        pairs = [(i, i + 1) for i in range(n - 1)]
        if closed:
            pairs.append((n - 1, 0))
        for i0, i1 in pairs:
            A, B = rings[i0], rings[i1]
            for j in range(segs):
                j2 = (j + 1) % segs
                if len(A) == 1:
                    bm.faces.new((A[0], B[j2], B[j]))
                elif len(B) == 1:
                    bm.faces.new((A[j], A[j2], B[0]))
                else:
                    bm.faces.new((A[j], A[j2], B[j2], B[j]))
        if not closed:
            if len(rings[0]) > 1 and start == "flat":
                bm.faces.new(rings[0][::-1])
            if len(rings[-1]) > 1 and end == "flat":
                bm.faces.new(rings[-1])

    def stroke(self, pts, rkeys, segs=6, n=6, start="flat", end="flat"):
        """Catmull-Rom stroke through trident-space (x, y) points; radius
        keyed along arc length u in 0..1 by `rkeys` [(u, r), ...]."""
        path = kit.spline([P(*q) for q in pts], n)
        # drop near-duplicate samples (Catmull-Rom endpoints)
        clean = [path[0]]
        for p in path[1:]:
            if (p - clean[-1]).length > 1e-5:
                clean.append(p)
        path = clean
        L = [0.0]
        for a, b in zip(path, path[1:]):
            L.append(L[-1] + (b - a).length)
        radii = [keys(rkeys, s / L[-1]) for s in L]
        self.sweep(path, radii, segs, start, end)
        return path

    def loop(self, c, R, r, n=24, segs=6, ring_scales=False):
        """A closed ring in the drawing plane (centre c = (x, y))."""
        RR = R * (self.t if ring_scales else 1.0)
        path = [P(c[0] + RR * math.cos(i / n * TAU), c[1] + RR * math.sin(i / n * TAU)) for i in range(n)]
        self.sweep(path, [r] * n, segs, closed=True)

    def collar(self, y, R, r, n=16, tube=5):
        """A ring hugging the shaft at height y (axis = the shaft). Both its
        ring radius and tube radius scale with t, so it rides outside the
        shaft at every thickness."""
        bm, t = self.bm, self.t
        RR, rr = R * t, r * t
        rows = []
        for i in range(n):
            a = i / n * TAU
            radial = Vector((math.cos(a), math.sin(a), 0))
            rows.append([bm.verts.new(Vector((0, 0, y)) + radial * (RR + rr * math.cos(b)) + Vector((0, 0, rr * math.sin(b))))
                         for b in (j / tube * TAU for j in range(tube))])
        for i in range(n):
            i2 = (i + 1) % n
            for j in range(tube):
                j2 = (j + 1) % tube
                bm.faces.new((rows[i][j], rows[i2][j], rows[i2][j2], rows[i][j2]))

    def crystal(self, base, d, length, prof):
        """A four-sided faceted point from `base` (x, y) along direction `d`
        (x, y): `prof` [(u, half-width in plane, half-depth)] ends at u = 1
        with an apex. Widths scale with t, the length does not."""
        bm, t = self.bm, self.t
        dv = P(*d).normalized()
        nrm = OUT_OF_PLANE.cross(dv).normalized()
        b0 = P(*base)
        rings = []
        for u, w, z in prof:
            c = b0 + dv * (length * u)
            if w < 1e-7:
                rings.append([bm.verts.new(c)])
            else:
                rings.append([bm.verts.new(c + nrm * w * t), bm.verts.new(c + OUT_OF_PLANE * z * t),
                              bm.verts.new(c - nrm * w * t), bm.verts.new(c - OUT_OF_PLANE * z * t)])
        new = []
        for A, B in zip(rings, rings[1:]):
            for j in range(4):
                j2 = (j + 1) % 4
                if len(B) == 1:
                    new.append(bm.faces.new((A[j], A[j2], B[0])))
                elif len(A) == 1:
                    new.append(bm.faces.new((A[0], B[j2], B[j])))
                else:
                    new.append(bm.faces.new((A[j], A[j2], B[j2], B[j])))
        if len(rings[0]) > 1:
            new.append(bm.faces.new(rings[0][::-1]))
        if self.t == 1.0:
            self.flat.extend(new)  # the white core keeps crisp facets

    def finish(self, name, material):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        flat = set(self.flat)
        for f in bm.faces:
            f.smooth = f not in flat
        me = bpy.data.meshes.new(name)
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material)
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o


# ── the drawing ───────────────────────────────────────────────────────────
SHAFT_R = 0.011
PRONG_R = 0.0095
NODES = (-0.30, 0.32, 0.58)  # segment nodes (beads) along the shaft
GRIP = (-0.09, 0.0, 0.09)
EYE_Y, EYE_R = 0.84, 0.074
GUARD_Y = 0.962  # the crescent's low point, where it crosses the shaft
LEAF_Y = 1.18  # where the centre prong becomes the leaf blade

# The crescent + outer prong, right half, centre outward (mirrored for -x).
CRESCENT = [(0.0, GUARD_Y), (0.055, 0.968), (0.105, 0.992), (0.143, 1.034),
            (0.161, 1.090), (0.171, 1.146), (0.181, 1.183)]


def draw(pen):
    # THE SHAFT: butt collar to the leaf, one continuous stroke, swelling
    # into a bead at each segment node.
    ys = [-0.47, -0.42]
    for yn in NODES:
        ys += [yn - 0.045, yn - 0.024, yn - 0.012, yn, yn + 0.012, yn + 0.024, yn + 0.045]
    ys += [0.74, 0.90, GUARD_Y - 0.02, GUARD_Y, GUARD_Y + 0.03, 1.10, LEAF_Y + 0.004]
    ys = sorted(set(round(y, 4) for y in ys))

    def shaft_r(y):
        r = SHAFT_R if y < GUARD_Y else PRONG_R + (SHAFT_R - PRONG_R) * max(0.0, 1 - (y - GUARD_Y) / 0.05)
        for yn in NODES:
            r += 0.0035 * (1 - smooth01(abs(y - yn) / 0.045))
        return r

    pen.sweep([P(0, y) for y in ys], [shaft_r(y) for y in ys], segs=8)

    # The butt spike: a long faceted point below the butt collar.
    pen.crystal((0, -0.47), (0, -1), 0.15, [(0, 0.012, 0.012), (0.22, 0.024, 0.024), (1, 0, 0)])
    pen.collar(-0.455, 0.019, 0.004)

    # The grip wraps — three rings under and over the fist.
    for y in GRIP:
        pen.collar(y, 0.02, 0.004)
    # Collars framing each node.
    for yn in NODES:
        pen.collar(yn - 0.016, 0.0175, 0.0035)
        pen.collar(yn + 0.016, 0.0175, 0.0035)

    # THE EYE: the ringed circle the shaft runs through, with a fine inner ring.
    pen.loop((0, EYE_Y), EYE_R, 0.0075, n=32, segs=6)
    pen.loop((0, EYE_Y), 0.042, 0.003, n=22, segs=6)

    # THE CRESCENT: one stroke from left prong to right prong, dipping
    # through the shaft — the crossguard that throws the outer prongs wide.
    full = [(-x, y) for x, y in reversed(CRESCENT[1:])] + CRESCENT
    path = pen.stroke(full, [(0, PRONG_R), (0.5, 0.0105), (1, PRONG_R)], segs=6, n=5)

    # Outer crystal tips: carry on along the prong's own heading.
    for s in (-1, 1):
        a, b = P(s * CRESCENT[-2][0], CRESCENT[-2][1]), P(s * CRESCENT[-1][0], CRESCENT[-1][1])
        d = (b - a).normalized()
        d = (d.x + s * 0.05, d.z)
        # seated a little down the prong so the tube's end hides inside it
        dv = Vector(d).normalized() * 0.012
        pen.crystal((s * CRESCENT[-1][0] - dv.x, CRESCENT[-1][1] - dv.y), d, 0.137,
                    [(0, PRONG_R * 1.05, PRONG_R * 1.05), (0.26, 0.022, 0.02), (1, 0, 0)])
        # The barb: hooks back off the outer side of each outer prong.
        pen.stroke([(s * 0.163, 1.128), (s * 0.192, 1.118), (s * 0.214, 1.092), (s * 0.224, 1.055)],
                   [(0, 0.0075), (0.55, 0.0058), (1, 0.0)], segs=6, n=5, end="point")
        # A short inner barb on the centre prong, harpoon-style.
        pen.stroke([(s * 0.004, 1.128), (s * 0.022, 1.116), (s * 0.032, 1.094), (s * 0.034, 1.072)],
                   [(0, 0.0062), (0.5, 0.0048), (1, 0.0)], segs=6, n=5, end="point")

    # THE LEAF: the centre prong's faceted blade, an ogive to the tip.
    pen.crystal((0, LEAF_Y - 0.008), (0, 1), TOP - LEAF_Y + 0.008,
                [(0, PRONG_R * 1.05, PRONG_R * 1.05), (0.08, 0.017, 0.011), (0.22, 0.026, 0.012),
                 (0.38, 0.028, 0.012), (0.58, 0.021, 0.010), (0.80, 0.011, 0.006), (1, 0, 0)])


def build():
    kit.reset()
    core_m = kit.mat("trident_core", (1, 1, 1), emit=(1, 1, 1), strength=4)
    halo_m = kit.mat("trident_halo", (0, 0.8, 1), emit=(0.0, 0.85, 1.0), strength=1.5, alpha=0.4)
    objs = []
    for name, t, m in (("TRIDENT_CORE", 1.0, core_m), ("TRIDENT_HALO", HALO, halo_m)):
        pen = Pen(t)
        draw(pen)
        objs.append(pen.finish(name, m))
    return objs


def report(objs):
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        xs = [v.co.x for v in me.vertices]
        zs = [v.co.z for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        print(f"{o.name}: {len(me.loop_triangles)} tris, {len(me.vertices)} verts, "
              f"x {min(xs):.3f}..{max(xs):.3f}  trident-y {min(zs):.3f}..{max(zs):.3f}  depth {min(ys):.3f}..{max(ys):.3f}")


def export(objs):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


# ── review renders (materials only matter here) ───────────────────────────
def neon_materials(core, halo):
    """Core: white-hot emission. Halo: additive cyan glow, brightest at the
    silhouette rim — the game shader's own anatomy."""
    for o, is_core in ((core, True), (halo, False)):
        m = bpy.data.materials.new(o.name + "_review")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        add = nt.nodes.new("ShaderNodeAddShader")
        if is_core:
            # the game: mix(uColor, white, 0.7) at full alpha
            em.inputs["Color"].default_value = (0.7, 0.94, 1.0, 1)
            em.inputs["Strength"].default_value = 1.1
        else:
            # the game: (0.18 + 0.7 * rim^2) * uColor, rim = 1 - |N.V|,
            # additive and double-sided (Cycles sees both walls of the tube)
            em.inputs["Color"].default_value = (0.0, 0.8, 1.0, 1)
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            dot = nt.nodes.new("ShaderNodeVectorMath")
            dot.operation = "DOT_PRODUCT"
            ab = nt.nodes.new("ShaderNodeMath")
            ab.operation = "ABSOLUTE"
            inv = nt.nodes.new("ShaderNodeMath")
            inv.operation = "SUBTRACT"
            inv.inputs[0].default_value = 1.0
            sq = nt.nodes.new("ShaderNodeMath")
            sq.operation = "POWER"
            sq.inputs[1].default_value = 2.0
            mad = nt.nodes.new("ShaderNodeMath")
            mad.operation = "MULTIPLY_ADD"
            mad.inputs[1].default_value = 0.7
            mad.inputs[2].default_value = 0.18
            nt.links.new(geo.outputs["Normal"], dot.inputs[0])
            nt.links.new(geo.outputs["Incoming"], dot.inputs[1])
            nt.links.new(dot.outputs["Value"], ab.inputs[0])
            nt.links.new(ab.outputs[0], inv.inputs[1])
            nt.links.new(inv.outputs[0], sq.inputs[0])
            nt.links.new(sq.outputs[0], mad.inputs[0])
            nt.links.new(mad.outputs[0], em.inputs["Strength"])
        nt.links.new(tr.outputs[0], add.inputs[0])
        nt.links.new(em.outputs[0], add.inputs[1])
        nt.links.new(add.outputs[0], out.inputs["Surface"])
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
        o.data.materials.clear()
        o.data.materials.append(m)


def render(objs):
    core, halo = objs
    neon_materials(core, halo)
    scene = bpy.context.scene
    kit.gpu()
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.transparent_max_bounces = 64
    scene.cycles.max_bounces = 64
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1400
    scene.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("black")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    scene.world = w

    ng = bpy.data.node_groups.new("NeonComp", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    gl = ng.nodes.new("CompositorNodeGlare")
    for v in ("Bloom", "BLOOM", "Fog Glow", "FOG_GLOW"):
        try:
            gl.inputs["Type"].default_value = v
            break
        except Exception:
            pass
    try:
        gl.inputs["Threshold"].default_value = 0.85
        gl.inputs["Strength"].default_value = 0.22
        if gl.inputs["Size"].type == "VALUE":
            gl.inputs["Size"].default_value = 0.5
    except Exception as ex:
        print("glare setup:", ex)
    go = ng.nodes.new("NodeGroupOutput")
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], go.inputs[0])
    scene.compositing_node_group = ng
    scene.render.use_compositing = True

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    mid = (BOTTOM + TOP) / 2

    def shot(fname, loc, tgt, ortho=None, lens=50):
        if ortho:
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = ortho
        else:
            cam.data.type = "PERSP"
            cam.data.lens = lens
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(RENDERS, fname)
        bpy.ops.render.render(write_still=True)
        print("rendered", scene.render.filepath)

    # front: the viewer stands at three +z = Blender -y
    shot("trident_front.png", (0, -6, mid), (0, 0, mid), ortho=2.2)
    yaw = math.radians(35)
    d = 3.3
    shot("trident_34.png", (math.sin(yaw) * d, -math.cos(yaw) * d, mid + 0.75), (0, 0, mid + 0.02), lens=58)
    shot("trident_head.png", (0, -6, 1.12), (0, 0, 1.12), ortho=0.75)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    objs = build()
    report(objs)
    export(objs)
    if "--norender" not in argv:
        render(objs)


main()

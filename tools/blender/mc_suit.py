"""
THE MC's SUIT — the headliner's full armour, built in Blender from code.

    uv venv -p python3.13 .bpy && uv pip install -p .bpy/bin/python bpy==5.2.2
    .bpy/bin/python -I tools/blender/mc_suit.py public/club/mc_suit.glb

Every piece is authored in the frame of the rig mount it rides
(src/rave/game/avatars.ts DancerRig.mount), in the figure's own metres —
the MC's 2.1x is the rig root's business. Blender is Z-up with the figure
facing +Y; the glTF exporter turns that into the rig's Y-up, facing -Z.

    HELMET        head     origin the skull's centre
    MANTLE        yoke     origin the shoulder line's midpoint, spine up +Z
    PAULDRON_L/R  upper    origin the shoulder joint, the arm hanging down -Z
    VAMBRACE_L/R  fore     origin the elbow, the forearm hanging down -Z
    GAUNTLET_L/R  hand     origin the grip; the glowstick rises +Z, fingers +Y
    FAULD         pelvis   origin the hip centre, the waist up +Z
    CUISSE_L/R    thigh    origin the hip joint, the thigh hanging down -Z
    GREAVE_L/R    shin     origin the knee, the shin hanging down -Z
    BOOT_L/R      boot     origin the ankle, the sole 0.085 below it

The figure's right is +X. Material names are the contract with
src/rave/game/mcCostume.ts: `glow_core` (the hottest neon — visor EQ, can
rings, the platter), `glow_trim` (piping and lit panels), `armor` (black
lacquer plate), `chrome` (polished trim) and `visor_glass` (smoked glass
over the EQ). One more node rides inside MANTLE: PLATTER, the chest's
record, centred on its own origin so the game can spin it about local Z.
"""

import math
import sys

import bpy  # first: bmesh and mathutils only exist once bpy is up

import bmesh
from mathutils import Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith(".glb") else "mc_suit.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# QUEST BUDGET. The whole suit is drawn as five skinned meshes (one per
# material — see mcCostume.ts), so draw calls are settled; this trims the
# triangles. Curves are tessellated at LOD of their authored segment counts
# (never under the floors below) — the MC is a 3.4 m figure seen from
# 4.6 m and up, where a 40-sided ring and a 24-sided one look the same.
LOD = 0.55


def lod(n, floor=8):
    return max(floor, round(n * LOD))


# ── materials ─────────────────────────────────────────────────────────────
def material(name, rgb, metal=0.0, rough=0.5, emit=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


MAT = {
    "armor": material("armor", (0.035, 0.038, 0.048), metal=0.55, rough=0.22),
    "chrome": material("chrome", (0.75, 0.77, 0.82), metal=1.0, rough=0.14),
    "glow_core": material("glow_core", (0.06, 0.06, 0.08), emit=(0.7, 0.4, 1.0)),
    "glow_trim": material("glow_trim", (0.06, 0.06, 0.08), emit=(0.6, 0.3, 1.0)),
    "visor_glass": material("visor_glass", (0.02, 0.02, 0.03), rough=0.05, alpha=0.35),
}


# ── mesh helpers (all return a new object) ────────────────────────────────
def obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT[mat])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def smooth(o, angle=40):
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(angle))
    return o


def ellipsoid(name, mat, c, r, segs=24, rings=14, keep=None):
    """An ellipsoid at `c` with radii `r`; `keep(v)` (unit-sphere coords) trims it."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=lod(segs, 10), v_segments=lod(rings, 6), radius=1.0)
    if keep:
        doomed = [v for v in bm.verts if not keep(v.co)]
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    for v in bm.verts:
        v.co = Vector((c[0] + v.co.x * r[0], c[1] + v.co.y * r[1], c[2] + v.co.z * r[2]))
    return smooth(obj_from_bm(bm, name, mat))


def solidify(o, t, offset=-1):
    mod = o.modifiers.new("solid", "SOLIDIFY")
    mod.thickness = t
    mod.offset = offset
    mod.use_even_offset = True
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.select_set(False)
    return o


def bevel(o, w, segs=1):
    mod = o.modifiers.new("bevel", "BEVEL")
    mod.width = w
    mod.segments = segs
    mod.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.select_set(False)
    return o


def box(name, mat, c, size, bev=0.0, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = obj_from_bm(bm, name, mat)
    if bev:
        bevel(o, bev)
    o.rotation_euler = rot
    o.location = c
    return smooth(o, 35)


def ring(name, mat, c, R, r, axis="Z", sx=1.0, sy=1.0, segs=40, tube=8):
    segs, tube = lod(segs, 14), 5
    bm = bmesh.new()
    verts = []
    for i in range(segs):
        a = i / segs * math.tau
        row = []
        for j in range(tube):
            b = j / tube * math.tau
            x = (R + r * math.cos(b)) * math.cos(a) * sx
            y = (R + r * math.cos(b)) * math.sin(a) * sy
            z = r * math.sin(b)
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for i in range(segs):
        for j in range(tube):
            a, b = verts[i][j], verts[(i + 1) % segs][j]
            c2, d = verts[(i + 1) % segs][(j + 1) % tube], verts[i][(j + 1) % tube]
            bm.faces.new((a, b, c2, d))
    o = obj_from_bm(bm, name, mat)
    if axis == "X":
        o.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "Y":
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.location = c
    return smooth(o, 80)


def lathe(name, mat, prof, segs=32, sx=1.0, sy=1.0, c=(0, 0, 0), cap=True, arc=None):
    """Revolve (radius, z) pairs about Z. `arc` = (a0, a1) leaves it open."""
    segs = lod(segs, 12)
    bm = bmesh.new()
    full = arc is None
    a0, a1 = arc if arc else (0, math.tau)
    n = segs if full else segs + 1
    rows = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / segs
        rows.append([bm.verts.new((r * math.cos(a) * sx + c[0], r * math.sin(a) * sy + c[1], z + c[2])) for r, z in prof])
    for i in range(segs if full else segs):
        i2 = (i + 1) % n
        for j in range(len(prof) - 1):
            bm.faces.new((rows[i][j], rows[i2][j], rows[i2][j + 1], rows[i][j + 1]))
    if cap and full:
        for j in (0, len(prof) - 1):
            if prof[j][0] > 1e-4:
                f = bm.faces.new([rows[i][j] for i in range(segs)])
                if j == 0:
                    f.normal_flip()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(obj_from_bm(bm, name, mat), 50)


def sheet(name, mat, fn, nu, nv, thick):
    """A curved plate: fn(u, v) -> (x, y, z) over u, v in [0, 1], solidified."""
    bm = bmesh.new()
    grid = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    o = obj_from_bm(bm, name, mat)
    solidify(o, thick, 0)
    return smooth(o, 45)


def strip(name, mat, pts, w, h, normal_hint=None):
    """A thin glowing bar along a polyline (piping)."""
    parts = []
    for k in range(len(pts) - 1):
        a, b = Vector(pts[k]), Vector(pts[k + 1])
        d = b - a
        L = d.length
        o = box(f"{name}{k}", mat, (a + b) / 2, (w, L + w * 0.6, h))
        o.rotation_mode = "QUATERNION"
        q = Vector((0, 1, 0)).rotation_difference(d.normalized())
        if normal_hint is not None:
            # roll the bar so its thin side faces out of the plate
            up = q @ Vector((0, 0, 1))
            n = Vector(normal_hint)
            n = (n - n.dot(d.normalized()) * d.normalized()).normalized()
            q = up.rotation_difference(n) @ q
        o.rotation_quaternion = q
        parts.append(o)
    return parts


def join(name, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    o.location = (0, 0, 0)
    return o


def mirror_x(src, name):
    """The other side: a deep copy flipped across X, faces turned back out."""
    o = src.copy()
    o.data = src.data.copy()
    scene.collection.objects.link(o)
    o.name = name
    o.data.name = name
    me = o.data
    for v in me.vertices:
        v.co.x = -v.co.x
    me.flip_normals()
    return o


# ══ HELMET — headphones you wear as a face ════════════════════════════════
def helmet():
    p = []
    # The shell: a full cranium that sweeps back into a low tail, trimmed
    # open at the face (the visor fills it).
    def shell_keep(v):
        face = v.y > 0.35 and -0.62 < v.z < 0.3
        return not face

    p.append(ellipsoid("h_shell", "armor", (0, -0.008, 0.014), (0.088, 0.1, 0.1), 32, 18, shell_keep))
    solidify(p[-1], 0.006, 1)
    # Crown ridge — a chrome spine from brow to nape.
    ridge = sheet(
        "h_spine",
        "chrome",
        lambda u, v: (
            (v - 0.5) * 0.026,
            0.07 * math.cos(math.pi * (0.1 + 0.9 * u)) - 0.004,
            0.012 + 0.104 * math.sin(math.pi * (0.1 + 0.9 * u)) * (0.92 + 0.08 * v) - 0.004,
        ),
        14,
        2,
        0.01,
    )
    p.append(ridge)
    # The visor: smoked glass wrapping the face, an EQ of lit bars behind it.
    p.append(
        ellipsoid(
            "h_visor",
            "visor_glass",
            (0, 0.0, 0.006),
            (0.081, 0.093, 0.07),
            32,
            14,
            lambda v: v.y > 0.25 and -0.55 < v.z < 0.42,
        )
    )
    solidify(p[-1], 0.003, 1)
    bars = 9
    for i in range(bars):
        t = (i - (bars - 1) / 2) / ((bars - 1) / 2)
        a = t * 0.95
        h = 0.012 + 0.024 * (1 - abs(t)) ** 1.4 + (0.008 if i % 3 == 1 else 0)
        x = math.sin(a) * 0.072
        y = math.cos(a) * 0.08
        b = box(f"h_eq{i}", "glow_core", (x, y, 0.004), (0.0075, 0.004, h))
        b.rotation_euler = (0, 0, -a)
        p.append(b)
    # The cans: chrome-rimmed drivers at the ears, each with a lit ring.
    for s in (-1, 1):
        x = s * 0.089
        can = lathe(
            f"h_can{s}",
            "armor",
            [(0.0, -0.016), (0.042, -0.016), (0.047, -0.008), (0.047, 0.012), (0.04, 0.02), (0.0, 0.02)],
            32,
        )
        can.rotation_euler = (0, s * math.pi / 2, 0)
        can.location = (x, -0.01, 0.0)
        p.append(can)
        p.append(ring(f"h_canring{s}", "glow_core", (x + s * 0.021, -0.01, 0.0), 0.032, 0.0045, axis="X"))
        p.append(ring(f"h_canrim{s}", "chrome", (x + s * 0.012, -0.01, 0.0), 0.046, 0.004, axis="X"))
        hub = lathe(f"h_hub{s}", "chrome", [(0.0, 0.0), (0.013, 0.0), (0.011, 0.006), (0.0, 0.008)], 20)
        hub.rotation_euler = (0, s * math.pi / 2, 0)
        hub.location = (x + s * 0.02, -0.01, 0.0)
        p.append(hub)
        # A swept antenna fin off each can — the headliner's horns.
        def fin_at(u, v, s=s):
            # A blade swept up and back off the can: broad at the root,
            # a point at the tip, curling outward as it climbs.
            return (
                s * (0.098 + 0.035 * u * u),
                -0.015 - 0.16 * u,
                0.025 + 0.15 * u + v * (0.05 * (1 - u) ** 1.3 + 0.004),
            )

        p.append(sheet(f"h_fin{s}", "armor", fin_at, 12, 2, 0.007))
        p.extend(strip(f"h_finpipe{s}", "glow_trim", [fin_at(i / 6, 1.0) for i in range(7)], 0.005, 0.005))
    # THE CREST: three lit blades raked back off the crown — the
    # headliner's mohawk of light, his silhouette across the whole floor.
    for k, (z0, h, rake) in enumerate(((0.1, 0.1, 0.7), (0.09, 0.08, 0.95), (0.065, 0.06, 1.2))):
        y0 = 0.03 - k * 0.05
        b = box(f"h_crest{k}", "glow_trim", (0, y0 - math.sin(rake) * h / 2, z0 + math.cos(rake) * h / 2), (0.008, 0.045, h), bev=0.003)
        b.rotation_euler = (rake, 0, 0)
        p.append(b)
    # The headband arc, can to can over the crown.
    band = sheet(
        "h_band",
        "chrome",
        lambda u, v: (
            0.098 * math.cos(math.pi * u),
            -0.028 + (v - 0.5) * 0.024,
            0.098 * math.sin(math.pi * u) * 1.08,
        ),
        24,
        1,
        0.007,
    )
    p.append(band)
    # Chin guard under the visor.
    chin = sheet(
        "h_chin",
        "armor",
        lambda u, v: (
            0.06 * math.sin((u - 0.5) * 2.2),
            0.07 * math.cos((u - 0.5) * 2.2) + 0.008,
            -0.058 - 0.03 * v,
        ),
        12,
        2,
        0.008,
    )
    p.append(chin)
    p.extend(strip("h_chinpipe", "glow_trim", [(-0.05, 0.05, -0.058), (0, 0.078, -0.058), (0.05, 0.05, -0.058)], 0.0035, 0.0035))
    return join("HELMET", p)


# ══ MANTLE — cuirass, standing collar, the platter on the chest ═══════════
def mantle():
    p = []
    # The cuirass: a lathe squashed to the chest's ellipse, wide at the
    # shoulders, cinched toward the waist.
    # A V: broad across the pecs, cut hard toward the waist.
    prof = [(0.05, 0.03), (0.088, 0.012), (0.108, -0.025), (0.108, -0.075), (0.094, -0.15), (0.074, -0.23), (0.063, -0.28)]
    cu = lathe("m_cuirass", "armor", prof, 40, sx=1.15, sy=0.88, cap=False)
    solidify(cu, 0.006, 1)
    p.append(cu)
    # The platter's chrome bezel stays put on the plate; the record inside
    # it is its own node (PLATTER, below) so it can turn.
    p.append(ring("m_bezel", "chrome", (0, PLATTER_Y, PLATTER_Z), 0.045, 0.005, axis="Y"))
    # Chrome yoke trim along the top of the cuirass.
    p.append(ring("m_yoketrim", "chrome", (0, 0, 0.012), 0.088, 0.004, sx=1.15, sy=0.88))
    # Chevrons: lit V piping over the pecs, pointing at the platter.
    for k, (z0, w) in enumerate(((-0.025, 0.085), (-0.05, 0.07))):
        pts = [(-w, 0.086 - k * 0.004, z0), (0, 0.107, z0 - 0.045), (w, 0.086 - k * 0.004, z0)]
        p.extend(strip(f"m_chev{k}", "glow_trim", pts, 0.005, 0.004, normal_hint=(0, 1, 0)))
    # Abs: two rows of lit slits under the platter.
    for row in range(2):
        for s in (-1, 1):
            p.append(box(f"m_ab{row}{s}", "glow_trim", (s * 0.024, 0.082, -0.18 - row * 0.034), (0.03, 0.006, 0.016), bev=0.002))
    # The standing collar — open at the throat, flared, lit along its lip.
    col = lathe(
        "m_collar",
        "armor",
        [(0.062, -0.01), (0.066, 0.03), (0.074, 0.075)],
        28,
        sx=1.05,
        sy=0.95,
        cap=False,
        arc=(math.pi / 2 + 0.75, math.pi / 2 + math.tau - 0.75),
    )
    solidify(col, 0.006, 1)
    p.append(col)
    lip = []
    for i in range(15):
        a = math.pi / 2 + 0.75 + (math.tau - 1.5) * i / 14
        lip.append((math.cos(a) * 0.075 * 1.05, math.sin(a) * 0.075 * 0.95, 0.076))
    p.extend(strip("m_lip", "glow_trim", lip, 0.005, 0.005))
    # The back: a spine of chrome vertebrae and two lit speaker cones.
    for i in range(5):
        p.append(box(f"m_vert{i}", "chrome", (0, -0.084 + i * 0.002, -0.02 - i * 0.05), (0.03 - i * 0.003, 0.012, 0.03), bev=0.004))
    for s in (-1, 1):
        cone = lathe(f"m_cone{s}", "armor", [(0.0, -0.004), (0.034, -0.004), (0.034, 0.004), (0.012, 0.0), (0.0, -0.002)], 28)
        cone.rotation_euler = (math.pi / 2, 0, 0)
        cone.location = (s * 0.052, -0.092, -0.09)
        p.append(cone)
        p.append(ring(f"m_conering{s}", "glow_core", (s * 0.052, -0.097, -0.09), 0.03, 0.0035, axis="Y"))
    # The lower hem of the cuirass, lit.
    hem = []
    for i in range(21):
        a = i / 20 * math.tau
        hem.append((math.cos(a) * 0.065 * 1.15, math.sin(a) * 0.065 * 0.88, -0.278))
    p.extend(strip("m_hem", "glow_trim", hem, 0.005, 0.005))
    # Lit flank seams under the arms.
    for s in (-1, 1):
        p.extend(strip(f"m_flank{s}", "glow_trim", [(s * 0.122, 0.0, -0.05), (s * 0.106, 0.0, -0.15), (s * 0.084, 0.0, -0.24)], 0.005, 0.005, normal_hint=(s, 0, 0)))
    m = join("MANTLE", p)
    platter().parent = m
    return m


PLATTER_Y = 0.096  # the chest plate's front surface at the platter
PLATTER_Z = -0.105


def platter():
    """The record on his chest: black vinyl, lit grooves, a hot strobe dot
    near the rim so the turn reads, a chrome spindle. Built at the origin
    facing +Y, then moved to the chest — its node origin IS its axis."""
    p = []
    rec = lathe("pl_rec", "armor", [(0.0, 0.0), (0.04, 0.0), (0.04, 0.004), (0.0, 0.006)], 36)
    rec.rotation_euler = (-math.pi / 2, 0, 0)
    p.append(rec)
    for r, m, t in ((0.031, "glow_core", 0.003), (0.019, "glow_trim", 0.0022)):
        p.append(ring(f"pl_r{r}", m, (0, 0.004, 0), r, t, axis="Y"))
    p.append(ring("pl_spindle", "chrome", (0, 0.006, 0), 0.006, 0.003, axis="Y"))
    # The strobe dot and a label wedge: what you see go round.
    p.append(ellipsoid("pl_dot", "glow_core", (0.0, 0.006, 0.036), (0.004, 0.003, 0.004), 10, 6))
    p.append(box("pl_wedge", "chrome", (0.0, 0.006, -0.011), (0.006, 0.003, 0.012)))
    o = join("PLATTER", p)
    o.location = (0, PLATTER_Y, PLATTER_Z)
    return o


# ══ PAULDRON — three layered plates over the shoulder (right side) ════════
def pauldron():
    p = []
    for k, (r, dz, out) in enumerate(((0.078, 0.022, 0.012), (0.07, -0.012, 0.022), (0.062, -0.044, 0.03))):
        plate = ellipsoid(
            f"p_plate{k}",
            "armor",
            (out, 0, dz),
            (r, r * 0.95, r * 0.8),
            28,
            14,
            lambda v: v.z > -0.05 and v.x > -0.55,
        )
        solidify(plate, 0.006, 1)
        p.append(plate)
        rim = []
        for i in range(21):
            a = -math.pi / 2 - 0.95 + (1.9 + math.pi) * i / 20
            rim.append((out + math.cos(a) * r * 0.99, math.sin(a) * r * 0.94, dz - 0.002))
        rim = [q for q in rim if q[0] > out - r * 0.55]
        p.extend(strip(f"p_rim{k}", "glow_trim" if k < 2 else "glow_core", rim, 0.0045, 0.0045))
    # A rivet stud on the top plate.
    p.append(ellipsoid("p_stud", "chrome", (0.05, 0.0, 0.074), (0.011, 0.011, 0.007), 12, 6))
    # Bicep band.
    p.append(ring("p_band", "chrome", (0, 0, -0.17), 0.036, 0.006))
    p.append(ring("p_bandglow", "glow_trim", (0, 0, -0.158), 0.035, 0.0035))
    return join("PAULDRON_R", p)


# ══ VAMBRACE — the forearm's armoured tube (right side) ═══════════════════
def vambrace():
    p = []
    tube = lathe("v_tube", "armor", [(0.035, -0.035), (0.037, -0.07), (0.034, -0.16), (0.029, -0.235)], 24, sx=1.0, sy=0.92, cap=False)
    solidify(tube, 0.005, 1)
    p.append(tube)
    # Lit stripe down the outside of the forearm.
    p.extend(strip("v_stripe", "glow_trim", [(0.037, 0.0, -0.05), (0.035, 0.0, -0.215)], 0.006, 0.012, normal_hint=(1, 0, 0)))
    for z, m in ((-0.04, "chrome"), (-0.232, "glow_trim")):
        p.append(ring(f"v_r{z}", m, (0, 0, z), 0.036 if z > -0.1 else 0.031, 0.004, sy=0.92))
    # Elbow cop: a dome behind the joint with a lit pip.
    cop = ellipsoid("v_cop", "chrome", (0, -0.02, -0.004), (0.032, 0.026, 0.03), 18, 10, lambda v: v.y < 0.2)
    p.append(cop)
    p.append(ellipsoid("v_pip", "glow_core", (0, -0.046, -0.004), (0.008, 0.004, 0.008), 10, 6))
    return join("VAMBRACE_R", p)


# ══ GAUNTLET — armour over the mitt, knuckle studs, a lit cuff (right) ════
def gauntlet():
    p = []
    shell = box("g_shell", "armor", (0, 0.03, 0.0), (0.086, 0.104, 0.062), bev=0.012)
    p.append(shell)
    for i in range(4):
        x = (i - 1.5) * 0.019
        p.append(ellipsoid(f"g_knuck{i}", "glow_core", (x, 0.083, 0.012), (0.007, 0.006, 0.007), 10, 6))
    p.append(box("g_plate", "chrome", (0, 0.03, 0.033), (0.064, 0.07, 0.006), bev=0.003))
    p.append(ring("g_cuff", "glow_trim", (0, -0.022, 0.0), 0.04, 0.005, axis="Y"))
    p.append(ring("g_cuffrim", "chrome", (0, -0.03, 0.0), 0.042, 0.005, axis="Y"))
    return join("GAUNTLET_R", p)


# ══ FAULD — belt, buckle, hip plates and the coat tails ═══════════════════
def fauld():
    p = []
    bz = 0.13
    p.append(ring("f_belt", "armor", (0, 0, bz), 0.075, 0.012, sx=1.18, sy=0.88))
    p.append(ring("f_beltglow", "glow_trim", (0, 0, bz + 0.012), 0.077, 0.0035, sx=1.18, sy=0.88))
    p.append(box("f_buckle", "chrome", (0, 0.074, bz), (0.05, 0.012, 0.034), bev=0.006))
    p.append(box("f_buckleglow", "glow_core", (0, 0.081, bz), (0.03, 0.004, 0.012), bev=0.002))
    # Hip plates: short curved tassets at the sides, lit along the hem.
    for s in (-1, 1):
        def tas(u, v, s=s):
            ang = -0.6 + 1.5 * u  # sweeps from the front-side round to the back
            r = 0.098 + 0.026 * v
            return (s * math.cos(ang) * r, math.sin(-ang) * r * 0.85, bz - 0.012 - 0.12 * v)

        plate = sheet(f"f_tasset{s}", "armor", tas, 10, 3, 0.006)
        p.append(plate)
        hem = [tas(i / 10, 1.0) for i in range(11)]
        hem = [(x, y, z - 0.002) for x, y, z in hem]
        p.extend(strip(f"f_tashem{s}", "glow_trim", hem, 0.0045, 0.0045))
    # The coat tails: two long panels off the back, split up the middle,
    # flaring as they fall — the headliner's silhouette from behind.
    for s in (-1, 1):
        def tail(u, v, s=s):
            # Split up the back, flaring out past the hips as they fall so
            # the coat reads from the FRONT too, either side of the legs.
            x = s * (0.012 + 0.085 * u + 0.075 * v * u)
            y = -0.085 - 0.02 * v - 0.025 * math.sin(math.pi * u) * (1 - v) + 0.05 * v * u
            return (x, y - 0.04 * v * v, bz - 0.01 - 0.36 * v)

        panel = sheet(f"f_tail{s}", "armor", tail, 8, 8, 0.006)
        p.append(panel)
        p.extend(strip(f"f_tailedge{s}", "glow_trim", [tail(0.0, j / 8) for j in range(9)], 0.004, 0.004))
        p.extend(strip(f"f_tailhem{s}", "glow_trim", [tail(i / 8, 1.0) for i in range(9)], 0.006, 0.006))
    return join("FAULD", p)


# ══ CUISSE — thigh plate and knee cop (right) ═════════════════════════════
def cuisse():
    p = []
    def plate(u, v):
        a = (u - 0.5) * 2.0
        r = 0.05 - 0.012 * v
        return (math.sin(a) * r, math.cos(a) * r, -0.06 - 0.26 * v)

    p.append(sheet("c_plate", "armor", plate, 10, 6, 0.006))
    p.extend(strip("c_stripe", "glow_trim", [(0.0, 0.052, -0.08), (0.0, 0.04, -0.3)], 0.008, 0.005, normal_hint=(0, 1, 0)))
    for z in (-0.06, -0.32):
        edge = [plate(i / 10, 0 if z > -0.1 else 1) for i in range(11)]
        p.extend(strip(f"c_edge{z}", "glow_trim", edge, 0.004, 0.004))
    # Knee cop: chrome dome with a lit ring, riding the end of the thigh.
    p.append(ellipsoid("c_knee", "chrome", (0, 0.024, -0.392), (0.036, 0.024, 0.04), 20, 10, lambda v: v.y > -0.1))
    p.append(ring("c_kneering", "glow_core", (0, 0.046, -0.392), 0.022, 0.004, axis="Y"))
    return join("CUISSE_R", p)


# ══ GREAVE — the shin guard (right) ═══════════════════════════════════════
def greave():
    p = []
    def plate(u, v):
        a = (u - 0.5) * 2.3
        r = 0.04 - 0.012 * v
        return (math.sin(a) * r, math.cos(a) * r + 0.004, -0.05 - 0.25 * v)

    p.append(sheet("g_plate", "armor", plate, 10, 6, 0.006))
    for k in range(3):
        z = -0.1 - k * 0.07
        p.append(box(f"g_slit{k}", "glow_trim", (0, 0.045 - k * 0.003, z), (0.026 - k * 0.003, 0.004, 0.012), bev=0.0015))
    p.extend(strip("g_edgeL", "glow_trim", [plate(0.0, j / 6) for j in range(7)], 0.004, 0.004))
    p.extend(strip("g_edgeR", "glow_trim", [plate(1.0, j / 6) for j in range(7)], 0.004, 0.004))
    return join("GREAVE_R", p)


# ══ BOOT — a platform stomper with a lit sole (right) ═════════════════════
def boot():
    p = []
    # Sole: a deep platform, lit round its edge.
    p.append(box("b_sole", "armor", (0, 0.03, -0.07), (0.084, 0.2, 0.03), bev=0.008))
    p.append(box("b_soleglow", "glow_core", (0, 0.03, -0.07), (0.088, 0.204, 0.008), bev=0.003))
    # Upper: shaft to mid-shin, raked toe cap.
    p.append(lathe("b_shaft", "armor", [(0.036, -0.058), (0.038, 0.0), (0.041, 0.07), (0.044, 0.085)], 24, sy=1.08, cap=False))
    solidify(p[-1], 0.005, 1)
    toe = ellipsoid("b_toe", "armor", (0, 0.055, -0.045), (0.042, 0.082, 0.032), 22, 12, lambda v: v.z > -0.6)
    p.append(toe)
    p.append(ellipsoid("b_cap", "chrome", (0, 0.1, -0.038), (0.033, 0.036, 0.022), 18, 10, lambda v: v.y > 0.0 and v.z > -0.5))
    p.append(ring("b_top", "glow_trim", (0, 0, 0.083), 0.044, 0.004, sy=1.08))
    # Two buckle straps.
    for z in (-0.005, 0.035):
        p.append(ring(f"b_strap{z}", "chrome", (0, 0, z), 0.04, 0.004, sy=1.08))
    return join("BOOT_R", p)


pieces = [helmet(), mantle(), fauld()]
for build, base in ((pauldron, "PAULDRON"), (vambrace, "VAMBRACE"), (gauntlet, "GAUNTLET"), (cuisse, "CUISSE"), (greave, "GREAVE"), (boot, "BOOT")):
    r = build()
    pieces.append(r)
    pieces.append(mirror_x(r, f"{base}_L"))

tris = 0
for o in pieces:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
print(f"pieces={len(pieces)} tris={tris}")
for o in pieces:
    print(f"  {o.name:12s} {len(o.data.loop_triangles):6d}")

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
print("wrote", OUT)

"""
THE TITAN KIT — the shared workshop every arcade titan is built in.

    blender -b --factory-startup --python tools/blender/titans/build.py -- hook [--render]

Each titan module (hook.py, piston.py, vulture.py, fortress.py, king.py)
defines `build(K)` and models its machine through this kit, in the titan's
own unit frame (scale 1 — the game multiplies by BossDef.scale). Blender is
Z-up with the machine facing +Y; the glTF exporter turns that into the rig's
Y-up, facing -Z (three's x = Blender x, three's y = Blender z, three's
z = -Blender y).

THE CONTRACT with src/campaign/titanKit.ts (node names, all unrotated empties
so their local axes are the parent's):

    TITAN                 the root, at the floor under the machine
      BODY_*              meshes riding the root (pelvis, drive, skirt)
      LOW                 the low-blow lamp            (material `low`)
      SHOULDER_0 / _1     shoulder lamps, 0 = -X       (`shoulder_0/1`)
      CHEST               empty at the shoulder line
        CORE              the chest core lamp          (`core`)
      HEAD                empty at the head's centre — the head hitbox
        EYE_0..n          eye lamps                    (`visor`)
        EYEFX             empty where the beam flare swells
      ARM_0 / ARM_1       shoulder pivots, 0 = -X; the arm hangs down -Z
        ELBOW_i           -> WRIST_i -> HAND_i -> DIGIT_i_k
      WING_i -> WINGWRIST_i   (VULTURE only)

Every contract lamp's origin sits at its own centre (the game pulses its
scale and centres a hitbox on it). DIGIT empties carry custom properties
`open` and `closed`: their pitch about local X, three's convention.

Materials: `visor core low shoulder_0 shoulder_1 pod_0 pod_1` are driven by
the game every frame; any name starting `glow` is a static lamp the game
retints to the titan's accent; everything else ships as authored. Ambient
occlusion is baked into each mesh's colour attribute so the seams and
undercuts carry their shadow on Quest, where nothing else would.
"""

import math
import os
import sys

import bpy  # first: bmesh and mathutils only exist once bpy is up

import bmesh
from mathutils import Euler, Matrix, Vector

TAU = math.tau
FONTS = "C:/Windows/Fonts/"
# Armour plate grid density (cells per unit of u, per unit of t). A titan
# module may lower these at the top of build() to fit its triangle budget.
PLATE_U = 64
PLATE_T = 24


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ── materials ─────────────────────────────────────────────────────────────
MATS = {}


def mat(name, rgb=(0.5, 0.5, 0.5), metal=0.0, rough=0.5, emit=None, strength=1.0, alpha=1.0, coat=0.0, coat_rough=0.05):
    """Create (or fetch) a Principled material. `coat` is a clear lacquer."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    MATS[name] = m
    return m


def hex_rgb(h):
    """sRGB hex -> linear rgb (Blender colours are linear)."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


def contract_mats(accent):
    """The lamps the game drives, lit in the accent for the review renders."""
    a = hex_rgb(accent)
    dark = (0.02, 0.02, 0.025)
    for n, s in (("visor", 6), ("core", 5), ("low", 4), ("shoulder_0", 4), ("shoulder_1", 4), ("pod_0", 3), ("pod_1", 3)):
        mat(n, dark, rough=0.25, emit=a, strength=s)
    mat("glow", dark, rough=0.3, emit=a, strength=4)
    mat("glow_dim", dark, rough=0.3, emit=a, strength=1.2)
    mat("lamp_white", dark, rough=0.3, emit=(1.0, 0.95, 0.9), strength=5)


# ── the object registry: every part lands on a mount ──────────────────────
PARTS = []  # (mount name, object)


def _link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


def _obj(bm, name, m, smooth_angle=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[m] if isinstance(m, str) else m)
    o = _link(bpy.data.objects.new(name, me))
    if smooth_angle is not None:
        for p in me.polygons:
            p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return o


def put(mount, *objs):
    """Hand parts to a mount (authored in world space, at rest)."""
    for o in objs:
        if isinstance(o, (list, tuple)):
            put(mount, *o)
        else:
            PARTS.append((mount, o))
    return objs[0] if len(objs) == 1 else objs


def place(o, c=(0, 0, 0), rot=(0, 0, 0)):
    o.rotation_euler = Euler(rot)
    o.location = Vector(c)
    return o


# ── primitives ────────────────────────────────────────────────────────────
def box(name, m, c, size, bev=0.0, segs=2, rot=(0, 0, 0), taper=None):
    """A box of full `size`, bevelled `bev`. `taper=(sx, sy)` shrinks the top face."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]
        if taper and v.co.z > 0:
            x *= taper[0]
            y *= taper[1]
        v.co = Vector((x, y, z))
    if bev:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)
    return place(_obj(bm, name, m, 35), c, rot)


def cyl(name, m, c, r, h, segs=24, rot=(0, 0, 0), r2=None, bev=0.0, open_ends=False):
    """A cylinder along local Z, centred; `r2` is the top radius."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=not open_ends, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    if bev and not open_ends:
        rim = [e for e in bm.edges if all(abs(abs(v.co.z) - h / 2) < 1e-6 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=rim, offset=bev, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    return place(_obj(bm, name, m, 40), c, rot)


def torus(name, m, c, R, r, segs=32, tube=8, rot=(0, 0, 0), arc=None):
    bm = bmesh.new()
    a0, a1 = arc if arc else (0, TAU)
    full = arc is None
    n = segs if full else segs + 1
    rows = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / segs
        row = []
        for j in range(tube):
            b = j / tube * TAU
            row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        rows.append(row)
    for i in range(segs):
        i2 = (i + 1) % n
        for j in range(tube):
            bm.faces.new((rows[i][j], rows[i2][j], rows[i2][(j + 1) % tube], rows[i][(j + 1) % tube]))
    return place(_obj(bm, name, m, 80), c, rot)


def sphere(name, m, c, r, segs=24, rings=14, keep=None, rot=(0, 0, 0)):
    """An ellipsoid of radii r=(rx, ry, rz); `keep(unit co)` trims it."""
    if not isinstance(r, (tuple, list)):
        r = (r, r, r)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    if keep:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    for v in bm.verts:
        v.co = Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2]))
    return place(_obj(bm, name, m, 60), c, rot)


def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def spline(pts, n=8):
    """Catmull-Rom through `pts`, `n` steps per span."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return [P[0].lerp(P[-1], i / n) for i in range(n + 1)]
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        for k in range(n):
            out.append(_cr(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], k / n))
    out.append(P[-1])
    return out


def tube(name, m, pts, r, segs=10, n=6, caps=True, r_end=None):
    """A round tube swept through `pts` (Catmull-Rom), parallel-transported."""
    path = spline(pts, n)
    bm = bmesh.new()
    rings = []
    tan = (path[1] - path[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(tan.z) < 0.9 else Vector((1, 0, 0))
    nrm = tan.cross(ref).normalized()
    for i, p in enumerate(path):
        if i > 0:
            t_new = (path[min(i + 1, len(path) - 1)] - path[i - 1]).normalized()
            axis = tan.cross(t_new)
            if axis.length > 1e-6:
                ang = math.asin(max(-1, min(1, axis.length)))
                nrm = Matrix.Rotation(ang, 3, axis.normalized()) @ nrm
            tan = t_new
        bi = tan.cross(nrm).normalized()
        rr = r if r_end is None else r + (r_end - r) * i / (len(path) - 1)
        rings.append([bm.verts.new(p + (nrm * math.cos(a) + bi * math.sin(a)) * rr) for a in (j / segs * TAU for j in range(segs))])
    for i in range(len(rings) - 1):
        for j in range(segs):
            bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % segs], rings[i][(j + 1) % segs]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, name, m, 60)


def prism(name, m, poly, depth, c=(0, 0, 0), rot=(0, 0, 0), bev=0.0, axis="Y"):
    """Extrude a 2D outline (list of (a, b)) by `depth`, centred. axis Y: the
    outline lies in XZ and is extruded along Y (a plate facing +Y)."""
    bm = bmesh.new()
    lo, hi = [], []
    for a, b in poly:
        if axis == "Y":
            lo.append(bm.verts.new((a, -depth / 2, b)))
            hi.append(bm.verts.new((a, depth / 2, b)))
        elif axis == "X":
            lo.append(bm.verts.new((-depth / 2, a, b)))
            hi.append(bm.verts.new((depth / 2, a, b)))
        else:
            lo.append(bm.verts.new((a, b, -depth / 2)))
            hi.append(bm.verts.new((a, b, depth / 2)))
    bm.faces.new(lo)
    bm.faces.new(hi)
    k = len(poly)
    for i in range(k):
        bm.faces.new((lo[i], lo[(i + 1) % k], hi[(i + 1) % k], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bev:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    return place(_obj(bm, name, m, 35), c, rot)


# ── THE SHELL: a superellipse loft, and armour that conforms to it ────────
def _se(c, n):
    return math.copysign(abs(c) ** (2.0 / n), c)


class Shell:
    """A body shell lofted through cross-sections along local Z.

    Each section is (z, rx, ry[, n[, ox[, oy]]]): half-widths in X and Y,
    the superellipse exponent n (2 = ellipse, 4 = soft box, 8+ = boxy) and a
    centre offset. u runs round the section: 0 = front (+Y), 0.25 = right
    (+X), 0.5 = back, 0.75 = left; t runs 0..1 from the first section to the
    last. The matrix `M` places it (rotate a shell to lie along an arm).
    """

    def __init__(self, sections, M=None):
        self.S = [(s[0], s[1], s[2], s[3] if len(s) > 3 else 4, s[4] if len(s) > 4 else 0, s[5] if len(s) > 5 else 0) for s in sections]
        self.M = M or Matrix.Identity(4)

    def params(self, t):
        S = self.S
        f = t * (len(S) - 1)
        i = min(int(f), len(S) - 2)
        k = f - i
        P = [Vector(S[max(0, min(len(S) - 1, j))]) for j in (i - 1, i, i + 1, i + 2)]
        if i == 0:
            P[0] = P[1] * 2 - P[2]
        if i + 2 > len(S) - 1:
            P[3] = P[2] * 2 - P[1]
        v = _cr(P[0], P[1], P[2], P[3], k)
        return v

    def local(self, u, t, off=0.0):
        z, rx, ry, n, ox, oy = self.params(t)
        a = u * TAU
        p = Vector((ox + max(rx, 1e-5) * _se(math.sin(a), n), oy + max(ry, 1e-5) * _se(math.cos(a), n), z))
        if off:
            p += self.normal_local(u, t) * off
        return p

    def normal_local(self, u, t):
        e = 1e-3
        du = self._raw(u + e, t) - self._raw(u - e, t)
        dt = self._raw(u, min(1, t + e)) - self._raw(u, max(0, t - e))
        nrm = du.cross(dt)
        z, rx, ry, n, ox, oy = self.params(t)
        radial = self._raw(u, t) - Vector((ox, oy, z))
        if nrm.length < 1e-9:
            return radial.normalized() if radial.length > 1e-9 else Vector((0, 0, 1))
        nrm.normalize()
        return -nrm if nrm.dot(radial) < 0 else nrm

    def _raw(self, u, t):
        z, rx, ry, n, ox, oy = self.params(t)
        a = u * TAU
        return Vector((ox + max(rx, 1e-5) * _se(math.sin(a), n), oy + max(ry, 1e-5) * _se(math.cos(a), n), z))

    def at(self, u, t, off=0.0):
        """World point on (or `off` above) the shell, and its outward normal."""
        p = self.M @ self.local(u, t, off)
        nrm = (self.M.to_3x3() @ self.normal_local(u, t)).normalized()
        return p, nrm

    def mesh(self, name, m, nu=40, nt=24, caps=(True, True), off=0.0, smooth=50):
        bm = bmesh.new()
        rows = []
        for j in range(nt + 1):
            t = j / nt
            rows.append([bm.verts.new(self.M @ self.local(i / nu, t, off)) for i in range(nu)])
        for j in range(nt):
            for i in range(nu):
                bm.faces.new((rows[j][i], rows[j][(i + 1) % nu], rows[j + 1][(i + 1) % nu], rows[j + 1][i]))
        for j, on in ((0, caps[0]), (nt, caps[1])):
            if on:
                c = bm.verts.new(sum((v.co for v in rows[j]), Vector()) / nu)
                for i in range(nu):
                    bm.faces.new((rows[j][i], rows[j][(i + 1) % nu], c))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return _obj(bm, name, m, smooth)

    def plate(self, name, m, u0, u1, t0, t1, off=0.004, th=0.012, nu=None, nt=None, bevel=0.5, cw=None, smooth=32):
        """An armour plate conforming to the shell over u0..u1, t0..t1,
        floating `off` above it, `th` thick. Its face is chamfered down to
        `1 - bevel` of the thickness over a band `cw` metres wide (default:
        the thickness) — a crisp hard-surface edge that catches a highlight."""
        nu = nu or max(4, int(abs(u1 - u0) * PLATE_U))
        nt = nt or max(3, int(abs(t1 - t0) * PLATE_T))
        cw = th if cw is None else cw

        def axis(a0, a1, n, length):
            e = min(0.3, cw / max(length, 1e-6)) * (a1 - a0) if bevel else 0
            pts = [a0] + ([a0 + e] if e else []) + [a0 + e + (a1 - a0 - 2 * e) * k / n for k in range(1, n)] + ([a1 - e] if e else []) + [a1]
            return pts

        tm = (t0 + t1) / 2
        um = (u0 + u1) / 2
        Lu = sum((self.local(u0 + (u1 - u0) * (k + 1) / 8, tm) - self.local(u0 + (u1 - u0) * k / 8, tm)).length for k in range(8))
        Lt = sum((self.local(um, t0 + (t1 - t0) * (k + 1) / 8) - self.local(um, t0 + (t1 - t0) * k / 8)).length for k in range(8))
        us = axis(u0, u1, nu, Lu)
        ts = axis(t0, t1, nt, Lt)
        NU, NT = len(us) - 1, len(ts) - 1
        bm = bmesh.new()
        outer, inner = [], []
        for j, t in enumerate(ts):
            ro, ri = [], []
            for i, u in enumerate(us):
                edge = i in (0, NU) or j in (0, NT)
                ro.append(bm.verts.new(self.M @ self.local(u, t, off + th * (1 - bevel if edge else 1))))
                ri.append(bm.verts.new(self.M @ self.local(u, t, off)))
            outer.append(ro)
            inner.append(ri)
        for j in range(NT):
            for i in range(NU):
                bm.faces.new((outer[j][i], outer[j][i + 1], outer[j + 1][i + 1], outer[j + 1][i]))
                bm.faces.new((inner[j][i], inner[j + 1][i], inner[j + 1][i + 1], inner[j][i + 1]))
        ring_o = [outer[0][i] for i in range(NU + 1)] + [outer[j][NU] for j in range(1, NT + 1)] + [outer[NT][i] for i in range(NU - 1, -1, -1)] + [outer[j][0] for j in range(NT - 1, 0, -1)]
        ring_i = [inner[0][i] for i in range(NU + 1)] + [inner[j][NU] for j in range(1, NT + 1)] + [inner[NT][i] for i in range(NU - 1, -1, -1)] + [inner[j][0] for j in range(NT - 1, 0, -1)]
        for k in range(len(ring_o)):
            k2 = (k + 1) % len(ring_o)
            bm.faces.new((ring_o[k], ring_i[k], ring_i[k2], ring_o[k2]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return _obj(bm, name, m, smooth)

    def strip(self, name, m, u0, u1, t0, t1, off=0.006, th=0.004):
        """A lit strip (a thin plate) — light lines that follow the form."""
        return self.plate(name, m, u0, u1, t0, t1, off, th, bevel=0.0, smooth=30)

    def frame_at(self, u, t, off=0.0, up=None):
        """A 4x4 placing local +Y along the surface normal and +Z up the
        shell (for bolts, lamps, decals stuck to the surface)."""
        p, n = self.at(u, t, off)
        p2, _ = self.at(u, min(1, t + 0.01), off)
        p1, _ = self.at(u, max(0, t - 0.01), off)
        upv = (p2 - p1).normalized() if up is None else Vector(up)
        x = upv.cross(n).normalized()
        z = n.cross(x).normalized()
        R = Matrix((x, n, z)).transposed().to_4x4()
        R.translation = p
        return R


def stick(o, M):
    """Apply a frame (from Shell.frame_at) to an object authored at origin
    facing +Y."""
    o.matrix_world = M @ o.matrix_world
    return o


def lathe(name, m, prof, segs=32, c=(0, 0, 0), rot=(0, 0, 0), sx=1.0, sy=1.0, smooth=50):
    """Revolve (radius, z) pairs about local Z."""
    bm = bmesh.new()
    rows = []
    for r, z in prof:
        rows.append([bm.verts.new((max(r, 1e-5) * sx * math.sin(i / segs * TAU), max(r, 1e-5) * sy * math.cos(i / segs * TAU), z)) for i in range(segs)])
    for j in range(len(prof) - 1):
        for i in range(segs):
            bm.faces.new((rows[j][i], rows[j][(i + 1) % segs], rows[j + 1][(i + 1) % segs], rows[j + 1][i]))
    for j in (0, len(prof) - 1):
        if prof[j][0] > 1e-4:
            bm.faces.new(rows[j])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return place(_obj(bm, name, m, smooth), c, rot)


def text(name, m, s, size, c=(0, 0, 0), rot=(math.pi / 2, 0, 0), font="bahnschrift.ttf", extrude=0.0015, align="CENTER", spacing=1.0):
    """Lettering as real geometry. Default rot stands it up facing -Y;
    pass rot=(pi/2, 0, pi) for a plate facing +Y (the titan's front)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = s
    try:
        cu.font = bpy.data.fonts.load(FONTS + font, check_existing=True)
    except Exception:
        pass
    cu.size = size
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.extrude = extrude
    cu.space_character = spacing
    cu.resolution_u = 3
    tmp = _link(bpy.data.objects.new(name + "_tmp", cu))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    me.materials.clear()
    me.materials.append(MATS[m])
    o = _link(bpy.data.objects.new(name, me))
    return place(o, c, rot)


def mirror(o, name=None):
    """A copy mirrored across X (Blender's YZ plane)."""
    me = o.data.copy()
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    c = _link(bpy.data.objects.new(name or (o.name + "_m"), me))
    mw = o.matrix_world.copy()
    S = Matrix.Scale(-1, 4, (1, 0, 0))
    c.matrix_world = S @ mw @ S
    return c


def mirrored(*objs):
    out = []
    for o in objs:
        if isinstance(o, (list, tuple)):
            out.extend(mirrored(*o))
        else:
            out.append(o)
            out.append(mirror(o))
    return out


def bolts(name, m, pts, r=0.008, h=0.006, normal=(0, 1, 0), segs=6):
    """Hex bolt heads at world points, all facing `normal`."""
    bm = bmesh.new()
    nrm = Vector(normal).normalized()
    q = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix().to_4x4()
    for p in pts:
        g = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r * 0.85, depth=h)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(p) + nrm * h / 2) @ q, verts=g["verts"])
    return _obj(bm, name, m, 20)


def vents(name, m, c, w, h, n, depth=0.01, rot=(0, 0, 0), slat=0.35):
    """A louvred grille: `n` slats across a w x h opening, facing +Y."""
    out = [box(name + "_frame", m, (0, 0, 0), (w, depth * 0.6, h), bev=depth * 0.2)]
    for i in range(n):
        z = -h / 2 + (i + 0.5) * h / n
        out.append(box(f"{name}_s{i}", m, (0, depth * 0.4, z), (w * 0.92, depth * 0.3, h / n * slat), rot=(-0.5, 0, 0)))
    o = join(name, out)
    return place(o, c, rot)


def join(name, objs):
    objs = [o for o in objs if o]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.select_set(False)
    return o


def remove(o):
    bpy.data.objects.remove(o, do_unlink=True)


# ── the skeleton ──────────────────────────────────────────────────────────
class Rig:
    """Joint positions in the titan's unit frame (Blender coords). Defaults
    are the game's own (bosses.ts): hips 0.78, shoulders 1.22, head 1.5,
    upper arm 0.5, forearm 0.42, hand 0.1 below the wrist."""

    def __init__(self, shoulder_z=1.22, head_z=1.5, yoke_w=0.62, upper=0.5, fore=0.42, hand=0.1, core=(0, 0.26, -0.12), head_y=0.0):
        self.shoulder_z = shoulder_z
        self.head = Vector((0, head_y, head_z))
        px = yoke_w / 2 + 0.15
        self.pivot = [Vector((-px, 0, shoulder_z + 0.04)), Vector((px, 0, shoulder_z + 0.04))]
        self.upper, self.fore, self.hand = upper, fore, hand
        self.core = Vector((core[0], core[1], shoulder_z + core[2]))
        self.digits = {0: [], 1: []}  # (name, world pos, open, closed)
        self.wings = []  # (side index, world pos, wrist offset x)
        self.extra = []  # (name, world pos, parent mount) — e.g. EYEFX

    def elbow(self, i):
        return self.pivot[i] + Vector((0, 0, -self.upper))

    def wrist(self, i):
        return self.elbow(i) + Vector((0, 0, -self.fore))

    def handp(self, i):
        return self.wrist(i) + Vector((0, 0, -self.hand))

    def digit(self, i, k, pos, open_, closed):
        name = f"DIGIT_{i}_{k}"
        self.digits[i].append((name, Vector(pos), open_, closed))
        return name


def _empty(name, loc, parent=None):
    e = _link(bpy.data.objects.new(name, None))
    e.empty_display_size = 0.04
    e.location = loc
    if parent:
        e.parent = parent
        e.location = loc - parent.matrix_world.translation
    bpy.context.view_layer.update()
    return e


def assemble(R, extra_mounts=()):
    """Build the empty hierarchy, parent every part to its mount (keeping
    world transforms), join per mount, and centre the contract lamps."""
    E = {}
    E["TITAN"] = _empty("TITAN", Vector((0, 0, 0)))
    E["CHEST"] = _empty("CHEST", Vector((0, 0, R.shoulder_z)), E["TITAN"])
    E["HEAD"] = _empty("HEAD", R.head, E["TITAN"])
    for i in (0, 1):
        E[f"ARM_{i}"] = _empty(f"ARM_{i}", R.pivot[i], E["TITAN"])
        E[f"ELBOW_{i}"] = _empty(f"ELBOW_{i}", R.elbow(i), E[f"ARM_{i}"])
        E[f"WRIST_{i}"] = _empty(f"WRIST_{i}", R.wrist(i), E[f"ELBOW_{i}"])
        E[f"HAND_{i}"] = _empty(f"HAND_{i}", R.handp(i), E[f"WRIST_{i}"])
        for name, pos, o, c in R.digits[i]:
            d = _empty(name, pos, E[f"HAND_{i}"])
            d["open"] = o
            d["closed"] = c
            E[name] = d
    for i, pos, wx in R.wings:
        E[f"WING_{i}"] = _empty(f"WING_{i}", pos, E["TITAN"])
        E[f"WINGWRIST_{i}"] = _empty(f"WINGWRIST_{i}", pos + Vector((wx, 0, 0)), E[f"WING_{i}"])
    for name, pos, parent in list(extra_mounts) + R.extra:
        E[name] = _empty(name, Vector(pos), E[parent])

    # Contract lamps keep their own objects (and names); the rest join.
    lamps = {"CORE", "LOW", "SHOULDER_0", "SHOULDER_1"}
    groups = {}
    for mount, o in PARTS:
        groups.setdefault(mount, []).append(o)
    out = []
    for mount, objs in groups.items():
        parent = E[mount] if mount in E else None
        if mount.startswith("EYE_") or mount in lamps:
            # mount names a lamp: parent goes by convention
            host = E["HEAD"] if mount.startswith("EYE_") else E["CHEST"] if mount == "CORE" else E["TITAN"]
            o = join(mount, objs)
            _origin_to_centre(o)
            _parent_keep(o, host)
            out.append(o)
            continue
        if parent is None:
            raise KeyError(f"no mount {mount}")
        o = join(f"{mount}_mesh" if mount != "TITAN" else "BODY_mesh", objs)
        _parent_keep(o, parent)
        out.append(o)
    return E, out


def _origin_to_centre(o):
    me = o.data
    mw = o.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    # bake the world transform into the mesh around c
    me.transform(Matrix.Translation(-c) @ mw)
    o.matrix_world = Matrix.Translation(c)


def _parent_keep(o, parent):
    mw = o.matrix_world.copy()
    o.parent = parent
    o.matrix_world = mw
    # bake the object's own transform into the mesh, leave a pure offset
    bpy.context.view_layer.update()
    local = o.matrix_local.copy()
    loc = local.translation.copy()
    o.data.transform(Matrix.Translation(-loc) @ local)
    o.matrix_local = Matrix.Translation(loc)


# ── rest pose (for AO and the review renders; export is unposed) ─────────
REST = {"pivot_x": 0.18, "pivot_z": 0.14, "elbow": 0.35, "curl": 0.3}


def pose_rest(E, on=True):
    for i, side in ((0, -1), (1, 1)):
        a = E[f"ARM_{i}"]
        # three: rotation.x = 0.18, rotation.z = side*0.14 (about three Z =
        # Blender -Y)
        a.rotation_euler = Euler((REST["pivot_x"], -side * REST["pivot_z"], 0), "ZYX") if on else Euler((0, 0, 0))
        E[f"ELBOW_{i}"].rotation_euler = Euler((REST["elbow"], 0, 0)) if on else Euler((0, 0, 0))
        for k, e in E.items():
            if k.startswith(f"DIGIT_{i}_"):
                e.rotation_euler = Euler((e["open"] + (e["closed"] - e["open"]) * REST["curl"], 0, 0)) if on else Euler((0, 0, 0))
    bpy.context.view_layer.update()


# ── ambient occlusion into the colour attribute ───────────────────────────
def gpu():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception as ex:
        print("GPU setup failed:", ex)


def bake_ao(meshes, samples=96, distance=0.25):
    """Bake AO (the whole posed machine occluding itself) into each mesh's
    `Col` colour attribute; lamp materials stay white."""
    gpu()
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.bake_type = "AO"
    scene.world = scene.world or bpy.data.worlds.new("w")
    scene.world.light_settings.distance = distance
    lit = ("visor", "core", "low", "shoulder", "pod", "glow")
    for o in meshes:
        me = o.data
        if "Col" not in me.color_attributes:
            me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        me.color_attributes.active_color = me.color_attributes["Col"]
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", margin=0)
        except Exception as ex:
            print("AO bake failed on", o.name, ex)
            continue
        # lamps glow on their own: white AO there; lift the floor of the
        # occlusion so the deepest seams read as shadow, not as holes
        col = me.color_attributes["Col"].data
        for poly in me.polygons:
            mname = me.materials[poly.material_index].name if me.materials else ""
            lamp = mname.startswith(lit)
            for li in poly.loop_indices:
                c = col[li].color
                v = 1.0 if lamp else 0.22 + 0.78 * c[0]
                col[li].color = (v, v, v, 1.0)
        o.select_set(False)


# ── export ────────────────────────────────────────────────────────────────
def export(path, E, extras=None):
    if extras:
        for k, v in extras.items():
            E["TITAN"][k] = v
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


def stats(meshes):
    tris = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        tris += n
        print(f"  {o.name:22s} {n:7d} tris  mats={[m.name for m in o.data.materials]}")
    print("TOTAL tris", tris)
    return tris


# ── review renders ────────────────────────────────────────────────────────
def studio(height, accent):
    """A wet neon back-alley studio: dark floor, magenta/cyan rims, warm key."""
    scene = bpy.context.scene
    gpu()
    scene.cycles.samples = 160
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1500
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    w = scene.world or bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.006, 0.007, 0.012, 1)
    floor = bpy.data.meshes.new("floor")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12)
    bm.to_mesh(floor)
    fo = _link(bpy.data.objects.new("floor", floor))
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    b = fm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.008, 0.008, 0.01, 1)
    b.inputs["Roughness"].default_value = 0.32
    floor.materials.append(fm)
    fo.location.z = -0.02 * height

    def area(name, loc, rgb, power, size):
        L = bpy.data.lights.new(name, "AREA")
        L.color = rgb
        L.energy = power
        L.size = size
        o = _link(bpy.data.objects.new(name, L))
        o.location = loc
        d = Vector((0, 0, height * 0.55)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return o

    h = height
    area("key", (-2.0 * h, 2.4 * h, 2.2 * h), (1.0, 0.88, 0.76), 520 * h * h, 1.2 * h)
    area("fill", (2.6 * h, 1.8 * h, 0.8 * h), (0.5, 0.62, 1.0), 120 * h * h, 2.0 * h)
    area("rimL", (-1.7 * h, -2.0 * h, 1.5 * h), (1.0, 0.15, 0.65), 900 * h * h, 0.7 * h)
    area("rimR", (1.9 * h, -1.8 * h, 1.3 * h), (0.12, 0.8, 1.0), 900 * h * h, 0.7 * h)
    area("top", (0, 0.3 * h, 3.0 * h), (0.85, 0.9, 1.0), 160 * h * h, 1.2 * h)
    cam = _link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.data.lens = 50
    scene.camera = cam
    return cam


def shoot(cam, path, yaw_deg, height, pitch_deg=6, dist=1.75, aim=0.55, lens=50):
    yaw = math.radians(yaw_deg)
    d = dist * height
    tgt = Vector((0, 0, height * aim))
    cam.data.lens = lens
    cam.location = tgt + Vector((math.sin(yaw) * d, math.cos(yaw) * d, math.tan(math.radians(pitch_deg)) * d))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)

"""
THE HEAD — Forge pieces for the `head` slot (gear.ts): CREST, ANTENNAE,
HORNS, HALO, MOHAWK.

Head space (game: +y up, front −z, metres), origin at the head's centre.
The bare skull is an ellipsoid — semi-axes 0.13 × (0.94, 1.0, 0.97), its
centre at y = +0.0065 (gearkit.reference('head')) — and every piece is laid
on THAT analytically (`skull`), a few mm off it, on the cranium only:
brow, crown, temples, nape. Never the face: headgear is carried onto the
animal heads by a per-head fit of the cranium.
"""

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils import geometry as mgeo

import gearkit as gk
import kit

# The bare skull (gearkit.reference('head')).
SA = (gk.R_HEAD * gk.HEAD_SCALE[0], gk.R_HEAD * gk.HEAD_SCALE[1], gk.R_HEAD * gk.HEAD_SCALE[2])
SC = Vector((0.0, gk.SKULL_Y, 0.0))


# ---------------------------------------------------------------------------
# The skull, analytically
# ---------------------------------------------------------------------------

def skull(d):
    """The skull point along game direction `d` from its centre, and its
    outward normal."""
    d = Vector(d).normalized()
    t = 1.0 / math.sqrt((d.x / SA[0]) ** 2 + (d.y / SA[1]) ** 2 + (d.z / SA[2]) ** 2)
    p = SC + d * t
    q = p - SC
    n = Vector((q.x / SA[0] ** 2, q.y / SA[1] ** 2, q.z / SA[2] ** 2)).normalized()
    return p, n


def mid(a):
    """The skull's midline: `a` radians from the brow (front, −z) up over
    the crown (π/2) to the nape (π)."""
    return skull((0.0, math.sin(a), -math.cos(a)))


def clearance(p):
    """Roughly how far game point p stands off the skull (metres, < 0 inside)."""
    q = Vector(p) - SC
    f = math.sqrt((q.x / SA[0]) ** 2 + (q.y / SA[1]) ** 2 + (q.z / SA[2]) ** 2)
    return (f - 1.0) * q.length / max(f, 1e-6)


# ---------------------------------------------------------------------------
# Sweeps with designed sections
# ---------------------------------------------------------------------------

def _cr(P, u):
    f = u * (len(P) - 1)
    i = min(int(f), len(P) - 2)
    s = f - i
    p0, p1 = P[max(i - 1, 0)], P[i]
    p2, p3 = P[i + 1], P[min(i + 2, len(P) - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s ** 3)


def curve(pts, n, smooth=True):
    """n points evenly spaced by arc length along a Catmull-Rom spline
    through game-space `pts` (or along the polyline when not smooth)."""
    P = [Vector(p) for p in pts]
    if smooth and len(P) > 2:
        dense = [_cr(P, i / (n * 12)) for i in range(n * 12 + 1)]
    else:
        dense = P
    cum = [0.0]
    for i in range(1, len(dense)):
        cum.append(cum[-1] + (dense[i] - dense[i - 1]).length)
    L = cum[-1]
    out = []
    j = 0
    for k in range(n):
        s = L * k / (n - 1)
        while j < len(dense) - 2 and cum[j + 1] < s:
            j += 1
        seg = max(cum[j + 1] - cum[j], 1e-9)
        u = min(max((s - cum[j]) / seg, 0.0), 1.0)
        out.append(dense[j].lerp(dense[j + 1], u))
    return out


def frames(C, up):
    """Parallel-transport frames (T, N, B) along points C; N starts nearest
    `up`."""
    n = len(C)
    T = [(C[min(i + 1, n - 1)] - C[max(i - 1, 0)]).normalized() for i in range(n)]
    u = Vector(up)
    N = [(u - T[0] * u.dot(T[0])).normalized()]
    for i in range(1, n):
        v = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(v.normalized())
    B = [T[i].cross(N[i]) for i in range(n)]
    return T, N, B


def sweep(name, C, section, up=(0, 1, 0), cap0=True, cap1=True, tip=False, F=None):
    """A solid swept along game points C (already sampled): section(t, i)
    -> [(a, b) or (a, b, c)] — offsets along N, B and T at ring i
    (t = i / (n − 1)). `tip` closes the far end to C[-1]'s point."""
    n = len(C)
    T, N, B = F or frames(C, up)
    bm = bmesh.new()
    rings = []
    last = n - 1 if tip else n
    for i in range(last):
        t = i / (n - 1)
        ring = []
        for s in section(t, i):
            a, b = s[0], s[1]
            c = s[2] if len(s) > 2 else 0.0
            p = C[i] + N[i] * a + B[i] * b + T[i] * c
            ring.append(bm.verts.new(kit.to_blender(tuple(p))))
        rings.append(ring)
    m = len(rings[0])
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(m):
            s1 = (s + 1) % m
            bm.faces.new((r0[s], r0[s1], r1[s1], r1[s]))
    if tip:
        tv = bm.verts.new(kit.to_blender(tuple(C[-1])))
        r = rings[-1]
        for s in range(m):
            bm.faces.new((r[s], r[(s + 1) % m], tv))
    elif cap1:
        bm.faces.new(list(reversed(rings[-1])))
    if cap0:
        bm.faces.new(rings[0])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def rrect(w, h, r, k=3, y0=0.0):
    """A rounded rectangle section (half-width w across = b, half-height h
    along N = a), corner radius r with k steps per corner, centred at a=y0."""
    r = min(r, w * 0.98, h * 0.98)
    pts = []
    for cx, cy, a0 in ((w - r, h - r, 0.0), (-(w - r), h - r, 90.0), (-(w - r), -(h - r), 180.0), (w - r, -(h - r), 270.0)):
        for j in range(k + 1):
            ang = math.radians(a0 + 90.0 * j / k)
            pts.append((y0 + cy + r * math.sin(ang), cx + r * math.cos(ang)))
    return pts


def superellipse_pts(a, b, n, m, rot=0.0):
    """m points round a superellipse: half-extent a along N, b along B."""
    out = []
    for j in range(m):
        th = 2 * math.pi * j / m + rot
        c, s = math.cos(th), math.sin(th)
        out.append((a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s)))
    return out


def lathe_capped(name, profile, origin, axis, ref, arc, start, segs):
    """A partial surface of revolution of a CLOSED profile [(r, h), …]
    about game `axis` through `origin`, its two ends capped."""
    ax = Vector(axis).normalized()
    rx = Vector(ref)
    rx = (rx - ax * rx.dot(ax)).normalized()
    ry = ax.cross(rx)
    o = Vector(origin)
    bm = bmesh.new()
    rows = []
    for s in range(segs + 1):
        a = start + arc * s / segs
        d = rx * math.cos(a) + ry * math.sin(a)
        rows.append([bm.verts.new(kit.to_blender(tuple(o + d * r + ax * h))) for (r, h) in profile])
    m = len(profile)
    for s in range(segs):
        for j in range(m):
            j1 = (j + 1) % m
            bm.faces.new((rows[s][j], rows[s][j1], rows[s + 1][j1], rows[s + 1][j]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def skull_patch(name, centre_dir, u_dir, outline, gap, thick, bulge=0.0, rings=6, segs=32):
    """A plate lying on the skull: `outline(theta) -> (x, y)` in the tangent
    plane at skull(centre_dir) (x along u_dir), every point dropped back
    onto the skull and lifted `gap + thick (+ bulge)`; solidified `thick`
    back toward the skull, so its underside floats `gap` off it."""
    p0, n0 = skull(centre_dir)
    u = Vector(u_dir)
    u = (u - n0 * u.dot(n0)).normalized()
    v = n0.cross(u)

    def place(x, y, t):
        q = p0 + u * x + v * y
        s, ns = skull(q - SC)
        return s + ns * (gap + thick + bulge * (1 - t * t))

    bm = bmesh.new()
    c = bm.verts.new(kit.to_blender(tuple(place(0, 0, 0))))
    rows = []
    for r in range(1, rings + 1):
        t = r / rings
        row = []
        for k in range(segs):
            x, y = outline(2 * math.pi * k / segs)
            row.append(bm.verts.new(kit.to_blender(tuple(place(x * t, y * t, t)))))
        rows.append(row)
    for k in range(segs):
        bm.faces.new((c, rows[0][k], rows[0][(k + 1) % segs]))
    for r in range(rings - 1):
        for k in range(segs):
            k1 = (k + 1) % segs
            bm.faces.new((rows[r][k], rows[r + 1][k], rows[r + 1][k1], rows[r][k1]))
    bm.normal_update()
    cb = Vector(kit.to_blender(tuple(SC)))
    if sum((f.calc_center_median() - cb).dot(f.normal) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    ob = gk.obj_from_bm(name, bm)
    gk.solidify(ob, thick, offset=-1)
    return ob, place, (p0, n0, u, v)


def high_copy(ob):
    """A 'high' twin of a shell part (its modifiers baked), so a shell that
    bakes from a sculpt still has a surface under every part."""
    c = ob.copy()
    c.data = ob.data.copy()
    kit.link(c)
    c.name = ob.name + "_hi"
    c["finish"] = "high"
    return c


RM = 0.128  # metres per radian of midline angle (near enough, for layout)


def _in_poly(pt, poly):
    x, y = pt
    c = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                c = not c
    return c


def _seg_dist(p, a, b):
    ax, ay = b[0] - a[0], b[1] - a[1]
    L = ax * ax + ay * ay
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / L))
    dx, dy = a[0] + ax * t - p[0], a[1] + ay * t - p[1]
    return math.hypot(dx, dy)


def _poly_dist(p, poly):
    return min(_seg_dist(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def mid_point(a, h):
    p, n = mid(a)
    return p + n * h


def mid_plate(name, outline, holes=(), spacing=0.008, weight=None):
    """A flat plate in the skull's midplane (x = 0) laid out in MIDLINE
    coordinates (a, h): a the midline angle (brow 0 … nape π), h the height
    off the skull along its normal. Meshed by constrained Delaunay over the
    outline (+ holes) and a hex lattice inside, so it solidifies cleanly;
    `weight(a, h)` fills vertex group 'w' (a tapered solidify)."""
    U = [(a * RM, h) for (a, h) in outline]
    HU = [[(a * RM, h) for (a, h) in hole] for hole in holes]
    pts = list(U)
    edges = [(i, (i + 1) % len(U)) for i in range(len(U))]
    for hole in HU:
        b = len(pts)
        pts += hole
        edges += [(b + i, b + (i + 1) % len(hole)) for i in range(len(hole))]
    if spacing:
        xs = [p[0] for p in U]
        ys = [p[1] for p in U]
        y = min(ys)
        row = 0
        while y < max(ys):
            x = min(xs) + (spacing / 2 if row % 2 else 0.0)
            while x < max(xs):
                q = (x, y)
                if _in_poly(q, U) and not any(_in_poly(q, h) for h in HU):
                    if _poly_dist(q, U) > 0.6 * spacing and all(_poly_dist(q, h) > 0.6 * spacing for h in HU):
                        pts.append(q)
                x += spacing
            y += spacing * 0.866
            row += 1
    res = mgeo.delaunay_2d_cdt([Vector(p) for p in pts], edges, [], 0, 1e-9)
    vo, fo = res[0], res[2]
    faces = []
    for f in fo:
        cx = sum(vo[i][0] for i in f) / len(f)
        cy = sum(vo[i][1] for i in f) / len(f)
        if _in_poly((cx, cy), U) and not any(_in_poly((cx, cy), h) for h in HU):
            faces.append(tuple(f))
    used = sorted({i for f in faces for i in f})
    remap = {v: k for k, v in enumerate(used)}
    verts = []
    ws = []
    for i in used:
        a, h = vo[i][0] / RM, vo[i][1]
        verts.append(kit.to_blender(tuple(mid_point(a, h))))
        ws.append(weight(a, h) if weight else 1.0)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [tuple(remap[i] for i in f) for f in faces])
    me.validate()
    me.update()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    kit.link(ob)
    vg = ob.vertex_groups.new(name="w")
    for k, w in enumerate(ws):
        vg.add([k], max(0.0, min(1.0, w)), "REPLACE")
    return ob


def taper_solidify(ob, thick, edge_factor):
    m = gk.solidify(ob, thick, offset=0.0)
    m.vertex_group = "w"
    m.thickness_vertex_group = edge_factor
    return m


def spline2(ctrl, n):
    """n points along a Catmull-Rom through 2D (a, h) control points, laid
    out in metres so spacing is even."""
    P = [Vector((a * RM, h, 0.0)) for (a, h) in ctrl]
    return [(p.x / RM, p.y) for p in curve(P, n)]


# ---------------------------------------------------------------------------
# CREST — one dorsal fin, brow to nape
# ---------------------------------------------------------------------------

# The fin's top in midline coordinates (a, h): the leading edge climbs from
# the brow, the tip hooks back behind the crown, the trailing edge falls
# concave to a notch, and a low ridge runs on to the nape.
CREST_TOP = [
    (0.58, -0.0016), (0.66, 0.0040), (0.82, 0.0150), (1.05, 0.0300), (1.32, 0.0450),
    (1.60, 0.0575), (1.86, 0.0668), (2.06, 0.0718), (2.20, 0.0738), (2.155, 0.0668),
    (2.11, 0.0590), (2.06, 0.0480), (2.035, 0.0350), (2.06, 0.0240), (2.13, 0.0165),
    (2.24, 0.0125), (2.42, 0.0100), (2.60, 0.0074), (2.72, 0.0040), (2.80, -0.0016),
]
CREST_S = 1.22     # the fin's height scale over the drawn outline
CREST_HMAX = 0.072 * CREST_S


def crest(ref):
    """CREST: one dorsal fin from brow to nape on a machined keel. The fin is
    a tapered blade — 8 mm at the root, 3 mm at its rounded edge — whose
    leading edge climbs from the brow to a tip hooked back behind the crown;
    the trailing edge falls concave to a notch and a low ridge runs on to
    the nape. A steel guard sheathes the leading edge, a lit lens-shaped
    window runs through the blade, and the keel is bolted down both flanks."""
    objs = []
    GAP, KH, KW = 0.003, 0.0022, 0.0110   # keel: gap, half-height, half-width
    A0, A1 = 0.53, 2.85
    ka = [A0 + (A1 - A0) * i / 27 for i in range(28)]
    kc = [mid(a)[0] + mid(a)[1] * (GAP + KH) for a in ka]

    def keel_sec(t, i):
        e = 0.06
        k = 1.0
        if t < e:
            k = math.sqrt(max(0.0, 1 - (1 - t / e) ** 2))
        elif t > 1 - e:
            k = math.sqrt(max(0.0, 1 - (1 - (1 - t) / e) ** 2))
        k = max(k, 0.25)
        return rrect(KW * k, KH, 0.0014, k=2)
    keel = sweep("keel", kc, keel_sec, up=tuple(mid(ka[0])[1]))
    gk.bevel(keel, 0.0007, segments=2, angle=50)
    objs.append(gk.fin(keel, "trim"))
    base = GAP + 2 * KH   # the keel's top

    top = spline2([(a, h * CREST_S) for (a, h) in CREST_TOP], 90)
    root = [(a, -0.0016) for a in [2.80 - (2.80 - 0.58) * i / 28 for i in range(1, 28)]]
    outline = [(a, h + base) for (a, h) in top + root]

    def wt(a, h):
        return 1.0 - max(0.0, h - base) / CREST_HMAX

    # The window: a lens through the blade along the leading edge's line.
    def lens(inset):
        up, lo = [], []
        for k in range(25):
            s = k / 24
            a = 1.00 + 0.86 * s
            h = base + (0.0110 + 0.0290 * s ** 0.9) * CREST_S
            w = max(0.0033 * math.sin(math.pi * s) ** 0.65 - inset, 0.0)
            up.append((a, h + w))
            if 0 < k < 24:
                lo.append((a, h - w))
        return up + lo[::-1]
    fin = mid_plate("fin", outline, holes=[lens(0.0)], spacing=0.0105, weight=wt)
    taper_solidify(fin, 0.0096, 0.34)
    gk.bevel(fin, 0.0011, segments=2, angle=30)
    objs.append(gk.fin(fin, "shell"))
    glass = mid_plate("window", lens(0.0006), spacing=0, weight=lambda a, h: 0.0)
    gk.solidify(glass, 0.0052, offset=0.0)
    objs.append(gk.fin(glass, "glow"))

    # The guard: a steel band wrapping the leading edge, brow to near the tip.
    le = []
    for p in top:
        if p[0] > 1.80:
            break
        le.append(p)
    outer = [(a, h + base + 0.0008) for (a, h) in le]
    inner = []
    for (a, h) in le[:-1]:
        f = min(1.0, max(0.0, (a - 0.6) / 1.2))
        d = (0.0070 - 0.0030 * f) * (1 - max(0.0, (a - 1.45) / 0.35) ** 1.5) + 0.0008
        inner.append((a, max(h + base - d, base - 0.0016)))
    guard = mid_plate("guard", outer + inner[::-1], spacing=0.0, weight=wt)
    taper_solidify(guard, 0.0110, 0.43)
    gk.bevel(guard, 0.0007, segments=2, angle=30)
    objs.append(gk.fin(guard, "trim"))

    # Bolts down both flanks of the keel.
    for k, a in enumerate((0.78, 1.25, 1.72, 2.19, 2.66)):
        p, nn = mid(a)
        at = p + nn * base
        for s in (-1, 1):
            objs.append(gk.fin(gk.rivet(f"bolt{k}{s}", tuple(at + Vector((s * 0.0080, 0, 0))), tuple(nn), r=0.0019, h=0.0014, segs=8), "trim"))
    return objs


# ---------------------------------------------------------------------------
# ANTENNAE — twin whips off the temples
# ---------------------------------------------------------------------------

def whip_path(start, d0, bend_axis, L, theta_max, power=1.6, n=48):
    """A whip's centreline: from `start` along `d0`, bending about
    `bend_axis` ever harder toward the tip (θ(s) = θmax·(s/L)^power)."""
    k = Vector(bend_axis).normalized()
    pts = [Vector(start)]
    p = Vector(start)
    steps = n * 4
    ds = L / steps
    for i in range(steps):
        s = (i + 0.5) / steps
        th = theta_max * s ** power
        d = Vector(d0).normalized()
        d = d * math.cos(th) + k.cross(d) * math.sin(th) + k * k.dot(d) * (1 - math.cos(th))
        p = p + d * ds
        pts.append(p.copy())
    return curve(pts, n, smooth=False)


def skull_frames(C):
    """Frames along a path lying over the skull: N the skull's normal."""
    n = len(C)
    T = [(C[min(i + 1, n - 1)] - C[max(i - 1, 0)]).normalized() for i in range(n)]
    N, B = [], []
    for i in range(n):
        _, sn = skull(C[i] - SC)
        v = (sn - T[i] * sn.dot(T[i])).normalized()
        N.append(v)
        B.append(T[i].cross(v))
    return T, N, B


def skull_path(d_from, d_to, n, lift=0.0, ease=1.0):
    """n points over the skull from direction d_from to d_to (slerped),
    `lift` (a number or fn(t)) off it; ease > 1 crowds them to the start."""
    a, b = Vector(d_from).normalized(), Vector(d_to).normalized()
    out = []
    for i in range(n):
        t = (i / (n - 1)) ** ease
        d = a.slerp(b, t)
        p, nn = skull(d)
        out.append(p + nn * (lift(t) if callable(lift) else lift))
    return out


def antennae(ref):
    """ANTENNAE: a streamlined SENSOR HOUSING on each upper temple (the
    paint) — a swept teardrop body, high and round at the front, tapering
    back along the side of the crown, a few mm off the skull, a lit sensor
    strip down its flank and bolted at the tail. Out of its brow, through a
    steel collar with a lit seam, a painted sleeve hands over at a ferrule
    to a long tapered steel whip that climbs, splays and curls back ever
    harder toward its tip, where a lit bead sits in a steel cup."""
    objs = []
    GAP = 0.003
    W, H = 0.0180, 0.0275         # housing half-width, height
    NB = 20

    def env(t):
        e = 0.16
        if t < e:
            u = t / e
            return math.sqrt(max(0.0, u * (2 - u)))
        return 1.0 - 0.62 * ((t - e) / (1 - e)) ** 1.3

    def prof(t):
        e = 0.16
        if t < e:
            u = t / e
            return 0.45 + 0.55 * math.sqrt(max(0.0, u * (2 - u)))
        return 1.0 - 0.72 * ((t - e) / (1 - e)) ** 1.15

    BOT = 0.16   # the underside's depth, as a fraction of the half-width
    EASE = 1.45
    TS = [(i / (NB - 1)) ** EASE for i in range(NB)]
    C = skull_path((0.70, 0.60, -0.40), (0.64, 0.58, 0.34), NB, lift=lambda t: GAP + BOT * W * max(env(t), 0.12), ease=EASE)
    F = skull_frames(C)
    sgn = 1.0 if F[2][NB // 2].x > 0 else -1.0   # +b toward the outside

    def hsec(t, i):
        t = TS[i]
        w, h = W * max(env(t), 0.12), H * prof(t) * max(env(t), 0.3)
        pts = []
        for j in range(12):
            ph = 2 * math.pi * j / 12
            c, s = math.cos(ph), math.sin(ph)
            b = w * math.copysign(abs(c) ** (2 / 2.4), c)
            a = (h if s > 0 else BOT * w) * math.copysign(abs(s) ** (2 / 2.4), s)
            pts.append((a, b * sgn))
        return pts
    house = sweep("housing", C, hsec, F=F)
    gk.bevel(house, 0.0012, segments=2, angle=40)
    objs.append(gk.fin(house, "shell"))
    # The lit sensor strip along the outer flank (just proud of it).
    st = []
    nst = []
    for i in range(int(NB * 0.45), int(NB * 0.9)):
        t = TS[i]
        w, h = W * env(t), H * prof(t) * max(env(t), 0.3)
        ph = math.radians(40)
        c, s = math.cos(ph), math.sin(ph)
        b = w * c ** (2 / 2.4) * sgn
        a = h * s ** (2 / 2.4)
        st.append(C[i] + F[1][i] * a + F[2][i] * b)
        # The surface's normal there (of the superellipse, roughly).
        nst.append((F[1][i] * (s / max(h, 1e-4)) + F[2][i] * (c / max(w, 1e-4)) * sgn).normalized())
    T2 = [(st[min(i + 1, len(st) - 1)] - st[max(i - 1, 0)]).normalized() for i in range(len(st))]
    N2 = [(nst[i] - T2[i] * nst[i].dot(T2[i])).normalized() for i in range(len(st))]
    B2 = [T2[i].cross(N2[i]) for i in range(len(st))]

    def strip(t, i):
        k = math.sin(math.pi * t) ** 0.4
        return rrect(0.0021 * max(k, 0.15), 0.0007, 0.0005, k=1)
    objs.append(gk.fin(sweep("strip", st, strip, F=(T2, N2, B2)), "glow"))
    # Tail bolt.
    it = int(NB * 0.92)
    tb = C[it] + F[1][it] * H * prof(TS[it]) * env(TS[it]) * 0.98
    objs.append(gk.fin(gk.rivet("tailbolt", tuple(tb), tuple(F[1][it]), r=0.0024, h=0.0016, segs=8), "trim"))

    # Where the whip comes out: the housing's top, a third of the way back.
    i0 = int(NB * 0.36)
    t0 = TS[i0]
    top = C[i0] + F[1][i0] * H * prof(t0) * env(t0)
    _, tn = skull(top - SC)
    ax = (tn * 0.5 + Vector((0.0, 1.0, -0.10))).normalized()
    # The collar: a steel ring sunk into the housing, a lit seam on its lip.
    cprof = [(0.0, -0.008), (0.0086, -0.008), (0.0086, 0.0052), (0.0078, 0.0064), (0.0066, 0.0064), (0.0066, 0.0080), (0.0, 0.0080)]
    col = gk.lathe("collar", cprof, segs=12, axis_origin=tuple(top), axis=tuple(ax))
    gk.bevel(col, 0.0005, segments=1, angle=40)
    objs.append(gk.fin(col, "trim"))
    objs.append(gk.fin(gk.ring("seam", tuple(top + ax * 0.0065), tuple(ax), 0.0072, 0.0007, segs=12, sides=4), "glow"))
    # The whip: out of the collar, curling back about an axis across it.
    c0 = top + ax * 0.0075
    bend = ax.cross(Vector((0.0, 0.0, 1.0))).normalized()
    Cw = whip_path(c0, ax, bend, 0.30, math.radians(124), power=1.8, n=36)
    Fw = frames(Cw, (1, 0, 0))
    j = 7   # the sleeve's end / the ferrule

    def sub(a, b):
        return Cw[a:b + 1], tuple(x[a:b + 1] for x in Fw)
    sc, sf = sub(0, j)
    sleeve = sweep("sleeve", sc, lambda t, i: superellipse_pts(0.0058 - 0.0012 * t, 0.0058 - 0.0012 * t, 2, 12), F=sf)
    gk.bevel(sleeve, 0.0005, segments=1, angle=40)
    objs.append(gk.fin(sleeve, "shell"))

    def collar(name, i, r, hl):
        p, t = Cw[i], Fw[0][i]
        pr = [(0.0, -hl), (r - 0.0007, -hl), (r, -hl + 0.0008), (r, hl - 0.0008), (r - 0.0007, hl), (0.0, hl)]
        return gk.fin(gk.lathe(name, pr, segs=12, axis_origin=tuple(p), axis=tuple(t)), "trim")
    objs.append(collar("ferrule", j, 0.0060, 0.0048))
    objs.append(collar("band", 20, 0.0038, 0.0022))
    wc, wf = sub(j - 1, len(Cw) - 2)
    whip = sweep("whip", wc, lambda t, i: superellipse_pts(0.0040 - 0.0020 * t, 0.0040 - 0.0020 * t, 2, 8), F=wf)
    objs.append(gk.fin(whip, "trim"))
    # The tip: a steel cup and a lit bead.
    tp, tt = Cw[-2], Fw[0][-2]
    cup = [(0.0, -0.0020), (0.0020, -0.0020), (0.0050, 0.0012), (0.0053, 0.0030), (0.0041, 0.0033), (0.0, 0.0026)]
    objs.append(gk.fin(gk.lathe("cup", cup, segs=12, axis_origin=tuple(tp), axis=tuple(tt)), "trim"))
    bead = [(0.0, 0.0014)]
    for k in range(1, 8):
        u = k / 8
        bead.append((0.0054 * math.sin(math.pi * u) ** 0.9 * (1.0 - 0.2 * u), 0.0014 + 0.0130 * (1 - math.cos(math.pi * u)) / 2))
    bead.append((0.0, 0.0144))
    objs.append(gk.fin(gk.lathe("bead", bead, segs=12, axis_origin=tuple(tp), axis=tuple(tt)), "glow"))
    # THE WHIP FLOPS (avatar/flop.ts): everything above the collar swings
    # on a spring from the collar's lip — whippy, light, quick to settle.
    whip_parts = {"sleeve", "ferrule", "band", "whip", "cup", "bead"}
    for o in objs:
        if o.name.split(".")[0] in whip_parts:
            gk.flop(o, "ant_l")
    tip = Cw[-1]
    d = (tip - c0)
    L = d.length
    d = d.normalized()
    ANT_FLOPS.clear()
    spring = dict(len=round(L, 4), stiff=70.0, damp=3.0, swing=0.8)
    ANT_FLOPS["ant_l"] = dict(pivot=[round(v, 5) for v in c0], dir=[round(v, 5) for v in d], **spring)
    ANT_FLOPS["ant_r"] = dict(pivot=[round(-c0.x, 5), round(c0.y, 5), round(c0.z, 5)], dir=[round(-d.x, 5), round(d.y, 5), round(d.z, 5)], **spring)
    out = []
    for o in objs:
        out.append(o)
        m = gk.mirrored_copy(o)
        if o.get("flop") == "ant_l":
            m["flop"] = "ant_r"
        out.append(m)
    return out


ANT_FLOPS = {}


# ---------------------------------------------------------------------------
# HORNS — a ram's pair, curled round
# ---------------------------------------------------------------------------

# The curl, seen from the side: a logarithmic spiral about a centre beside
# the ear (z, y), wound clockwise from the root (up-front of the centre),
# over the top, down behind, under and forward, its radius closing as it
# goes; and seen from the front, a helix winding OUT from the root to the
# tip.
HORN_C = (0.072, 0.064)           # spiral centre (z, y)
HORN_PHI0 = math.radians(166)     # the root's angle about it
HORN_R0 = 0.100                   # the root's radius from it
HORN_TURN = math.radians(318)     # how far round it winds
HORN_R1 = 0.054                   # the radius at the tip
HORN_X = (0.084, 0.222)           # x at the root, at the tip


def horn_points(n=120):
    """The left horn's centreline (game space), root (inside the skull a
    few mm) to tip."""
    k = math.log(HORN_R0 / HORN_R1) / HORN_TURN
    pts = []
    for i in range(n):
        u = -0.03 + 1.03 * i / (n - 1)
        d = HORN_TURN * u
        r = HORN_R0 * math.exp(-k * d)
        ph = HORN_PHI0 - d
        x = HORN_X[0] + (HORN_X[1] - HORN_X[0]) * (1.5 * u - 0.5 * u * u)
        pts.append(Vector((x, HORN_C[1] + r * math.sin(ph), HORN_C[0] + r * math.cos(ph))))
    return pts


def horn_root_dir():
    k = math.log(HORN_R0 / HORN_R1) / HORN_TURN
    p = horn_points(400)
    # The first point outside the skull is where the horn leaves it.
    q = next(v for v in p if clearance(v) > 0.0)
    return tuple(q - SC)


def _horn_r(t):
    # Thick at the root (a little flare where it leaves the mount), tapering.
    return 0.0375 * (1 - t) ** 0.5 + 0.0020


def _horn_sec(t, m=16, k=0.10, scale=1.0):
    r = _horn_r(t) * scale
    out = []
    for j in range(m):
        th = 2 * math.pi * j / m
        # A rounded triangle: a broad outer face, a keel toward the head.
        f = 1 + k * math.cos(3 * th) - 0.035 * math.cos(6 * th)
        out.append((r * f * math.cos(th), r * f * math.sin(th) * 1.05))
    return out


def horns(ref):
    """HORNS: a ram's curl each side — one tapered horn of rounded-
    triangular section that roots high on the cranium, climbs out, rolls
    back over the ear, drops behind the jaw and winds forward and OUT to a
    steel-capped point wide of the cheek. Growth rings are sculpted into the
    bake. At the root it stands in a machined steel collar with a lit seam,
    on a painted mount plate bolted a few mm off the skull."""
    objs = []
    n = 40
    HP = horn_points()
    C = curve(HP, n, smooth=False)
    HORN_ROOT_DIR = horn_root_dir()
    F = frames(C, (1.0, 0.25, 0.0))
    GAP, TH = 0.003, 0.0055
    i0 = 0
    TIP = 0.89
    i_tip = int((n - 1) * TIP)
    tw = lambda t: 0.5 * t  # a slow twist down the horn

    def sec(i, scale=1.0, m=16):
        tt = i / (n - 1)
        pts = _horn_sec(tt, m=m, scale=scale)
        a = tw(tt)
        ca, sa = math.cos(a), math.sin(a)
        return [(x * ca - y * sa, x * sa + y * ca) for (x, y) in pts]

    hc = C[i0:i_tip + 1]
    hf = tuple(x[i0:i_tip + 1] for x in F)
    horn = sweep("horn", hc, lambda t, i: sec(i + i0), F=hf)
    objs.append(gk.fin(horn, "shell"))
    # Its sculpt: the same horn, dense, with growth rings pressed in.
    NH = 300
    Ch = curve(HP, NH, smooth=False)
    Fh = frames(Ch, (1.0, 0.25, 0.0))
    L = sum((Ch[i + 1] - Ch[i]).length for i in range(NH - 1))
    hi1 = int(i_tip * (NH - 1) / (n - 1))

    def sec_hi(t, i):
        tt = i / (NH - 1)
        s = L * tt
        pitch = 0.0058 - 0.0024 * tt
        ph = (s / pitch) % 1.0
        groove = math.exp(-((ph - 0.5) / 0.14) ** 2)
        deep = 1.0 if int(s / pitch) % 4 == 0 else 0.5
        sc = 1.0 - 0.05 * groove * deep * min(1.0, tt / 0.05)
        pts = _horn_sec(tt, m=36, scale=sc)
        a = tw(tt)
        ca, sa = math.cos(a), math.sin(a)
        return [(x * ca - y * sa, x * sa + y * ca) for (x, y) in pts]
    hi = sweep("horn_hi", Ch[:hi1 + 1], sec_hi, F=tuple(x[:hi1 + 1] for x in Fh))
    hi["finish"] = "high"
    objs.append(hi)
    # The steel point.
    tc = C[i_tip - 1:]
    tf = tuple(x[i_tip - 1:] for x in F)
    cap = sweep("point", tc, lambda t, i: sec(i + i_tip - 1, scale=1.07), F=tf, tip=True)
    gk.bevel(cap, 0.0005, segments=1, angle=40)
    objs.append(gk.fin(cap, "trim"))
    # The mount plate on the cranium round the root.
    rp, rn = skull(HORN_ROOT_DIR)

    def plate(th):
        c, s = math.cos(th), math.sin(th)
        f = 1 + 0.10 * math.cos(3 * th + 0.4)
        return 0.058 * f * c, 0.051 * f * s  # sized to the (thicker) horn root
    mount, place, _ = skull_patch("mount", HORN_ROOT_DIR, (0.0, 0.0, 1.0), plate, GAP, TH, bulge=0.0025, rings=3, segs=22)
    gk.bevel(mount, 0.0014, segments=2, angle=35)
    objs.append(gk.fin(mount, "shell"))
    objs.append(high_copy(mount))
    # The collar: a steel sleeve over the horn's root, from inside the
    # plate to 12 mm clear of it, a lit seam round its lip.
    NS = 240
    Cs = curve(HP, NS, smooth=False)
    Fs = frames(Cs, (1.0, 0.25, 0.0))
    js = next(j for j in range(NS) if clearance(Cs[j]) > GAP)
    je = next(j for j in range(NS) if clearance(Cs[j]) > GAP + TH + 0.014)
    jj = list(range(js, je + 1, 5))
    if jj[-1] != je:
        jj.append(je)

    def ssec(t, i):
        tt = jj[i] / (NS - 1)
        r = _horn_r(tt)
        out = []
        a = tw(tt)
        ca, sa = math.cos(a), math.sin(a)
        for (x, y) in _horn_sec(tt, m=16):
            L = math.hypot(x, y)
            k = (L * 1.04 + 0.0022) / L
            out.append(((x * ca - y * sa) * k, (x * sa + y * ca) * k))
        return out
    collar = sweep("collar", [Cs[j] for j in jj], ssec, F=tuple([x[j] for j in jj] for x in Fs))
    gk.bevel(collar, 0.0009, segments=2, angle=35)
    objs.append(gk.fin(collar, "trim"))
    cp, ct = Cs[je], Fs[0][je]
    rr = _horn_r(je / (NS - 1)) * 1.04 + 0.0004
    seam = gk.ring("seam", tuple(cp + ct * 0.0004), tuple(ct), rr, 0.0011, segs=16, sides=4)
    objs.append(gk.fin(seam, "glow"))
    # Three bolts on the plate round the collar.
    for k in range(3):
        th = 2 * math.pi * (k + 0.25) / 3
        x, y = plate(th)
        at = place(x * 0.78, y * 0.78, 0.78)
        _, an = skull(at - SC)
        objs.append(gk.fin(gk.rivet(f"mbolt{k}", tuple(at), tuple(an), r=0.0026, h=0.0018, segs=8), "trim"))
    out = []
    for o in objs:
        out.append(o)
        out.append(gk.mirrored_copy(o))
    return out


# ---------------------------------------------------------------------------
# HALO — a ring that floats
# ---------------------------------------------------------------------------

HALO_C = Vector((0.0, 0.204, 0.010))
HALO_TILT = 0.17


def halo(ref):
    """HALO: a forged CROWN BAND hanging over the head with nothing holding
    it. Its section is designed, not a tube: a tall outer face (the paint),
    a top that slopes down and in, chamfered all round; inside it a steel
    C-race carries a lit channel that shines in across the crown. Four
    heavy steel clamps lock band and race together at the diagonals, each
    bolted on top with a lit lift emitter beneath — the float, engineered."""
    objs = []
    ax = Vector((0.0, math.cos(HALO_TILT), math.sin(HALO_TILT)))
    ref_d = (0.0, 0.0, -1.0)
    SEG = 44
    R0, R1 = 0.100, 0.132
    G = 0.0016   # the lit line's half-height on the outer face
    band = [(R1 - 0.0018, -0.0112), (R1, -0.0086), (R1 + 0.0004, -G - 0.0003), (R1 - 0.0014, -G),
            (R1 - 0.0014, G), (R1 + 0.0004, G + 0.0003), (R1, 0.0080), (R1 - 0.0018, 0.0104),
            (R1 - 0.0055, 0.0110), (R0 + 0.0016, 0.0060), (R0, 0.0046), (R0, -0.0046), (R0 + 0.0016, -0.0060),
            (R1 - 0.0055, -0.0122)]
    b = gk.lathe("band", band + [band[0]], segs=SEG, axis_origin=tuple(HALO_C), axis=tuple(ax), ref=ref_d)
    objs.append(gk.fin(b, "shell"))
    # The race: a steel C round the band's inner edge, its mouth facing in.
    RI = R0 - 0.0058
    race = [(R0 + 0.0012, 0.0050), (RI + 0.0006, 0.0050), (RI, 0.0042), (RI, 0.0022), (RI + 0.0022, 0.0022),
            (RI + 0.0022, -0.0022), (RI, -0.0022), (RI, -0.0042), (RI + 0.0006, -0.0050), (R0 + 0.0012, -0.0050)]
    rc = gk.lathe("race", race + [race[0]], segs=SEG, axis_origin=tuple(HALO_C), axis=tuple(ax), ref=ref_d)
    objs.append(gk.fin(rc, "trim"))
    # The lit channel in the race's mouth.
    ch = [(RI + 0.0023, 0.0021), (RI + 0.0006, 0.0017), (RI + 0.0006, -0.0017), (RI + 0.0023, -0.0021)]
    objs.append(gk.fin(gk.lathe("channel", ch + [ch[0]], segs=SEG, axis_origin=tuple(HALO_C), axis=tuple(ax), ref=ref_d), "glow"))
    line = [(R1 - 0.0015, -G + 0.0002), (R1 - 0.0003, -G + 0.0002), (R1 - 0.0003, G - 0.0002), (R1 - 0.0015, G - 0.0002)]
    objs.append(gk.fin(gk.lathe("line", line + [line[0]], segs=SEG, axis_origin=tuple(HALO_C), axis=tuple(ax), ref=ref_d), "glow"))
    # Four clamps at the diagonals.
    CO = R1 + 0.0028
    CI = RI - 0.0016
    clamp = [(CI, -0.0080), (CI + 0.0030, -0.0136), (CO - 0.0020, -0.0142), (CO, -0.0112), (CO, 0.0100),
             (CO - 0.0020, 0.0128), (CI + 0.0030, 0.0084), (CI, 0.0064)]
    rx = Vector(ref_d)
    rx = (rx - ax * rx.dot(ax)).normalized()
    ry = ax.cross(rx)
    half = math.radians(6.5)
    for k in range(4):
        az = math.pi / 4 + k * math.pi / 2
        cl = lathe_capped(f"clamp{k}", clamp, tuple(HALO_C), tuple(ax), ref_d, 2 * half, az - half, 5)
        gk.bevel(cl, 0.0009, segments=2, angle=35)
        objs.append(gk.fin(cl, "trim"))
        d = rx * math.cos(az) + ry * math.sin(az)
        at = HALO_C + d * (0.5 * (CI + CO) + 0.004) - ax * 0.0140
        em = [(0.0, 0.0), (0.0068, 0.0), (0.0058, -0.0020), (0.0, -0.0024)]
        objs.append(gk.fin(gk.lathe(f"emit{k}", em, segs=14, axis_origin=tuple(at), axis=tuple(ax)), "glow"))
        # Two bolts on the clamp's top, across the band.
        for j, rr in enumerate((R0 + 0.007, R1 - 0.008)):
            p = HALO_C + d * rr + ax * (0.0084 + (0.0128 - 0.0084) * (rr - CI) / (CO - CI))
            objs.append(gk.fin(gk.rivet(f"hb{k}{j}", tuple(p), tuple(ax), r=0.0021, h=0.0014, segs=8), "trim"))
    return objs


# ---------------------------------------------------------------------------
# MOHAWK — a row of spikes over the crown
# ---------------------------------------------------------------------------

MH_A0, MH_A1 = 0.80, 2.52


def mohawk(ref):
    """MOHAWK: seven raked blade-spikes in a row over the crown, tallest at
    the top of the head. Each is a lozenge-section blade (knife edges fore
    and aft, a ridge down each flank) that curls back toward its point,
    standing in a machined steel boot on a bolted keel; the keel carries a
    lit strip between the boots."""
    objs = []
    GAP, KH, KW = 0.003, 0.0028, 0.0105
    ka = [MH_A0 - 0.04 + (MH_A1 - MH_A0 + 0.08) * i / 27 for i in range(28)]
    kc = [mid(a)[0] + mid(a)[1] * (GAP + KH) for a in ka]

    def keel_sec(t, i):
        e = 0.07
        k = 1.0
        if t < e:
            k = math.sqrt(max(0.0, 1 - (1 - t / e) ** 2))
        elif t > 1 - e:
            k = math.sqrt(max(0.0, 1 - (1 - (1 - t) / e) ** 2))
        k = max(k, 0.18)
        return rrect(KW * k, KH * (0.55 + 0.45 * k), 0.002, k=2, y0=-KH * (1 - (0.55 + 0.45 * k)))
    keel = sweep("keel", kc, keel_sec, up=tuple(mid(ka[0])[1]))
    gk.bevel(keel, 0.0007, segments=2, angle=50)
    objs.append(gk.fin(keel, "trim"))
    # A lit line along each flank of the keel.
    sa = [ka[2] + (ka[-3] - ka[2]) * i / 15 for i in range(16)]
    for s_ in (-1, 1):
        sc = [mid(a)[0] + mid(a)[1] * (GAP + KH) + Vector((s_ * (KW - 0.0002), 0, 0)) for a in sa]
        strip = sweep(f"strip{s_}", sc, lambda t, i: rrect(0.0007, 0.0008, 0.0003, k=1), up=tuple(mid(sa[0])[1]))
        objs.append(gk.fin(strip, "glow"))
    count = 7
    for k in range(count):
        t = k / (count - 1)
        a = MH_A0 + 0.10 + (MH_A1 - MH_A0 - 0.20) * t
        p, nn = mid(a)
        _, n2 = mid(a + 0.01)
        back = (mid(a + 0.01)[0] - p).normalized()
        h = 0.050 + 0.048 * math.sin(math.pi * (0.12 + 0.76 * t)) ** 1.4
        lean = 0.45 + 0.25 * t
        d = (nn + back * lean).normalized()
        b0 = p + nn * (GAP + 2 * KH - 0.002)
        ctrl = [b0, b0 + d * h * 0.35, b0 + d * h * 0.72 + back * h * 0.06, b0 + d * h + back * h * 0.2]
        C = curve(ctrl, 11)
        F = frames(C, tuple(back))
        Lb, Wb = 0.0185 + 0.004 * math.sin(math.pi * t), 0.0072

        def blade(tt, i, Lb=Lb, Wb=Wb):
            f = (1 - tt) ** 0.9
            return superellipse_pts(Lb * f, Wb * f, 1.45, 12)
        sp = sweep(f"spike{k}", C, blade, F=F, tip=True)
        gk.bevel(sp, 0.0006, segments=1, angle=50)
        objs.append(gk.fin(sp, "shell"))
        # The boot: a steel ferrule round the blade's foot.
        bc = [b0 - d * 0.0075, b0 + d * 0.0060, b0 + d * 0.0078]
        bf = frames(bc, tuple(back))

        def boot_sec(tt, i, Lb=Lb, Wb=Wb):
            g = (0.0030, 0.0030, 0.0016)[i]
            f = (1 - (0.0 if i < 1 else 0.06 if i == 1 else 0.075)) ** 0.9
            return superellipse_pts(Lb * f + g, Wb * f + g, 2.6, 12)
        boot = sweep(f"boot{k}", bc, boot_sec, F=bf)
        gk.bevel(boot, 0.0006, segments=1, angle=50)
        objs.append(gk.fin(boot, "trim"))
        if k % 2 == 1 and k < count - 1:
            a2 = a + (MH_A1 - MH_A0 - 0.20) / (count - 1) * 0.5
            q, qn = mid(a2)
            top = q + qn * (GAP + 2 * KH)
            for s in (-1, 1):
                objs.append(gk.fin(gk.rivet(f"mb{k}{s}", tuple(top + Vector((s * 0.0068, 0, 0))), tuple(qn), r=0.0018, h=0.0013, segs=8), "trim"))
    return objs


PIECES = {
    "crest": dict(slot="head", build=crest, tex=512, view=dict(target=(0, 0.06, 0.0), dist=1.05)),
    "antennae": dict(slot="head", build=antennae, tex=512, view=dict(target=(0, 0.11, 0.02), dist=1.25), flops=ANT_FLOPS),
    "horns": dict(slot="head", build=horns, tex=1024, view=dict(target=(0, 0.05, 0.03), dist=1.25, yaw=-42, pitch=12)),
    "halo": dict(slot="head", build=halo, tex=512, view=dict(target=(0, 0.09, 0), dist=1.05, pitch=30)),
    "mohawk": dict(slot="head", build=mohawk, tex=512, view=dict(target=(0, 0.07, 0.01), dist=1.1)),
}

"""
THE BODY — Forge pieces for the `body` slot (gear.ts): CHESTPLATE, TAIL,
BELT, WINGS, THRUSTERS, CAPE, TABARD.

Body space (hip-local, +y up, front −z). THE BLANK's STANDARD frame is the
reference (frames.py): no arms, round shoulder caps (r 0.054 at
(±0.198, 0.372, 0.004)), a pectoral shelf, an abdominal plate, the waist
pinch at 0.13, the hip line at −0.02, the tapering tip at −0.23; the head
floats above y 0.49 (keep clear). Each piece is carried onto LEAN / HEAVY /
CURVED by scaling x and z about the body's axis by the frames' ring ratio
at its ANCHOR height (gear.ts BODY_ANCHOR), so everything that matters is
fitted round that height.

Plates are CONFORMED, not shrinkwrapped: a plate is a grid laid over the
body in (height, angle round the axis), each vertex pushed out along its
ray to the body's smoothed upper envelope (so it bridges the pectoral
shelf and the sternum's valley the way a real plate would, never dipping
into them) plus its gap and thickness, then pushed off anything it still
comes near.
"""

import math

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import gearkit as gk
import kit

TAU = 2 * math.pi


# ---------------------------------------------------------------------------
# The body as a query: a BVH in GAME space
# ---------------------------------------------------------------------------

class Body:
    def __init__(self, ref):
        mw = ref.matrix_world
        verts = [Vector(gk.G(mw @ v.co)) for v in ref.data.vertices]
        polys = [tuple(p.vertices) for p in ref.data.polygons]
        self.bvh = BVHTree.FromPolygons(verts, polys)

    def ray(self, o, d):
        loc, nrm, _, _ = self.bvh.ray_cast(Vector(o), Vector(d).normalized())
        return (loc, nrm) if loc is not None else (None, None)

    def nearest(self, p):
        loc, nrm, _, _ = self.bvh.find_nearest(Vector(p))
        return loc, nrm

    def signed(self, p):
        q, n = self.nearest(p)
        return (Vector(p) - q).dot(n), q, n

    def radial(self, y, th, zc=0.0):
        """Distance from the axis (0, y, zc) to the body along the
        horizontal direction th (0 = front, −z; +π/2 = +x)."""
        d = Vector((math.sin(th), 0.0, -math.cos(th)))
        o = Vector((0.0, y, zc)) + d * 0.7
        loc, _ = self.ray(o, -d)
        if loc is None:
            return 0.0
        return (loc - Vector((0.0, y, zc))).length

    def push_out(self, p, gap, iters=3):
        p = Vector(p)
        for _ in range(iters):
            s, q, n = self.signed(p)
            if s >= gap:
                break
            p = p + n * (gap - s)
        return p


def hdir(th):
    return Vector((math.sin(th), 0.0, -math.cos(th)))


def blur2(A, passes=1, wrap_cols=False):
    """[1 2 1]/4 smoothing over both axes of a 2D array (edges clamped)."""
    A = np.array(A, float)
    for _ in range(passes):
        P = np.pad(A, ((1, 1), (0, 0)), mode="edge")
        A = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4
        if wrap_cols:
            P = np.concatenate([A[:, -1:], A, A[:, :1]], axis=1)
        else:
            P = np.pad(A, ((0, 0), (1, 1)), mode="edge")
        A = (P[:, :-2] + 2 * P[:, 1:-1] + P[:, 2:]) / 4
    return A


def envelope(R, passes=12, wrap_cols=False):
    """A smooth UPPER envelope of a radial field: blur, never below R."""
    E = np.array(R, float)
    for _ in range(passes):
        E = np.maximum(blur2(E, 1, wrap_cols), R)
    return blur2(E, 1, wrap_cols)


def smooth1(a, passes=3, wrap=False):
    a = np.array(a, float)
    for _ in range(passes):
        if wrap:
            a = (np.roll(a, 1) + 2 * a + np.roll(a, -1)) / 4
        else:
            p = np.concatenate([a[:1], a, a[-1:]])
            a = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4
    return a


# ---------------------------------------------------------------------------
# Grids and sweeps (game space)
# ---------------------------------------------------------------------------

def grid_obj(name, P, wrap_cols=False, outward=None):
    """A quad grid from P[rows][cols] (game-space Vectors). `outward(p)`
    gives a direction the faces should face (default: away from the
    body's axis)."""
    R, C = len(P), len(P[0])
    bm = bmesh.new()
    V = [[bm.verts.new(kit.to_blender(tuple(P[i][j]))) for j in range(C)] for i in range(R)]
    cc = C if wrap_cols else C - 1
    for i in range(R - 1):
        for j in range(cc):
            j1 = (j + 1) % C
            bm.faces.new((V[i][j], V[i][j1], V[i + 1][j1], V[i + 1][j]))
    bm.normal_update()
    outward = outward or (lambda p: Vector((p.x, 0.0, p.z)))
    score = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        g = Vector(gk.G(c))
        score += Vector(gk.G(f.normal)).dot(outward(g))
    if score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def resample(pts, step=None, n=None, closed=False):
    """Even arc-length resample of a polyline (Vectors)."""
    P = [Vector(p) for p in pts]
    if closed:
        P = P + [P[0]]
    L = [0.0]
    for i in range(1, len(P)):
        L.append(L[-1] + (P[i] - P[i - 1]).length)
    total = L[-1]
    if n is None:
        n = max(2, int(total / step) + 1)
    out = []
    k = 0
    for i in range(n):
        s = total * i / (n - 1)
        while k < len(P) - 2 and L[k + 1] < s:
            k += 1
        seg = L[k + 1] - L[k]
        u = 0.0 if seg < 1e-9 else (s - L[k]) / seg
        out.append(P[k].lerp(P[k + 1], u))
    return out


def band(name, pts, nrms, width, thick, closed=False):
    """A flat strap along `pts` lying on surfaces with normals `nrms`
    (game space): a rectangular section `width` across, `thick` deep, its
    inner face on the points (bevel it to round the edges). width may be a
    function of t."""
    n = len(pts)
    bm = bmesh.new()
    rings = []
    sec = [(-1, 0), (1, 0), (1, 1), (-1, 1)]
    for i in range(n):
        t = i / (n - 1)
        p = Vector(pts[i])
        nn = Vector(nrms[i]).normalized()
        if closed:
            tg = (Vector(pts[(i + 1) % n]) - Vector(pts[(i - 1) % n]))
        else:
            tg = Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])
        tg = (tg - nn * tg.dot(nn)).normalized()
        ac = tg.cross(nn).normalized()
        w = width(t) if callable(width) else width
        ring = []
        for (sx, sy) in sec:
            q = p + ac * (sx * w / 2) + nn * (sy * thick)
            ring.append(bm.verts.new(kit.to_blender(tuple(q))))
        rings.append(ring)
    m = n if closed else n - 1
    for i in range(m):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(4):
            k1 = (k + 1) % 4
            bm.faces.new((a[k], a[k1], b[k1], b[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def on_body_path(body, ctrl, gap, step=0.006):
    """Control points (game) → an even path seated `gap` off the body,
    with the body's normals there."""
    pts = resample(ctrl, step=step)
    out, nrm = [], []
    for p in pts:
        q, n = body.nearest(p)
        out.append(q + n * gap)
        nrm.append(n)
    # Smooth the normals and points a touch (facets of the reference).
    for _ in range(2):
        nrm = [nrm[0]] + [(nrm[i - 1] + 2 * nrm[i] + nrm[i + 1]).normalized() for i in range(1, len(nrm) - 1)] + [nrm[-1]]
    return out, nrm


def lathe_at(name, prof, at, axis, segs=24):
    a = Vector(axis).normalized()
    ref = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
    return gk.lathe(name, prof, segs=segs, axis_origin=tuple(at), axis=tuple(a), ref=tuple(ref))


def rr_outline(w, h, r, n_corner=5):
    """A rounded rectangle outline (local XY), centred."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n_corner + 1):
            a = math.radians(a0 + 90 * k / n_corner)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def frame_at(origin, normal, up=(0, 1, 0)):
    """A Blender matrix: local z along `normal`, local y toward `up`."""
    nz = Vector(normal).normalized()
    u = Vector(up)
    u = (u - nz * u.dot(nz)).normalized()
    xa = u.cross(nz)
    return gk.frame_matrix(tuple(origin), tuple(xa), tuple(u))


class Plate:
    """A conformed plate: rows × cols of (y, th) samples, each pushed out
    along its horizontal ray to the body's envelope plus `lift(i, j)`."""

    def __init__(self, body, Y, TH, lift, gap, zc=0.0, env_passes=10, relax=2, wrap_cols=False):
        Y, TH = np.asarray(Y, float), np.asarray(TH, float)
        R = np.vectorize(lambda y, th: body.radial(y, th, zc))(Y, TH)
        E = envelope(R, env_passes, wrap_cols)
        L = lift if not callable(lift) else np.vectorize(lift)(*np.indices(Y.shape))
        rows, cols = Y.shape
        P = [[Vector((0.0, Y[i, j], zc)) + hdir(TH[i, j]) * (E[i, j] + (L if np.isscalar(L) else L[i, j])) for j in range(cols)]
             for i in range(rows)]
        # Keep `gap` off the body everywhere, smoothing between pushes.
        for it in range(relax + 1):
            P = [[body.push_out(p, gap) for p in row] for row in P]
            if it == relax:
                break
            Q = [[p.copy() for p in row] for row in P]
            for i in range(1, rows - 1):
                for j in range(cols):
                    if not wrap_cols and (j == 0 or j == cols - 1):
                        continue
                    jl, jr = (j - 1) % cols, (j + 1) % cols
                    Q[i][j] = P[i][j] * 0.5 + (P[i - 1][j] + P[i + 1][j] + P[i][jl] + P[i][jr]) * 0.125
            P = Q
        self.P = P
        self.rows, self.cols = rows, cols
        self.wrap = wrap_cols
        bm_verts = [p for row in P for p in row]
        faces = []
        cc = cols if wrap_cols else cols - 1
        for i in range(rows - 1):
            for j in range(cc):
                j1 = (j + 1) % cols
                faces.append((i * cols + j, i * cols + j1, (i + 1) * cols + j1, (i + 1) * cols + j))
        self.bvh = BVHTree.FromPolygons(bm_verts, faces)

    def obj(self, name):
        return grid_obj(name, self.P, self.wrap)

    def at(self, y, th, zc=0.0):
        """Where the horizontal ray (y, th) meets the plate's outer face."""
        d = hdir(th)
        o = Vector((0.0, y, zc)) + d * 0.8
        loc, nrm, _, _ = self.bvh.ray_cast(o, -d)
        if loc is None:
            return None, None
        if nrm.dot(d) < 0:
            nrm = -nrm
        return loc, nrm

    def boundary(self):
        P, R, C = self.P, self.rows, self.cols
        loop = [P[0][j] for j in range(C)] + [P[i][C - 1] for i in range(1, R)] + \
               [P[R - 1][j] for j in range(C - 2, -1, -1)] + [P[i][0] for i in range(R - 2, 0, -1)]
        return loop

    def edge_normal(self, p):
        loc, nrm, _, _ = self.bvh.find_nearest(p)
        o = Vector((p.x, 0, p.z))
        return nrm if nrm.dot(o) >= 0 else -nrm


def rim_tube(name, plate, thick, r, step=0.009, sides=6, loop=None, lift=0.0):
    """A rolled trim edge round a plate's outline, centred on its edge
    half way through its thickness."""
    loop = loop or plate.boundary()
    pts = resample(loop, step=0.004, closed=True)
    pts = [p - plate.edge_normal(p) * (thick / 2 - lift) for p in pts]
    pts = resample(pts, step=step)
    pts[-1] = pts[0].copy()
    return gk.tube(name, [tuple(p) for p in pts], r, sides=sides, closed_ends=False, step=step)


# ---------------------------------------------------------------------------
# CHESTPLATE — one plate over the heart
# ---------------------------------------------------------------------------

def chestplate(ref):
    """CHESTPLATE: a single breastplate over the chest, collarbone to the
    bottom of the ribcage and round to the armpits — a scooped neckline, cut
    armholes, a shallow point over the solar plexus, a medial keel, the
    lower edge flaring off the ribs; a rolled steel rim all round; a lit
    core in a machined bezel over the heart; held on by a strap over each
    shoulder and one round the back, riveted under the plate's edge."""
    body = Body(ref)
    objs = []
    rows, cols = 13, 35
    A = 1.40
    th = np.linspace(-A, A, cols)
    a = np.abs(th)
    ybot = 0.176 + 0.040 * (a / A) ** 1.35
    ytop = np.where(a < 0.80, 0.404 + 0.040 * (a / 0.80) ** 2,
                    0.288 + 0.156 * (1 - np.sqrt(np.clip(1 - ((A - a) / (A - 0.80)) ** 2, 0, 1))))
    ytop = smooth1(ytop, 3)
    ybot = smooth1(ybot, 2)
    s = np.linspace(0, 1, rows)[:, None]
    Y = ybot[None, :] + (ytop - ybot)[None, :] * s
    TH = np.repeat(th[None, :], rows, axis=0)
    S = np.repeat(s, cols, axis=1)
    thick, gap = 0.009, 0.004

    def sstep(e0, e1, x):
        x = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
        return x * x * (3 - 2 * x)

    def lift(i, j):
        t, v = TH[i, j], S[i, j]
        top = 1 - 0.55 * sstep(0.72, 1.0, v)
        keel = 0.014 * max(0.0, 1 - abs(t) / 0.5) ** 1.3 * top
        crown = 0.017 * math.exp(-(t / 0.85) ** 2) * (0.55 + 0.45 * sstep(0.15, 0.55, v)) * top
        flare = 0.011 * max(0.0, 1 - v / 0.32) ** 2
        return gap + thick + keel + crown + flare

    pl = Plate(body, Y, TH, lift, gap + thick, relax=2)
    plate = pl.obj("plate")
    gk.solidify(plate, thick, offset=-1)
    gk.bevel(plate, 0.0022, segments=2, angle=40)
    objs.append(gk.fin(plate, "shell"))
    objs.append(gk.fin(rim_tube("rim", pl, thick, 0.0072, step=0.015, sides=7), "trim"))

    # THE CORE over the heart: a machined collar, a stepped bezel, a lit lens.
    c, n = pl.at(0.322, 0.0)
    K = 1.4
    bez = lathe_at("bezel", [(0.0165 * K, -0.004), (0.0165 * K, 0.0052 * K), (0.0195 * K, 0.0072 * K), (0.0262 * K, 0.0072 * K),
                             (0.0285 * K, 0.0052 * K), (0.0300 * K, 0.0052 * K), (0.0345 * K, 0.0030 * K), (0.0360 * K, -0.005)], c, n, segs=28)
    gk.bevel(bez, 0.0007, segments=1, angle=40)
    objs.append(gk.fin(bez, "trim"))
    lens = lathe_at("lens", [(0.0, 0.0050 * K), (0.009 * K, 0.0046 * K), (0.0168 * K, 0.0034 * K), (0.0168 * K, -0.002)], c, n, segs=32)
    objs.append(gk.fin(lens, "glow"))

    # THE STRAPS: one over each shoulder to the back, one round the back
    # from armpit to armpit; each runs in under the plate's edge, where a
    # pair of rivets holds it.
    st_gap, st_t, st_w = 0.0008, 0.0032, 0.032
    j_sh = cols // 2 + 12
    tp = pl.P[rows - 1][j_sh]
    ctrl = [tp + Vector((0, -0.03, -0.004)), tp + Vector((0, 0.004, 0.012)), Vector((0.124, 0.442, 0.022)),
            Vector((0.114, 0.405, 0.084)), Vector((0.082, 0.33, 0.108)), Vector((0.03, 0.272, 0.112))]
    pts, nr = on_body_path(body, ctrl, st_gap, step=0.012)
    st = band("strapS", pts, nr, st_w, st_t)
    gk.bevel(st, 0.0008, segments=1, angle=50)
    objs.append(gk.fin(st, "trim"))
    ys = 0.250
    ring_pts, ring_n = [], []
    for k in range(37):
        t = A - 0.16 + (TAU - 2 * (A - 0.16)) * k / 36
        q, nn = body.ray(Vector((0, ys, 0)) + hdir(t) * 0.7, -hdir(t))
        ring_pts.append(q + nn * st_gap)
        ring_n.append(nn)
    bs = band("strapB", ring_pts, ring_n, 0.032, st_t)
    gk.bevel(bs, 0.0008, segments=1, angle=50)
    objs.append(gk.fin(bs, "trim"))
    # Where the three meet between the shoulder blades: a steel ring plate.
    q, nn = body.ray(Vector((0, ys, 0.7)), Vector((0, 0, -1)))
    hub = gk.extrude_outline("hub", rr_outline(0.064, 0.048, 0.012), 0.005, frame_at(q + nn * (st_gap + st_t + 0.002), nn),
                             bevel_w=0.0012, segs=2)
    objs.append(gk.fin(hub, "trim"))
    # Rivets where the straps pass under the plate.
    riv = []
    for (yy, tt) in ((tp.y - 0.022, math.atan2(tp.x, -tp.z)),):
        for d in (-0.006, 0.006):
            riv.append((yy, tt + d / 0.17))
    for yy in (ys - 0.006, ys + 0.006):
        riv.append((yy, A - 0.1))
    for k, (yy, tt) in enumerate(riv):
        q, m = pl.at(yy, tt)
        if q is not None:
            objs.append(gk.fin(gk.rivet(f"rv{k}", tuple(q), tuple(m), r=0.0032, h=0.0022, segs=8), "trim"))
    out = []
    for o in objs:
        out.append(o)
        if o.name.startswith(("strapS", "rv")):
            out.append(gk.mirrored_copy(o))
    return out


# ---------------------------------------------------------------------------
# BELT — a band round the waist, buckled
# ---------------------------------------------------------------------------

def loop_band(name, pts, nrms, width, thick):
    """A closed flat ring of strap (see band) — a frame round a buckle."""
    return band(name, pts, nrms, width, thick, closed=True)


def belt(ref):
    """BELT: a stiff band round the waist pinch, crowned across its
    height and welted in steel top and bottom; a machined buckle on the
    front — a steel frame on a backing plate, a lit bar across it; and a
    pouch on each hip, hung on its own strap with a press stud."""
    body = Body(ref)
    objs = []
    rows, cols = 8, 60
    y0, y1 = 0.097, 0.167
    th = np.linspace(0, TAU, cols, endpoint=False)
    s = np.linspace(0, 1, rows)[:, None]
    Y = np.repeat(y0 + (y1 - y0) * s, cols, axis=1)
    TH = np.repeat(th[None, :], rows, axis=0)
    S = np.repeat(s, cols, axis=1)
    thick, gap = 0.008, 0.003

    def lift(i, j):
        return gap + thick + 0.0035 * math.sin(math.pi * S[i, j])

    pl = Plate(body, Y, TH, lift, gap + thick, relax=2, wrap_cols=True, env_passes=14)
    band_o = pl.obj("band")
    gk.solidify(band_o, thick, offset=-1)
    gk.bevel(band_o, 0.0018, segments=2, angle=40)
    objs.append(gk.fin(band_o, "shell"))
    # The welts: steel cord along the top and bottom edges.
    for k, row in ((0, 0), (1, rows - 1)):
        pts = [pl.P[row][j] for j in range(cols)]
        pts = [p - pl.edge_normal(p) * (thick / 2) for p in pts]
        pts = resample(pts, step=0.010, closed=True)
        pts[-1] = pts[0].copy()
        objs.append(gk.fin(gk.tube(f"welt{k}", [tuple(p) for p in pts], 0.0042, sides=6, closed_ends=False, step=0.012), "trim"))

    # THE BUCKLE: a heavy plate buckle standing well proud of the band.
    yc = 0.132
    B = 1.45
    c, n = pl.at(yc, 0.0)
    m = frame_at(c, n)
    back = gk.extrude_outline("buckleplate", rr_outline(0.074 * B, 0.058 * B, 0.014), 0.007, m @ _tz(0.0035), bevel_w=0.0016, segs=2)
    objs.append(gk.fin(back, "trim"))
    # The frame: a ring of steel round the plate's edge, standing proud.
    fr = [m @ Vector((x, y, 0.0055)) for (x, y) in rr_outline(0.066 * B, 0.050 * B, 0.012, n_corner=4)]
    fr = [Vector(gk.G(v)) for v in fr]
    frame_o = loop_band("buckleframe", fr, [n] * len(fr), 0.010, 0.0085)
    gk.bevel(frame_o, 0.002, segments=2, angle=40)
    objs.append(gk.fin(frame_o, "trim"))
    # The lit bar across it.
    bar = gk.extrude_outline("bar", rr_outline(0.064, 0.011, 0.0054), 0.004, m @ _tz(0.0085), bevel_w=0.0012, segs=1)
    objs.append(gk.fin(bar, "glow"))
    for x in (-0.040, 0.040):
        objs.append(gk.fin(gk.rivet(f"brv{x}", tuple(Vector(gk.G(m @ Vector((x, 0.0, 0.007))))), tuple(n), r=0.0034, h=0.0024, segs=8), "trim"))

    # A keeper: a steel loop round the band beside the buckle.
    kt = 0.52
    kc, kn0 = pl.at(yc, kt)
    loop2 = []
    for (u, v) in rr_outline(thick + 0.007, (y1 - y0) + 0.008, 0.004, n_corner=3):
        loop2.append(kc - kn0 * (thick / 2) + kn0 * u + Vector((0, 1, 0)) * v)
    ctr = kc - kn0 * (thick / 2)
    keeper = loop_band("keeper", loop2, [(p - ctr).normalized() for p in loop2], 0.016, 0.0026)
    gk.bevel(keeper, 0.0007, segments=1, angle=50)
    objs.append(gk.fin(keeper, "trim"))

    # THE POUCHES, one each hip.
    K = 1.25
    for side in (1,):
        tp = 1.70 * side
        pc, pn = pl.at(0.128, tp)
        pm = frame_at(pc, pn)
        box = gk.extrude_outline("pouch", rr_outline(0.056 * K, 0.068 * K, 0.012), 0.026 * K, pm @ _tz(0.0145 * K) @ _ty(-0.016 * K),
                                 bevel_w=0.004, segs=2)
        objs.append(gk.fin(box, "shell"))
        # Its strap: off the band, over the pouch's top and down its face.
        sp = [Vector(gk.G(pm @ Vector((0.0, yy * K, zz * K)))) for (yy, zz) in
              ((0.032, 0.0010), (0.0225, 0.0034), (0.0196, 0.010), (0.0196, 0.021), (0.0165, 0.0289), (0.006, 0.0289), (-0.010, 0.0289))]
        sp = resample(sp, step=0.004)
        sn = []
        ac = Vector(gk.G(pm.to_3x3() @ Vector((1, 0, 0)))).normalized()
        for i in range(len(sp)):
            tg = (sp[min(i + 1, len(sp) - 1)] - sp[max(i - 1, 0)]).normalized()
            sn.append(ac.cross(tg).normalized() * -1)
        strap = band("pstrap", sp, sn, 0.020, 0.0026)
        gk.bevel(strap, 0.0007, segments=1, angle=50)
        objs.append(gk.fin(strap, "trim"))
        stud_at = Vector(gk.G(pm @ Vector((0.0, -0.005 * K, (0.0289 * K + 0.0026)))))
        objs.append(gk.fin(gk.rivet("stud", tuple(stud_at), tuple(pn), r=0.0055, h=0.0035, segs=10), "trim"))
    out = []
    for o in objs:
        out.append(o)
        if o.name.startswith(("pouch", "pstrap", "stud")):
            out.append(gk.mirrored_copy(o))
    return out


# ---------------------------------------------------------------------------
# TAIL — swept back off the spine, tip flicked up
# ---------------------------------------------------------------------------

def catmull(ctrl, n=200):
    P = [Vector(p) for p in ctrl]
    out = []
    for k in range(n):
        f = k / (n - 1) * (len(P) - 1)
        i = min(int(f), len(P) - 2)
        u = f - i
        p0, p1 = P[max(i - 1, 0)], P[i]
        p2, p3 = P[i + 1], P[min(i + 2, len(P) - 1)]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


class Path:
    """An arc-length parametrised polyline: at(u) -> point, tangent."""

    def __init__(self, pts):
        self.P = resample(pts, n=400)
        self.L = [0.0]
        for i in range(1, len(self.P)):
            self.L.append(self.L[-1] + (self.P[i] - self.P[i - 1]).length)
        self.len = self.L[-1]

    def at(self, u):
        f = max(0.0, min(1.0, u)) * (len(self.P) - 1)
        i = min(int(f), len(self.P) - 2)
        w = f - i
        p = self.P[i].lerp(self.P[i + 1], w)
        t = (self.P[min(i + 1, len(self.P) - 1)] - self.P[max(i - 1, 0)]).normalized()
        return p, t

    def span(self, u0, u1, step=0.006):
        n = max(3, int((u1 - u0) * self.len / step) + 1)
        return [self.at(u0 + (u1 - u0) * k / (n - 1))[0] for k in range(n)]


def lens_blade(name, outline, ridge, matrix, rings=6, segs=48, ridge_fn=None):
    """A blade: a flat outline (local XY) with a lens section - both faces
    rising linearly from the edge to a ridge of `ridge` (local +-z) - placed
    by `matrix` (Blender). The edge is a crisp arris for the bevel."""
    bm = bmesh.new()
    for sgn in (1, -1):
        c = bm.verts.new((0, 0, sgn * ridge))
        rows_ = []
        for r in range(1, rings + 1):
            t = r / rings
            row = []
            for k in range(segs):
                th = TAU * k / segs
                x, y = outline(th)
                h = ridge * (1 - t) if ridge_fn is None else ridge_fn(x * t, y * t, t)
                row.append(bm.verts.new((x * t, y * t, sgn * h)))
            rows_.append(row)
        for k in range(segs):
            k1 = (k + 1) % segs
            bm.faces.new((c, rows_[0][k], rows_[0][k1]))
        for r in range(rings - 1):
            for k in range(segs):
                k1 = (k + 1) % segs
                bm.faces.new((rows_[r][k], rows_[r + 1][k], rows_[r + 1][k1], rows_[r][k1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return gk.obj_from_bm(name, bm, smooth=True)


def sweep(name, path, u0, u1, radius, sides=8, step=0.008, squash=1.0, phase=None, side_axis=(1.0, 0.0, 0.0), caps=True):
    """A capped tube along `path` between u0 and u1 with a polygonal
    section (a flat on top: `phase` defaults to half a side), its side
    axis held to `side_axis` (game; the path is assumed to run across it)
    and its height squashed by `squash`. radius(t), t in 0..1."""
    phase = math.pi / sides if phase is None else phase
    n = max(3, int(abs(u1 - u0) * path.len / step) + 1)
    bm = bmesh.new()
    rings = []
    sx = Vector(side_axis).normalized()
    for i in range(n):
        t = i / (n - 1)
        p, tg = path.at(u0 + (u1 - u0) * t)
        a = (sx - tg * sx.dot(tg)).normalized()
        up = tg.cross(a).normalized()
        r = radius(t)
        ring = []
        for k in range(sides):
            ang = TAU * k / sides + phase
            q = p + a * (math.sin(ang) * r) + up * (math.cos(ang) * r * squash)
            ring.append(bm.verts.new(kit.to_blender(tuple(q))))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(sides):
            k1 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def tail(ref):
    """TAIL: a jointed tail rooted in a socket on a plate over the sacrum,
    swept back and down off the spine and flicked up at the end - five
    tapering shell segments, each necked into a steel collar with a lit
    ring in its groove - tipped with a bladed spade in the plane of the
    sweep, so it reads in profile from across a room."""
    body = Body(ref)
    objs = []
    # THE MOUNT: a shield-shaped plate over the sacrum.
    rows, cols = 9, 19
    A = 0.74
    th = np.linspace(math.pi - A, math.pi + A, cols)
    a = np.abs(th - math.pi)
    ytop = 0.088 - 0.036 * (a / A) ** 2
    ybot = -0.080 + 0.062 * (a / A) ** 1.4
    s = np.linspace(0, 1, rows)[:, None]
    Y = ybot[None, :] + (ytop - ybot)[None, :] * s
    TH = np.repeat(th[None, :], rows, axis=0)
    thick, gap = 0.0065, 0.004

    def lift(i, j):
        return gap + thick + 0.004 * math.cos((TH[i, j] - math.pi) / A * 1.2) * math.sin(math.pi * (0.15 + 0.7 * s[i, 0]))

    pl = Plate(body, Y, TH, lift, gap + thick, relax=2)
    mount = pl.obj("mount")
    gk.solidify(mount, thick, offset=-1)
    gk.bevel(mount, 0.002, segments=2, angle=40)
    objs.append(gk.fin(mount, "shell"))
    objs.append(gk.fin(rim_tube("mrim", pl, thick, 0.0045, step=0.014, sides=6), "trim"))

    root, rn = pl.at(0.006, math.pi)
    # THE SOCKET: a steel ring standing off the plate, the tail's ball in it.
    sock_ax = (rn + Vector((0, -0.25, 0))).normalized()
    sock = lathe_at("socket", [(0.050, -0.006), (0.058, -0.002), (0.059, 0.010), (0.055, 0.018), (0.047, 0.021),
                               (0.040, 0.012)], root, sock_ax, segs=32)
    gk.bevel(sock, 0.001, segments=1, angle=40)
    objs.append(gk.fin(sock, "trim"))
    for k in range(4):
        ang = TAU * (k + 0.5) / 4
        u_ = Vector((1, 0, 0))
        v_ = rn.cross(u_).normalized()
        p = root + (u_ * math.cos(ang) + v_ * math.sin(ang)) * 0.071
        q, m = pl.at(p.y, math.atan2(p.x, -p.z))
        if q is not None:
            objs.append(gk.fin(gk.rivet(f"bolt{k}", tuple(q), tuple(m), r=0.0036, h=0.0024, segs=8), "trim"))

    # THE TAIL'S LINE.
    o = root + sock_ax * 0.008
    ctrl = [o, o + sock_ax * 0.07, Vector((0.015, -0.045, 0.27)), Vector((0.05, -0.112, 0.39)),
            Vector((0.11, -0.145, 0.50)), Vector((0.18, -0.125, 0.59)), Vector((0.235, -0.050, 0.645)), Vector((0.26, 0.040, 0.66))]
    path = Path(catmull(ctrl, 300))

    def R(u):
        return 0.014 + 0.036 * (1 - u) ** 0.95

    cuts = [0.0, 0.20, 0.38, 0.55, 0.70, 0.83, 0.94]
    ov = 0.022 / path.len   # each segment runs this far INTO the next one's lip
    for k in range(len(cuts) - 1):
        u0 = cuts[k]
        u1 = min(1.0, cuts[k + 1] + ov) if k + 1 < len(cuts) - 1 else 1.0
        last = k == len(cuts) - 2

        def rad(t, u0=u0, u1=u1, last=last, first=(k == 0)):
            u = u0 + (u1 - u0) * t
            # A sleeve: full at its lip, drawing in toward its rear.
            lip = 1.10 if not first else 1.0
            k_ = lip + (0.90 - lip) * min(1.0, t / 0.92) ** 0.8
            if last:
                k_ = lip + (1.0 - lip) * min(1.0, t / 0.4)
            return R(u) * k_
        seg = sweep(f"seg{k}", path, u0, u1, rad, sides=8, step=0.011, squash=0.86)
        gk.bevel(seg, 0.0016, segments=1, angle=30)
        objs.append(gk.fin(seg, "shell"))
        if k > 0:
            # The lip: a steel band round the segment's mouth.
            lip = sweep(f"lip{k}", path, u0 - 0.002 / path.len, u0 + 0.008 / path.len,
                        lambda t, u0=u0: R(u0) * 1.135, sides=8, step=0.004, squash=0.86)
            gk.bevel(lip, 0.0012, segments=1, angle=30)
            objs.append(gk.fin(lip, "trim"))
            # A lit ring round the segment before, just in front of the lip.
            ua = u0 - 0.012 / path.len
            ringo = sweep(f"lit{k}", path, ua - 0.003 / path.len, ua + 0.003 / path.len,
                          lambda t, ua=ua: R(ua) * 0.955 * (0.97 + 0.03 * math.sin(math.pi * t)), sides=8, step=0.002, squash=0.86)
            objs.append(gk.fin(ringo, "glow"))

    # THE SPADE, in the plane of the sweep.
    p, t = path.at(1.0)
    side = Vector((1, 0, 0))
    up = side.cross(t).normalized()
    outline_pts = [(0.135, 0.0), (0.075, 0.028), (0.032, 0.048), (0.006, 0.052), (0.014, 0.022), (-0.004, 0.0125),
                   (-0.004, -0.0125), (0.014, -0.022), (0.006, -0.052), (0.032, -0.048), (0.075, -0.028)]
    outl = gk.polygon_outline([(x - 0.045, y) for (x, y) in outline_pts], corner=2)
    m = gk.frame_matrix(tuple(p + t * 0.041), tuple(t), tuple(up))
    spade = lens_blade("spade", outl, 0.0085, m, rings=4, segs=44)
    gk.bevel(spade, 0.0008, segments=1, angle=30)
    objs.append(gk.fin(spade, "shell"))
    # Its ferrule onto the last segment.
    fpts = [p - t * 0.004, p + t * 0.012]
    fer = gk.tube("ferrule", [tuple(q) for q in fpts], lambda u: R(1.0) * (1.12 - 0.12 * u), sides=14, scale_xy=(0.9, 1.0), step=0.003)
    objs.append(gk.fin(fer, "trim"))
    return objs


# ---------------------------------------------------------------------------
# WINGS — swept plates off the shoulder blades
# ---------------------------------------------------------------------------

def wing_plate(name, root, d, n, L, W, e0, h0, twist=0.0, bend=0.0, sweep=0.0, nx=18):
    """One primary plate of a wing: a long tapered blade from `root` along
    `d` (game), lying in the plane whose normal is `n`. Its outer face (+n)
    is two planes meeting in a crisp ridge set toward the leading (upper)
    edge; its underside a flatter ridge; its edges `e0` thick and square,
    for the bevel. The width swells from the root to 40 % and tapers to a
    point whose leading edge runs straighter than its trailing one; the
    plate bends along `n`, sweeps back in its plane and twists about its
    own length toward the tip."""
    d = Vector(d).normalized()
    n0 = Vector(n)
    n0 = (n0 - d * n0.dot(d)).normalized()
    y0 = n0.cross(d).normalized()          # across, toward the leading edge
    bm = bmesh.new()
    rings = []
    ridge_edges = []
    for i in range(nx + 1):
        t = i / nx
        if t < 0.4:
            w = W * (0.42 + 0.58 * math.sin(0.5 * math.pi * t / 0.4))
        else:
            w = W * max(0.06, ((1 - t) / 0.6) ** 0.6)
        c = W * 0.55 * t * t                 # the tip rides toward the leading edge
        r = c + 0.28 * w
        e = e0 * (1 - 0.55 * t)
        h = h0 * (1 - 0.45 * t) * min(1.0, w / (0.5 * W))
        tw = twist * t
        ya = y0 * math.cos(tw) + n0 * math.sin(tw)
        na = n0 * math.cos(tw) - y0 * math.sin(tw)
        p = root + d * (L * t) + n0 * (bend * math.sin(math.pi * t)) - y0 * (sweep * t * t)
        sec = [(c - w, e / 2), (r, e / 2 + h), (c + w, e / 2), (c + w, -e / 2), (r, -e / 2 - 0.35 * h), (c - w, -e / 2)]
        ring = [bm.verts.new(kit.to_blender(tuple(p + ya * yy + na * zz))) for (yy, zz) in sec]
        rings.append(ring)
    for i in range(nx):
        a, b = rings[i], rings[i + 1]
        for k in range(6):
            k1 = (k + 1) % 6
            bm.faces.new((a[k], a[k1], b[k1], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # The ridges are creases: sharp, not smoothed over.
    bm.verts.ensure_lookup_table()
    ridge_v = set()
    for ring in rings:
        ridge_v.add(ring[1])
        ridge_v.add(ring[4])
    for ed in bm.edges:
        if ed.verts[0] in ridge_v and ed.verts[1] in ridge_v:
            ed.smooth = False
    ob = gk.obj_from_bm(name, bm)
    return ob, (lambda t, side=1: _plate_edge(root, d, n0, y0, L, W, e0, t, side, twist, bend, sweep))


def _plate_edge(root, d, n0, y0, L, W, e0, t, side, twist, bend, sweep):
    """A point on a plate's leading (side +1) or trailing (-1) edge, on
    its outer face."""
    if t < 0.4:
        w = W * (0.42 + 0.58 * math.sin(0.5 * math.pi * t / 0.4))
    else:
        w = W * max(0.06, ((1 - t) / 0.6) ** 0.6)
    c = W * 0.55 * t * t
    e = e0 * (1 - 0.55 * t)
    tw = twist * t
    ya = y0 * math.cos(tw) + n0 * math.sin(tw)
    na = n0 * math.cos(tw) - y0 * math.sin(tw)
    p = root + d * (L * t) + n0 * (bend * math.sin(math.pi * t)) - y0 * (sweep * t * t)
    return p + ya * (c + side * w) + na * (e / 2), na, ya


def wings(ref):
    """WINGS: a harness plate across the shoulder blades carrying a steel
    yoke with a hinge drum each side; off each drum a wing of four thick
    primary plates fanned up, out and back and shingled one over the next
    — each plate ridged down its outer face (two planes meeting in a crisp
    crease), square-edged and bevelled, bent and twisted so each catches
    the light differently — the top one carried by a steel spar along its
    leading edge, a lit strip just under the spar."""
    body = Body(ref)
    objs = []
    # THE HARNESS PLATE over the shoulder blades.
    rows, cols = 7, 17
    A = 0.80
    th = np.linspace(math.pi - A, math.pi + A, cols)
    a = np.abs(th - math.pi)
    ytop = 0.425 - 0.045 * (a / A) ** 2
    ybot = 0.262 + 0.040 * (a / A) ** 1.6
    s = np.linspace(0, 1, rows)[:, None]
    Y = ybot[None, :] + (ytop - ybot)[None, :] * s
    TH = np.repeat(th[None, :], rows, axis=0)
    thick, gap = 0.008, 0.004

    def lift(i, j):
        return gap + thick + 0.008 * math.cos((TH[i, j] - math.pi) / A * 1.25) * math.sin(math.pi * (0.1 + 0.8 * s[i, 0]))

    pl = Plate(body, Y, TH, lift, gap + thick, relax=2)
    plate = pl.obj("harness")
    gk.solidify(plate, thick, offset=-1)
    gk.bevel(plate, 0.002, segments=2, angle=40)
    objs.append(gk.fin(plate, "shell"))

    # THE YOKE: a steel bar across the plate, a hinge drum at each end.
    yy = 0.352
    thd = 0.52
    hp, hn = pl.at(yy, math.pi - thd)
    drum_c = hp + hn * 0.030
    S = Vector((0.80, 0.52, 0.30)).normalized()
    N = Vector((0.32, -0.05, 1.0))
    N = (N - S * N.dot(S)).normalized()
    C = N.cross(S).normalized()            # up and in: toward the leading edge
    drum = lathe_at("drum", [(0.0, -0.030), (0.024, -0.030), (0.031, -0.026), (0.033, -0.010), (0.036, -0.006),
                             (0.036, 0.006), (0.033, 0.010), (0.031, 0.026), (0.024, 0.030), (0.0, 0.030)], drum_c, N, segs=20)
    gk.bevel(drum, 0.001, segments=1, angle=35)
    objs.append(gk.fin(drum, "trim"))
    cap = lathe_at("hub", [(0.0, 0.0325), (0.007, 0.032), (0.009, 0.0305), (0.009, 0.026)], drum_c, N, segs=14)
    # The hub cap is steel, not lit: two lit caps either side of the spine
    # read as a pair of eyes on the wearer's back.
    objs.append(gk.fin(cap, "trim"))
    # The yoke bar from this drum to the spine (its mirror closes it).
    yk = []
    for k in range(9):
        t = thd * (1 - k / 8)
        p, n = pl.at(yy, math.pi - t)
        yk.append(p + n * 0.012)
    yk[0] = drum_c.copy()
    yoke = gk.tube("yoke", [tuple(p) for p in yk], 0.0115, sides=8, scale_xy=(1.0, 0.7), closed_ends=True, step=0.012)
    gk.bevel(yoke, 0.001, segments=1, angle=35)
    objs.append(gk.fin(yoke, "trim"))
    # Bolts holding the yoke down.
    for k, t in enumerate((0.24, 0.08)):
        p, n = pl.at(yy + 0.027, math.pi - t)
        objs.append(gk.fin(gk.rivet(f"yb{k}", tuple(p), tuple(n), r=0.0045, h=0.003, segs=8), "trim"))

    # THE PRIMARIES: four plates fanned from the drum, the top one
    # outermost, each lower one tucked under the one above.
    spec = [  # fan angle, length, half-width, edge, ridge, twist, sweep
        (0.0, 0.66, 0.064, 0.011, 0.017, 8.0, 0.030),
        (10.5, 0.58, 0.062, 0.010, 0.016, 12.0, 0.040),
        (21.0, 0.50, 0.058, 0.010, 0.015, 16.0, 0.045),
        (31.5, 0.41, 0.054, 0.009, 0.014, 20.0, 0.045),
    ]
    top_edge = None
    for k, (ang, L, Wd, e0, h0, tw, swp) in enumerate(spec):
        a_ = math.radians(ang)
        d = S * math.cos(a_) - C * math.sin(a_)
        root = drum_c + d * 0.008 + N * (0.010 - 0.0125 * k)
        pob, edge = wing_plate(f"primary{k}", root, d, N, L, Wd, e0, h0, twist=math.radians(tw),
                               bend=0.022 + 0.004 * k, sweep=swp, nx=16)
        gk.bevel(pob, 0.0016, segments=1, angle=45)
        objs.append(gk.fin(pob, "shell"))
        if k == 0:
            top_edge = edge
    # The spar along the top plate's leading edge, and a lit strip under it.
    ts = np.linspace(0.03, 0.93, 26)
    spar = []
    lit = []
    for t in ts:
        p, na, ya = top_edge(t, 1)
        spar.append(p + ya * 0.0025 - na * 0.003)
        lit.append(p - ya * 0.011 + na * 0.0028)
    objs.append(gk.fin(gk.tube("spar", [tuple(p) for p in spar], lambda t: 0.0088 * (1 - 0.55 * t ** 1.2), sides=6, step=0.02), "trim"))
    objs.append(gk.fin(gk.tube("lit", [tuple(p) for p in lit[2:-4]], lambda t: 0.0021 * (1 - 0.4 * t), sides=5, step=0.02), "glow"))

    out = []
    for o in objs:
        out.append(o)
        if o.name != "harness":
            out.append(gk.mirrored_copy(o))
    return out


# ---------------------------------------------------------------------------
# THRUSTERS — a jet pack, two lit nozzles
# ---------------------------------------------------------------------------

def shoulder_strap(body, plate_top, side, end_y, gap, step=0.012):
    """A strap from the back plate's top edge over the shoulder to the
    chest (game points, seated `gap` off the body)."""
    ctrl = [plate_top, Vector((side * 0.112, 0.43, 0.06)), Vector((side * 0.122, 0.446, 0.0)),
            Vector((side * 0.118, 0.415, -0.07)), Vector((side * 0.112, end_y + 0.04, -0.10)), Vector((side * 0.106, end_y, -0.105))]
    return on_body_path(body, ctrl, gap, step=step)


def thrusters(ref):
    """THRUSTERS: a jet pack — a back plate across the shoulder blades
    carrying two big engine pods (ogive noses, clamp bands, a steel bell
    nozzle under each, its throat lit) either side of a spine housing with
    two lit rails; worn on a harness, a strap over each shoulder to a
    buckle on the chest."""
    body = Body(ref)
    objs = []
    # THE BACK PLATE.
    rows, cols = 7, 15
    A = 0.66
    th = np.linspace(math.pi - A, math.pi + A, cols)
    a = np.abs(th - math.pi)
    ytop = 0.430 - 0.040 * (a / A) ** 2
    ybot = 0.175 + 0.045 * (a / A) ** 1.6
    s = np.linspace(0, 1, rows)[:, None]
    Y = ybot[None, :] + (ytop - ybot)[None, :] * s
    TH = np.repeat(th[None, :], rows, axis=0)
    thick, gap = 0.008, 0.004

    def lift(i, j):
        return gap + thick + 0.006 * math.cos((TH[i, j] - math.pi) / A * 1.2)

    pl = Plate(body, Y, TH, lift, gap + thick, relax=2, env_passes=16)
    plate = pl.obj("backplate")
    gk.solidify(plate, thick, offset=-1)
    gk.bevel(plate, 0.002, segments=2, angle=40)
    objs.append(gk.fin(plate, "shell"))

    # THE SPINE HOUSING between the pods.
    hc, hn = pl.at(0.300, math.pi)
    hm = frame_at(hc, hn)
    housing = gk.extrude_outline("housing", rr_outline(0.056, 0.205, 0.018), 0.030, hm @ _tz(0.015), bevel_w=0.004, segs=2)
    objs.append(gk.fin(housing, "shell"))
    for x in (-0.012, 0.012):
        rail = gk.extrude_outline(f"rail{x}", rr_outline(0.0065, 0.150, 0.003, n_corner=2), 0.004, hm @ _tz(0.0305) @ _tx(x), bevel_w=0.001, segs=1)
        objs.append(gk.fin(rail, "glow"))
    cap_ = gk.extrude_outline("hcap", rr_outline(0.046, 0.026, 0.008, n_corner=2), 0.006, hm @ _tz(0.032) @ _ty(0.088), bevel_w=0.0015, segs=1)
    objs.append(gk.fin(cap_, "trim"))
    cap2 = gk.extrude_outline("hcap2", rr_outline(0.046, 0.026, 0.008, n_corner=2), 0.006, hm @ _tz(0.032) @ _ty(-0.088), bevel_w=0.0015, segs=1)
    objs.append(gk.fin(cap2, "trim"))

    # THE PODS (left first; mirrored).
    PR = 0.058
    side = 1
    mid, mn = pl.at(0.31, math.pi - 0.62)
    axis = Vector((-side * 0.07, 1.0, -0.04)).normalized()
    out = Vector((mn.x, 0.0, mn.z)).normalized()
    base = mid + out * (PR + 0.001) - axis * 0.135
    pod = lathe_at("pod", [(0.0, -0.004), (0.036, -0.004), (0.048, 0.010), (0.056, 0.032), (PR, 0.060), (PR, 0.200),
                           (0.054, 0.236), (0.044, 0.262), (0.030, 0.281), (0.014, 0.293), (0.0, 0.297)], base, axis, segs=24)
    objs.append(gk.fin(pod, "shell"))
    # A machined steel tip on the nose.
    tip = lathe_at("tip", [(0.0270, 0.2835), (0.0315, 0.2845), (0.0255, 0.2925), (0.0120, 0.2995), (0.0, 0.3015)], base, axis, segs=24)
    objs.append(gk.fin(tip, "trim"))
    for h in (0.075, 0.185):
        band_ = lathe_at(f"clamp{h}", [(PR - 0.002, h - 0.010), (PR + 0.0035, h - 0.009), (PR + 0.0045, h - 0.006),
                                        (PR + 0.0045, h + 0.006), (PR + 0.0035, h + 0.009), (PR - 0.002, h + 0.010)], base, axis, segs=22)
        objs.append(gk.fin(band_, "trim"))
        # Its bracket down to the back plate.
        P = base + axis * h
        q, _ = pl.at(P.y, math.atan2(P.x, -P.z))
        d = P - q
        L = d.length - PR + 0.006
        br = gk.extrude_outline(f"brk{h}", rr_outline(0.034, 0.016, 0.005, n_corner=2), L, frame_at(q, d.normalized()) @ _tz(L / 2 - 0.002),
                                bevel_w=0.0015, segs=1)
        objs.append(gk.fin(br, "trim"))
    # A lit intake ring under the nose.
    ring_ = lathe_at("intake", [(0.0505, 0.2405), (0.0535, 0.2425), (0.0515, 0.2495), (0.0475, 0.2495)], base, axis, segs=24)
    objs.append(gk.fin(ring_, "glow"))
    # THE NOZZLE: a steel bell flaring under the pod, splayed a touch out.
    nax = (axis + Vector((side * 0.10, 0.0, 0.05))).normalized()
    nb = base + axis * 0.002
    bell = lathe_at("bell", [(0.034, 0.004), (0.028, -0.018), (0.034, -0.042), (0.046, -0.072), (0.053, -0.090),
                             (0.056, -0.094), (0.052, -0.095), (0.046, -0.086), (0.032, -0.050), (0.024, -0.022)],
                    nb, nax, segs=22)
    gk.bevel(bell, 0.0008, segments=1, angle=40)
    objs.append(gk.fin(bell, "trim"))
    throat = lathe_at("throat", [(0.0, -0.020), (0.024, -0.021), (0.034, -0.058), (0.045, -0.083), (0.047, -0.087)], nb, nax, segs=24)
    # The lit throat sits just inside the bell's inner wall.
    throat.data.transform(_shrink_about(nb, nax, 0.965))
    objs.append(gk.fin(throat, "glow"))
    # Its neck ring: a steel collar where the bell meets the pod.
    neck = lathe_at("neck", [(0.036, 0.010), (0.041, 0.008), (0.042, 0.0), (0.041, -0.008), (0.033, -0.011)], nb, nax, segs=20)
    objs.append(gk.fin(neck, "trim"))

    # THE HARNESS: a strap over each shoulder to a buckle on the chest.
    tp, tn = pl.at(0.415, math.pi - 0.40)
    pts, nr = shoulder_strap(body, tp, side, 0.300, 0.001, step=0.016)
    st = band("hstrap", pts, nr, 0.034, 0.0034)
    gk.bevel(st, 0.0008, segments=1, angle=50)
    objs.append(gk.fin(st, "trim"))
    q, qn = body.nearest(Vector((side * 0.106, 0.300, -0.11)))
    bk = gk.extrude_outline("hbuckle", rr_outline(0.046, 0.034, 0.008, n_corner=3), 0.006, frame_at(q + qn * 0.006, qn), bevel_w=0.0015, segs=1)
    objs.append(gk.fin(bk, "trim"))
    res = []
    for o in objs:
        res.append(o)
        if o.name not in ("backplate", "prim", "housing", "hcap", "hcap2") and not o.name.startswith("rail"):
            res.append(gk.mirrored_copy(o))
    return res


def _tx(x):
    from mathutils import Matrix
    return Matrix.Translation((x, 0, 0))


def _shrink_about(p, axis, k):
    """A Blender matrix scaling by k about the game point p (radially and
    along the axis alike — a lining just inside a lathe)."""
    from mathutils import Matrix
    c = Vector(kit.to_blender(tuple(p)))
    return Matrix.Translation(c) @ Matrix.Scale(k, 4) @ Matrix.Translation(-c)


# ---------------------------------------------------------------------------
# CAPE — hung from the shoulders, pleated
# ---------------------------------------------------------------------------

def top_grid(body, RHO, TH, lift, zc=0.0, gap=0.01, passes=10):
    """A grid laid on the body from ABOVE: (rho, th) round the vertical
    axis through (0, ·, zc), each point dropped onto the body's upper
    envelope plus lift. Returns rows of game Vectors."""
    RHO, TH = np.asarray(RHO, float), np.asarray(TH, float)
    Yh = np.zeros_like(RHO)
    for i in range(RHO.shape[0]):
        for j in range(RHO.shape[1]):
            x = RHO[i, j] * math.sin(TH[i, j])
            z = zc - RHO[i, j] * math.cos(TH[i, j])
            loc, _ = body.ray(Vector((x, 0.9, z)), Vector((0, -1, 0)))
            Yh[i, j] = loc.y if loc is not None else 0.30
    E = envelope(Yh, passes)
    L = np.vectorize(lift)(*np.indices(RHO.shape))
    P = [[Vector((RHO[i, j] * math.sin(TH[i, j]), E[i, j] + L[i, j], zc - RHO[i, j] * math.cos(TH[i, j])))
          for j in range(RHO.shape[1])] for i in range(RHO.shape[0])]
    P = [[body.push_out(p, gap) for p in row] for row in P]
    return P


def cape(ref):
    """CAPE: a stiff mantle collar seated round the neck on the trapezius,
    open at the throat, rolled in steel along its outer edge; from its back
    edge the cape falls past the hips, flaring and standing off the back,
    laid in six deep organ pleats that open toward a steel-weighted hem
    dipping at the middle; at the collar's front ends two clasps with lit
    gems, a cord slung between them across the chest."""
    body = Body(ref)
    objs = []
    zc = -0.022
    # THE MANTLE COLLAR.
    rows, cols = 5, 33
    T0 = 0.62
    th = np.linspace(T0, TAU - T0, cols)

    def rho_out(t):
        side = abs(math.sin(t))
        back = max(0.0, -math.cos(t))
        return 0.150 + 0.050 * side ** 1.5 + 0.022 * back - 0.020 * max(0.0, math.cos(t))

    s = np.linspace(0, 1, rows)
    RHO = np.array([[0.072 + (rho_out(t) - 0.072) * v for t in th] for v in s])
    TH = np.repeat(th[None, :], rows, axis=0)
    thick, gap = 0.008, 0.004

    def lift(i, j):
        return gap + thick + 0.010 * math.sin(math.pi * (0.25 + 0.75 * s[i])) * (0.6 + 0.4 * abs(math.sin(TH[i, j])))

    P = top_grid(body, RHO, TH, lift, zc=zc, gap=gap + thick)
    collar = grid_obj("collar", P, outward=lambda p: Vector((0, 1, 0)))
    gk.solidify(collar, thick, offset=-1)
    gk.bevel(collar, 0.002, segments=2, angle=40)
    objs.append(gk.fin(collar, "shell"))
    # Its rolled outer edge.
    rim = [P[rows - 1][j] - Vector((0, thick * 0.5, 0)) for j in range(cols)]
    rim = resample(rim, step=0.012)
    objs.append(gk.fin(gk.tube("crim", [tuple(p) for p in rim], 0.0060, sides=6, step=0.017), "trim"))

    def collar_edge(t):
        """The outer edge under the rim at angle t (interpolated)."""
        f = (t - T0) / (TAU - 2 * T0) * (cols - 1)
        j = max(0, min(cols - 2, int(f)))
        w = f - j
        return P[rows - 1][j].lerp(P[rows - 1][j + 1], w)

    # THE CAPE.
    nf = 6
    ccols, crows = nf * 5 + 1, 21
    TA = 1.30
    tops = [collar_edge(math.pi - TA + 2 * TA * k / (ccols - 1)) for k in range(ccols)]
    G = []
    for k, T in enumerate(tops):
        u = -1 + 2 * k / (ccols - 1)
        Tp = T + Vector((T.x, 0, T.z - zc)).normalized() * -0.004 - Vector((0, 0.010, 0))
        y_hem = -0.272 - 0.040 * (1 - u * u)
        col = []
        zrun = -1.0
        for i in range(crows):
            v = i / (crows - 1)
            x = Tp.x * (1 + 0.95 * v ** 1.15)
            y = Tp.y + (y_hem - Tp.y) * v
            loc, _ = body.ray(Vector((x, y, 0.8)), Vector((0, 0, -1)))
            zb = (loc.z + 0.010) if loc is not None else -1.0
            zrun = max(zrun, zb, Tp.z if i == 0 else -1.0)
            col.append([x, y, zrun])
        G.append(col)
    G = np.array(G)  # ccols × crows × 3
    Z0 = G[:, :, 2].copy()
    Z = Z0.copy()
    for _ in range(14):
        Zp = np.pad(Z, ((0, 0), (1, 1)), mode="edge")
        Z = np.maximum((Zp[:, :-2] + 2 * Zp[:, 1:-1] + Zp[:, 2:]) / 4, Z0)
        Z[:, 0] = Z0[:, 0]
    Pc = []
    for i in range(crows):
        v = i / (crows - 1)
        row = []
        for k in range(ccols):
            u01 = k / (ccols - 1)
            fold = (0.5 - 0.5 * math.cos(TAU * nf * u01)) ** 0.75
            amp = 0.004 + 0.034 * v ** 1.1
            x, y, _ = G[k, i]
            z = Z[k, i] + 0.055 * v ** 1.6 + amp * fold
            # The folds swing the cloth's edge a little round the sides.
            row.append(Vector((x, y, z)))
        Pc.append(row)
    Pc = [[body.push_out(p, 0.006) for p in row] for row in Pc]
    cloth = grid_obj("cape", Pc, outward=lambda p: Vector((0, 0, 1)))
    gk.solidify(cloth, 0.0055, offset=-1)
    gk.bevel(cloth, 0.0018, segments=1, angle=45)
    objs.append(gk.fin(cloth, "shell"))
    # A weighted steel hem.
    hem = [p - Vector((0, 0, 0.00275)) for p in Pc[-1]]
    hem = resample(hem, step=0.008)
    objs.append(gk.fin(gk.tube("hem", [tuple(p) for p in hem], 0.0048, sides=6, step=0.017), "trim"))

    # THE CLASPS at the collar's front ends, and the cord between them.
    claspL = None
    for sgn in (1,):
        t = T0 + 0.02
        cp = P[2][0] if sgn > 0 else P[2][-1]
        q, n = body.nearest(cp)
        nn = (cp - q).normalized()
        c0 = cp + nn * 0.006
        bez = lathe_at("clasp", [(0.0, 0.006), (0.020, 0.0058), (0.024, 0.004), (0.025, -0.004), (0.020, -0.006), (0.0, -0.006)],
                       c0, nn, segs=24)
        gk.bevel(bez, 0.0008, segments=1, angle=35)
        objs.append(gk.fin(bez, "trim"))
        gem = lathe_at("gem", [(0.0, 0.0115), (0.008, 0.0095), (0.0145, 0.0062), (0.0145, 0.004)], c0, nn, segs=20)
        objs.append(gk.fin(gem, "glow"))
        claspL = c0
    cR = Vector((-claspL.x, claspL.y, claspL.z))
    ctrl = [claspL, Vector((claspL.x * 0.55, claspL.y - 0.030, -0.12)), Vector((0.0, claspL.y - 0.045, -0.13)),
            Vector((-claspL.x * 0.55, claspL.y - 0.030, -0.12)), cR]
    pts, _ = on_body_path(body, ctrl, 0.006, step=0.008)
    pts[0], pts[-1] = claspL, cR
    objs.append(gk.fin(gk.tube("cord", [tuple(p) for p in pts], 0.0042, sides=6, step=0.010), "trim"))
    res = []
    for o in objs:
        res.append(o)
        if o.name in ("clasp", "gem"):
            res.append(gk.mirrored_copy(o))
    return res


# ---------------------------------------------------------------------------
# TABARD — a panel front and back, cinched
# ---------------------------------------------------------------------------

class GridSurf:
    """Ray queries against a grid of game points."""

    def __init__(self, P):
        R, C = len(P), len(P[0])
        verts = [p for row in P for p in row]
        faces = [(i * C + j, i * C + j + 1, (i + 1) * C + j + 1, (i + 1) * C + j) for i in range(R - 1) for j in range(C - 1)]
        self.bvh = BVHTree.FromPolygons(verts, faces)

    def ray(self, o, d):
        loc, nrm, _, _ = self.bvh.ray_cast(Vector(o), Vector(d).normalized())
        if loc is None:
            return None, None
        if nrm.dot(Vector(d)) > 0:
            nrm = -nrm
        return loc, nrm


def tabard_panel(body, sgn, cinch, rows=20, nf=3, per=5):
    """One hanging panel (sgn -1 the front, +1 the back): conformed over
    the chest down to the cinch, gathered into it, then falling free past
    the hips in `nf` folds that deepen to the hem. Returns rows of points
    (top → hem)."""
    cols = nf * per + 1
    ytop = 0.418 if sgn < 0 else 0.428
    YS = [0.42, 0.30, cinch, -0.02, -0.29]
    HW = [0.120, 0.112, 0.076, 0.110, 0.158]
    gap, thick = 0.004, 0.005
    G = np.zeros((rows, cols, 3))
    for i in range(rows):
        t = i / (rows - 1)
        for k in range(cols):
            u = -1 + 2 * k / (cols - 1)
            y_hem = -0.270 - 0.026 * (1 - abs(u))
            yt = ytop - (0.030 if sgn < 0 else 0.014) * (1 - abs(u)) ** 2
            y = yt + (y_hem - yt) * t
            hw = float(np.interp(y, YS[::-1], HW[::-1]))
            x = u * hw
            loc, _ = body.ray(Vector((x, y, sgn * 0.8)), Vector((0, 0, -sgn)))
            d = (loc.z * sgn) if loc is not None else 0.0
            G[i, k] = (x, y, d + gap + thick)
    D0 = np.maximum(envelope(G[:, :, 2], 6), G[:, :, 2])
    # Below the cinch the cloth hangs: never nearer the body than it was
    # anywhere above (down to the cinch).
    ic = int(np.argmin(np.abs(G[:, cols // 2, 1] - cinch)))
    D = D0.copy()
    for i in range(ic + 1, rows):
        D[i] = np.maximum(D[i], D[i - 1])
    # Smooth down the panel, never into the body.
    for _ in range(10):
        Dp = np.pad(D, ((1, 1), (0, 0)), mode="edge")
        D = np.maximum((Dp[:-2] + 2 * Dp[1:-1] + Dp[2:]) / 4, D0)
        D[ic] = D0[ic]
    P = []
    for i in range(rows):
        y_c = G[i, cols // 2, 1]
        below = max(0.0, (cinch - y_c) / (cinch + 0.29))
        above = max(0.0, 1 - (y_c - cinch) / 0.11) if y_c > cinch else 0.0
        amp = 0.034 * below ** 1.0 + 0.006 * above ** 1.5
        drift = 0.020 * below ** 1.6
        row = []
        for k in range(cols):
            u01 = k / (cols - 1)
            fold = (0.5 - 0.5 * math.cos(TAU * nf * u01)) ** 0.8
            x, y, _ = G[i, k]
            dd = D[i, k] + amp * fold + drift
            row.append(Vector((x, y, sgn * dd)))
        P.append(row)
    P = [[body.push_out(p, gap + thick) for p in row] for row in P]
    return P


def tabard(ref):
    """TABARD: a cloth panel down the front and another down the back,
    joined over the shoulders by broad straps; each conforms over the
    chest, is gathered into a steel-plated cinch belt at the waist, then
    falls free past the hips in three deep folds to a weighted steel hem
    with a shallow point; on the chest, the house device — a lit lozenge
    in a steel frame."""
    body = Body(ref)
    objs = []
    cinch = 0.132
    surf = {}
    for sgn, nm in ((-1, "front"), (1, "back")):
        P = tabard_panel(body, sgn, cinch)
        surf[nm] = (P, GridSurf(P))
        o = grid_obj(nm, P, outward=lambda p, sgn=sgn: Vector((0, 0, sgn)))
        gk.solidify(o, 0.005, offset=-1)
        gk.bevel(o, 0.0016, segments=1, angle=45)
        objs.append(gk.fin(o, "shell"))
        # A steel-piped border round the free skirt: up each side to the
        # cinch and along the hem.
        ic = min(range(len(P)), key=lambda i: abs(P[i][0].y - cinch))
        loop = [P[i][0] for i in range(ic, len(P))] + [P[-1][k] for k in range(1, len(P[0]))] +                [P[i][-1] for i in range(len(P) - 2, ic - 1, -1)]
        loop = [p - Vector((0, 0, sgn * 0.0025)) for p in loop]
        loop = resample(loop, step=0.006)
        objs.append(gk.fin(gk.tube(f"hem{nm}", [tuple(p) for p in loop], 0.0046, sides=5, step=0.024), "trim"))

    # THE SHOULDER STRAPS, front panel top to back panel top.
    Pf, Pb = surf["front"][0], surf["back"][0]
    cf = len(Pf[0])
    a_f = Pf[0][cf - 3]
    a_b = Pb[0][cf - 3]
    ctrl = [a_f - Vector((0, 0.03, 0)), a_f + Vector((0, 0.008, 0.01)), Vector((a_f.x * 0.97, 0.447, -0.01)),
            Vector((a_b.x * 0.97, 0.445, 0.04)), a_b + Vector((0, 0.008, -0.01)), a_b - Vector((0, 0.03, 0))]
    pts, nr = on_body_path(body, ctrl, 0.0105, step=0.012)
    st = band("strap", pts, nr, 0.052, 0.0045)
    gk.bevel(st, 0.0012, segments=1, angle=50)
    objs.append(gk.fin(st, "shell"))
    for end, nm in ((pts[2], "f"), (pts[-3], "b")):
        q, n = body.nearest(end)
        objs.append(gk.fin(gk.rivet(f"srv{nm}", tuple(end + n * 0.0045), tuple(n), r=0.0045, h=0.003, segs=8), "trim"))

    # THE CINCH: a steel-plated belt round the waist over both panels.
    rows, cols = 3, 42
    th = np.linspace(0, TAU, cols, endpoint=False)
    y0, y1 = cinch - 0.016, cinch + 0.016
    Y = np.repeat(np.linspace(y0, y1, rows)[:, None], cols, axis=1)
    TH = np.repeat(th[None, :], rows, axis=0)
    pl = Plate(body, Y, TH, lambda i, j: 0.0225 + 0.0015 * math.sin(math.pi * i / (rows - 1)), 0.020, relax=1, wrap_cols=True, env_passes=8)
    cb = pl.obj("cinch")
    gk.solidify(cb, 0.005, offset=-1)
    gk.bevel(cb, 0.0014, segments=1, angle=40)
    objs.append(gk.fin(cb, "trim"))
    c, n = pl.at(cinch, 0.0)
    m = frame_at(c, n)
    bk = gk.extrude_outline("cbuckle", rr_outline(0.060, 0.044, 0.010, n_corner=3), 0.008, m @ _tz(0.003), bevel_w=0.0018, segs=2)
    objs.append(gk.fin(bk, "trim"))
    bar = gk.extrude_outline("cbar", rr_outline(0.038, 0.008, 0.004, n_corner=2), 0.004, m @ _tz(0.0075), bevel_w=0.001, segs=1)
    objs.append(gk.fin(bar, "glow"))

    # THE DEVICE on the chest.
    loc, nrm = surf["front"][1].ray(Vector((0, 0.318, -0.8)), Vector((0, 0, 1)))
    dm = frame_at(loc, nrm)
    lz = lambda w, h: [(0, h / 2), (w / 2, 0), (0, -h / 2), (-w / 2, 0)]
    loc2 = resample([Vector((x, y, 0.0)) for (x, y) in lz(0.074, 0.098)], step=0.013, closed=True)[:-1]
    fr = [Vector(gk.G(dm @ q)) for q in loc2]
    frm = band("device", fr, [nrm] * len(fr), 0.0085, 0.0055, closed=True)
    gk.bevel(frm, 0.0012, segments=1, angle=40)
    objs.append(gk.fin(frm, "trim"))
    gem = lens_blade("devgem", gk.polygon_outline(lz(0.044, 0.062), corner=1), 0.0045, dm @ _tz(0.0015), rings=2, segs=24)
    objs.append(gk.fin(gem, "glow"))
    res = []
    for o in objs:
        res.append(o)
        if o.name.startswith(("strap", "srv")):
            res.append(gk.mirrored_copy(o))
    return res


def _tz(z):
    from mathutils import Matrix
    return Matrix.Translation((0, 0, z))


def _ty(y):
    from mathutils import Matrix
    return Matrix.Translation((0, y, 0))


PIECES = {
    "tabard": dict(slot="body", build=tabard, tex=1024, view=dict(target=(0, 0.10, 0), dist=2.4, yaw=-30, pitch=8)),
    "cape": dict(slot="body", build=cape, tex=1024, view=dict(target=(0, 0.12, 0), dist=2.6, yaw=150, pitch=10)),
    "thrusters": dict(slot="body", build=thrusters, tex=512, view=dict(target=(0, 0.29, 0), dist=2.3, yaw=145, pitch=12)),
    "wings": dict(slot="body", build=wings, tex=1024, view=dict(target=(0, 0.45, 0), dist=3.6, yaw=155, pitch=12)),
    "tail": dict(slot="body", build=tail, tex=512, view=dict(target=(-0.16, 0.05, -0.11), dist=3.0, yaw=-125, pitch=8)),
    "belt": dict(slot="body", build=belt, tex=512, view=dict(target=(0, 0.1, 0), dist=1.9, yaw=-30, pitch=10)),
    "chestplate": dict(slot="body", build=chestplate, tex=512, view=dict(target=(0, 0.31, 0), dist=1.15, yaw=-30, pitch=8)),
}

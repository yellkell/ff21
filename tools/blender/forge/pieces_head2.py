"""
THE HEAD, second set — Forge pieces for the `head` slot (gear.ts):
VISOR BAND, CROWN, ANTLERS, V-CREST, EAR FINS.

Head space (game, metres): the bare skull is the egg of radius 0.13
scaled (0.94, 1.0, 0.97), its centre at y = +0.0065; front is −z. Every
piece is modelled ON that egg, a few millimetres proud of it, and kept on
the cranium (brow, temples, crown, nape) so the per-head fit can carry it
onto the animal heads.
"""

import math

import bmesh
from mathutils import Vector

import gearkit as gk
import kit

R = 0.13
SA, SB, SC = R * 0.94, R * 1.0, R * 0.97  # the egg's semi-axes: x, y, z
YC = R * 0.05  # its centre height


# ---------------------------------------------------------------------------
# The skull
# ---------------------------------------------------------------------------

def _normal(p):
    return Vector((p.x / SA ** 2, (p.y - YC) / SB ** 2, p.z / SC ** 2)).normalized()


def skull_at(theta, y, off=0.0):
    """The egg at height `y` and azimuth `theta` (0 = dead ahead, −z;
    +π/2 = the left temple, +x), pushed `off` out along its normal.
    Returns (point, normal), game space."""
    k = math.sqrt(max(1e-6, 1.0 - ((y - YC) / SB) ** 2))
    p = Vector((SA * k * math.sin(theta), y, -SC * k * math.cos(theta)))
    n = _normal(p)
    return p + n * off, n


def skull_ray(d, off=0.0):
    """Where a ray from the egg's centre along game direction `d` leaves
    it (pushed `off` out along the normal), and the normal there."""
    d = Vector(d).normalized()
    t = 1.0 / math.sqrt((d.x / SA) ** 2 + (d.y / SB) ** 2 + (d.z / SC) ** 2)
    p = d * t + Vector((0.0, YC, 0.0))
    n = _normal(p)
    return p + n * off, n


def skull_gap(p):
    """Signed distance-ish of game point p from the egg (+ outside)."""
    q = Vector(p) - Vector((0.0, YC, 0.0))
    s, _ = skull_ray(q)
    return (Vector(p) - Vector((0.0, YC, 0.0))).length - (s - Vector((0.0, YC, 0.0))).length


# ---------------------------------------------------------------------------
# Mesh helpers (game space in, Blender objects out)
# ---------------------------------------------------------------------------

def _orient(bm, centre):
    """Point every face away from `centre` (game space) on balance."""
    bm.normal_update()
    cb = Vector(kit.to_blender(tuple(centre)))
    out = sum((f.calc_center_median() - cb).dot(f.normal) * f.calc_area() for f in bm.faces)
    if out < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)


def grid(name, P, wrap=False, skip=None, centre=(0.0, YC, 0.0)):
    """A quad sheet through rows of game points P[i][j]; `wrap` closes the
    rows round; `skip(i, j)` drops a face (a window). Faces point away
    from `centre`."""
    bm = bmesh.new()
    Vt = [[bm.verts.new(kit.to_blender(tuple(p))) for p in row] for row in P]
    rows, cols = len(P), len(P[0])
    for i in range(rows - 1):
        for j in range(cols if wrap else cols - 1):
            if skip and skip(i, j):
                continue
            j1 = (j + 1) % cols
            bm.faces.new((Vt[i][j], Vt[i][j1], Vt[i + 1][j1], Vt[i + 1][j]))
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    _orient(bm, centre)
    return gk.obj_from_bm(name, bm)


def loft(name, sections, centre=None, cap0=True, cap1=True):
    """A closed solid through ring sections (each a list of game points,
    all the same length; a one-point section is a tip). Ends capped."""
    bm = bmesh.new()
    rings = [[bm.verts.new(kit.to_blender(tuple(p))) for p in s] for s in sections]
    n = max(len(r) for r in rings)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1:
            for s in range(n):
                bm.faces.new((a[0], b[(s + 1) % n], b[s]))
        elif len(b) == 1:
            for s in range(n):
                bm.faces.new((a[s], a[(s + 1) % n], b[0]))
        else:
            for s in range(n):
                s1 = (s + 1) % n
                bm.faces.new((a[s], a[s1], b[s1], b[s]))
    if cap0 and len(rings[0]) > 2:
        bm.faces.new(list(reversed(rings[0])))
    if cap1 and len(rings[-1]) > 2:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def lin(a, b, n):
    """n values from a to b inclusive."""
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def keymap(j, keys):
    """Piecewise-linear map of a column index through [(j, value), …]."""
    for (j0, v0), (j1, v1) in zip(keys, keys[1:]):
        if j <= j1:
            return v0 + (v1 - v0) * (j - j0) / (j1 - j0)
    return keys[-1][1]


def rounded_rect(w, h, r, n=4):
    """A rounded rectangle outline (local XY, centred), `n` points a corner."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ---------------------------------------------------------------------------
# VISOR BAND
# ---------------------------------------------------------------------------

def visorband(ref):
    """VISOR BAND: a wraparound visor across the eyes — one shell plate,
    tall at the front and tapering into the temples, folded along its
    eye-line into two facets (the brow facet tucked in, the cheek facet
    standing off) with a lit slit cut clean through the fold (the eye: a
    lens set behind the window) — pivoting on machined pods at the temples
    and held by a strap round the back with an adjuster at the nape."""
    objs = []
    GAP, TH = 0.0035, 0.0052
    TMAX = math.radians(100)
    S0, S1 = 0.0040, 0.0165  # the slit, bottom and top (game y)
    POD_Y = 0.0125
    NC = 44

    def bot(th):
        u = abs(th) / TMAX
        arch = 0.0055 * max(0.0, math.cos(th * 4.5)) ** 2 if abs(th) < math.radians(20) else 0.0
        return -0.0215 + (POD_Y - 0.0125 + 0.0215) * u ** 1.7 + arch

    def top(th):
        u = abs(th) / TMAX
        peak = 0.0035 * max(0.0, math.cos(th * 3.0)) ** 2 if abs(th) < math.radians(30) else 0.0
        return 0.0455 - (0.0455 - POD_Y - 0.0125) * u ** 1.8 + peak

    def depth(th):
        # How far the fold stands off the face: most at the front.
        return 0.0016 + 0.0128 * max(0.0, math.cos(th * 0.92)) ** 2

    def prof(th, y):
        # The section: brow facet (top 0.12) → fold at the slit (1.0) →
        # cheek facet (bottom 0.6).
        if y >= S1:
            t = (y - S1) / max(1e-6, top(th) - S1)
            return 1.0 + (0.05 - 1.0) * t
        if y <= S0:
            t = (S0 - y) / max(1e-6, S0 - bot(th))
            return 1.0 + (0.5 - 1.0) * t
        return 1.0

    def off(th, y):
        return GAP + depth(th) * prof(th, y)

    def theta_end(y):
        # The slit's ends are raked: longer along its top edge.
        t = (min(max(y, S0), S1) - S0) / (S1 - S0)
        return math.radians(58 + 7 * t)

    JA = 8

    def col_theta(j, y):
        te = theta_end(y)
        return keymap(j, [(0, -TMAX), (JA, -te), (NC - JA, te), (NC, TMAX)])

    def rows_at(th):
        return lin(bot(th), S0, 3)[:-1] + [S0, S1] + lin(S1, top(th), 4)[1:]

    SLIT_ROW = 2
    P = []
    nrows = len(rows_at(0.0))
    for i in range(nrows):
        row = []
        for j in range(NC + 1):
            th = col_theta(j, 0.5 * (S0 + S1))
            for _ in range(2):  # the column's azimuth depends on height (raked slit ends)
                y = rows_at(th)[i]
                th = col_theta(j, y)
            y = rows_at(th)[i]
            p, _ = skull_at(th, y, off(th, y))
            row.append(p)
        P.append(row)
    visor = grid("visor", P, skip=lambda i, j: i == SLIT_ROW and JA <= j < NC - JA)
    gk.solidify(visor, TH, offset=1.0)
    gk.bevel(visor, 0.0011, segments=1, angle=40)
    objs.append(gk.fin(visor, "shell"))

    # The lens behind the window: a lit sheet inside the plate's thickness.
    L = []
    for y in lin(S0 - 0.0022, S1 + 0.0022, 3):
        row = []
        for th in lin(-theta_end(y) - math.radians(3), theta_end(y) + math.radians(3), 36):
            yy = min(max(y, S0), S1)
            p, _ = skull_at(th, y, off(th, yy) + TH * 0.35)
            row.append(p)
        L.append(row)
    objs.append(gk.fin(grid("lens", L), "glow"))

    # The pods: a machined pivot at each temple over the visor's end.
    pod_th = TMAX - math.radians(6)
    base, n = skull_at(pod_th, POD_Y, off(pod_th, POD_Y) + TH)
    k = 1.35
    prof_pod = [(0.0, 0.0062), (0.0040 * k, 0.0062), (0.0046 * k, 0.0076), (0.0064 * k, 0.0076), (0.0070 * k, 0.0068),
                (0.0110 * k, 0.0056), (0.0130 * k, 0.0034), (0.0139 * k, 0.0013), (0.0139 * k, -0.0075), (0.0, -0.0075)]
    pod = gk.lathe("pod", prof_pod, segs=24, axis_origin=tuple(base), axis=tuple(n), ref=(0, 1, 0))
    gk.bevel(pod, 0.0005, segments=1, angle=30)
    objs.append(gk.fin(pod, "trim"))
    # The pivot screw: a low cap head with a hex socket (the bake's AO).
    screw = gk.lathe("pivot", [(0.0, 0.0069), (0.0016, 0.0069), (0.0016, 0.0076), (0.0032, 0.0080), (0.0040, 0.0074),
                                (0.0041, 0.0062), (0.0, 0.0062)], segs=12, axis_origin=tuple(base), axis=tuple(n), ref=(0, 1, 0))
    objs.append(gk.fin(screw, "trim"))
    # The strap, from pod to pod round the back.
    S = []
    yb = 0.004
    for k in range(2):
        row = []
        for th in lin(pod_th - math.radians(3), 2 * math.pi - pod_th + math.radians(3), 36):
            u = math.sin(max(0.0, min(1.0, (th - pod_th) / (2 * math.pi - 2 * pod_th))) * math.pi)
            yc = POD_Y + (yb - POD_Y) * u
            p, _ = skull_at(th, yc + (-0.0080 if k == 0 else 0.0080), 0.0026)
            row.append(p)
        S.append(row)
    strap = grid("strap", S)
    gk.solidify(strap, 0.0028, offset=1.0)
    gk.bevel(strap, 0.0006, segments=1, angle=40)
    objs.append(gk.fin(strap, "trim"))
    # The adjuster at the nape: a block the strap threads through.
    o, nb = skull_at(math.pi, yb, 0.0026 + 0.0010)
    m = gk.frame_matrix(tuple(o), (1, 0, 0), (0, 1, 0))
    buckle = gk.extrude_outline("buckle", rounded_rect(0.036, 0.024, 0.006), 0.0050, m, center=False)
    gk.bevel(buckle, 0.0011, segments=2, angle=30)
    objs.append(gk.fin(buckle, "trim"))

    out = []
    for ob in objs:
        out.append(ob)
        if ob.name.startswith(("pod", "pivot")):
            out.append(gk.mirrored_copy(ob))
    return out


# ---------------------------------------------------------------------------
# CROWN
# ---------------------------------------------------------------------------

def crown(ref):
    """CROWN: a circlet cut from one heavy sheet — a band resting round
    the crown of the skull, leaning in to hug it, its top edge rising into
    six points that stand up and flare out, the one dead ahead tallest.
    Every point is struck with a centre ridge (two facets, like a cut
    blade); a rolled steel rim runs round the foot; a lit stone in a steel
    bezel sits at the root of each point, and the crown jewel high in the
    front one."""
    objs = []
    GAP, TH = 0.003, 0.0050
    Y0 = 0.054  # the band's foot
    HB = 0.023  # the band's height
    NC = 84
    PEAKS = [0.086, 0.064, 0.053, 0.048, 0.053, 0.064]  # front, then round to +x … back … −x
    W = math.radians(23.5)  # each point's half-width at its root

    def col_theta(j):
        t = 2 * math.pi * j / NC
        return t - 0.55 * math.sin(6 * t) / 6

    def nearest(th):
        k = int(round(th / (math.pi / 3))) % 6
        d = (th - k * math.pi / 3 + math.pi) % (2 * math.pi) - math.pi
        return k, d

    def top(th):
        k, d = nearest(th)
        u = abs(d) / W
        if u < 1.0:
            return HB + PEAKS[k] * (1 - u) ** 1.12
        v = (abs(d) - W) / (math.pi / 3 - 2 * W)
        return HB - 0.0022 * math.sin(math.pi * min(1.0, 0.5 + v))

    def lean(h):
        # Radial offset at height h above the foot: leaning in to hug the
        # skull through the band, then standing up and flaring out.
        s = 0.0
        n = 24
        for i in range(n):
            hh = h * (i + 0.5) / n
            b = smooth01((hh - 0.008) / 0.03)
            s += (-0.46 + 0.86 * b) * h / n
        return s

    def ridge(th, h):
        k, d = nearest(th)
        u = abs(d) / W
        if u >= 1.0:
            return 0.0
        rise = smooth01((h - (HB - 0.005)) / 0.014)
        return 0.0058 * (1 - u) * rise

    def at(th, h, extra=0.0):
        p, n = skull_at(th, Y0, 0.0)
        hn = Vector((n.x, 0.0, n.z)).normalized()
        return p + hn * (GAP + lean(h) + ridge(th, h) + extra) + Vector((0.0, h, 0.0)), hn

    lower = lin(0.0, HB - 0.0045, 3)
    P = []
    for i in range(3 + 4):
        row = []
        for j in range(NC):
            th = col_theta(j)
            if i < 3:
                h = lower[i]
            else:
                t = (i - 2) / 4
                h = lower[-1] + (top(th) - lower[-1]) * t ** 1.2
            row.append(at(th, h)[0])
        P.append(row)
    band = grid("band", P, wrap=True)
    gk.solidify(band, TH, offset=1.0)
    gk.bevel(band, 0.0010, segments=1, angle=35)
    objs.append(gk.fin(band, "shell"))

    # The rolled rim round the foot.
    rim = [tuple(at(2 * math.pi * j / 64, 0.0020, TH + 0.0008)[0]) for j in range(65)]
    objs.append(gk.fin(gk.tube("rim", rim, 0.0033, sides=6, closed_ends=False, step=0.012), "trim"))

    # Stones in bezels: one at the root of each point, the crown jewel
    # high in the front one.
    def stone(name, th, h, rb):
        # A lozenge: a four-sided cut stone, point up, in a steel bezel.
        p, hn = at(th, h, TH)
        up = Vector((0.0, 1.0, 0.0))
        bez = gk.lathe(f"bezel{name}", [(rb * 0.70, 0.0008), (rb * 0.80, 0.0026), (rb * 1.12, 0.0023), (rb * 1.18, 0.0008),
                                        (rb * 1.18, -0.0018), (rb * 0.6, -0.0018)],
                       segs=4, axis_origin=tuple(p), axis=tuple(hn), ref=tuple(up))
        gk.bevel(bez, 0.0005, segments=1, angle=30)
        objs.append(gk.fin(bez, "trim"))
        gem = gk.lathe(f"gem{name}", [(0.0, 0.0040), (rb * 0.42, 0.0035), (rb * 0.78, 0.0020), (rb * 0.80, 0.0), (0.0, 0.0)],
                       segs=4, axis_origin=tuple(p), axis=tuple(hn), ref=tuple(up))
        objs.append(gk.fin(gem, "glow"))

    for k in range(6):
        stone(str(k), k * math.pi / 3, HB * 0.50, 0.0066)
    stone("J", 0.0, HB + 0.022, 0.0098)
    return objs


# ---------------------------------------------------------------------------
# ANTLERS
# ---------------------------------------------------------------------------

def _catmull(P, t):
    """A point on the Catmull-Rom curve through game points P, t ∈ [0, 1]
    (as gearkit.tube samples it)."""
    P = [Vector(p) for p in P]
    f = t * (len(P) - 1)
    i = min(int(f), len(P) - 2)
    u = f - i
    p0, p1 = P[max(i - 1, 0)], P[i]
    p2, p3 = P[i + 1], P[min(i + 2, len(P) - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


def antlers(ref):
    """ANTLERS: a stag's pair. Each rises from a machined pedicle collar
    screwed to the upper temple — a lit coupling ring at its throat — as
    one sweeping beam: up and out, then back, curling in at the tip, with
    a knobbed burr at its root. Off the beam: a brow tine reaching
    forward, a trez tine off the middle, and a fork at the top."""
    objs = []
    base, n = skull_ray((0.55, 0.72, -0.12))
    foot = base + n * 0.002
    collar = gk.lathe("collar", [(0.0, 0.0120), (0.0170, 0.0120), (0.0190, 0.0108), (0.0204, 0.0078), (0.0258, 0.0046),
                                 (0.0272, 0.0020), (0.0272, 0.0), (0.0, 0.0)],
                      segs=20, axis_origin=tuple(foot), axis=tuple(n), ref=(0, 0, -1))
    gk.bevel(collar, 0.0006, segments=1, angle=30)
    objs.append(gk.fin(collar, "trim"))
    a, f, s = gk.dome_frame(n)
    for i in range(4):
        ang = math.pi / 4 + i * math.pi / 2
        d = f * math.cos(ang) + s * math.sin(ang)
        q = foot + d * 0.0232 + n * 0.0052
        objs.append(gk.fin(gk.rivet(f"screw{i}", tuple(q), tuple((n * 0.8 + d * 0.5).normalized()), r=0.0026, h=0.0015, segs=8), "trim"))
    objs.append(gk.fin(gk.ring("coupling", tuple(foot + n * 0.0124), tuple(n), 0.0158, 0.0016, segs=18, sides=5), "glow"))

    beam = [foot + n * 0.004, foot + n * 0.022,
            Vector((0.122, 0.158, -0.010)), Vector((0.160, 0.200, 0.014)), Vector((0.190, 0.246, 0.044)),
            Vector((0.200, 0.290, 0.076)), Vector((0.190, 0.324, 0.104)), Vector((0.166, 0.344, 0.120))]

    def beam_r(t):
        burr = 0.0045 * math.exp(-((t - 0.05) / 0.016) ** 2)
        return 0.0165 * (1 - t) ** 0.78 + 0.0024 + burr

    b = gk.tube("beam", [tuple(p) for p in beam], beam_r, sides=9, scale_xy=(1.0, 0.86), step=0.0068)
    objs.append(gk.fin(b, "shell"))

    def tine(name, t0, pts, r0, rt=0.0015):
        root = _catmull(beam, t0)
        P = [tuple(root)] + [tuple(p) for p in pts]

        cap = beam_r(t0) * 0.8

        def r(t):
            return min(cap, r0 * (1 - t) ** 0.85 + rt + 0.0055 * math.exp(-t / 0.12))
        return gk.fin(gk.tube(name, P, r, sides=8, scale_xy=(1.0, 0.86), step=0.0068), "shell")

    objs.append(tine("brow", 0.18, [Vector((0.128, 0.160, -0.034)), Vector((0.140, 0.176, -0.072)), Vector((0.142, 0.206, -0.100))], 0.0100))
    objs.append(tine("trez", 0.44, [Vector((0.190, 0.228, 0.010)), Vector((0.212, 0.252, -0.022)), Vector((0.220, 0.288, -0.040))], 0.0092))
    objs.append(tine("fork", 0.70, [Vector((0.206, 0.304, 0.068)), Vector((0.216, 0.336, 0.058)), Vector((0.214, 0.370, 0.056))], 0.0082))

    out = []
    for ob in objs:
        out.append(ob)
        out.append(gk.mirrored_copy(ob))
    return out


# ---------------------------------------------------------------------------
# V-CREST
# ---------------------------------------------------------------------------

def skull_patch(name, half_w, y0, y1, off, cols=16, rows=10, top_dip=0.0, theta0=0.0):
    """A plate conformed to the skull: rows from y0 (v = 0) to y1 (v = 1),
    each spanning azimuth ±half_w(v) about theta0, `off` proud (a number or
    off(u, v)); `top_dip` sinks the top edge's middle (a notch)."""
    P = []
    for i in range(rows + 1):
        v = i / rows
        row = []
        for j in range(cols + 1):
            u = -1 + 2 * j / cols
            y = y0 + (y1 - y0) * v - top_dip * v ** 3 * (1 - abs(u)) ** 1.5
            o = off(u, v) if callable(off) else off
            row.append(skull_at(theta0 + u * half_w(v), y, o)[0])
        P.append(row)
    return grid(name, P)


def lozenge(name, centre, normal, up, w, h, depth, table=0.45):
    """A four-sided cut stone: a rhombus girdle (half-width w, half-height
    h) standing `depth` proud along `normal`, a flat table on top."""
    nrm = Vector(normal).normalized()
    upv = Vector(up)
    upv = (upv - nrm * upv.dot(nrm)).normalized()
    side = upv.cross(nrm)
    c = Vector(centre)

    def rh(k, lift):
        return [c + nrm * lift + side * w * k, c + nrm * lift + upv * h * k, c + nrm * lift - side * w * k, c + nrm * lift - upv * h * k]
    return loft(name, [rh(1.0, -0.0015), rh(1.0, depth * 0.35), rh(table, depth)])


def vcrest(ref):
    """V-CREST — the kuwagata of a samurai's helm: a shield EMBLEM on the
    brow, crowned and bevelled, set on a steel mount screwed to the skull,
    a lit cut stone at its heart; and two great blades rising from behind
    it in a V — keeled down the middle, edges eased — sweeping up and out
    and leaning back with the brow, so the wearer's outline grows horns."""
    objs = []
    GAP = 0.003
    MT = 0.0035  # the mount's thickness
    BT = 0.0042  # the blades' half-thickness at the root

    def shield(W):
        def f(v):
            return W * (0.10 + 0.90 * min(1.0, v / 0.62) ** 0.75)
        return f

    E0 = GAP + MT + 2 * BT + 0.0005  # the emblem's back, clear of the blade roots
    mount = skull_patch("mount", shield(math.radians(25.0)), 0.001, 0.094, GAP, cols=14, rows=8, top_dip=0.010)
    gk.solidify(mount, E0 - GAP + 0.0006, offset=1.0)
    gk.bevel(mount, 0.0009, segments=1, angle=35)
    objs.append(gk.fin(mount, "trim"))

    def em_off(u, v):
        return E0 + 0.0042 * (1 - u * u) * math.sin(math.pi * min(1.0, v * 1.1))

    emblem = skull_patch("emblem", shield(math.radians(20.5)), 0.0085, 0.088, em_off, cols=14, rows=8, top_dip=0.008)
    gk.solidify(emblem, 0.0060, offset=1.0)
    gk.bevel(emblem, 0.0012, segments=2, angle=35)
    objs.append(gk.fin(emblem, "shell"))

    # Screws through the mount's border, and the stone.
    for (th, y) in ((math.radians(22.6), 0.088), (-math.radians(22.6), 0.088), (0.0, 0.0045)):
        p, nn = skull_at(th, y, E0)
        objs.append(gk.fin(gk.rivet(f"screw{len(objs)}", tuple(p), tuple(nn), r=0.0024, h=0.0014, segs=8), "trim"))
    yc = 0.054
    p, nn = skull_at(0.0, yc, E0 + 0.0060 + 0.0040)
    bez = lozenge("bezel", p - nn * 0.0012, nn, (0, 1, 0), 0.0125, 0.0185, 0.0030, table=0.8)
    gk.bevel(bez, 0.0006, segments=1, angle=30)
    objs.append(gk.fin(bez, "trim"))
    objs.append(gk.fin(lozenge("stone", p + nn * 0.0012, nn, (0, 1, 0), 0.0090, 0.0140, 0.0050), "glow"))

    # The blades (left, +x; the right is its mirror). A tilted plane leaning
    # back with the brow carries each blade's centreline.
    tilt = math.radians(24)
    N = Vector((0.0, math.sin(tilt), -math.cos(tilt)))  # the blade's face
    root, _ = skull_at(math.radians(4.0), 0.056, GAP + MT + BT)
    up_back = Vector((0.0, math.cos(tilt), math.sin(tilt)))

    def onplane(x, y):
        return root + Vector((x, 0, 0)) + up_back * y

    C = [onplane(0.0, 0.0), onplane(0.026, 0.036), onplane(0.072, 0.092), onplane(0.124, 0.152), onplane(0.165, 0.214), onplane(0.184, 0.272)]
    secs = []
    NS = 16
    for i in range(NS + 1):
        t = i / NS
        c = _catmull(C, t)
        tan = (_catmull(C, min(1, t + 0.01)) - _catmull(C, max(0, t - 0.01))).normalized()
        across = tan.cross(N).normalized()  # toward the blade's outer edge
        if i == NS:
            secs.append([c])
            continue
        w = 0.0215 * (1 - t) ** 0.8 * (0.55 + 0.45 * smooth01(t / 0.32))
        # outer edge bellies out, inner edge runs straighter
        wo, wi = w * 1.18, w * 0.82
        th = BT * (1 - 0.72 * t)
        e = 0.0010 * (1 - t) + 0.0003
        secs.append([c + across * wo + N * e, c + N * th, c - across * wi + N * e,
                     c - across * wi - N * e, c - N * th, c + across * wo - N * e])
    blade = loft("blade", secs)
    gk.bevel(blade, 0.0008, segments=1, angle=30)
    objs.append(gk.fin(blade, "shell"))
    objs.append(gk.mirrored_copy(blade))
    return objs


# ---------------------------------------------------------------------------
# EAR FINS
# ---------------------------------------------------------------------------

def _spline2(ctrl, sharp, per=5):
    """A closed 2D outline through control points: smooth (Catmull-Rom)
    except at indices in `sharp`, which stay crisp corners."""
    n = len(ctrl)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = (Vector(ctrl[(i + k) % n]) for k in (-1, 0, 1, 2))
        if i in sharp:
            p0 = p1 - (p2 - p1)
        if (i + 1) % n in sharp:
            p3 = p2 + (p2 - p1)
        for s in range(per):
            u = s / per
            q = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
            out.append((q.x, q.y))
    return out


OUT_ROOT = 0.016


def _feather(name, root, alpha, L, W, out_off, splay, bend, twist, camber=0.12, th0=0.0062, th1=0.0020, NS=11, NU=5):
    """One feather plate (left side, game space): a spine from `root`
    swept back (+z) and up by `alpha` (bending a further `bend` toward the
    tip), splaying out (+x) by `splay`; a cambered section of real
    thickness (domed outward, edges thinner than the keel) whose upper
    edge twists outward by `twist` toward the tip. Pointed tip."""
    o = Vector((1.0, 0.0, 0.0))
    b = Vector((0.0, 0.0, 1.0))
    u = Vector((0.0, 1.0, 0.0))

    def spine(s):
        a = alpha + bend * s * s
        # integrate the bending direction along the length
        p = Vector(root) + o * (OUT_ROOT + (out_off - OUT_ROOT) * smooth01(s * L / 0.045))
        n = 16
        for i in range(n):
            ss = s * (i + 0.5) / n
            aa = alpha + bend * ss * ss
            d = (b * math.cos(aa) + u * math.sin(aa)) * math.cos(splay) + o * math.sin(splay)
            p = p + d * (L * s / n)
        return p, a

    def width(t):
        # a feather's blade: full from the root's quill out, then an
        # elliptical run-out to a point
        body = 0.45 + 0.55 * smooth01(t / 0.28)
        end = math.sqrt(max(0.0, 1 - ((t - 0.5) / 0.5) ** 2)) if t > 0.5 else 1.0
        return W * body * max(end, 0.0) * (1 - 0.12 * t)

    secs = []
    for i in range(NS + 1):
        t = 1 - (1 - i / NS) ** 1.35  # denser toward the tip's run-out
        c, a = spine(t)
        c2, _ = spine(min(1.0, t + 0.01))
        c1, _ = spine(max(0.0, t - 0.01))
        T = (c2 - c1).normalized()
        W0 = (b * -math.sin(a) + u * math.cos(a))
        W0 = (W0 - T * W0.dot(T)).normalized()  # toward the feather's upper edge
        N0 = T.cross(W0)
        if N0.x < 0:
            N0 = -N0
        tau = -twist * t  # the upper edge rolls in, the face turns up to the light
        Wd = W0 * math.cos(tau) + N0 * math.sin(tau)
        Nd = N0 * math.cos(tau) - W0 * math.sin(tau)
        if i == NS:
            secs.append([c])
            continue
        w = width(t)
        th = th0 + (th1 - th0) * t
        top, bot = [], []
        for k in range(NU + 1):
            v = -1 + 2 * k / NU
            dome = camber * w * (1 - v * v)
            half = th * 0.5 * (1 - 0.55 * v * v)
            top.append(c + Wd * (v * w) + Nd * (dome + half))
            bot.append(c + Wd * (v * w) + Nd * (dome - half))
        secs.append(top + list(reversed(bot))[1:-1])
    ob = loft(name, secs)
    gk.bevel(ob, 0.0007, segments=1, angle=40)
    return ob


def earfins(ref):
    """EAR FINS — a winged helm's: at each temple a heavy machined hub,
    and fanning out of it four feather plates, layered like shingles —
    each cambered, thicker down its keel, twisting along its length — swept
    back and up so the wing breaks the head's outline from the front as
    well as the side. The hub's cap carries a lit ring."""
    objs = []
    base, n = skull_ray((1.0, 0.16, 0.05))
    foot = base + n * 0.0015
    # The hub: a flange screwed to the temple, a drum the feathers are
    # socketed into, a capped face with a lit ring and a centre bolt.
    hub = gk.lathe("hub", [(0.0, 0.0315), (0.0090, 0.0315), (0.0098, 0.0305), (0.0104, 0.0296), (0.0168, 0.0296),
                           (0.0174, 0.0305), (0.0215, 0.0303), (0.0238, 0.0285), (0.0246, 0.0250), (0.0246, 0.0105),
                           (0.0290, 0.0085), (0.0336, 0.0058), (0.0350, 0.0022), (0.0350, 0.0), (0.0, 0.0)],
                   segs=18, axis_origin=tuple(foot), axis=tuple(n), ref=(0, 1, 0))
    gk.bevel(hub, 0.0006, segments=1, angle=30)
    objs.append(gk.fin(hub, "trim"))
    objs.append(gk.fin(gk.ring("ring", tuple(foot + n * 0.0298), tuple(n), 0.0136, 0.0021, segs=20, sides=5), "glow"))
    objs.append(gk.fin(gk.rivet("bolt", tuple(foot + n * 0.0310), tuple(n), r=0.0062, h=0.0030, segs=10), "trim"))
    a, f, s = gk.dome_frame(n)
    for i in range(4):
        ang = math.pi / 4 + i * math.pi / 2
        d = f * math.cos(ang) + s * math.sin(ang)
        q = foot + d * 0.0300 + n * 0.0068
        objs.append(gk.fin(gk.rivet(f"screw{i}", tuple(q), tuple((n * 0.85 + d * 0.5).normalized()), r=0.0026, h=0.0015, segs=8), "trim"))

    # Four feathers, top to bottom; each lower one lies a step further out
    # so it shingles over the edge of the one above.
    hubc = foot + n * 0.0
    feathers = [  # alpha, length, half-width, out, bend, twist
        (math.radians(58), 0.290, 0.0340, 0.0100, math.radians(16), math.radians(12)),
        (math.radians(42), 0.255, 0.0320, 0.0185, math.radians(14), math.radians(11)),
        (math.radians(27), 0.215, 0.0300, 0.0270, math.radians(12), math.radians(10)),
        (math.radians(12), 0.170, 0.0270, 0.0355, math.radians(10), math.radians(8)),
    ]
    for k, (al, L, W, off, bend, tw) in enumerate(feathers):
        objs.append(gk.fin(_feather(f"feather{k}", hubc, al, L, W, off, math.radians(20), bend, tw), "shell"))

    out = []
    for ob in objs:
        out.append(ob)
        out.append(gk.mirrored_copy(ob))
    return out


PIECES = {
    "visorband": dict(slot="head", build=visorband, tex=512, view=dict(target=(0, 0.012, 0), dist=0.98, pitch=6)),
    "crown": dict(slot="head", build=crown, tex=512, view=dict(target=(0, 0.065, 0), dist=1.02, pitch=14)),
    "vcrest": dict(slot="head", build=vcrest, tex=512, view=dict(target=(0, 0.115, 0), dist=1.38, pitch=8)),
    "earfins": dict(slot="head", build=earfins, tex=512, view=dict(target=(-0.03, 0.09, 0.05), dist=1.5, pitch=10)),
    "antlers": dict(slot="head", build=antlers, tex=512, view=dict(target=(0, 0.14, 0), dist=1.38, pitch=10)),
}

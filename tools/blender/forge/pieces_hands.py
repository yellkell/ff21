"""
THE HANDS — Forge pieces for the `hands` slot (gear.ts).

Hand space, the LEFT hand (the right is its mirror in the game): palm at
the origin, fingers toward −z, wrist toward +z, the BACK of the hand +y,
the thumb on +x. The reference is the machined hand itself
(public/arena/hand/hand.glb, tools/blender/hand.py), so every measurement
below is that hand's:

  palm (the back plate)  z −0.036 … +0.047, half-width 0.027 (wrist) →
                         0.0406 (knuckles), its top y ≈ +0.008 … +0.014
  knuckle pivots         FINGERS (below); each finger's housing is a
                         half-round of radius ≈ 0.0085 about its pivot
  wrist collar (steel)   z 0.044 … 0.056, half 0.0262 × (+0.0098, −0.0104)
  forearm stub (coated)  z 0.056 … 0.092, half 0.030 × (+0.0136, −0.0148)
  thumb                  pivot (0.0275, −0.006, 0.019), out and under

The fingers ARTICULATE (curl to −1.45 rad at the knuckle, a hair of
hyperextension, splay about y) and the gear is rigid on the hand root, so
nothing here rides a finger: pieces stay on the back of the hand behind
the knuckle line, on the knuckle housings, the wrist and the forearm, and
keep the palm clear.
"""

import math

import bmesh
from mathutils import Vector

import gearkit as gk
import kit

# Knuckle pivots (game space) and the height of each finger.
FINGERS = [
    ((0.0282, 0.0010, -0.0452), 0.0170),
    ((0.0093, 0.0012, -0.0470), 0.0174),
    ((-0.0095, 0.0008, -0.0458), 0.0168),
    ((-0.0282, -0.0004, -0.0418), 0.0154),
]
KNUCKLE_R = [h * 0.5 * 0.985 for _, h in FINGERS]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _se(hw, top, bot, nt=2.6, nb=2.4):
    """A superellipse section in the hand's xy plane (the hand.py ring):
    half-width hw, from y = bot to y = top, boxier on top. t = 0 is +x (the
    thumb side), t = pi/2 the back of the hand."""
    yc, b = (top + bot) / 2, (top - bot) / 2

    def f(t):
        c, s = math.cos(t), math.sin(t)
        n = nt if s >= 0 else nb
        return hw * math.copysign(abs(c) ** (2 / n), c), yc + b * math.copysign(abs(s) ** (2 / n), s)
    return f


def _lerp_se(z_table):
    """base(t, z) from a table of (z, hw, top, bot, nt, nb) sections."""
    zs = [r[0] for r in z_table]

    def base(t, z):
        if z <= zs[0]:
            i, u = 0, 0.0
        elif z >= zs[-1]:
            i, u = len(zs) - 2, 1.0
        else:
            i = max(k for k in range(len(zs) - 1) if zs[k] <= z)
            u = (z - zs[i]) / (zs[i + 1] - zs[i])
        a, b = z_table[i], z_table[i + 1]
        sec = [a[k] + (b[k] - a[k]) * u for k in range(1, len(a))]
        return _se(*sec)(t)
    return base


def _frame(base, t, z):
    x, y = base(t, z)
    xa, ya = base(t - 1e-4, z)
    xb, yb = base(t + 1e-4, z)
    tx, ty = xb - xa, yb - ya
    ln = math.hypot(tx, ty)
    return x, y, ty / ln, -tx / ln


def _sweep(name, base, profile, t0=0.0, t1=2 * math.pi, segs=32, sharp=False, zmap=None):
    """A band swept round the forearm: `base(t, z)` the inner surface (an
    (x, y) at angle t, axial z), `profile` a CLOSED loop of (d, z) — d out
    from the inner surface along its normal, z along the arm. A partial arc
    (t0..t1) is capped at both ends."""
    full = abs((t1 - t0) - 2 * math.pi) < 1e-6
    n = segs if full else segs + 1
    bm = bmesh.new()
    rows = []
    for (d, z) in profile:
        row = []
        for s in range(n):
            t = t0 + (t1 - t0) * s / segs
            zz = zmap(t, z) if zmap else z
            x, y, nx, ny = _frame(base, t, zz)
            row.append(bm.verts.new(kit.to_blender((x + nx * d, y + ny * d, zz))))
        rows.append(row)
    P = len(rows)
    for i in range(P):
        a, b = rows[i], rows[(i + 1) % P]
        for s in range(segs):
            s1 = (s + 1) % n
            bm.faces.new((a[s], a[s1], b[s1], b[s]))
    if not full:
        bm.faces.new([r[0] for r in rows])
        bm.faces.new([r[-1] for r in rows][::-1])
    if sharp:
        # The profile's corners run round as creases (crisp facets), and
        # the cut ends of an arc are creased all round.
        for row in rows:
            for s in range(segs):
                e = bm.edges.get((row[s], row[(s + 1) % n]))
                if e:
                    e.smooth = False
        if not full:
            for c in (0, n - 1):
                for i in range(P):
                    e = bm.edges.get((rows[i][c], rows[(i + 1) % P][c]))
                    if e:
                        e.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def _point(base, t, z, d):
    """A point `d` out from the inner surface at (t, z), and its normal."""
    x, y, nx, ny = _frame(base, t, z)
    return Vector((x + nx * d, y + ny * d, z)), Vector((nx, ny, 0.0))


def _barrel(name, a, b, r, ch=0.0005, segs=10):
    """A chamfered cylinder between game points a and b (a hinge knuckle,
    a pin, a bolt shank)."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    prof = [(0.0, 0.0), (r - ch, 0.0), (r, ch), (r, L - ch), (r - ch, L), (0.0, L)]
    ax = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(ax.y) < 0.9 else Vector((1, 0, 0))
    return gk.lathe(name, prof, segs=segs, axis_origin=tuple(a), axis=tuple(ax), ref=tuple(ref))


def _screw(name, at, normal, r=0.0019, h=0.0012, segs=10):
    """A socket-head cap screw standing on a surface: a chamfered head with
    its socket sunk in the top."""
    n = Vector(normal).normalized()
    ref = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
    ch = min(0.0004, h * 0.3)
    prof = [(0.0, h - 0.0008), (r * 0.45, h - 0.0008), (r * 0.45, h), (r - ch, h), (r, h - ch), (r, -0.0008), (0.0, -0.0008)]
    return gk.lathe(name, prof, segs=segs, axis_origin=tuple(at), axis=tuple(n), ref=tuple(ref))


def _block(name, outline, depth, origin, x_axis, y_axis, bevel=0.0006, segs=2):
    """A flat outline (local XY) extruded `depth` along local z (x × y) from
    `origin` (game space), its edges bevelled."""
    m = gk.frame_matrix(tuple(origin), tuple(x_axis), tuple(y_axis))
    ob = gk.extrude_outline(name, outline, depth, m, bevel_w=0.0, center=False)
    if bevel > 0:
        gk.bevel(ob, bevel, segments=segs, angle=30)
    return ob


def _rrect(w, h, r, n=3):
    """A rounded rectangle outline, centred, corner radius r."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _basis(axis):
    a = Vector(axis).normalized()
    ref = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((0, 0, -1))
    u = (ref - a * ref.dot(a)).normalized()
    return a, u, a.cross(u)


def _facet_lathe(name, at, axis, rings, n=6, rot=0.0, up=None):
    """A FACETED solid of revolution (a hex nut, a pyramid spike): `rings`
    [(height, radius)] along `axis` from `at`, n flat sides, every face its
    own vertices so the flats stay flat; both ends capped."""
    a, u, v = _basis(axis)
    if up is not None:
        u = Vector(up)
        u = (u - a * u.dot(a)).normalized()
        v = a.cross(u)
    o = Vector(at)
    P = []
    for (h, r) in rings:
        P.append([o + a * h + (u * math.cos(rot + 2 * math.pi * i / n) + v * math.sin(rot + 2 * math.pi * i / n)) * r for i in range(n)])
    bm = bmesh.new()

    def face(pts):
        bm.faces.new([bm.verts.new(kit.to_blender(tuple(p))) for p in pts])
    for k in range(len(P) - 1):
        for i in range(n):
            j = (i + 1) % n
            if rings[k + 1][1] < 1e-6:
                face((P[k][i], P[k][j], P[k + 1][i]))
            else:
                face((P[k][i], P[k][j], P[k + 1][j], P[k + 1][i]))
    face(list(reversed(P[0])))
    if rings[-1][1] > 1e-6:
        face(P[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm, smooth=False)


def _loft(name, path, section, up=(0, 1, 0), closed=False, caps=True, smooth=True, sharp=False):
    """A section swept along a game-space path: `section(t)` gives a CLOSED
    loop of (a, b) — a along the path's side (tangent × up), b along `up`
    (kept square to the tangent) — at t in [0, 1]."""
    P = [Vector(p) for p in path]
    m = len(P)
    upv = Vector(up)
    bm = bmesh.new()
    rows = []
    for i in range(m):
        if closed:
            T = (P[(i + 1) % m] - P[(i - 1) % m]).normalized()
        else:
            T = (P[min(i + 1, m - 1)] - P[max(i - 1, 0)]).normalized()
        U = (upv - T * upv.dot(T)).normalized()
        S = T.cross(U)
        t = i / (m - 1) if not closed else i / m
        rows.append([bm.verts.new(kit.to_blender(tuple(P[i] + S * a + U * b))) for (a, b) in section(t)])
    k = len(rows[0])
    for i in range(m if closed else m - 1):
        r0, r1 = rows[i], rows[(i + 1) % m]
        for j in range(k):
            j1 = (j + 1) % k
            bm.faces.new((r0[j], r0[j1], r1[j1], r1[j]))
    if caps and not closed:
        bm.faces.new(rows[0])
        bm.faces.new(list(reversed(rows[-1])))
    if sharp:
        # Every edge along the path is a crease (the section's facets stay
        # crisp); so is the rim of each cap.
        for i in range(m if closed else m - 1):
            r0, r1 = rows[i], rows[(i + 1) % m]
            for j in range(k):
                e = bm.edges.get((r0[j], r1[j]))
                if e:
                    e.smooth = False
        if caps and not closed:
            for r in (rows[0], rows[-1]):
                for j in range(k):
                    e = bm.edges.get((r[j], r[(j + 1) % k]))
                    if e:
                        e.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm, smooth=smooth)


def _palm_y(ref, x, z, reach=0.004):
    """The top of the hand under (x, z): the highest hit straight down
    there and a few mm round it (so a plate bridges the metacarpal ridges
    instead of following them). None off the hand."""
    best = None
    for dx, dz in ((0, 0), (reach, 0), (-reach, 0), (0, reach), (0, -reach)):
        h = gk.hit(ref, (x + dx, 0.1, z + dz), (0, -1, 0))
        if h is not None and h[0][1] > -0.005:
            best = h[0][1] if best is None else max(best, h[0][1])
    return best


def _conform_plate(name, ref, outline, centre, thick, gap=0.002, rings=6, segs=40, ch=0.0008,
                   crown=0.0, floor=None, lift=None):
    """A plate lying over the back of the hand: `outline(theta) -> (dx, dz)`
    about `centre` (x, z), its underside `gap` over the hand (bridging the
    ridges, smoothed), `thick` deep with a `crown` along y at the middle and
    chamfered edges. `floor(x, z)` gives the underside where the ray finds
    no hand; `lift(x, z)` adds to the underside (a deliberate rise)."""
    cx, cz = centre
    floor = floor or (lambda x, z: 0.010)
    lift = lift or (lambda x, z: 0.0)

    def under(x, z):
        y = _palm_y(ref, x, z)
        return (floor(x, z) if y is None else max(y, floor(x, z) - 0.02)) + gap + lift(x, z)
    TH = [2 * math.pi * s / segs for s in range(segs)]
    OUT = [outline(th) for th in TH]
    RAD = [max(math.hypot(*o), 1e-4) for o in OUT]
    # Underside heights over a grid of rings, then smoothed (never sinking).
    ts = [k / rings for k in range(rings + 1)]
    raw = [[under(cx + OUT[s][0] * t, cz + OUT[s][1] * t) for s in range(segs)] for t in ts]
    raw[0] = [sum(raw[0]) / segs] * segs
    sm = [row[:] for row in raw]
    for _ in range(3):
        nx = [row[:] for row in sm]
        for k in range(rings + 1):
            for s in range(segs):
                nb = [sm[k][(s - 1) % segs], sm[k][(s + 1) % segs], sm[max(k - 1, 0)][s], sm[min(k + 1, rings)][s]]
                nx[k][s] = max((sm[k][s] * 2 + sum(nb)) / 6, raw[k][s])
        sm = nx

    def ybot(k, s):
        return sm[k][s]

    def ytop(k, s, t):
        return sm[k][s] + thick + crown * (1 - t * t)
    bm = bmesh.new()

    def V(x, y, z):
        return bm.verts.new(kit.to_blender((x, y, z)))
    top_rows, bot_rows = [], []
    for k in range(1, rings + 1):
        trow, brow = [], []
        for s in range(segs):
            tin = 1 - ch / RAD[s]
            t = ts[k] * tin
            x, z = cx + OUT[s][0] * t, cz + OUT[s][1] * t
            trow.append(V(x, ytop(k, s, t), z))
            brow.append(V(x, ybot(k, s), z))
        top_rows.append(trow)
        bot_rows.append(brow)
    rim_t, rim_b = [], []
    for s in range(segs):
        x, z = cx + OUT[s][0], cz + OUT[s][1]
        rim_t.append(V(x, ytop(rings, s, 1.0) - ch, z))
        rim_b.append(V(x, ybot(rings, s) + ch * 0.6, z))
    ct = V(cx, ytop(0, 0, 0.0), cz)
    cb = V(cx, ybot(0, 0), cz)
    seq = top_rows + [rim_t, rim_b] + list(reversed(bot_rows))
    for i in range(len(seq) - 1):
        a, b = seq[i], seq[i + 1]
        for s in range(segs):
            s1 = (s + 1) % segs
            bm.faces.new((a[s], a[s1], b[s1], b[s]))
    for s in range(segs):
        s1 = (s + 1) % segs
        bm.faces.new((ct, top_rows[0][s1], top_rows[0][s]))
        bm.faces.new((cb, bot_rows[0][s], bot_rows[0][s1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = gk.obj_from_bm(name, bm)

    def top_at(x, z):
        """The plate's top surface over (x, z) (for seating fittings)."""
        h = gk.hit(ob, (x, 0.2, z), (0, -1, 0))
        return None if h is None else h
    return ob, top_at


def _patch_plate(name, ref, xz, us, vs, height, gap=0.002, floor=None, lift=None, sharp_u=(), sharp_v=(),
                 smooth_passes=3):
    """ARMOUR over the back of the hand, built as a grid: `xz(u, v)` places
    the grid node (u across in us, v along in vs) on the hand, `height(u,
    v)` is the plate's depth there (the facet profile: columns/rows listed
    in sharp_u/sharp_v become crisp creases). The underside rides `gap` over
    the hand (bridging its ridges, smoothed, never sinking); off the hand it
    drops to `floor(x, z)`; `lift(x, z)` raises it on purpose (a plate
    shingled over another). The rim is a short wall, every edge creased."""
    floor = floor or (lambda x, z: 0.006)
    lift = lift or (lambda x, z: 0.0)
    nu, nv = len(us), len(vs)
    XZ = [[xz(u, v) for u in us] for v in vs]
    raw = []
    for j in range(nv):
        row = []
        for i in range(nu):
            x, z = XZ[j][i]
            y = _palm_y(ref, x, z)
            y = floor(x, z) if y is None else max(y, floor(x, z))
            row.append(y + gap + lift(x, z))
        raw.append(row)
    sm = [r[:] for r in raw]
    for _ in range(smooth_passes):
        nx = [r[:] for r in sm]
        for j in range(nv):
            for i in range(nu):
                nb = [sm[j][max(i - 1, 0)], sm[j][min(i + 1, nu - 1)], sm[max(j - 1, 0)][i], sm[min(j + 1, nv - 1)][i]]
                nx[j][i] = max((sm[j][i] * 2 + sum(nb)) / 6, raw[j][i])
        sm = nx
    bm = bmesh.new()
    T, B = [], []
    for j, v in enumerate(vs):
        tr, br = [], []
        for i, u in enumerate(us):
            x, z = XZ[j][i]
            y = sm[j][i]
            br.append(bm.verts.new(kit.to_blender((x, y, z))))
            tr.append(bm.verts.new(kit.to_blender((x, y + height(u, v), z))))
        T.append(tr)
        B.append(br)
    for j in range(nv - 1):
        for i in range(nu - 1):
            bm.faces.new((T[j][i], T[j][i + 1], T[j + 1][i + 1], T[j + 1][i]))
            bm.faces.new((B[j][i], B[j + 1][i], B[j + 1][i + 1], B[j][i + 1]))
    loop = [(0, i) for i in range(nu)] + [(j, nu - 1) for j in range(1, nv)] + \
           [(nv - 1, i) for i in range(nu - 2, -1, -1)] + [(j, 0) for j in range(nv - 2, 0, -1)]
    for k in range(len(loop)):
        (ja, ia), (jb, ib) = loop[k], loop[(k + 1) % len(loop)]
        bm.faces.new((T[ja][ia], B[ja][ia], B[jb][ib], T[jb][ib]))
    bm.edges.ensure_lookup_table()
    sharp = set()
    for k in range(len(loop)):
        (ja, ia), (jb, ib) = loop[k], loop[(k + 1) % len(loop)]
        sharp.add(frozenset((T[ja][ia], T[jb][ib])))
        sharp.add(frozenset((B[ja][ia], B[jb][ib])))
    for i, u in enumerate(us):
        if u in sharp_u:
            for j in range(nv - 1):
                sharp.add(frozenset((T[j][i], T[j + 1][i])))
    for j, v in enumerate(vs):
        if v in sharp_v:
            for i in range(nu - 1):
                sharp.add(frozenset((T[j][i], T[j][i + 1])))
    for e in bm.edges:
        if frozenset(e.verts) in sharp:
            e.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = gk.obj_from_bm(name, bm)

    def top_at(x, z):
        return gk.hit(ob, (x, 0.2, z), (0, -1, 0))
    return ob, top_at


def _pl(x, pts):
    """Piecewise-linear lookup in [(x, y)] (sorted by x)."""
    return _interp(x, pts) if pts[0][0] <= x <= pts[-1][0] else (pts[0][1] if x < pts[0][0] else pts[-1][1])

# ---------------------------------------------------------------------------
# CUFFS — a ring at each wrist (a bracer, not a bangle)
# ---------------------------------------------------------------------------

# The bracer's inner surface: 2 mm clear of the forearm stub all round,
# opening a little toward the elbow.
CUFF_IN = _lerp_se([
    (0.058, 0.0320, 0.0156, -0.0168, 2.6, 2.4),
    (0.094, 0.0330, 0.0162, -0.0176, 2.6, 2.4),
])


def cuffs(ref):
    """CUFFS: a heavy machined bracer closed round the forearm — a lower
    half-shell and two upper quarter-shells with a faceted crest round
    them, the LED channel running down the back between the upper two; a
    steel band at the wrist, a rolled steel rim at the elbow end turned in
    over the forearm, a hinge down the outer (little-finger) edge and a
    lever latch on the thumb side."""
    objs = []
    base = CUFF_IN
    z0, z1 = 0.0570, 0.1000
    T = 0.0058
    g = 0.0007 / 0.033  # the side splits
    gc = 0.0016 / 0.016  # the LED channel: 3.2 mm across the back
    prof = [
        (0.0004, z0), (T - 0.0030, z0), (T - 0.0006, z0 + 0.0034),
        (T, z0 + 0.0120), (T + 0.0013, z0 + 0.0175), (T + 0.0013, z0 + 0.0215), (T - 0.0002, z1 - 0.0060),
        (T - 0.0002, z1 - 0.0016), (T - 0.0018, z1), (-0.0030, z1), (-0.0040, z1 - 0.0010), (-0.0040, z1 - 0.0022),
        (-0.0010, z1 - 0.0060), (0.0, z1 - 0.0080), (0.0, z0 + 0.0004),
    ]
    # The top runs forward over the wrist to a point (the vambrace's
    # tongue): the front of the section is stretched there.
    zk = z0 + 0.0215

    def zmap(t, z):
        return z - 0.0150 * max(0.0, math.sin(t)) ** 6 * max(0.0, min(1.0, (zk - z) / (zk - z0)))
    arcs = [(g, math.pi / 2 - gc, 9), (math.pi / 2 + gc, math.pi - g, 9), (math.pi + g, 2 * math.pi - g, 15)]
    for k, (a, b, n) in enumerate(arcs):
        objs.append(gk.fin(_sweep(f"shell{k}", base, prof, a, b, segs=n, sharp=True, zmap=zmap), "shell"))
    # The LED channel: a lit strip sunk between the upper shells, on a floor
    # that closes the channel from inside.
    zc0, zc1 = z0 + 0.0060, z1 - 0.0060
    lamp = [(T - 0.0034, zc0), (T - 0.0010, zc0 + 0.0010), (T - 0.0010, zc1 - 0.0010), (T - 0.0034, zc1)]
    objs.append(gk.fin(_sweep("lamp", base, lamp, math.pi / 2 - gc * 1.05, math.pi / 2 + gc * 1.05, segs=3, zmap=zmap), "glow"))
    floor = [(0.0002, z0 + 0.0010), (T - 0.0034, z0 + 0.0010), (T - 0.0034, z1 - 0.0040), (0.0002, z1 - 0.0040)]
    objs.append(gk.fin(_sweep("chfloor", base, floor, math.pi / 2 - gc * 1.05, math.pi / 2 + gc * 1.05, segs=3, zmap=zmap), "shell"))
    # Steel: a band at the wrist end, a rolled rim at the elbow end wrapping
    # the shells' turned-in lip; both split at the sides with the shells.
    band = [(T - 0.0016, z0 + 0.0040), (T + 0.0004, z0 + 0.0040), (T + 0.0012, z0 + 0.0048), (T + 0.0014, z0 + 0.0094),
            (T + 0.0006, z0 + 0.0102), (T - 0.0016, z0 + 0.0102)]
    rim = [(T - 0.0010, z1 - 0.0055), (T + 0.0010, z1 - 0.0055), (T + 0.0017, z1 - 0.0047), (T + 0.0017, z1 - 0.0002),
           (T + 0.0009, z1 + 0.0008), (-0.0040, z1 + 0.0008), (-0.0047, z1 + 0.0001), (-0.0047, z1 - 0.0008),
           (-0.0041, z1 - 0.0013), (T - 0.0010, z1 - 0.0013)]
    for j, rp in enumerate((band, rim)):
        for k, (a, b) in enumerate(((g, math.pi - g), (math.pi + g, 2 * math.pi - g))):
            objs.append(gk.fin(_sweep(f"ring{j}{k}", base, rp, a, b, segs=17, sharp=True, zmap=zmap), "trim"))
    zm = (z0 + z1) / 2
    # The hinge down the outer edge (−x): three knuckles on a pin.
    hr = 0.0036
    hp, hn = _point(base, math.pi, zm, T + 0.0006)
    hc = hp + hn * (hr - 0.0016)
    edges = [z0 + 0.0112, z0 + 0.0190, z1 - 0.0136, z1 - 0.0062]
    for i in range(3):
        objs.append(gk.fin(_barrel(f"kn{i}", (hc.x, hc.y, edges[i] + 0.0003), (hc.x, hc.y, edges[i + 1] - 0.0003), hr, ch=0.0006, segs=10), "trim"))
    for e, zz in ((0, edges[0] - 0.0010), (1, edges[-1])):
        objs.append(gk.fin(_barrel(f"pin{e}", (hc.x, hc.y, zz), (hc.x, hc.y, zz + 0.0010), hr * 0.55, ch=0.0003, segs=8), "trim"))
    # The latch on the thumb side (+x): a keeper on the lower shell, a lever
    # over it pivoting on the upper.
    lp, _ = _point(base, 0.0, zm + 0.0020, T + 0.0006)
    keeper = _block("keeper", _rrect(0.0220, 0.0130, 0.0028, n=2), 0.0026, (lp.x - 0.0008, lp.y, lp.z), (0, 0, -1), (0, 1, 0), bevel=0.0006, segs=1)
    objs.append(gk.fin(keeper, "shell"))
    lever = _block("lever", [(-0.0096, 0.0022), (0.0096, 0.0022), (0.0108, 0.0008), (0.0108, -0.0030), (0.0096, -0.0042),
                             (-0.0096, -0.0042), (-0.0108, -0.0030), (-0.0108, 0.0008)],
                   0.0020, (lp.x + 0.0018, lp.y + 0.0012, lp.z), (0, 0, -1), (0, 1, 0), bevel=0.0005, segs=1)
    objs.append(gk.fin(lever, "trim"))
    for s in (-1, 1):
        objs.append(gk.fin(_screw(f"ls{s}", (lp.x + 0.0018, lp.y - 0.0042, lp.z + s * 0.0080), (1, 0, 0), r=0.0014, h=0.0008, segs=8), "trim"))
    return objs


# ---------------------------------------------------------------------------
# The knuckle line — shared by KNUCKLES and CLAWS
# ---------------------------------------------------------------------------

def _interp(x, pts):
    pts = sorted(pts)
    if x <= pts[0][0]:
        (x0, y0), (x1, y1) = pts[0], pts[1]
    elif x >= pts[-1][0]:
        (x0, y0), (x1, y1) = pts[-2], pts[-1]
    else:
        i = max(k for k in range(len(pts) - 1) if pts[k][0] <= x)
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def knuckle_z(x):
    """The knuckle line's z (the pivots' arc: middle furthest forward)."""
    return _interp(x, [(p[0], p[2]) for p, _ in FINGERS])


def knuckle_top(x):
    """The top of the knuckle housings at x."""
    return _interp(x, [(p[0], p[1] + r) for (p, _), r in zip(FINGERS, KNUCKLE_R)])


def _bar_path(x0, x1, n, dz=0.0, lift=0.0026):
    """Points along the knuckle line from x0 to x1 (at the housings' tops
    plus `lift`, `dz` behind the pivots), smoothed a touch."""
    pts = []
    for i in range(n):
        x = x0 + (x1 - x0) * i / (n - 1)
        xc = max(-0.030, min(0.030, x))
        pts.append(Vector((x, knuckle_top(xc) + lift, knuckle_z(xc) + dz)))
    for _ in range(2):
        pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, n - 1)] + [pts[-1]]
    return pts


# ---------------------------------------------------------------------------
# KNUCKLES — four spikes over the fist (a knuckle-duster)
# ---------------------------------------------------------------------------

def knuckles(ref):
    """KNUCKLES: a heavy knuckle-duster bar machined to the knuckle arc,
    riding just over the housings (clear of every finger's curl), braced
    back onto the hand by a ridged saddle; four big faceted steel spikes on
    hex bosses, raked forward into the punch, each seated on a lit washer."""
    objs = []
    path = _bar_path(0.0400, -0.0372, 17, dz=0.0010, lift=0.0024)
    H = 0.0128

    # The bar's section (a forward, b up): a flat sole over the housings, a
    # striking face raked back, a broad crowned top for the spikes.
    def sec(t):
        e = min(t, 1 - t)
        k = 1.0 if e > 0.035 else 0.84 + 0.16 * (e / 0.035)
        pts = [(-0.0080, 0.0012), (-0.0070, 0.0), (0.0034, 0.0), (0.0048, 0.0014), (0.0060, 0.0086),
               (0.0048, 0.0116), (0.0026, H), (-0.0054, H), (-0.0074, 0.0110)]
        return [(a * k, H / 2 + (b - H / 2) * k) for a, b in pts]
    bar = _loft("bar", path, sec, sharp=True)
    objs.append(gk.fin(bar, "shell"))

    # A steel strike plate along the bar's raked front face.
    def strike(t):
        e = min(t, 1 - t)
        k = 1.0 if e > 0.06 else 0.80 + 0.20 * (e / 0.06)
        pts = [(0.0046, 0.0024), (0.0058, 0.0020), (0.0072, 0.0084), (0.0062, 0.0104), (0.0050, 0.0102), (0.0056, 0.0084)]
        return [(a, H / 2 + (b - H / 2) * k) for a, b in pts]
    objs.append(gk.fin(_loft("strike", path[1:-1], strike, sharp=True), "trim"))
    # The saddle: a ridged plate from under the bar's back face down the
    # back of the hand to a chevron tail.
    us = [-1.0, -0.94, -0.45, -0.12, 0.0, 0.12, 0.45, 0.94, 1.0]
    vs = [0.0, 0.06, 0.3, 0.6, 0.9, 1.0]
    hu = _sym([(0.0, 0.0080), (0.12, 0.0080), (0.45, 0.0064), (0.94, 0.0038), (1.0, 0.0014)])

    def xz(u, v):
        hw = 0.0250 + (0.0390 - 0.0250) * v ** 0.8
        x = u * hw
        zr = 0.0060 - 0.0130 * abs(u) ** 1.2
        xc = max(-0.030, min(0.030, x))
        zf = knuckle_z(xc) + 0.0010 + 0.0050
        return x, zr + (zf - zr) * v

    def height(u, v):
        ev = min(1.0, v / 0.06)
        return max(0.0014, _pl(u, hu) * (0.3 + 0.7 * ev) * (0.85 + 0.15 * v))
    saddle, top_at = _patch_plate("saddle", ref, xz, us, vs, height, gap=0.0020, floor=lambda x, z: 0.0070,
                                  sharp_u=(-0.94, -0.45, -0.12, 0.12, 0.45, 0.94), sharp_v=(0.06,))
    objs.append(gk.fin(saddle, "shell"))
    for x in (0.0120, -0.0120):
        h = top_at(x, -0.0110)
        if h:
            objs.append(gk.fin(_screw(f"ss{x:+.3f}", h[0], h[1], r=0.0019, h=0.0010, segs=8), "trim"))
    # Hex bolts through the bar's ends.
    for e, (p, q) in enumerate(((path[0], path[1]), (path[-1], path[-2]))):
        d = (p - q).normalized()
        cen = p + Vector((0, H / 2, -0.0006)) - d * 0.0006
        objs.append(gk.fin(_facet_lathe(f"bolt{e}", tuple(cen), tuple(d), [(0.0, 0.0034), (0.0016, 0.0034), (0.0021, 0.0028)], n=6), "trim"))
    # The spikes: one over each knuckle, raked 36 degrees into the punch.
    rake = math.radians(36)
    ax = Vector((0.0, math.cos(rake), -math.sin(rake)))
    for i, (p, _) in enumerate(FINGERS):
        x = p[0]
        j = min(range(len(path)), key=lambda k: abs(path[k].x - x))
        base = Vector((x, path[j].y + H - 0.0002, path[j].z - 0.0006))
        small = 0.86 if i == 3 else 1.0
        rn = 0.0068 * small
        objs.append(gk.fin(_facet_lathe(f"washer{i}", tuple(base), tuple(ax), [(-0.0008, rn * 1.10), (0.0005, rn * 1.10)], n=6, rot=math.pi / 6), "glow"))
        objs.append(gk.fin(_facet_lathe(f"nut{i}", tuple(base), tuple(ax), [(0.0005, rn), (0.0030, rn), (0.0037, rn * 0.86)], n=6), "trim"))
        hgt = 0.0250 * small
        rs = 0.0054 * small
        objs.append(gk.fin(_facet_lathe(f"spike{i}", tuple(base), tuple(ax),
                                        [(0.0030, rs), (0.0058, rs), (0.0066, rs * 0.90), (hgt * 0.55, rs * 0.50), (hgt, 0.0004)], n=6, rot=math.pi / 6), "trim"))
    return objs


# ---------------------------------------------------------------------------
# GAUNTLETS — a plate over the back of each hand
# ---------------------------------------------------------------------------

def _smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def _sym(pts):
    """Mirror a half profile [(u >= 0, h)] into a full sorted one."""
    return sorted({(-u, h) for u, h in pts} | {(u, h) for u, h in pts})


def gauntlets(ref):
    """GAUNTLETS: heavy machined armour over the back of the hand — a
    ridged back plate wrapping the hand's edges from wrist to knuckles, its
    LED channel sunk between twin crests; a thick knuckle guard shingled
    over its leading edge; a hinge across the wrist to a flared vambrace."""
    objs = []
    # THE BACK PLATE: chevron tail at the wrist, broad over the knuckles,
    # wrapping a few mm past the hand's edges.
    us = [-1.0, -0.95, -0.62, -0.17, -0.11, -0.07, 0.0, 0.07, 0.11, 0.17, 0.62, 0.95, 1.0]
    vs = [0.0, 0.04, 0.16, 0.32, 0.5, 0.68, 0.84, 0.95, 1.0]
    hu = _sym([(0.0, 0.0050), (0.07, 0.0050), (0.11, 0.0074), (0.17, 0.0074), (0.62, 0.0060), (0.95, 0.0036), (1.0, 0.0013)])

    def xz(u, v):
        hw = 0.0300 + (0.0450 - 0.0300) * v ** 0.75
        zr = 0.0505 - 0.0120 * abs(u) ** 1.3
        zf = -0.0290 + 0.0030 * u * u
        return u * hw, zr + (zf - zr) * v

    def height(u, v):
        h = _pl(u, hu) * (1.0 - 0.15 * v)
        ev = min(1.0, min(v, 1 - v) / 0.04)
        return max(0.0013, h * (0.35 + 0.65 * ev) if ev < 1 else h)
    plate, plate_top = _patch_plate("plate", ref, xz, us, vs, height, gap=0.0020, floor=lambda x, z: 0.0045,
                                    sharp_u=(-0.95, -0.62, -0.17, -0.11, -0.07, 0.07, 0.11, 0.17, 0.62, 0.95), sharp_v=(0.04, 0.95))
    objs.append(gk.fin(plate, "shell"))
    # The LED: a lit bar lying in the channel between the crests.
    path = []
    for i in range(12):
        v = 0.06 + 0.86 * i / 11
        x, z = xz(0.0, v)
        h = plate_top(0.0, z)
        if h:
            path.append(Vector((0.0, h[0][1], z)))
    lamp = [(-0.0016, -0.0004), (0.0016, -0.0004), (0.0016, 0.0007), (0.0010, 0.0011), (-0.0010, 0.0011), (-0.0016, 0.0007)]
    objs.append(gk.fin(_loft("lamp", path, lambda t: lamp), "glow"))
    # THE KNUCKLE GUARD: over the housings, its tail lapping the plate, a
    # crest across the knuckles and a steep striking face.
    gus = [-1.0, -0.96, -0.5, 0.0, 0.5, 0.96, 1.0]
    gvs = [0.0, 0.08, 0.30, 0.56, 0.80, 0.94, 1.0]
    hv = [(0.0, 0.0016), (0.08, 0.0040), (0.30, 0.0058), (0.56, 0.0080), (0.80, 0.0070), (0.94, 0.0040), (1.0, 0.0016)]

    def gxz(u, v):
        x = u * (0.0445 - 0.0015 * v)
        xc = max(-0.030, min(0.030, x))
        zb = -0.0225 - 0.0015 * u * u
        zf = knuckle_z(xc) + 0.0010 + 0.0030 * _smooth(0.80, 1.0, abs(u))
        return x, zb + (zf - zb) * v

    def gheight(u, v):
        h = _pl(v, hv)
        eu = min(1.0, (1 - abs(u)) / 0.04)
        return max(0.0016, h * (0.4 + 0.6 * eu))

    def glift(x, z):
        return 0.0068 * _smooth(-0.0335, -0.0285, z)
    guard, guard_top = _patch_plate("guard", ref, gxz, gus, gvs, gheight, gap=0.0020, floor=lambda x, z: 0.0085, lift=glift,
                                    sharp_u=(-0.96, 0.96), sharp_v=(0.08, 0.30, 0.56, 0.80, 0.94), smooth_passes=2)
    objs.append(gk.fin(guard, "shell"))
    # Screws: plate corners and the guard's tail.
    for x, z in ((0.0330, -0.0170), (-0.0330, -0.0160), (0.0215, 0.0320), (-0.0215, 0.0320)):
        h = plate_top(x, z)
        if h:
            objs.append(gk.fin(_screw(f"ps{x:+.3f}{z:+.3f}", h[0], h[1], r=0.0019, h=0.0010, segs=8), "trim"))
    for x in (0.0300, -0.0300):
        h = guard_top(x, -0.0265)
        if h:
            objs.append(gk.fin(_screw(f"gs{x:+.3f}", h[0], h[1], r=0.0017, h=0.0009, segs=8), "trim"))
    # THE VAMBRACE: flared toward the elbow, a crease round its middle,
    # a rolled steel rim at its mouth.
    base = _lerp_se([
        (0.0570, 0.0318, 0.0156, -0.0168, 2.6, 2.4),
        (0.0720, 0.0326, 0.0162, -0.0176, 2.6, 2.4),
        (0.1080, 0.0410, 0.0236, -0.0246, 2.6, 2.4),
    ])
    z0, z1, T = 0.0575, 0.1060, 0.0042
    zk = 0.0740
    prof = [(0.0004, z0), (T - 0.0018, z0), (T, z0 + 0.0020), (T + 0.0012, zk), (T + 0.0002, z1 - 0.0010),
            (0.0, z1 - 0.0010), (0.0, z0 + 0.0004)]
    objs.append(gk.fin(_sweep("cuff", base, prof, segs=30), "shell"))
    rim = [(T - 0.0010, z1 - 0.0044), (T + 0.0010, z1 - 0.0044), (T + 0.0018, z1 - 0.0034), (T + 0.0018, z1 + 0.0002),
           (T + 0.0008, z1 + 0.0012), (-0.0010, z1 + 0.0012), (-0.0016, z1 + 0.0002), (-0.0010, z1 - 0.0016)]
    objs.append(gk.fin(_sweep("rim", base, rim, segs=30), "trim"))
    band = [(T - 0.0010, z0 + 0.0030), (T + 0.0006, z0 + 0.0030), (T + 0.0012, z0 + 0.0036), (T + 0.0014, z0 + 0.0074),
            (T + 0.0008, z0 + 0.0080), (T - 0.0010, z0 + 0.0080)]
    objs.append(gk.fin(_sweep("band", base, band, segs=30), "trim"))
    # The wrist hinge: three knuckles on one pin across the back of the
    # wrist — the middle one the plate's (its tongue), the outer two the
    # vambrace's.
    hy, hz, hr = 0.0158, 0.0538, 0.0040
    for i, (xa, xb) in enumerate(((-0.0190, -0.0068), (-0.0060, 0.0060), (0.0068, 0.0190))):
        objs.append(gk.fin(_barrel(f"hk{i}", (xa, hy, hz), (xb, hy, hz), hr, ch=0.0007, segs=10), "trim"))
    for e, x in ((0, -0.0190), (1, 0.0190)):
        s = 1 if e else -1
        objs.append(gk.fin(_barrel(f"hp{e}", (x, hy, hz), (x + s * 0.0010, hy, hz), hr * 0.55, ch=0.0003, segs=8), "trim"))
    return objs


# ---------------------------------------------------------------------------
# CLAWS — three talons over the knuckles
# ---------------------------------------------------------------------------

def _talon(name, path, h0, w0):
    """A forged talon swept along `path`: a diamond-hex section (a spine
    on top, a keen edge underneath, flat flanks), thinning from the root
    and drawn to a point; every long edge a crease."""
    def sec(t):
        k = (1 - 0.55 * t) * (1.0 if t < 0.82 else max(0.04, (1 - t) / 0.18))
        h, w = h0 * k, w0 * (1 - 0.45 * t) * (1.0 if t < 0.82 else max(0.08, (1 - t) / 0.18))
        return [(0.0, h * 0.50), (w * 0.5, h * 0.22), (w * 0.5, -h * 0.12), (0.0, -h * 0.50),
                (-w * 0.5, -h * 0.12), (-w * 0.5, h * 0.22)]
    return _loft(name, path, sec, sharp=True)


def _resample(pts, n):
    """Catmull-Rom through game points, n evenly spaced in parameter."""
    P = [Vector(p) for p in pts]

    def cr(t):
        f = t * (len(P) - 1)
        i = min(int(f), len(P) - 2)
        u = f - i
        p0, p1 = P[max(i - 1, 0)], P[i]
        p2, p3 = P[i + 1], P[min(i + 2, len(P) - 1)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
    return [cr(i / (n - 1)) for i in range(n)]


def claws(ref):
    """CLAWS: a launcher housing over the back of the hand, rising to a
    deep front face over the knuckles, and three forged talons driven out
    of it through lit gaskets — over the gaps between the fingers, arcing
    forward and hooking down well clear of them however they move."""
    objs = []
    # THE HOUSING: a wedge, shallow at its chevron tail, deep at the front.
    us = [-1.0, -0.95, -0.55, -0.10, -0.06, 0.0, 0.06, 0.10, 0.55, 0.95, 1.0]
    vs = [0.0, 0.05, 0.35, 0.70, 0.90, 1.0]
    hu = _sym([(0.0, 0.84), (0.06, 0.84), (0.10, 1.0), (0.55, 0.93), (0.95, 0.62), (1.0, 0.22)])
    hv = [(0.0, 0.0018), (0.05, 0.0045), (0.35, 0.0070), (0.70, 0.0112), (0.90, 0.0128), (1.0, 0.0108)]

    def xz(u, v):
        x = u * (0.0270 + (0.0430 - 0.0270) * v ** 0.9)
        xc = max(-0.030, min(0.030, x))
        zr = 0.0110 - 0.0120 * abs(u) ** 1.3
        zf = knuckle_z(xc) + 0.0032 + 0.0020 * _smooth(0.8, 1.0, abs(u))
        return x, zr + (zf - zr) * v

    def height(u, v):
        return max(0.0016, _pl(v, hv) * _pl(u, hu))
    house, top_at = _patch_plate("housing", ref, xz, us, vs, height, gap=0.0020, floor=lambda x, z: 0.0085,
                                 sharp_u=(-0.95, -0.55, -0.10, -0.06, 0.06, 0.10, 0.55, 0.95), sharp_v=(0.05, 0.35, 0.70, 0.90))
    objs.append(gk.fin(house, "shell"))
    # The LED in the valley down its spine.
    path = []
    for i in range(10):
        v = 0.08 + 0.78 * i / 9
        x, z = xz(0.0, v)
        h = top_at(0.0, z)
        if h:
            path.append(Vector((0.0, h[0][1], z)))
    lamp = [(-0.0018, -0.0004), (0.0018, -0.0004), (0.0018, 0.0007), (0.0012, 0.0011), (-0.0012, 0.0011), (-0.0018, 0.0007)]
    objs.append(gk.fin(_loft("lamp", path, lambda t: lamp), "glow"))
    for x, z in ((0.0200, 0.0020), (-0.0200, 0.0020)):
        h = top_at(x, z)
        if h:
            objs.append(gk.fin(_screw(f"hs{x:+.3f}", h[0], h[1], r=0.0019, h=0.0010, segs=8), "trim"))
    # THE TALONS, over the gaps between the fingers.
    for i, x in enumerate((0.0188, 0.0, -0.0189)):
        zf = xz(x / 0.043, 1.0)[1]
        h = top_at(x, zf + 0.0030)
        ytop = h[0][1] if h else 0.026
        y0 = ytop - 0.0058
        L = 1.0 if i == 1 else 0.92
        fan = 1.0 + 0.22 * L
        ctrl = [(x, y0 - 0.0010, zf + 0.0080), (x, y0, zf), (x * (1 + (fan - 1) * 0.3), y0 + 0.0060 * L, zf - 0.024 * L),
                (x * (1 + (fan - 1) * 0.7), y0 + 0.0085 * L, zf - 0.050 * L), (x * fan, y0 + 0.0040 * L, zf - 0.070 * L),
                (x * fan * 1.02, y0 - 0.0035 * L, zf - 0.079 * L)]
        pts = _resample(ctrl, 16)
        objs.append(gk.fin(_talon(f"talon{i}", pts, 0.0140, 0.0054), "trim"))
        # Where it leaves the housing: a steel collar on a lit gasket.
        d = (pts[2] - pts[1]).normalized()
        at = pts[1] + d * 0.0002
        objs.append(gk.fin(_facet_lathe(f"gasket{i}", tuple(at - d * 0.0012), tuple(d), [(0.0, 0.0094), (0.0008, 0.0094)], n=4, up=(0, 1, 0)), "glow"))
        objs.append(gk.fin(_facet_lathe(f"collar{i}", tuple(at), tuple(d), [(0.0, 0.0084), (0.0024, 0.0084), (0.0031, 0.0072)], n=4, up=(0, 1, 0)), "trim"))
    return objs


# ---------------------------------------------------------------------------
# WRIST BLADES — a blade along each forearm
# ---------------------------------------------------------------------------

def _zloft(name, zs, section, sharp=True):
    """A loft straight down the hand (−z): `section(z)` gives a closed loop
    of absolute (x, y) at each station z."""
    path = [Vector((0.0, 0.0, z)) for z in zs]
    return _loft(name, path, lambda t: section(zs[0] + (zs[-1] - zs[0]) * t), sharp=sharp)


def wristblades(ref):
    """WRIST BLADES: a long clip-point blade down the outside (little-finger
    edge) of the hand, its root in a faceted carrier that hugs the side of
    the wrist and palm and is clamped to the forearm by a steel band; a lit
    line in the fuller down each flat."""
    objs = []
    XB = -0.0545  # the blade's plane: clear of the little finger fully splayed
    # THE BLADE: spine on top, a long belly to a clipped point.
    z0, z1 = 0.0700, -0.1220
    zs = [z0 + (z1 - z0) * i / 28 for i in range(29)]

    def prof(z):
        t = (z0 - z) / (z0 - z1)
        yt = _pl(t, [(0.0, 0.0112), (0.62, 0.0118), (0.80, 0.0092), (1.0, 0.0012)])
        yb = _pl(t, [(0.0, -0.0120), (0.35, -0.0138), (0.62, -0.0128), (0.82, -0.0088), (0.93, -0.0040), (1.0, 0.0008)])
        w = 0.0052 - 0.0018 * t
        return t, yt, yb, w

    def blade_sec(z):
        t, yt, yb, w = prof(z)
        k = 1.0 if t < 0.985 else 0.15
        h = yt - yb
        hw = w * 0.5 * k
        return [(XB, yb), (XB + hw, yb + h * 0.42), (XB + hw * 0.92, yt - 0.0010), (XB + hw * 0.55, yt),
                (XB - hw * 0.55, yt), (XB - hw * 0.92, yt - 0.0010), (XB - hw, yb + h * 0.42)]
    objs.append(gk.fin(_zloft("blade", zs, blade_sec), "trim"))
    # The lit fuller on each flat.
    fz = [z for z in zs if -0.0780 <= z <= 0.0]

    def fuller(side):
        def f(z):
            t, yt, yb, w = prof(z)
            yc = yb + (yt - yb) * 0.66
            e = min(1.0, (z - fz[-1]) / 0.008, (fz[0] - z) / 0.008 + 1.0)
            hh = 0.0011 * max(0.25, e)
            x0 = XB + side * (w * 0.46 - 0.0003)
            x1 = XB + side * (w * 0.46 + 0.0005)
            return [(x0, yc - hh), (x1, yc - hh * 0.7), (x1, yc + hh * 0.7), (x0, yc + hh)]
        return f
    for side in (-1, 1):
        objs.append(gk.fin(_zloft(f"fuller{side}", fz, fuller(side), sharp=False), "glow"))
    # THE CARRIER: hugging the side of the forearm, the wrist and the palm
    # (3 mm off them), the blade's root sheathed inside it.
    inner = [(0.0960, 0.0330), (0.0560, 0.0330), (0.0460, 0.0335), (0.0300, 0.0378), (0.0080, 0.0408), (-0.0100, 0.0428)]
    cz = [0.0960, 0.0900, 0.0760, 0.0600, 0.0460, 0.0300, 0.0160, 0.0040, -0.0060, -0.0100]
    XO = 0.0640

    def carrier(z):
        xi = _pl(z, sorted(inner))
        hy = _pl(z, [(-0.0100, 0.0150), (0.0300, 0.0162), (0.0960, 0.0178)])
        yc = -0.0006
        e = 1.0
        if z > 0.0930:
            e = 0.86 + 0.14 * (0.0960 - z) / 0.003
        if z < -0.0070:
            e = 0.88
        hy *= e
        xo = xi + (XO - xi) * (0.92 + 0.08 * e)
        pts = [(xi, -hy + 0.0024), (xi + 0.0022, -hy), (xo - 0.0062, -hy), (xo - 0.0016, -hy * 0.34), (xo, 0.0),
               (xo - 0.0016, hy * 0.34), (xo - 0.0062, hy), (xi + 0.0022, hy), (xi, hy - 0.0024)]
        return [(-x, y + yc) for x, y in pts]
    objs.append(gk.fin(_zloft("carrier", cz, carrier), "shell"))
    # The clamp: a steel band round the forearm, its buckle under the
    # carrier.
    band_in = _se(0.0322, 0.0158, -0.0170, 2.6, 2.4)
    za, zb = 0.0680, 0.0840
    bp = [(0.0, za), (0.0024, za), (0.0034, za + 0.0010), (0.0034, zb - 0.0010), (0.0024, zb), (0.0, zb)]
    objs.append(gk.fin(_sweep("clamp", lambda t, z: band_in(t), bp, segs=30), "trim"))
    # Bolts down the carrier's outer face, and a cap screw at the clamp.
    for z in (0.0800, 0.0060):
        for sgn in (1, -1):
            n = Vector((-1.0, sgn * 0.016 / 0.0046 * 0.0 + sgn * 0.33, 0.0)).normalized()
            objs.append(gk.fin(_screw(f"cb{z:+.3f}{sgn}", (-XO + 0.0009, sgn * 0.0060 - 0.0006, z), tuple(n), r=0.0019, h=0.0010, segs=8), "trim"))
    # The throat: a steel lip round the carrier's mouth where the blade
    # leaves it.
    def throat(z):
        return [(-XO + 0.0040, -0.0140), (-0.0428 + 0.0010, -0.0140), (-0.0428 + 0.0010, 0.0136), (-XO + 0.0040, 0.0136), (-XO + 0.0004, 0.0050), (-XO + 0.0004, -0.0060)]
    objs.append(gk.fin(_zloft("throat", [-0.0085, -0.0112], throat), "trim"))
    return objs


PIECES = {
    "cuffs": dict(slot="hands", build=cuffs, tex=512, view=dict(target=(0.0, 0.0, 0.0), dist=0.50, yaw=162, pitch=30)),
    "knuckles": dict(slot="hands", build=knuckles, tex=512, view=dict(target=(0.0, 0.01, 0.0), dist=0.50, yaw=-22, pitch=34)),
    "gauntlets": dict(slot="hands", build=gauntlets, tex=512, view=dict(target=(0.0, 0.01, 0.0), dist=0.52, yaw=-35, pitch=34)),
    "claws": dict(slot="hands", build=claws, tex=512, view=dict(target=(0.0, 0.012, 0.0), dist=0.54, yaw=-24, pitch=32)),
    "wristblades": dict(slot="hands", build=wristblades, tex=512, view=dict(target=(0.0, 0.0, 0.0), dist=0.58, yaw=-62, pitch=28)),
}

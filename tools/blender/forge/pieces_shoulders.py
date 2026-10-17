"""
THE SHOULDERS — Forge pieces for the `shoulders` slot (gear.ts).

Body space (hip-local, front −z). On STANDARD the shoulder ends in a
deltoid CAP: a sphere of radius 0.054 at (±0.198, 0.372, 0.004)
(frames.py) — every pad is built round it, left side first (+x), and the
right is its mirror as its own geometry (its own paint).
"""

import math

from mathutils import Vector

import gearkit as gk
import kit

CAP = Vector((0.198, 0.372, 0.004))
CAP_R = 0.054


# ---------------------------------------------------------------------------
# The PLATE: a faceted, keeled armour plate swept along a drawn spine
# ---------------------------------------------------------------------------

def _spine(segments):
    """Rows along a spine drawn in the body's front plane (x, y): a chain
    of quadratic segments (p0, ctrl, p1, rows, (w0, w1), (k0, k1)); a
    corner where two segments meet stays a corner (a crease row).
    Returns [[point2, tangent2, half-width, keel slope, corner?], …]."""
    out = []
    for si, seg in enumerate(segments):
        p0, c, p1, n, w, k = seg[:6]
        q = seg[6] if len(seg) > 6 else (0.06, 0.06)
        p0, c, p1 = Vector(p0), Vector(c), Vector(p1)
        for i in range(0 if si == 0 else 1, n + 1):
            t = i / n
            p = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t * t * p1
            d = 2 * (1 - t) * (c - p0) + 2 * t * (p1 - c)
            s = t * t * (3 - 2 * t)
            out.append([p, d.normalized(), w[0] + (w[1] - w[0]) * s, k[0] + (k[1] - k[0]) * s, i == n and si < len(segments) - 1,
                        q[0] + (q[1] - q[0]) * s])
    for i in range(1, len(out) - 1):
        if out[i][4]:
            out[i][1] = (out[i + 1][0] - out[i - 1][0]).normalized()
    return out


def _plate(name, segments, ref, nv=10, clear=0.011, chevron=0.0, lip=0.0, pivot=(0.17, 0.33), z0=0.0,
           rows_slice=None, vspan=1.0, lift=0.0, ends=None):
    """A keeled armour plate: rows along the spine, columns fore and aft
    (v −1 front … +1 back) falling away from a sharp keel at v = 0 in two
    planes (slope k), curling round (q) toward the edges. `chevron` draws the last segment's edge back into a
    V pointing down the keel; `lip` the first segment's edge likewise.
    Anything that would come within `clear` of the body (thickness + gap)
    is eased out onto it. Returns (object, grid points, grid normals)."""
    import bmesh
    rows = _spine(segments)
    last = segments[-1][3]
    first = segments[0][3]
    if rows_slice is not None:
        # A plate laid over part of another's spine (a layered plate).
        rows = rows[rows_slice[0]:rows_slice[1]]
        first, last = ends
    O = Vector((pivot[0], pivot[1]))
    nr = len(rows)
    G = []
    for i, (p, t, w, k, _c, k2) in enumerate(rows):
        nrm = Vector((t.y, -t.x))
        if nrm.dot(p - O) < 0:
            nrm = -nrm
        row = []
        for j in range(nv + 1):
            v = (-1 + 2 * j / nv) * vspan
            drop = w * (k * abs(v) + k2 * v * v) - lift
            # Fall toward the pivot (not along the spine's normal), so a
            # tight corner never folds over itself at the edges.
            q = p - (p - O).normalized() * drop
            if chevron and i > nr - 1 - last:
                s = (i - (nr - 1 - last)) / last
                q = q - t * chevron * abs(v) * s
            if lip and i < first:
                s = 1 - i / first
                q = q + t * lip * abs(v) * s
            row.append(Vector((q.x, q.y, z0 + v * w)))
        G.append(row)
    # Ease out of the body: push, blur the push, push again.
    D = [[Vector() for _ in r] for r in G]
    for it in range(4):
        for i in range(nr):
            for j in range(nv + 1):
                p = G[i][j] + D[i][j]
                sp = gk.surface_point(ref, tuple(p))
                if sp is None:
                    continue
                q, n = Vector(sp[0]), Vector(sp[1])
                d = (p - q).dot(n)
                if d < clear:
                    D[i][j] = D[i][j] + n * (clear - d)
        if it == 3:
            break
        B = []
        for i in range(nr):
            br = []
            for j in range(nv + 1):
                acc, wsum = D[i][j] * 2, 2.0
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a, b = i + di, j + dj
                    if 0 <= a < nr and 0 <= b <= nv:
                        acc = acc + D[a][b]
                        wsum += 1
                br.append(acc / wsum)
            B.append(br)
        D = [[B[i][j] if B[i][j].length > D[i][j].length * 0.5 else D[i][j] for j in range(nv + 1)] for i in range(nr)]
    G = [[G[i][j] + D[i][j] for j in range(nv + 1)] for i in range(nr)]
    bm = bmesh.new()
    V = [[bm.verts.new(kit.to_blender(tuple(G[i][j]))) for j in range(nv + 1)] for i in range(nr)]
    for i in range(nr - 1):
        for j in range(nv):
            bm.faces.new((V[i][j], V[i][j + 1], V[i + 1][j + 1], V[i + 1][j]))
    bm.normal_update()
    piv = Vector(kit.to_blender((pivot[0], pivot[1], 0.0)))
    if sum((f.calc_center_median() - piv).dot(f.normal) * f.calc_area() for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    ob = gk.obj_from_bm(name, bm)
    P0 = Vector((pivot[0], pivot[1], 0.0))
    N = []
    for i in range(nr):
        rown = []
        for j in range(nv + 1):
            du = G[min(i + 1, nr - 1)][j] - G[max(i - 1, 0)][j]
            dv = G[i][min(j + 1, nv)] - G[i][max(j - 1, 0)]
            n = du.cross(dv).normalized()
            if n.dot(G[i][j] - P0) < 0:
                n = -n
            rown.append(n)
        N.append(rown)
    return ob, G, N


def _plate_finish(ob, thick=0.007, bevel=0.0022):
    gk.solidify(ob, thick, offset=-1)
    gk.bevel(ob, bevel, segments=2, angle=28)
    return ob


def _row_pts(G, N, row, inset=0.0, lift=0.0, j0=0, j1=None):
    """Points along one row of a plate grid, pushed `lift` along the
    normal and `inset` toward the neighbouring row."""
    j1 = len(G[row]) - 1 if j1 is None else j1
    nb = G[row + 1] if row + 1 < len(G) else G[row - 1]
    return [G[row][j] + (nb[j] - G[row][j]).normalized() * inset + N[row][j] * lift for j in range(j0, j1 + 1)]


def pauldrons(ref):
    """PAULDRONS: the hero's pauldron. One big sweeping plate rises off the
    collarbone behind a flared GORGET LIP hinged to it, runs over the top
    of the shoulder to a peaked corner well past the cap and sweeps down
    the outer arm line — two planes falling away from a sharp keel and
    curling round the arm, every edge a thick bevelled plate edge, the
    foot drawn into a V down the keel. Two lames below, each tucked under
    the one above and flaring further out, pivot on rivets at their ends.
    A lit seam runs under the corner in a steel frame; a rivet line holds
    the foot."""
    objs = []
    th = 0.008
    # The primary plate's spine (front view, +x side): the gorget lip
    # (flat across, so its hinge is straight), the top plane rising to the
    # corner, a tight turn, the outer face, its flared foot.
    prim = [
        ((0.126, 0.494), (0.12, 0.458), (0.144, 0.443), 3, (0.056, 0.064), (0.0, 0.0), (0.0, 0.0)),
        ((0.144, 0.443), (0.215, 0.44), (0.272, 0.468), 6, (0.064, 0.112), (0.0, 0.3), (0.0, 0.07)),
        ((0.272, 0.468), (0.292, 0.473), (0.302, 0.452), 2, (0.112, 0.116), (0.3, 0.32), (0.07, 0.12)),
        ((0.302, 0.452), (0.33, 0.41), (0.334, 0.352), 4, (0.116, 0.1), (0.32, 0.38), (0.12, 0.2)),
        ((0.334, 0.352), (0.336, 0.334), (0.35, 0.322), 2, (0.1, 0.094), (0.38, 0.38), (0.2, 0.2)),
    ]
    plate, G, N = _plate("plate", prim, ref, nv=10, clear=th + 0.004, chevron=0.026)
    objs.append(gk.fin(_plate_finish(plate, th, 0.003), "shell"))
    nr = len(G)
    # The gorget lip's edge rolled in steel.
    lip = _row_pts(G, N, 0, inset=0.0015, lift=-th * 0.5)
    objs.append(gk.fin(gk.tube("lip", [tuple(p) for p in lip], 0.0052, sides=8, step=0.008), "trim"))
    # The hinge where the lip turns up off the plate: a straight barrel in
    # three knuckles, its pin capped at both ends.
    hrow = 3
    a = G[hrow][0] + N[hrow][0] * 0.0035
    b = G[hrow][-1] + N[hrow][-1] * 0.0035
    for k, (t0, t1) in enumerate(((0.06, 0.32), (0.36, 0.64), (0.68, 0.94))):
        objs.append(gk.fin(gk.tube(f"hinge{k}", [tuple(a.lerp(b, t0)), tuple(a.lerp(b, t1))], 0.0052, sides=8, step=0.02), "trim"))
    for k, t in enumerate((0.03, 0.97)):
        objs.append(gk.fin(gk.tube(f"pin{k}", [tuple(a.lerp(b, t - 0.03)), tuple(a.lerp(b, t + 0.03))], 0.0026, sides=6, step=0.02), "trim"))
    # The lit seam: a slot across the outer face under the corner, framed.
    sr = 12
    seam = _row_pts(G, N, sr, lift=0.0004, j0=1, j1=9)
    objs.append(gk.fin(gk.tube("seam", [tuple(p) for p in seam], 0.0021, sides=6, scale_xy=(1.0, 0.55), step=0.012), "glow"))
    for k, nb in enumerate((sr - 1, sr + 1)):
        fr = [G[sr][j] + (G[nb][j] - G[sr][j]).normalized() * 0.0045 + N[sr][j] * 0.0006 for j in range(1, 10)]
        objs.append(gk.fin(gk.tube(f"seamf{k}", [tuple(p) for p in fr], 0.0017, sides=5, step=0.016), "trim"))
    # The rivet line along the foot.
    fr_ = nr - 3
    for j in (1, 3, 7, 9):
        objs.append(gk.fin(gk.rivet(f"rv{j}", tuple(G[fr_][j]), tuple(N[fr_][j]), r=0.0036, h=0.0026, segs=8), "trim"))

    # Two lames below, each tucked under the one above and flaring out.
    lames = [
        [((0.318, 0.37), (0.338, 0.326), (0.352, 0.296), 4, (0.104, 0.1), (0.34, 0.34), (0.2, 0.2)),
         ((0.352, 0.296), (0.355, 0.288), (0.366, 0.28), 1, (0.1, 0.098), (0.34, 0.34), (0.2, 0.2))],
        [((0.334, 0.326), (0.352, 0.282), (0.364, 0.256), 4, (0.096, 0.09), (0.34, 0.34), (0.2, 0.2)),
         ((0.364, 0.256), (0.367, 0.248), (0.378, 0.24), 1, (0.09, 0.088), (0.34, 0.34), (0.2, 0.2))],
    ]
    for k, segs in enumerate(lames):
        lm, LG, LN = _plate(f"lame{k}", segs, ref, nv=10, clear=th + 0.004, chevron=0.022)
        objs.append(gk.fin(_plate_finish(lm, 0.0065, 0.0024), "shell"))
        for j in (1, 9):
            objs.append(gk.fin(gk.rivet(f"lr{k}{j}", tuple(LG[2][j]), tuple(LN[2][j]), r=0.0044, h=0.003, segs=10), "trim"))
    return _pairs(objs)


# ---------------------------------------------------------------------------
# Shared helpers for the rest of the shelf
# ---------------------------------------------------------------------------

def _sweep(name, P, N, section, closed=True, scale=None):
    """Sweep a closed 2-D `section` [(x across, y along N), …] along the
    game-space points P, each ring's 'up' the matching N; `scale(t)` →
    (sx, sy) tapers it. Open paths are capped flat."""
    import bmesh
    n = len(P)
    P = [Vector(p) for p in P]
    N = [Vector(v) for v in N]
    bm = bmesh.new()
    rings = []
    for i in range(n):
        if closed:
            T = P[(i + 1) % n] - P[(i - 1) % n]
        else:
            T = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        T.normalize()
        up = (N[i] - T * N[i].dot(T)).normalized()
        side = T.cross(up)
        k = scale(i / (n - 1)) if scale else (1.0, 1.0)
        rings.append([bm.verts.new(kit.to_blender(tuple(P[i] + side * x * k[0] + up * y * k[1]))) for (x, y) in section])
    m = len(section)
    for i in range(n if closed else n - 1):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(m):
            j1 = (j + 1) % m
            bm.faces.new((a[j], a[j1], b[j1], b[j]))
    if not closed:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def _cap(name, centre, axis, radius, rimfn, segs=36, rows=8, shape=None, target=None, gap=0.006):
    """A dome patch about `axis` whose rim runs at a DRAWN polar angle
    rimfn(theta) (theta 0 = the front) — and, given a `target`, stops
    `gap` short of the body wherever the body comes up to meet it first
    (as gk.trimmed_dome, but the designed edge leads and the body only
    trims). Returns (object, rim(theta) -> phi, point(phi, theta))."""
    import bmesh
    c = Vector(centre)
    shape = shape or (lambda ph, th: 1.0)

    def pt(ph, th):
        return c + gk.dome_dir(axis, ph, th) * radius * shape(ph, th)

    lim = []
    for k in range(segs):
        th = 2 * math.pi * k / segs
        pm = rimfn(th)
        ph = pm
        if target is not None:
            steps = 40
            for i in range(1, steps + 1):
                p = pm * i / steps
                if gk.inside(target, tuple(pt(p, th)), gap):
                    ph = pm * (i - 1) / steps
                    break
        lim.append(max(ph, math.radians(8)))
    if target is not None:
        # Where the body trims the edge, ease it into a broad, shallow
        # scallop instead of a notch: erode (a running minimum), blur,
        # and never let it out past where the body stopped it.
        w = max(1, segs // 10)
        orig = lim[:]
        er = [min(orig[(k + j) % segs] for j in range(-w, w + 1)) for k in range(segs)]
        for _ in range(w * 2):
            er = [(er[(k - 1) % segs] + 2 * er[k] + er[(k + 1) % segs]) / 4 for k in range(segs)]
        lim = [min(x, y) for x, y in zip(er, orig)]
        for _ in range(2):
            lim = [(lim[(k - 1) % segs] + 2 * lim[k] + lim[(k + 1) % segs]) / 4 for k in range(segs)]

    bm = bmesh.new()
    top = bm.verts.new(kit.to_blender(tuple(pt(0.0, 0.0))))
    grid = []
    for i in range(1, rows + 1):
        grid.append([bm.verts.new(kit.to_blender(tuple(pt(lim[k] * i / rows, 2 * math.pi * k / segs)))) for k in range(segs)])
    for k in range(segs):
        bm.faces.new((top, grid[0][(k + 1) % segs], grid[0][k]))
    for i in range(rows - 1):
        for k in range(segs):
            k1 = (k + 1) % segs
            bm.faces.new((grid[i][k], grid[i][k1], grid[i + 1][k1], grid[i + 1][k]))
    bm.normal_update()
    cb = Vector(kit.to_blender(tuple(c)))
    if sum((f.calc_center_median() - cb).dot(f.normal) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)

    def rim(theta):
        t = (theta % (2 * math.pi)) / (2 * math.pi) * segs
        k0 = int(t) % segs
        u = t - int(t)
        return lim[k0] * (1 - u) + lim[(k0 + 1) % segs] * u

    return gk.obj_from_bm(name, bm), rim, pt


def _rimfn(ax, phi_out, phi_in, phi_fb=None, sharp=1.0):
    """A drawn rim: deep (phi_out) over the arm, short (phi_in) at the
    neck, phi_fb fore and aft (default between)."""
    out = _out_dir(ax)
    th_out = _theta_of(ax, out)
    if phi_fb is None:
        phi_fb = 0.5 * (phi_out + phi_in)

    def f(th):
        c = math.cos(th - th_out)
        if c >= 0:
            w = c ** sharp
            return phi_fb + (phi_out - phi_fb) * w
        w = (-c) ** sharp
        return phi_fb + (phi_in - phi_fb) * w
    return f


def _grid(name, fn, nu, nv, closed_u=False):
    """A quad sheet over fn(u, v) → game point, u, v ∈ [0, 1]."""
    import bmesh
    bm = bmesh.new()
    cols = nu if closed_u else nu + 1
    rows = [[bm.verts.new(kit.to_blender(tuple(fn(i / nu, j / nv)))) for i in range(cols)] for j in range(nv + 1)]
    for j in range(nv):
        for i in range(nu):
            i1 = (i + 1) % cols
            bm.faces.new((rows[j][i], rows[j][i1], rows[j + 1][i1], rows[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gk.obj_from_bm(name, bm)


def _orient_out(ob, toward):
    """Flip a sheet so its faces point toward game direction `toward` on
    average (solidify then grows the thickness away from it)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    t = Vector(kit.to_blender(tuple(toward)))
    if sum(f.normal.dot(t) * f.calc_area() for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _orient_from(ob, centre):
    """Flip a sheet so its faces point away from game point `centre`."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    cb = Vector(kit.to_blender(tuple(centre)))
    if sum((f.calc_center_median() - cb).dot(f.normal) * f.calc_area() for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _qbez(p0, c, p1, n):
    out = []
    for i in range(1, n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]))
    return out


def _stud(name, p, n, r=0.0085, objs=None):
    """A lit stud: a machined steel bezel ring round a glowing lens."""
    p = Vector(p)
    n = Vector(n).normalized()
    bez = gk.ring(name + "_bz", tuple(p + n * 0.0012), tuple(n), r + 0.0018, 0.0026, segs=16, sides=5)
    lens = gk.rivet(name, tuple(p + n * 0.0008), tuple(n), r=r, h=0.0042, segs=14)
    objs.append(gk.fin(bez, "trim"))
    objs.append(gk.fin(lens, "glow"))


def _rim_frames(pt, rim, ax, n=48, inset=0.0, lift=0.0):
    """Points round a dome's rim with their outward normals and the
    meridian direction (down the dome)."""
    P, Nn, M = [], [], []
    for i in range(n):
        th = 2 * math.pi * i / n
        ph = rim(th) - inset
        d = gk.dome_dir(ax, ph, th)
        p = pt(ph, th)
        q = pt(ph + 0.01, th)
        m = (q - p).normalized()
        nn = (d - m * d.dot(m)).normalized()
        P.append(p + nn * lift)
        Nn.append(nn)
        M.append(m)
    return P, Nn, M


def _pairs(objs):
    out = []
    for o in objs:
        out.append(o)
        out.append(gk.mirrored_copy(o))
    return out


def _tilt(rad):
    """A pad axis tipped out over the arm by `rad` from vertical (+x side)."""
    return Vector((math.sin(rad), math.cos(rad), 0.0))


def _out_dir(ax):
    o = Vector((1.0, 0.0, 0.0))
    return (o - ax * o.dot(ax)).normalized()


def _theta_of(ax, d):
    """The dome azimuth (theta, 0 = front) of a direction d."""
    a, f, s = gk.dome_frame(ax)
    return math.atan2(d.dot(s), d.dot(f))


# ---------------------------------------------------------------------------
# WARLORD
# ---------------------------------------------------------------------------

def _flame_outline(h, lean=1.0, sub=3):
    """A forged flame tongue, root across the origin, the main tip leaning
    out (+x) with two licks peeling off its outer edge: a closed outline
    (local XY, metres) smoothed through hand-set stations."""
    # Unit stations (height 1): up the inner edge to the tip, then down
    # the outer edge in and out of the two licks.
    st = [(-0.25, 0.0), (-0.27, 0.2), (-0.21, 0.42), (-0.09, 0.64), (0.06, 0.83), (0.2, 1.0),
          (0.16, 0.8), (0.07, 0.6), (0.2, 0.68), (0.31, 0.8),
          (0.27, 0.6), (0.17, 0.43), (0.31, 0.47), (0.42, 0.58),
          (0.4, 0.36), (0.29, 0.17), (0.26, 0.0), (0.0, -0.06)]
    sharp = {5, 9, 13}
    P = [Vector((x * h * lean if x > 0 else x * h, y * h, 0.0)) for (x, y) in st]
    n = len(P)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        out.append((p1.x, p1.y))
        if i in sharp or (i + 1) % n in sharp:
            # Straight into and out of a tip, so it stays a tip.
            for k in range(1, sub):
                q = p1.lerp(p2, k / sub)
                out.append((q.x, q.y))
            continue
        for k in range(1, sub):
            u = k / sub
            q = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
            out.append((q.x, q.y))
    return out


def warlord(ref):
    """WARLORD: the raid-boss paladin's pauldron — a GREAT round dome turned
    out to face the room like a shield on the shoulder, low-crowned and
    flaring at the lip, its whole edge rolled in heavy steel over a ring
    of rivets; a crest of three forged flame tongues rising off its top
    (each with a lit vein, the fire inside the steel); a flared lame of
    steel stepping out from under the rim down the arm; a lit stud in a
    bezel fore and aft."""
    objs = []
    ax = _tilt(math.radians(50))
    c = Vector((0.226, 0.37, 0.0))
    R = 0.13
    rim_r = 0.0085
    a, f, sd = gk.dome_frame(ax)
    out = _out_dir(ax)
    th_out = _theta_of(ax, out)
    th_in = th_out + math.pi

    def shape(ph, th):
        # A low crown (an ellipse in section, flatter along the axis) and
        # a lip that flares out like a bell: a forged bowl, not a ball.
        e = 1.0 / math.sqrt((math.cos(ph) / 0.78) ** 2 + math.sin(ph) ** 2)
        return e * (1.0 + 0.08 * (ph / math.radians(90)) ** 5)

    # Deep over the neck side (the body trims it where it lands on the
    # trapezius), shallower over the arm.
    rimfn = _rimfn(ax, math.radians(84), math.radians(124), math.radians(96))
    dome, rim, pt = _cap("dome", c, ax, R, rimfn, segs=32, rows=9, shape=shape, target=ref, gap=0.006 + rim_r)
    gk.solidify(dome, 0.006, offset=-1)
    gk.bevel(dome, 0.0018, segments=1, angle=40)
    objs.append(gk.fin(dome, "shell"))

    # The heavy rolled rim: a round bead on the edge, rolled outward.
    P, Nn, M = _rim_frames(pt, rim, ax, n=40, lift=rim_r * 0.35)
    sec = [(rim_r * math.cos(2 * math.pi * k / 7), rim_r * math.sin(2 * math.pi * k / 7)) for k in range(7)]
    objs.append(gk.fin(_sweep("rim", P, Nn, sec, closed=True), "trim"))
    # A ring of rivets just inside it (what holds the roll on).
    for i in range(8):
        th = 2 * math.pi * (i + 0.5) / 8
        ph = rim(th) - math.radians(8)
        objs.append(gk.fin(gk.rivet(f"rv{i}", tuple(pt(ph, th)), tuple(gk.dome_dir(ax, ph, th)), r=0.0038, h=0.0028, segs=6), "trim"))

    # The lame: a steel band stepping out from under the rim down the
    # arm, flaring, its lower edge a rounded tongue, beaded.
    half = math.radians(56)

    def lame(u, v):
        az = -half + 2 * half * u
        th = th_out + az
        ph_top = rim(th) - math.radians(14)
        # Square-shouldered, its corners rounded off.
        tongue = max(0.0, math.cos(az / half * math.pi / 2)) ** 0.3
        ph = ph_top + (math.radians(4) + math.radians(30) * tongue) * v
        rr = R * shape(ph_top, th) * (0.935 + 0.2 * v)
        return c - a * 0.004 + gk.dome_dir(ax, ph, th) * rr

    lm = _grid("lame", lame, 14, 4)
    _orient_from(lm, c)
    gk.solidify(lm, 0.005, offset=-1)
    gk.bevel(lm, 0.0016, segments=1, angle=40)
    objs.append(gk.fin(lm, "trim"))
    edge = [lame(i / 24, 1.0) for i in range(25)]
    edge = [e - (e - c).normalized() * 0.0022 for e in edge]
    objs.append(gk.fin(gk.tube("lame_bead", [tuple(e) for e in edge], 0.0036, sides=6, step=0.014), "trim"))

    # The flames: three tongues along the top of the dome, front to back,
    # the middle one tallest, standing up and licking out over the arm,
    # broad face forward but turned a little so they read from the side.
    turn = math.radians(24)
    nrm = Vector((math.sin(turn), 0.0, -math.cos(turn)))
    for j, (ph, dth, h, lean) in enumerate((
        (math.radians(50), -0.95, 0.08, 0.22),
        (math.radians(44), 0.0, 0.118, 0.3),
        (math.radians(50), 0.95, 0.086, 0.22),
    )):
        th = th_in + dth
        p = pt(ph, th)
        Vd = Vector((math.sin(lean), math.cos(lean), 0.0))
        Vd = (Vd - nrm * Vd.dot(nrm)).normalized()
        U = Vd.cross(nrm)
        if U.x < 0:
            U = -U
        base = p - Vd * 0.016
        mtx = gk.frame_matrix(tuple(base), tuple(U), tuple(Vd))
        outline = _flame_outline(h, sub=2)
        objs.append(gk.fin(gk.extrude_outline(f"flame{j}", outline, 0.0095, mtx, bevel_w=0.0028, segs=1), "trim"))
        # The lit vein: a slim tongue let into both faces.
        vein = [(x * 0.3, y * 0.6 + 0.14 * h) for (x, y) in _flame_outline(h, sub=1)[:-1]]
        objs.append(gk.fin(gk.extrude_outline(f"vein{j}", vein, 0.0108, mtx), "glow"))

    # The lit studs, fore and aft on the dome's face.
    for k, dth in enumerate((math.radians(78), -math.radians(78))):
        th = th_out + dth
        ph = math.radians(52)
        _stud(f"stud{k}", pt(ph, th), gk.dome_dir(ax, ph, th), r=0.009, objs=objs)
    return _pairs(objs)


# ---------------------------------------------------------------------------
# BASTION
# ---------------------------------------------------------------------------

def bastion(ref):
    """BASTION: the great smooth dome with no fire and no spikes — one
    broad paint surface, its edge capped in a flat steel binding, a single
    raised keel over the crown brow to back (a running light let into its
    spine), and two broad tiers stepping out and down over the arm, each
    edged in steel."""
    objs = []
    ax = _tilt(math.radians(44))
    c = Vector((0.214, 0.36, 0.0))
    R = 0.132
    a, f, sd = gk.dome_frame(ax)
    out = _out_dir(ax)
    th_out = _theta_of(ax, out)

    def shape(ph, th):
        # A great smooth dome with a fortress's squareness: a superellipse
        # in section (a broad flat crown, a tight round shoulder, steep
        # walls) and squared off in plan, so it reads as a built turret,
        # never a ball.
        n = 2.6
        e = 1.0 / ((abs(math.cos(ph)) / 0.84) ** n + abs(math.sin(ph)) ** n) ** (1 / n)
        e *= 1.0 + 0.06 * max(0.0, ph - math.radians(60)) / math.radians(30)
        rel = th - th_out
        m = 3.2
        q = 1.0 / (abs(math.cos(rel)) ** m + (abs(math.sin(rel)) / 1.06) ** m) ** (1 / m)
        return e * (1.0 + (q - 1.0) * math.sin(min(ph, math.pi / 2)) ** 2)

    # Short over the arm (the tiers carry on down it), deep over the neck
    # where the body trims it onto the trapezius.
    rimfn = _rimfn(ax, math.radians(70), math.radians(124), math.radians(92))
    dome, rim, pt = _cap("dome", c, ax, R, rimfn, segs=32, rows=9, shape=shape, target=ref, gap=0.011)
    gk.solidify(dome, 0.0065, offset=-1)
    gk.bevel(dome, 0.0018, segments=1, angle=40)
    objs.append(gk.fin(dome, "shell"))

    # The binding: a flat steel channel capping the dome's edge.
    P, Nn, M = _rim_frames(pt, rim, ax, n=44)
    sec = [(-0.0105, 0.0022), (-0.008, 0.0036), (0.002, 0.0036), (0.0042, 0.0016), (0.0042, -0.0074), (0.002, -0.0086), (-0.002, -0.0086)]
    # Section x runs along the meridian (down is +x), y out of the shell.
    rimP = []
    for p, n, m in zip(P, Nn, M):
        rimP.append(p)
    # _sweep's x is T×up; make sure +x goes down the dome.
    T = (P[1] - P[-1]).normalized()
    sgn = 1.0 if T.cross(Nn[0]).dot(M[0]) > 0 else -1.0
    sec = [(x * sgn, y) for (x, y) in sec]
    if sgn < 0:
        sec = sec[::-1]
    objs.append(gk.fin(_sweep("binding", rimP, Nn, sec, closed=True), "trim"))

    # The keel over the crown, front rim to back rim.
    kp, kn = [], []
    th_f, th_b = 0.0, math.pi
    n_k = 34
    for i in range(n_k + 1):
        t = -1 + 2 * i / n_k
        th = th_f if t < 0 else th_b
        ph = abs(t) * (rim(th) - math.radians(4))
        kp.append(pt(ph, th))
        kn.append(gk.dome_dir(ax, ph, th))
    # A comb: a raised blade of steel, crisp along its top, rising from
    # the rim to its full height over the crown.
    ksec = [(-0.0075, -0.004), (-0.0062, 0.006), (-0.0028, 0.0175), (-0.0012, 0.0198), (0.0012, 0.0198), (0.0028, 0.0175), (0.0062, 0.006), (0.0075, -0.004)]
    keel = _sweep("keel", kp, kn, ksec, closed=False, scale=lambda t: (1.0, 0.3 + 0.7 * math.sin(math.pi * t) ** 0.7))
    objs.append(gk.fin(keel, "trim"))
    # The running light let into the keel's spine.
    # A lit seam run through the comb's flanks.
    lp = [kp[i] + kn[i] * (0.011 * (0.3 + 0.7 * math.sin(math.pi * i / n_k) ** 0.7)) for i in range(10, n_k - 9)]
    ln = [kn[i] for i in range(10, n_k - 9)]
    lsec = [(-0.0053, -0.0011), (-0.0053, 0.0011), (0.0053, 0.0011), (0.0053, -0.0011)]
    objs.append(gk.fin(_sweep("light", lp, ln, lsec, closed=False), "glow"))

    # Two broad tiers stepping down and out over the arm, each tucked
    # under the edge above it.
    for k in range(2):
        half = math.radians(82 - 10 * k)

        def tier(u, v, k=k, half=half):
            az = -half + 2 * half * u
            th = th_out + az
            ph0 = rim(th) - math.radians(10) + k * math.radians(19)
            tongue = max(0.0, math.cos(az / half * math.pi / 2)) ** 0.4
            ph = ph0 + (math.radians(6) + math.radians(20) * tongue) * v
            rr = R * shape(ph0, th) * (0.94 + 0.065 * k + 0.07 * v)
            return c - a * (0.004 + 0.004 * k) + gk.dome_dir(ax, ph, th) * rr

        tr = _grid(f"tier{k}", tier, 16, 4)
        _orient_from(tr, c)
        gk.solidify(tr, 0.006, offset=-1)
        gk.bevel(tr, 0.0018, segments=1, angle=40)
        objs.append(gk.fin(tr, "shell"))
        edge = [tier(i / 24, 1.0) for i in range(25)]
        objs.append(gk.fin(gk.tube(f"tbead{k}", [tuple(e - (e - c).normalized() * 0.0022) for e in edge], 0.0036, sides=6, step=0.012), "trim"))
    return _pairs(objs)


# ---------------------------------------------------------------------------
# SPIKED PADS
# ---------------------------------------------------------------------------

def _perp(d):
    d = Vector(d).normalized()
    r = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    return (r - d * r.dot(d)).normalized()


def _ngon(n, r=1.0, rot=0.0):
    return [(r * math.cos(rot + 2 * math.pi * k / n), r * math.sin(rot + 2 * math.pi * k / n)) for k in range(n)]


def _spike(name, base, d, length, r0, bend=None, sides=6):
    """A forged spike: a hexagonal shank drawn to a blunted point along a
    gentle curve, its flanks concave (it swells at the root), every arris
    bevelled so it catches a highlight line."""
    d = Vector(d).normalized()
    bend = Vector(bend) if bend is not None else Vector()
    n = 11
    P, U = [], []
    up = _perp(d)
    for i in range(n + 1):
        t = i / n
        P.append(Vector(base) + d * length * t + bend * length * t * t)
        U.append(up)
    rad = [max(0.0011, r0 * (1 - t) ** 1.25) for t in (i / n for i in range(n + 1))]
    ob = _sweep(name, P, U, _ngon(sides), closed=False, scale=lambda t: (rad[round(t * n)], rad[round(t * n)]))
    gk.bevel(ob, min(0.0012, r0 * 0.08), segments=1, angle=30)
    return ob


def _collar(name, at, d, r, h=0.009, objs=None):
    """A hex nut on a round washer, standing on the plate at `at`."""
    d = Vector(d).normalized()
    up = _perp(d)
    at = Vector(at)
    washer = _sweep(name + "_w", [at - d * 0.003, at + d * 0.0022], [up, up], _ngon(14, r * 1.3), closed=False)
    gk.bevel(washer, 0.0008, segments=1, angle=30)
    nut = _sweep(name, [at, at + d * h], [up, up], _ngon(6, r, math.pi / 6), closed=False)
    gk.bevel(nut, 0.0013, segments=1, angle=30)
    objs.append(gk.fin(washer, "trim"))
    objs.append(gk.fin(nut, "trim"))


def spikepads(ref):
    """SPIKED PADS: layered plates and three spikes a side. A broad keeled
    shell arches over the shoulder from the collarbone well past the cap
    and down the arm; a second plate is laid over its crown and riveted
    down, and three forged hex spikes are driven up through that crown
    from steel nuts — the big one off the top raking out over the arm, a
    smaller one fore and aft. A lame tucked under the foot."""
    objs = []
    th = 0.008
    base = [
        ((0.134, 0.441), (0.212, 0.438), (0.272, 0.455), 5, (0.07, 0.1), (0.1, 0.26), (0.03, 0.08)),
        ((0.272, 0.455), (0.334, 0.456), (0.337, 0.35), 7, (0.1, 0.114), (0.26, 0.34), (0.08, 0.17)),
        ((0.337, 0.35), (0.338, 0.332), (0.352, 0.322), 2, (0.114, 0.108), (0.34, 0.34), (0.17, 0.17)),
    ]
    plate, G, N = _plate("plate", base, ref, nv=8, clear=th + 0.004, chevron=0.022, lip=0.0)
    objs.append(gk.fin(_plate_finish(plate, th, 0.0028), "shell"))
    # The crown plate: laid on the shell (lifted its thickness), narrower,
    # its ends drawn to a V front and back of the keel.
    i0, i1 = 2, 12
    top, TG, TN = _plate("crown", base, ref, nv=8, clear=th + 0.004, chevron=0.026, lip=0.02, vspan=0.7,
                         lift=th + 0.0006, rows_slice=(i0, i1), ends=(2, 3))
    objs.append(gk.fin(_plate_finish(top, 0.0065, 0.0024), "shell"))
    # Rivets holding it down, round its edge.
    for (r, j) in ((1, 1), (1, 7), (5, 0), (5, 8), (8, 1), (8, 7)):
        p = TG[r][j] + (TG[r][4] - TG[r][j]).normalized() * 0.008
        objs.append(gk.fin(gk.rivet(f"rv{r}{j}", tuple(p), tuple(TN[r][j]), r=0.0036, h=0.0026, segs=8), "trim"))
    # The spikes, from nuts on the crown plate.
    out = Vector((1.0, 0.0, 0.0))
    for k, (r, j, length, r0, rake, splay) in enumerate((
        (4, 4, 0.12, 0.0158, 0.1, 0.0),
        (5, 1, 0.076, 0.0118, 0.05, -0.5),
        (5, 7, 0.076, 0.0118, 0.05, 0.5),
    )):
        p = TG[r][j]
        n = TN[r][j]
        d = (n + out * rake + Vector((0.0, 0.25, splay * 0.35))).normalized()
        _collar(f"nut{k}", p, d, r0 * 1.35, objs=objs)
        objs.append(gk.fin(_spike(f"spike{k}", p + d * 0.004, d, length, r0, bend=out * 0.14), "trim"))

    # A lame tucked under the foot, flaring out.
    lame = [((0.324, 0.374), (0.344, 0.326), (0.356, 0.296), 4, (0.106, 0.1), (0.34, 0.34), (0.17, 0.17)),
            ((0.356, 0.296), (0.359, 0.288), (0.37, 0.28), 1, (0.1, 0.098), (0.34, 0.34), (0.17, 0.17))]
    lm, LG, LN = _plate("lame", lame, ref, nv=8, clear=th + 0.004, chevron=0.02)
    objs.append(gk.fin(_plate_finish(lm, 0.0065, 0.0024), "shell"))
    for j in (1, 7):
        objs.append(gk.fin(gk.rivet(f"lr{j}", tuple(LG[2][j]), tuple(LN[2][j]), r=0.0042, h=0.003, segs=8), "trim"))
    return _pairs(objs)


# ---------------------------------------------------------------------------
# EPAULETS
# ---------------------------------------------------------------------------

def _push_out(ref, p, clear):
    """p moved out of the body to `clear` from it (unchanged if clear)."""
    sp = gk.surface_point(ref, tuple(p))
    if sp is None:
        return Vector(p)
    q, n = Vector(sp[0]), Vector(sp[1])
    d = (Vector(p) - q).dot(n)
    return Vector(p) + n * (clear - d) if d < clear else Vector(p)


def epaulets(ref):
    """EPAULETS: the dress board. A stiff, thick board laid along the slope
    of the shoulder from the collar out past the point of it, narrow at
    the neck (a steel keeper over the strap, a lit button), broadening to
    a rounded end; piped round in steel; a padded CRESCENT rolled round
    that end; and a heavy bullion FRINGE hung plumb off it, draping over
    the point of the shoulder down the arm."""
    import bmesh
    objs = []
    th = 0.011
    L = 0.198
    hw = 0.068
    xc = L - hw
    w0 = 0.036

    def half(x):
        if x <= xc:
            s = x / xc
            return w0 + (hw - w0) * (s * s * (3 - 2 * s))
        return math.sqrt(max(0.0, hw * hw - (x - xc) ** 2))

    # The outline (local x along the board, y across), round its middle.
    pts = []
    n_side = 14
    for i in range(n_side + 1):
        x = xc * i / n_side
        pts.append((x, -half(x)))
    for i in range(1, 16):
        a = -math.pi / 2 + math.pi * i / 16
        pts.append((xc + hw * math.cos(a), hw * math.sin(a)))
    for i in range(n_side, -1, -1):
        x = xc * i / n_side
        pts.append((x, half(x)))
    xm = L * 0.5
    outline = gk.polygon_outline([(x - xm, y) for (x, y) in pts], corner=3)

    # The centreline along the shoulder (front view), the board's top face.
    P0, C1, P1 = Vector((0.114, 0.462)), Vector((0.214, 0.462)), Vector((0.296, 0.414))

    def along(x):
        s = min(max(x / L, 0.0), 1.0)
        return (1 - s) ** 2 * P0 + 2 * (1 - s) * s * C1 + s * s * P1

    def place(x, y, lift=0.0):
        c = along(x)
        d = (along(x + 0.002) - along(x - 0.002)).normalized()
        up = Vector((-d.y, d.x))
        if up.y < 0:
            up = -up
        # A stiff board, but crowned a little across its width.
        crown = -0.012 * (y / hw) ** 2
        q = c + up * (lift + crown)
        return Vector((q.x, q.y, y))

    board = gk.radial_plate("board", outline, rings=4, segs=36)
    bm = bmesh.new()
    bm.from_mesh(board.data)
    for v in bm.verts:
        g = place(v.co.x + xm, v.co.y)
        g = _push_out(ref, g, th + 0.004)
        v.co = Vector(kit.to_blender(tuple(g)))
    bm.to_mesh(board.data)
    bm.free()
    _orient_out(board, (0.0, 1.0, 0.0))
    gk.solidify(board, th, offset=-1)
    gk.bevel(board, 0.003, segments=2, angle=30)
    objs.append(gk.fin(board, "shell"))

    # Where the board actually lies (after it was eased off the body).
    def top(x, y, lift=0.0):
        g = _push_out(ref, place(x, y), th + 0.004)
        c = along(x)
        d = (along(x + 0.002) - along(x - 0.002)).normalized()
        up = Vector((-d.y, d.x))
        if up.y < 0:
            up = -up
        return g + Vector((up.x, up.y, 0.0)) * lift

    # The piping, round the outline on the top face's edge.
    pipe = []
    for k in range(72):
        th_ = 2 * math.pi * k / 72
        x, y = outline(th_)
        r = math.hypot(x, y)
        k_in = (r - 0.0035) / r
        pipe.append(top(x * k_in + xm, y * k_in, 0.0012))
    pipe.append(pipe[0])
    objs.append(gk.fin(gk.tube("piping", [tuple(p) for p in pipe], 0.0034, sides=6, closed_ends=False, step=0.012), "trim"))

    # The crescent: a rolled steel crescent round the rounded end, just
    # inside the piping, swelling to its middle and drawn to points.
    cres = []
    for i in range(23):
        a = -math.radians(100) + math.radians(200) * i / 22
        rr = hw - 0.0135
        cres.append(top(xc + rr * math.cos(a), rr * math.sin(a), 0.0065))
    objs.append(gk.fin(gk.tube("crescent", [tuple(p) for p in cres], lambda t: 0.0108 * (0.3 + 0.7 * math.sin(math.pi * t) ** 0.7),
                               sides=8, scale_xy=(1.0, 0.8), step=0.008), "trim"))

    # The fringe: bullion hung plumb from under the rounded end, each
    # strand draping over the point of the shoulder where it meets it.
    # Each is a coil of bullion: an oval section twisted down its length
    # (the spiral catches the light like wound wire), ending in a knob.
    strands = 13
    for i in range(strands):
        a = -math.radians(94) + math.radians(188) * i / (strands - 1)
        rr = hw - 0.007
        root = top(xc + rr * math.cos(a), rr * math.sin(a), -th - 0.002)
        length = 0.072 + 0.014 * math.cos(a)
        seg = length / 7
        r0 = 0.0052
        # Hung plumb, flared a touch away from the board's end.
        spread = Vector((math.cos(a), 0.0, math.sin(a))) * 0.16
        path = [root]
        for k in range(7):
            p = path[-1] + (Vector((0.0, -1.0, 0.0)) + spread).normalized() * seg
            p = _push_out(ref, p, r0 + 0.003)
            p = path[-1] + (p - path[-1]).normalized() * seg
            path.append(p)
        objs.append(gk.fin(gk.tube(f"fr{i}", [tuple(p) for p in path],
                                   lambda t: r0 * (1.0 if t < 0.88 else 0.35 + 0.65 * math.sqrt(max(0.0, 1 - ((t - 0.88) / 0.12) ** 2))),
                                   sides=6, twist=7 * math.pi, scale_xy=(1.0, 0.66), step=0.0065), "trim"))

    # The keeper: a steel band across the board near the collar, and the
    # lit button inboard of it.
    kx = 0.05
    kp = [top(kx, -half(kx) - 0.004 + (2 * half(kx) + 0.008) * j / 6, 0.002) for j in range(7)]
    kn = [Vector((0.0, 1.0, 0.0))] * 7
    ksec = [(-0.007, -0.002), (-0.007, 0.0016), (-0.005, 0.0032), (0.005, 0.0032), (0.007, 0.0016), (0.007, -0.002)]
    keeper = _sweep("keeper", kp, kn, ksec, closed=False)
    gk.bevel(keeper, 0.0008, segments=1, angle=30)
    objs.append(gk.fin(keeper, "trim"))
    bp = top(0.022, 0.0, 0.0)
    _stud("button", bp, Vector((0.0, 1.0, 0.0)), r=0.0095, objs=objs)
    # THE FRINGE FLOPS (avatar/flop.ts): the bullion swings as one curtain
    # from the board's end, quick and loose like hanging wire.
    for ob in objs:
        if ob.name.split(".")[0].startswith("fr") and ob.name.split(".")[0][2:].isdigit():
            gk.flop(ob, "fringe_l")
    piv = top(xc + (hw - 0.007) * 0.4, 0.0, -th - 0.002)
    EPAULET_FLOPS.clear()
    spring = dict(dir=[0.25, -0.97, 0.0], len=0.085, stiff=90.0, damp=3.2, swing=0.55)
    EPAULET_FLOPS["fringe_l"] = dict(pivot=[round(piv.x, 5), round(piv.y, 5), round(piv.z, 5)], **spring)
    EPAULET_FLOPS["fringe_r"] = dict(pivot=[round(-piv.x, 5), round(piv.y, 5), round(piv.z, 5)], **{**spring, "dir": [-0.25, -0.97, 0.0]})
    out = _pairs(objs)
    for ob in out[1::2]:
        if ob.get("flop") == "fringe_l":
            ob["flop"] = "fringe_r"
    return out


EPAULET_FLOPS = {}


# ---------------------------------------------------------------------------
# GLADIATOR
# ---------------------------------------------------------------------------

def _arc_seg(O, r0, r1, a0, a1, n, w, k, q):
    """A spine segment on a circular arc about O (front view), angles in
    degrees from +x, radius r0 → r1 (a flare)."""
    a0r, a1r = math.radians(a0), math.radians(a1)
    am = 0.5 * (a0r + a1r)
    half = 0.5 * abs(a0r - a1r)
    rm = 0.5 * (r0 + r1) / math.cos(half)
    p0 = (O[0] + r0 * math.cos(a0r), O[1] + r0 * math.sin(a0r))
    p1 = (O[0] + r1 * math.cos(a1r), O[1] + r1 * math.sin(a1r))
    c = (O[0] + rm * math.cos(am), O[1] + rm * math.sin(am))
    return (p0, c, p1, n, w, k, q)


def gladiator(ref):
    """GLADIATOR: the net-man's guard — ONE shoulder armoured (the
    fighter's left, −x), the other bare. Four keeled lames step down over
    the shoulder and the arm line, each tucked under the one above and
    flaring a little further out, riveted at both ends; off the top lame
    at the neck side stands the GALERUS, a tall flared guard leaning away
    from the head, its edge rolled in steel and a lit boss at its heart.
    Built on +x like every other pad, then turned over to the left."""
    objs = []
    th = 0.0075
    O = (0.196, 0.364)
    lames = [
        # r top, r bottom, angle top, angle bottom, half-width
        (0.079, 0.095, 132, 74, 0.112),
        (0.0832, 0.0992, 84, 48, 0.108),
        (0.0874, 0.1034, 58, 22, 0.104),
        (0.0916, 0.1076, 32, -8, 0.1),
    ]
    for i, (r0, r1, a0, a1, w) in enumerate(lames):
        seg = _arc_seg(O, r0, r1, a0, a1, 7, (w, w * 0.97), (0.24, 0.26), (0.13, 0.15))
        lm, LG, LN = _plate(f"lame{i}", [seg], ref, nv=10, clear=th + 0.004, pivot=O)
        objs.append(gk.fin(_plate_finish(lm, th, 0.0026), "shell"))
        # Its lower edge rolled, and a rivet at each end.
        edge = _row_pts(LG, LN, len(LG) - 1, inset=0.001, lift=-th * 0.5, j0=0, j1=10)
        objs.append(gk.fin(gk.tube(f"roll{i}", [tuple(p) for p in edge], 0.0047, sides=7, step=0.01), "trim"))
        mid = len(LG) // 2
        for j in (0, 10):
            jj = 1 if j == 0 else 9
            p = LG[mid][jj]
            objs.append(gk.fin(gk.rivet(f"rv{i}{j}", tuple(p), tuple(LN[mid][jj]), r=0.0048, h=0.0034, segs=10), "trim"))

    # THE GALERUS: a tall flared plate standing on the top lame at the
    # neck side, broad face to the side, leaning out away from the head;
    # cupped a little for stiffness.
    import bmesh
    gw, gh = 0.17, 0.112
    gpts = [(-gw * 0.38, 0.0), (gw * 0.38, 0.0)]
    gpts += _qbez((gw * 0.38, 0.0), (gw * 0.53, gh * 0.55), (gw * 0.5, gh), 6)
    gpts += _qbez((gw * 0.5, gh), (0.0, gh * 1.28), (-gw * 0.5, gh), 10)[:-1]
    gpts += _qbez((-gw * 0.5, gh), (-gw * 0.53, gh * 0.55), (-gw * 0.38, 0.0), 6)[:-1]
    cy = gh * 0.5
    outline = gk.polygon_outline([(x, y - cy) for (x, y) in gpts], corner=2)
    lean = 0.3
    up = Vector((math.sin(lean), math.cos(lean), 0.0))
    side = Vector((0.0, 0.0, 1.0))
    nrm = side.cross(up)
    if nrm.x < 0:
        nrm = -nrm
    a = math.radians(116)
    base = Vector((O[0] + 0.08 * math.cos(a), O[1] + 0.08 * math.sin(a), 0.0)) - up * 0.006
    centre = base + up * cy

    def gmap(x, y):
        # Cupped: the face bows out (away from the neck) toward its middle.
        bow = 0.01 * (1 - (x / (gw * 0.5)) ** 2) + 0.016 * max(0.0, (y + cy) / gh) ** 2.2
        return centre + side * x + up * y + nrm * bow

    guard = gk.radial_plate("galerus", outline, rings=5, segs=48)
    bm = bmesh.new()
    bm.from_mesh(guard.data)
    for v in bm.verts:
        v.co = Vector(kit.to_blender(tuple(gmap(v.co.x, v.co.y))))
    bm.to_mesh(guard.data)
    bm.free()
    _orient_out(guard, tuple(nrm))
    gk.solidify(guard, 0.0085, offset=0.0)
    gk.bevel(guard, 0.0028, segments=2, angle=30)
    objs.append(gk.fin(guard, "shell"))
    # Its free edge rolled in steel (not the foot, which sits in the lame).
    roll = []
    for i in range(61):
        t = i / 60
        th_ = math.radians(8) + (math.radians(172) - math.radians(8)) * t
        x, y = outline(th_)
        rr = math.hypot(x, y)
        kk = (rr - 0.002) / rr
        roll.append(gmap(x * kk, y * kk))
    # outline(theta) runs from +x round the top to −x: extend it down both
    # sides to the foot.
    def side_run(th0, th1, n):
        out = []
        for i in range(n + 1):
            th_ = th0 + (th1 - th0) * i / n
            x, y = outline(th_)
            rr = math.hypot(x, y)
            kk = (rr - 0.002) / rr
            out.append(gmap(x * kk, y * kk))
        return out
    right = side_run(-math.radians(38), math.radians(8), 8)
    left = side_run(math.radians(172), math.radians(218), 8)
    path = right[:-1] + roll + left[1:]
    objs.append(gk.fin(gk.tube("galerus_roll", [tuple(p) for p in path], 0.0048, sides=8, step=0.008), "trim"))
    # The lit boss at its heart, on the outer face, in a steel bezel.
    bp = gmap(0.0, 0.0) + nrm * 0.0055
    _stud("boss", bp, nrm, r=0.0125, objs=objs)
    # Two rivets fixing the galerus's foot to the lame.
    for x in (-0.045, 0.045):
        p = gmap(x, -cy + 0.016) + nrm * 0.0045
        objs.append(gk.fin(gk.rivet(f"grv{x > 0}", tuple(p), tuple(nrm), r=0.0045, h=0.003, segs=10), "trim"))

    # Turn the whole guard over to the fighter's left (−x).
    out = []
    for o in objs:
        m = gk.mirrored_copy(o, name=o.name + "_L")
        gk.delete(o)
        out.append(m)
    return out


# The pads now reach well past the cap: pull the cameras back to hold them.
WIDE = dict(target=(0, 0.32, 0), dist=1.75)

PIECES = {
    "pauldrons": dict(slot="shoulders", build=pauldrons, tex=1024, budget=10000, view=WIDE),
    "warlord": dict(slot="shoulders", build=warlord, tex=1024, view=WIDE),
    "bastion": dict(slot="shoulders", build=bastion, tex=1024, view=WIDE),
    "spikepads": dict(slot="shoulders", build=spikepads, tex=1024, view=WIDE),
    "epaulets": dict(slot="shoulders", build=epaulets, tex=1024, view=WIDE, flops=EPAULET_FLOPS),
    "gladiator": dict(slot="shoulders", build=gladiator, tex=1024, view=dict(target=(-0.06, 0.32, 0), dist=1.6, yaw=30)),
}

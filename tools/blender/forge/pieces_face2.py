"""
THE HEADS II — Forge pieces for the `face` slot (heads.ts, DESIGN.md §5.2):
STALLION (the sculpted horse) and the WOLF, FROG and BUNNY as clean
cyberpunk HELMETS in THE BLANK's vocabulary (head.py: ceramic shell, dark
visor glass with lit slits or lenses, machined pods with lit rings, steel
vent slots, crisp seams). The helmets' shells are clean parts built as
meshes (Head(lows=…)); their high is the same parts as one field, filleted
and seamed. What follows describes the field pipeline both share.

Face space is the head group's (game space, +y up, front −z): a worn head
REPLACES the bare skull (a sphere r 0.13 scaled x 0.94 · z 0.97, centre
y 0.0065), the hitbox stays that sphere, snouts and ears stand out of it.

HOW THEY ARE MADE. Each head is a signed distance FIELD in game space —
lofts (FF1's head stations, made into closed meshes and turned into
level sets with OpenVDB), ellipsoids, round cones and swept tufts — joined
with SMOOTH unions (so an ear grows out of the skull and a brow blends
into the forehead, never a primitive stuck on) and carved with smooth
subtractions where a hole is (nostrils, the mouth, the inner ear). The
field is meshed twice:

  high   1.6 mm voxels, with sculpt detail the low never sees (the locks
         fluted into every fur tuft, lid creases, the tympanum's rim) —
         the shell's normal map is baked from it;
  shell  3 mm voxels, smooth, decimated to its share of the 9k budget.

Trim (inner ears, nostrils, mouth lines, the nose pad, the bridle) and the
glow eyes are small clean meshes laid IN the holes the field carved for
them, found on the field itself (projection along its gradient).

Every head also carries its FIT: the bare skull's scale and offset onto
this head's cranium dome, measured here by casting rays out of a
cranium-only mesh (the skull without ears, tufts, mane or snout features)
and fitting an ellipsoid to the hits over the dome, top pinned.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
import openvdb as vdb
from mathutils import Vector

import gearkit as gk
import kit

NOBAKE = "--nobake" in sys.argv
BIG = 0.05
H_HIGH = 0.0014
H_LOW = 0.003
SKULL = (0.13 * 0.94, 0.13, 0.13 * 0.97)  # the bare skull's radii (x, y, z)
SKULL_Y = 0.0065


# ---------------------------------------------------------------------------
# Vectors
# ---------------------------------------------------------------------------

def A(*a):
    return np.asarray(a[0] if len(a) == 1 else a, np.float64)


def unit(a):
    a = A(a)
    return a / np.linalg.norm(a)


def basis(x=None, y=None):
    """A right-handed orthonormal frame (3×3, columns = local x, y, z in
    game space) from a local y axis and a hint for local x."""
    y = unit(y if y is not None else (0, 1, 0))
    x = A(x if x is not None else (1, 0, 0))
    x = x - y * x.dot(y)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(y, (0, 0, 1.0))
    x = unit(x)
    z = np.cross(x, y)
    return np.stack([x, y, z], 1)


def rot(axis, ang):
    """Rotation matrix about a game axis."""
    a = unit(axis)
    c, s = math.cos(ang), math.sin(ang)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + s * K + (1 - c) * K @ K


def mirror(p):
    p = A(p).copy()
    p[..., 0] *= -1
    return p


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Smooth booleans
# ---------------------------------------------------------------------------

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


# ---------------------------------------------------------------------------
# Primitives: (fn(X, Y, Z, detail) -> distance, lo, hi) in game space
# ---------------------------------------------------------------------------

class Prim:
    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, A(lo), A(hi)


def _local(X, Y, Z, c, R):
    px, py, pz = X - c[0], Y - c[1], Z - c[2]
    return (px * R[0, 0] + py * R[1, 0] + pz * R[2, 0],
            px * R[0, 1] + py * R[1, 1] + pz * R[2, 1],
            px * R[0, 2] + py * R[1, 2] + pz * R[2, 2])


def ellipsoid(c, r, R=None):
    """An ellipsoid, radii r along the frame R's columns."""
    c, r = A(c), A(r)
    R = np.eye(3) if R is None else A(R)
    ext = np.sqrt(((R * r[None, :]) ** 2).sum(1))

    def fn(X, Y, Z, detail):
        q0, q1, q2 = _local(X, Y, Z, c, R)
        k0 = np.sqrt((q0 / r[0]) ** 2 + (q1 / r[1]) ** 2 + (q2 / r[2]) ** 2)
        k1 = np.sqrt((q0 / r[0] ** 2) ** 2 + (q1 / r[1] ** 2) ** 2 + (q2 / r[2] ** 2) ** 2)
        return k0 * (k0 - 1) / np.maximum(k1, 1e-9)
    return Prim(fn, c - ext, c + ext)


def _round_cone(X, Y, Z, a, b, r1, r2):
    """iq's exact round cone (a capsule with two radii), vectorised. Also
    returns the axial parameter t in [0, 1] (unclamped) and the offset."""
    ba = b - a
    l2 = ba.dot(ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    px, py, pz = X - a[0], Y - a[1], Z - a[2]
    y = px * ba[0] + py * ba[1] + pz * ba[2]
    z = y - l2
    qx, qy, qz = px * l2 - ba[0] * y, py * l2 - ba[1] * y, pz * l2 - ba[2] * y
    x2 = qx * qx + qy * qy + qz * qz
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2
    d_mid = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    d_b = np.sqrt(x2 + z2) * il2 - r2
    d_a = np.sqrt(x2 + y2) * il2 - r1
    d = np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_mid))
    return d, y * il2, (px, py, pz)


def sweep(pts, radii, flute=None, squash=None):
    """A swept round cone chain through `pts` with `radii` (a tuft, a
    lock, a brow, a groove cutter). `flute` = dict(n, amp, twist, start)
    flutes it with n locks running its length (the high's fur), the depth
    `amp` easing in from `start` (0..1 along it) so the root blends clean.
    `squash` = (axis, factor) flattens it across one game axis (a lock lying
    on the skull)."""
    P = [A(p) for p in pts]
    Rr = list(radii) if hasattr(radii, "__len__") else [radii] * len(P)
    n = len(P) - 1
    seg_len = [np.linalg.norm(P[i + 1] - P[i]) for i in range(n)]
    total = sum(seg_len)
    acc = np.concatenate([[0.0], np.cumsum(seg_len)]) / total
    # Parallel-transport frames for the flutes (continuous round the chain).
    T = [unit(P[i + 1] - P[i]) for i in range(n)]
    up = A(0, 1, 0) if abs(T[0][1]) < 0.9 else A(1, 0, 0)
    E1 = [unit(up - T[0] * up.dot(T[0]))]
    for i in range(1, n):
        v = E1[-1] - T[i] * E1[-1].dot(T[i])
        E1.append(unit(v))
    E2 = [np.cross(T[i], E1[i]) for i in range(n)]
    rmax = max(Rr)
    lo = np.min(P, 0) - rmax
    hi = np.max(P, 0) + rmax
    if squash is not None:
        sax, sf = unit(squash[0]), squash[1]

    def fn(X, Y, Z, detail):
        if squash is not None:
            # Scale space across `sax` about the chain's start (lengthens
            # the field along it: the tuft comes out thinner that way).
            c = P[0]
            dd = (X - c[0]) * sax[0] + (Y - c[1]) * sax[1] + (Z - c[2]) * sax[2]
            m = (1.0 / sf - 1.0)
            X, Y, Z = X + sax[0] * dd * m, Y + sax[1] * dd * m, Z + sax[2] * dd * m
        out = None
        for i in range(n):
            d, t, (px, py, pz) = _round_cone(X, Y, Z, P[i], P[i + 1], Rr[i], Rr[i + 1])
            if detail and flute is not None:
                tt = np.clip(t, 0, 1)
                g = acc[i] + (acc[i + 1] - acc[i]) * tt
                e1, e2 = E1[i], E2[i]
                u = px * e1[0] + py * e1[1] + pz * e1[2]
                v = px * e2[0] + py * e2[1] + pz * e2[2]
                phi = np.arctan2(v, u)
                fl = 0.5 - 0.5 * np.cos(flute["n"] * phi + flute.get("twist", 0.0) * g + flute.get("phase", 0.0))
                amp = flute["amp"] * smoothstep(flute.get("start", 0.2), flute.get("start", 0.2) + 0.25, g)
                d = d + amp * fl ** 1.5
            out = d if out is None else np.minimum(out, d)
        if squash is not None:
            out = out * sf
        return out
    return Prim(fn, lo, hi)


def tuft(root, direction, length, r0, bend=(0, 0, 0), tip=0.12, flute=None, squash=None, steps=5):
    """A fur TUFT: a teardrop from a round root drawn out to a soft point,
    curving by `bend` (a game vector added at the tip, quadratic)."""
    root, dvec, bend = A(root), unit(direction), A(bend)
    pts, rad = [], []
    for i in range(steps + 1):
        t = i / steps
        pts.append(root + dvec * length * t + bend * t * t)
        # Full girth in the root third, tapering to the soft point.
        k = 1 - smoothstep(0.35, 1.0, t) ** 1.4 * (1 - tip)
        rad.append(r0 * float(k) * (0.82 + 0.18 * math.sin(min(1, t * 2.4) * math.pi / 2)))
    return sweep(pts, rad, flute=flute, squash=squash)


def mesh_prim(verts, quads=None, tris=None, pad=0.0):
    """A closed mesh (game-space numpy verts, int faces) as a field."""
    V = A(verts)
    return Prim(("mesh", V, quads, tris), V.min(0) - pad, V.max(0) + pad)


# ---------------------------------------------------------------------------
# The field
# ---------------------------------------------------------------------------

class Field:
    def __init__(self, lo, hi, h, detail):
        self.h = h
        self.detail = detail
        self.lo = A(lo)
        self.n = (np.ceil((A(hi) - self.lo) / h).astype(int) + 1)
        self.D = np.full(tuple(self.n), BIG, np.float32)
        m = np.array([[h, 0, 0, 0], [0, h, 0, 0], [0, 0, h, 0], [*self.lo, 1.0]])
        self.xf = vdb.createLinearTransform(m.tolist())

    def _block(self, lo, hi):
        i0 = np.clip(np.floor((A(lo) - self.lo) / self.h).astype(int), 0, self.n)
        i1 = np.clip(np.ceil((A(hi) - self.lo) / self.h).astype(int) + 1, 0, self.n)
        if np.any(i1 <= i0):
            return None, None, None
        sl = tuple(slice(a, b) for a, b in zip(i0, i1))
        return sl, i0, i1

    def _coords(self, i0, i1):
        ax = [(self.lo[d] + self.h * np.arange(i0[d], i1[d])).astype(np.float32) for d in range(3)]
        return np.meshgrid(*ax, indexing="ij")

    def eval(self, prim, margin):
        sl, i0, i1 = self._block(prim.lo - margin, prim.hi + margin)
        if sl is None:
            return None, None
        if isinstance(prim.fn, tuple):
            _, V, quads, tris = prim.fn
            band = margin / self.h + 3
            g = vdb.FloatGrid.createLevelSetFromPolygons(
                V.astype(np.float32),
                triangles=None if tris is None else np.asarray(tris, np.uint32),
                quads=None if quads is None else np.asarray(quads, np.uint32),
                transform=self.xf, exBandWidth=float(band), inBandWidth=float(band + 4))
            d = np.zeros(tuple(i1 - i0), np.float32)
            g.copyToArray(d, ijk=tuple(int(v) for v in i0))
            return sl, d
        X, Y, Z = self._coords(i0, i1)
        return sl, prim.fn(X, Y, Z, self.detail).astype(np.float32)

    def add(self, prim, k=0.0):
        sl, d = self.eval(prim, k + 4 * self.h)
        if sl is not None:
            self.D[sl] = smin(self.D[sl], d, k)

    def cut(self, prim, k=0.0):
        sl, d = self.eval(prim, k + 4 * self.h)
        if sl is not None:
            self.D[sl] = smax(self.D[sl], -d, k)

    def blur(self, passes=1):
        D = self.D
        for _ in range(passes):
            for ax in range(3):
                s = [slice(None)] * 3
                a = D.copy()
                s0, s1, s2 = list(s), list(s), list(s)
                s0[ax], s1[ax], s2[ax] = slice(1, -1), slice(0, -2), slice(2, None)
                a[tuple(s0)] = (D[tuple(s0)] * 2 + D[tuple(s1)] + D[tuple(s2)]) * 0.25
                D = a
        self.D = D

    # Queries ---------------------------------------------------------------
    def sample(self, P):
        P = np.atleast_2d(A(P))
        g = (P - self.lo) / self.h
        i0 = np.clip(np.floor(g).astype(int), 0, self.n - 2)
        f = np.clip(g - i0, 0, 1)
        D = self.D
        out = np.zeros(len(P))
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                    out += w * D[i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz]
        return out

    def grad(self, P):
        P = np.atleast_2d(A(P))
        e = self.h
        g = np.zeros_like(P)
        for a in range(3):
            o = np.zeros(3)
            o[a] = e
            g[:, a] = (self.sample(P + o) - self.sample(P - o)) / (2 * e)
        n = np.linalg.norm(g, axis=1, keepdims=True)
        return g / np.maximum(n, 1e-9)

    def project(self, P, lift=0.0, iters=8):
        """Points pulled onto the surface (then lifted along its normal)."""
        P = np.atleast_2d(A(P)).copy()
        for _ in range(iters):
            P -= self.sample(P)[:, None] * self.grad(P)
        return P + self.grad(P) * lift, self.grad(P)

    def march(self, O, Dn, tmax=0.6):
        """Sphere-trace rays (from outside) to the first surface hit."""
        O, Dn = np.atleast_2d(A(O)), np.atleast_2d(A(Dn))
        Dn = Dn / np.linalg.norm(Dn, axis=1, keepdims=True)
        t = np.zeros(len(O))
        done = np.zeros(len(O), bool)
        for _ in range(600):
            d = self.sample(O + Dn * t[:, None])
            done |= np.abs(d) < 1e-4
            step = np.where(d > 0, np.maximum(d * 0.9, self.h * 0.1), d * 0.9)
            t += np.where(done, 0.0, step)
            if np.all(done | (t > tmax)):
                break
        return O + Dn * t[:, None]

    # Meshing ---------------------------------------------------------------
    def mesh(self, name, step=1):
        D = np.ascontiguousarray(self.D[::step, ::step, ::step])
        g = vdb.FloatGrid(BIG)
        g.copyFromArray(D, ijk=(0, 0, 0), tolerance=0)
        h = self.h * step
        g.transform = vdb.createLinearTransform([[h, 0, 0, 0], [0, h, 0, 0], [0, 0, h, 0], [*self.lo, 1.0]])
        P, T, Q = g.convertToPolygons(isovalue=0.0, adaptivity=0.0)
        return np_mesh(name, P.astype(np.float64), Q, T)


def np_mesh(name, P, quads=None, tris=None, smooth=True):
    """A Blender mesh object from game-space numpy points and faces, fast;
    faces oriented outward (closed surfaces)."""
    Q = np.zeros((0, 4), np.int64) if quads is None else np.asarray(quads, np.int64).reshape(-1, 4)
    T = np.zeros((0, 3), np.int64) if tris is None else np.asarray(tris, np.int64).reshape(-1, 3)
    # Orientation: the signed volume must come out positive.
    vol = 0.0
    if len(Q):
        a, b, c, d = (P[Q[:, i]] for i in range(4))
        vol += np.einsum("ij,ij->", a, np.cross(b, c)) + np.einsum("ij,ij->", a, np.cross(c, d))
    if len(T):
        a, b, c = (P[T[:, i]] for i in range(3))
        vol += np.einsum("ij,ij->", a, np.cross(b, c))
    if vol < 0:
        Q, T = Q[:, ::-1], T[:, ::-1]
    Vb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(Vb))
    me.vertices.foreach_set("co", Vb.astype(np.float32).ravel())
    loops = np.concatenate([Q.ravel(), T.ravel()]).astype(np.int32)
    starts = np.concatenate([np.arange(len(Q)) * 4, len(Q) * 4 + np.arange(len(T)) * 3]).astype(np.int32)
    me.loops.add(len(loops))
    me.loops.foreach_set("vertex_index", loops)
    me.polygons.add(len(starts))
    me.polygons.foreach_set("loop_start", starts)
    me.update(calc_edges=True)
    me.validate()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    kit.link(ob)
    return ob


def decimate(ob, target_tris, F=None, factor=1.0, keep=0.85):
    """Collapse to `target_tris`, symmetric; with a field, the tight
    curves (ear rims, tuft tips, lips) are weighted to keep their
    density — the flat broad plates give theirs up first."""
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if n > target_tris:
        kw = {}
        if F is not None:
            co = np.empty(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            G = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
            e = F.h * 1.5
            lap = -6 * F.sample(G)
            for a in range(3):
                o = np.zeros(3)
                o[a] = e
                lap += F.sample(G + o) + F.sample(G - o)
            k = np.abs(lap) / (e * e)
            w = np.clip((k - 25.0) / 120.0, 0.0, 1.0)
            # (collapse spares LOW weights: the group holds flatness)
            vg = ob.vertex_groups.new(name="flat")
            for val in np.unique(np.round(1 - w * keep, 2)):
                idx = np.nonzero(np.round(1 - w * keep, 2) == val)[0].tolist()
                vg.add(idx, float(val), "REPLACE")
            kw = dict(vertex_group="flat", vertex_group_factor=factor)
        m = gk.mod(ob, "DECIMATE", ratio=target_tris / n, use_symmetry=True, symmetry_axis="X", **kw)
        gk.bake_mods(ob)
    ob.data.shade_smooth()
    return ob


def relax(ob, F, iters=6, w=0.5):
    """Even out a decimated shell and unfold its slivers: each pass moves
    every vertex toward its neighbours' centroid (along the surface) and
    lands it back on the field's surface."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    G = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)  # game space
    ev = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    deg = np.bincount(ev.ravel(), minlength=n).astype(float)
    for _ in range(iters):
        acc = np.zeros_like(G)
        np.add.at(acc, ev[:, 0], G[ev[:, 1]])
        np.add.at(acc, ev[:, 1], G[ev[:, 0]])
        cen = acc / np.maximum(deg, 1)[:, None]
        Nn = F.grad(G)
        d = cen - G
        d -= Nn * (d * Nn).sum(1, keepdims=True)  # tangential only
        G = G + d * w
        G, _ = F.project(G, iters=3)
    Vb = np.stack([G[:, 0], -G[:, 2], G[:, 1]], 1)
    me.vertices.foreach_set("co", Vb.astype(np.float32).ravel())
    me.update()
    return ob


def mark_sharp(ob, deg):
    """Hard-surface plates: edges creased past `deg` shade sharp (the
    weighted-normal pass keeps them), the broad faces stay smooth."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    lim = math.radians(deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle() > lim:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


def folds(ob, deg=70):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    k = sum(1 for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle() > math.radians(deg))
    bm.free()
    return k


def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------
# Meshes for trim and glow (small, clean)
# ---------------------------------------------------------------------------

def ellipsoid_mesh(name, c, r, R=None, segs=16, rings=10, clips=()):
    """A UV ellipsoid (game space); `clips` [(normal, point)] flatten it
    onto those planes (a facet cut on a dome)."""
    c, r = A(c), A(r)
    R = np.eye(3) if R is None else A(R)
    P = [A(0, -1, 0)]
    for i in range(1, rings):
        ph = math.pi * i / rings
        for s in range(segs):
            th = 2 * math.pi * s / segs
            P.append(A(math.sin(ph) * math.cos(th), -math.cos(ph), math.sin(ph) * math.sin(th)))
    P.append(A(0, 1, 0))
    P = np.array(P) * r[None, :]
    P = P @ R.T + c
    for n, p0 in clips:
        n, p0 = unit(n), A(p0)
        d = (P - p0) @ n
        P = P - np.outer(np.maximum(d, 0), n)
    faces = []
    for s in range(segs):
        faces.append((0, 1 + (s + 1) % segs, 1 + s))
    for i in range(rings - 2):
        a0 = 1 + i * segs
        b0 = a0 + segs
        for s in range(segs):
            s1 = (s + 1) % segs
            faces.append((a0 + s, a0 + s1, b0 + s1, b0 + s))
    top = len(P) - 1
    last = 1 + (rings - 2) * segs
    for s in range(segs):
        faces.append((last + s, last + (s + 1) % segs, top))
    return poly_mesh(name, P, faces)


def poly_mesh(name, P, faces, smooth=True):
    Vb = [kit.to_blender(tuple(p)) for p in P]
    me = bpy.data.meshes.new(name)
    me.from_pydata(Vb, [], [tuple(int(i) for i in f) for f in faces])
    me.validate()
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    kit.link(ob)
    return ob


def strap(name, pts, normals, width, thick, sides=None, closed=False, step=0.009):
    """A flat strap (a bridle's leather, a band) laid along surface points
    `pts` with outward `normals`: a rounded-rectangle section, width across
    the surface, `thick` proud of it."""
    P = [A(p) for p in pts]
    Nn = [unit(n) for n in normals]
    if step:
        # Resample by length (a strap needs a ring every `step`, no more).
        L = np.concatenate([[0], np.cumsum([np.linalg.norm(P[i + 1] - P[i]) for i in range(len(P) - 1)])])
        m = max(3, int(L[-1] / step) + 1) if not closed else max(6, int(L[-1] / step))
        ts = np.linspace(0, L[-1], m, endpoint=not closed)
        PP, NN = np.array(P), np.array(Nn)
        P = [A([np.interp(t, L, PP[:, k]) for k in range(3)]) for t in ts]
        Nn = [unit([np.interp(t, L, NN[:, k]) for k in range(3)]) for t in ts]
    n = len(P)
    sec = []
    # A rounded rectangle: 6 points (the bake rounds it).
    hw, ht = width / 2, thick / 2
    for (u, v) in ((-1, -0.6), (1, -0.6), (1.0, 0.3), (0.7, 1), (-0.7, 1), (-1.0, 0.3)):
        sec.append((u * hw, v * ht))
    verts, faces = [], []
    for i in range(n):
        if closed:
            t = P[(i + 1) % n] - P[(i - 1) % n]
        else:
            t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        t = unit(t)
        nn = Nn[i] - t * Nn[i].dot(t)
        nn = unit(nn)
        b = np.cross(t, nn)
        c = P[i] + nn * ht
        for (u, v) in sec:
            verts.append(c + b * u + nn * v)
    m = len(sec)
    rings = n if closed else n - 1
    for i in range(rings):
        i1 = (i + 1) % n
        for s in range(m):
            s1 = (s + 1) % m
            faces.append((i * m + s, i * m + s1, i1 * m + s1, i1 * m + s))
    if not closed:
        faces.append(tuple(range(m - 1, -1, -1)))
        faces.append(tuple((n - 1) * m + s for s in range(m)))
    return poly_mesh(name, verts, faces)


def leaf_mesh(w, h, d, point, bend, segs=20, rings=14, cup=0.0):
    """heads.ts' LEAF: an ellipsoid w × h × d drawn to a soft point at the
    top, root rounded at −y, the upper half swept back (+z) by `bend`;
    `cup` dishes its front (−z) face. Local space, root at y = −h/2.
    Returns (verts, quads, tris)."""
    P = [A(0, -0.5, 0)]
    for i in range(1, rings):
        ph = math.pi * i / rings
        for s in range(segs):
            th = 2 * math.pi * s / segs
            P.append(A(0.5 * math.sin(ph) * math.cos(th), -0.5 * math.cos(ph), 0.5 * math.sin(ph) * math.sin(th)))
    P.append(A(0, 0.5, 0))
    P = np.array(P)
    t = P[:, 1] + 0.5
    k = 1 - point * np.maximum(0, t - 0.45) * 1.4
    k = np.maximum(k, 0.04)
    x = P[:, 0] * w * k
    z = P[:, 2] * d * (0.6 + 0.4 * k)
    if cup:
        # Dish the front: the front face pulled back toward the middle.
        front = P[:, 2] < 0
        across = 1 - (2 * P[:, 0]) ** 2
        z = np.where(front, z + cup * d * np.clip(across, 0, 1) * np.sin(np.clip(t, 0, 1) * math.pi) ** 0.5, z)
    z = z + bend * t * t
    y = P[:, 1] * h
    V = np.stack([x, y, z], 1)
    quads, tris = [], []
    for s in range(segs):
        tris.append((0, 1 + (s + 1) % segs, 1 + s))
    for i in range(rings - 2):
        a0 = 1 + i * segs
        b0 = a0 + segs
        for s in range(segs):
            s1 = (s + 1) % segs
            quads.append((a0 + s, a0 + s1, b0 + s1, b0 + s))
    top = len(V) - 1
    last = 1 + (rings - 2) * segs
    for s in range(segs):
        tris.append((last + s, last + (s + 1) % segs, top))
    return V, np.array(quads), np.array(tris)


def place(V, origin, R):
    """Local verts → game: rotate by frame R, then move to origin."""
    return A(V) @ A(R).T + A(origin)


def fold(V, at, R, angle):
    """heads.ts' FOLD (a flopped ear): above y = at, the centreline runs
    round an arc of radius R for `angle` radians toward −z, then straight."""
    V = A(V).copy()
    arc = R * angle
    y, dz = V[:, 1].copy(), V[:, 2].copy()
    s = y - at
    m = s > 0
    phi = np.minimum(s, arc) / R
    cy = at + R * np.sin(phi)
    cz = -R * (1 - np.cos(phi))
    over = s > arc
    cy = np.where(over, cy + (s - arc) * math.cos(angle), cy)
    cz = np.where(over, cz - (s - arc) * math.sin(angle), cz)
    V[m, 1] = (cy + dz * np.sin(phi))[m]
    V[m, 2] = (cz + dz * np.cos(phi))[m]
    return V


# ---------------------------------------------------------------------------
# Lofts (heads.ts loftGeometry), smoothed along the stations
# ---------------------------------------------------------------------------

def _cr(vals, t):
    """Catmull-Rom through a list of arrays at parameter t ∈ [0, n-1]."""
    n = len(vals)
    i = min(int(t), n - 2)
    u = t - i
    p0, p1 = vals[max(i - 1, 0)], vals[i]
    p2, p3 = vals[i + 1], vals[min(i + 2, n - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


def loft(stations, u, dy=0.0, seg=160, sub=20, caps=(0.7, 0.5), cap_rings=24):
    """FF1's head loft — each station a superellipse ring between its
    topline and underline points (in head-radius units `u`) — as a closed
    mesh, Catmull-Rom smoothed along the stations so it reads as one
    skull, not rings, and each end DOMED (`caps`: dome depth over the end
    ring's half-size) instead of FF1's flat fan. Returns (verts, quads,
    tris) in game space."""
    S = [A(*s["top"], *s["bot"], s["w"], s["n"]) for s in stations]
    n = len(S)
    m = (n - 1) * sub + 1
    rings = []
    for i in range(m):
        ty, tz, by, bz, w, nn = _cr(S, i / sub)
        midY, midZ = (ty + by) / 2, (tz + bz) / 2
        hy, hz = (ty - by) / 2, (tz - bz) / 2
        e = 2 / nn
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            c, s = math.cos(a), math.sin(a)
            uu = math.copysign(abs(c) ** e, c)
            vv = math.copysign(abs(s) ** e, s)
            ring.append((w * uu * u, (midY + hy * vv) * u + dy, (midZ + hz * vv) * u))
        rings.append(A(ring))

    def dome(end_ring, next_ring, depth):
        # Each vertex runs on along the loft's own slope and curls in to
        # the tip (a cubic Hermite per column), so the cap meets the loft
        # without a crease — a sphere-like dome on a converging loft left
        # a ring round the back of the skull.
        c = end_ring.mean(0)
        axis = unit(c - next_ring.mean(0))
        size = np.linalg.norm(end_ring - c, axis=1).mean()
        tip = c + axis * depth * size
        out = []
        P0 = end_ring
        T0 = end_ring - next_ring
        T0 = T0 / np.linalg.norm(T0, axis=1, keepdims=True)
        rad = end_ring - c
        rad = rad - np.outer(rad @ axis, axis)
        T1 = -rad / np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-9)
        L = np.linalg.norm(tip - end_ring, axis=1, keepdims=True) * 0.6
        for k in range(1, cap_rings):
            t = k / cap_rings
            h00, h10, h01, h11 = 2 * t ** 3 - 3 * t * t + 1, t ** 3 - 2 * t * t + t, -2 * t ** 3 + 3 * t * t, t ** 3 - t * t
            out.append(h00 * P0 + h10 * T0 * L * 0.8 + h01 * tip + h11 * T1 * L * 1.6)
        return out, tip

    back, back_tip = dome(rings[0], rings[1], caps[0])
    front, front_tip = dome(rings[-1], rings[-2], caps[1])
    allr = list(reversed(back)) + rings + front
    V = [p for r in allr for p in r]
    m = len(allr)
    quads = []
    for i in range(m - 1):
        for j in range(seg):
            a = i * seg + j
            b = i * seg + (j + 1) % seg
            quads.append((a, b, b + seg, a + seg))
    tris = []
    for end, row, tip in ((0, 0, back_tip), (1, m - 1, front_tip)):
        c = len(V)
        V.append(tuple(tip))
        for j in range(seg):
            a = row * seg + j
            b = row * seg + (j + 1) % seg
            tris.append((c, b, a) if end == 0 else (c, a, b))
    return A(V), np.array(quads), np.array(tris)


def on_loft(st, a, u, dy=0.0, out=1.0):
    """heads.ts onLoft: a point on a station ring at angle a (0 = +x side,
    π/2 = topline), pushed `out` along the section."""
    ty, tz = st["top"]
    by, bz = st["bot"]
    midY, midZ = (ty + by) / 2, (tz + bz) / 2
    hy, hz = (ty - by) / 2, (tz - bz) / 2
    e = 2 / st["n"]
    c, s = math.cos(a), math.sin(a)
    uu = math.copysign(abs(c) ** e, c)
    vv = math.copysign(abs(s) ** e, s)
    return A(st["w"] * uu * out * u, (midY + hy * vv * out) * u + dy, (midZ + hz * vv * out) * u)


# ---------------------------------------------------------------------------
# The head: field → high + shell, trim and glow laid in, the fit measured
# ---------------------------------------------------------------------------

def smooth_path(P, passes=2):
    P = A(P).copy()
    for _ in range(passes):
        Q = P.copy()
        Q[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
        P = Q
    return P


def measure_fit(cran, centre, top_dir=(0, 1, 0)):
    """The bare skull → this head's cranium dome, measured on the
    cranium-only mesh `cran` (the skull without ears, tufts, mane or
    face features) as heads.ts' HEAD_FIT was: the TEMPLES (the height
    where the cranium is widest) fix the dome's centre height and its
    width; the CROWN straight above them its height (top pinned); and an
    axis-aligned ellipsoid through those, least-squares fitted to rays
    cast over the dome (sides, back, and forward only high up — the brow
    drops into the face), gives its depth and how far back it sits."""
    c = A(centre)
    best_w, cy = -1, c[1]
    for y in np.arange(c[1] - 0.06, c[1] + 0.06, 0.002):
        h = gk.hit(cran, (0.0, float(y), float(c[2])), (1, 0, 0))
        if h is not None and h[0][0] > best_w:
            best_w, cy = h[0][0], float(y)
    rx = best_w
    top = gk.hit(cran, (0.0, cy, float(c[2])), tuple(top_dir))
    ytop = top[0][1]
    ry = ytop - cy
    o = A(0.0, cy, c[2])
    pts = []
    for el in range(10, 90, 6):
        for az in range(0, 360, 10):
            e, a = math.radians(el), math.radians(az)
            d = A(math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a))  # az 0 = back (+z)
            if -d[2] > 0.35 and el < 45:
                continue
            h = gk.hit(cran, tuple(o), tuple(d))
            if h is not None:
                pts.append(A(h[0]))
    P = np.array(pts)
    best = None
    for cz in np.arange(c[2] - 0.06, c[2] + 0.06, 0.0025):
        rhs = 1 - ((P[:, 1] - cy) / ry) ** 2 - (P[:, 0] / rx) ** 2
        m = (P[:, 2] - cz) ** 2
        ok = rhs > 0.02
        if ok.sum() < 20:
            continue
        cc = float((m[ok] * rhs[ok]).sum() / (m[ok] ** 2).sum())
        if cc <= 0:
            continue
        err = float(np.mean((m[ok] * cc - rhs[ok]) ** 2))
        if best is None or err < best[0]:
            best = (err, cz, 1 / math.sqrt(cc))
    err, cz, rz = best
    s = (rx / SKULL[0], ry / SKULL[1], rz / SKULL[2])
    y = cy - s[1] * SKULL_Y
    fit = dict(s=tuple(round(float(v), 3) for v in s), y=round(float(y), 4), z=round(float(cz), 4))
    print(f"fit: temples y {cy:.4f} half-width {rx:.4f}, crown {ytop:.4f}, depth radius {rz:.4f} at z {cz:.4f} "
          f"over {len(P)} hits -> {fit}", flush=True)
    return fit


def land(F, origin, direction):
    """March from `origin` (outside) along `direction` onto the surface:
    (point, normal)."""
    P = F.march([origin], [direction])
    return P[0], F.grad(P)[0]


class Head:
    """Builds a head from its `form(F, ctx)` (the field recipe) and its
    `parts(F, ctx)` (trim and glow laid on the shell's field)."""

    def __init__(self, pid, lo, hi, form, parts, cranium, shell_tris=6000, blur=1, keep=0.85, h_low=H_LOW,
                 relax_iters=6, sharp=0.0, lows=None):
        self.pid, self.lo, self.hi = pid, lo, hi
        self.form, self.parts, self.cranium = form, parts, cranium
        self.shell_tris, self.blur_n, self.keep = shell_tris, blur, keep
        self.h_low, self.relax_iters, self.sharp = h_low, relax_iters, sharp
        self.lows = lows

    def build(self, ref):
        # A worn head REPLACES the skull: the reference stays out of the
        # icon (--showref keeps it in a review, to see the hitbox).
        if "--showref" not in sys.argv:
            ref.hide_render = True
        ctx = {}
        objs = []
        low = Field(self.lo, self.hi, self.h_low, detail=False)
        self.form(low, ctx)
        low.blur(self.blur_n)
        if self.lows:
            # A hard-surface helmet: the shell is its clean parts, built as
            # meshes from the same definitions the field was (the field
            # makes the high and places everything).
            parts = self.lows(low, ctx)
            for o in parts:
                if self.sharp:
                    mark_sharp(o, self.sharp)
                objs.append(gk.fin(o, "shell"))
            print(f"{self.pid}: shell parts {sum(tris_of(o) for o in parts)} tris", flush=True)
            objs += self.parts(low, ctx)
            if not NOBAKE:
                high = Field(self.lo, self.hi, H_HIGH, detail=True)
                self.form(high, ctx)
                high.blur(self.blur_n)
                hob = high.mesh("high")
                print(f"{self.pid}: high field {tuple(high.n)} -> {tris_of(hob)} tris", flush=True)
                objs.append(gk.fin(hob, "high"))
            cf = Field(self.lo, self.hi, H_LOW, detail=False)
            centre = self.cranium(cf, ctx)
            cran = cf.mesh("cranium")
            PIECES[self.pid]["fit"] = measure_fit(cran, centre)
            gk.delete(cran)
            return objs
        shell = low.mesh("shell")
        print(f"{self.pid}: low field {tuple(low.n)} -> {tris_of(shell)} tris", flush=True)
        # How much of the hitbox sphere the head covers.
        g = np.random.default_rng(1).normal(size=(4000, 3))
        g = g / np.linalg.norm(g, axis=1, keepdims=True) * 0.13
        inside = (low.sample(g) < 0).mean()
        print(f"{self.pid}: covers {inside * 100:.0f}% of the hitbox sphere's surface", flush=True)
        decimate(shell, self.shell_tris, low, keep=self.keep)
        f0 = folds(shell)
        relax(shell, low, iters=self.relax_iters)
        print(f"{self.pid}: shell folds {f0} -> {folds(shell)} after relax", flush=True)
        if self.sharp:
            mark_sharp(shell, self.sharp)
        objs.append(gk.fin(shell, "shell"))
        objs += self.parts(low, ctx)
        if not NOBAKE:
            high = Field(self.lo, self.hi, H_HIGH, detail=True)
            self.form(high, ctx)
            high.blur(self.blur_n)
            hob = high.mesh("high")
            print(f"{self.pid}: high field {tuple(high.n)} -> {tris_of(hob)} tris", flush=True)
            objs.append(gk.fin(hob, "high"))
        # The fit, off the cranium alone.
        cf = Field(self.lo, self.hi, H_LOW, detail=False)
        centre = self.cranium(cf, ctx)
        cran = cf.mesh("cranium")
        PIECES[self.pid]["fit"] = measure_fit(cran, centre)
        gk.delete(cran)
        return objs


def groove_cut(F, path, r, k=0.0015):
    """Carve a round groove along a surface path (a mouth line)."""
    F.cut(sweep(path, r), k)


def groove_trim(name, path, normals, r, sink, sides=6, step=0.005):
    """The trim line laid in a groove: a tube `sink` below the surface."""
    P = A(path) - A(normals) * sink
    return gk.fin(gk.tube(name, [tuple(p) for p in P], r, sides=sides, step=step), "trim")


def surface_path(F, P, smooth=2):
    """Points pulled onto the field's surface, smoothed, with normals."""
    P, _ = F.project(P)
    P = smooth_path(P, smooth)
    P, N = F.project(P)
    return P, N


def drape_ring(F, ys, angles, axis_z, r_out=0.4):
    """heads.ts' DRAPE: rays from far outside in toward the head's axis
    (x = 0, height y, depth axis_z) at each angle (0 = dead ahead, +
    toward +x), landing on the surface. Returns points and normals."""
    O, Dn = [], []
    for y, th in zip(ys, angles):
        d = A(math.sin(th), 0, -math.cos(th))
        O.append(A(0, y, axis_z) + d * r_out)
        Dn.append(-d)
    P = F.march(O, Dn, tmax=r_out)
    return P


# ===========================================================================
# Shared organs: ears, eyes, small sculpted trim
# ===========================================================================

def euler(rx, ry, rz):
    """three.js Euler 'XYZ' as a matrix (R = Rx · Ry · Rz)."""
    return rot((1, 0, 0), rx) @ rot((0, 1, 0), ry) @ rot((0, 0, 1), rz)


def rounded_box(c, half, r, R=None):
    c, half = A(c), A(half)
    R = np.eye(3) if R is None else A(R)
    ext = np.sqrt(((R * (half + r)[None, :]) ** 2).sum(1))

    def fn(X, Y, Z, detail):
        q0, q1, q2 = _local(X, Y, Z, c, R)
        a0, a1, a2 = np.abs(q0) - half[0], np.abs(q1) - half[1], np.abs(q2) - half[2]
        out = np.sqrt(np.maximum(a0, 0) ** 2 + np.maximum(a1, 0) ** 2 + np.maximum(a2, 0) ** 2)
        return out + np.minimum(np.maximum(a0, np.maximum(a1, a2)), 0) - r
    return Prim(fn, c - ext, c + ext)


def torus_mesh(name, c, axis, R, r, segs=40, sides=8):
    return gk.ring(name, tuple(c), tuple(axis), R, r, segs=segs, sides=sides)


class Ear:
    """A LEAF ear (heads.ts): a shell leaf grown out of the skull, a hollow
    cut down its front face and a TRIM inner leaf laid in the hollow's
    floor — so the dark of the ear is a hole, not a sticker. Built in the
    ear's own frame (origin, R), optionally FOLDED forward."""

    def __init__(self, origin, R, shell, inner, inner_y, lift=0.0, fold=None, k=0.02, hollow=0.006):
        self.o, self.R = A(origin), A(R)
        self.shell, self.inner, self.inner_y = shell, inner, inner_y
        self.lift, self.foldp, self.k, self.hollow = lift, fold, k, hollow

    def _leaf(self, dims, dy, dz=0.0, grow=(1, 1, 1), segs=40, rings=40):
        w, h, d, point, bend = dims
        V, Q, T = leaf_mesh(w * grow[0], h * grow[1], d * grow[2], point, bend, segs=segs, rings=rings)
        V = V + A(0, dy, dz)
        if self.foldp:
            V = fold(V, *self.foldp)
        return place(V, self.o, self.R), Q, T

    def front_z(self):
        # The shell leaf's front face (local z) round its middle.
        return -self.shell[2] / 2 * 0.92

    def add(self, F):
        F.add(mesh_prim(*self._leaf(self.shell, self.lift)), k=self.k)
        # The hollow: the inner leaf grown a little, standing out of the
        # shell's front face and sunk `hollow` into it.
        fz = self.front_z()
        dims = list(self.inner)
        dims[2] = 0.03
        V, Q, T = self._leaf(dims, self.inner_y, fz - 0.015 + self.hollow, grow=(1.12, 1.04, 1.0))
        F.cut(mesh_prim(V, Q, T), k=0.002)

    def insert(self, name):
        """The trim leaf on the hollow's floor."""
        fz = self.front_z()
        dims = list(self.inner)
        dims[2] = 0.006
        V, Q, T = self._leaf(dims, self.inner_y, fz + self.hollow - 0.0012, segs=12, rings=10)
        return gk.fin(np_mesh(name, V, Q, T), "trim")


def frame_look(look):
    """A frame whose −z is `look` (y kept near up)."""
    z = -unit(look)
    x = unit(np.cross((0, 1, 0), z))
    return np.stack([x, np.cross(z, x), z], 1)


def lens_rim(F, c, R, r, n=48, lift=0.0008, phi_max=0.62):
    """Where an embedded lens (ellipsoid c, R, radii r; its front −z
    local) comes out of the skin: for each angle round it, scanning its
    surface from behind (polar angle phi_max·π) toward the front pole,
    the last point still inside the field. Angles where the skin covers
    it all the way (under a lid) are dropped. Returns (points, normals,
    closed) — a loop, or the longest open run."""
    P, ok = [], []
    phis = np.linspace(math.pi * phi_max, 0.02, 220)
    for a in np.linspace(0, 2 * math.pi, n, endpoint=False):
        q = np.stack([r[0] * np.sin(phis) * math.cos(a), r[1] * np.sin(phis) * math.sin(a), -r[2] * np.cos(phis)], 1)
        G = q @ A(R).T + A(c)
        d = F.sample(G)
        out = np.nonzero(d > 0)[0]
        if len(out) == 0:
            P.append(G[0])
            ok.append(False)
            continue
        if d[0] > 0:
            # the lens stands clear behind too: take the first point in
            # from the front pole instead
            ins = np.nonzero(d[::-1] < 0)[0]
            if len(ins) == 0:
                P.append(G[0])
                ok.append(False)
                continue
            j = len(d) - 1 - int(ins[0])
            if j + 1 >= len(d):
                P.append(G[j])
            else:
                t = d[j + 1] / (d[j + 1] - d[j])
                P.append(G[j + 1] + (G[j] - G[j + 1]) * t)
            ok.append(True)
            continue
        i = int(out[0])
        t = d[i - 1] / (d[i - 1] - d[i])
        P.append(G[i - 1] + (G[i] - G[i - 1]) * t)
        ok.append(True)
    P, ok = A(P), np.array(ok)
    closed = bool(ok.all())
    if not closed:
        # the longest run of good angles, in order round the lens
        k = int(np.argmin(ok)) if not ok.all() else 0
        order = np.roll(np.arange(n), -k)
        runs, cur = [], []
        for i in order:
            if ok[i]:
                cur.append(i)
            else:
                if cur:
                    runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)
        best = max(runs, key=len) if runs else []
        P = P[best]
    if len(P) >= 3:
        for _ in range(2):
            Q = P.copy()
            if closed:
                Q = 0.25 * np.roll(P, 1, 0) + 0.5 * P + 0.25 * np.roll(P, -1, 0)
            else:
                Q[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
            P = Q
    N = F.grad(P)
    return P + N * lift, N, closed


def loop_tube(name, P, r, sides=6, finish="trim", closed=True):
    """A closed tube through a loop of points (or an open one)."""
    P = A(P)
    if not closed:
        return gk.fin(gk.tube(name, [tuple(p) for p in P], r, sides=sides, closed_ends=True, step=0.006), finish)
    pts = [tuple(p) for p in np.vstack([P[-2:], P, P[:2]])]
    # gk.tube is open; close by overlapping the ends a little.
    ob = gk.tube(name, [tuple(p) for p in np.vstack([P, P[:3]])], r, sides=sides, closed_ends=True, step=0.006)
    return gk.fin(ob, finish)


def sdf_part(name, prims, finish, tris=300, h=0.0012, pad=0.01):
    """A small sculpted part (a nose pad) meshed from its own field."""
    adds = [p for p in prims if not isinstance(p, tuple)]
    lo = np.min([p.lo for p in adds], 0) - pad
    hi = np.max([p.hi for p in adds], 0) + pad
    F = Field(lo, hi, h, detail=False)
    for p in prims:
        if isinstance(p, tuple):
            F.cut(p[1], p[2])
        else:
            F.add(p, getattr(p, "k", 0.0))
    ob = F.mesh(name)
    decimate(ob, tris)
    relax(ob, F, iters=3)
    return gk.fin(ob, finish)


def with_k(p, k):
    p.k = k
    return p


def lock_path(F, root, direction, length, r0, steps=8, lift=0.55, hang=0.0, tip=0.25, free_after=1.0):
    """A LOCK lying on the skin: from `root` it runs along the surface
    (its direction kept tangent), lifted by part of its own girth so it
    lies ON the head — and where the skin falls away under it (`hang`, a
    game vector per step², gravity) it leaves the surface and hangs.
    Returns (points, radii)."""
    p, n = F.project([root])
    p, n = p[0], n[0]
    d = unit(direction)
    seg = length / steps
    pts, rad = [], []
    on = True
    for i in range(steps + 1):
        t = i / steps
        r = r0 * float(1 - smoothstep(0.3, 1.0, t) ** 1.3 * (1 - tip))
        pts.append(p + n * r * lift if on else p)
        rad.append(r)
        d = unit(d + A(hang) * (i + 1))
        if on:
            dt = d - n * d.dot(n)
            if np.linalg.norm(dt) < 1e-6:
                break
            q = p + unit(dt) * seg
            q2, n2 = F.project([q], iters=4)
            # leave the skin when it drops away more than a girth (or
            # past `free_after` of the length), and hang
            if (np.linalg.norm(q2[0] - q) > r0 * 1.2 and A(hang).any()) or t >= free_after:
                on = False
                p = p + n * r * lift + d * seg
            else:
                p, n = q2[0], n2[0]
                d = unit(dt)
        else:
            p = p + d * seg
    return A(pts), rad



# ===========================================================================
# Hard surface: profiled lofts, blades along paths, plates, cylinders
# ===========================================================================
#
# WOLF, FROG and BUNNY are clean cyberpunk HELMETS (the stallion stays the
# sculpted horse): the animal reads through the silhouette and a few
# strong designed planes — ceramic shell panels with crisp bevelled edges
# and cut seams, machined trim at the seams and mounts, lit visors and
# lenses. The same field pipeline makes them: boxy profiled lofts and
# rounded plates joined with SMALL blends (a 2–6 mm bevel, never a lump),
# seams cut as grooves along the surface (the major ones in the shell, the
# fine ones in the high only).

def profile_poly(pts, corner=6):
    """A closed section profile (unit square, centred, star-shaped) as
    a(angle) -> (u, v), corners rounded by a moving average."""
    f = gk.polygon_outline(pts, corner=corner)

    def g(a):
        x, y = f(a)
        return x, y
    return g


def chamfer_profile(top=0.55, side_top=0.45, side_bot=-0.6, bot=0.7, corner=6):
    """A chamfered rectangle: flat top `top` wide, chamfers down to the
    sides, sides to `side_bot`, a smaller chamfer into the bottom."""
    pts = [(top, 1.0), (1.0, side_top), (1.0, side_bot), (bot, -1.0), (-bot, -1.0), (-1.0, side_bot), (-1.0, side_top), (-top, 1.0)]
    return profile_poly(pts, corner)


def loft_profile(stations, profile, dy=0.0, seg=96, sub=12, caps=(0.2, 0.2), cap_rings=10):
    """loft() with a designed section: each station a ring of profile(a)
    stretched between its topline and underline points, `w` half-wide
    (metres, u = 1). Ends domed shallow (caps)."""
    S = [A(*s["top"], *s["bot"], s["w"]) for s in stations]
    n = len(S)
    m = (n - 1) * sub + 1
    prof = [profile(2 * math.pi * j / seg) for j in range(seg)]
    rings = []
    for i in range(m):
        ty, tz, by, bz, w = _cr(S, i / sub)
        midY, midZ = (ty + by) / 2, (tz + bz) / 2
        hy, hz = (ty - by) / 2, (tz - bz) / 2
        rings.append(A([(w * uu, midY + hy * vv + dy, midZ + hz * vv) for (uu, vv) in prof]))
    return _close_rings(rings, caps, cap_rings)


def _close_rings(rings, caps, cap_rings):
    def dome(end_ring, next_ring, depth):
        c = end_ring.mean(0)
        axis = unit(c - next_ring.mean(0))
        size = np.linalg.norm(end_ring - c, axis=1).mean()
        out = []
        for k in range(1, cap_rings):
            ph = (math.pi / 2) * k / cap_rings
            out.append(c + (end_ring - c) * math.cos(ph) + axis * depth * size * math.sin(ph))
        return out, c + axis * depth * size
    seg = len(rings[0])
    back, btip = dome(rings[0], rings[1], caps[0])
    front, ftip = dome(rings[-1], rings[-2], caps[1])
    allr = list(reversed(back)) + rings + front
    V = [p for r in allr for p in r]
    m = len(allr)
    quads = []
    for i in range(m - 1):
        for j in range(seg):
            a = i * seg + j
            b = i * seg + (j + 1) % seg
            quads.append((a, b, b + seg, a + seg))
    tris = []
    for end, row, tip in ((0, 0, btip), (1, m - 1, ftip)):
        c = len(V)
        V.append(tuple(tip))
        for j in range(seg):
            a = row * seg + j
            b = row * seg + (j + 1) % seg
            tris.append((c, b, a) if end == 0 else (c, a, b))
    return A(V), np.array(quads), np.array(tris)


def path_loft(path, wid, thk, side, profile=None, seg=48, sub=6, caps=(0.3, 0.6), cap_rings=6, twist=None):
    """A BLADE / FIN along a path (game points, Catmull-Rom'd): sections
    perpendicular to the path, `wid` half-width along `side` (a game
    vector, or a function of t), `thk` half-thickness across it; both
    numbers or lists per path point. Returns (verts, quads, tris)."""
    P = [A(p) for p in path]
    n = len(P)
    m = (n - 1) * sub + 1
    W = list(wid) if hasattr(wid, "__len__") else [wid] * n
    Tk = list(thk) if hasattr(thk, "__len__") else [thk] * n
    C = [_cr(P, i / sub) for i in range(m)]
    Wm = [float(_cr([A([w]) for w in W], i / sub)[0]) for i in range(m)]
    Tm = [float(_cr([A([t]) for t in Tk], i / sub)[0]) for i in range(m)]
    profile = profile or (lambda a: (math.cos(a), math.sin(a)))
    prof = [profile(2 * math.pi * j / seg) for j in range(seg)]
    rings = []
    for i in range(m):
        t = unit(C[min(i + 1, m - 1)] - C[max(i - 1, 0)])
        sd = A(side(i / (m - 1))) if callable(side) else A(side)
        sd = unit(sd - t * sd.dot(t))
        up = np.cross(t, sd)
        rings.append(A([C[i] + sd * (Wm[i] * uu) + up * (Tm[i] * vv) for (uu, vv) in prof]))
    return _close_rings(rings, caps, cap_rings)


def lens_profile():
    """A blade section: a flat lozenge with chamfered edges."""
    return profile_poly([(1.0, 0.0), (0.7, 0.8), (0.0, 1.0), (-0.7, 0.8), (-1.0, 0.0), (-0.7, -0.8), (0.0, -1.0), (0.7, -0.8)], corner=4)


def cylinder(c, axis, r, h, rr=0.0):
    """A capped cylinder (half-height h along axis), edges rounded rr."""
    c, ax = A(c), unit(axis)
    ext = np.abs(ax) * h + np.sqrt(np.maximum(1 - ax ** 2, 0)) * r + rr

    def fn(X, Y, Z, detail):
        px, py, pz = X - c[0], Y - c[1], Z - c[2]
        a = px * ax[0] + py * ax[1] + pz * ax[2]
        rx, ry, rz = px - ax[0] * a, py - ax[1] * a, pz - ax[2] * a
        rad = np.sqrt(rx * rx + ry * ry + rz * rz)
        dx = rad - (r - rr)
        dy = np.abs(a) - (h - rr)
        return np.minimum(np.maximum(dx, dy), 0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2) - rr
    return Prim(fn, c - ext - 0.002, c + ext + 0.002)


def halfspace(n, p0, lo, hi):
    """Everything behind the plane (n · (p − p0) < 0) inside a box: for
    clipping one part with smax before it joins (see Field.clip)."""
    n, p0 = unit(n), A(p0)

    def fn(X, Y, Z, detail):
        return (X - p0[0]) * n[0] + (Y - p0[1]) * n[1] + (Z - p0[2]) * n[2]
    return Prim(fn, lo, hi)


def clip(F, n, p0, k=0.0, lo=None, hi=None):
    """Plane-cut the field (keep n · (p − p0) < 0), within a box."""
    lo = F.lo if lo is None else A(lo)
    hi = F.lo + F.h * (F.n - 1) if hi is None else A(hi)
    sl, i0, i1 = F._block(lo, hi)
    X, Y, Z = F._coords(i0, i1)
    n, p0 = unit(n), A(p0)
    d = ((X - p0[0]) * n[0] + (Y - p0[1]) * n[1] + (Z - p0[2]) * n[2]).astype(np.float32)
    F.D[sl] = smax(F.D[sl], d, k)


def cylinder_mesh(name, c, axis, r, h, segs=24):
    """A capped cylinder mesh (half-height h along axis), a small chamfer
    ring at each end."""
    c, ax = A(c), unit(axis)
    e1 = unit(np.cross(ax, (0, 1, 0)) if abs(ax[1]) < 0.9 else np.cross(ax, (1, 0, 0)))
    e2 = np.cross(ax, e1)
    prof = [(0.0, -h), (r * 0.85, -h), (r, -h * 0.7), (r, h * 0.7), (r * 0.85, h), (0.0, h)]
    P, faces = [], []
    for (rr, hh) in prof:
        for s_ in range(segs):
            a = 2 * math.pi * s_ / segs
            P.append(c + ax * hh + (e1 * math.cos(a) + e2 * math.sin(a)) * rr)
    for i in range(len(prof) - 1):
        for s_ in range(segs):
            s1 = (s_ + 1) % segs
            faces.append((i * segs + s_, i * segs + s1, (i + 1) * segs + s1, (i + 1) * segs + s_))
    return poly_mesh(name, A(P), faces)


def slab(c, R, hx, hz, rad, thick, edge=0.0008):
    """A rounded-rectangle slab (a lens, a plate): hx × hz in the frame's
    x/z with corner radius `rad`, `thick` half-thick along its y."""
    c, R = A(c), A(R)
    ext = np.abs(R) @ A(hx, thick, hz) + 0.002

    def fn(X, Y, Z, detail):
        q0, q1, q2 = _local(X, Y, Z, c, R)
        ax, az = np.abs(q0) - (hx - rad), np.abs(q2) - (hz - rad)
        d2 = np.sqrt(np.maximum(ax, 0) ** 2 + np.maximum(az, 0) ** 2) + np.minimum(np.maximum(ax, az), 0) - rad
        dy = np.abs(q1) - (thick - edge)
        return np.minimum(np.maximum(d2 + edge, dy), 0) + np.sqrt(np.maximum(d2 + edge, 0) ** 2 + np.maximum(dy, 0) ** 2) - edge
    return Prim(fn, c - ext, c + ext)


def mesh_part(name, V, Q, T, finish):
    return gk.fin(np_mesh(name, V, Q, T), finish)


def seam_path(F, pts, n=48, smooth=2):
    """A seam laid on the skin through guide points (each landed along
    the field's gradient), densified."""
    P = A(pts)
    dense = []
    for i in range(len(P) - 1):
        for t in np.linspace(0, 1, max(2, n // (len(P) - 1)), endpoint=False):
            dense.append(P[i] + (P[i + 1] - P[i]) * t)
    dense.append(P[-1])
    return surface_path(F, A(dense), smooth)


def seam(F, path, w=0.0011, depth=0.0009, high_only=False):
    """Cut a crisp panel seam along a surface path."""
    if high_only and not F.detail:
        return
    P, N = path
    F.cut(sweep(P - N * (w - depth), w), k=0.0003)


def slot_insert(name, c, R, half, finish, r=0.0015):
    """A small machined part (a vent bar, a lens bar) as a rounded box mesh."""
    return sdf_part(name, [with_k(rounded_box(c, half, r, R), 0.0)], finish, tris=64, h=0.0008)


# ===========================================================================
# WOLF — a hunter's helmet: hard V brow over a lit visor, a long faceted
# muzzle, swept armour blades for the ruff
# ===========================================================================
#
# THE BLANK's vocabulary (head.py): a smooth ceramic shell, dark visor
# glass with lit slits behind it, machined ear pods with a lit ring, steel
# vent slots, crisp seams — on a wolf. The cranium is one dome; the muzzle
# a chamfered loft (flat bridge, angled cheeks) over its own jaw plate, the
# jaw seam lined in steel, a steel vent trio behind it and a machined nose
# cap at the tip. The menace is the BROW: a hard ridge swept back from a V
# over the visor band. Tall faceted fins stand on lit pods; the ruff is
# three bold blades a side off the jaw hinge and two off the nape, each
# bolted on.

WOLF_DOME = ((0, 0.012, 0.03), (0.104, 0.112, 0.118))
WOLF_BROW_CLIP = ((0, 0.5, -0.86), (0, 0.078, -0.068))


def _wolf_nosecap(seg=64, sub=6):
    """A faceted machined cap sleeved over the muzzle tip (the muzzle's
    own chamfered section, 2.5 mm proud, a flat front face)."""
    st = [
        dict(top=(-0.002, -0.208), bot=(-0.04, -0.21), w=0.037),
        dict(top=(-0.008, -0.228), bot=(-0.042, -0.229), w=0.034),
        dict(top=(-0.012, -0.241), bot=(-0.043, -0.241), w=0.031),
    ]
    return loft_profile(st, chamfer_profile(top=0.5, side_top=0.35, side_bot=-0.55, bot=0.75, corner=3), seg=seg, sub=sub,
                        caps=(0.05, 0.08), cap_rings=3)


def _wolf_muzzle(seg=96, sub=12):
    st = [
        dict(top=(0.062, -0.04), bot=(-0.09, -0.025), w=0.064),
        dict(top=(0.04, -0.092), bot=(-0.08, -0.085), w=0.056),
        dict(top=(0.012, -0.155), bot=(-0.066, -0.15), w=0.045),
        dict(top=(-0.004, -0.206), bot=(-0.06, -0.203), w=0.036),
        dict(top=(-0.01, -0.232), bot=(-0.058, -0.23), w=0.031),
    ]
    return loft_profile(st, chamfer_profile(top=0.5, side_top=0.35, side_bot=-0.55, bot=0.75), seg=seg, sub=sub,
                        caps=(0.1, 0.14), cap_rings=max(3, sub))


def _wolf_jaw(seg=96, sub=12):
    st = [
        dict(top=(-0.058, -0.02), bot=(-0.106, -0.005), w=0.062),
        dict(top=(-0.062, -0.09), bot=(-0.1, -0.085), w=0.05),
        dict(top=(-0.061, -0.17), bot=(-0.088, -0.166), w=0.034),
        dict(top=(-0.06, -0.212), bot=(-0.078, -0.21), w=0.026),
    ]
    return loft_profile(st, chamfer_profile(top=0.8, side_top=0.6, side_bot=-0.3, bot=0.5), seg=seg, sub=sub,
                        caps=(0.1, 0.25), cap_rings=max(3, sub))


def _wolf_brow(side, ctx, seg=40, sub=8):
    """The brow ridge: from the V over the bridge, swept up and back to
    the temple along the skin — a hard shelf over the visor."""
    path = ctx["brow"][(side + 1) // 2]
    return path_loft(path, [0.009, 0.012, 0.011, 0.009, 0.004], [0.0075, 0.0085, 0.008, 0.006, 0.003], (0, 1, 0.45),
                     profile=profile_poly([(1.0, 1.0), (1.0, -0.2), (0.2, -1.0), (-1.0, -1.0), (-1.0, 1.0)], corner=3),
                     seg=seg, sub=sub, caps=(0.3, 0.6), cap_rings=max(3, sub // 2))


def _wolf_ear_path(side):
    return [(side * 0.06, 0.07, 0.032), (side * 0.071, 0.13, 0.042), (side * 0.083, 0.19, 0.056), (side * 0.089, 0.224, 0.065)]


def _wolf_ear(side, seg=48, sub=8):
    return path_loft(_wolf_ear_path(side), [0.034, 0.03, 0.017, 0.004], [0.013, 0.01, 0.007, 0.0025], (1, 0, 0.25),
                     profile=lens_profile(), seg=seg, sub=sub, caps=(0.2, 0.4), cap_rings=max(3, sub // 2))


# The ruff: two swept armour plates a side, laid round the head from the
# cheek past the jaw hinge to the nape, the upper shingled over the lower.
WOLF_PLATES = [  # (height at the front, rise to the back, angle from, angle to, half-width, stand-off)
    (-0.01, 0.03, 1.08, 2.9, 0.027, 0.0075),
    (-0.056, 0.022, 0.98, 2.8, 0.025, 0.0042),
]


def _wolf_plate_paths(F):
    out = []
    for side in (-1, 1):
        for (y, rise, a0, a1, w, off) in WOLF_PLATES:
            t = np.linspace(0, 1, 25)
            th = (a0 + (a1 - a0) * t) * side
            P = drape_ring(F, y + rise * t ** 1.4, th, 0.02, r_out=0.35)
            P, N = surface_path(F, P, 3)
            out.append((P + N * off, w, side, N))
    return out


def _wolf_plate(path, w, N, seg=40, sub=4):
    n = len(path)
    # a chevron's point at the cheek, full through the hinge, swept to a
    # point at the nape; the lower edge flared out like a ruff
    wid = [w * (0.25 + 0.75 * smoothstep(0.0, 0.28, i / (n - 1))) * (1 - 0.8 * smoothstep(0.6, 1.0, i / (n - 1))) for i in range(n)]
    Nn = A(N)

    def side(t):
        k = min(int(round(t * (len(Nn) - 1))), len(Nn) - 1)
        return A(0, 1, 0) - Nn[k] * 0.45
    return path_loft(path, wid, [0.0042] * n, side,
                     profile=chamfer_profile(top=0.8, side_top=0.5, side_bot=-0.5, bot=0.8, corner=3),
                     seg=seg, sub=sub, caps=(0.12, 0.12), cap_rings=3)


def _wolf_pod(side):
    """The ear pod: where the fin is mounted, on the side of the dome."""
    p = A(side * 0.074, 0.062, 0.03)
    return p, unit((side, 0.55, 0.1))


def wolf_form(F, ctx):
    c, r = WOLF_DOME
    F.add(ellipsoid(c, r))
    clip(F, *WOLF_BROW_CLIP, k=0.008, hi=(0.2, 0.3, 0.0))
    F.add(mesh_prim(*_wolf_muzzle()), k=0.012)
    F.add(mesh_prim(*_wolf_jaw()), k=0.0)
    if "brow" not in ctx:
        # The brow's line on the skin: a V over the bridge, up and back.
        brows = []
        for side in (-1, 1):
            pts = []
            for x, y in ((0.004, 0.06), (0.03, 0.071), (0.058, 0.084), (0.08, 0.094), (0.094, 0.1)):
                p, n = land(F, (side * x, y, -0.4), (0, 0, 1)) if x < 0.07 else land(F, (side * (x + 0.3), y, -0.3), unit((-side, 0, 1)))
                pts.append(p + n * 0.006)
            brows.append(smooth_path(A(pts), 1))
        ctx["brow"] = brows
    for side in (-1, 1):
        F.add(mesh_prim(*_wolf_brow(side, ctx)), k=0.004)
        F.add(mesh_prim(*_wolf_ear(side)), k=0.006)
    if "plates" not in ctx:
        ctx["plates"] = _wolf_plate_paths(F)
    for path, w, side, N in ctx["plates"]:
        F.add(mesh_prim(*_wolf_plate(path, w, N)), k=0.0015)
    if "visor" not in ctx:
        # The visor band: a V across the face under the brow, landed on
        # the skin round the face, temple to temple.
        th = np.linspace(-1.2, 1.2, 31)
        ys = 0.04 + 0.04 * np.abs(th / 1.2) ** 1.3
        P = drape_ring(F, ys, th, 0.0, r_out=0.35)
        ctx["visor"] = surface_path(F, P, 2)
        ys = np.full(41, -0.06)
        th = np.linspace(-1.35, 1.35, 41)
        ctx["jawseam"] = surface_path(F, drape_ring(F, ys, th, -0.12, r_out=0.3), 2)
        ctx["crown"] = seam_path(F, [(0, 0.2, -0.04), (0, 0.2, 0.03), (0, 0.2, 0.09), (0, 0.1, 0.16), (0, 0.0, 0.17)], 40)
        ctx["mask"] = [seam_path(F, [(s * 0.2, 0.09, -0.02), (s * 0.2, 0.04, -0.012), (s * 0.2, -0.01, -0.02), (s * 0.2, -0.055, -0.03)], 24)
                       for s in (-1, 1)]
        ctx["nose"] = land(F, (0, -0.032, -0.4), (0, 0, 1))
        ctx["vents"] = [[land(F, (s * 0.25, -0.044 - 0.0085 * j, -0.07 - 0.003 * j), (-s, 0, 0)) for j in range(3)]
                        for s in (-1, 1)]
    # The visor's bed: a shallow channel the glass band sits in.
    P, N = ctx["visor"]
    F.cut(sweep((P + N * 0.002)[1:-1], 0.0135), k=0.002)
    for side in (-1, 1):
        for p, n in ctx["vents"][(side + 1) // 2]:
            F.cut(rounded_box(p, (0.013, 0.004, 0.0021), 0.0011, basis(x=(0, 0, -1), y=n)), k=0.0008)
    P, N = ctx["jawseam"]
    F.cut(sweep(P, 0.0024), k=0.001)
    seam(F, ctx["crown"])
    for pth in ctx["mask"]:
        seam(F, pth)


def wolf_lows(F, ctx):
    """The shell as clean parts (the same definitions as the field)."""
    c, r = WOLF_DOME
    out = [ellipsoid_mesh("dome", c, r, segs=28, rings=16, clips=[WOLF_BROW_CLIP])]
    out.append(np_mesh("muzzle", *_wolf_muzzle(seg=24, sub=2)))
    out.append(np_mesh("jaw", *_wolf_jaw(seg=16, sub=2)))
    for side in (-1, 1):
        out.append(np_mesh(f"brow{side}", *_wolf_brow(side, ctx, seg=10, sub=3)))
        out.append(np_mesh(f"ear{side}", *_wolf_ear(side, seg=10, sub=3)))
    for i, (path, w, side, N) in enumerate(ctx["plates"]):
        out.append(np_mesh(f"plate{i}", *_wolf_plate(path[::3], w, N[::3], seg=10, sub=2)))
    return out


def wolf_parts(F, ctx):
    out = []
    # The visor: dark glass round the face, two lit slits angled up and
    # out under the brow.
    P, N = ctx["visor"]
    V, Q, T = path_loft(P + N * 0.0012, 0.0125, 0.0032, lambda t: A(0, 1, 0), profile=lens_profile(), seg=8, sub=1,
                        caps=(0.3, 0.3), cap_rings=2)
    out.append(mesh_part("visor", V, Q, T, "trim"))
    n = len(P)
    for side in (-1, 1):
        idx = [i for i in range(n) if 0.14 < side * (i - (n - 1) / 2) / ((n - 1) / 2) < 0.72]
        if side < 0:
            idx = idx[::-1]
        Ps, Ns = P[idx], N[idx]
        Vs, Qs, Ts = path_loft(Ps + Ns * 0.0042 + A(0, -0.001, 0), 0.003, 0.0016, (0, 1, 0), profile=lens_profile(),
                               seg=6, sub=1, caps=(0.5, 0.5), cap_rings=2)
        out.append(mesh_part(f"slit{side}", Vs, Qs, Ts, "glow"))
    P, N = ctx["jawseam"]
    out.append(groove_trim("jawline", P, N, 0.0018, 0.0012, step=0.009))
    for side in (-1, 1):
        for j, (p, n) in enumerate(ctx["vents"][(side + 1) // 2]):
            out.append(slot_insert(f"vent{side}{j}", p - n * 0.0026, basis(x=(0, 0, -1), y=n), (0.012, 0.0016, 0.0015), "trim"))
        # Ear inner panel (steel).
        path = _wolf_ear_path(side)
        V, Q, T = path_loft([A(pp) + A(0, 0.004, -0.009) for pp in path[:3]], [0.022, 0.019, 0.008], [0.004, 0.0035, 0.002],
                            (1, 0, 0.25), profile=lens_profile(), caps=(0.2, 0.4), seg=12, sub=3, cap_rings=3)
        out.append(mesh_part(f"earpanel{side}", V, Q, T, "trim"))
    # Mounts: a bolt at each end of every plate.
    for i, (path, w, side, N) in enumerate(ctx["plates"]):
        for j in (3, int(len(path) * 0.62)):
            p = path[j]
            n = F.grad([p])[0]
            out.append(gk.fin(gk.rivet(f"bolt{i}{j}", tuple(p + n * 0.0034), tuple(n), r=0.0042, h=0.0028, segs=10), "trim"))
    cap = [with_k(mesh_prim(*_wolf_nosecap()), 0.0)]
    tip = A(0, -0.034, -0.246)
    for side in (-1, 1):
        cap.append(("cut", rounded_box(tip + A(side * 0.012, 0.006, 0.0), (0.0075, 0.0016, 0.008), 0.0008,
                                       rot((0, 0, 1), side * 0.35)), 0.0004))
    # a machined seam round the cap, and a ridge down its bridge
    ring = [A(math.cos(t) * 0.036, -0.025 + math.sin(t) * 0.022, -0.222) for t in np.linspace(0, 2 * math.pi, 33)]
    cap.append(("cut", sweep(ring, 0.0009), 0.0))
    out.append(sdf_part("nosecap", cap, "trim", tris=420, h=0.0006, pad=0.006))

    return out


def wolf_cranium(F, ctx):
    F.add(ellipsoid(*WOLF_DOME))
    clip(F, *WOLF_BROW_CLIP, k=0.008, hi=(0.2, 0.3, 0.0))
    return (0, 0.02, 0.03)


WOLF = Head("wolf", (-0.2, -0.17, -0.27), (0.2, 0.25, 0.23), wolf_form, wolf_parts, wolf_cranium,
            h_low=0.0022, sharp=40.0, lows=wolf_lows)


# ===========================================================================
# FROG — a sleek split shell, lens turrets with shutter lids, a lit smile
# ===========================================================================
#
# One wide low ceramic dome split along the jaw: the smile is that split,
# lit — an LED line in a steel channel corner to corner, lifting at the
# corners. The eyes are the frog: two machined turret collars on the crown,
# a big domed LENS in each, and a shell SHUTTER drawn half down over it
# (the cheeky look). Tympanum pods behind them in the shell's colour with a
# steel rim (a dark disc reads as a second pair of eyes); two steel intake
# slots for nostrils; crisp seams down the crown and round the turrets.

FROG_TOP = ((0, -0.012, 0.0), (0.152, 0.09, 0.15))
FROG_JAW = ((0, -0.034, 0.004), (0.144, 0.078, 0.14))
FROG_SPLIT = -0.044
# The top shell's facets: a flat deck between the turrets, a sloped snout
# face (the nostrils sit on it), and the split plane under it.
FROG_BRIDGE = ((0, 0.044, -0.035), (0.098, 0.04, 0.07))
FROG_FACETS = [((0, 0.72, -0.69), (0, 0.004, -0.122)), ((0, -1, 0), (0, FROG_SPLIT, 0)),
               ((0.94, 0.34, 0), (0.136, 0.0, 0)), ((-0.94, 0.34, 0), (-0.136, 0.0, 0)), ((0, 0.45, 0.89), (0, 0.025, 0.128))]


def _frog_turret(side):
    """Turret: base centre, axis (out of the shell), lens radius."""
    ax = unit((side * 0.42, 0.85, -0.32))
    base = A(side * 0.074, 0.058, -0.052)
    return base, ax, 0.034


def _frog_lid_fn(c, ax, R, thick, open_=0.1, side=1):
    """A SHUTTER: a spherical shell segment over the lens, its lower
    edge a crisp plane tilted down toward the nose."""
    look = unit(ax + A(0, 0, -0.6))
    edge_n = unit(A(0, 1, 0) + A(side * 0.25, 0, 0.0) - look * 0.15)

    def fn(X, Y, Z, detail):
        px, py, pz = X - c[0], Y - c[1], Z - c[2]
        sph = np.sqrt(px * px + py * py + pz * pz)
        shell = np.abs(sph - R) - thick / 2
        plane = -(px * edge_n[0] + py * edge_n[1] + pz * edge_n[2] - open_ * R)
        return smax(shell, plane, 0.0015)
    ext = R + thick
    return Prim(fn, c - ext, c + ext)


def _frog_lid_mesh(name, c, ax, R, thick, open_=0.1, side=1, segs=24, rings=5):
    """The shutter as a clean mesh: a spherical cap round its edge
    plane's normal, outer and inner skins and the rim between them."""
    look = unit(ax + A(0, 0, -0.6))
    en = unit(A(0, 1, 0) + A(side * 0.25, 0, 0.0) - look * 0.15)
    e1 = unit(np.cross(en, (0, 0, 1)))
    e2 = np.cross(en, e1)
    phi_max = math.acos(open_)
    P, faces = [], []
    radii = (R + thick / 2, R - thick / 2)
    for k, rr in enumerate(radii):
        P.append(c + en * rr)
        for i in range(1, rings + 1):
            ph = phi_max * i / rings
            for j in range(segs):
                t = 2 * math.pi * j / segs
                P.append(c + (en * math.cos(ph) + (e1 * math.cos(t) + e2 * math.sin(t)) * math.sin(ph)) * rr)
    per = 1 + rings * segs
    for k in range(2):
        o = k * per
        for j in range(segs):
            j1 = (j + 1) % segs
            f = (o, o + 1 + j, o + 1 + j1)
            faces.append(f if k == 0 else f[::-1])
        for i in range(rings - 1):
            a0 = o + 1 + i * segs
            b0 = a0 + segs
            for j in range(segs):
                j1 = (j + 1) % segs
                f = (a0 + j, b0 + j, b0 + j1, a0 + j1)
                faces.append(f if k == 0 else f[::-1])
    lo, li = 1 + (rings - 1) * segs, per + 1 + (rings - 1) * segs
    for j in range(segs):
        j1 = (j + 1) % segs
        faces.append((lo + j, li + j, li + j1, lo + j1))
    return poly_mesh(name, A(P), faces)


def plate_poly(c, R, outline, thick, chamfer, n=48, corner=6):
    """A machined PLATE: a closed outline (local x, z), `thick` half-thick
    along local y, its top edge chamfered. Returns (verts, quads, tris)."""
    f = gk.polygon_outline(outline, corner=corner)
    pts = [f(2 * math.pi * i / n) for i in range(n)]
    cx, cz = np.mean([p[0] for p in pts]), np.mean([p[1] for p in pts])
    rings = []
    for y, shrink in ((-thick, 0.0), (thick - chamfer, 0.0), (thick, chamfer)):
        ring = []
        for (x, z) in pts:
            dx, dz = x - cx, z - cz
            L = math.hypot(dx, dz) or 1.0
            ring.append((x - dx / L * shrink, y, z - dz / L * shrink))
        rings.append(A(ring) @ A(R).T + A(c))
    V = [p for r_ in rings for p in r_]
    Q = []
    for i in range(2):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            Q.append((a, b, b + n, a + n))
    T = []
    for k, row in ((0, 0), (1, 2)):
        ci = len(V)
        V.append(A(cx, -thick if k == 0 else thick, cz) @ A(R).T + A(c))
        for j in range(n):
            a, b = row * n + j, row * n + (j + 1) % n
            T.append((ci, b, a) if k == 0 else (ci, a, b))
    return A(V), np.array(Q), np.array(T)


FROG_BROW = [(-0.026, -0.03), (0.026, -0.03), (0.04, 0.0), (0.034, 0.03), (-0.034, 0.03), (-0.04, 0.0)]


def _frog_brow():
    R = basis(x=(1, 0, 0), y=(0, 1, 0))
    return plate_poly(A(0, 0.068, -0.05), R, FROG_BROW, 0.0042, 0.0022)


def _frog_jaw_clips():
    return [((0, 1, 0), (0, FROG_SPLIT + 0.006, 0)), ((0, -1, 0), (0, -0.097, 0)),
            ((0, -0.5, -0.87), (0, -0.075, -0.118)), ((0, 0.5, -0.86), (0, -0.05, -0.137)),
            ((0.8, -0.6, 0), (0.12, -0.08, 0)), ((-0.8, -0.6, 0), (-0.12, -0.08, 0))]


def _frog_lid_pins(c, ax, R, open_=0.1, side=1):
    look = unit(ax + A(0, 0, -0.6))
    en = unit(A(0, 1, 0) + A(side * 0.25, 0, 0.0) - look * 0.15)
    e1 = unit(np.cross(en, (0, 0, 1)))
    rr = R * math.sqrt(1 - open_ * open_) + 0.0025
    return [(c + en * (open_ * R) + e1 * rr * s, e1) for s in (-1, 1)]


def _frog_ridge(P, N, seg=32, sub=6, cap_rings=3):
    return path_loft(P + N * 0.002, [0.003, 0.006, 0.006, 0.006, 0.003], 0.0045, (1, 0, 0),
                     profile=chamfer_profile(top=0.6, side_top=0.3, side_bot=-0.6, bot=1.0, corner=3),
                     seg=seg, sub=sub, caps=(0.4, 0.4), cap_rings=cap_rings)


def frog_form(F, ctx):
    c, r = FROG_TOP
    F.add(ellipsoid(c, r))
    for n, p0 in FROG_FACETS:
        clip(F, n, p0, k=0.004)
    cj, rj = FROG_JAW
    jaw = ellipsoid(cj, rj)
    sl, d = F.eval(jaw, 0.01)
    if sl is not None:
        X, Y, Z = F._coords(*F._block(jaw.lo - 0.01, jaw.hi + 0.01)[1:])
        for n, p0 in _frog_jaw_clips():
            n, p0 = unit(n), A(p0)
            d = smax(d, ((X - p0[0]) * n[0] + (Y - p0[1]) * n[1] + (Z - p0[2]) * n[2]).astype(np.float32), 0.002)
        F.D[sl] = np.minimum(F.D[sl], d)
    # The crown between and behind the eyes: one rounded swell flowing
    # up into both turrets (no flat deck between them).
    F.add(ellipsoid(*FROG_BRIDGE), k=0.025)
    for side in (-1, 1):
        base, ax, Rl = _frog_turret(side)
        F.add(cylinder(base - ax * 0.008, ax, Rl + 0.014, 0.012, 0.004), k=0.016)
        lc = base + ax * 0.014
        F.add(_frog_lid_fn(lc, ax, Rl + 0.009, 0.005, side=side), k=0.0)
    if "smile" not in ctx:
        th = np.linspace(-1.75, 1.75, 41)
        a = np.abs(th / 1.75)
        ys = FROG_SPLIT + 0.022 * smoothstep(0.7, 1.0, a)
        P = drape_ring(F, ys, th, 0.0, r_out=0.35)
        ctx["smile"] = surface_path(F, P, 2)
        ctx["nos"] = [land(F, (s * 0.022, 0.25, -0.36), unit((0, -0.72, 0.69))) for s in (-1, 1)]
        # The dorsal ridge down the back, and a vent cluster each side.
        ridge = [land(F, (0, 0.3, z), (0, -1, 0))[0] for z in (0.045, 0.07, 0.095, 0.115)]
        ridge.append(land(F, (0, 0.03, 0.4), (0, 0, -1))[0])
        ctx["ridge"] = surface_path(F, A(ridge), 2)
        ctx["vents"] = [[land(F, (s * 0.03, 0.035 - 0.009 * j, 0.4), (0, 0, -1)) for j in range(3)] for s in (-1, 1)]
        # Cheek panels: a seam from the turret down to the smile.
        panels = []
        for s in (-1, 1):
            panels.append(seam_path(F, [(s * 0.3, 0.035, -0.03), (s * 0.3, 0.0, -0.035), (s * 0.3, -0.03, -0.04)], 16))
        ctx["panels"] = panels
    P, N = ctx["smile"]
    F.cut(sweep(P, 0.0042), k=0.0015)
    rP, rN = ctx["ridge"]
    F.add(mesh_prim(*_frog_ridge(rP, rN)), k=0.002)
    for p, n in ctx["nos"]:
        F.cut(rounded_box(p, (0.0022, 0.004, 0.009), 0.0012, basis(x=(1, 0, 0), y=n)), k=0.0008)
    for side in (-1, 1):
        for p, n in ctx["vents"][(side + 1) // 2]:
            F.cut(rounded_box(p, (0.012, 0.004, 0.0019), 0.001, basis(x=(1, 0, 0), y=n)), k=0.0006)
    for pth in ctx["panels"]:
        seam(F, pth)
    if F.detail:
        for side in (-1, 1):
            base, ax, Rl = _frog_turret(side)
            e1 = unit(np.cross(ax, (0, 0, 1)))
            e2 = unit(np.cross(ax, e1))
            ring = [base + (e1 * math.cos(t) + e2 * math.sin(t)) * (Rl + 0.022) for t in np.linspace(0, 2 * math.pi, 33)]
            seam(F, surface_path(F, A(ring), 1))


def frog_lows(F, ctx):
    c, r = FROG_TOP
    cj, rj = FROG_JAW
    out = [ellipsoid_mesh("top", c, r, segs=30, rings=16, clips=FROG_FACETS),
           ellipsoid_mesh("jaw", cj, rj, segs=28, rings=12, clips=_frog_jaw_clips()),
           ellipsoid_mesh("crown", *FROG_BRIDGE, segs=22, rings=10)]
    rP, rN = ctx["ridge"]
    out.append(np_mesh("ridge", *_frog_ridge(rP, rN, seg=10, sub=3, cap_rings=2)))
    for side in (-1, 1):
        base, ax, Rl = _frog_turret(side)
        out.append(cylinder_mesh(f"boss{side}", base - ax * 0.008, ax, Rl + 0.014, 0.012, segs=28))
        lc = base + ax * 0.014
        out.append(_frog_lid_mesh(f"lid{side}", lc, ax, Rl + 0.009, 0.005, side=side))
    return out


def frog_parts(F, ctx):
    out = []
    P, N = ctx["smile"]
    out.append(groove_trim("channel", P, N, 0.0036, 0.0022, sides=6, step=0.0095))
    out.append(groove_trim("smile", P + N * 0.0005, N, 0.0019, 0.0, sides=5, step=0.008))
    out[-1]["finish"] = "glow"
    for side in (-1, 1):
        base, ax, Rl = _frog_turret(side)
        lc = base + ax * 0.014
        # A stepped machined collar: a wide foot ring, a taller inner ring,
        # an iris ring round the lens.
        out.append(gk.fin(cylinder_mesh(f"foot{side}", base + ax * 0.003, ax, Rl + 0.011, 0.0035, segs=28), "trim"))
        out.append(gk.fin(cylinder_mesh(f"collar{side}", base + ax * 0.009, ax, Rl + 0.005, 0.0045, segs=28), "trim"))
        out.append(gk.fin(torus_mesh(f"iris{side}", lc + ax * 0.002, ax, Rl - 0.004, 0.0026, segs=28, sides=5), "trim"))
        out.append(gk.fin(ellipsoid_mesh(f"lens{side}", lc, (Rl, Rl, Rl), R=frame_look(ax), segs=16, rings=8), "glow"))
        for k, (pp, axp) in enumerate(_frog_lid_pins(lc, ax, Rl + 0.009, side=side)):
            out.append(gk.fin(cylinder_mesh(f"pin{side}{k}", pp, axp, 0.0045, 0.0035, segs=12), "trim"))
    for i, (p, n) in enumerate(ctx["nos"]):
        out.append(slot_insert(f"nos{i}", p - n * 0.0024, basis(x=(1, 0, 0), y=n), (0.0016, 0.0015, 0.0078), "trim"))
    for side in (-1, 1):
        for j, (p, n) in enumerate(ctx["vents"][(side + 1) // 2]):
            out.append(slot_insert(f"vent{side}{j}", p - n * 0.0025, basis(x=(1, 0, 0), y=n), (0.011, 0.0016, 0.0013), "trim"))
    return out


def frog_cranium(F, ctx):
    c, r = FROG_TOP
    F.add(ellipsoid(c, r))
    for n, p0 in FROG_FACETS:
        clip(F, n, p0, k=0.004)
    return (0, 0.0, 0.0)


FROG = Head("frog", (-0.2, -0.15, -0.2), (0.2, 0.15, 0.2), frog_form, frog_parts, frog_cranium,
            h_low=0.0022, sharp=40.0, lows=frog_lows)


# ===========================================================================
# BUNNY — a sleek egg, big lit lenses behind dark glass, engineered ears
# ===========================================================================
#
# The cute is in the proportions and the eyes: a tall ceramic egg, a dark
# goggle band across the face with two BIG rounded lit lenses, a small
# muzzle pod under it — a machined nose cap, steel whisker vents either
# side, a little machined teeth plate. The EARS are engineered fins, each
# hinged on a lit pod, a steel panel down the front and an LED line along
# the inner edge; the right one is ARTICULATED — three segments on steel
# knuckles, folded forward over the brow.

BUNNY_DOME = ((0, 0.014, 0.012), (0.104, 0.12, 0.114))
BUNNY_FACE = []
# The faceplate's outline (front view, x / y), right half from the top
# centre round to the bottom centre, mirrored.
_MASK_R = [(0.0, 0.047), (0.028, 0.061), (0.062, 0.058), (0.086, 0.036), (0.092, 0.0), (0.083, -0.034),
           (0.062, -0.05), (0.036, -0.046), (0.016, -0.03), (0.0, -0.027)]
MASK = _MASK_R + [(-x, y) for (x, y) in reversed(_MASK_R[1:-1])]
MASK_C = (0.0, 0.012)
BUNNY_EYE = [(s * 0.042, 0.022) for s in (-1, 1)]
BUNNY_MUZZLE = ((0, -0.05, -0.098), (0.031, 0.031, 0.032))
BUNNY_CHEEKS = [((s * 0.052, -0.05, -0.083), (0.032, 0.029, 0.03)) for s in (-1, 1)]
EAR_PROF = [(1, 0.35), (0.86, 1), (-0.86, 1), (-1, 0.35), (-1, -0.35), (-0.86, -1), (0.86, -1), (1, -0.35)]


def clipped_ellipsoid(c, r, clips, k=0.0015):
    """An ellipsoid cut flat by planes [(normal, point)] — a machined pod."""
    e = ellipsoid(c, r)
    cl = [(unit(n), A(p0)) for n, p0 in clips]

    def fn(X, Y, Z, detail):
        d = e.fn(X, Y, Z, detail)
        for n, p0 in cl:
            d = smax(d, (X - p0[0]) * n[0] + (Y - p0[1]) * n[1] + (Z - p0[2]) * n[2], k)
        return d
    return Prim(fn, e.lo, e.hi)


def _muzzle_clips():
    c, r = BUNNY_MUZZLE
    return [((0, 0.25, -1), (0, 0, c[2] - r[2] * 0.72)), ((0, -1, -0.5), (0, c[1] - r[1] * 0.7, c[2] - r[2] * 0.3))]


def _cheek_clips(i):
    c, r = BUNNY_CHEEKS[i]
    s = -1 if i == 0 else 1
    return [(unit((s * 0.8, 0, -0.6)), c + unit((s * 0.8, 0, -0.6)) * r[0] * 0.7)]


def _dome_front(x, y, out=0.0):
    """The dome's front surface over (x, y): point and normal."""
    (cx, cy, cz), (rx, ry, rz) = BUNNY_DOME
    u = 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2
    z = cz - rz * math.sqrt(max(u, 1e-4))
    n = unit(((x - cx) / rx ** 2, (y - cy) / ry ** 2, (z - cz) / rz ** 2))
    return A(x, y, z) + n * out, n


def _mask(lift=0.0055, thick=0.006, chamfer=0.0018, n=72, rings=8):
    """THE FACEPLATE: a raised panel over the eyes and cheeks, following
    the dome, its edge chamfered crisp."""
    f = gk.polygon_outline([(x - MASK_C[0], y - MASK_C[1]) for (x, y) in MASK], corner=4)
    edge = [f(2 * math.pi * i / n) for i in range(n)]
    V, Q, T = [], [], []

    def ring(scale, out, inset=0.0):
        pts = []
        for (ex, ey) in edge:
            L = math.hypot(ex, ey) or 1.0
            s = scale * (1 - inset / L)
            p, nn = _dome_front(MASK_C[0] + ex * s, MASK_C[1] + ey * s, out)
            pts.append(p)
        return pts
    rows = []
    for k in range(1, rings + 1):
        rows.append(ring(k / rings * (1 - 0.02), lift))
    rows.append(ring(1.0, lift, inset=chamfer))
    rows.append(ring(1.0, lift - chamfer))
    rows.append(ring(1.0, -thick))
    c_top, _ = _dome_front(MASK_C[0], MASK_C[1], lift)
    c_bot, _ = _dome_front(MASK_C[0], MASK_C[1], -thick)
    V = [c_top] + [p for r_ in rows for p in r_] + [c_bot]
    for j in range(n):
        T.append((0, 1 + j, 1 + (j + 1) % n))
    for i in range(len(rows) - 1):
        a0, b0 = 1 + i * n, 1 + (i + 1) * n
        for j in range(n):
            j1 = (j + 1) % n
            Q.append((a0 + j, b0 + j, b0 + j1, a0 + j1))
    last = 1 + (len(rows) - 1) * n
    cb = len(V) - 1
    for j in range(n):
        T.append((cb, last + (j + 1) % n, last + j))
    return A(V), np.array(Q), np.array(T)


def _bunny_ear_segments(side):
    if side < 0:
        return [([(side * 0.04, 0.11, 0.022), (side * 0.048, 0.19, 0.032), (side * 0.056, 0.27, 0.043), (side * 0.06, 0.312, 0.05)],
                 [0.026, 0.034, 0.032, 0.014])]
    return [([(0.04, 0.11, 0.022), (0.046, 0.16, 0.028), (0.05, 0.198, 0.032)], [0.026, 0.033, 0.033]),
            ([(0.052, 0.214, 0.026), (0.055, 0.236, 0.0), (0.057, 0.243, -0.03)], [0.032, 0.032, 0.031]),
            ([(0.058, 0.236, -0.05), (0.06, 0.212, -0.074), (0.061, 0.186, -0.086)], [0.03, 0.026, 0.012])]


def _bunny_knuckles():
    return [A(0.051, 0.206, 0.03), A(0.057, 0.242, -0.04)]


def _bunny_ear(path, wid, seg=40, sub=8, thk=0.0088):
    return path_loft(path, wid, [thk] * len(path), (1, 0, 0.2), profile=profile_poly(EAR_PROF, corner=8), seg=seg, sub=sub,
                     caps=(0.4, 0.9), cap_rings=max(3, sub // 2))


def _bunny_lens(side):
    x, y = BUNNY_EYE[(side + 1) // 2]
    p, n = _dome_front(x, y, 0.0055)
    R = basis(x=unit(np.cross((0, 1, 0), n)), y=n)
    return p, n, R


def _bunny_teeth():
    out = []
    p, n = _dome_front(0, -0.086, 0.0)
    for s in (-1, 1):
        R = basis(x=(1, 0, 0), y=unit((0, -0.1, -1)))
        c = A(s * 0.0072, -0.0735, -0.1135)
        out.append((c, R))
    return out


def bunny_form(F, ctx):
    c, r = BUNNY_DOME
    F.add(ellipsoid(c, r))
    F.add(mesh_prim(*_mask()), k=0.0)
    F.add(clipped_ellipsoid(*BUNNY_MUZZLE, _muzzle_clips()), k=0.008)
    for i, (cc, rr) in enumerate(BUNNY_CHEEKS):
        F.add(clipped_ellipsoid(cc, rr, _cheek_clips(i)), k=0.008)
    for cR in _bunny_teeth():
        F.add(mesh_prim(*plate_poly(cR[0], cR[1], [(-0.0062, -0.009), (0.0062, -0.009), (0.0062, 0.009), (-0.0062, 0.009)],
                                    0.0035, 0.0012, n=24, corner=3)), k=0.001)
    for side in (-1, 1):
        for path, wid in _bunny_ear_segments(side):
            F.add(mesh_prim(*_bunny_ear(path, wid)), k=0.005)
    if "nose" not in ctx:
        ctx["nose"] = land(F, (0, -0.03, -0.4), (0, 0, 1))
        vents = []
        for s in (-1, 1):
            cc, rr = BUNNY_CHEEKS[(s + 1) // 2]
            d = unit((s * 0.75, 0, -0.66))
            vents.append([land(F, cc + A(0, 0.008 - 0.008 * j, 0) + d * 0.2, -d) for j in range(3)])
        ctx["vents"] = vents
        th = np.linspace(-0.55, 0.55, 17)
        ctx["mouth"] = surface_path(F, drape_ring(F, -0.079 + 0.004 * (th / 0.55) ** 2, th, -0.06, r_out=0.3), 1)
        ctx["crown"] = seam_path(F, [(0, 0.3, -0.04), (0, 0.3, 0.02), (0, 0.3, 0.07), (0, 0.1, 0.16), (0, -0.02, 0.17)], 40)
        # The bandit band: dark visor glass across the eyes, over the
        # faceplate, temple to temple.
        th = np.linspace(-1.25, 1.25, 31)
        ys = BUNNY_EYE[0][1] + 0.01 * (th / 1.25) ** 2
        ctx["visor"] = surface_path(F, drape_ring(F, ys, th, 0.0, r_out=0.35), 2)
    P, N = ctx["visor"]
    F.cut(sweep((P + N * 0.002)[2:-2], 0.0245), k=0.002)
    for side in (-1, 1):
        for p, n in ctx["vents"][(side + 1) // 2]:
            F.cut(rounded_box(p, (0.011, 0.004, 0.0018), 0.001, basis(x=unit(np.cross(n, (0, 1, 0))), y=n)), k=0.0006)
    seam(F, ctx["crown"])


def bunny_lows(F, ctx):
    c, r = BUNNY_DOME
    out = [ellipsoid_mesh("dome", c, r, segs=30, rings=18),
           np_mesh("mask", *_mask(n=40, rings=4)),
           ellipsoid_mesh("muzzle", *BUNNY_MUZZLE, segs=20, rings=12, clips=_muzzle_clips())]
    for i, (cc, rr) in enumerate(BUNNY_CHEEKS):
        out.append(ellipsoid_mesh(f"cheek{i}", cc, rr, segs=20, rings=12, clips=_cheek_clips(i)))
    for i, cR in enumerate(_bunny_teeth()):
        out.append(np_mesh(f"tooth{i}", *plate_poly(cR[0], cR[1], [(-0.0062, -0.009), (0.0062, -0.009), (0.0062, 0.009), (-0.0062, 0.009)],
                                                     0.0035, 0.0012, n=16, corner=3)))
    for side in (-1, 1):
        for i, (path, wid) in enumerate(_bunny_ear_segments(side)):
            out.append(np_mesh(f"ear{side}{i}", *_bunny_ear(path, wid, seg=14, sub=3)))
    return out


def bunny_parts(F, ctx):
    out = []
    # The bandit band: dark glass across the eyes, the two big rounded
    # lenses lit in it.
    P, N = ctx["visor"]
    V, Q, T = path_loft(P + N * 0.0012, 0.023, 0.0034, lambda t: A(0, 1, 0), profile=profile_poly(EAR_PROF, corner=6),
                        seg=8, sub=1, caps=(0.3, 0.3), cap_rings=2)
    out.append(mesh_part("visor", V, Q, T, "trim"))
    n_ = len(P)
    for side in (-1, 1):
        i = int(round((n_ - 1) / 2 + side * 0.33 * (n_ - 1) / 2))
        p, nn = P[i], N[i]
        out.append(sdf_part(f"lens{side}", [with_k(slab(p + nn * 0.005, basis(x=unit(np.cross((0, 1, 0), nn)), y=nn),
                                                         0.0205, 0.0185, 0.009, 0.0017), 0.0)],
                            "glow", tris=200, h=0.0007))
    # The teeth's steel mount strip, across their roots under the muzzle.
    out.append(sdf_part("toothbar", [with_k(rounded_box(A(0, -0.0662, -0.1135), (0.0145, 0.0018, 0.004), 0.0012), 0.0)],
                        "trim", tris=60, h=0.0006))
    nP, nN = ctx["nose"]
    Rn = basis(x=(1, 0, 0), y=nN)
    out.append(mesh_part("nosecap", *plate_poly(nP + nN * 0.0012, Rn, [(-0.012, 0.006), (0.012, 0.006), (0.0035, -0.008), (-0.0035, -0.008)],
                                                0.0028, 0.0012, n=24, corner=5), "trim"))
    for side in (-1, 1):
        for j, (p, n_) in enumerate(ctx["vents"][(side + 1) // 2]):
            out.append(slot_insert(f"vent{side}{j}", p - n_ * 0.0025, basis(x=unit(np.cross(n_, (0, 1, 0))), y=n_),
                                   (0.0102, 0.0016, 0.0012), "trim"))
        segs = _bunny_ear_segments(side)
        for k, (path, wid) in enumerate(segs):
            Pp = [A(p) for p in path]
            V, Q, T = path_loft([p + A(0, 0, -0.0075) for p in Pp], [w * 0.62 for w in wid], 0.0022, (1, 0, 0.2),
                                profile=profile_poly(EAR_PROF, corner=8), seg=10, sub=3, caps=(0.4, 0.9), cap_rings=2)
            out.append(mesh_part(f"earpanel{side}{k}", V, Q, T, "trim"))
            edge = [p_ + A(-side * w * 0.93, 0, -0.002) for p_, w in zip(Pp, wid)]
            out.append(gk.fin(gk.tube(f"led{side}{k}", [tuple(e) for e in edge], 0.0016, sides=5, step=0.007), "glow"))
    for i, kp in enumerate(_bunny_knuckles()):
        out.append(gk.fin(cylinder_mesh(f"knuckle{i}", kp, (1, 0, 0), 0.0075, 0.016, segs=16), "trim"))
    return out


def bunny_cranium(F, ctx):
    c, r = BUNNY_DOME
    F.add(ellipsoid(c, r))
    for n, p0 in BUNNY_FACE:
        clip(F, n, p0, k=0.006)
    return (0, 0.03, 0.01)


BUNNY = Head("bunny", (-0.2, -0.15, -0.2), (0.2, 0.36, 0.2), bunny_form, bunny_parts, bunny_cranium,
             h_low=0.0022, sharp=40.0, lows=bunny_lows)


# ===========================================================================
# STALLION — FF1's horse skull (the one that was right), finished
# ===========================================================================

HORSE_U = 0.13 * 1.1025 * 1.08
HORSE_DY = -0.06
HORSE_DZ = 0.0
HORSE_ST = [
    dict(top=(0.88, 0.42), bot=(0.1, 0.52), w=0.26, n=2.0),  # occiput
    dict(top=(1.02, 0.22), bot=(-0.05, 0.4), w=0.36, n=2.0),  # poll
    dict(top=(0.98, -0.02), bot=(-0.22, 0.26), w=0.44, n=2.1),  # temples
    dict(top=(0.74, -0.3), bot=(-0.34, 0.1), w=0.47, n=2.2),  # brow (widest)
    dict(top=(0.52, -0.5), bot=(-0.42, -0.05), w=0.42, n=2.2),  # orbits
    dict(top=(0.22, -0.76), bot=(-0.52, -0.32), w=0.33, n=2.1),  # cheekbone
    dict(top=(-0.06, -0.97), bot=(-0.62, -0.62), w=0.27, n=2.0),  # mid face
    dict(top=(-0.3, -1.15), bot=(-0.72, -0.92), w=0.225, n=1.9),  # upper muzzle
    dict(top=(-0.45, -1.27), bot=(-0.79, -1.1), w=0.235, n=1.85),  # nostril flare
    dict(top=(-0.58, -1.37), bot=(-0.85, -1.24), w=0.185, n=1.8),  # nose
    dict(top=(-0.68, -1.41), bot=(-0.84, -1.33), w=0.1, n=1.7),  # tip
]
HORSE_CAPS = (0.6, 0.6)


def _horse_ears():
    u, dy = HORSE_U, HORSE_DY
    ears = []
    for side in (-1, 1):
        R = euler(0.1, side * -0.2, side * -0.12)
        o = A(side * 0.19 * u, 0.9 * u + dy, 0.1 * u)
        ears.append(Ear(o, R, (0.26 * u, 0.62 * u, 0.15 * u, 0.95, 0.05 * u), (0.14 * u, 0.42 * u, 0.05 * u, 0.95, 0.04 * u),
                        0.25 * u, lift=0.26 * u, k=0.014, hollow=0.005))
    return ears


def _horse_eye(side):
    """The eye's centre and a frame whose −z looks OUT of the head (a
    horse's eyes are on the sides), x running along the face."""
    u, dy = HORSE_U, HORSE_DY
    o = rot((0, 1, 0), side * -0.45) @ A(side, 0, 0)
    z = -unit(o)
    y = A(0, 1, 0)
    x = unit(np.cross(y, z))
    R = np.stack([x, y, z], 1)
    c = A(side * 0.385 * u, 0.34 * u + dy, -0.43 * u)
    return c, R


def _station_ring(i, a0, a1, n=28, out=1.0):
    u, dy = HORSE_U, HORSE_DY
    return A([on_loft(HORSE_ST[i], a, u, dy, out) for a in np.linspace(a0, a1, n)])


def horse_form(F, ctx):
    u, dy = HORSE_U, HORSE_DY
    F.add(mesh_prim(*loft(HORSE_ST, u, dy, caps=HORSE_CAPS)))
    for side in (-1, 1):
        # Jowls: the round masseter discs at the back of the jaw.
        F.add(ellipsoid((side * 0.27 * u, 0.0 + dy, 0.02 * u), (0.15 * u, 0.36 * u, 0.33 * u), rot((1, 0, 0), 0.35)), k=0.03)
        # The facial crest: the ridge of bone run forward off the jowl.
        F.add(ellipsoid((side * 0.33 * u, 0.12 * u + dy, -0.48 * u), (0.045 * u, 0.06 * u, 0.3 * u),
                        euler(-0.55, side * -0.12, 0)), k=0.03)
        # The brow bone over the eye.
        F.add(ellipsoid((side * 0.35 * u, 0.5 * u + dy, -0.44 * u), (0.05 * u, 0.035 * u, 0.15 * u),
                        euler(-0.35, side * -0.45, side * -0.35)), k=0.03)
        # Nostril flares: round, open.
        F.add(ellipsoid((side * 0.17 * u, -0.56 * u + dy, -1.26 * u), (0.085 * u, 0.11 * u, 0.085 * u),
                        euler(0.6, side * -0.3, 0)), k=0.016)
    # The chin.
    F.add(ellipsoid((0, -0.86 * u + dy, -1.12 * u), (0.12 * u, 0.085 * u, 0.12 * u)), k=0.016)
    # Forelock and mane: locks LYING on the skull, every one fluted in
    # the sculpt — the forelock falling down the forehead between the
    # ears, the mane down the nape and over to one side, as a mane falls.
    fl = dict(n=5, amp=0.0016, twist=1.6, start=0.12)
    if "locks" not in ctx:
        locks = []
        for i, (dx, lean, L) in enumerate(((0.0, 0.0, 0.66), (-0.13, -0.35, 0.5), (0.13, 0.4, 0.54))):
            root = A(dx * u, 1.08 * u + dy, 0.0)
            locks.append(lock_path(F, root, (lean, -0.4, -1), L * u, 0.075 * u, steps=7, lift=1.0, tip=0.3))
        # The mane's crest: a ridge from the poll down the back of the
        # skull, the locks springing off it and falling to the right.
        crest = [A(0, (1.12 - t * 1.05) * u + dy, (0.2 + t * 0.62 - t * t * 0.12) * u) for t in np.linspace(0, 1, 8)]
        ctx["crest"] = crest
        for i in range(9):
            t = i / 8
            root = A(0.02 * u, (1.1 - t * 0.95) * u + dy, (0.24 + t * 0.5 - t * t * 0.1) * u)
            d = (0.55, 0.1 - 0.25 * t, 0.55)
            locks.append(lock_path(F, root, d, (0.92 - 0.12 * t) * u, (0.13 - 0.025 * t) * u, steps=9, lift=1.0,
                                   hang=(0.0, -0.05, 0.01), tip=0.3, free_after=0.22))
        ctx["locks"] = locks
    F.add(sweep(ctx["crest"], [0.07 * u] * 7 + [0.04 * u]), k=0.02)
    for i, (P, rr) in enumerate(ctx["locks"]):
        F.add(sweep(P, rr, flute=dict(fl, phase=i * 0.9)), k=0.006)
    for e in _horse_ears():
        e.add(F)
    if "lips" not in ctx:
        # The lip line along the muzzle's lower flank, round the front.
        right = []
        for i in range(7, 10):
            for t in np.linspace(0, 1, 6, endpoint=False):
                a0 = HORSE_ST[i]
                b0 = HORSE_ST[i + 1]
                st = {k: (tuple(np.array(a0[k]) + (np.array(b0[k]) - np.array(a0[k])) * t) if k in ("top", "bot") else a0[k] + (b0[k] - a0[k]) * t) for k in a0}
                right.append(on_loft(st, -0.95, u, dy, 1.0))
        right.append(on_loft(HORSE_ST[10], -0.95, u, dy, 1.0))
        pts = [mirror(p) for p in right] + right[::-1]
        ctx["lips"] = surface_path(F, A(pts), 2)
        # The bridle on the skull: noseband round the upper muzzle, a
        # cheekpiece up each side to the poll, browband and crownpiece.
        ctx["noseband"] = F.project(_station_ring(7, -math.pi * 0.5, math.pi * 1.5, n=40, out=1.0))
        ctx["brow"] = F.project(_station_ring(2, 0.08, math.pi - 0.08, n=26))
        ctx["crown"] = F.project(_station_ring(1, -0.15, math.pi + 0.15, n=26))
        cheeks = []
        for side in (-1, 1):
            a = 0.08 if side == 1 else math.pi - 0.08
            pts = [on_loft(HORSE_ST[i], a, u, dy) for i in (8, 7, 6, 5, 4, 3, 2)]
            # run on up to meet the crownpiece behind the ear
            pts.append(on_loft(HORSE_ST[1], -0.15 if side == 1 else math.pi + 0.15, u, dy))
            P = A(pts)
            dense = []
            for j in range(len(P) - 1):
                for t in np.linspace(0, 1, 5, endpoint=False):
                    dense.append(P[j] + (P[j + 1] - P[j]) * t)
            dense.append(P[-1])
            cheeks.append(surface_path(F, A(dense), 2))
        ctx["cheeks"] = cheeks
        nos = []
        for side in (-1, 1):
            tgt = A(side * 0.17 * u, -0.53 * u + dy, -1.27 * u)
            o = unit((side * 0.55, 0.25, -1))
            nos.append(land(F, tgt + o * 0.12, -o))
        ctx["nostrils"] = nos
    # Nostril holes.
    for P, N in ctx["nostrils"]:
        F.cut(ellipsoid(P + N * 0.002, (0.05 * u, 0.012, 0.066 * u), basis(y=N, x=(0, 1, 0))), k=0.005)
    # The lip line's groove.
    P, N = ctx["lips"]
    F.cut(sweep(P, 0.0026), k=0.0015)


def horse_parts(F, ctx):
    u, dy = HORSE_U, HORSE_DY
    out = []
    for i, e in enumerate(_horse_ears()):
        out.append(e.insert(f"inner{i}"))
    P, N = ctx["lips"]
    out.append(groove_trim("lips", P, N, 0.0019, 0.0012, step=0.006))
    for i, (P, N) in enumerate(ctx["nostrils"]):
        out.append(gk.fin(ellipsoid_mesh(f"nos{i}", P - N * 0.012, (0.046 * u, 0.0065, 0.06 * u), R=basis(y=N, x=(0, 1, 0)), segs=10, rings=6), "trim"))
    # THE BRIDLE.
    W, T = 0.011, 0.0026
    P, N = ctx["noseband"]
    out.append(gk.fin(strap("noseband", P + N * 0.0004, N, W, T, closed=True), "trim"))
    for name in ("brow", "crown"):
        P, N = ctx[name]
        out.append(gk.fin(strap(name, P + N * 0.0004, N, W * 0.9, T), "trim"))
    for i, (P, N) in enumerate(ctx["cheeks"]):
        out.append(gk.fin(strap(f"cheek{i}", P + N * 0.003, N, W * 0.9, T), "trim"))
        # A ring where the cheekpiece crosses the noseband, and the bit
        # ring at the corner of the mouth.
        q = P[5]
        out.append(gk.fin(torus_mesh(f"ring{i}", q + N[5] * 0.005, N[5], 0.008, 0.0018, segs=12, sides=4), "trim"))
        b = P[0]
        out.append(gk.fin(torus_mesh(f"bit{i}", b + N[0] * 0.004, A(1, 0, 0), 0.011, 0.002, segs=14, sides=4), "trim"))
    # Eyes: glass in a dark liner, a bezel where the liner meets the skin.
    for side in (-1, 1):
        c, R = _horse_eye(side)
        look = R @ A(0, 0, -1)
        r_l = A(0.115 * u, 0.09 * u, 0.062 * u)
        r_g = A(0.1 * u, 0.076 * u, 0.056 * u)
        Re = R @ rot((0, 0, 1), side * 0.18)
        out.append(gk.fin(ellipsoid_mesh(f"liner{side}", c, r_l, R=Re, segs=14, rings=7), "trim"))
        out.append(gk.fin(ellipsoid_mesh(f"eye{side}", c + look * 0.006, r_g, R=Re, segs=14, rings=7), "glow"))
        Pr, Nr, cl = lens_rim(F, c, Re, r_l, n=30)
        out.append(loop_tube(f"bezel{side}", Pr, 0.0019, sides=5, closed=cl))
    return out


def horse_cranium(F, ctx):
    F.add(mesh_prim(*loft(HORSE_ST[:5], HORSE_U, HORSE_DY, caps=(0.6, 0.4))))
    return (0, 0.45 * HORSE_U + HORSE_DY, 0.0)


HORSE = Head("stallion", (-0.17, -0.22, -0.28), (0.17, 0.28, 0.2), horse_form, horse_parts, horse_cranium, shell_tris=4950)


# Each head's FIT (measure_fit, re-measured on every build and written to
# the manifest from there; these are the values it measured).
PIECES = {
    "stallion": dict(slot="face", build=HORSE.build, tex=1024, uv_angle=66,
                     fit=dict(s=(0.589, 0.904, 0.694), y=-0.0302, z=0.0125),
                     view=dict(target=(0, -0.03, -0.05), dist=1.2)),
    "wolf": dict(slot="face", build=WOLF.build, tex=1024, uv_angle=66,
                 fit=dict(s=(0.851, 0.861, 0.936), y=0.0064, z=0.03),
                 view=dict(target=(0, 0.0, -0.03), dist=1.1)),
    "frog": dict(slot="face", build=FROG.build, tex=1024, uv_angle=66,
                 fit=dict(s=(1.2, 0.846, 1.166), y=-0.0375, z=0.01)),
    "bunny": dict(slot="face", build=BUNNY.build, tex=1024, uv_angle=66,
                  fit=dict(s=(0.851, 0.923, 0.9), y=0.008, z=0.0125),
                  view=dict(target=(0, 0.08, -0.01), dist=1.3)),
}

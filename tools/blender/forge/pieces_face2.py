"""
THE HEADS II — Forge pieces for the `face` slot (heads.ts, DESIGN.md §5.2):
STALLION, WOLF, FROG and BUNNY, remade from the procedural lofts.

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

def ellipsoid_mesh(name, c, r, R=None, segs=16, rings=10):
    """A UV ellipsoid (game space)."""
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

    def __init__(self, pid, lo, hi, form, parts, cranium, shell_tris=6000, blur=1, keep=0.85):
        self.pid, self.lo, self.hi = pid, lo, hi
        self.form, self.parts, self.cranium = form, parts, cranium
        self.shell_tris, self.blur_n, self.keep = shell_tris, blur, keep

    def build(self, ref):
        # A worn head REPLACES the skull: the reference stays out of the
        # icon (--showref keeps it in a review, to see the hitbox).
        if "--showref" not in sys.argv:
            ref.hide_render = True
        ctx = {}
        objs = []
        low = Field(self.lo, self.hi, H_LOW, detail=False)
        self.form(low, ctx)
        low.blur(self.blur_n)
        shell = low.mesh("shell")
        print(f"{self.pid}: low field {tuple(low.n)} -> {tris_of(shell)} tris", flush=True)
        # How much of the hitbox sphere the head covers.
        g = np.random.default_rng(1).normal(size=(4000, 3))
        g = g / np.linalg.norm(g, axis=1, keepdims=True) * 0.13
        inside = (low.sample(g) < 0).mean()
        print(f"{self.pid}: covers {inside * 100:.0f}% of the hitbox sphere's surface", flush=True)
        decimate(shell, self.shell_tris, low, keep=self.keep)
        f0 = folds(shell)
        relax(shell, low)
        print(f"{self.pid}: shell folds {f0} -> {folds(shell)} after relax", flush=True)
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
# FROG — a tree frog, round and pleased with itself
# ===========================================================================

FROG_U = 0.13 * 1.296 * 1.12
FROG_DY = -0.018
FROG_W = 0.93  # a touch narrower than FF1's: carried bigger, kept to ~0.31 m
FROG_ST = [
    # FF1's stations reworked: a fuller, squarer face (the jaw carried
    # forward under the mouth, so the grin sits mid-face and the chin
    # shows below it), a domed snout instead of the pointed tip ring.
    dict(top=(0.36, 0.56), bot=(-0.40, 0.58), w=0.62, n=2.2),  # back
    dict(top=(0.50, 0.26), bot=(-0.60, 0.32), w=0.82, n=2.4),  # crown
    dict(top=(0.46, -0.06), bot=(-0.66, 0.0), w=0.86, n=2.6),  # cheeks (widest)
    dict(top=(0.36, -0.40), bot=(-0.64, -0.34), w=0.8, n=2.6),  # eye line
    dict(top=(0.20, -0.68), bot=(-0.60, -0.66), w=0.7, n=2.25),  # snout
    dict(top=(0.04, -0.86), bot=(-0.52, -0.86), w=0.56, n=2.05),  # lip
]
FROG_CAPS = (0.35, 0.32)
for _s in FROG_ST:
    _s["w"] *= FROG_W


def _frog_eye(side):
    u = FROG_U
    c = A(side * 0.42 * u, 0.42 * u + FROG_DY, -0.3 * u)
    look = unit((side * 0.38, 0.12, -1))
    lens_c = c + look * 0.1 * u
    return c, look, lens_c, 0.32 * u, 0.255 * u


def frog_form(F, ctx):
    u, dy = FROG_U, FROG_DY
    F.add(mesh_prim(*loft(FROG_ST, u, dy, caps=FROG_CAPS)))
    for side in (-1, 1):
        c, look, lc, Rt, Rl = _frog_eye(side)
        F.add(ellipsoid(c, (Rt, Rt * 0.96, Rt)), k=0.035)
    if "smile" not in ctx:
        # THE SMILE: one line corner to corner, swept from inside the head
        # round the snout and landed on the skin (heads.ts' drape), the
        # corners lifting into a grin under the eardrums.
        sw = 1.85
        th = np.linspace(-sw, sw, 91)
        a = np.abs(th / sw)
        ys = -0.24 * u + dy + 0.22 * u * a ** 2.2 + 0.07 * u * smoothstep(0.8, 1.0, a)
        P = drape_ring(F, ys, th, -0.1 * u)
        ctx["smile"] = surface_path(F, P, 3)
        # Eardrums and nostrils, found on the skin.
        ctx["drum"] = [land(F, (side * 0.4, 0.06 * u + dy, 0.14 * u), (-side, 0, 0)) for side in (-1, 1)]
        ctx["nos"] = [land(F, (side * 0.11 * u, 0.3 * u + dy, -1.3 * u), unit((0, -0.35, 1))) for side in (-1, 1)]
        # The canthal ridges: eye to nostril, framing the snout's top.
        ridge = []
        for side in (-1, 1):
            q = []
            for t in np.linspace(0, 1, 9):
                q.append(land(F, (side * (0.36 - 0.22 * t) * u, 0.5, (-0.48 - 0.42 * t) * u), (0, -1, 0))[0])
            ridge.append(surface_path(F, A(q), 2))
        ctx["ridge"] = ridge
    for side in (-1, 1):
        c, look, lc, Rt, Rl = _frog_eye(side)
        # The socket the lens sits in: a ring of shadow round the glass.
        # (front half only: behind the glass the turret stays shut)
        def sock_fn(X, Y, Z, detail, lc=lc, look=look, Rl=Rl):
            px, py, pz = X - lc[0], Y - lc[1], Z - lc[2]
            sph = np.sqrt(px * px + py * py + pz * pz) - (Rl + 0.0022)
            ahead = px * look[0] + py * look[1] + pz * look[2]
            return smax(sph, -(ahead + 0.004), 0.002)
        F.cut(Prim(sock_fn, lc - Rl - 0.01, lc + Rl + 0.01), k=0.002)
        # The lower lid: a soft roll round the bottom of the glass.
        e1 = unit(np.cross(look, (0, 1, 0)))
        e2 = np.cross(e1, look)
        arc = [lc + look * 0.002 + (e1 * math.cos(a) + e2 * math.sin(a)) * (Rl + 0.0045)
               for a in np.linspace(math.radians(-200), math.radians(20), 14)]
        F.add(sweep(arc, [0.0025] + [0.0042] * 12 + [0.0025]), k=0.005)
        # The LID: a thick cap over the top of the glass, its margin
        # rolled, drawn half down — the look that makes it a character.
        Rl_lid = Rl + 0.0045
        R = basis(x=(1, 0, 0), y=rot((1, 0, 0), -0.32) @ A(0, 1, 0))
        R = rot(A(0, 0, 1), side * -0.12) @ R

        def lid_fn(X, Y, Z, detail, lc=lc, R=R, Rl_lid=Rl_lid, Rl=Rl):
            q0, q1, q2 = _local(X, Y, Z, lc, R)
            sph = np.sqrt(q0 * q0 + q1 * q1 + q2 * q2)
            shell = np.abs(sph - Rl_lid) - 0.0042
            plane = -(q1 - Rl * 0.05)
            d = smax(shell, plane, 0.006)
            if detail:
                # A soft crease along the lid, above its margin.
                cr = np.abs(q1 - Rl * 0.32)
                d = d + 0.0006 * np.exp(-(cr / 0.0018) ** 2) * (q2 < 0)
            return d
        ext = Rl_lid + 0.01
        F.add(Prim(lid_fn, lc - ext, lc + ext), k=0.004)
    # The lower lip: a full roll under the smile, so the chin faces
    # forward and catches the light, and the line reads as a mouth.
    P, N = ctx["smile"]
    up = A(0, 1, 0)
    n = len(P)
    rr = [0.003 + 0.006 * math.sin(math.pi * i / (n - 1)) ** 0.6 for i in range(n)]
    F.add(sweep(P - N * 0.009 - up * 0.008, rr), k=0.012)
    # The eardrums: discs in the shell's own colour (dark ones gave it four
    # eyes), standing a little proud, a fine rim round each in the sculpt.
    for dc, n in ctx["drum"]:
        R = basis(x=(0, 1, 0), y=n)
        F.add(ellipsoid(dc - n * 0.004, (0.165 * u, 0.006, 0.165 * u), R), k=0.003)
        if F.detail:
            def rim(X, Y, Z, detail, dc=dc, R=R):
                q0, q1, q2 = _local(X, Y, Z, dc, R)
                rr = np.sqrt(q0 * q0 + q2 * q2)
                return np.sqrt((rr - 0.165 * u + 0.002) ** 2 + (q1 - 0.0015) ** 2) - 0.0014
            F.cut(Prim(rim, dc - 0.25 * u, dc + 0.25 * u), k=0.001)
    # Nostrils: two pin pits high on the snout.
    for P, N in ctx["nos"]:
        F.cut(ellipsoid(P + N * 0.0008, (0.0042, 0.0034, 0.0042), basis(y=N)), k=0.002)
    # The smile's groove.
    P, N = ctx["smile"]
    groove_cut(F, P, 0.0028, k=0.0015)


def frog_parts(F, ctx):
    out = []
    P, N = ctx["smile"]
    out.append(groove_trim("smile", P, N, 0.002, 0.0012, step=0.008))
    for side in (-1, 1):
        c, look, lc, Rt, Rl = _frog_eye(side)
        out.append(gk.fin(ellipsoid_mesh(f"lens{side}", lc, (Rl,) * 3, R=basis(y=look), segs=18, rings=10), "glow"))
        # The socket's dark backing, and a machined bezel round the
        # opening (found on a sphere just outside the socket's cut).
        out.append(gk.fin(ellipsoid_mesh(f"sock{side}", lc - look * 0.006, (Rl + 0.0024,) * 3, R=frame_look(look), segs=16, rings=8), "trim"))
        Pr, Nr, cl = lens_rim(F, lc, frame_look(look), (Rl + 0.003,) * 3, n=40, lift=0.0)
        out.append(loop_tube(f"bezel{side}", Pr, 0.0022, sides=5, closed=cl))
    for i, (P, N) in enumerate(ctx["nos"]):
        out.append(gk.fin(ellipsoid_mesh(f"nos{i}", P - N * 0.0028, (0.0032,) * 3, segs=8, rings=5), "trim"))
    return out


def frog_cranium(F, ctx):
    F.add(mesh_prim(*loft(FROG_ST, FROG_U, FROG_DY, caps=FROG_CAPS)))
    return (0, 0.1 * FROG_U + FROG_DY, 0.1 * FROG_U)


FROG = Head("frog", (-0.21, -0.17, -0.24), (0.21, 0.16, 0.18), frog_form, frog_parts, frog_cranium, shell_tris=6300, keep=0.35)


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


# ===========================================================================
# BUNNY — a rabbit, not a ball
# ===========================================================================

BUNNY_U = 0.13 * 1.232 * 1.15
BUNNY_DY = 0.008
BUNNY_ST = [
    dict(top=(0.46, 0.62), bot=(-0.42, 0.55), w=0.44, n=2.0),  # back
    dict(top=(0.76, 0.28), bot=(-0.6, 0.36), w=0.58, n=2.05),  # crown
    dict(top=(0.7, -0.12), bot=(-0.7, 0.04), w=0.64, n=2.1),  # cheeks (widest)
    dict(top=(0.46, -0.48), bot=(-0.66, -0.3), w=0.58, n=2.05),  # lower face
    dict(top=(0.14, -0.72), bot=(-0.54, -0.58), w=0.4, n=2.0),  # muzzle
    dict(top=(-0.02, -0.82), bot=(-0.42, -0.76), w=0.22, n=1.9),  # nose end
]
BUNNY_CAPS = (0.45, 0.35)


def _bunny_ears():
    u, dy = BUNNY_U, BUNNY_DY
    ears = []
    for side in (-1, 1):
        R = euler(0.14, side * -0.2, side * -0.16)
        o = A(side * 0.22 * u, 0.62 * u + dy, 0.14 * u)
        fold_p = (0.52 * u, 0.2 * u, 2.0) if side == 1 else None
        ears.append(Ear(o, R, (0.34 * u, 1.2 * u, 0.13 * u, 0.55, 0.12 * u), (0.19 * u, 0.94 * u, 0.05 * u, 0.55, 0.09 * u),
                        0.58 * u, lift=0.55 * u, fold=fold_p, k=0.022, hollow=0.0055))
    return ears


def _bunny_eye(side):
    u, dy = BUNNY_U, BUNNY_DY
    R = rot((0, 1, 0), side * -0.42)
    c = A(side * 0.275 * u, 0.17 * u + dy, -0.59 * u)
    r = 0.178 * u * A(0.85, 1.12, 0.5)
    look = R @ A(0, 0, -1)
    return c, R, r, look


def bunny_form(F, ctx):
    u, dy = BUNNY_U, BUNNY_DY
    F.add(mesh_prim(*loft(BUNNY_ST, u, dy, caps=BUNNY_CAPS)))
    # Whisker pads — the two soft mounds the mouth hangs between.
    for side in (-1, 1):
        F.add(ellipsoid((side * 0.12 * u, -0.28 * u + dy, -0.76 * u), 0.17 * u * A(1.0, 0.82, 0.8)), k=0.012)
    # Chubby cheeks, and a fluffy ruff of three big soft tufts a side
    # sweeping back off the back of each cheek.
    fl = dict(n=6, amp=0.0012, twist=2.0, start=0.12)
    for side in (-1, 1):
        F.add(ellipsoid((side * 0.4 * u, -0.26 * u + dy, -0.4 * u), (0.26 * u, 0.22 * u, 0.26 * u)), k=0.03)
        for i in range(5):
            t = i / 4
            ang = math.radians(25 - 75 * t)  # fanned from back-up to down
            root = A(side * 0.5 * u, (-0.06 - 0.38 * t) * u + dy, (-0.24 + 0.1 * math.sin(t * math.pi)) * u)
            d = unit((side * 0.8, math.sin(ang) * 0.8, math.cos(ang) * 0.6))
            L = (0.24 + 0.08 * math.sin(t * math.pi)) * u
            F.add(tuft(root, d, L, 0.12 * u, bend=A(side * 0.02, -0.03, 0.04) * u, tip=0.42, flute=dict(fl, phase=i)), k=0.022)
    for e in _bunny_ears():
        e.add(F)
    if "mouth" not in ctx:
        # The Y: down from under the nose between the pads, then out and up
        # either side — landed on the pads from the front.
        def fr(x, y):
            return land(F, (x * u, y * u + dy, -1.6 * u), (0, 0, 1))
        stem = [fr(0, y) for y in np.linspace(-0.2, -0.36, 5)]
        mouth = [(A([p for p, n in stem]), A([n for p, n in stem]))]
        for side in (-1, 1):
            arm = [fr(side * x, y) for x, y in ((0.0, -0.36), (0.05, -0.395), (0.1, -0.405), (0.15, -0.385), (0.19, -0.35))]
            mouth.append((A([p for p, n in arm]), A([n for p, n in arm])))
        ctx["mouth"] = mouth
        ctx["nose"] = fr(0, -0.13)
        # The brows over the eyes, on the skin.
        brows = []
        for side in (-1, 1):
            c, R, r, look = _bunny_eye(side)
            pts = []
            for a in np.linspace(math.radians(25), math.radians(155), 9):
                q = c + R @ A(math.cos(a) * r[0] * 1.2, math.sin(a) * r[1] * 1.15, 0)
                pts.append(land(F, q - look * 0.1, look)[0])
            brows.append(surface_path(F, A(pts), 1))
        ctx["brows"] = brows
    if "eyerim" not in ctx:
        ctx["eyerim"] = [lens_rim(F, *_bunny_eye(side)[:3]) for side in (-1, 1)]
    for P, N in ctx["brows"]:
        n = len(P)
        rr = [0.0025 + 0.0035 * math.sin(math.pi * i / (n - 1)) for i in range(n)]
        F.add(sweep(P - N * 0.0015, rr), k=0.006)
    # Buck teeth under the Y.
    for side in (-1, 1):
        F.add(rounded_box((side * 0.04 * u, -0.45 * u + dy, -0.86 * u), (0.02 * u, 0.055 * u, 0.012 * u), 0.0025,
                          rot((1, 0, 0), 0.12)), k=0.001)
    # The nose's bed and the Y's groove.
    nP, nN = ctx["nose"]
    F.cut(ellipsoid(nP + nN * 0.004, (0.085 * u, 0.055 * u, 0.04 * u)), k=0.003)
    for P, N in ctx["mouth"]:
        F.cut(sweep(P, 0.0026), k=0.0015)
    # Soft fur combed back over the crown and out over the cheeks.
    def flow(p):
        x, y, z = p
        return (0.6 * np.sign(x) * min(1, abs(x) / (0.2 * u)), -0.2 if y < 0.1 * u + dy else 0.15, 1.0)
    seeds = scatter_seeds(((0, 0.7 * u + dy, -0.1 * u), (0.32 * u, 0.05, 0.4 * u), (0, -1, 0)), 120, rng=11)
    for side in (-1, 1):
        seeds += scatter_seeds(((side * 0.5 * u, -0.2 * u + dy, -0.35 * u), (0.05, 0.18 * u, 0.2 * u), (-side, 0, 0)), 50, rng=12 + side)
    fur_strokes(F, seeds, flow, length=0.018, width=0.0016, depth=0.0006)
    # Whisker dots on the pads (the sculpt only).
    if F.detail:
        for side in (-1, 1):
            for row in range(3):
                for col in range(3):
                    q = A(side * (0.07 + 0.045 * col) * u, (-0.22 - 0.05 * row) * u + dy, -1.2 * u)
                    p, n = land(F, q, (0, 0, 1))
                    F.cut(ellipsoid(p, (0.0012,) * 3), k=0.0008)


def bunny_parts(F, ctx):
    u, dy = BUNNY_U, BUNNY_DY
    out = []
    for i, e in enumerate(_bunny_ears()):
        out.append(e.insert(f"inner{i}"))
    for i, (P, N) in enumerate(ctx["mouth"]):
        out.append(groove_trim(f"mouth{i}", P, N, 0.0019, 0.001, step=0.004))
    nP, nN = ctx["nose"]
    nose = [with_k(ellipsoid(nP - nN * 0.002 + A(0, 0.006, 0), (0.07 * u, 0.04 * u, 0.04 * u)), 0.0),
            with_k(ellipsoid(nP - nN * 0.001 - A(0, 0.006, 0), (0.03 * u, 0.03 * u, 0.034 * u)), 0.012)]
    out.append(sdf_part("nose", nose, "trim", tris=220))
    for side in (-1, 1):
        c, R, r, look = _bunny_eye(side)
        out.append(gk.fin(ellipsoid_mesh(f"eye{side}", c, r, R=R, segs=18, rings=10), "glow"))
        P, N, cl = ctx["eyerim"][(side + 1) // 2]
        out.append(loop_tube(f"bezel{side}", P, 0.0022, closed=cl))
        pr = 0.125 * u * A(0.85, 1.05, 0.4)
        pc = c + look * (r[2] * 0.66) + R @ A(-side * 0.008 * u, -0.004 * u, 0)
        out.append(gk.fin(ellipsoid_mesh(f"pupil{side}", pc, pr, R=R, segs=12, rings=8), "trim"))
    return out


def bunny_cranium(F, ctx):
    F.add(mesh_prim(*loft(BUNNY_ST, BUNNY_U, BUNNY_DY, caps=BUNNY_CAPS)))
    return (0, 0.15 * BUNNY_U + BUNNY_DY, 0.1 * BUNNY_U)


BUNNY = Head("bunny", (-0.22, -0.16, -0.23), (0.22, 0.48, 0.22), bunny_form, bunny_parts, bunny_cranium, shell_tris=5700)


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
# Fur strokes (the sculpt only): short grooves combed along the fur's flow
# ===========================================================================

def fur_strokes(F, seeds, flow, length=0.024, width=0.0018, depth=0.0007, rng=7):
    """Comb the skin: at each seed (a point outside the head and the
    direction to land along), a short curved groove laid along
    `flow(point) -> direction`. Only in the high (F.detail)."""
    if not F.detail:
        return
    g = np.random.default_rng(rng)
    for o, d in seeds:
        p, n = land(F, o, d)
        if F.sample([p])[0] > 0.002:
            continue
        L = length * (0.7 + 0.6 * g.random())
        pts = [p]
        q = p.copy()
        for _ in range(4):
            fdir = A(flow(q))
            fdir = fdir - n * fdir.dot(n)
            if np.linalg.norm(fdir) < 1e-6:
                break
            q = q + unit(fdir) * L / 4
            q, nn = F.project([q], iters=3)
            q, n = q[0], nn[0]
            pts.append(q)
        if len(pts) < 3:
            continue
        P = A(pts)
        N = F.grad(P)
        P = P + N * (width - depth)
        rr = [width * 0.4] + [width] * (len(P) - 2) + [width * 0.4]
        F.cut(sweep(P, rr), k=0.0006)


def scatter_seeds(region, n, rng=3):
    """Seeds over a box of directions: region = (centre, (ax, ay, az) half
    sizes, landing direction). Points start 0.25 m out along −direction."""
    c, half, d = A(region[0]), A(region[1]), unit(region[2])
    g = np.random.default_rng(rng)
    out = []
    for _ in range(n):
        p = c + (g.random(3) * 2 - 1) * half
        out.append((p - d * 0.25, d))
    return out


# ===========================================================================
# WOLF — a timber wolf, alert rather than snarling
# ===========================================================================

WOLF_U = 0.13 * 1.2508 * 1.12
WOLF_DY = -0.03
WOLF_SKULL = [
    dict(top=(0.45, 0.6), bot=(-0.32, 0.58), w=0.4, n=2.0),  # occiput
    dict(top=(0.72, 0.3), bot=(-0.46, 0.4), w=0.52, n=2.05),  # crown
    dict(top=(0.66, -0.02), bot=(-0.5, 0.14), w=0.57, n=2.1),  # cheeks (widest)
    dict(top=(0.54, -0.3), bot=(-0.46, -0.12), w=0.5, n=2.1),  # brow
    dict(top=(0.28, -0.5), bot=(-0.4, -0.36), w=0.33, n=2.1),  # THE STOP
    dict(top=(0.2, -0.72), bot=(-0.3, -0.6), w=0.26, n=2.2),  # muzzle root
    dict(top=(0.15, -0.98), bot=(-0.26, -0.9), w=0.215, n=2.35),  # mid muzzle
    dict(top=(0.1, -1.2), bot=(-0.22, -1.14), w=0.18, n=2.5),  # square end
]
WOLF_JAW = [
    dict(top=(-0.2, -0.3), bot=(-0.48, -0.1), w=0.3, n=2.0),
    dict(top=(-0.24, -0.66), bot=(-0.44, -0.56), w=0.21, n=2.1),
    dict(top=(-0.24, -1.0), bot=(-0.37, -0.96), w=0.15, n=2.2),
    dict(top=(-0.23, -1.1), bot=(-0.31, -1.09), w=0.1, n=2.0),
]


def _wolf_ears():
    u, dy = WOLF_U, WOLF_DY
    ears = []
    for side in (-1, 1):
        R = euler(0.12, side * -0.25, side * -0.22)
        o = A(side * 0.3 * u, 0.6 * u + dy, 0.12 * u)
        ears.append(Ear(o, R, (0.38 * u, 0.72 * u, 0.16 * u, 0.9, 0.06 * u), (0.21 * u, 0.5 * u, 0.06 * u, 0.9, 0.05 * u),
                        0.27 * u, lift=0.3 * u, k=0.02, hollow=0.006))
    return ears


def _wolf_eye(side):
    u, dy = WOLF_U, WOLF_DY
    R = euler(0, side * -0.45, side * 0.3)
    c = A(side * 0.27 * u, 0.3 * u + dy, -0.54 * u)
    return c, R


def _wolf_ruff():
    """THE RUFF: cheek tufts fanning back and down off the jaw line, a
    longer rank behind them, a collar round the nape — (root, dir, length,
    radius) in head units."""
    out = []
    for side in (-1, 1):
        for i in range(5):
            t = i / 4
            root = A(side * (0.5 - t * 0.06), 0.14 - t * 0.52, -0.08 + t * 0.08)
            d = A(side * (0.75 - t * 0.2), -0.22 - t * 0.55, 0.62)
            out.append((root, d, 0.5 + math.sin(t * math.pi) * 0.14, 0.13))
        for i in range(4):
            t = i / 3
            root = A(side * (0.46 - t * 0.1), 0.36 - t * 0.6, 0.2 + t * 0.06)
            d = A(side * 0.55, -0.08 - t * 0.5, 0.9)
            out.append((root, d, 0.52, 0.14))
    for i in range(5):
        a = math.radians(-50 + i * 25)
        root = A(math.sin(a) * 0.3, -0.18, 0.4 + math.cos(a) * 0.08)
        d = A(math.sin(a) * 0.5, -0.55, 0.75)
        out.append((root, d, 0.5, 0.15))
    # The back of the skull: two shingled rows of locks combed down the
    # occiput into the collar (the cap was a bald disc in the ruff).
    for row, (y, z, n, spread) in enumerate(((0.42, 0.42, 4, 0.3), (0.12, 0.56, 5, 0.36))):
        for i in range(n):
            t = (i / (n - 1)) * 2 - 1
            root = A(t * spread, y, z)
            d = A(t * 0.35, -0.75, 0.6)
            out.append((root, d, 0.42, 0.13))
    return out


def wolf_form(F, ctx):
    u, dy = WOLF_U, WOLF_DY
    F.add(mesh_prim(*loft(WOLF_SKULL, u, dy, caps=(0.45, 0.25))))
    F.add(mesh_prim(*loft(WOLF_JAW, u, dy, caps=(0.3, 0.4))), k=0.006)
    # The cheeks fill out behind the jaw hinge; the brow over each eye.
    for side in (-1, 1):
        F.add(ellipsoid((side * 0.36 * u, 0.0 * u + dy, -0.22 * u), (0.2 * u, 0.24 * u, 0.26 * u)), k=0.03)
        F.add(ellipsoid((side * 0.23 * u, 0.44 * u + dy, -0.47 * u), (0.18 * u, 0.06 * u, 0.09 * u),
                        euler(0.2, side * -0.3, side * 0.36)), k=0.018)
    # THE RUFF, every tuft a rounded lock fluted in the sculpt.
    fl = dict(n=5, amp=0.0013, twist=1.2, start=0.18)
    for i, (root, d, L, r0) in enumerate(_wolf_ruff()):
        bend = A(0, -0.05, 0.04) * u
        F.add(tuft(root * u + A(0, dy, 0), unit(d), L * u * 1.18, r0 * u * 1.1, bend=bend * 1.6, tip=0.36, flute=dict(fl, phase=i * 0.7)), k=0.02)
    for e in _wolf_ears():
        e.add(F)
    if "mouth" not in ctx:
        # The mouth: where jaw meets muzzle, corner to corner.
        right = []
        for x, y, z in ((0.26, -0.18, -0.4), (0.22, -0.23, -0.62), (0.18, -0.25, -0.86), (0.13, -0.25, -1.04), (0.06, -0.245, -1.14), (0.0, -0.245, -1.16)):
            right.append(A(x * u, y * u + dy, z * u))
        pts = [mirror(p) for p in right] + right[::-1][1:]
        P = A(pts)
        # land each sideways-in onto the skin
        Q = []
        za = -0.9 * u
        for p in P:
            d = -unit((p[0], 0, (p[2] - za) if p[2] < za else 0.0))
            Q.append(land(F, p - d * 0.05, d)[0])
        Q = smooth_path(A(Q), 1)
        # densify
        dense = []
        for i in range(len(Q) - 1):
            for t in np.linspace(0, 1, 6, endpoint=False):
                dense.append(Q[i] + (Q[i + 1] - Q[i]) * t)
        dense.append(Q[-1])
        ctx["mouth"] = surface_path(F, A(dense), 2)
        ctx["nose"] = land(F, (0, 0.06 * u + dy, -1.6 * u), (0, 0, 1))
        ctx["eyes"] = []
    for P, N in [ctx["mouth"]]:
        F.cut(sweep(P, 0.0028), k=0.002)
    # Fangs just showing under the lip.
    for side in (-1, 1):
        a = A(side * 0.1 * u, -0.2 * u + dy, -1.04 * u)
        b = A(side * 0.098 * u, -0.36 * u + dy, -1.06 * u)
        F.add(sweep([a, b], [0.026 * u, 0.0035]), k=0.002)
    # The nose's bed: the pad sits in it.
    nP, nN = ctx["nose"]
    F.cut(ellipsoid(nP + nN * 0.006 - A(0, 0, 0.004), (0.12 * u, 0.07 * u, 0.06 * u), rot((1, 0, 0), 0.2)), k=0.004)
    # Fur combed back over the crown and down the cheeks (sculpt only).
    def flow(p):
        x, y, z = p
        return (0.35 * np.sign(x) * min(1, abs(x) / (0.15 * u)), -0.25 if y < 0.2 * u + dy else 0.1, 1.0)
    seeds = scatter_seeds(((0, 0.75 * u + dy, -0.2 * u), (0.3 * u, 0.05, 0.35 * u), (0, -1, 0)), 160)
    seeds += scatter_seeds(((0.42 * u, 0.15 * u + dy, -0.3 * u), (0.05, 0.25 * u, 0.3 * u), (-1, 0, 0)), 70, rng=5)
    seeds += scatter_seeds(((-0.42 * u, 0.15 * u + dy, -0.3 * u), (0.05, 0.25 * u, 0.3 * u), (1, 0, 0)), 70, rng=6)
    fur_strokes(F, seeds, flow)


def wolf_parts(F, ctx):
    u, dy = WOLF_U, WOLF_DY
    out = []
    for i, e in enumerate(_wolf_ears()):
        out.append(e.insert(f"inner{i}"))
    P, N = ctx["mouth"]
    out.append(groove_trim("mouth", P, N, 0.0021, 0.0012, step=0.006))
    # The nose: a broad pad capping the square muzzle, nostrils cut in it.
    nP, nN = ctx["nose"]
    nc = nP - A(0, 0, 0.0) + nN * 0.002
    Rn = rot((1, 0, 0), 0.2)
    parts = [with_k(ellipsoid(nc, (0.13 * u, 0.075 * u, 0.085 * u), Rn), 0.0),
             with_k(ellipsoid(nc + A(0, 0.02 * u, 0.03 * u), (0.11 * u, 0.06 * u, 0.08 * u), Rn), 0.01)]
    for side in (-1, 1):
        parts.append(("cut", ellipsoid(nc + A(side * 0.055 * u, -0.012 * u, -0.08 * u), (0.03 * u, 0.02 * u, 0.03 * u),
                                         rot((0, 0, 1), side * -0.5)), 0.003))
    out.append(sdf_part("nose", parts, "trim", tris=320))
    # Eyes: an almond of glass in a dark almond liner, a bezel where the
    # liner meets the skin.
    for side in (-1, 1):
        c, R = _wolf_eye(side)
        r_l = A(0.155 * u, 0.075 * u, 0.07 * u)
        r_g = A(0.11 * u, 0.048 * u, 0.06 * u)
        look = R @ A(0, 0, -1)
        # Seat it: on the skin along its own look, sunk to show ~40%.
        ps, ns = land(F, c + look * 0.12, -look)
        c = ps + look * (r_l[2] * 0.25)
        out.append(gk.fin(ellipsoid_mesh(f"liner{side}", c, r_l, R=R, segs=16, rings=8), "trim"))
        out.append(gk.fin(ellipsoid_mesh(f"eye{side}", c + look * 0.006, r_g, R=R, segs=16, rings=8), "glow"))
        Pr, Nr, cl = lens_rim(F, c, R, r_l, n=36)
        out.append(loop_tube(f"bezel{side}", Pr, 0.002, sides=5, closed=cl))
    return out


def wolf_cranium(F, ctx):
    F.add(mesh_prim(*loft(WOLF_SKULL[:5], WOLF_U, WOLF_DY, caps=(0.45, 0.4))))
    return (0, 0.15 * WOLF_U + WOLF_DY, 0.1 * WOLF_U)


WOLF = Head("wolf", (-0.24, -0.2, -0.27), (0.24, 0.3, 0.24), wolf_form, wolf_parts, wolf_cranium, shell_tris=6000)


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
                 fit=dict(s=(0.849, 0.865, 0.885), y=-0.0203, z=0.0232),
                 view=dict(target=(0, 0.0, -0.03), dist=1.1)),
    "frog": dict(slot="face", build=FROG.build, tex=1024, uv_angle=66,
                 fit=dict(s=(1.233, 0.834, 1.035), y=-0.0386, z=0.0189)),
    "bunny": dict(slot="face", build=BUNNY.build, tex=1024, uv_angle=66,
                  fit=dict(s=(0.949, 1.059, 0.968), y=0.0047, z=0.0184),
                  view=dict(target=(0, 0.09, -0.01), dist=1.3)),
}

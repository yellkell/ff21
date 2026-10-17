"""
THE GEAR KIT — modelling helpers for Forge gear (docs/forge.md §3).

Everything is in GAME space for the rig group the piece hangs on (see
kit.py): +y up, front −z. The reference the piece is fitted to — THE
BLANK's STANDARD frame, the skull, the left hand — is built in the same
space by `reference(slot)`, so a piece can be conformed straight onto it.

A piece is a list of objects, each tagged with its FINISH (`fin(obj, …)`):
  shell  the paintable plate, primed in the body's tone in the game
  trim   machined steel that keeps its contrast under any paint
  glow   the lit accent, in the fighter's hue
gear.py joins them by finish, unwraps one atlas, bakes and exports.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

R_HEAD = 0.13
HEAD_SCALE = (0.94, 1.0, 0.97)  # mannequin.ts: x, y, z of the skull
SKULL_Y = R_HEAD * 0.05


def V(x, y, z):
    """A game-space point as a Blender vector."""
    return Vector(kit.to_blender((x, y, z)))


def G(v):
    """A Blender vector back to game space (x, y, z)."""
    return (v[0], v[2], -v[1])


# ---------------------------------------------------------------------------
# Objects and modifiers
# ---------------------------------------------------------------------------

def obj_from_bm(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    kit.link(ob)
    return ob


def fin(ob, finish):
    ob["finish"] = finish
    return ob


def mod(ob, kind, **props):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def bake_mods(ob):
    """Apply every modifier (and any shape) into the mesh data."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def bevel(ob, width, segments=3, angle=35.0, profile=0.5, clamp=True):
    m = mod(ob, "BEVEL", width=width, segments=segments, limit_method="ANGLE", angle_limit=math.radians(angle),
            profile=profile, use_clamp_overlap=clamp, harden_normals=False)
    return m


def solidify(ob, thickness, offset=-1.0, even=True, rim=True):
    return mod(ob, "SOLIDIFY", thickness=thickness, offset=offset, use_even_offset=even, use_rim=rim, use_quality_normals=True)


def subsurf(ob, levels=2):
    return mod(ob, "SUBSURF", levels=levels, render_levels=levels, quality=3)


def weighted(ob):
    m = mod(ob, "WEIGHTED_NORMAL", keep_sharp=True, weight=50)
    return m


def shrinkwrap(ob, target, offset=0.0, method="NEAREST_SURFACEPOINT", wrap_mode="OUTSIDE_SURFACE"):
    m = mod(ob, "SHRINKWRAP", target=target, offset=offset, wrap_method=method)
    try:
        m.wrap_mode = wrap_mode
    except Exception:  # noqa: BLE001
        pass
    return m


def boolean(ob, cutter, op="DIFFERENCE"):
    m = mod(ob, "BOOLEAN", object=cutter, operation=op, solver="EXACT")
    cutter.hide_render = True
    cutter.hide_viewport = True
    return m


def mirror_x(ob, merge=True):
    """Mirror across the game's x = 0 (Blender's x too)."""
    return mod(ob, "MIRROR", use_axis=(True, False, False), use_bisect_axis=(False, False, False), use_mirror_merge=merge)


def mirrored_copy(ob, name=None):
    """A separate object that is `ob` mirrored across x = 0 (its own
    geometry, so it gets its own UV islands — and its own paint)."""
    bake_mods(ob)
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name or ob.name + "_R"
    kit.link(c)
    bm = bmesh.new()
    bm.from_mesh(c.data)
    bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(c.data)
    bm.free()
    for k in ob.keys():
        c[k] = ob[k]
    return c


def delete(ob):
    bpy.data.objects.remove(ob, do_unlink=True)


# ---------------------------------------------------------------------------
# Primitives (game space)
# ---------------------------------------------------------------------------

def frame_matrix(origin, x_axis, y_axis):
    """A Blender matrix for a local frame given in game space: local x along
    `x_axis`, local y along `y_axis`, local z = x × y (all game vectors)."""
    o = Vector(kit.to_blender(origin))
    xa = Vector(kit.to_blender(x_axis)).normalized()
    ya = Vector(kit.to_blender(y_axis))
    ya = (ya - xa * ya.dot(xa)).normalized()
    za = xa.cross(ya)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = xa[i], ya[i], za[i], o[i]
    return m


def radial_plate(name, outline, rings=8, segs=64, ease=1.0, bulge=0.0, matrix=None):
    """A flat plate in its local XY plane bounded by `outline(theta) ->
    (x, y)`, meshed as clean rings from a centre point out to the edge (so
    it shrinkwraps and solidifies without pinching). `bulge` domes it along
    local +z (metres at the centre). `matrix` places it."""
    bm = bmesh.new()
    centre = bm.verts.new((0, 0, bulge))
    rows = []
    for r in range(1, rings + 1):
        t = (r / rings) ** ease
        row = []
        for s in range(segs):
            th = 2 * math.pi * s / segs
            x, y = outline(th)
            z = bulge * (1 - t * t)
            row.append(bm.verts.new((x * t, y * t, z)))
        rows.append(row)
    for s in range(segs):
        bm.faces.new((centre, rows[0][s], rows[0][(s + 1) % segs]))
    for r in range(rings - 1):
        a, b = rows[r], rows[r + 1]
        for s in range(segs):
            s1 = (s + 1) % segs
            bm.faces.new((a[s], b[s], b[s1], a[s1]))
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm)


def superellipse(a, b, n=2.6, lobes=None):
    """outline(theta) for a superellipse of half-extents a, b."""
    def f(th):
        c, s = math.cos(th), math.sin(th)
        x = a * math.copysign(abs(c) ** (2 / n), c)
        y = b * math.copysign(abs(s) ** (2 / n), s)
        if lobes:
            k = 1 + lobes(th)
            x, y = x * k, y * k
        return x, y
    return f


def polygon_outline(pts, samples=96, corner=0.0):
    """outline(theta) from a closed polygon (local XY, about the origin;
    star-shaped from it), resampled by angle; `corner` rounds it (a moving
    average along the boundary, in samples)."""
    P = np.array(pts, float)
    # Dense boundary.
    dense = []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        for t in np.linspace(0, 1, 24, endpoint=False):
            dense.append(a + (b - a) * t)
    D = np.array(dense)
    ang = np.arctan2(D[:, 1], D[:, 0])
    rad = np.hypot(D[:, 0], D[:, 1])
    order = np.argsort(ang)
    ang, rad = ang[order], rad[order]
    ang = np.concatenate([ang - 2 * np.pi, ang, ang + 2 * np.pi])
    rad = np.concatenate([rad, rad, rad])
    grid = np.linspace(-np.pi, np.pi, 720, endpoint=False)
    rg = np.interp(grid, ang, rad)
    if corner > 0:
        k = int(corner)
        kern = np.ones(2 * k + 1) / (2 * k + 1)
        rg = np.convolve(np.concatenate([rg[-k:], rg, rg[:k]]), kern, mode="valid")

    def f(th):
        th = (th + np.pi) % (2 * np.pi) - np.pi
        r = float(np.interp(th, grid, rg, period=2 * np.pi))
        return r * math.cos(th), r * math.sin(th)
    return f


def tube(name, pts, radius, sides=16, closed_ends=True, twist=0.0, scale_xy=(1.0, 1.0), step=0.004):
    """A swept tube along game-space points (smooth Catmull-Rom through
    them); `radius` is a number or a function of t ∈ [0, 1]. Ends capped
    (a tip radius of 0 closes to a point). scale_xy squashes the section
    (local x across the curve's side, local y its 'up')."""
    P = [Vector(p) for p in pts]
    # Rings every `step` metres along the path (a bead round a shoulder
    # needs a few dozen, not a thousand).
    length = sum((P[i + 1] - P[i]).length for i in range(len(P) - 1))
    n = int(min(220, max(8, length / step)))
    # Catmull-Rom resample.
    def cr(t):
        f = t * (len(P) - 1)
        i = min(int(f), len(P) - 2)
        u = f - i
        p0, p1 = P[max(i - 1, 0)], P[i]
        p2, p3 = P[i + 1], P[min(i + 2, len(P) - 1)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
    C = [cr(i / (n - 1)) for i in range(n)]
    # Parallel-transport frames.
    T = [(C[min(i + 1, n - 1)] - C[max(i - 1, 0)]).normalized() for i in range(n)]
    up0 = Vector((0, 1, 0)) if abs(T[0].y) < 0.9 else Vector((1, 0, 0))
    Nn = [(up0 - T[0] * up0.dot(T[0])).normalized()]
    for i in range(1, n):
        v = Nn[-1] - T[i] * Nn[-1].dot(T[i])
        Nn.append(v.normalized())
    bm = bmesh.new()
    rings = []
    for i in range(n):
        t = i / (n - 1)
        r = radius(t) if callable(radius) else radius
        b = T[i].cross(Nn[i])
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides + twist * t
            off = Nn[i] * (math.cos(a) * r * scale_xy[1]) + b * (math.sin(a) * r * scale_xy[0])
            ring.append(bm.verts.new(kit.to_blender(tuple(C[i] + off))))
        rings.append(ring)
    for i in range(n - 1):
        for s in range(sides):
            s1 = (s + 1) % sides
            bm.faces.new((rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s]))
    if closed_ends:
        for end, ring in ((0, rings[0]), (1, rings[-1])):
            c = bm.verts.new(kit.to_blender(tuple(C[0 if end == 0 else -1])))
            for s in range(sides):
                s1 = (s + 1) % sides
                bm.faces.new((c, ring[s1], ring[s]) if end == 0 else (c, ring[s], ring[s1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm)


def lathe(name, profile, segs=48, axis_origin=(0, 0, 0), axis=(0, 1, 0), ref=(1, 0, 0), arc=2 * math.pi, start=0.0):
    """A surface of revolution: `profile` is [(radius, height), …] about the
    game-space axis through axis_origin. Open ends at radius 0 close."""
    ax = Vector(axis).normalized()
    rx = Vector(ref)
    rx = (rx - ax * rx.dot(ax)).normalized()
    ry = ax.cross(rx)
    o = Vector(axis_origin)
    full = abs(arc - 2 * math.pi) < 1e-6
    n = segs if full else segs + 1
    bm = bmesh.new()
    rows = []
    for (r, h) in profile:
        row = []
        for s in range(n):
            a = start + arc * s / segs
            p = o + ax * h + (rx * math.cos(a) + ry * math.sin(a)) * r
            row.append(bm.verts.new(kit.to_blender(tuple(p))))
        rows.append(row)
    for i in range(len(rows) - 1):
        for s in range(segs):
            s1 = (s + 1) % n
            if not full and s1 == 0:
                continue
            bm.faces.new((rows[i][s], rows[i][s1], rows[i + 1][s1], rows[i + 1][s]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm)


def extrude_outline(name, pts2d, depth, matrix, bevel_w=0.0, segs=3, center=True):
    """A flat outline (local XY, metres) extruded `depth` along local z,
    placed by `matrix`; bevelled round its edges."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, -depth / 2 if center else 0)) for (x, y) in pts2d]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, depth), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    ob = obj_from_bm(name, bm, smooth=False)
    if bevel_w > 0:
        bevel(ob, bevel_w, segments=segs, angle=30)
    return ob


def rivet(name, at, normal, r=0.003, h=0.0018, segs=10):
    """A domed rivet head standing on the surface at `at` (game space)."""
    n = Vector(normal).normalized()
    ref = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
    prof = [(r * 0.0, h), (r * 0.62, h * 0.88), (r, h * 0.3), (r, -h * 0.5), (0.0, -h * 0.5)]
    return lathe(name, prof, segs=segs, axis_origin=at, axis=tuple(n), ref=tuple(ref))


def ring(name, at, axis, r, tube_r, segs=40, sides=10):
    """A torus round `axis` through `at` (game space)."""
    ax = Vector(axis).normalized()
    ref = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
    prof = []
    for s in range(sides + 1):
        a = 2 * math.pi * s / sides
        prof.append((r + math.cos(a) * tube_r, math.sin(a) * tube_r))
    return lathe(name, prof, segs=segs, axis_origin=at, axis=tuple(ax), ref=tuple(ref))


# ---------------------------------------------------------------------------
# References — what pieces are fitted to (never exported)
# ---------------------------------------------------------------------------

def reference(slot):
    """The fitting target for a slot, in that slot's rig-group space."""
    if slot in ("head", "face"):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=R_HEAD, location=kit.to_blender((0, SKULL_Y, 0)))
        ob = bpy.context.active_object
        ob.scale = (HEAD_SCALE[0], HEAD_SCALE[2], HEAD_SCALE[1])  # Blender (x, y=depth, z=height)
        bpy.ops.object.shade_smooth()
        bake_mods(ob)
        ob.data.transform(ob.matrix_basis)
        ob.matrix_basis = Matrix.Identity(4)
        ob.name = "REF"
        return ob
    if slot in ("body", "shoulders"):
        import frames  # the frames' own builder: THE BLANK's STANDARD frame
        ob, _, _ = frames.build_mesh("REF", frames.FRAMES["standard"], 120, 140, with_uv=False)
        return ob
    if slot == "hands":
        path = os.path.join(kit.REPO, "public", "arena", "hand", "hand.glb")
        bpy.ops.import_scene.gltf(filepath=path)
        parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        # Bake the hierarchy's transforms in, then join into one reference.
        for o in parts:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
        kit.select_only(parts)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.join()
        ob = bpy.context.active_object
        ob.name = "REF"
        for o in list(bpy.data.objects):
            if o.type == "EMPTY":
                bpy.data.objects.remove(o, do_unlink=True)
        return ob
    raise ValueError(slot)


def hit(target, origin, direction):
    """Where a game-space ray first meets `target` (game-space point and
    normal), or None."""
    dg = bpy.context.evaluated_depsgraph_get()
    o = Vector(kit.to_blender(origin))
    d = Vector(kit.to_blender(direction)).normalized()
    mi = target.matrix_world.inverted()
    ok, loc, nrm, _ = target.evaluated_get(dg).ray_cast(mi @ o, (mi.to_3x3() @ d).normalized())
    if not ok:
        return None
    loc = target.matrix_world @ loc
    nrm = (target.matrix_world.to_3x3() @ nrm).normalized()
    return G(loc), G(nrm)


def surface_point(target, game_point, toward=None):
    """The point on `target` nearest a game-space point."""
    dg = bpy.context.evaluated_depsgraph_get()
    mi = target.matrix_world.inverted()
    ok, loc, nrm, _ = target.evaluated_get(dg).closest_point_on_mesh(mi @ Vector(kit.to_blender(game_point)))
    if not ok:
        return None
    return G(target.matrix_world @ loc), G((target.matrix_world.to_3x3() @ nrm).normalized())


# ---------------------------------------------------------------------------
# Domes fitted to the body
# ---------------------------------------------------------------------------

def inside(target, p, gap=0.0):
    """Is game-space point p inside `target` (or within `gap` of it)?"""
    sp = surface_point(target, p)
    if sp is None:
        return False
    q, n = sp
    d = Vector(p) - Vector(q)
    return d.dot(Vector(n)) < gap


def dome_frame(axis, front=(0.0, 0.0, -1.0)):
    """Orthonormal (axis, f, s): f the axis-normal direction nearest `front`."""
    a = Vector(axis).normalized()
    f = Vector(front)
    f = (f - a * f.dot(a)).normalized()
    return a, f, a.cross(f)


def dome_dir(axis, phi, theta, front=(0.0, 0.0, -1.0)):
    a, f, s = dome_frame(axis, front)
    return (a * math.cos(phi) + (f * math.cos(theta) + s * math.sin(theta)) * math.sin(phi)).normalized()


def trimmed_dome(name, centre, axis, radius, phi_max, target=None, gap=0.004, segs=64, rows=20,
                 shape=None, front=(0.0, 0.0, -1.0)):
    """A spherical shell patch about `axis`, its rim at polar angle phi_max
    — except where the body comes up to meet it: there the rim stops `gap`
    short of the body, so the shell rests ON the body instead of diving
    into it, and keeps its shape everywhere else. `shape(phi, theta)` may
    scale the radius (an ogive, a squash). Returns (object, rim(theta) ->
    phi, point(phi, theta)) so trims can follow the same edge."""
    c = Vector(centre)
    shape = shape or (lambda ph, th: 1.0)

    def pt(ph, th):
        return c + dome_dir(axis, ph, th, front) * radius * shape(ph, th)

    lim = []
    for k in range(segs):
        th = 2 * math.pi * k / segs
        ph = phi_max
        if target is not None:
            steps = 48
            for i in range(1, steps + 1):
                p = phi_max * i / steps
                if inside(target, tuple(pt(p, th)), gap):
                    ph = phi_max * (i - 1) / steps
                    break
        lim.append(max(ph, math.radians(8)))
    # Smooth the rim's run round the dome (a jagged trim reads as damage),
    # never letting it out past where the body stopped it.
    sm = lim[:]
    for _ in range(4):
        sm = [(sm[(k - 1) % segs] + 2 * sm[k] + sm[(k + 1) % segs]) / 4 for k in range(segs)]
    lim = [min(a, b) for a, b in zip(sm, lim)]
    for _ in range(2):
        lim = [(lim[(k - 1) % segs] + 2 * lim[k] + lim[(k + 1) % segs]) / 4 for k in range(segs)]

    bm = bmesh.new()
    top = bm.verts.new(kit.to_blender(tuple(pt(0.0, 0.0))))
    grid = []
    for i in range(1, rows + 1):
        row = []
        for k in range(segs):
            th = 2 * math.pi * k / segs
            row.append(bm.verts.new(kit.to_blender(tuple(pt(lim[k] * i / rows, th)))))
        grid.append(row)
    for k in range(segs):
        bm.faces.new((top, grid[0][(k + 1) % segs], grid[0][k]))
    for i in range(rows - 1):
        for k in range(segs):
            k1 = (k + 1) % segs
            bm.faces.new((grid[i][k], grid[i][k1], grid[i + 1][k1], grid[i + 1][k]))
    bm.normal_update()
    cb = Vector(kit.to_blender(tuple(c)))
    out = sum(((f.calc_center_median() - cb).dot(f.normal) for f in bm.faces))
    if out < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    ob = obj_from_bm(name, bm)

    def rim(theta):
        t = (theta % (2 * math.pi)) / (2 * math.pi) * segs
        k0 = int(t) % segs
        u = t - int(t)
        return lim[k0] * (1 - u) + lim[(k0 + 1) % segs] * u

    return ob, rim, pt

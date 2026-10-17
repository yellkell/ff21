"""
THE HEAD — THE BLANK's own face (docs/forge.md).

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/forge/head.py -- [--render] [--nobake]

Writes public/forge/head/head.glb (meshes shell / trim / glow), the shell's
head_nrm.webp + head_orm.webp, and renders/forge/head_*.png.

The bare skull was an egg and nothing else. It is now a clean android
mask — still the SAME surface to paint: the shell is a grid over three's
sphere unwrap (u round from −x, front at u = 0.75; v from the chin pole up
to the crown), on the same ellipsoid (BODY_IK.headRadius × HEAD_SCALE), so
every mark painted on the old skull lands where it did. On it:

  - a dark VISOR band across the eye line, set into a shallow recess, and
    in it two lit EYE slits in the wearer's accent — the expression;
  - a brow line over it, a nose-bridge plane under it;
  - a MASK seam framing the face, a sagittal pair of seams over the crown
    and a jaw seam from each ear (in the normal map: the paint runs over
    them like a livery over panel lines);
  - machined EAR pods, and a small mouth VENT.

All of it stays within a few millimetres of the old egg, so headgear made
for the skull still sits on it.
"""

import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gearkit as gk  # noqa: E402
import kit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--render" in argv
NOBAKE = "--nobake" in argv
OUT = os.path.join(kit.PUBLIC, "head")
R = 0.13
A, B, C = R * 0.94, R * 1.0, R * 0.97
CY = R * 0.05
COLS, ROWS = 56, 34
HCOLS, HROWS = 512, 384
TEX = 1024


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# Feature placement, on the unit sphere (X right of the wearer is −x…; the
# sphere's own frame: X = −cos φ sin θ, Y = cos θ, Z = sin φ sin θ; the
# FRONT is −Z, so F = −Z).
# The eye line sits on the VISOR BAND headgear's lit slit (y ≈ 0.011 m in the
# head group), so the band reads as a cover over the face's own eyes.
EYE_Y = 0.045         # the visor's centre line, unit-sphere y
VISOR_H = 0.115       # half-height, unit-sphere y
VISOR_W = 0.80        # how far round it wraps (F above this... see visor_mask)


def unit(theta, phi):
    st = np.sin(theta)
    return -np.cos(phi) * st, np.cos(theta), np.sin(phi) * st


VISOR_SPAN = math.radians(84)  # round from the front to the ear pods


def visor_edges(alpha):
    """The visor's lower and upper edge (unit-sphere y) at azimuth `alpha`
    from the front: tallest over the eyes, tapering into the ear pods, the
    lower edge dipping in a shallow V at the nose."""
    k = np.clip(np.abs(alpha) / VISOR_SPAN, 0, 1)
    half = VISOR_H * (1 - 0.55 * k ** 2)
    lower = EYE_Y - half - 0.035 * (1 - np.clip(np.abs(alpha) / 0.55, 0, 1))
    upper = EYE_Y + half * 0.8
    return lower, upper


def visor_mask(X, Y, F):
    """1 inside the visor's recess, 0 out, with a crisp edge."""
    alpha = np.arctan2(X, F)
    lower, upper = visor_edges(alpha)
    side = smooth(VISOR_SPAN + 0.03, VISOR_SPAN - 0.02, np.abs(alpha))
    return side * smooth(lower - 0.016, lower - 0.004, Y) * smooth(upper + 0.016, upper + 0.004, Y)


def displacement(X, Y, Z, high):
    """Metres along the normal: the forms (low and high) and the seams (high)."""
    F = -Z
    ax = np.abs(X)
    d = np.zeros_like(X)
    # The face: a plane across the front, the jaw drawn in under it.
    d -= 0.006 * smooth(0.55, 1.0, F) ** 2
    d -= 0.006 * smooth(-0.15, -0.85, Y) * smooth(0.2, 0.9, ax)
    # The brow line over the visor.
    d += 0.0028 * np.exp(-((Y - (EYE_Y + VISOR_H + 0.07)) / 0.05) ** 2) * smooth(0.45, 0.8, F)
    # The visor's recess: the dark band sits in it.
    d -= 0.0045 * visor_mask(X, Y, F)
    # The nose-bridge plane under the visor.
    d += 0.0022 * np.exp(-(X / 0.09) ** 2) * smooth(EYE_Y - 0.12, EYE_Y - 0.2, Y) * smooth(-0.55, -0.35, Y) * smooth(0.8, 0.95, F)
    if high:
        groove = lambda dist, w=0.006: -0.0011 * np.exp(-(dist / w) ** 2)  # noqa: E731
        # THE MASK seam: an oval round the face, from mid-forehead, in
        # front of the ears, under the chin.
        mask_r = np.hypot(X / 0.74, (Y - 0.02) / 0.84)
        d += groove(mask_r - 1.0, 0.012) * smooth(0.0, 0.25, F)
        # Sagittal pair over the crown, brow to nape.
        for sx in (-0.17, 0.17):
            d += groove(X - sx) * smooth(0.45, 0.65, Y)
        # Jaw seams: ear to chin.
        for s in (-1, 1):
            t = np.clip((Y + 0.1) / -0.75, 0, 1)
            path_x = s * (0.92 - 0.55 * t)
            d += groove(X - path_x, 0.008) * smooth(-0.05, -0.15, Y) * smooth(-0.9, -0.8, Y) * smooth(0.0, 0.3, F)
        # A fine band seam round the back of the head at the eye line.
        d += groove(Y - (EYE_Y + 0.01), 0.008) * smooth(0.3, 0.1, F)
    return d


def surface(nu, nv, high):
    theta = np.linspace(np.pi, 0.0, nv + 1)  # chin pole → crown (v up)
    phi = np.arange(nu) / nu * 2 * np.pi
    TH, PH = np.meshgrid(theta, phi, indexing="ij")
    X, Y, Z = unit(TH, PH)
    gx, gy, gz = X / A, Y / B, Z / C
    gl = np.sqrt(gx * gx + gy * gy + gz * gz)
    nx, ny, nz = gx / gl, gy / gl, gz / gl
    d = displacement(X, Y, Z, high)
    P = np.stack([A * X + nx * d, CY + B * Y + ny * d, C * Z + nz * d], axis=-1)
    v = 1.0 - TH / np.pi
    return P, v


def grid_object(name, nu, nv, high):
    P, v = surface(nu, nv, high)
    rows = nv + 1
    verts = [tuple(p) for p in P.reshape(-1, 3)]
    faces, uvs = [], []
    for r in range(rows - 1):
        for c in range(nu):
            c1 = (c + 1) % nu
            a, b = r * nu + c, r * nu + c1
            a2, b2 = (r + 1) * nu + c, (r + 1) * nu + c1
            faces.append((a, b, b2, a2))
            u0, u1 = c / nu, (c + 1) / nu
            uvs += [(u0, v[r, c]), (u1, v[r, c1]), (u1, v[r + 1, c1]), (u0, v[r + 1, c])]
    ob = kit.mesh_object(name, verts, faces, uvs)
    from mathutils import Vector
    kit.select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-7)  # the poles
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def surf_point(theta, phi, lift=0.0):
    X, Y, Z = unit(np.array(theta), np.array(phi))
    gx, gy, gz = X / A, Y / B, Z / C
    gl = np.sqrt(gx * gx + gy * gy + gz * gz)
    n = np.array([gx, gy, gz]) / gl
    d = displacement(np.array([X]), np.array([Y]), np.array([Z]), False)[0]
    p = np.array([A * X, CY + B * Y, C * Z]) + n * (d + lift)
    return p, n


def strip(name, pts_fn, n_u, n_v, thick, bevel):
    """A thin plate following the head: pts_fn(s, t) → (point, normal) for
    s, t ∈ [0, 1]; solidified inward by `thick` and bevelled."""
    import bmesh
    bm = bmesh.new()
    grid = []
    for j in range(n_v + 1):
        row = []
        for i in range(n_u + 1):
            p, _ = pts_fn(i / n_u, j / n_v)
            row.append(bm.verts.new(kit.to_blender(tuple(p))))
        grid.append(row)
    for j in range(n_v):
        for i in range(n_u):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.normal_update()
    ob = gk.obj_from_bm(name, bm)
    # Normals out (away from the head's centre).
    me = ob.data
    me.update()
    p0 = me.polygons[len(me.polygons) // 2]
    if p0.normal.dot(p0.center) < 0:
        me.flip_normals()
    gk.solidify(ob, thick, offset=-1)
    if bevel:
        gk.bevel(ob, bevel, segments=1, angle=30)
    return ob


def build():
    objs = []
    shell = grid_object("shell", COLS, ROWS, high=False)
    objs.append(gk.fin(shell, "shell"))
    high = grid_object("high", HCOLS, HROWS, high=True)
    objs.append(gk.fin(high, "high"))

    # THE VISOR: dark glass in the recess, sitting a hair proud of the
    # surrounding shell (so its edge catches a highlight).
    span = VISOR_SPAN - 0.04

    def visor_pt(s, t):
        alpha = (s * 2 - 1) * span
        lower, upper = visor_edges(np.array(alpha))
        Y = float(lower) + (float(upper) - float(lower)) * t
        theta = math.acos(max(-1.0, min(1.0, Y)))
        # alpha is measured from the front (−Z) toward +X: X = sin α, F = cos α.
        phi = math.atan2(-math.cos(alpha), -math.sin(alpha))
        return surf_point(theta, phi % (2 * math.pi), 0.0038)

    visor = strip("visor", visor_pt, 40, 4, 0.0028, 0.0009)
    objs.append(gk.fin(visor, "trim"))

    # THE EYES: two lit slits on the visor, angled down toward the nose —
    # calm, attentive. They take the wearer's accent.
    for s in (-1, 1):
        def eye_pt(a, t, s=s):
            # a: along the slit (inner → outer), t: across it.
            x_in, x_out = 0.24, 0.58  # set well apart: a calm, wide-eyed face
            X = s * (x_in + (x_out - x_in) * a)
            Y = EYE_Y - 0.026 + 0.03 * a + 0.034 * t * (1 - 0.3 * a)
            # Find phi for this X on the front: X = -cos(phi) sin(theta).
            theta = math.acos(max(-1, min(1, Y)))
            sx = max(-0.999, min(0.999, X / max(math.sin(theta), 1e-6)))
            phi = math.atan2(-math.sqrt(max(0.0, 1 - sx * sx)), -sx)  # on the front
            return surf_point(theta, phi % (2 * math.pi), 0.0040)

        eye = strip(f"eye{s}", eye_pt, 10, 2, 0.0012, 0.0004)
        objs.append(gk.fin(eye, "glow"))

    # THE EAR pods: a machined boss each side — a steel ring round a shell
    # cap, a fine lit ring in the gap.
    for s in (-1, 1):
        c, n = surf_point(math.pi / 2 - 0.02, 0.0 if s < 0 else math.pi, 0.0)
        n = n / np.linalg.norm(n)
        ring = gk.lathe(f"earring{s}", [(0.0175, -0.002), (0.0235, -0.002), (0.0245, 0.0015), (0.0235, 0.0042),
                                        (0.0185, 0.0046), (0.0172, 0.0030)], segs=24,
                        axis_origin=tuple(c), axis=tuple(n), ref=(0, 1, 0))
        objs.append(gk.fin(ring, "trim"))
        cap = gk.lathe(f"earcap{s}", [(0.0, 0.0068), (0.008, 0.0066), (0.0135, 0.0058), (0.0158, 0.0044), (0.0158, -0.002), (0.0, -0.002)],
                       segs=24, axis_origin=tuple(c), axis=tuple(n), ref=(0, 1, 0))
        objs.append(gk.fin(cap, "shell"))
        lit = gk.ring(f"earlit{s}", tuple(c + n * 0.0040), tuple(n), 0.0166, 0.0007, segs=24, sides=4)
        objs.append(gk.fin(lit, "glow"))

    # THE VENT: three short slots of steel where a mouth would be.
    for k in range(3):
        def vent_pt(a, t, k=k):
            Y = -0.52 - k * 0.07 + 0.02 * t
            half = 0.16 - k * 0.035
            X = (a * 2 - 1) * half
            theta = math.acos(max(-1, min(1, Y)))
            sx = max(-0.999, min(0.999, X / max(math.sin(theta), 1e-6)))
            phi = math.atan2(-math.sqrt(max(0.0, 1 - sx * sx)), -sx)
            return surf_point(theta, phi % (2 * math.pi), 0.0012)

        vent = strip(f"vent{k}", vent_pt, 6, 1, 0.0016, 0.0005)
        objs.append(gk.fin(vent, "trim"))
    return objs


def main():
    kit.reset()
    scn = bpy.context.scene
    kit.set_gpu(scn)
    objs = build()
    import gear  # the runner's joining, unwrap-free bake and export helpers
    groups = {f: [o for o in objs if o.get("finish") == f] for f in ("shell", "trim", "glow")}
    highs = [o for o in objs if o.get("finish") == "high"]
    finals = {}
    for f, parts in groups.items():
        finals[f] = gear.join_finish(parts, f)
    shell = finals["shell"]
    # The ear caps joined the shell: keep the grid's UVs, give the caps a
    # corner of the sheet the paint never reaches (the chin pole's row).
    for f in ("shell", "trim", "glow"):
        o = finals[f]
        o.data.materials.clear()
        o.data.materials.append(gear.finish_mat(f)[0])
    if not NOBAKE:
        os.makedirs(OUT, exist_ok=True)
        t = gear.finish_mat("shell")[1]
        nrm = kit.new_image("head_nrm", TEX, "nrm")
        orm = kit.new_image("head_orm", 512, "orm")
        kit.bake([shell], [t], "nrm", nrm, samples=1, high=highs, extrusion=0.006)
        for h in highs:
            h.hide_render = True
        kit.bake([shell], [t], "orm", orm, samples=48)
        a = kit.pixels(nrm)
        a[..., 3] = 1
        kit.write_webp(os.path.join(OUT, "head_nrm.webp"), a, 92)
        b = kit.pixels(orm)
        b[..., 3] = 1
        kit.write_webp(os.path.join(OUT, "head_orm.webp"), b, 90)
        exp = []
        for f in ("shell", "trim", "glow"):
            c = finals[f].copy()
            c.data = finals[f].data.copy()
            kit.link(c)
            finals[f].name = f + "_scene"
            c.name = f
            exp.append(c)
        kit.export_glb(exp, os.path.join(OUT, "head.glb"))
        for c in exp:
            bpy.data.objects.remove(c, do_unlink=True)
        tris = sum(sum(len(p.vertices) - 2 for p in finals[f].data.polygons) for f in finals)
        print("head triangles", tris, flush=True)
    for h in highs:
        h.hide_render = True
    if RENDER:
        review(finals)


def review(finals):
    scn = bpy.context.scene
    kit.studio(scn, bg=(0.035, 0.038, 0.045))
    piv = bpy.data.objects.new("piv", None)
    kit.link(piv)
    for o in finals.values():
        o.parent = piv
    for name, yaw, dist in (("front", 0, 0.9), ("three", -35, 0.9), ("side", -90, 0.9), ("back", 150, 0.9)):
        piv.rotation_euler.z = math.radians(yaw)
        kit.camera(scn, (0, 0.01, 0), dist=dist, yaw_deg=0, pitch_deg=6, lens=85)
        kit.render_to(scn, os.path.join(kit.RENDERS, f"head_{name}.png"), res=(800, 800), samples=64)


if __name__ == "__main__":
    main()

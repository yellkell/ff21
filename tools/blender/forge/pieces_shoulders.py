"""
THE SHOULDERS — Forge pieces for the `shoulders` slot (gear.ts).

Body space (hip-local, front −z). On STANDARD the shoulder ends in a
deltoid CAP: a sphere of radius 0.054 at (±0.198, 0.372, 0.004)
(frames.py) — every pad is built round it, left side first (+x), and the
right is its mirror as its own geometry (its own paint).
"""

import math

from mathutils import Matrix, Vector

import gearkit as gk
import kit

CAP = Vector((0.198, 0.372, 0.004))
CAP_R = 0.054


def _axis(out=1.0, up=0.62, fwd=0.0):
    return Vector((out, up, fwd)).normalized()


def _dome(name, centre, axis, radius, phi_max, squash=(1.0, 1.0), ogive=0.0, segs=56, rows=18, start=0.0):
    """A spherical shell patch about `axis` (game space), its rim at polar
    angle phi_max; `squash` scales across the two directions normal to the
    axis (front-back, then the other); `ogive` points the crown."""
    prof = []
    for i in range(rows + 1):
        phi = start + (phi_max - start) * (i / rows)
        r = radius * math.sin(phi)
        h = radius * math.cos(phi) + ogive * radius * (1 - phi / phi_max) ** 2
        prof.append((r, h))
    if start == 0.0:
        prof[0] = (0.0, prof[0][1])
    ob = gk.lathe(name, prof, segs=segs, axis_origin=tuple(centre), axis=tuple(axis), ref=(0, 0, 1))
    if squash != (1.0, 1.0):
        # Scale about the centre in the axis's own frame.
        a = Vector(kit.to_blender(tuple(axis))).normalized()
        f = Vector(kit.to_blender((0, 0, 1)))
        f = (f - a * f.dot(a)).normalized()
        s = a.cross(f)
        basis = Matrix((f, s, a)).transposed().to_4x4()
        c = Vector(kit.to_blender(tuple(centre)))
        m = Matrix.Translation(c) @ basis @ Matrix.Diagonal((squash[0], squash[1], 1.0, 1.0)) @ basis.inverted() @ Matrix.Translation(-c)
        ob.data.transform(m)
    return ob


def _point_on(centre, axis, radius, phi, theta, squash=(1.0, 1.0)):
    """A point on a _dome's sphere (before thickness), and its normal."""
    a = Vector(axis).normalized()
    f = Vector((0, 0, 1))
    f = (f - a * f.dot(a)).normalized()
    s = a.cross(f)
    d = a * math.cos(phi) + (f * math.cos(theta) * squash[0] + s * math.sin(theta) * squash[1]) * math.sin(phi)
    p = Vector(centre) + d * radius
    n = (a * math.cos(phi) + (f * math.cos(theta) / squash[0] + s * math.sin(theta) / squash[1]) * math.sin(phi)).normalized()
    return p, n


def _seat(ob, ref, gap=0.004):
    """Push anything inside the body back out onto it (plus `gap`): the
    pad's inner edge rests on the trapezius instead of diving into it."""
    gk.shrinkwrap(ob, ref, offset=gap, method="NEAREST_SURFACEPOINT", wrap_mode="OUTSIDE_SURFACE")


def _arc_band(name, centre, axis, radius, phi0, phi1, out_dir, arc, squash=(1.0, 1.0), rows=5, segs=40):
    """A band of the sphere about `axis` between polar angles phi0..phi1,
    only over an `arc` (radians) of azimuth centred on `out_dir`."""
    prof = []
    for i in range(rows + 1):
        phi = phi0 + (phi1 - phi0) * i / rows
        prof.append((radius * math.sin(phi), radius * math.cos(phi)))
    a = Vector(axis).normalized()
    ref = Vector(out_dir)
    ref = (ref - a * ref.dot(a)).normalized()
    return gk.lathe(name, prof, segs=segs, axis_origin=tuple(centre), axis=tuple(a), ref=tuple(ref), arc=arc, start=-arc / 2)


def pauldrons(ref):
    """PAULDRONS: a forged dome over each shoulder — crowning the cap, its
    inner edge resting on the trapezius, its outer edge rolled in steel —
    with two lames shingled beneath it down the outside of the arm line, a
    steel ridge over the crown, three lit gills and a ring of rivets."""
    objs = []
    ax = Vector((0.5, 1.0, 0.0)).normalized()
    c = CAP + Vector((-0.002, -0.006, 0.0))
    R = 0.078
    phi_max = math.radians(80)

    def shape(ph, th):
        # A little fuller at the crown, a little narrower front to back.
        return 1.0 + 0.05 * math.cos(ph * 2.2) - 0.06 * (math.cos(th) ** 2) * (ph / phi_max)

    dome, rim, pt = gk.trimmed_dome("dome", c, ax, R, phi_max, target=ref, gap=0.006, segs=40, rows=9, shape=shape)
    gk.solidify(dome, 0.0055, offset=-1)
    gk.bevel(dome, 0.0018, segments=2, angle=40)
    objs.append(gk.fin(dome, "shell"))

    def on(ph, th, lift=0.0):
        return pt(ph, th) + gk.dome_dir(ax, ph, th) * lift

    # The rolled rim along the dome's own edge.
    rim_pts = [tuple(on(rim(2 * math.pi * i / 96), 2 * math.pi * i / 96, -0.0012)) for i in range(97)]
    objs.append(gk.fin(gk.tube("rim", rim_pts, 0.0038, sides=7, closed_ends=False, step=0.008), "trim"))
    # Two lames down the outside of the arm: bands of a slightly larger
    # sphere under the dome's outer edge, each a step out and down.
    a, f, sdir = gk.dome_frame(ax)
    out = Vector((1.0, 0.0, 0.0))
    out = (out - a * out.dot(a)).normalized()
    side = a.cross(out)
    for k in range(2):
        grow = 1.0 + 0.045 * (k + 1)
        p0 = phi_max - math.radians(5) + k * math.radians(13)
        p1 = p0 + math.radians(16)
        half = math.radians(62 - 10 * k)
        o = c - a * 0.003 * (k + 1)
        prof = [(R * grow * math.sin(p0 + (p1 - p0) * i / 3), R * grow * math.cos(p0 + (p1 - p0) * i / 3)) for i in range(4)]
        lame = gk.lathe(f"lame{k}", prof, segs=22, axis_origin=tuple(o), axis=tuple(a), ref=tuple(out), arc=2 * half, start=-half)
        gk.solidify(lame, 0.0045, offset=-1)
        gk.bevel(lame, 0.0015, segments=1, angle=40)
        objs.append(gk.fin(lame, "shell"))
        bead = []
        for i in range(41):
            az = -half + 2 * half * i / 40
            d = a * math.cos(p1) + (out * math.cos(az) + side * math.sin(az)) * math.sin(p1)
            bead.append(tuple(o + d * (R * grow - 0.0018)))
        objs.append(gk.fin(gk.tube(f"bead{k}", bead, 0.0026, sides=6, step=0.007), "trim"))
    # The crown ridge, front to back over the dome (theta 0 is the front).
    ridge = []
    for i in range(61):
        t = -1 + 2 * i / 60
        th = 0.0 if t >= 0 else math.pi
        ridge.append(tuple(on(abs(t) * rim(th) * 0.9, th, 0.0004)))
    objs.append(gk.fin(gk.tube("ridge", ridge, lambda t: 0.0046 * (0.5 + 0.5 * math.sin(math.pi * t)), sides=8, scale_xy=(0.65, 1.0), step=0.006), "trim"))
    # Three lit gills on the outer face.
    for j in range(3):
        ph = math.radians(38 + 9 * j)
        gill = [tuple(on(ph, math.pi / 2 + math.radians(-16 + 32 * i / 12), 0.0007)) for i in range(13)]
        objs.append(gk.fin(gk.tube(f"gill{j}", gill, 0.0017, sides=6, scale_xy=(1.0, 0.5), step=0.005), "glow"))
    # Rivets round the dome above the rim.
    for i in range(8):
        th = 2 * math.pi * (i + 0.5) / 8
        ph = rim(th) - math.radians(7)
        objs.append(gk.fin(gk.rivet(f"rv{i}", tuple(on(ph, th)), tuple(gk.dome_dir(ax, ph, th)), r=0.0033, h=0.0024), "trim"))
    out_objs = []
    for o in objs:
        out_objs.append(o)
        out_objs.append(gk.mirrored_copy(o))
    return out_objs


PIECES = {
    "pauldrons": dict(slot="shoulders", build=pauldrons, tex=1024),
}

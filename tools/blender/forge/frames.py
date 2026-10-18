"""
THE FRAMES — the blank's body shapes (docs/forge.md §2).

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/forge/frames.py -- [--render] [--nobake] [--only lean,heavy]

Writes public/forge/frames/<id>.glb + <id>_nrm.webp + <id>_orm.webp and
public/forge/frames/frames.json (each frame's ring chart).

SCULPTED, THEN SAMPLED. Each frame is a signed-distance SCULPT — ribcage,
shoulder girdle, deltoid caps, trapezius, neck, pectorals (a bust on
CURVED), scapulae, waist, pelvis, glutes and the tapering tip, smooth-
unioned — plus fine relief (the clavicles, the sternum's valley, the
spine's channel, the linea alba, the inguinal line). The game never sees
the sculpt: it sees a GRID laid over it.

ONE UNWRAP FOR EVERY FRAME. The grid is the old loft's: each row is a
horizontal slice of the sculpt, each column a direction round it chosen
exactly as the loft chose it (x = w·cos 2πu, z = d·sin 2πu over THE
BLANK's ring there — front, −z, at u = 0.75), and the vertex is where that
direction meets the surface. A row's v is its ANATOMICAL row s: the old
loft's v for that height (the cumulative profile arc of THE BLANK's
rings, 1 at the neck, 0 at the tip). Every frame shares the landmark
heights, so a row of s is the same place on every frame — paint lands on
the same part of the body whichever frame wears it, and STANDARD keeps
every look painted before the Forge where it was. Rows are SPACED by each
frame's own silhouette arc (dense where the shoulder rolls over, sparse
down the flank), which only changes which s values get a row.

THE CHART. Each frame's rows are measured off the low mesh and written
out (s, y, half-width, half-depth, z-offset) for THE PAINT's true-to-size
measure (avatar/paint.ts) and for fitting gear (avatar/gear.ts).
"""

import json
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--render" in argv
ICONS = "--icons" in argv
NOBAKE = "--nobake" in argv
ONLY = None
if "--only" in argv:
    ONLY = argv[argv.index("--only") + 1].split(",")

OUT = os.path.join(kit.PUBLIC, "frames")
COLS, ROWS = 60, 62            # the low mesh: quads round × rows down
HCOLS, HROWS = 384, 420        # the high mesh
NRM, ORM = 1024, 512
# The body's share of AMBIENT light (scales the baked occlusion). The broken
# bakes ran LEAN and CURVED at about this (fully occluded = 0.18) and
# STANDARD / HEAVY at 1. The user picked the darker ones' colour: the body's
# paint then comes from the scene's key lights, not a flat ambient wash.
FRAME_AMBIENT = 0.2
NECK_TOP = 0.488               # the head's seat is shared (boxer.ts NECK_SEAT)

# THE BLANK's rings (avatar/mannequin.ts BODY_RINGS): y, half-width,
# half-depth, z-offset — the old loft. They define s (the old v) by height,
# and the direction each column looks in.
BLANK = [
    (0.488, 0.048, 0.043, -0.058),
    (0.470, 0.058, 0.050, -0.045),
    (0.450, 0.080, 0.062, -0.028),
    (0.425, 0.165, 0.078, -0.010),
    (0.395, 0.252, 0.090, 0.0),
    (0.350, 0.232, 0.098, 0.0),
    (0.290, 0.166, 0.100, 0.0),
    (0.230, 0.124, 0.090, 0.0),
    (0.175, 0.094, 0.077, 0.0),
    (0.130, 0.090, 0.074, 0.0),
    (0.075, 0.105, 0.086, 0.0),
    (0.020, 0.126, 0.100, 0.0),
    (-0.020, 0.132, 0.104, 0.0),
    (-0.080, 0.115, 0.092, 0.0),
    (-0.140, 0.078, 0.065, 0.0),
    (-0.195, 0.040, 0.035, 0.0),
    (-0.230, 0.014, 0.013, 0.0),
]
_arc = [0.0]
for _k in range(1, len(BLANK)):
    _a, _b = BLANK[_k - 1], BLANK[_k]
    _arc.append(_arc[-1] + math.hypot(_b[0] - _a[0], ((_b[1] + _b[2]) - (_a[1] + _a[2])) / 2))
B_Y = np.array([r[0] for r in BLANK])[::-1]          # ascending y
B_S = np.array([1.0 - x / _arc[-1] for x in _arc])[::-1]
B_W = np.array([r[1] for r in BLANK])[::-1]
B_D = np.array([r[2] for r in BLANK])[::-1]
B_Z = np.array([r[3] for r in BLANK])[::-1]


def s_of_y(y):
    return np.interp(y, B_Y, B_S)


def blank_ring(y):
    return np.interp(y, B_Y, B_W), np.interp(y, B_Y, B_D), np.interp(y, B_Y, B_Z)


# ---------------------------------------------------------------------------
# The sculpt, slice by slice (game space, hips at y = 0, front −z)
#
# Rows are horizontal slices, so the body is designed as slices: a CORE
# superellipse whose half-width, half-depth, fore-aft centre and
# squareness are smooth curves of height (the silhouette, drawn the way a
# car designer draws one), plus a SPHERE at each shoulder — the deltoid
# cap, a clean finished end where an arm would hang — melted into the
# core. On top go CHARACTER LINES, not muscles: a pectoral shelf with a
# crisp lower edge, an abdominal plate, the scapular plates, the spine's
# channel, the clavicles and the inguinal line. Broad planes, crisp edges:
# surfaces that take paint the way a car's panels take a livery.
# ---------------------------------------------------------------------------

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy)), t


def pchip(xs, ys, x):
    """Monotone cubic (Fritsch–Carlson) through (xs ascending, ys)."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h = np.diff(xs)
    dl = np.diff(ys) / h
    m = np.zeros_like(ys)
    for i in range(1, len(ys) - 1):
        if dl[i - 1] * dl[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
    m[0], m[-1] = dl[0], dl[-1]
    x = np.clip(np.asarray(x, float), xs[0], xs[-1])
    i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
    t = (x - xs[i]) / h[i]
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]


# THE CORE of STANDARD, top → down: y, half-width, half-depth, z-centre,
# squareness. THE BLANK's silhouette (shoulder line ±0.252 with the caps,
# chest ±0.166 × 0.100, the waist pinch ±0.090 × 0.074 at 0.13, the hip
# line ±0.132 × 0.104, the tip at −0.23), drawn as one smooth curve.
CORE = [
    (0.4880, 0.0440, 0.0400, -0.0580, 2.0),
    (0.4700, 0.0470, 0.0430, -0.0470, 2.0),
    (0.4520, 0.0560, 0.0500, -0.0330, 2.0),
    (0.4400, 0.0900, 0.0580, -0.0200, 2.2),
    (0.4250, 0.1480, 0.0680, -0.0080, 2.5),
    (0.4100, 0.1820, 0.0790, -0.0020, 2.8),
    (0.3950, 0.1960, 0.0880, 0.0000, 3.0),
    (0.3700, 0.1990, 0.0960, 0.0000, 3.0),
    (0.3400, 0.1900, 0.1000, 0.0000, 2.8),
    (0.3000, 0.1700, 0.1020, 0.0000, 2.6),
    (0.2500, 0.1400, 0.0960, 0.0000, 2.4),
    (0.2000, 0.1110, 0.0850, 0.0000, 2.25),
    (0.1600, 0.0940, 0.0770, 0.0000, 2.15),
    (0.1300, 0.0900, 0.0740, 0.0000, 2.1),
    (0.0800, 0.1000, 0.0820, 0.0010, 2.15),
    (0.0300, 0.1190, 0.0950, 0.0020, 2.2),
    (-0.0200, 0.1300, 0.1020, 0.0030, 2.25),
    (-0.0700, 0.1210, 0.0960, 0.0030, 2.2),
    (-0.1200, 0.0960, 0.0780, 0.0020, 2.1),
    (-0.1700, 0.0620, 0.0520, 0.0010, 2.0),
    (-0.2050, 0.0330, 0.0290, 0.0000, 2.0),
    (-0.2220, 0.0170, 0.0150, 0.0000, 2.0),
    (-0.2310, 0.0010, 0.0010, 0.0000, 2.0),
]


def core_of(edits):
    """A frame's core: STANDARD's, with width/depth ratios given at a few
    heights and interpolated between (held at 1 at the neck's top and the
    tip, which every frame shares)."""
    ys = sorted(edits)
    out = []
    for (y, w, d, z, n) in CORE:
        if y >= 0.47 or y <= -0.215:
            rw = rd = 1.0
        else:
            rw = float(np.interp(y, ys, [edits[k][0] for k in ys]))
            rd = float(np.interp(y, ys, [edits[k][1] for k in ys]))
        out.append((y, w * rw, d * rd, z, n))
    return out


FRAMES = {
    "standard": dict(
        name="STANDARD", core=CORE,
        cap=(0.054, 0.198, 0.372),       # radius, x, y
        pec=0.0060, bust=0.0, abs=0.0026, scap=0.0042, glute=0.0075,
    ),
    "lean": dict(
        name="LEAN",
        core=core_of({0.46: (0.95, 0.96), 0.43: (0.90, 0.94), 0.40: (0.89, 0.93), 0.30: (0.89, 0.91),
                      0.13: (0.90, 0.91), -0.02: (0.93, 0.94), -0.12: (0.95, 0.95)}),
        cap=(0.048, 0.178, 0.374),
        pec=0.0048, bust=0.0, abs=0.0030, scap=0.0038, glute=0.0065,
    ),
    "heavy": dict(
        name="HEAVY",
        core=core_of({0.46: (1.14, 1.10), 0.43: (1.12, 1.14), 0.40: (1.07, 1.14), 0.34: (1.08, 1.13),
                      0.30: (1.12, 1.14), 0.2: (1.16, 1.14), 0.13: (1.17, 1.15), -0.02: (1.08, 1.07), -0.12: (1.06, 1.06)}),
        cap=(0.062, 0.210, 0.370),
        pec=0.0080, bust=0.0, abs=0.0022, scap=0.0050, glute=0.0080,
    ),
    "curved": dict(
        name="CURVED",
        core=core_of({0.46: (0.92, 0.94), 0.43: (0.86, 0.92), 0.40: (0.86, 0.92), 0.34: (0.85, 0.93),
                      0.30: (0.88, 0.95), 0.2: (0.88, 0.92), 0.13: (0.86, 0.88), 0.03: (1.0, 0.98),
                      -0.02: (1.08, 1.05), -0.07: (1.09, 1.06), -0.12: (1.05, 1.04)}),
        cap=(0.046, 0.172, 0.376),
        pec=0.0, bust=0.019, abs=0.0018, scap=0.0034, glute=0.0110,
    ),
}


def core_at(fr, y):
    c = fr["core"][::-1]
    ys = [r[0] for r in c]
    return tuple(pchip(ys, [r[k] for r in c], y) for k in range(1, 5))


def slice_sd(fr, y, x, z):
    """2D signed distance of the slices at heights y (R) for points (R × C)."""
    w, d, zc, n = core_at(fr, y)
    # The neck's top edge is a rolled lip (a 5 mm quarter-round), not a cut.
    lipr = 0.005
    q = np.clip((y - (NECK_TOP - lipr)) / lipr, 0, 1)
    loss = lipr * (1 - np.sqrt(1 - q * q))
    w = w - loss
    d = d - loss
    w, d, zc, n = w[:, None], d[:, None], zc[:, None], n[:, None]
    zz = z - zc
    f = (np.abs(x / w) ** n + np.abs(zz / d) ** n) ** (1.0 / n)
    sd = (f - 1.0) * np.minimum(w, d)
    R, cx, cy = fr["cap"]
    rr = np.sqrt(np.maximum(R * R - (y[:, None] - cy) ** 2, 0.0))
    cap = np.hypot(np.abs(x) - cx, zz) - rr
    cap = np.where(rr > 0, cap, 1.0)
    return smin(sd, cap, 0.022)


def relief(fr, x, y, front, wch):
    """Character lines (metres, outward along the slice normal)."""
    kx = wch / 0.170
    ahead = smooth(0.2, 0.75, front)
    behind = smooth(0.2, 0.75, -front)
    ax = np.abs(x)
    d = np.zeros_like(x)
    # THE PECTORAL SHELF: a plate either side of the sternum, its lower
    # edge a crisp line sweeping up to the armpit.
    if fr["pec"] > 0:
        edge = 0.262 + 0.075 * np.clip(ax / (0.155 * kx), 0, 1.3) ** 2.4
        plate = smooth(0.0, 0.0045, y - edge) * smooth(0.405, 0.36, y) * smooth(0.004, 0.012, ax) * smooth(0.175 * kx, 0.13 * kx, ax)
        d += fr["pec"] * plate * ahead
    # THE BUST: two soft rounded forms, a little apart, turned outward.
    if fr["bust"] > 0:
        for side in (-1, 1):
            dx = (x - side * 0.060 * kx) / (0.060 * kx)
            dy = y - 0.292
            dy = np.where(dy < 0, dy / 0.046, dy / 0.07)
            r2 = dx * dx + dy * dy
            d += fr["bust"] * np.clip(1 - r2, 0, 1) ** 0.85 * ahead
    # Clavicles.
    R, cx, cy = fr["cap"]
    for side in (-1, 1):
        dist, t = seg_dist(x * side, y, 0.026, 0.437, cx * 0.9, 0.41)
        d += 0.0024 * np.exp(-(dist / 0.006) ** 2) * smooth(-0.3, 0.3, front) * smooth(0.0, 0.12, t)
    d -= 0.0035 * np.exp(-((x / 0.014) ** 2 + ((y - 0.441) / 0.010) ** 2)) * ahead  # jugular notch
    d -= 0.0022 * np.exp(-(x / 0.008) ** 2) * smooth(0.25, 0.29, y) * smooth(0.42, 0.36, y) * ahead  # sternum
    # THE ABDOMINAL PLATE: a raised panel with rounded corners, split
    # down the middle by the linea alba.
    hw = 0.056 * kx
    corner = np.hypot(np.maximum(ax - (hw - 0.02), 0), np.maximum(np.abs(y - 0.15) - (0.085 - 0.02), 0))
    d += fr["abs"] * smooth(0.02, 0.016, corner) * ahead
    d -= 0.0012 * np.exp(-(x / 0.006) ** 2) * smooth(0.07, 0.1, y) * smooth(0.24, 0.21, y) * ahead
    # The inguinal line: the hip bone in toward the base.
    pw = float(core_at(fr, np.array([-0.02]))[0][0])
    for side in (-1, 1):
        dist, t = seg_dist(x * side, y, pw * 0.72, 0.04, 0.026, -0.095)
        d -= 0.0024 * np.exp(-(dist / 0.007) ** 2) * ahead * smooth(0.0, 0.1, t) * smooth(1.0, 0.85, t)
    # THE SCAPULAR PLATES: broad and soft-edged, crisp only along the
    # inner (medial) border where the blade stands off the back.
    for side in (-1, 1):
        sx = x * side - 0.084 * kx
        sy = y - 0.312
        body_ = np.clip(1 - (sx / (0.058 * kx)) ** 2 - (sy / 0.075) ** 2, 0, 1) ** 0.8
        medial = smooth(-0.05 * kx, -0.042 * kx, sx)
        d += fr["scap"] * body_ * medial * behind
    # The spine's channel.
    d -= 0.003 * np.exp(-(x / 0.009) ** 2) * smooth(-0.04, 0.02, y) * smooth(0.45, 0.40, y) * behind
    # GLUTES: two soft rounded forms.
    for side in (-1, 1):
        dx = (x - side * 0.056 * kx) / (0.062 * kx)
        dy = y + 0.05
        dy = np.where(dy < 0, dy / 0.055, dy / 0.07)
        d += fr["glute"] * np.clip(1 - (dx * dx + dy * dy), 0, 1) ** 1.3 * behind
    return d


# ---------------------------------------------------------------------------
# The grid
# ---------------------------------------------------------------------------

def slice_hits(fr, y, u):
    """Where the column directions of rows at heights y (R) meet the
    slice: (R × C × 3) points, relief applied."""
    w0, d0, z0 = blank_ring(y)
    zc = core_at(fr, y)[2]
    t = u * 2 * np.pi
    dx = np.cos(t)[None, :] * w0[:, None]
    dz = np.sin(t)[None, :] * d0[:, None]
    ln = np.hypot(dx, dz)
    dx, dz = dx / ln, dz / ln
    R, C = len(y), len(u)
    Y = np.repeat(y[:, None], C, axis=1)
    ZC = np.repeat(zc[:, None], C, axis=1)
    # March in from outside: the first inside sample, then bisect.
    far, n = 0.4, 400
    hit = np.full((R, C), np.nan)
    for tt in np.linspace(far, 0.0, n):
        inside = slice_sd(fr, y, dx * tt, ZC + dz * tt) < 0
        new = inside & np.isnan(hit)
        hit[new] = tt
        if not np.isnan(hit).any():
            break
    hit = np.nan_to_num(hit, nan=0.0)
    lo, hi = hit, hit + far / (n - 1)
    for _ in range(20):
        mid = (lo + hi) / 2
        inside = slice_sd(fr, y, dx * mid, ZC + dz * mid) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    tt = (lo + hi) / 2
    PX, PZ = dx * tt, ZC + dz * tt
    e = 1e-5
    gx = slice_sd(fr, y, PX + e, PZ) - slice_sd(fr, y, PX - e, PZ)
    gz = slice_sd(fr, y, PX, PZ + e) - slice_sd(fr, y, PX, PZ - e)
    gl = np.hypot(gx, gz) + 1e-12
    nx, nz = gx / gl, gz / gl
    front = -nz
    wch = float(core_at(fr, np.array([0.30]))[0][0])
    rel = relief(fr, PX, Y, front, wch)
    rel *= (smooth(-0.225, -0.17, y) * smooth(NECK_TOP, NECK_TOP - 0.03, y))[:, None]
    PX = PX + nx * rel
    PZ = PZ + nz * rel
    return np.stack([PX, Y, PZ], axis=-1)


def row_heights(fr, n):
    """n+1 row heights, top → down, evenly spaced along the frame's own
    silhouette (front and side profile arcs averaged), so rows crowd where
    the shoulders roll over and thin out down the flank."""
    ys = np.linspace(NECK_TOP - 0.0003, -0.2305, 900)
    P = slice_hits(fr, ys, np.array([0.0, 0.25, 0.5, 0.75]))
    W = (P[:, 0, 0] - P[:, 2, 0]) / 2
    D = (P[:, 1, 2] - P[:, 3, 2]) / 2
    seg = np.hypot(np.diff(ys), (np.abs(np.diff(W)) + np.abs(np.diff(D))) / 2)
    arc = np.concatenate([[0], np.cumsum(seg)])
    return np.interp(np.linspace(0, arc[-1], n + 1), arc, ys)


def build_mesh(name, fr, nu, nv, with_uv=True):
    y = row_heights(fr, nv)
    u = np.arange(nu) / nu
    P = slice_hits(fr, y, u)
    s = s_of_y(y)
    rows = nv + 1
    verts = [tuple(p) for p in P.reshape(-1, 3)]
    top = len(verts)
    verts.append((0.0, float(P[0, :, 1].mean()) + 0.0035, float(P[0, :, 2].mean())))
    bot = len(verts)
    verts.append((0.0, float(P[-1, :, 1].mean()) - 0.0025, float(P[-1, :, 2].mean())))
    faces, uvs = [], []
    for r in range(rows - 1):
        for c in range(nu):
            c1 = (c + 1) % nu
            a, b = r * nu + c, r * nu + c1
            a2, b2 = (r + 1) * nu + c, (r + 1) * nu + c1
            faces.append((a, a2, b2, b))
            u0, u1 = c / nu, (c + 1) / nu
            uvs += [(u0, s[r]), (u0, s[r + 1]), (u1, s[r + 1]), (u1, s[r])]
    for c in range(nu):
        c1 = (c + 1) % nu
        u0, u1 = c / nu, (c + 1) / nu
        faces.append((top, c, c1))
        uvs += [((u0 + u1) / 2, 1.0), (u0, s[0]), (u1, s[0])]
        l0 = (rows - 1) * nu
        faces.append((bot, l0 + c1, l0 + c))
        uvs += [((u0 + u1) / 2, 0.0), (u1, s[-1]), (u0, s[-1])]
    ob = kit.mesh_object(name, verts, faces, uvs if with_uv else None)
    kit.select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob, P, s


def chart(P, s):
    out = []
    for r in range(P.shape[0]):
        row = P[r]
        x0, x1 = row[:, 0].min(), row[:, 0].max()
        z0, z1 = row[:, 2].min(), row[:, 2].max()
        out.append([round(float(s[r]), 5), round(float(row[:, 1].mean()), 5), round(float((x1 - x0) / 2), 5),
                    round(float((z1 - z0) / 2), 5), round(float((z1 + z0) / 2), 5)])
    return out


# ---------------------------------------------------------------------------

def bake_frame(fid, low, high):
    shell, t = kit.make_finish(f"{fid}_shell", "shell", bevel=0.0, ao_dist=0.06, micro=0.6, edge_wear=False)
    low.data.materials.append(shell)
    high.data.materials.append(shell)
    nrm = kit.new_image(f"{fid}_nrm", NRM, "nrm")
    orm = kit.new_image(f"{fid}_orm", ORM, "orm")
    kit.bake([low], [t], "nrm", nrm, samples=1, high=[high], extrusion=0.006)
    # The occlusion bake sees ONLY this frame. The frames built before it
    # still stand at the origin, and they used to bake into it: LEAN came
    # out black inside STANDARD, CURVED black inside HEAVY save the bust
    # and glutes that poke through it.
    others = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not low and not o.hide_render]
    for o in others + [high]:
        o.hide_render = True
    kit.bake([low], [t], "orm", orm, samples=64)
    for o in others + [high]:
        o.hide_render = False
    a = kit.pixels(nrm)
    a[..., 3] = 1
    kit.write_webp(os.path.join(OUT, f"{fid}_nrm.webp"), a, 92)
    b = kit.pixels(orm)
    b[..., 3] = 1
    b[..., 0] *= FRAME_AMBIENT
    kit.write_webp(os.path.join(OUT, f"{fid}_orm.webp"), b, 90)
    return shell


def head_egg():
    """THE BLANK's head for the review renders (mannequin.ts: a sphere of
    BODY_IK.headRadius scaled HEAD_SCALE, seated at NECK_SEAT)."""
    r = 0.13
    seat = 0.488 + r * (1.0 - 0.05) + 0.018
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=r, location=kit.to_blender((0, seat + r * 0.05, 0)))
    ob = bpy.context.active_object
    ob.scale = (0.94, 0.97, 1.0)
    bpy.ops.object.shade_smooth()
    return ob


def review(built, tag="frames"):
    """The frames side by side (STANDARD on the left), turned together
    for each view so every figure is seen square."""
    scn = bpy.context.scene
    kit.studio(scn, bg=(0.03, 0.032, 0.04))
    egg_mat, _ = kit.make_finish("egg", "shell", bevel=0.0)
    n = len(built)
    gap = 0.72
    pivots = []
    for i, (fid, low, high) in enumerate(built):
        high.hide_render = True
        high.hide_viewport = True
        piv = bpy.data.objects.new(f"piv_{fid}", None)
        kit.link(piv)
        piv.location.x = -(i - (n - 1) / 2) * gap
        low.parent = piv
        egg = head_egg()
        egg.data.materials.append(egg_mat)
        egg.parent = piv
        pivots.append(piv)
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, -0.32))
    floor = bpy.context.active_object
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.02, 0.02, 0.025, 1)
    fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.45
    floor.data.materials.append(fm)
    w = max(1.0, n * gap)
    kit.camera(scn, (0, 0.17, 0), dist=w * 3.0, yaw_deg=0, pitch_deg=5, lens=85)
    for name, yaw in (("front", 0), ("three", -35), ("side", -90), ("back", 180)):
        for piv in pivots:
            piv.rotation_euler.z = math.radians(yaw)
        kit.render_to(scn, os.path.join(kit.RENDERS, f"{tag}_{name}.png"), res=(2000, 1000), samples=48)


def icons(built):
    """The locker's tiles: each frame alone, three-quarter front, its head
    floating above it, on a transparent ground (public/forge/icons)."""
    scn = bpy.context.scene
    kit.studio(scn, bg=(0.42, 0.44, 0.48), transparent=True, strength=1.5)
    egg_mat, _ = kit.make_finish("egg_icon", "shell", bevel=0.0)
    egg = head_egg()
    egg.data.materials.append(egg_mat)
    piv = bpy.data.objects.new("icon_piv", None)
    kit.link(piv)
    egg.parent = piv
    piv.rotation_euler.z = math.radians(-28)
    kit.camera(scn, (0, 0.2, 0), dist=3.1, yaw_deg=0, pitch_deg=7, lens=85)
    for fid, low, high in built:
        for _, o, h in built:
            o.hide_render = o is not low
            h.hide_render = True
        low.parent = piv
        low.location = (0, 0, 0)
        path = os.path.join(kit.WORK, "icons", f"frame-{fid}.png")
        kit.render_to(scn, path, res=(320, 400), samples=64)
        img = bpy.data.images.load(path)
        arr = kit.pixels(img)
        kit.write_webp(os.path.join(kit.PUBLIC, "icons", f"frame-{fid}.webp"), arr, 88)


def main():
    kit.reset()
    scn = bpy.context.scene
    kit.set_gpu(scn)
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "frames.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    built = []
    for fid, fr in FRAMES.items():
        if ONLY and fid not in ONLY:
            continue
        low, P, s = build_mesh(fid, fr, COLS, ROWS)
        high, _, _ = build_mesh(fid + "_high", fr, HCOLS, HROWS, with_uv=False)
        meta[fid] = dict(name=fr["name"], cols=COLS, rows=ROWS, tris=COLS * ROWS * 2 + COLS * 2, chart=chart(P, s))
        if NOBAKE:
            mat, _ = kit.make_finish(f"{fid}_shell", "shell", bevel=0.0)
            low.data.materials.append(mat)
        else:
            mat = bake_frame(fid, low, high)
            kit.export_glb([low], os.path.join(OUT, f"{fid}.glb"))
            low.data.materials.append(mat)
        built.append((fid, low, high))
        print("frame", fid, "done", flush=True)
    if not NOBAKE:
        with open(meta_path, "w") as f:
            json.dump(meta, f, separators=(",", ":"))
        print("wrote", meta_path, flush=True)
    os.makedirs(kit.WORK, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kit.WORK, "frames.blend"))
    if ICONS:
        icons(built)
    elif RENDER:
        review(built)


if __name__ == "__main__":
    main()

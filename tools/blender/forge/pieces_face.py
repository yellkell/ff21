"""
THE FACES — Forge heads for the `face` slot (heads.ts): BEAR, PANTHER,
EAGLE, KNIGHT, as clean cyberpunk HELMETS of one family with THE BLANK's
face (head.py) and the WOLF / FROG / BUNNY (pieces_face2.py): a ceramic
shell, dark visor glass with lit slits, steel trim at the seams, crisp
seams and machined caps — no pods, drums or circles, no spiky fin clusters,
and where forms blend the shell is one continuous surface.

Built with pieces_face2's pipeline: each helmet's SHELL is its clean parts
as meshes (a dome pulled out onto its blended swells — blended_shell — and
profiled lofts, plates and fins); the HIGH it is baked from is the same
parts as one OpenVDB field, filleted and seamed; trim and glow are laid on
that field. Each head measures its cranium for its `fit`.

Ears are separate parts with a clear base pivot (EAR_PIVOTS below), never
fused into the shell's mesh, for the floppy-part system to come.
"""

import math

import numpy as np

import gearkit as gk
from pieces_face2 import (A, Field, clipped_ellipsoid, Head, Prim, basis, blended_shell, chamfer_profile, clip, cylinder, drape_ring,
                          ellipsoid, ellipsoid_mesh, frame_look, groove_trim, land, lens_profile, loft_profile,
                          mesh_part, mesh_prim, np_mesh, path_loft, plate_poly, profile_poly, rot, rounded_box,
                          sdf_part, seam, seam_path, slab, slot_insert, smooth_path, smoothstep, surface_path,
                          sweep, unit, with_k)

PIECES = {}
EAR_PIVOTS = {}  # id -> [(root point, swing axis)] in head space

ROUND_PROF = [(1, 0.35), (0.86, 1), (-0.86, 1), (-1, 0.35), (-1, -0.35), (-0.86, -1), (0.86, -1), (1, -0.35)]
BROW_PROF = [(1.0, 1.0), (1.0, -0.2), (0.2, -1.0), (-1.0, -1.0), (-1.0, 1.0)]


def visor(F, ctx, key, y0, rise, span=1.2, n=31, axis_z=0.0, power=1.3):
    """The dark visor glass round the face: a band landed on the skin."""
    if key not in ctx:
        th = np.linspace(-span, span, n)
        ys = y0 + rise * np.abs(th / span) ** power
        ctx[key] = surface_path(F, drape_ring(F, ys, th, axis_z, r_out=0.35), 2)
    return ctx[key]


def visor_parts(ctx, key, half_h, slit_from=0.14, slit_to=0.72, slit_h=0.003, out=None, thick=0.0032, lenses=None):
    """... `lenses` = (at, half_w, half_h, radius): big rounded lit lenses
    instead of slits."""
    """The band (trim) and its two lit slits (glow)."""
    out = [] if out is None else out
    P, N = ctx[key]
    V, Q, T = path_loft(P + N * 0.0012, half_h, thick, lambda t: A(0, 1, 0), profile=profile_poly(ROUND_PROF, corner=6),
                        seg=8, sub=1, caps=(0.3, 0.3), cap_rings=2)
    out.append(mesh_part("visor", V, Q, T, "trim"))
    n = len(P)
    if lenses:
        at, hw, hh, rad = lenses
        for side in (-1, 1):
            i = int(round((n - 1) / 2 + side * at * (n - 1) / 2))
            p, nn = P[i], N[i]
            R = basis(x=unit(np.cross((0, 1, 0), nn)), y=nn)
            out.append(sdf_part(f"lens{side}", [with_k(slab(p + nn * (thick + 0.0016), R, hw, hh, rad, 0.0016), 0.0)],
                                "glow", tris=180, h=0.0006))
        return out
    for side in (-1, 1):
        idx = [i for i in range(n) if slit_from < side * (i - (n - 1) / 2) / ((n - 1) / 2) < slit_to]
        if side < 0:
            idx = idx[::-1]
        Vs, Qs, Ts = path_loft(P[idx] + N[idx] * (thick + 0.001), slit_h, 0.0015, (0, 1, 0), profile=lens_profile(),
                               seg=6, sub=1, caps=(0.5, 0.5), cap_rings=2)
        out.append(mesh_part(f"slit{side}", Vs, Qs, Ts, "glow"))
    return out


def vent_slots(F, pts, cut=True, out=None, name="vent", half=(0.011, 0.0016, 0.0013), forward=(0, 0, -1)):
    """Steel vent slots (THE BLANK's mouth vent): cut into the field, a bar
    set in each."""
    for j, (p, n) in enumerate(pts):
        R = basis(x=forward, y=n)
        if cut:
            F.cut(rounded_box(p, (half[0] + 0.001, 0.004, half[2] + 0.0008), 0.001, R), k=0.0006)
        elif out is not None:
            out.append(slot_insert(f"{name}{j}", p - n * 0.0025, R, half, "trim"))


# ===========================================================================
# BEAR — a broad heavy helm: a brow like a wall over a visor stripe, a
# faceted snout plate and a machined nose cap, small rounded ear fins
# ===========================================================================

BEAR_DOME = ((0, 0.012, 0.02), (0.12, 0.112, 0.118))
BEAR_CLIPS = [((0, 0.42, -0.9), (0, 0.075, -0.082))]
BEAR_JOWLS = [((s * 0.072, -0.052, -0.035), (0.058, 0.05, 0.06)) for s in (-1, 1)]


def _bear_extras():
    return [(ellipsoid(c, r), 0.03) for c, r in BEAR_JOWLS]


def _bear_snout(seg=96, sub=12):
    st = [
        dict(top=(0.03, -0.058), bot=(-0.092, -0.045), w=0.064),
        dict(top=(0.012, -0.108), bot=(-0.088, -0.103), w=0.059),
        dict(top=(-0.002, -0.148), bot=(-0.082, -0.146), w=0.051),
        dict(top=(-0.01, -0.171), bot=(-0.077, -0.17), w=0.045),
    ]
    return loft_profile(st, chamfer_profile(top=0.55, side_top=0.38, side_bot=-0.5, bot=0.7), seg=seg, sub=sub,
                        caps=(0.1, 0.1), cap_rings=max(3, sub))


def _bear_nosecap(seg=64, sub=6):
    st = [
        dict(top=(0.0, -0.148), bot=(-0.03, -0.149), w=0.046),
        dict(top=(-0.006, -0.165), bot=(-0.032, -0.165), w=0.043),
        dict(top=(-0.009, -0.177), bot=(-0.033, -0.177), w=0.04),
    ]
    return loft_profile(st, chamfer_profile(top=0.55, side_top=0.38, side_bot=-0.5, bot=0.7, corner=3), seg=seg, sub=sub,
                        caps=(0.05, 0.08), cap_rings=3)


def _bear_ear_path(side):
    return [(side * 0.074, 0.084, 0.032), (side * 0.084, 0.106, 0.035), (side * 0.09, 0.12, 0.036)]


def _bear_ear(side, seg=40, sub=8):
    return path_loft(_bear_ear_path(side), [0.03, 0.034, 0.03], [0.009, 0.0085, 0.007], (1, 0, 0.3),
                     profile=profile_poly(ROUND_PROF, corner=8), seg=seg, sub=sub, caps=(0.3, 1.0), cap_rings=max(3, sub // 2))


def _bear_brow(ctx, seg=40, sub=6):
    P = ctx["brow"]
    n = len(P)
    wid = [0.012 + 0.006 * math.sin(math.pi * i / (n - 1)) ** 0.5 for i in range(n)]
    return path_loft(P, wid, [0.0105] * n, (0, 1, 0.5), profile=profile_poly(BROW_PROF, corner=3), seg=seg, sub=sub,
                     caps=(0.3, 0.3), cap_rings=3)


def bear_form(F, ctx):
    F.add(ellipsoid(*BEAR_DOME))
    for n, p0 in BEAR_CLIPS:
        clip(F, n, p0, k=0.008, hi=(0.2, 0.3, 0.0))
    for prim, k in _bear_extras():
        F.add(prim, k)
    F.add(mesh_prim(*_bear_snout()), k=0.012)
    for side in (-1, 1):
        F.add(mesh_prim(*_bear_ear(side)), k=0.005)
    if "brow" not in ctx:
        pts = []
        for t in np.linspace(-1, 1, 15):
            x = t * 0.1
            y = 0.06 + 0.012 * abs(t) ** 1.2
            p, n = land(F, (x, y, -0.4), (0, 0, 1)) if abs(t) < 0.6 else land(F, (x * 4, y, -0.3), unit((-np.sign(x), 0, 1)))
            pts.append(p + n * 0.007)
        ctx["brow"] = smooth_path(A(pts), 2)
    F.add(mesh_prim(*_bear_brow(ctx)), k=0.004)
    visor(F, ctx, "visor", 0.026, 0.02, span=1.15)
    if "mouth" not in ctx:
        th = np.linspace(-1.2, 1.2, 33)
        ctx["mouth"] = surface_path(F, drape_ring(F, np.full(33, -0.07), th, -0.09, r_out=0.3), 2)
        ctx["vents"] = [[land(F, (s * 0.25, -0.03 - 0.0085 * j, -0.128), (-s, 0, 0)) for j in range(3)]
                        for s in (-1, 1)]
        ctx["crown"] = seam_path(F, [(0, 0.2, -0.05), (0, 0.2, 0.02), (0, 0.2, 0.08), (0, 0.1, 0.16), (0, 0.0, 0.17)], 40)
        ctx["mask"] = [seam_path(F, [(s * 0.2, 0.07, -0.01), (s * 0.2, 0.02, -0.005), (s * 0.2, -0.03, -0.02), (s * 0.2, -0.075, -0.04)], 24)
                       for s in (-1, 1)]
    P, N = ctx["visor"]
    F.cut(sweep((P + N * 0.002)[1:-1], 0.0185), k=0.002)
    P, N = ctx["mouth"]
    F.cut(sweep(P, 0.0022), k=0.001)
    for side in (-1, 1):
        vent_slots(F, ctx["vents"][(side + 1) // 2])
    seam(F, ctx["crown"])
    for pth in ctx["mask"]:
        seam(F, pth)


def bear_lows(F, ctx):
    out = [blended_shell("dome", BEAR_DOME, BEAR_CLIPS, _bear_extras(), F.lo, F.lo + F.h * (F.n - 1), segs=48, rings=26),
           np_mesh("snout", *_bear_snout(seg=24, sub=2)),
           np_mesh("brow", *_bear_brow(ctx, seg=10, sub=2))]
    for side in (-1, 1):
        out.append(np_mesh(f"ear{side}", *_bear_ear(side, seg=14, sub=3)))
    return out


def bear_parts(F, ctx):
    out = visor_parts(ctx, "visor", 0.0175, lenses=(0.36, 0.019, 0.0125, 0.0075))
    P, N = ctx["mouth"]
    out.append(groove_trim("mouth", P, N, 0.0017, 0.0011, step=0.009))
    for side in (-1, 1):
        vent_slots(F, ctx["vents"][(side + 1) // 2], cut=False, out=out, name=f"vent{side}")
        path = _bear_ear_path(side)
        V, Q, T = path_loft([A(p) + A(0, 0.002, -0.0085) for p in path], [0.019, 0.022, 0.018], 0.0022, (1, 0, 0.3),
                            profile=profile_poly(ROUND_PROF, corner=8), seg=10, sub=3, caps=(0.3, 1.0), cap_rings=2)
        out.append(mesh_part(f"earpanel{side}", V, Q, T, "trim"))
        # the lit ear: a glowing line round the steel panel's rim
        rim = [A(p) + A(0, 0.002, -0.0098) for p in path]
        Vg, Qg, Tg = path_loft(rim, [0.0115, 0.0135, 0.010], 0.0012, (1, 0, 0.3), profile=profile_poly(ROUND_PROF, corner=8),
                               seg=10, sub=3, caps=(0.3, 1.0), cap_rings=2)
        out.append(mesh_part(f"earglow{side}", Vg, Qg, Tg, "glow"))
    cap = [with_k(mesh_prim(*_bear_nosecap()), 0.0)]
    tip = A(0, -0.02, -0.181)
    for side in (-1, 1):
        cap.append(("cut", rounded_box(tip + A(side * 0.014, 0.0, 0.0), (0.008, 0.0016, 0.008), 0.0007, rot((0, 0, 1), side * 0.25)), 0.0004))
    ring = [A(math.cos(t) * 0.058, -0.016 + math.sin(t) * 0.02, -0.158) for t in np.linspace(0, 2 * math.pi, 33)]
    cap.append(("cut", sweep(ring, 0.0009), 0.0))
    out.append(sdf_part("nosecap", cap, "trim", tris=420, h=0.0006, pad=0.006))
    return out


def bear_cranium(F, ctx):
    F.add(ellipsoid(*BEAR_DOME))
    for n, p0 in BEAR_CLIPS:
        clip(F, n, p0, k=0.008, hi=(0.2, 0.3, 0.0))
    return (0, 0.02, 0.02)


BEAR = Head("bear", (-0.2, -0.16, -0.22), (0.2, 0.19, 0.2), bear_form, bear_parts, bear_cranium,
            h_low=0.0022, sharp=40.0, lows=bear_lows, registry=PIECES)
EAR_PIVOTS["bear"] = [(A(_bear_ear_path(s)[0]), unit((0, 0, 1))) for s in (-1, 1)]

PIECES["bear"] = dict(slot="face", build=BEAR.build, tex=1024, uv_angle=66,
                      fit=dict(s=(0.982, 0.861, 0.936), y=0.0064, z=0.02), view=dict(target=(0, 0.0, -0.02), dist=1.05))


# ===========================================================================
# PANTHER — a sleek feline helm: a short faceted muzzle, cheekbones cut as
# planes, a narrow slanted visor with lit slits, swept triangular ear fins,
# swept cheek plates mounted flush, a triangle nose cap
# ===========================================================================

PANTHER_DOME = ((0, 0.0, 0.024), (0.1, 0.094, 0.12))
PANTHER_PADS = [((s * 0.026, -0.042, -0.09), (0.03, 0.024, 0.027)) for s in (-1, 1)]


def _pad_clips(i):
    c, r = PANTHER_PADS[i]
    s = -1 if i == 0 else 1
    return [((s * 0.55, 0.0, -0.83), A(c) + unit((s * 0.55, 0.0, -0.83)) * r[2] * 0.75), ((0, -1, -0.3), A(c) + A(0, -r[1] * 0.7, 0))]
PANTHER_CLIPS = [((0.7, -0.3, -0.65), (0.062, -0.015, -0.058)), ((-0.7, -0.3, -0.65), (-0.062, -0.015, -0.058)),
                 ((0, -0.72, -0.69), (0, -0.064, -0.07)), ((0, 0.45, -0.89), (0, 0.068, -0.075))]


def _panther_muzzle(seg=96, sub=12):
    st = [
        dict(top=(0.042, -0.05), bot=(-0.066, -0.044), w=0.052),
        dict(top=(0.018, -0.088), bot=(-0.062, -0.086), w=0.047),
        dict(top=(0.004, -0.108), bot=(-0.058, -0.108), w=0.04),
        dict(top=(-0.004, -0.118), bot=(-0.054, -0.118), w=0.032),
    ]
    return loft_profile(st, chamfer_profile(top=0.22, side_top=0.05, side_bot=-0.7, bot=0.8), seg=seg, sub=sub,
                        caps=(0.1, 0.12), cap_rings=max(3, sub))


def _panther_cheekbone(P, seg=32, sub=6):
    """A sharp cheekbone ridge from under the visor's outer end down and
    back to the jaw hinge: flat on top, raked underneath."""
    n = len(P)
    return path_loft(P, [0.004, 0.011, 0.01, 0.003], [0.0055] * n, (0, 1, 0.4), profile=profile_poly(BROW_PROF, corner=3),
                     seg=seg, sub=sub, caps=(0.4, 0.4), cap_rings=3)


def _panther_ear_path(side):
    return [(side * 0.056, 0.082, 0.018), (side * 0.07, 0.128, 0.044), (side * 0.08, 0.168, 0.076)]


def _panther_ear(side, seg=40, sub=8):
    return path_loft(_panther_ear_path(side), [0.032, 0.02, 0.003], [0.009, 0.007, 0.002], (1, 0, 0.45),
                     profile=lens_profile(), seg=seg, sub=sub, caps=(0.3, 0.4), cap_rings=max(3, sub // 2))


PANTHER_PLATES = [(-0.02, 0.018, 1.05, 2.2, 0.016, 0.0042), (-0.054, 0.014, 1.0, 2.0, 0.013, 0.003)]


def _panther_plate_paths(F):
    out = []
    for side in (-1, 1):
        for (y, rise, a0, a1, w, off) in PANTHER_PLATES:
            t = np.linspace(0, 1, 19)
            th = (a0 + (a1 - a0) * t) * side
            P = drape_ring(F, y + rise * t ** 1.4, th, 0.02, r_out=0.35)
            P, N = surface_path(F, P, 3)
            out.append((P + N * off, w, side, N))
    return out


def _panther_plate(path, w, N, seg=40, sub=4):
    n = len(path)
    wid = [w * (0.3 + 0.7 * smoothstep(0.0, 0.3, i / (n - 1))) * (1 - 0.85 * smoothstep(0.55, 1.0, i / (n - 1))) for i in range(n)]
    Nn = A(N)

    def side(t):
        k = min(int(round(t * (len(Nn) - 1))), len(Nn) - 1)
        return A(0, 1, 0) - Nn[k] * 0.3
    return path_loft(path, wid, [0.0034] * n, side, profile=chamfer_profile(top=0.8, side_top=0.5, side_bot=-0.5, bot=0.8, corner=3),
                     seg=seg, sub=sub, caps=(0.12, 0.12), cap_rings=3)


def panther_form(F, ctx):
    F.add(ellipsoid(*PANTHER_DOME))
    for n, p0 in PANTHER_CLIPS:
        clip(F, n, p0, k=0.006)
    F.add(mesh_prim(*_panther_muzzle()), k=0.01)
    for side in (-1, 1):
        F.add(mesh_prim(*_panther_ear(side)), k=0.005)
    if "cheekbones" not in ctx:
        cb = []
        for s_ in (-1, 1):
            ths = s_ * A(0.62, 0.9, 1.18, 1.45)
            P = drape_ring(F, A(0.004, -0.012, -0.03, -0.048), ths, 0.02, r_out=0.35)
            cb.append(smooth_path(A(P), 1))
        ctx["cheekbones"] = cb
    for P in ctx["cheekbones"]:
        F.add(mesh_prim(*_panther_cheekbone(P)), k=0.003)
    if "plates" not in ctx:
        ctx["plates"] = _panther_plate_paths(F)
    for path, w, side, N in ctx["plates"]:
        F.add(mesh_prim(*_panther_plate(path, w, N)), k=0.0015)
    visor(F, ctx, "visor", 0.03, 0.017, span=1.0, power=1.0)
    if "mouth" not in ctx:
        th = np.linspace(-1.0, 1.0, 29)
        ctx["mouth"] = surface_path(F, drape_ring(F, np.full(29, -0.05), th, -0.07, r_out=0.3), 2)
        ctx["vents"] = [[land(F, (s * 0.25, -0.022 - 0.0075 * j, -0.1), (-s, 0, 0)) for j in range(3)] for s in (-1, 1)]
        ctx["nose"] = land(F, (0, 0.2, -0.112), (0, -1, 0))
        ctx["crown"] = seam_path(F, [(0, 0.2, -0.05), (0, 0.2, 0.02), (0, 0.2, 0.08), (0, 0.1, 0.16), (0, 0.0, 0.17)], 40)
    P, N = ctx["visor"]
    F.cut(sweep((P + N * 0.002)[1:-1], 0.0095), k=0.0015)
    P, N = ctx["mouth"]
    F.cut(sweep(P, 0.0018), k=0.0008)
    for side in (-1, 1):
        vent_slots(F, ctx["vents"][(side + 1) // 2], half=(0.009, 0.0016, 0.0011))


def panther_lows(F, ctx):
    out = [blended_shell("dome", PANTHER_DOME, PANTHER_CLIPS, [], F.lo, F.lo + F.h * (F.n - 1), segs=40, rings=22, relax_n=2),
           np_mesh("muzzle", *_panther_muzzle(seg=22, sub=2))]
    for i, P in enumerate(ctx["cheekbones"]):
        out.append(np_mesh(f"cheekbone{i}", *_panther_cheekbone(P, seg=10, sub=3)))
    for side in (-1, 1):
        out.append(np_mesh(f"ear{side}", *_panther_ear(side, seg=10, sub=3)))
    for i, (path, w, side, N) in enumerate(ctx["plates"]):
        out.append(np_mesh(f"plate{i}", *_panther_plate(path[::2], w, N[::2], seg=10, sub=2)))
    return out


def panther_parts(F, ctx):
    out = visor_parts(ctx, "visor", 0.0088, slit_from=0.14, slit_to=0.66, slit_h=0.0027)
    P, N = ctx["mouth"]
    out.append(groove_trim("mouth", P, N, 0.0014, 0.0009, step=0.008))
    for side in (-1, 1):
        vent_slots(F, ctx["vents"][(side + 1) // 2], cut=False, out=out, name=f"vent{side}", half=(0.0085, 0.0016, 0.001))
        path = _panther_ear_path(side)
        V, Q, T = path_loft([A(p) + A(0, 0.003, -0.0085) for p in path[:2]] + [A(path[2]) + A(-side * 0.003, -0.012, -0.012)],
                            [0.02, 0.012, 0.003], 0.0022, (1, 0, 0.45), profile=lens_profile(), seg=8, sub=3, caps=(0.3, 0.4), cap_rings=2)
        out.append(mesh_part(f"earpanel{side}", V, Q, T, "trim"))
    for i, (path, w, side, N) in enumerate(ctx["plates"]):
        for j in (3, int(len(path) * 0.55)):
            p = path[j]
            n = F.grad([p])[0]
            out.append(gk.fin(gk.rivet(f"bolt{i}{j}", tuple(p + n * 0.0028), tuple(n), r=0.0034, h=0.0022, segs=8), "trim"))
    nP, nN = ctx["nose"]
    Rn = basis(x=(1, 0, 0), y=nN)
    out.append(mesh_part("nosecap", *plate_poly(nP + nN * 0.0014 + A(0, 0, -0.004), Rn,
                                                [(-0.014, -0.01), (0.014, -0.01), (0.0, 0.012)], 0.0028, 0.0012, n=24, corner=5), "trim"))
    return out


def panther_cranium(F, ctx):
    F.add(ellipsoid(*PANTHER_DOME))
    for n, p0 in PANTHER_CLIPS:
        clip(F, n, p0, k=0.006)
    return (0, 0.01, 0.022)


PANTHER = Head("panther", (-0.19, -0.15, -0.2), (0.19, 0.2, 0.2), panther_form, panther_parts, panther_cranium,
               h_low=0.0022, sharp=40.0, lows=panther_lows, registry=PIECES)
PIECES["panther"] = dict(slot="face", build=PANTHER.build, tex=1024, uv_angle=66,
                         fit=dict(s=(0.818, 0.723, 0.947), y=-0.0047, z=0.0245), view=dict(target=(0, 0.01, -0.02), dist=1.0))


# ===========================================================================
# EAGLE — a raptor helm: a sharp brow hood scowling over the visor, a long
# hooked beak plate grown from the helm on a seam, cheek plates, and the
# PLUME — big layered blade-feathers rising off the crown and swept back,
# a floppy part
# ===========================================================================

EAGLE_DOME = ((0, 0.01, 0.026), (0.098, 0.106, 0.118))
EAGLE_CLIPS = [((0, 0.45, -0.89), (0, 0.072, -0.078))]


def _eagle_beak(seg=96, sub=12):
    st = [
        dict(top=(0.034, -0.062), bot=(-0.046, -0.058), w=0.04),
        dict(top=(0.022, -0.11), bot=(-0.04, -0.106), w=0.032),
        dict(top=(0.004, -0.152), bot=(-0.036, -0.148), w=0.023),
        dict(top=(-0.018, -0.18), bot=(-0.044, -0.176), w=0.014),
        dict(top=(-0.044, -0.192), bot=(-0.062, -0.183), w=0.008),
    ]
    return loft_profile(st, chamfer_profile(top=0.22, side_top=0.45, side_bot=-0.6, bot=0.75), seg=seg, sub=sub,
                        caps=(0.1, 0.2), cap_rings=max(3, sub))


def _eagle_jaw(seg=96, sub=12):
    st = [
        dict(top=(-0.044, -0.058), bot=(-0.074, -0.052), w=0.034),
        dict(top=(-0.044, -0.11), bot=(-0.064, -0.106), w=0.024),
        dict(top=(-0.043, -0.145), bot=(-0.054, -0.143), w=0.014),
    ]
    return loft_profile(st, chamfer_profile(top=0.8, side_top=0.6, side_bot=-0.3, bot=0.5), seg=seg, sub=sub,
                        caps=(0.1, 0.3), cap_rings=max(3, sub))


def _eagle_hood(ctx, seg=40, sub=6):
    P = ctx["hood"]
    n = len(P)
    wid = [0.008 + 0.009 * math.sin(math.pi * i / (n - 1)) ** 0.4 for i in range(n)]
    thk = [0.005 + 0.007 * (1 - abs(2 * i / (n - 1) - 1)) for i in range(n)]
    return path_loft(P, wid, thk, (0, 1, 0.3), profile=profile_poly(BROW_PROF, corner=3), seg=seg, sub=sub,
                     caps=(0.3, 0.3), cap_rings=3)


EAGLE_PLUME = [  # (root height over the crown, root z, direction (y, z), length, half-width)
    (0.0, -0.012, (0.86, 0.5), 0.13, 0.025),
    (0.0, 0.026, (0.7, 0.71), 0.155, 0.028),
    (0.0, 0.064, (0.48, 0.88), 0.14, 0.025),
]


def _eagle_plume_defs(F, ctx):
    if "plume" not in ctx:
        defs = []
        for (_, z, (dy, dz), L, w) in EAGLE_PLUME:
            p, n = land(F, (0, 0.3, z), (0, -1, 0))
            d = unit((0, dy, dz))
            root = p - n * 0.004
            path = [root + d * L * t + A(0, -0.012, 0.01) * t * t for t in (0.0, 0.35, 0.7, 1.0)]
            defs.append((path, w, unit((0, -dz, dy))))
        ctx["plume"] = defs
    return ctx["plume"]


def _eagle_feather(path, w, side, seg=40, sub=6):
    return path_loft(path, [w * 0.55, w, w * 0.85, w * 0.35], [0.0036, 0.0036, 0.003, 0.002], side, profile=lens_profile(),
                     seg=seg, sub=sub, caps=(0.3, 1.1), cap_rings=4)


EAGLE_PLATES = [(-0.025, 0.02, 1.05, 2.2, 0.017, 0.0042)]


def eagle_form(F, ctx):
    F.add(ellipsoid(*EAGLE_DOME))
    for n, p0 in EAGLE_CLIPS:
        clip(F, n, p0, k=0.008, hi=(0.2, 0.3, 0.0))
    F.add(mesh_prim(*_eagle_beak()), k=0.01)
    F.add(mesh_prim(*_eagle_jaw()), k=0.0)
    visor(F, ctx, "visor", 0.03, 0.026, span=1.15, power=1.1)
    if "hood" not in ctx:
        # The scowl rides right over the visor, following its V.
        P, N = ctx["visor"]
        idx = np.linspace(3, len(P) - 4, 15).astype(int)
        H = P[idx] + A(0, 0.019, 0) + N[idx] * 0.004
        H, Nh = F.project(H)
        ctx["hood"] = smooth_path(H + Nh * 0.005, 1)
        ctx["plates"] = []
        for s in (-1, 1):
            for (y, rise, a0, a1, w, off) in EAGLE_PLATES:
                t = np.linspace(0, 1, 19)
                P = drape_ring(F, y + rise * t ** 1.4, (a0 + (a1 - a0) * t) * s, 0.02, r_out=0.35)
                P, N = surface_path(F, P, 3)
                ctx["plates"].append((P + N * off, w, s, N))
    F.add(mesh_prim(*_eagle_hood(ctx)), k=0.004)
    for path, w, side, N in ctx["plates"]:
        F.add(mesh_prim(*_panther_plate(path, w, N)), k=0.0015)
    for path, w, sd in _eagle_plume_defs(F, ctx):
        F.add(mesh_prim(*_eagle_feather(path, w, sd)), k=0.0)
    if "mouth" not in ctx:
        th = np.linspace(-1.0, 1.0, 29)
        ctx["mouth"] = surface_path(F, drape_ring(F, np.full(29, -0.045), th, -0.06, r_out=0.3), 2)
        root = []
        for t in np.linspace(0, 2 * math.pi, 41):
            root.append(A(math.cos(t) * 0.046, -0.006 + math.sin(t) * 0.05, -0.04))
        ctx["beakseam"] = surface_path(F, drape_ring(F, A(root)[:, 1], np.arctan2(A(root)[:, 0], 0.08) * 0 + 0, -0.1, r_out=0.3) if False else F.project(A(root) + A(0, 0, -0.03))[0], 2)
    P, N = ctx["visor"]
    F.cut(sweep((P + N * 0.002)[1:-1], 0.0125), k=0.0015)
    P, N = ctx["mouth"]
    F.cut(sweep(P, 0.0018), k=0.0008)
    seam(F, ctx["beakseam"])


def eagle_lows(F, ctx):
    out = [blended_shell("dome", EAGLE_DOME, EAGLE_CLIPS, [], F.lo, F.lo + F.h * (F.n - 1), segs=36, rings=20, relax_n=2),
           np_mesh("beak", *_eagle_beak(seg=22, sub=3)),
           np_mesh("jaw", *_eagle_jaw(seg=14, sub=2)),
           np_mesh("hood", *_eagle_hood(ctx, seg=10, sub=2))]
    for i, (path, w, side, N) in enumerate(ctx["plates"]):
        out.append(np_mesh(f"plate{i}", *_panther_plate(path[::2], w, N[::2], seg=10, sub=2)))
    for i, (path, w, sd) in enumerate(ctx["plume"]):
        out.append(gk.flop(np_mesh(f"feather{i}", *_eagle_feather(path, w, sd, seg=10, sub=3)), "plume"))
    return out


def eagle_parts(F, ctx):
    out = visor_parts(ctx, "visor", 0.011, slit_from=0.14, slit_to=0.7, slit_h=0.003)
    P, N = ctx["mouth"]
    out.append(groove_trim("mouth", P, N, 0.0015, 0.0009, step=0.008))
    for i, (path, w, side, N) in enumerate(ctx["plates"]):
        for j in (3, int(len(path) * 0.55)):
            p = path[j]
            n = F.grad([p])[0]
            out.append(gk.fin(gk.rivet(f"bolt{i}{j}", tuple(p + n * 0.0028), tuple(n), r=0.0034, h=0.0022, segs=8), "trim"))
    # A steel spine down each plume feather (part of the plume).
    for i, (path, w, sd) in enumerate(ctx["plume"]):
        P = A(path)
        t = unit(P[-1] - P[0])
        n = unit(np.cross(t, sd))
        for k, sgn in enumerate((-1, 1)):
            out.append(gk.flop(gk.fin(gk.tube(f"spine{i}{k}", [tuple(p + n * sgn * 0.0031) for p in P[:3]], 0.0012, sides=4, step=0.01), "trim"), "plume"))
    return out


def eagle_cranium(F, ctx):
    F.add(ellipsoid(*EAGLE_DOME))
    for n, p0 in EAGLE_CLIPS:
        clip(F, n, p0, k=0.008, hi=(0.2, 0.3, 0.0))
    return (0, 0.02, 0.026)


EAGLE = Head("eagle", (-0.19, -0.15, -0.22), (0.19, 0.29, 0.24), eagle_form, eagle_parts, eagle_cranium,
             h_low=0.0022, sharp=40.0, lows=eagle_lows, registry=PIECES)
PIECES["eagle"] = dict(slot="face", build=EAGLE.build, tex=1024, uv_angle=66,
                       fit=dict(s=(0.802, 0.815, 0.936), y=0.0047, z=0.026), view=dict(target=(0, 0.04, -0.01), dist=1.2),
                       flops={"plume": dict(pivot=(0.0, 0.1, 0.02), dir=(0.0, 0.62, 0.78), len=0.15, stiff=140, damp=5.5, swing=0.6)})


# ===========================================================================
# KNIGHT — a sleek cyber great helm: a faceted barrel tapering to a domed
# crown, a slight prow at the chin, the CROSS as a raised keel down the face
# crossing the visor slit with the lit eye line behind it, engineered
# breath slots, clean seams
# ===========================================================================

KNIGHT_PROF = [(1.0, 0.1), (0.84, 0.6), (0.34, 0.9), (0.0, 1.0), (-0.34, 0.9), (-0.84, 0.6), (-1.0, 0.1),
               (-0.93, -0.55), (-0.52, -0.92), (0.0, -1.0), (0.52, -0.92), (0.93, -0.55)]
KNIGHT_PATH = [(0, -0.118, -0.022), (0, -0.065, -0.008), (0, 0.0, 0.0), (0, 0.06, 0.006), (0, 0.104, 0.014)]
KNIGHT_W = [0.108, 0.116, 0.117, 0.108, 0.072]
KNIGHT_T = [0.138, 0.128, 0.124, 0.114, 0.08]


def _knight_barrel(seg=96, sub=10):
    return path_loft(KNIGHT_PATH, KNIGHT_W, KNIGHT_T, (1, 0, 0), profile=profile_poly(KNIGHT_PROF, corner=2),
                     seg=seg, sub=sub, caps=(0.06, 0.62), cap_rings=max(4, sub))


def _knight_keel(ctx, seg=24, sub=4):
    P, N = ctx["keel"]
    n = len(P)
    wid = [0.006 + 0.004 * max(0.0, 1 - abs(i / (n - 1) - 0.62) * 2.5) for i in range(n)]
    return path_loft(P + N * 0.003, wid, [0.0042] * n, (1, 0, 0), profile=chamfer_profile(top=0.7, side_top=0.4, side_bot=-0.6, bot=1.0, corner=3),
                     seg=seg, sub=sub, caps=(0.3, 0.3), cap_rings=3)


def _knight_breaths(F):
    out = []
    for s in (-1, 1):
        for col in range(2):
            for row in range(4):
                x = s * (0.024 + 0.021 * col)
                y = -0.03 - 0.016 * row
                p, n = land(F, (x, y, -0.4), (0, 0, 1))
                out.append((p, n, s))
    return out


def knight_form(F, ctx):
    F.add(mesh_prim(*_knight_barrel()))
    if "keel" not in ctx:
        # The keel: up the back, over the crown, down the face to the chin.
        pts = [land(F, (0, 0.4, z), (0, -1, 0))[0] for z in (0.03, 0.0, -0.03, -0.06)]
        pts += [land(F, (0, y, -0.4), (0, 0, 1))[0] for y in np.linspace(0.075, -0.078, 9)]
        ctx["keel"] = surface_path(F, A(pts), 2)
        th = np.linspace(-1.1, 1.1, 29)
        ctx["slit"] = surface_path(F, drape_ring(F, np.full(29, 0.022), th, 0.0, r_out=0.35), 2)
        ctx["breaths"] = _knight_breaths(F)
        th = np.linspace(-math.pi, math.pi, 73)
        ctx["crownseam"] = surface_path(F, drape_ring(F, np.full(73, 0.075), th, 0.01, r_out=0.35), 2)
        ctx["sideseams"] = [seam_path(F, [(s * 0.3, y, 0.02) for y in (0.075, 0.03, -0.02, -0.07, -0.108)], 24) for s in (-1, 1)]
    F.add(mesh_prim(*_knight_keel(ctx)), k=0.0015)
    P, N = ctx["slit"]
    F.cut(sweep(P[1:-1], 0.0075), k=0.0012)
    for p, n, s in ctx["breaths"]:
        R = basis(x=rot((0, 0, 1), s * 0.35) @ A(1, 0, 0), y=n)
        F.cut(rounded_box(p, (0.0072, 0.004, 0.0017), 0.0009, R), k=0.0005)
    seam(F, ctx["crownseam"])
    for pth in ctx["sideseams"]:
        seam(F, pth)


def knight_lows(F, ctx):
    return [np_mesh("barrel", *_knight_barrel(seg=40, sub=3)),
            np_mesh("keel", *_knight_keel(ctx, seg=10, sub=2))]


def knight_parts(F, ctx):
    out = []
    P, N = ctx["slit"]
    out.append(groove_trim("slitglass", P[1:-1], N[1:-1], 0.0062, 0.0034, sides=6, step=0.008))
    out.append(groove_trim("eyeline", P[3:-3] + N[3:-3] * 0.001, N[3:-3], 0.0026, 0.0, sides=5, step=0.008))
    out[-1]["finish"] = "glow"
    for j, (p, n, s) in enumerate(ctx["breaths"]):
        R = basis(x=rot((0, 0, 1), s * 0.35) @ A(1, 0, 0), y=n)
        out.append(slot_insert(f"breath{j}", p - n * 0.0026, R, (0.0062, 0.0016, 0.0011), "trim"))
    return out


def knight_cranium(F, ctx):
    F.add(mesh_prim(*_knight_barrel()))
    return (0, 0.02, 0.0)


KNIGHT = Head("knight", (-0.17, -0.15, -0.18), (0.17, 0.2, 0.18), knight_form, knight_parts, knight_cranium,
              h_low=0.0022, sharp=35.0, lows=knight_lows, registry=PIECES)
PIECES["knight"] = dict(slot="face", build=KNIGHT.build, tex=1024, uv_angle=66,
                        fit=dict(s=(0.951, 1.311, 0.982), y=-0.0265, z=0.005), view=dict(target=(0, 0.0, 0.0), dist=1.0))

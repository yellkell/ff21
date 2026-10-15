"""
IV — JUGGERNAUT: a city riot-police armoured enforcer, a walking hover-APC.
The widest, lowest, heaviest titan: a broad navy slab of a chest with white
police banding, a low armoured cupola sunk between the shoulders with ONE
long visor slit for an eye and a light bar on its roof, riot-gas launcher
pods flanking the head. Both forearms are ram-driven hydraulic gauntlets;
the right carries stun prongs on its knuckles.
No legs: a faceted APC hull on lift fans, a tread sponson either side — it
rolls in.

Hands hang ALONG the forearm, palm to the front, digits curling toward +Y;
the thumb sits on the OUTER edge of the hand (palm-forward, like a person).
"""

import math

from mathutils import Matrix, Vector

ACCENT = 0xB26BFF


# ── local helpers ────────────────────────────────────────────────────────
def _tz(S, z):
    """t at which the shell's section height is z (sections monotonic in z)."""
    z0, z1 = S.params(0.0)[0], S.params(1.0)[0]
    up = z1 > z0
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        if (S.params(m)[0] < z) == up:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


def _ux(S, x, t):
    """u in the front-right quadrant where the surface is x off the centre."""
    ox = S.params(t)[4]
    lo, hi = 0.0, 0.25
    for _ in range(40):
        m = (lo + hi) / 2
        if S.local(m, t).x - ox < x:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


def _side(S, x0, x1, t, s):
    a, b = _ux(S, x0, t), _ux(S, x1, t)
    return (a, b) if s > 0 else (-b, -a)


def _bake(o):
    """Bake loc/rot into the mesh (matrix_basis is fresh; matrix_world may be stale)."""
    o.data.transform(o.matrix_basis)
    o.matrix_basis = Matrix.Identity(4)
    return o


def _stick(o, M):
    _bake(o)
    o.data.transform(M)
    return o


def _wrap(o, cx, cy, R):
    """Bend a flat +Y-facing object onto a vertical cylinder (axis cx, cy)."""
    _bake(o)
    for v in o.data.vertices:
        a = (v.co.x - cx) / R
        d = v.co.y - (cy + R)
        v.co = Vector((cx + (R + d) * math.sin(a), cy + (R + d) * math.cos(a), v.co.z))
    return o


def _offset(poly, d):
    """Grow a convex 2D outline by d (miter)."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sgn = 1 if area > 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        e0, e1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0 = Vector((e0.y, -e0.x)) * sgn
        n1 = Vector((e1.y, -e1.x)) * sgn
        m = (n0 + n1).normalized()
        k = d / max(0.3, m.dot(n0))
        out.append(tuple(p1 + m * k))
    return out


def _zclip(poly, z0, z1):
    """Clip a 2D outline (a, z) to the band z0..z1."""
    def clip(pts, keep, cut):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ka, kb = keep(a), keep(b)
            if kb:
                if not ka:
                    out.append(cut(a, b))
                out.append(b)
            elif ka:
                out.append(cut(a, b))
        return out

    def cutz(z):
        def f(a, b):
            t = (z - a[1]) / (b[1] - a[1])
            return (a[0] + (b[0] - a[0]) * t, z)
        return f
    p = clip(poly, lambda q: q[1] >= z0, cutz(z0))
    return clip(p, lambda q: q[1] <= z1, cutz(z1))


def build(K):
    P = math.pi
    hx = K.hex_rgb
    V = Vector
    put = K.put

    K.mat("navy", hx(0x141C2E), metal=0.15, rough=0.34, coat=0.45, coat_rough=0.1)
    K.mat("white", hx(0xD8DCE1), metal=0.0, rough=0.4, coat=0.3, coat_rough=0.12)
    K.mat("graphite", hx(0x17191D), metal=0.45, rough=0.4)
    K.mat("steel", hx(0x7E838B), metal=1.0, rough=0.3)
    K.mat("chrome", hx(0xD4D8DE), metal=1.0, rough=0.07)
    K.mat("rubber", hx(0x0B0B0C), metal=0.0, rough=0.8)
    K.mat("poly", hx(0x22303F), metal=0.0, rough=0.04, coat=1.0, alpha=0.55)
    K.mat("glass", hx(0x030406), metal=0.0, rough=0.03, coat=1.0)
    K.mat("reflect", hx(0xD2EE3A), metal=0.2, rough=0.28, coat=0.4)
    K.mat("ink_dark", hx(0x1E2126), metal=0.0, rough=0.6)
    K.mat("lens_red", hx(0x3A0508), metal=0.0, rough=0.08, coat=1.0, emit=(1.0, 0.04, 0.03), strength=0.5)
    K.mat("lens_blue", hx(0x05103A), metal=0.0, rough=0.08, coat=1.0, emit=(0.05, 0.2, 1.0), strength=0.5)

    R = K.Rig(shoulder_z=1.12, head_z=1.34, yoke_w=0.86)

    def chev(name, m, M, w, h, d):
        poly = [(-w, 0), (0, h), (w, 0), (w, -d), (0, h - d), (-w, -d)]
        return _stick(K.prism(name, m, poly, 0.004, axis="Y"), M)

    # ── CHEST: one broad slab, two pec plates, a white police band ───────
    chest = K.Shell([
        (0.63, 0.36, 0.18, 8.0, 0, 0.0),
        (0.665, 0.47, 0.24, 10.0, 0, 0.015),
        (0.8, 0.495, 0.26, 12.0, 0, 0.022),
        (0.98, 0.5, 0.265, 12.0, 0, 0.025),
        (1.17, 0.495, 0.255, 12.0, 0, 0.02),
        (1.27, 0.45, 0.215, 10.0, 0, 0.0),
        (1.33, 0.33, 0.15, 7.0, 0, -0.02),
    ])
    put("CHEST", chest.mesh("chest_frame", "graphite", 48, 18))
    tA, tB = _tz(chest, 0.93), _tz(chest, 1.285)
    tm = (tA + tB) / 2
    for s in (-1, 1):
        u0, u1 = _side(chest, 0.095, 0.485, tm, s)
        put("CHEST", chest.plate(f"pec{s}", "navy", u0, u1, tA, tB, off=0.004, th=0.028, nu=18, nt=10, cw=0.016))
        put("CHEST", chest.strip(f"pecseam{s}", "glow_dim", u0, u1, _tz(chest, 0.912), _tz(chest, 0.92), off=0.004))
        pts = []
        for uu in (u0 + 0.004 * s, u1 - 0.01 * s):
            for tt in (tA + 0.02, tB - 0.03):
                pts.append(chest.at(uu, tt, 0.032)[0])
        put("CHEST", K.bolts(f"pecbolt{s}", "steel", pts, r=0.009, h=0.006, normal=(0, 1, 0)))
    uk_ = _ux(chest, 0.088, tm)
    put("CHEST", chest.plate("keel", "steel", -uk_, uk_, _tz(chest, 0.9), _tz(chest, 1.3), off=0.004, th=0.018, nu=6, nt=10, bevel=0.4))
    tb0, tb1 = _tz(chest, 0.72), _tz(chest, 0.895)
    ub = _ux(chest, 0.45, (tb0 + tb1) / 2)
    put("CHEST", chest.plate("bellyband", "white", -ub, ub, tb0, tb1, off=0.004, th=0.024, nu=30, nt=5, cw=0.014))
    # badge on the left pec: a generic city-police star-in-shield
    tb = _tz(chest, 1.16)
    bp = chest.at(-_ux(chest, 0.25, tb), tb, 0.033)[0]
    badge = [(0, 0.06), (0.03, 0.05), (0.05, 0.055), (0.05, 0.0), (0.035, -0.035), (0, -0.06), (-0.035, -0.035), (-0.05, 0.0), (-0.05, 0.055), (-0.03, 0.05)]
    put("CHEST", K.prism("badge", "white", badge, 0.004, c=bp, axis="Y"))
    star = [((0.032 if k % 2 == 0 else 0.014) * math.sin(k * P / 5), (0.032 if k % 2 == 0 else 0.014) * math.cos(k * P / 5)) for k in range(10)]
    put("CHEST", K.prism("badge_star", "ink_dark", star, 0.004, c=bp + V((0, 0.003, 0.004)), axis="Y"))
    put("CHEST", K.text("badge_txt", "ink_dark", "NDPD", 0.013, c=bp + V((0, 0.004, -0.03)), rot=(P / 2, 0, P), font="arialbd.ttf", extrude=0.0))
    tsr = _tz(chest, 1.16)
    put("CHEST", K.text("serial", "white", "UNIT 04", 0.034, c=chest.at(_ux(chest, 0.27, tsr), tsr, 0.034)[0], rot=(P / 2, 0, P), font="arialbd.ttf", extrude=0.0))
    # core
    cp = chest.at(0.0, _tz(chest, R.core.z), 0.0)[0]
    put("CHEST", K.cyl("core_bezel", "graphite", cp + V((0, 0.02, 0)), 0.092, 0.034, 32, rot=(P / 2, 0, 0), bev=0.008))
    put("CHEST", K.torus("core_ring", "chrome", cp + V((0, 0.038, 0)), 0.08, 0.007, 32, 6, rot=(P / 2, 0, 0)))
    put("CORE", K.cyl("core_lens", "core", cp + V((0, 0.036, 0)), 0.068, 0.02, 32, rot=(P / 2, 0, 0)))
    # back slab, chevrons, kanji, vent
    tk0, tk1 = _tz(chest, 0.76), _tz(chest, 1.27)
    uk = _ux(chest, 0.4, (tk0 + tk1) / 2)
    put("CHEST", chest.plate("backslab", "navy", 0.5 - uk, 0.5 + uk, tk0, tk1, off=0.004, th=0.028, nu=18, nt=10, cw=0.016))
    for k in range(3):
        M = chest.frame_at(0.5, _tz(chest, 1.03 + k * 0.07), 0.033, up=(0, 0, 1))
        put("CHEST", chev(f"chev{k}", "reflect", M, 0.2, 0.07, 0.03))
    put("CHEST", K.text("back_kanji", "white", "警察", 0.08, c=chest.at(0.5, _tz(chest, 0.9), 0.034)[0], rot=(P / 2, 0, 0), font="YuGothB.ttc", extrude=0.0))
    put("CHEST", K.vents("bvent", "graphite", (0, -0.25, 0.7), 0.3, 0.05, 4, rot=(0, 0, P)))

    # yoke blocks, shoulder lamp housings
    for i, s in ((0, -1), (1, 1)):
        put("CHEST", K.box(f"yoke{s}", "graphite", (s * 0.5, -0.01, 1.18), (0.14, 0.26, 0.2), bev=0.02))
        put("CHEST", K.box(f"lamphouse{s}", "navy", (s * 0.46, 0.13, 1.245), (0.13, 0.16, 0.11), bev=0.016))
        lamp_c = V((s * 0.4636, 0.218, 1.25))
        put("TITAN", K.box(f"sh_bezel{s}", "steel", lamp_c - V((0, 0.008, 0)), (0.104, 0.014, 0.066), bev=0.006))
        put(f"SHOULDER_{i}", K.box(f"sh_lamp{s}", f"shoulder_{i}", lamp_c + V((0, 0.002, 0)), (0.088, 0.008, 0.048), bev=0.003))

    # ── LAUNCHER PODS: 2x2 riot-gas launchers flanking the head ──────────
    for i, s in ((0, -1), (1, 1)):
        pc = V((s * 0.37, -0.01, 1.45))
        Mr = Matrix.Rotation(0.14, 3, "X")
        for x in (-1, 1):
            put("CHEST", K.box(f"pod_cheek{s}{x}", "steel", (s * 0.37 + x * 0.088, -0.03, 1.38), (0.016, 0.12, 0.14), bev=0.005))
        put("CHEST", K.cyl(f"pod_trun{s}", "graphite", (s * 0.37, -0.03, 1.41), 0.026, 0.19, 16, rot=(0, P / 2, 0), bev=0.004))
        put("CHEST", K.box(f"pod_case{s}", "navy", pc, (0.155, 0.24, 0.13), bev=0.018, rot=(0.14, 0, 0)))
        put("CHEST", K.box(f"pod_band{s}", "white", pc + Mr @ V((0, -0.065, 0)), (0.159, 0.04, 0.134), bev=0.008, rot=(0.14, 0, 0)))
        put("CHEST", K.box(f"pod_face{s}", "graphite", pc + Mr @ V((0, 0.118, 0)), (0.14, 0.012, 0.114), bev=0.004, rot=(0.14, 0, 0)))
        for dx in (-0.034, 0.034):
            for dz in (-0.028, 0.028):
                tp = pc + Mr @ V((dx, 0.13, dz))
                put("CHEST", K.cyl(f"pod_tube{s}{dx}{dz}", "steel", tp, 0.025, 0.03, 16, rot=(-P / 2 + 0.14, 0, 0), bev=0.004))
                mp = pc + Mr @ V((dx, 0.143, dz))
                put("CHEST", K.cyl(f"pod_mouth{s}{dx}{dz}", f"pod_{i}", mp, 0.018, 0.005, 16, rot=(-P / 2 + 0.14, 0, 0)))
        put("CHEST", K.text(f"pod_txt{s}", "ink_dark", "CS GAS", 0.018, c=pc + Mr @ V((s * 0.0805, -0.065, 0.0)), rot=(P / 2, 0, s * P / 2), font="arialbd.ttf", extrude=0.0))

    # ── HEAD: a low armoured cupola, one long visor slit, a light bar ────
    head = K.Shell([
        (1.22, 0.16, 0.15, 5.0, 0, 0.0),
        (1.26, 0.215, 0.195, 7.0, 0, 0.01),
        (1.36, 0.225, 0.205, 7.0, 0, 0.015),
        (1.43, 0.215, 0.19, 7.0, 0, 0.0),
        (1.465, 0.19, 0.165, 6.0, 0, -0.01),
        (1.482, 0.13, 0.11, 5.0, 0, -0.01),
    ])
    put("HEAD", head.mesh("cupola", "graphite", 48, 16))
    tw0, tw1 = _tz(head, 1.335), _tz(head, 1.395)
    uw = _ux(head, 0.21, (tw0 + tw1) / 2)
    put("HEAD", head.plate("dome", "navy", -0.5, 0.5, _tz(head, 1.40), 1.0, off=0.003, th=0.03, nu=40, nt=5, cw=0.016))
    put("HEAD", head.plate("whiteband", "white", uw, 1 - uw, tw0, tw1, off=0.003, th=0.02, nu=40, nt=3, cw=0.01))
    put("HEAD", head.plate("slot", "glass", -uw, uw, tw0, tw1, off=0.003, th=0.008, nu=16, nt=3, bevel=0.3))
    tv0, tv1 = _tz(head, 1.347), _tz(head, 1.381)
    uv = _ux(head, 0.185, (tv0 + tv1) / 2)
    put("EYE_0", head.plate("visor_bar", "visor", -uv, uv, tv0, tv1, off=0.01, th=0.007, nu=16, nt=2, bevel=0.0))
    put("HEAD", head.plate("jaw", "navy", -uw, uw, _tz(head, 1.245), tw0, off=0.003, th=0.03, nu=16, nt=4, cw=0.016))
    ep = head.at(0.0, (tv0 + tv1) / 2, 0.0)[0]
    R.extra.append(("EYEFX", V((0, ep.y + 0.07, ep.z)), "HEAD"))
    # light bar on the roof
    lz = 1.5
    put("HEAD", K.box("lb_base", "graphite", (0, -0.01, lz - 0.012), (0.33, 0.085, 0.02), bev=0.006))
    segs = [("lens_blue", -0.12, 0.07), ("lamp_white", -0.06, 0.05), ("glow_dim", 0.0, 0.07), ("lamp_white", 0.06, 0.05), ("lens_red", 0.12, 0.07)]
    for k, (m, x, w) in enumerate(segs):
        put("HEAD", K.box(f"lb{k}", m, (x, -0.01, lz + 0.013), (w - 0.004, 0.066, 0.032), bev=0.006))
    for s in (-1, 1):
        put("HEAD", K.box(f"lb_cap{s}", "steel", (s * 0.164, -0.01, lz + 0.007), (0.014, 0.074, 0.044), bev=0.004))
    # whip antenna, back right
    ab = V((0.13, -0.12, 1.455))
    put("HEAD", K.cyl("ant_base", "graphite", ab, 0.016, 0.04, 12, bev=0.003))
    put("HEAD", K.cyl("ant_spring", "steel", ab + V((0, 0, 0.035)), 0.008, 0.03, 10))
    put("HEAD", K.cyl("ant_whip", "rubber", ab + V((0, 0, 0.17)), 0.0035, 0.24, 8, r2=0.0022))
    put("HEAD", K.sphere("ant_tip", "graphite", ab + V((0, 0, 0.29)), 0.007, 10, 6))
    # collar ring the cupola sits in (chest)
    put("CHEST", K.lathe("collar", "graphite", [(0.0, 1.27), (0.23, 1.27), (0.25, 1.29), (0.245, 1.315), (0.0, 1.315)], 40))

    # ── WAIST: a turret ring between hull and chest ──────────────────────
    put("TITAN", K.lathe("waist", "graphite", [(0.0, 0.53), (0.22, 0.53), (0.19, 0.57), (0.18, 0.62), (0.2, 0.65), (0.0, 0.65)], 36))
    put("TITAN", K.torus("waist_ring", "steel", (0, 0, 0.585), 0.19, 0.012, 36, 8))
    put("TITAN", K.torus("waist_lt", "glow_dim", (0, 0, 0.61), 0.182, 0.004, 36, 6))

    # ── HULL: a faceted APC hull, three armour bands, on lift fans ───────
    HULL = [(0.27, 0.07), (0.37, 0.15), (0.37, 0.31), (0.21, 0.525), (-0.2, 0.535), (-0.34, 0.42), (-0.34, 0.15), (-0.26, 0.07)]
    put("TITAN", K.prism("hull", "graphite", HULL, 0.7, axis="X", bev=0.02))
    HO = _offset(HULL, 0.014)
    for name, m, z0, z1, w in (("hull_lo", "navy", 0.0, 0.215, 0.722), ("hull_band", "white", 0.225, 0.305, 0.726), ("hull_hi", "navy", 0.315, 0.6, 0.722)):
        put("TITAN", K.prism(name, m, _zclip(HO, z0, z1), w, axis="X", bev=0.009))
    gd = V((0, 0.215, 0.16)).normalized()  # glacis normal (y, z)
    gn = V((0, gd.y, gd.z))
    ga = math.atan2(gd.z, gd.y)

    def glacis(z, off):
        y = 0.37 - 0.16 * (z - 0.31) / 0.215
        return V((0, y, z)) + gn * (0.014 + off)
    put("TITAN", K.text("band_txt", "ink_dark", "警察  UNIT 04", 0.042, c=(0, 0.37 + 0.0145 + 0.0015, 0.265), rot=(P / 2, 0, P), font="YuGothB.ttc", extrude=0.0))
    # LOW lamp: a wide slit lamp in the glacis
    lp = glacis(0.45, 0.004)
    put("TITAN", K.box("low_bezel", "steel", lp, (0.17, 0.018, 0.075), bev=0.008, rot=(ga, 0, 0)))
    put("LOW", K.box("low_lamp", "low", lp + gn * 0.01, (0.14, 0.008, 0.052), bev=0.004, rot=(ga, 0, 0)))
    for s in (-1, 1):
        # headlights in the lower nose
        hp_ = V((s * 0.22, 0.37 + 0.014 + 0.004, 0.17))
        put("TITAN", K.box(f"hl_bezel{s}", "steel", hp_, (0.1, 0.012, 0.045), bev=0.005))
        put("TITAN", K.box(f"hl{s}", "lamp_white", hp_ + V((0, 0.006, 0)), (0.084, 0.006, 0.03), bev=0.003))
        # tail lenses
        put("TITAN", K.box(f"tail{s}", "lens_red", (s * 0.24, -0.34 - 0.0145 - 0.004, 0.265), (0.08, 0.01, 0.034), bev=0.004))
    for k in range(3):
        M = Matrix.Translation((0, -0.34 - 0.0145 - 0.003, 0.335 + k * 0.05)) @ Matrix.Rotation(P, 4, "Z")
        put("TITAN", chev(f"hchev{k}", "reflect", M, 0.18, 0.05, 0.022))
    # riot push-bar on the nose
    put("TITAN", K.box("pushbar", "steel", (0, 0.43, 0.11), (0.6, 0.04, 0.06), bev=0.01))
    put("TITAN", K.box("pushpad", "rubber", (0, 0.452, 0.11), (0.56, 0.008, 0.04), bev=0.003))
    for s in (-1, 1):
        put("TITAN", K.box(f"pushstrut{s}", "graphite", (s * 0.2, 0.4, 0.11), (0.04, 0.06, 0.05), bev=0.006))
    # lift fans under the hull
    for s in (-1, 1):
        fc = V((s * 0.16, 0.0, 0.055))
        put("TITAN", K.lathe(f"duct{s}", "steel", [(0.1, -0.025), (0.118, -0.025), (0.122, 0.0), (0.112, 0.025), (0.1, 0.025)], 28, c=fc))
        put("TITAN", K.cyl(f"fanhub{s}", "graphite", fc, 0.03, 0.04, 14))
        blades = [K.box(f"blade{s}{b}", "graphite", fc + V((0.065 * math.cos(b * 2 * P / 7), 0.065 * math.sin(b * 2 * P / 7), 0)), (0.07, 0.022, 0.004), rot=(0.5, 0, b * 2 * P / 7)) for b in range(7)]
        put("TITAN", K.join(f"blades{s}", blades))
        put("TITAN", K.cyl(f"liftglow{s}", "glow_dim", fc + V((0, 0, -0.018)), 0.1, 0.004, 28))

    # ── SPONSONS: tread modules either side, one big skirt panel each ────
    for s in (-1, 1):
        sc = V((s * 0.47, 0.0, 0.19))
        put("TITAN", K.box(f"spmount{s}", "graphite", (s * 0.385, 0.0, 0.21), (0.06, 0.34, 0.12), bev=0.012))
        rr, L = 0.115, 0.27
        stad = [(L + rr * math.cos(-P / 2 + k * P / 9), rr * math.sin(-P / 2 + k * P / 9)) for k in range(10)]
        stad += [(-L + rr * math.cos(P / 2 + k * P / 9), rr * math.sin(P / 2 + k * P / 9)) for k in range(10)]
        put("TITAN", K.prism(f"track{s}", "rubber", stad, 0.13, c=sc, axis="X", bev=0.006))
        per = []
        n_s = 7
        for k in range(n_s):
            per.append((V((0, -L + 2 * L * (k + 0.5) / n_s, -rr)), 0.0))
            per.append((V((0, -L + 2 * L * (k + 0.5) / n_s, rr)), P))
        for k in range(5):
            a = -P / 2 + (k + 0.5) * P / 5
            per.append((V((0, L + rr * math.cos(a), rr * math.sin(a))), a + P / 2))
            per.append((V((0, -L - rr * math.cos(a), rr * math.sin(a))), -a - P / 2))
        gr = [K.box(f"gr{s}{k}", "steel", sc + p * 1.035, (0.132, 0.016, 0.01), rot=(a, 0, 0)) for k, (p, a) in enumerate(per)]
        put("TITAN", K.join(f"grousers{s}", gr))
        for k, y in enumerate((-0.27, -0.09, 0.09, 0.27)):
            r_ = 0.07 if abs(y) > 0.2 else 0.055
            put("TITAN", K.cyl(f"wheel{s}{k}", "steel", sc + V((s * 0.068, y, 0.0)), r_, 0.012, 18, rot=(0, P / 2, 0)))
            put("TITAN", K.cyl(f"wheelhub{s}{k}", "graphite", sc + V((s * 0.077, y, 0.0)), 0.022, 0.012, 12, rot=(0, P / 2, 0)))
        sk = [(-0.42, 0.04), (-0.33, 0.15), (0.35, 0.15), (0.43, 0.04), (0.43, -0.02), (-0.42, -0.02)]
        put("TITAN", K.prism(f"skirt{s}", "navy", sk, 0.03, c=sc + V((s * 0.085, 0, 0.0)), axis="X", bev=0.008))
        put("TITAN", K.box(f"skirtdeck{s}", "navy", sc + V((s * 0.02, 0.0, 0.135)), (0.15, 0.66, 0.03), bev=0.01))
        stripe = [(-0.395, 0.035), (-0.37, 0.07), (0.38, 0.07), (0.405, 0.035)]
        put("TITAN", K.prism(f"skstripe{s}", "white", stripe, 0.004, c=sc + V((s * 0.102, 0, 0.0)), axis="X"))
        tx = "UNIT 04" if s > 0 else "警察 IV"
        put("TITAN", K.text(f"sktxt{s}", "ink_dark", tx, 0.028, c=sc + V((s * 0.1045, 0.0, 0.052)), rot=(P / 2, 0, s * P / 2), font="YuGothB.ttc" if s < 0 else "arialbd.ttf", extrude=0.0))
        put("TITAN", K.box(f"spglow{s}", "glow_dim", sc + V((-s * 0.04, 0, -0.125)), (0.03, 0.5, 0.006)))

    # ── ARMS ──────────────────────────────────────────────────────────────
    for i, s in ((0, -1), (1, 1)):
        pv, el, wr, hp = R.pivot[i], R.elbow(i), R.wrist(i), R.handp(i)
        A, E_, W, H = f"ARM_{i}", f"ELBOW_{i}", f"WRIST_{i}", f"HAND_{i}"
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put(A, K.cyl(f"shhub{s}", "graphite", pv, 0.095, 0.15, 32, rot=(0, P / 2, 0), bev=0.012))
        put(A, K.torus(f"shring{s}", "glow_dim", pv + V((s * 0.077, 0, 0)), 0.07, 0.005, 32, 6, rot=(0, P / 2, 0)))
        cap = K.Shell([
            (pv.z + 0.165, 0.13, 0.135, 10.0, pv.x + s * 0.045, 0.0),
            (pv.z + 0.15, 0.172, 0.174, 12.0, pv.x + s * 0.045, 0.0),
            (pv.z + 0.04, 0.18, 0.18, 12.0, pv.x + s * 0.045, 0.0),
            (pv.z - 0.1, 0.176, 0.176, 12.0, pv.x + s * 0.05, 0.0),
            (pv.z - 0.22, 0.168, 0.168, 12.0, pv.x + s * 0.055, 0.0),
        ])
        # one full cap, its seam on the inner (chest) side
        ua0, ua1 = (-0.25, 0.75) if s > 0 else (-0.75, 0.25)
        put(A, cap.plate(f"paul{s}", "navy", ua0, ua1, 0.0, 0.8, off=0.006, th=0.028, nu=44, nt=10, cw=0.016))
        put(A, cap.mesh(f"paullid{s}", "navy", 36, 6, caps=(True, False), off=0.02))
        put(A, cap.plate(f"paulband{s}", "white", ua0, ua1, 0.82, 0.95, off=0.006, th=0.024, nu=44, nt=2, bevel=0.4))
        put(A, K.text(f"paul_iv{s}", "white", "IV", 0.11, c=cap.at(0.25 * s, 0.42, 0.036)[0], rot=(P / 2, 0, s * P / 2), font="arialbd.ttf"))
        ua = K.Shell([
            (pv.z - 0.06, 0.08, 0.085, 5.0, pv.x, 0),
            (pv.z - 0.16, 0.088, 0.094, 6.0, pv.x, 0.004),
            (pv.z - 0.34, 0.084, 0.09, 6.0, pv.x, 0.004),
            (el.z + 0.07, 0.068, 0.072, 5.0, pv.x, 0),
        ])
        put(A, ua.mesh(f"upper{s}", "graphite", 28, 8))
        put(A, ua.plate(f"sleeve{s}", "navy", -0.27, 0.27, 0.22, 0.88, off=0.004, th=0.02, nu=16, nt=6, cw=0.012))
        put(A, K.cyl(f"uact{s}", "graphite", pv + V((0, -0.1, -0.22)), 0.022, 0.18, 14, bev=0.003))
        put(A, K.cyl(f"uactr{s}", "chrome", pv + V((0, -0.1, -0.38)), 0.011, 0.15, 10))
        put(E_, K.cyl(f"elhub{s}", "steel", el, 0.07, 0.17, 28, rot=(0, P / 2, 0), bev=0.008))
        for x in (-1, 1):
            put(E_, K.torus(f"elring{s}{x}", "glow_dim", el + V((x * 0.086, 0, 0)), 0.052, 0.004, 28, 6, rot=(0, P / 2, 0)))
        put(E_, K.box(f"elcop{s}", "navy", el + V((0, -0.075, -0.01)), (0.13, 0.03, 0.12), bev=0.012))
        big = 1.12 if s > 0 else 1.0
        fa = K.Shell([
            (el.z - 0.04, 0.075 * big, 0.08 * big, 5.0, el.x, 0),
            (el.z - 0.12, 0.095 * big, 0.1 * big, 6.0, el.x, 0.008),
            (el.z - 0.31, 0.095 * big, 0.1 * big, 6.0, el.x, 0.008),
            (wr.z + 0.04, 0.075 * big, 0.08 * big, 5.0, el.x, 0),
        ])
        put(E_, fa.mesh(f"fore{s}", "graphite", 28, 10))
        put(E_, fa.plate(f"vamb{s}", "navy", -0.28, 0.28, 0.08, 0.9, off=0.004, th=0.022, nu=16, nt=10, cw=0.014))
        put(E_, fa.plate(f"vambband{s}", "white", -0.285, 0.285, 0.55, 0.68, off=0.026, th=0.006, nu=16, nt=2, bevel=0.3))
        put(E_, fa.strip(f"vamblt{s}", "glow_dim", *u(0.3, 0.315), 0.15, 0.82, off=0.006))
        put(W, K.cyl(f"wrhub{s}", "steel", wr, 0.055, 0.12, 24, rot=(0, P / 2, 0), bev=0.006))
        rc = 0.075 * big
        put(W, K.lathe(f"wrcuff{s}", "graphite", [(0.0, -0.05), (rc - 0.012, -0.05), (rc, -0.04), (rc, -0.018), (rc - 0.012, -0.008), (0.0, -0.008)], 24, c=wr, smooth=30))

        # Hydraulic rams on both flanks of each gauntlet forearm.
        for x in (-1, 1):
            put(E_, K.cyl(f"ram{s}{x}", "graphite", (el.x + x * 0.13, -0.01, el.z - 0.15), 0.026, 0.18, 16, bev=0.004))
            put(E_, K.cyl(f"ramrod{s}{x}", "chrome", (el.x + x * 0.13, -0.01, wr.z + 0.1), 0.013, 0.16, 12))
            put(E_, K.box(f"ramlug{s}{x}", "steel", (el.x + x * 0.115, -0.01, el.z - 0.06), (0.04, 0.04, 0.03), bev=0.006))
            put(E_, K.box(f"ramlug2{s}{x}", "steel", (el.x + x * 0.115, -0.01, wr.z + 0.035), (0.04, 0.04, 0.03), bev=0.006))
        if s > 0:
            put(E_, K.text("gauntlet_txt", "white", "警察", 0.045, c=fa.at(0.0, 0.32, 0.028)[0], rot=(P / 2, 0, P), font="YuGothB.ttc", extrude=0.0))
        else:
            put(E_, K.text("gauntlet_txt_l", "white", "UNIT 04", 0.03, c=fa.at(0.0, 0.32, 0.028)[0], rot=(P / 2, 0, P), font="arialbd.ttf", extrude=0.0))

        # HAND: a heavy gauntlet in line with the forearm, palm to the front.
        pw = 0.17 if s > 0 else 0.15
        put(H, K.box(f"palm{s}", "graphite", hp + V((0, 0.0, -0.01)), (pw, 0.09, 0.13), bev=0.014))
        put(H, K.box(f"palmback{s}", "navy", hp + V((0, -0.034, -0.005)), (pw + 0.006, 0.03, 0.12), bev=0.012))
        put(H, K.box(f"palmpad{s}", "rubber", hp + V((0, 0.046, -0.015)), (pw - 0.024, 0.006, 0.09), bev=0.002))
        fw = 0.036 if s > 0 else 0.032
        fx = [(k - 1.5) * (fw + 0.004) for k in range(4)]
        kz = hp.z - 0.08
        put(H, K.cyl(f"knbar{s}", "steel", (hp.x, 0.0, kz), 0.021, pw - 0.004, 20, rot=(0, P / 2, 0)))
        if s > 0:
            # knuckle duster behind the knuckle line: stun prongs point down
            # the arm, bared when the fist closes
            put(H, K.box("duster", "steel", hp + V((0, -0.044, -0.088)), (pw, 0.028, 0.036), bev=0.006))
            for k, x in enumerate(fx):
                for dx in (-0.008, 0.008):
                    put(H, K.cyl(f"prong{k}{dx}", "chrome", hp + V((x + dx, -0.048, -0.128)), 0.0065, 0.05, 10))
                    put(H, K.cyl(f"prongtip{k}{dx}", "glow", hp + V((x + dx, -0.048, -0.155)), 0.0085, 0.01, 10))
            for k, x in enumerate(fx):
                put(H, K.cyl(f"fact{k}", "chrome", hp + V((x, -0.054, -0.02)), 0.006, 0.07, 8))
        for k, x in enumerate(fx):
            kn = V((hp.x + x, 0.0, kz))
            d0 = R.digit(i, 2 * k, kn, 0.05, 1.35)
            put(d0, K.box(f"f{s}{k}a", "navy", kn + V((0, -0.002, -0.042)), (fw, 0.044, 0.07), bev=0.008))
            j = kn + V((0, 0.0, -0.08))
            d1 = R.digit(i, 2 * k + 1, j, 0.1, 1.45)
            put(d1, K.cyl(f"f{s}{k}j", "steel", j, 0.015, fw + 0.002, 12, rot=(0, P / 2, 0)))
            put(d1, K.box(f"f{s}{k}b", "graphite", j + V((0, -0.002, -0.032)), (fw - 0.003, 0.04, 0.058), bev=0.007))
        # thumb on the OUTER edge, set into the palm face, closing across it
        th = hp + V((s * (pw / 2 + 0.006), 0.02, -0.03))
        dt = R.digit(i, 8, th, 0.15, 1.1)
        put(dt, K.cyl(f"thumbk{s}", "steel", th, 0.017, 0.036, 12, rot=(0, P / 2, 0)))
        put(dt, K.box(f"thumb{s}", "navy", th + V((s * 0.008, 0.004, -0.042)), (0.034, 0.04, 0.074), bev=0.008, rot=(0, -s * 0.3, 0)))
    return R

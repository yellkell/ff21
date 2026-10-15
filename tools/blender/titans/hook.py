"""
I — THE HOOK: a port-district tow drone gone feral. Lean and forward-
hunched, big clean ceramic panels over a graphite frame, cyan light in the
seams. No legs: the spine runs on below the hips into a vectored thruster.
The right forearm is a winch housing paying cable out to a forged crane
hook; the left is a three-fingered manipulator hand. A raked helmet with
two slanted lens eyes behind black glass is the head tell. The asymmetry is
the silhouette: a heavy hazard-banded pauldron over the hook arm.

Hands hang ALONG the forearm, palm to the front, fingers curling toward
the palm — so a reaching hand opens toward you, never shows its back.
"""

import math

from mathutils import Vector

ACCENT = 0x4FB7FF


def build(K):
    P = math.pi
    K.PLATE_U, K.PLATE_T = 40, 14
    hx = K.hex_rgb
    V = Vector
    K.mat("paint", hx(0xC9CED5), metal=0.0, rough=0.42, coat=0.3, coat_rough=0.12)
    K.mat("paint_b", hx(0x8E949D), metal=0.0, rough=0.48, coat=0.15)
    K.mat("graphite", hx(0x1A1C20), metal=0.45, rough=0.4)
    K.mat("carbon", hx(0x0E0F12), metal=0.2, rough=0.3, coat=0.5)
    K.mat("titanium", hx(0x868B93), metal=1.0, rough=0.28)
    K.mat("chrome", hx(0xD4D8DE), metal=1.0, rough=0.07)
    K.mat("rubber", hx(0x0B0B0C), metal=0.0, rough=0.75)
    K.mat("glass", hx(0x030406), metal=0.0, rough=0.03, coat=1.0)
    K.mat("hazard", hx(0xFF6A1A), metal=0.0, rough=0.42, coat=0.3)
    K.mat("ink", hx(0xE9ECEF), metal=0.0, rough=0.6)
    K.mat("ink_dark", hx(0x1E2126), metal=0.0, rough=0.6)
    K.mat("forged", hx(0x2E3136), metal=1.0, rough=0.34)

    R = K.Rig(shoulder_z=1.22, head_z=1.43, yoke_w=0.62, head_y=0.08, core=(0, 0.19, -0.12))
    put = K.put

    # ── CHEST: one clean V of ceramic per side over the graphite frame ────
    chest = K.Shell([
        (0.85, 0.095, 0.08, 3.0, 0, 0.0),
        (0.95, 0.15, 0.10, 4.0, 0, 0.012),
        (1.07, 0.23, 0.125, 5.0, 0, 0.03),
        (1.20, 0.285, 0.135, 6.0, 0, 0.04),
        (1.31, 0.295, 0.115, 6.0, 0, 0.03),
        (1.38, 0.2, 0.085, 4.0, 0, 0.02),
        (1.415, 0.1, 0.06, 3.0, 0, 0.02),
    ])
    put("CHEST", chest.mesh("frame", "graphite", 48, 28))
    for s in (-1, 1):
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put("CHEST", chest.plate(f"pec{s}", "paint", *u(0.028, 0.3), 0.2, 0.9, off=0.004, th=0.018, cw=0.012))
        put("CHEST", chest.plate(f"back{s}", "paint", *u(0.33, 0.475), 0.3, 0.92, off=0.004, th=0.016, cw=0.012))
        put("CHEST", chest.strip(f"seam{s}", "glow", *u(0.04, 0.24), 0.17, 0.182, off=0.004))
    put("CHEST", chest.plate("keel", "titanium", -0.012, 0.012, 0.08, 0.92, off=0.004, th=0.01, bevel=0.3))
    put("CHEST", K.text("serial", "ink_dark", "TH-01", 0.026, c=chest.at(-0.13, 0.78, 0.024)[0], rot=(P / 2 - 0.2, 0, P - 0.62)))
    cc = R.core
    put("CHEST", K.cyl("core_bezel", "titanium", cc - V((0, 0.006, 0)), 0.082, 0.03, 32, rot=(P / 2, 0, 0), bev=0.006))
    put("CHEST", K.torus("core_ring", "chrome", cc + V((0, 0.01, 0)), 0.073, 0.0065, 32, 6, rot=(P / 2, 0, 0)))
    put("CORE", K.cyl("core_lens", "core", cc + V((0, 0.01, 0)), 0.06, 0.02, 32, rot=(P / 2, 0, 0)))
    put("CHEST", K.lathe("collar", "graphite", [(0.0, 1.37), (0.085, 1.37), (0.095, 1.395), (0.08, 1.425), (0.0, 1.425)], 28, c=(0, 0.04, 0)))
    put("CHEST", K.torus("collar_lt", "glow_dim", (0, 0.04, 1.42), 0.07, 0.004, 28, 6))
    for s in (-1, 1):
        i = 0 if s < 0 else 1
        put("CHEST", K.box(f"yoke{s}", "graphite", (s * 0.33, -0.005, 1.31), (0.16, 0.18, 0.1), bev=0.02, segs=2))
        lamp_c = V((s * 0.38, 0.1, 1.33))
        put("TITAN", K.box(f"sh_bezel{s}", "titanium", lamp_c - V((0, 0.008, 0)), (0.075, 0.016, 0.05), bev=0.006))
        put(f"SHOULDER_{i}", K.box(f"sh_lamp{s}", f"shoulder_{i}", lamp_c + V((0, 0.003, 0)), (0.06, 0.008, 0.034), bev=0.003))
        # Launcher mouths low on the yoke (the hook never volleys; they idle).
        put("CHEST", K.cyl(f"pod_tube{s}", "graphite", (s * 0.37, -0.06, 1.42), 0.03, 0.06, 16, bev=0.004))
        put("CHEST", K.cyl(f"pod_mouth{s}", f"pod_{i}", (s * 0.37, -0.06, 1.452), 0.02, 0.006, 16))
    # Back: one central heat-sink spine with a light line.
    put("CHEST", K.box("hs_frame", "graphite", (0, -0.115, 1.0), (0.11, 0.035, 0.26), bev=0.01))
    for k in range(9):
        put("CHEST", K.box(f"hs{k}", "titanium", (0, -0.133, 0.9 + k * 0.024), (0.09, 0.012, 0.006)))
    put("CHEST", K.box("hs_lt", "glow", (0, -0.14, 1.0), (0.008, 0.006, 0.24)))

    # ── WAIST: stacked-disc spine, an actuator either side ───────────────
    for k in range(5):
        z = 0.63 + k * 0.045
        put("TITAN", K.cyl(f"vert{k}", "graphite", (0, 0.0, z), 0.068 - k * 0.002, 0.028, 24, bev=0.006))
        put("TITAN", K.cyl(f"disc{k}", "rubber", (0, 0.0, z + 0.021), 0.054, 0.014, 20))
    for s in (-1, 1):
        put("TITAN", K.cyl(f"act_sleeve{s}", "graphite", (s * 0.095, 0.035, 0.67), 0.019, 0.14, 14, bev=0.003))
        put("TITAN", K.cyl(f"act_rod{s}", "chrome", (s * 0.095, 0.035, 0.8), 0.01, 0.14, 10))
        put("TITAN", K.cyl(f"act_eye{s}", "titanium", (s * 0.095, 0.035, 0.87), 0.017, 0.02, 12, rot=(0, P / 2, 0)))

    # ── PELVIS: a hard girdle, one plate, the low lamp in a hex bezel ─────
    pelvis = K.Shell([
        (0.42, 0.07, 0.055, 4.0),
        (0.46, 0.12, 0.085, 7.0, 0, 0.005),
        (0.54, 0.15, 0.1, 8.0, 0, 0.01),
        (0.61, 0.14, 0.09, 7.0),
        (0.645, 0.09, 0.07, 4.0),
    ])
    put("TITAN", pelvis.mesh("pelvis", "graphite", 40, 14))
    put("TITAN", pelvis.plate("girdle", "paint", -0.3, 0.3, 0.2, 0.86, off=0.004, th=0.016, cw=0.012))
    lc = V((0, 0.13, 0.52))
    hexo = [(0.052 * math.cos(a), 0.052 * math.sin(a)) for a in (i * P / 3 + P / 6 for i in range(6))]
    put("TITAN", K.prism("low_bezel", "titanium", hexo, 0.02, c=lc - V((0, 0.004, 0)), axis="Y", bev=0.004))
    put("LOW", K.prism("low_lamp", "low", [(x * 0.75, z * 0.75) for x, z in hexo], 0.012, c=lc + V((0, 0.008, 0)), axis="Y"))
    # Lift pods on the hips — the reason it floats.
    for s in (-1, 1):
        pod = V((s * 0.19, -0.02, 0.45))
        put("TITAN", K.lathe(f"lpod{s}", "graphite", [(0.0, -0.03), (0.04, -0.03), (0.048, -0.01), (0.046, 0.03), (0.03, 0.045), (0.0, 0.045)], 24, c=pod, rot=(0, s * 0.45, 0)))
        put("TITAN", K.cyl(f"lpodglow{s}", "glow", pod + V((s * 0.014, 0, -0.03)), 0.036, 0.006, 24, rot=(0, s * 0.45, 0)))

    # ── THRUSTER TAIL: tapering vertebrae into a vectoring nozzle ─────────
    for k, (z, r0, r1) in enumerate(((0.37, 0.07, 0.06), (0.3, 0.056, 0.048), (0.24, 0.045, 0.04))):
        put("TITAN", K.cyl(f"tail{k}", "paint", (0, -0.005 * k, z), r0, 0.055, 24, r2=r1, bev=0.006))
        put("TITAN", K.cyl(f"tailj{k}", "graphite", (0, -0.005 * k, z + 0.033), r0 * 0.82, 0.014, 20))
    put("TITAN", K.lathe("nozzle", "titanium", [(0.03, 0.215), (0.038, 0.2), (0.05, 0.16), (0.056, 0.13), (0.05, 0.128), (0.034, 0.16), (0.022, 0.2)], 28))
    put("TITAN", K.cyl("nozzle_glow", "glow", (0, 0, 0.138), 0.04, 0.008, 24))
    put("TITAN", K.cyl("plume", "glow_dim", (0, 0, 0.085), 0.034, 0.09, 20, r2=0.006, rot=(P, 0, 0)))

    # ── HEAD: a raked helmet, black glass face, slanted lens eyes ─────────
    hc = R.head
    head = K.Shell([
        (hc.z - 0.1, 0.055, 0.06, 3.0, 0, hc.y + 0.0),
        (hc.z - 0.075, 0.09, 0.11, 4.0, 0, hc.y + 0.015),
        (hc.z - 0.01, 0.105, 0.13, 4.5, 0, hc.y + 0.02),
        (hc.z + 0.055, 0.1, 0.13, 4.2, 0, hc.y + 0.0),
        (hc.z + 0.1, 0.075, 0.105, 3.4, 0, hc.y - 0.025),
        (hc.z + 0.122, 0.03, 0.05, 2.6, 0, hc.y - 0.04),
    ])
    put("HEAD", head.mesh("skull", "graphite", 44, 22))
    put("HEAD", head.plate("helm", "paint", -0.5, 0.5, 0.64, 1.0, off=0.003, th=0.014, cw=0.01))
    put("HEAD", head.plate("face", "glass", -0.16, 0.16, 0.22, 0.62, off=0.003, th=0.012, bevel=0.6))
    put("HEAD", head.strip("brow_lt", "glow", -0.15, 0.15, 0.625, 0.638, off=0.017))
    put("HEAD", head.plate("jaw", "carbon", -0.15, 0.15, 0.02, 0.2, off=0.003, th=0.01))
    for s in (-1, 1):
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put("HEAD", head.plate(f"cheek{s}", "paint", *u(0.17, 0.4), 0.12, 0.62, off=0.003, th=0.012, cw=0.01))
        p, n = head.at(0.26 * s, 0.42, 0.014)
        put("HEAD", K.cyl(f"ear{s}", "titanium", p, 0.03, 0.02, 24, rot=(0, P / 2, 0), bev=0.004))
        put("HEAD", K.torus(f"ear_lt{s}", "glow_dim", p + V((s * 0.011, 0, 0)), 0.022, 0.0035, 24, 6, rot=(0, P / 2, 0)))
    for k, s in enumerate((-1, 1)):
        p, n = head.at(0.068 * s, 0.44, 0.0)
        e = p + n * 0.012
        lens = [(-0.03, 0.002), (-0.012, 0.016), (0.034, 0.02), (0.038, -0.004), (0.02, -0.018), (-0.026, -0.016)]
        put("HEAD", K.prism(f"eframe{s}", "titanium", [(s * x * 1.2, z * 1.35) for x, z in lens], 0.016, c=e, axis="Y", bev=0.003))
        put(f"EYE_{k}", K.prism(f"eye{k}", "visor", [(s * x, z) for x, z in lens], 0.012, c=e + n * 0.006, axis="Y"))
    ep = head.at(0.0, 0.44, 0.0)[0]
    R.extra.append(("EYEFX", V((0, ep.y + 0.05, ep.z)), "HEAD"))
    put("HEAD", K.cyl("neck", "graphite", (0, hc.y - 0.03, hc.z - 0.12), 0.034, 0.08, 18))
    for k in range(3):
        put("HEAD", K.torus(f"neckring{k}", "titanium", (0, hc.y - 0.03, hc.z - 0.15 + k * 0.024), 0.038, 0.0045, 18, 6))

    # ── ARMS ──────────────────────────────────────────────────────────────
    for i, s in ((0, -1), (1, 1)):
        pv, el, wr, hp = R.pivot[i], R.elbow(i), R.wrist(i), R.handp(i)
        A, E_, W, H = f"ARM_{i}", f"ELBOW_{i}", f"WRIST_{i}", f"HAND_{i}"
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put(A, K.cyl(f"shhub{s}", "graphite", pv, 0.066, 0.12, 28, rot=(0, P / 2, 0), bev=0.01))
        put(A, K.torus(f"shring{s}", "glow_dim", pv + V((s * 0.062, 0, 0)), 0.05, 0.0045, 28, 6, rot=(0, P / 2, 0)))
        # One pauldron per side over a virtual cap round the joint.
        cap = K.Shell([
            (pv.z + 0.09, 0.03, 0.045, 3.0, pv.x + s * 0.02, 0.0),
            (pv.z + 0.065, 0.088, 0.098, 5.0, pv.x + s * 0.015, 0.0),
            (pv.z + 0.0, 0.11, 0.11, 6.0, pv.x + s * 0.02, 0.0),
            (pv.z - 0.09, 0.105, 0.1, 6.0, pv.x + s * 0.032, 0.0),
            (pv.z - 0.15, 0.095, 0.09, 6.0, pv.x + s * 0.04, 0.0),
        ])
        if s < 0:
            put(A, cap.plate("paulL", "paint", *u(-0.08, 0.58), 0.0, 0.62, off=0.006, th=0.016, cw=0.012))
            put(A, cap.strip("paul_lt", "glow", *u(-0.06, 0.56), 0.64, 0.655, off=0.008))
        else:
            # The hook side: one heavy slab, hazard banding along its rim.
            put(A, cap.plate("paulR", "paint", *u(-0.12, 0.62), 0.0, 0.86, off=0.008, th=0.022, cw=0.014))
            for k in range(7):
                put(A, cap.plate(f"band{k}", "hazard" if k % 2 == 0 else "carbon", *u(-0.1 + k * 0.1, -0.02 + k * 0.1), 0.86, 0.96, off=0.008, th=0.016, bevel=0.3))
            put(A, K.text("tow", "ink_dark", "TOW", 0.04, c=cap.at(0.25, 0.42, 0.032)[0], rot=(P / 2, 0, P / 2 + 0.05)))
        # Upper arm: slim frame, one sleeve plate, actuator behind.
        ua = K.Shell([
            (pv.z - 0.05, 0.048, 0.052, 4.0, pv.x, 0),
            (pv.z - 0.15, 0.058, 0.064, 5.0, pv.x, 0.004),
            (pv.z - 0.32, 0.052, 0.058, 5.0, pv.x, 0.004),
            (el.z + 0.06, 0.042, 0.046, 4.0, pv.x, 0),
        ])
        put(A, ua.mesh(f"upper{s}", "graphite", 28, 10))
        put(A, ua.plate(f"sleeve{s}", "paint", -0.26, 0.26, 0.25, 0.86, off=0.004, th=0.013, cw=0.01))
        put(A, ua.strip(f"armlt{s}", "glow", -0.01, 0.01, 0.3, 0.8, off=0.019, th=0.003))
        put(A, K.cyl(f"uact{s}", "graphite", pv + V((0, -0.068, -0.22)), 0.015, 0.17, 12))
        put(A, K.cyl(f"uactr{s}", "chrome", pv + V((0, -0.068, -0.37)), 0.008, 0.14, 10))
        # Elbow: hub with lit rings; the cop sits BEHIND (the elbow's point).
        put(E_, K.cyl(f"elhub{s}", "titanium", el, 0.048, 0.098, 24, rot=(0, P / 2, 0), bev=0.006))
        for x in (-1, 1):
            put(E_, K.torus(f"elring{s}{x}", "glow_dim", el + V((x * 0.05, 0, 0)), 0.037, 0.0035, 24, 6, rot=(0, P / 2, 0)))
        put(E_, K.box(f"elcop{s}", "paint", el + V((0, -0.05, -0.01)), (0.07, 0.022, 0.08), bev=0.008))
        if s < 0:
            fa = K.Shell([
                (el.z - 0.03, 0.045, 0.05, 4.0, el.x, 0),
                (el.z - 0.12, 0.062, 0.07, 5.0, el.x, 0.008),
                (el.z - 0.3, 0.06, 0.066, 5.0, el.x, 0.008),
                (wr.z + 0.04, 0.046, 0.05, 4.0, el.x, 0),
            ])
            put(E_, fa.mesh("fore", "graphite", 28, 10))
            put(E_, fa.plate("vamb", "paint", -0.28, 0.28, 0.1, 0.88, off=0.004, th=0.014, cw=0.01))
            put(E_, fa.strip("vamblt", "glow", *u(0.29, 0.305), 0.15, 0.82, off=0.006))
        else:
            # The winch forearm: a fat housing with a window onto the spool,
            # cable running out through a fairlead to the hook.
            fa = K.Shell([
                (el.z - 0.03, 0.05, 0.055, 3.4, el.x, 0),
                (el.z - 0.1, 0.075, 0.082, 4.0, el.x, 0.006),
                (el.z - 0.31, 0.078, 0.084, 4.0, el.x, 0.006),
                (wr.z + 0.035, 0.058, 0.062, 3.4, el.x, 0),
            ])
            put(E_, fa.mesh("winch_case", "graphite", 32, 12))
            put(E_, fa.plate("winch_top", "paint", -0.22, 0.12, 0.08, 0.9, off=0.004, th=0.016, cw=0.012))
            put(E_, fa.plate("winch_back", "paint", 0.42, 0.9, 0.08, 0.9, off=0.004, th=0.016, cw=0.012))
            sc = V((el.x + 0.05, 0.005, (el.z + wr.z) / 2))
            put(E_, K.cyl("spool", "titanium", sc, 0.045, 0.24, 24, bev=0.004))
            for k in range(14):
                put(E_, K.torus(f"wrap{k}", "rubber", sc + V((0, 0, -0.1 + k * 0.0155)), 0.05, 0.0068, 16, 4))
            put(E_, K.torus("spool_lt", "glow", sc + V((0, 0, 0.125)), 0.052, 0.005, 24, 6))
            put(E_, K.torus("spool_lt2", "glow", sc + V((0, 0, -0.125)), 0.052, 0.005, 24, 6))
            put(E_, K.text("kanji", "hazard", "牽引", 0.038, c=fa.at(-0.05, 0.5, 0.024)[0], rot=(P / 2, 0, P - 0.3), font="YuGothB.ttc"))
            fl = V((el.x + 0.02, 0.07, wr.z + 0.03))
            put(E_, K.box("fairlead", "titanium", fl, (0.05, 0.035, 0.04), bev=0.008))
            put(E_, K.tube("cable_out", "rubber", [sc + V((0.03, 0.04, -0.06)), fl + V((0, 0.0, 0.01)), fl + V((0, 0.01, -0.04))], 0.008, 8, 6))
        put(W, K.cyl(f"wrhub{s}", "titanium", wr, 0.04, 0.078, 22, rot=(0, P / 2, 0), bev=0.005))
        put(W, K.cyl(f"wrcuff{s}", "graphite", wr + V((0, 0, -0.025)), 0.047, 0.03, 22, bev=0.006))

        if s > 0:
            # THE HOOK, in line with the forearm: swivel block, shank, then
            # the bow sweeping forward and up into the point. A sprung latch
            # spans the throat (a DIGIT — the curl snaps it shut).
            put(H, K.box("block", "paint", hp + V((0, 0.0, 0.02)), (0.1, 0.09, 0.11), bev=0.02, segs=2))
            put(H, K.box("block_band", "hazard", hp + V((0, 0.0, 0.0)), (0.104, 0.094, 0.022), bev=0.005))
            put(H, K.text("blk_txt", "ink_dark", "SWL 12t", 0.016, c=hp + V((0, 0.047, 0.045)), rot=(P / 2, 0, P)))
            put(H, K.tube("cable_in", "rubber", [hp + V((0.0, 0.02, 0.11)), hp + V((0, 0.03, 0.07)), hp + V((0, 0.012, 0.04))], 0.008, 8, 6))
            put(H, K.cyl("swivel", "titanium", hp + V((0, 0, -0.05)), 0.032, 0.03, 20, bev=0.004))
            put(H, K.cyl("shank", "forged", hp + V((0, 0, -0.1)), 0.027, 0.08, 20, bev=0.004))
            for k in range(3):
                put(H, K.torus(f"sband{k}", "hazard" if k % 2 == 0 else "carbon", hp + V((0, 0, -0.075 - k * 0.022)), 0.028, 0.0045, 20, 6))
            hook = [
                hp + V((0, 0.0, -0.13)),
                hp + V((0, -0.01, -0.2)),
                hp + V((0, 0.015, -0.27)),
                hp + V((0, 0.09, -0.29)),
                hp + V((0, 0.155, -0.24)),
                hp + V((0, 0.165, -0.165)),
                hp + V((0, 0.14, -0.115)),
            ]
            put(H, K.tube("hook", "forged", hook, 0.045, 18, 10, r_end=0.011))
            put(H, K.tube("hook_lt", "glow", [hp + V((0, 0.022, -0.215)), hp + V((0, 0.05, -0.248)), hp + V((0, 0.105, -0.25)), hp + V((0, 0.13, -0.205))], 0.0065, 8, 8))
            latch = R.digit(i, 0, hp + V((0, 0.11, -0.12)), 0.55, -0.15)
            put(latch, K.box("latch", "titanium", hp + V((0, 0.12, -0.16)), (0.014, 0.01, 0.08), bev=0.003, rot=(0.25, 0, 0)))
            put(latch, K.cyl("latch_pin", "chrome", hp + V((0, 0.11, -0.12)), 0.009, 0.032, 12, rot=(0, P / 2, 0)))
        else:
            # THE MANIPULATOR: a palm hanging in line with the forearm, its
            # face to the FRONT; three two-jointed fingers continue downward
            # and an opposed thumb sits on the outer edge. Every digit curls
            # toward the palm (+Y), so a reaching hand opens toward you.
            put(H, K.box("palm", "graphite", hp + V((0, 0.0, -0.01)), (0.1, 0.05, 0.11), bev=0.012, segs=2))
            put(H, K.box("palm_back", "paint", hp + V((0, -0.018, -0.005)), (0.104, 0.024, 0.1), bev=0.01, segs=2))
            put(H, K.box("palm_lt", "glow", hp + V((0, -0.031, -0.005)), (0.006, 0.004, 0.07)))
            put(H, K.box("palm_pad", "rubber", hp + V((0, 0.026, -0.015)), (0.084, 0.006, 0.08), bev=0.002))
            for k, x in enumerate((-0.033, 0.0, 0.033)):
                kn = hp + V((x, 0.0, -0.068))
                d0 = R.digit(i, 2 * k, kn, 0.05, 1.3)
                put(d0, K.cyl(f"f{k}k", "titanium", kn, 0.015, 0.03, 14, rot=(0, P / 2, 0)))
                put(d0, K.box(f"f{k}a", "paint", kn + V((0, -0.003, -0.032)), (0.026, 0.03, 0.06), bev=0.007))
                j = kn + V((0, 0.0, -0.064))
                d1 = R.digit(i, 2 * k + 1, j, 0.12, 1.5)
                put(d1, K.cyl(f"f{k}j", "titanium", j, 0.012, 0.026, 12, rot=(0, P / 2, 0)))
                put(d1, K.box(f"f{k}b", "graphite", j + V((0, -0.002, -0.026)), (0.023, 0.026, 0.05), bev=0.006))
                put(d1, K.box(f"f{k}t", "glow_dim", j + V((0, 0.0, -0.052)), (0.014, 0.012, 0.004)))
            # Thumb on the OUTER edge (palm forward, thumb out — the
            # anatomical hand), set into the palm face to close across it.
            th = hp + V((s * 0.055, 0.012, -0.02))
            dt = R.digit(i, 6, th, 0.15, 1.1)
            put(dt, K.cyl("thumb_k", "titanium", th, 0.013, 0.028, 12, rot=(0, P / 2, 0)))
            put(dt, K.box("thumb", "paint", th + V((s * 0.006, 0.004, -0.032)), (0.025, 0.028, 0.06), bev=0.007, rot=(0, -s * 0.3, 0)))
    return R

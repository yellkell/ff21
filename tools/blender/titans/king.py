"""
V — GOLIATH: the neon district's zaibatsu kingpin. A corporate flagship
war-frame cut like a modern samurai: black lacquer armour under a deep
clearcoat, every plate edged in polished gold. Tall, narrow-waisted and
broad across a pagoda line of shoulders — the most regal machine in the
roster, not the heaviest. A kabuto helm with a broad swept neck guard, a
menpō mask split by ONE horizontal eye slit, a great gold crescent and the
old king's five-spike CROWN round the bowl. Behind him, mounted on the back,
a HALO: a thin lit ring with five floating blades — the silhouette.

The crown circuit (head -> left shoulder -> core -> right shoulder -> low)
is drawn into the armour: each stop is a gold-framed lamp, the shoulder
ones big on the fronts of the fixed sode housings, the launcher mouths set
into the tops of those housings.

Hands hang ALONG the forearm, palm to the front, fingers curling toward
the palm (+Y), the thumb on the OUTER edge: a reaching gauntlet opens
toward you like a human hand held palm-forward.
"""

import math

from mathutils import Matrix, Vector

ACCENT = 0xFF3B30
TAU5 = math.tau / 5


def build(K):
    P = math.pi
    hx = K.hex_rgb
    V = Vector
    put = K.put

    K.mat("lacquer", (0.0055, 0.0055, 0.0065), metal=0.0, rough=0.32, coat=1.0, coat_rough=0.03)
    K.mat("gold", (0.93, 0.63, 0.24), metal=1.0, rough=0.2)
    K.mat("graphite", hx(0x1A1C20), metal=0.45, rough=0.4)
    K.mat("steel", hx(0x8A8F98), metal=1.0, rough=0.24)
    K.mat("rubber", hx(0x0B0B0C), metal=0.0, rough=0.75)
    K.mat("ink", hx(0xD9DCE0), metal=0.0, rough=0.6)

    R = K.Rig(shoulder_z=1.22, head_z=1.5, yoke_w=0.62, head_y=0.02)

    def U(s, a, b):
        return (a, b) if s > 0 else (-b, -a)

    def pl(sh, name, m, u0, u1, t0, t1, du=26, dt=10, **kw):
        """Shell.plate at a game-budget density."""
        kw.setdefault("nu", max(4, round(abs(u1 - u0) * du)))
        kw.setdefault("nt", max(2, round(abs(t1 - t0) * dt)))
        return sh.plate(name, m, u0, u1, t0, t1, **kw)

    def gilt(sh, name, m, u0, u1, t0, t1, off=0.004, th=0.016, gu=0.008, gt=0.014, cw=0.012, du=26, dt=10):
        """A lacquer plate seated in a slightly larger gold one: the gold
        shows as a polished edge round the whole plate."""
        g = pl(sh, name + "_au", "gold", u0, u1, t0, t1, du, dt, off=off, th=th * 0.62, cw=cw * 0.5, bevel=0.35)
        lq = pl(sh, name, m, u0 + gu, u1 - gu, t0 + gt, t1 - gt, du, dt, off=off + 0.001, th=th, cw=cw)
        return [g, lq]

    def inset(poly, d):
        """Offset a closed 2D outline inward by d (mitred)."""
        n = len(poly)
        area = sum(poly[k][0] * poly[(k + 1) % n][1] - poly[(k + 1) % n][0] * poly[k][1] for k in range(n))
        sg = 1 if area > 0 else -1
        out = []
        for k in range(n):
            p0, p1, p2 = V(poly[k - 1]), V(poly[k]), V(poly[(k + 1) % n])
            e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
            n1, n2 = V((-e1.y, e1.x)) * sg, V((-e2.y, e2.x)) * sg
            m = (n1 + n2) / (1 + n1.dot(n2))
            out.append(tuple(p1 + m * d))
        return out

    def frame(name, poly, y, w=0.01, d=0.008, m="gold"):
        """Gold piping round a closed XZ outline at depth y (face trim)."""
        out = []
        for k in range(len(poly)):
            a, b = V((poly[k][0], 0, poly[k][1])), V((poly[(k + 1) % len(poly)][0], 0, poly[(k + 1) % len(poly)][1]))
            dv = b - a
            c = (a + b) / 2
            out.append(K.box(f"{name}{k}", m, (c.x, y, c.z), (dv.length + w, d, w), bev=w * 0.3, segs=1, rot=(0, -math.atan2(dv.z, dv.x), 0)))
        return out

    def mon(name, c, r, rot=(P / 2, 0, 0)):
        """The house mon: a gold ring round a diamond (hishi) — the zaibatsu."""
        o = [K.torus(name + "_ring", "gold", (0, 0, 0), r, r * 0.11, 32, 6)]
        q = r * 0.62
        o.append(K.prism(name + "_hishi", "gold", [(0, q), (q * 0.7, 0), (0, -q), (-q * 0.7, 0)], r * 0.12, axis="Z", bev=r * 0.02))
        return K.place(K.join(name, o), c, rot)

    # ── TORSO: a tall dō — narrow waist, square broad chest, two plates ──
    torso = K.Shell([
        (0.70, 0.12, 0.09, 5.0, 0, 0.0),
        (0.80, 0.145, 0.108, 6.0, 0, 0.01),
        (0.95, 0.205, 0.14, 7.0, 0, 0.035),
        (1.10, 0.26, 0.16, 8.0, 0, 0.05),
        (1.24, 0.29, 0.155, 8.0, 0, 0.045),
        (1.36, 0.28, 0.14, 8.0, 0, 0.025),
        (1.43, 0.2, 0.095, 6.0, 0, 0.012),
    ])
    put("CHEST", torso.mesh("frame", "graphite", 40, 24))
    put("CHEST", gilt(torso, "breast", "lacquer", -0.2, 0.2, 0.36, 0.87, th=0.018))
    put("CHEST", gilt(torso, "belly", "lacquer", -0.15, 0.15, 0.05, 0.34, th=0.016))
    put("CHEST", gilt(torso, "backplate", "lacquer", 0.29, 0.71, 0.1, 0.87, th=0.018))
    for s in (-1, 1):
        p, n = torso.at(0.25 * s, 0.5, 0.004)
        put("CHEST", K.vents(f"sidevent{s}", "graphite", p, 0.07, 0.12, 6, rot=(0, 0, -s * P / 2)))
    # Core: a deep gold bezel, the lens near R.core.
    cc = R.core
    put("CHEST", K.lathe("core_bezel", "gold", [(0.0, -0.05), (0.088, -0.05), (0.09, 0.0), (0.082, 0.026), (0.07, 0.03), (0.066, 0.012), (0.0, 0.012)], 40, c=cc - V((0, 0.03, 0)), rot=(-P / 2, 0, 0)))
    put("CORE", K.cyl("core_lens", "core", cc - V((0, 0.012, 0)), 0.064, 0.02, 40, rot=(P / 2, 0, 0)))
    pk = torso.at(0.0, 0.73, 0.022)[0]
    put("CHEST", K.text("kanji", "gold", "王", 0.1, c=pk, rot=(P / 2 - 0.3, 0, P), font="YuGothB.ttc", extrude=0.003))
    # High collar round the neck.
    put("CHEST", K.lathe("collar", "lacquer", [(0.0, 1.38), (0.115, 1.38), (0.122, 1.41), (0.108, 1.46), (0.0, 1.46)], 32))
    put("CHEST", K.torus("collar_au", "gold", (0, 0.0, 1.459), 0.107, 0.005, 32, 6))
    # Back: the mon and a serial.
    put("CHEST", mon("back_mon", torso.at(0.5, 0.45, 0.024)[0], 0.06, rot=(P / 2, 0, 0)))
    put("CHEST", K.text("serial", "ink", "ZK-05 GOLIATH", 0.022, c=torso.at(0.5, 0.27, 0.024)[0], rot=(P / 2, 0, 0)))

    # ── SHOULDER HOUSINGS (fixed): the upper sode as an upswept pagoda
    # eave either side of the helm — lamp on the face, launchers on top ──
    eave = [(0.22, 1.215), (0.47, 1.215), (0.565, 1.31), (0.6, 1.4), (0.64, 1.51), (0.5, 1.47), (0.22, 1.47)]
    for i, s in ((0, -1), (1, 1)):
        poly = [(s * x, z) for x, z in eave]
        put("CHEST", K.prism(f"shhouse{s}", "lacquer", poly, 0.22, axis="Y", bev=0.008))
        roof = [(s * x, z) for x, z in [(0.205, 1.458), (0.5, 1.458), (0.662, 1.508), (0.656, 1.532), (0.5, 1.49), (0.205, 1.49)]]
        put("CHEST", K.prism(f"roof_au{s}", "gold", roof, 0.248, axis="Y", bev=0.006))
        put("CHEST", K.prism(f"roof{s}", "lacquer", inset(roof, 0.006), 0.262, axis="Y", bev=0.006))
        tr = inset(poly[:4] + [(s * 0.6, 1.44), (s * 0.5, 1.445), (s * 0.22, 1.445)], 0.012)
        put("CHEST", frame(f"shtrim{s}", tr, 0.111, w=0.009, d=0.006))
        put("CHEST", frame(f"shtrimb{s}", tr, -0.111, w=0.009, d=0.006))
        lamp_c = V((s * 0.38, 0.118, 1.345))
        put("CHEST", K.torus(f"sh_bezel{s}", "gold", lamp_c, 0.094, 0.009, 40, 8, rot=(P / 2, 0, 0)))
        put("CHEST", K.cyl(f"sh_seat{s}", "graphite", lamp_c - V((0, 0.004, 0)), 0.09, 0.012, 40, rot=(P / 2, 0, 0)))
        put(f"SHOULDER_{i}", K.cyl(f"sh_lamp{s}", f"shoulder_{i}", lamp_c + V((0, 0.003, 0)), 0.085, 0.01, 40, rot=(P / 2, 0, 0)))
        # Launchers: twin slim barrels raked forward out of the housing top.
        for k, dx in enumerate((-0.022, 0.022)):
            base = V((s * (0.37 + dx), 0.0, 1.49))
            rk = -0.45
            ax = V((0, -math.sin(rk), math.cos(rk)))
            put("CHEST", K.cyl(f"pod_b{s}{k}", "graphite", base + ax * 0.03, 0.019, 0.07, 16, rot=(rk, 0, 0), bev=0.003))
            put("CHEST", K.torus(f"pod_au{s}{k}", "gold", base + ax * 0.064, 0.019, 0.004, 16, 6, rot=(rk, 0, 0)))
            put("CHEST", K.cyl(f"pod_m{s}{k}", f"pod_{i}", base + ax * 0.066, 0.014, 0.004, 16, rot=(rk, 0, 0)))
        put("CHEST", K.box(f"pod_cradle{s}", "graphite", (s * 0.37, 0.0, 1.496), (0.1, 0.07, 0.02), bev=0.005))

    # ── WAIST: an obi band, the skirt hangs from it ──────────────────────
    obi = K.Shell([
        (0.655, 0.162, 0.132, 5.0),
        (0.70, 0.166, 0.136, 5.0),
        (0.765, 0.16, 0.13, 5.0),
    ])
    put("TITAN", obi.mesh("obi", "lacquer", 40, 4))
    put("TITAN", pl(obi, "obi_au0", "gold", -0.5, 0.5, 0.0, 0.1, du=40, off=0.0, th=0.006, bevel=0.0))
    put("TITAN", pl(obi, "obi_au1", "gold", -0.5, 0.5, 0.9, 1.0, du=40, off=0.0, th=0.006, bevel=0.0))
    # The hover drive under the skirt: a bell housing, crimson lift glow.
    put("TITAN", K.lathe("drive", "graphite", [(0.0, 0.66), (0.135, 0.66), (0.15, 0.6), (0.165, 0.45), (0.165, 0.3), (0.14, 0.2), (0.1, 0.165), (0.0, 0.165)], 36))
    put("TITAN", K.torus("drive_ring", "steel", (0, 0, 0.19), 0.15, 0.008, 36, 6))
    put("TITAN", K.cyl("lift", "glow", (0, 0, 0.162), 0.09, 0.008, 36))
    put("TITAN", K.torus("lift_ring", "glow", (0, 0, 0.172), 0.112, 0.007, 36, 6))
    put("TITAN", K.cyl("lift_wash", "glow_dim", (0, 0, 0.14), 0.08, 0.035, 28, r2=0.045, rot=(P, 0, 0)))

    # ── KUSAZURI: big lacquer lames, split, gold edged ───────────────────
    skirt = K.Shell([
        (0.745, 0.178, 0.148, 5.0, 0, 0.0),
        (0.6, 0.215, 0.175, 5.0, 0, 0.006),
        (0.45, 0.248, 0.2, 5.0, 0, 0.012),
        (0.30, 0.275, 0.224, 5.0, 0, 0.016),
        (0.22, 0.288, 0.236, 5.0, 0, 0.018),
    ])
    put("TITAN", gilt(skirt, "tasset_f", "lacquer", -0.085, 0.085, 0.0, 1.0, gu=0.006, gt=0.012))
    for s in (-1, 1):
        put("TITAN", gilt(skirt, f"tasset_s{s}", "lacquer", *U(s, 0.1, 0.27), 0.0, 0.94, gu=0.006, gt=0.012))
        put("TITAN", gilt(skirt, f"tasset_b{s}", "lacquer", *U(s, 0.285, 0.47), 0.0, 0.9, gu=0.006, gt=0.012))
    # LOW lamp: a hishi diamond in gold on the front lame.
    M = skirt.frame_at(0.0, 0.42, 0.021, up=(0, 0, 1))
    dia = [(0, 0.05), (0.04, 0), (0, -0.05), (-0.04, 0)]
    put("TITAN", K.stick(K.prism("low_bezel", "gold", [(x * 1.4, z * 1.32) for x, z in dia], 0.01, axis="Y", bev=0.003), M))
    put("LOW", K.stick(K.prism("low_lamp", "low", dia, 0.012, c=(0, 0.006, 0), axis="Y"), M))

    # ── HEAD: kabuto bowl, menpō, one eye slit, crescent and crown ───────
    hc = R.head
    head = K.Shell([
        (hc.z - 0.1, 0.045, 0.06, 5.0, 0, hc.y + 0.01),
        (hc.z - 0.05, 0.075, 0.1, 5.0, 0, hc.y + 0.012),
        (hc.z + 0.01, 0.112, 0.126, 4.5, 0, hc.y + 0.012),
        (hc.z + 0.07, 0.114, 0.126, 4.0, 0, hc.y - 0.004),
        (hc.z + 0.125, 0.092, 0.104, 3.4, 0, hc.y - 0.015),
        (hc.z + 0.158, 0.03, 0.04, 2.6, 0, hc.y - 0.02),
    ])
    put("HEAD", head.mesh("skull", "graphite", 40, 18))
    # Bowl (hachi) and its gold band — the crown stands on the band.
    put("HEAD", pl(head, "hachi", "lacquer", -0.5, 0.5, 0.58, 1.0, du=40, dt=12, off=0.004, th=0.014, cw=0.01))
    put("HEAD", pl(head, "koshimaki", "gold", -0.5, 0.5, 0.54, 0.6, du=40, off=0.006, th=0.016, bevel=0.3))
    # Menpō: a faceted lacquer mask from the chin to just under the slit.
    # Menpō: two faceted lacquer halves meeting in a keel, chin pitched
    # forward — a hard V of a face under the slit, gold at every edge.
    mtop = head.at(0.0, 0.39, 0.0)[0]
    half = [(0.0, 0.0), (0.114, 0.0), (0.11, -0.045), (0.078, -0.095), (0.03, -0.122), (0.0, -0.126)]
    for s in (-1, 1):
        Mh = Matrix.Translation(V((0, mtop.y + 0.024, mtop.z - 0.004))) @ Matrix.Rotation(0.12, 4, "X") @ Matrix.Rotation(-s * 0.5, 4, "Z")
        for nm, mm, sc, dp, dy in (("menpo_au", "gold", 1.0, 0.07, -0.004), ("menpo", "lacquer", 0.0, 0.07, 0.0)):
            if sc:
                poly = [(s * x * 1.07, z * 1.06 - 0.004) for x, z in half]
            else:
                poly = [(s * (0.0 if x == 0 else x - 0.004), (z + 0.008) * 0.94) for x, z in half]
            o = K.prism(f"{nm}{s}", mm, poly, dp, axis="Y", bev=0.004)
            o.data.transform(Matrix.Translation((0, -dp / 2 + dy, 0)))
            put("HEAD", K.stick(o, Mh))
        for k in range(3):
            put("HEAD", K.stick(K.box(f"mvent{s}{k}", "gold", (s * 0.05, 0.002, -0.066 - k * 0.012), (0.04, 0.006, 0.005), bev=0.0015), Mh))
    put("HEAD", pl(head, "slit_bed", "graphite", -0.17, 0.17, 0.37, 0.5, off=0.002, th=0.008))
    put("EYE_0", pl(head, "eye", "visor", -0.14, 0.14, 0.4, 0.47, du=40, dt=4, off=0.008, th=0.008, bevel=0.3))
    ep = head.at(0.0, 0.435, 0.016)[0]
    R.extra.append(("EYEFX", V((0, ep.y + 0.05, ep.z)), "HEAD"))
    # Brim (mabizashi) over the slit.
    bz = head.at(0.0, 0.52, 0.0)[0].z
    brim = K.Shell([
        (bz + 0.006, 0.116, 0.13, 4.0, 0, hc.y + 0.004),
        (bz - 0.012, 0.14, 0.165, 4.0, 0, hc.y + 0.012),
    ])
    put("HEAD", pl(brim, "brim", "lacquer", -0.2, 0.2, 0.0, 1.0, du=40, dt=2, off=0.0, th=0.01, cw=0.006))
    put("HEAD", pl(brim, "brim_au", "gold", -0.2, 0.2, 0.85, 1.0, du=40, dt=1, off=0.0, th=0.012, bevel=0.0))
    # Shikoro: the broad swept neck guard, two lames, gold hems.
    shik = K.Shell([
        (hc.z + 0.07, 0.118, 0.13, 4.0, 0, hc.y - 0.006),
        (hc.z + 0.0, 0.18, 0.17, 4.0, 0, hc.y - 0.035),
        (hc.z - 0.08, 0.245, 0.21, 4.5, 0, hc.y - 0.065),
    ])
    put("HEAD", gilt(shik, "shikoro0", "lacquer", 0.17, 0.83, 0.0, 0.55, off=0.004, th=0.014, gu=0.006, gt=0.03))
    put("HEAD", gilt(shik, "shikoro1", "lacquer", 0.15, 0.85, 0.45, 1.0, off=0.018, th=0.014, gu=0.006, gt=0.03))
    # Crescent maedate, standing off a gold holder on the brow.
    Ro, phi, ic = 0.27, math.radians(84), 0.075
    tip = V((Ro * math.sin(phi), -Ro * math.cos(phi)))
    Ri = (tip - V((0, ic))).length
    pts = []
    for k in range(25):
        a = -P / 2 - phi + 2 * phi * k / 24
        pts.append((Ro * math.cos(a), Ro * math.sin(a)))
    ai = math.atan2(tip.y - ic, tip.x)
    for k in range(1, 24):
        a = ai + (-P - 2 * ai) * k / 24
        pts.append((Ri * math.cos(a), ic + Ri * math.sin(a)))
    fp = head.at(0.0, 0.66, 0.02)[0]
    cres_c = V((0, fp.y + 0.03, fp.z + Ro - 0.02))
    put("HEAD", K.prism("crescent", "gold", pts, 0.01, c=cres_c, rot=(-0.22, 0, 0), axis="Y", bev=0.002))
    put("HEAD", K.box("haraidate", "gold", fp + V((0, 0.015, 0.0)), (0.04, 0.03, 0.05), bev=0.008, rot=(-0.3, 0, 0)))
    put("HEAD", mon("brow_mon", fp + V((0, 0.032, -0.002)), 0.018, rot=(P / 2 - 0.3, 0, 0)))
    # The CROWN: five gold spikes rising off the koshimaki band.
    for k, u in enumerate((-0.31, -0.13, 0.5, 0.13, 0.31)):
        M = head.frame_at(u, 0.58, 0.018, up=(0, 0, 1)) @ Matrix.Rotation(-0.2, 4, "X")
        spike = K.prism(f"crown{k}", "gold", [(-0.034, 0), (0.034, 0), (0.017, 0.045), (0.0, 0.16), (-0.017, 0.045)], 0.018, axis="Y", bev=0.004)
        put("HEAD", K.stick(spike, M))
    # Neck.
    put("HEAD", K.cyl("neck", "graphite", (0, hc.y - 0.02, hc.z - 0.12), 0.045, 0.09, 20))
    for k in range(2):
        put("HEAD", K.torus(f"neckring{k}", "steel", (0, hc.y - 0.02, hc.z - 0.15 + k * 0.03), 0.049, 0.005, 20, 6))

    # ── HALO: a thin lit ring on a back mast, five floating blades ───────
    Hc = V((0, -0.27, 1.56))
    Hr = 0.37
    put("CHEST", K.box("mast", "graphite", (0, -0.2, 1.12), (0.07, 0.05, 0.16), bev=0.012))
    put("CHEST", K.tube("mast_arm", "graphite", [(0, -0.205, 1.15), (0, -0.24, 1.2), (0, -0.27, Hc.z - Hr - 0.01)], 0.022, 12, 6))
    put("CHEST", K.box("mast_clamp", "gold", (0, -0.27, Hc.z - Hr), (0.05, 0.04, 0.04), bev=0.01))
    put("CHEST", K.torus("halo_au", "gold", Hc, Hr + 0.013, 0.007, 80, 6, rot=(P / 2, 0, 0)))
    put("CHEST", K.torus("halo", "glow", Hc, Hr - 0.004, 0.011, 80, 8, rot=(P / 2, 0, 0)))
    for k in range(5):
        a = k * TAU5
        d = V((math.sin(a), 0, math.cos(a)))
        nod = Hc + d * (Hr + 0.012)
        put("CHEST", K.cyl(f"halo_node{k}", "gold", nod, 0.018, 0.026, 16, rot=(P / 2, 0, 0), bev=0.003))
        blade = [(0, 0), (0.028, 0.04), (0.017, 0.15), (0, 0.2), (-0.017, 0.15), (-0.028, 0.04)]
        base = Hc + d * (Hr + 0.045)
        put("CHEST", K.prism(f"blade_au{k}", "gold", blade, 0.01, c=base, rot=(0, a, 0), axis="Y", bev=0.002))
        put("CHEST", K.prism(f"blade{k}", "lacquer", [(x * 0.62, 0.025 + z * 0.78) for x, z in blade], 0.016, c=base, rot=(0, a, 0), axis="Y", bev=0.002))
        put("CHEST", K.cyl(f"blade_lt{k}", "glow_dim", Hc + d * (Hr + 0.032), 0.006, 0.02, 10, rot=(0, a, 0)))

    # ── ARMS ──────────────────────────────────────────────────────────────
    for i, s in ((0, -1), (1, 1)):
        pv, el, wr, hp = R.pivot[i], R.elbow(i), R.wrist(i), R.handp(i)
        A, E_, W, H = f"ARM_{i}", f"ELBOW_{i}", f"WRIST_{i}", f"HAND_{i}"
        put(A, K.cyl(f"shhub{s}", "graphite", pv, 0.068, 0.12, 28, rot=(0, P / 2, 0), bev=0.01))
        put(A, K.torus(f"shring{s}", "gold", pv + V((s * 0.062, 0, 0)), 0.052, 0.005, 28, 6, rot=(0, P / 2, 0)))
        # Ō-sode: two big flat lames hung off the shoulder hub.
        sode = K.Shell([
            (pv.z - 0.36, 0.16, 0.135, 6.0, pv.x + s * 0.02, -0.01),
            (pv.z - 0.12, 0.15, 0.13, 6.0, pv.x + s * 0.015, -0.01),
            (pv.z + 0.05, 0.14, 0.125, 6.0, pv.x, -0.01),
            (pv.z + 0.11, 0.13, 0.12, 6.0, pv.x, -0.01),
        ])
        put(A, gilt(sode, f"sode_lo{s}", "lacquer", *U(s, 0.14, 0.36), 0.0, 0.52, off=0.016, th=0.016, gu=0.006, gt=0.02))
        put(A, gilt(sode, f"sode_hi{s}", "lacquer", *U(s, 0.13, 0.37), 0.44, 1.0, off=0.004, th=0.016, gu=0.006, gt=0.02))
        p, n = sode.at(0.25 * s, 0.24, 0.036)
        put(A, mon(f"sode_mon{s}", p, 0.042, rot=(P / 2, 0, -s * P / 2)))
        put(A, K.box(f"sode_hanger{s}", "graphite", pv + V((s * 0.09, 0, 0.05)), (0.06, 0.06, 0.05), bev=0.01))
        # Upper arm.
        ua = K.Shell([
            (pv.z - 0.06, 0.05, 0.054, 4.0, pv.x, 0),
            (pv.z - 0.16, 0.058, 0.064, 5.0, pv.x, 0.004),
            (pv.z - 0.33, 0.054, 0.06, 5.0, pv.x, 0.004),
            (el.z + 0.06, 0.044, 0.048, 4.0, pv.x, 0),
        ])
        put(A, ua.mesh(f"upper{s}", "graphite", 24, 8))
        put(A, gilt(ua, f"sleeve{s}", "lacquer", -0.24, 0.24, 0.22, 0.88, th=0.013, gu=0.008, gt=0.02))
        put(A, K.cyl(f"uact{s}", "graphite", pv + V((0, -0.07, -0.22)), 0.015, 0.17, 12))
        put(A, K.cyl(f"uactr{s}", "steel", pv + V((0, -0.07, -0.37)), 0.008, 0.14, 10))
        # Elbow: hub, gold rings, the cop BEHIND.
        put(E_, K.cyl(f"elhub{s}", "graphite", el, 0.05, 0.1, 24, rot=(0, P / 2, 0), bev=0.006))
        for x in (-1, 1):
            put(E_, K.torus(f"elring{s}{x}", "gold", el + V((x * 0.051, 0, 0)), 0.038, 0.004, 24, 6, rot=(0, P / 2, 0)))
        put(E_, K.box(f"elcop_au{s}", "gold", el + V((0, -0.05, -0.008)), (0.078, 0.02, 0.09), bev=0.008))
        put(E_, K.box(f"elcop{s}", "lacquer", el + V((0, -0.058, -0.008)), (0.068, 0.02, 0.08), bev=0.008))
        # Kote: the ceremonial gauntlet bracer, flaring to a bell cuff.
        fa = K.Shell([
            (el.z - 0.03, 0.046, 0.05, 4.0, el.x, 0),
            (el.z - 0.12, 0.064, 0.07, 5.0, el.x, 0.006),
            (el.z - 0.28, 0.074, 0.078, 5.0, el.x, 0.006),
            (wr.z + 0.04, 0.092, 0.094, 5.0, el.x, 0.004),
        ])
        put(E_, fa.mesh(f"fore{s}", "graphite", 24, 8))
        put(E_, gilt(fa, f"kote{s}", "lacquer", -0.3, 0.3, 0.08, 0.9, th=0.015, gu=0.008, gt=0.02))
        put(E_, gilt(fa, f"koteb{s}", "lacquer", 0.36, 0.64, 0.1, 0.9, th=0.013, gu=0.008, gt=0.02))
        put(E_, pl(fa, f"cuff_au{s}", "gold", -0.5, 0.5, 0.92, 1.0, du=32, off=0.004, th=0.012, bevel=0.3))
        put(W, K.cyl(f"wrhub{s}", "steel", wr, 0.042, 0.084, 22, rot=(0, P / 2, 0), bev=0.005))
        # Gauntlet hand: palm FRONT, four fingers curling to +Y, the thumb
        # on the OUTER edge closing across the palm.
        put(H, K.box(f"palm{s}", "graphite", hp + V((0, 0.0, -0.006)), (0.14, 0.066, 0.13), bev=0.014))
        put(H, K.box(f"tekko_au{s}", "gold", hp + V((0, -0.027, -0.002)), (0.146, 0.02, 0.128), bev=0.009))
        put(H, K.box(f"tekko{s}", "lacquer", hp + V((0, -0.035, -0.002)), (0.13, 0.016, 0.112), bev=0.009))
        put(H, mon(f"tekko_mon{s}", hp + V((0, -0.044, -0.002)), 0.026, rot=(P / 2, 0, 0)))
        put(H, K.box(f"pad{s}", "rubber", hp + V((0, 0.033, -0.012)), (0.116, 0.006, 0.1), bev=0.002))
        for k, x in enumerate((-0.051, -0.017, 0.017, 0.051)):
            kn = hp + V((x, 0.0, -0.078))
            d0 = R.digit(i, 2 * k, kn, 0.05, 1.25)
            put(d0, K.cyl(f"f{s}{k}k", "steel", kn, 0.016, 0.03, 12, rot=(0, P / 2, 0)))
            put(d0, K.box(f"f{s}{k}a", "lacquer", kn + V((0, 0.0, -0.035)), (0.03, 0.034, 0.064), bev=0.007))
            put(d0, K.box(f"f{s}{k}g", "gold", kn + V((0, -0.018, -0.016)), (0.032, 0.008, 0.034), bev=0.003))
            j = kn + V((0, 0.0, -0.07))
            d1 = R.digit(i, 2 * k + 1, j, 0.1, 1.4)
            put(d1, K.cyl(f"f{s}{k}j", "steel", j, 0.013, 0.028, 12, rot=(0, P / 2, 0)))
            put(d1, K.box(f"f{s}{k}b", "lacquer", j + V((0, 0.002, -0.029)), (0.027, 0.03, 0.056), bev=0.007))
            put(d1, K.box(f"f{s}{k}t", "gold", j + V((0, -0.004, -0.056)), (0.024, 0.026, 0.007), bev=0.002))
        th = hp + V((s * 0.078, 0.018, -0.02))
        dt_ = R.digit(i, 8, th, 0.15, 1.05)
        put(dt_, K.cyl(f"thk{s}", "steel", th, 0.015, 0.03, 12, rot=(0, P / 2, 0)))
        put(dt_, K.box(f"thumb{s}", "lacquer", th + V((s * 0.008, 0.004, -0.036)), (0.029, 0.032, 0.068), bev=0.007, rot=(0, -s * 0.25, 0)))
        put(dt_, K.box(f"thumb_g{s}", "gold", th + V((s * 0.006, -0.013, -0.022)), (0.03, 0.007, 0.03), bev=0.002, rot=(0, -s * 0.25, 0)))
    return R

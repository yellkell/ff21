"""
II — PISTONKAISER: a Kaiser Heavy Industries demolition / pile-driver mech.
A top-heavy press. A massive squared crosshead of shoulders and chest, the
widest machine at the shoulders after the fortress, rides a narrow waist and
a short telescopic jack column. The column ends in a square lift frame with
four ducted fans glowing underneath. The operator cab sits small and low,
sunk between the shoulder blocks: two rectangular lamp eyes behind a guard
cage. Twin exhaust stacks rake back off the shoulders.

Each forearm is a hydraulic pile driver. A squared housing carries a nitrogen
accumulator bottle, and a chrome ram runs out of the bottom bush into a heavy
square breaker head with a flat forged striking face. The head hangs in line
with the forearm and has no fingers.

Livery: charcoal steel. Chipped, matte safety-yellow paint goes only on the
shoulder covers and the ram heads; black/yellow hazard banding sits on the
edges. Stencils read KAISER HEAVY, 重機 and 02.
"""

import math
import random

import bmesh
from mathutils import Euler, Matrix, Vector

ACCENT = 0xFFB000


def build(K):
    P = math.pi
    hx = K.hex_rgb
    V = Vector
    K.mat("graphite", hx(0x2B2E33), metal=0.35, rough=0.46, coat=0.12, coat_rough=0.3)
    K.mat("frame", hx(0x131416), metal=0.6, rough=0.5)
    # Safety yellow: matte, no coat, lemon-leaning so it never reads as the amber glow.
    K.mat("paint_y", hx(0xD2A000), metal=0.0, rough=0.6)
    K.mat("bare", hx(0x5E6166), metal=0.9, rough=0.48)
    K.mat("chrome", hx(0xD4D8DE), metal=1.0, rough=0.07)
    K.mat("titanium", hx(0x7E838A), metal=1.0, rough=0.3)
    K.mat("rubber", hx(0x0B0B0C), metal=0.0, rough=0.75)
    K.mat("glass", hx(0x030406), metal=0.0, rough=0.03, coat=1.0)
    K.mat("ink", hx(0xE4E0D4), metal=0.0, rough=0.62)
    K.mat("ink_dark", hx(0x141518), metal=0.0, rough=0.62)
    K.mat("forged", hx(0x33363A), metal=1.0, rough=0.36)

    R = K.Rig(shoulder_z=1.22, head_z=1.44, yoke_w=0.62, head_y=0.07, core=(0, 0.214, -0.11))
    put = K.put

    # ── local helpers ────────────────────────────────────────────────────
    def frame_n(o, n, up=(0, 0, 1)):
        """A frame whose local +Y is the face normal `n` and +Z is `up`."""
        n = V(n).normalized()
        x = n.cross(V(up)).normalized()
        z = x.cross(n).normalized()
        M = Matrix((x, n, z)).transposed().to_4x4()
        M.translation = V(o)
        return M

    def clipx(poly, lo, hi):
        def clip(pp, keep, xv):
            out = []
            for k in range(len(pp)):
                a, b = pp[k], pp[(k + 1) % len(pp)]
                ia, ib = keep(a), keep(b)
                if ia:
                    out.append(a)
                if ia != ib:
                    t = (xv - a[0]) / (b[0] - a[0])
                    out.append((xv, a[1] + (b[1] - a[1]) * t))
            return out
        p = clip(poly, lambda q: q[0] >= lo - 1e-9, lo)
        p = clip(p, lambda q: q[0] <= hi + 1e-9, hi) if p else p
        dd = []
        for q in p:
            if not dd or (abs(q[0] - dd[-1][0]) > 1e-5 or abs(q[1] - dd[-1][1]) > 1e-5):
                dd.append(q)
        if len(dd) > 2 and abs(dd[0][0] - dd[-1][0]) < 1e-5 and abs(dd[0][1] - dd[-1][1]) < 1e-5:
            dd.pop()
        return dd

    def chevrons(name, M, L, W, n, th=0.003, flip=False):
        """Black/yellow hazard banding: an L x W band of diagonal stripes on a
        face (authored facing +Y, then stuck with frame M)."""
        objs = [K.box(name + "_k", "ink_dark", (0, 0, 0), (L, th, W))]
        pitch = L / n
        sl = W * 0.9 * (-1 if flip else 1)
        for k in range(-2, n + 2):
            x0 = -L / 2 + k * pitch
            poly = [(x0, -W / 2), (x0 + pitch / 2, -W / 2), (x0 + pitch / 2 + sl, W / 2), (x0 + sl, W / 2)]
            if flip:
                poly = poly[::-1]
            pp = clipx(poly, -L / 2, L / 2)
            if len(pp) >= 3:
                objs.append(K.prism(f"{name}_{k}", "paint_y", pp, th * 1.15, axis="Y"))
        o = K.join(name, objs)
        return K.stick(o, M)

    rng = random.Random(7)

    def txt(*a, **k):
        k.setdefault("font", "arialbd.ttf")
        return K.text(*a, **k)

    def chip(name, M, w, h):
        """A paint chip: an irregular scrap of bare steel on a painted face."""
        k = 9
        poly = []
        for j in range(k):
            a = j / k * 2 * P + rng.uniform(-0.2, 0.2)
            rr = rng.uniform(0.45, 1.0)
            poly.append((w / 2 * math.cos(a) * rr, h / 2 * math.sin(a) * rr))
        o = K.prism(name, "bare", poly, 0.003, axis="Y")
        return K.stick(o, M)

    def ring(name, m, prof, segs, c, rot=(0, 0, 0)):
        """A closed-profile revolve with no end caps (a duct, a lip)."""
        bm = bmesh.new()
        rows = []
        for r, z in prof:
            rows.append([bm.verts.new((r * math.sin(i / segs * 2 * P), r * math.cos(i / segs * 2 * P), z)) for i in range(segs)])
        for j in range(len(prof)):
            j2 = (j + 1) % len(prof)
            for i in range(segs):
                bm.faces.new((rows[j][i], rows[j][(i + 1) % segs], rows[j2][(i + 1) % segs], rows[j2][i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return K.place(K._obj(bm, name, m, 50), c, rot)

    def axis_of(rot):
        return Euler(rot).to_matrix() @ V((0, 0, 1))

    # ── TORSO: the crosshead's heart, flaring up from a narrow waist ──────
    torso = K.Shell([
        (0.82, 0.10, 0.10, 6.0, 0, 0.0),
        (0.86, 0.135, 0.14, 10.0, 0, 0.005),
        (0.97, 0.225, 0.18, 14.0, 0, 0.012),
        (1.12, 0.315, 0.19, 14.0, 0, 0.015),
        (1.30, 0.34, 0.19, 14.0, 0, 0.015),
        (1.38, 0.32, 0.18, 12.0, 0, 0.01),
        (1.41, 0.22, 0.12, 6.0, 0, 0.0),
    ])
    put("CHEST", torso.mesh("torso", "frame", 56, 22))
    put("CHEST", torso.plate("chest_plate", "graphite", -0.115, 0.115, 0.36, 0.8, off=0.004, th=0.02, cw=0.014, nu=16, nt=8))
    put("CHEST", torso.plate("belly", "graphite", -0.16, 0.16, 0.1, 0.33, off=0.004, th=0.016, cw=0.012, nu=22, nt=4))
    for s in (-1, 1):
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put("CHEST", torso.plate(f"flank{s}", "graphite", *u(0.14, 0.36), 0.36, 0.8, off=0.004, th=0.018, cw=0.012, nu=16, nt=8))
    put("CHEST", torso.strip("belly_lt", "glow", -0.1, 0.1, 0.338, 0.35, off=0.006))
    # Core: an octagonal lamp in a heavy machined bezel.
    cc = R.core
    octo = [(math.cos(a), math.sin(a)) for a in (k * P / 4 + P / 8 for k in range(8))]
    put("CHEST", K.prism("core_bezel", "titanium", [(x * 0.085, z * 0.085) for x, z in octo], 0.03, c=cc - V((0, 0.004, 0)), axis="Y", bev=0.006))
    put("CHEST", K.prism("core_well", "frame", [(x * 0.07, z * 0.07) for x, z in octo], 0.03, c=cc + V((0, 0.004, 0)), axis="Y"))
    put("CORE", K.prism("core_lens", "core", [(x * 0.06, z * 0.06) for x, z in octo], 0.02, c=cc + V((0, 0.012, 0)), axis="Y"))
    put("CHEST", K.bolts("core_bolts", "titanium", [cc + V((0.077 * math.cos(a), 0.012, 0.077 * math.sin(a))) for a in (k * P / 4 for k in range(8))], r=0.006, h=0.004))
    pk = torso.at(0, 0.73, 0.0265)[0]
    put("CHEST", txt("kaiser", "ink", "KAISER HEAVY", 0.034, c=pk, rot=(P / 2, 0, P), spacing=1.1, extrude=0.0))
    # Hazard banding along the chest plate's lower edge.
    pb = torso.at(0, 0.385, 0.025)[0]
    put("CHEST", chevrons("chest_hz", frame_n(pb, (0, 1, 0.12)), 0.27, 0.028, 7))
    # Back: the hydraulic power pack, one grille and a light line.
    put("CHEST", K.box("pack", "graphite", (0, -0.215, 1.1), (0.34, 0.1, 0.3), bev=0.02))
    put("CHEST", K.vents("pack_vent", "frame", (0, -0.268, 1.13), 0.24, 0.15, 7, depth=0.014, rot=(0, 0, P)))
    put("CHEST", K.box("pack_lt", "glow", (0, -0.267, 1.0), (0.24, 0.006, 0.008)))
    put("CHEST", txt("pack_txt", "ink", "KAISER HEAVY INDUSTRIES  K-HD 02", 0.014, c=(0, -0.2662, 1.225), rot=(P / 2, 0, 0), extrude=0.0))
    put("CHEST", K.bolts("pack_bolts", "titanium", [(x, -0.266, z) for x in (-0.15, 0.15) for z in (0.97, 1.23)], normal=(0, -1, 0)))
    # The crosshead beam tying both shoulder blocks together behind the cab.
    put("CHEST", K.box("crosshead", "graphite", (0, -0.1, 1.45), (0.42, 0.2, 0.16), bev=0.02))
    put("CHEST", K.box("crosshead_lt", "glow", (0, -0.001, 1.452), (0.2, 0.006, 0.008)))
    # Turret ring the cab sits on.
    put("CHEST", K.cyl("cab_ring", "frame", (0, 0.05, 1.375), 0.1, 0.03, 32, bev=0.005))
    put("CHEST", K.torus("cab_ring_lt", "glow_dim", (0, 0.05, 1.392), 0.094, 0.003, 32, 6))

    # ── SHOULDER BLOCKS: the press crosshead, painted, over each arm ──────
    for i, s in ((0, -1), (1, 1)):
        bx = s * 0.39
        # dark structural band under the yellow cover, carrying the lamp
        put("CHEST", K.box(f"sh_band{s}", "frame", (bx, 0.0, 1.372), (0.4, 0.4, 0.062), bev=0.012))
        put("CHEST", K.box(f"sh_cover{s}", "paint_y", (bx, 0.005, 1.49), (0.43, 0.41, 0.19), bev=0.022, segs=2, taper=(0.95, 0.8)))
        # inboard bearing housing under the block, the arm hub runs in it
        pv = R.pivot[i]
        put("CHEST", K.cyl(f"sh_bear{s}", "graphite", V((s * 0.345, 0, pv.z)), 0.095, 0.1, 28, rot=(0, P / 2, 0), bev=0.01))
        # lamp in a titanium bezel on the band front
        lc = V((s * 0.38, 0.205, 1.372))
        put("CHEST", K.box(f"sh_bezel{s}", "titanium", lc - V((0, 0.006, 0)), (0.1, 0.014, 0.05), bev=0.005))
        put(f"SHOULDER_{i}", K.box(f"sh_lamp{s}", f"shoulder_{i}", lc + V((0, 0.003, 0)), (0.084, 0.008, 0.034), bev=0.003))
        # hazard banding on the band's outer face
        put("CHEST", chevrons(f"sh_hz{s}", frame_n((s * 0.592, 0.0, 1.372), (s, 0, 0)), 0.36, 0.04, 8, flip=s < 0))
        # The cover is a casting: its front slopes back, its flanks draw in.
        sa, sb = math.atan(0.041 / 0.19), math.atan(0.011 / 0.19)
        fy = lambda z: 0.21 - 0.041 * (z - 1.395) / 0.19
        fx = lambda z: s * (0.605 - 0.011 * (z - 1.395) / 0.19)
        nf = (0, math.cos(sa), math.sin(sa))
        no = (s * math.cos(sb), 0, math.sin(sb))
        # stencils
        put("CHEST", txt(f"sh_no{s}", "ink_dark", "02" if s < 0 else "K-HD", 0.09 if s < 0 else 0.055, c=(bx + s * 0.03, fy(1.48) + 0.0015, 1.48), rot=(P / 2 - sa, 0, P), extrude=0.0))
        put("CHEST", txt(f"sh_kanji{s}", "ink_dark", "重機", 0.085, c=(fx(1.48) + s * 0.0015, 0.0, 1.48), rot=(P / 2 - sb, 0.0, s * P / 2), font="YuGothB.ttc", extrude=0.0))
        put("CHEST", K.bolts(f"sh_bolts{s}", "titanium", [(bx + dx, fy(z), z) for dx in (-0.17, 0.17) for z in (1.425, 1.55)], r=0.009, normal=nf))
        # paint chips, worn where things hit it
        for k, (o, n, w, h) in enumerate((
            ((bx + s * 0.15, fy(1.555) + 0.0005, 1.555), nf, 0.05, 0.022),
            ((bx - s * 0.11, fy(1.43) + 0.0005, 1.43), nf, 0.03, 0.016),
            ((bx + s * 0.05, 0.12, 1.5855), (0, 0, 1), 0.06, 0.02),
            ((bx - s * 0.12, -0.1, 1.5855), (0, 0, 1), 0.035, 0.015),
            ((fx(1.43) + s * 0.0005, 0.15, 1.43), no, 0.04, 0.02),
            ((fx(1.55) + s * 0.0005, -0.13, 1.55), no, 0.03, 0.014),
        )):
            up = (0, 1, 0) if n == (0, 0, 1) else (0, 0, 1)
            put("CHEST", chip(f"sh_chip{s}{k}", frame_n(o, n, up), w, h))

        # ── EXHAUST STACK raking back off the shoulder; its mouth is the pod
        base = V((s * 0.31, -0.215, 1.47))
        put("CHEST", K.box(f"st_base{s}", "frame", base + V((0, -0.01, 0)), (0.13, 0.08, 0.13), bev=0.015))
        rot = (0.36, s * 0.09, 0)
        d = axis_of(rot)
        put("CHEST", K.cyl(f"stack{s}", "forged", base + d * 0.2, 0.048, 0.4, 24, rot=rot, open_ends=True))
        put("CHEST", K.cyl(f"stack_in{s}", "frame", base + d * 0.2, 0.042, 0.4, 20, rot=rot, open_ends=True))
        top = base + d * 0.4
        put("CHEST", ring(f"stack_lip{s}", "titanium", [(0.042, -0.012), (0.056, -0.012), (0.058, 0.004), (0.046, 0.006)], 24, top, rot))
        put("CHEST", K.cyl(f"pod{s}", f"pod_{i}", top - d * 0.03, 0.042, 0.006, 20, rot=rot))
        for k, t in enumerate((0.1, 0.3)):
            put("CHEST", K.torus(f"st_clamp{s}{k}", "titanium", base + d * t, 0.052, 0.006, 24, 6, rot=rot))

    # ── HEAD: a small armoured operator cab sunk between the shoulders ────
    hc = R.head
    cab = K.Shell([
        (hc.z - 0.07, 0.08, 0.08, 6.0, 0, hc.y - 0.01),
        (hc.z - 0.05, 0.1, 0.1, 9.0, 0, hc.y),
        (hc.z + 0.035, 0.1, 0.1, 9.0, 0, hc.y - 0.004),
        (hc.z + 0.062, 0.094, 0.094, 8.0, 0, hc.y - 0.012),
        (hc.z + 0.072, 0.06, 0.06, 4.0, 0, hc.y - 0.016),
    ])
    put("HEAD", cab.mesh("cab", "frame", 40, 20))
    put("HEAD", cab.plate("cab_roof", "graphite", -0.5, 0.5, 0.74, 1.0, off=0.003, th=0.016, cw=0.012, nu=40, nt=4))
    put("HEAD", cab.plate("windscreen", "glass", -0.105, 0.105, 0.2, 0.7, off=0.003, th=0.008, bevel=0.6, nu=8, nt=4))
    for s in (-1, 1):
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put("HEAD", cab.plate(f"cab_side{s}", "graphite", *u(0.14, 0.43), 0.08, 0.7, off=0.003, th=0.014, cw=0.01, nu=12, nt=5))
    front = cab.at(0, 0.45)[0].y
    ez = hc.z + 0.004
    for k, s in enumerate((-1, 1)):
        e = V((s * 0.045, front + 0.012, ez))
        put("HEAD", K.box(f"eframe{s}", "titanium", e - V((0, 0.004, 0)), (0.07, 0.01, 0.04), bev=0.004))
        put(f"EYE_{k}", K.box(f"eye{k}", "visor", e + V((0, 0.003, 0)), (0.058, 0.008, 0.028), bev=0.002))
    R.extra.append(("EYEFX", V((0, front + 0.06, ez)), "HEAD"))
    # guard cage: two horizontal bars across the screen, posts at the sides
    gy = front + 0.03
    for k, z in enumerate((ez + 0.026, ez - 0.026)):
        put("HEAD", K.cyl(f"guard{k}", "titanium", (0, gy, z), 0.0065, 0.2, 12, rot=(0, P / 2, 0)))
    for s in (-1, 1):
        put("HEAD", K.box(f"post{s}", "graphite", (s * 0.1, gy - 0.012, ez), (0.016, 0.04, 0.09), bev=0.004))
    put("HEAD", cab.strip("cab_brow", "glow_dim", -0.1, 0.1, 0.705, 0.72, off=0.012))
    put("HEAD", K.cyl("beacon_base", "frame", (0.05, hc.y - 0.05, hc.z + 0.09), 0.014, 0.012, 14))
    put("HEAD", K.cyl("beacon", "lamp_white", (0.05, hc.y - 0.05, hc.z + 0.1), 0.01, 0.012, 14))
    put("HEAD", K.cyl("mast", "titanium", (-0.06, hc.y - 0.06, hc.z + 0.12), 0.003, 0.1, 6))

    # ── WAIST: slew bearing and a narrow column, two struts ───────────────
    put("TITAN", K.cyl("slew", "graphite", (0, 0, 0.675), 0.115, 0.035, 32, bev=0.006))
    put("TITAN", K.torus("slew_lt", "glow_dim", (0, 0, 0.695), 0.105, 0.003, 32, 6))
    put("TITAN", K.cyl("waist", "frame", (0, 0, 0.76), 0.072, 0.16, 24))
    for k, z in enumerate((0.705, 0.815)):
        put("TITAN", K.cyl(f"waist_f{k}", "graphite", (0, 0, z), 0.088, 0.018, 24, bev=0.004))
        put("TITAN", K.bolts(f"waist_b{k}", "titanium", [(0.08 * math.cos(a), 0.08 * math.sin(a), z + 0.009) for a in (j * P / 4 + P / 8 for j in range(8))], r=0.006, h=0.004, normal=(0, 0, 1)))
    for s in (-1, 1):
        put("TITAN", K.cyl(f"w_sleeve{s}", "graphite", (s * 0.105, 0.03, 0.73), 0.02, 0.1, 14, bev=0.003))
        put("TITAN", K.cyl(f"w_rod{s}", "chrome", (s * 0.105, 0.03, 0.83), 0.011, 0.12, 12))
        put("TITAN", K.cyl(f"w_eye{s}", "titanium", (s * 0.105, 0.03, 0.885), 0.017, 0.022, 12, rot=(0, P / 2, 0)))

    # ── PELVIS: a squared girdle, the low lamp in an octagon bezel ────────
    put("TITAN", K.box("pelvis", "frame", (0, 0, 0.545), (0.35, 0.25, 0.21), bev=0.02, taper=(0.74, 1.0), rot=(0, P, 0)))
    put("TITAN", K.box("girdle", "graphite", (0, 0.132, 0.552), (0.24, 0.022, 0.16), bev=0.008, taper=(0.86, 1.0), rot=(0, P, 0)))
    put("TITAN", K.box("girdle_b", "graphite", (0, -0.132, 0.552), (0.24, 0.022, 0.16), bev=0.008, taper=(0.86, 1.0), rot=(0, P, 0)))
    put("TITAN", K.box("pel_lip", "graphite", (0, 0, 0.652), (0.36, 0.26, 0.016), bev=0.005))
    put("TITAN", K.box("pel_lt", "glow", (0, 0.127, 0.642), (0.3, 0.004, 0.005)))
    lc = V((0, 0.153, 0.53))
    put("TITAN", K.prism("low_bezel", "titanium", [(x * 0.06, z * 0.06) for x, z in octo], 0.02, c=lc - V((0, 0.004, 0)), axis="Y", bev=0.004))
    put("LOW", K.prism("low_lamp", "low", [(x * 0.045, z * 0.045) for x, z in octo], 0.012, c=lc + V((0, 0.008, 0)), axis="Y"))
    put("TITAN", txt("pel_txt", "ink", "MAX 2400 kN", 0.016, c=(0, 0.1436, 0.6), rot=(P / 2, 0, P), extrude=0.0))

    # ── JACK COLUMN: a short telescopic ram down to the lift frame ────────
    put("TITAN", K.cyl("jack0", "graphite", (0, 0, 0.41), 0.105, 0.08, 32, bev=0.008))
    put("TITAN", K.cyl("jack1", "chrome", (0, 0, 0.335), 0.085, 0.09, 32))
    put("TITAN", K.cyl("jack1c", "titanium", (0, 0, 0.375), 0.092, 0.014, 32, bev=0.003))
    put("TITAN", K.cyl("jack2", "chrome", (0, 0, 0.265), 0.07, 0.08, 28))
    put("TITAN", K.cyl("jack2c", "titanium", (0, 0, 0.3), 0.077, 0.012, 28, bev=0.003))
    put("TITAN", K.cyl("jack_foot", "graphite", (0, 0, 0.22), 0.095, 0.04, 28, bev=0.006))

    # ── LIFT FRAME: box beams between four ducted fans, each canted out ──
    F, fz, DR = 0.25, 0.18, 0.112
    for k, (c, sz) in enumerate((((0, F, fz), (2 * F - 2 * DR + 0.02, 0.06, 0.065)), ((0, -F, fz), (2 * F - 2 * DR + 0.02, 0.06, 0.065)),
                                 ((F, 0, fz), (0.06, 2 * F - 2 * DR + 0.02, 0.065)), ((-F, 0, fz), (0.06, 2 * F - 2 * DR + 0.02, 0.065)),
                                 ((0, 0, fz), (2 * F, 0.05, 0.05)), ((0, 0, fz), (0.05, 2 * F, 0.05)))):
        put("TITAN", K.box(f"beam{k}", "graphite" if k < 4 else "frame", c, sz, bev=0.008))
    put("TITAN", K.box("frame_hub", "graphite", (0, 0, fz), (0.16, 0.16, 0.07), bev=0.012))
    put("TITAN", chevrons("frame_hz_f", frame_n((0, F + 0.031, fz), (0, 1, 0)), 0.24, 0.04, 6))
    put("TITAN", chevrons("frame_hz_b", frame_n((0, -F - 0.031, fz), (0, -1, 0)), 0.24, 0.04, 6))
    for s in (-1, 1):
        put("TITAN", chevrons(f"frame_hz{s}", frame_n((s * (F + 0.031), 0, fz), (s, 0, 0)), 0.24, 0.04, 6))
    duct = [(0.088, -0.05), (0.1, -0.05), (0.103, 0.028), (0.114, 0.04), (0.114, 0.05), (0.088, 0.05)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            fc = V((sx * F, sy * F, fz))
            nm = f"{sx}{sy}"
            rf = (sy * 0.16, -sx * 0.16, 0)
            Mf = Euler(rf).to_matrix()
            at = lambda o: fc + Mf @ V(o)
            put("TITAN", ring(f"duct{nm}", "graphite", duct, 28, fc, rf))
            put("TITAN", K.cyl(f"fhub{nm}", "frame", at((0, 0, 0.005)), 0.03, 0.06, 18, rot=rf, bev=0.006))
            for k in range(3):
                a = k * 2 * P / 3 + P / 6
                ra = (Mf @ Euler((0, 0, a)).to_matrix()).to_euler()
                put("TITAN", K.box(f"stator{nm}{k}", "frame", at((0.06 * math.cos(a), 0.06 * math.sin(a), 0.02)), (0.06, 0.008, 0.02), rot=ra))
            put("TITAN", K.cyl(f"rotor{nm}", "frame", at((0, 0, -0.005)), 0.087, 0.006, 24, rot=rf))
            put("TITAN", K.cyl(f"fglow{nm}", "glow", at((0, 0, -0.035)), 0.088, 0.004, 24, rot=rf))
            put("TITAN", K.torus(f"flip{nm}", "glow", at((0, 0, -0.052)), 0.094, 0.004, 28, 6, rot=rf))
            put("TITAN", K.torus(f"ftop{nm}", "glow_dim", at((0, 0, 0.044)), 0.09, 0.003, 28, 6, rot=rf))

    # ── ARMS ─────────────────────────────────────────────────────────────
    for i, s in ((0, -1), (1, 1)):
        pv, el, wr, hp = R.pivot[i], R.elbow(i), R.wrist(i), R.handp(i)
        A, E_, W, H = f"ARM_{i}", f"ELBOW_{i}", f"WRIST_{i}", f"HAND_{i}"
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        x = pv.x
        # shoulder hub, running in the chest's bearing housing
        put(A, K.cyl(f"shhub{s}", "titanium", V((s * 0.46, 0, pv.z)), 0.08, 0.13, 28, rot=(0, P / 2, 0), bev=0.01))
        put(A, K.cyl(f"shcap{s}", "graphite", V((s * 0.53, 0, pv.z)), 0.062, 0.025, 28, rot=(0, P / 2, 0), bev=0.006))
        put(A, K.torus(f"shring{s}", "glow_dim", V((s * 0.544, 0, pv.z)), 0.048, 0.004, 28, 6, rot=(0, P / 2, 0)))
        # upper arm: a squared beam, one sleeve plate, an exposed actuator
        ua = K.Shell([
            (pv.z - 0.04, 0.06, 0.068, 6.0, x, 0),
            (pv.z - 0.12, 0.072, 0.08, 8.0, x, 0),
            (pv.z - 0.36, 0.068, 0.076, 8.0, x, 0),
            (el.z + 0.06, 0.055, 0.06, 6.0, x, 0),
        ])
        put(A, ua.mesh(f"upper{s}", "frame", 32, 10))
        put(A, ua.plate(f"sleeve{s}", "graphite", -0.36, 0.36, 0.2, 0.86, off=0.004, th=0.016, cw=0.012, nu=24, nt=5))
        put(A, K.box(f"armlt{s}", "glow", V((x + s * 0.0925, 0, pv.z - 0.24)), (0.004, 0.008, 0.24)))
        put(A, K.box(f"uact_lug{s}", "graphite", V((x, 0.09, pv.z - 0.1)), (0.05, 0.04, 0.04), bev=0.006))
        put(A, K.cyl(f"uact{s}", "graphite", V((x, 0.105, pv.z - 0.2)), 0.024, 0.18, 16, bev=0.004))
        put(A, K.cyl(f"uactr{s}", "chrome", V((x, 0.105, pv.z - 0.355)), 0.013, 0.14, 12))
        put(A, K.cyl(f"uact_eye{s}", "titanium", V((x, 0.105, el.z + 0.07)), 0.02, 0.03, 14, rot=(0, P / 2, 0)))
        put(A, K.tube(f"uhose{s}", "rubber", [V((x + s * 0.05, -0.04, pv.z - 0.08)), V((x + s * 0.075, -0.02, pv.z - 0.25)), V((x + s * 0.07, 0.0, el.z + 0.1))], 0.008, 8, 6))
        # elbow: a heavy hub, its cop on the BACK
        put(E_, K.cyl(f"elhub{s}", "titanium", el, 0.062, 0.16, 26, rot=(0, P / 2, 0), bev=0.008))
        for xx in (-1, 1):
            put(E_, K.cyl(f"elcap{s}{xx}", "graphite", el + V((xx * 0.085, 0, 0)), 0.05, 0.016, 24, rot=(0, P / 2, 0), bev=0.004))
        put(E_, K.box(f"elcop{s}", "graphite", el + V((0, -0.06, -0.01)), (0.11, 0.03, 0.1), bev=0.01))

        # ── PILE-DRIVER FOREARM: a squared housing, chrome ram out the bottom
        zt, zb = el.z - 0.065, wr.z + 0.04
        zm, hh = (zt + zb) / 2, zt - zb
        put(E_, K.box(f"housing{s}", "frame", V((x, 0, zm)), (0.19, 0.2, hh), bev=0.012))
        put(E_, K.box(f"hous_top{s}", "frame", V((x, 0, zt + 0.02)), (0.19, 0.2, 0.04), taper=(0.62, 0.62), bev=0.01))
        put(E_, K.box(f"hous_foot{s}", "graphite", V((x, 0, zb - 0.005)), (0.2, 0.21, 0.03), taper=(1.0, 1.0), bev=0.008))
        # front: two armour plates either side of a channel; the chrome ram
        # runs down it, clamped at the top, into the bottom bush
        for xx in (-1, 1):
            put(E_, K.box(f"fa_front{s}{xx}", "graphite", V((x + xx * 0.06, 0.105, zm + 0.01)), (0.07, 0.022, hh - 0.03), bev=0.008, segs=2))
            put(E_, K.box(f"fa_side{s}{xx}", "graphite", V((x + xx * 0.1, -0.005, zm + 0.01)), (0.022, 0.17, hh - 0.03), bev=0.008, segs=2))
        put(E_, K.cyl(f"fa_ram{s}", "chrome", V((x, 0.1, zm)), 0.021, hh - 0.02, 16))
        for z in (zt - 0.025, zb + 0.06):
            put(E_, K.box(f"fa_clamp{s}{z:.2f}", "titanium", V((x, 0.103, z)), (0.06, 0.03, 0.022), bev=0.005))
        put(E_, chevrons(f"fa_hz{s}", frame_n((x, 0.106, zb - 0.005), (0, 1, 0)), 0.2, 0.026, 6, flip=s < 0))
        put(E_, txt(f"fa_txt{s}", "ink", "PD-40", 0.022, c=V((x + s * 0.06, 0.1165, zt - 0.06)), rot=(P / 2, 0, P), extrude=0.0))
        put(E_, txt(f"fa_txt2{s}", "ink", "KHI", 0.022, c=V((x - s * 0.06, 0.1165, zt - 0.06)), rot=(P / 2, 0, P), extrude=0.0))
        put(E_, K.box(f"fa_lt{s}", "glow", V((x + s * 0.1115, -0.005, zm + 0.01)), (0.003, 0.008, hh - 0.08)))
        # N2 accumulator bottle on the back-outer corner, strapped, hosed in
        ab = V((x + s * 0.07, -0.135, (el.z + wr.z) / 2 + 0.0))
        put(E_, K.lathe(f"accu{s}", "titanium", [(0.0, -0.13), (0.024, -0.125), (0.04, -0.1), (0.042, -0.08), (0.042, 0.08), (0.04, 0.1), (0.024, 0.125), (0.012, 0.13), (0.0, 0.13)], 22, c=ab))
        put(E_, K.cyl(f"accu_band{s}", "paint_y", ab + V((0, 0, 0.04)), 0.0425, 0.03, 22, open_ends=True))
        for k, dz in enumerate((-0.06, 0.06)):
            put(E_, K.torus(f"accu_strap{s}{k}", "frame", ab + V((0, 0, dz)), 0.044, 0.005, 22, 6))
        put(E_, K.tube(f"accu_hose{s}", "rubber", [ab + V((0, 0, 0.13)), ab + V((-s * 0.01, 0.02, 0.165)), V((x + s * 0.06, -0.06, el.z - 0.06))], 0.009, 8, 6))
        put(E_, K.cyl(f"accu_valve{s}", "chrome", ab + V((0, 0, 0.137)), 0.008, 0.016, 10))
        # wrist: the guide bush the ram runs in
        put(W, K.cyl(f"bush{s}", "titanium", wr + V((0, 0, 0.012)), 0.07, 0.05, 28, bev=0.006))
        put(W, K.cyl(f"wiper{s}", "rubber", wr + V((0, 0, -0.018)), 0.052, 0.012, 24))
        put(W, K.bolts(f"bush_bolts{s}", "frame", [wr + V((0.062 * math.cos(a), 0.062 * math.sin(a), 0.037)) for a in (k * P / 3 for k in range(6))], r=0.007, normal=(0, 0, 1)))

        # ── BREAKER HEAD, in line with the forearm, flat face down ───────
        put(H, K.cyl(f"ram{s}", "chrome", hp + V((0, 0, 0.07)), 0.042, 0.14, 24))
        put(H, K.cyl(f"ram_clamp{s}", "graphite", hp + V((0, 0, -0.012)), 0.062, 0.036, 24, bev=0.006))
        hb = hp + V((0, 0, -0.105))
        put(H, K.box(f"head{s}", "paint_y", hb, (0.18, 0.18, 0.15), bev=0.022, segs=3))
        put(H, K.box(f"head_seam{s}", "frame", hb + V((0, 0, 0.037)), (0.184, 0.184, 0.007)))
        for k, (n, up, c) in enumerate((((0, 1, 0), (0, 0, 1), hb + V((0, 0.0903, -0.034))), ((0, -1, 0), (0, 0, 1), hb + V((0, -0.0903, -0.034))),
                                        ((1, 0, 0), (0, 0, 1), hb + V((0.0903, 0, -0.034))), ((-1, 0, 0), (0, 0, 1), hb + V((-0.0903, 0, -0.034))))):
            put(H, chevrons(f"head_hz{s}{k}", frame_n(c, n, up), 0.13, 0.026, 5, flip=(k % 2 == 1)))
        put(H, K.box(f"face{s}", "forged", hb + V((0, 0, -0.09)), (0.196, 0.196, 0.035), bev=0.01))
        put(H, K.bolts(f"face_bolts{s}", "titanium", [hb + V((dx, 0.099, -0.09)) for dx in (-0.07, 0, 0.07)], r=0.007))
        put(H, txt(f"head_no{s}", "ink_dark", "02", 0.06, c=hb + V((0, 0.0905, 0.004)), rot=(P / 2, 0, P), extrude=0.0))
        put(H, txt(f"head_side{s}", "ink_dark", "60 kJ", 0.024, c=hb + V((s * 0.0905, 0, 0.006)), rot=(P / 2, 0, s * P / 2), extrude=0.0))
        for k, (o, n, w, h) in enumerate((
            (hb + V((s * 0.05, 0.0905, 0.05)), (0, 1, 0), 0.035, 0.012),
            (hb + V((-s * 0.06, 0.0905, -0.008)), (0, 1, 0), 0.02, 0.012),
            (hb + V((s * 0.0905, 0.045, 0.049)), (s, 0, 0), 0.03, 0.01),
            (hb + V((-s * 0.0905, -0.04, 0.02)), (-s, 0, 0), 0.025, 0.012),
        )):
            put(H, chip(f"head_chip{s}{k}", frame_n(o, n), w, h))
    return R

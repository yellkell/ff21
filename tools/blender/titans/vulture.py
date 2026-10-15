"""
III — THE VULTURE: a corporate black-ops recon/strike mech built like a
stealth aircraft. Every surface is a flat plane — chined, faceted armour in
matte radar-absorbent black over a dark gunmetal frame, a few dark-olive
panels, tiny low-visibility grey markings. Slim and tall: a deep keeled
chest tapering to a wasp waist, a faceted tail closing on a 2-D vectoring
nozzle with three swept vanes. The head is a long sensor turret with ONE
big camera lens (the beam source) under a hooded brow and a hooked beak.
The signature is the wings: a gimballed spar off each shoulder blade, a
wrist joint half way out, and long knife-edged ECM vanes hanging off both
spars, longest at the tip, each tipped with a dim ember.

Talon hands hang ALONG the forearm, palm to the front; the three claws
curl toward +Y (closed positive).
"""

import math

import bmesh
from mathutils import Matrix, Vector

ACCENT = 0x7CFF4A


def build(K):
    P = math.pi
    hx = K.hex_rgb
    V = Vector
    K.mat("ram", hx(0x141518), metal=0.1, rough=0.66)
    K.mat("ram_b", hx(0x1F2125), metal=0.15, rough=0.55)
    K.mat("frame", hx(0x08090A), metal=0.4, rough=0.5)
    K.mat("gunmetal", hx(0x474B52), metal=0.85, rough=0.36)
    K.mat("olive", hx(0x2B3125), metal=0.05, rough=0.56)
    K.mat("titanium", hx(0x7A7F87), metal=1.0, rough=0.3)
    K.mat("chrome", hx(0xC8CCD2), metal=1.0, rough=0.1)
    K.mat("rubber", hx(0x0A0A0B), metal=0.0, rough=0.8)
    K.mat("glass", hx(0x030406), metal=0.0, rough=0.03, coat=1.0)
    K.mat("ink", hx(0x62666D), metal=0.0, rough=0.6)
    put = K.put

    # ── the faceting workshop ────────────────────────────────────────────
    def fr(o, axis, front):
        """A frame: local z along `axis`, local y toward `front`."""
        z = V(axis).normalized()
        y = V(front)
        y = (y - z * y.dot(z)).normalized()
        x = y.cross(z)
        M = Matrix((x, y, z)).transposed().to_4x4()
        M.translation = V(o)
        return M

    class Facet(K.Shell):
        """A chined, flat-planed loft. Sections are (h, half, ox, oy): `half`
        runs from the front centre (x=0) round the +x side to the back
        centre (x=0) and is mirrored; sections are joined by straight
        planes (no smoothing anywhere). Same u/t API as Shell, so plates,
        strips and frame_at conform to the facets."""

        def __init__(self, secs, M=None):
            self.S = []
            for s in secs:
                h, half = s[0], s[1]
                ox = s[2] if len(s) > 2 else 0.0
                oy = s[3] if len(s) > 3 else 0.0
                pts = list(half) + [(-x, y) for x, y in reversed(half[1:-1])]
                self.S.append((h, [V((x + ox, y + oy)) for x, y in pts]))
            self.N = len(self.S[0][1])
            self.M = M or Matrix.Identity(4)

        def _ti(self, t):
            t = max(0.0, min(1.0, t))
            f = t * (len(self.S) - 1)
            i = min(int(f), len(self.S) - 2)
            return i, f - i

        def _ring(self, u, pts):
            f = (u % 1.0) * self.N
            j = int(f) % self.N
            return pts[j].lerp(pts[(j + 1) % self.N], f - int(f))

        def _raw(self, u, t):
            i, k = self._ti(t)
            (h0, p0), (h1, p1) = self.S[i], self.S[i + 1]
            p = self._ring(u, p0).lerp(self._ring(u, p1), k)
            return V((p.x, p.y, h0 + (h1 - h0) * k))

        def centre(self, t):
            i, k = self._ti(t)
            (h0, p0), (h1, p1) = self.S[i], self.S[i + 1]
            c = (sum(p0, V((0, 0))) / self.N).lerp(sum(p1, V((0, 0))) / self.N, k)
            return V((c.x, c.y, h0 + (h1 - h0) * k))

        def normal_local(self, u, t):
            e = 1e-3
            du = self._raw(u + e, t) - self._raw(u - e, t)
            dt = self._raw(u, min(1, t + e)) - self._raw(u, max(0, t - e))
            n = du.cross(dt)
            r = self._raw(u, t) - self.centre(t)
            if n.length < 1e-12:
                return r.normalized()
            n.normalize()
            return -n if n.dot(r) < 0 else n

        def local(self, u, t, off=0.0):
            p = self._raw(u, t)
            return p + self.normal_local(u, t) * off if off else p

        def mesh(self, name, m, caps=(True, True), bev=0.0, smooth=14):
            bm = bmesh.new()
            rows = [[bm.verts.new(self.M @ V((p.x, p.y, h))) for p in pts] for h, pts in self.S]
            N = self.N
            for a, b in zip(rows, rows[1:]):
                for j in range(N):
                    bm.faces.new((a[j], a[(j + 1) % N], b[(j + 1) % N], b[j]))
            if caps[0]:
                bm.faces.new(rows[0])
            if caps[1]:
                bm.faces.new(rows[-1])
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            if bev:
                bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
            return K._obj(bm, name, m, smooth)

        def plate(self, name, m, u0, u1, t0, t1, off=0.004, th=0.012, nu=None, nt=None, bevel=0.5, cw=None, smooth=14):
            cw = th if cw is None else cw
            tm, um = (t0 + t1) / 2, (u0 + u1) / 2

            def rate_u(u):
                return (self._raw(u + 1e-3, tm) - self._raw(u - 1e-3, tm)).length / 2e-3

            def rate_t(t):
                a, b = max(0, t - 1e-3), min(1, t + 1e-3)
                return (self._raw(um, b) - self._raw(um, a)).length / max(b - a, 1e-9)

            def samples(a0, a1, step, e0, e1):
                s = {a0, a1}
                if bevel:
                    s |= {a0 + e0, a1 - e1}
                for k in range(math.floor(a0 * step) + 1, math.ceil(a1 * step)):
                    if a0 + 1e-6 < k / step < a1 - 1e-6:
                        s.add(k / step)
                out = sorted(s)
                d = [out[0]]
                for x in out[1:]:
                    if x - d[-1] > 1e-5:
                        d.append(x)
                return d

            eu0 = min(0.3 * (u1 - u0), cw / max(rate_u(u0), 1e-6))
            eu1 = min(0.3 * (u1 - u0), cw / max(rate_u(u1), 1e-6))
            et0 = min(0.3 * (t1 - t0), cw / max(rate_t(t0), 1e-6))
            et1 = min(0.3 * (t1 - t0), cw / max(rate_t(t1), 1e-6))
            us = samples(u0, u1, self.N, eu0, eu1)
            ts = samples(t0, t1, len(self.S) - 1, et0, et1)
            NU, NT = len(us) - 1, len(ts) - 1
            bm = bmesh.new()
            outer, inner = [], []
            for j, t in enumerate(ts):
                ro, ri = [], []
                for i, u in enumerate(us):
                    edge = i in (0, NU) or j in (0, NT)
                    ro.append(bm.verts.new(self.M @ self.local(u, t, off + th * (1 - bevel if edge else 1))))
                    ri.append(bm.verts.new(self.M @ self.local(u, t, off)))
                outer.append(ro)
                inner.append(ri)
            for j in range(NT):
                for i in range(NU):
                    bm.faces.new((outer[j][i], outer[j][i + 1], outer[j + 1][i + 1], outer[j + 1][i]))
                    bm.faces.new((inner[j][i], inner[j + 1][i], inner[j + 1][i + 1], inner[j][i + 1]))
            ro = [outer[0][i] for i in range(NU + 1)] + [outer[j][NU] for j in range(1, NT + 1)] + [outer[NT][i] for i in range(NU - 1, -1, -1)] + [outer[j][0] for j in range(NT - 1, 0, -1)]
            ri = [inner[0][i] for i in range(NU + 1)] + [inner[j][NU] for j in range(1, NT + 1)] + [inner[NT][i] for i in range(NU - 1, -1, -1)] + [inner[j][0] for j in range(NT - 1, 0, -1)]
            for k in range(len(ro)):
                k2 = (k + 1) % len(ro)
                bm.faces.new((ro[k], ri[k], ri[k2], ro[k2]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            return K._obj(bm, name, m, smooth)

    def stk(o, M):
        """Stick an object (authored about the origin, facing +Y) to a frame."""
        o.matrix_world = M @ Matrix.LocRotScale(o.location, o.rotation_euler, o.scale)
        return o

    def fat(F, u, t, off=0.0, up=(0, 0, 1)):
        """A proper (unmirrored) frame on a shell: +Y out of the surface,
        +Z as near `up` as the surface allows."""
        p, n = F.at(u, t, off)
        y = n.normalized()
        z = V(up)
        z = (z - y * z.dot(y)).normalized()
        x = y.cross(z)
        M = Matrix((x, y, z)).transposed().to_4x4()
        M.translation = p
        return M

    def tz(F, h):
        """The t at loft coordinate h."""
        H = [s[0] for s in F.S]
        for i in range(len(H) - 1):
            a, b = H[i], H[i + 1]
            if min(a, b) - 1e-9 <= h <= max(a, b) + 1e-9:
                return (i + (h - a) / (b - a)) / (len(H) - 1)
        return 0.0 if abs(h - H[0]) < abs(h - H[-1]) else 1.0

    def hexs(f, b, w, kf=0.72, kb=0.72):
        """A chined section: front ridge f, back b, side chine w."""
        return [(0, f), (w * kf, f * 0.78), (w, 0.0), (w * kb, -b * 0.78), (0, -b)]

    def vane(name, m, root, axis, L, w, th, front=(0, 1, 0), chisel=1.0, ember="glow_dim"):
        """A knife-edged stealth vane: flat faces, bevelled edges, parallel
        sides and a chisel tip (one edge runs straight to the point, the other
        is cut on the diagonal — the sawtooth of a stealth trailing edge),
        the point carrying a dim ember."""
        M = fr(root, axis, front)

        def sec(f, ww, ox=0.0):
            return (f * L, [(0, th), (ww * 0.62, th * 0.8), (ww, 0.0), (ww * 0.62, -th * 0.8), (0, -th)], ox)

        k = 0.3  # where the ember starts, as a fraction of the chisel run
        body = Facet([sec(0.0, w * 0.8), sec(0.1, w), sec(0.74, w), sec(0.74 + 0.26 * k, w * (1 - k) + 0.002 * k, chisel * w * 0.85 * k)], M).mesh(name, m)
        tip = Facet([sec(0.74 + 0.26 * k, w * (1 - k) + 0.002 * k, chisel * w * 0.85 * k), sec(1.0, 0.002, chisel * w * 0.85)], M).mesh(name + "_tip", ember)
        return [body, tip]

    def barcode(name, M, w=0.05, h=0.012):
        widths = [1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 1, 2]
        unit = w / sum(widths)
        x = -w / 2
        bars = []
        for k, wd in enumerate(widths):
            if k % 2 == 0:
                bars.append(K.box(f"{name}{k}", "ink", (x + wd * unit / 2, 0.0007, 0), (wd * unit, 0.0014, h)))
            x += wd * unit
        return stk(K.join(name, bars), M)

    def diamond(name, m, M, w, h, d=0.006):
        o = K.prism(name, m, [(0, h), (w, 0), (0, -h), (-w, 0)], d, axis="Y")
        return stk(o, M)

    # ── TORSO: a deep keeled chest on a wasp waist ────────────────────────
    T = Facet([
        (0.84, [(0, 0.06), (0.03, 0.06), (0.055, 0.035), (0.07, 0.0), (0.05, -0.05), (0, -0.06)]),
        (0.98, [(0, 0.10), (0.05, 0.10), (0.105, 0.06), (0.13, 0.0), (0.095, -0.075), (0, -0.085)]),
        (1.16, [(0, 0.165), (0.07, 0.165), (0.165, 0.085), (0.2, 0.0), (0.15, -0.1), (0, -0.115)]),
        (1.30, [(0, 0.15), (0.07, 0.15), (0.17, 0.08), (0.215, 0.0), (0.16, -0.105), (0, -0.12)]),
        (1.39, [(0, 0.085), (0.05, 0.085), (0.12, 0.05), (0.145, 0.0), (0.11, -0.08), (0, -0.09)]),
        (1.42, [(0, 0.055), (0.035, 0.055), (0.08, 0.032), (0.1, 0.0), (0.075, -0.055), (0, -0.065)]),
    ])
    put("CHEST", T.mesh("torso", "frame"))
    t98, t139 = tz(T, 0.98), tz(T, 1.375)
    put("CHEST", T.plate("sternum", "gunmetal", -0.094, 0.094, t98, t139, off=0.003, th=0.014, cw=0.008))
    for s in (-1, 1):
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put("CHEST", T.plate(f"pec{s}", "ram", *u(0.106, 0.294), 0.13, t139, off=0.003, th=0.016, cw=0.01))
        put("CHEST", T.plate(f"back{s}", "ram", *u(0.306, 0.488), 0.13, t139, off=0.003, th=0.016, cw=0.01))
        put("CHEST", T.strip(f"chine{s}", "glow", *u(0.297, 0.303), tz(T, 1.06), tz(T, 1.26), off=0.006, th=0.004))
    for s in (-1, 1):
        # Shielded exhaust slots on the back plates (heat goes out the back).
        put("CHEST", stk(K.vents(f"exh{s}", "gunmetal", (0, 0, 0), 0.07, 0.1, 5, depth=0.012), fat(T, 0.4 * s, tz(T, 1.12), off=0.02, up=(0, 0, 1))))
    put("CHEST", T.plate("abs", "ram_b", -0.36, 0.36, 0.02, 0.17, off=0.003, th=0.012, cw=0.008))
    # The core: a kite lamp set into the sternum.
    Fc = fat(T, 0.0, tz(T, 1.12), off=0.017, up=(0, 0, 1))
    core_p = Fc.translation.copy()
    kite = [(0, 0.06), (0.04, 0.012), (0.03, -0.045), (0, -0.06), (-0.03, -0.045), (-0.04, 0.012)]
    put("CHEST", stk(K.prism("core_bezel", "titanium", [(x * 1.32, z * 1.25) for x, z in kite], 0.014, axis="Y", bev=0.003), Fc))
    put("CORE", stk(K.prism("core_lamp", "core", kite, 0.01, c=(0, 0.006, 0), axis="Y"), Fc))
    R = K.Rig(shoulder_z=1.22, head_z=1.5, yoke_w=0.56, head_y=0.08, core=(0, core_p.y, core_p.z - 1.22))
    # Markings: a kanji on the left pec, the serial on the right.
    put("CHEST", stk(K.text("kuro", "ink", "黒", 0.04, rot=(P / 2, 0, P), font="YuGothB.ttc"), fat(T, -0.16, tz(T, 1.24), off=0.02, up=(0, 0, 1))))
    put("CHEST", stk(K.text("serial", "ink", "VLT-03", 0.018, rot=(P / 2, 0, P)), fat(T, 0.16, tz(T, 1.26), off=0.02, up=(0, 0, 1))))
    for s in (-1, 1):
        put("CHEST", diamond(f"ir_chest{s}", "glow_dim", fat(T, 0.15 * s, tz(T, 1.05), off=0.02, up=(0, 0, 1)), 0.008, 0.008))

    # Neck collar on the chest top (the head turns on its own gimbal above).
    NK = Facet([(1.40, hexs(0.05, 0.05, 0.05), 0, 0.0), (1.445, hexs(0.04, 0.04, 0.04), 0, 0.01)])
    put("CHEST", NK.mesh("collar", "gunmetal", bev=0.003))

    # Shoulder yokes: each carries the shoulder lamp (front), the launcher
    # pod (top) and the wing box (behind).
    pod = [(-0.06, 1.375), (0.075, 1.375), (0.085, 1.39), (0.055, 1.45), (-0.045, 1.455), (-0.065, 1.435)]
    for s in (-1, 1):
        i = 0 if s < 0 else 1
        # A trapezius wedge, sloping down and thinning out to the shoulder.
        ysec = lambda zc, a, f, b: [(0, f), (a * 0.82, f), (a, f * 0.6), (a * 0.8, -b * 0.9), (0, -b)]
        dz = lambda zc: -s * zc
        YK = Facet([
            (0.0, ysec(0, 0.075, 0.1, 0.09), dz(1.35)),
            (0.2, ysec(0, 0.06, 0.1, 0.085), dz(1.337)),
            (0.31, ysec(0, 0.046, 0.088, 0.07), dz(1.33)),
        ], fr((s * 0.09, 0, 0), (s, 0, 0), (0, 1, 0)))
        put("CHEST", YK.mesh(f"yoke{s}", "frame", bev=0.003))
        put("CHEST", YK.plate(f"yoke_top{s}", "ram", *((0.035, 0.465) if s < 0 else (0.535, 0.965)), 0.0, 0.97, off=0.002, th=0.014, cw=0.009))
        lamp_c = V((s * 0.355, 0.094, 1.333))
        bar = [(-0.034, -0.011), (0.026, -0.011), (0.034, 0.011), (-0.026, 0.011)]
        bar = [(s * x, z) for x, z in bar]
        put("TITAN", K.prism(f"sh_bezel{s}", "titanium", [(x * 1.25, z * 1.5) for x, z in bar], 0.01, c=lamp_c, axis="Y", bev=0.002))
        put(f"SHOULDER_{i}", K.prism(f"sh_lamp{s}", f"shoulder_{i}", bar, 0.008, c=lamp_c + V((0, 0.004, 0.0)), axis="Y"))
        # The launcher pod, mouth raked up-and-forward.
        put("CHEST", K.prism(f"pod{s}", "gunmetal", pod, 0.1, c=(s * 0.37, 0, 0), axis="X", bev=0.005))
        mc = V((s * 0.37, 0.072, 1.421))
        put("CHEST", K.box(f"pod_frame{s}", "titanium", mc, (0.086, 0.01, 0.05), bev=0.003, rot=(-1.107, 0, 0)))
        put("CHEST", K.box(f"pod_mouth{s}", f"pod_{i}", mc + V((0, 0.0045, 0.0022)), (0.07, 0.004, 0.036), rot=(-1.107, 0, 0)))
        put("CHEST", K.box(f"pod_div{s}", "titanium", mc + V((0, 0.006, 0.003)), (0.006, 0.004, 0.04), rot=(-1.107, 0, 0)))
    # The wing box: a carry-through beam across the shoulder blades.
    wbox = [(-0.09, 1.35), (-0.09, 1.41), (-0.13, 1.43), (-0.18, 1.42), (-0.195, 1.38), (-0.18, 1.345), (-0.13, 1.335)]
    put("CHEST", K.prism("wingbox", "gunmetal", wbox, 0.46, axis="X", bev=0.006))
    put("CHEST", K.prism("wingbox_cov", "ram", [(y - 0.004, z + 0.004) for y, z in wbox[1:5]] + [(-0.15, 1.39)], 0.38, axis="X", bev=0.004))

    # ── WAIST: a hex column, three vertebrae, two actuators ───────────────
    put("TITAN", Facet([(0.6, hexs(0.035, 0.035, 0.035)), (0.86, hexs(0.035, 0.035, 0.035))]).mesh("column", "frame"))
    for k, z in enumerate((0.67, 0.73, 0.79)):
        put("TITAN", Facet([(z - 0.016, hexs(0.05, 0.06, 0.05)), (z + 0.016, hexs(0.05, 0.06, 0.05))]).mesh(f"vert{k}", "gunmetal", bev=0.003))
    for s in (-1, 1):
        put("TITAN", K.cyl(f"act_sleeve{s}", "gunmetal", (s * 0.075, 0.035, 0.68), 0.017, 0.13, 12, bev=0.003))
        put("TITAN", K.cyl(f"act_rod{s}", "chrome", (s * 0.075, 0.035, 0.8), 0.009, 0.13, 10))
        put("TITAN", K.cyl(f"act_eye{s}", "titanium", (s * 0.075, 0.035, 0.86), 0.015, 0.02, 12, rot=(0, P / 2, 0)))
        put("TITAN", K.tube(f"cable{s}", "rubber", [(s * 0.05, -0.04, 0.6), (s * 0.075, -0.05, 0.72), (s * 0.06, -0.045, 0.86)], 0.009, 8, 6))
        put("TITAN", K.cyl(f"clamp{s}", "titanium", (s * 0.072, -0.05, 0.72), 0.014, 0.014, 10))
    put("TITAN", K.prism("spine_fin", "ram", [(-0.055, 0.6), (-0.07, 0.62), (-0.085, 0.85), (-0.07, 0.87), (-0.05, 0.85), (-0.05, 0.62)], 0.04, axis="X", bev=0.004))

    # ── PELVIS: a chined girdle, the low lamp a downward chevron ──────────
    PL = Facet([
        (0.41, [(0, 0.05), (0.025, 0.05), (0.045, 0.02), (0.05, -0.01), (0.04, -0.05), (0, -0.06)]),
        (0.44, [(0, 0.085), (0.04, 0.085), (0.065, 0.035), (0.072, 0.0), (0.055, -0.06), (0, -0.07)]),
        (0.56, [(0, 0.12), (0.05, 0.12), (0.1, 0.055), (0.118, 0.0), (0.085, -0.075), (0, -0.09)]),
        (0.62, [(0, 0.1), (0.045, 0.1), (0.09, 0.045), (0.11, 0.0), (0.08, -0.065), (0, -0.08)]),
        (0.64, [(0, 0.06), (0.03, 0.06), (0.06, 0.03), (0.07, 0.0), (0.05, -0.05), (0, -0.06)]),
    ])
    put("TITAN", PL.mesh("pelvis", "frame"))
    put("TITAN", PL.plate("girdle", "ram", -0.29, 0.29, 0.12, 0.86, off=0.003, th=0.015, cw=0.01))
    put("TITAN", PL.plate("girdle_b", "ram_b", 0.31, 0.69, 0.12, 0.86, off=0.003, th=0.015, cw=0.01))
    Fl = fat(PL, 0.0, tz(PL, 0.5), off=0.018, up=(0, 0, 1))
    chev = [(-0.045, 0.02), (0.045, 0.02), (0.0, -0.032)]
    put("TITAN", stk(K.prism("low_bezel", "titanium", [(x * 1.35, z * 1.4 + 0.002) for x, z in chev], 0.012, axis="Y", bev=0.003), Fl))
    put("LOW", stk(K.prism("low_lamp", "low", chev, 0.01, c=(0, 0.006, 0), axis="Y"), Fl))

    # ── TAIL: faceted, tapering into a 2-D vectoring nozzle ───────────────
    TL = Facet([
        (0.45, [(0, 0.05), (0.055, 0.02), (0.05, -0.035), (0, -0.06)], 0, -0.01),
        (0.34, [(0, 0.042), (0.048, 0.016), (0.042, -0.03), (0, -0.05)], 0, -0.045),
        (0.255, [(0, 0.034), (0.04, 0.012), (0.034, -0.025), (0, -0.04)], 0, -0.078),
    ])
    put("TITAN", TL.mesh("tail", "frame"))
    put("TITAN", TL.plate("tail_f", "ram", -0.15, 0.15, 0.04, 0.96, off=0.003, th=0.012, cw=0.008))
    put("TITAN", TL.plate("tail_b", "ram_b", 0.36, 0.64, 0.04, 0.96, off=0.003, th=0.012, cw=0.008))
    nd = (V((0, -0.078, 0.255)) - V((0, -0.045, 0.34))).normalized()
    Mn = fr((0, -0.08, 0.255), nd, (0, 1, 0))
    rect = lambda f, w: [(0, f), (w, f), (w, -f), (0, -f)]
    put("TITAN", Facet([(-0.01, rect(0.036, 0.044)), (0.028, rect(0.038, 0.047)), (0.034, rect(0.034, 0.045)), (0.08, rect(0.022, 0.048))], Mn).mesh("nozzle", "titanium", bev=0.002))
    put("TITAN", Facet([(0.079, rect(0.016, 0.04)), (0.083, rect(0.016, 0.04))], Mn).mesh("nozzle_glow", "glow"))
    put("TITAN", Facet([(0.083, rect(0.014, 0.036)), (0.17, rect(0.002, 0.008))], Mn).mesh("plume", "glow_dim"))
    # Three tail vanes fanned and swept back like a stooping bird's tail.
    tc = V((0, -0.55, -0.83)).normalized()
    tn = V((0, 0.83, -0.55))
    for k, fan in enumerate((-0.42, 0.0, 0.42)):
        ax = (tc + V((math.sin(fan), 0, 0))).normalized()
        put("TITAN", vane(f"tvane{k}", "ram", V((fan * 0.08, -0.07, 0.37)), ax, 0.3 if fan == 0 else 0.26, 0.032, 0.006, front=tn))
    put("TITAN", K.box("tvane_root", "gunmetal", (0, -0.075, 0.375), (0.09, 0.03, 0.04), bev=0.008))

    # ── HEAD: a long sensor turret, one big lens under a hooded brow ──────
    hc = R.head
    HM = fr((0, 0, hc.z), (0, 1, 0), (0, 0, 1))  # loft along +Y; u=0 top, u=0.25 is -X
    HD = Facet([
        (-0.05, [(0, 0.045), (0.035, 0.04), (0.05, 0.0), (0.035, -0.035), (0, -0.04)]),
        (0.02, [(0, 0.078), (0.055, 0.066), (0.084, 0.004), (0.055, -0.052), (0, -0.062)]),
        (0.14, [(0, 0.086), (0.06, 0.072), (0.09, 0.004), (0.06, -0.058), (0, -0.068)]),
        (0.215, [(0, 0.08), (0.058, 0.066), (0.085, 0.002), (0.058, -0.054), (0, -0.064)]),
        (0.228, [(0, 0.07), (0.05, 0.058), (0.075, 0.0), (0.05, -0.048), (0, -0.056)]),
    ], HM)
    put("HEAD", HD.mesh("skull", "frame"))
    # The hood: one olive cowl from a swept crest behind to a brow point
    # overhanging the lens (a virtual loft — only its plate is built).
    HO = Facet([
        (-0.165, [(0, 0.014), (0.01, 0.011), (0.016, 0.0), (0.01, -0.011), (0, -0.014)], 0, 0.108),
        (-0.06, [(0, 0.05), (0.044, 0.04), (0.064, 0.0), (0.044, -0.04), (0, -0.05)], 0, 0.056),
        (0.04, [(0, 0.09), (0.062, 0.076), (0.096, 0.004), (0.062, -0.06), (0, -0.07)]),
        (0.17, [(0, 0.087), (0.064, 0.073), (0.094, 0.002), (0.062, -0.06), (0, -0.07)]),
        (0.255, [(0, 0.086), (0.066, 0.072), (0.094, 0.004), (0.07, -0.06), (0, -0.075)], 0, 0.006),
        (0.305, [(0, 0.016), (0.014, 0.012), (0.02, 0.0), (0.014, -0.012), (0, -0.016)], 0, 0.076),
    ], HM)
    put("HEAD", HO.plate("hood", "olive", -0.31, 0.31, 0.0, 1.0, off=0.003, th=0.014, cw=0.008))
    # The crest is solid under its cowl: close it with the frame.
    put("HEAD", Facet([
        (-0.165, [(0, 0.014), (0.01, 0.011), (0.016, 0.0), (0.01, -0.011), (0, -0.014)], 0, 0.108),
        (-0.06, [(0, 0.05), (0.044, 0.04), (0.064, 0.0), (0.044, -0.04), (0, -0.05)], 0, 0.056),
        (0.04, [(0, 0.08), (0.056, 0.068), (0.086, 0.004), (0.056, -0.054), (0, -0.064)]),
    ], HM).mesh("crest", "frame"))
    put("HEAD", HO.strip("hood_lt", "glow_dim", -0.004, 0.004, 0.08, 0.36, off=0.017, th=0.003))
    put("HEAD", HD.plate("jaw", "ram", 0.335, 0.665, 0.12, 0.92, off=0.003, th=0.012, cw=0.008))
    for s in (-1, 1):
        us = 0.25 if s < 0 else 0.75
        put("HEAD", diamond(f"ir_head{s}", "glow_dim", fat(HO, 0.22 if s < 0 else -0.22, 0.32, off=0.0175, up=(0, 0, 1)), 0.006, 0.006))
    put("HEAD", stk(K.text("hd_serial", "ink", "VLT-03", 0.014, rot=(P / 2, 0, P)), fat(HO, 0.27, 0.6, off=0.0175, up=(0, 0, 1))))
    put("HEAD", barcode("hd_code", fat(HO, -0.27, 0.6, off=0.0175, up=(0, 0, 1)), 0.04, 0.01))
    # The lens: barrel, glass annulus, iris rings, the visor disc.
    lc = V((0, 0.214, hc.z + 0.006))
    put("HEAD", K.lathe("barrel", "gunmetal", [(0.0, 0.0), (0.066, 0.0), (0.066, 0.022), (0.06, 0.03), (0.052, 0.03), (0.052, 0.012), (0.0, 0.012)], 32, c=lc, rot=(-P / 2, 0, 0)))
    put("HEAD", K.lathe("lens_glass", "glass", [(0.04, 0.013), (0.052, 0.013), (0.052, 0.019), (0.04, 0.021)], 32, c=lc, rot=(-P / 2, 0, 0)))
    put("HEAD", K.torus("iris0", "titanium", lc + V((0, 0.021, 0)), 0.047, 0.0028, 32, 6, rot=(P / 2, 0, 0)))
    put("HEAD", K.torus("iris1", "titanium", lc + V((0, 0.03, 0)), 0.056, 0.003, 32, 6, rot=(P / 2, 0, 0)))
    put("EYE_0", K.lathe("eye", "visor", [(0.0, 0.03), (0.018, 0.029), (0.034, 0.025), (0.042, 0.019), (0.042, 0.012), (0.0, 0.012)], 32, c=lc, rot=(-P / 2, 0, 0)))
    put("HEAD", K.torus("pupil", "titanium", lc + V((0, 0.031, 0)), 0.02, 0.0022, 24, 6, rot=(P / 2, 0, 0)))
    R.extra.append(("EYEFX", V((0, 0.31, lc.z)), "HEAD"))
    # The beak: hooked down and back under the lens.
    MB = fr((0, 0, hc.z - 0.05), (0, 0, -1), (0, 1, 0))
    put("HEAD", Facet([
        (0.0, [(0, 0.035), (0.026, 0.012), (0.022, -0.02), (0, -0.03)], 0, 0.19),
        (0.035, [(0, 0.03), (0.02, 0.008), (0.016, -0.016), (0, -0.024)], 0, 0.215),
        (0.065, [(0, 0.02), (0.012, 0.004), (0.009, -0.01), (0, -0.016)], 0, 0.232),
        (0.088, [(0, 0.008), (0.004, 0.0), (0.003, -0.004), (0, -0.006)], 0, 0.228),
        (0.096, [(0, 0.002), (0.001, 0.0), (0.001, -0.001), (0, -0.002)], 0, 0.218),
    ], MB).mesh("beak", "gunmetal", bev=0.0015))
    put("HEAD", K.cyl("gimbal", "titanium", (0, 0.01, hc.z - 0.065), 0.026, 0.08, 18, rot=(0, P / 2, 0), bev=0.004))

    # ── ARMS: long and thin, talons in line with the forearm ──────────────
    for i, s in ((0, -1), (1, 1)):
        pv, el, wr, hp = R.pivot[i], R.elbow(i), R.wrist(i), R.handp(i)
        A, E_, W, H = f"ARM_{i}", f"ELBOW_{i}", f"WRIST_{i}", f"HAND_{i}"
        u = lambda a, b: (a, b) if s > 0 else (-b, -a)
        put(A, K.cyl(f"shhub{s}", "titanium", pv, 0.05, 0.15, 24, rot=(0, P / 2, 0), bev=0.006))
        put(A, K.torus(f"shring{s}", "glow_dim", pv - V((s * 0.077, 0, 0)), 0.036, 0.004, 24, 6, rot=(0, P / 2, 0)))
        cap = Facet([
            (pv.z + 0.068, [(0, 0.03), (0.025, 0.022), (0.04, 0.0), (0.03, -0.045), (0, -0.065)], pv.x + s * 0.03),
            (pv.z + 0.022, [(0, 0.06), (0.05, 0.046), (0.07, 0.0), (0.056, -0.075), (0, -0.11)], pv.x + s * 0.036),
            (pv.z - 0.075, [(0, 0.05), (0.045, 0.04), (0.06, 0.0), (0.05, -0.06), (0, -0.085)], pv.x + s * 0.04),
        ])
        put(A, cap.plate(f"paul{s}", "ram", *u(0.0, 0.54), 0.0, 1.0, off=0.0, th=0.014, cw=0.009))
        put(A, cap.strip(f"paul_lt{s}", "glow", *u(0.2, 0.3), 0.5, 0.54, off=0.015, th=0.003))
        ua = Facet([
            (pv.z + 0.02, hexs(0.04, 0.044, 0.042), pv.x),
            (pv.z - 0.1, hexs(0.05, 0.054, 0.05), pv.x),
            (pv.z - 0.32, hexs(0.045, 0.048, 0.045), pv.x),
            (el.z + 0.055, hexs(0.035, 0.038, 0.036), pv.x),
        ])
        put(A, ua.mesh(f"upper{s}", "frame"))
        put(A, ua.plate(f"sleeve{s}", "ram", -0.2, 0.2, 0.36, 0.92, off=0.003, th=0.013, cw=0.008))
        put(A, K.cyl(f"uact{s}", "gunmetal", pv + V((0, -0.062, -0.22)), 0.013, 0.16, 12))
        put(A, K.cyl(f"uactr{s}", "chrome", pv + V((0, -0.062, -0.37)), 0.0075, 0.14, 10))
        # Elbow: hub, rings, the cop BEHIND.
        put(E_, K.cyl(f"elhub{s}", "titanium", el, 0.038, 0.094, 24, rot=(0, P / 2, 0), bev=0.005))
        for x in (-1, 1):
            put(E_, K.torus(f"elring{s}{x}", "glow_dim", el + V((x * 0.048, 0, 0)), 0.028, 0.003, 24, 6, rot=(0, P / 2, 0)))
        cop = [(-0.03, 0.045), (-0.068, 0.0), (-0.03, -0.055), (-0.012, -0.03), (-0.012, 0.03)]
        put(E_, K.prism(f"elcop{s}", "ram", [(el.y + a, el.z + b) for a, b in cop], 0.07, c=(el.x, 0, 0), axis="X", bev=0.004))
        fa = Facet([
            (el.z - 0.03, hexs(0.038, 0.04, 0.04), el.x),
            (el.z - 0.11, hexs(0.052, 0.046, 0.045), el.x),
            (wr.z + 0.09, hexs(0.042, 0.038, 0.038), el.x),
            (wr.z + 0.03, hexs(0.033, 0.035, 0.033), el.x),
        ])
        put(E_, fa.mesh(f"fore{s}", "frame"))
        put(E_, fa.plate(f"vamb{s}", "olive", -0.2, 0.2, 0.08, 0.93, off=0.003, th=0.015, cw=0.01))
        put(E_, fa.plate(f"vamb_o{s}", "ram", *u(0.21, 0.46), 0.1, 0.9, off=0.003, th=0.013, cw=0.008))
        uo = 0.33 if s > 0 else 0.67
        if s < 0:
            put(E_, barcode("fa_code", fat(fa, uo, 0.5, off=0.017, up=(0, 0, 1)), 0.045, 0.012))
        else:
            put(E_, stk(K.text("fa_serial", "ink", "VLT-03", 0.016, rot=(P / 2, 0, P)), fat(fa, uo, 0.5, off=0.017, up=(0, 0, 1))))
        put(E_, diamond(f"ir_fa{s}", "glow_dim", fat(fa, 0.0, 0.2, off=0.019, up=(0, 0, 1)), 0.007, 0.007))
        put(W, K.cyl(f"wrhub{s}", "titanium", wr, 0.034, 0.075, 22, rot=(0, P / 2, 0), bev=0.004))
        put(W, K.cyl(f"wrcuff{s}", "gunmetal", wr + V((0, 0, -0.026)), 0.04, 0.026, 6, bev=0.004))

        # TALON: palm in line with the forearm, face to the front (+Y);
        # three claws continue downward and curl toward +Y.
        palm = [(-0.034, 0.062), (0.034, 0.062), (0.046, 0.01), (0.038, -0.05), (-0.038, -0.05), (-0.046, 0.01)]
        put(H, K.prism(f"palm{s}", "frame", palm, 0.044, c=hp + V((0, 0, -0.004)), axis="Y", bev=0.004))
        put(H, K.prism(f"palm_back{s}", "ram", [(x * 1.06, z * 1.04) for x, z in palm], 0.016, c=hp + V((0, -0.026, -0.004)), axis="Y", bev=0.004))
        put(H, K.prism(f"palm_pad{s}", "rubber", [(x * 0.78, z * 0.78) for x, z in palm], 0.006, c=hp + V((0, 0.024, -0.004)), axis="Y"))
        put(H, diamond(f"ir_hand{s}", "glow_dim", fr(hp + V((0, -0.036, 0.0)), (0, 0, 1), (0, -1, 0)), 0.006, 0.006))
        put(H, K.cyl(f"knbar{s}", "titanium", hp + V((0, 0, -0.058)), 0.011, 0.1, 12, rot=(0, P / 2, 0)))
        for k, x in enumerate((-0.03, 0.0, 0.03)):
            sc = 1.12 if x == 0 else 1.0
            kn = hp + V((x, 0.0, -0.058))
            d0 = R.digit(i, 2 * k, kn, 0.1, 0.9)
            put(d0, K.cyl(f"t{s}{k}k", "titanium", kn, 0.0145, 0.024, 12, rot=(0, P / 2, 0)))
            put(d0, Facet([(kn.z + 0.006, hexs(0.015, 0.016, 0.012), kn.x, kn.y), (kn.z - 0.05 * sc, hexs(0.013, 0.014, 0.01), kn.x, kn.y)]).mesh(f"t{s}{k}a", "ram", bev=0.002))
            j = kn + V((0, 0, -0.054 * sc))
            d1 = R.digit(i, 2 * k + 1, j, 0.15, 1.3)
            put(d1, K.cyl(f"t{s}{k}j", "titanium", j, 0.011, 0.02, 12, rot=(0, P / 2, 0)))
            claw = lambda d, w: [(0, d), (w, 0.0), (0, -d * 0.8)]
            put(d1, Facet([
                (j.z + 0.004, claw(0.014, 0.009), j.x, j.y),
                (j.z - 0.025 * sc, claw(0.013, 0.008), j.x, j.y - 0.003),
                (j.z - 0.05 * sc, claw(0.01, 0.006), j.x, j.y + 0.002),
                (j.z - 0.07 * sc, claw(0.006, 0.0038), j.x, j.y + 0.016),
                (j.z - 0.083 * sc, claw(0.0015, 0.001), j.x, j.y + 0.034),
            ]).mesh(f"t{s}{k}c", "gunmetal"))

    # ── WINGS: gimballed spars, wrist half way out, knife-edged ECM vanes ─
    def spar_sec(d, top, bot):
        return [(0, top), (d, top * 0.35), (d, -bot * 0.45), (0, -bot)]

    for i, s in ((0, -1), (1, 1)):
        root = V((s * 0.28, -0.14, 1.38))
        R.wings.append((i, root, s * 0.5))
        Wm, Ww = f"WING_{i}", f"WINGWRIST_{i}"
        wj = root + V((s * 0.5, 0, 0))
        put(Wm, K.cyl(f"wroot{s}", "titanium", root, 0.046, 0.1, 8, rot=(P / 2, 0, 0), bev=0.004))
        put(Wm, K.cyl(f"wroot_c{s}", "gunmetal", root + V((0, 0.0, 0)), 0.03, 0.118, 8, rot=(P / 2, 0, 0), bev=0.003))
        put(Wm, K.torus(f"wroot_lt{s}", "glow_dim", root + V((0, 0.051, 0)), 0.036, 0.004, 8, 6, rot=(P / 2, 0, 0)))
        # The wing's own actuator: a ram under the spar, root to mid-span.
        put(Wm, K.tube(f"wram{s}", "gunmetal", [root + V((s * 0.04, 0.03, -0.042)), root + V((s * 0.2, 0.03, -0.034))], 0.011, 10, 2))
        put(Wm, K.tube(f"wramr{s}", "chrome", [root + V((s * 0.2, 0.03, -0.034)), root + V((s * 0.3, 0.03, -0.03))], 0.006, 8, 2))
        sp1 = Facet([(0.03, spar_sec(0.032, 0.042, 0.036)), (0.26, spar_sec(0.028, 0.036, 0.03)), (0.47, spar_sec(0.023, 0.03, 0.026))], fr(root, (s, 0, 0), (0, 0, 1)))
        put(Wm, sp1.mesh(f"spar1{s}", "gunmetal", bev=0.002))
        put(Wm, sp1.plate(f"cov1{s}", "olive", -0.165, 0.165, 0.04, 0.96, off=0.002, th=0.01, cw=0.006))
        for k, (d, L) in enumerate(((0.11, 0.28), (0.235, 0.32), (0.36, 0.36))):
            a = s * (0.04 + 0.04 * k)
            put(Wm, vane(f"wv{s}{k}", "ram", root + V((s * d, 0.006 * (1 - 2 * (k % 2)), -0.005)), (math.sin(a), 0, -math.cos(a)), L, 0.06, 0.005, chisel=-s))
        if s > 0:
            put(Wm, K.text("w_serial", "ink", "VLT-03", 0.022, c=root + V((0.34, 0.03, 0.0)), rot=(P / 2, 0, P)))
        put(Ww, K.cyl(f"wwrist{s}", "titanium", wj, 0.038, 0.085, 8, rot=(P / 2, 0, 0), bev=0.004))
        put(Ww, K.torus(f"wwrist_lt{s}", "glow_dim", wj + V((0, 0.043, 0)), 0.028, 0.0035, 8, 6, rot=(P / 2, 0, 0)))
        sp2 = Facet([(0.03, spar_sec(0.023, 0.03, 0.026)), (0.3, spar_sec(0.018, 0.024, 0.02)), (0.44, spar_sec(0.004, 0.006, 0.005))], fr(wj, (s, 0, 0), (0, 0, 1)))
        put(Ww, sp2.mesh(f"spar2{s}", "gunmetal", bev=0.0015))
        put(Ww, sp2.plate(f"cov2{s}", "olive", -0.165, 0.165, 0.05, 0.62, off=0.002, th=0.009, cw=0.006))
        for k, (d, L) in enumerate(((0.06, 0.42), (0.17, 0.5), (0.28, 0.58), (0.39, 0.66))):
            a = s * (0.14 + 0.07 * k)
            put(Ww, vane(f"wo{s}{k}", "ram", wj + V((s * d, 0.006 * (1 - 2 * (k % 2)), -0.004)), (math.sin(a), 0, -math.cos(a)), L, 0.056, 0.005, chisel=-s))
        put(Ww, diamond(f"ir_tip{s}", "glow_dim", fr(wj + V((s * 0.4, 0.008, 0.0)), (0, 0, 1), (0, 1, 0)), 0.006, 0.005))
    return R

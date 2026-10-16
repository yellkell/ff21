"""
THE HAND — your fighting hand, machined: a coated steel chassis with bare
steel joints, rubber grip pads and an LED channel down every finger.

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/hand.py [-- --render] [--nobake]

Writes public/arena/hand/:

    hand.glb          the LEFT hand's parts, unmaterialled, each parked at
                      its pivot (the game mirrors it for the right hand)
    hand_albedo.webp  RGB = colour; A = UNTINT — 1 where a surface keeps its
                      own colour (bare steel, rubber, LEDs, worn edges), 0
                      where the skin's tone tints the coat (avatar/hands.ts)
    hand_orm.webp     R = occlusion, G = roughness, B = metalness
    hand_nrm.webp     tangent-space normal: rounded edges, seams, scratches,
                      grip ridges, LED grooves
    hand_emit.webp    R = the LIT glow (the squeeze bloom, whole hand, LEDs
                      hottest), G = the IDLE glow (LED channels only)
    palm_*.webp       the same set for PALM, the back plate THE PAINT bakes
                      into (its own 0..1 UVs, so a paint canvas spans it);
                      it has no albedo — the paint canvas is its colour.

HAND SPACE (three's, = the old box hand's): knuckles down -Z, the palm
faces -Y, the back of the hand +Y; the left hand's thumb is on +X. Blender
is Z-up, so everything is authored with fingers along +Y and the back of
the hand up +Z; the glTF exporter maps (x, y, z) -> (x, z, -y).

THE CONTRACT with src/avatar/hands.ts (node names; every joint is unrotated
at rest, so the game's curl is a pure rotation.x — negative folds toward
the palm):

    HAND
      PALM            paint surface (material 'palm')
      PALM_FRAME      knuckle clevises, axles, palm pad, thenar mount
      WRIST           wrist actuator stub
      F{i}_0 -> F{i}_1 -> F{i}_2     finger i (0 = index), knuckle -> tip
      THUMB_MOUNT     fixed (yaw/pitch/roll) -> T_0 -> T_1 -> T_2
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "public", "arena", "hand")
RENDERS = "C:/Users/alexv/Desktop/blendercyber/renders/hand"
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RENDER = "--render" in argv
NOBAKE = "--nobake" in argv
ATLAS = 1024
PALM_TEX = 512

# --- the anatomy (metres, Blender frame) ---------------------------------
# Finger i: knuckle pivot (x, y, z), segment lengths (prox, mid, dist),
# width, height. The knuckle line arcs: middle furthest forward, pinky back.
FINGERS = [
    dict(x=0.0282, y=0.0452, z=0.0010, L=(0.031, 0.020, 0.018), w=0.0166, h=0.0170),  # index
    dict(x=0.0093, y=0.0470, z=0.0012, L=(0.034, 0.022, 0.019), w=0.0170, h=0.0174),  # middle
    dict(x=-0.0095, y=0.0458, z=0.0008, L=(0.032, 0.021, 0.018), w=0.0164, h=0.0168),  # ring
    dict(x=-0.0282, y=0.0418, z=-0.0004, L=(0.025, 0.017, 0.016), w=0.0148, h=0.0154),  # pinky
]
THUMB = dict(
    pivot=(0.0275, -0.0190, -0.0060),
    # (pitch about X, roll about Y, yaw about Z), applied roll -> pitch -> yaw:
    # the thumb leans out 34 degrees from the index, dips 18 toward the
    # palm side, and rolls its nail 50 degrees outward.
    rot=(math.radians(-18), math.radians(50), math.radians(-34)),
    # Short of the fingers, as a real thumb is: its tip reaches about the
    # middle of the index's first segment.
    L=(0.025, 0.021, 0.019), w=0.0176, h=0.0172,
)
TAPER = 0.94  # each segment is this much narrower than the one before


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

K = 24  # points per loft ring (the palm); fingers pass their own, lower


def ring(hw, top, bot, n_top=3.2, n_bot=2.6, k=K, ridge=None):
    """A superellipse cross-section in the XZ plane: half-width hw, from z=bot
    to z=top. Boxier on top (n_top) than underneath (n_bot). `ridge(x)`
    lifts the top surface (the palm's metacarpal ridges)."""
    zc = (top + bot) / 2
    b = (top - bot) / 2
    pts = []
    for i in range(k):
        t = 2 * math.pi * i / k
        c, s = math.cos(t), math.sin(t)
        n = n_top if s >= 0 else n_bot
        x = hw * math.copysign(abs(c) ** (2 / n), c)
        z = zc + b * math.copysign(abs(s) ** (2 / n), s)
        if ridge and s > 0:
            z += ridge(x) * s ** 2
        pts.append((x, z))
    return pts


def loft(bm, sections, cap0=True, cap1=True, mat=0, ridge=None, k=None):
    """sections: [(y, hw, top, bot[, n_top, n_bot])]. Rings joined into quads,
    ends closed with a fan. `ridge(x, y)` lifts the top surface."""
    k = k or K
    rings = []
    for s in sections:
        y, hw, top, bot = s[:4]
        nt = s[4] if len(s) > 4 else 3.2
        nb = s[5] if len(s) > 5 else 2.6
        rg = (lambda x, y=y: ridge(x, y)) if ridge else None
        rings.append([bm.verts.new((x, y, z)) for x, z in ring(hw, top, bot, nt, nb, k=k, ridge=rg)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for i in range(k):
            j = (i + 1) % k
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for cap, r, flip in ((cap0, rings[0], True), (cap1, rings[-1], False)):
        if not cap:
            continue
        c = bm.verts.new(sum((v.co for v in r), Vector()) / len(r))
        for i in range(k):
            j = (i + 1) % k
            f = bm.faces.new((r[j], r[i], c) if flip else (r[i], r[j], c))
            faces.append(f)
    for f in faces:
        f.material_index = mat
    return faces


def round_end(y_axis, R, hw, sign, steps=4, n_top=2.6, n_bot=2.4, hw_end=0.8):
    """Sections closing a shell in a half-round about a joint axis at
    y_axis (radius R in the YZ plane), toward +Y (sign=+1) or -Y (-1).
    Rotating the neighbour about that axis keeps the joint closed."""
    secs = []
    for i in range(steps + 1):
        a = (math.pi / 2) * i / steps  # 0 at the full section, 90 deg at the tip
        y = y_axis + sign * R * math.sin(a)
        zr = R * math.cos(a)
        if i == steps:
            zr = R * 0.12
        w = hw * (1 - (1 - hw_end) * (1 - math.cos(a)) ** 1.2)
        secs.append((y, w, zr, -zr, n_top, n_bot))
    return secs if sign > 0 else list(reversed(secs))


def cylinder_x(bm, cx, cy, cz, r, half_len, seg=12, mat=0, chamfer=0.0004):
    """A chamfered cylinder along X (an axle cap, a barrel)."""
    xs = [-half_len, -half_len + chamfer, half_len - chamfer, half_len]
    rs = [r - chamfer, r, r, r - chamfer]
    rings = []
    for x, rr in zip(xs, rs):
        rings.append([
            bm.verts.new((cx + x, cy + rr * math.cos(2 * math.pi * i / seg), cz + rr * math.sin(2 * math.pi * i / seg)))
            for i in range(seg)
        ])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            faces.append(bm.faces.new((a[i], b[i], b[j], a[j])))
    for r_, flip in ((rings[0], False), (rings[-1], True)):
        c = bm.verts.new(sum((v.co for v in r_), Vector()) / seg)
        for i in range(seg):
            j = (i + 1) % seg
            faces.append(bm.faces.new((r_[j], r_[i], c) if not flip else (r_[i], r_[j], c)))
    for f in faces:
        f.material_index = mat
    return faces


def merge(bm, other, matrix=None):
    """Append a separately built bmesh (optionally transformed)."""
    if matrix is not None:
        bmesh.ops.transform(other, matrix=matrix, verts=other.verts[:])
    tmp = bpy.data.meshes.new("tmp")
    other.to_mesh(tmp)
    other.free()
    bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)


# Material slots, in this order on every part.
PLATE, STEEL, RUBBER = 0, 1, 2


def new_obj(name, bm, mats, parent=None, loc=(0, 0, 0), props=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    for k, v in (props or {}).items():
        ob[k] = v
    for p in me.polygons:
        p.use_smooth = True
    return ob


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------

def segment(name, L, w, h, w_next, h_next, is_tip, mats, parent, loc):
    """One phalanx, pivot at its origin, running +Y.

    NESTED ROUND ENDS: the shell's back end is a half-round about its own
    pivot (radius a hair under the parent's), so it always stays tucked
    inside the parent's front end however far it bends; the front end is a
    half-round about the next pivot, which is the knuckle you see when the
    hand closes. A bare-steel axle cap marks each side of the joint, and a
    rubber pad runs under the middle."""
    bm = bmesh.new()
    R_back = h * 0.5 * 0.9  # tucked inside the parent
    top, bot = h * 0.5, -h * 0.47
    hw = w * 0.5
    R_front = h * 0.5 * 0.985

    if is_tip:
        # Back half-round, body, then a fingertip that domes over and down.
        secs = round_end(0.0, R_back, hw * 0.93, -1)
        secs += [
            (0.0035, hw * 0.98, top * 0.97, bot * 0.97, 3.0, 2.6),
            (0.0060, hw, top, bot, 3.0, 2.6),
            (L - 0.0040, hw * 0.97, top * 0.96, bot * 0.97, 3.0, 2.6),
            (L - 0.0010, hw * 0.90, top * 0.86, bot * 0.92, 2.8, 2.5),
            (L + 0.0015, hw * 0.78, top * 0.66, bot * 0.82, 2.5, 2.3),
            (L + 0.0032, hw * 0.58, top * 0.40, bot * 0.62, 2.3, 2.2),
            (L + 0.0042, hw * 0.30, top * 0.14, bot * 0.34, 2.1, 2.0),
        ]
    else:
        secs = round_end(0.0, R_back, hw * 0.93, -1)
        secs += [
            (0.0040, hw * 0.98, top * 0.98, bot * 0.98, 3.0, 2.6),
            (0.0070, hw, top, bot, 3.0, 2.6),
            (L - 0.0050, hw * 0.985, top * 0.99, bot, 3.0, 2.6),
        ]
        secs += round_end(L, R_front, hw * 0.985, +1, hw_end=0.86)
    loft(bm, secs, mat=PLATE, k=16)

    # Rubber pad on the palm side, between the joints.
    p0 = 0.0042
    p1 = L + 0.0018 if is_tip else L - 0.0046
    if p1 - p0 > 0.004:
        pb = bot - 0.0012
        loft(bm, [
            (p0, hw * 0.52, bot + 0.0025, pb + 0.0007, 2.4, 2.2),
            (p0 + 0.0014, hw * 0.74, bot + 0.0025, pb, 2.6, 2.2),
            (p1 - 0.0014, hw * 0.74, bot + 0.0025, pb, 2.6, 2.2),
            (p1, hw * 0.52, bot + 0.0025, pb + 0.0007, 2.4, 2.2),
        ], mat=RUBBER, k=12)

    if not is_tip:
        # Axle caps either side of the next joint.
        for sgn in (1, -1):
            cylinder_x(bm, sgn * (hw * 0.985 - 0.0001), L, 0.0, R_front * 0.42, 0.00055, seg=8, mat=STEEL, chamfer=0.00018)

    props = {"led_y0": 0.0055, "led_y1": (L - 0.0005 if is_tip else L - 0.004), "led_w": 0.00075}
    return new_obj(name, bm, mats, parent, loc, props)


def palm_ridge(x, y):
    """The back of the hand rises in four soft ridges over the 'metacarpals',
    fanning from the wrist to each knuckle and swelling toward it."""
    t = max(0.0, min(1.0, (y + 0.040) / 0.080))
    lift = 0.0
    for f in FINGERS:
        fx = f["x"] * (0.55 + 0.45 * t)
        lift += math.exp(-((x - fx) / 0.0052) ** 2)
    return 0.0011 * (0.35 + 0.65 * t) * lift


def palm(mats_palm, parent):
    """The back plate — THE PAINT's surface — arched across, ridged to the
    knuckles, chamfered all round."""
    bm = bmesh.new()
    secs = [
        (-0.0470, 0.0270, 0.0080, -0.0070, 2.4, 2.6),
        (-0.0462, 0.0298, 0.0100, -0.0090, 2.5, 2.8),
        (-0.0440, 0.0316, 0.0116, -0.0104, 2.6, 3.0),
        (-0.0300, 0.0345, 0.0130, -0.0110, 2.6, 3.0),
        (-0.0080, 0.0376, 0.0138, -0.0112, 2.7, 3.0),
        (0.0150, 0.0398, 0.0140, -0.0112, 2.8, 3.0),
        (0.0290, 0.0406, 0.0134, -0.0108, 2.8, 3.0),
        (0.0335, 0.0402, 0.0122, -0.0098, 2.7, 2.9),
        (0.0352, 0.0392, 0.0104, -0.0082, 2.5, 2.7),
        (0.0360, 0.0376, 0.0080, -0.0060, 2.3, 2.5),
    ]
    loft(bm, secs, mat=0, ridge=palm_ridge)
    return new_obj("PALM", bm, mats_palm, parent, props={"led_y0": -0.04, "led_y1": 0.03, "led_w": 0.0})


def palm_frame(mats, parent):
    bm = bmesh.new()
    # Knuckle housings: a half-round about each finger's pivot that the
    # proximal phalanx tucks into — the domes that stand up in a fist.
    for f in FINGERS:
        hw, h = f["w"] * 0.5, f["h"]
        R = h * 0.5 * 0.985
        sub = bmesh.new()
        secs = [(-0.0105, hw * 0.92, R * 0.86, -R * 0.86, 2.6, 2.4), (-0.0050, hw * 0.985, R, -R, 2.8, 2.5)]
        secs += round_end(0.0, R, hw * 0.985, +1, hw_end=0.86)
        loft(sub, secs, mat=PLATE, k=16)
        for sgn in (1, -1):
            cylinder_x(sub, sgn * (hw * 0.985 - 0.0001), 0.0, 0.0, R * 0.42, 0.00055, seg=8, mat=STEEL, chamfer=0.00018)
        merge(bm, sub, Matrix.Translation((f["x"], f["y"], f["z"])))
    # Palm pad: thick rubber under the palm, a heel at the wrist, a pad
    # under the knuckles.
    loft(bm, [
        (-0.0440, 0.0230, -0.0085, -0.0122, 2.6, 2.2),
        (-0.0400, 0.0300, -0.0085, -0.0140, 2.6, 2.2),
        (-0.0120, 0.0335, -0.0090, -0.0138, 2.6, 2.2),
        (0.0180, 0.0365, -0.0090, -0.0134, 2.6, 2.2),
        (0.0310, 0.0368, -0.0085, -0.0128, 2.6, 2.2),
        (0.0365, 0.0330, -0.0080, -0.0108, 2.6, 2.2),
    ], mat=RUBBER)
    # Thenar housing: the swell the thumb's base turns in.
    px, py, pz = THUMB["pivot"]
    sub = bmesh.new()
    loft(sub, [
        (-0.0175, 0.0050, 0.0055, -0.0055, 2.2, 2.2),
        (-0.0130, 0.0108, 0.0098, -0.0102, 2.5, 2.4),
        (-0.0020, 0.0124, 0.0110, -0.0112, 2.6, 2.4),
        (0.0090, 0.0112, 0.0100, -0.0100, 2.5, 2.4),
    ] + round_end(0.0110, 0.0100, 0.0105, +1), mat=PLATE)
    merge(bm, sub, Matrix.Translation((px - 0.0025, py - 0.0010, pz + 0.0012)) @ Euler((0, math.radians(30), math.radians(-30))).to_matrix().to_4x4())
    return new_obj("PALM_FRAME", bm, mats, parent)


def wrist(mats, parent):
    """The wrist joint: a steel collar under the palm's heel, then a short
    coated forearm cuff."""
    bm = bmesh.new()
    loft(bm, [
        (-0.0560, 0.0262, 0.0098, -0.0104, 2.3, 2.3),
        (-0.0440, 0.0262, 0.0098, -0.0104, 2.3, 2.3),
    ], cap0=False, cap1=False, mat=STEEL)
    loft(bm, [
        (-0.0920, 0.0262, 0.0108, -0.0120, 2.4, 2.3),
        (-0.0905, 0.0290, 0.0130, -0.0142, 2.5, 2.4),
        (-0.0620, 0.0300, 0.0136, -0.0148, 2.6, 2.4),
        (-0.0575, 0.0292, 0.0128, -0.0140, 2.5, 2.4),
        (-0.0560, 0.0270, 0.0110, -0.0122, 2.4, 2.3),
    ], mat=PLATE)
    return new_obj("WRIST", bm, mats, parent, props={"led_y0": -0.086, "led_y1": -0.065, "led_w": 0.0007})


# ---------------------------------------------------------------------------
# Materials — procedural detail, baked to the atlas
# ---------------------------------------------------------------------------

def N(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k.startswith("_"):
            setattr(n, k[1:], v)
        else:
            n.inputs[k].default_value = v
    return n


def math_op(nt, op, a, b=None, c=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def maprange(nt, v, a, b, c=0.0, d=1.0, clamp=True):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.clamp = clamp
    n.inputs["From Min"].default_value = a
    n.inputs["From Max"].default_value = b
    n.inputs["To Min"].default_value = c
    n.inputs["To Max"].default_value = d
    nt.links.new(v, n.inputs["Value"])
    return n.outputs[0]


def make_material(name, kind):
    """kind: 'plate' | 'steel' | 'rubber' | 'palm'. Returns the material and
    its channel taps for the bake."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links.new
    tc = N(nt, "ShaderNodeTexCoord")
    geo = N(nt, "ShaderNodeNewGeometry")
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(tc.outputs["Object"], sep.inputs[0])
    px, py, pz = sep.outputs["X"], sep.outputs["Y"], sep.outputs["Z"]
    co = tc.outputs["Object"]

    # Rounded edges: the bevel node's normal is the realism — every hard
    # edge catches a highlight line once baked.
    bev = N(nt, "ShaderNodeBevel", Radius=0.0005 if kind != "rubber" else 0.0008)
    bev.samples = 12
    edge_dot = N(nt, "ShaderNodeVectorMath", _operation="DOT_PRODUCT")
    L(geo.outputs["Normal"], edge_dot.inputs[0])
    L(bev.outputs["Normal"], edge_dot.inputs[1])
    edge = maprange(nt, edge_dot.outputs["Value"], 0.995, 0.86)

    ao = N(nt, "ShaderNodeAmbientOcclusion", Distance=0.006)
    ao.only_local = True
    ao.samples = 16
    aov = maprange(nt, ao.outputs["AO"], 0.0, 1.0, 0.25, 1.0)

    # Fine noises in object space (metres, so scales are large numbers).
    n_fine = N(nt, "ShaderNodeTexNoise", Scale=900.0, Detail=6.0, Roughness=0.6)
    L(co, n_fine.inputs["Vector"])
    n_mid = N(nt, "ShaderNodeTexNoise", Scale=140.0, Detail=4.0, Roughness=0.55)
    L(co, n_mid.inputs["Vector"])
    # Scratches: noise stretched along the segment, thresholded to hairlines.
    sc_vec = N(nt, "ShaderNodeVectorMath", _operation="MULTIPLY")
    sc_vec.inputs[1].default_value = (1.0, 0.06, 1.0)
    L(co, sc_vec.inputs[0])
    sc_rot = N(nt, "ShaderNodeVectorRotate", _rotation_type="Z_AXIS")
    sc_rot.inputs["Angle"].default_value = 0.35
    L(sc_vec.outputs[0], sc_rot.inputs["Vector"])
    n_scr = N(nt, "ShaderNodeTexNoise", Scale=1400.0, Detail=1.0)
    L(sc_rot.outputs[0], n_scr.inputs["Vector"])
    scr_line = maprange(nt, math_op(nt, "ABSOLUTE", math_op(nt, "SUBTRACT", n_scr.outputs["Fac"], 0.5)), 0.006, 0.0)
    scr_gate = maprange(nt, n_mid.outputs["Fac"], 0.62, 0.65)
    scratch = math_op(nt, "MULTIPLY", scr_line, scr_gate)

    height = math_op(nt, "MULTIPLY", n_fine.outputs["Fac"], 0.15)
    led = None
    if kind in ("plate", "palm"):
        # LED channel: a groove down the back's centre line (object props
        # give its run), only on upward-facing surface.
        a0 = N(nt, "ShaderNodeAttribute", _attribute_name="led_y0")
        a0.attribute_type = "OBJECT"
        a1 = N(nt, "ShaderNodeAttribute", _attribute_name="led_y1")
        a1.attribute_type = "OBJECT"
        aw = N(nt, "ShaderNodeAttribute", _attribute_name="led_w")
        aw.attribute_type = "OBJECT"
        ax = math_op(nt, "ABSOLUTE", px)
        across = maprange(nt, math_op(nt, "DIVIDE", ax, math_op(nt, "MAXIMUM", aw.outputs["Fac"], 1e-6)), 1.0, 0.6)
        along = math_op(nt, "MULTIPLY",
                        maprange(nt, math_op(nt, "SUBTRACT", py, a0.outputs["Fac"]), 0.0, 0.0006),
                        maprange(nt, math_op(nt, "SUBTRACT", a1.outputs["Fac"], py), 0.0, 0.0006))
        nz = N(nt, "ShaderNodeSeparateXYZ")
        L(geo.outputs["Normal"], nz.inputs[0])
        up = maprange(nt, nz.outputs["Z"], 0.55, 0.8)
        led = math_op(nt, "MULTIPLY", math_op(nt, "MULTIPLY", across, along), up)
        # The groove's lips: a slightly wider channel, sunk.
        lip = math_op(nt, "MULTIPLY", math_op(nt, "MULTIPLY", maprange(nt, math_op(nt, "DIVIDE", ax, math_op(nt, "MAXIMUM", aw.outputs["Fac"], 1e-6)), 1.7, 1.25), along), up)
        height = math_op(nt, "MULTIPLY_ADD", lip, -0.6, height)

    if kind == "palm":
        # Panel seams on the back plate: a spine either side of the LED
        # channel and a cross seam behind the knuckles; four cap screws.
        seam_x = maprange(nt, math_op(nt, "ABSOLUTE", math_op(nt, "SUBTRACT", math_op(nt, "ABSOLUTE", px), 0.0125)), 0.00035, 0.0)
        seam_y = maprange(nt, math_op(nt, "ABSOLUTE", math_op(nt, "SUBTRACT", py, 0.0215)), 0.00035, 0.0)
        seam_w = maprange(nt, math_op(nt, "ABSOLUTE", math_op(nt, "SUBTRACT", py, -0.0335)), 0.00035, 0.0)
        seam = math_op(nt, "MAXIMUM", math_op(nt, "MAXIMUM", seam_x, seam_y), seam_w)
        nz2 = N(nt, "ShaderNodeSeparateXYZ")
        L(geo.outputs["Normal"], nz2.inputs[0])
        seam = math_op(nt, "MULTIPLY", seam, maprange(nt, nz2.outputs["Z"], 0.3, 0.6))
        screws = None
        for sx, sy in ((0.026, 0.012), (-0.026, 0.012), (0.024, -0.038), (-0.024, -0.038)):
            d = N(nt, "ShaderNodeVectorMath", _operation="DISTANCE")
            L(co, d.inputs[0])
            d.inputs[1].default_value = (sx, sy, 0.0)
            dxy = math_op(nt, "SQRT", math_op(nt, "SUBTRACT",
                                              math_op(nt, "POWER", d.outputs["Value"], 2.0),
                                              math_op(nt, "POWER", math_op(nt, "SUBTRACT", pz, 0.0), 2.0)))
            head = maprange(nt, dxy, 0.0019, 0.0015)
            sock = maprange(nt, dxy, 0.0009, 0.0007)
            s = math_op(nt, "SUBTRACT", head, math_op(nt, "MULTIPLY", sock, 1.6))
            screws = s if screws is None else math_op(nt, "MAXIMUM", screws, s)
        height = math_op(nt, "MULTIPLY_ADD", seam, -0.9, height)
        height = math_op(nt, "MULTIPLY_ADD", screws, 0.5, height)

    if kind == "rubber":
        # Grip ridges across the pad, a pebbled skin over them.
        ridge = math_op(nt, "SINE", math_op(nt, "MULTIPLY", py, 2 * math.pi / 0.0017))
        height = math_op(nt, "MULTIPLY_ADD", ridge, 0.35, math_op(nt, "MULTIPLY", n_fine.outputs["Fac"], 0.4))
    if kind == "steel":
        # Lathe marks: fine rings round the X axis.
        rad = math_op(nt, "SQRT", math_op(nt, "ADD", math_op(nt, "POWER", py, 2.0), math_op(nt, "POWER", pz, 2.0)))
        lathe = math_op(nt, "SINE", math_op(nt, "MULTIPLY", px, 2 * math.pi / 0.00022))
        height = math_op(nt, "MULTIPLY_ADD", lathe, 0.05, height)

    height = math_op(nt, "MULTIPLY_ADD", scratch, -0.25 if kind != "rubber" else 0.0, height)
    bump = N(nt, "ShaderNodeBump", Strength=0.45, Distance=0.00025)
    L(height, bump.inputs["Height"])
    L(bev.outputs["Normal"], bump.inputs["Normal"])

    # Edge wear: coat chipped back to bare steel along the sharpest edges.
    wear = math_op(nt, "MULTIPLY", edge, maprange(nt, n_mid.outputs["Fac"], 0.38, 0.62))
    wear = maprange(nt, wear, 0.25, 0.6)

    rgb = N(nt, "ShaderNodeCombineColor")
    if kind in ("plate", "palm"):
        coat = math_op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.12, 0.86)
        steel = 0.62
        alb = math_op(nt, "ADD", math_op(nt, "MULTIPLY", coat, math_op(nt, "SUBTRACT", 1.0, wear)), math_op(nt, "MULTIPLY", wear, steel))
        if led is not None:
            alb = math_op(nt, "ADD", math_op(nt, "MULTIPLY", alb, math_op(nt, "SUBTRACT", 1.0, led)), math_op(nt, "MULTIPLY", led, 0.85))
        untint = wear if led is None else math_op(nt, "MAXIMUM", wear, led)
        untint = math_op(nt, "MAXIMUM", untint, math_op(nt, "MULTIPLY", scratch, 0.15))
        rough = math_op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.14, 0.27)
        rough = math_op(nt, "SUBTRACT", rough, math_op(nt, "MULTIPLY", wear, 0.08))
        rough = math_op(nt, "ADD", rough, math_op(nt, "MULTIPLY", scratch, 0.12))
        metal = 0.9
        if led is not None:
            rough = math_op(nt, "ADD", math_op(nt, "MULTIPLY", rough, math_op(nt, "SUBTRACT", 1.0, led)), math_op(nt, "MULTIPLY", led, 0.32))
            metal = math_op(nt, "MULTIPLY", math_op(nt, "SUBTRACT", 1.0, led), 0.9)
        lit = math_op(nt, "MULTIPLY", math_op(nt, "ADD", 0.5, math_op(nt, "MULTIPLY", wear, 0.2)), aov)
        if led is not None:
            lit = math_op(nt, "MAXIMUM", lit, led)
        idle = led if led is not None else 0.0
    elif kind == "steel":
        alb = math_op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.1, 0.58)
        untint = 1.0
        rough = math_op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.1, 0.17)
        rough = math_op(nt, "ADD", rough, math_op(nt, "MULTIPLY", scratch, 0.1))
        metal = 1.0
        lit = math_op(nt, "MULTIPLY", 0.3, aov)
        idle = 0.0
    else:  # rubber
        alb = math_op(nt, "MULTIPLY_ADD", n_mid.outputs["Fac"], 0.02, 0.028)
        untint = 1.0
        rough = math_op(nt, "MULTIPLY_ADD", n_fine.outputs["Fac"], 0.1, 0.78)
        metal = 0.0
        lit = math_op(nt, "MULTIPLY", 0.1, aov)
        idle = 0.0

    def sock(v):
        if isinstance(v, (int, float)):
            n = N(nt, "ShaderNodeValue")
            n.outputs[0].default_value = v
            return n.outputs[0]
        return v

    alb, untint, rough, metal, lit, idle = map(sock, (alb, untint, rough, metal, lit, idle))

    bsdf = N(nt, "ShaderNodeBsdfPrincipled")
    # Preview colour: the coat in the default dark steel tone, untinted
    # surfaces as they are.
    tone = 0.05 if kind in ("plate", "palm") else 1.0  # ~ the default skin's hand tone
    prev = maprange(nt, untint, 0.0, 1.0, tone, 1.0)
    prev_alb = math_op(nt, "MULTIPLY", alb, prev)
    L(prev_alb, bsdf.inputs["Base Color"])
    L(rough, bsdf.inputs["Roughness"])
    L(metal, bsdf.inputs["Metallic"])
    L(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Emission Color"].default_value = (0.75, 0.9, 1.0, 1)
    L(math_op(nt, "MULTIPLY", idle, 2.0), bsdf.inputs["Emission Strength"])
    out = N(nt, "ShaderNodeOutputMaterial")
    L(bsdf.outputs[0], out.inputs["Surface"])
    img = N(nt, "ShaderNodeTexImage")
    nt.nodes.active = img
    emit = N(nt, "ShaderNodeEmission")
    comb = N(nt, "ShaderNodeCombineColor")
    taps = dict(albedo=[alb, alb, alb], untint=[untint, untint, untint], orm=[aov, rough, metal], emit=[lit, idle, sock(0.0)])
    mat["kind"] = kind
    return mat, dict(nt=nt, out=out, bsdf=bsdf, emit=emit, comb=comb, img=img, taps=taps)


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    plate, plate_t = make_material("plate", "plate")
    steel, steel_t = make_material("steel", "steel")
    rubber, rubber_t = make_material("rubber", "rubber")
    palm_m, palm_t = make_material("palm", "palm")
    mats = [plate, steel, rubber]

    root = bpy.data.objects.new("HAND", None)
    bpy.context.scene.collection.objects.link(root)

    parts = [palm([palm_m], root), palm_frame(mats, root), wrist(mats, root)]
    for i, f in enumerate(FINGERS):
        parent, loc = root, (f["x"], f["y"], f["z"])
        w, h = f["w"], f["h"]
        for s in range(3):
            child_h = h * TAPER
            ob = segment(f"F{i}_{s}", f["L"][s], w, h, w * TAPER, child_h, s == 2, mats, parent, loc)
            parts.append(ob)
            parent, loc = ob, (0, f["L"][s], 0)
            w, h = w * TAPER, child_h

    mount = bpy.data.objects.new("THUMB_MOUNT", None)
    bpy.context.scene.collection.objects.link(mount)
    mount.parent = root
    mount.location = THUMB["pivot"]
    mount.rotation_mode = "YXZ"  # roll, then pitch, then yaw
    # rot = (pitch about X, roll about Y, yaw about Z)
    mount.rotation_euler = (THUMB["rot"][0], THUMB["rot"][1], THUMB["rot"][2])
    parent, loc = mount, (0, 0, 0)
    w, h = THUMB["w"], THUMB["h"]
    for s in range(3):
        child_h = h * TAPER
        ob = segment(f"T_{s}", THUMB["L"][s], w, h, w * TAPER, child_h, s == 2, mats, parent, loc)
        parts.append(ob)
        parent, loc = ob, (0, THUMB["L"][s], 0)
        w, h = w * TAPER, child_h

    return root, parts, mount, (plate_t, steel_t, rubber_t), palm_t


def uv_unwrap(objs, margin):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def set_gpu(scn):
    scn.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scn.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001
        print("GPU setup failed:", e)


def bake_all(parts, hand_ts, palm_t):
    scn = bpy.context.scene
    set_gpu(scn)
    scn.cycles.samples = 24
    meshes = [p for p in parts if p.type == "MESH"]
    hand_objs = [p for p in meshes if p.name != "PALM"]
    palm_objs = [p for p in meshes if p.name == "PALM"]
    uv_unwrap(hand_objs, 0.006)
    uv_unwrap(palm_objs, 0.01)

    os.makedirs(OUT, exist_ok=True)
    imgs = {}

    def target(set_name, chan, size):
        key = (set_name, chan)
        if key not in imgs:
            im = bpy.data.images.new(f"{set_name}_{chan}", size, size, alpha=False, float_buffer=chan == "nrm")
            im.colorspace_settings.name = "sRGB" if chan == "albedo" else "Non-Color"
            imgs[key] = im
        return imgs[key]

    def route(t, chan):
        nt, out = t["nt"], t["out"]
        for l in list(out.inputs["Surface"].links):
            nt.links.remove(l)
        if chan == "nrm":
            nt.links.new(t["bsdf"].outputs[0], out.inputs["Surface"])
            return
        for i, s in enumerate(t["taps"][chan]):
            for l in list(t["comb"].inputs[i].links):
                nt.links.remove(l)
            nt.links.new(s, t["comb"].inputs[i])
        for l in list(t["emit"].inputs["Color"].links):
            nt.links.remove(l)
        nt.links.new(t["comb"].outputs[0], t["emit"].inputs["Color"])
        nt.links.new(t["emit"].outputs[0], out.inputs["Surface"])

    for chan in ("albedo", "untint", "orm", "emit", "nrm"):
        for set_name, ts, objs, size in (("hand", hand_ts, hand_objs, ATLAS), ("palm", (palm_t,), palm_objs, PALM_TEX)):
            if set_name == "palm" and chan in ("albedo", "untint"):
                continue
            im = target(set_name, chan, size)
            for t in ts:
                t["img"].image = im
                t["nt"].nodes.active = t["img"]
                route(t, chan)
            bpy.ops.object.select_all(action="DESELECT")
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            scn.cycles.samples = 8 if chan == "nrm" else 24
            if chan == "nrm":
                bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=6, use_clear=True)
            else:
                bpy.ops.object.bake(type="EMIT", margin=6, use_clear=True)
            print("baked", set_name, chan, flush=True)

    # Restore the shaded output for renders.
    for t in hand_ts + (palm_t,):
        route(t, "nrm")

    # Write: albedo RGB + untint A packed into one RGBA image.
    import numpy as np

    def pixels(im):
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        return a.reshape(im.size[1], im.size[0], 4)

    def write(name, arr, size, alpha):
        im = bpy.data.images.new(name, size, size, alpha=alpha)
        im.colorspace_settings.name = "Non-Color"  # the bytes go out as computed
        im.pixels.foreach_set(arr.astype(np.float32).ravel())
        im.filepath_raw = os.path.join(OUT, name)
        im.file_format = "WEBP"
        scn.render.image_settings.quality = 92
        im.save()
        print("wrote", name, flush=True)

    alb = pixels(imgs[("hand", "albedo")])
    unt = pixels(imgs[("hand", "untint")])
    # albedo image is sRGB-managed: Blender stores its pixels linear; write
    # the sRGB-encoded bytes so the file is a normal sRGB texture.
    lin = alb[..., :3]
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, None), 1 / 2.4) - 0.055)
    rgba = np.concatenate([np.clip(srgb, 0, 1), unt[..., :1]], axis=-1)
    write("hand_albedo.webp", rgba, ATLAS, True)
    for set_name, size in (("hand", ATLAS), ("palm", PALM_TEX)):
        for chan in ("orm", "emit", "nrm"):
            a = pixels(imgs[(set_name, chan)])
            a[..., 3] = 1.0
            write(f"{set_name}_{chan}.webp", np.clip(a, 0, 1), size, False)


def export(root, parts):
    # Unmaterialled: one primitive per part; the game builds the materials.
    for p in parts:
        if p.type == "MESH":
            p.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "hand.glb"),
        use_selection=True,
        export_materials="NONE",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_yup=True,
        export_apply=False,
    )
    print("wrote hand.glb", flush=True)


# ---------------------------------------------------------------------------
# Review renders: the poses the game drives
# ---------------------------------------------------------------------------

POSES = {
    "open": dict(f=[(0.08, 0.06, 0.04)] * 4, spread=0.07, t=(0.15, 0.1, 0.05)),
    "relaxed": dict(f=[(0.29, 0.37, 0.25), (0.33, 0.42, 0.29), (0.36, 0.45, 0.31), (0.4, 0.49, 0.33)], spread=0.02, t=(0.3, 0.3, 0.2)),
    "fist": dict(f=[(1.45, 1.6, 1.1)] * 4, spread=0.0, t=(0.75, 0.6, 0.7)),
    "gun": dict(f=[(0.0, 0.03, 0.02), (1.45, 1.6, 1.1), (1.45, 1.6, 1.1), (1.45, 1.6, 1.1)], spread=0.0, t=(-0.9, -0.05, 0.0), tz=-0.05),
    "grab": dict(f=[(0.75, 0.95, 0.7), (0.8, 1.0, 0.72), (0.85, 1.05, 0.75), (0.9, 1.1, 0.78)], spread=0.06, t=(0.45, 0.45, 0.35)),
}


def pose(parts_by_name, p):
    for i in range(4):
        for s in range(3):
            ob = parts_by_name[f"F{i}_{s}"]
            ob.rotation_mode = "XYZ"
            ob.rotation_euler = (-p["f"][i][s], 0, (1.5 - i) * p["spread"] * (1 if s == 0 else 0))
    for s in range(3):
        ob = parts_by_name[f"T_{s}"]
        ob.rotation_euler = (-p["t"][s], 0, p.get("tz", 0.0) if s == 0 else 0.0)


def render_reviews(root, parts):
    scn = bpy.context.scene
    set_gpu(scn)
    by = {p.name: p for p in parts}
    env = os.path.join(REPO, "public", "arena", "neon", "env_backstreet.jpg")
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    wn = world.node_tree
    bg = wn.nodes["Background"]
    if os.path.exists(env):
        et = wn.nodes.new("ShaderNodeTexEnvironment")
        et.image = bpy.data.images.load(env)
        wn.links.new(et.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0
    else:
        bg.inputs["Color"].default_value = (0.03, 0.035, 0.045, 1)
    scn.world = world
    key = bpy.data.lights.new("key", "AREA")
    key.energy = 6
    key.size = 0.25
    k = bpy.data.objects.new("key", key)
    scn.collection.objects.link(k)
    k.location = (0.25, -0.15, 0.35)
    k.rotation_euler = Euler((math.radians(40), 0, math.radians(120)))
    rim = bpy.data.lights.new("rim", "AREA")
    rim.energy = 4
    rim.size = 0.2
    rim.color = (0.55, 0.75, 1.0)
    r = bpy.data.objects.new("rim", rim)
    scn.collection.objects.link(r)
    r.location = (-0.3, 0.25, 0.2)
    r.rotation_euler = Euler((math.radians(60), 0, math.radians(-130)))
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 50
    cam_d.clip_start = 0.01
    cam = bpy.data.objects.new("cam", cam_d)
    scn.collection.objects.link(cam)
    scn.camera = cam
    target = bpy.data.objects.new("target", None)
    scn.collection.objects.link(target)
    target.location = (0.0, 0.02, 0.0)
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    scn.render.resolution_x = 960
    scn.render.resolution_y = 720
    scn.cycles.samples = 96
    scn.cycles.use_denoising = True
    scn.view_settings.view_transform = "AgX"
    os.makedirs(RENDERS, exist_ok=True)
    shots = [
        ("relaxed", (0.12, -0.20, 0.17)),
        ("open", (-0.05, -0.12, 0.26)),
        ("fist", (0.20, -0.10, 0.12)),
        ("gun", (0.24, 0.02, 0.10)),
        ("grab", (0.14, 0.2, -0.12)),
    ]
    for name, loc in shots:
        pose(by, POSES[name])
        cam.location = loc
        scn.render.filepath = os.path.join(RENDERS, f"hand_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name, flush=True)
    pose(by, POSES["open"])


def main():
    root, parts, mount, hand_ts, palm_t = build()
    if not NOBAKE:
        bake_all(parts, hand_ts, palm_t)
    if RENDER:
        render_reviews(root, parts)
    bpy.ops.wm.save_as_mainfile(filepath="C:/Users/alexv/Desktop/blendercyber/bake_work/hand.blend")
    for p in parts:
        p.rotation_euler = (0, 0, 0)
    if not NOBAKE:
        export(root, parts)


main()

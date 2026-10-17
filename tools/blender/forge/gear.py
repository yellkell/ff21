"""
THE FORGE's gear (docs/forge.md §3): build, unwrap, bake and export every
piece, and render its store icon.

    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
        --python tools/blender/forge/gear.py -- --only crest,pauldrons [--review] [--nobake] [--noicon]

Per piece, into public/forge/gear/:

    <id>.glb        up to three meshes named by FINISH — shell (the paint
                    surface), trim, glow — sharing ONE UV atlas
    <id>_nrm.webp   tangent-space normal (bevels, panel lines, machining)
    <id>_orm.webp   R occlusion · G roughness · B metalness (the shell's G
                    is RELATIVE: the game scales it by the tone's own)

and public/forge/icons/<id>.webp (the tile's render), and the piece's entry
in public/forge/gear/gear.json (its slot, triangle count, texture size).
--review renders a four-view sheet to renders/forge/gear_<id>.png.

Pieces live in pieces_<slot>.py: PIECES = {id: dict(slot=…, build=fn,
tex=512)}; build(ref) gets the slot's fitting reference (gearkit.reference)
and returns the piece's objects, each tagged with its finish.
"""

import importlib
import json
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gearkit as gk  # noqa: E402
import kit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = argv[argv.index("--only") + 1].split(",") if "--only" in argv else None
REVIEW = "--review" in argv
NOBAKE = "--nobake" in argv
NOICON = "--noicon" in argv
VERBOSE = "--verbose" in argv

OUT = os.path.join(kit.PUBLIC, "gear")
MODULES = ["pieces_head", "pieces_head2", "pieces_shoulders", "pieces_body", "pieces_hands", "pieces_face", "pieces_face2"]
BUDGET = {"head": 5000, "shoulders": 9000, "body": 7000, "hands": 3000, "face": 9000}


def catalogue():
    """Every piece from every pieces file. A file that is missing, mid-edit
    or broken is skipped with a note — one slot's work in progress never
    stops another slot's build."""
    out = {}
    for m in MODULES:
        try:
            mod = importlib.import_module(m)
            pieces = mod.PIECES
        except ModuleNotFoundError:
            continue
        except Exception as e:  # noqa: BLE001
            print(f"skipping {m}: {e!r}", flush=True)
            continue
        for pid, spec in pieces.items():
            out[pid] = spec
    return out


def join_finish(parts, finish):
    if not parts:
        return None
    for o in parts:
        gk.bake_mods(o)
        o.data.transform(o.matrix_basis)
        o.matrix_basis.identity()
        if VERBOSE:
            print(f"  {finish:5s} {o.name:12s} {tris(o):6d}", flush=True)
    kit.select_only(parts)
    if len(parts) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = finish
    ob.data.name = finish
    ob["finish"] = finish
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


MATS = {}
HIGH = [[]]


def finish_mat(finish):
    if finish not in MATS:
        if finish == "shell":
            MATS[finish] = kit.make_finish("shell", "shell", bevel=0.0012, ao_dist=0.025)
        elif finish == "trim":
            MATS[finish] = kit.make_finish("trim", "trim", bevel=0.0008, ao_dist=0.02)
        else:
            MATS[finish] = kit.make_finish("glow", "glow", bevel=0.0006, ao_dist=0.01)
    return MATS[finish]


def build_piece(pid, spec):
    kit.reset()
    MATS.clear()  # the reset removed the last piece's materials
    scn = bpy.context.scene
    kit.set_gpu(scn)
    ref = gk.reference(spec["slot"])
    objs = spec["build"](ref)
    groups = {f: [o for o in objs if o.get("finish") == f] for f in ("shell", "trim", "glow")}
    # HIGH: sculpt-density surfaces the SHELL's normal map is baked from
    # (an animal's fur tufts, a muzzle's folds), never exported.
    highs = [o for o in objs if o.get("finish") == "high"]
    for o in highs:
        gk.bake_mods(o)
        o.data.transform(o.matrix_basis)
        o.matrix_basis.identity()
        o.hide_render = True
    HIGH[0] = highs
    finals = [o for o in (join_finish(groups[f], f) for f in ("shell", "trim", "glow")) if o is not None]
    for o in finals:
        o.data.materials.clear()
        o.data.materials.append(finish_mat(o["finish"])[0])
        # Sharp creases stay sharp, plates stay smooth.
        gk.weighted(o)
        gk.bake_mods(o)
    n = sum(tris(o) for o in finals)
    budget = spec.get("budget", BUDGET[spec["slot"]])
    print(f"piece {pid}: {n} triangles (budget {budget})", flush=True)
    if n > budget:
        print(f"WARNING {pid} is over budget", flush=True)
    return ref, finals, n


def bake_piece(pid, spec, finals):
    size = spec.get("tex", 512)
    kit.smart_uv(finals, margin=0.006 if size <= 512 else 0.004, angle=spec.get("uv_angle", 50.0))
    taps = [finish_mat(o["finish"])[1] for o in finals]
    nrm = kit.new_image(f"{pid}_nrm", size, "nrm")
    orm = kit.new_image(f"{pid}_orm", size, "orm")
    highs = HIGH[0]
    shell = [o for o in finals if o["finish"] == "shell"]
    if highs and shell:
        # The shell from its sculpt, then everything else from its own
        # bevels, into the same sheet (islands never overlap).
        for o in highs:
            o.hide_render = False
        kit.bake(shell, [finish_mat("shell")[1]], "nrm", nrm, samples=1, high=highs, extrusion=spec.get("cage", 0.006), margin=6)
        for o in highs:
            o.hide_render = True
        rest = [o for o in finals if o["finish"] != "shell"]
        if rest:
            # Trim and glow from their own bevels into a second sheet, then
            # laid over the shell's wherever their islands are (a mask
            # pass) — a second bake into the same sheet would smear its
            # margins over the shell's edges.
            rtaps = [finish_mat(o["finish"])[1] for o in rest]
            nb = kit.new_image(f"{pid}_nrm_rest", size, "nrm")
            mk = kit.new_image(f"{pid}_mask", size, "orm")
            kit.bake(rest, rtaps, "nrm", nb, samples=16, margin=6)
            kit.bake(rest, rtaps, "mask", mk, samples=1, margin=0)
            A, B, M = kit.pixels(nrm), kit.pixels(nb), kit.pixels(mk)
            sel = M[..., :1] > 0.5
            out = A.copy()
            out[..., :3] = np.where(sel, B[..., :3], A[..., :3])
            nrm.pixels.foreach_set(out.astype(np.float32).ravel())
    else:
        kit.bake(finals, taps, "nrm", nrm, samples=16, margin=6)
    kit.bake(finals, taps, "orm", orm, samples=48, margin=6)
    a = kit.pixels(nrm)
    a[..., 3] = 1
    kit.write_webp(os.path.join(OUT, f"{pid}_nrm.webp"), a, 92)
    b = kit.pixels(orm)
    b[..., 3] = 1
    kit.write_webp(os.path.join(OUT, f"{pid}_orm.webp"), b, 90)
    return size


def export_piece(pid, finals):
    # Export copies so the scene keeps its materials for the renders.
    copies = []
    for o in finals:
        c = o.copy()
        c.data = o.data.copy()
        c.name = o["finish"]
        c.data.name = o["finish"]
        kit.link(c)
        copies.append(c)
    for o in finals:
        o.name = o.name + "_scene"
    for c in copies:
        c.name = c["finish"]
    kit.export_glb(copies, os.path.join(OUT, f"{pid}.glb"))
    for c in copies:
        bpy.data.objects.remove(c, do_unlink=True)


# Where each slot's icon and review cameras look (game space of the slot).
VIEW = {
    "head": dict(target=(0, 0.03, 0), dist=0.95, yaw=-32, pitch=14),
    "face": dict(target=(0, 0.01, -0.01), dist=0.95, yaw=-30, pitch=8),
    "shoulders": dict(target=(0, 0.31, 0), dist=1.55, yaw=-30, pitch=12),
    "body": dict(target=(0, 0.18, 0), dist=2.0, yaw=-30, pitch=8),
    "hands": dict(target=(0, 0.0, 0.0), dist=0.62, yaw=-40, pitch=38),
}


def ref_material(ref, slot):
    """What the piece is shown on: the body and skull a neutral grey; the
    hand in the game's own dark machined steel, so a white piece on it
    reads at a glance (as it does in the headset)."""
    m = bpy.data.materials.new("ref")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    if slot == "hands":
        b.inputs["Base Color"].default_value = (0.018, 0.02, 0.025, 1)
        b.inputs["Roughness"].default_value = 0.32
        b.inputs["Metallic"].default_value = 0.85
    else:
        b.inputs["Base Color"].default_value = (0.32, 0.33, 0.36, 1)
        b.inputs["Roughness"].default_value = 0.6
    ref.data.materials.clear()
    ref.data.materials.append(m)


def views(pid, spec, ref, finals):
    scn = bpy.context.scene
    v = dict(VIEW[spec["slot"]], **spec.get("view", {}))
    ref_material(ref, spec["slot"])
    piv = bpy.data.objects.new("piv", None)
    kit.link(piv)
    for o in [ref, *finals]:
        o.parent = piv
    if not NOICON:
        kit.studio(scn, bg=(0.3, 0.32, 0.36), transparent=True, strength=1.35)
        piv.rotation_euler.z = math.radians(v["yaw"])
        kit.camera(scn, v["target"], dist=v["dist"], yaw_deg=0, pitch_deg=v["pitch"], lens=85)
        path = os.path.join(kit.WORK, "icons", f"{pid}.png")
        kit.render_to(scn, path, res=(400, 400), samples=64)
        img = bpy.data.images.load(path)
        kit.write_webp(os.path.join(kit.PUBLIC, "icons", f"{pid}.webp"), kit.pixels(img), 88)
        for o in list(bpy.data.objects):
            if o.type == "LIGHT":
                bpy.data.objects.remove(o, do_unlink=True)
    if REVIEW:
        kit.studio(scn, bg=(0.035, 0.038, 0.045), transparent=False)
        shots = []
        for name, yaw in (("front", 0), ("three", v["yaw"]), ("side", -90), ("back", 180 + 30)):
            piv.rotation_euler.z = math.radians(yaw)
            kit.camera(scn, v["target"], dist=v["dist"], yaw_deg=0, pitch_deg=v["pitch"], lens=85)
            path = os.path.join(kit.WORK, "review", f"{pid}_{name}.png")
            kit.render_to(scn, path, res=(700, 700), samples=64)
            shots.append(path)
        # A 2 × 2 sheet.
        import numpy as np
        ims = [kit.pixels(bpy.data.images.load(p)) for p in shots]
        h, w = ims[0].shape[:2]
        sheet = np.zeros((h * 2, w * 2, 4), np.float32)
        for i, im in enumerate(ims):
            r, c = 1 - i // 2, i % 2  # pixel rows run bottom-up
            sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = im
        out = bpy.data.images.new(f"sheet_{pid}", w * 2, h * 2, alpha=True)
        out.pixels.foreach_set(sheet.ravel())
        out.filepath_raw = os.path.join(kit.RENDERS, f"gear_{pid}.png")
        out.file_format = "PNG"
        os.makedirs(kit.RENDERS, exist_ok=True)
        out.save()
        print("review", out.filepath_raw, flush=True)


def write_manifest():
    """gear.json from every piece's own meta file (several builds may run
    at once; each writes only its own, and the manifest is reassembled)."""
    mdir = os.path.join(OUT, "meta")
    meta = {}
    if os.path.isdir(mdir):
        for name in sorted(os.listdir(mdir)):
            if name.endswith(".json"):
                with open(os.path.join(mdir, name)) as f:
                    meta[name[:-5]] = json.load(f)
    with open(os.path.join(OUT, "gear.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"), sort_keys=True)


def main():
    cat = catalogue()
    ids = ONLY or list(cat)
    os.makedirs(os.path.join(OUT, "meta"), exist_ok=True)
    for pid in ids:
        spec = cat.get(pid)
        if not spec:
            print("no such piece", pid, flush=True)
            continue
        ref, finals, n = build_piece(pid, spec)
        if not NOBAKE:
            size = bake_piece(pid, spec, finals)
            export_piece(pid, finals)
            entry = dict(slot=spec["slot"], tris=n, tex=size, finishes=[o["finish"] for o in finals])
            if "fit" in spec:
                entry["fit"] = spec["fit"]  # a worn head's cranium, for the headgear (heads.ts HEAD_FIT)
            with open(os.path.join(OUT, "meta", f"{pid}.json"), "w") as f:
                json.dump(entry, f, separators=(",", ":"))
            write_manifest()
        views(pid, spec, ref, finals)
        os.makedirs(os.path.join(kit.WORK, "blend"), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kit.WORK, "blend", f"{pid}.blend"))


if __name__ == "__main__":
    main()

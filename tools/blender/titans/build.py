"""
Build arcade titans from their modules into public/arena/titans/<style>.glb.

    blender -b --factory-startup --python tools/blender/titans/build.py -- hook piston --render
    blender -b --factory-startup --python tools/blender/titans/build.py -- all --noao

--render     review stills (front ¾, profile, back ¾, head) into --shots DIR
--noao       skip the ambient-occlusion bake (fast iteration)
--shots DIR  where the stills land (default: ../blendercyber/renders/titans)
"""

import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import kit  # noqa: E402

STYLES = ["hook", "piston", "vulture", "fortress", "king"]

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
want = [a for a in argv if not a.startswith("--") and a in STYLES + ["all"]]
if "all" in want or not want:
    want = STYLES
render = "--render" in argv
ao = "--noao" not in argv
shots = os.path.join(ROOT, "..", "blendercyber", "renders", "titans")
if "--shots" in argv:
    shots = argv[argv.index("--shots") + 1]
views = None
if "--views" in argv:
    views = argv[argv.index("--views") + 1].split(",")

for style in want:
    t0 = time.time()
    mod = importlib.import_module(style)
    importlib.reload(kit)
    importlib.reload(mod)
    kit.reset()
    kit.contract_mats(mod.ACCENT)
    R = mod.build(kit)
    E, meshes = kit.assemble(R, getattr(mod, "EXTRA_MOUNTS", ()))
    kit.pose_rest(E, True)
    import bpy  # noqa: E402

    bpy.context.view_layer.update()
    top = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
    if ao:
        kit.bake_ao(meshes)
    if render:
        os.makedirs(shots, exist_ok=True)
        cam = kit.studio(top, mod.ACCENT)
        V = {
            "front": dict(yaw_deg=-28, pitch_deg=4),
            "side": dict(yaw_deg=-90, pitch_deg=3),
            "back": dict(yaw_deg=-155, pitch_deg=10),
            "head": dict(yaw_deg=-24, pitch_deg=2, dist=0.6, aim=R.head.z / top),
            "hand": dict(yaw_deg=-50, pitch_deg=-4, dist=0.7, aim=0.22),
        }
        for v in views or ["front", "side", "back", "head"]:
            kit.shoot(cam, os.path.join(shots, f"{style}_{v}.png"), height=top, **V[v])
        for n in ("floor", "key", "fill", "rimL", "rimR", "top", "cam"):
            o = bpy.data.objects.get(n)
            if o:
                kit.remove(o)
    kit.pose_rest(E, False)
    tris = kit.stats(meshes)
    kit.export(
        os.path.join(ROOT, "public", "arena", "titans", f"{style}.glb"),
        E,
        {"height": round(top, 4), "tris": tris},
    )
    print(f"{style}: {time.time() - t0:.1f}s")

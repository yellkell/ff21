# Titan builder brief (shared by every titan module)

FIRE FIGHT 2 is a WebXR fireball-boxing game on Quest 3, set in a rain-soaked cyberpunk neon district
(Japanese back alleys, a plaza, neon signs, wet asphalt). The five arcade "titans" are bosses that float
3–4 m in front of the player and are hit with fireballs at their glowing weak points. They used to be
90s robot-wars machines made of boxes. We are rebuilding each one in Blender, from code, as a
**modern cyberpunk robot** with a **new, distinct silhouette**. Each keeps its name and its fight.

## How the pipeline works
- `tools/blender/titans/kit.py` is the shared workshop. Read its docstring and API before you start.
  - Materials: `mat()` and `contract_mats()`.
  - Primitives: `box`, `cyl`, `torus`, `sphere`, `tube` (a swept spline), `prism` (an extruded outline),
    `lathe`, `text`, `vents`, `bolts`, `mirror`.
  - **`Shell`**: a superellipse loft with `.mesh()`, `.plate()` (chamfered armour that conforms to the
    shell), `.strip()` (light lines) and `.at()` / `.frame_at()` for placing details on the surface.
  - `Rig`: the joint layout, plus `R.digit(...)` and `R.extra`.
  - `put(mount, obj)`: hands a part to a joint.
- `tools/blender/titans/hook.py` is the finished reference titan (I). Read it fully; it shows every idiom.
- `build.py` builds a module into `public/arena/titans/<style>.glb` and renders review stills.
  - Fast iteration (no AO bake):
    `sh /c/Users/alexv/Desktop/blendercyber/tools/titan.sh <style> --render --noao`
  - Final build (with AO):
    `sh /c/Users/alexv/Desktop/blendercyber/tools/titan.sh <style> --render`
  - Stills land in `C:/Users/alexv/Desktop/blendercyber/renders/titans/<style>_{front,side,back,head}.png`.
    Look at them with the Read tool every iteration.
  - `--views front,side,back,head,hand` picks views.
- The game (`src/campaign/titanKit.ts`) loads the GLB and builds the boss rig from it. You do NOT edit game
  code; you only write your module.

## The contract (must hold or the fight breaks)
- Blender is Z-up and the machine faces **+Y**. Build at unit scale; the game multiplies by the titan's
  scale.
- Keep the Rig's joint lengths: upper arm 0.5, forearm 0.42, hand 0.1 below the wrist. You may set
  `shoulder_z`, `head_z`, `head_y`, `yoke_w` and `core`, but only as specified in your brief.
- Mounts:
  - `TITAN` (root parts);
  - `CHEST`;
  - `HEAD` (the head rotates as a unit to look at the player; put no neck that must stay attached to the
    chest on HEAD);
  - `ARM_i` (shoulder pivot, i=0 is −X), `ELBOW_i`, `WRIST_i`, `HAND_i`;
  - `DIGIT_i_k`, made via `R.digit(i, k, hinge_pos, open, closed)`. These are radians about local X,
    where negative curls a forward-pointing finger downward;
  - `WING_i` / `WINGWRIST_i` (VULTURE only).
- Arms are authored hanging straight down −Z from the pivots. The game poses them; the renders show the
  rest pose.
- **Elbows**: the game re-solves the visible arm every frame with two-bone IK. The elbow always points out,
  down and back.
  - Put the elbow's point (cop, cap, guard) on the **back** (−Y) of the elbow.
  - Put the forearm's "front" armour on +Y.
  - Never model anything that only works with a backward-bent elbow.
- **Hands (user feedback; the old titans got this wrong)**:
  - Hands hang **in line with the forearm**: the palm block continues straight down below the wrist, and
    the fingers continue straight down from it. No fingers sticking out at 90°.
  - **The palm faces the FRONT (+Y)**, and every digit curls toward +Y, so `closed` is **positive**
    (e.g. `R.digit(i, k, pos, 0.05, 1.3)`).
  - **The thumb sits on the OUTER edge**, away from the body's midline: x = side × (half the palm width),
    like a human hand held palm-forward. It closes across the palm.
  - Blocks, rams, claws and other non-hand tools also hang in line with the forearm.
  - `hook.py`'s left-hand MANIPULATOR is the reference.
- Weak-point lamps are their own objects with their own materials. Each one's centre is its hitbox and
  scale-pulse centre:
  - `put("EYE_0", ...)`, `EYE_1`… with material `visor`. These are the head tell; they must read from
    4 m away.
  - `put("CORE", ...)` with `core`: the chest core, near `R.core`.
  - `put("LOW", ...)` with `low`: on the pelvis front, about (0, ~0.13, 0.5).
  - `put("SHOULDER_0", ...)` / `SHOULDER_1` with `shoulder_0` / `shoulder_1`: at about (∓0.38·w, ~0.1,
    1.33·…) on the shoulder fronts. These ride the root, not the arm.
- Every titan also needs:
  - `R.extra.append(("EYEFX", point_in_front_of_eye, "HEAD"))`.
  - Two launcher mouths using materials `pod_0` (−X) and `pod_1` (+X). Fireball volleys launch from
    about (±0.37, 0, 1.44), so mount the mouths near there on the shoulders (anywhere that reads if the
    titan never volleys).
- Material names starting `glow` (`glow`, `glow_dim`) are lit in the titan's accent by the game. Use
  `lamp_white` for white lights. Every other material ships as authored: plain Principled values, no
  textures.
- Budget: **≤ 70k triangles**, ≤ 14 materials. Use modest segment counts on small parts (12–24).
- Edit only your own module file. Never edit kit.py, build.py, hook.py or anything else. If you need a
  helper, define it locally in your module.

## The bar
- **Modern cyberpunk.**
  - Contemporary robotics and mecha: composite shells over exposed actuators, hard-surface panelling with
    crisp chamfers and real gaps, light lines in the seams.
  - Real mechanical logic: every joint gets a hub or actuator, every cable a clamp or guide, and plates
    get fasteners.
  - Believable livery: stencils, serials, hazard banding, kanji, and the corporate or police markings
    that fit the character.
- The user wants obsessive realism, but the boss is seen in VR from 3–4 m in dim neon light. **Bold,
  readable silhouette first**, then mid-scale form, then detail.
- **No pillowy shapes.** Use superellipse n ≥ 4 for armour and chamfered plates (`Shell.plate`).
- **No flaps (user feedback).** Use a few large, clean panels, not many small plates, slats, blades, fins
  and stacked layers.
  - Each body part gets one or two big panels with clear seams.
  - Detail comes from function (joints, actuators, lamps, vents, markings), not from extra plates.
  - If you're adding a 4th small plate somewhere, stop.
- Nothing should read as a toy on a stand.
- The silhouette must be unmistakable from the other four titans:
  - I hook: lean grappler with a thruster tail and a crane hook;
  - II piston: top-heavy demolition press;
  - III vulture: stealth bird of prey with wings;
  - IV fortress: wide riot-police hover tank;
  - V king: tall regal samurai kingpin with a halo.
- Iterate: build, Read the renders, critique honestly (proportion, silhouette, pillowy-ness, clutter,
  realism), fix. Do at least 4 render rounds.
- Finish with a final AO build, then report:
  - the triangle count;
  - the render paths;
  - a short description of the design;
  - anything you could not satisfy.

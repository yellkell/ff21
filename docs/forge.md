# THE FORGE — customisation, rebuilt in Blender

DESIGN.md §5 made the blank, the gear shop and the paint. Every shape in
it was built at runtime from three.js primitives — boxes, cones, lathes,
lofts — and it looked it: domes that were spheres, horns that were tubes,
a body that was seventeen ellipses stitched together. THE FORGE replaces
the shapes, not the system: the slots, the ids people own, the wire, the
paint and the store all stay. What changes is where the shapes come from.

## 1 · What the Forge makes

Everything is authored in Blender (`tools/blender/forge/`), baked high →
low, and shipped as a GLB plus two textures per asset under
`public/forge/`:

| Asset | Files | Notes |
| --- | --- | --- |
| a FRAME (body shape) | `frames/<id>.glb`, `<id>_nrm.webp`, `<id>_orm.webp` | one grid surface, cylindrical UVs shared by every frame |
| a GEAR piece | `gear/<id>.glb`, `<id>_nrm.webp`, `<id>_orm.webp` | meshes split by finish: `shell` (paint), `trim`, `glow` |
| a store ICON | `icons/<id>.webp` | a studio render of the piece worn, transparent |

`public/forge/manifest.json` lists every asset with its measurements (a
frame's ring chart, a piece's anchor), so the game never guesses.

## 2 · FRAMES — pick your build, keep your hitbox

THE BLANK gets siblings. A FRAME is a body shape you pick for preference
on the locker's BODY board (free, like the tone): STANDARD (the blank as
it always stood, sculpted), LEAN, HEAVY and CURVED. They differ in
shoulder, chest, waist and hip — slightly — and share everything else:

- **One hitbox.** BODY_IK's spheres never change; every frame runs inside
  the same envelope and the neck tops out at the same seat (0.488), so
  the head floats where it always did.
- **One unwrap.** Every frame is the same grid — the same columns round,
  the same rows down — and row k is the same place on the body in every
  frame (the clavicle row, the waist row…). A frame's UV is (u, s): u
  round by angle exactly as the old loft (front at 0.75), s the
  anatomical row. So **paint follows you between frames**: a stripe on
  the left pec lands on the left pec of whatever you change into, and
  STANDARD's rows sit where the old loft's did, so every look painted
  before the Forge stays where it was.
- **One chart per frame.** THE PAINT measures marks in metres along the
  surface (paint.md §4). Each frame ships its own ring chart, so a dot is
  round on HEAVY's chest and LEAN's alike.
- **On the wire** a frame is a sixth gear slot, `frame`, packed last
  (older readers drop it and see STANDARD). STANDARD is the empty slot.
- **Gear fits the frame.** Body and shoulder pieces are modelled on
  STANDARD and carried onto other frames by each piece's ANCHOR (the
  shoulder line, the chest, the waist): the frame's ring there over
  STANDARD's ring there is the fit, per axis.

## 3 · GEAR — the same ids, remade

Every id in the catalogue keeps its slot, price and meaning; its shape is
rebuilt in Blender to the hands' standard (`tools/blender/hand.py`, the
kit the user kept): real bevels, panel breaks, machined trim, baked
normal/AO. A piece is three finishes:

- **shell** — the paintable plate, primed in the body's tone; the paint
  canvas is its colour, the baked normal + AO ride under it.
- **trim** — machined steel/rubber that keeps its contrast under any
  paint (gunmetal on white, pale steel on onyx), as before.
- **glow** — the lit accent (eyes, studs, nozzles), in the fighter's hue.

THE PAINT's gear decals keep working unchanged in kind: the atlas map is
rasterized from the piece's own Blender UVs instead of a runtime packing,
so a mark is still placed in 3D, true to size, per pad and per plate.
The Forge's UVs are a new layout, so a gear mark made on the old
procedural shape is re-flagged as a legacy stamp (like the pre-atlas
marks), never lost.

## 3½ · FLOPS — parts that swing

Some parts swing as the wearer moves: the antennae's whips, a tail, a
cape's cloth, an epaulet's fringe, a bunny's ears, an eagle's plume. In
Blender a part is tagged `gk.fin(obj, finish, flop="name")` and the piece
spec gives `flops={name: dict(pivot, dir, len, stiff, damp, swing,
block?)}`; it exports as its own meshes ("shell@name"…). In the game
(`src/avatar/flop.ts`) each flop is one particle — its tip — on a spring
to where the tip would be if the part were rigid; the lag becomes a
rotation about the pivot, applied in the vertex shader and graded root to
tip, so the part bends. `block` is a direction the tip never swings toward
(a cape never swings into the back). Local and cosmetic: nothing rides
the wire; a flop off-screen costs nothing; paint and raycasts see it at
rest. `forge-preview.html?move=1` sways the figures to watch them.

## 4 · The store, with pictures

Every tile in GEAR and BODY shows the piece itself — a Blender render on
a primer bust, the same light for every piece — instead of a flat
glyph. The icons load lazily and the panel repaints when they land.

## 5 · Budgets (Quest 3, a full club)

- A frame ≤ 8k triangles; a gear piece ≤ 6k (heads ≤ 10k).
- Textures 512² per piece (1024² for frames, heads, capes and wings),
  WebP, loaded only when someone in the room wears the piece.
- Two to three draw calls per worn piece (one per finish).

## 6 · Working on the Forge

- Frames: `tools/blender/forge/frames.py` (`--render` for a lineup,
  `--icons` for the BODY tiles).
- Gear: `tools/blender/forge/gear.py -- --only <ids> [--review]`; the
  modelling brief is `tools/blender/forge/BRIEF.md`; pieces live in
  `pieces_<slot>.py`.
- In the browser: `forge-preview.html?gear=<ids>&frames=…&paint=1` (the
  real rig, every frame side by side); `npm run gear:gallery` (every
  piece worn, front and back); `npm run check:forge` (the BODY board, a
  frame on the wire, a forged piece on the mirror, store renders, the bay
  aiming at forged gear).
- Paint: a mark placed on a forged piece carries the FORGE_ATLAS variant
  bit; an older gear mark is carried onto the forged piece by where it sat
  in 3D on the old shape (`setGearRemap`, gear.ts).

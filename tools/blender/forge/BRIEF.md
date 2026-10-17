# THE FORGE — modelling brief for gear pieces

Read `docs/forge.md` first. This is the working brief for remaking a gear
piece in Blender. The catalogue (ids, names, slots, prices, one-line
blurbs) is `GEAR` in `src/avatar/gear.ts`: **every id keeps its meaning**
— players already own these pieces, so CREST is still a dorsal fin nose to
nape, HALO still a ring that floats with no wire. Read the procedural
builder for your piece in `src/avatar/gear.ts` (and `src/avatar/heads.ts`
for the animal heads) for what it was meant to be, then make it properly.

## The bar

The user wants a *dramatic* jump in quality and judges with a pedantic,
obsessive realism bar. Blockout-grade work is rejected. Things the user
has rejected before, on robots and armour:

- "too many flaps": rib slats, hip blades, stacked thin plates, small fins
  everywhere. Use **a few large clean panels**; detail comes from
  function (a hinge, a rim, a rivet line, a vent), not from extra plates.
- shapes that read as primitives (a sphere for a dome, a cone for a
  spike, a torus for a bangle).
- **timid pieces.** The first Forge pauldrons — neat hemispheres hugging
  the shoulder caps — were rejected outright: "weird little cups, nobody
  would want to wear that". Gear is a cosmetic people PAY for: bold,
  readable silhouettes that change the wearer's outline from across a
  room (premium Halo / Overwatch / Fortnite cosmetics), confident scale,
  strong primary forms with crisp secondary detail. Something small and
  careful sitting flush on the body reads as nothing in VR.
- hands at 90° to the forearm, thumbs on the inner edge, backward elbows
  (titans — relevant to anything hand- or arm-like).

The house style is **machined armour over a ceramic shell**: smooth,
paintable shell plates with crisp bevelled edges and real thickness;
gunmetal TRIM where metal would be (rims, rivets, hinges, frames, bolts,
cable runs); a little GLOW (the wearer's accent colour) used sparingly
and functionally (a slit, a vent, an eye, a seam). Bevels everywhere —
nothing razor-sharp; the bake turns every bevel into a highlight line.

## The heads: clean cyberpunk, not FF1 remakes

The first Forge animal heads were faithful, plush remakes of the FF1
animals (fur tufts, glossy eyeballs with pupils, cartoon cheeks) and the
user rejected them: "stuck too close to their original counterparts …
we have to think about our clean cyberpunk setting". The heads are CLEAN
CYBERPUNK animal helmets: hard-surface, sleek ceramic panels with crisp
seams, the animal carried by silhouette and a few strong planes; eyes as
lit visor slits, LED strips or lenses (never eyeballs); fur and feathers
as a few bold engineered blade-plates; noses and mouths as machined trim
(grilles, vents, jaw seams); ears as engineered fins. (The STALLION was
"okay" — the most organic the set may go.)

## Finishes (tag every object with `gk.fin(obj, finish)`)

- `shell` — the PAINT surface. Players paint stripes and dots on it, so
  give it broad, smooth, readable areas. Primed white or black in game.
- `trim` — machined steel, keeps its contrast under any paint.
- `glow` — emissive in the player's accent. Small areas only.
- `high` — optional, never exported: a dense sculpt (subdivided, voxel-
  remeshed, displaced) of the SHELL. When present, the shell's normal map
  is baked from it (selected → active, cage `spec["cage"]`, default 6 mm),
  so a low shell can carry sculpted detail (fur tufts, muzzle folds,
  panel seams). Keep the high within a few mm of the low shell.

## Spaces (game space: +y up, front is −z, metres)

The kit authors everything in GAME space; `gk.reference(slot)` builds the
thing you fit to in the same space. `gk.hit`, `gk.surface_point`,
`gk.inside` query it.

- **head** — the head group: origin at the head's centre. The bare skull
  is a sphere of radius 0.13 scaled (x 0.94, y 1.0, z 0.97), its centre
  at y = +0.0065. Model on THAT skull (no refit). Headgear is also carried
  onto the animal heads by a per-head fit, so keep pieces on the cranium
  (crown, brow, temples, nape) — not on the face.
- **face** — the same head space; a worn head REPLACES the skull. It must
  enclose roughly the head sphere (the hitbox is a sphere r 0.13 at the
  origin; snouts, ears and beaks may stand out of it), about four-fifths
  the size of the old FF1 heads. Eyes are GLOW. The shell is a paint
  surface (`gearFace`). Add a `fit` to the piece spec — the cranium's
  scale and offset relative to the bare skull, `dict(s=(sx, sy, sz),
  y=dy, z=dz)` — so headgear lands on your head's dome (measure it).
- **shoulders / body** — the body group, hip-local (y = 0 at the pelvis,
  the neck tops out at y = 0.488, the floating head's underside is about
  y = 0.50 — keep clear of it). THE BLANK's STANDARD frame is the
  reference: shoulder caps are spheres r 0.054 at (±0.198, 0.372, 0.004),
  chest ±0.17 × 0.10 at y 0.30, waist pinch ±0.09 × 0.074 at y 0.13, hip
  line ±0.13 × 0.10 at y −0.02, tip at −0.23. No arms (the hands float).
  Pieces are carried onto the other frames (LEAN, HEAVY, CURVED) by
  scaling at an anchor height, so sit pieces ON the surface with a few
  mm of gap — use `gk.trimmed_dome`, `gk.inside`, shrinkwrap-free
  fitting. Symmetric pairs: build the left (+x) and add
  `gk.mirrored_copy(o)` so each side is its own geometry (its own paint).
- **hands** — the hand group of the LEFT hand (the right is mirrored in
  game): palm at the origin, fingers toward −z, wrist/cuff toward +z, the
  BACK of the hand faces +y, the thumb is on +x. The reference is the
  real hand kit (`public/arena/hand/hand.glb`). Fingers ARTICULATE — the
  gear is rigid on the hand root — so stay on the back of the hand, the
  knuckle line, the wrist and forearm; nothing over the finger segments.

## Budgets (triangles, whole piece) and textures

head 5k · face 9k · shoulders 9k (the pair) · body 7k · hands 3k (one
hand). The runner prints the count; stay within it (lower ring/segment
counts, fewer bevel segments — the normal bake carries the rounding).
`tex` 512 for small pieces, 1024 for big ones (capes, wings, heads).

## The loop

```
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b --factory-startup \
    --python tools/blender/forge/gear.py -- --only <ids> --review [--nobake --noicon] [--verbose]
```

- `--nobake --noicon --review` is the fast modelling loop (~10 s): look at
  `C:/Users/alexv/Desktop/blendercyber/renders/forge/gear_<id>.png` (a 2×2
  sheet: front, three-quarter, side, back) with the Read tool. Look hard:
  intersections with the body, floating parts, faceting, proportion,
  silhouette from across a room.
- `--verbose` prints triangles per part.
- The final run is without `--nobake --noicon`: it bakes, exports
  `public/forge/gear/<id>.glb` + maps + `public/forge/icons/<id>.webp`.
  Check the icon reads at 100 px.
- Override the icon/review camera per piece with `view=dict(target=…,
  dist=…, yaw=…, pitch=…)` in the spec.

Helpers: `gearkit.py` (tube, lathe, radial_plate, extrude_outline,
trimmed_dome, rivet, ring, bevel/solidify/subsurf/boolean modifiers,
mirrored_copy, hit/inside/surface_point), `kit.py` (spaces). Put any new
helper in YOUR pieces file; do not edit kit.py, gearkit.py, gear.py or
another slot's file (other modellers are running in parallel). If the kit
has a bug you cannot work around, say so in your report.

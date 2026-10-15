# THE PAINT — how a blank becomes yours

The design of FF2's paint system (DESIGN.md §5.3, expanded): buying
individual stripes, dots, squares and triangles of colour, placing them minutely on your
own body, and carrying the result — your personal painting — into every
game, in front of every player, for as long as you keep adding to it.

The pillar it serves: **the paint is the endgame**. Cosmetic progression
is a canvas, not a catalogue. Everyone owns the same body (THE BLANK, all
white or all black); nobody can buy a look, only the materials to make
one. Two fighters with the same wallet history should still be
unmistakable at ten yards.

---

## 1 · What you buy

The shop sells **paint units**, individually, for coins (the one wallet —
fights, raids and rave sets all feed it):

| Item | What it is | Placement freedom |
| --- | --- | --- |
| **STRIPE** | A straight band of one colour | position · angle · length · thickness |
| **DOT** | A disc — the paint's atom (P5) | position · size |
| **SQUARE** | A square, cut not sprayed (P5) | position · angle · size |
| **TRIANGLE** | An equilateral triangle, the one that points (P7) | position · angle · size |

(The SPLOTCH is retired, P7: nothing sells it, and every splotch anyone
owned or wore became a DOT of its colour — see §7.)

- **Colour is the product.** Units are sold per colour: a rack of hues,
  cheap earth-and-primary tones first, hotter neons a tier up, and a
  short top shelf (metallic gold leaf, pearl white for onyx bodies, void
  black for white bodies) priced like the XD pad — flexes, not power.
- **You own counts, not licences**: buy three RED stripes, place three
  red stripes. **Removing a placed unit returns it to the locker
  intact** — paint is never consumed, so experimenting is free once
  you own the materials. (The brief's law: place AND remove, from your
  locker, minutely.)
- Pricing (tune in `config.ts` `PAINT` block): basic hue stripe 8
  coins, dot 5, square 7, triangle 6 — every unit under a game's pay.
  Neon tier ×2, top shelf ×4.
- **Where you buy**: the STORE's PAINT board stocks the locker a unit
  per tap, and the PAINT tab buys as you go — a colour you've run out of
  wears its price, and one tap buys one unit and puts it on your pointer.
  A first paint job (5–8 units) costs a handful of bouts, not a
  savings drive — the wardrobe still grows over weeks, which is the
  point ("lasting through games and added to over time"), but nobody
  waits to make their first mark.
- The tutorial's graduation gift gains one free stripe in the contrast
  tone (black stripe on a white body, white on onyx) so every player
  has touched the paint bay once.

## 2 · Where you paint — THE PAINT TAB

The third tab of the one customization plate — LOCKER · STORE · PAINT,
the same plate in the same place, opened from the YOU wing's CUSTOMIZE.
Your body (the mirror) comes in to arm's reach beside it (P7: it stood
two metres off, where a degree of aim was four centimetres of body).

The face, top to bottom: the four SHAPES; one grid of every colour on
the racks for the lit shape — owned colours wear their count, the rest
their price; THE HAND (what's on your pointer, and panel buttons to turn
it, size it and send it back) or, empty-handed, UNDO; the TURN (◂ FRONT ▸)
and CLOSE.

The verbs, all controller-native:

1. **Take** — tap a colour: it rides your ray as a ghost of the shape
   (a colour you don't own is bought, one unit, in the same tap).
2. **Place** — sweep the ray over your body; the ghost wraps the surface
   at the hit point, live, a little translucent until it lands. Trigger
   drops it. The mark lands where the ray was ~70 ms BEFORE the pull
   registered — pulling a trigger tugs the controller.
3. **Adjust while held** (the "minutely"): thumbstick **x** turns it,
   **y** sizes it (grip held: a stripe's thickness). A haptic tick at
   every eighth of a turn, and letting go near one clicks onto it. The
   panel's ↺ ↻ − + (THIN / THICK) do the same for anyone who'd rather press.
4. **Pick back up** — empty-handed, the pointer's dot turns blue and
   swells over a mark it can lift; trigger lifts it onto the ray.
   Picking is by the mark's OUTLINE (the topmost mark under the dot), so
   a long thin stripe lifts from its end.
5. **Return** — B (or BACK) sends the held unit to the locker.
6. **Undo** — A / X (or UNDO), empty-handed: the newest mark comes off
   and back into the locker.
7. **Turn** — ◂ ▸ step the body an eighth; the thumbstick spins it
   freely whenever it isn't adjusting a held mark. It eases, both ways.

THE STEADY HAND: the bay aims with its own copy of each ray, eased
toward the real one at a rate that climbs with the gap between them — a
tremor is soaked up, a deliberate sweep followed at once — and the
pointer's dot sits where the paint will land.

## 3 · The look, as data

One look = the base tone + an ordered list of placed units:

```ts
interface PlacedPaint {
  kind: 'stripe' | 'dot' | 'square' | 'triangle';
  colour: number;   // index into the sold palette (not a free RGB)
  variant: number;  // reserved (the retired splotch's silhouette roll)
  part: 'head' | 'body' | 'gearHead' | 'gearBody' | 'gearHands' | 'hand';  // P5: the gear slots; P6: your hands
  u: number; v: number;   // anchor in that part's unwrap, quantized /255
  angle: number;          // /255 over 2π
  len: number; wid: number; // /255 over that part's allowed range
}
interface Look {
  base: 'blank' | 'onyx';
  paint: PlacedPaint[];   // capped: 64 units
}
```

On the wire (format 4, P7) b0 carries the kind in bits 0..2 and the
part in bits 3..7; formats 1–3 still read, and a splotch in any of them
reads as a dot. Packed, one unit is **8 bytes**; a maxed look is ~520 bytes — smaller
than one pose packet burst. Caps and quantization are the moderation and
netcode story in one move: every field is clamped by construction, a
look can't be oversized, and the same bytes render the same everywhere.

Persistence: localStorage is the source of truth (like every FF pref).
Mirrored to the player's Firestore doc (`look`, base64) so the profile
card — and later stats.html and the gazette — can show the painting
behind the name.

## 4 · How it renders

The blank's lofts carry a **cylindrical unwrap** (ring index → v, angle
round the ring → u), and each paint surface gets a **paint canvas**
(head 256², body 768², gear 256² / 128², hands 256²):

1. Start from the base tone fill.
2. Rasterize each placed unit oldest-first, **true to size** (P7). The
   unwrap is not square on the body — u runs round each ring by angle, so
   the front of the shoulders spans almost twice the metres per texel
   that its height does, the waist much less, and the skull pinches to
   nothing at the crown — so a shape drawn flat on the canvas came out
   stretched. Each surface carries a CHART of its own geometry (the
   ring's half-width, half-depth and height per v), every texel near a
   unit is measured back to the unit's centre along the surface (across
   by the arc round its ring, down by the arc of its own meridian), and
   the shape is a signed distance in those metres, antialiased over the
   texel's own size. A dot is round wherever it lands, a stripe keeps its
   width round the side, a mark on the crown is a disc. Crossing the
   u-seam is free: the measure wraps. The hands have no chart and keep
   the flat canvas measure.
   **GEAR is painted as DECALS** (P8, `avatar/gearAtlas.ts`). Gear is built
   from plain primitives that each mapped the WHOLE texture onto
   themselves, so a mark on one crest plate landed on all eleven, a
   pauldron's twin wore its paint, and the chestplate (no UVs) took none.
   Now, when a piece is built, every mesh — and every face of a box, the
   side and caps of a cylinder — gets its own cell of the slot's canvas,
   sized by its real surface area, and every texel records the surface
   point, normal and texel size under it. A gear unit's (u, v) is the
   texel the ray hit; it paints every texel whose surface point lies
   inside its outline in the plane of the surface there (metres; a len of
   1 is 0.2 m), facing the same way and not through the far side — so a
   stripe crosses neighbouring plates at true size, and each pad, plate
   and spike takes paint of its own. Gear canvases filter without mips
   (an atlas bleeds between cells when mipped). A gear mark made before
   the atlas (wire format ≤ 4, or a saved look before LOOK_VERSION 2) is
   flagged and still stamped on every island in its own UVs, as it
   always was, until it is lifted or undone.
   Two more atlas rules. An EXTRUDED part (a fin, a blade, a bevelled
   plate — `userData.atlasSplit`) gives its two faces the same UVs, so
   its triangles are binned by facing and each bin mapped flat as its
   own island. And once the atlas is laid, the piece is MERGED
   (`mergePiece`): one mesh per finish, atlas UVs, paint tags and map
   intact — a few draw calls and one paint canvas per piece, not one per
   part.
3. Upload once as the part material's `map`.

A repaint happens **only when the look changes** — placing in the bay,
or a rival's look arriving. At runtime a painted fighter costs exactly
what a blank costs: same meshes, one static texture per part. THE GHOST
(the held unit in the bay) does not re-bake the look: it copies the
committed bake of the one part under the ray and draws one shape over it.

Onyx bodies keep their sheen: paint draws into the same map, and the
darker base simply reads through unpainted texels.

## 5 · How other players see it

The rule: **anywhere your body renders, your painting renders.**

- **Live rooms** — the packed look rides the channels that already carry
  cosmetics: the 1v1 `iam` message, `mesh.cosmetics` for 2v2/FFA/raid
  squads, and the pub/club hello. ~half a KB on reliable channels, sent
  once per join (and once on change while in a social room — repainting
  mid-duel is not a thing; the bay is a lobby/club activity).
- **On receive**: validate (cap count, clamp every field, unknown
  colour/variant → drop the unit, malformed look → bare base tone),
  then bake that player's part canvases once. A 24-head club joining
  costs 24 bakes on entry — canvas work measured in milliseconds,
  amortized by the join flow, never per-frame.
- **Spectators** at the pit see fighters through the same room stream —
  nothing extra to build; the look came in with the fighter.
- **Late data beats no data**: a fighter whose look hasn't arrived yet
  renders as their base tone and repaints the moment it lands — the
  same fail-soft law as every FF net feature.
- **Offline/bots**: bots stay factory-blank. That's flavour: unpainted
  means nobody's home.

## 6 · Moderation

Free placement can draw things we don't want in a room:

- The existing **report** path (create-only `reports` collection) gains
  a REPORT PAINT subject carrying the reported player's packed look —
  evidence included by construction, 520 bytes.
- The pub/club safety console's mute/block list gains **HIDE PAINT**:
  strictly local, renders that player (or everyone: one global toggle in
  settings) as bare base tone. Total defence, zero server work.
- The palette being an index (no free RGB) and units being solid single
  shapes keeps the offensive-drawing surface small but not zero — the
  local hide is the honest backstop, same philosophy as FF1's
  mute/block.

## 7 · Build order

1. **P1 — the canvas**: loft UVs + per-part paint canvases + the bake;
   `Look` model + localStorage; a dev-seeded look renders on your own
   body, the mirror and the podium. *(No UI yet — prove the pipeline.)*
   **SHIPPED**: `src/avatar/paint.ts` (Look + validation + bake +
   `__ff2.paint` dev verbs), the `PAINT` config block (24-colour
   append-only palette, 64-unit cap, per-part canvas sizes), seam-safe
   cylindrical UVs on the mannequin lofts (paint surfaces exempted from
   the static-merge collapse), and the bake wired into applyOwnSkins for
   your body, the mirror and the podium. Two real bugs found and fixed
   on the way: the loft's triangles wound INWARD (the game had been
   rendering the body's interior — the paint proved it), and paint
   surfaces had to be kept out of collapseStatic or they fused into one
   untagged batch.
2. **P2 — the bay**: tray panel, take/place/adjust/pick-up/return verbs,
   layer swap; shop sells stripes+splotches in the first two colour
   tiers; the graduation stripe.
   **SHIPPED** (layer swap deferred): THE PAINT BAY opens from the YOU
   wing — a kit modal (`src/menu/paintbay.ts`) beside the locker mirror
   with THE TRAY (owned counts) and THE RACK (base + neon racks priced
   off the PAINT config, wallet-debited). The body itself is the
   canvas: MenuSystem raycasts the mirror's paint surfaces — a held
   unit ghost-previews under the ray (throttled bakes), trigger places,
   the thumbstick twists and sizes (grip switches to width), pointing
   at placed paint and squeezing lifts it back into the hand, B returns
   it to the tray, and closing the bay never strands a held unit. The
   tutorial's graduation now grants the contrast stripe. Headless bay
   verbs on `__ff2.paint` + `__ff2.bayClick` walk the whole
   buy→take→place→lift→return loop in CI.
3. **P3 — the room sees you**: pack/validate/sync over `iam` +
   `mesh.cosmetics` + pub hello; bake-on-join; hide-paint toggles;
   report-paint.
   **SHIPPED**: the 8-byte wire form (`packLook`/`unpackLook` in
   avatar/paint.ts — base64 over every JSON channel, byte-stable under
   quantization, every received unit re-clamped through cleanUnit and
   anything malformed failing soft to the bare base tone). The look now
   rides all three cosmetics channels: the duel's `iam`, the mesh `iam`
   (2v2 / FFA / raid squads, stored per seat in `mesh.cosmetics`), and
   the club hello (kept on the server's player record so late joiners get
   it in welcome/join; a mid-visit repaint fans out as a relayed `LOOK`
   event). Bake-on-join everywhere a body renders: OpponentSystem bakes
   rivals/squadmates alongside their skins (bots stay factory-blank),
   PubPlayerSystem bakes each punter at spawn and on `LOOK`, and your own
   pit body carries your look into the club fight hall. Moderation both
   ways: a HIDE ALL PAINT breaker in settings, per-punter PAINT (bare
   their body) and REPORT (their packed look filed to the `reports`
   collection as evidence, `subject: 'paint'`) switches on the club
   safety console — all local, all instant via version-keyed rebakes.
   Headless: `npm run check:paint` (tools/paint-wire-check.mjs) proves the
   wire's roundtrip + fail-soft AND runs a real two-client room against
   the local pub relay: painted hello → roster → baked-on-join → LOOK
   repaint mid-visit.
4. **P4 — the record**: Firestore mirror, profile card rendering, the
   gazette learning to describe a champion's colours.
   **SHIPPED**: the player doc mirrors `look` (the packed wire string) +
   `tone`, written by `syncLookMirror` only when they actually change
   (seeded from the boot read so an unchanged look never re-writes; a
   look painted offline catches up at boot). The leaderboard rows carry
   both back down, and the PROFILE card now renders **the painting
   behind the name**: `paintBanner` bakes the front of the most-painted
   part flat — the same drawUnit pipeline the body wears — under a
   legibility scrim; an unpainted fighter keeps the clean card. The look
   also became WORDS: the palette gained index-parallel `colourNames`
   (BONE WHITE … CHROME), `paintColourNames` ranks a look's most-used
   colours, the gazette's wire report carried every player's `tone` +
   `colours` (dropped when the paper went to plain reporting), and stats.html rows wear paint chips decoded
   from the same doc field. Probed in `npm run check:paint`'s record
   stage (colour words + banner render both tones + no-banner-when-bare).
5. **P5 — gear, dots and squares.** **SHIPPED**: every worn piece of GEAR
   (avatar/gear.ts) is a paint surface — its slot (`gearHead` /
   `gearBody` / `gearHands`) owns a canvas every mesh of the piece
   wears, so painting one pauldron paints its twin, and gear is dressed
   BEFORE the look bakes wherever a body renders (own rigs, the mirror and
   podium, rivals, squadmates, punters, the pit). Two new kinds: DOT (a
   disc, one size) and SQUARE (spun by the stick, cut not sprayed), sold
   on the bay's rack beside stripes and splotches. The wire is format 3
   (kind in two bits, part above) and still reads formats 1 and 2. Sizing
   in the bay is capped at `PAINT.maxSize` — a sash across the chest,
   never a whole-body fill — and the stick's x twists / y sizes every
   kind (grip → width for the stripe only). Probed: roundtrip of dot,
   square and a gear-surface unit; the format-2 legacy read.
6. **P6 — the hands.** **SHIPPED**: the pair you punch with
   (avatar/hands.ts) is a paint surface, `hand` — the one part of you
   that is in front of your face all match, and until now the one part
   you could not touch. The PALM BLOCK carries it, on a material of its
   own: these boxes have no UV islands, so every face samples the whole
   canvas, and a mark on the hand's shared material landed on all eleven
   pieces at once. Both hands bake the same canvas — paint one, the pair
   wears it — and the steel they rest at is the canvas FILL
   (`userData.paintFill`, kept in step by `applyAvatarSkin`), so an
   unpainted hand bakes out exactly as it was built and the white
   squeeze-bloom rides the emissive channel, untouched. PAINT ON METAL:
   a near-mirror surface has no diffuse to carry a stripe, so a surface
   that actually holds units comes down to `PAINT.metalness` — never
   above its own finish, so a matte body is unaffected, and it steps
   back the moment the last unit is lifted. The wire is still format 3
   (part index 5, append-only). Probed: the bay places onto the hands,
   the pair roundtrips the wire, and the MIRROR's hand — the thing the
   bay's ray paints — bakes it.
7. **P7 — clean, steady, one plate.** **SHIPPED**: the PAINT tab of the
   one customization plate (LOCKER · STORE · PAINT, one CUSTOMIZE door
   on the YOU wing) replaces the separate bay modal, and the STORE gains
   a PAINT board; the mirror comes to arm's reach and eases through its
   turns; THE STEADY HAND and the trigger's lead; stick detents with
   haptic ticks; UNDO; panel nudges; picking by outline; the ghost drawn
   over a cached bake of one part (cheap enough for every frame, where
   the full re-bake ran ~11 times a second). Rendering is TRUE TO SIZE
   (§4). The SPLOTCH is retired (owned and placed ones became dots) and
   the TRIANGLE joins; wire format 4 carries it. And a real bug: the
   locker's reload only knew stripes and splotches, so every DOT and
   SQUARE bought vanished on the next boot — it reads every kind now.
   Probed in `npm run check:paint`: formats 2–3 read with splotch → dot,
   the locker survives a restart, a stripe picks at its end.
8. **P8 — gear as decals, and a rounder head.** **SHIPPED**: THE GEAR
   ATLAS (§4): every gear mesh and face its own patch of canvas, a map of
   the surface under every texel, and gear marks painted as 3D decals —
   the two PAULDRONS (horns, antennae, cuffs' pair aside: a hand piece is
   still one canvas for both hands) paint separately, the CHESTPLATE
   paints at all, a stripe runs across crest plates or mohawk spikes the
   way it was aimed instead of stamping itself on every one. Wire format
   5 (format 4's layout) says a gear unit is a decal; older gear units
   keep their old stamped look. The head is nearly round now
   (mannequin.ts HEAD_SCALE, from the old 0.84 × 1.08 × 0.93 egg to
   0.94 × 1.0 × 0.97), the head gear refitted to it (applyGear scales the
   piece by HEAD_SCALE / EGG_SCALE) and the neck seat computed from it.
   Probed in `npm run check:paint`: the pads are two patches, a dot on
   the left pad is not on the right, the chestplate takes a triangle, a
   format-4 gear mark reads as a stamp.

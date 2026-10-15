# FIRE FIGHT 2 — DESIGN

The sequel to FIRE FIGHT, with RAVE RAID folded in as a mode. One game, one
club, one body you paint over months. This document turns the kickoff brief
into a build plan grounded in the two shipped codebases:

- **FIRE FIGHT** (`yellkell/iron-balls-boxing`) — the fireball boxing game.
  Its full engine is seeded into this repo (see `FOUNDATION.md`, the FF1
  README carried over verbatim — everything in it still runs here).
- **RAVE RAID** (`yellkell/dance`) — the rhythm battle royale. Its menu kit,
  club architecture and boss-move grammar are the sequel's raw material;
  they get ported in, not rewritten from memory.

Both games run the same stack (`@iwsdk/core` 0.4.2, three 0.184, Vite 7,
strict TS, a WebSocket relay, Firestore for boards), so "fold them together"
is a port, not a rewrite.

---

## 1 · The pillars

1. **One town.** You are one fighter with one name, one wallet, one painted
   body, across boxing, raiding and raving. Nothing forks per mode.
2. **The club is the lobby.** There is no menu-room-then-game. You are in
   the venue with everyone else; games are called down onto the floor and
   the floor never closes.
3. **Watching is playing.** Every match launched from the club is a show.
   Spectators have a place to stand, things to do, and a voice the fighters
   feel (as crowd roar) but never hear (as words).
4. **Beautiful first, fast second.** Art-direct for the most beautiful
   version we can imagine on next-gen headset hardware, then buy the
   framerate back with the tricks both games already know (baked merges,
   instancing, the mirror trick, light-instead-of-geometry). Never the
   other way round.
5. **The paint is the endgame.** Cosmetic progression is a canvas, not a
   catalogue. What you own matters less than what you've made of it.

---

## 2 · The wrap-around three-panel menu

RAVE RAID's menus are the standard; FF2 pushes past them.

**What we take, whole** (from `dance`):

- `src/ui/panel.ts` — the `Panel` class (one canvas → one CanvasTexture →
  one plane + additive halo; `paint`/`press`/`setShown`/`tick`/`hoverOf`/
  `buttonAt`; the `PanelButton` role vocabulary: `primary`, `selected`,
  `disabled`, `display`, **`ghost`** for custom-drawn widgets, `tone`).
- `src/ui/pointer.ts` — the `PointerRay` (beam only when on something
  interactable, dot swells on hover, pops on click).
- `src/ui/safety.ts` — the *fragment* pattern: reusable panel content that
  takes a layout struct and emits buttons + a draw function. This is how
  three panels stay one design system.
- The repaint-key discipline (`lastKey` built from every state input; no
  canvas work when nothing changed) — non-negotiable, or three big canvases
  re-upload every frame.
- The flat `action(id)` dispatcher with id namespacing (`tab-*`, `song:*`,
  `kb:*`…) and the multi-target raycast loop (`panelFor(hit.object)` →
  `buttonAt(uv)`), which already supports N panels at arbitrary rotations.

**What's new — THE WRAP:**

Three panels on a shallow arc around the player (center dead ahead,
left/right yawed in ~28–35°, all at podium height), run by one shared
hover/click/scroll loop. RAVE RAID already parents a fly-out leaf panel to a
desk and hit-tests both; the wrap generalises that into a **rig**: an
`ArcRig` that places any number of `Panel`s on a circle of radius ~1.5 m
about the head's spawn pose, eases them open in sequence (center first,
wings 80 ms behind), and folds them away as one.

Panel roles:

| Panel | Contents |
| --- | --- |
| **LEFT — THE FLOOR** | Who's here: the room roster (name, hue, crown), live counts (queue / club / sets in progress), the safety console fragment (mute/block/report), voice toggle. |
| **CENTER — THE CALL** | What we're doing: FIGHT (1v1 ranked/quick/private · 2v2 · FFA), RAID (titans), **RAVE** (the full RAVE RAID mode), TRAIN (tutorial/aim), the campaign line-up. Primary CTA lives here and only here. |
| **RIGHT — YOU** | The locker: your mannequin live-rendered, paint mode entry, the shop, wallet, rank, stats, settings. |

**The few-doors law** (added when the first wrap proved too busy): the
lobby never presents everything at once. The center slab offers exactly
THREE doors — FIGHT, ARCADE, THE CLUB — and every other option is a
sub-option behind its door, one BACK away. Preference breakers live
where they matter (ONLY BOTS inside FIGHT, SHOOT BACK inside ARCADE),
never at top level.

**The tab grammar** (MENUS 2): the doors are TABS. Every panel wears a
strip of horizontal tabs across its top — the Overwatch / Fortnite menu
structure — so where you are is always one glance away and nothing hangs
behind you any more. The kit's `tab` role draws them: an uppercase label
on a shared baseline, the active one underlined in the accent, a red pip
for the unread paper.

| Panel | Tabs |
| --- | --- |
| **CENTER** | FIGHT · ARCADE · CLUB (FIGHT's flows still drill in and BACK out on the slab; CLUB is the region pick) |
| **LEFT — THE TOWN** | TOWN (the live-status chips) · LADDER (the leaderboard, off the back wall: BATTLE / XP / ARCADE sub-boards, ten rows, stick-scrolled, tap a name for the profile) · NEWS (the Gasket Gazette, rendered on its own page canvas and blitted onto the wing, stick-scrolled) |
| **RIGHT — YOU** | LOCKER (CUSTOMIZE — the one customization plate, LOCKER · STORE · PAINT — and the career profile) · STORE (the catalogue, the bank, the purse) · SETTINGS (volume tracks scrubbed by the trigger, mute / voice / hide-paint breakers, REPORT, CREDITS) |

Above the right wing hangs **THE PROFILE pop-out** — what the floating
coin readout became, on the RAVE RAID profile-card pattern: a bare chip
(your accent mark, name, rank, `$` balance rolling up after a bout) that
drops your card out over the wing — the painting behind the name, rank
and XP bar, honours and achievements with tooltips, your note — with
RENAME and WRITE NOTE. Rename lives there and nowhere else. Any other
menu action folds the card.

The wrap is the *foyer* menu (solo/spawn context). On the club floor the
same three panels compress into the summonable console (the RAVE RAID
desk pattern) so the design system is identical in both places.

FF1's `src/menu/menu.ts` (3,914 lines of bespoke canvas) is **retired
gradually**: each screen is rebuilt as a panel-kit fragment, ported one at a
time onto the wrap, and the old plates deleted when their last screen moves
over. No big-bang rewrite of a working lobby.

---

## 3 · The social area — the club is the launcher

**Out:** the Iron Balls pub's fight hall (live claim-console duels in the
social space). **In:** RAVE RAID's club law, extended.

The four-places law carries over (where you are is what you're doing):
foyer (menu), **the club** (social), and the match (wherever your game
seats you — with audience ground around it). **The club itself contains
no arena — ever.** RAVE RAID's floor is the model exactly: games are
CALLED from the floor and PLAYED somewhere else; the venue stays a
venue.

### 3.1 Calling a game — DISCO BALLS, always

RAVE RAID's BALL doesn't generalise into something else — **it IS the
launcher, for everything**. Anyone on the floor opens the A-button
console; it has TWO TABS:

- **FIGHT** — start FIRE FIGHT matches and raids: 1V1 · 2V2 · FFA ·
  TITAN RAID.
- **RAVE** — the record shelf: RAVE RAID's charted songs and the
  difficulty chips.

Either way the CTA is the same verb: **HOST.** A mirror ball is
winched down out of the ceiling on its cable (the under-damped spring
drop, the 60 s relay-owned countdown plate — the game or the song, the
caller, one orbiting pip per person touched in). The ball is
mode-agnostic: it carries `{ mode, params, caller, seats[] }` and the
relay deals seats + seed + a shared start clock, whether that's a duel,
a titan gauntlet or a rave set.
*(Shipped: THE BELL rings. The floor's desk has the two tabs
(`rave/systems/ClubSocialSystem.ts`) and one verb; a fight ball carries
`{ mode, code }` — the arena opens a private room for the caller at the
call (`rave/bridge.ts` openFightRoom, implemented by the town in
`experience/ClubExperienceManager.ts`: the duel stack for 1V1, the mesh
for 2V2/FFA/RAID) and the ball rises only once the room exists. The
relay (`server/rave.mjs`) owns the clock and DEALS: the caller and the
touched-in in touch order, the first `capacity` as fighters and the rest
as watchers, one `start` to each with the roster and their role
(`rave/club/bell.ts`). Every dealt headset crosses under the curtain
with its arena lobby state already set, joins the room by code (a
watcher on the rail), the host launches once the squad is seated or
after a grace, and when the bout is over everyone folds home to the
floor — still members of the room the whole time (`net.dealtAway`),
the floor seeing them OUT. Every fight the bell calls rides the MESH, the
duel included (`combat/layout.ts` classicDuel tells the two-peer duel wire
apart from a mesh-hosted 1V1), so a duel's extra touchers are seated on
the terrace like a brawl's. THE HOUSE PAYS: a game dealt by the bell — a
record, a fight, a raid — pays `CURRENCY.bell` on top of its own take the
moment you fold home, and the desk's header reads the wallet and what the
last trip paid. Not yet: a fight's winner claiming THE CROWN.)*

Joining is physical (walk up, touch, trigger), leaving is touching again,
the caller can START early or cancel, and at zero the squad is dealt into
the match **without leaving the venue** (see 3.2). The floor never closes:
stay-behinds keep talking, newcomers keep arriving, finished players fold
back home automatically.

**The match UI** (`ui/scoreboard.ts`): every fighter gets a CARD — smoked
glass with a lit team notch, the callsign, a big numeric health readout,
a health bar with a DAMAGE TRAIL, the round pips, LOW (hazard chevrons
breathing under the bar) and OUT (the card dims under a red stamp), and
a rim flash on every hit. 1V1 hangs the classic pair over the rival's pad
with the ROUND PLAQUE (round, first-to, a clock that goes amber then red)
between; 2V2 stacks the columns with TEAM totals; FFA hangs the east and
west fighters' cards OVER THEIR OWN PADS, turned to face you, with a
STANDINGS strip over the plaque.

### 3.2 Watching — travel together, and the crowd that can't be heard

No pit, no fight hall — **nothing fights inside the club** (the Iron
Balls pub's indoor duel was FF1; FF2 ends it). Instead, RAVE RAID's law
extended to watchers: when the bell hits zero, the caller's squad AND
everyone who touched in as AUDIENCE are dealt to the match's own place
together — fighters onto the platforms, watchers onto **audience
ground** built into each arena (rails and standing terraces outside the
cage line, in the dark beyond the fighters' light). "We can all stay
together and watch" is literal: the group travels as one, the club
floor stays open behind them, and everyone folds back to the floor when
the bout ends. Fighters stream poses + fireballs to the audience over
the wire FF1's fight hall already proved at 20 Hz.

Crowd rules (this is a design pillar, so it's spelled out):

- **Fighters never hear the audience's words.** The FF1 match voice bubble
  is law: fighters hear only each other; spectators hear everyone.
- **Fighters always hear the crowd as a crowd.** A layered ambient bed —
  *distant* crowd murmur under everything, mid rumble that swells with the
  action — plays for everyone, fighters included. We need to **source real
  crowd recordings** for this (distant stadium murmur, close roar, swell
  stings); neither repo has any — FF1's "crowd" is emergent voice only.
  Until sourced, a synthesized placeholder bed ships via FF1's `sfx.ts`
  noise kit so the mix is designed early.
- **Hands up = roar.** Spectators raising both hands above their head is
  detected locally (two controller heights vs. head height, cheap), sent
  as a 1-byte intensity on the room wire, and the relay aggregates it into
  a room-wide `crowd` level: the roar bed swells with how much of the crowd
  has hands up, plus a clap/stomp layer. It's the one channel the audience
  has into the fighters' ears — pure noise, no words — so a comeback
  landing while the whole terrace goes up FEELS like it.
- Environments are designed around the watchers: every competitive
  arena grows audience ground with clean sightlines, the fight lit like
  a show (fighters brightest thing in the place — Desert 2.0 already
  obeys), watchers close enough to feel it but outside the cage line.

### 3.3 The venue

We move off the Iron Balls pub. The new venue is built on RAVE RAID's club
architecture (`club/build.ts` + `merge.ts` + place-scoped fog/voice/music)
— the four-places plumbing, the still room idea, spatial voice, prop
brokering — but **re-skinned into FF2's world**: the industrial fight-club
language (gunmetal, hazard amber, riveted steel) fused with the supper-club
craft level (every edge carries thickness; saturated colour reserved for
light). *(Shipped: NEON INDUSTRIAL, phase 5 — the venue is the rave's
club, mounted in the arena's World and entered under a curtain from the
CLUB tab.)* Rooms: the floor + bar, the locker room (paint + shop in person
— your mannequin on a plinth), the arcade corner (cabinets carry over),
and a dark door we keep for whatever the next experiment is — THE STEP
taught us the value of an unexplained door. No pit, no ring, no
consoles: the only way a fight starts here is the bell, and the only
place it happens is elsewhere.

Both games' clubs keep their servers' good bones: RAVE RAID's relay owns
the bell clock and deals seats; FF1's pub server contributes the voice
bubble, prop ownership brokering and ban tooling. *(Shipped: THE ROOM
SERVER, `server/room.mjs` — one process, one port, three relays told
apart by path: `/rave` the club and the bell, `/pub` the pub, `/ff` the
duel relay (and `/` for old clients); each still runs alone under its
own script. Region-picking like `PUB_REGIONS` is still to come.)*

---

## 4 · New campaign — titans that learned to dance

FF1's campaign spine stays (it's excellent): bespoke chassis, pit-lane
intros, bespoke deaths, blinking weak-point patterns, coins/XP, first-fell
double, gauntlet run, hardcore, raids with escalating targeting.

What's new: **the move grammar from RAVE RAID.** The titans' attack roster
grows from FF1's five kinds (slam/sweep/beam/volley/nova) to the full
RAVE RAID vocabulary, ported from `dance/src/config.ts` (`MoveKind`,
`MOVES`, `CHOREO`), `choreo/setlist.ts`, `choreo/telegraphs.ts`,
`choreo/strikes.ts`, `choreo/blockfall.ts`:

| New move | On your platform | The answer |
| --- | --- | --- |
| **gate** | everything burns but one band | stand in the gap |
| **cross / THE TRAP** | rails ahead/behind, both at once | step off the strip / squeeze the band |
| **donut** | center lane, then all-but-center | step out, run back in |
| **THE RECITAL** | the boss *teaches* a pattern of quarters, a note each, then calls it by ear alone | remember, listen, commit |
| **wave / THE LONG WAVE** | marching strips with a dark exit that turns | travel with the march |
| **seesaw / surge** | half-court cascades (already in FF1 as halves — upgraded to RR's chained cascades) | cross on the beat |
| **duckdonut** | sweep + donut on one beat | middle AND duck |

And the generation laws come with them — they're what makes RAVE RAID's
choreography readable: never the same move twice running, the **VERB table**
damping repeated body-verbs, **THE FLOOR MANAGER** (`parkOf`/`evictsPark`:
a correct dodge is never punished by where it parks you), windups sacred
(escalation compresses gaps, never the read), landings on downbeats.

**No second line-up.** (Decision revised in build: a fresh bill of bosses
wearing borrowed chassis was scraps-and-new-names — not worth a campaign.)
Instead the campaign ITERATES: **the five titans learned to dance.** Each
keeps its soul and gains the grammar subset that extends it — RUSTHOOK the
scrapyard **gate** (+ slotted lanes), PISTONKAISER the **wave** (its
drumline, marched deck-wide) + the surge, VULTURE the **crossfire** (rails,
THE TRAP, the lattice) and **THE X**, JUGGERNAUT closing walls (**row
gates + the donut's rim**), and GOLIATH — the king teaches — **THE
RECITAL**, the wave as procession, the donut, and once in a blazing night
the **duckdonut**. Vocabulary is act-gated (`GRAMMAR_ACT_MIN`): an EASY
bout stays the fight it always was; the hard tiers meet the whole grammar.
`volley` remains the one blockable attack (the parry law is FF1's soul and
stays); everything else is read-and-move.
**SHIPPED (first pass)**: `campaign/grammar.ts` (the ported shapes + laws:
never-twice, VERB damping, THE FLOOR MANAGER's parkOf/evictsPark, all
seeded — one 32-bit number on the raid wire rebuilds the identical move on
every client), the telegraph kit (gate/donut/X/rail/lane + THE ROUTINE's
marks, quarter lines and falling blocks, octagon-masked), CampaignSystem's
grammar path (windows so a cascade's later reads open as earlier steps
fire; per-shape strikes; head-judged routine commitment), and the per-boss
subsets above. Headless: `npm run check:grammar`.
**SHIPPED (second pass — THE GESTURE LANGUAGE)**: `campaign/gestures.ts`.
The floor is the near tell; the titan's silhouette is the far one, and
every grammar shape now has its own: the lane's POINT (one arm levelled
down the strip, the other tucked), THE X's crossed arms, the rail's
SCISSOR (wings out, snapping across), the gate's PRESS (arms spread, then
closing either side of the gap that lives), the donut's RING (arms up in a wide V framing the rim, hands a hoop apart, never
meeting, up on the toes), THE ROUTINE's TEACH (the king points at each
taught corner in turn), the wave's MARCH (the piston drumline pumping on
the beat) and the duckdonut's blade (the sweep's own wind-out). Each is a
pure function of the read's fill — the same seed animates the same pose on
every client — with a body lean, a lift, a GAZE that turns the head from
the player to the marked spot as the read fills, a follow-through on the
landing (the point jabs, the press claps — `sfx.clap` — the ring slams
down wide) that decays into the next step's windup so a cascade breathes
like RAVE RAID's bosses did, and a temperament per chassis (the press
snaps, the king reaches). `check:grammar` now asserts every forced move
raises the arms and that no two shapes' silhouettes come within 0.4 rad.
**SHIPPED (third pass — THE RECITAL, and ARTICULATED ARMS)**: THE ROUTINE
is withdrawn; GOLIATH teaches **THE RECITAL** instead (`campaign/grammar.ts`
`recital`). THE LESSON lights each quarter of the pattern in turn with a
NOTE — pitch says front or back, stereo pan says left or right — green for
a move, blue with a ring for a HOLD ("stay") — then THE RECITAL calls the
same notes with the marks dark (`sfx.recitalNote`, a beat and a half before
each landing; the blocks fall short and low, so they confirm the note
rather than answer it). A move never repeats the corner before it, a hold
always does, never two running, lengths act-gated 3–5. The titans' arms
are CHAINS now (`campaign/bosses.ts`: shoulder → elbow → wrist → hand, the
talons and the gauntlets' fingers on hinges that curl), every shape drives
every joint, and the classics joined the gesture language with shapes of
their own: the slam's HAMMER (drawn, hoisted, trembling at the top), the
sweep's SCYTHE, the beam's CANNON (one arm locked at you, the other hand
bracing its elbow), the volley's LAUNCHER, the nova's COIL, the seesaw's
TILT (a balance beam tipping toward the flood), the surge's SHOVE. THE
RECITAL is CONDUCTED — forearms up, a baton flick on every cue, a palm for
a hold — and never pointed at.

Raid escalation carries over unchanged for the classic kinds (solo-target
→ two marks → whole squad, DECREE-style shared bearings, the resurrection
beat for the finale); grammar moves are squad-wide by RAVE RAID's own law —
one chart, every deck.

---

## 5 · Character models & customization — the mecha chameleon

The FF1 skins system (preset avatars + hue sliders) retires. FF2's fighter:

### 5.1 The blank

One **bland humanoid mannequin** — matte, colourless, primer-grey — sized
honestly to the hitbox volumes (`config.ts` `BODY_IK` + `Hitbox` spheres):
thin waist, wide shoulders, the silhouette everyone reads in a fight.
Everyone starts identical and unpainted, and everyone sees you exactly as
you've built yourself. (FF1's `boxer.ts` head/torso/gloves IK solve is the
skeleton; the mannequin is a new procedural skin over the same rig, so
netcode, hitboxes and the pose bus don't move.)

**Two pieces, one moving part.** The body is a SINGLE loft — neck,
shoulders, chest, waist, hips, taper — planted at the hips and leaned
along the spine; the HEAD is a bare egg that floats free above it and is
the only piece that moves on its own. Chest and pelvis were once separate
lofts the IK placed independently, which meant the waist opened and shut
as you leaned, and the neck rode on the head, dragging itself through the
shoulders whenever you looked behind you. Neither seam can reappear,
because neither joint exists: there is nothing to come apart, and only
the head has to be animated. The hitboxes are untouched — `solveTorso`
still solves the chest and pelvis POINTS for the BODY_IK spheres, and the
one surface runs inside them.

### 5.2 The shop — shapes, never colour

Coins (earned per game — fights, raids, **and songs**: finishing a RAVE
set banks the same flat `CURRENCY.perGame`) buy **attachments**: shoulder
pads, hats, jewelry, plates, antennae — models that bolt to the rig and
**never affect the hitbox** (purely visual, parented to bones, excluded
from collision). Everything in the shop is sold *uncoloured* — the same
primer grey as the body, plus one TRIM finish per piece (gunmetal on the
white blank, pale steel on the onyx) for a visor's glass, a collar's
chain, a gauntlet's ridges: the trim is not a paint surface, so it keeps
its contrast under whatever the plate is painted. FF1's wallet/shop/locker plumbing
(`wallet.ts`, `customization.ts`, owned-lists, try-before-buy preview)
carries over; the catalogue changes from skins to attachments.

**SHIPPED — GEAR** (`src/avatar/gear.ts`; the slots grew to five since —
THE HEADS and THE SHOULDERS, below): fourteen shapes in three SLOTS
— head (CREST, ANTENNAE, HORNS, HALO, MOHAWK, VISOR BAND), body
(PAULDRONS, CHESTPLATE, COLLAR, RIDGE, BELT) and hands
(CUFFS, KNUCKLES, GAUNTLETS) — one worn per slot, every piece primed in
the body's own tone (white on a blank, black on an onyx) and immune to
every recolour, exactly like the body. Purely visual: gear parents to the
rig's head / body / glove groups and the BODY_IK hitboxes never move.
The STORE and LOCKER grew a GEAR tab (try-on dresses the mirror, a buy
goes straight on, a locker tap wears or removes), and the worn set rides
every cosmetics channel packed as a short comma list — the duel `iam`,
the mesh `iam` (`mesh.cosmetics`), the club hello + the LOOK event, the
raid pit body, and the player doc (`gear`, beside `pad`, the deck) — re-validated on arrival by
`cleanGear` (unknown ids dropped, one per slot, hard length cap: the
paint's fail-soft law). Probes: `check:wrap` dresses the podium through
`__ff2.gear` and asserts the wire form; `check:paint`'s two-client room
sees a punter's gear arrive on the hello. PAINT 2 later made gear a
PAINT SURFACE too, with its own canvases per slot.

**SHIPPED — THE HEADS** (`src/avatar/heads.ts`): FIRE FIGHT 1's eight
animal heads come back as a fourth gear slot, `face` (the HEADS shelf,
first on the GEAR board; the old HEAD shelf is now HEADGEAR). BEAR,
PANTHER, EAGLE, KNIGHT, STALLION, WOLF, FROG and BUNNY keep FF1's lofted
skulls — the shapes the bare egg never had — re-made for the blank: the
shell in the body's primer (a paint surface, `gearFace`, part 8 on the
wire), only the holes in TRIM (nose pads, sockets, inner ears, slits),
and only the EYES lit in the accent (FF1's neon blazes, vanes, rims and
lit teeth are gone — paint does markings now). Fur, manes, crests and
ruffs are rounded tufts instead of FF1's flat plates, which read as
cards in porcelain; the knight's cross and sight wrap the barrel; every
head is carried at about four-fifths of its FF1 size, which was scaled
for the old shoulder-heavy robots. A worn head hides the skull (and the
paint bay stops aiming at it), head GEAR rides out to the head's crown
(`HEAD_FIT`), the wearer's own first-person head builds none of it, and
the BODY_IK head sphere never moves. `face` packs last, so a reader from
before it simply drops the id. Dev: `node tools/gear-gallery.mjs out.png
bear,panther,eagle,knight,stallion,wolf,frog,bunny`.

Second pass: the WOLF, FROG and BUNNY were rebuilt outright — the wolf
around a real stop, a separate jaw, standing leaf ears and a RUFF of long
tufts off the cheeks and nape; the frog around lidded eye turrets, a
smile laid along the skull's own surface and eardrums in the shell's
colour (dark ones gave it four eyes); the bunny around leaf ears, one
FOLDED forward over the brow, whisker pads, a Y mouth and buck teeth.
The knight's gorget skirt is primer, the body's own colour. Third pass:
the BEAR rebuilt smooth (FF1's face was add-on lumps: jowl, jaw and
bridge balls — now one loft into a deep muzzle, a jaw under it, the face
drawn on); the PANTHER rebuilt as a cat (round skull, flat face, almond
eyes with slit pupils, tall triangle ears, triangle nose and W mouth,
cheek fluff); the STALLION's slit nostrils and mouth slab (black through
the nose) replaced by round flared nostrils and a lip line, plus leaf
ears, brows, the cheek ridge, a mane lying down the nape and a trim
BRIDLE laid on the skull; the FROG's eyes lose their pupils.

**PAULDRONS, the shells again.** The first cut's plain tilted domes were
the shape people liked; they were swapped for a riveted cap-lame-rim
plate because their inside edges dove into the trapezius. The domes are
back, and `seatOnBody` (gear.ts) fixes the dive instead of the shape: the
piece is baked into body-local space and every vertex inside the loft (or
within a few millimetres of it) is eased out onto the skin with a soft
floor, so the inner edge rests on the slope to the neck. The SPIKED PADS
are the same seated shell a size up (`shellPad`), three spikes driven
through the crown on the dome's own normal from trim collars — one family
with the pauldrons, where they had been a separate lofted plate.

**SHIPPED — THE SHOULDERS** (a fifth gear slot, `shoulders`). The pads
were body pieces, so they could never be worn with a chestplate, a cape
or wings; they hang off the same body group now but as their own slot
(`gear-shoulders` beside `gear`, their own canvas `gearShoulders`, part 9
on the wire). The slot packs LAST, so an older reader still wears a
pauldron as its body piece (it knows the id) and drops what it doesn't;
the catalogue indices don't move (PAULDRONS stays tile 6). A saved look
(LOOK_VERSION 5) whose worn body piece was a pair of pads moves its
`gearBody` marks onto `gearShoulders`, so the pads keep their paint. New
on the shelf: the WARLORD (the paladin pauldron from the raid-boss era:
a deep dome seated like the shell pads, a heavy rolled rim found on the
dome's own edge and pushed out with it by `seatPoint`, three flame
tongues on the crown broad face forward, a trim lame flaring under the
rim, lit studs), EPAULETS (piped boards on the shoulder slope, a crescent
and a plumb bullion fringe, a lit button) and the GLADIATOR (asymmetric:
four lames down the left arm, each tucked under the one above, and a
standing guard with a lit boss). The body gets a CAPE and a TABARD — the
two things that hang where the pads used to crowd it. Five slots' longest
ids run to ~50 characters, so the gear string's cap is 64 everywhere.

**SHIPPED — THE PADS, rebuilt entire.** The platform shop no longer sells
neon tints over one steel slab with a grin, a bolt and a grid on top. A
platform skin is a MATERIAL (`arena/decks.ts`): thirteen procedural
decks — charred oak, pale ash, redwood, walnut, slate flagstones, veined
marble, black glass, river ice, jade, gold leaf, crimson lacquer, wet
green stone — each a colour map and a bump map cut from one seeded noise,
shared per style so swapping skins never uploads. The catalogue is the
material ladder: SMOULDER / AZURE / INFERNO free; WALNUT, SLATE, MARBLE,
FROST, OBSIDIAN, JADE, BULLION for coins; CHAMPION, TIDEBREAKER and
BLAZING earned as before (their living FX — the burning rail, the pool —
kept; everything decorative retired). Each skin also sets the neon tube's
colour and the corner screws' metal (iron, brass, chrome, gold). Tiles
show a swatch of the material. The player doc mirrors the worn deck as
`pad` so the gazette can say what a champion stands on.

### 5.3 The paint — the important part

> **Now specced in full in [`docs/paint.md`](docs/paint.md)** — buying
> individual stripes and splotches, the paint bay's verbs, the packed
> `Look` model, per-part canvas baking, how every other player sees your
> painting (sync, validation, fail-soft), moderation, and the four-phase
> build order. The sketch below is the original outline it grew from.

Colour is bought as **stripes**: paint items you place *minutely* on your
own body and attachments from the locker — position, angle, length, width,
hue — layer over layer, removable, editable, **persistent across games and
added to over time**. The goal stated in the brief is the spec: *you can
make cool art and it looks cool* — a mecha chameleon you keep painting for
months.

Tech sketch:

- A stripe is data: `{ id, surface (body part / attachment id), uv anchor,
  angle, length, width, hue, layer }`. Your whole look is an ordered list
  of stripes + attachment set — small JSON, stored with the profile,
  synced to peers through the existing cosmetics channel
  (`mesh.cosmetics` already carries per-peer loadouts).
- Rendered as decals into a **per-part paint texture** baked once per
  change (canvas → texture per body part, exactly the kit both games
  use for panels), so a heavily-painted fighter costs the same at runtime
  as a blank one.
- The locker's paint mode is a panel-kit tool: your mannequin on the
  plinth, a stripe in hand, ray places it, grips nudge it — RAVE RAID's
  colour-wheel ghost-button trick supplies the hue picker.
- Placement bounds per surface so stripes can't float; layer order is
  yours to reorder; REMOVE is always free (paint is never consumed —
  bought stripes go back in the locker).

Moderation note for later: player-authored patterns are user content;
the report path (`reports` collection) must cover "report this paint job."

### 5.4 One identity across modes

The mannequin + paint + attachments render identically on the club floor,
on a duel platform, on a raid arc and on a RAVE ring (the RAVE dancer rig
and the boxer rig both solve from head+hands, so the mannequin skins both).
Name, hue fallback, wallet, XP, rank: one profile everywhere.

---

## 6 · New environments — beautiful first

**Out:** papercraft low-poly (`makePaper` flat-shading rule). **In:** the
most beautiful thing we can imagine, **darker**, then optimized to hit
frame rate on next-gen headsets — and only then scaled back with tricks
(never designed down up front).

The craft standard is already in-house: RAVE RAID's club (every edge
carries thickness, colour lives in light, baked to a handful of draws) and
THE VOID (vast darkness given shape by light, four depth layers, the
mirror trick, ~48 draws). That discipline, aimed at outdoor spaces.

### 6.1 Desert 2.0 — same soul, new night

The FF1 desert's *story* carries over exactly — **the leaning signpost,
the sun-bleached skull, the broken fence, the tumbleweeds, the vultures,
the dust devils, the mesas** — every landmark from `src/arena/desert/`
survives, rebuilt beautiful:

- **Darker**: golden-hour dying into night. A low blood-orange band on one
  horizon, deep violet above, early stars. The arena is the brightest
  thing for miles (pillar 3: fighters lit like a show).
- Real materials instead of paper: wind-carved rock strata on the mesas,
  specular glints on the skull, rusted enamel on the sign (lit by its own
  buzzing lamp), long soft shadows from the horizon light.
- Atmosphere: heat-haze shimmer at the horizon band, dust motes in the
  arena light cone, tumbleweeds catching rim-light as they roll.
- Perf ceiling from day one: authored in layers like THE VOID (near set
  dressing / mid mesas / far silhouette band / sky dome), merged static,
  instanced repeats, light baked into vertex colour or emissive where it
  can be — so "scale back" later means dropping layer detail, not gutting
  the look.

The factory and salt flats get the same pass in later sessions; new venues
(the club itself is an environment) follow the same layered recipe.

**THE SITES** *(shipped)*: one desert, three places, and the game walks you
between them by what you're doing (`arena/desert/sites.ts`, driven by
DesertSystem off the app state). **THE TRAILHEAD** is the lobby — the edge
of GASKET: the signpost under its own buzzing hooded lamp, the broken
fence, a campfire burning low on the TOWN board's side, a windmill turning
against the last light, telegraph poles marching off toward town. **THE
FLATS** are every match and Aim Training — open ground: the skull (now
glinting) and two dead trees throwing the longest shadows in the game.
**THE BONEYARD** is every campaign fight and every raid — where titans
are broken: a ring of standing bevelled wreck-plates around the pit, oil
drums burning (two lit — the light budget), RUSTHOOK's own hook buried
to the shank — all of it clear of the five-seat arc. No litter anywhere:
the brief was beautiful, not busy, and the first cut's scrap heaps,
loose bones and rib cages were pulled the moment they read as debris. Only one site is
visible at a time and each collapses to a few static draws; the far layer
(sky, sun, ground, mesas, weather) is shared and simply YAWED per site, so
the skyline sits somewhere new too: the lobby's sun hangs to your left, a
rival stands backlit against it, a titan is lit full in the face with the
light at the squad's back. **Pass 2 of the look** landed with it: the
mesas are no longer stacked drums but one wind-carved loft each (two
octaves of radial noise, ledges where a stratum held, the bands baked into
vertex colour and merged to one draw — the static merge learned to keep
`color`), a heat-haze band swims along the horizon (one additive draw,
no render target), dust motes hang in the arena's light cone, and bone
catches the light. **Papercraft is OUT, as the brief demanded** — and not
by adding polygons alone: `arena/desert/textures.ts` is the material
kit, six procedural canvas skins (rippled sand, strata rock, oxidised
iron, dead bark, cured plank, pored bone), each a tint-neutral colour map
plus a bump map cut from the same seeded noise, so every surface carries
grain the low light rakes across for one texture fetch and no extra
draws. The ground wears the sand skin under its dune colour; boulders are
noise-displaced spheres in rock, smooth-shaded; clouds are layered soft
sprites instead of faceted blobs; the skull is domes, not an icosahedron;
cacti and agave carry the segments to read as flesh; and the sky dome
finally has a DIRECTION — the blood-orange band is tall and hot under the
dying sun and thins to a dusty mauve behind you, so the night is already
arriving on one side. Preview: `env-preview.html?env=desert&site=…`;
headless: `npm run check:desert` (add `--shots`).

### 6.2 The bar

Every graphical aspect aims for the ceiling on next-gen hardware
(Quest 3-class and up): full-rate render scale, foveation as a lever not a
crutch, no post stack (both games prove bloom-by-sprites), draw-call
budgets set per scene up front (venue ≤ ~80, arena ≤ ~60) so beauty is
built inside a budget rather than trimmed after.

---

## 7 · RAVE RAID as a mode

RAVE RAID folds in whole, as **RAVE** on the center panel and on the bell:

- The set itself ports as-is: the choreography stack (already shared —
  §4), THE VOID set, the GOOPLIATH-on-stage (both repos carry the same
  vendored gel boss — FF2 keeps **one** copy under `src/goopliath/`, and
  `styles.ts` there still carries FF1's five fighting styles alongside the
  dance stances, proof they were always the same machine), the record box
  and decks (`audio/tracks.ts` + `music.ts`, 26 measured masters), grades,
  bots, THE RISE.
- Its dancers wear **your mannequin + paint** (§5.4). The couture rave
  mannequin retires with the FF1 skins; hue stays as the seat-fallback.
- Its world board stays its own (`raveraid-bc866` Firestore, the ratchet
  rules) — separate but equal, exactly like the stats page.
- Songs pay coins into the one wallet (§5.2) — this is where "earn
  currency by doing songs" lands.
- The TOUR (its campaign) parks initially — FF2's campaign is the titan
  line-up; the tour returns later as RAVE's own tab if we want it.
- THE CIRCUIT / THE STEP: the dark door pattern comes to the FF2 venue
  (§3.3); whether it leads to the movement course or something new is an
  open call.

Repo mechanics: port modules from `dance` into `src/rave/` here with
their file identities intact (config blocks merged into FF2's `config.ts`
style: one documented tunables file per game area).

---

## 8 · Discord & link joins

Today: RAVE RAID joins rooms from `?room=CODE&name=YOU` URLs; FF1 has
5-digit codes typed on an in-VR keypad and a read-only Discord TV in the
pub (server-side bot already polls a channel).

FF2 makes the link the front door:

1. **Every hosted room mints a link**: `https://<host>/?join=CODE` (one
   scheme across 1v1/2v2/FFA/raid/rave — the code already carries its
   format server-side). Booting with `?join=` skips the menu, connects,
   and offers ENTER straight into the room — RAVE RAID's
   `autoJoinFromUrl` generalised. The lobby shows the link as a QR +
   short code; COPY LINK on desktop.
2. **Discord invites**: the room server's existing Discord bot grows a
   write path — HOST from the club can post the invite (game, format,
   seats open, the link) to the configured channel; the bell's countdown
   can post "3 touched in, 1 seat left". Clicking the link on a phone
   shows a landing page ("open in your headset"); in the headset browser
   it joins.
3. Later: Discord Rich Presence via the packaged app, and slash-commands
   (`/firefight host 2v2`) minting rooms from Discord itself.

*(Shipped, first pass: `?join=CODE` on the arena page — MenuSystem's boot
join types the code and walks in; a four-digit code hops to the rave
page's `?room=`. The squad room's invite band: code + link + QR
(`src/ui/qr.ts`) + SHARE ON DISCORD for the host. The bot's write path is
`server/discord.mjs` — the bell posts from the rave relay, SHARE posts
through `/tv/invite`, THE CHANNEL posts LIVE and FINAL. Not yet: the
countdown's "1 seat left" edits, Rich Presence, slash commands.)*

---

## 9 · stats.html — the web leaderboard

**Shipped in this repo now**: `public/stats.html` — a standalone page
(no SDK, Firestore REST, read-only) served at `/stats.html` on any of the
hosting targets.

- **FIRE FIGHT first**: RANKED (live season computed from the FF1 season
  clock) · XP · AIM · 2V2 · FFA, plus the run boards GAUNTLET / RAID /
  GOOPLIATH (squad rows, difficulty + HC badges, the same dedup law as
  the in-game board: easy never ranks, best row per squad per feat).
- **RAVE RAID separate but equal**: its own top-level tab in its own
  neon, every chart × difficulty, top 100, S/A/B/C/F grades.
- Reads FF1's `players`/`run*` collections and RAVE RAID's `scores`
  ratchet board directly; when FF2 gets its own Firestore project the
  page gains an FF2 board the same way.
- **A PROFILE** behind every name (tap one anywhere): the painting
  behind the name, rank, honours, achievements, the note, the kit; then
  every board's rank and best and every rave chart danced. The tapes stay
  in THE LAB. `#player=<uid>` deep-links one.
- **FFTV** (the third face): a live top-down broadcast of whatever is on —
  the headset running a bout casts frames to `server/tv.mjs` at `/tv`
  (`systems/BroadcastSystem.ts`, `net/tvCast.ts`); the page draws
  platforms, fighters, balls, clock, titan; falls back to the rave
  relay's public club floor, then to a dark test card. The relay ranks
  people over raids over solo bouts and expires a silent channel in six
  seconds. The Discord bot announces LIVE / FINAL for online matches.
- **THE LOOK**: the page wears RAVE RAID's stats-page surface language
  (near-black glass, corner brackets, the rail and its eased marker,
  Rajdhani) with FIRE FIGHT's hazard amber as the accent; each face swaps
  the accent and the floor's pools rather than the layout.
- **SPEEDRUN** is what the GAUNTLET board is called now, and it is three
  boards rather than one — `ff2-speedrun-{normal,hard,blazing}-time` —
  because a board is a per-uid ratchet and one board would keep only your
  fastest clear across every tier. The page gives it a difficulty
  sub-rail; the lobby merges the three back into one ranked list.
- **THE LAB** (a board of the FIRE FIGHT rail, not a tab of its own): THE TAPE — `net/telemetry.ts` records each bout
  (standing / throw-left / throw-right / LANDING / hit-taken heatmap
  grids over the platform footprint, the timed play-by-play including the
  ATTACHMENTS both sides fired, the rounds) into the
  `bouts` collection; the page aggregates the last 200 into tiles, five
  heatmaps, a hands panel and an expandable tape that opens into THE
  TIMELINE — rounds as bands, both pools as lines, and lanes of throws,
  parries, attachments and landed hits.

---

## 10 · Build order

Each phase is shippable; nothing waits on everything.

1. **Foundation** *(this session)* — FF1 engine seeded, builds green;
   `stats.html`; this document. Firebase auto-deploy parked so this repo
   can't overwrite FF1's live site until FF2 has its own project.
2. **The wrap** — port `panel.ts`/`pointer.ts`/`safety.ts` from `dance`,
   build the ArcRig, move the first screens (BATTLE + ARCADE) onto the
   three-panel wrap. Old menu retires screen by screen.
   *(v1 shipped: the kit lives at `src/ui/kit/`, and `src/menu/wrap.ts`
   stands three kit panels on the arc as drop-in `MenuPanel`s — BATTLE
   with all its faces, ARCADE, and the house panel. MENUS 2 shipped the
   tab grammar, moved the leaderboard, the paper and settings onto wing
   tabs as kit faces (`src/menu/ladder.ts`, `settingsFace.ts`) and made
   the coin readout THE PROFILE pop-out (`profilePop.ts`); the rear
   board, the paper/gear discs, the settings modal and the coin HUD are
   deleted. Still legacy: the modals — campaign line-up, arcade lobby,
   locker, shop — the name keyboard, and the pointer visuals;
   `pointer.ts`/`safety.ts` port when those screens move.)*
3. **The mannequin** — new procedural blank over the existing rig +
   hitboxes; FF1 skins retired behind it; attachments shop v1.
   *(v2 shipped: THE BLANK is the ONLY body — the FF1 animal chassis
   (~2,100 lines) and their icons are deleted outright, AVATAR_SKINS is
   one entry, every stored or remote skin id resolves to the blank, and
   the AVATARS shelf is gone from both locker and store. The blank got
   its slender pass — visual trunk/hips run inside the hitbox spheres
   like FF1's SHADOW precedent, and the under-hip bulb became a clean
   closing taper (the hitbox never bulged: it ends at the BODY_IK pelvis
   sphere, and now the body looks like it). The menus centre the avatar:
   the right wing is YOU — name plate up top, YOUR BLANK as the primary
   CTA — THE PODIUM stands your dressed blank on a slowly turning plinth
   beside it whenever the lobby is up, and the locker's COLOUR tab keeps
   only the gauntlet neon, with "THE BLANK TAKES NO DYE" written where
   the armour sliders were. Polish pass v3: the body is rebuilt as ONE smooth
   loft per piece — no crossing primitives at neck or shoulders, no seam
   bands, a single uniform material — and it starts ALL WHITE or ALL
   BLACK ('blank'/'onyx' skin ids, the base pick on the locker's COLOUR
   tab, synced over the existing skin wire). Below the hips the loft is
   monotonic: hips, then only narrower, closing at a rounded tip — the
   silhouette finally agrees with the hitbox, which always ended at the
   pelvis sphere. THE GEAR shop shipped after it — crest, pauldrons and
   the rest, fitted to the rig and carried on every cosmetics channel.)*
4. **The paint** — stripe data model, per-part bake, locker paint mode,
   cosmetics sync. (The moment "lasting through games" works, ship it.)
5. **The venue + THE BELL** — new club on RAVE RAID's club architecture,
   merged room server, bell-launch for 1v1/2v2/FFA first.
   *(THE VENUE IS OVER, in-session: the rave — its club, the course
   behind the west door, the foyer and the set — mounts inside the
   arena's own World (`src/rave/experience.ts`, the pub's pattern), its
   systems registered once and paused, its objects kept and hidden, and
   every crossing is a curtain (`experience/Curtain.ts`): the black
   falls, the outgoing place is paused and put away, the incoming one
   shown and played, the black lifts — the XR session never ends. CLUB
   lands on the venue floor, ARCADE → RAVE RAID lands in the foyer, the
   rave board's FIRE FIGHT door comes home the same way. THE ROOM OF ONE:
   the floor opens without a relay (`net/session.ts` enterSoloFloor), the
   dumbwaiter served off a local clock speaking the wire's own words;
   every club system reads one gate, `inRoom()`. NEON INDUSTRIAL: the
   wardrobe repainted (board-formed concrete, checker plate, galvanised
   steel, riveted plate, black quilted vinyl, brushed stainless, rubber
   matting, corrugated sheet) and the geometry swapped where the deco
   needed it (neon tube rails, riveted I-beams, cage lamps, cyan LED
   rings under a lattice truss, a magenta-footed corrugated backdrop);
   THE SUN stays: the stage's deco sunburst is the thing the MC stands in
   front of, its ribs in the new metal and its centre burning GOLD (the
   fanlight over the doors is still a stepped transom). THE VISIT:
   the MC dresses differently for every arrival on the floor (a
   remembered notch through his safe band, `config.mcHueFor`).
   VOIDSTEP 2 (`course/score.ts`): thirteen platforms, two lifts, a
   shuttle with a turn, the skywalk, an elevator, at 128 with two-bar
   dwells; the score is SWEPT in time so no two decks ever share space,
   every deck is a MACHINE — gunmetal face under an ETCH of circuit
   traces lit in the state colour (a deep true blue, not the hall's
   cyan), a two-step keel with vents that burn
   when it drives, an underglow on the void's glass, a scan line keeping
   the bar across every docked face — and THE GATE on the home pad lights
   the way back. THE MIRROR casts shadows of the
   live rigs (twins driven by world matrices through a reflection, unlit,
   no recess light, one solve — yours). TWELVE GLASSES with two-sphere
   contact, bowl-radius walls, bounce tumble, tipping, rolling in an arc,
   per-surface friction. THE BELL RINGS: the desk's FIGHT tab calls a
   1V1/2V2/FFA/RAID, the relay deals fighters and watchers into an arena
   room the caller opened, the squad crosses under the curtain and folds
   home when it's over (§3.1); and THE ROOM SERVER (`server/room.mjs`)
   is one process for all three relays (§3.3). `tools/venue-check.mjs`
   walks all of it, the bell on a room server of its own with two
   headsets.)*
6. **Audience ground + the crowd** — watchers travel with the squad,
   audience terraces in the arenas, voice bubble, hands-up roar wire,
   sourced crowd beds.
   *(Opened: WHO HEARS WHOM is one table (`net/voiceRules.ts`) read by
   every voice path — RANKED is silence, no mic and no ears; duels hear
   their fighters, brawls every fighter, the raid its squad, the club the
   room, an audience everyone. THE CROWD BED was built synthesised
   (`audio/crowd.ts`) and is now SWITCHED OFF (`CROWD_BED = false`) —
   the murmur read as noise in the headset; the stings and the HANDS-UP
   channel (`systems/CrowdSystem.ts`) stay wired for a sourced bed later.
   AUDIENCE GROUND stands on the flanks of the flats and the boneyard
   (`arena/desert/audience.ts`): two-tier terraces outside the cage line,
   rails capped hazard amber, dark, each offering a set of STANDS.
   THE WATCHERS TRAVEL: every online room's seat array runs longer than
   its fighter count (`config.AUDIENCE_SEATS`) and its tail is the
   audience — a WATCH chip on any lobby row claims one, a full lobby
   included, since turning up to a show is the point. A watcher rides the
   same mesh at fighter fidelity, is dealt to the match's own place with
   the squad, and lands on a stand rather than a platform: their slot is
   a sentinel outside every layout (`config.WATCHER_SLOT`), which makes
   every seat-relative transform resolve to the canonical frame, so the
   whole ring renders where it actually is with no special case
   downstream. They throw nothing and judge nothing (the input and
   collision systems stand down), and each watcher's head rides a `watch`
   frame so the terrace has BODIES on it — the crowd going up is a thing
   the fighters can see. THE ROAR is aggregated per headset off those
   same frames (no relay needed: everyone receives everyone), and the
   voice split is enforced where it bites, in MeshSystem's speaker
   attach: a fighter never opens a watcher's voice. The bell now deals
   the audience from the club floor (§3.1). Still to land: sourced crowd
   recordings behind the same API.)*
7. **RAVE mode** — port the set, decks, records; mannequin on the ring;
   coins per song; bell learns RAVE SET.
   *(Shipped as a PAGE, then MOUNTED: `rave.html` still boots `src/rave/`
   standalone — the dance repo's source ported whole, file identities
   intact, its own relay as `server/rave.mjs` — and the same code now
   mounts in-session inside the arena (phase 5): the ARCADE tab's RAVE
   RAID button crosses under a curtain, and the rave board's FIRE FIGHT
   entry comes back the same way, no page hop, no session end. ONE TOWN:
   the profile reads the arena's callsign and accent first and writes
   them back on a rename; a finished record pays `songCoins(grade)` into
   the one wallet and the grade card names it; every figure — groupies,
   the giant MC, the club's room-mates, your reflection — wears THE BLANK
   through `rave/game/blankDancer.ts` (the arena's rig, `solveTorso`,
   gear and paint bakes, glowsticks out of the fists). Looks and gear
   now ride the rave's own wire, the two club copies are folded into
   one, and the bell's RAVE tab calls a record off the same desk that
   calls a fight. Still to land: the goopliath/choreo copies
   deduplicated between `src/campaign/` and `src/rave/choreo/`.)*
8. **Campaign 2** — move-grammar port (telegraphs/setlist/floor manager),
   new titan line-up, the on-beat titan, raid cut.
   *(Shipped: the grammar module (`campaign/grammar.ts`) with the
   telegraph and blockfall vocabulary ported, folded into the classic
   five titans so each one dances its own shape with a bespoke windup,
   and the raid arc riding the mesh.)*
9. **Desert 2.0** — the dusk rebuild, then the venue exterior, then the
   rest of the environments.
   *(First pass shipped: golden hour dying into night — deep violet-navy
   overhead with 420 early stars thickening away from a blood-orange
   horizon band, a swollen dying sun in an ember halo, the whole palette
   a step darker and richer with bone and dust left pale to catch the
   light, and the papercraft flat-shading retired: the default desert
   material is smooth matte clay, dunes at higher vertex density so the
   dusk light rolls instead of snapping facet to facet. Every landmark
   kept: the sign, the skull, the fence, the tumbleweeds, the mesas, the
   vultures, the dust devils. Second pass shipped: THE SITES — the
   trailhead / the flats / the boneyard, swapped by activity, the far layer
   turned per site — plus wind-carved vertex-coloured mesas, the sign's
   lamp, the horizon haze band, dust motes in the arena light and glinting
   bone (§6.1). Next: the same treatment for the salt flats and factory.)*
10. **Links & Discord** — `?join=` everywhere, QR on the lobby, bot write
    path.
    *(First pass shipped: the join link and boot join, the invite band's
    QR + SHARE, the bot's write path (bell, invite, LIVE/FINAL), THE
    CHANNEL and THE LAB on stats.html — see §8 and §9. Open: the
    countdown edits, Rich Presence and slash commands. THE ROOM SERVER is
    `ff2-room` on Render (render.yaml) and `config.ROOM_SERVER` names it;
    every relay including `/tv` answers there, which is also why THE
    CHANNEL lives inside room.mjs — the club peep reads the rave relay's
    rooms out of memory, so the two have to share a process.)*

Session-zero decisions still open (flagged, not blocking): FF2's own
Firebase project + hosting target; whether FF2 ships as an update to the
FF1 store listing or a new one; the new titan roster; what's behind the
dark door.

---

## 11 · What this repo contains right now

- The complete FIRE FIGHT 1 engine and game, renamed FF2, building green
  (`npm install && npm run build`) — see `FOUNDATION.md` for its own docs.
  Left out of the seed: FF1's OST zip, voice-line WAV masters and gazette
  archive (history, not engine).
- `public/stats.html` — the web leaderboard (§9).
- This document.

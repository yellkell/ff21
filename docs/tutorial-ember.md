# EMBER — the voiced tutorial

A rework of the tutorial around a voiced guide: **Ember**, a female glowing
ball of light with a **Siri-like voice and demeanor** — composed, precise,
quietly warm. She catches your eye, teaches the basics the game already has —
but properly: she *waits* for a real block and throws more balls if you need
them, runs a left/right footwork drill (movement is everything), then opens
the ball loadout and lets you test attachments on the bot before the
graduation fight.

This doc is three things:

1. **The character** — casting + read direction for the voice actor.
2. **The choreography** — beat-by-beat sequence with the exact engine hooks
   (what the orb does, what we wait for, what happens on failure).
3. **The complete recording script** — every line, with ID, trigger, and
   per-line direction. Line IDs are the asset filenames
   (`src/assets/tutor/<id>.mp3`), loaded the same way `src/audio/announcer.ts`
   loads the announcer.

---

## 1. The character

**EMBER** — the last spark of the old Gasket foundry. A fist-sized ball of
warm golden-orange light that bobs, darts, and flares with her mood. She has
adopted the player on sight.

- **Voice**: female, **Siri-like** — calm, measured, perfect diction, an even
  smile in the tone. She never shouts, never gushes, never rushes. Warmth and
  wit come through word choice and a subtle lift in the read, not volume.
- **Praise is understated and sincere.** "Well done." from Ember, delivered
  level, should land harder than an exclamation mark would.
- **Dry wit, never sarcasm at the player's expense.** When the player fails
  she gets calmer and more precise, not disappointed.
- **In-world texture**: she calls the player *Clanker* (affectionately) and
  *Rookie*; she thinks Sheriff Cole Ironside is wrong about Clankers and
  says so exactly once.
- No giggles, no gasps, no squeals. Her biggest emotional swing is a slightly
  quicker, slightly brighter read.

### Recording / delivery spec

- One file per line, named by the line's **code** (e.g. `e011.wav`); extra
  takes add `_2`, `_3`… We transcode to mp3 into `src/assets/tutor/`.
- 48 kHz mono WAV, dry (no reverb — spatialisation happens in-engine via the
  HRTF panner so her voice comes *from the orb*).
- 2–3 takes per line; for the praise pool (E-100s) give as much variety of
  read as possible — they rotate at random and must not sound canned.
- Every line plays over live gameplay and any new line hard-stops the current
  one — no line needs to rush.

---

## 2. Choreography

### The orb itself

Built and owned by `TutorialSystem` (which already owns scene objects — the
popup and pointer lines — and disposes them in `end()`).

- **Body**: `glowSprite(0xffc04d, 0.16)` (`src/materials/glow.ts:37`) with a
  second, smaller white-hot core sprite; `spawnEmber(orbPos, up, 0.4)` on a
  ~0.12 s accumulator while moving (pool in `src/fx/fire.ts:317`).
- **Motion**: target-position + critically-damped lerp in
  `TutorialSystem.update(delta)`; idle bob = `sin(this.time * 2.2) * 0.03` on
  Y; she pulses ~15 % brighter while a line plays (simple envelope on her
  gain).
- **Voice**: new `src/audio/tutorVoice.ts`, cloned from `announcer.ts`
  (`import.meta.glob('../assets/tutor/*.mp3')` → decode → `BufferSource` →
  gain 0.9 → **HRTF `PannerNode`** positioned at the orb each frame — same
  graph as `src/pub/voice/playback.ts` → `sfxOut()` so she rides the SFX
  fader). Keep the current source node so a new line can `.stop()` the old.
- **Captions**: a small subtitle plate (the `makePopup()` canvas pattern,
  industrial style) follows 0.35 m under the orb and mirrors the spoken line.
  It replaces the old lesson cards entirely.
- **Interaction**: gaze = head-forward · (orb − head) normalised > 0.92 held
  0.5 s. Confirmations happen on **the console** — a small industrial panel
  anchored 1.2 m to the player's right, *the same spot where the BALL
  LOADOUT panel later materialises*. For the two confirm beats it shows a
  single big button (laser + trigger click — the existing `READY_BTN` /
  `updateReadyPointer()` mechanism from `TutorialSystem.ts:192`, just moved
  onto the console plane). Teaching that spot early pays off in Beat 6.

### Global rules (all beats)

- Tutorial still rides the ordinary vs-bot bout (`start-tutorial` in
  `MenuSystem.ts:531`); `suppressBot()` + `pinHealth()` + round-timer top-up
  stay exactly as they are. `app.tutorialHoldFire` is only true during
  Beat 0.
- **Praise pool**: repeat successes (retries, extra reps, extra attachment
  tests) draw from the E-100 pool, never repeating the last pick.
- **Idle nudge**: any WAIT that sits 14 s replays the beat's explain line;
  at 30 s, **E-110**. Never punishes, never times out.
- Any line interrupts the current line. Reactive fight lines each fire at
  most once.

### Beat 0 — ATTENTION *(the hook — `app.tutorialHoldFire = true`)*

Arena fades in. Tutorial music low. **Ember does not start in front of you.**

1. Orb spawns dim and small ~2.5 m out at the player's **10 o'clock**, just
   inside peripheral vision. Soft two-note chime. **E-010** ("Over here.") —
   quiet, spatialised, off to the side.
2. She drifts across the periphery, left → right, trailing embers — along a
   path **fixed in the room**, so turning toward her catches her. WAIT for
   **gaze**. If no gaze after ~4.5 s she chimes and swings straight into the
   player's eyeline (never lurk off-axis or behind the head) and flares.
3. On gaze (or forced park): a composed little bounce, flare, **E-011**
   (hello / name).
4. **E-012** — clear some room, then hit **BEGIN** on the console. As she
   says it she glides to the console spot and the panel fades in beneath her
   with its single button; her leading the eye there is the tutorial for
   *where tutorial UI lives*. On the click: soft chime, ember burst, panel
   folds away, `tutorialHoldFire = false`. That's the whole setup.

### Beat 1 — IGNITE

1. Orb circles the player's dominant fist twice, tracing the orbit path a
   ball will take. **E-020**.
2. WAIT: `playerBallIn(BallState.Orbit)` (existing `TutorialSystem.ts:393`
   poll). 10 s stall → **E-022** + haptic tap, orb taps the fist.
3. Success → **E-021**.

### Beat 2 — THROW

1. The sparring bot wears a **rusty orange-brown** tint the whole tutorial
   (he IS the rust bucket) and stands **dead still** through the opening
   beats — he only wakes into his idle sway on this beat's first line, right
   as she names him. Ember stays on the player's fist while the ignite
   praise finishes, then flies downrange ON the rust-bucket line and hovers
   over the bot's head, bobbing — a living target marker. **E-030** (her
   spatial voice from over there is the aim cue).
2. WAIT: `playerBallIn(BallState.Flying)`. Release under
   `FIREBALL.minPunchSpeed` (1.1 m/s) → **E-032**.
3. Success → **E-031** (bigger if it connects — `resolveLocalHit`,
   `CollisionSystem.ts:196`).

### Beat 3 — RECALL

1. Orb returns to the **podium** — dead ahead at eye height, inside the
   player's downrange sightline (playtest: anything said from beside the
   head goes unread). **E-040**.
2. WAIT: ball goes `Returning`, then reverts to `Hover` (caught). Stall →
   replay **E-040** per the global nudge rule.
3. Catch → **E-041**.

### Beat 4 — BLOCK *(waits for a real parry; throws more balls as needed)*

Tag the entity of each lobbed ball; bump a tutorial-readable deflect counter
in `CollisionSystem.tryParry()` (`CollisionSystem.ts:326`) when the spent
ball is the tagged one. Outcomes per lob: **blocked**, **hit**
(`feedback.playerHitFlash` while tagged ball live), or **missed/expired**.

1. Orb talks from the podium (front and centre); she only steps wide of the
   firing line while a lob is actually in flight. **E-050** (shield + he's
   going to throw).
2. WAIT: player has an `Orbit` ball — she won't let the bot throw until the
   shield exists (same guard as today's `tickBlock()`).
3. Lob #1 at **2.4 m/s**, mid-chest. At release: **E-051** ("Incoming.").
4. Resolve:
   - **Blocked** → ember burst at the parry point, **E-052** — which rolls
     straight into the second rep: lob at **3.2 m/s**.
   - **Hit or miss** → **E-053**, lob again at **2.1 m/s** (easier). **No
     failure exit — she throws balls until the player blocks one.** Repeats
     pull from the pools so nothing loops verbatim.
5. Second (faster) block lands → **E-054**. If the faster one gets through,
   drop back to 2.4 m/s with a pool nudge until she gets her second block.

### Beat 5 — MOVE *(the footwork drill — left and right, twice each)*

**Movement is everything.** This is now a drill, not a checkbox: the player
must land **one clean dodge each way** — left, then right — and a failed rep
repeats its side until it's clean. (Playtest note: four scripted reps was a
slog; two clean-or-retry reps keeps the lesson honest without the grind.)

Per rep: Ember **darts to the called side, forward of the player** (the
visual cue stays in their field of view), calls the side (**E-061 / E-062**)
as the bot lobs at the player's **head** at 2.6 m/s — and **the called half
of the platform lights up GREEN** (`goTelegraph` in
`src/campaign/telegraphs.ts`): the same floor-decal language the titans use
for their kill zones, inverted to "stand HERE". Its fill charges with the
lob's flight, chevrons march into the safe half, and the centreline rail is
the line to cross. Success = the ball
passes clean AND the head moved **≥ 0.35 m in the called direction** from its
position at the moment of the throw. A hit, or a dodge the wrong way, doesn't
count — **E-063**, repeat that side (drop to 2.3 m/s after two misses on the
same side). A clean first rep gets a praise-pool line; the second completes
the drill.

1. **E-060** — the explain. A gentle front-and-centre sweep shows the two
   lanes (kept narrow so she and her caption never leave the reading zone);
   praise/retry lines between reps come from the podium.
2. Reps: L → R with the call-outs, retrying a side until it's clean.
3. Drill complete → **E-064** (the Sheriff line — fires once ever).

### Beat 6 — ATTACHMENTS *(loadout panel in-arena + live test on the bot)*

1. **E-070** — orb flies back to **the console spot** (the player already
   knows it from Beat 0), pulsing. The **BALL LOADOUT** panel materialises
   there — reuse the `'balls'` panel drawing + `clickBalls()` hit-test from
   `src/menu/menu.ts:1181` on a tutorial-owned plane, lasers re-enabled for
   it (TutorialSystem already owns pointer lines). The panel gains a
   **READY** button in its footer for the exit.
2. **E-071** — she names SPLIT / GROW / SHRINK / CURVE, **hopping to each
   row of the panel in time with the line**, and tells them to pick one.
3. WAIT: any change to `app.ballAttach` (or `app.ballArc`). On equip →
   **E-072** — throw, then recall **while it's still flying**. Orb takes her
   target post over the bot.
4. WAIT: a player ball goes `Flying` → `Returning` with `attach != none`
   (`applyAttachment`, `FireballSystem.ts:189`). Recall-after-landing →
   **E-075**.
5. Effect fires → **E-073**. Then **E-074**: free-play — she waits, praise
   pool on further tests, and the exit is the **READY** button on the
   loadout panel's footer. Panel folds away on the click.

### Beat 7 — GRADUATION FIGHT

1. **E-080** — the proud send-off; she zips up to a **corner perch** above
   the arena and dims to a spark. Bot un-suppressed, HP still capped at
   `TUT_BOT_HP = 55`.
2. Reactive one-shots from the perch (each once): first hit landed →
   **E-081**; first time hit → **E-082**; bot under 15 HP → **E-083**.
3. **Win** → she dives from the perch, spirals around the player trailing
   embers: **E-084**, then the normal return-to-menu.
4. **Loss** → she's at the player's side instantly, soft: **E-085**. Menu.

---

## 3. The complete recording script

**Context for the voice actor.** FIRE FIGHT is a virtual-reality boxing game
where fighters conjure flaming iron balls around their fists — spin one up,
punch it at your opponent, call it back, block with it. It's set in Gasket, a
scrappy frontier factory town, and the players are "Clankers": big
good-natured metal boxers. You are EMBER — the last living spark of Gasket's
old foundry, a small floating ball of warm light who has appointed herself
the new player's personal coach. Your read is calm, precise and quietly warm
— think a voice assistant with a soul: perfect diction, an even smile, never
shouting, never gushing. Warmth comes through word choice and a small lift in
the read, not volume; praise delivered level ("Well done.") should land
harder than any exclamation could. You're guiding a nervous first-timer
through their first ten minutes in the headset — every line plays over live
gameplay while they physically punch, dodge and duck around their room.

33 numbered lines + 6 pool lines. **Bold** = punch the word (gently — she's
Siri, not a hype man). The default read for everything is calm, level,
smiling.

### Beat 0 — Attention & setup

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e010-over-here` | "Over here." | Quiet, inviting, off to the side. | Orb spawns at 10 o'clock. |
| `e011-hello` | "There you are. Hello, I'm **Ember**. Your guide, and statistically, your **biggest fan**." | Level and warm; the joke lands because she doesn't lean on it. | Gaze lands on her. |
| `e012-begin` | "Clear yourself a little room, Clanker. Then **press the button here**, and we'll begin." | Calm instruction; "a big step each way" matters (the move drill demands it). "Just here" as she glides to the console and the panel fades in beneath her. | Follows E-011; console panel appears with its BEGIN button. |

### Beat 1 — Ignite

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e020-ignite` | "Hold the trigger. Keep holding. You're spinning up a **fireball**." | Measured, slightly hushed — a demonstration, not a command. | Orb circles the player's fist. |
| `e021-ignite-done` | "There it is. **Well done.**" | Understated approval — let the pause before "well done" do the work. | Ball reaches Orbit. |
| `e022-ignite-retry` | "Hold, don't tap." | Patient, precise. | 10 s without a spin-up. |

### Beat 2 — Throw

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e030-throw` | "See this **rust bucket**? Throw towards him, and release the trigger at the end of the swing. I'll mark the spot." | Even, unhurried; she's flying downrange to him as she says it. (Matches the recorded take.) | Beat start (she stays on the fist through the ignite praise; this line launches her over). |
| `e031-throw-done` | "**Good job.** He felt that." | Level praise, a hint of satisfaction on the second sentence. | Ball goes Flying / connects. |
| `e032-throw-soft` | "Spin up a ball, punch towards him, and release the trigger at the end of the swing." (Matches the recorded take.) | The full sequence again, step by step — patient re-teach with a lift of encouragement at the end, no disappointment. | Release under min punch speed (the ball dropped back to hover). |

### Beat 3 — Recall

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e040-recall` | "Pull the trigger again to call it home. Littering is a **crime**." | Deadpan on the second sentence. | Beat start. |
| `e041-recall-done` | "Caught. Throw, recall, catch. That's the heartbeat of everything. **Well done.**" | Quiet approval; the summary matters, keep it clear. | Clean catch. |

### Beat 4 — Block

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e050-block` | "This one keeps you alive. A spinning ball is a **shield**. Spin one up, hold it close. He's going to throw at you." | Her most serious read; still calm, just lower and slower. | Beat start. |
| `e051-block-incoming` | "Incoming. Punch it down!" | Cool, clear alert, then a crisp imperative — energy without panic; she stays composed. | Lob leaves the bot's hand. |
| `e052-block-done` | "Blocked. **Well done.** Again, a little faster this time." | Approval, then a composed challenge. Rolls straight into rep two. | Real parry on the lobbed ball. |
| `e053-block-retry` | "You're fine. Get your fireball spinning around your hand, and punch the oncoming ball to block. Again." | Steadying; used for hits and misses alike. Zero blame. Full re-teach of the mechanic — this is the retry line for the game's hardest concept. | Lob hit the player or expired unblocked. |
| `e054-block-two` | "Two for two. You're a **natural**, Clanker." | The praise ceiling: level voice, genuinely pleased. | Second (faster) block lands. |

### Beat 5 — Move

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e060-move` | "Blocking is good. **Not being there** is better. Movement is everything, Clanker. When I call a side, move. Whole body." | The thesis line of the tutorial; deliberate, each clause given room. | Beat start; orb sweeps the lanes. |
| `e061-move-left` | "**Left.**" | Clean call-out. Not shouted — clear and immediate, like a turn-by-turn direction. | Left-rep lob released; orb darts left. |
| `e062-move-right` | "**Right.**" | Same as E-061, mirrored. | Right-rep lob released; orb darts right. |
| `e063-move-retry` | "Bigger steps. Off the line. **Again.**" | Crisp reset; used for hits and wrong-way dodges. | Failed rep. |
| `e064-move-done` | "**Lovely** footwork. The Sheriff says Clankers can't dance. The Sheriff is wrong." | Deadpan throughout — the flattest, driest read in the script. | Four clean dodges (fires once ever). |

### Beat 6 — Attachments

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e070-attach` | "Now, my favourite part. Come look. This is your **ball loadout**." | A small, contained lift in energy: this is her excited. | Beat start; panel materialises at the orb. |
| `e071-attach-list` | "**Split** breaks it into three on the way home. **Grow** makes it big and mean. **Shrink** makes it small and spiteful. **Curve** bends around their guard. Pick one." | Rhythmic, evenly paced — she hops row to row on each name. | Follows E-070. |
| `e072-attach-test` | "Good choice. Now throw at him, and recall while it's **still flying**." | Approving, then the lesson; lean on "still flying". | `app.ballAttach` / `ballArc` changes. |
| `e073-attach-done` | "Did you **see** that? I never tire of that one. **Well done.**" | Her one almost-delighted read — still composed, but the smile is audible. | Attachment effect triggers mid-flight. |
| `e074-attach-free` | "Try the others if you like. **Press the button** when you're ready." | Relaxed, unhurried; the small wordplay stays level. | Follows E-073; free-play begins. READY button on the panel footer exits. |
| `e075-attach-retry` | "Recall while it's still in the **air**. Timing is everything." | Helpful, precise. | Recall happened after the ball landed. |

### Beat 7 — Graduation

| ID | Line | Direction | Trigger |
|---|---|---|---|
| `e080-grad` | "That's everything I've got, and look at you now. Knock him down, and you're done. **Make me proud, Rookie.**" | Proud but level; the send-off rises just a shade as she lifts to her perch. | READY clicked on the loadout panel; fight begins. |
| `e081-fight-hit` | "There it is." | Quick, satisfied. | First hit landed (once). |
| `e082-fight-taken` | "Shake it off. You're **iron**, remember?" | Warm, steadying, brief. | First time the player is hit (once). |
| `e083-fight-low` | "It's done for. **Finish it.**" | Cool urgency — the closest she gets to intensity. | Bot under 20 HP (once). |
| `e084-win` | "Down goes the rust bucket. **Well done, well done, well done.** Go check out the locker and the store, get yourself some drip. Gasket's waiting for you, Clanker." | The three "well done"s stay level — the repetition is the celebration. Fond close. | Bot KO'd; return to menu after. |
| `e085-lose` | "Up you get. He's been at this for years. You, about ten minutes. Come back swinging. **I'll be here.**" | Soft, certain, no pity. The promise is the retry hook. | Player KO'd. |

### Praise pool (E-100s) — rotate at random, never repeat the last pick

Used for repeat successes: block/dodge reps 1–3, extra attachment tests, any
small win that already had its scripted line. **Record 2–3 distinct reads of
each — level, warm, never canned.**

| ID | Line |
|---|---|
| `e100-good-job` | "Good job." |
| `e101-well-done` | "Well done." |
| `e102-nice` | "Nice." |
| `e103-thats-it` | "That's it." |
| `e104-perfect` | "Perfect." |

### Nudge (long idles, any beat)

| ID | Line | Direction |
|---|---|---|
| `e110-no-rush` | "No rush. Whenever you're ready." | Utterly patient; she'd wait all day. |

---

## Engineering summary (delta from today's `TutorialSystem`)

- **Keep**: `start-tutorial` flow, `suppressBot()`, `pinHealth()`,
  round-timer top-up, `TUT_BOT_HP`, `playerBallIn()` polling, knockdown →
  menu exit, tutorial music.
- **Replace**: the six lesson cards + READY button → Ember (orb + spatial
  voice + subtitle plate) and the beat machine above; `blockTimer` survive
  check → real parry detection (tagged ball + deflect counter bumped in
  `tryParry`); the any-direction `move` check → the four-rep left/right
  dodge drill with per-rep direction verification.
- **New**: `src/audio/tutorVoice.ts` (announcer clone + HRTF panner),
  `src/assets/tutor/*.mp3`, orb visual (glowSprite + ember trail), the
  **console** — a fixed panel anchor to the player's right that hosts the
  BEGIN button (Beat 0), then the BALL LOADOUT panel + READY button
  (Beat 6), reusing the existing `READY_BTN` laser-click mechanism and the
  `'balls'` panel draw/hit-test; reactive fight one-shots; praise pool with
  no-repeat-last rotation.
- **Ordering**: TutorialSystem already runs before FireballSystem
  (`main.ts:102`), so its `ballCommands` pushes and `tutorialHoldFire` edits
  land the same frame — no changes needed there.

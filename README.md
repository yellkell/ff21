# FIRE FIGHT 2 🔥🥊⚡

The sequel to [FIRE FIGHT](https://github.com/yellkell/iron-balls-boxing),
with [RAVE RAID](https://github.com/yellkell/dance) folded in as a mode.
One town: fireball boxing, titan raids and rave sets launched from one
shared club, by one fighter you paint over months.

**Read [`DESIGN.md`](DESIGN.md)** — the full sequel design and build order:
the wrap-around three-panel menu, the club-as-launcher (THE BELL), the pit
and the crowd that can't be heard, the new campaign wearing RAVE RAID's
move grammar, the blank mannequin + stripe-paint customization, the
beautiful dark desert, link/Discord match joins, and the web leaderboard.

## What's here now

- **NO MORE FEATS ON THE LEADERBOARD.** The run boards (SPEEDRUN, RAID,
  GOOP RAID) are plain races against the clock again, one difficulty at a
  time:
  - **In game:** RANKINGS › ARCADE opens each board on NORMAL, with HARD
    and BLAZING beside it and the HC ONLY toggle. The FEATS view is gone,
    along with its hardest-first ordering, the difficulty plate on every
    row and the dividers between feats. A hardcore run keeps a small HC
    plate.
  - **`stats.html`:** its rail is Normal · Hard · Blazing and each of those
    again for HC, every row ranked by time. Its strip shows the fastest
    Normal speedrun instead of the "top feat".
  - **Unchanged:** runs are stored exactly as before (one board per
    difficulty, and per difficulty for hardcore, plus the legacy mixed
    board), so nothing posted is lost. The profile's achievement badges
    and the Gazette are untouched.
- **THE TITANS FACE YOU, GOOPLIATH MOVES WITH HIS ATTACKS, AND THE WAVE
  STOPS FLASHING.**
  - **Arms in front.** Every titan gesture used to play behind its back:
    the move language writes a reach as a negative shoulder pitch, but on
    these rigs a positive pitch swings the arm toward you. So the X crossed
    its bars a metre past the titan's shoulders, the point jabbed away from
    you and the press clapped behind its head. `rigPitch` / `rigFold` in
    `campaign/gestures.ts` are now the one place a pose meets the rig. They
    turn every reach and fold toward the player, in the game and in
    `check:gestures` alike. The X and the scissor bars come down 0.35 so the
    high bar still clears the visor: the rest pose's forward hang now adds
    on instead of cancelling.
  - **Goopliath moves with his attacks.** He throws nothing. Every beat
    of an attack heaves his whole body toward the part of your deck about
    to burn, peaking as it goes off. The seesaw rocks him half to half with
    the floods, about ±0.55 m. He sinks into each heave, the gel shudders
    on the beat, his sweep is a fat gel tendril, and it all runs to blood
    once THE TIDE RISES.
  - **The wave flash.** A new move's danger strips were added visible and
    unfilled, and a cascade's later steps were only hidden on the next
    frame. So every beam of THE WAVE flashed down at once as the move began.
    Each read is now settled the moment it's built.
  - **Checks.** `check:delivery` asserts no read shows before its turn
    (it counted 5 on the old code) and runs a GOOPLIATH bout too.
- **THE TITANS THROW THE HIT** — a titan's floor attacks used to charge
  a mark on your deck and then just go off there, while the machine mimed
  from across the pit; nothing ever left its body. Now, as each zone comes
  due, a fire bolt leaves the striking fist and lobs onto your deck, landing
  on the beat inside the part that burns (the doomed half, the rim, the
  lane; never the safe gap), and the whole chassis lunges in behind the
  throw. The sweep's blade rides a lit haft back to the fist, so the cut is
  the end of the arm. It's purely visual: zones, timings and the hit rules
  are unchanged, so every read and dodge is exactly as fair as before
  (`campaign/delivery.ts`, tuned by `DELIVERY` in `config.ts`). Checked by
  `npm run check:delivery`. That probe, and `check:grammar`, now freeze the
  titan's clock and step it at a fixed 60 Hz, because a GPU-less runner
  renders a frame every few seconds and whole moves used to land between
  two looks.
- **THE FEAT BOARDS, and a plain-spoken GAZETTE** — the run boards could
  not keep the runs worth bragging about. RAID and GOOPLIATH held one row
  per player across every difficulty, and the rules only let a row get
  *faster*, so a twenty-minute BLAZING HARDCORE clear was refused if you
  had a quicker NORMAL one on file; a hardcore speedrun slower than your
  plain one on that tier went the same way. Every FEAT (run × difficulty ×
  hardcore) now has its own board (`runBoard`, `net/boards.ts`), a
  hardcore run also counts on its tier's plain board, and the legacy mixed
  boards are still written and read so older runs keep counting. RANKINGS
  › ARCADE's run boards open on **FEATS** (each squad's hardest clear,
  hardest first, with the clock only breaking ties inside a feat) with
  NORMAL / HARD / BLAZING and **HC ONLY** filters; every row leads with its
  feat as a coloured plate, hardcore and blazing rows glow, and raiders who
  posted the same run fold into one squad row. `stats.html` gets the same
  views. **The Gasket Gazette** drops Sheriff Cole and the beach-town
  vocabulary: it's straight reporting now, with a **BY THE NUMBERS**
  strip, **THE RECORD BOOK** (the hardest clears on the boards) and **WHAT
  TO DO TODAY** (open feats nobody has cleared, thin boards with a podium
  place going, the season clock), and the welcome edition is a real guide
  to every mode. The brief (`scripts/ladder-brief.mjs`) hands the daily
  task the record book, new clears, open feats and the season race;
  `docs/gasket-gazette.md` is the style guide.
- **HEADGEAR FITS THE HEADS, and BASTION** — every head piece (horns,
  crests, crowns, halos, visors…) was modelled on the bare skull and was
  worn over an animal with one uniform scale and a lift that OVERWROTE the
  piece's own height, so halos cut through snouts and crowns floated. Each
  head now carries a measured fit (`HEAD_FIT`, `avatar/heads.ts`): its
  cranium — crown height, temple width, brow-to-back depth, cast from
  inside the head with the snout, ears and fur left out — and the bare
  skull is mapped onto it per axis from a wrapper round the piece, so a
  piece keeps its own lift and tilt. The knight, stallion and frog are
  hand-tuned on top (a flat-topped helm, a small cranium on a long face, a
  wide flat head), `PIECE_FIT` re-places single pieces (ram's horns cut
  down on the frog and the horse), and where no fit could work a head
  wears its own cut of the piece (`VARIANTS`, `avatar/gear.ts`): the
  FROG's visor is a pair of GOGGLES round its eye turrets and its crown a
  little FROG PRINCE crown tipped on the flat of its head; the HORSE's
  visor is a pair of BLINKERS on a cheek strap. Same ids, bought once. New on the SHOULDERS shelf: **BASTION**, the rounded
  set with no spikes — great smooth domes, a ridge over the crown, a
  heavy rolled rim, a piped tier down the arm, lit studs.
- **THE HEADS, SEATED** — the animal heads hovered 4–8 cm over the neck
  (each was placed on the head's centre, and the room under a jaw, beak
  or ruff differs head to head); each now drops by its own measured SEAT
  so its underside clears the collar by the bare skull's centimetre, and
  headgear drops with it. The round heads are carried about a tenth
  bigger (a bear no wider than the bare skull read small). THE CLUB's
  MIRROR now rebuilds your reflection when your gear, paint or tone
  changes (it was built once, on the way in), a room-mate who re-gears
  mid-visit gets a fresh rig on the floor and in the glass, and a
  reflection re-twins when a piece is swapped for one with as many meshes.
- **THE SHOULDERS, a slot of their own** — pads were BODY gear, so a pair
  of pauldrons shut out a cape or a chestplate. The GEAR board has a
  SHOULDERS shelf now (HEADS · HEADGEAR · SHOULDERS · BODY · HANDS):
  PAULDRONS and SPIKED PADS move onto it, joined by the **WARLORD** (great
  round domes in a heavy rolled rim, a crest of three flame tongues
  licking out over the arm, a flared lower tier and lit studs — the old
  raid-boss paladin's pauldrons), **EPAULETS** (dress boards piped in
  trim, a crescent and a bullion fringe off each point, a lit button) and
  the **GLADIATOR** (one arm armoured: four lames stepping down the left
  arm and a flat guard standing off the top). The BODY shelf gains a
  **CAPE** (pleated, hung off the shoulder line, corded to lit clasps at
  the collarbones) and a **TABARD** (a panel front and back, cinched at the
  waist, a lit lozenge on the chest). Shoulders are their own paint
  surface (`gearShoulders`, part 9 on the wire); a saved look whose body
  piece was a pair of pads carries their marks across. The gear string's
  cap is 64 on every relay now (five slots). `avatar/gear.ts`.
- **THE HEADS** — FIRE FIGHT 1's animals are back, on the blank: a new
  HEADS shelf on the GEAR board sells BEAR, PANTHER, EAGLE, KNIGHT,
  STALLION, WOLF, FROG and BUNNY, each worn in place of the bare egg
  (`avatar/heads.ts`). Same lofted skulls as FF1, iterated for FF2: primer
  shell you can paint, dark trim only where a face needs holes, eyes lit
  in your accent and nothing else, tufts for fur and feathers where FF1
  had flat plates, and sized down to sit on the slender mannequin. Wear
  headgear with them — horns and crests ride out to the bigger crown.
  Purely visual: the head hitbox never moves. DESIGN.md §5.2. The WOLF
  (ruff, leaf ears, a proper jaw), FROG (lidded turrets, a wrap-round
  smile, no pupils), BUNNY (leaf ears, one folded over), BEAR (smooth,
  no lumps), PANTHER (a proper cat) and STALLION (bridle, clean nose)
  are FF2 redesigns; the KNIGHT's skirt wears the body's colour.
- **PAULDRONS** — the plain shell domes are back, now seated on the body
  so their inner edges rest on the shoulders instead of cutting into them;
  the **SPIKED PADS** are the same shell a size up, three spikes through it.

This repo is seeded with the complete FIRE FIGHT 1 engine — it builds and
plays exactly as FF1 did, and gets rebuilt into FF2 phase by phase
(DESIGN.md §10). [`FOUNDATION.md`](FOUNDATION.md) is FF1's own README,
carried over verbatim: everything in it still applies to this code.

- **THE TITANS, FINISHED** — the five machines stop reading as blocks.
  A finishing pass over each rig (`finishTitan` in `campaign/bosses.ts`)
  bevels every box and rounds every barrel without moving a pivot, and
  each machine wears its own procedural SKIN (`materials/titanSkin.ts`:
  colour, roughness, metalness and bump, drawn once): RUSTHOOK's blotched
  rust, pitting and weeps; PISTONKAISER's hammer-dimpled iron with temper
  colours; VULTURE's scale plumage; JUGGERNAUT's riveted panel armour;
  GOLIATH's brushed black plate engraved with scrollwork. Rust and paint
  aren't bare metal any more, so the hulls stop mirroring the room black.
  And each theme grew: a hazard-striped salvage plate, riveted patches and
  a live severed cable on RUSTHOOK; heat vents and molten cracks on
  PISTONKAISER; a raised feather ruff and wing coverts on VULTURE; track
  links and a stencilled IV on JUGGERNAUT; crown jewels and a chain of
  office on GOLIATH. Repeated parts merge to one mesh, so draw calls barely
  move. Dev: `/titan-preview.html` (`?t=0..4`, `&close=1`).
- **STATS** — the boards get a podium (medal discs, a lit edge, the
  leader's row in gold) and a gauge under every row showing how close it
  runs to the leader; RAVE RAID's record list is alphabetical with a find
  box; OVERTIME joins the shelf, and `npm run check:stats-tracks` (in CI)
  fails whenever the page's song list falls behind the raid shelf.
- **NO FALLING BLOCKS, NO CHASING LASER** — two titan attacks cut after
  play: the **SLAM** (the ghost block hanging over a disc on your pad,
  dropping with the countdown and crashing down) weighs zero on every
  titan, so none of them throws it — the **SEESAW** (one half of the pad
  floods, then the other: cross) takes its weight on every machine; and
  the beam no longer **TRACKS** you
  through its charge — VULTURE, GOLIATH and GOOPLIATH aim it once, where
  you stand when it starts, and it stays put (`beamTracks` is off on
  every def). The machinery for both stays for the dev probe and a later
  bill. (THE RECITAL was already off the titans' bill; RAVE RAID's
  ROUTINE is untouched.)
  And every titan past RUSTHOOK throws the **CROSS** now, not just VULTURE: the arms
  go out like wings and snap across the body as the side rails fire.

- **THE BANK** — iron-dollars for money. The STORE has a third chip,
  BANK, and the YOU wing's purse is a door to it: four packs — 500 · 1300
  · 3000 · 7000 — a pack is its number and its price, nothing else to read.
  A tap asks THE ROOM SERVER's `/bank` (`server/bank.mjs`) for a
  **Stripe Checkout**: PAY THROUGH YOUR HEADSET opens it in the headset's
  browser, or the board shows it as a **QR** — take a screenshot, open it
  on your phone (the Meta app syncs headset screenshots) and tap the code. Stripe's signed webhook credits
  **THE LEDGER** (`bank/{uid}` in Firestore: `credit`, `claimed`, a
  receipt per session so a retried webhook credits nothing twice — no
  client may write it, `firestore.rules`), and the headset **CLAIMS**
  what it is owed (`src/net/bank.ts`) at every boot and every few
  seconds while a checkout is up, so the coins land in the wallet within
  a breath of paying. A claim carries an id the headset keeps until its
  coins land, so a reply lost on the way back is asked for again and paid
  again rather than lost; a full refund or a dispute cancels whatever of
  that purchase is still unclaimed, and records what was already
  collected as `unrecovered` on the account. The client never sees a card and never names a
  sum; the packs and prices are the server's. **Without
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `FIREBASE_SERVICE_ACCOUNT`
  on Render the bank runs in DEV mode** — a one-button fake checkout
  page, a ledger in memory, a TEST MODE badge on the board — and charges
  nobody; a Stripe key with no ledger to write is refused outright. To
  go live: create the Stripe account, add the three secrets to the
  Render service (`render.yaml` lists them; the webhook endpoint is
  `https://<room server>/bank/webhook`, events
  `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `charge.refunded` and
  `charge.dispute.created`), and make a service-account
  key for the ff2 project. The bank charges in GBP by default
  (`BANK_CURRENCY`), prices tax-inclusive. **Managed Payments** — Stripe
  as the merchant of record, charging and filing the VAT of wherever the
  buyer is — is set up on the account (Settings › Managed Payments, one
  eligible product, "enabled by default" for every Checkout Session);
  `BANK_MANAGED=1` asks for it explicitly per session and every pack
  carries `BANK_TAX_CODE` (default the video-games code the account
  declared). On a deployed host with no `STRIPE_SECRET_KEY` the bank is
  CLOSED — every door answers 503 — so a fresh deploy never runs the
  laptop's fake-PAY dev mode in public. `public/terms.html` carries the terms of purchase
  (virtual currency, no cash value, non-refundable once delivered),
  `public/paid.html` is where Stripe lands you after paying, and the
  privacy page says what the ledger keeps. Probe: `npm run check:bank`
  walks the whole loop against a dev-mode server with no money in it;
  `--headset` (with `npm run dev` up) drives the STORE's board too.
  **THE CLOUD WALLET** (`src/net/walletSync.ts`): the coins and the
  locker are mirrored to `players/{uid}` (`coins`, `walletAt`,
  `ownedPlatforms`, `ownedGear`, `ownedAvatars` — capped in the rules)
  and merged at every boot (`src/net/walletMerge.ts`: the inventory is a
  union, the coins go to whichever side changed last, a fresh browser
  adopts the cloud), so a cleared browser gets everything back. Nobody
  signs in to play: the anonymous uid every headset already has is the
  account. **THE ACCOUNT** — for buyers only, never required: the PAID
  face offers PROTECT WITH EMAIL, pre-filled with the email typed at the
  checkout; the server attaches it to the anonymous uid (Admin SDK
  `updateUser` — the uid never changes, nothing moves). On another
  headset, the BANK board's RECOVER takes the email, Firebase emails a
  sign-in link, the phone that opens it lands on `recover.html`, signs in
  as that uid and shows a six-digit HANDOFF code (`/bank/handoff`), and
  TYPE THE CODE in the headset redeems it (`/bank/redeem` → a custom
  token → `signInWithCustomToken`) and restarts the game as the recovered
  account, merging as an ADOPTION (the account's wallet plus whatever the
  headset earned as a stranger). Opened on the headset's own browser, the
  link signs the game itself in. **Firebase console, once:** switch on
  the Email/Password provider with *Email link (passwordless sign-in)*,
  add `ff2.web.app` to Authentication → Settings → Authorized domains, and
  never enable the automatic clean-up of anonymous users (a protected
  account is still an anonymous-provider user with an email on it).
- **THE FORGE, and the second shelf of gear** — the PLATFORMS board is
  SHELVED now (TIMBER · STONE · FORGE · HONOURS), like the GEAR board's
  slots, so a catalogue of seventeen pads shows nine at a time at full
  size; hovering any tile reads its one line in place of the price.
  Four new decks (`arena/decks.ts`): **BASALT** (a honeycomb of
  six-sided columns, seamed), **COPPER** (hammered, verdigris pooling in
  the dimples), **MAGMA** (a black crust, and the cracks lit from
  underneath — the first deck with an emissive map, so only the cracks
  glow) and **METEORITE** (acid-etched iron-nickel, the Widmanstätten
  figure). Four new pieces (`avatar/gear.ts`, appended so the store's
  indices hold): a **CROWN** of six points, **ANTLERS** with brow tines,
  **WINGS** — three swept plates off each shoulder blade — and **CLAWS**,
  three talons over the knuckles.
- **THE SAND, THE ROCKS AND THE CACTI** (DESERT 2.1) — the ground was
  one sine ripple tiled seventy times, and read as corduroy to the
  horizon; the mesas wore the boulders' skin scaled up, and read as
  stacked orange cakes; the boulders were smooth potatoes in the same
  stripes; the cacti were green capsules. Now:
  - the sand is a skin that seams nowhere (`textures.ts` tileNoise —
    asymmetric ripples in wandering fields, cross-ripples, grain) under
    vertex-baked dune light, anisotropy 1 so the ripples melt by the
    mid-distance, and **AERIAL PERSPECTIVE** (`arena/desert/haze.ts`) —
    a directional fog in the far layer's materials only, hot toward the
    dying sun and mauve away, thinning with height;
  - the mesas are cut from ONE stratigraphy (`strata.ts`): the bed table
    the skin paints (each bed its own sandstone, dark partings, vertical
    joints, varnish) is the bed table the lathe steps by, so every ledge
    is a bed boundary, the caprock overhangs, the plan is lobed and
    elongated, the cliff fluted; the talus is its own scree material
    with fallen blocks lying on it; buttes and spires stand between;
  - the boulders are cleaved blocks (`rocks.ts` — sphere → rounded block
    → lumps → random cleavage planes, flat-shaded), four shapes in four
    instanced draws, in clusters, sunk and tilted, in a hide of grain and
    hairline cracks;
  - the cacti are ribbed lathes (`cactus.ts` ribbedTube — thirteen ribs,
    areoles with spines on every crest from `cactusSkin`, arms bent out
    of the trunk and up, a domed crown; the barrel fat and deep-ribbed
    under a woolly crown and flowers). Fixing its winding also fixed the
    gear tubes (horns, antlers, tail, claws), which had been inside out
    and lit from the wrong side;
  - `occupancy.ts` is the one list of taken ground: mesas and boulder
    piles claim their footprints and every plant asks before it stands,
    so nothing grows out of a rock any more.
  **THE BONEYARD's wreck ring is centred on the pit now, at 14 m**
  (`sites.ts`): every client stands at the origin and sees its
  teammates on the 6 m circle around the pit at any bearing up to ±144°
  from its own (`combat/layout.ts`), so the ring centred on the ORIGIN at
  12.5 m used to stand a wall two metres behind the far raider's
  platform. Nothing that stands up may be inside 9.5 m of the pit's
  centre (a build-time warning says so). `npm run check:desert -- --shots`
  renders the three sites, the far raider's spot from the origin, and
  close-ups of a cactus, a boulder and a mesa (`env-preview.html` takes
  `?focus=`, `?cam=`/`?look=` and `?seat=` now).
- `public/stats.html` — **THE WORLDWIDE LEADERBOARD**, rebuilt on RAVE
  RAID's stats-page surface language (near-black glass, corner brackets,
  the rail with its eased marker, Rajdhani) with FIRE FIGHT's hazard amber
  as the accent. Three faces on one rail, each swapping the accent and the
  pools on the floor:
  - **FIRE FIGHT** — RANKED · XP · AIM · 2V2 · FFA read off `players`
    docs; **SPEEDRUN** (what GAUNTLET is called now) · RAID · GOOPLIATH
    read off `boards/{board}/rows`. SPEEDRUN carries a difficulty
    sub-rail — NORMAL · HARD · BLAZING — because it is three boards, one
    per tier (`src/net/boards.ts` `speedrunBoard()`): a board is a
    ratchet keyed on your uid, so a single board would let your blazing
    run and your normal run fight over one row. The lobby's own board
    merges the three back into one ranked list wearing difficulty symbols.
  - **THE LAB**, a board of that same rail rather than a tab of its own.
    Every bout that lasts keeps a TAPE (`src/net/telemetry.ts`, posted to
    the `bouts` collection at the final bell): platform HEATMAPS of where
    you stand, where each hand throws from and where you were when hit;
    the play-by-play of every throw, hit taken, hit dealt, parry, round
    and ATTACHMENT — every SPLIT, GROW and SHRINK that actually fired, on
    either side, off the same wire the ball itself rides. Open a bout and
    it draws THE TIMELINE: the rounds as bands, both health pools rebuilt
    from the hits, and two lanes under them carrying the acts — a tick per
    throw, a diamond per parry, a lettered pip per attachment, a wedge per
    landed hit sized by its damage — with the attachments each side fired
    tallied beneath and the play-by-play in words under that. The
    page aggregates the last two hundred, filtered by player (a search
    narrows the picker, or matches any name on a tape), into stat
    tiles, five heatmaps (standing, each fist's throws, LANDING — where
    you stood when yours connected — and hits taken), a hands panel, a
    damage panel, and the tape
    itself — open one for its rounds, both health lines rebuilt from the
    hits, and the play-by-play.
  - **A PROFILE** behind every name: tap one on any board, tape or chart
    and the page lands on that player's service record, laid out the way
    the headset's card is — their PAINTING behind the name (the same bake
    the profile card uses, ported byte for byte from `avatar/paint.ts`),
    rank and points, honours, achievements, the note, what they wear —
    then the record: their rank and best on every FIRE FIGHT board and
    every rave chart they have danced. Tapes and heatmaps stay in THE LAB;
    a profile is the service record, not a second lab bench.
    `#player=<uid>` deep-links one.
  - **FFTV** — television. The headset RUNNING a bout (a bot
    bout's one player, a duel's host, the mesh authority, the raid host)
    casts a top-down frame five times a second to THE ROOM SERVER's `/tv`
    relay (`server/tv.mjs`; `systems/BroadcastSystem.ts` and
    `net/tvCast.ts` on the headset), and the page draws it: every
    platform, head, hands and health, the balls in the air, the round
    clock, the titan. Nothing on air and it peeps into THE CLUB — the
    rave relay's public floor, who is dancing where, the ball if one
    hangs. Club dark too and it says so. `?tv=ws://…` points the page at
    another relay.

  It reads the SAME project the game writes to (`flappy-ff9f6`, behind
  ff2.web.app) over the plain Firestore REST API — no SDK, read-only, and
  boards are read one at a time rather than as a collection group, which
  is what the rules allow. Probe: `npm run check:tv` (needs `npm run dev`).
- **THE JOIN LINK + THE BOT'S WRITE PATH** (DESIGN.md §8, phase 10, first
  pass) — every hosted room mints `?join=CODE`: a five-digit arena code
  booted with it walks the lobby into whatever the host opened (the keypad
  types itself; a four-digit club code hops to `rave.html?room=`). The
  squad room's invite band shows the code, the link, a QR a phone reads
  off the screen mirror (`src/ui/qr.ts`, byte mode, level M, verified
  against a third-party decoder) and, for the host, SHARE ON DISCORD. The
  Discord bot that has polled the bar-TV channel for years now POSTS
  (`server/discord.mjs`, one paced queue): THE BELL in the club posts the
  game and its join link when the ball goes up; SHARE posts a room card
  through `/tv/invite`; THE CHANNEL posts LIVE once a match has held eight
  seconds, and the final when it ends (bot bouts never make the paper).
  `DISCORD_BOT_TOKEN` arms it, `PUBLIC_URL` sets the links, and
  `DISCORD_BELL=off` quiets the bell.
- **THE CLUB, IN THE GLASS AND ON THE FLOOR** — three things a night in
  the club showed up. The hands now carry their TURN on the club wire:
  each controller's world quaternion rides the pose (eight more numbers
  on a `cp` frame), and every figure — the room-mates on the floor, your
  own reflection — wears it exactly as the arena's gloves do, so a palm
  held up is a palm held up and not a wrist hanging down. The glowsticks
  are gone from the floor and the mirror (the ring and the course keep
  theirs). And the figure's loft SEATS under the head instead of pinning
  its hips at the arena's fixed height, so a tall player's head no longer
  floats a hand clear of the neck in the glass (`solveTorso`'s new
  `seatUnderHead`; the arena keeps its hitbox-locked solve).
- **THE RECITAL, AND ARMS THAT BEND** — THE ROUTINE is withdrawn from the
  titans' book. GOLIATH taught **THE RECITAL** for a night and it has been
  cut from his bill too (the machinery stays in `campaign/grammar.ts` and
  the check still walks it):
  THE LESSON lights each quarter of a pattern in turn, each with its own
  NOTE — the pitch says front or back, the stereo pan says left or right,
  and a HOLD ("stay where you are") is a blue two-note chime with a ring on
  the floor — and then THE RECITAL calls the same notes with the floor
  dark, a beat and a half before each landing (`sfx.recitalNote`). The
  blocks still fall on the three quarters the note didn't name, but short
  and from low, so they confirm what you remembered rather than answer it.
  Three to five steps by act; a move never repeats the quarter before it,
  a hold always does, and holds never come in pairs. The titans' arms are
  articulated chains now — shoulder, ELBOW, WRIST, hand, with VULTURE's
  talons and the gauntlets' four fingers and thumb on hinges that curl —
  and every move drives every joint (`campaign/gestures.ts`): the classics
  got shapes of their own (the slam's HAMMER drawn, hoisted and trembling
  at the top; the sweep's SCYTHE; the beam's CANNON with the off hand
  bracing the barrel's elbow; the volley's LAUNCHER rocked back on its
  heels; the nova's COIL; the seesaw's TILT, a balance beam tipping toward
  the flood; the surge's SHOVE), and THE RECITAL is CONDUCTED — forearms
  up, a baton flick on every cue, an open palm for a hold — never pointed
  at.
- **THE SHOULDERS, AND A BODY UNDER YOUR OWN HEAD** — the first night's
  feedback: "my head was far above my body, and my body turned really
  quickly". Both were the torso solve (`avatar/boxer.ts` `solveTorso`,
  shared by you, your rival and the bots). The hips were pinned at the
  arena's fixed height because the chest and pelvis hit spheres live there,
  so a tall player's eyes sat thirty centimetres above their own neck; and
  the torso's yaw was the head's, one to one, every frame, so a glance
  across the gap whipped the whole body round. Now the HIT SPHERES keep
  the fixed-height solve every headset agrees on, while the RENDERED body
  seats under the head (as the club's figures already did) and carries
  its own SHOULDERS: a yaw that holds through a glance (a 37° dead zone,
  drifting square over seconds), comes round once the head is past it —
  fast, but never over 4 rad/s — and keeps coming until it is square to
  8°, so a turn finishes instead of leaving the body looking over its own
  shoulder. When both controllers are tracked the line between the hands
  pulls the shoulders half way toward it, ignored when it disagrees with
  the head by more than a right angle (a crossed guard). The spine's
  set-back hangs along the shoulders' yaw, not the head's, so looking
  sideways no longer swings the body around you.
- **VOIDSTEP points the way**: the circuit only closes one way round, and
  a body on a deck with ground on both sides picked wrong half the time.
  A chevron on the ground a step ahead of you now points at the
  invitation (`CourseWayfindSystem`), so the direction is never a guess.
- **BREAKERS look like breakers**: the panel kit grew a `toggle` role — a
  switch on the plate, label left, track and knob right, ON in the accent
  — worn by CURVE and SHOW MY BODY on the ball's ADVANCED face and by ONLY
  BOTS and SHOOT BACK on the slab. The ADVANCED face lost its prose too,
  keeping only "how hard it bends".
- **ACHIEVEMENTS that read**: the profile card's clear badges were bare
  glyphs on a 64px chip; each is a medallion, the feat's name and the
  tier now, wrapping when the card is narrow. GAUNTLET reads SPEEDRUN.
- **THE COLLAR is withdrawn** from the gear shop; an old save naming it
  simply wears nothing on the body.
- **THE HORNS** re-cut: the gear shop's HORNS are a ram's pair now — one
  tapered tube per side along a spline, rooted thick on the temple, up and
  back over the ear, down behind the jaw and forward to a point level with
  the eye, flat-shaded like the rest of the kit. You never see your own:
  `applyGear` skips the head slot on a rig flagged first-person, and the
  arena never draws the local head anyway.
- **THE WRAP** — the wrap-around three-panel lobby (DESIGN.md §2, phase 2),
  now TABBED (MENUS 2, the Overwatch / Fortnite grammar): every panel wears
  a strip of horizontal tabs across its top. The center slab is FIGHT ·
  ARCADE · CLUB (the battle flows drill in and BACK out inside FIGHT; the
  club's region pick is the CLUB tab; ONLY BOTS and SHOOT BACK stay demoted
  inside their tabs). THE TOWN (left) is TOWN · LADDER · NEWS — the
  leaderboard came in off the back wall and the Gasket Gazette is a tab,
  not a modal. YOU (right) is YOU · SETTINGS — the gear disc became a tab.
  Above the right wing, THE PROFILE pop-out replaced the floating coin
  readout: a chip with your name, rank and bolt-dollars that drops your
  card out over the wing — the painting, honours, achievements, your
  note, and RENAME (the only place a callsign changes now). Headless
  probe: `npm run dev` then `npm run check:wrap` (add `--shots` for
  face PNGs).
- **RAVE RAID, INSIDE** (DESIGN.md §7, phase 7) — the rhythm game is a
  third page of this app: `rave.html` boots `src/rave/` (the dance repo's
  source, file identities intact: the set, THE VOID, the decks and the 26
  masters, the tour, the club, the relay client) — reached from the
  ARCADE tab's RAVE RAID button, and its rail's FIRE FIGHT entry hops
  back. ONE TOWN: the dancer's name is the arena's callsign and their
  colour the arena's accent (`src/rave/game/profile.ts` reads FIRE
  FIGHT's keys first and writes them back on a rename); every finished
  record pays bolt-dollars into the one wallet (`config.songCoins`,
  named on the grade card); and every figure on the ring — the groupies,
  the giant MC, your reflection in the club's pier glass — wears THE
  BLANK (`src/rave/game/blankDancer.ts`: the arena's rig, IK, gear and
  paint bakes, with glowsticks). Relay: `npm run server:rave`. Headless
  probe: `npm run check:rave` (add `--shots`).
- **WHO HEARS WHOM** (DESIGN.md §3.2, phase 6) — `src/net/voiceRules.ts`
  is the one table every voice path reads: RANKED is silence (no mic, no
  ears), quick/private bouts hear their fighters, brawls every fighter,
  the raid its squad, the club the room, an audience everyone (fighters
  never hear a watcher's words). THE CROWD: a synthesised bed under every
  bout (`src/audio/crowd.ts` — distant murmur, a rumble that swells with
  the landings, roar stings on hits, cores, rounds and the win) with the
  HANDS-UP channel: both hands over the head swell the roar. THE
  AUDIENCE travels — a WATCH chip on any lobby row takes a watcher seat
  past the fighters' band in the same room (`config.AUDIENCE_SEATS`), and
  when the room launches you are dealt to the match's own place with the
  squad: onto the standing terraces (`src/arena/desert/audience.ts`) on
  the flanks of the flats and the boneyard, outside the cage line, rails
  capped hazard amber. A watcher sees every fighter where the arena
  actually put them, throws nothing and judges nothing, and every other
  watcher stands at the rail beside them
  (`systems/AudienceSystem.ts`). Their hands ride the mesh and each
  headset aggregates the same room-wide roar; their WORDS never reach a
  fighter, only the crowd. Probed in `npm run check:wrap`'s terrace
  section.
- **THE BLANK** — the mannequin (DESIGN.md §5): `src/avatar/mannequin.ts`,
  the ONLY body. TWO pieces and no more — ONE continuous lofted surface
  from the neck through shoulders, waist and hips to a monotonic taper,
  and a bare egg of a HEAD that floats free above it. (Chest and pelvis
  used to be separate lofts the IK moved apart, so the waist visibly
  opened as you leaned; the neck used to ride on the head and swung
  through the shoulders on every look-behind. Both joints are gone
  because there are no longer joints there.) Starts ALL WHITE or ALL
  BLACK ('blank'/'onyx', picked on the locker's COLOUR tab, synced over
  the skin wire). Honest to the hitboxes, immune to every recolour; the
  rest of your colour is paint. Preview:
  `/skin-preview.html?skins=blank,onyx`.
- **THE BOT LADDER** — the sparring bots scale with your rank. Every bot
  bout (QUICK MATCH, VS BOTS 2v2 / FFA) reads your cumulative XP, finds your
  Bronze→Overlord tier and blends one brain from the rows either side of it
  (`config.BOT_LADDER`, one row per rank; `src/combat/botBrain.ts` does the
  blend, `systems/BotSystem.ts` drives it). A fresh Bronze account spars the
  ROOKIE: slow, sloppy, throws at where your head WAS, notices fire late and
  often just watches it land. Every rank up is a ramp, not a cliff — by
  PLATINUM the BRUISER is FIRE FIGHT 1's old practice bot; the OVERLORD
  leads your head off its velocity, punishes the instant both your fists
  are empty, feints past its beat, double-taps, keeps a wall of a guard and
  steps the moment you spin up. Below DIAMOND a bout you're losing on rounds
  eases the bot a notch per round (`config.BOT_MERCY`); the tutorial always
  spars the ROOKIE. The bout panel names the grade you're facing
  ("contender · gold grade"). Dev: `?bot=gold` pins a rank's row,
  `?botskill=0.6` a raw skill. Headless probe: `npm run check:bot`.
- **THE MOVE GRAMMAR** (DESIGN.md §4, first pass) — the five titans
  learned RAVE RAID's dance: gates, crossfire rails + THE TRAP, THE X,
  the donut's one-two, marching waves that always turn, and GOLIATH's
  ROUTINE (taught corners, then falling blocks). Ported with the laws
  that make it readable — never the same move twice, body-verbs damped,
  THE FLOOR MANAGER — fully seeded for the raid wire, act-gated so easy
  bouts stay honest. And every shape has its GESTURE now
  (`src/campaign/gestures.ts`): the lane's point, THE X's crossed arms,
  the rail's scissor, the gate's press, the donut's wide-V ring, the
  routine's teaching finger, the wave's piston march — windup, gaze,
  follow-through, per chassis. Probe: `npm run check:grammar` (add
  `--shots`; it also asserts seven distinct silhouettes).
- **THE SITES** — one desert, three places (DESIGN.md §6.1): the lobby
  waits at THE TRAILHEAD (the GASKET sign under its lamp, a campfire, a
  windmill on the sun band), matches box on THE FLATS (the skull, two dead
  trees), and every campaign fight and raid stands in THE BONEYARD (a ring
  of wreck-plates and burning drums round the pit, RUSTHOOK's hook buried
  to the shank). The far layer turns with the site so the skyline moves
  too. With it, Desert 2.0's second pass — and the END of papercraft:
  `src/arena/desert/textures.ts` is a kit of six procedural skins (sand,
  rock, rust, bark, wood, bone; colour + bump from one seeded noise) worn
  by rippled dunes, smooth wind-carved mesas and boulders, bevelled iron,
  a real skull; clouds are soft sprites, the sky band lives on ONE horizon
  and cools to mauve behind you, a heat-haze swims at the ground line and
  dust hangs in the arena light. No litter: nothing on the sand that
  reads as debris.
  Preview: `/env-preview.html?env=desert&site=trailhead|flats|boneyard`;
  probe: `npm run check:desert` (add `--shots`).
- **THE PADS** — the platform shop rebuilt from scratch. A pad is what it
  is MADE OF now (`src/arena/decks.ts`, thirteen procedural deck
  materials with colour + bump from one seeded noise): the free three are
  charred oak (SMOULDER), pale ash (AZURE) and redwood (INFERNO); the shop
  climbs from WALNUT through SLATE flagstones, veined MARBLE, FROST (river
  ice), OBSIDIAN (black glass) and JADE to BULLION (gold leaf, laid square
  by square); CHAMPION is crimson lacquer with a gold inlay, TIDEBREAKER
  wet green stone under GOOPLIATH's pool, BLAZING scorched boards under
  the burning rail. Each skin also picks the neon tube's colour and the
  corner screws' metal. The tint-era ornaments (the XD grin, VOLT's bolt,
  SYNTHWAVE's grid, GOLD RUSH's medallion) are gone with their skins; a
  saved retired id falls back to SMOULDER. Tiles show a material swatch.
  Preview: `/skin-preview.html?pads=slate,marble,bullion`; the deck's
  telegraph shapes still at `/deck-preview.html?shape=gate|donut|x|routine`.
- **THE GASKET GAZETTE'S VOICE** *(since retired for plain reporting — see
  THE FEAT BOARDS above)* — Sheriff Cole Ironside had a bible: who he is (a tin-star
  who despises the Clankers and is one), how he sounds, what he never does
  (never names who fell, never breaks the fourth wall, never resolves the
  denial), his dictionary from the game's words to Gasket's, and the shape
  of an edition — headline, subhead, body, mood, plus a WANTED poster for
  the top climber, the Sheriff's NOTICE and the WEATHER, all laid out on
  the lobby's front page. Since THE COVE the paper is about **scrapping on
  the beach**: Gasket is GASKET COVE on the masthead, the Clankers scrap in
  the torch ring on the sand, titans come up out of the surf past the
  point and get beached, raids run on the harbour clock, newcomers wash
  up on the boardwalk, it is always sundown, and the salt air is doing
  something to the Sheriff's knee. The daily command lives in
  this repo (`.claude/commands/daily-gazette.md`); the wire report now
  names each fighter's gear and deck beside their paint.
- **GEAR** — the attachments shop (DESIGN.md §5.2): fifteen shapes that
  bolt onto THE BLANK in its own primer — crests, antennae, horns, halos,
  mohawks and visor bands for the head; pauldrons, a chestplate, a collar,
  a dorsal ridge, a belt and epaulettes for the body; cuffs, knuckle spikes
  and gauntlets for the hands. One per slot, purely visual (the hitboxes
  never move), tried on in the STORE's GEAR tab, worn from the LOCKER, and
  seen by everyone: the worn set rides the duel, the squad mesh, the club
  hello and your player doc, re-validated on arrival. `src/avatar/gear.ts`.
- **THE PAINT** ([`docs/paint.md`](docs/paint.md), P1–P4 shipped) — buy
  stripes and splotches by colour, place them minutely on your own body in
  THE PAINT BAY (YOU wing), and the room sees the result: your look packs
  to ~8 bytes a unit and rides the duel `iam`, the squad mesh and the club
  hello, baked once on join wherever your body renders. HIDE PAINT
  (the SETTINGS tab, or per-punter on the club console) and REPORT PAINT are the
  moderation backstops. P5: every piece of GEAR is a paint surface, and
  the rack sells DOTS and SQUARES beside stripes and splotches — sized and
  spun with the stick as you place them, capped so nothing swallows the
  body. THE RECORD: the look mirrors to your player doc,
  the LADDER's profile view and your PROFILE card render the painting behind your name,
  stats.html rows wear your colours as chips, and the Gasket Gazette's
  wire report names a champion's paint. Headless probes:
  `npm run check:paint` (wire + record + two-client room), plus the bay
  verbs under `window.__ff2.paint`.
- **PAINT P7 — clean, steady, one plate** ([`docs/paint.md`](docs/paint.md)
  §2, §4, P7). ONE customization plate: the YOU wing's CUSTOMIZE opens
  LOCKER · STORE · PAINT, three tabs on one plate in one place, and the
  STORE gains a PAINT board. The PAINT tab is one grid: an owned colour
  wears its count, one you've run out of wears its price, and a tap buys
  ONE unit and puts it on your pointer. The mirror comes to arm's reach
  while you paint and eases through its turns (◂ ▸, or spin it with the
  stick). Shapes are drawn TRUE TO SIZE — each surface is measured in
  metres, so dots are round, squares square and stripes even wherever
  they land. Steadied aim, the mark lands where you aimed just before the
  trigger's tug, stick detents with haptic ticks, UNDO (A / X), panel
  nudges for turn and size, picking by outline, and a live ghost cheap
  enough for every frame. The SPLOTCH is retired (owned and worn ones
  became dots), the TRIANGLE joins (wire format 4), and bought dots and
  squares no longer vanish from the locker on a restart.
- **GEAR: THE GLOW, EACH HAND ITS OWN, AND A FOURTH WAVE**. Every piece
  carries one element lit in the wearer's ACCENT (the halo's lip, the
  visor's slit, the feelers' bulbs, the pads' lower rims, a core in the
  chestplate…): the `accent: 'glow'` finish setAvatarAccent already
  drives, remembered on the rig so gear dressed later lights too — never
  paint. The right hand's gear is its own paint surface (`gearHandsR`,
  wire format 6; older hand-gear marks are copied onto both hands). New:
  V-CREST ($180), EAR FINS ($140), THRUSTERS ($300), WRIST BLADES ($220).
  The chestplate's sternum ridge is gone. `npm run gear:gallery` takes an
  accent (`... out.png ids 4fb7ff`).
- **GEAR, THE ART PASS** (`avatar/gear.ts`, `avatar/gearAtlas.ts`). Every
  piece rebuilt to read as kit, not primitives, in one detail language —
  primer where it takes paint, trim where it is fixed: mounts, collars,
  bands, rims, rivets, eased edges. The CREST is one sculpted fin with a
  serrated back on a trim rail (it was eleven stepped boxes); the MOHAWK
  is raked blades on a rail; the ANTENNAE bow from temple bosses, banded,
  to faceted bulbs; the HALO is a studded band with an inner lip; the
  VISOR is a thick lens with hinges at the temples and a glass slit; the
  CROWN's points are faceted and studded; HORNS and ANTLERS are bound at
  the root; the TAIL is banded with a blade tip; the WINGS hang from a
  mount on hinges; the pads are riveted; the CUFFS are a riveted bracer;
  the KNUCKLES a duster with collared spikes; the GAUNTLETS a bevelled
  plate; the CLAWS grow from a mount bar. A piece is MERGED after its
  paint atlas is laid — one mesh per finish, 2–3 draw calls and one paint
  canvas per piece where the spiked pads were thirty — and extruded parts
  are split by facing in the atlas so both faces of a fin or blade paint
  (the wings' never could).
- **GEAR, POLISHED — and SPIKED PADS** (`avatar/gear.ts`). New on the
  BODY shelf: **SPIKED PADS** ($220) — layered shoulder plate, a size up
  from the pauldrons, three spikes a side driven up through each cap from
  trim collars. The PAULDRONS share their build (`shoulderPad`): a domed
  cap, a lame overlapping from under it and a trim rim on each edge,
  SEATED on the shoulder's slope instead of standing clear of it as a
  pair of shells. The CHESTPLATE is framed in trim with a raised ridge down
  the sternum, so it reads against the body; the BELT is a band shaped to
  the waist pinch with rolled edges and a buckle, not a hoop; the WINGS
  are tapered blades, not slats; the GAUNTLETS' cuff hugs the wrist; the
  CROWN's band is a band, not a wire. `npm run gear:gallery` renders every
  piece worn, front and back, on one sheet.
- **PAINT P8 — gear as decals, and a rounder head** (docs/paint.md §4,
  P8; `avatar/gearAtlas.ts`). Every piece of gear lays out its own paint
  atlas when it is built — each mesh and each face a patch sized by its
  real area, with the surface point under every texel mapped — and a mark
  on gear is a 3D decal placed where you aimed: each PAULDRON paints on
  its own, a stripe runs across crest plates instead of stamping itself on
  all eleven, and the CHESTPLATE can be painted at all (it had no UVs).
  Old gear paint keeps its old look until it's lifted. The head is nearly
  round (it was an egg, 0.84 × 1.08 × 0.93 of its radius; now
  0.94 × 1.0 × 0.97) and the head gear is refitted onto it.
- **THE SHOULDERS, SQUARED** (`solveTorso`, avatar/boxer.ts): the body
  now follows a LOOK and ignores a GLANCE by time — a look held 0.4 s
  (or a swing past 34°) turns the shoulders all the way round, to within
  2°. It used to sit inside a 37° dead zone drifting over four seconds and
  stop 8° short, and a boxing guard pulled it 20° off the head for as
  long as you held it; the hands now pull by where they are, not by the
  skewed line between them.

## Run it

```bash
npm install
npm run dev        # client on https://localhost:5173 (desktop WebXR emulator included)
npm run server     # optional: the 1v1 relay on :8787
npm run server:pub # optional: the club room server on :8788
```

On a Quest, open the dev URL in the headset browser. On desktop, the IWSDK
dev plugin provides a WebXR emulator (WASD + mouse).

## Deploying

The live site is **https://ff2.web.app**, published by GitHub Actions
(`.github/workflows/firebase-deploy.yml`). A push to `main` goes live; a pull
request gets a temporary preview channel so a change can be walked around in a
headset before it is merged.

A **GitHub Pages** mirror still builds from `.github/workflows/deploy.yml`
(https://yellkell.github.io/ff2/).

Pages serves the game from a **subpath** (`/ff2/`), not a domain root, so
every reference to a file in `public/` must be written **relatively**
(`signs/fire-fight.png`, never `/signs/fire-fight.png`). Vite rewrites
references inside its HTML inputs, but *not* string literals in TypeScript
and *not* files copied verbatim out of `public/` — both have already
shipped this bug once. `npm run build && npm run check:pages` serves the
build under `/ff2/` in a real browser and fails on any 404; the deploy
workflow runs a fast static version of the same guard.

### The room server

Three relays, one process, one host: `server/room.mjs` mounts the duel relay at
`/ff`, the Iron Balls pub at `/pub` and the rave's room relay at `/rave`. The
client resolves all three off one `ROOM_SERVER` constant (`src/config.ts`).

On a free plan that consolidation matters more than tidiness — a sleeping
service takes the best part of a minute to wake, and one service means everyone
arriving anywhere in the town wakes the same one.

`render.yaml` is a Blueprint: **Render → New → Blueprint → this repo** creates
the service and prompts for the secrets. Setting one up by hand instead, the
four things that matter are:

| Setting | Value |
| --- | --- |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/` |

`server/` is self-contained — node built-ins, `ws`, and its own files — so
Render never builds the client to run the relay.

**Voice needs no configuration.** The pub's voice is Int16 PCM over the same
socket as the poses, panned client-side — no SFU, no keys. (An earlier build
brokered it through a LiveKit SFU and the server minted join tokens; the code
stopped using it, and three secrets went on being carried in the deploy
environment for a route nothing called.)

Both remaining env vars are optional: `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID`
light up the bar TV, and `ADMIN_TOKEN` arms the ban panel — without it the ban
controls are inert, which is deliberate, so a random punter can't wield them.

You can tell by eye which build a host is running — the room server answers `/`
with `{"room":"fire-fight-2","relays":[…]}`, where a single old relay answers
with its own name.

> If the host's name changes, `ROOM_SERVER` in `src/config.ts` has to change
> with it. It is one constant, and it is the only place the hostname appears.

### The Firebase project

Everything server-side — boards, matchmaking, presence, the gazette — lives in
**one Firestore**, the project behind ff2.web.app, shared by FIRE FIGHT 2, RAVE
RAID and the club.

It did not use to. FF2 talked to `arfi-b68f9`, inherited from the ARFI era and
also **FIRE FIGHT 1's live hosting** — which is why this workflow sat parked on
manual dispatch, since an automatic deploy from this repo would have
overwritten the live FF1 site. RAVE RAID kept its world board in a project of
its own, and the pub's arcade board was a single document wedged into FF2's.
One player had three identities and a board in one game could not see a name
from another.

> The project id reads `flappy-ff9f6`, which is where the `ff2` hosting site
> was reserved. A `.web.app` name is globally unique, so prising it loose to
> rename the project would mean releasing `ff2` into the pool where anyone
> could take it. The id is invisible to players — treat it as **the FF2
> project**.

Two pieces of setup are not in this repo, because they cannot be:

- **Anonymous sign-in must be ON** (Authentication → Sign-in method →
  Anonymous). Every security rule identifies a row by its document name
  matching `request.auth.uid`, so with it off there is no uid, and every write
  in the game is denied — boards go quiet and matchmaking never pairs.
- **Nothing else.** There WAS a second item here — a Firestore TTL policy on
  `expiresAt` for `rooms` and `presence` — and it turned out not to be needed.
  TTL requires the Blaze plan, and more to the point it was never load
  bearing: both collections are queried with `where('expiresAt', '>', now)`,
  so an expired record is filtered out SERVER-SIDE. It is never returned,
  never shown, and never costs a read, which means a ghost cannot crowd a live
  room out of a `limit()`ed scan — the failure the field exists to prevent.

  Removing the records is housekeeping on top of that, and the clients do it:
  `net/presence.ts` sweeps a handful of lapsed records once per session, and
  the rules let any signed-in player bin one that has already expired. That is
  the same arrangement the duel lobbies have always had, where
  `webrtcTransport` reaps the ghosts it scans past.

  Turn TTL on if you move to Blaze for other reasons — the field is the right
  type for it (a timestamp; a policy aimed at a number sweeps nothing and says
  nothing about it) — but it buys tidiness, not correctness.

Rules and indexes DO live here and ship with the repo:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

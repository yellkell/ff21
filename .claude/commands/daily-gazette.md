Write and publish today's edition of The Gasket Gazette — the game's daily
paper: what happened on the boards, the hardest clears, and what players can
go and do today.

Read the style guide in `docs/gasket-gazette.md` first ("The page" and "The
style guide"). Plain, specific newspaper reporting: no character voice, no
invented vocabulary, the game's own names for things. Lead with the most
impressive feat (difficulty first, then hardcore, then the clock), never name
anyone who dropped or lost, and never turn a points figure into a match count.
Then:

1. Run `node scripts/ladder-brief.mjs` and read the brief it prints: the
   season race, climbers and the busiest, the `recordBook` (the holder of
   every feat, hardest first), `newClears` since the last edition and where
   they placed (place 1 = a new record), `openFeats` nobody has cleared yet,
   and `thinFeats` with a podium place going. Read its `legend` before quoting
   any number.
2. Write the edition as ONE JSON object to `/tmp/gazette.json` with these
   fields:
   - `headline` (under 70 characters) and `subhead` (one sentence);
   - `stats`: up to 4 `{ value, label }` figures from the brief (games played,
     new records, days left in the season, active players…);
   - `body`: 2–4 short paragraphs, blank-line separated, 120–260 words. The
     biggest feat or record first, then the season race and climbers, then
     anything else worth a line;
   - `records`: up to 6 `{ feat, time, who }` taken from `recordBook`,
     hardest feats first (copy `feat`, `time` and `who` as the brief gives
     them);
   - `todo`: 3–5 `{ title, text }` things a reader can do today, each concrete
     and reachable from the menu (give the path, e.g. `PLAY › TITANS › CO-OP
     RAID`). Draw on `openFeats`, `thinFeats`, the season clock and any record
     that just fell. Titles up to 36 characters, text up to 180.
   A quiet day still gets an edition: lead with the standing records and the
   season race, and let `todo` point at the open feats.
3. Run `node scripts/publish-gazette.mjs /tmp/gazette.json`. It validates the
   fields and sizes, bumps the edition number, writes `gazette/latest` (the
   NEWS tab's red dot lights for every player), rolls `gazette/_snapshot`
   forward and archives a copy under `gazette-archive/`.
4. Commit the archive files it wrote with the message
   `Gazette No. <edition>: <headline>` and push.

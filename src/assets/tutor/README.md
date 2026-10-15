# EMBER's voice clips

One mp3 per line, named `<line-id>.mp3` (`e010.mp3` …) — the ids live in
`src/tutorial/script.ts` and the full recording script (read direction,
triggers, delivery spec) is `docs/tutorial-ember.md`. Extra takes of a line
share the id with a `_N` suffix (`e100_2.mp3`); `tutorVoice` picks a take at
random per play — the praise pool ships two takes each.

These mp3s are transcoded from the VA's WAV masters (the `Voice Lines/`
folder on the delivery branch) by the session's transcode script: downmixed
to mono (Ember is a point source behind an HRTF panner), silence-trimmed at
~-48 dBFS with a 0.15 s pad (dead air would drag every line's timing, but a
harsher -40 dBFS cut clipped the soft onset of quiet takes like e010 "Over
here."), and encoded at 96 kbps.

`src/audio/tutorVoice.ts` globs `*.mp3` here and decodes on demand (warmed at
enter-VR for anyone who hasn't finished the tutorial). Any line without a
clip plays silently with its caption — the tutorial stays fully playable.

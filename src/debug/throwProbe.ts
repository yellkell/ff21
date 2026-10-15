/**
 * The last curveball's raw numbers, for the ?perf=1 readout.
 *
 * CURL is tuned against what a punch MEASURES — the swing's turn rate and the
 * hand's speed — and those are the one part of the mapping that can't be
 * checked off a headset. This carries them out to the HUD so the band can be
 * set from what your punches actually read instead of from an assumption
 * about what a hook looks like.
 *
 * Three number assignments per throw; not worth gating behind the flag.
 */
export const throwProbe = {
  /** Swing turn rate at release (rad/s) — the input to curlRateFor. */
  raw: 0,
  /** Hand speed at release (m/s) — the other input, and the throw's power. */
  handSpeed: 0,
  /** What those earned: the ball's bank rate (rad/s). 0 = a straight throw. */
  curl: 0,
  /** Seconds-since-boot stamp, so the HUD can fade a stale reading. */
  at: -1,
};

export function recordThrow(raw: number, handSpeed: number, curl: number, at: number): void {
  throwProbe.raw = raw;
  throwProbe.handSpeed = handSpeed;
  throwProbe.curl = curl;
  throwProbe.at = at;
}

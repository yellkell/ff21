/**
 * THE TITAN, READABLE — a one-line window onto the campaign bout for the
 * things that watch it from outside CampaignSystem: THE CHANNEL's frame
 * builder (systems/BroadcastSystem.ts draws the titan on the TV from
 * this) and THE TAPE (net/telemetry.ts stamps the boss on the bout doc).
 *
 * CampaignSystem writes it every frame while a bout runs and clears it
 * on teardown; nobody else writes it. Positions are the arena's local
 * world space (the local player's platform at the origin).
 */

export const titanView = {
  /** A campaign bout is standing (intro, fight, death, resurrection). */
  active: false,
  /** The titan's name plate ('RUSTHOOK' … 'GOLIATH', 'GOOPLIATH'). */
  name: '',
  /** Live health fraction, 0..1. */
  hp: 1,
  /** CampaignSystem's phase word: idle · intro · fight · victory · defeat · resurrect. */
  phase: 'idle',
  /** Which titan of the run (0-based). */
  stage: 0,
  /** Where the titan stands, for the TV's top-down. */
  x: 0,
  y: 0,
  z: -6,
  /** How the bout resolved, once it has: '' while it runs. */
  outcome: '' as '' | 'victory' | 'defeat',
};

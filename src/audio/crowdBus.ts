/**
 * The crowd's cue sheet — a one-way queue from the sound kit (audio/sfx.ts
 * pushes as landings ring and rounds end) to the crowd bed (audio/crowd.ts
 * drains it each frame). A separate module so neither imports the other.
 */

export type CrowdCue = 'hit' | 'core' | 'round' | 'win' | 'lose';

export const crowdBus: { pending: CrowdCue[] } = { pending: [] };

export function cueCrowd(kind: CrowdCue): void {
  if (crowdBus.pending.length < 16) crowdBus.pending.push(kind);
}

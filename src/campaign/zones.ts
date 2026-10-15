/**
 * A campaign kill zone, TARGET-local (the target's platform at the origin,
 * −z toward the titan). Shared by CampaignSystem (which builds, telegraphs
 * and judges them) and campaign/delivery.ts (which throws the blow at them).
 */

export type Zone =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'beam'; x: number; z: number; dx: number; dz: number; halfW: number }
  | { kind: 'sweep'; y: number }
  /** One volley shot: launches from the pod on `side` when its stagger hits. */
  | { kind: 'shot'; side: -1 | 1 }
  /** GOLIATH's nova: everything burns EXCEPT the safe wedge at `angle`. */
  | { kind: 'nova'; angle: number; halfAngle: number }
  /** The seesaw / surge flood: the platform half on `side`'s sign of the
   *  `axis` (0 = local x, left/right seesaw; 1 = local z, front/back surge)
   *  burns — be across the centreline when it lands. */
  | { kind: 'half'; side: -1 | 1; axis: 0 | 1 }
  /** THE ENCORE's grammar zones (campaign/grammar.ts): lanes, rails, the
   *  gate, the donut's ring and the recital's quarters — all target-local.
   *  (The grammar's height-less sweep maps onto the classic sweep above.) */
  | { kind: 'lane'; x: number; halfW: number; yaw?: number }
  | { kind: 'rail'; z: number; halfD: number; from: 1 | -1 }
  | { kind: 'gate'; at: number; half: number; axis: 0 | 1 }
  | { kind: 'ring'; innerR: number }
  | { kind: 'quad'; corner: number; step: number; hold: boolean; pattern: readonly number[]; holds: readonly boolean[] };

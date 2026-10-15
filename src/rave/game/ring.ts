/**
 * Ring seat math — the "me at the origin" trick, generalised to a full
 * circle of up to 24 platforms.
 *
 * CANONICAL frame: the GOOPLIATH's stage centre is the origin; seat i stands
 * at bearing φᵢ = i·2π/N on a circle of radius R, yawed to face the centre
 * (yaw θ turns the default −Z forward into (−sinθ, 0, −cosθ), so a seat at
 * (R sinφ, 0, R cosφ) faces the middle with yaw = φ).
 *
 * LOCAL frame (what each client renders): that seat at the world origin
 * facing −Z. Because every seat faces the centre at the same radius, the
 * stage lands at (0, 0, −R) in EVERY dancer's local frame — the boss, the
 * choreography and your own platform's zones never need a transform. Only
 * the OTHER dancers' platforms (and their net poses) go through here.
 */

import { Quaternion, Vector3 } from 'three';
import { RING, ringRadius } from '../config.js';

const _q = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** Rotate (x,z) by `yaw` about +Y into out (y passes through). */
export function rotY(out: Vector3, x: number, y: number, z: number, yaw: number): Vector3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return out.set(x * c + z * s, y, -x * s + z * c);
}

/** Canonical bearing of seat i in an N-ring. */
export function seatBearing(seat: number, seats: number): number {
  return (seat / seats) * Math.PI * 2;
}

/**
 * Seat j's platform centre + yaw in MY local frame (me = seat `mySeat`).
 * My own seat comes back as the origin with yaw 0, by construction.
 */
export function seatLocal(
  mySeat: number,
  seat: number,
  seats: number,
  out: Vector3,
): { yaw: number } {
  const R = ringRadius(seats);
  const phiMe = seatBearing(mySeat, seats);
  const phi = seatBearing(seat, seats);
  // Canonical: seat at (R sinφ, 0, R cosφ). My local = R_y(−φ_me)·(p − p_me).
  const dx = R * Math.sin(phi) - R * Math.sin(phiMe);
  const dz = R * Math.cos(phi) - R * Math.cos(phiMe);
  rotY(out, dx, 0, dz, -phiMe);
  return { yaw: phi - phiMe };
}

/** The stage centre in my local frame: always (0, 0, −R). */
export function stageLocal(seats: number, out: Vector3): Vector3 {
  return out.set(0, 0, -ringRadius(seats));
}

const _near = new Vector3();

/**
 * Is seat `seat` close enough to me to be worth the full show?
 *
 * Platforms do not move, so how far away a deck stands is a property of
 * the RING, not of the frame — one distance test, whenever the ring is
 * dealt. Every system that spends detail by distance asks THIS question,
 * so a deck never half-dresses: the same seats that keep their dancer's
 * jewellery keep their deck's blockfall and their strike's sparks.
 */
export function seatIsNear(mySeat: number, seat: number, seats: number): boolean {
  seatLocal(mySeat, seat, seats, _near);
  return _near.length() <= RING.detailRadius;
}

/**
 * A peer at seat `peerSeat` sent a point in THEIR local frame (their platform
 * at their origin, facing the stage); express it in MY world.
 */
export function peerPointToMyWorld(
  out: Vector3,
  mySeat: number,
  peerSeat: number,
  seats: number,
  x: number,
  y: number,
  z: number,
): Vector3 {
  const dYaw = seatBearing(peerSeat, seats) - seatBearing(mySeat, seats);
  rotY(out, x, y, z, dYaw); // y passes through the yaw untouched
  seatLocal(mySeat, peerSeat, seats, _anchor);
  out.x += _anchor.x;
  out.z += _anchor.z;
  return out;
}
const _anchor = new Vector3();

/** A peer's orientation quaternion → my world (pre-rotate by Δyaw). */
export function peerQuatToMyWorld(
  out: Quaternion,
  mySeat: number,
  peerSeat: number,
  seats: number,
  x: number,
  y: number,
  z: number,
  w: number,
): Quaternion {
  out.set(x, y, z, w);
  _q.setFromAxisAngle(UP, seatBearing(peerSeat, seats) - seatBearing(mySeat, seats));
  return out.premultiply(_q);
}

/**
 * A canonical compass bearing (the nova's shared safe wedge) expressed in a
 * seat's local frame: local = canonical − φ_seat.
 */
export function bearingLocal(canonical: number, seat: number, seats: number): number {
  return canonical - seatBearing(seat, seats);
}

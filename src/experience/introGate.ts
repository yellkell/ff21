/**
 * "Is the boot intro still running?" — a one-flag module so the lobby can
 * hold still behind the curtain.
 *
 * The intro deliberately leaves the whole lobby LIVE behind its black shade
 * (that's what makes the final cut instant), which means the menu's hand
 * pointers keep sweeping the panels the player can't see — chirping the
 * hover zap through the entire sequence, and able to click things blind.
 * MenuSystem parks itself while this is true.
 *
 * Its own module (not an export of BootIntro) so the menu doesn't take a
 * dependency on the intro's three.js payload just to ask a boolean.
 */

let active = false;

export function setBootIntroActive(value: boolean): void {
  active = value;
}

/** True from the first frame of the intro until the curtain drops. */
export function bootIntroActive(): boolean {
  return active;
}

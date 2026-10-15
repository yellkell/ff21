/**
 * Customisation state: which avatar/platform skin you wear, persisted in
 * localStorage. `version` bumps on every change so systems (mirror, gloves,
 * torso, platform) can cheaply notice and re-apply. `open` = the lobby
 * customisation panel + avatar mirror are showing.
 */

import {
  type AvatarSkin,
  avatarSkin,
  type DeckShelf,
  FREE_AVATARS,
  FREE_PLATFORMS,
  platformSkin,
  resolveAvatarSkin,
} from '../avatar/skins.js';
import { cleanGear, gearDef, type GearSlot, packGear } from '../avatar/gear.js';
import type { BlankTone } from '../avatar/mannequin.js';

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* session-only */
  }
}

function loadHue(): number {
  const n = parseFloat(load('ff-skin-color', ''));
  return Number.isFinite(n) ? n : -1;
}

function loadLight(): number {
  const n = parseFloat(load('ff-skin-light', ''));
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/** Platform skins the player has unlocked: the free trio plus anything bought
 *  in the shop ('ff-owned-platforms', a JSON id array). */
function loadOwnedPlatforms(): Set<string> {
  const owned = new Set(FREE_PLATFORMS);
  try {
    const raw = localStorage.getItem('ff-owned-platforms');
    if (raw) for (const id of JSON.parse(raw) as string[]) owned.add(id);
  } catch {
    /* fresh wallet — just the free trio */
  }
  return owned;
}

const ownedPlatforms = loadOwnedPlatforms();

/** THE CLOUD LOCKER (net/walletSync.ts) listens here: every purchase is
 *  announced, so the profile's copy of what you own keeps up. */
type OwnedListener = () => void;
const ownedListeners: OwnedListener[] = [];
export function onOwnedChange(cb: OwnedListener): void {
  ownedListeners.push(cb);
}
function announceOwned(): void {
  for (const cb of ownedListeners) cb();
}

function saveOwnedPlatforms(): void {
  try {
    localStorage.setItem(
      'ff-owned-platforms',
      JSON.stringify([...ownedPlatforms].filter((p) => !FREE_PLATFORMS.includes(p))),
    );
  } catch {
    /* session-only ownership */
  }
}

/** Has the player unlocked this platform skin (free or purchased)? */
export function platformOwned(id: string): boolean {
  return ownedPlatforms.has(id);
}

/** Record a shop purchase: mark the platform owned and persist it. The coin
 *  debit is the caller's job (see wallet.spendCoins). */
export function ownPlatform(id: string): void {
  if (ownedPlatforms.has(id)) return;
  ownedPlatforms.add(id);
  saveOwnedPlatforms();
  announceOwned();
}

/** Avatar skins the player has unlocked: the free set plus shop buys
 *  ('ff-owned-avatars', a JSON id array). */
function loadOwnedAvatars(): Set<string> {
  const owned = new Set(FREE_AVATARS);
  try {
    const raw = localStorage.getItem('ff-owned-avatars');
    if (raw) for (const id of JSON.parse(raw) as string[]) owned.add(id);
  } catch {
    /* fresh wallet — just the free set */
  }
  return owned;
}

const ownedAvatars = loadOwnedAvatars();

function saveOwnedAvatars(): void {
  try {
    localStorage.setItem(
      'ff-owned-avatars',
      JSON.stringify([...ownedAvatars].filter((a) => !FREE_AVATARS.includes(a))),
    );
  } catch {
    /* session-only ownership */
  }
}

/** Has the player unlocked this avatar skin (free or purchased)? */
export function avatarOwned(id: string): boolean {
  return ownedAvatars.has(id);
}

/** Record an avatar purchase: mark it owned and persist it. The coin debit is
 *  the caller's job (see wallet.spendCoins). */
export function ownAvatar(id: string): void {
  if (ownedAvatars.has(id)) return;
  ownedAvatars.add(id);
  saveOwnedAvatars();
  announceOwned();
}

/** GEAR the player has bought ('ff-owned-gear', a JSON id array). Nothing
 *  is owned from the start — the blank is born bare. */
function loadOwnedGear(): Set<string> {
  const owned = new Set<string>();
  try {
    const raw = localStorage.getItem('ff-owned-gear');
    if (raw) for (const id of JSON.parse(raw) as string[]) if (gearDef(id)) owned.add(id);
  } catch {
    /* fresh locker — bare */
  }
  return owned;
}

const ownedGear = loadOwnedGear();

/** Has the player bought this piece of gear? */
export function gearOwned(id: string): boolean {
  return ownedGear.has(id);
}

function saveOwnedGear(): void {
  try {
    localStorage.setItem('ff-owned-gear', JSON.stringify([...ownedGear]));
  } catch {
    /* session-only ownership */
  }
}

/** Record a gear purchase (the coin debit is the caller's job). */
export function ownGear(id: string): void {
  if (!gearDef(id) || ownedGear.has(id)) return;
  ownedGear.add(id);
  saveOwnedGear();
  announceOwned();
}

/** What the player owns beyond the free issue — the cloud locker's shape. */
export function ownedIds(): { platforms: string[]; gear: string[]; avatars: string[] } {
  return {
    platforms: [...ownedPlatforms].filter((p) => !FREE_PLATFORMS.includes(p)).sort(),
    gear: [...ownedGear].sort(),
    avatars: [...ownedAvatars].filter((a) => !FREE_AVATARS.includes(a)).sort(),
  };
}

/** Take the cloud locker's union in (net/walletSync.ts): anything the
 *  profile says is owned becomes owned here, silently — it came FROM the
 *  cloud, so nothing pushes back. Unknown ids (a retired piece) are dropped. */
export function adoptOwned(owned: { platforms: string[]; gear: string[]; avatars: string[] }): void {
  let changed = false;
  for (const id of owned.platforms) {
    if (platformSkin(id).id === id && !ownedPlatforms.has(id)) {
      ownedPlatforms.add(id);
      changed = true;
    }
  }
  for (const id of owned.gear) {
    if (gearDef(id) && !ownedGear.has(id)) {
      ownedGear.add(id);
      changed = true;
    }
  }
  for (const id of owned.avatars) {
    if (avatarSkin(id).id === id && !ownedAvatars.has(id)) {
      ownedAvatars.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  saveOwnedPlatforms();
  saveOwnedGear();
  saveOwnedAvatars();
  customization.version += 1;
}

/** The worn set ('ff-gear', the packed wire form) — anything not owned any
 *  more (or unknown) simply falls off. */
function loadGear(): string[] {
  return cleanGear(load('ff-gear', '')).filter((id) => ownedGear.has(id));
}

/** The saved equipped avatar, or the panther if the saved one isn't owned. */
function loadEquippedAvatar(): string {
  // Born blank: FF2's factory body is the default; a saved FF1 pick stays.
  const id = avatarSkin(load('ff-skin-avatar', 'blank')).id;
  return ownedAvatars.has(id) ? id : 'blank';
}

export const customization = {
  avatar: loadEquippedAvatar(),
  platform: platformSkin(load('ff-skin-platform', 'ember')).id,
  /** Custom armour hue (0..1) from the colour picker, or -1 to keep the
   *  avatar's own default palette. */
  colorHue: loadHue(),
  /** Custom armour lightness (0..1, 0.5 = neutral) — darkens/brightens the
   *  recoloured suit. Ignored while colorHue is -1 (default palette). */
  colorLight: loadLight(),
  /** Bumped on every change — consumers re-apply when they see it move. */
  version: 1,
  /** The customisation panel (and the avatar mirror) is up in the lobby. */
  open: false,
  /** The STORE face is up (a sub-modal of the locker); false = the LOCKER. */
  shopOpen: false,
  /** Which tab the shop / locker shows. 'colour' and 'arena' are
   *  locker-only; 'paint' (the racks) and 'bank' (iron-dollars for money)
   *  are the store's alone. */
  tab: 'platforms' as 'avatars' | 'platforms' | 'gear' | 'colour' | 'arena' | 'paint' | 'bank',
  /** Which SHELF of the PLATFORMS board is out (avatar/skins.ts
   *  DECK_SHELVES) — the woods, the stones, the forge, the honours. */
  platformShelf: 'timber' as DeckShelf,
  /** Which of the GEAR board's shelves is out — heads, headgear,
   *  shoulders, body or hands. Fifteen pieces on one board crushed the
   *  tiles until the prices fell off them; a shelf holds six at full size. */
  gearSlot: 'face' as GearSlot,
  /** STORE try-on: the unowned skin the mirror (avatar) or your pad (platform)
   *  is modelling right now; its tile grows a BUY button. Nothing is owned or
   *  equipped until the buy — cleared on purchase and when the store closes. */
  preview: null as { kind: 'avatar' | 'platform' | 'gear'; id: string } | null,
  /** GEAR worn right now — at most one id per slot, slot-ordered
   *  (avatar/gear.ts). Rides every cosmetics channel packed. */
  gear: loadGear(),
};

/** Try an unowned skin on: the mirror models an avatar, your own pad a platform. */
export function setShopPreview(kind: 'avatar' | 'platform' | 'gear', id: string): void {
  if (customization.preview?.kind === kind && customization.preview.id === id) return;
  customization.preview = { kind, id };
  customization.version += 1;
}

/** Put the try-on back on the rack (bought it, or walked away). */
export function clearShopPreview(): void {
  if (!customization.preview) return;
  customization.preview = null;
  customization.version += 1;
}

/** Set the custom armour hue (0..1), or -1 to revert to the skin's default. */
export function setAvatarColor(hue: number): void {
  const h = hue < 0 ? -1 : ((hue % 1) + 1) % 1;
  if (h === customization.colorHue) return;
  customization.colorHue = h;
  save('ff-skin-color', String(h));
  customization.version += 1;
}

/** Set the custom armour lightness (0..1, 0.5 = neutral). */
export function setAvatarLight(light: number): void {
  const l = Math.min(1, Math.max(0, light));
  if (l === customization.colorLight) return;
  customization.colorLight = l;
  save('ff-skin-light', String(l));
  customization.version += 1;
}

/** The fully-resolved skin the LOCAL player wears: chosen shape + custom colour. */
export function myAvatarSkin(): AvatarSkin {
  return resolveAvatarSkin(customization.avatar, customization.colorHue, customization.colorLight);
}

export function setAvatarSkin(id: string): void {
  if (!avatarOwned(id)) return; // only equip skins you actually own
  const skin = avatarSkin(id);
  if (skin.id === customization.avatar) return;
  customization.avatar = skin.id;
  save('ff-skin-avatar', skin.id);
  customization.version += 1;
}

/** The body's base tone as the mannequin names it — what gear is primed in. */
export function myTone(): BlankTone {
  return customization.avatar === 'onyx' ? 'onyx' : 'white';
}

/** The gear worn, slot-ordered (a copy). */
export function myGear(): string[] {
  return [...customization.gear];
}

/** The worn set in its wire form ('' = bare). */
export function myPackedGear(): string {
  return packGear(customization.gear);
}

/** What's worn in a slot ('' = nothing). */
export function gearInSlot(slot: GearSlot): string {
  return customization.gear.find((id) => gearDef(id)?.slot === slot) ?? '';
}

/** The worn set with one slot swapped — what a try-on shows (nothing is
 *  equipped until the buy). */
export function gearWith(id: string): string[] {
  const d = gearDef(id);
  if (!d) return [...customization.gear];
  return cleanGear([id, ...customization.gear.filter((g) => gearDef(g)?.slot !== d.slot)]);
}

/** Wear a piece you own in its slot (replacing whatever's there); '' bares
 *  the slot. Bumps the version so every rig that's YOURS redresses. */
export function setGear(slot: GearSlot, id: string): void {
  if (id && (!gearDef(id) || gearDef(id)!.slot !== slot || !ownedGear.has(id))) return;
  const rest = customization.gear.filter((g) => gearDef(g)?.slot !== slot);
  const next = cleanGear(id ? [id, ...rest] : rest);
  if (next.join(',') === customization.gear.join(',')) return;
  customization.gear = next;
  save('ff-gear', packGear(next));
  customization.version += 1;
}

/** A locker tap: wear it, or take it off if it's already on. */
export function toggleGear(id: string): void {
  const d = gearDef(id);
  if (!d) return;
  setGear(d.slot, customization.gear.includes(id) ? '' : id);
}

export function setPlatformSkin(id: string): void {
  // Only equip skins you actually own (free trio + shop unlocks).
  if (!platformOwned(id)) return;
  const skin = platformSkin(id);
  if (skin.id === customization.platform) return;
  customization.platform = skin.id;
  save('ff-skin-platform', skin.id);
  customization.version += 1;
}

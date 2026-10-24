/**
 * THE ARCADE LOBBY's invite: the join link a room code makes, and SHARE's
 * state. The lobby itself — the room browser and the squad room — is a page
 * of THE BOARD now (menu/roomPage.ts, back from the Meta Quest build); this
 * is what it and MenuSystem's SHARE ON DISCORD still share.
 */

/** SHARE's state, for the button's label: MenuSystem drives it. */
export const inviteShare = { code: '', state: '' as '' | 'sending' | 'posted' | 'failed', reason: '' };

/** THE JOIN LINK for a room code (DESIGN §8.1): this page's own address
 *  with ?join=CODE — the same scheme the bot posts. */
export function inviteLink(code: string): string {
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
  return `${base}?join=${code}`;
}

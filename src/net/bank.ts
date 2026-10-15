/**
 * THE BANK — iron-dollars for real money.
 *
 * The wallet (menu/wallet.ts) is earned coin, kept on the headset. This is
 * the one door through which coin ENTERS it from outside, and every step
 * of that is somebody else's word, never the client's:
 *
 *   1. The headset asks THE ROOM SERVER's /bank (server/bank.mjs) for a
 *      CHECKOUT, signed with its Firebase ID token so the server knows
 *      which uid is buying. The server opens a Stripe Checkout session
 *      and hands back its URL — and a SHORT link to it, because a Stripe
 *      URL is four hundred characters and a QR code the panel can draw
 *      holds two hundred.
 *   2. The panel shows the short link as a QR. You pay on your phone (or
 *      OPEN ON THIS DEVICE, for a flat-screen session). Stripe takes the
 *      card; this code never sees a digit of it.
 *   3. Stripe tells the server it was paid (a signed webhook). The server
 *      writes the coins into the LEDGER — `bank/{uid}` in Firestore, a
 *      collection no client can write — keyed on the session so a
 *      replayed webhook credits nothing twice.
 *   4. The headset CLAIMS: "what am I owed?" The server hands over what is
 *      credited and not yet claimed, marks it claimed in the same
 *      transaction, and the coins land in the wallet here. Claiming runs
 *      at every boot and every few seconds while a checkout is open, so
 *      a purchase made while the headset was off arrives the next time it
 *      wakes, and one made on the phone lands in the panel within a
 *      breath.
 *
 * The packs and their prices are the SERVER's; the copy here is only what
 * the panel draws before the server has answered, and is replaced by the
 * server's list the moment it does. FAILS SOFT like the rest of the cloud:
 * no server, no connection, no sign-in — the board says so, and nothing
 * else in the game is touched.
 */

import { roomServerHost } from '../config.js';
import { addCoins } from '../menu/wallet.js';
import { playCash } from '../audio/cash.js';
import { cloud, currentIdToken } from './firebase.js';
import { markWalletAdopt } from './walletSync.js';

export interface CoinPack {
  id: string;
  /** Iron-dollars delivered — and the pack's whole name. */
  coins: number;
  /** Price in the currency's minor unit (cents, pence). */
  minor: number;
  /** The pack the shelf points at. */
  best?: boolean;
}

export type BankMode = 'live' | 'test' | 'dev' | '';

export interface Checkout {
  /** The session id (Stripe's, or a dev stand-in). */
  id: string;
  /** The full checkout URL — what OPEN ON THIS DEVICE opens. */
  url: string;
  /** The short link the QR carries. */
  short: string;
  pack: CoinPack;
  /** performance.now() when it opened. */
  at: number;
  state: 'opening' | 'waiting' | 'paid' | 'failed' | 'expired';
  /** Coins that landed when it paid. */
  paid: number;
  /** One line for the board when something went wrong. */
  note: string;
}

/** What the board draws until the server's own list arrives. Keep in step
 *  with server/bank.mjs PACKS — the server's is the one that charges. */
export const FALLBACK_PACKS: CoinPack[] = [
  { id: 'pocket', coins: 500, minor: 199 },
  { id: 'purse', coins: 1300, minor: 449 },
  { id: 'strongbox', coins: 3000, minor: 899, best: true },
  { id: 'vault', coins: 7000, minor: 1799 },
];

/**
 * THE ACCOUNT. Nobody signs in to play: a headset IS its anonymous uid.
 * A buyer can PROTECT that uid with the email they paid with — the server
 * attaches it (the uid never changes, nothing moves) — and later RECOVER
 * it on another headset: Firebase emails a sign-in link, the phone that
 * opens it (recover.html) shows a six-digit code, and typing that code
 * here signs this headset in as the same uid and restarts the game as it.
 */
export interface Account {
  /** Has the server told us yet? */
  known: boolean;
  protected: boolean;
  /** Masked: a***@example.com. */
  email: string;
}

export type RecoveryStage = 'idle' | 'sending' | 'sent' | 'redeeming' | 'done' | 'failed';

/** Live bank state, read by the STORE's BANK board each repaint. */
export const bank = {
  status: 'idle' as 'idle' | 'loading' | 'ready' | 'off',
  mode: '' as BankMode,
  currency: 'gbp',
  packs: FALLBACK_PACKS,
  checkout: null as Checkout | null,
  /** Why the bank is off, in words for the board. */
  note: '',
  account: { known: false, protected: false, email: '' } as Account,
  /** The email typed at the last paid checkout — what PROTECT pre-fills. */
  lastEmail: '',
  protecting: { stage: 'idle' as 'idle' | 'busy' | 'done' | 'failed', note: '' },
  recovery: { stage: 'idle' as RecoveryStage, email: '', note: '' },
  /** Bumped on every change — MenuSystem's live list watches it. */
  version: 0,
};

const bump = (): void => {
  bank.version += 1;
};

/** How long a checkout stays on the board before it is called expired.
 *  Stripe sessions live at least half an hour; this is a touch under. */
const CHECKOUT_TTL_MS = 25 * 60 * 1000;
const POLL_MS = 3000;
const FETCH_TIMEOUT_MS = 12_000;

/** THE ROOM SERVER's /bank over HTTP, wherever the room server is. */
export function bankHttp(): string {
  return `${roomServerHost().replace(/^ws/, 'http')}/bank`;
}

const SYMBOL: Record<string, string> = { usd: '$', gbp: '£', eur: '€', cad: 'CA$', aud: 'A$', nzd: 'NZ$', jpy: '¥' };

/** "£4.49" — the pack's price in words the panel can set. */
export function priceLabel(minor: number, currency = bank.currency): string {
  const cur = currency.toLowerCase();
  const sym = SYMBOL[cur] ?? `${cur.toUpperCase()} `;
  if (cur === 'jpy') return `${sym}${minor}`;
  return `${sym}${(minor / 100).toFixed(2)}`;
}

/** Is this a development serve (vite on a laptop, reached over plain http)? */
function isDevServe(): boolean {
  try {
    return location.protocol !== 'https:';
  } catch {
    return false;
  }
}

/** A stable stand-in uid for a headset with no cloud on a dev serve — the
 *  server accepts it only in its own dev mode, so nothing real hangs on it. */
function devUid(): string {
  const KEY = 'ff-bank-devuid';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'dev-anon';
  }
}

/** The headers that say who is asking — a Firebase ID token, or on a dev
 *  serve with no cloud, the dev stand-in. Null when there is no identity
 *  to offer (and the note says why). */
async function identity(): Promise<Record<string, string> | null> {
  const c = await cloud();
  if (c) {
    let token = currentIdToken();
    if (!token) token = await c.auth.currentUser?.getIdToken().catch(() => '') ?? '';
    if (token) return { authorization: `Bearer ${token}` };
  }
  if (isDevServe()) return { 'x-dev-uid': devUid() };
  bank.note = 'no connection — the bank needs the cloud';
  return null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${bankHttp()}${path}`, { ...init, signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface Catalogue {
  mode: BankMode;
  currency: string;
  packs: CoinPack[];
}

let loading: Promise<void> | null = null;

/** Fetch the server's packs, prices and mode. Once per session unless it
 *  failed; safe to call from every repaint that wants it. */
export function loadPacks(): Promise<void> {
  if (bank.status === 'ready') return Promise.resolve();
  if (loading) return loading;
  bank.status = 'loading';
  bump();
  loading = (async () => {
    try {
      const cat = await call<Catalogue>('/');
      if (!cat || !Array.isArray(cat.packs) || cat.packs.length === 0) throw new Error('no packs');
      bank.packs = cat.packs;
      bank.mode = cat.mode;
      bank.currency = cat.currency || 'gbp';
      bank.status = 'ready';
      bank.note = '';
    } catch (err) {
      bank.status = 'off';
      // The server says why it is closed (which secret is missing — never
      // the secret); a timeout or a dead host has no words to offer.
      const said = String((err as Error)?.message ?? '');
      bank.note = /abort/i.test(said) ? 'the bank is not answering' : /not open yet/.test(said) ? said.replace(/^the bank is not open yet — /, '') : 'the bank is closed right now';
    } finally {
      loading = null;
      bump();
    }
  })();
  return loading;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

interface CheckoutReply {
  id: string;
  url: string;
  short: string;
  pack: CoinPack;
}

/** Open a checkout for a pack: the board switches to the QR the moment
 *  this resolves (or says what went wrong). One at a time. */
export async function startCheckout(packId: string): Promise<void> {
  const pack = bank.packs.find((p) => p.id === packId);
  if (!pack) return;
  if (bank.checkout && (bank.checkout.state === 'opening' || bank.checkout.state === 'waiting')) return;
  const co: Checkout = { id: '', url: '', short: '', pack, at: performance.now(), state: 'opening', paid: 0, note: '' };
  bank.checkout = co;
  bump();
  const who = await identity();
  if (!who) {
    co.state = 'failed';
    co.note = bank.note;
    bump();
    return;
  }
  try {
    const reply = await call<CheckoutReply>('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...who },
      body: JSON.stringify({ pack: packId }),
    });
    if (!reply?.url) throw new Error('no checkout');
    co.id = reply.id;
    co.url = reply.url;
    co.short = reply.short || reply.url;
    co.pack = reply.pack ?? pack;
    co.state = 'waiting';
    stopPolling();
    pollTimer = setInterval(() => void poll(), POLL_MS);
  } catch (err) {
    co.state = 'failed';
    co.note = String((err as Error)?.message ?? err).slice(0, 80);
  }
  bump();
}

async function poll(): Promise<void> {
  const co = bank.checkout;
  if (!co || co.state !== 'waiting') {
    stopPolling();
    return;
  }
  if (performance.now() - co.at > CHECKOUT_TTL_MS) {
    co.state = 'expired';
    stopPolling();
    bump();
    return;
  }
  const got = await claimPurchases();
  if (got > 0) {
    co.state = 'paid';
    co.paid = got;
    stopPolling();
    bump();
  }
}

/** Walk away from the checkout (paid or not — a paid one is already in
 *  the wallet; an unpaid one can still be paid and will be claimed at
 *  the next boot). */
export function cancelCheckout(): void {
  stopPolling();
  bank.checkout = null;
  bump();
}

/** OPEN ON THIS DEVICE: a new tab on the checkout. In an immersive session
 *  the browser shows it when you take the headset off; on a flat screen it
 *  is just a tab. Returns false when the browser refused. */
export function openCheckout(): boolean {
  const co = bank.checkout;
  if (!co?.url) return false;
  try {
    return !!window.open(co.url, '_blank', 'noopener');
  } catch {
    return false;
  }
}

interface ClaimReply {
  coins: number;
  credit: number;
  claimed: number;
  /** The email typed at the last paid checkout (the player's own). */
  email?: string;
}

let claiming: Promise<number> | null = null;

/**
 * The id of the claim in flight, kept until its coins land. If the reply
 * is lost (the 12 s abort, a reload mid-claim) after the server has already
 * marked the coins claimed, the next claim sends the same id and the
 * server hands the same coins back instead of nothing. Per TAB
 * (sessionStorage, which a reload keeps): two tabs sharing one id would
 * each be handed the same coins.
 */
const CLAIM_KEY = 'ff-bank-claim';

function pendingClaimId(): string {
  try {
    let id = sessionStorage.getItem(CLAIM_KEY);
    if (!id) {
      id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(CLAIM_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

function settleClaimId(): void {
  try {
    sessionStorage.removeItem(CLAIM_KEY);
  } catch {
    /* nothing kept, nothing to clear */
  }
}

/**
 * Collect whatever the ledger says is owed and bank it. Idempotent on the
 * server; harmless to call often. Resolves to the coins that landed (0
 * when nothing was owed, or the bank could not be reached).
 */
export function claimPurchases(): Promise<number> {
  if (claiming) return claiming;
  claiming = (async () => {
    try {
      const who = await identity();
      if (!who) return 0;
      const claim = pendingClaimId();
      const reply = await call<ClaimReply>('/claim', { method: 'POST', headers: { 'content-type': 'application/json', ...who }, body: JSON.stringify({ claim }) });
      if (!reply) return 0; // no answer: keep the id, so a retry is the same claim
      const coins = Math.floor(reply.coins ?? 0);
      // Cleared in the same tick the coins are banked, so the next claim is a
      // fresh one and this one can't be paid twice.
      if (coins > 0) settleClaimId();
      if (reply?.email && reply.email !== bank.lastEmail) {
        bank.lastEmail = reply.email;
        bump();
      }
      if (coins > 0) {
        addCoins(coins);
        playCash();
        bump();
      }
      return coins;
    } catch {
      return 0;
    } finally {
      claiming = null;
    }
  })();
  return claiming;
}

/* ── the account ──────────────────────────────────────────────────────── */

interface WhoReply {
  uid: string;
  protected: boolean;
  email: string;
}

/** Ask the server whether this uid is protected, and with what. */
export async function whoami(): Promise<void> {
  const who = await identity();
  if (!who) return;
  try {
    const reply = await call<WhoReply>('/whoami', { headers: who });
    if (!reply) return;
    bank.account = { known: true, protected: !!reply.protected, email: reply.email ?? '' };
  } catch {
    /* the board shows the last known state */
  }
  bump();
}

const EMAIL_OK = /^[^\s@]{1,64}@[^\s@]{1,128}\.[^\s@]{2,24}$/;

/** PROTECT: attach an email to this uid so another headset can recover it. */
export async function protect(email: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (!EMAIL_OK.test(addr)) {
    bank.protecting = { stage: 'failed', note: 'that is not an email address' };
    bump();
    return false;
  }
  bank.protecting = { stage: 'busy', note: '' };
  bump();
  const who = await identity();
  if (!who) {
    bank.protecting = { stage: 'failed', note: bank.note || 'the cloud is off' };
    bump();
    return false;
  }
  try {
    const reply = await call<{ protected: boolean; email: string }>('/protect', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...who },
      body: JSON.stringify({ email: addr }),
    });
    bank.account = { known: true, protected: !!reply?.protected, email: reply?.email ?? '' };
    bank.protecting = { stage: 'done', note: '' };
    bump();
    return true;
  } catch (err) {
    bank.protecting = { stage: 'failed', note: String((err as Error)?.message ?? err).slice(0, 90) };
    bump();
    return false;
  }
}

/** Where the emailed link lands: the recover page beside the game. */
function recoverUrl(): string {
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}recover.html`;
}

/** RECOVER, step one: have Firebase email a sign-in link for that address. */
export async function startRecovery(email: string): Promise<void> {
  const addr = email.trim().toLowerCase();
  if (!EMAIL_OK.test(addr)) {
    bank.recovery = { stage: 'failed', email: addr, note: 'that is not an email address' };
    bump();
    return;
  }
  bank.recovery = { stage: 'sending', email: addr, note: '' };
  bump();
  try {
    const c = await cloud();
    if (!c) throw new Error(bank.note || 'the cloud is off — recovery needs it');
    const authMod = await import('firebase/auth');
    await authMod.sendSignInLinkToEmail(c.auth, addr, { url: recoverUrl(), handleCodeInApp: true });
    try {
      localStorage.setItem('ff-recover-email', addr); // recover.html on THIS browser needs no re-typing
    } catch {
      /* it will ask */
    }
    bank.recovery = { stage: 'sent', email: addr, note: '' };
  } catch (err) {
    const code = String((err as { code?: string })?.code ?? '');
    const note = code.includes('operation-not-allowed')
      ? 'email sign-in is not switched on for this game yet'
      : code.includes('unauthorized-continue-uri') || code.includes('invalid-continue-uri')
        ? 'this address is not on the sign-in allow-list yet'
        : String((err as Error)?.message ?? err).slice(0, 90);
    bank.recovery = { stage: 'failed', email: addr, note };
  }
  bump();
}

/** RECOVER, step two: the code from the phone → this headset becomes the account. */
export async function redeemCode(code: string): Promise<void> {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 6) {
    bank.recovery = { ...bank.recovery, stage: 'failed', note: 'the code is six digits' };
    bump();
    return;
  }
  bank.recovery = { ...bank.recovery, stage: 'redeeming', note: '' };
  bump();
  try {
    const reply = await call<{ token: string; uid: string }>('/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: digits }),
    });
    if (!reply?.token) throw new Error('no token');
    if (reply.token.startsWith('dev:')) throw new Error('the bank is in dev mode — no cloud account to become');
    const c = await cloud();
    if (!c) throw new Error(bank.note || 'the cloud is off');
    const authMod = await import('firebase/auth');
    await authMod.signInWithCustomToken(c.auth, reply.token);
    // The next boot merges as an ADOPTION: the account's wallet, plus what
    // this headset earned as a stranger.
    markWalletAdopt();
    bank.recovery = { ...bank.recovery, stage: 'done', note: '' };
    bump();
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    bank.recovery = { ...bank.recovery, stage: 'failed', note: String((err as Error)?.message ?? err).slice(0, 90) };
    bump();
  }
}

/** Back out of a recovery (nothing to undo — a sent link simply goes unused). */
export function cancelRecovery(): void {
  bank.recovery = { stage: 'idle', email: '', note: '' };
  bump();
}

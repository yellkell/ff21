/**
 * Ask for the microphone BEFORE the immersive session starts.
 *
 * WHY: inside the packaged Horizon app the content enters immersive XR the
 * instant it loads (see main.ts), so every getUserMedia call the game makes —
 * queueing a match, joining a raid, walking into the pub — happens while the
 * headset is already presenting. A permission prompt is browser UI, and there
 * is no reliable way to put browser UI in front of someone who is inside a
 * WebXR session: the request resolves as a silent denial and the player drops
 * onto the recvonly path, hearing everyone while nobody hears them. That is
 * exactly the "it never asks for permission" report, and it survives having
 * RECORD_AUDIO in the manifest, because the Android permission and the WEB
 * origin permission are two different gates.
 *
 * So we spend the one moment the app is still flat — after the page loads,
 * before launchXR — asking for the mic. A grant is remembered per origin, so
 * every later in-session getUserMedia just succeeds.
 *
 * We ask ONCE. After the first attempt (granted or refused) the answer is
 * recorded and later launches skip straight past, so nobody pays a delay at
 * startup twice and nobody gets nagged. Players who turned voice chat off in
 * settings are never asked at all.
 */

import { voiceEnabled } from './voicePref.js';

/** Remembers that we've had our one go, so launch #2 is never delayed. */
const ASKED_KEY = 'ff-mic-asked';

/** Cap on how long the prompt may hold up the boot. Long enough to read and
 *  answer, short enough that an ignored dialog can't strand the launch (Meta
 *  review has failed us for "stuck for an indefinite period after launching"
 *  before — see docs/pwa-packaging.md). */
const PROMPT_TIMEOUT_MS = 10_000;

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* private mode — we'll ask again next launch, which is harmless */
  }
}

/**
 * Settle the microphone permission while the page is still flat. Resolves
 * true if the mic is ours, false otherwise — nothing downstream depends on
 * the answer (a refusal just leaves voice on the recvonly path, as before),
 * so callers can treat this as fire-and-wait-briefly.
 */
export async function preflightMic(): Promise<boolean> {
  if (!voiceEnabled()) return false; // voice chat off — don't even ask
  if (!navigator.mediaDevices?.getUserMedia) return false;

  // Already settled? Never prompt again — and never delay the boot again.
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (status?.state === 'granted') return true;
    if (status?.state === 'denied') return false;
  } catch {
    /* Permissions API missing or won't take 'microphone' — fall through and
       rely on the asked-once flag instead. */
  }
  if (alreadyAsked()) return false;

  markAsked(); // record BEFORE prompting: a launch killed mid-dialog mustn't re-nag
  let stream: MediaStream | null = null;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROMPT_TIMEOUT_MS)),
    ]);
  } catch {
    return false; // refused or unavailable — voice falls back to listen-only
  }
  if (!stream) return false; // timed out; the grant may still land for later
  // We only wanted the grant on record — the real capture opens its own
  // stream when a bout actually starts, so release the hardware now.
  for (const track of stream.getTracks()) track.stop();
  return true;
}

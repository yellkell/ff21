/**
 * THE CAMERAMAN — a real picture for THE CHANNEL.
 *
 * FFTV began as a POSE STREAM: the caster sent numbers (heads, hands,
 * health, balls) and the stat page drew a top-down diagram from them. That
 * is cheap and it is legible, but it is a diagram, and a diagram is not
 * television — you cannot see the paint on a player, the titan filling the
 * sky, or the room the fight is happening in.
 *
 * So this renders the scene a few times a second from a camera nobody is
 * wearing, shrinks it to a postcard, and sends it as a JPEG. Motion JPEG
 * over the relay we already have: no media server, no WebRTC signalling,
 * no TURN, nothing new on the free tier that hosts the room.
 *
 * The three things that make it affordable:
 *
 *  1. A TINY TARGET. 256×144 is a thumbnail, and a thumbnail is what the
 *     page shows. The cost of the extra pass scales with pixels, and there
 *     are 37k of them against a headset's several million.
 *  2. AN ASYNC READBACK. `readRenderTargetPixelsAsync` fences the copy
 *     instead of stalling the pipeline on it, which is the difference
 *     between costing a slice of GPU time and costing a dropped frame.
 *     Reading a render target synchronously inside an XR frame is how you
 *     make a headset stutter, and a bout must never pay for television.
 *  3. A LOW RATE. Three frames a second. It is a window into a match, not
 *     the match.
 *
 * THE XR CATCH: inside an immersive session `renderer.render()` ignores the
 * camera you hand it and uses the headset's own, because `xr.isPresenting`
 * substitutes the XR camera array. To shoot from anywhere else the flag
 * comes off for exactly one render and goes straight back on — the standard
 * spectator-view trick, and the reason this is a module rather than four
 * lines in a system.
 *
 * Everything is best-effort: one capture in flight at a time, failures are
 * swallowed, and a headset that cannot do any of it simply never sends a
 * picture. The pose frame keeps being sent alongside, so the page always
 * has something to draw and the diagram remains the fallback.
 */

import {
  LinearFilter,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { VIDEO } from '../config.js';

let rt: WebGLRenderTarget | null = null;
let cam: PerspectiveCamera | null = null;
let flat: HTMLCanvasElement | OffscreenCanvas | null = null;
let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let pixels: Uint8Array | null = null;
let image: ImageData | null = null;
/** One capture at a time: the readback is async and the next tick must not
 *  start a second one on the same buffers. */
let busy = false;
/** Set once a capture throws — a context that cannot do this never will. */
let broken = false;

/** The camera the broadcast shoots with. Callers place it. */
export function tvCamera(): PerspectiveCamera {
  if (!cam) {
    cam = new PerspectiveCamera(VIDEO.fov, VIDEO.w / VIDEO.h, 0.05, 80);
    cam.matrixAutoUpdate = true;
  }
  return cam;
}

function ensure(): void {
  if (rt) return;
  rt = new WebGLRenderTarget(VIDEO.w, VIDEO.h, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  pixels = new Uint8Array(VIDEO.w * VIDEO.h * 4);
  flat =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(VIDEO.w, VIDEO.h)
      : Object.assign(document.createElement('canvas'), { width: VIDEO.w, height: VIDEO.h });
  ctx = flat.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  image = ctx.createImageData(VIDEO.w, VIDEO.h);
}

/** A blob to the base64 the wire carries (no data: prefix). */
async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  // Chunked: one String.fromCharCode per byte is slow, and spreading the
  // whole buffer at once blows the argument limit on a big frame.
  for (let i = 0; i < buf.length; i += 4096) {
    s += String.fromCharCode(...buf.subarray(i, Math.min(i + 4096, buf.length)));
  }
  return btoa(s);
}

/**
 * The shadow-lift curve, as a 256-entry table.
 *
 * Built once. A pow() per channel per pixel is 900k of them at 640x360,
 * three times a second, on a device that is also running a fight; a table
 * lookup is a table lookup.
 */
// Widened: VIDEO is `as const`, so the literal type would make every
// comparison against 1 a type error rather than a runtime question.
const LIFT_GAMMA: number = VIDEO.lift;
const LIFTS = LIFT_GAMMA !== 1;
const LIFT = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    t[i] = LIFTS ? Math.round(255 * Math.pow(i / 255, 1 / LIFT_GAMMA)) : i;
  }
  return t;
})();

async function encode(): Promise<string | null> {
  if (!flat || !ctx || !image || !pixels) return null;
  // WebGL hands back rows bottom-up; the picture wants them top-down. The
  // shadow lift rides along on the same pass, so it costs a lookup per
  // channel rather than a second walk of the buffer.
  const { w, h } = VIDEO;
  const dst = image.data;
  const lift = LIFTS;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const row = y * w * 4;
    if (!lift) {
      dst.set(pixels.subarray(src, src + w * 4), row);
      continue;
    }
    for (let x = 0; x < w * 4; x += 4) {
      dst[row + x] = LIFT[pixels[src + x]];
      dst[row + x + 1] = LIFT[pixels[src + x + 1]];
      dst[row + x + 2] = LIFT[pixels[src + x + 2]];
      dst[row + x + 3] = pixels[src + x + 3];
    }
  }
  ctx.putImageData(image as ImageData, 0, 0);
  const blob =
    'convertToBlob' in flat
      ? await flat.convertToBlob({ type: 'image/jpeg', quality: VIDEO.quality })
      : await new Promise<Blob | null>((res) =>
          (flat as HTMLCanvasElement).toBlob(res, 'image/jpeg', VIDEO.quality),
        );
  if (!blob) return null;
  const b64 = await toBase64(blob);
  // A frame over the cap is a frame the relay would refuse anyway.
  return b64.length > VIDEO.maxBytes ? null : b64;
}

/**
 * Shoot one frame from wherever `tvCamera()` currently stands.
 *
 * Returns base64 JPEG, or null if it could not (busy, broken, no context).
 * Never throws, and never leaves the renderer pointed at the target or
 * with XR switched off, whatever happens in between.
 */
export async function captureFrame(renderer: WebGLRenderer, scene: Scene): Promise<string | null> {
  if (busy || broken || !renderer) return null;
  busy = true;
  const xrWas = renderer.xr.enabled;
  const targetWas = renderer.getRenderTarget();
  try {
    ensure();
    if (!rt || !pixels) return null;
    // The one render nobody is wearing.
    renderer.xr.enabled = false;
    renderer.setRenderTarget(rt);
    renderer.render(scene, tvCamera());
    renderer.setRenderTarget(targetWas);
    renderer.xr.enabled = xrWas;
    // Fenced, not stalled: the bout's own frame carries on around it.
    await renderer.readRenderTargetPixelsAsync(rt, 0, 0, VIDEO.w, VIDEO.h, pixels);
    return await encode();
  } catch {
    // A context that cannot do this once will not do it later either;
    // stop asking rather than paying for the attempt every tick.
    broken = true;
    return null;
  } finally {
    // Belt and braces: if the throw happened mid-render the restores above
    // never ran, and leaving either of these wrong would black the headset.
    try {
      renderer.setRenderTarget(targetWas);
      renderer.xr.enabled = xrWas;
    } catch {
      /* the context is gone; nothing left to restore it for */
    }
    busy = false;
  }
}

/** Give back the target and buffers (leaving the arena). */
export function releaseCamera(): void {
  rt?.dispose();
  rt = null;
  pixels = null;
  image = null;
  flat = null;
  ctx = null;
  busy = false;
}

/** Whether this context has given up on making pictures. */
export function cameraBroken(): boolean {
  return broken;
}

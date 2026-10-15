/**
 * Crash telemetry for headset playtests — there's no devtools console in the
 * Quest, so an uncaught exception (which kills the render loop: the world
 * freezes, "the game crashed") vanishes without a trace.
 *
 * This traps window `error` / `unhandledrejection` and keeps the last few in
 * localStorage (they survive the reload) — QUIETLY. Nothing is announced on
 * boot: no console dump, no landing-page banner. Read or clear the stash on
 * demand from the console: `ibbCrashes()` / `ibbClearCrashes()`.
 */

const KEY = 'ibb-crashes';
const MAX = 12;

function stored(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}

function save(kind: string, detail: string): void {
  try {
    const entry = `${new Date().toISOString()} [${kind}] ${detail}`.slice(0, 1000);
    localStorage.setItem(KEY, JSON.stringify([...stored(), entry].slice(-MAX)));
  } catch {
    /* storage full/denied — the console line below still fires live */
  }
}

export function installCrashTrap(): void {
  window.addEventListener('error', (e) => {
    save('error', `${e.message} @ ${e.filename ?? '?'}:${e.lineno ?? 0}\n${(e.error as Error | undefined)?.stack ?? ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { stack?: string; message?: string } | undefined;
    save('promise', r?.stack ?? r?.message ?? String(e.reason));
  });

  // Console helpers for remote-debugging sessions — the ONLY way stored
  // crashes surface now; earlier sessions' errors never announce themselves.
  // A lost WebGL context is the one crash that throws nothing: the picture
  // goes black and stays black while the audio, the sockets and the game
  // loop all carry on. Caught in the capture phase — the event lands on the
  // canvas and does not bubble.
  document.addEventListener(
    'webglcontextlost',
    (e) => {
      const why = (e as WebGLContextEvent).statusMessage || '';
      console.error('[crash trap] WebGL context lost', why);
      save('webgl', `context lost ${why}`);
    },
    true,
  );
  document.addEventListener('webglcontextrestored', () => save('webgl', 'context restored'), true);

  (window as unknown as Record<string, unknown>).ibbCrashes = () => stored();
  (window as unknown as Record<string, unknown>).ibbClearCrashes = () => localStorage.removeItem(KEY);
}

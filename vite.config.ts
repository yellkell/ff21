import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

// IWSDK's dev plugin injects the IWER WebXR emulator so the game can be
// flown in a desktop browser (WASD + mouse) without a headset. On a real
// Quest browser it stays out of the way and the native WebXR session is used.
export default defineConfig({
  base: './',
  plugins: [
    iwsdkDev({
      // Emulate a Quest 3 device profile during local development.
      emulator: { device: 'metaQuest3' },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        // The arena (main game) and the pub social scene build side by side.
        main: 'index.html',
        pub: 'pub.html',
        // RAVE RAID (src/rave/) — the rhythm game as a third page, reached
        // from the ARCADE tab and returning to the arena from its rail.
        rave: 'rave.html',
        // THE BANK's recovery page: where the emailed sign-in link lands
        // (net/bank.ts RECOVER). A phone opens it and reads off a code.
        recover: 'recover.html',
      },
    },
    // Never inline a track — they must stay separate files so the browser
    // can stream and cache them.
    assetsInlineLimit: 4096,
  },
  // The rave's music masters ride along as static assets; .m4a isn't in
  // every Vite version's default asset list.
  assetsInclude: ['**/*.m4a'],
});

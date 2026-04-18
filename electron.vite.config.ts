import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      sourcemap: false,
      minify: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
        // package.json has "type": "module", so .js files are treated as ESM.
        // Main and preload need CJS for `require()` and contextBridge — use .cjs.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      sourcemap: false,
      minify: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
      },
    },
  },
  renderer: {
    // Use __dirname so root and input are consistently in the same physical
    // path. When the project lives behind a junction (e.g. C:\fp-browser-dev →
    // a Chinese-character path), `root: '.'` resolves via process.cwd() which
    // gives the junction, while `__dirname` resolves to the real path. Vite's
    // build-html plugin then tries to compute a relative path between the
    // input and the root, gets "../..", and aborts with
    // "fileName must be strings that are neither absolute nor relative paths".
    root: __dirname,
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared'),
      },
      // Don't resolve junction/symlinks to real paths — keeps the
      // C:\fp-browser-dev junction intact so Vite never sees the underlying
      // Chinese-character path that breaks ESM URL parsing.
      preserveSymlinks: true,
    },
    server: {
      port: 5173,
      // Bind to IPv4 explicitly — Electron's loader on Windows prefers IPv4
      // for `localhost`, but Node.js 17+ binds to IPv6 by default. Mismatch
      // causes ERR_CONNECTION_REFUSED on first load.
      host: '127.0.0.1',
      strictPort: true,
    },
  },
});

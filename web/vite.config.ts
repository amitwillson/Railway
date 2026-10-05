import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

/**
 * DEMO=1 builds the offline demonstration bundle: the API client's transport is
 * aliased to the in-browser backend, routing becomes hash-based and everything
 * is inlined into a single HTML file by scripts/build-demo.mjs. No application
 * code differs between the two builds.
 */
const DEMO = process.env.DEMO === '1';

export default defineConfig({
  plugins: [react()],
  base: DEMO ? './' : '/',
  define: DEMO ? { 'import.meta.env.DEMO': 'true' } : {},
  resolve: {
    // Matches every relative spelling of the transport module: './transport'
    // from src/api, './api/transport' from src, and '../api/transport' or
    // '../../api/transport' from the pages and components.
    alias: DEMO
      ? [
          {
            find: /^(\.\.?\/)+(api\/)?transport$/,
            replacement: path.resolve(__dirname, 'src/api/transport.demo.ts'),
          },
        ]
      : [],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: DEMO ? 'dist-demo' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: DEMO ? 100_000_000 : 4096,
    cssCodeSplit: !DEMO,
    rollupOptions: DEMO ? { output: { inlineDynamicImports: true } } : {},
  },
});

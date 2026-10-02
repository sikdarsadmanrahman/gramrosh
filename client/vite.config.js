/**
 * -----------------------------------------------------------------------------
 *  vite.config.js — storefront + admin SPA
 * -----------------------------------------------------------------------------
 *  Two things matter here:
 *
 *  1. `server.proxy` — the browser only ever talks to the Vite origin. Every
 *     `/api`, `/img` and `/uploads` request is forwarded to the Express server,
 *     so there is no CORS handshake in development and no hard-coded host in
 *     the bundle (which would break any preview/tunnel domain).
 *
 *  2. Manual chunks — React, the router and the state layer are split out of the
 *     application bundle so a marketing copy change does not invalidate the
 *     180 kB vendor chunk in the CDN cache.
 * -----------------------------------------------------------------------------
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  /** Where the Express API lives. Overridable for docker/preview setups. */
  const apiTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:5055';

  return {
    plugins: [react()],

    server: {
      // Bind every interface so the app is reachable from a sandbox/preview host.
      host: '0.0.0.0',
      port: Number(env.PORT ?? 5173),
      strictPort: false,
      // Accept any preview/tunnel hostname (e2b, ngrok, LAN). The dev server
      // never faces the internet in production, so this is safe here.
      allowedHosts: true,
      proxy: {
        // NOTE: no '/img' proxy — catalogue WebP lives in client/public and is
        // served by Vite itself in dev (and from client/dist by Express in prod).
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },

    preview: {
      host: '0.0.0.0',
      port: Number(env.PORT ?? 4173),
      allowedHosts: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
      },
    },

    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      // Warn early: a phone-first storefront should stay well under this.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            router: ['react-router-dom'],
            state: ['zustand'],
          },
        },
      },
    },
  };
});

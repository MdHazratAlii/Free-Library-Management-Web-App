// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        // TanStack Start serves static files from dist/client; the worker and its file list must live there.
        outDir: "dist/client",
        includeAssets: [],
        includeManifestIcons: false,
        manifest: false, // public/manifest.webmanifest is used
        workbox: {
          navigateFallback: null,
          globDirectory: "dist/client",
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}"],
          runtimeCaching: [
            {
              urlPattern: ({ request }: { request: Request }) => request.mode === "navigate" && !new URL(request.url).pathname.startsWith("/~oauth") && !new URL(request.url).pathname.startsWith("/api/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "lp-pages",
                networkTimeoutSeconds: 4,
                cacheableResponse: { statuses: [200] },
                plugins: [{
                  handlerDidError: async () => (await caches.match("/", { ignoreSearch: true })) ?? Response.error(),
                }],
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              urlPattern: ({ url }: { url: URL }) =>
                url.origin === self.location.origin && /\/assets\/.*-[a-zA-Z0-9_-]+\.(?:js|css|woff2?)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "lp-static",
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Book covers and student photos (incl. private signed links) for offline viewing.
              urlPattern: ({ request, url }: { request: Request; url: URL }) =>
                request.destination === "image" || /\/storage\/v1\/object\/sign\//.test(url.pathname) ||
                /(?:covers\.openlibrary\.org|books\.google\.com|googleusercontent\.com|ui-avatars\.com)$/.test(url.hostname),
              handler: "CacheFirst",
              options: {
                cacheName: "lp-images",
                expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 180 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }: { url: URL }) =>
                /(?:googleapis|gstatic|cdnjs\.cloudflare)\.com$/.test(url.hostname),
              handler: "CacheFirst",
              options: {
                cacheName: "lp-cdn",
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
  },
});

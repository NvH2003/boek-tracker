import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  // Expliciet .env lezen (naast import.meta.env); lost op als de key wel in .env staat maar de client leeg blijft.
  const root = process.cwd();
  const fileEnv = loadEnv(mode, root, "");
  const googleBooksKey = (
    fileEnv.VITE_GOOGLE_BOOKS_API_KEY ??
    process.env.VITE_GOOGLE_BOOKS_API_KEY ??
    ""
  )
    .trim();

  return {
    envDir: root,
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
      __BT_GOOGLE_BOOKS_KEY__: JSON.stringify(googleBooksKey),
    },
    plugins: [
      react(),
      VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "BookFlow",
        short_name: "BookFlow",
        description: "Track je leeslijst, planken en Boekbuddies.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        scope: "/",
        start_url: "/",
        orientation: "portrait-primary",
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i, handler: "CacheFirst", options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } } }
        ]
      }
      })
    ],
    server: {
      port: 5173,
    },
  };
});


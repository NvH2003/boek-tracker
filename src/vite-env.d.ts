/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected in vite.config.ts via loadEnv + define (fallback als import.meta.env leeg blijft). */
declare const __BT_GOOGLE_BOOKS_KEY__: string;

interface ImportMetaEnv {
  readonly VITE_INSTANT_APP_ID?: string;
  /** Google Books API (zoeken + genres in de browser). Alleen beschikbaar als `VITE_`-prefix in `.env`. */
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string;
}

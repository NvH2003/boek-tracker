/**
 * Google Books API-key voor gebruik in de browser.
 * Alleen variabelen met prefix `VITE_` worden door Vite in `import.meta.env` gezet.
 *
 * Zet in de projectroot (naast package.json): `.env` met
 *   VITE_GOOGLE_BOOKS_API_KEY=jouw_key
 * Geen spaties rond `=`. Herstart `npm run dev` na wijzigingen.
 * Voor `npm run build` / hosting: zelfde variabele in je build-omgeving zetten.
 */
function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).trim();
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).trim();
  }
  return t;
}

export function getGoogleBooksBrowserApiKey(): string | undefined {
  const fromMeta = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
  const fromInjected =
    typeof __BT_GOOGLE_BOOKS_KEY__ !== "undefined" ? String(__BT_GOOGLE_BOOKS_KEY__) : "";

  const metaClean =
    fromMeta != null && String(fromMeta).trim() !== ""
      ? stripOuterQuotes(String(fromMeta))
      : "";
  const injectedClean = stripOuterQuotes(fromInjected);

  const merged = metaClean || injectedClean;
  return merged.length > 0 ? merged : undefined;
}

export function hasGoogleBooksBrowserApiKey(): boolean {
  return Boolean(getGoogleBooksBrowserApiKey());
}

/** Voor support/debug: geen key zelf tonen, alleen waar hij vandaan komt. */
export function getGoogleBooksKeyDiagnostics(): {
  importMetaNonEmpty: boolean;
  importMetaRawLength: number;
  injectedNonEmpty: boolean;
  injectedRawLength: number;
  resolvedUsable: boolean;
} {
  const metaRaw = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
  const metaStr = metaRaw != null ? String(metaRaw) : "";
  const injRaw =
    typeof __BT_GOOGLE_BOOKS_KEY__ !== "undefined" ? String(__BT_GOOGLE_BOOKS_KEY__) : "";

  return {
    importMetaNonEmpty: metaStr.trim().length > 0,
    importMetaRawLength: metaStr.length,
    injectedNonEmpty: injRaw.trim().length > 0,
    injectedRawLength: injRaw.length,
    resolvedUsable: Boolean(getGoogleBooksBrowserApiKey()),
  };
}

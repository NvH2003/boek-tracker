import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleBooksBrowserApiKey, hasGoogleBooksBrowserApiKey } from "./googleBooksBrowserKey";
import { fetchBookGenresFromEdge } from "./fetchBookGenresFromEdge";
import { mapFetchedGenresToStandardShelf } from "./standardGenres";

const GOOGLE_BOOKS_VOLUMES = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";

/** Max aantal unieke tags na merge (balans: niet te weinig, niet een muur aan pills). */
const MAX_GENRES_RETURNED = 18;
const GOOGLE_MAX_RESULTS = 20;
const OPEN_LIBRARY_LIMIT = 5;
/** Per zoekresultaat max. subjects (OL kan honderden hebben). */
const OPEN_LIBRARY_SUBJECTS_PER_DOC = 12;

/** Zelfde check als voor zoeken: staat `VITE_GOOGLE_BOOKS_API_KEY` in de gebouwde app? */
export function hasViteGoogleBooksKey(): boolean {
  return hasGoogleBooksBrowserApiKey();
}

/** Tekst uit profiel-tekstvak → unieke termen (komma of nieuwe regel). */
export function parseGenreAllowlistTextarea(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const s = part.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function normalizeAllowlist(allowlist: string[]): string[] {
  return allowlist.map((a) => a.trim()).filter(Boolean);
}

/**
 * Houdt alleen API-tags die bij jouw lijst passen (exact of de één bevat de ander, min. 2 tekens voor “bevat”).
 * Lege `allowlist` = geen filter.
 */
export function filterGenresByAllowlist(genres: string[], allowlist: string[]): string[] {
  const allowed = normalizeAllowlist(allowlist);
  if (allowed.length === 0) return genres;
  const allowedLower = allowed.map((a) => a.toLowerCase());
  return genres.filter((g) => {
    const gl = g.trim().toLowerCase();
    if (!gl) return false;
    return allowedLower.some((al) => {
      if (gl === al) return true;
      if (al.length >= 2 && gl.includes(al)) return true;
      if (gl.length >= 2 && al.includes(gl)) return true;
      return false;
    });
  });
}

/** Zelfde flatten-logica als de edge function (`Fiction / Fantasy` → losse tags). */
function flattenCategories(categories: unknown): string[] {
  if (categories == null) return [];
  const raw = Array.isArray(categories) ? categories : [String(categories)];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const parts = entry
      .split(/\s*\/\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function dedupePreserveOrder(strings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of strings) {
    const s = String(item).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Google eerst (breed), daarna Open Library (specifieker); max `maxTotal` stuks. */
function mergeGenreLists(primary: string[], secondary: string[], maxTotal: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [primary, secondary]) {
    for (const item of list) {
      const s = String(item).trim();
      if (s.length < 2 || s.length > 90) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= maxTotal) return out;
    }
  }
  return out;
}

const OL_SUBJECT_SKIP = /^(accessible|large\s*print|protected\s*daisy|nyt:)/i;

/**
 * Open Library levert vaak veel rijkere onderwerpen dan Google Books-categorieën.
 * Geen API-key nodig; faalt stilletjes → [].
 */
async function fetchOpenLibrarySubjects(title: string, authors: string): Promise<string[]> {
  const t = title.trim();
  const a = authors.trim();
  const q = [t, a].filter(Boolean).join(" ").trim();
  if (!q) return [];

  try {
    const url = new URL(OPEN_LIBRARY_SEARCH);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(OPEN_LIBRARY_LIMIT));
    url.searchParams.set("fields", "subject,title,author_name");

    const res = await fetch(url.toString());
    const data = (await res.json().catch(() => ({}))) as {
      docs?: { subject?: unknown }[];
    };
    if (!res.ok) return [];

    const docs = Array.isArray(data.docs) ? data.docs : [];
    const collected: string[] = [];

    for (const doc of docs) {
      const raw = doc?.subject;
      const arr = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : [];
      for (const entry of arr.slice(0, OPEN_LIBRARY_SUBJECTS_PER_DOC)) {
        if (typeof entry !== "string") continue;
        const s = entry.trim();
        if (s.length < 2 || s.length > 90) continue;
        if (OL_SUBJECT_SKIP.test(s)) continue;
        collected.push(s);
      }
    }

    return dedupePreserveOrder(collected);
  } catch {
    return [];
  }
}

/** Zelfde strategie als boek-zoeken: betere treffers + vaker `categories` aanwezig. */
function buildGoogleBooksGenreQuery(title: string, authors: string): string {
  const t = title.trim();
  const a = authors.trim();
  if (t && a) return `intitle:${t} inauthor:${a}`;
  return [t, a].filter(Boolean).join(" ");
}

async function fetchBookGenresDirect(title: string, authors: string): Promise<string[]> {
  const apiKey = getGoogleBooksBrowserApiKey();
  if (!apiKey) {
    throw new Error(
      "VITE_GOOGLE_BOOKS_API_KEY ontbreekt in deze build. Controleer .env in de projectroot, herstart de dev-server, of zet de variabele in je hosting-build."
    );
  }

  const q = buildGoogleBooksGenreQuery(title, authors);
  if (!q.trim()) throw new Error("title/authors missen");

  const url = new URL(GOOGLE_BOOKS_VOLUMES);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(GOOGLE_MAX_RESULTS));
  url.searchParams.set("key", apiKey);

  const [googleRes, openLibraryGenres] = await Promise.all([
    fetch(url.toString()),
    fetchOpenLibrarySubjects(title, authors),
  ]);

  const data = (await googleRes.json().catch(() => ({}))) as {
    items?: { volumeInfo?: { categories?: unknown } }[];
    error?: { message?: string };
  };

  let googleGenres: string[] = [];
  if (googleRes.ok) {
    const items = Array.isArray(data.items) ? data.items : [];
    const merged: string[] = [];
    for (const item of items) {
      merged.push(...flattenCategories(item?.volumeInfo?.categories));
    }
    googleGenres = dedupePreserveOrder(merged);
  } else {
    const msg =
      typeof data?.error?.message === "string" ? data.error.message : `Google Books API: ${googleRes.status}`;
    if (openLibraryGenres.length === 0) {
      throw new Error(msg);
    }
  }

  const combined = mergeGenreLists(googleGenres, openLibraryGenres, MAX_GENRES_RETURNED);
  if (combined.length > 0) return combined;

  throw new Error("Geen categorieën gevonden (Google Books + Open Library). Probeer titel en auteur exacter.");
}

/**
 * - Met `VITE_GOOGLE_BOOKS_API_KEY`: **alleen** direct Google Books in de browser (geen Edge).
 *   Zo krijg je geen verwarrende Edge-fouten terwijl je lokaal al een key hebt.
 * - Zonder Vite-key maar met Supabase: Edge Function `goodreads-genres-nl` (secret `GOOGLE_BOOKS_API_KEY`).
 *
 * `options.genreAllowlist`: optioneel; zie Profiel → “Toegestane genres”. Leeg = alle suggesties.
 */
export async function fetchBookGenres(
  client: SupabaseClient | null,
  title: string,
  authors: string,
  options?: { genreAllowlist?: string[] }
): Promise<string[]> {
  const allow = options?.genreAllowlist ?? [];

  let raw: string[];
  if (hasGoogleBooksBrowserApiKey()) {
    raw = await fetchBookGenresDirect(title, authors);
  } else if (client) {
    raw = await fetchBookGenresFromEdge(client, title, authors);
  } else {
    throw new Error(
      "Geen VITE_GOOGLE_BOOKS_API_KEY in deze build en geen Supabase-client. Zet VITE_GOOGLE_BOOKS_API_KEY in .env (projectroot), herstart dev-server, of zet secret GOOGLE_BOOKS_API_KEY op Supabase en gebruik de Edge Function."
    );
  }

  const filtered = filterGenresByAllowlist(raw, allow);
  if (
    filtered.length === 0 &&
    raw.length > 0 &&
    normalizeAllowlist(allow).length > 0
  ) {
    throw new Error(
      "Geen suggesties passen bij je genrelijst (Profiel). Voeg termen toe of wis het veld voor alle suggesties."
    );
  }

  /** Waar mogelijk: automatisch naar de vaste standaardlijst (Goodreads-stijl). */
  const mapped = mapFetchedGenresToStandardShelf(filtered, MAX_GENRES_RETURNED);
  if (mapped.length > 0) {
    // Rule: "Fiction" altijd achteraan als pill.
    const fictionLower = "fiction";
    const fictionLabels = mapped.filter((x) => x.trim().toLowerCase() === fictionLower);
    const withoutFiction = mapped.filter((x) => x.trim().toLowerCase() !== fictionLower);
    return fictionLabels.length > 0 ? [...withoutFiction, ...fictionLabels] : mapped;
  }
  return filtered.slice(0, MAX_GENRES_RETURNED);
}

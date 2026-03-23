// Genres/categorieën via Google Books API (volumeInfo.categories). Geen Goodreads-scraping.
// Secret in Supabase: GOOGLE_BOOKS_API_KEY (zelfde key als VITE_GOOGLE_BOOKS_API_KEY in je app).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const GOOGLE_BOOKS_VOLUMES = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";

const MAX_GENRES_RETURNED = 18;
const GOOGLE_MAX_RESULTS = 20;
const OPEN_LIBRARY_LIMIT = 5;
const OPEN_LIBRARY_SUBJECTS_PER_DOC = 12;

const OL_SUBJECT_SKIP = /^(accessible|large\s*print|protected\s*daisy|nyt:)/i;

/** Google geeft soms hiërarchieën als "Fiction / Fantasy / Epic". */
function flattenCategories(categories: unknown): string[] {
  if (categories == null) return [];
  const raw = Array.isArray(categories) ? categories : [String(categories)];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const parts = entry.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

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
    const data = await res.json().catch(() => ({} as { docs?: { subject?: unknown }[] }));
    if (!res.ok) return [];

    const docs = Array.isArray(data.docs) ? data.docs : [];
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const doc of docs) {
      const raw = doc?.subject;
      const arr = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : [];
      for (const entry of arr.slice(0, OPEN_LIBRARY_SUBJECTS_PER_DOC)) {
        if (typeof entry !== "string") continue;
        const s = entry.trim();
        if (s.length < 2 || s.length > 90) continue;
        if (OL_SUBJECT_SKIP.test(s)) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(s);
      }
    }
    return merged;
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const apiKey = Deno.env.get("GOOGLE_BOOKS_API_KEY")?.trim();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "GOOGLE_BOOKS_API_KEY ontbreekt. Zet deze als secret voor deze Edge Function in Supabase (zelfde key als in Google Cloud Console voor Books API).",
        }),
        { status: 503, headers: CORS_HEADERS },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { title?: string; authors?: string };
    const title = String(body.title ?? "").trim();
    const authors = String(body.authors ?? "").trim();
    if (!title && !authors) {
      return new Response(JSON.stringify({ error: "title/authors missen" }), { status: 400, headers: CORS_HEADERS });
    }

    // Zelfde query-stijl als in de app (intitle/inauthor) voor betere match + vaker categories.
    const q =
      title && authors
        ? `intitle:${title} inauthor:${authors}`
        : [title, authors].filter(Boolean).join(" ");
    const url = new URL(GOOGLE_BOOKS_VOLUMES);
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(GOOGLE_MAX_RESULTS));
    url.searchParams.set("key", apiKey);

    const [res, openLibraryGenres] = await Promise.all([
      fetch(url.toString()),
      fetchOpenLibrarySubjects(title, authors),
    ]);

    const data = await res.json().catch(() => ({} as { items?: { volumeInfo?: { categories?: unknown } }[] }));

    let googleGenres: string[] = [];
    if (res.ok) {
      const items = Array.isArray(data.items) ? data.items : [];
      const merged: string[] = [];
      for (const item of items) {
        merged.push(...flattenCategories(item?.volumeInfo?.categories));
      }
      const seen = new Set<string>();
      for (const g of merged) {
        const k = g.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        googleGenres.push(g);
      }
    } else {
      const msg =
        typeof (data as { error?: { message?: string } })?.error?.message === "string"
          ? (data as { error: { message: string } }).error.message
          : `Google Books API: ${res.status}`;
      if (openLibraryGenres.length === 0) {
        return new Response(JSON.stringify({ error: msg }), { status: 502, headers: CORS_HEADERS });
      }
    }

    const genres = mergeGenreLists(googleGenres, openLibraryGenres, MAX_GENRES_RETURNED);

    if (genres.length > 0) {
      return new Response(JSON.stringify({ genres }), { status: 200, headers: CORS_HEADERS });
    }

    return new Response(
      JSON.stringify({ error: "Geen categorieën gevonden (Google Books + Open Library)" }),
      { status: 404, headers: CORS_HEADERS },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: CORS_HEADERS });
  }
});

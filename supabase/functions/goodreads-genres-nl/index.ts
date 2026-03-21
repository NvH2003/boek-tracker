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

    const q = [title, authors].filter(Boolean).join(" ");
    const url = new URL(GOOGLE_BOOKS_VOLUMES);
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({} as { items?: { volumeInfo?: { categories?: unknown } }[] }));

    if (!res.ok) {
      const msg =
        typeof (data as { error?: { message?: string } })?.error?.message === "string"
          ? (data as { error: { message: string } }).error.message
          : `Google Books API: ${res.status}`;
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: CORS_HEADERS });
    }

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const cats = item?.volumeInfo?.categories;
      const genres = flattenCategories(cats);
      if (genres.length > 0) {
        return new Response(JSON.stringify({ genres }), { status: 200, headers: CORS_HEADERS });
      }
    }

    return new Response(
      JSON.stringify({ error: "Geen categorieën gevonden in Google Books voor deze zoekopdracht" }),
      { status: 404, headers: CORS_HEADERS },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: CORS_HEADERS });
  }
});

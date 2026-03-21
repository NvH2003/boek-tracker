// Goodreads → genres (zoals op de site). Geen vertaling; geen LIBRETRANSLATE_* secrets nodig.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractFirstGoodreadsBookPathFromSearchHtml(searchHtml: string): string | null {
  // Voorbeeld link: /book/show/5907.The_Hobbit
  const m = searchHtml.match(/href=["'](\/book\/show\/\d+[^"'']*)["']/);
  return m?.[1] ?? null;
}

function extractGenreTextsFromGoodreadsBookHtml(bookHtml: string): string[] {
  const genres: string[] = [];
  const seen = new Set<string>();

  // Goodreads gebruikt meestal /genres/... anchors met als tekst de genre-naam.
  const regex = /href=(["'])\/genres\/[^"']+\1[^>]*>([^<]+)</g;
  const matches = bookHtml.matchAll(regex);

  for (const match of matches) {
    const rawText = match[2] ?? "";
    const decoded = decodeHtmlEntities(rawText).trim();
    if (!decoded) continue;

    // Soms match je ook label-achtigen; die willen we overslaan.
    if (decoded.toLowerCase() === "genres") continue;

    if (!seen.has(decoded)) {
      seen.add(decoded);
      genres.push(decoded);
    }
  }

  return genres;
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
    const body = (await req.json().catch(() => ({}))) as { title?: string; authors?: string };
    const title = String(body.title ?? "").trim();
    const authors = String(body.authors ?? "").trim();
    if (!title && !authors) {
      return new Response(JSON.stringify({ error: "title/authors missen" }), { status: 400, headers: CORS_HEADERS });
    }

    const q = [title, authors].filter(Boolean).join(" ");
    const searchUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;

    const searchRes = await fetch(searchUrl, {
      headers: {
        // Soms toont Goodreads een andere HTML zonder browser-achtige headers.
        "User-Agent": "Mozilla/5.0 (compatible; BoekTracker/1.0)",
      },
    });

    if (!searchRes.ok) {
      return new Response(JSON.stringify({ error: `Goodreads search failed: ${searchRes.status}` }), {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    const searchHtml = await searchRes.text();
    const bookPath = extractFirstGoodreadsBookPathFromSearchHtml(searchHtml);
    if (!bookPath) {
      return new Response(JSON.stringify({ error: "Kon Goodreads boekpagina niet vinden" }), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const bookUrl = bookPath.startsWith("http") ? bookPath : `https://www.goodreads.com${bookPath}`;
    const bookRes = await fetch(bookUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BoekTracker/1.0)",
      },
    });

    if (!bookRes.ok) {
      return new Response(JSON.stringify({ error: `Goodreads book failed: ${bookRes.status}` }), {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    const bookHtml = await bookRes.text();
    const foundGenres = extractGenreTextsFromGoodreadsBookHtml(bookHtml);
    if (!foundGenres.length) {
      return new Response(JSON.stringify({ error: "Geen genres gevonden op Goodreads" }), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    // Geen vertaling: genres zoals op Goodreads (meestal Engels).
    return new Response(JSON.stringify({ genres: foundGenres }), { status: 200, headers: CORS_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: CORS_HEADERS });
  }
});


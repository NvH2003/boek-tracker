/**
 * Vercel API route die de genres-zoekfunctie vervangt die voorheen
 * via de Supabase Edge Function "goodreads-genres-nl" liep.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const GOOGLE_BOOKS_VOLUMES = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const MAX_GENRES_RETURNED = 18;
const GOOGLE_MAX_RESULTS = 20;
const OPEN_LIBRARY_LIMIT = 5;
const OPEN_LIBRARY_SUBJECTS_PER_DOC = 12;
const OL_SUBJECT_SKIP = /^(accessible|large\s*print|protected\s*daisy|nyt:)/i;

function flattenCategories(categories: unknown): string[] {
  if (categories == null) return [];
  const raw = Array.isArray(categories) ? categories : [String(categories)];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    for (const p of entry.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean)) {
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
  const q = [title, authors].filter(Boolean).join(" ").trim();
  if (!q) return [];
  try {
    const url = new URL(OPEN_LIBRARY_SEARCH);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(OPEN_LIBRARY_LIMIT));
    url.searchParams.set("fields", "subject,title,author_name");
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({} as { docs?: { subject?: unknown }[] }));
    const docs = Array.isArray(data.docs) ? data.docs : [];
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const doc of docs) {
      const arr = Array.isArray(doc?.subject) ? doc.subject : [];
      for (const entry of arr.slice(0, OPEN_LIBRARY_SUBJECTS_PER_DOC)) {
        if (typeof entry !== "string") continue;
        const s = entry.trim();
        if (s.length < 2 || s.length > 90 || OL_SUBJECT_SKIP.test(s)) continue;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = (process.env.GOOGLE_BOOKS_API_KEY ?? process.env.VITE_GOOGLE_BOOKS_API_KEY ?? "").trim();
  if (!apiKey) return res.status(503).json({ error: "GOOGLE_BOOKS_API_KEY ontbreekt." });

  const { title, authors } = req.body as { title?: string; authors?: string };
  const t = String(title ?? "").trim();
  const a = String(authors ?? "").trim();
  if (!t && !a) return res.status(400).json({ error: "title/authors missen" });

  const q = t && a ? `intitle:${t} inauthor:${a}` : [t, a].filter(Boolean).join(" ");
  const url = new URL(GOOGLE_BOOKS_VOLUMES);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(GOOGLE_MAX_RESULTS));
  url.searchParams.set("key", apiKey);

  const [googleRes, openLibraryGenres] = await Promise.all([
    fetch(url.toString()),
    fetchOpenLibrarySubjects(t, a),
  ]);

  const data = await googleRes.json().catch(() => ({} as { items?: { volumeInfo?: { categories?: unknown } }[] }));

  let googleGenres: string[] = [];
  if (googleRes.ok) {
    const items = Array.isArray(data.items) ? data.items : [];
    const seen = new Set<string>();
    for (const item of items) {
      for (const g of flattenCategories(item?.volumeInfo?.categories)) {
        const k = g.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        googleGenres.push(g);
      }
    }
  }

  const genres = mergeGenreLists(googleGenres, openLibraryGenres, MAX_GENRES_RETURNED);
  if (genres.length > 0) return res.status(200).json({ genres });
  return res.status(404).json({ error: "Geen categorieën gevonden" });
}

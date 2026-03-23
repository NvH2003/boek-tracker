import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Roept de Edge Function `goodreads-genres-nl` aan (Google Books → categories).
 * Geeft een geschoonde, unieke lijst terug (volgorde behouden).
 */
export async function fetchBookGenresFromEdge(
  client: SupabaseClient,
  title: string,
  authors: string
): Promise<string[]> {
  const { data, error } = await client.functions.invoke<{ genres?: unknown }>(
    "goodreads-genres-nl",
    {
      method: "POST",
      body: { title: title.trim(), authors: authors.trim() },
    }
  );

  if (error) {
    throw new Error(error.message || "Genres ophalen mislukt");
  }

  const raw = data?.genres;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Geen categorieën in antwoord");
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = String(item).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  if (out.length === 0) throw new Error("Geen geldige categorieën");
  return out;
}

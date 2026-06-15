/**
 * Roept de Vercel API route /api/genres aan (vervangt de Supabase Edge Function).
 * Geeft een geschoonde, unieke lijst terug (volgorde behouden).
 */
export async function fetchBookGenresFromEdge(
  title: string,
  authors: string
): Promise<string[]> {
  const res = await fetch("/api/genres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title.trim(), authors: authors.trim() }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Genres ophalen mislukt" })) as { error?: string };
    throw new Error(err.error ?? "Genres ophalen mislukt");
  }

  const data = await res.json() as { genres?: unknown };
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

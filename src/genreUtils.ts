export function parseGenres(raw?: string): string[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Uniek + alfabetisch (nl-NL) zodat weerveld consistent is.
  const unique = Array.from(new Set(parts));
  unique.sort((a, b) => a.localeCompare(b, "nl-NL"));
  return unique;
}

export function formatGenres(raw?: string): string {
  return parseGenres(raw).join(", ");
}

/**
 * Parse genres zonder alfabetische sortering.
 * De volgorde in de opgeslagen string blijft behouden en wordt uniek gehouden.
 * Handig wanneer het "eerste genre" ook het primaire genre moet zijn.
 */
export function parseGenresPreserveOrder(raw?: string): string[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    ordered.push(p);
  }
  return ordered;
}

/**
 * Format genres met preserve-order (dus: eerste genre uit de opslag blijft eerste).
 * Handig voor weergave als je “primair genre” wilt tonen.
 */
export function formatGenresPreserveOrder(raw?: string): string {
  return parseGenresPreserveOrder(raw).join(", ");
}


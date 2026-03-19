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


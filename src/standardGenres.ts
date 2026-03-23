/**
 * Veelgebruikte Engelse genres/shelves (o.a. zoals bij Goodreads).
 * Eén klik om toe te voegen naast API-suggesties en vrije tekst.
 */
export const STANDARD_SHELF_GENRES: readonly string[] = [
  "Art",
  "Biography",
  "Business",
  "Chick Lit",
  "Children's",
  "Christian",
  "Classics",
  "Comics",
  "Contemporary",
  "Cookbooks",
  "Crime",
  "Fantasy",
  "Fiction",
  "Gay and Lesbian",
  "Graphic Novels",
  "Historical Fiction",
  "History",
  "Horror",
  "Humor and Comedy",
  "Magical Realism",
  "Manga",
  "Memoir",
  "Music",
  "Mystery",
  "Nonfiction",
  "Paranormal",
  "Philosophy",
  "Poetry",
  "Psychology",
  "Religion",
  "Romance",
  "Science",
  "Science Fiction",
  "Self Help",
  "Spirituality",
  "Sports",
  "Thriller",
  "Travel",
  "Young Adult"
] as const;

/** Langere labels eerst, zodat bv. "Science Fiction" wint van "Fiction". */
const STANDARDS_BY_LENGTH = [...STANDARD_SHELF_GENRES].sort((a, b) => b.length - a.length);

/**
 * Zoekt de beste bijpassende standaardterm voor één ruwe API-tag (Google/Open Library).
 */
export function matchApiGenreToStandardLabel(apiTag: string): string | null {
  const gl = apiTag.trim().toLowerCase();
  if (!gl) return null;

  for (const std of STANDARDS_BY_LENGTH) {
    if (gl === std.toLowerCase()) return std;
  }

  for (const std of STANDARDS_BY_LENGTH) {
    const sl = std.toLowerCase();
    if (sl.length >= 3 && gl.includes(sl)) return std;
    if (gl.length >= 3 && sl.includes(gl)) return std;
  }

  return null;
}

/**
 * Zet een lijst opgehaalde tags om naar canonieke standaardlabels, volgorde behouden, max `maxResults`.
 * Tags zonder match vallen weg (ze blijven beschikbaar via handmatige invoer).
 */
export function mapFetchedGenresToStandardShelf(fetched: string[], maxResults: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of fetched) {
    const std = matchApiGenreToStandardLabel(tag);
    if (!std) continue;
    const k = std.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(std);
    if (out.length >= maxResults) break;
  }
  return out;
}

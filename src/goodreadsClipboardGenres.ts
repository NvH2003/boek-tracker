import { parseGenresPreserveOrder } from "./genreUtils";
import { translateGenreToDutch } from "./genreTranslations";

// Alleen deze genres mogen als pills verschijnen (clipboard-specifiek).
// Vertalingsregels:
// - (niet vertalen): output exact dezelfde label als allowlist
// - Humor and Comedy + Romance: speciale vertaling volgens verzoek
export const GOODREADS_CLIPBOARD_ALLOWLIST: readonly string[] = [
  "Art",
  "Autobiography",
  "Biography",
  "Business",
  "Chick Lit",
  "Children's",
  "Christian",
  "Classics",
  "Comics",
  "Christmas",
  "Cookbooks",
  "Crime",
  "Dark Romance",
  "Erotica",
  "Fantasy",
  "Fiction",
  "Magical Realism",
  "Gay and Lesbian",
  "Graphic Novels",
  "Historical Fiction",
  "History",
  "Horror",
  "Humor and Comedy",
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
  "Suspense" /* intentionally omitted in parser: see below */,
  "Spirituality",
  "Sports",
  "Thriller",
  "Travel",
  "Summer",
  "Young Adult",
];

// We halen Suspense uit de daadwerkelijke allowlist zoals gevraagd.
const EFFECTIVE_ALLOWLIST = GOODREADS_CLIPBOARD_ALLOWLIST.filter(
  (g) => g !== "Suspense"
);

const ALLOWLIST_LOWER_SET = new Set(EFFECTIVE_ALLOWLIST.map((s) => s.toLowerCase()));

const EXPLICIT_OUTPUT_BY_LOWER: Record<string, string> = {
  // Niet vertalen
  "chick lit": "Chick Lit",
  crime: "Crime",
  "dark romance": "Dark Romance",
  fantasy: "Fantasy",
  manga: "Manga",
  mystery: "Mystery",
  "science fiction": "Science Fiction",
  thriller: "Thriller",
  "young adult": "Young Adult",

  // Speciale vertalingen
  "humor and comedy": "Humor en Comedy",
  romance: "Roman",
};

function normalizeFromClipboard(text: string): string {
  const withoutPrefix = text
    .replace(/^\s*Genres\s*:\s*/i, "")
    .replace(/^\s*Genre\s*:\s*/i, "");

  let normalized = withoutPrefix
    .replace(/[•●·]+/g, ",")
    .replace(/[\r\n]+/g, ",")
    .replace(/[;|]+/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s*,\s*/g, ",")
    .trim();

  // plakfouten als "FictionFantasy" of "Young AdultScience Fiction"
  normalized = normalized.replace(/([a-z])([A-Z])/g, "$1,$2").trim();

  return normalized;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Match = { label: string; start: number; end: number; len: number };

// Parseert clipboard-tekst naar allowlist labels (Engels), in volgorde van links naar rechts.
export function parseGoodreadsClipboardTextToAllowlistLabels(
  text: string
): string[] {
  const raw = text.trim();
  if (!raw) return [];

  const normalized = normalizeFromClipboard(raw);

  // 1) Eerst poging: gebruik comma-delimiters (parseGenresPreserveOrder).
  const parsedAll = parseGenresPreserveOrder(normalized)
    .map((g) => g.trim())
    .filter((g) => g.length > 1);

  const allowedFromDelimiters = parsedAll.filter((g) =>
    ALLOWLIST_LOWER_SET.has(g.toLowerCase())
  );
  if (allowedFromDelimiters.length > 0) {
    return allowedFromDelimiters;
  }

  // 2) Fallback: substring-matches als het als één lange tekst is geplakt.
  const lower = normalized.toLowerCase();
  const candidates = [...EFFECTIVE_ALLOWLIST].sort((a, b) => b.length - a.length);

  const matches: Match[] = [];
  for (const label of candidates) {
    const re = new RegExp(escapeRegExp(label), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) {
      const start = m.index;
      const end = start + m[0].length;

      const before = start === 0 ? "" : lower[start - 1];
      const after = end >= lower.length ? "" : lower[end];
      const beforeOk = start === 0 || !/[a-z]/i.test(before);
      const afterOk = end >= lower.length || !/[a-z]/i.test(after);
      if (!beforeOk || !afterOk) continue;

      matches.push({ label, start, end, len: label.length });
      if (matches.length > 120) break;
    }
    if (matches.length > 120) break;
  }

  matches.sort((a, b) => a.start - b.start || b.len - a.len);

  const accepted: Match[] = [];
  const rangesOverlap = (a: Match, b: Match) =>
    Math.max(a.start, b.start) < Math.min(a.end, b.end);

  for (const m of matches) {
    if (accepted.some((a) => rangesOverlap(a, m))) continue;
    if (accepted.some((a) => a.label.toLowerCase() === m.label.toLowerCase())) continue;
    accepted.push(m);
    if (accepted.length >= 18) break;
  }

  accepted.sort((a, b) => a.start - b.start);
  return accepted.map((m) => m.label);
}

function mapAllowlistLabelToPillLabel(label: string): string | null {
  const lower = label.trim().toLowerCase();
  if (!ALLOWLIST_LOWER_SET.has(lower)) return null;

  const explicit = EXPLICIT_OUTPUT_BY_LOWER[lower];
  if (explicit) return explicit;

  return translateGenreToDutch(label);
}

// Hoofdfunctie: klembord -> opgeschoonde, vertaald/gesorteerd pills.
export function parseGoodreadsClipboardTextToPillLabels(text: string): string[] {
  const labels = parseGoodreadsClipboardTextToAllowlistLabels(text);
  if (labels.length === 0) return [];

  const mapped = labels
    .map((l) => mapAllowlistLabelToPillLabel(l))
    .filter((x): x is string => Boolean(x));

  // Dedup + behoud volgorde
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const g of mapped) {
    const k = g.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(g.trim());
  }

  // Rule (ordering in pills):
  // - "Young Adult" net voor "Fictie"
  // - ze mogen niet als eerste komen, tenzij er geen andere genres zijn.
  const fictionLowerSet = new Set(["fictie", "fiction"]);
  const youngAdultLowerSet = new Set(["young adult", "jong volwassenen"]);

  const isFiction = (x: string) => fictionLowerSet.has(x.trim().toLowerCase());
  const isYoungAdult = (x: string) => youngAdultLowerSet.has(x.trim().toLowerCase());

  const fictionLabels = deduped.filter(isFiction);
  const specialLabels = deduped.filter(isYoungAdult);
  const others = deduped.filter((x) => !isFiction(x) && !isYoungAdult(x));

  if (fictionLabels.length > 0) return [...others, ...specialLabels, ...fictionLabels];
  return [...others, ...specialLabels];
}


import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useInstantData, saveBooks, saveShelves } from "../storage";
import { Book, ReadStatus, Shelf } from "../types";
import { RatingStars } from "../components/RatingStars";
import { useBasePath, withBase } from "../routing";
import { parseGenres, parseGenresPreserveOrder } from "../genreUtils";
import { fetchBookGenresFromEdge } from "../fetchBookGenresFromEdge";
import { translateGenreToDutch } from "../genreTranslations";
import { parseGoodreadsClipboardTextToPillLabels } from "../goodreadsClipboardGenres";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Numerieke hex-entiteiten: &#xa0; &#x2019; etc.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code === 160 ? " " : String.fromCodePoint(code);
    })
    // Numerieke decimale entiteiten: &#160; &#8217; etc.
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return code === 160 ? " " : String.fromCodePoint(code);
    })
    // Benoemde entiteiten
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const GOODREADS_GENRE_CLIPBOARD_ALLOWLIST: readonly string[] = [
  "Art",
  "Autobiography",
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
  "Dark Romance",
  "Erotica",
  "Fantasy",
  "Fiction",
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
  "Science Fiction",
  "Science",
  "Self Help",
  "Spirituality",
  "Sports",
  "Thriller",
  "Travel",
  "Young Adult",
];

const GOODREADS_GENRE_CLIPBOARD_OUTPUT_BY_LOWER: Record<string, string> = {
  // Niet vertalen: exact label (zoals in allowlist)
  "chick lit": "Chick Lit",
  crime: "Crime",
  "dark romance": "Dark Romance",
  erotica: translateGenreToDutch("Erotica"), // wél vertalen (niet gemarkeerd als niet-vertalen)
  fantasy: "Fantasy",
  manga: "Manga",
  mystery: "Mystery",
  "science fiction": "Science Fiction",
  "thriller": "Thriller",
  "young adult": "Young Adult",

  // Vertalen specifiek zoals opgegeven
  "humor and comedy": "Humor en Comedy",
  romance: "Roman",

  // Voor alle overige allowlist items: vertaal met standaard mapping
};

const GOODREADS_GENRE_CLIPBOARD_ALLOWLIST_LOWER_SET = new Set(
  GOODREADS_GENRE_CLIPBOARD_ALLOWLIST.map((s) => s.toLowerCase())
);

function mapClipboardGenreToPillLabel(clipboardLabel: string): string | null {
  const label = clipboardLabel.trim();
  if (!label) return null;
  const lower = label.toLowerCase();
  if (!GOODREADS_GENRE_CLIPBOARD_ALLOWLIST_LOWER_SET.has(lower)) return null;

  // Niet/anders vertalen waar opgegeven.
  const explicit = GOODREADS_GENRE_CLIPBOARD_OUTPUT_BY_LOWER[lower];
  if (explicit) return explicit;

  // Overige allowlist: vertaal naar NL.
  return translateGenreToDutch(label);
}

const STATUS_LABELS: Record<ReadStatus, string> = {
  "wil-ik-lezen": "Wil ik lezen",
  "aan-het-lezen": "Aan het lezen",
  gelezen: "Gelezen",
  "geen-status": "Geen status"
};

export interface BookDetailPageProps {
  /** In modus pop-up: boek-id en callback om te sluiten */
  modalBookId?: string;
  onClose?: () => void;
}

export function BookDetailPage({ modalBookId, onClose }: BookDetailPageProps = {}) {
  const { id: routeId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const basePath = useBasePath();
  const { books, shelves } = useInstantData();

  function safeDecodeURIComponent(v: string | undefined): string | undefined {
    if (v == null) return undefined;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }

  const decodedRouteId = safeDecodeURIComponent(routeId);
  const id = modalBookId ?? decodedRouteId;
  const isModal = Boolean(modalBookId && onClose);
  const search = new URLSearchParams(location.search);
  const from = search.get("from");
  const fromShelfId = search.get("shelfId");

  function navigateBack() {
    if (isModal) {
      onClose?.();
      return;
    }
    if (from === "bibliotheek") {
      navigate(withBase(basePath, "/bibliotheek"));
    } else if (from === "boeken") {
      navigate(withBase(basePath, "/boeken"));
    } else if (from === "boekenkast" && fromShelfId) {
      navigate(withBase(basePath, `/plank/${fromShelfId}`));
    } else {
      navigate(withBase(basePath, "/boeken"));
    }
  }

  const book = id ? books.find((b) => b.id === id) : undefined;

  const [title, setTitle] = useState(book?.title ?? "");
  const [authors, setAuthors] = useState(book?.authors ?? "");
  const [status, setStatus] = useState<ReadStatus>(book?.status ?? "wil-ik-lezen");
  const [rating, setRating] = useState<number | undefined>(book?.rating);
  const [finishedAt, setFinishedAt] = useState<string>(book?.finishedAt ?? "");
  const [notes, setNotes] = useState<string>(book?.notes ?? "");
  const [showNotes, setShowNotes] = useState<boolean>(!!book?.notes);
  const [showEdit, setShowEdit] = useState<boolean>(false);
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [seriesName, setSeriesName] = useState<string>(book?.seriesName ?? "");
  const [seriesNumber, setSeriesNumber] = useState<string>(
    book?.seriesNumber?.toString() ?? ""
  );
  const [genre, setGenre] = useState<string>(book?.genre ?? "");
  const genreRef = useRef(genre);
  genreRef.current = genre;
  const [genreQuickAdd, setGenreQuickAdd] = useState<string>("");
  const [activeGenreSuggestionIndex, setActiveGenreSuggestionIndex] = useState<number>(-1);
  const [order, setOrder] = useState<string>(
    book?.order?.toString() ?? ""
  );
  const [pageCount, setPageCount] = useState<string>(
    book?.pageCount != null ? book.pageCount.toString() : ""
  );
  const [coverUrl, setCoverUrl] = useState<string>(book?.coverUrl ?? "");
  const [description, setDescription] = useState<string>(book?.description ?? "");
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [isFetchingGoodreadsGenres, setIsFetchingGoodreadsGenres] = useState(false);
  const [goodreadsPasteNotice, setGoodreadsPasteNotice] = useState<string | null>(null);
  const [goodreadsPasteNoticeIsSuccess, setGoodreadsPasteNoticeIsSuccess] =
    useState<boolean>(false);
  const goodreadsPasteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [goodreadsPasteInputText, setGoodreadsPasteInputText] = useState<string>("");

  // Haal alle unieke serie namen op
  const existingSeries = useMemo(() => {
    const seriesSet = new Set<string>();
    books.forEach((b) => {
      if (b.seriesName) {
        seriesSet.add(b.seriesName);
      }
    });
    return Array.from(seriesSet).sort();
  }, [books]);

  const existingGenres = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      parseGenres(b.genre).forEach((g) => set.add(g));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "nl-NL"));
  }, [books]);

  function reorderManualGenresForYAAndFiction(labels: string[]): string[] {
    const blockedLowerSet = new Set(["hedendaags", "contemporary"]);
    const youngAdultLowerSet = new Set(["young adult", "jong volwassenen"]);
    const fictionLowerSet = new Set(["fictie", "fiction"]);

    const filtered = labels.filter((g) => {
      const trimmed = g.trim();
      if (!trimmed) return false;
      return !blockedLowerSet.has(trimmed.toLowerCase());
    });

    const others: string[] = [];
    const youngAdult: string[] = [];
    const fiction: string[] = [];

    for (const g of filtered) {
      const lower = g.trim().toLowerCase();
      if (youngAdultLowerSet.has(lower)) {
        youngAdult.push(g);
      } else if (fictionLowerSet.has(lower)) {
        fiction.push(g);
      } else {
        others.push(g);
      }
    }

    return [...others, ...youngAdult, ...fiction];
  }

  const selectedGenres = useMemo(
    () => reorderManualGenresForYAAndFiction(parseGenresPreserveOrder(genre)),
    [genre]
  );
  const selectedGenreSet = useMemo(() => new Set(selectedGenres), [selectedGenres]);
  const selectedGenreLowerSet = useMemo(
    () => new Set(selectedGenres.map((g) => g.toLowerCase())),
    [selectedGenres]
  );

  const genrePillsForSelect = selectedGenres;

  const genreQuickAddTrim = genreQuickAdd.trim();
  const genreQuickAddLower = genreQuickAddTrim.toLowerCase();

  const genreQuickAddSuggestions = useMemo(() => {
    if (!genreQuickAddLower) return [];
    return existingGenres
      .filter((g) => !selectedGenreLowerSet.has(g.toLowerCase()))
      .filter((g) => g.toLowerCase().includes(genreQuickAddLower))
      .slice(0, 8);
  }, [existingGenres, genreQuickAddLower, selectedGenreLowerSet]);

  const genreExactExisting = useMemo(() => {
    if (!genreQuickAddLower) return null;
    return existingGenres.find((g) => g.toLowerCase() === genreQuickAddLower) ?? null;
  }, [existingGenres, genreQuickAddLower]);

  const canAddNewGenre = useMemo(() => {
    if (!genreQuickAddTrim) return false;
    if (selectedGenreLowerSet.has(genreQuickAddLower)) return false;
    return !genreExactExisting;
  }, [genreQuickAddTrim, genreQuickAddLower, selectedGenreLowerSet, genreExactExisting]);

  const genreDropdownItems = useMemo(() => {
    const items = genreQuickAddSuggestions.map((g) => ({
      key: `s:${g.toLowerCase()}`,
      label: g,
      value: g
    }));
    if (canAddNewGenre) {
      items.push({
        key: `n:${genreQuickAddTrim.toLowerCase()}`,
        label: `+ ${genreQuickAddTrim}`,
        value: genreQuickAddTrim
      });
    }
    return items;
  }, [genreQuickAddSuggestions, canAddNewGenre, genreQuickAddTrim]);

  function addGenreFromResolved(resolvedGenre: string) {
    const resolved = resolvedGenre.trim();
    if (!resolved) return;

    const resolvedLower = resolved.toLowerCase();
    if (selectedGenreLowerSet.has(resolvedLower)) return;

    const current = selectedGenres;
    if (current.length === 0) {
      setGenre(resolved);
      updateBook({ genre: resolved });
      setGenreQuickAdd("");
      return;
    }

    // Re-order so manual genres are always before Young Adult / Fictie.
    const ordered = [...current, resolved];
    const finalGenre = reorderManualGenresForYAAndFiction(ordered).join(", ");
    setGenre(finalGenre);
    updateBook({ genre: finalGenre || undefined });
    setGenreQuickAdd("");
  }

  function removeGenreEverywhere(genreToRemoveRaw: string) {
    const genreToRemove = genreToRemoveRaw.trim();
    if (!genreToRemove) return;
    const targetLower = genreToRemove.toLowerCase();

    if (
      !window.confirm(
        `Weet je zeker dat je genre "${genreToRemove}" uit alle boeken wilt verwijderen?`
      )
    ) {
      return;
    }

    const updated = books.map((b) => {
      if (!b.genre) return b;
      const parts = parseGenresPreserveOrder(b.genre);
      const filtered = parts.filter((p) => p.toLowerCase() !== targetLower);
      if (filtered.length === parts.length) return b;
      return { ...b, genre: filtered.length ? filtered.join(", ") : undefined };
    });

    persist(updated);

    const nextSelected = parseGenresPreserveOrder(genre).filter(
      (p) => p.toLowerCase() !== targetLower
    );
    const nextValue = reorderManualGenresForYAAndFiction(nextSelected).join(", ");
    setGenre(nextValue);
    updateBook({ genre: nextValue || undefined });
    setGenreQuickAdd("");
  }

  const bookPlanks = useMemo(() => {
    const ids = book?.shelfIds ?? [];
    return ids
      .map((shelfId) => shelves.find((s) => s.id === shelfId))
      .filter((s): s is NonNullable<typeof s> => s != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book?.shelfIds, shelves]);

  const standardShelvesToAdd = useMemo(
    () =>
      shelves
        .filter((s: Shelf) => s.system && !(book?.shelfIds ?? []).includes(s.id))
        .sort((a, b) => a.name.localeCompare(b.name, "nl-NL")),
    [shelves, book?.shelfIds]
  );
  const customShelvesToAdd = useMemo(
    () =>
      shelves
        .filter((s: Shelf) => !s.system && !(book?.shelfIds ?? []).includes(s.id))
        .sort((a, b) => a.name.localeCompare(b.name, "nl-NL")),
    [shelves, book?.shelfIds]
  );
  const shelvesToAdd = useMemo(
    () => [...standardShelvesToAdd, ...customShelvesToAdd],
    [standardShelvesToAdd, customShelvesToAdd]
  );

  function persist(updatedBooks: Book[]) {
    saveBooks(updatedBooks);
  }

  function updateBook(updates: Partial<Book>) {
    if (!book) return;
    const updated = books.map((b) => (b.id === book.id ? { ...b, ...updates } : b));
    persist(updated);
    if (updates.status !== undefined) setStatus(updates.status);
  }

  function parseGoodreadsGenresClipboardText(text: string): string[] {
    const raw = text.trim();
    if (!raw) return [];

    // Vaak: "Genres: Fiction, Fantasy, ..." of alleen de lijst.
    const withoutPrefix = raw
      .replace(/^\s*Genres\s*:\s*/i, "")
      .replace(/^\s*Genre\s*:\s*/i, "");

    // 1) Normaliseer scheidingstekens (komma is het enige waar parseGenresPreserveOrder op werkt).
    let normalized = withoutPrefix
      .replace(/[•●·]+/g, ",")
      .replace(/[\r\n]+/g, ",")
      .replace(/[;|]+/g, ",")
      .replace(/,\s*,/g, ",")
      .replace(/\s*,\s*/g, ",")
      .trim();

    // Soms komt het als "FictionFantasy" (plakfout) of "Young AdultScience Fiction".
    normalized = normalized.replace(/([a-z])([A-Z])/g, "$1,$2").trim();

    const parsedAll = parseGenresPreserveOrder(normalized)
      .map((g) => g.trim())
      .filter((g) => g.length > 1 && !/^genres?$/i.test(g));

    // Filter: we willen alleen de opgegeven genres als (automatische) pills tonen.
    const allowedFromDelimiters = parsedAll.filter((g) =>
      GOODREADS_GENRE_CLIPBOARD_ALLOWLIST_LOWER_SET.has(g.toLowerCase())
    );
    if (allowedFromDelimiters.length > 0) return allowedFromDelimiters;

    // 2) Fallback: plak kan alles als 1 lange tekst geven zonder delimiters.
    // We zoeken dan alleen de opgegeven clipboard-genres terug als substrings (langste eerst),
    // en verwijderen overlappende matches (bv. "Historical Fiction" wint van "Fiction").
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lower = normalized.toLowerCase();

    const candidates = [...GOODREADS_GENRE_CLIPBOARD_ALLOWLIST]
      .sort((a, b) => b.length - a.length)
      .map((label) => ({ label, re: new RegExp(escapeRegExp(label), "gi") }));

    type Match = { label: string; start: number; end: number; len: number };
    const matches: Match[] = [];

    for (const c of candidates) {
      let m: RegExpExecArray | null;
      while ((m = c.re.exec(lower))) {
        const start = m.index;
        const end = start + m[0].length;
        const before = start === 0 ? "" : lower[start - 1];
        const after = end >= lower.length ? "" : lower[end];
        const beforeOk = start === 0 || !/[a-z]/i.test(before);
        const afterOk = end >= lower.length || !/[a-z]/i.test(after);
        if (!beforeOk || !afterOk) continue;
        matches.push({ label: c.label, start, end, len: c.label.length });

        // Veiligheidsstop: voorkom extreem veel matches.
        if (matches.length > 120) break;
      }
      if (matches.length > 120) break;
    }

    // Sorteer: eerst links, bij zelfde positie: langste eerst.
    matches.sort((a, b) => a.start - b.start || b.len - a.len);

    const accepted: Match[] = [];
    const rangesOverlap = (a: Match, b: Match) =>
      Math.max(a.start, b.start) < Math.min(a.end, b.end);

    for (const m of matches) {
      if (accepted.some((a) => rangesOverlap(a, m))) continue;
      // Dedupe op label: behoud de eerste (meest links / langst)
      if (accepted.some((a) => a.label.toLowerCase() === m.label.toLowerCase())) continue;
      accepted.push(m);
      if (accepted.length >= 18) break;
    }

    accepted.sort((a, b) => a.start - b.start);
    const parsedFromMatches = accepted.map((m) => m.label);
    if (parsedFromMatches.length > 0) return parsedFromMatches;

    // 3) Laatste fallback: split op dubbele spaties en probeer opnieuw.
    const parts = normalized
      .split(/\s{2,}/g)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      const partsParsed = parseGenresPreserveOrder(parts.join(", ")).filter(
        (g) => g.length > 1 && GOODREADS_GENRE_CLIPBOARD_ALLOWLIST_LOWER_SET.has(g.toLowerCase())
      );
      if (partsParsed.length > 0) return partsParsed;
    }

    return [];
  }

  async function handlePasteGoodreadsGenresFromClipboard() {
    setGoodreadsPasteNotice(null);
    setGoodreadsPasteNoticeIsSuccess(false);

    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setGoodreadsPasteNotice(
        "Plakken uit klembord lukt niet in deze browser. Kopieer de genres op Goodreads en plak ze handmatig."
      );
      setGoodreadsPasteNoticeIsSuccess(false);
      window.setTimeout(() => setGoodreadsPasteNotice(null), 6500);
      return;
    }

    setIsFetchingGoodreadsGenres(true);
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseGoodreadsGenresClipboardText(text);
      if (parsed.length === 0) {
        throw new Error("Geen genres gevonden in je klembordtekst.");
      }

      const mapped = parsed
        .map((g) => mapClipboardGenreToPillLabel(g))
        .filter((x): x is string => Boolean(x));

      if (mapped.length === 0) {
        throw new Error(
          "Geen genres uit je klembordmatch met de toegestane lijst. Controleer of je de juiste labels kopieert."
        );
      }

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
      // - "Young Adult" + "Hedendaags" net voor "Fictie"
      // - ze mogen niet als eerste komen, tenzij er geen andere genres zijn.
      const fictionLower = "fictie";
      const hedendaagsLower = "hedendaags";
      const youngAdultLower = "young adult";

      const isFiction = (x: string) => x.trim().toLowerCase() === fictionLower;
      const isHedendaags = (x: string) => x.trim().toLowerCase() === hedendaagsLower;
      const isYoungAdult = (x: string) => x.trim().toLowerCase() === youngAdultLower;

      const fictionLabels = deduped.filter(isFiction);
      const specialLabels = deduped.filter((x) => isHedendaags(x) || isYoungAdult(x));
      const others = deduped.filter((x) => !isFiction(x) && !isHedendaags(x) && !isYoungAdult(x));

      const ordered =
        fictionLabels.length > 0
          ? [...others, ...specialLabels, ...fictionLabels]
          : [...others, ...specialLabels];

      const final = ordered.join(", ");
      setGenre(final);
      setGenreQuickAdd("");
      setActiveGenreSuggestionIndex(-1);
      updateBook({ genre: final || undefined });

      setGoodreadsPasteNotice("Goodreads genres geplakt en opgeslagen.");
      setGoodreadsPasteNoticeIsSuccess(true);
      window.setTimeout(() => setGoodreadsPasteNotice(null), 3200);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Onbekende fout";
      setGoodreadsPasteNotice(`Plakken lukt niet: ${detail}`);
      setGoodreadsPasteNoticeIsSuccess(false);
      window.setTimeout(() => setGoodreadsPasteNotice(null), 6500);
    } finally {
      setIsFetchingGoodreadsGenres(false);
    }
  }

  if (!book) {
    return (
      <div className="page">
        <h1>Boek niet gevonden</h1>
        <p>Dit boek bestaat niet (meer) in je bibliotheek.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={navigateBack}
        >
          Terug naar overzicht
        </button>
      </div>
    );
  }

  function deleteSeriesEverywhere(rawName: string) {
    const name = rawName.trim();
    if (!name) return;
    if (
      !window.confirm(
        `Weet je zeker dat je de serie "${name}" bij alle boeken wilt verwijderen?`
      )
    ) {
      return;
    }
    const updated = books.map((b) =>
      (b.seriesName ?? "").trim() === name
        ? { ...b, seriesName: undefined, seriesNumber: undefined }
        : b
    );
    persist(updated);
    if (book && (book.seriesName ?? "").trim() === name) {
      setSeriesName("");
      setSeriesNumber("");
    }
  }

  function getGoodreadsSearchUrl(t?: string, a?: string): string | null {
    const title = t?.trim();
    const authors = a?.trim();
    if (!title && !authors) return null;
    const q = [title, authors].filter(Boolean).join(" ");
    return `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
  }

  function openInAdjacentWindow(url: string) {
    const width = Math.min(1100, Math.max(700, window.outerWidth - 80));
    const height = Math.min(900, Math.max(650, window.outerHeight - 120));
    const gap = 40; // ruimte tussen boektracker en het hulpvenster

    // Schat beschikbaar ruimte links/rechts van dit venster op (werkt meestal goed op één monitor).
    const appLeft = window.screenX ?? window.screenLeft ?? 0;
    const appTop = window.screenY ?? window.screenTop ?? 0;
    const screenLeft = window.screenLeft ?? window.screenX ?? 0;
    const screenTop = window.screenTop ?? window.screenY ?? 0;
    const screenWidth = window.screen.width ?? 1920;
    const screenHeight = window.screen.height ?? 1080;
    const appRight = appLeft + window.outerWidth;
    const screenRight = screenLeft + screenWidth;

    const leftSpace = appLeft - screenLeft;
    const rightSpace = screenRight - appRight;

    const fitsLeft = leftSpace >= width + gap;
    const fitsRight = rightSpace >= width + gap;

    const left = fitsLeft
      ? appLeft - width - gap
      : fitsRight
        ? appRight + gap
        : Math.max(screenLeft, Math.min(appLeft - width - gap, screenRight - width));

    const clampedTop = Math.max(
      screenTop,
      Math.min(appTop + 30, screenTop + screenHeight - height)
    );

    const features = `popup=true,resizable=yes,width=${Math.round(width)},height=${Math.round(height)},left=${Math.round(
      left
    )},top=${Math.round(clampedTop)}`;

    const w = window.open(url, "book_lookup_shared", features);
    w?.focus?.();
    return w;
  }

  function handleStatusChange(newStatus: ReadStatus) {
    setStatus(newStatus);
    if (!book) return;
    const updates: Partial<Book> = { status: newStatus };
    if (newStatus === "gelezen" && !finishedAt) {
      const today = new Date();
      updates.finishedAt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      setFinishedAt(updates.finishedAt);
    }
    updateBook(updates);
  }

  function addBookToPlank(shelfId: string) {
    if (!book) return;
    const shelfIds = [...(book.shelfIds ?? []), shelfId];
    updateBook({ shelfIds });
  }

  function removeBookFromPlank(shelfId: string) {
    if (!book) return;
    const shelfIds = (book.shelfIds ?? []).filter((id) => id !== shelfId);
    updateBook({ shelfIds: shelfIds.length ? shelfIds : undefined });
  }

  function createShelfAndAddToBook(rawName: string) {
    const name = rawName.trim();
    if (!name) return;

    const lower = name.toLowerCase();
    const exists = shelves.find((s) => s.name.trim().toLowerCase() === lower);
    if (exists) {
      addBookToPlank(exists.id);
      return;
    }

    const created: Shelf = { id: `shelf-${Date.now()}`, name };
    const next = [...shelves, created];
    saveShelves(next);
    addBookToPlank(created.id);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Extra safeguard voor TypeScript: in de UI kunnen we hier alleen komen als er een boek is,
    // maar deze check voorkomt dat 'book' als mogelijk undefined wordt gezien.
    if (!book) {
      return;
    }
    const finalSeriesName = seriesName.trim() || undefined;
    const finalGenre = selectedGenres.join(", ");
    const updatedBooks = books.map((b) =>
      b.id === book.id
        ? {
            ...b,
            title: title.trim() || b.title,
            authors: authors.trim(),
            status,
            rating,
            finishedAt: finishedAt || undefined,
            notes: notes.trim() || undefined,
            seriesName: finalSeriesName,
            seriesNumber: finalSeriesName && seriesNumber ? Number(seriesNumber) : undefined,
            genre: finalGenre || undefined,
            order: !finalSeriesName && order ? Number(order) : undefined,
            coverUrl: coverUrl.trim() || undefined,
            description: description.trim() || undefined,
            pageCount: pageCount ? Number(pageCount) || undefined : undefined
          }
        : b
    );
    persist(updatedBooks);
    navigateBack();
  }

  const STATUS_COLORS: Record<ReadStatus, string> = {
    "wil-ik-lezen": "bd-status--tbr",
    "aan-het-lezen": "bd-status--reading",
    "gelezen": "bd-status--read",
    "geen-status": "bd-status--none",
  };

  return (
    <div className={`page bd-page ${isModal ? "book-detail-modal-content" : ""}`}>

      {/* ─── Navigatie ──────────────────────────────────────────────── */}
      <div className="bd-nav">
        <button type="button" className="bd-back-btn" onClick={navigateBack}>
          ← {isModal ? "Sluiten" : "Terug"}
        </button>
      </div>

      {/* ─── Kaart 1: cover + info + status + rating ────────────────── */}
      <div className="card bd-main-card">
        <div className="bd-hero">
          <div className="bd-hero-cover-wrap">
            {coverUrl ? (
              <img src={coverUrl} alt={title} className="bd-hero-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="bd-hero-cover-placeholder">📖</div>
            )}
          </div>
          <div className="bd-hero-info">
            {seriesName && (
              <div className="book-series-badge bd-hero-series">
                {seriesName}{seriesNumber && ` #${seriesNumber}`}
              </div>
            )}
            <h1 className="bd-hero-title">{title || "Geen titel"}</h1>
            <div className="bd-hero-authors">
              {authors
                ? authors.split(",").map((a, i, arr) => {
                    const name = a.trim();
                    return (
                      <span key={name}>
                        <button
                          type="button"
                          className="bd-author-filter-btn"
                          onClick={() => {
                            try { sessionStorage.setItem("bt_lib_author", name); } catch { /* ignore */ }
                            navigate(withBase(basePath, "/bibliotheek"));
                          }}
                          title={`Filter op ${name}`}
                        >
                          {name}
                        </button>
                        {i < arr.length - 1 && <span className="bd-author-sep">, </span>}
                      </span>
                    );
                  })
                : <span>Onbekende auteur</span>}
            </div>
            {selectedGenres.length > 0 && (
              <div className="bd-hero-genres">
                {selectedGenres.map((g) => <span key={g} className="bd-genre-chip">{g}</span>)}
              </div>
            )}
          </div>
        </div>

        <div className="bd-card-divider" />

        {/* Status */}
        <div className="bd-status-pills">
          {(Object.entries(STATUS_LABELS) as [ReadStatus, string][]).map(([value, label]) => (
            <button key={value} type="button"
              className={`bd-status-pill ${STATUS_COLORS[value]} ${status === value ? "bd-status-pill--active" : ""}`}
              onClick={() => handleStatusChange(value)}>
              {label}
            </button>
          ))}
        </div>

        {/* Rating */}
        <div className="bd-quick-row">
          <span className="bd-quick-label">Beoordeling</span>
          <RatingStars value={rating} onChange={(val) => { setRating(val); updateBook({ rating: val }); }} />
        </div>

        {/* Datum alleen bij gelezen */}
        {status === "gelezen" && (
          <div className="bd-quick-row">
            <span className="bd-quick-label">Uitgelezen op</span>
            <input type="date" value={finishedAt}
              onChange={(e) => { setFinishedAt(e.target.value); updateBook({ finishedAt: e.target.value || undefined }); }}
              className="bd-form-input bd-date-input" />
          </div>
        )}
      </div>

      {/* ─── Rij: verzamelingen + samenvatting naast elkaar ─────────── */}
      <div className="bd-two-col">

        {/* Verzamelingen */}
        <div className="card bd-subsection">
          <span className="bd-section-title">Verzamelingen</span>
          <div className="bd-collections-row">
            {bookPlanks.map((shelf) => (
              <span key={shelf.id} className="plank-pill">
                <Link to={withBase(basePath, `/plank/${shelf.id}`)} className="plank-pill-link">{shelf.name}</Link>
                <button type="button" className="plank-pill-remove"
                  aria-label={`Verwijder van verzameling ${shelf.name}`}
                  onClick={() => removeBookFromPlank(shelf.id)}>×</button>
              </span>
            ))}
            {bookPlanks.length === 0 && <span className="bd-section-empty">Geen verzamelingen.</span>}
          </div>
          {shelvesToAdd.length > 0 && (
            <select className="bd-add-collection-select" value=""
              onChange={(e) => {
                const shelfId = e.target.value;
                if (!shelfId) return;
                if (shelfId === "__new__") {
                  const typed = window.prompt("Nieuwe verzameling naam:", "")?.trim() ?? "";
                  if (typed) createShelfAndAddToBook(typed);
                  e.target.value = "";
                  return;
                }
                addBookToPlank(shelfId);
                e.target.value = "";
              }}
              aria-label="Toevoegen aan verzameling">
              <option value="">+ Toevoegen aan verzameling</option>
              <option value="__new__">+ Nieuwe verzameling…</option>
              {customShelvesToAdd.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>

        {/* Samenvatting — rechterkolom, alleen als ingeklapt */}
        {!showSummary && (
          <div className="card bd-subsection bd-collapsible">
            <button type="button" className="bd-collapse-toggle" onClick={() => description && setShowSummary(true)}>
              <span className="bd-section-title">Samenvatting</span>
              {description && <span className="bd-collapse-icon">▼</span>}
            </button>
          {description ? (
            <p className="bd-summary-preview">{stripHtml(description)}</p>
          ) : (
            <span className="bd-section-empty">Geen samenvatting.</span>
          )}
          </div>
        )}

      </div>

      {/* Samenvatting uitgevouwen — volledige breedte, verplaatst naar hier */}
      {showSummary && description && (
        <div className="card bd-section bd-collapsible">
          <button type="button" className="bd-collapse-toggle" onClick={() => setShowSummary(false)}>
            <span className="bd-section-title">Samenvatting</span>
            <span className="bd-collapse-icon">▲</span>
          </button>
          <p className="bd-summary-full">{stripHtml(description)}</p>
        </div>
      )}

      {/* ─── Bewerken (inklapbaar) ──────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="card bd-section bd-edit-section bd-collapsible">
        <button type="button" className="bd-collapse-toggle" onClick={() => setShowEdit((v) => !v)}>
          <span className="bd-section-title">Boekgegevens bewerken</span>
          <span className="bd-collapse-icon">{showEdit ? "▲" : "▼"}</span>
        </button>
        {showEdit && <div className="bd-form-grid">
          <div className="bd-form-field">
            <label className="bd-form-label">Titel</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="bd-form-input" />
          </div>
          <div className="bd-form-field">
            <label className="bd-form-label">Auteur(s)</label>
            <input type="text" value={authors} onChange={(e) => setAuthors(e.target.value)} className="bd-form-input" />
          </div>
          <div className="bd-form-field">
            <label className="bd-form-label">Aantal pagina's</label>
            <input type="number" min="1" value={pageCount} onChange={(e) => setPageCount(e.target.value)} className="bd-form-input" placeholder="Bijv. 467" />
          </div>
          <div className="bd-form-field bd-form-field--full">
            <label className="bd-form-label">Serie naam</label>
            <div className="search-input-wrapper">
              <div className="search-input-inner">
                <input
                  type="text"
                  value={seriesName}
                  onChange={(e) => setSeriesName(e.target.value)}
                  placeholder="Bijv. De zeven zussen"
                  className="bd-form-input"
                />
                {seriesName && (
                  <button type="button" className="search-clear-button" onClick={() => setSeriesName("")} aria-label="Serie wissen">×</button>
                )}
              </div>
              {(() => {
                const trimmed = seriesName.trim();
                if (!trimmed) return null;
                const matches = existingSeries.filter((n) => n.toLowerCase().includes(trimmed.toLowerCase()) && n !== trimmed).slice(0, 8);
                if (matches.length === 0) return null;
                return (
                  <div className="search-suggestions">
                    {matches.map((n) => (
                      <div key={n} className="search-suggestion-item" onClick={() => setSeriesName(n)}>
                        <span className="search-suggestion-label">{n}</span>
                        <button type="button" className="search-suggestion-edit" aria-label={`Serie "${n}" bewerken`} onClick={(e) => { e.stopPropagation(); const next = window.prompt("Nieuwe naam:", n)?.trim(); if (!next || next === n) return; if (!window.confirm(`Alle boeken met serie "${n}" hernoemen naar "${next}"?`)) return; persist(books.map((b) => (b.seriesName ?? "").trim() === n ? { ...b, seriesName: next } : b)); if ((book?.seriesName ?? "").trim() === n) setSeriesName(next); }}>✎</button>
                        <button type="button" className="search-suggestion-delete" aria-label={`Serie "${n}" overal verwijderen`} onClick={(e) => { e.stopPropagation(); deleteSeriesEverywhere(n); }}>🗑</button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="bd-form-field">
            <label className="bd-form-label">{seriesName ? "Nummer in serie" : "Volgorde"}</label>
            <input
              type="number"
              value={seriesName ? seriesNumber : order}
              onChange={(e) => { if (seriesName) setSeriesNumber(e.target.value); else setOrder(e.target.value); }}
              placeholder={seriesName ? "Bijv. 0.5" : "Bijv. 1"}
              min="0.1"
              step="any"
              className="bd-form-input"
            />
          </div>
          <div className="bd-form-field bd-form-field--full">
            <label className="bd-form-label">Boekkaft URL</label>
            <input type="url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://example.com/cover.jpg" className="bd-form-input" />
          </div>
          <div className="bd-form-field bd-form-field--full">
            <label className="bd-form-label">Samenvatting</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="bd-textarea" placeholder="Korte samenvatting van het boek…" />
          </div>
        </div>}

        {showEdit && (
          <div className="bd-form-field bd-form-field--full bd-genre-section">
            <label className="bd-form-label">Genre</label>
            <div className="goodreads-genre-actions" style={{ marginBottom: "0.4rem" }}>
              {getGoodreadsSearchUrl(title, authors) && (
                <button type="button" className="link-button" disabled={isFetchingGoodreadsGenres}
                  onClick={() => { const url = getGoodreadsSearchUrl(title, authors); if (!url) return; const opened = openInAdjacentWindow(url); if (!opened) window.open(url, "book_lookup_shared"); }}>
                  Open Goodreads (zoek)
                </button>
              )}
            </div>
            <label className="form-field goodreads-paste-field">
              <span>Goodreads genres (plakken)</span>
              <textarea
                ref={goodreadsPasteTextareaRef}
                className="profile-input goodreads-paste-textarea"
                value={goodreadsPasteInputText}
                onChange={(e) => setGoodreadsPasteInputText(e.target.value)}
                placeholder="Kopieer op Goodreads de regel met Genres en plak hier (Ctrl+V)."
                rows={3}
                spellCheck={false}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text") ?? "";
                  const pillLabels = parseGoodreadsClipboardTextToPillLabels(text);
                  if (pillLabels.length === 0) {
                    setGoodreadsPasteNotice("Geen toegestane genres gevonden. Kopieer de regel 'Genres: ...' uit Goodreads.");
                    setGoodreadsPasteNoticeIsSuccess(false);
                    window.setTimeout(() => setGoodreadsPasteNotice(null), 6500);
                    return;
                  }
                  const finalLabels = reorderManualGenresForYAAndFiction(pillLabels);
                  const joined = finalLabels.join(", ");
                  setGenre(joined);
                  setGoodreadsPasteInputText("");
                  setActiveGenreSuggestionIndex(-1);
                  updateBook({ genre: joined || undefined });
                  setGoodreadsPasteNotice("Goodreads genres geplakt en opgeslagen.");
                  setGoodreadsPasteNoticeIsSuccess(true);
                  window.setTimeout(() => setGoodreadsPasteNotice(null), 3200);
                }}
              />
            </label>
            {goodreadsPasteNotice && (
              <p className={goodreadsPasteNoticeIsSuccess ? "form-success" : "form-error"} role="alert" style={{ marginTop: "0.2rem" }}>
                {goodreadsPasteNotice}
              </p>
            )}
            <div className="genre-pill-container" style={{ marginTop: "0.5rem" }}>
              {genrePillsForSelect.length === 0 ? (
                <span className="page-intro-small">{isFetchingGoodreadsGenres ? "Even geduld…" : "Geen genres. Plak uit Goodreads of voeg handmatig toe."}</span>
              ) : (
                genrePillsForSelect.map((g, idx) => (
                  <button key={`detail-genre-${idx}-${g}`} type="button"
                    className={`genre-pill ${selectedGenreSet.has(g) ? "selected" : ""}`}
                    onClick={() => {
                      const isSelected = selectedGenreSet.has(g);
                      const ordered = isSelected ? selectedGenres.filter((x) => x !== g) : [...selectedGenres, g].filter(Boolean);
                      const finalGenre = reorderManualGenresForYAAndFiction(ordered).join(", ");
                      setGenre(finalGenre);
                      updateBook({ genre: finalGenre || undefined });
                    }}>
                    {g}
                    {selectedGenreSet.has(g) && <span className="genre-pill-x">×</span>}
                    <span className="genre-pill-trash" role="button" tabIndex={0}
                      title={`Verwijder genre "${g}" uit alle boeken`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeGenreEverywhere(g); }}
                      onKeyDown={(e) => { if (e.key !== "Enter" && e.key !== " ") return; e.preventDefault(); e.stopPropagation(); removeGenreEverywhere(g); }}>
                      🗑
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="genre-pill-add-row">
              <div className="search-input-inner">
                <input
                  type="text"
                  value={genreQuickAdd}
                  onChange={(e) => { setGenreQuickAdd(e.target.value); setActiveGenreSuggestionIndex(-1); }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") { if (!genreDropdownItems.length) return; e.preventDefault(); setActiveGenreSuggestionIndex((p) => p < 0 ? 0 : Math.min(p + 1, genreDropdownItems.length - 1)); return; }
                    if (e.key === "ArrowUp") { if (!genreDropdownItems.length) return; e.preventDefault(); setActiveGenreSuggestionIndex((p) => p < 0 ? genreDropdownItems.length - 1 : Math.max(p - 1, 0)); return; }
                    if (e.key === "Escape") { if (activeGenreSuggestionIndex >= 0) { e.preventDefault(); setActiveGenreSuggestionIndex(-1); } return; }
                    if (e.key !== "Enter") return;
                    const v = genreQuickAdd.trim();
                    if (!v) return;
                    e.preventDefault();
                    if (genreDropdownItems.length > 0) {
                      const idx = activeGenreSuggestionIndex >= 0 ? activeGenreSuggestionIndex : 0;
                      addGenreFromResolved(genreDropdownItems[idx]?.value ?? v);
                      setActiveGenreSuggestionIndex(-1);
                      return;
                    }
                    addGenreFromResolved(genreExactExisting ?? v);
                  }}
                  placeholder="Genre toevoegen…"
                  className="search-input search-input-with-clear"
                />
                {genreQuickAdd.trim() && (
                  <button type="button" className="search-clear-button" onClick={() => setGenreQuickAdd("")} aria-label="Wissen">×</button>
                )}
                {genreQuickAddTrim && genreDropdownItems.length > 0 && (
                  <div className="search-suggestions" role="listbox">
                    {genreDropdownItems.map((item, idx) => (
                      <button key={item.key} type="button"
                        className={`search-suggestion-item${idx === activeGenreSuggestionIndex ? " active" : ""}`}
                        onClick={() => { addGenreFromResolved(item.value); setActiveGenreSuggestionIndex(-1); }}
                        role="option">
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="link-button" disabled={!genreQuickAdd.trim()}
                onClick={() => { const v = genreQuickAdd.trim(); if (!v) return; addGenreFromResolved(genreExactExisting ?? genreQuickAddSuggestions[0] ?? v); }}>
                + Voeg toe
              </button>
            </div>
          </div>
        )}

        {showEdit && (
          <div className="bd-form-actions">
            <button type="submit" className="primary-button">Opslaan</button>
            <button type="button" className="secondary-button" onClick={() => (isModal ? onClose?.() : navigate(-1))}>Annuleren</button>
          </div>
        )}
      </form>

      {/* ─── Notities (onder bewerken) ──────────────────────────────── */}
      <div className="card bd-section bd-collapsible">
        <button type="button" className="bd-collapse-toggle" onClick={() => setShowNotes((v) => !v)}>
          <span className="bd-section-title">Notities</span>
          <span className="bd-collapse-icon">{showNotes ? "▲" : "▼"}</span>
        </button>
        {showNotes && (
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            onBlur={() => updateBook({ notes: notes.trim() || undefined })}
            rows={3} className="bd-textarea" placeholder="Persoonlijke notities…" />
        )}
      </div>

      {/* ─── Verwijderen (compact onderaan) ─────────────────────────── */}
      <div className="bd-danger-zone card">
        <button type="button" className="bd-delete-btn" onClick={() => setShowDeleteConfirm(true)}>
          Boek verwijderen
        </button>
      </div>

      {/* ─── Bevestigingsdialoog ─────────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="bd-confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bd-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="bd-confirm-title">Boek verwijderen?</p>
            <p className="bd-confirm-desc">
              <strong>{title}</strong> wordt permanent uit je bibliotheek verwijderd.
            </p>
            <div className="bd-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setShowDeleteConfirm(false)}>
                Annuleren
              </button>
              <button
                type="button"
                className="bd-confirm-delete-btn"
                onClick={() => {
                  const updated = books.filter((b) => b.id !== book.id);
                  saveBooks(updated);
                  navigateBack();
                }}
              >
                Verwijderen
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}


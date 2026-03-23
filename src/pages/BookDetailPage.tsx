import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { loadBooks, loadShelves, saveBooks, subscribeBooks } from "../storage";
import { Book, ReadStatus, Shelf } from "../types";
import { RatingStars } from "../components/RatingStars";
import { useBasePath, withBase } from "../routing";
import { parseGenres, parseGenresPreserveOrder } from "../genreUtils";
import { isSupabaseConfigured, supabase } from "../supabase";
import { translateGenreToDutch } from "../genreTranslations";
import { parseGoodreadsClipboardTextToPillLabels } from "../goodreadsClipboardGenres";

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
  const [books, setBooks] = useState<Book[]>(() => loadBooks());

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

  // Sync books tussen tabs/shells (web ↔ mobile)
  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  const book = id ? books.find((b) => b.id === id) : undefined;

  const [title, setTitle] = useState(book?.title ?? "");
  const [authors, setAuthors] = useState(book?.authors ?? "");
  const [status, setStatus] = useState<ReadStatus>(book?.status ?? "wil-ik-lezen");
  const [rating, setRating] = useState<number | undefined>(book?.rating);
  const [finishedAt, setFinishedAt] = useState<string>(book?.finishedAt ?? "");
  const [notes, setNotes] = useState<string>(book?.notes ?? "");
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

  const selectedGenres = useMemo(() => parseGenresPreserveOrder(genre), [genre]);
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

    // Preserve assignment order: new genre goes to the end, no re-sorting.
    const ordered = [...current, resolved];

    const finalGenre = ordered.join(", ");
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
    const nextValue = nextSelected.join(", ");
    setGenre(nextValue);
    updateBook({ genre: nextValue || undefined });
    setGenreQuickAdd("");
  }

  const shelves = useMemo(() => loadShelves(), []);
  const bookPlanks = useMemo(() => {
    const ids = book?.shelfIds ?? [];
    return ids
      .map((shelfId) => shelves.find((s) => s.id === shelfId))
      .filter((s): s is NonNullable<typeof s> => s != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book?.shelfIds, shelves]);

  function persist(updatedBooks: Book[]) {
    setBooks(updatedBooks);
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
          onClick={() => {
            if (isModal) {
              onClose?.();
            } else if (from === "bibliotheek") {
              navigate(withBase(basePath, "/bibliotheek"));
            } else if (from === "boekenkast" && fromShelfId) {
              navigate(withBase(basePath, `/plank/${fromShelfId}`));
            } else {
              navigate(withBase(basePath, "/boeken"));
            }
          }}
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

  const customShelves = useMemo(
    () => shelves.filter((s: Shelf) => !s.system),
    [shelves]
  );
  const shelvesToAdd = useMemo(
    () => customShelves.filter((s) => !(book?.shelfIds ?? []).includes(s.id)),
    [customShelves, book?.shelfIds]
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Extra safeguard voor TypeScript: in de UI kunnen we hier alleen komen als er een boek is,
    // maar deze check voorkomt dat 'book' als mogelijk undefined wordt gezien.
    if (!book) {
      return;
    }
    const finalSeriesName = seriesName.trim() || undefined;
    const finalGenre = parseGenresPreserveOrder(genre).join(", ");
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
    if (isModal) {
      onClose?.();
    } else if (from === "bibliotheek") {
      navigate(withBase(basePath, "/bibliotheek"));
    } else if (from === "boekenkast" && fromShelfId) {
      navigate(withBase(basePath, `/plank/${fromShelfId}`));
    } else {
      navigate(withBase(basePath, "/boeken"));
    }
  }

  return (
    <div className={`page ${isModal ? "book-detail-modal-content" : ""}`}>
      {isModal && (
        <div className="book-detail-modal-header">
          <button
            type="button"
            className="book-detail-modal-close"
            onClick={onClose}
            aria-label="Sluiten"
          >
            ✕
          </button>
          <h1 className="book-detail-modal-title">Boek aanpassen</h1>
        </div>
      )}
      {!isModal && <h1>Boek aanpassen</h1>}
      <form onSubmit={handleSubmit} className="card form-card book-detail-form">
        <div className="form-field">
          <span>Titel</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="form-field">
          <span>Auteur(s)</span>
          <input
            type="text"
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
          />
        </div>
        <div className="form-field">
          <span>Boekkaft URL (optioneel)</span>
          <input
            type="url"
            value={coverUrl}
            onChange={(e) => setCoverUrl(e.target.value)}
            placeholder="https://example.com/cover.jpg"
          />
        </div>
        {coverUrl && (
          <div className="cover-preview">
            <img
              src={coverUrl}
              alt="Preview"
              className="cover-preview-image"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
        <div className="form-field">
          <span>Status</span>
          <div className="status-dropdown">
            <button
              type="button"
              className={`status-select status-dropdown-trigger status-select-${status}`}
              onClick={() => setShowStatusMenu((v) => !v)}
            >
              {STATUS_LABELS[status]}
              <span className="status-dropdown-caret">▾</span>
            </button>
            {showStatusMenu && (
              <div className="status-dropdown-menu">
                {(Object.entries(STATUS_LABELS) as [ReadStatus, string][])
                  .map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`book-detail-status-pill book-detail-status-pill-${value} ${
                        status === value ? "selected" : ""
                      }`}
                      onClick={() => {
                        handleStatusChange(value);
                        setShowStatusMenu(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
        <div className="form-field">
          <span>Aantal pagina's (optioneel)</span>
          <input
            type="number"
            min="1"
            value={pageCount}
            onChange={(e) => setPageCount(e.target.value)}
            placeholder="Bijv. 467"
          />
        </div>
        <div className="form-field book-detail-planks">
          <span>Boekenkast(en)</span>
          <div className="book-detail-plank-pills">
            {status !== "geen-status" && (
              <span className="plank-pill">
                {STATUS_LABELS[status]}
              </span>
            )}
            {bookPlanks.map((shelf) => (
              <span key={shelf.id} className="plank-pill">
                <Link to={withBase(basePath, `/plank/${shelf.id}`)} className="plank-pill-link">
                  {shelf.name}
                </Link>
                <button
                  type="button"
                  className="plank-pill-remove"
                  aria-label={`Verwijder van boekenkast ${shelf.name}`}
                  onClick={() => removeBookFromPlank(shelf.id)}
                >
                  ×
                </button>
              </span>
            ))}
            {shelvesToAdd.length > 0 && (
              <select
                className="book-detail-add-plank-select"
                value=""
                onChange={(e) => {
                  const shelfId = e.target.value;
                  if (shelfId) {
                    addBookToPlank(shelfId);
                    e.target.value = "";
                  }
                }}
                aria-label="Toevoegen aan boekenkast"
              >
                <option value="">+ Toevoegen aan boekenkast</option>
                {shelvesToAdd.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {bookPlanks.length === 0 && shelvesToAdd.length === 0 && (
            <p className="book-detail-planks-hint">Geen eigen boekenkasten. Maak een boekenkast aan via Boekenkasten.</p>
          )}
        </div>
        <div className="form-field">
          <span>Serie naam (optioneel)</span>
          <div className="search-input-wrapper">
            <div className="search-input-inner">
              <input
                type="text"
                value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)}
                placeholder="Bijv. De zeven zussen"
              />
              {seriesName && (
                <button
                  type="button"
                  className="search-clear-button"
                  onClick={() => setSeriesName("")}
                  aria-label="Serie wissen"
                >
                  ×
                </button>
              )}
            </div>
            {(() => {
              const trimmed = seriesName.trim();
              if (!trimmed) return null;
              const matches = existingSeries
                .filter((name) =>
                  name.toLowerCase().includes(trimmed.toLowerCase())
                )
                .filter((name) => name !== trimmed)
                .slice(0, 8);
              if (matches.length === 0) return null;
              return (
                <div className="search-suggestions">
                  {matches.map((name) => (
                    <div
                      key={name}
                      className="search-suggestion-item"
                      onClick={() => setSeriesName(name)}
                    >
                      <span className="search-suggestion-label">{name}</span>
                      <button
                        type="button"
                        className="search-suggestion-edit"
                        aria-label={`Serienaam "${name}" bewerken`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const current = name;
                          const nextName = window
                            .prompt("Nieuwe naam voor deze serie:", current)
                            ?.trim();
                          if (!nextName || nextName === current) return;
                          if (
                            !window.confirm(
                              `Alle boeken met serie "${current}" hernoemen naar "${nextName}"?`
                            )
                          ) {
                            return;
                          }
                          const updated = books.map((b) =>
                            (b.seriesName ?? "").trim() === current
                              ? { ...b, seriesName: nextName }
                              : b
                          );
                          persist(updated);
                          if ((book?.seriesName ?? "").trim() === current) {
                            setSeriesName(nextName);
                          }
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="search-suggestion-delete"
                        aria-label={`Serie "${name}" overal verwijderen`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSeriesEverywhere(name);
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="form-field">
          <span>
            {seriesName ? "Nummer in serie (optioneel)" : "Volgorde (optioneel)"}
          </span>
          <input
            type="number"
            value={seriesName ? seriesNumber : order}
            onChange={(e) => {
              if (seriesName) {
                setSeriesNumber(e.target.value);
              } else {
                setOrder(e.target.value);
              }
            }}
            placeholder={seriesName ? "Bijv. 1.5" : "Bijv. 1.5"}
            min="1"
            step="any"
          />
        </div>
        <div className="form-field">
          <span>Genre (optioneel)</span>
          <div className="goodreads-genre-actions" style={{ marginBottom: "0.4rem" }}>
            {getGoodreadsSearchUrl(title, authors) && (
              <button
                type="button"
                className="link-button"
                disabled={isFetchingGoodreadsGenres}
                aria-label="Open Goodreads (zoek)"
                onClick={() => {
                  const url = getGoodreadsSearchUrl(title, authors);
                  if (!url) return;
                  const opened = openInAdjacentWindow(url);
                  if (!opened) window.open(url, "book_lookup_shared");
                }}
              >
                Open Goodreads (zoek)
              </button>
            )}
          </div>
          <label className="form-field goodreads-paste-field">
            <span>Goodreads genres (plakken)</span>
            <p className="page-intro-small">
              We lezen enkel de toegestane Goodreads-genres en zetten alleen die als pills (rest wordt genegeerd).
            </p>
            <textarea
              ref={goodreadsPasteTextareaRef}
              className="profile-input goodreads-paste-textarea"
              value={goodreadsPasteInputText}
              onChange={(e) => setGoodreadsPasteInputText(e.target.value)}
              placeholder="Kopieer op Goodreads de regel met Genres (bijv. 'Genres: Fantasy, Fiction, Romance') en plak hier (Ctrl+V)."
              rows={4}
              spellCheck={false}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text") ?? "";
                const pillLabels = parseGoodreadsClipboardTextToPillLabels(text);
                if (pillLabels.length === 0) {
                  setGoodreadsPasteNotice(
                    "Geen toegestane genres gevonden. Kopieer de regel 'Genres: ...' uit Goodreads."
                  );
                  setGoodreadsPasteNoticeIsSuccess(false);
                  window.setTimeout(() => setGoodreadsPasteNotice(null), 6500);
                  return;
                }

                const joined = pillLabels.join(", ");
                setGenre(joined);
                setGoodreadsPasteInputText("");
                setActiveGenreSuggestionIndex(-1);
                updateBook({ genre: joined || undefined });

                setGoodreadsPasteNotice("Goodreads genres geplakt en opgeslagen.");
                setGoodreadsPasteNoticeIsSuccess(true);
                window.setTimeout(() => setGoodreadsPasteNotice(null), 3200);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
                  // Laat onPaste de parsing doen.
                  return;
                }
              }}
            />
          </label>
          {goodreadsPasteNotice ? (
            <p
              className={goodreadsPasteNoticeIsSuccess ? "form-success" : "form-error"}
              role="alert"
              style={{ marginTop: "0.2rem" }}
            >
              {goodreadsPasteNotice}
            </p>
          ) : null}
          <div className="genre-pill-container">
            {genrePillsForSelect.length === 0 ? (
              <span className="page-intro-small">
                {isFetchingGoodreadsGenres
                  ? "Even geduld…"
                  : "Geen genres. Open Goodreads (zoek), kopieer 'Genres: ...' en plak in het tekstveld."}
              </span>
            ) : (
              genrePillsForSelect.map((g, idx) => (
                <button
                  key={`detail-genre-${idx}-${g}`}
                  type="button"
                  className={`genre-pill ${selectedGenreSet.has(g) ? "selected" : ""}`}
                  onClick={() => {
                    const isSelected = selectedGenreSet.has(g);
                    const current = selectedGenres;
                    const ordered = isSelected
                      ? current.filter((x) => x !== g)
                      : [...current, g].filter(Boolean);
                    const finalGenre = ordered.join(", ");
                    setGenre(finalGenre);
                    updateBook({ genre: finalGenre || undefined });
                  }}
                >
                  {g}
                  {selectedGenreSet.has(g) && <span className="genre-pill-x">×</span>}
                  <span
                    className="genre-pill-trash"
                    role="button"
                    tabIndex={0}
                    title={`Verwijder genre "${g}" uit alle boeken`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeGenreEverywhere(g);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      removeGenreEverywhere(g);
                    }}
                  >
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
                onChange={(e) => {
                  setGenreQuickAdd(e.target.value);
                  setActiveGenreSuggestionIndex(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    if (genreDropdownItems.length === 0) return;
                    e.preventDefault();
                    setActiveGenreSuggestionIndex((prev) =>
                      prev < 0 ? 0 : Math.min(prev + 1, genreDropdownItems.length - 1)
                    );
                    return;
                  }

                  if (e.key === "ArrowUp") {
                    if (genreDropdownItems.length === 0) return;
                    e.preventDefault();
                    setActiveGenreSuggestionIndex((prev) =>
                      prev < 0 ? genreDropdownItems.length - 1 : Math.max(prev - 1, 0)
                    );
                    return;
                  }

                  if (e.key === "Escape") {
                    if (activeGenreSuggestionIndex >= 0) {
                      e.preventDefault();
                      setActiveGenreSuggestionIndex(-1);
                    }
                    return;
                  }

                  if (e.key !== "Enter") return;
                  const v = genreQuickAdd.trim();
                  if (!v) return;
                  e.preventDefault();

                  if (genreDropdownItems.length > 0) {
                    const idx =
                      activeGenreSuggestionIndex >= 0
                        ? activeGenreSuggestionIndex
                        : 0;
                    const valueToAdd = genreDropdownItems[idx]?.value ?? v;
                    addGenreFromResolved(valueToAdd);
                    setActiveGenreSuggestionIndex(-1);
                    return;
                  }

                  addGenreFromResolved(genreExactExisting ?? v);
                }}
                placeholder="Nieuwe genre toevoegen (optioneel)"
                className="search-input search-input-with-clear"
              />
              {genreQuickAdd.trim() && (
                <button
                  type="button"
                  className="search-clear-button"
                  onClick={() => setGenreQuickAdd("")}
                  aria-label="Genre input wissen"
                >
                  ×
                </button>
              )}
              {genreQuickAddTrim && genreDropdownItems.length > 0 && (
                <div className="search-suggestions" role="listbox" aria-label="Genre suggesties">
                  {genreDropdownItems.map((item, idx) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`search-suggestion-item${idx === activeGenreSuggestionIndex ? " active" : ""}`}
                      onClick={() => {
                        addGenreFromResolved(item.value);
                        setActiveGenreSuggestionIndex(-1);
                      }}
                      role="option"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="link-button"
              disabled={!genreQuickAdd.trim()}
              onClick={() => {
                const v = genreQuickAdd.trim();
                if (!v) return;
                const resolved = genreExactExisting ?? genreQuickAddSuggestions[0] ?? v;
                addGenreFromResolved(resolved);
              }}
            >
              + Voeg toe
            </button>
          </div>
        </div>
        <div className="form-field">
          <span>Uitgelezen op</span>
          <input
            type="date"
            value={finishedAt}
            onChange={(e) => setFinishedAt(e.target.value)}
          />
        </div>
        <div className="form-field">
          <span>Beoordeling</span>
          <RatingStars value={rating} onChange={setRating} />
        </div>
        <div className="form-field">
          <span>Samenvatting (optioneel)</span>
          {description && (
            <div className="book-detail-summary-preview">
              <p className="book-detail-summary-text">{description}</p>
              <button
                type="button"
                className="book-detail-summary-toggle"
                onClick={(e) => {
                  e.preventDefault();
                  e.currentTarget.parentElement?.classList.toggle("expanded");
                }}
              >
                Alles lezen
              </button>
            </div>
          )}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="notes-textarea"
            placeholder="Korte samenvatting van het boek..."
          />
        </div>
        <div className="form-field">
          <span>Notitie</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="notes-textarea"
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-button">
            Opslaan
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => (isModal ? onClose?.() : navigate(-1))}
          >
            Annuleren
          </button>
        </div>
      </form>
    </div>
  );
}


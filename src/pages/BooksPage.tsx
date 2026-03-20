import { FormEvent, useMemo, useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Book, ReadStatus, Shelf } from "../types";
import { loadBooks, loadChallenge, loadShelves, saveShelves, saveBooks, subscribeBooks, addBookSnapshotsToMyLibrary } from "../storage";
import { RatingStars } from "../components/RatingStars";
import { useBasePath, withBase } from "../routing";
import { formatGenresPreserveOrder, parseGenres, parseGenresPreserveOrder } from "../genreUtils";

interface SearchResult {
  id: string;
  title: string;
  authors: string;
  coverUrl?: string;
  description?: string;
  pageCount?: number;
  /** Open Library 3-letter language codes (e.g. dut, eng) for filtering by language */
  languageCodes?: string[];
}

const STATUS_LABELS: Record<ReadStatus, string> = {
  "wil-ik-lezen": "Wil ik lezen",
  "aan-het-lezen": "Aan het lezen",
  gelezen: "Gelezen",
  "geen-status": "Geen status"
};

/** Language filter for author books modal (Open Library 3-letter code -> label) */
const AUTHOR_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Alle talen" },
  { value: "dut", label: "Nederlands" },
  { value: "eng", label: "English" },
  { value: "ger", label: "Deutsch" },
  { value: "fre", label: "Français" },
];

const GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_SEARCH_API = "https://openlibrary.org/search.json";
const ITUNES_SEARCH_API = "https://itunes.apple.com/search";

const GOOGLE_BOOKS_API_KEY =
  typeof import.meta !== "undefined"
    ? ((import.meta as any).env?.VITE_GOOGLE_BOOKS_API_KEY as string | undefined)
    : undefined;

const ITUNES_COUNTRY =
  typeof import.meta !== "undefined"
    ? (((import.meta as any).env?.VITE_ITUNES_COUNTRY as string | undefined) ?? "NL")
    : "NL";

const GOOGLE_DISABLED_UNTIL_KEY = "bt_google_disabled_until_v1";
const SEARCH_CACHE_LS_KEY = "bt_search_cache_v1";
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagen
const GOOGLE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 uur

type BooksPageMode = "full" | "library" | "search";

const STATUS_BY_SHELF_ID: Record<string, ReadStatus> = {
  "wil-ik-lezen": "wil-ik-lezen",
  "aan-het-lezen": "aan-het-lezen",
  gelezen: "gelezen"
};

export function BooksPage({ mode = "full" }: { mode?: BooksPageMode } = {}) {
  const navigate = useNavigate();
  const basePath = useBasePath();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = (() => {
    const param = searchParams.get("status") as ReadStatus | null;
    if (param === "wil-ik-lezen" || param === "aan-het-lezen" || param === "gelezen" || param === "geen-status") {
      return param;
    }
    return "alle" as const;
  })();
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [searchTitle, setSearchTitle] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAuthorSuggestions, setShowAuthorSuggestions] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReadStatus | "alle">(initialStatus);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchTitleInputRef = useRef<HTMLInputElement>(null);
  const searchAuthorInputRef = useRef<HTMLInputElement>(null);
  const authorSuggestionsContainerRef = useRef<HTMLDivElement>(null);
  const suggestionJustSelectedRef = useRef(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(-1);
  const [activeAuthorSuggestionIndex, setActiveAuthorSuggestionIndex] = useState<number>(-1);
  const [isEnrichingTBR, setIsEnrichingTBR] = useState(false);
  const [searchError, setSearchError] = useState<string>("");
  const [expandedGenreBookId, setExpandedGenreBookId] = useState<string | null>(null);

  useEffect(() => {
    if (!showAuthorSuggestions) return;
    if (activeAuthorSuggestionIndex < 0) return;
    const activeEl = authorSuggestionsContainerRef.current?.querySelector(".author-input-suggestion-item.active") as
      | HTMLElement
      | null;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeAuthorSuggestionIndex, showAuthorSuggestions]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult | null>(null);
  const challenge = useMemo(() => loadChallenge(), []);
  const [showManualBookModal, setShowManualBookModal] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualAuthors, setManualAuthors] = useState("");
  const [manualPageCount, setManualPageCount] = useState("");
  const [manualSeriesName, setManualSeriesName] = useState("");
  const [manualSeriesNumber, setManualSeriesNumber] = useState("");
  const [manualUseCustomSeries, setManualUseCustomSeries] = useState(false);
  const [manualCoverUrl, setManualCoverUrl] = useState("");
  const [manualGenre, setManualGenre] = useState("");
  const [manualGenreQuickAdd, setManualGenreQuickAdd] = useState("");
  const [activeGenreSuggestionIndex, setActiveGenreSuggestionIndex] = useState<number>(-1);
  const [manualShelfIds, setManualShelfIds] = useState<string[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [addToShelfResult, setAddToShelfResult] = useState<SearchResult | null>(null);
  const [showAddToShelfModal, setShowAddToShelfModal] = useState(false);
  const [addToShelfSelectedShelfIds, setAddToShelfSelectedShelfIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string>("");
  const [searchByAuthor, setSearchByAuthor] = useState(false);
  const [authorSearchResults, setAuthorSearchResults] = useState<SearchResult[]>([]);
  const [showAuthorBooksModal, setShowAuthorBooksModal] = useState(false);
  const [authorSearchQuery, setAuthorSearchQuery] = useState("");
  const [selectedAuthorBookIds, setSelectedAuthorBookIds] = useState<Set<string>>(new Set());
  const [showAuthorShelfPicker, setShowAuthorShelfPicker] = useState(false);
  const [authorNewShelfName, setAuthorNewShelfName] = useState("");
  /** Open Library 3-letter code: "" = all, "dut" = Nederlands, "eng" = English, etc. */
  const [authorLanguageFilter, setAuthorLanguageFilter] = useState<string>("");

  const existingAuthors = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.authors) {
        b.authors
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((name) => set.add(name));
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "nl-NL"));
  }, [books]);

  const topAuthors = useMemo(() => {
    const counts = new Map<string, number>();
    books.forEach((b) => {
      if (!b.authors) return;
      b.authors
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((name) => {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        });
    });

    return Array.from(counts.entries())
      .sort((a, b) => {
        // Most used first, then alphabetical.
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0], "nl-NL");
      })
      .map(([name]) => name)
      .slice(0, 8);
  }, [books]);

  const existingSeries = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.seriesName) set.add(b.seriesName);
    });
    return Array.from(set).sort();
  }, [books]);
  const existingSeriesNorm = useMemo(() => {
    const m = new Map<string, string>();
    existingSeries.forEach((name) => {
      m.set(
        name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim(),
        name
      );
    });
    return m;
  }, [existingSeries]);

  const existingGenres = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      parseGenres(b.genre).forEach((g) => set.add(g));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "nl-NL"));
  }, [books]);

  const selectedGenres = useMemo(
    () => parseGenresPreserveOrder(manualGenre),
    [manualGenre]
  );
  const selectedGenreSet = useMemo(
    () => new Set(selectedGenres),
    [selectedGenres]
  );

  const selectedGenreLowerSet = useMemo(
    () => new Set(selectedGenres.map((g) => g.toLowerCase())),
    [selectedGenres]
  );

  const genrePillsForSelect = selectedGenres;

  const genreQuickAddTrim = manualGenreQuickAdd.trim();
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
    // Als het exact bestaat, laat je het via de suggesties kiezen.
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
      setManualGenre(resolved);
      setManualGenreQuickAdd("");
      return;
    }

    // Preserve order exactly as the user assigned it:
    // new genre always goes to the end, never re-sorted.
    const ordered = [...current, resolved];
    setManualGenre(ordered.join(", "));
    setManualGenreQuickAdd("");
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

    const nextSelected = parseGenresPreserveOrder(manualGenre).filter(
      (p) => p.toLowerCase() !== targetLower
    );
    setManualGenre(nextSelected.join(", "));
    setManualGenreQuickAdd("");
  }

  const authorInputSuggestions = useMemo(() => {
    const trimmed = searchAuthor.trim();
    if (!trimmed) {
      // Always show alphabetically (not by "most used").
      return showAuthorSuggestions ? existingAuthors.slice(0, 6) : [];
    }

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const activeToken = tokens[tokens.length - 1];
    if (activeToken.length < 3) return [];

    const activeNorm = normalizeForMatch(activeToken);
    if (!activeNorm) return [];

    // Als de auteur al exact (case-insensitive) overeenkomt met een bekende auteur,
    // dan tonen we geen suggesties.
    const exact = existingAuthors.find(
      (a) => normalizeForMatch(a) === normalizeForMatch(trimmed)
    );
    if (exact) return [];

    // Keep the alphabetic order from `existingAuthors`.
    const matches = existingAuthors
      .filter((name) => normalizeForMatch(name).includes(activeNorm))
      .slice(0, 6);

    return matches;
  }, [searchAuthor, showAuthorSuggestions, existingAuthors]);

  const existingAuthorsByNormLengthDesc = useMemo(() => {
    const arr = [...existingAuthors];
    // Langste eerst: maakt matching op suffix realistischer (bv. "Lucinda Riley" boven "Riley").
    arr.sort(
      (a, b) => normalizeForMatch(b).length - normalizeForMatch(a).length
    );
    return arr;
  }, [existingAuthors]);

  const manualSelectedShelves = useMemo(
    () =>
      shelves
        .filter((s) => manualShelfIds.includes(s.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [shelves, manualShelfIds]
  );

  const manualShelvesToAdd = useMemo(
    () =>
      shelves
        .filter((s) => !manualShelfIds.includes(s.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [shelves, manualShelfIds]
  );

  const shelvesSortedForAddToShelf = useMemo(() => {
    // Bij "toevoegen" willen we standaardplanken bovenaan, maar binnen elke groep alfabetisch.
    const standard = shelves
      .filter((s) => s.system)
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
    const custom = shelves
      .filter((s) => !s.system)
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
    return [...standard, ...custom];
  }, [shelves]);

  const suggestionsAbortRef = useRef<AbortController | null>(null);
  const resultsAbortRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef<Map<string, { t: number; results: SearchResult[] }>>(
    new Map()
  );
  const cacheSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync books tussen tabs/shells (web ↔ mobile)
  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  // Hydrate search cache vanuit localStorage (1x)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEARCH_CACHE_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<
        string,
        { t: number; results: SearchResult[] }
      >;
      const now = Date.now();
      for (const [key, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry.t !== "number" || !Array.isArray(entry.results)) continue;
        if (now - entry.t > SEARCH_CACHE_TTL_MS) continue;
        searchCacheRef.current.set(key, entry);
      }
    } catch {
      // ignore
    }
  }, []);

  // Sync the two search fields (title + author) into the existing searchTerm/searchByAuthor model.
  useEffect(() => {
    const t = searchTitle.trim();
    const a = searchAuthor.trim();
    if (!t && a) {
      setSearchByAuthor(true);
      setSearchTerm(a);
      return;
    }
    if (t) {
      setSearchByAuthor(false);
      setSearchTerm(a ? `${t} - ${a}` : t);
      return;
    }
    setSearchByAuthor(false);
    setSearchTerm("");
  }, [searchTitle, searchAuthor]);

  function sortBooksBySeries(books: Book[]): Book[] {
    return [...books].sort((a, b) => {
      // Voor "Wil ik lezen": volgorde is de hoogste prioriteit
      if (a.status === "wil-ik-lezen" && b.status === "wil-ik-lezen") {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        
        // Boeken met volgorde (order > 0) komen voor boeken zonder volgorde (order = 0)
        if (orderA > 0 && orderB === 0) return -1;
        if (orderA === 0 && orderB > 0) return 1;
        
        // Als beide een volgorde hebben, sorteer op volgorde
        if (orderA > 0 && orderB > 0) {
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          // Zelfde volgorde, ga door naar volgende sorteerregel
        }
        
        // Zelfde volgorde (of beide geen volgorde), dan op auteur
        const authorCompare = a.authors.localeCompare(b.authors);
        if (authorCompare !== 0) {
          return authorCompare;
        }
        // Zelfde auteur, sorteer op serie naam
        if (a.seriesName && b.seriesName) {
          if (a.seriesName !== b.seriesName) {
            return a.seriesName.localeCompare(b.seriesName);
          }
          // Zelfde serie, sorteer op nummer
          const numA = a.seriesNumber ?? 0;
          const numB = b.seriesNumber ?? 0;
          if (numA !== numB) {
            return numA - numB;
          }
          // Zelfde serie en nummer, sorteer op titel
          return a.title.localeCompare(b.title);
        }
        // Als een boek geen serie heeft, komt het na boeken met serie (binnen dezelfde auteur)
        if (a.seriesName && !b.seriesName) return -1;
        if (!a.seriesName && b.seriesName) return 1;
        // Beide geen serie, sorteer op titel
        return a.title.localeCompare(b.title);
      } else if (a.status === "wil-ik-lezen" && b.status !== "wil-ik-lezen") {
        // Boeken met "Wil ik lezen" komen eerst
        return -1;
      } else if (a.status !== "wil-ik-lezen" && b.status === "wil-ik-lezen") {
        return 1;
      }
      
      // Voor andere statussen: eerst op auteur
      const authorCompare = a.authors.localeCompare(b.authors);
      if (authorCompare !== 0) {
        return authorCompare;
      }
      
      // Zelfde auteur, sorteer op serie naam
      if (a.seriesName && b.seriesName) {
        if (a.seriesName !== b.seriesName) {
          return a.seriesName.localeCompare(b.seriesName);
        }
        // Zelfde serie, sorteer op nummer
        const numA = a.seriesNumber ?? 0;
        const numB = b.seriesNumber ?? 0;
        if (numA !== numB) {
          return numA - numB;
        }
        // Zelfde serie en nummer, sorteer op titel
        return a.title.localeCompare(b.title);
      }
      
      // Als een boek geen serie heeft, komt het na boeken met serie (binnen dezelfde auteur)
      if (a.seriesName && !b.seriesName) return -1;
      if (!a.seriesName && b.seriesName) return 1;
      
      // Beide geen serie, sorteer op volgorde, dan op titel
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.title.localeCompare(b.title);
    });
  }

  const filteredBooks = useMemo(() => {
    const filtered = books.filter((b) =>
      statusFilter === "alle" ? true : b.status === statusFilter
    );
    return sortBooksBySeries(filtered);
  }, [books, statusFilter]);

  function getBookPlankNames(book: Book): string[] {
    const ids = book.shelfIds ?? [];
    return ids
      .map((id) => shelves.find((s) => s.id === id)?.name)
      .filter((name): name is string => name != null)
      .sort((a, b) => a.localeCompare(b));
  }

  const filteredAuthorBooks = useMemo(() => {
    if (!authorLanguageFilter) return authorSearchResults;
    return authorSearchResults.filter((r) => {
      const codes = r.languageCodes;
      if (!codes || codes.length === 0) return false;
      return codes.includes(authorLanguageFilter);
    });
  }, [authorSearchResults, authorLanguageFilter]);

  function findExistingBookForResult(result: SearchResult): Book | undefined {
    // 1) Probeer eerst op exacte id-match (ideaal als de bron hetzelfde is)
    const byId = books.find((b) => b.id === result.id);
    if (byId) return byId;

    // 2) Canonical series key match:
    // API-titels bevatten vaak "Serie - Deel" terwijl onze boeken losse `seriesName` en `title` hebben.
    const split = splitSeriesFromTitle(result.title);
    const resultAuthors = (result.authors ?? "").trim().toLowerCase();
    const resultTitleNorm = normalizeForMatch(split.title);
    const resultSeriesNorm = split.seriesName ? normalizeForMatch(split.seriesName) : "";

    const bySeriesKey = books.find((b) => {
      const bAuthors = (b.authors ?? "").trim().toLowerCase();
      if (bAuthors !== resultAuthors) return false;

      // Als we een serienaam konden afleiden, gebruik die; anders vallen we terug naar title match.
      if (resultSeriesNorm && b.seriesName) {
        return (
          normalizeForMatch(b.seriesName) === resultSeriesNorm &&
          normalizeForMatch(b.title) === resultTitleNorm
        );
      }

      return normalizeForMatch(b.title) === resultTitleNorm;
    });
    if (bySeriesKey) return bySeriesKey;

    // 3) Fallback: match op titel + auteurs (case-insensitive, getrimd)
    const title = result.title.trim().toLowerCase();
    const authors = result.authors.trim().toLowerCase();
    return books.find(
      (b) =>
        b.title.trim().toLowerCase() === title &&
        (b.authors ?? "").trim().toLowerCase() === authors
    );
  }

  function persist(newBooks: Book[]) {
    setBooks(newBooks);
    saveBooks(newBooks);
  }

  function cacheKey(
    query: string,
    maxResults: number,
    source: "google" | "itunes" | "openlibrary"
  ) {
    if (source === "itunes") {
      return `${source}:${ITUNES_COUNTRY}:${maxResults}:${query.trim().toLowerCase()}`;
    }
    return `${source}:${maxResults}:${query.trim().toLowerCase()}`;
  }

  function readCache(key: string): SearchResult[] | null {
    const entry = searchCacheRef.current.get(key);
    if (!entry) return null;
    if (Date.now() - entry.t > SEARCH_CACHE_TTL_MS) {
      searchCacheRef.current.delete(key);
      return null;
    }
    return entry.results;
  }

  function scheduleCacheSave() {
    if (cacheSaveTimeoutRef.current) {
      clearTimeout(cacheSaveTimeoutRef.current);
    }
    cacheSaveTimeoutRef.current = setTimeout(() => {
      try {
        const now = Date.now();
        const obj: Record<string, { t: number; results: SearchResult[] }> = {};
        for (const [k, v] of searchCacheRef.current.entries()) {
          if (now - v.t > SEARCH_CACHE_TTL_MS) continue;
          obj[k] = v;
        }
        window.localStorage.setItem(SEARCH_CACHE_LS_KEY, JSON.stringify(obj));
      } catch {
        // ignore
      }
    }, 250);
  }

  function writeCache(key: string, results: SearchResult[]) {
    searchCacheRef.current.set(key, { t: Date.now(), results });
    scheduleCacheSave();
  }

  function normalizeForMatch(input: string): string {
    return input
      .toLowerCase()
      .normalize("NFD")
      // strip diacritics
      .replace(/[\u0300-\u036f]/g, "")
      // normalize punctuation to spaces
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSeriesPartTitleCase(partTitle: string): string {
    const norm = normalizeForMatch(partTitle);
    if (norm === "storm") return "Storm";
    if (norm === "maan") return "Maan";
    if (norm === "zon") return "Zon";
    return partTitle;
  }

  function toTitleCase(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;

    // Support multiple authors separated by commas.
    const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
    const titleCasedParts = parts.map((p) => {
      return p
        .split(/\s+/)
        .map((word) => {
          if (!word) return word;
          const lower = word.toLowerCase();
          // Keep fully-uppercase words as-is (e.g. "YA", acronyms)
          if (word === word.toUpperCase() && word.replace(/[^A-Z]/g, "").length >= 2) {
            return word;
          }
          // Capitalize first letter, keep the rest lowercase
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
    });

    // Preserve comma spacing in a normalized way
    return titleCasedParts.join(", ");
  }

  function toAuthorNameCase(input: string): string {
    // Like `toTitleCase`, but don't keep arbitrary fully-uppercase words.
    // This avoids turning normal names like "RILEY" into "RILEY".
    let trimmed = input.trim();
    if (!trimmed) return trimmed;

    // If the user typed multiple authors with separators (e.g. "&" or ";"),
    // normalize them into comma-separated format so manual input shows ", ".
    trimmed = trimmed
      .replace(/\s*(?:&|\/|;)\s*/g, ", ")
      .replace(/\s+\b(AND|and|EN|en)\b\s+/g, ", ");

    const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
    const casedParts = parts.map((p) =>
      p
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
          const lettersOnly = word.replace(/[^A-Za-z]/g, "");
          const isAcronym =
            word.length <= 4 && word === word.toUpperCase() && lettersOnly.length >= 2;
          if (isAcronym) return word;

          const lower = word.toLowerCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ")
    );

    return casedParts.join(", ");
  }

  function mapToOpenLibraryLanguageCodes(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    // iTunes/Google/OpenLibrary gebruiken soms verschillende taalstrings:
    // - afkortingen (nl/en/de/fr)
    // - samengestelde codes (nl-NL)
    // - volledige namen ("dutch", "english", ...)
    // Normalize eerst (case/diacritics) en neem daarna het eerste token.
    const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const base = normalized.split(/[-_]/)[0].trim();
    if (!base) return undefined;
    const map: Record<string, string> = {
      nl: "dut",
      dut: "dut",
      nld: "dut",
      dutch: "dut",
      nederlands: "dut",
      en: "eng",
      eng: "eng",
      english: "eng",
      de: "ger",
      ger: "ger",
      german: "ger",
      deutsch: "ger",
      fr: "fre",
      fre: "fre",
      french: "fre",
      francais: "fre",
    };
    const code = map[base];
    return code ? [code] : undefined;
  }

  function splitQuery(query: string): { raw: string; titlePart: string; authorPart: string } {
    const raw = query.trim();
    // common patterns: "Title - Author", "Title — Author", "Title by Author"
    const m =
      raw.match(/^(.*?)\s*[-—–]\s*(.+)$/) ||
      raw.match(/^(.*?)\s+by\s+(.+)$/i);
    if (m) {
      return { raw, titlePart: m[1].trim(), authorPart: m[2].trim() };
    }

    // Heuristiek: als query eindigt op (een deel van) een auteur uit je eigen bibliotheek,
    // splits dan titel/auteur zelfs als er geen '-' staat.
    const qNorm = normalizeForMatch(raw);
    if (qNorm && existingAuthorsByNormLengthDesc.length > 0) {
      for (const author of existingAuthorsByNormLengthDesc) {
        const aNorm = normalizeForMatch(author);
        if (!aNorm) continue;
        // Match op genormaliseerde suffix, zodat "storm lucinda riley" werkt.
        if (qNorm.endsWith(aNorm) && qNorm.length > aNorm.length + 1) {
          const titlePartNorm = qNorm.slice(0, qNorm.length - aNorm.length).trim();
          if (titlePartNorm) {
            return { raw, titlePart: titlePartNorm, authorPart: author };
          }
        }
      }

      // Fallback: alleen achternaam getypt (bv. "Storm Riley")
      const parts = qNorm.split(" ").filter(Boolean);
      const lastToken = parts.length > 0 ? parts[parts.length - 1] : "";
      if (lastToken) {
        const candidates = existingAuthorsByNormLengthDesc.filter((author) => {
          const aNorm = normalizeForMatch(author);
          return aNorm.endsWith(lastToken);
        });
        if (candidates.length > 0) {
          const best = candidates[0];
          const bestNorm = normalizeForMatch(best);
          if (qNorm.endsWith(bestNorm) && qNorm.length > bestNorm.length + 1) {
            const titlePartNorm = qNorm.slice(0, qNorm.length - bestNorm.length).trim();
            if (titlePartNorm) {
              return { raw, titlePart: titlePartNorm, authorPart: best };
            }
          } else {
            // Als we niet exact op volledige auteur suffix matchen, nemen we toch de
            // rest als titel (op tokenbasis).
            const titlePartNorm = parts.slice(0, -1).join(" ").trim();
            if (titlePartNorm) {
              return { raw, titlePart: titlePartNorm, authorPart: best };
            }
          }
        }
      }
    }

    return { raw, titlePart: raw, authorPart: "" };
  }

  function resultDedupeKey(r: SearchResult): string {
    // Use normalized title+authors for cross-source dedupe
    return `${normalizeForMatch(r.title)}|${normalizeForMatch(r.authors ?? "")}`;
  }

  function scoreResult(queryNorm: string, titleNorm: string, authorsNorm: string): number {
    if (!queryNorm) return 0;
    let score = 0;

    // Strong signals
    if (titleNorm === queryNorm) score += 250;
    if (authorsNorm === queryNorm) score += 80;

    // Starts-with is usually very relevant for book search
    if (titleNorm.startsWith(queryNorm)) score += 160;
    if (authorsNorm.startsWith(queryNorm)) score += 40;

    // Substring match
    if (titleNorm.includes(queryNorm)) score += 90;
    if (authorsNorm.includes(queryNorm)) score += 30;

    // Token coverage: reward matching multiple tokens in title/authors
    const tokens = queryNorm.split(" ").filter((t) => t.length >= 2);
    if (tokens.length > 0) {
      let matched = 0;
      for (const t of tokens) {
        if (titleNorm.includes(t) || authorsNorm.includes(t)) matched += 1;
      }
      score += Math.round((matched / tokens.length) * 70);
    }

    // Minor boosts for richer results
    // (keeps results with covers/pageCount a bit higher when relevance is similar)
    return score;
  }

  function mergeDedupeAndRank(query: string, lists: SearchResult[][], maxResults: number): SearchResult[] {
    const qNorm = normalizeForMatch(query);
    const { titlePart, authorPart } = splitQuery(query);
    const titlePartNorm = normalizeForMatch(titlePart);
    const authorPartNorm = normalizeForMatch(authorPart);

    const tokensAll = qNorm.split(" ").filter((t) => t.length >= 2);
    const titlePartTokens = titlePartNorm ? titlePartNorm.split(" ").filter((t) => t.length >= 2) : [];
    const authorPartTokens = authorPartNorm ? authorPartNorm.split(" ").filter((t) => t.length >= 2) : [];

    const singleWordQuery = qNorm.split(" ").length === 1;
    const libraryTitleSet = new Set(books.map((b) => normalizeForMatch(b.title)));
    const map = new Map<string, SearchResult>();
    for (const list of lists) {
      for (const r of list) {
        const key = resultDedupeKey(r);
        if (!map.has(key)) {
          map.set(key, r);
          continue;
        }
        // Prefer the "richer" version of a duplicate
        const prev = map.get(key)!;
        const prevScore =
          (prev.coverUrl ? 2 : 0) +
          (typeof prev.pageCount === "number" ? 1 : 0) +
          (prev.description ? 1 : 0);
        const nextScore =
          (r.coverUrl ? 2 : 0) +
          (typeof r.pageCount === "number" ? 1 : 0) +
          (r.description ? 1 : 0);
        if (nextScore > prevScore) map.set(key, r);
      }
    }

    const ranked = Array.from(map.values())
      .map((r) => {
        const split = splitSeriesFromTitle(r.title);
        const partTitleNorm = normalizeForMatch(split.title);
        const titleNorm = normalizeForMatch(r.title);
        const authorsNorm = normalizeForMatch(r.authors ?? "");

        // Basis: traditionele score op volledige query + titel/authors
        let relevance = scoreResult(qNorm, titleNorm, authorsNorm);

        // Deel/titel scoring: match op de "deelnaam" (right side) als we die kunnen afleiden.
        if (titlePartTokens.length > 0) {
          const exact = partTitleNorm === titlePartNorm;
          const starts = partTitleNorm.startsWith(titlePartNorm);
          const contains = partTitleNorm.includes(titlePartNorm);

          if (exact) relevance += 320;
          else if (starts) relevance += 220;
          else if (contains) relevance += 140;

          // Token coverage voor deelnaam (bv. "maan")
          const matchedTitleTokens = titlePartTokens.reduce((acc, t) => {
            return acc + (partTitleNorm.includes(t) ? 1 : 0);
          }, 0);
          if (titlePartTokens.length > 0) {
            relevance += Math.round((matchedTitleTokens / titlePartTokens.length) * 120);
          }
        }

        // Auteur scoring: match op auteur tokens als gebruiker auteur opgeeft
        if (authorPartTokens.length > 0) {
          const exactAuthor = authorsNorm === authorPartNorm;
          const startsAuthor = authorsNorm.startsWith(authorPartNorm);
          const containsAuthor = authorsNorm.includes(authorPartNorm);
          if (exactAuthor) relevance += 160;
          else if (startsAuthor) relevance += 110;
          else if (containsAuthor) relevance += 70;

          const matchedAuthorTokens = authorPartTokens.reduce((acc, t) => {
            return acc + (authorsNorm.includes(t) ? 1 : 0);
          }, 0);
          if (authorPartTokens.length > 0) {
            relevance += Math.round((matchedAuthorTokens / authorPartTokens.length) * 90);
          }
        }

        // Fallback: als er geen duidelijke authorPart is, reward coverage op titel/authors tokens
        if (tokensAll.length >= 2 && authorPartTokens.length === 0) {
          const matchedInTitle = tokensAll.reduce((acc, t) => acc + (partTitleNorm.includes(t) ? 1 : 0), 0);
          const matchedInAuthors = tokensAll.reduce((acc, t) => acc + (authorsNorm.includes(t) ? 1 : 0), 0);
          relevance += matchedInTitle * 18;
          relevance += matchedInAuthors * 10;
          if (matchedInTitle > 0 && matchedInAuthors > 0) relevance += 90;
        }

        // Extra boost als we een bekende serie herkennen en de deelnaam matcht sterk.
        if (split.seriesName) {
          const splitSeriesNorm = normalizeForMatch(split.seriesName);
          if (existingSeriesNorm.has(splitSeriesNorm)) {
            relevance += 40;
            if (titlePartTokens.length > 0) {
              const matchedAllTokens = titlePartTokens.every((t) => partTitleNorm.includes(t));
              if (matchedAllTokens) relevance += 120;
            }
          }
        }

        // Taal-boost (geen filter): als we taalmetadata hebben, promoten we NL boven ENG/DE.
        const langs = r.languageCodes ?? [];
        if (langs.includes("dut")) relevance += 200;
        else if (langs.includes("eng")) relevance += 90;
        else if (langs.includes("ger")) relevance += 60;

        // Straf niet doeltalen wanneer taalmetadata beschikbaar is.
        if (langs.length > 0 && !langs.some((c) => c === "dut" || c === "eng" || c === "ger")) {
          relevance -= 220;
        }

        // Boost resultaten die qua titel overeenkomen met een boek uit de eigen bibliotheek.
        if (libraryTitleSet.has(partTitleNorm)) {
          relevance += 80;
        }

        // Bij hele korte/algemene queries (zoals "Storm") lichte voorkeur voor NL resultaten.
        if (
          singleWordQuery &&
          Array.isArray(r.languageCodes) &&
          r.languageCodes.some((c) => c === "dut" || c === "nld" || c === "nl")
        ) {
          relevance += 50;
        }

        const richness =
          (r.coverUrl ? 8 : 0) +
          (typeof r.pageCount === "number" ? 3 : 0) +
          (r.description ? 2 : 0);
        return { r, sortScore: relevance * 10 + richness };
      })
      .sort((a, b) => b.sortScore - a.sortScore)
      .map((x) => x.r);

    return ranked.slice(0, maxResults);
  }

  function normalizeDescription(description?: string): string {
    if (!description) return "";
    // iTunes levert vaak HTML; maak dit leesbaar als plain text.
    const withBreaks = description
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<p[^>]*>/gi, "");
    try {
      const doc = new DOMParser().parseFromString(withBreaks, "text/html");
      const text = doc.body.textContent ?? "";
      return text.replace(/\n{3,}/g, "\n\n").trim();
    } catch {
      return withBreaks.replace(/<[^>]+>/g, "").trim();
    }
  }

  function openSearchResult(result: SearchResult) {
    setSelectedSearchResult(result);
  }

  function getResultSourceLabel(result: SearchResult): string {
    if (result.id.startsWith("itunes:")) return "Apple Books";
    if (result.id.startsWith("openlib:")) return "Open Library";
    return "Google Books";
  }

  function getLanguageBadges(result: SearchResult): string[] {
    // Primary: infer from the summary/description text (what you use to choose the correct edition).
    const inferred = inferLanguageLabelsFromDescription(result.description);
    if (inferred.length > 0) return inferred;

    // Secondary: fall back to provider metadata.
    const codes = Array.isArray(result.languageCodes) ? result.languageCodes : [];
    const set = new Set<string>();
    const norm = codes.map((c) => (typeof c === "string" ? c.toLowerCase() : "")).filter(Boolean);

    if (norm.includes("dut") || norm.includes("nld") || norm.includes("nl")) set.add("NL");
    if (norm.includes("eng") || norm.includes("en")) set.add("EN");
    if (norm.includes("ger") || norm.includes("de")) set.add("DE");
    if (norm.includes("fre") || norm.includes("fr")) set.add("FR");

    return Array.from(set);
  }

  function stripHtml(input: string): string {
    return input
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferLanguageLabelsFromDescription(description?: string): string[] {
    if (!description) return [];
    const text = stripHtml(description).toLowerCase();
    if (!text) return [];

    // Lightweight heuristic: compare counts of language-specific “signals”.
    // Belangrijk: we willen vooral voorkomen dat Zweeds als NL wordt gezien.
    // Daarom gebruiken we boek-/auteur-specifieke termen i.p.v. algemene woorden.
    const hasSwedishDiacritics = /[åäö]/.test(text);

    const svSignals: RegExp[] = [
      /\b(och|att|för|inte|på|från|till|över|under|med|utgivare)\b/g,
      /\b(bok|kapitel|författare|stormsystem)\b/g
    ];

    const nlSignals: RegExp[] = [
      /\b(het|een|van|voor|door|bij|maar|ook|naar|waar|wordt|komt|blijft)\b/g,
      /\b(roman|verhaal|reeks|deel|uitgever|auteur|hoofdstuk|geschiedenis)\b/g,
      /\b(ij|schrijver)\b/g
    ];

    const enSignals: RegExp[] = [
      /\b(the|and|with|for|from|about|into|over|after|before|without|between)\b/g,
      /\b(novel|story|series|volume|chapter|author|published)\b/g
    ];

    const minLen = 25; // te kort = te weinig bewijs
    if (text.length < minLen) return [];

    const countMatches = (reArr: RegExp[], str: string) => {
      let total = 0;
      for (const re of reArr) {
        const m = str.match(re);
        total += m ? m.length : 0;
      }
      return total;
    };

    const nlScore = countMatches(nlSignals, text);
    const enScore = countMatches(enSignals, text);
    const svScore = countMatches(svSignals, text) + (hasSwedishDiacritics ? 6 : 0);

    const best = Math.max(nlScore, enScore, svScore);
    if (best === 0) return [];

    // Avoid ties/weak evidence: if best is only slightly better, don't guess.
    const sorted = [nlScore, enScore, svScore].sort((a, b) => b - a);
    const second = sorted[1] ?? 0;
    const diff = best - second;
    const minDiff = 2;
    const minBest = 3;
    if (best < minBest) return [];
    if (diff < minDiff) return [];

    if (svScore === best) return ["SV"];
    if (nlScore === best) return ["NL"];
    return ["EN"];
  }

  function getLanguageLabel(result: SearchResult): string | null {
    const langs = getLanguageBadges(result);
    if (langs.length === 0) return null;
    if (langs.length === 1) return `Taal: ${langs[0]}`;
    return `Talen: ${langs.join("/")}`;
  }

  function resultMatchesAuthorFilter(result: SearchResult, authorPartRaw: string): boolean {
    const input = authorPartRaw.trim();
    if (!input) return true;

    const inputNorm = normalizeForMatch(input);
    if (!inputNorm) return true;

    const resultAuthors = (result.authors ?? "").trim();
    const resultNorm = normalizeForMatch(resultAuthors);
    if (!resultNorm) return false;

    if (resultNorm === inputNorm) return true;
    if (resultNorm.includes(inputNorm)) return true;

    const inputTokens = inputNorm.split(" ").filter(Boolean);
    if (inputTokens.length === 1) {
      return resultNorm.includes(inputTokens[0]);
    }

    // Token-based match, order independent (helps with "Lucinda Riley" vs "Riley, Lucinda").
    return inputTokens.every((t) => resultNorm.includes(t));
  }

  function getQueryHighlightToken(
    query: string,
    title: string,
    authors: string
  ): string | null {
    const qNorm = normalizeForMatch(query);
    if (!qNorm) return null;
    const tokens = qNorm.split(" ").filter((t) => t.length >= 3);
    if (tokens.length === 0) return null;
    const titleNorm = normalizeForMatch(title);
    const authorsNorm = normalizeForMatch(authors);
    const missingFromTitle = tokens.filter((t) => !titleNorm.includes(t));
    if (missingFromTitle.length === 0) return null;
    // Toon één representatieve token (zoals "maan") als hint
    return missingFromTitle[0];
  }

  function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getTokenFromQueryOriginalCase(query: string, tokenLower: string): string | null {
    if (!query || !tokenLower) return null;
    const re = new RegExp(`\\b${escapeRegex(tokenLower)}\\b`, "i");
    const m = query.match(re);
    return m && typeof m[0] === "string" ? m[0].trim() : null;
  }

  function splitSeriesFromTitle(
    rawTitle: string
  ): { title: string; seriesName?: string } {
    const base = rawTitle.trim();
    if (!base) return { title: rawTitle };

    // 1) Sterke herkenning: bekende serienaam aan het begin, gevolgd door een delimiter.
    // Voorbeelden:
    // - "De zeven zussen - Maan"
    // - "De zeven zussen: Maan"
    // - "De zeven zussen (Maan)"
    for (const seriesName of existingSeries) {
      if (!seriesName) continue;
      const esc = escapeRegex(seriesName);
      const dashRe = new RegExp(`^${esc}\\s*[\\-–—:]\\s*(.+)$`, "i");
      const parenRe = new RegExp(`^${esc}\\s*[\\(\\[]\\s*(.+?)\\s*[\\)\\]]$`, "i");

      const mDash = base.match(dashRe);
      if (mDash && typeof mDash[1] === "string") {
        const right = mDash[1].trim();
        const rightWords = right.split(/\s+/).filter(Boolean).length;
        if (right && rightWords <= 6) {
          return { title: normalizeSeriesPartTitleCase(right), seriesName };
        }
      }

      const mParen = base.match(parenRe);
      if (mParen && typeof mParen[1] === "string") {
        const right = mParen[1].trim();
        if (right) {
          return { title: normalizeSeriesPartTitleCase(right), seriesName };
        }
      }
    }

    // 2) Fallback: separator heuristiek (ook zonder spaties rond de delimiter)
    const separators = [" – ", " — ", " - ", ": ", "–", "—", "-", ":"];
    for (const sep of separators) {
      const idx = base.indexOf(sep);
      if (idx <= 0 || idx >= base.length - sep.length) continue;
      const left = base.slice(0, idx).trim();
      const right = base.slice(idx + sep.length).trim();
      if (!right) continue;

      const leftNorm = left
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

      // 1) Als de linkerkant al als serie in de bibliotheek bestaat → gebruik die.
      const existing = existingSeriesNorm.get(leftNorm);
      if (existing) {
        return { title: normalizeSeriesPartTitleCase(right), seriesName: existing };
      }

      // 2) Generieke heuristiek: linkerkant lijkt een serienaam (meerdere woorden),
      // rechterkant is korter (deelnaam), en ze zijn niet gelijk.
      const leftWords = left.split(/\s+/).length;
      const rightWords = right.split(/\s+/).length;
      if (
        leftWords >= 2 &&
        rightWords <= 4 &&
        !right.toLowerCase().startsWith(left.toLowerCase())
      ) {
        return { title: normalizeSeriesPartTitleCase(right), seriesName: left };
      }
    }

    return { title: rawTitle };
  }

  function getExistingBookShelfNames(existingBook: Book | undefined): string[] {
    if (!existingBook) return [];
    const names = new Set<string>();

    (existingBook.shelfIds ?? []).forEach((id) => {
      const shelfName = shelves.find((s) => s.id === id)?.name;
      if (shelfName) names.add(shelfName);
    });

    // Als het een standaard status-shelf is, wordt shelfIds vaak niet gezet; toon dan de status-shelf.
    const systemShelfId = Object.entries(STATUS_BY_SHELF_ID).find(
      ([, status]) => status === existingBook.status
    )?.[0];
    if (systemShelfId) {
      const shelfName = shelves.find((s) => s.id === systemShelfId)?.name ?? systemShelfId;
      names.add(shelfName);
    }

    return Array.from(names);
  }

  const showSearch = mode !== "library";
  const showLibrary = mode !== "search";

  function getGoogleDisabledUntil(): number {
    const raw = window.localStorage.getItem(GOOGLE_DISABLED_UNTIL_KEY);
    const num = raw ? Number(raw) : 0;
    return Number.isFinite(num) ? num : 0;
  }

  function disableGoogleForAWhile() {
    const until = Date.now() + GOOGLE_COOLDOWN_MS;
    window.localStorage.setItem(GOOGLE_DISABLED_UNTIL_KEY, String(until));
  }

  function canUseGoogleNow(): boolean {
    if (!GOOGLE_BOOKS_API_KEY || !GOOGLE_BOOKS_API_KEY.trim()) return false;
    return Date.now() > getGoogleDisabledUntil();
  }

  async function searchItunesBooks(
    query: string,
    maxResults: number,
    controller: AbortController
  ): Promise<SearchResult[]> {
    // Gebruik land-specifieke iTunes endpoint om betere taal/edities terug te krijgen.
    const countryPath = ITUNES_COUNTRY.trim().toLowerCase();
    const url = new URL(`https://itunes.apple.com/${countryPath}/search`);
    url.searchParams.set("term", query);
    url.searchParams.set("country", ITUNES_COUNTRY);
    url.searchParams.set("media", "ebook");
    url.searchParams.set("entity", "ebook");
    url.searchParams.set("limit", String(Math.min(200, Math.max(1, maxResults))));

    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Apple Books error (${res.status})`);
    }
    const data = (await res.json()) as any;
    const items: any[] = Array.isArray(data?.results) ? data.results : [];
    const results: SearchResult[] = items.map((item) => {
      const id =
        typeof item?.trackId === "number"
          ? `itunes:${item.trackId}`
          : `itunes:${Math.random().toString(36).slice(2)}`;
      const title = (item?.trackName as string | undefined) ?? "Onbekende titel";
      const authors = (item?.artistName as string | undefined) ?? "Onbekende auteur";
      const coverUrl =
        (item?.artworkUrl100 as string | undefined) ??
        (item?.artworkUrl60 as string | undefined) ??
        undefined;
      const description =
        (item?.description as string | undefined) ??
        (item?.longDescription as string | undefined) ??
        undefined;

      return {
        id,
        title,
        authors,
        coverUrl: coverUrl?.replace("http://", "https://"),
        description
        ,
        // Best effort: iTunes language is usually a short code like "nl" / "en"
        languageCodes: mapToOpenLibraryLanguageCodes(item?.language)
      };
    });

    return results;
  }

  async function searchOpenLibrary(query: string, maxResults: number, controller: AbortController) {
    const url = new URL(OPEN_LIBRARY_SEARCH_API);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(maxResults));
    url.searchParams.set(
      "fields",
      "key,title,subtitle,author_name,cover_i,number_of_pages_median,language"
    );

    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open Library error (${res.status})`);
    }
    const data = (await res.json()) as any;
    const docs: any[] = Array.isArray(data?.docs) ? data.docs : [];
    const results: SearchResult[] = docs.map((doc) => {
      const key = typeof doc?.key === "string" ? doc.key : "";
      const id = key ? `openlib:${key}` : `openlib:doc:${Math.random().toString(36).slice(2)}`;
      const coverId = typeof doc?.cover_i === "number" ? doc.cover_i : undefined;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : undefined;
      const baseTitle = doc?.title ?? "Onbekende titel";
      const sub = typeof doc?.subtitle === "string" ? doc.subtitle.trim() : "";
      const combinedTitle =
        sub && !sub.toLowerCase().startsWith(baseTitle.toLowerCase())
          ? `${baseTitle} – ${sub}`
          : baseTitle;
      const authors = Array.isArray(doc?.author_name)
        ? doc.author_name.join(", ")
        : "Onbekende auteur";
      const pageCount =
        typeof doc?.number_of_pages_median === "number"
          ? doc.number_of_pages_median
          : undefined;
      const rawLang = doc?.language;
      const languageCodes = Array.isArray(rawLang)
        ? (rawLang as any[])
            .map((x) =>
              typeof x === "string" ? x : x?.key?.replace(/^\/languages\//, "") || null
            )
            .filter((c): c is string => !!c)
        : undefined;
      return {
        id,
        title: combinedTitle,
        authors,
        coverUrl,
        pageCount,
        languageCodes
      };
    });
    return results;
  }

  async function searchOpenLibraryByAuthor(authorQuery: string, maxResults = 50): Promise<SearchResult[]> {
    const url = new URL(OPEN_LIBRARY_SEARCH_API);
    url.searchParams.set("author", authorQuery.trim());
    url.searchParams.set("limit", String(maxResults));
    url.searchParams.set("fields", "key,title,author_name,cover_i,number_of_pages_median,language");
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Open Library error (${res.status})`);
    }
    const data = (await res.json()) as any;
    const docs: any[] = Array.isArray(data?.docs) ? data.docs : [];
    return docs.map((doc) => {
      const key = typeof doc?.key === "string" ? doc.key : "";
      const id = key ? `openlib:${key}` : `openlib:doc:${Math.random().toString(36).slice(2)}`;
      const coverId = typeof doc?.cover_i === "number" ? doc.cover_i : undefined;
      const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined;
      const authors = Array.isArray(doc?.author_name) ? doc.author_name.join(", ") : authorQuery;
      const pageCount = typeof doc?.number_of_pages_median === "number" ? doc.number_of_pages_median : undefined;
      const rawLang = doc?.language;
      const languageCodes = Array.isArray(rawLang)
        ? (rawLang as any[])
            .map((x) => (typeof x === "string" ? x : x?.key?.replace(/^\/languages\//, "") || null))
            .filter((c): c is string => !!c)
        : undefined;
      return { id, title: doc?.title ?? "Onbekende titel", authors, coverUrl, pageCount, languageCodes };
    });
  }

  async function searchBooks(query: string, isSuggestion = false) {
    const { raw, titlePart, authorPart } = splitQuery(query);
    if (!raw.trim()) {
      if (isSuggestion) {
        setSuggestions([]);
      } else {
        setSearchResults([]);
      }
      setSearchError("");
      return;
    }

    try {
      setSearchError("");

      const maxResults = isSuggestion ? 5 : 15;
      const controller = new AbortController();
      if (isSuggestion) {
        suggestionsAbortRef.current?.abort();
        suggestionsAbortRef.current = controller;
      } else {
        resultsAbortRef.current?.abort();
        resultsAbortRef.current = controller;
      }

      // Suggesties: combineer Apple Books + Open Library en rank lokaal (betere kwaliteit).
      if (isSuggestion) {
        const itunesKey = cacheKey(raw, 20, "itunes");
        const openKey = cacheKey(raw, 20, "openlibrary");
        const cachedItunes = readCache(itunesKey);
        const cachedOpen = readCache(openKey);

        const itunesPromise = cachedItunes
          ? Promise.resolve(cachedItunes)
          : searchItunesBooks(raw, 20, controller).then((r) => {
              writeCache(itunesKey, r);
              return r;
            });
        const openPromise = cachedOpen
          ? Promise.resolve(cachedOpen)
          : searchOpenLibrary(raw, 20, controller).then((r) => {
              writeCache(openKey, r);
              return r;
            });

        const [itunesResults, openResults] = await Promise.allSettled([itunesPromise, openPromise]).then(
          (settled) =>
            settled.map((s) => (s.status === "fulfilled" ? s.value : [] as SearchResult[])) as [
              SearchResult[],
              SearchResult[]
            ]
        );

        const combined = mergeDedupeAndRank(raw, [itunesResults, openResults], maxResults);
        if (combined.length === 0 && titlePart && authorPart) {
          // Fallback: zoek op auteur-only als titel (of spelling) te strikt/vaag is.
          const authorOnly = authorPart.trim();
          if (authorOnly) {
            const itunesKey2 = cacheKey(authorOnly, 20, "itunes");
            const openKey2 = cacheKey(authorOnly, 20, "openlibrary");
            const cachedItunes2 = readCache(itunesKey2);
            const cachedOpen2 = readCache(openKey2);

            const itunesPromise2 = cachedItunes2
              ? Promise.resolve(cachedItunes2)
              : searchItunesBooks(authorOnly, 20, controller).then((r) => {
                  writeCache(itunesKey2, r);
                  return r;
                });
            const openPromise2 = cachedOpen2
              ? Promise.resolve(cachedOpen2)
              : searchOpenLibrary(authorOnly, 20, controller).then((r) => {
                  writeCache(openKey2, r);
                  return r;
                });

            const [itunesResults2, openResults2] = await Promise.allSettled([itunesPromise2, openPromise2]).then(
              (settled) =>
                settled.map((s) => (s.status === "fulfilled" ? s.value : [] as SearchResult[])) as [
                  SearchResult[],
                  SearchResult[]
                ]
            );

            const combined2 = mergeDedupeAndRank(raw, [itunesResults2, openResults2], maxResults);
            const filtered2 =
              authorPart.trim().length > 0 ? combined2.filter((r) => resultMatchesAuthorFilter(r, authorPart)) : combined2;
            setSuggestions(filtered2);
            return;
          }
        }

        const filtered =
          authorPart.trim().length > 0 ? combined.filter((r) => resultMatchesAuthorFilter(r, authorPart)) : combined;
        setSuggestions(filtered);
        return;
      }

      // Als Google tijdelijk is uitgeschakeld (quota), ga direct naar Open Library
      const googleAllowed = canUseGoogleNow();

      // We vragen meer op per bron en ranken daarna lokaal terug naar maxResults.
      const perSourceLimit = isSuggestion ? 10 : 30;

      // Build Google query with light structure if user typed "title - author"
      const googleQuery =
        authorPart && titlePart
          ? `intitle:${titlePart} inauthor:${authorPart}`
          : raw;

      async function searchGoogle(q: string): Promise<SearchResult[]> {
        const googleKey = cacheKey(`${q}`, perSourceLimit, "google");
        const cachedGoogle = readCache(googleKey);
        if (cachedGoogle) return cachedGoogle;

        const url = new URL(GOOGLE_BOOKS_API);
        url.searchParams.set("q", q);
        url.searchParams.set("maxResults", String(Math.min(40, Math.max(1, perSourceLimit))));
        if (GOOGLE_BOOKS_API_KEY && GOOGLE_BOOKS_API_KEY.trim()) {
          url.searchParams.set("key", GOOGLE_BOOKS_API_KEY.trim());
        }
        const res = await fetch(url.toString(), { signal: controller.signal });
        const data = await res.json().catch(() => ({} as any));

        if (!res.ok) {
          if (res.status === 429 || res.status === 403) {
            disableGoogleForAWhile();
          }
          throw new Error("Google Books error");
        }

        const results: SearchResult[] =
          data.items?.map((item: any) => {
            const info = item.volumeInfo ?? {};
            const coverUrl =
              info.imageLinks?.thumbnail ??
              info.imageLinks?.smallThumbnail ??
              info.imageLinks?.medium ??
              undefined;

            let description = info.description;
            if (description && description.length > 500) {
              description = description.substring(0, 500) + "...";
            }
            const pageCount = typeof info.pageCount === "number" ? info.pageCount : undefined;
            const languageCodes = mapToOpenLibraryLanguageCodes(info.language);

            const baseTitle = info.title ?? "Onbekende titel";
            const sub =
              typeof info.subtitle === "string" ? info.subtitle.trim() : "";
            const combinedTitle =
              sub && !sub.toLowerCase().startsWith(baseTitle.toLowerCase())
                ? `${baseTitle} – ${sub}`
                : baseTitle;

            return {
              id: item.id,
              title: combinedTitle,
              authors: (info.authors ?? []).join(", ") || "Onbekende auteur",
              coverUrl: coverUrl?.replace("http://", "https://"),
              description: description || undefined,
              pageCount,
              languageCodes
            };
          }) ?? [];

        writeCache(googleKey, results);
        return results;
      }

      const itunesKey = cacheKey(raw, perSourceLimit, "itunes");
      const openKey = cacheKey(raw, perSourceLimit, "openlibrary");
      const cachedItunes = readCache(itunesKey);
      const cachedOpen = readCache(openKey);

      const itunesPromise = cachedItunes
        ? Promise.resolve(cachedItunes)
        : searchItunesBooks(raw, perSourceLimit, controller).then((r) => {
            writeCache(itunesKey, r);
            return r;
          });
      const openPromise = cachedOpen
        ? Promise.resolve(cachedOpen)
        : searchOpenLibrary(raw, perSourceLimit, controller).then((r) => {
            writeCache(openKey, r);
            return r;
          });
      const googlePromise =
        googleAllowed ? searchGoogle(googleQuery) : Promise.resolve([] as SearchResult[]);

      const settled = await Promise.allSettled([googlePromise, itunesPromise, openPromise]);
      const googleResults = settled[0].status === "fulfilled" ? settled[0].value : [];
      const itunesResults = settled[1].status === "fulfilled" ? settled[1].value : [];
      const openResults = settled[2].status === "fulfilled" ? settled[2].value : [];

      let combined = mergeDedupeAndRank(raw, [googleResults, itunesResults, openResults], maxResults);

      if (combined.length === 0 && titlePart && authorPart) {
        // Fallback: zoek op auteur-only als titel/spelling geen resultaten oplevert.
        const authorOnly = authorPart.trim();
        if (authorOnly) {
          const itunesKey2 = cacheKey(authorOnly, perSourceLimit, "itunes");
          const openKey2 = cacheKey(authorOnly, perSourceLimit, "openlibrary");
          const cachedItunes2 = readCache(itunesKey2);
          const cachedOpen2 = readCache(openKey2);

          const itunesPromise2 = cachedItunes2
            ? Promise.resolve(cachedItunes2)
            : searchItunesBooks(authorOnly, perSourceLimit, controller).then((r) => {
                writeCache(itunesKey2, r);
                return r;
              });
          const openPromise2 = cachedOpen2
            ? Promise.resolve(cachedOpen2)
            : searchOpenLibrary(authorOnly, perSourceLimit, controller).then((r) => {
                writeCache(openKey2, r);
                return r;
              });

          const googlePromise2 = googleAllowed ? searchGoogle(authorOnly) : Promise.resolve([] as SearchResult[]);
          const settled2 = await Promise.allSettled([googlePromise2, itunesPromise2, openPromise2]);
          const googleResults2 = settled2[0].status === "fulfilled" ? settled2[0].value : [];
          const itunesResults2 = settled2[1].status === "fulfilled" ? settled2[1].value : [];
          const openResults2 = settled2[2].status === "fulfilled" ? settled2[2].value : [];

          combined = mergeDedupeAndRank(raw, [googleResults2, itunesResults2, openResults2], maxResults);
        }
      }

      const filtered =
        authorPart.trim().length > 0 ? combined.filter((r) => resultMatchesAuthorFilter(r, authorPart)) : combined;
      setSearchResults(filtered);

      if (GOOGLE_BOOKS_API_KEY && GOOGLE_BOOKS_API_KEY.trim() && !googleAllowed) {
        setSearchError("Google Books is tijdelijk uitgeschakeld (quota). Zoeken gaat via Apple Books/Open Library.");
      }
    } catch (error) {
      // Abort is expected when user keeps typing
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("Search error:", error);
      setSearchError("Zoeken lukt nu niet (netwerk/API). Probeer later opnieuw.");
      setSuggestions([]);
      setSearchResults([]);
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);
    if (searchByAuthor) {
      try {
        const results = await searchOpenLibraryByAuthor(searchTerm);
        setAuthorSearchQuery(searchTerm.trim());
        setAuthorSearchResults(results);
        setSelectedAuthorBookIds(new Set());
        setShowAuthorBooksModal(true);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "Zoeken op auteur mislukt.");
      } finally {
        setIsSearching(false);
      }
    } else {
      await searchBooks(searchTerm, false);
      setIsSearching(false);
    }
  }

  // Autocomplete suggesties terwijl je typt
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Suggesties pas vanaf 3 tekens (niet bij zoek op auteur)
    if (
      !searchByAuthor &&
      searchTerm.trim().length >= 3 &&
      !suggestionJustSelectedRef.current
    ) {
      searchTimeoutRef.current = setTimeout(() => {
        if (suggestionJustSelectedRef.current) return;
        searchBooks(searchTerm, true);
        setShowSuggestions(true);
        setActiveSuggestionIndex(-1);
      }, 450);
    } else {
      suggestionJustSelectedRef.current = false;
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm]);

  // Sluit suggesties als je buiten klikt
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setShowAuthorSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function selectSuggestion(suggestion: SearchResult) {
    suggestionJustSelectedRef.current = true;
    const split = splitSeriesFromTitle(suggestion.title);
    const nextTitle = normalizeSeriesPartTitleCase(split.title);
    const nextAuthor = suggestion.authors;
    setSearchTitle(nextTitle);
    setSearchAuthor(nextAuthor);
    const query = `${nextTitle} - ${nextAuthor}`;
    setShowSuggestions(false);
    setShowAuthorSuggestions(false);
    setSuggestions([]);
    setActiveSuggestionIndex(-1);
    // Voer direct een zoekopdracht uit
    setIsSearching(true);
    await searchBooks(query, false);
    setIsSearching(false);
  }

  function addFromSearch(result: SearchResult, targetShelfId: string) {
    const existing = findExistingBookForResult(result);
    const statusFromShelf = STATUS_BY_SHELF_ID[targetShelfId];
    const shelfName = shelves.find((s) => s.id === targetShelfId)?.name ?? "boekenkast";
    const showAddedToast = () => {
      setToast(`Toegevoegd: "${result.title}" staat nu op "${shelfName}".`);
      window.setTimeout(() => setToast(""), 3000);
    };

    // Als het boek al bestaat in de bibliotheek
    if (existing) {
      const highlightToken = getQueryHighlightToken(
        searchTerm,
        result.title,
        result.authors
      );
      const highlightOriginal = highlightToken
        ? getTokenFromQueryOriginalCase(searchTerm, highlightToken)
        : null;

      const shouldNormalizeExistingToPartTitle =
        existing.seriesName &&
        normalizeForMatch(existing.title) === normalizeForMatch(existing.seriesName) &&
        (highlightOriginal || highlightToken);

      if (shouldNormalizeExistingToPartTitle) {
        const nextTitle = normalizeSeriesPartTitleCase(
          highlightOriginal ?? highlightToken!
        );
        if (normalizeForMatch(existing.title) !== normalizeForMatch(nextTitle)) {
          const updated = books.map((b) =>
            b.id === existing.id ? { ...b, title: nextTitle, seriesName: existing.seriesName } : b
          );
          persist(updated);
        }
      }

      // Standaardboekenkasten (status-gebonden)
      if (statusFromShelf) {
        // Al dezelfde status → al op deze boekenkast
        if (existing.status === statusFromShelf) {
          setToast(`Dit boek staat al op "${shelfName}".`);
          window.setTimeout(() => setToast(""), 2500);
          return;
        }
        // Andere status: via zoeken geen status-wijziging forceren, alleen feedback geven
        setToast(
          `Dit boek staat al in je bibliotheek met status "${STATUS_LABELS[existing.status]}".`
        );
        window.setTimeout(() => setToast(""), 2500);
        return;
      }

      // Custom boekenkasten: voeg alleen toe als het boek nog niet op die boekenkast staat
      const currentShelfIds = existing.shelfIds ?? [];
      if (currentShelfIds.includes(targetShelfId)) {
        setToast(`Dit boek staat al op "${shelfName}".`);
        window.setTimeout(() => setToast(""), 2500);
        return;
      }

      const updated: Book = {
        ...existing,
        shelfIds: [...currentShelfIds, targetShelfId]
      };
      const next = books.map((b) => (b.id === existing.id ? updated : b));
      persist(next);
      showAddedToast();
      return;
    }

    // Nog niet in bibliotheek → nieuw boek aanmaken
    const effectiveStatus: ReadStatus =
      statusFromShelf ?? "geen-status";

    const shelfIds =
      statusFromShelf != null
        ? undefined
        : [targetShelfId];

    const split = splitSeriesFromTitle(result.title);
    const highlightToken = getQueryHighlightToken(
      searchTerm,
      result.title,
      result.authors
    );
    const highlightOriginal = highlightToken
      ? getTokenFromQueryOriginalCase(searchTerm, highlightToken)
      : null;

    const newBook: Book = {
      id: result.id,
      title:
          split.seriesName &&
          normalizeForMatch(split.title) === normalizeForMatch(split.seriesName) &&
          (highlightOriginal || highlightToken)
            ? normalizeSeriesPartTitleCase(highlightOriginal ?? highlightToken!)
            : normalizeSeriesPartTitleCase(split.title),
      authors: result.authors,
      coverUrl: result.coverUrl,
      description: result.description,
      pageCount: result.pageCount,
      status: effectiveStatus,
      ...(split.seriesName && { seriesName: split.seriesName }),
      ...(shelfIds && { shelfIds })
    };
    persist([...books, newBook]);
    showAddedToast();
  }

  function startAddFromSearch(result: SearchResult) {
    setAddToShelfResult(result);
    setAddToShelfSelectedShelfIds(new Set());
    setShowAddToShelfModal(true);
  }

  function updateStatus(bookId: string, status: ReadStatus) {
    const updated = books.map((b) => {
      if (b.id === bookId) {
        const changes: Partial<Book> = { status };
        // Als status wordt gewijzigd naar "gelezen" en er is nog geen finishedAt datum, zet de huidige datum
        if (status === "gelezen" && !b.finishedAt) {
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, "0");
          const day = String(today.getDate()).padStart(2, "0");
          changes.finishedAt = `${year}-${month}-${day}`;
        }
        return { ...b, ...changes };
      }
      return b;
    });
    persist(updated);
  }

  function updateRating(bookId: string, rating: number) {
    const updated = books.map((b) =>
      b.id === bookId ? { ...b, rating } : b
    );
    persist(updated);
  }

  function removeBook(bookId: string) {
    const updated = books.filter((b) => b.id !== bookId);
    persist(updated);
  }

  function openManualBookModal(prefill?: { title?: string; authors?: string; seriesName?: string; genre?: string }) {
    setManualTitle(prefill?.title ? prefill.title : "");
    setManualAuthors(prefill?.authors ? prefill.authors : "");
    setManualPageCount("");
    setManualSeriesName(prefill?.seriesName ? prefill.seriesName : "");
    setManualSeriesNumber("");
    setManualUseCustomSeries(false);
    setManualCoverUrl("");
    setManualGenre(prefill?.genre ? prefill.genre : "");
    const tbrShelf = shelves.find((s) => s.id === "wil-ik-lezen");
    setManualShelfIds(tbrShelf ? [tbrShelf.id] : []);
    setShowManualBookModal(true);
  }

  function getGoodreadsSearchUrl(title?: string, authors?: string): string | null {
    const t = title?.trim();
    const a = authors?.trim();
    if (!t && !a) return null;
    const q = [t, a].filter(Boolean).join(" ");
    return `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
  }

  function openInAdjacentWindow(url: string) {
    const width = Math.min(1100, Math.max(700, window.outerWidth - 80));
    const height = Math.min(900, Math.max(650, window.outerHeight - 120));
    const gap = 40; // ruimte tussen boektracker en Goodreads

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
    const features = `popup=true,resizable=yes,width=${Math.round(width)},height=${Math.round(height)},left=${Math.round(left)},top=${Math.round(clampedTop)}`;

    const w = window.open(url, "goodreads_genre_shared", features);
    w?.focus?.();
    return w;
  }

  function closeManualBookModal() {
    setShowManualBookModal(false);
  }

  function addManualBook(e?: FormEvent) {
    e?.preventDefault();
    const title = manualTitle.trim();
    if (!title) return;
    const pageCount =
      manualPageCount.trim() !== "" ? Number(manualPageCount.trim()) || undefined : undefined;
    const effectiveStatus: ReadStatus =
      statusFilter === "alle" ? "wil-ik-lezen" : statusFilter;

    const seriesName = manualSeriesName.trim() || undefined;
    const seriesNum = manualSeriesNumber.trim() !== "" ? Number(manualSeriesNumber.trim()) || undefined : undefined;
    const coverUrl = manualCoverUrl.trim() || undefined;
    const finalGenre = parseGenresPreserveOrder(manualGenre).join(", ");
    const genre = finalGenre || undefined;
    const shelfIds =
      effectiveStatus === "wil-ik-lezen" ||
      effectiveStatus === "aan-het-lezen" ||
      effectiveStatus === "gelezen"
        ? manualShelfIds.length > 0
          ? manualShelfIds
          : undefined
        : manualShelfIds.length > 0
          ? manualShelfIds
          : undefined;

    const newBook: Book = {
      id: `manual-${Date.now()}`,
      title,
      authors: manualAuthors.trim(),
      pageCount,
      status: effectiveStatus,
      ...(seriesName && { seriesName }),
      ...(seriesNum != null && seriesNum > 0 && { seriesNumber: seriesNum }),
      ...(coverUrl && { coverUrl }),
      ...(genre && { genre }),
      ...(shelfIds && { shelfIds })
    };
    persist([...books, newBook]);
    closeManualBookModal();
  }

  async function fetchExtraInfoForBook(book: Book): Promise<Partial<Book> | null> {
    try {
      const url = new URL(GOOGLE_BOOKS_API);
      const query = `${book.title} ${book.authors}`;
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", "1");

      const res = await fetch(url.toString());
      const data = await res.json();
      const item = data.items?.[0];
      if (!item) return null;

      const info = item.volumeInfo ?? {};
      const coverUrl =
        info.imageLinks?.thumbnail ??
        info.imageLinks?.smallThumbnail ??
        info.imageLinks?.medium ??
        undefined;

      let description = info.description as string | undefined;
      if (description && description.length > 1000) {
        description = description.substring(0, 1000) + "...";
      }
      const pageCount =
        typeof info.pageCount === "number" ? info.pageCount : undefined;

      const enriched: Partial<Book> = {};
      if (description) enriched.description = description;
      if (pageCount) enriched.pageCount = pageCount;
      if (coverUrl && !book.coverUrl) {
        enriched.coverUrl = (coverUrl as string).replace("http://", "https://");
      }
      return enriched;
    } catch (e) {
      console.error("Enrich error for book", book.title, e);
      return null;
    }
  }

  async function enrichTbrDescriptions() {
    if (isEnrichingTBR) return;
    setIsEnrichingTBR(true);
    try {
      let updatedBooks = [...books];
      const tbrBooks = books.filter((b) => b.status === "wil-ik-lezen");
      for (const book of tbrBooks) {
        // Sla boeken over die al voldoende info hebben
        if (book.description && book.pageCount) continue;
        const extra = await fetchExtraInfoForBook(book);
        if (!extra) continue;
        updatedBooks = updatedBooks.map((b) =>
          b.id === book.id
            ? {
                ...b,
                description: extra.description || b.description,
                pageCount: extra.pageCount ?? b.pageCount,
                coverUrl: extra.coverUrl ?? b.coverUrl
              }
            : b
        );
      }
      if (updatedBooks !== books) {
        persist(updatedBooks);
      }
    } finally {
      setIsEnrichingTBR(false);
    }
  }

  function goToDetails(bookId: string) {
    const from = mode === "library" ? "?from=bibliotheek" : "";
    const encodedBookId = encodeURIComponent(bookId);
    navigate(withBase(basePath, `/boek/${encodedBookId}${from}`));
  }

  /** Voor een boek in de weekchallenge: huidige bladzijde (hoogste uit dailyReadingPerBook) en totaal. */
  function getChallengeProgress(bookId: string): { current: number; total: number } | null {
    const wc = challenge?.weeklyChallenge;
    if (!wc) return null;
    const plan = wc.books.find((p) => p.bookId === bookId);
    if (!plan) return null;
    const perBook = challenge.dailyReadingPerBook || {};
    let current = 0;
    for (const dayRecord of Object.values(perBook)) {
      const val = dayRecord[bookId];
      if (typeof val === "number" && val > current) current = val;
    }
    return { current, total: plan.totalPages };
  }

  return (
    <div className="page">
      {showSearch && (
        <section className="card">
          <form onSubmit={handleSearch} className="search-form">
            {/* Hint removed (UI already guides via placeholders) */}
            <div className="search-input-wrapper" ref={suggestionsRef}>
              <div className="search-input-inner">
                <input
                  ref={searchTitleInputRef}
                  type="search"
                  placeholder="Titel…"
                  value={searchTitle}
                  onChange={(e) => {
                    suggestionJustSelectedRef.current = false;
                    setSearchTitle(e.target.value);
                  }}
                  onFocus={() => {
                    if (!searchByAuthor && suggestions.length > 0 && !suggestionJustSelectedRef.current) {
                      setShowSuggestions(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      setShowSuggestions(false);
                      setActiveSuggestionIndex(-1);
                      // Mobile: this is also the "next" action when tabbing through.
                      searchAuthorInputRef.current?.focus();
                      return;
                    }

                    // On mobile, pressing Enter ("Next") should jump to the author field instead of submitting,
                    // but only when we haven't selected a suggestion yet.
                    if (e.key === "Enter" && activeSuggestionIndex < 0 && searchAuthor.trim().length === 0) {
                      e.preventDefault();
                      setShowSuggestions(false);
                      setActiveSuggestionIndex(-1);
                      searchAuthorInputRef.current?.focus();
                      return;
                    }

                    if (searchByAuthor) return;
                    if (!showSuggestions || suggestions.length === 0) return;

                    if (e.key === "Escape") {
                      setShowSuggestions(false);
                      setActiveSuggestionIndex(-1);
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveSuggestionIndex((idx) => Math.min(suggestions.length - 1, idx + 1));
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveSuggestionIndex((idx) => Math.max(0, idx <= 0 ? 0 : idx - 1));
                      return;
                    }
                    if (e.key === "Enter" && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
                      e.preventDefault();
                      selectSuggestion(suggestions[activeSuggestionIndex]);
                      return;
                    }
                  }}
                  className="search-input search-input-with-clear"
                />
                {searchTitle.trim().length > 0 && (
                  <button
                    type="button"
                    className="search-clear-button"
                    onClick={() => {
                      setSearchTitle("");
                      setSuggestions([]);
                      setShowSuggestions(false);
                      setSearchResults([]);
                      setSearchError("");
                      setActiveSuggestionIndex(-1);
                    }}
                    aria-label="Zoekterm wissen"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="search-input-inner">
                <input
                  ref={searchAuthorInputRef}
                  type="search"
                  placeholder="Auteur…"
                  value={searchAuthor}
                  onChange={(e) => {
                    suggestionJustSelectedRef.current = false;
                    setSearchAuthor(e.target.value);
                    setActiveAuthorSuggestionIndex(-1);
                  }}
                  onFocus={() => setShowAuthorSuggestions(true)}
                  onKeyDown={(e) => {
                    if (!showAuthorSuggestions || authorInputSuggestions.length === 0) return;

                    if (e.key === "Escape") {
                      e.preventDefault();
                      setShowAuthorSuggestions(false);
                      setActiveAuthorSuggestionIndex(-1);
                      return;
                    }

                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveAuthorSuggestionIndex((idx) => (idx < 0 ? 0 : Math.min(authorInputSuggestions.length - 1, idx + 1)));
                      return;
                    }

                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveAuthorSuggestionIndex((idx) =>
                        idx < 0 ? authorInputSuggestions.length - 1 : Math.max(0, idx - 1)
                      );
                      return;
                    }

                    if (e.key === "Enter") {
                      if (activeAuthorSuggestionIndex >= 0 && activeAuthorSuggestionIndex < authorInputSuggestions.length) {
                        e.preventDefault();
                        const name = authorInputSuggestions[activeAuthorSuggestionIndex];

                        suggestionJustSelectedRef.current = false;
                        setSearchAuthor(name);
                        setShowAuthorSuggestions(false);
                        setActiveAuthorSuggestionIndex(-1);
                        setSuggestions([]);
                        setShowSuggestions(false);
                        setActiveSuggestionIndex(-1);
                        setSearchError("");
                        return;
                      }

                      // If user presses Enter while dropdown is open, select the first item.
                      if (authorInputSuggestions.length > 0) {
                        e.preventDefault();
                        const name = authorInputSuggestions[0];

                        suggestionJustSelectedRef.current = false;
                        setSearchAuthor(name);
                        setShowAuthorSuggestions(false);
                        setActiveAuthorSuggestionIndex(-1);
                        setSuggestions([]);
                        setShowSuggestions(false);
                        setActiveSuggestionIndex(-1);
                        setSearchError("");
                      }
                      return;
                    }
                  }}
                  className="search-input search-input-with-clear"
                />
                {searchAuthor.trim().length > 0 && (
                  <button
                    type="button"
                    className="search-clear-button"
                    onClick={() => {
                      setSearchAuthor("");
                      setShowAuthorSuggestions(false);
                      setActiveAuthorSuggestionIndex(-1);
                      setSuggestions([]);
                      setShowSuggestions(false);
                      setSearchResults([]);
                      setSearchError("");
                      setActiveSuggestionIndex(-1);
                    }}
                    aria-label="Auteur wissen"
                  >
                    ×
                  </button>
                )}
                {showAuthorSuggestions && authorInputSuggestions.length > 0 && (
                  <div
                    ref={authorSuggestionsContainerRef}
                    className="author-input-suggestions"
                    role="listbox"
                    aria-label="Auteur suggesties"
                  >
                    {authorInputSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={`author-input-suggestion-item${name === authorInputSuggestions[activeAuthorSuggestionIndex] ? " active" : ""}`}
                        role="option"
                        onClick={() => {
                          suggestionJustSelectedRef.current = false;
                          setSearchAuthor(name);
                          setShowAuthorSuggestions(false);
                          setActiveAuthorSuggestionIndex(-1);
                          setSuggestions([]);
                          setShowSuggestions(false);
                          setActiveSuggestionIndex(-1);
                          setSearchError("");
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {showSuggestions && suggestions.length > 0 && searchResults.length === 0 && (
                <div className="search-results search-suggestions-inline" aria-label="Zoeksuggesties">
                  {suggestions.map((suggestion, idx) => {
                    const existingBook = findExistingBookForResult(suggestion);
                    const alreadyRead = existingBook?.status === "gelezen";
                    const highlightToken = getQueryHighlightToken(
                      searchTerm,
                      suggestion.title,
                      suggestion.authors
                    );
                    const split = existingBook
                      ? { title: existingBook.title, seriesName: existingBook.seriesName }
                      : splitSeriesFromTitle(suggestion.title);
                    const shouldUseQueryTokenAsPartTitle =
                      split.seriesName &&
                      normalizeForMatch(split.title) === normalizeForMatch(split.seriesName) &&
                      !!highlightToken;

                    const displayTitle = shouldUseQueryTokenAsPartTitle
                      ? getTokenFromQueryOriginalCase(searchTerm, highlightToken!) ?? highlightToken!
                      : split.title;
                    const normalizedDisplayTitle = normalizeSeriesPartTitleCase(displayTitle);

                    return (
                      <div
                        key={suggestion.id}
                        className={`search-result-card${idx === activeSuggestionIndex ? " active" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectSuggestion(suggestion)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectSuggestion(suggestion);
                          }
                        }}
                        title="Klik om zoekresultaten te tonen"
                      >
                        {suggestion.coverUrl ? (
                          <img
                            src={suggestion.coverUrl}
                            alt={suggestion.title}
                            className="book-cover-small"
                          />
                        ) : (
                          <div className="book-cover-small-placeholder" aria-hidden="true">
                            {suggestion.title.charAt(0).toUpperCase()}
                          </div>
                        )}
                          <div className="search-result-main">
                          {split.seriesName && (
                            <div className="search-result-series-badge">
                              {split.seriesName}
                            </div>
                          )}
                          <div className="search-result-title">{normalizedDisplayTitle}</div>
                          <div className="search-result-authors">{suggestion.authors}</div>
                          <div className="search-result-meta">
                            <span className="search-result-source">
                              {getResultSourceLabel(suggestion)}
                            </span>
                            {(() => {
                              const label = getLanguageLabel(suggestion);
                              return label ? (
                                <span className="search-result-language-subtle">{label}</span>
                              ) : null;
                            })()}
                            {existingBook && getExistingBookShelfNames(existingBook).length > 0 && (
                              <span className="search-result-added-to">
                                Boekenkast(en): {getExistingBookShelfNames(existingBook).join(", ")}
                              </span>
                            )}
                            {typeof suggestion.pageCount === "number" && (
                              <span className="search-result-pages">
                                {suggestion.pageCount} blz
                              </span>
                            )}
                            {alreadyRead && (
                              <span className="search-result-status-pill">
                                Al gelezen
                              </span>
                            )}
                            <span className="search-result-hint">Toon in resultaten</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startAddFromSearch(suggestion);
                          }}
                          className="secondary-button"
                        >
                          Toevoegen
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <button type="submit" className="primary-button" disabled={isSearching}>
              {isSearching ? "Zoeken..." : "Zoeken"}
            </button>
          </form>
          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              onClick={() => {
                const titleInput = searchTitle.trim();
                const authorInput = searchAuthor.trim();

                // Altijd automatisch invullen als de gebruiker iets heeft ingevuld.
                // Ook als er nog resultaten/suggesties zichtbaar zijn of een zoekactie bezig is.
                if (titleInput || authorInput) {
                  const split = titleInput ? splitSeriesFromTitle(titleInput) : { title: titleInput };
                  const prefillTitle = titleInput
                    ? normalizeSeriesPartTitleCase(toTitleCase(split.title))
                    : undefined;
                  const prefillAuthors = authorInput ? toAuthorNameCase(authorInput) : undefined;

                  openManualBookModal({
                    title: prefillTitle,
                    authors: prefillAuthors
                  });
                  return;
                }

                openManualBookModal();
              }}
              className="secondary-button"
            >
              Handmatig boek toevoegen
            </button>
          </div>
          {searchError && (
            <p className="page-intro-small" style={{ marginTop: 10 }}>
              {searchError}
            </p>
          )}
          {!isSearching && searchTerm.trim().length > 0 && searchResults.length === 0 && !searchByAuthor && (
            <div className="search-empty">
              <p className="page-intro-small" style={{ marginTop: 10 }}>
                  Geen resultaten. Probeer een andere schrijfwijze, of zoek als <strong>Titel - Auteur</strong>.
              </p>
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((r) => (
                (() => {
                  const existingBook = findExistingBookForResult(r);
                  const alreadyRead = existingBook?.status === "gelezen";
                  const highlightToken = getQueryHighlightToken(
                    searchTerm,
                    r.title,
                    r.authors
                  );
                  const split = existingBook
                    ? { title: existingBook.title, seriesName: existingBook.seriesName }
                    : splitSeriesFromTitle(r.title);
                  const shouldUseQueryTokenAsPartTitle =
                    split.seriesName &&
                    normalizeForMatch(split.title) === normalizeForMatch(split.seriesName) &&
                    !!highlightToken;

                  const displayTitle = shouldUseQueryTokenAsPartTitle
                    ? getTokenFromQueryOriginalCase(searchTerm, highlightToken!) ?? highlightToken!
                    : split.title;
                  const normalizedDisplayTitle = normalizeSeriesPartTitleCase(displayTitle);

                  return (
                <div
                  key={r.id}
                  className="search-result-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openSearchResult(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openSearchResult(r);
                    }
                  }}
                  title="Klik voor samenvatting"
                >
                  {r.coverUrl ? (
                    <img
                      src={r.coverUrl}
                      alt={r.title}
                      className="book-cover-small"
                    />
                  ) : (
                    <div className="book-cover-small-placeholder" aria-hidden="true">
                      {r.title.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="search-result-main">
                    {split.seriesName && (
                      <div className="search-result-series-badge">
                        {split.seriesName}
                      </div>
                    )}
                    <div className="search-result-title">{normalizedDisplayTitle}</div>
                    <div className="search-result-authors">{r.authors}</div>
                    <div className="search-result-meta">
                      <span className="search-result-source">{getResultSourceLabel(r)}</span>
                      {(() => {
                        const label = getLanguageLabel(r);
                        return label ? <span className="search-result-language-subtle">{label}</span> : null;
                      })()}
                      {existingBook && getExistingBookShelfNames(existingBook).length > 0 && (
                        <span className="search-result-added-to">
                          Boekenkast(en): {getExistingBookShelfNames(existingBook).join(", ")}
                        </span>
                      )}
                      {typeof r.pageCount === "number" && (
                        <span className="search-result-pages">
                          {r.pageCount} blz
                        </span>
                      )}
                      {alreadyRead && (
                        <span className="search-result-status-pill">
                          Al gelezen
                        </span>
                      )}
                      <span className="search-result-hint">Klik voor samenvatting</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startAddFromSearch(r);
                    }}
                    className="secondary-button"
                  >
                    Toevoegen
                  </button>
                  <button
                    type="button"
                    className="link-button search-result-details-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const baseTitle = split.title;
                      const prefillTitle = normalizeSeriesPartTitleCase(baseTitle);
                      openManualBookModal({
                        title: prefillTitle,
                        authors: r.authors,
                        seriesName: split.seriesName
                      });
                    }}
                  >
                    Met details
                  </button>
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </section>
      )}

      {showLibrary && (
        <section className="card">
          <header className="section-header">
            <h2>Mijn bibliotheek</h2>
            <div className="filters">
              <label>
                Status:
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    const next = e.target.value as ReadStatus | "alle";
                    setStatusFilter(next);
                    if (next === "alle") {
                      setSearchParams({});
                    } else {
                      setSearchParams({ status: next });
                    }
                  }}
                >
                  <option value="alle">Alle</option>
                  <option value="wil-ik-lezen">Wil ik lezen</option>
                  <option value="aan-het-lezen">Aan het lezen</option>
                  <option value="gelezen">Gelezen</option>
                  <option value="geen-status">Geen status</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={enrichTbrDescriptions}
                disabled={isEnrichingTBR}
              >
                {isEnrichingTBR ? "TBR aanvullen..." : "TBR-beschrijvingen ophalen"}
              </button>
            </div>
          </header>

          {filteredBooks.length === 0 ? (
            <p>Nog geen boeken in deze lijst.</p>
          ) : (
            <div className="book-grid">
              {filteredBooks.map((book) => {
                const progress = getChallengeProgress(book.id);
                const showDailyGoalProgress =
                  book.status === "aan-het-lezen" && progress && progress.total > 0;
                return (
                <article key={book.id} className="book-card">
                  <div className="book-card-header">
                    {book.coverUrl && (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="book-cover"
                      />
                    )}
                    <div className="book-main">
                      {book.seriesName && (
                        <div className="book-series-badge">
                          {book.seriesName}
                          {book.seriesNumber && ` #${book.seriesNumber}`}
                        </div>
                      )}
                      <h3>{book.title}</h3>
                      <p className="book-authors">{book.authors}</p>
                      {book.genre && (
                        (() => {
                          const genres = parseGenresPreserveOrder(book.genre);
                          const fullGenres = genres.join(", ");
                          const extraCount = Math.max(0, genres.length - 2);
                          const previewGenres =
                            genres.length <= 2 ? fullGenres : genres.slice(0, 2).join(", ");
                          const isOpen = extraCount > 0 && expandedGenreBookId === book.id;

                          return (
                            <div
                              className="book-genre-badge genre-preview-toggle"
                              onMouseEnter={() => {
                                if (extraCount > 0) setExpandedGenreBookId(book.id);
                              }}
                              onMouseLeave={() => {
                                if (isOpen) setExpandedGenreBookId(null);
                              }}
                              onClick={(e) => {
                                if (extraCount <= 0) return;
                                e.preventDefault();
                                e.stopPropagation();
                                setExpandedGenreBookId((prev) => (prev === book.id ? null : book.id));
                              }}
                            >
                              <span className="genre-preview-text">{previewGenres}</span>
                              {extraCount > 0 && (
                                <span className="genre-preview-more"> +{extraCount}</span>
                              )}
                              {isOpen && extraCount > 0 && (
                                <div className="genre-preview-popover">
                                  {genres.map((g) => (
                                    <div key={g} className="genre-preview-line">
                                      {g}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()
                      )}
                      {getBookPlankNames(book).length > 0 && (
                        <div className="book-planks">
                          <span className="book-planks-label">Boekenkasten:</span>
                          {getBookPlankNames(book).map((name) => (
                            <span key={name} className="plank-pill plank-pill-inline">{name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {showDailyGoalProgress && (
                    <div className="book-card-challenge-progress">
                      <span className="book-card-challenge-label">Voortgang (dagelijkse leesdoel)</span>
                      <div className="book-card-challenge-bar-wrap">
                        <div
                          className="book-card-challenge-bar-fill"
                          style={{ width: `${Math.min(100, (progress!.current / progress!.total) * 100)}%` }}
                        />
                      </div>
                      <span className="book-card-challenge-pages">
                        Je bent op bladzijde <strong>{progress!.current}</strong> van {progress!.total}
                      </span>
                    </div>
                  )}
                  <div className="book-meta">
                    <label>
                      Status:
                      <select
                        value={book.status}
                        onChange={(e) =>
                          updateStatus(book.id, e.target.value as ReadStatus)
                        }
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <span>Beoordeling:</span>
                      <RatingStars
                        value={book.rating}
                        onChange={(val) => updateRating(book.id, val)}
                      />
                    </div>
                  </div>
                  <div className="book-card-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => goToDetails(book.id)}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      className="link-button destructive"
                      onClick={() => removeBook(book.id)}
                    >
                      Verwijderen
                    </button>
                  </div>
                </article>
              );
              })}
            </div>
          )}
        </section>
      )}

      {toast && <div className="toast">{toast}</div>}

      {showAddToShelfModal && addToShelfResult && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowAddToShelfModal(false);
            setAddToShelfResult(null);
            setAddToShelfSelectedShelfIds(new Set());
          }}
        >
          <div
            className="modal modal-add-to-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Kies boekenkast voor dit boek</h3>
            <p className="modal-intro">
              Naar welke boekenkast wil je
              {" "}
              <strong>{addToShelfResult.title}</strong>
              {" "}
              van
              {" "}
              {addToShelfResult.authors || "onbekende auteur"}
              {" "}
              toevoegen?
            </p>
            <div className="add-to-shelf-selected-count">
              {addToShelfSelectedShelfIds.size > 0
                ? `${addToShelfSelectedShelfIds.size} geselecteerd`
                : "Selecteer boekenkasten"}
            </div>
            <ul className="add-to-shelf-list">
              {(() => {
                const existing = findExistingBookForResult(addToShelfResult);
                return shelvesSortedForAddToShelf.map((shelf) => {
                  const statusFromShelf = STATUS_BY_SHELF_ID[shelf.id];
                  const alreadyOnShelf = existing
                    ? statusFromShelf
                      ? existing.status === statusFromShelf
                      : (existing.shelfIds ?? []).includes(shelf.id)
                    : false;
                  const isSelected = addToShelfSelectedShelfIds.has(shelf.id);
                  return (
                    <li key={shelf.id}>
                      <button
                        type="button"
                        className={`add-to-shelf-item${
                          alreadyOnShelf ? " add-to-shelf-item-disabled" : ""
                        }${!alreadyOnShelf && isSelected ? " add-to-shelf-item-selected" : ""}`}
                        onClick={() => {
                          if (alreadyOnShelf) {
                            const shelfName =
                              shelves.find((s) => s.id === shelf.id)?.name ?? "boekenkast";
                            setToast(`Dit boek staat al op "${shelfName}".`);
                            window.setTimeout(() => setToast(""), 2500);
                            return;
                          }
                          setAddToShelfSelectedShelfIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(shelf.id)) next.delete(shelf.id);
                            else next.add(shelf.id);
                            return next;
                          });
                        }}
                      >
                        {shelf.name}
                        {shelf.system && (
                          <span className="tag" style={{ marginLeft: 8 }}>
                            Standaard
                          </span>
                        )}
                        {alreadyOnShelf && (
                          <span className="tag" style={{ marginLeft: 8 }}>
                            Al toegevoegd
                          </span>
                        )}
                        {!alreadyOnShelf && isSelected && (
                          <span className="tag" style={{ marginLeft: 8 }}>
                            Geselecteerd
                          </span>
                        )}
                      </button>
                    </li>
                  );
                });
              })()}
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowAddToShelfModal(false);
                  setAddToShelfResult(null);
                  setAddToShelfSelectedShelfIds(new Set());
                }}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={addToShelfSelectedShelfIds.size === 0}
                onClick={() => {
                  Array.from(addToShelfSelectedShelfIds).forEach((shelfId) => {
                    addFromSearch(addToShelfResult, shelfId);
                  });
                  setShowAddToShelfModal(false);
                  setAddToShelfResult(null);
                  setAddToShelfSelectedShelfIds(new Set());
                }}
              >
                Toevoegen ({addToShelfSelectedShelfIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuthorBooksModal && authorSearchQuery && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowAuthorBooksModal(false);
            setShowAuthorShelfPicker(false);
            setAuthorLanguageFilter("");
          }}
        >
          <div className="modal modal-author-books" onClick={(e) => e.stopPropagation()}>
            <div className="modal-author-books-header">
              <h3>Boeken van {authorSearchQuery}</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Sluiten"
                onClick={() => {
                  setShowAuthorBooksModal(false);
                  setShowAuthorShelfPicker(false);
                  setAuthorLanguageFilter("");
                }}
              >
                ×
              </button>
            </div>
            <p className="modal-intro">Selecteer de boeken die je wilt toevoegen en kies een boekenkast.</p>
            <div className="author-books-language-filter">
              <label htmlFor="author-language-filter">Taal:</label>
              <select
                id="author-language-filter"
                value={authorLanguageFilter}
                onChange={(e) => setAuthorLanguageFilter(e.target.value)}
                className="author-language-select"
              >
                {AUTHOR_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="author-books-list">
              {filteredAuthorBooks.map((r) => {
                const selected = selectedAuthorBookIds.has(r.id);
                const existing = findExistingBookForResult(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`author-book-row ${selected ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedAuthorBookIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      });
                    }}
                  >
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt="" className="author-book-cover" />
                    ) : (
                      <div className="author-book-cover author-book-cover-placeholder">{r.title.charAt(0)}</div>
                    )}
                    <div className="author-book-info">
                      <span className="author-book-title">{r.title}</span>
                      {r.pageCount != null && <span className="author-book-meta">{r.pageCount} blz</span>}
                      {existing && <span className="author-book-badge">Al in bibliotheek</span>}
                    </div>
                    {selected && <span className="author-book-check">✓</span>}
                  </button>
                );
              })}
            </div>
            {authorSearchResults.length === 0 && (
              <p className="page-intro-small">Geen boeken gevonden voor deze auteur.</p>
            )}
            {authorSearchResults.length > 0 && filteredAuthorBooks.length === 0 && (
              <p className="page-intro-small">Geen boeken in de geselecteerde taal. Kies een andere taal.</p>
            )}
            <div className="modal-author-books-actions">
              {selectedAuthorBookIds.size > 0 && (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setShowAuthorShelfPicker(!showAuthorShelfPicker)}
                  >
                    {selectedAuthorBookIds.size} geselecteerd · Toevoegen aan boekenkast
                  </button>
                  {showAuthorShelfPicker && (
                    <div className="author-shelf-picker">
                      {shelves.map((shelf) => (
                        <button
                          key={shelf.id}
                          type="button"
                          className="add-to-shelf-item"
                          onClick={() => {
                            const snapshots = authorSearchResults
                              .filter((b) => selectedAuthorBookIds.has(b.id))
                              .map((b) => ({ title: b.title, authors: b.authors, coverUrl: b.coverUrl }));
                            const result = shelf.system
                              ? addBookSnapshotsToMyLibrary(snapshots, { shelfId: shelf.id })
                              : addBookSnapshotsToMyLibrary(snapshots, { status: "geen-status", shelfId: shelf.id });
                            setToast(`${result.added} toegevoegd, ${result.skipped} stond/stonden al in je lijst.`);
                            window.setTimeout(() => setToast(""), 3000);
                            setShowAuthorBooksModal(false);
                            setShowAuthorShelfPicker(false);
                            setAuthorLanguageFilter("");
                            setSelectedAuthorBookIds(new Set());
                          }}
                        >
                          {shelf.name}
                        </button>
                      ))}
                      <div className="add-to-shelf-new">
                        <input
                          type="text"
                          value={authorNewShelfName}
                          onChange={(e) => setAuthorNewShelfName(e.target.value)}
                          placeholder="Nieuwe boekenkast naam…"
                          className="add-to-shelf-new-input"
                        />
                        <button
                          type="button"
                          className="add-to-shelf-item add-to-shelf-new-btn"
                          disabled={!authorNewShelfName.trim()}
                          onClick={() => {
                            const name = authorNewShelfName.trim();
                            if (!name) return;
                            const newShelf: Shelf = { id: `shelf-${Date.now()}`, name };
                            const next = [...shelves, newShelf];
                            saveShelves(next);
                            setShelves(next);
                            const snapshots = authorSearchResults
                              .filter((b) => selectedAuthorBookIds.has(b.id))
                              .map((b) => ({ title: b.title, authors: b.authors, coverUrl: b.coverUrl }));
                            const result = addBookSnapshotsToMyLibrary(snapshots, { status: "geen-status", shelfId: newShelf.id });
                            setToast(`${result.added} toegevoegd, ${result.skipped} stond/stonden al in je lijst.`);
                            window.setTimeout(() => setToast(""), 3000);
                            setShowAuthorBooksModal(false);
                            setShowAuthorShelfPicker(false);
                            setAuthorNewShelfName("");
                            setAuthorLanguageFilter("");
                            setSelectedAuthorBookIds(new Set());
                          }}
                        >
                          Nieuwe boekenkast aanmaken
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowAuthorBooksModal(false);
                  setShowAuthorShelfPicker(false);
                  setAuthorLanguageFilter("");
                }}
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualBookModal && (
        <div className="modal-backdrop" onClick={closeManualBookModal}>
          <div
            className="modal manual-book-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Handmatig boek toevoegen</h3>
            <form onSubmit={addManualBook} className="manual-book-form">
              <label className="form-field">
                <span>Titel *</span>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="Bijv. De avond is ongemak"
                  autoFocus
                  required
                />
              </label>
              <label className="form-field">
                <span>Auteur(s)</span>
                <div className="search-input-wrapper">
                  <div className="search-input-inner">
                    <input
                      type="text"
                      value={manualAuthors}
                      onChange={(e) => setManualAuthors(e.target.value)}
                      placeholder="Bijv. Marieke Lucas Rijneveld"
                    />
                    {manualAuthors && (
                      <button
                        type="button"
                        className="search-clear-button"
                        onClick={() => setManualAuthors("")}
                        aria-label="Auteur wissen"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {(() => {
                    const trimmed = manualAuthors.trim();
                    const parts = manualAuthors
                      .split(",")
                      .map((p) => p.trim())
                      .filter(Boolean);
                    const currentAuthors = parts;

                    const matches =
                      !trimmed
                        ? topAuthors.filter((name) => !currentAuthors.includes(name))
                        : existingAuthors
                            .filter((name) =>
                              name
                                .toLowerCase()
                                .includes((parts[parts.length - 1] ?? trimmed).toLowerCase())
                            )
                            .filter((name) => !currentAuthors.includes(name))
                            .slice(0, 8);

                    if (matches.length === 0) return null;
                    return (
                      <div className="search-suggestions">
                        {matches.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="search-suggestion-item"
                            onClick={() => {
                              const baseParts = manualAuthors
                                .split(",")
                                .map((p) => p.trim());
                              if (baseParts.length === 0) {
                                setManualAuthors(name + ", ");
                                return;
                              }
                              baseParts[baseParts.length - 1] = name;
                              const unique = Array.from(
                                new Set(
                                  baseParts
                                    .map((p) => p.trim())
                                    .filter(Boolean)
                                )
                              );
                              setManualAuthors(unique.join(", ") + ", ");
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </label>
              <label className="form-field">
                <span>Aantal pagina&apos;s (optioneel)</span>
                <input
                  type="number"
                  value={manualPageCount}
                  onChange={(e) => setManualPageCount(e.target.value)}
                  placeholder="Bijv. 320"
                  min={1}
                />
              </label>
              <label className="form-field">
                <span>Boekenkast(en)</span>
                <div className="book-detail-plank-pills">
                  {manualSelectedShelves.map((shelf) => (
                    <span key={shelf.id} className="plank-pill">
                      {shelf.name}
                      <button
                        type="button"
                        className="plank-pill-remove"
                        aria-label={`Verwijder uit boekenkast ${shelf.name}`}
                        onClick={() =>
                          setManualShelfIds((prev) => prev.filter((id) => id !== shelf.id))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {manualShelvesToAdd.length > 0 && (
                    <select
                      className="book-detail-add-plank-select"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setManualShelfIds((prev) =>
                          prev.includes(v) ? prev : [...prev, v]
                        );
                        e.target.value = "";
                      }}
                      aria-label="Toevoegen aan boekenkast"
                    >
                      <option value="">+ Toevoegen aan boekenkast</option>
                      {manualShelvesToAdd.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
              <label className="form-field">
                <span>Serie (optioneel)</span>
                {!manualUseCustomSeries && existingSeries.length > 0 ? (
                  <div className="series-select-wrapper">
                    <select
                      value={manualSeriesName}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new__") {
                          setManualUseCustomSeries(true);
                          setManualSeriesName("");
                        } else {
                          setManualSeriesName(v);
                        }
                      }}
                      className="series-select"
                    >
                      <option value="">Geen serie</option>
                      {existingSeries.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value="__new__">+ Nieuwe serie toevoegen</option>
                    </select>
                  </div>
                ) : (
                  <div className="series-input-wrapper">
                    <input
                      type="text"
                      value={manualSeriesName}
                      onChange={(e) => setManualSeriesName(e.target.value)}
                      placeholder="Bijv. De zeven zussen"
                      className="series-input"
                    />
                    {existingSeries.length > 0 && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setManualUseCustomSeries(false)}
                      >
                        Selecteer bestaande serie
                      </button>
                    )}
                  </div>
                )}
              </label>
              <label className="form-field">
                <span>Nummer in serie (optioneel)</span>
                <input
                  type="number"
                  value={manualSeriesNumber}
                  onChange={(e) => setManualSeriesNumber(e.target.value)}
                  placeholder="Bijv. 1.5"
                  min={1}
                  step="any"
                  className="manual-book-series-num"
                />
              </label>
              <label className="form-field">
                <span>Genre (optioneel)</span>
                {getGoodreadsSearchUrl(manualTitle, manualAuthors) && (
                  <a
                    href={getGoodreadsSearchUrl(manualTitle, manualAuthors) ?? undefined}
                    rel="noreferrer"
                    className="link-button"
                    aria-label="Zoek dit boek op Goodreads om genres te vinden"
                    onClick={(e) => {
                      const url = getGoodreadsSearchUrl(manualTitle, manualAuthors);
                      if (!url) return;
                      e.preventDefault();
                      const opened = openInAdjacentWindow(url);
                      if (!opened) {
                        window.open(url, "goodreads_genre_shared");
                      }
                    }}
                  >
                    Goodreads (genres)
                  </a>
                )}
                <div className="genre-pill-container">
                  {genrePillsForSelect.length === 0 ? (
                    <span className="page-intro-small">Geen genres gevonden. Voeg er één toe.</span>
                  ) : (
                    genrePillsForSelect.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className={`genre-pill ${selectedGenreSet.has(g) ? "selected" : ""}`}
                        onClick={() => {
                          const isSelected = selectedGenreSet.has(g);
                          const current = selectedGenres;
                          const ordered = isSelected
                            ? current.filter((x) => x !== g)
                            : [...current, g].filter(Boolean);
                          setManualGenre(ordered.join(", "));
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
                      value={manualGenreQuickAdd}
                      onChange={(e) => {
                        setManualGenreQuickAdd(e.target.value);
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
                        const v = manualGenreQuickAdd.trim();
                        if (!v) return; // Laat standaard submit (formulier) gebeuren.

                        e.preventDefault();

                        if (genreDropdownItems.length > 0) {
                          const idx =
                            activeGenreSuggestionIndex >= 0
                              ? activeGenreSuggestionIndex
                              : 0;
                          addGenreFromResolved(
                            genreDropdownItems[idx]?.value ?? v
                          );
                          setActiveGenreSuggestionIndex(-1);
                          return;
                        }

                        addGenreFromResolved(genreExactExisting ?? v);
                      }}
                      placeholder="Nieuwe genre toevoegen (optioneel)"
                      className="search-input search-input-with-clear"
                    />
                    {manualGenreQuickAdd.trim() && (
                      <button
                        type="button"
                        className="search-clear-button"
                        onClick={() => setManualGenreQuickAdd("")}
                        aria-label="Genre input wissen"
                      >
                        ×
                      </button>
                    )}
                    {manualGenreQuickAdd.trim() && genreDropdownItems.length > 0 && (
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
                    disabled={!manualGenreQuickAdd.trim()}
                    onClick={() => {
                      const v = manualGenreQuickAdd.trim();
                      if (!v) return;
                      const resolved = genreExactExisting ?? genreQuickAddSuggestions[0] ?? v;
                      addGenreFromResolved(resolved);
                    }}
                  >
                    + Voeg toe
                  </button>
                </div>
              </label>
              <label className="form-field">
                <span>Link naar kaft (optioneel)</span>
                {getGoodreadsSearchUrl(manualTitle, manualAuthors) && (
                  <a
                    href={getGoodreadsSearchUrl(manualTitle, manualAuthors) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="link-button"
                    aria-label="Zoek dit boek op Goodreads om de kaft te kopieren"
                  >
                    Goodreads
                  </a>
                )}
                <input
                  type="url"
                  value={manualCoverUrl}
                  onChange={(e) => setManualCoverUrl(e.target.value)}
                  placeholder="Bijv. https://... afbeelding.jpg"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={closeManualBookModal}>
                  Annuleren
                </button>
                <button type="submit" className="primary-button">
                  Toevoegen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedSearchResult && (
        <div className="modal-backdrop" onClick={() => setSelectedSearchResult(null)}>
          <div
            className="modal"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3>{selectedSearchResult.title}</h3>
            <p className="modal-intro">{selectedSearchResult.authors}</p>

            {typeof selectedSearchResult.pageCount === "number" && (
              <div className="modal-page-count-edit" style={{ marginTop: 0 }}>
                <span className="modal-page-count-label">Pagina&apos;s:</span>
                <span className="modal-page-count-value">
                  {selectedSearchResult.pageCount}
                </span>
              </div>
            )}

            {selectedSearchResult.coverUrl && (
              <div className="modal-book-cover">
                <img
                  src={selectedSearchResult.coverUrl}
                  alt={selectedSearchResult.title}
                />
              </div>
            )}

            <p className="modal-description">
              {normalizeDescription(selectedSearchResult.description) ||
                "Er is nog geen samenvatting beschikbaar voor dit boek."}
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelectedSearchResult(null)}
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


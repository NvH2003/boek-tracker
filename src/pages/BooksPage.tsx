import { FormEvent, useMemo, useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Book, ReadStatus, Shelf } from "../types";
import { loadBooks, loadChallenge, loadShelves, saveShelves, saveBooks, subscribeBooks, addBookSnapshotsToMyLibrary } from "../storage";
import { RatingStars } from "../components/RatingStars";
import { useBasePath, withBase } from "../routing";

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
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReadStatus | "alle">(initialStatus);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const suggestionJustSelectedRef = useRef(false);
  const [isEnrichingTBR, setIsEnrichingTBR] = useState(false);
  const [searchError, setSearchError] = useState<string>("");
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
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [addToShelfResult, setAddToShelfResult] = useState<SearchResult | null>(null);
  const [showAddToShelfModal, setShowAddToShelfModal] = useState(false);
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

  const existingSeries = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.seriesName) set.add(b.seriesName);
    });
    return Array.from(set).sort();
  }, [books]);

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

    // 2) Fallback: match op titel + auteurs (case-insensitive, getrimd)
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
    const url = new URL(ITUNES_SEARCH_API);
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
      };
    });

    return results;
  }

  async function searchOpenLibrary(query: string, maxResults: number, controller: AbortController) {
    const url = new URL(OPEN_LIBRARY_SEARCH_API);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(maxResults));

    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open Library error (${res.status})`);
    }
    const data = (await res.json()) as any;
    const docs: any[] = Array.isArray(data?.docs) ? data.docs : [];
    const results: SearchResult[] = docs.map((doc) => {
      const key = typeof doc?.key === "string" ? doc.key : "";
      const id = key ? `openlib:${key}` : `openlib:doc:${Math.random().toString(36).slice(2)}`;
      const coverId =
        typeof doc?.cover_i === "number" ? doc.cover_i : undefined;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : undefined;
      const authors = Array.isArray(doc?.author_name) ? doc.author_name.join(", ") : "Onbekende auteur";
      const pageCount =
        typeof doc?.number_of_pages_median === "number"
          ? doc.number_of_pages_median
          : undefined;
      return {
        id,
        title: doc?.title ?? "Onbekende titel",
        authors,
        coverUrl,
        pageCount
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
    if (!query.trim()) {
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

      // Suggesties: Apple Books (gratis, veel dekking) → fallback Open Library
      if (isSuggestion) {
        const itunesKey = cacheKey(query, maxResults, "itunes");
        const cachedItunes = readCache(itunesKey);
        if (cachedItunes) {
          setSuggestions(cachedItunes);
          return;
        }

        try {
          const itunesResults = await searchItunesBooks(query, maxResults, controller);
          writeCache(itunesKey, itunesResults);
          if (itunesResults.length > 0) {
            setSuggestions(itunesResults);
            return;
          }
        } catch {
          // ignore and fallback
        }

        const openKey = cacheKey(query, maxResults, "openlibrary");
        const cachedOpen = readCache(openKey);
        const openResults = cachedOpen ?? (await searchOpenLibrary(query, maxResults, controller));
        if (!cachedOpen) writeCache(openKey, openResults);
        setSuggestions(openResults);
        return;
      }

      // Als Google tijdelijk is uitgeschakeld (quota), ga direct naar Open Library
      const googleAllowed = canUseGoogleNow();

      const url = new URL(GOOGLE_BOOKS_API);
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", String(maxResults));
      if (GOOGLE_BOOKS_API_KEY && GOOGLE_BOOKS_API_KEY.trim()) {
        url.searchParams.set("key", GOOGLE_BOOKS_API_KEY.trim());
      }

      // Google route (alleen als toegestaan)
      if (googleAllowed) {
        const googleKey = cacheKey(query, maxResults, "google");
        const cachedGoogle = readCache(googleKey);
        if (cachedGoogle) {
          setSearchResults(cachedGoogle);
          return;
        }

        const res = await fetch(url.toString(), { signal: controller.signal });
        const data = await res.json().catch(() => ({} as any));

        if (!res.ok) {
          const message: string | undefined = data?.error?.message;
          if (res.status === 429 || res.status === 403) {
            // cooldown zodat het niet blijft falen
            disableGoogleForAWhile();
            // We fall back below
          } else {
            // We fall back below
          }
        } else {
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
              const pageCount =
                typeof info.pageCount === "number" ? info.pageCount : undefined;

              return {
                id: item.id,
                title: info.title ?? "Onbekende titel",
                authors: (info.authors ?? []).join(", ") || "Onbekende auteur",
                coverUrl: coverUrl?.replace("http://", "https://"),
                description: description || undefined,
                pageCount
              };
            }) ?? [];

          writeCache(googleKey, results);
          setSearchResults(results);
          return;
        }
      } else if (GOOGLE_BOOKS_API_KEY && GOOGLE_BOOKS_API_KEY.trim()) {
        // key is er, maar Google is tijdelijk uit door quota/cooldown
        // We fall back below
      }

      // Fallback: Apple Books → Open Library
      const itunesKey = cacheKey(query, maxResults, "itunes");
      const cachedItunes = readCache(itunesKey);
      if (cachedItunes) {
        setSearchResults(cachedItunes);
        return;
      }

      try {
        const itunesResults = await searchItunesBooks(query, maxResults, controller);
        writeCache(itunesKey, itunesResults);
        if (itunesResults.length > 0) {
          setSearchResults(itunesResults);
          if (GOOGLE_BOOKS_API_KEY && GOOGLE_BOOKS_API_KEY.trim() && !googleAllowed) {
            setSearchError(
              "Google Books is tijdelijk uitgeschakeld (quota). Zoeken gaat via Apple Books."
            );
          }
          return;
        }
      } catch {
        // ignore
      }

      const openKey = cacheKey(query, maxResults, "openlibrary");
      const cachedOpen = readCache(openKey);
      const openResults = cachedOpen ?? (await searchOpenLibrary(query, maxResults, controller));
      if (!cachedOpen) writeCache(openKey, openResults);
      setSearchResults(openResults);
      if (GOOGLE_BOOKS_API_KEY && GOOGLE_BOOKS_API_KEY.trim() && !googleAllowed) {
        setSearchError("Google Books is tijdelijk uitgeschakeld (quota). Zoeken gaat via Open Library.");
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
      }, 450);
    } else {
      suggestionJustSelectedRef.current = false;
      setSuggestions([]);
      setShowSuggestions(false);
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
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function selectSuggestion(suggestion: SearchResult) {
    suggestionJustSelectedRef.current = true;
    const query = `${suggestion.title} ${suggestion.authors}`;
    setSearchTerm(query);
    setShowSuggestions(false);
    setSuggestions([]);
    // Voer direct een zoekopdracht uit
    setIsSearching(true);
    await searchBooks(query, false);
    setIsSearching(false);
  }

  function addFromSearch(result: SearchResult, targetShelfId: string) {
    const existing = findExistingBookForResult(result);
    const statusFromShelf = STATUS_BY_SHELF_ID[targetShelfId];
    const shelfName = shelves.find((s) => s.id === targetShelfId)?.name ?? "plank";

    // Als het boek al bestaat in de bibliotheek
    if (existing) {
      // Standaardplanken (status-gebonden)
      if (statusFromShelf) {
        // Al dezelfde status → al op deze plank
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

      // Custom planken: voeg alleen toe als het boek nog niet op die plank staat
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
      setToast(`Boek toegevoegd aan "${shelfName}".`);
      window.setTimeout(() => setToast(""), 2500);
      return;
    }

    // Nog niet in bibliotheek → nieuw boek aanmaken
    const effectiveStatus: ReadStatus =
      statusFromShelf ?? "geen-status";

    const shelfIds =
      statusFromShelf != null
        ? undefined
        : [targetShelfId];

    const newBook: Book = {
      id: result.id,
      title: result.title,
      authors: result.authors,
      coverUrl: result.coverUrl,
      description: result.description,
      pageCount: result.pageCount,
      status: effectiveStatus,
      ...(shelfIds && { shelfIds })
    };
    persist([...books, newBook]);
    setToast(`Boek toegevoegd aan "${shelfName}".`);
    window.setTimeout(() => setToast(""), 2500);
  }

  function startAddFromSearch(result: SearchResult) {
    setAddToShelfResult(result);
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

  function openManualBookModal() {
    setManualTitle("");
    setManualAuthors("");
    setManualPageCount("");
    setManualSeriesName("");
    setManualSeriesNumber("");
    setManualUseCustomSeries(false);
    setManualCoverUrl("");
    setShowManualBookModal(true);
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

    const newBook: Book = {
      id: `manual-${Date.now()}`,
      title,
      authors: manualAuthors.trim(),
      pageCount,
      status: effectiveStatus,
      ...(seriesName && { seriesName }),
      ...(seriesNum != null && seriesNum > 0 && { seriesNumber: seriesNum }),
      ...(coverUrl && { coverUrl })
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
    navigate(withBase(basePath, `/boek/${bookId}`));
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
            <label className="search-by-author-label">
              <input
                type="checkbox"
                checked={searchByAuthor}
                onChange={(e) => setSearchByAuthor(e.target.checked)}
              />
              <span>Zoek op auteur</span>
            </label>
            <div className="search-input-wrapper" ref={suggestionsRef}>
              <input
                type="search"
                placeholder={searchByAuthor ? "Naam auteur…" : "Zoek op titel of auteur"}
                value={searchTerm}
                onChange={(e) => {
                  suggestionJustSelectedRef.current = false;
                  setSearchTerm(e.target.value);
                }}
                onFocus={() => {
                  if (!searchByAuthor && suggestions.length > 0 && !suggestionJustSelectedRef.current) {
                    setShowSuggestions(true);
                  }
                }}
                className="search-input search-input-with-clear"
              />
              {searchTerm.trim().length > 0 && (
                <button
                  type="button"
                  className="search-clear-button"
                  onClick={() => {
                    setSearchTerm("");
                    setSuggestions([]);
                    setShowSuggestions(false);
                    setSearchResults([]);
                    setSearchError("");
                  }}
                  aria-label="Zoekterm wissen"
                >
                  ×
                </button>
              )}
              {showSuggestions && suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="suggestion-item"
                      onClick={() => selectSuggestion(suggestion)}
                    >
                      {suggestion.coverUrl && (
                        <img
                          src={suggestion.coverUrl}
                          alt={suggestion.title}
                          className="suggestion-cover"
                        />
                      )}
                      <div className="suggestion-info">
                        <div className="suggestion-title">{suggestion.title}</div>
                        <div className="suggestion-authors">{suggestion.authors}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="submit" className="primary-button" disabled={isSearching}>
              {isSearching ? "Zoeken..." : "Zoeken"}
            </button>
          </form>
          <div style={{ marginTop: "0.75rem" }}>
            <button onClick={openManualBookModal} className="secondary-button">
              Handmatig boek toevoegen
            </button>
          </div>
          {searchError && (
            <p className="page-intro-small" style={{ marginTop: 10 }}>
              {searchError}
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((r) => (
                (() => {
                  const existingBook = findExistingBookForResult(r);
                  const alreadyRead = existingBook?.status === "gelezen";
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
                    <div className="search-result-title">{r.title}</div>
                    <div className="search-result-authors">{r.authors}</div>
                    <div className="search-result-meta">
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
                      {getBookPlankNames(book).length > 0 && (
                        <div className="book-planks">
                          <span className="book-planks-label">Planken:</span>
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
          }}
        >
          <div
            className="modal modal-add-to-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Kies plank voor dit boek</h3>
            <p className="modal-intro">
              Naar welke plank wil je
              {" "}
              <strong>{addToShelfResult.title}</strong>
              {" "}
              van
              {" "}
              {addToShelfResult.authors || "onbekende auteur"}
              {" "}
              toevoegen?
            </p>
            <ul className="add-to-shelf-list">
              {(() => {
                const existing = findExistingBookForResult(addToShelfResult);
                return shelves.map((shelf) => {
                  const statusFromShelf = STATUS_BY_SHELF_ID[shelf.id];
                  const alreadyOnShelf = existing
                    ? statusFromShelf
                      ? existing.status === statusFromShelf
                      : (existing.shelfIds ?? []).includes(shelf.id)
                    : false;
                  return (
                    <li key={shelf.id}>
                      <button
                        type="button"
                        className={`add-to-shelf-item${
                          alreadyOnShelf ? " add-to-shelf-item-disabled" : ""
                        }`}
                        onClick={() => {
                          if (alreadyOnShelf) {
                            const shelfName =
                              shelves.find((s) => s.id === shelf.id)?.name ?? "plank";
                            setToast(`Dit boek staat al op "${shelfName}".`);
                            window.setTimeout(() => setToast(""), 2500);
                            return;
                          }
                          addFromSearch(addToShelfResult, shelf.id);
                          setShowAddToShelfModal(false);
                          setAddToShelfResult(null);
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
                }}
              >
                Annuleren
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
            <p className="modal-intro">Selecteer de boeken die je wilt toevoegen en kies een plank.</p>
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
                    {selectedAuthorBookIds.size} geselecteerd · Toevoegen aan plank
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
                          placeholder="Nieuwe plank naam…"
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
                          Nieuwe plank aanmaken
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
                <input
                  type="text"
                  value={manualAuthors}
                  onChange={(e) => setManualAuthors(e.target.value)}
                  placeholder="Bijv. Marieke Lucas Rijneveld"
                />
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
                  placeholder="Bijv. 1"
                  min={1}
                  className="manual-book-series-num"
                />
              </label>
              <label className="form-field">
                <span>Link naar kaft (optioneel)</span>
                <input
                  type="url"
                  value={manualCoverUrl}
                  onChange={(e) => setManualCoverUrl(e.target.value)}
                  placeholder="Bijv. https://... afbeelding.jpg"
                />
              </label>
              <p className="manual-book-hint">
                Het boek wordt toegevoegd aan &quot;{statusFilter === "alle" ? "Wil ik lezen" : STATUS_LABELS[statusFilter]}&quot;.
              </p>
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


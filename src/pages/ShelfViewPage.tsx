import { useParams, Link, useNavigate } from "react-router-dom";
import { Book, ReadStatus, Shelf } from "../types";
import { loadBooks, loadShelves, saveShelves, saveBooks, subscribeBooks, loadFriends, shareWithFriend, loadShelfViewSettings, saveShelfViewSettings } from "../storage";
import { useBasePath, withBase } from "../routing";
import React, { useMemo, useState, useEffect, useRef } from "react";

const STATUS_MAP: Record<string, ReadStatus> = {
  "wil-ik-lezen": "wil-ik-lezen",
  "aan-het-lezen": "aan-het-lezen",
  gelezen: "gelezen"
};

type ShelfGroupMode = "none" | "series" | "status" | "author";

const STATUS_ORDER: Record<ReadStatus, number> = {
  "wil-ik-lezen": 0,
  "aan-het-lezen": 1,
  gelezen: 2,
  "geen-status": 3
};

/** Beschikbare sorteerregels: id en weergavenaam. */
const SORT_RULES: { id: string; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "serie", label: "Serie" },
  { id: "auteur", label: "Auteur" },
  { id: "titel", label: "Titel" }
];

function compareByRule(a: Book, b: Book, ruleId: string): number {
  switch (ruleId) {
    case "status": {
      const ao = STATUS_ORDER[a.status] ?? 99;
      const bo = STATUS_ORDER[b.status] ?? 99;
      return ao - bo;
    }
    case "serie": {
      const sa = (a.seriesName ?? "").trim();
      const sb = (b.seriesName ?? "").trim();
      if (sa !== sb) return sa.localeCompare(sb);
      return (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0);
    }
    case "auteur":
      return a.authors.localeCompare(b.authors);
    case "titel":
      return a.title.localeCompare(b.title);
    default:
      return 0;
  }
}

const SORT_RULE_IDS = new Set(SORT_RULES.map((r) => r.id));

function sortBooksByRules(books: Book[], ruleIds: string[]): Book[] {
  if (books.length === 0 || ruleIds.length === 0) return [...books];
  const valid = ruleIds.filter((id) => SORT_RULE_IDS.has(id));
  if (valid.length === 0) return [...books];
  return [...books].sort((a, b) => {
    for (const ruleId of valid) {
      const c = compareByRule(a, b, ruleId);
      if (c !== 0) return c;
    }
    return 0;
  });
}

function getBooksForShelf(shelf: Shelf | null, books: Book[]): Book[] {
  if (!shelf) return [];
  const status = STATUS_MAP[shelf.id];
  if (status) {
    return books.filter((b) => b.status === status);
  }
  return books.filter((b) => b.shelfIds?.includes(shelf.id));
}

export function ShelfViewPage() {
  const { shelfId } = useParams<{ shelfId: string }>();
  const basePath = useBasePath();
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [toast, setToast] = useState<string>("");
  const [sortRulesByShelf, setSortRulesByShelf] = useState<Record<string, string[]>>(() => loadShelfViewSettings().sortRulesByShelf);
  const [groupModeByShelf, setGroupModeByShelf] = useState<Record<string, ShelfGroupMode>>(() => {
    const s = loadShelfViewSettings().groupModeByShelf as Record<string, ShelfGroupMode>;
    return s ?? {};
  });
  const [groupSortRules, setGroupSortRules] = useState<Record<string, string[]>>(() => loadShelfViewSettings().groupSortRules);
  /** "shelf" = main sort popup (no grouping), or groupId for that boekenkast's sort popup */
  const [sortPopupTarget, setSortPopupTarget] = useState<"shelf" | string | null>(null);

  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  useEffect(() => {
    saveShelfViewSettings({
      sortRulesByShelf,
      groupModeByShelf,
      groupSortRules
    });
  }, [sortRulesByShelf, groupModeByShelf, groupSortRules]);

  const shelf = useMemo(
    () => shelves.find((s) => s.id === shelfId) ?? null,
    [shelves, shelfId]
  );
  const isCustomShelf = useMemo(
    () => !!(shelf && !STATUS_MAP[shelf.id]),
    [shelf]
  );
  const currentSortRules: string[] = useMemo(() => {
    if (!shelfId) return [];
    return sortRulesByShelf[shelfId] ?? [];
  }, [sortRulesByShelf, shelfId]);

  const currentGroupMode: ShelfGroupMode = useMemo(() => {
    if (!shelfId) return "series";
    return groupModeByShelf[shelfId] ?? "series";
  }, [groupModeByShelf, shelfId]);

  /** Op standaardboekenkasten geen groepering op status; toon dan als "none". */
  const effectiveGroupMode: ShelfGroupMode = useMemo(
    () => (!isCustomShelf && currentGroupMode === "status" ? "none" : currentGroupMode),
    [isCustomShelf, currentGroupMode]
  );

  const shelfBooks = useMemo(
    () => {
      const base = getBooksForShelf(shelf, books);
      return sortBooksByRules(base, currentSortRules);
    },
    [shelf, books, currentSortRules]
  );

  function setShelfSortRules(rules: string[]) {
    if (!shelfId) return;
    setSortRulesByShelf((prev) => ({ ...prev, [shelfId]: rules }));
  }

  function setGroupSortRulesFor(groupId: string, rules: string[]) {
    setGroupSortRules((prev) => ({ ...prev, [groupId]: rules }));
  }

  function moveRule(rules: string[], index: number, direction: 1 | -1): string[] {
    const next = [...rules];
    const j = index + direction;
    if (j < 0 || j >= next.length) return next;
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  }
  const [showShareShelfModal, setShowShareShelfModal] = useState(false);
  const [shareShelfError, setShareShelfError] = useState("");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showAddToShelfModal, setShowAddToShelfModal] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [showRemoveFromShelfModal, setShowRemoveFromShelfModal] = useState(false);
  const [showShareSelectedModal, setShowShareSelectedModal] = useState(false);
  const [shareSelectedError, setShareSelectedError] = useState("");
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const longPressBookIdRef = useRef<string | null>(null);
  const [selectionBarPosition, setSelectionBarPosition] = useState({ bottom: 96, leftPercent: 50 });
  const selectionBarDragRef = useRef<{ startY: number; startBottom: number; startX: number; startLeft: number } | null>(null);

  function handleSelectionBarPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    selectionBarDragRef.current = {
      startY: e.clientY,
      startBottom: selectionBarPosition.bottom,
      startX: e.clientX,
      startLeft: selectionBarPosition.leftPercent
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function handleSelectionBarPointerMove(e: React.PointerEvent) {
    if (selectionBarDragRef.current == null) return;
    const { startY, startBottom, startX, startLeft } = selectionBarDragRef.current;
    const deltaY = startY - e.clientY;
    const deltaXPercent = ((e.clientX - startX) / window.innerWidth) * 100;
    let newBottom = Math.round(startBottom + deltaY);
    let newLeft = startLeft + deltaXPercent;
    newBottom = Math.max(60, Math.min(500, newBottom));
    newLeft = Math.max(5, Math.min(95, newLeft));
    setSelectionBarPosition({ bottom: newBottom, leftPercent: newLeft });
  }
  function handleSelectionBarPointerUp(e: React.PointerEvent) {
    if (selectionBarDragRef.current != null) {
      selectionBarDragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  }

  function toggleBookSelected(id: string) {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function enterSelectionModeWith(id: string) {
    setSelectionMode(true);
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function persist(next: Book[]) {
    setBooks(next);
    saveBooks(next);
    // Als er geen geselecteerde boeken meer over zijn, verlaat de selectiemodus.
    setSelectedBookIds((prev) => {
      const remaining = new Set(
        Array.from(prev).filter((id) => next.some((b) => b.id === id))
      );
      if (remaining.size === 0) {
        setSelectionMode(false);
      }
      return remaining;
    });
  }

  const STATUS_LABELS: Record<ReadStatus, string> = {
    "wil-ik-lezen": "Wil ik lezen",
    "aan-het-lezen": "Aan het lezen",
    gelezen: "Gelezen",
    "geen-status": "Geen status"
  };
  /** Korte labels voor status-pill op eigen boekenkasten */
  const STATUS_PILL_LABELS: Record<ReadStatus, string> = {
    "wil-ik-lezen": "TBR",
    "aan-het-lezen": "Aan het lezen",
    gelezen: "Gelezen",
    "geen-status": "Geen status"
  };

  function addSelectedBooksToShelf(targetShelfId: string) {
    if (selectedBookIds.size === 0) return;
    const status = STATUS_MAP[targetShelfId];
    const isCustomShelf = !STATUS_MAP[targetShelfId];
    const ids = Array.from(selectedBookIds);
    const next = books.map((b) => {
      if (!ids.includes(b.id)) return b;
      const shelfIds = b.shelfIds ?? [];
      if (isCustomShelf) {
        if (shelfIds.includes(targetShelfId)) return b;
        return { ...b, shelfIds: [...shelfIds, targetShelfId] };
      }
      return { ...b, status: status! };
    });
    persist(next);
    const shelfName = shelves.find((s) => s.id === targetShelfId)?.name ?? "boekenkast";
    setToast(
      selectedBookIds.size === 1
        ? `Boek toegevoegd aan "${shelfName}".`
        : `${selectedBookIds.size} boeken toegevoegd aan "${shelfName}".`
    );
    setSelectedBookIds(new Set());
    window.setTimeout(() => setToast(""), 2500);
    setShowAddToShelfModal(false);
  }

  function deleteSelectedBooks() {
    if (selectedBookIds.size === 0) return;
    const ids = Array.from(selectedBookIds);
    const next = books.filter((b) => !ids.includes(b.id));
    persist(next);
    setToast(
      selectedBookIds.size === 1
        ? "Boek verwijderd uit bibliotheek."
        : `${selectedBookIds.size} boeken verwijderd uit bibliotheek.`
    );
    setSelectedBookIds(new Set());
    setShowDeleteSelectedModal(false);
    window.setTimeout(() => setToast(""), 2500);
  }

  function removeSelectedBooksFromShelf() {
    if (!shelf || selectedBookIds.size === 0) return;
    if (STATUS_MAP[shelf.id]) return; // alleen voor custom boekenkasten
    const ids = Array.from(selectedBookIds);
    const next = books.map((b) => {
      if (!ids.includes(b.id)) return b;
      const shelfIds = (b.shelfIds ?? []).filter((id) => id !== shelf.id);
      return { ...b, shelfIds };
    });
    persist(next);
    const shelfName = shelf.name;
    setToast(
      selectedBookIds.size === 1
        ? `Boek verwijderd uit "${shelfName}".`
        : `${selectedBookIds.size} boeken verwijderd uit "${shelfName}".`
    );
    setSelectedBookIds(new Set());
    setShowRemoveFromShelfModal(false);
    setSelectionMode(false);
    window.setTimeout(() => setToast(""), 2500);
  }

  function shareSelectedWithFriend(friend: string) {
    const ids = Array.from(selectedBookIds);
    const selected = books.filter((b) => ids.includes(b.id));
    if (selected.length === 0) return;
    const snapshots = selected.map((b) => ({
      title: b.title,
      authors: b.authors,
      coverUrl: b.coverUrl,
      seriesName: b.seriesName
    }));
    const result = shareWithFriend(friend, snapshots, shelf.name);
    if (result.ok) {
      setSelectedBookIds(new Set());
      setShowShareSelectedModal(false);
      setShareSelectedError("");
      setToast(
        selected.length === 1
          ? `Boek gedeeld met ${friend}.`
          : `${selected.length} boeken gedeeld met ${friend}.`
      );
      window.setTimeout(() => setToast(""), 2500);
    } else {
      setShareSelectedError(result.error);
    }
  }

  if (!shelfId || !shelf) {
    return (
      <div className="page shelf-view-page">
        <p>Boekenkast niet gevonden.</p>
        <Link to={withBase(basePath, "/planken")} className="link-button">
          Terug naar boekenkasten
        </Link>
      </div>
    );
  }

  function goToBook(bookId: string) {
    navigate(withBase(basePath, `/boek/${bookId}`));
  }

  const groupedBySeries = useMemo(() => {
    if (currentGroupMode !== "series") return null;
    if (shelfBooks.length === 0) return null;
    const groups = new Map<string, Book[]>();
    const NO_SERIES_KEY = "__no_series";
    shelfBooks.forEach((b) => {
      const key = b.seriesName?.trim() || NO_SERIES_KEY;
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    });
    return Array.from(groups.entries())
      .map(([key, books]) => ({
        key,
        label: key === NO_SERIES_KEY ? "Zonder serie" : key,
        books
      }))
      .sort((a, b) => {
        if (a.key === "__no_series") return 1;
        if (b.key === "__no_series") return -1;
        return a.label.localeCompare(b.label);
      });
  }, [shelfBooks, currentGroupMode]);

  const groupedByStatus = useMemo(() => {
    if (currentGroupMode !== "status") return null;
    if (shelfBooks.length === 0) return null;
    const groups = new Map<ReadStatus, Book[]>();
    shelfBooks.forEach((b) => {
      const arr = groups.get(b.status) ?? [];
      arr.push(b);
      groups.set(b.status, arr);
    });
    return Array.from(groups.entries())
      .map(([status, books]) => ({
        key: status,
        label: STATUS_LABELS[status],
        status,
        books
      }))
      .sort((a, b) => {
        const aOrder = STATUS_ORDER[a.status] ?? 99;
        const bOrder = STATUS_ORDER[b.status] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.label.localeCompare(b.label);
      });
  }, [shelfBooks, currentGroupMode]);

  const groupedByAuthor = useMemo(() => {
    if (currentGroupMode !== "author") return null;
    if (shelfBooks.length === 0) return null;
    const groups = new Map<string, Book[]>();
    shelfBooks.forEach((b) => {
      const key = b.authors || "Onbekende auteur";
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    });
    return Array.from(groups.entries())
      .map(([key, books]) => ({
        key,
        label: key,
        books
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [shelfBooks, currentGroupMode]);

  function renderBookcaseBook(book: Book) {
    const isSelected = selectedBookIds.has(book.id);
    return (
      <div
        key={book.id}
        className={`bookcase-book ${isSelected ? "bookcase-book-selected" : ""}`}
      >
        {selectionMode && (
          <button
            type="button"
            className={`mobile-reading-checkbox ${isSelected ? "checked" : ""}`}
            onClick={() => toggleBookSelected(book.id)}
            aria-pressed={isSelected}
          >
            <span className="mobile-reading-checkbox-icon">{isSelected ? "✓" : ""}</span>
          </button>
        )}
        <button
          type="button"
          className="bookcase-book-main"
          onTouchStart={() => {
            if (selectionMode) return;
            longPressBookIdRef.current = book.id;
            longPressTimerRef.current = setTimeout(() => {
              const id = longPressBookIdRef.current;
              if (id) {
                enterSelectionModeWith(id);
                suppressNextClickRef.current = true;
                longPressBookIdRef.current = null;
              }
              longPressTimerRef.current = null;
            }, 500);
          }}
          onTouchEnd={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
            longPressBookIdRef.current = null;
          }}
          onTouchCancel={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
            longPressBookIdRef.current = null;
          }}
          onMouseDown={() => {
            if (selectionMode) return;
            longPressBookIdRef.current = book.id;
            longPressTimerRef.current = setTimeout(() => {
              const id = longPressBookIdRef.current;
              if (id) {
                enterSelectionModeWith(id);
                suppressNextClickRef.current = true;
                longPressBookIdRef.current = null;
              }
              longPressTimerRef.current = null;
            }, 500);
          }}
          onMouseUp={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
            longPressBookIdRef.current = null;
          }}
          onMouseLeave={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
            longPressBookIdRef.current = null;
          }}
          onClick={(e) => {
            if (suppressNextClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressNextClickRef.current = false;
              return;
            }
            if (selectionMode) {
              e.preventDefault();
              e.stopPropagation();
              toggleBookSelected(book.id);
              return;
            }
            goToBook(book.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selectionMode) {
              enterSelectionModeWith(book.id);
            } else {
              toggleBookSelected(book.id);
            }
          }}
        >
          <div className="bookcase-book-cover-wrap">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="bookcase-book-cover"
              />
            ) : (
              <div className="bookcase-book-cover-placeholder">
                {book.title.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="bookcase-book-title">{book.title}</span>
          {book.authors && effectiveGroupMode !== "author" && (
            <span className="bookcase-book-author">{book.authors}</span>
          )}
          {book.seriesName?.trim() && effectiveGroupMode !== "series" && (
            <div className="book-series-badge">
              {book.seriesName.trim()}
              {book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}
            </div>
          )}
          {isCustomShelf && effectiveGroupMode !== "status" && (
            <span className={`bookcase-book-status bookcase-book-status-${book.status}`} aria-label={`Status: ${STATUS_LABELS[book.status]}`}>
              {STATUS_PILL_LABELS[book.status]}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={`page shelf-view-page ${selectionMode ? "selection-mode-active" : ""}`}>
      <header className="shelf-view-header">
        <Link
          to={withBase(basePath, "/planken")}
          className="shelf-view-back"
        >
          ← Terug naar boekenkasten
        </Link>
        <h1 className="shelf-view-title">{shelf.name}</h1>
        <p className="shelf-view-count">
          {shelfBooks.length} {shelfBooks.length === 1 ? "boek" : "boeken"}
        </p>
        {shelfBooks.length > 0 && (
          <>
            {effectiveGroupMode === "none" && (
              <div className="shelf-view-sort">
                <button
                  type="button"
                  className="secondary-button shelf-sort-open-btn"
                  onClick={() => setSortPopupTarget("shelf")}
                >
                  Sorteerregels {currentSortRules.length > 0 ? `(${currentSortRules.length})` : ""}
                </button>
              </div>
            )}
            <div className="shelf-view-group">
              <span className="shelf-view-sort-label">Groepeer op:</span>
              <div className="shelf-view-sort-buttons">
                <button
                  type="button"
                  className={`shelf-view-sort-pill ${effectiveGroupMode === "none" ? "active" : ""}`}
                  onClick={() => {
                    if (!shelfId) return;
                    setGroupModeByShelf((prev) => ({ ...prev, [shelfId]: "none" }));
                  }}
                >
                  Geen
                </button>
                <button
                  type="button"
                  className={`shelf-view-sort-pill ${effectiveGroupMode === "series" ? "active" : ""}`}
                  onClick={() => {
                    if (!shelfId) return;
                    setGroupModeByShelf((prev) => ({ ...prev, [shelfId]: "series" }));
                  }}
                >
                  Serie
                </button>
                {isCustomShelf && (
                  <button
                    type="button"
                    className={`shelf-view-sort-pill ${effectiveGroupMode === "status" ? "active" : ""}`}
                    onClick={() => {
                      if (!shelfId) return;
                      setGroupModeByShelf((prev) => ({ ...prev, [shelfId]: "status" }));
                    }}
                  >
                    Status
                  </button>
                )}
                <button
                  type="button"
                  className={`shelf-view-sort-pill ${effectiveGroupMode === "author" ? "active" : ""}`}
                  onClick={() => {
                    if (!shelfId) return;
                    setGroupModeByShelf((prev) => ({ ...prev, [shelfId]: "author" }));
                  }}
                >
                  Auteur
                </button>
              </div>
            </div>
            <button
              type="button"
              className="secondary-button shelf-view-share"
              onClick={() => { setShareShelfError(""); setShowShareShelfModal(true); }}
            >
              Deel boekenkast met Boekbuddy
            </button>
          </>
        )}
      </header>

      {showShareShelfModal && (
        <div className="modal-backdrop" onClick={() => { setShowShareShelfModal(false); setShareShelfError(""); }}>
          <div className="modal modal-add-to-shelf" onClick={(e) => e.stopPropagation()}>
            <h3>Boekenkast delen met Boekbuddy</h3>
            <p className="modal-intro">
              Kies een Boekbuddy om de boekenkast &quot;{shelf.name}&quot; ({shelfBooks.length} boek{shelfBooks.length === 1 ? "" : "en"}) mee te delen. Ze kunnen de boeken aan hun TBR toevoegen.
            </p>
            {shareShelfError && <p className="form-error">{shareShelfError}</p>}
            <ul className="add-to-shelf-list">
              {loadFriends().map((friend) => (
                <li key={friend}>
                  <button
                    type="button"
                    className="add-to-shelf-item"
                    onClick={() => {
                      const snapshots = shelfBooks.map((b) => ({
                        title: b.title,
                        authors: b.authors,
                        coverUrl: b.coverUrl,
                        seriesName: b.seriesName
                      }));
                      const result = shareWithFriend(friend, snapshots, shelf.name);
                      if (result.ok) {
                        setShowShareShelfModal(false);
                        setShareShelfError("");
                      } else {
                        setShareShelfError(result.error);
                      }
                    }}
                  >
                    {friend}
                  </button>
                </li>
              ))}
            </ul>
            {loadFriends().length === 0 && (
              <p className="modal-intro">Je hebt nog geen Boekbuddies. Voeg eerst vrienden toe via Profiel.</p>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setShowShareShelfModal(false); setShareShelfError(""); }}
            >
              Sluiten
            </button>
          </div>
        </div>
      )}

      {sortPopupTarget !== null && (() => {
        const isShelf = sortPopupTarget === "shelf";
        const rawRules = isShelf ? currentSortRules : (groupSortRules[sortPopupTarget] ?? []);
        const rules = rawRules.filter((id) => SORT_RULE_IDS.has(id));
        const setRules = isShelf ? setShelfSortRules : (r: string[]) => setGroupSortRulesFor(sortPopupTarget, r);
        const title = isShelf ? "Sorteerregels" : "Sorteerregels voor deze boekenkast";
        return (
          <div className="modal-backdrop" onClick={() => setSortPopupTarget(null)}>
            <div className="modal modal-sort-rules" onClick={(e) => e.stopPropagation()}>
              <h3>{title}</h3>
              <p className="modal-intro">Kies regels en zet ze in volgorde. Eerste regel heeft voorrang, daarna de volgende bij gelijkheid.</p>
              <div className="shelf-sort-rules-list shelf-sort-rules-in-modal">
                {rules.length === 0 && <span className="shelf-sort-rules-empty">Geen regels</span>}
                {rules.map((ruleId, index) => {
                  const label = SORT_RULES.find((r) => r.id === ruleId)?.label ?? ruleId;
                  return (
                    <div key={`${ruleId}-${index}`} className="shelf-sort-rule-pill-wrap">
                      <span className="shelf-sort-rule-pill">{label}</span>
                      <div className="shelf-sort-rule-actions">
                        <button type="button" className="shelf-sort-rule-btn" onClick={() => setRules(moveRule(rules, index, -1))} disabled={index === 0} aria-label="Omhoog">↑</button>
                        <button type="button" className="shelf-sort-rule-btn" onClick={() => setRules(moveRule(rules, index, 1))} disabled={index === rules.length - 1} aria-label="Omlaag">↓</button>
                        <button type="button" className="shelf-sort-rule-btn shelf-sort-rule-remove" onClick={() => setRules(rules.filter((_, i) => i !== index))} aria-label="Verwijderen">×</button>
                      </div>
                    </div>
                  );
                })}
                {SORT_RULES.some((r) => !rules.includes(r.id)) && (
                  <select
                    className="shelf-sort-rule-add"
                    value=""
                    onChange={(e) => { const id = e.target.value; if (id) setRules([...rules, id]); e.target.value = ""; }}
                    aria-label="Regel toevoegen"
                  >
                    <option value="">+ Regel toevoegen</option>
                    {SORT_RULES.filter((r) => !rules.includes(r.id)).map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <button type="button" className="secondary-button" style={{ marginTop: "1rem" }} onClick={() => setSortPopupTarget(null)}>
                Sluiten
              </button>
            </div>
          </div>
        );
      })()}

      <div className="bookcase">
        {shelfBooks.length === 0 ? (
          <div className="bookcase-empty">
            <p>Geen boeken op deze boekenkast.</p>
          </div>
        ) : (
          <div className="bookcase-shelf">
            {effectiveGroupMode === "series" && groupedBySeries && groupedBySeries.length > 1 ? (
              <>
                {groupedBySeries.map((group) => {
                  const groupId = `${shelf.id}-series-${group.key}`;
                  const rules = groupSortRules[groupId] ?? [];
                  return (
                    <div key={group.key} className="shelf-series-group">
                      <div className="shelf-series-header">
                        <h2 className="shelf-series-title">{group.label}</h2>
                        <button type="button" className="secondary-button shelf-sort-open-btn shelf-sort-open-btn-inline" onClick={() => setSortPopupTarget(groupId)}>
                          Sorteer{rules.length > 0 ? ` (${rules.length})` : ""}
                        </button>
                      </div>
                      <div className="bookcase-books">
                        {(() => {
                          const sorted = sortBooksByRules(group.books, rules);
                          return sorted.map((book, index) => {
                            const nextBook = sorted[index + 1];
                            const differentSeries = nextBook != null && (nextBook.seriesName?.trim() ?? "") !== (book.seriesName?.trim() ?? "");
                            return (
                              <React.Fragment key={book.id}>
                                {renderBookcaseBook(book)}
                                {differentSeries && <div className="shelf-series-spacer" aria-hidden="true" />}
                              </React.Fragment>
                            );
                          });
                        })()}
                      </div>
                      <div className="bookcase-plank" aria-hidden="true" />
                    </div>
                  );
                })}
              </>
            ) : effectiveGroupMode === "status" && groupedByStatus && groupedByStatus.length > 0 ? (
              <>
                {groupedByStatus.map((group) => {
                  const groupId = `${shelf.id}-status-${group.key}`;
                  const rules = groupSortRules[groupId] ?? [];
                  return (
                    <div key={group.key} className="shelf-series-group">
                      <div className="shelf-series-header">
                        <h2 className="shelf-series-title">{group.label}</h2>
                        <button type="button" className="secondary-button shelf-sort-open-btn shelf-sort-open-btn-inline" onClick={() => setSortPopupTarget(groupId)}>
                          Sorteer{rules.length > 0 ? ` (${rules.length})` : ""}
                        </button>
                      </div>
                      <div className="bookcase-books">
                        {(() => {
                          const sorted = sortBooksByRules(group.books, rules);
                          return sorted.map((book, index) => {
                            const nextBook = sorted[index + 1];
                            const differentSeries = nextBook != null && (nextBook.seriesName?.trim() ?? "") !== (book.seriesName?.trim() ?? "");
                            return (
                              <React.Fragment key={book.id}>
                                {renderBookcaseBook(book)}
                                {differentSeries && <div className="shelf-series-spacer" aria-hidden="true" />}
                              </React.Fragment>
                            );
                          });
                        })()}
                      </div>
                      <div className="bookcase-plank" aria-hidden="true" />
                    </div>
                  );
                })}
              </>
            ) : effectiveGroupMode === "author" && groupedByAuthor && groupedByAuthor.length > 0 ? (
              <>
                {groupedByAuthor.map((group) => {
                  const groupId = `${shelf.id}-author-${group.key}`;
                  const rules = groupSortRules[groupId] ?? [];
                  return (
                    <div key={group.key} className="shelf-series-group">
                      <div className="shelf-series-header">
                        <h2 className="shelf-series-title">{group.label}</h2>
                        <button type="button" className="secondary-button shelf-sort-open-btn shelf-sort-open-btn-inline" onClick={() => setSortPopupTarget(groupId)}>
                          Sorteer{rules.length > 0 ? ` (${rules.length})` : ""}
                        </button>
                      </div>
                      <div className="bookcase-books">
                        {(() => {
                          const sorted = sortBooksByRules(group.books, rules);
                          return sorted.map((book, index) => {
                            const nextBook = sorted[index + 1];
                            const differentSeries = nextBook != null && (nextBook.seriesName?.trim() ?? "") !== (book.seriesName?.trim() ?? "");
                            return (
                              <React.Fragment key={book.id}>
                                {renderBookcaseBook(book)}
                                {differentSeries && <div className="shelf-series-spacer" aria-hidden="true" />}
                              </React.Fragment>
                            );
                          });
                        })()}
                      </div>
                      <div className="bookcase-plank" aria-hidden="true" />
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="bookcase-books">
                {shelfBooks.map((book, index) => {
                  const nextBook = shelfBooks[index + 1];
                  const differentSeries = nextBook != null && (nextBook.seriesName?.trim() ?? "") !== (book.seriesName?.trim() ?? "");
                  return (
                    <React.Fragment key={book.id}>
                      {renderBookcaseBook(book)}
                      {differentSeries && <div className="shelf-series-spacer" aria-hidden="true" />}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {(!effectiveGroupMode || effectiveGroupMode === "none") && (
              <div className="bookcase-plank" aria-hidden="true" />
            )}
          </div>
        )}
      </div>

      {selectionMode && (
        <div
          className="mobile-selection-bar"
          style={{
            bottom: `${selectionBarPosition.bottom}px`,
            left: `${selectionBarPosition.leftPercent}%`,
            transform: "translateX(-50%)"
          }}
        >
          <div
            className="mobile-selection-bar-drag-handle"
            onPointerDown={handleSelectionBarPointerDown}
            onPointerMove={handleSelectionBarPointerMove}
            onPointerUp={handleSelectionBarPointerUp}
            onPointerLeave={handleSelectionBarPointerUp}
            role="button"
            tabIndex={0}
            aria-label="Versleep om het menu te verplaatsen"
          >
            ⋮⋮
          </div>
          <span className="mobile-selection-count">
            {selectedBookIds.size} geselecteerd
          </span>
          <button
            type="button"
            className="primary-button mobile-selection-add"
            disabled={selectedBookIds.size === 0}
            onClick={() => setShowAddToShelfModal(true)}
          >
            Toevoegen aan boekenkast
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={selectedBookIds.size === 0}
            onClick={() => { setShareSelectedError(""); setShowShareSelectedModal(true); }}
          >
            Delen met Boekbuddy
          </button>
          {isCustomShelf && (
            <button
              type="button"
              className="secondary-button"
              disabled={selectedBookIds.size === 0}
              onClick={() => setShowRemoveFromShelfModal(true)}
            >
              Verwijderen uit boekenkast
            </button>
          )}
          <button
            type="button"
            className="secondary-button destructive"
            disabled={selectedBookIds.size === 0}
            onClick={() => setShowDeleteSelectedModal(true)}
          >
            Verwijderen uit bibliotheek
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSelectedBookIds(new Set());
              setSelectionMode(false);
            }}
          >
            Selectiemodus sluiten
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {showAddToShelfModal && selectedBookIds.size > 0 && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowAddToShelfModal(false);
            setSelectedBookIds(new Set());
          }}
        >
          <div
            className="modal modal-add-to-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Kies boekenkast</h3>
            <p className="modal-intro">
              Kies een boekenkast voor {selectedBookIds.size} boek{selectedBookIds.size === 1 ? "" : "en"}. De huidige status van elk boek blijft behouden.
            </p>
            <ul className="add-to-shelf-list">
              {shelves.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="add-to-shelf-item"
                    onClick={() => addSelectedBooksToShelf(s.id)}
                  >
                    {s.name}
                    {s.system && <span className="tag" style={{ marginLeft: 8 }}>Standaard</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="add-to-shelf-new">
              <input
                type="text"
                value={newShelfName}
                onChange={(e) => setNewShelfName(e.target.value)}
                placeholder="Nieuwe boekenkast naam…"
                className="add-to-shelf-new-input"
              />
              <button
                type="button"
                className="add-to-shelf-item add-to-shelf-new-btn"
                disabled={!newShelfName.trim()}
                onClick={() => {
                  const name = newShelfName.trim();
                  if (!name) return;
                  const newShelf: Shelf = { id: `shelf-${Date.now()}`, name };
                  const next = [...shelves, newShelf];
                  saveShelves(next);
                  setShelves(next);
                  addSelectedBooksToShelf(newShelf.id);
                  setNewShelfName("");
                }}
              >
                Nieuwe boekenkast aanmaken
              </button>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowAddToShelfModal(false);
                  setSelectedBookIds(new Set());
                  setNewShelfName("");
                }}
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteSelectedModal && selectedBookIds.size > 0 && (
        <div className="modal-backdrop" onClick={() => setShowDeleteSelectedModal(false)}>
          <div className="modal modal-add-to-shelf" onClick={(e) => e.stopPropagation()}>
            <h3>Geselecteerde boeken verwijderen</h3>
            <p className="modal-intro">
              Weet je zeker dat je {selectedBookIds.size} boek
              {selectedBookIds.size === 1 ? "" : "en"} uit je bibliotheek wilt verwijderen?
              Dit kan niet ongedaan worden gemaakt.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowDeleteSelectedModal(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="primary-button destructive"
                onClick={deleteSelectedBooks}
              >
                Verwijderen
              </button>
            </div>
          </div>
        </div>
      )}

      {showRemoveFromShelfModal && selectedBookIds.size > 0 && shelf && isCustomShelf && (
        <div className="modal-backdrop" onClick={() => setShowRemoveFromShelfModal(false)}>
          <div className="modal modal-add-to-shelf" onClick={(e) => e.stopPropagation()}>
            <h3>Verwijderen uit boekenkast</h3>
            <p className="modal-intro">
              Weet je zeker dat je {selectedBookIds.size} boek
              {selectedBookIds.size === 1 ? "" : "en"} uit &quot;{shelf.name}&quot; wilt halen?
              De boeken blijven in je bibliotheek staan.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowRemoveFromShelfModal(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={removeSelectedBooksFromShelf}
              >
                Verwijderen uit boekenkast
              </button>
            </div>
          </div>
        </div>
      )}

      {showShareSelectedModal && selectedBookIds.size > 0 && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowShareSelectedModal(false);
            setShareSelectedError("");
          }}
        >
          <div
            className="modal modal-add-to-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delen met Boekbuddy</h3>
            <p className="modal-intro">
              Kies een Boekbuddy om {selectedBookIds.size} boek
              {selectedBookIds.size === 1 ? "" : "en"} mee te delen.
            </p>
            {shareSelectedError && <p className="form-error">{shareSelectedError}</p>}
            <ul className="add-to-shelf-list">
              {loadFriends().map((friend) => (
                <li key={friend}>
                  <button
                    type="button"
                    className="add-to-shelf-item"
                    onClick={() => shareSelectedWithFriend(friend)}
                  >
                    {friend}
                  </button>
                </li>
              ))}
            </ul>
            {loadFriends().length === 0 && (
              <p className="modal-intro">
                Je hebt nog geen Boekbuddies. Voeg eerst vrienden toe via Profiel.
              </p>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setShowShareSelectedModal(false);
                setShareSelectedError("");
              }}
            >
              Sluiten
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

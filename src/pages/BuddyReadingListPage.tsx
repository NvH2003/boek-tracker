import React from "react";
import { useParams, Link } from "react-router-dom";
import { useState, useMemo, useEffect, useRef } from "react";
import { loadBooksForUserAsync, loadFriends, loadShelves, saveShelves, addBookSnapshotsToMyLibrary } from "../storage";
import { useBasePath, withBase } from "../routing";
import type { Book, ReadStatus } from "../types";

const STATUS_LABELS: Record<ReadStatus, string> = {
  "wil-ik-lezen": "Wil ik lezen",
  "aan-het-lezen": "Aan het lezen",
  gelezen: "Gelezen",
  "geen-status": "Geen status"
};

export function BuddyReadingListPage() {
  const { username: encodedUsername } = useParams<{ username: string }>();
  const basePath = useBasePath();
  const username = encodedUsername ? decodeURIComponent(encodedUsername) : null;
  const friends = useMemo(() => loadFriends(), []);
  const isFriend = username && friends.some((f) => f.toLowerCase() === username.toLowerCase());
  const [books, setBooks] = useState<Awaited<ReturnType<typeof loadBooksForUserAsync>>>([]);
  const [booksLoading, setBooksLoading] = useState(true);

  useEffect(() => {
    if (!username) {
      setBooks([]);
      setBooksLoading(false);
      return;
    }
    setBooksLoading(true);
    loadBooksForUserAsync(username).then((b) => {
      setBooks(b);
      setBooksLoading(false);
    });
  }, [username]);

  const [subTab, setSubTab] = useState<"leeslijst" | "gelezen">("leeslijst");
  const [readSeriesFilter, setReadSeriesFilter] = useState<string>("alle");
  const [readSortDirection, setReadSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showShelfPicker, setShowShelfPicker] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);
  const [toast, setToast] = useState("");
  const [shelves, setShelves] = useState(() => loadShelves());
  const [newShelfName, setNewShelfName] = useState("");
  const [selectionBarPosition, setSelectionBarPosition] = useState({ bottom: 96, leftPercent: 50 });
  const selectionBarDragRef = useRef<{ startY: number; startBottom: number; startX: number; startLeft: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const longPressBookIdRef = useRef<string | null>(null);

  const aanHetLezen = useMemo(
    () =>
      books
        .filter((b) => b.status === "aan-het-lezen")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [books]
  );
  const tbr = useMemo(
    () =>
      books
        .filter((b) => b.status === "wil-ik-lezen")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)),
    [books]
  );
  const readBooks = useMemo(
    () => books.filter((b) => b.status === "gelezen"),
    [books]
  );
  const existingSeries = useMemo(() => {
    const set = new Set<string>();
    readBooks.forEach((b) => {
      if (b.seriesName) set.add(b.seriesName);
    });
    return Array.from(set).sort();
  }, [readBooks]);
  const filteredAndSortedRead = useMemo(() => {
    const filtered =
      readSeriesFilter === "alle"
        ? readBooks
        : readBooks.filter((b) => b.seriesName === readSeriesFilter);
    return [...filtered].sort((a, b) => {
      const aDate = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
      const bDate = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
      if (aDate === bDate) return a.title.localeCompare(b.title);
      return readSortDirection === "desc" ? bDate - aDate : aDate - bDate;
    });
  }, [readBooks, readSeriesFilter, readSortDirection]);

  if (!username) {
    return (
      <div className="page buddy-reading-page">
        <p>Geen Boekbuddy gekozen.</p>
        <Link to={withBase(basePath, "/profiel")} className="link-button">
          Terug naar profiel
        </Link>
      </div>
    );
  }

  if (!isFriend) {
    return (
      <div className="page buddy-reading-page">
        <p>Je bent geen Boekbuddies met {username}. Alleen Boekbuddies kunnen elkaars leeslijst bekijken.</p>
        <Link to={withBase(basePath, "/profiel")} className="link-button">
          Terug naar profiel
        </Link>
      </div>
    );
  }

  const backUrl = withBase(basePath, "/profiel");

  function enterSelectionModeWith(id: string) {
    setSelectionMode(true);
    setSelectedBookIds((prev) => new Set(prev).add(id));
  }

  function toggleBookSelection(book: Book) {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  }

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

  function getSelectedSnapshots() {
    return books
      .filter((b) => selectedBookIds.has(b.id))
      .map((b) => ({ title: b.title, authors: b.authors, coverUrl: b.coverUrl }));
  }

  function handleAddToTbr() {
    const snapshots = getSelectedSnapshots();
    if (!snapshots.length) return;
    const result = addBookSnapshotsToMyLibrary(snapshots, { status: "wil-ik-lezen" });
    setAddResult(result);
    setSelectedBookIds(new Set());
    setSelectionMode(false);
    const msg = result.added > 0
      ? (result.added === 1 ? "1 boek toegevoegd aan TBR." : `${result.added} boeken toegevoegd aan TBR.`)
        + (result.skipped > 0 ? ` ${result.skipped} stond/stonden al in je lijst.` : "")
      : result.skipped > 0 ? `${result.skipped} stond/stonden al in je lijst.` : "";
    if (msg) setToast(msg);
    setTimeout(() => { setAddResult(null); setToast(""); }, 3000);
  }

  const SYSTEM_SHELF_IDS = ["wil-ik-lezen", "aan-het-lezen", "gelezen"];

  function handleAddToShelf(shelfId: string) {
    const snapshots = getSelectedSnapshots();
    if (!snapshots.length) return;
    const options = SYSTEM_SHELF_IDS.includes(shelfId)
      ? { shelfId }
      : { status: "geen-status" as const, shelfId };
    const result = addBookSnapshotsToMyLibrary(snapshots, options);
    setAddResult(result);
    setSelectedBookIds(new Set());
    setShowShelfPicker(false);
    setSelectionMode(false);
    const shelfName = SYSTEM_SHELF_IDS.includes(shelfId) ? STATUS_LABELS[shelfId as ReadStatus] : (shelves.find((s) => s.id === shelfId)?.name ?? "plank");
    const msg = result.added > 0
      ? (result.added === 1 ? `1 boek toegevoegd aan "${shelfName}".` : `${result.added} boeken toegevoegd aan "${shelfName}".`)
        + (result.skipped > 0 ? ` ${result.skipped} stond/stonden al in je lijst.` : "")
      : result.skipped > 0 ? `${result.skipped} stond/stonden al in je lijst.` : "";
    if (msg) setToast(msg);
    setTimeout(() => { setAddResult(null); setToast(""); }, 3000);
  }

  if (booksLoading) {
    return (
      <div className="page buddy-reading-page buddy-reading-mobile-layout">
        <header className="buddy-reading-header">
          <Link to={backUrl} className="buddy-reading-back">
            ← Terug
          </Link>
          <h1 className="buddy-reading-title">Leeslijst van {username}</h1>
        </header>
        <p className="page-intro">Laden…</p>
      </div>
    );
  }

  return (
    <div className="page buddy-reading-page buddy-reading-mobile-layout">
      <header className="buddy-reading-header">
        <Link to={backUrl} className="buddy-reading-back">
          ← Terug
        </Link>
        <h1 className="buddy-reading-title">Leeslijst van {username}</h1>
      </header>

      <section className="card mobile-reading-lists">
        <div className="mobile-books-subtabs" role="tablist" aria-label="Leeslijst of uitgelezen">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "leeslijst"}
            className={`mobile-subtab ${subTab === "leeslijst" ? "active" : ""}`}
            onClick={() => setSubTab("leeslijst")}
          >
            Leeslijst
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "gelezen"}
            className={`mobile-subtab ${subTab === "gelezen" ? "active" : ""}`}
            onClick={() => setSubTab("gelezen")}
          >
            Uitgelezen
          </button>
        </div>

        {(subTab === "leeslijst" || subTab === "gelezen") && (
          <p className="buddy-add-hint">Houd een boek lang ingedrukt om de selectiemodus te openen. Tik daarna op de vakjes of op een boek om te selecteren.</p>
        )}
        {subTab === "leeslijst" && (
          <>
            <h2 className="mobile-section-heading">Aan het lezen</h2>
            <div className="mobile-reading-list">
              {aanHetLezen.map((book) => {
                const selected = selectedBookIds.has(book.id);
                return (
                  <div
                    key={book.id}
                    className={`mobile-reading-item mobile-reading-item-readonly buddy-book-selectable ${selected ? "selected" : ""} ${selected ? "mobile-reading-item-selected" : ""}`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        className={`mobile-reading-checkbox ${selected ? "checked" : ""}`}
                        onClick={() => toggleBookSelection(book)}
                        aria-pressed={selected}
                      >
                        <span className="mobile-reading-checkbox-icon">{selected ? "✓" : ""}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="mobile-reading-main"
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
                      onClick={() => {
                        if (suppressNextClickRef.current) {
                          suppressNextClickRef.current = false;
                          return;
                        }
                        if (selectionMode) {
                          toggleBookSelection(book);
                          return;
                        }
                      }}
                    >
                      <div className="mobile-reading-cover">
                        {book.coverUrl ? (
                          <img src={book.coverUrl} alt={book.title} />
                        ) : (
                          <div className="mobile-reading-placeholder">
                            {book.title.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="mobile-reading-text">
                        {book.seriesName && (
                          <div className="mobile-reading-series-badge">
                            {book.seriesName}
                            {book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}
                          </div>
                        )}
                        <div className="mobile-reading-title">{book.title}</div>
                        <div className="mobile-reading-author">{book.authors}</div>
                        <div className="mobile-reading-pages">
                          {book.pageCount != null ? `${book.pageCount} blz` : "—"}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
              {aanHetLezen.length === 0 && (
                <p className="page-intro-small">Geen boeken aan het lezen.</p>
              )}
            </div>

            <h2 className="mobile-section-heading">TBR</h2>
            <div className="mobile-reading-list">
              {tbr.map((book) => {
                const selected = selectedBookIds.has(book.id);
                return (
                  <div
                    key={book.id}
                    className={`mobile-reading-item mobile-reading-item-readonly buddy-book-selectable ${selected ? "selected" : ""} ${selected ? "mobile-reading-item-selected" : ""}`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        className={`mobile-reading-checkbox ${selected ? "checked" : ""}`}
                        onClick={() => toggleBookSelection(book)}
                        aria-pressed={selected}
                      >
                        <span className="mobile-reading-checkbox-icon">{selected ? "✓" : ""}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="mobile-reading-main"
                      onTouchStart={() => {
                        if (selectionMode) return;
                        longPressBookIdRef.current = book.id;
                        longPressTimerRef.current = setTimeout(() => {
                          const id = longPressBookIdRef.current;
                          if (id) { enterSelectionModeWith(id); suppressNextClickRef.current = true; longPressBookIdRef.current = null; }
                          longPressTimerRef.current = null;
                        }, 500);
                      }}
                      onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onTouchCancel={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onMouseDown={() => {
                        if (selectionMode) return;
                        longPressBookIdRef.current = book.id;
                        longPressTimerRef.current = setTimeout(() => {
                          const id = longPressBookIdRef.current;
                          if (id) { enterSelectionModeWith(id); suppressNextClickRef.current = true; longPressBookIdRef.current = null; }
                          longPressTimerRef.current = null;
                        }, 500);
                      }}
                      onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onClick={() => {
                        if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
                        if (selectionMode) { toggleBookSelection(book); return; }
                      }}
                    >
                      <div className="mobile-reading-cover">
                        {book.coverUrl ? <img src={book.coverUrl} alt={book.title} /> : <div className="mobile-reading-placeholder">{book.title.charAt(0).toUpperCase()}</div>}
                      </div>
                      <div className="mobile-reading-text">
                        {book.seriesName && <div className="mobile-reading-series-badge">{book.seriesName}{book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}</div>}
                        <div className="mobile-reading-title">{book.title}</div>
                        <div className="mobile-reading-author">{book.authors}</div>
                        <div className="mobile-reading-pages">{book.pageCount != null ? `${book.pageCount} blz` : "—"}</div>
                      </div>
                    </button>
                  </div>
                );
              })}
              {tbr.length === 0 && (
                <p className="page-intro-small">Geen TBR-boeken.</p>
              )}
            </div>
          </>
        )}

        {subTab === "gelezen" && (
          <>
            <h2 className="mobile-section-heading">Uitgelezen</h2>
            <div className="mobile-reading-filters">
              <div className="mobile-reading-filter">
                <label className="mobile-reading-filter-label">Serie</label>
                <select
                  className="mobile-reading-filter-select"
                  value={readSeriesFilter}
                  onChange={(e) => setReadSeriesFilter(e.target.value)}
                >
                  <option value="alle">Alle series</option>
                  {existingSeries.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mobile-reading-filter">
                <label className="mobile-reading-filter-label">Sorteren</label>
                <button
                  type="button"
                  className="mobile-reading-sort-toggle"
                  onClick={() =>
                    setReadSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))
                  }
                >
                  Datum uitgelezen ·{" "}
                  {readSortDirection === "desc" ? "Nieuwste eerst" : "Oudste eerst"}
                </button>
              </div>
            </div>
            <div className="mobile-reading-list mobile-reading-list-simple">
              {filteredAndSortedRead.map((book) => {
                const selected = selectedBookIds.has(book.id);
                return (
                  <div
                    key={book.id}
                    className={`mobile-reading-item mobile-reading-item-simple mobile-reading-item-readonly buddy-book-selectable ${selected ? "selected" : ""} ${selected ? "mobile-reading-item-selected" : ""}`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        className={`mobile-reading-checkbox ${selected ? "checked" : ""}`}
                        onClick={() => toggleBookSelection(book)}
                        aria-pressed={selected}
                      >
                        <span className="mobile-reading-checkbox-icon">{selected ? "✓" : ""}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="mobile-reading-main"
                      onTouchStart={() => {
                        if (selectionMode) return;
                        longPressBookIdRef.current = book.id;
                        longPressTimerRef.current = setTimeout(() => {
                          const id = longPressBookIdRef.current;
                          if (id) { enterSelectionModeWith(id); suppressNextClickRef.current = true; longPressBookIdRef.current = null; }
                          longPressTimerRef.current = null;
                        }, 500);
                      }}
                      onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onTouchCancel={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onMouseDown={() => {
                        if (selectionMode) return;
                        longPressBookIdRef.current = book.id;
                        longPressTimerRef.current = setTimeout(() => {
                          const id = longPressBookIdRef.current;
                          if (id) { enterSelectionModeWith(id); suppressNextClickRef.current = true; longPressBookIdRef.current = null; }
                          longPressTimerRef.current = null;
                        }, 500);
                      }}
                      onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; longPressBookIdRef.current = null; }}
                      onClick={() => {
                        if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
                        if (selectionMode) { toggleBookSelection(book); return; }
                      }}
                    >
                      <div className="mobile-reading-cover">
                        {book.coverUrl ? <img src={book.coverUrl} alt={book.title} /> : <div className="mobile-reading-placeholder">{book.title.charAt(0).toUpperCase()}</div>}
                      </div>
                      <div className="mobile-reading-text">
                        {book.seriesName && <div className="mobile-reading-series-badge">{book.seriesName}{book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}</div>}
                        <div className="mobile-reading-title">{book.title}</div>
                        <div className="mobile-reading-author">{book.authors}</div>
                        {book.finishedAt && <div className="mobile-reading-finished">Uitgelezen: {book.finishedAt}</div>}
                      </div>
                    </button>
                  </div>
                );
              })}
              {(filteredAndSortedRead.length === 0 && (
                <p className="page-intro-small">
                  {readBooks.length === 0 ? "Nog geen uitgelezen boeken." : "Geen boeken in deze serie."}
                </p>
              ))}
            </div>
          </>
        )}

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
            <span className="mobile-selection-count">{selectedBookIds.size} geselecteerd</span>
            <button
              type="button"
              className="primary-button mobile-selection-add"
              disabled={selectedBookIds.size === 0}
              onClick={handleAddToTbr}
            >
              Toevoegen aan mijn TBR
            </button>
            <button
              type="button"
              className="secondary-button buddy-selection-btn"
              disabled={selectedBookIds.size === 0}
              onClick={() => setShowShelfPicker(true)}
            >
              Toevoegen aan plank
            </button>
            {showShelfPicker && (
              <div className="buddy-shelf-picker">
                <p className="buddy-shelf-picker-title">Kies een plank</p>
                {shelves.map((shelf) => (
                  <button
                    key={shelf.id}
                    type="button"
                    className="buddy-shelf-option"
                    onClick={() => handleAddToShelf(shelf.id)}
                  >
                    {shelf.name}
                  </button>
                ))}
                <div className="buddy-new-shelf">
                  <input
                    type="text"
                    value={newShelfName}
                    onChange={(e) => setNewShelfName(e.target.value)}
                    placeholder="Nieuwe plank naam…"
                    className="buddy-new-shelf-input"
                  />
                  <button
                    type="button"
                    className="buddy-shelf-option buddy-new-shelf-btn"
                    disabled={!newShelfName.trim()}
                    onClick={() => {
                      const name = newShelfName.trim();
                      if (!name) return;
                      const newShelf = { id: `shelf-${Date.now()}`, name };
                      const next = [...shelves, newShelf];
                      saveShelves(next);
                      setShelves(next);
                      handleAddToShelf(newShelf.id);
                      setNewShelfName("");
                    }}
                  >
                    Nieuwe plank aanmaken
                  </button>
                </div>
                <button type="button" className="link-button" onClick={() => { setShowShelfPicker(false); setNewShelfName(""); }}>
                  Annuleren
                </button>
              </div>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSelectedBookIds(new Set());
                setSelectionMode(false);
                setShowShelfPicker(false);
                setNewShelfName("");
              }}
            >
              Selectiemodus sluiten
            </button>
          </div>
        )}

        {addResult && (
          <p className="buddy-add-result">
            {addResult.added > 0 && <span>{addResult.added} toegevoegd aan je bibliotheek.</span>}
            {addResult.skipped > 0 && <span> {addResult.skipped} stond/stonden al in je lijst.</span>}
          </p>
        )}
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

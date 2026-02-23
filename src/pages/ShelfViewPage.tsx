import { useParams, Link, useNavigate } from "react-router-dom";
import { Book, ReadStatus, Shelf } from "../types";
import { loadBooks, loadShelves, saveShelves, saveBooks, subscribeBooks, loadFriends, shareWithFriend } from "../storage";
import { useBasePath, withBase } from "../routing";
import { useMemo, useState, useEffect, useRef } from "react";

const STATUS_MAP: Record<string, ReadStatus> = {
  "wil-ik-lezen": "wil-ik-lezen",
  "aan-het-lezen": "aan-het-lezen",
  gelezen: "gelezen"
};

function getBooksForShelf(shelf: Shelf | null, books: Book[]): Book[] {
  if (!shelf) return [];
  const status = STATUS_MAP[shelf.id];
  if (status) {
    return [...books.filter((b) => b.status === status)].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }
  return [...books.filter((b) => b.shelfIds?.includes(shelf.id))].sort((a, b) =>
    a.title.localeCompare(b.title)
  );
}

export function ShelfViewPage() {
  const { shelfId } = useParams<{ shelfId: string }>();
  const basePath = useBasePath();
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  const shelf = useMemo(
    () => shelves.find((s) => s.id === shelfId) ?? null,
    [shelves, shelfId]
  );
  const shelfBooks = useMemo(
    () => getBooksForShelf(shelf, books),
    [shelf, books]
  );
  const [showShareShelfModal, setShowShareShelfModal] = useState(false);
  const [shareShelfError, setShareShelfError] = useState("");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showAddToShelfModal, setShowAddToShelfModal] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [pendingCustomShelfId, setPendingCustomShelfId] = useState<string | null>(null);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [showShareSelectedModal, setShowShareSelectedModal] = useState(false);
  const [shareSelectedError, setShareSelectedError] = useState("");
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const longPressBookIdRef = useRef<string | null>(null);

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
    gelezen: "Gelezen"
  };

  function addSelectedBooksToShelf(targetShelfId: string, explicitStatus?: ReadStatus) {
    if (selectedBookIds.size === 0) return;
    const status = explicitStatus ?? STATUS_MAP[targetShelfId];
    const isCustomShelf = !STATUS_MAP[targetShelfId];
    const ids = Array.from(selectedBookIds);
    const next = books.map((b) => {
      if (!ids.includes(b.id)) return b;
      const shelfIds = b.shelfIds ?? [];
      if (status) {
        const addToShelfIds = isCustomShelf && !shelfIds.includes(targetShelfId);
        return {
          ...b,
          status,
          ...(addToShelfIds ? { shelfIds: [...shelfIds, targetShelfId] } : {})
        };
      }
      if (shelfIds.includes(targetShelfId)) return b;
      return { ...b, shelfIds: [...shelfIds, targetShelfId] };
    });
    persist(next);
    const shelfName = shelves.find((s) => s.id === targetShelfId)?.name ?? "plank";
    setToast(
      selectedBookIds.size === 1
        ? `Boek toegevoegd aan "${shelfName}".`
        : `${selectedBookIds.size} boeken toegevoegd aan "${shelfName}".`
    );
    setSelectedBookIds(new Set());
    window.setTimeout(() => setToast(""), 2500);
    setShowAddToShelfModal(false);
    setPendingCustomShelfId(null);
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
        <p>Plank niet gevonden.</p>
        <Link to={withBase(basePath, "/planken")} className="link-button">
          Terug naar planken
        </Link>
      </div>
    );
  }

  function goToBook(bookId: string) {
    navigate(withBase(basePath, `/boek/${bookId}`));
  }

  return (
    <div className="page shelf-view-page">
      <header className="shelf-view-header">
        <Link
          to={withBase(basePath, "/planken")}
          className="shelf-view-back"
        >
          ← Terug
        </Link>
        <h1 className="shelf-view-title">{shelf.name}</h1>
        <p className="shelf-view-count">
          {shelfBooks.length} {shelfBooks.length === 1 ? "boek" : "boeken"}
        </p>
        {shelfBooks.length > 0 && (
          <button
            type="button"
            className="secondary-button shelf-view-share"
            onClick={() => { setShareShelfError(""); setShowShareShelfModal(true); }}
          >
            Deel plank met Boekbuddy
          </button>
        )}
      </header>

      {showShareShelfModal && (
        <div className="modal-backdrop" onClick={() => { setShowShareShelfModal(false); setShareShelfError(""); }}>
          <div className="modal modal-add-to-shelf" onClick={(e) => e.stopPropagation()}>
            <h3>Plank delen met Boekbuddy</h3>
            <p className="modal-intro">
              Kies een Boekbuddy om de plank &quot;{shelf.name}&quot; ({shelfBooks.length} boek{shelfBooks.length === 1 ? "" : "en"}) mee te delen. Ze kunnen de boeken aan hun TBR toevoegen.
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

      <div className="bookcase">
        {shelfBooks.length === 0 ? (
          <div className="bookcase-empty">
            <p>Geen boeken op deze plank.</p>
          </div>
        ) : (
          <div className="bookcase-shelf">
            <div className="bookcase-books">
              {shelfBooks.map((book) => {
                const isSelected = selectedBookIds.has(book.id);
                return (
                <div
                  key={book.id}
                  className={`bookcase-book ${isSelected ? "bookcase-book-selected" : ""}`}
                >
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
                    {book.authors && (
                      <span className="bookcase-book-author">{book.authors}</span>
                    )}
                  </button>
                </div>
              );
              })}
            </div>
            <div className="bookcase-plank" aria-hidden="true" />
          </div>
        )}
      </div>

      {selectionMode && selectedBookIds.size > 0 && (
        <div className="mobile-selection-bar">
          <span className="mobile-selection-count">
            {selectedBookIds.size} geselecteerd
          </span>
          <button
            type="button"
            className="primary-button mobile-selection-add"
            onClick={() => setShowAddToShelfModal(true)}
          >
            Toevoegen aan plank
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => { setShareSelectedError(""); setShowShareSelectedModal(true); }}
          >
            Delen met Boekbuddy
          </button>
          <button
            type="button"
            className="secondary-button destructive"
            onClick={() => setShowDeleteSelectedModal(true)}
          >
            Verwijderen
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
            <h3>Kies plank</h3>
            <p className="modal-intro">
              {pendingCustomShelfId
                ? "Kies status voor deze plank"
                : `Kies een plank voor ${selectedBookIds.size} boek${selectedBookIds.size === 1 ? "" : "en"}.`}
            </p>
            {pendingCustomShelfId ? (
              <ul className="add-to-shelf-list">
                {(["wil-ik-lezen", "aan-het-lezen", "gelezen"] as const).map((status) => (
                  <li key={status}>
                    <button
                      type="button"
                      className="add-to-shelf-item"
                      onClick={() => addSelectedBooksToShelf(pendingCustomShelfId, status)}
                    >
                      {STATUS_LABELS[status]}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <ul className="add-to-shelf-list">
                  {shelves.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="add-to-shelf-item"
                        onClick={() => {
                          if (s.system) {
                            addSelectedBooksToShelf(s.id);
                          } else {
                            setPendingCustomShelfId(s.id);
                          }
                        }}
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
                    placeholder="Nieuwe plank naam…"
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
                      setPendingCustomShelfId(newShelf.id);
                      setNewShelfName("");
                    }}
                  >
                    Nieuwe plank aanmaken
                  </button>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowAddToShelfModal(false);
                  setSelectedBookIds(new Set());
                  setNewShelfName("");
                  setPendingCustomShelfId(null);
                }}
              >
                {pendingCustomShelfId ? "Terug" : "Annuleren"}
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

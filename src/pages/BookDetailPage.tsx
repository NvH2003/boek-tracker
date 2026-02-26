import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { loadBooks, loadShelves, saveBooks, subscribeBooks } from "../storage";
import { Book, ReadStatus, Shelf } from "../types";
import { RatingStars } from "../components/RatingStars";
import { useBasePath, withBase } from "../routing";

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
  const navigate = useNavigate();
  const basePath = useBasePath();
  const [books, setBooks] = useState<Book[]>(() => loadBooks());

  const id = modalBookId ?? routeId;
  const isModal = Boolean(modalBookId && onClose);

  // Sync books tussen tabs/shells (web ↔ mobile)
  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  const book = books.find((b) => b.id === id);

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
  const [order, setOrder] = useState<string>(
    book?.order?.toString() ?? ""
  );
  const [pageCount, setPageCount] = useState<string>(
    book?.pageCount != null ? book.pageCount.toString() : ""
  );
  const [coverUrl, setCoverUrl] = useState<string>(book?.coverUrl ?? "");
  const [description, setDescription] = useState<string>(book?.description ?? "");
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [useCustomSeries, setUseCustomSeries] = useState<boolean>(() => {
    // Als het boek al een serie heeft die niet in de bestaande series staat, gebruik custom input
    if (book?.seriesName) {
      const allSeries = new Set<string>();
      loadBooks().forEach((b) => {
        if (b.seriesName) allSeries.add(b.seriesName);
      });
      return !allSeries.has(book.seriesName);
    }
    return false;
  });

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

  const shelves = useMemo(() => loadShelves(), []);
  const bookPlanks = useMemo(() => {
    const ids = book?.shelfIds ?? [];
    return ids
      .map((shelfId) => shelves.find((s) => s.id === shelfId))
      .filter((s): s is NonNullable<typeof s> => s != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [book?.shelfIds, shelves]);

  if (!book) {
    return (
      <div className="page">
        <h1>Boek niet gevonden</h1>
        <p>Dit boek bestaat niet (meer) in je bibliotheek.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => (isModal ? onClose?.() : navigate(withBase(basePath, "/boeken")))}
        >
          Terug naar overzicht
        </button>
      </div>
    );
  }

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
            order: !finalSeriesName && order ? Number(order) : undefined,
            coverUrl: coverUrl.trim() || undefined,
            description: description.trim() || undefined,
            pageCount: pageCount ? Number(pageCount) || undefined : undefined
          }
        : b
    );
    persist(updatedBooks);
    if (isModal) onClose?.();
    else navigate(withBase(basePath, "/boeken"));
  }

  function handleSeriesSelect(value: string) {
    if (value === "__new__") {
      setUseCustomSeries(true);
      setSeriesName("");
    } else {
      setUseCustomSeries(false);
      setSeriesName(value);
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

      {bookPlanks.length > 0 && (
        <div className="book-detail-shelves-summary">
          <span className="book-detail-shelves-label">Boekenkasten:</span>
          <div className="book-detail-shelves-pills">
            {bookPlanks.map((shelf) => (
              <span key={shelf.id} className="plank-pill plank-pill-inline">
                {shelf.name}
              </span>
            ))}
          </div>
        </div>
      )}
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
        <div className="form-field">
          <span>Serie naam (optioneel)</span>
          {!useCustomSeries && existingSeries.length > 0 ? (
            <div className="series-select-wrapper">
              <select
                value={seriesName || ""}
                onChange={(e) => handleSeriesSelect(e.target.value)}
                className="series-select"
              >
                <option value="">Geen serie</option>
                {existingSeries.map((series) => (
                  <option key={series} value={series}>
                    {series}
                  </option>
                ))}
                <option value="__new__">+ Nieuwe serie toevoegen</option>
              </select>
            </div>
          ) : (
            <div className="series-input-wrapper">
              <input
                type="text"
                value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)}
                placeholder="Bijv. De zeven zussen"
                className="series-input"
              />
              {existingSeries.length > 0 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setUseCustomSeries(false)}
                >
                  Selecteer bestaande serie
                </button>
              )}
            </div>
          )}
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
            placeholder={seriesName ? "Bijv. 1" : "Bijv. 1"}
            min="1"
          />
        </div>
        <div className="form-field book-detail-planks">
          <span>Staat op boekenkast</span>
          <div className="book-detail-plank-pills">
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


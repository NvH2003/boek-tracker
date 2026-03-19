import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Book, Shelf } from "../types";
import { loadBooks, loadShelves, saveShelves, subscribeBooks } from "../storage";
import { useBasePath, withBase } from "../routing";

type ShelfSortMode = "name" | "booksDesc" | "booksAsc";

export function ShelvesPage() {
  const basePath = useBasePath();
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [sortMode, setSortMode] = useState<ShelfSortMode>("name");

  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  function persist(newShelves: Shelf[]) {
    setShelves(newShelves);
    saveShelves(newShelves);
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const shelf: Shelf = {
      id: `shelf-${Date.now()}`,
      name: newName.trim()
    };
    persist([...shelves, shelf]);
    setNewName("");
  }

  function startEdit(shelf: Shelf) {
    setEditingId(shelf.id);
    setEditName(shelf.name);
  }

  function saveEdit(id: string) {
    if (!editName.trim()) {
      cancelEdit();
      return;
    }
    const updated = shelves.map((s) =>
      s.id === id ? { ...s, name: editName.trim() } : s
    );
    persist(updated);
    setEditingId(null);
    setEditName("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  function removeShelf(id: string) {
    persist(shelves.filter((s) => s.id !== id));
  }

  const shelvesWithCounts = useMemo(() => {
    const countsById = new Map<string, number>();
    books.forEach((b) => {
      const statusMap: Record<string, string> = {
        "wil-ik-lezen": "wil-ik-lezen",
        "aan-het-lezen": "aan-het-lezen",
        "gelezen": "gelezen"
      };
      // Status-planken tellen op basis van status
      const statusId = Object.keys(statusMap).find((id) => statusMap[id] === b.status);
      if (statusId) {
        countsById.set(statusId, (countsById.get(statusId) ?? 0) + 1);
      }
      // Custom planken tellen op basis van shelfIds
      (b.shelfIds ?? []).forEach((id) => {
        countsById.set(id, (countsById.get(id) ?? 0) + 1);
      });
    });
    return shelves.map((s) => ({
      shelf: s,
      count: countsById.get(s.id) ?? 0
    }));
  }, [shelves, books]);

  const sortedShelves = useMemo(() => {
    return [...shelvesWithCounts].sort((a, b) => {
      // Standaard-planken altijd eerst
      const aSystem = a.shelf.system ? 0 : 1;
      const bSystem = b.shelf.system ? 0 : 1;
      if (aSystem !== bSystem) return aSystem - bSystem;

      if (sortMode === "booksDesc") {
        if (b.count !== a.count) return b.count - a.count;
      } else if (sortMode === "booksAsc") {
        if (a.count !== b.count) return a.count - b.count;
      }
      return a.shelf.name.localeCompare(b.shelf.name);
    });
  }, [shelvesWithCounts, sortMode]);

  return (
    <div className="page">
      <h1>Boekenkasten</h1>
      

      <section className="card">
        <h2>Nieuwe boekenkast</h2>
        <form onSubmit={handleAdd} className="inline-form">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Bijv. Favorieten, Non-fictie"
          />
          <button type="submit" className="primary-button">
            Boekenkast toevoegen
          </button>
        </form>
      </section>

      <section className="card">
        <div className="shelf-list-header">
          <h2>Mijn boekenkasten</h2>
          <div className="shelf-list-sort">
            <span className="shelf-list-sort-label">Sorteer op:</span>
            <div className="shelf-list-sort-buttons">
              <button
                type="button"
                className={`shelf-view-sort-pill ${sortMode === "name" ? "active" : ""}`}
                onClick={() => setSortMode("name")}
              >
                Naam A–Z
              </button>
              <button
                type="button"
                className={`shelf-view-sort-pill ${sortMode === "booksDesc" ? "active" : ""}`}
                onClick={() => setSortMode("booksDesc")}
              >
                Meeste boeken
              </button>
              <button
                type="button"
                className={`shelf-view-sort-pill ${sortMode === "booksAsc" ? "active" : ""}`}
                onClick={() => setSortMode("booksAsc")}
              >
                Minste boeken
              </button>
            </div>
          </div>
        </div>
        <ul className="shelf-list">
          {sortedShelves.map(({ shelf, count }) => (
            <li key={shelf.id} className="shelf-item">
              {editingId === shelf.id ? (
                <div className="shelf-edit-form">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(shelf.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    autoFocus
                    className="shelf-edit-input"
                  />
                  <div className="shelf-edit-actions">
                    <button
                      type="button"
                      onClick={() => saveEdit(shelf.id)}
                      className="link-button"
                    >
                      Opslaan
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="link-button"
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Link
                    to={withBase(basePath, `/plank/${shelf.id}`)}
                    className="shelf-item-name"
                  >
                    {shelf.name}
                    {shelf.system && (
                      <span className="tag">Standaard</span>
                    )}
                    <span className="shelf-item-count">
                      {count} {count === 1 ? "boek" : "boeken"}
                    </span>
                  </Link>
                  <div className="shelf-item-actions">
                    <button
                      type="button"
                      onClick={() => startEdit(shelf)}
                      className="link-button"
                    >
                      Bewerken
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShelf(shelf.id)}
                      className="link-button destructive"
                    >
                      Verwijderen
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}


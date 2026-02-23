import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Shelf } from "../types";
import { loadShelves, saveShelves } from "../storage";
import { useBasePath, withBase } from "../routing";

export function ShelvesPage() {
  const basePath = useBasePath();
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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

  return (
    <div className="page">
      <h1>Planken</h1>
      

      <section className="card">
        <h2>Nieuwe plank</h2>
        <form onSubmit={handleAdd} className="inline-form">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Bijv. Favorieten, Non-fictie"
          />
          <button type="submit" className="primary-button">
            Plank toevoegen
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Mijn planken</h2>
        <ul className="shelf-list">
          {shelves.map((shelf) => (
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


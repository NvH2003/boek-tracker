import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ReadStatus, Shelf } from "../types";

const STATUS_LABELS: Record<ReadStatus, string> = {
  "wil-ik-lezen": "Wil ik lezen",
  "aan-het-lezen": "Aan het lezen",
  gelezen: "Gelezen",
  "geen-status": "Geen status"
};
import { useBasePath, withBase } from "../routing";
import { useZoom } from "../ZoomContext";
import {
  loadShelves,
  saveShelves,
  loadFriends,
  getPendingReceivedRequests,
  getPendingSentRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  loadSharedInbox,
  addSharedItemToTbr,
  addSharedItemBooksToTbr,
  addBookSnapshotsToMyLibrary,
  dismissSharedItem
} from "../storage";
import { getCurrentUsername, getExistingUsernames, changePassword, deleteAccount, refreshAuthCache } from "../auth";

const DISPLAY_NAME_KEY = "bt_user_name";

function displayNameKey(): string {
  const u = getCurrentUsername();
  return u ? `${DISPLAY_NAME_KEY}_${u}` : DISPLAY_NAME_KEY;
}

interface ProfilePageProps {
  onLogout: () => void;
}

export function ProfilePage({ onLogout }: ProfilePageProps) {
  const navigate = useNavigate();
  const basePath = useBasePath();
  const username = getCurrentUsername();
  const [name, setName] = useState<string>(
    () => window.localStorage.getItem(displayNameKey()) ?? ""
  );

  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [friends, setFriends] = useState<string[]>(() => loadFriends());
  const [pendingReceived, setPendingReceived] = useState<string[]>(() => getPendingReceivedRequests());
  const [pendingSent, setPendingSent] = useState<string[]>(() => getPendingSentRequests());
  const [searchQuery, setSearchQuery] = useState("");
  const [friendError, setFriendError] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [sharedInbox, setSharedInbox] = useState(() => loadSharedInbox());
  const [showSharedInboxModal, setShowSharedInboxModal] = useState(false);
  const [sharedAddMessage, setSharedAddMessage] = useState<{ added: number; skipped: number } | null>(null);
  const [toast, setToast] = useState("");
  /** Per shared-item index: set van boek-indices die geselecteerd zijn */
  const [selectedSharedBookIndices, setSelectedSharedBookIndices] = useState<Map<number, Set<number>>>(() => new Map());
  const [showShelfPickerForItem, setShowShelfPickerForItem] = useState<number | null>(null);
  const [newShelfNameInbox, setNewShelfNameInbox] = useState("");
  /** Bij eigen boekenkast: kies eerst status voordat we toevoegen */
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [deleteAccountError, setDeleteAccountError] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [usernamesRefresh, setUsernamesRefresh] = useState(0);
  const [usernamesLoadError, setUsernamesLoadError] = useState<string | null>(null);

  // Zoekresultaten: bestaande accounts die matchen met zoektekst, exclusief jezelf (usernamesRefresh zorgt voor herberekenen na cache-refresh)
  const searchResults = (() => {
    void usernamesRefresh;
    const q = searchQuery.trim().toLowerCase();
    const existing = getExistingUsernames();
    const current = (username ?? "").toLowerCase();
    return existing.filter(
      (u) => u.toLowerCase() !== current && (!q || u.toLowerCase().includes(q))
    );
  })();

  function refreshFriendState() {
    setFriends(loadFriends());
    setPendingReceived(getPendingReceivedRequests());
    setPendingSent(getPendingSentRequests());
  }
  function refreshSharedInbox() {
    setSharedInbox(loadSharedInbox());
  }

  function toggleSharedBookSelection(itemIndex: number, bookIndex: number) {
    setSelectedSharedBookIndices((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(itemIndex) ?? []);
      if (set.has(bookIndex)) set.delete(bookIndex);
      else set.add(bookIndex);
      if (set.size === 0) next.delete(itemIndex);
      else next.set(itemIndex, set);
      return next;
    });
  }

  function selectAllInSharedItem(itemIndex: number, bookCount: number) {
    setSelectedSharedBookIndices((prev) => {
      const next = new Map(prev);
      next.set(itemIndex, new Set(Array.from({ length: bookCount }, (_, i) => i)));
      return next;
    });
  }

  function clearSelectionForItem(itemIndex: number) {
    setSelectedSharedBookIndices((prev) => {
      const next = new Map(prev);
      next.delete(itemIndex);
      return next;
    });
  }

  function getSelectedCount(itemIndex: number): number {
    return selectedSharedBookIndices.get(itemIndex)?.size ?? 0;
  }

  // Bij openen van Profiel: gebruikerslijst vernieuwen (Supabase)
  useEffect(() => {
    refreshAuthCache().then((res) => {
      if (res.ok) {
        setUsernamesRefresh((v) => v + 1);
        setUsernamesLoadError(null);
      } else {
        setUsernamesLoadError(res.error);
      }
    });
  }, []);

  async function refreshBoekbuddiesList() {
    setUsernamesLoadError(null);
    const res = await refreshAuthCache();
    if (res.ok) {
      setUsernamesRefresh((v) => v + 1);
      setToast("Lijst vernieuwd.");
      window.setTimeout(() => setToast(""), 2000);
    } else {
      setUsernamesLoadError(res.error);
    }
  }

  // Keep shelves, display name, friends/requests and shared inbox in sync if another tab edits them
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key?.startsWith("bt_shelves_v1")) setShelves(loadShelves());
      if (e.key?.startsWith(DISPLAY_NAME_KEY)) setName(window.localStorage.getItem(displayNameKey()) ?? "");
      if (e.key?.startsWith("bt_friends_v1") || e.key === "bt_friend_requests_v1") refreshFriendState();
      if (e.key?.startsWith("bt_shared_inbox_v1")) refreshSharedInbox();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function persist(next: Shelf[]) {
    setShelves(next);
    saveShelves(next);
  }

  function handleAddShelf(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const shelf: Shelf = {
      id: `shelf-${Date.now()}`,
      name: newName.trim()
    };
    persist([...shelves, shelf]);
    setNewName("");
  }

  function startEditShelf(shelf: Shelf) {
    setEditingId(shelf.id);
    setEditName(shelf.name);
  }

  function saveEditShelf(id: string) {
    if (!editName.trim()) {
      cancelEditShelf();
      return;
    }
    const updated = shelves.map((s) =>
      s.id === id ? { ...s, name: editName.trim() } : s
    );
    persist(updated);
    setEditingId(null);
    setEditName("");
  }

  function cancelEditShelf() {
    setEditingId(null);
    setEditName("");
  }

  function removeShelf(id: string) {
    persist(shelves.filter((s) => s.id !== id));
  }

  function saveProfile(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    window.localStorage.setItem(displayNameKey(), trimmed);
  }

  function handleSendFriendRequest(username: string) {
    setFriendError("");
    const result = sendFriendRequest(username);
    if (result.ok) {
      refreshFriendState();
    } else {
      setFriendError(result.error);
    }
  }

  function handleAcceptRequest(fromUsername: string) {
    acceptFriendRequest(fromUsername);
    refreshFriendState();
  }

  function handleRejectRequest(fromUsername: string) {
    rejectFriendRequest(fromUsername);
    refreshFriendState();
  }

  function handleRemoveFriend(username: string) {
    removeFriend(username);
    refreshFriendState();
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError("Nieuw wachtwoord en bevestiging komen niet overeen.");
      return;
    }
    const result = await changePassword(currentPassword, newPassword);
    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
    } else {
      setPasswordError(result.error);
    }
  }

  async function handleDeleteAccount(e: FormEvent) {
    e.preventDefault();
    setDeleteAccountError("");
    if (!deleteAccountPassword.trim()) {
      setDeleteAccountError("Vul je wachtwoord in om te bevestigen.");
      return;
    }
    setDeleteAccountLoading(true);
    const result = await deleteAccount(deleteAccountPassword);
    setDeleteAccountLoading(false);
    if (result.ok) {
      setShowAccountModal(false);
      setShowDeleteAccount(false);
      setDeleteAccountPassword("");
      onLogout();
      navigate(withBase(basePath, "/login"), { replace: true });
    } else {
      setDeleteAccountError(result.error);
    }
  }

  const displayInitial = (name || username || "?").charAt(0).toUpperCase();
  const { zoomEnabled, setZoomEnabled } = useZoom();

  return (
    <div className="page profile-page">
      <header className="profile-hero">
        <div className="profile-avatar" aria-hidden="true">
          {displayInitial}
        </div>
        <div className="profile-hero-text">
          <h1 className="profile-display-name">
            {name.trim() || "Profiel"}
          </h1>
          {username && (
            <span className="profile-username-badge">{username}</span>
          )}
        </div>
      </header>

      <div className="profile-hero-actions">
        <Link to="/bibliotheek" className="profile-hero-btn profile-hero-btn-primary">
          Mijn bibliotheek
        </Link>
        <button
          type="button"
          className="profile-hero-btn"
          onClick={() => setShowAccountModal(true)}
        >
          Mijn account bewerken
        </button>
        <button type="button" className="profile-hero-btn profile-hero-btn-logout" onClick={onLogout}>
          Uitloggen
        </button>
        <div className="profile-zoom-toggle">
          <span className="profile-zoom-label" aria-live="polite">
            {zoomEnabled ? "Inzoomen staat aan (pinch om te zoomen)" : "Inzoomen staat uit"}
          </span>
          <button
            type="button"
            className={zoomEnabled ? "secondary-button profile-zoom-btn" : "link-button profile-zoom-btn"}
            onClick={() => setZoomEnabled(!zoomEnabled)}
          >
            {zoomEnabled ? "Inzoomen uitzetten" : "Inzoomen aanzetten"}
          </button>
        </div>
      </div>

      {showAccountModal && (
        <div className="modal-backdrop" onClick={() => setShowAccountModal(false)}>
          <div className="modal profile-account-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mijn account bewerken</h3>
            <form onSubmit={saveProfile} className="profile-form-row profile-modal-form-row">
              <label className="profile-field profile-field-grow">
                <span className="profile-field-label">Weergavenaam</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Bijv. Jan"
                  className="profile-input"
                />
              </label>
              <button type="submit" className="primary-button">
                Opslaan
              </button>
            </form>
            <h4 className="profile-modal-subtitle">Wachtwoord wijzigen</h4>
            <form onSubmit={handleChangePassword} className="password-form profile-password-form">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Huidige wachtwoord"
                autoComplete="current-password"
                className="profile-input"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nieuw wachtwoord (min. 4 tekens)"
                autoComplete="new-password"
                className="profile-input"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Nieuw wachtwoord bevestigen"
                autoComplete="new-password"
                className="profile-input"
              />
              {passwordError && <p className="form-error">{passwordError}</p>}
              {passwordSuccess && <p className="form-success">Wachtwoord is gewijzigd.</p>}
              <button type="submit" className="primary-button">
                Wachtwoord wijzigen
              </button>
            </form>

            {showDeleteAccount && (
              <form onSubmit={handleDeleteAccount} className="profile-delete-account-form">
                <p className="profile-delete-account-warning">
                  Weet je het zeker? Je account en alle gegevens (boeken, boekenkasten, vrienden) worden definitief gewist. Dit kan niet ongedaan worden gemaakt.
                </p>
                <label className="form-field">
                  <span className="profile-field-label">Vul je wachtwoord in om te bevestigen</span>
                  <input
                    type="password"
                    value={deleteAccountPassword}
                    onChange={(e) => setDeleteAccountPassword(e.target.value)}
                    placeholder="Wachtwoord"
                    autoComplete="current-password"
                    className="profile-input"
                    disabled={deleteAccountLoading}
                  />
                </label>
                {deleteAccountError && <p className="form-error">{deleteAccountError}</p>}
                <button
                  type="submit"
                  className="primary-button destructive"
                  disabled={deleteAccountLoading || !deleteAccountPassword.trim()}
                >
                  {deleteAccountLoading ? "Bezig…" : "Account definitief verwijderen"}
                </button>
              </form>
            )}

            <div className="profile-modal-actions profile-modal-actions-with-delete">
              <button
                type="button"
                className="secondary-button profile-delete-account-btn destructive"
                onClick={() => {
                  setShowDeleteAccount((v) => !v);
                  setDeleteAccountError("");
                  setDeleteAccountPassword("");
                }}
              >
                {showDeleteAccount ? "Annuleren" : "Account verwijderen"}
              </button>
              <button type="button" className="secondary-button" onClick={() => setShowAccountModal(false)}>
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="profile-card card">
        <h2 className="profile-card-title">Boekbuddies</h2>
        <p className="profile-card-desc">
          Stuur een vriendschapsverzoek. Na acceptatie kun je elkaars leeslijst bekijken en boeken delen.</p>

        {sharedInbox.length > 0 && (
          <>
            <h3 className="profile-subtitle">Gedeeld met jou</h3>
            <button
              type="button"
              className="shared-inbox-open-btn"
              onClick={() => setShowSharedInboxModal(true)}
            >
              <span className="shared-inbox-open-icon">📬</span>
              <span>{sharedInbox.length} gedeeld item{sharedInbox.length === 1 ? "" : "s"} bekijken</span>
            </button>
          </>
        )}

        {pendingReceived.length > 0 && (
          <>
            <h3 className="profile-subtitle">Inkomende vriendschapsverzoeken</h3>
            <div className="profile-chips profile-chips-requests">
              {pendingReceived.map((u) => (
                <div key={u} className="profile-chip">
                  <span>{u}</span>
                  <div className="profile-chip-actions">
                    <button type="button" onClick={() => handleAcceptRequest(u)} className="profile-chip-btn profile-chip-btn-accept">
                      Accepteren
                    </button>
                    <button type="button" onClick={() => handleRejectRequest(u)} className="profile-chip-btn profile-chip-btn-remove">
                      Afwijzen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h3 className="profile-subtitle">Zoek Boekbuddies</h3>
        <p className="profile-search-hint">De accountlijst wordt geladen bij openen en bij klikken in het zoekveld. Zie je iemand niet? Klik in het veld of op Vernieuwen.</p>
        <div className="profile-search-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setFriendError(""); }}
            onFocus={refreshBoekbuddiesList}
            placeholder="Zoek op gebruikersnaam…"
            className="profile-search-input"
            autoComplete="username"
          />
          <button type="button" className="secondary-button profile-refresh-btn" onClick={refreshBoekbuddiesList}>
            Vernieuwen
          </button>
        </div>
        {usernamesLoadError && <p className="form-error">Lijst kon niet worden geladen: {usernamesLoadError}</p>}
        {friendError && <p className="form-error">{friendError}</p>}
        {searchQuery.trim() && (
          <div className="profile-search-results">
            {searchResults.length === 0 ? (
              <p className="profile-empty">Geen accounts gevonden.</p>
            ) : (
              <div className="profile-chips">
                {searchResults.map((u) => {
                  const isFriend = friends.some((f) => f.toLowerCase() === u.toLowerCase());
                  const sentRequest = pendingSent.some((f) => f.toLowerCase() === u.toLowerCase());
                  return (
                    <div key={u} className="profile-chip">
                      <span>{u}</span>
                      {isFriend ? (
                        <Link to={withBase(basePath, `/boekbuddy/${encodeURIComponent(u)}`)} className="profile-chip-btn profile-chip-link">
                          Bekijk leeslijst
                        </Link>
                      ) : sentRequest ? (
                        <span className="profile-chip-badge">Verzonden</span>
                      ) : (
                        <button type="button" onClick={() => handleSendFriendRequest(u)} className="profile-chip-btn">
                          Vriendschapsverzoek sturen
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <h3 className="profile-subtitle">Mijn Boekbuddies</h3>
        {(() => {
          const existingSet = new Set(getExistingUsernames().map((x) => x.toLowerCase()));
          const visibleFriends = friends.filter((u) => existingSet.has(u.toLowerCase()));
          return visibleFriends.length > 0 ? (
          <div className="profile-chips">
            {visibleFriends.map((u) => (
              <div key={u} className="profile-chip">
                <span>{u}</span>
                <div className="profile-chip-actions">
                  <Link to={withBase(basePath, `/boekbuddy/${encodeURIComponent(u)}`)} className="profile-chip-btn profile-chip-link">
                    Bekijk leeslijst
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleRemoveFriend(u)}
                    className="profile-chip-btn profile-chip-btn-remove"
                    title="Ontvrienden"
                  >
                    Ontvrienden
                  </button>
                </div>
              </div>
            ))}
          </div>
          ) : (
          <p className="profile-empty">Nog geen Boekbuddies. Zoek hierboven en stuur een vriendschapsverzoek.</p>
        );
        })()}
      </section>

      <section className="profile-card card">
        <h2 className="profile-card-title">Boekenkasten</h2>
        <p className="profile-card-desc">Eigen boekenkasten om je boeken in te delen.</p>
        <form onSubmit={handleAddShelf} className="profile-form-row">
          <label className="profile-field profile-field-grow">
            <span className="profile-field-label visually-hidden">Nieuwe boekenkast</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Naam van de boekenkast…"
              className="profile-input"
            />
          </label>
          <button type="submit" className="primary-button">
            Toevoegen
          </button>
        </form>

        <ul className="profile-shelf-list">
          {shelves.map((shelf) => (
            <li key={shelf.id} className={`profile-shelf-item ${editingId === shelf.id ? "editing" : ""}`}>
              {editingId === shelf.id ? (
                <div className="profile-shelf-edit">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditShelf(shelf.id);
                      if (e.key === "Escape") cancelEditShelf();
                    }}
                    autoFocus
                    className="profile-input profile-shelf-edit-input"
                  />
                  <div className="profile-shelf-edit-actions">
                    <button type="button" onClick={() => saveEditShelf(shelf.id)} className="link-button">
                      Opslaan
                    </button>
                    <button type="button" onClick={cancelEditShelf} className="link-button">
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Link
                    to={withBase(basePath, `/plank/${shelf.id}`)}
                    className="profile-shelf-name"
                  >
                    {shelf.name}
                    {shelf.system && <span className="profile-shelf-tag">Standaard</span>}
                  </Link>
                  <div className="profile-shelf-actions">
                    <button type="button" onClick={() => startEditShelf(shelf)} className="link-button">
                      Bewerken
                    </button>
                    {!shelf.system && (
                      <button type="button" onClick={() => removeShelf(shelf.id)} className="link-button destructive">
                        Verwijderen
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {showSharedInboxModal && (
        <div className="modal-backdrop shared-inbox-modal-backdrop" onClick={() => { setShowSharedInboxModal(false); setShowShelfPickerForItem(null); }}>
          <div className="modal shared-inbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shared-inbox-modal-header">
              <h3>Gedeeld met jou</h3>
              <button type="button" className="shared-inbox-modal-close" onClick={() => { setShowSharedInboxModal(false); setShowShelfPickerForItem(null); }} aria-label="Sluiten">
                ×
              </button>
            </div>
            {sharedAddMessage && (
              <p className="shared-inbox-feedback shared-inbox-modal-feedback">
                {sharedAddMessage.added > 0 && <span>{sharedAddMessage.added} toegevoegd aan TBR.</span>}
                {sharedAddMessage.skipped > 0 && <span> {sharedAddMessage.skipped} stond/stonden al in je lijst.</span>}
              </p>
            )}
            <div className="shared-inbox-modal-list">
              {sharedInbox.map((item, itemIndex) => (
                <div key={`${item.from}-${item.sharedAt}-${itemIndex}`} className="shared-inbox-modal-item">
                  <p className="shared-inbox-from">
                    <strong>{item.from}</strong>
                    {item.shelfName
                      ? ` deelde de boekenkast "${item.shelfName}" (${item.books.length} boek${item.books.length === 1 ? "" : "en"})`
                      : ` deelde ${item.books.length} boek${item.books.length === 1 ? "" : "en"}`}
                  </p>
                  <div className="shared-inbox-covers">
                    {item.books.map((b, bookIndex) => {
                      const selected = selectedSharedBookIndices.get(itemIndex)?.has(bookIndex) ?? false;
                      return (
                        <button
                          type="button"
                          key={bookIndex}
                          className={`shared-inbox-cover-card ${selected ? "selected" : ""}`}
                          onClick={() => toggleSharedBookSelection(itemIndex, bookIndex)}
                        >
                          <div className="shared-inbox-cover-wrap">
                            {b.coverUrl ? (
                              <img src={b.coverUrl} alt="" />
                            ) : (
                              <div className="shared-inbox-cover-placeholder">{b.title.charAt(0).toUpperCase()}</div>
                            )}
                            {selected && <span className="shared-inbox-cover-check">✓</span>}
                          </div>
                          <span className="shared-inbox-cover-title">{b.title}</span>
                          {b.authors && <span className="shared-inbox-cover-author">{b.authors}</span>}
                          {b.seriesName && <span className="shared-inbox-cover-series">{b.seriesName}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="shared-inbox-modal-actions">
                    <button
                      type="button"
                      className="primary-button shared-inbox-btn"
                      onClick={() => {
                        const result = addSharedItemToTbr(itemIndex);
                        setSharedAddMessage(result);
                        refreshSharedInbox();
                        clearSelectionForItem(itemIndex);
                        setShowShelfPickerForItem(null);
                        const msg = result.added > 0 ? (result.added === 1 ? "1 boek toegevoegd aan TBR." : `${result.added} boeken toegevoegd aan TBR.`) + (result.skipped > 0 ? ` ${result.skipped} stond/stonden al in je lijst.` : "") : (result.skipped > 0 ? `${result.skipped} stond/stonden al in je lijst.` : "");
                        if (msg) setToast(msg);
                        setTimeout(() => { setSharedAddMessage(null); setToast(""); }, 4000);
                      }}
                    >
                      Alles naar TBR
                    </button>
                    {getSelectedCount(itemIndex) > 0 && (
                      <>
                        <button
                          type="button"
                          className="primary-button shared-inbox-btn shared-inbox-btn-secondary"
                          onClick={() => {
                            const indices = Array.from(selectedSharedBookIndices.get(itemIndex) ?? []);
                            const result = addSharedItemBooksToTbr(itemIndex, indices);
                            setSharedAddMessage(result);
                            refreshSharedInbox();
                            clearSelectionForItem(itemIndex);
                            const msg = result.added > 0 ? (result.added === 1 ? "1 boek toegevoegd aan TBR." : `${result.added} boeken toegevoegd aan TBR.`) + (result.skipped > 0 ? ` ${result.skipped} stond/stonden al in je lijst.` : "") : (result.skipped > 0 ? `${result.skipped} stond/stonden al in je lijst.` : "");
                            if (msg) setToast(msg);
                            setTimeout(() => { setSharedAddMessage(null); setToast(""); }, 4000);
                          }}
                        >
                          Geselecteerde ({getSelectedCount(itemIndex)}) naar TBR
                        </button>
                        <div className="shared-inbox-shelf-wrap">
                            <button
                              type="button"
                              className="secondary-button shared-inbox-btn"
                              onClick={() => {
                                setShowShelfPickerForItem(showShelfPickerForItem === itemIndex ? null : itemIndex);
                              }}
                            >
                              Geselecteerde naar boekenkast
                            </button>
                          {showShelfPickerForItem === itemIndex && (
                            <div className="shared-inbox-shelf-picker">
                              {shelves.map((shelf) => (
                                <button
                                  key={shelf.id}
                                  type="button"
                                  className="shared-inbox-shelf-option"
                                  onClick={() => {
                                    const indices = Array.from(selectedSharedBookIndices.get(itemIndex) ?? []);
                                    const snapshots = indices.map((i) => item.books[i]);
                                    const result = shelf.system
                                      ? addBookSnapshotsToMyLibrary(snapshots, { shelfId: shelf.id })
                                      : addBookSnapshotsToMyLibrary(snapshots, { status: "geen-status", shelfId: shelf.id });
                                    setSharedAddMessage(result);
                                    clearSelectionForItem(itemIndex);
                                    setShowShelfPickerForItem(null);
                                    setNewShelfNameInbox("");
                                    const shelfName = shelf.name;
                                    const msg = result.added > 0 ? (result.added === 1 ? `1 boek toegevoegd aan "${shelfName}".` : `${result.added} boeken toegevoegd aan "${shelfName}".`) + (result.skipped > 0 ? ` ${result.skipped} stond/stonden al in je lijst.` : "") : (result.skipped > 0 ? `${result.skipped} stond/stonden al in je lijst.` : "");
                                    if (msg) setToast(msg);
                                    setTimeout(() => { setSharedAddMessage(null); setToast(""); }, 4000);
                                  }}
                                >
                                  {shelf.name}
                                </button>
                              ))}
                              <div className="shared-inbox-new-shelf">
                                <input
                                  type="text"
                                  value={newShelfNameInbox}
                                  onChange={(e) => setNewShelfNameInbox(e.target.value)}
                                  placeholder="Nieuwe boekenkast naam…"
                                  className="shared-inbox-new-shelf-input"
                                />
                                <button
                                  type="button"
                                  className="shared-inbox-shelf-option"
                                  disabled={!newShelfNameInbox.trim()}
                                  onClick={() => {
                                    const name = newShelfNameInbox.trim();
                                    if (!name) return;
                                    const newShelf: Shelf = { id: `shelf-${Date.now()}`, name };
                                    const nextShelves = [...shelves, newShelf];
                                    persist(nextShelves);
                                    const indices = Array.from(selectedSharedBookIndices.get(itemIndex) ?? []);
                                    const snapshots = indices.map((i) => item.books[i]);
                                    const result = addBookSnapshotsToMyLibrary(snapshots, { status: "geen-status", shelfId: newShelf.id });
                                    setSharedAddMessage(result);
                                    clearSelectionForItem(itemIndex);
                                    setShowShelfPickerForItem(null);
                                    setNewShelfNameInbox("");
                                    const msg = result.added > 0 ? (result.added === 1 ? `1 boek toegevoegd aan "${name}".` : `${result.added} boeken toegevoegd aan "${name}".`) + (result.skipped > 0 ? ` ${result.skipped} stond/stonden al in je lijst.` : "") : (result.skipped > 0 ? `${result.skipped} stond/stonden al in je lijst.` : "");
                                    if (msg) setToast(msg);
                                    setTimeout(() => { setSharedAddMessage(null); setToast(""); }, 4000);
                                  }}
                                >
                                  Nieuwe boekenkast aanmaken
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    <button
                      type="button"
                      className="link-button shared-inbox-dismiss"
                      onClick={() => {
                        dismissSharedItem(itemIndex);
                        refreshSharedInbox();
                        clearSelectionForItem(itemIndex);
                        setShowShelfPickerForItem(null);
                      }}
                    >
                      Negeren
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}


import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shelf } from "../types";
import { useBasePath, withBase } from "../routing";
import { useZoom } from "../ZoomContext";
import {
  useInstantData,
  saveShelves,
  saveGenreFetchAllowlist,
  saveReadingPace,
  getPendingReceivedRequests,
  getPendingSentRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  addSharedItemToTbr,
  addSharedItemBooksToTbr,
  addBookSnapshotsToMyLibrary,
  dismissSharedItem,
  migrateLocalStorageToInstant,
} from "../storage";
import { parseGenreAllowlistTextarea } from "../fetchBookGenres";
import { getCurrentUsername, changePassword, deleteAccount } from "../auth";
import { db } from "../db";

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

  const {
    books,
    shelves,
    friends,
    friendRequests,
    sharedInbox,
    genreFetchAllowlist,
    readingPace,
    profileId,
    isLoading: dataLoading,
  } = useInstantData();

  const [pagesPerHour, setPagesPerHour] = useState<string>(
    () => (readingPace != null ? String(readingPace) : "")
  );
  // Sync pagesPerHour wanneer readingPace beschikbaar komt vanuit InstantDB
  useEffect(() => {
    if (readingPace != null && pagesPerHour === "") {
      setPagesPerHour(String(readingPace));
    }
  }, [readingPace]);


  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const pendingReceived = useMemo(
    () => getPendingReceivedRequests(friendRequests, username ?? ""),
    [friendRequests, username]
  );
  const pendingSent = useMemo(
    () => getPendingSentRequests(friendRequests, username ?? ""),
    [friendRequests, username]
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [friendError, setFriendError] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSharedInboxModal, setShowSharedInboxModal] = useState(false);
  const [sharedAddMessage, setSharedAddMessage] = useState<{ added: number; skipped: number } | null>(null);
  const [toast, setToast] = useState("");
  const [genreAllowlistText, setGenreAllowlistText] = useState(() =>
    genreFetchAllowlist.join("\n")
  );
  // Sync genreAllowlistText wanneer data beschikbaar komt
  useEffect(() => {
    setGenreAllowlistText(genreFetchAllowlist.join("\n"));
  }, [genreFetchAllowlist]);

  const [selectedSharedBookIndices, setSelectedSharedBookIndices] = useState<Map<number, Set<number>>>(
    () => new Map()
  );
  const [showShelfPickerForItem, setShowShelfPickerForItem] = useState<number | null>(null);
  const [newShelfNameInbox, setNewShelfNameInbox] = useState("");
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [deleteAccountError, setDeleteAccountError] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);

  // Zoek Boekbuddies via InstantDB (real-time)
  const { data: searchData } = db.useQuery(
    searchQuery.trim()
      ? {
          profiles: {
            $: {
              where: { username: { $like: `%${searchQuery.trim().toLowerCase()}%` } },
            },
          },
        }
      : null
  );
  const searchResults: string[] = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const current = (username ?? "").toLowerCase();
    return ((searchData?.profiles ?? []) as Array<{ username: string }>)
      .map((p) => p.username)
      .filter((u) => u.toLowerCase() !== current);
  }, [searchData, searchQuery, username]);

  // Eenmalige localStorage-migratie na eerste login
  useEffect(() => {
    if (!profileId || dataLoading) return;
    migrateLocalStorageToInstant(profileId);
  }, [profileId, dataLoading]);


  function handleSaveGenreAllowlist() {
    const items = parseGenreAllowlistTextarea(genreAllowlistText);
    saveGenreFetchAllowlist(items);
    setToast("Genrelijst voor suggesties opgeslagen.");
    window.setTimeout(() => setToast(""), 2800);
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

  function saveProfile(e: FormEvent) {
    e.preventDefault();
    const paceTrim = pagesPerHour.trim();
    let nextPaceInField = "";
    let paceWritten = false;
    if (paceTrim !== "") {
      const n = Number(paceTrim);
      if (Number.isFinite(n) && n >= 1) {
        const rounded = Math.round(n);
        saveReadingPace(rounded);
        nextPaceInField = String(rounded);
        paceWritten = true;
      }
    }
    if (nextPaceInField === "") {
      nextPaceInField = readingPace != null ? String(readingPace) : "";
    }
    setPagesPerHour(nextPaceInField);

    const trimmed = name.trim();
    if (!trimmed) {
      if (paceWritten) {
        setToast("Leestempo opgeslagen. Vul een weergavenaam in.");
      } else {
        setToast("Vul een weergavenaam in.");
      }
      window.setTimeout(() => setToast(""), 3200);
      return;
    }
    window.localStorage.setItem(displayNameKey(), trimmed);
    setToast("Profiel opgeslagen.");
    window.setTimeout(() => setToast(""), 2200);
  }

  async function handleSendFriendRequest(targetUsername: string) {
    setFriendError("");
    const result = await sendFriendRequest(targetUsername, friends, friendRequests);
    if (!result.ok) {
      setFriendError(result.error);
    }
  }

  async function handleAcceptRequest(fromUsername: string) {
    await acceptFriendRequest(fromUsername, friendRequests, friends);
  }

  async function handleRejectRequest(fromUsername: string) {
    await rejectFriendRequest(fromUsername, friendRequests);
  }

  async function handleRemoveFriend(targetUsername: string) {
    await removeFriend(targetUsername, friends);
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

      <section className="card profile-genre-allowlist-section" aria-labelledby="genre-allowlist-heading">
        <h2 id="genre-allowlist-heading">Toegestane genres bij ophalen</h2>
        <p className="page-intro-small">
          Optioneel: alleen suggesties van Google Books / Open Library tonen die bij <strong>jouw</strong> termen
          passen (hoofdletter maakt niet uit). Één term per regel of komma&apos;s. Bijvoorbeeld:{" "}
          <em>Fantasy</em>, <em>Science fiction</em>, <em>Young adult</em>.{" "}
          <strong>Leeg laten</strong> = alle suggesties zoals nu.
        </p>
        <label className="form-field">
          <span>Jouw genre-termen</span>
          <textarea
            value={genreAllowlistText}
            onChange={(e) => setGenreAllowlistText(e.target.value)}
            rows={6}
            placeholder={"Fantasy\nThriller\nGraphic novel"}
            className="profile-input profile-genre-allowlist-textarea"
            spellCheck={false}
          />
        </label>
        <button type="button" className="primary-button" onClick={handleSaveGenreAllowlist}>
          Genrelijst opslaan
        </button>
      </section>

      {showAccountModal && (
        <div className="modal-backdrop" onClick={() => setShowAccountModal(false)}>
          <div className="modal profile-account-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Mijn account bewerken</h3>
            <form onSubmit={saveProfile} className="profile-modal-account-fields">
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
              <label className="profile-field profile-field-grow">
                <span className="profile-field-label">Bladzijden per uur (leestempo)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pagesPerHour}
                  onChange={(e) => setPagesPerHour(e.target.value.replace(/\D/g, ""))}
                  placeholder="Bijv. 30"
                  className="profile-input"
                />
                <span className="profile-field-hint">
                  Voor leessessies op de lees-challenge. Klik op Opslaan om te bewaren; het blijft staan
                  tot je het aanpast en opnieuw opslaat.
                </span>
                {readingPace != null && (
                  <button
                    type="button"
                    className="link-button profile-clear-pace-btn"
                    onClick={() => {
                      saveReadingPace(0);
                      setPagesPerHour("");
                      setToast("Leestempo gewist.");
                      window.setTimeout(() => setToast(""), 2200);
                    }}
                  >
                    Leestempo wissen
                  </button>
                )}
              </label>
              <div className="profile-modal-form-actions">
                <button type="submit" className="primary-button">
                  Opslaan
                </button>
              </div>
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
        <p className="profile-search-hint">Typ een naam om te zoeken.</p>
        <div className="profile-search-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setFriendError(""); }}
            placeholder="Zoek op gebruikersnaam…"
            className="profile-search-input"
            autoComplete="username"
          />
        </div>
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
        {friends.length > 0 ? (
          <div className="profile-chips">
            {friends.map((u) => (
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
        )}
      </section>

      <section className="profile-card card profile-collections-card">
        <h2 className="profile-card-title">Verzamelingen</h2>
        <p className="profile-card-desc">
          Maak en beheer verzamelingen direct vanuit je bibliotheek. Je bestaande boekenkasten zijn automatisch omgezet naar verzamelingen.
        </p>
        <Link to={withBase(basePath, "/bibliotheek")} className="primary-button profile-collections-link">
          Beheer verzamelingen
        </Link>
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
                      onClick={async () => {
                        const result = await addSharedItemToTbr(item, books);
                        setSharedAddMessage(result);
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
                          onClick={async () => {
                            const indices = Array.from(selectedSharedBookIndices.get(itemIndex) ?? []);
                            const result = await addSharedItemBooksToTbr(item, indices, books);
                            setSharedAddMessage(result);
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
                                  onClick={async () => {
                                    const indices = Array.from(selectedSharedBookIndices.get(itemIndex) ?? []);
                                    const snapshots = indices.map((i) => item.books[i]);
                                    const result = shelf.system
                                      ? await addBookSnapshotsToMyLibrary(snapshots, { shelfId: shelf.id }, books)
                                      : await addBookSnapshotsToMyLibrary(snapshots, { status: "geen-status", shelfId: shelf.id }, books);
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
                                  onClick={async () => {
                                    const name = newShelfNameInbox.trim();
                                    if (!name) return;
                                    const newShelf: Shelf = { id: `shelf-${Date.now()}`, name };
                                    const nextShelves = [...shelves, newShelf];
                                    saveShelves(nextShelves);
                                    const indices = Array.from(selectedSharedBookIndices.get(itemIndex) ?? []);
                                    const snapshots = indices.map((i) => item.books[i]);
                                    const result = await addBookSnapshotsToMyLibrary(snapshots, { status: "geen-status", shelfId: newShelf.id }, books);
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
                      onClick={async () => {
                        await dismissSharedItem(item._idbId);
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

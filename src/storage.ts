/**
 * storage.ts – datalaag op basis van InstantDB.
 *
 * Publieke API is zo veel mogelijk identiek gehouden aan de oude localStorage-versie,
 * zodat pagina's minimaal hoeven te veranderen.
 *
 * Centrale hook: useInstantData() → levert { books, shelves, challenge, friends,
 * friendRequests, sharedInbox, shelfViewSettings, genreFetchAllowlist, readingPace,
 * profileId, isLoading }
 */

import { useCallback, useEffect, useMemo } from "react";
import { id as instantId } from "@instantdb/react";
import { db } from "./db";
import { getCurrentUsername } from "./auth";
import {
  Book,
  ReadStatus,
  ReadingChallenge,
  Shelf,
  SharedBookSnapshot,
  SharedItem,
} from "./types";

// ─── Constanten voor client-side localStorage-migratie ───────────────────────

const LS_BOOKS_KEY = "bt_books_v1";
const LS_SHELVES_KEY = "bt_shelves_v1";
const LS_CHALLENGE_KEY = "bt_challenge_v1";
const LS_FRIENDS_KEY = "bt_friends_v1";
const LS_SHARED_INBOX_KEY = "bt_shared_inbox_v1";
const LS_FRIEND_REQUESTS_KEY = "bt_friend_requests_v1";
const LS_SHELF_VIEW_SETTINGS_KEY = "bt_shelf_view_settings_v1";
const LS_GENRE_FETCH_ALLOWLIST_KEY = "bt_genre_fetch_allowlist_v1";
const LS_READING_PACE_KEY = "bt_reading_pace_v1";
const LS_MIGRATED_FLAG = "bt_migrated_to_instant";

const DEFAULT_SHELVES: Shelf[] = [
  { id: "wil-ik-lezen", name: "Wil ik lezen", system: true },
  { id: "aan-het-lezen", name: "Aan het lezen", system: true },
  { id: "gelezen", name: "Gelezen", system: true },
];

// ─── Helper: lees uit localStorage ───────────────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── ShelfViewSettings type ───────────────────────────────────────────────────

export interface ShelfViewSettings {
  sortRulesByShelf: Record<string, string[]>;
  groupModeByShelf: Record<string, string>;
  groupSortRules: Record<string, string[]>;
}

const DEFAULT_SHELF_VIEW_SETTINGS: ShelfViewSettings = {
  sortRulesByShelf: {},
  groupModeByShelf: {},
  groupSortRules: {},
};

// ─── FriendRequest type ───────────────────────────────────────────────────────

export interface FriendRequest {
  id?: string;
  from: string;
  to: string;
  status: "pending" | "accepted" | "rejected";
}

// ─── Centrale hook ────────────────────────────────────────────────────────────

/** Alle data voor de ingelogde gebruiker, real-time gesynchroniseerd via InstantDB. */
export function useInstantData() {
  const username = getCurrentUsername();

  // Query: profiel van de ingelogde gebruiker (op username)
  const { data: profileData, isLoading: profileLoading } = db.useQuery(
    username
      ? {
          profiles: {
            $: { where: { username } },
          },
        }
      : null
  );

  // Query: alle vriendschapsverzoeken waarbij de gebruiker betrokken is
  const { data: frData, isLoading: frLoading } = db.useQuery(
    username
      ? {
          friendRequests: {
            $: {
              where: {
                or: [{ fromUsername: username }, { toUsername: username }],
              },
            },
          },
        }
      : null
  );

  // Query: inbox items gericht aan de gebruiker
  const { data: inboxData, isLoading: inboxLoading } = db.useQuery(
    username
      ? {
          sharedInboxItems: {
            $: { where: { toUsername: username } },
          },
        }
      : null
  );

  const rawProfile = profileData?.profiles?.[0] as
    | {
        id: string;
        username: string;
        books?: unknown;
        shelves?: unknown;
        challenge?: unknown;
        friends?: unknown;
        shelfViewSettings?: unknown;
        genreFetchAllowlist?: unknown;
        readingPace?: number;
      }
    | undefined;

  const profileId = rawProfile?.id ?? null;

  const books = useMemo(
    () => (Array.isArray(rawProfile?.books) ? (rawProfile!.books as Book[]) : []),
    [rawProfile?.books]
  );
  const shelves = useMemo(
    () =>
      Array.isArray(rawProfile?.shelves) && (rawProfile!.shelves as Shelf[]).length > 0
        ? (rawProfile!.shelves as Shelf[])
        : DEFAULT_SHELVES,
    [rawProfile?.shelves]
  );
  const challenge = useMemo(
    () => (rawProfile?.challenge != null ? (rawProfile!.challenge as ReadingChallenge) : null),
    [rawProfile?.challenge]
  );
  const friends = useMemo(
    () => (Array.isArray(rawProfile?.friends) ? (rawProfile!.friends as string[]) : []),
    [rawProfile?.friends]
  );
  const shelfViewSettings = useMemo(
    () =>
      rawProfile?.shelfViewSettings != null
        ? (rawProfile!.shelfViewSettings as ShelfViewSettings)
        : DEFAULT_SHELF_VIEW_SETTINGS,
    [rawProfile?.shelfViewSettings]
  );
  const genreFetchAllowlist = useMemo(
    () =>
      Array.isArray(rawProfile?.genreFetchAllowlist)
        ? (rawProfile!.genreFetchAllowlist as string[])
        : [],
    [rawProfile?.genreFetchAllowlist]
  );
  const readingPace = rawProfile?.readingPace ?? null;

  const rawFriendRequests = useMemo(
    () =>
      (frData?.friendRequests ?? []) as Array<{
        id: string;
        fromUsername: string;
        toUsername: string;
        status: string;
      }>,
    [frData?.friendRequests]
  );

  const friendRequests = useMemo(
    () =>
      rawFriendRequests.map(
        (r): FriendRequest => ({
          id: r.id,
          from: r.fromUsername,
          to: r.toUsername,
          status: r.status as "pending" | "accepted" | "rejected",
        })
      ),
    [rawFriendRequests]
  );

  const rawInboxItems = useMemo(
    () =>
      (inboxData?.sharedInboxItems ?? []) as Array<{
        id: string;
        fromUsername: string;
        books: unknown;
        shelfName?: string;
        sharedAt: string;
      }>,
    [inboxData?.sharedInboxItems]
  );

  const sharedInbox = useMemo(
    () =>
      rawInboxItems.map(
        (item): SharedItem & { _idbId: string } => ({
          _idbId: item.id,
          from: item.fromUsername,
          books: Array.isArray(item.books) ? (item.books as SharedBookSnapshot[]) : [],
          shelfName: item.shelfName,
          sharedAt: item.sharedAt,
        })
      ),
    [rawInboxItems]
  );

  const isLoading = profileLoading || frLoading || inboxLoading;

  return {
    profileId,
    books,
    shelves,
    challenge,
    friends,
    friendRequests,
    sharedInbox,
    shelfViewSettings,
    genreFetchAllowlist,
    readingPace,
    isLoading,
  };
}

// ─── Write-functies (db.transact) ─────────────────────────────────────────────

async function getProfileId(): Promise<string | null> {
  const username = getCurrentUsername();
  if (!username) return null;
  const result = await db.queryOnce({ profiles: { $: { where: { username } } } });
  return (result.data?.profiles?.[0] as { id?: string } | undefined)?.id ?? null;
}

export async function saveBooks(books: Book[]): Promise<void> {
  const pid = await getProfileId();
  if (!pid) return;
  await db.transact([db.tx.profiles[pid].update({ books })]);
  window.dispatchEvent(new Event("bt_books_updated_v1"));
}

export async function saveShelves(shelves: Shelf[]): Promise<void> {
  const pid = await getProfileId();
  if (!pid) return;
  await db.transact([db.tx.profiles[pid].update({ shelves })]);
}

export async function saveChallenge(challenge: ReadingChallenge | null): Promise<void> {
  const pid = await getProfileId();
  if (!pid) return;
  await db.transact([db.tx.profiles[pid].update({ challenge: challenge ?? null })]);
}

export async function saveShelfViewSettings(settings: ShelfViewSettings): Promise<void> {
  const pid = await getProfileId();
  if (!pid) return;
  await db.transact([db.tx.profiles[pid].update({ shelfViewSettings: settings })]);
}

export async function saveGenreFetchAllowlist(items: string[]): Promise<void> {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const s of items) {
    const t = s.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(t);
  }
  const pid = await getProfileId();
  if (!pid) return;
  await db.transact([db.tx.profiles[pid].update({ genreFetchAllowlist: cleaned })]);
}

export async function saveReadingPace(pagesPerHour: number): Promise<void> {
  const rounded =
    Number.isFinite(pagesPerHour) && pagesPerHour > 0 ? Math.round(pagesPerHour) : null;
  const pid = await getProfileId();
  if (!pid) return;
  if (rounded != null) {
    await db.transact([db.tx.profiles[pid].update({ readingPace: rounded })]);
  } else {
    await db.transact([db.tx.profiles[pid].update({ readingPace: undefined })]);
  }
}

async function saveFriends(username: string, usernames: string[]): Promise<void> {
  const result = await db.queryOnce({ profiles: { $: { where: { username } } } });
  const pid = (result.data?.profiles?.[0] as { id?: string } | undefined)?.id;
  if (!pid) return;
  await db.transact([db.tx.profiles[pid].update({ friends: usernames })]);
}

// ─── Vriendschapsverzoeken ────────────────────────────────────────────────────

export function getPendingReceivedRequests(
  friendRequests: FriendRequest[],
  me: string
): string[] {
  return friendRequests
    .filter((r) => r.to.toLowerCase() === me.toLowerCase() && r.status === "pending")
    .map((r) => r.from);
}

export function getPendingSentRequests(
  friendRequests: FriendRequest[],
  me: string
): string[] {
  return friendRequests
    .filter((r) => r.from.toLowerCase() === me.toLowerCase() && r.status === "pending")
    .map((r) => r.to);
}

export async function sendFriendRequest(
  toUsername: string,
  friends: string[],
  friendRequests: FriendRequest[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = getCurrentUsername();
  if (!me) return { ok: false, error: "Niet ingelogd." };
  const to = toUsername.trim();
  if (!to) return { ok: false, error: "Vul een gebruikersnaam in." };
  if (to.toLowerCase() === me.toLowerCase())
    return { ok: false, error: "Je kunt jezelf geen verzoek sturen." };
  if (friends.some((u) => u.toLowerCase() === to.toLowerCase()))
    return { ok: false, error: "Je bent al Boekbuddies." };
  const exists = friendRequests.some(
    (r) =>
      r.status === "pending" &&
      ((r.from.toLowerCase() === me.toLowerCase() && r.to.toLowerCase() === to.toLowerCase()) ||
        (r.from.toLowerCase() === to.toLowerCase() && r.to.toLowerCase() === me.toLowerCase()))
  );
  if (exists) return { ok: false, error: "Er staat al een verzoek open." };

  // Controleer of de ontvanger bestaat
  const check = await db.queryOnce({ profiles: { $: { where: { username: to } } } });
  const exists2 = (check.data?.profiles ?? []).length > 0;
  if (!exists2) return { ok: false, error: "Gebruiker niet gevonden." };

  const frId = instantId();
  await db.transact([
    db.tx.friendRequests[frId].update({
      fromUsername: me,
      toUsername: to,
      status: "pending",
    }),
  ]);
  return { ok: true };
}

export async function acceptFriendRequest(
  fromUsername: string,
  friendRequests: FriendRequest[],
  myFriends: string[]
): Promise<void> {
  const me = getCurrentUsername();
  if (!me) return;
  const from = fromUsername.trim().toLowerCase();
  const req = friendRequests.find(
    (r) => r.from.toLowerCase() === from && r.to.toLowerCase() === me.toLowerCase() && r.status === "pending"
  );
  if (!req?.id) return;

  const otherUsername = req.from;

  // Update status
  await db.transact([
    db.tx.friendRequests[req.id].update({ status: "accepted" }),
  ]);

  // Voeg toe aan eigen vriendenlijst
  if (!myFriends.some((u) => u.toLowerCase() === otherUsername.toLowerCase())) {
    await saveFriends(me, [...myFriends, otherUsername]);
  }

  // Voeg toe aan hun vriendenlijst
  const theirResult = await db.queryOnce({
    profiles: { $: { where: { username: otherUsername } } },
  });
  const theirProfile = theirResult.data?.profiles?.[0] as
    | { id: string; friends?: unknown }
    | undefined;
  if (theirProfile) {
    const theirFriends = Array.isArray(theirProfile.friends)
      ? (theirProfile.friends as string[])
      : [];
    if (!theirFriends.some((u) => u.toLowerCase() === me.toLowerCase())) {
      await db.transact([
        db.tx.profiles[theirProfile.id].update({ friends: [...theirFriends, me] }),
      ]);
    }
  }
}

export async function rejectFriendRequest(
  fromUsername: string,
  friendRequests: FriendRequest[]
): Promise<void> {
  const me = getCurrentUsername();
  if (!me) return;
  const from = fromUsername.trim().toLowerCase();
  const req = friendRequests.find(
    (r) => r.from.toLowerCase() === from && r.to.toLowerCase() === me.toLowerCase() && r.status === "pending"
  );
  if (!req?.id) return;
  await db.transact([db.tx.friendRequests[req.id].delete()]);
}

export async function removeFriend(
  username: string,
  myFriends: string[]
): Promise<void> {
  const me = getCurrentUsername();
  if (!me) return;
  const updated = myFriends.filter((u) => u.toLowerCase() !== username.toLowerCase());
  await saveFriends(me, updated);

  // Verwijder ook uit hun vriendenlijst
  const theirResult = await db.queryOnce({
    profiles: { $: { where: { username } },
    },
  });
  const theirProfile = theirResult.data?.profiles?.[0] as
    | { id: string; friends?: unknown }
    | undefined;
  if (theirProfile) {
    const theirFriends = Array.isArray(theirProfile.friends)
      ? (theirProfile.friends as string[])
      : [];
    const theirUpdated = theirFriends.filter((u) => u.toLowerCase() !== me.toLowerCase());
    await db.transact([
      db.tx.profiles[theirProfile.id].update({ friends: theirUpdated }),
    ]);
  }
}

// ─── Gedeelde inbox ───────────────────────────────────────────────────────────

export async function shareWithFriend(
  toUsername: string,
  bookSnapshots: SharedBookSnapshot[],
  shelfName: string | undefined,
  myFriends: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = getCurrentUsername();
  if (!me) return { ok: false, error: "Niet ingelogd." };
  const to = toUsername.trim();
  if (!to) return { ok: false, error: "Kies een Boekbuddy." };
  if (!myFriends.some((u) => u.toLowerCase() === to.toLowerCase()))
    return { ok: false, error: "Alleen met Boekbuddies kun je delen." };
  if (!bookSnapshots.length) return { ok: false, error: "Geen boeken om te delen." };

  const itemId = instantId();
  await db.transact([
    db.tx.sharedInboxItems[itemId].update({
      toUsername: to,
      fromUsername: me,
      books: bookSnapshots.map((b) => ({
        title: b.title,
        authors: b.authors,
        coverUrl: b.coverUrl,
        seriesName: b.seriesName,
      })),
      shelfName: shelfName ?? null,
      sharedAt: new Date().toISOString(),
    }),
  ]);
  return { ok: true };
}

export async function dismissSharedItem(idbId: string): Promise<void> {
  await db.transact([db.tx.sharedInboxItems[idbId].delete()]);
}

export async function addSharedItemToTbr(
  item: SharedItem & { _idbId: string },
  currentBooks: Book[]
): Promise<{ added: number; skipped: number }> {
  const norm = (t: string) => (t ?? "").trim().toLowerCase();
  const toAdd = item.books.filter(
    (b) => !currentBooks.some((cb) => norm(cb.title) === norm(b.title) && norm(cb.authors) === norm(b.authors))
  );
  const skipped = item.books.length - toAdd.length;
  let idx = 0;
  const newBooks: Book[] = toAdd.map((b) => ({
    id: `book-${Date.now()}-${idx++}-${Math.random().toString(36).slice(2, 9)}`,
    title: b.title,
    authors: b.authors,
    coverUrl: b.coverUrl,
    status: "wil-ik-lezen" as ReadStatus,
  }));
  if (newBooks.length > 0) {
    await saveBooks([...currentBooks, ...newBooks]);
  }
  await dismissSharedItem(item._idbId);
  return { added: newBooks.length, skipped };
}

export async function addBookSnapshotsToMyLibrary(
  snapshots: SharedBookSnapshot[],
  options: { status?: ReadStatus; shelfId?: string },
  currentBooks: Book[]
): Promise<{ added: number; skipped: number }> {
  const me = getCurrentUsername();
  if (!me || !snapshots.length) return { added: 0, skipped: 0 };

  const norm = (t: string) => (t ?? "").trim().toLowerCase();
  const systemStatus: Record<string, ReadStatus> = {
    "wil-ik-lezen": "wil-ik-lezen",
    "aan-het-lezen": "aan-het-lezen",
    gelezen: "gelezen",
  };
  const status: ReadStatus =
    options.status ??
    (options.shelfId ? (systemStatus[options.shelfId] ?? "wil-ik-lezen") : "wil-ik-lezen");
  const customShelfId = options.shelfId && !systemStatus[options.shelfId] ? options.shelfId : null;

  const nextBooks = [...currentBooks];
  let createdCount = 0;
  let updatedExistingCount = 0;
  let skipped = 0;

  snapshots.forEach((snapshot, idx) => {
    const existingIndex = nextBooks.findIndex(
      (b) => norm(b.title) === norm(snapshot.title) && norm(b.authors) === norm(snapshot.authors)
    );

    if (existingIndex >= 0) {
      const existing = nextBooks[existingIndex];
      let changed = false;
      let updated: Book = existing;

      if (customShelfId) {
        const existingShelfIds = existing.shelfIds ?? [];
        if (!existingShelfIds.includes(customShelfId)) {
          updated = { ...updated, shelfIds: [...existingShelfIds, customShelfId] };
          changed = true;
        }
      } else if (existing.status !== status) {
        updated = { ...updated, status };
        changed = true;
      }

      if (changed) {
        nextBooks[existingIndex] = updated;
        updatedExistingCount += 1;
      } else {
        skipped += 1;
      }
      return;
    }

    const shelfIds = customShelfId ? [customShelfId] : undefined;
    nextBooks.push({
      id: `book-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
      title: snapshot.title,
      authors: snapshot.authors,
      coverUrl: snapshot.coverUrl,
      status,
      order: undefined,
      shelfIds,
    });
    createdCount += 1;
  });

  if (createdCount > 0 || updatedExistingCount > 0) {
    await saveBooks(nextBooks);
  }
  return { added: createdCount + updatedExistingCount, skipped };
}

// ─── Boeken van andere gebruikers (Boekbuddy) ─────────────────────────────────

export async function loadBooksForUserAsync(username: string): Promise<Book[]> {
  const result = await db.queryOnce({ profiles: { $: { where: { username } } } });
  const profile = result.data?.profiles?.[0] as { books?: unknown } | undefined;
  return Array.isArray(profile?.books) ? (profile!.books as Book[]) : [];
}

export async function loadShelvesForUserAsync(username: string): Promise<Shelf[]> {
  const result = await db.queryOnce({ profiles: { $: { where: { username } } } });
  const profile = result.data?.profiles?.[0] as { shelves?: unknown } | undefined;
  const shelves = profile?.shelves;
  return Array.isArray(shelves) && (shelves as Shelf[]).length > 0
    ? (shelves as Shelf[])
    : DEFAULT_SHELVES;
}

// ─── Client-side localStorage-migratie (stil, eenmalig bij eerste login) ──────

/**
 * Wordt aangeroepen na succesvolle login. Controleert of het InstantDB-profiel
 * leeg is maar er localStorage-data bestaat. Als dat zo is, worden alle gegevens
 * stil naar InstantDB gepusht. De gebruiker merkt hier niets van.
 */
export async function migrateLocalStorageToInstant(profileId: string): Promise<void> {
  const username = getCurrentUsername();
  if (!username) return;

  // Voorkom dubbele migratie
  const alreadyMigrated = window.localStorage.getItem(LS_MIGRATED_FLAG) === "true";
  if (alreadyMigrated) return;

  const lsBooks = lsGet<Book[]>(`${LS_BOOKS_KEY}_${username}`, []);
  const lsShelves = lsGet<Shelf[]>(`${LS_SHELVES_KEY}_${username}`, []);
  const lsChallenge = lsGet<ReadingChallenge | null>(`${LS_CHALLENGE_KEY}_${username}`, null);
  const lsFriends = lsGet<string[]>(`${LS_FRIENDS_KEY}_${username}`, []);
  const lsShelfViewSettings = lsGet<ShelfViewSettings>(
    `${LS_SHELF_VIEW_SETTINGS_KEY}_${username}`,
    DEFAULT_SHELF_VIEW_SETTINGS
  );
  const lsGenreAllowlist = lsGet<string[]>(`${LS_GENRE_FETCH_ALLOWLIST_KEY}_${username}`, []);

  // Leestempo: meerdere keys proberen
  const lsReadingPaceRaw =
    window.localStorage.getItem(`${LS_READING_PACE_KEY}_${username}`) ??
    window.localStorage.getItem(LS_READING_PACE_KEY);
  const lsReadingPace =
    lsReadingPaceRaw != null && Number.isFinite(Number(lsReadingPaceRaw)) && Number(lsReadingPaceRaw) > 0
      ? Math.round(Number(lsReadingPaceRaw))
      : null;

  // Controleer of er lokale data is
  const hasLocalData = lsBooks.length > 0 || lsShelves.length > 0 || lsFriends.length > 0;
  if (!hasLocalData) {
    window.localStorage.setItem(LS_MIGRATED_FLAG, "true");
    return;
  }

  // Bouw update-object
  const updateData: Record<string, unknown> = {
    books: lsBooks,
    shelves: lsShelves.length > 0 ? lsShelves : DEFAULT_SHELVES,
    friends: lsFriends,
    shelfViewSettings: lsShelfViewSettings,
    genreFetchAllowlist: lsGenreAllowlist,
  };
  if (lsChallenge != null) updateData.challenge = lsChallenge;
  if (lsReadingPace != null) updateData.readingPace = lsReadingPace;

  await db.transact([db.tx.profiles[profileId].update(updateData)]);

  // Vriendschapsverzoeken migreren
  const lsFriendRequests = lsGet<
    { from: string; to: string; status: string }[]
  >(LS_FRIEND_REQUESTS_KEY, []);
  for (const fr of lsFriendRequests) {
    const frId = instantId();
    await db.transact([
      db.tx.friendRequests[frId].update({
        fromUsername: fr.from,
        toUsername: fr.to,
        status: fr.status,
      }),
    ]);
  }

  // Gedeelde inbox migreren
  const lsSharedInbox = lsGet<SharedItem[]>(`${LS_SHARED_INBOX_KEY}_${username}`, []);
  for (const item of lsSharedInbox) {
    const itemId = instantId();
    await db.transact([
      db.tx.sharedInboxItems[itemId].update({
        toUsername: username,
        fromUsername: item.from,
        books: item.books,
        shelfName: item.shelfName ?? null,
        sharedAt: item.sharedAt,
      }),
    ]);
  }

  window.localStorage.setItem(LS_MIGRATED_FLAG, "true");
  window.dispatchEvent(new Event("bt_books_updated_v1"));
}

// ─── Backward-compatible synchrone lees-functies (lezen uit InstantDB via hook) ──
// Deze functies zijn niet meer primair — gebruik useInstantData() in componenten.
// Ze zijn beschikbaar als noodoplossing waar hooks niet werken.

export function loadReadingPace(): number | null {
  // Kan niet synchroon uit InstantDB lezen — gebruik useInstantData().readingPace
  return null;
}

// Lege stubs voor backward compatibility (worden niet meer gebruikt na update pages)
export function loadBooks(): Book[] { return []; }
export function loadShelves(): Shelf[] { return DEFAULT_SHELVES; }
export function loadChallenge(): ReadingChallenge | null { return null; }
export function loadFriends(): string[] { return []; }
export function loadFriendRequests(): FriendRequest[] { return []; }
export function loadSharedInbox(): SharedItem[] { return []; }
export function loadBooksForUser(_username: string): Book[] { return []; }
export function loadShelvesForUser(_username: string): Shelf[] { return DEFAULT_SHELVES; }

// subscribeBooks wordt niet meer gebruikt (InstantDB is inherent reactief)
export function subscribeBooks(_onBooks: (books: Book[]) => void): () => void {
  return () => {};
}

// Sync-functies die niet meer nodig zijn
export async function syncFromSupabase(): Promise<void> {}
export async function pushLocalToSupabase(): Promise<void> {}

// addSharedItemBooksToTbr (gedeeltelijk toevoegen uit inbox-item)
export async function addSharedItemBooksToTbr(
  item: SharedItem & { _idbId: string },
  bookIndices: number[],
  currentBooks: Book[]
): Promise<{ added: number; skipped: number }> {
  const toAdd = bookIndices
    .filter((i) => i >= 0 && i < item.books.length)
    .map((i) => item.books[i]);
  if (toAdd.length === 0) return { added: 0, skipped: 0 };
  const result = await addBookSnapshotsToMyLibrary(toAdd, { status: "wil-ik-lezen" }, currentBooks);

  // Verwijder item volledig uit inbox (alle geselecteerde boeken zijn behandeld)
  const remainingBooks = item.books.filter((_, i) => !bookIndices.includes(i));
  if (remainingBooks.length === 0) {
    await dismissSharedItem(item._idbId);
  } else {
    // Verwijder geselecteerde boeken uit het item, behoud de rest
    await db.transact([
      db.tx.sharedInboxItems[item._idbId].update({ books: remainingBooks }),
    ]);
  }
  return result;
}

// useLoadGenreFetchAllowlist hook-wrapper voor componenten die de allowlist apart laden
export function useInstantProfile() {
  const username = getCurrentUsername();
  const { data } = db.useQuery(
    username ? { profiles: { $: { where: { username } } } } : null
  );
  return (data?.profiles?.[0] ?? null) as {
    id: string;
    username: string;
    books?: unknown;
    shelves?: unknown;
    challenge?: unknown;
    friends?: unknown;
    shelfViewSettings?: unknown;
    genreFetchAllowlist?: unknown;
    readingPace?: number;
  } | null;
}

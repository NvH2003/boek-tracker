import { getCurrentUsername, getCurrentUserId, getUserIdByUsername } from "./auth";
import { supabase, isSupabaseConfigured } from "./supabase";
import { Book, ReadStatus, ReadingChallenge, Shelf, SharedBookSnapshot, SharedItem } from "./types";

const BOOKS_KEY = "bt_books_v1";
const SHELVES_KEY = "bt_shelves_v1";
const CHALLENGE_KEY = "bt_challenge_v1";
const FRIEND_REQUESTS_KEY = "bt_friend_requests_v1";
const FRIENDS_KEY = "bt_friends_v1";
const SHARED_INBOX_KEY = "bt_shared_inbox_v1";

function booksKey(): string {
  const u = getCurrentUsername();
  return u ? `${BOOKS_KEY}_${u}` : BOOKS_KEY;
}
function booksKeyForUser(username: string): string {
  return `${BOOKS_KEY}_${username}`;
}
function shelvesKey(): string {
  const u = getCurrentUsername();
  return u ? `${SHELVES_KEY}_${u}` : SHELVES_KEY;
}
function shelvesKeyForUser(username: string): string {
  return `${SHELVES_KEY}_${username}`;
}
function challengeKey(): string {
  const u = getCurrentUsername();
  return u ? `${CHALLENGE_KEY}_${u}` : CHALLENGE_KEY;
}
function friendsKey(username: string): string {
  return `${FRIENDS_KEY}_${username}`;
}
function sharedInboxKey(username: string): string {
  return `${SHARED_INBOX_KEY}_${username}`;
}

/** Sync alle data van Supabase naar localStorage (na login / session restore). */
export async function syncFromSupabase(): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;
  const userId = getCurrentUserId();
  const username = getCurrentUsername();
  if (!userId || !username) return;

  const keys = ["books", "shelves", "challenge", "friends"] as const;
  const { data: rows } = await supabase.from("user_data").select("key, value").eq("user_id", userId);
  if (rows) {
    const byKey: Record<string, unknown> = {};
    for (const r of rows) byKey[r.key] = r.value;
    if (byKey.books != null) window.localStorage.setItem(booksKey(), JSON.stringify(byKey.books));
    if (byKey.shelves != null) window.localStorage.setItem(shelvesKey(), JSON.stringify(byKey.shelves));
    if (byKey.challenge != null) window.localStorage.setItem(challengeKey(), JSON.stringify(byKey.challenge));
    if (byKey.friends != null) window.localStorage.setItem(friendsKey(username), JSON.stringify(byKey.friends));
  }

  const { data: reqRows } = await supabase.from("friend_requests").select("from_username, to_username, status");
  if (reqRows?.length) {
    const requests: FriendRequest[] = reqRows.map((r: { from_username: string; to_username: string; status: string }) => ({
      from: r.from_username,
      to: r.to_username,
      status: r.status as "pending" | "accepted" | "rejected"
    }));
    window.localStorage.setItem(FRIEND_REQUESTS_KEY, JSON.stringify(requests));
  }

  const { data: inboxRow } = await supabase.from("shared_inbox").select("items").eq("user_id", userId).maybeSingle();
  if (inboxRow?.items != null) {
    window.localStorage.setItem(sharedInboxKey(username), JSON.stringify(inboxRow.items));
    // Signaleer aan de UI dat de gedeelde inbox is bijgewerkt (voor bv. rood bolletje in de profiel-tab)
    window.dispatchEvent(new Event("bt_shared_inbox_updated"));
  }
}

/** Upload huidige localStorage naar Supabase (na login). Zo komen bestaande boeken op pc ook in de cloud voor je telefoon. */
export async function pushLocalToSupabase(): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;
  const userId = getCurrentUserId();
  const username = getCurrentUsername();
  if (!userId || !username) return;

  const books = loadBooks();
  const shelves = loadShelves();
  const challenge = loadChallenge();
  const friends = loadFriends();
  const inbox = loadSharedInbox();

  await Promise.all([
    supabase.from("user_data").upsert({ user_id: userId, key: "books", value: books }, { onConflict: "user_id,key" }),
    supabase.from("user_data").upsert({ user_id: userId, key: "shelves", value: shelves }, { onConflict: "user_id,key" }),
    challenge
      ? supabase.from("user_data").upsert({ user_id: userId, key: "challenge", value: challenge }, { onConflict: "user_id,key" })
      : Promise.resolve(),
    supabase.from("user_data").upsert({ user_id: userId, key: "friends", value: friends }, { onConflict: "user_id,key" }),
    supabase.from("shared_inbox").upsert({ user_id: userId, items: inbox }, { onConflict: "user_id" })
  ]);
}

async function refreshFriendRequestsFromSupabase(): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) return;
  const { data: rows } = await supabase.from("friend_requests").select("from_username, to_username, status");
  if (!rows?.length) {
    window.localStorage.setItem(FRIEND_REQUESTS_KEY, "[]");
    return;
  }
  const requests: FriendRequest[] = rows.map((r: { from_username: string; to_username: string; status: string }) => ({
    from: r.from_username,
    to: r.to_username,
    status: r.status as "pending" | "accepted" | "rejected"
  }));
  window.localStorage.setItem(FRIEND_REQUESTS_KEY, JSON.stringify(requests));
}

export interface FriendRequest {
  from: string;
  to: string;
  status: "pending" | "accepted" | "rejected";
}

const BOOKS_UPDATED_EVENT = "bt_books_updated_v1";
const BOOKS_CHANNEL = "bt_books_channel_v1";

let booksChannel: BroadcastChannel | null = null;

function getBooksChannel(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    if (!booksChannel) {
      booksChannel = new BroadcastChannel(BOOKS_CHANNEL);
    }
    return booksChannel;
  } catch {
    return null;
  }
}

function notifyBooksUpdated() {
  // Same-tab listeners
  window.dispatchEvent(new Event(BOOKS_UPDATED_EVENT));
  // Cross-tab listeners
  const bc = getBooksChannel();
  bc?.postMessage({ type: "books_updated" });
}

export function loadBooks(): Book[] {
  const raw = window.localStorage.getItem(booksKey());
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Book[];
  } catch {
    return [];
  }
}

export function saveBooks(books: Book[]) {
  window.localStorage.setItem(booksKey(), JSON.stringify(books));
  notifyBooksUpdated();
  const userId = getCurrentUserId();
  if (isSupabaseConfigured() && supabase && userId) {
    supabase.from("user_data").upsert({ user_id: userId, key: "books", value: books }, { onConflict: "user_id,key" }).then(() => {});
  }
}

export function subscribeBooks(onBooks: (books: Book[]) => void): () => void {
  function emit() {
    onBooks(loadBooks());
  }

  function onStorage(e: StorageEvent) {
    if (e.key === booksKey()) {
      emit();
    }
  }

  function onLocalEvent() {
    emit();
  }

  const bc = getBooksChannel();
  const onMessage =
    bc
      ? (event: MessageEvent) => {
          if (event.data?.type === "books_updated") {
            emit();
          }
        }
      : null;

  window.addEventListener("storage", onStorage);
  window.addEventListener(BOOKS_UPDATED_EVENT, onLocalEvent);
  if (bc && onMessage) {
    bc.addEventListener("message", onMessage);
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BOOKS_UPDATED_EVENT, onLocalEvent);
    if (bc && onMessage) {
      bc.removeEventListener("message", onMessage);
    }
  };
}

export function loadShelves(): Shelf[] {
  const raw = window.localStorage.getItem(shelvesKey());
  if (!raw) {
    const defaults: Shelf[] = [
      { id: "wil-ik-lezen", name: "Wil ik lezen", system: true },
      { id: "aan-het-lezen", name: "Aan het lezen", system: true },
      { id: "gelezen", name: "Gelezen", system: true }
    ];
    return defaults;
  }
  try {
    return JSON.parse(raw) as Shelf[];
  } catch {
    return [];
  }
}

export function saveShelves(shelves: Shelf[]) {
  window.localStorage.setItem(shelvesKey(), JSON.stringify(shelves));
  const userId = getCurrentUserId();
  if (isSupabaseConfigured() && supabase && userId) {
    supabase.from("user_data").upsert({ user_id: userId, key: "shelves", value: shelves }, { onConflict: "user_id,key" }).then(() => {});
  }
}

export function loadChallenge(): ReadingChallenge | null {
  const raw = window.localStorage.getItem(challengeKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReadingChallenge;
  } catch {
    return null;
  }
}

export function saveChallenge(challenge: ReadingChallenge | null) {
  if (!challenge) {
    window.localStorage.removeItem(challengeKey());
  } else {
    window.localStorage.setItem(challengeKey(), JSON.stringify(challenge));
  }
  const userId = getCurrentUserId();
  if (isSupabaseConfigured() && supabase && userId) {
    if (challenge) {
      supabase.from("user_data").upsert({ user_id: userId, key: "challenge", value: challenge }, { onConflict: "user_id,key" }).then(() => {});
    } else {
      supabase.from("user_data").delete().eq("user_id", userId).eq("key", "challenge").then(() => {});
    }
  }
}

/** Vriendschapsverzoeken (globaal: van/naar alle gebruikers). */
export function loadFriendRequests(): FriendRequest[] {
  const raw = window.localStorage.getItem(FRIEND_REQUESTS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is FriendRequest =>
        x != null &&
        typeof (x as FriendRequest).from === "string" &&
        typeof (x as FriendRequest).to === "string" &&
        ((x as FriendRequest).status === "pending" || (x as FriendRequest).status === "accepted" || (x as FriendRequest).status === "rejected")
    );
  } catch {
    return [];
  }
}

function saveFriendRequests(requests: FriendRequest[]) {
  window.localStorage.setItem(FRIEND_REQUESTS_KEY, JSON.stringify(requests));
}

/** Vrienden van de huidige gebruiker (wederzijds geaccepteerd). */
export function loadFriends(): string[] {
  const current = getCurrentUsername();
  if (!current) return [];
  const raw = window.localStorage.getItem(friendsKey(current));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveFriends(username: string, usernames: string[]) {
  window.localStorage.setItem(friendsKey(username), JSON.stringify(usernames));
  const client = supabase;
  if (isSupabaseConfigured() && client) {
    getUserIdByUsername(username).then((uid) => {
      if (uid && client) client.from("user_data").upsert({ user_id: uid, key: "friends", value: usernames }, { onConflict: "user_id,key" }).then(() => {});
    });
  }
}

/** Inkomende verzoeken (anderen die mij hebben gevraagd). */
export function getPendingReceivedRequests(): string[] {
  const me = getCurrentUsername();
  if (!me) return [];
  return loadFriendRequests()
    .filter((r) => r.to.toLowerCase() === me.toLowerCase() && r.status === "pending")
    .map((r) => r.from);
}

/** Uitgaande verzoeken (ik heb hen gevraagd). */
export function getPendingSentRequests(): string[] {
  const me = getCurrentUsername();
  if (!me) return [];
  return loadFriendRequests()
    .filter((r) => r.from.toLowerCase() === me.toLowerCase() && r.status === "pending")
    .map((r) => r.to);
}

export function sendFriendRequest(toUsername: string): { ok: true } | { ok: false; error: string } {
  const me = getCurrentUsername();
  if (!me) return { ok: false, error: "Niet ingelogd." };
  const to = toUsername.trim();
  if (!to) return { ok: false, error: "Vul een gebruikersnaam in." };
  if (to.toLowerCase() === me.toLowerCase()) return { ok: false, error: "Je kunt jezelf geen verzoek sturen." };
  const friends = loadFriends();
  if (friends.some((u) => u.toLowerCase() === to.toLowerCase())) return { ok: false, error: "Je bent al Boekbuddies." };
  const requests = loadFriendRequests();
  const exists = requests.some(
    (r) =>
      r.status === "pending" &&
      ((r.from.toLowerCase() === me.toLowerCase() && r.to.toLowerCase() === to.toLowerCase()) ||
        (r.from.toLowerCase() === to.toLowerCase() && r.to.toLowerCase() === me.toLowerCase()))
  );
  if (exists) return { ok: false, error: "Er staat al een verzoek open." };
  saveFriendRequests([...requests, { from: me, to, status: "pending" }]);
  if (isSupabaseConfigured() && supabase) {
    supabase.from("friend_requests").insert({ from_username: me, to_username: to, status: "pending" }).then(() => refreshFriendRequestsFromSupabase());
  }
  return { ok: true };
}

export function acceptFriendRequest(fromUsername: string): void {
  const me = getCurrentUsername();
  if (!me) return;
  const from = fromUsername.trim().toLowerCase();
  const requests = loadFriendRequests();
  const idx = requests.findIndex(
    (r) => r.from.toLowerCase() === from && r.to.toLowerCase() === me.toLowerCase() && r.status === "pending"
  );
  if (idx === -1) return;
  const updated = requests.slice();
  updated[idx] = { ...updated[idx], status: "accepted" };
  saveFriendRequests(updated);
  const otherUsername = requests[idx].from;
  const myFriends = loadFriends();
  if (!myFriends.some((u) => u.toLowerCase() === otherUsername.toLowerCase())) {
    saveFriends(me, [...myFriends, otherUsername]);
  }
  const theirKey = friendsKey(otherUsername);
  const theirRaw = window.localStorage.getItem(theirKey);
  const theirFriends = theirRaw ? (JSON.parse(theirRaw) as string[]) : [];
  if (!theirFriends.some((u) => u.toLowerCase() === me.toLowerCase())) {
    window.localStorage.setItem(theirKey, JSON.stringify([...theirFriends, me]));
  }
  if (isSupabaseConfigured() && supabase) {
    supabase
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("from_username", otherUsername)
      .eq("to_username", me)
      .then(() => refreshFriendRequestsFromSupabase());
  }
}

export function rejectFriendRequest(fromUsername: string): void {
  const me = getCurrentUsername();
  if (!me) return;
  const from = fromUsername.trim().toLowerCase();
  const requests = loadFriendRequests();
  const idx = requests.findIndex(
    (r) => r.from.toLowerCase() === from && r.to.toLowerCase() === me.toLowerCase() && r.status === "pending"
  );
  if (idx === -1) return;
  const updated = requests.filter((_, i) => i !== idx);
  saveFriendRequests(updated);
  if (isSupabaseConfigured() && supabase) {
    supabase
      .from("friend_requests")
      .delete()
      .eq("from_username", from)
      .eq("to_username", me)
      .then(() => refreshFriendRequestsFromSupabase());
  }
}

export function removeFriend(username: string): void {
  const me = getCurrentUsername();
  if (!me) return;
  const list = loadFriends().filter((u) => u.toLowerCase() !== username.toLowerCase());
  saveFriends(me, list);
  const theirKey = friendsKey(username);
  const theirRaw = window.localStorage.getItem(theirKey);
  if (theirRaw) {
    const theirList = (JSON.parse(theirRaw) as string[]).filter((u) => u.toLowerCase() !== me.toLowerCase());
    window.localStorage.setItem(theirKey, JSON.stringify(theirList));
  }
}

const DEFAULT_SHELVES: Shelf[] = [
  { id: "wil-ik-lezen", name: "Wil ik lezen", system: true },
  { id: "aan-het-lezen", name: "Aan het lezen", system: true },
  { id: "gelezen", name: "Gelezen", system: true }
];

/** Boeken van een andere gebruiker (voor read-only weergave, bv. Boekbuddy). */
export function loadBooksForUser(username: string): Book[] {
  const raw = window.localStorage.getItem(booksKeyForUser(username));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Book[];
  } catch {
    return [];
  }
}

/** Boeken van een andere gebruiker ophalen (lokaal of uit Supabase). Voor Boekbuddy-pagina. */
export async function loadBooksForUserAsync(username: string): Promise<Book[]> {
  if (isSupabaseConfigured() && supabase) {
    const uid = await getUserIdByUsername(username);
    if (uid) {
      const { data } = await supabase.from("user_data").select("value").eq("user_id", uid).eq("key", "books").maybeSingle();
      if (data?.value != null && Array.isArray(data.value)) {
        const books = data.value as Book[];
        window.localStorage.setItem(booksKeyForUser(username), JSON.stringify(books));
        return books;
      }
    }
  }
  return loadBooksForUser(username);
}

/** Planken van een andere gebruiker (voor weergave). */
export function loadShelvesForUser(username: string): Shelf[] {
  const raw = window.localStorage.getItem(shelvesKeyForUser(username));
  if (!raw) return DEFAULT_SHELVES;
  try {
    return JSON.parse(raw) as Shelf[];
  } catch {
    return DEFAULT_SHELVES;
  }
}

/** Planken van een andere gebruiker ophalen (lokaal of uit Supabase). */
export async function loadShelvesForUserAsync(username: string): Promise<Shelf[]> {
  if (isSupabaseConfigured() && supabase) {
    const uid = await getUserIdByUsername(username);
    if (uid) {
      const { data } = await supabase.from("user_data").select("value").eq("user_id", uid).eq("key", "shelves").maybeSingle();
      if (data?.value != null && Array.isArray(data.value)) {
        const shelves = data.value as Shelf[];
        window.localStorage.setItem(shelvesKeyForUser(username), JSON.stringify(shelves));
        return shelves;
      }
    }
  }
  return loadShelvesForUser(username);
}

/** Inbox met door Boekbuddies gedeelde boeken/planken. */
export function loadSharedInbox(): SharedItem[] {
  const me = getCurrentUsername();
  if (!me) return [];
  const raw = window.localStorage.getItem(sharedInboxKey(me));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as SharedItem[]) : [];
  } catch {
    return [];
  }
}

function saveSharedInbox(username: string, items: SharedItem[]) {
  window.localStorage.setItem(sharedInboxKey(username), JSON.stringify(items));
  // Signaleer aan de UI dat de gedeelde inbox is bijgewerkt (voor bv. rood bolletje in de profiel-tab)
  window.dispatchEvent(new Event("bt_shared_inbox_updated"));
  const client = supabase;
  if (isSupabaseConfigured() && client) {
    getUserIdByUsername(username).then((uid) => {
      if (uid && client) client.from("shared_inbox").upsert({ user_id: uid, items }, { onConflict: "user_id" }).then(() => {});
    });
  }
}

function loadSharedInboxForUser(username: string): SharedItem[] {
  const raw = window.localStorage.getItem(sharedInboxKey(username));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SharedItem[];
  } catch {
    return [];
  }
}

/** Deel boeken met een Boekbuddy (plaatst item in hun inbox). */
export function shareWithFriend(
  toUsername: string,
  bookSnapshots: { title: string; authors: string; coverUrl?: string; seriesName?: string }[],
  shelfName?: string
): { ok: true } | { ok: false; error: string } {
  const me = getCurrentUsername();
  if (!me) return { ok: false, error: "Niet ingelogd." };
  const to = toUsername.trim();
  if (!to) return { ok: false, error: "Kies een Boekbuddy." };
  const friendList = loadFriends();
  if (!friendList.some((u) => u.toLowerCase() === to.toLowerCase())) {
    return { ok: false, error: "Alleen met Boekbuddies kun je delen." };
  }
  if (!bookSnapshots.length) return { ok: false, error: "Geen boeken om te delen." };
  const item: SharedItem = {
    from: me,
    books: bookSnapshots.map((b) => ({ title: b.title, authors: b.authors, coverUrl: b.coverUrl, seriesName: b.seriesName })),
    shelfName,
    sharedAt: new Date().toISOString()
  };
  const recipientInbox = loadSharedInboxForUser(to);
  saveSharedInbox(to, [...recipientInbox, item]);
  return { ok: true };
}

/** Voeg boeken uit een gedeeld item toe aan mijn TBR. Boeken die al in de bibliotheek staan (zelfde titel + auteur, elk status) worden overgeslagen. Retourneert { added, skipped }. */
export function addSharedItemToTbr(itemIndex: number): { added: number; skipped: number } {
  const me = getCurrentUsername();
  if (!me) return { added: 0, skipped: 0 };
  const inbox = loadSharedInbox();
  if (itemIndex < 0 || itemIndex >= inbox.length) return { added: 0, skipped: 0 };
  const item = inbox[itemIndex];
  const currentBooks = loadBooks();
  const norm = (t: string) => (t ?? "").trim().toLowerCase();
  const exists = (title: string, authors: string) =>
    currentBooks.some(
      (b) => norm(b.title) === norm(title) && norm(b.authors) === norm(authors)
    );
  const toAdd = item.books.filter((b) => !exists(b.title, b.authors));
  const skipped = item.books.length - toAdd.length;
  let idx = 0;
  const newBooks = toAdd.map((b) => ({
    id: `book-${Date.now()}-${idx++}-${Math.random().toString(36).slice(2, 9)}`,
    title: b.title,
    authors: b.authors,
    coverUrl: b.coverUrl,
    status: "wil-ik-lezen" as const,
    order: undefined
  }));
  if (newBooks.length > 0) {
    saveBooks([...currentBooks, ...newBooks]);
  }
  const updatedInbox = inbox.filter((_, i) => i !== itemIndex);
  saveSharedInbox(me, updatedInbox);
  return { added: newBooks.length, skipped };
}

/** Voeg boek-snapshots toe aan mijn bibliotheek (TBR of plank). Bestaande boeken (zelfde titel+auteur) worden overgeslagen. */
export function addBookSnapshotsToMyLibrary(
  snapshots: SharedBookSnapshot[],
  options: { status?: ReadStatus; shelfId?: string }
): { added: number; skipped: number } {
  const me = getCurrentUsername();
  if (!me || !snapshots.length) return { added: 0, skipped: 0 };
  const currentBooks = loadBooks();
  const norm = (t: string) => (t ?? "").trim().toLowerCase();
  const exists = (title: string, authors: string) =>
    currentBooks.some((b) => norm(b.title) === norm(title) && norm(b.authors) === norm(authors));
  const toAdd = snapshots.filter((b) => !exists(b.title, b.authors));
  const skipped = snapshots.length - toAdd.length;
  const systemStatus: Record<string, ReadStatus> = {
    "wil-ik-lezen": "wil-ik-lezen",
    "aan-het-lezen": "aan-het-lezen",
    gelezen: "gelezen"
  };
  const status =
    options.status ??
    (options.shelfId && systemStatus[options.shelfId]) ??
    "wil-ik-lezen";
  const shelfIds = options.shelfId && !systemStatus[options.shelfId] ? [options.shelfId] : undefined;
  let idx = 0;
  const newBooks: Book[] = toAdd.map((b) => ({
    id: `book-${Date.now()}-${idx++}-${Math.random().toString(36).slice(2, 9)}`,
    title: b.title,
    authors: b.authors,
    coverUrl: b.coverUrl,
    status,
    order: status === "wil-ik-lezen" ? undefined : undefined,
    shelfIds
  }));
  if (newBooks.length > 0) {
    saveBooks([...currentBooks, ...newBooks]);
  }
  return { added: newBooks.length, skipped };
}

/** Voeg alleen de geselecteerde boeken uit een gedeeld item toe aan TBR; haal ze uit het item. */
export function addSharedItemBooksToTbr(
  itemIndex: number,
  bookIndices: number[]
): { added: number; skipped: number } {
  const me = getCurrentUsername();
  if (!me) return { added: 0, skipped: 0 };
  const inbox = loadSharedInbox();
  if (itemIndex < 0 || itemIndex >= inbox.length) return { added: 0, skipped: 0 };
  const item = inbox[itemIndex];
  const toAdd = bookIndices
    .filter((i) => i >= 0 && i < item.books.length)
    .map((i) => item.books[i]);
  if (toAdd.length === 0) return { added: 0, skipped: 0 };
  const result = addBookSnapshotsToMyLibrary(toAdd, { status: "wil-ik-lezen" });
  const remainingIndices = new Set(bookIndices);
  const newBooks = item.books.filter((_, i) => !remainingIndices.has(i));
  const newInbox =
    newBooks.length === 0
      ? inbox.filter((_, i) => i !== itemIndex)
      : inbox.map((it, i) => (i === itemIndex ? { ...it, books: newBooks } : it));
  saveSharedInbox(me, newInbox);
  return result;
}

/** Verwijder een gedeeld item uit de inbox (zonder toevoegen aan TBR). */
export function dismissSharedItem(itemIndex: number): void {
  const me = getCurrentUsername();
  if (!me) return;
  const inbox = loadSharedInbox();
  if (itemIndex < 0 || itemIndex >= inbox.length) return;
  const updatedInbox = inbox.filter((_, i) => i !== itemIndex);
  saveSharedInbox(me, updatedInbox);
}


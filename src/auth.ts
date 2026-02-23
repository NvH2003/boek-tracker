import { supabase, isSupabaseConfigured } from "./supabase";

const ACCOUNTS_KEY = "bt_accounts_v1";
const CURRENT_USER_KEY = "bt_current_username";
export const LOGGED_IN_KEY = "bt_logged_in";
const CURRENT_USER_ID_KEY = "bt_current_user_id";

const OLD_BOOKS_KEY = "bt_books_v1";
const OLD_SHELVES_KEY = "bt_shelves_v1";
const OLD_CHALLENGE_KEY = "bt_challenge_v1";

const BOEKBUDDY_EMAIL_DOMAIN = "@boektracker.local";

export interface Account {
  username: string;
  passwordHash: string;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getAccounts(): Account[] {
  const raw = window.localStorage.getItem(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Account[];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: Account[]) {
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getCurrentUsername(): string | null {
  return window.localStorage.getItem(CURRENT_USER_KEY);
}

/** Bij Supabase: user id uit session (voor storage). */
export function getCurrentUserId(): string | null {
  if (isSupabaseConfigured()) {
    return window.localStorage.getItem(CURRENT_USER_ID_KEY);
  }
  return null;
}

export function setCurrentUser(username: string, userId?: string) {
  window.localStorage.setItem(CURRENT_USER_KEY, username);
  window.localStorage.setItem(LOGGED_IN_KEY, "true");
  if (userId) window.localStorage.setItem(CURRENT_USER_ID_KEY, userId);
}

export function clearCurrentUser() {
  if (isSupabaseConfigured()) signOutSupabase();
  window.localStorage.removeItem(CURRENT_USER_KEY);
  window.localStorage.removeItem(LOGGED_IN_KEY);
  window.localStorage.removeItem(CURRENT_USER_ID_KEY);
}

let cachedUsernames: string[] = [];

async function refreshUsernamesCache() {
  if (!supabase) return;
  const { data } = await supabase.from("profiles").select("username");
  cachedUsernames = (data ?? []).map((r: { username: string }) => r.username);
}

/** Lijst van alle gebruikersnamen (lokaal of uit Supabase). */
export function getExistingUsernames(): string[] {
  if (isSupabaseConfigured()) return cachedUsernames;
  return getAccounts().map((a) => a.username);
}

/** Na inloggen of app-load met session: cache vullen (Supabase). */
export async function refreshAuthCache(): Promise<void> {
  if (isSupabaseConfigured()) await refreshUsernamesCache();
}

/** Controleer of er een Supabase-session is en zet username in localStorage. Roep aan bij app start. */
export async function initSupabaseSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", session.user.id)
    .single();
  if (profile?.username) {
    setCurrentUser(profile.username, session.user.id);
    await refreshUsernamesCache();
    window.dispatchEvent(new Event("bt_login"));
    return true;
  }
  await signOutSupabase();
  return false;
}

/** Supabase: user_id ophalen bij gebruikersnaam (voor storage-sync). */
export async function getUserIdByUsername(username: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username.trim())
    .maybeSingle();
  return data?.id ?? null;
}

export async function verifyLogin(username: string, password: string): Promise<boolean> {
  if (isSupabaseConfigured() && supabase) {
    const email = `${username.trim().toLowerCase()}${BOEKBUDDY_EMAIL_DOMAIN}`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();
    if (profile?.username) {
      setCurrentUser(profile.username, user.id);
      await refreshUsernamesCache();
      return true;
    }
    await signOutSupabase();
    return false;
  }
  const accounts = getAccounts();
  const normalized = username.trim().toLowerCase();
  const account = accounts.find((a) => a.username.toLowerCase() === normalized);
  if (!account) return false;
  const hash = await hashPassword(password);
  return hash === account.passwordHash;
}

export async function createAccount(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = username.trim();
  if (!trimmed) return { ok: false, error: "Vul een gebruikersnaam in." };
  if (!password || password.length < 4) return { ok: false, error: "Kies een wachtwoord van minstens 4 tekens." };

  if (isSupabaseConfigured() && supabase) {
    const email = `${trimmed.toLowerCase()}${BOEKBUDDY_EMAIL_DOMAIN}`;
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) {
      if (authError.message.includes("already registered")) return { ok: false, error: "Deze gebruikersnaam bestaat al." };
      return { ok: false, error: authError.message };
    }
    if (!authData.user) return { ok: false, error: "Registratie mislukt." };
    const { error: profileError } = await supabase.from("profiles").insert({ id: authData.user.id, username: trimmed });
    if (profileError) {
      if (profileError.code === "23505") return { ok: false, error: "Deze gebruikersnaam bestaat al." };
      return { ok: false, error: profileError.message };
    }
    setCurrentUser(trimmed, authData.user.id);
    await refreshUsernamesCache();
    return { ok: true };
  }

  const accounts = getAccounts();
  const exists = accounts.some((a) => a.username.toLowerCase() === trimmed.toLowerCase());
  if (exists) return { ok: false, error: "Deze gebruikersnaam bestaat al." };
  const passwordHash = await hashPassword(password);
  accounts.push({ username: trimmed, passwordHash });
  saveAccounts(accounts);
  return { ok: true };
}

const DEFAULT_PROFILE_USERNAME = "NoavHelvoirt";
const DEFAULT_PROFILE_PASSWORD = "Zara_Oona2020";

/** Migreer oude data (zonder accounts) naar account NoavHelvoirt. Retourneert true als er gemigreerd is. */
export async function runMigration(): Promise<{ migrated: boolean; message?: string }> {
  if (getAccounts().length > 0) return { migrated: false };
  const hasOldBooks = window.localStorage.getItem(OLD_BOOKS_KEY) != null;
  const hasOldShelves = window.localStorage.getItem(OLD_SHELVES_KEY) != null;
  const hasOldChallenge = window.localStorage.getItem(OLD_CHALLENGE_KEY) != null;
  if (!hasOldBooks && !hasOldShelves && !hasOldChallenge) return { migrated: false };

  const result = await createAccount(DEFAULT_PROFILE_USERNAME, DEFAULT_PROFILE_PASSWORD);
  if (!result.ok) return { migrated: false };

  const u = DEFAULT_PROFILE_USERNAME;
  if (hasOldBooks) {
    const raw = window.localStorage.getItem(OLD_BOOKS_KEY);
    if (raw) window.localStorage.setItem(`${OLD_BOOKS_KEY}_${u}`, raw);
    window.localStorage.removeItem(OLD_BOOKS_KEY);
  }
  if (hasOldShelves) {
    const raw = window.localStorage.getItem(OLD_SHELVES_KEY);
    if (raw) window.localStorage.setItem(`${OLD_SHELVES_KEY}_${u}`, raw);
    else {
      const defaults = JSON.stringify([
        { id: "wil-ik-lezen", name: "Wil ik lezen", system: true },
        { id: "aan-het-lezen", name: "Aan het lezen", system: true },
        { id: "gelezen", name: "Gelezen", system: true }
      ]);
      window.localStorage.setItem(`${OLD_SHELVES_KEY}_${u}`, defaults);
    }
    window.localStorage.removeItem(OLD_SHELVES_KEY);
  }
  if (hasOldChallenge) {
    const raw = window.localStorage.getItem(OLD_CHALLENGE_KEY);
    if (raw) window.localStorage.setItem(`${OLD_CHALLENGE_KEY}_${u}`, raw);
    window.localStorage.removeItem(OLD_CHALLENGE_KEY);
  }

  return {
    migrated: true,
    message: `Je bestaande data staat nu in account '${DEFAULT_PROFILE_USERNAME}'. Log in met wachtwoord ${DEFAULT_PROFILE_PASSWORD}. Wijzig je wachtwoord eventueel in Profiel.`
  };
}

const USER_SCOPED_KEYS = [OLD_BOOKS_KEY, OLD_SHELVES_KEY, OLD_CHALLENGE_KEY, "bt_user_name", "bt_friends_v1"] as const;

/** Eenmalig: hernoem account "noa" naar "NoavHelvoirt" en migreer alle bijbehorende data. Wachtwoord blijft hetzelfde. */
export function runRenameNoaToNoavHelvoirt(): boolean {
  const accounts = getAccounts();
  const noaIndex = accounts.findIndex((a) => a.username === "noa");
  if (noaIndex === -1) return false;

  accounts[noaIndex] = { ...accounts[noaIndex], username: "NoavHelvoirt" };
  saveAccounts(accounts);

  for (const baseKey of USER_SCOPED_KEYS) {
    const oldKey = `${baseKey}_noa`;
    const raw = window.localStorage.getItem(oldKey);
    if (raw != null) {
      window.localStorage.setItem(`${baseKey}_NoavHelvoirt`, raw);
      window.localStorage.removeItem(oldKey);
    }
  }

  if (getCurrentUsername() === "noa") setCurrentUser("NoavHelvoirt");
  return true;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = getCurrentUsername();
  if (!username) return { ok: false, error: "Niet ingelogd." };

  if (isSupabaseConfigured() && supabase) {
    const valid = await verifyLogin(username, currentPassword);
    if (!valid) return { ok: false, error: "Huidige wachtwoord is onjuist." };
    if (!newPassword || newPassword.length < 4) return { ok: false, error: "Kies een nieuw wachtwoord van minstens 4 tekens." };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const valid = await verifyLogin(username, currentPassword);
  if (!valid) return { ok: false, error: "Huidige wachtwoord is onjuist." };
  if (!newPassword || newPassword.length < 4) return { ok: false, error: "Kies een nieuw wachtwoord van minstens 4 tekens." };
  const accounts = getAccounts();
  const hash = await hashPassword(newPassword);
  const idx = accounts.findIndex((a) => a.username === username);
  if (idx === -1) return { ok: false, error: "Account niet gevonden." };
  accounts[idx] = { ...accounts[idx], passwordHash: hash };
  saveAccounts(accounts);
  return { ok: true };
}

async function signOutSupabase(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}

const FRIEND_REQUESTS_KEY = "bt_friend_requests_v1";
const SHARED_INBOX_KEY = "bt_shared_inbox_v1";
const DISPLAY_NAME_KEY = "bt_user_name";

/** Verwijder het huidige account en alle bijbehorende data. Wachtwoord vereist voor bevestiging. */
export async function deleteAccount(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = getCurrentUsername();
  if (!username) return { ok: false, error: "Niet ingelogd." };

  if (isSupabaseConfigured() && supabase) {
    const valid = await verifyLogin(username, password);
    if (!valid) return { ok: false, error: "Wachtwoord is onjuist." };
    const userId = getCurrentUserId();
    if (!userId) return { ok: false, error: "Sessie ongeldig." };

    const { error: errData } = await supabase.from("user_data").delete().eq("user_id", userId);
    if (errData) return { ok: false, error: errData.message };
    const { error: errInbox } = await supabase.from("shared_inbox").delete().eq("user_id", userId);
    if (errInbox) return { ok: false, error: errInbox.message };
    const { error: errReqFrom } = await supabase.from("friend_requests").delete().eq("from_username", username);
    if (errReqFrom) return { ok: false, error: errReqFrom.message };
    const { error: errReqTo } = await supabase.from("friend_requests").delete().eq("to_username", username);
    if (errReqTo) return { ok: false, error: errReqTo.message };
    const { error: errProfile } = await supabase.from("profiles").delete().eq("id", userId);
    if (errProfile) return { ok: false, error: errProfile.message };

    await supabase.functions.invoke("delete-auth-user", { method: "POST" });

    clearCurrentUser();
    return { ok: true };
  }

  const valid = await verifyLogin(username, password);
  if (!valid) return { ok: false, error: "Wachtwoord is onjuist." };
  const accounts = getAccounts();
  const idx = accounts.findIndex((a) => a.username === username);
  if (idx === -1) return { ok: false, error: "Account niet gevonden." };
  accounts.splice(idx, 1);
  saveAccounts(accounts);

  const keysToRemove = [
    `${OLD_BOOKS_KEY}_${username}`,
    `${OLD_SHELVES_KEY}_${username}`,
    `${OLD_CHALLENGE_KEY}_${username}`,
    `${DISPLAY_NAME_KEY}_${username}`,
    `bt_friends_v1_${username}`,
    `${SHARED_INBOX_KEY}_${username}`
  ];
  for (const k of keysToRemove) window.localStorage.removeItem(k);

  const rawReq = window.localStorage.getItem(FRIEND_REQUESTS_KEY);
  if (rawReq) {
    try {
      const requests: { from: string; to: string; status: string }[] = JSON.parse(rawReq);
      const filtered = requests.filter((r) => r.from !== username && r.to !== username);
      window.localStorage.setItem(FRIEND_REQUESTS_KEY, JSON.stringify(filtered));
    } catch {
      // ignore
    }
  }

  clearCurrentUser();
  return { ok: true };
}

import { db } from "./db";

export const LOGGED_IN_KEY = "bt_logged_in";
const CURRENT_USER_KEY = "bt_current_username";

// --- Sessiebeheer (localStorage) ---

export function getCurrentUsername(): string | null {
  return window.localStorage.getItem(CURRENT_USER_KEY);
}

export function setCurrentUser(username: string) {
  window.localStorage.setItem(CURRENT_USER_KEY, username);
  window.localStorage.setItem(LOGGED_IN_KEY, "true");
}

export function clearCurrentUser() {
  db.auth.signOut();
  window.localStorage.removeItem(CURRENT_USER_KEY);
  window.localStorage.removeItem(LOGGED_IN_KEY);
}

// --- Auth API calls (Vercel serverless functions) ---

async function authFetch<T>(
  path: string,
  body: Record<string, string>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? "Onbekende fout." };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: "Netwerkfout. Controleer je verbinding." };
  }
}

export async function verifyLogin(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await authFetch<{ token: string; username: string }>(
    "/api/auth/sign-in",
    { username, password }
  );
  if (!result.ok) {
    const msg = result.error;
    if (msg.startsWith("Server error: fetch failed") || msg.includes("InstantDB mislukt")) {
      return { ok: false, error: "Verbinding met InstantDB mislukt. Probeer het nog eens." };
    }
    return { ok: false, error: msg };
  }
  try {
    setCurrentUser(result.data.username);
    await signInWithRetry(result.data.token);
  } catch {
    clearCurrentUser();
    return { ok: false, error: "Kon geen verbinding maken met InstantDB. Probeer opnieuw of controleer je internet." };
  }
  return { ok: true };
}

async function signInWithRetry(token: string, attempts = 4): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await db.auth.signInWithToken(token);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export async function authDebug(): Promise<string> {
  try {
    const res = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "__debug__", password: "__debug__" }),
    });
    const json = await res.json() as { error?: string };
    return `HTTP ${res.status}: ${json.error ?? JSON.stringify(json)}`;
  } catch (e) {
    return `Netwerkfout: ${String(e)}`;
  }
}

export async function createAccount(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = username.trim();
  if (!trimmed) return { ok: false, error: "Vul een gebruikersnaam in." };
  if (!password || password.length < 4)
    return { ok: false, error: "Kies een wachtwoord van minstens 4 tekens." };

  const result = await authFetch<{ token: string; username: string }>(
    "/api/auth/register",
    { username: trimmed, password }
  );
  if (!result.ok) return { ok: false, error: result.error };

  try {
    setCurrentUser(result.data.username);
    await signInWithRetry(result.data.token);
  } catch {
    clearCurrentUser();
    return { ok: false, error: "Kon geen verbinding maken met InstantDB. Probeer opnieuw of controleer je internet." };
  }
  return { ok: true };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = getCurrentUsername();
  if (!username) return { ok: false, error: "Niet ingelogd." };

  const result = await authFetch<{ ok: boolean }>(
    "/api/auth/change-password",
    { username, currentPassword, newPassword }
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export async function deleteAccount(
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = getCurrentUsername();
  if (!username) return { ok: false, error: "Niet ingelogd." };

  const result = await authFetch<{ ok: boolean }>(
    "/api/auth/delete-account",
    { username, password }
  );
  if (!result.ok) return { ok: false, error: result.error };

  clearCurrentUser();
  return { ok: true };
}

/** Herstel sessie bij app-start vanuit InstantDB token (persistentie via InstantDB). */
export async function initInstantSession(): Promise<boolean> {
  const authState = await db.getAuth();
  if (!authState) return false;

  // Haal de username op uit localStorage (InstantDB bewaart de token al)
  const stored = getCurrentUsername();
  if (stored) {
    window.localStorage.setItem(LOGGED_IN_KEY, "true");
    window.dispatchEvent(new Event("bt_login"));
    return true;
  }
  return false;
}

// --- Lege stubs voor backward compatibility (worden niet meer gebruikt) ---

export async function runMigration(): Promise<{ migrated: boolean; message?: string }> {
  return { migrated: false };
}

export function runRenameNoaToNoavHelvoirt(): boolean {
  return false;
}

export function getExistingUsernames(): string[] {
  return [];
}

export async function refreshAuthCache(): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: true };
}

export async function getUserIdByUsername(_username: string): Promise<string | null> {
  return null;
}

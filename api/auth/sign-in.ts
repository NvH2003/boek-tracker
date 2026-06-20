import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { getAdminDb, resetAdminDb } from "../instant-admin";
import { withInstantRetry } from "../instant-retry";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const appId = process.env.INSTANT_APP_ID ?? process.env.VITE_INSTANT_APP_ID ?? "";
  const adminToken = process.env.INSTANT_ADMIN_TOKEN ?? "";
  if (!appId || !adminToken) {
    return res.status(500).json({ error: `Env vars ontbreken: appId=${!!appId} adminToken=${!!adminToken}` });
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: "Gebruikersnaam en wachtwoord zijn verplicht." });
  }

  const trimmed = username.trim();
  const trimmedLower = trimmed.toLowerCase();
  const fakeEmail = `${trimmedLower}@boektracker.local`;

  // Haal alle profielen op en doe case-insensitive match in JS
  // (InstantDB LIKE is case-sensitive, usernames zijn opgeslagen met originele casing)
  const result = await withInstantRetry(async () => {
    try {
      return await getAdminDb().query({ profiles: {} });
    } catch (err) {
      resetAdminDb();
      throw err;
    }
  });

  const profiles = (result.profiles ?? []) as Array<{
    id: string;
    username: string;
    passwordHash: string;
  }>;

  const profile = profiles.find(
    (p) => p.username.toLowerCase() === trimmedLower
  );

  if (!profile) {
    return res.status(401).json({ error: "Gebruikersnaam of wachtwoord klopt niet." });
  }

  // Als de hash leeg is (gemigreerde gebruiker zonder opgeslagen hash):
  // sla het opgegeven wachtwoord op als nieuw wachtwoord (eenmalige migratie).
  if (!profile.passwordHash) {
    const newHash = await sha256Hex(password);
    await withInstantRetry(async () => {
      try {
        await getAdminDb().transact([
          getAdminDb().tx.profiles[profile.id].update({ passwordHash: newHash }),
        ]);
      } catch (err) {
        resetAdminDb();
        throw err;
      }
    });
  } else {
    const hash = await sha256Hex(password);
    if (hash !== profile.passwordHash) {
      return res.status(401).json({ error: "Gebruikersnaam of wachtwoord klopt niet." });
    }
  }

  // Maak een InstantDB auth token aan voor deze gebruiker
  const token = await withInstantRetry(async () => {
    try {
      return await getAdminDb().auth.createToken(fakeEmail);
    } catch (err) {
      resetAdminDb();
      throw err;
    }
  });

  return res.status(200).json({ token, username: profile.username });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "fetch failed") {
      return res.status(503).json({
        error: "Verbinding met InstantDB mislukt. Probeer het nog eens of controleer je internet/firewall.",
      });
    }
    return res.status(500).json({ error: `Server error: ${msg}` });
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { init } from "@instantdb/admin";

const db = init({
  appId: process.env.INSTANT_APP_ID ?? process.env.VITE_INSTANT_APP_ID ?? "",
  adminToken: process.env.INSTANT_ADMIN_TOKEN ?? "",
});

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(text).digest("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: "Gebruikersnaam en wachtwoord zijn verplicht." });
  }

  const trimmed = username.trim().toLowerCase();
  const fakeEmail = `${trimmed}@boektracker.local`;

  // Zoek het profiel op username
  const result = await db.query({
    profiles: {
      $: { where: { username: { $like: trimmed } } },
    },
  });

  // Case-insensitive zoeken: probeer ook exact
  const profiles = (result.profiles ?? []) as Array<{
    id: string;
    username: string;
    passwordHash: string;
  }>;

  const profile = profiles.find(
    (p) => p.username.toLowerCase() === trimmed
  );

  if (!profile) {
    return res.status(401).json({ error: "Gebruikersnaam of wachtwoord klopt niet." });
  }

  const hash = await sha256Hex(password);
  if (hash !== profile.passwordHash) {
    return res.status(401).json({ error: "Gebruikersnaam of wachtwoord klopt niet." });
  }

  // Maak een InstantDB auth token aan voor deze gebruiker
  const token = await db.auth.createToken(fakeEmail);

  return res.status(200).json({ token, username: profile.username });
}

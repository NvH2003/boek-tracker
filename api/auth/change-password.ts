import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { getAdminDb } from "../instant-admin";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const db = getAdminDb();

  const { username, currentPassword, newPassword } = req.body as {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  if (!username?.trim() || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "Alle velden zijn verplicht." });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: "Kies een nieuw wachtwoord van minstens 4 tekens." });
  }

  const trimmedLower = username.trim().toLowerCase();

  // Haal alle profielen op en doe case-insensitive match in JS
  const result = await db.query({ profiles: {} });
  const profiles = (result.profiles ?? []) as Array<{
    id: string;
    username: string;
    passwordHash: string;
  }>;
  const profile = profiles.find((p) => p.username.toLowerCase() === trimmedLower);

  if (!profile) return res.status(404).json({ error: "Gebruiker niet gevonden." });

  const currentHash = await sha256Hex(currentPassword);
  if (currentHash !== profile.passwordHash) {
    return res.status(401).json({ error: "Huidige wachtwoord is onjuist." });
  }

  const newHash = await sha256Hex(newPassword);
  await db.transact([
    db.tx.profiles[profile.id].update({ passwordHash: newHash }),
  ]);

  return res.status(200).json({ ok: true });
}

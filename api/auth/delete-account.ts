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

  const hash = await sha256Hex(password);
  if (hash !== profile.passwordHash) {
    return res.status(401).json({ error: "Wachtwoord is onjuist." });
  }

  const fakeEmail = `${trimmed}@boektracker.local`;

  // Verwijder alle vriendschapsverzoeken waarbij deze gebruiker betrokken is
  const frResult = await db.query({
    friendRequests: {
      $: {
        where: {
          or: [
            { fromUsername: profile.username },
            { toUsername: profile.username },
          ],
        },
      },
    },
  });
  const friendRequests = (frResult.friendRequests ?? []) as Array<{ id: string }>;

  // Verwijder alle shared inbox items gericht aan deze gebruiker
  const inboxResult = await db.query({
    sharedInboxItems: {
      $: { where: { toUsername: profile.username } },
    },
  });
  const inboxItems = (inboxResult.sharedInboxItems ?? []) as Array<{ id: string }>;

  // Transactie: verwijder profiel + verzoeken + inbox items
  await db.transact([
    db.tx.profiles[profile.id].delete(),
    ...friendRequests.map((fr) => db.tx.friendRequests[fr.id].delete()),
    ...inboxItems.map((item) => db.tx.sharedInboxItems[item.id].delete()),
  ]);

  // Verwijder de auth-user
  await db.auth.deleteUser({ email: fakeEmail });

  return res.status(200).json({ ok: true });
}

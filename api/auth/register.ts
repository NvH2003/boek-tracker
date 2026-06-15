import type { VercelRequest, VercelResponse } from "@vercel/node";
import { init, id as instantId } from "@instantdb/admin";

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
  const trimmed = (username ?? "").trim();

  if (!trimmed) return res.status(400).json({ error: "Vul een gebruikersnaam in." });
  if (!password || password.length < 4) {
    return res.status(400).json({ error: "Kies een wachtwoord van minstens 4 tekens." });
  }

  // Controleer of de gebruikersnaam al bestaat (case-insensitive)
  const existing = await db.query({
    profiles: { $: { where: { username: trimmed } } },
  });
  const profiles = (existing.profiles ?? []) as Array<{ username: string }>;
  const taken = profiles.some((p) => p.username.toLowerCase() === trimmed.toLowerCase());
  if (taken) {
    return res.status(409).json({ error: "Deze gebruikersnaam bestaat al." });
  }

  const fakeEmail = `${trimmed.toLowerCase()}@boektracker.local`;
  const passwordHash = await sha256Hex(password);

  // Maak de InstantDB $user aan via createToken (maakt user als hij niet bestaat)
  const token = await db.auth.createToken(fakeEmail);

  // Haal het InstantDB user-id op
  const idbUser = await db.auth.getUser({ email: fakeEmail });
  if (!idbUser?.id) {
    return res.status(500).json({ error: "Registratie mislukt." });
  }

  const profileId = instantId();
  const defaultShelves = [
    { id: "wil-ik-lezen", name: "Wil ik lezen", system: true },
    { id: "aan-het-lezen", name: "Aan het lezen", system: true },
    { id: "gelezen", name: "Gelezen", system: true },
  ];

  await db.transact([
    db.tx.profiles[profileId]
      .update({
        username: trimmed,
        passwordHash,
        books: [],
        shelves: defaultShelves,
        friends: [],
        shelfViewSettings: { sortRulesByShelf: {}, groupModeByShelf: {}, groupSortRules: {} },
        genreFetchAllowlist: [],
      })
      .link({ $user: idbUser.id }),
  ]);

  return res.status(200).json({ token, username: trimmed });
}

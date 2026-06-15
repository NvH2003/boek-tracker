/**
 * Eenmalig migratiescript: kopieert alle data van Supabase naar InstantDB.
 *
 * Uitvoeren VÓÓR de nieuwe versie deployen:
 *   npx tsx scripts/migrate-supabase-to-instant.ts
 *
 * Benodigde omgevingsvariabelen (lokaal in .env of als export):
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← service role key (niet de anon key!)
 *   INSTANT_APP_ID
 *   INSTANT_ADMIN_TOKEN
 */

import { createClient } from "@supabase/supabase-js";
import { init, id as instantId } from "@instantdb/admin";
import * as dotenv from "dotenv";

dotenv.config();

// --- Config ---
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const INSTANT_APP_ID = process.env.INSTANT_APP_ID ?? process.env.VITE_INSTANT_APP_ID ?? "";
const INSTANT_ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌  VITE_SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  process.exit(1);
}
if (!INSTANT_APP_ID || !INSTANT_ADMIN_TOKEN) {
  console.error("❌  INSTANT_APP_ID of INSTANT_ADMIN_TOKEN ontbreekt.");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const idb = init({ appId: INSTANT_APP_ID, adminToken: INSTANT_ADMIN_TOKEN });

// --- Types (zelfde als src/types.ts) ---
interface Book {
  id: string;
  title: string;
  authors: string;
  coverUrl?: string;
  description?: string;
  genre?: string;
  status: string;
  pageCount?: number;
  rating?: number;
  notes?: string;
  startedAt?: string;
  finishedAt?: string;
  seriesName?: string;
  seriesNumber?: number;
  order?: number;
  tbrOrder?: number;
  shelfIds?: string[];
}

interface Shelf {
  id: string;
  name: string;
  system?: boolean;
}

interface ShelfViewSettings {
  sortRulesByShelf: Record<string, string[]>;
  groupModeByShelf: Record<string, string>;
  groupSortRules: Record<string, string[]>;
}

// --- Hulpfuncties ---
function safeJson<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === "object") return val as T;
  try {
    return JSON.parse(String(val)) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  console.log("🚀  Migratie Supabase → InstantDB gestart…\n");

  // 1. Laad alle Supabase-profielen
  const { data: sbProfiles, error: profErr } = await supa
    .from("profiles")
    .select("id, username");
  if (profErr) throw new Error(`Supabase profiles: ${profErr.message}`);
  if (!sbProfiles?.length) {
    console.log("ℹ️  Geen gebruikers gevonden in Supabase — niets te migreren.");
    return;
  }
  console.log(`👥  ${sbProfiles.length} gebruiker(s) gevonden.`);

  // 2. Laad alle user_data in één query
  const { data: allUserData, error: udErr } = await supa
    .from("user_data")
    .select("user_id, key, value");
  if (udErr) throw new Error(`Supabase user_data: ${udErr.message}`);

  // Groepeer per user_id
  const byUser: Record<string, Record<string, unknown>> = {};
  for (const row of allUserData ?? []) {
    if (!byUser[row.user_id]) byUser[row.user_id] = {};
    byUser[row.user_id][row.key] = row.value;
  }

  // 3. Laad friend_requests
  const { data: allFriendReqs, error: frErr } = await supa
    .from("friend_requests")
    .select("from_username, to_username, status");
  if (frErr) throw new Error(`Supabase friend_requests: ${frErr.message}`);

  // 4. Laad shared_inbox
  const { data: allInboxRows, error: inbErr } = await supa
    .from("shared_inbox")
    .select("user_id, items");
  if (inbErr) throw new Error(`Supabase shared_inbox: ${inbErr.message}`);

  // Maak een map van user_id → username voor inbox-koppeling
  const userIdToUsername: Record<string, string> = {};
  for (const p of sbProfiles) userIdToUsername[p.id] = p.username;

  // 5. Migreer elke gebruiker naar InstantDB
  let migratedCount = 0;
  for (const sbProfile of sbProfiles) {
    const { id: supaId, username } = sbProfile;
    const userData = byUser[supaId] ?? {};

    const books = safeJson<Book[]>(userData.books, []);
    const shelves = safeJson<Shelf[]>(userData.shelves, [
      { id: "wil-ik-lezen", name: "Wil ik lezen", system: true },
      { id: "aan-het-lezen", name: "Aan het lezen", system: true },
      { id: "gelezen", name: "Gelezen", system: true },
    ]);
    const challenge = safeJson<unknown>(userData.challenge, null);
    const friends = safeJson<string[]>(userData.friends, []);
    const shelfViewSettings = safeJson<ShelfViewSettings>(userData.shelf_view_settings, {
      sortRulesByShelf: {},
      groupModeByShelf: {},
      groupSortRules: {},
    });
    const genreFetchAllowlist = safeJson<string[]>(userData.genre_fetch_allowlist, []);
    const readingPace =
      userData.reading_pace != null && Number.isFinite(Number(userData.reading_pace))
        ? Number(userData.reading_pace)
        : null;

    // Zoek of er al een InstantDB $user bestaat met dit e-mailadres
    // We gebruiken het Supabase-ID als stabiele nep-email voor matching
    const fakeEmail = `${username.toLowerCase()}@boektracker.local`;

    // Controleer of gebruiker al bestaat in InstantDB
    let existingUser: { id: string } | null = null;
    try {
      existingUser = await idb.auth.getUser({ email: fakeEmail });
    } catch {
      existingUser = null;
    }

    // Maak $user aan via createToken als hij nog niet bestaat
    let instantToken: string;
    if (!existingUser) {
      instantToken = await idb.auth.createToken(fakeEmail);
    } else {
      instantToken = await idb.auth.createToken(fakeEmail);
    }

    // Haal de gemaakte $user op om zijn InstantDB id te kennen
    const idbUser = await idb.auth.getUser({ email: fakeEmail });
    if (!idbUser?.id) {
      console.warn(`⚠️  Kon InstantDB-gebruiker niet ophalen voor ${username} — overgeslagen.`);
      continue;
    }

    const profileId = instantId();

    // Bouw de transactie op
    const txOps: ReturnType<typeof idb.tx.profiles[string]["update"]>[] = [];

    const profileData: Record<string, unknown> = {
      username,
      passwordHash: (userData.password_hash as string) ?? "",
      books,
      shelves,
      friends,
      shelfViewSettings,
      genreFetchAllowlist,
    };
    if (challenge != null) profileData.challenge = challenge;
    if (readingPace != null) profileData.readingPace = readingPace;

    txOps.push(
      idb.tx.profiles[profileId]
        .update(profileData)
        .link({ $user: idbUser.id })
    );

    await idb.transact(txOps);
    migratedCount++;
    console.log(`  ✅  ${username} gemigreerd (${books.length} boeken, ${shelves.length} planken)`);
  }

  // 6. Migreer friend_requests
  console.log(`\n🤝  Vriendschapsverzoeken migreren…`);
  let frCount = 0;
  for (const fr of allFriendReqs ?? []) {
    const frId = instantId();
    await idb.transact([
      idb.tx.friendRequests[frId].update({
        fromUsername: fr.from_username,
        toUsername: fr.to_username,
        status: fr.status,
      }),
    ]);
    frCount++;
  }
  console.log(`  ✅  ${frCount} vriendschapsverzoek(en) gemigreerd.`);

  // 7. Migreer shared_inbox
  console.log(`\n📬  Gedeelde inbox migreren…`);
  let inboxCount = 0;
  for (const row of allInboxRows ?? []) {
    const toUsername = userIdToUsername[row.user_id];
    if (!toUsername) continue;
    const items = safeJson<
      {
        from: string;
        books: unknown[];
        shelfName?: string;
        sharedAt: string;
      }[]
    >(row.items, []);

    for (const item of items) {
      const itemId = instantId();
      await idb.transact([
        idb.tx.sharedInboxItems[itemId].update({
          toUsername,
          fromUsername: item.from,
          books: item.books,
          shelfName: item.shelfName ?? null,
          sharedAt: item.sharedAt,
        }),
      ]);
      inboxCount++;
    }
  }
  console.log(`  ✅  ${inboxCount} inbox-item(s) gemigreerd.`);

  console.log(`\n🎉  Migratie voltooid! ${migratedCount}/${sbProfiles.length} gebruiker(s) gemigreerd.`);
  console.log("⚠️  Opmerking: wachtwoordhashes moeten apart gemigreerd worden (zie README).");
}

main().catch((err: unknown) => {
  console.error("❌  Migratie mislukt:", err);
  process.exit(1);
});

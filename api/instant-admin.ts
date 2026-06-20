import { init } from "@instantdb/admin";

let db: ReturnType<typeof init> | null = null;
let cachedAppId = "";

/** Lazy init zodat .env altijd geladen is (belangrijk voor lokale Vite dev). */
export function getAdminDb() {
  const appId = (process.env.INSTANT_APP_ID ?? process.env.VITE_INSTANT_APP_ID ?? "").trim();
  const adminToken = (process.env.INSTANT_ADMIN_TOKEN ?? "").trim();
  if (!appId || !adminToken) {
    throw new Error("INSTANT_APP_ID of INSTANT_ADMIN_TOKEN ontbreekt in .env");
  }
  if (!db || cachedAppId !== appId) {
    db = init({ appId, adminToken });
    cachedAppId = appId;
  }
  return db;
}

/** Reset client na verbindingsfout zodat een retry een nieuwe verbinding opent. */
export function resetAdminDb() {
  db = null;
  cachedAppId = "";
}

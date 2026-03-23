/**
 * Controleert of VITE_GOOGLE_BOOKS_API_KEY uit .env / process.env gehaald kan worden
 * (zelfde logica als vite.config.ts loadEnv). Print géén volledige key.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadEnv } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function line(label, ok, extra = "") {
  const mark = ok ? "JA" : "NEE";
  console.log(`  ${label}: ${mark}${extra ? ` ${extra}` : ""}`);
}

function checkMode(mode) {
  const env = loadEnv(mode, root, "");
  const fromFiles = (env.VITE_GOOGLE_BOOKS_API_KEY ?? "").trim();
  const fromProcess = (process.env.VITE_GOOGLE_BOOKS_API_KEY ?? "").trim();
  const effective = fromFiles || fromProcess;

  console.log(`\n--- Mode: ${mode} ---`);
  line(".env / .env.local / .env.* (via loadEnv)", fromFiles.length > 0, fromFiles ? `(lengte key ${fromFiles.length})` : "");
  line("process.env.VITE_GOOGLE_BOOKS_API_KEY (shell/CI)", fromProcess.length > 0, fromProcess ? `(lengte ${fromProcess.length})` : "");
  line("Effectief voor Vite build", effective.length > 0, effective ? `(lengte ${effective.length})` : "");

  if (!effective.length) {
    console.log(
      "\n  Tip: zet in projectroot (map met package.json) in .env exact:\n  VITE_GOOGLE_BOOKS_API_KEY=jouw_key\n  (geen spaties rond =, naam moet met VITE_ beginnen)"
    );
  }
}

console.log("Boek Tracker – Google Books env-check");
console.log("Projectroot:", root);
const envPath = join(root, ".env");
line("Bestand .env bestaat", existsSync(envPath));
line(".env.local bestaat", existsSync(join(root, ".env.local")));

if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf8");
  const hasKeyLine = /^\s*VITE_GOOGLE_BOOKS_API_KEY\s*=/m.test(raw);
  /** Regels met alleen KEY= en niets achter = (lege waarde). */
  const emptyAssignments = [...raw.matchAll(/^\s*VITE_GOOGLE_BOOKS_API_KEY\s*=\s*$/gm)];
  /** Regels met echte waarde (iets anders dan alleen whitespace na =). */
  const filledAssignments = [...raw.matchAll(/^\s*VITE_GOOGLE_BOOKS_API_KEY\s*=\s*(\S+)/gm)];

  if (!hasKeyLine) {
    console.log(
      "\n  >>> Geen regel VITE_GOOGLE_BOOKS_API_KEY=... in .env. Voeg die toe (met VITE_-prefix).\n"
    );
  } else if (emptyAssignments.length > 0 && filledAssignments.length === 0) {
    console.log(
      "\n  >>> VITE_GOOGLE_BOOKS_API_KEY staat in .env maar is overal LEEG (geen tekst achter =).\n  >>> Zet de key op dezelfde regel: VITE_GOOGLE_BOOKS_API_KEY=jouw_key\n"
    );
  } else if (emptyAssignments.length > 0 && filledAssignments.length > 0) {
    console.log(
      "\n  >>> Je hebt zowel een lege regel VITE_GOOGLE_BOOKS_API_KEY= als één met waarde.\n  >>> Verwijder de lege regel (alleen naam + =), anders raak je in de war bij check-env.\n"
    );
  }
}

checkMode("development");
checkMode("production");

console.log("\nKlaar. Start daarna `npm run dev` opnieuw.\n");

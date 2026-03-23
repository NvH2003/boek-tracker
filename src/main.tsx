import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ZoomProvider } from "./ZoomContext";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { getGoogleBooksKeyDiagnostics } from "./googleBooksBrowserKey";
import "./styles.css";

function logGoogleBooksKeyDiagnostics(reason: string) {
  const d = getGoogleBooksKeyDiagnostics();
  console.info(
    `[Boek Tracker] Google Books key (${reason})\n` +
      `  import.meta.env (VITE_GOOGLE_BOOKS_API_KEY): ${d.importMetaNonEmpty ? `ingevuld (raw lengte ${d.importMetaRawLength})` : "leeg"}\n` +
      `  Vite-injectie __BT_GOOGLE_BOOKS_KEY__: ${d.injectedNonEmpty ? `ingevuld (raw lengte ${d.injectedRawLength})` : "leeg"}\n` +
      `  Wordt gebruikt voor genres/zoeken: ${d.resolvedUsable ? "JA" : "NEE → app valt terug op Edge Function"}\n` +
      `  Geen key in bundle? Voer uit: npm run check-env`
  );
}

if (import.meta.env.DEV) {
  logGoogleBooksKeyDiagnostics("dev");
}

if (typeof window !== "undefined") {
  try {
    if (new URLSearchParams(window.location.search).get("btDebugKey") === "1") {
      logGoogleBooksKeyDiagnostics("?btDebugKey=1");
    }
  } catch {
    /* ignore */
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ZoomProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </ZoomProvider>
    </BrowserRouter>
  </React.StrictMode>
);


import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

function setZoomEnabled(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const tag = document.querySelector('meta[name="viewport"]');
  if (!tag) return;

  tag.setAttribute(
    "content",
    enabled
      ? "width=device-width, initial-scale=1.0, viewport-fit=cover"
      : "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
  );
}

// Standaard: geen zoom om per ongeluk inzoomen te voorkomen
setZoomEnabled(false);
// Maak een globale helper zodat we vanuit de UI zoom kunnen inschakelen
(window as any).btEnableZoom = () => setZoomEnabled(true);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);


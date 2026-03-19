import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ZoomProvider } from "./ZoomContext";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import "./styles.css";

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


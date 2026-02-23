import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ZoomProvider } from "./ZoomContext";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ZoomProvider>
        <App />
      </ZoomProvider>
    </BrowserRouter>
  </React.StrictMode>
);


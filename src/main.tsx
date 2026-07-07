import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider } from "./lib/auth";
import { PermissionProvider } from "./lib/permissions";
import { APP_NAME } from "./lib/branding";
import { initVersionWatcher } from "./lib/version-watcher";
import "./index.css";

// Alte HashRouter-Links (/app#/login oder /#/projekte) auf die neue, lesbare
// App-URL-Struktur umstellen. Die Landingpage selbst behandelt Root-Hashes.
if (window.location.pathname.startsWith("/app") && window.location.hash.startsWith("#/")) {
  const prettyPath = window.location.hash.slice(1);
  window.location.replace(`/app${prettyPath}`);
}

// Browser-Titel zentral aus dem (konfigurierbaren) Produktnamen setzen.
document.title = APP_NAME;

// Auto-Update: neuen Deploy automatisch erkennen und neu laden (kein manueller Reload nötig).
initVersionWatcher();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PermissionProvider>
          <BrowserRouter basename="/app">
            <App />
          </BrowserRouter>
        </PermissionProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);

import { Link, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { getCurrentUsername, clearCurrentUser, initSupabaseSession } from "./auth";
import { syncFromSupabase, pushLocalToSupabase, loadSharedInbox } from "./storage";
import { BooksPage } from "./pages/BooksPage";
import { ChallengePage } from "./pages/ChallengePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ShelvesPage } from "./pages/ShelvesPage";
import { ShelfViewPage } from "./pages/ShelfViewPage";
import { DashboardPage } from "./pages/DashboardPage";
import { BookDetailPage } from "./pages/BookDetailPage";
import { ProfilePage } from "./pages/ProfilePage";
import { BuddyReadingListPage } from "./pages/BuddyReadingListPage";
import { getBasePathFromPathname, withBase } from "./routing";

/** Oude /mobile/*-URL's doorsturen naar korte paden: /mobile/profiel → /profiel */
function RedirectMobileToRoot() {
  const location = useLocation();
  const path = location.pathname;
  const to = path === "/mobile" || path === "/mobile/" ? "/boeken" : path.replace(/^\/mobile/, "") || "/boeken";
  return <Navigate to={to} replace />;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const basePath = getBasePathFromPathname(location.pathname);
  const isMobileShell = basePath !== "/web";
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!getCurrentUsername());
  const [hasSharedInboxItems, setHasSharedInboxItems] = useState<boolean>(
    () => loadSharedInbox().length > 0
  );

  useEffect(() => {
    (async () => {
      const restored = await initSupabaseSession();
      if (restored) {
        await syncFromSupabase();
        await pushLocalToSupabase();
      }
    })();
  }, []);

  // In Capacitor: oude /mobile/*-links omzetten naar korte paden
  useEffect(() => {
    const w = window as any;
    const isCapacitor =
      !!w.Capacitor &&
      (typeof w.Capacitor.isNativePlatform === "function"
        ? w.Capacitor.isNativePlatform()
        : true);

    if (isCapacitor && location.pathname.startsWith("/mobile")) {
      const to = location.pathname.replace(/^\/mobile/, "") || "/boeken";
      navigate(to, { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    const onLogin = () => setIsLoggedIn(!!getCurrentUsername());
    window.addEventListener("bt_login", onLogin);
    return () => window.removeEventListener("bt_login", onLogin);
  }, []);

  // Luister naar wijzigingen in de gedeelde inbox (Boekbuddy deelt boeken)
  useEffect(() => {
    function updateInboxFlag() {
      setHasSharedInboxItems(loadSharedInbox().length > 0);
    }

    function onStorage(e: StorageEvent) {
      if (e.key?.startsWith("bt_shared_inbox_v1")) {
        updateInboxFlag();
      }
    }
    function onInboxUpdated() {
      updateInboxFlag();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("bt_shared_inbox_updated", onInboxUpdated as EventListener);

    // Init na eventuele Supabase-sync / localStorage-restore
    updateInboxFlag();

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bt_shared_inbox_updated", onInboxUpdated as EventListener);
    };
  }, []);

  const handleLogin = () => setIsLoggedIn(true);

  const handleLogout = () => {
    clearCurrentUser();
    setIsLoggedIn(false);
  };

  return (
    <div className={`app-root ${isMobileShell ? "app-root-mobile" : ""}`}>
      {!isMobileShell && (
        <header className="app-header">
          <div className="app-header-left">
            <span className="logo">BookFlow</span>
            {isLoggedIn && (
              <nav className="nav">
                <Link to={withBase(basePath, "/dashboard")}>Dashboard</Link>
                <Link to={withBase(basePath, "/boeken")}>Boeken</Link>
                <Link to={withBase(basePath, "/planken")}>Planken</Link>
                <Link to={withBase(basePath, "/challenge")}>Lees-challenge</Link>
              </nav>
            )}
          </div>
          <div className="app-header-right">
            {isLoggedIn ? (
              <button onClick={handleLogout} className="secondary-button">
                Uitloggen
              </button>
            ) : (
              <Link to={withBase(basePath, "/login")} className="secondary-button">
                Inloggen
              </Link>
            )}
          </div>
        </header>
      )}
      <main className="app-main">
        <Routes>
          {/* Korte URL's: /profiel, /boeken, /login, … = mobiele view */}
          <Route
            path="/"
            element={
              <Navigate to={isLoggedIn ? "/boeken" : "/login"} replace />
            }
          />
          <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="/register" element={<RegisterPage onLogin={handleLogin} />} />
          <Route
            path="/dashboard"
            element={
              isLoggedIn ? <Navigate to="/boeken" replace /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/dashboard/web"
            element={
              isLoggedIn ? <Navigate to="/boeken" replace /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/boeken"
            element={
              isLoggedIn ? <DashboardPage mode="mobile" /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/zoeken"
            element={
              isLoggedIn ? <BooksPage mode="search" /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/bibliotheek"
            element={
              isLoggedIn ? <BooksPage mode="library" /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/boek/:id"
            element={
              isLoggedIn ? <BookDetailPage /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/planken"
            element={
              isLoggedIn ? <ShelvesPage /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/plank/:shelfId"
            element={
              isLoggedIn ? <ShelfViewPage /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/boekbuddy/:username"
            element={
              isLoggedIn ? <BuddyReadingListPage /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/challenge"
            element={
              isLoggedIn ? <ChallengePage /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/profiel"
            element={
              isLoggedIn ? (
                <ProfilePage onLogout={handleLogout} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Oude /mobile/*-links → doorsturen naar korte paden */}
          <Route path="/mobile/*" element={<RedirectMobileToRoot />} />

          {/* Web app shell (expliciet pad) */}
          <Route
            path="/web"
            element={
              <Navigate to={isLoggedIn ? "/web/dashboard" : "/web/login"} replace />
            }
          />
          <Route path="/web/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="/web/register" element={<RegisterPage onLogin={handleLogin} />} />
          <Route
            path="/web/dashboard"
            element={
              isLoggedIn ? <DashboardPage mode="desktop" /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/boeken"
            element={
              isLoggedIn ? <BooksPage /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/boek/:id"
            element={
              isLoggedIn ? <BookDetailPage /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/planken"
            element={
              isLoggedIn ? <ShelvesPage /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/plank/:shelfId"
            element={
              isLoggedIn ? <ShelfViewPage /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/boekbuddy/:username"
            element={
              isLoggedIn ? <BuddyReadingListPage /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/challenge"
            element={
              isLoggedIn ? <ChallengePage /> : <Navigate to="/web/login" replace />
            }
          />
          <Route
            path="/web/profiel"
            element={
              isLoggedIn ? <ProfilePage onLogout={handleLogout} /> : <Navigate to="/web/login" replace />
            }
          />

        </Routes>
      </main>

      {isMobileShell && isLoggedIn && (
        <nav className="mobile-tabbar" aria-label="Mobiele navigatie">
          <Link
            to="/boeken"
            className={`mobile-tab ${(location.pathname.startsWith("/boeken") || location.pathname.startsWith("/boek/")) ? "active" : ""}`}
          >
            <span className="mobile-tab-icon" aria-hidden="true">📚</span>
            <span className="mobile-tab-label">Boeken</span>
          </Link>
          <Link
            to="/zoeken"
            className={`mobile-tab ${location.pathname.startsWith("/zoeken") ? "active" : ""}`}
          >
            <span className="mobile-tab-icon" aria-hidden="true">🔍</span>
            <span className="mobile-tab-label">Zoeken</span>
          </Link>
          <Link
            to="/challenge"
            className={`mobile-tab ${location.pathname.startsWith("/challenge") ? "active" : ""}`}
          >
            <span className="mobile-tab-icon" aria-hidden="true">🔥</span>
            <span className="mobile-tab-label">Lees-challenge</span>
          </Link>
          <Link
            to="/profiel"
            className={`mobile-tab ${location.pathname.startsWith("/profiel") ? "active" : ""}`}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              👤
              {hasSharedInboxItems && (
                <span className="mobile-tab-icon-badge" />
              )}
            </span>
            <span className="mobile-tab-label">Profiel</span>
          </Link>
        </nav>
      )}
    </div>
  );
}


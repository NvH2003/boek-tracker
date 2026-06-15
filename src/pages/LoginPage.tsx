import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBasePath, withBase } from "../routing";
import { verifyLogin, authDebug } from "../auth";

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const navigate = useNavigate();
  const basePath = useBasePath();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = username.trim();
    if (!trimmed) {
      setError("Vul een gebruikersnaam in.");
      return;
    }
    if (!password) {
      setError("Vul je wachtwoord in.");
      return;
    }
    setLoading(true);
    const result = await verifyLogin(trimmed, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLogin();
    const next = basePath === "/web" ? "/web/dashboard" : "/boeken";
    navigate(withBase(basePath, next), { replace: true });
  }

  return (
    <div className="page login-page">
      <h1>Inloggen</h1>
      <p className="page-intro">
        Log in met je gebruikersnaam en wachtwoord.
      </p>
      <form onSubmit={handleSubmit} className="card form-card">
        {error && <p className="form-error">{error}</p>}
        <label className="form-field">
          <span>Gebruikersnaam</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Bijv. noa"
            autoComplete="username"
          />
        </label>
        <label className="form-field">
          <span>Wachtwoord</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Wachtwoord"
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? "Bezig…" : "Inloggen"}
        </button>
        <p className="form-footer">
          Nog geen account?{" "}
          <Link to={withBase(basePath, "/register")}>Account aanmaken</Link>
        </p>
      </form>
    </div>
  );
}

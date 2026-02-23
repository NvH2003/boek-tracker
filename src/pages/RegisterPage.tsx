import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBasePath, withBase } from "../routing";
import { createAccount, setCurrentUser } from "../auth";

interface RegisterPageProps {
  onLogin?: () => void;
}

export function RegisterPage({ onLogin }: RegisterPageProps) {
  const navigate = useNavigate();
  const basePath = useBasePath();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Wachtwoord en herhaling komen niet overeen.");
      return;
    }
    setLoading(true);
    const result = await createAccount(username, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrentUser(username.trim());
    onLogin?.();
    const next = basePath === "/mobile" ? "/boeken" : "/dashboard";
    navigate(withBase(basePath, next), { replace: true });
  }

  return (
    <div className="page login-page">
      <h1>Account aanmaken</h1>
      <p className="page-intro">
        Maak een account aan met gebruikersnaam en wachtwoord. Je gegevens blijven op dit apparaat.
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
            placeholder="Min. 4 tekens"
            autoComplete="new-password"
          />
        </label>
        <label className="form-field">
          <span>Wachtwoord herhalen</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Herhaal wachtwoord"
            autoComplete="new-password"
          />
        </label>
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? "Bezig…" : "Account aanmaken"}
        </button>
        <p className="form-footer">
          Heb je al een account?{" "}
          <Link to={withBase(basePath, "/login")}>Inloggen</Link>
        </p>
      </form>
    </div>
  );
}

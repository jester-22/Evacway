import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldHalved,
  faEnvelope,
  faLock,
  faCircleNotch,
  faTriangleExclamation,
  faArrowLeft,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../../context/AuthContext";
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { user, login } = useAuth();
  const navigate = useNavigate();

  // If already authenticated, redirect straight to the appropriate page
  useEffect(() => {
    if (user) {
      if (user.role === "admin" || user.role === "lgu_personnel") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/map", { replace: true });
      }
    }
  }, [user, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const loggedUser = await login(email, password);
      if (loggedUser.role === "admin" || loggedUser.role === "lgu_personnel") {
        navigate("/dashboard");
      } else {
        navigate("/map");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <form onSubmit={handleSubmit} className="login-card ds-card">
        <div className="login-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faShieldHalved} />
        </div>
        <h2 className="login-title">EvacWay Login</h2>
        <p className="login-subtitle">Sign in to your resident, LGU personnel, or admin account.</p>

        {error && (
          <div className="login-error ds-banner ds-banner--danger" role="alert">
            <FontAwesomeIcon icon={faTriangleExclamation} className="login-error-icon" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <label className="login-label" htmlFor="login-email">Email</label>
        <div className="login-input-wrap">
          <FontAwesomeIcon icon={faEnvelope} className="login-input-icon" aria-hidden="true" />
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="login-input ds-input"
            placeholder="you@example.com"
            required
          />
        </div>

        <label className="login-label" htmlFor="login-password">Password</label>
        <div className="login-input-wrap">
          <FontAwesomeIcon icon={faLock} className="login-input-icon" aria-hidden="true" />
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input ds-input"
            placeholder="Enter password"
            required
          />
        </div>

        <button type="submit" disabled={loading} className="login-button ds-btn ds-btn--primary">
          {loading ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin className="login-loading-icon" />
              Logging in…
            </>
          ) : (
            "Log In"
          )}
        </button>

        <Link to="/" className="login-back-link ds-btn ds-btn--ghost">
          <FontAwesomeIcon icon={faArrowLeft} className="login-back-icon" aria-hidden="true" />
          Back to public map
        </Link>
      </form>
    </div>
  );
}

export default Login;
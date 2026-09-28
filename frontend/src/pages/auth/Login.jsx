import { useState } from "react";
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

  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/lgu");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <form onSubmit={handleSubmit} className="login-card">
        <div className="login-icon">
          <FontAwesomeIcon icon={faShieldHalved} />
        </div>
        <h2 className="login-title">EvacWay Login</h2>
        <p className="login-subtitle">For LGU Personnel and Admin accounts only</p>

        {error && (
          <div className="login-error">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>{error}</span>
          </div>
        )}

        <label className="login-label">Email</label>
        <div className="login-input-wrap">
          <FontAwesomeIcon icon={faEnvelope} className="login-input-icon" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="login-input"
            placeholder="you@example.com"
            required
          />
        </div>

        <label className="login-label">Password</label>
        <div className="login-input-wrap">
          <FontAwesomeIcon icon={faLock} className="login-input-icon" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input"
            placeholder="Enter password"
            required
          />
        </div>

        <button type="submit" disabled={loading} className="login-button">
          {loading ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin />
              Logging in…
            </>
          ) : (
            "Log In"
          )}
        </button>

        <Link to="/" className="login-back-link">
          <FontAwesomeIcon icon={faArrowLeft} />
          Back to public map
        </Link>
      </form>
    </div>
  );
}

export default Login;
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext"; // adjust the path to match where AuthContext lives
import "./LandingPage.css";

const MAP_KEY = [
  { id: "flood", label: "Flood-prone areas", text: "Where flooding is most likely." },
  { id: "slide", label: "Landslide-prone areas", text: "Slopes with higher landslide risk." },
  { id: "closed", label: "Closed roads", text: "Routes go around these." },
  { id: "center", label: "Evacuation centers", text: "Where you can go, with details." },
  { id: "route", label: "Safe route", text: "From your location to a center." },
];

function Logo() {
  return (
    <Link to="/" className="ew-logo" aria-label="EvacWay home">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect width="30" height="30" rx="8" fill="var(--brand)" />
        <path d="M7 22c6 0 5-9 9-9s3-4 7-4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="7" cy="22" r="2.4" fill="#fff" />
      </svg>
      EvacWay
    </Link>
  );
}

function MapArt() {
  return (
    <svg
      className="ew-mapart"
      viewBox="0 0 600 720"
      role="img"
      aria-label="Illustration of a map. A green route leads from your location, around a flood zone and a closed road, to an evacuation center."
    >
      <defs>
        <pattern id="ew-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" className="m-hatch" />
        </pattern>
      </defs>

      <rect width="600" height="720" className="m-land" />

      <path className="m-flood" d="M40 300C90 250 220 260 290 320C340 370 300 450 220 480C140 510 40 470 30 400Z" />
      <path className="m-slide" fill="url(#ew-hatch)" d="M300 50C350 25 400 40 410 90C400 135 350 150 315 125C295 105 290 70 300 50Z" />

      <g>
        <path className="m-road" d="M0 645C120 625 240 605 330 638C400 660 470 600 600 540" />
        <path className="m-road" d="M0 210C200 250 400 230 600 310" />
        <path className="m-road" d="M330 720C340 640 420 600 470 540C530 470 560 420 600 400" />
        <path className="m-road" d="M100 720C115 640 150 560 205 450" />
        <path className="m-road" d="M300 260C330 190 380 100 400 0" />
      </g>
      <path className="m-closed" d="M205 450C240 380 270 320 300 260" />

      <path className="m-route" pathLength="1" d="M110 630C220 600 330 640 410 580C470 535 505 450 500 370C495 290 485 235 480 172" />

      <text x="70" y="335" className="m-label">Flood-prone</text>
      <text x="252" y="408" className="m-label">Road closed</text>

      <g transform="translate(110 630)">
        <circle className="m-pulse" r="14" />
        <circle className="m-you" r="8" />
      </g>
      <text x="110" y="672" textAnchor="middle" className="m-label">You are here</text>

      <g className="m-center-g" transform="translate(480 150)">
        <rect x="-21" y="-21" width="42" height="42" rx="9" className="m-center" />
        <path className="m-house" d="M-10 1L0 -9L10 1M-7 -1V10H7V-1" />
        <text x="0" y="-34" textAnchor="middle" className="m-label">Evacuation center</text>
      </g>
    </svg>
  );
}

/** Sign-in dialog for LGU personnel and admins. Opens with dialogRef.current.showModal(). */
function LoginDialog({ dialogRef }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function close() {
    dialogRef.current?.close();
  }

  function handleClose() {
    setPassword("");
    setShowPassword(false);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      close();
      navigate(user.role === "admin" ? "/admin" : "/lgu");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="ew-dialog"
      aria-labelledby="ew-login-title"
      onClose={handleClose}
      onClick={(e) => e.target === dialogRef.current && close()}
    >
      <form className="ew-login" onSubmit={handleSubmit}>
        <div className="ew-login-head">
          <h2 id="ew-login-title">EvacWay login</h2>
          <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="ew-login-sub">For LGU personnel and admin accounts only.</p>

        {error && (
          <p className="ew-error" role="alert">
            {error}
          </p>
        )}

        <label className="ew-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="ew-field">
          <span>Password</span>
          <div className="ew-password">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="ew-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        <button type="submit" className="ew-btn ew-btn-primary ew-btn-block" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p className="ew-login-alt">
          Just need a route? <Link to="/map">Open the map without logging in</Link>
        </p>
      </form>
    </dialog>
  );
}

export default function LandingPage() {
  const dialogRef = useRef(null);
  const { user, logout } = useAuth();

  const openLogin = () => dialogRef.current?.showModal();

  return (
    <div className="ew">
      <header className="ew-header">
        <Logo />
        {user ? (
          <div className="ew-session">
            <span>Signed in as {user.name || user.email}</span>
            <button type="button" className="ew-btn ew-btn-quiet" onClick={logout}>
              Log out
            </button>
          </div>
        ) : (
          <button type="button" className="ew-btn ew-btn-quiet" onClick={openLogin}>
            Log in
          </button>
        )}
      </header>

      <main>
        <section className="ew-hero">
          <div className="ew-hero-copy">
            <h1>Know where to go before the water rises.</h1>
            <p className="ew-lede">
              EvacWay finds the safest route from where you are to an evacuation center in Sogod,
              Southern Leyte, and steers around closed roads.
            </p>
            <div className="ew-actions">
              <Link to="/map" className="ew-btn ew-btn-primary">
                Open the map
              </Link>
              <span className="ew-note">No account needed.</span>
            </div>
          </div>

          <div className="ew-map">
            <MapArt />
          </div>
        </section>

        <section className="ew-key" aria-labelledby="ew-key-title">
          <div className="ew-wrap">
            <h2 id="ew-key-title">Reading the map</h2>
            <dl className="ew-key-grid">
              {MAP_KEY.map((item) => (
                <div key={item.id} className="ew-key-item">
                  <span className={`ew-sw ew-sw-${item.id}`} aria-hidden="true" />
                  <dt>{item.label}</dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {!user && (
          <section className="ew-account">
            <div className="ew-wrap ew-account-inner">
              <div>
                <h2>Logging in is for LGU staff and admins.</h2>
                <p>Everyone else can open the map and get a route without an account.</p>
              </div>
              <button type="button" className="ew-btn ew-btn-outline" onClick={openLogin}>
                Log in
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="ew-footer">
        <div className="ew-wrap">
          Hazard data from HazardHunterPH. Roads from OpenStreetMap. A capstone project for Sogod, Southern Leyte.
        </div>
      </footer>

      <LoginDialog dialogRef={dialogRef} />
    </div>
  );
}
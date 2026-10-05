import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext"; // adjust the path to match where AuthContext lives
import { api } from "../services/api";
import "./LandingPage.css";
import "./LandingPage.motion.css"; // must come after LandingPage.css

const MAP_KEY = [
  { id: "flood", label: "Flood-prone areas", text: "Where flooding is most likely." },
  { id: "slide", label: "Landslide-prone areas", text: "Slopes with higher landslide risk." },
  { id: "closed", label: "Closed roads", text: "Routes go around these." },
  { id: "center", label: "Evacuation centers", text: "Where you can go, with details." },
  { id: "route", label: "Safe route", text: "From your location to a center." },
];

const RAIN = Array.from({ length: 16 }, (_, i) => ({
  x: (i * 71 + 30) % 620,
  d: `${-((i * 0.41) % 1.7).toFixed(2)}s`,
}));

const WAVE = "M-150 0q37.5 -12 75 0t75 0t75 0t75 0t75 0t75 0t75 0t75 0t75 0t75 0t75 0t75 0";

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
  const routeD = "M110 630C220 600 330 640 410 580C470 535 505 450 500 370C495 290 485 235 480 172";
  const floodD = "M40 300C90 250 220 260 290 320C340 370 300 450 220 480C140 510 40 470 30 400Z";
  return (
    <svg
      className="ew-mapart"
      viewBox="0 0 600 720"
      role="img"
      aria-label="Animated map illustration. A blue route leads from your location, around a flood zone and a closed road, to an evacuation center while rain falls."
    >
      <defs>
        <pattern id="ew-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" className="m-hatch" />
        </pattern>
        <clipPath id="ew-floodclip">
          <path d={floodD} />
        </clipPath>
        <path id="ew-route-path" d={routeD} />
      </defs>

      <rect width="600" height="720" className="m-land" />

      <path className="m-flood" d={floodD} />
      <g clipPath="url(#ew-floodclip)">
        <g className="m-ripples">
          <path d={WAVE} transform="translate(0 330)" />
          <path d={WAVE} transform="translate(-40 385)" />
          <path d={WAVE} transform="translate(-90 440)" />
        </g>
      </g>
      <path className="m-slide" fill="url(#ew-hatch)" d="M300 50C350 25 400 40 410 90C400 135 350 150 315 125C295 105 290 70 300 50Z" />

      <g>
        <path className="m-road" d="M0 645C120 625 240 605 330 638C400 660 470 600 600 540" />
        <path className="m-road" d="M0 210C200 250 400 230 600 310" />
        <path className="m-road" d="M330 720C340 640 420 600 470 540C530 470 560 420 600 400" />
        <path className="m-road" d="M100 720C115 640 150 560 205 450" />
        <path className="m-road" d="M300 260C330 190 380 100 400 0" />
      </g>
      <path className="m-closed" d="M205 450C240 380 270 320 300 260" />
      <g transform="translate(252 355)">
        <circle r="15" className="m-sign" />
        <path className="m-x" d="M-6 -6L6 6M6 -6L-6 6" />
      </g>

      <path className="m-route" pathLength="1" d={routeD} />
      <path className="m-flow" d={routeD} />

      <text x="70" y="335" className="m-label">Flood-prone</text>
      <text x="272" y="408" className="m-label">Road closed</text>

      <g transform="translate(110 630)">
        <circle className="m-pulse" r="14" />
        <circle className="m-you" r="8" />
      </g>
      <text x="110" y="672" textAnchor="middle" className="m-label">You are here</text>

      <circle className="m-walker" r="7" visibility="hidden">
        <set attributeName="visibility" to="visible" begin="2.7s" />
        <animateMotion dur="8s" begin="2.7s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
          <mpath href="#ew-route-path" />
        </animateMotion>
      </circle>

      <g className="m-center-g" transform="translate(480 150)">
        <rect x="-21" y="-21" width="42" height="42" rx="9" className="m-center" />
        <path className="m-house" d="M-10 1L0 -9L10 1M-7 -1V10H7V-1" />
        <text x="0" y="-34" textAnchor="middle" className="m-label">Evacuation center</text>
      </g>

      <g className="m-rain" aria-hidden="true">
        {RAIN.map((r, i) => (
          <line key={i} x1={r.x} y1="0" x2={r.x - 8} y2="26" style={{ "--d": r.d }} />
        ))}
      </g>
    </svg>
  );
}

function StepIcon({ kind }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      {kind === "locate" && (
        <>
          <circle className="s-pulse" cx="18" cy="18" r="9" />
          <circle cx="18" cy="18" r="6" fill="var(--brand)" stroke="#fff" strokeWidth="2" />
        </>
      )}
      {kind === "hazards" && (
        <>
          <path className="s-flood" d="M5 22C8 12 20 10 27 15C33 20 28 30 18 31C10 32 4 28 5 22Z" />
          <path d="M9 24q4-4 8 0t8 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {kind === "route" && (
        <>
          <path className="s-route" d="M6 29C14 29 12 17 20 17S24 8 30 7" />
          <circle cx="6" cy="29" r="3.5" fill="var(--brand)" />
          <rect x="26" y="3" width="8" height="8" rx="2" fill="var(--brand)" />
        </>
      )}
    </svg>
  );
}

const STEPS = [
  { kind: "locate", title: "Share your location", text: "EvacWay finds where you are on the map." },
  { kind: "hazards", title: "See what is blocked", text: "Flood and landslide areas and closed roads show up in place." },
  { kind: "route", title: "Follow the route", text: "Head along the safest route to an evacuation center." },
];

/** Sign-in dialog for LGU personnel and admins. Opens with dialogRef.current.showModal(). */
function LoginDialog({ dialogRef }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  function close() {
    dialogRef.current?.close();
  }

  function handleClose() {
    setPassword("");
    setShowPassword(false);
    setError("");
    setRecoveryMode(false);
    setRecoveryMessage("");
  }

  function openRecovery() {
    setError("");
    setRecoveryMessage("");
    setRecoveryMode(true);
  }

  async function handleRecoverySubmit(event) {
    event.preventDefault();
    setError("");
    setRecoveryMessage("");
    setRecoveryLoading(true);
    try {
      const result = await api.requestPasswordReset(email.trim());
      setRecoveryMessage(result.message || "If an account matches that email, a password reset link has been sent.");
    } catch (requestError) {
      setError(requestError.message || "Unable to request a password reset right now.");
    } finally {
      setRecoveryLoading(false);
    }
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
      <form className="ew-login" onSubmit={recoveryMode ? handleRecoverySubmit : handleSubmit}>
        <div className="ew-login-head">
          <h2 id="ew-login-title">{recoveryMode ? "Reset your password" : "EvacWay login"}</h2>
          <button type="button" className="ew-icon-btn" onClick={close} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="ew-login-sub">
          {recoveryMode
            ? "Enter the email address linked to your EvacWay account."
            : "For LGU personnel and admin accounts only."}
        </p>

        {error && (
          <p className="ew-error" role="alert">
            {error}
          </p>
        )}

        {recoveryMessage && (
          <p className="ew-recovery-message" role="status">
            {recoveryMessage}
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

        {!recoveryMode && (
          <>
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
            <p className="ew-login-help">
              <button type="button" className="ew-text-btn" onClick={openRecovery}>
                Forgot password?
              </button>
            </p>
          </>
        )}

        <button
          type="submit"
          className="ew-btn ew-btn-primary ew-btn-block"
          disabled={recoveryMode ? recoveryLoading : loading}
        >
          {recoveryMode
            ? recoveryLoading ? "Sending link…" : "Send password reset link"
            : loading ? "Logging in…" : "Log in"}
        </button>

        {recoveryMode && (
          <button
            type="button"
            className="ew-text-btn ew-recovery-back"
            onClick={() => {
              setRecoveryMode(false);
              setRecoveryMessage("");
              setError("");
            }}
          >
            Back to login
          </button>
        )}

        {!recoveryMode && (
          <p className="ew-login-alt">
            Just need a route? <Link to="/map">Open the map without logging in</Link>
          </p>
        )}
      </form>
    </dialog>
  );
}

export default function LandingPage() {
  const dialogRef = useRef(null);

  const openLogin = () => dialogRef.current?.showModal();

  return (
    <div className="ew">
      <div className="ew-stage">
        <span className="ew-cloud ew-cloud-a" aria-hidden="true" />
        <span className="ew-cloud ew-cloud-b" aria-hidden="true" />

        <header className="ew-header">
          <Logo />
          <button type="button" className="ew-btn ew-btn-quiet" onClick={openLogin}>
            Log in
          </button>
        </header>

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

          <div className="ew-map-wrap">
            <div className="ew-map">
              <MapArt />
            </div>
            <span className="ew-chip ew-chip-a" aria-hidden="true"><i />Flood risk: high</span>
            <span className="ew-chip ew-chip-b" aria-hidden="true"><i />Road closed ahead</span>
            <span className="ew-chip ew-chip-c" aria-hidden="true"><i />Route found</span>
          </div>
        </section>

        <div className="ew-waves" aria-hidden="true">
          <span className="ew-wave ew-wave-1" />
          <span className="ew-wave ew-wave-2" />
          <span className="ew-wave ew-wave-3" />
        </div>
      </div>

      <main>
        <section className="ew-steps" aria-labelledby="ew-steps-title">
          <div className="ew-wrap">
            <h2 id="ew-steps-title">Three steps to a safe route</h2>
            <ol className="ew-steps-list">
              {STEPS.map((s, i) => (
                <li key={s.kind} className="ew-step">
                  <div className="ew-step-icon">
                    <StepIcon kind={s.kind} />
                    <span className="ew-step-n">{i + 1}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
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
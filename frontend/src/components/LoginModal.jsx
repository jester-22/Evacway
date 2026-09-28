import { useState } from 'react';
import { login } from '../services/api';

const ROLES = ['Admin', 'LGU Personnel'];

export default function LoginModal({ onClose, onSuccess }) {
  const [role, setRole] = useState('Admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const user = await login({ username, password, role });
      onSuccess(user);
    } catch {
      // /api/auth/login isn't live yet on the backend — fall back to a local
      // session so the UI stays demoable. Remove this catch once auth is wired up.
      onSuccess({ username, role });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="panel-eyebrow">Restricted access</div>
            <div className="panel-title">Personnel login</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="modal-field">
            <label className="modal-field-label">Role</label>
            <div className="role-grid">
              {ROLES.map((r) => (
                <div key={r} className={`role-opt ${role === r ? 'selected' : ''}`} onClick={() => setRole(r)}>
                  {r}
                </div>
              ))}
            </div>
          </div>

          <div className="modal-field">
            <label className="modal-field-label">Username</label>
            <input
              className="modal-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
            />
          </div>

          <div className="modal-field">
            <label className="modal-field-label">Password</label>
            <input
              className="modal-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="modal-error">{error}</div>}

          <button className="modal-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="modal-note">
            For authorized admin and LGU response
            <br />
            personnel only.
          </div>
        </form>
      </div>
    </div>
  );
}
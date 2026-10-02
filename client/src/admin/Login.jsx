/**
 * -----------------------------------------------------------------------------
 *  admin/Login.jsx — the back-office door
 * -----------------------------------------------------------------------------
 *  Rate-limited server-side (5 tries / window) with lockout; this screen just
 *  reports what the API says and never leaks whether an email exists.
 * -----------------------------------------------------------------------------
 */
import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Leaf, Loader2, LockKeyhole } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { ErrorBanner } from '../components/ui';

export default function Login() {
  const { status, login } = useAdminStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (status === 'authed') return <Navigate to="/admin" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-soil-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-leaf-600 text-white">
            <Leaf size={24} aria-hidden />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-soil-900">Gramrosh back office</h1>
          <p className="mt-1 text-sm text-soil-500">Sign in to manage the store</p>
        </div>

        <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
          <ErrorBanner error={error} />
          <div>
            <label className="field-label" htmlFor="ad-email">Email</label>
            <input
              id="ad-email" type="email" required autoComplete="username"
              className="field" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@gramrosh.test"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="ad-pass">Password</label>
            <input
              id="ad-pass" type="password" required autoComplete="current-password"
              className="field" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LockKeyhole size={16} aria-hidden />}
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-soil-400">
          <Link to="/" className="font-semibold text-leaf-700 hover:underline">← Back to the storefront</Link>
        </p>
      </div>
    </div>
  );
}

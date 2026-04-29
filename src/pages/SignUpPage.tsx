import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function SignUpPage() {
  const { signUpWithPassword, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error, needsEmailConfirm } = await signUpWithPassword(email, password, displayName);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    if (needsEmailConfirm) {
      setNeedsEmailConfirm(true);
      return;
    }
    navigate('/', { replace: true });
  }

  async function onGoogle() {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error);
  }

  if (needsEmailConfirm) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 cosmic-bg starfield relative">
        <div className="relative w-full max-w-sm glass-panel p-7 text-center">
          <div className="text-3xl mb-3 text-cyan2-400" aria-hidden>✉</div>
          <h1 className="font-display tracking-[0.2em] text-base text-zinc-900 dark:text-zinc-100 uppercase">
            Check your email
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
            We sent a confirmation link to <span className="font-semibold text-zinc-900 dark:text-zinc-100">{email}</span>.
            Click it to activate your account, then come back and sign in.
          </p>
          <Link to="/sign-in" className="cosmic-button-ghost w-full text-sm mt-5 inline-flex">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 cosmic-bg starfield relative">
      <div className="relative w-full max-w-sm glass-panel p-7">
        <div className="text-center mb-6">
          <div
            className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-2xl text-white border border-cyan2-400/40"
            style={{
              background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
              boxShadow: '0 0 18px rgba(34, 211, 238, 0.4)',
            }}
            aria-hidden
          >
            ◆
          </div>
          <h1 className="font-display tracking-[0.2em] text-base text-zinc-900 dark:text-zinc-100 mt-4 uppercase">
            Create Account
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1 uppercase tracking-widest">
            Join the club
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field
            label="Display Name"
            type="text"
            value={displayName}
            onChange={setDisplayName}
            autoComplete="nickname"
            required
            minLength={1}
            maxLength={40}
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            minLength={6}
          />

          {error && (
            <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="cosmic-button w-full"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <Divider />

        <button
          type="button"
          onClick={onGoogle}
          className="cosmic-button-ghost w-full text-sm"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p className="text-xs text-zinc-500 dark:text-zinc-500 text-center mt-5">
          Already have an account?{' '}
          <Link to="/sign-in" className="text-cyan2-500 dark:text-cyan2-300 font-semibold">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="block">
      <span className="block text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-cyan2-400 focus:ring-1 focus:ring-cyan2-400/40 transition"
      />
    </label>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
      <span className="text-[10px] uppercase tracking-widest text-zinc-400">or</span>
      <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

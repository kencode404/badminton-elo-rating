import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<{ error: string | null; needsEmailConfirm: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Shared Supabase project: auth.users is shared with another app, so
  // the sign-up trigger only creates a badminton profile for sign-ups
  // tagged app=badminton. Google OAuth sign-ins and accounts that were
  // first created through the other app get their profile lazily here.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    supabase.rpc('badminton_ensure_profile').then(({ error }) => {
      if (error) console.warn('badminton_ensure_profile failed:', error.message);
    });
  }, [userId]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    // Reject banned accounts. The handshake already established a
    // session, so we have to look up the profile and force-sign-out
    // if banned. Surface the same kind of generic-feeling message as
    // a wrong-credentials failure.
    const userId = data.user?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from('badminton_profiles')
        .select('is_banned')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.is_banned) {
        await supabase.auth.signOut();
        return { error: 'Your account has been banned.' };
      }
    }
    return { error: null };
  }, []);

  const signUpWithPassword = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // `app` tags this sign-up for the shared auth.users trigger
        // (badminton_handle_new_user only creates a profile for app=badminton).
        options: { data: { display_name: displayName, app: 'badminton' } },
      });
      if (error) return { error: error.message, needsEmailConfirm: false };
      // When email confirmation is enabled (default), session is null until verified.
      const needsEmailConfirm = !data.session;
      return { error: null, needsEmailConfirm };
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signInWithPassword,
      signUpWithPassword,
      signInWithGoogle,
      signOut,
    }),
    [session, loading, signInWithPassword, signUpWithPassword, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// Watches the current user's own profile row for the is_banned flag.
// If a ban is applied while the user is signed in, force-sign-out
// instantly. Their next sign-in attempt will hit the post-handshake
// is_banned check in signInWithPassword and surface the ban message.
export function useBanWatcher() {
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (!user) return;
    let active = true;

    // Catch-up: handle the rare case where the user was banned in the
    // brief gap between session restore and now.
    supabase
      .from('badminton_profiles')
      .select('is_banned')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.is_banned) signOut();
      });

    const channel = supabase
      .channel(`profile-ban-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'badminton_profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          if (!active) return;
          const next = payload.new as { is_banned?: boolean };
          if (next.is_banned) signOut();
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user, signOut]);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center cosmic-bg">
        <div className="text-zinc-500 dark:text-zinc-400 text-sm font-display tracking-widest uppercase">
          Loading…
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

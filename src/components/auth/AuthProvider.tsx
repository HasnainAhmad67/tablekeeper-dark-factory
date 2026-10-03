"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { ReactNode } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Session provider built on the existing cookie-based browser client
 * (`@/lib/supabase/client`). The route handlers in M6 Phase 1 write the
 * session cookie, so the browser client reads it back with no extra
 * plumbing: `getUser()` resolves the current cookie on mount and
 * `onAuthStateChange` keeps `user` in sync for sign-out and cross-tab
 * changes.
 *
 * Lives in the root layout, so any screen can call `useAuth()` for
 * `user`, `loading`, and `signOut`.
 */

interface AuthContextValue {
  /** Authenticated Supabase user, or null for guests. */
  user: User | null;
  /** True until the cookie session has been resolved (or rejected). */
  loading: boolean;
  /** Clears the local session and cookie; failures stay silent by design. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signOut }),
    [user, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Session, User } from '@supabase/supabase-js';
import { supabase, getProfile, ensureProfile, type UserProfile } from '@/services/supabase';

// Warm up and complete browser auth session if redirected
WebBrowser.maybeCompleteAuthSession();
if (Platform.OS !== 'web') {
  WebBrowser.warmUpAsync();
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithPhone: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// Track processed codes to avoid duplicate/colliding exchanges across deep links
const processedAuthCodes = new Set<string>();

/** Only our own OAuth return path is treated as a sign-in link. */
function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/)[0];
  return /(^|\/)auth\/callback\/?$/.test(path);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Listen for native deep linking returns from OAuth
  useEffect(() => {
    const handleUrl = async (event: { url: string }) => {
      if (isAuthCallbackUrl(event.url)) {
        try {
          await handleAuthUrl(event.url);
        } catch (e) {
          console.warn('Deep link auth processing error:', e);
        }
      }
    };

    const sub = Linking.addEventListener('url', handleUrl);

    Linking.getInitialURL().then(async (initialUrl) => {
      if (initialUrl && isAuthCallbackUrl(initialUrl)) {
        try {
          await handleAuthUrl(initialUrl);
        } catch (e) {
          console.warn('Initial URL auth processing error:', e);
        }
      }
    });

    return () => sub.remove();
  }, []);

  async function handleAuthUrl(urlStr: string) {
    const queryIndex = urlStr.indexOf('?');
    const hashIndex = urlStr.indexOf('#');

    let queryString = '';
    let hashString = '';

    if (queryIndex !== -1) {
      queryString =
        hashIndex !== -1 && hashIndex > queryIndex
          ? urlStr.substring(queryIndex + 1, hashIndex)
          : urlStr.substring(queryIndex + 1);
    }

    if (hashIndex !== -1) {
      hashString = urlStr.substring(hashIndex + 1);
    }

    const params: Record<string, string> = {};
    if (queryString) {
      const qp = new URLSearchParams(queryString);
      qp.forEach((val, key) => {
        params[key] = val;
      });
    }
    if (hashString) {
      const hp = new URLSearchParams(hashString);
      hp.forEach((val, key) => {
        params[key] = val;
      });
    }

    if (params.error || params.error_description) {
      throw new Error(params.error_description || params.error || 'Google sign in failed');
    }

    // Only a PKCE code is accepted. Redeeming it needs the verifier this device
    // stored when it started the sign-in, so a code from a link someone else
    // crafted fails. Raw access/refresh tokens in a URL are deliberately ignored:
    // accepting them would let a malicious link log the user into an attacker's
    // account (and any money they then add would land in the attacker's wallet).
    if (params.code) {
      if (processedAuthCodes.has(params.code)) return;
      processedAuthCodes.add(params.code);

      const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) throw error;
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        setLoading(false);
        // Load profile in background without blocking the UI transition
        loadProfile(data.session.user);
      }
    }
  }

  async function loadProfile(targetUser?: User | null) {
    const u = targetUser ?? user;
    if (!u) {
      setLoading(false);
      return;
    }

    // Set optimistic profile instantly from user metadata so UI is never blocked
    const fallbackName =
      u.user_metadata?.full_name ||
      u.user_metadata?.name ||
      u.email?.split('@')[0] ||
      'Bitcoin Holder';
    const fallbackAvatar =
      u.user_metadata?.avatar_url ||
      u.user_metadata?.picture ||
      null;

    setProfile((prev) => prev ?? {
      id: u.id,
      email: u.email ?? null,
      phone: u.phone ?? null,
      full_name: fallbackName,
      avatar_url: fallbackAvatar,
      balance: 0,
      kyc_verified: false,
      created_at: u.created_at ?? new Date().toISOString(),
    });

    try {
      let p = await getProfile(u.id);

      // If profile does not exist yet (e.g. newly signed up via Google or database trigger was not executed)
      if (!p) {
        try {
          p = await ensureProfile();
        } catch (ensureErr: any) {
          if (ensureErr?.code !== 'PGRST205' && ensureErr?.code !== 'PGRST202') {
            console.warn('Profile auto-creation warning:', ensureErr);
          }
        }
      }

      if (p) {
        setProfile(p);
      }
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setLoading(false);
    }
  }

  async function signUp(email: string, password: string, fullName: string) {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    // The profile row is created server-side from the auth record (database trigger).
    // If this sign-up already has a session, make sure it exists; otherwise it is
    // created on first sign-in.
    if (data.session) {
      await ensureProfile().catch((e) => console.warn('Profile creation warning:', e));
    }
    setLoading(false);
  }

  async function signIn(email: string, password: string) {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setLoading(false);
  }

  async function signInWithGoogle() {
    setLoading(true);
    try {
      if (Platform.OS === 'web') {
        const redirectUrl =
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback`
            : undefined;

        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            queryParams: {
              prompt: 'select_account',
            },
          },
        });
        if (error) throw error;
        return;
      }

      // Native mobile platforms (iOS & Android)
      const redirectUrl = Linking.createURL('auth/callback');

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('No authorization URL returned from Supabase.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl, {
        preferEphemeralSession: false,
        showInRecents: false,
      });

      if (result.type === 'success' && result.url) {
        await handleAuthUrl(result.url);
      }
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function signInWithPhone(phone: string) {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
  }

  async function verifyOtp(phone: string, token: string) {
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw error;
    setLoading(false);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
  }

  async function refreshProfile() {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();
    if (currentUser) {
      setUser(currentUser);
      await loadProfile(currentUser);
    } else if (user) {
      await loadProfile(user);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        signUp,
        signIn,
        signInWithGoogle,
        signInWithPhone,
        verifyOtp,
        signOut,
        refreshProfile,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

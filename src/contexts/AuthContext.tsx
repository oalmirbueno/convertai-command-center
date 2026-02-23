import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "client" | "design" | "traffic" | "manager";
export type AuthState = "loading" | "authenticated" | "unauthenticated";

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  company_name?: string | null;
  avatar_url?: string | null;
  role: AppRole;
}

interface AuthContextType {
  user: UserProfile | null;
  authState: AuthState;
  loading: boolean; // alias for authState === "loading"
  login: (role: "admin" | "client") => Promise<void>;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, companyName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const DEMO_ACCOUNTS = {
  admin: { email: "admin@convertai.com", password: "admin123456", name: "Lucas Ferreira", role: "admin" as AppRole, company: null as string | null },
  client: { email: "maria@acerbi.com.br", password: "client123456", name: "Maria Acerbi", role: "client" as AppRole, company: "Acerbi Associação" },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");

  // Fetch profile from DB, with fallback to auth metadata
  async function fetchAndSetProfile(userId: string): Promise<void> {
    try {
      const [profileRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, company_name, avatar_url").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);

      if (profileRes.data) {
        const role = (rolesRes.data?.[0]?.role as AppRole) || "client";
        setUser({ ...profileRes.data, role });
        setAuthState("authenticated");
        return;
      }
    } catch (err) {
      console.error("[Auth] DB profile fetch failed:", err);
    }

    // Fallback: build profile from auth metadata
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const meta = authUser.user_metadata || {};
        setUser({
          id: authUser.id,
          full_name: meta.full_name || authUser.email?.split("@")[0] || "Usuário",
          email: authUser.email || "",
          company_name: meta.company_name || null,
          avatar_url: meta.avatar_url || null,
          role: (meta.role as AppRole) || "client",
        });
        setAuthState("authenticated");
        return;
      }
    } catch (err) {
      console.error("[Auth] getUser fallback failed:", err);
    }

    // Complete fallback
    setAuthState("unauthenticated");
  }

  useEffect(() => {
    let mounted = true;

    // Safety timeout - never stay loading more than 5 seconds
    const safetyTimeout = setTimeout(() => {
      if (mounted && authState === "loading") {
        console.warn("[Auth] Safety timeout reached");
        setAuthState("unauthenticated");
      }
    }, 5000);

    // 1. Check current session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        await fetchAndSetProfile(session.user.id);
      } else {
        setAuthState("unauthenticated");
      }
    }).catch(() => {
      if (mounted) setAuthState("unauthenticated");
    });

    // 2. Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      console.log("[Auth] Event:", event);

      if (event === "SIGNED_OUT") {
        setUser(null);
        setAuthState("unauthenticated");
      } else if (event === "SIGNED_IN" && session?.user) {
        // Use setTimeout to avoid Supabase internal deadlock
        const userId = session.user.id;
        setTimeout(() => {
          if (mounted) fetchAndSetProfile(userId);
        }, 50);
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        const userId = session.user.id;
        setTimeout(() => {
          if (mounted) fetchAndSetProfile(userId);
        }, 50);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = async (role: "admin" | "client"): Promise<void> => {
    const cred = DEMO_ACCOUNTS[role];

    // Try sign in first
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: cred.email,
      password: cred.password,
    });

    if (loginData?.user) {
      // Login succeeded - onAuthStateChange will handle profile
      return;
    }

    if (loginError?.message?.includes("Invalid login credentials")) {
      // User doesn't exist, create
      const { data: signupData, error: signupError } = await supabase.auth.signUp({
        email: cred.email,
        password: cred.password,
        options: { data: { full_name: cred.name, role: cred.role, company_name: cred.company } },
      });
      if (signupError) throw signupError;

      // Sign in after signup
      const { error: reloginError } = await supabase.auth.signInWithPassword({
        email: cred.email,
        password: cred.password,
      });
      if (reloginError) throw reloginError;
      return;
    }

    if (loginError) throw loginError;
  };

  const loginWithCredentials = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange handles setting user
  };

  const signup = async (email: string, password: string, fullName: string, companyName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: "client", company_name: companyName || null } },
    });
    if (error) throw error;

    // If auto-confirm is on, sign in immediately
    if (data?.user && !data.user.email_confirmed_at) {
      // Email confirmation required - user needs to confirm
      return;
    }

    // Try immediate login
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      // Signup worked but login failed - likely needs email confirmation
      return;
    }
    // onAuthStateChange handles setting user
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAuthState("unauthenticated");
  };

  return (
    <AuthContext.Provider value={{ user, authState, loading: authState === "loading", login, loginWithCredentials, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

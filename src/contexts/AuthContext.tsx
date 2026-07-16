import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsProfile } from "@/lib/opsSync";
import { notifyAdmin } from "@/lib/notifyHelpers";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "client" | "design" | "traffic" | "manager";

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  company_name?: string | null;
  avatar_url?: string | null;
  plan_renewal_date?: string | null;
  plan_status?: string;
  services_config?: any;
  onboarding_done?: boolean;
  role: AppRole;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, companyName?: string, phone?: string, redirectTo?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const getOrCreateProfile = useCallback(async (authUser: User): Promise<UserProfile | null> => {
    try {
      // 1. Try to fetch profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, full_name, email, company_name, avatar_url, plan_renewal_date, plan_status, services_config, onboarding_done")
        .eq("id", authUser.id)
        .maybeSingle();

      // 2. Fetch role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authUser.id)
        .maybeSingle();

      const role = (roleData?.role as AppRole) || "client";

      if (profileData) {
        return { ...profileData, role };
      }

      // 3. Profile doesn't exist (trigger may not have fired yet) - create it
      const meta = authUser.user_metadata || {};
      const newProfile = {
        id: authUser.id,
        email: authUser.email || "",
        full_name: meta.full_name || authUser.email?.split("@")[0] || "Usuário",
        company_name: meta.company_name || null,
      };

      await supabase.from("profiles").upsert(newProfile, { onConflict: "id" });

      return {
        ...newProfile,
        avatar_url: null,
        role,
      };
    } catch (err) {
      console.error("[Auth] getOrCreateProfile failed:", err);
      // Fallback: build from auth metadata so user isn't stuck
      const meta = authUser.user_metadata || {};
      return {
        id: authUser.id,
        full_name: meta.full_name || authUser.email?.split("@")[0] || "Usuário",
        email: authUser.email || "",
        company_name: meta.company_name || null,
        avatar_url: meta.avatar_url || null,
        role: "client" as AppRole,
      };
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Safety timeout
    const safetyTimer = setTimeout(() => {
      if (mounted && loading) {
        console.warn("[Auth] Safety timeout - forcing unauthenticated");
        setLoading(false);
      }
    }, 6000);

    // 1. Check existing session — force a refresh to guarantee the token is
    // signed with the current JWKS (handles signing-key rotation, which the
    // server reports as "JWT expired" even before the exp claim).
    (async () => {
      try {
        let { data: { session } } = await supabase.auth.getSession();
        if (session?.refresh_token) {
          const { data: refreshed, error: refErr } = await supabase.auth.refreshSession();
          if (refErr) {
            // Refresh token is invalid/rotated — force clean logout
            console.warn("[Auth] refresh failed, signing out:", refErr.message);
            await supabase.auth.signOut();
            if (mounted) { setUser(null); setProfile(null); setLoading(false); }
            return;
          }
          session = refreshed.session ?? session;
        }
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          const p = await getOrCreateProfile(session.user);
          if (mounted) { setProfile(p); setLoading(false); }
        } else {
          setLoading(false);
        }
      } catch (e) {
        if (mounted) setLoading(false);
      }
    })();


    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      console.log("[Auth] Event:", event);

      if (event === "SIGNED_OUT") {
        setUser(null);
        setProfile(null);
        setLoading(false);
      } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        setUser(session.user);
        const isFreshSignIn = event === "SIGNED_IN";
        // Defer profile fetch to avoid Supabase SDK deadlock
        setTimeout(async () => {
          if (!mounted) return;
          const p = await getOrCreateProfile(session.user);
          if (mounted) {
            setProfile(p);
            setLoading(false);
          }
          // Notify admin on real sign-in (not token refresh / tab focus)
          if (isFreshSignIn && p && p.role !== "admin") {
            const key = `notified_login_${session.user.id}_${new Date().toDateString()}`;
            if (!sessionStorage.getItem(key)) {
              sessionStorage.setItem(key, "1");
              const who = p.company_name || p.full_name || p.email;
              const roleLabel = p.role === "client" ? "Cliente" : "Time";
              notifyAdmin(`${roleLabel} acessou o portal: ${who}`, "system", "/clientes");
            }
          }
        }, 100);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [getOrCreateProfile]);

  const loginWithCredentials = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signup = async (email: string, password: string, fullName: string, companyName?: string, phone?: string, redirectTo?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role: "client", company_name: companyName || null },
        emailRedirectTo: redirectTo,
      },
    });
    if (error) throw error;

    // Save phone if provided
    if (data?.user && phone) {
      await supabase.from("profiles").update({ phone }).eq("id", data.user.id);
    }

    // Notifica o Ops via proxy server-to-server (evita CORS/CSP do browser)
    if (data?.user) {
      notifyOpsProfile(
        { id: data.user.id, email, full_name: fullName, company_name: companyName ?? null, phone: phone ?? null },
        { client_email: email, client_full_name: fullName, client_company: companyName ?? null, client_phone: phone ?? null }
      );
    }

    // Try immediate login (works if auto-confirm is on)
    if (data?.user) {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) {
        // Likely needs email confirmation
        return;
      }
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, loginWithCredentials, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

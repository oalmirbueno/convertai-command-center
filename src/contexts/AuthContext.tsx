import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type AppRole = "admin" | "client" | "design" | "traffic" | "manager";

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
  loading: boolean;
  login: (role: "admin" | "client") => Promise<void>;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, companyName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const DEMO_ACCOUNTS = {
  admin: { email: "admin@convertai.com", password: "admin123456", meta: { full_name: "Lucas Ferreira", role: "admin" } },
  client: { email: "maria@acerbi.com.br", password: "client123456", meta: { full_name: "Maria Acerbi", role: "client", company_name: "Acerbi Associação" } },
};

// Build profile from session user metadata - no extra DB queries needed during login
function buildProfileFromSession(session: Session): UserProfile {
  const u = session.user;
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    full_name: meta.full_name || meta.name || u.email?.split("@")[0] || "User",
    email: u.email || "",
    company_name: meta.company_name || null,
    avatar_url: meta.avatar_url || null,
    role: (meta.role as AppRole) || "client",
  };
}

// Full profile fetch from DB (used for enrichment after initial load)
async function fetchFullProfile(userId: string): Promise<UserProfile | null> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, company_name, avatar_url").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);

  if (!profileRes.data) return null;
  const role = (rolesRes.data?.[0]?.role as AppRole) || "client";
  return { ...profileRes.data, role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Enrich profile from DB in the background (non-blocking)
  const enrichProfile = (userId: string) => {
    setTimeout(async () => {
      try {
        const fullProfile = await fetchFullProfile(userId);
        if (fullProfile) {
          setUser(fullProfile);
        }
      } catch (err) {
        console.error("[Auth] Background profile enrichment failed:", err);
      }
    }, 100);
  };

  useEffect(() => {
    let mounted = true;

    // Safety timeout
    const safetyTimeout = setTimeout(() => {
      if (mounted && loading) {
        console.warn("[Auth] Safety timeout - forcing loading=false");
        setLoading(false);
      }
    }, 4000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      console.log("[Auth] onAuthStateChange:", event);

      if (session) {
        // Instantly build profile from session metadata - no DB call needed
        const profile = buildProfileFromSession(session);
        setUser(profile);
        setLoading(false);
        // Then enrich from DB in background
        enrichProfile(session.user.id);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = async (role: "admin" | "client"): Promise<void> => {
    const account = DEMO_ACCOUNTS[role];

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (signInError) {
      const { error: signUpError } = await supabase.auth.signUp({
        email: account.email,
        password: account.password,
        options: { data: account.meta },
      });
      if (signUpError) throw signUpError;

      const { data: retryData, error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (error) throw error;
    }
    // onAuthStateChange handles setting the user
  };

  const loginWithCredentials = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange handles setting the user
  };

  const signup = async (email: string, password: string, fullName: string, companyName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: "client", company_name: companyName || null } },
    });
    if (error) throw error;
    // onAuthStateChange handles setting the user
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithCredentials, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

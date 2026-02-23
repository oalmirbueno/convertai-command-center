import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

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

async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
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

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const profile = await fetchUserProfile(userId);
      setUser(profile);
    } catch (err) {
      console.error("Error fetching profile:", err);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Check initial session first
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        await loadProfile(session.user.id);
      }
      if (mounted) setLoading(false);
    });

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      console.log("Auth event:", event);
      if (event === "SIGNED_OUT") {
        setUser(null);
        setLoading(false);
      }
      // Don't handle SIGNED_IN here — we handle it in login functions directly
      // This avoids the deadlock issue with fetching during the callback
      if (event === "TOKEN_REFRESHED" && session?.user) {
        // Just refresh profile on token refresh
        setTimeout(() => {
          if (mounted) loadProfile(session.user.id);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const login = async (role: "admin" | "client"): Promise<void> => {
    const account = DEMO_ACCOUNTS[role];
    
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (signInError) {
      // User doesn't exist, sign up
      const { error: signUpError } = await supabase.auth.signUp({
        email: account.email,
        password: account.password,
        options: { data: account.meta },
      });
      if (signUpError) throw signUpError;

      const { error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (error) throw error;
    }

    // Directly fetch profile after successful login
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadProfile(session.user.id);
      
      // Update company_name if client
      if (role === "client") {
        await supabase.from("profiles").update({ company_name: "Acerbi Associação" }).eq("id", session.user.id);
      }
    }
  };

  const loginWithCredentials = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Directly fetch profile after successful login
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadProfile(session.user.id);
    }
  };

  const signup = async (email: string, password: string, fullName: string, companyName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: "client", company_name: companyName || null } },
    });
    if (error) throw error;

    // Directly fetch profile after successful signup (auto-confirm creates session)
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Small delay to let the trigger create the profile
      await new Promise(r => setTimeout(r, 500));
      await loadProfile(session.user.id);
    }
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

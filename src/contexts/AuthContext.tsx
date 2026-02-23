import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

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
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, company_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  const role = (roles?.[0]?.role as AppRole) || "client";

  return { ...profile, role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // Use setTimeout to avoid Supabase auth deadlock
        setTimeout(async () => {
          try {
            const profile = await fetchUserProfile(session.user.id);
            setUser(profile);
          } catch (err) {
            console.error("Error fetching profile:", err);
            setUser(null);
          }
          setLoading(false);
        }, 0);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    // Check initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const profile = await fetchUserProfile(session.user.id);
          setUser(profile);
        } catch (err) {
          console.error("Error fetching profile:", err);
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (role: "admin" | "client"): Promise<void> => {
    const account = DEMO_ACCOUNTS[role];
    
    // Try sign in first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (signInError) {
      // If user doesn't exist, sign up
      const { error: signUpError } = await supabase.auth.signUp({
        email: account.email,
        password: account.password,
        options: { data: account.meta },
      });

      if (signUpError) throw signUpError;

      // After signup with auto-confirm, sign in
      const { error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (error) throw error;
    }

    // Update company_name if client
    if (role === "client") {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase.from("profiles").update({ company_name: "Acerbi Associação" }).eq("id", authUser.id);
      }
    }
  };

  const loginWithCredentials = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signup = async (email: string, password: string, fullName: string, companyName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: "client", company_name: companyName || null } },
    });
    if (error) throw error;
    // Profile is created automatically by the handle_new_user trigger
    // onAuthStateChange will handle setting the user state
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

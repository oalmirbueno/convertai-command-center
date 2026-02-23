import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
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
  // Fetch profile and roles in parallel
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
  const resolvedRef = useRef(false);

  useEffect(() => {
    const resolve = (profile: UserProfile | null) => {
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        setUser(profile);
        setLoading(false);
      } else {
        // After initial resolve, still update user if profile changed
        setUser(profile);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        // setTimeout(0) prevents Supabase auth deadlock when fetching during callback
        setTimeout(async () => {
          try {
            const profile = await fetchUserProfile(session.user.id);
            resolve(profile);
          } catch (err) {
            console.error("Error fetching profile:", err);
            resolve(null);
          }
        }, 0);
      } else {
        resolve(null);
      }
    });

    // Fallback: if nothing resolves in 3s, stop loading
    const timeout = setTimeout(() => {
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        setLoading(false);
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const login = async (role: "admin" | "client"): Promise<void> => {
    const account = DEMO_ACCOUNTS[role];
    
    const { error: signInError } = await supabase.auth.signInWithPassword({
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

      const { error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (error) throw error;
    }

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
  };

  const logout = async () => {
    resolvedRef.current = false;
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

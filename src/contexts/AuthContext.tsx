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
  console.log("[Auth] Fetching profile for:", userId);
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, company_name, avatar_url").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  console.log("[Auth] Profile result:", profileRes.data, "Roles:", rolesRes.data);

  if (!profileRes.data) return null;
  const role = (rolesRes.data?.[0]?.role as AppRole) || "client";
  return { ...profileRes.data, role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    console.log("[Auth] Provider mounting, setting up auth...");

    // Safety timeout - never stay loading more than 4 seconds
    const safetyTimeout = setTimeout(() => {
      if (mounted && loading) {
        console.warn("[Auth] Safety timeout reached, forcing loading=false");
        setLoading(false);
      }
    }, 4000);

    const initAuth = async () => {
      try {
        console.log("[Auth] Getting session...");
        const { data: { session }, error } = await supabase.auth.getSession();
        console.log("[Auth] Session result:", session ? `user=${session.user.id}` : "no session", error);
        
        if (!mounted) return;
        
        if (session?.user) {
          try {
            const profile = await fetchUserProfile(session.user.id);
            if (mounted) {
              console.log("[Auth] Setting user:", profile?.full_name);
              setUser(profile);
            }
          } catch (err) {
            console.error("[Auth] Error fetching profile:", err);
            if (mounted) setUser(null);
          }
        }
      } catch (err) {
        console.error("[Auth] Error getting session:", err);
      } finally {
        if (mounted) {
          console.log("[Auth] Setting loading=false");
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[Auth] onAuthStateChange:", event);
      if (!mounted) return;
      
      if (event === "SIGNED_OUT") {
        setUser(null);
        setLoading(false);
      } else if (event === "SIGNED_IN" && session?.user) {
        // Fetch profile in next tick to avoid deadlock
        setTimeout(async () => {
          if (!mounted) return;
          try {
            const profile = await fetchUserProfile(session.user.id);
            if (mounted) {
              setUser(profile);
              setLoading(false);
            }
          } catch (err) {
            console.error("[Auth] Error in onAuthStateChange profile fetch:", err);
            if (mounted) setLoading(false);
          }
        }, 0);
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
    console.log("[Auth] Demo login:", role);
    
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (signInError) {
      console.log("[Auth] SignIn failed, trying signup...");
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

    // Fetch profile directly - don't rely on onAuthStateChange
    console.log("[Auth] Login succeeded, fetching profile directly...");
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const profile = await fetchUserProfile(session.user.id);
      console.log("[Auth] Direct profile fetch result:", profile?.full_name);
      setUser(profile);
      
      if (role === "client") {
        await supabase.from("profiles").update({ company_name: "Acerbi Associação" }).eq("id", session.user.id);
      }
    }
  };

  const loginWithCredentials = async (email: string, password: string) => {
    console.log("[Auth] Credentials login:", email);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Fetch profile directly
    console.log("[Auth] Login succeeded, fetching profile directly...");
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const profile = await fetchUserProfile(session.user.id);
      console.log("[Auth] Direct profile fetch result:", profile?.full_name);
      setUser(profile);
    }
  };

  const signup = async (email: string, password: string, fullName: string, companyName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: "client", company_name: companyName || null } },
    });
    if (error) throw error;

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await new Promise(r => setTimeout(r, 500));
      const profile = await fetchUserProfile(session.user.id);
      setUser(profile);
    }
  };

  const logout = async () => {
    console.log("[Auth] Logging out...");
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

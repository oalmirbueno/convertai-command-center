import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsProfile } from "@/lib/opsSync";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { safeSessionStorage } from "@/lib/safeStorage";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { AuthError, User } from "@supabase/supabase-js";

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
  /**
   * Há usuário logado mas o perfil/papel dele NÃO veio do servidor depois
   * das tentativas. Quem lê isto mostra uma tela de "não conseguimos
   * carregar" com botão de tentar de novo, em vez de abrir o painel com a
   * identidade errada.
   */
  profileError: boolean;
  retryProfile: () => Promise<void>;
  loginWithCredentials: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, companyName?: string, phone?: string, redirectTo?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Quantas vezes o perfil e o papel são buscados antes de desistir. */
const PROFILE_MAX_ATTEMPTS = 3;
/** Espera entre tentativas: 500 ms, 1 s, 2 s. */
const profileBackoffMs = (attempt: number) => 500 * Math.pow(2, attempt - 1);

/**
 * A recarga da sessão falhou por REDE (sem internet, servidor fora, fetch
 * abortado) ou por token inválido de verdade? Só o segundo caso justifica
 * derrubar a pessoa. O primeiro era o defeito: cliente abria o painel no
 * elevador e era deslogado por falta de sinal.
 */
function isNetworkAuthError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  // Depois do type guard o TS estreita para never; lê como objeto solto.
  const plain = error as { name?: string; message?: string };
  if (plain.name === "AuthRetryableFetchError") return true;
  return /fetch|network|load failed|timeout/i.test(plain.message || "");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Espelho do perfil para decisões fora do ciclo de render (callbacks). */
  const profileRef = useRef<UserProfile | null>(null);
  /**
   * A sessao ja deu resposta (havendo usuario ou nao)?
   *
   * Fica em ref, e nao em estado, porque quem le e um setTimeout criado uma
   * vez: estado lido de dentro dele chega congelado no valor do primeiro
   * render, que foi exatamente o defeito que existia aqui.
   */
  const sessaoRespondeu = useRef(false);

  /**
   * Busca perfil e papel. Devolve null quando o servidor NÃO respondeu depois
   * de todas as tentativas: quem chama decide entre manter o perfil anterior
   * ou mostrar o erro. Nunca inventa um papel: antes, qualquer erro de
   * consulta caía no padrão "client", e o dono via a tela de cliente.
   */
  const getOrCreateProfile = useCallback(async (authUser: User): Promise<UserProfile | null> => {
    for (let attempt = 1; attempt <= PROFILE_MAX_ATTEMPTS; attempt++) {
      try {
        // Perfil e papel JUNTOS, não um depois do outro.
        //
        // As duas consultas são independentes, e em sequência somavam duas idas
        // ao servidor antes de qualquer coisa aparecer na tela. Em conexão com
        // meio segundo de latência isso é um segundo inteiro de tela parada, e
        // é o tipo de espera que faz o painel "demorar para abrir" sem que
        // nenhuma consulta esteja lenta.
        const [
          { data: profileData, error: profileQueryError },
          { data: roleData, error: roleQueryError },
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, company_name, avatar_url, plan_renewal_date, plan_status, services_config, onboarding_done")
            .eq("id", authUser.id)
            .maybeSingle(),
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", authUser.id)
            .maybeSingle(),
        ]);

        // Erro em qualquer uma das duas é motivo para tentar de novo. Papel
        // ausente SEM erro (nenhuma linha em user_roles) é cliente de verdade.
        if (profileQueryError || roleQueryError) {
          throw profileQueryError || roleQueryError;
        }

        const role = (roleData?.role as AppRole) || "client";

        if (profileData) {
          return { ...profileData, role };
        }

        // Perfil ainda não existe (o gatilho pode não ter rodado): cria.
        const meta = authUser.user_metadata || {};
        const newProfile = {
          id: authUser.id,
          email: authUser.email || "",
          full_name: meta.full_name || authUser.email?.split("@")[0] || "Usuário",
          company_name: meta.company_name || null,
        };

        const { error: upsertError } = await supabase.from("profiles").upsert(newProfile, { onConflict: "id" });
        if (upsertError) {
          // O papel já é conhecido; o perfil mínimo serve até o gatilho criar
          // a linha. Não vale deixar a pessoa presa por causa do upsert.
          console.warn("[Auth] upsert do perfil falhou; seguindo com o mínimo:", upsertError.message);
        }

        return {
          ...newProfile,
          avatar_url: null,
          role,
        };
      } catch (err) {
        console.error(`[Auth] perfil/papel falhou (tentativa ${attempt}/${PROFILE_MAX_ATTEMPTS}):`, err);
        if (attempt < PROFILE_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, profileBackoffMs(attempt)));
        }
      }
    }
    return null;
  }, []);

  /**
   * Entrega o resultado da busca de perfil ao estado. Sem resultado, o perfil
   * anterior (se houver) continua valendo; sem perfil nenhum, sobe o erro.
   * Em nenhum caso a tela abre com papel inventado.
   */
  const deliverProfile = useCallback((next: UserProfile | null) => {
    if (next) {
      // Mesmo perfil de antes (volta para a aba do navegador dispara SIGNED_IN
      // de novo): mantém o objeto, senão toda tela que depende do perfil
      // recomeçava como se o painel tivesse reiniciado (24/09/2026).
      const igual = !!profileRef.current && JSON.stringify(profileRef.current) === JSON.stringify(next);
      if (!igual) {
        profileRef.current = next;
        setProfile(next);
      }
      setProfileError(false);
    } else if (!profileRef.current) {
      setProfileError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    /**
     * Rede de segurança: se a checagem de sessão travar, o painel não pode
     * ficar preso na tela de carregando para sempre.
     *
     * DOIS DEFEITOS CONSERTADOS AQUI, e os dois só apareciam em conexão lenta:
     *
     * 1. A condição era `if (mounted && loading)`, e `loading` vinha CONGELADO
     *    do primeiro render (a dependência do efeito é getOrCreateProfile).
     *    Valia `true` para sempre, então o desligamento acontecia SEMPRE aos
     *    6 segundos, mesmo com tudo já resolvido.
     * 2. Pior: quando o perfil ainda estava vindo, desligar o "carregando"
     *    fazia o app renderizar com perfil NULO. Papel nulo cai no padrão de
     *    cliente, e o dono via a tela de cliente, com as telas internas
     *    redirecionando de volta. Parecia que o painel tinha quebrado.
     *
     * Agora quem manda é um sinal explícito de "a sessão respondeu". Enquanto
     * há um usuário e o perfil dele está a caminho, a espera continua: melhor
     * carregar mais um instante do que abrir com a identidade errada.
     */
    const safetyTimer = setTimeout(() => {
      if (!mounted || sessaoRespondeu.current) return;
      console.warn("[Auth] Sessão não respondeu a tempo; seguindo sem autenticar");
      setLoading(false);
    }, 8000);

    // 1. Check existing session — force a refresh to guarantee the token is
    // signed with the current JWKS (handles signing-key rotation, which the
    // server reports as "JWT expired" even before the exp claim).
    (async () => {
      try {
        let { data: { session } } = await supabase.auth.getSession();
        if (session?.refresh_token) {
          const { data: refreshed, error: refErr } = await supabase.auth.refreshSession();
          if (refErr && isNetworkAuthError(refErr)) {
            // Sem rede ou servidor fora: a sessão local continua valendo. O
            // SDK tenta de novo sozinho quando a conexão volta. Deslogar aqui
            // era o defeito: cliente sem sinal por um segundo perdia o acesso.
            console.warn("[Auth] refresh sem rede; mantendo a sessão local:", refErr.message);
          } else if (refErr) {
            // Refresh token inválido ou já rotacionado: saída limpa.
            console.warn("[Auth] refresh failed, signing out:", refErr.message);
            sessaoRespondeu.current = true;
            await supabase.auth.signOut();
            if (mounted) { setUser(null); setProfile(null); profileRef.current = null; setLoading(false); }
            return;
          } else {
            session = refreshed.session ?? session;
          }
        }
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          // A sessao respondeu: daqui para frente a espera e pelo PERFIL, e
          // essa vale a pena esperar. Abrir sem ele mostraria a tela errada.
          sessaoRespondeu.current = true;
          const p = await getOrCreateProfile(session.user);
          if (mounted) deliverProfile(p);
        } else {
          sessaoRespondeu.current = true;
          setLoading(false);
        }
      } catch (e) {
        sessaoRespondeu.current = true;
        if (mounted) setLoading(false);
      }
    })();


    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      console.log("[Auth] Event:", event);

      if (event === "SIGNED_OUT") {
        sessaoRespondeu.current = true;
        setUser(null);
        setProfile(null);
        profileRef.current = null;
        setProfileError(false);
        setLoading(false);
      } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        // A sessão respondeu por aqui: daqui para frente a espera é pelo
        // perfil. Sem isso, o relógio de segurança soltava a tela com usuário
        // e sem papel quando a renovação da abertura passava de 8 s, e a
        // /mesa caía no /dashboard.
        sessaoRespondeu.current = true;
        // Mesmo usuário (só o token renovou ou a aba voltou ao foco): mantém o
        // objeto para as telas não recomeçarem.
        setUser((anterior) =>
          anterior && anterior.id === session.user.id && anterior.updated_at === session.user.updated_at && anterior.email === session.user.email
            ? anterior
            : session.user,
        );
        const isFreshSignIn = event === "SIGNED_IN";
        // Defer profile fetch to avoid Supabase SDK deadlock
        setTimeout(async () => {
          if (!mounted) return;
          const p = await getOrCreateProfile(session.user);
          if (mounted) deliverProfile(p);
          // Notify admin on real sign-in (not token refresh / tab focus)
          if (isFreshSignIn && p && p.role !== "admin") {
            // Trava por aba. O sessionStorage pode LANÇAR (Safari privado,
            // painel dentro de outro app); o helper cai numa memória da aba
            // e o aviso continua saindo uma vez só.
            const key = `notified_login_${session.user.id}_${new Date().toDateString()}`;
            if (!safeSessionStorage.get(key)) {
              safeSessionStorage.set(key, "1");
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
  }, [getOrCreateProfile, deliverProfile]);

  /** Botão "tentar de novo" da tela de erro de perfil. */
  const retryProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const current = session?.user;
    if (!current) return;
    setProfileError(false);
    setLoading(true);
    const p = await getOrCreateProfile(current);
    deliverProfile(p);
  }, [getOrCreateProfile, deliverProfile]);

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
    profileRef.current = null;
    setProfileError(false);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, profileError, retryProfile, loginWithCredentials, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

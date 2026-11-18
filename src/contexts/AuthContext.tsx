import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { safeSessionStorage, safeStorage } from "@/lib/safeStorage";
import { definirAutoMiniaturas, definirDonoDasUrls } from "@/lib/miniaturas";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import {
  esquecerTokensMortos,
  lerSessaoGuardada,
  sessaoEstaViva,
  tokenAindaVale,
  type SessaoGuardada,
} from "@/integrations/supabase/renovacaoSegura";

export type AppRole = "admin" | "client" | "design" | "traffic" | "manager" | "member";

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
 * A leitura da sessão falhou por algo PASSAGEIRO (sem internet, servidor fora,
 * fetch abortado, trava do login ocupada por outra aba) ou por token inválido
 * de verdade? Só o segundo caso pode tirar a pessoa do painel, e mesmo assim
 * só depois de reler o storage. O primeiro era o defeito: cliente abria o
 * painel no elevador e era deslogado por falta de sinal.
 */
function ehFalhaPassageira(error: unknown): boolean {
  if (!error) return false;
  const plain = error as { name?: string; message?: string; isAcquireTimeout?: boolean };
  // Trava do login ocupada (travaDoLogin.ts): a renovação fica para a próxima volta.
  if (plain.isAcquireTimeout === true) return true;
  if (isAuthRetryableFetchError(error)) return true;
  if (plain.name === "AuthRetryableFetchError" || plain.name === "AbortError") return true;
  return /fetch|network|load failed|timeout|timed out/i.test(plain.message || "");
}

/** Sessão gravada no storage do login, lida sem a trava (só leitura). */
function sessaoDoStorage(): Promise<SessaoGuardada | null> {
  const auth = supabase.auth as unknown as { storage?: { getItem: (k: string) => string | null | Promise<string | null> }; storageKey?: string };
  return lerSessaoGuardada(auth.storage, auth.storageKey || "");
}

/**
 * Sai SÓ deste navegador. A conta é compartilhada (iPhone do dono, Windows,
 * agentes); o signOut sem scope do supabase-js é "global" e derrubaria todos.
 */
async function sairSoDesteNavegador(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.warn("[Auth] signOut local falhou:", e);
  }
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
  /** Usuário atual, para decidir fora do render (evento SIGNED_OUT). */
  const userIdRef = useRef<string | null>(null);
  /** O botão sair está rodando: o SIGNED_OUT dele é de verdade, não precisa reler o storage. */
  const saindoDeProposito = useRef(false);

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
        // ausente SEM erro: identidade de membros, sem acesso operacional.
        if (profileQueryError || roleQueryError) {
          throw profileQueryError || roleQueryError;
        }

        const role = (roleData?.role as AppRole) || "member";

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
      // Equipe grava as miniaturas que faltam das imagens que abre (cota de transformação, 26/09).
      definirAutoMiniaturas(["admin","design","traffic","manager"].includes(next.role), next.role === "admin");
      // Dica do papel para o próximo boot baixar a tela certa junto com o login
      // (src/lib/preCargaDoBoot.ts). Só escolhe o download; a tela continua
      // decidida por este perfil, vindo do servidor.
      safeStorage.set(`aceleriq:papel:${next.id}`, next.role);
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

    // 1. Sessão existente. SÓ lê: o getSession() já renova sozinho (com a
    // trava) quando faltam menos de 90 s, e o autoRefreshToken cuida do resto.
    //
    // 14/11: aqui havia um refreshSession() forçado em TODA abertura, mesmo
    // com token válido ("por precaução de JWKS"). Várias abas e agentes no
    // mesmo perfil renovavam o mesmo token ao mesmo tempo; com a rotação de
    // refresh token ligada, a sessão caía. Não volte a forçar renovação aqui.
    (async () => {
      try {
        let session: { user: User } | null = null;
        let falha: unknown = null;
        try {
          const { data, error } = await supabase.auth.getSession();
          session = data.session?.user ? { user: data.session.user } : null;
          falha = error;
        } catch (e) {
          falha = e;
        }

        if (!session && falha) {
          // Antes de qualquer decisão, relê o storage: outra aba pode ter gravado um token novo.
          const guardada = await sessaoDoStorage();
          const viva = !!guardada?.user && sessaoEstaViva(guardada);
          if (ehFalhaPassageira(falha)) {
            // Sem rede, servidor fora, lento ou trava ocupada: a sessão local
            // continua valendo e o SDK tenta de novo sozinho. Nunca desloga aqui.
            if (viva && tokenAindaVale(guardada, 0)) {
              session = { user: guardada!.user as unknown as User };
            } else {
              console.warn("[Auth] sessão ainda não renovou (passageiro); mantendo a guardada:", (falha as Error)?.message);
            }
          } else if (viva) {
            // Token recusado era velho; o storage já tem outro, vivo.
            console.warn("[Auth] renovação recusada, mas o storage tem sessão nova; seguindo com ela.");
            session = { user: guardada!.user as unknown as User };
          } else {
            // Token morto e storage morto: sai só deste navegador.
            console.warn("[Auth] sessão morta no servidor e no storage; saindo só deste navegador:", (falha as Error)?.message);
            sessaoRespondeu.current = true;
            await sairSoDesteNavegador();
            if (mounted) { setUser(null); setProfile(null); profileRef.current = null; userIdRef.current = null; setLoading(false); }
            return;
          }
        }
        if (!mounted) return;
        if (session?.user) {
          // A sessao respondeu: daqui para frente a espera e pelo PERFIL, e
          // essa vale a pena esperar. Abrir sem ele mostraria a tela errada.
          sessaoRespondeu.current = true;
          userIdRef.current = session.user.id;
          setUser(session.user);
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
        const limpar = () => {
          definirAutoMiniaturas(false);
          // Nenhuma URL assinada nesta sessão passa para a próxima (miniaturas.ts e fileUrls.ts).
          definirDonoDasUrls(null);
          userIdRef.current = null;
          setUser(null);
          setProfile(null);
          profileRef.current = null;
          setProfileError(false);
          setLoading(false);
        };
        if (saindoDeProposito.current) {
          limpar();
          return;
        }
        // Não foi o botão sair: pode ser o supabase-js largando um token velho
        // ou o aviso de outra aba. Relê o storage antes de mandar para o login
        // (fora do callback, que roda dentro da trava do login).
        setTimeout(async () => {
          if (!mounted) return;
          const guardada = await sessaoDoStorage();
          if (guardada?.user && sessaoEstaViva(guardada) && guardada.user.id === userIdRef.current) {
            console.warn("[Auth] SIGNED_OUT com sessão viva no storage; mantendo a pessoa no painel.");
            return;
          }
          if (mounted) limpar();
        }, 0);
      } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        // A sessão respondeu por aqui: daqui para frente a espera é pelo
        // perfil. Sem isso, o relógio de segurança soltava a tela com usuário
        // e sem papel quando a renovação da abertura passava de 8 s, e a
        // /mesa caía no /dashboard.
        sessaoRespondeu.current = true;
        definirDonoDasUrls(session.user.id);
        userIdRef.current = session.user.id;
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
          if (isFreshSignIn && p && p.role !== "admin" && p.role !== "member") {
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
        data: { full_name: fullName, company_name: companyName || null },
        emailRedirectTo: redirectTo,
      },
    });
    if (error) throw error;

    // Save phone if provided
    if (data?.user && phone) {
      await supabase.from("profiles").update({ phone }).eq("id", data.user.id);
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
    // scope "local": várias pessoas e agentes usam a MESMA conta (iPhone do
    // dono, Chrome no Windows, app Claude, agentes). Sair aqui encerra só a
    // sessão deste navegador; as abas dele saem juntas porque dividem o mesmo
    // storage. O padrão do supabase-js ("global") mataria as sessões de todos.
    saindoDeProposito.current = true;
    esquecerTokensMortos();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      saindoDeProposito.current = false;
      definirAutoMiniaturas(false);
      definirDonoDasUrls(null);
      userIdRef.current = null;
      setUser(null);
      setProfile(null);
      profileRef.current = null;
      setProfileError(false);
    }
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

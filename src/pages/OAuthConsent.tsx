import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { Carregando, botao, etiqueta, juntar, texto } from "@/components/sistema";
import CascaPublica from "@/components/publico/CascaPublica";
import { describeScope } from "@/lib/mcp-scopes";

type OAuthClient = {
  name?: string;
  client_name?: string;
  redirect_uri?: string;
  scope?: string;
};

type AuthorizationDetails = {
  client?: OAuthClient;
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const { user, loading: authLoading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Qual authorization_id já foi buscado.
   *
   * `getAuthorizationDetails` é de uso único: a segunda chamada com o mesmo
   * id volta "authorization request cannot be processed". E o efeito abaixo
   * depende de `user`, que ganha identidade NOVA a cada evento de sessão do
   * Supabase (INITIAL_SESSION, TOKEN_REFRESHED) — então ele reexecutava
   * sozinho e queimava a autorização, com a tela de erro no lugar do
   * consentimento. Este ref prende a busca a uma vez por id.
   */
  const buscado = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!authorizationId) {
      setError("Parâmetro authorization_id ausente.");
      return;
    }
    if (!user) {
      const next = window.location.pathname + window.location.search;
      window.location.href = "/login?next=" + encodeURIComponent(next);
      return;
    }
    if (buscado.current === authorizationId) return;
    buscado.current = authorizationId;
    let active = true;
    (async () => {
      try {
        // beta helper — chamamos via any porque ainda não está tipado no SDK
        const oauth = (supabase.auth as any).oauth;
        if (!oauth?.getAuthorizationDetails) {
          setError("OAuth SDK indisponível nesta versão do cliente.");
          return;
        }
        const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message || "Falha ao obter detalhes da autorização.");
          return;
        }
        const redir = data?.redirect_url ?? data?.redirect_to;
        if (redir && !data?.client) {
          window.location.href = redir;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        setError(e?.message ?? "Erro inesperado.");
      }
    })();
    return () => { active = false; };
  }, [authorizationId, user, authLoading]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const oauth = (supabase.auth as any).oauth;
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (error) { setError(error.message); setBusy(false); return; }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) { setError("O servidor de autorização não retornou redirect."); setBusy(false); return; }
      window.location.href = target;
    } catch (e: any) {
      setError(e?.message ?? "Erro ao concluir autorização.");
      setBusy(false);
    }
  }

  if (authLoading || (!details && !error)) {
    return (
      <CascaPublica titulo="Conectar aplicativo" descricao="Buscando o pedido de conexão..." largura="media">
        <Carregando linhas={3} rotulo="Buscando o pedido de conexão" />
      </CascaPublica>
    );
  }

  if (error) {
    // Sem isto a tela era um beco sem saída: o pedido de autorização
    // vale uma vez só e expira, e quem chega aqui precisa recomeçar
    // pelo aplicativo, não recarregar esta página.
    return (
      <CascaPublica
        titulo="Autorização indisponível"
        descricao="Cada pedido de conexão vale uma vez e expira em minutos. Volte ao aplicativo (ChatGPT, Claude ou outro) e comece a conexão de novo."
        largura="media"
      >
        <p className={juntar(texto.auxiliar, "leading-5 [overflow-wrap:anywhere]")}>
          Recarregar esta página não resolve, porque o pedido antigo já foi usado. Detalhe: {error}
        </p>
      </CascaPublica>
    );
  }

  const clientName = details?.client?.name || details?.client?.client_name || "aplicativo externo";
  const scopes = details?.scopes ?? (details?.client?.scope?.split(/\s+/).filter(Boolean) ?? []);

  return (
    <CascaPublica
      titulo={`Conectar ${clientName}`}
      descricao="Conexão exclusiva da equipe interna da Aceleriq."
      ajuda="O aplicativo poderá ler ou atualizar dados operacionais conforme as permissões verificadas pelo servidor."
      largura="media"
    >
      <p className={juntar(texto.corpo, "flex min-w-0 items-center text-muted-foreground")}>
        <ShieldCheck className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 truncate">Conectado como <b className="font-medium text-foreground">{user?.email}</b></span>
      </p>

      {scopes.length > 0 && (
        <section className="mt-6 min-w-0" aria-label="Permissões pedidas">
          <h2 className={texto.rotulo}>Permissões pedidas</h2>
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {scopes.map((s) => {
              const info = describeScope(s);
              return (
                <li key={s} className="flex min-w-0 items-start py-3">
                  {info.sensitive ? (
                    <AlertTriangle className="mr-3 mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Permissão sensível" />
                  ) : (
                    <ShieldCheck className="mr-3 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center">
                      <span className={juntar(texto.corpo, "mr-2 font-medium")}>{info.title}</span>
                      <span className={juntar(etiqueta, "max-w-full truncate bg-muted font-mono text-muted-foreground")}>{s}</span>
                    </div>
                    <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{info.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-0 sm:[&>*+*]:ml-2">
        <button type="button" className={botao.secundario} disabled={busy} onClick={() => decide(false)}>
          Cancelar
        </button>
        <button type="button" className={botao.primario} disabled={busy} onClick={() => decide(true)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Autorizando" /> : "Autorizar"}
        </button>
      </div>
    </CascaPublica>
  );
}

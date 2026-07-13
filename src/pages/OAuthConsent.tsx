import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, X, AlertTriangle } from "lucide-react";
import aceleriqLogo from "@/assets/logo-aceleriq.png";
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border bg-card p-8 text-center space-y-3">
          <X className="h-8 w-8 mx-auto text-destructive" />
          <h1 className="text-lg font-semibold">Autorização indisponível</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const clientName = details?.client?.name || details?.client?.client_name || "aplicativo externo";
  const scopes = details?.scopes ?? (details?.client?.scope?.split(/\s+/).filter(Boolean) ?? []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-2xl border bg-card shadow-xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <img src={aceleriqLogo} alt="Aceleriq" className="h-10 w-auto" />
          <div className="text-xs text-muted-foreground">Aceleriq OS · MCP</div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold leading-tight">
            Conectar <span className="text-primary">{clientName}</span> à sua conta
          </h1>
          <p className="text-sm text-muted-foreground">
            Este aplicativo poderá usar as ferramentas MCP do Aceleriq OS agindo em seu nome
            enquanto você estiver conectado. Isso não ignora RLS nem políticas do backend.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>Conectado como <b>{user?.email}</b></span>
        </div>

        {scopes.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Permissões solicitadas
            </div>
            <ul className="space-y-2">
              {scopes.map((s) => {
                const info = describeScope(s);
                return (
                  <li key={s} className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
                    {info.sensitive ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500 shrink-0" />
                    ) : (
                      <ShieldCheck className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-tight">
                        {info.title}
                        <span className="ml-2 rounded bg-background border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {s}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{info.description}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
            Cancelar
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Autorizar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

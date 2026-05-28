import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

type State =
  | { kind: "loading" }
  | { kind: "valid" }
  | { kind: "already" }
  | { kind: "invalid" }
  | { kind: "confirming" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } },
        );
        const data = await res.json();
        if (res.ok && data.valid) setState({ kind: "valid" });
        else if (data?.reason === "already_unsubscribed") setState({ kind: "already" });
        else setState({ kind: "invalid" });
      } catch {
        setState({ kind: "invalid" });
      }
    })();
  }, [token]);

  const confirm = async () => {
    setState({ kind: "confirming" });
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
      body: { token },
    });
    if (error) return setState({ kind: "error", message: error.message });
    if ((data as any)?.success) setState({ kind: "done" });
    else if ((data as any)?.reason === "already_unsubscribed") setState({ kind: "already" });
    else setState({ kind: "error", message: "Não foi possível processar." });
  };

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <img src={aceleriqLogo} alt="AcelerIQ" className="h-16 w-auto mx-auto mb-8" />
        <div className="rounded-2xl border border-border bg-card p-8">
          {state.kind === "loading" && (
            <p className="text-muted-foreground text-sm">Validando link…</p>
          )}
          {state.kind === "valid" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Cancelar inscrição</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Você deixará de receber e-mails do portal AcelerIQ neste endereço.
              </p>
              <Button onClick={confirm} className="w-full">Confirmar cancelamento</Button>
            </>
          )}
          {state.kind === "confirming" && (
            <p className="text-muted-foreground text-sm">Processando…</p>
          )}
          {state.kind === "done" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Inscrição cancelada</h1>
              <p className="text-sm text-muted-foreground">
                Pronto. Você não receberá mais e-mails neste endereço.
              </p>
            </>
          )}
          {state.kind === "already" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Já cancelado</h1>
              <p className="text-sm text-muted-foreground">
                Este endereço já está fora da lista de envios.
              </p>
            </>
          )}
          {state.kind === "invalid" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Link inválido</h1>
              <p className="text-sm text-muted-foreground">
                O link expirou ou não é mais válido.
              </p>
            </>
          )}
          {state.kind === "error" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Erro</h1>
              <p className="text-sm text-muted-foreground">{state.message}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

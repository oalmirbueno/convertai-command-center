import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { botao } from "@/components/sistema";
import CascaPublica from "@/components/publico/CascaPublica";

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

/** Título e uma linha por estado. Validar e confirmar usam o mesmo título: nada pula. */
function textoDoEstado(state: State): { titulo: string; descricao: string } {
  switch (state.kind) {
    case "loading":
      return { titulo: "Cancelar inscrição", descricao: "Validando o link..." };
    case "valid":
    case "confirming":
      return { titulo: "Cancelar inscrição", descricao: "Você deixará de receber e-mails do portal Aceleriq neste endereço." };
    case "done":
      return { titulo: "Inscrição cancelada", descricao: "Você não receberá mais e-mails neste endereço." };
    case "already":
      return { titulo: "Já cancelado", descricao: "Este endereço já está fora da lista de envios." };
    case "invalid":
      return { titulo: "Link inválido", descricao: "O link expirou ou não é mais válido." };
    case "error":
      return { titulo: "Não foi possível cancelar", descricao: state.message };
  }
}

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

  const { titulo, descricao } = textoDoEstado(state);
  const confirmando = state.kind === "confirming";

  return (
    <CascaPublica titulo={titulo} descricao={descricao}>
      {(state.kind === "valid" || confirmando) && (
        <div>
          <button type="button" onClick={confirm} disabled={confirmando} className={botao.primario}>
            {confirmando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {confirmando ? "Processando..." : "Confirmar cancelamento"}
          </button>
        </div>
      )}
    </CascaPublica>
  );
}

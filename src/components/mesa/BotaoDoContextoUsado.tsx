import { Suspense, lazy, useState } from "react";
import { Layers } from "lucide-react";
import { botao, juntar } from "@/components/sistema/estilos";

const JanelaDoContextoUsado = lazy(() => import("./JanelaDoContextoUsado"));

/**
 * "O que os agentes leem" (frente SYNC, 30/09/2026): um ícone discreto na
 * casca de cada mesa. Abre numa janela central a linha "Usando: contexto da
 * marca X, briefing de dd/mm, estratégia v3..." da marca aberta. A janela
 * (e a leitura) só carregam quando abre. Sem cliente, não aparece.
 */
export default function BotaoDoContextoUsado({ clientId, marcaId = null, className = "" }: { clientId: string | null | undefined; marcaId?: string | null; className?: string }) {
  const [aberto, setAberto] = useState(false);
  if (!clientId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={juntar(botao.icone, className)}
        aria-label="O que os agentes leem da marca"
        title="O que os agentes leem da marca"
        data-contexto-usado=""
      >
        <Layers className="h-4 w-4" aria-hidden="true" />
      </button>
      {aberto && (
        <Suspense fallback={null}>
          <JanelaDoContextoUsado clientId={clientId} marcaId={marcaId} onClose={() => setAberto(false)} />
        </Suspense>
      )}
    </>
  );
}

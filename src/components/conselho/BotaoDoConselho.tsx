import { lazy, Suspense, useState } from "react";
import { Users } from "lucide-react";
import { botao, juntar } from "@/components/sistema/estilos";

const SalaDoConselho = lazy(() => import("./SalaDoConselho"));

/**
 * Botão do Conselho (frente CNS, 30/09): abre a Sala do Conselho de qualquer
 * mesa, com o tema pré-preenchido pelo que a tela mostra. A Sala só baixa no
 * primeiro clique (nada pesado na abertura da mesa).
 *
 * Uso: <BotaoDoConselho clientId={...} origem="mesa-roteiros" tema="Roteiro: ..." referencia={{ tipo: "roteiro", id }} onUsar={(t) => ...} />
 */
export default function BotaoDoConselho({
  clientId,
  origem,
  tema,
  contexto,
  referencia,
  onUsar,
  rotuloDoUsar,
  className = "",
}: {
  clientId: string;
  origem: string;
  tema: string;
  contexto?: string;
  referencia?: Record<string, unknown> | null;
  onUsar?: (texto: string) => void;
  rotuloDoUsar?: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [usado, setUsado] = useState(false);
  if (!clientId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUsado(true);
          setAberto(true);
        }}
        aria-label="Conselho de agentes"
        title="Conselho de agentes"
        className={juntar(botao.barra, className)}
        data-botao-do-conselho={origem}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="ml-1 hidden xl:inline">Conselho</span>
      </button>
      {usado && (
        <Suspense fallback={null}>
          <SalaDoConselho
            aberto={aberto}
            onFechar={() => setAberto(false)}
            clientId={clientId}
            origem={origem}
            tema={tema}
            contexto={contexto}
            referencia={referencia}
            onUsar={onUsar}
            rotuloDoUsar={rotuloDoUsar}
          />
        </Suspense>
      )}
    </>
  );
}

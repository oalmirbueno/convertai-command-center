import { Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar } from "@/components/sistema/estilos";
import { lazyComPreCarga, moduloPronto } from "@/lib/lazyComPreCarga";

// A Sala (e o formulário de convocar, que vem no mesmo pedaço) baixa no
// mouse em cima, no foco ou no toque; o clique só abre.
const SalaDoConselho = lazyComPreCarga("conselho:sala", () => import("./SalaDoConselho"));

/**
 * Botão do Conselho (frente CNS, 30/09): abre a Sala do Conselho de qualquer
 * mesa, com o tema pré-preenchido pelo que a tela mostra. Nada pesado na
 * abertura da mesa: a Sala e o catálogo do conselho só são pedidos quando a
 * pessoa passa o mouse, foca ou toca no botão (frente UXS, CNS-05). Enquanto
 * baixa, o ícone gira no próprio botão; se falhar, avisa e nada quebra.
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
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [usado, setUsado] = useState(false);
  const [baixando, setBaixando] = useState(false);
  if (!clientId) return null;

  const preCarregar = () => {
    SalaDoConselho.preCarregar().catch(() => undefined);
    // Import dinâmico: a api do conselho não entra no pedaço das mesas. Mesma chave do ConvocarConselho.
    import("@/lib/conselho/api")
      .then((m) =>
        qc.prefetchQuery({
          queryKey: ["conselho", "catalogo", origem],
          queryFn: () => m.lerCatalogoDoConselho(origem),
          staleTime: 10 * 60_000,
          gcTime: 10 * 60_000,
        }),
      )
      .catch(() => undefined);
  };

  const abrir = () => {
    if (moduloPronto(SalaDoConselho.chave)) {
      setUsado(true);
      setAberto(true);
      return;
    }
    if (baixando) return;
    setBaixando(true);
    preCarregar();
    SalaDoConselho.preCarregar()
      .then(
        () => {
          setUsado(true);
          setAberto(true);
        },
        () => toast.error("O conselho não abriu. Tente de novo."),
      )
      .finally(() => setBaixando(false));
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        onMouseEnter={preCarregar}
        onFocus={preCarregar}
        onTouchStart={preCarregar}
        aria-label="Conselho de agentes"
        aria-busy={baixando || undefined}
        title="Conselho de agentes"
        className={juntar(botao.barra, className)}
        data-botao-do-conselho={origem}
      >
        {baixando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Users className="h-3.5 w-3.5" aria-hidden="true" />}
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

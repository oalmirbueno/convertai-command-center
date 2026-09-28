import { useCallback, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { faixaDoScore } from "./contextoDoCliente";

/**
 * Grupos recolhíveis da aba Contexto (pedido do dono em 23/09: "muito
 * solta, tudo misturado"). Cada hub tem título, uma linha de resumo, o score
 * dele e as ações à direita; aberto, mostra o conteúdo com rolagem própria
 * quando a lista é longa (só no computador; no celular a página rola normal).
 * Quais hubs ficam abertos é lembrado no navegador, por cliente quando a tela
 * passa o `escopo` (só conveniência de quem usa; sem armazenamento, volta ao
 * padrão). Cliente sem escolha guardada herda a escolha antiga, sem cliente.
 */

const CHAVE_DOS_HUBS = "mesa:contexto:hubs";

export type HubsAbertos = Record<string, boolean>;

const chaveDosHubs = (escopo?: string) => (escopo ? `${CHAVE_DOS_HUBS}:${escopo}` : CHAVE_DOS_HUBS);

function lerHubs(escopo?: string): HubsAbertos {
  try {
    const bruto = window.localStorage.getItem(chaveDosHubs(escopo)) || (escopo ? window.localStorage.getItem(CHAVE_DOS_HUBS) : null);
    if (!bruto) return {};
    const v = JSON.parse(bruto);
    if (!v || typeof v !== "object") return {};
    const saida: HubsAbertos = {};
    for (const k of Object.keys(v)) if (typeof v[k] === "boolean") saida[k] = v[k];
    return saida;
  } catch {
    return {};
  }
}

function gravarHubs(h: HubsAbertos, escopo?: string) {
  try {
    window.localStorage.setItem(chaveDosHubs(escopo), JSON.stringify(h));
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}

/** Estado aberto/fechado dos hubs, com o padrão de cada um. `escopo`: o cliente (lembra por cliente). */
export function useHubsAbertos(padrao: HubsAbertos, escopo?: string) {
  const [estado, setEstado] = useState<{ escopo?: string; salvos: HubsAbertos }>(() => ({ escopo, salvos: lerHubs(escopo) }));
  // Trocou de cliente sem desmontar: lê o que está guardado para o novo.
  const salvos = estado.escopo === escopo ? estado.salvos : lerHubs(escopo);
  if (estado.escopo !== escopo) setEstado({ escopo, salvos });
  const aberto = useCallback((id: string) => (id in salvos ? salvos[id] : !!padrao[id]), [salvos, padrao]);
  const definir = useCallback(
    (id: string, valor: boolean) => {
      // Relê o guardado antes de gravar: a aba tem mais de um grupo de hubs
      // (coluna principal e "Editar em detalhe") escrevendo na mesma chave.
      setEstado((e) => {
        const base = e.escopo === escopo ? e.salvos : {};
        const novo = { ...base, ...lerHubs(escopo), [id]: valor };
        gravarHubs(novo, escopo);
        return { escopo, salvos: novo };
      });
    },
    [escopo],
  );
  const alternar = useCallback((id: string) => definir(id, !aberto(id)), [aberto, definir]);
  return { aberto, definir, alternar };
}

const COR_DA_FAIXA = {
  baixo: { texto: "text-destructive", barra: "bg-destructive", fundo: "bg-destructive/10" },
  medio: { texto: "text-foreground", barra: "bg-warning", fundo: "bg-warning/15" },
  bom: { texto: "text-foreground", barra: "bg-success", fundo: "bg-success/15" },
};

/** Selo pequeno com o score (0 a 100). */
export function SeloDoScore({ score, rotulo = "Score", className = "" }: { score: number | null; rotulo?: string; className?: string }) {
  if (score === null) {
    return <span className={`inline-block h-5 w-10 animate-pulse rounded-full bg-muted ${className}`} aria-hidden="true" />;
  }
  const cor = COR_DA_FAIXA[faixaDoScore(score)];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${cor.fundo} ${cor.texto}`}
      title={`${rotulo}: ${score} de 100`}
      aria-label={`${rotulo}: ${score} de 100`}
    >
      {score}
    </span>
  );
}

/** Barra fina do score, para dentro do hub. */
export function BarraDoScore({ score }: { score: number }) {
  const cor = COR_DA_FAIXA[faixaDoScore(score)];
  return (
    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
      <div className={`h-full rounded-full transition-all ${cor.barra}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}

export function Hub({
  id,
  titulo,
  resumo,
  score,
  aberto,
  onAlternar,
  acao,
  children,
  rolagem = false,
}: {
  id?: string;
  titulo: string;
  resumo?: ReactNode;
  /** Score do hub; undefined esconde o selo, null mostra o esqueleto. */
  score?: number | null;
  aberto: boolean;
  onAlternar: () => void;
  acao?: ReactNode;
  children: ReactNode;
  /** Conteúdo com altura máxima e rolagem própria (listas longas). */
  rolagem?: boolean;
}) {
  const corpo = id ? `${id}-corpo` : undefined;
  // Sistema de design (docs/design/SISTEMA.md): sem caixa. Os hubs formam uma
  // lista separada por linhas finas; aberto, o conteúdo fica alinhado com o
  // título, sem outra borda em volta.
  return (
    <section id={id} className="min-w-0 scroll-mt-28 border-t border-border md:scroll-mt-40 lg:scroll-mt-4" data-hub="">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={aberto}
          aria-controls={corpo}
          className="-mx-2 flex min-w-0 flex-1 items-center rounded-md px-2 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={`mr-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "" : "-rotate-90"}`} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center">
              <span className="truncate text-[15px] font-semibold leading-[22px] text-foreground">{titulo}</span>
              {score !== undefined && <SeloDoScore score={score} rotulo={`Score de ${titulo.toLowerCase()}`} className="ml-2" />}
            </span>
            {resumo && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{resumo}</span>}
          </span>
        </button>
        {acao && <div className="ml-2 flex shrink-0 items-center">{acao}</div>}
      </div>
      {aberto && (
        <div id={corpo} className="min-w-0 pb-5 pt-1 sm:pl-[26px]">
          {rolagem ? (
            <RegiaoRolavel className="-mr-1.5 pr-1.5 lg:max-h-[70vh]">
              {children}
            </RegiaoRolavel>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

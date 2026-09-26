import { useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { foco, juntar } from "./estilos";

/**
 * Seletor compacto (docs/design/SISTEMA.md, "Navegação secundária e filtros").
 *
 * Dono, 26/09: "Biblioteca, Modelos, Clones viram um seletor; na Biblioteca,
 * prompts, referências, produto, alimento, serviço... viram um seletor em vez
 * de um monte de botões."
 *
 * - Até 4 opções: controle segmentado (uma faixa com as opções lado a lado),
 *   role tablist/tab com aria-selected. Setas andam entre as opções.
 * - Mais de 4: um botão com ícone e a opção escolhida que abre a lista
 *   (listbox). Setas andam, Enter escolhe, Esc fecha.
 * `modo` força um dos dois quando a tela pede.
 * `listaQuandoNaoCabe`: o segmentado vira lista sozinho quando não cabe na
 * largura (algum rótulo cortado ou a faixa passando da borda), medido antes
 * da pintura (nada pisca). Ao alargar a janela, tenta o segmentado de novo.
 * Substitui o "useEstreito / useLargura640" que cada tela repetia.
 */

function larguraDaJanela(): number {
  if (typeof window === "undefined") return 1024;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1024;
}

export interface OpcaoCompacta {
  valor: string;
  rotulo: string;
  icone?: ReactNode;
  /** Número pequeno ao lado (itens, pendências). */
  contador?: number | null;
  /** Uma linha de apoio na lista (só no modo lista). */
  descricao?: string;
  desativada?: boolean;
}

export default function SeletorCompacto({
  opcoes,
  valor,
  onEscolher,
  rotulo,
  icone,
  modo,
  listaQuandoNaoCabe = false,
  larguraTotal = false,
  className = "",
}: {
  opcoes: OpcaoCompacta[];
  valor: string;
  onEscolher: (valor: string) => void;
  /** Nome do seletor para leitor de tela (e prefixo no botão do modo lista). */
  rotulo: string;
  /** Ícone do botão no modo lista. */
  icone?: ReactNode;
  modo?: "segmentado" | "lista";
  /** O segmentado vira lista sozinho quando não cabe. */
  listaQuandoNaoCabe?: boolean;
  /** Segmentado ocupando a largura toda (celular). */
  larguraTotal?: boolean;
  className?: string;
}) {
  // Largura da janela em que o segmentado não coube (null = cabe).
  const [naoCoubeEm, setNaoCoubeEm] = useState<number | null>(null);
  const pedida = modo || (opcoes.length <= 4 ? "segmentado" : "lista");
  const qual = pedida === "segmentado" && listaQuandoNaoCabe && naoCoubeEm !== null ? "lista" : pedida;
  const faixa = useRef<HTMLDivElement>(null);
  const [, remedir] = useReducer((n: number) => n + 1, 0);
  const medirSegmentado = listaQuandoNaoCabe && qual === "segmentado";
  // Antes da pintura: rótulo cortado ou faixa passando da borda = não cabe.
  useLayoutEffect(() => {
    const el = faixa.current;
    if (!medirSegmentado || !el) return;
    let cortado = el.scrollWidth > el.clientWidth + 1;
    if (!cortado) {
      const rotulos = el.querySelectorAll("[data-rotulo-da-opcao]");
      for (let i = 0; i < rotulos.length; i += 1) {
        const r = rotulos[i] as HTMLElement;
        if (r.scrollWidth > r.clientWidth + 1) {
          cortado = true;
          break;
        }
      }
    }
    if (!cortado && typeof el.getBoundingClientRect === "function") {
      const caixa = el.getBoundingClientRect();
      if (caixa.width > 0 && caixa.right > larguraDaJanela() + 1) cortado = true;
    }
    if (cortado) setNaoCoubeEm(larguraDaJanela());
  });
  // Janela mudou: segmentado mede de novo; lista tenta voltar quando a janela alarga.
  useEffect(() => {
    if (!listaQuandoNaoCabe) return;
    const aoMudar = () => {
      if (naoCoubeEm === null) remedir();
      else if (larguraDaJanela() > naoCoubeEm) setNaoCoubeEm(null);
    };
    window.addEventListener("resize", aoMudar);
    window.addEventListener("orientationchange", aoMudar);
    return () => {
      window.removeEventListener("resize", aoMudar);
      window.removeEventListener("orientationchange", aoMudar);
    };
  }, [listaQuandoNaoCabe, naoCoubeEm]);
  const [aberto, setAberto] = useState(false);
  const lista = useRef<HTMLUListElement>(null);
  const escolhida = opcoes.find((o) => o.valor === valor) || null;

  const andar = (e: KeyboardEvent<HTMLElement>, seletor: string, horizontal: boolean) => {
    const proxima = horizontal ? "ArrowRight" : "ArrowDown";
    const anterior = horizontal ? "ArrowLeft" : "ArrowUp";
    if (e.key !== proxima && e.key !== anterior && e.key !== "Home" && e.key !== "End") return;
    const itens = Array.prototype.slice.call(e.currentTarget.querySelectorAll(seletor)) as HTMLElement[];
    if (!itens.length) return;
    e.preventDefault();
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : e.key === proxima ? (i + 1) % itens.length : (i - 1 + itens.length) % itens.length;
    itens[n].focus();
  };

  if (qual === "segmentado") {
    return (
      <div
        ref={faixa}
        role="tablist"
        aria-label={rotulo}
        onKeyDown={(e) => andar(e, '[role="tab"]:not([disabled])', true)}
        className={juntar("inline-flex h-9 min-w-0 max-w-full items-center rounded-md bg-muted p-0.5", larguraTotal && "flex w-full", className)}
        data-seletor-compacto="segmentado"
      >
        {opcoes.map((o, i) => {
          const ativa = o.valor === valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="tab"
              aria-selected={ativa}
              tabIndex={ativa || (!escolhida && i === 0) ? 0 : -1}
              disabled={o.desativada}
              onClick={() => onEscolher(o.valor)}
              className={juntar(
                "toque-compacto inline-flex h-8 min-w-0 items-center justify-center whitespace-nowrap rounded px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50",
                larguraTotal && "flex-1",
                ativa ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                foco,
              )}
            >
              {o.icone && <span className="mr-1.5 inline-flex shrink-0" aria-hidden="true">{o.icone}</span>}
              <span className="truncate" data-rotulo-da-opcao="">{o.rotulo}</span>
              {typeof o.contador === "number" && <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{o.contador}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-label={`${rotulo}: ${escolhida ? escolhida.rotulo : "escolher"}`}
          className={juntar(
            "toque-compacto inline-flex h-9 min-w-0 max-w-full items-center rounded-md border border-border bg-transparent px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted",
            aberto && "bg-muted",
            foco,
            className,
          )}
          data-seletor-compacto="lista"
        >
          {(icone || (escolhida && escolhida.icone)) && (
            <span className="mr-1.5 inline-flex shrink-0 text-muted-foreground" aria-hidden="true">
              {escolhida && escolhida.icone ? escolhida.icone : icone}
            </span>
          )}
          <span className="truncate">{escolhida ? escolhida.rotulo : rotulo}</span>
          {escolhida && typeof escolhida.contador === "number" && <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{escolhida.contador}</span>}
          <ChevronDown className={juntar("ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[calc(100vw-24px)] max-w-[300px] p-1"
        onOpenAutoFocus={(e) => {
          const alvo = lista.current ? ((lista.current.querySelector('[aria-selected="true"]') || lista.current.querySelector('[role="option"]')) as HTMLElement | null) : null;
          if (alvo) {
            e.preventDefault();
            alvo.focus();
          }
        }}
      >
        <ul ref={lista} role="listbox" aria-label={rotulo} onKeyDown={(e) => andar(e, '[role="option"]:not([aria-disabled="true"])', false)} className="max-h-[60vh] overflow-y-auto overscroll-contain">
          {opcoes.map((o) => {
            const ativa = o.valor === valor;
            return (
              <li
                key={o.valor}
                role="option"
                aria-selected={ativa}
                aria-disabled={o.desativada || undefined}
                tabIndex={-1}
                onClick={() => {
                  if (o.desativada) return;
                  setAberto(false);
                  onEscolher(o.valor);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !o.desativada) {
                    e.preventDefault();
                    setAberto(false);
                    onEscolher(o.valor);
                  }
                }}
                className={juntar(
                  "flex min-w-0 cursor-pointer items-center rounded px-2 py-1.5 text-[13px] outline-none transition-colors hover:bg-muted focus:bg-muted",
                  ativa ? "text-foreground" : "text-foreground/90",
                  o.desativada && "cursor-not-allowed opacity-50",
                )}
              >
                {o.icone && <span className="mr-2 inline-flex shrink-0 text-muted-foreground" aria-hidden="true">{o.icone}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.rotulo}</span>
                  {o.descricao && <span className="block truncate text-[11.5px] text-muted-foreground">{o.descricao}</span>}
                </span>
                {typeof o.contador === "number" && <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{o.contador}</span>}
                {ativa && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

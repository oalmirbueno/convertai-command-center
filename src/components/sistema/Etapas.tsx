import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { foco, juntar } from "./estilos";

/**
 * Etapas (ou abas) padronizadas: uma linha de botões com sublinhado verde na
 * aberta. Nunca corta o texto: se não couber (celular, mesa com muitas
 * etapas), a linha rola para o lado e a aberta fica sempre à vista.
 *
 * É um `<nav>` com aria-label (as mesas medem o cabeçalho por ele) e cada
 * etapa é um botão com aria-current="page" na aberta. Setas esquerda e
 * direita andam entre as etapas; Home e End vão às pontas.
 */

export interface ItemDeEtapa {
  valor: string;
  rotulo: string;
  /** Dica curta no title (a linha de ajuda longa fica fora da barra). */
  dica?: string;
  /** Número pequeno ao lado (pendências, itens). */
  contador?: number | null;
  /** Destaque de "próximo passo" (texto verde). */
  destaque?: boolean;
  /** Ícone opcional antes do rótulo. */
  icone?: ReactNode;
  /** Atributos extras (data-*) para testes e medições. */
  dados?: Record<string, string>;
  /**
   * Etapa feita (UXS 30/09): um check pequeno no lugar do número (mesma
   * largura), e o leitor de tela ouve "concluída".
   */
  feita?: boolean;
  /**
   * Etapa que ainda não abre: apagada e com aria-disabled, mas SEM disabled
   * (o clique continua chegando, para a tela explicar por que não abre) e
   * ainda na navegação por setas.
   */
  fechada?: boolean;
}

export default function Etapas({
  itens,
  valor,
  onEscolher,
  rotulo,
  numerar = false,
  className = "",
  depois,
}: {
  itens: ItemDeEtapa[];
  /** A etapa aberta; null quando nenhuma (ex.: um painel lateral aberto). */
  valor: string | null;
  onEscolher: (valor: string) => void;
  /** aria-label do nav (ex.: "Etapas da Mesa"). */
  rotulo: string;
  /** Mostra 1, 2, 3 antes do rótulo (fluxo em sequência). */
  numerar?: boolean;
  className?: string;
  /** Conteúdo depois das etapas, na mesma linha (ferramentas de apoio). */
  depois?: ReactNode;
}) {
  const trilho = useRef<HTMLDivElement>(null);

  // A aberta sempre à vista quando a linha rola (sem mexer na rolagem da página).
  useEffect(() => {
    const el = trilho.current;
    if (!el) return;
    const ativo = el.querySelector('[aria-current="page"]') as HTMLElement | null;
    if (!ativo) return;
    const esquerda = ativo.offsetLeft;
    const direita = esquerda + ativo.offsetWidth;
    if (esquerda < el.scrollLeft) el.scrollLeft = Math.max(0, esquerda - 16);
    else if (direita > el.scrollLeft + el.clientWidth) el.scrollLeft = direita - el.clientWidth + 16;
  }, [valor]);

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const botoes = Array.prototype.slice.call(e.currentTarget.querySelectorAll("button[data-etapa]")) as HTMLButtonElement[];
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || botoes.length === 0) return;
    e.preventDefault();
    let proximo = i;
    if (e.key === "ArrowRight") proximo = (i + 1) % botoes.length;
    else if (e.key === "ArrowLeft") proximo = (i - 1 + botoes.length) % botoes.length;
    else if (e.key === "Home") proximo = 0;
    else proximo = botoes.length - 1;
    botoes[proximo].focus();
  };

  return (
    <nav aria-label={rotulo} className={juntar("min-w-0", className)}>
      <div ref={trilho} onKeyDown={teclas} className="scrollbar-hidden flex min-w-0 items-center overflow-x-auto overscroll-x-contain">
        {itens.map((item, i) => {
          const aberta = valor === item.valor;
          return (
            <button
              key={item.valor}
              type="button"
              data-etapa={item.valor}
              onClick={() => onEscolher(item.valor)}
              aria-current={aberta ? "page" : undefined}
              aria-disabled={item.fechada && !aberta ? "true" : undefined}
              title={item.dica}
              {...(item.dados || {})}
              className={juntar(
                "toque-compacto relative inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors sm:px-3",
                foco,
                aberta ? "text-foreground" : item.fechada ? "text-muted-foreground/60 hover:bg-muted/60" : item.destaque ? "text-primary hover:bg-muted/60" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {numerar && !item.feita && <span className={juntar("mr-1.5 text-[11px] tabular-nums", aberta ? "text-primary" : "text-muted-foreground/70")}>{i + 1}</span>}
              {item.feita && (
                <span className={juntar("mr-1.5 inline-flex w-3 shrink-0 justify-center", aberta ? "text-primary" : "text-muted-foreground")} aria-hidden="true" data-etapa-feita="">
                  <Check className="h-3 w-3" />
                </span>
              )}
              {item.icone && <span className="mr-1.5 inline-flex shrink-0" aria-hidden="true">{item.icone}</span>}
              {item.rotulo}
              {item.feita && <span className="sr-only">, concluída</span>}
              {typeof item.contador === "number" && item.contador > 0 && (
                <span className="ml-1.5 rounded bg-muted px-1 text-[10.5px] font-semibold leading-4 tabular-nums text-foreground">{item.contador}</span>
              )}
              {aberta && <span aria-hidden="true" className="absolute bottom-0 left-2.5 right-2.5 h-0.5 rounded-full bg-primary sm:left-3 sm:right-3" />}
            </button>
          );
        })}
        {depois}
      </div>
    </nav>
  );
}

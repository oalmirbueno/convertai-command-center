import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import JanelaDoCelular from "./JanelaDoCelular";
import MenuMais, { type ItemDoMenu } from "./MenuMais";
import { botao, juntar, rolagem } from "./estilos";

/** Abaixo disto os filtros recolhidos abrem numa gaveta (JanelaDoCelular); acima, num popover. */
const LARGURA_DA_GAVETA = 768;

function larguraDaJanela(): number {
  if (typeof window === "undefined") return 1024;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1024;
}

/**
 * Barra de controles (docs/design/SISTEMA.md 4.2 e seção 15): no máximo DUAS
 * linhas organizadas, nunca uma terceira, nunca perde função.
 *
 * - Linha 1: `inicio` (a busca, cresce e encolhe), `acoes` à direita (um
 *   primário no máximo) e o "..." (`mais`) no fim. Nunca quebra.
 * - Linha 2: `filtros`, numa faixa só.
 * - Se a linha 2 não couber (ou `recolherFiltros="sempre"`), ela sai da tela e
 *   vira o botão "Filtros (n)" na linha 1, que abre os mesmos filtros num
 *   popover no computador e numa gaveta no celular. Medido antes da pintura,
 *   como o SeletorCompacto: nada pisca. Ao alargar a janela, tenta de novo.
 *
 * Espaço por margem (Safari 11 não tem gap em flex).
 */
export default function BarraDeControles({
  rotulo,
  inicio,
  acoes,
  filtros,
  mais,
  filtrosAtivos = 0,
  rotuloDosFiltros = "Filtros",
  recolherFiltros = "quando-nao-cabe",
  lateral = "auto",
  aoLimparFiltros,
  className = "",
}: {
  /** Nome do grupo para leitor de tela ("Filtros do calendário"). */
  rotulo: string;
  /** Linha 1, à esquerda: a busca ou o seletor principal. */
  inicio?: ReactNode;
  /** Linha 1, à direita: as ações (um primário no máximo). */
  acoes?: ReactNode;
  /** Linha 2: os filtros. Não couberam, vão para "Filtros (n)". */
  filtros?: ReactNode;
  /** O "..." no fim da linha 1: o secundário (exportar, sincronizar, arquivar). */
  mais?: Array<ItemDoMenu | false | null | undefined>;
  /** Quantos filtros estão ligados (contador do botão "Filtros"). */
  filtrosAtivos?: number;
  rotuloDosFiltros?: string;
  /** "sempre": os filtros ficam sempre no botão (tela muito cheia). */
  recolherFiltros?: "quando-nao-cabe" | "sempre";
  /** Onde os filtros recolhidos abrem: popover no computador e gaveta no celular (auto). */
  lateral?: "auto" | "popover" | "gaveta";
  /** "Limpar filtros" no pé do popover e da gaveta. */
  aoLimparFiltros?: () => void;
  className?: string;
}) {
  // Largura da janela em que a linha 2 não coube (null = cabe).
  const [naoCoubeEm, setNaoCoubeEm] = useState<number | null>(null);
  const [largura, setLargura] = useState(larguraDaJanela);
  const [aberto, setAberto] = useState(false);
  const [, remedir] = useReducer((n: number) => n + 1, 0);
  const faixa = useRef<HTMLDivElement>(null);
  const recolhidos = !!filtros && (recolherFiltros === "sempre" || naoCoubeEm !== null);

  // Antes da pintura: a faixa dos filtros passou da própria largura ou da borda da janela.
  useLayoutEffect(() => {
    const el = faixa.current;
    if (!el || recolhidos) return;
    let naoCabe = el.scrollWidth > el.clientWidth + 1;
    if (!naoCabe && typeof el.getBoundingClientRect === "function") {
      const caixa = el.getBoundingClientRect();
      if (caixa.width > 0 && caixa.right > larguraDaJanela() + 1) naoCabe = true;
      // O último filtro passou da faixa (a faixa não corta: o anel de foco fica inteiro).
      const ultimo = el.lastElementChild as HTMLElement | null;
      if (!naoCabe && ultimo && caixa.width > 0 && ultimo.getBoundingClientRect().right > caixa.right + 1) naoCabe = true;
    }
    if (naoCabe) setNaoCoubeEm(larguraDaJanela());
  });

  useEffect(() => {
    const aoMudar = () => {
      const agora = larguraDaJanela();
      setLargura(agora);
      if (naoCoubeEm === null) remedir();
      else if (agora > naoCoubeEm) setNaoCoubeEm(null);
    };
    window.addEventListener("resize", aoMudar);
    window.addEventListener("orientationchange", aoMudar);
    return () => {
      window.removeEventListener("resize", aoMudar);
      window.removeEventListener("orientationchange", aoMudar);
    };
  }, [naoCoubeEm]);

  // Os filtros voltaram para a barra: fecha o que estava aberto.
  useEffect(() => {
    if (!recolhidos && aberto) setAberto(false);
  }, [recolhidos, aberto]);

  const naGaveta = lateral === "gaveta" || (lateral === "auto" && largura < LARGURA_DA_GAVETA);
  const nomeDoBotao = filtrosAtivos > 0 ? `${rotuloDosFiltros} (${filtrosAtivos})` : rotuloDosFiltros;

  const botaoDosFiltros = (
    <button
      type="button"
      aria-label={nomeDoBotao}
      aria-haspopup="dialog"
      aria-expanded={aberto}
      onClick={naGaveta ? () => setAberto(true) : undefined}
      className={juntar(botao.secundario, "ml-2 px-3", aberto && "bg-muted")}
      data-botao-dos-filtros=""
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0 sm:mr-1.5" aria-hidden="true" />
      <span className="hidden sm:inline">{rotuloDosFiltros}</span>
      {filtrosAtivos > 0 && (
        <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold tabular-nums text-primary">
          {filtrosAtivos}
        </span>
      )}
    </button>
  );

  const limpar = aoLimparFiltros ? (
    <button
      type="button"
      onClick={() => {
        aoLimparFiltros();
      }}
      disabled={filtrosAtivos === 0}
      className={juntar(botao.discreto, "h-8")}
    >
      Limpar filtros
    </button>
  ) : null;

  // Filtros dentro do popover ou da gaveta: um por linha, alinhados à esquerda.
  const filtrosEmColuna = (
    <div className="flex min-w-0 flex-col items-start [&>*+*]:mt-3 [&>*]:max-w-full" data-filtros-recolhidos="">
      {filtros}
    </div>
  );

  return (
    <div role="group" aria-label={rotulo} className={juntar("min-w-0", className)} data-barra-de-controles="" data-filtros={recolhidos ? "recolhidos" : "na-barra"}>
      <div className="flex min-w-0 items-center" data-linha-da-barra="1">
        <div className="min-w-0 flex-1">{inicio}</div>
        {recolhidos &&
          (naGaveta ? (
            botaoDosFiltros
          ) : (
            <Popover open={aberto} onOpenChange={setAberto}>
              <PopoverTrigger asChild>{botaoDosFiltros}</PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[360px] p-0">
                <div className={juntar("px-3 py-3", rolagem.janela)}>{filtrosEmColuna}</div>
                {limpar && <div className="flex justify-end border-t border-border px-2 py-1.5">{limpar}</div>}
              </PopoverContent>
            </Popover>
          ))}
        {acoes && <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-2">{acoes}</div>}
        {mais && mais.some(Boolean) && <MenuMais itens={mais} className="ml-1" />}
      </div>
      {filtros && !recolhidos && (
        <div ref={faixa} className="mt-2 flex min-w-0 items-center [&>*+*]:ml-2 [&>*]:shrink-0" data-linha-da-barra="2">
          {filtros}
        </div>
      )}
      {recolhidos && naGaveta && (
        <JanelaDoCelular
          aberta={aberto}
          titulo={nomeDoBotao}
          onFechar={() => setAberto(false)}
          rotuloDoFundo="Fechar os filtros"
          rodape={
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              {limpar || <span />}
              <button type="button" onClick={() => setAberto(false)} className={botao.primario}>
                Pronto
              </button>
            </div>
          }
        >
          {filtrosEmColuna}
        </JanelaDoCelular>
      )}
    </div>
  );
}

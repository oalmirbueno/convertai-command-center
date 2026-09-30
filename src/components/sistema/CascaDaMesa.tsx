import type { ReactNode } from "react";
import type { QualMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { BotaoDeTelaCheia, classeDaRaiz, type TelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import SeletorDeMesa from "./SeletorDeMesa";
import BotaoDoBriefing from "@/components/briefing/BotaoDoBriefing";
import { juntar, larguraDaMesa } from "./estilos";

/**
 * Casca de todas as mesas (docs/design/SISTEMA.md, "Mesas").
 *
 * Um cabeçalho fino, igual em todas:
 *   [Mesa ▾] / [Cliente ▾] [marca]   [etapas]   [ações] [tela cheia]
 * e o corpo na largura toda da tela (até 1760 px), sem coluna estreita.
 *
 * Larguras:
 * - celular (< 640): mesa e cliente na 1ª linha, ações na 2ª, etapas na 3ª
 *   (as etapas rolam para o lado, sem cortar o texto);
 * - tablet e notebook (640 a 1279): mesa, cliente e ações na 1ª linha,
 *   etapas na 2ª;
 * - de 1280 (ou de 1536 com `etapasEmLinhaPropriaAte="2xl"`): tudo numa
 *   linha só.
 *
 * Mantém o que as mesas já tinham: o `header[data-cabecalho-da-mesa]` fixo
 * abaixo da barra do painel a partir de 768 px (o Estúdio e o Contexto medem
 * a altura dele pelo nav das etapas), a tela cheia (classe da raiz + botão)
 * e o h1 só para leitor de tela.
 */
export default function CascaDaMesa({
  mesa,
  titulo,
  clientId,
  marcaId = null,
  cliente,
  marca,
  etapas,
  acoes,
  telaCheia,
  abaixo,
  caminho,
  etapasEmLinhaPropriaAte = "xl",
  className = "",
  children,
}: {
  /** Qual mesa é (o seletor de mesa marca esta). */
  mesa: QualMesa;
  /** Título da página (h1, só para leitor de tela). */
  titulo: string;
  clientId: string;
  marcaId?: string | null;
  /** O seletor de cliente (SeletorDeClientesDaMesa). */
  cliente: ReactNode;
  /** Troca de marca (cliente com 2 ou mais marcas). */
  marca?: ReactNode;
  /** O nav das etapas (componente Etapas, ou o nav próprio da mesa). */
  etapas?: ReactNode;
  /** Botões à direita (saldo, prioridades, agente). A tela cheia a casca já põe. */
  acoes?: ReactNode;
  telaCheia: TelaCheiaDaMesa;
  /** Faixa extra dentro do cabeçalho, abaixo da linha principal (ex.: barra do ensaio). */
  abaixo?: ReactNode;
  /**
   * No lugar do seletor de mesa, o caminho de volta (frente PRO3: a Mesa
   * Proposta entra por Clientes e mostra "Clientes › Propostas").
   */
  caminho?: ReactNode;
  /** Até qual largura as etapas ficam numa linha própria (mesas com muitas etapas: "2xl"). */
  etapasEmLinhaPropriaAte?: "xl" | "2xl";
  /** Classes extras na raiz (ex.: mais espaço embaixo). */
  className?: string;
  children?: ReactNode;
}) {
  const ate2xl = etapasEmLinhaPropriaAte === "2xl";
  return (
    <div className={juntar("relative isolate -mx-4 space-y-5 bg-background px-4 pb-10 md:-mx-6 md:px-6", classeDaRaiz(telaCheia.cheia), className)} data-casca-da-mesa={mesa}>
      <header data-cabecalho-da-mesa="" className="relative z-20 -mx-4 border-b border-border bg-background px-4 pt-2 md:sticky md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
        <h1 className="sr-only">{titulo}</h1>
        <div className={juntar(larguraDaMesa, "flex flex-wrap items-center", ate2xl ? "2xl:flex-nowrap" : "xl:flex-nowrap", etapas ? "" : "pb-2")}>
          {/* Onde estou: mesa / cliente / marca. */}
          <div className={juntar("flex w-full min-w-0 items-center sm:w-auto sm:flex-1", ate2xl ? "2xl:flex-none" : "xl:flex-none")} data-casca-identidade="">
            {caminho || <SeletorDeMesa atual={mesa} clientId={clientId} marcaId={marcaId} />}
            <span aria-hidden="true" className="mx-1 shrink-0 text-[15px] font-light text-muted-foreground/50">
              /
            </span>
            <div className="min-w-0 flex-1 sm:flex-initial">{cliente}</div>
            {marca && <div className="ml-2 min-w-0 shrink-0">{marca}</div>}
          </div>
          {/* Ações: à direita; no celular, linha própria. */}
          <div
            className={juntar(
              "mt-1 flex w-full min-w-0 shrink-0 items-center justify-end sm:ml-3 sm:mt-0 sm:w-auto",
              ate2xl ? "2xl:order-3" : "xl:order-3",
            )}
            data-casca-acoes=""
          >
            {/* Frente BRF: link do briefing no modelo da mesa (some em mesa sem modelo). */}
            <BotaoDoBriefing clientId={clientId} marcaId={marcaId} mesa={mesa} className="mr-0.5" />
            {acoes}
            <BotaoDeTelaCheia tela={telaCheia} className="ml-0.5" />
          </div>
          {etapas && (
            <div
              className={juntar(
                "order-last mt-1 w-full min-w-0 border-t border-border/60 pt-0.5",
                ate2xl ? "2xl:order-2 2xl:mx-4 2xl:mt-0 2xl:w-auto 2xl:flex-1 2xl:border-t-0 2xl:pt-0" : "xl:order-2 xl:mx-4 xl:mt-0 xl:w-auto xl:flex-1 xl:border-t-0 xl:pt-0",
              )}
              data-casca-etapas=""
            >
              {etapas}
            </div>
          )}
        </div>
        {etapas && <div className="h-1" aria-hidden="true" />}
        {abaixo && <div className={juntar(larguraDaMesa, "pb-2")}>{abaixo}</div>}
      </header>
      <div className={juntar(larguraDaMesa, "space-y-5")} data-corpo-da-mesa="">
        {children}
      </div>
    </div>
  );
}

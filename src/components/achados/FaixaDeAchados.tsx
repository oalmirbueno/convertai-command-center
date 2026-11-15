import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, botao, juntar, superficie, texto } from "@/components/sistema";
import type { Achado, TomDoAchado } from "./detectores";

/**
 * Faixa de achados (20/10/2026): cartões "achado → ação" no padrão do painel.
 * Número grande, frase curta e UMA ação (link para a tela certa ou cópia da
 * mensagem pronta, nunca envio sozinho). Desde 14/11/2026 cada achado é um
 * cartão de indicador (canto de 20 px, número de 28 px, bolinha do tom).
 *
 * - Some quando não há achado (só aparece número maior que zero).
 * - No celular a faixa rola por dentro, para o lado; a página não ganha
 *   rolagem lateral. Do tablet para cima vira grade.
 * - No máximo 6 à vista; "Ver todos" abre o resto.
 * - A explicação de cada regra fica no "?" do título.
 */

export const MAXIMO_A_VISTA = 6;

const COR_DO_TOM: Record<TomDoAchado, string> = {
  urgente: "text-destructive",
  atencao: "text-warning",
  info: "text-info",
};
const FUNDO_DO_TOM: Record<TomDoAchado, string> = {
  urgente: "bg-danger-soft",
  atencao: "bg-warning-soft",
  info: "bg-info-soft",
};
const BOLINHA_DO_TOM: Record<TomDoAchado, string> = {
  urgente: "bg-destructive",
  atencao: "bg-warning",
  info: "bg-info",
};

async function copiar(textoParaCopiar: string) {
  try {
    await navigator.clipboard.writeText(textoParaCopiar);
    toast.success("Mensagem copiada. É só colar no grupo.");
  } catch {
    toast.error("Não consegui copiar automaticamente.");
  }
}

export default function FaixaDeAchados({
  achados,
  acoesLocais,
  rotuloDoFoco,
  className,
}: {
  achados: Achado[];
  /** Ação feita na própria tela (ex.: abrir o gerador de rituais na Central), por id do achado. */
  acoesLocais?: Partial<Record<string, (achado: Achado) => void>>;
  /** Nome do cliente em foco, quando a faixa está filtrada por ele. */
  rotuloDoFoco?: string | null;
  className?: string;
}) {
  const [todos, setTodos] = useState(false);
  if (achados.length === 0) return null;
  const visiveis = todos ? achados : achados.slice(0, MAXIMO_A_VISTA);
  const sobram = achados.length - MAXIMO_A_VISTA;

  return (
    <section aria-label="Achados" data-faixa-de-achados="" className={juntar("min-w-0", className)}>
      <div className="mb-1 flex min-h-[32px] min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 truncate")}>{rotuloDoFoco ? `Achados de ${rotuloDoFoco}` : "Achados"}</span>
        <AjudaRecolhida className="ml-1 min-h-0" titulo="Achados" rotulo="O que são os achados?">
          <span className="block">O que está deixando dinheiro ou relação na mesa agora, lido dos dados do painel. Cada um traz uma ação pronta; mensagem é só copiada, nada é enviado sozinho.</span>
          {visiveis.map((a) => (
            <span key={a.id} className="mt-1.5 block"><span className="font-semibold">{a.frase}:</span> {a.ajuda}</span>
          ))}
        </AjudaRecolhida>
        {sobram > 0 && (
          <button type="button" onClick={() => setTodos((v) => !v)} aria-expanded={todos} className={juntar(botao.barra, "ml-auto")}>
            {todos ? "Ver menos" : `Ver todos (${achados.length})`}
          </button>
        )}
      </div>
      <ul
        aria-label="Achados com ação"
        className="flex min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:pb-0 lg:grid-cols-3"
      >
        {visiveis.map((a, indice) => {
          const local = acoesLocais ? acoesLocais[a.id] : undefined;
          const nome = `${a.numero} ${a.frase}`;
          const conteudoDaAcao = (
            <>
              {a.acao.copiar && !local ? <Copy className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ArrowUpRight className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{a.acao.rotulo}</span>
            </>
          );
          /* v4 (15/11): o primeiro achado (o mais urgente) é o cartão de tinta, com o botão cheio; os
             outros ficam claros, com o ícone do tom num círculo e a ação em pílula. Uma ação por cartão. */
          const principal = indice === 0;
          const classeDaAcao = juntar(
            "toque-compacto mt-3 inline-flex h-9 max-w-full items-center self-start rounded-full px-3.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            principal ? "bg-accent-solid text-on-accent hover:opacity-90" : "bg-muted text-foreground hover:bg-muted/70",
          );
          return (
            <li key={a.id} data-achado={a.id} className={juntar(superficie.painel, principal && superficie.tinta, "mr-3 flex w-[72%] max-w-[260px] shrink-0 snap-start flex-col px-4 py-4 sm:mr-0 sm:w-auto sm:max-w-none sm:px-5 sm:py-5")}>
              <span className="flex min-w-0 items-center">
                <span className={juntar("text-[32px] font-medium leading-9 tracking-[-0.03em] tabular-nums", principal ? "text-foreground" : COR_DO_TOM[a.tom])}>{a.numero}</span>
                <span className={juntar("ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full", principal ? "bg-foreground/10" : FUNDO_DO_TOM[a.tom])} aria-hidden="true">
                  <span className={juntar("h-2 w-2 rounded-full", BOLINHA_DO_TOM[a.tom])} />
                </span>
              </span>
              <span className={juntar(texto.corpo, "mt-1 line-clamp-2 min-h-[40px] text-muted-foreground")}>{a.frase}</span>
              {local ? (
                <button type="button" onClick={() => local(a)} aria-label={`${a.acao.rotulo}: ${nome}`} className={classeDaAcao}>{conteudoDaAcao}</button>
              ) : a.acao.copiar ? (
                <button type="button" onClick={() => void copiar(a.acao.copiar as string)} aria-label={`${a.acao.rotulo}: ${nome}`} title="Copia a mensagem pronta; nada é enviado" className={classeDaAcao}>{conteudoDaAcao}</button>
              ) : (
                <Link to={a.acao.rota || "/"} aria-label={`${a.acao.rotulo}: ${nome}`} className={classeDaAcao}>{conteudoDaAcao}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, botao, juntar, texto } from "@/components/sistema";
import type { Achado, TomDoAchado } from "./detectores";

/**
 * Faixa de achados (20/10/2026): cartões "achado → ação" no padrão do painel.
 * Número grande, frase curta e UMA ação (link para a tela certa ou cópia da
 * mensagem pronta, nunca envio sozinho). Sem caixa: só a linha fina em cima.
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
        className="flex min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-x-6 sm:overflow-visible sm:pb-0 lg:grid-cols-3"
      >
        {visiveis.map((a) => {
          const local = acoesLocais ? acoesLocais[a.id] : undefined;
          const nome = `${a.numero} ${a.frase}`;
          const conteudoDaAcao = (
            <>
              {a.acao.copiar && !local ? <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <ArrowUpRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              {a.acao.rotulo}
            </>
          );
          const classeDaAcao = juntar(botao.barra, "-ml-2 text-primary hover:text-primary");
          return (
            <li key={a.id} data-achado={a.id} className="mr-4 w-[72%] max-w-[260px] shrink-0 snap-start border-t border-border pt-2 sm:mr-0 sm:w-auto sm:max-w-none">
              <span className="flex min-w-0 items-baseline">
                <span className={juntar(texto.numero, COR_DO_TOM[a.tom])}>{a.numero}</span>
              </span>
              <span className={juntar(texto.corpo, "line-clamp-2 min-h-[40px]")}>{a.frase}</span>
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

import { ArrowRight, CheckCircle2, CircleDot, Lock, StickyNote } from "lucide-react";
import { juntar } from "@/components/sistema";
import { leituraSimples, type TomDaSecao } from "@/lib/cadernoExecucao";

/*
 * Texto do agente em blocos (19/10/2026, dono, com o print de "Execuções externas": "quando vem
 * assim fica muito confuso, deixe mais intuitivo e simplificado; no diário também").
 *
 * Os agentes escrevem FEITO / EM ANDAMENTO / PRÓXIMO PASSO / TRAVADO. Aqui cada bloco vira uma
 * caixa com cor e ícone, os itens "- " viram lista, e a ordem é a de quem decide: o que está
 * travado primeiro, depois o próximo passo, o que está andando e o que já foi feito.
 */

const ORDEM: TomDaSecao[] = ["travado", "proximo", "andamento", "feito", "nota"];

const TOM: Record<TomDaSecao, { Icone: typeof Lock; caixa: string; titulo: string }> = {
  travado: { Icone: Lock, caixa: "border-warning/40 bg-warning/10", titulo: "text-warning" },
  proximo: { Icone: ArrowRight, caixa: "border-primary/30 bg-primary/5", titulo: "text-primary" },
  andamento: { Icone: CircleDot, caixa: "border-border bg-muted/30", titulo: "text-foreground" },
  feito: { Icone: CheckCircle2, caixa: "border-success/30 bg-success/5", titulo: "text-success" },
  nota: { Icone: StickyNote, caixa: "border-border bg-muted/20", titulo: "text-muted-foreground" },
};

/** Links no meio do texto viram "abrir (site)" clicável, em vez do endereço inteiro. */
export function ComLinks({ texto }: { texto: string }) {
  return <>{texto.split(/(https?:\/\/[^\s;,)]+)/).map((parte, i) => {
    if (i % 2 === 0) return parte;
    let site = parte;
    try { site = new URL(parte).hostname.replace(/^www\./, ""); } catch { /* fica o endereço */ }
    return <a key={i} href={parte} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">abrir ({site})</a>;
  })}</>;
}

/** Itens "- " de um bloco; sem marcador, o bloco é um parágrafo só. */
function itensDoBloco(texto: string): string[] {
  const linhas = texto.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!linhas.some((l) => /^[-•*]\s+/.test(l))) return [linhas.join(" ")];
  const itens: string[] = [];
  for (const l of linhas) {
    if (/^[-•*]\s+/.test(l) || !itens.length) itens.push(l.replace(/^[-•*]\s+/, ""));
    else itens[itens.length - 1] = `${itens[itens.length - 1]} ${l}`;
  }
  return itens;
}

export default function LeituraEmBlocos({ texto, className }: { texto: string; className?: string }) {
  const leitura = leituraSimples(texto || "");
  if (!leitura.secoes.length) {
    return <p className={juntar("whitespace-pre-line text-[13px] leading-6 text-foreground/90", className)}><ComLinks texto={leitura.resumo || texto} /></p>;
  }
  // O resumo só é abertura de verdade quando não saiu do primeiro bloco.
  const abertura = leitura.secoes[0].texto.startsWith(leitura.resumo) ? "" : leitura.resumo;
  const secoes = [...leitura.secoes].sort((a, b) => ORDEM.indexOf(a.tom) - ORDEM.indexOf(b.tom));
  return (
    <div className={juntar("space-y-2", className)}>
      {abertura && <p className="text-[13px] font-medium leading-6 text-foreground"><ComLinks texto={abertura} /></p>}
      {secoes.map((s, i) => {
        const t = TOM[s.tom];
        const itens = itensDoBloco(s.texto);
        return (
          <section key={i} aria-label={s.rotulo} data-tom={s.tom} className={juntar("rounded-lg border px-3 py-2", t.caixa)}>
            <h4 className={juntar("flex items-center text-[12px] font-semibold", t.titulo)}>
              <t.Icone className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{s.rotulo}
            </h4>
            {itens.length === 1
              ? <p className="mt-1 text-[13px] leading-6 text-foreground/90 [overflow-wrap:anywhere]"><ComLinks texto={itens[0]} /></p>
              : <ul className="mt-1 space-y-0.5">
                {itens.map((item, j) => <li key={j} className="flex text-[13px] leading-6 text-foreground/90"><span className="mr-2 mt-2.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]"><ComLinks texto={item} /></span></li>)}
              </ul>}
          </section>
        );
      })}
    </div>
  );
}

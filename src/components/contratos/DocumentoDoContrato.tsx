import { Fragment, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { juntar, superficie, texto } from "@/components/sistema/estilos";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { hashLegivel, lerDocumento } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Prévia HTML do contrato (frente CON, 30/09): o MESMO texto canônico que é
 * congelado, com hash e vira PDF (contrato-modelo.ts), desenhado como
 * documento: logo Aceleriq, título, quadro-resumo em duas colunas, cláusulas
 * numeradas. Campo sem valor aparece marcado ("falta: ...") só na prévia do
 * rascunho; o congelado nunca tem essa marca. Serve a tela da equipe e o link
 * público de assinatura.
 */

const MARCA_DE_FALTA = /\[(?:falta|corrigir): [^\]]+\]/g;

function comFaltas(t: string): ReactNode {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  const re = new RegExp(MARCA_DE_FALTA.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > ultimo) partes.push(t.slice(ultimo, m.index));
    partes.push(
      <mark key={m.index} className="rounded bg-warning/15 px-1 text-warning" data-falta="">
        {m[0].slice(1, -1)}
      </mark>,
    );
    ultimo = m.index + m[0].length;
  }
  if (ultimo < t.length) partes.push(t.slice(ultimo));
  return partes.length ? partes : t;
}

export default function DocumentoDoContrato({
  texto: conteudo,
  hash,
  alteradas = [],
  className,
}: {
  texto: string;
  /** Código de integridade do texto congelado (SHA-256). */
  hash?: string | null;
  /** Números das cláusulas alteradas nesta versão (só a equipe vê a marca). */
  alteradas?: string[];
  className?: string;
}) {
  const blocos = lerDocumento(conteudo);
  let quadro: Array<{ rotulo: string; texto: string }> = [];
  const saida: ReactNode[] = [];
  const fecharQuadro = (chave: string) => {
    if (!quadro.length) return;
    const linhas = quadro;
    quadro = [];
    saida.push(
      <dl key={`q-${chave}`} className="mt-3 grid min-w-0 grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)]">
        {linhas.map((l, i) => (
          <Fragment key={i}>
            <dt className={juntar(texto.rotulo, "pt-2.5 text-primary sm:border-t sm:border-border/60")}>{l.rotulo}</dt>
            <dd className={juntar(texto.corpo, "min-w-0 border-b border-border/60 pb-2.5 pt-1 sm:border-b-0 sm:border-t sm:pt-2.5")}>{comFaltas(l.texto)}</dd>
          </Fragment>
        ))}
      </dl>,
    );
  };
  let itens: string[] = [];
  const fecharItens = (chave: string) => {
    if (!itens.length) return;
    const lista = itens;
    itens = [];
    saida.push(
      <ul key={`l-${chave}`} className="mt-2 min-w-0 list-disc pl-5">
        {lista.map((t, k) => (
          <li key={k} className={juntar(texto.corpo, "mt-1")}>{comFaltas(t)}</li>
        ))}
      </ul>,
    );
  };
  blocos.forEach((b, i) => {
    if (b.tipo === "quadro") {
      quadro.push({ rotulo: b.rotulo, texto: b.texto });
      return;
    }
    if (b.tipo === "item") {
      fecharQuadro(String(i));
      itens.push(b.texto);
      return;
    }
    fecharQuadro(String(i));
    fecharItens(String(i));
    if (b.tipo === "titulo") saida.push(<h2 key={i} className={juntar(texto.tituloPagina, "mt-5")}>{b.texto}</h2>);
    else if (b.tipo === "meta") saida.push(<p key={i} className={juntar(texto.auxiliar, "mt-1")}>{b.texto}</p>);
    else if (b.tipo === "secao") saida.push(<h3 key={i} className={juntar(texto.tituloSecao, "mt-8 border-b border-primary/40 pb-1.5")}>{b.texto}</h3>);
    else if (b.tipo === "clausula") {
      const numero = b.texto.split(" ")[0].replace(/\.$/, "");
      const alterada = alteradas.indexOf(numero) >= 0;
      saida.push(
        <h4 key={i} className="mt-5 text-[13px] font-semibold leading-5 text-foreground">
          {b.texto}
          {alterada && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">alterada</span>}
        </h4>,
      );
    } else saida.push(<p key={i} className={juntar(texto.corpo, "mt-2")}>{comFaltas(b.texto)}</p>);
  });
  fecharQuadro("fim");
  fecharItens("fim");

  return (
    <article className={juntar(superficie.painel, "min-w-0 bg-card px-4 py-5 sm:px-8 sm:py-8", className)} data-documento-do-contrato="">
      <div className="flex min-w-0 items-center justify-between border-b border-border pb-4">
        <MarcaAceleriq altura={24} />
        {hash ? (
          <span className={juntar(texto.auxiliar, "ml-3 inline-flex min-w-0 items-center truncate")} title={`SHA-256 ${hash}`}>
            <ShieldCheck className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate font-mono">{hashLegivel(hash).slice(0, 19)}</span>
          </span>
        ) : (
          <span className={juntar(texto.auxiliar, "ml-3")}>Prévia</span>
        )}
      </div>
      <div className="min-w-0 [overflow-wrap:anywhere]">{saida}</div>
    </article>
  );
}

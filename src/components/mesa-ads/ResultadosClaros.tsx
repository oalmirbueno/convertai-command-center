import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, LayoutList, Link2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { juntar, superficie, texto } from "@/components/sistema/estilos";
import { brl, inteiro, porcento } from "./adsApi";
import { Foto, SeloDoSinal } from "./Comuns";
import {
  ABAS_DE_RESULTADO,
  anunciosDaAba,
  criativosAgrupados,
  filtrarPorGrupo,
  grupoDe,
  gruposPresentes,
  resumoDoTopo,
  type AbaDeResultado,
  type AnuncioDoResultado,
  type GrupoDeObjetivo,
  type PecaAgrupada,
  type ResultadosDaConta,
} from "./resultadosApi";

/**
 * Resultados claros (pedido do dono em 26/09/2026): o resumo no topo, o
 * filtro por objetivo com o rótulo certo do resultado e as abas simples
 * (Ativos agora, Melhores anúncios, Melhores criativos, Todos, Para
 * descartar). Usado na aba Conta e na aba Resultados. Nada aqui rola sozinho
 * dentro da página: a lista cresce no "Mostrar mais" (sem rolagem dupla).
 *
 * 26/09 (sistema de design): objetivo e abas viram seletores compactos (até 4
 * opções, segmentado; mais, lista); a aba escolhida fica lembrada.
 *
 * 28/09 (padronização, lote L4): o seletor "Ver anúncios" sobe para a linha do
 * título de quem usa (SeletorDaAbaDeResultados + useAbaDosResultados, com o
 * PainelDeResultados controlado), em vez de ocupar uma linha própria. KPI e
 * cartões são itens de grade com o cartão do sistema; a miniatura não tem
 * moldura extra (nada de cartão dentro de cartão).
 */

export const ITENS_POR_PAGINA = 12;

function Variacao({ valor, bomQuandoSobe }: { valor: number | null | undefined; bomQuandoSobe: boolean }) {
  if (valor === null || valor === undefined || valor === 0) return null;
  const sobe = valor > 0;
  const bom = sobe === bomQuandoSobe;
  return (
    <span className={`ml-1.5 whitespace-nowrap text-[11px] font-medium tabular-nums ${bom ? "text-success" : "text-destructive"}`} title="Comparado ao período anterior do mesmo tamanho">
      {sobe ? "+" : ""}
      {Math.round(valor)}%
    </span>
  );
}

function NumeroGrande({ rotulo, valor, variacao, bomQuandoSobe = true, dica }: { rotulo: string; valor: string; variacao?: number | null; bomQuandoSobe?: boolean; dica?: string }) {
  return (
    <div className={juntar(superficie.painel, "min-w-0 px-3 py-2.5")} title={dica}>
      <dt className="truncate text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 flex min-w-0 items-baseline">
        <span className="truncate text-[20px] font-semibold tabular-nums">{valor}</span>
        <Variacao valor={variacao} bomQuandoSobe={bomQuandoSobe} />
      </dd>
    </div>
  );
}

/** Investimento, resultado principal, custo por resultado e tendência, do objetivo escolhido. */
export function ResumoDoTopo({ dados, grupo, onGrupo }: { dados: ResultadosDaConta; grupo: GrupoDeObjetivo | ""; onGrupo: (g: GrupoDeObjetivo | "") => void }) {
  const r = resumoDoTopo(dados, grupo);
  const t = r.tendencia;
  const mix = dados.mix;
  return (
    <section aria-label="Resumo" className="min-w-0 space-y-2">
      <dl className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
        <NumeroGrande rotulo="Investimento" valor={brl(r.investimento)} variacao={t ? t.gasto_pct : null} dica="Quanto a Meta cobrou no período." />
        <NumeroGrande rotulo={r.misturado ? `${r.rotulo} (principal)` : r.rotulo} valor={inteiro(r.resultados)} variacao={t ? t.resultados_pct : null} dica="O resultado que o objetivo das campanhas busca." />
        <NumeroGrande rotulo="Custo por resultado" valor={brl(r.custo_por_resultado)} variacao={t ? t.custo_por_resultado_pct : null} bomQuandoSobe={false} />
        <NumeroGrande rotulo="Ativos agora" valor={`${inteiro(r.ativos)} de ${inteiro(r.anuncios)}`} dica="Anúncios rodando agora, do total com entrega no período." />
      </dl>
      {!grupo && r.misturado && (
        <p className="truncate text-[12px] text-muted-foreground" title="O resultado e o custo acima são do objetivo com mais investimento. Escolha um objetivo para ver o número certo de cada um.">
          Objetivos misturados: números do objetivo com mais investimento.
        </p>
      )}
      {!grupo && mix && mix.por_grupo.length > 0 && (
        <div className="min-w-0 pt-1" aria-label="Onde está o investimento">
          <p className={texto.rotulo}>Onde está o investimento</p>
          <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {mix.por_grupo.map((g, i) => (
              <span key={g.grupo} className={i % 2 === 0 ? "bg-primary" : "bg-primary/50"} style={{ width: `${Math.max(1, g.pct)}%` }} />
            ))}
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap">
            {mix.por_grupo.map((g) => (
              <button key={g.grupo} type="button" onClick={() => onGrupo(g.grupo)} className="mb-1 mr-3 text-left text-[12px] hover:underline" title={`Ver só ${g.rotulo.toLowerCase()}`}>
                <span className="font-medium">{g.rotulo}</span> <span className="tabular-nums text-muted-foreground">{inteiro(g.pct)}% · {brl(g.gasto)}{g.resultados ? ` · ${inteiro(g.resultados)} ${g.resultado_rotulo.toLowerCase()}` : ""}</span>
              </button>
            ))}
          </div>
          {mix.alertas.map((a) => (
            <p key={a} className="mt-1 flex items-start text-[12px] text-warning">
              <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{a}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** Objetivo: Todos e os que existem na conta (seletor compacto: até 4, segmentado; mais, lista). */
export function FiltroDeObjetivo({ dados, valor, onMudar }: { dados: ResultadosDaConta; valor: GrupoDeObjetivo | ""; onMudar: (g: GrupoDeObjetivo | "") => void }) {
  const grupos = gruposPresentes(dados.anuncios);
  if (grupos.length < 1) return null;
  return (
    <SeletorCompacto
      rotulo="Filtrar por objetivo"
      icone={<Target className="h-3.5 w-3.5" />}
      opcoes={[{ valor: "", rotulo: "Todos" }].concat(grupos.map((g) => ({ valor: g.valor, rotulo: `${g.rotulo} (${g.quantos})`, descricao: `Resultado: ${grupoDe(g.valor)!.resultado}` })))}
      valor={valor}
      onEscolher={(v) => onMudar(v as GrupoDeObjetivo | "")}
    />
  );
}

const statusCurto = (s: string) => {
  const t = String(s || "").toUpperCase();
  if (t === "ACTIVE") return "Ativo";
  if (t.indexOf("PAUSED") >= 0) return "Pausado";
  if (t === "ARCHIVED" || t === "DELETED") return "Encerrado";
  return s ? s.toLowerCase() : "";
};

/** Cartão compacto de um anúncio: miniatura, números que decidem e o criativo da Mesa ligado. */
export function CartaoCompacto({ a, acao }: { a: AnuncioDoResultado; acao?: ReactNode }) {
  const m = a.metricas;
  return (
    <article className={juntar(superficie.painel, "grid min-w-0 grid-cols-[56px_minmax(0,1fr)] gap-3 p-2.5")} aria-label={`Anúncio ${a.nome}`} data-ad={a.ad_id}>
      <div className="relative w-14 overflow-hidden rounded-md bg-secondary/40" style={{ paddingTop: "125%" }}>
        <div className="absolute inset-0">
          <Foto src={a.imagem_url} alt={a.nome} className="h-full w-full" />
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-start">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold" title={a.nome}>{a.nome}</p>
            <p className="truncate text-[11px] text-muted-foreground">{[a.campanha, statusCurto(a.status), a.grupo ? grupoDe(a.grupo)!.rotulo : ""].filter(Boolean).join(" · ")}</p>
          </div>
          <SeloDoSinal sinal={a.sinal} className="ml-2" />
        </div>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-4">
          <div className="min-w-0"><dt className="truncate text-muted-foreground">Investido</dt><dd className="truncate font-medium tabular-nums">{brl(m.gasto)}</dd></div>
          <div className="min-w-0"><dt className="truncate text-muted-foreground" title={a.resultado_rotulo}>{a.resultado_rotulo}</dt><dd className="truncate font-medium tabular-nums">{inteiro(m.resultados)}</dd></div>
          <div className="min-w-0"><dt className="truncate text-muted-foreground">Custo cada</dt><dd className="truncate font-medium tabular-nums">{brl(m.custo_por_resultado)}</dd></div>
          <div className="min-w-0"><dt className="truncate text-muted-foreground">CTR</dt><dd className="truncate font-medium tabular-nums">{porcento(m.ctr_saida !== null ? m.ctr_saida : m.ctr)}</dd></div>
        </dl>
        <div className="mt-1 flex min-w-0 flex-wrap items-center">
          {a.criativo && (
            <span className="mb-0.5 mr-2 inline-flex min-w-0 max-w-full items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary" title={a.criativo.origem === "mesma_peca" ? "Mesma arte de um anúncio ligado" : "Ligado ao criativo da Mesa Ads"}>
              <Link2 className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">{a.criativo.nome}</span>
            </span>
          )}
          {acao ? <span className="mb-0.5 ml-auto">{acao}</span> : null}
        </div>
      </div>
    </article>
  );
}

function textoDoIndice(indice: number | null): string {
  if (indice === null) return "Pouco volume para comparar";
  if (indice < 1) return `${Math.round((1 - indice) * 100)}% mais barato que a mediana`;
  if (indice > 1) return `${Math.round((indice - 1) * 100)}% mais caro que a mediana`;
  return "Na mediana";
}

/** Uma peça (a mesma arte em vários anúncios), somada. */
export function CartaoDaPeca({ p }: { p: PecaAgrupada }) {
  return (
    <article className={juntar(superficie.painel, "grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-3 p-2.5")} aria-label={`Criativo ${p.nome}`}>
      <div className="relative w-[72px] overflow-hidden rounded-md bg-secondary/40" style={{ paddingTop: "125%" }}>
        <div className="absolute inset-0">
          <Foto src={p.imagem_url} alt={p.nome} className="h-full w-full" />
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold" title={p.nome}>{p.nome}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {p.anuncios.length} anúncio{p.anuncios.length === 1 ? "" : "s"}
          {p.ativos ? ` (${p.ativos} ativo${p.ativos === 1 ? "" : "s"})` : ""} · {p.grupo ? grupoDe(p.grupo)!.rotulo : "Sem objetivo"}
        </p>
        <dl className="mt-1.5 grid grid-cols-3 gap-x-3 text-[11px]">
          <div className="min-w-0"><dt className="truncate text-muted-foreground">Investido</dt><dd className="truncate font-medium tabular-nums">{brl(p.metricas.gasto)}</dd></div>
          <div className="min-w-0"><dt className="truncate text-muted-foreground" title={p.resultado_rotulo}>{p.resultado_rotulo}</dt><dd className="truncate font-medium tabular-nums">{inteiro(p.metricas.resultados)}</dd></div>
          <div className="min-w-0"><dt className="truncate text-muted-foreground">Custo cada</dt><dd className="truncate font-medium tabular-nums">{brl(p.metricas.custo_por_resultado)}</dd></div>
        </dl>
        <p className={`mt-1 text-[11px] ${p.indice !== null && p.indice < 1 ? "text-success" : p.indice !== null && p.indice > 1.2 ? "text-destructive" : "text-muted-foreground"}`}>{textoDoIndice(p.indice)}</p>
        {p.criativo && (
          <span className="mt-1 inline-flex min-w-0 max-w-full items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            <Link2 className="mr-1 h-3 w-3 shrink-0" />
            <span className="truncate">Criativo da Mesa Ads</span>
          </span>
        )}
      </div>
    </article>
  );
}

/** A aba escolhida ("Ver anúncios"), lembrada pela chave (ponha o cliente nela). */
export function useAbaDosResultados(memoria?: string, abaInicial: AbaDeResultado = "ativos"): [AbaDeResultado, (v: AbaDeResultado) => void] {
  const [aba, setAba] = useEstadoDaTela<AbaDeResultado>(memoria || "mesa-ads:resultados:aba", abaInicial, {
    validar: (v) => typeof v === "string" && ABAS_DE_RESULTADO.some((x) => x.valor === v),
  });
  return [aba, setAba];
}

/** O seletor "Ver anúncios" (para a linha do título de quem mostra o painel). */
export function SeletorDaAbaDeResultados({ dados, grupo, aba, onMudar, className = "" }: { dados: ResultadosDaConta; grupo: GrupoDeObjetivo | ""; aba: AbaDeResultado; onMudar: (v: AbaDeResultado) => void; className?: string }) {
  const base = filtrarPorGrupo(dados.anuncios, grupo);
  const contagem = (v: AbaDeResultado) => (v === "melhores_criativos" ? criativosAgrupados(base).length : anunciosDaAba(base, v).length);
  return (
    <SeletorCompacto
      rotulo="Ver anúncios"
      icone={<LayoutList className="h-3.5 w-3.5" />}
      className={className}
      opcoes={ABAS_DE_RESULTADO.map((o) => ({ valor: o.valor, rotulo: `${o.rotulo} (${contagem(o.valor)})`, descricao: o.dica }))}
      valor={aba}
      onEscolher={(v) => onMudar(v as AbaDeResultado)}
    />
  );
}

/**
 * As abas de resultado com a lista paginada. `renderAnuncio` troca o cartão
 * (a aba Conta usa o cartão completo, com variações e ficha). Com `aba` e
 * `onAba` (controlado), o seletor fica com quem chama (na linha do título).
 */
export function PainelDeResultados({
  dados,
  grupo,
  abaInicial = "ativos",
  renderAnuncio,
  memoria,
  aba: abaDeFora,
  onAba,
  className = "",
}: {
  dados: ResultadosDaConta;
  grupo: GrupoDeObjetivo | "";
  abaInicial?: AbaDeResultado;
  renderAnuncio?: (a: AnuncioDoResultado) => ReactNode;
  /** Chave (com o cliente) para lembrar a aba escolhida ao sair e voltar. */
  memoria?: string;
  /** Aba controlada por quem chama (o seletor mora no título). */
  aba?: AbaDeResultado;
  onAba?: (v: AbaDeResultado) => void;
  className?: string;
}) {
  const [abaPropria, setAbaPropria] = useAbaDosResultados(memoria, abaInicial);
  const controlada = abaDeFora !== undefined;
  const aba = controlada ? abaDeFora : abaPropria;
  const [mostrando, setMostrando] = useState(ITENS_POR_PAGINA);
  // Trocou de aba (aqui ou no título): a lista volta para a primeira página.
  const abaAnterior = useRef(aba);
  useEffect(() => {
    if (abaAnterior.current !== aba) {
      abaAnterior.current = aba;
      setMostrando(ITENS_POR_PAGINA);
    }
  }, [aba]);
  const base = filtrarPorGrupo(dados.anuncios, grupo);
  const pecas = aba === "melhores_criativos" ? criativosAgrupados(base) : [];
  const anuncios = aba === "melhores_criativos" ? [] : anunciosDaAba(base, aba);
  const total = aba === "melhores_criativos" ? pecas.length : anuncios.length;
  const mudar = (v: AbaDeResultado) => {
    if (controlada) {
      if (onAba) onAba(v);
    } else setAbaPropria(v);
  };
  return (
    <section className={`min-w-0 ${className}`} aria-label="Anúncios por aba">
      {!controlada && <SeletorDaAbaDeResultados dados={dados} grupo={grupo} aba={aba} onMudar={mudar} className="mb-3" />}
      {total === 0 ? (
        <EstadoVazio compacto titulo="Nada aqui." descricao={base.length ? "Troque de lista ou de objetivo." : "Nenhum anúncio com entrega no período. Troque o período ou sincronize."} />
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-2.5 xl:grid-cols-2">
            {aba === "melhores_criativos"
              ? pecas.slice(0, mostrando).map((p) => <CartaoDaPeca key={`${p.peca}|${p.resultado_tipo}`} p={p} />)
              : anuncios.slice(0, mostrando).map((a) => <div key={a.ad_id} className="min-w-0">{renderAnuncio ? renderAnuncio(a) : <CartaoCompacto a={a} />}</div>)}
          </div>
          {total > mostrando && (
            <div className="mt-3 text-center">
              <Button type="button" size="sm" variant="outline" onClick={() => setMostrando(mostrando + ITENS_POR_PAGINA)}>
                Mostrar mais {Math.min(ITENS_POR_PAGINA, total - mostrando)} de {total - mostrando}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

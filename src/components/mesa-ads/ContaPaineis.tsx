import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Loader2, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, dataEHora } from "@/lib/mesa/api";
import { brl, decimal, humanizar, inteiro, partesDaAnaliseDaConta, porcento, type CampanhaAoVivo, type MetricasDaConta } from "./adsApi";
import { Foto } from "./Comuns";
import {
  chavesConta,
  evolucaoVazia,
  lerDesempenho,
  lerEvolucao,
  type Comparacao,
  type ExtrasDaConta,
  type ItemDaEvolucao,
  type LeituraDaEvolucao,
  type PontoDaConta,
  type SaldoDaConta,
} from "./contaApi";

/**
 * Painéis da conta de anúncios (Mesa Ads v4, frente E): o resumo do período
 * com a comparação com o período anterior, o saldo de cada conta, a
 * tendência diária, a tabela de campanhas, o desempenho do cliente (orgânico
 * e anúncios juntos) e a evolução (vencedores, manter, descartar, próximos
 * testes e aprendizados). Números sempre do código; a IA só explica.
 */

// ------------------------------------------------------------------ resumo

function Seta({ valor, bomQuandoSobe }: { valor: number | null; bomQuandoSobe: boolean }) {
  if (valor === null || valor === 0) return null;
  const sobe = valor > 0;
  const bom = sobe === bomQuandoSobe;
  return (
    <span className={`ml-1 whitespace-nowrap text-[10.5px] font-medium tabular-nums ${bom ? "text-success" : "text-destructive"}`} title="Comparado ao período anterior do mesmo tamanho">
      {sobe ? "+" : ""}
      {Math.round(valor)}%
    </span>
  );
}

function Kpi({ rotulo, valor, variacao, bomQuandoSobe = true, dica }: { rotulo: string; valor: string; variacao?: number | null; bomQuandoSobe?: boolean; dica?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2" title={dica}>
      <dt className="truncate text-[10.5px] uppercase tracking-wider text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 flex min-w-0 items-baseline">
        <span className="truncate text-[15px] font-semibold tabular-nums">{valor}</span>
        {variacao !== undefined && <Seta valor={variacao} bomQuandoSobe={bomQuandoSobe} />}
      </dd>
    </div>
  );
}

/** Resumo do período: investimento, resultado pelo objetivo, custo, CTR, CPM, alcance, frequência e ROAS. */
export function ResumoDaConta({ totais, extras }: { totais: MetricasDaConta; extras: ExtrasDaConta }) {
  const c: Comparacao | null = extras.comparacao;
  const v = (k: keyof Comparacao) => (c ? c[k] : null);
  return (
    <section aria-label="Resumo do período" className="min-w-0">
      <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi rotulo="Investimento" valor={brl(totais.gasto)} variacao={v("gasto_pct")} dica="Quanto a Meta cobrou no período." />
        <Kpi rotulo={extras.resultado_rotulo} valor={inteiro(totais.resultados)} variacao={v("resultados_pct")} dica="O resultado que conta para o objetivo das campanhas com mais investimento." />
        <Kpi rotulo="Custo por resultado" valor={brl(totais.custo_por_resultado)} variacao={v("custo_por_resultado_pct")} bomQuandoSobe={false} />
        <Kpi rotulo="CTR do link" valor={porcento(totais.ctr_saida !== null ? totais.ctr_saida : totais.ctr)} variacao={v("ctr_link_pct")} />
        <Kpi rotulo="CPM" valor={brl(totais.cpm)} variacao={v("cpm_pct")} bomQuandoSobe={false} dica="Custo por mil impressões." />
        <Kpi rotulo="Alcance (aprox.)" valor={inteiro(extras.alcance !== null ? extras.alcance : totais.alcance)} variacao={v("alcance_pct")} dica="Impressões divididas pela frequência média: a Meta não soma alcance entre dias." />
        <Kpi rotulo="Frequência" valor={decimal(totais.frequencia)} />
        {extras.roas !== null ? (
          <Kpi rotulo="ROAS" valor={`${decimal(extras.roas)}x`} dica={`Valor de compra medido pelo pixel: ${brl(extras.valor_conversao)}.`} />
        ) : (
          <Kpi rotulo="Custo por clique" valor={brl(extras.cpc_link !== null ? extras.cpc_link : totais.cpc)} bomQuandoSobe={false} />
        )}
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ saldo

/** Saldo, gasto total, limite e situação de cada conta ligada. */
export function SaldosDasContas({ contas }: { contas: SaldoDaConta[] }) {
  if (!contas.length) return null;
  return (
    <section aria-label="Saldo das contas" className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
      {contas.map((c) => (
        <div key={c.external_account_id} className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5">
          <p className="flex min-w-0 items-center text-[12.5px] font-semibold">
            <Wallet className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">{c.nome || `Conta ${c.numero}`}</span>
            {c.status && <span className="ml-2 shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-normal text-muted-foreground">{c.status}</span>}
          </p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">Saldo disponível</dt>
              <dd className="truncate font-medium tabular-nums">{c.saldo_disponivel !== null ? brl(c.saldo_disponivel) : c.pre_paga === false ? "pós-pago" : "-"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">Gasto total</dt>
              <dd className="truncate font-medium tabular-nums">{brl(c.gasto_total)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">Limite da conta</dt>
              <dd className="truncate font-medium tabular-nums">{c.limite_de_gasto !== null ? brl(c.limite_de_gasto) : "sem limite"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">{c.pre_paga ? "Cobrança" : "A pagar"}</dt>
              <dd className="truncate font-medium tabular-nums">{c.pre_paga ? "pré-paga" : brl(c.saldo_a_pagar)}</dd>
            </div>
          </dl>
          {(c.pagamento || c.coletado_em) && (
            <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
              {[c.pagamento, c.empresa, c.coletado_em ? `lida ${dataEHora(c.coletado_em)}` : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          {c.erro && (
            <p className="mt-1 flex items-start text-[11px] text-destructive">
              <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">A Meta recusou parte da leitura: {c.erro}</span>
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ tendência

/** Gasto por dia (barras) e resultados (pontos), num SVG simples. */
export function TendenciaDiaria({ serie, rotulo }: { serie: PontoDaConta[]; rotulo: string }) {
  if (serie.length < 2) return null;
  const L = 600;
  const A = 120;
  const passo = L / serie.length;
  const maiorGasto = Math.max.apply(null, serie.map((p) => p.gasto).concat([0.01]));
  const maiorRes = Math.max.apply(null, serie.map((p) => p.resultados).concat([1]));
  const pontos = serie.map((p, i) => `${(i + 0.5) * passo},${A - (p.resultados / maiorRes) * (A - 8) - 4}`).join(" ");
  return (
    <section aria-label="Tendência diária" className="min-w-0 rounded-xl border border-border bg-card p-3">
      <div className="flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
        <TrendingUp className="mr-1.5 h-3.5 w-3.5 text-primary" />
        <span className="mr-3 font-medium uppercase tracking-wider">Por dia</span>
        <span className="mr-3 inline-flex items-center"><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-primary/60" />Investimento</span>
        <span className="inline-flex items-center"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-foreground" />{rotulo}</span>
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" className="mt-2 block h-28 w-full" role="img" aria-label={`Investimento e ${rotulo.toLowerCase()} por dia`}>
        {serie.map((p, i) => {
          const h = Math.max(1, (p.gasto / maiorGasto) * (A - 4));
          return (
            <rect key={p.dia} x={i * passo + passo * 0.15} y={A - h} width={passo * 0.7} height={h} rx={1.5} className="fill-primary/50">
              <title>{`${dataCurta(p.dia)}: ${brl(p.gasto)}, ${inteiro(p.resultados)} ${rotulo.toLowerCase()}`}</title>
            </rect>
          );
        })}
        <polyline points={pontos} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{dataCurta(serie[0].dia)}</span>
        <span>{dataCurta(serie[serie.length - 1].dia)}</span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ campanhas

function statusCurto(s: string): string {
  const t = String(s || "").toUpperCase();
  if (t === "ACTIVE") return "Ativa";
  if (t.indexOf("PAUSED") >= 0) return "Pausada";
  if (t === "ARCHIVED" || t === "DELETED") return "Encerrada";
  return s ? humanizar(s.toLowerCase()) : "";
}

const objetivoCurto = (o: string) => (o ? humanizar(o.toLowerCase().replace(/^outcome_/, "")) : "");

/** Tabela das campanhas: clique numa linha filtra os anúncios dela. */
export function TabelaDeCampanhas({
  campanhas,
  rotuloPorId,
  selecionada,
  onSelecionar,
}: {
  campanhas: CampanhaAoVivo[];
  rotuloPorId: Record<string, string>;
  selecionada: string;
  onSelecionar: (id: string) => void;
}) {
  if (!campanhas.length) return null;
  return (
    <section className="min-w-0" aria-label="Campanhas">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Campanhas ({campanhas.length})</h3>
      <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-border text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Campanha</th>
              <th className="px-2 py-2 text-right font-medium">Investido</th>
              <th className="px-2 py-2 text-right font-medium">Resultados</th>
              <th className="px-2 py-2 text-right font-medium">Custo cada</th>
              <th className="px-2 py-2 text-right font-medium">CTR</th>
              <th className="px-3 py-2 text-right font-medium">CPM</th>
            </tr>
          </thead>
          <tbody>
            {campanhas.map((c) => {
              const ativa = selecionada === c.campaign_id;
              const m = c.metricas;
              return (
                <tr key={c.campaign_id || c.nome} className={`border-b border-border last:border-b-0 ${ativa ? "bg-primary/5" : ""}`}>
                  <td className="max-w-[260px] px-3 py-2">
                    <button type="button" aria-pressed={ativa} onClick={() => onSelecionar(ativa ? "" : c.campaign_id)} className="block w-full min-w-0 text-left" title="Filtrar os anúncios desta campanha">
                      <span className="block truncate font-semibold">{c.nome}</span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {[statusCurto(c.status), objetivoCurto(c.objetivo), c.orcamento_diario !== null ? `${brl(c.orcamento_diario)} por dia` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{brl(m.gasto)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {inteiro(m.resultados)}
                    {rotuloPorId[c.campaign_id] ? <span className="block text-[10px] text-muted-foreground">{rotuloPorId[c.campaign_id].toLowerCase()}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{brl(m.custo_por_resultado)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{porcento(m.ctr_saida !== null ? m.ctr_saida : m.ctr)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(m.cpm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ desempenho do cliente

/** Orgânico + anúncios no mesmo período, carregado só quando a equipe abre. */
export function PainelDoDesempenho({ dias }: { dias: number }) {
  const { clientId } = useMesa();
  const [aberto, setAberto] = useState(false);
  const q = useQuery({ queryKey: chavesConta.desempenho(clientId, dias), queryFn: () => lerDesempenho(clientId, dias), enabled: aberto, staleTime: 5 * 60_000, retry: false });
  const d = q.data || null;
  return (
    <section aria-label="Desempenho do cliente" className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 flex-wrap items-center">
        <div className="mb-1 mr-3 min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold">Desempenho do cliente: perfil e anúncios juntos</h3>
          <p className="text-[11.5px] text-muted-foreground">Instagram orgânico e conta de anúncios no mesmo período. Grátis.</p>
        </div>
        {!aberto && (
          <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => setAberto(true)}>
            Ver desempenho
          </Button>
        )}
      </div>
      {q.isError && <AvisoDeErro erro={q.error} />}
      {aberto && q.isLoading && <div className="mt-3 h-24 animate-pulse rounded-lg bg-muted/60" aria-busy="true" />}
      {d && (
        <div className="mt-3 min-w-0 space-y-3">
          <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi rotulo="Alcance somado (aprox.)" valor={inteiro(d.somado.alcance_aprox)} dica={d.somado.explicacao} />
            <Kpi rotulo="Interações somadas" valor={inteiro(d.somado.interacoes)} dica={d.somado.explicacao} />
            <Kpi rotulo="Seguidores" valor={inteiro(d.organico.seguidores)} variacao={null} dica={d.organico.seguidores_variacao !== null ? `Variação no período: ${d.organico.seguidores_variacao > 0 ? "+" : ""}${d.organico.seguidores_variacao}` : undefined} />
            <Kpi rotulo={`${d.anuncios.resultado_rotulo} (anúncios)`} valor={inteiro(d.anuncios.resultados)} dica={`Custo por resultado: ${brl(d.anuncios.custo_por_resultado)}`} />
          </dl>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-border p-3 text-[12px]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Orgânico</p>
              <p className="mt-1 tabular-nums">
                {inteiro(d.organico.posts)} posts ({inteiro(d.organico.posts_medidos)} com alcance medido) · alcance semanal {inteiro(d.organico.alcance_semanas)}
              </p>
              <p className="mt-0.5 tabular-nums text-muted-foreground">
                {inteiro(d.organico.curtidas)} curtidas · {inteiro(d.organico.comentarios)} comentários · {inteiro(d.organico.salvos)} salvamentos · {inteiro(d.organico.compartilhamentos)} compartilhamentos
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-border p-3 text-[12px]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Anúncios</p>
              {d.anuncios.conectada ? (
                <p className="mt-1 tabular-nums">
                  Investido {brl(d.anuncios.gasto)} · alcance aprox. {inteiro(d.anuncios.alcance)}
                  {d.anuncios.roas !== null ? ` · ROAS ${decimal(d.anuncios.roas)}x` : ""}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">Sem conta de anúncios ligada.</p>
              )}
            </div>
          </div>
          {d.organico.melhores.length > 0 && (
            <div className="min-w-0">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Posts que mais alcançaram</p>
              <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6">
                {d.organico.melhores.map((p) => (
                  <a key={p.id} href={p.link || undefined} target="_blank" rel="noreferrer" className="block min-w-0" title={p.legenda}>
                    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-secondary/40" style={{ paddingTop: "100%" }}>
                      <div className="absolute inset-0">
                        <Foto src={p.imagem_url} alt={p.legenda || "Post"} className="h-full w-full" />
                      </div>
                    </div>
                    <p className="mt-0.5 truncate text-[10.5px] tabular-nums text-muted-foreground">{inteiro(p.alcance)} alcance</p>
                  </a>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10.5px] text-muted-foreground">{d.somado.explicacao}</p>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ evolução

function ListaDeItens({ titulo, tom, itens, porItem, vazio }: { titulo: string; tom: string; itens: ItemDaEvolucao[]; porItem: Record<string, string>; vazio: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${tom}`}>
        {titulo} ({itens.length})
      </p>
      {itens.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {itens.slice(0, 8).map((i) => (
            <li key={`${i.canal}-${i.id}`} className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] gap-2 text-[12px] leading-snug">
              <div className="relative w-10 overflow-hidden rounded border border-border bg-secondary/40" style={{ paddingTop: "100%" }}>
                <div className="absolute inset-0">
                  <Foto src={i.imagem_url} alt={i.nome} className="h-full w-full" />
                </div>
              </div>
              <div className="min-w-0">
                {i.link ? (
                  <a href={i.link} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{i.nome}</a>
                ) : (
                  <span className="block truncate font-medium">{i.nome}</span>
                )}
                <span className="block text-muted-foreground [overflow-wrap:anywhere]">{i.motivo}</span>
                {porItem[i.id] && <span className="mt-0.5 block text-foreground/80 [overflow-wrap:anywhere]">Por quê: {porItem[i.id]}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A evolução: o que venceu, o que manter, o que descartar (com motivo e
 * número), o que o conteúdo orgânico ensina, os próximos testes e os
 * aprendizados que ficam gravados na memória dos agentes.
 */
export function PainelDaEvolucao({ dias }: { dias: number }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [explicada, setExplicada] = useState<LeituraDaEvolucao | null>(null);
  const chave = chavesConta.evolucao(clientId, dias);
  const q = useQuery({ queryKey: chave, queryFn: () => lerEvolucao(clientId, dias, false), enabled: aberto, staleTime: 10 * 60_000, retry: false });
  const l = explicada || q.data || null;
  return (
    <section aria-label="Evolução" className="min-w-0 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex min-w-0 flex-wrap items-start">
        <TrendingUp className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="mb-1 mr-3 min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold">Evolução: o que está funcionando</h3>
          <p className="text-[11.5px] text-muted-foreground">
            Regras em código comparam cada anúncio com a média da conta e cada post com a média do perfil. Grátis. O estrategista explica o porquê, se você pedir.
          </p>
        </div>
        {!aberto ? (
          <Button type="button" size="sm" className="mb-1 h-8" onClick={() => setAberto(true)}>
            Ler evolução
          </Button>
        ) : (
          <span className="mb-1 inline-flex items-center">
            <BotaoComCusto
              rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Explicar com o estrategista</>}
              titulo="Explicar a evolução"
              descricao="O estrategista lê a evolução pronta (grupos e números do código) e escreve o porquê provável de cada item. Não muda nenhum número."
              variant="outline"
              className="h-8"
              disabled={!q.data || !!explicada}
              partes={() => partesDaAnaliseDaConta(catalogo)}
              executar={() => lerEvolucao(clientId, dias, true)}
              aoConcluir={(data) => {
                if (data) setExplicada(data as LeituraDaEvolucao);
                void queryClient.invalidateQueries({ queryKey: chave });
              }}
            />
          </span>
        )}
      </div>
      {q.isError && <AvisoDeErro erro={q.error} />}
      {aberto && q.isLoading && (
        <p className="flex items-center text-[12px] text-muted-foreground" aria-busy="true">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo anúncios e posts do período...
        </p>
      )}
      {l && evolucaoVazia(l) && <p className="text-[12.5px] text-muted-foreground">Sem anúncios nem posts medidos no período para comparar. Troque o período ou sincronize a conta.</p>}
      {l && !evolucaoVazia(l) && (
        <>
          {l.explicacao && l.explicacao.resumo && <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{l.explicacao.resumo}</p>}
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
            <ListaDeItens titulo="Vencedores" tom="text-success" itens={l.vencedores} porItem={l.explicacao ? l.explicacao.porItem : {}} vazio="Nenhum anúncio abaixo da média com volume." />
            <ListaDeItens titulo="Manter" tom="text-foreground" itens={l.manter} porItem={l.explicacao ? l.explicacao.porItem : {}} vazio="Nada neste grupo." />
            <ListaDeItens titulo="Descartar" tom="text-destructive" itens={l.descartar} porItem={l.explicacao ? l.explicacao.porItem : {}} vazio="Nada para cortar agora." />
          </div>
          {(l.destaques.length > 0 || l.abaixo.length > 0 || l.sinais.length > 0) && (
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
              <ListaDeItens titulo="Posts que funcionaram" tom="text-success" itens={l.destaques} porItem={l.explicacao ? l.explicacao.porItem : {}} vazio="Nenhum post acima da média." />
              <ListaDeItens titulo="Sinais do público" tom="text-info" itens={l.sinais} porItem={l.explicacao ? l.explicacao.porItem : {}} vazio="Sem sinal fora do comum." />
              <ListaDeItens titulo="Posts que não funcionaram" tom="text-warning" itens={l.abaixo} porItem={l.explicacao ? l.explicacao.porItem : {}} vazio="Nenhum post muito abaixo da média." />
            </div>
          )}
          {l.observar.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              {l.observar.length} anúncio{l.observar.length === 1 ? "" : "s"} ainda sem volume para decidir: {l.observar.slice(0, 4).map((i) => i.nome).join(", ")}
              {l.observar.length > 4 ? "..." : ""}.
            </p>
          )}
          {l.proximos_testes.length > 0 && (
            <div className="min-w-0">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Próximos testes</p>
              <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                {l.proximos_testes.map((t, k) => (
                  <li key={`${t.titulo}-${k}`} className="min-w-0 rounded-lg border border-border bg-card p-3 text-[12px] leading-snug">
                    <p className="font-semibold [overflow-wrap:anywhere]">{t.titulo}</p>
                    <p className="mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{t.hipotese}</p>
                    <p className="mt-1 [overflow-wrap:anywhere]"><span className="font-medium">Como:</span> {t.como}</p>
                    <p className="[overflow-wrap:anywhere]"><span className="font-medium">Métrica:</span> {t.metrica}. {t.criterio}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {l.aprendizados.length > 0 && (
            <div className="min-w-0 rounded-lg border border-border bg-card p-3">
              <p className="flex items-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Aprendizados para a Mesa
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {l.aprendizados.map((a, k) => (
                  <li key={k} className="min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
                    <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${a.tipo === "evitar" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>{a.tipo}</span>
                    <span className="mr-1 text-[10.5px] text-muted-foreground">{a.canal === "organico" ? "orgânico" : "anúncios"}:</span>
                    {a.texto}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10.5px] text-muted-foreground">
                {l.memorias.erro
                  ? `Não gravado na memória dos agentes: ${l.memorias.erro}`
                  : `Gravados na memória dos agentes: ${l.memorias.gravadas} novo${l.memorias.gravadas === 1 ? "" : "s"}${l.memorias.repetidas ? `, ${l.memorias.repetidas} já estava${l.memorias.repetidas === 1 ? "" : "m"} lá` : ""}.`}
              </p>
            </div>
          )}
          {(l.limites.length > 0 || (l.explicacao && l.explicacao.atencao.length > 0)) && (
            <ul className="space-y-0.5 text-[10.5px] text-muted-foreground">
              {(l.explicacao ? l.explicacao.atencao : []).concat(l.limites).map((x, k) => (
                <li key={k}>{x}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

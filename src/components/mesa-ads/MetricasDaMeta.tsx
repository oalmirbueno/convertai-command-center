import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Columns3, Layers, RefreshCw, Target } from "lucide-react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, foco, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { textoDoErro } from "@/lib/mesa/api";
import { brl, inteiro, tempoDesde } from "./adsApi";
import { CabecalhoDaParte } from "./Comuns";
import type { PeriodoDaConsulta } from "./periodoDaConta";
import {
  alternarColuna,
  buscarMetricas,
  buscarNoTempo,
  chaveDasMetricas,
  chaveDoTempo,
  colunasPadrao,
  colunasValidas,
  formatar,
  NIVEIS_DA_METRICA,
  OBJETIVOS_DO_SELETOR,
  valorDaColuna,
  type FaixaDoTempo,
  type IdDoObjetivo,
  type MelhorHorario,
  type MetricaDoCatalogo,
  type NivelDaMetrica,
} from "./metricasMetaApi";

/**
 * Números da Meta (frente ADM, 01/10/2026): o bloco da Conta que mostra os
 * números como o Gerenciador, lidos na Meta na hora com a mesma janela de
 * atribuição. O dono escolhe o objetivo (Mensagens, Leads, Tráfego,
 * Engajamento, Vendas, Reconhecimento, Vídeo, Seguidores ou Todos), o nível
 * (conta, campanhas, conjuntos, anúncios) e as colunas (conjuntos prontos por
 * objetivo, a escolha lembrada por cliente). Embaixo, por horário: em que
 * hora e em que dia da semana as conversas e os resultados acontecem.
 *
 * Conversa nunca é chamada de engajamento: o resultado de cada linha segue o
 * objetivo do conjunto (calculado no servidor, modulos/metricas-meta.ts).
 */

function Aviso({ children }: { children: string }) {
  return (
    <p className="flex items-start text-[12px] leading-snug text-warning" role="status">
      <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

function NumeroDaMeta({ metrica, valor, rotulo }: { metrica: MetricaDoCatalogo; valor: number | null; rotulo?: string }) {
  return (
    <div className={juntar(superficie.painel, "min-w-0 px-3 py-2.5")} data-metrica={metrica.id}>
      <dt className="flex min-w-0 items-center">
        <span className="truncate text-[12px] text-muted-foreground" title={rotulo || metrica.rotulo}>{rotulo || metrica.rotulo}</span>
        <AjudaRecolhida className="ml-1 shrink-0" rotulo={`O que é ${rotulo || metrica.rotulo}?`} titulo={rotulo || metrica.rotulo}>
          {metrica.ajuda}
        </AjudaRecolhida>
      </dt>
      <dd className="mt-0.5 truncate text-[24px] font-semibold tabular-nums">{formatar(valor, metrica.formato)}</dd>
    </div>
  );
}

function EscolherColunas({
  aberta,
  onFechar,
  catalogo,
  colunas,
  padrao,
  rotuloDoPadrao,
  onMudar,
}: {
  aberta: boolean;
  onFechar: () => void;
  catalogo: MetricaDoCatalogo[];
  colunas: string[];
  padrao: string[];
  rotuloDoPadrao: string;
  onMudar: (c: string[]) => void;
}) {
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo="O que ver"
      ajuda="Marque as métricas que aparecem nos números e na tabela. A escolha fica guardada para este cliente e este objetivo."
      descricao={`${colunas.length} de ${catalogo.length} marcadas`}
      largura="md"
      rodape={
        <div className="flex w-full flex-wrap items-center justify-end">
          <button type="button" className={juntar(botao.discreto, "mb-1 mr-2 h-9")} onClick={() => onMudar(padrao)}>
            Usar o padrão de {rotuloDoPadrao}
          </button>
          <button type="button" className={juntar(botao.primario, "mb-1 h-9")} onClick={onFechar}>
            Pronto
          </button>
        </div>
      }
    >
      <ul className="-mx-2" aria-label="Métricas">
        {catalogo.map((m) => {
          const marcada = colunas.indexOf(m.id) >= 0;
          return (
            <li key={m.id}>
              <label className={juntar("flex cursor-pointer items-start rounded-md px-2 py-2 hover:bg-muted/40", foco)}>
                <input type="checkbox" aria-label={m.rotulo} className="mr-2.5 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={marcada} onChange={() => onMudar(alternarColuna(colunas, m.id))} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{m.rotulo}</span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">{m.ajuda}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </JanelaCentral>
  );
}

const valorDaFaixa = (f: FaixaDoTempo, chave: "resultados" | "conversas" | "cliques_link") => Number(f[chave] || 0);

/** Barras por hora (ou dia da semana): uma cor, a melhor faixa em destaque, o número no "title" e a tabela embaixo. */
export function GraficoNoTempo({
  faixas,
  melhor,
  chave,
  rotuloDaMedida,
  modo,
}: {
  faixas: FaixaDoTempo[];
  melhor: MelhorHorario;
  chave: "resultados" | "conversas" | "cliques_link";
  rotuloDaMedida: string;
  modo: "hora" | "dia_da_semana";
}) {
  const maior = faixas.reduce((m, f) => Math.max(m, valorDaFaixa(f, chave)), 0);
  // Pouco volume: nenhuma barra em destaque e nenhum "melhor" (seria sorte, não padrão).
  const confiavel = !melhor.pouco_volume;
  const emDestaque = (i: number) => {
    if (!confiavel) return false;
    if (melhor.melhor && melhor.melhor.indice === i) return true;
    if (modo === "hora" && melhor.faixa) {
      const { inicio } = melhor.faixa;
      return i === inicio || i === (inicio + 1) % 24 || i === (inicio + 2) % 24;
    }
    return false;
  };
  const total = faixas.reduce((s, f) => s + valorDaFaixa(f, chave), 0);
  return (
    <div className="min-w-0">
      {total > 0 && confiavel ? (
        <p className="text-[13px] leading-snug" data-melhor={melhor.melhor ? melhor.melhor.indice : ""}>
          {melhor.melhor && (
            <>
              <span className="font-semibold">{modo === "hora" ? `Melhor hora: ${melhor.melhor.rotulo}` : `Melhor dia: ${melhor.melhor.rotulo}`}</span>
              <span className="text-muted-foreground">
                {" "}({rotuloDaMedida}: {inteiro(melhor.melhor.valor)}{melhor.melhor.custo !== null ? `, ${brl(melhor.melhor.custo)} cada` : ""})
              </span>
            </>
          )}
          {modo === "hora" && melhor.faixa && (
            <span className="text-muted-foreground">
              {" · "}3 horas mais fortes: <span className="text-foreground">{melhor.faixa.rotulo}</span> ({melhor.faixa.pct}% do total)
            </span>
          )}
        </p>
      ) : total > 0 ? (
        <p className="text-[13px] leading-snug text-muted-foreground" data-pouco-volume="sim">
          {rotuloDaMedida}: {inteiro(total)} no período, pouco para apontar o melhor horário.
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">Sem {rotuloDaMedida.toLowerCase()} no período.</p>
      )}
      <div className="mt-3 flex h-[132px] min-w-0 items-end border-b border-border" role="img" aria-label={`${rotuloDaMedida} por ${modo === "hora" ? "hora do dia" : "dia da semana"}`}>
        {faixas.map((f) => {
          const v = valorDaFaixa(f, chave);
          const altura = maior > 0 ? Math.max(v > 0 ? 4 : 0, Math.round((v / maior) * 120)) : 0;
          const dica = `${f.rotulo}: ${inteiro(v)} ${rotuloDaMedida.toLowerCase()} · ${brl(f.gasto)} investidos${v > 0 ? ` · ${brl(f.gasto / v)} cada` : ""}`;
          return (
            <div key={f.indice} className="flex h-full min-w-0 flex-1 items-end px-px" title={dica} aria-label={dica} data-faixa={f.indice} data-valor={v}>
              <div className={juntar("w-full rounded-t", emDestaque(f.indice) ? "bg-primary" : "bg-primary/35")} style={{ height: `${altura}px` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex min-w-0" aria-hidden="true">
        {faixas.map((f) => (
          <span key={f.indice} className={juntar("min-w-0 flex-1 whitespace-nowrap text-[11px] text-muted-foreground", modo === "hora" ? "text-left" : "text-center")}>
            {modo === "hora" ? (
              <>
                <span className="sm:hidden">{f.indice % 6 === 0 ? f.rotulo : ""}</span>
                <span className="hidden sm:inline">{f.indice % 3 === 0 ? f.rotulo : ""}</span>
              </>
            ) : (
              f.rotulo.slice(0, 3)
            )}
          </span>
        ))}
      </div>
      <details className="mt-2">
        <summary className={juntar("cursor-pointer rounded text-[12px] text-muted-foreground hover:text-foreground", foco)}>Ver em tabela</summary>
        <div className="mt-2">
          <table className="w-full text-[12px] tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">{modo === "hora" ? "Hora" : "Dia"}</th>
                <th className="py-1 pr-3 text-right font-medium">{rotuloDaMedida}</th>
                <th className="py-1 pr-3 text-right font-medium">Investido</th>
                <th className="py-1 text-right font-medium">Custo cada</th>
              </tr>
            </thead>
            <tbody>
              {faixas.map((f) => {
                const v = valorDaFaixa(f, chave);
                return (
                  <tr key={f.indice} className="border-t border-border/50">
                    <td className="py-1 pr-3">{f.rotulo}</td>
                    <td className="py-1 pr-3 text-right">{inteiro(v)}</td>
                    <td className="py-1 pr-3 text-right">{brl(f.gasto)}</td>
                    <td className="py-1 text-right">{v > 0 ? brl(f.gasto / v) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function PorHorario({ clientId, periodo, objetivo }: { clientId: string; periodo: PeriodoDaConsulta; objetivo: IdDoObjetivo | "" }) {
  const [modo, setModo] = useEstadoDaTela<"hora" | "dia_da_semana">(`mesa-ads:conta:metricas:tempo:${clientId}`, "hora", { validar: (v) => v === "hora" || v === "dia_da_semana", esperaMs: 0 });
  const q = useQuery({
    queryKey: chaveDoTempo(clientId, periodo, objetivo),
    queryFn: () => buscarNoTempo(clientId, periodo, objetivo),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const d = q.data || null;
  const atual = d ? (modo === "hora" && d.hora ? d.hora : d.diaDaSemana) : null;
  const modoReal = d && modo === "hora" && !d.hora ? "dia_da_semana" : modo;
  return (
    <section className="min-w-0 border-t border-border pt-4" aria-label="Por horário">
      <CabecalhoDaParte
        nivel={3}
        titulo="Por horário"
        ajuda="Em que hora do dia (no fuso da conta de anúncios) e em que dia da semana as conversas e os resultados começam, pela quebra por hora da própria Meta. A hora é a do anúncio entregue, não a da resposta da equipe."
        descricao={d ? d.medida.rotulo : undefined}
        acoes={
          <SeletorCompacto
            rotulo="Ver por"
            icone={<Clock className="h-3.5 w-3.5" />}
            opcoes={[{ valor: "hora", rotulo: "Hora do dia" }, { valor: "dia_da_semana", rotulo: "Dia da semana" }]}
            valor={modoReal}
            onEscolher={(v) => setModo(v as "hora" | "dia_da_semana")}
          />
        }
      />
      {q.isLoading && <Carregando rotulo="Lendo os horários na Meta" />}
      {q.isError && <EstadoDeErro titulo="Os horários não vieram." descricao={textoDoErro(q.error)} />}
      {d && (
        <div className="min-w-0 space-y-2">
          {d.avisos.map((a) => (
            <Aviso key={a}>{a}</Aviso>
          ))}
          {atual && <GraficoNoTempo faixas={atual.faixas} melhor={atual.melhor} chave={d.medida.chave} rotuloDaMedida={d.medida.rotulo} modo={modoReal} />}
        </div>
      )}
    </section>
  );
}

export default function MetricasDaMeta({ clientId, periodo, rotuloDoPeriodo }: { clientId: string; periodo: PeriodoDaConsulta; rotuloDoPeriodo: string }) {
  const queryClient = useQueryClient();
  const [objetivo, setObjetivo] = useEstadoDaTela<IdDoObjetivo | "">(`mesa-ads:conta:metricas:objetivo:${clientId}`, "", { validar: (v) => typeof v === "string", esperaMs: 0 });
  const [nivel, setNivel] = useEstadoDaTela<NivelDaMetrica>(`mesa-ads:conta:metricas:nivel:${clientId}`, "campanha", { validar: (v) => NIVEIS_DA_METRICA.some((n) => n.valor === v), esperaMs: 0 });
  const [escolhidas, setEscolhidas] = useEstadoDaTela<string[] | null>(`mesa-ads:conta:metricas:colunas:${clientId}:${objetivo || "todos"}`, null, { validar: (v) => v === null || Array.isArray(v), esperaMs: 0 });
  const [recolhido, setRecolhido] = useRecolhido("mesa-ads:conta:bloco:metricas", false);
  const [escolhendo, setEscolhendo] = useState(false);
  const [relendo, setRelendo] = useState(false);
  const q = useQuery({
    queryKey: chaveDasMetricas(clientId, periodo, nivel, objetivo),
    queryFn: () => buscarMetricas(clientId, periodo, nivel, objetivo),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
    enabled: !recolhido,
  });
  const d = q.data || null;
  const padrao = d ? colunasPadrao(d, objetivo) : [];
  const colunas = d ? colunasValidas(escolhidas, d.catalogo, padrao) : [];
  const metricas = d ? colunas.map((id) => d.catalogo.filter((m) => m.id === id)[0]).filter((m): m is MetricaDoCatalogo => !!m) : [];
  const objetivoEscolhido = OBJETIVOS_DO_SELETOR.filter((o) => o.valor === objetivo)[0] || OBJETIVOS_DO_SELETOR[0];
  const presentes = d ? d.objetivos : [];
  const opcoesDeObjetivo = OBJETIVOS_DO_SELETOR.map((o) => {
    const t = presentes.filter((p) => p.objetivo === o.valor)[0];
    return { valor: o.valor, rotulo: o.valor && d ? `${o.rotulo}${t ? ` (${t.campanhas})` : ""}` : o.rotulo, descricao: t ? `${inteiro(t.numeros.resultados)} ${t.resultado_rotulo.toLowerCase()} · ${brl(t.numeros.gasto)}` : o.valor ? "Nada deste objetivo no período" : "Todas as campanhas" };
  });
  const releer = async () => {
    setRelendo(true);
    try {
      const nova = await buscarMetricas(clientId, periodo, nivel, objetivo, true);
      queryClient.setQueryData(chaveDasMetricas(clientId, periodo, nivel, objetivo), nova);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "ads-metricas-hora", clientId] });
    } catch {
      void q.refetch();
    } finally {
      setRelendo(false);
    }
  };

  return (
    <section className="min-w-0" aria-label="Números da Meta" data-objetivo={objetivo || "todos"} data-nivel={nivel}>
      <CabecalhoDaParte
        titulo="Números da Meta"
        ajuda={
          <>
            Lidos na Meta agora, {rotuloDoPeriodo}, com a mesma janela de atribuição do Gerenciador{d && d.janela ? ` (${d.janela})` : ""}. O resultado de cada linha segue o objetivo do conjunto: campanha de mensagem conta conversa iniciada, nunca curtida ou clique. Toque no "?" de cada número para ver o que ele mede.
          </>
        }
        descricao={d ? `${d.fonte === "coleta" ? "Coleta do painel" : "Meta ao vivo"} · lido ${tempoDesde(d.lidoEm)}${q.isFetching ? " · relendo" : ""}` : undefined}
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo: d ? `${objetivoEscolhido.rotulo}: ${inteiro(d.total.numeros.resultados)} ${d.total.misto ? "resultados" : d.total.resultado_rotulo.toLowerCase()}` : undefined }}
        acoes={
          <>
            <SeletorCompacto rotulo="Objetivo" icone={<Target className="h-3.5 w-3.5" />} modo="lista" opcoes={opcoesDeObjetivo} valor={objetivo} onEscolher={(v) => setObjetivo(v as IdDoObjetivo | "")} />
            <SeletorCompacto rotulo="Nível" icone={<Layers className="h-3.5 w-3.5" />} modo="lista" opcoes={NIVEIS_DA_METRICA.map((n) => ({ valor: n.valor, rotulo: n.rotulo }))} valor={nivel} onEscolher={(v) => setNivel(v as NivelDaMetrica)} />
            <button type="button" className={juntar(botao.secundario, "h-9")} disabled={!d} onClick={() => setEscolhendo(true)}>
              <Columns3 className="mr-1 h-3.5 w-3.5" />
              O que ver
            </button>
            <button type="button" className={juntar(botao.icone, "h-9 w-9")} disabled={relendo} onClick={() => void releer()} aria-label="Ler na Meta de novo" title="Ler na Meta de novo">
              <RefreshCw className={juntar("h-3.5 w-3.5", relendo ? "animate-spin" : "")} />
            </button>
          </>
        }
      />
      {!recolhido && (
        <div className="min-w-0 space-y-4">
          {q.isLoading && <Carregando forma="aba" rotulo="Lendo os números na Meta" />}
          {q.isError && <EstadoDeErro titulo="Os números não vieram." descricao={textoDoErro(q.error)} />}
          {d && (
            <>
              {d.avisos.length > 0 && (
                <div className="min-w-0 space-y-1">
                  {d.avisos.map((a) => (
                    <Aviso key={a}>{a}</Aviso>
                  ))}
                </div>
              )}

              {!objetivo && presentes.length > 0 && (
                <div className="min-w-0" aria-label="Resultados por objetivo">
                  <p className={texto.rotulo}>Resultados por objetivo</p>
                  <div className="mt-1.5 flex min-w-0 flex-wrap">
                    {presentes.map((p) => (
                      <button key={p.objetivo} type="button" onClick={() => setObjetivo(p.objetivo)} className={juntar("mb-1.5 mr-2 rounded-md border border-border px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/40", foco)} data-objetivo-total={p.objetivo}>
                        <span className="font-medium">{p.rotulo}</span>{" "}
                        <span className="tabular-nums text-muted-foreground">
                          {p.por_resultado.length > 1
                            ? p.por_resultado.map((r) => `${inteiro(r.valor)} ${r.rotulo.toLowerCase()}`).join(" + ")
                            : `${p.resultado === "alcance" ? inteiro(p.numeros.alcance) : inteiro(p.numeros.resultados)} ${p.resultado_rotulo.toLowerCase()}`}
                          {p.numeros.custo_por_resultado !== null && p.numeros.custo_por_resultado !== undefined ? ` · ${brl(p.numeros.custo_por_resultado)} cada` : ""}
                          {` · ${brl(p.numeros.gasto)}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {metricas.length > 0 ? (
                <dl className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" aria-label="Números do período">
                  {metricas.map((m) => (
                    <NumeroDaMeta key={m.id} metrica={m} valor={valorDaColuna(d.total.numeros, m.id)} rotulo={m.id === "resultados" ? (d.total.misto ? "Resultados (objetivos misturados)" : d.total.resultado_rotulo) : undefined} />
                  ))}
                </dl>
              ) : (
                <EstadoVazio compacto titulo="Nenhuma métrica marcada." descricao="Abra O que ver e marque as métricas." />
              )}

              {nivel !== "conta" &&
                (d.itens.length === 0 ? (
                  <EstadoVazio compacto titulo="Nada neste recorte." descricao={objetivo ? "Nenhuma campanha deste objetivo teve entrega no período." : "Nenhuma entrega no período."} />
                ) : (
                  <div className="min-w-0 overflow-x-auto" role="region" aria-label="Tabela de números" tabIndex={0}>
                    <table className="w-full min-w-[640px] text-[12px] tabular-nums">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">{NIVEIS_DA_METRICA.filter((n) => n.valor === nivel)[0].rotulo.replace(/s$/, "")}</th>
                          <th className="py-2 pr-3 font-medium">Resultado</th>
                          {metricas.map((m) => (
                            <th key={m.id} className="whitespace-nowrap py-2 pr-3 text-right font-medium" title={m.ajuda}>
                              {m.id === "resultados" ? "Resultados" : m.rotulo}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {d.itens.map((i) => (
                          <tr key={i.id} className="border-b border-border/50 hover:bg-muted/30" data-item={i.id}>
                            <td className="max-w-[280px] py-2 pr-3">
                              <span className="block truncate text-[13px] font-medium" title={i.nome}>{i.nome}</span>
                              {(i.campanha && nivel !== "campanha") && <span className="block truncate text-[11px] text-muted-foreground">{i.campanha}</span>}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{i.resultado_rotulo}</td>
                            {metricas.map((m) => (
                              <td key={m.id} className="whitespace-nowrap py-2 pr-3 text-right">
                                {formatar(valorDaColuna(i.numeros, m.id), m.formato)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

              <PorHorario clientId={clientId} periodo={periodo} objetivo={objetivo} />

              <EscolherColunas
                aberta={escolhendo}
                onFechar={() => setEscolhendo(false)}
                catalogo={d.catalogo}
                colunas={colunas}
                padrao={padrao}
                rotuloDoPadrao={objetivoEscolhido.rotulo}
                onMudar={(c) => setEscolhidas(c)}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

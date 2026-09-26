import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, FileSearch, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, dataEHora } from "@/lib/mesa/api";
import {
  brl,
  chamarAds,
  chavesAds,
  decimal,
  humanizar,
  inteiro,
  lerUltimaAnalise,
  normalizarAnalise,
  normalizarConta,
  partesDaAnaliseDaConta,
  partesDoPlanoV2,
  porcento,
  rotuloDoCta,
  rotuloDoObjetivo,
  SINAIS,
  tempoDesde,
  type AnaliseDaConta,
  type AnuncioAoVivo,
  type ContaAoVivo,
  type PedidoDePlano,
  type SinalDoAnuncio,
} from "./adsApi";
import { Andamento, Diagnostico, Foto, pilula, SeloDoSinal, useAndamento } from "./Comuns";
import JanelaDaReferencia from "./JanelaDaReferencia";
import { PainelDaEvolucao, PainelDoDesempenho, ResumoDaConta, SaldosDasContas, TabelaDeCampanhas, TendenciaDiaria } from "./ContaPaineis";
import { PERIODOS_DA_CONTA_V4, type PeriodoDaConta } from "./contaApi";
import AgenteSenior from "./AgenteSenior";
import AtivarGestao from "./AtivarGestao";
import { BaixarPacoteDeOtimizacao, ImportarPacote } from "./PacoteDeOtimizacao";
import { FiltroDeObjetivo, PainelDeResultados, ResumoDoTopo } from "./ResultadosClaros";
import { chaveDosResultados, lerContaComResultados, type GrupoDeObjetivo } from "./resultadosApi";

/**
 * Conta ao vivo: tudo o que está rodando na conta de anúncios do cliente
 * (conta_ao_vivo, grátis): campanhas com status, objetivo e orçamento, e
 * cada anúncio com a miniatura, a copy, as métricas do período, a tendência
 * e o sinal (escalar, manter, observar, renovar, pausar), que é regra em
 * código, nunca IA. "Sincronizar agora" pede a coleta da Meta e relê em
 * seguida; enquanto a aba está aberta, relê sozinha a cada 10 minutos.
 * "Analisar com o estrategista" (conta_analisar) diz o que escalar, pausar e
 * renovar, o que a copy ensina e os próximos testes, que viram plano com um
 * clique. Em cada anúncio: "Criar variações deste" e "Abrir ficha".
 *
 * v4 (frente E, 25/09): período de 7 a 90 dias, resumo com a comparação com
 * o período anterior, saldo e situação de cada conta, tendência diária,
 * tabela de campanhas, resultado certo para o objetivo de cada campanha,
 * anúncios em páginas de 12, desempenho do cliente (perfil e anúncios
 * juntos) e evolução (vencedores, manter, descartar, próximos testes e
 * aprendizados gravados para os agentes). Trocar de período mostra os
 * números anteriores até os novos chegarem.
 */

export const PERIODOS_DA_CONTA: PeriodoDaConta[] = PERIODOS_DA_CONTA_V4.slice();
/** Anúncios por página: a lista cresce no "Mostrar mais", sem montar 200 cartões de uma vez. */
export const ANUNCIOS_POR_PAGINA = 12;
export const RELEITURA_DA_CONTA_MS = 10 * 60_000;
/** Depois de pedir a coleta, espera a Meta responder antes de reler. */
export const ESPERA_DA_SINCRONIA_MS = 8000;

const ORDEM_DO_SINAL: SinalDoAnuncio[] = ["escalar", "pausar", "renovar", "observar", "manter", "sem_dados"];

export function ordenarAnuncios(lista: AnuncioAoVivo[]): AnuncioAoVivo[] {
  return lista.slice().sort((a, b) => {
    const s = ORDEM_DO_SINAL.indexOf(a.sinal) - ORDEM_DO_SINAL.indexOf(b.sinal);
    if (s !== 0) return s;
    return (b.metricas.gasto || 0) - (a.metricas.gasto || 0);
  });
}

function Variacao({ rotulo, valor, bomQuandoSobe }: { rotulo: string; valor: number | null; bomQuandoSobe: boolean }) {
  if (valor === null) return null;
  const sobe = valor > 0;
  const bom = valor === 0 ? null : sobe === bomQuandoSobe;
  const tom = bom === null ? "text-muted-foreground" : bom ? "text-success" : "text-destructive";
  return (
    <span className={`mr-3 whitespace-nowrap text-[11px] tabular-nums ${tom}`}>
      {rotulo} {sobe ? "+" : ""}
      {Math.round(valor)}%
    </span>
  );
}

function statusLegivel(s: string): string {
  const t = String(s || "").toUpperCase();
  if (t === "ACTIVE") return "Ativo";
  if (t === "PAUSED" || t === "CAMPAIGN_PAUSED" || t === "ADSET_PAUSED") return "Pausado";
  if (t === "ARCHIVED" || t === "DELETED") return "Encerrado";
  if (t === "WITH_ISSUES" || t === "DISAPPROVED") return "Com problema";
  if (t === "PENDING_REVIEW" || t === "IN_PROCESS") return "Em análise";
  return s ? humanizar(s.toLowerCase()) : "";
}

function CartaoDoAnuncio({
  a,
  onVariar,
  onFicha,
  abrindo,
  rotuloDoResultado,
  formato,
  conjunto,
}: {
  a: AnuncioAoVivo;
  onVariar: () => void;
  onFicha: () => void;
  abrindo: boolean;
  rotuloDoResultado?: string;
  formato?: string;
  conjunto?: string;
}) {
  const { catalogo } = useMesa();
  const m = a.metricas;
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-3" aria-label={`Anúncio ${a.nome}`} data-ad={a.ad_id}>
      <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 sm:grid-cols-[112px_minmax(0,1fr)]">
        <button type="button" onClick={onFicha} className="block min-w-0 self-start overflow-hidden rounded-lg border border-border bg-secondary/40" aria-label={`Ver ${a.nome}`}>
          <div className="relative w-full" style={{ paddingTop: "125%" }}>
            <div className="absolute inset-0">
              <Foto src={a.imagem_url} alt={a.nome} className="h-full w-full" />
            </div>
          </div>
        </button>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold" title={a.nome}>
                {a.nome}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{[a.campanha, conjunto, formato === "video" ? "Vídeo" : formato === "imagem" ? "Imagem" : "", statusLegivel(a.status)].filter(Boolean).join(" · ")}</p>
            </div>
            <SeloDoSinal sinal={a.sinal} className="ml-2" />
          </div>
          {(a.titulo || a.corpo) && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-foreground/90 [overflow-wrap:anywhere]">
              {a.titulo ? <span className="font-medium">{a.titulo}. </span> : null}
              {a.corpo}
            </p>
          )}
          <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-5">
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">Gasto</dt>
              <dd className="truncate font-medium tabular-nums">{brl(m.gasto)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground" title={rotuloDoResultado || "Resultados"}>{rotuloDoResultado || "Resultados"}</dt>
              <dd className="truncate font-medium tabular-nums">{inteiro(m.resultados)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">Por resultado</dt>
              <dd className="truncate font-medium tabular-nums">{brl(m.custo_por_resultado)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">CTR</dt>
              <dd className="truncate font-medium tabular-nums">{porcento(m.ctr_saida !== null ? m.ctr_saida : m.ctr)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-muted-foreground">Frequência</dt>
              <dd className="truncate font-medium tabular-nums">{decimal(m.frequencia !== null ? m.frequencia : a.tendencia.frequencia)}</dd>
            </div>
          </dl>
          {(a.tendencia.ctr_var_pct !== null || a.tendencia.custo_resultado_var_pct !== null) && (
            <p className="mt-1.5 flex flex-wrap" aria-label="Tendência">
              <Variacao rotulo="CTR" valor={a.tendencia.ctr_var_pct} bomQuandoSobe />
              <Variacao rotulo="Custo por resultado" valor={a.tendencia.custo_resultado_var_pct} bomQuandoSobe={false} />
            </p>
          )}
          {a.diagnostico && (
            <div className="mt-2 rounded-lg bg-muted/50 px-2.5 py-2">
              <Diagnostico valor={a.diagnostico} />
            </div>
          )}
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <span className="mb-1 mr-1.5">
              <BotaoComCusto
                rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> Criar variações deste</>}
                titulo="Criar variações deste anúncio"
                descricao="Leva para o Plano de teste e gera variações que mantêm o que faz este anúncio funcionar, mudando uma variável por vez."
                variant={a.sinal === "escalar" || a.sinal === "renovar" ? "default" : "outline"}
                className="h-8"
                fecharAoConfirmar
                partes={() => partesDoPlanoV2(catalogo, 4)}
                executar={async () => {
                  onVariar();
                  return null;
                }}
              />
            </span>
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={onFicha} disabled={abrindo}>
              {abrindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileSearch className="mr-1 h-3.5 w-3.5" />}
              Abrir ficha
            </Button>
            {a.cta && <span className="mb-1 ml-auto text-[10.5px] text-muted-foreground">{rotuloDoCta(a.cta)}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

function PainelDaAnalise({
  analise,
  quando,
  nomeDe,
  onTeste,
}: {
  analise: AnaliseDaConta;
  quando: string | null;
  nomeDe: (adId: string) => string;
  onTeste: (t: AnaliseDaConta["proximos_testes"][number]) => void;
}) {
  const { catalogo } = useMesa();
  const grupos: { titulo: string; tom: string; itens: { ad_id: string; porque: string; sugestao?: string }[] }[] = [
    { titulo: "Escalar", tom: "text-success", itens: analise.escalar },
    { titulo: "Pausar", tom: "text-destructive", itens: analise.pausar },
    { titulo: "Renovar", tom: "text-warning", itens: analise.renovar },
  ];
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Análise do estrategista">
      <div className="flex min-w-0 items-start">
        <Sparkles className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold">Leitura do estrategista</h3>
          {quando && <p className="text-[11px] text-muted-foreground">Feita {dataEHora(quando)}. Os números vêm da conta; a leitura, do estrategista.</p>}
        </div>
      </div>
      {analise.resumo && <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{analise.resumo}</p>}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        {grupos.map((g) => (
          <div key={g.titulo} className="min-w-0 rounded-lg border border-border bg-card p-3">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${g.tom}`}>
              {g.titulo} ({g.itens.length})
            </p>
            {g.itens.length === 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">Nada agora.</p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {g.itens.map((i, k) => (
                  <li key={`${i.ad_id}-${k}`} className="min-w-0 text-[12px] leading-snug">
                    <span className="block truncate font-medium">{nomeDe(i.ad_id)}</span>
                    {i.porque && <span className="block text-muted-foreground [overflow-wrap:anywhere]">{i.porque}</span>}
                    {i.sugestao && <span className="mt-0.5 block [overflow-wrap:anywhere]">Sugestão: {i.sugestao}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {analise.copy.length > 0 && (
        <div className="min-w-0 rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estratégia de copy</p>
          <ul className="mt-1.5 space-y-2">
            {analise.copy.map((c, k) => (
              <li key={k} className="min-w-0 text-[12.5px] leading-snug [overflow-wrap:anywhere]">
                <span className="font-medium">{c.achado}</span>
                {c.recomendacao && <span className="block text-muted-foreground">{c.recomendacao}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analise.proximos_testes.length > 0 && (
        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Próximos testes</p>
          <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
            {analise.proximos_testes.map((t, k) => (
              <li key={`${t.titulo}-${k}`} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3">
                <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{t.titulo}</p>
                {t.hipotese && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{t.hipotese}</p>}
                <div className="mt-auto flex min-w-0 flex-wrap items-center pt-2">
                  {t.estilo_visual && <span className="mb-1 mr-1.5 rounded-full border border-border px-2 py-0.5 text-[10.5px]">{humanizar(t.estilo_visual)}</span>}
                  {t.objetivo && <span className="mb-1 mr-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary">{rotuloDoObjetivo(t.objetivo)}</span>}
                  <span className="mb-1 ml-auto">
                    <BotaoComCusto
                      rotulo="Criar plano deste teste"
                      titulo="Criar plano deste teste"
                      descricao="Leva para o Plano de teste com esta hipótese."
                      variant="outline"
                      className="h-7 text-[12px]"
                      fecharAoConfirmar
                      partes={() => partesDoPlanoV2(catalogo, 4)}
                      executar={async () => {
                        onTeste(t);
                        return null;
                      }}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function AbaConta({
  onCriarPlano,
  onImportado,
  onAbrirPlano,
}: {
  onCriarPlano?: (p: PedidoDePlano) => void;
  onImportado?: (planoId: string) => void;
  /** Plano de teste criado já preenchido pelo agente sênior: abre no Plano de teste. */
  onAbrirPlano?: (planoId: string) => void;
} = {}) {
  const { clientId, catalogo, isAdmin } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [dias, setDias] = useState<PeriodoDaConta>(14);
  const [grupo, setGrupo] = useState<GrupoDeObjetivo | "">("");
  const [campanha, setCampanha] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [analiseNova, setAnaliseNova] = useState<{ analise: AnaliseDaConta; criado_em: string } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [, setRelogio] = useState(0);
  const [desdeAnalise, rodarAnalise] = useAndamento();
  const espera = useRef<number | null>(null);

  const conta = useQuery({
    queryKey: chaveDosResultados(clientId, dias),
    queryFn: () => lerContaComResultados(clientId, dias),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: RELEITURA_DA_CONTA_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const analiseSalva = useQuery({ queryKey: chavesAds.analise(clientId), queryFn: () => lerUltimaAnalise(clientId) });

  // "há X min" anda sozinho; a espera da sincronia some ao sair da aba.
  useEffect(() => {
    const id = window.setInterval(() => setRelogio((n) => n + 1), 60_000);
    return () => {
      window.clearInterval(id);
      if (espera.current !== null) window.clearTimeout(espera.current);
    };
  }, []);

  const dados = conta.data || null;
  const anuncios = dados ? dados.anuncios : [];
  const nomeDe = (adId: string) => {
    const a = anuncios.filter((x) => x.ad_id === adId)[0];
    return a ? a.nome : `Anúncio ${adId}`;
  };
  const extras = dados ? dados.extras : null;
  const analise = analiseNova || (analiseSalva.data ? analiseSalva.data : null);
  // Clique numa campanha filtra os anúncios dela (as abas e o objetivo continuam valendo).
  const dadosDaLista = dados && campanha ? { ...dados, anuncios: dados.anuncios.filter((a) => a.campaign_id === campanha) } : dados;
  // O agente e o pacote olham pelo menos 30 dias (menos que isso é pouco volume para decidir estrutura).
  const diasDoAgente = dias < 30 ? 30 : dias;

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      await chamarAds("conta_sincronizar", { client_id: clientId });
      toast.success("Coleta pedida à Meta", { description: "Os números novos aparecem em alguns segundos." });
      if (espera.current !== null) window.clearTimeout(espera.current);
      espera.current = window.setTimeout(() => {
        espera.current = null;
        void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-conta", clientId] });
        void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-resultados", clientId] });
        setSincronizando(false);
      }, ESPERA_DA_SINCRONIA_MS);
    } catch (e) {
      setSincronizando(false);
      avisarErro(e, "Não foi possível sincronizar");
    }
  };

  const abrirFicha = async (a: AnuncioAoVivo) => {
    if (a.referencia_id) {
      setAberta(a.referencia_id);
      return;
    }
    // Sem ficha ainda: importa os anúncios (grátis) e abre a do anúncio.
    setAbrindo(a.ad_id);
    try {
      await chamarAds("referencias_importar_proprias", { client_id: clientId });
      void queryClient.invalidateQueries({ queryKey: chavesAds.referencias(clientId) });
      const r = await conta.refetch();
      const achado = r.data ? r.data.anuncios.filter((x) => x.ad_id === a.ad_id)[0] : null;
      if (achado && achado.referencia_id) setAberta(achado.referencia_id);
      else toast.info("Ficha ainda não criada", { description: "O anúncio entra em Referências na próxima coleta." });
    } catch (e) {
      avisarErro(e, "Não foi possível abrir a ficha");
    } finally {
      setAbrindo(null);
    }
  };

  const variar = (a: AnuncioAoVivo) => {
    if (!onCriarPlano) return;
    onCriarPlano({
      rotulo: `Variações de ${a.nome}`,
      modo: "variar_vencedor",
      referencia_ids: a.referencia_id ? [a.referencia_id] : undefined,
      pedido: `Variações do anúncio "${a.nome}" (ad_id ${a.ad_id}). Mantenha o que faz ele funcionar e mude uma variável por vez.`,
    });
  };

  const testar = (t: AnaliseDaConta["proximos_testes"][number]) => {
    if (!onCriarPlano) return;
    const partes = [`Teste: ${t.titulo}.`];
    if (t.hipotese) partes.push(`Hipótese: ${t.hipotese}.`);
    if (t.estilo_visual) partes.push(`Estilo visual: ${t.estilo_visual}.`);
    onCriarPlano({ rotulo: t.titulo, pedido: partes.join(" "), objetivo: t.objetivo || undefined });
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Conta de anúncios ao vivo</h2>
          <p className="text-[12px] text-muted-foreground" aria-live="polite">
            {dados && dados.conta.periodo ? `De ${dataCurta(dados.conta.periodo.inicio)} a ${dataCurta(dados.conta.periodo.fim)} · ` : ""}
            Atualizado {tempoDesde(dados ? dados.conta.atualizado_em : null)}
            {conta.isFetching && !conta.isLoading ? " · relendo" : ""}. Relê sozinha a cada 10 min enquanto esta aba está aberta.
            {dados && dados.conta.custo_referencia
              ? ` O sinal compara com ${brl(dados.conta.custo_referencia.valor)} por resultado (${dados.conta.custo_referencia.fonte === "briefing" ? "custo tolerável do briefing" : "média da conta"}).`
              : ""}
          </p>
        </div>
        <div className="mb-1 mr-2 mt-1 flex max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Período">
          {PERIODOS_DA_CONTA.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={dias === d}
              onClick={() => setDias(d)}
              className={`h-7 rounded-md px-2.5 text-[12px] ${dias === d ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {d} dias
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 mt-1 h-9" disabled={sincronizando} onClick={() => void sincronizar()} title="Pede a coleta da Meta agora e relê a conta (sem custo de IA)">
          {sincronizando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Sincronizar agora
        </Button>
        <span className="mb-1 mt-1 inline-flex items-center">
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Analisar com o estrategista</>}
            titulo="Analisar a conta"
            descricao="O estrategista lê os números da conta (calculados em código) e diz o que escalar, pausar e renovar, o que a copy ensina e os próximos testes."
            className="h-9"
            disabled={!dados || !anuncios.length || desdeAnalise !== null}
            partes={() => partesDaAnaliseDaConta(catalogo)}
            executar={() => rodarAnalise(() => chamarAds<any>("conta_analisar", { client_id: clientId, dias }))}
            aoConcluir={(data) => {
              const a = normalizarAnalise(data && data.analise);
              if (a) setAnaliseNova({ analise: a, criado_em: new Date().toISOString() });
              void queryClient.invalidateQueries({ queryKey: chavesAds.analise(clientId) });
            }}
          />
        </span>
        {desdeAnalise !== null && (
          <div className="w-full">
            <Andamento desde={desdeAnalise} rotulo="O estrategista está lendo a conta" />
          </div>
        )}
      </div>

      {conta.isError && <AvisoDeErro erro={conta.error} />}
      {conta.isLoading && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-20 animate-pulse rounded-xl bg-muted/70" />
          <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
        </div>
      )}

      {dados && !dados.conta.conectada && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <BarChart3 className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-3 text-[14px] font-medium">A conta de anúncios deste cliente não está conectada</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Conecte a conta da Meta no cadastro do cliente para ver campanhas, anúncios e métricas aqui.</p>
        </div>
      )}

      {dados && dados.conta.conectada && extras && (
        <>
          <ResumoDoTopo dados={dados} grupo={grupo} onGrupo={setGrupo} />
          <details className="min-w-0 rounded-xl border border-border bg-card px-3 py-2">
            <summary className="cursor-pointer text-[12px] text-muted-foreground">Mais números do período (CTR, CPM, alcance, frequência, saldo e dia a dia)</summary>
            <div className="mt-2 min-w-0 space-y-3">
              <ResumoDaConta totais={dados.conta.totais} extras={extras} />
              <SaldosDasContas contas={extras.contas} />
              <TendenciaDiaria serie={extras.serie} rotulo={extras.resultado_rotulo} />
            </div>
          </details>

          <section className="min-w-0 space-y-2" aria-label="Otimização">
            <AtivarGestao clientId={clientId} podeConectar={isAdmin} compacto />
            <AgenteSenior nomeDe={nomeDe} dias={diasDoAgente} onCriarPlano={onCriarPlano} onPlanoPronto={onAbrirPlano} />
            <div className="flex min-w-0 flex-wrap items-center">
              <BaixarPacoteDeOtimizacao dias={diasDoAgente} className="mb-1 mr-2" />
              <ImportarPacote onImportado={onImportado} className="mb-1" />
            </div>
          </section>

          {analise && <PainelDaAnalise analise={analise.analise} quando={analise.criado_em || null} nomeDe={nomeDe} onTeste={testar} />}

          <TabelaDeCampanhas campanhas={dados.conta.campanhas} rotuloPorId={extras.rotuloPorId} selecionada={campanha} onSelecionar={(id) => setCampanha(id)} />

          <section className="min-w-0 space-y-2" aria-label="Anúncios">
            <div className="flex min-w-0 flex-wrap items-center">
              <FiltroDeObjetivo dados={dados} valor={grupo} onMudar={setGrupo} />
              {campanha && (
                <button type="button" className="mb-1.5 ml-2 text-[12px] text-primary hover:underline" onClick={() => setCampanha("")}>
                  Todas as campanhas
                </button>
              )}
            </div>
            {dadosDaLista && (
              <PainelDeResultados
                key={`${grupo}|${campanha}`}
                dados={dadosDaLista}
                grupo={grupo}
                renderAnuncio={(a) => (
                  <CartaoDoAnuncio
                    a={a}
                    abrindo={abrindo === a.ad_id}
                    onVariar={() => variar(a)}
                    onFicha={() => void abrirFicha(a)}
                    rotuloDoResultado={a.resultado_rotulo || extras.rotuloPorId[a.ad_id]}
                    formato={a.formato || extras.formatoPorAd[a.ad_id]}
                    conjunto={a.conjunto || extras.conjuntoPorAd[a.ad_id]}
                  />
                )}
              />
            )}
          </section>

          <PainelDaEvolucao dias={dias} />
          <PainelDoDesempenho dias={dias} />
        </>
      )}

      <JanelaDaReferencia referencia={null} referenciaId={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}

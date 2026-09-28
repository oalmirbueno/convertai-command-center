import { useEffect, useRef, useState } from "react";
import { useInRouterContext, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Briefcase, ExternalLink, FileSearch, FileText, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, dataEHora, textoDoErro } from "@/lib/mesa/api";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
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
import { Andamento, CabecalhoDaParte, Diagnostico, Foto, SeloDoSinal, useAndamento } from "./Comuns";
import JanelaDaReferencia from "./JanelaDaReferencia";
import { PainelDaEvolucao, PainelDoDesempenho, ResumoDaConta, SaldosDasContas, TendenciaDiaria } from "./ContaPaineis";
import { PERIODOS_DA_CONTA_V4, type PeriodoDaConta } from "./contaApi";
import AgenteSenior from "./AgenteSenior";
import AtivarGestao from "./AtivarGestao";
import RotinaDoAgente from "./RotinaDoAgente";
import { esquecerPlanoParaOAgente, verPlanoParaOAgente } from "./ponteDoAgente";
import { BaixarPacoteDeOtimizacao, ImportarPacote } from "./PacoteDeOtimizacao";
import { FiltroDeObjetivo, PainelDeResultados, ResumoDoTopo } from "./ResultadosClaros";
import { chaveDosResultados, lerContaComResultados, type GrupoDeObjetivo } from "./resultadosApi";
import GerenciadorAoVivo, { BotaoAtualizarAgora, SituacaoDaConta, useAtualizarGerenciador, useGerenciador } from "./GerenciadorAoVivo";
import { gerarRelatorioDeAnuncios, pedidoDeOtimizar, type NoNoGerenciador, type RelatorioGerado } from "./gerenciadorApi";
import SeletorDePeriodo from "./SeletorDePeriodo";
import { corpoDoPeriodo, ehEscolhaDoPeriodo, PERIODO_PADRAO, resolverPeriodo, trechoDoPeriodo, type EscolhaDoPeriodo } from "./periodoDaConta";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";

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
 *
 * 26/09 (sistema de design): área de trabalho com o agente sênior como
 * lateral fixa (PainelDoAgente); os painéis da conta rolam por conta
 * própria. Explicações no "?", período num seletor, período e objetivo
 * lembrados por cliente.
 *
 * 27/09 (frente TR): no topo, a rotina do agente ("O agente está cuidando
 * desta conta", Pausar a rotina, Interferir, O que foi feito com a prova e o
 * Desfazer). O plano mandado pelo "Enviar ao agente sênior" (Plano de teste)
 * abre o agente e ele assume sozinho. O endereço aceita &campanha=<id>
 * (filtra a campanha: o caminho "Ir para a campanha montada") e &ver=feito
 * (abre "O que foi feito": o link dos avisos).
 *
 * 28/09 (frente AD, "a Mesa Ads não está me passando confiança; organize tudo;
 * a área da conta mais enxuta; o gerenciador dentro do painel; ver o agente
 * fazer"): a aba virou blocos que recolhem, nesta ordem: a situação da conta
 * (ativa ou travada, com o motivo e o que fazer), o Gerenciador ao vivo
 * (árvore campanha, conjunto e anúncio lida na Meta, com as ações e a prova),
 * o que o agente faz e fez, e os resultados e criativos. Um só "Atualizar
 * agora" (lê a Meta e pede a coleta); a tabela de campanhas saiu (o
 * Gerenciador é a tabela).
 *
 * 28/09 (frente AD3, "o topo é um card gigante; o gerenciador igual ao da Meta;
 * filtros por data; gerar o relatório ali"): o período (hoje, ontem, 7, 14, 30 e
 * 90 dias, este mês, mês passado e livre) vale para a aba toda; o topo virou uma
 * linha alinhada por conta (a ligação da gestão só aparece quando falta
 * permissão); o Gerenciador tem abas por nível com cor, colunas e total, o
 * painel do anúncio e Pausar, Retomar e Otimizar na linha (Otimizar põe o
 * pedido no campo do agente sênior); "Relatório" grava o relatório de anúncios
 * do período como rascunho na área de Relatórios.
 */

/** Lê campanha e ver do endereço quando há roteador (os testes montam a aba sem ele). */
function OuvirEndereco({ onMudar }: { onMudar: (campanha: string | null, ver: string | null) => void }) {
  const [params] = useSearchParams();
  const campanha = params.get("campanha");
  const ver = params.get("ver");
  useEffect(() => {
    onMudar(campanha, ver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanha, ver]);
  return null;
}

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
    <article className="min-w-0 rounded-lg border border-border bg-card p-3" aria-label={`Anúncio ${a.nome}`} data-ad={a.ad_id}>
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
    <section className="min-w-0 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" aria-label="Análise do estrategista">
      <div className="flex min-w-0 items-start">
        <Sparkles className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold">Leitura do estrategista</h3>
          {quando && <p className="truncate text-[11px] text-muted-foreground" title="Os números vêm da conta; a leitura, do estrategista.">Feita {dataEHora(quando)}</p>}
        </div>
      </div>
      {analise.resumo && <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{analise.resumo}</p>}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        {grupos.map((g) => (
          <div key={g.titulo} className="min-w-0 rounded-md bg-background/60 p-3">
            <p className={`text-[12px] font-semibold ${g.tom}`}>
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
        <div className="min-w-0 rounded-md bg-background/60 p-3">
          <p className="text-[12px] font-semibold text-muted-foreground">Estratégia de copy</p>
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
          <p className="mb-1.5 text-[12px] font-semibold text-muted-foreground">Próximos testes</p>
          <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
            {analise.proximos_testes.map((t, k) => (
              <li key={`${t.titulo}-${k}`} className="flex min-w-0 flex-col rounded-md bg-background/60 p-3">
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
  // Período e objetivo lembrados por cliente (sair e voltar mantém).
  // Frente AD3: hoje, ontem, 7, 14, 30 e 90 dias, este mês, mês passado e período livre, para tudo da aba.
  const [escolhaDoPeriodo, setEscolhaDoPeriodo] = useEstadoDaTela<EscolhaDoPeriodo>(`mesa-ads:conta:periodo:${clientId}`, PERIODO_PADRAO, { validar: ehEscolhaDoPeriodo });
  const periodo = resolverPeriodo(escolhaDoPeriodo);
  const dias = periodo.dias;
  const [grupo, setGrupo] = useEstadoDaTela<GrupoDeObjetivo | "">(`mesa-ads:conta:objetivo:${clientId}`, "", { validar: (v) => typeof v === "string", esperaMs: 0 });
  const [campanha, setCampanha] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [analiseNova, setAnaliseNova] = useState<{ analise: AnaliseDaConta; criado_em: string } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [, setRelogio] = useState(0);
  const [desdeAnalise, rodarAnalise] = useAndamento();
  const espera = useRef<number | null>(null);
  const noRoteador = useInRouterContext();
  // Frente TR: o plano mandado pelo Plano de teste (uma vez só) e o pedido pronto da rotina para o agente.
  // Olha no estado inicial (puro) e tira do navegador no efeito: o plano vale uma vez só.
  const [assumir, setAssumir] = useState<{ plano_id: string; nome: string } | null>(() => {
    const p = verPlanoParaOAgente(clientId);
    return p ? { plano_id: p.plano_id, nome: p.nome } : null;
  });
  useEffect(() => {
    if (assumir) esquecerPlanoParaOAgente(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [abrirAgente, setAbrirAgente] = useState<number | null>(() => (assumir ? Date.now() : null));
  const [pedidoPronto, setPedidoPronto] = useState<{ texto: string; em: number } | null>(null);
  const [verFeito, setVerFeito] = useState(false);
  const levarAoAgente = (textoDoPedido: string) => {
    setPedidoPronto({ texto: textoDoPedido, em: Date.now() });
    setAbrirAgente(Date.now());
  };

  const conta = useQuery({
    queryKey: chaveDosResultados(clientId, periodo),
    queryFn: () => lerContaComResultados(clientId, periodo),
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

  // Um botão só: lê a Meta agora (Gerenciador) e pede a coleta dos números (conta_sincronizar).
  const gerenciador = useGerenciador(clientId, periodo);
  const { atualizando, atualizar: atualizarGerenciador } = useAtualizarGerenciador(clientId, periodo);
  const [gerRecolhido, setGerRecolhido] = useRecolhido("mesa-ads:conta:bloco:gerenciador", false);
  const [feitoRecolhido, setFeitoRecolhido] = useRecolhido("mesa-ads:conta:bloco:agente", false);
  const [resultadosRecolhido, setResultadosRecolhido] = useRecolhido("mesa-ads:conta:bloco:resultados", false);
  const resultadosRef = useRef<HTMLElement>(null);
  const verCriativosDaCampanha = (id: string) => {
    setCampanha(id);
    setResultadosRecolhido(false);
    window.setTimeout(() => {
      const el = resultadosRef.current;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    }, 50);
  };
  const sincronizar = async () => {
    setSincronizando(true);
    void atualizarGerenciador();
    try {
      await chamarAds("conta_sincronizar", { client_id: clientId });
      toast.success("Lendo a Meta agora", { description: "O status já veio; os números do período chegam em alguns segundos." });
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

  const custoRef = dados && dados.conta.custo_referencia ? dados.conta.custo_referencia : null;

  // Frente AD3: "Otimizar" na linha leva o item ao agente sênior (no campo, nada roda sem o clique).
  const otimizar = (n: NoNoGerenciador) => levarAoAgente(pedidoDeOtimizar(n, trechoDoPeriodo(periodo)));

  // Frente AD3: o relatório de anúncios do período, gravado como rascunho na área de Relatórios.
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioGerado | null>(null);
  const gerarRelatorio = async () => {
    setGerandoRelatorio(true);
    try {
      const r = await gerarRelatorioDeAnuncios(clientId, periodo);
      if (!r) throw new Error("O relatório não voltou do servidor.");
      setRelatorio(r);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success(r.atualizado ? "Relatório atualizado em Relatórios" : "Relatório criado em Relatórios", { description: "Ficou como rascunho: revise e envie ao cliente por lá." });
    } catch (e) {
      avisarErro(e, "Não foi possível gerar o relatório");
    } finally {
      setGerandoRelatorio(false);
    }
  };

  const leituraDaConta = gerenciador.data || null;
  const mostrarAtivarGestao = !!leituraDaConta && (!leituraDaConta.gestao || (!leituraDaConta.gestao.disponivel && !leituraDaConta.contas.some((c) => c.situacao.travada)));

  return (
    // Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no computador
    // os painéis da conta rolam por dentro e o agente sênior fica parado ao lado,
    // com o campo sempre à vista; no celular a página rola normal e o agente abre
    // em tela cheia pelo botão de baixo.
    <AreaDeTrabalho
      memoria="mesa-ads-conta"
      larguraDaLateral="larga"
      rotuloDaLateral="Agente sênior"
      iconeDaLateral={<Briefcase className="h-4 w-4" />}
      rotuloDoPrincipal="Conta de anúncios"
      memoriaDaRolagem={`mesa-ads:conta:${clientId}`}
      pedidoDeAbrir={abrirAgente}
      lateral={
        <AgenteSenior
          nomeDe={nomeDe}
          dias={diasDoAgente}
          onCriarPlano={onCriarPlano}
          onPlanoPronto={onAbrirPlano}
          assumir={assumir}
          onAssumido={() => setAssumir(null)}
          pedidoPronto={pedidoPronto}
        />
      }
    >
      {noRoteador && (
        <OuvirEndereco
          onMudar={(c, ver) => {
            if (c && /^[0-9]{3,30}$/.test(c)) setCampanha(c);
            if (ver === "feito") setVerFeito(true);
          }}
        />
      )}
      <div className="min-w-0 space-y-5 pb-6">
        {/* 1. Situação da conta: ativa ou travada, com o motivo e o que fazer; um só Atualizar agora. */}
        <div className="min-w-0 space-y-2">
          <CabecalhoDaParte
            titulo="Conta de anúncios"
            ajuda={`O Gerenciador lê a Meta na hora (status, entrega, verba e gasto de hoje) e relê sozinho a cada 2 min; os números do período vêm da coleta do painel (a cada 10 min). Atualizar agora faz as duas coisas. O sinal de cada anúncio é regra em código, nunca IA.${
              custoRef ? ` O sinal compara com ${brl(custoRef.valor)} por resultado (${custoRef.fonte === "briefing" ? "custo tolerável do briefing" : "média da conta"}).` : ""
            }`}
            descricao={
              <>
                {dados && dados.conta.periodo ? `De ${dataCurta(dados.conta.periodo.inicio)} a ${dataCurta(dados.conta.periodo.fim)} · ` : ""}
                Atualizado {tempoDesde(dados ? dados.conta.atualizado_em : null)}
                {conta.isFetching && !conta.isLoading ? " · relendo" : ""}
              </>
            }
            acoes={
              <>
                <SeletorDePeriodo valor={escolhaDoPeriodo} onMudar={setEscolhaDoPeriodo} />
                <button
                  type="button"
                  className={juntar(botao.secundario, "h-9")}
                  disabled={gerandoRelatorio || !dados || !dados.conta.conectada}
                  onClick={() => void gerarRelatorio()}
                  title="Monta o relatório de anúncios do período (números da conta e a análise) e grava em Relatórios como rascunho"
                >
                  {gerandoRelatorio ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />}
                  Relatório
                </button>
                <BotaoAtualizarAgora atualizando={sincronizando || atualizando} onAtualizar={() => void sincronizar()} />
                {gerenciador.data && gerenciador.data.contas[0] && gerenciador.data.contas[0].link_meta && (
                  <a href={gerenciador.data.contas[0].link_meta} target="_blank" rel="noopener noreferrer" className={juntar(botao.discreto, "h-9")}>
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    Gerenciador da Meta
                  </a>
                )}
              </>
            }
          />
          {relatorio && (
            <p className="flex min-w-0 flex-wrap items-center rounded-md bg-success/10 px-3 py-2 text-[12.5px] leading-snug" role="status" data-relatorio={relatorio.id}>
              <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span className="mr-2 min-w-0 [overflow-wrap:anywhere]">
                {relatorio.atualizado ? "Relatório atualizado" : "Relatório criado"} em Relatórios, como rascunho{relatorio.projeto ? ` (projeto ${relatorio.projeto})` : ""}: {relatorio.titulo}
              </span>
              <a href={relatorio.link} className={juntar("mr-2 font-medium text-primary hover:underline", foco)}>
                Abrir o relatório
              </a>
              <button type="button" className={juntar(botao.icone, "ml-auto h-6 w-6")} onClick={() => setRelatorio(null)} aria-label="Fechar o aviso do relatório">
                <X className="h-3.5 w-3.5" />
              </button>
            </p>
          )}
          <SituacaoDaConta leitura={gerenciador.data || null} carregando={gerenciador.isLoading} erro={gerenciador.isError ? textoDoErro(gerenciador.error) : null} />
          {/* A ligação da gestão só aparece quando falta permissão (conta travada já diz o motivo acima). */}
          {mostrarAtivarGestao && <AtivarGestao clientId={clientId} podeConectar={isAdmin} compacto />}
        </div>

        {conta.isError && (
          <EstadoDeErro
            titulo="A conta não abriu."
            descricao={textoDoErro(conta.error)}
            acao={
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void conta.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        )}
        {conta.isLoading && <Carregando forma="aba" rotulo="Lendo a conta" />}

        {dados && !dados.conta.conectada && (
          <EstadoVazio
            icone={<BarChart3 className="h-5 w-5" />}
            titulo="A conta de anúncios deste cliente não está conectada"
            descricao="Conecte a conta da Meta no cadastro do cliente para ver campanhas, anúncios e métricas aqui."
          />
        )}

        {/* 2. O Gerenciador ao vivo: campanha, conjunto e anúncio, com as ações e a prova. */}
        {(!dados || dados.conta.conectada) && (
          <section className="min-w-0" aria-label="Gerenciador">
            <TituloRecolhivel
              titulo="Gerenciador"
              recolhido={gerRecolhido}
              onAlternar={() => setGerRecolhido(!gerRecolhido)}
              resumo={gerenciador.data ? `${gerenciador.data.resumo.campanhas_entregando} de ${gerenciador.data.resumo.campanhas_ativas} campanhas ativas entregando` : undefined}
              className="mb-2"
            />
            {!gerRecolhido && (
              <GerenciadorAoVivo
                dias={periodo}
                rotuloDoPeriodo={`números ${trechoDoPeriodo(periodo)}`}
                anuncios={anuncios}
                onVerCriativos={verCriativosDaCampanha}
                onOtimizar={otimizar}
                onVariar={onCriarPlano ? (adId) => { const a = anuncios.filter((x) => x.ad_id === adId)[0]; if (a) variar(a); else variar({ ad_id: adId, nome: nomeDe(adId), referencia_id: null } as AnuncioAoVivo); } : undefined}
                onFicha={(adId) => { const a = anuncios.filter((x) => x.ad_id === adId)[0]; if (a) void abrirFicha(a); else toast.info("Ficha ainda não criada", { description: "Este anúncio não teve números no período; ele entra em Referências na próxima coleta." }); }}
              />
            )}
          </section>
        )}

        {/* 3. O agente: a rotina e tudo o que ele fez (e o que não deu, com o motivo), com a prova e o Desfazer. */}
        <section className="min-w-0" aria-label="O agente">
          <TituloRecolhivel titulo="O que o agente faz e fez" recolhido={feitoRecolhido} onAlternar={() => setFeitoRecolhido(!feitoRecolhido)} className="mb-2" />
          {!feitoRecolhido && <RotinaDoAgente onPedirAoAgente={levarAoAgente} abrirFeito={verFeito} />}
        </section>

        {/* 4. Resultados e criativos (o que já existia, num bloco que recolhe). */}
        {dados && dados.conta.conectada && extras && (
          <section className="min-w-0 space-y-4" aria-label="Resultados e criativos" ref={resultadosRef}>
            <div className="flex min-w-0 flex-wrap items-center">
              <TituloRecolhivel titulo="Resultados e criativos" recolhido={resultadosRecolhido} onAlternar={() => setResultadosRecolhido(!resultadosRecolhido)} className="mr-3" />
              {!resultadosRecolhido && (
                <span className="ml-auto">
                  <BotaoComCusto
                    rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Analisar com o estrategista</>}
                    titulo="Analisar a conta"
                    descricao="O estrategista lê os números da conta (calculados em código) e diz o que escalar, pausar e renovar, o que a copy ensina e os próximos testes."
                    className="h-9"
                    disabled={!dados || !anuncios.length || desdeAnalise !== null}
                    partes={() => partesDaAnaliseDaConta(catalogo)}
                    executar={() => rodarAnalise(() => chamarAds<any>("conta_analisar", { client_id: clientId, ...corpoDoPeriodo(periodo) }))}
                    aoConcluir={(data) => {
                      const a = normalizarAnalise(data && data.analise);
                      if (a) setAnaliseNova({ analise: a, criado_em: new Date().toISOString() });
                      void queryClient.invalidateQueries({ queryKey: chavesAds.analise(clientId) });
                    }}
                  />
                </span>
              )}
            </div>
            {desdeAnalise !== null && <Andamento desde={desdeAnalise} rotulo="O estrategista está lendo a conta" />}
            {!resultadosRecolhido && (
              <>
                <ResumoDoTopo dados={dados} grupo={grupo} onGrupo={setGrupo} />
                <details className="min-w-0 border-y border-border py-2">
                  <summary className={juntar("cursor-pointer rounded text-[12.5px] text-muted-foreground hover:text-foreground", foco)}>Mais números do período</summary>
                  <div className="mt-3 min-w-0 space-y-3">
                    <ResumoDaConta totais={dados.conta.totais} extras={extras} />
                    <SaldosDasContas contas={extras.contas} />
                    <TendenciaDiaria serie={extras.serie} rotulo={extras.resultado_rotulo} />
                  </div>
                </details>

                {analise && <PainelDaAnalise analise={analise.analise} quando={analise.criado_em || null} nomeDe={nomeDe} onTeste={testar} />}

                <section className="min-w-0 border-t border-border pt-4" aria-label="Anúncios">
                  <CabecalhoDaParte
                    titulo="Criativos"
                    nivel={3}
                    descricao={campanha ? `Só a campanha ${(dados.conta.campanhas.filter((c) => c.campaign_id === campanha)[0] || { nome: null }).nome || "escolhida"}` : undefined}
                    acoes={
                      <>
                        <FiltroDeObjetivo dados={dados} valor={grupo} onMudar={setGrupo} />
                        {campanha && (
                          <button type="button" className={juntar(botao.discreto, "h-9 text-primary")} onClick={() => setCampanha("")}>
                            Todas as campanhas
                          </button>
                        )}
                      </>
                    }
                  />
                  {dadosDaLista && (
                    <PainelDeResultados
                      key={`${grupo}|${campanha}`}
                      dados={dadosDaLista}
                      grupo={grupo}
                      memoria={`mesa-ads:conta:aba:${clientId}`}
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

                <section className="min-w-0 space-y-2" aria-label="Otimização">
                  <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
                    <BaixarPacoteDeOtimizacao dias={diasDoAgente} />
                    <ImportarPacote onImportado={onImportado} />
                  </div>
                </section>

                <PainelDaEvolucao dias={periodo} />
                <PainelDoDesempenho dias={periodo} />
              </>
            )}
          </section>
        )}
      </div>

      <JanelaDaReferencia referencia={null} referenciaId={aberta} onFechar={() => setAberta(null)} />
    </AreaDeTrabalho>
  );
}

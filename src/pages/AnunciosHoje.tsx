import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Bot, CalendarClock, CheckCircle2, ExternalLink, FileText, History, ListChecks, Megaphone, RefreshCw, Users, Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import { useAdsConnection } from "@/hooks/useAdsMetrics";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import { BarraFina } from "@/components/horas/Graficos";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  FaixaDeNumeros,
  JanelaCentral,
  Secao,
  SeletorCompacto,
  botao,
  espaco,
  etiqueta,
  juntar,
  larguraDaMesa,
  lista,
  superficie,
  texto,
} from "@/components/sistema";
import {
  ROTULO_DO_NIVEL,
  diaLocal,
  montarCartoes,
  nomeDoPeriodo,
  normalizarAcao,
  normalizarBoletim,
  numerosDaCarteira,
  tabelaAusente,
  type AcaoNaConta,
  type Boletim,
  type CampanhaDoPainel,
  type CartaoDoCliente,
  type DiaDeAnuncio,
  type NivelDoAlerta,
  type SituacaoDaCampanha,
  type TomDoCusto,
} from "@/lib/anunciosHoje";

/*
 * Anúncios hoje (26/10/2026, redesenho da tarde). Dono: "muito bagunçado, uma
 * lista com um monte de coisa para eu ler... são só os clientes que têm
 * anúncios ativos: o que estiver ativo na Mesa Ads aparece aqui".
 * - Topo: 4 números da carteira (gasto de hoje contra o teto, resultados e
 *   custo médio da semana, o que pede você).
 * - Boletim do agente: uma linha, abre o resumo (o texto inteiro fica na janela).
 * - Um cartão por cliente com anúncio no ar na Mesa Ads (regra em
 *   `clientesComAnuncioAtivo`, src/lib/anunciosHoje.ts): gasto contra o teto,
 *   resultado e custo com cor, campanhas, saldo, a última mudança do agente
 *   (antes → depois, com prova) e UMA ação.
 */

const quando = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sem data";
};
const dataCurta = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
};
const brl = (v: number | null, centavos = false) =>
  v === null ? "-" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: centavos || v < 100 ? 2 : 0, minimumFractionDigits: centavos || v < 100 ? 2 : 0 });

/** Cartões por vez (o resto entra com "Mostrar mais"): a carteira passa de 30 clientes um dia. */
const POR_PAGINA = 12;

const TOM_DO_NIVEL: Record<NivelDoAlerta, string> = {
  critico: "bg-destructive/10 text-destructive",
  atencao: "bg-warning/10 text-warning",
  info: "bg-muted text-muted-foreground",
};
const TOM_DO_CUSTO: Record<TomDoCusto, { rotulo: string; classe: string }> = {
  bom: { rotulo: "Bom", classe: "bg-success/10 text-success" },
  atencao: { rotulo: "Atenção", classe: "bg-warning/10 text-warning" },
  ruim: { rotulo: "Ruim", classe: "bg-destructive/10 text-destructive" },
  neutro: { rotulo: "Sem comparação", classe: "bg-muted text-muted-foreground" },
};
const PONTO_DA_SITUACAO: Record<SituacaoDaCampanha, string> = { ativa: "bg-success", terminando: "bg-warning", terminada: "bg-destructive" };

type Leitura<T> = { linhas: T[]; ausente: boolean };

function useBoletins() {
  return useQuery({
    queryKey: ["ads-boletins"],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Leitura<Boletim>> => {
      const { data, error } = await (supabase as any).from("ads_boletins").select("*").order("criado_em", { ascending: false }).limit(30);
      if (error) {
        if (tabelaAusente(error)) return { linhas: [], ausente: true };
        throw new Error(error.message);
      }
      return { linhas: ((data || []) as unknown[]).map(normalizarBoletim), ausente: false };
    },
  });
}

function useAcoesNasContas() {
  return useQuery({
    queryKey: ["ads-rotina-acoes", "hoje"],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Leitura<AcaoNaConta>> => {
      const { data, error } = await (supabase as any).from("ads_rotina_acoes").select("*").order("criado_em", { ascending: false }).limit(80);
      if (error) {
        if (tabelaAusente(error)) return { linhas: [], ausente: true };
        throw new Error(error.message);
      }
      return { linhas: ((data || []) as unknown[]).map(normalizarAcao), ausente: false };
    },
  });
}

/** As campanhas que a Mesa Ads lê ao vivo (coleta ads-metrics a cada 10 min). */
function useCampanhasDaMesaAds() {
  return useQuery({
    queryKey: ["ads-campanhas-com-fim"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ads_campaigns")
        .select("id, client_id, external_account_id, name, status, effective_status, daily_budget, stop_time")
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data || []) as CampanhaDoPainel[];
    },
  });
}

/** 14 dias da coleta (esta semana e a anterior, para a cor do custo). */
function useDiasDosAnuncios() {
  return useQuery({
    queryKey: ["ads-dias-14", diaLocal(Date.now())],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ads_campaign_daily")
        .select("client_id, campaign_id, campaign_name, objective, day, spend, actions")
        .gte("day", diaLocal(Date.now() - 13 * 86_400_000))
        .order("day", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data || []) as DiaDeAnuncio[];
    },
  });
}

export default function AnunciosHoje() {
  const boletins = useBoletins();
  const acoes = useAcoesNasContas();
  const campanhas = useCampanhasDaMesaAds();
  const dias = useDiasDosAnuncios();
  const conexao = useAdsConnection();
  const identidades = useIdentidadesDosClientes();
  const { data: clientes = [] } = useClients();
  const [cliente, setCliente] = useState("");
  const [aberto, setAberto] = useState<Boletim | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [boletimAberto, setBoletimAberto] = useState(false);
  /** Janela das mudanças: "" = todas; id = só daquele cliente; null = fechada. */
  const [mudancasDe, setMudancasDe] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  // O aviso do sino traz ?boletim=<id>: boletim anterior abre na janela; o último já está na tela.
  const [params] = useSearchParams();
  const pedido = params.get("boletim");
  useEffect(() => {
    const linhas = boletins.data?.linhas ?? [];
    if (!pedido || !linhas.length) return;
    if (linhas[0].id === pedido) { setBoletimAberto(true); return; }
    const achado = linhas.find((b) => b.id === pedido);
    if (achado) setAberto(achado);
  }, [pedido, boletins.data]);

  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes as Array<{ id: string; company_name?: string | null; full_name?: string | null }>) m.set(String(c.id), c.company_name || c.full_name || "Cliente");
    return m;
  }, [clientes]);
  const nomeDe = (id: string | null) => (id ? nomes.get(id) || "Cliente" : "Geral");

  const ultimo = boletins.data?.linhas[0] ?? null;
  // Calcula uma vez por leitura (nada pesado a cada render).
  const todos = useMemo(
    () => montarCartoes({
      campanhas: campanhas.data ?? [],
      dias: dias.data ?? [],
      contas: (conexao.data?.contas ?? []) as never,
      acoes: acoes.data?.linhas ?? [],
      boletim: ultimo,
      agora: Date.now(),
    }),
    [campanhas.data, dias.data, conexao.data, acoes.data, ultimo],
  );
  const cartoes = cliente ? todos.filter((c) => c.clientId === cliente) : todos;
  const carteira = useMemo(() => numerosDaCarteira(cartoes), [cartoes]);
  const ativos = useMemo(() => new Set(todos.map((c) => c.clientId)), [todos]);
  const mudancas = useMemo(() => (acoes.data?.linhas ?? []).filter((a) => a.estado !== "proposta" && (!mudancasDe || a.clientId === mudancasDe)), [acoes.data, mudancasDe]);

  const atualizar = () => {
    void boletins.refetch();
    void acoes.refetch();
    void campanhas.refetch();
    void dias.refetch();
    void conexao.refetch();
  };
  const opcoesDeCliente = [{ valor: "", rotulo: "Todos os clientes" }, ...todos.map((c) => ({ valor: c.clientId, rotulo: nomeDe(c.clientId) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo))];
  const carregando = campanhas.isLoading || dias.isLoading;
  const visiveis = cartoes.slice(0, pagina * POR_PAGINA);
  const alertasGerais = ultimo ? ultimo.alertas.filter((a) => !a.client_id || ativos.has(a.client_id)) : [];

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-anuncios-hoje="">
      <CabecalhoDePagina
        titulo="Anúncios hoje"
        descricao={carregando ? undefined : `${todos.length} ${todos.length === 1 ? "cliente com anúncio ativo" : "clientes com anúncio ativo"}`}
        ajuda="Só os clientes com anúncio no ar na Mesa Ads (campanha ativa na conta, sem data de fim passada). Em cada cartão: gasto de hoje e da semana contra o teto da verba diária, o resultado principal e o custo (verde: igual ou melhor que a semana anterior; amarelo: até 35% mais caro; vermelho: mais caro que isso ou gasto sem resultado), as campanhas, o saldo da conta e a última mudança feita pelo agente, com antes, depois e prova."
        acoes={<>
          {todos.length > 1 && <SeletorCompacto opcoes={opcoesDeCliente} valor={cliente} onEscolher={(v) => { setCliente(v); setPagina(1); }} rotulo="Filtrar por cliente" modo="lista" icone={<Users className="h-3.5 w-3.5" />} />}
          <button type="button" onClick={() => setMudancasDe("")} className={botao.icone} title="Todas as mudanças nas contas" aria-label="Todas as mudanças nas contas"><ListChecks className="h-4 w-4" aria-hidden="true" /></button>
          <Link to="/anuncios" className={botao.icone} title="Abrir Anúncios (contas e campanhas)" aria-label="Abrir Anúncios"><Megaphone className="h-4 w-4" aria-hidden="true" /></Link>
          <button type="button" onClick={atualizar} className={botao.icone} title="Atualizar" aria-label="Atualizar"><RefreshCw className={juntar("h-4 w-4", (boletins.isFetching || acoes.isFetching || campanhas.isFetching) && "animate-spin")} aria-hidden="true" /></button>
        </>}
      />

      {!carregando && !campanhas.error && todos.length > 0 && (
        <FaixaDeNumeros
          rotulo="Números da carteira"
          colunas={4}
          data-numeros-da-carteira=""
          itens={[
            {
              rotulo: "Gasto hoje",
              valor: brl(carteira.gastoHoje),
              apoio: carteira.tetoDia ? `teto ${brl(carteira.tetoDia)}/dia` : "sem teto na campanha",
              extra: carteira.tetoDia ? <div className="mt-2"><BarraFina fracao={carteira.gastoHoje / carteira.tetoDia} rotulo={`Gasto de hoje: ${brl(carteira.gastoHoje)} de ${brl(carteira.tetoDia)}`} /></div> : undefined,
            },
            { rotulo: "Resultados em 7 dias", valor: carteira.resultados.toLocaleString("pt-BR"), apoio: `${brl(carteira.gastoSemana)} investidos` },
            { rotulo: "Custo médio", valor: carteira.custoMedio === null ? "-" : brl(carteira.custoMedio, true), apoio: "por resultado, 7 dias" },
            { rotulo: "Pede você", valor: String(carteira.alertas), ponto: carteira.alertas ? "perigo" : "verde", corDoValor: carteira.alertas ? "text-destructive" : undefined, apoio: carteira.alertas ? "saldo, proposta, campanha, custo" : "tudo em ordem" },
          ]}
        />
      )}

      {/* Boletim do agente: uma linha; abre o resumo curto. */}
      {(ultimo || boletins.data?.ausente || boletins.error) && (
        <div className="min-w-0" data-boletim-linha="">
          {boletins.error ? <EstadoDeErro titulo="Não foi possível ler o boletim." descricao={(boletins.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void boletins.refetch()}>Tentar de novo</button>} />
            : !ultimo ? <EstadoVazio compacto titulo="O boletim ainda não chega a este painel." descricao="Falta ligar a gravação do boletim no servidor." />
              : <>
                <div className="flex min-w-0 items-center">
                  <button type="button" onClick={() => setBoletimAberto(!boletimAberto)} aria-expanded={boletimAberto} className={juntar(lista.linha, "-ml-2 flex-1 text-left")} title={boletimAberto ? "Recolher o boletim" : "Abrir o resumo do boletim"}>
                    <FileText className="mr-2.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className={juntar(texto.corpo, "shrink-0 font-medium")}>{nomeDoPeriodo(ultimo.periodo)}</span>
                    <span className={juntar(texto.auxiliar, "ml-2 hidden shrink-0 sm:inline")}>{quando(ultimo.criado_em)}</span>
                    {!boletimAberto && ultimo.resumo && <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>{ultimo.resumo}</span>}
                    {boletimAberto && <span className="flex-1" />}
                    {ultimo.alertas.length > 0 && <span className={juntar(etiqueta, "ml-2", TOM_DO_NIVEL[ultimo.alertas[0].nivel])}>{ultimo.alertas.length} {ultimo.alertas.length === 1 ? "alerta" : "alertas"}</span>}
                  </button>
                  {(boletins.data?.linhas.length ?? 0) > 1 && <button type="button" onClick={() => setHistoricoAberto(true)} className={juntar(botao.icone, "ml-1")} title={`Boletins anteriores (${(boletins.data?.linhas.length ?? 1) - 1})`} aria-label="Boletins anteriores"><History className="h-4 w-4" aria-hidden="true" /></button>}
                </div>
                {boletimAberto && <div className="mt-2 min-w-0 pl-[26px]"><ResumoDoBoletim boletim={ultimo} nomeDe={nomeDe} alertas={alertasGerais} aoLerCompleto={() => setAberto(ultimo)} /></div>}
              </>}
        </div>
      )}

      <Secao titulo="Clientes" descricao={carregando ? undefined : `${cartoes.length}`} recolher="anuncios-hoje:clientes">
        {carregando ? <Carregando linhas={3} rotulo="Lendo as contas de anúncio" />
          : campanhas.error ? <EstadoDeErro titulo="Não foi possível ler as campanhas." descricao={(campanhas.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void campanhas.refetch()}>Tentar de novo</button>} />
            : cartoes.length === 0 ? <EstadoVazio icone={<Megaphone className="h-5 w-5" />} titulo="Nenhum cliente com anúncio ativo na Mesa Ads." descricao="Quando uma campanha entrar no ar, o cliente aparece aqui." acao={<Link to="/mesa-ads" className={botao.secundario}>Abrir a Mesa Ads</Link>} />
              : <>
                <ul className={juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-3")} aria-label="Clientes com anúncio ativo">
                  {visiveis.map((c) => (
                    <CartaoDeAnuncio
                      key={c.clientId}
                      cartao={c}
                      nome={nomeDe(c.clientId)}
                      logo={identidades.data?.get(c.clientId)?.profile_picture_url ?? null}
                      aoVerMudancas={() => setMudancasDe(c.clientId)}
                    />
                  ))}
                </ul>
                {cartoes.length > visiveis.length && (
                  <button type="button" onClick={() => setPagina(pagina + 1)} className={juntar(botao.discreto, "relative -left-3 mt-2")}>
                    Mostrar mais {Math.min(POR_PAGINA, cartoes.length - visiveis.length)}
                  </button>
                )}
              </>}
      </Secao>

      <JanelaCentral
        aberta={mudancasDe !== null}
        onMudar={(v) => { if (!v) setMudancasDe(null); }}
        titulo={mudancasDe ? `Mudanças · ${nomeDe(mudancasDe)}` : "Mudanças nas contas"}
        descricao={`${mudancas.length} ${mudancas.length === 1 ? "mudança" : "mudanças"}`}
        icone={<ListChecks className="h-4 w-4" />}
        largura="lg"
      >
        {acoes.error ? <EstadoDeErro titulo="Não foi possível ler as mudanças." descricao={(acoes.error as Error).message} />
          : mudancas.length === 0 ? <EstadoVazio compacto titulo="Nenhuma mudança registrada nas contas." />
            : <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Mudanças nas contas">
              {mudancas.slice(0, 60).map((a) => (
                <li key={a.id} className={juntar(lista.linha, "block")} data-mudanca="">
                  <p className={juntar(texto.corpo, "min-w-0 truncate")}>
                    {!mudancasDe && <span className="text-muted-foreground">{nomeDe(a.clientId)} · </span>}
                    <span className="font-medium">{a.acao}</span> {a.alvoTipo ? <span className="text-muted-foreground">{a.alvoTipo} </span> : null}<span className="font-medium">{a.alvoNome}</span>
                  </p>
                  {(a.antes || a.depois) && <AntesDepois antes={a.antes} depois={a.depois} />}
                  {a.motivo && <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={a.motivo}>{a.motivo}</p>}
                  <p className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center")}>
                    <span className="min-w-0 truncate">{a.quem} · {quando(a.quando)}{a.estado === "desfeita" ? " · desfeita" : a.estado === "falhou" ? " · falhou" : ""}</span>
                    {a.provaUrl && <a href={a.provaUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex shrink-0 items-center text-primary hover:underline" title="Abrir a prova" aria-label="Abrir a prova"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
                  </p>
                </li>
              ))}
            </ul>}
      </JanelaCentral>

      <JanelaCentral aberta={historicoAberto} onMudar={setHistoricoAberto} titulo="Boletins anteriores" icone={<History className="h-4 w-4" />} largura="md">
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Boletins anteriores">
          {(boletins.data?.linhas ?? []).slice(1).map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => { setHistoricoAberto(false); setAberto(b); }} className={juntar(lista.linha, "w-full text-left")}>
                <FileText className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{nomeDoPeriodo(b.periodo)} · {quando(b.criado_em)}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{b.resumo || "Sem resumo"}</span>
                </span>
                {b.alertas.some((x) => x.nivel === "critico") && <AlertTriangle className="ml-2 h-4 w-4 shrink-0 text-destructive" aria-label="Tem alerta urgente" />}
              </button>
            </li>
          ))}
        </ul>
      </JanelaCentral>

      <JanelaCentral aberta={!!aberto} onMudar={(v) => { if (!v) setAberto(null); }} titulo={aberto ? nomeDoPeriodo(aberto.periodo) : "Boletim"} descricao={aberto ? quando(aberto.criado_em) : undefined} icone={<FileText className="h-4 w-4" />} largura="lg">
        {aberto && <div className="space-y-4" data-boletim="">
          <ResumoDoBoletim boletim={aberto} nomeDe={nomeDe} alertas={aberto.alertas} />
          {aberto.por_cliente.length > 0 && (
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Por cliente">
              {aberto.por_cliente.map((l, i) => (
                <li key={`${l.client_id}:${i}`} className={juntar(lista.linha, "block")}>
                  <p className={juntar(texto.corpo, "flex min-w-0 items-center")}>
                    <span className="min-w-0 flex-1 truncate font-medium">{nomeDe(l.client_id)}</span>
                    <span className="ml-3 shrink-0 tabular-nums">{brl(l.gasto)}</span>
                    {l.resultado && <span className="ml-3 shrink-0 tabular-nums text-muted-foreground">{l.resultado} res.</span>}
                  </p>
                  {l.observacao && <p className={juntar(texto.auxiliar, "mt-0.5")}>{l.observacao}</p>}
                </li>
              ))}
            </ul>
          )}
          {aberto.texto_completo && <p className={juntar(texto.corpo, "whitespace-pre-wrap")}>{aberto.texto_completo}</p>}
        </div>}
      </JanelaCentral>
    </div>
  );
}

/** O resumo do boletim: o texto curto e os alertas em etiquetas (sem texto corrido longo). */
function ResumoDoBoletim({ boletim, nomeDe, alertas, aoLerCompleto }: { boletim: Boletim; nomeDe: (id: string | null) => string; alertas: Boletim["alertas"]; aoLerCompleto?: () => void }) {
  return (
    <div className="min-w-0 space-y-2.5" data-resumo-do-boletim="">
      {boletim.resumo && <p className={juntar(texto.corpo, "max-w-[80ch] [overflow-wrap:anywhere]")}>{boletim.resumo}</p>}
      {alertas.length > 0 && (
        <ul className="min-w-0 space-y-1.5" aria-label="Alertas do boletim">
          {alertas.map((a, i) => (
            <li key={i} className="flex min-w-0 items-start" data-nivel={a.nivel}>
              <span className={juntar(etiqueta, "mr-2 mt-px", TOM_DO_NIVEL[a.nivel])}>{ROTULO_DO_NIVEL[a.nivel]}</span>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{a.client_id ? <span className="font-medium">{nomeDe(a.client_id)}: </span> : null}{a.texto}</span>
            </li>
          ))}
        </ul>
      )}
      {aoLerCompleto && (boletim.texto_completo || boletim.por_cliente.length > 0) && (
        <button type="button" onClick={aoLerCompleto} className={juntar(botao.discreto, "relative -left-3 h-8")}>
          <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" />Ler completo
        </button>
      )}
    </div>
  );
}

function AntesDepois({ antes, depois }: { antes: string | null; depois: string | null }) {
  return (
    <p className={juntar(texto.corpo, "mt-0.5 flex min-w-0 items-center tabular-nums")}>
      <span className="min-w-0 truncate text-muted-foreground line-through decoration-muted-foreground/40">{antes || "-"}</span>
      <ArrowRight className="mx-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="para" />
      <span className="min-w-0 truncate font-medium">{depois || "-"}</span>
    </p>
  );
}

/** Sete barrinhas do gasto diário (hoje à direita). CSS puro, como os gráficos da central de horas. */
function MiniBarras({ serie }: { serie: number[] }) {
  const maior = serie.reduce((m, v) => Math.max(m, v), 0);
  const nomes = serie.map((_, i) => diaLocal(Date.now() - (serie.length - 1 - i) * 86_400_000).slice(8));
  return (
    <div className="flex h-9 shrink-0 items-end" role="img" aria-label={`Gasto dos últimos 7 dias: ${serie.map((v) => brl(v)).join(", ")}`}>
      {serie.map((v, i) => (
        <span
          key={i}
          title={`Dia ${nomes[i]}: ${brl(v)}`}
          className={juntar("ml-[3px] w-[7px] rounded-t-[2px]", i === serie.length - 1 ? "bg-primary" : "bg-primary/40")}
          style={{ height: maior > 0 ? Math.max(v > 0 ? 3 : 1, Math.round((v / maior) * 36)) : 1 }}
        />
      ))}
    </div>
  );
}

function Medida({ rotulo, valor, teto }: { rotulo: string; valor: number; teto: number | null }) {
  const fracao = teto ? valor / teto : 0;
  return (
    <div className="min-w-0">
      <p className={juntar(texto.auxiliar, "flex min-w-0 items-baseline")}>
        <span className="shrink-0">{rotulo}</span>
        <span className={juntar("ml-auto truncate pl-2 tabular-nums", fracao > 1.2 ? "text-destructive" : fracao > 1.05 ? "text-warning" : "text-foreground")}>
          <span className="font-medium">{brl(valor)}</span>{teto ? <span className="text-muted-foreground"> / {brl(teto)}</span> : null}
        </span>
      </p>
      <div className="mt-1">
        <BarraFina fracao={teto ? fracao : 0} cor={fracao > 1.2 ? "bg-destructive" : fracao > 1.05 ? "bg-warning" : "bg-primary"} rotulo={teto ? `${rotulo}: ${brl(valor)} de ${brl(teto)}` : `${rotulo}: ${brl(valor)} (sem teto na campanha)`} />
      </div>
    </div>
  );
}

function situacaoEmTexto(s: SituacaoDaCampanha, fim: string | null): string {
  if (s === "terminada") return `terminou ${dataCurta(fim)}`;
  if (s === "terminando") return `termina ${dataCurta(fim)}`;
  return fim ? `até ${dataCurta(fim)}` : "ativa";
}

function CartaoDeAnuncio({ cartao: c, nome, logo, aoVerMudancas }: { cartao: CartaoDoCliente; nome: string; logo: string | null; aoVerMudancas: () => void }) {
  const tom = TOM_DO_CUSTO[c.tom];
  const variacao = c.custoPorResultado !== null && c.custoAnterior ? Math.round(((c.custoPorResultado - c.custoAnterior) / c.custoAnterior) * 100) : null;
  const singular = c.nomeDoResultado === "conversas" ? "conversa" : c.nomeDoResultado === "leads" ? "lead" : c.nomeDoResultado === "vendas" ? "venda" : "resultado";
  const destino = `/mesa-ads?client=${encodeURIComponent(c.clientId)}&etapa=conta`;
  const acao: { rotulo: string; primaria: boolean; icone: ReactNode } = c.propostas
    ? { rotulo: `Decidir ${c.propostas === 1 ? "a proposta" : `${c.propostas} propostas`}`, primaria: true, icone: <Bot className="mr-1.5 h-4 w-4" aria-hidden="true" /> }
    : { rotulo: "Abrir na Mesa Ads", primaria: false, icone: <ArrowRight className="mr-1.5 h-4 w-4" aria-hidden="true" /> };
  const urgentes = c.alertas.filter((a) => a.nivel !== "info");
  const a = c.ultimaAcao;

  return (
    <li className={juntar(superficie.painel, "flex min-w-0 flex-col p-4")} data-cartao-de-anuncio={c.clientId}>
      {/* Cabeçalho: logo, nome e o que pede atenção. */}
      <div className="flex min-w-0 items-center">
        <LogoDoCliente url={logo} clienteId={c.clientId} nome={nome} tamanho={32} className="mr-2.5" />
        <p className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")} title={nome}>{nome}</p>
        {c.saldoBaixo && <Wallet className="ml-2 h-4 w-4 shrink-0 text-destructive" aria-label="Saldo baixo" />}
        {urgentes.length > 0 && <AlertTriangle className={juntar("ml-2 h-4 w-4 shrink-0", urgentes.some((x) => x.nivel === "critico") ? "text-destructive" : "text-warning")} aria-label={urgentes.map((x) => x.texto).join("; ")} />}
      </div>

      {/* Gasto contra o teto, com o desenho da semana ao lado. */}
      <div className="mt-4 flex min-w-0 items-end">
        <div className="min-w-0 flex-1 space-y-2.5">
          <Medida rotulo="Hoje" valor={c.gastoHoje} teto={c.tetoDia} />
          <Medida rotulo="7 dias" valor={c.gastoSemana} teto={c.tetoSemana} />
        </div>
        <div className="ml-4"><MiniBarras serie={c.serie} /></div>
      </div>

      {/* Resultado principal e custo com cor. */}
      <div className="mt-4 flex min-w-0 items-end border-t border-border pt-3" data-resultado="">
        <div className="min-w-0 flex-1">
          <p className={texto.rotulo}>{c.nomeDoResultado === "resultados" ? "Resultados" : c.nomeDoResultado.charAt(0).toUpperCase() + c.nomeDoResultado.slice(1)} em 7 dias</p>
          <p className={juntar(texto.numero, "leading-8")}>{c.resultados === null ? "-" : c.resultados.toLocaleString("pt-BR")}</p>
        </div>
        <div className="ml-3 min-w-0 text-right">
          <p className={juntar(texto.corpo, "tabular-nums")}>{c.custoPorResultado === null ? "sem custo" : <><span className="font-medium">{brl(c.custoPorResultado, true)}</span><span className="text-muted-foreground">/{singular}</span></>}</p>
          <p className="mt-1 flex items-center justify-end">
            {variacao !== null && variacao !== 0 && (
              <span className={juntar(texto.auxiliar, "mr-1.5 flex items-center tabular-nums")} title="Contra a semana anterior">
                {variacao > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}{Math.abs(variacao)}%
              </span>
            )}
            <span className={juntar(etiqueta, tom.classe)} data-tom={c.tom}>{tom.rotulo}</span>
          </p>
        </div>
      </div>

      {/* Campanhas (até 3) e saldo. */}
      <ul className="mt-3 min-w-0 space-y-1" aria-label={`Campanhas de ${nome}`}>
        {c.campanhas.slice(0, 3).map((k) => (
          <li key={k.chave} className={juntar(texto.auxiliar, "flex min-w-0 items-center")} data-campanha={k.situacao}>
            <span className={juntar("mr-2 h-1.5 w-1.5 shrink-0 rounded-full", PONTO_DA_SITUACAO[k.situacao])} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-foreground" title={k.nome}>{k.nome}</span>
            <span className={juntar("ml-2 shrink-0", k.situacao === "terminada" ? "text-destructive" : k.situacao === "terminando" ? "text-warning" : "")}>{situacaoEmTexto(k.situacao, k.fim)}</span>
          </li>
        ))}
        {c.campanhas.length > 3 && <li className={texto.auxiliar}>+{c.campanhas.length - 3} {c.campanhas.length - 3 === 1 ? "campanha" : "campanhas"}</li>}
      </ul>
      {c.saldo !== null && (
        <p className={juntar(texto.auxiliar, "mt-2 flex min-w-0 items-center", c.saldoBaixo && "text-destructive")} data-saldo={c.saldoBaixo ? "baixo" : "ok"}>
          <Wallet className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">Saldo {brl(c.saldo, true)}{c.diasQueCobre !== null ? ` · cobre ${String(c.diasQueCobre).replace(".", ",")} ${c.diasQueCobre === 1 ? "dia" : "dias"}` : ""}</span>
        </p>
      )}

      {/* A última mudança do agente: antes → depois, com prova. */}
      <div className="mt-3 min-w-0 rounded-md bg-muted/50 px-3 py-2" data-ultima-mudanca="">
        {a ? (
          <>
            <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
              <Bot className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{a.quem} · {quando(a.quando)}</span>
              {a.provaUrl && <a href={a.provaUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex shrink-0 items-center text-primary" title="Abrir a prova" aria-label="Abrir a prova"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
              <button type="button" onClick={aoVerMudancas} className="ml-2 inline-flex shrink-0 items-center hover:text-foreground" title="Todas as mudanças deste cliente" aria-label={`Todas as mudanças de ${nome}`}><History className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </p>
            <p className={juntar(texto.corpo, "mt-1 min-w-0 truncate")} title={a.motivo || undefined}><span className="font-medium">{a.acao}</span> <span className="text-muted-foreground">{a.alvoNome}</span></p>
            {(a.antes || a.depois) && <AntesDepois antes={a.antes} depois={a.depois} />}
          </>
        ) : (
          <p className={juntar(texto.auxiliar, "flex items-center")}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Nenhuma mudança do agente ainda</p>
        )}
      </div>

      {/* Uma ação. */}
      <div className="mt-auto flex min-w-0 items-center pt-4">
        <Link to={destino} className={juntar(acao.primaria ? botao.primario : botao.secundario, "h-8")} data-acao-do-cartao="">
          {acao.icone}{acao.rotulo}
        </Link>
        {c.campanhas.some((k) => k.situacao !== "ativa") && <CalendarClock className="ml-auto h-4 w-4 shrink-0 text-warning" aria-label="Campanha terminando ou terminada" />}
      </div>
    </li>
  );
}

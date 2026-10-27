import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Coins,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Layers,
  Link2,
  Megaphone,
  PiggyBank,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import {
  META_OAUTH_MESSAGE_TYPE,
  startAdsOAuth,
  type MetaOAuthPopupMessage,
} from "@/lib/socialMetaOAuth";
import GaleriaDeCriativos from "@/components/ads/GaleriaDeCriativos";
import { resumirCriativos } from "@/lib/adsCreativeReport";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import CampanhasAtivas from "@/components/ads/CampanhasAtivas";
import FrescorDaMeta from "@/components/ads/FrescorDaMeta";
import LeadsDoAnuncio, { ContagemDeLeads } from "@/components/ads/LeadsDoAnuncio";
import { ligarLeadsAosAnuncios, ultimaLeituraDasContas, type LeadComOrigem } from "@/components/ads/leadsDosAnuncios";
import { useLeadsDosAnuncios, type LeadsDosAnuncios } from "@/components/ads/useLeadsDosAnuncios";
import type { Temperatura } from "@/components/comercial/temperatura";
import { PARAMETROS_DE_URL_DA_META } from "../../supabase/functions/_shared/origem-clique";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import { useAuth } from "@/contexts/AuthContext";
import AtivarGestao from "@/components/mesa-ads/AtivarGestao";
import { useClients } from "@/hooks/useSupabaseData";
import { hasService } from "@/lib/clientFlags";
import {
  AjudaRecolhida,
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeBusca,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Etapas,
  GrupoDeCampos,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  foco,
  juntar,
  lista,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import {
  collectAdsMetricsNow,
  useAdsCreatives,
  connectAdsAccount,
  ContaDeOutroCliente,
  saveMetaAdsToken,
  useAdsCampaigns,
  useAdsConnection,
  useAdsDaily,
  type AdsCampaign,
  type AdsConnectionStatus,
  type AdsDaily,
} from "@/hooks/useAdsMetrics";
import {
  clientCampaignLine,
  clientCampaignSentence,
  dinheiro,
  numero,
  statusLabel,
  summarizeAccount,
  summarizeCampaign,
  teamAlert,
  teamCampaignLine,
  EXPLICACOES,
  type CampaignSummary,
} from "@/lib/adsLanguage";
import {
  CLASSE_DO_TOM_DA_CONTA,
  SALDO_BAIXO,
  haQuanto,
  ordenarPorSituacao,
  resultadosPorObjetivo,
  rotuloDoResultado,
  situacaoDaConta,
  type ResultadoDoObjetivo,
} from "@/lib/adsResumo";
import { tendenciaDoCliente, type Direcao, type TendenciaDoCliente } from "@/lib/adsTendencia";

/**
 * A área de anúncios (docs/design/SISTEMA.md). Pedidos do dono: 26/09
 * ("desorganizada, confusa, poluída") e 16/10 ("mais intuitivo, mais claro,
 * mais simplificado").
 *
 * 16/10 (dono, segundo pedido): "menos texto, mais ícones; passo em cima do
 * ícone e ele fala o que é". As partes viraram abas em ícone (uma por vez,
 * nada de rolar para baixo infinito) e as ações viraram ícones sem borda,
 * com o nome no title e no aria-label. Cada ícone, uma ação só.
 *
 * Lista (sem cliente aberto): na linha do título "Anúncios", as abas
 * Clientes | No ar agora | Contas e conexão e, à direita, "Ver contas" (só
 * quando uma conta pede atenção; abre e fecha o detalhe com Reconectar) e
 * "Atualizar agora".
 * - Clientes: uma linha por cliente com os quatro números que importam
 *   (investido, resultado, custo por resultado, saldo), cada um com ícone
 *   e seta de tendência. Tocar abre o cliente.
 * - No ar agora: o que está rodando e o que fazer a respeito.
 * - Contas e conexão: situação das contas, conectar com a Meta, ligar pelo
 *   número, token da agência e gestão pelo agente.
 *
 * Cliente aberto (?cliente=): ações em ícone no cabeçalho, as abas em ícone
 * logo embaixo (Campanhas | No ar agora | Criativos | Contas), os mesmos
 * quatro números grandes sempre à vista e a aba escolhida.
 *
 * A aba escolhida fica guardada (useEstadoDaTela): sair e voltar mantém.
 *
 * De 1024 px para cima só o conteúdo abaixo do cabeçalho rola (AreaDeTrabalho,
 * com a posição guardada); no celular a página rola normal.
 */

type Conta = AdsConnectionStatus["contas"][number];

const TOM: Record<string, string> = {
  ativa: "bg-success/10 text-success",
  pausada: "bg-muted text-muted-foreground",
  encerrada: "bg-muted text-muted-foreground",
  atencao: "bg-destructive/10 text-destructive",
};

function StatusChip({ campaign }: { campaign?: AdsCampaign }) {
  const { label, tone } = statusLabel(campaign?.status, campaign?.effective_status, campaign?.stop_time);
  return <span className={juntar(etiqueta, "ml-2 shrink-0", TOM[tone])}>{label}</span>;
}

/** O resultado principal (o objetivo com mais dinheiro) e, em uma linha, os outros. */
function resumoDosResultados(lista: ResultadoDoObjetivo[]) {
  const principal = lista.find((r) => r.kind !== "alcance" && r.resultados > 0) || null;
  const outros = lista.filter((r) => r !== principal && r.kind !== "alcance" && r.resultados > 0);
  return {
    principal,
    outros: outros.map((r) => rotuloDoResultado(r)).join(" · "),
  };
}

const saldoDas = (contas: Conta[]): number | null => {
  const comSaldo = contas.filter((c) => c.status === "active" && c.saldo_disponivel != null);
  return comSaldo.length ? comSaldo.reduce((t, c) => t + Number(c.saldo_disponivel || 0), 0) : null;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const temProblema = (c: Conta) => {
  const tom = situacaoDaConta(c).tom;
  return tom === "erro" || tom === "atencao";
};

/**
 * Ação da página (16/10): só o ícone, sem borda; o nome no title (o mouse
 * fala o que é) e no aria-label (o leitor de tela também).
 */
function BotaoDeIcone({
  icone,
  rotulo,
  dica,
  onClick,
  disabled,
  className,
}: {
  icone: ReactNode;
  rotulo: string;
  /** Title quando difere do nome (ex.: "Pedindo leitura..."). */
  dica?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={juntar(botao.icone, "disabled:opacity-50", className)} aria-label={rotulo} title={dica || rotulo}>
      {icone}
    </button>
  );
}

/* ─────────────────────────────── as abas ─────────────────────────────── */

type AbaDaLista = "clientes" | "agora" | "contas";
type AbaDoCliente = "campanhas" | "agora" | "criativos" | "contas";

const ABAS_DA_LISTA: AbaDaLista[] = ["clientes", "agora", "contas"];
const ABAS_DO_CLIENTE: AbaDoCliente[] = ["campanhas", "agora", "criativos", "contas"];

/**
 * Dica para o dono (19/10): como montar o link do anúncio para cada lead
 * chegar dizendo de qual anúncio veio. Mora no "?" (cabeçalhos e aba Campanhas).
 */
export const DICA_DO_LINK_DO_ANUNCIO = `Para ligar cada lead ao anúncio: no Gerenciador da Meta, no anúncio, em Destino > Parâmetros de URL, cole ${PARAMETROS_DE_URL_DA_META}. No clique a Meta troca {{ad.id}} pelo número do anúncio; o formulário do site guarda e o lead aparece na campanha e na peça, com a temperatura do CRM.`;

/** O que cada aba faz: mora no "?" ao lado da aba aberta. */
const AJUDA_DAS_ABAS = {
  clientes:
    "Por cliente, nos últimos 30 dias: investido, resultado pelo objetivo de cada campanha (conversa não soma com venda), custo por resultado e saldo. A seta compara os últimos 15 dias com os 15 anteriores. Toque num cliente para abrir.",
  agora:
    "O que está rodando agora e o que fazer a respeito. Cada aviso traz o número que o gerou, e os avisos só aparecem com volume suficiente para não confundir ruído com sinal. Atualiza sozinho a cada minuto.",
  contas:
    "Conecte com a Meta, escolha as contas e o cliente de cada uma. Daí em diante o painel lê campanhas, saldo e criativos sozinho, de hora em hora. Em Mais opções: ligar pelo número e o token da agência.",
  campanhas:
    `Toque numa campanha para ver as duas leituras: como o cliente lê no relatório e os números que a equipe usa para decidir, e os leads que ela trouxe ao CRM. ${DICA_DO_LINK_DO_ANUNCIO}`,
  criativos:
    "Qual arte fez o trabalho: gasto, cliques no link e custo de cada peça. O padrão mostra as que rodaram; as paradas ficam a um clique. Toque numa peça para ver grande.",
} as const;

const ICONE_DA_ABA = "h-4 w-4";

/* ─────────────────────────────── os quatro números ─────────────────────────────── */

/** Seta de tendência: verde quando melhorou, vermelha quando piorou, cinza quando ficou igual. */
function Seta({ direcao, subirEhBom }: { direcao: Direcao | null; subirEhBom: boolean }) {
  if (!direcao) return null;
  const Icone = direcao === "subiu" ? ArrowUpRight : direcao === "caiu" ? ArrowDownRight : ArrowRight;
  const bom = direcao === "igual" ? null : (direcao === "subiu") === subirEhBom;
  const dica = direcao === "igual" ? "Estável nos últimos 15 dias" : `${direcao === "subiu" ? "Subiu" : "Caiu"} nos últimos 15 dias`;
  return (
    <span
      role="img"
      aria-label={dica}
      title={dica}
      data-tendencia={direcao}
      className={juntar("ml-1 inline-flex shrink-0", bom == null ? "text-muted-foreground" : bom ? "text-success" : "text-destructive")}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

/** Um número com ícone: o valor grande, a unidade miúda embaixo. */
function Metrica({
  icone,
  valor,
  unidade,
  seta,
  dica,
  corDoValor,
  grande = false,
}: {
  icone: ReactNode;
  valor: string;
  unidade: string;
  seta?: ReactNode;
  dica?: string;
  corDoValor?: string;
  grande?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center" title={dica} data-metrica="">
      <span
        className={juntar("mr-2 inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", grande ? "h-9 w-9" : "h-7 w-7")}
        aria-hidden="true"
      >
        {icone}
      </span>
      <div className="min-w-0">
        <p className={juntar("flex min-w-0 items-center font-semibold tabular-nums", grande ? "text-[20px] leading-7" : "text-[15px] leading-5", corDoValor || "text-foreground")}>
          <span className="min-w-0 truncate">{valor}</span>
          {seta}
        </p>
        <p className={juntar(texto.etiqueta, "truncate font-normal text-muted-foreground")}>{unidade}</p>
      </div>
    </div>
  );
}

interface NumerosDoClienteDados {
  investido: number;
  campanhas: number;
  alcance: number;
  principal: ResultadoDoObjetivo | null;
  outros: string;
  saldo: number | null;
  tendencia: TendenciaDoCliente;
}

function numerosDoCliente(rows: AdsDaily[], contas: Conta[]): NumerosDoClienteDados {
  const carteira = summarizeAccount(rows);
  const res = resumoDosResultados(resultadosPorObjetivo(rows));
  return {
    investido: carteira.investido,
    campanhas: carteira.campanhas,
    alcance: carteira.alcance,
    principal: res.principal,
    outros: res.outros,
    saldo: saldoDas(contas),
    tendencia: tendenciaDoCliente(rows, res.principal ? res.principal.kind : null),
  };
}

/** Investido, resultado, custo por resultado e saldo, cada um com ícone (e seta quando há tendência). */
function NumerosDoCliente({ dados, grande = false }: { dados: NumerosDoClienteDados; grande?: boolean }) {
  const p = dados.principal;
  const custo = p && p.custoPorResultado != null && p.custoPorResultado > 0 ? p.custoPorResultado : null;
  const icone = grande ? "h-[18px] w-[18px]" : "h-4 w-4";
  return (
    <div className={juntar("grid min-w-0 grid-cols-2 gap-x-4 gap-y-3", grande ? "md:grid-cols-4" : "lg:grid-cols-4")}>
      <Metrica grande={grande} icone={<Wallet className={icone} />} valor={dinheiro(dados.investido)} unidade="investido" dica={EXPLICACOES.investido} />
      <Metrica
        grande={grande}
        icone={<Target className={icone} />}
        valor={p ? numero(p.resultados) : "-"}
        unidade={p ? (p.resultados === 1 ? p.singular : p.plural) : "sem resultado"}
        seta={<Seta direcao={dados.tendencia.resultados} subirEhBom />}
        dica={dados.outros ? `Também: ${dados.outros}` : EXPLICACOES.resultados}
      />
      <Metrica
        grande={grande}
        icone={<Coins className={icone} />}
        valor={custo != null ? dinheiro(custo) : "-"}
        unidade={p ? `por ${p.singular}` : "por resultado"}
        seta={<Seta direcao={dados.tendencia.custo} subirEhBom={false} />}
        dica={EXPLICACOES.custoPorResultado}
      />
      <Metrica
        grande={grande}
        icone={<PiggyBank className={icone} />}
        valor={dados.saldo != null ? dinheiro(dados.saldo) : "-"}
        unidade={dados.saldo != null ? "saldo" : "pós-paga ou sem leitura"}
        corDoValor={dados.saldo != null && dados.saldo < SALDO_BAIXO ? "text-warning" : undefined}
        dica={dados.saldo != null && dados.saldo < SALDO_BAIXO ? "Saldo baixo: avise o cliente para recarregar." : undefined}
      />
    </div>
  );
}

/* ─────────────────────────────── aviso das contas ─────────────────────────────── */

/** As contas ativas que pedem atenção, problema primeiro. */
const contasComProblema = (contas: Conta[]) =>
  ordenarPorSituacao(contas.filter((c) => c.status === "active" && temProblema(c)));

const frasePedemAtencao = (n: number) => (n === 1 ? "1 conta pede atenção" : `${n} contas pedem atenção`);

/** Âncora do detalhe que o "Ver contas" abre. */
const ID_DO_DETALHE = "anuncios-contas-com-atencao";

/**
 * "Ver contas" (16/10): antes uma linha inteira de aviso; agora só o ícone de
 * alerta na linha do título, com a contagem, e só quando alguma conta pede
 * atenção. Tocar abre o detalhe embaixo do cabeçalho; tocar de novo fecha.
 */
function BotaoVerContas({ contas, aberto, aoAlternar }: { contas: Conta[]; aberto: boolean; aoAlternar: () => void }) {
  const comProblema = contasComProblema(contas);
  if (comProblema.length === 0) return null;
  const grave = comProblema.some((c) => situacaoDaConta(c).tom === "erro");
  return (
    <button
      type="button"
      onClick={aoAlternar}
      aria-expanded={aberto}
      aria-controls={aberto ? ID_DO_DETALHE : undefined}
      aria-label="Ver contas"
      title={`Ver contas · ${frasePedemAtencao(comProblema.length)}`}
      data-ver-contas=""
      className={juntar(
        botao.icone,
        "relative",
        grave ? "text-destructive hover:text-destructive" : "text-warning hover:text-warning",
        aberto && "bg-muted",
      )}
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-muted px-1 text-center text-[11px] font-semibold leading-4 tabular-nums text-foreground"
      >
        {comProblema.length}
      </span>
    </button>
  );
}

/**
 * O detalhe do "Ver contas": cada conta que pede atenção, o que a Meta disse
 * e o que fazer; quando o acesso venceu, "Reconectar com a Meta" ali mesmo.
 */
function DetalheDasContas({
  contas,
  nomes,
  abrindo,
  aoReconectar,
}: {
  contas: Conta[];
  nomes?: Map<string, string>;
  abrindo: boolean;
  aoReconectar: () => void;
}) {
  const comProblema = contasComProblema(contas);
  if (comProblema.length === 0) return null;
  const situacoes = comProblema.map((c) => situacaoDaConta(c));
  const grave = situacoes.some((s) => s.tom === "erro");
  const reconectar = situacoes.some((s) => s.reconectar);
  return (
    <div
      id={ID_DO_DETALHE}
      role="region"
      aria-label="Contas que pedem atenção"
      data-aviso-das-contas=""
      className={juntar("min-w-0 rounded-lg px-3 py-2", grave ? "bg-destructive/10" : "bg-warning/10")}
    >
      <div className="flex min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground">{frasePedemAtencao(comProblema.length)}</p>
        {reconectar && (
          <button type="button" className={juntar(botao.primario, "ml-3")} onClick={aoReconectar} disabled={abrindo}>
            <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {abrindo ? "Abrindo a Meta..." : "Reconectar com a Meta"}
          </button>
        )}
      </div>
      <ul className="mt-1 min-w-0 divide-y divide-border/60" aria-label="Contas com atenção">
        {comProblema.map((conta, i) => {
          const sit = situacoes[i];
          const tom = CLASSE_DO_TOM_DA_CONTA[sit.tom];
          const dono = nomes && nomes.get(conta.client_id);
          return (
            <li key={conta.id} className="flex min-w-0 items-start py-1.5">
              <span className={juntar("mr-2 mt-1.5 h-2 w-2 shrink-0 rounded-full", tom.ponto)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-5 text-foreground">
                  {conta.display_name}
                  {dono && <span className="text-muted-foreground"> · {dono}</span>}
                </p>
                {conta.erro && (
                  <p className="truncate text-[12px] leading-4 text-destructive" title={conta.erro}>
                    A Meta recusou a leitura: {conta.erro}
                  </p>
                )}
                {sit.acao && <p className={juntar(texto.auxiliar, "truncate")} title={sit.acao}>{sit.acao}</p>}
              </div>
              <p className={juntar("ml-3 shrink-0 text-[12px] font-medium leading-5", tom.texto)}>{sit.rotulo}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─────────────────────────────── dossiê do cliente ─────────────────────────────── */

/** Uma campanha: a linha curta e, ao tocar, as duas leituras (cliente e equipe). */
function LinhaDaCampanha({
  resumo,
  ficha,
  leads = [],
  temperaturas,
}: {
  resumo: CampaignSummary;
  ficha?: AdsCampaign;
  /** Leads do CRM que vieram desta campanha (origem do clique). */
  leads?: LeadComOrigem[];
  temperaturas?: Map<string, Temperatura>;
}) {
  const [aberta, setAberta] = useState(false);
  const alerta = teamAlert(resumo);
  const resultado =
    resumo.resultados != null && resumo.resultados > 0
      ? [
          `${numero(resumo.resultados)} ${resumo.resultados === 1 ? resumo.goal.resultSingular : resumo.goal.resultPlural}`,
          resumo.custoPorResultado != null && resumo.custoPorResultado > 0 ? `${dinheiro(resumo.custoPorResultado)} cada` : "",
        ].filter(Boolean).join(" · ")
      : "sem resultado medido";
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className={juntar(lista.linha, "w-full text-left", foco)}
      >
        <ChevronRight className={juntar("mr-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberta ? "rotate-90" : "")} aria-hidden="true" />
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{resumo.name}</span>
            <StatusChip campaign={ficha} />
          </span>
          <span className={juntar(texto.auxiliar, "block truncate tabular-nums")}>{resultado}</span>
        </span>
        <ContagemDeLeads total={leads.length} className="ml-2" />
        {alerta && (
          <span role="img" aria-label="Pede atenção" title={alerta} className="ml-2 inline-flex shrink-0 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <span className="ml-3 shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{dinheiro(resumo.investido)}</span>
      </button>
      {aberta && (
        <div className="min-w-0 pb-3 pl-8 pr-2">
          {alerta && (
            <p className="mb-2 flex items-start text-[12px] leading-5 text-destructive">
              <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {alerta}
            </p>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            {/* A leitura do cliente, exatamente como sai no relatório dele. */}
            <div className={juntar(superficie.poco, "min-w-0 px-3 py-2")}>
              <p className={texto.rotulo}>Como o cliente lê</p>
              <p className="mt-0.5 text-[13px] leading-5 text-foreground">{clientCampaignSentence(resumo)}</p>
            </div>
            {/* E os números de operar. */}
            <div className="min-w-0 px-1 py-2 md:px-0">
              <p className={texto.rotulo}>Para a equipe</p>
              <p className="mt-0.5 text-[12px] leading-5 tabular-nums text-foreground [overflow-wrap:anywhere]">{teamCampaignLine(resumo)}</p>
              {ficha?.daily_budget != null && (
                <p className={texto.auxiliar}>Verba diária: {dinheiro(Number(ficha.daily_budget))}</p>
              )}
            </div>
          </div>
          {leads.length > 0 && <LeadsDoAnuncio leads={leads} temperaturas={temperaturas || new Map()} className="mt-3" />}
        </div>
      )}
    </li>
  );
}

function ClientAdsDetail({
  clientId,
  clientName,
  logoUrl,
  rows,
  campaigns,
  contas,
  carregando,
  verContas,
  detalheDasContas,
  agora,
  contasDoCliente,
  seletorDeCliente,
  atualizar,
  erro,
  podeAbrirMesaAds,
  aba,
  aoEscolherAba,
  leadsDoCrm,
  frescor,
}: {
  clientId: string;
  clientName: string;
  logoUrl?: string | null;
  rows: AdsDaily[];
  campaigns: AdsCampaign[];
  contas: Conta[];
  carregando: boolean;
  /** "Ver contas" em ícone (só quando uma conta deste cliente pede atenção). */
  verContas: ReactNode;
  /** O detalhe que o "Ver contas" abre (null fechado). */
  detalheDasContas: ReactNode;
  /** O que está no ar agora deste cliente, montado pela página. */
  agora: ReactNode;
  /** As contas de anúncio só deste cliente (ContasEConexao filtrada). */
  contasDoCliente: ReactNode;
  seletorDeCliente: ReactNode;
  atualizar: ReactNode;
  erro: ReactNode;
  podeAbrirMesaAds: boolean;
  aba: AbaDoCliente;
  aoEscolherAba: (aba: AbaDoCliente) => void;
  /** Leads do CRM com origem de clique (só admin e manager leem o CRM). */
  leadsDoCrm?: LeadsDosAnuncios;
  /** "Dados da Meta de há X" das contas deste cliente. */
  frescor?: ReactNode;
}) {
  const navigate = useNavigate();
  const porCampanha = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of rows) {
      const lista = mapa.get(row.campaign_id) || [];
      lista.push(row);
      mapa.set(row.campaign_id, lista);
    }
    return [...mapa.entries()]
      .map(([id, lista]) => ({
        resumo: summarizeCampaign(lista)!,
        ficha: campaigns.find((c) => c.campaign_id === id),
      }))
      .filter((item) => item.resumo)
      .sort((a, b) => b.resumo.investido - a.resumo.investido);
  }, [rows, campaigns]);

  const carteira = useMemo(() => summarizeAccount(rows), [rows]);
  const dados = useMemo(() => numerosDoCliente(rows, contas), [rows, contas]);
  const { data: criativos } = useAdsCreatives(clientId, 30);

  // Leads no CRM por campanha e por peça: pelo id do link (utm_content={{ad.id}}).
  const leadsLigados = useMemo(
    () =>
      ligarLeadsAosAnuncios(
        (leadsDoCrm && leadsDoCrm.leads) || [],
        criativos || [],
        campaigns.map((c) => ({ campaign_id: c.campaign_id, name: c.name })),
        clientId,
      ),
    [leadsDoCrm, criativos, campaigns, clientId],
  );
  const temperaturas = (leadsDoCrm && leadsDoCrm.temperaturas) || undefined;

  /**
   * Abre o relatório já preenchido com o que a Meta devolveu. O resumo sai
   * na língua do cliente (a mesma camada que alimenta o portal), e os números
   * vão nos nomes que o relatório já entende: ninguém redigita.
   */
  const gerarRelatorio = () => {
    const dias = [...rows].map((row) => row.day).sort();
    const linhas = porCampanha
      .map(({ resumo }) => `· ${resumo.name}: ${clientCampaignLine(resumo)}`)
      .join("\n");

    // As peças entram no MESMO relatório: quem lê quer uma página, não duas.
    const pecas = resumirCriativos(criativos || []);

    const parametros = new URLSearchParams({
      cliente: clientId,
      titulo: `Anúncios · ${clientName}`,
      inicio: dias[0] || "",
      fim: dias[dias.length - 1] || "",
      resumo: `Resumo dos anúncios no período:\n${linhas}`
        + (pecas.texto ? `\n\nCriativos:\n${pecas.texto}` : ""),
      destaques: [
        porCampanha[0] ? clientCampaignSentence(porCampanha[0].resumo) : "",
        pecas.destaque,
      ].filter(Boolean).join(" "),
      metricas: JSON.stringify({
        ad_spend: Number(carteira.investido.toFixed(2)),
        reach: carteira.alcance,
        ...(carteira.resultados != null ? { results: carteira.resultados } : {}),
        ...(pecas.total > 0
          ? { creatives_total: pecas.total, creatives_running: pecas.rodaram }
          : {}),
      }),
    });
    navigate(`/relatorios/novo?${parametros.toString()}`);
  };

  const apoio = [
    carteira.alcance > 0 ? `${numero(carteira.alcance)} pessoas alcançadas` : "",
    dados.outros ? `Também: ${dados.outros}` : "",
  ].filter(Boolean).join(" · ");

  // As partes do cliente, uma por vez (16/10): só o ícone; a aberta mostra o nome e o "?".
  const abas = [
    { valor: "campanhas", rotulo: "Campanhas", icone: <Layers className={ICONE_DA_ABA} />, contador: porCampanha.length, ajuda: AJUDA_DAS_ABAS.campanhas },
    { valor: "agora", rotulo: "No ar agora", icone: <Radio className={ICONE_DA_ABA} />, ajuda: AJUDA_DAS_ABAS.agora },
    { valor: "criativos", rotulo: "Criativos", icone: <ImageIcon className={ICONE_DA_ABA} />, contador: (criativos || []).length, ajuda: AJUDA_DAS_ABAS.criativos },
    { valor: "contas", rotulo: "Contas deste cliente", icone: <Plug className={ICONE_DA_ABA} />, ajuda: AJUDA_DAS_ABAS.contas },
  ];

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        voltar={{ para: "/anuncios", rotulo: "Anúncios" }}
        titulo={
          <span className="flex min-w-0 items-center">
            <LogoDoCliente url={logoUrl} clienteId={clientId} nome={clientName} tamanho={28} className="mr-2.5" />
            <span className="min-w-0 truncate">{clientName}</span>
          </span>
        }
        descricao={`30 dias · ${plural(carteira.campanhas, "campanha", "campanhas")}`}
        ajuda={
          <>
            Investido: {EXPLICACOES.investido} Resultado: {EXPLICACOES.resultados} A seta compara os últimos 15 dias com os
            15 anteriores. O relatório já sai preenchido com estes números e os criativos. O relógio diz quando a Meta foi
            lida por último (passou de 24 h, fica âmbar). {DICA_DO_LINK_DO_ANUNCIO}
          </>
        }
        acoes={
          <>
            {frescor}
            {seletorDeCliente}
            {verContas}
            {podeAbrirMesaAds && (
              <Link
                to={`/mesa-ads?client=${encodeURIComponent(clientId)}`}
                className={botao.icone}
                aria-label="Abrir na Mesa Ads"
                title="Abrir na Mesa Ads"
              >
                <Megaphone className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            {atualizar}
            {/* O relatório nasce aqui, onde o dado está: os números já vêm preenchidos. */}
            <BotaoDeIcone
              icone={<FileText className="h-4 w-4" aria-hidden="true" />}
              rotulo="Gerar relatório"
              onClick={gerarRelatorio}
            />
          </>
        }
      />

      {detalheDasContas}

      <div className="-mx-1 flex min-w-0 items-center border-b border-border pb-1">
        <Etapas
          soIcone
          rotulo={`Partes de ${clientName}`}
          itens={abas}
          valor={aba}
          onEscolher={(v) => aoEscolherAba(v as AbaDoCliente)}
          className="min-w-0 flex-1"
        />
      </div>

      <AreaDeTrabalho key={`${clientId}:${aba}`} memoriaDaRolagem={`anuncios:cliente:${clientId}:${aba}`} rotuloDoPrincipal={`Anúncios de ${clientName}`}>
        <div className="min-w-0 space-y-6">
          {erro}

          <div className="min-w-0" role="group" aria-label="Resumo dos últimos 30 dias">
            <NumerosDoCliente dados={dados} grande />
            {apoio && <p className={juntar(texto.auxiliar, "mt-3 truncate")}>{apoio}</p>}
          </div>

          {aba === "campanhas" && (
            <div className="min-w-0 border-t border-border pt-4">
              {carregando && porCampanha.length === 0 ? (
                <Carregando rotulo="Carregando campanhas" linhas={3} />
              ) : porCampanha.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhuma campanha com movimento nos últimos 30 dias." />
              ) : (
                <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Campanhas">
                  {porCampanha.map(({ resumo, ficha }) => (
                    <LinhaDaCampanha
                      key={resumo.campaignId}
                      resumo={resumo}
                      ficha={ficha}
                      leads={leadsLigados.porCampanha.get(resumo.campaignId)}
                      temperaturas={temperaturas}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Na aba, sem o título próprio: o nome e o "?" já estão na aba. */}
          {aba === "agora" && (
            <div className="min-w-0 border-t border-border pt-4">
              {isValidElement<{ embutido?: boolean }>(agora) ? cloneElement(agora, { embutido: true }) : agora}
            </div>
          )}

          {/* As peças: "qual anúncio funcionou" é a pergunta seguinte. */}
          {aba === "criativos" && (
            <div className="min-w-0 border-t border-border pt-4">
              <GaleriaDeCriativos
                criativos={criativos || []}
                periodoDias={30}
                chave={clientId}
                embutido
                leadsPorAnuncio={leadsLigados.porAnuncio}
                temperaturas={temperaturas}
              />
            </div>
          )}

          {aba === "contas" && <div className="min-w-0 border-t border-border pt-4">{contasDoCliente}</div>}
        </div>
      </AreaDeTrabalho>
    </div>
  );
}

/* ─────────────────────────────── contas e conexão ─────────────────────────────── */

/** Conta devolvida pela Meta no login, para escolher quais entram. */
type ContaDaMeta = {
  numero: string;
  nome: string | null;
  status_rotulo?: string | null;
  utilizavel?: boolean;
  moeda?: string | null;
  empresa?: string | null;
  gasto_total?: number | null;
};

/**
 * Liga a conta e já pede a primeira leitura. Antes a tela dizia "chega em
 * alguns minutos" e a conta sem gasto nunca mostrava nada: parecia que ligar
 * não tinha funcionado. Conta que já é de outro cliente pede confirmação.
 */
async function ligarEPuxar(input: { clientId: string; actId: string; displayName: string }) {
  let resultado;
  try {
    resultado = await connectAdsAccount(input);
  } catch (erro) {
    if (!(erro instanceof ContaDeOutroCliente)) throw erro;
    if (!window.confirm(erro.message + "\n\nLigar mesmo assim?")) return null;
    resultado = await connectAdsAccount({ ...input, confirmarOutroCliente: true });
  }
  try {
    await collectAdsMetricsNow();
  } catch {
    // A leitura agendada roda de 10 em 10 minutos; ligar já valeu.
  }
  return resultado;
}

const MENSAGEM_DA_LIGACAO = {
  nova: "Conta ligada. A leitura da Meta já foi pedida; saldo, gasto e campanhas aparecem em instantes.",
  ja_ligada: "Esta conta já estava ligada a este cliente. Pedimos uma leitura nova.",
  reativada: "Conta religada a este cliente. A leitura da Meta já foi pedida.",
} as const;

/** Onde a lista de contas devolvida pela Meta descansa entre recarregamentos. */
const CONTAS_DA_META = "aceleriq-contas-da-meta";
/** Âncora da escolha das contas que a Meta devolveu (o login leva até ela). */
const ID_DA_ESCOLHA = "anuncios-escolher-contas";

const ehTexto = (v: unknown) => typeof v === "string";

const rolarAte = (id: string) => {
  window.setTimeout(() => {
    const alvo = document.getElementById(id);
    if (alvo && typeof alvo.scrollIntoView === "function") alvo.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
};

/**
 * A conexão com a Meta, uma por página: abrir o login (popup), ouvir o
 * resultado e guardar as contas que a Meta devolveu. Fica na página porque
 * o aviso do topo e a seção de contas do pé usam o mesmo login.
 */
function useConexaoComAMeta(onDone: () => void, aoTrazerContas?: () => void) {
  const [abrindo, setAbrindo] = useState(false);
  /**
   * As contas que a Meta devolveu na conexão. Fica em localStorage porque
   * perder a lista num recarregar obrigaria a refazer o login só para ver de
   * novo os mesmos nomes. São número e nome de conta, sem segredo: o acesso
   * mora no cofre do banco.
   */
  const [contasDaMeta, setContasDaMeta] = useState<ContaDaMeta[]>(() => {
    try {
      const cru = localStorage.getItem(CONTAS_DA_META);
      const lido = cru ? JSON.parse(cru) : null;
      return Array.isArray(lido) ? (lido as ContaDaMeta[]) : [];
    } catch {
      return [];
    }
  });

  /**
   * Conectar anúncios pelo login da Meta, e SÓ os anúncios. Porta separada
   * de propósito: reconectar o Instagram para colher este acesso arriscaria
   * perder as duas coisas em vez de nenhuma.
   */
  const conectarPelaMeta = async () => {
    setAbrindo(true);
    const janela = window.open(
      "about:blank",
      "aceleriq-meta-ads",
      "popup=yes,width=620,height=760,resizable=yes,scrollbars=yes",
    );
    if (!janela) {
      setAbrindo(false);
      toast.error("Autorize pop-ups para conectar com a Meta.");
      return;
    }
    try {
      const { authorization_url } = await startAdsOAuth();
      janela.location.replace(authorization_url);
      janela.focus();
    } catch (error: unknown) {
      janela.close();
      setAbrindo(false);
      toast.error((error as { message?: string })?.message || "Não foi possível abrir a Meta.");
    }
  };

  /* O popup avisa por mensagem quando termina: a tela reage sozinha. */
  useEffect(() => {
    const aoReceber = (evento: MessageEvent) => {
      if (evento.origin !== window.location.origin) return;
      const msg = evento.data as MetaOAuthPopupMessage | undefined;
      if (!msg || msg.type !== META_OAUTH_MESSAGE_TYPE) return;
      setAbrindo(false);
      if (msg.ok === false) {
        toast.error(msg.error);
        return;
      }
      if (msg.alvo !== "anuncios") return;
      setContasDaMeta(msg.contas);
      try {
        localStorage.setItem(CONTAS_DA_META, JSON.stringify(msg.contas));
      } catch {
        // Sem armazenamento a lista some ao recarregar, e só isso.
      }
      toast.success(
        msg.contas.length > 0
          ? `Conectado. Escolha abaixo quais das ${msg.contas.length} contas quer monitorar.`
          : "Conectado, mas a Meta não devolveu nenhuma conta de anúncio nesse acesso.",
      );
      if (msg.contas.length > 0) {
        // A escolha mora na aba de contas: abre a aba e leva até ela.
        if (aoTrazerContas) aoTrazerContas();
        rolarAte(ID_DA_ESCOLHA);
      }
      onDone();
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [onDone, aoTrazerContas]);

  const esconderContasDaMeta = () => {
    setContasDaMeta([]);
    try {
      localStorage.removeItem(CONTAS_DA_META);
    } catch { /* nada a fazer */ }
  };

  return { abrindo, conectarPelaMeta, contasDaMeta, esconderContasDaMeta };
}

type ConexaoComAMeta = ReturnType<typeof useConexaoComAMeta>;

/**
 * Configuração das contas, na aba "Contas e conexão" (16/10; antes no pé da
 * página, recolhida): a situação de cada conta e, no mesmo lugar, conectar,
 * reconectar, ligar pelo número, o token da agência e a gestão pelo agente.
 * Com um cliente aberto, só as contas dele. As contas que a Meta acabou de
 * devolver vêm primeiro (é um passo pendente, não configuração).
 */
function ContasEConexao({
  clienteId,
  nomes,
  podeConectar,
  onDone,
  meta,
}: {
  clienteId?: string;
  nomes: Map<string, string>;
  /** Só admin inicia o login de gestão (AtivarGestao). */
  podeConectar: boolean;
  onDone: () => void;
  meta: ConexaoComAMeta;
}) {
  const { data: conexao, isLoading, error, refetch } = useAdsConnection();
  const { data: clients } = useClients();
  // O token NUNCA vai para o navegador: fica só na memória da tela até ir para o cofre.
  const [token, setToken] = useState("");
  const [maisOpcoes, setMaisOpcoes] = useEstadoDaTela("anuncios:mais-opcoes", false, { validar: (v) => typeof v === "boolean" });
  const [ligandoNumero, setLigandoNumero] = useState<string | null>(null);
  const [donoEscolhido, setDonoEscolhido] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  // Rascunho de "ligar pelo número": não se perde ao sair e voltar.
  const [clientId, setClientId] = useEstadoDaTela(`anuncios:ligar:cliente:${clienteId || "todos"}`, clienteId || "", { validar: ehTexto });
  const [actId, setActId] = useEstadoDaTela("anuncios:ligar:numero", "", { validar: ehTexto });
  const [nome, setNome] = useEstadoDaTela("anuncios:ligar:nome", "", { validar: ehTexto });

  const comTrafego = (clients || []).filter((client: any) => hasService(client, "trafego"));

  const todas = (conexao?.contas || []).filter((c) => !clienteId || c.client_id === clienteId);
  const ativas = ordenarPorSituacao(todas.filter((c) => c.status === "active"));
  const desligadas = todas.length - ativas.length;
  const situacoes = ativas.map((c) => situacaoDaConta(c));
  const comProblema = situacoes.filter((s) => s.tom === "erro" || s.tom === "atencao").length;
  const precisaReconectar = situacoes.some((s) => s.reconectar);
  const ultimaLeitura = ativas.reduce<string | null>(
    (m, c) => (c.ultima_coleta && (!m || c.ultima_coleta > m) ? c.ultima_coleta : m),
    null,
  );

  const salvarToken = async () => {
    setSalvando(true);
    try {
      await saveMetaAdsToken(token, "Token da agência");
      setToken("");
      toast.success("Token guardado no cofre.");
      onDone();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível guardar.");
    } finally {
      setSalvando(false);
    }
  };

  /** Liga uma conta que veio da Meta ao cliente escolhido na linha dela. */
  const ligarDaLista = async (conta: ContaDaMeta) => {
    const cliente = donoEscolhido[conta.numero];
    if (!cliente) {
      toast.error("Escolha o cliente desta conta antes de ligar.");
      return;
    }
    setLigandoNumero(conta.numero);
    try {
      const r = await ligarEPuxar({
        clientId: cliente,
        actId: conta.numero,
        displayName: conta.nome || `Conta ${conta.numero}`,
      });
      if (!r) return;
      toast.success(MENSAGEM_DA_LIGACAO[r.situacao]);
      onDone();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível ligar a conta.");
    } finally {
      setLigandoNumero(null);
    }
  };

  const ligarConta = async () => {
    setSalvando(true);
    try {
      const r = await ligarEPuxar({ clientId, actId, displayName: nome });
      if (!r) return;
      setActId("");
      setNome("");
      toast.success(MENSAGEM_DA_LIGACAO[r.situacao]);
      onDone();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível ligar a conta.");
    } finally {
      setSalvando(false);
    }
  };

  const resumo = isLoading
    ? "Lendo as contas"
    : ativas.length === 0
      ? clienteId
        ? "Sem conta ligada"
        : "Nenhuma conta ligada"
      : [
          plural(ativas.length, "conta", "contas"),
          comProblema ? `${comProblema} com atenção` : "todas em dia",
          desligadas ? plural(desligadas, "desligada", "desligadas") : "",
          ultimaLeitura ? `lida ${haQuanto(ultimaLeitura)}` : "",
        ].filter(Boolean).join(" · ");

  const rotuloConectar = meta.abrindo ? "Abrindo a Meta..." : precisaReconectar ? "Reconectar com a Meta" : "Conectar com a Meta";

  return (
    <>
      {/* Depois do login: escolher o cliente de cada conta devolvida. Passo pendente, fica à vista. */}
      {meta.contasDaMeta.length > 0 && (
        <Secao
          id={ID_DA_ESCOLHA}
          recolher={false}
          titulo="Contas que a Meta devolveu"
          descricao="Escolha o cliente de cada uma"
          acao={
            <BotaoDeIcone
              icone={<EyeOff className="h-4 w-4" aria-hidden="true" />}
              rotulo="Esconder as contas que a Meta devolveu"
              onClick={meta.esconderContasDaMeta}
            />
          }
        >
          {/* Vinte contas não empurram o resto: no computador a lista rola por dentro. */}
          <ul className="-mx-2 min-w-0 divide-y divide-border/50 lg:max-h-[22rem] lg:overflow-y-auto lg:overscroll-contain" aria-label="Contas que a Meta devolveu">
            {meta.contasDaMeta.map((conta) => {
              const jaLigada = (conexao?.contas || []).find(
                (c) => c.external_id === conta.numero,
              );
              return (
                <li key={conta.numero} className="flex min-w-0 flex-wrap items-center px-1 py-1.5 [&>*]:m-1">
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <p className="truncate text-[13px] font-medium text-foreground">{conta.nome || `Conta ${conta.numero}`}</p>
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {[
                        `act_${conta.numero}`,
                        conta.empresa,
                        conta.status_rotulo,
                        conta.gasto_total != null ? `gasto total ${dinheiro(conta.gasto_total)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {conta.utilizavel === false && (
                      <p className="truncate text-[12px] leading-4 text-warning" title="Ligar não traz números enquanto a Meta não reativar a conta.">
                        Na Meta: {conta.status_rotulo || "inativa"}
                      </p>
                    )}
                  </div>

                  {jaLigada ? (
                    <span className="text-[12px] font-medium text-success">já monitorada</span>
                  ) : (
                    <>
                      <select
                        value={donoEscolhido[conta.numero] || ""}
                        onChange={(e) =>
                          setDonoEscolhido((antes) => ({
                            ...antes,
                            [conta.numero]: e.target.value,
                          }))}
                        aria-label={`Cliente da conta ${conta.nome || conta.numero}`}
                        className={juntar(campo, "flex-1 sm:w-48 sm:flex-none")}
                      >
                        <option value="">Cliente...</option>
                        {comTrafego.map((cliente: any) => (
                          <option key={cliente.id} value={cliente.id}>
                            {cliente.company_name || cliente.full_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={botao.secundario}
                        onClick={() => void ligarDaLista(conta)}
                        disabled={ligandoNumero === conta.numero || !donoEscolhido[conta.numero]}
                      >
                        {ligandoNumero === conta.numero ? "Ligando..." : "Monitorar"}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {comTrafego.length === 0 && (
            <p className="mt-2 flex min-w-0 items-center text-[12px] leading-4 text-warning">
              <span className="min-w-0 truncate">Nenhum cliente do painel está marcado com o serviço de tráfego</span>
              <AjudaRecolhida className="ml-1.5" rotulo="Como marcar o serviço de tráfego">
                Marque o serviço de tráfego no cadastro do cliente para ele aparecer aqui.
              </AjudaRecolhida>
            </p>
          )}
        </Secao>
      )}

      {/* Sem título nem "?": a aba já diz o nome e a explicação mora no "?" dela. */}
      <Secao
        divisoria={meta.contasDaMeta.length > 0}
        descricao={<span className={juntar("block truncate", comProblema ? "text-warning" : "")}>{resumo}</span>}
        acao={
          <>
            <button
              type="button"
              className={juntar(botao.icone, maisOpcoes && "bg-muted text-foreground")}
              onClick={() => setMaisOpcoes((v) => !v)}
              aria-expanded={maisOpcoes}
              aria-label="Mais opções"
              title="Mais opções: ligar pelo número e token da agência"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            <BotaoDeIcone
              icone={<Link2 className="h-4 w-4" aria-hidden="true" />}
              rotulo={rotuloConectar}
              onClick={meta.conectarPelaMeta}
              disabled={meta.abrindo}
            />
          </>
        }
      >
        {error && (
          <EstadoDeErro
            className="mb-3"
            titulo="Não consegui ler a situação das contas."
            descricao={(error as { message?: string })?.message || "Erro desconhecido."}
            acao={
              <button type="button" onClick={() => refetch()} className={botao.secundario}>
                Tentar de novo
              </button>
            }
          />
        )}

        {isLoading && !conexao && <Carregando rotulo="Lendo as contas" linhas={2} />}

        {!isLoading && !error && ativas.length === 0 && (
          <EstadoVazio
            compacto
            titulo={clienteId ? "Sem conta ligada." : "Nenhuma conta ligada."}
            descricao="Conecte com a Meta ou ligue pelo número em Mais opções."
          />
        )}

        {/* A situação de cada conta, problemas primeiro. No computador rola por dentro; no celular a página rola. */}
        {ativas.length > 0 && (
          <ul className="-mx-2 min-w-0 divide-y divide-border lg:max-h-64 lg:overflow-y-auto lg:overscroll-contain" aria-label="Situação das contas">
            {ativas.map((conta) => {
              const sit = situacaoDaConta(conta);
              const tom = CLASSE_DO_TOM_DA_CONTA[sit.tom];
              const numeros = [
                conta.external_id ? `act_${conta.external_id}` : null,
                conta.saldo_disponivel != null ? `saldo ${dinheiro(Number(conta.saldo_disponivel))}` : null,
                conta.gasto_total != null ? `gasto total ${dinheiro(Number(conta.gasto_total))}` : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={conta.id} className="flex min-w-0 items-start px-2 py-2.5">
                  <span className={juntar("mr-2.5 mt-1.5 h-2 w-2 shrink-0 rounded-full", tom.ponto)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {conta.display_name}
                      {!clienteId && nomes.get(conta.client_id) && (
                        <span className="font-normal text-muted-foreground"> · {nomes.get(conta.client_id)}</span>
                      )}
                    </p>
                    <p className={juntar(texto.auxiliar, "truncate tabular-nums")}>{numeros}</p>
                    {conta.erro && (
                      <p className="truncate text-[12px] leading-4 text-destructive" title={conta.erro}>
                        A Meta recusou a leitura: {conta.erro}
                      </p>
                    )}
                    {sit.acao && <p className={juntar(texto.auxiliar, "truncate")} title={sit.acao}>{sit.acao}</p>}
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className={juntar("text-[12px] font-medium leading-4", tom.texto)}>{sit.rotulo}</p>
                    <p className={texto.auxiliar}>{conta.ultima_coleta ? `lida ${haQuanto(conta.ultima_coleta)}` : "sem leitura"}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Os caminhos alternativos, recolhidos: ligar pelo número e o token da agência. */}
        {maisOpcoes && (
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-x-8 gap-y-6 border-t border-border pt-4 lg:grid-cols-2">
            <div className="min-w-0">
              <GrupoDeCampos titulo="Ligar conta pelo número">
                <CampoDeFormulario rotulo="Cliente">
                  <select value={clientId} onChange={(event) => setClientId(event.target.value)} className={campo}>
                    <option value="">Cliente...</option>
                    {comTrafego.map((client: any) => (
                      <option key={client.id} value={client.id}>
                        {client.company_name || client.full_name}
                      </option>
                    ))}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Número da conta" ajuda='Está no Gerenciador de Anúncios; com ou sem o "act_".'>
                  <input value={actId} onChange={(event) => setActId(event.target.value)} placeholder="act_123456789" className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Nome da conta" largo>
                  <input value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Como chamar esta conta" className={campo} />
                </CampoDeFormulario>
              </GrupoDeCampos>
              <div className="mt-3 flex justify-end">
                <button type="button" className={botao.primario} onClick={ligarConta} disabled={salvando || !clientId || !actId.trim()}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Ligar conta ao cliente
                </button>
              </div>
            </div>

            <div className="min-w-0">
              <GrupoDeCampos titulo="Ou cole um token" colunas={1}>
                <CampoDeFormulario
                  rotulo="Token do Business Manager"
                  ajuda="Token do Business Manager da agência. Vai para o cofre do banco e nunca mais aparece. Salvar outro substitui."
                  apoio={
                    conexao?.agencia
                      ? `Guardado em ${new Date(conexao.agencia.saved_at).toLocaleDateString("pt-BR")}`
                      : "Nenhum guardado ainda"
                  }
                >
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Colar o token aqui"
                    autoComplete="off"
                    className={campo}
                  />
                </CampoDeFormulario>
              </GrupoDeCampos>
              <div className="mt-3 flex min-w-0 items-center justify-end">
                {(conexao?.perfis || []).length > 0 && (
                  <p className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1 truncate")}>
                    Perfis:{" "}
                    {(conexao?.perfis || [])
                      .map((p) => `${p.label} (${plural(p.contas, "conta", "contas")})`)
                      .join(" · ")}
                  </p>
                )}
                <button type="button" className={botao.secundario} onClick={salvarToken} disabled={salvando || token.trim().length < 20}>
                  Guardar no cofre
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 26/09: gestão de campanhas pelo agente da Mesa Ads (token da carteira), no pé da mesma seção. */}
        <div className="mt-4 border-t border-border">
          <AtivarGestao clientId={null} podeConectar={podeConectar} compacto className="!rounded-none !border-0 !bg-transparent" />
        </div>
      </Secao>
    </>
  );
}

/* ─────────────────────────────── a página ─────────────────────────────── */

export default function AdminAds() {
  const { profile } = useAuth();
  const papel = profile?.role || "";
  const isStaff = ["admin", "manager", "design", "traffic"].includes(papel);
  const queryClient = useQueryClient();
  const { data: identidades } = useIdentidadesDosClientes();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useEstadoDaTela("anuncios:busca", "", { validar: ehTexto });
  const [coletando, setColetando] = useState(false);
  // "Ver contas": o detalhe abre e fecha no mesmo ícone (não é guardado: é uma olhada).
  const [contasAbertas, setContasAbertas] = useState(false);
  // As abas (16/10): uma parte por vez, lembrada ao sair e voltar.
  const [aba, setAba] = useEstadoDaTela<AbaDaLista>("anuncios:aba", "clientes", {
    validar: (v) => ABAS_DA_LISTA.indexOf(v as AbaDaLista) >= 0,
  });
  const [abaDoCliente, setAbaDoCliente] = useEstadoDaTela<AbaDoCliente>("anuncios:aba-do-cliente", "campanhas", {
    validar: (v) => ABAS_DO_CLIENTE.indexOf(v as AbaDoCliente) >= 0,
  });

  const clienteAberto = params.get("cliente") || "";
  const { data: rows, isLoading, error: erroDosDias, refetch: releDias } = useAdsDaily(undefined, 30);
  const { data: campaigns } = useAdsCampaigns();
  const { data: clients } = useClients();
  const { data: conexao } = useAdsConnection();
  // Leads no CRM por anúncio (19/10): só admin e manager leem o CRM (RLS).
  const { data: leadsDoCrm } = useLeadsDosAnuncios(papel === "admin" || papel === "manager");
  const contasDoCliente = (clientId: string) =>
    (conexao?.contas || []).filter((c) => c.client_id === clientId && c.status === "active");

  const aoMudarConexao = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["ads-connection"] });
  }, [queryClient]);
  // A Meta devolveu contas: a escolha do cliente de cada uma mora na aba de contas.
  const levarAContas = useCallback(() => {
    setAba("contas");
    setAbaDoCliente("contas");
  }, [setAba, setAbaDoCliente]);
  const meta = useConexaoComAMeta(aoMudarConexao, levarAContas);

  const nomes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const client of clients || []) {
      mapa.set(client.id, (client as any).company_name || (client as any).full_name || "Cliente");
    }
    return mapa;
  }, [clients]);

  const porCliente = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of rows || []) {
      const lista = mapa.get(row.client_id) || [];
      lista.push(row);
      mapa.set(row.client_id, lista);
    }
    // Conta ligada sem gasto nos 30 dias também é cliente de anúncios: antes
    // ela sumia e parecia que ligar não tinha funcionado.
    for (const conta of conexao?.contas || []) {
      if (conta.status === "active" && !mapa.has(conta.client_id)) mapa.set(conta.client_id, []);
    }
    return [...mapa.entries()].sort(
      (a, b) => summarizeAccount(b[1]).investido - summarizeAccount(a[1]).investido,
    );
  }, [rows, conexao]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return porCliente;
    return porCliente.filter(([clientId]) =>
      (nomes.get(clientId) || "").toLowerCase().includes(termo),
    );
  }, [porCliente, busca, nomes]);

  const abrirCliente = (id: string) => {
    const proximo = new URLSearchParams(params);
    proximo.set("cliente", id);
    setParams(proximo, { replace: true });
  };

  const atualizarAgora = async () => {
    setColetando(true);
    try {
      const resultado = await collectAdsMetricsNow();
      const lidas = resultado.campanhas.parsed + resultado.criativos.parsed;
      const pedidas = resultado.campanhas.dispatched + resultado.criativos.dispatched;
      toast.success(
        lidas > 0
          ? `Lidas ${lidas} resposta(s) da Meta, incluindo criativos. Os números já estão na tela.`
          : `Leitura pedida (${pedidas} consulta[s]). Os números chegam em alguns minutos.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ads-daily"] }),
        queryClient.invalidateQueries({ queryKey: ["ads-campaigns"] }),
        queryClient.invalidateQueries({ queryKey: ["ads-creatives"] }),
        queryClient.invalidateQueries({ queryKey: ["ads-connection"] }),
      ]);
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível atualizar agora.");
    } finally {
      setColetando(false);
    }
  };

  if (!isStaff) {
    return (
      <div className="min-w-0 space-y-4">
        <CabecalhoDePagina titulo="Anúncios" descricao="Área da equipe" />
      </div>
    );
  }

  const semConta = (conexao?.contas || []).length === 0;

  // Um "Atualizar" só, em ícone, na linha do título.
  const botaoAtualizar = (
    <BotaoDeIcone
      icone={<RefreshCw className={juntar("h-4 w-4", coletando ? "animate-spin" : "")} aria-hidden="true" />}
      rotulo="Atualizar agora"
      dica={coletando ? "Pedindo leitura..." : "Atualizar agora"}
      onClick={atualizarAgora}
      disabled={coletando}
    />
  );

  const erroNaLeitura = erroDosDias ? (
    <EstadoDeErro
      titulo="Não consegui ler os números dos anúncios."
      descricao={`${(erroDosDias as { message?: string })?.message || "Erro desconhecido"}. Nada foi apagado.`}
      acao={
        <button type="button" onClick={() => releDias()} className={botao.secundario}>
          Tentar de novo
        </button>
      }
    />
  ) : null;

  const secaoDasContas = (clienteId?: string) => (
    <ContasEConexao
      clienteId={clienteId}
      nomes={nomes}
      podeConectar={papel === "admin"}
      onDone={aoMudarConexao}
      meta={meta}
    />
  );

  /** "Ver contas" em ícone e o detalhe que ele abre, das contas que a tela mostra. */
  const verContasDe = (contas: Conta[], comNomes?: Map<string, string>) => ({
    botao: <BotaoVerContas contas={contas} aberto={contasAbertas} aoAlternar={() => setContasAbertas((v) => !v)} />,
    detalhe: contasAbertas ? (
      <DetalheDasContas contas={contas} nomes={comNomes} abrindo={meta.abrindo} aoReconectar={meta.conectarPelaMeta} />
    ) : null,
  });

  if (clienteAberto) {
    const opcoesDeCliente = porCliente.map(([id]) => ({ valor: id, rotulo: nomes.get(id) || "Cliente" }));
    if (!opcoesDeCliente.some((o) => o.valor === clienteAberto)) {
      opcoesDeCliente.unshift({ valor: clienteAberto, rotulo: nomes.get(clienteAberto) || "Cliente" });
    }
    const contasDele = verContasDe(contasDoCliente(clienteAberto));
    return (
      <ClientAdsDetail
        clientId={clienteAberto}
        clientName={nomes.get(clienteAberto) || "Cliente"}
        logoUrl={identidades?.get(clienteAberto)?.profile_picture_url}
        rows={(rows || []).filter((row) => row.client_id === clienteAberto)}
        campaigns={(campaigns || []).filter((row) => row.client_id === clienteAberto)}
        contas={contasDoCliente(clienteAberto)}
        carregando={isLoading}
        verContas={contasDele.botao}
        detalheDasContas={contasDele.detalhe}
        // Dentro do cliente, o AGORA dele: entrar no detalhe não faz as campanhas ativas sumirem.
        agora={<CampanhasAtivas clientId={clienteAberto} />}
        contasDoCliente={secaoDasContas(clienteAberto)}
        seletorDeCliente={
          opcoesDeCliente.length > 1 ? (
            // No celular a linha de ações tem de caber ao lado do nome: o seletor aparece de 1024 px para cima.
            <div className="hidden min-w-0 max-w-[220px] lg:block">
              <SeletorCompacto rotulo="Cliente" modo="lista" opcoes={opcoesDeCliente} valor={clienteAberto} onEscolher={abrirCliente} />
            </div>
          ) : null
        }
        atualizar={botaoAtualizar}
        erro={erroNaLeitura}
        podeAbrirMesaAds={["admin", "manager", "design"].includes(papel)}
        aba={abaDoCliente}
        aoEscolherAba={setAbaDoCliente}
        leadsDoCrm={leadsDoCrm}
        frescor={<FrescorDaMeta ultima={ultimaLeituraDasContas(contasDoCliente(clienteAberto))} />}
      />
    );
  }

  // A leitura mais nova das contas ativas: vira o relógio discreto ao lado de "Atualizar".
  const ultimaLeitura = ultimaLeituraDasContas(conexao?.contas || []);
  const investidoTotal = porCliente.reduce((t, [, lista]) => t + summarizeAccount(lista).investido, 0);
  const descricao = [
    porCliente.length ? plural(porCliente.length, "cliente", "clientes") : "",
    investidoTotal > 0 ? `${dinheiro(investidoTotal)} em 30 dias` : "30 dias",
  ].filter(Boolean).join(" · ");

  const todas = verContasDe(conexao?.contas || [], nomes);

  // Clientes | No ar agora | Contas e conexão: só o ícone; a aberta mostra o nome e o "?".
  const abas = [
    { valor: "clientes", rotulo: "Clientes", icone: <Users className={ICONE_DA_ABA} />, contador: porCliente.length, ajuda: AJUDA_DAS_ABAS.clientes },
    { valor: "agora", rotulo: "No ar agora", icone: <Radio className={ICONE_DA_ABA} />, ajuda: AJUDA_DAS_ABAS.agora },
    { valor: "contas", rotulo: "Contas e conexão", icone: <Plug className={ICONE_DA_ABA} />, ajuda: AJUDA_DAS_ABAS.contas },
  ];

  // Sem conta ligada, o primeiro passo aparece no lugar dos números.
  const primeiroPasso = (
    <EstadoVazio
      titulo="Nenhuma conta ligada ainda."
      descricao="Conecte com a Meta, escolha as contas e o cliente de cada uma."
      acao={
        <button type="button" className={botao.primario} onClick={meta.conectarPelaMeta} disabled={meta.abrindo}>
          <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {meta.abrindo ? "Abrindo a Meta..." : "Conectar com a Meta"}
        </button>
      }
    />
  );
  const primeiraLeitura = <EstadoVazio compacto titulo="Primeira leitura a caminho." descricao="O ícone de atualizar apressa." />;

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Anúncios"
        descricao={descricao.charAt(0).toUpperCase() + descricao.slice(1)}
        ajuda={`Meta Ads lido direto da conta, de hora em hora, com os números dos últimos 30 dias. As abas ao lado do título trocam entre os clientes, o que está no ar e as contas. O relógio diz quando a Meta foi lida por último (passou de 24 h, fica âmbar). ${DICA_DO_LINK_DO_ANUNCIO}`}
        aoLado={
          <Etapas
            soIcone
            rotulo="Partes dos anúncios"
            itens={abas}
            valor={aba}
            onEscolher={(v) => setAba(v as AbaDaLista)}
            className="min-w-0 flex-1"
          />
        }
        acoes={
          <>
            <FrescorDaMeta ultima={ultimaLeitura} />
            {todas.botao}
            {botaoAtualizar}
          </>
        }
      />

      {todas.detalhe}

      <AreaDeTrabalho key={`lista:${aba}`} memoriaDaRolagem={`anuncios:lista:${aba}`} rotuloDoPrincipal="Anúncios por cliente">
        <div className="min-w-0 space-y-6">
          {erroNaLeitura}

          {aba === "clientes" && (
            semConta ? (
              primeiroPasso
            ) : (
              <div className="min-w-0">
                {porCliente.length > 6 && (
                  <div className="mb-2 flex min-w-0 items-center justify-end">
                    {busca.trim() && (
                      <span className={juntar(texto.auxiliar, "mr-3 min-w-0 truncate tabular-nums")}>{`${filtrados.length} de ${porCliente.length}`}</span>
                    )}
                    <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar cliente" rotulo="Buscar cliente" className="w-40 sm:w-64" />
                  </div>
                )}
                {isLoading && !rows ? (
                  <Carregando rotulo="Carregando campanhas" linhas={3} />
                ) : porCliente.length === 0 ? (
                  primeiraLeitura
                ) : filtrados.length === 0 ? (
                  <EstadoVazio
                    compacto
                    titulo="Nenhum cliente com esse nome."
                    acao={
                      <button type="button" onClick={() => setBusca("")} className={botao.discreto}>
                        Limpar busca
                      </button>
                    }
                  />
                ) : (
                  <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Clientes com anúncios">
                    {filtrados.map(([clientId, linhas]) => {
                      const dados = numerosDoCliente(linhas, contasDoCliente(clientId));
                      const problemas = contasDoCliente(clientId).filter(temProblema).length;
                      return (
                        <li key={clientId} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => abrirCliente(clientId)}
                            className={juntar(lista.linha, "group w-full flex-wrap py-3 text-left md:flex-nowrap", foco)}
                          >
                            <span className="flex min-w-0 flex-1 basis-full items-center md:mr-4 md:basis-0">
                              {/* Mesma marca da grade de Métricas: reconhecer o cliente não pode depender da tela. */}
                              <LogoDoCliente
                                url={identidades?.get(clientId)?.profile_picture_url}
                                clienteId={clientId}
                                nome={nomes.get(clientId)}
                                tamanho={36}
                                className="mr-2.5"
                              />
                              <span className="block min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold text-foreground">{nomes.get(clientId) || "Cliente"}</span>
                                <span className={juntar(texto.auxiliar, "block truncate")}>
                                  {linhas.length === 0
                                    ? "Conta ligada · sem gasto nos últimos 30 dias"
                                    : plural(dados.campanhas, "campanha", "campanhas")}
                                  {problemas > 0 && (
                                    <span className="text-warning"> · {problemas === 1 ? "conta pede atenção" : `${problemas} contas pedem atenção`}</span>
                                  )}
                                </span>
                              </span>
                              <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground md:hidden" aria-hidden="true" />
                            </span>
                            <span className="mt-2.5 block min-w-0 basis-full pl-[46px] md:mt-0 md:w-3/5 md:shrink-0 md:basis-auto md:pl-0">
                              <NumerosDoCliente dados={dados} />
                            </span>
                            <ChevronRight className="ml-3 hidden h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary md:block" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )
          )}

          {/* O que está no ar AGORA, cada campanha dizendo de qual cliente é. */}
          {aba === "agora" && (
            semConta ? (
              primeiroPasso
            ) : porCliente.length === 0 ? (
              primeiraLeitura
            ) : (
              <CampanhasAtivas nomesDeClientes={nomes} aoAbrirCliente={abrirCliente} embutido />
            )
          )}

          {/* A configuração das contas, na aba dela: não disputa espaço com os números. */}
          {aba === "contas" && secaoDasContas()}
        </div>
      </AreaDeTrabalho>
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  Megaphone,
  RefreshCw,
  Search,
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
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import AtivarGestao from "@/components/mesa-ads/AtivarGestao";
import { useClients } from "@/hooks/useSupabaseData";
import { hasService } from "@/lib/clientFlags";
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
} from "@/lib/adsLanguage";
import {
  CLASSE_DO_TOM_DA_CONTA,
  custoDoResultado,
  haQuanto,
  ordenarPorSituacao,
  resultadosPorObjetivo,
  rotuloDoResultado,
  situacaoDaConta,
  type ResultadoDoObjetivo,
} from "@/lib/adsResumo";

/**
 * A área de anúncios (pedido do dono em 26/09: "desorganizada, confusa,
 * poluída; mais fácil de usar, simplificada, clara, alinhada").
 *
 * Três blocos, nesta ordem:
 * 1. Contas de anúncio: situação de cada conta (lendo, saldo, erro, última
 *    leitura) e TODAS as ações de conectar, reconectar e ligar num lugar só.
 * 2. Desempenho por cliente: uma linha por cliente, com o resultado certo
 *    para o objetivo de cada campanha (conversa não soma com venda).
 * 3. No ar agora: o que está rodando e o que fazer a respeito.
 *
 * Ao abrir um cliente, a mesma campanha aparece nas duas leituras: como o
 * cliente lê no relatório e com os números que a equipe usa para decidir.
 */

type Conta = AdsConnectionStatus["contas"][number];

const TOM: Record<string, string> = {
  ativa: "bg-success/10 text-success",
  pausada: "bg-muted text-muted-foreground",
  encerrada: "bg-muted text-muted-foreground",
  atencao: "bg-destructive/10 text-destructive",
};

function StatusChip({ campaign }: { campaign?: AdsCampaign }) {
  const { label, tone } = statusLabel(campaign?.status, campaign?.effective_status);
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TOM[tone]}`}>
      {label}
    </span>
  );
}

const ROTULO = "text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

/** Um número com o rótulo em cima; a explicação fica no tooltip, e não em mais texto na tela. */
function Numero({
  rotulo,
  valor,
  detalhe,
  explicacao,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string | null;
  explicacao?: string;
}) {
  return (
    <div className="min-w-0" title={explicacao}>
      <p className={ROTULO}>{rotulo}</p>
      <p className="mt-0.5 truncate font-mono text-[15px] font-semibold text-foreground">{valor}</p>
      {detalhe && <p className="truncate text-[10.5px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

/** O resultado principal (o objetivo com mais dinheiro) e, em uma linha, os outros. */
function resumoDosResultados(lista: ResultadoDoObjetivo[]) {
  const principal = lista.find((r) => r.kind !== "alcance" && r.resultados > 0) || null;
  const outros = lista.filter((r) => r !== principal && r.kind !== "alcance" && r.resultados > 0);
  return {
    principal,
    valor: principal ? rotuloDoResultado(principal) : "sem resultado medido",
    custo: principal ? custoDoResultado(principal) : null,
    outros: outros.map((r) => rotuloDoResultado(r)).join(" · "),
  };
}

const saldoDas = (contas: Conta[]): number | null => {
  const comSaldo = contas.filter((c) => c.status === "active" && c.saldo_disponivel != null);
  return comSaldo.length ? comSaldo.reduce((t, c) => t + Number(c.saldo_disponivel || 0), 0) : null;
};

/* ─────────────────────────────── dossiê do cliente ─────────────────────────────── */

function ClientAdsDetail({
  clientId,
  clientName,
  logoUrl,
  rows,
  campaigns,
  contas,
  carregando,
  agora,
  onBack,
}: {
  clientId: string;
  clientName: string;
  logoUrl?: string | null;
  rows: AdsDaily[];
  campaigns: AdsCampaign[];
  contas: Conta[];
  carregando: boolean;
  /** O que está no ar agora deste cliente (CampanhasAtivas), montado pela página. */
  agora: ReactNode;
  onBack: () => void;
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
  const resultados = useMemo(() => resumoDosResultados(resultadosPorObjetivo(rows)), [rows]);
  const saldo = saldoDas(contas);
  const { data: criativos } = useAdsCreatives(clientId, 30);

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

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Todos os clientes
      </button>

      <section className="min-w-0 rounded-2xl border border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <LogoDoCliente url={logoUrl} nome={clientName} tamanho={40} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{clientName}</h2>
            <p className="text-[11px] text-muted-foreground">
              Últimos 30 dias · {carteira.campanhas} {carteira.campanhas === 1 ? "campanha" : "campanhas"}
            </p>
          </div>
          {/* O relatório nasce aqui, onde o dado está: os números já vêm preenchidos. */}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={gerarRelatorio}>
            <FileText className="h-3.5 w-3.5" /> Gerar relatório
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Numero rotulo="Investido" valor={dinheiro(carteira.investido)} explicacao={EXPLICACOES.investido} />
          <Numero
            rotulo="Resultado"
            valor={resultados.valor}
            detalhe={resultados.custo}
            explicacao={EXPLICACOES.resultados}
          />
          <Numero rotulo="Pessoas alcançadas" valor={numero(carteira.alcance)} explicacao={EXPLICACOES.alcance} />
          <Numero
            rotulo="Saldo na conta"
            valor={saldo != null ? dinheiro(saldo) : "não lido"}
            detalhe={saldo == null ? "conta pós-paga ou sem leitura" : null}
          />
        </div>
        {resultados.outros && (
          <p className="mt-3 text-[11px] text-muted-foreground">Também: {resultados.outros}</p>
        )}
      </section>

      {agora}

      <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Campanhas nos últimos 30 dias</h3>
        </div>
        {carregando ? (
          <p className="px-4 py-6 text-[12.5px] text-muted-foreground">Carregando campanhas...</p>
        ) : porCampanha.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
            Nenhuma campanha com movimento nos últimos 30 dias nesta conta.
          </p>
        ) : (
          <ul className="max-h-[40rem] min-w-0 divide-y divide-border overflow-y-auto overscroll-contain">
            {porCampanha.map(({ resumo, ficha }) => {
              const alerta = teamAlert(resumo);
              return (
                <li key={resumo.campaignId} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{resumo.name}</p>
                    <StatusChip campaign={ficha} />
                    <span className="shrink-0 font-mono text-[12px] text-foreground">{dinheiro(resumo.investido)}</span>
                  </div>
                  <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                    {/* A leitura do cliente, exatamente como sai no relatório dele. */}
                    <div className="min-w-0 rounded-lg bg-secondary/50 px-3 py-2">
                      <p className={ROTULO}>Como o cliente lê</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-foreground">
                        {clientCampaignSentence(resumo)}
                      </p>
                    </div>
                    {/* E os números de operar. */}
                    <div className="min-w-0 rounded-lg border border-border px-3 py-2">
                      <p className={ROTULO}>Para a equipe</p>
                      <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
                        {teamCampaignLine(resumo)}
                      </p>
                      {ficha?.daily_budget != null && (
                        <p className="text-[10.5px] text-muted-foreground">
                          Verba diária: {dinheiro(Number(ficha.daily_budget))}
                        </p>
                      )}
                    </div>
                  </div>
                  {alerta && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {alerta}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* As peças: "qual anúncio funcionou" é a pergunta seguinte. */}
      <GaleriaDeCriativos criativos={criativos || []} periodoDias={30} />
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

const CAMPO =
  "h-9 min-w-0 rounded-lg border border-border bg-secondary px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none";

/**
 * As contas de anúncio e a conexão com a Meta, num cartão só: a situação de
 * cada conta em cima e, no mesmo lugar, conectar, reconectar, escolher as
 * contas que a Meta devolveu e ligar pelo número. Com um cliente aberto,
 * mostra só as contas dele.
 */
function ContasEConexao({
  clienteId,
  nomes,
  onDone,
}: {
  clienteId?: string;
  nomes: Map<string, string>;
  onDone: () => void;
}) {
  const { data: conexao, isLoading, error } = useAdsConnection();
  const { data: clients } = useClients();
  const [token, setToken] = useState("");
  const [maisOpcoes, setMaisOpcoes] = useState(false);
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
  const [ligandoNumero, setLigandoNumero] = useState<string | null>(null);
  const [donoEscolhido, setDonoEscolhido] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [clientId, setClientId] = useState(clienteId || "");
  const [actId, setActId] = useState("");
  const [nome, setNome] = useState("");

  const comTrafego = (clients || []).filter((client: any) => hasService(client, "trafego"));

  const todas = (conexao?.contas || []).filter((c) => !clienteId || c.client_id === clienteId);
  const ativas = ordenarPorSituacao(todas.filter((c) => c.status === "active"));
  const desligadas = todas.length - ativas.length;
  const situacoes = ativas.map((c) => situacaoDaConta(c));
  const emDia = situacoes.filter((s) => s.tom === "ok").length;
  const comProblema = situacoes.filter((s) => s.tom === "erro" || s.tom === "atencao").length;
  const precisaReconectar = situacoes.some((s) => s.reconectar);
  const ultimaLeitura = ativas.reduce<string | null>(
    (m, c) => (c.ultima_coleta && (!m || c.ultima_coleta > m) ? c.ultima_coleta : m),
    null,
  );

  /**
   * Conectar anúncios pelo login da Meta, e SÓ os anúncios. Porta separada
   * de propósito: reconectar o Instagram para colher este acesso arriscaria
   * perder as duas coisas em vez de nenhuma.
   */
  const conectarPelaMeta = async () => {
    setSalvando(true);
    const janela = window.open(
      "about:blank",
      "aceleriq-meta-ads",
      "popup=yes,width=620,height=760,resizable=yes,scrollbars=yes",
    );
    if (!janela) {
      setSalvando(false);
      toast.error("Autorize pop-ups para conectar com a Meta.");
      return;
    }
    try {
      const { authorization_url } = await startAdsOAuth();
      janela.location.replace(authorization_url);
      janela.focus();
    } catch (error: unknown) {
      janela.close();
      setSalvando(false);
      toast.error((error as { message?: string })?.message || "Não foi possível abrir a Meta.");
    }
  };

  /* O popup avisa por mensagem quando termina: a tela reage sozinha. */
  useEffect(() => {
    const aoReceber = (evento: MessageEvent) => {
      if (evento.origin !== window.location.origin) return;
      const msg = evento.data as MetaOAuthPopupMessage | undefined;
      if (!msg || msg.type !== META_OAUTH_MESSAGE_TYPE) return;
      setSalvando(false);
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
      onDone();
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [onDone]);

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
    ? "lendo a situação das contas..."
    : ativas.length === 0
      ? clienteId
        ? "Este cliente não tem conta de anúncio ligada."
        : "Nenhuma conta ligada ainda."
      : [
          `${ativas.length} ${ativas.length === 1 ? "conta" : "contas"}`,
          `${emDia} lendo normalmente`,
          comProblema ? `${comProblema} ${comProblema === 1 ? "precisa" : "precisam"} de atenção` : "",
          desligadas ? `${desligadas} ${desligadas === 1 ? "desligada" : "desligadas"}` : "",
          ultimaLeitura ? `última leitura ${haQuanto(ultimaLeitura)}` : "",
        ].filter(Boolean).join(" · ");

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Contas de anúncio</h2>
          <p className={`text-[11.5px] ${comProblema ? "text-foreground" : "text-muted-foreground"}`}>{resumo}</p>
        </div>
        <Button
          size="sm"
          variant={precisaReconectar || ativas.length === 0 ? "default" : "outline"}
          className="gap-1.5"
          onClick={conectarPelaMeta}
          disabled={salvando}
        >
          <Link2 className="h-3.5 w-3.5" />
          {salvando ? "Abrindo a Meta..." : precisaReconectar ? "Reconectar com a Meta" : "Conectar com a Meta"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground"
          onClick={() => setMaisOpcoes((v) => !v)}
          aria-expanded={maisOpcoes}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${maisOpcoes ? "" : "-rotate-90"}`} />
          Mais opções
        </Button>
      </div>

      {error && (
        <p className="border-t border-border px-4 py-2 text-[11.5px] text-destructive">
          Não consegui ler a situação das contas: {(error as { message?: string })?.message || "erro desconhecido"}.
        </p>
      )}

      {!isLoading && !error && ativas.length === 0 && !clienteId && (
        <p className="border-t border-border px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
          Conecte com a Meta, escolha as contas e o cliente de cada uma. Daí em diante o painel lê
          campanhas, saldo e criativos sozinho, de hora em hora.
        </p>
      )}

      {/* A situação de cada conta, problemas primeiro. Rolagem própria. */}
      {ativas.length > 0 && (
        <ul className="max-h-64 min-w-0 divide-y divide-border overflow-y-auto overscroll-contain border-t border-border">
          {ativas.map((conta) => {
            const sit = situacaoDaConta(conta);
            const tom = CLASSE_DO_TOM_DA_CONTA[sit.tom];
            const numeros = [
              conta.external_id ? `act_${conta.external_id}` : null,
              conta.saldo_disponivel != null ? `saldo ${dinheiro(Number(conta.saldo_disponivel))}` : null,
              conta.gasto_total != null ? `gasto total ${dinheiro(Number(conta.gasto_total))}` : null,
            ].filter(Boolean).join(" · ");
            return (
              <li key={conta.id} className="flex min-w-0 items-start gap-2.5 px-4 py-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tom.ponto}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-foreground">
                    {conta.display_name}
                    {!clienteId && nomes.get(conta.client_id) && (
                      <span className="font-normal text-muted-foreground"> · {nomes.get(conta.client_id)}</span>
                    )}
                  </p>
                  <p className="truncate text-[10.5px] text-muted-foreground">{numeros}</p>
                  {conta.erro && (
                    <p className="text-[10.5px] text-destructive [overflow-wrap:anywhere]">A Meta recusou a leitura: {conta.erro}</p>
                  )}
                  {sit.acao && <p className="text-[10.5px] text-muted-foreground">{sit.acao}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[11px] font-medium ${tom.texto}`}>{sit.rotulo}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {conta.ultima_coleta ? `lida ${haQuanto(conta.ultima_coleta)}` : "sem leitura"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Depois do login: escolher o cliente de cada conta devolvida. */}
      {contasDaMeta.length > 0 && (
        <div className="border-t border-border bg-primary/[0.03] px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold text-foreground">Contas que a Meta devolveu</h3>
            <button
              type="button"
              onClick={() => {
                setContasDaMeta([]);
                try {
                  localStorage.removeItem(CONTAS_DA_META);
                } catch { /* nada a fazer */ }
              }}
              className="text-[10.5px] text-muted-foreground underline hover:text-foreground"
            >
              esconder esta lista
            </button>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Escolha o cliente de cada conta que quer monitorar. O que não for ligado aqui não é lido.
          </p>

          {/* Rolagem própria: vinte contas empurrariam o resto da tela para fora. */}
          <div className="mt-2 max-h-[22rem] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
            {contasDaMeta.map((conta) => {
              const jaLigada = (conexao?.contas || []).find(
                (c) => c.external_id === conta.numero,
              );
              return (
                <div
                  key={conta.numero}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {conta.nome || `Conta ${conta.numero}`}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
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
                      <p className="text-[10px] text-warning">
                        A Meta diz que esta conta está {conta.status_rotulo || "inativa"}: ligar não traz números.
                      </p>
                    )}
                  </div>

                  {jaLigada ? (
                    <span className="text-[11px] font-semibold text-success">já monitorada</span>
                  ) : (
                    <>
                      <select
                        value={donoEscolhido[conta.numero] || ""}
                        onChange={(e) =>
                          setDonoEscolhido((antes) => ({
                            ...antes,
                            [conta.numero]: e.target.value,
                          }))}
                        className="h-8 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground sm:w-48"
                      >
                        <option value="">Cliente...</option>
                        {comTrafego.map((cliente: any) => (
                          <option key={cliente.id} value={cliente.id}>
                            {cliente.company_name || cliente.full_name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        onClick={() => void ligarDaLista(conta)}
                        disabled={ligandoNumero === conta.numero || !donoEscolhido[conta.numero]}
                      >
                        {ligandoNumero === conta.numero ? "Ligando..." : "Monitorar"}
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {comTrafego.length === 0 && (
            <p className="mt-2 text-[11px] text-warning">
              Nenhum cliente do painel está marcado com o serviço de tráfego. Marque no
              cadastro do cliente para ele aparecer nesta lista.
            </p>
          )}
        </div>
      )}

      {/* Os caminhos alternativos, recolhidos: ligar pelo número e o token da agência. */}
      {maisOpcoes && (
        <div className="grid min-w-0 grid-cols-1 gap-4 border-t border-border px-4 py-3 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-[12.5px] font-semibold text-foreground">Ligar conta pelo número</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              O número está no Gerenciador (act_123456789); com ou sem o "act_".
            </p>
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <select value={clientId} onChange={(event) => setClientId(event.target.value)} className={CAMPO}>
                <option value="">Cliente...</option>
                {comTrafego.map((client: any) => (
                  <option key={client.id} value={client.id}>
                    {client.company_name || client.full_name}
                  </option>
                ))}
              </select>
              <input value={actId} onChange={(event) => setActId(event.target.value)} placeholder="act_123456789" className={CAMPO} />
              <input
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder="Como chamar esta conta"
                className={`${CAMPO} sm:col-span-2`}
              />
            </div>
            <Button size="sm" className="mt-2 gap-1.5" onClick={ligarConta} disabled={salvando || !clientId || !actId.trim()}>
              <Link2 className="h-3.5 w-3.5" /> Ligar conta ao cliente
            </Button>
          </div>

          <div className="min-w-0">
            <h3 className="text-[12.5px] font-semibold text-foreground">Ou cole um token</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Token do Business Manager da agência. Vai para o cofre do banco e nunca mais aparece.
              {conexao?.agencia
                ? ` Guardado em ${new Date(conexao.agencia.saved_at).toLocaleDateString("pt-BR")}; salvar outro substitui.`
                : " Nenhum guardado ainda."}
            </p>
            <div className="mt-2 flex min-w-0 flex-wrap gap-2">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Colar o token aqui"
                className={`${CAMPO} w-full flex-1 sm:w-auto`}
              />
              <Button size="sm" onClick={salvarToken} disabled={salvando || token.trim().length < 20}>
                Guardar no cofre
              </Button>
            </div>
            {(conexao?.perfis || []).length > 0 && (
              <p className="mt-2 text-[10.5px] text-muted-foreground">
                Perfis da Meta conectados:{" "}
                {(conexao?.perfis || [])
                  .map((p) => `${p.label} (${p.contas} ${p.contas === 1 ? "conta" : "contas"})`)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────── a página ─────────────────────────────── */

const COLUNAS = "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_16px]";

export default function AdminAds() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const queryClient = useQueryClient();
  const { data: identidades } = useIdentidadesDosClientes();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState("");
  const [coletando, setColetando] = useState(false);

  const clienteAberto = params.get("cliente") || "";
  const { data: rows, isLoading, error: erroDosDias } = useAdsDaily(undefined, 30);
  const { data: campaigns } = useAdsCampaigns();
  const { data: clients } = useClients();
  const { data: conexao } = useAdsConnection();
  const contasDoCliente = (clientId: string) =>
    (conexao?.contas || []).filter((c) => c.client_id === clientId && c.status === "active");

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
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }

  const semConta = (conexao?.contas || []).length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Megaphone className="h-5 w-5 text-primary" />
            Anúncios
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Meta Ads lido direto da conta, de hora em hora. Números dos últimos 30 dias.
          </p>
        </div>
        <Button size="sm" onClick={atualizarAgora} disabled={coletando} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${coletando ? "animate-spin" : ""}`} />
          {coletando ? "Pedindo leitura..." : "Atualizar agora"}
        </Button>
      </header>

      <ContasEConexao
        clienteId={clienteAberto || undefined}
        nomes={nomes}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["ads-connection"] });
        }}
      />

      {/* 26/09: gestão de campanhas pelo agente da Mesa Ads (token da carteira). */}
      <AtivarGestao clientId={null} podeConectar={profile?.role === "admin"} compacto />

      {erroDosDias && (
        <p className="rounded-xl border border-destructive/30 bg-card px-4 py-3 text-[12px] text-destructive">
          Não consegui ler os números dos anúncios: {(erroDosDias as { message?: string })?.message || "erro desconhecido"}.
          Nada foi apagado; tente "Atualizar agora".
        </p>
      )}

      {clienteAberto ? (
        <ClientAdsDetail
          clientId={clienteAberto}
          clientName={nomes.get(clienteAberto) || "Cliente"}
          logoUrl={identidades?.get(clienteAberto)?.profile_picture_url}
          rows={(rows || []).filter((row) => row.client_id === clienteAberto)}
          campaigns={(campaigns || []).filter((row) => row.client_id === clienteAberto)}
          contas={contasDoCliente(clienteAberto)}
          carregando={isLoading}
          // Dentro do cliente, o AGORA dele: entrar no detalhe não faz as campanhas ativas sumirem.
          agora={<CampanhasAtivas clientId={clienteAberto} />}
          onBack={() => {
            const proximo = new URLSearchParams(params);
            proximo.delete("cliente");
            setParams(proximo, { replace: true });
          }}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando campanhas...</p>
      ) : semConta ? null : porCliente.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-5 text-[12.5px] text-muted-foreground">
          As contas estão ligadas e a primeira leitura está a caminho. "Atualizar agora" apressa;
          os números aparecem aqui em alguns minutos.
        </p>
      ) : (
        <>
          <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">Desempenho por cliente</h2>
                <p className="text-[11px] text-muted-foreground">Resultado pelo objetivo de cada campanha. Clique para abrir.</p>
              </div>
              {porCliente.length > 6 && (
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={busca}
                    onChange={(event) => setBusca(event.target.value)}
                    placeholder="Buscar cliente..."
                    className={`${CAMPO} w-full pl-8`}
                  />
                </div>
              )}
            </div>

            <div className={`hidden gap-3 px-4 py-2 sm:grid ${COLUNAS}`}>
              {["Cliente", "Investido", "Resultado", "Alcance", "Saldo"].map((t) => (
                <p key={t} className={ROTULO}>{t}</p>
              ))}
            </div>

            <ul className="min-w-0 divide-y divide-border">
              {filtrados.map(([clientId, lista]) => {
                const carteira = summarizeAccount(lista);
                const res = resumoDosResultados(resultadosPorObjetivo(lista));
                const contas = contasDoCliente(clientId);
                const saldo = saldoDas(contas);
                const problemas = contas.filter((c) => {
                  const tom = situacaoDaConta(c).tom;
                  return tom === "erro" || tom === "atencao";
                }).length;
                return (
                  <li key={clientId} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => abrirCliente(clientId)}
                      className={`group grid w-full min-w-0 grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-secondary/40 ${COLUNAS}`}
                    >
                      <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:col-span-1">
                        {/* Mesma marca da grade de Métricas: reconhecer o cliente
                            não pode depender da tela. */}
                        <LogoDoCliente
                          url={identidades?.get(clientId)?.profile_picture_url}
                          nome={nomes.get(clientId)}
                          tamanho={32}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-foreground">
                            {nomes.get(clientId) || "Cliente"}
                          </p>
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {lista.length === 0
                              ? "Conta ligada · sem gasto nos últimos 30 dias"
                              : `${carteira.campanhas} ${carteira.campanhas === 1 ? "campanha" : "campanhas"}`}
                            {problemas > 0 && (
                              <span className="text-warning"> · {problemas} {problemas === 1 ? "conta pede" : "contas pedem"} atenção</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className={`${ROTULO} sm:hidden`}>Investido</p>
                        <p className="truncate font-mono text-[13px] font-semibold text-foreground">{dinheiro(carteira.investido)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className={`${ROTULO} sm:hidden`}>Resultado</p>
                        <p className={`truncate text-[12.5px] ${res.principal ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                          {res.valor}
                        </p>
                        {(res.custo || res.outros) && (
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {[res.custo, res.outros ? `+ ${res.outros}` : ""].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`${ROTULO} sm:hidden`}>Alcance</p>
                        <p className="truncate font-mono text-[12.5px] text-foreground">{numero(carteira.alcance)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className={`${ROTULO} sm:hidden`}>Saldo</p>
                        <p className="truncate font-mono text-[12.5px] text-foreground">{saldo != null ? dinheiro(saldo) : "-"}</p>
                      </div>
                      <ChevronRight className="hidden h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary sm:block" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtrados.length === 0 && (
              <p className="px-4 py-4 text-[12px] text-muted-foreground">Nenhum cliente com esse nome.</p>
            )}
          </section>

          {/* O que está no ar AGORA vem DEPOIS dos clientes: a lista é a porta
              de entrada, e cada campanha diz de qual cliente é. */}
          <CampanhasAtivas nomesDeClientes={nomes} aoAbrirCliente={abrirCliente} />
        </>
      )}
    </div>
  );
}

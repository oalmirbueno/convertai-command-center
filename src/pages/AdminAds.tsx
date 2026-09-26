import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Link2, Megaphone, RefreshCw } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import AtivarGestao from "@/components/mesa-ads/AtivarGestao";
import { useClients } from "@/hooks/useSupabaseData";
import { hasService } from "@/lib/clientFlags";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  Painel,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { CampoDeBusca, FaixaDeNumeros } from "@/components/sistema";
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
 * A área de anúncios (docs/design/SISTEMA.md; pedido do dono em 26/09:
 * "desorganizada, confusa, poluída; mais fácil de usar, simplificada").
 *
 * Lista (sem cliente aberto), três seções separadas por linha fina:
 * 1. Contas de anúncio: situação de cada conta e TODAS as ações de conectar,
 *    reconectar e ligar num painel só (e a gestão pelo agente no pé dele).
 * 2. Desempenho por cliente: uma linha por cliente, com o resultado certo
 *    para o objetivo de cada campanha (conversa não soma com venda).
 * 3. No ar agora: o que está rodando e o que fazer a respeito.
 *
 * Cliente aberto (?cliente=): números em uma faixa, as contas dele, o que
 * está no ar, as campanhas nas duas leituras (como o cliente lê e os números
 * da equipe), os criativos e o relatório já preenchido.
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
  const { label, tone } = statusLabel(campaign?.status, campaign?.effective_status);
  return <span className={juntar(etiqueta, "ml-2", TOM[tone])}>{label}</span>;
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

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Botão de ação da página: no celular só o ícone (com aria-label), do tablet para cima o texto. */
function BotaoDaPagina({
  icone,
  rotulo,
  classe,
  onClick,
  disabled,
  ariaLabel,
}: {
  icone: ReactNode;
  rotulo: string;
  classe: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classe} aria-label={ariaLabel || rotulo}>
      {icone}
      <span className="ml-1.5 hidden sm:inline">{rotulo}</span>
    </button>
  );
}

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
  contasDoCliente,
  seletorDeCliente,
  atualizar,
  erro,
  podeAbrirMesaAds,
}: {
  clientId: string;
  clientName: string;
  logoUrl?: string | null;
  rows: AdsDaily[];
  campaigns: AdsCampaign[];
  contas: Conta[];
  carregando: boolean;
  /** O que está no ar agora deste cliente, montado pela página. */
  agora: ReactNode;
  /** As contas de anúncio só deste cliente (ContasEConexao filtrada). */
  contasDoCliente: ReactNode;
  seletorDeCliente: ReactNode;
  atualizar: ReactNode;
  erro: ReactNode;
  podeAbrirMesaAds: boolean;
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
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        voltar={{ para: "/anuncios", rotulo: "Anúncios" }}
        titulo={
          <span className="flex min-w-0 items-center">
            <LogoDoCliente url={logoUrl} nome={clientName} tamanho={28} className="mr-2.5" />
            <span className="min-w-0 truncate">{clientName}</span>
          </span>
        }
        descricao={`Últimos 30 dias · ${plural(carteira.campanhas, "campanha", "campanhas")}`}
        ajuda={
          <>
            Investido: {EXPLICACOES.investido} Resultado: {EXPLICACOES.resultados} Alcance: {EXPLICACOES.alcance} O relatório
            já sai preenchido com estes números e os criativos.
          </>
        }
        acoes={
          <>
            {seletorDeCliente}
            {podeAbrirMesaAds && (
              <Link to={`/mesa-ads?client=${encodeURIComponent(clientId)}`} className={juntar(botao.discreto, "hidden sm:inline-flex")} aria-label="Abrir na Mesa Ads">
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden lg:inline">Mesa Ads</span>
              </Link>
            )}
            {atualizar}
            {/* O relatório nasce aqui, onde o dado está: os números já vêm preenchidos. */}
            <BotaoDaPagina
              icone={<FileText className="h-4 w-4" aria-hidden="true" />}
              rotulo="Gerar relatório"
              classe={botao.primario}
              onClick={gerarRelatorio}
            />
          </>
        }
      />

      <AreaDeTrabalho key={clientId} memoriaDaRolagem={`anuncios:cliente:${clientId}`} rotuloDoPrincipal={`Anúncios de ${clientName}`}>
        <div className="min-w-0 space-y-5">
          {erro}
          <div className="min-w-0">
            <FaixaDeNumeros
              tamanho="compacto"
              apoioAoLado
              rotulo="Resumo dos últimos 30 dias"
              itens={[
                { rotulo: "Investido", valor: dinheiro(carteira.investido) },
                { rotulo: "Resultado", valor: resultados.valor, apoio: resultados.custo },
                { rotulo: "Pessoas alcançadas", valor: numero(carteira.alcance) },
                {
                  rotulo: "Saldo na conta",
                  valor: saldo != null ? dinheiro(saldo) : "não lido",
                  apoio: saldo == null ? "pós-paga ou sem leitura" : null,
                },
              ]}
            />
            {resultados.outros && <p className={juntar(texto.auxiliar, "mt-2 truncate")}>Também: {resultados.outros}</p>}
          </div>

          {contasDoCliente}

          {agora}

          <Secao divisoria titulo="Campanhas" descricao={`Últimos 30 dias · ${porCampanha.length}`} ajuda="Cada campanha nas duas leituras: como o cliente lê no relatório e os números que a equipe usa para decidir.">
            {carregando && porCampanha.length === 0 ? (
              <Carregando rotulo="Carregando campanhas" linhas={3} />
            ) : porCampanha.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhuma campanha com movimento nos últimos 30 dias nesta conta." />
            ) : (
              <Painel semEspaco>
                <ul className="min-w-0 divide-y divide-border">
                  {porCampanha.map(({ resumo, ficha }) => {
                    const alerta = teamAlert(resumo);
                    return (
                      <li key={resumo.campaignId} className="min-w-0 px-4 py-3">
                        <div className="flex min-w-0 items-center">
                          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{resumo.name}</p>
                          <StatusChip campaign={ficha} />
                          <span className="ml-3 shrink-0 text-[13px] font-medium tabular-nums text-foreground">{dinheiro(resumo.investido)}</span>
                        </div>
                        <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                          {/* A leitura do cliente, exatamente como sai no relatório dele. */}
                          <div className={juntar(superficie.poco, "min-w-0 px-3 py-2")}>
                            <p className={texto.rotulo}>Como o cliente lê</p>
                            <p className="mt-0.5 text-[12.5px] leading-5 text-foreground">{clientCampaignSentence(resumo)}</p>
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
                        {alerta && (
                          <p className="mt-2 flex items-start text-[12px] leading-5 text-destructive">
                            <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {alerta}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Painel>
            )}
          </Secao>

          {/* As peças: "qual anúncio funcionou" é a pergunta seguinte. */}
          <GaleriaDeCriativos criativos={criativos || []} periodoDias={30} chave={clientId} />
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

const ehTexto = (v: unknown) => typeof v === "string";

/**
 * As contas de anúncio e a conexão com a Meta, num painel só: a situação de
 * cada conta e, no mesmo lugar, conectar, reconectar, escolher as contas que
 * a Meta devolveu, ligar pelo número, o token da agência e a gestão pelo
 * agente. Com um cliente aberto, mostra só as contas dele.
 */
function ContasEConexao({
  clienteId,
  nomes,
  podeConectar,
  onDone,
}: {
  clienteId?: string;
  nomes: Map<string, string>;
  /** Só admin inicia o login de gestão (AtivarGestao). */
  podeConectar: boolean;
  onDone: () => void;
}) {
  const { data: conexao, isLoading, error, refetch } = useAdsConnection();
  const { data: clients } = useClients();
  // O token NUNCA vai para o navegador: fica só na memória da tela até ir para o cofre.
  const [token, setToken] = useState("");
  const [maisOpcoes, setMaisOpcoes] = useEstadoDaTela("anuncios:mais-opcoes", false, { validar: (v) => typeof v === "boolean" });
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
  // Rascunho de "ligar pelo número": não se perde ao sair e voltar.
  const [clientId, setClientId] = useEstadoDaTela(`anuncios:ligar:cliente:${clienteId || "todos"}`, clienteId || "", { validar: ehTexto });
  const [actId, setActId] = useEstadoDaTela("anuncios:ligar:numero", "", { validar: ehTexto });
  const [nome, setNome] = useEstadoDaTela("anuncios:ligar:nome", "", { validar: ehTexto });

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
    ? "Lendo a situação das contas"
    : ativas.length === 0
      ? clienteId
        ? "Este cliente não tem conta de anúncio ligada."
        : "Nenhuma conta ligada ainda."
      : [
          plural(ativas.length, "conta", "contas"),
          `${emDia} lendo normalmente`,
          comProblema ? `${comProblema} ${comProblema === 1 ? "precisa" : "precisam"} de atenção` : "",
          desligadas ? plural(desligadas, "desligada", "desligadas") : "",
          ultimaLeitura ? `última leitura ${haQuanto(ultimaLeitura)}` : "",
        ].filter(Boolean).join(" · ");

  const rotuloConectar = salvando ? "Abrindo a Meta..." : precisaReconectar ? "Reconectar com a Meta" : "Conectar com a Meta";

  return (
    <Secao
      divisoria={!!clienteId}
      titulo="Contas de anúncio"
      descricao={<span className={juntar("block truncate", comProblema ? "text-foreground" : "")}>{resumo}</span>}
      ajuda="Conecte com a Meta, escolha as contas e o cliente de cada uma. Daí em diante o painel lê campanhas, saldo e criativos sozinho, de hora em hora. Em Mais opções: ligar pelo número e o token da agência."
      acao={
        <>
          <button
            type="button"
            className={botao.discreto}
            onClick={() => setMaisOpcoes((v) => !v)}
            aria-expanded={maisOpcoes}
            aria-label="Mais opções"
          >
            <ChevronDown className={juntar("h-4 w-4 transition-transform", maisOpcoes ? "rotate-180" : "")} aria-hidden="true" />
            <span className="ml-1 hidden sm:inline">Mais opções</span>
          </button>
          <BotaoDaPagina
            icone={<Link2 className="h-4 w-4" aria-hidden="true" />}
            rotulo={rotuloConectar}
            classe={precisaReconectar || (!isLoading && ativas.length === 0) ? botao.primario : botao.secundario}
            onClick={conectarPelaMeta}
            disabled={salvando}
          />
        </>
      }
    >
      <Painel semEspaco className="overflow-hidden">
        {error && (
          <EstadoDeErro
            className="m-3"
            titulo="Não consegui ler a situação das contas."
            descricao={(error as { message?: string })?.message || "Erro desconhecido."}
            acao={
              <button type="button" onClick={() => refetch()} className={botao.secundario}>
                Tentar de novo
              </button>
            }
          />
        )}

        {isLoading && !conexao && <Carregando rotulo="Lendo as contas" linhas={2} className="p-3" />}

        {!isLoading && !error && ativas.length === 0 && (
          <EstadoVazio
            compacto
            className="m-3"
            titulo={clienteId ? "Sem conta ligada." : "Conecte com a Meta, escolha as contas e o cliente de cada uma."}
            descricao={clienteId ? "Ligue pela Meta ou pelo número em Mais opções." : "Daí em diante o painel lê sozinho."}
          />
        )}

        {/* A situação de cada conta, problemas primeiro. No computador rola por dentro; no celular a página rola. */}
        {ativas.length > 0 && (
          <ul className="min-w-0 divide-y divide-border lg:max-h-64 lg:overflow-y-auto lg:overscroll-contain" aria-label="Situação das contas">
            {ativas.map((conta) => {
              const sit = situacaoDaConta(conta);
              const tom = CLASSE_DO_TOM_DA_CONTA[sit.tom];
              const numeros = [
                conta.external_id ? `act_${conta.external_id}` : null,
                conta.saldo_disponivel != null ? `saldo ${dinheiro(Number(conta.saldo_disponivel))}` : null,
                conta.gasto_total != null ? `gasto total ${dinheiro(Number(conta.gasto_total))}` : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={conta.id} className="flex min-w-0 items-start px-4 py-2.5">
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
                      <p className="line-clamp-2 text-[12px] leading-4 text-destructive [overflow-wrap:anywhere]" title={conta.erro}>
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

        {/* Depois do login: escolher o cliente de cada conta devolvida. */}
        {contasDaMeta.length > 0 && (
          <div className="min-w-0 border-t border-border">
            <div className="flex min-w-0 items-center px-4 pb-2 pt-3">
              <div className="mr-3 min-w-0 flex-1">
                <h3 className="truncate text-[13px] font-semibold text-foreground">Contas que a Meta devolveu</h3>
                <p className={juntar(texto.auxiliar, "truncate")}>Escolha o cliente de cada conta que quer monitorar.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setContasDaMeta([]);
                  try {
                    localStorage.removeItem(CONTAS_DA_META);
                  } catch { /* nada a fazer */ }
                }}
                className={botao.discreto}
              >
                Esconder
              </button>
            </div>

            {/* Vinte contas não empurram o resto: no computador a lista rola por dentro. */}
            <ul className="min-w-0 divide-y divide-border border-t border-border lg:max-h-[22rem] lg:overflow-y-auto lg:overscroll-contain" aria-label="Contas que a Meta devolveu">
              {contasDaMeta.map((conta) => {
                const jaLigada = (conexao?.contas || []).find(
                  (c) => c.external_id === conta.numero,
                );
                return (
                  <li key={conta.numero} className="-m-1 flex min-w-0 flex-wrap items-center px-4 py-2 [&>*]:m-1">
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
                        <p className="truncate text-[12px] leading-4 text-warning">
                          A Meta diz que esta conta está {conta.status_rotulo || "inativa"}: ligar não traz números.
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
              <p className="border-t border-border px-4 py-2 text-[12px] leading-4 text-warning">
                Nenhum cliente do painel está marcado com o serviço de tráfego. Marque no cadastro do cliente para ele aparecer aqui.
              </p>
            )}
          </div>
        )}

        {/* Os caminhos alternativos, recolhidos: ligar pelo número e o token da agência. */}
        {maisOpcoes && (
          <div className="grid min-w-0 grid-cols-1 border-t border-border lg:grid-cols-2">
            <div className="min-w-0 p-4">
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
                <CampoDeFormulario rotulo="Número da conta" apoio='Está no Gerenciador; com ou sem o "act_".'>
                  <input value={actId} onChange={(event) => setActId(event.target.value)} placeholder="act_123456789" className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Nome da conta" largo>
                  <input value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Como chamar esta conta" className={campo} />
                </CampoDeFormulario>
              </GrupoDeCampos>
              <div className="mt-3 flex justify-end">
                <button type="button" className={botao.primario} onClick={ligarConta} disabled={salvando || !clientId || !actId.trim()}>
                  <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Ligar conta ao cliente
                </button>
              </div>
            </div>

            <div className="min-w-0 border-t border-border p-4 lg:border-l lg:border-t-0">
              <GrupoDeCampos titulo="Ou cole um token" colunas={1}>
                <CampoDeFormulario
                  rotulo="Token do Business Manager"
                  ajuda="Token do Business Manager da agência. Vai para o cofre do banco e nunca mais aparece."
                  apoio={
                    conexao?.agencia
                      ? `Guardado em ${new Date(conexao.agencia.saved_at).toLocaleDateString("pt-BR")}; salvar outro substitui.`
                      : "Nenhum guardado ainda."
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
                    Perfis conectados:{" "}
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

        {/* 26/09: gestão de campanhas pelo agente da Mesa Ads (token da carteira), no pé do mesmo painel. */}
        <div className="border-t border-border">
          <AtivarGestao clientId={null} podeConectar={podeConectar} compacto className="!rounded-none !border-0 !bg-transparent" />
        </div>
      </Painel>
    </Secao>
  );
}

/* ─────────────────────────────── a página ─────────────────────────────── */

const COLUNAS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_16px]";

export default function AdminAds() {
  const { profile } = useAuth();
  const papel = profile?.role || "";
  const isStaff = ["admin", "manager", "design", "traffic"].includes(papel);
  const queryClient = useQueryClient();
  const { data: identidades } = useIdentidadesDosClientes();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useEstadoDaTela("anuncios:busca", "", { validar: ehTexto });
  const [coletando, setColetando] = useState(false);

  const clienteAberto = params.get("cliente") || "";
  const { data: rows, isLoading, error: erroDosDias, refetch: releDias } = useAdsDaily(undefined, 30);
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
    return (
      <div className="min-w-0 space-y-4">
        <CabecalhoDePagina titulo="Anúncios" descricao="Esta área é da equipe." />
      </div>
    );
  }

  const semConta = (conexao?.contas || []).length === 0;
  const aoMudarConexao = () => {
    queryClient.invalidateQueries({ queryKey: ["ads-connection"] });
  };

  const botaoAtualizar = (
    <BotaoDaPagina
      icone={<RefreshCw className={juntar("h-4 w-4", coletando ? "animate-spin" : "")} aria-hidden="true" />}
      rotulo={coletando ? "Pedindo leitura..." : "Atualizar agora"}
      ariaLabel="Atualizar agora"
      classe={botao.secundario}
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

  if (clienteAberto) {
    const opcoesDeCliente = porCliente.map(([id]) => ({ valor: id, rotulo: nomes.get(id) || "Cliente" }));
    if (!opcoesDeCliente.some((o) => o.valor === clienteAberto)) {
      opcoesDeCliente.unshift({ valor: clienteAberto, rotulo: nomes.get(clienteAberto) || "Cliente" });
    }
    return (
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
        contasDoCliente={<ContasEConexao clienteId={clienteAberto} nomes={nomes} podeConectar={papel === "admin"} onDone={aoMudarConexao} />}
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
      />
    );
  }

  const ultimaLeitura = (conexao?.contas || []).reduce<string | null>(
    (m, c) => (c.status === "active" && c.ultima_coleta && (!m || c.ultima_coleta > m) ? c.ultima_coleta : m),
    null,
  );
  const descricao = [
    porCliente.length ? plural(porCliente.length, "cliente", "clientes") : "",
    "últimos 30 dias",
    ultimaLeitura ? `lido ${haQuanto(ultimaLeitura)}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Anúncios"
        descricao={descricao.charAt(0).toUpperCase() + descricao.slice(1)}
        ajuda="Meta Ads lido direto da conta, de hora em hora, com os números dos últimos 30 dias. Toque num cliente para ver campanhas, criativos e gerar o relatório."
        acoes={botaoAtualizar}
      />

      <AreaDeTrabalho key="lista" memoriaDaRolagem="anuncios:lista" rotuloDoPrincipal="Anúncios por cliente">
        <div className="min-w-0 space-y-5">
          {erroNaLeitura}

          <ContasEConexao nomes={nomes} podeConectar={papel === "admin"} onDone={aoMudarConexao} />

          {semConta ? null : (
            <Secao
              divisoria
              titulo="Desempenho por cliente"
              descricao={busca.trim() ? `${filtrados.length} de ${porCliente.length}` : plural(porCliente.length, "cliente", "clientes")}
              ajuda="Resultado pelo objetivo de cada campanha: conversa não soma com venda. Toque num cliente para abrir."
            >
              {porCliente.length > 6 && (
                <CampoDeBusca
                  valor={busca}
                  onMudar={setBusca}
                  placeholder="Buscar cliente"
                  rotulo="Buscar cliente"
                  className="mb-3 w-full sm:w-64"
                />
              )}
              {isLoading && !rows ? (
                <Carregando rotulo="Carregando campanhas" linhas={3} />
              ) : porCliente.length === 0 ? (
                <EstadoVazio
                  compacto
                  titulo="Primeira leitura a caminho."
                  descricao='"Atualizar agora" apressa; os números aparecem aqui em alguns minutos.'
                />
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
                <Painel semEspaco>
                  <div className={juntar("hidden gap-x-5 border-b border-border px-4 py-2 md:grid", COLUNAS)} aria-hidden="true">
                    <p className={texto.rotulo}>Cliente</p>
                    <p className={juntar(texto.rotulo, "text-right")}>Investido</p>
                    <p className={texto.rotulo}>Resultado</p>
                    <p className={juntar(texto.rotulo, "text-right")}>Alcance</p>
                    <p className={juntar(texto.rotulo, "text-right")}>Saldo</p>
                    <span />
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
                            className={juntar(
                              "group flex w-full min-w-0 items-center px-4 py-3 text-left transition-colors hover:bg-muted/50 md:grid md:gap-x-5",
                              COLUNAS,
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            )}
                          >
                            <div className="flex min-w-0 flex-1 items-center">
                              {/* Mesma marca da grade de Métricas: reconhecer o cliente não pode depender da tela. */}
                              <LogoDoCliente
                                url={identidades?.get(clientId)?.profile_picture_url}
                                nome={nomes.get(clientId)}
                                tamanho={32}
                                className="mr-2.5"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-semibold text-foreground">{nomes.get(clientId) || "Cliente"}</p>
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {lista.length === 0
                                    ? "Conta ligada · sem gasto nos últimos 30 dias"
                                    : plural(carteira.campanhas, "campanha", "campanhas")}
                                  {problemas > 0 && (
                                    <span className="text-warning"> · {problemas} {problemas === 1 ? "conta pede" : "contas pedem"} atenção</span>
                                  )}
                                </p>
                              </div>
                            </div>
                            {/* Celular: o essencial à direita da linha. */}
                            <div className="ml-3 max-w-[45%] shrink-0 text-right md:hidden">
                              <p className="truncate text-[13px] font-semibold tabular-nums text-foreground">{dinheiro(carteira.investido)}</p>
                              <p className={juntar(texto.auxiliar, "truncate")}>{res.valor}</p>
                            </div>
                            <p className="hidden truncate text-right text-[13px] font-semibold tabular-nums text-foreground md:block">{dinheiro(carteira.investido)}</p>
                            <div className="hidden min-w-0 md:block">
                              <p className={juntar("truncate text-[13px]", res.principal ? "font-medium text-foreground" : "text-muted-foreground")}>{res.valor}</p>
                              {(res.custo || res.outros) && (
                                <p className={juntar(texto.auxiliar, "truncate")}>
                                  {[res.custo, res.outros ? `+ ${res.outros}` : ""].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            <p className="hidden truncate text-right text-[13px] tabular-nums text-foreground md:block">{numero(carteira.alcance)}</p>
                            <p className="hidden truncate text-right text-[13px] tabular-nums text-foreground md:block">{saldo != null ? dinheiro(saldo) : "-"}</p>
                            <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary md:ml-0" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Painel>
              )}
            </Secao>
          )}

          {/* O que está no ar AGORA vem DEPOIS dos clientes: a lista é a porta
              de entrada, e cada campanha diz de qual cliente é. */}
          {!semConta && porCliente.length > 0 && <CampanhasAtivas nomesDeClientes={nomes} aoAbrirCliente={abrirCliente} />}
        </div>
      </AreaDeTrabalho>
    </div>
  );
}

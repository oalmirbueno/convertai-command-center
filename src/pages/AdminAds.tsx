import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Link2,
  FileText,
  Megaphone,
  RefreshCw,
  Search,
} from "lucide-react";
import { Link2 as LinkIcon } from "lucide-react";
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
import { useClients } from "@/hooks/useSupabaseData";
import { hasService } from "@/lib/clientFlags";
import {
  collectAdsMetricsNow,
  useAdsCreatives,
  connectAdsAccount,
  saveMetaAdsToken,
  useAdsCampaigns,
  useAdsConnection,
  useAdsDaily,
  type AdsCampaign,
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

/**
 * A área de anúncios, no mesmo formato da de métricas do Instagram: um hub por
 * cliente, e o dossiê completo ao clicar.
 *
 * A diferença é para QUEM cada linha fala. A mesma campanha aparece duas vezes
 * na tela do dossiê: em cima, do jeito que o cliente vai ler no relatório; logo
 * abaixo, com os números que a equipe usa para decidir. Ver as duas juntas é o
 * que evita o relatório bonito que esconde uma campanha cara.
 */

const TOM: Record<string, string> = {
  ativa: "bg-success/10 text-success",
  pausada: "bg-muted text-muted-foreground",
  encerrada: "bg-muted text-muted-foreground",
  atencao: "bg-destructive/10 text-destructive",
};

function StatusChip({ campaign }: { campaign?: AdsCampaign }) {
  const { label, tone } = statusLabel(campaign?.status, campaign?.effective_status);
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TOM[tone]}`}>
      {label}
    </span>
  );
}

/** Um número com o que ele quer dizer logo embaixo, para não precisar explicar. */
function Numero({
  rotulo,
  valor,
  explicacao,
}: {
  rotulo: string;
  valor: string;
  explicacao?: string;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {rotulo}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{valor}</p>
      {explicacao && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{explicacao}</p>
      )}
    </div>
  );
}

/** Dossiê de UM cliente: a carteira dele e cada campanha nas duas leituras. */
function ClientAdsDetail({
  clientId,
  clientName,
  rows,
  campaigns,
  onBack,
}: {
  clientId: string;
  clientName: string;
  rows: AdsDaily[];
  campaigns: AdsCampaign[];
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
  const { data: criativos } = useAdsCreatives(clientId, 30);

  /**
   * Abre o relatório já preenchido com o que a Meta devolveu.
   *
   * O resumo sai na língua do cliente (a mesma camada que alimenta o portal),
   * e os números vão nos nomes que o relatório já entende — nada de digitar de
   * novo o que o painel acabou de ler.
   */
  const gerarRelatorio = () => {
    const dias = [...rows].map((row) => row.day).sort();
    const linhas = porCampanha
      .map(({ resumo }) => `· ${resumo.name}: ${clientCampaignLine(resumo)}`)
      .join("\n");

    // O trecho das peças entra no MESMO relatório, e não num relatório
    // paralelo: quem lê quer uma página, não duas que precisam ser
    // conferidas uma contra a outra.
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

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{clientName}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Últimos 30 dias · {carteira.campanhas}{" "}
              {carteira.campanhas === 1 ? "campanha" : "campanhas"}
            </p>
          </div>
          {/* O relatório de anúncios nasce aqui, onde o dado está. Antes era
              exportar a planilha do Gerenciador e subir em Relatórios; agora
              os números já vêm preenchidos e ninguém redigita. */}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={gerarRelatorio}>
            <FileText className="h-3.5 w-3.5" /> Gerar relatório
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Numero
            rotulo="Investido"
            valor={dinheiro(carteira.investido)}
            explicacao={EXPLICACOES.investido}
          />
          <Numero
            rotulo="Pessoas alcançadas"
            valor={numero(carteira.alcance)}
            explicacao={EXPLICACOES.alcance}
          />
          {carteira.resultados != null && (
            <Numero
              rotulo="Resultados"
              valor={numero(carteira.resultados)}
              explicacao={EXPLICACOES.resultados}
            />
          )}
        </div>
      </div>

      {/* Os criativos vêm ANTES das campanhas de propósito: a pergunta que
          se faz olhando anúncio é "qual peça funcionou", e campanha é o
          agregado que já estava disponível antes. */}
      <GaleriaDeCriativos criativos={criativos || []} periodoDias={30} />

      {porCampanha.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma campanha com movimento nos últimos 30 dias nesta conta.
        </div>
      ) : (
        porCampanha.map(({ resumo, ficha }) => {
          const alerta = teamAlert(resumo);
          return (
            <div key={resumo.campaignId} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{resumo.name}</p>
                <StatusChip campaign={ficha} />
              </div>

              {/* A leitura do cliente, exatamente como sai no relatório dele. */}
              <div className="mt-3 rounded-xl border border-border/60 bg-secondary/40 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Como o cliente lê
                </p>
                <p className="mt-1 text-xs leading-relaxed text-foreground">
                  {clientCampaignSentence(resumo)}
                </p>
              </div>

              {/* E os números de operar. */}
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {teamCampaignLine(resumo)}
              </p>

              {ficha?.daily_budget != null && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Verba diária configurada: {dinheiro(Number(ficha.daily_budget))}
                </p>
              )}

              {alerta && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <p className="text-[11px] leading-relaxed text-foreground">{alerta}</p>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/** Ligar a conta de anúncios: o token da agência e o número de cada conta. */
type ContaDaMeta = { numero: string; nome: string | null };

/** Onde a lista de contas devolvida pela Meta descansa entre recarregamentos. */
const CONTAS_DA_META = "aceleriq-contas-da-meta";

function ConexaoAds({ onDone }: { onDone: () => void }) {
  const { data: conexao } = useAdsConnection();
  const { data: clients } = useClients();
  const [token, setToken] = useState("");
  /**
   * As contas que a Meta devolveu na conexao, para escolher quais entram.
   *
   * Fica em localStorage porque perder a lista num recarregar de pagina
   * obrigaria a refazer o login so para ver de novo os mesmos nomes. Sao
   * numero e nome de conta: nao ha segredo nenhum aqui, o acesso mesmo
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
  const [clientId, setClientId] = useState("");
  const [actId, setActId] = useState("");
  const [nome, setNome] = useState("");

  const comTrafego = (clients || []).filter((client: any) => hasService(client, "trafego"));

  /**
   * Conectar anúncios pelo mesmo login da Meta, e SÓ os anúncios.
   *
   * Porta separada de propósito: colher o acesso de carona na conexão de
   * Instagram obrigaria a reconectar uma conta que já funciona. Se essa
   * reconexão desse errado, ele perderia as duas coisas em vez de nenhuma.
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

  /* O popup avisa por mensagem quando termina. Escutar aqui é o que faz a
     tela reagir sozinha, sem a pessoa ter que apertar atualizar. */
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
      await connectAdsAccount({
        clientId: cliente,
        actId: conta.numero,
        displayName: conta.nome || `Conta ${conta.numero}`,
      });
      toast.success("Conta ligada. A primeira leitura chega em alguns minutos.");
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
      await connectAdsAccount({ clientId, actId, displayName: nome });
      setActId("");
      setNome("");
      toast.success("Conta ligada. A primeira leitura chega em alguns minutos.");
      onDone();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Não foi possível ligar a conta.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">1. Conexão com a Meta</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          O caminho curto: entre com a sua conta e autorize a leitura de anúncios.
          Um acesso só cobre todas as contas que você administra, e nenhuma conexão
          de Instagram é tocada.
        </p>
        <Button size="sm" className="mt-2.5 gap-2" onClick={conectarPelaMeta} disabled={salvando}>
          <LinkIcon className="h-3.5 w-3.5" />
          {salvando ? "Abrindo a Meta..." : "Conectar com a Meta"}
        </Button>

        <div className="my-3.5 h-px bg-border" />

        <h3 className="text-[12px] font-semibold text-foreground">Ou cole um token</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Um token só, do Business Manager da Aceleriq, cobre todas as contas de anúncio
          que já estão sob a nossa gestão. Ele é guardado no cofre do banco e nunca mais
          aparece nesta tela — nem para nós.
        </p>
        {conexao?.agencia ? (
          <p className="mt-2 text-[11px] text-success">
            Token guardado em{" "}
            {new Date(conexao.agencia.saved_at).toLocaleDateString("pt-BR")}. Salvar outro
            substitui este.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">Nenhum token guardado ainda.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Colar o token aqui"
            className="min-w-[240px] flex-1 rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          <Button size="sm" onClick={salvarToken} disabled={salvando || token.trim().length < 20}>
            Guardar no cofre
          </Button>
        </div>
      </div>

      {contasDaMeta.length > 0 && (
        <div className="rounded-2xl border border-primary/40 bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Contas que a Meta devolveu
            </h2>
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
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Escolha o cliente de cada conta que você quer monitorar. O que não for
            ligado aqui simplesmente não é lido, e nada é decidido por conta própria:
            conta ligada ao cliente errado poria o investimento de um no relatório de
            outro, e isso só apareceria no fim do mês.
          </p>

          {/* Rolagem própria: uma carteira com vinte contas empurraria o
              resto da tela para fora antes de alguém ligar a primeira. */}
          <div className="mt-3 max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
            {contasDaMeta.map((conta) => {
              const jaLigada = (conexao?.contas || []).find(
                (c) => c.external_id === conta.numero,
              );
              return (
                <div
                  key={conta.numero}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2"
                >
                  <div className="min-w-[180px] flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {conta.nome || `Conta ${conta.numero}`}
                    </p>
                    <p className="text-[10px] text-muted-foreground">act_{conta.numero}</p>
                  </div>

                  {jaLigada ? (
                    <span className="text-[11px] font-semibold text-success">
                      já monitorada
                    </span>
                  ) : (
                    <>
                      <select
                        value={donoEscolhido[conta.numero] || ""}
                        onChange={(e) =>
                          setDonoEscolhido((antes) => ({
                            ...antes,
                            [conta.numero]: e.target.value,
                          }))}
                        className="h-8 min-w-[180px] rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground"
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

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">2. Contas de anúncio</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          O número da conta está no Gerenciador de Anúncios, no formato act_123456789.
          Pode colar com ou sem o "act_".
        </p>

        {(conexao?.contas || []).length > 0 && (
          <div className="mt-3 space-y-1.5">
            {conexao!.contas.map((conta) => (
              <div
                key={conta.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2"
              >
                <div>
                  <p className="text-xs font-medium text-foreground">{conta.display_name}</p>
                  <p className="text-[10px] text-muted-foreground">act_{conta.external_id}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {conta.ultima_coleta
                    ? `Lida ${new Date(conta.ultima_coleta).toLocaleString("pt-BR")}`
                    : "Aguardando a primeira leitura"}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
          >
            <option value="">Cliente...</option>
            {comTrafego.map((client: any) => (
              <option key={client.id} value={client.id}>
                {client.company_name || client.full_name}
              </option>
            ))}
          </select>
          <input
            value={actId}
            onChange={(event) => setActId(event.target.value)}
            placeholder="act_123456789"
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          <input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Como chamar esta conta"
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <Button
          size="sm"
          className="mt-2 gap-2"
          onClick={ligarConta}
          disabled={salvando || !clientId || !actId.trim()}
        >
          <Link2 className="h-3.5 w-3.5" /> Ligar conta ao cliente
        </Button>
      </div>
    </div>
  );
}

export default function AdminAds() {
  const { profile } = useAuth();
  const isStaff = ["admin", "manager", "design", "traffic"].includes(profile?.role || "");
  const queryClient = useQueryClient();
  const { data: identidades } = useIdentidadesDosClientes();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState("");
  const [coletando, setColetando] = useState(false);
  const [mostrarConexao, setMostrarConexao] = useState(false);

  const clienteAberto = params.get("cliente") || "";
  const { data: rows, isLoading } = useAdsDaily(undefined, 30);
  const { data: campaigns } = useAdsCampaigns();
  const { data: clients } = useClients();
  const { data: conexao } = useAdsConnection();

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
    return [...mapa.entries()].sort(
      (a, b) => summarizeAccount(b[1]).investido - summarizeAccount(a[1]).investido,
    );
  }, [rows]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return porCliente;
    return porCliente.filter(([clientId]) =>
      (nomes.get(clientId) || "").toLowerCase().includes(termo),
    );
  }, [porCliente, busca, nomes]);

  const atualizarAgora = async () => {
    setColetando(true);
    try {
      const resultado = await collectAdsMetricsNow();
      const lidas = resultado.campanhas.parsed + resultado.criativos.parsed;
      const pedidas = resultado.campanhas.dispatched + resultado.criativos.dispatched;
      toast.success(
        lidas > 0
          ? `Lidas ${lidas} resposta(s) da Meta, incluindo criativos. Os números já estão na tela.`
          : `Leitura disparada (${pedidas} consulta[s]). Os números chegam em alguns minutos.`,
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
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Megaphone className="h-5 w-5 text-primary" />
            Anúncios · Meta Ads real
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Um hub por cliente, com as campanhas puxadas direto da Meta de hora em hora.
            Clique para abrir: cada campanha aparece do jeito que o cliente lê e com os
            números que a equipe usa para decidir.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMostrarConexao((valor) => !valor)}
            className="gap-2"
          >
            <Link2 className="h-3.5 w-3.5" />
            {mostrarConexao ? "Fechar conexão" : "Conectar"}
          </Button>
          <Button size="sm" onClick={atualizarAgora} disabled={coletando} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${coletando ? "animate-spin" : ""}`} />
            {coletando ? "Atualizando..." : "Atualizar agora"}
          </Button>
        </div>
      </div>

      {mostrarConexao && (
        <ConexaoAds
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["ads-connection"] });
          }}
        />
      )}

      {/* O que está no ar AGORA e o que fazer com isso, antes de qualquer
          acumulado. Número sem recomendação é relatório; recomendação sem
          número é palpite — aqui os dois andam juntos. */}
      <CampanhasAtivas clientId={clienteAberto || undefined} />

      {clienteAberto ? (
        <ClientAdsDetail
          clientId={clienteAberto}
          clientName={nomes.get(clienteAberto) || "Cliente"}
          rows={(rows || []).filter((row) => row.client_id === clienteAberto)}
          campaigns={(campaigns || []).filter((row) => row.client_id === clienteAberto)}
          onBack={() => {
            const proximo = new URLSearchParams(params);
            proximo.delete("cliente");
            setParams(proximo, { replace: true });
          }}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando campanhas...</p>
      ) : semConta ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">
            Nenhuma conta de anúncios ligada ainda.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Clique em "Conectar" para guardar o token da agência e ligar a conta de cada
            cliente. A partir daí o painel lê as campanhas sozinho, de hora em hora, e a
            planilha do Gerenciador deixa de ser necessária.
          </p>
        </div>
      ) : porCliente.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          As contas estão ligadas e a primeira leitura está a caminho. Clique em "Atualizar
          agora" para apressar; os números aparecem aqui em alguns minutos.
        </div>
      ) : (
        <>
          {porCliente.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar cliente..."
                className="w-full rounded-xl border border-border bg-secondary px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtrados.map(([clientId, lista]) => {
              const carteira = summarizeAccount(lista);
              return (
                <button
                  key={clientId}
                  type="button"
                  onClick={() => {
                    const proximo = new URLSearchParams(params);
                    proximo.set("cliente", clientId);
                    setParams(proximo, { replace: true });
                  }}
                  className="group rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-2.5">
                    {/* Mesma marca da grade de Métricas: reconhecer o cliente
                        não pode depender de qual tela se está olhando. */}
                    <LogoDoCliente
                      url={identidades?.get(clientId)?.profile_picture_url}
                      nome={nomes.get(clientId)}
                      tamanho={36}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {nomes.get(clientId) || "Cliente"}
                    </p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {carteira.campanhas} {carteira.campanhas === 1 ? "campanha" : "campanhas"} ·
                    últimos 30 dias
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Numero rotulo="Investido" valor={dinheiro(carteira.investido)} />
                    <Numero
                      rotulo={carteira.resultados != null ? "Resultados" : "Alcance"}
                      valor={numero(
                        carteira.resultados != null ? carteira.resultados : carteira.alcance,
                      )}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Copy, Cpu, Eye, EyeOff,
  ExternalLink, FileJson, Key, Loader2, Network, Plus, RefreshCw,
  RotateCw, Server, ShieldCheck, Trash2, XCircle, Zap
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  AjudaRecolhida,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  RegiaoRolavel,
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
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { MCP_OAUTH_METADATA_URL, MCP_SERVER_URL } from "@/lib/mcp/endpoints";
import { appPublicUrl } from "@/lib/publicUrl";

/* ─── Config ──────────────────────────────────────────────── */
const MCP_URL = MCP_SERVER_URL;
const PRM_URL = MCP_OAUTH_METADATA_URL;
const CONNECT_URL = appPublicUrl("/conectar-mcp");

const SCOPES: { id: string; label: string; hint: string; danger?: boolean }[] = [
  { id: "aceleriq:read", label: "aceleriq:read", hint: "Leitura de projetos, tarefas, clientes, relatórios e calendário editorial." },
  { id: "aceleriq:write", label: "aceleriq:write", hint: "Criar/atualizar tarefas, itens editoriais e rascunhos de relatório. Nunca aprova, agenda ou publica.", danger: true },
  { id: "editorial:read", label: "editorial:read", hint: "Ler apenas o calendário editorial dos clientes autorizados." },
  { id: "editorial:write", label: "editorial:write", hint: "Adicionar pautas com cliente, projeto, formato e data. Nunca aprova, agenda ou publica.", danger: true },
  { id: "aceleriq:finance", label: "aceleriq:finance", hint: "Leitura de indicadores financeiros agregados." },
  { id: "memory:read", label: "memory:read", hint: "Consulta ao Segundo Cérebro (GitHub, somente leitura)." },
  { id: "memory:propose", label: "memory:propose", hint: "Propor arquivos em memory/inbox/chatgpt/ (nunca sobrescreve).", danger: true },
];

const EXPIRY_PRESETS: { label: string; days: number | null }[] = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "1 ano", days: 365 },
  { label: "Sem expiração", days: null },
];

type AgentId =
  | "chatgpt-work"
  | "contexto-semanal"
  | "codex"
  | "claude-code"
  | "hermes"
  | "openclaw"
  | "custom";

const AGENTS: {
  id: AgentId;
  name: string;
  auth: "oauth" | "bearer" | "hybrid";
  title: string;
  description: string;
  defaultScopes: string[];
  defaultName: string;
}[] = [
  {
    id: "chatgpt-work",
    name: "ChatGPT Work",
    auth: "oauth",
    title: "Login interno, sem token manual",
    description: "Conexão recomendada por OAuth. O ChatGPT abre a tela de autorização do Aceleriq.",
    defaultScopes: ["aceleriq:read", "memory:read", "memory:propose"],
    defaultName: "ChatGPT Work OAuth",
  },
  {
    // O fluxo de atualizar o contexto de cada cliente precisa das três coisas
    // ao mesmo tempo: ler o painel, gravar a memória do cliente no painel e
    // propor o dossiê no Segundo Cérebro. Faltando uma, a rotina falha no
    // meio e o registro fica pela metade.
    id: "contexto-semanal",
    name: "Contexto semanal",
    auth: "hybrid",
    title: "Dossiê de cliente pelo GPT",
    description:
      "Lê o painel inteiro, grava o contexto do cliente na memória e propõe o dossiê no Segundo Cérebro. É o conjunto usado pelo prompt de contexto semanal.",
    defaultScopes: [
      "aceleriq:read",
      "aceleriq:write",
      "projects:write",
      "memory:read",
      "memory:propose",
    ],
    defaultName: "Contexto semanal (GPT)",
  },
  {
    id: "codex",
    name: "Codex",
    auth: "bearer",
    title: "Plugin técnico com token",
    description: "Gera credencial mcp_live_* para o plugin oficial, sem duplicar dados.",
    defaultScopes: ["aceleriq:read", "memory:read", "memory:propose"],
    defaultName: "Codex MCP",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    auth: "hybrid",
    title: "OAuth quando disponível ou Bearer técnico",
    description: "Use OAuth para acesso por usuário; use Bearer para automações internas controladas.",
    defaultScopes: ["aceleriq:read", "memory:read"],
    defaultName: "Claude Code MCP",
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    auth: "bearer",
    title: "Execução operacional controlada",
    description: "Credencial escopada para leitura e escrita operacional conforme permissão concedida.",
    defaultScopes: ["aceleriq:read", "aceleriq:write", "memory:read"],
    defaultName: "Hermes Agent MCP",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    auth: "bearer",
    title: "Segundo Cérebro e propostas de memória",
    description: "Credencial focada em consulta e proposta segura no inbox autorizado.",
    defaultScopes: ["memory:read", "memory:propose"],
    defaultName: "OpenClaw MCP",
  },
  {
    id: "custom",
    name: "Agente futuro",
    auth: "hybrid",
    title: "Modelo universal",
    description: "Use para qualquer cliente MCP compatível com Streamable HTTP.",
    defaultScopes: ["aceleriq:read"],
    defaultName: "Agente MCP",
  },
];

/* ─── Types ───────────────────────────────────────────────── */
interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  scopes: string[] | null;
  origin: string | null;
  audience: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface McpDiscovery {
  name?: string;
  version?: string;
  status?: string;
  toolCount?: number;
  secondBrain?: { configured: boolean };
  serverTime?: string;
  protocolVersion?: string;
}

interface AuditRow {
  id: string;
  created_at: string;
  tool_name: string;
  key_id: string | null;
  origin: string | null;
  success: boolean;
  status_code: number | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  correlation_id: string;
}

/* ─── Helpers ─────────────────────────────────────────────── */
async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `mcp_live_${b64}`;
}

const fmtDate = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";

function keyStatus(k: ApiKey): { label: string; tone: "green" | "amber" | "red" | "muted" } {
  if (k.revoked_at) return { label: "Revogada", tone: "red" };
  if (!k.is_active) return { label: "Inativa", tone: "muted" };
  if (k.expires_at && new Date(k.expires_at) < new Date()) return { label: "Expirada", tone: "red" };
  if (k.expires_at) {
    const daysLeft = (new Date(k.expires_at).getTime() - Date.now()) / 86400000;
    if (daysLeft < 7) return { label: `Expira em ${Math.max(0, Math.ceil(daysLeft))}d`, tone: "amber" };
  }
  return { label: "Ativa", tone: "green" };
}

/* ─── Component ───────────────────────────────────────────── */
const ABAS_DO_MCP = ["connect", "credentials", "tools", "audit"] as const;
type AbaDoMcp = (typeof ABAS_DO_MCP)[number];

export default function MCPManager() {
  // Aba interna e filtro lembram ao sair e voltar (docs/design/SISTEMA.md, seção 12).
  const celular = useIsMobile();
  const [aba, setAba] = useEstadoDaTela<AbaDoMcp>("api-docs:mcp:aba", "connect", {
    validar: (v) => typeof v === "string" && (ABAS_DO_MCP as readonly string[]).indexOf(v) >= 0,
  });

  const [discovery, setDiscovery] = useState<McpDiscovery | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [loadingDiscovery, setLoadingDiscovery] = useState(true);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [showOnlyMcp, setShowOnlyMcp] = useEstadoDaTela<boolean>("api-docs:mcp:so-mcp", true, { validar: (v) => typeof v === "boolean" });

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditoriaLida, setAuditoriaLida] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [agentPreset, setAgentPreset] = useState<(typeof AGENTS)[number] | null>(null);
  const [rotateFor, setRotateFor] = useState<ApiKey | null>(null);
  const [revokeFor, setRevokeFor] = useState<ApiKey | null>(null);
  const [testFor, setTestFor] = useState<ApiKey | null>(null);

  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedName, setIssuedName] = useState<string>("");
  const [tokenRevealed, setTokenRevealed] = useState(false);

  /* ─── Load discovery ─── */
  const loadDiscovery = useCallback(async () => {
    setLoadingDiscovery(true);
    setDiscoveryError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: HeadersInit = sessionData.session?.access_token
        ? { Authorization: `Bearer ${sessionData.session.access_token}` }
        : { Authorization: "Bearer mcp-status-probe" };
      const r = await fetch(MCP_URL, { method: "GET", headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDiscovery(await r.json());
    } catch (e) {
      setDiscoveryError((e as Error).message);
    } finally {
      setLoadingDiscovery(false);
    }
  }, []);

  /* ─── Load keys ─── */
  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, key_preview, scopes, origin, audience, is_active, created_at, last_used_at, expires_at, revoked_at")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar credenciais: " + error.message);
    setKeysError(error ? error.message : null);
    setKeys((data as ApiKey[]) ?? []);
    setLoadingKeys(false);
  }, []);

  /* ─── Load audit ─── */
  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    const { data, error } = await supabase
      .from("mcp_audit_log")
      .select("id, created_at, tool_name, key_id, origin, success, status_code, duration_ms, error_code, error_message, correlation_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error("Erro na auditoria: " + error.message);
    setAuditError(error ? error.message : null);
    setAudit((data as AuditRow[]) ?? []);
    setLoadingAudit(false);
    setAuditoriaLida(true);
  }, []);

  useEffect(() => { loadDiscovery(); loadKeys(); loadAudit(); }, [loadDiscovery, loadKeys, loadAudit]);

  const mcpKeys = useMemo(
    () => showOnlyMcp
      ? keys.filter(k => k.audience === "mcp" || (k.audience === null && (k.origin ?? "").toLowerCase() === "mcp"))
      : keys,
    [keys, showOnlyMcp]
  );

  const keyById = useMemo(() => new Map(keys.map(k => [k.id, k])), [keys]);

  const copyText = async (value: string, label = "Copiado") => {
    try { await navigator.clipboard.writeText(value); toast.success(label); } catch { toast.error("Não foi possível copiar"); }
  };

  /* ─── Create ─── */
  const createCredential = async (name: string, scopes: string[], expiresAt: string | null) => {
    const raw = generateToken();
    const hash = await sha256Hex(raw);
    const preview = raw.slice(0, 12) + "…";
    const { data: userData } = await supabase.auth.getUser();

    const { error, data } = await supabase.from("api_keys").insert({
      name: name.trim(),
      key_hash: hash,
      key_preview: preview,
      scopes,
      origin: "mcp",
      audience: "mcp",
      is_active: true,
      expires_at: expiresAt,
      created_by: userData.user?.id ?? null,
    } as any).select().single();

    if (error) { toast.error("Erro ao criar: " + error.message); return null; }
    // Token is only shown once; never persisted anywhere else.
    setIssuedToken(raw);
    setIssuedName(name);
    setTokenRevealed(false);
    await loadKeys();
    return data as ApiKey;
  };

  const revokeCredential = async (k: ApiKey) => {
    const { error } = await supabase.from("api_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", k.id);
    if (error) return toast.error("Erro ao revogar: " + error.message);
    toast.success("Credencial revogada");
    await loadKeys();
  };

  const tones: Record<string, string> = {
    green: "bg-primary/15 text-primary",
    amber: "bg-warning/15 text-warning",
    red: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };

  const novaConexao = () => { setAgentPreset(null); setShowCreate(true); };

  return (
    <div className="min-w-0 space-y-6">
      {/* ── Cabeçalho da área ─────────────────────────────── */}
      <Secao
        titulo="MCP"
        descricao={discovery ? `${discovery.name}@${discovery.version} · ${discovery.toolCount ?? 0} tools` : undefined}
        ajuda="Servidor MCP do Aceleriq OS. Gere credenciais escopadas para ChatGPT, Claude, Codex, Hermes, OpenClaw e outros agentes autorizados. O token aparece uma única vez e nunca é guardado em texto claro."
        acao={
          <>
            <button type="button" className={botao.icone} onClick={() => { loadDiscovery(); loadKeys(); loadAudit(); }} aria-label="Atualizar MCP" title="Atualizar">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.primario, "px-2.5 sm:px-3.5")} onClick={novaConexao} aria-label="Nova conexão">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Nova conexão</span>
            </button>
          </>
        }
      >
        {/* ── Estado dos serviços (uma grade de um nível) ─── */}
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <StatusCard
            icon={<Server className="h-3.5 w-3.5" />}
            title="Servidor MCP"
            loading={loadingDiscovery && !discovery}
            ok={!!discovery && !discoveryError}
            error={discoveryError}
            onRetry={loadDiscovery}
          >
            {discovery && (
              <dl className="divide-y divide-border">
                <Row label="Servidor" value={<code className="text-foreground">{discovery.name}@{discovery.version}</code>} />
                <Row label="Protocolo" value={<code>{discovery.protocolVersion}</code>} />
                <Row label="Tools expostos" value={<span className="tabular-nums">{discovery.toolCount ?? 0}</span>} />
                <Row label="Endpoint" value={<code className="font-mono">{MCP_URL}</code>} />
                <Row label="Hora do servidor" value={<span className="tabular-nums">{fmtDate(discovery.serverTime ?? null)}</span>} />
              </dl>
            )}
          </StatusCard>

          <StatusCard
            icon={<Cpu className="h-3.5 w-3.5" />}
            title="Segundo Cérebro"
            loading={loadingDiscovery && !discovery}
            ok={!!discovery?.secondBrain?.configured}
            error={discovery?.secondBrain && !discovery.secondBrain.configured ? "Bridge não configurada" : null}
          >
            {discovery?.secondBrain && (
              <dl className="divide-y divide-border">
                <Row label="Status" value={
                  discovery.secondBrain.configured
                    ? <span className={juntar(etiqueta, "bg-primary/15 text-primary")}>Configurado</span>
                    : <span className={juntar(etiqueta, "bg-destructive/15 text-destructive")}>Não configurado</span>
                } />
                <Row label="Escrita permitida" value={<code>memory/inbox/chatgpt/</code>} />
                <Row label="Detalhes" value={<span className="text-muted-foreground">via <code>aceleriq_capabilities</code></span>} />
              </dl>
            )}
          </StatusCard>
        </div>
      </Secao>

      {/* ── Abas internas (4: segmentado, lembra ao voltar) ─ */}
      <Tabs value={aba} onValueChange={(v) => setAba(v as AbaDoMcp)} className="w-full min-w-0">
        <div className="min-w-0 overflow-x-auto">
          <SeletorCompacto
            rotulo="Área do MCP"
            valor={aba}
            onEscolher={(v) => setAba(v as AbaDoMcp)}
            larguraTotal={celular}
            // Celular: sem ícones, sem contador e nome curto, para as 4 opções caberem sem corte.
            opcoes={[
              { valor: "connect", rotulo: "Conectar", icone: celular ? undefined : <Network className="h-3.5 w-3.5" /> },
              { valor: "credentials", rotulo: celular ? "Chaves" : "Credenciais", icone: celular ? undefined : <Key className="h-3.5 w-3.5" />, contador: celular || loadingKeys ? null : mcpKeys.length },
              { valor: "tools", rotulo: "Tools", icone: celular ? undefined : <Zap className="h-3.5 w-3.5" /> },
              { valor: "audit", rotulo: "Auditoria", icone: celular ? undefined : <Activity className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>

        {/* ── Conectar ── */}
        <TabsContent value="connect" className="mt-5 space-y-6">
          <Secao
            titulo="Endereços"
            ajuda="ChatGPT Work usa OAuth: cadastre a URL MCP, escolha OAuth e aguarde a tela de login do Aceleriq. Não cole token manual no ChatGPT Work."
            acao={
              <a href="/conectar-mcp" target="_blank" rel="noreferrer" className={botao.secundario}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Guia público
              </a>
            }
          >
            <ul className="divide-y divide-border border-y border-border">
              <li className="flex min-w-0 items-center py-2.5">
                <Network className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className={juntar(texto.rotulo, "mr-3 w-24 shrink-0")}>URL MCP</span>
                <code className="mr-2 min-w-0 flex-1 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]">{MCP_URL}</code>
                <button type="button" className={botao.icone} onClick={() => copyText(MCP_URL)} aria-label="Copiar URL MCP" title="Copiar URL MCP">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
              <li className="flex min-w-0 items-center py-2.5">
                <FileJson className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className={juntar(texto.rotulo, "mr-3 w-24 shrink-0")}>OAuth PRM</span>
                <code className="mr-2 min-w-0 flex-1 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]">{PRM_URL}</code>
                <button type="button" className={botao.icone} onClick={() => copyText(PRM_URL)} aria-label="Copiar OAuth PRM" title="Copiar OAuth PRM">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </Secao>

          <Secao
            titulo="Diagnóstico OAuth externo"
            ajuda="O endpoint segue o formato esperado por clientes externos que partem da URL MCP e fazem o discovery OAuth sozinhos."
            divisoria
          >
            <dl className="divide-y divide-border sm:max-w-xl">
              <Row label="401 sem autenticação" value={<span className={juntar(etiqueta, "bg-primary/15 text-primary")}>Obrigatório</span>} />
              <Row label="WWW-Authenticate" value={<code>Bearer resource_metadata</code>} />
              <Row label="Expose headers" value={<code>WWW-Authenticate</code>} />
              <Row label="PRM público" value={<span className={juntar(etiqueta, "bg-primary/15 text-primary")}>JSON 200</span>} />
            </dl>
          </Secao>

          <Secao titulo="Agentes" descricao={`${AGENTS.length} modelos de conexão`} divisoria>
            <ul className="divide-y divide-border border-y border-border">
              {AGENTS.map(agent => (
                <li key={agent.id} className="flex min-w-0 items-start py-3">
                  <div className="mr-3 min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center">
                      <h4 className={juntar(texto.corpo, "mr-2 min-w-0 truncate font-semibold")}>{agent.name}</h4>
                      <span className={juntar(etiqueta, "uppercase", agent.auth === "oauth" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{agent.auth}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{agent.title}. {agent.description}</p>
                    <div className="-m-0.5 mt-1.5 flex flex-wrap">
                      {agent.defaultScopes.map(scope => <span key={scope} className={juntar(etiqueta, "m-0.5 border border-border font-mono text-muted-foreground")}>{scope}</span>)}
                    </div>
                  </div>
                  {agent.auth === "oauth" ? (
                    <button type="button" className={juntar(botao.secundario, "px-2.5 sm:px-3.5")} onClick={() => copyText(MCP_URL, "URL do ChatGPT copiada")} aria-label={`Copiar URL OAuth para ${agent.name}`}>
                      <Copy className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" /> <span className="hidden sm:inline">Copiar URL OAuth</span>
                    </button>
                  ) : (
                    <button type="button" className={juntar(botao.secundario, "px-2.5 sm:px-3.5")} onClick={() => { setAgentPreset(agent); setShowCreate(true); }} aria-label={`Gerar conexão para ${agent.name}`}>
                      <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" /> <span className="hidden sm:inline">Gerar conexão</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Secao>
        </TabsContent>

        {/* ── Credenciais ── */}
        <TabsContent value="credentials" className="mt-5">
          <Secao
            titulo="Credenciais"
            descricao={loadingKeys && keys.length === 0 ? undefined : `${mcpKeys.length} ${mcpKeys.length === 1 ? "credencial" : "credenciais"}`}
            acao={
              <label htmlFor="only-mcp" className="flex cursor-pointer select-none items-center text-[12px] text-muted-foreground">
                <Checkbox id="only-mcp" checked={showOnlyMcp} onCheckedChange={v => setShowOnlyMcp(v === true)} className="mr-2" />
                Só MCP
                <AjudaRecolhida className="ml-1">Mostra apenas credenciais MCP (audience ou origem = mcp).</AjudaRecolhida>
              </label>
            }
          >
            {loadingKeys && keys.length === 0 ? (
              <Carregando linhas={3} rotulo="Carregando credenciais" />
            ) : keysError && keys.length === 0 ? (
              <EstadoDeErro
                titulo="Não foi possível carregar as credenciais."
                descricao={keysError}
                acao={<button type="button" className={botao.secundario} onClick={loadKeys}>Tentar de novo</button>}
              />
            ) : mcpKeys.length === 0 ? (
              <EstadoVazio
                compacto
                titulo="Nenhuma credencial MCP."
                descricao="Crie uma para conectar agentes externos."
                acao={<button type="button" className={botao.discreto} onClick={novaConexao}>Nova conexão</button>}
              />
            ) : (
              <RegiaoRolavel rotulo="Credenciais MCP" memoria="api-docs:mcp:credenciais" className="lg:max-h-[70vh]">
                <ul className="divide-y divide-border border-y border-border">
                  {mcpKeys.map(k => {
                    const st = keyStatus(k);
                    return (
                      <li key={k.id} className="flex min-w-0 items-start py-3">
                        <div className="mr-3 min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center">
                            <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate font-semibold")}>{k.name}</span>
                            <span className={juntar(etiqueta, "mr-1.5", tones[st.tone])}>{st.label}</span>
                            {k.origin && <span className={juntar(etiqueta, "border border-border text-muted-foreground")}>origin: {k.origin}</span>}
                          </div>
                          <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                            <code className="font-mono text-foreground">{k.key_preview}</code>
                            {" · "}Criada {fmtDate(k.created_at)} · Uso {fmtDate(k.last_used_at)} · Expira {fmtDate(k.expires_at)}
                          </p>
                          <div className="-m-0.5 mt-1.5 flex flex-wrap">
                            {(k.scopes ?? []).map(s => (
                              <span key={s} className={juntar(etiqueta, "m-0.5 bg-muted font-mono text-muted-foreground")}>{s}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center [&>*+*]:ml-1">
                          <button type="button" className={botao.icone} onClick={() => setTestFor(k)} aria-label={`Testar ${k.name}`} title="Testar">
                            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" className={botao.icone} onClick={() => setRotateFor(k)} disabled={!!k.revoked_at} aria-label={`Rotacionar ${k.name}`} title="Rotacionar">
                            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" className={juntar(botao.icone, "hover:text-destructive disabled:opacity-40")} onClick={() => setRevokeFor(k)} disabled={!!k.revoked_at} aria-label={`Revogar ${k.name}`} title="Revogar">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </RegiaoRolavel>
            )}
          </Secao>
        </TabsContent>

        {/* ── Tools ── */}
        <TabsContent value="tools" className="mt-5">
          <Secao
            titulo="Tools registrados"
            descricao={discovery ? `${discovery.name}@${discovery.version}` : undefined}
            ajuda={
              <>
                O total vem do discovery público do servidor. O catálogo detalhado (nomes, descrições, escopos e o que cada credencial vê) exige Bearer válido e sai da tool <code>aceleriq_capabilities</code>. Use "Testar" numa credencial para ver o total visível para ela.
              </>
            }
          >
            {loadingDiscovery && !discovery ? (
              <Carregando linhas={1} rotulo="Lendo o servidor" />
            ) : (
              <p className="flex items-baseline">
                <span className="mr-2 text-[28px] font-semibold leading-8 tabular-nums text-primary">{discovery?.toolCount ?? 0}</span>
                <span className={texto.auxiliar}>tools expostos pelo servidor</span>
              </p>
            )}
          </Secao>
        </TabsContent>

        {/* ── Auditoria ── */}
        <TabsContent value="audit" className="mt-5">
          <Secao
            titulo="Auditoria MCP"
            descricao="Últimas 200 chamadas"
            acao={
              <button type="button" className={botao.icone} onClick={loadAudit} disabled={loadingAudit} aria-label="Atualizar auditoria MCP" title="Atualizar">
                <RefreshCw className={juntar("h-4 w-4", loadingAudit && "animate-spin")} aria-hidden="true" />
              </button>
            }
          >
            {loadingAudit && audit.length === 0 && !auditoriaLida ? (
              <Carregando linhas={6} rotulo="Carregando auditoria" />
            ) : auditError && audit.length === 0 ? (
              <EstadoDeErro
                titulo="Não foi possível carregar a auditoria."
                descricao={auditError}
                acao={<button type="button" className={botao.secundario} onClick={loadAudit}>Tentar de novo</button>}
              />
            ) : audit.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhuma chamada registrada." />
            ) : (
              <RegiaoRolavel rotulo="Chamadas do MCP" memoria="api-docs:mcp:auditoria" className="lg:max-h-[70vh]">
                <table className="hidden w-full min-w-0 md:table">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Quando</th>
                      <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Tool</th>
                      <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Chave</th>
                      <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Status</th>
                      <th scope="col" className={juntar(texto.rotulo, "py-2 text-right")}>ms</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[12px]">
                    {audit.map(a => (
                      <tr key={a.id} className="hover:bg-muted/40">
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted-foreground">{fmtDate(a.created_at)}</td>
                        <td className="py-2 pr-3 font-mono">{a.tool_name}</td>
                        <td className="max-w-[180px] truncate py-2 pr-3 text-muted-foreground">{a.key_id ? (keyById.get(a.key_id)?.name ?? a.key_id.slice(0, 8)) : "-"}</td>
                        <td className="py-2 pr-3">
                          {a.success
                            ? <span className={juntar(etiqueta, "bg-primary/15 text-primary")}>{a.status_code ?? 200}</span>
                            : <span className={juntar(etiqueta, "bg-destructive/15 text-destructive")} title={a.error_message ?? ""}>{a.status_code ?? "err"} · {a.error_code ?? "fail"}</span>}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">{a.duration_ms ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="divide-y divide-border md:hidden">
                  {audit.map(a => (
                    <li key={a.id} className="min-w-0 py-2.5">
                      <div className="flex min-w-0 items-center">
                        <code className="mr-2 min-w-0 flex-1 truncate font-mono text-[12.5px]">{a.tool_name}</code>
                        {a.success
                          ? <span className={juntar(etiqueta, "bg-primary/15 text-primary")}>{a.status_code ?? 200}</span>
                          : <span className={juntar(etiqueta, "bg-destructive/15 text-destructive")} title={a.error_message ?? ""}>{a.status_code ?? "err"} · {a.error_code ?? "fail"}</span>}
                      </div>
                      <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                        {fmtDate(a.created_at)} · {a.key_id ? (keyById.get(a.key_id)?.name ?? a.key_id.slice(0, 8)) : "-"} · {a.duration_ms ?? "-"} ms
                      </p>
                    </li>
                  ))}
                </ul>
              </RegiaoRolavel>
            )}
          </Secao>
        </TabsContent>
      </Tabs>

      {/* ── Create dialog ─────────────────────────────────── */}
      <CreateCredentialDialog
        open={showCreate}
        onOpenChange={o => { setShowCreate(o); if (!o) setAgentPreset(null); }}
        onCreate={createCredential}
        preset={agentPreset ? { name: agentPreset.defaultName, scopes: agentPreset.defaultScopes, expiresAt: null } : null}
        agent={agentPreset}
      />

      {/* ── Rotate dialog ─────────────────────────────────── */}
      <CreateCredentialDialog
        open={!!rotateFor}
        onOpenChange={o => !o && setRotateFor(null)}
        onCreate={async (name, scopes, exp) => {
          const created = await createCredential(name, scopes, exp);
          if (created && rotateFor) await revokeCredential(rotateFor);
          setRotateFor(null);
          return created;
        }}
        preset={rotateFor ? { name: `${rotateFor.name} (rotacionada)`, scopes: rotateFor.scopes ?? [], expiresAt: rotateFor.expires_at } : null}
        rotate
      />

      {/* ── Issued token modal (shown only once) ──────────── */}
      <Dialog open={!!issuedToken} onOpenChange={o => { if (!o) { setIssuedToken(null); setTokenRevealed(false); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className={juntar(texto.tituloSecao, "flex items-center")}>
              <ShieldCheck className="mr-2 h-4 w-4 text-primary" aria-hidden="true" /> Credencial criada
            </DialogTitle>
            <DialogDescription className="text-[12.5px] leading-5">
              <span className="font-medium text-warning">O token aparece só esta vez.</span> Guarde num local seguro (gerenciador de senhas, cofre da equipe). Depois de fechar, só dá para rotacionar ou revogar.
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1")}>Nome</p>
              <p className={texto.corpo}>{issuedName}</p>
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex min-w-0 items-center">
                <p className={juntar(texto.rotulo, "min-w-0 flex-1")}>Token completo</p>
                <button type="button" className={botao.discreto} onClick={() => setTokenRevealed(v => !v)}>
                  {tokenRevealed ? <><EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Ocultar</> : <><Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Revelar</>}
                </button>
              </div>
              <div className={juntar(superficie.poco, "break-all px-3 py-2 font-mono text-[12px] leading-5")}>
                {tokenRevealed ? issuedToken : "•".repeat(48)}
              </div>
            </div>
            <p className="flex items-start text-[12px] leading-5 text-muted-foreground">
              <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span>Só o hash SHA-256 e uma prévia de 12 caracteres foram gravados. O token nunca aparece em logs, auditoria ou banco.</span>
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
            <button type="button" className={botao.secundario} onClick={async () => {
              if (!issuedToken) return;
              try { await navigator.clipboard.writeText(issuedToken); toast.success("Copiado"); } catch { toast.error("Não foi possível copiar"); }
            }}>
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar token
            </button>
            <button type="button" className={botao.primario} onClick={() => { setIssuedToken(null); setTokenRevealed(false); }}>Concluí, guardei</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirm ────────────────────────────────── */}
      <ConfirmModal
        open={!!revokeFor}
        title="Revogar credencial"
        description={`A credencial "${revokeFor?.name}" será desativada imediatamente. Chamadas futuras retornarão 401. A ação é irreversível · para restaurar, crie uma nova credencial.`}
        confirmLabel="Revogar"
        onConfirm={async () => { if (revokeFor) await revokeCredential(revokeFor); setRevokeFor(null); }}
        onCancel={() => setRevokeFor(null)}
      />

      {/* ── Test connection dialog ────────────────────────── */}
      <TestConnectionDialog open={!!testFor} onOpenChange={o => !o && setTestFor(null)} keyName={testFor?.name ?? ""} />
    </div>
  );
}

/* ─── Status (um bloco de um nível, sem cartão dentro) ────── */
function StatusCard({
  icon, title, loading, ok, error, onRetry, children,
}: {
  icon: React.ReactNode; title: string; loading: boolean; ok: boolean; error: string | null; onRetry?: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={juntar(superficie.painel, "min-w-0 p-4")}>
      <div className="mb-2 flex min-w-0 items-center">
        <p className={juntar(texto.corpo, "mr-2 flex min-w-0 flex-1 items-center truncate font-semibold")}>
          <span className="mr-1.5 shrink-0 text-muted-foreground" aria-hidden="true">{icon}</span> {title}
        </p>
        {loading
          ? <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>Verificando</span>
          : ok
            ? <span className={juntar(etiqueta, "bg-primary/15 text-primary")}><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Online</span>
            : <span className={juntar(etiqueta, "bg-destructive/15 text-destructive")}><XCircle className="mr-1 h-3 w-3" aria-hidden="true" /> Offline</span>}
      </div>
      {loading ? (
        <Carregando linhas={3} rotulo={`Verificando ${title}`} />
      ) : (
        <>
          {error && (
            <div className="mb-2 flex min-w-0 items-center">
              <p className="mr-2 min-w-0 flex-1 truncate text-[12px] text-destructive">{error}</p>
              {onRetry && <button type="button" className={botao.discreto} onClick={onRetry}>Tentar de novo</button>}
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between py-1.5 text-[12px]">
      <dt className="mr-3 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}

/* ─── Create / Rotate dialog ─────────────────────────────── */
function CreateCredentialDialog({
  open, onOpenChange, onCreate, preset, rotate, agent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (name: string, scopes: string[], expiresAt: string | null) => Promise<any>;
  preset: { name: string; scopes: string[]; expiresAt: string | null } | null;
  rotate?: boolean;
  agent?: (typeof AGENTS)[number] | null;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["aceleriq:read"]);
  const [expiryPreset, setExpiryPreset] = useState<string>("90");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(preset?.name ?? "");
      setScopes(preset?.scopes?.length ? preset.scopes : ["aceleriq:read"]);
      setExpiryPreset("90");
      setSaving(false);
    }
  }, [open, preset]);

  const toggle = (id: string) =>
    setScopes(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Nome é obrigatório");
    if (scopes.length === 0) return toast.error("Selecione ao menos um escopo");
    setSaving(true);
    const days = expiryPreset === "never" ? null : parseInt(expiryPreset, 10);
    const expiresAt = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
    const created = await onCreate(name, scopes, expiresAt);
    setSaving(false);
    if (created) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className={texto.tituloSecao}>{rotate ? "Rotacionar credencial" : agent ? `Conectar ${agent.name}` : "Nova conexão MCP"}</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5">
            {rotate
              ? "Cria uma credencial nova com os mesmos escopos e revoga a anterior."
              : agent
                ? agent.description
                : "Gera um token seguro para um agente externo. Só o hash vai para o banco."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Nome descritivo" apoio="Agente e operador." obrigatorio>
              <input className={campo} placeholder="Ex: ChatGPT Work · Almir" value={name} onChange={e => setName(e.target.value)} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Expiração" apoio="Recomendado: 90 dias." obrigatorio>
              <Select value={expiryPreset} onValueChange={setExpiryPreset}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_PRESETS.map(p => (
                    <SelectItem key={String(p.days)} value={p.days === null ? "never" : String(p.days)}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CampoDeFormulario>
          </GrupoDeCampos>

          <fieldset className="min-w-0 border-0 p-0">
            <legend className={juntar(texto.rotulo, "mb-1.5 p-0")}>
              Escopos concedidos<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </legend>
            <ul className={juntar(superficie.poco, "divide-y divide-border")}>
              {SCOPES.map(s => (
                <li key={s.id}>
                  <label className="flex min-w-0 cursor-pointer items-start px-3 py-2 transition-colors hover:bg-muted">
                    <Checkbox checked={scopes.includes(s.id)} onCheckedChange={() => toggle(s.id)} className="mr-2.5 mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center">
                        <code className="mr-1.5 font-mono text-[12px] font-semibold">{s.label}</code>
                        {s.danger && <span className={juntar(etiqueta, "bg-warning/15 text-warning")}>sensível</span>}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">{s.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
        <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
          <button type="button" className={botao.secundario} onClick={() => onOpenChange(false)}>Cancelar</button>
          <button type="button" className={botao.primario} onClick={submit} disabled={saving}>
            {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Gerando...</> : rotate ? "Rotacionar" : "Gerar token"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Test connection dialog ─────────────────────────────── */
function TestConnectionDialog({ open, onOpenChange, keyName }: { open: boolean; onOpenChange: (o: boolean) => void; keyName: string }) {
  const [token, setToken] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; latencyMs?: number; toolCount?: number; error?: string; server?: string } | null>(null);

  useEffect(() => { if (open) { setToken(""); setResult(null); setRunning(false); } }, [open]);

  const run = async () => {
    if (!token.trim()) return toast.error("Cole o token gerado para essa credencial.");
    setRunning(true); setResult(null);
    const started = performance.now();
    try {
      const init = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": `Bearer ${token.trim()}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      if (!init.ok) throw new Error(`initialize HTTP ${init.status}`);
      const initBody = await init.json();
      if (initBody.error) throw new Error(initBody.error.message);
      const list = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": `Bearer ${token.trim()}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const listBody = await list.json();
      if (listBody.error) throw new Error(listBody.error.message);
      setResult({
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        toolCount: (listBody.result?.tools ?? []).length,
        server: `${initBody.result?.serverInfo?.name}@${initBody.result?.serverInfo?.version}`,
      });
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={juntar(texto.tituloSecao, "flex items-center")}><Zap className="mr-2 h-4 w-4 text-primary" aria-hidden="true" /> Testar conexão</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5">
            Credencial <span className="font-medium text-foreground">{keyName}</span>. Valida <code>initialize</code> e <code>tools/list</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario rotulo="Token" apoio="Não é gravado. Usado só nesta chamada.">
              <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="mcp_live_..." className={juntar(campo, "font-mono text-[12px]")} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          {result && (
            result.ok ? (
              <div className={juntar(superficie.poco, "px-3 py-2 text-[12px] leading-5")} role="status">
                <p className="flex items-center font-medium text-primary"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Conexão OK</p>
                <p className="text-muted-foreground">Servidor: <code className="text-foreground">{result.server}</code></p>
                <p className="text-muted-foreground">Tools visíveis: <span className="tabular-nums text-foreground">{result.toolCount}</span></p>
                <p className="text-muted-foreground">Latência: <span className="tabular-nums text-foreground">{result.latencyMs} ms</span></p>
              </div>
            ) : (
              <EstadoDeErro titulo="A conexão falhou." descricao={result.error} />
            )
          )}
        </div>
        <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
          <button type="button" className={botao.secundario} onClick={() => onOpenChange(false)}>Fechar</button>
          <button type="button" className={botao.primario} onClick={run} disabled={running || !token.trim()}>
            {running ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Testando...</> : "Testar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

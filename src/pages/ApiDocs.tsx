import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  Copy, Check, Shield, Zap, Code2, Key, Plus, Trash2,
  Eye, EyeOff, BookOpen, Terminal, AlertTriangle, Server, Hash,
  Globe, Lock, FileJson, ChevronDown, ChevronRight, CheckCircle2,
  Play, Loader2, Webhook, Activity, RefreshCw, Search, Settings2
} from "lucide-react";
import IntegrationsManager from "@/components/admin/IntegrationsManager";
import MCPManager from "@/components/admin/MCPManager";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { WEBHOOK_BASE } from "@/lib/webhooks";
import {
  AjudaRecolhida,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  Painel,
  RegiaoRolavel,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import {
  API_GATEWAY_ACTION_SCOPES,
  API_GATEWAY_AUDIENCE,
  API_GATEWAY_KEY_ORIGIN,
  API_GATEWAY_SCOPE_PRESETS,
  allowedApiGatewayActions,
  type ApiGatewayAction,
  type ApiGatewayScopePreset,
} from "../../supabase/functions/_shared/api-gateway-auth.ts";

const SUPABASE_FUNCTIONS_URL = `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, "")}/functions/v1`;
const GATEWAY_URL = `${SUPABASE_FUNCTIONS_URL}/api-gateway`;
const WEBHOOK_BASE_LABEL = WEBHOOK_BASE ?? "não configurada";
const webhookUrl = (route: string) => WEBHOOK_BASE
  ? `${WEBHOOK_BASE}/${route}`
  : "não configurada";

const gatewayPresetOptions: Record<ApiGatewayScopePreset, { label: string; description: string }> = {
  read_only: {
    label: "Somente leitura",
    description: "Consultas operacionais; sem gravações, exclusões, equipe ou auditoria.",
  },
  automation: {
    label: "Automação operacional",
    description: "Leitura e gravações operacionais; sem exclusões nem ações administrativas.",
  },
  administrator: {
    label: "Administração completa",
    description: "Inclui criação de clientes, exclusões, equipe e auditoria.",
  },
};

/* ─── Webhook Routes (real, from src/lib/webhooks.ts) ──── */
const webhookRoutes = [
  { name: "onboard-client", desc: "Dispara onboarding de novo cliente", trigger: "Criação de cliente via admin", payload: '{ client_id, full_name, email, company_name, plan_name }' },
  { name: "process-diagnostic", desc: "Processa diagnóstico/briefing respondido", trigger: "Submissão de briefing público", payload: '{ briefing_id, client_id, responses }' },
  { name: "meeting-to-plan", desc: "Converte anotações de reunião em plano de projeto", trigger: "Admin processa notas de reunião", payload: '{ meeting_notes, client_id, project_name }' },
  { name: "creative-approval", desc: "Notifica sobre aprovação/rejeição de criativo", trigger: "Cliente aprova ou rejeita arquivo", payload: '{ file_id, client_id, status, feedback }' },
  { name: "client-request-v2", desc: "Processa nova solicitação do cliente", trigger: "Cliente envia pedido via portal", payload: '{ request_id, client_id, title, description, priority }' },
  { name: "ads-recharge", desc: "Processa solicitação de recarga de ads", trigger: "Cliente solicita recarga de wallet", payload: '{ recharge_id, client_id, amount, platform }' },
];

/* ─── Edge Functions (real, from supabase/functions/) ──── */
const edgeFunctions = [
  { name: "api-gateway", desc: "Gateway unificado da API · ações CRUD escopadas", auth: "X-API-Key (SHA-256)", method: "POST", public: true },
  { name: "check-renewals", desc: "Verifica renovações de planos e marca inadimplentes", auth: "Sem JWT (cron)", method: "POST", public: true },
  { name: "check-task-reminders", desc: "Envia lembretes de tarefas próximas do vencimento", auth: "Sem JWT (cron)", method: "POST", public: true },
  { name: "manage-team", desc: "Gerencia membros da equipe (criar, atualizar roles)", auth: "Sem JWT (service role)", method: "POST", public: true },
  { name: "process-meeting-notes", desc: "Processa notas de reunião com IA para gerar projeto", auth: "Sem JWT (service role)", method: "POST", public: true },
];

/* ─── Action Docs ───────────────────────────────────────── */
const actionDocs: {
  category: string;
  icon: string;
  actions: {
    name: ApiGatewayAction;
    desc: string;
    required?: string[];
    optional?: string[];
    example: Record<string, any>;
    responseExample?: Record<string, any>;
  }[];
}[] = [
  {
    category: "Sistema",
    icon: "🔧",
    actions: [
      { name: "health", desc: "Verifica se o gateway está online", example: { action: "health" }, responseExample: { success: true, data: { status: "ok", version: "1.0", timestamp: "2026-03-10T12:00:00.000Z" } } },
      { name: "get_schema", desc: "Lista as ações permitidas para a chave atual", example: { action: "get_schema" }, responseExample: { success: true, data: { version: "1.1", actions: ["health", "get_schema", "list_clients"], required_scopes: { list_clients: "clients:read" } } } },
      { name: "list_audit_log", desc: "Lista logs de auditoria do gateway", optional: ["action", "ip_address", "limit"], example: { action: "list_audit_log", limit: 50 }, responseExample: { success: true, data: [{ id: "uuid", action: "list_clients", status_code: 200, key_name: "n8n-prod", ip_address: "187.x.x.x", created_at: "2026-03-10T12:00:00Z" }] } },
    ],
  },
  {
    category: "Clientes",
    icon: "👥",
    actions: [
      { name: "list_clients", desc: "Lista todos os clientes", optional: ["plan_status", "limit"], example: { action: "list_clients", limit: 10 }, responseExample: { success: true, data: [{ id: "uuid", full_name: "João Silva", email: "joao@empresa.com", company_name: "Empresa X", plan_status: "active", plan_name: "Pro", plan_value: 2500 }] } },
      { name: "get_client", desc: "Busca um cliente por ID", required: ["client_id"], example: { action: "get_client", client_id: "uuid-aqui" }, responseExample: { success: true, data: { id: "uuid", full_name: "João Silva", email: "joao@empresa.com", company_name: "Empresa X", plan_status: "active", phone: "11999999999" } } },
      { name: "create_client", desc: "Cria um novo cliente (cria conta + perfil)", required: ["email", "full_name"], optional: ["password", "company_name", "phone", "plan_name", "plan_value", "plan_renewal_date"], example: { action: "create_client", email: "novo@empresa.com", full_name: "João Silva", company_name: "Empresa X", plan_name: "Pro", plan_value: 2500 }, responseExample: { success: true, data: { id: "novo-uuid", email: "novo@empresa.com" } } },
      { name: "update_client", desc: "Atualiza dados de um cliente", required: ["client_id"], optional: ["full_name", "company_name", "phone", "plan_name", "plan_value", "plan_status", "plan_renewal_date"], example: { action: "update_client", client_id: "uuid", plan_status: "overdue" }, responseExample: { success: true, data: { id: "uuid", full_name: "João Silva", plan_status: "overdue" } } },
    ],
  },
  {
    category: "Projetos",
    icon: "📁",
    actions: [
      { name: "list_projects", desc: "Lista projetos", optional: ["client_id", "status", "limit"], example: { action: "list_projects", client_id: "uuid" }, responseExample: { success: true, data: [{ id: "uuid", name: "Site Novo", status: "active", progress: 45, project_type: "website", deadline: "2026-04-10" }] } },
      { name: "get_project", desc: "Busca projeto com milestones e tasks", required: ["project_id"], example: { action: "get_project", project_id: "uuid" }, responseExample: { success: true, data: { id: "uuid", name: "Site Novo", status: "active", progress: 45, milestones: [{ id: "uuid", title: "Entrega v1" }], tasks: [{ id: "uuid", title: "Landing page", status: "doing" }] } } },
      { name: "create_project", desc: "Cria um projeto; a autoria vem da identidade vinculada à chave", required: ["client_id", "name", "project_type", "start_date", "deadline"], optional: ["description", "objectives", "scope", "status"], example: { action: "create_project", client_id: "uuid", name: "Site Novo", project_type: "website", start_date: "2026-03-10", deadline: "2026-04-10" }, responseExample: { success: true, data: { id: "novo-uuid", name: "Site Novo", status: "planning", progress: 0 } } },
      { name: "update_project", desc: "Atualiza um projeto", required: ["project_id"], example: { action: "update_project", project_id: "uuid", status: "active", progress: 50 }, responseExample: { success: true, data: { id: "uuid", status: "active", progress: 50 } } },
      { name: "delete_project", desc: "Exclui um projeto", required: ["project_id"], example: { action: "delete_project", project_id: "uuid" }, responseExample: { success: true, data: { deleted: "uuid" } } },
    ],
  },
  {
    category: "Tarefas",
    icon: "✅",
    actions: [
      { name: "list_tasks", desc: "Lista tarefas", optional: ["project_id", "status", "assigned_to", "milestone_id", "limit"], example: { action: "list_tasks", project_id: "uuid", status: "doing" }, responseExample: { success: true, data: [{ id: "uuid", title: "Criar landing page", status: "doing", priority: "high", assigned_to: "uuid" }] } },
      { name: "get_task", desc: "Busca tarefa com comentários, checklist e anexos", required: ["task_id"], example: { action: "get_task", task_id: "uuid" }, responseExample: { success: true, data: { id: "uuid", title: "Landing page", status: "doing", task_comments: [], task_checklist_items: [], task_attachments: [] } } },
      { name: "create_task", desc: "Cria uma tarefa", required: ["project_id", "title"], optional: ["description", "status", "priority", "assigned_to", "due_date", "milestone_id", "task_order"], example: { action: "create_task", project_id: "uuid", title: "Criar landing page", priority: "high" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Criar landing page", status: "backlog", priority: "high" } } },
      { name: "update_task", desc: "Atualiza uma tarefa", required: ["task_id"], example: { action: "update_task", task_id: "uuid", status: "done" }, responseExample: { success: true, data: { id: "uuid", status: "done" } } },
      { name: "delete_task", desc: "Exclui uma tarefa", required: ["task_id"], example: { action: "delete_task", task_id: "uuid" }, responseExample: { success: true, data: { deleted: "uuid" } } },
    ],
  },
  {
    category: "Milestones",
    icon: "🏁",
    actions: [
      { name: "list_milestones", desc: "Lista milestones de um projeto", optional: ["project_id"], example: { action: "list_milestones", project_id: "uuid" }, responseExample: { success: true, data: [{ id: "uuid", title: "Entrega v1", status: "pending", target_date: "2026-04-01" }] } },
      { name: "create_milestone", desc: "Cria milestone", required: ["project_id", "title", "target_date"], optional: ["description", "milestone_order", "status"], example: { action: "create_milestone", project_id: "uuid", title: "Entrega v1", target_date: "2026-04-01" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Entrega v1", status: "pending" } } },
      { name: "update_milestone", desc: "Atualiza milestone", required: ["milestone_id"], example: { action: "update_milestone", milestone_id: "uuid", status: "completed" }, responseExample: { success: true, data: { id: "uuid", status: "completed" } } },
    ],
  },
  {
    category: "Relatórios",
    icon: "📊",
    actions: [
      { name: "list_reports", desc: "Lista relatórios", optional: ["client_id", "project_id", "status", "limit"], example: { action: "list_reports" }, responseExample: { success: true, data: [{ id: "uuid", title: "Relatório Março", status: "published", client_id: "uuid" }] } },
      { name: "create_report", desc: "Cria relatório; a autoria vem da identidade vinculada à chave", required: ["client_id", "project_id", "title"], optional: ["summary", "highlights", "next_steps", "metrics", "chart_data", "chart_type", "period_start", "period_end", "status", "internal_notes"], example: { action: "create_report", client_id: "uuid", project_id: "uuid", title: "Relatório Março" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Relatório Março", status: "draft" } } },
      { name: "update_report", desc: "Atualiza relatório", required: ["report_id"], example: { action: "update_report", report_id: "uuid", status: "published" }, responseExample: { success: true, data: { id: "uuid", status: "published" } } },
    ],
  },
  {
    category: "Financeiro",
    icon: "💰",
    actions: [
      { name: "list_billing", desc: "Lista cobranças", optional: ["client_id", "status", "limit"], example: { action: "list_billing", status: "pending" }, responseExample: { success: true, data: [{ id: "uuid", amount: 2500, status: "pending", due_date: "2026-04-01", type: "mensalidade" }] } },
      { name: "create_billing", desc: "Cria cobrança", required: ["client_id", "amount", "due_date", "type"], optional: ["description", "status", "platform"], example: { action: "create_billing", client_id: "uuid", amount: 2500, due_date: "2026-04-01", type: "mensalidade" }, responseExample: { success: true, data: { id: "novo-uuid", amount: 2500, status: "pending" } } },
      { name: "update_billing", desc: "Atualiza cobrança", required: ["billing_id"], example: { action: "update_billing", billing_id: "uuid", status: "paid", paid_date: "2026-03-09" }, responseExample: { success: true, data: { id: "uuid", status: "paid", paid_date: "2026-03-09" } } },
      { name: "list_payments", desc: "Lista pagamentos de projetos com parcelas", optional: ["client_id", "project_id", "limit"], example: { action: "list_payments", client_id: "uuid" }, responseExample: { success: true, data: [{ id: "uuid", total_value: 5000, entry_amount: 2500, installments_count: 3, payment_installments: [] }] } },
    ],
  },
  {
    category: "Notificações",
    icon: "🔔",
    actions: [
      { name: "send_notification", desc: "Envia notificação para um usuário", required: ["user_id", "message", "notification_type"], optional: ["link"], example: { action: "send_notification", user_id: "uuid", message: "Novo arquivo disponível!", notification_type: "update", link: "/aprovacoes" }, responseExample: { success: true, data: { id: "novo-uuid", message: "Novo arquivo disponível!", read: false } } },
      { name: "list_notifications", desc: "Lista notificações de um usuário", required: ["user_id"], optional: ["read", "limit"], example: { action: "list_notifications", user_id: "uuid", read: false }, responseExample: { success: true, data: [{ id: "uuid", message: "Arquivo aprovado", notification_type: "approval", read: false, created_at: "2026-03-10T12:00:00Z" }] } },
      { name: "mark_notification_read", desc: "Marca uma notificação como lida", required: ["notification_id"], example: { action: "mark_notification_read", notification_id: "uuid" }, responseExample: { success: true, data: { id: "uuid", read: true } } },
    ],
  },
  {
    category: "Pedidos & Briefings",
    icon: "📋",
    actions: [
      { name: "list_requests", desc: "Lista pedidos de clientes", optional: ["client_id", "status", "limit"], example: { action: "list_requests", status: "new" }, responseExample: { success: true, data: [{ id: "uuid", title: "Novo post", status: "new", priority: "normal", client_id: "uuid" }] } },
      { name: "create_request", desc: "Cria pedido", required: ["client_id", "title", "description"], optional: ["priority", "project_id"], example: { action: "create_request", client_id: "uuid", title: "Novo post", description: "Preciso de um post para Instagram" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Novo post", status: "new" } } },
      { name: "update_request", desc: "Atualiza pedido", required: ["request_id"], example: { action: "update_request", request_id: "uuid", status: "done" }, responseExample: { success: true, data: { id: "uuid", status: "done" } } },
      { name: "list_briefings", desc: "Lista briefings", optional: ["client_id", "submitted", "limit"], example: { action: "list_briefings" }, responseExample: { success: true, data: [{ id: "uuid", client_id: "uuid", submitted: true, token: "abc123" }] } },
      { name: "get_briefing", desc: "Busca briefing por ID", required: ["briefing_id"], example: { action: "get_briefing", briefing_id: "uuid" }, responseExample: { success: true, data: { id: "uuid", responses: {}, submitted: true, client_id: "uuid" } } },
    ],
  },
  {
    category: "Feeds & Arquivos",
    icon: "📂",
    actions: [
      { name: "create_update", desc: "Cria update no feed de um projeto", required: ["project_id", "author_id", "message", "update_type"], example: { action: "create_update", project_id: "uuid", author_id: "uuid", message: "Deploy realizado!", update_type: "milestone" }, responseExample: { success: true, data: { id: "novo-uuid", message: "Deploy realizado!", update_type: "milestone" } } },
      { name: "list_files", desc: "Lista arquivos", optional: ["client_id", "project_id", "approval_status", "limit"], example: { action: "list_files", project_id: "uuid" }, responseExample: { success: true, data: [{ id: "uuid", file_name: "banner.png", approval_status: "pending", file_url: "https://..." }] } },
      { name: "update_file", desc: "Atualiza somente metadados internos seguros", required: ["file_id"], example: { action: "update_file", file_id: "uuid", description: "Nova descrição interna" }, responseExample: { success: true, data: { id: "uuid", description: "Nova descrição interna" } } },
    ],
  },
  {
    category: "Ads & Wallet",
    icon: "📢",
    actions: [
      { name: "get_wallet", desc: "Busca carteira de ads do cliente", required: ["client_id"], example: { action: "get_wallet", client_id: "uuid" }, responseExample: { success: true, data: [{ id: "uuid", platform: "meta", balance: 1500, last_recharge_date: "2026-03-01" }] } },
      { name: "update_wallet", desc: "Atualiza saldo da carteira", required: ["wallet_id"], example: { action: "update_wallet", wallet_id: "uuid", balance: 1500 }, responseExample: { success: true, data: { id: "uuid", balance: 1500 } } },
      { name: "list_recharges", desc: "Lista solicitações de recarga", optional: ["client_id", "status"], example: { action: "list_recharges", status: "pending" }, responseExample: { success: true, data: [{ id: "uuid", amount: 500, platform: "meta", status: "pending" }] } },
      { name: "update_recharge", desc: "Atualiza status de recarga", required: ["recharge_id"], example: { action: "update_recharge", recharge_id: "uuid", status: "approved" }, responseExample: { success: true, data: { id: "uuid", status: "approved" } } },
    ],
  },
  {
    category: "Equipe & Checklist",
    icon: "👨‍💻",
    actions: [
      { name: "list_team", desc: "Lista membros da equipe (exceto clientes)", example: { action: "list_team" }, responseExample: { success: true, data: [{ user_id: "uuid", role: "design", profiles: { full_name: "Ana Designer", email: "ana@equipe.com" } }] } },
      { name: "create_comment", desc: "Adiciona comentário a uma tarefa", required: ["task_id", "author_id", "content"], example: { action: "create_comment", task_id: "uuid", author_id: "uuid", content: "Ficou ótimo!" }, responseExample: { success: true, data: { id: "novo-uuid", content: "Ficou ótimo!", created_at: "2026-03-10T12:00:00Z" } } },
      { name: "create_checklist_item", desc: "Adiciona item; a autoria vem da identidade vinculada à chave", required: ["task_id", "title"], optional: ["item_order"], example: { action: "create_checklist_item", task_id: "uuid", title: "Revisar cores" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Revisar cores", checked: false } } },
      { name: "update_checklist_item", desc: "Atualiza item de checklist", required: ["item_id"], example: { action: "update_checklist_item", item_id: "uuid", checked: true }, responseExample: { success: true, data: { id: "uuid", checked: true } } },
    ],
  },
];

const totalActions = actionDocs.reduce((sum, cat) => sum + cat.actions.length, 0);

/* ─── Copy Button ───────────────────────────────────────── */
function CopyButton({ text, className = "", rotulo = "Copiar" }: { text: string; className?: string; rotulo?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className={juntar(botao.icone, "h-7 w-7", className)}
      title={rotulo}
      aria-label={rotulo}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

/* ─── Code Block (poço, sem cartão) ─────────────────────── */
function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  return (
    <div className="group relative min-w-0" data-linguagem={language}>
      <pre className={juntar(superficie.poco, "overflow-x-auto whitespace-pre-wrap p-3 pr-10 font-mono text-[11.5px] leading-5 [overflow-wrap:anywhere]")}>{code}</pre>
      <div className="absolute right-1.5 top-1.5 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><CopyButton text={code} rotulo="Copiar código" /></div>
    </div>
  );
}

/* ─── Valor copiável em uma linha (endereço, header) ────── */
function Copiavel({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className={juntar(superficie.poco, "flex min-w-0 items-center py-1 pl-3 pr-1")}>
      <code className="mr-2 min-w-0 flex-1 font-mono text-[11.5px] leading-5 [overflow-wrap:anywhere]">{valor}</code>
      <CopyButton text={valor} rotulo={rotulo} />
    </div>
  );
}

/** Nome técnico curto no meio do texto (tabela, rota, coluna). */
const codigo = "rounded bg-muted px-1 font-mono text-[12px] text-foreground";
const aviso = "flex min-w-0 items-center rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-muted-foreground";

/* ─── SHA-256 ───────────────────────────────────────────── */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `acq_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/* ─── API Keys Management ───────────────────────────────── */
function ApiKeysSection() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPreset, setNewKeyPreset] = useState<ApiGatewayScopePreset>("read_only");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchKeys = async () => {
    const { data, error } = await supabase.from("api_keys" as any).select("*").order("created_at", { ascending: false });
    setLoadError(error ? error.message : null);
    setKeys(((data as any[]) || []).filter((key) =>
      key.audience === API_GATEWAY_AUDIENCE
      || (key.audience == null && String(key.origin ?? "").toLowerCase() !== "mcp")
    ));
    setLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setCreatedKey(null);
    let incompleteKeyId: string | null = null;

    const discardIncompleteKey = async (keyId: string) => {
      const { error: revokeError } = await supabase
        .from("api_keys")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          client_scope_mode: "none",
        })
        .eq("id", keyId);
      const { error: removeError } = await supabase
        .from("api_keys")
        .delete()
        .eq("id", keyId);
      return !revokeError || !removeError;
    };

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        toast.error("Não foi possível confirmar o administrador atual.");
        return;
      }

      const rawKey = generateKey();
      const keyHash = await sha256(rawKey);
      const keyPreview = rawKey.slice(0, 8) + "..." + rawKey.slice(-4);
      const scopes = [...API_GATEWAY_SCOPE_PRESETS[newKeyPreset]];

      const { data: insertedKey, error: insertError } = await supabase
        .from("api_keys")
        .insert({
          name: newKeyName.trim(),
          key_hash: keyHash,
          key_preview: keyPreview,
          audience: API_GATEWAY_AUDIENCE,
          origin: API_GATEWAY_KEY_ORIGIN,
          scopes,
          created_by: userData.user.id,
          client_scope_mode: "none",
        })
        .select("id")
        .single();

      if (insertError || !insertedKey) {
        toast.error("Não foi possível criar a chave.");
        return;
      }
      incompleteKeyId = insertedKey.id;

      const { error: scopeError } = await supabase.rpc(
        "configure_api_gateway_key_scope",
        {
          p_key_id: insertedKey.id,
          p_scope_mode: "all",
          p_client_ids: [],
        },
      );

      if (scopeError) {
        const discarded = await discardIncompleteKey(insertedKey.id);

        toast.error(
          discarded
            ? "A chave não foi ativada; o registro incompleto foi revogado."
            : "A chave não foi ativada e precisa ser revisada na lista.",
        );
        await fetchKeys();
        return;
      }

      incompleteKeyId = null;
      setCreatedKey(rawKey);
      await fetchKeys();
    } catch {
      if (incompleteKeyId) {
        await discardIncompleteKey(incompleteKeyId);
        await fetchKeys();
      }
      toast.error("Não foi possível concluir a criação segura da chave.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from("api_keys" as any).delete().eq("id", deleteId);
    setDeleteId(null);
    fetchKeys();
    toast.success("Chave revogada com sucesso");
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    await supabase.from("api_keys" as any).update({ is_active: !currentActive } as any).eq("id", id);
    fetchKeys();
    toast.success(currentActive ? "Chave desativada" : "Chave ativada");
  };

  const issuedScopes = API_GATEWAY_SCOPE_PRESETS[newKeyPreset];
  const issuedActions = allowedApiGatewayActions({
    audience: API_GATEWAY_AUDIENCE,
    origin: API_GATEWAY_KEY_ORIGIN,
    scopes: issuedScopes,
    keyId: "api-key-preview",
    ownerId: "api-key-owner",
    ownerIsAdmin: true,
    scope: "all",
    clientIds: [],
  });

  const abrirCriacao = () => { setShowCreate(true); setNewKeyName(""); setNewKeyPreset("read_only"); setCreatedKey(null); };

  return (
    <Secao
      titulo="Chaves de API"
      descricao={loading ? undefined : `${keys.length} ${keys.length === 1 ? "chave" : "chaves"}`}
      ajuda="Cada integração usa a própria chave. A chave aparece só uma vez, na criação; o banco guarda apenas o hash."
      acao={
        <button type="button" className={botao.primario} onClick={abrirCriacao}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Nova chave
        </button>
      }
    >
      {keys.some((key) => key.audience !== API_GATEWAY_AUDIENCE) && (
        <div className={juntar(aviso, "mb-3")}>
          <p className="min-w-0 truncate font-medium text-foreground">Rotação obrigatória para chaves legadas</p>
          <AjudaRecolhida className="ml-1.5" rotulo="Por que rotacionar">
            Chaves sem audiência explícita ficam bloqueadas pelo gateway. Gere uma nova com o perfil mínimo, atualize a integração e revogue a antiga.
          </AjudaRecolhida>
        </div>
      )}

      {loading && keys.length === 0 ? (
        <Carregando linhas={3} rotulo="Carregando chaves" />
      ) : loadError && keys.length === 0 ? (
        <EstadoDeErro
          titulo="Não foi possível carregar as chaves."
          descricao={loadError}
          acao={<button type="button" className={botao.secundario} onClick={() => fetchKeys()}>Tentar de novo</button>}
        />
      ) : keys.length === 0 ? (
        <EstadoVazio
          compacto
          titulo="Nenhuma chave criada ainda."
          descricao="Crie a primeira para começar a integrar."
          acao={<button type="button" className={botao.discreto} onClick={abrirCriacao}>Nova chave</button>}
        />
      ) : (
        <RegiaoRolavel rotulo="Chaves de API" memoria="api-docs:chaves" className="lg:max-h-[70vh]">
          <ul className="divide-y divide-border border-y border-border">
            {keys.map((k: any) => (
              <li key={k.id} className="flex min-w-0 items-center py-2.5">
                <div className="mr-3 min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center">
                    <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate font-medium")}>{k.name}</span>
                    <span className={juntar(etiqueta, "mr-1.5", k.is_active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      {k.is_active ? "Ativa" : "Inativa"}
                    </span>
                    {k.audience !== API_GATEWAY_AUDIENCE && (
                      <span className={juntar(etiqueta, "bg-warning/15 text-warning")}>Rotação necessária</span>
                    )}
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={(k.scopes ?? []).join(", ")}>
                    <code className="font-mono">{k.key_preview}</code>
                    {" · "}audience: <code>{k.audience ?? "não definida"}</code>
                    {" · "}origin: <code>{k.origin ?? "não definida"}</code>
                    {" · "}{(k.scopes ?? []).length} escopos
                    {k.last_used_at ? ` · Último uso: ${new Date(k.last_used_at).toLocaleDateString("pt-BR")}` : ""}
                    {" · "}Criada: {new Date(k.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center [&>*+*]:ml-1">
                  {k.audience === API_GATEWAY_AUDIENCE && (
                    <button
                      type="button"
                      className={botao.icone}
                      onClick={() => handleToggle(k.id, k.is_active)}
                      title={k.is_active ? "Desativar" : "Ativar"}
                      aria-label={k.is_active ? `Desativar ${k.name}` : `Ativar ${k.name}`}
                    >
                      {k.is_active ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                  )}
                  <button
                    type="button"
                    className={juntar(botao.icone, "hover:text-destructive")}
                    onClick={() => setDeleteId(k.id)}
                    title="Revogar"
                    aria-label={`Revogar ${k.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </RegiaoRolavel>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className={texto.tituloSecao}>{createdKey ? "Chave criada" : "Nova chave de API"}</DialogTitle>
            {createdKey && (
              <DialogDescription className="text-[12.5px]">
                Copie agora. <span className="font-medium text-destructive">A chave não será exibida novamente.</span>
              </DialogDescription>
            )}
          </DialogHeader>
          {createdKey ? (
            <div className="min-w-0 space-y-4">
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Chave</p>
                <Copiavel valor={createdKey} rotulo="Copiar chave" />
              </div>
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Base URL</p>
                <Copiavel valor={GATEWAY_URL} rotulo="Copiar base URL" />
              </div>
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Perfil e escopos</p>
                <div className={juntar(superficie.poco, "space-y-1 px-3 py-2 text-[11.5px] leading-5")}>
                  <p className="font-medium text-foreground">{gatewayPresetOptions[newKeyPreset].label}</p>
                  <p className="text-muted-foreground">
                    audience: <code>{API_GATEWAY_AUDIENCE}</code> · origin: <code>{API_GATEWAY_KEY_ORIGIN}</code>
                  </p>
                  <code className="block max-h-20 overflow-y-auto break-all text-muted-foreground">
                    {issuedScopes.join(", ")}
                  </code>
                </div>
              </div>
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Headers obrigatórios</p>
                <div className={juntar(superficie.poco, "space-y-1 px-3 py-2 font-mono text-[11.5px] leading-5")}>
                  <p><span className="text-primary">Content-Type:</span> application/json</p>
                  <p><span className="text-primary">X-API-Key:</span> {createdKey.slice(0, 12)}...</p>
                </div>
              </div>
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Exemplo rápido (cURL)</p>
                <CodeBlock
                  language="bash"
                  code={`curl -X POST "${GATEWAY_URL}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: ${createdKey}" \\\n  -d '{"action": "health"}'`}
                />
              </div>

              <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
                <button
                  type="button"
                  className={botao.secundario}
                  onClick={() => {
                    const allInfo = `=== Aceleriq API - Dados de Integração ===

Base URL: ${GATEWAY_URL}
Método: POST (todas as ações)
Audience: ${API_GATEWAY_AUDIENCE}
Origin: ${API_GATEWAY_KEY_ORIGIN}
Escopos: ${issuedScopes.join(", ")}

Headers:
  Content-Type: application/json
  X-API-Key: ${createdKey}

Formato do Body:
  { "action": "nome_da_acao", ...parametros }

Exemplo cURL:
  curl -X POST "${GATEWAY_URL}" \\
    -H "Content-Type: application/json" \\
    -H "X-API-Key: ${createdKey}" \\
    -d '{"action": "health"}'

Ações autorizadas: ${issuedActions.join(", ")}.
Use "get_schema" para consultar as ações autorizadas para esta chave.`;
                    navigator.clipboard.writeText(allInfo);
                    toast.success("Todas as informações copiadas");
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar tudo
                </button>
                <button type="button" className={botao.primario} onClick={() => { setShowCreate(false); setCreatedKey(null); }}>
                  Entendi, copiei
                </button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 space-y-4">
              <GrupoDeCampos colunas={1}>
                <CampoDeFormulario rotulo="Nome da chave" apoio="Onde a chave será usada." obrigatorio>
                  <input
                    id="key-name"
                    className={campo}
                    placeholder="Ex: n8n Produção, OpenClaw, Zapier..."
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </CampoDeFormulario>
                <CampoDeFormulario
                  rotulo="Perfil de acesso"
                  apoio={gatewayPresetOptions[newKeyPreset].description}
                  ajuda="Cada ação também verifica seu escopo específico."
                >
                  <Select value={newKeyPreset} onValueChange={(value) => setNewKeyPreset(value as ApiGatewayScopePreset)}>
                    <SelectTrigger id="key-profile" className="h-9 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(gatewayPresetOptions) as ApiGatewayScopePreset[]).map((preset) => (
                        <SelectItem key={preset} value={preset}>{gatewayPresetOptions[preset].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CampoDeFormulario>
              </GrupoDeCampos>
              <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
                <button type="button" className={botao.secundario} onClick={() => setShowCreate(false)}>Cancelar</button>
                <button type="button" className={botao.primario} onClick={handleCreate} disabled={!newKeyName.trim() || creating}>
                  {creating ? "Criando..." : "Gerar chave"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!deleteId}
        title="Revogar API Key"
        description="Essa ação é irreversível. Qualquer integração usando esta chave perderá acesso imediatamente."
        confirmLabel="Revogar"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </Secao>
  );
}

/* ─── Live API Tester ───────────────────────────────────── */
function ApiTester() {
  // A chave nunca é guardada no navegador; ação e parâmetros são rascunho e voltam ao reabrir.
  const [apiKey, setApiKey] = useState("");
  const [actionName, setActionName] = useEstadoDaTela<string>("api-docs:teste:acao", "health", {
    validar: (v) => typeof v === "string" && Object.prototype.hasOwnProperty.call(API_GATEWAY_ACTION_SCOPES, v),
  });
  const [paramsText, setParamsText] = useEstadoDaTela<string>("api-docs:teste:parametros", "{}", {
    validar: (v) => typeof v === "string",
  });
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const allActions = actionDocs.flatMap(c => c.actions.map(a => a.name)).sort();

  const handleTest = async () => {
    if (!apiKey.trim()) { toast.error("Insira sua API Key"); return; }
    setLoading(true);
    setResponse(null);
    setStatusCode(null);
    const start = performance.now();

    try {
      let extraParams = {};
      try { extraParams = JSON.parse(paramsText); } catch { toast.error("JSON de parâmetros inválido"); setLoading(false); return; }

      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ action: actionName, ...extraParams }),
      });

      setStatusCode(res.status);
      setElapsed(Math.round(performance.now() - start));
      const json = await res.json();
      setResponse(JSON.stringify(json, null, 2));
    } catch (err: any) {
      setResponse(JSON.stringify({ error: err.message }, null, 2));
      setElapsed(Math.round(performance.now() - start));
    }
    setLoading(false);
  };

  // When action changes, prefill params
  const handleActionChange = (action: string) => {
    setActionName(action);
    const found = actionDocs.flatMap(c => c.actions).find(a => a.name === action);
    if (found) {
      const { action: _, ...rest } = found.example;
      setParamsText(Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "{}");
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <Painel
        titulo="Testar ao vivo"
        rodape={
          <>
            <code className={juntar(texto.auxiliar, "mr-auto min-w-0 flex-1 truncate font-mono")}>POST {GATEWAY_URL}</code>
            <button type="button" className={botao.primario} onClick={handleTest} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Executar
            </button>
          </>
        }
      >
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="API Key" apoio="Usada só nesta chamada. Não fica salva.">
            <input type="password" autoComplete="off" placeholder="acq_SuaChaveAqui..." value={apiKey} onChange={e => setApiKey(e.target.value)} className={juntar(campo, "font-mono text-[12px]")} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Ação">
            <Select value={actionName} onValueChange={handleActionChange}>
              <SelectTrigger className="h-9 font-mono text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {allActions.map(a => <SelectItem key={a} value={a} className="font-mono text-[12px]">{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Parâmetros (JSON)" largo>
            <textarea
              className={juntar(campoTexto, "resize-y font-mono text-[12px]")}
              value={paramsText}
              onChange={e => setParamsText(e.target.value)}
              spellCheck={false}
            />
          </CampoDeFormulario>
        </GrupoDeCampos>
      </Painel>

      {response && (
        <Secao
          titulo={
            <span className="inline-flex items-center">
              Resposta
              {statusCode && (
                <span className={juntar(etiqueta, "ml-2", statusCode === 200 ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")}>
                  {statusCode}
                </span>
              )}
            </span>
          }
          descricao={elapsed !== null ? `${elapsed} ms` : undefined}
        >
          <CodeBlock code={response} />
        </Secao>
      )}
    </div>
  );
}

/* ─── Audit Log Viewer ──────────────────────────────────── */
function AuditLogViewer() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useEstadoDaTela<string>("api-docs:auditoria:acao", "", { validar: (v) => typeof v === "string" });
  const [limit, setLimit] = useEstadoDaTela<number>("api-docs:auditoria:limite", 50, { validar: (v) => v === 25 || v === 50 || v === 100 });
  const [carregouUmaVez, setCarregouUmaVez] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("api_audit_log" as any).select("*").order("created_at", { ascending: false }).limit(limit);
    if (filterAction) q = q.eq("action", filterAction);
    const { data, error } = await q;
    setLoadError(error ? error.message : null);
    setLogs((data as any[]) || []);
    setLoading(false);
    setCarregouUmaVez(true);
  }, [filterAction, limit]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const statusColor = (code: number | null) => {
    if (!code) return "text-muted-foreground";
    if (code >= 200 && code < 300) return "text-primary";
    if (code >= 400 && code < 500) return "text-warning";
    return "text-destructive";
  };

  const quando = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <Secao
      titulo="Auditoria"
      descricao={carregouUmaVez ? `${logs.length} registros` : undefined}
      ajuda="Cada chamada ao gateway: ação, status, chave, IP e erro."
      acao={
        <button type="button" className={botao.icone} onClick={fetchLogs} aria-label="Atualizar auditoria" title="Atualizar">
          <RefreshCw className={juntar("h-4 w-4", loading && carregouUmaVez && "animate-spin")} aria-hidden="true" />
        </button>
      }
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-center">
        <div className="relative mb-2 mr-2 min-w-0 flex-1 sm:max-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            placeholder="Filtrar por ação..."
            aria-label="Filtrar por ação"
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className={juntar(campo, "pl-8 font-mono text-[12px]")}
          />
        </div>
        <div className="mb-2 shrink-0">
          <SeletorCompacto
            rotulo="Quantidade"
            valor={String(limit)}
            onEscolher={(v) => setLimit(Number(v))}
            opcoes={[
              { valor: "25", rotulo: "25" },
              { valor: "50", rotulo: "50" },
              { valor: "100", rotulo: "100" },
            ]}
          />
        </div>
      </div>

      {loading && !carregouUmaVez ? (
        <Carregando linhas={6} rotulo="Carregando auditoria" />
      ) : loadError ? (
        <EstadoDeErro
          titulo="Não foi possível carregar a auditoria."
          descricao={loadError}
          acao={<button type="button" className={botao.secundario} onClick={fetchLogs}>Tentar de novo</button>}
        />
      ) : logs.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhum registro encontrado." />
      ) : (
        <RegiaoRolavel rotulo="Registros da auditoria" memoria="api-docs:auditoria" className="lg:max-h-[70vh]">
          <table className="hidden w-full min-w-0 md:table">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Data</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Ação</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-right")}>Status</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Chave</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>IP</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 text-left")}>Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[12px]">
              {logs.map((log: any) => (
                <tr key={log.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted-foreground">{quando(log.created_at)}</td>
                  <td className="py-2 pr-3"><code className="font-mono text-primary">{log.action}</code></td>
                  <td className={juntar("py-2 pr-3 text-right font-semibold tabular-nums", statusColor(log.status_code))}>{log.status_code || "-"}</td>
                  <td className="max-w-[180px] truncate py-2 pr-3 text-muted-foreground">{log.key_name || "-"}</td>
                  <td className="py-2 pr-3 font-mono text-muted-foreground">{log.ip_address || "-"}</td>
                  <td className="max-w-[220px] truncate py-2 text-destructive" title={log.error_message || ""}>{log.error_message || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-border md:hidden">
            {logs.map((log: any) => (
              <li key={log.id} className="min-w-0 py-2.5">
                <div className="flex min-w-0 items-center">
                  <code className="mr-2 min-w-0 flex-1 truncate font-mono text-[12.5px] text-primary">{log.action}</code>
                  <span className={juntar("shrink-0 text-[12px] font-semibold tabular-nums", statusColor(log.status_code))}>{log.status_code || "-"}</span>
                </div>
                <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                  {quando(log.created_at)} · {log.key_name || "-"} · {log.ip_address || "-"}
                </p>
                {log.error_message && <p className="mt-0.5 truncate text-[12px] text-destructive">{log.error_message}</p>}
              </li>
            ))}
          </ul>
        </RegiaoRolavel>
      )}
    </Secao>
  );
}

/* ─── Endpoint Reference (collapsible) ──────────────────── */
function ActionCategory({ cat, isOpen, onToggle }: { cat: typeof actionDocs[0]; isOpen: boolean; onToggle: () => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        className={juntar("flex w-full min-w-0 items-center py-3 text-left transition-colors hover:bg-muted/40", foco)}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>{cat.category}</span>
        <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{cat.actions.length}</span>
      </button>
      {isOpen && (
        <ul className="mb-3 divide-y divide-border pl-6">
          {cat.actions.map((a) => (
            <li key={a.name} className="min-w-0 space-y-2 py-3">
              <div className="flex min-w-0 flex-wrap items-center">
                <span className={juntar(etiqueta, "mr-2 border border-border font-mono text-muted-foreground")}>POST</span>
                <code className="mr-2 font-mono text-[12.5px] font-semibold text-primary">{a.name}</code>
                <span className={juntar(etiqueta, "mr-2 bg-muted font-mono text-muted-foreground")}>{API_GATEWAY_ACTION_SCOPES[a.name]}</span>
                <span className="min-w-0 text-[12.5px] text-muted-foreground">{a.desc}</span>
              </div>
              {a.required && (
                <p className="text-[12px] leading-5 text-muted-foreground">
                  <span className="font-medium">Obrigatório:</span>{" "}
                  {a.required.map(f => <code key={f} className="mx-0.5 rounded bg-destructive/15 px-1 font-mono text-destructive">{f}</code>)}
                </p>
              )}
              {a.optional && (
                <p className="text-[12px] leading-5 text-muted-foreground">
                  <span className="font-medium">Opcional:</span>{" "}
                  {a.optional.map(f => <code key={f} className="mx-0.5 rounded bg-muted px-1 font-mono">{f}</code>)}
                </p>
              )}
              <div className="grid min-w-0 gap-2 md:grid-cols-2">
                <div className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1")}>Request</p>
                  <CodeBlock code={JSON.stringify(a.example, null, 2)} />
                </div>
                {a.responseExample && (
                  <div className="min-w-0">
                    <p className={juntar(texto.rotulo, "mb-1")}>Response</p>
                    <CodeBlock code={JSON.stringify(a.responseExample, null, 2)} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* ─── Main Page ─────────────────────────────────────────── */
const SECOES_DA_PAGINA = ["overview", "keys", "endpoints", "webhooks", "examples", "tester", "audit", "security", "integrations", "mcp"] as const;
type SecaoDaPagina = (typeof SECOES_DA_PAGINA)[number];

export default function ApiDocs() {
  const [secao, setSecao] = useEstadoDaTela<SecaoDaPagina>("api-docs:secao", "overview", {
    validar: (v) => typeof v === "string" && (SECOES_DA_PAGINA as readonly string[]).indexOf(v) >= 0,
  });
  const [expandedCat, setExpandedCat] = useEstadoDaTela<string | null>("api-docs:endpoints:aberta", null, {
    validar: (v) => typeof v === "string",
  });

  const opcoesDeSecao = [
    { valor: "overview", rotulo: "Visão geral", icone: <BookOpen className="h-3.5 w-3.5" /> },
    { valor: "keys", rotulo: "Chaves de API", icone: <Key className="h-3.5 w-3.5" /> },
    { valor: "endpoints", rotulo: "Endpoints", icone: <Code2 className="h-3.5 w-3.5" />, contador: totalActions },
    { valor: "webhooks", rotulo: "Webhooks e funções", icone: <Webhook className="h-3.5 w-3.5" /> },
    { valor: "examples", rotulo: "Exemplos", icone: <Terminal className="h-3.5 w-3.5" /> },
    { valor: "tester", rotulo: "Testar API", icone: <Play className="h-3.5 w-3.5" /> },
    { valor: "audit", rotulo: "Auditoria", icone: <Activity className="h-3.5 w-3.5" /> },
    { valor: "security", rotulo: "Segurança", icone: <Lock className="h-3.5 w-3.5" /> },
    { valor: "integrations", rotulo: "Integrações", icone: <Settings2 className="h-3.5 w-3.5" /> },
    { valor: "mcp", rotulo: "MCP", icone: <Server className="h-3.5 w-3.5" /> },
  ];

  const curlExample = `curl -X POST "${GATEWAY_URL}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: acq_SuaChaveAqui..." \\
  -d '{"action": "health"}'`;

  const curlCreateClient = `curl -X POST "${GATEWAY_URL}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: acq_SuaChaveAqui..." \\
  -d '{
    "action": "create_client",
    "email": "cliente@empresa.com",
    "full_name": "Maria Santos",
    "company_name": "Empresa ABC",
    "plan_name": "Pro",
    "plan_value": 2500
  }'`;

  const jsExample = `const response = await fetch("${GATEWAY_URL}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "acq_SuaChaveAqui..."
  },
  body: JSON.stringify({
    action: "list_clients",
    limit: 50
  })
});

const { success, data } = await response.json();`;

  const pythonExample = `import requests

response = requests.post(
    "${GATEWAY_URL}",
    headers={
        "Content-Type": "application/json",
        "X-API-Key": "acq_SuaChaveAqui..."
    },
    json={
        "action": "list_projects",
        "client_id": "uuid-do-cliente"
    }
)

data = response.json()
print(data["data"])`;

  const n8nExample = `Configuração do HTTP Request Node:

Método: POST
URL: ${GATEWAY_URL}

Headers:
  Content-Type: application/json
  X-API-Key: {{ $credentials.apiKey }}

Body (JSON):
{
  "action": "list_clients",
  "limit": 50
}`;

  const responseSuccess = `{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "full_name": "João Silva",
    "email": "joao@empresa.com",
    "company_name": "Empresa X",
    "plan_status": "active"
  }
}`;

  const responseError = `{
  "success": false,
  "error": "Missing required fields: client_id"
}`;

  const responseAuth = `// 401 - Chave inválida ou ausente
{
  "success": false,
  "error": "Invalid API key."
}

// 403 - Audience, origin ou escopo incompatível
{
  "success": false,
  "error": "API key is not authorized for this action."
}

// 404 - Ação não encontrada
{
  "success": false,
  "error": "Unknown action \\"xyz\\". Use get_schema to list available actions."
}`;

  const exemplos = [
    { titulo: "cURL · Health check", icone: <Terminal className="h-3.5 w-3.5" />, code: curlExample, language: "bash" },
    { titulo: "cURL · Criar cliente", icone: <Terminal className="h-3.5 w-3.5" />, code: curlCreateClient, language: "bash" },
    { titulo: "JavaScript / TypeScript", icone: <Code2 className="h-3.5 w-3.5" />, code: jsExample, language: "js" },
    { titulo: "Python", icone: <Code2 className="h-3.5 w-3.5" />, code: pythonExample, language: "python" },
    { titulo: "n8n · HTTP Request Node", icone: <Zap className="h-3.5 w-3.5" />, code: n8nExample, language: "text" },
  ];

  const kpis = [
    { rotulo: "Base URL", icone: <Globe className="h-3.5 w-3.5" />, corpo: <Copiavel valor={GATEWAY_URL} rotulo="Copiar base URL" /> },
    { rotulo: "Método", icone: <FileJson className="h-3.5 w-3.5" />, corpo: <p className={texto.corpo}><span className="font-mono font-semibold">POST</span> <span className="text-muted-foreground">· ação no body JSON</span></p> },
    { rotulo: "Autenticação", icone: <Shield className="h-3.5 w-3.5" />, corpo: <p className={texto.corpo}><code className={codigo}>X-API-Key</code> <span className="text-muted-foreground">· hash SHA-256</span></p> },
    { rotulo: "Ações", icone: <Hash className="h-3.5 w-3.5" />, corpo: <p className={texto.corpo}><span className="text-[15px] font-semibold tabular-nums text-primary">{totalActions}</span> <span className="text-muted-foreground">· {actionDocs.length} categorias + {webhookRoutes.length} webhooks</span></p> },
  ];

  const referencia: { rotulo: string; valor: ReactNode }[] = [
    { rotulo: "Base URL (API Gateway)", valor: <Copiavel valor={GATEWAY_URL} rotulo="Copiar base URL" /> },
    { rotulo: "Base URL (Webhooks)", valor: <Copiavel valor={WEBHOOK_BASE_LABEL} rotulo="Copiar base dos webhooks" /> },
    { rotulo: "Método HTTP", valor: <><code className={codigo}>POST</code> (todas as rotas)</> },
    { rotulo: "Header de auth", valor: <code className={codigo}>X-API-Key</code> },
    { rotulo: "Formato do body", valor: <code className={codigo}>{`{ "action": "...", ...params }`}</code> },
    { rotulo: "Prefixo das chaves", valor: <><code className={codigo}>acq_</code> + 32 bytes aleatórios (68 caracteres)</> },
    { rotulo: "Validação", valor: <>SHA-256 → tabela <code className={codigo}>api_keys</code> → RPC <code className={codigo}>validate_api_key_for_audience</code> → escopo da ação</> },
    { rotulo: "Infraestrutura", valor: <>{totalActions} ações API + {webhookRoutes.length} webhooks + {edgeFunctions.length} edge functions</> },
  ];

  const variaveis = [
    { nome: "VITE_SUPABASE_URL", tipo: "Frontend", perigo: false, uso: "Base pública do backend e dos endpoints derivados" },
    { nome: "VITE_WEBHOOK_URL", tipo: "Frontend + Secret", perigo: false, uso: "Base URL dos webhooks n8n" },
    { nome: "EXTERNAL_API_KEY", tipo: "Secret", perigo: false, uso: "Compatibilidade temporária, limitada a health/get_schema; deve ser rotacionada e removida" },
    { nome: "SUPABASE_SERVICE_ROLE_KEY", tipo: "Secret", perigo: true, uso: "Usada pelo gateway para acesso elevado ao banco" },
    { nome: "AI_API_KEY / OPENAI_API_KEY", tipo: "Secret", perigo: false, uso: "Credencial do provedor de IA OpenAI-compatible" },
  ];

  const garantias = [
    { icone: <Shield className="h-3.5 w-3.5" />, titulo: "Chaves com hash", texto: "Geradas com CSPRNG e guardadas como hash SHA-256. A chave original nunca é salva." },
    { icone: <Eye className="h-3.5 w-3.5" />, titulo: "Auditoria completa", texto: "Cada chamada registra ação, IP, status HTTP, nome da chave e erro." },
    { icone: <Lock className="h-3.5 w-3.5" />, titulo: "RLS em todas as tabelas", texto: "api_keys e api_audit_log acessíveis só por admins." },
    { icone: <Key className="h-3.5 w-3.5" />, titulo: "Service role isolado", texto: "Handlers só rodam depois de validar audiência, origem e escopo da ação." },
  ];

  const praticas = [
    "Use uma chave diferente para cada integração (n8n, OpenClaw, etc.).",
    "Nunca compartilhe a API Key em repositórios públicos ou chats.",
    "Monitore o \"Último uso\" e a auditoria com frequência.",
    "Revogue chaves que não são mais usadas.",
    "Rotacione toda chave legada sem audience/origin e remova o fallback após a migração.",
    "Chaves desativadas retornam 401 na hora, sem processar.",
  ];

  const tabelasDoBanco = [
    { nome: "api_keys", texto: "key_hash, audience, origin, scopes, expiração, revogação e último uso" },
    { nome: "api_audit_log", texto: "id, action, ip_address, status_code, params, key_name, error_message, created_at" },
    { nome: "validate_api_key_for_audience()", texto: "RPC restrita a service_role que valida hash, audience, atividade, expiração e revogação" },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina
        titulo="API e integrações"
        ajuda="Documentação da infraestrutura real da Aceleriq: rotas, autenticação, webhooks, chaves, auditoria e testes ao vivo."
        acoes={
          <SeletorCompacto
            rotulo="Seção"
            icone={<BookOpen className="h-3.5 w-3.5" />}
            opcoes={opcoesDeSecao}
            valor={secao}
            onEscolher={(v) => setSecao(v as SecaoDaPagina)}
            modo="lista"
          />
        }
      />

      <Tabs value={secao} onValueChange={(v) => setSecao(v as SecaoDaPagina)} className="w-full min-w-0">
        {/* ── Visão geral ─────────────────────────────────── */}
        <TabsContent value="overview" className="mt-0 space-y-6">
          <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.rotulo} className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-2 flex items-center")}>
                  <span className="mr-1.5 text-primary" aria-hidden="true">{k.icone}</span>
                  {k.rotulo}
                </p>
                {k.corpo}
              </div>
            ))}
          </div>

          <Secao titulo="Arquitetura" ajuda="Três camadas de integração em produção." divisoria>
            <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-3">
              <li className="min-w-0">
                <p className={juntar(texto.corpo, "font-medium")}>API Gateway</p>
                <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">Função única (<code className={codigo}>api-gateway</code>) com {totalActions} ações via POST, audiência e escopo por ação.</p>
              </li>
              <li className="min-w-0">
                <p className={juntar(texto.corpo, "font-medium")}>Webhooks n8n</p>
                <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{webhookRoutes.length} rotas de automação. Base: <code className={codigo}>{WEBHOOK_BASE_LABEL}</code></p>
              </li>
              <li className="min-w-0">
                <p className={juntar(texto.corpo, "font-medium")}>Edge Functions</p>
                <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{edgeFunctions.length} funções de backend (cron, IA, gestão de equipe).</p>
              </li>
            </ul>
          </Secao>

          <Secao titulo="Formato das respostas" divisoria>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-1 flex items-center text-[12px] font-medium text-primary"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Sucesso (200)</p>
                <CodeBlock code={responseSuccess} />
              </div>
              <div className="min-w-0">
                <p className="mb-1 flex items-center text-[12px] font-medium text-destructive"><AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" /> Erro (400/401/500)</p>
                <CodeBlock code={responseError} />
              </div>
            </div>
          </Secao>

          <Secao titulo="Headers obrigatórios" divisoria>
            <ul className="divide-y divide-border">
              <li className="grid min-w-0 grid-cols-1 gap-1 py-2 sm:grid-cols-[180px_200px_minmax(0,1fr)] sm:gap-3">
                <code className={juntar(codigo, "justify-self-start")}>Content-Type</code>
                <code className="font-mono text-[12px] text-muted-foreground">application/json</code>
                <span className="text-[12.5px] text-muted-foreground">Obrigatório em todas as requisições.</span>
              </li>
              <li className="grid min-w-0 grid-cols-1 gap-1 py-2 sm:grid-cols-[180px_200px_minmax(0,1fr)] sm:gap-3">
                <code className={juntar(codigo, "justify-self-start")}>X-API-Key</code>
                <code className="font-mono text-[12px] text-muted-foreground">acq_xxx...</code>
                <span className="text-[12.5px] text-muted-foreground">Chave criada em "Chaves de API". Hash SHA-256 validado no banco.</span>
              </li>
            </ul>
          </Secao>

          <Secao titulo="Tabelas acessíveis pela API" divisoria>
            <div className="-m-0.5 flex min-w-0 flex-wrap">
              {["profiles", "projects", "tasks", "milestones", "files", "reports", "billing", "notifications",
                "client_requests", "briefings", "updates", "ads_wallet", "recharge_requests", "project_payments",
                "payment_installments", "task_comments", "task_checklist_items", "task_attachments", "user_roles",
                "api_keys", "api_audit_log"].map(t => (
                <span key={t} className={juntar(etiqueta, "m-0.5 bg-muted font-mono text-muted-foreground")}>{t}</span>
              ))}
            </div>
          </Secao>

          <Secao titulo="Referência rápida" divisoria>
            <dl className="divide-y divide-border">
              {referencia.map((r) => (
                <div key={r.rotulo} className="grid min-w-0 grid-cols-1 gap-1 py-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-3">
                  <dt className={texto.rotulo}>{r.rotulo}</dt>
                  <dd className="min-w-0 text-[12.5px] leading-5 text-muted-foreground">{r.valor}</dd>
                </div>
              ))}
            </dl>
          </Secao>
        </TabsContent>

        {/* ── Chaves ──────────────────────────────────────── */}
        <TabsContent value="keys" className="mt-0">
          <ApiKeysSection />
        </TabsContent>

        {/* ── Endpoints ───────────────────────────────────── */}
        <TabsContent value="endpoints" className="mt-0">
          <Secao
            titulo="Endpoints"
            descricao={<>{totalActions} ações via <code className="font-mono">POST</code> no gateway</>}
            ajuda={<>Todas as ações vão para <code className="font-mono">{GATEWAY_URL}</code> com o nome da ação no body.</>}
            acao={
              <button type="button" className={botao.secundario} onClick={() => setExpandedCat(expandedCat ? null : "__all__")}>
                {expandedCat === "__all__" ? "Fechar todos" : "Expandir todos"}
              </button>
            }
          >
            <ul className="divide-y divide-border border-y border-border">
              {actionDocs.map((cat) => (
                <ActionCategory
                  key={cat.category}
                  cat={cat}
                  isOpen={expandedCat === cat.category || expandedCat === "__all__"}
                  onToggle={() => setExpandedCat(expandedCat === cat.category ? null : cat.category)}
                />
              ))}
            </ul>
          </Secao>
        </TabsContent>

        {/* ── Webhooks e funções ──────────────────────────── */}
        <TabsContent value="webhooks" className="mt-0 space-y-6">
          <Secao
            titulo="Webhooks n8n"
            descricao={`${webhookRoutes.length} rotas`}
            ajuda={<>Configurados em <code className="font-mono">src/lib/webhooks.ts</code> e disparados pelo painel via <code className="font-mono">fireWebhook()</code>.</>}
          >
            <div className="mb-3 flex min-w-0 items-center">
              <span className={juntar(texto.rotulo, "mr-2 shrink-0")}>Base URL</span>
              <div className="min-w-0 flex-1 sm:max-w-xl"><Copiavel valor={WEBHOOK_BASE_LABEL} rotulo="Copiar base dos webhooks" /></div>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {webhookRoutes.map(w => (
                <li key={w.name} className="min-w-0 space-y-2 py-3">
                  <div className="flex min-w-0 flex-wrap items-center">
                    <span className={juntar(etiqueta, "mr-2 border border-border font-mono text-muted-foreground")}>POST</span>
                    <code className="mr-2 font-mono text-[12.5px] font-semibold text-primary">/{w.name}</code>
                    <span className="min-w-0 text-[12.5px] text-muted-foreground">{w.desc}</span>
                  </div>
                  <p className={texto.auxiliar}><span className="font-medium text-foreground">Gatilho:</span> {w.trigger}</p>
                  <div className="grid min-w-0 gap-2 md:grid-cols-2">
                    <div className="min-w-0">
                      <p className={juntar(texto.rotulo, "mb-1")}>URL completa</p>
                      <Copiavel valor={webhookUrl(w.name)} rotulo={`Copiar URL de ${w.name}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={juntar(texto.rotulo, "mb-1")}>Payload esperado</p>
                      <CodeBlock code={w.payload} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo="Edge Functions" descricao={`${edgeFunctions.length} funções`} ajuda={<>Funções de backend em <code className="font-mono">supabase/functions/</code>.</>} divisoria>
            <ul className="divide-y divide-border border-y border-border">
              {edgeFunctions.map(ef => (
                <li key={ef.name} className="min-w-0 space-y-1.5 py-3">
                  <div className="flex min-w-0 flex-wrap items-center">
                    <code className="mr-2 font-mono text-[12.5px] font-semibold text-primary">{ef.name}</code>
                    <span className={juntar(etiqueta, "mr-2 bg-muted text-muted-foreground")}>{ef.auth}</span>
                    <span className="min-w-0 text-[12.5px] text-muted-foreground">{ef.desc}</span>
                  </div>
                  <div className="sm:max-w-3xl"><Copiavel valor={`${SUPABASE_FUNCTIONS_URL}/${ef.name}`} rotulo={`Copiar URL de ${ef.name}`} /></div>
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo="Variáveis de ambiente" divisoria>
            <ul className="divide-y divide-border border-y border-border">
              {variaveis.map((v) => (
                <li key={v.nome} className="grid min-w-0 grid-cols-1 gap-1 py-2.5 sm:grid-cols-[260px_140px_minmax(0,1fr)] sm:items-center sm:gap-3">
                  <code className="min-w-0 truncate font-mono text-[12px] text-foreground">{v.nome}</code>
                  <span><span className={juntar(etiqueta, v.perigo ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{v.tipo}</span></span>
                  <span className="text-[12.5px] leading-5 text-muted-foreground">{v.uso}</span>
                </li>
              ))}
            </ul>
          </Secao>
        </TabsContent>

        {/* ── Exemplos ────────────────────────────────────── */}
        <TabsContent value="examples" className="mt-0">
          <Secao titulo="Exemplos">
            <div className="space-y-5">
              {exemplos.map((ex) => (
                <div key={ex.titulo} className="min-w-0">
                  <h3 className="mb-1.5 flex items-center text-[13px] font-semibold text-foreground">
                    <span className="mr-1.5 text-muted-foreground" aria-hidden="true">{ex.icone}</span>
                    {ex.titulo}
                  </h3>
                  <CodeBlock code={ex.code} language={ex.language} />
                </div>
              ))}
            </div>
          </Secao>
        </TabsContent>

        {/* ── Testar ──────────────────────────────────────── */}
        <TabsContent value="tester" className="mt-0">
          <ApiTester />
        </TabsContent>

        {/* ── Auditoria ───────────────────────────────────── */}
        <TabsContent value="audit" className="mt-0">
          <AuditLogViewer />
        </TabsContent>

        {/* ── Segurança ───────────────────────────────────── */}
        <TabsContent value="security" className="mt-0 space-y-6">
          <Secao titulo="Fluxo de autenticação">
            <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px] leading-5 text-muted-foreground marker:text-primary">
              <li>Admin gera 32 bytes aleatórios com <code className={codigo}>crypto.getRandomValues()</code></li>
              <li>A chave é hasheada com SHA-256 e salva com <code className={codigo}>audience=api-gateway</code>, origem e escopos explícitos</li>
              <li>A cada request, o gateway hasheia a chave recebida via <code className={codigo}>X-API-Key</code></li>
              <li>Executa RPC <code className={codigo}>validate_api_key_for_audience(_key_hash, "api-gateway")</code></li>
              <li>Confere a origem permitida e o escopo mínimo da ação; qualquer combinação não mapeada é negada</li>
              <li>Chave inválida retorna 401; audiência, origem ou escopo incompatível retorna 403</li>
              <li>Atualiza <code className={codigo}>last_used_at</code> e registra no <code className={codigo}>api_audit_log</code></li>
            </ol>
            <div className={juntar(aviso, "mt-4")}>
              <p className="min-w-0 truncate font-medium text-foreground">Rotacione credenciais legadas</p>
              <AjudaRecolhida className="ml-1.5" rotulo="Como rotacionar">
                Chaves sem audiência/origem explícitas são recusadas. A chave de ambiente legada fica restrita à descoberta. Gere substitutas escopadas, atualize os consumidores, revogue as antigas e retire o fallback.
              </AjudaRecolhida>
            </div>
          </Secao>

          <Secao titulo="Respostas de erro de autenticação" divisoria>
            <CodeBlock code={responseAuth} />
          </Secao>

          <Secao titulo="Garantias" divisoria>
            <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {garantias.map((g) => (
                <li key={g.titulo} className="flex min-w-0 items-start">
                  <span className="mr-2 mt-0.5 shrink-0 text-primary" aria-hidden="true">{g.icone}</span>
                  <span className="min-w-0">
                    <span className={juntar(texto.corpo, "block font-medium")}>{g.titulo}</span>
                    <span className="block text-[12.5px] leading-5 text-muted-foreground">{g.texto}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo="Boas práticas" divisoria>
            <ul className="space-y-1.5">
              {praticas.map((p) => (
                <li key={p} className="flex min-w-0 items-start text-[12.5px] leading-5 text-muted-foreground">
                  <CheckCircle2 className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> <span className="min-w-0">{p}</span>
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo="Estrutura no banco" divisoria>
            <ul className="divide-y divide-border border-y border-border">
              {tabelasDoBanco.map((t) => (
                <li key={t.nome} className="grid min-w-0 grid-cols-1 gap-1 py-2.5 sm:grid-cols-[260px_minmax(0,1fr)] sm:gap-3">
                  <code className="min-w-0 truncate font-mono text-[12px] font-semibold text-primary">{t.nome}</code>
                  <span className="text-[12.5px] leading-5 text-muted-foreground">{t.texto}</span>
                </li>
              ))}
            </ul>
          </Secao>
        </TabsContent>

        {/* ── Integrações salvas ──────────────────────────── */}
        <TabsContent value="integrations" className="mt-0">
          <IntegrationsManager />
        </TabsContent>

        {/* ── MCP ─────────────────────────────────────────── */}
        <TabsContent value="mcp" className="mt-0">
          <MCPManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import {
  Copy, Check, ExternalLink, Shield, Zap, Code2, Key, Plus, Trash2,
  Eye, EyeOff, BookOpen, Terminal, AlertTriangle, Server, Clock, Hash,
  Globe, Lock, FileJson, ChevronDown, ChevronRight, Info, CheckCircle2,
  Play, Loader2, Webhook, Database, Activity, RefreshCw, Search, Settings2
} from "lucide-react";
import IntegrationsManager from "@/components/admin/IntegrationsManager";
import MCPManager from "@/components/admin/MCPManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const GATEWAY_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/api-gateway`;
const WEBHOOK_BASE = import.meta.env.VITE_WEBHOOK_URL || "https://n8n.srv1353465.hstgr.cloud/webhook";

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
  { name: "api-gateway", desc: "Gateway unificado da API — 44 ações CRUD", auth: "X-API-Key (SHA-256)", method: "POST", public: true },
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
    name: string;
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
      { name: "get_schema", desc: "Lista todas as ações disponíveis", example: { action: "get_schema" }, responseExample: { success: true, data: { version: "1.0", actions: ["health", "get_schema", "list_clients", "...44 total"], docs: "POST with { action, ...params }" } } },
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
      { name: "create_project", desc: "Cria um projeto", required: ["client_id", "name", "project_type", "start_date", "deadline"], optional: ["description", "objectives", "scope", "status", "created_by"], example: { action: "create_project", client_id: "uuid", name: "Site Novo", project_type: "website", start_date: "2026-03-10", deadline: "2026-04-10" }, responseExample: { success: true, data: { id: "novo-uuid", name: "Site Novo", status: "planning", progress: 0 } } },
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
      { name: "create_report", desc: "Cria relatório", required: ["client_id", "project_id", "title"], optional: ["summary", "highlights", "next_steps", "metrics", "chart_data", "chart_type", "period_start", "period_end", "status", "created_by", "internal_notes"], example: { action: "create_report", client_id: "uuid", project_id: "uuid", title: "Relatório Março" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Relatório Março", status: "draft" } } },
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
      { name: "update_file", desc: "Atualiza arquivo (aprovação, feedback)", required: ["file_id"], example: { action: "update_file", file_id: "uuid", approval_status: "approved" }, responseExample: { success: true, data: { id: "uuid", approval_status: "approved" } } },
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
      { name: "create_checklist_item", desc: "Adiciona item de checklist", required: ["task_id", "created_by", "title"], optional: ["item_order"], example: { action: "create_checklist_item", task_id: "uuid", created_by: "uuid", title: "Revisar cores" }, responseExample: { success: true, data: { id: "novo-uuid", title: "Revisar cores", checked: false } } },
      { name: "update_checklist_item", desc: "Atualiza item de checklist", required: ["item_id"], example: { action: "update_checklist_item", item_id: "uuid", checked: true }, responseExample: { success: true, data: { id: "uuid", checked: true } } },
    ],
  },
];

const totalActions = actionDocs.reduce((sum, cat) => sum + cat.actions.length, 0);

/* ─── Copy Button ───────────────────────────────────────── */
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className={`p-1 rounded hover:bg-secondary transition-colors ${className}`}
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

/* ─── Code Block ────────────────────────────────────────── */
function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <pre className="text-[11px] bg-secondary/80 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">{code}</pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><CopyButton text={code} /></div>
    </div>
  );
}

/* ─── SHA-256 ───────────────────────────────────────────── */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "acq_";
  for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

/* ─── API Keys Management ───────────────────────────────── */
function ApiKeysSection() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchKeys = async () => {
    const { data } = await supabase.from("api_keys" as any).select("*").order("created_at", { ascending: false });
    setKeys((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const rawKey = generateKey();
    const keyHash = await sha256(rawKey);
    const keyPreview = rawKey.slice(0, 8) + "..." + rawKey.slice(-4);
    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase.from("api_keys" as any).insert({
      name: newKeyName.trim(),
      key_hash: keyHash,
      key_preview: keyPreview,
      created_by: userData.user?.id,
    } as any);

    if (error) {
      toast.error("Erro ao criar chave: " + error.message);
    } else {
      setCreatedKey(rawKey);
      fetchKeys();
    }
    setCreating(false);
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

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Key className="w-4 h-4 text-primary" /> Suas API Keys</h3>
        <Button size="sm" onClick={() => { setShowCreate(true); setNewKeyName(""); setCreatedKey(null); }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Nova Chave
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : keys.length === 0 ? (
        <Card className="bg-secondary/30 border-dashed border-border">
          <CardContent className="py-8 text-center">
            <Key className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma chave criada ainda.</p>
            <p className="text-xs text-muted-foreground mt-1">Crie sua primeira API Key para começar a integrar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {keys.map((k: any) => (
            <div key={k.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{k.name}</span>
                  <Badge variant={k.is_active ? "default" : "secondary"} className="text-[10px]">
                    {k.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <code className="text-[11px] text-muted-foreground">{k.key_preview}</code>
                  {k.last_used_at && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Último uso: {new Date(k.last_used_at).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    Criada: {new Date(k.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggle(k.id, k.is_active)} title={k.is_active ? "Desativar" : "Ativar"}>
                  {k.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(k.id)} title="Revogar">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdKey ? "🔑 Chave Criada!" : "Nova API Key"}</DialogTitle>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Copie estas informações agora. <span className="text-destructive font-medium">A chave não será exibida novamente.</span>
              </p>

              {/* API Key */}
              <div>
                <Label className="text-xs font-semibold">🔑 API Key</Label>
                <div className="flex items-center gap-2 p-2 bg-secondary rounded-lg mt-1">
                  <code className="text-xs flex-1 break-all select-all font-mono">{createdKey}</code>
                  <CopyButton text={createdKey} />
                </div>
              </div>

              {/* Base URL */}
              <div>
                <Label className="text-xs font-semibold">🌐 Base URL</Label>
                <div className="flex items-center gap-2 p-2 bg-secondary rounded-lg mt-1">
                  <code className="text-[11px] flex-1 break-all select-all font-mono">{GATEWAY_URL}</code>
                  <CopyButton text={GATEWAY_URL} />
                </div>
              </div>

              {/* Headers */}
              <div>
                <Label className="text-xs font-semibold">📋 Headers obrigatórios</Label>
                <div className="mt-1 p-2 bg-secondary rounded-lg space-y-1 text-[11px] font-mono">
                  <div className="flex items-center justify-between">
                    <span><span className="text-primary">Content-Type:</span> application/json</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span><span className="text-primary">X-API-Key:</span> {createdKey.slice(0, 12)}...</span>
                  </div>
                </div>
              </div>

              {/* Quick example */}
              <div>
                <Label className="text-xs font-semibold">⚡ Exemplo rápido (cURL)</Label>
                <div className="relative group mt-1">
                  <pre className="text-[10px] bg-secondary p-2 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">{`curl -X POST "${GATEWAY_URL}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${createdKey}" \\
  -d '{"action": "health"}'`}</pre>
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={`curl -X POST "${GATEWAY_URL}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: ${createdKey}" \\\n  -d '{"action": "health"}'`} />
                  </div>
                </div>
              </div>

              {/* Copy all button */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs flex-1"
                  onClick={() => {
                    const allInfo = `=== Aceleriq API - Dados de Integração ===

Base URL: ${GATEWAY_URL}
Método: POST (todas as ações)

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

Ações disponíveis: health, get_schema, list_clients, create_client, list_projects, create_project, list_tasks, create_task, etc.
Use "get_schema" para listar todas as ${totalActions} ações.`;
                    navigator.clipboard.writeText(allInfo);
                    toast.success("Todas as informações copiadas!");
                  }}
                >
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copiar tudo
                </Button>
                <Button size="sm" className="flex-1" onClick={() => { setShowCreate(false); setCreatedKey(null); }}>
                  Entendi, copiei!
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="key-name">Nome da chave</Label>
                <Input
                  id="key-name"
                  placeholder="Ex: n8n Produção, OpenClaw, Zapier..."
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Use um nome que identifique onde a chave será usada.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={!newKeyName.trim() || creating}>
                  {creating ? "Criando..." : "Gerar Chave"}
                </Button>
              </DialogFooter>
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
    </>
  );
}

/* ─── Live API Tester ───────────────────────────────────── */
function ApiTester() {
  const [apiKey, setApiKey] = useState("");
  const [actionName, setActionName] = useState("health");
  const [paramsText, setParamsText] = useState("{}");
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
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Play className="w-4 h-4 text-primary" /> Testar API ao Vivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">API Key</Label>
            <Input type="password" placeholder="acq_SuaChaveAqui..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ação</Label>
              <Select value={actionName} onValueChange={handleActionChange}>
                <SelectTrigger className="text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {allActions.map(a => <SelectItem key={a} value={a} className="text-xs font-mono">{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Parâmetros (JSON)</Label>
              <textarea
                className="w-full text-xs font-mono bg-secondary border border-border rounded-md p-2 min-h-[60px] resize-y"
                value={paramsText}
                onChange={e => setParamsText(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleTest} disabled={loading} size="sm">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
              Executar
            </Button>
            <code className="text-[10px] text-muted-foreground">POST {GATEWAY_URL}</code>
          </div>
        </CardContent>
      </Card>

      {response && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Resposta
              {statusCode && (
                <Badge variant={statusCode === 200 ? "default" : "destructive"} className="text-[10px]">
                  {statusCode}
                </Badge>
              )}
              {elapsed !== null && <span className="text-[10px] text-muted-foreground font-normal">{elapsed}ms</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock code={response} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Audit Log Viewer ──────────────────────────────────── */
function AuditLogViewer() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [limit, setLimit] = useState(50);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("api_audit_log" as any).select("*").order("created_at", { ascending: false }).limit(limit);
    if (filterAction) q = q.eq("action", filterAction);
    const { data } = await q;
    setLogs((data as any[]) || []);
    setLoading(false);
  }, [filterAction, limit]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const statusColor = (code: number | null) => {
    if (!code) return "text-muted-foreground";
    if (code >= 200 && code < 300) return "text-green-500";
    if (code >= 400 && code < 500) return "text-yellow-500";
    return "text-destructive";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Filtrar por ação..."
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="max-w-[200px] text-xs"
        />
        <Select value={String(limit)} onValueChange={v => setLimit(Number(v))}>
          <SelectTrigger className="w-[100px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 logs</SelectItem>
            <SelectItem value="50">50 logs</SelectItem>
            <SelectItem value="100">100 logs</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={fetchLogs} className="text-xs">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Atualizar
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">{logs.length} registros</span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : logs.length === 0 ? (
        <Card className="bg-secondary/30 border-dashed border-border">
          <CardContent className="py-8 text-center">
            <Activity className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum log encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Data</th>
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Ação</th>
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Chave</th>
                <th className="text-left py-2 pr-3 font-medium text-muted-foreground">IP</th>
                <th className="text-left py-2 font-medium text-muted-foreground">Erro</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id} className="border-b border-border/30 hover:bg-secondary/30">
                  <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="py-1.5 pr-3"><code className="text-primary font-mono">{log.action}</code></td>
                  <td className={`py-1.5 pr-3 font-bold ${statusColor(log.status_code)}`}>{log.status_code || "—"}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{log.key_name || "—"}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground font-mono">{log.ip_address || "—"}</td>
                  <td className="py-1.5 text-destructive truncate max-w-[200px]">{log.error_message || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Endpoint Reference (collapsible) ──────────────────── */
function ActionCategory({ cat, isOpen, onToggle }: { cat: typeof actionDocs[0]; isOpen: boolean; onToggle: () => void }) {
  return (
    <Card className="bg-card border-border overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-secondary/30 transition-colors"
        onClick={onToggle}
      >
        <span className="font-medium text-sm flex items-center gap-2">
          <span>{cat.icon}</span> {cat.category}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">{cat.actions.length}</Badge>
          {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-border divide-y divide-border">
          {cat.actions.map((a) => (
            <div key={a.name} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono">POST</Badge>
                <code className="text-xs font-bold text-primary">{a.name}</code>
                <span className="text-xs text-muted-foreground">— {a.desc}</span>
              </div>
              {a.required && (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Obrigatório:</span>{" "}
                  {a.required.map(f => <code key={f} className="bg-destructive/15 text-destructive px-1 rounded mx-0.5">{f}</code>)}
                </p>
              )}
              {a.optional && (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Opcional:</span>{" "}
                  {a.optional.map(f => <code key={f} className="bg-secondary px-1 rounded mx-0.5">{f}</code>)}
                </p>
              )}
              <div className="grid md:grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium mb-1">Request</p>
                  <CodeBlock code={JSON.stringify(a.example, null, 2)} />
                </div>
                {a.responseExample && (
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-1">Response</p>
                    <CodeBlock code={JSON.stringify(a.responseExample, null, 2)} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ─── Main Page ─────────────────────────────────────────── */
export default function ApiDocs() {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

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

// 404 - Ação não encontrada
{
  "success": false,
  "error": "Unknown action \\"xyz\\". Use get_schema to list available actions."
}`;

  return (
    <div className="-mx-4 flex h-full min-h-0 flex-col animate-fade-in md:mx-0 md:block md:h-auto md:space-y-6">
      <div className="shrink-0 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur-sm md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
        <p className="heading-page flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" /> API & Integrações
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Documentação completa da infraestrutura real da Aceleriq — rotas, autenticação, webhooks e testes ao vivo.
        </p>
      </div>

      <div className="flex-1 min-h-0 space-y-6 overflow-y-auto px-4 pt-3 pb-4 md:overflow-visible md:px-0 md:pt-0 md:pb-0">


      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start bg-secondary/50 flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="overview" className="text-xs gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Visão Geral</TabsTrigger>
          <TabsTrigger value="keys" className="text-xs gap-1.5"><Key className="w-3.5 h-3.5" /> API Keys</TabsTrigger>
          <TabsTrigger value="endpoints" className="text-xs gap-1.5"><Code2 className="w-3.5 h-3.5" /> Endpoints ({totalActions})</TabsTrigger>
          <TabsTrigger value="webhooks" className="text-xs gap-1.5"><Webhook className="w-3.5 h-3.5" /> Webhooks & Funções</TabsTrigger>
          <TabsTrigger value="examples" className="text-xs gap-1.5"><Terminal className="w-3.5 h-3.5" /> Exemplos</TabsTrigger>
          <TabsTrigger value="tester" className="text-xs gap-1.5"><Play className="w-3.5 h-3.5" /> Testar API</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><Activity className="w-3.5 h-3.5" /> Audit Log</TabsTrigger>
          <TabsTrigger value="security" className="text-xs gap-1.5"><Lock className="w-3.5 h-3.5" /> Segurança</TabsTrigger>
          <TabsTrigger value="integrations" className="text-xs gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Integrações</TabsTrigger>
          <TabsTrigger value="mcp" className="text-xs gap-1.5"><Server className="w-3.5 h-3.5" /> MCP</TabsTrigger>
        </TabsList>

        {/* ── TAB: Visão Geral ─────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Quick Info Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2"><Globe className="w-4 h-4 text-primary" /><span className="text-xs font-semibold">Base URL</span></div>
                <div className="flex items-center gap-1">
                  <code className="text-[10px] bg-secondary px-2 py-1 rounded break-all flex-1">{GATEWAY_URL}</code>
                  <CopyButton text={GATEWAY_URL} />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2"><FileJson className="w-4 h-4 text-primary" /><span className="text-xs font-semibold">Método</span></div>
                <Badge>POST</Badge>
                <p className="text-[10px] text-muted-foreground mt-1">Endpoint único, ação via body JSON</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2"><Shield className="w-4 h-4 text-primary" /><span className="text-xs font-semibold">Autenticação</span></div>
                <code className="text-[10px] bg-secondary px-2 py-1 rounded">X-API-Key</code>
                <p className="text-[10px] text-muted-foreground mt-1">SHA-256 validado contra o banco</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2"><Hash className="w-4 h-4 text-primary" /><span className="text-xs font-semibold">Ações</span></div>
                <p className="text-2xl font-bold text-primary">{totalActions}</p>
                <p className="text-[10px] text-muted-foreground">{actionDocs.length} categorias + {webhookRoutes.length} webhooks</p>
              </CardContent>
            </Card>
          </div>

          {/* Architecture */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Arquitetura Real da Plataforma</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground space-y-2">
                <p>A Aceleriq opera com <strong>3 camadas de integração</strong> reais em produção:</p>

                <div className="grid sm:grid-cols-3 gap-3 mt-3">
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="font-medium text-foreground mb-1">🌐 API Gateway</p>
                    <p>Edge Function unificada (<code className="bg-secondary px-1 rounded">api-gateway</code>) — 44 ações CRUD via POST único com autenticação X-API-Key.</p>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="font-medium text-foreground mb-1">🔗 Webhooks n8n</p>
                    <p>{webhookRoutes.length} rotas de webhook para automação de fluxos. Base: <code className="bg-secondary px-1 rounded text-[10px] break-all">{WEBHOOK_BASE}</code></p>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="font-medium text-foreground mb-1">⚡ Edge Functions</p>
                    <p>{edgeFunctions.length} funções serverless para lógica de backend (cron, IA, gestão de equipe).</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-xs font-medium mb-2">Formato das Respostas (API Gateway)</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-green-500 font-medium mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Sucesso (200)</p>
                    <CodeBlock code={responseSuccess} />
                  </div>
                  <div>
                    <p className="text-[10px] text-destructive font-medium mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Erro (400/401/500)</p>
                    <CodeBlock code={responseError} />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Headers Table */}
              <div>
                <p className="text-xs font-medium mb-2">Headers Obrigatórios</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Header</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Valor</th>
                        <th className="text-left py-2 font-medium text-muted-foreground">Descrição</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-4"><code className="bg-secondary px-1 rounded text-foreground">Content-Type</code></td>
                        <td className="py-2 pr-4"><code className="bg-secondary px-1 rounded">application/json</code></td>
                        <td className="py-2">Obrigatório para todas as requisições.</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4"><code className="bg-secondary px-1 rounded text-foreground">X-API-Key</code></td>
                        <td className="py-2 pr-4"><code className="bg-secondary px-1 rounded">acq_xxx...</code></td>
                        <td className="py-2">Chave gerada na aba "API Keys". Hash SHA-256 validado no banco.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <Separator />

              {/* Database tables used */}
              <div>
                <p className="text-xs font-medium mb-2">Tabelas do Banco de Dados Acessíveis via API</p>
                <div className="flex flex-wrap gap-1.5">
                  {["profiles", "projects", "tasks", "milestones", "files", "reports", "billing", "notifications",
                    "client_requests", "briefings", "updates", "ads_wallet", "recharge_requests", "project_payments",
                    "payment_installments", "task_comments", "task_checklist_items", "task_attachments", "user_roles",
                    "api_keys", "api_audit_log"].map(t => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-mono">{t}</Badge>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Config reference */}
              <div>
                <p className="text-xs font-medium mb-2">Referência Rápida de Configuração</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody className="text-muted-foreground">
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground w-48">Base URL (API Gateway)</td>
                        <td className="py-1.5"><div className="flex items-center gap-1"><code className="bg-secondary px-1 rounded text-[10px] break-all">{GATEWAY_URL}</code><CopyButton text={GATEWAY_URL} /></div></td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground">Base URL (Webhooks)</td>
                        <td className="py-1.5"><div className="flex items-center gap-1"><code className="bg-secondary px-1 rounded text-[10px] break-all">{WEBHOOK_BASE}</code><CopyButton text={WEBHOOK_BASE} /></div></td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground">Método HTTP</td>
                        <td className="py-1.5"><code className="bg-secondary px-1 rounded">POST</code> (todas as rotas)</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground">Header de Auth</td>
                        <td className="py-1.5"><code className="bg-secondary px-1 rounded">X-API-Key</code></td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground">Formato do Body</td>
                        <td className="py-1.5"><code className="bg-secondary px-1 rounded">{`{ "action": "...", ...params }`}</code></td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground">Prefixo das Chaves</td>
                        <td className="py-1.5"><code className="bg-secondary px-1 rounded">acq_</code> (36 caracteres)</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-1.5 pr-4 font-medium text-foreground">Validação</td>
                        <td className="py-1.5">SHA-256 → tabela <code className="bg-secondary px-1 rounded">api_keys</code> → RPC <code className="bg-secondary px-1 rounded">validate_api_key</code></td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-4 font-medium text-foreground">Infraestrutura</td>
                        <td className="py-1.5">{totalActions} ações API + {webhookRoutes.length} webhooks + {edgeFunctions.length} edge functions</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: API Keys ────────────────────────────────── */}
        <TabsContent value="keys" className="mt-4 space-y-4">
          <ApiKeysSection />
        </TabsContent>

        {/* ── TAB: Endpoints ───────────────────────────────── */}
        <TabsContent value="endpoints" className="mt-4 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              {totalActions} ações via <code className="bg-secondary px-1 rounded">POST {GATEWAY_URL}</code>
            </p>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setExpandedCat(expandedCat ? null : "__all__")}>
              {expandedCat === "__all__" ? "Fechar Todos" : "Expandir Todos"}
            </Button>
          </div>
          {actionDocs.map((cat) => (
            <ActionCategory
              key={cat.category}
              cat={cat}
              isOpen={expandedCat === cat.category || expandedCat === "__all__"}
              onToggle={() => setExpandedCat(expandedCat === cat.category ? null : cat.category)}
            />
          ))}
        </TabsContent>

        {/* ── TAB: Webhooks & Edge Functions ────────────────── */}
        <TabsContent value="webhooks" className="mt-4 space-y-4">
          {/* Webhooks n8n */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Webhook className="w-4 h-4 text-primary" /> Webhooks n8n (Rotas Reais)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground mb-2">
                <p>Webhooks configurados em <code className="bg-secondary px-1 rounded">src/lib/webhooks.ts</code>. Disparados automaticamente pelo frontend via <code className="bg-secondary px-1 rounded">fireWebhook()</code>.</p>
                <div className="flex items-center gap-1 mt-2">
                  <span className="font-medium text-foreground">Base URL:</span>
                  <code className="bg-secondary px-2 py-0.5 rounded text-[10px] break-all">{WEBHOOK_BASE}</code>
                  <CopyButton text={WEBHOOK_BASE} />
                </div>
              </div>
              <div className="divide-y divide-border">
                {webhookRoutes.map(w => (
                  <div key={w.name} className="py-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono">POST</Badge>
                      <code className="text-xs font-bold text-primary">/{w.name}</code>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{w.desc}</p>
                    <p className="text-[10px] text-muted-foreground"><span className="font-medium text-foreground">Trigger:</span> {w.trigger}</p>
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium mb-1">URL Completa</p>
                      <div className="flex items-center gap-1">
                        <code className="text-[10px] bg-secondary px-2 py-0.5 rounded break-all">{WEBHOOK_BASE}/{w.name}</code>
                        <CopyButton text={`${WEBHOOK_BASE}/${w.name}`} />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium mb-1">Payload Esperado</p>
                      <CodeBlock code={w.payload} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Edge Functions */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4 text-primary" /> Edge Functions (Backend Serverless)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Funções backend em <code className="bg-secondary px-1 rounded">supabase/functions/</code>. Deploy automático.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Função</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Descrição</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Auth</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">URL</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    {edgeFunctions.map(ef => (
                      <tr key={ef.name} className="border-b border-border/30">
                        <td className="py-2 pr-3"><code className="text-primary font-mono font-bold">{ef.name}</code></td>
                        <td className="py-2 pr-3">{ef.desc}</td>
                        <td className="py-2 pr-3"><Badge variant="secondary" className="text-[9px]">{ef.auth}</Badge></td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <code className="text-[9px] bg-secondary px-1 rounded break-all">
                              {`https://${PROJECT_ID}.supabase.co/functions/v1/${ef.name}`}
                            </code>
                            <CopyButton text={`https://${PROJECT_ID}.supabase.co/functions/v1/${ef.name}`} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Env vars */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Info className="w-4 h-4 text-primary" /> Variáveis de Ambiente Relacionadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Variável</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Tipo</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">Uso</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border/30">
                      <td className="py-2 pr-3"><code className="text-foreground font-mono">VITE_SUPABASE_PROJECT_ID</code></td>
                      <td className="py-2 pr-3"><Badge variant="secondary" className="text-[9px]">Frontend</Badge></td>
                      <td className="py-2">Compõe a Base URL do gateway</td>
                    </tr>
                    <tr className="border-b border-border/30">
                      <td className="py-2 pr-3"><code className="text-foreground font-mono">VITE_WEBHOOK_URL</code></td>
                      <td className="py-2 pr-3"><Badge variant="secondary" className="text-[9px]">Frontend + Secret</Badge></td>
                      <td className="py-2">Base URL dos webhooks n8n</td>
                    </tr>
                    <tr className="border-b border-border/30">
                      <td className="py-2 pr-3"><code className="text-foreground font-mono">EXTERNAL_API_KEY</code></td>
                      <td className="py-2 pr-3"><Badge variant="secondary" className="text-[9px]">Secret</Badge></td>
                      <td className="py-2">Chave legada (fallback) do gateway</td>
                    </tr>
                    <tr className="border-b border-border/30">
                      <td className="py-2 pr-3"><code className="text-foreground font-mono">SUPABASE_SERVICE_ROLE_KEY</code></td>
                      <td className="py-2 pr-3"><Badge variant="destructive" className="text-[9px]">Secret</Badge></td>
                      <td className="py-2">Usada pelo gateway para acesso elevado ao banco</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3"><code className="text-foreground font-mono">LOVABLE_API_KEY</code></td>
                      <td className="py-2 pr-3"><Badge variant="secondary" className="text-[9px]">Secret</Badge></td>
                      <td className="py-2">Chave para Lovable AI (edge functions)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: Exemplos ────────────────────────────────── */}
        <TabsContent value="examples" className="mt-4 space-y-4">
          <div className="grid gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Terminal className="w-4 h-4" /> cURL — Health Check</CardTitle></CardHeader>
              <CardContent><CodeBlock code={curlExample} language="bash" /></CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Terminal className="w-4 h-4" /> cURL — Criar Cliente</CardTitle></CardHeader>
              <CardContent><CodeBlock code={curlCreateClient} language="bash" /></CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Code2 className="w-4 h-4" /> JavaScript / TypeScript</CardTitle></CardHeader>
              <CardContent><CodeBlock code={jsExample} language="js" /></CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Code2 className="w-4 h-4" /> Python</CardTitle></CardHeader>
              <CardContent><CodeBlock code={pythonExample} language="python" /></CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4" /> n8n — HTTP Request Node</CardTitle></CardHeader>
              <CardContent><CodeBlock code={n8nExample} language="text" /></CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB: Testar API ──────────────────────────────── */}
        <TabsContent value="tester" className="mt-4">
          <ApiTester />
        </TabsContent>

        {/* ── TAB: Audit Log ───────────────────────────────── */}
        <TabsContent value="audit" className="mt-4">
          <AuditLogViewer />
        </TabsContent>

        {/* ── TAB: Segurança ───────────────────────────────── */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Lock className="w-4 h-4 text-primary" /> Autenticação & Segurança</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-muted-foreground">
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                <p className="font-medium text-foreground mb-1">Fluxo de Autenticação (real)</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Admin gera API Key na aba "API Keys" (prefixo <code className="bg-secondary px-1 rounded">acq_</code>)</li>
                  <li>A chave é hasheada com SHA-256 e salva na tabela <code className="bg-secondary px-1 rounded">api_keys</code></li>
                  <li>A cada request, o gateway hasheia a chave recebida via <code className="bg-secondary px-1 rounded">X-API-Key</code></li>
                  <li>Executa RPC <code className="bg-secondary px-1 rounded">validate_api_key(_key_hash)</code> para validar</li>
                  <li>Se válida e ativa → processa. Se não → 401</li>
                  <li>Atualiza <code className="bg-secondary px-1 rounded">last_used_at</code> e registra no <code className="bg-secondary px-1 rounded">api_audit_log</code></li>
                </ol>
              </div>

              <div>
                <p className="font-medium text-foreground mb-2">Respostas de Erro de Autenticação</p>
                <CodeBlock code={responseAuth} />
              </div>

              <Separator />

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-primary" /> Chaves Hasheadas</p>
                  <p>API Keys armazenadas como hash SHA-256. A chave original nunca é salva.</p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Eye className="w-3.5 h-3.5 text-primary" /> Audit Log Completo</p>
                  <p>Cada chamada registra: ação, IP, status HTTP, nome da chave e erro (se houver).</p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Lock className="w-3.5 h-3.5 text-primary" /> RLS em Todas as Tabelas</p>
                  <p>Row Level Security ativo. api_keys e api_audit_log acessíveis apenas por admins.</p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Key className="w-3.5 h-3.5 text-primary" /> Service Role Isolado</p>
                  <p>O gateway usa service_role_key — nunca exposta ao frontend.</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="font-medium text-foreground mb-2">Boas Práticas</p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Use uma chave diferente para cada integração (n8n, OpenClaw, etc.)</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Nunca compartilhe a API Key em repositórios públicos ou chats</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Monitore o "Último uso" e o Audit Log regularmente</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Revogue chaves que não são mais utilizadas</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Chaves desativadas retornam 401 imediatamente sem processar</li>
                </ul>
              </div>

              <Separator />

              <div>
                <p className="font-medium text-foreground mb-2">Estrutura do Banco (Infra API)</p>
                <div className="space-y-2">
                  <div className="p-2 bg-secondary/50 rounded">
                    <code className="text-[10px] text-primary font-bold">api_keys</code>
                    <p className="text-[10px] mt-0.5">Colunas: id, name, key_hash, key_preview, is_active, last_used_at, created_by, created_at</p>
                  </div>
                  <div className="p-2 bg-secondary/50 rounded">
                    <code className="text-[10px] text-primary font-bold">api_audit_log</code>
                    <p className="text-[10px] mt-0.5">Colunas: id, action, ip_address, status_code, params, key_name, error_message, created_at</p>
                  </div>
                  <div className="p-2 bg-secondary/50 rounded">
                    <code className="text-[10px] text-primary font-bold">validate_api_key()</code>
                    <p className="text-[10px] mt-0.5">RPC SECURITY DEFINER que valida hash contra api_keys onde is_active = true</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: Integrações Salvas ──────────────────────── */}
        <TabsContent value="integrations" className="mt-4">
          <IntegrationsManager />
        </TabsContent>

        {/* ── TAB: MCP ─────────────────────────────────────── */}
        <TabsContent value="mcp" className="mt-4">
          <MCPManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

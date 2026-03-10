import { useState, useEffect } from "react";
import {
  Copy, Check, ExternalLink, Shield, Zap, Code2, Key, Plus, Trash2,
  Eye, EyeOff, BookOpen, Terminal, AlertTriangle, Server, Clock, Hash,
  Globe, Lock, FileJson, ChevronDown, ChevronRight, Info, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const GATEWAY_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/api-gateway`;

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
      {
        name: "health",
        desc: "Verifica se o gateway está online",
        example: { action: "health" },
        responseExample: { success: true, data: { status: "ok", version: "1.0", timestamp: "2026-03-10T12:00:00.000Z" } },
      },
      {
        name: "get_schema",
        desc: "Lista todas as ações disponíveis",
        example: { action: "get_schema" },
        responseExample: { success: true, data: { version: "1.0", actions: ["health", "get_schema", "list_clients", "..."], docs: "POST with { action, ...params }" } },
      },
      {
        name: "list_audit_log",
        desc: "Lista logs de auditoria do gateway",
        optional: ["action", "ip_address", "limit"],
        example: { action: "list_audit_log", limit: 50 },
      },
    ],
  },
  {
    category: "Clientes",
    icon: "👥",
    actions: [
      { name: "list_clients", desc: "Lista todos os clientes", optional: ["plan_status", "limit"], example: { action: "list_clients", limit: 10 }, responseExample: { success: true, data: [{ id: "uuid", full_name: "João Silva", email: "joao@empresa.com", company_name: "Empresa X", plan_status: "active", plan_name: "Pro" }] } },
      { name: "get_client", desc: "Busca um cliente por ID", required: ["client_id"], example: { action: "get_client", client_id: "uuid-aqui" } },
      { name: "create_client", desc: "Cria um novo cliente (cria conta + perfil)", required: ["email", "full_name"], optional: ["password", "company_name", "phone", "plan_name", "plan_value", "plan_renewal_date"], example: { action: "create_client", email: "novo@empresa.com", full_name: "João Silva", company_name: "Empresa X", plan_name: "Pro", plan_value: 2500 }, responseExample: { success: true, data: { id: "novo-uuid", email: "novo@empresa.com" } } },
      { name: "update_client", desc: "Atualiza dados de um cliente", required: ["client_id"], optional: ["full_name", "company_name", "phone", "plan_name", "plan_value", "plan_status", "plan_renewal_date"], example: { action: "update_client", client_id: "uuid", plan_status: "overdue" } },
    ],
  },
  {
    category: "Projetos",
    icon: "📁",
    actions: [
      { name: "list_projects", desc: "Lista projetos", optional: ["client_id", "status", "limit"], example: { action: "list_projects", client_id: "uuid" } },
      { name: "get_project", desc: "Busca projeto com milestones e tasks", required: ["project_id"], example: { action: "get_project", project_id: "uuid" }, responseExample: { success: true, data: { id: "uuid", name: "Site Novo", status: "active", progress: 45, milestones: [], tasks: [] } } },
      { name: "create_project", desc: "Cria um projeto", required: ["client_id", "name", "project_type", "start_date", "deadline"], optional: ["description", "objectives", "scope", "status", "created_by"], example: { action: "create_project", client_id: "uuid", name: "Site Novo", project_type: "website", start_date: "2026-03-10", deadline: "2026-04-10" } },
      { name: "update_project", desc: "Atualiza um projeto", required: ["project_id"], example: { action: "update_project", project_id: "uuid", status: "active", progress: 50 } },
      { name: "delete_project", desc: "Exclui um projeto", required: ["project_id"], example: { action: "delete_project", project_id: "uuid" } },
    ],
  },
  {
    category: "Tarefas",
    icon: "✅",
    actions: [
      { name: "list_tasks", desc: "Lista tarefas", optional: ["project_id", "status", "assigned_to", "milestone_id", "limit"], example: { action: "list_tasks", project_id: "uuid", status: "doing" } },
      { name: "get_task", desc: "Busca tarefa com comentários, checklist e anexos", required: ["task_id"], example: { action: "get_task", task_id: "uuid" } },
      { name: "create_task", desc: "Cria uma tarefa", required: ["project_id", "title"], optional: ["description", "status", "priority", "assigned_to", "due_date", "milestone_id", "task_order"], example: { action: "create_task", project_id: "uuid", title: "Criar landing page", priority: "high" } },
      { name: "update_task", desc: "Atualiza uma tarefa", required: ["task_id"], example: { action: "update_task", task_id: "uuid", status: "done" } },
      { name: "delete_task", desc: "Exclui uma tarefa", required: ["task_id"], example: { action: "delete_task", task_id: "uuid" } },
    ],
  },
  {
    category: "Milestones",
    icon: "🏁",
    actions: [
      { name: "list_milestones", desc: "Lista milestones de um projeto", optional: ["project_id"], example: { action: "list_milestones", project_id: "uuid" } },
      { name: "create_milestone", desc: "Cria milestone", required: ["project_id", "title", "target_date"], optional: ["description", "milestone_order", "status"], example: { action: "create_milestone", project_id: "uuid", title: "Entrega v1", target_date: "2026-04-01" } },
      { name: "update_milestone", desc: "Atualiza milestone", required: ["milestone_id"], example: { action: "update_milestone", milestone_id: "uuid", status: "completed" } },
    ],
  },
  {
    category: "Relatórios",
    icon: "📊",
    actions: [
      { name: "list_reports", desc: "Lista relatórios", optional: ["client_id", "project_id", "status", "limit"], example: { action: "list_reports" } },
      { name: "create_report", desc: "Cria relatório", required: ["client_id", "project_id", "title"], optional: ["summary", "highlights", "next_steps", "metrics", "chart_data", "chart_type", "period_start", "period_end", "status", "created_by", "internal_notes"], example: { action: "create_report", client_id: "uuid", project_id: "uuid", title: "Relatório Março" } },
      { name: "update_report", desc: "Atualiza relatório", required: ["report_id"], example: { action: "update_report", report_id: "uuid", status: "published" } },
    ],
  },
  {
    category: "Financeiro",
    icon: "💰",
    actions: [
      { name: "list_billing", desc: "Lista cobranças", optional: ["client_id", "status", "limit"], example: { action: "list_billing", status: "pending" } },
      { name: "create_billing", desc: "Cria cobrança", required: ["client_id", "amount", "due_date", "type"], optional: ["description", "status", "platform"], example: { action: "create_billing", client_id: "uuid", amount: 2500, due_date: "2026-04-01", type: "mensalidade" } },
      { name: "update_billing", desc: "Atualiza cobrança", required: ["billing_id"], example: { action: "update_billing", billing_id: "uuid", status: "paid", paid_date: "2026-03-09" } },
      { name: "list_payments", desc: "Lista pagamentos de projetos com parcelas", optional: ["client_id", "project_id", "limit"], example: { action: "list_payments", client_id: "uuid" } },
    ],
  },
  {
    category: "Notificações",
    icon: "🔔",
    actions: [
      { name: "send_notification", desc: "Envia notificação para um usuário", required: ["user_id", "message", "notification_type"], optional: ["link"], example: { action: "send_notification", user_id: "uuid", message: "Novo arquivo disponível!", notification_type: "update", link: "/aprovacoes" } },
      { name: "list_notifications", desc: "Lista notificações de um usuário", required: ["user_id"], optional: ["read", "limit"], example: { action: "list_notifications", user_id: "uuid", read: false } },
    ],
  },
  {
    category: "Pedidos & Briefings",
    icon: "📋",
    actions: [
      { name: "list_requests", desc: "Lista pedidos de clientes", optional: ["client_id", "status", "limit"], example: { action: "list_requests", status: "new" } },
      { name: "create_request", desc: "Cria pedido", required: ["client_id", "title", "description"], optional: ["priority", "project_id"], example: { action: "create_request", client_id: "uuid", title: "Novo post", description: "Preciso de um post para Instagram" } },
      { name: "update_request", desc: "Atualiza pedido", required: ["request_id"], example: { action: "update_request", request_id: "uuid", status: "done" } },
      { name: "list_briefings", desc: "Lista briefings", optional: ["client_id", "submitted", "limit"], example: { action: "list_briefings" } },
      { name: "get_briefing", desc: "Busca briefing por ID", required: ["briefing_id"], example: { action: "get_briefing", briefing_id: "uuid" } },
    ],
  },
  {
    category: "Feeds & Arquivos",
    icon: "📂",
    actions: [
      { name: "create_update", desc: "Cria update no feed de um projeto", required: ["project_id", "author_id", "message", "update_type"], example: { action: "create_update", project_id: "uuid", author_id: "uuid", message: "Deploy realizado!", update_type: "milestone" } },
      { name: "list_files", desc: "Lista arquivos", optional: ["client_id", "project_id", "approval_status", "limit"], example: { action: "list_files", project_id: "uuid" } },
      { name: "update_file", desc: "Atualiza arquivo (aprovação, feedback)", required: ["file_id"], example: { action: "update_file", file_id: "uuid", approval_status: "approved" } },
    ],
  },
  {
    category: "Ads & Wallet",
    icon: "📢",
    actions: [
      { name: "get_wallet", desc: "Busca carteira de ads do cliente", required: ["client_id"], example: { action: "get_wallet", client_id: "uuid" } },
      { name: "update_wallet", desc: "Atualiza saldo da carteira", required: ["wallet_id"], example: { action: "update_wallet", wallet_id: "uuid", balance: 1500 } },
      { name: "list_recharges", desc: "Lista solicitações de recarga", optional: ["client_id", "status"], example: { action: "list_recharges", status: "pending" } },
      { name: "update_recharge", desc: "Atualiza status de recarga", required: ["recharge_id"], example: { action: "update_recharge", recharge_id: "uuid", status: "approved" } },
    ],
  },
  {
    category: "Equipe & Checklist",
    icon: "👨‍💻",
    actions: [
      { name: "list_team", desc: "Lista membros da equipe (exceto clientes)", example: { action: "list_team" } },
      { name: "create_comment", desc: "Adiciona comentário a uma tarefa", required: ["task_id", "author_id", "content"], example: { action: "create_comment", task_id: "uuid", author_id: "uuid", content: "Ficou ótimo!" } },
      { name: "create_checklist_item", desc: "Adiciona item de checklist", required: ["task_id", "created_by", "title"], optional: ["item_order"], example: { action: "create_checklist_item", task_id: "uuid", created_by: "uuid", title: "Revisar cores" } },
      { name: "update_checklist_item", desc: "Atualiza item de checklist", required: ["item_id"], example: { action: "update_checklist_item", item_id: "uuid", checked: true } },
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

      {/* Create Key Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdKey ? "🔑 Chave Criada!" : "Nova API Key"}</DialogTitle>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Copie esta chave agora. <span className="text-destructive font-medium">Ela não será exibida novamente.</span>
              </p>
              <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg">
                <code className="text-xs flex-1 break-all select-all font-mono">{createdKey}</code>
                <CopyButton text={createdKey} />
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowCreate(false); setCreatedKey(null); }}>Entendi, copiei!</Button>
              </DialogFooter>
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
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="w-6 h-6 text-primary" /> API & Integrações
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Documentação completa da API Aceleriq — conecte n8n, Make, Zapier ou qualquer sistema externo.
        </p>
      </div>

      <Tabs defaultValue="keys" className="w-full">
        <TabsList className="w-full justify-start bg-secondary/50 flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="keys" className="text-xs gap-1.5"><Key className="w-3.5 h-3.5" /> API Keys</TabsTrigger>
          <TabsTrigger value="overview" className="text-xs gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Visão Geral</TabsTrigger>
          <TabsTrigger value="auth" className="text-xs gap-1.5"><Shield className="w-3.5 h-3.5" /> Autenticação</TabsTrigger>
          <TabsTrigger value="examples" className="text-xs gap-1.5"><Terminal className="w-3.5 h-3.5" /> Exemplos</TabsTrigger>
          <TabsTrigger value="endpoints" className="text-xs gap-1.5"><Code2 className="w-3.5 h-3.5" /> Endpoints ({totalActions})</TabsTrigger>
          <TabsTrigger value="security" className="text-xs gap-1.5"><Lock className="w-3.5 h-3.5" /> Segurança</TabsTrigger>
        </TabsList>

        {/* ── TAB: API Keys ────────────────────────────────── */}
        <TabsContent value="keys" className="mt-4 space-y-4">
          <ApiKeysSection />
        </TabsContent>

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
                <p className="text-[10px] text-muted-foreground mt-1">Header obrigatório em todas as chamadas</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2"><Hash className="w-4 h-4 text-primary" /><span className="text-xs font-semibold">Ações</span></div>
                <p className="text-2xl font-bold text-primary">{totalActions}</p>
                <p className="text-[10px] text-muted-foreground">endpoints disponíveis em {actionDocs.length} categorias</p>
              </CardContent>
            </Card>
          </div>

          {/* Architecture */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Arquitetura da API</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground space-y-2">
                <p>A API da Aceleriq utiliza um <strong>gateway unificado</strong> — um único endpoint que recebe todas as requisições via <code className="bg-secondary px-1 rounded">POST</code>. A ação desejada é definida no body JSON através do campo <code className="bg-secondary px-1 rounded">"action"</code>.</p>

                <div className="grid sm:grid-cols-3 gap-3 mt-3">
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="font-medium text-foreground mb-1">🌐 Edge Function</p>
                    <p>Backend serverless hospedado em cloud. Sem servidor próprio para gerenciar.</p>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="font-medium text-foreground mb-1">🔐 Service Role</p>
                    <p>O gateway usa privilégios elevados (service role) para operar em todas as tabelas.</p>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="font-medium text-foreground mb-1">📝 Audit Log</p>
                    <p>Toda chamada é registrada com IP, ação, status e nome da chave utilizada.</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-xs font-medium mb-2">Formato das Respostas</p>
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
            </CardContent>
          </Card>

          {/* Headers Table */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Headers Obrigatórios</CardTitle>
            </CardHeader>
            <CardContent>
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
                      <td className="py-2">Obrigatório. Todas as requisições são JSON.</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4"><code className="bg-secondary px-1 rounded text-foreground">X-API-Key</code></td>
                      <td className="py-2 pr-4"><code className="bg-secondary px-1 rounded">acq_xxx...</code></td>
                      <td className="py-2">Obrigatório. Chave gerada na aba "API Keys".</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: Autenticação ────────────────────────────── */}
        <TabsContent value="auth" className="mt-4 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Sistema de Autenticação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-muted-foreground">
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                <p className="font-medium text-foreground mb-1">Como funciona</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Você gera uma API Key na aba <strong>"API Keys"</strong> (prefixo <code className="bg-secondary px-1 rounded">acq_</code>)</li>
                  <li>A chave é hasheada com <strong>SHA-256</strong> e armazenada no banco de dados</li>
                  <li>A cada requisição, o gateway hasheia a chave recebida e valida contra o banco</li>
                  <li>Se válida e ativa, a requisição é processada e auditada</li>
                </ol>
              </div>

              <div>
                <p className="font-medium text-foreground mb-2">Envio da Chave</p>
                <CodeBlock code={`// A chave deve ser enviada no header "X-API-Key"
// NÃO envie no body, query string ou outros headers

Headers:
  X-API-Key: acq_AbCdEfGhIjKlMnOpQrStUvWxYz1234`} language="text" />
              </div>

              <div>
                <p className="font-medium text-foreground mb-2">Respostas de Erro de Autenticação</p>
                <CodeBlock code={responseAuth} />
              </div>

              <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                <p className="font-medium text-destructive flex items-center gap-1 mb-1"><AlertTriangle className="w-3.5 h-3.5" /> Importante</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>A chave completa é exibida <strong>apenas uma vez</strong> no momento da criação</li>
                  <li>Chaves desativadas retornam erro 401 imediatamente</li>
                  <li>Cada chave possui um nome identificador para rastreabilidade no audit log</li>
                  <li>Revogar uma chave é <strong>irreversível</strong></li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB: Exemplos ────────────────────────────────── */}
        <TabsContent value="examples" className="mt-4 space-y-4">
          <div className="grid gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Terminal className="w-4 h-4" /> cURL — Health Check</CardTitle>
              </CardHeader>
              <CardContent><CodeBlock code={curlExample} language="bash" /></CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Terminal className="w-4 h-4" /> cURL — Criar Cliente</CardTitle>
              </CardHeader>
              <CardContent><CodeBlock code={curlCreateClient} language="bash" /></CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Code2 className="w-4 h-4" /> JavaScript / TypeScript</CardTitle>
              </CardHeader>
              <CardContent><CodeBlock code={jsExample} language="js" /></CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Code2 className="w-4 h-4" /> Python</CardTitle>
              </CardHeader>
              <CardContent><CodeBlock code={pythonExample} language="python" /></CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4" /> n8n — HTTP Request Node</CardTitle>
              </CardHeader>
              <CardContent><CodeBlock code={n8nExample} language="text" /></CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── TAB: Endpoints ───────────────────────────────── */}
        <TabsContent value="endpoints" className="mt-4 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">
              {totalActions} ações disponíveis em {actionDocs.length} categorias. Todas via <code className="bg-secondary px-1 rounded">POST</code> no endpoint único.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => setExpandedCat(expandedCat ? null : "__all__")}
            >
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

        {/* ── TAB: Segurança ───────────────────────────────── */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Lock className="w-4 h-4 text-primary" /> Práticas de Segurança</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-muted-foreground">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-primary" /> Chaves Hasheadas</p>
                  <p>As API Keys são armazenadas como hash SHA-256. A chave original nunca é salva no banco.</p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Eye className="w-3.5 h-3.5 text-primary" /> Audit Log</p>
                  <p>Toda chamada registra: ação, IP do requisitante, status HTTP e nome da chave.</p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Lock className="w-3.5 h-3.5 text-primary" /> RLS Protegido</p>
                  <p>As tabelas de chaves e logs são protegidas por Row Level Security — apenas admins têm acesso.</p>
                </div>
                <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1"><Key className="w-3.5 h-3.5 text-primary" /> Chaves Revogáveis</p>
                  <p>Chaves podem ser desativadas ou revogadas a qualquer momento sem afetar outras integrações.</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="font-medium text-foreground mb-2">Boas Práticas</p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Use uma chave diferente para cada integração (n8n, OpenClaw, etc.)</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Nunca compartilhe a API Key em repositórios públicos ou chats</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Monitore o "Último uso" de cada chave regularmente</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Revogue chaves que não são mais utilizadas</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" /> Use o audit log para investigar acessos suspeitos</li>
                </ul>
              </div>

              <Separator />

              <div>
                <p className="font-medium text-foreground mb-2">Estrutura do Banco de Dados</p>
                <div className="space-y-2">
                  <div className="p-2 bg-secondary/50 rounded">
                    <code className="text-[10px] text-primary font-bold">api_keys</code>
                    <p className="text-[10px] mt-0.5">Armazena nome, hash da chave, preview, status ativo, último uso e quem criou.</p>
                  </div>
                  <div className="p-2 bg-secondary/50 rounded">
                    <code className="text-[10px] text-primary font-bold">api_audit_log</code>
                    <p className="text-[10px] mt-0.5">Registra ação, IP, status code, parâmetros, nome da chave e mensagens de erro.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Config Reference */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Info className="w-4 h-4 text-primary" /> Referência Rápida de Configuração</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Configuração</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">Base URL</td>
                      <td className="py-2"><div className="flex items-center gap-1"><code className="bg-secondary px-1 rounded text-[10px] break-all">{GATEWAY_URL}</code><CopyButton text={GATEWAY_URL} /></div></td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">Método HTTP</td>
                      <td className="py-2"><code className="bg-secondary px-1 rounded">POST</code></td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">Header de Autenticação</td>
                      <td className="py-2"><code className="bg-secondary px-1 rounded">X-API-Key</code></td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">Formato do Body</td>
                      <td className="py-2"><code className="bg-secondary px-1 rounded">JSON</code> — <code className="bg-secondary px-1 rounded">{`{ "action": "...", ...params }`}</code></td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">Prefixo das Chaves</td>
                      <td className="py-2"><code className="bg-secondary px-1 rounded">acq_</code></td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">Validação</td>
                      <td className="py-2">SHA-256 hash contra tabela <code className="bg-secondary px-1 rounded">api_keys</code></td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium text-foreground">Total de Ações</td>
                      <td className="py-2"><Badge>{totalActions} endpoints</Badge></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

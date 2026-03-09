import { useState, useEffect } from "react";
import { Copy, Check, ExternalLink, Shield, Zap, Code2, Key, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";

const GATEWAY_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/api-gateway`;

// --- Action docs (unchanged) ---
const actionDocs: {
  category: string;
  actions: { name: string; desc: string; required?: string[]; optional?: string[]; example: Record<string, any> }[];
}[] = [
  {
    category: "🔧 Sistema",
    actions: [
      { name: "health", desc: "Verifica se o gateway está online", example: { action: "health" } },
      { name: "get_schema", desc: "Lista todas as ações disponíveis", example: { action: "get_schema" } },
      { name: "list_audit_log", desc: "Lista logs de auditoria", optional: ["action", "ip_address", "limit"], example: { action: "list_audit_log", limit: 50 } },
    ],
  },
  {
    category: "👥 Clientes",
    actions: [
      { name: "list_clients", desc: "Lista todos os clientes", optional: ["plan_status", "limit"], example: { action: "list_clients", limit: 10 } },
      { name: "get_client", desc: "Busca um cliente por ID", required: ["client_id"], example: { action: "get_client", client_id: "uuid-aqui" } },
      { name: "create_client", desc: "Cria um novo cliente (cria conta + perfil)", required: ["email", "full_name"], optional: ["password", "company_name", "phone", "plan_name", "plan_value", "plan_renewal_date"], example: { action: "create_client", email: "novo@empresa.com", full_name: "João Silva", company_name: "Empresa X", plan_name: "Pro", plan_value: 2500 } },
      { name: "update_client", desc: "Atualiza dados de um cliente", required: ["client_id"], optional: ["full_name", "company_name", "phone", "plan_name", "plan_value", "plan_status", "plan_renewal_date"], example: { action: "update_client", client_id: "uuid", plan_status: "overdue" } },
    ],
  },
  {
    category: "📁 Projetos",
    actions: [
      { name: "list_projects", desc: "Lista projetos", optional: ["client_id", "status", "limit"], example: { action: "list_projects", client_id: "uuid" } },
      { name: "get_project", desc: "Busca projeto com milestones e tasks", required: ["project_id"], example: { action: "get_project", project_id: "uuid" } },
      { name: "create_project", desc: "Cria um projeto", required: ["client_id", "name", "project_type", "start_date", "deadline"], optional: ["description", "objectives", "scope", "status", "created_by"], example: { action: "create_project", client_id: "uuid", name: "Site Novo", project_type: "website", start_date: "2026-03-10", deadline: "2026-04-10" } },
      { name: "update_project", desc: "Atualiza um projeto", required: ["project_id"], example: { action: "update_project", project_id: "uuid", status: "active", progress: 50 } },
      { name: "delete_project", desc: "Exclui um projeto", required: ["project_id"], example: { action: "delete_project", project_id: "uuid" } },
    ],
  },
  {
    category: "✅ Tarefas",
    actions: [
      { name: "list_tasks", desc: "Lista tarefas", optional: ["project_id", "status", "assigned_to", "milestone_id", "limit"], example: { action: "list_tasks", project_id: "uuid", status: "doing" } },
      { name: "get_task", desc: "Busca tarefa com comentários, checklist e anexos", required: ["task_id"], example: { action: "get_task", task_id: "uuid" } },
      { name: "create_task", desc: "Cria uma tarefa", required: ["project_id", "title"], optional: ["description", "status", "priority", "assigned_to", "due_date", "milestone_id", "task_order"], example: { action: "create_task", project_id: "uuid", title: "Criar landing page", priority: "high" } },
      { name: "update_task", desc: "Atualiza uma tarefa", required: ["task_id"], example: { action: "update_task", task_id: "uuid", status: "done" } },
      { name: "delete_task", desc: "Exclui uma tarefa", required: ["task_id"], example: { action: "delete_task", task_id: "uuid" } },
    ],
  },
  {
    category: "🏁 Milestones",
    actions: [
      { name: "list_milestones", desc: "Lista milestones de um projeto", optional: ["project_id"], example: { action: "list_milestones", project_id: "uuid" } },
      { name: "create_milestone", desc: "Cria milestone", required: ["project_id", "title", "target_date"], optional: ["description", "milestone_order", "status"], example: { action: "create_milestone", project_id: "uuid", title: "Entrega v1", target_date: "2026-04-01" } },
      { name: "update_milestone", desc: "Atualiza milestone", required: ["milestone_id"], example: { action: "update_milestone", milestone_id: "uuid", status: "completed" } },
    ],
  },
  {
    category: "📊 Relatórios",
    actions: [
      { name: "list_reports", desc: "Lista relatórios", optional: ["client_id", "project_id", "status", "limit"], example: { action: "list_reports" } },
      { name: "create_report", desc: "Cria relatório", required: ["client_id", "project_id", "title"], optional: ["summary", "highlights", "next_steps", "metrics", "chart_data", "chart_type", "period_start", "period_end", "status", "created_by", "internal_notes"], example: { action: "create_report", client_id: "uuid", project_id: "uuid", title: "Relatório Março" } },
      { name: "update_report", desc: "Atualiza relatório", required: ["report_id"], example: { action: "update_report", report_id: "uuid", status: "published" } },
    ],
  },
  {
    category: "💰 Financeiro",
    actions: [
      { name: "list_billing", desc: "Lista cobranças", optional: ["client_id", "status", "limit"], example: { action: "list_billing", status: "pending" } },
      { name: "create_billing", desc: "Cria cobrança", required: ["client_id", "amount", "due_date", "type"], optional: ["description", "status", "platform"], example: { action: "create_billing", client_id: "uuid", amount: 2500, due_date: "2026-04-01", type: "mensalidade" } },
      { name: "update_billing", desc: "Atualiza cobrança", required: ["billing_id"], example: { action: "update_billing", billing_id: "uuid", status: "paid", paid_date: "2026-03-09" } },
      { name: "list_payments", desc: "Lista pagamentos de projetos com parcelas", optional: ["client_id", "project_id", "limit"], example: { action: "list_payments", client_id: "uuid" } },
    ],
  },
  {
    category: "🔔 Notificações",
    actions: [
      { name: "send_notification", desc: "Envia notificação para um usuário", required: ["user_id", "message", "notification_type"], optional: ["link"], example: { action: "send_notification", user_id: "uuid", message: "Novo arquivo disponível!", notification_type: "update", link: "/aprovacoes" } },
      { name: "list_notifications", desc: "Lista notificações de um usuário", required: ["user_id"], optional: ["read", "limit"], example: { action: "list_notifications", user_id: "uuid", read: false } },
    ],
  },
  {
    category: "📋 Pedidos / Briefings / Outros",
    actions: [
      { name: "list_requests", desc: "Lista pedidos de clientes", optional: ["client_id", "status", "limit"], example: { action: "list_requests", status: "new" } },
      { name: "create_request", desc: "Cria pedido", required: ["client_id", "title", "description"], optional: ["priority", "project_id"], example: { action: "create_request", client_id: "uuid", title: "Novo post", description: "Preciso de um post para Instagram" } },
      { name: "update_request", desc: "Atualiza pedido", required: ["request_id"], example: { action: "update_request", request_id: "uuid", status: "done" } },
      { name: "list_briefings", desc: "Lista briefings", optional: ["client_id", "submitted", "limit"], example: { action: "list_briefings" } },
      { name: "get_briefing", desc: "Busca briefing por ID", required: ["briefing_id"], example: { action: "get_briefing", briefing_id: "uuid" } },
      { name: "create_update", desc: "Cria update no feed de um projeto", required: ["project_id", "author_id", "message", "update_type"], example: { action: "create_update", project_id: "uuid", author_id: "uuid", message: "Deploy realizado!", update_type: "milestone" } },
      { name: "list_files", desc: "Lista arquivos", optional: ["client_id", "project_id", "approval_status", "limit"], example: { action: "list_files", project_id: "uuid" } },
      { name: "update_file", desc: "Atualiza arquivo (aprovação, feedback)", required: ["file_id"], example: { action: "update_file", file_id: "uuid", approval_status: "approved" } },
      { name: "get_wallet", desc: "Busca carteira de ads", required: ["client_id"], example: { action: "get_wallet", client_id: "uuid" } },
      { name: "update_wallet", desc: "Atualiza carteira", required: ["wallet_id"], example: { action: "update_wallet", wallet_id: "uuid", balance: 1500 } },
      { name: "list_recharges", desc: "Lista solicitações de recarga", optional: ["client_id", "status"], example: { action: "list_recharges", status: "pending" } },
      { name: "update_recharge", desc: "Atualiza recarga", required: ["recharge_id"], example: { action: "update_recharge", recharge_id: "uuid", status: "approved" } },
      { name: "list_team", desc: "Lista membros da equipe", example: { action: "list_team" } },
      { name: "create_comment", desc: "Adiciona comentário a uma tarefa", required: ["task_id", "author_id", "content"], example: { action: "create_comment", task_id: "uuid", author_id: "uuid", content: "Ficou ótimo!" } },
      { name: "create_checklist_item", desc: "Adiciona item de checklist", required: ["task_id", "created_by", "title"], optional: ["item_order"], example: { action: "create_checklist_item", task_id: "uuid", created_by: "uuid", title: "Revisar cores" } },
      { name: "update_checklist_item", desc: "Atualiza item de checklist", required: ["item_id"], example: { action: "update_checklist_item", item_id: "uuid", checked: true } },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded hover:bg-secondary transition-colors"
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

// --- SHA-256 hash (browser) ---
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

// --- API Keys Management Section ---
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
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Key className="w-4 h-4 text-primary" /> API Keys</CardTitle>
          <Button size="sm" variant="outline" onClick={() => { setShowCreate(true); setNewKeyName(""); setCreatedKey(null); }}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Nova Chave
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma chave criada. Clique em "Nova Chave" para começar.</p>
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
                  <div className="flex items-center gap-3 mt-1">
                    <code className="text-[11px] text-muted-foreground">{k.key_preview}</code>
                    {k.last_used_at && (
                      <span className="text-[10px] text-muted-foreground">
                        Último uso: {new Date(k.last_used_at).toLocaleDateString("pt-BR")}
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
      </CardContent>

      {/* Create Key Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdKey ? "Chave Criada!" : "Nova API Key"}</DialogTitle>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Copie esta chave agora. <span className="text-destructive font-medium">Ela não será exibida novamente.</span>
              </p>
              <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg">
                <code className="text-xs flex-1 break-all select-all">{createdKey}</code>
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

      {/* Delete Confirm */}
      <ConfirmModal
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Revogar API Key"
        description="Essa ação é irreversível. Qualquer integração usando esta chave perderá acesso imediatamente."
        confirmLabel="Revogar"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </Card>
  );
}

// --- Main Page ---
export default function ApiDocs() {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const curlExample = `curl -X POST "${GATEWAY_URL}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: SUA_CHAVE_AQUI" \\
  -d '{"action": "health"}'`;

  const n8nExample = `{
  "method": "POST",
  "url": "${GATEWAY_URL}",
  "headers": {
    "Content-Type": "application/json",
    "X-API-Key": "SUA_CHAVE_AQUI"
  },
  "body": {
    "action": "list_clients",
    "limit": 50
  }
}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Gateway</h1>
        <p className="text-sm text-muted-foreground mt-1">Conecte qualquer ferramenta externa (n8n, OpenClaw, Make, Zapier) ao sistema completo.</p>
      </div>

      {/* API Keys Management */}
      <ApiKeysSection />

      {/* Quick Start */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Endpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-secondary px-2 py-1 rounded flex-1 overflow-x-auto">{GATEWAY_URL}</code>
              <CopyButton text={GATEWAY_URL} />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Autenticação</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Header: <code className="bg-secondary px-1 rounded">X-API-Key</code></p>
            <p className="text-xs text-muted-foreground mt-1">Método: <code className="bg-secondary px-1 rounded">POST</code> apenas</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Code2 className="w-4 h-4 text-primary" /> Formato</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Body JSON: <code className="bg-secondary px-1 rounded">{`{ "action": "...", ...params }`}</code></p>
            <p className="text-xs text-muted-foreground mt-1">Resposta: <code className="bg-secondary px-1 rounded">{`{ "success": true, "data": ... }`}</code></p>
          </CardContent>
        </Card>
      </div>

      {/* Examples */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">cURL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <pre className="text-[11px] bg-secondary p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{curlExample}</pre>
              <div className="absolute top-2 right-2"><CopyButton text={curlExample} /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">n8n HTTP Node <ExternalLink className="w-3 h-3" /></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <pre className="text-[11px] bg-secondary p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{n8nExample}</pre>
              <div className="absolute top-2 right-2"><CopyButton text={n8nExample} /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions Reference */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Ações Disponíveis</h2>
        <div className="space-y-3">
          {actionDocs.map((cat) => (
            <Card key={cat.category} className="bg-card border-border overflow-hidden">
              <button
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-secondary/30 transition-colors"
                onClick={() => setExpandedCat(expandedCat === cat.category ? null : cat.category)}
              >
                <span className="font-medium text-sm">{cat.category}</span>
                <Badge variant="secondary" className="text-[10px]">{cat.actions.length} ações</Badge>
              </button>
              {expandedCat === cat.category && (
                <div className="border-t border-border divide-y divide-border">
                  {cat.actions.map((a) => (
                    <div key={a.name} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-bold text-primary">{a.name}</code>
                        <span className="text-xs text-muted-foreground">— {a.desc}</span>
                      </div>
                      {a.required && (
                        <p className="text-[11px] text-muted-foreground">
                          Obrigatório: {a.required.map(f => <code key={f} className="bg-destructive/15 text-destructive px-1 rounded mx-0.5">{f}</code>)}
                        </p>
                      )}
                      {a.optional && (
                        <p className="text-[11px] text-muted-foreground">
                          Opcional: {a.optional.map(f => <code key={f} className="bg-secondary px-1 rounded mx-0.5">{f}</code>)}
                        </p>
                      )}
                      <div className="relative">
                        <pre className="text-[10px] bg-secondary p-2 rounded overflow-x-auto">{JSON.stringify(a.example, null, 2)}</pre>
                        <div className="absolute top-1 right-1"><CopyButton text={JSON.stringify(a.example, null, 2)} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Save, X, Globe, Lock, Key, Clock, CheckCircle2, AlertCircle, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";

interface IntegrationConfig {
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  auth_header: string;
  auth_value_preview: string;
  description: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const emptyConfig = {
  name: "",
  base_url: "",
  auth_type: "api_key",
  auth_header: "X-API-Key",
  auth_value_preview: "",
  description: "",
  notes: "",
  is_active: true,
};

export default function IntegrationsManager() {
  const [configs, setConfigs] = useState<IntegrationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchConfigs = async () => {
    const { data } = await supabase
      .from("integration_configs" as any)
      .select("*")
      .order("created_at", { ascending: false });
    setConfigs((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchConfigs(); }, []);

  const openCreate = () => {
    setForm(emptyConfig);
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (cfg: IntegrationConfig) => {
    setForm({
      name: cfg.name,
      base_url: cfg.base_url,
      auth_type: cfg.auth_type,
      auth_header: cfg.auth_header,
      auth_value_preview: cfg.auth_value_preview,
      description: cfg.description || "",
      notes: cfg.notes || "",
      is_active: cfg.is_active,
    });
    setEditId(cfg.id);
    setShowForm(true);
  };

  const maskValue = (v: string) => {
    if (!v || v.length <= 8) return v ? "••••••••" : "";
    return v.slice(0, 4) + "•".repeat(Math.min(v.length - 8, 20)) + v.slice(-4);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();

    const payload = {
      name: form.name.trim(),
      base_url: form.base_url.trim(),
      auth_type: form.auth_type,
      auth_header: form.auth_header.trim(),
      auth_value_preview: form.auth_value_preview ? maskValue(form.auth_value_preview) : "",
      description: form.description.trim(),
      notes: form.notes.trim(),
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };

    if (editId) {
      const { error } = await supabase
        .from("integration_configs" as any)
        .update(payload as any)
        .eq("id", editId);
      if (error) toast.error("Erro: " + error.message);
      else toast.success("Integração atualizada");
    } else {
      const { error } = await supabase
        .from("integration_configs" as any)
        .insert({ ...payload, created_by: userData.user?.id } as any);
      if (error) toast.error("Erro: " + error.message);
      else toast.success("Integração criada");
    }

    setSaving(false);
    setShowForm(false);
    fetchConfigs();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from("integration_configs" as any).delete().eq("id", deleteId);
    setDeleteId(null);
    fetchConfigs();
    toast.success("Integração removida");
  };

  const handleToggle = async (id: string, active: boolean) => {
    await supabase
      .from("integration_configs" as any)
      .update({ is_active: !active, updated_at: new Date().toISOString() } as any)
      .eq("id", id);
    fetchConfigs();
    toast.success(active ? "Integração desativada" : "Integração ativada");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" /> Integrações Salvas
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Registre e documente as integrações ativas da plataforma para referência da equipe técnica.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Nova Integração
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : configs.length === 0 ? (
        <Card className="bg-secondary/30 border-dashed border-border">
          <CardContent className="py-10 text-center">
            <Globe className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma integração registrada.</p>
            <p className="text-xs text-muted-foreground mt-1">Registre integrações externas para manter a documentação centralizada.</p>
            <Button size="sm" className="mt-3" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Registrar Primeira Integração
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((cfg) => (
            <Card key={cfg.id} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{cfg.name}</span>
                      <Badge variant={cfg.is_active ? "default" : "secondary"} className="text-[10px]">
                        {cfg.is_active ? "Ativa" : "Inativa"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{cfg.auth_type === "api_key" ? "API Key" : cfg.auth_type === "bearer" ? "Bearer Token" : cfg.auth_type}</Badge>
                    </div>

                    {cfg.description && (
                      <p className="text-[11px] text-muted-foreground">{cfg.description}</p>
                    )}

                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                      {cfg.base_url && (
                        <div className="flex items-center gap-1">
                          <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">URL:</span>
                          <code className="bg-secondary px-1 rounded truncate">{cfg.base_url}</code>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Key className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-muted-foreground">Header:</span>
                        <code className="bg-secondary px-1 rounded">{cfg.auth_header}</code>
                      </div>
                      {cfg.auth_value_preview && (
                        <div className="flex items-center gap-1">
                          <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">Chave:</span>
                          <code className="bg-secondary px-1 rounded">{cfg.auth_value_preview}</code>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-muted-foreground">Atualizado:</span>
                        <span>{new Date(cfg.updated_at).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </div>

                    {cfg.notes && (
                      <div className="mt-1 p-2 bg-secondary/50 rounded text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">Notas:</span> {cfg.notes}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(cfg)} title="Editar">
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggle(cfg.id, cfg.is_active)} title={cfg.is_active ? "Desativar" : "Ativar"}>
                      {cfg.is_active ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(cfg.id)} title="Excluir">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Integração" : "Nova Integração"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome da integração *</Label>
              <Input placeholder="Ex: n8n Produção, OpenClaw, Zapier..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input placeholder="Para que serve essa integração?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Base URL</Label>
                <Input placeholder="https://..." value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Tipo de autenticação</Label>
                <Select value={form.auth_type} onValueChange={v => setForm(f => ({ ...f, auth_type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="basic">Basic Auth</SelectItem>
                    <SelectItem value="none">Sem autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nome do header</Label>
                <Input placeholder="X-API-Key" value={form.auth_header} onChange={e => setForm(f => ({ ...f, auth_header: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Valor da chave</Label>
                <Input type="password" placeholder="acq_xxx..." value={form.auth_value_preview} onChange={e => setForm(f => ({ ...f, auth_value_preview: e.target.value }))} className="font-mono text-xs" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Será mascarado automaticamente.</p>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas técnicas</Label>
              <textarea
                className="w-full text-xs bg-secondary border border-border rounded-md p-2 min-h-[60px] resize-y"
                placeholder="Observações, limitações, detalhes de configuração..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? "Salvando..." : editId ? "Atualizar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!deleteId}
        title="Excluir Integração"
        description="Tem certeza que deseja remover esta integração? A ação é irreversível."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

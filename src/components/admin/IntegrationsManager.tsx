import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, CheckCircle2, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  RegiaoRolavel,
  Secao,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchConfigs = async () => {
    const { data, error } = await supabase
      .from("integration_configs" as any)
      .select("*")
      .order("created_at", { ascending: false });
    setLoadError(error ? error.message : null);
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

  const tipoDeAuth = (t: string) => (t === "api_key" ? "API Key" : t === "bearer" ? "Bearer Token" : t);

  return (
    <Secao
      titulo="Integrações salvas"
      descricao={loading ? undefined : `${configs.length} ${configs.length === 1 ? "integração" : "integrações"}`}
      ajuda="Registro das integrações ativas da plataforma, para referência da equipe técnica. A chave é guardada só mascarada."
      acao={
        <button type="button" className={juntar(botao.primario, "px-2.5 sm:px-3.5")} onClick={openCreate} aria-label="Nova integração">
          <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
          <span className="hidden sm:inline">Nova integração</span>
        </button>
      }
    >
      {loading && configs.length === 0 ? (
        <Carregando linhas={3} rotulo="Carregando integrações" />
      ) : loadError && configs.length === 0 ? (
        <EstadoDeErro
          titulo="Não foi possível carregar as integrações."
          descricao={loadError}
          acao={<button type="button" className={botao.secundario} onClick={() => fetchConfigs()}>Tentar de novo</button>}
        />
      ) : configs.length === 0 ? (
        <EstadoVazio
          compacto
          titulo="Nenhuma integração registrada."
          descricao="Registre as externas para manter a documentação num lugar só."
          acao={<button type="button" className={botao.discreto} onClick={openCreate}>Registrar</button>}
        />
      ) : (
        <RegiaoRolavel rotulo="Integrações salvas" memoria="api-docs:integracoes" className="lg:max-h-[70vh]">
          <ul className="divide-y divide-border border-y border-border">
            {configs.map((cfg) => (
              <li key={cfg.id} className="flex min-w-0 items-start py-3">
                <div className="mr-3 min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center">
                    <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate font-semibold")}>{cfg.name}</span>
                    <span className={juntar(etiqueta, "mr-1.5", cfg.is_active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      {cfg.is_active ? "Ativa" : "Inativa"}
                    </span>
                    <span className={juntar(etiqueta, "border border-border text-muted-foreground")}>{tipoDeAuth(cfg.auth_type)}</span>
                  </div>

                  {cfg.description && (
                    <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{cfg.description}</p>
                  )}

                  <p className={juntar(texto.auxiliar, "mt-1 truncate")}>
                    {cfg.base_url && <>URL: <code className="font-mono text-foreground">{cfg.base_url}</code> · </>}
                    Header: <code className="font-mono text-foreground">{cfg.auth_header}</code>
                    {cfg.auth_value_preview && <> · Chave: <code className="font-mono">{cfg.auth_value_preview}</code></>}
                    {" · "}Atualizado: <span className="tabular-nums">{new Date(cfg.updated_at).toLocaleDateString("pt-BR")}</span>
                  </p>

                  {cfg.notes && (
                    <p className={juntar(superficie.poco, "mt-2 px-3 py-2 text-[12px] leading-5 text-muted-foreground")}>
                      <span className="font-medium text-foreground">Notas:</span> {cfg.notes}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center [&>*+*]:ml-1">
                  <button type="button" className={botao.icone} onClick={() => openEdit(cfg)} title="Editar" aria-label={`Editar ${cfg.name}`}>
                    <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={botao.icone}
                    onClick={() => handleToggle(cfg.id, cfg.is_active)}
                    title={cfg.is_active ? "Desativar" : "Ativar"}
                    aria-label={cfg.is_active ? `Desativar ${cfg.name}` : `Ativar ${cfg.name}`}
                  >
                    {cfg.is_active ? <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                  <button type="button" className={juntar(botao.icone, "hover:text-destructive")} onClick={() => setDeleteId(cfg.id)} title="Excluir" aria-label={`Excluir ${cfg.name}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </RegiaoRolavel>
      )}

      {/* Criar / editar */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className={texto.tituloSecao}>{editId ? "Editar integração" : "Nova integração"}</DialogTitle>
          </DialogHeader>
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Nome da integração" obrigatorio largo>
              <input className={campo} placeholder="Ex: n8n Produção, OpenClaw, Zapier..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Descrição" largo>
              <input className={campo} placeholder="Para que serve essa integração?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Base URL">
              <input className={juntar(campo, "font-mono text-[12px]")} placeholder="https://..." value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Tipo de autenticação">
              <Select value={form.auth_type} onValueChange={v => setForm(f => ({ ...f, auth_type: v }))}>
                <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="basic">Basic Auth</SelectItem>
                  <SelectItem value="none">Sem autenticação</SelectItem>
                </SelectContent>
              </Select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Nome do header">
              <input className={juntar(campo, "font-mono text-[12px]")} placeholder="X-API-Key" value={form.auth_header} onChange={e => setForm(f => ({ ...f, auth_header: e.target.value }))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Valor da chave" apoio="Guardado só mascarado.">
              <input type="password" autoComplete="off" className={juntar(campo, "font-mono text-[12px]")} placeholder="acq_xxx..." value={form.auth_value_preview} onChange={e => setForm(f => ({ ...f, auth_value_preview: e.target.value }))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Notas técnicas" largo>
              <textarea
                className={juntar(campoTexto, "resize-y")}
                placeholder="Observações, limitações, detalhes de configuração..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
            <button type="button" className={botao.secundario} onClick={() => setShowForm(false)}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? "Salvando..." : editId ? "Atualizar" : "Criar"}
            </button>
          </div>
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
    </Secao>
  );
}

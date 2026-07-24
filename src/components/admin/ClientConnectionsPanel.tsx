import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plug, Plus, Power, PowerOff, Link2, Link2Off, Loader2 } from "lucide-react";

interface Props {
  clientId: string;
}

const PLATFORMS = [
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "google_analytics", label: "Google Analytics" },
  { value: "google_business", label: "Google Business" },
  { value: "outro", label: "Outro" },
];

export default function ClientConnectionsPanel({ clientId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [platform, setPlatform] = useState("meta_ads");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [externalId, setExternalId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linkOpenFor, setLinkOpenFor] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["external-accounts", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_accounts" as any)
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  const { data: projects } = useQuery({
    queryKey: ["connections-client-projects", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_id")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  const accountIds = useMemo(() => (accounts || []).map((a: any) => a.id), [accounts]);

  const { data: links } = useQuery({
    queryKey: ["project-external-accounts", clientId, accountIds.join(",")],
    queryFn: async () => {
      if (!accountIds.length) return [];
      const { data, error } = await supabase
        .from("project_external_accounts" as any)
        .select("id, project_id, external_account_id, client_id")
        .eq("client_id", clientId)
        .in("external_account_id", accountIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId && accountIds.length > 0,
  });

  // Reset selections when client changes (via key change from parent) — also clear locally.
  // Parent re-mounts on client switch, so this is defensive only.

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["external-accounts", clientId] });
    qc.invalidateQueries({ queryKey: ["project-external-accounts", clientId] });
  };

  const handleCreate = async () => {
    if (!displayName.trim()) {
      toast.error("Nome de exibição é obrigatório");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("external_accounts" as any).insert({
        client_id: clientId,
        platform,
        display_name: displayName.trim(),
        handle: handle.trim() || null,
        external_id: externalId.trim() || null,
        status: "active",
        created_by: user?.id,
      });
      if (error) throw error;
      toast.success("Conta cadastrada");
      setCreating(false);
      setDisplayName(""); setHandle(""); setExternalId(""); setPlatform("meta_ads");
      invalidate();
    } catch (e: any) {
      toast.error(e.message?.includes("unique") ? "Conta já cadastrada para este cliente" : (e.message || "Falha ao cadastrar"));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (acc: any) => {
    const next = acc.status === "active" ? "inactive" : "active";
    const { error } = await supabase
      .from("external_accounts" as any)
      .update({ status: next })
      .eq("id", acc.id);
    if (error) return toast.error(error.message);
    toast.success(next === "active" ? "Conta ativada" : "Conta inativada");
    invalidate();
  };

  const linkToProject = async (accountId: string) => {
    if (!selectedProjectId) {
      toast.error("Selecione um projeto");
      return;
    }
    const { error } = await supabase.from("project_external_accounts" as any).insert({
      client_id: clientId,
      project_id: selectedProjectId,
      external_account_id: accountId,
      created_by: user?.id,
    });
    if (error) {
      toast.error(error.message?.includes("unique") ? "Já vinculado a este projeto" : error.message);
      return;
    }
    toast.success("Vinculado ao projeto");
    setLinkOpenFor(null);
    setSelectedProjectId("");
    invalidate();
  };

  const unlink = async (linkId: string) => {
    const { error } = await supabase.from("project_external_accounts" as any).delete().eq("id", linkId);
    if (error) return toast.error(error.message);
    toast.success("Vínculo removido");
    invalidate();
  };

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Plug className="w-3 h-3" /> Conexões
        </label>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-primary border border-primary/30 hover:bg-primary/5 transition-colors bg-transparent"
          >
            <Plus className="w-3 h-3" /> Nova conta
          </button>
        )}
      </div>

      {creating && (
        <div className="rounded-xl bg-secondary/50 border border-border p-3 space-y-2 mb-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Plataforma</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50"
              >
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Nome de exibição *</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ex: Perfil oficial"
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Handle / Usuário</label>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@usuario"
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">ID externo (opcional)</label>
              <input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="123456789"
                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground mt-1 focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Cadastro apenas informativo. Não armazenamos senha, token ou chave de API.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setCreating(false); setDisplayName(""); setHandle(""); setExternalId(""); }}
              className="flex-1 px-3 py-1.5 rounded-lg text-[12px] border border-border text-muted-foreground hover:text-foreground bg-transparent"
            >Cancelar</button>
            <button
              onClick={handleCreate}
              disabled={submitting || !displayName.trim()}
              className="flex-1 px-3 py-1.5 rounded-lg text-[12px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 border-none inline-flex items-center justify-center gap-1"
            >
              {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
              Cadastrar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-[12px] text-muted-foreground py-2">Carregando…</div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-2">Nenhuma conta cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc: any) => {
            const accLinks = (links || []).filter((l: any) => l.external_account_id === acc.id);
            const linkedProjectIds = new Set(accLinks.map((l: any) => l.project_id));
            const availableProjects = (projects || []).filter((p: any) => !linkedProjectIds.has(p.id));
            const isInactive = acc.status !== "active";
            return (
              <div key={acc.id} className={`rounded-xl border border-border bg-secondary/40 ${isInactive ? "opacity-60" : ""}`}>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-foreground truncate">{acc.display_name}</p>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
                        {PLATFORMS.find(p => p.value === acc.platform)?.label || acc.platform}
                      </span>
                      {isInactive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Inativa</span>
                      )}
                    </div>
                    {(acc.handle || acc.external_id) && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {acc.handle && <span>{acc.handle}</span>}
                        {acc.handle && acc.external_id && <span> · </span>}
                        {acc.external_id && <span>ID {acc.external_id}</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleStatus(acc)}
                      title={isInactive ? "Ativar" : "Inativar"}
                      className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground bg-transparent"
                    >
                      {isInactive ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLinkOpenFor(linkOpenFor === acc.id ? null : acc.id); setSelectedProjectId(""); }}
                      title="Vincular a projeto"
                      className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground bg-transparent"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {linkOpenFor === acc.id && (
                  <div className="px-3 pb-2 flex gap-2">
                    <select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-primary/50"
                    >
                      <option value="">Selecione um projeto…</option>
                      {availableProjects.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedProjectId}
                      onClick={() => linkToProject(acc.id)}
                      className="px-3 py-1.5 rounded-lg text-[12px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 border-none"
                    >Vincular</button>
                  </div>
                )}

                {accLinks.length > 0 && (
                  <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                    {accLinks.map((l: any) => {
                      const proj = (projects || []).find((p: any) => p.id === l.project_id);
                      return (
                        <span key={l.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background border border-border text-[11px] text-foreground">
                          {proj?.name || "Projeto"}
                          <button
                            type="button"
                            onClick={() => unlink(l.id)}
                            title="Desvincular"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Link2Off className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

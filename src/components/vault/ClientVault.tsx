import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  KeyRound, Link2, Server, Plus, Eye, EyeOff, Copy, ExternalLink,
  Pencil, Trash2, X, Loader2, Globe,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";

type Category = "password" | "link" | "system";

interface VaultItem {
  id: string;
  client_id: string;
  category: Category;
  title: string;
  url: string | null;
  username: string | null;
  password: string | null;
  notes: string | null;
  icon_url: string | null;
  created_at: string;
}

const CATEGORY_META: Record<Category, { label: string; icon: any; color: string }> = {
  password: { label: "Senha", icon: KeyRound, color: "text-primary" },
  link: { label: "Link Útil", icon: Link2, color: "text-sky-400" },
  system: { label: "Sistema", icon: Server, color: "text-amber-400" },
};

function faviconFor(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return null;
  }
}

function normalizeUrl(url: string | null) {
  if (!url) return "";
  return url.startsWith("http") ? url : `https://${url}`;
}

interface Props {
  clientId: string;
  /** When true, shows admin/team add/edit/delete controls. */
  canManage: boolean;
}

export default function ClientVault({ clientId, canManage }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<VaultItem> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ["client-vault", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_vault")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true });
      return (data || []) as VaultItem[];
    },
    enabled: !!clientId,
  });

  const copy = async (text: string | null, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  const save = async () => {
    if (!editing?.title?.trim()) {
      toast.error("Informe um título");
      return;
    }
    setSaving(true);
    const payload = {
      client_id: clientId,
      category: (editing.category || "password") as Category,
      title: editing.title.trim(),
      url: editing.url?.trim() || null,
      username: editing.username?.trim() || null,
      password: editing.password || null,
      notes: editing.notes?.trim() || null,
      icon_url: editing.icon_url?.trim() || null,
    };
    if (editing.id) {
      const { error } = await supabase.from("client_vault").update(payload as any).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Item atualizado");
    } else {
      const { error } = await supabase.from("client_vault").insert({ ...payload, created_by: user?.id } as any);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Item adicionado");
    }
    setEditing(null);
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["client-vault", clientId] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("client_vault").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Item removido");
    setConfirmDelete(null);
    qc.invalidateQueries({ queryKey: ["client-vault", clientId] });
  };

  const grouped = (items || []).reduce<Record<Category, VaultItem[]>>(
    (acc, it) => {
      (acc[it.category] ||= []).push(it);
      return acc;
    },
    { password: [], link: [], system: [] }
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <button
          onClick={() => setEditing({ category: "password" })}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer border-none font-medium"
        >
          <Plus className="w-4 h-4" /> Adicionar item ao cofre
        </button>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !items || items.length === 0 ? (
        <div className="text-center py-10 text-[12px] text-muted-foreground">
          <KeyRound className="w-8 h-8 mx-auto mb-3 opacity-40" />
          Nenhum item no cofre ainda.
        </div>
      ) : (
        (Object.keys(CATEGORY_META) as Category[]).map((cat) => {
          const list = grouped[cat];
          if (!list || list.length === 0) return null;
          const Meta = CATEGORY_META[cat];
          return (
            <section key={cat} className="space-y-2">
              <div className="flex items-center gap-2">
                <Meta.icon className={`w-3.5 h-3.5 ${Meta.color}`} />
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {Meta.label} <span className="opacity-60">({list.length})</span>
                </h3>
              </div>

              <div className="space-y-2">
                {list.map((it) => {
                  const fav = it.icon_url || faviconFor(it.url);
                  const isRevealed = !!revealed[it.id];
                  return (
                    <div key={it.id} className="bg-secondary/50 border border-border rounded-xl p-3.5 space-y-2.5">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {fav ? (
                            <img src={fav} alt="" className="w-5 h-5 object-contain" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                          ) : (
                            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{it.title}</p>
                          {it.url && (
                            <a
                              href={normalizeUrl(it.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-muted-foreground hover:text-primary transition-colors truncate inline-flex items-center gap-1"
                            >
                              {it.url} <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setEditing(it)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors bg-transparent border-none cursor-pointer"
                              title="Editar"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(it.id)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors bg-transparent border-none cursor-pointer"
                              title="Remover"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {(it.username || it.password) && (
                        <div className="grid grid-cols-1 gap-1.5 pt-0.5">
                          {it.username && (
                            <div className="flex items-center gap-2 bg-background/60 border border-border rounded-lg px-3 py-2">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-16 shrink-0">Usuário</span>
                              <span className="text-[12px] text-foreground font-mono flex-1 truncate">{it.username}</span>
                              <button
                                onClick={() => copy(it.username, "Usuário")}
                                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
                                title="Copiar"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {it.password && (
                            <div className="flex items-center gap-2 bg-background/60 border border-border rounded-lg px-3 py-2">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-16 shrink-0">Senha</span>
                              <span className="text-[12px] text-foreground font-mono flex-1 truncate">
                                {isRevealed ? it.password : "•".repeat(Math.min(12, it.password.length))}
                              </span>
                              <button
                                onClick={() => setRevealed((r) => ({ ...r, [it.id]: !r[it.id] }))}
                                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
                                title={isRevealed ? "Ocultar" : "Mostrar"}
                              >
                                {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                              <button
                                onClick={() => copy(it.password, "Senha")}
                                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
                                title="Copiar"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {it.notes && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap pt-1 border-t border-border/60">
                          {it.notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* Editor modal */}
      {editing && canManage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !saving && setEditing(null)} />
          <div className="relative bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
              <h2 className="text-sm font-semibold text-foreground">
                {editing.id ? "Editar item" : "Novo item do cofre"}
              </h2>
              <button onClick={() => !saving && setEditing(null)} className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Categoria</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(CATEGORY_META) as Category[]).map((c) => {
                    const M = CATEGORY_META[c];
                    const active = (editing.category || "password") === c;
                    return (
                      <button
                        key={c}
                        onClick={() => setEditing({ ...editing, category: c })}
                        className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-[11px] border transition-colors cursor-pointer ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <M.icon className="w-3.5 h-3.5" />
                        {M.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Título *</label>
                <input
                  value={editing.title || ""}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="Ex: Meta Ads, Google Analytics, WordPress"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">URL / Link</label>
                <input
                  value={editing.url || ""}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  placeholder="https://..."
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
              </div>

              {(editing.category || "password") !== "link" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Usuário / E-mail</label>
                    <input
                      value={editing.username || ""}
                      onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                      className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Senha</label>
                    <input
                      type="text"
                      value={editing.password || ""}
                      onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                      className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notas (opcional)</label>
                <textarea
                  rows={3}
                  value={editing.notes || ""}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  placeholder="Detalhes adicionais, instruções, 2FA..."
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Ícone customizado (URL, opcional)</label>
                <input
                  value={editing.icon_url || ""}
                  onChange={(e) => setEditing({ ...editing, icon_url: e.target.value })}
                  placeholder="Deixe vazio para usar favicon automático"
                  className="w-full bg-secondary border border-border rounded-[10px] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-card">
              <button
                onClick={() => !saving && setEditing(null)}
                disabled={saving}
                className="px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-[13px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors border-none cursor-pointer font-medium flex items-center gap-2"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title="Remover item do cofre?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Remover"
      />
    </div>
  );
}

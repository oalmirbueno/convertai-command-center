import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  KeyRound, Link2, Server, Plus, Eye, EyeOff, Copy, ExternalLink,
  Pencil, Trash2, Loader2, Globe,
} from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  juntar,
  texto,
} from "@/components/sistema";

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

const CATEGORY_META: Record<Category, { label: string; plural: string; icon: any; color: string }> = {
  password: { label: "Senha", plural: "Senhas", icon: KeyRound, color: "text-primary" },
  link: { label: "Link útil", plural: "Links úteis", icon: Link2, color: "text-sky-400" },
  system: { label: "Sistema", plural: "Sistemas", icon: Server, color: "text-amber-400" },
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

/**
 * Cofre de acessos de um cliente: lista com divisória (sem cartão por item),
 * agrupada por categoria. Usado na página /cofre e dentro da gaveta do
 * cliente (EditClientDrawer): tem de caber numa coluna estreita.
 */
export default function ClientVault({ clientId, canManage }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<VaultItem> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const { data: items, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["client-vault", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_vault")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true });
      if (error) throw error;
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

  const total = (items || []).length;
  const novoItem = canManage ? (
    <button type="button" onClick={() => setEditing({ category: "password" })} className={botao.primario}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Novo item
    </button>
  ) : null;
  const categoriaAtual = (editing?.category || "password") as Category;

  return (
    <div className="min-w-0">
      {isLoading && !items ? (
        <Carregando forma="lista" linhas={3} rotulo="Carregando o cofre" />
      ) : isError && !items ? (
        <EstadoDeErro
          titulo="Não foi possível abrir o cofre."
          acao={
            <button type="button" className={botao.secundario} onClick={() => void refetch()} disabled={isFetching}>
              Tentar de novo
            </button>
          }
        />
      ) : total === 0 ? (
        <EstadoVazio compacto titulo="Cofre vazio." descricao="Nenhum acesso guardado ainda." acao={novoItem} />
      ) : (
        <>
          <div className="mb-3 flex min-w-0 items-center justify-between">
            <p className={juntar(texto.auxiliar, "mr-3 min-w-0 truncate tabular-nums")}>
              {total} {total === 1 ? "item" : "itens"}
            </p>
            {novoItem}
          </div>
          <div className="space-y-5">
            {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
              const list = grouped[cat];
              if (!list || list.length === 0) return null;
              const Meta = CATEGORY_META[cat];
              return (
                <section key={cat} className="min-w-0">
                  <h3 className={juntar(texto.rotulo, "mb-1 flex items-center")}>
                    <Meta.icon className={`mr-1.5 h-3.5 w-3.5 ${Meta.color}`} aria-hidden="true" />
                    {Meta.plural}
                    <span className="ml-1 tabular-nums">{list.length}</span>
                  </h3>
                  <ul className="divide-y divide-border border-y border-border">
                    {list.map((it) => {
                      const fav = it.icon_url || faviconFor(it.url);
                      const isRevealed = !!revealed[it.id];
                      return (
                        <li key={it.id} className="min-w-0 py-3">
                          <div className="flex min-w-0 items-start">
                            <div className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                              {fav ? (
                                <img src={fav} alt="" className="h-5 w-5 object-contain" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                              ) : (
                                <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={juntar(texto.corpo, "truncate font-medium")}>{it.title}</p>
                              {it.url && (
                                <a
                                  href={normalizeUrl(it.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex max-w-full items-center text-[12px] text-muted-foreground transition-colors hover:text-primary"
                                >
                                  <span className="truncate">{it.url}</span>
                                  <ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                            {canManage && (
                              <div className="ml-2 flex shrink-0 items-center">
                                <button type="button" onClick={() => setEditing(it)} className={botao.icone} aria-label={`Editar ${it.title}`} title="Editar">
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDelete(it.id)}
                                  className={juntar(botao.icone, "hover:text-destructive")}
                                  aria-label={`Remover ${it.title}`}
                                  title="Remover"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </div>

                          {(it.username || it.password) && (
                            <dl className="mt-2 space-y-1 pl-11">
                              {it.username && (
                                <div className="flex min-w-0 items-center">
                                  <dt className={juntar(texto.rotulo, "w-16 shrink-0")}>Usuário</dt>
                                  <dd className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{it.username}</dd>
                                  <button type="button" onClick={() => copy(it.username, "Usuário")} className={botao.icone} aria-label="Copiar usuário" title="Copiar">
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                              {it.password && (
                                <div className="flex min-w-0 items-center">
                                  <dt className={juntar(texto.rotulo, "w-16 shrink-0")}>Senha</dt>
                                  <dd className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
                                    {isRevealed ? it.password : "•".repeat(Math.min(12, it.password.length))}
                                  </dd>
                                  <button
                                    type="button"
                                    onClick={() => setRevealed((r) => ({ ...r, [it.id]: !r[it.id] }))}
                                    className={botao.icone}
                                    aria-label={isRevealed ? "Ocultar senha" : "Mostrar senha"}
                                    title={isRevealed ? "Ocultar" : "Mostrar"}
                                  >
                                    {isRevealed ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                                  </button>
                                  <button type="button" onClick={() => copy(it.password, "Senha")} className={botao.icone} aria-label="Copiar senha" title="Copiar">
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                            </dl>
                          )}

                          {it.notes && (
                            <p className={juntar(texto.auxiliar, "mt-2 whitespace-pre-wrap pl-11 leading-5 [overflow-wrap:anywhere]")}>{it.notes}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* Editor: janela do sistema (portal), acima da gaveta do cliente quando usado lá. */}
      <Dialog
        open={!!editing && canManage}
        onOpenChange={(aberto) => {
          if (!aberto && !saving) setEditing(null);
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
            <DialogTitle className={texto.tituloSecao}>{editing?.id ? "Editar item" : "Novo item do cofre"}</DialogTitle>
            <DialogDescription className="sr-only">Título, endereço, usuário, senha e notas do acesso.</DialogDescription>
          </DialogHeader>

          {editing && (
            <form
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!saving) void save();
              }}
              id="cofre-editor"
            >
              <div className="mb-4">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Categoria</p>
                <SeletorCompacto
                  rotulo="Categoria"
                  larguraTotal
                  valor={categoriaAtual}
                  onEscolher={(c) => setEditing({ ...editing, category: c as Category })}
                  opcoes={(Object.keys(CATEGORY_META) as Category[]).map((c) => {
                    const M = CATEGORY_META[c];
                    return { valor: c, rotulo: M.label, icone: <M.icon className="h-3.5 w-3.5" /> };
                  })}
                />
              </div>
              <GrupoDeCampos>
                <CampoDeFormulario rotulo="Título" obrigatorio>
                  <input
                    value={editing.title || ""}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder="Ex.: Meta Ads, WordPress"
                    className={campo}
                    autoFocus
                  />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Endereço (URL)">
                  <input
                    value={editing.url || ""}
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    placeholder="https://..."
                    className={campo}
                    inputMode="url"
                  />
                </CampoDeFormulario>
                {categoriaAtual !== "link" && (
                  <>
                    <CampoDeFormulario rotulo="Usuário ou e-mail">
                      <input
                        value={editing.username || ""}
                        onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                        className={campo}
                        autoComplete="off"
                      />
                    </CampoDeFormulario>
                    <CampoDeFormulario rotulo="Senha">
                      <input
                        type="text"
                        value={editing.password || ""}
                        onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                        className={juntar(campo, "font-mono")}
                        autoComplete="off"
                      />
                    </CampoDeFormulario>
                  </>
                )}
                <CampoDeFormulario rotulo="Notas" largo apoio="Opcional. Ex.: instruções, 2FA.">
                  <textarea
                    rows={3}
                    value={editing.notes || ""}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                    className={juntar(campoTexto, "resize-none")}
                  />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Ícone (URL)" largo apoio="Vazio usa o ícone do site." >
                  <input
                    value={editing.icon_url || ""}
                    onChange={(e) => setEditing({ ...editing, icon_url: e.target.value })}
                    className={campo}
                  />
                </CampoDeFormulario>
              </GrupoDeCampos>
            </form>
          )}

          <div className="flex shrink-0 flex-wrap items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
            <button type="button" onClick={() => !saving && setEditing(null)} disabled={saving} className={botao.discreto}>
              Cancelar
            </button>
            <button type="submit" form="cofre-editor" disabled={saving} className={botao.primario}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </DialogContent>
      </Dialog>

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

import React, { useEffect, useState } from "react";
import { Check, Columns3, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { AjudaRecolhida, SeletorCompacto, Carregando, botao } from "@/components/sistema";

/**
 * Pré-visualização das Notas do Studio (checklist, títulos, @kanban, @help, vídeo, imagem).
 * Fica fora do StudioPanel para a aba Documento do cliente não baixar o Studio inteiro.
 */

// Definições canônicas para o painel de ajuda inline (@help)
const SLASH_HELP: Array<{ cmd: string; label: string; desc: string }> = [
  { cmd: "/help",      label: "Ajuda",              desc: "Abre este guia inline com todos os comandos." },
  { cmd: "/tarefa",    label: "Nova tarefa",        desc: "Cria tarefa no Kanban do projeto. Aceita !alta !urgente @nome 15/07 hoje +3d." },
  { cmd: "/kanban",    label: "Kanban inline",      desc: "Insere @kanban vivo: lista, cria e move tasks reais do projeto sem sair da nota." },
  { cmd: "/imagem",    label: "Imagem OCR",         desc: "Envia uma imagem e extrai o texto automaticamente na nota." },
  { cmd: "/video",     label: "Embed de vídeo",     desc: "Cole link YouTube/Vimeo/Drive e renderiza o player inline." },
  { cmd: "/mapa",      label: "Mapa mental",        desc: "Insere estrutura hierárquica em texto (edite os ramos)." },
  { cmd: "/checklist", label: "Checklist",          desc: "Lista com caixinhas [ ] clicáveis no preview." },
  { cmd: "/hook",      label: "Bloco HOOK",         desc: "Template de roteiro 0–3s (fala, imagem, texto em tela)." },
  { cmd: "/desenv",    label: "Bloco DESENV.",      desc: "Template de desenvolvimento (fala, b-roll, sfx)." },
  { cmd: "/cta",       label: "Bloco CTA",          desc: "Template de chamada final." },
  { cmd: "/brief",     label: "Template Briefing",  desc: "Objetivo, público, canal, duração, tom, referências." },
  { cmd: "/cliente",   label: "Cliente atual",      desc: "Insere o nome do cliente ativo." },
  { cmd: "/pasta",     label: "Pasta atual",        desc: "Insere o caminho da pasta ativa." },
];

const MENTION_HELP: Array<{ cmd: string; label: string; desc: string }> = [
  { cmd: "@arquivo",  label: "Arquivo",  desc: "Digite @ + nome: busca fuzzy nos arquivos da pasta e insere link clicável (wsfile)." },
  { cmd: "@kanban",   label: "Kanban",   desc: "Bloco vivo do Kanban do projeto renderizado dentro da nota." },
  { cmd: "@video",    label: "Vídeo",    desc: "Player embutido: @video[nome](url_embed). Colar link gera automaticamente." },
  { cmd: "@help",     label: "Ajuda",    desc: "Renderiza este painel de ajuda inline no ponto onde estiver escrito." },
];

export function NotesPreview({ src, clientId, clientName, onChange }: { src: string; clientId?: string | null; clientName?: string | null; onChange?: (next: string) => void }) {
  const lines = src.split("\n");
  const toggleAt = (idx: number) => {
    if (!onChange) return;
    const copy = [...lines];
    const m = copy[idx]?.match(/^(\s*)- \[( |x|X)\] (.+)$/);
    if (!m) return;
    const checked = m[2].toLowerCase() === "x";
    copy[idx] = `${m[1]}- [${checked ? " " : "x"}] ${m[3]}`;
    onChange(copy.join("\n"));
  };
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    // bloco kanban inline (funcional, dentro do texto)
    if (raw.trim() === "@kanban") {
      out.push(<InlineKanbanBlock key={i} clientId={clientId ?? null} clientName={clientName ?? null} />);
      return;
    }
    if (raw.trim() === "@help") {
      out.push(<InlineHelpBlock key={i} />);
      return;
    }

    // vídeo embed
    const v = raw.match(/^@video\[([^\]]*)\]\((https?:[^)]+)\)\s*$/);
    if (v) {
      out.push(
        // Proporção 16:9 por padding-bottom (sem aspect-ratio, Safari 11).
        <div key={i} className="my-2 w-full max-w-md overflow-hidden rounded border border-border">
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe src={v[2]} className="absolute inset-0 h-full w-full" allow="autoplay; encrypted-media" allowFullScreen title={v[1]} />
          </div>
        </div>
      );
      return;
    }
    // imagem markdown
    const img = raw.match(/^!\[([^\]]*)\]\((https?:[^)]+)\)\s*$/);
    if (img) {
      out.push(<img key={i} src={img[2]} alt={img[1]} className="my-2 max-h-48 rounded border border-border" />);
      return;
    }
    // checkbox — clicável quando onChange existe
    const cb = raw.match(/^(\s*)- \[( |x|X)\] (.+)$/);
    if (cb) {
      const checked = cb[2].toLowerCase() === "x";
      out.push(
        <button
          key={i}
          type="button"
          onClick={() => toggleAt(i)}
          className="flex items-start text-[13px] py-1 w-full text-left bg-transparent border-0 hover:bg-secondary/40 rounded px-1 -mx-1 cursor-pointer touch-manipulation"
          style={{ paddingLeft: cb[1].length * 6 + 4 }}
        >
          <span className={cn("mr-2 mt-[3px] w-4 h-4 border rounded-sm flex items-center justify-center shrink-0", checked ? "bg-primary border-primary" : "border-muted-foreground/50")}>
            {checked && <Check className="w-3 h-3 text-primary-foreground" />}
          </span>
          <span className={checked ? "line-through text-muted-foreground" : "text-foreground"}>{cb[3]}</span>
        </button>
      );
      return;
    }
    // heading
    if (raw.startsWith("### ")) { out.push(<div key={i} className="text-[12px] font-semibold text-primary mt-1">{raw.slice(4)}</div>); return; }
    if (raw.startsWith("## "))  { out.push(<div key={i} className="text-[13px] font-bold mt-1">{raw.slice(3)}</div>); return; }
    if (raw.startsWith("# "))   { out.push(<div key={i} className="text-[14px] font-bold mt-1">{raw.slice(2)}</div>); return; }
    if (raw.startsWith("> "))   { out.push(<div key={i} className="border-l-2 border-primary/40 pl-2 text-[11px] text-muted-foreground italic">{raw.slice(2)}</div>); return; }
    if (raw.trim() === "")      { out.push(<div key={i} className="h-1" />); return; }
    // linha simples com wsfile mention
    const withMentions = raw.replace(/\[@([^\]]+)\]\(wsfile:[^)]+\)/g, "@$1");
    out.push(<div key={i} className="text-[12px] leading-relaxed">{withMentions}</div>);
  });
  return <div className="space-y-0.5">{out}</div>;
}

// Guia inline de comandos / e @ renderizado dentro das notas quando existir "@help" numa linha.
function InlineHelpBlock() {
  const [tab, setTab] = useState<"slash" | "at">("slash");
  const items = tab === "slash" ? SLASH_HELP : MENTION_HELP;
  // Um bloco só (28/09): lista com divisória, sem cartão por comando e sem rolagem
  // própria (quem rola é o Documento). A dica foi para o "?" do título.
  return (
    <div className="my-2 rounded-lg border border-primary/30 bg-primary/5">
      <div className="flex min-w-0 items-center border-b border-primary/20 px-2.5 py-1.5">
        <Sparkles className="mr-1.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 truncate text-[12px] font-semibold text-primary">Guia de comandos</span>
        <AjudaRecolhida rotulo="Dicas das notas" className="ml-1.5 mr-auto">
          Cole imagens (OCR automático) e links de vídeo (embed automático). Use Alt+↑/↓ para alternar conversas do agente.
        </AjudaRecolhida>
        <SeletorCompacto
          className="ml-2"
          rotulo="Guia"
          modo="segmentado"
          opcoes={[
            { valor: "slash", rotulo: "/ comandos" },
            { valor: "at", rotulo: "@ menções" },
          ]}
          valor={tab}
          onEscolher={(v) => setTab(v === "at" ? "at" : "slash")}
        />
      </div>
      <ul className="grid grid-cols-1 gap-x-4 px-2.5 py-1 sm:grid-cols-2">
        {items.map(it => (
          <li key={it.cmd} className="min-w-0 border-b border-border/50 py-1.5 last:border-b-0">
            <div className="flex min-w-0 items-baseline">
              <code className="shrink-0 font-mono text-[11px] font-semibold text-primary">{it.cmd}</code>
              <span className="ml-1.5 min-w-0 truncate text-[11px] text-muted-foreground">{it.label}</span>
            </div>
            <p className="text-[12px] leading-snug text-muted-foreground">{it.desc}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}



// Bloco Kanban vivo embutido no fluxo das Notas.
function InlineKanbanBlock({ clientId, clientName }: { clientId: string | null; clientName: string | null }) {
  type Task = { id: string; title: string; status: string; priority: string | null; due_date: string | null; project_id: string };
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "priority" | "due" } | null>(null);

  // Persistência da escolha de projeto por cliente
  const projStorageKey = clientId ? `studio.kanban.pid.${clientId}` : null;

  // 1) Carrega projetos do cliente
  useEffect(() => {
    if (!clientId) { setProjects([]); setProjectId(null); setTasks([]); return; }
    (async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("client_id", clientId).order("created_at", { ascending: false });
      const list = (data || []) as Array<{ id: string; name: string }>;
      setProjects(list);
      const saved = projStorageKey ? localStorage.getItem(projStorageKey) : null;
      const nextPid = list.find(p => p.id === saved)?.id || list[0]?.id || null;
      setProjectId(nextPid);
    })();
  }, [clientId, projStorageKey]);

  // 2) Carrega tasks + realtime do projeto ativo
  useEffect(() => {
    if (!projectId) { setTasks([]); return; }
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("tasks")
        .select("id, title, status, priority, due_date, project_id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (!cancel) { setTasks((data || []) as Task[]); setLoading(false); }
    })();
    const ch = supabase.channel(`ws-kanban-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, (payload) => {
        setTasks(cur => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Task;
            if (cur.some(t => t.id === row.id)) return cur;
            return [row, ...cur];
          }
          if (payload.eventType === "UPDATE") {
            const row = payload.new as Task;
            return cur.map(t => t.id === row.id ? { ...t, ...row } : t);
          }
          if (payload.eventType === "DELETE") {
            const row = payload.old as Task;
            return cur.filter(t => t.id !== row.id);
          }
          return cur;
        });
      })
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [projectId]);

  const cols: Array<{ key: string; title: string }> = [
    { key: "todo", title: "A fazer" },
    { key: "doing", title: "Em andamento" },
    { key: "review", title: "Revisão" },
    { key: "done", title: "Feito" },
  ];

  async function patch(taskId: string, changes: Partial<Task>) {
    setTasks(cur => cur.map(t => t.id === taskId ? { ...t, ...changes } : t));
    const { error } = await supabase.from("tasks").update(changes as any).eq("id", taskId);
    if (error) { toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" }); void reload(); }
  }

  async function reload() {
    if (!projectId) return;
    const { data } = await supabase.from("tasks")
      .select("id, title, status, priority, due_date, project_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setTasks((data || []) as Task[]);
  }

  async function quickAdd() {
    const title = newTitle.trim();
    if (!title || !projectId) return;
    const { data, error } = await supabase.from("tasks")
      .insert({ project_id: projectId, title, status: "todo", priority: "medium" })
      .select("id, title, status, priority, due_date, project_id")
      .single();
    if (!error && data) { setTasks(cur => [data as Task, ...cur]); setNewTitle(""); }
    else if (error) toast({ title: "Erro ao criar tarefa", description: error.message, variant: "destructive" });
  }

  function onDrop(colKey: string) {
    if (!dragId) return;
    const t = tasks.find(x => x.id === dragId);
    setDragId(null); setDropCol(null);
    if (!t || t.status === colKey) return;
    void patch(dragId, { status: colKey });
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-secondary/20">
      {/* Cabeçalho numa linha: nome, cliente e projeto, o "?" com o como usar e recarregar. */}
      <div className="flex min-w-0 items-center border-b border-border bg-secondary/40 px-3 py-2 text-[12px]">
        <Columns3 className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="shrink-0 font-semibold">Kanban</span>
        <span className="ml-1.5 min-w-0 truncate text-muted-foreground">· {clientName || "cliente"}</span>
        {projects.length > 1 ? (
          <select
            value={projectId ?? ""}
            onChange={e => { const v = e.target.value || null; setProjectId(v); if (v && projStorageKey) localStorage.setItem(projStorageKey, v); }}
            aria-label="Projeto do Kanban"
            className="ml-2 h-7 max-w-[160px] rounded border border-border bg-background px-1.5 text-[12px]"
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : projects[0] && (
          <span className="ml-1.5 min-w-0 truncate text-muted-foreground">/ {projects[0].name}</span>
        )}
        <AjudaRecolhida rotulo="Como usar o Kanban" className="ml-1.5">
          Arraste os cards entre colunas. Clique em prioridade ou prazo para editar. As alterações são salvas em tempo real.
        </AjudaRecolhida>
        <button type="button" onClick={() => void reload()} aria-label="Recarregar o Kanban" title="Recarregar" className={cn(botao.icone, "ml-auto h-7 w-7")}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {!clientId ? (
        <p className="p-3 text-[11px] text-muted-foreground">Selecione um cliente no Workspace para ver o Kanban.</p>
      ) : loading && tasks.length === 0 ? (
        <Carregando rotulo="Carregando o Kanban" linhas={2} className="p-3" />
      ) : !projectId ? (
        <p className="p-3 text-[11px] text-muted-foreground">Este cliente ainda não tem projeto ativo.</p>
      ) : (
        <>
          <div className="flex items-center gap-1 px-2 pt-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void quickAdd(); } }}
              placeholder="+ nova tarefa (Enter)"
              className="flex-1 h-7 px-2 rounded border border-border bg-background text-[11px] focus:outline-none focus:border-primary/50" />
            <button onClick={() => void quickAdd()} disabled={!newTitle.trim()} className="h-7 px-2 rounded bg-primary text-primary-foreground text-[10px] disabled:opacity-40">Add</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
            {cols.map(col => (
              <div
                key={col.key}
                onDragOver={e => { e.preventDefault(); setDropCol(col.key); }}
                onDragLeave={() => setDropCol(cur => cur === col.key ? null : cur)}
                onDrop={() => onDrop(col.key)}
                className={cn(
                  "rounded-md p-1.5 space-y-1 transition-colors min-h-[80px]",
                  dropCol === col.key ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/50"
                )}
              >
                <div className="text-[11px] font-semibold text-muted-foreground px-1 flex items-center justify-between">
                  <span>{col.title}</span>
                  <span className="opacity-60">{tasks.filter(t => t.status === col.key).length}</span>
                </div>
                {tasks.filter(t => t.status === col.key).map(t => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => { setDragId(null); setDropCol(null); }}
                    className={cn(
                      "bg-card rounded p-1.5 border border-border text-[10.5px] space-y-1 cursor-grab active:cursor-grabbing",
                      dragId === t.id && "opacity-50"
                    )}
                  >
                    <div className="font-medium leading-snug">{t.title}</div>
                    <div className="flex items-center gap-1 flex-wrap text-[9px] text-muted-foreground">
                      {editing?.id === t.id && editing.field === "priority" ? (
                        <select
                          autoFocus
                          value={t.priority ?? "medium"}
                          onChange={e => { void patch(t.id, { priority: e.target.value }); setEditing(null); }}
                          onBlur={() => setEditing(null)}
                          className="h-5 px-1 rounded border border-border bg-background text-[9px]"
                        >
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                          <option value="urgent">urgent</option>
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditing({ id: t.id, field: "priority" })}
                          className={cn("px-1 py-0.5 rounded hover:opacity-80",
                            t.priority === "urgent" ? "bg-destructive/20 text-destructive" :
                            t.priority === "high" ? "bg-amber-500/20 text-amber-600" :
                            t.priority === "low" ? "bg-secondary" : "bg-secondary")}
                          title="Alterar prioridade"
                        >{t.priority || "medium"}</button>
                      )}
                      {editing?.id === t.id && editing.field === "due" ? (
                        <input
                          autoFocus
                          type="date"
                          defaultValue={t.due_date ?? ""}
                          onBlur={e => { const v = e.target.value || null; if (v !== t.due_date) void patch(t.id, { due_date: v }); setEditing(null); }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                          className="h-5 px-1 rounded border border-border bg-background text-[9px]"
                        />
                      ) : (
                        <button
                          onClick={() => setEditing({ id: t.id, field: "due" })}
                          className="px-1 py-0.5 rounded border border-dashed border-border/60 hover:bg-secondary"
                          title="Definir prazo"
                        >{t.due_date ? `Prazo ${t.due_date}` : "Prazo"}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

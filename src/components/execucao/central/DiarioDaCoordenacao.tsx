import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Check, ChevronDown, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { textoDoErro } from "@/lib/mesa/api";
import { contextoDoPedido } from "@/lib/carteiraOperacao";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Carregando, EstadoDeErro, juntar } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";
import type { ContextoDoHermes } from "./ChatDoHermes";

/**
 * Diário da coordenação (Central de Autonomia, 08/10/2026).
 *
 * O canal que o consumidor do Hermes lê a cada minuto: a mensagem vai como
 * instrução no diário do vínculo escolhido e a resposta volta no mesmo diário.
 * A escolha do vínculo é por busca: cliente, agente, título curto e o estado
 * em cor; o detalhe completo aparece só depois de escolher.
 */

export type VinculoDaCoordenacao = {
  id: string;
  status: string;
  updated_at: string;
  operator_id: string;
  tarefa: string | null;
  estado_da_tarefa: string | null;
  cliente: string | null;
  agente: string;
};
type Entrada = { id: string; entry_type: string; title: string | null; body: string; author_kind: string; created_at: string };

/** Estado do vínculo ou da tarefa: rótulo e cor do ponto. */
const ESTADO: Record<string, { rotulo: string; ponto: string }> = {
  queued: { rotulo: "Na fila", ponto: "bg-muted-foreground" },
  todo: { rotulo: "A fazer", ponto: "bg-muted-foreground" },
  in_progress: { rotulo: "Em andamento", ponto: "bg-info" },
  doing: { rotulo: "Em andamento", ponto: "bg-info" },
  review: { rotulo: "Em revisão", ponto: "bg-warning" },
  awaiting_input: { rotulo: "Esperando você", ponto: "bg-warning" },
  blocked: { rotulo: "Bloqueado", ponto: "bg-destructive" },
  done: { rotulo: "Concluído", ponto: "bg-success" },
  cancelled: { rotulo: "Cancelado", ponto: "bg-muted-foreground/50" },
};
const estadoDe = (s: string | null | undefined) => (s && ESTADO[s]) || { rotulo: s || "sem estado", ponto: "bg-muted-foreground/50" };

const TITULO_CURTO = 48;
export const tituloCurto = (t: string | null | undefined) => {
  const s = (t || "Conversa da coordenação").trim();
  return s.length > TITULO_CURTO ? `${s.slice(0, TITULO_CURTO - 1).trimEnd()}…` : s;
};

const hora = (v: string | null | undefined) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

async function lerVinculos(): Promise<VinculoDaCoordenacao[]> {
  const s = supabase as any;
  const ops = await s.from("internal_operators").select("id, slug, display_name, is_coordinator").eq("status", "active");
  if (ops.error) throw new Error(ops.error.message);
  const coord = (ops.data || []).filter((o: any) => o.is_coordinator || o.slug === "augusto");
  if (!coord.length) return [];
  const l = await s.from("operator_task_links").select("id, status, updated_at, operator_id, kanban_task_id").in("operator_id", coord.map((o: any) => o.id)).not("status", "in", "(cancelled,done)").order("updated_at", { ascending: false }).limit(15);
  if (l.error) throw new Error(l.error.message);
  const ids = [...new Set((l.data || []).map((v: any) => v.kanban_task_id).filter(Boolean))];
  const t = ids.length
    ? await s.from("tasks").select("id, title, status, project:projects!tasks_project_id_fkey(client:profiles!projects_client_id_fkey(company_name,full_name))").in("id", ids)
    : { data: [] };
  const tarefas = new Map<string, { title: string | null; status: string | null; cliente: string | null }>(
    (t.data || []).map((x: any) => [x.id, { title: x.title || null, status: x.status || null, cliente: x.project?.client?.company_name || x.project?.client?.full_name || null }]),
  );
  const nome = new Map(coord.map((o: any) => [o.id, o.display_name]));
  return (l.data || []).map((v: any) => {
    const tarefa = tarefas.get(v.kanban_task_id);
    return {
      id: v.id,
      status: v.status,
      updated_at: v.updated_at,
      operator_id: v.operator_id,
      tarefa: tarefa?.title || null,
      estado_da_tarefa: tarefa?.status || null,
      cliente: tarefa?.cliente || null,
      agente: String(nome.get(v.operator_id) || "Coordenação"),
    };
  });
}

function SeletorDeVinculo({ vinculos, escolhido, aoEscolher }: { vinculos: VinculoDaCoordenacao[]; escolhido: VinculoDaCoordenacao | null; aoEscolher: (id: string) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Conversa da coordenação" className="flex h-9 w-full min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-left text-[12px] hover:bg-muted/50">
          {escolhido ? (
            <>
              <span className={juntar("h-2 w-2 shrink-0 rounded-full", estadoDe(escolhido.status).ponto)} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{escolhido.cliente || "Sem cliente"}</span>
                <span className="text-muted-foreground"> · {tituloCurto(escolhido.tarefa)}</span>
              </span>
            </>
          ) : <span className="flex-1 text-muted-foreground">Escolha a conversa</span>}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(92vw,380px)] p-0">
        <Command label="Conversas da coordenação">
          <CommandInput placeholder="Buscar por cliente, agente ou tarefa" aria-label="Buscar conversa da coordenação" className="h-10 text-[13px]" />
          <CommandList className={juntar(ROLAGEM_OPERACAO, "max-h-[320px]")}>
            <CommandEmpty className="px-3 py-4 text-center text-[12px] text-muted-foreground">Nada com esse nome.</CommandEmpty>
            <CommandGroup>
              {vinculos.map((v) => {
                const e = estadoDe(v.status);
                return (
                  <CommandItem
                    key={v.id}
                    value={`${v.cliente || ""} ${v.agente} ${v.tarefa || ""} ${e.rotulo} ${v.id}`}
                    onSelect={() => { aoEscolher(v.id); setAberto(false); }}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2"
                    data-vinculo={v.id}
                  >
                    <span className={juntar("h-2 w-2 shrink-0 rounded-full", e.ponto)} title={e.rotulo} aria-label={e.rotulo} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate font-medium text-foreground">{v.cliente || "Sem cliente"}</span>
                        <span className="shrink-0">· {v.agente}</span>
                      </span>
                      <span className="block truncate text-[13px]" title={v.tarefa || undefined}>{tituloCurto(v.tarefa)}</span>
                    </span>
                    {escolhido?.id === v.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function DiarioDaCoordenacao({ contexto }: { contexto: ContextoDoHermes }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [vinculo, setVinculo] = useState<string>("");
  const [levar, setLevar] = useState(true);
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const vinculos = useQuery({ queryKey: ["hermes", "diario", "vinculos"], queryFn: lerVinculos, staleTime: 60_000 });
  const lista = useMemo(() => vinculos.data || [], [vinculos.data]);
  const escolhido = lista.find((v) => v.id === vinculo) || lista[0] || null;
  const escolhidoId = escolhido?.id || "";
  const entradas = useQuery({
    queryKey: ["hermes", "diario", escolhidoId],
    enabled: !!escolhidoId,
    refetchInterval: 8000,
    queryFn: async () => {
      const r = await (supabase as any).from("operator_participations").select("id, entry_type, title, body, author_kind, created_at").eq("task_link_id", escolhidoId).order("created_at", { ascending: false }).limit(40);
      if (r.error) throw new Error(r.error.message);
      return ((r.data || []) as Entrada[]).reverse();
    },
  });
  useEffect(() => { fim.current?.scrollIntoView?.({ block: "end" }); }, [entradas.data?.length]);
  const enviar = useMutation({
    mutationFn: async (t: string) => {
      const corpo = levar && contexto.cliente ? contextoDoPedido(contexto.cliente, `${contexto.projeto ? `Projeto: ${contexto.projeto.nome}\n\n` : ""}${t}`) : t;
      const r = await (supabase as any).from("operator_participations").insert({ task_link_id: escolhidoId, author_kind: "humano", author_id: user!.id, entry_type: "instrucao", title: "Pela Central de Autonomia", body: corpo, attachments: [] });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => { setTexto(""); void qc.invalidateQueries({ queryKey: ["hermes", "diario", escolhidoId] }); toast.success("Registrado. O Hermes lê o diário a cada minuto e responde aqui."); },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const mandar = () => { const t = texto.trim(); if (t && escolhidoId && !enviar.isPending) enviar.mutate(t); };

  if (vinculos.isLoading) return <Carregando linhas={3} rotulo="Lendo a coordenação" />;
  if (vinculos.isError) return <EstadoDeErro titulo="Não consegui ler a coordenação." descricao={textoDoErro(vinculos.error)} />;
  if (!lista.length) return <p className="px-1 text-[12px] text-muted-foreground">A coordenação ainda não tem uma tarefa aberta para conversar. Atribua uma tarefa ao coordenador na Execução.</p>;
  const e = estadoDe(escolhido?.status);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SeletorDeVinculo vinculos={lista} escolhido={escolhido} aoEscolher={setVinculo} />
      {escolhido && (
        <div className="mt-1.5 shrink-0 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-[11px] text-muted-foreground" aria-label="Detalhe da conversa escolhida">
          <p className="break-words text-[12px] font-medium text-foreground">{escolhido.tarefa || "Conversa da coordenação"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
            <span className="inline-flex items-center gap-1"><span className={juntar("h-1.5 w-1.5 rounded-full", e.ponto)} aria-hidden="true" />{e.rotulo}</span>
            <span>· {escolhido.agente}</span>
            <span>· {escolhido.cliente || "Sem cliente"}</span>
            {hora(escolhido.updated_at) && <span>· atualizado {hora(escolhido.updated_at)}</span>}
          </p>
        </div>
      )}
      <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1 space-y-2 py-2")}>
        {entradas.isLoading ? <Carregando linhas={3} rotulo="Abrindo o diário" /> : (entradas.data || []).map((m) => (
          <div key={m.id} className={m.author_kind === "humano" ? "ml-auto max-w-[88%] rounded-[18px] rounded-tr-md bg-primary/90 px-3 py-2 text-[13px] text-primary-foreground" : "max-w-[92%] rounded-[18px] rounded-tl-md bg-muted/70 px-3 py-2 text-[13px]"}>
            {m.title && <p className="text-[11px] font-semibold opacity-80">{m.title}</p>}
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body.length > 2500 ? `${m.body.slice(0, 2500)}…` : m.body}</p>
            <p className="mt-0.5 text-[10px] opacity-60">{m.entry_type} · {hora(m.created_at)}</p>
          </div>
        ))}
        <div ref={fim} />
      </div>
      <div className="shrink-0 pt-2">
        {contexto.cliente && (
          <button
            type="button"
            aria-pressed={levar}
            onClick={() => setLevar((v) => !v)}
            className={juntar("mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px]", levar ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground line-through")}
          >
            {levar ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
            <span className="truncate">Levar contexto: {contexto.cliente.nome}{contexto.projeto ? ` · ${contexto.projeto.nome}` : ""}</span>
          </button>
        )}
        <div className="flex min-w-0 items-end gap-1.5 rounded-[22px] border border-border bg-background py-1 pl-3 pr-1 focus-within:border-primary/50">
          <textarea
            value={texto}
            onChange={(ev) => setTexto(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); mandar(); } }}
            rows={1}
            placeholder="Instrução para a coordenação (Hermes)…"
            aria-label="Instrução para a coordenação"
            className="max-h-32 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={mandar} disabled={enviar.isPending || !texto.trim()} aria-label="Enviar à coordenação" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowUp, Bot, GitBranch, Loader2, Plus, RefreshCw, Search, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { contextoDoPedido } from "@/lib/carteiraOperacao";
import { Carregando, EstadoDeErro, botao, campo, juntar } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";

/**
 * Hermes ao lado do Gestor (Central de Autonomia, 08/10/2026).
 *
 * Duas formas reais, nunca simuladas:
 * - Sessões do Hermes (quando a ponte do painel no servidor do Hermes está
 *   ligada): listar, abrir, criar, continuar uma sessão do Desktop por fork,
 *   enviar e acompanhar a resposta, com as ferramentas e agentes usados.
 * - Diário da coordenação (sempre): o canal que o consumidor do Hermes já lê a
 *   cada minuto. A mensagem vai como instrução; a resposta do Hermes volta no
 *   mesmo diário.
 * Contexto compartilhado: só a referência do cliente/projeto da conversa do
 * Gestor, e só quando a caixa "Levar o contexto" está marcada.
 */

type Contexto = { cliente: { id: string; nome: string } | null; projeto: { id: string; nome: string } | null };
type Sessao = { id: string; titulo: string; origem: string; ultima_atividade: number | string | null; mensagens: number; ferramentas: number; pode_enviar: boolean; ocupada: boolean };
type MensagemDoHermes = { id: string | number | null; papel: string; texto: string; ferramenta: string | null; chamadas: string[]; quando: number | string | null };

const ORIGEM: Record<string, string> = { desktop: "Desktop", api_server: "Painel/API", cron: "Rotina", cli: "Terminal", kanban: "Kanban", subagent: "Subagente", tool: "Ferramenta", oneshot: "Avulsa" };

const hora = (v: number | string | null) => {
  if (v === null || v === undefined) return "";
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function Compositor({ desativado, placeholder, aoEnviar, ocupado }: { desativado?: boolean; placeholder: string; aoEnviar: (t: string) => void; ocupado?: boolean }) {
  const [t, setT] = useState("");
  const enviar = () => { if (t.trim() && !desativado && !ocupado) { aoEnviar(t.trim()); setT(""); } };
  return (
    <div className="flex items-end gap-1.5 rounded-[22px] border border-border bg-background py-1 pl-3 pr-1 focus-within:border-primary/50">
      <textarea
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
        rows={1}
        disabled={desativado}
        placeholder={placeholder}
        aria-label="Mensagem para o Hermes"
        className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      <button type="button" onClick={enviar} disabled={desativado || ocupado || !t.trim()} aria-label="Enviar ao Hermes" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </button>
    </div>
  );
}

function LevarContexto({ contexto, valor, onMudar }: { contexto: Contexto; valor: boolean; onMudar: (v: boolean) => void }) {
  if (!contexto.cliente) return null;
  return (
    <label className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
      <input type="checkbox" checked={valor} onChange={(e) => onMudar(e.target.checked)} className="h-3.5 w-3.5" />
      Levar o contexto: {contexto.cliente.nome}{contexto.projeto ? ` · ${contexto.projeto.nome}` : ""}
    </label>
  );
}

// ------------------------------------------------------------------ sessões reais (ponte ligada)

function SessoesDoHermes({ contexto }: { contexto: Contexto }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<Sessao | null>(null);
  const [levar, setLevar] = useState(true);
  const [aguardando, setAguardando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const sessoes = useQuery({
    queryKey: ["hermes", "sessoes", busca],
    queryFn: async () => (await chamarFuncao<{ sessoes: Sessao[] }>("gestor-aceleriq", { acao: "hermes_sessoes", busca })).sessoes || [],
    staleTime: 20_000,
  });
  const mensagens = useQuery({
    queryKey: ["hermes", "sessao", aberta?.id],
    enabled: !!aberta,
    queryFn: async () => chamarFuncao<{ sessao: Sessao; mensagens: MensagemDoHermes[] }>("gestor-aceleriq", { acao: "hermes_sessao", sessao_id: aberta!.id }),
    refetchInterval: (q) => (aguardando || (q.state.data as { sessao?: Sessao } | undefined)?.sessao?.ocupada ? 3000 : 30_000),
  });
  const ocupada = !!mensagens.data?.sessao?.ocupada;
  useEffect(() => { if (aguardando && mensagens.data && !mensagens.data.sessao?.ocupada) setAguardando(false); }, [mensagens.data, aguardando]);
  useEffect(() => { fim.current?.scrollIntoView?.({ block: "end" }); }, [mensagens.data?.mensagens?.length, aguardando]);

  const criar = useMutation({
    mutationFn: () => chamarFuncao<{ sessao: Sessao }>("gestor-aceleriq", { acao: "hermes_criar", titulo: contexto.cliente ? contexto.cliente.nome : "Conversa da Central" }),
    onSuccess: (r) => { setAberta(r.sessao); void qc.invalidateQueries({ queryKey: ["hermes", "sessoes"] }); },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const continuar = useMutation({
    mutationFn: (id: string) => chamarFuncao<{ sessao: Sessao }>("gestor-aceleriq", { acao: "hermes_continuar", sessao_id: id }),
    onSuccess: (r) => { setAberta(r.sessao); void qc.invalidateQueries({ queryKey: ["hermes", "sessoes"] }); toast.success("Continuação criada: a sessão original fica intacta."); },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const enviar = useMutation({
    mutationFn: (texto: string) => chamarFuncao("gestor-aceleriq", {
      acao: "hermes_enviar", sessao_id: aberta!.id, texto,
      contexto: levar && contexto.cliente ? { cliente: contexto.cliente, projeto: contexto.projeto } : null,
    }),
    onSuccess: () => { setAguardando(true); void mensagens.refetch(); },
    onError: (e) => toast.error(textoDoErro(e)),
  });

  const agentes = useMemo(() => {
    const s = new Set<string>();
    (mensagens.data?.mensagens || []).forEach((m) => { m.chamadas.forEach((c) => s.add(c)); if (m.ferramenta) s.add(m.ferramenta); });
    return [...s].slice(0, 12);
  }, [mensagens.data]);

  if (aberta) {
    const sessao = mensagens.data?.sessao || aberta;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 pb-2">
          <button type="button" onClick={() => setAberta(null)} className={juntar(botao.icone, "h-7 w-7")} aria-label="Voltar às sessões"><ArrowLeft className="h-3.5 w-3.5" /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{sessao.titulo}</p>
            <p className="text-[11px] text-muted-foreground">{ORIGEM[sessao.origem] || sessao.origem} · {sessao.mensagens} mensagens</p>
          </div>
          <button type="button" onClick={() => void mensagens.refetch()} className={juntar(botao.icone, "h-7 w-7")} aria-label="Atualizar"><RefreshCw className={juntar("h-3.5 w-3.5", mensagens.isFetching && "animate-spin")} /></button>
        </div>
        {agentes.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1 py-1.5" aria-label="Ferramentas e agentes usados">
            {agentes.map((a) => <span key={a} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"><Wrench className="h-2.5 w-2.5" />{a}</span>)}
          </div>
        )}
        <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1 space-y-2 py-2")}>
          {mensagens.isLoading ? <Carregando linhas={3} rotulo="Abrindo a sessão" /> : mensagens.isError ? <EstadoDeErro titulo="Não abriu a sessão." descricao={textoDoErro(mensagens.error)} /> : (mensagens.data?.mensagens || []).filter((m) => m.papel !== "tool" && m.texto.trim()).map((m, i) => (
            <div key={`${m.id}-${i}`} className={m.papel === "user" ? "ml-auto max-w-[88%] rounded-[18px] rounded-tr-md bg-primary/90 px-3 py-2 text-[13px] text-primary-foreground" : "max-w-[92%] rounded-[18px] rounded-tl-md bg-muted/70 px-3 py-2 text-[13px]"}>
              <p className="whitespace-pre-wrap break-words">{m.texto.length > 3000 ? `${m.texto.slice(0, 3000)}…` : m.texto}</p>
              {m.chamadas.length > 0 && <p className="mt-1 text-[10px] opacity-70">usou {m.chamadas.join(", ")}</p>}
              <p className="mt-0.5 text-[10px] opacity-60">{hora(m.quando)}</p>
            </div>
          ))}
          {(aguardando || ocupada) && <div className="flex items-center gap-2 rounded-[18px] bg-muted/70 px-3 py-2 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />O Hermes está trabalhando…</div>}
          <div ref={fim} />
        </div>
        <div className="shrink-0 pt-2">
          {sessao.pode_enviar ? (
            <>
              <LevarContexto contexto={contexto} valor={levar} onMudar={setLevar} />
              <Compositor placeholder="Mensagem para o Hermes…" aoEnviar={(t) => enviar.mutate(t)} ocupado={enviar.isPending || aguardando || ocupada} />
            </>
          ) : (
            <button type="button" onClick={() => continuar.mutate(sessao.id)} disabled={continuar.isPending} className={juntar(botao.secundario, "h-9 w-full text-[12px]")}>
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />Continuar esta sessão no painel (cópia; a original fica intacta)
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex gap-2">
        <label className="relative block flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar sessões" aria-label="Buscar sessões do Hermes" className={juntar(campo, "h-8 pl-8 text-[12px]")} />
        </label>
        <button type="button" onClick={() => criar.mutate()} disabled={criar.isPending} className={juntar(botao.primario, "h-8 px-3 text-[12px]")}><Plus className="mr-1 h-3.5 w-3.5" />Nova</button>
      </div>
      <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1 space-y-0.5")}>
        {sessoes.isLoading ? <Carregando linhas={4} rotulo="Lendo as sessões do Hermes" /> : sessoes.isError ? <EstadoDeErro titulo="Não consegui ler as sessões." descricao={textoDoErro(sessoes.error)} /> : (sessoes.data || []).map((s) => (
          <button key={s.id} type="button" onClick={() => setAberta(s)} className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-muted/60">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Bot className="h-3 w-3" />{ORIGEM[s.origem] || s.origem}<span className="ml-auto">{hora(s.ultima_atividade)}</span></span>
            <span className="mt-0.5 block truncate text-[13px] font-medium">{s.titulo}</span>
            <span className="text-[11px] text-muted-foreground">{s.mensagens} mensagens · {s.ferramentas} ferramentas{s.ocupada ? " · trabalhando" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ diário da coordenação (sempre disponível)

type Vinculo = { id: string; status: string; updated_at: string; operator_id: string; tarefa: string | null; agente: string };
type Entrada = { id: string; entry_type: string; title: string | null; body: string; author_kind: string; created_at: string };

function DiarioDaCoordenacao({ contexto }: { contexto: Contexto }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [vinculo, setVinculo] = useState<string>("");
  const [levar, setLevar] = useState(true);
  const fim = useRef<HTMLDivElement>(null);
  const vinculos = useQuery({
    queryKey: ["hermes", "diario", "vinculos"],
    queryFn: async () => {
      const s = supabase as any;
      const ops = await s.from("internal_operators").select("id, slug, display_name, is_coordinator").eq("status", "active");
      if (ops.error) throw new Error(ops.error.message);
      const coord = (ops.data || []).filter((o: any) => o.is_coordinator || o.slug === "augusto");
      if (!coord.length) return [];
      const l = await s.from("operator_task_links").select("id, status, updated_at, operator_id, kanban_task_id").in("operator_id", coord.map((o: any) => o.id)).not("status", "in", "(cancelled,done)").order("updated_at", { ascending: false }).limit(15);
      if (l.error) throw new Error(l.error.message);
      const ids = [...new Set((l.data || []).map((v: any) => v.kanban_task_id).filter(Boolean))];
      const t = ids.length ? await s.from("tasks").select("id, title").in("id", ids) : { data: [] };
      const titulo = new Map((t.data || []).map((x: any) => [x.id, x.title]));
      const linhas = (l.data || []).map((v: any) => ({ ...v, task: { title: titulo.get(v.kanban_task_id) || null } }));
      const nome = new Map(coord.map((o: any) => [o.id, o.display_name]));
      return (linhas || []).map((v: any) => ({ id: v.id, status: v.status, updated_at: v.updated_at, operator_id: v.operator_id, tarefa: v.task?.title || null, agente: String(nome.get(v.operator_id) || "Coordenação") })) as Vinculo[];
    },
    staleTime: 60_000,
  });
  const escolhido = vinculo || vinculos.data?.[0]?.id || "";
  const entradas = useQuery({
    queryKey: ["hermes", "diario", escolhido],
    enabled: !!escolhido,
    refetchInterval: 8000,
    queryFn: async () => {
      const r = await (supabase as any).from("operator_participations").select("id, entry_type, title, body, author_kind, created_at").eq("task_link_id", escolhido).order("created_at", { ascending: false }).limit(40);
      if (r.error) throw new Error(r.error.message);
      return ((r.data || []) as Entrada[]).reverse();
    },
  });
  useEffect(() => { fim.current?.scrollIntoView?.({ block: "end" }); }, [entradas.data?.length]);
  const enviar = useMutation({
    mutationFn: async (texto: string) => {
      const corpo = levar && contexto.cliente ? contextoDoPedido(contexto.cliente, `${contexto.projeto ? `Projeto: ${contexto.projeto.nome}\n\n` : ""}${texto}`) : texto;
      const r = await (supabase as any).from("operator_participations").insert({ task_link_id: escolhido, author_kind: "humano", author_id: user!.id, entry_type: "instrucao", title: "Pela Central de Autonomia", body: corpo, attachments: [] });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["hermes", "diario", escolhido] }); toast.success("Registrado. O Hermes lê o diário a cada minuto e responde aqui."); },
    onError: (e) => toast.error(textoDoErro(e)),
  });

  if (vinculos.isLoading) return <Carregando linhas={3} rotulo="Lendo a coordenação" />;
  if (vinculos.isError) return <EstadoDeErro titulo="Não consegui ler a coordenação." descricao={textoDoErro(vinculos.error)} />;
  if (!vinculos.data?.length) return <p className="px-1 text-[12px] text-muted-foreground">A coordenação ainda não tem uma tarefa aberta para conversar. Atribua uma tarefa ao coordenador na Execução.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <select value={escolhido} onChange={(e) => setVinculo(e.target.value)} aria-label="Conversa da coordenação" className={juntar(campo, "h-8 shrink-0 text-[12px]")}>
        {vinculos.data.map((v) => <option key={v.id} value={v.id}>{v.agente}: {v.tarefa || "conversa da coordenação"} ({v.status})</option>)}
      </select>
      <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1 space-y-2 py-2")}>
        {entradas.isLoading ? <Carregando linhas={3} rotulo="Abrindo o diário" /> : (entradas.data || []).map((m) => (
          <div key={m.id} className={m.author_kind === "humano" ? "ml-auto max-w-[88%] rounded-[18px] rounded-tr-md bg-primary/90 px-3 py-2 text-[13px] text-primary-foreground" : "max-w-[92%] rounded-[18px] rounded-tl-md bg-muted/70 px-3 py-2 text-[13px]"}>
            {m.title && <p className="text-[11px] font-semibold opacity-80">{m.title}</p>}
            <p className="whitespace-pre-wrap break-words">{m.body.length > 2500 ? `${m.body.slice(0, 2500)}…` : m.body}</p>
            <p className="mt-0.5 text-[10px] opacity-60">{m.entry_type} · {hora(m.created_at)}</p>
          </div>
        ))}
        <div ref={fim} />
      </div>
      <div className="shrink-0 pt-2">
        <LevarContexto contexto={contexto} valor={levar} onMudar={setLevar} />
        <Compositor placeholder="Instrução para a coordenação (Hermes)…" aoEnviar={(t) => enviar.mutate(t)} ocupado={enviar.isPending} />
      </div>
    </div>
  );
}

export default function PainelHermes({ contexto }: { contexto: Contexto }) {
  const estado = useQuery({
    queryKey: ["hermes", "estado"],
    queryFn: () => chamarFuncao<{ configurada: boolean; ok?: boolean; hermes?: unknown; erro?: string }>("gestor-aceleriq", { acao: "hermes_estado" }),
    staleTime: 60_000,
  });
  const [modo, setModo] = useState<"sessoes" | "diario">("sessoes");
  const ponte = !!estado.data?.configurada && !!estado.data?.ok;
  const efetivo = ponte ? modo : "diario";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1 rounded-xl bg-muted/50 p-1" role="tablist" aria-label="Canal com o Hermes">
        <button type="button" role="tab" aria-selected={efetivo === "sessoes"} disabled={!ponte} onClick={() => setModo("sessoes")} className={juntar("flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium disabled:opacity-50", efetivo === "sessoes" ? "bg-background shadow-sm" : "text-muted-foreground")}>Sessões do Hermes</button>
        <button type="button" role="tab" aria-selected={efetivo === "diario"} onClick={() => setModo("diario")} className={juntar("flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium", efetivo === "diario" ? "bg-background shadow-sm" : "text-muted-foreground")}>Diário da coordenação</button>
      </div>
      {!estado.isLoading && !ponte && (
        <p className="shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-[11px] text-muted-foreground">
          {estado.data?.configurada ? `A ponte das sessões não respondeu agora${estado.data?.erro ? ` (${estado.data.erro})` : ""}.` : "As sessões nativas do Hermes abrem aqui quando a ponte do painel for ligada no servidor dele."} Enquanto isso, o diário é o canal real: o Hermes lê a cada minuto e responde aqui.
        </p>
      )}
      {efetivo === "sessoes" ? <SessoesDoHermes contexto={contexto} /> : <DiarioDaCoordenacao contexto={contexto} />}
    </div>
  );
}

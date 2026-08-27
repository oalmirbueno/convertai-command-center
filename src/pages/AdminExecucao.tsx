import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ClipboardCopy, Clock,
  FileCheck2, PauseCircle, ShieldAlert, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Execução da equipe: o que os operadores internos (Hermes) estão fazendo,
 * sob qual responsável humano, com que evidência.
 *
 * Três decisões sustentam a tela:
 *
 *  1. O RESPONSÁVEL HUMANO aparece em toda linha e nunca é alterado por
 *     aqui. Operador executa; quem responde pelo trabalho é gente. Uma
 *     tela que mostrasse só o agente ensinaria a esquecer isso.
 *  2. FEITO exige evidência. done sem evidência entra como revisão (o
 *     banco já rebaixa na gravação) e o relatório separa as duas coisas:
 *     "feito" e "feito-que-diz-que-fez" não podem somar juntos.
 *  3. Os RELATÓRIOS saem dos MESMOS dados da tela (vínculos, runs,
 *     auditoria). Relatório gerado de outra fonte discordaria do quadro
 *     na primeira divergência.
 *
 * A área inteira vive atrás da flag `operators_layer`: desligou, sumiu,
 * nada é apagado.
 */

type Vinculo = {
  id: string;
  operator_id: string;
  kanban_task_id: string | null;
  status: string;
  last_action: string | null;
  last_evidence: string | null;
  next_step: string | null;
  block_reason: string | null;
  approval_required: boolean;
  updated_at: string;
  created_at: string;
};

type Operador = {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  status: string;
  scope: string;
  is_coordinator: boolean;
  last_run_at: string | null;
};

const VISOES = [
  { id: "fila", rotulo: "Fila por operador" },
  { id: "in_progress", rotulo: "Em andamento" },
  { id: "done", rotulo: "Concluídas com evidência" },
  { id: "review", rotulo: "Em revisão" },
  { id: "awaiting_input", rotulo: "Aguardando insumo" },
  { id: "blocked", rotulo: "Bloqueadas" },
  { id: "aprovacao", rotulo: "Aprovações pendentes" },
  { id: "relatorios", rotulo: "Relatórios" },
] as const;

const STATUS_ROTULO: Record<string, string> = {
  queued: "na fila",
  in_progress: "em andamento",
  done: "concluída",
  review: "em revisão",
  awaiting_input: "aguardando insumo",
  blocked: "bloqueada",
};

const dataCurta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export default function AdminExecucao() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const vinculoAlvo = searchParams.get("vinculo");
  const [visao, setVisao] = useState<(typeof VISOES)[number]["id"]>("fila");
  const destacadoRef = useRef<HTMLDivElement | null>(null);

  const { data: flag } = useQuery({
    queryKey: ["flag-operators-layer"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("feature_flags").select("enabled").eq("flag_key", "operators_layer").maybeSingle();
      return data?.enabled === true;
    },
  });

  const { data: operadores = [] } = useQuery({
    queryKey: ["operadores-internos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("internal_operators")
        .select("id, slug, display_name, role, status, scope, is_coordinator, last_run_at")
        .order("is_coordinator");
      if (error) return [];
      return (data || []) as Operador[];
    },
    enabled: flag === true,
  });

  const { data: vinculos = [], dataUpdatedAt } = useQuery({
    queryKey: ["operador-vinculos"],
    queryFn: async () => {
      // A leitura expira runs penduradas antes de mostrar: execução sem
      // heartbeat vira timeout VISÍVEL, nunca "em andamento" eterno.
      await (supabase as any).rpc("operator_expire_stale_runs");
      const { data, error } = await (supabase as any)
        .from("operator_task_links").select("*").order("updated_at", { ascending: false }).limit(300);
      if (error) return [];
      return (data || []) as Vinculo[];
    },
    enabled: flag === true,
    refetchInterval: 30_000,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["operador-runs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_runs")
        .select("id, operator_id, run_key, task_link_id, status, attempt, started_at, heartbeat_at, finished_at, error")
        .order("started_at", { ascending: false }).limit(200);
      if (error) return [];
      return (data || []) as Array<Record<string, any>>;
    },
    enabled: flag === true,
    refetchInterval: 30_000,
  });

  const taskIds = useMemo(
    () => [...new Set(vinculos.map((v) => v.kanban_task_id).filter(Boolean))] as string[],
    [vinculos],
  );
  const { data: tarefas = new Map() } = useQuery({
    queryKey: ["operador-tarefas", taskIds.join(",")],
    queryFn: async () => {
      if (taskIds.length === 0) return new Map();
      const { data } = await (supabase as any)
        .from("tasks")
        .select("id, title, due_date, assigned_to, project:projects(name, client:profiles(full_name, company_name))")
        .in("id", taskIds);
      const mapa = new Map<string, any>();
      for (const t of data || []) mapa.set(String(t.id), t);
      return mapa;
    },
    enabled: flag === true && taskIds.length > 0,
  });

  const humanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tarefas.values()) if (t?.assigned_to) ids.add(String(t.assigned_to));
    return [...ids];
  }, [tarefas]);
  const { data: humanos = new Map() } = useQuery({
    queryKey: ["operador-humanos", humanIds.join(",")],
    queryFn: async () => {
      if (humanIds.length === 0) return new Map();
      const { data } = await (supabase as any).from("profiles").select("id, full_name").in("id", humanIds);
      const mapa = new Map<string, string>();
      for (const p of data || []) mapa.set(String(p.id), p.full_name || "(sem nome)");
      return mapa;
    },
    enabled: humanIds.length > 0,
  });

  const opDe = (id: string) => operadores.find((o) => o.id === id);
  const hoje = new Date().toISOString().slice(0, 10);

  // A notificação abre direto o vínculo: rola até ele e destaca.
  useEffect(() => {
    if (!vinculoAlvo || vinculos.length === 0) return;
    const alvo = vinculos.find((v) => v.id === vinculoAlvo);
    if (!alvo) return;
    if (alvo.status !== "in_progress" && alvo.status !== "queued") {
      const direto = VISOES.find((x) => x.id === alvo.status);
      if (direto) setVisao(direto.id);
      else if (alvo.approval_required) setVisao("aprovacao");
    }
    const t = setTimeout(() => destacadoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(t);
  }, [vinculoAlvo, vinculos]);

  const filtrados = useMemo(() => {
    if (visao === "fila") return vinculos.filter((v) => ["queued", "in_progress"].includes(v.status));
    if (visao === "aprovacao") return vinculos.filter((v) => v.approval_required && v.status !== "done");
    if (visao === "done") return vinculos.filter((v) => v.status === "done");
    if (visao === "relatorios") return [];
    return vinculos.filter((v) => v.status === visao);
  }, [vinculos, visao]);

  const incidentes = useMemo(
    () => runs.filter((r) => ["failed", "timeout"].includes(String(r.status))),
    [runs],
  );

  /* ── Relatórios: gerados dos MESMOS eventos que a tela mostra ── */
  const relatorio = useMemo(() => {
    const doDia = (iso?: string | null) => Boolean(iso && String(iso).slice(0, 10) === hoje);
    const linha = (v: Vinculo) => {
      const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
      const cliente = t?.project?.client;
      return [
        "- " + [
          cliente ? (cliente.company_name || cliente.full_name) : null,
          t?.project?.name,
          t?.title || v.last_action || "(sem tarefa vinculada)",
        ].filter(Boolean).join(" · "),
        "  operador: " + (opDe(v.operator_id)?.display_name || "?")
          + " · humano: " + (t?.assigned_to ? (humanos.get(String(t.assigned_to)) || "?") : "sem responsavel")
          + (t?.due_date ? " · prazo: " + t.due_date : ""),
        v.last_evidence ? "  evidencia: " + v.last_evidence : null,
        v.next_step ? "  proximo passo: " + v.next_step : null,
        v.block_reason ? "  bloqueio: " + v.block_reason : null,
        v.approval_required ? "  DECISAO NECESSARIA do responsavel" : null,
      ].filter(Boolean).join("\n");
    };
    const bloco = (titulo: string, lista: Vinculo[]) =>
      lista.length ? `${titulo} (${lista.length})\n${lista.map(linha).join("\n")}` : `${titulo}: nada`;

    const feitasHoje = vinculos.filter((v) => v.status === "done" && doDia(v.updated_at));
    const emRevisao = vinculos.filter((v) => v.status === "review");
    const aguardando = vinculos.filter((v) => v.status === "awaiting_input");
    const bloqueadas = vinculos.filter((v) => v.status === "blocked");
    const andamento = vinculos.filter((v) => v.status === "in_progress");
    const prazoCritico = vinculos.filter((v) => {
      const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
      return t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
    });

    const abertura = [
      `ABERTURA · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Em andamento", andamento),
      bloco("Na fila", vinculos.filter((v) => v.status === "queued")),
      bloco("Aguardando insumo", aguardando),
    ].join("\n\n");

    const excecoes = [
      `EXCECOES · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Bloqueadas", bloqueadas),
      bloco("Prazo critico (vence hoje ou venceu)", prazoCritico),
      bloco("Aprovacoes pendentes", vinculos.filter((v) => v.approval_required && v.status !== "done")),
      incidentes.length
        ? `Falhas de execucao (${incidentes.length})\n` + incidentes.slice(0, 10).map((r) =>
            `- ${opDe(String(r.operator_id))?.display_name || "?"} · run ${r.run_key} · ${r.status}${r.error ? " · " + r.error : ""}`,
          ).join("\n")
        : "Falhas de execucao: nenhuma",
    ].join("\n\n");

    const fechamento = [
      `FECHAMENTO · ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Feito COM evidencia", feitasHoje.filter((v) => v.last_evidence)),
      bloco("Em revisao (inclui feito sem evidencia)", emRevisao),
      bloco("Aguardando insumo", aguardando),
      bloco("Bloqueado", bloqueadas),
    ].join("\n\n");

    const semanal = [
      `SEMANA DO PILOTO · ate ${new Date().toLocaleDateString("pt-BR")}`,
      bloco("Concluidas com evidencia", vinculos.filter((v) => v.status === "done" && v.last_evidence)),
      bloco("Em revisao", emRevisao),
      bloco("Bloqueadas", bloqueadas),
      `Runs na semana: ${runs.length} · falhas/timeouts: ${incidentes.length}`,
      "Regra do piloto: feito so conta com evidencia verificavel.",
    ].join("\n\n");

    return { abertura, excecoes, fechamento, semanal };
  }, [vinculos, runs, incidentes, tarefas, humanos, operadores, hoje]);

  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${rotulo} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }
  if (flag === false) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        A camada de operadores está desligada (flag operators_layer). Nada foi apagado; religar a flag traz tudo de volta.
      </div>
    );
  }

  const Cartao = ({ v }: { v: Vinculo }) => {
    const t = v.kanban_task_id ? tarefas.get(String(v.kanban_task_id)) : null;
    const cliente = t?.project?.client;
    const op = opDe(v.operator_id);
    const destacado = v.id === vinculoAlvo;
    const prazoVencido = t?.due_date && String(t.due_date) <= hoje && v.status !== "done";
    return (
      <div
        ref={destacado ? destacadoRef : undefined}
        className={cn(
          "rounded-xl border bg-card p-3.5",
          destacado ? "border-primary ring-2 ring-primary/40" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              {t?.title || v.last_action || "(sem tarefa vinculada)"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {[cliente ? (cliente.company_name || cliente.full_name) : null, t?.project?.name]
                .filter(Boolean).join(" · ") || "sem projeto"}
            </p>
          </div>
          <span className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            v.status === "done" ? "bg-success/15 text-success"
              : v.status === "blocked" ? "bg-destructive/15 text-destructive"
              : v.status === "review" ? "bg-warning/15 text-warning"
              : "bg-secondary text-muted-foreground",
          )}>
            {STATUS_ROTULO[v.status] || v.status}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Bot className="h-3 w-3" /> {op?.display_name || "?"}
          </span>
          <span>
            humano: <span className="font-medium text-foreground/80">
              {t?.assigned_to ? humanos.get(String(t.assigned_to)) || "?" : "sem responsável"}
            </span>
          </span>
          {t?.due_date && (
            <span className={cn("inline-flex items-center gap-1", prazoVencido && "font-semibold text-destructive")}>
              <Clock className="h-3 w-3" /> {t.due_date}
            </span>
          )}
          <span>{dataCurta(v.updated_at)}</span>
        </div>

        {v.last_action && (
          <p className="mt-1.5 text-[11.5px] text-foreground/85">{v.last_action}</p>
        )}
        {v.last_evidence && (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            evidência: {v.last_evidence.startsWith("http")
              ? <a className="text-primary underline" href={v.last_evidence} target="_blank" rel="noopener noreferrer">{v.last_evidence}</a>
              : v.last_evidence}
          </p>
        )}
        {v.next_step && (
          <p className="mt-1 text-[11px] text-muted-foreground">próximo passo: {v.next_step}</p>
        )}
        {v.block_reason && (
          <p className="mt-1 rounded-lg border border-destructive/25 bg-destructive/[0.05] px-2 py-1 text-[11px] text-destructive">
            bloqueio: {v.block_reason}
          </p>
        )}
        {v.approval_required && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-semibold text-warning">
            <ShieldAlert className="h-3 w-3" /> aprovação necessária
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">Execução da equipe</h1>
        <p className="text-[12px] text-muted-foreground">
          Operadores internos executam e relatam; o responsável humano continua sendo quem responde.
          Atualizado {dataCurta(new Date(dataUpdatedAt || Date.now()).toISOString())}.
        </p>
      </div>

      {/* Os operadores do piloto, sem e-mail e sem senha: outra entidade. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {operadores.map((o) => (
          <div key={o.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <p className="text-[12.5px] font-semibold text-foreground">{o.display_name}</p>
              {o.is_coordinator && (
                <span className="rounded-full bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">coordenador</span>
              )}
              <span className={cn(
                "ml-auto h-2 w-2 rounded-full",
                o.status === "active" ? "bg-success" : "bg-muted-foreground/40",
              )} />
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{o.scope}</p>
            <p className="mt-1 text-[9.5px] text-muted-foreground">
              {o.last_run_at ? `última execução ${dataCurta(o.last_run_at)}` : "sem execução ainda"}
            </p>
          </div>
        ))}
      </div>

      {incidentes.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.05] p-3">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {incidentes.length} incidente(s) de execução
          </p>
          <div className="mt-1 space-y-0.5">
            {incidentes.slice(0, 5).map((r) => (
              <p key={String(r.id)} className="text-[11px] text-muted-foreground">
                {opDe(String(r.operator_id))?.display_name || "?"} · run {String(r.run_key)} · {String(r.status)}
                {r.error ? ` · ${String(r.error)}` : ""} {r.attempt > 1 ? ` · tentativa ${r.attempt}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {VISOES.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setVisao(x.id)}
            className={cn(
              "h-8 rounded-full border px-3 text-[11.5px] font-semibold transition-colors",
              visao === x.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {x.rotulo}
          </button>
        ))}
      </div>

      {visao === "relatorios" ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { titulo: "Abertura do dia", texto: relatorio.abertura, icone: Activity },
            { titulo: "Checkpoint de exceções", texto: relatorio.excecoes, icone: AlertTriangle },
            { titulo: "Fechamento do dia", texto: relatorio.fechamento, icone: CheckCircle2 },
            { titulo: "Semana do piloto", texto: relatorio.semanal, icone: FileCheck2 },
          ].map((r) => (
            <div key={r.titulo} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between">
                <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                  <r.icone className="h-3.5 w-3.5 text-primary" /> {r.titulo}
                </p>
                <button
                  type="button"
                  onClick={() => void copiar(r.texto, r.titulo)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <ClipboardCopy className="h-3 w-3" /> Copiar
                </button>
              </div>
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-muted-foreground">
                {r.texto}
              </pre>
            </div>
          ))}
        </div>
      ) : visao === "fila" ? (
        <div className="space-y-4">
          {operadores.filter((o) => !o.is_coordinator).map((o) => {
            const doOperador = filtrados.filter((v) => v.operator_id === o.id);
            return (
              <div key={o.id}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {o.display_name} · {doOperador.length} na fila
                </p>
                {doOperador.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                    Nada em execução para {o.display_name}.
                  </p>
                ) : (
                  <div className="space-y-2">{doOperador.map((v) => <Cartao key={v.id} v={v} />)}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <PauseCircle className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-1 text-[12px] text-muted-foreground">Nada nesta visão agora.</p>
        </div>
      ) : (
        <div className="space-y-2">{filtrados.map((v) => <Cartao key={v.id} v={v} />)}</div>
      )}

      {visao === "done" && filtrados.some((v) => !v.last_evidence) && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/[0.06] px-2.5 py-1.5 text-[11px] text-warning">
          <XCircle className="h-3.5 w-3.5" />
          Concluída sem evidência não deveria existir aqui: o banco rebaixa para revisão na gravação.
        </p>
      )}
    </div>
  );
}

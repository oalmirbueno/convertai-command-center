import { contextoDasExecucoes } from "@/lib/execucaoHistorico";
import { nomeDaTarefaDoBanco } from "@/lib/nomeDaTarefa";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ExecucoesRecentes from "./ExecucoesRecentes";
import { falarComoGente } from "@/lib/falarComoGente";
import EvidenciaVisual from "./EvidenciaVisual";
import { destinoDaEvidencia, estadoDaExecucao, falhaDaExecucao } from "@/lib/execucaoApresentacao";
import { precisaDecisao } from "@/lib/precisaDecisao";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ChevronRight, ClipboardCopy, History, Lightbulb, ListChecks, MessageCircle, Pause, Play, TrendingUp } from "lucide-react";
import ChatDoHermes from "./central/ChatDoHermes";
import { limparTecnico } from "@/lib/cadernoExecucao";
import { botao, etiqueta, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";

/** Frente AG3: vínculo só com painel_task_id também acha a tarefa (antes aparecia "(sem tarefa vinculada)"). */
function tarefaDoVinculo<T>(v: { kanban_task_id?: string | null }, tarefas: Map<string, T>): T | null {
  const id = v.kanban_task_id || (v as { painel_task_id?: string | null }).painel_task_id;
  return id ? tarefas.get(String(id)) ?? null : null;
}

/**
 * Entrar no agente: tudo o que ele fez, como está indo e o que melhorar.
 *
 * O "o que melhorar" não é opinião: cada sinal sai de um número que o
 * próprio quadro já tem (conclusão sem evidência, execuções que expiraram,
 * tarefas paradas, bloqueio sem próximo passo). Conselho sem número vira
 * horóscopo, e o agente não teria como agir sobre ele.
 *
 * O texto de acionamento também sai daqui pronto para colar no grupo, com
 * os números reais do agente — é o que faz o Hermes entender o estado sem
 * ninguém redigitar contexto.
 */

type Operador = {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  scope: string;
  status: string;
  is_coordinator: boolean;
  last_run_at: string | null;
  area?: string | null;
};

/* A ordem em que os estados pedem atenção: o que trava vem primeiro, o
   que já terminou por último. Lista ordenada por data deixaria o bloqueio
   no meio do monte. */
const ORDEM_DO_ESTADO = [
  "blocked", "awaiting_input", "review", "in_progress", "queued", "done",
];

const TOM_DO_ESTADO: Record<string, string> = {
  blocked: "bg-destructive",
  awaiting_input: "bg-warning",
  review: "bg-warning",
  in_progress: "bg-info",
  queued: "bg-muted-foreground",
  done: "bg-success",
};

const ROTULO_DO_ESTADO: Record<string, string> = {
  blocked: "bloqueada",
  awaiting_input: "aguardando insumo",
  review: "em revisão",
  in_progress: "em andamento",
  queued: "na fila",
  done: "concluída",
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

export default function PerfilDoAgente({
  operador,
  vinculos,
  tarefas,
  aoFechar,
  aoAbrirDiario,
  abaInicial = null,
}: {
  /** Abrir já numa aba (ex.: "conversar", vindo de "Quer conversar comigo?"). */
  abaInicial?: string | null;
  operador: Operador | null;
  vinculos: Array<Record<string, any>>;
  tarefas: Map<string, any>;
  aoFechar: () => void;
  aoAbrirDiario: (id: string, titulo?: string) => void;
}) {
  const meus = useMemo(
    () => vinculos.filter((v) => v.operator_id === operador?.id),
    [vinculos, operador],
  );

  const { data: runs = [], isError: runsFalhou } = useQuery({
    queryKey: ["agente-runs", operador?.id],
    queryFn: async () => {
      // Frente AG3: a leitura que falha vira erro na tela (antes dizia "Nada a corrigir").
      const { data, error } = await (supabase as any)
        .from("operator_runs")
        .select("id, operator_id, task_link_id, run_key, status, attempt, started_at, heartbeat_at, finished_at, error, detail")
        .eq("operator_id", operador!.id)
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return contextoDasExecucoes(data || []);
    },
    enabled: Boolean(operador?.id),
  });

  const queryClient = useQueryClient();
  const pausar = useMutation({
    mutationFn: async ({ pausarAgora, motivo }: { pausarAgora: boolean; motivo: string }) => {
      const { data, error } = await (supabase as any).rpc("operator_pausar", {
        _slug: operador!.slug,
        _pausar: pausarAgora,
        _motivo: motivo || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["operadores-internos"] });
      toast.success(vars.pausarAgora
        ? `${operador?.display_name} pausado. O banco recusa trabalho dele até reativar.`
        : `${operador?.display_name} reativado.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const [limiteTrilha, setLimiteTrilha] = useState(40);
  const [aba, setAba] = useEstadoDaTela<string>(`execucao:agente:aba:${operador?.id || ""}`, "agora", { validar: (v) => ["agora", "conversar", "historico", "melhorar"].includes(String(v)) });
  useEffect(() => { if (operador?.id && abaInicial) setAba(abaInicial); }, [operador?.id, abaInicial]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: trilha = [], isError: trilhaFalhou } = useQuery({
    queryKey: ["agente-trilha", operador?.id, limiteTrilha],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_audit_log")
        .select("id, occurred_at, actor, action, old_status, new_status, evidence, from_cron, task_link_id")
        .eq("operator_id", operador!.id)
        .order("occurred_at", { ascending: false })
        .limit(limiteTrilha);
      if (error) throw new Error(error.message);
      return (data || []) as Array<Record<string, any>>;
    },
    enabled: Boolean(operador?.id),
  });

  const areas = useQuery({
    queryKey: ["operadores-internos-areas"], enabled: Boolean(operador?.id), staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("internal_operators").select("area");
      return [...new Set(((data || []) as Array<{ area: string | null }>).map((o) => (o.area || "").trim()).filter(Boolean))].sort();
    },
  });
  const mudarArea = useMutation({
    mutationFn: async (area: string) => {
      const { error } = await (supabase as any).rpc("operator_update", { _slug: operador!.slug, _actor: "painel", _area: area });
      if (error) throw new Error(error.message);
      return area;
    },
    onSuccess: (area) => { queryClient.invalidateQueries({ queryKey: ["operadores-internos"] }); queryClient.invalidateQueries({ queryKey: ["operadores-internos-areas"] }); toast.success(`${operador?.display_name} agora está em ${area}.`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const numeros = useMemo(() => {
    const feitas = meus.filter((v) => v.status === "done");
    const comEvidencia = feitas.filter((v) => v.last_evidence);
    const falhas = runs.filter((r) => ["failed", "timeout"].includes(String(r.status)));
    const paradas = meus.filter((v) => {
      if (!["in_progress", "awaiting_input"].includes(v.status)) return false;
      const dias = (Date.now() - new Date(v.updated_at).getTime()) / 86_400_000;
      return dias >= 2;
    });
    return {
      total: meus.length,
      andamento: meus.filter((v) => v.status === "in_progress").length,
      feitas: feitas.length,
      comEvidencia: comEvidencia.length,
      semEvidencia: feitas.length - comEvidencia.length,
      revisao: meus.filter((v) => v.status === "review").length,
      bloqueadas: meus.filter((v) => v.status === "blocked").length,
      falhas: falhas.length,
      paradas: paradas.length,
      // Sem tarefa concluída não existe taxa: mostrar 0% ou 100% aqui
      // seria inventar desempenho de quem ainda não começou.
      taxaEvidencia: feitas.length ? Math.round((comEvidencia.length / feitas.length) * 100) : null,
      semProximoPasso: meus.filter((v) => v.status === "blocked" && !v.next_step).length,
    };
  }, [meus, runs]);

  const melhorias = useMemo(() => {
    const lista: Array<{ texto: string; grave: boolean }> = [];
    if (numeros.semEvidencia > 0) {
      lista.push({
        grave: true,
        texto: `${numeros.semEvidencia} conclusão(ões) sem evidência foram rebaixadas para revisão. Anexe um link ou uma descrição verificável do resultado.`,
      });
    }
    if (numeros.falhas > 0) {
      lista.push({
        grave: true,
        texto: `${numeros.falhas} execução(ões) falharam ou expiraram. O agente precisa registrar o andamento durante tarefas longas.`,
      });
    }
    if (numeros.semProximoPasso > 0) {
      lista.push({
        grave: true,
        texto: `${numeros.semProximoPasso} bloqueio(s) sem próximo passo. Bloqueio sem saída escrita vira tarefa parada que ninguém sabe destravar.`,
      });
    }
    if (numeros.paradas > 0) {
      lista.push({
        grave: false,
        texto: `${numeros.paradas} tarefa(s) sem atualização há 2 dias ou mais. Reporte progresso ou marque como bloqueada.`,
      });
    }
    if (numeros.total === 0) {
      lista.push({
        grave: false,
        texto: "Nenhuma execução ainda. Escolha uma tarefa disponível para iniciar o trabalho.",
      });
    }
    // Frente AG3: sem conseguir ler as execuções, não dá para dizer que está tudo certo.
    if (runsFalhou || trilhaFalhou) {
      lista.push({ grave: true, texto: "Não consegui ler as execuções ou a trilha deste agente agora. Recarregue antes de concluir que está tudo certo." });
    }
    if (lista.length === 0) {
      lista.push({ grave: false, texto: "Nada a corrigir: evidência em dia, sem falhas e sem tarefa parada." });
    }
    return lista;
  }, [numeros, runsFalhou, trilhaFalhou]);

  const comandoDeAcionamento = useMemo(() => {
    if (!operador) return "";
    const abertas = meus
      .filter((v) => !["done"].includes(v.status))
      .slice(0, 6)
      .map((v) => {
        const t = tarefaDoVinculo(v, tarefas);
        return `- ${t?.title || v.last_action || "(tarefa)"} · ${v.status}${v.block_reason ? " · bloqueio: " + v.block_reason : ""}`;
      });
    return [
      `@${operador.slug} — retomada da execução.`,
      "",
      `Escopo: ${operador.scope}`,
      `Estado atual: ${numeros.andamento} em andamento, ${numeros.comEvidencia} feitas com evidência, `
        + `${numeros.revisao} em revisão, ${numeros.bloqueadas} bloqueadas.`,
      abertas.length ? "\nAbertas com você:\n" + abertas.join("\n") : "\nNada aberto com você agora.",
      "\nO que melhorar nesta rodada:",
      ...melhorias.map((m) => `- ${m.texto}`),
      "",
      "Antes de agir: leia aceleriq_operator_board (traz como_usar, resumo e tarefas_disponiveis).",
      "Reporte cada passo com aceleriq_operator_report. done SEM evidencia vira revisao.",
      "Limites de sempre: publicar, agendar, gastar, contratar e alterar financeiro ficam fora.",
    ].join("\n");
  }, [operador, meus, tarefas, numeros, melhorias]);

  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${rotulo} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  /** Título de bloco dentro da janela: ícone discreto e texto normal (sem caixa alta). */
  const Titulo = ({ icone: Icone, children, acao }: { icone: typeof TrendingUp; children: ReactNode; acao?: ReactNode }) => (
    <div className="mb-2 flex min-w-0 items-center">
      <Icone className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{children}</h3>
      {acao}
    </div>
  );

  /* 16/10 (dono: "quando clico nele aparece o progresso, mas não está tão intuitivo e não tem as
     coisas para me fazer"; "posso conversar com ele... ele vai lá e faz"; "tudo que ele fez: scroll
     interno, ver mais e abrir, sempre com ida e volta"): cabeçalho com status, área e pausar;
     quatro abas (Agora, Conversar e dar ordens, Tudo o que fez, Melhorar); cada tarefa e cada item
     do histórico abre o diário e volta para cá. */
  const ativo = operador?.status === "active";
  const abertas = [...meus].filter((v) => v.status !== "done").sort((a, b) => ORDEM_DO_ESTADO.indexOf(a.status) - ORDEM_DO_ESTADO.indexOf(b.status));
  const concluidas = meus.filter((v) => v.status === "done");
  const ABAS_DO_AGENTE: Array<[string, string, typeof TrendingUp]> = [["agora", "Agora", ListChecks], ["conversar", "Conversar e dar ordens", MessageCircle], ["historico", "Tudo o que ele fez", History], ["melhorar", "Melhorar", Lightbulb]];
  const LinhaDaTarefa = ({ v }: { v: Record<string, any> }) => {
    const t = tarefaDoVinculo(v, tarefas);
    const cliente = t?.project?.client ? (t.project.client.company_name || t.project.client.full_name) : null;
    return (
      <li>
        <button type="button" onClick={() => aoAbrirDiario(v.id, t?.title || v.last_action)} className="group flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted/60">
          <span className={juntar("h-2 w-2 shrink-0 rounded-full", TOM_DO_ESTADO[v.status] ?? "bg-muted-foreground")} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">{t?.title ? nomeDaTarefaDoBanco(t, { agente: operador?.display_name }).semCliente : limparTecnico(String(v.last_action || "")) || "(tarefa sem título)"}</span>
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
              {precisaDecisao(v) ? <span className="font-medium text-warning">precisa da sua aprovação</span> : v.status === "done" && !v.last_evidence ? <span className="font-medium text-warning">concluída sem evidência</span> : ROTULO_DO_ESTADO[v.status] ?? v.status}
              {cliente && ` · ${cliente}`}{v.updated_at && ` · ${quando(v.updated_at)}`}
            </span>
          </span>
          <span className="flex shrink-0 items-center text-[12px] text-muted-foreground group-hover:text-foreground">Abrir<ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" /></span>
        </button>
        {/* A prova mais recente, em miniatura (a imagem fala antes do texto). */}
        {v.last_evidence && destinoDaEvidencia(String(v.last_evidence)) && <div className="ml-7 mt-0.5 w-32 pb-1.5"><EvidenciaVisual url={String(v.last_evidence)} compacto /></div>}
      </li>
    );
  };

  return (
    <Dialog open={Boolean(operador)} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {operador && (
          <>
            <div className="shrink-0 border-b border-border px-5 pb-2 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))]">
              <div className="flex min-w-0 items-center gap-3 pr-10">
                <span className={juntar("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold", ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")} aria-hidden="true">{operador.display_name.trim()[0]?.toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <DialogTitle className={juntar(texto.tituloPagina, "truncate text-left")}>{operador.display_name}</DialogTitle>
                  <DialogDescription className="mt-0.5 truncate text-left text-[12px] text-muted-foreground">{operador.role}</DialogDescription>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px]">
                <span className={juntar(etiqueta, "h-6 px-2", ativo ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>{ativo ? "ativo" : operador.status === "paused" ? "pausado" : operador.status}</span>
                <span className="text-muted-foreground">{operador.last_run_at ? `trabalhou ${quando(operador.last_run_at)}` : "ainda não trabalhou"}</span>
                <label className="inline-flex items-center gap-1 text-muted-foreground">
                  Área
                  <select aria-label="Área do agente" value={(operador.area || "").trim()} disabled={mudarArea.isPending} onChange={(e) => { const v = e.target.value === "__nova__" ? (window.prompt("Nome da nova área:") || "").trim() : e.target.value; if (v) mudarArea.mutate(v); }} className="h-7 cursor-pointer rounded-md bg-transparent px-1 text-[12px] text-foreground hover:bg-muted">
                    {!(operador.area || "").trim() && <option value="">Sem área</option>}
                    {(areas.data || []).map((a) => <option key={a} value={a}>{a}</option>)}
                    <option value="__nova__">+ nova área…</option>
                  </select>
                </label>
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => setAba("conversar")} className={juntar(botao.primario, "h-8 px-3 text-[13px]")}><MessageCircle className="mr-1.5 h-3.5 w-3.5" />Dar uma ordem</button>
                  {/* Pausa por operador: pausado, o banco recusa assign, report, participação e aprovação dele. */}
                  <button
                    type="button"
                    disabled={pausar.isPending}
                    onClick={() => {
                      const motivo = window.prompt(ativo ? `Pausar ${operador.display_name}? Motivo (fica na trilha):` : `Reativar ${operador.display_name}? Motivo (opcional):`);
                      if (motivo === null) return;
                      pausar.mutate({ pausarAgora: ativo, motivo });
                    }}
                    aria-label={ativo ? "pausar operador" : "reativar operador"}
                    className={juntar(botao.secundario, "h-8 px-3 text-[13px]", ativo ? "text-warning" : "text-success")}
                  >{ativo ? <><Pause className="mr-1.5 h-3.5 w-3.5" />Pausar</> : <><Play className="mr-1.5 h-3.5 w-3.5" />Ativar</>}</button>
                </span>
              </div>
              <nav aria-label="Partes do agente" className="mt-2 flex gap-0.5 overflow-x-auto">
                {ABAS_DO_AGENTE.map(([id, rotulo, Icone]) => (
                  <button key={id} type="button" aria-pressed={aba === id} onClick={() => setAba(id)} className={juntar("inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px]", aba === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}><Icone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{rotulo}</button>
                ))}
              </nav>
            </div>

            {aba === "conversar" ? (
              <div className="min-h-0 flex-1">
                <ChatDoHermes
                  key={operador.id}
                  chaveDaSessao={`execucao:agente:hermes:${operador.id}`}
                  tituloDaSessao={`Agente · ${operador.display_name}`}
                  contexto={{ cliente: null, projeto: null, agente: { id: operador.id, slug: operador.slug, nome: operador.display_name } }}
                  className="h-full min-h-0"
                />
              </div>
            ) : (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-4">
              {aba === "agora" && <>
                <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {[
                    { r: "Em andamento", v: numeros.andamento, tom: "text-info" },
                    { r: "Em revisão", v: numeros.revisao, tom: "text-warning" },
                    { r: "Travadas", v: numeros.bloqueadas, tom: "text-destructive" },
                    { r: "Feitas", v: numeros.comEvidencia, tom: "text-success" },
                    { r: "Falhas", v: numeros.falhas, tom: "text-destructive" },
                    { r: "Com prova", v: numeros.taxaEvidencia === null ? "—" : `${numeros.taxaEvidencia}%`, tom: "text-foreground" },
                  ].map((k) => (
                    <div key={k.r} className={juntar(superficie.poco, "min-w-0 rounded-lg p-2.5 text-center")}>
                      <dd className={juntar("text-[20px] font-semibold tabular-nums leading-6", k.tom)}>{k.v}</dd>
                      <dt className="mt-0.5 truncate text-[11px] text-muted-foreground">{k.r}</dt>
                    </div>
                  ))}
                </dl>
                <section>
                  <Titulo icone={ListChecks}>Tarefas deste agente <span className="ml-1 font-normal tabular-nums text-muted-foreground">{abertas.length}</span></Titulo>
                  {abertas.length ? <ul className="-mx-2">{abertas.map((v) => <LinhaDaTarefa key={v.id} v={v} />)}</ul>
                    : <p className={texto.auxiliar}>Nada aberto com ele. Use "Dar uma ordem" para colocá-lo para trabalhar.</p>}
                </section>
                {concluidas.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold">Concluídas <span className="font-normal text-muted-foreground">{concluidas.length}</span></summary>
                    <ul className="-mx-2 mt-1 max-h-80 overflow-y-auto">{concluidas.map((v) => <LinhaDaTarefa key={v.id} v={v} />)}</ul>
                  </details>
                )}
                <section>
                  <Titulo icone={AlertTriangle}>Execuções recentes</Titulo>
                  <ExecucoesRecentes runs={runs} agentes={[operador]} vinculos={vinculos} tarefas={tarefas} aoConversar={aoAbrirDiario} />
                </section>
              </>}

              {aba === "historico" && (
                <section>
                  {trilha.length === 0 ? <p className={texto.auxiliar}>Sem histórico ainda.</p> : (
                    <ol className="relative ml-2 border-l border-border">
                      {trilha.map((a) => {
                        const podeAbrir = Boolean(a.task_link_id);
                        const conteudo = <>
                          <p className="text-[13px] text-foreground/90 [overflow-wrap:anywhere]">
                            {limparTecnico(falarComoGente(String(a.action)).humano)}
                            {a.old_status && a.new_status && a.old_status !== a.new_status && <span className="text-muted-foreground"> · {estadoDaExecucao(a.old_status)} → {estadoDaExecucao(a.new_status)}</span>}
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{quando(a.occurred_at)}{a.from_cron ? " · rotina automática" : ""}{a.evidence ? " · com comprovação" : ""}{podeAbrir ? " · abrir" : ""}</p>
                        </>;
                        return (
                          <li key={String(a.id)} className="relative pb-3 pl-4">
                            <span className={juntar("absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full", a.evidence ? "bg-success" : "bg-muted-foreground/60")} aria-hidden="true" />
                            {podeAbrir ? <button type="button" className="w-full rounded-md px-1 py-0.5 text-left hover:bg-muted/60" onClick={() => aoAbrirDiario(String(a.task_link_id))}>{conteudo}</button> : <div className="px-1">{conteudo}</div>}
                            {a.evidence && destinoDaEvidencia(String(a.evidence)) && <div className="mt-1.5 w-40"><EvidenciaVisual url={String(a.evidence)} compacto /></div>}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {trilha.length >= limiteTrilha && <button type="button" className={juntar(botao.secundario, "mt-2")} onClick={() => setLimiteTrilha((n) => n + 40)}>Ver mais</button>}
                </section>
              )}

              {aba === "melhorar" && <>
                <section>
                  <Titulo icone={Lightbulb}>O que melhorar</Titulo>
                  <ul className="space-y-1.5">
                    {melhorias.map((m, i) => (
                      <li key={i} className={juntar("flex items-start text-[13px] leading-5", m.grave ? "text-warning" : "text-muted-foreground")}>
                        <span className={juntar("mr-2 mt-2 h-1.5 w-1.5 shrink-0 rounded-full", m.grave ? "bg-warning" : "bg-muted-foreground")} aria-hidden="true" />
                        <span className="min-w-0">{m.texto}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <details>
                  <summary className="cursor-pointer text-[12px] text-muted-foreground">Instruções de retomada no Hermes</summary>
                  <Titulo icone={ClipboardCopy} acao={<button type="button" onClick={() => void copiar(comandoDeAcionamento, "Comando")} className={juntar(botao.discreto, "h-7 px-2 text-[12px]")}><ClipboardCopy className="mr-1 h-3 w-3" aria-hidden="true" /> Copiar</button>}>Acionar no grupo</Titulo>
                  <pre className={juntar(superficie.poco, "whitespace-pre-wrap p-3 font-sans text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]")}>{comandoDeAcionamento}</pre>
                </details>
              </>}
            </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

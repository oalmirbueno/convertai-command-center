import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Sparkles, X, Send, Paperclip, Loader2, CheckCircle2, AlertCircle, FileText, ArrowRight, Edit3, Undo2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { parseCommand, summarizeIntent, ParsedIntent } from "@/lib/voiceCommands";
import { gapsForIntent, suggestProjectName, suggestDeadline, defaultProjectDescription, formatScopePreview, Clarification } from "@/lib/voiceConversation";
import { projectTemplates } from "@/lib/projectTemplates";

type AnyRec = any;

function getRecognition(): AnyRec | null {
  const W = window as any;
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "pt-BR";
  rec.continuous = true;
  rec.interimResults = true;
  return rec;
}

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function bestMatch<T extends { id: string }>(
  items: T[],
  hint: string,
  fields: ((x: T) => string | null | undefined)[],
): T | undefined {
  if (!hint || !items?.length) return undefined;
  const h = norm(hint);
  let best: { item: T; score: number } | undefined;
  for (const it of items) {
    for (const f of fields) {
      const v = norm(f(it) || "");
      if (!v) continue;
      let score = 0;
      if (v === h) score = 100;
      else if (v.includes(h) || h.includes(v)) score = 70;
      else {
        const tokens = h.split(/\s+/).filter(Boolean);
        const hits = tokens.filter((t) => v.includes(t)).length;
        score = (hits / Math.max(tokens.length, 1)) * 50;
      }
      if (!best || score > best.score) best = { item: it, score };
    }
  }
  return best && best.score >= 30 ? best.item : undefined;
}

interface LogEntry { id: string; kind: "ok" | "error" | "info"; text: string; }

type Phase = "input" | "clarify" | "preview" | "confirm" | "done";

interface CreatedRefs {
  projectIds: string[];
  milestoneIds: string[];
  taskIds: string[];
  checklistItemIds: string[];
  fileIds: string[];
}

interface LastAction {
  id: string;
  label: string;
  createdAt: number;
  refs: CreatedRefs;
}

const emptyRefs = (): CreatedRefs => ({ projectIds: [], milestoneIds: [], taskIds: [], checklistItemIds: [], fileIds: [] });

export default function VoiceAssistant() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [parsed, setParsed] = useState<ParsedIntent | null>(null);
  const [executing, setExecuting] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const recRef = useRef<AnyRec | null>(null);
  const supported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Conversational state
  const [phase, setPhase] = useState<Phase>("input");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [clientList, setClientList] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [confirmAck, setConfirmAck] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [undoing, setUndoing] = useState(false);

  // Staged execution state (one checkbox per phase)
  const [stageIdx, setStageIdx] = useState(0);
  const [stageAck, setStageAck] = useState(false);
  const [stageRefs, setStageRefs] = useState<CreatedRefs>(emptyRefs());
  const [stageContext, setStageContext] = useState<{
    client?: any; project?: any;
    milestones?: Array<{ milestone: any; tm: any }>;
    tasks?: Array<{ task: any; t: any; milestone: any }>;
    chkTemplates?: any[];
  }>({});

  const isAdmin = profile?.role === "admin";

  // Load clients once when drawer opens
  useEffect(() => {
    if (!open || clientList.length) return;
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "client");
      const ids = (roles || []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data: profs } = await supabase
        .from("profiles").select("id, full_name, company_name, email")
        .in("id", ids).is("deleted_at", null);
      setClientList(profs || []);
    })();
  }, [open, clientList.length]);

  useEffect(() => {
    if (!open) return;
    return () => stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopListening = useCallback(() => {
    try { recRef.current?.stop?.(); } catch {}
    recRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const startListening = useCallback(() => {
    if (!supported) {
      toast({ title: "Voz não suportada", description: "Use Chrome/Edge.", variant: "destructive" });
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.onresult = (e: any) => {
      let finals = ""; let interims = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + " ";
        else interims += r[0].transcript;
      }
      if (finals) setFinalText((prev) => (prev + " " + finals).trim());
      setInterim(interims);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try { rec.start(); setListening(true); } catch {}
  }, [supported, toast]);

  const reset = () => {
    setFinalText(""); setInterim(""); setParsed(null); setFile(null);
    setPhase("input"); setAnswers({}); setClientSearch(""); setConfirmAck(false);
    setStageIdx(0); setStageAck(false); setStageRefs(emptyRefs()); setStageContext({});
  };

  // Auto re-parse when text changes
  useEffect(() => {
    const full = (finalText + " " + interim).trim();
    if (full) setParsed(parseCommand(full));
    else setParsed(null);
  }, [finalText, interim]);

  const appendLog = (entry: Omit<LogEntry, "id">) =>
    setLog((l) => [{ id: crypto.randomUUID(), ...entry }, ...l].slice(0, 12));

  // ------------ Conversational flow ------------
  const resolvedClient = useMemo(() => {
    if (answers.client_id) return clientList.find((c) => c.id === answers.client_id);
    if (parsed && "clientHint" in parsed && parsed.clientHint) {
      return bestMatch(clientList, parsed.clientHint, [
        (p: any) => p.company_name, (p: any) => p.full_name, (p: any) => p.email,
      ]);
    }
    return undefined;
  }, [answers.client_id, parsed, clientList]);

  const gaps = useMemo<Clarification[]>(() => {
    if (!parsed || parsed.kind === "unknown") return [];
    return gapsForIntent(parsed, { clientName: resolvedClient?.company_name || resolvedClient?.full_name });
  }, [parsed, resolvedClient]);

  const advanceFromInput = () => {
    if (!parsed || parsed.kind === "unknown") return;
    // Pre-fill answers from parsed intent
    const init: Record<string, any> = {};
    if (parsed.kind === "create_project") {
      init.project_type = parsed.type || "other";
      init.deadline = parsed.deadlineDays ?? suggestDeadline(init.project_type);
      init.project_name = suggestProjectName({
        type: init.project_type,
        clientName: resolvedClient?.company_name || resolvedClient?.full_name,
        rawHint: parsed.name,
      });
      init.apply_template = true;
      if (resolvedClient) init.client_id = resolvedClient.id;
    }
    if (parsed.kind === "create_task") {
      init.task_title = parsed.title;
      if (resolvedClient) init.client_id = resolvedClient.id;
    }
    if (parsed.kind === "create_milestone") {
      init.milestone_title = parsed.title;
      if (resolvedClient) init.client_id = resolvedClient.id;
    }
    setAnswers(init);
    if (gaps.length === 0 || (parsed.kind !== "create_project" && parsed.kind !== "create_task" && parsed.kind !== "create_milestone")) {
      // Skip clarify for report/upload/update intents (legacy direct execute)
      directExecute();
      return;
    }
    setPhase("clarify");
  };

  // ------------ Execute ------------

  const directExecute = async () => {
    if (!parsed || parsed.kind === "unknown" || !user) return;
    setExecuting(true);
    const transcript = (finalText + " " + interim).trim();
    let status: "success" | "error" = "success";
    let resultMsg = "";
    try {
      switch (parsed.kind) {
        case "update_task_status": await execUpdateTaskStatus(parsed); break;
        case "report_pending": await execReportPending(parsed); break;
        case "report_overview": await execReportOverview(parsed); break;
        case "upload_file": await execUploadFile(parsed); break;
      }
      resultMsg = summarizeIntent(parsed);
      reset();
    } catch (err: any) {
      status = "error";
      resultMsg = err?.message || "Falha";
      appendLog({ kind: "error", text: resultMsg });
    } finally {
      setExecuting(false);
      supabase.from("voice_command_log" as any).insert({
        user_id: user.id, transcript, intent: parsed as any, status, result: resultMsg,
      }).then(() => {});
    }
  };

  // ---------------- Staged execution (1 checkbox per phase) ----------------
  const stages = useMemo(() => {
    if (parsed?.kind === "create_project") {
      const base = [{ key: "project", label: "Criar projeto", description: "Grava o registro do projeto no banco." }];
      if (answers.apply_template) {
        const tpl = projectTemplates[answers.project_type] || [];
        const taskCount = tpl.reduce((s, m) => s + m.tasks.length, 0);
        base.push(
          { key: "milestones", label: "Gerar milestones", description: `${tpl.length} etapas serão criadas a partir do template.` },
          { key: "tasks", label: "Distribuir tarefas", description: `${taskCount} tarefas, vinculadas a cada milestone.` },
          { key: "checklists", label: "Aplicar checklists", description: "Itens de checklist anexados às tarefas." },
        );
      }
      return base;
    }
    if (parsed?.kind === "create_task") return [{ key: "single", label: "Criar tarefa", description: `"${answers.task_title || ""}"` }];
    if (parsed?.kind === "create_milestone") return [{ key: "single", label: "Criar etapa", description: `"${answers.milestone_title || ""}"` }];
    return [];
  }, [parsed, answers]);

  const stagedFinalize = async (finalRefs: CreatedRefs) => {
    const transcript = (finalText + " " + interim).trim();
    const client = stageContext.client || resolvedClient;
    const resultMsg =
      parsed?.kind === "create_project"
        ? `Projeto "${answers.project_name}" criado${client ? ` para ${client.company_name || client.full_name}` : ""}`
        : parsed?.kind === "create_task"
          ? `Tarefa "${answers.task_title}" criada`
          : parsed?.kind === "create_milestone"
            ? `Etapa "${answers.milestone_title}" criada`
            : "Executado";
    setLastAction({ id: crypto.randomUUID(), label: resultMsg, createdAt: Date.now(), refs: finalRefs });
    appendLog({ kind: "ok", text: resultMsg });
    toast({ title: "Concluído", description: `${resultMsg} · Disponível para desfazer.` });
    if (user) {
      supabase.from("voice_command_log" as any).insert({
        user_id: user.id, transcript, intent: parsed as any, status: "success", result: resultMsg,
        clarifications: answers, preview: formatScopePreview(answers, client?.company_name),
      }).then(() => {});
    }
  };

  const runStage = async (idx: number) => {
    if (!parsed || !user || executing) return;
    const stage = stages[idx];
    if (!stage) return;
    setExecuting(true);
    const refs: CreatedRefs = {
      projectIds: [...stageRefs.projectIds],
      milestoneIds: [...stageRefs.milestoneIds],
      taskIds: [...stageRefs.taskIds],
      checklistItemIds: [...stageRefs.checklistItemIds],
      fileIds: [...stageRefs.fileIds],
    };
    try {
      if (stage.key === "project") {
        const client = clientList.find((c) => c.id === answers.client_id) || resolvedClient;
        if (!client) throw new Error("Cliente não selecionado");
        const project = await stageCreateProject(client, refs);
        setStageContext((c) => ({ ...c, client, project }));
      } else if (stage.key === "milestones") {
        if (!stageContext.project) throw new Error("Projeto não criado nesta sessão");
        const ms = await stageCreateMilestones(stageContext.project, refs);
        setStageContext((c) => ({ ...c, milestones: ms }));
      } else if (stage.key === "tasks") {
        if (!stageContext.project) throw new Error("Projeto não criado");
        const ts = await stageCreateTasks(stageContext.project, stageContext.milestones || [], refs);
        const chk = await fetchChkTemplates();
        setStageContext((c) => ({ ...c, tasks: ts, chkTemplates: chk }));
      } else if (stage.key === "checklists") {
        await stageCreateChecklists(stageContext.tasks || [], stageContext.chkTemplates || [], refs);
      } else if (stage.key === "single") {
        if (parsed.kind === "create_task") await execCreateTaskFull(answers, refs);
        else if (parsed.kind === "create_milestone") await execCreateMilestoneFull(answers, refs);
        const client = clientList.find((c) => c.id === answers.client_id) || resolvedClient;
        setStageContext((c) => ({ ...c, client }));
      }
      setStageRefs(refs);
      setStageAck(false);
      const next = idx + 1;
      setStageIdx(next);
      if (next >= stages.length) await stagedFinalize(refs);
    } catch (err: any) {
      const msg = err?.message || "Falha";
      appendLog({ kind: "error", text: `Fase "${stage.label}": ${msg}` });
      toast({ title: "Falha na fase", description: msg, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };


  const undoLastAction = async () => {
    if (!lastAction || undoing) return;
    setUndoing(true);
    const { refs, label } = lastAction;
    try {
      // Delete in reverse dependency order
      if (refs.checklistItemIds.length)
        await supabase.from("task_checklist_items").delete().in("id", refs.checklistItemIds);
      if (refs.taskIds.length)
        await supabase.from("tasks").delete().in("id", refs.taskIds);
      if (refs.milestoneIds.length)
        await supabase.from("milestones").delete().in("id", refs.milestoneIds);
      if (refs.projectIds.length)
        await supabase.from("projects").delete().in("id", refs.projectIds);
      if (refs.fileIds.length)
        await supabase.from("files").delete().in("id", refs.fileIds);
      appendLog({ kind: "info", text: `↶ Desfeito: ${label}` });
      toast({ title: "Ação revertida", description: label });
      setLastAction(null);
    } catch (err: any) {
      toast({ title: "Falha ao desfazer", description: err?.message || "Erro", variant: "destructive" });
    } finally {
      setUndoing(false);
    }
  };


  // ---- Staged project creation helpers (per-phase execution) ----
  async function stageCreateProject(client: any, refs: CreatedRefs) {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + (answers.deadline || 30));
    const description = defaultProjectDescription(answers.project_type, client.company_name || client.full_name);
    const { data: project, error } = await supabase.from("projects").insert({
      client_id: client.id,
      name: answers.project_name,
      project_type: answers.project_type,
      description,
      status: "planning",
      progress: 0,
      start_date: start.toISOString().slice(0, 10),
      deadline: end.toISOString().slice(0, 10),
      created_by: user!.id,
    }).select().single();
    if (error) throw error;
    refs.projectIds.push(project.id);
    return project;
  }

  async function stageCreateMilestones(project: any, refs: CreatedRefs) {
    const template = projectTemplates[answers.project_type] || projectTemplates.other;
    if (!template) return [];
    const start = new Date(project.start_date);
    const out: Array<{ milestone: any; tm: any }> = [];
    for (const tm of template) {
      const targetDate = new Date(start);
      targetDate.setDate(targetDate.getDate() + tm.offsetDays);
      const { data: milestone, error } = await supabase.from("milestones").insert({
        project_id: project.id,
        title: tm.title,
        target_date: targetDate.toISOString().slice(0, 10),
        status: "pending",
      }).select().single();
      if (error) throw error;
      if (milestone?.id) refs.milestoneIds.push(milestone.id);
      out.push({ milestone, tm });
    }
    return out;
  }

  async function stageCreateTasks(project: any, milestones: Array<{ milestone: any; tm: any }>, refs: CreatedRefs) {
    const out: Array<{ task: any; t: any; milestone: any }> = [];
    for (const { milestone, tm } of milestones) {
      const targetDate = new Date(milestone.target_date);
      for (const t of tm.tasks) {
        const taskDescription = [
          t.description ? `**Escopo:** ${t.description}` : null,
          `**Critério de aceite:** entrega validada e aprovada.`,
        ].filter(Boolean).join("\n\n");
        const { data: task, error } = await supabase.from("tasks").insert({
          project_id: project.id,
          milestone_id: milestone?.id,
          title: t.title,
          description: taskDescription,
          priority: t.priority,
          status: "backlog",
          due_date: targetDate.toISOString().slice(0, 10),
        }).select().single();
        if (error) throw error;
        if (task?.id) refs.taskIds.push(task.id);
        out.push({ task, t, milestone });
      }
    }
    return out;
  }

  async function fetchChkTemplates() {
    const { data: chkTpls } = await supabase
      .from("task_checklist_templates" as any).select("*")
      .or(`service_type.eq.${answers.project_type},service_type.is.null`);
    const tplIds = (chkTpls || []).map((t: any) => t.id);
    const { data: chkItems } = tplIds.length
      ? await supabase.from("task_checklist_template_items" as any).select("*").in("template_id", tplIds)
      : { data: [] as any[] };
    return (chkTpls || []).map((t: any) => ({
      ...t, items: (chkItems || []).filter((i: any) => i.template_id === t.id),
    }));
  }

  async function stageCreateChecklists(
    tasks: Array<{ task: any; t: any }>,
    chkTemplates: any[],
    refs: CreatedRefs,
  ) {
    for (const { task, t } of tasks) {
      const match = chkTemplates.find((c: any) =>
        norm(c.title).includes(norm(t.title).split(" ")[0]) ||
        (c.service_type === answers.project_type)
      );
      if (match?.items?.length) {
        const rows = match.items
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((it: any, idx: number) => ({
            task_id: task.id,
            title: it.label,
            item_order: idx,
            created_by: user!.id,
          }));
        const { data: inserted } = await supabase.from("task_checklist_items").insert(rows).select("id");
        (inserted || []).forEach((r: any) => refs.checklistItemIds.push(r.id));
      }
    }
  }


  async function execCreateTaskFull(a: Record<string, any>, refs: CreatedRefs) {
    const p = parsed as Extract<ParsedIntent, { kind: "create_task" }>;
    const client = clientList.find((c) => c.id === a.client_id);
    let q = supabase.from("projects").select("id, name, project_type, client_id").is("deleted_at", null);
    if (client) q = q.eq("client_id", client.id);
    const { data: projects } = await q;
    const project = bestMatch(projects || [], p.projectHint || "", [(x: any) => x.name]) || projects?.[0];
    if (!project) throw new Error("Projeto não encontrado");
    const due = new Date();
    due.setDate(due.getDate() + 7);
    const { data, error } = await supabase.from("tasks").insert({
      project_id: project.id,
      title: a.task_title || p.title,
      status: p.status || "backlog",
      priority: p.priority || "medium",
      due_date: due.toISOString().slice(0, 10),
    }).select("id").single();
    if (error) throw error;
    if (data?.id) refs.taskIds.push(data.id);
  }

  async function execCreateMilestoneFull(a: Record<string, any>, refs: CreatedRefs) {
    const p = parsed as Extract<ParsedIntent, { kind: "create_milestone" }>;
    const client = clientList.find((c) => c.id === a.client_id);
    let q = supabase.from("projects").select("id, name, client_id").is("deleted_at", null);
    if (client) q = q.eq("client_id", client.id);
    const { data: projects } = await q;
    const project = bestMatch(projects || [], p.projectHint || "", [(x: any) => x.name]) || projects?.[0];
    if (!project) throw new Error("Projeto não encontrado");
    const target = new Date();
    target.setDate(target.getDate() + (p.days || 14));
    const { data, error } = await supabase.from("milestones").insert({
      project_id: project.id,
      title: a.milestone_title || p.title,
      target_date: target.toISOString().slice(0, 10),
      status: "pending",
    }).select("id").single();
    if (error) throw error;
    if (data?.id) refs.milestoneIds.push(data.id);
  }

  // ---- Legacy report/upload/update intents ----
  async function execUpdateTaskStatus(p: Extract<ParsedIntent, { kind: "update_task_status" }>) {
    const { data } = await supabase.from("tasks").select("id, title").is("deleted_at", null);
    const task = bestMatch(data || [], p.taskHint, [(t: any) => t.title]);
    if (!task) throw new Error(`Tarefa "${p.taskHint}" não encontrada`);
    const { error } = await supabase.from("tasks").update({ status: p.status }).eq("id", task.id);
    if (error) throw error;
    appendLog({ kind: "ok", text: `Tarefa "${(task as any).title}" → ${p.status}` });
  }

  async function execReportPending(p: Extract<ParsedIntent, { kind: "report_pending" }>) {
    const client = p.clientHint ? bestMatch(clientList, p.clientHint, [(c: any) => c.company_name, (c: any) => c.full_name]) : null;
    const { data: projects } = await supabase
      .from("projects").select("id, name, client_id")
      .is("deleted_at", null).match(client ? { client_id: client.id } : {});
    const ids = (projects || []).map((p: any) => p.id);
    if (!ids.length) { appendLog({ kind: "info", text: "Nenhum projeto." }); return; }
    const { data: tasks } = await supabase.from("tasks").select("title, status, project_id, due_date")
      .in("project_id", ids).neq("status", "done").is("deleted_at", null);
    const byProj: Record<string, any[]> = {};
    (tasks || []).forEach((t: any) => { (byProj[t.project_id] = byProj[t.project_id] || []).push(t); });
    const lines: string[] = [];
    (projects || []).forEach((pr: any) => {
      const ts = byProj[pr.id] || []; if (!ts.length) return;
      lines.push(`📁 ${pr.name}`);
      ts.slice(0, 8).forEach((t) => lines.push(`   • [${t.status}] ${t.title}${t.due_date ? ` — ${t.due_date}` : ""}`));
    });
    appendLog({ kind: "info", text: lines.length ? lines.join("\n") : "Sem pendências." });
  }

  async function execReportOverview(p: Extract<ParsedIntent, { kind: "report_overview" }>) {
    const client = p.clientHint ? bestMatch(clientList, p.clientHint, [(c: any) => c.company_name, (c: any) => c.full_name]) : null;
    let q = supabase.from("projects").select("name, status, progress, deadline").is("deleted_at", null);
    if (client) q = q.eq("client_id", client.id);
    const { data } = await q;
    const lines = (data || []).map((p: any) => `📁 ${p.name} — ${p.status} · ${p.progress}%${p.deadline ? ` · ${p.deadline}` : ""}`);
    appendLog({ kind: "info", text: lines.join("\n") || "Nenhum projeto." });
  }

  async function execUploadFile(p: Extract<ParsedIntent, { kind: "upload_file" }>) {
    if (!file) throw new Error("Anexe um arquivo (clipe ao lado do mic)");
    const client = p.clientHint ? bestMatch(clientList, p.clientHint, [(c: any) => c.company_name, (c: any) => c.full_name]) : null;
    if (!client) throw new Error("Cliente não identificado");
    const path = `${client.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("files").upload(path, file);
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("files").getPublicUrl(path);
    const { error } = await supabase.from("files").insert({
      client_id: client.id, file_name: file.name, file_url: pub.publicUrl,
      file_type: file.type, folder: p.folder || "operacionais", uploaded_by: user!.id,
    } as any);
    if (error) throw error;
    appendLog({ kind: "ok", text: `Arquivo "${file.name}" enviado` });
  }

  if (!isAdmin) return null;

  const scopePreview = phase === "preview" && parsed?.kind === "create_project"
    ? formatScopePreview(answers, resolvedClient?.company_name || resolvedClient?.full_name)
    : null;

  const filteredClients = clientSearch
    ? clientList.filter((c) =>
        norm(`${c.company_name} ${c.full_name} ${c.email}`).includes(norm(clientSearch)),
      ).slice(0, 6)
    : clientList.slice(0, 6);

  const projectTemplate = answers.project_type ? projectTemplates[answers.project_type] : null;
  const previewTaskCount = (projectTemplate || []).reduce((s, m) => s + m.tasks.length, 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform"
        title="Assistente"
      >
        <Sparkles className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end md:items-center md:justify-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <motion.div
              className="relative w-full md:w-[460px] md:m-6 md:rounded-2xl bg-card border border-border max-h-[92vh] flex flex-col"
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Assistente Operacional</p>
                    <p className="text-[11px] text-muted-foreground">
                      {phase === "input" && "Voz · sem IA externa"}
                      {phase === "clarify" && "Confirme os detalhes"}
                      {phase === "preview" && "Revisão do escopo"}
                      {phase === "confirm" && "Confirmação final"}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
                {/* ---------- INPUT PHASE ---------- */}
                {phase === "input" && (
                  <>
                    {lastAction && (
                      <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-primary">Última ação</p>
                          <p className="text-xs text-foreground truncate">{lastAction.label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {lastAction.refs.projectIds.length} projeto · {lastAction.refs.milestoneIds.length} etapas · {lastAction.refs.taskIds.length} tarefas · {lastAction.refs.checklistItemIds.length} checklists
                          </p>
                        </div>
                        <button
                          onClick={undoLastAction}
                          disabled={undoing}
                          className="shrink-0 text-xs px-3 h-8 rounded-full bg-destructive/15 text-destructive border border-destructive/30 flex items-center gap-1.5 hover:bg-destructive/25 disabled:opacity-50"
                        >
                          {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                          Desfazer
                        </button>
                      </div>
                    )}
                    <div className="min-h-[88px] rounded-xl bg-secondary/50 border border-border p-3 text-sm text-foreground">
                      {finalText || interim ? (
                        <>
                          <span>{finalText}</span>{" "}
                          <span className="text-muted-foreground italic">{interim}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          Toque no mic e fale. Ex.: "Criar projeto de tráfego para Mirante com prazo 30 dias"
                        </span>
                      )}
                    </div>
                    <textarea
                      value={finalText}
                      onChange={(e) => setFinalText(e.target.value)}
                      placeholder="Ou escreva o comando aqui..."
                      className="w-full text-sm bg-background border border-border rounded-lg p-2 min-h-[60px] focus:outline-none focus:border-primary"
                    />
                    {parsed && (
                      <div className={`rounded-xl p-3 border ${parsed.kind === "unknown" ? "border-destructive/40 bg-destructive/5" : "border-primary/40 bg-primary/5"}`}>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Interpretação</p>
                        <p className="text-sm font-medium text-foreground">{summarizeIntent(parsed)}</p>
                      </div>
                    )}
                    {file && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileText className="w-3.5 h-3.5" />
                        {file.name}
                        <button onClick={() => setFile(null)} className="text-destructive ml-1">remover</button>
                      </div>
                    )}
                    {log.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-border">
                        {log.map((l) => (
                          <div key={l.id} className={`text-xs flex gap-2 items-start whitespace-pre-line ${l.kind === "error" ? "text-destructive" : l.kind === "ok" ? "text-primary" : "text-muted-foreground"}`}>
                            {l.kind === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : l.kind === "error" ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                            <span>{l.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* ---------- CLARIFY PHASE ---------- */}
                {phase === "clarify" && parsed && (
                  <div className="space-y-3">
                    {gaps.map((g) => {
                      if (g.id === "client") {
                        return (
                          <div key="client" className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs font-medium text-foreground mb-2">{g.label}</p>
                            <input
                              value={clientSearch}
                              onChange={(e) => setClientSearch(e.target.value)}
                              placeholder="Buscar cliente…"
                              className="w-full text-sm bg-background border border-border rounded p-2 mb-2"
                            />
                            <ul className="space-y-1 max-h-[160px] overflow-y-auto">
                              {filteredClients.map((c) => (
                                <li key={c.id}>
                                  <button
                                    onClick={() => setAnswers((a) => ({ ...a, client_id: c.id }))}
                                    className={`w-full text-left text-xs px-2 py-1.5 rounded transition ${
                                      answers.client_id === c.id ? "bg-primary/20 text-foreground" : "hover:bg-secondary text-muted-foreground"
                                    }`}
                                  >
                                    {c.company_name || c.full_name}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      }
                      if (g.id === "project_type") {
                        return (
                          <div key="ptype" className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs font-medium text-foreground mb-2">{g.label}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {g.options.map((o) => (
                                <button
                                  key={o.value}
                                  onClick={() => setAnswers((a) => ({
                                    ...a,
                                    project_type: o.value,
                                    deadline: suggestDeadline(o.value),
                                    project_name: suggestProjectName({
                                      type: o.value,
                                      clientName: resolvedClient?.company_name || resolvedClient?.full_name,
                                      rawHint: (parsed as any).name,
                                    }),
                                  }))}
                                  className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                                    answers.project_type === o.value
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "border-border text-muted-foreground hover:border-primary"
                                  }`}
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (g.id === "project_name") {
                        return (
                          <div key="pname" className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1">
                              <Edit3 className="w-3 h-3" /> Nome do projeto
                            </p>
                            <input
                              value={answers.project_name || ""}
                              onChange={(e) => setAnswers((a) => ({ ...a, project_name: e.target.value }))}
                              className="w-full text-sm bg-background border border-border rounded p-2"
                            />
                          </div>
                        );
                      }
                      if (g.id === "deadline") {
                        return (
                          <div key="dl" className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs font-medium text-foreground mb-2">{g.label}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {g.options.map((o) => (
                                <button
                                  key={o.value}
                                  onClick={() => setAnswers((a) => ({ ...a, deadline: o.value }))}
                                  className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                                    answers.deadline === o.value
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "border-border text-muted-foreground hover:border-primary"
                                  }`}
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (g.id === "apply_template") {
                        return (
                          <div key="tpl" className="rounded-xl border border-border bg-secondary/40 p-3 flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium text-foreground">Aplicar template completo</p>
                              <p className="text-[10px] text-muted-foreground">
                                Cria milestones, tarefas e checklists do tipo selecionado
                              </p>
                            </div>
                            <button
                              onClick={() => setAnswers((a) => ({ ...a, apply_template: !a.apply_template }))}
                              className={`w-10 h-5 rounded-full transition ${answers.apply_template ? "bg-primary" : "bg-muted"}`}
                            >
                              <div className={`w-4 h-4 rounded-full bg-card transition transform ${answers.apply_template ? "translate-x-5" : "translate-x-0.5"}`} />
                            </button>
                          </div>
                        );
                      }
                      if (g.id === "task_title" || g.id === "milestone_title") {
                        const k = g.id;
                        return (
                          <div key={k} className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs font-medium text-foreground mb-2">{g.label}</p>
                            <input
                              value={answers[k] || ""}
                              onChange={(e) => setAnswers((a) => ({ ...a, [k]: e.target.value }))}
                              className="w-full text-sm bg-background border border-border rounded p-2"
                            />
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}

                {/* ---------- PREVIEW PHASE ---------- */}
                {phase === "preview" && parsed?.kind === "create_project" && scopePreview && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-primary">Escopo do projeto</p>
                      <h3 className="text-base font-semibold text-foreground">{answers.project_name}</h3>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-muted-foreground">Cliente:</span>{" "}
                          <span className="text-foreground font-medium">
                            {resolvedClient?.company_name || resolvedClient?.full_name}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tipo:</span>{" "}
                          <span className="text-foreground font-medium">{answers.project_type}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Início:</span>{" "}
                          <span className="text-foreground font-mono">{scopePreview.startDate}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Entrega:</span>{" "}
                          <span className="text-foreground font-mono">{scopePreview.endDate}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground whitespace-pre-line pt-1 border-t border-border">
                        {scopePreview.description}
                      </p>
                    </div>

                    {answers.apply_template && projectTemplate && (
                      <div className="rounded-xl border border-border bg-secondary/40 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                          Vai criar · {projectTemplate.length} milestones · {previewTaskCount} tarefas · checklists
                        </p>
                        <ul className="space-y-1.5">
                          {projectTemplate.map((m) => (
                            <li key={m.title} className="text-xs">
                              <p className="font-medium text-foreground">▸ {m.title}</p>
                              <ul className="ml-4 mt-0.5 space-y-0.5 text-muted-foreground">
                                {m.tasks.slice(0, 3).map((t) => (
                                  <li key={t.title} className="text-[11px]">· {t.title}</li>
                                ))}
                                {m.tasks.length > 3 && <li className="text-[10px] italic">+ {m.tasks.length - 3} tarefas</li>}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* ---------- CONFIRM PHASE (staged, one checkbox per phase) ---------- */}
                {phase === "confirm" && parsed && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-foreground">Execução por fases</p>
                          <p className="text-[11px] text-muted-foreground">
                            Cada fase precisa do seu próprio check antes de gravar. Você pode parar a qualquer momento — o que já foi criado fica reversível pelo "Desfazer".
                          </p>
                        </div>
                      </div>
                    </div>

                    {stages.map((s, i) => {
                      const isDone = i < stageIdx;
                      const isActive = i === stageIdx;
                      const isLocked = i > stageIdx;
                      const counts =
                        s.key === "project" ? stageRefs.projectIds.length :
                        s.key === "milestones" ? stageRefs.milestoneIds.length :
                        s.key === "tasks" ? stageRefs.taskIds.length :
                        s.key === "checklists" ? stageRefs.checklistItemIds.length :
                        (stageRefs.taskIds.length + stageRefs.milestoneIds.length);
                      return (
                        <div
                          key={s.key}
                          className={`rounded-xl border p-3 transition ${
                            isDone ? "border-primary/40 bg-primary/5" :
                            isActive ? "border-primary bg-secondary/40" :
                            "border-border bg-secondary/20 opacity-50"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                              isDone ? "bg-primary text-primary-foreground" :
                              isActive ? "border border-primary text-primary" :
                              "border border-border text-muted-foreground"
                            }`}>
                              {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground">{s.label}</p>
                              <p className="text-[11px] text-muted-foreground">{s.description}</p>
                              {isDone && counts > 0 && (
                                <p className="text-[10px] text-primary mt-1">✓ {counts} item(s) criado(s)</p>
                              )}
                            </div>
                          </div>

                          {isActive && (
                            <div className="mt-3 space-y-2">
                              <label className="flex items-start gap-2 cursor-pointer text-[11px] text-foreground p-2 rounded-lg border border-border bg-background">
                                <input
                                  type="checkbox"
                                  checked={stageAck}
                                  onChange={(e) => setStageAck(e.target.checked)}
                                  className="mt-0.5 w-3.5 h-3.5 accent-primary"
                                />
                                <span>Confirmo executar esta fase agora.</span>
                              </label>
                              <button
                                onClick={() => runStage(i)}
                                disabled={!stageAck || executing}
                                className="w-full h-9 rounded-full bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                              >
                                {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Executar fase {i + 1} de {stages.length}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {stageIdx >= stages.length && stages.length > 0 && (
                      <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-xs text-foreground flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        Todas as fases concluídas.
                      </div>
                    )}
                  </div>
                )}

              </div>


              {/* Footer */}
              <div className="px-5 py-3 border-t border-border flex items-center gap-2">
                {phase === "input" && (
                  <>
                    <button
                      onClick={listening ? stopListening : startListening}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition ${listening ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-primary text-primary-foreground"}`}
                    >
                      {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <label className="w-10 h-10 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center cursor-pointer">
                      <Paperclip className="w-4 h-4" />
                      <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    </label>
                    <button
                      onClick={advanceFromInput}
                      disabled={!parsed || parsed.kind === "unknown" || executing}
                      className="flex-1 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                      Avançar
                    </button>
                  </>
                )}
                {phase === "clarify" && (
                  <>
                    <button
                      onClick={() => setPhase("input")}
                      className="px-3 h-10 rounded-full bg-secondary text-foreground text-sm"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={() => {
                        if (parsed?.kind === "create_project") setPhase("preview");
                        else { setConfirmAck(false); setPhase("confirm"); }
                      }}
                      disabled={parsed?.kind === "create_project" && !answers.client_id}
                      className="flex-1 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {parsed?.kind === "create_project" ? "Revisar escopo" : "Revisar"}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </>
                )}
                {phase === "preview" && (
                  <>
                    <button
                      onClick={() => setPhase("clarify")}
                      className="px-3 h-10 rounded-full bg-secondary text-foreground text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => { setConfirmAck(false); setPhase("confirm"); }}
                      className="flex-1 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2"
                    >
                      <ArrowRight className="w-4 h-4" />
                      Confirmar
                    </button>
                  </>
                )}
                {phase === "confirm" && (
                  <>
                    <button
                      onClick={() => {
                        if (stageIdx > 0) return; // can't edit mid-execution
                        setPhase(parsed?.kind === "create_project" ? "preview" : "clarify");
                      }}
                      className="px-3 h-10 rounded-full bg-secondary text-foreground text-sm disabled:opacity-40"
                      disabled={executing || stageIdx > 0}
                    >
                      Voltar
                    </button>
                    <button
                      onClick={reset}
                      disabled={executing}
                      className="flex-1 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {stageIdx >= stages.length && stages.length > 0 ? "Concluir" : "Cancelar fluxo"}
                    </button>
                  </>
                )}
              </div>


              {!supported && phase === "input" && (
                <p className="px-5 pb-3 text-[10px] text-muted-foreground">
                  Reconhecimento de voz indisponível. Use Chrome/Edge ou digite o comando.
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

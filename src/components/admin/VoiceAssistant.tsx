import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Sparkles, X, Send, Paperclip, Loader2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { parseCommand, summarizeIntent, ParsedIntent } from "@/lib/voiceCommands";

// ---- Browser SpeechRecognition typings ----
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

// ---- Fuzzy match helpers ----
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

interface LogEntry {
  id: string;
  kind: "ok" | "error" | "info";
  text: string;
}

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

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (!open) return;
    return () => stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop?.();
    } catch {}
    recRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const startListening = useCallback(() => {
    if (!supported) {
      toast({ title: "Voz não suportada", description: "Use Chrome/Edge no desktop.", variant: "destructive" });
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.onresult = (e: any) => {
      let finals = "";
      let interims = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + " ";
        else interims += r[0].transcript;
      }
      if (finals) setFinalText((prev) => (prev + " " + finals).trim());
      setInterim(interims);
    };
    rec.onerror = (e: any) => {
      console.error("speech error", e);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      console.error(err);
    }
  }, [supported, toast]);

  const reset = () => {
    setFinalText("");
    setInterim("");
    setParsed(null);
    setFile(null);
  };

  const handleParse = () => {
    const full = (finalText + " " + interim).trim();
    if (!full) return;
    setParsed(parseCommand(full));
  };

  // Auto re-parse when text changes
  useEffect(() => {
    const full = (finalText + " " + interim).trim();
    if (full) setParsed(parseCommand(full));
    else setParsed(null);
  }, [finalText, interim]);

  const appendLog = (entry: Omit<LogEntry, "id">) =>
    setLog((l) => [{ id: crypto.randomUUID(), ...entry }, ...l].slice(0, 12));

  // ---- Execute action ----
  const execute = async () => {
    if (!parsed || parsed.kind === "unknown" || !user) return;
    setExecuting(true);
    const transcript = (finalText + " " + interim).trim();
    let status: "success" | "error" = "success";
    let resultMsg = "";
    try {
      switch (parsed.kind) {
        case "create_project":
          await execCreateProject(parsed); break;
        case "create_task":
          await execCreateTask(parsed); break;
        case "create_milestone":
          await execCreateMilestone(parsed); break;
        case "update_task_status":
          await execUpdateTaskStatus(parsed); break;
        case "report_pending":
          await execReportPending(parsed); break;
        case "report_overview":
          await execReportOverview(parsed); break;
        case "upload_file":
          await execUploadFile(parsed); break;
      }
      resultMsg = summarizeIntent(parsed);
      reset();
      stopListening();
    } catch (err: any) {
      status = "error";
      resultMsg = err?.message || "Falha na execução";
      appendLog({ kind: "error", text: resultMsg });
    } finally {
      setExecuting(false);
      // Audit log (fire-and-forget)
      supabase.from("voice_command_log" as any).insert({
        user_id: user.id,
        transcript,
        intent: parsed as any,
        status,
        result: resultMsg,
      }).then(({ error }) => { if (error) console.warn("voice log:", error.message); });
    }
  };


  // ---- Action implementations ----

  async function resolveClient(hint?: string) {
    const { data } = await supabase
      .from("user_roles").select("user_id").eq("role", "client");
    const ids = (data || []).map((r: any) => r.user_id);
    if (!ids.length) return null;
    const { data: profs } = await supabase
      .from("profiles").select("id, full_name, company_name, email").in("id", ids).is("deleted_at", null);
    if (!hint) return profs?.[0] || null;
    return bestMatch(profs || [], hint, [(p) => p.company_name, (p) => p.full_name, (p) => p.email]) || null;
  }

  async function resolveProject(hint?: string, clientId?: string) {
    let q = supabase.from("projects").select("id, name, client_id").is("deleted_at", null);
    if (clientId) q = q.eq("client_id", clientId);
    const { data } = await q;
    if (!data?.length) return null;
    if (!hint) return data[0];
    return bestMatch(data, hint, [(p: any) => p.name]) || null;
  }

  async function execCreateProject(p: Extract<ParsedIntent, { kind: "create_project" }>) {
    const client = await resolveClient(p.clientHint);
    if (!client) throw new Error("Cliente não encontrado");
    const start = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + (p.deadlineDays || 30));
    const { data, error } = await supabase.from("projects").insert({
      client_id: client.id,
      name: p.name,
      project_type: p.type || "outro",
      status: "planning",
      progress: 0,
      start_date: start.toISOString().slice(0, 10),
      deadline: deadline.toISOString().slice(0, 10),
      created_by: user!.id,
    }).select().single();
    if (error) throw error;
    appendLog({ kind: "ok", text: `Projeto "${data.name}" criado para ${client.company_name || client.full_name}` });
    toast({ title: "Projeto criado", description: data.name });
  }

  async function execCreateTask(p: Extract<ParsedIntent, { kind: "create_task" }>) {
    const client = p.clientHint ? await resolveClient(p.clientHint) : null;
    const project = await resolveProject(p.projectHint, client?.id);
    if (!project) throw new Error("Projeto não encontrado");
    const { error } = await supabase.from("tasks").insert({
      project_id: project.id,
      title: p.title,
      status: p.status || "backlog",
      priority: p.priority || "medium",
    });
    if (error) throw error;
    appendLog({ kind: "ok", text: `Tarefa "${p.title}" criada em ${project.name}` });
    toast({ title: "Tarefa criada", description: p.title });
  }

  async function execCreateMilestone(p: Extract<ParsedIntent, { kind: "create_milestone" }>) {
    const client = p.clientHint ? await resolveClient(p.clientHint) : null;
    const project = await resolveProject(p.projectHint, client?.id);
    if (!project) throw new Error("Projeto não encontrado");
    const target = new Date();
    target.setDate(target.getDate() + (p.days || 14));
    const { error } = await supabase.from("milestones").insert({
      project_id: project.id,
      title: p.title,
      target_date: target.toISOString().slice(0, 10),
      status: "pending",
    });
    if (error) throw error;
    appendLog({ kind: "ok", text: `Etapa "${p.title}" criada em ${project.name}` });
  }

  async function execUpdateTaskStatus(p: Extract<ParsedIntent, { kind: "update_task_status" }>) {
    const client = p.clientHint ? await resolveClient(p.clientHint) : null;
    let q = supabase.from("tasks").select("id, title, project_id, projects(name, client_id)").is("deleted_at", null);
    const { data } = await q;
    let candidates = data || [];
    if (client) candidates = candidates.filter((t: any) => t.projects?.client_id === client.id);
    const task = bestMatch(candidates, p.taskHint, [(t: any) => t.title]);
    if (!task) throw new Error(`Tarefa "${p.taskHint}" não encontrada`);
    const { error } = await supabase.from("tasks").update({ status: p.status }).eq("id", task.id);
    if (error) throw error;
    appendLog({ kind: "ok", text: `Tarefa "${(task as any).title}" → ${p.status}` });
    toast({ title: "Tarefa atualizada", description: (task as any).title });
  }

  async function execReportPending(p: Extract<ParsedIntent, { kind: "report_pending" }>) {
    const client = p.clientHint ? await resolveClient(p.clientHint) : null;
    if (p.clientHint && !client) throw new Error("Cliente não encontrado");
    const { data: projects } = await supabase
      .from("projects").select("id, name, client_id, profiles!projects_client_id_fkey(full_name, company_name)")
      .is("deleted_at", null).match(client ? { client_id: client.id } : {});
    const projectIds = (projects || []).map((p: any) => p.id);
    if (!projectIds.length) {
      appendLog({ kind: "info", text: "Nenhum projeto encontrado." });
      return;
    }
    const { data: tasks } = await supabase
      .from("tasks").select("title, status, project_id, due_date")
      .in("project_id", projectIds).neq("status", "done").is("deleted_at", null);
    const byProj: Record<string, any[]> = {};
    (tasks || []).forEach((t: any) => {
      (byProj[t.project_id] = byProj[t.project_id] || []).push(t);
    });
    const lines: string[] = [];
    (projects || []).forEach((pr: any) => {
      const ts = byProj[pr.id] || [];
      if (ts.length === 0) return;
      lines.push(`📁 ${pr.name} (${pr.profiles?.company_name || pr.profiles?.full_name || "—"})`);
      ts.slice(0, 8).forEach((t) => lines.push(`   • [${t.status}] ${t.title}${t.due_date ? ` — ${t.due_date}` : ""}`));
    });
    appendLog({ kind: "info", text: lines.length ? lines.join("\n") : "Sem pendências." });
  }

  async function execReportOverview(p: Extract<ParsedIntent, { kind: "report_overview" }>) {
    const client = p.clientHint ? await resolveClient(p.clientHint) : null;
    let q = supabase
      .from("projects").select("name, status, progress, deadline, profiles!projects_client_id_fkey(company_name, full_name)")
      .is("deleted_at", null);
    if (client) q = q.eq("client_id", client.id);
    const { data } = await q;
    const lines = (data || []).map((p: any) =>
      `📁 ${p.name} — ${p.status} · ${p.progress}%${p.deadline ? ` · ${p.deadline}` : ""}`,
    );
    appendLog({ kind: "info", text: lines.join("\n") || "Nenhum projeto." });
  }

  async function execUploadFile(p: Extract<ParsedIntent, { kind: "upload_file" }>) {
    if (!file) throw new Error("Anexe um arquivo antes (clipe ao lado do mic)");
    const client = p.clientHint ? await resolveClient(p.clientHint) : null;
    if (!client) throw new Error("Cliente não identificado");
    const path = `${client.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("files").upload(path, file);
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("files").getPublicUrl(path);
    const { error } = await supabase.from("files").insert({
      client_id: client.id,
      file_name: file.name,
      file_url: pub.publicUrl,
      file_type: file.type,
      folder: p.folder || "operacionais",
      uploaded_by: user!.id,
    } as any);
    if (error) throw error;
    appendLog({ kind: "ok", text: `Arquivo "${file.name}" enviado para ${client.company_name || client.full_name}` });
  }

  if (!isAdmin) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform"
        title="Assistente de Voz"
      >
        <Sparkles className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end md:items-center md:justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <motion.div
              className="relative w-full md:w-[440px] md:m-6 md:rounded-2xl bg-card border border-border max-h-[90vh] flex flex-col"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Assistente</p>
                    <p className="text-[11px] text-muted-foreground">Voz · sem IA externa</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Transcript */}
              <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
                <div className="min-h-[88px] rounded-xl bg-secondary/50 border border-border p-3 text-sm text-foreground">
                  {finalText || interim ? (
                    <>
                      <span>{finalText}</span>{" "}
                      <span className="text-muted-foreground italic">{interim}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      Toque no mic e fale. Ex.: "Criar projeto Site Institucional para Mirante com prazo 30 dias"
                    </span>
                  )}
                </div>

                {/* Manual textarea fallback */}
                <textarea
                  value={finalText}
                  onChange={(e) => setFinalText(e.target.value)}
                  placeholder="Ou escreva o comando aqui..."
                  className="w-full text-sm bg-background border border-border rounded-lg p-2 min-h-[60px] focus:outline-none focus:border-primary"
                />

                {/* Parsed preview */}
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

                {/* Log */}
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
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-border flex items-center gap-2">
                <button
                  onClick={listening ? stopListening : startListening}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition ${listening ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-primary text-primary-foreground"}`}
                  title={listening ? "Parar" : "Gravar"}
                >
                  {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <label className="w-10 h-10 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center cursor-pointer">
                  <Paperclip className="w-4 h-4" />
                  <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </label>

                <button
                  onClick={execute}
                  disabled={!parsed || parsed.kind === "unknown" || executing}
                  className="flex-1 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Executar
                </button>
              </div>

              {!supported && (
                <p className="px-5 pb-3 text-[10px] text-muted-foreground">
                  Reconhecimento de voz indisponível neste navegador. Use Chrome/Edge ou digite o comando.
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

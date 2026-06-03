import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Sparkles, X, Send, Paperclip, Loader2, CheckCircle2, AlertCircle, FileText, ArrowRight, Edit3, Undo2, ShieldAlert, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { parseCommand, summarizeIntent, ParsedIntent } from "@/lib/voiceCommands";
import { gapsForIntent, suggestProjectName, suggestProjectNames, suggestDeadline, formatScopePreview, Clarification } from "@/lib/voiceConversation";
import { projectTemplates } from "@/lib/projectTemplates";
import { applyCorrections, learnFromEdit, loadCorrections } from "@/lib/voiceCorrections";
import { readFileContext, describeContext, FileContext } from "@/lib/fileContext";
import { addDaysBR, buildClientProjectFields } from "@/lib/projectPresentation";

type AnyRec = any;

const isIOS = typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
   (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1));

function getRecognition(): AnyRec | null {
  const W = window as any;
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "pt-BR";
  // iOS Safari truncates results when continuous=true; use single-shot + auto-restart.
  rec.continuous = !isIOS;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
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

/** Proactive search: scan the whole text for fuzzy client mentions, return top N. */
function findClientsMentioned<T extends { id: string }>(
  items: T[],
  text: string,
  fields: ((x: T) => string | null | undefined)[],
  limit = 3,
): T[] {
  if (!text || !items?.length) return [];
  const n = norm(text);
  const tokens = n.split(/\s+/).filter((t) => t.length >= 3);
  if (!tokens.length) return [];
  const scored: { item: T; score: number }[] = [];
  for (const it of items) {
    let best = 0;
    for (const f of fields) {
      const v = norm(f(it) || "");
      if (!v) continue;
      const vTokens = v.split(/\s+/).filter(Boolean);
      // exact substring of any client-name token in the spoken text → strong signal
      for (const vt of vTokens) {
        if (vt.length < 3) continue;
        if (tokens.includes(vt)) best = Math.max(best, 80);
        else if (tokens.some((t) => t.length >= 4 && (t.includes(vt) || vt.includes(t)))) {
          best = Math.max(best, 55);
        }
      }
      if (n.includes(v) && v.length >= 4) best = Math.max(best, 90);
    }
    if (best >= 55) scored.push({ item: it, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
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
  const [files, setFiles] = useState<File[]>([]);
  const [fileCtxs, setFileCtxs] = useState<FileContext[]>([]);
  const [fileReading, setFileReading] = useState(false);
  // Documentos carregados automaticamente do sistema quando um cliente é selecionado.
  const [systemDocs, setSystemDocs] = useState<{ fileName: string; text: string; source: string }[]>([]);
  const [systemDocsLoading, setSystemDocsLoading] = useState(false);
  // Helpers compostos: facilita lógica downstream que antes olhava `file`/`fileCtx` único.
  const hasAnyAttachment = fileCtxs.some((c) => c.text) || systemDocs.length > 0;
  const primaryCtxName = fileCtxs[0]?.fileName || systemDocs[0]?.fileName || null;
  const recRef = useRef<AnyRec | null>(null);
  const listeningModeRef = useRef<"command" | "refine">("command");
  const wantListenRef = useRef(false); // user intent (for iOS auto-restart)
  const lastSttRef = useRef(""); // last raw STT text for learning
  const corrections = useRef(loadCorrections());
  const supported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Conversational state
  const [phase, setPhase] = useState<Phase>("input");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [clientList, setClientList] = useState<any[]>([]);
  const [clientProjects, setClientProjects] = useState<any[]>([]);
  const [clientProjectsLoading, setClientProjectsLoading] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [confirmAck, setConfirmAck] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [learnedCount, setLearnedCount] = useState(0);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);
  const [aiPlan, setAiPlan] = useState<{ milestones: { title: string; offsetDays: number; tasks: { title: string; description?: string; priority: string; role: "admin"|"design"|"traffic"|"manager" }[] }[] } | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // 🔒 Trava o auto-trigger pra não ficar reanalisando em loop quando a IA falha
  // ou quando o usuário não pediu reanálise. Reseta a cada reset().
  const aiAttemptedRef = useRef(false);
  const [refineVoice, setRefineVoice] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [refineInterim, setRefineInterim] = useState("");


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

  const parsedRef = useRef<ParsedIntent | null>(null);
  const phaseRef = useRef<Phase>("input");
  useEffect(() => { parsedRef.current = parsed; }, [parsed]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

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
    wantListenRef.current = false;
    try { recRef.current?.stop?.(); } catch {}
    recRef.current = null;
    setListening(false);
    setInterim("");
    setRefineInterim("");
  }, []);

  const startListening = useCallback((mode: "command" | "refine" = "command") => {
    if (!supported) {
      toast({
        title: "Voz indisponível neste navegador",
        description: isIOS
          ? "No iPhone use Safari + iOS 14.5+. Ou digite o comando abaixo."
          : "Use Chrome ou Edge — ou digite o comando.",
        variant: "destructive",
      });
      return;
    }
    wantListenRef.current = false;
    try { recRef.current?.stop?.(); } catch {}
    recRef.current = null;
    listeningModeRef.current = mode;
    wantListenRef.current = true;
    if (mode === "refine") setRefineInterim("");
    else setInterim("");
    const launch = () => {
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
        if (finals) {
          const corrected = applyCorrections(finals, corrections.current);
          if (listeningModeRef.current === "refine") {
            setRefineText((prev) => (prev + " " + corrected).trim());
          } else {
            setFinalText((prev) => {
              const merged = (prev + " " + corrected).trim();
              lastSttRef.current = merged;
              return merged;
            });
          }
        }
        const correctedInterim = applyCorrections(interims, corrections.current);
        if (listeningModeRef.current === "refine") setRefineInterim(correctedInterim);
        else setInterim(correctedInterim);
      };
      rec.onerror = (e: any) => {
        const code = e?.error || "";
        if (code === "not-allowed" || code === "service-not-allowed") {
          toast({
            title: "Microfone bloqueado",
            description: "Permita o acesso ao microfone nas configurações do navegador.",
            variant: "destructive",
          });
          wantListenRef.current = false;
          setListening(false);
          return;
        }
        if (code === "no-speech" || code === "aborted" || code === "network") {
          // transient — onend will restart if user still wants it
          return;
        }
        setListening(false);
      };
      rec.onend = () => {
        // iOS Safari ends after every utterance; restart while user still wants it.
        if (wantListenRef.current) {
          setTimeout(() => { if (wantListenRef.current) launch(); }, 120);
        } else {
          setListening(false);
        }
      };
      try { rec.start(); setListening(true); } catch {}
    };
    launch();
  }, [supported, toast]);

  const reset = () => {
    setFinalText(""); setInterim(""); setParsed(null); setFiles([]); setFileCtxs([]); setSystemDocs([]);
    setPhase("input"); setAnswers({}); setClientSearch(""); setConfirmAck(false);
    setStageIdx(0); setStageAck(false); setStageRefs(emptyRefs()); setStageContext({});
    setAiNarrative(null); setAiPlan(null); setAiConfidence(null);
    aiAttemptedRef.current = false;
    setRefineVoice(false); setRefineText(""); setRefineInterim("");
    lastSttRef.current = "";
  };

  const returnToDraft = useCallback(() => {
    stopListening();
    setConfirmAck(false);
    setStageIdx(0);
    setStageAck(false);
    setStageRefs(emptyRefs());
    setStageContext({});
    setPhase(parsed?.kind === "create_project" ? "preview" : parsed ? "clarify" : "input");
  }, [parsed, stopListening]);

  const finishFlow = useCallback(() => {
    reset();
  }, []);

  const appendLog = useCallback((entry: Omit<LogEntry, "id">) =>
    setLog((l) => [{ id: crypto.randomUUID(), ...entry }, ...l].slice(0, 12)), []);

  // 🧠 Agente IA — interpreta voz + anexo (ou contrato do sistema) + base de
  // clientes. Roda em modelos GRATUITOS com fallback chain — nunca trava por
  // crédito; se tudo falhar, cai pro regex local sem quebrar.
  const runAgent = useCallback(async (opts?: { silent?: boolean; textOverride?: string }) => {
    const text = (opts?.textOverride ?? (finalText + " " + interim)).trim();
    const validCtxs = fileCtxs.filter((c) => c.text);
    const attachments = [
      ...validCtxs.map((c) => ({ fileName: c.fileName, text: c.text })),
      ...systemDocs.map((d) => ({ fileName: d.fileName, text: d.text })),
    ];
    if (!text && attachments.length === 0 && !answers.client_id) return;
    if (aiThinking) return;
    setAiThinking(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-assistant-agent", {
        body: {
          text,
          // Mantém `attachment` (compat) e adiciona `attachments` (lista) — o agente
          // concatena tudo no prompt pra ler O CONTRATO INTEIRO + briefings + anexos
          // do usuário, sem perder nada.
          attachment: attachments[0] || null,
          attachments,
          clientId: answers.client_id || null,
          // Se o componente já carregou docs do sistema, sinaliza pro edge skip recarregar.
          skipSystemContractAutoLoad: systemDocs.length > 0,
          clients: clientList.map((c) => ({
            id: c.id, company_name: c.company_name, full_name: c.full_name, email: c.email,
          })),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const intent = (data as any).intent || { kind: "unknown", raw: text };
      const currentParsed = parsedRef.current;
      const protectedDraft = phaseRef.current !== "input" && currentParsed?.kind === "create_project";
      setParsed(protectedDraft && intent.kind === "unknown" ? currentParsed : intent as ParsedIntent);
      setAiNarrative((prev) => (data as any).narrative || (protectedDraft ? prev : null));
      setAiPlan((prev) => (data as any).plan || (protectedDraft ? prev : null));
      setAiConfidence(typeof (data as any).confidence === "number" ? (data as any).confidence : null);
      const sug: string[] = Array.isArray((data as any).suggestedClientIds) ? (data as any).suggestedClientIds : [];
      if (sug.length && !answers.client_id) {
        const found = clientList.find((c) => c.id === sug[0]);
        if (found) setAnswers((a) => ({ ...a, client_id: found.id }));
      }
      if (!opts?.silent) {
        const degraded = (data as any)._degraded;
        const auto = (data as any)._contractAutoLoaded;
        const docsCount = attachments.length;
        const note = auto ? " · contratos lidos do sistema" : docsCount > 1 ? ` · ${docsCount} docs` : "";
        appendLog({
          kind: degraded ? "info" : "ok",
          text: `IA${note}: ${(data as any).narrative?.slice(0, 120) || "interpretação atualizada"}`,
        });
      }
    } catch (err: any) {
      appendLog({ kind: "info", text: `IA em modo local: ${err?.message || "indisponível"}` });
    } finally {
      setAiThinking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalText, interim, fileCtxs, systemDocs, clientList, answers.client_id, aiThinking]);

  // Auto-trigger IA quando há contexto novo (arquivo ou cliente).
  useEffect(() => {
    if (aiAttemptedRef.current) return;
    if (aiThinking) return;
    if (!(fileCtxs.some((c) => c.text) || answers.client_id || systemDocs.length)) return;
    aiAttemptedRef.current = true;
    runAgent({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileCtxs.length, answers.client_id, systemDocs.length]);

  // 📚 Quando admin escolhe um cliente, lê AUTOMATICAMENTE todos os documentos
  // dele (contratos + briefings + arquivos da pasta "contratos") pra alimentar
  // a IA com contexto completo. Faz só uma vez por cliente.
  const lastClientDocsRef = useRef<string | null>(null);
  useEffect(() => {
    const cid = answers.client_id;
    if (!cid || lastClientDocsRef.current === cid) return;
    lastClientDocsRef.current = cid;
    setSystemDocs([]);
    setSystemDocsLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("voice-assistant-agent", {
          body: { text: "", clientId: cid, fetchOnly: true },
        });
        if (error) throw error;
        const docs = Array.isArray((data as any)?.documents) ? (data as any).documents : [];
        setSystemDocs(docs);
        if (docs.length) {
          appendLog({ kind: "ok", text: `📚 ${docs.length} documento(s) do cliente carregado(s) automaticamente.` });
          aiAttemptedRef.current = false; // libera reanálise com os novos docs
        }
      } catch (err: any) {
        appendLog({ kind: "info", text: `Não consegui carregar documentos do cliente: ${err?.message || ""}` });
      } finally {
        setSystemDocsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers.client_id]);

  useEffect(() => {
    const cid = answers.client_id;
    setClientProjects([]);
    if (!cid) return;
    setClientProjectsLoading(true);
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, project_type, status, progress, deadline, created_at")
        .eq("client_id", cid)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      const list = data || [];
      setClientProjects(list);
      setAnswers((a) => (a.client_id === cid && !a.project_id && list.length === 0 ? { ...a, project_id: "new" } : a));
      setClientProjectsLoading(false);
    })();
  }, [answers.client_id]);

  const handleAttach = useCallback(async (input: File | File[] | FileList | null) => {
    if (input === null) {
      setFiles([]); setFileCtxs([]); return;
    }
    const arr: File[] = Array.isArray(input)
      ? input
      : input instanceof FileList
        ? Array.from(input)
        : [input];
    if (!arr.length) return;
    setFileReading(true);
    try {
      const ctxs = await Promise.all(arr.map((f) => readFileContext(f)));
      setFiles((prev) => [...prev, ...arr]);
      setFileCtxs((prev) => [...prev, ...ctxs]);
      const warned = ctxs.find((c) => c.warning);
      if (warned?.warning) toast({ title: "Anexo", description: warned.warning });
      aiAttemptedRef.current = false; // permite reanálise com novos anexos
    } catch (err: any) {
      toast({ title: "Falha ao ler anexo", description: err?.message || "Erro", variant: "destructive" });
    } finally {
      setFileReading(false);
    }
  }, [toast]);

  const removeAttachment = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setFileCtxs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleTextEdit = (next: string) => {
    setFinalText(next);
    const before = lastSttRef.current;
    if (before && before !== next) {
      const learned = learnFromEdit(before, next);
      if (learned > 0) {
        corrections.current = loadCorrections();
        setLearnedCount((c) => c + learned);
      }
      lastSttRef.current = next;
    }
  };

  // Auto re-parse when text or file context changes.
  // The file's extracted text is fed into the parser so the command can
  // reference "este documento" / "esse anexo" naturally.
  useEffect(() => {
    if (phaseRef.current !== "input") return;
    const spoken = (finalText + " " + interim).trim();
    const ctxText = fileCtxs
      .filter((c) => c.text)
      .map((c) => `\n\n[ANEXO ${c.fileName}]\n${c.text}`)
      .join("");
    const full = (spoken + ctxText).trim();
    if (full) setParsed(parseCommand(full));
    else setParsed(null);
  }, [finalText, interim, fileCtxs]);





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
    const pendingInterim = interim.trim();
    if (pendingInterim) setFinalText((prev) => (prev ? `${prev} ${pendingInterim}` : pendingInterim).trim());
    stopListening();
    // Se o admin já pré-selecionou cliente+tipo e tem anexo/comando, força
    // um intent "create_project" sintético — não trava por falta de gatilho verbal.
    let effective = parsed;
    if ((!effective || effective.kind === "unknown") && answers.client_id && answers.project_type) {
      effective = {
        kind: "create_project",
        name: (finalText + " " + interim).trim() || "Novo projeto",
        type: answers.project_type,
        deadlineDays: answers.deadline ?? suggestDeadline(answers.project_type),
        clientHint: undefined,
      } as any;
      setParsed(effective);
    }
    if (!effective || effective.kind === "unknown") return;
    // Pre-fill answers from parsed intent — mantendo o que o admin já escolheu.
    const init: Record<string, any> = { ...answers };
    if (effective.kind === "create_project") {
      init.project_type = init.project_type || effective.type || "other";
      init.deadline = init.deadline ?? effective.deadlineDays ?? suggestDeadline(init.project_type);
      init.project_name = init.project_name || suggestProjectName({
        type: init.project_type,
        clientName: resolvedClient?.company_name || resolvedClient?.full_name,
        rawHint: effective.name,
      });
      if (init.apply_template === undefined) init.apply_template = true;
      if (!init.client_id && resolvedClient) init.client_id = resolvedClient.id;
    }
    if (effective.kind === "create_task") {
      init.task_title = init.task_title || effective.title;
      if (!init.client_id && resolvedClient) init.client_id = resolvedClient.id;
    }
    if (effective.kind === "create_milestone") {
      init.milestone_title = init.milestone_title || effective.title;
      if (!init.client_id && resolvedClient) init.client_id = resolvedClient.id;
    }
    setAnswers(init);
    // Só pula clarify pra intents NÃO-criativas (update/report/upload).
    // Pra create_project/task/milestone SEMPRE vai pro clarify → preview → confirm,
    // mesmo sem gaps, senão directExecute() não tem case e dispara reset() apagando tudo.
    const kind = effective.kind;
    if (kind !== "create_project" && kind !== "create_task" && kind !== "create_milestone") {
      directExecute();
      return;
    }
    setPhase("clarify");
  };

  // ------------ Execute ------------

  // 🔒 Guardrails do agente: financeiro, cofre e exclusão de cliente são
  // jurisdições proibidas — mesmo que a IA tente roteá-las, bloqueamos aqui.
  const FORBIDDEN_KEYWORDS = /\b(financeiro|faturamento|mensalidade|parcela|recebível|reembolso|ads ?wallet|recarga|pagamento|cofre|senha|credencial|excluir cliente|deletar cliente|apagar cliente|remover cliente)\b/i;
  const isForbiddenRequest = (text: string): string | null => {
    if (FORBIDDEN_KEYWORDS.test(text)) {
      if (/\b(financeiro|faturamento|mensalidade|parcela|recebível|reembolso|ads ?wallet|recarga|pagamento)\b/i.test(text))
        return "Financeiro está fora da jurisdição do agente.";
      if (/\b(cofre|senha|credencial)\b/i.test(text))
        return "Cofre de senhas é área protegida — o agente não acessa.";
      if (/cliente\b/i.test(text))
        return "Excluir cliente requer ação manual do admin.";
    }
    return null;
  };

  const directExecute = async () => {
    if (!parsed || parsed.kind === "unknown" || !user) return;
    const blocked = isForbiddenRequest((finalText + " " + interim).trim());
    if (blocked) {
      appendLog({ kind: "error", text: `🔒 Bloqueado: ${blocked}` });
      toast({ title: "Ação não permitida", description: blocked, variant: "destructive" });
      return;
    }
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

  // ---------------- Execução unificada (uma confirmação só) ----------------
  // Antes éramos 4 fases (project → milestones → tasks → checklists). Agora,
  // após o usuário revisar o escopo no preview e bater "Confirmar", criamos
  // tudo em sequência atomicamente. O cabeçalho mostra o projeto montado.
  const stages = useMemo(() => {
    if (parsed?.kind === "create_project") {
      const tpl = aiPlan?.milestones?.length
        ? aiPlan.milestones
        : (projectTemplates[answers.project_type] || []);
      const taskCount = tpl.reduce((s: number, m: any) => s + (m.tasks?.length || 0), 0);
      const source = aiPlan?.milestones?.length ? " (do contrato)" : "";
      const desc = answers.apply_template
        ? `Projeto + ${tpl.length} milestones${source} + ${taskCount} tarefas + checklists, tudo encadeado.`
        : "Apenas o registro do projeto (sem template).";
      return [{ key: "project_full", label: "Criar projeto completo", description: desc }];
    }
    if (parsed?.kind === "create_task") return [{ key: "single", label: "Criar tarefa", description: `"${answers.task_title || ""}"` }];
    if (parsed?.kind === "create_milestone") return [{ key: "single", label: "Criar etapa", description: `"${answers.milestone_title || ""}"` }];
    return [];
  }, [parsed, answers, aiPlan]);

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
    const blocked = isForbiddenRequest((finalText + " " + interim).trim());
    if (blocked) {
      appendLog({ kind: "error", text: `🔒 Bloqueado: ${blocked}` });
      toast({ title: "Ação não permitida", description: blocked, variant: "destructive" });
      return;
    }
    setExecuting(true);
    const refs: CreatedRefs = {
      projectIds: [...stageRefs.projectIds],
      milestoneIds: [...stageRefs.milestoneIds],
      taskIds: [...stageRefs.taskIds],
      checklistItemIds: [...stageRefs.checklistItemIds],
      fileIds: [...stageRefs.fileIds],
    };
    try {
      if (stage.key === "project_full") {
        const client = clientList.find((c) => c.id === answers.client_id) || resolvedClient;
        if (!client) throw new Error("Cliente não selecionado");
        const project = await stageCreateProject(client, refs);
        setStageContext((c) => ({ ...c, client, project }));
        if (answers.apply_template) {
          const ms = await stageCreateMilestones(project, refs);
          const ts = await stageCreateTasks(project, ms, refs);
          const chk = await fetchChkTemplates();
          await stageCreateChecklists(ts, chk, refs);
          setStageContext((c) => ({ ...c, milestones: ms, tasks: ts, chkTemplates: chk }));
        }
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
    const startKey = addDaysBR(0);
    const endKey = addDaysBR(answers.deadline || 30, startKey);
    const clientFields = buildClientProjectFields({
      type: answers.project_type,
      clientName: client.company_name || client.full_name,
      narrative: aiNarrative,
      plan: aiPlan,
    });
    const payload = {
      name: answers.project_name,
      project_type: answers.project_type,
      description: clientFields.description,
      scope: clientFields.scope,
      objectives: clientFields.objectives,
      deadline: endKey,
    };
    if (answers.project_id && answers.project_id !== "new") {
      const { data: project, error } = await supabase.from("projects").update(payload).eq("id", answers.project_id).select().single();
      if (error) throw error;
      return { ...project, __isUpdate: true };
    }
    const { data: project, error } = await supabase.from("projects").insert({
      client_id: client.id,
      ...payload,
      status: "planning",
      progress: 0,
      start_date: startKey,
      created_by: user!.id,
    }).select().single();
    if (error) throw error;
    refs.projectIds.push(project.id);
    return project;
  }

  async function stageCreateMilestones(project: any, refs: CreatedRefs) {
    const template: any[] = aiPlan?.milestones?.length
      ? aiPlan.milestones
      : (projectTemplates[answers.project_type] || projectTemplates.other);
    if (!template) return [];
    const out: Array<{ milestone: any; tm: any }> = [];
    for (const tm of template) {
      const { data: milestone, error } = await supabase.from("milestones").insert({
        project_id: project.id,
        title: tm.title,
        target_date: addDaysBR(tm.offsetDays || 0, project.start_date),
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
      for (const t of tm.tasks) {
        const taskDescription = [
          t.description ? `Escopo: ${t.description}` : null,
          `Critério de aceite: entrega validada e aprovada.`,
        ].filter(Boolean).join("\n\n");
        const { data: task, error } = await supabase.from("tasks").insert({
          project_id: project.id,
          milestone_id: milestone?.id,
          title: t.title,
          description: taskDescription,
          priority: t.priority,
          status: "backlog",
          due_date: milestone.target_date,
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
    const { data, error } = await supabase.from("tasks").insert({
      project_id: project.id,
      title: a.task_title || p.title,
      status: p.status || "backlog",
      priority: p.priority || "medium",
      due_date: addDaysBR(7),
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
    const { data, error } = await supabase.from("milestones").insert({
      project_id: project.id,
      title: a.milestone_title || p.title,
      target_date: addDaysBR(p.days || 14),
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
    const f = files[0];
    if (!f) throw new Error("Anexe um arquivo (clipe ao lado do mic)");
    const client = p.clientHint ? bestMatch(clientList, p.clientHint, [(c: any) => c.company_name, (c: any) => c.full_name]) : null;
    if (!client) throw new Error("Cliente não identificado");
    const path = `${client.id}/${Date.now()}-${f.name}`;
    const { error: upErr } = await supabase.storage.from("files").upload(path, f);
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("files").getPublicUrl(path);
    const { error } = await supabase.from("files").insert({
      client_id: client.id, file_name: f.name, file_url: pub.publicUrl,
      file_type: f.type, folder: p.folder || "operacionais", uploaded_by: user!.id,
    } as any);
    if (error) throw error;
    appendLog({ kind: "ok", text: `Arquivo "${f.name}" enviado` });
  }

  if (!isAdmin) return null;

  const scopePreview = phase === "preview" && parsed?.kind === "create_project"
    ? formatScopePreview(answers, resolvedClient?.company_name || resolvedClient?.full_name, {
        narrative: aiNarrative,
        contractName: primaryCtxName,
        plan: aiPlan,
        rawHint: (finalText + " " + interim).trim(),
      })
    : null;

  const filteredClients = clientSearch
    ? clientList.filter((c) =>
        norm(`${c.company_name} ${c.full_name} ${c.email}`).includes(norm(clientSearch)),
      ).slice(0, 6)
    : clientList.slice(0, 6);

  const selectedExistingProject = clientProjects.find((p) => p.id === answers.project_id);

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
            className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <motion.div
              className={`relative w-full md:w-[460px] md:rounded-2xl rounded-t-2xl bg-card border max-h-[92vh] flex flex-col shadow-2xl transition-colors ${
                dragOver ? "border-primary ring-2 ring-primary/40" : "border-border"
              }`}
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
              onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = Array.from(e.dataTransfer.files || []);
                if (dropped.length) handleAttach(dropped);
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Aceleriq OS · Agente</p>
                    <p className="text-[11px] text-muted-foreground">
                      {phase === "input" && (aiThinking ? "Analisando contrato…" : "Voz + IA · arraste contratos aqui")}
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
                    {/* 🎯 Pré-seleção rápida: cliente + tipo ANTES de falar.
                       Reduz ambiguidade e o agente já chega no problema certo. */}
                    <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Pré-contexto (opcional, mas recomendado)
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-muted-foreground">
                            Cliente {answers.client_id ? `· ✓ ${clientList.find((c) => c.id === answers.client_id)?.company_name || clientList.find((c) => c.id === answers.client_id)?.full_name}` : `(${clientList.length} disponíveis)`}
                          </p>
                          {answers.client_id && (
                            <button
                              onClick={() => setAnswers((a) => { const { client_id, ...rest } = a; return rest; })}
                              className="text-[10px] text-muted-foreground hover:text-destructive"
                            >
                              trocar
                            </button>
                          )}
                        </div>
                        {clientList.length > 6 && (
                          <input
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            placeholder="Filtrar…"
                            className="w-full text-xs bg-background border border-border rounded p-1.5"
                          />
                        )}
                        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
                          {(clientSearch
                            ? clientList.filter((c) => norm(`${c.company_name} ${c.full_name} ${c.email}`).includes(norm(clientSearch)))
                            : clientList
                          ).map((c) => (
                            <button
                              key={c.id}
                              onClick={() => {
                                setAnswers((a) => ({ ...a, client_id: c.id }));
                                aiAttemptedRef.current = false;
                                setClientSearch("");
                              }}
                              className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                                answers.client_id === c.id
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                              }`}
                            >
                              {c.company_name || c.full_name}
                            </button>
                          ))}
                          {clientList.length === 0 && (
                            <p className="text-[10px] text-muted-foreground">Nenhum cliente cadastrado.</p>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground">Tipo de serviço</p>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { v: "trafego", l: "Tráfego" },
                            { v: "social_media", l: "Social Media" },
                            { v: "video_ai", l: "Vídeo IA" },
                            { v: "video", l: "Vídeo (captação)" },
                            { v: "site", l: "Site" },
                            { v: "landing_page", l: "Landing" },
                            { v: "automation", l: "Automação" },
                            { v: "event", l: "Evento" },
                          ].map((o) => (
                            <button
                              key={o.v}
                              onClick={() => setAnswers((a) => ({
                                ...a,
                                project_type: o.v,
                                deadline: a.deadline ?? suggestDeadline(o.v),
                              }))}
                              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                answers.project_type === o.v
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-border text-muted-foreground hover:border-primary"
                              }`}
                            >
                              {o.l}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

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
                      onChange={(e) => handleTextEdit(e.target.value)}
                      placeholder="Ou escreva o comando aqui..."
                      className="w-full text-sm bg-background border border-border rounded-lg p-2 min-h-[60px] focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => { aiAttemptedRef.current = true; runAgent(); }}
                        disabled={aiThinking || (!finalText.trim() && !hasAnyAttachment)}
                        className="flex-1 h-9 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs font-medium flex items-center justify-center gap-2 hover:bg-primary/25 disabled:opacity-50 transition-colors"
                      >
                        {aiThinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                        {aiThinking ? "Analisando…" : aiPlan ? "Reanalisar com IA" : "Pensar com IA (lê contratos)"}
                      </button>
                      {aiConfidence !== null && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                          {Math.round(aiConfidence * 100)}% conf.
                        </span>
                      )}
                    </div>
                    {aiNarrative && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-primary" />
                          <p className="text-[10px] uppercase tracking-wider text-primary">Plano de ação do agente</p>
                        </div>
                        <p className="text-xs text-foreground leading-relaxed">{aiNarrative}</p>
                        {aiPlan?.milestones?.length ? (
                          <details className="text-[11px] text-muted-foreground">
                            <summary className="cursor-pointer hover:text-foreground">
                              Ver {aiPlan.milestones.length} etapas / {aiPlan.milestones.reduce((s, m) => s + (m.tasks?.length || 0), 0)} tarefas
                            </summary>
                            <ul className="mt-2 space-y-1.5 pl-3 border-l border-border">
                              {aiPlan.milestones.map((m, i) => (
                                <li key={i}>
                                  <p className="text-foreground font-medium">{m.title} <span className="text-muted-foreground font-normal">· +{m.offsetDays}d</span></p>
                                  <ul className="pl-3 list-disc list-outside">
                                    {(m.tasks || []).map((t, j) => (
                                      <li key={j}>{t.title} <span className="text-[9px] uppercase">[{t.role}]</span></li>
                                    ))}
                                  </ul>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    )}
                    {learnedCount > 0 && (
                      <div className="flex items-center gap-2 text-[11px] text-primary">
                        <Brain className="w-3.5 h-3.5" />
                        Memorizei {learnedCount} correção(ões). Não vou repetir o erro.
                      </div>
                    )}
                    {parsed && (() => {
                      const meaningful = (finalText + interim).trim().split(/\s+/).filter(Boolean).length >= 3;
                      const isUnknown = parsed.kind === "unknown";
                      if (isUnknown && (!meaningful || listening)) {
                        return (
                          <div className="rounded-xl p-3 border border-border bg-secondary/30">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Ouvindo…</p>
                            <p className="text-xs text-muted-foreground">
                              Continue falando. Ex.: "Criar projeto de tráfego para Mirante, 30 dias" ou "Mover tarefa X para concluído".
                            </p>
                          </div>
                        );
                      }
                      const spokenText = (finalText + " " + interim).trim();
                      const proactiveMatches = isUnknown
                        ? findClientsMentioned(clientList, spokenText, [
                            (c: any) => c.company_name,
                            (c: any) => c.full_name,
                          ])
                        : [];
                      const guessIntent = /projeto/i.test(spokenText)
                        ? "Criar projeto"
                        : /tarefa/i.test(spokenText)
                          ? "Criar tarefa"
                          : /v[ií]deo|reels/i.test(spokenText)
                            ? "Criar projeto (vídeo)"
                            : null;
                      return (
                        <div className={`rounded-xl p-3 border ${isUnknown ? "border-amber-500/40 bg-amber-500/5" : "border-primary/40 bg-primary/5"}`}>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            {isUnknown ? "Posso confirmar antes de fazer?" : "Interpretação"}
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {isUnknown
                              ? guessIntent
                                ? `Achei que você quer: ${guessIntent}. Confirme o cliente:`
                                : "Não consegui identificar a ação. Tente: criar projeto / criar tarefa / mover tarefa / relatório."
                              : summarizeIntent(parsed)}
                          </p>
                          {isUnknown && proactiveMatches.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Encontrei na sua base
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {proactiveMatches.map((c: any) => {
                                  const label = c.company_name || c.full_name || c.email;
                                  return (
                                    <button
                                      key={c.id}
                                      onClick={() => {
                                        const verb = guessIntent?.includes("tarefa") ? "Criar tarefa para" : "Criar projeto para";
                                        const rewritten = `${verb} ${label}${spokenText ? ` — ${spokenText}` : ""}`;
                                        handleTextEdit(rewritten);
                                      }}
                                      className="text-[11px] px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Toque para confirmar e eu sigo daqui.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {(files.length > 0 || fileReading || systemDocsLoading || systemDocs.length > 0) && (
                      <div className="space-y-1.5">
                        {systemDocsLoading && (
                          <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 text-xs flex items-center gap-2 text-primary">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span>Lendo documentos do cliente…</span>
                          </div>
                        )}
                        {systemDocs.map((d, i) => (
                          <div key={`sys-${i}`} className="rounded-xl border border-primary/25 bg-primary/5 p-2.5 text-xs">
                            <div className="flex items-center gap-2 text-foreground">
                              <FileText className="w-3.5 h-3.5 shrink-0 text-primary" />
                              <span className="truncate flex-1">📚 {d.fileName}</span>
                              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{d.source}</span>
                            </div>
                          </div>
                        ))}
                        {fileReading && (
                          <div className="rounded-xl border border-border bg-secondary/40 p-2.5 text-xs flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span>Lendo anexos…</span>
                          </div>
                        )}
                        {fileCtxs.map((ctx, i) => (
                          <div key={`att-${i}`} className="rounded-xl border border-border bg-secondary/40 p-2.5 text-xs">
                            <div className="flex items-center gap-2 text-foreground">
                              <FileText className="w-3.5 h-3.5 shrink-0 text-primary" />
                              <span className="truncate flex-1">{describeContext(ctx)}</span>
                              <button onClick={() => removeAttachment(i)} className="text-destructive">remover</button>
                            </div>
                            {ctx.text && (
                              <p className="mt-1.5 text-[10px] text-muted-foreground line-clamp-2 italic">
                                "{ctx.text.slice(0, 200).replace(/\s+/g, " ")}…"
                              </p>
                            )}
                            {ctx.warning && (
                              <p className="mt-1.5 text-[10px] text-amber-500">{ctx.warning}</p>
                            )}
                          </div>
                        ))}
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
                        const nameSuggestions = suggestProjectNames({
                          type: answers.project_type || (parsed as any).type,
                          clientName: resolvedClient?.company_name || resolvedClient?.full_name,
                          rawHint: (parsed as any).name,
                        });
                        return (
                          <div key="pname" className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1">
                              <Edit3 className="w-3 h-3" /> Nome do projeto
                            </p>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {nameSuggestions.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => setAnswers((a) => ({ ...a, project_name: s }))}
                                  className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                                    answers.project_name === s
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "border-border text-muted-foreground hover:border-primary"
                                  }`}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                            <input
                              value={answers.project_name || ""}
                              onChange={(e) => setAnswers((a) => ({ ...a, project_name: e.target.value }))}
                              placeholder="Ou digite um nome personalizado"
                              className="w-full text-sm bg-background border border-border rounded p-2"
                            />
                          </div>
                        );
                      }
                      if (g.id === "apply_template" && parsed.kind === "create_project") {
                        return null;
                      }
                      return null;
                    })}
                    {parsed.kind === "create_project" && answers.client_id && (
                      <div className="rounded-xl border border-border bg-secondary/40 p-3">
                        <p className="text-xs font-medium text-foreground mb-2">Projeto do cliente</p>
                        {clientProjectsLoading ? (
                          <p className="text-[11px] text-muted-foreground">Carregando projetos…</p>
                        ) : (
                          <div className="space-y-1.5">
                            {clientProjects.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => setAnswers((a) => ({ ...a, project_id: p.id, project_name: p.name, project_type: p.project_type || a.project_type }))}
                                className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition ${answers.project_id === p.id ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
                              >
                                <span className="font-medium">Atualizar existente:</span> {p.name}
                              </button>
                            ))}
                            <button
                              onClick={() => setAnswers((a) => ({ ...a, project_id: "new" }))}
                              className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition ${answers.project_id === "new" ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
                            >
                              <span className="font-medium">Criar novo projeto</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {gaps.map((g) => {
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
                      <p className="text-[10px] uppercase tracking-wider text-primary">{selectedExistingProject ? "Atualização do projeto" : "Escopo do projeto"}</p>
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
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Ação:</span>{" "}
                          <span className="text-foreground font-medium">{selectedExistingProject ? "enriquecer projeto existente" : "criar novo projeto"}</span>
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

                    {(() => {
                      const ms: any[] = (aiPlan?.milestones?.length ? aiPlan.milestones : (projectTemplate || [])) as any[];
                      const total = ms.reduce((s, m) => s + (m.tasks?.length || 0), 0);
                      if (!answers.apply_template || !ms.length) return null;
                      return (
                        <div className="rounded-xl border border-border bg-secondary/40 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                            Vai criar · {ms.length} milestones · {total} tarefas · checklists
                            {aiPlan?.milestones?.length ? <span className="text-primary"> · derivado do contrato</span> : null}
                          </p>
                          <ul className="space-y-1.5">
                            {ms.map((m: any) => (
                              <li key={m.title} className="text-xs">
                                <p className="font-medium text-foreground">▸ {m.title}{m.offsetDays != null ? <span className="text-muted-foreground font-normal"> · +{m.offsetDays}d</span> : null}</p>
                                <ul className="ml-4 mt-0.5 space-y-0.5 text-muted-foreground">
                                  {(m.tasks || []).slice(0, 5).map((t: any) => (
                                    <li key={t.title} className="text-[11px]">· {t.title}</li>
                                  ))}
                                  {(m.tasks?.length || 0) > 5 && <li className="text-[10px] italic">+ {m.tasks.length - 5} tarefas</li>}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}

                    {/* 🎙️ Ajustar o escopo com voz — re-roda a IA com instrução extra. */}
                    <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Não ficou bom? Ajuste com voz ou texto
                      </p>
                      <textarea
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        placeholder='Ex.: "São 12 vídeos de 30 a 40 segundos, vídeo com IA, sem captação"'
                        className="w-full text-xs bg-background border border-border rounded p-2 min-h-[50px]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => listening ? stopListening() : startListening("refine")}
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${listening ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-secondary text-foreground"}`}
                          title={listening ? "Parar mic" : "Falar ajuste"}
                        >
                          {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={async () => {
                            const extra = (refineText + " " + refineInterim).trim();
                            if (!extra) return;
                            // Junta o ajuste ao comando e roda IA de novo.
                            stopListening();
                            const nextText = finalText ? `${finalText}\n\n[AJUSTE]: ${extra}` : `[AJUSTE]: ${extra}`;
                            setFinalText(nextText);
                            setRefineText("");
                            setRefineInterim("");
                            aiAttemptedRef.current = true;
                            await runAgent({ textOverride: nextText });
                          }}
                          disabled={aiThinking || (!refineText.trim() && !refineInterim.trim())}
                          className="flex-1 h-8 rounded-full bg-primary/15 border border-primary/30 text-primary text-[11px] font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                          {aiThinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                          Reanalisar com ajuste
                        </button>
                      </div>
                      {refineInterim && (
                        <p className="text-[10px] italic text-muted-foreground">"{refineInterim}"</p>
                      )}
                    </div>
                  </div>
                )}

                {/* ---------- CONFIRM PHASE (unified single confirmation) ---------- */}
                {phase === "confirm" && parsed && (
                  <div className="space-y-3">
                    {parsed.kind === "create_project" && (
                      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-2 sticky top-0">
                        <p className="text-[10px] uppercase tracking-wider text-primary">Vai criar</p>
                        <h3 className="text-base font-semibold text-foreground leading-tight">
                          {answers.project_name}
                        </h3>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                          <div><span className="text-muted-foreground">Cliente:</span> <span className="text-foreground font-medium">{resolvedClient?.company_name || resolvedClient?.full_name}</span></div>
                          <div><span className="text-muted-foreground">Tipo:</span> <span className="text-foreground font-medium">{answers.project_type}</span></div>
                          <div><span className="text-muted-foreground">Prazo:</span> <span className="text-foreground font-mono">{answers.deadline}d</span></div>
                          <div><span className="text-muted-foreground">Estrutura:</span> <span className="text-foreground font-mono">{(aiPlan?.milestones?.length || projectTemplate?.length || 0)}m · {previewTaskCount}t</span></div>
                        </div>
                      </div>
                    )}
                    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-foreground">Confirmação final</p>
                          <p className="text-[11px] text-muted-foreground">
                            Tudo será criado em sequência — projeto, milestones, tarefas e checklists. Reversível pelo "Desfazer".
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
                                <span>Confirmo criar tudo agora.</span>
                              </label>
                              <button
                                onClick={() => runStage(i)}
                                disabled={!stageAck || executing}
                                className="w-full h-9 rounded-full bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                              >
                                {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Criar agora
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {stageIdx >= stages.length && stages.length > 0 && (
                      <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                          Criado com sucesso
                        </div>
                        {parsed.kind === "create_project" && (
                          <div className="text-[11px] text-muted-foreground space-y-0.5 pl-6">
                            <p>📁 <span className="text-foreground font-medium">{answers.project_name}</span></p>
                            <p>👤 {resolvedClient?.company_name || resolvedClient?.full_name}</p>
                            <p>📊 {stageRefs.milestoneIds.length} milestones · {stageRefs.taskIds.length} tarefas · {stageRefs.checklistItemIds.length} itens de checklist</p>
                            <p className="text-primary pt-1">→ Já disponível no Kanban e no drawer do projeto.</p>
                          </div>
                        )}
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
                      onClick={() => listening ? stopListening() : startListening("command")}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition ${listening ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-primary text-primary-foreground"}`}
                    >
                      {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <label className="w-10 h-10 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center cursor-pointer">
                      <Paperclip className="w-4 h-4" />
                      <input type="file" multiple className="hidden" onChange={(e) => { const arr = Array.from(e.target.files || []); if (arr.length) handleAttach(arr); e.target.value = ""; }} accept=".txt,.md,.csv,.tsv,.json,.yaml,.yml,.log,.xml,.html,.pdf,image/*" />
                    </label>
                    <button
                      onClick={advanceFromInput}
                      disabled={executing || (!parsed || parsed.kind === "unknown") && !(answers.client_id && answers.project_type)}
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
                      disabled={parsed?.kind === "create_project" && (!answers.client_id || !answers.project_id)}
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
                      onClick={returnToDraft}
                      className="px-3 h-10 rounded-full bg-secondary text-foreground text-sm disabled:opacity-40"
                      disabled={executing || stageIdx > 0}
                    >
                      Voltar
                    </button>
                    <button
                      onClick={stageIdx >= stages.length && stages.length > 0 ? finishFlow : returnToDraft}
                      disabled={executing}
                      className="flex-1 h-10 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {stageIdx >= stages.length && stages.length > 0 ? "Concluir" : "Manter rascunho"}
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

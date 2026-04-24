import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "framer-motion";
import {
  Eye, CheckCircle2, Copy, Loader2, Search, Filter,
  Mail, Phone, Building2, Sparkles, ArrowDownToLine,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ----------------- Types & helpers -----------------

type Submission = {
  id: string;
  token: string;
  status: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_whatsapp: string | null;
  lead_company: string | null;
  positioning: string | null;
  differential: string | null;
  icp: string | null;
  main_pains: string | null;
  goals_12m: string | null;
  success_metric: string | null;
  revenue_range: string | null;
  team_size: string | null;
  maturity_digital: string | null;
  ai_readiness: string | null;
  recommended_plan: string | null;
  icp_fit_score: number | null;
  origin: string | null;
  submitted_at: string | null;
  created_at: string | null;
};

const PLAN_LABELS: Record<string, string> = {
  starter: "Fundação",
  growth: "Aceleração",
  enterprise: "Escala IA-First",
};

function scoreTone(score: number | null) {
  if (score == null) return { label: "—", className: "bg-secondary text-muted-foreground border-border" };
  if (score >= 80) return { label: `${score}`, className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  if (score >= 60) return { label: `${score}`, className: "bg-sky-500/15 text-sky-400 border-sky-500/30" };
  if (score >= 40) return { label: `${score}`, className: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
  return { label: `${score}`, className: "bg-red-500/15 text-red-400 border-red-500/30" };
}

function statusTone(status: string | null) {
  if (status === "processed") return { label: "Processado", className: "bg-primary/15 text-primary border-primary/30" };
  return { label: "Novo", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
}

// ----------------- Page -----------------

export default function AdminQuizSubmissions() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "processed">("all");
  const [scoreFilter, setScoreFilter] = useState<"all" | "80" | "60" | "40">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
  const [openSubmission, setOpenSubmission] = useState<Submission | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);


  const { data: submissions, isLoading } = useQuery({
    queryKey: ["quiz-submissions-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_submissions")
        .select("*")
        .in("status", ["submitted", "processed"])
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Submission[];
    },
    refetchInterval: 60_000,
  });

  // ---- Filtering ----
  const filtered = useMemo(() => {
    if (!submissions) return [];
    const now = Date.now();
    return submissions.filter((s) => {
      if (statusFilter !== "all" && (s.status ?? "submitted") !== statusFilter) return false;

      if (scoreFilter !== "all") {
        const min = parseInt(scoreFilter, 10);
        if ((s.icp_fit_score ?? -1) < min) return false;
      }

      if (dateFilter !== "all" && s.submitted_at) {
        const days = dateFilter === "7d" ? 7 : dateFilter === "30d" ? 30 : 90;
        const diff = (now - new Date(s.submitted_at).getTime()) / (1000 * 60 * 60 * 24);
        if (diff > days) return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [s.lead_name, s.lead_email, s.lead_company, s.lead_whatsapp]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [submissions, statusFilter, scoreFilter, dateFilter, search]);

  // ---- Stats ----
  const stats = useMemo(() => {
    const list = submissions ?? [];
    const high = list.filter(s => (s.icp_fit_score ?? 0) >= 80).length;
    const pending = list.filter(s => (s.status ?? "submitted") !== "processed").length;
    const avg = list.length
      ? Math.round(list.reduce((acc, s) => acc + (s.icp_fit_score ?? 0), 0) / list.length)
      : 0;
    return { total: list.length, high, pending, avg };
  }, [submissions]);

  // ---- Actions ----
  const markProcessed = async (s: Submission) => {
    setUpdatingId(s.id);
    const { error } = await supabase
      .from("quiz_submissions")
      .update({ status: "processed" })
      .eq("id", s.id);
    setUpdatingId(null);
    if (error) {
      toast.error("Não foi possível atualizar o status.");
      return;
    }
    toast.success("Marcado como processado.");
    queryClient.invalidateQueries({ queryKey: ["quiz-submissions-admin"] });
  };

  const copyOpsPayload = async (s: Submission) => {
    const payload = {
      source: "aceleriq.online",
      submission_id: s.id,
      submitted_at: s.submitted_at,
      icp_fit_score: s.icp_fit_score,
      recommended_plan: s.recommended_plan,
      lead: {
        name: s.lead_name,
        email: s.lead_email,
        whatsapp: s.lead_whatsapp,
        company: s.lead_company,
      },
      answers: {
        positioning: s.positioning,
        differential: s.differential,
        icp: s.icp,
        main_pains: s.main_pains,
        goals_12m: s.goals_12m,
        success_metric: s.success_metric,
        revenue_range: s.revenue_range,
        team_size: s.team_size,
        maturity_digital: s.maturity_digital,
        ai_readiness: s.ai_readiness,
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success("JSON copiado para o clipboard.");
    } catch {
      toast.error("Falha ao copiar.");
    }
  };

  // ----------------- Render -----------------

  // Guard: only admin
  if (profile && profile.role !== "admin") {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <h1 className="text-2xl font-semibold mb-2">Acesso restrito</h1>
        <p className="text-muted-foreground">Esta página está disponível apenas para administradores.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-primary mb-2">
            <Sparkles className="h-3.5 w-3.5" /> Quiz Aceleriq
          </span>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Diagnósticos recebidos</h1>
          <p className="text-muted-foreground mt-1">
            Leads que completaram o quiz público em <span className="text-foreground">aceleriq.online/quiz</span>.
          </p>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Não processados" value={stats.pending} accent="warning" />
        <StatCard label="ICP ≥ 80" value={stats.high} accent="primary" />
        <StatCard label="Score médio" value={stats.avg} mono />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail, empresa ou WhatsApp"
            className="pl-9 h-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="h-10 w-[160px]">
              <Filter className="h-3.5 w-3.5 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="submitted">Apenas novos</SelectItem>
              <SelectItem value="processed">Apenas processados</SelectItem>
            </SelectContent>
          </Select>

          <Select value={scoreFilter} onValueChange={(v: any) => setScoreFilter(v)}>
            <SelectTrigger className="h-10 w-[150px]">
              <SelectValue placeholder="Score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer score</SelectItem>
              <SelectItem value="80">Score ≥ 80</SelectItem>
              <SelectItem value="60">Score ≥ 60</SelectItem>
              <SelectItem value="40">Score ≥ 40</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
            <SelectTrigger className="h-10 w-[150px]">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer data</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-24">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Carregando submissões…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">Nenhuma submissão com os filtros aplicados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/60">
                  <TableHead className="w-[28%]">Lead</TableHead>
                  <TableHead className="w-[100px] text-center">Score</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Submissão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-4">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s, idx) => {
                  const score = scoreTone(s.icp_fit_score);
                  const status = statusTone(s.status);
                  const planLabel = s.recommended_plan
                    ? (PLAN_LABELS[s.recommended_plan] ?? s.recommended_plan)
                    : "—";
                  return (
                    <motion.tr
                      key={s.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02, duration: 0.25 }}
                      className="border-border/60 hover:bg-secondary/40"
                    >
                      <TableCell className="py-4">
                        <div className="font-medium text-foreground">
                          {s.lead_name || "Sem nome"}
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {s.lead_company && (
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="h-3 w-3" /> {s.lead_company}
                            </span>
                          )}
                          {s.lead_email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3 w-3" /> {s.lead_email}
                            </span>
                          )}
                          {s.lead_whatsapp && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {s.lead_whatsapp}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-center">
                        <Badge variant="outline" className={`font-mono px-2.5 py-1 ${score.className}`}>
                          {score.label}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <span className="text-sm">{planLabel}</span>
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {s.submitted_at
                          ? format(new Date(s.submitted_at), "dd MMM yyyy · HH:mm", { locale: ptBR })
                          : "—"}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={status.className}>
                          {status.label}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right pr-4">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-8 w-8 p-0"
                            title="Ver respostas completas"
                            onClick={() => setOpenSubmission(s)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-8 w-8 p-0"
                            title="Copiar JSON para o Ops"
                            onClick={() => copyOpsPayload(s)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-8 w-8 p-0"
                            title="Marcar como processado"
                            disabled={s.status === "processed" || updatingId === s.id}
                            onClick={() => markProcessed(s)}
                          >
                            {updatingId === s.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <CheckCircle2 className={`h-4 w-4 ${s.status === "processed" ? "text-primary" : ""}`} />}
                          </Button>
                        </div>
                      </TableCell>
                    </motion.tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Drawer */}
      <SubmissionDrawer
        submission={openSubmission}
        onClose={() => setOpenSubmission(null)}
        onCopyOps={copyOpsPayload}
        onMarkProcessed={markProcessed}
        updating={updatingId === openSubmission?.id}
      />
    </div>
  );
}

// ----------------- Stat card -----------------

function StatCard({
  label, value, mono, accent,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
  accent?: "primary" | "warning";
}) {
  const accentClass =
    accent === "primary" ? "text-primary"
    : accent === "warning" ? "text-amber-400"
    : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-4">
      <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${mono ? "font-mono" : ""} ${accentClass}`}>{value}</div>
    </div>
  );
}

// ----------------- Drawer with full answers -----------------

function SubmissionDrawer({
  submission, onClose, onCopyOps, onMarkProcessed, updating,
}: {
  submission: Submission | null;
  onClose: () => void;
  onCopyOps: (s: Submission) => void;
  onMarkProcessed: (s: Submission) => void;
  updating: boolean;
}) {
  if (!submission) return null;
  const s = submission;
  const score = scoreTone(s.icp_fit_score);
  const planLabel = s.recommended_plan ? (PLAN_LABELS[s.recommended_plan] ?? s.recommended_plan) : "—";

  const sections: { title: string; items: { label: string; value: string | null }[] }[] = [
    {
      title: "Identidade",
      items: [
        { label: "Posicionamento", value: s.positioning },
        { label: "Diferencial", value: s.differential },
      ],
    },
    {
      title: "Mercado",
      items: [
        { label: "Cliente ideal (ICP)", value: s.icp },
        { label: "Principais dores", value: s.main_pains },
      ],
    },
    {
      title: "Objetivos",
      items: [
        { label: "Objetivo 12 meses", value: s.goals_12m },
        { label: "Métrica de sucesso", value: s.success_metric },
      ],
    },
    {
      title: "Perfil",
      items: [
        { label: "Faturamento", value: s.revenue_range },
        { label: "Tamanho do time", value: s.team_size },
      ],
    },
    {
      title: "Maturidade",
      items: [
        { label: "Maturidade digital", value: s.maturity_digital },
        { label: "Prontidão IA", value: s.ai_readiness },
      ],
    },
  ];

  return (
    <Sheet open={!!submission} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="text-2xl tracking-tight">
            {s.lead_name || "Sem nome"}
          </SheetTitle>
          <SheetDescription>
            {s.lead_company || "—"} · submetido em{" "}
            {s.submitted_at
              ? format(new Date(s.submitted_at), "dd MMM yyyy · HH:mm", { locale: ptBR })
              : "—"}
          </SheetDescription>
        </SheetHeader>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 mt-6">
          <div className="rounded-xl border border-border/60 bg-card/40 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Score</div>
            <div className="mt-1">
              <Badge variant="outline" className={`font-mono px-2 py-0.5 ${score.className}`}>
                {score.label}
              </Badge>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-3 col-span-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Plano</div>
            <div className="mt-1 text-sm font-medium">{planLabel}</div>
          </div>
        </div>

        {/* Contact */}
        <div className="mt-4 rounded-xl border border-border/60 bg-card/40 p-4 text-sm space-y-1.5">
          {s.lead_email && (
            <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {s.lead_email}</div>
          )}
          {s.lead_whatsapp && (
            <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {s.lead_whatsapp}</div>
          )}
          {s.lead_company && (
            <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {s.lead_company}</div>
          )}
        </div>

        {/* Answers */}
        <div className="mt-6 space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-[11px] font-mono uppercase tracking-widest text-primary mb-2">
                {section.title}
              </div>
              <div className="space-y-3">
                {section.items.map((it) => (
                  <div key={it.label} className="rounded-xl border border-border/60 bg-card/30 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                      {it.label}
                    </div>
                    <div className="text-sm whitespace-pre-wrap text-foreground/90">
                      {it.value || <span className="text-muted-foreground">— sem resposta —</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 -mx-6 px-6 pt-4 pb-2 mt-8 bg-background/95 backdrop-blur border-t border-border/60 flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onCopyOps(s)}>
            <ArrowDownToLine className="mr-2 h-4 w-4" /> Copiar JSON pro Ops
          </Button>
          <Button
            className="flex-1"
            disabled={s.status === "processed" || updating}
            onClick={() => onMarkProcessed(s)}
          >
            {updating
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {s.status === "processed" ? "Já processado" : "Marcar como processado"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

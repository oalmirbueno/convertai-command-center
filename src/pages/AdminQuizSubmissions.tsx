import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Eye, CheckCircle2, Copy, Loader2, Search, Filter,
  Mail, Phone, Building2, ArrowDownToLine, Hash, Lock, MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { APP_PUBLIC_URL } from "@/lib/publicUrl";

const APP_PUBLIC_HOST = new URL(APP_PUBLIC_URL).hostname;

// ----------------- Types & helpers -----------------

type Submission = {
  id: string;
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
  updated_at: string | null;
};

const QUIZ_SUBMISSION_FIELDS = [
  "id", "status", "lead_name", "lead_email", "lead_whatsapp", "lead_company",
  "positioning", "differential", "icp", "main_pains", "goals_12m",
  "success_metric", "revenue_range", "team_size", "maturity_digital",
  "ai_readiness", "recommended_plan", "icp_fit_score", "origin",
  "submitted_at", "created_at", "updated_at",
].join(",");

const PLAN_LABELS: Record<string, string> = {
  starter: "Fundação",
  growth: "Aceleração",
  enterprise: "Escala IA-First",
};

const ANSWER_FIELDS: (keyof Submission)[] = [
  "positioning", "differential", "icp", "main_pains",
  "goals_12m", "success_metric", "revenue_range", "team_size",
  "maturity_digital", "ai_readiness",
];

function answeredCount(s: Submission) {
  return ANSWER_FIELDS.reduce((acc, k) => acc + (s[k] ? 1 : 0), 0);
}

function scoreTone(score: number | null) {
  if (score == null) return { label: "-", className: "bg-secondary text-muted-foreground border-border" };
  if (score >= 80) return { label: `${score}`, className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  if (score >= 60) return { label: `${score}`, className: "bg-sky-500/15 text-sky-400 border-sky-500/30" };
  if (score >= 40) return { label: `${score}`, className: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
  return { label: `${score}`, className: "bg-red-500/15 text-red-400 border-red-500/30" };
}

function statusTone(status: string | null) {
  if (status === "processed") return { label: "Processado", className: "bg-primary/15 text-primary border-primary/30" };
  if (status === "submitted") return { label: "Novo", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
  return { label: "Em andamento", className: "bg-muted text-muted-foreground border-border" };
}

// ----------------- Page -----------------

type FiltroDeStatus = "all" | "draft" | "submitted" | "processed";
type FiltroDeScore = "all" | "80" | "60" | "40";
type FiltroDeData = "all" | "7d" | "30d" | "90d";
const umDe = (valores: string[]) => (v: unknown) => typeof v === "string" && valores.indexOf(v) >= 0;

export default function AdminQuizSubmissions() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  // Busca e filtros lembram ao sair e voltar (docs/design/SISTEMA.md, seção 12).
  const [search, setSearch] = useEstadoDaTela<string>("quiz:busca", "", { validar: (v) => typeof v === "string" });
  const [statusFilter, setStatusFilter] = useEstadoDaTela<FiltroDeStatus>("quiz:status", "all", { validar: umDe(["all", "draft", "submitted", "processed"]) });
  const [scoreFilter, setScoreFilter] = useEstadoDaTela<FiltroDeScore>("quiz:score", "all", { validar: umDe(["all", "80", "60", "40"]) });
  const [dateFilter, setDateFilter] = useEstadoDaTela<FiltroDeData>("quiz:periodo", "all", { validar: umDe(["all", "7d", "30d", "90d"]) });
  const [openSubmission, setOpenSubmission] = useState<Submission | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);


  const { data: submissions, isLoading, isError, refetch } = useQuery({
    queryKey: ["quiz-submissions-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quiz_submissions")
        .select(QUIZ_SUBMISSION_FIELDS)
        .in("status", ["draft", "submitted", "processed"])
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Submission[];
    },
    refetchInterval: 60_000,
  });

  // ---- Filtering ----
  const filtered = useMemo(() => {
    if (!submissions) return [];
    const now = Date.now();
    return submissions.filter((s) => {
      const st = s.status ?? "draft";
      if (statusFilter !== "all" && st !== statusFilter) return false;

      if (scoreFilter !== "all") {
        const min = parseInt(scoreFilter, 10);
        if ((s.icp_fit_score ?? -1) < min) return false;
      }

      if (dateFilter !== "all") {
        const ref = s.submitted_at ?? s.updated_at ?? s.created_at;
        if (ref) {
          const days = dateFilter === "7d" ? 7 : dateFilter === "30d" ? 30 : 90;
          const diff = (now - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
          if (diff > days) return false;
        }
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
    const drafts = list.filter(s => (s.status ?? "draft") === "draft").length;
    const submitted = list.filter(s => s.status === "submitted").length;
    const high = list.filter(s => (s.icp_fit_score ?? 0) >= 80).length;
    const submittedList = list.filter(s => s.icp_fit_score != null);
    const avg = submittedList.length
      ? Math.round(submittedList.reduce((acc, s) => acc + (s.icp_fit_score ?? 0), 0) / submittedList.length)
      : 0;
    return { total: list.length, drafts, submitted, high, avg };
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
      source: APP_PUBLIC_HOST,
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
      <EstadoVazio
        icone={<Lock className="h-5 w-5" />}
        titulo="Acesso restrito"
        descricao="Esta página está disponível apenas para administradores."
      />
    );
  }

  const temFiltro = statusFilter !== "all" || scoreFilter !== "all" || dateFilter !== "all" || !!search.trim();
  const limparFiltros = () => { setSearch(""); setStatusFilter("all"); setScoreFilter("all"); setDateFilter("all"); };

  const numeros = [
    { rotulo: "Total", valor: stats.total, cor: "text-foreground" },
    { rotulo: "Em andamento", valor: stats.drafts, cor: "text-muted-foreground" },
    { rotulo: "Novas", valor: stats.submitted, cor: "text-warning" },
    { rotulo: "ICP ≥ 80", valor: stats.high, cor: "text-primary" },
    { rotulo: "Score médio", valor: stats.avg, cor: "text-foreground" },
  ];

  const acoesDaLinha = (s: Submission, isDraft: boolean) => (
    <div className="inline-flex items-center [&>*+*]:ml-0.5">
      <button type="button" className={botao.icone} title="Ver respostas completas" aria-label="Ver respostas completas" onClick={() => setOpenSubmission(s)}>
        <Eye className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={juntar(botao.icone, "disabled:opacity-40")} title="Copiar JSON para o Ops" aria-label="Copiar JSON para o Ops" disabled={isDraft} onClick={() => copyOpsPayload(s)}>
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={juntar(botao.icone, "disabled:opacity-40")}
        title="Marcar como processado"
        aria-label="Marcar como processado"
        disabled={s.status === "processed" || isDraft || updatingId === s.id}
        onClick={() => markProcessed(s)}
      >
        {updatingId === s.id
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <CheckCircle2 className={juntar("h-4 w-4", s.status === "processed" && "text-primary")} aria-hidden="true" />}
      </button>
    </div>
  );

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina
        titulo="Diagnósticos do quiz"
        descricao={submissions ? `${stats.total} ${stats.total === 1 ? "diagnóstico" : "diagnósticos"} · ${APP_PUBLIC_HOST}/quiz` : undefined}
        ajuda={<>Leads que responderam o quiz público em <span className="text-foreground">{APP_PUBLIC_HOST}/quiz</span>. Clique numa linha para ver as respostas.</>}
      />

      {/* Números (grade de um nível) */}
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {numeros.map((n) => (
          <div key={n.rotulo} className={juntar(superficie.painel, "min-w-0 px-4 py-3")}>
            <p className={juntar(texto.rotulo, "truncate")}>{n.rotulo}</p>
            <p className={juntar("mt-1 text-[22px] font-semibold leading-7 tabular-nums", n.cor)}>{submissions ? n.valor : "-"}</p>
          </div>
        ))}
      </div>

      {/* Filtros (lembram ao sair e voltar) */}
      <div className="flex min-w-0 flex-wrap items-center">
        <div className="relative mb-2 mr-2 min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail, empresa ou WhatsApp"
            aria-label="Buscar diagnóstico"
            className={juntar(campo, "pl-8")}
          />
        </div>
        <div className="mb-2 flex min-w-0 flex-wrap items-center [&>*]:mb-0 [&>*+*]:ml-2">
          <SeletorCompacto
            rotulo="Status"
            icone={<Filter className="h-3.5 w-3.5" />}
            modo="lista"
            valor={statusFilter}
            onEscolher={(v) => setStatusFilter(v as FiltroDeStatus)}
            opcoes={[
              { valor: "all", rotulo: "Todos os status" },
              { valor: "draft", rotulo: "Em andamento" },
              { valor: "submitted", rotulo: "Apenas novos" },
              { valor: "processed", rotulo: "Apenas processados" },
            ]}
          />
          <SeletorCompacto
            rotulo="Score"
            modo="lista"
            valor={scoreFilter}
            onEscolher={(v) => setScoreFilter(v as FiltroDeScore)}
            opcoes={[
              { valor: "all", rotulo: "Qualquer score" },
              { valor: "80", rotulo: "Score ≥ 80" },
              { valor: "60", rotulo: "Score ≥ 60" },
              { valor: "40", rotulo: "Score ≥ 40" },
            ]}
          />
          <SeletorCompacto
            rotulo="Período"
            modo="lista"
            valor={dateFilter}
            onEscolher={(v) => setDateFilter(v as FiltroDeData)}
            opcoes={[
              { valor: "all", rotulo: "Qualquer data" },
              { valor: "7d", rotulo: "Últimos 7 dias" },
              { valor: "30d", rotulo: "Últimos 30 dias" },
              { valor: "90d", rotulo: "Últimos 90 dias" },
            ]}
          />
        </div>
      </div>

      {/* Lista */}
      {isLoading && !submissions ? (
        <Carregando linhas={6} rotulo="Carregando submissões" />
      ) : isError && !submissions ? (
        <EstadoDeErro
          titulo="Não foi possível carregar os diagnósticos."
          acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
        />
      ) : filtered.length === 0 ? (
        <EstadoVazio
          compacto
          titulo={temFiltro ? "Nenhuma submissão com os filtros aplicados." : "Nenhum diagnóstico recebido ainda."}
          acao={temFiltro ? <button type="button" className={botao.discreto} onClick={limparFiltros}>Limpar filtros</button> : undefined}
        />
      ) : (
        <RegiaoRolavel rotulo="Diagnósticos recebidos" memoria="quiz:lista" className="lg:max-h-[65vh]">
          {/* Computador: tabela */}
          <table className="hidden w-full min-w-0 md:table">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={juntar(texto.rotulo, "w-[30%] py-2 pr-3 text-left")}>Lead</th>
                <th scope="col" className={juntar(texto.rotulo, "w-[120px] py-2 pr-3 text-left")}>Progresso</th>
                <th scope="col" className={juntar(texto.rotulo, "w-[70px] py-2 pr-3 text-right")}>Score</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Plano</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Última atividade</th>
                <th scope="col" className={juntar(texto.rotulo, "py-2 pr-3 text-left")}>Status</th>
                <th scope="col" className="py-2 text-right"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((s) => {
                const score = scoreTone(s.icp_fit_score);
                const status = statusTone(s.status);
                const planLabel = s.recommended_plan
                  ? (PLAN_LABELS[s.recommended_plan] ?? s.recommended_plan)
                  : "-";
                const answered = answeredCount(s);
                const progressPct = Math.round((answered / ANSWER_FIELDS.length) * 100);
                const lastActivity = s.submitted_at ?? s.updated_at ?? s.created_at;
                const isDraft = (s.status ?? "draft") === "draft";
                return (
                  <tr key={s.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenSubmission(s)}>
                    <td className="max-w-0 py-2.5 pr-3">
                      <p className={juntar(texto.corpo, "truncate font-medium")}>
                        {s.lead_name || <span className="font-normal italic text-muted-foreground">Sem nome ainda</span>}
                      </p>
                      <p className={juntar(texto.auxiliar, "truncate")}>
                        {[s.lead_company, s.lead_email, s.lead_whatsapp].filter(Boolean).join(" · ") ||
                          (!s.lead_name && !s.lead_email ? <span className="inline-flex items-center font-mono"><Hash className="mr-0.5 h-3 w-3" aria-hidden="true" />{s.id.slice(0, 8)}…</span> : null)}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center">
                        <div className="mr-2 h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <div className={`h-full ${isDraft ? "bg-warning/70" : "bg-primary"}`} style={{ width: `${progressPct}%` }} />
                        </div>
                        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{answered}/{ANSWER_FIELDS.length}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className={juntar(etiqueta, "border font-mono", score.className)}>{score.label}</span>
                    </td>
                    <td className={juntar(texto.corpo, "py-2.5 pr-3")}>{planLabel}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-[12.5px] tabular-nums text-muted-foreground">
                      {lastActivity ? format(new Date(lastActivity), "dd MMM yyyy · HH:mm", { locale: ptBR }) : "-"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={juntar(etiqueta, "border", status.className)}>{status.label}</span>
                    </td>
                    <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {acoesDaLinha(s, isDraft)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Celular: lista */}
          <ul className="divide-y divide-border md:hidden">
            {filtered.map((s) => {
              const score = scoreTone(s.icp_fit_score);
              const status = statusTone(s.status);
              const answered = answeredCount(s);
              const lastActivity = s.submitted_at ?? s.updated_at ?? s.created_at;
              const isDraft = (s.status ?? "draft") === "draft";
              return (
                <li key={s.id} className="flex min-w-0 items-center py-2.5">
                  <button type="button" onClick={() => setOpenSubmission(s)} className={juntar("mr-2 min-w-0 flex-1 rounded text-left", foco)}>
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>
                      {s.lead_name || <span className="font-normal italic text-muted-foreground">Sem nome ainda</span>}
                    </span>
                    <span className={juntar(texto.auxiliar, "block truncate tabular-nums")}>
                      {s.lead_company ? `${s.lead_company} · ` : ""}{answered}/{ANSWER_FIELDS.length}
                      {lastActivity ? ` · ${format(new Date(lastActivity), "dd MMM", { locale: ptBR })}` : ""}
                    </span>
                  </button>
                  <span className={juntar(etiqueta, "mr-1 border font-mono", score.className)}>{score.label}</span>
                  <span className={juntar(etiqueta, "mr-1 border", status.className)}>{status.label}</span>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={botao.icone} aria-label={`Ações de ${s.lead_name || "diagnóstico"}`}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => setOpenSubmission(s)}>
                        <Eye className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Ver respostas completas
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={isDraft} onSelect={() => copyOpsPayload(s)}>
                        <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Copiar JSON para o Ops
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={s.status === "processed" || isDraft || updatingId === s.id} onSelect={() => markProcessed(s)}>
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Marcar como processado
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </RegiaoRolavel>
      )}

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
  const planLabel = s.recommended_plan ? (PLAN_LABELS[s.recommended_plan] ?? s.recommended_plan) : "-";

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
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b border-border px-5 pb-4 pt-5 text-left">
          <SheetTitle className={juntar(texto.tituloPagina, "pr-10")}>
            {s.lead_name || "Sem nome"}
          </SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {s.lead_company || "-"} ·{" "}
            {s.submitted_at
              ? `submetido em ${format(new Date(s.submitted_at), "dd MMM yyyy · HH:mm", { locale: ptBR })}`
              : `em andamento · última atividade ${
                  (s.updated_at ?? s.created_at)
                    ? format(new Date((s.updated_at ?? s.created_at) as string), "dd MMM yyyy · HH:mm", { locale: ptBR })
                    : "-"
                }`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Resumo e contato */}
          <dl className="divide-y divide-border border-b border-border">
            <div className="flex min-w-0 items-center py-2">
              <dt className={juntar(texto.rotulo, "w-24 shrink-0")}>Score</dt>
              <dd><span className={juntar(etiqueta, "border font-mono", score.className)}>{score.label}</span></dd>
            </div>
            <div className="flex min-w-0 items-center py-2">
              <dt className={juntar(texto.rotulo, "w-24 shrink-0")}>Plano</dt>
              <dd className={juntar(texto.corpo, "font-medium")}>{planLabel}</dd>
            </div>
            {s.lead_email && (
              <div className="flex min-w-0 items-center py-2">
                <dt className={juntar(texto.rotulo, "flex w-24 shrink-0 items-center")}><Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> E-mail</dt>
                <dd className={juntar(texto.corpo, "min-w-0 truncate")}>{s.lead_email}</dd>
              </div>
            )}
            {s.lead_whatsapp && (
              <div className="flex min-w-0 items-center py-2">
                <dt className={juntar(texto.rotulo, "flex w-24 shrink-0 items-center")}><Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> WhatsApp</dt>
                <dd className={juntar(texto.corpo, "min-w-0 truncate")}>{s.lead_whatsapp}</dd>
              </div>
            )}
            {s.lead_company && (
              <div className="flex min-w-0 items-center py-2">
                <dt className={juntar(texto.rotulo, "flex w-24 shrink-0 items-center")}><Building2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Empresa</dt>
                <dd className={juntar(texto.corpo, "min-w-0 truncate")}>{s.lead_company}</dd>
              </div>
            )}
          </dl>

          {/* Respostas */}
          <div className="mt-5 space-y-5">
            {sections.map((section) => (
              <section key={section.title} className="min-w-0">
                <h3 className={juntar(texto.tituloSecao, "mb-1 text-[14px]")}>{section.title}</h3>
                <dl className="divide-y divide-border">
                  {section.items.map((it) => (
                    <div key={it.label} className="min-w-0 py-2">
                      <dt className={texto.rotulo}>{it.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-[13px] leading-5 text-foreground/90 [overflow-wrap:anywhere]">
                        {it.value || <span className="text-muted-foreground">Sem resposta</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>

        {/* Ações */}
        <div className="flex shrink-0 flex-wrap items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
          <button type="button" className={botao.secundario} onClick={() => onCopyOps(s)}>
            <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar JSON pro Ops
          </button>
          <button
            type="button"
            className={botao.primario}
            disabled={s.status === "processed" || updating}
            onClick={() => onMarkProcessed(s)}
          >
            {updating
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {s.status === "processed" ? "Já processado" : "Marcar como processado"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

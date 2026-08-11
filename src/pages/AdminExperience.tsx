import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useProjects } from "@/hooks/useSupabaseData";
import { useBilling } from "@/hooks/useFinancialData";
import { isInternalClient } from "@/lib/clientFlags";
import { notifyUser } from "@/lib/notifyHelpers";
import { toast } from "sonner";
import {
  HeartPulse, AlertTriangle, Sparkles, FileText, Send, CheckCircle2,
  Clock, ArrowUpRight, ShieldAlert, Plus,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

const daysSince = (value?: string | null): number | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

const RITUALS = [
  { value: "rota_semana", label: "Rota da Semana (abertura)", cadence: "Semanal · segunda" },
  { value: "meio_semana", label: "Check do Meio da Semana", cadence: "Semanal · quarta" },
  { value: "prova_movimento", label: "Prova de Movimento (fechamento)", cadence: "Semanal · sexta" },
  { value: "radar_aceleriq", label: "Radar Aceleriq", cadence: "Mensal" },
  { value: "marco_90", label: "Marco 90", cadence: "Trimestral" },
] as const;

/** Ritual sugerido pelo dia da semana: segunda abre, quarta checa, sexta fecha. */
const ritualForToday = (): string => {
  const day = new Date().getDay();
  if (day === 1 || day === 0) return "rota_semana";
  if (day >= 2 && day <= 4) return "meio_semana";
  return "prova_movimento";
};

const ritualLabel = (value?: string | null) =>
  RITUALS.find((r) => r.value === value)?.label || null;

interface HealthFactor {
  label: string;
  weight: number;
  earned: number | null; // null = sem dado (não entra no cálculo)
  note: string;
}

interface ClientHealth {
  client: any;
  score: number | null;
  level: "healthy" | "attention" | "risk";
  factors: HealthFactor[];
  alerts: { kind: string; label: string }[];
}

export default function AdminExperience() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: billing } = useBilling();
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genClientId, setGenClientId] = useState("");
  const [genRitual, setGenRitual] = useState<string>("rota_semana");
  const [generating, setGenerating] = useState(false);
  const [expandedHealth, setExpandedHealth] = useState<string | null>(null);

  const { data: pendingApprovalFiles = [] } = useQuery({
    queryKey: ["exp-pending-approvals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("files")
        .select("id, client_id, project_id, file_name, created_at")
        .eq("visibility", "approval")
        .eq("requires_approval", true)
        .eq("approval_status", "pending")
        .eq("status", "ready")
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: releasedFiles = [] } = useQuery({
    queryKey: ["exp-released-files"],
    queryFn: async () => {
      const { data, error } = await supabase.from("files")
        .select("id, client_id, created_at")
        .in("visibility", ["client_shared", "approval"])
        .eq("status", "ready")
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["exp-reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports")
        .select("id, client_id, project_id, title, status, metrics, summary, created_at, period_start, period_end, client:profiles!reports_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      return data || [];
    },
  });

  const portfolioClients = useMemo(
    () =>
      (clients || []).filter(
        (c: any) =>
          (c.plan_status || "active") === "active" &&
          (c.client_type || "recurring") !== "one_off" &&
          !isInternalClient(c)
      ),
    [clients]
  );

  // ───────── Saúde da carteira: nota explicável, sem inventar dado ─────────
  const healthRows = useMemo<ClientHealth[]>(() => {
    const today = new Date();
    const lastReleaseByClient = new Map<string, string>();
    (releasedFiles || []).forEach((f: any) => {
      if (f.client_id && !lastReleaseByClient.has(f.client_id)) lastReleaseByClient.set(f.client_id, f.created_at);
    });
    const lastPublishedReportByClient = new Map<string, string>();
    (reports || []).forEach((r: any) => {
      if (r.status === "published" && r.client_id && !lastPublishedReportByClient.has(r.client_id)) {
        lastPublishedReportByClient.set(r.client_id, r.created_at);
      }
    });

    return portfolioClients.map((client: any) => {
      const factors: HealthFactor[] = [];
      const alerts: { kind: string; label: string }[] = [];

      // Financeiro em dia (peso 20)
      const overdue = (billing || []).filter((b: any) => {
        if (b.client_id !== client.id || b.status !== "pending" || b.type === "ads_recharge") return false;
        const due = new Date(`${b.due_date}T12:00:00`);
        return due < today;
      });
      const overdueTotal = overdue.reduce((s: number, b: any) => s + Number(b.amount || 0), 0);
      factors.push({
        label: "Situação financeira",
        weight: 20,
        earned: overdue.length > 0 ? 0 : 20,
        note: overdue.length > 0 ? `${fmt(overdueTotal)} em atraso` : "Sem atrasos",
      });
      if (overdue.length > 0) alerts.push({ kind: "financeiro", label: `${fmt(overdueTotal)} vencidos` });

      // Aprovações respondidas (peso 15)
      const clientPending = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id);
      const oldestPendingDays = clientPending.length
        ? Math.max(...clientPending.map((f: any) => daysSince(f.created_at) || 0))
        : null;
      factors.push({
        label: "Respostas e aprovações",
        weight: 15,
        earned: oldestPendingDays === null ? 15 : oldestPendingDays > 7 ? 0 : oldestPendingDays > 3 ? 7 : 12,
        note: oldestPendingDays === null ? "Nada pendente" : `Aprovação parada há ${oldestPendingDays}d`,
      });
      if (oldestPendingDays !== null && oldestPendingDays > 4) {
        alerts.push({ kind: "aprovacao", label: `Material parado há ${oldestPendingDays} dias` });
      }

      // Entregas recentes (peso 25)
      const lastRelease = lastReleaseByClient.get(client.id) || null;
      const releaseDays = daysSince(lastRelease);
      factors.push({
        label: "Avanço percebido (entregas)",
        weight: 25,
        earned: releaseDays === null ? 0 : releaseDays <= 14 ? 25 : releaseDays <= 45 ? 13 : 0,
        note: releaseDays === null ? "Nenhuma entrega liberada" : `Última entrega há ${releaseDays}d`,
      });
      if (releaseDays === null || releaseDays > 45) {
        alerts.push({ kind: "risco", label: "45+ dias sem avanço percebido" });
      }

      // Ritmo dos projetos (peso 15)
      const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && p.status !== "done" && !p.deleted_at);
      const stalled = clientProjects.filter((p: any) => (daysSince(p.updated_at || p.created_at) || 0) >= 14 && (p.progress || 0) < 100);
      factors.push({
        label: "Ritmo dos projetos",
        weight: 15,
        earned: clientProjects.length === 0 ? null : stalled.length === 0 ? 15 : stalled.length < clientProjects.length ? 7 : 0,
        note: clientProjects.length === 0 ? "Sem projeto ativo (sem dado)" : stalled.length === 0 ? "Tudo em movimento" : `${stalled.length} projeto(s) parados 14d+`,
      });

      // Comunicação publicada (peso 10)
      const lastReport = lastPublishedReportByClient.get(client.id) || null;
      const reportDays = daysSince(lastReport);
      factors.push({
        label: "Comunicação publicada",
        weight: 10,
        earned: reportDays === null ? 0 : reportDays <= 35 ? 10 : 4,
        note: reportDays === null ? "Nenhum relatório publicado" : `Último há ${reportDays}d`,
      });

      // Percepção de valor e sentimento: sem fonte ainda (Pulso não coletado)
      factors.push({ label: "Percepção de valor (Pulso)", weight: 15, earned: null, note: "Dado ainda não disponível" });

      const available = factors.filter((f) => f.earned !== null);
      const availableWeight = available.reduce((s, f) => s + f.weight, 0);
      const earned = available.reduce((s, f) => s + (f.earned || 0), 0);
      const score = availableWeight > 0 ? Math.round((earned / availableWeight) * 100) : null;
      const level: ClientHealth["level"] =
        alerts.some((a) => a.kind === "risco") || (score !== null && score < 60)
          ? "risk"
          : score !== null && score < 80
            ? "attention"
            : "healthy";

      return { client, score, level, factors, alerts };
    }).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  }, [portfolioClients, billing, pendingApprovalFiles, releasedFiles, projects, reports]);

  const healthy = healthRows.filter((r) => r.level === "healthy").length;
  const attention = healthRows.filter((r) => r.level === "attention").length;
  const risk = healthRows.filter((r) => r.level === "risk").length;

  const draftReports = (reports || []).filter((r: any) => r.status !== "published");
  const publishedReports = (reports || []).filter((r: any) => r.status === "published");

  // ───────── Geração de rascunho com dados reais (revisão humana antes de publicar) ─────────
  const buildDraft = (client: any, ritual: string) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const clientProjects = (projects || []).filter((p: any) => p.client_id === client.id && !p.deleted_at);
    const activeProject = clientProjects.find((p: any) => p.status !== "done") || clientProjects[0] || null;
    const released7d = (releasedFiles || []).filter(
      (f: any) => f.client_id === client.id && new Date(f.created_at) >= weekAgo
    ).length;
    const pending = (pendingApprovalFiles || []).filter((f: any) => f.client_id === client.id).length;
    const name = client.company_name || client.full_name;
    const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    const base = {
      client_id: client.id,
      project_id: activeProject?.id || null,
      status: "draft",
      created_by: user?.id || null,
      period_start: weekAgo.toISOString().slice(0, 10),
      period_end: now.toISOString().slice(0, 10),
      metrics: { ritual_type: ritual } as any,
      internal_notes:
        "Rascunho gerado automaticamente pela Central de Experiência com dados reais do painel (entregas, aprovações e projetos). Revise, complete o resultado explicado e publique.",
    };

    if (ritual === "meio_semana") {
      return {
        ...base,
        title: `Check do Meio da Semana · ${dateLabel}`,
        summary: `Passando no meio da semana para manter você por dentro, ${name}: ${released7d} entrega(s) liberada(s) nos últimos dias${pending > 0 ? ` e ${pending} material(is) esperando a sua aprovação para seguirmos` : " e a produção segue no ritmo planejado"}. [REVISAR: acrescentar o andamento específico da semana]`,
        next_steps: pending > 0 ? "Aprovar os materiais pendentes ainda hoje para não travar o cronograma." : "Nenhuma ação necessária agora. Seguimos com o planejado.",
        highlights: "Check de meio de semana",
      };
    }
    if (ritual === "prova_movimento") {
      return {
        ...base,
        title: `Prova de Movimento · ${dateLabel}`,
        summary: `O que avançou nesta semana para ${name}: ${released7d} entrega(s) liberada(s) no painel${pending > 0 ? ` e ${pending} material(is) aguardando sua aprovação` : ""}. [REVISAR: adicionar o aprendizado da semana e o resultado observado]`,
        next_steps: pending > 0 ? "Aprovar os materiais pendentes para liberar a próxima etapa." : "[REVISAR: próximo passo e responsável]",
        highlights: `${released7d} entregas na semana`,
      };
    }
    if (ritual === "radar_aceleriq") {
      return {
        ...base,
        title: `Radar Aceleriq · ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`,
        summary: `Oportunidade proativa para ${name}: [REVISAR: descrever a oportunidade identificada, a recomendação e o impacto esperado]. Base do mês: ${released7d} entrega(s) na última semana e ${clientProjects.length} projeto(s) na operação.`,
        next_steps: "[REVISAR: recomendação prática e o que a Aceleriq fará se aprovado]",
        highlights: "1 oportunidade recomendada",
      };
    }
    if (ritual === "marco_90") {
      return {
        ...base,
        period_start: new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10),
        title: `Marco 90 · ${name}`,
        summary: `Resumo do trimestre de ${name}: [REVISAR: antes → agora, evidências do período, travas encontradas]. Evolução registrada no painel: entregas liberadas, aprovações e etapas concluídas.`,
        next_steps: "[REVISAR: o próximo nível para os próximos 90 dias]",
        highlights: "Marco trimestral",
      };
    }
    return {
      ...base,
      title: `Rota da Semana · ${dateLabel}`,
      summary: `Foco da semana para ${name}: [REVISAR: definir o foco única frase]. Em produção: ${clientProjects.filter((p: any) => p.status !== "done").length} frente(s). Na última semana foram liberadas ${released7d} entrega(s).${pending > 0 ? ` Ação necessária: ${pending} aprovação(ões) pendente(s).` : ""}`,
      next_steps: pending > 0 ? "Aprovar os materiais pendentes." : "[REVISAR: única ação necessária do cliente nesta semana]",
      highlights: "Rota semanal",
    };
  };

  // Evita duplicar: mesmo ritual, mesmo cliente, gerado nos últimos 3 dias.
  const hasRecentDraft = (clientId: string, ritual: string) =>
    (reports || []).some((r: any) => {
      if (r.client_id !== clientId) return false;
      if ((r.metrics as any)?.ritual_type !== ritual) return false;
      const age = daysSince(r.created_at);
      return age !== null && age <= 3;
    });

  const generateDraft = async () => {
    const targets = genClientId === "__all__"
      ? portfolioClients
      : portfolioClients.filter((c: any) => c.id === genClientId);
    if (targets.length === 0) { toast.error("Selecione um cliente"); return; }
    setGenerating(true);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const client of targets) {
        if (hasRecentDraft(client.id, genRitual)) { skipped += 1; continue; }
        const draft = buildDraft(client, genRitual);
        const { error } = await supabase.from("reports").insert(draft as any);
        if (error) failed += 1;
        else created += 1;
      }
      if (created > 0) {
        toast.success(
          `${created} rascunho(s) gerados com o contexto de cada cliente${skipped > 0 ? ` · ${skipped} pulados (já gerados nos últimos dias)` : ""}${failed > 0 ? ` · ${failed} falharam` : ""}. Revise na fila antes de publicar.`
        );
      } else if (skipped > 0 && failed === 0) {
        toast.info("Todos já tinham rascunho recente deste ritual. Nada foi duplicado.");
      } else if (failed > 0) {
        toast.error("Não foi possível gerar os rascunhos.");
      }
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      if (created > 0) setGeneratorOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar rascunho");
    } finally {
      setGenerating(false);
    }
  };

  const publishDraft = async (report: any) => {
    try {
      const { error } = await supabase.from("reports").update({ status: "published" }).eq("id", report.id);
      if (error) throw error;
      await notifyUser(report.client_id, `Nova atualização disponível: ${report.title}`, "report", "/relatorios");
      toast.success("Publicado no portal do cliente e notificado.");
      queryClient.invalidateQueries({ queryKey: ["exp-reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao publicar");
    }
  };

  const levelMeta: Record<ClientHealth["level"], { label: string; cls: string; dot: string }> = {
    healthy: { label: "Saudável", cls: "text-success", dot: "bg-success" },
    attention: { label: "Atenção", cls: "text-warning", dot: "bg-warning" },
    risk: { label: "Risco", cls: "text-destructive", dot: "bg-destructive" },
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="heading-page">Central de Experiência</p>
          <p className="text-xs text-muted-foreground mt-1">
            Somente equipe · saúde da carteira, alertas, rituais e fila de revisão. Nada aqui aparece ao cliente.
          </p>
        </div>
        <button
          onClick={() => { setGenClientId("__all__"); setGenRitual(ritualForToday()); setGeneratorOpen(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
        >
          <Sparkles className="w-4 h-4" /> Gerar mensagens de hoje
        </button>
      </div>

      {/* Resumo da carteira */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Clientes saudáveis", value: healthy, color: "text-success", icon: HeartPulse },
          { label: "Em atenção", value: attention, color: "text-warning", icon: Clock },
          { label: "Risco alto", value: risk, color: "text-destructive", icon: ShieldAlert },
          { label: "Rascunhos na fila", value: draftReports.length, color: "text-primary", icon: FileText },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* Saúde da carteira */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <HeartPulse className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Saúde da carteira ({healthRows.length})
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">Nota interna e explicável · clique para ver os fatores</span>
          </div>
          <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
            {healthRows.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">Nenhum cliente ativo na carteira.</p>
            )}
            {healthRows.map((row) => {
              const meta = levelMeta[row.level];
              const open = expandedHealth === row.client.id;
              return (
                <div key={row.client.id}>
                  <button
                    onClick={() => setExpandedHealth(open ? null : row.client.id)}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left bg-transparent border-none cursor-pointer hover:bg-secondary/30 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                    <span className="text-[13px] text-foreground flex-1 truncate">
                      {row.client.company_name || row.client.full_name}
                    </span>
                    {row.alerts.slice(0, 1).map((a) => (
                      <span key={a.label} className="hidden sm:inline text-[9px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                        {a.label}
                      </span>
                    ))}
                    <span className={`text-sm font-mono font-semibold ${meta.cls}`}>
                      {row.score === null ? "s/ dado" : row.score}
                    </span>
                    <span className="text-[10px] text-muted-foreground w-4">{open ? "▾" : "▸"}</span>
                  </button>
                  {open && (
                    <div className="px-5 pb-3 space-y-1.5 bg-secondary/20">
                      {row.factors.map((f) => (
                        <div key={f.label} className="flex items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground flex-1">{f.label}</span>
                          <span className="text-muted-foreground">{f.note}</span>
                          <span className={`font-mono w-14 text-right ${f.earned === null ? "text-muted-foreground/60" : f.earned >= f.weight ? "text-success" : f.earned === 0 ? "text-destructive" : "text-warning"}`}>
                            {f.earned === null ? "s/ dado" : `${f.earned}/${f.weight}`}
                          </span>
                        </div>
                      ))}
                      {row.alerts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {row.alerts.map((a) => (
                            <span key={a.label} className="text-[9px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" /> {a.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Fila de rascunhos + histórico */}
        <div className="space-y-5">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-warning" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Fila de revisão · rascunhos ({draftReports.length})
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">Gerar → revisar → aprovar → publicar</span>
            </div>
            <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
              {draftReports.length === 0 && (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  Nenhum rascunho na fila. Use "Gerar rascunho" para criar um ritual com dados reais.
                </p>
              )}
              {draftReports.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-foreground truncate">
                      {r.title}
                      {ritualLabel(r.metrics?.ritual_type) && (
                        <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary align-middle">
                          {ritualLabel(r.metrics?.ritual_type)}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.client?.company_name || r.client?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/relatorios/${r.id}`)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer border-none"
                  >
                    Revisar
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => publishDraft(r)}
                      className="text-[11px] px-2.5 py-1 rounded-full bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer border-none flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" /> Publicar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Histórico do que foi enviado ({publishedReports.length})
              </span>
            </div>
            <div className="divide-y divide-border max-h-[260px] overflow-y-auto">
              {publishedReports.length === 0 && (
                <p className="p-6 text-center text-xs text-muted-foreground">Nada publicado ainda.</p>
              )}
              {publishedReports.slice(0, 20).map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/relatorios/${r.id}`)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left bg-transparent border-none cursor-pointer hover:bg-secondary/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-foreground truncate">
                      {r.title}
                      {ritualLabel(r.metrics?.ritual_type) && (
                        <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success align-middle">
                          {ritualLabel(r.metrics?.ritual_type)}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.client?.company_name || r.client?.full_name} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal gerador de rascunho */}
      <Dialog open={generatorOpen} onOpenChange={setGeneratorOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Gerar rascunho de ritual</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Cliente</label>
              <select
                value={genClientId}
                onChange={(e) => setGenClientId(e.target.value)}
                className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              >
                <option value="">Selecionar…</option>
                <option value="__all__">Todos os clientes da carteira ({portfolioClients.length})</option>
                {portfolioClients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ritual</label>
              <div className="mt-1 space-y-1.5">
                {RITUALS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setGenRitual(r.value)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
                      genRitual === r.value ? "border-primary bg-primary/10 text-foreground" : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="text-[13px]">{r.label}</span>
                    <span className="text-[10px]">{r.cadence}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O rascunho nasce com os dados reais do painel (entregas, aprovações, frentes) e marcações [REVISAR] onde falta contexto humano. Nada é enviado ao cliente sem revisão e publicação manual.
            </p>
            <button
              onClick={generateDraft}
              disabled={generating}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> {generating ? "Gerando…" : "Gerar rascunho para revisão"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

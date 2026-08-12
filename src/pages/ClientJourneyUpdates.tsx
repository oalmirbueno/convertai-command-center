import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { Compass, FileCheck, CalendarDays, Inbox, ArrowUpRight } from "lucide-react";

/**
 * Onde Estamos: a linha do tempo das atualizações da Aceleriq para o cliente.
 * Rota da Semana, Check, Prova de Movimento, Radar e Marco 90 publicados,
 * em linguagem clara. Separado dos relatórios de mídia (aba Relatórios).
 */

const RITUAL_LABELS: Record<string, { label: string; cls: string }> = {
  rota_semana: { label: "Rota da Semana", cls: "bg-primary/10 text-primary" },
  meio_semana: { label: "Check do Meio da Semana", cls: "bg-sky-500/10 text-sky-500" },
  prova_movimento: { label: "Prova de Movimento", cls: "bg-emerald-500/10 text-emerald-500" },
  radar_aceleriq: { label: "Radar Aceleriq", cls: "bg-info/10 text-info" },
  marco_90: { label: "Marco 90", cls: "bg-amber-500/10 text-amber-500" },
};

export default function ClientJourneyUpdates() {
  const navigate = useNavigate();
  const { clientId } = useClientIdentity();

  const { data: updates, isLoading } = useQuery({
    queryKey: ["client-journey-updates", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports")
        .select("id, title, summary, next_steps, highlights, metrics, period_start, period_end, created_at")
        .eq("client_id", clientId!)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
  });

  // Só os rituais de acompanhamento entram aqui; relatórios de mídia ficam na aba Relatórios.
  const rituals = useMemo(
    () => (updates || []).filter((r: any) => Boolean((r.metrics as any)?.ritual_type)),
    [updates]
  );
  const latest = rituals[0] || null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="heading-page flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" /> Onde Estamos
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          As atualizações da Aceleriq sobre o seu trabalho: o que estamos fazendo, por quê, o que observamos e o próximo passo. Sempre em linguagem simples.
        </p>
      </div>

      {/* Atalhos de ação */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Aprovações", icon: FileCheck, to: "/aprovacoes" },
          { label: "Calendário", icon: CalendarDays, to: "/calendario" },
          { label: "Pedidos", icon: Inbox, to: "/pedidos" },
        ].map((shortcut) => (
          <button
            key={shortcut.to}
            type="button"
            onClick={() => navigate(shortcut.to)}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <shortcut.icon className="h-4 w-4" /> {shortcut.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      ) : rituals.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            As primeiras atualizações do seu ciclo aparecerão aqui em breve.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rituals.map((update: any, index: number) => {
            const ritualType = (update.metrics as any)?.ritual_type as string;
            const badge = RITUAL_LABELS[ritualType] || { label: "Atualização", cls: "bg-secondary text-muted-foreground" };
            const isLatest = index === 0;
            return (
              <article
                key={update.id}
                className={`rounded-2xl border bg-card p-5 sm:p-6 ${isLatest ? "border-primary/40 shadow-sm" : "border-border"}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  {isLatest && (
                    <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary text-primary-foreground font-medium">Mais recente</span>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {new Date(update.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
                  </span>
                </div>
                <h2 className="mt-3 text-sm font-semibold text-foreground">{update.title}</h2>
                {update.summary && (
                  <div className={`mt-3 text-[13px] leading-relaxed text-muted-foreground whitespace-pre-line ${isLatest ? "" : "line-clamp-6"}`}>
                    {update.summary}
                  </div>
                )}
                {update.next_steps && (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Próximo passo</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-foreground whitespace-pre-line">{update.next_steps}</p>
                  </div>
                )}
                {!isLatest && (
                  <button
                    type="button"
                    onClick={() => navigate(`/relatorios/${update.id}`)}
                    className="mt-3 flex items-center gap-1 text-[11px] text-primary hover:opacity-80"
                  >
                    Ver completa <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

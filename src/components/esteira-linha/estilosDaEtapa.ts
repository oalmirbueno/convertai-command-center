import type { EtapaDaPeca } from "@/lib/esteiraLinha/esteiraLinha";

/**
 * Cores das etapas, na mesma história da Agenda e do quadro: pauta cinza,
 * arte violeta, revisão e aprovação âmbar, agendado e no ar verde.
 */
export const ESTILO_DA_ETAPA: Record<EtapaDaPeca, { selo: string; ponto: string }> = {
  pauta: { selo: "bg-foreground/[0.07] text-muted-foreground", ponto: "bg-slate-500" },
  arte: { selo: "bg-violet-500/15 text-violet-700 dark:text-violet-300", ponto: "bg-violet-500" },
  revisao: { selo: "bg-amber-500/15 text-amber-700 dark:text-amber-300", ponto: "bg-amber-400" },
  aprovacao: { selo: "bg-amber-500/25 text-amber-800 dark:text-amber-200", ponto: "bg-amber-600" },
  agendado: { selo: "bg-success-soft text-success", ponto: "bg-emerald-400" },
  no_ar: { selo: "bg-accent-solid text-on-accent", ponto: "bg-emerald-600" },
};

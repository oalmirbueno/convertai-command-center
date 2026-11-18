import type { EtapaDaPeca } from "@/lib/esteiraLinha/esteiraLinha";

/**
 * Cores das etapas, na mesma história da Agenda e do quadro: pauta cinza,
 * arte violeta, revisão e aprovação âmbar, agendado e no ar verde.
 *
 * `cartao` (polimento v4, 15/11/2026): o fundo da peça na grade é a cor da
 * etapa em pastel cheio (referências de agenda semanal), em vez de um cinza
 * único com um selo. No ar é o bloco sólido da marca.
 */
export const ESTILO_DA_ETAPA: Record<EtapaDaPeca, { selo: string; ponto: string; cartao: string }> = {
  pauta: { selo: "bg-foreground/[0.07] text-muted-foreground", ponto: "bg-slate-500", cartao: "bg-muted" },
  arte: { selo: "bg-violet-500/15 text-violet-700 dark:text-violet-300", ponto: "bg-violet-500", cartao: "bg-violet-500/[0.16] dark:bg-violet-500/25" },
  revisao: { selo: "bg-amber-500/15 text-amber-700 dark:text-amber-300", ponto: "bg-amber-400", cartao: "bg-amber-400/25 dark:bg-amber-400/20" },
  aprovacao: { selo: "bg-amber-500/25 text-amber-800 dark:text-amber-200", ponto: "bg-amber-600", cartao: "bg-amber-500/40 dark:bg-amber-500/30" },
  agendado: { selo: "bg-success-soft text-success", ponto: "bg-emerald-400", cartao: "bg-sky-500/[0.16] dark:bg-sky-400/20" },
  no_ar: { selo: "bg-accent-solid text-on-accent", ponto: "bg-emerald-600", cartao: "ds-accent bg-accent-solid" },
};

import type { EditorialVisualStage } from "@/lib/editorial";

/**
 * A cor de cada etapa do conteúdo, em um lugar só.
 *
 * A agenda já sabia dizer o NOME da etapa ("Em revisão", "Programado",
 * "Publicado") e não tinha cor nenhuma: os cards do backlog saíam todos com a
 * mesma borda cinza, então era preciso ler cada um para saber em que pé
 * estava. Cor resolve isso antes da leitura.
 *
 * Os tons seguem o significado, não a estética: verde é o que já saiu, azul é
 * o que está armado, âmbar é o que precisa de gente, vermelho é o que falhou.
 * Cancelado fica cinza de propósito — é o único que não pede ação.
 */

export interface CorDaEtapa {
  /** Borda do card. */
  borda: string;
  /** Fundo suave, para o card inteiro. */
  fundo: string;
  /** Texto e selo. */
  texto: string;
  /** Bolinha sólida, para leitura periférica. */
  ponto: string;
}

const CORES: Record<EditorialVisualStage, CorDaEtapa> = {
  draft: {
    borda: "border-border",
    fundo: "bg-background",
    texto: "text-muted-foreground",
    ponto: "bg-muted-foreground",
  },
  production: {
    borda: "border-amber-500/35",
    fundo: "bg-amber-500/[0.06]",
    texto: "text-amber-600 dark:text-amber-400",
    ponto: "bg-amber-500",
  },
  ready: {
    borda: "border-violet-500/35",
    fundo: "bg-violet-500/[0.06]",
    texto: "text-violet-600 dark:text-violet-400",
    ponto: "bg-violet-500",
  },
  scheduled: {
    borda: "border-sky-500/35",
    fundo: "bg-sky-500/[0.06]",
    texto: "text-sky-600 dark:text-sky-400",
    ponto: "bg-sky-500",
  },
  overdue: {
    borda: "border-orange-600/45",
    fundo: "bg-orange-600/[0.08]",
    texto: "text-orange-700 dark:text-orange-400",
    ponto: "bg-orange-600",
  },
  published: {
    borda: "border-emerald-500/35",
    fundo: "bg-emerald-500/[0.06]",
    texto: "text-emerald-600 dark:text-emerald-400",
    ponto: "bg-emerald-500",
  },
  failed: {
    borda: "border-destructive/45",
    fundo: "bg-destructive/[0.07]",
    texto: "text-destructive",
    ponto: "bg-destructive",
  },
  cancelled: {
    borda: "border-border",
    fundo: "bg-muted/40",
    texto: "text-muted-foreground",
    ponto: "bg-muted-foreground",
  },
};

/** A cor da etapa. Etapa desconhecida cai no neutro em vez de ficar sem classe. */
export function corDaEtapa(etapa: string | null | undefined): CorDaEtapa {
  return CORES[(etapa || "draft") as EditorialVisualStage] ?? CORES.draft;
}

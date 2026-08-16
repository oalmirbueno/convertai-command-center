import type { LucideIcon } from "lucide-react";
import { Megaphone, Share2 } from "lucide-react";

/**
 * As definições do Ciclo da Semana, em um lugar só.
 *
 * A tela do checklist e a folha de detalhe do cliente falam das mesmas etapas;
 * manter os textos aqui evita que uma mude e a outra fique contando outra
 * história.
 */

export type CycleArea = "social" | "trafego";

export interface CycleDefinition {
  label: string;
  short: string;
  icon: LucideIcon;
  steps: string[];
}

export const CYCLES: Record<CycleArea, CycleDefinition> = {
  social: {
    label: "Social Media",
    short: "Social",
    icon: Share2,
    steps: [
      "Conteúdo da semana criado (artes e legendas)",
      "Subir no painel (Arquivos, pasta certa)",
      "Conectar e conferir a conta no painel",
      "Painel atualizado (agenda, métricas, diário)",
      "Aprovação no grupo + ritual enviado",
      "Posts agendados (publicação automática armada)",
    ],
  },
  trafego: {
    label: "Tráfego Pago",
    short: "Tráfego",
    icon: Megaphone,
    steps: [
      "Campanhas ativas revisadas",
      "Criativos da semana prontos",
      "Anúncios subidos ou atualizados",
      "Verba e orçamento conferidos",
      "Métricas lidas e leitura anotada",
      "Registro no painel para o cliente ver",
    ],
  },
};

/** Trilho de entrada, só para quem ainda não concluiu o onboarding. */
export const ONBOARDING_STEPS = [
  "Acessos e briefing completos",
  "Contas conectadas no painel",
  "Estratégia e primeiro calendário aprovados",
  "Rotina semanal rodando (conclui o onboarding)",
];

/** Semanas de história que alimentam linha do tempo e sequência. */
export const HISTORY_WEEKS = 8;

/** Serviços do cadastro, com o nome que a equipe usa no dia a dia. */
export const SERVICE_LABELS: Record<string, string> = {
  social: "Social",
  trafego: "Tráfego",
  design: "Design",
  copywriting: "Copy",
  edicao_video: "Edição de vídeo",
  videos_ia: "Vídeo com IA",
  site: "Site",
  seo: "SEO",
  automacao: "Automação",
  email_marketing: "E-mail",
  relatorios: "Relatórios",
};

/** Nome da etapa, considerando o trilho de onboarding depois da sexta. */
export function stepLabel(area: CycleArea, step: number): string {
  const steps = CYCLES[area].steps;
  return step <= steps.length ? steps[step - 1] : ONBOARDING_STEPS[step - steps.length - 1];
}

/**
 * O resumo da semana em texto corrido, pronto para colar no grupo do cliente.
 * Fala do que foi feito, não de números internos, e só cita o que falta quando
 * ainda falta alguma coisa.
 */
export function weekSummaryText(input: {
  clientName: string;
  area: CycleArea;
  doneSteps: number[];
  totalSteps: number;
}): string {
  const { clientName, area, doneSteps, totalSteps } = input;
  const feitas = doneSteps
    .filter((step) => step <= CYCLES[area].steps.length)
    .map((step) => CYCLES[area].steps[step - 1].replace(/\s*\(.*?\)\s*/g, "").toLowerCase());

  if (feitas.length === 0) {
    return `${clientName} · ${CYCLES[area].label}: a semana ainda não teve etapas concluídas.`;
  }

  const faltam = totalSteps - doneSteps.length;
  return (
    `${clientName} · ${CYCLES[area].label} desta semana: ` +
    `${feitas.join(", ")}.` +
    (faltam > 0
      ? ` Faltam ${faltam} ${faltam === 1 ? "etapa" : "etapas"} para fechar a semana.`
      : " Semana fechada.")
  );
}

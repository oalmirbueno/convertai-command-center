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

/**
 * As três frentes da semana, na ordem em que o trabalho flui.
 *
 * Os seis passos persistidos continuam os mesmos (a marcação guarda o
 * número); as frentes são a APRESENTAÇÃO: três filas sequenciais em vez
 * de seis botões. Cada fila junta o passo fixo da frente com o que gira:
 * produzir (1→2), manter o painel vivo (3→4), colocar na rua (5→6).
 * Vivem aqui porque card e folha mostram as MESMAS frentes — em dois
 * lugares, uma divergiria da outra no primeiro conserto.
 */
export const FRENTES_DA_SEMANA: Array<{ nome: string; steps: number[] }> = [
  { nome: "Produção", steps: [1, 2] },
  { nome: "Painel", steps: [3, 4] },
  { nome: "Publicação", steps: [5, 6] },
];

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
  /**
   * As etapas daquele cliente naquela semana. Três delas giram, então o
   * resumo precisa citar o que a semana realmente pediu, não uma lista fixa.
   */
  stepNames?: string[];
}): string {
  const { clientName, area, doneSteps, totalSteps, stepNames } = input;
  const nomes = stepNames?.length ? stepNames : CYCLES[area].steps;
  const feitas = doneSteps
    .filter((step) => step <= nomes.length)
    .map((step) => nomes[step - 1].replace(/\s*\(.*?\)\s*/g, "").toLowerCase());

  if (feitas.length === 0) {
    // Semana recém-começada não é semana vazia: o texto que vai para o
    // cliente fala do que está em produção, nunca do que falta.
    return `${clientName} · ${CYCLES[area].label}: a semana está em produção por aqui. Assim que as primeiras entregas saírem, você recebe.`;
  }

  const faltam = totalSteps - doneSteps.length;
  return (
    `${clientName} · ${CYCLES[area].label} desta semana: ` +
    `${feitas.join(", ")}.` +
    (faltam > 0
      ? ` O restante da semana segue em andamento.`
      : " Semana completa.")
  );
}

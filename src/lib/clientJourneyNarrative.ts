/**
 * Narrativa automática de "onde estamos", montada a partir do que já existe no
 * painel: frentes ativas, entregas do ciclo, aprovações pendentes, o que foi ao
 * ar e o que vem a seguir.
 *
 * A tela do cliente não pode depender de alguém sentar e escrever um texto.
 * Esta função sempre devolve conteúdo útil, em linguagem simples e sempre
 * construtiva: fase parada vira "próximo passo", nunca cobrança.
 */

export interface JourneyProject {
  id: string;
  name?: string | null;
  status?: string | null;
  billing_mode?: string | null;
  deadline?: string | null;
  objectives?: string | null;
}

export interface JourneyTask {
  project_id?: string | null;
  title?: string | null;
  status?: string | null;
  due_date?: string | null;
  deleted_at?: string | null;
}

export interface JourneyMilestone {
  project_id?: string | null;
  title?: string | null;
  status?: string | null;
  target_date?: string | null;
}

export interface JourneyPublication {
  status?: string | null;
  scheduled_at?: string | null;
  published_at?: string | null;
  permalink?: string | null;
  platform?: string | null;
}

export interface JourneySnapshot {
  projects: readonly JourneyProject[];
  tasks: readonly JourneyTask[];
  milestones: readonly JourneyMilestone[];
  pendingApprovals: number;
  publications: readonly JourneyPublication[];
  planName?: string | null;
}

export interface JourneySignal {
  label: string;
  value: string;
  tone: "neutral" | "good" | "attention";
}

export interface JourneyNarrative {
  phase: string;
  headline: string;
  paragraphs: string[];
  nextStep: string;
  signals: JourneySignal[];
}

const DONE = new Set(["done", "completed", "concluido", "concluído", "delivered"]);

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDay(value: Date) {
  return value.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export function buildJourneyNarrative(
  snapshot: JourneySnapshot,
  reference: Date = new Date(),
): JourneyNarrative {
  const activeProjects = snapshot.projects.filter(
    (project) => (project.status || "active") !== "done",
  );

  const monthStart = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const liveTasks = snapshot.tasks.filter((task) => !task.deleted_at);

  const doneThisMonth = liveTasks.filter((task) => {
    if (!DONE.has((task.status || "").toLowerCase())) return false;
    const due = parseDate(task.due_date);
    return due !== null && due >= monthStart && due <= reference;
  }).length;

  const inProgress = liveTasks.filter(
    (task) => !DONE.has((task.status || "").toLowerCase()),
  );

  const upcoming = inProgress
    .map((task) => ({ task, due: parseDate(task.due_date) }))
    .filter((entry) => entry.due !== null && entry.due >= reference)
    .sort((left, right) => left.due!.getTime() - right.due!.getTime());

  const publishedCount = snapshot.publications.filter(
    (publication) => publication.status === "published",
  ).length;

  const nextPublication = snapshot.publications
    .filter((publication) => publication.status === "scheduled")
    .map((publication) => ({ publication, at: parseDate(publication.scheduled_at) }))
    .filter((entry) => entry.at !== null && entry.at >= reference)
    .sort((left, right) => left.at!.getTime() - right.at!.getTime())[0] || null;

  const nextMilestone = snapshot.milestones
    .filter((milestone) => !DONE.has((milestone.status || "").toLowerCase()))
    .map((milestone) => ({ milestone, at: parseDate(milestone.target_date) }))
    .filter((entry) => entry.at !== null && entry.at >= reference)
    .sort((left, right) => left.at!.getTime() - right.at!.getTime())[0] || null;

  // Fase da jornada, lida do próprio movimento do painel.
  const phase =
    publishedCount > 0
      ? "No ar e medindo"
      : nextPublication
        ? "Pronto para publicar"
        : inProgress.length > 0
          ? "Em produção"
          : "Montando a base";

  const headline =
    publishedCount > 0
      ? `Seu conteúdo já está no ar: ${publishedCount} ${plural(publishedCount, "publicação entregue", "publicações entregues")}.`
      : nextPublication?.at
        ? `Tudo pronto para a próxima publicação, marcada para ${formatDay(nextPublication.at)}.`
        : inProgress.length > 0
          ? `Estamos produzindo: ${inProgress.length} ${plural(inProgress.length, "entrega em andamento", "entregas em andamento")}.`
          : "Estamos organizando a base do seu trabalho.";

  const paragraphs: string[] = [];

  if (activeProjects.length > 0) {
    const names = activeProjects
      .map((project) => project.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    paragraphs.push(
      activeProjects.length === 1
        ? `A frente ativa neste momento é ${names || "o seu projeto"}.`
        : `Suas frentes ativas neste momento: ${names}${activeProjects.length > 3 ? " e outras" : ""}.`,
    );
  }

  if (doneThisMonth > 0) {
    paragraphs.push(
      `Neste mês já ${plural(doneThisMonth, "foi concluída", "foram concluídas")} ${doneThisMonth} ${plural(doneThisMonth, "entrega", "entregas")}.`,
    );
  }

  if (inProgress.length > 0) {
    const next = upcoming[0];
    paragraphs.push(
      next?.due
        ? `Agora seguimos com ${inProgress.length} ${plural(inProgress.length, "item em produção", "itens em produção")}. O próximo a ficar pronto é "${next.task.title || "a próxima entrega"}", previsto para ${formatDay(next.due)}.`
        : `Agora seguimos com ${inProgress.length} ${plural(inProgress.length, "item em produção", "itens em produção")}.`,
    );
  }

  if (nextPublication?.at) {
    paragraphs.push(
      `A próxima publicação já está programada para ${formatDay(nextPublication.at)}, então ela sai no horário certo sem depender de ninguém lembrar.`,
    );
  }

  if (nextMilestone?.at) {
    paragraphs.push(
      `O próximo marco combinado é "${nextMilestone.milestone.title || "a próxima etapa"}", com data em ${formatDay(nextMilestone.at)}.`,
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      "Estamos na fase de organizar tudo o que sua marca precisa para começar a aparecer com consistência. Assim que a primeira entrega entrar em produção, ela aparece aqui automaticamente.",
    );
  }

  // Próximo passo: sempre o que destrava mais rápido.
  const nextStep =
    snapshot.pendingApprovals > 0
      ? `Você tem ${snapshot.pendingApprovals} ${plural(snapshot.pendingApprovals, "material esperando sua aprovação", "materiais esperando sua aprovação")}. Assim que aprovar, seguimos direto para o agendamento.`
      : nextPublication?.at
        ? `Nada pendente com você. A próxima publicação sai em ${formatDay(nextPublication.at)}.`
        : upcoming[0]?.due
          ? `Nada pendente com você. Seguimos produzindo, e a próxima entrega chega em ${formatDay(upcoming[0].due)}.`
          : "Nada pendente com você no momento. Seguimos tocando o trabalho e avisamos aqui a cada avanço.";

  const signals: JourneySignal[] = [
    {
      label: "Entregas concluídas no mês",
      value: String(doneThisMonth),
      tone: doneThisMonth > 0 ? "good" : "neutral",
    },
    {
      label: "Em produção agora",
      value: String(inProgress.length),
      tone: "neutral",
    },
    {
      label: "Publicações no ar",
      value: String(publishedCount),
      tone: publishedCount > 0 ? "good" : "neutral",
    },
    {
      label: "Esperando você",
      value: String(snapshot.pendingApprovals),
      tone: snapshot.pendingApprovals > 0 ? "attention" : "good",
    },
  ];

  return { phase, headline, paragraphs, nextStep, signals };
}

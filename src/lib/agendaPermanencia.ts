/**
 * Onde fica, no calendário, o conteúdo que ainda não tem agendamento.
 *
 * `editorial_posts` não guarda data — o dia vem de
 * `editorial_publications.scheduled_at`. Um conteúdo criado a partir de uma
 * tarefa nasce sem publicação, então no instante em que ele ganha a arte ele
 * deixa de ter qualquer dia e some da grade. Foi o que aconteceu com cinco
 * conteúdos reais: com arte, `ready`, ligados a tarefa, e invisíveis.
 *
 * A primeira tentativa de conserto mantinha a TAREFA na grade representando o
 * conteúdo, e falhou por depender de a tarefa sobreviver a toda a régua dela
 * (tipo publicável, filtros de escopo, prazo vencido há mais de 7 dias). Se
 * qualquer uma cortasse, o conteúdo continuava invisível.
 *
 * Aqui a conta é direta: o POST é o que precisa aparecer, e a tarefa é apenas
 * de onde a data vem. Nenhum filtro de tarefa participa da decisão.
 */

export interface PostParaAncorar {
  id: string;
  publications: ReadonlyArray<{
    publication: { scheduled_at?: string | null; status?: string | null };
  }>;
}

export interface TarefaComPrazo {
  id: string;
  due_date?: string | null;
}

export interface AncoraDeConteudo {
  postId: string;
  /** Dia no formato yyyy-MM-dd, herdado do prazo da tarefa de origem. */
  dateKey: string;
}

/** Já ocupa um dia por conta própria: publicação com data e não cancelada. */
export function temPlanoVivo(post: PostParaAncorar): boolean {
  return post.publications.some(
    ({ publication }) =>
      Boolean(publication.scheduled_at) && publication.status !== "cancelled",
  );
}

const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dia que existe no calendario, nao so no formato.
 *
 * Conferir so o formato aceita "2026-13-45" — mes 13, dia 45 —, e um dia
 * impossivel viraria uma chave que nenhuma celula da grade tem: o conteudo
 * seria "ancorado" num dia inexistente e sumiria de novo, agora sem nem
 * cair no backlog.
 */
function diaReal(valor: string): boolean {
  if (!FORMATO_DIA.test(valor)) return false;
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  );
}

/**
 * Os conteúdos sem agendamento que herdam o dia da tarefa de origem.
 *
 * Devolve um mapa dia → posts, pronto para a grade desenhar junto das
 * publicações daquele dia.
 */
export function ancorasPorDia(entrada: {
  posts: readonly PostParaAncorar[];
  tarefas: readonly TarefaComPrazo[];
  /** task_id → post_id, como o índice de vínculos entrega. */
  postIdPorTarefa: Record<string, string>;
}): Map<string, string[]> {
  const { posts, tarefas, postIdPorTarefa } = entrada;

  // Só posts que a tela já decidiu mostrar entram: se o conteúdo foi filtrado
  // por formato, status ou busca, ancorá-lo aqui o traria de volta pelas
  // costas do filtro.
  const visiveis = new Map(posts.map((post) => [post.id, post]));

  const prazoPorTarefa = new Map(
    tarefas.map((tarefa) => [tarefa.id, tarefa.due_date?.slice(0, 10) || ""]),
  );

  const porDia = new Map<string, string[]>();
  for (const [taskId, postId] of Object.entries(postIdPorTarefa)) {
    const post = visiveis.get(postId);
    if (!post) continue;
    // Com plano vivo, quem ocupa o dia é a publicação: manter os dois seria
    // o mesmo conteúdo contado duas vezes.
    if (temPlanoVivo(post)) continue;

    const dia = prazoPorTarefa.get(taskId) || "";
    if (!diaReal(dia)) continue;

    const atual = porDia.get(dia) || [];
    // Duas tarefas apontando para o mesmo conteúdo não o desenham duas vezes.
    if (!atual.includes(postId)) atual.push(postId);
    porDia.set(dia, atual);
  }
  return porDia;
}

/** Os posts ancorados em algum dia, para não repetirem na lista de sem prazo. */
export function idsAncorados(porDia: Map<string, string[]>): Set<string> {
  const ids = new Set<string>();
  for (const lista of porDia.values()) for (const id of lista) ids.add(id);
  return ids;
}

// Ajustes em conteúdo já aprovado, sem criar revisão (14/11/2026):
// legenda (editar_legenda_publicacao_aprovada), formato de peça única
// (ajustar_formato_publicacao_aprovada) e a confirmação do "Agendar
// aprovados". Regras puras, sem tela, para os testes cobrirem.

export type FormatoDePecaUnica = "static" | "story" | "reel" | "video";

export interface OpcaoDeFormato {
  value: FormatoDePecaUnica;
  label: string;
}

const ROTULO_DO_FORMATO: Record<FormatoDePecaUnica, string> = {
  static: "Post estático",
  story: "Story",
  reel: "Reel",
  video: "Vídeo",
};

const FORMATOS_DE_PECA_UNICA = new Set<string>(["static", "story", "reel", "video"]);

export function ehFormatoDePecaUnica(valor: string | null | undefined): valor is FormatoDePecaUnica {
  return !!valor && FORMATOS_DE_PECA_UNICA.has(valor);
}

/**
 * Formatos que um conteúdo aprovado pode assumir sem revisão. Imagem: post
 * estático ou story. Vídeo: reel, vídeo ou story. Carrossel (ou qualquer
 * formato fora da peça única) não troca: o Story precisa de uma peça só.
 */
export function formatosPermitidos(input: {
  formatoAtual: string | null | undefined;
  ehVideo: boolean;
  temLaminas: boolean;
}): OpcaoDeFormato[] {
  if (input.temLaminas || !ehFormatoDePecaUnica(input.formatoAtual)) return [];
  const valores: FormatoDePecaUnica[] = input.ehVideo ? ["reel", "video", "story"] : ["static", "story"];
  return valores.map((value) => ({ value, label: ROTULO_DO_FORMATO[value] }));
}

/**
 * Opções de formato no diálogo de agendamento. O formato vem da mídia (como
 * sempre) e o Story é uma escolha explícita: um estático 9:16 do feed não
 * vira Story sozinho. Carrossel não oferece Story.
 */
export function opcoesDeFormatoNoAgendamento(
  formatoDaMidia: "static" | "carousel" | "video" | string | null | undefined,
): Array<{ value: string; label: string }> {
  if (formatoDaMidia === "static") {
    return [
      { value: "static", label: "Post no feed" },
      { value: "story", label: "Story" },
    ];
  }
  if (formatoDaMidia === "video") {
    return [
      { value: "video", label: "Vídeo no feed" },
      { value: "story", label: "Story" },
    ];
  }
  return [];
}

/** O agendamento precisa de um ajuste de formato depois do save? */
export function precisaAjustarParaStory(formatoEscolhido: string | null | undefined, formatoGravado: string | null | undefined) {
  return formatoEscolhido === "story" && formatoGravado !== "story";
}

export interface EventoEditorial {
  event_type: string;
  created_at: string;
  actor_name?: string | null;
  publication_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const EVENTO_LEGENDA_EDITADA = "caption_edited_after_approval";
export const EVENTO_FORMATO_AJUSTADO = "content_type_adjusted_after_approval";

/** A edição de legenda mais recente depois da aprovação, se houver. */
export function legendaEditadaAposAprovacao(
  eventos: readonly EventoEditorial[] | null | undefined,
  publicationId?: string | null,
): { quando: string; quem: string | null } | null {
  const doTipo = (eventos || []).filter(
    (evento) =>
      evento.event_type === EVENTO_LEGENDA_EDITADA &&
      (!publicationId || evento.publication_id === publicationId),
  );
  if (doTipo.length === 0) return null;
  const maisNovo = [...doTipo].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return { quando: maisNovo.created_at, quem: maisNovo.actor_name || null };
}

// ------------------------------------------------------- Agendar aprovados

export interface AprovadoParaAgendar {
  clientId: string;
  publicationId: string;
  version: number;
  scheduledAt: string;
}

/**
 * Com um cliente filtrado na tela, só entram as publicações dele, mesmo que
 * a lista em memória traga outro cliente (cache, troca de filtro no meio).
 */
export function aprovadosDoFiltro<T extends AprovadoParaAgendar>(
  itens: readonly T[],
  clienteFiltrado: string | null | undefined,
): T[] {
  const filtro = clienteFiltrado && clienteFiltrado !== "all" ? clienteFiltrado : null;
  return filtro ? itens.filter((item) => item.clientId === filtro) : [...itens];
}

export function resumoPorCliente(
  itens: readonly AprovadoParaAgendar[],
  nomeDoCliente: (clientId: string) => string,
): Array<{ clientId: string; nome: string; quantidade: number }> {
  const contagem = new Map<string, number>();
  for (const item of itens) contagem.set(item.clientId, (contagem.get(item.clientId) || 0) + 1);
  return [...contagem.entries()]
    .map(([clientId, quantidade]) => ({ clientId, nome: nomeDoCliente(clientId) || "Cliente", quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Texto do diálogo: quantos posts e de quais clientes. Nunca agenda em silêncio. */
export function confirmacaoDeAgendarAprovados(
  resumo: ReadonlyArray<{ nome: string; quantidade: number }>,
  todosOsClientes: boolean,
): { title: string; description: string; confirmLabel: string } {
  const total = resumo.reduce((soma, cliente) => soma + cliente.quantidade, 0);
  const linhas = resumo.map((cliente) => `${cliente.nome}: ${plural(cliente.quantidade, "post", "posts")}`);
  const varios = resumo.length > 1;
  const cabeca = varios || todosOsClientes
    ? `Você está em todos os clientes. Vão ser agendados ${plural(total, "post", "posts")} de ${plural(resumo.length, "cliente", "clientes")}:`
    : `Vão ser agendados ${plural(total, "post", "posts")} de ${resumo[0]?.nome || "um cliente"}.`;
  const regra = "Cada um mantém a data e o horário planejados. Se o horário já passou, vai para 1 hora a partir de agora.";
  return {
    title: total === 1 ? "Agendar 1 post aprovado?" : `Agendar ${total} posts aprovados?`,
    description: (varios || todosOsClientes ? [cabeca, ...linhas, "", regra] : [cabeca, "", regra]).join("\n"),
    confirmLabel: total === 1 ? "Agendar 1 post" : `Agendar ${total} posts`,
  };
}

/** Mantém o horário planejado; se já passou, vai para 1 hora a partir de agora. */
export function horarioDoAgendamentoEmLote(planejado: string, agora: number = Date.now()): string {
  return new Date(planejado).getTime() > agora
    ? planejado
    : new Date(agora + 60 * 60 * 1000).toISOString();
}

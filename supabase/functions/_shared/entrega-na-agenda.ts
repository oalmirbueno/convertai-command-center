/**
 * Entrega do Estúdio → Agenda (frente EA, 27/09).
 *
 * Pedido do dono: "sempre quando entregar uma arte, ele já atualiza lá na
 * agenda com base naquele conteúdo; eu só confirmo a data; depois da
 * aprovação do cliente ele publica na data e horário selecionados".
 *
 * Como fica, sem criar caminho novo de publicação (o que já publica no
 * painel é o ciclo do banco: editorial_promover_planejados + a fila
 * editorial_autopublish_tick, com trava por publicação e sem retry
 * automático depois da falha):
 *
 * 1. Entregar cria ou ATUALIZA o post da Agenda da peça (mesma peça = mesmo
 *    post): capa e lâminas na ordem da entrega (arquivo principal + filhos),
 *    formato, legenda com hashtags, conta do Instagram do projeto. O post nasce
 *    pelo caminho comum da Agenda (save_editorial_post), sem data: a data
 *    proposta fica no trabalho até o dono confirmar.
 * 2. Confirmar a data grava o horário na publicação (continua "planejada").
 *    Sem aprovação do cliente o arquivo não é publicável e nada sai.
 * 3. Com a aprovação, o promotor do banco passa a publicação para
 *    "agendada" e o motor publica no horário. Aprovação que chega depois do
 *    horário só publica se o dono marcou "publicar assim que aprovar"; senão
 *    o banco segura (mesa_publicacao_segurada) e a tela pede nova data.
 *
 * Sem import de Deno nem de npm: a função do estúdio, a tela e os testes
 * (vitest) leem o mesmo arquivo.
 */

export const FUSO_PADRAO = "America/Sao_Paulo";
/** Aprovação até 5 minutos depois do horário ainda sai no horário (o banco usa a mesma folga). */
export const FOLGA_DE_ATRASO_MIN = 5;
/** Janela do promotor do banco: atrasado além disso ele não publica sozinho. */
export const JANELA_DO_PROMOTOR_H = 6;
/** Horário confirmado precisa estar pelo menos 2 minutos à frente. */
export const ANTECEDENCIA_MIN = 2;
/** "Publicar agora" marca para daqui a 1 minuto (o motor roda de minuto em minuto). */
export const PUBLICAR_AGORA_EM_MIN = 1;
/** Carrossel do Instagram: até 10 mídias. */
export const MAX_MIDIAS_DO_CARROSSEL = 10;
/** Linhas guardadas no histórico da peça na Agenda. */
export const MAX_HISTORICO = 30;

const MIN = 60_000;

// ------------------------------------------------------------------ tipos

/** A peça entregue pelo Estúdio, do jeito que a Agenda precisa. */
export interface PecaEntregue {
  trabalhoId: string;
  clientId: string;
  projectId: string;
  taskId: string;
  titulo: string;
  /** Arquivos da entrega na ordem das lâminas: capa (raiz) e filhas. */
  fileIds: string[];
  legenda: string | null;
  hashtags?: string[] | null;
  /** Descrição do arquivo raiz (a Agenda usa como objetivo do post aprovado). */
  objetivo?: string | null;
  rodada: number;
}

export interface PublicacaoExistente {
  id: string;
  version: number;
  status: string;
  platform: string;
  external_account_id: string | null;
  file_id: string | null;
  caption: string | null;
  first_comment: string | null;
  alt_text: string | null;
  scheduled_at: string | null;
  scheduled_timezone: string | null;
  idempotency_key: string | null;
  published_at?: string | null;
  permalink?: string | null;
}

export interface PostExistente {
  id: string;
  version: number;
  client_id: string;
  project_id: string;
  primary_file_id: string | null;
  title: string;
  content_type: string;
  objective: string | null;
  default_caption: string | null;
  production_status: string;
  archived_at?: string | null;
  internal: {
    idempotency_key: string | null;
    task_id: string | null;
    responsible_id: string | null;
    internal_notes: string | null;
    revision_of_post_id: string | null;
  } | null;
  publications: PublicacaoExistente[];
}

export interface ContaDoProjeto {
  id: string;
  platform: string;
}

export type AcaoDaSincronizacao = "criar" | "atualizar" | "revisao" | "nada" | "bloqueado";

export interface PlanoDaSincronizacao {
  acao: AcaoDaSincronizacao;
  motivo: string | null;
  /** Payload de save_editorial_post (ausente em "nada" e "bloqueado"). */
  payload?: Record<string, unknown>;
  expectedVersion?: number | null;
  /** Post antigo que vira histórico quando a revisão nasce (arquivado depois). */
  postAnteriorId?: string | null;
  aviso?: string | null;
}

// ------------------------------------------------------------------ utilidades

const texto = (v: unknown, max = 4000) => (v == null ? "" : String(v)).slice(0, max).trim();

/** Legenda que vai ao ar: o texto e, numa linha própria no fim, as hashtags (sem repetir as que já estão no texto). */
export function legendaComHashtags(legenda: string | null | undefined, hashtags: string[] | null | undefined): string | null {
  const base = (legenda || "").trim();
  const tags = (hashtags || []).map((h) => String(h || "").trim()).filter((h) => !!h && base.indexOf(h) < 0);
  if (!base && !tags.length) return null;
  return tags.length ? `${base}${base ? "\n\n" : ""}${tags.join(" ")}` : base;
}

/** Uma lâmina = estático; mais de uma = carrossel. */
export function tipoDoConteudo(fileIds: string[]): "carousel" | "static" {
  return fileIds.length > 1 ? "carousel" : "static";
}

/**
 * UUID estável (forma de versão 4, variante 8/9/a/b) a partir de uma semente:
 * a mesma peça gera sempre a mesma chave de idempotência (a captura da Agenda
 * exige a forma de UUID de verdade, igual a mesa_uuid_estavel do banco).
 */
export async function uuidEstavel(semente: string): Promise<string> {
  const bytes = new TextEncoder().encode(semente);
  const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const h = Array.from(resumo, (b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
  const variante = "89ab".charAt(parseInt(h.slice(16, 18), 16) % 4);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Sementes das chaves da peça: a rodada entra para a revisão (entrega depois de reprovação) nascer com chave própria. */
export function sementesDaPeca(trabalhoId: string, rodada: number) {
  const r = Math.max(1, Math.floor(Number(rodada) || 1));
  return {
    post: `mesa-peca:${trabalhoId}:r${r}`,
    publicacao: (contaId: string) => `mesa-peca-publicacao:${trabalhoId}:r${r}:${contaId}`,
    mutacao: (assinatura: string) => `mesa-peca-mutacao:${trabalhoId}:r${r}:${assinatura}`,
  };
}

/** Assinatura curta do que a entrega leva (arquivos, legenda, título, tipo): mesma entrega = mesma assinatura. */
export function assinaturaDaEntrega(peca: PecaEntregue): string {
  const partes = [peca.fileIds.join(","), legendaComHashtags(peca.legenda, peca.hashtags) || "", texto(peca.titulo, 300), tipoDoConteudo(peca.fileIds)];
  // djb2: curto, estável e sem depender de crypto (a chave final passa por uuidEstavel).
  let h = 5381;
  const s = partes.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Arquivo que ainda não entrou no fluxo de aprovação (a Agenda deixa trocar). Mesma regra de file_is_editable. */
export function arquivoEditavel(f: { locked_at?: string | null; visibility?: string | null; agency_approval_status?: string | null; approval_status?: string | null } | null | undefined): boolean {
  if (!f) return false;
  return !f.locked_at && f.visibility === "internal" && (f.agency_approval_status || "not_requested") === "not_requested" && (f.approval_status || "none") === "none";
}

/** A publicação da peça: a do Instagram viva (a que o motor publica). Na falta, qualquer viva. */
export function publicacaoDaPeca(pubs: PublicacaoExistente[] | null | undefined): PublicacaoExistente | null {
  const vivas = (pubs || []).filter((p) => p.status !== "cancelled");
  const peso = (s: string) => (s === "published" ? 0 : s === "scheduled" ? 1 : s === "failed" ? 2 : 3);
  const ordenar = (lista: PublicacaoExistente[]) => lista.slice().sort((a, b) => peso(a.status) - peso(b.status));
  return ordenar(vivas.filter((p) => p.platform === "instagram"))[0] || ordenar(vivas)[0] || null;
}

/** O post já saiu do plano (agendado, publicado ou em falha do motor)? Aí a Mesa não troca a arte sozinha. */
function jaNoFluxoDePublicacao(post: PostExistente): boolean {
  return post.publications.some((p) => p.status === "scheduled" || p.status === "published" || p.status === "failed");
}

// ------------------------------------------------------------------ sincronização

/**
 * Decide o que a entrega faz na Agenda e monta o payload de
 * save_editorial_post. Regras:
 * - sem post: cria (chave estável da peça: repetir a entrega não duplica);
 * - post com a mesma arte e a mesma legenda: nada (idempotente);
 * - post ainda editável (sem arquivo ou com arquivo que não entrou na
 *   aprovação): atualiza o MESMO post (arquivos, legenda, tipo, título);
 * - post com arte que já entrou na aprovação (reprovada, por exemplo): nasce
 *   a revisão do mesmo item (revision_of_post_id), que a Agenda trata como a
 *   versão atual; a anterior fica no histórico;
 * - post já agendado, publicado ou com falha do motor: não mexe (bloqueado,
 *   com o motivo), a menos que a arte seja a mesma.
 * As publicações vão sem data (a data só entra quando o dono confirma) e sem
 * delivery_mode/asset_file_ids (o caminho comum da Agenda; o motor publica a
 * capa e as filhas na ordem do carrossel).
 */
export async function planoDaSincronizacao(
  peca: PecaEntregue,
  existente: PostExistente | null,
  opcoes: { conta: ContaDoProjeto | null; arquivoAtualEditavel: boolean },
): Promise<PlanoDaSincronizacao> {
  const fileIds = peca.fileIds.filter(Boolean);
  if (!fileIds.length) return { acao: "bloqueado", motivo: "A entrega não tem arquivos." };
  if (fileIds.length > MAX_MIDIAS_DO_CARROSSEL) {
    return { acao: "bloqueado", motivo: `O Instagram aceita até ${MAX_MIDIAS_DO_CARROSSEL} lâminas por carrossel; esta entrega tem ${fileIds.length}.` };
  }
  const legenda = legendaComHashtags(peca.legenda, peca.hashtags);
  const tipo = tipoDoConteudo(fileIds);
  const titulo = texto(peca.titulo, 300) || "Arte do Estúdio";
  const sementes = sementesDaPeca(peca.trabalhoId, peca.rodada);
  const assinatura = assinaturaDaEntrega(peca);
  const mutationId = await uuidEstavel(sementes.mutacao(assinatura));
  const semConta = opcoes.conta ? null : "O projeto não tem conta do Instagram ligada. O post entrou na Agenda sem publicação: ligue a conta na Agenda para agendar.";

  const novaPublicacao = async (conta: ContaDoProjeto): Promise<{ id: null; idempotency_key: string; external_account_id: string; file_id: null; caption: string | null; first_comment: null; alt_text: null; scheduled_at: string | null; scheduled_timezone: string }> => ({
    id: null,
    idempotency_key: await uuidEstavel(sementes.publicacao(conta.id)),
    external_account_id: conta.id,
    file_id: null,
    caption: legenda,
    first_comment: null,
    alt_text: null,
    scheduled_at: null,
    scheduled_timezone: FUSO_PADRAO,
  });

  const base = {
    client_id: peca.clientId,
    project_id: peca.projectId,
    primary_file_id: fileIds[0],
    title: titulo,
    content_type: tipo,
    default_caption: legenda,
    production_status: "ready",
    task_id: peca.taskId,
    objective: texto(peca.objetivo, 2000) || existente?.objective || null,
    internal_notes: `Entregue pelo Estúdio da Mesa (rodada ${Math.max(1, peca.rodada || 1)}, ${fileIds.length} ${fileIds.length === 1 ? "lâmina" : "lâminas"}).`,
  };

  if (!existente) {
    return {
      acao: "criar",
      motivo: null,
      aviso: semConta,
      expectedVersion: null,
      payload: {
        ...base,
        id: null,
        idempotency_key: await uuidEstavel(sementes.post),
        mutation_id: mutationId,
        responsible_id: null,
        revision_of_post_id: null,
        publications: opcoes.conta ? [await novaPublicacao(opcoes.conta)] : [],
      },
    };
  }

  const mesmaArte = existente.primary_file_id === fileIds[0];
  const mesmaLegenda = (existente.default_caption || null) === legenda;
  if (mesmaArte && mesmaLegenda && existente.content_type === tipo && existente.title === titulo) {
    return { acao: "nada", motivo: "A Agenda já tem esta entrega." };
  }
  if (jaNoFluxoDePublicacao(existente)) {
    if (mesmaArte) return { acao: "nada", motivo: "A publicação já está no fluxo do Instagram; a legenda muda pela Agenda." };
    return {
      acao: "bloqueado",
      motivo: "O post deste item já está agendado ou publicado com outra arte. Desfaça o agendamento na Agenda antes de trocar a arte.",
    };
  }

  // Publicações do plano: as planejadas continuam (mesmo id e chave), com a
  // legenda nova; sem publicação no Instagram e com conta, nasce uma.
  const planejadas = existente.publications.filter((p) => p.status === "planned");
  const reaproveitadas = planejadas.map((p) => ({
    id: p.id,
    idempotency_key: p.idempotency_key,
    external_account_id: p.external_account_id,
    file_id: null,
    caption: legenda,
    first_comment: p.first_comment,
    alt_text: p.alt_text,
    scheduled_at: p.scheduled_at,
    scheduled_timezone: p.scheduled_timezone || FUSO_PADRAO,
  }));

  const podeTrocarNoMesmo = !existente.primary_file_id || mesmaArte || opcoes.arquivoAtualEditavel;
  if (podeTrocarNoMesmo) {
    const publicacoes: Record<string, unknown>[] = reaproveitadas.filter((p) => !!p.idempotency_key);
    const temInstagram = planejadas.some((p) => p.platform === "instagram");
    if (!temInstagram && opcoes.conta) publicacoes.push(await novaPublicacao(opcoes.conta));
    return {
      acao: "atualizar",
      motivo: null,
      aviso: semConta && !temInstagram ? semConta : null,
      expectedVersion: existente.version,
      payload: {
        ...base,
        id: existente.id,
        idempotency_key: existente.internal?.idempotency_key || (await uuidEstavel(sementes.post)),
        mutation_id: mutationId,
        responsible_id: existente.internal?.responsible_id || null,
        revision_of_post_id: existente.internal?.revision_of_post_id || null,
        publications: publicacoes,
      },
    };
  }

  // A arte anterior já entrou na aprovação: a Agenda não troca o arquivo de um
  // post aprovado ou em aprovação. Nasce a revisão do mesmo item, com a mesma
  // conta e a mesma data (se havia), e a anterior vira histórico.
  const anterior = publicacaoDaPeca(planejadas);
  const contaDaRevisao = anterior && anterior.external_account_id
    ? { id: anterior.external_account_id, platform: anterior.platform }
    : opcoes.conta;
  const publicacoes: Record<string, unknown>[] = [];
  if (contaDaRevisao) {
    const p = await novaPublicacao(contaDaRevisao);
    if (anterior && anterior.external_account_id === contaDaRevisao.id) {
      p.scheduled_at = anterior.scheduled_at;
      p.scheduled_timezone = anterior.scheduled_timezone || FUSO_PADRAO;
    }
    publicacoes.push(p);
  }
  return {
    acao: "revisao",
    motivo: null,
    aviso: contaDaRevisao ? null : semConta,
    expectedVersion: null,
    postAnteriorId: existente.id,
    payload: {
      ...base,
      id: null,
      idempotency_key: await uuidEstavel(sementes.post),
      mutation_id: mutationId,
      responsible_id: existente.internal?.responsible_id || null,
      revision_of_post_id: existente.id,
      publications: publicacoes,
    },
  };
}

/**
 * Payload para mudar só a data da publicação da peça (confirmar, reagendar
 * antes da aprovação, desfazer). Reaproveita o post inteiro como está: nada
 * além do horário muda, e sem delivery_mode/asset_file_ids o save segue o
 * caminho comum da Agenda (a publicação continua "planejada"; o promotor do
 * banco agenda quando houver aprovação).
 */
export function payloadComData(
  post: PostExistente,
  publicacaoId: string,
  quando: string | null,
  mutationId: string,
  entrega?: { delivery_mode: "manual" | "automatic"; asset_file_ids: string[] } | null,
): Record<string, unknown> {
  const publicacoes = post.publications
    .filter((p) => p.status === "planned")
    .map((p) => ({
      // Arte já aprovada: o save vai pelo caminho aprovado da Agenda, que com
      // delivery_mode e asset_file_ids congela as lâminas na ordem e agenda.
      ...(entrega && p.id === publicacaoId && quando ? { delivery_mode: entrega.delivery_mode, asset_file_ids: entrega.asset_file_ids.slice(0, MAX_MIDIAS_DO_CARROSSEL) } : {}),
      id: p.id,
      idempotency_key: p.idempotency_key,
      external_account_id: p.external_account_id,
      file_id: p.file_id,
      caption: p.caption,
      first_comment: p.first_comment,
      alt_text: p.alt_text,
      scheduled_at: p.id === publicacaoId ? quando : p.scheduled_at,
      scheduled_timezone: p.scheduled_timezone || FUSO_PADRAO,
    }));
  return {
    id: post.id,
    idempotency_key: post.internal?.idempotency_key || null,
    mutation_id: mutationId,
    client_id: post.client_id,
    project_id: post.project_id,
    primary_file_id: post.primary_file_id,
    title: post.title,
    content_type: post.content_type,
    objective: post.objective,
    default_caption: post.default_caption,
    production_status: post.production_status,
    task_id: post.internal?.task_id || null,
    responsible_id: post.internal?.responsible_id || null,
    internal_notes: post.internal?.internal_notes || null,
    revision_of_post_id: post.internal?.revision_of_post_id || null,
    publications: publicacoes,
  };
}

// ------------------------------------------------------------------ data e hora

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(\d{2}):(\d{2})/;

/**
 * Data e hora sugeridas para "Publicar em": o dia da peça (o do plano) e o
 * melhor horário real do cliente para o tipo quando há métrica; senão o
 * horário fixo do cliente; senão 09:00. Dia que já passou vira hoje; horário
 * de hoje que já passou (com 15 minutos de folga) vira amanhã. Devolve dia e
 * hora locais do fuso do cliente (a tela converte com o fuso).
 */
export function horarioSugerido(a: {
  diaDaPeca: string | null | undefined;
  hoje: string;
  agoraHHMM: string;
  melhorHora?: string | null;
  horaFixa?: string | null;
}): { dia: string; hora: string } {
  const hora = [a.melhorHora, a.horaFixa, "09:00"].map((h) => (h && HORA.test(h) ? h.slice(0, 5) : null)).filter(Boolean)[0] as string;
  const diaPlano = a.diaDaPeca && ISO_LOCAL.test(a.diaDaPeca.slice(0, 10)) ? a.diaDaPeca.slice(0, 10) : a.hoje;
  let dia = diaPlano < a.hoje ? a.hoje : diaPlano;
  if (dia === a.hoje && minutosDoDia(hora) < minutosDoDia(a.agoraHHMM) + 15) dia = somarDias(a.hoje, 1);
  return { dia, hora };
}

function minutosDoDia(hhmm: string): number {
  const m = HORA.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function somarDias(dia: string, n: number): string {
  const m = ISO_LOCAL.exec(dia);
  if (!m) return dia;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  const dois = (x: number) => (x < 10 ? `0${x}` : String(x));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

/** Partes da data e hora locais de um instante num fuso (Intl: Deno, Node e navegador). */
export function partesNoFuso(instante: Date, fuso = FUSO_PADRAO): { dia: string; hora: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(instante)) p[x.type] = x.value;
  const hh = p.hour === "24" ? "00" : p.hour;
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${hh}:${p.minute}` };
}

/** Dia e hora locais do fuso para o instante ISO (UTC). Null quando inválido. */
export function localParaIso(dia: string, hora: string, fuso = FUSO_PADRAO): string | null {
  const d = ISO_LOCAL.exec(dia || "");
  const h = HORA.exec(hora || "");
  if (!d || !h) return null;
  const alvo = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2]));
  // Duas passadas acertam a troca de horário de verão.
  let t = alvo;
  for (let i = 0; i < 2; i++) {
    const p = partesNoFuso(new Date(t), fuso);
    const [a, m, di] = p.dia.split("-").map(Number);
    const [hh, mm] = p.hora.split(":").map(Number);
    t += alvo - Date.UTC(a, m - 1, di, hh, mm);
  }
  return new Date(t).toISOString();
}

/** Confere o horário pedido para publicar. Null = ok; senão a frase do problema. */
export function problemaNoHorario(iso: string | null | undefined, agora: Date, opcoes: { agoraMesmo?: boolean } = {}): string | null {
  if (!iso) return "Escolha a data e o horário.";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Data ou horário inválido.";
  if (opcoes.agoraMesmo) return null;
  if (t < agora.getTime() + ANTECEDENCIA_MIN * MIN) return "Escolha um horário pelo menos 2 minutos à frente.";
  if (t > agora.getTime() + 400 * 24 * 60 * MIN) return "Escolha uma data dentro dos próximos 12 meses.";
  return null;
}

// ------------------------------------------------------------------ regra de publicação

export type MotivoDaRegra =
  | "sem_aprovacao"
  | "sem_data"
  | "aprovado_depois_do_horario"
  | "passou_da_janela"
  | "publica";

/**
 * Espelho da regra do banco (promotor + mesa_publicacao_segurada + motor):
 * - sem aprovação do cliente: nunca publica;
 * - sem data confirmada: não publica;
 * - aprovação depois do horário (mais que a folga): só publica, logo após a
 *   aprovação, quando o dono marcou "publicar assim que aprovar";
 * - no prazo: publica no horário (ou no minuto seguinte, se o horário já
 *   chegou), dentro da janela do promotor.
 */
export function regraDePublicacao(a: {
  aprovadoEm: string | null;
  quando: string | null;
  confirmado: boolean;
  publicarAoAprovar: boolean;
  agora: Date;
}): { publica: boolean; quando: string | null; motivo: MotivoDaRegra } {
  if (!a.aprovadoEm) return { publica: false, quando: null, motivo: "sem_aprovacao" };
  if (!a.quando || !a.confirmado) return { publica: false, quando: null, motivo: "sem_data" };
  const horario = Date.parse(a.quando);
  const aprovado = Date.parse(a.aprovadoEm);
  const agora = a.agora.getTime();
  const logo = new Date(Math.max(horario, agora + PUBLICAR_AGORA_EM_MIN * MIN)).toISOString();
  if (aprovado > horario + FOLGA_DE_ATRASO_MIN * MIN) {
    if (!a.publicarAoAprovar) return { publica: false, quando: null, motivo: "aprovado_depois_do_horario" };
    return { publica: true, quando: new Date(Math.max(agora, aprovado) + PUBLICAR_AGORA_EM_MIN * MIN).toISOString(), motivo: "publica" };
  }
  if (horario < agora - JANELA_DO_PROMOTOR_H * 60 * MIN) return { publica: false, quando: null, motivo: "passou_da_janela" };
  return { publica: true, quando: logo, motivo: "publica" };
}

// ------------------------------------------------------------------ estado para a tela

export type CodigoDoEstado =
  | "fora_da_agenda"
  | "rascunho"
  | "aguardando_aprovacao"
  | "ajuste_pedido"
  | "aprovado_sem_data"
  | "aprovado_depois_do_horario"
  | "agendado"
  | "publicando"
  | "publicado"
  | "falhou";

export type TomDoEstado = "neutro" | "andamento" | "ok" | "alerta" | "erro";

export interface EstadoDaPublicacao {
  codigo: CodigoDoEstado;
  rotulo: string;
  tom: TomDoEstado;
  detalhe: string | null;
  /** Data e hora que valem (a da publicação ou a proposta). */
  quando: string | null;
  link: string | null;
}

export interface EntradaDoEstado {
  trabalho: {
    status?: string | null;
    entrega_status?: string | null;
    entrega_aviso?: string | null;
    post_id?: string | null;
    publicar_em?: string | null;
    publicar_em_confirmado_em?: string | null;
    publicar_ao_aprovar?: boolean | null;
    agenda_aviso?: string | null;
    aprovado_em?: string | null;
    /** Pedidos de ajuste do cliente (SQL EA-01, seção 5). */
    ajustes_do_cliente?: unknown;
  };
  publicacao: { status: string; scheduled_at: string | null; published_at?: string | null; permalink?: string | null } | null;
  /** Estado do motor (autopublish_status_secure): etapa e último erro. */
  motor?: { stage: string; last_error: string | null; permalink?: string | null } | null;
  agora: Date;
  /** Formata data e hora para a frase (a tela passa o formato dela). */
  formatar?: (iso: string) => string;
}

const formatoPadrao = (iso: string) => {
  const d = new Date(iso);
  const dois = (x: number) => (x < 10 ? `0${x}` : String(x));
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
};

/**
 * Estado da peça do ponto de vista da publicação, com a frase curta que a
 * Entrega e a Agenda mostram: aguardando aprovação → aprovado, agendado para
 * dd/mm hh:mm → publicado (com link) ou falhou: motivo.
 */
export function estadoDaPublicacao(e: EntradaDoEstado): EstadoDaPublicacao {
  const f = e.formatar || formatoPadrao;
  const t = e.trabalho;
  const p = e.publicacao;
  const quandoPub = p?.scheduled_at || null;
  // A Mesa só grava horário na publicação quando o dono confirma (e a Agenda,
  // quando a equipe agenda por lá): data na publicação = data confirmada.
  const confirmado = !!quandoPub;
  const quando = quandoPub || t.publicar_em || null;
  const aprovado = t.entrega_status === "aprovado" || t.entrega_status === "agendado" || p?.status === "scheduled" || p?.status === "published";

  if (p?.status === "published") {
    const link = p.permalink || e.motor?.permalink || null;
    return { codigo: "publicado", rotulo: "publicado", tom: "ok", detalhe: p.published_at ? `Publicado ${f(p.published_at)}.` : "Publicado.", quando: p.published_at || quando, link };
  }
  if (p?.status === "failed" || e.motor?.stage === "failed") {
    const motivo = e.motor?.last_error || "O Instagram recusou a publicação.";
    return { codigo: "falhou", rotulo: "falhou", tom: "erro", detalhe: `Falhou: ${motivo}`, quando, link: null };
  }
  if (e.motor && e.motor.stage !== "done" && e.motor.stage !== "cancelled") {
    return { codigo: "publicando", rotulo: "publicando", tom: "andamento", detalhe: "Publicando no Instagram agora.", quando, link: null };
  }
  if (p?.status === "scheduled" && quandoPub) {
    return { codigo: "agendado", rotulo: "agendado", tom: "ok", detalhe: `Aprovado, agendado para ${f(quandoPub)}.`, quando: quandoPub, link: null };
  }
  if (t.entrega_status === "reprovado") {
    // Reprovado e entregue de novo: o ajuste foi feito, falta reenviar ao cliente.
    if (t.status === "entregue") {
      return { codigo: "rascunho", rotulo: "nova versão", tom: "alerta", detalhe: "Ajuste feito. Falta enviar ao cliente.", quando, link: null };
    }
    const pedido = pedidoDeAjustePendente(t.ajustes_do_cliente);
    const texto = pedido?.texto || t.entrega_aviso || null;
    const lamina = pedido?.lamina ?? laminaCitada(texto);
    const onde = lamina ? ` (lâmina ${lamina})` : "";
    return { codigo: "ajuste_pedido", rotulo: "ajuste pedido", tom: "erro", detalhe: texto ? `Ajuste pedido pelo cliente${onde}: "${texto}"` : `Ajuste pedido pelo cliente${onde}.`, quando, link: null };
  }
  if (!t.post_id) {
    if (t.status !== "entregue") return { codigo: "fora_da_agenda", rotulo: "sem post", tom: "neutro", detalhe: null, quando: null, link: null };
    return { codigo: "fora_da_agenda", rotulo: "fora da Agenda", tom: "alerta", detalhe: t.agenda_aviso || "A entrega ainda não entrou na Agenda.", quando: null, link: null };
  }
  if (aprovado) {
    if (!confirmado || !quandoPub) {
      return { codigo: "aprovado_sem_data", rotulo: "aprovado", tom: "alerta", detalhe: "Aprovado. Confirme a data para agendar.", quando, link: null };
    }
    const regra = regraDePublicacao({
      aprovadoEm: t.aprovado_em || new Date(e.agora.getTime()).toISOString(),
      quando: quandoPub,
      confirmado: true,
      publicarAoAprovar: !!t.publicar_ao_aprovar,
      agora: e.agora,
    });
    if (!regra.publica) {
      return { codigo: "aprovado_depois_do_horario", rotulo: "nova data", tom: "alerta", detalhe: "Aprovado depois do horário. Escolha uma nova data.", quando: quandoPub, link: null };
    }
    return { codigo: "agendado", rotulo: "agendado", tom: "ok", detalhe: `Aprovado, agendado para ${f(regra.quando || quandoPub)}.`, quando: quandoPub, link: null };
  }
  const aguardando = t.entrega_status === "aguardando_cliente" || t.entrega_status === "aguardando_agencia";
  if (aguardando) {
    const data = confirmado && quandoPub ? ` Publica em ${f(quandoPub)}.` : " Data a confirmar.";
    return { codigo: "aguardando_aprovacao", rotulo: "com o cliente", tom: "andamento", detalhe: `Aguardando aprovação do cliente.${data}`, quando, link: null };
  }
  return {
    codigo: "rascunho",
    rotulo: "na Agenda",
    tom: "neutro",
    detalhe: confirmado && quandoPub ? `Na Agenda para ${f(quandoPub)}. Falta enviar ao cliente.` : "Na Agenda. Falta enviar ao cliente.",
    quando,
    link: null,
  };
}

/** Uma linha do histórico da peça na Agenda (o trabalho guarda as últimas MAX_HISTORICO). */
export function comHistorico(historico: unknown, linha: Record<string, unknown>): Record<string, unknown>[] {
  const lista = Array.isArray(historico) ? (historico as Record<string, unknown>[]) : [];
  return lista.concat([linha]).slice(-MAX_HISTORICO);
}

// ------------------------------------------------------------------ ajuste pedido pelo cliente

/** Um pedido de ajuste do cliente guardado na peça (SQL EA-01, seção 5). */
export interface AjusteDoCliente {
  evento_id?: string;
  texto: string | null;
  lamina: number | null;
  pedido_em?: string | null;
  rodada?: number | null;
  atendido_em?: string | null;
  atendido_por?: string | null;
  atendido_na_rodada?: number | null;
}

const PADRAO_DA_LAMINA = /(?:l[aâ]mina|slide|card|imagem|tela|p[aá]gina)\s*(?:n[ºo°]?\.?\s*)?(\d{1,2})/;
const PADRAO_DA_CAPA = /(^|[^a-zà-ú])capa([^a-zà-ú]|$)/;

/**
 * Lâmina citada no pedido ("Lâmina 3: ...", "no slide 2", "a capa"): regra
 * fixa, a mesma de mesa_lamina_citada no banco. Null quando não cita.
 */
export function laminaCitada(texto: string | null | undefined): number | null {
  const t = String(texto || "").toLowerCase();
  if (!t) return null;
  const m = PADRAO_DA_LAMINA.exec(t);
  if (m) {
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }
  return PADRAO_DA_CAPA.test(t) ? 1 : null;
}

/** Lista de pedidos lida do banco (tolerante: qualquer coisa que não for lista vira vazio). */
export function ajustesDoCliente(bruto: unknown): AjusteDoCliente[] {
  if (!Array.isArray(bruto)) return [];
  return (bruto as Record<string, unknown>[])
    .filter((x) => !!x && typeof x === "object")
    .map((x) => ({
      evento_id: typeof x.evento_id === "string" ? x.evento_id : undefined,
      texto: typeof x.texto === "string" && x.texto.trim() ? x.texto.trim() : null,
      lamina: typeof x.lamina === "number" && x.lamina > 0 ? x.lamina : laminaCitada(typeof x.texto === "string" ? x.texto : null),
      pedido_em: typeof x.pedido_em === "string" ? x.pedido_em : null,
      rodada: typeof x.rodada === "number" ? x.rodada : null,
      atendido_em: typeof x.atendido_em === "string" ? x.atendido_em : null,
      atendido_por: typeof x.atendido_por === "string" ? x.atendido_por : null,
      atendido_na_rodada: typeof x.atendido_na_rodada === "number" ? x.atendido_na_rodada : null,
    }));
}

/** O pedido do cliente que ainda não foi atendido (o mais recente). */
export function pedidoDeAjustePendente(bruto: unknown): AjusteDoCliente | null {
  const lista = ajustesDoCliente(bruto).filter((a) => !a.atendido_em);
  return lista.length ? lista[lista.length - 1] : null;
}

/**
 * Reentrega depois do ajuste: todo pedido pendente vira atendido (quem, quando
 * e em que rodada). Devolve a lista inteira, pronta para gravar (o histórico
 * dos pedidos fica).
 */
export function marcarAjustesAtendidos(bruto: unknown, a: { em: string; por: string; rodada: number }): Record<string, unknown>[] {
  const lista = Array.isArray(bruto) ? (bruto as Record<string, unknown>[]) : [];
  return lista.map((x) =>
    x && typeof x === "object" && !x.atendido_em ? { ...x, atendido_em: a.em, atendido_por: a.por, atendido_na_rodada: a.rodada } : x
  );
}

/**
 * Endereço que abre o Estúdio no MESMO trabalho (pela tarefa), na lâmina do
 * pedido quando há, com o pedido do cliente pronto no campo de ajuste.
 */
export function linkDoAjusteNoEstudio(clientId: string, taskId: string, lamina: number | null | undefined): string {
  return `/mesa?client=${clientId}&aba=estudio&task=${taskId}&ajuste=cliente${lamina ? `&lamina=${lamina}` : ""}`;
}

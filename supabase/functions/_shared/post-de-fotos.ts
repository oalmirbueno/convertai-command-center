/**
 * Post de fotos na Agenda (frente MF, 27/09).
 *
 * Pedido do dono: "no mesa fotos ter uma opção preparar carrossel na agenda e
 * selecionar as fotos ai ele ja tem a ferramenta de legenda", "gerar na agenda
 * e ja ir com as fotos para publicar e enviar para aprovação", "a mesma
 * lógica das artes".
 *
 * Decisão (lida no código da frente EA): a foto vira peça do MESMO fluxo das
 * artes do Estúdio. Um post de fotos é um trabalho do estúdio
 * (estudio_trabalhos, tipo 'social', sem SQL novo) marcado com
 * `direcao.so_fotos = true`, em que cada lâmina É uma foto do acervo: a versão
 * 1 da lâmina aponta para a própria foto no bucket mesa (nada é gerado nem
 * redesenhado; a foto real fica intacta). Com isso valem, sem caminho novo:
 * - a legenda do Estúdio (ação `legenda` da estudio-arte, com hashtags);
 * - a entrega em Arquivos (`entregar`: pai e filhas, sha256, pasta materiais)
 *   e o post da Agenda criado na hora (frente EA), com o "Publicar em";
 * - a aprovação da agência e do cliente (mesa_enviar_para_aprovacao), o
 *   pedido de ajuste do cliente, os avisos e a publicação pelo ciclo do banco
 *   (só publica aprovado e com data confirmada).
 *
 * O que muda é só a origem das lâminas e a trava: post de fotos não gera
 * arte (a estudio-arte recusa gerar, ajustar e corrigir lâmina dele).
 *
 * Sem import de Deno nem de npm: a tela, as funções (estudio-arte, mesa-foto
 * e agente-calendario) e os testes (vitest) leem o mesmo arquivo. A parte que
 * grava usa um cliente mínimo do Supabase (o de verdade serve; o dos testes
 * também).
 */

// ------------------------------------------------------------------ constantes

/** Marca do trabalho do estúdio que é post de fotos (direcao.so_fotos). */
export const MARCA_SO_FOTOS = "so_fotos";
/** Carrossel do Instagram: até 10 mídias. */
export const MAX_FOTOS_NO_POST = 10;
/** Acima disto (lado maior), a lâmina usa a cópia média do painel (2048 px) para a entrega caber no tempo da função. */
export const LADO_MAXIMO_NA_ENTREGA = 2048;
export const SUFIXO_DA_MEDIA = ".media.jpg";
/** Maior arquivo copiado de outro bucket para o bucket mesa. */
export const MAX_BYTES_DA_COPIA = 25 * 1024 * 1024;

/** Formatos do feed que servem para foto (stories fica de fora: post de feed). */
export const FORMATOS_DO_POST_DE_FOTOS = ["feed_4x5", "retrato_3x4", "quadrado_1x1"] as const;
export type FormatoDoPostDeFotos = (typeof FORMATOS_DO_POST_DE_FOTOS)[number];
export const FORMATO_PADRAO_DO_POST_DE_FOTOS: FormatoDoPostDeFotos = "feed_4x5";
export const ROTULO_DO_FORMATO_DE_FOTOS: Record<FormatoDoPostDeFotos, string> = {
  feed_4x5: "4:5 feed",
  retrato_3x4: "3:4 retrato",
  quadrado_1x1: "1:1 quadrado",
};
/** Largura dividida pela altura (a moldura da tela mostra o recorte que vai ao ar). */
export const PROPORCAO_DO_FORMATO_DE_FOTOS: Record<FormatoDoPostDeFotos, number> = {
  feed_4x5: 0.8,
  retrato_3x4: 0.75,
  quadrado_1x1: 1,
};

/**
 * Formato do perfil do cliente (dono, 27/09: "quando qualquer cliente quiser
 * só fotos no perfil a gente faz só fotos por ali, ou alternar a gente usa as
 * duas mesas"). Mora em mesa_cliente_config.formato_do_perfil (SQL MF-01);
 * sem valor, é "artes" (o que sempre foi).
 */
export const FORMATOS_DO_PERFIL = ["fotos", "artes", "alternar"] as const;
export type FormatoDoPerfil = (typeof FORMATOS_DO_PERFIL)[number];
export const ROTULO_DO_PERFIL: Record<FormatoDoPerfil, string> = {
  fotos: "Só fotos",
  artes: "Só artes",
  alternar: "Alternar fotos e artes",
};
export const DICA_DO_PERFIL: Record<FormatoDoPerfil, string> = {
  fotos: "Todo post do mês é de fotos, feito na Mesa Foto.",
  artes: "Todo post do mês é arte, feito no Estúdio de design.",
  alternar: "O plano mistura: cada post vai para a mesa que combina com ele.",
};

/** Mesa que produz um item do plano. */
export const MESAS_DO_ITEM = ["foto", "arte"] as const;
export type MesaDoItem = (typeof MESAS_DO_ITEM)[number];
export const ROTULO_DA_MESA_DO_ITEM: Record<MesaDoItem, string> = { foto: "Mesa Foto", arte: "Estúdio de design" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const semTravessao = (s: string) => s.replace(/\s*[\u2014\u2013]\s*/g, ", ");

// ------------------------------------------------------------------ leitura cuidadosa

export function formatoDoPostDeFotos(v: unknown): FormatoDoPostDeFotos {
  return (FORMATOS_DO_POST_DE_FOTOS as readonly string[]).indexOf(String(v)) >= 0 ? (v as FormatoDoPostDeFotos) : FORMATO_PADRAO_DO_POST_DE_FOTOS;
}

export function formatoDoPerfil(v: unknown): FormatoDoPerfil {
  return (FORMATOS_DO_PERFIL as readonly string[]).indexOf(String(v)) >= 0 ? (v as FormatoDoPerfil) : "artes";
}

/** O trabalho do estúdio é um post de fotos? (JSON do banco, lido com cuidado.) */
export function ehPostDeFotos(direcao: unknown): boolean {
  return !!direcao && typeof direcao === "object" && (direcao as Record<string, unknown>)[MARCA_SO_FOTOS] === true;
}

/** Mesa do item pelo trabalho dele: post de fotos é da Mesa Foto; o resto, do Estúdio. */
export function mesaDoTrabalho(t: { direcao?: unknown } | null | undefined): MesaDoItem {
  return t && ehPostDeFotos(t.direcao) ? "foto" : "arte";
}

// ------------------------------------------------------------------ as fotos

/** O que o post precisa de cada foto do acervo (cliente_imagens). */
export type FotoDoPost = {
  id: string;
  storage_bucket: string | null;
  storage_path: string;
  nome: string;
  largura?: number | null;
  altura?: number | null;
  gerada?: boolean | null;
  aprovada?: boolean | null;
  ativa?: boolean | null;
  tags?: string[] | null;
  descricao?: string | null;
};

export type FotoRecusada = { id: string; nome: string; motivo: string };

/** Referência da internet ou marcada para não publicar: uso interno, nunca vai ao ar. */
export const fotoSoDeUsoInterno = (f: Pick<FotoDoPost, "tags">) => (f.tags || []).some((t) => t === "nao_publicar" || t === "referencia_web");

/** Por que a foto não entra no post (null: entra). */
export function motivoParaFicarDeFora(f: FotoDoPost): string | null {
  if (f.ativa === false) return "Esta foto está arquivada.";
  if (fotoSoDeUsoInterno(f)) return "Referência da internet é uso interno: não vai ao ar.";
  if (!f.storage_path) return "A foto não tem arquivo.";
  return null;
}

/** Foto gerada entra no rascunho, mas só vai ao cliente depois da aprovação da equipe. */
export const precisaDaEquipe = (f: Pick<FotoDoPost, "gerada" | "aprovada">) => !!f.gerada && f.aprovada !== true;

/**
 * As fotos do post na ordem pedida (sem repetir), no máximo MAX_FOTOS_NO_POST.
 * Id que não é do cliente vira recusa "não está no acervo".
 */
export function fotosDoPost(pedidas: string[], lidas: FotoDoPost[]): { fotos: FotoDoPost[]; recusadas: FotoRecusada[]; acima: number } {
  const porId = new Map(lidas.map((f) => [f.id, f]));
  const vistas: string[] = [];
  const fotos: FotoDoPost[] = [];
  const recusadas: FotoRecusada[] = [];
  let acima = 0;
  for (const bruto of pedidas) {
    const id = String(bruto || "").trim();
    if (!UUID.test(id) || vistas.indexOf(id) >= 0) continue;
    vistas.push(id);
    const f = porId.get(id);
    if (!f) {
      recusadas.push({ id, nome: "foto", motivo: "Esta foto não está no acervo do cliente." });
      continue;
    }
    const motivo = motivoParaFicarDeFora(f);
    if (motivo) {
      recusadas.push({ id, nome: umaLinha(f.nome, 120) || "foto", motivo });
      continue;
    }
    if (fotos.length >= MAX_FOTOS_NO_POST) {
      acima++;
      continue;
    }
    fotos.push(f);
  }
  return { fotos, recusadas, acima };
}

/** Onde fica o arquivo que a lâmina usa: a própria foto, a cópia média do painel ou uma cópia no bucket mesa. */
export type CaminhoDaLamina = { caminho: string; como: "foto" | "media" | "copia" };

/**
 * Plano do caminho de cada foto (a busca da cópia média e a cópia em si são
 * de quem grava): foto do bucket mesa na pasta do cliente vai como está;
 * grande demais (lado maior acima de 2048) prefere a cópia média; de outro
 * bucket, uma cópia sem mexer nos pixels vai para a pasta do post.
 */
export function planoDoCaminho(f: FotoDoPost, clientId: string, trabalhoId: string, ordem: number): { preferido: CaminhoDaLamina; reserva: CaminhoDaLamina | null } {
  const bucket = f.storage_bucket || "mesa";
  const doCliente = bucket === "mesa" && f.storage_path.indexOf(`${clientId}/`) === 0;
  if (!doCliente) {
    const ext = (/\.(png|jpe?g|webp)$/i.exec(f.storage_path) || ["", "png"])[1].toLowerCase().replace("jpeg", "jpg");
    return { preferido: { caminho: `${clientId}/foto/posts/${trabalhoId}/${ordem}-${f.id}.${ext}`, como: "copia" }, reserva: null };
  }
  const lado = Math.max(Number(f.largura) || 0, Number(f.altura) || 0);
  if (lado > LADO_MAXIMO_NA_ENTREGA) {
    return { preferido: { caminho: `${f.storage_path}${SUFIXO_DA_MEDIA}`, como: "media" }, reserva: { caminho: f.storage_path, como: "foto" } };
  }
  return { preferido: { caminho: f.storage_path, como: "foto" }, reserva: null };
}

// ------------------------------------------------------------------ o trabalho

/** Frase de contexto do post (a legenda do Estúdio lê o conceito): o título e o que cada foto mostra. */
export function conceitoDoPost(titulo: string, fotos: FotoDoPost[]): string {
  const partes = fotos.map((f, i) => {
    const d = umaLinha(f.descricao, 160) || umaLinha(f.nome, 80);
    return `${i + 1}) ${d}${f.gerada ? " (imagem gerada)" : ""}`;
  });
  const base = `Post de fotos da Mesa Foto (sem arte, sem texto na imagem): ${umaLinha(titulo, 160) || "post"}.`;
  return semTravessao(`${base}${partes.length ? ` Fotos: ${partes.join("; ")}.` : ""}`).slice(0, 1500);
}

/**
 * Direção do trabalho do post de fotos. Uma lâmina por foto, sem texto: a
 * lâmina só serve para a ordem e para a entrega. O que a direção anterior
 * tinha fora das lâminas (reaberturas, histórico) fica.
 */
export function direcaoDoPostDeFotos(p: {
  titulo: string;
  formato: FormatoDoPostDeFotos;
  fotos: FotoDoPost[];
  anterior?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const anterior = p.anterior && typeof p.anterior === "object" ? p.anterior : {};
  const direcao: Record<string, unknown> = {
    ...(anterior.reaberturas ? { reaberturas: anterior.reaberturas } : {}),
    [MARCA_SO_FOTOS]: true,
    conceito: conceitoDoPost(p.titulo, p.fotos),
    carrossel_infinito: false,
    fotos: { imagem_ids: p.fotos.map((f) => f.id) },
    cards: p.fotos.map((f, i) => ({
      ordem: i + 1,
      funcao: i === 0 ? "capa" : "foto",
      texto_exato: "",
      composicao: "Foto real do acervo, sem texto e sem arte por cima.",
      ilustracao: "",
      prompt_imagem: "",
      imagens_ids: [f.id],
    })),
  };
  // O 4:5 fica sem o campo, como no Estúdio.
  if (p.formato !== FORMATO_PADRAO_DO_POST_DE_FOTOS) direcao.formato = p.formato;
  return direcao;
}

/** Versão 1 de cada lâmina: a foto (nada é gerado). O formato é o do conjunto, para a entrega aceitar. */
export function versoesDoPost(p: { fotos: FotoDoPost[]; caminhos: CaminhoDaLamina[]; formato: FormatoDoPostDeFotos; userId: string; agora?: string }): Record<string, unknown>[] {
  const agora = p.agora || new Date().toISOString();
  return p.fotos.map((f, i) => {
    const c = p.caminhos[i] || { caminho: f.storage_path, como: "foto" as const };
    const v: Record<string, unknown> = {
      ordem: i + 1,
      versao: 1,
      storage_path: c.caminho,
      origem: "foto",
      imagem_id: f.id,
      formato_post: p.formato,
      verificacao: { pendente: false, foto_real: true, texto_lido: null, ortografia_ok: null, identidade: null },
      custo_usd: 0,
      uso_ids: [],
      criado_em: agora,
      criado_por: p.userId,
    };
    if (c.como === "foto" && f.largura && f.altura) v.tamanho = `${f.largura}x${f.altura}`;
    return v;
  });
}

/**
 * As fotos ainda podem mudar? Enquanto não foi para a aprovação (ou depois de
 * um pedido de ajuste do cliente). Com a aprovação correndo, aprovado,
 * agendado ou publicado: não (a peça aprovada é imutável).
 */
export function podeTrocarAsFotos(t: { status?: string | null; entrega_status?: string | null }): boolean {
  const e = t.entrega_status || null;
  if (e === "reprovado") return true;
  if (e === "aguardando_agencia" || e === "aguardando_cliente" || e === "aprovado" || e === "agendado" || e === "precisa_de_atencao") return false;
  return true;
}

/** Trabalho de arte que ainda não tem nada gerado nem entregue (o plano cria a direção sozinho): pode virar post de fotos. */
export function artePodeVirarFotos(t: { status?: string | null; cards?: unknown; file_ids?: unknown; entrega_status?: string | null }): boolean {
  const cards = Array.isArray(t.cards) ? t.cards : [];
  const arquivos = Array.isArray(t.file_ids) ? t.file_ids : [];
  return !cards.length && !arquivos.length && !t.entrega_status && t.status !== "entregue" && t.status !== "gerando";
}

// ------------------------------------------------------------------ estado para a tela

export type TomDoPost = "neutro" | "andamento" | "ok" | "alerta" | "erro";

export type EstadoDoPostDeFotos = { codigo: string; rotulo: string; tom: TomDoPost; proximo: string };

/** Em que pé o post está, em palavras curtas, e o próximo passo. */
export function estadoDoPostDeFotos(t: {
  status?: string | null;
  entrega_status?: string | null;
  cards?: unknown;
  file_ids?: unknown;
  legenda?: string | null;
  publicar_em?: string | null;
  publicar_em_confirmado_em?: string | null;
}, publicacao?: { status?: string | null } | null): EstadoDoPostDeFotos {
  const cards = Array.isArray(t.cards) ? t.cards : [];
  const arquivos = Array.isArray(t.file_ids) ? t.file_ids : [];
  if (publicacao && publicacao.status === "published") return { codigo: "publicado", rotulo: "no ar", tom: "ok", proximo: "Publicado no Instagram." };
  if (publicacao && publicacao.status === "failed") return { codigo: "falhou", rotulo: "falhou ao publicar", tom: "erro", proximo: "Abra Publicar em e tente de novo." };
  switch (t.entrega_status) {
    case "aguardando_agencia":
      return { codigo: "agencia", rotulo: "revisão da agência", tom: "andamento", proximo: "A agência revisa antes de ir ao cliente." };
    case "aguardando_cliente":
      return { codigo: "cliente", rotulo: "com o cliente", tom: "andamento", proximo: "Esperando a aprovação do cliente." };
    case "aprovado":
      return { codigo: "aprovado", rotulo: "aprovado", tom: "ok", proximo: t.publicar_em_confirmado_em ? "Publica sozinho na data confirmada." : "Confirme a data em Publicar em." };
    case "agendado":
      return { codigo: "agendado", rotulo: "agendado", tom: "ok", proximo: "Vai ao ar sozinho no horário." };
    case "precisa_de_atencao":
      return { codigo: "atencao", rotulo: "precisa de atenção", tom: "erro", proximo: "Veja o aviso na Entrega da Mesa." };
    case "reprovado":
      return { codigo: "ajuste", rotulo: "ajuste pedido", tom: "erro", proximo: "Troque as fotos ou a legenda e envie de novo." };
    default:
      break;
  }
  if (!cards.length) return { codigo: "sem_fotos", rotulo: "sem fotos", tom: "neutro", proximo: "Escolha as fotos do post." };
  if (t.status === "entregue" && arquivos.length) return { codigo: "falta_enviar", rotulo: "falta enviar", tom: "alerta", proximo: "Envie para o cliente aprovar." };
  if (!String(t.legenda || "").trim()) return { codigo: "falta_legenda", rotulo: "falta a legenda", tom: "alerta", proximo: "Escreva a legenda." };
  return { codigo: "pronto", rotulo: "pronto para enviar", tom: "alerta", proximo: "Confira a data e envie para o cliente aprovar." };
}

// ------------------------------------------------------------------ endereços

/** Etapa do post na Mesa Foto, já com o item e o trabalho. */
export function linkDoPostNaMesaFoto(clientId: string, alvo: { taskId?: string | null; trabalhoId?: string | null } = {}): string {
  const partes = [`/mesa-foto?client=${clientId}`, "etapa=agenda"];
  if (alvo.taskId && UUID.test(alvo.taskId)) partes.push(`task=${alvo.taskId}`);
  if (alvo.trabalhoId && UUID.test(alvo.trabalhoId)) partes.push(`trabalho=${alvo.trabalhoId}`);
  return partes.join("&");
}

/** O item da Agenda abre na mesa certa: post de fotos na Mesa Foto, arte no Estúdio. */
export function linkDaMesaDoItem(clientId: string, taskId: string, mesa: MesaDoItem, mes?: string | null): string {
  if (mesa === "foto") return linkDoPostNaMesaFoto(clientId, { taskId });
  return `/mesa?client=${clientId}&aba=estudio&task=${taskId}${mes ? `&mes=${mes}` : ""}`;
}

// ------------------------------------------------------------------ gravação

/** Cliente mínimo do Supabase (o de verdade serve; o dos testes também). */
// deno-lint-ignore no-explicit-any
export type BancoDoPost = { from: (tabela: string) => any; storage: { from: (bucket: string) => any } };

export class ErroDoPost extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const CAMPOS_DA_FOTO = "id, client_id, storage_bucket, storage_path, nome, largura, altura, gerada, aprovada, ativa, tags, descricao";

export type TrabalhoLido = {
  id: string;
  client_id: string;
  task_id: string | null;
  tipo?: string | null;
  status: string;
  direcao: Record<string, unknown>;
  cards: unknown[];
  file_ids: string[];
  entrega_status?: string | null;
  entrega_rodada?: number | null;
  legenda?: string | null;
  atualizado_em: string;
};

/** Escolhe o trabalho do item que vira (ou já é) o post de fotos. Lança ErroDoPost com o motivo. */
export function trabalhoParaAsFotos(trabalhos: TrabalhoLido[], pedido: string | null): { alvo: TrabalhoLido | null; converte: boolean } {
  const sociais = trabalhos.filter((t) => (t.tipo || "social") === "social");
  if (pedido) {
    const t = sociais.find((x) => x.id === pedido);
    if (!t) throw new ErroDoPost(404, "post_inexistente", "Este post de fotos não é deste item da agenda.");
    if (!ehPostDeFotos(t.direcao) && !artePodeVirarFotos(t)) throw new ErroDoPost(409, "item_com_arte", "Este item já tem arte no Estúdio. Escolha outro item ou crie um novo.");
    return { alvo: t, converte: !ehPostDeFotos(t.direcao) };
  }
  const deFotos = sociais.find((t) => ehPostDeFotos(t.direcao));
  if (deFotos) return { alvo: deFotos, converte: false };
  const comArte = sociais.find((t) => !artePodeVirarFotos(t));
  if (comArte) throw new ErroDoPost(409, "item_com_arte", "Este item já tem arte no Estúdio. Escolha outro item ou crie um novo.");
  const vazio = sociais[0] || null;
  return { alvo: vazio, converte: !!vazio };
}

async function existeNoMesa(db: BancoDoPost, caminho: string): Promise<boolean> {
  const i = caminho.lastIndexOf("/");
  const pasta = caminho.slice(0, i);
  const nome = caminho.slice(i + 1);
  try {
    const { data } = await db.storage.from("mesa").list(pasta, { limit: 20, search: nome });
    return Array.isArray(data) && data.some((o: { name?: string }) => o && o.name === nome);
  } catch {
    return false;
  }
}

async function copiarParaOMesa(db: BancoDoPost, f: FotoDoPost, destino: string): Promise<boolean> {
  try {
    const { data, error } = await db.storage.from(f.storage_bucket || "mesa").download(f.storage_path);
    if (error || !data) return false;
    const bytes = new Uint8Array(await (data as Blob).arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES_DA_COPIA) return false;
    const tipo = (data as Blob).type || (destino.endsWith(".png") ? "image/png" : destino.endsWith(".webp") ? "image/webp" : "image/jpeg");
    const r = await db.storage.from("mesa").upload(destino, new Blob([bytes], { type: tipo }), { contentType: tipo, upsert: true });
    return !r.error;
  } catch {
    return false;
  }
}

/** Resolve o arquivo de cada lâmina (cópia média quando existe; cópia no bucket mesa quando a foto mora fora). */
export async function caminhosDasLaminas(db: BancoDoPost, fotos: FotoDoPost[], clientId: string, trabalhoId: string): Promise<{ caminhos: CaminhoDaLamina[]; avisos: string[] }> {
  const avisos: string[] = [];
  const caminhos: CaminhoDaLamina[] = [];
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i];
    const plano = planoDoCaminho(f, clientId, trabalhoId, i + 1);
    if (plano.preferido.como === "media") {
      caminhos.push(await existeNoMesa(db, plano.preferido.caminho) ? plano.preferido : (plano.reserva as CaminhoDaLamina));
      continue;
    }
    if (plano.preferido.como === "copia") {
      if (await copiarParaOMesa(db, f, plano.preferido.caminho)) caminhos.push(plano.preferido);
      else throw new ErroDoPost(502, "foto_indisponivel", `Não foi possível ler "${umaLinha(f.nome, 80)}" no armazenamento.`);
      continue;
    }
    caminhos.push(plano.preferido);
  }
  if (caminhos.some((c) => c.como === "foto") && fotos.some((f) => Math.max(Number(f.largura) || 0, Number(f.altura) || 0) > LADO_MAXIMO_NA_ENTREGA)) {
    avisos.push("Foto muito grande sem cópia leve: a entrega pode sair em partes (clique em Entregar de novo).");
  }
  // O Instagram publica JPEG e PNG: WebP vai ao post como está e pode ser recusado na hora de publicar.
  if (caminhos.some((c) => /\.webp$/i.test(c.caminho))) {
    avisos.push("Há foto em WebP no post: o Instagram pode recusar. Prefira a versão em JPEG ou PNG (Ampliar fiel ou Luz e cor geram uma).");
  }
  return { caminhos, avisos };
}

export type EntradaDoPost = {
  clientId: string;
  taskId: string;
  titulo: string;
  formato?: unknown;
  imagemIds: string[];
  userId: string;
  /** Trabalho escolhido na tela (o post já existente); sem ele, o do item. */
  trabalhoId?: string | null;
};

export type PostPreparado = {
  trabalho: TrabalhoLido;
  criado: boolean;
  convertido: boolean;
  recusadas: FotoRecusada[];
  avisos: string[];
  sem_aprovacao_da_equipe: number;
};

/**
 * Cria ou atualiza o post de fotos do item da agenda com as fotos pedidas, na
 * ordem. Sem custo: nada é gerado. O acesso ao cliente e a leitura do item são
 * de quem chama (o item precisa ser do cliente e de formato de post).
 */
export async function prepararPostDeFotos(db: BancoDoPost, e: EntradaDoPost): Promise<PostPreparado> {
  if (!UUID.test(e.clientId) || !UUID.test(e.taskId)) throw new ErroDoPost(400, "pedido_invalido", "Cliente ou item da agenda inválido.");
  const formato = formatoDoPostDeFotos(e.formato);
  const [trabalhosRes, fotosRes] = await Promise.all([
    db.from("estudio_trabalhos").select("id, client_id, task_id, tipo, status, direcao, cards, file_ids, entrega_status, entrega_rodada, legenda, atualizado_em")
      .eq("client_id", e.clientId).eq("task_id", e.taskId).order("criado_em", { ascending: false }).limit(10),
    db.from("cliente_imagens").select(CAMPOS_DA_FOTO).eq("client_id", e.clientId).in("id", e.imagemIds.filter((x) => UUID.test(String(x))).slice(0, 40)),
  ]);
  if (trabalhosRes.error) throw new ErroDoPost(503, "trabalho_indisponivel", "Não foi possível ler o item no Estúdio.");
  if (fotosRes.error) throw new ErroDoPost(503, "acervo_indisponivel", "Não foi possível ler as fotos do acervo.");
  const trabalhos = ((trabalhosRes.data as TrabalhoLido[] | null) || []).map((t) => ({
    ...t,
    direcao: t.direcao && typeof t.direcao === "object" ? t.direcao : {},
    cards: Array.isArray(t.cards) ? t.cards : [],
    file_ids: Array.isArray(t.file_ids) ? t.file_ids : [],
  }));
  const { alvo, converte } = trabalhoParaAsFotos(trabalhos, e.trabalhoId && UUID.test(e.trabalhoId) ? e.trabalhoId : null);
  if (alvo && !podeTrocarAsFotos(alvo)) {
    throw new ErroDoPost(409, "post_em_aprovacao", "Este post já foi para a aprovação. Espere a resposta do cliente (ou o pedido de ajuste) para trocar as fotos.");
  }
  const { fotos, recusadas, acima } = fotosDoPost(e.imagemIds, (fotosRes.data as FotoDoPost[] | null) || []);
  if (!fotos.length) {
    throw new ErroDoPost(400, "sem_fotos", recusadas.length ? `Nenhuma foto pôde entrar: ${recusadas[0].motivo}` : "Escolha ao menos uma foto do acervo.");
  }
  const avisos: string[] = [];
  if (acima) avisos.push(`O carrossel leva até ${MAX_FOTOS_NO_POST} fotos: ${acima} ${acima === 1 ? "ficou" : "ficaram"} de fora.`);
  const trabalhoId = alvo ? alvo.id : crypto.randomUUID();
  const lidos = await caminhosDasLaminas(db, fotos, e.clientId, trabalhoId);
  avisos.push(...lidos.avisos);
  const direcao = direcaoDoPostDeFotos({ titulo: e.titulo, formato, fotos, anterior: alvo ? alvo.direcao : null });
  const cards = versoesDoPost({ fotos, caminhos: lidos.caminhos, formato, userId: e.userId });
  const patch: Record<string, unknown> = { direcao, cards, status: "pronto" };
  // Já entregue em Arquivos (e ainda não enviado): como o "reabrir" do Estúdio, a
  // rodada sobe e a próxima entrega vira arquivo novo com as fotos novas. Depois
  // de um pedido de ajuste o banco já subiu a rodada e voltou para "pronto".
  if (alvo && alvo.status === "entregue") {
    const rodada = Math.max(1, Number(alvo.entrega_rodada) || 1);
    patch.entrega_rodada = rodada + 1;
    const anteriores = Array.isArray(alvo.direcao.reaberturas) ? (alvo.direcao.reaberturas as unknown[]) : [];
    direcao.reaberturas = anteriores.concat([{
      em: new Date().toISOString(),
      por: e.userId,
      motivo: "Fotos trocadas na Mesa Foto",
      rodada_anterior: rodada,
      file_ids: alvo.file_ids,
      entrega_status: alvo.entrega_status || null,
      versoes: [],
    }]).slice(-20);
  }
  let gravado: TrabalhoLido | null = null;
  if (alvo) {
    const { data, error } = await db.from("estudio_trabalhos").update(patch).eq("id", alvo.id).eq("atualizado_em", alvo.atualizado_em).select("*").maybeSingle();
    if (error) throw new ErroDoPost(503, "gravacao_falhou", "Não foi possível gravar o post de fotos.");
    if (!data) throw new ErroDoPost(409, "conflito_de_gravacao", "O post mudou enquanto isso. Tente de novo.");
    gravado = data as TrabalhoLido;
  } else {
    const { data, error } = await db.from("estudio_trabalhos").insert({
      id: trabalhoId,
      client_id: e.clientId,
      task_id: e.taskId,
      tipo: "social",
      ...patch,
      modelo_imagem_id: null,
      qualidade: null,
      custo_usd: 0,
      criado_por: e.userId,
    }).select("*").single();
    if (error || !data) throw new ErroDoPost(503, "gravacao_falhou", "Não foi possível criar o post de fotos.");
    gravado = data as TrabalhoLido;
  }
  return {
    trabalho: gravado,
    criado: !alvo,
    convertido: converte,
    recusadas,
    avisos,
    sem_aprovacao_da_equipe: fotos.filter(precisaDaEquipe).length,
  };
}

/**
 * Post de fotos vazio para o item do plano (agente do Mês, formato do perfil):
 * nasce "dirigido", sem lâminas; a Mesa Foto mostra "falta escolher as fotos".
 * Idempotente: item que já tem trabalho não ganha outro.
 */
export async function reservarPostDeFotos(db: BancoDoPost, e: { clientId: string; taskId: string; titulo: string; userId: string; formato?: unknown }): Promise<{ trabalho_id: string | null; criado: boolean }> {
  const { data } = await db.from("estudio_trabalhos").select("id, direcao").eq("client_id", e.clientId).eq("task_id", e.taskId).limit(5);
  const lista = (data as { id: string; direcao: unknown }[] | null) || [];
  if (lista.length) {
    const deFotos = lista.find((t) => ehPostDeFotos(t.direcao));
    return { trabalho_id: deFotos ? deFotos.id : null, criado: false };
  }
  const direcao = direcaoDoPostDeFotos({ titulo: e.titulo, formato: formatoDoPostDeFotos(e.formato), fotos: [] });
  const { data: criado, error } = await db.from("estudio_trabalhos").insert({
    client_id: e.clientId,
    task_id: e.taskId,
    tipo: "social",
    status: "dirigido",
    direcao,
    cards: [],
    custo_usd: 0,
    criado_por: e.userId,
  }).select("id").single();
  if (error || !criado) return { trabalho_id: null, criado: false };
  return { trabalho_id: String((criado as { id: string }).id), criado: true };
}

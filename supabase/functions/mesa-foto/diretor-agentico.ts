/**
 * Diretor de fotografia agêntico da Mesa Foto (pedido do dono, 26/09: "o
 * diretor não é agente; simplesmente tem que ser agêntico também"). Regras
 * puras: o pacote de contexto do cliente com apelidos, as ações que ele
 * propõe (sem custo e de geração paga), a execução item a item e a leitura
 * por visão guardada. A parte de banco, armazenamento e IA fica em diretor.ts.
 *
 * 1. Contexto automático: ao abrir (ou trocar de cliente ou de etapa) o
 *    servidor monta o pacote do cliente sem IA (fotos, clones e as fotos de
 *    cada um, prompts da biblioteca, books, produtos, modelos, campanhas, a
 *    etapa e a seleção da tela). Cada coisa ganha um apelido: fotos i1..,
 *    clones c1.., prompts p1.., books b1.., produtos k1.., modelos m1..,
 *    campanhas cp1... O modelo nunca vê nem devolve UUID.
 * 2. O diretor propõe, a equipe confirma: `acoes` (sem custo: aprovar,
 *    arquivar, organizar, mandar para campanha, aprovar e mandar para
 *    Arquivos, trocar as fotos do clone, montar book, levar ao Canvas) e
 *    `geracoes` (pagas: fotos do clone, variações de uma foto, fotos a partir
 *    de um prompt da biblioteca ou no book). Cada foto a gerar vira um item
 *    g1..gN com o custo estimado antes do Confirmar.
 * 3. Só a confirmação executa, item a item, com as ações que a Mesa Foto já
 *    tem (com o JWT de quem confirmou). Desfazer: o gerado vai para o
 *    arquivo (apagar é arquivar), a foto trocada do clone volta.
 * 4. Leitura por visão: uma vez por imagem, guardada em JSON no Storage do
 *    cliente (mesa/<cliente>/foto/leituras/<imagem>.json). Foto já lida não
 *    é lida de novo.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type CaminhoDoAgente,
  caminhoSeguro,
  type Alvo,
  type AlvoComApelido,
  apelidoDoTipo,
  blocoDosAlvos,
  esquemaDasAcoes,
  type ItemDaAcaoDoAgente,
  normalizarAcaoDoAgente,
  type RecusaDoItem,
  type RegraDaOperacao,
  type ResultadoDoItem,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { type CampanhaParaFotos, DESCRICOES_DO_ACERVO, ehReferenciaDaInternet, regrasDoAcervo } from "../_shared/acoes-do-acervo.ts";
import { type CampanhaDaMesaFoto, campanhasComApelido } from "./acoes-da-mesa-foto.ts";
import { linkDoPostNaMesaFoto } from "../_shared/post-de-fotos.ts";
import { type ItemReferivel } from "../_shared/conversa-das-mesas.ts";
import { PAPEIS, PAPEIS_DE_EVIDENCIA } from "./receitas.ts";

// ------------------------------------------------------------------ constantes

export const AGENTE_SEM_CUSTO = "diretor";
export const AGENTE_DE_GERACAO = "diretor_geracao";

export const ETAPAS_DO_DIRETOR = ["acervo", "kits", "criar", "ensaio", "campanha", "preparar", "revisar", "aprovar", "usar", "biblioteca", "modelos", "clones", "book", "canvas", "estudio", "agenda"] as const;

// Nomes da linha de produção da tela (frente FTL, 30/09): os mesmos termos simples em todo lugar.
export const ROTULO_DA_ETAPA: Record<string, string> = {
  acervo: "Fotos",
  kits: "Produto",
  criar: "O que fazer",
  ensaio: "Fotos do produto",
  campanha: "Foto com modelo",
  preparar: "Tirar fundo e ajustes",
  revisar: "Comparar com as fontes",
  aprovar: "Aprovar",
  usar: "Usar",
  biblioteca: "Biblioteca",
  modelos: "Modelos",
  clones: "Clones",
  book: "Book",
  canvas: "Canvas",
  estudio: "Estúdio de fotos",
  agenda: "Post na Agenda",
};

export const OPERACOES_SEM_CUSTO = [
  "aprovar_foto",
  "arquivar_foto",
  "mover_foto",
  "marcar_foto",
  "tirar_marca",
  "mandar_para_campanha",
  "aprovar_e_enviar",
  "fotos_do_clone",
  "montar_book",
  "levar_ao_canvas",
  // Frente MF (27/09): a foto entra num post de fotos na Agenda (sem gerar) e o atalho para o Estúdio de fotos.
  "post_na_agenda",
  "abrir_no_estudio",
  // Frente AG2 (29/09): o produto (kit) e o ensaio pelas ações que a Mesa Foto já tem (kit_salvar e agente_aplicar).
  "renomear_kit",
  "fotos_do_kit",
  "montar_ensaio",
];

export const OPERACOES_DE_GERACAO = ["gerar_clone", "variar_imagem", "gerar_do_prompt", "gerar_no_book", "melhorar_foto"];

/** Prefixo de apelido que cada geração aceita. */
export const ALVO_DA_GERACAO: Record<string, string> = { gerar_clone: "c", variar_imagem: "i", gerar_do_prompt: "p", gerar_no_book: "b", melhorar_foto: "i" };

export const ROTULO_DA_GERACAO: Record<string, string> = {
  gerar_clone: "foto do clone",
  variar_imagem: "variação",
  gerar_do_prompt: "foto do prompt",
  gerar_no_book: "foto do book",
  melhorar_foto: "foto melhorada",
};

/**
 * Modos do "melhorar_foto" (os do Preparar, que já existem no servidor): a
 * derivada nasce no acervo e o original não muda. Nunca escurece a foto.
 */
export const MODOS_DO_MELHORAR = ["luz_cor", "limpar", "fundo_branco", "fundo_transparente", "cenario"] as const;
export const ROTULO_DO_MODO_DO_MELHORAR: Record<string, string> = {
  luz_cor: "luz e cor",
  limpar: "limpar",
  fundo_branco: "fundo branco",
  fundo_transparente: "tirar fundo",
  cenario: "novo cenário",
};

/**
 * Trava contra loucura (dono, 27/09: "de forma inteligente pra não cometer
 * loucuras"): geração paga só vai sozinha (sem o clique de Confirmar) com
 * ordem clara, custo conhecido até este teto, poucas fotos e saldo. Acima,
 * o cartão pede Confirmar com o custo à vista. O dono pode parar no meio.
 */
export const TETO_SEM_CONFIRMAR_USD = 0.4;
export const MAX_FOTOS_SEM_CONFIRMAR = 4;

/** Fotos por pedido (cada uma é uma geração paga) e por linha da resposta. */
export const MAX_FOTOS_POR_PEDIDO = 16;
export const MAX_FOTOS_POR_LINHA = 8;
/** Linhas de `geracoes` lidas por resposta (as de depois contam como fora do limite, com aviso). */
export const MAX_LINHAS_DE_GERACAO = 24;
/** Leituras por visão feitas numa mensagem (as outras ficam para a próxima). */
export const MAX_LEITURAS_POR_MENSAGEM = 4;
export const MAX_FOTOS_NO_PACOTE = 60;
/** Item em andamento há mais que isso volta a poder ser executado (a chamada caiu). */
export const JANELA_DO_ANDAMENTO_MS = 10 * 60 * 1000;
export const FORMATOS_DO_DIRETOR = ["4:5", "1:1", "9:16", "16:9"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const semTravessao = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
const idOuNulo = (v: unknown): string | null => (typeof v === "string" && UUID.test(v.trim()) ? v.trim() : null);
const ids = (v: unknown, max: number): string[] => {
  if (!Array.isArray(v)) return [];
  const saida: string[] = [];
  for (const x of v) {
    const id = idOuNulo(x);
    if (id && saida.indexOf(id) < 0) saida.push(id);
    if (saida.length >= max) break;
  }
  return saida;
};

// ------------------------------------------------------------------ foco da tela

/** O que está aberto na tela do dono: a etapa e a seleção (a tela manda em todo pedido). */
export type FocoDoDiretor = {
  etapa: string;
  kit_id: string | null;
  ensaio_id: string | null;
  clone_id: string | null;
  persona_id: string | null;
  book_id: string | null;
  canvas_id: string | null;
  /** Fotos marcadas na tela (acervo, variações do clone): vão primeiro no pacote. */
  imagem_ids: string[];
  prompt_ids: string[];
};

export function lerFoco(bruto: unknown): FocoDoDiretor {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const etapa = String(r.etapa ?? "");
  return {
    etapa: (ETAPAS_DO_DIRETOR as readonly string[]).indexOf(etapa) >= 0 ? etapa : "acervo",
    kit_id: idOuNulo(r.kit_id),
    ensaio_id: idOuNulo(r.ensaio_id),
    clone_id: idOuNulo(r.clone_id),
    persona_id: idOuNulo(r.persona_id),
    book_id: idOuNulo(r.book_id),
    canvas_id: idOuNulo(r.canvas_id),
    imagem_ids: ids(r.imagem_ids, 24),
    prompt_ids: ids(r.prompt_ids, 12),
  };
}

/** Chave estável do foco (para o cache curto do pacote). */
export const chaveDoFoco = (f: FocoDoDiretor) =>
  [f.etapa, f.kit_id, f.ensaio_id, f.clone_id, f.persona_id, f.book_id, f.canvas_id, f.imagem_ids.join(","), f.prompt_ids.join(",")].join("|");

// ------------------------------------------------------------------ o que o servidor leu

export type ImagemBruta = {
  id: string;
  nome: string;
  pasta?: string | null;
  tags?: string[] | null;
  ativa?: boolean | null;
  aprovada?: boolean | null;
  origem?: string | null;
  gerada?: boolean | null;
  modo?: string | null;
  kit_id?: string | null;
  descricao?: string | null;
  criado_em?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
};

export type CloneBruto = {
  id: string;
  nome: string;
  status?: string | null;
  identidade_real?: { imagem_id: string; principal?: boolean }[] | null;
  autorizacao_ok: boolean;
  motivo_autorizacao?: string | null;
};

export type PromptBruto = { id: string; titulo: string; categoria?: string | null; client_id?: string | null; prompt_pt?: string | null; prompt_en?: string | null };
export type BookBruto = { id: string; nome: string; status?: string | null; assunto?: { tipo?: string; id?: string; nome?: string } | null };
export type KitBruto = { id: string; nome: string; variante?: string | null; status?: string | null; refs?: { imagem_id: string; papel: string }[] | null };
export type PersonaBruta = { id: string; nome: string; status?: string | null };
/** Post de fotos da Agenda (trabalho do estúdio com direcao.so_fotos) que ainda aceita fotos. */
export type PostBruto = { trabalho_id: string; task_id: string; titulo: string; data: string | null; fotos: number; estado: string };

export type LeituraGuardada = {
  descricao: string;
  observado: string[];
  texto_lido: string;
  lida_em: string;
};

export type EntradaDoPacote = {
  clientId: string;
  cliente: string;
  foco: FocoDoDiretor;
  imagens: ImagemBruta[];
  clones: CloneBruto[];
  prompts: PromptBruto[];
  books: BookBruto[];
  kits: KitBruto[];
  personas: PersonaBruta[];
  campanhas: CampanhaDaMesaFoto[];
  /** Posts de fotos na Agenda que ainda aceitam fotos (frente MF). */
  posts?: PostBruto[];
  /** Leituras guardadas já baixadas (id da imagem -> leitura). */
  leituras: Record<string, LeituraGuardada>;
  /** Imagens com leitura guardada no Storage (nomes da pasta), baixada ou não. */
  lidasNoStorage: string[];
  /** Resumo do contexto consolidado (marca, dossiê, cérebro), só para a tela. */
  contexto?: { marca?: string | null; cerebro?: boolean; dossie?: boolean; campanha?: string | null } | null;
};

// ------------------------------------------------------------------ alvos com apelido

export type DadosDaImagem = {
  pasta: string;
  tags: string[];
  aprovada: boolean;
  origem: string;
  gerada: boolean;
  ativa: boolean;
  clone_id: string | null;
  kit_id: string | null;
  modo: string | null;
  lida: boolean;
  selecionada: boolean;
  pessoa_real: boolean;
  leitura: string | null;
  /** FN-05: arquivo JPEG (sem alfa), então nunca é recorte. Só o código lê (não vai ao modelo). */
  jpeg?: boolean;
};
export type AlvoDaImagem = Alvo & { dados: DadosDaImagem };
export type AlvoDoClone = Alvo & { dados: { status: string; autorizacao_ok: boolean; motivo: string | null; reais: string[]; aberto: boolean } };
export type AlvoDoPrompt = Alvo & { dados: { texto: string; categoria: string } };
export type AlvoDoBook = Alvo & { dados: { status: string; assunto_tipo: string; assunto_id: string | null } };
export type AlvoSimples = Alvo & { dados: { status: string } };
/** Produto (kit) com as fotos de referência (id e papel), para trocar foto e renomear sem reler o banco. */
export type AlvoDoKit = Alvo & { dados: { status: string; nome: string; variante: string | null; refs: { imagem_id: string; papel: string }[] } };
export type AlvoDoPost = Alvo & { dados: { task_id: string; data: string | null; fotos: number } };

export type PacoteDoDiretor = {
  client_id: string;
  cliente: string;
  foco: FocoDoDiretor;
  imagens: Array<AlvoComApelido<AlvoDaImagem>>;
  clones: Array<AlvoComApelido<AlvoDoClone>>;
  prompts: Array<AlvoComApelido<AlvoDoPrompt>>;
  books: Array<AlvoComApelido<AlvoDoBook>>;
  kits: Array<AlvoComApelido<AlvoDoKit>>;
  personas: Array<AlvoComApelido<AlvoSimples>>;
  campanhas: CampanhaParaFotos[];
  /** Posts de fotos na Agenda com apelido a1..aN (frente MF). */
  posts: Array<AlvoComApelido<AlvoDoPost>>;
  /** Imagens que a próxima mensagem vai ler por visão (ids, no máximo 4). */
  sem_leitura: string[];
  contagens: { fotos: number; clones: number; prompts: number; books: number; kits: number; modelos: number; lidas: number; posts?: number };
  resumo: string;
  foco_rotulo: string;
  contexto: { marca: string | null; cerebro: boolean; dossie: boolean; campanha: string | null };
};

const cloneDaImagem = (tags: string[]) => {
  const t = tags.find((x) => x.indexOf("clone:") === 0);
  return t ? idOuNulo(t.slice(6)) : null;
};

/** A imagem já tem leitura? JSON guardado, ou foto real lida pelo "Ler foto" do acervo (tags papel:/tipo:). */
export function imagemJaLida(img: ImagemBruta, guardadas: { has: (id: string) => boolean }): boolean {
  if (guardadas.has(img.id)) return true;
  const tags = img.tags || [];
  return !img.gerada && tags.some((t) => t.indexOf("papel:") === 0 || t.indexOf("tipo:") === 0);
}

function classeDaImagem(i: ImagemBruta): string {
  const tags = i.tags || [];
  if (ehReferenciaDaInternet({ tags, origem: String(i.origem || "") })) return "referência da internet (uso interno)";
  if (i.gerada) return "gerada";
  if (tags.indexOf("sem_fundo") >= 0) return "tratada";
  return "original";
}

/**
 * Ordem das fotos no pacote: as marcadas na tela, as do clone aberto (fotos
 * de origem e variações), as do book aberto e o resto, das mais novas às mais
 * antigas. Só as ativas (arquivada não é trabalhada).
 */
export function ordenarImagens(imagens: ImagemBruta[], foco: FocoDoDiretor, clones: CloneBruto[]): ImagemBruta[] {
  const cloneAberto = foco.clone_id ? clones.find((c) => c.id === foco.clone_id) || null : null;
  const reaisDoAberto = cloneAberto ? (cloneAberto.identidade_real || []).map((r) => r.imagem_id) : [];
  const peso = (i: ImagemBruta) => {
    const tags = i.tags || [];
    const s = foco.imagem_ids.indexOf(i.id);
    if (s >= 0) return s;
    if (cloneAberto && (reaisDoAberto.indexOf(i.id) >= 0 || tags.indexOf(`clone:${cloneAberto.id}`) >= 0)) return 100;
    if (foco.book_id && tags.indexOf(`book:${foco.book_id}`) >= 0) return 200;
    if (foco.kit_id && i.kit_id === foco.kit_id) return 300;
    return 1000;
  };
  const vistas = new Set<string>();
  return imagens
    .filter((i) => {
      if (!i || !UUID.test(String(i.id)) || vistas.has(i.id) || i.ativa === false) return false;
      vistas.add(i.id);
      return true;
    })
    .map((i, k) => ({ i, k, p: peso(i) }))
    .sort((a, b) => a.p - b.p || String(b.i.criado_em || "").localeCompare(String(a.i.criado_em || "")) || a.k - b.k)
    .map((x) => x.i);
}

/** Monta o pacote do cliente. Sem IA, sem banco: tudo o que o servidor leu entra aqui. */
export function montarPacote(e: EntradaDoPacote): PacoteDoDiretor {
  const foco = e.foco;
  const guardadas = new Set<string>(e.lidasNoStorage.concat(Object.keys(e.leituras || {})));
  const ordenadas = ordenarImagens(e.imagens, foco, e.clones).slice(0, MAX_FOTOS_NO_PACOTE);
  const nomeDoClone = new Map(e.clones.map((c) => [c.id, c.nome]));

  const imagens: Array<AlvoComApelido<AlvoDaImagem>> = ordenadas.map((i, k) => {
    const tags = (i.tags || []).map(String);
    const clone = cloneDaImagem(tags);
    const leitura = e.leituras && e.leituras[i.id] ? e.leituras[i.id] : null;
    const lida = imagemJaLida(i, guardadas);
    const textoDaLeitura = leitura ? leitura.descricao : lida && i.descricao ? String(i.descricao) : null;
    const reais = e.clones.filter((c) => (c.identidade_real || []).some((r) => r.imagem_id === i.id)).map((c) => c.nome);
    const detalhe = [
      classeDaImagem(i),
      i.aprovada ? "aprovada" : i.gerada ? "a aprovar" : "",
      clone ? `do clone ${nomeDoClone.get(clone) || ""}`.trim() : "",
      reais.length ? `foto de origem de ${reais.join(", ")}` : "",
      i.pasta ? `pasta ${i.pasta}` : "",
      foco.imagem_ids.indexOf(i.id) >= 0 ? "marcada na tela" : "",
      textoDaLeitura ? `leitura: ${umaLinha(textoDaLeitura, 150)}` : !lida && i.descricao ? `descrição: ${umaLinha(i.descricao, 110)}` : "",
    ].filter(Boolean).join("; ");
    return {
      id: i.id,
      titulo: umaLinha(i.nome || "foto", 120),
      detalhe,
      ref: `i${k + 1}`,
      dados: {
        pasta: String(i.pasta || ""),
        tags,
        aprovada: !!i.aprovada,
        origem: String(i.origem || ""),
        gerada: !!i.gerada,
        ativa: i.ativa !== false,
        clone_id: clone,
        kit_id: i.kit_id || null,
        modo: i.modo || null,
        lida,
        selecionada: foco.imagem_ids.indexOf(i.id) >= 0,
        pessoa_real: tags.indexOf("pessoa_real_autorizada") >= 0,
        leitura: textoDaLeitura ? umaLinha(textoDaLeitura, 400) : null,
        jpeg: ehArquivoJpeg(i.storage_path),
      },
    };
  });
  const refDaImagem = new Map(imagens.map((i) => [i.id, i.ref]));

  const clonesOrdenados = e.clones.slice().sort((a, b) => Number(b.id === foco.clone_id) - Number(a.id === foco.clone_id));
  const clones: Array<AlvoComApelido<AlvoDoClone>> = clonesOrdenados.slice(0, 30).map((c, k) => {
    const reais = (c.identidade_real || []).map((r) => r.imagem_id).filter((x) => UUID.test(String(x)));
    const variacoes = imagens.filter((i) => i.dados.clone_id === c.id).length;
    const refs = reais.map((id) => refDaImagem.get(id)).filter(Boolean);
    return {
      id: c.id,
      titulo: umaLinha(c.nome, 120),
      detalhe: [
        c.id === foco.clone_id ? "aberto na tela" : "",
        c.status || "",
        c.autorizacao_ok ? "autorização válida" : `sem gerar: ${c.motivo_autorizacao || "autorização inválida"}`,
        refs.length ? `fotos de origem ${refs.join(", ")}` : `${reais.length} fotos de origem`,
        variacoes ? `${variacoes} variações na lista` : "",
      ].filter(Boolean).join("; "),
      ref: `c${k + 1}`,
      dados: { status: String(c.status || ""), autorizacao_ok: !!c.autorizacao_ok, motivo: c.motivo_autorizacao || null, reais, aberto: c.id === foco.clone_id },
    };
  });

  const promptsOrdenados = e.prompts.slice().sort((a, b) => Number(foco.prompt_ids.indexOf(b.id) >= 0) - Number(foco.prompt_ids.indexOf(a.id) >= 0));
  const prompts: Array<AlvoComApelido<AlvoDoPrompt>> = promptsOrdenados.slice(0, 30).map((p, k) => ({
    id: p.id,
    titulo: umaLinha(p.titulo, 120),
    detalhe: [p.categoria || "", p.client_id ? "do cliente" : "da agência", foco.prompt_ids.indexOf(p.id) >= 0 ? "marcado na tela" : ""].filter(Boolean).join("; "),
    ref: `p${k + 1}`,
    dados: { texto: String(p.prompt_pt || p.prompt_en || "").slice(0, 3000), categoria: String(p.categoria || "") },
  }));

  const booksOrdenados = e.books.slice().sort((a, b) => Number(b.id === foco.book_id) - Number(a.id === foco.book_id));
  const books: Array<AlvoComApelido<AlvoDoBook>> = booksOrdenados.slice(0, 20).map((b, k) => ({
    id: b.id,
    titulo: umaLinha(b.nome, 120),
    detalhe: [b.id === foco.book_id ? "aberto na tela" : "", b.assunto && b.assunto.tipo ? `de ${b.assunto.tipo}${b.assunto.nome ? ` ${b.assunto.nome}` : ""}` : "", b.status || ""].filter(Boolean).join("; "),
    ref: `b${k + 1}`,
    dados: { status: String(b.status || "aberto"), assunto_tipo: String((b.assunto && b.assunto.tipo) || ""), assunto_id: idOuNulo(b.assunto && b.assunto.id) },
  }));

  const kitsOrdenados = e.kits.slice().sort((a, b) => Number(b.id === foco.kit_id) - Number(a.id === foco.kit_id));
  const kits: Array<AlvoComApelido<AlvoDoKit>> = kitsOrdenados.slice(0, 20).map((k, n) => {
    const refs = (Array.isArray(k.refs) ? k.refs : []).filter((r) => r && UUID.test(String(r.imagem_id))).map((r) => ({ imagem_id: String(r.imagem_id), papel: String(r.papel || "identidade") }));
    // AG2: as fotos do produto com o apelido da foto (o diretor troca a foto sem ver id).
    const naLista = refs.map((r) => (refDaImagem.get(r.imagem_id) ? `${refDaImagem.get(r.imagem_id)} ${r.papel}` : "")).filter(Boolean);
    const fora = refs.length - naLista.length;
    return {
      id: k.id,
      titulo: umaLinha(`${k.nome}${k.variante ? ` (${k.variante})` : ""}`, 140),
      detalhe: [
        k.id === foco.kit_id ? "aberto na tela" : "",
        k.status || "",
        naLista.length ? `fotos ${naLista.join(", ")}${fora ? ` e mais ${fora}` : ""}` : refs.length ? `${refs.length} fotos` : "sem fotos",
      ].filter(Boolean).join("; "),
      ref: `k${n + 1}`,
      dados: { status: String(k.status || ""), nome: umaLinha(k.nome, 120), variante: k.variante ? umaLinha(k.variante, 120) : null, refs },
    };
  });

  const personasOrdenadas = e.personas.slice().sort((a, b) => Number(b.id === foco.persona_id) - Number(a.id === foco.persona_id));
  const personas: Array<AlvoComApelido<AlvoSimples>> = personasOrdenadas.slice(0, 20).map((p, n) => ({
    id: p.id,
    titulo: umaLinha(p.nome, 120),
    detalhe: [p.id === foco.persona_id ? "aberta na tela" : "", "pessoa sintética", p.status || ""].filter(Boolean).join("; "),
    ref: `m${n + 1}`,
    dados: { status: String(p.status || "") },
  }));

  const campanhas = campanhasComApelido(e.campanhas || [], "cp");
  const posts: Array<AlvoComApelido<AlvoDoPost>> = (e.posts || []).filter((x) => UUID.test(String(x.trabalho_id)) && UUID.test(String(x.task_id))).slice(0, 20).map((x, n) => ({
    id: x.trabalho_id,
    titulo: umaLinha(x.titulo || "Post de fotos", 120),
    detalhe: [x.data ? `dia ${x.data.split("-").reverse().join("/")}` : "", x.fotos ? `${x.fotos} ${x.fotos === 1 ? "foto" : "fotos"}` : "sem fotos", x.estado || ""].filter(Boolean).join("; "),
    ref: `a${n + 1}`,
    dados: { task_id: x.task_id, data: x.data, fotos: x.fotos },
  }));
  const sem_leitura = paraLer({ imagens, foco }, [], MAX_LEITURAS_POR_MENSAGEM);
  const contexto = {
    marca: (e.contexto && e.contexto.marca) || null,
    cerebro: !!(e.contexto && e.contexto.cerebro),
    dossie: !!(e.contexto && e.contexto.dossie),
    campanha: (e.contexto && e.contexto.campanha) || null,
  };
  const pacote: PacoteDoDiretor = {
    client_id: e.clientId,
    cliente: e.cliente,
    foco,
    imagens,
    clones,
    prompts,
    books,
    kits,
    personas,
    campanhas,
    posts,
    sem_leitura,
    contagens: {
      fotos: imagens.length,
      clones: clones.length,
      prompts: prompts.length,
      books: books.length,
      kits: kits.length,
      modelos: personas.length,
      lidas: imagens.filter((i) => i.dados.lida).length,
      posts: posts.length,
    },
    resumo: "",
    foco_rotulo: "",
    contexto,
  };
  pacote.foco_rotulo = rotuloDoFoco(pacote);
  pacote.resumo = resumoDoPacote(pacote);
  return pacote;
}

/** "Clones: Ana aberto, 2 fotos marcadas". */
export function rotuloDoFoco(p: Pick<PacoteDoDiretor, "foco" | "clones" | "books" | "kits" | "personas">): string {
  const f = p.foco;
  const partes: string[] = [ROTULO_DA_ETAPA[f.etapa] || "Mesa Foto"];
  const clone = f.clone_id ? p.clones.find((c) => c.id === f.clone_id) : null;
  const book = f.book_id ? p.books.find((b) => b.id === f.book_id) : null;
  const kit = f.kit_id ? p.kits.find((k) => k.id === f.kit_id) : null;
  const persona = f.persona_id ? p.personas.find((m) => m.id === f.persona_id) : null;
  if (f.etapa === "clones" && clone) partes.push(`${clone.titulo} aberto`);
  else if (f.etapa === "book" && book) partes.push(`${book.titulo} aberto`);
  else if (f.etapa === "modelos" && persona) partes.push(`${persona.titulo} aberta`);
  else if (kit) partes.push(kit.titulo);
  if (f.imagem_ids.length) partes.push(`${f.imagem_ids.length} ${f.imagem_ids.length === 1 ? "foto marcada" : "fotos marcadas"}`);
  return partes.join(", ");
}

/** Linha curta do que o diretor já conhece (cabeçalho da lateral). */
export function resumoDoPacote(p: PacoteDoDiretor): string {
  const c = p.contagens;
  const partes = [
    `${c.fotos} ${c.fotos === 1 ? "foto" : "fotos"}`,
    c.clones ? `${c.clones} ${c.clones === 1 ? "clone" : "clones"}` : "",
    c.books ? `${c.books} ${c.books === 1 ? "book" : "books"}` : "",
    c.kits ? `${c.kits} ${c.kits === 1 ? "produto" : "produtos"}` : "",
    c.posts ? `${c.posts} ${c.posts === 1 ? "post" : "posts"} na Agenda` : "",
    p.contexto.marca || p.contexto.cerebro || p.contexto.dossie ? "marca e histórico" : "",
  ].filter(Boolean);
  return partes.join(" · ");
}

/**
 * Fotos que a mensagem lê por visão (uma vez por imagem): as anexadas, as
 * marcadas e, com um clone aberto, as variações mais novas dele. Só as que
 * ainda não têm leitura, no máximo `max`.
 */
export function paraLer(p: { imagens: Array<AlvoComApelido<AlvoDaImagem>>; foco: FocoDoDiretor }, anexos: string[], max = MAX_LEITURAS_POR_MENSAGEM): string[] {
  const porId = new Map(p.imagens.map((i) => [i.id, i]));
  const candidatos: string[] = [];
  const somar = (id: string) => {
    if (candidatos.indexOf(id) < 0) candidatos.push(id);
  };
  anexos.forEach(somar);
  p.foco.imagem_ids.forEach(somar);
  if (p.foco.clone_id) p.imagens.filter((i) => i.dados.clone_id === p.foco.clone_id && i.dados.gerada).forEach((i) => somar(i.id));
  return candidatos
    .filter((id) => {
      const i = porId.get(id);
      return !!i && !i.dados.lida && i.dados.ativa && !ehReferenciaDaInternet({ tags: i.dados.tags, origem: i.dados.origem });
    })
    .slice(0, Math.max(0, max));
}

/** Leitura vinda do leitor (ou do JSON guardado), só com os campos conhecidos. */
export function normalizarLeitura(bruto: unknown, agora = new Date().toISOString()): LeituraGuardada | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const descricao = umaLinha(r.descricao, 1000);
  if (!descricao) return null;
  return {
    descricao,
    observado: (Array.isArray(r.observado) ? r.observado : []).map((x) => umaLinha(x, 200)).filter(Boolean).slice(0, 20),
    texto_lido: typeof r.texto_lido === "string" ? r.texto_lido.slice(0, 2000) : "",
    lida_em: typeof r.lida_em === "string" && r.lida_em ? r.lida_em.slice(0, 40) : agora,
  };
}

export const pastaDasLeituras = (clientId: string) => `${clientId}/foto/leituras`;
export const caminhoDaLeitura = (clientId: string, imagemId: string) => `${pastaDasLeituras(clientId)}/${imagemId}.json`;

/** Ids das imagens com leitura guardada, a partir dos nomes da pasta ("<uuid>.json"). */
export function idsDasLeituras(nomes: string[]): string[] {
  const saida: string[] = [];
  nomes.forEach((n) => {
    const m = /^([0-9a-f-]{36})\.json$/i.exec(String(n || ""));
    if (m && UUID.test(m[1]) && saida.indexOf(m[1]) < 0) saida.push(m[1]);
  });
  return saida;
}

/** O pacote com as leituras novas (as imagens lidas agora deixam de estar pendentes). */
export function comLeituras(e: EntradaDoPacote, novas: Record<string, LeituraGuardada>): EntradaDoPacote {
  const leituras = { ...(e.leituras || {}), ...novas };
  const lidas = e.lidasNoStorage.concat(Object.keys(novas).filter((id) => e.lidasNoStorage.indexOf(id) < 0));
  return { ...e, leituras, lidasNoStorage: lidas };
}

// ------------------------------------------------------------------ o que vai ao modelo

export const DESCRICOES_DO_DIRETOR: Record<string, string> = {
  aprovar_foto: DESCRICOES_DO_ACERVO.aprovar_foto,
  arquivar_foto: "ref i#; tira a foto da lista (vai para o arquivo; dá para desfazer). Também vale para apagar o que foi gerado. para vazio.",
  mover_foto: DESCRICOES_DO_ACERVO.mover_foto,
  marcar_foto: DESCRICOES_DO_ACERVO.marcar_foto,
  tirar_marca: DESCRICOES_DO_ACERVO.tirar_marca,
  mandar_para_campanha: "ref i#; para com o apelido da campanha (cp1, cp2...).",
  aprovar_e_enviar: "ref i#; aprova e manda a foto para Arquivos do cliente. para vazio.",
  post_na_agenda:
    'ref i# (cada foto do post, na ordem do carrossel); para com o post: o apelido a# de POSTS DE FOTOS NA AGENDA, ou "AAAA-MM-DD Título" para um post novo nessa data. Todas as fotos do mesmo post levam o mesmo para. Não gera nada: monta o post (foto única ou carrossel) para a legenda, a data e a aprovação do cliente.',
  abrir_no_estudio: "ref i#; abre a foto no Estúdio de fotos para a equipe editar. para com a ferramenta: melhorar, fundo, cenario, angulo, ampliar ou formato.",
  fotos_do_clone: 'ref c#; para com o conjunto NOVO de fotos de origem do clone, de 1 a 4 apelidos de fotos reais separados por vírgula ("i2, i5"). Serve para trocar, tirar ou pôr foto no clone.',
  montar_book: 'ref c#, k# ou m# (o assunto do book: clone, produto ou modelo); para com o nome do book ("Book verão").',
  levar_ao_canvas: "ref i#; leva a foto para um canvas novo, já ligada a um resultado. para vazio.",
  renomear_kit: 'ref k#; para com o nome novo do produto e, se mudar, a variante depois de "|" ("Mouse NTC X | Preto").',
  fotos_do_kit:
    'ref k#; para com o conjunto NOVO de fotos do produto: apelidos de fotos com o papel ("i2 identidade, i5 embalagem"; papéis: identidade, detalhe, embalagem, verso, rotulo, estilo, cenario). Serve para trocar, tirar ou pôr foto no produto; as variações e campanhas usam estas fotos.',
  montar_ensaio:
    'ref k#; monta e salva o ensaio do produto SEM gerar: para "variacoes N" (fotos do produto) ou "campanha N" (com modelo sintética), N de 1 a 16. O custo de gerar aparece no resultado e a geração espera o Confirmar na etapa.',
};

export const DESCRICOES_DAS_GERACOES: Record<string, string> = {
  gerar_clone: "ref c#; fotos novas do clone (pessoa real autorizada). cenario, pose e roupa concretos; pedido com o resto.",
  variar_imagem: "ref i#; variação de uma foto. Foto do clone repete a pessoa; foto de produto ganha outro cenário (pedido ou cenario obrigatório).",
  gerar_do_prompt: "ref p#; fotos do produto aberto a partir do prompt da biblioteca (pedido acrescenta ao prompt).",
  gerar_no_book: "ref b#; fotos no book (prompt_ref p# opcional; sem ele, pedido é o que a foto mostra).",
  melhorar_foto: "ref i#; melhora a foto numa versão nova (o original fica): modo luz_cor, limpar, fundo_branco, fundo_transparente ou cenario (com cenario obrigatório). Nunca escurece a foto.",
};

/** Bloco do prompt: o que o diretor já conhece do cliente, com apelidos (nunca id). */
export function blocoDoPacote(p: PacoteDoDiretor): string {
  const f = p.foco;
  const clone = f.clone_id ? p.clones.find((c) => c.id === f.clone_id) : null;
  const book = f.book_id ? p.books.find((b) => b.id === f.book_id) : null;
  const kit = f.kit_id ? p.kits.find((k) => k.id === f.kit_id) : null;
  const persona = f.persona_id ? p.personas.find((m) => m.id === f.persona_id) : null;
  const marcadas = p.imagens.filter((i) => i.dados.selecionada).map((i) => i.ref);
  const aberto = [
    `etapa ${ROTULO_DA_ETAPA[f.etapa] || f.etapa}`,
    clone ? `clone aberto ${clone.ref} (${clone.titulo})` : "",
    book ? `book aberto ${book.ref} (${book.titulo})` : "",
    kit ? `produto aberto ${kit.ref} (${kit.titulo})` : "",
    persona ? `modelo aberta ${persona.ref} (${persona.titulo})` : "",
    marcadas.length ? `fotos marcadas na tela: ${marcadas.join(", ")}` : "nenhuma foto marcada",
  ].filter(Boolean).join("; ");
  const campanhas = p.campanhas.length ? `\nCAMPANHAS (apelido | nome):\n${p.campanhas.map((c) => `${c.ref} | ${c.nome}`).join("\n")}\n` : "\nCAMPANHAS: nenhuma aberta.\n";
  const posts = blocoDosAlvos("POSTS DE FOTOS NA AGENDA (só nestes entra foto; post novo: para com a data)", p.posts || [], "nenhum aberto.");
  return `
CONTEXTO JÁ CARREGADO DO CLIENTE ${p.cliente ? `(${p.cliente}) ` : ""}(você já tem tudo isto; nunca peça para a equipe reenviar foto, nome ou link):
- Na tela agora: ${aberto}.
${blocoDosAlvos("FOTOS DO CLIENTE", p.imagens, "nenhuma.")}${blocoDosAlvos("CLONES (pessoas reais com autorização)", p.clones, "nenhum.")}${blocoDosAlvos("PROMPTS DA BIBLIOTECA", p.prompts, "nenhum.")}${blocoDosAlvos("BOOKS", p.books, "nenhum.")}${blocoDosAlvos("PRODUTOS (KITS)", p.kits, "nenhum.")}${blocoDosAlvos("MODELOS SINTÉTICAS", p.personas, "nenhuma.")}${campanhas}${posts}
${regraDasAcoes(DESCRICOES_DO_DIRETOR)}
${regraDasGeracoes()}
${REGRA_DO_CAMINHO}`;
}

export function regraDasGeracoes(): string {
  const linhas = Object.keys(DESCRICOES_DAS_GERACOES).map((k) => `  - ${k}: ${DESCRICOES_DAS_GERACOES[k]}`);
  return `- geracoes: só quando a equipe PEDIR para gerar ou melhorar fotos agora (ex.: "gera 4 fotos da Ana na praia", "faz variações desta", "gera com o prompt p3", "melhora a luz da i2"). Cada linha: { operacao, ref, quantidade (1 a ${MAX_FOTOS_POR_LINHA}), cenario, pose, roupa, pedido, formato (${FORMATOS_DO_DIRETOR.join(", ")} ou null), prompt_ref (p# ou null), modo (só em melhorar_foto; senão null) }. Operações:
${linhas.join("\n")}
  Sem dizer qual, use o que está aberto na tela (clone aberto, fotos marcadas, book aberto, produto aberto). Com mais de uma opção e nada aberto, pergunte na resposta e devolva lista vazia. No máximo ${MAX_FOTOS_POR_PEDIDO} fotos por pedido. Cada foto de uma linha sai diferente: descreva o que muda em pedido. Pedido pequeno, claro e barato (até ${MAX_FOTOS_SEM_CONFIRMAR} fotos) começa sozinho com o custo à vista e dá para parar; o resto espera o Confirmar. Diga o número de fotos na resposta. Sem pedido de gerar, lista vazia. Nunca diga que já gerou.
  - agenda_das_fotos: quando a equipe pedir as fotos geradas num post da Agenda ("gera 3 fotos e põe no post de sexta"), o post (a# ou "AAAA-MM-DD Título"); senão null. As fotos entram no post quando terminarem.`;
}

/** Para onde a resposta leva (campo ir_para): a equipe aperta e já cai na área certa. */
export const DESTINOS_DO_DIRETOR = ["nenhum", "acervo", "estudio", "agenda", "criar", "ensaio", "campanha", "aprovar", "usar", "clones", "book", "canvas", "modelos", "biblioteca", "kits"] as const;

export const REGRA_DO_CAMINHO = `- ir_para e ir_para_ref: a área do painel onde a equipe continua depois da sua resposta (${DESTINOS_DO_DIRETOR.join(", ")}), e o apelido que abre junto (i# abre a foto, a# o post, c# o clone, b# o book, k# o produto, m# a modelo) ou null. Sempre que houver próximo passo, diga a área: a tela mostra o botão para ir. Sem próximo passo, "nenhum".`;

/** Esquema do campo `acoes` (sem custo) e `geracoes` (pagas) na resposta do diretor. */
export const ESQUEMA_DAS_ACOES_DO_DIRETOR = esquemaDasAcoes(OPERACOES_SEM_CUSTO);

export const ESQUEMA_DAS_GERACOES_DO_DIRETOR = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["operacao", "ref", "quantidade", "cenario", "pose", "roupa", "pedido", "formato", "prompt_ref", "modo"],
    properties: {
      operacao: { type: "string", enum: OPERACOES_DE_GERACAO },
      ref: { type: "string" },
      quantidade: { type: ["number", "null"] },
      cenario: { type: ["string", "null"] },
      pose: { type: ["string", "null"] },
      roupa: { type: ["string", "null"] },
      pedido: { type: ["string", "null"] },
      formato: { type: ["string", "null"] },
      prompt_ref: { type: ["string", "null"] },
      modo: { type: ["string", "null"] },
    },
  },
};

// ------------------------------------------------------------------ ações sem custo

type AlvoQualquer = AlvoComApelido<Alvo & { dados: Record<string, unknown> }>;

/** Todos os alvos do pacote que as ações sem custo tocam (fotos, clones, produtos, modelos). */
export function alvosDasAcoes(p: PacoteDoDiretor): AlvoQualquer[] {
  return ([] as AlvoQualquer[]).concat(
    p.imagens as unknown as AlvoQualquer[],
    p.clones as unknown as AlvoQualquer[],
    p.kits as unknown as AlvoQualquer[],
    p.personas as unknown as AlvoQualquer[],
  );
}

/** "i2, i5" -> ids das fotos reais (não geradas, não da internet), 1 a 4. */
export function fotosDeOrigemPedidas(bruto: unknown, p: PacoteDoDiretor): string[] | null {
  const refs = String(bruto ?? "").toLowerCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const porRef = new Map(p.imagens.map((i) => [i.ref.toLowerCase(), i]));
  const saida: string[] = [];
  for (const r of refs) {
    const i = porRef.get(r);
    if (!i || i.dados.gerada || ehReferenciaDaInternet({ tags: i.dados.tags, origem: i.dados.origem })) return null;
    if (saida.indexOf(i.id) < 0) saida.push(i.id);
  }
  return saida.length >= 1 && saida.length <= 4 ? saida : null;
}

/**
 * Operações que o diretor pode fazer na hora (regra 6 do contrato: pedido
 * claro, sem custo e com Desfazer): organizar, aprovar, arquivar (apagar é
 * arquivar), campanha, book, Canvas, post na Agenda (sem enviar ao cliente) e
 * o atalho para o Estúdio. Mandar para Arquivos (a cópia fica) e trocar as
 * fotos de origem do clone (mexe na identidade da pessoa) pedem Confirmar.
 */
export const OPERACOES_DIRETAS_DO_DIRETOR = [
  "aprovar_foto",
  "arquivar_foto",
  "mover_foto",
  "marcar_foto",
  "tirar_marca",
  "mandar_para_campanha",
  "montar_book",
  "levar_ao_canvas",
  "post_na_agenda",
  "abrir_no_estudio",
  // AG2: renomear o produto e montar o ensaio (sem gerar) voltam com o Desfazer. Trocar as fotos do produto pede Confirmar.
  "renomear_kit",
  "montar_ensaio",
];

/** "Nome | Variante" -> "Nome|Variante" (variante vazia mantém a atual). Null quando não muda nada. */
export function nomeDoKitPedido(bruto: unknown, atual: { nome: string; variante: string | null }): string | null {
  const t = semTravessao(String(bruto ?? "")).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const i = t.indexOf("|");
  const nome = umaLinha(i >= 0 ? t.slice(0, i) : t, 120);
  const variante = i >= 0 ? umaLinha(t.slice(i + 1), 120) : "";
  if (!nome) return null;
  const varianteFinal = variante || atual.variante || "";
  if (nome === atual.nome && varianteFinal === (atual.variante || "")) return null;
  return `${nome}|${varianteFinal}`;
}

/** Lê o "Nome|Variante" guardado. */
export function lerNomeDoKit(para: unknown): { nome: string; variante: string | null } | null {
  const t = String(para ?? "");
  const i = t.indexOf("|");
  const nome = (i >= 0 ? t.slice(0, i) : t).trim();
  if (!nome) return null;
  const variante = i >= 0 ? t.slice(i + 1).trim() : "";
  return { nome, variante: variante || null };
}

/**
 * "i2 identidade, i5 embalagem" -> "id:papel,id:papel" (conjunto novo das fotos
 * do produto, até 12). Foto fora da lista, arquivada, gerada sem aprovação num
 * papel de evidência ou papel desconhecido: null (o item vai para ignorados).
 * Null também quando o conjunto é o mesmo de agora.
 */
export function fotosDoKitPedidas(bruto: unknown, p: Pick<PacoteDoDiretor, "imagens">, atuais: { imagem_id: string; papel: string }[] = []): string | null {
  const partes = String(bruto ?? "").toLowerCase().split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const porRef = new Map(p.imagens.map((i) => [i.ref.toLowerCase(), i]));
  const saida: string[] = [];
  for (const parte of partes) {
    const [ref, papelBruto] = parte.split(/\s+/);
    const i = porRef.get(String(ref || ""));
    if (!i || !i.dados.ativa) return null;
    const papel = String(papelBruto || "identidade").replace(/[óo]tulo/, "otulo");
    if ((PAPEIS as string[]).indexOf(papel) < 0) return null;
    if ((PAPEIS_DE_EVIDENCIA as string[]).indexOf(papel) >= 0 && i.dados.gerada && !i.dados.aprovada) return null;
    const par = `${i.id}:${papel}`;
    if (saida.indexOf(par) < 0) saida.push(par);
    if (saida.length > 12) return null;
  }
  if (!saida.length) return null;
  const chave = (l: string[]) => l.slice().sort().join(",");
  if (chave(saida) === chave(atuais.map((r) => `${r.imagem_id}:${r.papel}`))) return null;
  return saida.join(",");
}

/** O conjunto guardado ("id:papel,...") lido de volta. */
export function lerFotosDoKit(para: unknown): { imagem_id: string; papel: string }[] {
  return String(para ?? "").split(",").map((x) => {
    const [id, papel] = x.split(":");
    return { imagem_id: String(id || "").trim(), papel: String(papel || "").trim() };
  }).filter((r) => UUID.test(r.imagem_id) && (PAPEIS as string[]).indexOf(r.papel) >= 0);
}

/** "variacoes 8" / "campanha 6" -> "variacoes:8" / "campanha:6". Sem número: 8 variações ou 6 da campanha. */
export function ensaioPedido(bruto: unknown): string | null {
  const t = String(bruto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const tipo = /campanha|modelo/.test(t) ? "campanha" : /varia|fotos|ensaio|^\s*\d+\s*$/.test(t) || !t ? "variacoes" : null;
  if (!tipo) return null;
  const n = Number((/(\d+)/.exec(t) || [])[1]);
  const q = Number.isFinite(n) && n > 0 ? Math.min(16, Math.floor(n)) : tipo === "campanha" ? 6 : 8;
  return `${tipo}:${q}`;
}

export function lerEnsaioPedido(para: unknown): { tipo: "variacoes" | "campanha"; quantidade: number } | null {
  const m = /^(variacoes|campanha):(\d+)$/.exec(String(para ?? ""));
  return m ? { tipo: m[1] as "variacoes" | "campanha", quantidade: Math.max(1, Math.min(16, Number(m[2]))) } : null;
}

const DATA_DO_POST = /^(\d{4}-\d{2}-\d{2})\s*(.*)$/;

/**
 * Destino do post pedido em `para`: "a2" (post da lista) ou "AAAA-MM-DD
 * Título" (post novo nessa data). Vira "post:<trabalho>|<item>" ou
 * "novo:<data>|<título>"; outra coisa volta null (o item vai para ignorados).
 */
export function destinoDoPost(bruto: unknown, p: Pick<PacoteDoDiretor, "posts">): string | null {
  const t = String(bruto ?? "").replace(/\s+/g, " ").trim();
  if (/^a\d+$/i.test(t)) {
    const post = (p.posts || []).find((x) => x.ref.toLowerCase() === t.toLowerCase());
    return post ? `post:${post.id}|${post.dados.task_id}` : null;
  }
  const m = DATA_DO_POST.exec(t);
  if (!m) return null;
  const d = new Date(`${m[1]}T12:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1]) return null;
  const titulo = umaLinha(semTravessao(m[2] || ""), 120) || "Post de fotos";
  return `novo:${m[1]}|${titulo}`;
}

/** O destino guardado, lido de volta. */
export function lerDestinoDoPost(para: unknown): { tipo: "post"; trabalho_id: string; task_id: string } | { tipo: "novo"; data: string; titulo: string } | null {
  const t = String(para ?? "");
  if (t.indexOf("post:") === 0) {
    const [trabalho, task] = t.slice(5).split("|");
    return UUID.test(trabalho || "") && UUID.test(task || "") ? { tipo: "post", trabalho_id: trabalho, task_id: task } : null;
  }
  if (t.indexOf("novo:") === 0) {
    const resto = t.slice(5);
    const i = resto.indexOf("|");
    const data = i >= 0 ? resto.slice(0, i) : resto;
    return /^\d{4}-\d{2}-\d{2}$/.test(data) ? { tipo: "novo", data, titulo: (i >= 0 ? resto.slice(i + 1) : "") || "Post de fotos" } : null;
  }
  return null;
}

export const FERRAMENTAS_DO_ESTUDIO = ["melhorar", "fundo", "cenario", "angulo", "ampliar", "formato"] as const;

export function regrasDoDiretor(p: PacoteDoDiretor): Record<string, RegraDaOperacao<AlvoQualquer>> {
  const doAcervo = regrasDoAcervo({ aprovar: true, campanhas: p.campanhas }) as unknown as Record<string, RegraDaOperacao<AlvoQualquer>>;
  const dados = (a: AlvoQualquer) => a.dados as Record<string, unknown>;
  const internet = (a: AlvoQualquer) => ehReferenciaDaInternet({ tags: (dados(a).tags as string[]) || [], origem: String(dados(a).origem || "") });
  const regras: Record<string, RegraDaOperacao<AlvoQualquer>> = {
    ...doAcervo,
    post_na_agenda: {
      rotulo: "pôr no post da Agenda",
      alvos: ["i"],
      combina: true,
      para: (bruto) => destinoDoPost(bruto, p),
      trava: (a) => (internet(a) ? "Referência da internet é uso interno: não vai ao ar." : dados(a).ativa === false ? "Esta foto está arquivada." : null),
    },
    abrir_no_estudio: {
      rotulo: "abrir no Estúdio de fotos",
      alvos: ["i"],
      combina: true,
      para: (bruto) => {
        const t = String(bruto ?? "").trim().toLowerCase();
        return (FERRAMENTAS_DO_ESTUDIO as readonly string[]).indexOf(t) >= 0 ? t : "editar";
      },
      trava: (a) => (dados(a).ativa === false ? "Esta foto está arquivada." : null),
    },
    aprovar_e_enviar: {
      rotulo: "aprovar e mandar para Arquivos",
      alvos: ["i"],
      combina: true,
      trava: (a) => (ehReferenciaDaInternet({ tags: (dados(a).tags as string[]) || [], origem: String(dados(a).origem || "") }) ? "Referência da internet é uso interno e não vai para Arquivos." : dados(a).ativa === false ? "Esta foto está arquivada." : null),
    },
    fotos_do_clone: {
      rotulo: "trocar as fotos de origem",
      alvos: ["c"],
      para: (bruto, a) => {
        const lista = fotosDeOrigemPedidas(bruto, p);
        if (!lista) return null;
        const atuais = ((dados(a).reais as string[]) || []).slice().sort().join(",");
        return lista.slice().sort().join(",") === atuais ? null : lista.join(",");
      },
      trava: (a) => (dados(a).autorizacao_ok ? null : String(dados(a).motivo || "O clone está sem autorização válida.")),
    },
    montar_book: {
      rotulo: "montar book",
      alvos: ["c", "k", "m"],
      para: (bruto, a) => umaLinha(semTravessao(String(bruto ?? "")), 120) || `Book de ${a.titulo}`.slice(0, 120),
      trava: (a) => (apelidoDoTipo(a.ref, ["c"]) && !dados(a).autorizacao_ok ? String(dados(a).motivo || "O clone está sem autorização válida.") : null),
    },
    levar_ao_canvas: {
      rotulo: "levar ao Canvas",
      alvos: ["i"],
      combina: true,
      trava: (a) => (dados(a).ativa === false ? "Esta foto está arquivada." : null),
    },
    // AG2 (29/09): produto e ensaio pelas ações que já existem (kit_salvar e agente_aplicar), com Desfazer.
    renomear_kit: {
      rotulo: "renomear o produto",
      alvos: ["k"],
      combina: true,
      para: (bruto, a) => nomeDoKitPedido(bruto, { nome: String(dados(a).nome || a.titulo), variante: (dados(a).variante as string | null) ?? null }),
      trava: (a) => (dados(a).status === "arquivado" ? "O produto está arquivado." : null),
    },
    fotos_do_kit: {
      rotulo: "trocar as fotos do produto",
      alvos: ["k"],
      combina: true,
      para: (bruto, a) => fotosDoKitPedidas(bruto, p, (dados(a).refs as { imagem_id: string; papel: string }[]) || []),
      trava: (a) => (dados(a).status === "arquivado" ? "O produto está arquivado." : null),
    },
    montar_ensaio: {
      rotulo: "montar o ensaio (sem gerar)",
      alvos: ["k"],
      combina: true,
      repete: true,
      para: (bruto) => ensaioPedido(bruto),
      trava: (a) => (dados(a).status === "arquivado" ? "O produto está arquivado." : !((dados(a).refs as unknown[]) || []).length ? "O produto não tem fotos: ponha as fotos antes (ou identifique o produto)." : null),
    },
  };
  OPERACOES_DIRETAS_DO_DIRETOR.forEach((op) => {
    if (regras[op]) regras[op] = { ...regras[op], direta: true };
  });
  return regras;
}

/** Lê `acoes` da resposta do diretor e troca apelido por alvo (agente "diretor"). */
export function normalizarAcoesDoDiretor(bruto: unknown, p: PacoteDoDiretor, id?: string): AcaoDoAgente | null {
  const nomeDaFoto = new Map(p.imagens.map((i) => [i.id, `${i.ref} ${i.titulo}`]));
  return normalizarAcaoDoAgente(bruto, alvosDasAcoes(p), regrasDoDiretor(p), {
    agente: AGENTE_SEM_CUSTO,
    id: id || `diretor-${Date.now().toString(36)}`,
    contexto: { client_id: p.client_id },
    rotuloDoPara: (op, para) => {
      if (op === "mandar_para_campanha") {
        const c = p.campanhas.find((x) => x.id === para);
        return c ? c.nome : null;
      }
      if (op === "post_na_agenda") {
        const d = lerDestinoDoPost(para);
        if (!d) return null;
        if (d.tipo === "novo") return `post novo em ${d.data.split("-").reverse().join("/")}: ${d.titulo}`;
        const post = (p.posts || []).find((x) => x.id === d.trabalho_id);
        return post ? `${post.ref} ${post.titulo}` : "post da Agenda";
      }
      if (op === "fotos_do_clone") {
        const lista = String(para || "").split(",").filter(Boolean);
        return `${lista.length} ${lista.length === 1 ? "foto" : "fotos"}: ${lista.map((x) => nomeDaFoto.get(x) || "foto").join(", ")}`.slice(0, 300);
      }
      if (op === "fotos_do_kit") {
        const lista = lerFotosDoKit(para);
        return `${lista.length} ${lista.length === 1 ? "foto" : "fotos"}: ${lista.map((r) => `${nomeDaFoto.get(r.imagem_id) || "foto"} (${r.papel})`).join(", ")}`.slice(0, 300);
      }
      if (op === "renomear_kit") {
        const n = lerNomeDoKit(para);
        return n ? `${n.nome}${n.variante ? ` (${n.variante})` : ""}` : null;
      }
      if (op === "montar_ensaio") {
        const e = lerEnsaioPedido(para);
        return e ? `${e.tipo === "campanha" ? "campanha com modelo" : "variações"}, ${e.quantidade} ${e.quantidade === 1 ? "foto" : "fotos"}` : null;
      }
      return null;
    },
  });
}

// ------------------------------------------------------------------ gerações (pagas)

/** O que a geração de um item precisa (fica no contexto da proposta, no servidor). */
export type PedidoDaGeracao = {
  operacao: string;
  alvo_ref: string;
  alvo_id: string;
  cenario: string;
  pose: string;
  roupa: string;
  livre: string;
  formato: string | null;
  prompt_id: string | null;
  prompt_texto: string;
  kit_id: string | null;
  clone_id: string | null;
  /** Número da foto dentro da linha (1..N), para variar o pedido. */
  vez: number;
  vezes: number;
  /** melhorar_foto: o modo do Preparar (luz_cor, limpar, fundo_branco, fundo_transparente, cenario). */
  modo?: string | null;
};

const textoDoPedido = (v: unknown, max: number) => umaLinha(semTravessao(String(v ?? "")), max);

export function resumoDoPedido(g: Pick<PedidoDaGeracao, "cenario" | "pose" | "roupa" | "livre" | "formato">): string {
  return [g.cenario, g.pose, g.roupa, g.livre, g.formato || ""].filter(Boolean).join(" · ").slice(0, 200) || "livre";
}

/**
 * Lê `geracoes` da resposta e monta a proposta paga (agente "diretor_geracao"):
 * uma foto por item (g1..gN), com o pedido guardado no contexto. Travas:
 * clone sem autorização válida ou arquivado, referência da internet, book
 * arquivado, prompt sem produto aberto e pedido sem o que gerar.
 * Limites (anti-bug AB2, 26/09: antes cortavam calados): acima de
 * MAX_FOTOS_POR_LINHA numa linha ou de `max` no pedido, o que sobra vai para
 * `recusados` (operação "limite") com quantas fotos ficaram de fora, e o
 * resumo do cartão diz o total.
 */
export function normalizarGeracoesDoDiretor(
  bruto: unknown,
  p: PacoteDoDiretor,
  opcoes: { id?: string; kitId?: string | null; max?: number } = {},
): AcaoDoAgente | null {
  const todas = Array.isArray(bruto) ? bruto : [];
  const linhas = todas.slice(0, MAX_LINHAS_DE_GERACAO);
  const max = Math.max(1, Math.min(MAX_FOTOS_POR_PEDIDO, opcoes.max || MAX_FOTOS_POR_PEDIDO));
  const porRef = new Map<string, AlvoQualquer>();
  ([] as AlvoQualquer[]).concat(
    p.imagens as unknown as AlvoQualquer[],
    p.clones as unknown as AlvoQualquer[],
    p.prompts as unknown as AlvoQualquer[],
    p.books as unknown as AlvoQualquer[],
  ).forEach((a) => porRef.set(a.ref.toLowerCase(), a));
  const kitId = opcoes.kitId !== undefined ? opcoes.kitId : p.foco.kit_id || (p.kits.length === 1 ? p.kits[0].id : null);
  const itens: ItemDaAcaoDoAgente[] = [];
  const pedidos: Record<string, PedidoDaGeracao> = {};
  const recusados: RecusaDoItem[] = [];
  const ignorados: string[] = [];
  let passou = false;
  /** Fotos que passaram do limite do pedido (inclui as linhas além de MAX_LINHAS_DE_GERACAO). */
  let foraDoPedido = 0;
  /** Fotos cortadas pelo limite por linha, por alvo (apelido -> título e quantas). */
  const cortadasNaLinha = new Map<string, { titulo: string; n: number }>();
  const recusar = (a: AlvoQualquer, operacao: string, motivo: string) => {
    if (!recusados.some((r) => r.ref === a.ref && r.operacao === operacao)) recusados.push({ ref: a.ref, titulo: a.titulo, operacao, motivo });
  };
  /** Quantas fotos a linha pediu (1 a 100: número absurdo não vira aviso absurdo). */
  const pedidasNaLinha = (m: Record<string, unknown>) => Math.max(1, Math.min(100, Math.floor(Number(m.quantidade) || 1)));
  const linhaValida = (m: Record<string, unknown>) => {
    const operacao = String(m.operacao ?? "").trim().toLowerCase();
    const alvo = porRef.get(String(m.ref ?? "").trim().toLowerCase().slice(0, 12));
    return OPERACOES_DE_GERACAO.indexOf(operacao) >= 0 && !!alvo && apelidoDoTipo(alvo.ref, [ALVO_DA_GERACAO[operacao]]);
  };
  // Linhas além do teto de linhas: não entram, mas contam no aviso de quantas ficaram de fora.
  for (const b of todas.slice(MAX_LINHAS_DE_GERACAO)) {
    const m = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    if (!linhaValida(m)) continue;
    passou = true;
    foraDoPedido += Math.min(MAX_FOTOS_POR_LINHA, pedidasNaLinha(m));
  }

  for (const b of linhas) {
    const m = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const operacao = String(m.operacao ?? "").trim().toLowerCase();
    const ref = String(m.ref ?? "").trim().toLowerCase().slice(0, 12);
    const alvo = porRef.get(ref);
    if (OPERACOES_DE_GERACAO.indexOf(operacao) < 0 || !alvo || !apelidoDoTipo(alvo.ref, [ALVO_DA_GERACAO[operacao]])) {
      if (ref) ignorados.push(ref);
      continue;
    }
    const d = alvo.dados as Record<string, unknown>;
    const cenario = textoDoPedido(m.cenario, 400);
    const pose = textoDoPedido(m.pose, 300);
    const roupa = textoDoPedido(m.roupa, 300);
    const livre = textoDoPedido(m.pedido, 800);
    const formato = FORMATOS_DO_DIRETOR.indexOf(String(m.formato ?? "")) >= 0 ? String(m.formato) : null;
    const promptRef = String(m.prompt_ref ?? "").trim().toLowerCase();
    const promptAlvo = promptRef ? porRef.get(promptRef) : null;
    const prompt = promptAlvo && apelidoDoTipo(promptAlvo.ref, ["p"]) ? promptAlvo : operacao === "gerar_do_prompt" ? alvo : null;
    const promptTexto = prompt ? String((prompt.dados as Record<string, unknown>).texto || "") : "";
    let clone: string | null = null;

    if (operacao === "gerar_clone") {
      if (d.status === "arquivada") {
        recusar(alvo, operacao, "O clone está arquivado.");
        continue;
      }
      if (!d.autorizacao_ok) {
        recusar(alvo, operacao, String(d.motivo || "O clone está sem autorização válida: nada novo pode ser gerado."));
        continue;
      }
      clone = alvo.id;
    } else if (operacao === "variar_imagem") {
      if (ehReferenciaDaInternet({ tags: (d.tags as string[]) || [], origem: String(d.origem || "") })) {
        recusar(alvo, operacao, "Referência da internet é uso interno: não vira foto do cliente.");
        continue;
      }
      if (d.ativa === false) {
        recusar(alvo, operacao, "Esta foto está arquivada.");
        continue;
      }
      clone = (d.clone_id as string | null) || null;
      if (clone) {
        const c = p.clones.find((x) => x.id === clone);
        if (c && !c.dados.autorizacao_ok) {
          recusar(alvo, operacao, c.dados.motivo || "O clone desta foto está sem autorização válida.");
          continue;
        }
      } else if (!cenario && !livre) {
        recusar(alvo, operacao, "Diga o cenário da variação (superfície, fundo, luz).");
        continue;
      } else if (d.jpeg) {
        // FN-05: sem clone, a variação vai ao Preparar em novo cenário, que recusa foto sem recorte.
        recusar(alvo, operacao, FRASE_DO_RECORTE_OU_AREA);
        continue;
      }
    } else if (operacao === "melhorar_foto") {
      if (ehReferenciaDaInternet({ tags: (d.tags as string[]) || [], origem: String(d.origem || "") })) {
        recusar(alvo, operacao, "Referência da internet é uso interno: não vira foto do cliente.");
        continue;
      }
      if (d.ativa === false) {
        recusar(alvo, operacao, "Esta foto está arquivada.");
        continue;
      }
      const modoPedido = String(m.modo ?? "").trim().toLowerCase();
      if ((MODOS_DO_MELHORAR as readonly string[]).indexOf(modoPedido) < 0) {
        recusar(alvo, operacao, "Diga o que melhorar: luz e cor, limpar, fundo branco, tirar fundo ou novo cenário.");
        continue;
      }
      if (modoPedido === "cenario" && !cenario && !livre) {
        recusar(alvo, operacao, "Diga o cenário novo (superfície, fundo, luz).");
        continue;
      }
      if (modoPedido === "cenario" && d.jpeg) {
        // FN-05: a execução recusaria cada foto com esta mesma frase; o cartão já avisa antes do Confirmar.
        recusar(alvo, operacao, FRASE_DO_RECORTE_OU_AREA);
        continue;
      }
    } else if (operacao === "gerar_do_prompt") {
      if (!kitId) {
        recusar(alvo, operacao, "Abra o produto (kit) para gerar com este prompt.");
        continue;
      }
      if (!promptTexto) {
        recusar(alvo, operacao, "Este prompt não tem texto.");
        continue;
      }
    } else if (operacao === "gerar_no_book") {
      if (d.status === "arquivado") {
        recusar(alvo, operacao, "O book está arquivado.");
        continue;
      }
      if (!promptTexto && !livre && !cenario) {
        recusar(alvo, operacao, "Diga o que a foto do book deve mostrar (ou escolha um prompt).");
        continue;
      }
    }

    const pedidas = pedidasNaLinha(m);
    const vezes = Math.min(MAX_FOTOS_POR_LINHA, pedidas);
    if (pedidas > vezes) {
      const antes = cortadasNaLinha.get(alvo.ref);
      cortadasNaLinha.set(alvo.ref, { titulo: alvo.titulo, n: (antes ? antes.n : 0) + pedidas - vezes });
    }
    for (let v = 1; v <= vezes; v++) {
      if (itens.length >= max) {
        passou = true;
        foraDoPedido += vezes - v + 1;
        break;
      }
      const refDoItem = `g${itens.length + 1}`;
      const pedido: PedidoDaGeracao = {
        operacao,
        alvo_ref: alvo.ref,
        alvo_id: alvo.id,
        cenario,
        pose,
        roupa,
        livre,
        formato,
        prompt_id: prompt ? prompt.id : null,
        prompt_texto: promptTexto,
        kit_id: operacao === "gerar_do_prompt" ? kitId : operacao === "variar_imagem" || operacao === "melhorar_foto" ? ((d.kit_id as string | null) || null) : null,
        clone_id: clone,
        vez: v,
        vezes,
      };
      if (operacao === "melhorar_foto") pedido.modo = String(m.modo ?? "").trim().toLowerCase();
      pedidos[refDoItem] = pedido;
      itens.push({
        ref: refDoItem,
        alvo_id: alvo.id,
        titulo: `${alvo.titulo}${vezes > 1 ? ` (${v} de ${vezes})` : ""}`.slice(0, 200),
        detalhe: `${alvo.ref} · ${operacao === "melhorar_foto" ? `${ROTULO_DO_MODO_DO_MELHORAR[pedido.modo || ""] || "melhorar"}${pedido.cenario || pedido.livre ? ` · ${resumoDoPedido(pedido)}` : ""}` : resumoDoPedido(pedido)}${prompt && operacao !== "gerar_do_prompt" ? ` · prompt ${prompt.ref}` : ""}`.slice(0, 160),
        operacao,
        rotulo: ROTULO_DA_GERACAO[operacao],
        para: null,
      });
    }
  }
  const ficou = (k: number) => `${k} ${k === 1 ? "ficou" : "ficaram"} de fora`;
  let cortadas = 0;
  cortadasNaLinha.forEach((c, ref) => {
    cortadas += c.n;
    recusados.push({ ref, titulo: c.titulo, operacao: "limite", motivo: `No máximo ${MAX_FOTOS_POR_LINHA} fotos de uma vez para o mesmo item: ${ficou(c.n)}. Peça o resto depois.` });
  });
  if (passou) recusados.push({ ref: "-", titulo: "Fotos a mais", operacao: "limite", motivo: `No máximo ${max} fotos por pedido: ${ficou(foraDoPedido)}. Peça o resto depois.` });
  if (!itens.length && !recusados.length) return null;
  const n = itens.length;
  const fora = cortadas + foraDoPedido;
  return {
    tipo: "acao_agente",
    agente: AGENTE_DE_GERACAO,
    id: opcoes.id || `geracao-${Date.now().toString(36)}`,
    resumo: n
      ? `Vou gerar ${n} ${n === 1 ? "foto" : "fotos"}, uma por vez. O custo aparece antes de confirmar.${fora ? ` Pelo limite, ${fora === 1 ? "1 foto ficou" : `${fora} fotos ficaram`} de fora: peça depois.` : ""}`
      : "Nada para gerar.",
    itens,
    ignorados,
    recusados,
    contexto: { client_id: p.client_id, pedidos, custos: {} as Record<string, number | null> },
    custo_estimado_usd: null,
  };
}

/** Chave da estimativa de um item: itens com o mesmo alvo e a mesma operação custam igual. */
export const chaveDoCusto = (pd: Pick<PedidoDaGeracao, "operacao" | "alvo_id" | "clone_id">) => `${pd.operacao}:${pd.clone_id || pd.alvo_id}`;

/** Grava o custo por item e o total (arredondado); item sem estimativa marca o total como incompleto. */
export function aplicarCustos(acao: AcaoDoAgente, custoPorChave: Record<string, number | null>): AcaoDoAgente {
  const contexto = { ...(acao.contexto || {}) } as Record<string, unknown>;
  const pedidos = (contexto.pedidos || {}) as Record<string, PedidoDaGeracao>;
  const custos: Record<string, number | null> = {};
  let total = 0;
  let incompleto = false;
  acao.itens.forEach((i) => {
    const pd = pedidos[i.ref];
    const c = pd ? custoPorChave[chaveDoCusto(pd)] : null;
    const valor = typeof c === "number" && isFinite(c) && c >= 0 ? c : null;
    custos[i.ref] = valor;
    if (valor === null) incompleto = true;
    else total += valor;
  });
  contexto.custos = custos;
  contexto.custo_incompleto = incompleto;
  return { ...acao, contexto, custo_estimado_usd: acao.itens.length ? Math.round(total * 1e6) / 1e6 : 0 };
}

export function pedidoDoItem(acao: AcaoDoAgente, ref: string): PedidoDaGeracao | null {
  const pedidos = ((acao.contexto || {}) as Record<string, unknown>).pedidos as Record<string, PedidoDaGeracao> | undefined;
  return pedidos && Object.prototype.hasOwnProperty.call(pedidos, ref) ? pedidos[ref] : null;
}

/** O que cada foto pede ao gerador (a vez muda a foto: variações de verdade, não cópias). */
export function textoLivreDaVez(pd: PedidoDaGeracao): string {
  const base = pd.livre;
  if (pd.vezes <= 1) return base;
  const nota = `Foto ${pd.vez} de ${pd.vezes} desta série: mude enquadramento, ângulo e momento em relação às outras.`;
  return base ? `${base}. ${nota}` : nota;
}

/** "Evite: a; b" com as regras EVITAR ensinadas (até 8), ou vazio. */
export function textoDoEvitar(evitar: unknown): string {
  const lista = (Array.isArray(evitar) ? evitar : []).map((x) => umaLinha(semTravessao(String(x ?? "")), 200)).filter(Boolean).slice(0, 8);
  return lista.length ? `Evite: ${lista.join("; ")}` : "";
}

/**
 * A chamada que a Mesa Foto já tem para cada item (sem inventar executor):
 * clone -> clone_variacao_gerar; variação de foto do clone -> clone_variacao_gerar
 * (ou clone_variacao_refazer sem pedido); variação de foto de produto -> preparar
 * (cenário novo); prompt ou book -> book_gerar (o book do produto é criado se faltar).
 */
export function chamadaDaGeracao(
  pd: PedidoDaGeracao,
  clientId: string,
  opcoes: { bookId?: string | null; marcaId?: string | null; evitar?: string[] | null } = {},
): { acao: string; corpo: Record<string, unknown>; precisaDeBook?: { kit_id: string } } {
  // AG2 (aprendizado): o que a equipe ensinou a EVITAR entra no pedido de cada foto.
  const evitar = textoDoEvitar(opcoes.evitar);
  const livre = [textoLivreDaVez(pd), evitar].filter(Boolean).join(". ");
  const comMarca = (c: Record<string, unknown>) => (opcoes.marcaId ? { ...c, marca_id: opcoes.marcaId } : c);
  if (pd.operacao === "gerar_clone" || (pd.operacao === "variar_imagem" && pd.clone_id)) {
    const temPedido = !!(pd.cenario || pd.pose || pd.roupa || pd.livre);
    if (pd.operacao === "variar_imagem" && !temPedido) {
      return { acao: "clone_variacao_refazer", corpo: comMarca({ modelo_id: pd.clone_id, imagem_id: pd.alvo_id }) };
    }
    const corpo: Record<string, unknown> = {
      modelo_id: pd.clone_id,
      pedido: { cenario: pd.cenario, pose: pd.pose, roupa: pd.roupa, livre },
    };
    if (pd.formato) corpo.formato = pd.formato;
    return { acao: "clone_variacao_gerar", corpo: comMarca(corpo) };
  }
  if (pd.operacao === "melhorar_foto") {
    const modo = (MODOS_DO_MELHORAR as readonly string[]).indexOf(String(pd.modo || "")) >= 0 ? String(pd.modo) : "luz_cor";
    const corpo: Record<string, unknown> = { client_id: clientId, imagem_id: pd.alvo_id, modo };
    if (modo === "cenario") corpo.cenario = [pd.cenario, pd.livre, evitar].filter(Boolean).join(". ").slice(0, 1200);
    else if (pd.livre || pd.cenario || evitar) corpo.instrucao = [pd.livre, pd.cenario, evitar].filter(Boolean).join(". ").slice(0, 1200);
    if (pd.kit_id) corpo.kit_id = pd.kit_id;
    return { acao: "preparar", corpo };
  }
  if (pd.operacao === "variar_imagem") {
    const cenario = [pd.cenario, livre].filter(Boolean).join(". ").slice(0, 1200);
    return { acao: "preparar", corpo: { client_id: clientId, imagem_id: pd.alvo_id, modo: "cenario", cenario, ...(pd.kit_id ? { kit_id: pd.kit_id } : {}) } };
  }
  const prompt = [pd.prompt_texto, pd.cenario ? `Cenário: ${pd.cenario}.` : "", pd.pose ? `Pose: ${pd.pose}.` : "", pd.roupa ? `Roupa: ${pd.roupa}.` : "", livre].filter(Boolean).join(" ").slice(0, 3000);
  const pedido: Record<string, unknown> = { prompt };
  if (pd.formato) pedido.formato = pd.formato;
  if (pd.operacao === "gerar_no_book") return { acao: "book_gerar", corpo: comMarca({ book_id: pd.alvo_id, pedido }) };
  // gerar_do_prompt: o book do produto aberto (criado na primeira foto, se não houver).
  if (!opcoes.bookId) return { acao: "book_gerar", corpo: comMarca({ pedido }), precisaDeBook: { kit_id: String(pd.kit_id || "") } };
  return { acao: "book_gerar", corpo: comMarca({ book_id: opcoes.bookId, pedido }) };
}

// ------------------------------------------------------------------ execução item a item

export function resultadoDoItem(acao: AcaoDoAgente, ref: string): ResultadoDoItem | null {
  return (acao.resultados || []).find((r) => r.ref === ref) || null;
}

export function itensPendentes(acao: AcaoDoAgente): ItemDaAcaoDoAgente[] {
  return acao.itens.filter((i) => !resultadoDoItem(acao, i.ref));
}

// ------------------------------------------------------------------ novo cenário sem recorte (FN-05, 30/09)
//
// 29/09: 2 cartões de 4 fotos confirmados e as 8 falharam uma a uma com a
// mesma frase (a foto não tinha recorte nem área marcada), cada uma com
// pré-voo e partida da função. A mesma foto dá sempre a mesma recusa (409,
// antes de qualquer cobrança), então a proposta já recusa a foto que com
// certeza não é recorte (arquivo JPEG) e, na execução, a primeira recusa
// vale para os outros itens da mesma foto e da mesma rota.

/** Código e frase da recusa do Preparar em novo cenário (iguais aos de mesa-foto/index.ts, conferidos no teste). */
export const CODIGO_DO_RECORTE_OU_AREA = "recorte_ou_area_necessaria";
export const FRASE_DO_RECORTE_OU_AREA = "Para novo cenário preservando o assunto, faça antes o fundo transparente desta foto ou marque a área do assunto.";

/** Arquivo JPEG pelo nome (JPEG não tem alfa: nunca é recorte). */
export function ehArquivoJpeg(caminho: unknown): boolean {
  return /\.jpe?g$/i.test(String(caminho || ""));
}

/** O pedido vai ao Preparar em novo cenário preservando o assunto (variação sem clone ou melhorar em modo cenário)? */
export function pedeNovoCenario(pd: PedidoDaGeracao | null): boolean {
  if (!pd) return false;
  if (pd.operacao === "variar_imagem") return !pd.clone_id;
  return pd.operacao === "melhorar_foto" && pd.modo === "cenario";
}

/**
 * A recusa "recorte ou área" de um item vale para os outros itens pendentes
 * da mesma foto que também pedem novo cenário: grava neles o mesmo resultado
 * (não feito, mesma frase). Itens de outra foto ou de outra operação seguem.
 */
export function comRecusaNosIrmaos(acao: AcaoDoAgente, falhou: ResultadoDoItem, userId: string, agora = new Date().toISOString()): AcaoDoAgente {
  const origem = pedidoDoItem(acao, falhou.ref);
  if (falhou.ok || !pedeNovoCenario(origem) || !origem) return acao;
  let saida = acao;
  for (const it of itensPendentes(acao)) {
    if (it.ref === falhou.ref || emAndamento(acao, it.ref)) continue;
    const pd = pedidoDoItem(acao, it.ref);
    if (!pd || pd.alvo_id !== origem.alvo_id || !pedeNovoCenario(pd)) continue;
    saida = comResultadoDoItem(saida, { ref: it.ref, alvo_id: it.alvo_id, titulo: it.titulo, operacao: it.operacao, ok: false, motivo: falhou.motivo }, userId, agora);
  }
  return saida;
}

export function emAndamento(acao: AcaoDoAgente, ref: string, agora = Date.now(), janela = JANELA_DO_ANDAMENTO_MS): boolean {
  const mapa = (((acao.contexto || {}) as Record<string, unknown>).andamento || {}) as Record<string, number>;
  const t = Number(mapa[ref]);
  return isFinite(t) && t > 0 && agora - t < janela;
}

export function marcarAndamento(acao: AcaoDoAgente, ref: string, agora = Date.now()): AcaoDoAgente {
  const contexto = { ...(acao.contexto || {}) } as Record<string, unknown>;
  contexto.andamento = { ...((contexto.andamento || {}) as Record<string, number>), [ref]: agora };
  return { ...acao, contexto };
}

/** Grava o resultado de um item; com todos respondidos, a proposta fica feita. */
export function comResultadoDoItem(acao: AcaoDoAgente, r: ResultadoDoItem, userId: string, agora = new Date().toISOString()): AcaoDoAgente {
  const resultados = (acao.resultados || []).filter((x) => x.ref !== r.ref).concat([r]);
  const contexto = { ...(acao.contexto || {}) } as Record<string, unknown>;
  const andamento = { ...((contexto.andamento || {}) as Record<string, number>) };
  delete andamento[r.ref];
  contexto.andamento = andamento;
  const novo: AcaoDoAgente = { ...acao, contexto, resultados };
  if (acao.itens.every((i) => resultados.some((x) => x.ref === i.ref))) {
    novo.executada_em = agora;
    novo.executada_por = userId;
  }
  return novo;
}

/**
 * Cancelar no meio: o que já saiu fica (a proposta vira feita e o Desfazer
 * arquiva o gerado); sem nada feito, a proposta é só cancelada.
 */
export function pararGeracao(acao: AcaoDoAgente, userId: string, agora = new Date().toISOString()): AcaoDoAgente {
  if ((acao.resultados || []).length) return { ...acao, executada_em: agora, executada_por: userId };
  return { ...acao, descartada_em: agora };
}

/** Custo real somado dos itens feitos (o executor guarda em desfazer.custo_usd). */
export function custoReal(acao: AcaoDoAgente): number {
  return Math.round((acao.resultados || []).reduce((s, r) => s + (r.ok && r.desfazer && typeof r.desfazer.custo_usd === "number" ? Number(r.desfazer.custo_usd) : 0), 0) * 1e6) / 1e6;
}

// ------------------------------------------------------------------ cache curto

/** Cache em memória com validade (a instância da função vive alguns minutos). */
export function criarCacheCurto<T>(ttlMs: number, max = 60) {
  const mapa = new Map<string, { em: number; valor: T }>();
  return {
    ler(chave: string, agora = Date.now()): T | null {
      const v = mapa.get(chave);
      if (!v) return null;
      if (agora - v.em > ttlMs) {
        mapa.delete(chave);
        return null;
      }
      return v.valor;
    },
    gravar(chave: string, valor: T, agora = Date.now()) {
      if (mapa.size >= max) {
        const primeira = mapa.keys().next();
        if (!primeira.done) mapa.delete(primeira.value);
      }
      mapa.set(chave, { em: agora, valor });
    },
    esquecer(prefixo: string) {
      Array.from(mapa.keys()).forEach((k) => {
        if (k.indexOf(prefixo) === 0) mapa.delete(k);
      });
    },
    tamanho: () => mapa.size,
  };
}

// ------------------------------------------------------------------ canvas

/** Cartão do canvas para a foto levada pelo diretor: pessoa autorizada, produto ou estilo. */
export function cartaoDaFoto(img: Pick<AlvoDaImagem, "id" | "titulo"> & { dados: Pick<DadosDaImagem, "pessoa_real" | "kit_id"> }, indice: number): { id: string; tipo: string; x: number; y: number; dados: Record<string, unknown> } {
  const id = `diretor_${indice}_${img.id.slice(0, 8)}`;
  const y = 40 + indice * 180;
  if (img.dados.pessoa_real) return { id, tipo: "modelo", x: 40, y, dados: { titulo: img.titulo.slice(0, 120), imagem_id: img.id, autorizada: true } };
  if (img.dados.kit_id) return { id, tipo: "produto", x: 40, y, dados: { titulo: img.titulo.slice(0, 120), kit_id: img.dados.kit_id, imagem_ids: [img.id] } };
  return { id, tipo: "estilo", x: 40, y, dados: { titulo: img.titulo.slice(0, 120), imagem_ids: [img.id] } };
}

// ------------------------------------------------------------------ caminho (frente MF, 27/09)

/**
 * O caminho que o diretor deixa (dono, 27/09: "quando termina ele dá o
 * caminho pra mim apertar e ir e já fica tudo certinho"): rota interna da
 * Mesa Foto já com a etapa e o que abre nela. A página lê imagem, trabalho,
 * task, canvas, book e clone do endereço.
 */
export function enderecoDaMesaFoto(clientId: string, etapa: string, extras: Record<string, string | null | undefined> = {}): string {
  const partes = [`/mesa-foto?client=${clientId}`, `etapa=${etapa}`];
  Object.keys(extras).forEach((k) => {
    const v = extras[k];
    if (v) partes.push(`${k}=${encodeURIComponent(v)}`);
  });
  return partes.join("&");
}

/** Pedido "faz e me leva" (a tela vai sozinha quando termina). Na dúvida, não vai: o botão fica. */
export function pedeParaLevar(texto: unknown): boolean {
  return /(me lev[ae]|e abr[ae]|abr[ae] (pra|para) mim|me mostr[ae]|j[aá] abr[ae]|me (manda|mande) (pra|para) l[aá])/i.test(String(texto == null ? "" : texto));
}

type ResultadoComDesfazer = { ok: boolean; operacao: string; alvo_id: string; desfazer?: Record<string, unknown> | null };

/** Caminho depois de feita uma proposta do diretor (sem custo ou geração): a área onde o resultado está. */
export function caminhoDaAcaoDoDiretor(acao: Pick<AcaoDoAgente, "agente" | "itens" | "contexto"> & { resultados?: ResultadoComDesfazer[] | null }, clientId: string, abrirSozinho = false): CaminhoDoAgente | null {
  const feitos = (acao.resultados || []).filter((r) => r.ok);
  if (!feitos.length) return null;
  const x = (r: ResultadoComDesfazer) => (r.desfazer || {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  const com = (rotulo: string, destino: string) => caminhoSeguro(abrirSozinho ? { rotulo, destino, abrir_sozinho: true } : { rotulo, destino });
  const contexto = (acao.contexto || {}) as Record<string, unknown>;
  const postDaGeracao = contexto.post_da_agenda as Record<string, unknown> | undefined;
  if (postDaGeracao && texto(postDaGeracao.trabalho_id)) {
    return com("Abrir o post na Agenda", linkDoPostNaMesaFoto(clientId, { taskId: texto(postDaGeracao.task_id), trabalhoId: texto(postDaGeracao.trabalho_id) }));
  }
  const ops = feitos.map((r) => r.operacao);
  const primeiro = (op: string) => feitos.find((r) => r.operacao === op) || null;
  if (ops.indexOf("post_na_agenda") >= 0) {
    const r = primeiro("post_na_agenda") as ResultadoComDesfazer;
    return com("Abrir o post na Agenda", linkDoPostNaMesaFoto(clientId, { taskId: texto(x(r).task_id), trabalhoId: texto(x(r).trabalho_id) }));
  }
  if (ops.indexOf("abrir_no_estudio") >= 0) {
    const r = primeiro("abrir_no_estudio") as ResultadoComDesfazer;
    const pedido = acao.itens.find((i) => i.operacao === "abrir_no_estudio" && i.alvo_id === r.alvo_id);
    const ferramenta = pedido && pedido.para && pedido.para !== "editar" ? String(pedido.para) : null;
    return com("Abrir no Estúdio de fotos", enderecoDaMesaFoto(clientId, "estudio", { imagem: r.alvo_id, ferramenta }));
  }
  if (ops.indexOf("levar_ao_canvas") >= 0) {
    const r = primeiro("levar_ao_canvas") as ResultadoComDesfazer;
    return com("Abrir o Canvas", enderecoDaMesaFoto(clientId, "canvas", { canvas: texto(x(r).canvas_id) }));
  }
  if (ops.indexOf("montar_book") >= 0) {
    const r = primeiro("montar_book") as ResultadoComDesfazer;
    return com("Abrir o book", enderecoDaMesaFoto(clientId, "book", { book: texto(x(r).book_id) }));
  }
  if (ops.indexOf("montar_ensaio") >= 0) {
    const r = primeiro("montar_ensaio") as ResultadoComDesfazer;
    const campanha = x(r).tipo === "campanha";
    return com(campanha ? "Abrir a campanha" : "Abrir as variações", enderecoDaMesaFoto(clientId, campanha ? "campanha" : "ensaio", { ensaio: texto(x(r).ensaio_id), kit: r.alvo_id }));
  }
  if (ops.indexOf("renomear_kit") >= 0 || ops.indexOf("fotos_do_kit") >= 0) {
    const r = (primeiro("fotos_do_kit") || primeiro("renomear_kit")) as ResultadoComDesfazer;
    return com("Abrir o produto", enderecoDaMesaFoto(clientId, "kits", { kit: r.alvo_id }));
  }
  if (ops.indexOf("fotos_do_clone") >= 0) {
    const r = primeiro("fotos_do_clone") as ResultadoComDesfazer;
    return com("Abrir o clone", enderecoDaMesaFoto(clientId, "clones", { clone: r.alvo_id }));
  }
  if (acao.agente === AGENTE_DE_GERACAO) {
    const novas = feitos.map((r) => texto(x(r).imagem_id)).filter(Boolean) as string[];
    const clone = feitos.map((r) => texto(x(r).clone_id)).filter(Boolean)[0] || null;
    const book = feitos.map((r) => texto(x(r).book_id)).filter(Boolean)[0] || null;
    if (clone) return com("Ver no clone", enderecoDaMesaFoto(clientId, "clones", { clone }));
    if (book) return com("Ver no book", enderecoDaMesaFoto(clientId, "book", { book }));
    if (novas.length === 1) return com("Abrir no Estúdio de fotos", enderecoDaMesaFoto(clientId, "estudio", { imagem: novas[0] }));
    return com("Ver as fotos novas", enderecoDaMesaFoto(clientId, "acervo", { imagem: novas[0] || null }));
  }
  if (ops.indexOf("aprovar_e_enviar") >= 0) return com("Ver em Usar", enderecoDaMesaFoto(clientId, "usar"));
  return com("Ver em Fotos", enderecoDaMesaFoto(clientId, "acervo"));
}

const ETAPA_DO_DESTINO: Record<string, string> = {
  acervo: "acervo", estudio: "estudio", agenda: "agenda", criar: "criar", ensaio: "ensaio", campanha: "campanha", aprovar: "aprovar", usar: "usar",
  clones: "clones", book: "book", canvas: "canvas", modelos: "modelos", biblioteca: "biblioteca", kits: "kits",
};

const ROTULO_DO_DESTINO: Record<string, string> = {
  acervo: "Ir para Fotos", estudio: "Abrir no Estúdio de fotos", agenda: "Abrir o post na Agenda", criar: "Escolher o que fazer", ensaio: "Ir para Fotos do produto",
  campanha: "Ir para Foto com modelo", aprovar: "Ir para Aprovar", usar: "Ir para Usar", clones: "Abrir o clone", book: "Abrir o book", canvas: "Abrir o Canvas", modelos: "Abrir a modelo",
  biblioteca: "Ir para a Biblioteca", kits: "Abrir o produto",
};

/**
 * Caminho da resposta (ir_para e ir_para_ref do modelo), resolvido pelo
 * apelido no servidor (o modelo nunca vê id). Destino desconhecido ou
 * "nenhum": sem caminho.
 */
export function caminhoDaResposta(irPara: unknown, ref: unknown, p: Pick<PacoteDoDiretor, "client_id" | "imagens" | "clones" | "books" | "kits" | "personas" | "posts">, abrirSozinho = false): CaminhoDoAgente | null {
  const destino = String(irPara ?? "").trim().toLowerCase();
  const etapa = ETAPA_DO_DESTINO[destino];
  if (!etapa) return null;
  const r = String(ref ?? "").trim().toLowerCase();
  const achar = <T extends { ref: string }>(lista: T[] | undefined) => (lista || []).find((a) => a.ref.toLowerCase() === r) || null;
  const extras: Record<string, string | null> = {};
  const img = /^i\d+$/.test(r) ? achar(p.imagens) : null;
  if (img) extras.imagem = img.id;
  const post = /^a\d+$/.test(r) ? achar(p.posts) : null;
  const clone = /^c\d+$/.test(r) ? achar(p.clones) : null;
  const book = /^b\d+$/.test(r) ? achar(p.books) : null;
  const kit = /^k\d+$/.test(r) ? achar(p.kits) : null;
  const modelo = /^m\d+$/.test(r) ? achar(p.personas) : null;
  if (etapa === "agenda" && post) return caminhoSeguro({ rotulo: ROTULO_DO_DESTINO.agenda, destino: linkDoPostNaMesaFoto(p.client_id, { taskId: post.dados.task_id, trabalhoId: post.id }), ...(abrirSozinho ? { abrir_sozinho: true } : {}) });
  if (clone) extras.clone = clone.id;
  if (book) extras.book = book.id;
  if (kit) extras.kit = kit.id;
  if (modelo) extras.modelo = modelo.id;
  if (etapa === "estudio" && !img) return caminhoSeguro({ rotulo: "Ir para o Estúdio de fotos", destino: enderecoDaMesaFoto(p.client_id, etapa, extras), ...(abrirSozinho ? { abrir_sozinho: true } : {}) });
  return caminhoSeguro({ rotulo: ROTULO_DO_DESTINO[destino] || "Ir para lá", destino: enderecoDaMesaFoto(p.client_id, etapa, extras), ...(abrirSozinho ? { abrir_sozinho: true } : {}) });
}

/**
 * A geração pode começar sozinha (sem o clique de Confirmar)? Só com ordem
 * clara, custo conhecido até o teto, até MAX_FOTOS_SEM_CONFIRMAR fotos, nada
 * recusado e saldo que cobre. O motivo vai para o cartão (e para o teste).
 */
export function geracaoPodeIrSozinha(
  acao: Pick<AcaoDoAgente, "itens" | "recusados" | "custo_estimado_usd" | "contexto">,
  opcoes: { pedidoClaro: boolean; saldoUsd: number | null; teto?: number; maxFotos?: number },
): { sozinha: boolean; motivo: string } {
  const teto = opcoes.teto ?? TETO_SEM_CONFIRMAR_USD;
  const max = opcoes.maxFotos ?? MAX_FOTOS_SEM_CONFIRMAR;
  if (!opcoes.pedidoClaro) return { sozinha: false, motivo: "o pedido não é uma ordem clara" };
  if (!acao.itens.length) return { sozinha: false, motivo: "nada para gerar" };
  if (acao.itens.length > max) return { sozinha: false, motivo: `mais de ${max} fotos` };
  if ((acao.recusados || []).length) return { sozinha: false, motivo: "há item recusado" };
  const incompleto = !!(acao.contexto && (acao.contexto as Record<string, unknown>).custo_incompleto);
  const custo = acao.custo_estimado_usd;
  if (incompleto || typeof custo !== "number" || !isFinite(custo)) return { sozinha: false, motivo: "custo sem estimativa" };
  if (custo > teto + 1e-9) return { sozinha: false, motivo: `custo acima de US$ ${teto.toFixed(2)}` };
  if (typeof opcoes.saldoUsd === "number" && opcoes.saldoUsd < custo) return { sozinha: false, motivo: "saldo não cobre" };
  return { sozinha: true, motivo: "ordem clara, barata e com saldo" };
}

// ------------------------------------------------------------------ conversa sem UUID e sem promessa vazia (AG2, 29/09)

/**
 * As sugestões antigas (plano de variações, campanha, identificar produto)
 * falam em apelido como o resto do diretor: kit_id "k2" e imagem_ids "i3".
 * Aqui o apelido vira id (o modelo nunca vê nem devolve UUID). UUID que o
 * modelo copiou continua aceito (a conferência de sempre, em
 * normalizarSugestoes, diz se é do cliente). Apelido desconhecido some.
 */
export function sugestoesComIds(bruto: unknown, p: Pick<PacoteDoDiretor, "imagens" | "kits">, extras: Record<string, string> = {}): unknown[] {
  if (!Array.isArray(bruto)) return [];
  const imagens = new Map<string, string>(p.imagens.map((i) => [i.ref.toLowerCase(), i.id]));
  Object.keys(extras).forEach((k) => imagens.set(k.toLowerCase(), extras[k]));
  const kits = new Map<string, string>(p.kits.map((k) => [k.ref.toLowerCase(), k.id]));
  const umId = (v: unknown, mapa: Map<string, string>): string | null => {
    const t = String(v ?? "").trim();
    if (UUID.test(t)) return t;
    return mapa.get(t.toLowerCase()) || null;
  };
  const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => umId(x, imagens)).filter((x): x is string => !!x) : v);
  return bruto.map((b) => {
    if (!b || typeof b !== "object") return b;
    const s = { ...(b as Record<string, unknown>) };
    if (s.kit_id != null && s.kit_id !== "") s.kit_id = umId(s.kit_id, kits);
    if (s.imagem_ids !== undefined) s.imagem_ids = lista(s.imagem_ids);
    if (s.referencias_estilo_ids !== undefined) s.referencias_estilo_ids = lista(s.referencias_estilo_ids);
    return s;
  });
}

/**
 * Por que uma sugestão pedida pelo modelo não virou cartão (antes caía calada
 * e a resposta dizia "aplique a campanha abaixo" sem nada abaixo). Hoje só
 * plano de variações e campanha sem produto e identificar sem foto.
 */
export function motivosDasSugestoesQueCairam(bruto: unknown, ficaram: Array<{ tipo: string }>): string[] {
  if (!Array.isArray(bruto)) return [];
  const conta = (lista: Array<{ tipo?: unknown }>, tipo: string) => lista.filter((s) => s && s.tipo === tipo).length;
  const brutas = bruto.filter((b) => b && typeof b === "object") as Array<{ tipo?: unknown }>;
  const motivos: string[] = [];
  if (conta(brutas, "campanha") > conta(ficaram, "campanha")) motivos.push("a campanha com modelo precisa de um produto (kit) com fotos");
  if (conta(brutas, "plano_de_variacoes") > conta(ficaram, "plano_de_variacoes")) motivos.push("as variações precisam de um produto (kit) com fotos");
  if (conta(brutas, "identificar_produto") > conta(ficaram, "identificar_produto")) motivos.push("identificar o produto precisa das fotos marcadas");
  return motivos;
}

/**
 * A resposta diz que fez, está fazendo ou deixou pronto (regra barata antes
 * do Jev). Dado real: 26/09 20:28 e 27/09 15:24 ("vou usar o clone...",
 * "aplique a campanha abaixo", "preparei uma campanha") com anexos vazios.
 */
const PROMETE = /\b(vou (gerar|preparar|criar|montar|fazer|organizar|deixar|usar|aplicar|mandar|colocar|p[oô]r|trocar|arquivar|aprovar)|preparei|organizei|montei|criei|gerei|deixei (tudo )?pront|est[aá] pront[ao] para|pronta para aplicar|pronto para aplicar|aplique|abaixo|cart[aã]o|j[aá] (fiz|est[aá] feito|coloquei|mandei))/i;

export function pareceQuePromete(resposta: unknown): boolean {
  return PROMETE.test(String(resposta ?? ""));
}

export type OpcaoDoDiretor = { rotulo: string; mensagem: string };

/** Opções que o modelo mandou (2 a 4, curtas, sem travessão). */
export function normalizarOpcoes(bruto: unknown): OpcaoDoDiretor[] {
  if (!Array.isArray(bruto)) return [];
  const saida: OpcaoDoDiretor[] = [];
  bruto.forEach((b) => {
    const t = umaLinha(semTravessao(String(b ?? "")), 140);
    if (t && !saida.some((o) => o.mensagem === t) && saida.length < 4) saida.push({ rotulo: umaLinha(t, 60), mensagem: t });
  });
  return saida;
}

/**
 * Opções prontas quando a resposta prometia sem ação: cada uma é um pedido
 * que o diretor consegue fazer com o que está no pacote (clone autorizado,
 * produto com fotos, fotos marcadas). Nada inventado: sem nada disso,
 * marcar as fotos e identificar o produto.
 */
export function opcoesDoPacote(p: Pick<PacoteDoDiretor, "clones" | "kits" | "imagens" | "foco">): OpcaoDoDiretor[] {
  const saida: OpcaoDoDiretor[] = [];
  const somar = (rotulo: string, mensagem: string) => {
    if (saida.length < 3 && !saida.some((o) => o.mensagem === mensagem)) saida.push({ rotulo: umaLinha(rotulo, 60), mensagem });
  };
  const clone = p.clones.find((c) => c.dados.aberto && c.dados.autorizacao_ok) || p.clones.find((c) => c.dados.autorizacao_ok);
  if (clone) somar(`Gerar com o clone ${clone.titulo}`, `Gere as fotos que pedi com o clone ${clone.ref} (${clone.titulo}).`);
  const kit = p.kits.find((k) => k.id === p.foco.kit_id && k.dados.refs.length) || p.kits.find((k) => k.dados.refs.length);
  if (kit) {
    somar(`Fotos do produto: ${kit.titulo}`, `Monte o ensaio de variações do produto ${kit.ref} (${kit.titulo}), sem gerar ainda.`);
    somar(`Foto com modelo: ${kit.titulo}`, `Monte a campanha com modelo do produto ${kit.ref} (${kit.titulo}), sem gerar ainda.`);
  }
  const marcadas = p.imagens.filter((i) => i.dados.selecionada && !i.dados.gerada);
  if (marcadas.length && !kit) somar("Identificar o produto", `Identifique o produto pelas fotos marcadas (${marcadas.slice(0, 6).map((i) => i.ref).join(", ")}).`);
  if (marcadas.length) somar("Melhorar a foto marcada", `Melhore a luz e a cor da ${marcadas[0].ref}.`);
  if (!saida.length) somar("O que dá para fazer agora", "Com o que já está no painel, o que você consegue fazer agora? Liste as opções com o custo.");
  return saida;
}

/**
 * A resposta honesta quando o diretor prometeu e nada veio: o "Entendi" do
 * modelo fica, o resto vira o aviso do que falta e UMA pergunta curta.
 */
export function respostaSemPromessa(resposta: string, p: { entendi?: string | null; motivos: string[]; pergunta?: string | null }): string {
  const entendi = umaLinha(p.entendi || "", 600);
  const motivo = p.motivos.length ? `: ${p.motivos.join("; ")}` : "";
  const pergunta = umaLinha(semTravessao(p.pergunta || ""), 300) || "Qual destes caminhos eu sigo agora?";
  return [
    entendi ? `Entendi: ${entendi}` : "",
    `Atenção: ainda não preparei nada nesta resposta${motivo}. Nenhuma foto foi gerada e nada foi cobrado além desta conversa.`,
    `Próximo passo: ${pergunta}`,
  ].filter(Boolean).join("\n");
}

/**
 * Lista para "essa", "a segunda", "todas" (referenciaDoPedido), na ordem da
 * tela da etapa aberta: clones na etapa Clones, books no Book, produtos em
 * Produto; nas outras, as fotos (as marcadas primeiro, como no pacote).
 */
export function itensDaReferencia(p: Pick<PacoteDoDiretor, "foco" | "imagens" | "clones" | "books" | "kits">): { itens: ItemReferivel[]; selecionados: string[] } {
  const e = p.foco.etapa;
  const de = (lista: Array<{ ref: string; titulo: string; detalhe?: string | null }>) => lista.map((a) => ({ ref: a.ref, titulo: a.titulo, detalhe: a.detalhe || null }));
  if (e === "clones" && p.clones.length) return { itens: de(p.clones), selecionados: p.clones.filter((c) => c.dados.aberto).map((c) => c.ref) };
  if (e === "book" && p.books.length) return { itens: de(p.books), selecionados: p.books.filter((b) => b.id === p.foco.book_id).map((b) => b.ref) };
  if (e === "kits" && p.kits.length) return { itens: de(p.kits), selecionados: p.kits.filter((k) => k.id === p.foco.kit_id).map((k) => k.ref) };
  return { itens: de(p.imagens), selecionados: p.imagens.filter((i) => i.dados.selecionada).map((i) => i.ref) };
}

/**
 * A regra que faltava (causa do "promete e não faz", 26 e 27/09): pedido de
 * fazer vira ação na mesma resposta, ou UMA pergunta com opções. Vai no
 * sistema do modelo depois do pacote (fora do SISTEMA_AGENTE, que tem teto).
 */
export const REGRA_DO_PEDIDO_DE_FAZER = `PEDIDO DE FAZER ("crie", "gere", "prepare", "monte", "já pode", "pode fazer", "deixa pronto", "prepare tudo"): a ação vai NESTA resposta, no JSON:
- fotos novas: geracoes (clone c#, variação ou melhorar i#, prompt p#, book b#); o cartão mostra o custo antes;
- sem custo: acoes (montar_ensaio, renomear_kit, fotos_do_kit, post_na_agenda, aprovar, arquivar, organizar...);
- plano de variações ou campanha com direção detalhada: sugestoes, só com um produto k# que tem fotos (kit_id = k#).
Pessoa real ("eu", "meu personagem", o dono, "pega do clone"): gerar_clone com o clone c#, uma linha por cena, nunca campanha. Campanha é pessoa sintética com um produto.
Falta algo que muda o resultado (sem clone autorizado, sem produto com fotos, sem saber qual foto): nada de ação chutada; escreva UMA pergunta curta em pergunta (a mesma da resposta) e 2 a 4 respostas prontas em opcoes. Sem dúvida, pergunta null e opcoes vazia.
Nunca escreva "vou gerar", "preparei", "organizei" ou "aplique abaixo" sem a ação no JSON. Resposta curta: Entendi, o que foi para o cartão e o Próximo passo.`;

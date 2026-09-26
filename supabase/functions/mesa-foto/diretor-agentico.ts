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

// ------------------------------------------------------------------ constantes

export const AGENTE_SEM_CUSTO = "diretor";
export const AGENTE_DE_GERACAO = "diretor_geracao";

export const ETAPAS_DO_DIRETOR = ["acervo", "kits", "criar", "ensaio", "campanha", "preparar", "revisar", "usar", "biblioteca", "modelos", "clones", "book", "canvas"] as const;

export const ROTULO_DA_ETAPA: Record<string, string> = {
  acervo: "Fotos",
  kits: "Produto",
  criar: "Criar",
  ensaio: "Variações",
  campanha: "Campanha",
  preparar: "Preparar",
  revisar: "Revisar",
  usar: "Usar",
  biblioteca: "Biblioteca",
  modelos: "Modelos",
  clones: "Clones",
  book: "Book",
  canvas: "Canvas",
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
];

export const OPERACOES_DE_GERACAO = ["gerar_clone", "variar_imagem", "gerar_do_prompt", "gerar_no_book"];

/** Prefixo de apelido que cada geração aceita. */
export const ALVO_DA_GERACAO: Record<string, string> = { gerar_clone: "c", variar_imagem: "i", gerar_do_prompt: "p", gerar_no_book: "b" };

export const ROTULO_DA_GERACAO: Record<string, string> = {
  gerar_clone: "foto do clone",
  variar_imagem: "variação",
  gerar_do_prompt: "foto do prompt",
  gerar_no_book: "foto do book",
};

/** Fotos por pedido (cada uma é uma geração paga) e por linha da resposta. */
export const MAX_FOTOS_POR_PEDIDO = 16;
export const MAX_FOTOS_POR_LINHA = 8;
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
export type KitBruto = { id: string; nome: string; variante?: string | null; status?: string | null };
export type PersonaBruta = { id: string; nome: string; status?: string | null };

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
};
export type AlvoDaImagem = Alvo & { dados: DadosDaImagem };
export type AlvoDoClone = Alvo & { dados: { status: string; autorizacao_ok: boolean; motivo: string | null; reais: string[]; aberto: boolean } };
export type AlvoDoPrompt = Alvo & { dados: { texto: string; categoria: string } };
export type AlvoDoBook = Alvo & { dados: { status: string; assunto_tipo: string; assunto_id: string | null } };
export type AlvoSimples = Alvo & { dados: { status: string } };

export type PacoteDoDiretor = {
  client_id: string;
  cliente: string;
  foco: FocoDoDiretor;
  imagens: Array<AlvoComApelido<AlvoDaImagem>>;
  clones: Array<AlvoComApelido<AlvoDoClone>>;
  prompts: Array<AlvoComApelido<AlvoDoPrompt>>;
  books: Array<AlvoComApelido<AlvoDoBook>>;
  kits: Array<AlvoComApelido<AlvoSimples>>;
  personas: Array<AlvoComApelido<AlvoSimples>>;
  campanhas: CampanhaParaFotos[];
  /** Imagens que a próxima mensagem vai ler por visão (ids, no máximo 4). */
  sem_leitura: string[];
  contagens: { fotos: number; clones: number; prompts: number; books: number; kits: number; modelos: number; lidas: number };
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
  const kits: Array<AlvoComApelido<AlvoSimples>> = kitsOrdenados.slice(0, 20).map((k, n) => ({
    id: k.id,
    titulo: umaLinha(`${k.nome}${k.variante ? ` (${k.variante})` : ""}`, 140),
    detalhe: [k.id === foco.kit_id ? "aberto na tela" : "", k.status || ""].filter(Boolean).join("; "),
    ref: `k${n + 1}`,
    dados: { status: String(k.status || "") },
  }));

  const personasOrdenadas = e.personas.slice().sort((a, b) => Number(b.id === foco.persona_id) - Number(a.id === foco.persona_id));
  const personas: Array<AlvoComApelido<AlvoSimples>> = personasOrdenadas.slice(0, 20).map((p, n) => ({
    id: p.id,
    titulo: umaLinha(p.nome, 120),
    detalhe: [p.id === foco.persona_id ? "aberta na tela" : "", "pessoa sintética", p.status || ""].filter(Boolean).join("; "),
    ref: `m${n + 1}`,
    dados: { status: String(p.status || "") },
  }));

  const campanhas = campanhasComApelido(e.campanhas || [], "cp");
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
    sem_leitura,
    contagens: {
      fotos: imagens.length,
      clones: clones.length,
      prompts: prompts.length,
      books: books.length,
      kits: kits.length,
      modelos: personas.length,
      lidas: imagens.filter((i) => i.dados.lida).length,
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
  fotos_do_clone: 'ref c#; para com o conjunto NOVO de fotos de origem do clone, de 1 a 4 apelidos de fotos reais separados por vírgula ("i2, i5"). Serve para trocar, tirar ou pôr foto no clone.',
  montar_book: 'ref c#, k# ou m# (o assunto do book: clone, produto ou modelo); para com o nome do book ("Book verão").',
  levar_ao_canvas: "ref i#; leva a foto para um canvas novo, já ligada a um resultado. para vazio.",
};

export const DESCRICOES_DAS_GERACOES: Record<string, string> = {
  gerar_clone: "ref c#; fotos novas do clone (pessoa real autorizada). cenario, pose e roupa concretos; pedido com o resto.",
  variar_imagem: "ref i#; variação de uma foto. Foto do clone repete a pessoa; foto de produto ganha outro cenário (pedido ou cenario obrigatório).",
  gerar_do_prompt: "ref p#; fotos do produto aberto a partir do prompt da biblioteca (pedido acrescenta ao prompt).",
  gerar_no_book: "ref b#; fotos no book (prompt_ref p# opcional; sem ele, pedido é o que a foto mostra).",
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
  return `
CONTEXTO JÁ CARREGADO DO CLIENTE ${p.cliente ? `(${p.cliente}) ` : ""}(você já tem tudo isto; nunca peça para a equipe reenviar foto, nome ou link):
- Na tela agora: ${aberto}.
${blocoDosAlvos("FOTOS DO CLIENTE", p.imagens, "nenhuma.")}${blocoDosAlvos("CLONES (pessoas reais com autorização)", p.clones, "nenhum.")}${blocoDosAlvos("PROMPTS DA BIBLIOTECA", p.prompts, "nenhum.")}${blocoDosAlvos("BOOKS", p.books, "nenhum.")}${blocoDosAlvos("PRODUTOS (KITS)", p.kits, "nenhum.")}${blocoDosAlvos("MODELOS SINTÉTICAS", p.personas, "nenhuma.")}${campanhas}
${regraDasAcoes(DESCRICOES_DO_DIRETOR)}
${regraDasGeracoes()}`;
}

export function regraDasGeracoes(): string {
  const linhas = Object.keys(DESCRICOES_DAS_GERACOES).map((k) => `  - ${k}: ${DESCRICOES_DAS_GERACOES[k]}`);
  return `- geracoes: só quando a equipe PEDIR para gerar fotos agora (ex.: "gera 4 fotos da Ana na praia", "faz variações desta", "gera com o prompt p3"). Cada linha: { operacao, ref, quantidade (1 a ${MAX_FOTOS_POR_LINHA}), cenario, pose, roupa, pedido, formato (${FORMATOS_DO_DIRETOR.join(", ")} ou null), prompt_ref (p# ou null) }. Operações:
${linhas.join("\n")}
  Sem dizer qual, use o que está aberto na tela (clone aberto, fotos marcadas, book aberto, produto aberto). Com mais de uma opção e nada aberto, pergunte na resposta e devolva lista vazia. No máximo ${MAX_FOTOS_POR_PEDIDO} fotos por pedido. Cada foto de uma linha sai diferente: descreva o que muda em pedido. Nada é gerado agora: a equipe vê a lista com o custo e confirma; diga isso na resposta, com o número de fotos. Sem pedido de gerar, lista vazia. Nunca diga que já gerou.`;
}

/** Esquema do campo `acoes` (sem custo) e `geracoes` (pagas) na resposta do diretor. */
export const ESQUEMA_DAS_ACOES_DO_DIRETOR = esquemaDasAcoes(OPERACOES_SEM_CUSTO);

export const ESQUEMA_DAS_GERACOES_DO_DIRETOR = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["operacao", "ref", "quantidade", "cenario", "pose", "roupa", "pedido", "formato", "prompt_ref"],
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

export function regrasDoDiretor(p: PacoteDoDiretor): Record<string, RegraDaOperacao<AlvoQualquer>> {
  const doAcervo = regrasDoAcervo({ aprovar: true, campanhas: p.campanhas }) as unknown as Record<string, RegraDaOperacao<AlvoQualquer>>;
  const dados = (a: AlvoQualquer) => a.dados as Record<string, unknown>;
  const regras: Record<string, RegraDaOperacao<AlvoQualquer>> = {
    ...doAcervo,
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
  };
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
      if (op === "fotos_do_clone") {
        const lista = String(para || "").split(",").filter(Boolean);
        return `${lista.length} ${lista.length === 1 ? "foto" : "fotos"}: ${lista.map((x) => nomeDaFoto.get(x) || "foto").join(", ")}`.slice(0, 300);
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
 */
export function normalizarGeracoesDoDiretor(
  bruto: unknown,
  p: PacoteDoDiretor,
  opcoes: { id?: string; kitId?: string | null; max?: number } = {},
): AcaoDoAgente | null {
  const linhas = Array.isArray(bruto) ? bruto.slice(0, 24) : [];
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
  const recusar = (a: AlvoQualquer, operacao: string, motivo: string) => {
    if (!recusados.some((r) => r.ref === a.ref && r.operacao === operacao)) recusados.push({ ref: a.ref, titulo: a.titulo, operacao, motivo });
  };

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

    const vezes = Math.max(1, Math.min(MAX_FOTOS_POR_LINHA, Math.floor(Number(m.quantidade) || 1)));
    for (let v = 1; v <= vezes; v++) {
      if (itens.length >= max) {
        passou = true;
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
        kit_id: operacao === "gerar_do_prompt" ? kitId : operacao === "variar_imagem" ? ((d.kit_id as string | null) || null) : null,
        clone_id: clone,
        vez: v,
        vezes,
      };
      pedidos[refDoItem] = pedido;
      itens.push({
        ref: refDoItem,
        alvo_id: alvo.id,
        titulo: `${alvo.titulo}${vezes > 1 ? ` (${v} de ${vezes})` : ""}`.slice(0, 200),
        detalhe: `${alvo.ref} · ${resumoDoPedido(pedido)}${prompt && operacao !== "gerar_do_prompt" ? ` · prompt ${prompt.ref}` : ""}`.slice(0, 160),
        operacao,
        rotulo: ROTULO_DA_GERACAO[operacao],
        para: null,
      });
    }
  }
  if (passou) recusados.push({ ref: "-", titulo: "Fotos a mais", operacao: "limite", motivo: `No máximo ${max} fotos por pedido. Peça o resto depois.` });
  if (!itens.length && !recusados.length) return null;
  const n = itens.length;
  return {
    tipo: "acao_agente",
    agente: AGENTE_DE_GERACAO,
    id: opcoes.id || `geracao-${Date.now().toString(36)}`,
    resumo: n ? `Vou gerar ${n} ${n === 1 ? "foto" : "fotos"}, uma por vez. O custo aparece antes de confirmar.` : "Nada para gerar.",
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

/**
 * A chamada que a Mesa Foto já tem para cada item (sem inventar executor):
 * clone -> clone_variacao_gerar; variação de foto do clone -> clone_variacao_gerar
 * (ou clone_variacao_refazer sem pedido); variação de foto de produto -> preparar
 * (cenário novo); prompt ou book -> book_gerar (o book do produto é criado se faltar).
 */
export function chamadaDaGeracao(
  pd: PedidoDaGeracao,
  clientId: string,
  opcoes: { bookId?: string | null; marcaId?: string | null } = {},
): { acao: string; corpo: Record<string, unknown>; precisaDeBook?: { kit_id: string } } {
  const livre = textoLivreDaVez(pd);
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

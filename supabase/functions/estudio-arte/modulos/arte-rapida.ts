/**
 * Arte rápida (frente AE, 28/09): a arte avulsa, fora do plano do mês.
 *
 * Pedido do dono: "melhore esta arte que o cliente mandou"; "subir a foto de
 * uma pessoa ou de um evento (palestrante) e criar a arte ou o carrossel";
 * "faça uma promoção do mouse com estas informações"; "ponha estas logos
 * nesta imagem". Entra por texto e/ou arquivos, reconhece sozinho se é arte
 * única ou carrossel, tem histórico para voltar e ajustar, e no fim vai para
 * a Agenda com a data confirmada.
 *
 * Decisão: sem motor novo. A arte rápida é um trabalho do Estúdio
 * (estudio_trabalhos, tipo 'social', sem SQL novo) ainda sem item da Agenda
 * (task_id nulo), marcado com `direcao.arte_rapida`. A direção nasce pelo
 * MESMO diretor de arte do `preparar` (marca, trava de tipografia, acervo,
 * referências, cérebro do cliente, campanha); a geração, a conferência, os
 * ajustes, a conversa com o diretor e a legenda são os de sempre. Ao levar
 * para a Agenda, o item nasce pelo escritor editorial (mesmo caminho do post
 * de fotos) e o trabalho ganha o task_id: daí valem a entrega em Arquivos,
 * a Agenda, a data confirmada e a aprovação do cliente, sem caminho novo.
 *
 * Arquivos do pedido: as imagens sobem para mesa/<cliente>/pedidos/ (as do
 * acervo, como as da Mesa Foto, vão pelo id) e cada uma tem um papel:
 * - foto: foto real (pessoa, evento, produto, ambiente) que entra como está,
 *   base da lâmina (fotos_livres fundo ou imagens_ids do acervo);
 * - logo: logo de parceiro, patrocinador ou do evento, aplicada como está
 *   (fotos_livres elemento, até 2 por lâmina);
 * - arte_para_melhorar: a arte que o cliente mandou; o diretor lê e refaz
 *   com a marca;
 * - referencia: composição ou clima; o diretor olha, sem copiar;
 * - rosto (frente RO, 29/09): foto de uma pessoa usada só pela IDENTIDADE
 *   (Rosto (identidade)): o gerador cria uma cena nova com ela, na pose, luz e
 *   composição da direção; a foto não é colada. "foto" passa a ser a Foto
 *   exata. Em "Automático" o Jev decide também exata ou rosto pelo pedido
 *   (_shared/uso-da-foto.ts).
 * PDF, Word e texto são lidos no navegador (leituraDeArquivos.ts) e chegam
 * como texto.
 *
 * 02/10: até 16 imagens, com os papéis na tela em palavras simples
 * (Referência, Fazer igual = arte_para_melhorar, Compor = foto, Logo, Rosto,
 * Automático); o post do Instagram colado (modulos/post-do-instagram.ts) com
 * 3 modos; a vitrine de logos para apresentar parceiros
 * (modulos/vitrine-de-logos.ts); e o título da arte vindo do texto escrito
 * nela (tituloDaArte), não do pedido.
 *
 * Julgamento de linguagem pelo Jev (Choice): arte única ou carrossel, qual
 * campanha o pedido cita e o papel de cada arquivo que a equipe deixou em
 * "Automático". A equipe sempre pode decidir antes (vale sobre o Jev); sem
 * o Jev, regras fixas simples.
 *
 * Sem import de Deno nem de npm: a tela, as funções e os testes leem o mesmo
 * arquivo. Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

import { rotuloDoTipo, tipoDaCampanha } from "../../_shared/tipos-de-campanha.ts";
import { decidirUso, perguntaDoUso, ROTULO_DO_USO } from "./uso-da-foto.ts";
import {
  codigoDoPostDoInstagram,
  ehImagemDoPost,
  MAX_CHARS_DA_LEGENDA,
  type ModoDoPost,
  modoDoPostValido,
  ROTULO_DO_MODO_DO_POST,
  usaConteudoDoPost,
  usaImagensDoPost,
} from "./post-do-instagram.ts";
import {
  distribuirLogosNasLaminas,
  laminasDoCarrosselDaVitrine,
  type LogoDaVitrine,
  MAX_LOGOS_NA_VITRINE_POR_LAMINA,
  MAX_LOGOS_NUMA_LAMINA,
  MIN_LOGOS_PARA_VITRINE,
  pedeVitrinePelaRegra,
} from "./vitrine-de-logos.ts";
import { type LeituraDosCards, leituraGravada, leituraParaODiretor, MAX_CARDS_LIDOS } from "./leitura-dos-cards.ts";
import { type Fidelidade, fidelidadeValida, ROTULO_DA_FIDELIDADE } from "./fidelidade-do-conteudo.ts";
import { mundoRealPelaRegra, perguntaDoMundoReal } from "./mundo-real.ts";

// ------------------------------------------------------------------ constantes

/** Marca do trabalho do estúdio que é arte rápida (direcao.arte_rapida). */
export const MARCA_ARTE_RAPIDA = "arte_rapida";
/** Parâmetro do endereço do Estúdio: `rapida=nova` ou `rapida=<trabalho_id>`. */
export const PARAMETRO_DA_ARTE_RAPIDA = "rapida";
export const NOVA_ARTE_RAPIDA = "nova";

/** 02/10 (dono: "mais imagens, com papel claro"): até 16 por pedido. As outras mesas seguem com o teto delas. */
export const MAX_IMAGENS_DA_ARTE_RAPIDA = 16;
/** Imagens do pedido (sem as logos) que o diretor vê anexadas; o resto ele lê pelo nome e pelo papel. */
export const MAX_IMAGENS_VISTAS_PELO_DIRETOR = 8;
/** Lâminas de um carrossel (o diretor faz até 10). */
export const MAX_LAMINAS_DA_ARTE_RAPIDA = 10;
export const MAX_DOCUMENTOS_DA_ARTE_RAPIDA = 4;
/** Texto dos documentos que chega ao diretor (somado). */
export const MAX_CHARS_DOS_DOCUMENTOS = 12_000;
export const MAX_CHARS_DO_PEDIDO = 3_000;
/** Logos por lâmina (o gerador compõe até 2 elementos). */
export const MAX_LOGOS_POR_LAMINA = 2;

export const PAPEIS_DO_ARQUIVO = ["foto", "rosto", "logo", "arte_para_melhorar", "referencia"] as const;
export type PapelDoArquivo = (typeof PAPEIS_DO_ARQUIVO)[number];
export type PapelPedido = PapelDoArquivo | "auto";

/** Papel como o diretor lê (vai em item.pedido_avulso.imagens). */
export const ROTULO_DO_PAPEL: Record<PapelDoArquivo, string> = {
  foto: "Compor (foto exata)",
  rosto: "Rosto (identidade)",
  logo: "Logo",
  arte_para_melhorar: "Fazer igual",
  referencia: "Referência",
};

/** 02/10: o nome curto de cada papel na tela, na ordem do seletor (Automático vem antes). */
export const ROTULO_CURTO_DO_PAPEL: Record<PapelDoArquivo, string> = {
  referencia: "Referência",
  arte_para_melhorar: "Fazer igual",
  foto: "Compor",
  logo: "Logo",
  rosto: "Rosto",
};
export const PAPEIS_NA_TELA: PapelDoArquivo[] = ["referencia", "arte_para_melhorar", "foto", "logo", "rosto"];

export const DICA_DO_PAPEL: Record<PapelDoArquivo, string> = {
  foto: "Compor: Foto exata (pessoa, evento, produto, elemento) que entra na arte como está, sem ser refeita",
  rosto: "Rosto: só a identidade da pessoa; o gerador cria uma cena nova com ela, em outra pose, coerente com o tema",
  logo: "Logo de parceiro ou do evento: aplicada como está, nunca redesenhada",
  arte_para_melhorar: "Fazer igual: reproduz esta arte com fidelidade (layout, estrutura e conteúdo) e melhora os detalhes, com a marca",
  referencia: "Referência: inspira estilo, composição ou clima; não é copiada",
};

/** Código do arquivo para o diretor (F1, P1, L1, A1, R1). P = pessoa (rosto, identidade). */
const PREFIXO_DO_PAPEL: Record<PapelDoArquivo, string> = { foto: "F", rosto: "P", logo: "L", arte_para_melhorar: "A", referencia: "R" };

export type PecaDaArteRapida = "unica" | "carrossel";
export type PecaPedida = PecaDaArteRapida | "auto";
export const ROTULO_DA_PECA: Record<PecaDaArteRapida, string> = { unica: "Arte única", carrossel: "Carrossel" };

/** Quem decidiu: a equipe na tela, o Jev ou a regra fixa (sem o Jev). */
export type QuemDecidiu = "equipe" | "jev" | "regra";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v: unknown, max: number) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, max);
/** Mantém as quebras de linha (pedido e documentos). */
const textoLongo = (v: unknown, max: number) => (v == null ? "" : String(v)).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
/** Sem travessão no que vai para a tela (regra da casa). */
const semTravessao = (t: string) => t.replace(/\s*[–—]\s*/g, ", ");

// ------------------------------------------------------------------ tipos

export interface ArquivoPedido {
  /** Imagem do acervo (cliente_imagens), como as fotos da Mesa Foto. */
  imagem_id?: string | null;
  /** Imagem enviada no pedido: caminho no bucket mesa, na pasta do cliente. */
  caminho?: string | null;
  nome: string;
  papel: PapelPedido;
}

export interface ArquivoDaArteRapida {
  codigo: string;
  imagem_id: string | null;
  caminho: string | null;
  nome: string;
  papel: PapelDoArquivo;
  papel_por: QuemDecidiu;
}

export interface DocumentoDaArteRapida {
  nome: string;
  texto: string;
}

/** Post do Instagram colado no pedido (02/10): o conteúdo, as imagens e como usar. */
export interface PostDoPedido {
  url: string;
  codigo: string;
  autor: string | null;
  legenda: string;
  modo: ModoDoPost;
  /** 02/10: as imagens do post (caminhos na pasta do cliente) para ler o texto dos cards, em qualquer modo que usa o conteúdo. */
  imagens?: string[];
}

/** Vitrine de logos (02/10): o pedido apresenta parceiros e as logos entram numa grade, pelo código. */
export interface VitrineDaArteRapida {
  por: QuemDecidiu;
  confianca: number | null;
  logos: number;
}

/** O que fica gravado em direcao.arte_rapida. */
export interface ArteRapida {
  pedido: string;
  titulo: string;
  peca: PecaDaArteRapida;
  peca_por: QuemDecidiu;
  peca_confianca: number | null;
  campanha_id: string | null;
  campanha_por: QuemDecidiu | null;
  arquivos: ArquivoDaArteRapida[];
  documentos: { nome: string; caracteres: number }[];
  criada_em: string;
  criada_por: string | null;
  avisos: string[];
  /** Levada para a Agenda: o item criado e a data. */
  levada_em?: string | null;
  task_id?: string | null;
  data?: string | null;
  /** Deletar = arquivar: sai do histórico, nada é apagado. */
  arquivada_em?: string | null;
  /** 02/10: o post do Instagram do pedido e a vitrine de logos (parceiros). */
  post?: PostDoPedido | null;
  vitrine?: VitrineDaArteRapida | null;
  /** 02/10: Idêntico, Próximo ou Criativo ao conteúdo de referência (post ou Fazer igual) e o texto lido dos cards. */
  fidelidade?: Fidelidade | null;
  fidelidade_por?: QuemDecidiu | null;
  leitura_dos_cards?: LeituraDosCards | null;
  /** 02/10: o pedido fala de produto, app, marca ou tela real (pesquisa ligada e logos reais). */
  mundo_real?: { por: QuemDecidiu; marcas: string[]; tutorial: boolean } | null;
}

/** Pedido já limpo (o que a função aceita). */
export interface PedidoDaArteRapida {
  pedido: string;
  peca: PecaPedida;
  /** id da campanha, "auto" (o Jev procura no pedido) ou null (sem campanha). */
  campanha: string | "auto" | null;
  arquivos: ArquivoPedido[];
  documentos: DocumentoDaArteRapida[];
  laminas: number | null;
  post: PostDoPedido | null;
  /** 02/10: a fidelidade escolhida na tela (null: o padrão pelo pedido). */
  fidelidade: Fidelidade | null;
}

// ------------------------------------------------------------------ leitura

export function ehArteRapida(direcao: unknown): boolean {
  if (!direcao || typeof direcao !== "object") return false;
  const a = (direcao as Record<string, unknown>)[MARCA_ARTE_RAPIDA];
  return !!a && typeof a === "object" && !Array.isArray(a);
}

function papelValido(v: unknown): PapelDoArquivo | null {
  return (PAPEIS_DO_ARQUIVO as readonly string[]).indexOf(String(v)) >= 0 ? (v as PapelDoArquivo) : null;
}

/** A arte rápida gravada na direção, em forma fixa, ou null. */
export function arteRapidaDa(direcao: unknown): ArteRapida | null {
  if (!ehArteRapida(direcao)) return null;
  const o = (direcao as Record<string, unknown>)[MARCA_ARTE_RAPIDA] as Record<string, unknown>;
  const arquivos: ArquivoDaArteRapida[] = (Array.isArray(o.arquivos) ? o.arquivos : [])
    .map((x) => {
      const a = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const papel = papelValido(a.papel);
      if (!papel) return null;
      return {
        codigo: texto(a.codigo, 8),
        imagem_id: typeof a.imagem_id === "string" && UUID.test(a.imagem_id) ? a.imagem_id : null,
        caminho: typeof a.caminho === "string" && a.caminho ? texto(a.caminho, 300) : null,
        nome: texto(a.nome, 120),
        papel,
        papel_por: a.papel_por === "jev" || a.papel_por === "regra" ? (a.papel_por as QuemDecidiu) : "equipe",
      };
    })
    .filter((a): a is ArquivoDaArteRapida => !!a);
  const confianca = typeof o.peca_confianca === "number" && isFinite(o.peca_confianca) ? o.peca_confianca : null;
  const v = (o.vitrine && typeof o.vitrine === "object" ? o.vitrine : null) as Record<string, unknown> | null;
  return {
    pedido: textoLongo(o.pedido, MAX_CHARS_DO_PEDIDO),
    // 02/10 (dono): o nome da arte é o título escrito NELA (a headline da primeira lâmina); o do pedido só antes do diretor.
    titulo: tituloDaArte((direcao as Record<string, unknown>).cards) || texto(o.titulo, 120) || "Arte rápida",
    peca: o.peca === "carrossel" ? "carrossel" : "unica",
    peca_por: o.peca_por === "jev" || o.peca_por === "regra" ? (o.peca_por as QuemDecidiu) : "equipe",
    peca_confianca: confianca,
    campanha_id: typeof o.campanha_id === "string" && UUID.test(o.campanha_id) ? o.campanha_id : null,
    campanha_por: o.campanha_por === "jev" || o.campanha_por === "equipe" || o.campanha_por === "regra" ? (o.campanha_por as QuemDecidiu) : null,
    arquivos,
    documentos: (Array.isArray(o.documentos) ? o.documentos : [])
      .map((d) => {
        const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
        return { nome: texto(x.nome, 120), caracteres: Math.max(0, Math.round(Number(x.caracteres) || 0)) };
      })
      .filter((d) => d.nome),
    criada_em: texto(o.criada_em, 40),
    criada_por: typeof o.criada_por === "string" ? o.criada_por : null,
    avisos: (Array.isArray(o.avisos) ? o.avisos : []).map((a) => texto(a, 300)).filter(Boolean).slice(0, 6),
    levada_em: typeof o.levada_em === "string" ? o.levada_em : null,
    task_id: typeof o.task_id === "string" && UUID.test(o.task_id) ? o.task_id : null,
    data: typeof o.data === "string" ? texto(o.data, 10) : null,
    arquivada_em: typeof o.arquivada_em === "string" ? o.arquivada_em : null,
    post: postDoCorpo(o.post),
    vitrine: v
      ? {
        por: v.por === "jev" || v.por === "regra" ? (v.por as QuemDecidiu) : "equipe",
        confianca: typeof v.confianca === "number" && isFinite(v.confianca) ? v.confianca : null,
        logos: Math.max(0, Math.round(Number(v.logos) || 0)),
      }
      : null,
    fidelidade: fidelidadeValida(o.fidelidade),
    fidelidade_por: o.fidelidade_por === "jev" || o.fidelidade_por === "regra" ? (o.fidelidade_por as QuemDecidiu) : o.fidelidade ? "equipe" : null,
    leitura_dos_cards: leituraGravada(o.leitura_dos_cards),
    mundo_real: mundoRealGravado(o.mundo_real),
  };
}

function mundoRealGravado(v: unknown): ArteRapida["mundo_real"] {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  return {
    por: m.por === "jev" ? "jev" : "regra",
    marcas: (Array.isArray(m.marcas) ? m.marcas : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 6),
    tutorial: m.tutorial === true,
  };
}

/** Corta uma frase em até `max` caracteres na última palavra inteira, com reticências. */
function cortarTitulo(frase: string, max: number): string {
  if (frase.length <= max) return frase.charAt(0).toUpperCase() + frase.slice(1);
  const corte = frase.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  const base = (espaco > max / 2 ? corte.slice(0, espaco) : corte).replace(/[,;:]+$/, "");
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}...`;
}

/**
 * Título da arte pelo que está ESCRITO nela (02/10, dono: "o nome tem que ser
 * o título que está na arte, não o meu pedido"): a headline da primeira
 * lâmina (blocos com papel headline) ou, sem blocos, a primeira linha do
 * texto exato. Null sem lâmina com texto.
 */
export function tituloDaArte(cards: unknown): string | null {
  const lista = (Array.isArray(cards) ? cards : []).filter((c) => c && typeof c === "object") as Record<string, unknown>[];
  if (!lista.length) return null;
  const primeira = lista.slice().sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))[0];
  const blocos = (Array.isArray(primeira.blocos) ? primeira.blocos : []).filter((b) => b && typeof b === "object") as Record<string, unknown>[];
  const headline = blocos.filter((b) => b.papel === "headline").map((b) => String(b.texto == null ? "" : b.texto)).filter((t) => t.trim())[0];
  const exato = String(primeira.texto_exato == null ? "" : primeira.texto_exato);
  const linha = exato.split("\n").map((t) => t.trim()).filter(Boolean)[0];
  // Blocos antigos (o texto exato mudou num ajuste e os blocos não): vale a primeira linha do texto exato.
  const headlineValida = headline && (!exato.trim() || texto(exato, 4000).toLowerCase().indexOf(texto(headline, 400).toLowerCase()) >= 0) ? headline : "";
  const limpo = semTravessao(texto(headlineValida || linha || "", 300)).replace(/[*_#]+/g, "").trim();
  if (limpo.replace(/[^0-9A-Za-zÀ-ÿ]/g, "").length < 2) return null;
  return cortarTitulo(limpo, 70);
}

/** A direção com o título da arte rápida igual ao da arte (depois do diretor ou de uma mudança no texto da capa). */
export function comTituloDaArte<D>(direcao: D): D {
  if (!ehArteRapida(direcao)) return direcao;
  const d = direcao as unknown as Record<string, unknown>;
  const titulo = tituloDaArte(d.cards);
  const atual = d[MARCA_ARTE_RAPIDA] as Record<string, unknown>;
  if (!titulo || atual.titulo === titulo) return direcao;
  return { ...d, [MARCA_ARTE_RAPIDA]: { ...atual, titulo } } as unknown as D;
}

/** O post do Instagram do corpo (ou gravado), limpo; null sem link válido ou sem modo. */
export function postDoCorpo(v: unknown): PostDoPedido | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const c = codigoDoPostDoInstagram(o.url);
  const modo = modoDoPostValido(o.modo);
  if (!c || !modo) return null;
  const autor = typeof o.autor === "string" && /^[A-Za-z0-9._]{1,30}$/.test(o.autor) ? o.autor : null;
  // 02/10: só imagens da pasta deste post (a função confere ainda que são da pasta do cliente).
  const imagens = (Array.isArray(o.imagens) ? o.imagens : [])
    .filter((x): x is string => typeof x === "string" && x.indexOf(`/pedidos/instagram/${c.codigo}/`) > 0 && x.indexOf("..") < 0 && x.length <= 300)
    .slice(0, MAX_CARDS_LIDOS);
  const post: PostDoPedido = { url: `https://www.instagram.com/${c.tipo}/${c.codigo}/`, codigo: c.codigo, autor, legenda: textoLongo(o.legenda, MAX_CHARS_DA_LEGENDA), modo };
  if (imagens.length) post.imagens = imagens;
  return post;
}

/** Título curto a partir do pedido: a primeira frase, até 60 caracteres, sem travessão. */
export function tituloDoPedido(pedido: string): string {
  const limpo = semTravessao(texto(pedido, 400));
  if (!limpo) return "Arte rápida";
  const fim = limpo.search(/[.!?\n]/);
  const frase = (fim > 0 ? limpo.slice(0, fim) : limpo).trim();
  return cortarTitulo(frase, 60);
}

/** Papel pelo nome do arquivo (o que dá para saber sem olhar a imagem), ou null. */
export function papelPeloNome(nome: string): PapelDoArquivo | null {
  const n = String(nome || "").toLowerCase();
  if (/(^|[^a-z])(logo|logotipo|logomarca|marca|brand|patrocin|parceir|apoio)/.test(n)) return "logo";
  if (/(^|[^a-z])(arte|post|flyer|folder|banner|cartaz|panfleto|convite|story)/.test(n)) return "arte_para_melhorar";
  if (/(^|[^a-z])(ref|referencia|inspira|pinterest)/.test(n)) return "referencia";
  return null;
}

/** Peça pelas palavras do pedido (a regra fixa, sem o Jev), ou null quando o pedido não diz. */
export function pecaPelaRegra(pedido: string): PecaDaArteRapida | null {
  const p = String(pedido || "").toLowerCase();
  if (/carross|l[aâ]minas|slides|sequ[eê]ncia de posts|passo a passo/.test(p)) return "carrossel";
  if (/arte [uú]nica|post [uú]nico|post est[aá]tico|um post|uma arte|uma imagem|flyer|banner|cartaz|panfleto|convite|story|stories/.test(p)) return "unica";
  return null;
}

/** Pedido do corpo da função, limpo (a tela usa o mesmo para montar o corpo). */
export function normalizarPedidoDaArteRapida(corpo: Record<string, unknown>, clientId: string): PedidoDaArteRapida {
  const pedido = textoLongo(corpo.pedido, MAX_CHARS_DO_PEDIDO);
  const peca: PecaPedida = corpo.peca === "unica" || corpo.peca === "carrossel" ? corpo.peca : "auto";
  const campanhaBruta = typeof corpo.campanha_id === "string" ? corpo.campanha_id.trim() : "";
  const campanha = campanhaBruta === "auto" ? "auto" : UUID.test(campanhaBruta) ? campanhaBruta.toLowerCase() : null;
  const post = postDoCorpo(corpo.post_do_instagram);
  const vistos: Record<string, true> = {};
  const arquivos: ArquivoPedido[] = [];
  for (const x of Array.isArray(corpo.arquivos) ? corpo.arquivos : []) {
    const a = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const imagemId = typeof a.imagem_id === "string" && UUID.test(a.imagem_id) ? a.imagem_id.toLowerCase() : null;
    const caminho = !imagemId && typeof a.caminho === "string" ? a.caminho.trim() : "";
    // Só da pasta do cliente, sem subir de pasta.
    const caminhoOk = !!caminho && caminho.indexOf(`${clientId}/`) === 0 && caminho.indexOf("..") < 0 && caminho.length <= 300;
    if (!imagemId && !caminhoOk) continue;
    const chave = imagemId || caminho;
    if (vistos[chave]) continue;
    vistos[chave] = true;
    // Imagens do post do Instagram: só com o post e num modo que usa as imagens; entram como referência.
    const doPost = ehImagemDoPost(clientId, caminho);
    if (doPost && (!post || !usaImagensDoPost(post.modo))) continue;
    const papel = papelValido(a.papel) || (doPost ? "referencia" : "auto");
    arquivos.push({ imagem_id: imagemId, caminho: imagemId ? null : caminho, nome: texto(a.nome, 120) || "imagem", papel });
    if (arquivos.length >= MAX_IMAGENS_DA_ARTE_RAPIDA) break;
  }
  let orcamento = MAX_CHARS_DOS_DOCUMENTOS;
  const documentos: DocumentoDaArteRapida[] = [];
  for (const x of Array.isArray(corpo.documentos) ? corpo.documentos : []) {
    const d = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const t = textoLongo(d.texto, orcamento);
    if (!t) continue;
    documentos.push({ nome: texto(d.nome, 120) || "arquivo", texto: t });
    orcamento -= t.length;
    if (orcamento <= 0 || documentos.length >= MAX_DOCUMENTOS_DA_ARTE_RAPIDA) break;
  }
  const n = Number(corpo.laminas);
  const laminas = Number.isInteger(n) && n >= 2 && n <= 10 ? n : null;
  // A imagem do post para a leitura dos cards tem que ser da pasta do cliente.
  if (post && post.imagens) {
    post.imagens = post.imagens.filter((c) => ehImagemDoPost(clientId, c));
    if (!post.imagens.length) delete post.imagens;
  }
  return { pedido, peca, campanha, arquivos, documentos, laminas, post, fidelidade: fidelidadeValida(corpo.fidelidade) };
}

// ------------------------------------------------------------------ Jev

export interface PerguntaDeEscolha {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
}

/** 02/10: mundo real pela regra ou pelo Jev (Noul em `respostas.mundo_real`). Null: não é. */
export function decidirMundoReal(p: Pick<PedidoDaArteRapida, "pedido" | "post">, resposta: { noul?: number } | null | undefined, limiar = 0.6): { por: QuemDecidiu; marcas: string[]; tutorial: boolean } | null {
  const regra = mundoRealPelaRegra([p.pedido, p.post && usaConteudoDoPost(p.post.modo) ? p.post.legenda : ""]);
  if (regra.real) return { por: "regra", marcas: regra.marcas, tutorial: regra.tutorial };
  const prob = resposta && typeof resposta.noul === "number" && isFinite(resposta.noul) ? resposta.noul : null;
  return prob !== null && prob >= limiar ? { por: "jev", marcas: [], tutorial: false } : null;
}

export interface CampanhaCandidata {
  id: string;
  nome: string;
  objetivo?: string | null;
  identidade?: unknown;
  briefing?: unknown;
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
}

export interface PerguntasDaArteRapida {
  state: Record<string, unknown>;
  questions: Record<string, PerguntaDeEscolha>;
  /** Código da campanha na pergunta (c1, c2...) para o id. */
  campanhas: Record<string, string>;
  /** Índice do arquivo (na lista pedida) de cada pergunta de papel. */
  papeis: Record<string, number>;
  /** Frente RO: índice do arquivo de cada pergunta de uso (foto exata ou só o rosto). */
  usos: Record<string, number>;
}

const MAX_CAMPANHAS_NA_PERGUNTA = 20;

function resumoDaCampanhaParaOJev(c: CampanhaCandidata): string {
  const b = (c.briefing && typeof c.briefing === "object" ? c.briefing : {}) as Record<string, unknown>;
  const tipo = rotuloDoTipo(tipoDaCampanha(c.identidade));
  const produtos = (Array.isArray(b.produtos) ? b.produtos : [])
    .map((p) => (p && typeof p === "object" ? texto((p as Record<string, unknown>).nome, 60) : texto(p, 60)))
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  return [
    `Campanha "${texto(c.nome, 80)}"`,
    tipo ? `(${tipo.toLowerCase()})` : "",
    c.objetivo ? `: ${texto(c.objetivo, 160)}` : "",
    produtos ? `. Produtos: ${produtos}` : "",
    b.oferta ? `. Oferta: ${texto(b.oferta, 120)}` : "",
    c.periodo_inicio ? `. Período: ${c.periodo_inicio} a ${c.periodo_fim || c.periodo_inicio}` : "",
  ].join("");
}

/**
 * As perguntas ao Jev para o que a equipe deixou em "Automático" (todas na
 * mesma chamada). Sem nada automático, `questions` vem vazio (sem chamada).
 */
export function perguntasDaArteRapida(p: PedidoDaArteRapida, campanhas: CampanhaCandidata[]): PerguntasDaArteRapida {
  const questions: Record<string, PerguntaDeEscolha> = {};
  const mapaCampanhas: Record<string, string> = {};
  const papeis: Record<string, number> = {};
  const usos: Record<string, number> = {};
  const arquivos = p.arquivos.map((a, i) => ({ posicao: i + 1, nome: a.nome, do_acervo: !!a.imagem_id, papel_escolhido: a.papel === "auto" ? null : a.papel }));
  const state: Record<string, unknown> = {
    pedido: p.pedido,
    arquivos,
    documentos: p.documentos.map((d) => ({ nome: d.nome, inicio: d.texto.slice(0, 600) })),
  };
  if (p.post && usaConteudoDoPost(p.post.modo) && p.post.legenda) state.post_do_instagram = { conteudo: p.post.legenda.slice(0, 1200) };

  // 02/10: vitrine de logos (parceiros). Só com 3 ou mais imagens que podem ser logo (Logo ou Automático).
  const podemSerLogo = p.arquivos.filter((a) => a.papel === "logo" || a.papel === "auto").length;
  if (podemSerLogo >= MIN_LOGOS_PARA_VITRINE) {
    questions.vitrine = {
      type: "choice",
      instructions: "A equipe mandou várias imagens com o pedido em `pedido` (lista em `arquivos`). A peça é para APRESENTAR várias marcas juntas (parceiros, patrocinadores, apoiadores, expositores, clientes atendidos), mostrando as logos delas organizadas, ou é uma peça comum em que as imagens têm outro papel?",
      criteria: {
        vitrine: {
          what: "O pedido quer mostrar as marcas: as logos enviadas são o conteúdo principal da peça, numa grade ou mural de logos.",
          examples: ["apresentar os parceiros do evento", "post com as logos das empresas patrocinadoras", "carrossel com os nossos clientes", "agradecer aos apoiadores com as logos deles"],
        },
        comum: {
          what: "Peça comum: as imagens são fotos, referências ou a arte a refazer; logos, se houver, são só um detalhe (assinatura, faixa pequena na base).",
          examples: ["promoção do mouse com esta foto", "arte do palestrante com a logo do evento", "melhore esta arte"],
        },
      },
    };
  }

  if (p.peca === "auto") {
    questions.peca = {
      type: "choice",
      instructions: "A equipe de uma agência pediu uma peça para as redes sociais de um cliente (texto em `pedido`, imagens em `arquivos`, textos de apoio em `documentos`). Pelo que o pedido quer comunicar, a peça certa é uma arte única ou um carrossel?",
      criteria: {
        unica: {
          what: "Uma imagem só: um anúncio, um convite, um aviso, uma oferta, uma foto com título, logos aplicadas numa imagem, uma arte do cliente refeita.",
          examples: ["faça uma promoção do mouse com estas informações", "ponha estas logos nesta imagem", "melhore esta arte que o cliente mandou", "arte do palestrante para o evento de sexta"],
        },
        carrossel: {
          what: "Várias lâminas em sequência: o conteúdo tem passos, lista, várias fotos que contam uma história, várias informações que não cabem numa imagem, ou a equipe pede carrossel.",
          examples: ["carrossel com as 5 dicas de postura", "conte como foi o evento com estas fotos", "apresente os 4 palestrantes"],
        },
      },
    };
  }

  const lista = campanhas.slice(0, MAX_CAMPANHAS_NA_PERGUNTA);
  if (p.campanha === "auto" && lista.length) {
    const criteria: Record<string, unknown> = {
      nenhuma: "O pedido não cita nem pertence claramente a nenhuma destas campanhas (é uma arte avulsa da marca).",
    };
    lista.forEach((c, i) => {
      const codigo = `c${i + 1}`;
      mapaCampanhas[codigo] = c.id;
      criteria[codigo] = resumoDaCampanhaParaOJev(c);
    });
    questions.campanha = {
      type: "choice",
      instructions: "O pedido em `pedido` é para uma destas campanhas do cliente? Escolha a campanha só quando o pedido a cita (pelo nome, tema, produto ou oferta) ou claramente faz parte dela.",
      criteria,
    };
  }

  p.arquivos.forEach((a, i) => {
    if (a.papel !== "auto") return;
    const id = `papel_${i + 1}`;
    papeis[id] = i;
    questions[id] = {
      type: "choice",
      instructions: `No pedido em \`pedido\`, qual é o papel do arquivo de imagem na posição ${i + 1} de \`arquivos\` (nome "${a.nome}")? Use o que o pedido diz sobre as imagens ("esta foto", "estas logos", "a arte que o cliente mandou") e o nome do arquivo.`,
      criteria: {
        foto: { what: "Foto real de pessoa, palestrante, evento, produto, ambiente ou equipe: para entrar na arte (como está ou só com o rosto da pessoa numa cena nova)." },
        logo: { what: "Logo ou marca a aplicar na arte: parceiro, patrocinador, evento, apoio." },
        arte_para_melhorar: { what: "Uma arte já pronta (post, flyer, convite, banner) que o cliente mandou para refazer ou melhorar." },
        referencia: { what: "Referência de estilo, composição ou clima: um exemplo para seguir, não para entrar na arte." },
      },
    };
    // Frente RO: pergunta junto (em paralelo) se, sendo foto, entra exata ou só com o rosto. Só vale quando o papel sai foto.
    const idUso = `uso_${i + 1}`;
    usos[idUso] = i;
    questions[idUso] = perguntaDoUso({ caminhoDaFoto: `arquivos[${i}]`, nome: a.nome }) as PerguntaDeEscolha;
  });

  // 02/10: o pedido fala de produto, app, marca ou tela real? Só quando as palavras não decidem (com texto para ler).
  const textoDoPedido = [p.pedido, p.post && usaConteudoDoPost(p.post.modo) ? p.post.legenda : ""].filter(Boolean).join("\n");
  if (textoDoPedido.trim().length >= 12 && !mundoRealPelaRegra([textoDoPedido]).real) questions.mundo_real = perguntaDoMundoReal() as unknown as PerguntaDeEscolha;

  return { state, questions, campanhas: mapaCampanhas, papeis, usos };
}

/**
 * Confiança mínima para aceitar a campanha que o Jev achou no pedido (frente
 * AG, 28/09: "Automático" só com confiança alta; abaixo, só a marca e aviso).
 */
export const CONFIANCA_MINIMA_DA_CAMPANHA = 0.8;
/** Confiança mínima para aceitar a peça (arte única ou carrossel) e o papel de um arquivo que o Jev escolheu. */
export const CONFIANCA_MINIMA_DA_PECA = 0.7;
export const CONFIANCA_MINIMA_DO_PAPEL = 0.7;

export interface RespostaDeEscolha {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  /** Noul (mundo_real). */
  noul?: number;
}

export interface DecisoesDaArteRapida {
  peca: PecaDaArteRapida;
  peca_por: QuemDecidiu;
  peca_confianca: number | null;
  campanha_id: string | null;
  campanha_por: QuemDecidiu | null;
  arquivos: ArquivoDaArteRapida[];
  avisos: string[];
  vitrine: VitrineDaArteRapida | null;
}

/** Confiança mínima para a vitrine de logos pelo Jev. */
export const CONFIANCA_MINIMA_DA_VITRINE = 0.7;

/**
 * Junta o que a equipe escolheu, o que o Jev respondeu e as regras fixas.
 * `respostas` null = o Jev não respondeu (vale a regra).
 */
export function decidirArteRapida(
  p: PedidoDaArteRapida,
  perguntas: PerguntasDaArteRapida | null,
  respostas: Record<string, RespostaDeEscolha> | null,
): DecisoesDaArteRapida {
  const avisos: string[] = [];
  const r = respostas || {};
  const confianca = (x: RespostaDeEscolha | undefined) => (x && typeof x.confidence === "number" && isFinite(x.confidence) ? x.confidence : null);

  // Papel de cada arquivo: a equipe; senão o Jev; senão o nome; senão foto.
  const contagem: Record<PapelDoArquivo, number> = { foto: 0, rosto: 0, logo: 0, arte_para_melhorar: 0, referencia: 0 };
  const arquivos: ArquivoDaArteRapida[] = p.arquivos.map((a, i) => {
    let papel: PapelDoArquivo = "foto";
    let por: QuemDecidiu = "regra";
    if (a.papel !== "auto") {
      papel = a.papel;
      por = "equipe";
    } else {
      const id = perguntas ? Object.keys(perguntas.papeis).filter((k) => perguntas.papeis[k] === i)[0] : undefined;
      const doJev = id ? papelValido(r[id] && r[id].choice) : null;
      const certeza = id ? confianca(r[id]) : null;
      if (doJev && (certeza === null || certeza >= CONFIANCA_MINIMA_DO_PAPEL)) {
        papel = doJev;
        por = "jev";
      } else {
        const peloNome = papelPeloNome(a.nome);
        papel = peloNome || "foto";
        // O Jev respondeu com pouca certeza: a regra decide e a equipe confere.
        if (doJev && !peloNome && doJev !== papel) avisos.push(`Não ficou claro o papel de "${a.nome}": entrou como ${ROTULO_DO_PAPEL[papel].toLowerCase()}. Troque se for ${ROTULO_DO_PAPEL[doJev].toLowerCase()}.`);
      }
      // Frente RO: foto em "Automático": exata ou só o rosto, pelo Jev (confiança mínima), pela regra do pedido ou exata.
      if (papel === "foto") {
        const idUso = perguntas && perguntas.usos ? Object.keys(perguntas.usos).filter((k) => perguntas.usos[k] === i)[0] : undefined;
        const uso = decidirUso(idUso ? r[idUso] : null, p.pedido);
        if (uso.uso === "rosto") {
          papel = "rosto";
          por = uso.por;
        }
        if (uso.duvida) avisos.push(`Não ficou claro se "${a.nome}" entra como está ou só com o rosto: entrou como ${ROTULO_DO_USO.exata.toLowerCase()}. Troque para Rosto (identidade) para uma cena nova com a pessoa.`);
      }
    }
    contagem[papel] += 1;
    return { codigo: `${PREFIXO_DO_PAPEL[papel]}${contagem[papel]}`, imagem_id: a.imagem_id || null, caminho: a.caminho || null, nome: a.nome, papel, papel_por: por };
  });

  // Peça: a equipe; senão o Jev; senão a regra; senão pela quantidade de fotos.
  let peca: PecaDaArteRapida;
  let pecaPor: QuemDecidiu;
  let pecaConfianca: number | null = null;
  if (p.peca !== "auto") {
    peca = p.peca;
    pecaPor = "equipe";
  } else if (r.peca && (r.peca.choice === "unica" || r.peca.choice === "carrossel") && (confianca(r.peca) === null || (confianca(r.peca) as number) >= CONFIANCA_MINIMA_DA_PECA || !pecaPelaRegra(p.pedido))) {
    peca = r.peca.choice as PecaDaArteRapida;
    pecaPor = "jev";
    pecaConfianca = confianca(r.peca);
    // Sem regra que decida e o Jev em dúvida: segue a escolha dele, com aviso.
    if (pecaConfianca !== null && pecaConfianca < CONFIANCA_MINIMA_DA_PECA) avisos.push(`Não ficou claro se é arte única ou carrossel: fiz ${ROTULO_DA_PECA[peca].toLowerCase()}. Troque se precisar.`);
  } else {
    const pelaRegra = pecaPelaRegra(p.pedido);
    peca = pelaRegra || (contagem.foto > 2 ? "carrossel" : "unica");
    pecaPor = "regra";
  }

  // Campanha: a equipe; "auto" pelo Jev com confiança; senão nenhuma.
  let campanhaId: string | null = null;
  let campanhaPor: QuemDecidiu | null = null;
  if (p.campanha && p.campanha !== "auto") {
    campanhaId = p.campanha;
    campanhaPor = "equipe";
  } else if (p.campanha === "auto" && perguntas && r.campanha && r.campanha.choice && r.campanha.choice !== "nenhuma") {
    const id = perguntas.campanhas[r.campanha.choice];
    const c = confianca(r.campanha);
    if (id && c !== null && c >= CONFIANCA_MINIMA_DA_CAMPANHA) {
      campanhaId = id;
      campanhaPor = "jev";
    } else if (id) {
      avisos.push("O pedido parece de uma campanha, mas sem certeza: a arte seguiu só a marca. Escolha a campanha se for o caso.");
    }
  }

  // 02/10: vitrine de logos (parceiros). O Jev decide com confiança; sem o Jev (ou em dúvida), a regra do pedido.
  let vitrine: VitrineDaArteRapida | null = null;
  if (contagem.logo >= MIN_LOGOS_PARA_VITRINE) {
    const rv = r.vitrine;
    const certeza = confianca(rv);
    if (rv && rv.choice === "vitrine" && (certeza === null || certeza >= CONFIANCA_MINIMA_DA_VITRINE)) {
      vitrine = { por: "jev", confianca: certeza, logos: contagem.logo };
    } else if ((!rv || !rv.choice || (certeza !== null && certeza < CONFIANCA_MINIMA_DA_VITRINE)) && pedeVitrinePelaRegra(p.pedido)) {
      vitrine = { por: "regra", confianca: certeza, logos: contagem.logo };
    }
  }
  if (vitrine) {
    // Mais logos do que cabem numa lâmina: carrossel, quando a equipe não decidiu a peça.
    if (peca === "unica" && pecaPor !== "equipe" && contagem.logo > MAX_LOGOS_NA_VITRINE_POR_LAMINA) {
      peca = "carrossel";
      pecaPor = "regra";
    }
    if (peca === "unica" && contagem.logo > MAX_LOGOS_NUMA_LAMINA) {
      avisos.push(`Arte única leva até ${MAX_LOGOS_NUMA_LAMINA} logos: ${contagem.logo - MAX_LOGOS_NUMA_LAMINA} ficaram de fora. Peça carrossel para entrar todas.`);
    }
  }

  const fotosDaPeca = contagem.foto + contagem.rosto;
  if (peca === "unica" && fotosDaPeca > 1) {
    avisos.push(`Arte única usa uma foto só: ${fotosDaPeca - 1} ${fotosDaPeca - 1 === 1 ? "foto ficou" : "fotos ficaram"} de fora. Peça carrossel para usar todas.`);
  }
  if (peca === "carrossel" && contagem.foto > MAX_LAMINAS_DA_ARTE_RAPIDA) {
    avisos.push(`O carrossel tem até ${MAX_LAMINAS_DA_ARTE_RAPIDA} lâminas, uma foto por lâmina: ${contagem.foto - MAX_LAMINAS_DA_ARTE_RAPIDA} fotos podem ficar de fora.`);
  }
  if (!vitrine && contagem.logo > MAX_LOGOS_POR_LAMINA) {
    avisos.push(`Até ${MAX_LOGOS_POR_LAMINA} logos por lâmina entram como estão; ${contagem.logo - MAX_LOGOS_POR_LAMINA} ficaram de fora. Para apresentar todas, peça "apresentar os parceiros" (vira uma grade de logos).`);
  }
  return { peca, peca_por: pecaPor, peca_confianca: pecaConfianca, campanha_id: campanhaId, campanha_por: campanhaPor, arquivos, avisos, vitrine };
}

// ------------------------------------------------------------------ diretor

export const INSTRUCOES_DA_ARTE_RAPIDA = `ARTE RÁPIDA (pedido avulso, fora do plano do mês)
O PEDIDO DA EQUIPE É A FONTE DA VERDADE (frente AG, 28/09: a arte do mouse pediu "90% off, oferta por tempo limitado, algo bem agressivo, com selo" e a direção escreveu o contrário).
- Ordem de quem vale: 1) \`item.pedido_avulso.pedido\` (o que a equipe pediu, com as palavras dela); 2) a campanha em \`item.campanha\`; 3) a marca. O que o pedido manda pôr ENTRA na arte (desconto, percentual, prazo, preço, selo, tom agressivo), mesmo que a campanha ou uma regra da marca diga outra coisa; nunca escreva o oposto do pedido. Quando o pedido bater numa regra da marca ou da campanha (ex.: "sem urgência"), siga o pedido e diga o conflito em \`avisos_para_a_equipe\`.
- Só entra o que está no pedido, nos textos dos arquivos, na campanha escolhida ou na marca: preço, percentual, data, hora, local, loja, site, nome de pessoa, produto, especificação e promessa (frete, parcelamento, garantia, brinde) exatamente como vieram. Nunca invente um dado que falta: deixe de fora e diga em \`avisos_para_a_equipe\` o que faltou.
- Sem o bloco MUNDO REAL nesta mensagem, você não pesquisa na internet: se o pedido pede especificações ou dados que não vieram (ex.: "pesquisa o que esse mouse faz"), não invente; peça em \`avisos_para_a_equipe\` (ex.: "Mande as especificações do mouse para entrarem na arte"). Com o bloco MUNDO REAL, pesquise e cite as fontes.
- O pedido pode vir do ditado por voz, com palavras trocadas pelo som ("sell" ou "seleo" = selo; "shop" = a loja da marca). Entenda pelo contexto; se uma palavra não fizer sentido, deixe a parte dela de fora e pergunte em \`avisos_para_a_equipe\`. Nome de loja, site ou marketplace que não aparece no pedido escrito com clareza nem no contexto nunca vai para a arte.
- Peça: \`item.pedido_avulso.peca\` manda. "unica" é exatamente 1 card. "carrossel" é a quantidade que o conteúdo pede (3 a 7) ou \`item.quantidade_de_laminas_pedida\`.
- Fotos do pedido (códigos F1, F2..., papel "Compor"): fotos reais que entram como estão (Foto exata), nunca refeitas e nunca escurecidas. Para usar uma numa lâmina, ponha o código em imagem_acervo (ex.: "F1") e escreva o layout com o texto na área calma da foto. Toda foto do pedido aparece em alguma lâmina; em arte única, a F1 é a base. Letras impressas no produto da foto (modelo, marca do fabricante) nunca viram texto da arte.
- Rostos do pedido (códigos P1, P2..., "Rosto (identidade)"): a pessoa da foto, usada só pela identidade. A foto NÃO é a base: escreva em \`imagem\` uma cena NOVA com essa pessoa, coerente com o pedido, o tema e a campanha (onde ela está, o que faz, pose, gesto, ângulo, roupa se o tema pedir, luz e enquadramento), diferente da pose da foto. Ponha o código em imagem_acervo (ex.: "P1") em cada lâmina em que a pessoa aparece (pode repetir o mesmo P em várias lâminas do carrossel). Descreva a pessoa pelo papel ("a palestrante", "o dono da loja"), nunca pelos traços.
- Logos do pedido (L1, L2...): logos de parceiros, patrocinadores ou do evento, anexadas pela equipe. Entram como estão, alinhadas e legíveis (faixa de logos na base ou junto do bloco de texto), sempre com a logo da marca do cliente também. Diga no layout onde ficam; nunca invente logo.
- Fazer igual (A1...): a arte que a equipe quer reproduzida. Mantenha o layout, a estrutura, a hierarquia e todo o conteúdo dela (textos e informações) e melhore os detalhes: alinhamento, acabamento, legibilidade e a identidade da marca do cliente (fontes, cores, logo). Não invente outra composição.
- Referência (R1...): INSPIRE, NUNCA COPIE. Use a ideia, a composição ou o clima e recrie com a marca do cliente (cores, fontes, logo, voz); nunca copie texto, logo, marca nem pessoas dela. Exceção: quando o pedido manda fazer igual ("faça exatamente como está aqui", "igual", "do mesmo jeito"), reproduza a referência com fidelidade e melhore os detalhes, como em Fazer igual, sempre com a marca do cliente.
- Post do Instagram (\`item.pedido_avulso.post_do_instagram\`): post de outro perfil colado pela equipe. Com \`conteudo\`, use a ideia e as informações dele reescritas na voz da marca do cliente (nunca a legenda copiada, nunca o @ nem o nome do autor na arte). As imagens do post (R...) seguem a regra da Referência. Modo "so_conteudo": só o texto vale. Modo "so_referencia": só o visual vale; o texto vem do pedido.
- Conteúdo dos cards (\`item.pedido_avulso.conteudo_dos_cards\`, 02/10): o texto escrito em cada lâmina da referência (post ou Fazer igual), lido das imagens, com o gancho, o CTA e a estrutura. É o CONTEÚDO da peça, mais forte que a legenda. A \`fidelidade\` diz o quanto pode mudar (bloco FIDELIDADE): fora do Criativo, o gancho da capa fica.
- Vitrine de logos (\`item.pedido_avulso.vitrine_de_logos\`): a peça apresenta parceiros. As logos (L1...) entram depois, coladas pelo código numa grade organizada; você NÃO desenha nem descreve logo nenhuma e não escreve o nome das empresas. Nas lâminas de \`laminas_com_logos\`, escreva só um título curto (ex.: "Nossos parceiros") e no máximo uma linha de apoio, com o texto no topo, e peça na cena um painel liso e claro na parte de baixo, sem foto, ícone ou objeto. No carrossel, a capa apresenta o tema.
- Campanha: com \`item.campanha\`, a peça é daquela campanha (tema, cores de apoio e selo) e o selo é desenhado na arte pelo gerador, integrado à composição e com destaque, sem poluir (nunca um carimbo pequeno no canto). O preço e a oferta da campanha entram quando o pedido não disser outra coisa; o que o pedido disser vale sobre a campanha.`;

/** Contexto do pedido para o diretor (vai em item.pedido_avulso). */
export function pedidoParaODiretor(
  arte: Pick<ArteRapida, "pedido" | "peca" | "arquivos"> & Partial<Pick<ArteRapida, "post" | "vitrine" | "fidelidade" | "leitura_dos_cards">>,
  documentos: DocumentoDaArteRapida[],
  laminas?: number | null,
) {
  const saida: Record<string, unknown> = {
    pedido: arte.pedido,
    peca: arte.peca,
    imagens: arte.arquivos.map((a) => ({ codigo: a.codigo, papel: ROTULO_DO_PAPEL[a.papel], nome: a.nome })),
    textos_dos_arquivos: documentos.map((d) => ({ nome: d.nome, texto: d.texto })),
  };
  // 02/10: o texto dos cards da referência e a fidelidade (Idêntico, Próximo ou Criativo).
  if (arte.leitura_dos_cards) saida.conteudo_dos_cards = leituraParaODiretor(arte.leitura_dos_cards);
  if (arte.fidelidade) saida.fidelidade = ROTULO_DA_FIDELIDADE[arte.fidelidade];
  const post = arte.post;
  if (post) {
    saida.post_do_instagram = {
      modo: post.modo,
      autor: post.autor,
      conteudo: usaConteudoDoPost(post.modo) ? post.legenda || null : null,
      imagens: arte.arquivos.filter((a) => a.caminho && a.caminho.indexOf(`/pedidos/instagram/${post.codigo}/`) >= 0).map((a) => a.codigo),
    };
  }
  if (arte.vitrine) {
    const logos = arte.arquivos.filter((a) => a.papel === "logo").length;
    const total = arte.peca === "unica" ? 1 : laminas && laminas >= 2 ? laminas : laminasDoCarrosselDaVitrine(logos);
    const plano = distribuirLogosNasLaminas(logos, Array.from({ length: total }, (_, i) => i + 1)).porLamina;
    saida.vitrine_de_logos = {
      total_de_logos: logos,
      laminas_com_logos: Object.keys(plano).map(Number).map((o) => ({ ordem: o, logos: plano[o].length })),
    };
  }
  return saida;
}

/** Descrição do item da Agenda quando a arte rápida vai para lá. */
export function descricaoDoItemDaArteRapida(arte: Pick<ArteRapida, "pedido" | "arquivos" | "documentos"> & Partial<Pick<ArteRapida, "post">>): string {
  const partes = [`Arte rápida do Estúdio (fora do plano do mês).`, `Pedido: ${arte.pedido}`];
  if (arte.post) partes.push(`Post do Instagram (${ROTULO_DO_MODO_DO_POST[arte.post.modo].toLowerCase()}): ${arte.post.url}`);
  if (arte.arquivos.length) partes.push(`Imagens do pedido: ${arte.arquivos.map((a) => `${a.nome} (${ROTULO_DO_PAPEL[a.papel].toLowerCase()})`).join(", ")}.`);
  if (arte.documentos.length) partes.push(`Arquivos lidos: ${arte.documentos.map((d) => d.nome).join(", ")}.`);
  return partes.join("\n").slice(0, 3000);
}

// ------------------------------------------------------------------ fotos e logos nas lâminas

export interface FotoLivreDaLamina {
  caminho: string;
  papel: "fundo" | "elemento";
  nota?: string;
  /** Frente RO: "rosto" = só a identidade da pessoa; sem o campo, exata. */
  uso?: "exata" | "rosto";
  uso_por?: QuemDecidiu;
}

export interface LaminaComFotos {
  ordem: number;
  imagens_ids?: string[];
  fotos_livres?: FotoLivreDaLamina[];
  /** Frente RO: uso da foto do acervo (imagens_ids). */
  uso_do_acervo?: "exata" | "rosto";
  uso_do_acervo_por?: QuemDecidiu;
  /** 02/10: logos de parceiros desta lâmina, coladas pelo código numa grade depois da geração. */
  vitrine_de_logos?: LogoDaVitrine[];
}

const temFoto = (c: LaminaComFotos) => !!(c.imagens_ids && c.imagens_ids.length) || (c.fotos_livres || []).some((f) => f.papel === "fundo");

function porFoto(c: LaminaComFotos, a: ArquivoDaArteRapida) {
  const rosto = a.papel === "rosto";
  delete c.uso_do_acervo;
  delete c.uso_do_acervo_por;
  if (a.imagem_id) {
    c.imagens_ids = [a.imagem_id];
    c.fotos_livres = (c.fotos_livres || []).filter((f) => f.papel !== "fundo");
    // Frente RO: a foto do acervo em Rosto (identidade) vira só a identidade da pessoa.
    if (rosto) {
      c.uso_do_acervo = "rosto";
      c.uso_do_acervo_por = a.papel_por;
    }
  } else if (a.caminho) {
    c.imagens_ids = [];
    const base: FotoLivreDaLamina = rosto
      ? { caminho: a.caminho, papel: "fundo", nota: `Rosto do pedido (${a.nome}): só a identidade da pessoa, numa cena nova pela direção.`, uso: "rosto", uso_por: a.papel_por }
      : { caminho: a.caminho, papel: "fundo", nota: `Foto real do pedido (${a.nome}): entra como está, sem ser refeita nem escurecida.` };
    c.fotos_livres = [base].concat((c.fotos_livres || []).filter((f) => f.papel !== "fundo"));
  }
}

/**
 * As fotos e as logos do pedido nas lâminas. `codigos[ordem]` é o que o
 * diretor pôs em imagem_acervo (F1, F2...). Toda foto aparece em alguma
 * lâmina (as que o diretor não pôs vão, na ordem, para as lâminas sem foto;
 * em arte única, a capa fica com a F1). As logos (só as enviadas, até 2) vão
 * na capa e na última lâmina, como elemento. Devolve as lâminas mudadas.
 */
export function aplicarArquivosNasLaminas<C extends LaminaComFotos>(
  cards: C[],
  codigos: Record<number, string>,
  arquivos: ArquivoDaArteRapida[],
  peca: PecaDaArteRapida,
  vitrine: VitrineDaArteRapida | null = null,
): C[] {
  const saida = cards.map((c) => ({ ...c, imagens_ids: (c.imagens_ids || []).slice(), fotos_livres: (c.fotos_livres || []).slice() })) as C[];
  if (!saida.length) return saida;
  // Frente RO: o rosto (identidade) ocupa a lâmina como a foto, mas o mesmo P pode repetir em várias lâminas.
  const fotos = arquivos.filter((a) => a.papel === "foto" || a.papel === "rosto");
  const usadas: Record<string, true> = {};
  if (peca === "unica") {
    const capa = saida[0];
    const pedida = fotos.filter((f) => f.codigo === codigos[capa.ordem])[0] || fotos[0];
    if (pedida) {
      porFoto(capa, pedida);
      usadas[pedida.codigo] = true;
    }
  } else {
    saida.forEach((c) => {
      const f = fotos.filter((x) => x.codigo === codigos[c.ordem] && (x.papel === "rosto" || !usadas[x.codigo]))[0];
      if (f) {
        porFoto(c, f);
        usadas[f.codigo] = true;
      }
    });
    fotos.forEach((f) => {
      if (usadas[f.codigo]) return;
      const livre = saida.filter((c) => !temFoto(c))[0];
      if (!livre) return;
      porFoto(livre, f);
      usadas[f.codigo] = true;
    });
  }
  saida.forEach((c) => delete c.vitrine_de_logos);
  const todasAsLogos = arquivos.filter((a) => a.papel === "logo" && !!a.caminho);
  if (vitrine && todasAsLogos.length) {
    // 02/10: vitrine de logos. As logos não vão ao gerador: entram pelo código, numa grade, nas lâminas da distribuição.
    const plano = distribuirLogosNasLaminas(todasAsLogos.length, peca === "unica" ? [saida[0].ordem] : saida.map((c) => c.ordem)).porLamina;
    saida.forEach((c) => {
      const indices = plano[c.ordem];
      c.fotos_livres = (c.fotos_livres || []).filter((f) => f.papel !== "elemento");
      if (indices && indices.length) c.vitrine_de_logos = indices.map((i) => ({ caminho: todasAsLogos[i].caminho as string, nome: todasAsLogos[i].nome }));
    });
    return saida;
  }
  const logos = todasAsLogos.slice(0, MAX_LOGOS_POR_LAMINA);
  if (logos.length) {
    const alvos = saida.length > 1 ? [saida[0], saida[saida.length - 1]] : [saida[0]];
    alvos.forEach((c) => {
      const elementos = logos.map((l) => ({
        caminho: l.caminho as string,
        papel: "elemento" as const,
        nota: `Logo do pedido (${l.nome}): aplicar exatamente como está, sem redesenhar, legível e alinhada com as outras logos.`,
      }));
      c.fotos_livres = (c.fotos_livres || []).filter((f) => f.papel !== "elemento").concat(elementos).slice(0, 1 + MAX_LOGOS_POR_LAMINA);
    });
  }
  return saida;
}

// ------------------------------------------------------------------ tela

/**
 * 02/10 (dono: "em todo aviso, o nome do cliente"): o título de um aviso da
 * arte rápida com o cliente na frente, como os avisos da equipe ("Cliente: ...").
 */
export function tituloDoAviso(titulo: string, cliente: string | null | undefined): string {
  const nome = texto(cliente, 60);
  return nome ? `${nome}: ${titulo}` : titulo;
}

/** Endereço do Estúdio na arte rápida (nova ou uma do histórico), com fotos e campanha opcionais. */
export function linkDaArteRapida(clientId: string, alvo: string = NOVA_ARTE_RAPIDA, extras: { fotos?: string[]; campanha?: string | null } = {}): string {
  const partes = [`client=${encodeURIComponent(clientId)}`, "aba=estudio", `${PARAMETRO_DA_ARTE_RAPIDA}=${encodeURIComponent(alvo)}`];
  const fotos = (extras.fotos || []).filter((f) => UUID.test(f)).slice(0, MAX_IMAGENS_DA_ARTE_RAPIDA);
  if (fotos.length) partes.push(`fotos=${fotos.join(",")}`);
  if (extras.campanha && UUID.test(extras.campanha)) partes.push(`campanha=${extras.campanha}`);
  return `/mesa?${partes.join("&")}`;
}

/** Endereço do item na Agenda, no Estúdio (depois de levar). */
export function linkDoItemNoEstudio(clientId: string, taskId: string, data: string | null): string {
  const mes = data && /^\d{4}-\d{2}/.test(data) ? `&mes=${data.slice(0, 7)}-01` : "";
  return `/mesa?client=${encodeURIComponent(clientId)}&aba=estudio&task=${encodeURIComponent(taskId)}${mes}`;
}

/** Corpo do rapida_preparar montado pela tela. */
export function corpoDaArteRapida(c: {
  clientId: string;
  pedido: string;
  peca: PecaPedida;
  campanha: string | "auto" | null;
  arquivos: ArquivoPedido[];
  documentos: DocumentoDaArteRapida[];
  formato?: string | null;
  laminas?: number | null;
  marcaId?: string | null;
  modeloImagemId?: string | null;
  qualidade?: string | null;
  /** 02/10: o post do Instagram lido na tela (link, autor, legenda e modo). */
  post?: PostDoPedido | null;
  /** 02/10: Idêntico, Próximo ou Criativo (null: o padrão pelo pedido). */
  fidelidade?: Fidelidade | null;
}): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    acao: "rapida_preparar",
    client_id: c.clientId,
    pedido: String(c.pedido || "").trim().slice(0, MAX_CHARS_DO_PEDIDO),
    peca: c.peca,
    campanha_id: c.campanha || null,
    arquivos: c.arquivos.slice(0, MAX_IMAGENS_DA_ARTE_RAPIDA).map((a) => (a.imagem_id ? { imagem_id: a.imagem_id, nome: a.nome, papel: a.papel } : { caminho: a.caminho, nome: a.nome, papel: a.papel })),
  };
  if (c.documentos.length) corpo.documentos = c.documentos.slice(0, MAX_DOCUMENTOS_DA_ARTE_RAPIDA).map((d) => ({ nome: d.nome, texto: d.texto.slice(0, MAX_CHARS_DOS_DOCUMENTOS) }));
  if (c.formato && c.formato !== "feed_4x5") corpo.formato = c.formato;
  if (c.peca === "carrossel" && c.laminas) corpo.laminas = c.laminas;
  if (c.marcaId) corpo.marca_id = c.marcaId;
  if (c.modeloImagemId) corpo.modelo_imagem_id = c.modeloImagemId;
  if (c.qualidade) corpo.qualidade = c.qualidade;
  if (c.post) {
    const post: Record<string, unknown> = { url: c.post.url, autor: c.post.autor, legenda: c.post.legenda.slice(0, MAX_CHARS_DA_LEGENDA), modo: c.post.modo };
    if (c.post.imagens && c.post.imagens.length) post.imagens = c.post.imagens.slice(0, MAX_CARDS_LIDOS);
    corpo.post_do_instagram = post;
  }
  if (c.fidelidade) corpo.fidelidade = c.fidelidade;
  return corpo;
}

/** O pedido pode ir: tem texto, ou ao menos uma imagem ou um documento. */
export function pedidoProntoParaIr(pedido: string, arquivos: number, documentos: number, comPost = false): boolean {
  return String(pedido || "").trim().length >= 3 || arquivos > 0 || documentos > 0 || comPost;
}

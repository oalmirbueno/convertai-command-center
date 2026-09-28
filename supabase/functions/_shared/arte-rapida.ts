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
 * - referencia: composição ou clima; o diretor olha, sem copiar.
 * PDF, Word e texto são lidos no navegador (leituraDeArquivos.ts) e chegam
 * como texto.
 *
 * Julgamento de linguagem pelo Jev (Choice): arte única ou carrossel, qual
 * campanha o pedido cita e o papel de cada arquivo que a equipe deixou em
 * "Automático". A equipe sempre pode decidir antes (vale sobre o Jev); sem
 * o Jev, regras fixas simples.
 *
 * Sem import de Deno nem de npm: a tela, as funções e os testes leem o mesmo
 * arquivo. Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

import { rotuloDoTipo, tipoDaCampanha } from "./tipos-de-campanha.ts";

// ------------------------------------------------------------------ constantes

/** Marca do trabalho do estúdio que é arte rápida (direcao.arte_rapida). */
export const MARCA_ARTE_RAPIDA = "arte_rapida";
/** Parâmetro do endereço do Estúdio: `rapida=nova` ou `rapida=<trabalho_id>`. */
export const PARAMETRO_DA_ARTE_RAPIDA = "rapida";
export const NOVA_ARTE_RAPIDA = "nova";

export const MAX_IMAGENS_DA_ARTE_RAPIDA = 6;
export const MAX_DOCUMENTOS_DA_ARTE_RAPIDA = 4;
/** Texto dos documentos que chega ao diretor (somado). */
export const MAX_CHARS_DOS_DOCUMENTOS = 12_000;
export const MAX_CHARS_DO_PEDIDO = 3_000;
/** Logos por lâmina (o gerador compõe até 2 elementos). */
export const MAX_LOGOS_POR_LAMINA = 2;

export const PAPEIS_DO_ARQUIVO = ["foto", "logo", "arte_para_melhorar", "referencia"] as const;
export type PapelDoArquivo = (typeof PAPEIS_DO_ARQUIVO)[number];
export type PapelPedido = PapelDoArquivo | "auto";

export const ROTULO_DO_PAPEL: Record<PapelDoArquivo, string> = {
  foto: "Foto",
  logo: "Logo",
  arte_para_melhorar: "Arte a melhorar",
  referencia: "Referência",
};

export const DICA_DO_PAPEL: Record<PapelDoArquivo, string> = {
  foto: "Foto real (pessoa, evento, produto): entra como está, sem ser refeita",
  logo: "Logo de parceiro ou do evento: aplicada como está",
  arte_para_melhorar: "Arte que o cliente mandou: o diretor refaz com a marca",
  referencia: "Referência de composição ou clima",
};

/** Código do arquivo para o diretor (F1, L1, A1, R1). */
const PREFIXO_DO_PAPEL: Record<PapelDoArquivo, string> = { foto: "F", logo: "L", arte_para_melhorar: "A", referencia: "R" };

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
  return {
    pedido: textoLongo(o.pedido, MAX_CHARS_DO_PEDIDO),
    titulo: texto(o.titulo, 120) || "Arte rápida",
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
  };
}

/** Título curto a partir do pedido: a primeira frase, até 60 caracteres, sem travessão. */
export function tituloDoPedido(pedido: string): string {
  const limpo = semTravessao(texto(pedido, 400));
  if (!limpo) return "Arte rápida";
  const fim = limpo.search(/[.!?\n]/);
  const frase = (fim > 0 ? limpo.slice(0, fim) : limpo).trim();
  if (frase.length <= 60) return frase.charAt(0).toUpperCase() + frase.slice(1);
  const corte = frase.slice(0, 60);
  const espaco = corte.lastIndexOf(" ");
  const base = (espaco > 30 ? corte.slice(0, espaco) : corte).replace(/[,;:]+$/, "");
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}...`;
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
    const papel = papelValido(a.papel) || "auto";
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
  return { pedido, peca, campanha, arquivos, documentos, laminas };
}

// ------------------------------------------------------------------ Jev

export interface PerguntaDeEscolha {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
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
  const arquivos = p.arquivos.map((a, i) => ({ posicao: i + 1, nome: a.nome, do_acervo: !!a.imagem_id, papel_escolhido: a.papel === "auto" ? null : a.papel }));
  const state: Record<string, unknown> = {
    pedido: p.pedido,
    arquivos,
    documentos: p.documentos.map((d) => ({ nome: d.nome, inicio: d.texto.slice(0, 600) })),
  };

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
        foto: { what: "Foto real para entrar na arte como está: pessoa, palestrante, evento, produto, ambiente, equipe." },
        logo: { what: "Logo ou marca a aplicar na arte: parceiro, patrocinador, evento, apoio." },
        arte_para_melhorar: { what: "Uma arte já pronta (post, flyer, convite, banner) que o cliente mandou para refazer ou melhorar." },
        referencia: { what: "Referência de estilo, composição ou clima: um exemplo para seguir, não para entrar na arte." },
      },
    };
  });

  return { state, questions, campanhas: mapaCampanhas, papeis };
}

/** Confiança mínima para aceitar a campanha que o Jev achou no pedido. */
export const CONFIANCA_MINIMA_DA_CAMPANHA = 0.5;

export interface RespostaDeEscolha {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface DecisoesDaArteRapida {
  peca: PecaDaArteRapida;
  peca_por: QuemDecidiu;
  peca_confianca: number | null;
  campanha_id: string | null;
  campanha_por: QuemDecidiu | null;
  arquivos: ArquivoDaArteRapida[];
  avisos: string[];
}

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
  const contagem: Record<PapelDoArquivo, number> = { foto: 0, logo: 0, arte_para_melhorar: 0, referencia: 0 };
  const arquivos: ArquivoDaArteRapida[] = p.arquivos.map((a, i) => {
    let papel: PapelDoArquivo = "foto";
    let por: QuemDecidiu = "regra";
    if (a.papel !== "auto") {
      papel = a.papel;
      por = "equipe";
    } else {
      const id = perguntas ? Object.keys(perguntas.papeis).filter((k) => perguntas.papeis[k] === i)[0] : undefined;
      const doJev = id ? papelValido(r[id] && r[id].choice) : null;
      if (doJev) {
        papel = doJev;
        por = "jev";
      } else {
        papel = papelPeloNome(a.nome) || "foto";
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
  } else if (r.peca && (r.peca.choice === "unica" || r.peca.choice === "carrossel")) {
    peca = r.peca.choice as PecaDaArteRapida;
    pecaPor = "jev";
    pecaConfianca = confianca(r.peca);
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

  if (peca === "unica" && contagem.foto > 1) {
    avisos.push(`Arte única usa uma foto só: ${contagem.foto - 1} ${contagem.foto - 1 === 1 ? "foto ficou" : "fotos ficaram"} de fora. Peça carrossel para usar todas.`);
  }
  if (contagem.logo > MAX_LOGOS_POR_LAMINA) {
    avisos.push(`Até ${MAX_LOGOS_POR_LAMINA} logos por lâmina entram como estão; ${contagem.logo - MAX_LOGOS_POR_LAMINA} ficaram de fora. Junte as logos numa imagem só para entrar todas.`);
  }
  return { peca, peca_por: pecaPor, peca_confianca: pecaConfianca, campanha_id: campanhaId, campanha_por: campanhaPor, arquivos, avisos };
}

// ------------------------------------------------------------------ diretor

export const INSTRUCOES_DA_ARTE_RAPIDA = `ARTE RÁPIDA (pedido avulso, fora do plano do mês)
- O conteúdo vem de \`item.pedido_avulso\`: o pedido da equipe, os textos dos arquivos e as imagens anexadas (nesta mensagem, na ordem dos códigos). Use só o que está ali e no contexto do cliente: preço, data, hora, local, nome de pessoa e oferta exatamente como vieram; nunca invente um dado que falta (deixe de fora).
- Peça: \`item.pedido_avulso.peca\` manda. "unica" é exatamente 1 card. "carrossel" é a quantidade que o conteúdo pede (3 a 7) ou \`item.quantidade_de_laminas_pedida\`.
- Fotos do pedido (códigos F1, F2...): fotos reais que entram como estão, nunca refeitas e nunca escurecidas. Para usar uma numa lâmina, ponha o código em imagem_acervo (ex.: "F1") e escreva o layout com o texto na área calma da foto. Toda foto do pedido aparece em alguma lâmina; em arte única, a F1 é a base.
- Logos do pedido (L1, L2...): logos de parceiros, patrocinadores ou do evento, anexadas pela equipe. Entram como estão, alinhadas e legíveis (faixa de logos na base ou junto do bloco de texto), sempre com a logo da marca do cliente também. Diga no layout onde ficam; nunca invente logo.
- Arte a melhorar (A1...): a arte que o cliente mandou. Leia o texto e a intenção dela e refaça com a identidade da marca (fontes, cores, logo), mais clara e profissional, mantendo todas as informações.
- Referência (R1...): composição ou clima para seguir; nunca copie texto nem marca dela.
- Campanha: com \`item.campanha\`, a peça é daquela campanha (tema, oferta, preço, cores de apoio e selo) e o selo entra pequeno, sem poluir.`;

/** Contexto do pedido para o diretor (vai em item.pedido_avulso). */
export function pedidoParaODiretor(arte: Pick<ArteRapida, "pedido" | "peca" | "arquivos">, documentos: DocumentoDaArteRapida[]) {
  return {
    pedido: arte.pedido,
    peca: arte.peca,
    imagens: arte.arquivos.map((a) => ({ codigo: a.codigo, papel: ROTULO_DO_PAPEL[a.papel], nome: a.nome })),
    textos_dos_arquivos: documentos.map((d) => ({ nome: d.nome, texto: d.texto })),
  };
}

/** Descrição do item da Agenda quando a arte rápida vai para lá. */
export function descricaoDoItemDaArteRapida(arte: Pick<ArteRapida, "pedido" | "arquivos" | "documentos">): string {
  const partes = [`Arte rápida do Estúdio (fora do plano do mês).`, `Pedido: ${arte.pedido}`];
  if (arte.arquivos.length) partes.push(`Imagens do pedido: ${arte.arquivos.map((a) => `${a.nome} (${ROTULO_DO_PAPEL[a.papel].toLowerCase()})`).join(", ")}.`);
  if (arte.documentos.length) partes.push(`Arquivos lidos: ${arte.documentos.map((d) => d.nome).join(", ")}.`);
  return partes.join("\n").slice(0, 3000);
}

// ------------------------------------------------------------------ fotos e logos nas lâminas

export interface FotoLivreDaLamina {
  caminho: string;
  papel: "fundo" | "elemento";
  nota?: string;
}

export interface LaminaComFotos {
  ordem: number;
  imagens_ids?: string[];
  fotos_livres?: FotoLivreDaLamina[];
}

const temFoto = (c: LaminaComFotos) => !!(c.imagens_ids && c.imagens_ids.length) || (c.fotos_livres || []).some((f) => f.papel === "fundo");

function porFoto(c: LaminaComFotos, a: ArquivoDaArteRapida) {
  if (a.imagem_id) {
    c.imagens_ids = [a.imagem_id];
    c.fotos_livres = (c.fotos_livres || []).filter((f) => f.papel !== "fundo");
  } else if (a.caminho) {
    c.imagens_ids = [];
    const base: FotoLivreDaLamina = { caminho: a.caminho, papel: "fundo", nota: `Foto real do pedido (${a.nome}): entra como está, sem ser refeita nem escurecida.` };
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
): C[] {
  const saida = cards.map((c) => ({ ...c, imagens_ids: (c.imagens_ids || []).slice(), fotos_livres: (c.fotos_livres || []).slice() })) as C[];
  if (!saida.length) return saida;
  const fotos = arquivos.filter((a) => a.papel === "foto");
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
      const f = fotos.filter((x) => x.codigo === codigos[c.ordem] && !usadas[x.codigo])[0];
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
  const logos = arquivos.filter((a) => a.papel === "logo" && !!a.caminho).slice(0, MAX_LOGOS_POR_LAMINA);
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
  return corpo;
}

/** O pedido pode ir: tem texto, ou ao menos uma imagem ou um documento. */
export function pedidoProntoParaIr(pedido: string, arquivos: number, documentos: number): boolean {
  return String(pedido || "").trim().length >= 3 || arquivos > 0 || documentos > 0;
}

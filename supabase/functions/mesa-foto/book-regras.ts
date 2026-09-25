/**
 * Área "Book" da Mesa Foto: regras puras (sem rede, sem banco, sem Deno; a
 * função usa em book.ts e o teste do painel importa). Pedido do dono em
 * 26/09: "dentro da Mesa Foto, uma área de BOOK: um estúdio fotográfico.
 * Pegar as referências, trabalhar em cima de cada produto ('quero o produto
 * desse jeito') ou da pessoa; já ter um arsenal de prompts lateral; colocar o
 * prompt no agente, ele gera; selecionar as imagens que eu quero; embaixo,
 * mais referências; fazer um book completo profissional".
 *
 * O Book não cria regra nova de fotografia: reaproveita as do ensaio
 * (identidade do kit primeiro, estilo depois, só como estilo), as da persona
 * sintética (ficha, hiper-realismo, sem sósia) e as do clone (pessoa real só
 * com autorização; a geração do clone é a mesma função da aba Clones). Aqui
 * ficam a leitura do que a tela manda e o prompt do produto, da persona e da
 * foto do acervo.
 */

import { ErroDeRegra, limpo, semTravessao, UUID } from "./calculos.ts";
import { conteudoProibido } from "./personas.ts";

export const ASSUNTOS_DO_BOOK = ["produto", "persona", "clone", "foto"] as const;
export type AssuntoDoBook = typeof ASSUNTOS_DO_BOOK[number];

export const STATUS_DO_BOOK = ["aberto", "entregue", "arquivado"] as const;
export type StatusDoBook = typeof STATUS_DO_BOOK[number];

/** Referências de estilo que vão em cada foto (mais que isso o gerador copia a referência). */
export const MAX_ESTILO_POR_FOTO = 3;
/** Referências guardadas no book (a tela escolhe quais vão em cada pedido; sem escolha, as primeiras). */
export const MAX_REFERENCIAS_DO_BOOK = 12;
export const MAX_PEDIDOS_DO_BOOK = 40;
export const MAX_SELECAO_DO_BOOK = 60;
export const MAX_CONVERSA_DO_BOOK = 20;

/** Formatos do book (os mesmos das variações do clone, para a geração do clone servir igual). */
export const FORMATOS_DO_BOOK: Record<string, string> = { "4:5": "1088x1360", "1:1": "1024x1024", "9:16": "1088x1920", "16:9": "1920x1088", "3:4": "1088x1456" };
export const lerFormatoDoBook = (v: unknown): string => (FORMATOS_DO_BOOK[String(v)] ? String(v) : "4:5");

export type AssuntoLido = { tipo: AssuntoDoBook; id: string };

export function lerAssunto(bruto: unknown): AssuntoLido {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const tipo = String(r.tipo ?? "") as AssuntoDoBook;
  if (!(ASSUNTOS_DO_BOOK as readonly string[]).includes(tipo)) {
    throw new ErroDeRegra(400, "assunto_invalido", "Escolha o assunto do book: um produto do kit, uma persona, um clone ou uma foto do acervo.");
  }
  const id = String(r.id ?? "").trim();
  if (!UUID.test(id)) throw new ErroDeRegra(400, "assunto_invalido", "O assunto do book precisa de um id válido.");
  return { tipo, id };
}

export type ReferenciaDoBook = { tipo: "acervo" | "biblioteca"; id: string };

/** Referências de estilo do book (acervo ou biblioteca), únicas e até o máximo. */
export function lerReferenciasDoBook(bruto: unknown, max = MAX_REFERENCIAS_DO_BOOK): ReferenciaDoBook[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  const saida: ReferenciaDoBook[] = [];
  for (const b of lista) {
    const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const tipo = r.tipo === "biblioteca" ? "biblioteca" : r.tipo === "acervo" ? "acervo" : null;
    const id = String(r.id ?? "").trim();
    if (!tipo || !UUID.test(id) || saida.some((x) => x.id === id)) continue;
    saida.push({ tipo, id });
    if (saida.length >= max) break;
  }
  return saida;
}

export type OrigemDoPedido = { tipo: "biblioteca" | "diretor" | "livre"; id: string | null };
export type PedidoDoBook = { id: string; titulo: string; prompt: string; formato: string; origem: OrigemDoPedido; referencias: string[] };

/**
 * Um pedido (uma foto): o prompt vem da biblioteca, do diretor ou da equipe.
 * Texto que pede sósia, pessoa conhecida, menor ou sexualização recusa (vale
 * para todo assunto: produto também não leva pessoa conhecida).
 */
export function lerPedidoDoBook(bruto: unknown, indice = 0): PedidoDoBook {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const prompt = semTravessao(limpo(r.prompt, 3000));
  if (!prompt) throw new ErroDeRegra(400, "pedido_vazio", "Escreva o que a foto deve mostrar (ou escolha um prompt da biblioteca).");
  // "igual à foto" e "clone" são vocabulário do estúdio; nome de pessoa conhecida continua recusado.
  const motivo = conteudoProibido(prompt.replace(/\bclones?\b/gi, " ").replace(/\bigual (?:a|ao|à)(?=\s)/gi, " "));
  if (motivo) throw new ErroDeRegra(422, motivo.codigo, motivo.mensagem);
  const o = (r.origem && typeof r.origem === "object" ? r.origem : {}) as Record<string, unknown>;
  const tipo = o.tipo === "biblioteca" || o.tipo === "diretor" ? o.tipo : "livre";
  const idOrigem = UUID.test(String(o.id ?? "")) ? String(o.id) : null;
  const id = /^[a-z0-9-]{4,40}$/i.test(String(r.id ?? "")) ? String(r.id) : `p${indice + 1}-${Math.abs(hash(prompt)).toString(36).slice(0, 6)}`;
  const referencias = Array.isArray(r.referencias) ? r.referencias.map((x) => String(x ?? "").trim()).filter((x) => UUID.test(x)).slice(0, MAX_ESTILO_POR_FOTO) : [];
  return {
    id,
    titulo: semTravessao(limpo(r.titulo, 80)) || prompt.slice(0, 60),
    prompt,
    formato: lerFormatoDoBook(r.formato),
    origem: { tipo, id: idOrigem },
    referencias,
  };
}

export function lerPedidosDoBook(bruto: unknown): PedidoDoBook[] {
  const lista = Array.isArray(bruto) ? bruto.slice(0, MAX_PEDIDOS_DO_BOOK) : [];
  const saida: PedidoDoBook[] = [];
  lista.forEach((b, i) => {
    const p = lerPedidoDoBook(b, i);
    if (!saida.some((x) => x.id === p.id)) saida.push(p);
  });
  return saida;
}

/** Seleção final em ordem: ids únicos de fotos do acervo. */
export function lerSelecaoDoBook(bruto: unknown): string[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  const saida: string[] = [];
  for (const b of lista) {
    const id = String(b ?? "").trim();
    if (UUID.test(id) && saida.indexOf(id) < 0) saida.push(id);
    if (saida.length >= MAX_SELECAO_DO_BOOK) break;
  }
  return saida;
}

function hash(t: string): number {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return h;
}

// ------------------------------------------------------------------ prompt

export type IdentidadeNoPrompt = { papel: string; nome?: string | null; vista?: string | null };

const LEGENDA_DO_PAPEL: Record<string, string> = {
  identidade: "IDENTIDADE do assunto (a verdade sobre forma, cor, material e texto)",
  rosto: "IDENTIDADE: rosto real da pessoa",
  detalhe: "DETALHE real do assunto",
  rotulo: "RÓTULO real (texto a manter igual, letra por letra)",
  verso: "VERSO real do assunto",
  corpo: "CORPO real da pessoa (proporções)",
  embalagem: "EMBALAGEM real (não é o produto; só entra quando o pedido fala da caixa)",
  foto: "A FOTO DO ACERVO: o assunto desta foto é a verdade (forma, cor, texto e detalhes)",
  ancora: "ÂNCORA da persona sintética (o rosto aprovado)",
  vista: "VISTA APROVADA da folha da persona (mesmo rosto em outro ângulo)",
};

export type AssuntoNoPrompt = {
  tipo: Exclude<AssuntoDoBook, "clone">;
  nome: string;
  /** Produto: invariantes e o que foi observado nas fotos. Persona: invariantes da ficha. */
  invariantes: string[];
  observado?: string[];
  /** Persona: a ficha em texto (fichaEmTexto). */
  ficha?: string | null;
  lacunas?: string[];
};

const REGRAS_DO_PRODUTO = [
  "o produto é EXATAMENTE o das imagens de identidade: mesma forma, proporção, cor, material, botões, peças, texto e logotipo, letra por letra",
  "não invente variante, cor nem acessório que não aparece nas fotos",
  "escala real em relação ao cenário e às mãos",
  "sem texto novo, sem marca d'água, sem logotipo de terceiros",
  "nunca escureça a foto para dar destaque; sem vinheta, sem degradê, sem HDR",
];

const REGRAS_DA_PERSONA_NO_BOOK = [
  "é a MESMA pessoa sintética das imagens de identidade (rosto, idade, pele, cabelo e marcas iguais)",
  "adulta, sem parecer pessoa real conhecida, sem sexualização",
  "mãos com cinco dedos e articulações corretas; pele real com poros, sem filtro de beleza",
  "sem texto, sem marca d'água, sem logotipo de terceiros",
  "nunca escureça a foto para dar destaque",
];

/**
 * Prompt de uma foto do book (produto, persona sintética ou foto do
 * acervo). As imagens vão na ordem: identidade do assunto, depois as
 * referências SÓ de estilo. O pedido (prompt da biblioteca, do diretor ou da
 * equipe) diz como a foto deve ser; a identidade nunca muda.
 */
export function promptDoBook(e: {
  assunto: AssuntoNoPrompt;
  identidades: IdentidadeNoPrompt[];
  estilo: string[];
  pedido: string;
  formato: string;
  direcao?: string | null;
}): string {
  const linhas: string[] = [];
  const a = e.assunto;
  const titulo = a.tipo === "persona" ? `pessoa sintética "${a.nome}"` : a.tipo === "foto" ? `o assunto da foto "${a.nome}"` : `o produto "${a.nome}"`;
  linhas.push(`BOOK FOTOGRÁFICO PROFISSIONAL de ${titulo}: UMA fotografia nova, publicitária e atual, com o assunto fiel às imagens de identidade.`);
  linhas.push("IMAGENS ANEXADAS, NA ORDEM:");
  e.identidades.forEach((i, k) => linhas.push(`Imagem ${k + 1}: ${LEGENDA_DO_PAPEL[i.papel] ?? LEGENDA_DO_PAPEL.identidade}${i.nome ? ` (${limpo(i.nome, 60)})` : ""}.`));
  e.estilo.forEach((l, k) => linhas.push(`Imagem ${e.identidades.length + k + 1}: REFERÊNCIA SÓ DE ESTILO (${limpo(l, 80) || "referência"}): use luz, cenário, composição, paleta e clima; nunca copie o objeto, as pessoas, a marca ou o texto dela.`));
  if (a.ficha) linhas.push(`FICHA DA PERSONA: ${a.ficha}`);
  if (a.invariantes.length) linhas.push(`O QUE NUNCA MUDA: ${a.invariantes.slice(0, 12).join("; ")}.`);
  if (a.observado && a.observado.length) linhas.push(`OBSERVADO NAS FOTOS REAIS: ${a.observado.slice(0, 12).join("; ")}.`);
  linhas.push(`COMO A FOTO DEVE SER (pedido do book): ${e.pedido}`);
  if (e.direcao) linhas.push(`DIREÇÃO DA MARCA: ${limpo(e.direcao, 900)}`);
  linhas.push(`FORMATO ${e.formato}. Fotografia real de marca contemporânea (não render 3D, não banco de imagem): luz com direção e sombras macias reais, cenário concreto, props com função, respiro na composição.`);
  const regras = a.tipo === "persona" ? REGRAS_DA_PERSONA_NO_BOOK : REGRAS_DO_PRODUTO;
  linhas.push(`REGRAS: ${regras.join("; ")}.`);
  if (a.lacunas && a.lacunas.length) linhas.push(`O QUE AS FOTOS NÃO MOSTRAM (não invente; deixe fora de quadro): ${a.lacunas.slice(0, 6).join("; ")}.`);
  return semTravessao(linhas.join("\n"));
}

// ------------------------------------------------------------------ diretor do book

export type RespostaDoDiretorDoBook = { resposta: string; pedidos: PedidoDoBook[]; descartados: number };

/**
 * Resposta do diretor do book: um texto curto e os pedidos que ele montou
 * (a tela põe na fila; a equipe edita, tira ou gera). Pedido que não passa
 * nas regras sai (e conta em descartados).
 */
export function normalizarRespostaDoDiretorDoBook(bruto: unknown, max = 8): RespostaDoDiretorDoBook {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lista = Array.isArray(r.pedidos) ? r.pedidos : [];
  const pedidos: PedidoDoBook[] = [];
  let descartados = 0;
  lista.forEach((b, i) => {
    if (pedidos.length >= max) return;
    try {
      const x = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      pedidos.push(lerPedidoDoBook({ titulo: x.titulo, prompt: x.prompt, formato: x.formato, origem: { tipo: "diretor" } }, i));
    } catch {
      descartados++;
    }
  });
  return { resposta: semTravessao(limpo(r.resposta, 1500)), pedidos, descartados };
}

/** Categorias da biblioteca que servem a cada assunto (a tela filtra o arsenal de prompts por elas). */
export function categoriasDoAssunto(tipo: AssuntoDoBook, tipoDoKit?: string | null): string[] {
  if (tipo === "persona" || tipo === "clone") return ["pessoa", "moda", "ambiente", "luz", "composicao", "estilo", "cenario"];
  const doKit = tipoDoKit && tipoDoKit !== "outro" && tipoDoKit !== "pessoa" ? [tipoDoKit] : [];
  return [...doKit, "produto", "ambiente", "luz", "composicao", "estilo", "cenario"].filter((x, i, l) => l.indexOf(x) === i);
}

/**
 * Peça de foto no Mês (02/10).
 *
 * Dono (Para Si Ótica): "entre os 3 posts por semana, 2 posts de foto (a gente
 * gera as fotos na mesa de fotos, com ângulos, completo) e 1 arte, um
 * carrossel normal". Até aqui "foto" virava "estatico" e a direção da foto se
 * perdia. Agora o Mês tem o formato "foto": post de foto real (produto,
 * pessoas, ambiente) produzido na Mesa Foto.
 *
 * CONTRATO com a Mesa Foto (a outra frente lê exatamente isto; não mudar sem
 * mudar lá): cada item de calendario_propostas.itens com `formato: "foto"` traz
 * `foto` = {
 *   assunto: string,            o quê / qual produto
 *   objetivo: string,
 *   angulos: string[],          ex.: "frontal", "3/4", "lateral", "detalhe da haste", "no rosto"
 *   cenario: string,
 *   luz: string,
 *   pessoa: string | null,      quem aparece (null: ninguém)
 *   quantidade: number,         fotos a produzir (padrão 4)
 *   texto_na_foto: string | null,
 *   referencias: string[]       ids ou urls (opcional, lista vazia)
 * }
 * mais data, tema e titulo como os outros itens; depois de gravar, o item
 * guarda `task_id`. Link da Mesa Foto: linkDaPecaNaMesaFoto (param `peca`).
 *
 * Sem import de Deno nem de npm: a função, a tela e os testes (vitest) leem
 * este arquivo.
 */

export const FORMATOS_DO_MES = ["carrossel", "estatico", "foto"] as const;
export type FormatoDoMes = (typeof FORMATOS_DO_MES)[number];

export const ROTULO_DO_FORMATO_DO_MES: Record<FormatoDoMes, string> = {
  carrossel: "Carrossel",
  estatico: "Estático",
  foto: "Foto",
};

/** Plural curto para a conferência ("8 fotos e 4 carrosséis"). */
export const PLURAL_DO_FORMATO: Record<FormatoDoMes, [string, string]> = {
  foto: ["foto", "fotos"],
  carrossel: ["carrossel", "carrosséis"],
  estatico: ["estático", "estáticos"],
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * O formato que o texto pede, ou null quando não dá para saber.
 * "foto", "fotos", "ensaio", "foto de produto", "post de foto", "fotografia" e
 * "carrossel de fotos" são peça de foto (a Mesa Foto faz). "imagem", "post" e
 * "static" seguem estático, como sempre foi.
 */
export function formatoDoMes(v: unknown): FormatoDoMes | null {
  const s = semAcento(String(v == null ? "" : v).trim().toLowerCase());
  if (!s) return null;
  if (/\bfotos?\b|fotograf|\bensaios?\b|\bphotos?\b/.test(s)) return "foto";
  if (s.indexOf("carross") >= 0 || s.indexOf("carous") >= 0 || s.indexOf("carrocel") >= 0) return "carrossel";
  if (s.indexOf("estat") >= 0 || s.indexOf("static") >= 0 || s === "post" || s.indexOf("imagem") >= 0) return "estatico";
  return null;
}

export const ehFormatoDoMes = (v: unknown): v is FormatoDoMes => (FORMATOS_DO_MES as readonly string[]).indexOf(String(v)) >= 0;

// ------------------------------------------------------------------ a direção da foto (contrato)

export type DirecaoDeFoto = {
  assunto: string;
  objetivo: string;
  angulos: string[];
  cenario: string;
  luz: string;
  pessoa: string | null;
  quantidade: number;
  texto_na_foto: string | null;
  referencias: string[];
};

export const QUANTIDADE_PADRAO_DE_FOTOS = 4;
export const MAX_FOTOS_DA_PECA = 10;
/** Ângulos de partida quando o modelo não disse nenhum (a equipe ajusta na Mesa Foto). */
export const ANGULOS_PADRAO = ["frontal", "3/4", "detalhe", "em uso"];

function listaCurta(v: unknown, maxItens: number, maxChars: number): string[] {
  const vistos: string[] = [];
  for (const x of Array.isArray(v) ? v : typeof v === "string" ? v.split(/[;,\n]/) : []) {
    const s = umaLinha(x, maxChars);
    if (s && vistos.map((y) => y.toLowerCase()).indexOf(s.toLowerCase()) < 0) vistos.push(s);
    if (vistos.length >= maxItens) break;
  }
  return vistos;
}

const opcional = (v: unknown, max: number): string | null => {
  const s = umaLinha(v, max);
  return s && !/^(null|nenhum|nenhuma|ninguem|ninguém|sem|n\/a|-)$/i.test(s) ? s : null;
};

/**
 * Lê a direção da foto no formato do contrato. Campo vazio vira o padrão do
 * contrato (quantidade 4, listas vazias, null); o assunto cai no tema do item.
 * Ângulos vazios ficam vazios aqui (a conferência pede ao modelo); quem
 * precisa fechar a peça sem o modelo usa direcaoDeFotoCompleta.
 */
export function normalizarDirecaoDeFoto(bruto: unknown, base: { tema?: string | null; objetivo?: string | null } = {}): DirecaoDeFoto {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const q = Math.round(Number(o.quantidade));
  return {
    assunto: umaLinha(o.assunto, 200) || umaLinha(base.tema, 200),
    objetivo: umaLinha(o.objetivo, 300) || umaLinha(base.objetivo, 300),
    angulos: listaCurta(o.angulos, 8, 60),
    cenario: umaLinha(o.cenario, 300),
    luz: umaLinha(o.luz, 200),
    pessoa: opcional(o.pessoa, 200),
    quantidade: Number.isFinite(q) && q >= 1 ? Math.min(MAX_FOTOS_DA_PECA, q) : QUANTIDADE_PADRAO_DE_FOTOS,
    texto_na_foto: opcional(o.texto_na_foto, 120),
    referencias: listaCurta(o.referencias, 12, 500),
  };
}

/** O que falta para a direção ser concreta (produto, ângulos, cenário e luz). Vazio: completa. */
export function faltasDaDirecao(d: DirecaoDeFoto | null | undefined): string[] {
  if (!d) return ["assunto", "angulos", "cenario", "luz"];
  const faltas: string[] = [];
  if (!d.assunto) faltas.push("assunto");
  if (d.angulos.length < 2) faltas.push("angulos");
  if (!d.cenario) faltas.push("cenario");
  if (!d.luz) faltas.push("luz");
  return faltas;
}

/** Fecha a peça sem o modelo: o que faltar ganha um ponto de partida concreto e editável. */
export function direcaoDeFotoCompleta(d: DirecaoDeFoto, tema: string): DirecaoDeFoto {
  return {
    ...d,
    assunto: d.assunto || umaLinha(tema, 200) || "Produto do cliente",
    angulos: d.angulos.length >= 2 ? d.angulos : ANGULOS_PADRAO.slice(),
    cenario: d.cenario || "Ambiente real do cliente, fundo limpo",
    luz: d.luz || "Luz natural suave, lateral",
  };
}

/** Linhas da direção (pedido ao modelo, descrição da tarefa na Agenda e tela). */
export function linhasDaDirecaoDeFoto(d: DirecaoDeFoto): string[] {
  const l = [`Assunto: ${d.assunto || "a definir"}`];
  if (d.objetivo) l.push(`Objetivo: ${d.objetivo}`);
  l.push(`Ângulos: ${d.angulos.length ? d.angulos.join(", ") : "a definir"}`);
  if (d.cenario) l.push(`Cenário: ${d.cenario}`);
  if (d.luz) l.push(`Luz: ${d.luz}`);
  l.push(`Pessoa: ${d.pessoa || "ninguém"}`);
  l.push(`Quantidade: ${d.quantidade} ${d.quantidade === 1 ? "foto" : "fotos"}`);
  if (d.texto_na_foto) l.push(`Texto na foto: ${d.texto_na_foto}`);
  if (d.referencias.length) l.push(`Referências: ${d.referencias.join(", ")}`);
  return l;
}

/** Uma linha só (lista do cartão, pedido em lote). */
export const resumoDaDirecaoDeFoto = (d: DirecaoDeFoto) => linhasDaDirecaoDeFoto(d).join("; ");

/**
 * Esquema JSON estrito da direção (saída do modelo): todo campo obrigatório,
 * opcional como null. Use com `type: ["object", "null"]` no item.
 */
export const ESQUEMA_DA_DIRECAO_DE_FOTO = {
  type: "object",
  properties: {
    assunto: { type: "string", description: "O que aparece: o produto exato ou o momento (ex.: armação de acetato tartaruga, modelo X)." },
    objetivo: { type: "string" },
    angulos: { type: "array", items: { type: "string" }, description: "De 2 a 6 ângulos concretos (ex.: frontal, 3/4, lateral, detalhe da haste, no rosto)." },
    cenario: { type: "string" },
    luz: { type: "string" },
    pessoa: { type: ["string", "null"], description: "Quem aparece (ex.: mulher de 40 anos experimentando); null quando é só o produto." },
    quantidade: { type: "integer", description: "Fotos a produzir (padrão 4)." },
    texto_na_foto: { type: ["string", "null"] },
    referencias: { type: "array", items: { type: "string" } },
  },
  required: ["assunto", "objetivo", "angulos", "cenario", "luz", "pessoa", "quantidade", "texto_na_foto", "referencias"],
  additionalProperties: false,
} as const;

/** Entrega da tarefa na Agenda: a lista de valores não tem "foto"; 1 foto é post único, mais é carrossel. */
export function entregaDaPecaDeFoto(d: DirecaoDeFoto | null | undefined): "carousel" | "static" {
  return d && d.quantidade === 1 ? "static" : "carousel";
}

/** Prefixo do título da tarefa da peça de foto (a Agenda mostra que é foto). */
export const PREFIXO_DA_PECA_DE_FOTO = "Peça de foto: ";

export function tituloDaPecaDeFoto(tema: string): string {
  const t = umaLinha(tema, 200);
  return t.indexOf(PREFIXO_DA_PECA_DE_FOTO) === 0 ? t : `${PREFIXO_DA_PECA_DE_FOTO}${t}`.slice(0, 200);
}

// ------------------------------------------------------------------ link para a Mesa Foto

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valor do parâmetro `peca`: "<proposta_id>:<indice>" (índice do item em calendario_propostas.itens, base 0). */
export function valorDaPeca(propostaId: string, indice: number): string | null {
  if (!UUID.test(String(propostaId)) || !Number.isInteger(indice) || indice < 0) return null;
  return `${propostaId}:${indice}`;
}

/** Lê o parâmetro `peca` ("<proposta_id>:<indice>"); null quando não confere. */
export function lerValorDaPeca(v: unknown): { propostaId: string; indice: number } | null {
  const m = /^([0-9a-f-]{36}):(\d{1,4})$/i.exec(String(v == null ? "" : v).trim());
  if (!m || !UUID.test(m[1])) return null;
  return { propostaId: m[1].toLowerCase(), indice: Number(m[2]) };
}

/**
 * A peça de foto abre na Mesa Foto já escolhida:
 * /mesa-foto?client=<client_id>&peca=<proposta_id>:<indice>[&task=<task_id>][&volta=<caminho do Mês>]
 * `task` só depois de gravar; `volta` é o caminho de volta para o Mês.
 */
export function linkDaPecaNaMesaFoto(
  clientId: string,
  alvo: { propostaId?: string | null; indice?: number | null; taskId?: string | null; volta?: string | null },
): string {
  const partes = [`client=${encodeURIComponent(clientId)}`];
  const peca = alvo.propostaId != null && alvo.indice != null ? valorDaPeca(alvo.propostaId, alvo.indice) : null;
  if (peca) partes.push(`peca=${peca}`);
  if (alvo.taskId && UUID.test(alvo.taskId)) partes.push(`task=${alvo.taskId}`);
  if (alvo.volta && alvo.volta.charAt(0) === "/") partes.push(`volta=${encodeURIComponent(alvo.volta)}`);
  return `/mesa-foto?${partes.join("&")}`;
}

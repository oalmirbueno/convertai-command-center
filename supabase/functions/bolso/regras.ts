/**
 * Regras puras do estúdio Aceleriq de Bolso (26/10/2026). Sem rede e sem banco: testadas em regras_test.ts.
 *
 * - O que vai ao fornecedor: só a marca e a campanha do próprio membro (nada de CRM, nada de outros membros).
 * - A saída passa por esquema e por restrições: texto obrigatório, tamanhos e nenhum número comercial
 *   (preço, desconto, porcentagem, prazo) que o membro não tenha informado no briefing.
 * - O provedor simulado monta o texto só com o que o membro escreveu, marcado [DEMONSTRAÇÃO].
 */

export type Formato = "feed_1x1" | "feed_4x5" | "stories_9x16";
export const FORMATOS: Record<Formato, { largura: number; altura: number; nome: string }> = {
  feed_1x1: { largura: 1080, altura: 1080, nome: "Feed quadrado (1080 × 1080)" },
  feed_4x5: { largura: 1080, altura: 1350, nome: "Feed retrato (1080 × 1350)" },
  stories_9x16: { largura: 1080, altura: 1920, nome: "Stories (1080 × 1920)" },
};

export interface Marca {
  nome: string;
  descricao?: string;
  publico?: string;
  regiao?: string;
  tom?: string;
  cores?: string[];
}

export interface Briefing {
  tipo: "venda" | "agendamento" | "orcamento";
  produto: string;
  objetivo?: string;
  canal?: string;
  condicoes?: string;
  cta?: string;
  publico?: string;
  diferencial?: string;
}

export interface ConteudoDaCampanha {
  mensagem: string;
  texto: string;
  cta: string;
  aplicacao: string;
  direcao_visual: string;
}

const CAMPOS: (keyof ConteudoDaCampanha)[] = ["mensagem", "texto", "cta", "aplicacao", "direcao_visual"];
const LIMITE = 4000;

const OBJETIVO: Record<Briefing["tipo"], string> = {
  venda: "vender",
  agendamento: "agendar um horário",
  orcamento: "pedir um orçamento",
};

/** Números comerciais no texto (preço, porcentagem, parcelas, prazos). */
const NUMERO_COMERCIAL = /(r\$\s*\d|\d+\s*%|\d+\s*x\s*(de|sem)|\bfrete gr[aá]tis\b|\bdesconto\b|\boff\b|\d+\s*(dias?|horas?|unidades?)\b)/gi;

function trechosComerciais(texto: string): string[] {
  return (texto.match(NUMERO_COMERCIAL) || []).map((t) => t.toLowerCase().replace(/\s+/g, " ").trim());
}

/**
 * Valida a saída do fornecedor. Devolve o conteúdo limpo ou o motivo da recusa (falha definitiva: o
 * crédito volta). Um número comercial que não está no briefing é invenção.
 */
export function validarConteudo(bruto: unknown, briefing: Briefing): { ok: true; conteudo: ConteudoDaCampanha } | { ok: false; motivo: string } {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false, motivo: "Resposta sem o formato esperado." };
  const r = bruto as Record<string, unknown>;
  const conteudo = {} as ConteudoDaCampanha;
  for (const c of CAMPOS) {
    const v = typeof r[c] === "string" ? (r[c] as string).trim() : "";
    if (v.length > LIMITE) return { ok: false, motivo: `O campo ${c} veio grande demais.` };
    conteudo[c] = v;
  }
  if (!conteudo.texto || !conteudo.mensagem) return { ok: false, motivo: "Resposta sem texto ou sem mensagem." };
  const permitido = trechosComerciais(Object.values(briefing).filter((v) => typeof v === "string").join(" "));
  const tudo = CAMPOS.map((c) => conteudo[c]).join(" ");
  const inventado = trechosComerciais(tudo).filter((t) => !permitido.some((p) => p === t));
  if (inventado.length) return { ok: false, motivo: `A resposta trouxe condição comercial que você não informou (${inventado.slice(0, 3).join(", ")}).` };
  return { ok: true, conteudo };
}

/** Texto do provedor simulado: só o que o membro escreveu, organizado, marcado como demonstração. */
export function textoSimulado(marca: Marca, briefing: Briefing): ConteudoDaCampanha {
  const acao = briefing.cta || `Fale com a ${marca.nome}`;
  const partes = [
    `[DEMONSTRAÇÃO] ${briefing.produto}, da ${marca.nome}.`,
    briefing.diferencial ? `${briefing.diferencial}.` : "",
    briefing.condicoes ? `Condições: ${briefing.condicoes}.` : "",
    `${acao}.`,
  ].filter(Boolean);
  return {
    mensagem: `[DEMONSTRAÇÃO] Convidar ${briefing.publico || marca.publico || "o público da marca"} a ${OBJETIVO[briefing.tipo]}.`,
    texto: partes.join("\n\n"),
    cta: acao,
    aplicacao: `[DEMONSTRAÇÃO] Use no ${briefing.canal || "canal que você escolher"}. Revise antes de publicar.`,
    direcao_visual: `[DEMONSTRAÇÃO] ${briefing.produto} em destaque${marca.cores && marca.cores.length ? `, cores ${marca.cores.join(", ")}` : ""}, tom ${marca.tom || "da marca"}.`,
  };
}

/** Instruções para o fornecedor real: só dados do próprio membro, sem pedir números. */
export function pedidoDeTexto(marca: Marca, briefing: Briefing): { sistema: string; usuario: string } {
  const sistema = [
    "Você escreve campanhas curtas para pequenos negócios brasileiros, em português do Brasil.",
    "Use só as informações fornecidas. Nunca invente preço, desconto, porcentagem, prazo, estoque, depoimento ou resultado.",
    "Se faltar uma condição comercial, escreva o texto sem ela.",
    "Responda em JSON com os campos: mensagem, texto, cta, aplicacao, direcao_visual.",
  ].join(" ");
  const usuario = JSON.stringify({ marca: { nome: marca.nome, descricao: marca.descricao, publico: marca.publico, regiao: marca.regiao, tom: marca.tom }, campanha: briefing });
  return { sistema, usuario };
}

export function pedidoDeImagem(marca: Marca, briefing: Briefing, versao: Partial<ConteudoDaCampanha> | null, formato: Formato): string {
  const f = FORMATOS[formato];
  return [
    `Arte estática para ${f.nome}, sem texto escrito na imagem.`,
    `Negócio: ${marca.nome}. ${marca.descricao || ""}`.trim(),
    `Produto ou serviço: ${briefing.produto}.`,
    versao && versao.direcao_visual ? `Direção visual: ${versao.direcao_visual}` : "",
    marca.cores && marca.cores.length ? `Cores da marca: ${marca.cores.join(", ")}.` : "",
    "Sem logotipos de terceiros, sem pessoas reais identificáveis, sem números ou preços.",
  ].filter(Boolean).join(" ");
}

/** O caminho do arquivo no bucket privado: sempre na pasta do dono. */
export function caminhoDaArte(userId: string, campanhaId: string, jobId: string, extensao: "png" | "webp" | "jpg"): string {
  const uuid = /^[a-f0-9-]{36}$/;
  if (!uuid.test(userId) || !uuid.test(campanhaId) || !uuid.test(jobId)) throw new Error("Identificador inválido para o caminho da arte.");
  return `${userId}/${campanhaId}/${jobId}.${extensao}`;
}

/** Confere a assinatura do PNG/JPEG/WEBP (não confia no que o fornecedor diz). */
export function mimeReal(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Modelos permitidos no servidor (o cliente não escolhe). NÃO VALIDADOS: conferir antes da homologação. */
export const MODELOS_PERMITIDOS = { texto: ["gpt-4.1-mini"], imagem: ["gpt-image-1"] } as const;

export function modeloPermitido(tipo: "texto" | "imagem", pedido: string | undefined): string | null {
  const lista = MODELOS_PERMITIDOS[tipo] as readonly string[];
  if (!pedido) return null;
  return lista.indexOf(pedido) >= 0 ? pedido : null;
}

/** A geração real só existe com a chave do ambiente ligada, a chave da OpenAI e modelos da lista. */
export function openaiPronta(env: { habilitado?: string; chave?: string; modeloTexto?: string; modeloImagem?: string }): { ok: boolean; motivo?: string } {
  if (env.habilitado !== "sim") return { ok: false, motivo: "Geração real desligada no servidor (BOLSO_OPENAI_HABILITADO)." };
  if (!env.chave) return { ok: false, motivo: "Sem chave da OpenAI no servidor." };
  if (!modeloPermitido("texto", env.modeloTexto) || !modeloPermitido("imagem", env.modeloImagem)) return { ok: false, motivo: "Modelo fora da lista permitida." };
  return { ok: true };
}

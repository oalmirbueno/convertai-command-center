/**
 * A base UI UX Pro Max citada pelos agentes (frente UXM, 30/09/2026), no mesmo
 * molde das regras ensinadas (g1, g2...): cada item da base que vai ao prompt
 * ganha um apelido b1..bN; o modelo diz quais usou (`base_citada` no diretor
 * de site, `regras_usadas` no Preencher com IA) e o código traduz o apelido,
 * descartando o inventado.
 *
 * A base nunca é fonte de FATO do cliente, só de regra de design. Ids de
 * citação: uupm:style:<Style ID>, uupm:product:<No>, uupm:color:<No>,
 * uupm:reasoning:<No>, uupm:typography:<No>, uupm:landing:<Pattern ID>,
 * uupm:ux:<No>, uupm:chart:<No> (presos à versão 2.15.0).
 *
 * Puro, sem os dados da base (quem monta os itens é base-completa.ts, no
 * servidor). Sem travessão.
 */

import type { ConhecimentoMontado } from "../conhecimento-dos-agentes.ts";

export type TipoDoItemDaBase = "produto" | "estilo" | "padrao" | "par" | "paleta" | "regra" | "grafico";
export type ItemDaBase = { apelido: string; id: string; tipo: TipoDoItemDaBase; rotulo: string; texto: string };
export type ItemSemApelido = Omit<ItemDaBase, "apelido">;

export const TIPO_DO_ANEXO_BASE = "base_citada";
export const MAX_ITENS_CITADOS = 14;
/** Teto do bloco no diretor de site (caracteres) e no Preencher (TAMANHO_DA_FONTE.base). */
export const TETO_DO_BLOCO_DO_DIRETOR = 1200;
export const TETO_DO_BLOCO_DO_PREENCHER = 1500;

export const idDeCitacao = (base: "style" | "product" | "color" | "reasoning" | "typography" | "landing" | "ux" | "chart", id: string) => `uupm:${base}:${id}`;

const ROTULO_DO_TIPO: Record<TipoDoItemDaBase, string> = { produto: "tipo de produto", estilo: "estilo", padrao: "padrão", par: "par de fontes", paleta: "paleta do setor", regra: "regra de UX", grafico: "gráfico" };

/** Apelidos b1..bN na ordem, sem repetir o mesmo id, até o máximo. */
export function numerarItens(itens: ItemSemApelido[], max = MAX_ITENS_CITADOS): ItemDaBase[] {
  const vistos: string[] = [];
  const saida: ItemDaBase[] = [];
  for (const i of itens) {
    if (!i || !i.id || vistos.indexOf(i.id) >= 0) continue;
    vistos.push(i.id);
    saida.push({ ...i, apelido: `b${saida.length + 1}` });
    if (saida.length >= max) break;
  }
  return saida;
}

const linha = (i: ItemDaBase) => `- ${i.apelido} (${i.id}): ${i.texto.replace(/\s+/g, " ").trim()}`;

/**
 * O bloco "BASE DA DIREÇÃO" para o sistema do modelo (vazio sem itens). Corta
 * item inteiro, nunca o meio, para caber no teto.
 */
export function blocoDaBaseDeDesign(p: { papel: string; itens: ItemDaBase[]; max?: number; campo?: "base_citada" | "regras_usadas" }): string {
  if (!p.itens.length) return "";
  const campo = p.campo || "base_citada";
  const cabeca = `BASE DA DIREÇÃO (UI UX Pro Max 2.15.0; regra de design, nunca fato do cliente; a paleta, as fontes e a logo da marca vencem a base):`;
  const pe = `Quando um item mudar o que você propõe ou escreve, ponha o apelido dele em \`${campo}\`. Não invente apelido.`;
  const teto = p.max || TETO_DO_BLOCO_DO_DIRETOR;
  const linhas: string[] = [];
  let tamanho = cabeca.length + pe.length + 2;
  for (const i of p.itens) {
    const l = linha(i).slice(0, 320);
    if (tamanho + l.length + 1 > teto) break;
    linhas.push(l);
    tamanho += l.length + 1;
  }
  if (!linhas.length) return "";
  return [cabeca, ...linhas, pe].join("\n");
}

/** Os itens que o modelo citou (apelido inventado sai). */
export function itensCitados(apelidos: unknown, itens: ItemDaBase[]): ItemDaBase[] {
  const lista = Array.isArray(apelidos) ? apelidos.map((x) => String(x == null ? "" : x).trim().toLowerCase()) : [];
  return itens.filter((i) => lista.indexOf(i.apelido) >= 0).slice(0, 6);
}

/** Anexo "Base: …" da conversa (ao lado do "Segui: …"). */
export function anexoDaBaseCitada(apelidos: unknown, itens: ItemDaBase[]): { tipo: typeof TIPO_DO_ANEXO_BASE; itens: Array<{ id: string; rotulo: string }> } | null {
  const usados = itensCitados(apelidos, itens);
  if (!usados.length) return null;
  return { tipo: TIPO_DO_ANEXO_BASE, itens: usados.map((i) => ({ id: i.id, rotulo: `${ROTULO_DO_TIPO[i.tipo]} ${i.rotulo}` })) };
}

/** O rótulo humano da fonte no resultado do Preencher. */
export const rotuloDaCitacao = (i: Pick<ItemDaBase, "tipo" | "rotulo" | "id">) => `Base UI UX Pro Max: ${ROTULO_DO_TIPO[i.tipo]} ${i.rotulo} (${i.id})`;

/** Campo do esquema do diretor (juntar em properties e em required). */
export const CAMPO_BASE_CITADA = {
  base_citada: {
    type: "array",
    items: { type: "string" },
    description: "Apelidos (b1, b2...) dos itens da BASE DA DIREÇÃO que mudaram esta resposta ou ação. Vazio quando nenhum.",
  },
} as const;

/**
 * Regras de UX que valem para os campos pedidos (pela chave e pelo rótulo):
 * formulário, CTA, imagem, título, número, FAQ. Regra fixa.
 */
export function regrasParaCampos(campos: Array<{ chave: string; rotulo?: string }>): string[] {
  const texto = campos.map((c) => `${c.chave} ${c.rotulo || ""}`).join(" ").toLowerCase();
  const saida: string[] = [];
  const por = (re: RegExp, regras: string[]) => {
    if (re.test(texto)) for (const r of regras) if (saida.indexOf(r) < 0) saida.push(r);
  };
  por(/formul|campo|contato|whatsapp|e-?mail|telefone/, ["43", "54", "55", "57", "59"]);
  por(/cta|bot[aã]o|chamada|a[cç][aã]o/, ["32", "29"]);
  por(/imagem|foto|alt\b|galeria/, ["38"]);
  por(/t[ií]tulo|headline|seo|descri/, ["39", "77", "110"]);
  por(/n[uú]mero|resultado|estat/, ["86"]);
  por(/faq|pergunta/, ["41"]);
  por(/texto|par[aá]grafo|subt[ií]tulo/, ["21", "72"]);
  return saida;
}

/** O método da base que vai ao sistema do diretor de site (bloco do índice de motores). */
export const METODO_DA_BASE_DE_DESIGN = [
  "BASE DE DESIGN (UI UX Pro Max 2.15.0, MIT, Next Level Builder): quando os DADOS trouxerem a BASE DA DIREÇÃO, use os itens como regra de design da agência, nunca como fato do cliente.",
  "A paleta, as fontes, a logo e o tom da marca vencem qualquer sugestão da base. Da base use o que a marca não define: estrutura da página, ordem das seções e do CTA, estados, acessibilidade e antipadrões do setor.",
  "Regra de UX com severidade crítica ou alta que falhou na Revisão merece ajuste de seção; diga a regra na instrução do ajuste (ex.: pela regra uupm:ux:99, movimento reduzido).",
  "Cite em base_citada só o apelido (b1, b2...) do item que mudou a sua resposta ou ação.",
].join(" ");

/** O conhecimento montado para o índice de motores (motores.ts): um bloco só, "base_de_design". */
export function conhecimentoDaBaseDeDesign(): ConhecimentoMontado {
  const texto = METODO_DA_BASE_DE_DESIGN;
  return { texto, ids: ["base_de_design"], cortados: [], tamanho: texto.length, teto: 1500 };
}

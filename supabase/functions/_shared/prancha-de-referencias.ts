/**
 * Referência "prancha" (Estúdio, frente E, 25/09 à noite). Puro: sem Deno,
 * sem banco, sem IA. Sem travessão.
 *
 * Pedido do dono: "às vezes eu coloco várias artes dentro de uma imagem: um
 * print de um perfil do Instagram com várias capas, ou a sequência de um
 * carrossel num print. Eu quero seguir aquele padrão, ou pego a capa e a
 * sequência dos carrosséis. Ele já tem que entender que a capa dele, depois,
 * prepara a continuidade dos demais cards igual aqueles carrosséis. Se eu
 * quiser combinar com outra referência, combino com o que já tem. E o texto do
 * roteiro de cada card entra também."
 *
 * Como funciona:
 *   1. Leitura por visão (uma vez, guardada em
 *      mesa/<cliente>/estudio/leituras/prancha-<ref>.json, arquivo próprio: as
 *      leituras de molde que já existem continuam valendo): a imagem é uma arte
 *      só ou uma prancha (grade de perfil, carrossel lado a lado, mosaico)? Na
 *      prancha, a caixa de cada quadro, qual parece capa e qual é sequência, e
 *      o sistema visual comum. normalizarPrancha decide em código: prancha só
 *      com 2 quadros ou mais, cada um com tamanho de arte.
 *   2. A equipe ajusta na tela o papel de cada quadro (capa, sequência ou fora),
 *      gravado no trabalho (direcao.pranchas[ref].papeis).
 *   3. Na geração, a referência prancha vira o QUADRO da lâmina, recortado em
 *      código (imagem-local): a capa usa um quadro de capa (girando a cada
 *      versão quando há vários) e a lâmina k usa o quadro de sequência k
 *      (ciclando). O quadro recortado entra no lugar da imagem inteira, como
 *      referência 1 (molde) ou 2 (acabamento), igual a qualquer referência.
 *   4. Quando a capa foi feita de uma prancha, as lâminas 2..N que não replicam
 *      recebem o quadro de sequência como guia, além da capa gerada.
 * Referência simples (arte única) segue exatamente como antes.
 */

export const VERSAO_DA_PRANCHA = 1;

export type PapelDoQuadro = "capa" | "sequencia" | "fora";
export const PAPEIS_DO_QUADRO: PapelDoQuadro[] = ["capa", "sequencia", "fora"];
export type TipoDaPrancha = "perfil" | "carrossel" | "mosaico";

/** Quadro da prancha, em % da imagem (0 a 100, canto superior esquerdo). */
export type QuadroDaPrancha = { x0: number; y0: number; x1: number; y1: number; papel: PapelDoQuadro };

export type LeituraDaPrancha = {
  versao: number;
  prancha: boolean;
  tipo: TipoDaPrancha | null;
  quadros: QuadroDaPrancha[];
  /** O sistema visual comum aos quadros, em até 2 frases. */
  sistema: string;
};

export const MAX_QUADROS = 24;
/** Tamanho mínimo de um quadro (em % da imagem) para contar como arte, e não ícone ou miniatura de destaque. */
const LADO_MINIMO = { largura: 8, altura: 5 };

const caixaNoEsquema = { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } };

/** Esquema da leitura da prancha (visão, modelo de leitura do catálogo). */
export const ESQUEMA_PRANCHA = {
  nome: "prancha_de_referencias",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["prancha", "tipo", "quadros", "sistema"],
    properties: {
      prancha: { type: "boolean" },
      tipo: { type: "string", enum: ["simples", "perfil", "carrossel", "mosaico"] },
      quadros: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["x0", "y0", "x1", "y1", "papel"],
          properties: { ...caixaNoEsquema, papel: { type: "string", enum: ["capa", "sequencia"] } },
        },
      },
      sistema: { type: "string" },
    },
  },
};

export const SISTEMA_PRANCHA = `Você olha uma imagem de referência que a equipe de design escolheu e diz se ela é UMA arte só ou uma PRANCHA com várias artes.
- prancha: true quando a imagem junta várias artes separadas: print de um perfil do Instagram com a grade de posts (tipo perfil), print de um carrossel com as lâminas lado a lado ou em sequência (tipo carrossel) ou um mosaico de peças (tipo mosaico). Uma arte única com fotos ou blocos dentro dela NÃO é prancha (tipo simples, quadros vazio).
- quadros: na prancha, a caixa de CADA arte inteira, em porcentagem da imagem (0 a 100, 0 no canto superior esquerdo, x para a direita, y para baixo), na ordem de leitura (linha por linha, da esquerda para a direita). Ignore o cabeçalho do perfil, a foto de perfil, os números de seguidores, os destaques redondos, os ícones e as barras do aplicativo. Só artes inteiras visíveis, até 24.
- papel: capa é a arte que abre um carrossel ou uma peça de capa (no perfil, cada post da grade é a capa de um conteúdo); sequencia é uma lâmina de continuação de um carrossel (no print de carrossel, a primeira é a capa e as outras são sequência).
- sistema: em até 2 frases, o que se repete entre as artes (grade, tipografia, elementos gráficos, tratamento), sem citar marca, nomes nem cores por nome.
Escreva em português, sem travessão.`;

const numeroPct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : 0;
};

/**
 * Leitura crua (do leitor ou do cache) vira a leitura da prancha, decidida em
 * código: prancha só quando o leitor diz que é E há 2 quadros ou mais com
 * tamanho de arte. Qualquer outra coisa é referência simples (sem quadros).
 */
export function normalizarPrancha(bruto: unknown): LeituraDaPrancha {
  const simples: LeituraDaPrancha = { versao: VERSAO_DA_PRANCHA, prancha: false, tipo: null, quadros: [], sistema: "" };
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : null;
  if (!o || o.prancha !== true) return simples;
  const quadros: QuadroDaPrancha[] = [];
  for (const q of Array.isArray(o.quadros) ? o.quadros : []) {
    if (!q || typeof q !== "object") continue;
    const x = q as Record<string, unknown>;
    const xa = numeroPct(x.x0), xb = numeroPct(x.x1), ya = numeroPct(x.y0), yb = numeroPct(x.y1);
    const c = { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
    if (c.x1 - c.x0 < LADO_MINIMO.largura || c.y1 - c.y0 < LADO_MINIMO.altura) continue;
    // Quadro que repete outro (mais da metade da área em comum) sai.
    if (quadros.some((p) => sobreposicao(p, c) > 0.5)) continue;
    quadros.push({ ...c, papel: x.papel === "sequencia" ? "sequencia" : "capa" });
    if (quadros.length >= MAX_QUADROS) break;
  }
  if (quadros.length < 2) return simples;
  const tipo = o.tipo === "perfil" || o.tipo === "carrossel" || o.tipo === "mosaico" ? o.tipo : "mosaico";
  const sistema = typeof o.sistema === "string" ? o.sistema.replace(/\s+/g, " ").split(String.fromCharCode(8212)).join(",").trim().slice(0, 300) : "";
  return { versao: VERSAO_DA_PRANCHA, prancha: true, tipo, quadros, sistema };
}

/** Fração da área do menor quadro que fica dentro do outro. */
function sobreposicao(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const l = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const menor = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return menor > 0 ? (l * h) / menor : 0;
}

/** Papéis escolhidos pela equipe (tela), lidos com cuidado: só os conhecidos, no máximo MAX_QUADROS. */
export function papeisDaEquipe(v: unknown): PapelDoQuadro[] | null {
  if (!Array.isArray(v)) return null;
  const lista = v.slice(0, MAX_QUADROS).map((p) => (PAPEIS_DO_QUADRO.indexOf(p as PapelDoQuadro) >= 0 ? p as PapelDoQuadro : "fora"));
  return lista.length ? lista : null;
}

/** A leitura com os papéis que a equipe marcou (quadro a quadro, pela ordem); sem ajuste, a da leitura. */
export function pranchaComAjustes(leitura: LeituraDaPrancha, papeis: PapelDoQuadro[] | null | undefined): LeituraDaPrancha {
  if (!leitura.prancha || !papeis || !papeis.length) return leitura;
  return { ...leitura, quadros: leitura.quadros.map((q, i) => (i < papeis.length ? { ...q, papel: papeis[i] } : q)) };
}

/**
 * O quadro que a lâmina usa (índice na lista de quadros e o papel), ou null
 * quando a prancha não tem quadro para ela (a referência sai desta lâmina e a
 * lâmina segue a capa, como sem referência):
 *   - capa (ordem 1): um quadro de capa, girando a cada versão (`versoesAntes`)
 *     quando há vários; sem capa marcada, o primeiro de sequência;
 *   - lâmina k (2 em diante): o quadro de sequência k - 1, ciclando se faltar;
 *     sem quadro de sequência (perfil só com capas), null.
 */
export function quadroDaLamina(prancha: LeituraDaPrancha, ordem: number, versoesAntes = 0): { indice: number; papel: "capa" | "sequencia"; posicao: number; de: number } | null {
  if (!prancha.prancha) return null;
  const capas = prancha.quadros.map((q, i) => ({ q, i })).filter((x) => x.q.papel === "capa");
  const seq = prancha.quadros.map((q, i) => ({ q, i })).filter((x) => x.q.papel === "sequencia");
  if (ordem <= 1) {
    if (capas.length) {
      const k = Math.max(0, versoesAntes) % capas.length;
      return { indice: capas[k].i, papel: "capa", posicao: k + 1, de: capas.length };
    }
    return seq.length ? { indice: seq[0].i, papel: "sequencia", posicao: 1, de: seq.length } : null;
  }
  if (!seq.length) return null;
  const k = (ordem - 2) % seq.length;
  return { indice: seq[k].i, papel: "sequencia", posicao: k + 1, de: seq.length };
}

/**
 * Retângulo do quadro em pixels da imagem, com um recuo pequeno para tirar o
 * fio entre os quadros da grade. Null quando fica pequeno demais.
 */
export function retanguloDoQuadro(q: { x0: number; y0: number; x1: number; y1: number }, largura: number, altura: number): { x: number; y: number; largura: number; altura: number } | null {
  if (!(largura > 0) || !(altura > 0)) return null;
  const recuo = Math.max(1, Math.round(Math.min(largura, altura) * 0.004));
  const x0 = Math.max(0, Math.floor((q.x0 / 100) * largura) + recuo);
  const y0 = Math.max(0, Math.floor((q.y0 / 100) * altura) + recuo);
  const x1 = Math.min(largura, Math.ceil((q.x1 / 100) * largura) - recuo);
  const y1 = Math.min(altura, Math.ceil((q.y1 / 100) * altura) - recuo);
  if (x1 - x0 < 32 || y1 - y0 < 32) return null;
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}

/**
 * Referência de proporção comum de arte (4:5, 1:1, 3:4, 2:3): quase sempre uma
 * arte só. A tela pula a leitura automática delas (a equipe pode pedir); print
 * de celular (bem alto) e carrossel lado a lado (bem largo) são lidos.
 */
export function pareceArteUnica(d: { largura: number; altura: number } | null): boolean {
  if (!d || !(d.largura > 0) || !(d.altura > 0)) return false;
  const r = d.largura / d.altura;
  return r >= 0.62 && r <= 1.3;
}

/** Legenda do anexo quando o quadro vem de uma prancha (a imagem é o quadro recortado, não o print inteiro). */
export function notaDoQuadro(q: { papel: "capa" | "sequencia"; posicao: number; de: number }, tipo: TipoDaPrancha | null): string {
  const onde = tipo === "perfil" ? "do print do perfil" : tipo === "carrossel" ? "do print do carrossel" : "da prancha";
  return q.papel === "capa"
    ? `quadro de CAPA ${onde} (${q.posicao} de ${q.de}), recortado`
    : `quadro de SEQUÊNCIA ${onde} (${q.posicao} de ${q.de}), recortado`;
}

/**
 * Complemento do bloco da série (blocoDaSerie) nas lâminas 2..N que NÃO
 * replicam, quando a capa foi feita de uma prancha: o quadro de sequência
 * dela vai anexado como guia de como o carrossel continua.
 */
export function serieComQuadroDaPrancha(e: { ordem: number; total: number; sequencia: number | null }): string {
  if (e.total < 2 || e.ordem < 2 || !e.sequencia) return "";
  return `- A capa foi feita a partir de uma prancha de referência: o quadro de sequência dela (imagem ${e.sequencia}) mostra como este carrossel continua depois da capa. Siga dele a divisão da lâmina, o ritmo e o lugar do texto e da imagem; o sistema visual (cores, fontes, elementos, tratamento) continua o da capa; não copie o texto nem a marca do quadro.`;
}

/**
 * Bloco da série quando a capa veio de uma prancha e esta lâmina replica um
 * quadro de sequência dela: a capa gerada (anexada) manda na marca aplicada e
 * o quadro manda no layout desta lâmina.
 */
export function continuidadeDaPrancha(e: { ordem: number; total: number; capa: number | null; quadro: { posicao: number; de: number } }): string {
  if (e.ordem < 2 || e.total < 2) return "";
  return [
    `CONTINUIDADE DA PRANCHA (lâmina ${e.ordem} de ${e.total}): esta lâmina é a continuação do carrossel da referência (quadro de sequência ${e.quadro.posicao} de ${e.quadro.de}), no layout dele.`,
    e.capa
      ? `- A capa desta série já foi gerada (imagem ${e.capa}): mantenha dela a marca aplicada (as mesmas cores, fontes, tratamento, a mesma pessoa e o mesmo cenário), para a série parecer uma só; não copie o texto nem a composição da capa.`
      : "- Mantenha a mesma marca aplicada da capa desta série (cores, fontes, tratamento).",
    e.ordem === e.total ? "- Esta é a última lâmina: feche com o CTA em destaque, no mesmo sistema." : "",
  ].filter(Boolean).join("\n");
}

/**
 * Catálogo de motion do editor (frente EDT, F3, 30/09/2026): as peças de
 * animação próprias da Aceleriq, com parâmetros TIPADOS e o tempo tirado da
 * palavra medida. A peça é um clipe da trilha de sobreposição com
 * `estilo.peca` e `estilo.params`; quem desenha é
 * src/components/mesa-edicao/editor/motion/Pecas.tsx (Remotion, a mesma na
 * prévia e no render).
 *
 * Regras (especificação medida do EDIT IA PRO, com as nossas palavras):
 * - a peça entra na palavra dita (tempo da fala na linha, nunca "mais ou menos");
 * - o som da peça tem o pico no quadro em que o movimento chega ao auge;
 * - número, preço e nome só se foram DITOS (quem monta os parâmetros confere).
 *
 * Sem import de "@/": a composição também é empacotada pelo worker de render.
 */

export const PECAS_DE_MOTION = [
  "rotulo",
  "carimbo",
  "lista",
  "passos",
  "contador",
  "notificacao",
  "polaroide",
  "cartao_final",
  "lettering",
  "barra",
  "preco",
  "comentario",
  "selo",
  "logo",
] as const;
export type IdDaPeca = (typeof PECAS_DE_MOTION)[number];

export type TipoDoParametro = "texto" | "numero" | "lista" | "escolha" | "cor";

export interface ParametroDaPeca {
  chave: string;
  tipo: TipoDoParametro;
  rotulo: string;
  obrigatorio?: boolean;
  max?: number;
  min?: number;
  opcoes?: string[];
  padrao?: string | number | string[];
}

export interface DefinicaoDaPeca {
  id: IdDaPeca;
  rotulo: string;
  /** Quando usar (vai no "?" e no pedido ao Jev). */
  quando: string;
  duracao_s: number;
  /** Quando o movimento de entrada chega ao auge (s depois do começo do clipe). */
  pico_s: number;
  /** Som da biblioteca (som-do-editor.ts) com pico nesse quadro. */
  som: string;
  prioridade: number;
  parametros: ParametroDaPeca[];
}

const COR: ParametroDaPeca = { chave: "cor", tipo: "cor", rotulo: "Cor de destaque" };

export const CATALOGO_DE_MOTION: DefinicaoDaPeca[] = [
  { id: "rotulo", rotulo: "Rótulo", quando: "nomear quem fala ou o assunto do trecho", duracao_s: 2.6, pico_s: 0.2, som: "pop_mao", prioridade: 1, parametros: [{ chave: "texto", tipo: "texto", rotulo: "Texto", obrigatorio: true, max: 40 }, { chave: "posicao", tipo: "escolha", rotulo: "Onde", opcoes: ["topo", "meio", "base"], padrao: "topo" }, COR] },
  { id: "carimbo", rotulo: "Carimbo", quando: "veredito curto: aprovado, errado, verdade, mito", duracao_s: 1.8, pico_s: 0.16, som: "impacto", prioridade: 3, parametros: [{ chave: "texto", tipo: "texto", rotulo: "Texto", obrigatorio: true, max: 18 }, COR] },
  { id: "lista", rotulo: "Lista", quando: "a fala enumera itens (com check ou riscando o que não serve)", duracao_s: 4, pico_s: 0.24, som: "tique", prioridade: 2, parametros: [{ chave: "titulo", tipo: "texto", rotulo: "Título", max: 40 }, { chave: "itens", tipo: "lista", rotulo: "Itens", obrigatorio: true, max: 6 }, { chave: "modo", tipo: "escolha", rotulo: "Marca", opcoes: ["check", "riscada"], padrao: "check" }, COR] },
  { id: "passos", rotulo: "Passo a passo", quando: "a fala explica etapas em ordem (primeiro, depois, por fim)", duracao_s: 4.5, pico_s: 0.24, som: "whoosh_rapido", prioridade: 2, parametros: [{ chave: "itens", tipo: "lista", rotulo: "Passos", obrigatorio: true, max: 5 }, COR] },
  { id: "contador", rotulo: "Contador", quando: "um número dito que impressiona (resultado, quantidade, prazo)", duracao_s: 2.4, pico_s: 1.2, som: "count", prioridade: 3, parametros: [{ chave: "ate", tipo: "numero", rotulo: "Número dito", obrigatorio: true }, { chave: "de", tipo: "numero", rotulo: "Começa em", padrao: 0 }, { chave: "prefixo", tipo: "texto", rotulo: "Antes", max: 6 }, { chave: "sufixo", tipo: "texto", rotulo: "Depois", max: 14 }, { chave: "legenda", tipo: "texto", rotulo: "Legenda", max: 40 }, COR] },
  { id: "notificacao", rotulo: "Notificação", quando: "venda, mensagem ou pedido chegando", duracao_s: 2.8, pico_s: 0.22, som: "notification", prioridade: 2, parametros: [{ chave: "app", tipo: "texto", rotulo: "App", max: 20, padrao: "Mensagem" }, { chave: "titulo", tipo: "texto", rotulo: "Título", obrigatorio: true, max: 40 }, { chave: "texto", tipo: "texto", rotulo: "Texto", max: 80 }] },
  { id: "polaroide", rotulo: "Polaroide", quando: "mostrar uma foto real do assunto (produto, lugar, antes)", duracao_s: 3, pico_s: 0.3, som: "camera", prioridade: 2, parametros: [{ chave: "legenda", tipo: "texto", rotulo: "Legenda", max: 30 }] },
  { id: "cartao_final", rotulo: "Cartão final", quando: "fim do vídeo com a chamada e a marca", duracao_s: 3.5, pico_s: 0.35, som: "swish", prioridade: 3, parametros: [{ chave: "titulo", tipo: "texto", rotulo: "Título", obrigatorio: true, max: 50 }, { chave: "botao", tipo: "texto", rotulo: "Botão", max: 30 }, COR] },
  { id: "lettering", rotulo: "Lettering", quando: "2 a 4 expressões fortes ditas, uma por vez, em letra grande", duracao_s: 3, pico_s: 0.18, som: "pop", prioridade: 2, parametros: [{ chave: "palavras", tipo: "lista", rotulo: "Expressões", obrigatorio: true, max: 4 }, COR] },
  { id: "barra", rotulo: "Barra", quando: "porcentagem ou progresso dito", duracao_s: 2.8, pico_s: 1.1, som: "whoosh_rapido", prioridade: 2, parametros: [{ chave: "valor", tipo: "numero", rotulo: "Porcentagem dita", obrigatorio: true, min: 0, max: 100 }, { chave: "rotulo", tipo: "texto", rotulo: "Rótulo", max: 40 }, COR] },
  { id: "preco", rotulo: "Etiqueta de preço", quando: "preço ou oferta dita", duracao_s: 2.8, pico_s: 0.26, som: "cash", prioridade: 3, parametros: [{ chave: "por", tipo: "texto", rotulo: "Preço dito", obrigatorio: true, max: 16 }, { chave: "de", tipo: "texto", rotulo: "De (riscado)", max: 16 }, { chave: "rotulo", tipo: "texto", rotulo: "Rótulo", max: 30 }, COR] },
  { id: "comentario", rotulo: "Comentário / CTA", quando: "pedir para comentar uma palavra ou responder um comentário", duracao_s: 3, pico_s: 0.22, som: "mensagem", prioridade: 2, parametros: [{ chave: "usuario", tipo: "texto", rotulo: "Quem", max: 24, padrao: "você" }, { chave: "texto", tipo: "texto", rotulo: "Texto", obrigatorio: true, max: 90 }] },
  { id: "selo", rotulo: "Selo", quando: "garantia, prazo, frete grátis, certificado", duracao_s: 2.4, pico_s: 0.3, som: "success", prioridade: 2, parametros: [{ chave: "texto", tipo: "texto", rotulo: "Texto", obrigatorio: true, max: 16 }, { chave: "subtitulo", tipo: "texto", rotulo: "Embaixo", max: 24 }, COR] },
  { id: "logo", rotulo: "Logo", quando: "a marca do cliente acompanhando (canto, fim ou abertura)", duracao_s: 3, pico_s: 0.25, som: "glitch", prioridade: 1, parametros: [{ chave: "onde", tipo: "escolha", rotulo: "Onde", opcoes: ["canto", "cartao_final", "sting"], padrao: "canto" }, COR] },
];

export const definicaoDaPeca = (id: string): DefinicaoDaPeca | null => CATALOGO_DE_MOTION.find((p) => p.id === id) || null;

export type ParametrosDaPeca = Record<string, string | number | string[] | null>;

const COR_HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Parâmetros conferidos pela definição: tipo, tamanho e escolha. Falta
 * obrigatório: lança Error com o motivo (o agente recebe e corrige; nada
 * aplica pela metade).
 */
export function parametrosDaPeca(id: IdDaPeca, bruto: Record<string, unknown> | null | undefined): ParametrosDaPeca {
  const d = definicaoDaPeca(id);
  if (!d) throw new Error(`Peça desconhecida: ${id}.`);
  const o = bruto && typeof bruto === "object" ? bruto : {};
  const saida: ParametrosDaPeca = {};
  d.parametros.forEach((p) => {
    const v = o[p.chave];
    let valor: string | number | string[] | null = null;
    if (p.tipo === "texto") {
      const s = v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, p.max || 80);
      valor = s || (typeof p.padrao === "string" ? p.padrao : null);
    } else if (p.tipo === "numero") {
      const n = typeof v === "number" ? v : Number(String(v === undefined || v === null ? "" : v).replace(/\./g, "").replace(",", "."));
      if (v !== undefined && v !== null && v !== "" && isFinite(n)) valor = Math.max(p.min !== undefined ? p.min : -1e12, Math.min(p.max !== undefined ? p.max : 1e12, n));
      else valor = typeof p.padrao === "number" ? p.padrao : null;
    } else if (p.tipo === "lista") {
      const l = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*[;|\n]\s*/) : [];
      const itens = l.map((x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, p.max || 6);
      valor = itens.length ? itens : null;
    } else if (p.tipo === "escolha") {
      const s = String(v === undefined || v === null ? "" : v);
      valor = p.opcoes && p.opcoes.indexOf(s) >= 0 ? s : typeof p.padrao === "string" ? p.padrao : p.opcoes ? p.opcoes[0] : null;
    } else if (p.tipo === "cor") {
      const s = String(v === undefined || v === null ? "" : v).trim();
      valor = COR_HEX.test(s) ? s : null;
    }
    if (p.obrigatorio && (valor === null || valor === "")) throw new Error(`${d.rotulo}: falta ${p.rotulo.toLowerCase()}.`);
    saida[p.chave] = valor;
  });
  return saida;
}

// ------------------------------------------------------------------ tempo tirado da palavra medida

export interface PalavraNoTempo {
  t: string;
  i: number;
  f: number;
}

const normal = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Onde a expressão foi dita (a primeira vez a partir de `depois_s`): o começo
 * da primeira palavra e o fim da última. Compara sem acento e sem pontuação.
 * Null se não foi dita (a peça não entra "mais ou menos").
 */
export function acharNaFala(fala: PalavraNoTempo[], expressao: string, depoisS = 0): { i: number; f: number } | null {
  const alvo = normal(expressao).split(" ").filter(Boolean);
  if (!alvo.length) return null;
  const ditas = fala.map((w) => ({ ...w, n: normal(w.t).replace(/ /g, "") }));
  for (let k = 0; k + alvo.length <= ditas.length; k++) {
    if (ditas[k].i < depoisS - 1e-6) continue;
    let ok = true;
    for (let j = 0; j < alvo.length; j++) if (ditas[k + j].n !== alvo[j]) ok = false;
    if (ok) return { i: ditas[k].i, f: ditas[k + alvo.length - 1].f };
  }
  return null;
}

/** Cai no quadro do projeto. */
export const noQuadroDoProjeto = (s: number, fps: number) => Math.round(s * (fps > 0 ? fps : 25)) / (fps > 0 ? fps : 25);

/**
 * Tempos dos itens de uma lista, dos passos ou do lettering: cada item entra
 * quando a primeira palavra dele é dita (depois do item anterior); item que não
 * foi dito divide o espaço que sobra por igual. Relativo ao começo do clipe.
 */
export function temposDosItens(itens: string[], fala: PalavraNoTempo[], inicioS: number, duracaoS: number): number[] {
  const tempos: number[] = [];
  let depois = inicioS;
  itens.forEach((item, k) => {
    const primeira = normal(item).split(" ").filter(Boolean).slice(0, 2).join(" ");
    const achou = primeira ? acharNaFala(fala, primeira, depois) : null;
    if (achou && achou.i < inicioS + duracaoS) {
      tempos.push(Math.max(0, Math.round((achou.i - inicioS) * 1000) / 1000));
      depois = achou.f;
    } else {
      const passo = (duracaoS * 0.8) / Math.max(1, itens.length);
      tempos.push(Math.round((0.15 + k * passo) * 1000) / 1000);
    }
  });
  // Nunca volta no tempo.
  for (let k = 1; k < tempos.length; k++) if (tempos[k] < tempos[k - 1]) tempos[k] = tempos[k - 1] + 0.2;
  return tempos;
}

/** Números que aparecem numa frase dita (a peça não inventa número: só estes valem). */
export function numerosDitos(frase: string): number[] {
  const saida: number[] = [];
  const re = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(frase || "")))) {
    const n = Number(m[1].replace(/\./g, "") + (m[2] ? `.${m[2]}` : ""));
    if (isFinite(n)) saida.push(n);
  }
  return saida;
}

/** O número pedido para a peça foi dito na fala do trecho? */
export function numeroFoiDito(n: number, falaDoTrecho: string): boolean {
  return numerosDitos(falaDoTrecho).some((x) => Math.abs(x - n) < 1e-9);
}

import { ANGULOS, CENAS, LUZES, quantidadeNoTexto, termosNoTexto } from "./diretorDoBook";
import type { ModeloEscolhido, PreenchimentoDaLinha } from "./escolhasDaLinha";

/**
 * O diretor preenche enquanto a pessoa fala (02/10, dono: "conversa e ele
 * vai preenchendo: produto, modelo, ângulos, cenas, quantidade, e gera
 * várias variações juntas"). Leitura determinística do texto (mesmo
 * vocabulário do Diretor do book): sem IA, sem custo, a cada tecla. O
 * resultado vira uma proposta com Confirmar; confirmar grava o
 * preenchimento (escolhasDaLinha) e abre a ferramenta já preenchida, que
 * mostra quantas fotos e o custo antes de gerar.
 */

export interface ProdutoConhecido {
  id: string;
  nome: string;
}

export interface IntencaoDoDiretor {
  objetivo: "variacoes" | "modelo";
  produto: ProdutoConhecido | null;
  modelo: ModeloEscolhido | null;
  angulos: string[];
  cenas: string[];
  luz: string | null;
  quantidade: number | null;
  /** Quantos sinais o texto deu (produto, modelo, quantidade, ângulos, cenas, luz). */
  sinais: number;
}

const semAcento = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const PEDE_PESSOA = /\b(modelos?|pessoas?|mulher|homem|segurando|usando|vestindo|lifestyle com|com alguem|influencer)\b/;
const PEDE_FOTOS = /\b(fotos?|variac(ao|oes)|ensaio|book|imagens?|angulos?|cenas?|campanha)\b/;

/** O nome citado no texto (inteiro vale mais; senão palavras de 4 letras ou mais). */
function citado<T extends { nome: string }>(texto: string, lista: T[]): T | null {
  const t = ` ${semAcento(texto).replace(/[^a-z0-9]+/g, " ")} `;
  let melhor: T | null = null;
  let pontos = 0;
  lista.forEach((x) => {
    const n = semAcento(x.nome).replace(/[^a-z0-9]+/g, " ").trim();
    if (!n) return;
    const p = t.indexOf(` ${n} `) >= 0 ? 100 + n.length : n.split(" ").filter((w) => w.length >= 4 && t.indexOf(` ${w} `) >= 0).length;
    if (p > pontos) {
      melhor = x;
      pontos = p;
    }
  });
  return melhor;
}

const rotuloDe = (lista: { id: string; rotulo: string }[], id: string) => (lista.find((t) => t.id === id) || { rotulo: id }).rotulo;

/** null: o texto não pede foto (pergunta, organizar, aprovar): o diretor responde normal. */
export function lerIntencaoDoDiretor(texto: string, ctx: { produtos: ProdutoConhecido[]; modelos: ModeloEscolhido[]; produtoAberto?: string | null }): IntencaoDoDiretor | null {
  const t = semAcento(texto);
  if (t.trim().length < 6) return null;
  const produto = citado(texto, ctx.produtos);
  const modelo = citado(texto, ctx.modelos);
  const quantidade = quantidadeNoTexto(texto);
  const angulos = termosNoTexto(texto, ANGULOS).map((id) => rotuloDe(ANGULOS, id));
  const cenas = termosNoTexto(texto, CENAS).map((id) => rotuloDe(CENAS, id));
  const luzes = termosNoTexto(texto, LUZES).map((id) => rotuloDe(LUZES, id));
  const sinais = [produto, modelo, quantidade].filter((x) => x !== null).length + (angulos.length ? 1 : 0) + (cenas.length ? 1 : 0) + (luzes.length ? 1 : 0);
  // Precisa pedir foto de verdade: um sinal de foto e algo concreto (quantidade, produto, ângulo, cena ou modelo).
  if (!PEDE_FOTOS.test(t) && !quantidade) return null;
  if (sinais === 0) return null;
  const doAberto = !produto && ctx.produtoAberto ? ctx.produtos.find((p) => p.id === ctx.produtoAberto) || null : null;
  return {
    objetivo: modelo || PEDE_PESSOA.test(t) ? "modelo" : "variacoes",
    produto: produto || doAberto,
    modelo,
    angulos,
    cenas,
    luz: luzes[0] || null,
    quantidade: quantidade ? Math.max(1, Math.min(16, quantidade)) : null,
    sinais,
  };
}

/** O preenchimento que a ferramenta lê (escolhasDaLinha). */
export function preenchimentoDaIntencao(i: IntencaoDoDiretor, texto: string, agora = Date.now()): PreenchimentoDaLinha {
  return {
    objetivo: i.objetivo,
    kitId: i.produto ? i.produto.id : null,
    modelo: i.modelo,
    angulos: i.angulos,
    cenas: i.cenas,
    luz: i.luz,
    quantidade: i.quantidade,
    texto: texto.trim().slice(0, 1500),
    em: agora,
  };
}

/** Os chips da proposta, em ordem: o que a ferramenta vai abrir preenchido. */
export function chipsDaIntencao(i: IntencaoDoDiretor): string[] {
  const chips: string[] = [i.objetivo === "modelo" ? "Foto com modelo" : "Fotos do produto"];
  if (i.produto) chips.push(i.produto.nome);
  if (i.modelo) chips.push(i.modelo.nome);
  chips.push(`${i.quantidade || (i.objetivo === "modelo" ? 6 : 8)} fotos`);
  i.angulos.forEach((a) => chips.push(a));
  i.cenas.forEach((c) => chips.push(c));
  if (i.luz) chips.push(`Luz ${i.luz.toLowerCase()}`);
  return chips;
}

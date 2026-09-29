import { frasesDaFala } from "../../../../supabase/functions/_shared/onda-do-audio";
import { numerosDitos, type IdDaPeca, type PalavraNoTempo } from "./catalogo";

/**
 * Candidatas de animação pela fala (frente EDT, F3). O CÓDIGO acha, em cada
 * frase dita, as peças que dá para montar só com o que foi dito (número,
 * preço, porcentagem, enumeração, "comenta X"...). Quem escolhe se a frase
 * pede animação e qual das candidatas combina é o Jev, no servidor
 * (editor-video/animacoes.ts): o modelo nunca inventa um dado.
 */

export interface CandidataDePeca {
  peca: IdDaPeca;
  params: Record<string, unknown>;
}

export interface FraseParaSugerir {
  k: string;
  inicio_s: number;
  fim_s: number;
  texto: string;
  candidatas: CandidataDePeca[];
}

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const limpar = (t: string) => t.replace(/[.!?…"]+/g, "").replace(/\s+/g, " ").trim();

/** Peças que a frase sustenta sozinha, com os parâmetros tirados do que foi dito. */
export function candidatasDaFrase(frase: string): CandidataDePeca[] {
  const texto = limpar(frase);
  const t = semAcento(texto);
  const palavras = texto.split(" ").filter(Boolean);
  const saida: CandidataDePeca[] = [];
  // Preço: "R$ 97" ou "97 reais".
  const preco = /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/i.exec(texto) || /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)\s+reais/i.exec(texto);
  if (preco) saida.push({ peca: "preco", params: { por: `R$ ${preco[1]}` } });
  // Porcentagem: "80%" ou "80 por cento".
  const pct = /(\d{1,3})(?:\s*%|\s+por\s*cento)/i.exec(t);
  if (pct && Number(pct[1]) <= 100) saida.push({ peca: "barra", params: { valor: Number(pct[1]), rotulo: palavras.slice(0, 5).join(" ") } });
  // Número que impressiona (fora preço e porcentagem): o contador.
  if (!preco && !pct) {
    const numeros = numerosDitos(texto).filter((n) => n >= 2);
    if (numeros.length) {
      const n = numeros[0];
      const m = new RegExp(`${String(n).replace(".", "[.,]")}\\s+([a-zA-ZÀ-ÿ]{2,14})`).exec(texto);
      saida.push({ peca: "contador", params: { ate: n, sufixo: m ? ` ${m[1]}` : "" } });
    }
  }
  // Enumeração: "a, b e c" (3 a 6 itens curtos) vira lista; com "primeiro/depois/por fim", passos.
  const partes = texto.split(/,\s*|\s+e\s+/).map((x) => x.trim()).filter(Boolean);
  if (partes.length >= 3 && partes.length <= 6 && partes.every((x) => x.split(" ").length <= 5)) {
    const passos = /\b(primeiro|segundo|depois|por fim|passo|etapa)\b/.test(t);
    saida.push({ peca: passos ? "passos" : "lista", params: { itens: partes } });
  }
  // "Comenta X" / "escreve X nos comentários".
  const cta = /\b(comenta|comente|escreve|escreva|digita|digite)\s+(?:a palavra\s+|aqui\s+)?"?([^",.!?]{2,30})/i.exec(texto);
  if (cta) saida.push({ peca: "comentario", params: { texto: cta[2].trim() } });
  // Selo: garantia, frete grátis, prazo.
  const selo = /(garantia(?: de \d+ dias)?|frete gr[aá]tis|\d+ dias|certificad[oa])/i.exec(texto);
  if (selo) saida.push({ peca: "selo", params: { texto: selo[1] } });
  // Veredito curto: carimbo.
  const veredito = /\b(mito|verdade|errado|certo|proibido|aprovado|nunca|jamais)\b/i.exec(texto);
  if (veredito) saida.push({ peca: "carimbo", params: { texto: veredito[1].toUpperCase() } });
  // Frase forte e curta: lettering em 2 ou 3 pedaços; muito curta: rótulo.
  if (palavras.length >= 3 && palavras.length <= 9) {
    const n = palavras.length <= 5 ? 2 : 3;
    const tam = Math.ceil(palavras.length / n);
    const pedacos: string[] = [];
    for (let k = 0; k < palavras.length; k += tam) pedacos.push(palavras.slice(k, k + tam).join(" "));
    saida.push({ peca: "lettering", params: { palavras: pedacos } });
  }
  if (palavras.length >= 1 && palavras.length <= 5) saida.push({ peca: "rotulo", params: { texto } });
  return saida;
}

/** Frases da fala na linha do tempo, com as candidatas de cada uma (só as que têm alguma). */
export function frasesParaSugerir(fala: PalavraNoTempo[], max = 40): FraseParaSugerir[] {
  return frasesDaFala(fala, 0.45)
    .map((f, k) => ({ k: `f${k + 1}`, inicio_s: f.i, fim_s: f.f, texto: f.texto.slice(0, 240), candidatas: candidatasDaFrase(f.texto) }))
    .filter((f) => f.candidatas.length > 0)
    .slice(0, max);
}

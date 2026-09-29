import { arred } from "../tempo";
import { falaNaLinhaDoTempo, type PalavraNaLinha } from "../transcricao";
import { Montador, parametrosComPadrao, type Skill, type ValorDoParametro } from "./tipos";

/**
 * Legendas animadas (estilo HyperFrames / clone 03: blocos de até 4 palavras,
 * a palavra falada acende no tempo dela). A legenda acompanha a fala: nada
 * de antecipar a próxima frase (skill Brabo, seção 4). Refaz a trilha de
 * legenda inteira a partir da fala no tempo da linha (depois de cortes).
 */

export const PRESETS_DE_LEGENDA = [
  { valor: "destaque", rotulo: "Palavra acesa" },
  { valor: "caixa", rotulo: "Caixa (adesivo)" },
  { valor: "simples", rotulo: "Simples" },
] as const;

const FIM_DE_FRASE = /[.!?…]$/;

/** Frente EDT (30/09): a legenda padrão da casa é de 3 palavras (a quantidade muda por comando). */
export const PALAVRAS_POR_LEGENDA = 3;

export function blocosDeLegenda(palavras: PalavraNaLinha[], maxPalavras: number, pausaQuebra = 0.5): PalavraNaLinha[][] {
  const blocos: PalavraNaLinha[][] = [];
  let atual: PalavraNaLinha[] = [];
  palavras.forEach((w, k) => {
    const anterior = k > 0 ? palavras[k - 1] : null;
    const quebra = atual.length >= maxPalavras || (anterior && (w.i - anterior.f > pausaQuebra || FIM_DE_FRASE.test(anterior.t) || w.clipe !== anterior.clipe && w.i - anterior.f > 0.05));
    if (quebra && atual.length) {
      blocos.push(atual);
      atual = [];
    }
    atual.push(w);
  });
  if (atual.length) blocos.push(atual);
  return blocos;
}

export function legendasEm(m: Montador, params: Record<string, ValorDoParametro>): number {
  const trilha = m.projeto.trilhas.find((t) => t.tipo === "legenda");
  if (!trilha) {
    m.aplicar({ op: "trilha_nova", tipo: "legenda" });
  }
  const alvo = m.projeto.trilhas.find((t) => t.tipo === "legenda");
  if (!alvo) return 0;
  const palavras = falaNaLinhaDoTempo(m.projeto);
  if (!palavras.length) {
    m.avisar("Sem fala transcrita na trilha de vídeo: nada para legendar.");
    return 0;
  }
  const porPalavra = m.projeto.trilhas
    .filter((t) => t.tipo === "video")
    .every((t) => t.clipes.every((c) => !c.fonte || !m.projeto.transcricoes[c.fonte] || m.projeto.transcricoes[c.fonte].por_palavra));
  if (!porPalavra) m.avisar("A transcrição é por frase: o tempo de cada palavra é estimado. Confira no áudio.");
  const blocos = blocosDeLegenda(palavras, Number(params.palavras_por_bloco));
  if (alvo.clipes.length) m.aplicar({ op: "limpar_trilha", trilha: alvo.id });
  const q = 1 / m.projeto.fps;
  blocos.forEach((b, k) => {
    const prox = k + 1 < blocos.length ? blocos[k + 1][0].i : Infinity;
    const ini = Math.round(b[0].i * m.projeto.fps) / m.projeto.fps;
    let fim = Math.max(b[b.length - 1].f, ini + 0.3);
    fim = Math.min(fim, prox);
    fim = Math.round(fim * m.projeto.fps) / m.projeto.fps;
    if (fim - ini < q) return;
    m.aplicar({
      op: "inserir",
      trilha: alvo.id,
      clipe: {
        inicio_s: arred(ini),
        entrada_s: 0,
        saida_s: arred(fim - ini),
        texto: b.map((w) => w.t).join(" "),
        estilo: {
          ...(params.posicao ? { posicao: String(params.posicao) } : {}),
          preset: String(params.estilo),
          animacao: params.estilo === "simples" ? "nenhuma" : "palavra",
          palavras: b.map((w) => ({ t: w.t, i: arred(w.i - ini), f: arred(w.f - ini) })),
        },
        origem: { tipo: "skill", ref: "legendas" },
      },
    });
  });
  return blocos.length;
}

export const SKILL_LEGENDAS: Skill = {
  id: "legendas",
  rotulo: "Legendas animadas",
  descricao: "Legenda da fala em blocos curtos (padrão 3 palavras); a palavra dita acende na hora dela.",
  referencia: "HyperFrames (embedded-captions) / clone-03-shopify (legenda_corte.srt)",
  precisaDeFala: true,
  parametros: [
    { chave: "palavras_por_bloco", rotulo: "Palavras por bloco", tipo: "numero", padrao: PALAVRAS_POR_LEGENDA, min: 1, max: 8, passo: 1 },
    { chave: "estilo", rotulo: "Estilo", tipo: "escolha", padrao: "destaque", opcoes: PRESETS_DE_LEGENDA.map((x) => ({ valor: x.valor, rotulo: x.rotulo })) },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_LEGENDAS, dados);
    const m = new Montador(p);
    const n = legendasEm(m, params);
    if (n) m.aplicar({ op: "registrar_skill", skill: "legendas", resumo: `${n} blocos`, em: ctx.agora });
    return m.proposta("legendas", "Legendas animadas", n ? `${n} ${n === 1 ? "bloco" : "blocos"} de legenda.` : "Nada para legendar.");
  },
};

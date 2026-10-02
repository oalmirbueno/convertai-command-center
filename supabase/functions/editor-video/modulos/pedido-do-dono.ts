/**
 * O pedido do dono é lei (02/10, auditoria da Mesa Edição: "sem legenda" e
 * saíram 47 blocos de legenda). PURO, sem import: a tela (agente, atalho,
 * painel Editar com IA) e a função editor-video usam o mesmo.
 *
 * O texto do dono vira uma receita explícita: o que ele NÃO quer (sem
 * legenda, nada de música, tira o zoom), o que ele quer (com legenda,
 * coloca música), "só cortes", opções da legenda (grande, no meio, embaixo,
 * N palavras) e "mantém o começo". Negação clara é regra fixa do código; o
 * que fica em dúvida ("talvez uma música", "se precisar, legenda") vai em
 * `ambiguos` para o Jev julgar no servidor. Toda etapa da edição consulta a
 * receita, e o relatório final diz o que NÃO foi feito por causa do pedido.
 */

export const PECAS_DO_PEDIDO = ["legenda", "musica", "zoom", "cortes", "motion", "textos", "broll", "sons", "transicoes", "cor", "logo", "cartao_final", "ritmo"] as const;
export type PecaDoPedido = (typeof PECAS_DO_PEDIDO)[number];

export const ROTULO_DA_PECA: Record<PecaDoPedido, string> = {
  legenda: "legenda",
  musica: "música",
  zoom: "zoom e punch-in",
  cortes: "cortes",
  motion: "animações",
  textos: "textos na tela",
  broll: "B-roll",
  sons: "efeitos sonoros",
  transicoes: "transições",
  cor: "cor",
  logo: "logo",
  cartao_final: "cartão final",
  ritmo: "ritmo de cortes",
};

export interface PedidoDoDono {
  sem: PecaDoPedido[];
  com: PecaDoPedido[];
  /** "só cortes", "apenas legenda": tudo o que não está aqui fica de fora. */
  so: PecaDoPedido[] | null;
  legenda: { tamanho: "grande" | "pequena" | null; posicao: "topo" | "meio" | "base" | null; palavras: number | null };
  manter_comeco: boolean;
  /** Citadas sem negação nem pedido claro ("talvez", "se precisar"): o Jev julga. */
  ambiguos: PecaDoPedido[];
  /** O que o código entendeu, em frases curtas (vai no relatório). */
  lido: string[];
}

const PADROES: Record<PecaDoPedido, RegExp> = {
  legenda: /\b(legendas?|legendad\w*|legendar|captions?|subtitul\w*)\b/,
  musica: /\b(musicas?|trilha sonora|som de fundo|fundo musical|bgm)\b/,
  zoom: /\b(zoom|zooms|punch[- ]?ins?|punch|aproxima\w*)\b/,
  cortes: /\b(cortes?|cortar|corta|picot\w*|pausas?|silencios?)\b/,
  motion: /\b(animac\w*|motion|graficos?|motion graphics?|artes? na tela|efeitos visuais)\b/,
  textos: /\b(textos?( na tela)?|titulos?|lettering|escrita na tela|letreiros?|chamadas? na tela)\b/,
  broll: /\b(b-?rolls?|imagens? de apoio|cobertura)\b/,
  sons: /\b(efeitos? sonoros?|sonoplastia|sfx|barulhinhos?)\b/,
  transicoes: /\b(transic\w*)\b/,
  cor: /\b(cor|cores|filtros?|look|color\w*|lut)\b/,
  logo: /\b(logo|logomarca|marca d.?agua)\b/,
  cartao_final: /\b(cartao final|tela final|end ?card|encerramento)\b/,
  ritmo: /\b(ritmo|batidas?|dinamic\w*|cortes? rapidos?)\b/,
};

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const NEGA = /\b(sem|nada de|nenhum\w*|zero|dispens\w*|tira\w*|tire|remov\w*|exclu\w*|nao)\b/;
const AFIRMA = /\b(com|coloc\w*|bot\w*|poe|ponha|adicion\w*|quero|inclu\w*|faz\w*|faca|usa|use|capricha\w*)\b/;
const DUVIDA = /\b(talvez|se precisar|se der|se quiser|nao sei|tanto faz|pode ser|quem sabe|se fizer sentido|se achar)\b/;
const SO = /\b(so|apenas|somente|unicamente)\b/;

/** Lê o pedido do dono. Texto vazio: nada proibido, nada exigido. */
export function lerPedidoDoDono(texto: string): PedidoDoDono {
  const t = semAcento(texto);
  const r: PedidoDoDono = { sem: [], com: [], so: null, legenda: { tamanho: null, posicao: null, palavras: null }, manter_comeco: false, ambiguos: [], lido: [] };
  if (!t.trim()) return r;
  const juntar = (l: PecaDoPedido[], p: PecaDoPedido) => {
    if (l.indexOf(p) < 0) l.push(p);
  };
  // Orações: vírgula, ponto, ponto e vírgula, "mas" e "porém" separam; "e"/"nem" continuam a mesma.
  const oracoes = t
    .split(/[.;!?\n]+|,|\bmas\b|\bporem\b|\bpor outro lado\b/)
    .map((x) => x.trim())
    .filter(Boolean);
  let legendaCitada = false;
  oracoes.forEach((o) => {
    const duvida = DUVIDA.test(o);
    if (PADROES.legenda.test(o)) legendaCitada = true;
    PECAS_DO_PEDIDO.forEach((p) => {
      const m = PADROES[p].exec(o);
      if (!m) return;
      // "cortes rápidos" é ritmo, não a peça cortes; "legenda gravada" é outra coisa (tirar a legenda queimada).
      if (p === "cortes" && /\bcortes? rapidos?\b/.test(o) && !/\b(pausas?|silencios?)\b/.test(o)) return;
      if (p === "legenda" && /\blegendas? (gravad|queimad|original|embutid)/.test(o)) return;
      const antes = o.slice(0, m.index);
      // Janela de até 5 palavras antes da peça: é ali que a negação vale ("sem legenda e música" ainda pega a música).
      const janela = antes.trim().split(/\s+/).slice(-5).join(" ");
      const depois = o.slice(m.index + m[0].length, m.index + m[0].length + 14);
      const nega = NEGA.test(janela) || /\bnem\b/.test(janela) || /^\s*(nao|nunca|jamais|nenhum\w*)\b/.test(depois);
      const afirma = AFIRMA.test(janela);
      if (duvida && !/\b(sem|nada de)\b/.test(janela)) {
        juntar(r.ambiguos, p);
        return;
      }
      // Pausa e silêncio: "sem pausas", "tira os silêncios" é pedir o CORTE.
      const ehPausa = p === "cortes" && /^(pausas?|silencios?)$/.test(m[0]);
      if (nega) {
        if (ehPausa || /\bnao (tira|tire|remov\w*)\b/.test(janela)) juntar(r.com, p);
        else juntar(r.sem, p);
        return;
      }
      if (SO.test(janela) && janela.split(/\s+/).length <= 4) {
        r.so = r.so || [];
        juntar(r.so, p);
        return;
      }
      if (afirma || ehPausa || /\b(grande|gigante|no meio|embaixo|em cima|no topo|na base|palavras?)\b/.test(o)) juntar(r.com, p);
    });
    // "só corta", "só tira as pausas": só cortes.
    if (/\b(so|apenas|somente)\s+(corta|cortar|tira[r]? as pausas|tira[r]? os silencios|limpa[r]?)\b/.test(o)) {
      r.so = r.so || [];
      juntar(r.so, "cortes");
    }
    if (/\b(mant(em|enha|er)|deix[ae]|preserv\w*|nao (corta|corte|mexe|mexa) n?o?)\s+(o |a )?(comeco|inicio|abertura)\b/.test(o)) r.manter_comeco = true;
    // Opções da legenda: na oração que fala dela ou na seguinte ("legenda grande no meio, 2 palavras").
    if (legendaCitada && r.sem.indexOf("legenda") < 0) {
      if (/\b(grande|gigante|enorme)\b/.test(o)) r.legenda.tamanho = "grande";
      else if (/\b(pequen\w*|discret\w*|menor)\b/.test(o)) r.legenda.tamanho = "pequena";
      if (/\b(no meio|no centro|centralizad\w*)\b/.test(o)) r.legenda.posicao = "meio";
      else if (/\b(embaixo|em baixo|na base|rodape|parte de baixo)\b/.test(o)) r.legenda.posicao = "base";
      else if (/\b(em cima|no topo|parte de cima)\b/.test(o)) r.legenda.posicao = "topo";
      const n = /\b(\d)\s+palavras?\b/.exec(o);
      if (n) r.legenda.palavras = Math.max(1, Math.min(8, Number(n[1])));
    }
  });
  // Pedido que nega e afirma a mesma peça: a negação clara vence.
  r.com = r.com.filter((p) => r.sem.indexOf(p) < 0);
  r.ambiguos = r.ambiguos.filter((p) => r.sem.indexOf(p) < 0 && r.com.indexOf(p) < 0);
  if (r.so) r.so = r.so.filter((p) => r.sem.indexOf(p) < 0);
  r.sem.forEach((p) => r.lido.push(`sem ${ROTULO_DA_PECA[p]}`));
  if (r.so && r.so.length) r.lido.push(`só ${r.so.map((p) => ROTULO_DA_PECA[p]).join(" e ")}`);
  r.com.forEach((p) => r.lido.push(`com ${ROTULO_DA_PECA[p]}`));
  if (r.legenda.tamanho) r.lido.push(`legenda ${r.legenda.tamanho}`);
  if (r.legenda.posicao) r.lido.push(`legenda ${r.legenda.posicao === "meio" ? "no meio" : r.legenda.posicao === "base" ? "embaixo" : "em cima"}`);
  if (r.legenda.palavras) r.lido.push(`legenda de ${r.legenda.palavras} ${r.legenda.palavras === 1 ? "palavra" : "palavras"}`);
  if (r.manter_comeco) r.lido.push("mantém o começo");
  return r;
}

/** A peça pode entrar? (negada ou fora do "só": não). */
export function pecaPermitida(p: PedidoDoDono | null | undefined, peca: PecaDoPedido): boolean {
  if (!p) return true;
  if (p.sem.indexOf(peca) >= 0) return false;
  if (p.so && p.so.length && p.so.indexOf(peca) < 0) return false;
  return true;
}

/** Por que a peça ficou de fora (para o relatório), ou null. */
export function motivoDoPedido(p: PedidoDoDono | null | undefined, peca: PecaDoPedido): string | null {
  if (!p) return null;
  if (p.sem.indexOf(peca) >= 0) return `${ROTULO_DA_PECA[peca]}: você pediu sem`;
  if (p.so && p.so.length && p.so.indexOf(peca) < 0) return `${ROTULO_DA_PECA[peca]}: você pediu só ${p.so.map((x) => ROTULO_DA_PECA[x]).join(" e ")}`;
  return null;
}

/** Junta o julgamento do Jev (probabilidade de o dono QUERER cada peça ambígua): abaixo de 0,35 sai, acima de 0,65 entra. */
export function comJulgamento(p: PedidoDoDono, querer: Partial<Record<PecaDoPedido, number>>): PedidoDoDono {
  const r: PedidoDoDono = { ...p, sem: p.sem.slice(), com: p.com.slice(), ambiguos: [], lido: p.lido.slice() };
  p.ambiguos.forEach((peca) => {
    const pr = querer[peca];
    if (typeof pr !== "number") return;
    if (pr < 0.35) {
      r.sem.push(peca);
      r.lido.push(`sem ${ROTULO_DA_PECA[peca]} (julgado pelo Jev)`);
    } else if (pr > 0.65) {
      r.com.push(peca);
      r.lido.push(`com ${ROTULO_DA_PECA[peca]} (julgado pelo Jev)`);
    }
  });
  return r;
}

/** Ferramenta do agente que o pedido proíbe (o motivo volta ao modelo), ou null. */
export function ferramentaBarrada(p: PedidoDoDono | null | undefined, ferramenta: string, args: Record<string, unknown> | null | undefined): string | null {
  if (!p) return null;
  const a = args || {};
  const pecas: PecaDoPedido[] = [];
  const skill = String(a.skill || "");
  if (ferramenta === "legendar" || (ferramenta === "aplicar_skill" && skill === "legendas")) pecas.push("legenda");
  if (ferramenta === "aplicar_skill" && skill === "brabo") pecas.push("cortes", "zoom", "legenda", "ritmo");
  if (["recortar", "cortar_pela_onda", "ficar_com_melhor_tomada"].indexOf(ferramenta) >= 0 || (ferramenta === "aplicar_skill" && ["cortar_silencios", "cortar_pela_onda", "ficar_com_melhor_tomada"].indexOf(skill) >= 0)) pecas.push("cortes");
  if (ferramenta === "zoom_momentos" || (ferramenta === "efeito" && String(a.tipo || a.efeito || "") === "zoom") || (ferramenta === "aplicar_skill" && (skill === "punch_in" || skill === "zoom_nos_momentos"))) pecas.push("zoom");
  if (ferramenta === "musica") pecas.push("musica");
  if (ferramenta === "sons" || (ferramenta === "aplicar_skill" && skill === "efeitos_sonoros")) pecas.push("sons");
  if (ferramenta === "animar" || ferramenta === "sugerir_animacoes") pecas.push("motion");
  if (ferramenta === "inserir_texto") pecas.push("textos");
  if (ferramenta === "transicao" || (ferramenta === "aplicar_skill" && skill === "transicoes_suaves")) pecas.push("transicoes");
  if (ferramenta === "cor" || (ferramenta === "aplicar_skill" && skill === "cor")) pecas.push("cor");
  if (ferramenta === "logo") pecas.push("logo");
  if (ferramenta === "cartao_final") pecas.push("cartao_final");
  if (ferramenta === "gerar_broll") pecas.push("broll");
  for (const peca of pecas) {
    const m = motivoDoPedido(p, peca);
    if (m) return `Recusado pelo pedido do dono (${m}). Não use ${ferramenta}${ferramenta === "aplicar_skill" ? ` (${skill})` : ""}.`;
  }
  return null;
}

/** Perguntas ao Jev (Noul) para as peças ambíguas: o dono QUER a peça? */
export function perguntasDoPedido(texto: string, pecas: PecaDoPedido[]): { state: unknown; questions: Record<string, { type: "noul"; instructions: string; criteria: { true: string; false: string } }> } {
  const questions: Record<string, { type: "noul"; instructions: string; criteria: { true: string; false: string } }> = {};
  pecas.forEach((p) => {
    questions[`quer_${p}`] = {
      type: "noul",
      instructions: `O dono de uma agência pediu a edição de um vídeo curto com o texto em \`pedido\`. Pelo que ele escreveu, ele quer ${ROTULO_DA_PECA[p]} neste vídeo?`,
      criteria: { true: `quer ${ROTULO_DA_PECA[p]} no vídeo`, false: `prefere o vídeo sem ${ROTULO_DA_PECA[p]}` },
    };
  });
  return { state: { pedido: String(texto || "").slice(0, 1500) }, questions };
}

/**
 * Receita escolhida pelo modelo x pedido (02/10, dono: "liberdade; nada de
 * edição dura porque ela é advogada; o vídeo SEMPRE engaja"): receita calma
 * (institucional, depoimento, aula) só vale quando o PEDIDO pede esse tom;
 * a profissão ou o setor do cliente nunca escolhem receita sóbria.
 */
export function receitaPeloPedido(receita: string, texto: string): string {
  const calmas = ["institucional", "depoimento", "aula"];
  if (calmas.indexOf(receita) < 0) return receita;
  const t = semAcento(texto);
  const pediu = /\b(institucional|depoimento|aula|tutorial|passo a passo|calm\w*|sobri\w*|suave|devagar|elegante|leve|tranquil\w*)\b/.test(t);
  return pediu ? receita : "dinamico";
}

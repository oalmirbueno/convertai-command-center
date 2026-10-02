import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { falaNaLinhaDoTempo, type PalavraNaLinha } from "../transcricao";
import { arred } from "../tempo";
import { frasesDaFala } from "../skills/pecasDaEdicao";
import { chamadaDaFrase, limparPalavra, melhoresTrechos, pesoDaPalavra, trechosChave, type TrechoChave } from "../skills/palavrasChave";
import type { IdDaPeca } from "./catalogo";

/**
 * Diretor de motion da edição (02/10, auditoria: "só corta, põe legenda e
 * fica genérico"). Regra FIXA do código sobre a fala medida, sem modelo e
 * sem custo, para que TODA edição completa saia com arte desenhada na marca
 * (o Jev ainda escolhe animações extras quando responde):
 *
 * - gancho: as palavras-chave da primeira frase, grandes, entrando no tempo
 *   em que são ditas (nada de resumo inventado);
 * - nome e cargo: quando o dono ou o plano disseram quem fala;
 * - palavra em destaque: sigla, número e termo forte, um a cada ~7 s,
 *   chegando NA palavra (o auge cai no tempo dela), lado variando;
 * - lista: enumeração dita (itens separados por pausa ou vírgula);
 * - chamada: a chamada dita no fim (salva, comenta, segue), sem tapar a
 *   pessoa (substitui o cartão final escuro por cima da fala).
 * Espaço mínimo entre peças e nada nos 0,4 s finais. Com legenda, as peças
 * vão para a faixa de cima.
 */

export interface PecaPlanejada {
  peca: IdDaPeca;
  inicio_s: number;
  duracao_s: number;
  params: Record<string, unknown>;
  motivo: string;
}

export interface OpcoesDoDiretor {
  /** Textos na tela permitidos (gancho, destaque, nome). */
  textos: boolean;
  /** Animações permitidas (lista, chamada). */
  motion: boolean;
  densidade: "poucas" | "medias";
  /** Gancho do plano (já conferido contra a fala); vazio = as palavras-chave da 1ª frase. */
  gancho?: string;
  nome?: string;
  cargo?: string;
  /** Com legenda: peças na faixa de cima. */
  comLegenda?: boolean;
  /** Trechos já ocupados (animações do Jev). */
  ocupado?: { de: number; ate: number }[];
}

export interface PlanoDoDiretor {
  pecas: PecaPlanejada[];
  /** O que não entrou e por quê (vai no relatório). */
  fora: string[];
  /** Fim da chamada dita (o cartão final não cobre a fala). */
  chamada_s: number | null;
}

const ESPACO_S = 4.2;
const capital = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

interface Pedaco {
  palavras: PalavraNaLinha[];
  i: number;
  f: number;
}

/**
 * Pedaços de fala separados por pausa (ou vírgula). 0,17 s: depois do corte
 * limpo, a pausa entre os itens de uma lista vira o respiro de 0,2 s.
 */
function pedacos(fala: PalavraNaLinha[], pausa = 0.17): Pedaco[] {
  const saida: Pedaco[] = [];
  let atual: PalavraNaLinha[] = [];
  fala.forEach((w, k) => {
    const ant = k ? fala[k - 1] : null;
    if (ant && (w.i - ant.f >= pausa || /,$/.test(ant.t))) {
      saida.push({ palavras: atual, i: atual[0].i, f: atual[atual.length - 1].f });
      atual = [];
    }
    atual.push(w);
  });
  if (atual.length) saida.push({ palavras: atual, i: atual[0].i, f: atual[atual.length - 1].f });
  return saida;
}

const texto = (l: PalavraNaLinha[]) => l.map((w) => limparPalavra(w.t)).join(" ");

/** Enumeração dita: 3 ou mais itens curtos separados por pausa ou vírgula (o último pode vir com "e"). */
export function enumeracoes(fala: PalavraNaLinha[]): { titulo: string | null; itens: string[]; inicio_s: number; fim_s: number }[] {
  const ps = pedacos(fala);
  const saida: { titulo: string | null; itens: string[]; inicio_s: number; fim_s: number }[] = [];
  let k = 0;
  while (k < ps.length) {
    let j = k;
    while (j < ps.length && ps[j].palavras.length <= 3) j++;
    // Pedaços curtos seguidos [k, j) e, depois, um mais longo com "e" (o último item).
    const curtos = ps.slice(k, j);
    const ultimo = j < ps.length ? ps[j] : null;
    const comE = ultimo && ultimo.palavras.findIndex((w, x) => x > 0 && /^e$/i.test(limparPalavra(w.t)));
    const itens: { t: string; i: number; f: number }[] = [];
    let titulo: string | null = null;
    curtos.forEach((p, x) => {
      if (x === 0 && p.palavras.length === 2 && pesoDaPalavra(p.palavras[0].t).peso < 1) {
        titulo = capital(limparPalavra(p.palavras[0].t));
        itens.push({ t: limparPalavra(p.palavras[1].t), i: p.palavras[1].i, f: p.f });
      } else itens.push({ t: texto(p.palavras), i: p.i, f: p.f });
    });
    let fim = curtos.length ? curtos[curtos.length - 1].f : 0;
    if (ultimo && typeof comE === "number" && comE > 0 && comE <= 3 && curtos.length >= 2) {
      const antesDoE = ultimo.palavras.slice(0, comE);
      const depoisDoE: PalavraNaLinha[] = [];
      for (const w of ultimo.palavras.slice(comE + 1)) {
        if (depoisDoE.length >= 3) break;
        if (depoisDoE.length && pesoDaPalavra(w.t).peso <= 0) break;
        depoisDoE.push(w);
      }
      itens.push({ t: texto(antesDoE), i: antesDoE[0].i, f: antesDoE[antesDoE.length - 1].f });
      if (depoisDoE.length) {
        itens.push({ t: texto(depoisDoE), i: depoisDoE[0].i, f: depoisDoE[depoisDoE.length - 1].f });
        fim = depoisDoE[depoisDoE.length - 1].f;
      }
    }
    // O primeiro pedaço de 1 palavra seguido de 3+ itens é o título ("Separe: a, b, c").
    if (!titulo && itens.length >= 4 && curtos.length && curtos[0].palavras.length === 1 && pesoDaPalavra(curtos[0].palavras[0].t).peso < 1) titulo = capital(itens.shift()!.t);
    if (itens.length >= 3 && itens.every((x) => x.t.split(" ").length <= 3)) {
      saida.push({ titulo, itens: itens.slice(0, 6).map((x) => x.t), inicio_s: itens[0].i, fim_s: fim });
      k = j + 1;
    } else k = Math.max(k + 1, j);
  }
  return saida;
}

/** O plano de motion da fala do projeto (puro). */
export function planoDoDiretor(p: ProjetoDeEdicao, o: OpcoesDoDiretor): PlanoDoDiretor {
  const fala = falaNaLinhaDoTempo(p);
  const fora: string[] = [];
  const pecas: PecaPlanejada[] = [];
  if (!fala.length) return { pecas, fora: ["sem fala marcada: o diretor de motion precisa da fala"], chamada_s: null };
  const total = fala[fala.length - 1].f;
  const fim = Math.max(total, p.duracao_s);
  const frases = frasesDaFala(fala);
  const faixa = o.comLegenda ? "alto" : "baixo";
  const ocupado: { de: number; ate: number }[] = (o.ocupado || []).slice();
  // Uma peça de cada vez: entre duas peças, pelo menos 0,4 s de tela limpa.
  const FOLGA = 0.4;
  const livre = (de: number, ate: number) => !ocupado.some((x) => de < x.ate + FOLGA && ate > x.de - FOLGA);
  const por = (x: PecaPlanejada) => {
    pecas.push({ ...x, inicio_s: arred(x.inicio_s), duracao_s: arred(x.duracao_s) });
    ocupado.push({ de: x.inicio_s, ate: x.inicio_s + x.duracao_s });
  };
  const chaves = trechosChave(fala);

  // 1. Gancho: as palavras-chave da 1ª frase (ou o gancho do plano), cada linha no tempo dela.
  let fimDoGancho = 0;
  if (o.textos) {
    const primeira = frases[0];
    const ateGancho = Math.min(primeira.fim_s, primeira.inicio_s + 6);
    const daPrimeira = chaves.filter((t) => t.i >= primeira.inicio_s - 1e-6 && t.f <= ateGancho + 1e-6);
    let linhas: { t: string; i: number }[] = [];
    if (o.gancho && o.gancho.trim()) {
      const ws = o.gancho.trim().split(/\s+/);
      const n = ws.length <= 3 ? 1 : ws.length <= 6 ? 2 : 3;
      const tam = Math.ceil(ws.length / n);
      for (let k = 0; k < ws.length; k += tam) linhas.push({ t: ws.slice(k, k + tam).join(" "), i: primeira.inicio_s + (k / ws.length) * Math.min(2.4, ateGancho - primeira.inicio_s) });
    } else {
      linhas = daPrimeira
        .slice()
        .sort((a, b) => b.peso - a.peso)
        .slice(0, 3)
        .sort((a, b) => a.i - b.i)
        .map((t) => ({ t: t.motivo === "sigla" ? t.texto : capital(t.texto), i: t.i }));
    }
    if (linhas.length) {
      const ini = Math.max(0, Math.min(fala[0].i, linhas[0].i - 0.2));
      const ultima = linhas[linhas.length - 1].i;
      const dur = Math.max(2.2, Math.min(4.8, ultima - ini + 1.1));
      por({ peca: "gancho", inicio_s: ini, duracao_s: dur, params: { linhas: linhas.map((l) => l.t), faixa }, motivo: "gancho nos primeiros segundos" });
      fimDoGancho = ini + dur;
    } else fora.push("título do gancho: a primeira frase não tem palavra-chave");
  }

  // 2. Nome e cargo, logo depois do gancho.
  if (o.textos && o.nome && o.nome.trim()) {
    const ini = Math.max(fimDoGancho + 0.3, 1.2);
    if (ini + 3.2 < fim - 4) por({ peca: "terco_inferior", inicio_s: ini, duracao_s: 3.2, params: { nome: o.nome.trim(), cargo: (o.cargo || "").trim() }, motivo: "quem fala" });
  } else if (o.textos) fora.push("nome e cargo: não informados (diga no pedido, ex.: \"nome: Ana Souza | advogada\")");

  // 3. Chamada dita no fim.
  let chamada_s: number | null = null;
  if (o.motion || o.textos) {
    // A chamada pode estar no meio da última "frase" do transcritor (sem pontuação): procura o verbo que abre trecho.
    let cta: { inicio_s: number; texto: string } | null = null;
    for (let k = fala.length - 1; k >= 0 && fala[k].i >= fim * 0.6; k--) {
      const abre = k === 0 || fala[k].i - fala[k - 1].f >= 0.2 || /[.!?,]$/.test(fala[k - 1].t) || /^[A-ZÀ-Ý]/.test(fala[k].t);
      if (abre && chamadaDaFrase(fala[k].t)) {
        cta = { inicio_s: fala[k].i, texto: fala.slice(k, k + 8).map((w) => w.t).join(" ") };
        break;
      }
    }
    if (cta) {
      const c = chamadaDaFrase(cta.texto)!;
      const ws = cta.texto.split(/\s+/).map(limparPalavra).filter(Boolean).slice(0, 6);
      // Não termina em palavra solta ("para montar a"): corta as palavras comuns do fim.
      while (ws.length > 2 && pesoDaPalavra(ws[ws.length - 1]).peso <= 0.4) ws.pop();
      const ini = Math.max(0, cta.inicio_s - 0.1);
      const dur = Math.max(2.4, Math.min(4.5, fim - ini - 0.04));
      const icone = c.botao === "Salvar" ? "salvar" : c.botao === "Comentar" ? "comentar" : c.botao === "Seguir" ? "seguir" : c.botao === "Clicar no link" ? "link" : "compartilhar";
      por({ peca: "chamada", inicio_s: ini, duracao_s: dur, params: { texto: capital(ws.join(" ")), botao: c.botao, icone }, motivo: "chamada dita no fim" });
      chamada_s = ini;
    } else fora.push("chamada: o fim da fala não pede ação (salva, comenta, segue)");
  }

  // 4. Lista: enumeração dita.
  if (o.motion) {
    enumeracoes(fala).forEach((e) => {
      const ini = Math.max(0, e.inicio_s - 0.2);
      const dur = Math.max(3, Math.min(6, e.fim_s - ini + 1.2));
      if (!livre(ini, ini + dur)) return;
      por({ peca: "lista", inicio_s: ini, duracao_s: dur, params: { itens: e.itens, ...(e.titulo ? { titulo: e.titulo } : {}) }, motivo: "enumeração dita" });
    });
  }

  // 5. Palavras em destaque, chegando na palavra.
  if (o.textos) {
    const cada = o.densidade === "poucas" ? 12 : 7;
    const maximo = Math.max(1, Math.floor(fim / cada));
    const fortes = chaves.filter((t) => t.peso >= 1.2 && t.texto.length >= 3);
    const escolhidas: TrechoChave[] = melhoresTrechos(fortes, { espaco_s: ESPACO_S, maximo: maximo * 2, fora: ocupado.map((x) => ({ de: x.de - FOLGA, ate: x.ate + FOLGA })) });
    const lados = ["centro", "esquerda", "direita"];
    let n = 0;
    escolhidas.forEach((t) => {
      if (n >= maximo) return;
      const ini = Math.max(0, t.i - 0.15);
      const dur = Math.max(1.4, Math.min(2.2, t.f - ini + 1));
      if (ini + dur > fim - 0.4 || !livre(ini, ini + dur)) return;
      por({ peca: "destaque", inicio_s: ini, duracao_s: dur, params: { texto: t.motivo === "sigla" ? t.texto : capital(t.texto), lado: lados[n % lados.length], faixa }, motivo: `${t.motivo} dito` });
      n++;
    });
    if (!n) fora.push("palavra em destaque: nenhuma sigla, número ou termo forte longe das outras peças");
  }
  pecas.sort((a, b) => a.inicio_s - b.inicio_s);
  return { pecas, fora, chamada_s };
}

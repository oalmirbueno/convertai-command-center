import { duracaoDoClipe, type ClipeDoProjeto, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, fimDoClipe, trilhaPrincipal } from "../operacoes";
import { arred } from "../tempo";
import { falaNaLinhaDoTempo, type PalavraNaLinha } from "../transcricao";
import { escalaMaximaSegura, ORIGEM_SEGURA_DO_ZOOM } from "../sequencias";
import { ehPergunta, trechosChave } from "./palavrasChave";
import { frasesDaFala } from "./pecasDaEdicao";
import type { Montador } from "./tipos";

/**
 * Câmera e ritmo da edição (02/10, auditoria: "robótico": zoom 1,08 em
 * EXATAMENTE um clipe sim, um não, o vídeo todo). Brabo + EDIT IA PRO, com
 * as regras do video-use:
 *
 * Ritmo: plano de 2,4 a 3,8 s, variando (nunca a mesma batida), com a divisa
 * sempre num vão entre palavras (de preferência fim de frase), nunca no meio
 * de palavra, e nenhum plano abaixo de 1,2 s.
 *
 * Câmera com motivo, variada, nunca dois movimentos iguais seguidos:
 * - gancho (primeiro plano): empurrão lento até o rosto;
 * - plano com ênfase (sigla, número, termo forte, pergunta): corte para
 *   fechado (punch-in), alternando o fechado parado e o fechado andando;
 * - troca de assunto: recuo (abre e respira);
 * - o resto alterna aberto, médio e empurrão leve;
 * - jump cut (mesma fonte encostada) muda pelo menos 5% de escala no corte
 *   (esconde o pulo);
 * - escala que não come a cabeça: origem do zoom no rosto ou acima do centro e
 *   teto pela folga de cima (sequencias.ts).
 */

export type Movimento = "aberto" | "medio" | "fechado" | "empurrao" | "fechado_andando" | "recuo";

export const MOVIMENTOS: Record<Movimento, { de: number; para: number } | null> = {
  aberto: null,
  medio: { de: 1.06, para: 1.06 },
  fechado: { de: 1.14, para: 1.14 },
  empurrao: { de: 1, para: 1.08 },
  fechado_andando: { de: 1.12, para: 1.18 },
  recuo: { de: 1.12, para: 1.02 },
};

export const ROTULO_DO_MOVIMENTO: Record<Movimento, string> = {
  aberto: "aberto",
  medio: "médio",
  fechado: "fechado (punch-in)",
  empurrao: "empurrão lento",
  fechado_andando: "fechado andando",
  recuo: "recuo",
};

const inicioDe = (m: Movimento) => (MOVIMENTOS[m] ? (MOVIMENTOS[m] as { de: number }).de : 1);
const fimDe = (m: Movimento) => (MOVIMENTOS[m] ? (MOVIMENTOS[m] as { para: number }).para : 1);

// ------------------------------------------------------------------ ritmo

/** Batidas-alvo (s), em ciclo: o ritmo varia, nunca a mesma batida. */
export const BATIDAS = [2.8, 3.4, 2.4, 3.8, 3.0, 2.6];

export interface RegrasDoRitmo {
  /** Maior plano sem corte (s). */
  maximo_s: number;
  /** Menor plano (s). */
  minimo_s: number;
  /** Multiplica as batidas (1 = padrão; o "batida_s" do pedido ajusta). */
  escala: number;
}

export const RITMO_PADRAO: RegrasDoRitmo = { maximo_s: 4, minimo_s: 1.2, escala: 1 };

/** Pontos de divisão (tempo da linha) da trilha principal, nos vãos entre palavras. */
export function pontosDoRitmo(p: ProjetoDeEdicao, regras: Partial<RegrasDoRitmo> = {}): { clipe: string; em_s: number }[] {
  const r = { ...RITMO_PADRAO, ...regras };
  const t = trilhaPrincipal(p);
  if (!t) return [];
  const fps = p.fps > 0 ? p.fps : 25;
  const fala = falaNaLinhaDoTempo(p);
  const dentroDePalavra = (s: number) => fala.some((w) => s > w.i + 0.005 && s < w.f - 0.005);
  // Vãos: meio do espaço entre palavras; o peso prefere fim de frase (vão maior).
  const vaos: { s: number; peso: number }[] = [];
  for (let k = 1; k < fala.length; k++) {
    const vao = fala[k].i - fala[k - 1].f;
    if (vao < 0) continue;
    const meio = Math.round(((fala[k - 1].f + fala[k].i) / 2) * fps) / fps;
    if (dentroDePalavra(meio)) continue;
    vaos.push({ s: arred(meio), peso: vao + (/[.!?…,]$/.test(fala[k - 1].t) ? 0.3 : 0) });
  }
  const pontos: { clipe: string; em_s: number }[] = [];
  let ciclo = 0;
  emOrdem(t).forEach((c) => {
    const fim = fimDoClipe(c);
    let ini = c.inicio_s;
    for (let volta = 0; volta < 60 && fim - ini > r.maximo_s; volta++) {
      const alvo = BATIDAS[ciclo % BATIDAS.length] * r.escala;
      let candidatos = vaos.filter((v) => v.s > ini + r.minimo_s && v.s < fim - r.minimo_s && v.s <= ini + r.maximo_s + 1e-6);
      // Sem fala marcada: a batida cai no tempo exato (a tela avisa que pode pegar meio de palavra).
      if (!fala.length) candidatos = [{ s: arred(Math.round(Math.min(fim - r.minimo_s, ini + alvo) * fps) / fps), peso: 0 }];
      if (!candidatos.length) break;
      // Perto da batida-alvo, com bônus para o vão maior (fim de frase).
      const melhor = candidatos.reduce((a, b) => (Math.abs(a.s - ini - alvo) - a.peso * 1.5 <= Math.abs(b.s - ini - alvo) - b.peso * 1.5 ? a : b));
      pontos.push({ clipe: c.id, em_s: melhor.s });
      ini = melhor.s;
      ciclo++;
    }
  });
  return pontos;
}

/** Divide a trilha principal no ritmo (uma operação só). Devolve quantas divisões. */
export function ritmoEm(m: Montador, regras: Partial<RegrasDoRitmo> = {}): number {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return 0;
  const pontos = pontosDoRitmo(m.projeto, regras);
  if (!pontos.length) return 0;
  m.aplicar({ op: "dividir_varios", trilha: t.id, pontos, rotulo: `Dividir em ${pontos.length + t.clipes.length} planos no ritmo (2,4 a 3,8 s, sempre entre palavras)` });
  return pontos.length;
}

// ------------------------------------------------------------------ câmera

export interface MomentosDaCamera {
  /** Tempos (linha) de ênfase: palavra-chave, número, frase forte. */
  enfases: number[];
  /** Começos de seção (troca de assunto). */
  secoes: number[];
}

/** Ênfases e seções pela fala (regra fixa; notas do Jev entram por `extras`). */
export function momentosDaFala(fala: PalavraNaLinha[], extras: number[] = []): MomentosDaCamera {
  const frases = frasesDaFala(fala);
  const chaves = trechosChave(fala).filter((t) => t.peso >= 1.6);
  const enfases = chaves.map((t) => t.i).concat(frases.filter((f) => ehPergunta(f.texto)).map((f) => f.inicio_s)).concat(extras);
  const secoes: number[] = [];
  const TROCA = /^(agora|outro|outra|segundo|terceiro|por fim|finalmente|então|entao|mas|só que|primeiro|depois|além disso|alem disso|olha|na |no )/i;
  frases.forEach((f, k) => {
    if (k === 0) return;
    const vao = f.inicio_s - frases[k - 1].fim_s;
    if (vao >= 0.55 || TROCA.test(f.texto)) secoes.push(f.inicio_s);
  });
  return { enfases: enfases.sort((a, b) => a - b), secoes };
}

export interface PlanoDeCamera {
  zooms: Record<string, { de: number; para: number } | null>;
  movimentos: { clipe: string; movimento: Movimento; inicio_s: number }[];
}

const ehJumpCut = (a: ClipeDoProjeto, b: ClipeDoProjeto) => !!a.fonte && a.fonte === b.fonte;

export function planoDeCamera(p: ProjetoDeEdicao, momentos: MomentosDaCamera, opcoes: { teto?: number } = {}): PlanoDeCamera {
  const t = trilhaPrincipal(p);
  const saida: PlanoDeCamera = { zooms: {}, movimentos: [] };
  if (!t) return saida;
  const temRosto = Object.keys(p.rostos || {}).length > 0;
  const teto = Math.min(opcoes.teto || 1.25, temRosto ? 1.25 : escalaMaximaSegura(ORIGEM_SEGURA_DO_ZOOM.y));
  const clipes = emOrdem(t).filter((c) => !!c.fonte && duracaoDoClipe(c) > 0);
  const ciclo: Movimento[] = ["aberto", "medio", "empurrao", "aberto", "medio"];
  let k0 = 0;
  let fechados = 0;
  let anterior: Movimento | null = null;
  let clipeAnterior: ClipeDoProjeto | null = null;
  clipes.forEach((c, k) => {
    const ini = c.inicio_s;
    const fim = fimDoClipe(c);
    const temEnfase = momentos.enfases.some((s) => s >= ini - 0.05 && s < fim - 0.2);
    const abreSecao = momentos.secoes.some((s) => Math.abs(s - ini) <= 0.35);
    let quer: Movimento;
    if (k === 0) quer = "empurrao";
    else if (temEnfase) quer = fechados++ % 2 === 0 ? "fechado" : "fechado_andando";
    else if (abreSecao) quer = "recuo";
    else quer = ciclo[k0++ % ciclo.length];
    // Nunca dois iguais seguidos; no jump cut, a escala muda pelo menos 5% no corte.
    const opcoesEmOrdem: Movimento[] = [quer, "aberto", "fechado", "medio", "recuo", "empurrao", "fechado_andando"];
    const serve = (m: Movimento) => {
      if (m === anterior) return false;
      if (clipeAnterior && anterior && ehJumpCut(clipeAnterior, c) && Math.abs(inicioDe(m) - fimDe(anterior)) < 0.05) return false;
      return true;
    };
    const escolhido = opcoesEmOrdem.find(serve) || quer;
    const z = MOVIMENTOS[escolhido];
    const limitado = z ? { de: Math.min(teto, z.de), para: Math.min(teto, z.para) } : null;
    saida.zooms[c.id] = limitado;
    saida.movimentos.push({ clipe: c.id, movimento: escolhido, inicio_s: ini });
    anterior = escolhido;
    clipeAnterior = c;
  });
  return saida;
}

/** Aplica a câmera (uma operação só). Devolve os movimentos usados. */
export function cameraEm(m: Montador, momentos: MomentosDaCamera): PlanoDeCamera {
  const t = trilhaPrincipal(m.projeto);
  const plano = planoDeCamera(m.projeto, momentos);
  if (!t || !plano.movimentos.length) return plano;
  const muda = Object.keys(plano.zooms).some((id) => {
    const c = t.clipes.find((x) => x.id === id);
    return JSON.stringify(c ? c.zoom : null) !== JSON.stringify(plano.zooms[id]);
  });
  if (!muda) return plano;
  const tipos = plano.movimentos.map((x) => x.movimento).filter((x, i, l) => l.indexOf(x) === i);
  m.aplicar({ op: "camera", trilha: t.id, zooms: plano.zooms, rotulo: `Câmera com motivo em ${plano.movimentos.length} planos (${tipos.map((x) => ROTULO_DO_MOVIMENTO[x]).join(", ")})` });
  return plano;
}

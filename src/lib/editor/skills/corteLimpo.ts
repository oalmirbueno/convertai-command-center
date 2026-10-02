import { emOrdem, trilhaPrincipal } from "../operacoes";
import { arred } from "../tempo";
import { palavrasDaTranscricao } from "../transcricao";
import type { Montador } from "./tipos";

/**
 * Corte limpo (02/10, auditoria da Mesa Edição: "fica travando e repetindo").
 * A edição antiga cortava TODA pausa de 0,3 s, palavra por palavra: 112
 * cortes num vídeo de 48 s, clipe de 0,32 s, fala aos solavancos e quadro
 * preto entre clipes fora da grade. As regras daqui vêm do video-use (cortar
 * só em fronteira de palavra, respiro em volta, pausa de 0,4 s é a mais limpa)
 * e do Brabo (o ritmo vem do corte com motivo, não do picote):
 *
 * - só pausa de `pausa_min_s` (0,35 s) ou mais vira corte; pausa curta é
 *   respiração natural e fica;
 * - respiro em volta da fala: `respiro_depois_s` depois da última palavra e
 *   `respiro_antes_s` antes da próxima (a marcação do transcritor erra 50 a
 *   100 ms; o respiro absorve);
 * - nunca corta dentro de palavra: o corte só ENCOLHE para a grade de
 *   quadros (começo arredonda para cima, fim para baixo);
 * - corte que tira menos de `tirar_min_s` (0,15 s) não vale o pulo e fica;
 * - teto de `cortes_por_min` cortes por minuto: passou, saem os menores;
 * - nenhum clipe resultante abaixo de `clipe_min_s` (0,8 s): a palavra
 *   isolada ganha o respiro dos lados (os cortes vizinhos encolhem) e, se não
 *   der, o corte vizinho menor some;
 * - `proteger_ate_s`: "mantém o começo" (nada sai antes desse tempo da linha).
 *
 * Sai UMA operação (recortar_varios) que corta e encosta em quadros inteiros:
 * fim de um clipe = começo do outro, sem buraco.
 */

export interface RegrasDoCorte {
  pausa_min_s: number;
  respiro_antes_s: number;
  respiro_depois_s: number;
  tirar_min_s: number;
  clipe_min_s: number;
  cortes_por_min: number;
  proteger_ate_s: number;
}

export const CORTE_LIMPO: RegrasDoCorte = {
  pausa_min_s: 0.35,
  respiro_antes_s: 0.08,
  respiro_depois_s: 0.12,
  tirar_min_s: 0.15,
  clipe_min_s: 0.8,
  cortes_por_min: 14,
  proteger_ate_s: 0,
};

export interface CorteDaFonte {
  clipe: string;
  /** Tempo da fonte. */
  de_s: number;
  ate_s: number;
}

export interface PlanoDoCorte {
  cortes: CorteDaFonte[];
  tirado_s: number;
  /** Clipes sem transcrição (ficaram inteiros). */
  sem_fala: number;
  /** Pausas que eram candidatas e ficaram (teto, clipe curto, começo protegido). */
  mantidas: number;
}

interface Janela {
  de: number;
  ate: number;
}

/**
 * O plano do corte da trilha principal (puro: só lê o projeto). Tempos da
 * fonte, na grade de quadros da fonte (a mesma fps do projeto).
 */
export function planoDoCorteLimpo(m: Montador, regras: Partial<RegrasDoCorte> = {}): PlanoDoCorte {
  const r: RegrasDoCorte = { ...CORTE_LIMPO, ...regras };
  const p = m.projeto;
  const t = trilhaPrincipal(p);
  const vazio: PlanoDoCorte = { cortes: [], tirado_s: 0, sem_fala: 0, mantidas: 0 };
  if (!t) return vazio;
  const fps = p.fps > 0 ? p.fps : 25;
  const q = 1 / fps;
  const cima = (s: number) => arred(Math.ceil(s * fps - 1e-6) / fps);
  const baixo = (s: number) => arred(Math.floor(s * fps + 1e-6) / fps);
  let semFala = 0;
  let mantidas = 0;
  // Candidatas de todos os clipes (com o clipe e o tempo na linha, para o teto e o começo protegido).
  const porClipe: { id: string; entrada: number; saida: number; vel: number; inicio: number; janelas: Janela[] }[] = [];
  emOrdem(t).forEach((c) => {
    const tr = c.fonte ? p.transcricoes[c.fonte] : null;
    if (!tr || !tr.segmentos.length) {
      if (c.fonte) semFala++;
      return;
    }
    const palavras = palavrasDaTranscricao(tr)
      .filter((w) => (w.i + w.f) / 2 >= c.entrada_s && (w.i + w.f) / 2 < c.saida_s)
      .sort((a, b) => a.i - b.i);
    if (!palavras.length) return;
    const janelas: Janela[] = [];
    const candidata = (de: number, ate: number, vao: number) => {
      if (vao < r.pausa_min_s - 1e-6) return;
      const a = cima(Math.max(c.entrada_s, de));
      const b = baixo(Math.min(c.saida_s, ate));
      if (b - a < Math.max(q, r.tirar_min_s) - 1e-6) {
        mantidas++;
        return;
      }
      const naLinha = c.inicio_s + (a - c.entrada_s) / c.velocidade;
      if (naLinha < r.proteger_ate_s - 1e-6) {
        mantidas++;
        return;
      }
      janelas.push({ de: a, ate: b });
    };
    candidata(c.entrada_s, palavras[0].i - r.respiro_antes_s, palavras[0].i - c.entrada_s);
    for (let k = 1; k < palavras.length; k++) {
      // Fim da fala até aqui (palavras sobrepostas do transcritor contam pelo fim maior).
      const fimAteAqui = palavras.slice(0, k).reduce((x, w) => Math.max(x, w.f), 0);
      candidata(fimAteAqui + r.respiro_depois_s, palavras[k].i - r.respiro_antes_s, palavras[k].i - fimAteAqui);
    }
    const fimDaFala = palavras.reduce((x, w) => Math.max(x, w.f), 0);
    candidata(fimDaFala + r.respiro_depois_s, c.saida_s, c.saida_s - fimDaFala);
    porClipe.push({ id: c.id, entrada: c.entrada_s, saida: c.saida_s, vel: c.velocidade, inicio: c.inicio_s, janelas });
  });

  // Teto de cortes por minuto (na linha do tempo): passou, saem os menores primeiro.
  const total = t.clipes.reduce((s, c) => Math.max(s, c.inicio_s + (c.saida_s - c.entrada_s) / c.velocidade), 0);
  const teto = Math.max(1, Math.floor((r.cortes_por_min * total) / 60));
  const todas = porClipe.reduce((l, x) => l.concat(x.janelas.map((j) => ({ x, j }))), [] as { x: (typeof porClipe)[number]; j: Janela }[]);
  if (todas.length > teto) {
    todas
      .slice()
      .sort((a, b) => a.j.ate - a.j.de - (b.j.ate - b.j.de))
      .slice(0, todas.length - teto)
      .forEach(({ x, j }) => {
        x.janelas = x.janelas.filter((y) => y !== j);
        mantidas++;
      });
  }

  // Nenhum clipe resultante abaixo do mínimo: a fala isolada ganha respiro dos lados.
  porClipe.forEach((x) => {
    const minimo = r.clipe_min_s * x.vel;
    for (let volta = 0; volta < 200; volta++) {
      x.janelas.sort((a, b) => a.de - b.de);
      const guardados: { de: number; ate: number; esq: number; dir: number }[] = [];
      let cursor = x.entrada;
      x.janelas.forEach((j, k) => {
        guardados.push({ de: cursor, ate: j.de, esq: k - 1, dir: k });
        cursor = j.ate;
      });
      guardados.push({ de: cursor, ate: x.saida, esq: x.janelas.length - 1, dir: -1 });
      // Pedaço vazio (corte que começa no começo do clipe ou acaba no fim) não conta.
      const curto = guardados.find((g) => g.ate - g.de > 1e-6 && g.ate - g.de < minimo - 1e-6 && (g.esq >= 0 || g.dir >= 0));
      if (!curto) break;
      let falta = minimo - (curto.ate - curto.de);
      const esq = curto.esq >= 0 ? x.janelas[curto.esq] : null;
      const dir = curto.dir >= 0 ? x.janelas[curto.dir] : null;
      const ladoA = esq && dir ? falta / 2 : falta;
      const encolher = (j: Janela | null, quanto: number, lado: "fim" | "comeco") => {
        if (!j || quanto <= 0) return 0;
        const pode = Math.max(0, j.ate - j.de - r.tirar_min_s);
        const usa = Math.min(pode, quanto);
        const quadros = Math.ceil(usa * fps - 1e-6) / fps;
        if (lado === "fim") j.ate = arred(Math.max(j.de, j.ate - quadros));
        else j.de = arred(Math.min(j.ate, j.de + quadros));
        return quadros;
      };
      falta -= encolher(esq, ladoA, "fim");
      falta -= encolher(dir, falta, "comeco");
      if (falta > 1e-6) {
        // Não coube só com respiro: o corte vizinho menor some (a pausa fica inteira).
        const alvo = esq && dir ? (esq.ate - esq.de <= dir.ate - dir.de ? esq : dir) : esq || dir;
        x.janelas = x.janelas.filter((j) => j !== alvo);
        mantidas++;
      }
      x.janelas = x.janelas.filter((j) => j.ate - j.de >= Math.max(q, r.tirar_min_s) - 1e-6);
    }
  });

  const cortes: CorteDaFonte[] = [];
  let tirado = 0;
  porClipe.forEach((x) =>
    x.janelas
      .sort((a, b) => a.de - b.de)
      .forEach((j) => {
        cortes.push({ clipe: x.id, de_s: j.de, ate_s: j.ate });
        tirado += (j.ate - j.de) / x.vel;
      }),
  );
  return { cortes, tirado_s: Math.round(tirado * 100) / 100, sem_fala: semFala, mantidas };
}

/** Corta pelo plano numa operação só (corta e encosta em quadros inteiros). */
export function corteLimpoEm(m: Montador, regras: Partial<RegrasDoCorte> = {}): PlanoDoCorte {
  const plano = planoDoCorteLimpo(m, regras);
  const t = trilhaPrincipal(m.projeto);
  if (t && plano.cortes.length) {
    const seg = String(plano.tirado_s).replace(".", ",");
    m.aplicar({
      op: "recortar_varios",
      trilha: t.id,
      cortes: plano.cortes,
      rotulo: `Cortar ${plano.cortes.length} ${plano.cortes.length === 1 ? "pausa" : "pausas"} (${seg} s a menos), com respiro, e encostar o resto`,
    });
  }
  if (plano.sem_fala) m.avisar(`${plano.sem_fala} ${plano.sem_fala === 1 ? "clipe ficou" : "clipes ficaram"} de fora por não ter transcrição.`);
  return plano;
}

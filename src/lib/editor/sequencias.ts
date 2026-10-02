import { duracaoDoClipe, type ClipeDoProjeto } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Quadros de cada clipe na composição (02/10, auditoria: "quadro preto entre
 * clipes"). Puro, sem "@/": a composição do render usa o mesmo.
 *
 * - começo e FIM arredondados no quadro (antes era começo + duração
 *   arredondada à parte: 4,12 + 2,98 dava 74 quadros por causa do ponto
 *   flutuante e o quadro 177 ficava preto);
 * - trilha visual (vídeo): vão de até `segurar` quadros até o próximo clipe é
 *   coberto, o clipe anterior continua até o próximo começar (nunca preto
 *   por arredondamento ou corte fora da grade).
 */

export const QUADROS_QUE_SEGURA = 2;

export interface QuadrosDoClipe {
  de: number;
  d: number;
  /** Quadros a mais segurados para cobrir um vão (0 = nenhum). */
  segurou: number;
}

const q = (s: number, fps: number) => Math.round(s * fps);

export function quadrosDosClipes(clipes: ClipeDoProjeto[], fps: number, segurar = 0): Record<string, QuadrosDoClipe> {
  const ordem = clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
  const saida: Record<string, QuadrosDoClipe> = {};
  ordem.forEach((c, k) => {
    const de = q(c.inicio_s, fps);
    let fim = Math.max(de + 1, q(c.inicio_s + duracaoDoClipe(c), fps));
    let segurou = 0;
    const prox = ordem[k + 1];
    if (segurar > 0 && prox) {
      const deProx = q(prox.inicio_s, fps);
      const vao = deProx - fim;
      if (vao > 0 && vao <= segurar) {
        segurou = vao;
        fim = deProx;
      }
    }
    saida[c.id] = { de, d: fim - de, segurou };
  });
  return saida;
}

/** Vãos (em quadros) que ainda sobram na trilha depois de segurar (a conferência e os testes usam). */
export function vaosDaTrilha(clipes: ClipeDoProjeto[], fps: number, segurar = 0): { em_quadro: number; quadros: number }[] {
  const qs = quadrosDosClipes(clipes, fps, segurar);
  const ordem = clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s);
  const vaos: { em_quadro: number; quadros: number }[] = [];
  for (let k = 1; k < ordem.length; k++) {
    const a = qs[ordem[k - 1].id];
    const b = qs[ordem[k].id];
    const fim = a.de + a.d;
    if (b.de > fim) vaos.push({ em_quadro: fim, quadros: b.de - fim });
  }
  return vaos;
}

/**
 * Volume do clipe com micro fade (video-use, regra 3: sem estalo no corte):
 * meio volume no primeiro e no último quadro quando há corte encostado.
 */
export function volumeComFade(volume: number, duracaoQuadros: number, entra: boolean, sai: boolean): (f: number) => number {
  return (f: number) => {
    if (entra && f < 1) return volume * 0.5;
    if (sai && f >= duracaoQuadros - 1) return volume * 0.5;
    return volume;
  };
}

/** Origem do zoom sem rosto rastreado: um pouco acima do centro (a cabeça nunca sai por cima). */
export const ORIGEM_SEGURA_DO_ZOOM = { x: 0.5, y: 0.3 };

/**
 * Maior escala que não come mais que `margem` (fração da altura) de cima do
 * quadro, com a origem do zoom em `origemY`: a folga de ~12% acima da cabeça
 * do talking head perde no máximo 5% e a cabeça nunca sai por cima.
 * Topo cortado = origemY * (1 - 1/escala).
 */
export function escalaMaximaSegura(origemY: number, margem = 0.05): number {
  const y = Math.max(0.01, Math.min(0.99, origemY));
  if (margem >= y) return 4;
  return Math.round((1 / (1 - margem / y)) * 1000) / 1000;
}

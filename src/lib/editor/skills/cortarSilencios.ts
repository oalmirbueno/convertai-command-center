import { tempoFino } from "../tempo";
import { CORTE_LIMPO, corteLimpoEm } from "./corteLimpo";
import { Montador, parametrosComPadrao, type Skill, type ValorDoParametro } from "./tipos";

/**
 * Cortar silêncios (método do clone 03 Shopify e regras do video-use): pausa
 * de 0,35 s ou mais vira respiro de ~0,2 s (0,12 s depois da fala e 0,08 s
 * antes da próxima); pausa curta fica (cortar ali deixa a fala robótica).
 * Nenhuma palavra sai, nada é reordenado, nenhum clipe fica abaixo de 0,8 s.
 * Corta e encosta numa operação só, em quadros inteiros.
 * A fala vem da transcrição guardada no projeto (tempo da fonte).
 */

export function cortarSilenciosEm(m: Montador, params: Record<string, ValorDoParametro>): { cortes: number; tirado_s: number } {
  // 02/10: o corte limpo (corteLimpo.ts) no lugar do picote antigo: pausa mínima, respiro, clipe mínimo,
  // teto por minuto, nunca dentro de palavra, uma operação só e encostado em quadros inteiros.
  const n = (k: string, padrao: number) => (isFinite(Number(params[k])) && params[k] !== undefined && params[k] !== "" ? Number(params[k]) : padrao);
  const r = corteLimpoEm(m, {
    pausa_min_s: n("limiar_s", CORTE_LIMPO.pausa_min_s),
    respiro_depois_s: n("respiro_depois_s", CORTE_LIMPO.respiro_depois_s),
    respiro_antes_s: n("respiro_antes_s", CORTE_LIMPO.respiro_antes_s),
    clipe_min_s: n("clipe_min_s", CORTE_LIMPO.clipe_min_s),
    proteger_ate_s: n("proteger_ate_s", 0),
  });
  if (r.cortes.length) m.avisar("Textos, legendas e áudio separados não andam junto: refaça as legendas depois (a skill Legendas faz isso).");
  return { cortes: r.cortes.length, tirado_s: r.tirado_s };
}

export const SKILL_CORTAR_SILENCIOS: Skill = {
  id: "cortar_silencios",
  rotulo: "Cortar silêncios",
  descricao: "Tira as pausas longas e deixa um respiro curto, sem picotar: nenhuma palavra sai e nenhum clipe fica curto demais.",
  referencia: "video-use / clone-03-shopify (build_edl.py)",
  precisaDeFala: true,
  parametros: [
    { chave: "limiar_s", rotulo: "Pausa mínima (s)", tipo: "numero", padrao: CORTE_LIMPO.pausa_min_s, min: 0.15, max: 3, passo: 0.05 },
    { chave: "respiro_depois_s", rotulo: "Respiro depois da fala (s)", tipo: "numero", padrao: CORTE_LIMPO.respiro_depois_s, min: 0.03, max: 0.4, passo: 0.01 },
    { chave: "respiro_antes_s", rotulo: "Respiro antes da fala (s)", tipo: "numero", padrao: CORTE_LIMPO.respiro_antes_s, min: 0.03, max: 0.4, passo: 0.01 },
    { chave: "clipe_min_s", rotulo: "Clipe mínimo (s)", tipo: "numero", padrao: CORTE_LIMPO.clipe_min_s, min: 0.4, max: 3, passo: 0.1 },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_CORTAR_SILENCIOS, dados);
    const m = new Montador(p);
    const r = cortarSilenciosEm(m, params);
    if (r.cortes) m.aplicar({ op: "registrar_skill", skill: "cortar_silencios", resumo: `${r.cortes} cortes, ${tempoFino(r.tirado_s)} a menos`, em: ctx.agora });
    return m.proposta("cortar_silencios", "Cortar silêncios", r.cortes ? `${r.cortes} ${r.cortes === 1 ? "pausa sai" : "pausas saem"}: ${tempoFino(r.tirado_s)} a menos.` : "Nenhuma pausa longa para cortar.");
  },
};

import { emOrdem, trilhaPrincipal } from "../operacoes";
import { silenciosDoClipe } from "../transcricao";
import { tempoFino } from "../tempo";
import { Montador, parametrosComPadrao, type Skill, type ValorDoParametro } from "./tipos";

/**
 * Cortar silêncios (método do clone 03 Shopify, Videos/clone-03-shopify/edit/build_edl.py):
 * pausa de 0,3 s ou mais vira respiro de ~0,18 s (0,10 s depois da fala e
 * 0,08 s antes da próxima); pausa curta fica (cortar ali deixa a fala
 * robótica). Nenhuma palavra sai, nada é reordenado. Depois fecha os buracos.
 * A fala vem da transcrição guardada no projeto (tempo da fonte).
 */

export function cortarSilenciosEm(m: Montador, params: Record<string, ValorDoParametro>): { cortes: number; tirado_s: number } {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return { cortes: 0, tirado_s: 0 };
  const limiar = Number(params.limiar_s);
  const depois = Number(params.respiro_depois_s);
  const antes = Number(params.respiro_antes_s);
  let cortes = 0;
  let tirado = 0;
  let semFala = 0;
  // Do último clipe para o primeiro e, dentro do clipe, do último silêncio para o
  // primeiro: o id do pedaço de antes nunca muda, então as contas seguintes valem.
  emOrdem(t)
    .slice()
    .reverse()
    .forEach((c) => {
      const tr = c.fonte ? m.projeto.transcricoes[c.fonte] : null;
      if (!tr || !tr.segmentos.length) {
        semFala++;
        return;
      }
      const sil = silenciosDoClipe(c, tr.segmentos, { limiar_s: limiar, respiro_depois_s: depois, respiro_antes_s: antes });
      sil
        .slice()
        .reverse()
        .forEach((s) => {
          m.aplicar({ op: "recortar", clipe: c.id, de_s: s.de_s, ate_s: s.ate_s });
          cortes++;
          tirado += (s.ate_s - s.de_s) / c.velocidade;
        });
    });
  if (cortes) m.aplicar({ op: "ondular", trilha: t.id });
  if (semFala) m.avisar(`${semFala} ${semFala === 1 ? "clipe ficou" : "clipes ficaram"} de fora por não ter transcrição.`);
  if (cortes) m.avisar("Textos, legendas e áudio separados não andam junto: refaça as legendas depois (a skill Legendas faz isso).");
  return { cortes, tirado_s: Math.round(tirado * 100) / 100 };
}

export const SKILL_CORTAR_SILENCIOS: Skill = {
  id: "cortar_silencios",
  rotulo: "Cortar silêncios",
  descricao: "Tira as pausas longas e deixa um respiro curto. Nenhuma palavra sai.",
  referencia: "video-use / clone-03-shopify (build_edl.py)",
  precisaDeFala: true,
  parametros: [
    { chave: "limiar_s", rotulo: "Pausa mínima (s)", tipo: "numero", padrao: 0.3, min: 0.15, max: 3, passo: 0.05 },
    { chave: "respiro_depois_s", rotulo: "Respiro depois da fala (s)", tipo: "numero", padrao: 0.1, min: 0, max: 1, passo: 0.02 },
    { chave: "respiro_antes_s", rotulo: "Respiro antes da fala (s)", tipo: "numero", padrao: 0.08, min: 0, max: 1, passo: 0.02 },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_CORTAR_SILENCIOS, dados);
    const m = new Montador(p);
    const r = cortarSilenciosEm(m, params);
    if (r.cortes) m.aplicar({ op: "registrar_skill", skill: "cortar_silencios", resumo: `${r.cortes} cortes, ${tempoFino(r.tirado_s)} a menos`, em: ctx.agora });
    return m.proposta("cortar_silencios", "Cortar silêncios", r.cortes ? `${r.cortes} ${r.cortes === 1 ? "pausa sai" : "pausas saem"}: ${tempoFino(r.tirado_s)} a menos.` : "Nenhuma pausa longa para cortar.");
  },
};

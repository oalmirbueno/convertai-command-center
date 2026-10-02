import { duracaoDoClipe } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, trilhaPrincipal } from "../operacoes";
import { Montador, parametrosComPadrao, type Skill, type ValorDoParametro } from "./tipos";
import { falaNaLinhaDoTempo } from "../transcricao";
import { momentosDaFala, planoDeCamera } from "./camera";

/**
 * Punch-in nos ganchos (Brabo / clone 03: "o zoom alterna 1,00 e 1,08 a cada
 * batida"). Regras fixas, sem sorteio:
 * - o primeiro clipe (o gancho, até `gancho_s`) ganha um empurrão suave de 1,00
 *   até `zoom_gancho`;
 * - jump cut (clipe seguido de outro da MESMA fonte) alterna 1,00 e `zoom`,
 *   para esconder o pulo;
 * - troca de fonte (outro plano) volta para 1,00.
 * Com clipes selecionados, mexe só neles.
 */

export function punchInEm(m: Montador, params: Record<string, ValorDoParametro>, selecionados?: string[]): number {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return 0;
  const zoom = Number(params.zoom);
  const zoomGancho = Number(params.zoom_gancho);
  const gancho = Number(params.gancho_s);
  const so = selecionados && selecionados.length ? selecionados : null;
  let mudados = 0;
  let alterna = false;
  let fonteAnterior: string | null = null;
  emOrdem(t).forEach((c, k) => {
    let alvo: { de: number; para: number } | null;
    if (k === 0 && c.inicio_s < gancho) {
      alvo = { de: 1, para: zoomGancho };
      alterna = false;
    } else if (c.fonte && c.fonte === fonteAnterior) {
      alterna = !alterna;
      alvo = alterna ? { de: zoom, para: zoom } : null;
    } else {
      alterna = false;
      alvo = null;
    }
    fonteAnterior = c.fonte;
    if (so && so.indexOf(c.id) < 0) return;
    if (duracaoDoClipe(c) <= 0) return;
    const atual = c.zoom;
    const igual = (!atual && !alvo) || (!!atual && !!alvo && atual.de === alvo.de && atual.para === alvo.para);
    if (igual) return;
    m.aplicar({ op: "propriedades", clipe: c.id, campos: { zoom: alvo } });
    mudados++;
  });
  return mudados;
}

export const SKILL_PUNCH_IN: Skill = {
  id: "punch_in",
  rotulo: "Punch-in nos ganchos",
  descricao: "Empurrão no gancho e zoom alternado nos jump cuts, para esconder o pulo.",
  referencia: "Brabo (edição dinâmica) / hyperframes-keyframes",
  precisaDeFala: false,
  parametros: [
    { chave: "zoom", rotulo: "Zoom do jump cut", tipo: "numero", padrao: 1.08, min: 1, max: 1.5, passo: 0.01 },
    { chave: "zoom_gancho", rotulo: "Zoom do gancho", tipo: "numero", padrao: 1.12, min: 1, max: 1.5, passo: 0.01 },
    { chave: "gancho_s", rotulo: "Gancho até (s)", tipo: "numero", padrao: 3, min: 0, max: 10, passo: 0.5 },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_PUNCH_IN, dados);
    const m = new Montador(p);
    // 02/10 (auditoria: "zoom 1,08 um clipe sim, um não"): com a fala marcada, a câmera com motivo (ênfase,
    // gancho, troca de assunto, variada); sem fala, a regra antiga dos jump cuts.
    const fala = falaNaLinhaDoTempo(p);
    const t = trilhaPrincipal(p);
    let n = 0;
    if (fala.length && t) {
      const plano = planoDeCamera(p, momentosDaFala(fala));
      const so = ctx.selecionados && ctx.selecionados.length ? ctx.selecionados : null;
      const zooms: Record<string, { de: number; para: number } | null> = {};
      Object.keys(plano.zooms).forEach((id) => {
        const c = t.clipes.find((x) => x.id === id);
        if (!c || (so && so.indexOf(id) < 0) || JSON.stringify(c.zoom) === JSON.stringify(plano.zooms[id])) return;
        zooms[id] = plano.zooms[id];
      });
      n = Object.keys(zooms).length;
      if (n) m.aplicar({ op: "camera", trilha: t.id, zooms, rotulo: `Câmera com motivo em ${n} ${n === 1 ? "plano" : "planos"}` });
    } else n = punchInEm(m, params, ctx.selecionados);
    if (n) m.aplicar({ op: "registrar_skill", skill: "punch_in", resumo: `${n} clipes`, em: ctx.agora });
    return m.proposta("punch_in", "Punch-in nos ganchos", n ? `${n} ${n === 1 ? "clipe ganha" : "clipes ganham"} zoom.` : "Nada a mudar: o zoom já está assim.");
  },
};

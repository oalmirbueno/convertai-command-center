import { duracaoDoClipe } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, fimDoClipe, trilhaPrincipal } from "../operacoes";
import { noQuadro } from "../tempo";
import { falaNaLinhaDoTempo } from "../transcricao";
import { cortarSilenciosEm } from "./cortarSilencios";
import { legendasEm } from "./legendas";
import { Montador, parametrosComPadrao, type Skill, type ValorDoParametro } from "./tipos";

/**
 * Edição dinâmica (Brabo), versão determinística do que o clone 03 V2 fez à
 * mão (Videos/clone-03-shopify/DECUPAGEM-DINAMICO.md):
 * 1. corta os silêncios (opcional);
 * 2. divide em batidas de ~`batida_s` (2 s), com o corte caindo numa pausa
 *    entre palavras quando há uma perto (nunca no meio de uma palavra);
 * 3. alterna o zoom 1,00 / `zoom` a cada batida, corte seco (sem transição);
 * 4. legenda em blocos de 4 palavras (opcional).
 * A ilustração de cada batida (a parte criativa) fica para a equipe ou para
 * o diretor: esta skill só monta o ritmo, com tempos exatos.
 */

export function batidasEm(m: Montador, batida: number): number {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return 0;
  const fps = m.projeto.fps;
  const palavras = falaNaLinhaDoTempo(m.projeto);
  // Pontos bons para cortar: os vãos entre palavras (meio do vão).
  const vaos: number[] = [];
  for (let k = 1; k < palavras.length; k++) if (palavras[k].i >= palavras[k - 1].f) vaos.push((palavras[k - 1].f + palavras[k].i) / 2);
  const dentroDePalavra = (s: number) => palavras.some((w) => s > w.i + 0.01 && s < w.f - 0.01);
  let divisoes = 0;
  emOrdem(t)
    .slice()
    .reverse()
    .forEach((c) => {
      const dur = duracaoDoClipe(c);
      if (dur < batida * 1.6) return;
      const pontos: number[] = [];
      const fim = fimDoClipe(c);
      for (let alvo = c.inicio_s + batida; alvo < fim - batida * 0.6; alvo += batida) {
        const perto = vaos.filter((v) => Math.abs(v - alvo) <= batida * 0.3 && v > c.inicio_s + 0.5 && v < fim - 0.5);
        let ponto = perto.length ? perto.reduce((a, b) => (Math.abs(a - alvo) <= Math.abs(b - alvo) ? a : b)) : alvo;
        ponto = noQuadro(ponto, fps);
        if (!perto.length && dentroDePalavra(ponto)) continue;
        if (pontos.length && ponto - pontos[pontos.length - 1] < batida * 0.5) continue;
        pontos.push(ponto);
      }
      pontos
        .slice()
        .reverse()
        .forEach((ponto) => {
          m.aplicar({ op: "dividir", clipe: c.id, em_s: ponto });
          divisoes++;
        });
    });
  return divisoes;
}

export function zoomAlternadoEm(m: Montador, zoom: number): number {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return 0;
  let n = 0;
  emOrdem(t).forEach((c, k) => {
    const alvo = k % 2 === 1 ? { de: zoom, para: zoom } : null;
    const temTransicao = !!(c.transicao_entrada || c.transicao_saida);
    const mesmoZoom = (!alvo && !c.zoom) || (!!alvo && !!c.zoom && c.zoom.de === alvo.de && c.zoom.para === alvo.para);
    if (mesmoZoom && !temTransicao) return;
    m.aplicar({ op: "propriedades", clipe: c.id, campos: { zoom: alvo, transicao_entrada: null, transicao_saida: null } });
    n++;
  });
  return n;
}

export const SKILL_BRABO: Skill = {
  id: "brabo",
  rotulo: "Edição dinâmica (Brabo)",
  descricao: "Corta silêncios, divide em batidas de 2 s, alterna o zoom e legenda a fala.",
  referencia: "brabo-edicao-video-dinamica / clone-03-shopify V2",
  precisaDeFala: false,
  parametros: [
    { chave: "batida_s", rotulo: "Batida (s)", tipo: "numero", padrao: 2, min: 1, max: 6, passo: 0.5 },
    { chave: "zoom", rotulo: "Zoom alternado", tipo: "numero", padrao: 1.08, min: 1, max: 1.3, passo: 0.01 },
    { chave: "cortar", rotulo: "Cortar silêncios antes", tipo: "sim_nao", padrao: true },
    { chave: "legendar", rotulo: "Legendar", tipo: "sim_nao", padrao: true },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_BRABO, dados);
    const m = new Montador(p);
    const partes: string[] = [];
    if (params.cortar) {
      const r = cortarSilenciosEm(m, { limiar_s: 0.3, respiro_depois_s: 0.1, respiro_antes_s: 0.08 });
      if (r.cortes) partes.push(`${r.cortes} pausas cortadas`);
    }
    const b = batidasEm(m, Number(params.batida_s));
    const t = trilhaPrincipal(m.projeto);
    const total = t ? t.clipes.length : 0;
    if (b) partes.push(`${total} batidas`);
    const z = zoomAlternadoEm(m, Number(params.zoom));
    if (z) partes.push("zoom alternado");
    if (params.legendar) {
      const n = legendasEm(m, { palavras_por_bloco: 4, estilo: "destaque" });
      if (n) partes.push(`${n} legendas`);
    }
    if (!falaNaLinhaDoTempo(p).length) m.avisar("Sem transcrição, as batidas caem no tempo exato (podem pegar meio de palavra). Transcreva na Entrada para cortar nas pausas.");
    if (m.operacoes.length) m.aplicar({ op: "registrar_skill", skill: "brabo", resumo: partes.join(", "), em: ctx.agora });
    return m.proposta("brabo", "Edição dinâmica (Brabo)", partes.length ? `${partes.join(", ")}.` : "Nada a mudar.");
  },
};

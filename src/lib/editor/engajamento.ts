import { duracaoDoClipe, type ClipeDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, fimDoClipe, trilhaPrincipal } from "./operacoes";
import { tempoFino } from "./tempo";
import { NOME_DA_TRILHA_DE_BROLL } from "./skills/pecasDaEdicao";

/**
 * Checklist de engajamento (02/10, dono: "os vídeos SEMPRE têm que engajar;
 * nada de edição dura por causa da profissão do cliente"). O motor confere
 * antes de terminar e o relatório mostra:
 * - gancho: arte na tela no primeiro 1,5 s;
 * - nenhum trecho de mais de 4 s sem mudança visual (corte com câmera nova,
 *   movimento de câmera, peça de motion, B-roll, efeito);
 * - pelo menos 4 interrupções de padrão a cada 30 s (troca de câmera, peça,
 *   B-roll, efeito);
 * - chamada no fim (peça de chamada, cartão final ou texto de chamada).
 * Legenda não conta como mudança visual (ela muda sempre; o olho acostuma).
 */

export interface ChecklistDeEngajamento {
  ok: boolean;
  gancho: boolean;
  maior_parado_s: number;
  parado_em_s: number;
  interrupcoes: number;
  por_30s: number;
  cta: boolean;
  /** Linhas para o relatório ("ok" ou o que falta). */
  linhas: string[];
}

export const REGRAS_DE_ENGAJAMENTO = { gancho_s: 1.5, max_parado_s: 4, min_por_30s: 4 };

const est = (c: ClipeDoProjeto) => (c.estilo || {}) as Record<string, unknown>;
const escalaIni = (c: ClipeDoProjeto) => (c.zoom ? c.zoom.de : 1);
const escalaFim = (c: ClipeDoProjeto) => (c.zoom ? c.zoom.para : 1);

export function checklistDeEngajamento(p: ProjetoDeEdicao): ChecklistDeEngajamento {
  const t = trilhaPrincipal(p);
  const clipes = t ? emOrdem(t) : [];
  const total = clipes.length ? fimDoClipe(clipes[clipes.length - 1]) : p.duracao_s;
  const eventos: number[] = [];
  const andando: { de: number; ate: number }[] = [];
  let interrupcoes = 0;
  clipes.forEach((c, k) => {
    if (c.zoom && Math.abs(c.zoom.de - c.zoom.para) >= 0.03) andando.push({ de: c.inicio_s, ate: fimDoClipe(c) });
    if (!k) return;
    const a = clipes[k - 1];
    const outraFonte = a.fonte !== c.fonte;
    const camera = Math.abs(escalaIni(c) - escalaFim(a)) >= 0.03;
    const pulo = !outraFonte && Math.abs(c.entrada_s - a.saida_s) > 0.05;
    if (outraFonte || camera || pulo) eventos.push(c.inicio_s);
    if (outraFonte || camera) interrupcoes++;
  });
  let gancho = false;
  let cta = false;
  p.trilhas.forEach((tr) => {
    if (tr.oculta || tr.tipo === "legenda" || tr.tipo === "audio") return;
    if (tr.tipo === "video" && tr.nome.indexOf(NOME_DA_TRILHA_DE_BROLL) !== 0) return;
    tr.clipes.forEach((c) => {
      const ini = c.inicio_s;
      const fim = ini + duracaoDoClipe(c);
      const e = est(c);
      eventos.push(ini, fim);
      interrupcoes++;
      // Efeito de zoom/tremor na camada de ajuste é movimento contínuo.
      if (tr.tipo === "ajuste" && (e.efeito === "zoom" || e.efeito === "tremor")) andando.push({ de: ini, ate: fim });
      if ((tr.tipo === "sobreposicao" || tr.tipo === "texto") && ini <= REGRAS_DE_ENGAJAMENTO.gancho_s + 1e-6) gancho = true;
      const peca = typeof e.peca === "string" ? e.peca : "";
      if (peca === "chamada" || peca === "cartao_final" || peca === "comentario") cta = true;
      if (tr.tipo === "texto" && ini >= total * 0.6 && /\b(salv|coment|sig[ae]|segue|compartilh|link|direct|chama)/i.test(String(c.texto || ""))) cta = true;
    });
  });
  // Maior trecho sem mudança: entre eventos, descontando o que tem câmera andando.
  const marcas = eventos.filter((x) => x > 0 && x < total).concat([0, total]).sort((a, b) => a - b);
  let maior = 0;
  let em = 0;
  for (let k = 1; k < marcas.length; k++) {
    let de = marcas[k - 1];
    const ate = marcas[k];
    // Parte com câmera andando não é parada.
    andando
      .filter((x) => x.de < ate && x.ate > de)
      .sort((a, b) => a.de - b.de)
      .forEach((x) => {
        if (x.de - de > maior) {
          maior = x.de - de;
          em = de;
        }
        de = Math.max(de, x.ate);
      });
    if (ate - de > maior) {
      maior = ate - de;
      em = de;
    }
  }
  const por30 = total > 0 ? Math.round(((interrupcoes * 30) / total) * 10) / 10 : 0;
  const r = REGRAS_DE_ENGAJAMENTO;
  const parado = Math.round(maior * 100) / 100;
  const linhas = [
    gancho ? "gancho: arte na tela no primeiro segundo e meio" : "gancho: falta arte na tela no primeiro segundo e meio",
    parado <= r.max_parado_s + 1e-6 ? `ritmo: no máximo ${String(parado).replace(".", ",")} s sem mudança visual` : `ritmo: ${String(parado).replace(".", ",")} s parado a partir de ${tempoFino(em)} (o máximo é ${r.max_parado_s} s)`,
    por30 >= r.min_por_30s ? `${String(por30).replace(".", ",")} interrupções de padrão a cada 30 s` : `só ${String(por30).replace(".", ",")} interrupções de padrão a cada 30 s (mínimo ${r.min_por_30s})`,
    cta ? "chamada no fim" : "falta a chamada no fim",
  ];
  return { ok: gancho && parado <= r.max_parado_s + 1e-6 && por30 >= r.min_por_30s && cta, gancho, maior_parado_s: parado, parado_em_s: Math.round(em * 100) / 100, interrupcoes, por_30s: por30, cta, linhas };
}

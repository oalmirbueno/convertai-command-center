import { duracaoDoClipe, type ClipeDoProjeto, type CorDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Camada de ajuste do editor (frente EDT, rodada 2): cada clipe da trilha
 * "ajuste" é um efeito que vale no trecho dele, sobre o vídeo de baixo
 * (legenda e texto ficam fora). Puro (sem "@/"): prévia e render usam a mesma
 * conta, quadro a quadro, sem relógio e sem sorteio.
 *
 * estilo = { efeito, params }:
 * - zoom { escala 1 a 2, modo punch | empurrao | recuo, entrada_s }: punch-in
 *   (entra rápido e segura), empurrão (anda devagar até a escala) ou recuo;
 * - tremor { forca 0 a 1 }: câmera na mão, determinístico;
 * - flash { cor, forca 0 a 1 }: clarão no começo que some;
 * - desfoque { forca 0 a 1 }: desfoca e volta (transição, "segredo");
 * - cor { look, intensidade, exposicao... }: a cor do trecho troca a do projeto.
 */

export const EFEITOS_DE_AJUSTE = ["zoom", "tremor", "flash", "desfoque", "cor"] as const;
export type EfeitoDeAjuste = (typeof EFEITOS_DE_AJUSTE)[number];

export const ROTULO_DO_EFEITO: Record<EfeitoDeAjuste, string> = {
  zoom: "Zoom",
  tremor: "Tremor",
  flash: "Flash",
  desfoque: "Desfoque",
  cor: "Cor do trecho",
};

export const MODOS_DE_ZOOM = [
  { valor: "punch", rotulo: "Punch-in (entra rápido e segura)" },
  { valor: "empurrao", rotulo: "Empurrão (aproxima devagar)" },
  { valor: "recuo", rotulo: "Recuo (afasta devagar)" },
] as const;
export type ModoDeZoom = (typeof MODOS_DE_ZOOM)[number]["valor"];

const limitar = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, padrao: number) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !isFinite(n) ? padrao : n;
};

export function efeitoDoClipe(c: ClipeDoProjeto): { efeito: EfeitoDeAjuste; params: Record<string, unknown> } | null {
  const e = c.estilo && typeof c.estilo === "object" ? (c.estilo as Record<string, unknown>) : null;
  if (!e) return null;
  const efeito = String(e.efeito || "") as EfeitoDeAjuste;
  if ((EFEITOS_DE_AJUSTE as readonly string[]).indexOf(efeito) < 0) return null;
  return { efeito, params: e.params && typeof e.params === "object" ? (e.params as Record<string, unknown>) : {} };
}

/** Rótulo curto do clipe de ajuste (linha do tempo e apelidos). */
export function rotuloDoAjuste(c: ClipeDoProjeto): string | null {
  const e = efeitoDoClipe(c);
  if (!e) return null;
  if (e.efeito === "zoom") return `Zoom ${String(num(e.params.escala, 1.15).toFixed(2)).replace(".", ",")}x`;
  if (e.efeito === "cor") return `Cor: ${String(e.params.look || "ajuste")}`;
  return ROTULO_DO_EFEITO[e.efeito];
}

/** Suave de entrada (ease-out cúbico). */
const saida3 = (x: number) => 1 - Math.pow(1 - limitar(x, 0, 1), 3);
const suave = (x: number) => {
  const t = limitar(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export interface CameraNoQuadro {
  escala: number;
  /** Deslocamento em fração do quadro (tremor). */
  dx: number;
  dy: number;
  /** Desfoque em fração da largura (a composição converte para px). */
  desfoque: number;
  flash: { cor: string; opacidade: number } | null;
  /** Clipe de cor ativo (troca a cor do projeto neste trecho). */
  cor: { id: string; cor: CorDoProjeto } | null;
}

/** Tudo o que a camada de ajuste faz no tempo t (s da linha do tempo). Trilha oculta não conta. */
export function cameraNoTempo(p: ProjetoDeEdicao, t: number, corBase: CorDoProjeto): CameraNoQuadro {
  const saida: CameraNoQuadro = { escala: 1, dx: 0, dy: 0, desfoque: 0, flash: null, cor: null };
  for (const tr of p.trilhas) {
    if (tr.tipo !== "ajuste" || tr.oculta) continue;
    for (const c of tr.clipes) {
      const d = duracaoDoClipe(c);
      if (t < c.inicio_s || t >= c.inicio_s + d || d <= 0) continue;
      const e = efeitoDoClipe(c);
      if (!e) continue;
      const local = t - c.inicio_s;
      const x = e.params;
      if (e.efeito === "zoom") {
        const alvo = limitar(num(x.escala, 1.15), 1, 2);
        const modo = String(x.modo || "punch");
        if (modo === "empurrao") saida.escala *= 1 + (alvo - 1) * suave(local / d);
        else if (modo === "recuo") saida.escala *= alvo - (alvo - 1) * suave(local / d);
        else {
          const ent = limitar(num(x.entrada_s, 0.12), 0, 1);
          saida.escala *= 1 + (alvo - 1) * (ent > 0 ? saida3(local / ent) : 1);
        }
      } else if (e.efeito === "tremor") {
        const f = limitar(num(x.forca, 0.4), 0, 1) * 0.012;
        saida.dx += f * (Math.sin(local * 23.7) + 0.5 * Math.sin(local * 41.3 + 1.1));
        saida.dy += f * (Math.cos(local * 19.1) + 0.5 * Math.sin(local * 37.9 + 2.3));
        saida.escala *= 1 + f * 2.5;
      } else if (e.efeito === "flash") {
        const f = limitar(num(x.forca, 0.85), 0, 1);
        const cor = /^#[0-9a-fA-F]{6}$/.test(String(x.cor || "")) ? String(x.cor) : "#ffffff";
        const op = f * (1 - saida3(local / Math.max(0.05, Math.min(d, 0.45))));
        if (op > 0.001) saida.flash = { cor, opacidade: Math.max(saida.flash ? saida.flash.opacidade : 0, op) };
      } else if (e.efeito === "desfoque") {
        const f = limitar(num(x.forca, 0.5), 0, 1);
        // Sobe até o meio do clipe e volta.
        const meio = 1 - Math.abs(local / d - 0.5) * 2;
        saida.desfoque = Math.max(saida.desfoque, f * 0.02 * suave(meio));
      } else if (e.efeito === "cor") {
        saida.cor = { id: c.id, cor: { ...corBase, ...(x as Partial<CorDoProjeto>), lut: x.lut === null ? null : corBase.lut } as CorDoProjeto };
      }
    }
  }
  return saida;
}

/** Clipe de zoom pronto para inserir (os momentos fortes e o agente usam). */
export function clipeDeZoom(inicio_s: number, duracao_s: number, escala: number, modo: ModoDeZoom, ref: string): Partial<ClipeDoProjeto> & { inicio_s: number; entrada_s: number; saida_s: number } {
  return {
    inicio_s,
    entrada_s: 0,
    saida_s: Math.round(duracao_s * 1000) / 1000,
    estilo: { efeito: "zoom", params: { escala: Math.round(limitar(escala, 1, 2) * 100) / 100, modo, entrada_s: modo === "punch" ? 0.12 : 0 } },
    origem: { tipo: "skill", ref },
  };
}

/**
 * Troca de ângulo de câmera (frente V-A, 26/09/2026): "estou de frente, quero
 * de lado", a mesma pessoa e o mesmo cenário vistos de outro ponto.
 *
 * Contrato combinado com a V-B (docs/video/CONTRATOS.md, ação angulo_gerar):
 *   angulo: { azimute: -180..180, elevacao: -30..60, distancia: perto|medio|longe }
 *   azimute 0 = de frente; 90 = perfil (câmera à direita da pessoa);
 *   -90 = perfil do outro lado; 180 = costas. elevacao > 0 = câmera de cima.
 *
 * O motor é um editor de imagem com controle de câmera (Qwen Image Edit com
 * a LoRA de múltiplos ângulos, catálogo em modelos-de-video.ts). Aqui ficam a
 * normalização, os ângulos prontos da tela (órbita simples) e a tradução
 * para os parâmetros e o texto que o motor entende.
 *
 * Puro: sem Deno, sem banco. Tela, função e testes usam o mesmo.
 */

export type DistanciaDoAngulo = "perto" | "medio" | "longe";
export type ManterNoAngulo = "personagem" | "cenario" | "ambos";

export interface AnguloDeCamera {
  azimute: number;
  elevacao: number;
  distancia: DistanciaDoAngulo;
}

export const AZIMUTE_MIN = -180;
export const AZIMUTE_MAX = 180;
export const ELEVACAO_MIN = -30;
export const ELEVACAO_MAX = 60;
export const VARIACOES_MAX = 4;

export const DISTANCIAS: { valor: DistanciaDoAngulo; rotulo: string }[] = [
  { valor: "perto", rotulo: "Perto" },
  { valor: "medio", rotulo: "Médio" },
  { valor: "longe", rotulo: "Longe" },
];

/** Ângulos prontos do controle de órbita (a tela também deixa arrastar). */
export const ANGULOS_PRONTOS: { valor: string; rotulo: string; azimute: number; elevacao: number }[] = [
  { valor: "frente", rotulo: "Frente", azimute: 0, elevacao: 0 },
  { valor: "tres_quartos_dir", rotulo: "3/4 direita", azimute: 45, elevacao: 0 },
  { valor: "perfil_dir", rotulo: "Perfil direito", azimute: 90, elevacao: 0 },
  { valor: "costas", rotulo: "Costas", azimute: 180, elevacao: 0 },
  { valor: "perfil_esq", rotulo: "Perfil esquerdo", azimute: -90, elevacao: 0 },
  { valor: "tres_quartos_esq", rotulo: "3/4 esquerda", azimute: -45, elevacao: 0 },
  { valor: "de_cima", rotulo: "De cima", azimute: 0, elevacao: 45 },
  { valor: "de_baixo", rotulo: "De baixo", azimute: 0, elevacao: -25 },
];

const limitar = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Azimute em -180..180 (370 vira 10; -190 vira 170). */
export function azimuteNormal(v: number): number {
  let a = ((Math.round(v) % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a === -180 ? 180 : a;
}

/** Lê o ângulo pedido. Lança Error com a frase para a tela quando não dá. */
export function normalizarAngulo(bruto: unknown): AnguloDeCamera {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : null;
  if (!o) throw new Error("Escolha o ângulo.");
  const az = Number(o.azimute);
  const el = Number(o.elevacao);
  if (!isFinite(az) || !isFinite(el)) throw new Error("Ângulo inválido: azimute e elevação são números.");
  if (az < AZIMUTE_MIN || az > AZIMUTE_MAX) throw new Error("Azimute vai de -180 a 180 graus.");
  if (el < ELEVACAO_MIN || el > ELEVACAO_MAX) throw new Error("Elevação vai de -30 a 60 graus.");
  const d = String(o.distancia || "medio");
  if (d !== "perto" && d !== "medio" && d !== "longe") throw new Error("Distância é perto, médio ou longe.");
  return { azimute: azimuteNormal(az), elevacao: Math.round(el), distancia: d };
}

export const normalizarVariacoes = (v: unknown): number => {
  const n = Math.round(Number(v));
  return isFinite(n) && n >= 1 ? Math.min(VARIACOES_MAX, n) : 1;
};

export const normalizarManter = (v: unknown): ManterNoAngulo => (v === "personagem" || v === "cenario" ? v : "ambos");

/** Nome curto do ângulo para a tela ("3/4 direita, de cima, perto"). */
export function textoDoAngulo(a: AnguloDeCamera): string {
  const az = a.azimute;
  const abs = Math.abs(az);
  const lado = az > 0 ? "direita" : "esquerda";
  const horizontal = abs <= 15 ? "frente" : abs < 68 ? `3/4 ${lado}` : abs <= 112 ? `perfil ${az > 0 ? "direito" : "esquerdo"}` : abs < 165 ? `3/4 de costas, ${lado}` : "costas";
  const vertical = a.elevacao >= 20 ? "de cima" : a.elevacao <= -12 ? "de baixo" : "";
  const dist = a.distancia === "perto" ? "perto" : a.distancia === "longe" ? "longe" : "";
  return [horizontal, vertical, dist].filter(Boolean).join(", ");
}

/**
 * Parâmetros do motor de ângulo (fal: Qwen Image Edit 2511 com múltiplos
 * ângulos): horizontal_angle 0..360 (0 = frente, sentido horário),
 * vertical_angle -30..90 e zoom 0..10 (0 = longe, 10 = bem perto).
 * Conferir a página do modelo antes de ligar (docs/video/PESQUISA-GERADOR.md).
 */
export function parametrosDoAngulo(a: AnguloDeCamera): { horizontal_angle: number; vertical_angle: number; zoom: number } {
  const h = ((a.azimute % 360) + 360) % 360;
  return {
    horizontal_angle: h,
    vertical_angle: limitar(a.elevacao, ELEVACAO_MIN, ELEVACAO_MAX),
    zoom: a.distancia === "perto" ? 8 : a.distancia === "longe" ? 2 : 5,
  };
}

/** Frase em inglês que acompanha o pedido (motores seguem melhor o inglês). */
export function promptDoAngulo(a: AnguloDeCamera, manter: ManterNoAngulo, extra?: string | null): string {
  const abs = Math.abs(a.azimute);
  const lado = a.azimute > 0 ? "right" : "left";
  const h = abs <= 15 ? "front view" : abs < 68 ? `three-quarter view from the ${lado}` : abs <= 112 ? `side profile view from the ${lado}` : abs < 165 ? `three-quarter back view from the ${lado}` : "back view";
  const v = a.elevacao >= 20 ? `, high angle looking down ${a.elevacao} degrees` : a.elevacao <= -12 ? `, low angle looking up ${Math.abs(a.elevacao)} degrees` : ", eye level";
  const d = a.distancia === "perto" ? ", close-up" : a.distancia === "longe" ? ", wide shot" : ", medium shot";
  const m =
    manter === "personagem"
      ? "Keep the same person: identical face, hair, skin, body and clothes."
      : manter === "cenario"
        ? "Keep the same place: identical architecture, furniture, materials and light."
        : "Keep the same person and the same place: identical face, hair, clothes, furniture, materials and light.";
  const x = String(extra || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `Rotate the camera to a ${h}${v}${d}. ${m} Photorealistic, same lens and lighting.${x ? ` ${x}` : ""}`;
}

/**
 * Controle de órbita visto de cima: a pessoa no centro olhando para baixo da
 * tela. Câmera embaixo = frente (0), à direita = 90, em cima = costas (180).
 */
export function azimuteDoPonto(dx: number, dy: number): number {
  if (!dx && !dy) return 0;
  return azimuteNormal((Math.atan2(dx, dy) * 180) / Math.PI);
}

/** Posição da câmera no controle (raio 1) para o azimute. */
export function pontoDoAzimute(azimute: number): { x: number; y: number } {
  const r = (azimute * Math.PI) / 180;
  return { x: Math.round(Math.sin(r) * 1000) / 1000, y: Math.round(Math.cos(r) * 1000) / 1000 };
}

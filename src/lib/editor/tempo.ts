/**
 * Tempo no editor de vídeo (frente V-B). Tudo que o editor grava cai num
 * quadro exato do projeto (fps) e fica com no máximo 3 casas: é o que deixa a
 * montagem determinística (o mesmo pedido dá sempre o mesmo corte).
 */

export const arred = (n: number) => Math.round(n * 1000) / 1000;

/** Segundos no quadro mais próximo. */
export function noQuadro(s: number, fps: number): number {
  const f = fps > 0 ? fps : 25;
  return arred(Math.round(s * f) / f);
}

export const paraQuadro = (s: number, fps: number) => Math.round(s * (fps > 0 ? fps : 25));
export const deQuadro = (q: number, fps: number) => arred(q / (fps > 0 ? fps : 25));
export const umQuadro = (fps: number) => 1 / (fps > 0 ? fps : 25);

/** "0:04" (sem fração). */
export function tempoCurto(s: number): string {
  const t = Math.max(0, Math.floor(s + 1e-6));
  const m = Math.floor(t / 60);
  const r = t % 60;
  return `${m}:${r < 10 ? `0${r}` : r}`;
}

/** "0:04,20" (centésimos, vírgula). */
export function tempoFino(s: number): string {
  const v = Math.max(0, s);
  const m = Math.floor(v / 60);
  const resto = v - m * 60;
  const inteiro = Math.floor(resto + 1e-6);
  const cent = Math.min(99, Math.round((resto - inteiro) * 100));
  return `${m}:${inteiro < 10 ? `0${inteiro}` : inteiro},${cent < 10 ? `0${cent}` : cent}`;
}

/** "0:04 q05" (segundo e quadro dentro do segundo). */
export function tempoComQuadro(s: number, fps: number): string {
  const f = fps > 0 ? fps : 25;
  const q = paraQuadro(s, f);
  const seg = Math.floor(q / f);
  const dentro = q - seg * f;
  return `${tempoCurto(seg)} q${dentro < 10 ? `0${dentro}` : dentro}`;
}

/** "1:05", "65" ou "65,5" viram segundos; vazio ou inválido é null. */
export function segundosDoTexto(t: string): number | null {
  const s = String(t || "").trim().replace(",", ".");
  if (!s) return null;
  const m = /^(\d{1,3}):([0-5]?\d(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : null;
}

/** Preferências de leitura locais: não alteram as ligações ou o projeto salvo. */
export type IntensidadeDasLigacoes = "suave" | "discreta" | "normal";
export type FocoDasLigacoes = "todas" | "selecionado" | "ocultas";
export interface LeituraDoQuadro {
  intensidade: IntensidadeDasLigacoes;
  foco: FocoDasLigacoes;
}
export const LEITURA_PADRAO: LeituraDoQuadro = { intensidade: "discreta", foco: "todas" };
export const OPACIDADE_DAS_LIGACOES = { suave: 0.1, discreta: 0.24, normal: 0.55 } as const;

export function lerLeituraDoQuadro(valor: string | null): LeituraDoQuadro {
  try {
    const v: unknown = JSON.parse(valor || "null");
    if (!v || typeof v !== "object") return { ...LEITURA_PADRAO };
    const r = v as Record<string, unknown>;
    return {
      intensidade: r.intensidade === "suave" || r.intensidade === "normal" ? r.intensidade : "discreta",
      foco: r.foco === "selecionado" || r.foco === "ocultas" ? r.foco : "todas",
    };
  } catch {
    return { ...LEITURA_PADRAO };
  }
}

export function mostrarLigacao(foco: FocoDasLigacoes, selecionado: string | null, de: string, para: string): boolean {
  if (foco === "ocultas") return false;
  return foco !== "selecionado" || (!!selecionado && (de === selecionado || para === selecionado));
}

export interface ObstaculoDoQuadro { x: number; y: number; largura: number; altura: number }
interface Ponto { x: number; y: number }
const MARGEM = 18;

function cruza(a: Ponto, b: Ponto, r: ObstaculoDoQuadro): boolean {
  if (a.y === b.y) return a.y > r.y - MARGEM && a.y < r.y + r.altura + MARGEM && Math.max(a.x, b.x) > r.x - MARGEM && Math.min(a.x, b.x) < r.x + r.largura + MARGEM;
  return a.x > r.x - MARGEM && a.x < r.x + r.largura + MARGEM && Math.max(a.y, b.y) > r.y - MARGEM && Math.min(a.y, b.y) < r.y + r.altura + MARGEM;
}

/** Busca uma faixa livre acima/abaixo dos cartões, sem modificar suas posições. */
export function rotaSemCartoes(origem: Ponto, destino: Ponto, obstaculos: ObstaculoDoQuadro[]): Ponto[] | null {
  const inicio = { x: origem.x + 30, y: origem.y };
  const fim = { x: destino.x - 30, y: destino.y };
  const relevantes = obstaculos.filter((r) => r.x + r.largura + MARGEM >= Math.min(inicio.x, fim.x) && r.x - MARGEM <= Math.max(inicio.x, fim.x));
  const faixas = new Set([origem.y, destino.y, (origem.y + destino.y) / 2]);
  relevantes.forEach((r) => { faixas.add(r.y - MARGEM - 8); faixas.add(r.y + r.altura + MARGEM + 8); });
  let melhor: Ponto[] | null = null;
  let menor = Infinity;
  for (const y of faixas) {
    const pontos = [inicio, { x: inicio.x, y }, { x: fim.x, y }, fim];
    if (pontos.some((p, i) => i > 0 && obstaculos.some((r) => cruza(pontos[i - 1], p, r)))) continue;
    const distancia = Math.abs(inicio.y - y) + Math.abs(inicio.x - fim.x) + Math.abs(fim.y - y);
    if (distancia < menor) { menor = distancia; melhor = [origem, ...pontos, destino]; }
  }
  return melhor;
}

/** Cantos arredondados mantêm a leitura do fluxo sem curvas longas sobre outros nós. */
export function caminhoArredondado(pontos: Ponto[]): string {
  const unicos = pontos.filter((p, i) => i === 0 || p.x !== pontos[i - 1].x || p.y !== pontos[i - 1].y);
  const ps = unicos.filter((p, i) => i === 0 || i === unicos.length - 1 || !((unicos[i - 1].x === p.x && p.x === unicos[i + 1].x) || (unicos[i - 1].y === p.y && p.y === unicos[i + 1].y)));
  if (!ps.length) return "";
  let d = `M ${ps[0].x} ${ps[0].y}`;
  for (let i = 1; i < ps.length - 1; i += 1) {
    const a = ps[i - 1], p = ps[i], b = ps[i + 1];
    const da = Math.hypot(p.x - a.x, p.y - a.y), db = Math.hypot(b.x - p.x, b.y - p.y);
    const raio = Math.min(14, da / 2, db / 2);
    const entrada = { x: p.x + (a.x - p.x) * raio / da, y: p.y + (a.y - p.y) * raio / da };
    const saida = { x: p.x + (b.x - p.x) * raio / db, y: p.y + (b.y - p.y) * raio / db };
    d += ` L ${entrada.x} ${entrada.y} Q ${p.x} ${p.y} ${saida.x} ${saida.y}`;
  }
  const ultimo = ps[ps.length - 1];
  return `${d} L ${ultimo.x} ${ultimo.y}`;
}

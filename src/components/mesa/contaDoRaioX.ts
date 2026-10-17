/**
 * Raio-x do mês (17/10/2026, dono: "o que falta no Mês"): antes de aprovar,
 * bater o olho em quantas pautas pegam carona no hype, no que está em alta no
 * nicho ou num movimento de concorrente, e no equilíbrio de formatos e
 * pilares. Lê só o texto que o agente do Mês grava na tarefa ("Pilar: ...",
 * "Gancho do momento: ..."); nada de IA, nada de rede.
 *
 * Arquivo puro (sem lookbehind nem grupo nomeado: Safari 11). Sem travessão.
 */

export type ItemParaORaioX = { title: string; description: string | null; delivery_type: string };

export type RaioXDoMes = {
  total: number;
  formatos: Array<{ rotulo: string; n: number }>;
  pilares: Array<{ rotulo: string; n: number }>;
  ganchos: { hype: number; nicho: number; concorrente: number; nenhum: number };
  /** Um pilar com mais da metade das pautas (com 4 ou mais pautas). */
  pilarDominante: { rotulo: string; pct: number } | null;
  /** Um formato com 75% ou mais das pautas (com 4 ou mais pautas). */
  formatoDominante: { rotulo: string; pct: number } | null;
};

const ROTULO_DO_FORMATO: Record<string, string> = {
  carousel: "Carrossel",
  static: "Estático",
  design: "Arte",
  video: "Vídeo",
  reels: "Vídeo",
  reel: "Vídeo",
  photo: "Foto",
  foto: "Foto",
};

function linha(descricao: string | null, rotulo: string): string | null {
  const texto = String(descricao || "");
  const i = texto.indexOf(`${rotulo}:`);
  if (i < 0) return null;
  const resto = texto.slice(i + rotulo.length + 1).split("\n")[0].trim();
  return resto || null;
}

const contar = (lista: string[]) => {
  const m = new Map<string, number>();
  for (const x of lista) m.set(x, (m.get(x) || 0) + 1);
  return Array.from(m.entries()).map(([rotulo, n]) => ({ rotulo, n })).sort((a, b) => b.n - a.n);
};

export function tipoDoGancho(texto: string | null): "hype" | "nicho" | "concorrente" | null {
  const t = String(texto || "").toLowerCase();
  if (!t) return null;
  if (t.indexOf("concorrente") === 0 || t.indexOf("@") >= 0) return "concorrente";
  if (t.indexOf("nicho") === 0) return "nicho";
  return "hype";
}

export function raioXDoMes(itens: ItemParaORaioX[]): RaioXDoMes {
  const ganchos = { hype: 0, nicho: 0, concorrente: 0, nenhum: 0 };
  const pilares: string[] = [];
  for (const i of itens) {
    const g = tipoDoGancho(linha(i.description, "Gancho do momento"));
    ganchos[g || "nenhum"]++;
    const p = linha(i.description, "Pilar");
    if (p) pilares.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  }
  const pilaresContados = contar(pilares);
  const formatos = contar(itens.map((i) => ROTULO_DO_FORMATO[i.delivery_type] || i.delivery_type || "Outro"));
  const topo = pilaresContados[0];
  return {
    total: itens.length,
    formatos,
    pilares: pilaresContados,
    ganchos,
    formatoDominante: formatos[0] && itens.length >= 4 && formatos[0].n / itens.length >= 0.75 ? { rotulo: formatos[0].rotulo, pct: Math.round((formatos[0].n / itens.length) * 100) } : null,
    pilarDominante: topo && itens.length >= 4 && topo.n / itens.length > 0.5 ? { rotulo: topo.rotulo, pct: Math.round((topo.n / itens.length) * 100) } : null,
  };
}

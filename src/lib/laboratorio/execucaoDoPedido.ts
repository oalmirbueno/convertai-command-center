import { TIPOS_DE_NO, type CanvasDoLab } from "./nos";

/** Recalcula apenas a frente afetada, inclusive por mudança de fonte ou ligação. */
export function alvosDoPedido(antes: CanvasDoLab, depois: CanvasDoLab): string[] {
  const originais = new Map(antes.nos.map((n) => [n.id, n]));
  const afetados = new Set<string>();
  for (const n of depois.nos) {
    const anterior = originais.get(n.id);
    if (!anterior || anterior.tipo !== n.tipo || JSON.stringify(anterior.dados) !== JSON.stringify(n.dados)) afetados.add(n.id);
  }
  for (const n of antes.nos) if (!depois.nos.some((novo) => novo.id === n.id)) afetados.add(n.id);
  const fiosAntes = new Map(antes.ligacoes.map((l) => [l.id, l]));
  const fiosDepois = new Map(depois.ligacoes.map((l) => [l.id, l]));
  for (const fio of [...antes.ligacoes, ...depois.ligacoes]) {
    if (JSON.stringify(fiosAntes.get(fio.id)) !== JSON.stringify(fiosDepois.get(fio.id))) afetados.add(fio.para);
  }
  const fila = [...afetados];
  const ligacoes = [...antes.ligacoes, ...depois.ligacoes];
  for (let i = 0; i < fila.length; i++) {
    for (const l of ligacoes) if (l.de === fila[i] && !afetados.has(l.para)) { afetados.add(l.para); fila.push(l.para); }
  }
  return depois.nos.filter((n) => afetados.has(n.id) && TIPOS_DE_NO[n.tipo].roda && n.tipo !== "por_no_ar" && n.tipo !== "agente_externo").map((n) => n.id);
}

/** Layouts antigos foram salvos com 320 x 220; os cartões atuais precisam de mais espaço. */
export function temCartoesSobrepostos(canvas: CanvasDoLab): boolean {
  return canvas.nos.some((n, i) => canvas.nos.slice(i + 1).some((m) => Math.abs(n.x - m.x) < 448 && Math.abs(n.y - m.y) < 950));
}

/** Retrieval by an explicitly named folder. No invented IDs, fuzzy match or write. */
export interface PastaNomeada { id: string; name: string; parent_id: string | null }
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function resolverPastasCitadas(mensagem: string, pastas: PastaNomeada[]): { ids: string[]; estado: "encontrada" | "ambigua" | "nao_citada" } {
  const texto = ` ${normalizar(mensagem)} `;
  const porId = new Map(pastas.map((p) => [p.id, p]));
  const caminho = (p: PastaNomeada) => {
    const nomes = [p.name]; const vistas = new Set([p.id]); let pai = p.parent_id;
    while (pai && porId.has(pai) && !vistas.has(pai)) { vistas.add(pai); const n = porId.get(pai)!; nomes.unshift(n.name); pai = n.parent_id; }
    return nomes.join("/");
  };
  const citado = (nome: string) => {
    const n = normalizar(nome);
    if (n.length < 3) return false;
    const i = texto.indexOf(n);
    return i >= 0 && !/[a-z0-9]/.test(texto[i - 1] || "") && !/[a-z0-9]/.test(texto[i + n.length] || "");
  };
  const completos = pastas.filter((p) => caminho(p).includes("/") && citado(caminho(p)));
  const folhas = completos.filter((p) => !completos.some((outra) => outra.id !== p.id && caminho(outra).startsWith(`${caminho(p)}/`)));
  const candidatas = folhas.length ? folhas : pastas.filter((p) => citado(p.name));
  // Ambiguous names require the full path; never silently choose a sibling.
  if (candidatas.length !== 1) return { ids: [], estado: candidatas.length ? "ambigua" : "nao_citada" };
  const ids = new Set([candidatas[0].id]);
  for (let n = 0; n < pastas.length; n++) {
    const antes = ids.size;
    for (const p of pastas) if (p.parent_id && ids.has(p.parent_id)) ids.add(p.id);
    if (ids.size === antes) break;
  }
  return { ids: [...ids], estado: "encontrada" };
}

export function pastasCitadas(mensagem: string, pastas: PastaNomeada[]): string[] {
  return resolverPastasCitadas(mensagem, pastas).ids;
}

/** Only references the server actually offered can update the visible selection. */
export function fotosSelecionadas(bruto: unknown, imagens: { ref: string; id: string; dados: { ativa?: boolean; tags?: string[]; origem?: string } }[]): string[] {
  if (!Array.isArray(bruto)) return [];
  const porRef = new Map(imagens.map((i) => [i.ref, i]));
  return [...new Set(bruto.flatMap((ref) => {
    const i = typeof ref === "string" ? porRef.get(ref) : null;
    return i && i.dados.ativa !== false && !i.dados.tags?.includes("referencia_web") && i.dados.origem !== "web" && i.dados.origem !== "referencia_web" ? [i.id] : [];
  }))].slice(0, 40);
}

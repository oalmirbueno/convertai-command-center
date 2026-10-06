import type { FotoDoAcervo } from "./fotoApi";
import type { FotoNaGaleria } from "./GaleriaDeFotos";
import type { Canvas } from "./canvasApi";

const ROTULOS: Record<string, string> = { preservar: "Original preservado", luz_cor: "Luz e cor", cenario: "Cenário", angulo: "Ângulo", ensaio: "Ensaio", canvas: "Composição", detalhe: "Detalhes", clone: "Clone" };

export function fotoNaGaleria(f: FotoDoAcervo, grupo = f.derivada_de ? "Versões" : "Originais"): FotoNaGaleria {
  return { id: f.id, caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome,
    grupo, aprovada: f.aprovada, origemId: f.derivada_de,
    legenda: (f.modo && ROTULOS[f.modo]) || grupo, detalhe: [f.pasta, f.descricao, ...(f.tags || [])].filter(Boolean).join(" · "),
    proporcao: f.largura && f.altura ? f.largura / f.altura : undefined };
}

/** Inclui derivados por vínculo real, sem misturar composições que usam o mesmo modelo. */
export function fotosComDescendentes(fotos: FotoDoAcervo[], origens: string[]): FotoDoAcervo[] {
  const ids = new Set(origens);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const f of fotos) if (f.ativa && f.derivada_de && ids.has(f.derivada_de) && !ids.has(f.id)) { ids.add(f.id); mudou = true; }
  }
  return fotos.filter((f) => f.ativa && ids.has(f.id));
}

/** Histórico confirmado no servidor, compatível com as composições já salvas. */
export function historicoDaComposicao(fotos: FotoDoAcervo[], canvases: Canvas[], clientId: string, kitIds: string[], pessoa: { tipo: string; id: string } | null, cloneFotoId?: string): FotoDoAcervo[] {
  const ids = new Set(canvases.filter((c) => {
    if (c.client_id !== clientId || !c.nome.startsWith("Composição · ")) return false;
    if (!c.nos.some((n) => n.tipo === "produto" && kitIds.includes(n.dados.kit_id || ""))) return false;
    const modelos = c.nos.filter((n) => n.tipo === "modelo");
    if (!pessoa) return modelos.length === 0;
    if (pessoa.tipo === "persona") return modelos.some((n) => n.dados.modelo_id === pessoa.id);
    return !!cloneFotoId && modelos.some((n) => n.dados.imagem_id === cloneFotoId);
  }).map((c) => `canvas:${c.id}`));
  const doCliente = fotos.filter((f) => f.client_id === clientId);
  return fotosComDescendentes(doCliente, doCliente.filter((f) => f.tags?.some((t) => ids.has(t))).map((f) => f.id));
}

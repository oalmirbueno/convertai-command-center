import { chamarFuncao } from "@/lib/mesa/api";

export interface ProdutoDaCasa { id: string; titulo: string; estado: string }
export interface ContextoDaCasa { texto: string; json: Record<string, unknown> }
export const catalogoDaCasa = async (projetoId: string, noId: string) => {
  const r = await chamarFuncao<{ produtos: ProdutoDaCasa[] }>("laboratorio", { acao: "conexoes_da_casa", projeto_id: projetoId, no_id: noId, catalogo: true });
  return r.produtos;
};
export const puxarContextoDaCasa = async (projetoId: string, noId: string) => {
  const r = await chamarFuncao<{ contexto: ContextoDaCasa | null }>("laboratorio", { acao: "conexoes_da_casa", projeto_id: projetoId, no_id: noId });
  return r.contexto;
};

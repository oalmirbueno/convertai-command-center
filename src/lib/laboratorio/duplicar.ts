import { criarProjeto, lerProjeto, type ProjetoDoLab } from "./api";
import { TIPOS_DE_NO, type CanvasDoLab } from "./nos";

/**
 * "Duplicar para outro cliente" (19/10/2026, ideia do ClickMax: aplicar o
 * pacote de um projeto a outro cliente). O projeto novo nasce com o mesmo
 * canvas (nós, ligações e ajustes), sem as saídas/execuções (ficam no projeto
 * de origem, presas a ele) e sem as mídias (campos de imagem dos nós, que são
 * do cliente de origem). O contexto do projeto também não vai: é do cliente.
 */

/** Cópia do canvas sem as mídias: tira dos nós os campos do tipo "imagens" (Mídia, referências do Gravity...). */
export function canvasParaDuplicar(canvas: CanvasDoLab): CanvasDoLab {
  return {
    nos: canvas.nos.map((n) => {
      const def = TIPOS_DE_NO[n.tipo];
      const midias = def ? def.campos.filter((c) => c.tipo === "imagens").map((c) => c.chave) : [];
      const dados: Record<string, unknown> = {};
      Object.keys(n.dados || {}).forEach((k) => {
        if (midias.indexOf(k) < 0) dados[k] = JSON.parse(JSON.stringify(n.dados[k] === undefined ? null : n.dados[k]));
      });
      return { id: n.id, tipo: n.tipo, x: n.x, y: n.y, dados };
    }),
    ligacoes: canvas.ligacoes.map((l) => ({ id: l.id, de: l.de, para: l.para })),
    viewport: { x: canvas.viewport.x, y: canvas.viewport.y, zoom: canvas.viewport.zoom },
  };
}

/** Nome do projeto novo: "<nome> · <cliente>" (até 120 letras, o limite da função). */
export function nomeDaCopia(nome: string, cliente: string): string {
  return `${(nome || "Projeto").trim()} · ${cliente}`.slice(0, 120);
}

/** projeto_ler (o canvas salvo) + projeto_criar com o canvas limpo e o cliente novo (null = Livre). */
export async function duplicarProjeto(projetoId: string, clientId: string | null, nomeDoClienteNovo: string): Promise<ProjetoDoLab> {
  const { projeto } = await lerProjeto(projetoId);
  return criarProjeto({ nome: nomeDaCopia(projeto.nome, nomeDoClienteNovo), client_id: clientId, canvas: canvasParaDuplicar(projeto.canvas) });
}

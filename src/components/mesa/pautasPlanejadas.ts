import { normalizarVideoDaPauta } from "../../../supabase/functions/_shared/video-da-pauta";
import { FORMATOS_DE_VIDEO_NO_ESTUDIO } from "./modoDaPauta";
import type { DadosDosItens, ItemDoMes } from "./useItensDoMes";

export interface PropostaNaEsteira { id: string; project_id: string | null; status: string; itens: unknown }
/** Usa o formato estruturado da Agenda. Não adivinha pelo título nem substitui peças. */
export function incluirPautasPlanejadas(dados: DadosDosItens, propostas: PropostaNaEsteira[], projetos: string[], inicio: string, fim: string) {
  const projetosEmUso = Array.from(new Set(dados.itens.map((i) => i.project_id).filter((id) => projetos.includes(id))));
  const padrao = projetosEmUso.length === 1 ? projetosEmUso[0] : projetos.length === 1 ? projetos[0] : null;
  for (const proposta of propostas) {
    const projeto = proposta.project_id || padrao;
    if (!["pronta", "gravada"].includes(proposta.status) || !projeto || !projetos.includes(projeto)) continue;
    for (const bruto of Array.isArray(proposta.itens) ? proposta.itens : []) {
      if (!bruto || typeof bruto !== "object") continue;
      const p = bruto as Record<string, unknown>;
      if (p.task_id || typeof p.tema_id !== "string" || !p.tema_id || typeof p.data !== "string" || p.data < inicio || p.data >= fim) continue;
      const fotos = p.formato === "foto" || p.mesa === "foto";
      if (!fotos && !FORMATOS_DE_VIDEO_NO_ESTUDIO.includes(String(p.formato))) continue;
      const id = `plano:${proposta.id}:${p.tema_id}`;
      if (dados.itens.some((i) => i.id === id)) continue;
      const item: ItemDoMes = { id, project_id: projeto, title: String(p.tema || p.titulo || "Pauta do mês"), due_date: p.data, delivery_type: fotos ? "static" : String(p.formato), status: "todo", modo_estudio: fotos ? "fotos" : "video", planejamento: { proposta_id: proposta.id, tema_id: p.tema_id }, ...(!fotos ? { video: normalizarVideoDaPauta(p.video) } : {}) };
      dados.itens.push(item);
      dados.roteiros[id] = { laminas: 0, continuo: false, modo_estudio: item.modo_estudio, ...(fotos ? { direcao_foto: p.foto && typeof p.foto === "object" ? p.foto as Record<string, unknown> : {} } : { video: item.video }) };
    }
  }
  dados.itens.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
  return dados;
}

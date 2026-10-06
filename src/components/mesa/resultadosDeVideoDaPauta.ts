import type { ArquivoDeVideo, PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import type { VersaoDeVideo } from "../../../supabase/functions/mesa-videos/modulos/memoria-de-video";
/** Os três vínculos persistidos são aceitos; sempre dentro do mesmo cliente. */
export function resultadosDeVideoDaPauta(clientId: string, taskId: string, arquivos: ArquivoDeVideo[], pedidos: PedidoDeVideo[], versoes: VersaoDeVideo[], locais: string[] = []) {
  const daPauta = pedidos.filter((p) => p.client_id === clientId && (p.parametros?.task_id === taskId || p.alvo?.task_id === taskId || locais.includes(p.id)));
  const pedidoIds = new Set(daPauta.map((p) => p.id).concat(locais));
  const fontes = new Set(daPauta.flatMap((p) => (p.resultado?.envios || []).map((e) => e.arquivo_id).filter((id): id is string => !!id)));
  const ativos = arquivos.filter((a) => a.client_id === clientId && a.estado !== "arquivado" && !["audio", "angulo", "quadro"].includes(a.tipo) && !a.mime?.startsWith("audio/"));
  for (const a of ativos) if ((a.pedido_id && pedidoIds.has(a.pedido_id)) || (typeof a.origem?.pedido === "string" && pedidoIds.has(a.origem.pedido))) fontes.add(a.id);
  // Versões com trilha/legenda podem partir de outra versão; fecha a cadeia sem ciclos.
  let mudou = true;
  while (mudou) {
    mudou = false;
    const ligadas = new Set(versoes.filter((v) => v.client_id === clientId && v.projeto && Object.values(v.projeto.fontes).some((f) => !!f.arquivo_id && fontes.has(f.arquivo_id))).map((v) => v.id));
    for (const a of ativos) if (!fontes.has(a.id) && typeof a.origem?.versao_id === "string" && ligadas.has(a.origem.versao_id)) { fontes.add(a.id); mudou = true; }
  }
  return ativos.filter((a) => fontes.has(a.id)).sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

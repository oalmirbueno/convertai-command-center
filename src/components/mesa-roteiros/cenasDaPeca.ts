import { parteDaConferenciaDoJev, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { editarItemDaProposta, type ItemProposto } from "@/components/mesa/mesaV4Api";
import { normalizarRoteiroDeVideo, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { TAMANHO_DAS_CENAS } from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";
import { gerarCenasDaPeca, type EscolhaDaPeca } from "./roteirosApi";

/**
 * As cenas do caminho Gerar da peça de vídeo com a pegada viral (frente B, 23/10/2026). A mesa-roteiros
 * escreve duas versões com os ganchos vencedores do nicho e o Jev escolhe (peca_cenas_gerar, não grava);
 * aqui a escolhida vai para a peça pelo editar_item da série, o mesmo caminho do "Salvar o roteiro" (que
 * também refaz a direção do vídeo). Quem liga: o "Gerar o roteiro" do CampanhaVideos e do Gerar.
 */

/** O preço antes, pelo catálogo: as duas versões com o modelo do roteiro e a escolha do Jev. */
export function partesDasCenasDaPeca(catalogo: ModeloIa[], modeloId?: string | null): ParteDaEstimativa[] {
  const m = (modeloId && catalogo.find((x) => x.id === modeloId)) || catalogo.find((x) => Array.isArray(x.padrao_para) && x.padrao_para.indexOf("estrategista") >= 0) || null;
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHO_DAS_CENAS.entrada, tokensSaida: TAMANHO_DAS_CENAS.saida }, parteDaConferenciaDoJev()];
}

export interface CenasGeradas {
  roteiro: RoteiroDeVideo;
  escolha: EscolhaDaPeca | null;
  custo_usd: number;
  /** A peça salva (editar_item); null quando a geração saiu e o salvar falhou. */
  item: ItemProposto | null;
  proposta: unknown;
  /** O motivo do salvar que falhou (as cenas voltam para a tela salvar de novo, sem gerar outra vez). */
  erro_ao_salvar: string | null;
}

export async function gerarEGuardarCenasDaPeca(p: { clientId: string; campanhaId: string; propostaId: string; temaId: string; modeloId?: string | null }): Promise<CenasGeradas> {
  const r = await gerarCenasDaPeca({ client_id: p.clientId, campanha_id: p.campanhaId, tema_id: p.temaId, modelo_id: p.modeloId || null });
  const roteiro = normalizarRoteiroDeVideo(r && r.roteiro_video);
  if (!roteiro) throw new Error("As cenas não voltaram do motor. Tente de novo.");
  const custo = Number(r && r.custo_usd) || 0;
  try {
    const salvo = await editarItemDaProposta(p.propostaId, p.temaId, { roteiro_video: roteiro, ...(roteiro.cta ? { cta: roteiro.cta } : {}) });
    return { roteiro, escolha: (r && r.escolha) || null, custo_usd: custo, item: (salvo && salvo.item) || null, proposta: salvo ? salvo.proposta : null, erro_ao_salvar: null };
  } catch (e) {
    return { roteiro, escolha: (r && r.escolha) || null, custo_usd: custo, item: null, proposta: null, erro_ao_salvar: e instanceof Error ? e.message : "O roteiro não foi salvo na peça." };
  }
}

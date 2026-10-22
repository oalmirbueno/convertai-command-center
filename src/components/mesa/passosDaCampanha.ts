import type { QueryClient } from "@tanstack/react-query";
import { chamarFuncao, padraoPara, saidaPorRaciocinio, TAMANHOS, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { chaves, type Campanha, type ItemProposto } from "./mesaV4Api";
import {
  aplicarRespostaDaCampanha,
  chavesDaCampanha,
  gerarStoryDaCampanha,
  normalizarBriefing,
  partesDaReorganizacao,
  partesDoMercado,
  pesquisarMercadoDaCampanha,
  reorganizarCampanha,
} from "./campanhasApi";
import { partesDaEstimativaDosStories } from "./stories/storiesApi";
import type { FaseDaCampanha } from "./regrasDaCampanha";
import { ROTULO_DO_PASSO, type PassoDoAgente } from "../../../supabase/functions/agente-calendario/modulos/mudanca-da-campanha";
import { faseDaEtapa } from "../../../supabase/functions/agente-calendario/modulos/linha-do-tempo";

/**
 * Os passos que o agente da campanha põe no plano (22/10/2026, dono: "o agente ser mais agêntico"): cada um é
 * uma ação que a casa já tem. O custo de cada passo aparece antes; a tela faz um por vez depois do Confirmar,
 * mostrando o que está fazendo agora. Os de navegação só abrem a parte certa da campanha (sem gastar).
 */

export interface PassoDoPlano {
  acao: PassoDoAgente;
  /** A fase (stories) ou o tema_id da peça (roteiro, Estúdio). */
  alvo: string;
}

export const ROTULO_DO_PASSO_NA_TELA = ROTULO_DO_PASSO;

/** O texto do "fazendo agora". */
export const FAZENDO_AGORA: Record<PassoDoAgente, string> = {
  reorganizar_datas: "Recalculando as datas e as fases",
  criar_stories_da_fase: "Criando a sequência de stories",
  gerar_roteiro_de_video: "Escrevendo o roteiro do vídeo",
  gerar_o_que_falta: "Abrindo o que falta gerar",
  abrir_peca_no_estudio: "Abrindo a peça",
  vincular_anuncio: "Abrindo o vínculo com o anúncio",
  escolher_trilha: "Abrindo a trilha",
  pesquisar_mercado: "Pesquisando o que o mercado está fazendo",
};

export const lerPasso = (para: unknown): PassoDoPlano | null => {
  try {
    const o = JSON.parse(String(para || "")) as Record<string, unknown>;
    if (!o || typeof o.acao !== "string" || !(o.acao in ROTULO_DO_PASSO)) return null;
    return { acao: o.acao as PassoDoAgente, alvo: typeof o.alvo === "string" ? o.alvo : "" };
  } catch {
    return null;
  }
};

/** A fase da campanha que a aba Stories entende (sustentação conta como lançamento). */
export function faseDosStories(alvo: string): FaseDaCampanha {
  const f = faseDaEtapa(alvo);
  if (f === "aquecimento" || f === "urgencia" || f === "encerramento") return f;
  return "lancamento";
}

/** O roteiro do vídeo: uma chamada curta de texto. */
export const partesDoRoteiroDeVideo = (catalogo: ModeloIa[]): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS.conversarMes.entrada, tokensSaida: saidaPorRaciocinio("low") }];
};

export const TELAS_DA_SEQUENCIA = 4;

/** O custo de cada passo (os de navegação não gastam). */
export function partesDoPasso(p: PassoDoPlano, catalogo: ModeloIa[]): ParteDaEstimativa[] {
  if (p.acao === "reorganizar_datas") return partesDaReorganizacao(catalogo);
  if (p.acao === "criar_stories_da_fase") return partesDaEstimativaDosStories(catalogo, TELAS_DA_SEQUENCIA, { comPlano: true, comImagens: true, natural: true });
  if (p.acao === "gerar_roteiro_de_video") return partesDoRoteiroDeVideo(catalogo);
  if (p.acao === "pesquisar_mercado") return partesDoMercado(catalogo);
  return [];
}

/** campanha_roteiro_video { campanha_id, tema_id }: o roteiro da peça de vídeo (gravado na série). */
export const gerarRoteiroDeVideo = (campanhaId: string, temaId: string) =>
  chamarFuncao<{ proposta: unknown; item: ItemProposto; custo_usd: number }>("agente-calendario", { acao: "campanha_roteiro_video", campanha_id: campanhaId, tema_id: temaId });

/** Pede à campanha aberta para mostrar uma parte (o detalhe da campanha escuta). */
export function abrirParteDaCampanha(campanhaId: string, aba: string) {
  try {
    window.dispatchEvent(new CustomEvent("mesa:campanha:aba", { detail: { campanhaId, aba } }));
  } catch {
    /* sem janela (teste no servidor): nada a abrir */
  }
}

export interface ContextoDoPasso {
  campanha: Campanha;
  clientId: string;
  qc: QueryClient;
  marcaId?: string | null;
}

/** Faz um passo e devolve o custo (os de navegação só abrem a parte certa). */
export async function executarPasso(p: PassoDoPlano, ctx: ContextoDoPasso): Promise<{ custo_usd: number; aviso?: string }> {
  const { campanha, clientId, qc } = ctx;
  if (p.acao === "reorganizar_datas") {
    const r = await reorganizarCampanha(campanha.id);
    await qc.invalidateQueries({ queryKey: chavesDaCampanha.conversa(clientId, campanha.id) });
    return { custo_usd: Number(r && r.custo_usd) || 0, aviso: "A reorganização chegou como outro cartão para confirmar." };
  }
  if (p.acao === "criar_stories_da_fase") {
    const fase = faseDosStories(p.alvo);
    const b = normalizarBriefing(campanha.briefing);
    const planejado = (b.stories || []).filter((s) => faseDosStories(s.etapa) === fase)[0];
    const linha = b.linha_do_tempo || null;
    const daFase = linha ? linha.fases.filter((f) => faseDosStories(f.etapa) === fase)[0] : null;
    await gerarStoryDaCampanha(campanha, {
      clientId,
      campanhaId: campanha.id,
      temaId: planejado ? planejado.tema_id : `fase-${fase}`,
      briefing: b,
      identidade: campanha.identidade,
      fase,
      quantidadeDeTelas: planejado && planejado.telas.length ? planejado.telas.length : TELAS_DA_SEQUENCIA,
      data: planejado ? planejado.data : daFase ? daFase.inicio : null,
      pedido: planejado ? [planejado.tema, planejado.gancho].concat(planejado.telas).filter(Boolean).join(" / ") : null,
      marcaId: ctx.marcaId || null,
    });
    await qc.invalidateQueries({ queryKey: ["mesa", "campanha-stories", clientId, campanha.id] });
    await qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    return { custo_usd: 0 };
  }
  if (p.acao === "gerar_roteiro_de_video") {
    const r = await gerarRoteiroDeVideo(campanha.id, p.alvo);
    aplicarRespostaDaCampanha(qc, clientId, r);
    if (r && r.proposta && (r.proposta as { id?: string }).id) qc.setQueryData(chaves.proposta((r.proposta as { id: string }).id), r.proposta);
    abrirParteDaCampanha(campanha.id, "videos");
    return { custo_usd: Number(r && r.custo_usd) || 0 };
  }
  if (p.acao === "pesquisar_mercado") {
    const r = await pesquisarMercadoDaCampanha(campanha.id);
    aplicarRespostaDaCampanha(qc, clientId, r);
    abrirParteDaCampanha(campanha.id, "briefing");
    return { custo_usd: Number(r && r.custo_usd) || 0 };
  }
  // Navegação: a parte certa da campanha, sem gastar (gerar o que falta mostra o custo total lá).
  const aba = p.acao === "gerar_o_que_falta" || p.acao === "vincular_anuncio" ? "visao" : p.acao === "escolher_trilha" ? "trilha" : "pecas";
  abrirParteDaCampanha(campanha.id, aba);
  return { custo_usd: 0 };
}

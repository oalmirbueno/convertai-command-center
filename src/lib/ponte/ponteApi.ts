import { chamarFuncao } from "@/lib/mesa/api";

/**
 * Ponte Laboratório ↔ Campanhas (25/10/2026). Contrato: docs/laboratorio/PONTE-CAMPANHAS.md.
 * As duas telas (o canvas do Laboratório e a campanha da Mesa) usam estas chamadas da função ponte-lab-campanha.
 * O banco avisa a ponte sozinho a cada mudança (gatilhos); estas chamadas são para ler o estado, sincronizar na
 * hora, abrir o canvas da campanha, ligar e desligar, montar a campanha pelo canvas e decidir as sugestões.
 * Nunca substitui: campo vazio é preenchido, peça nova entra, e o que difere vira sugestão para a equipe.
 */

/** A marca de sincronia que a ponte grava em dados.sinc de cada nó que ela liga à campanha. */
export interface SincDoNo {
  campanha_id: string;
  /** 'cliente', 'marca', 'produto:<n>', 'oferta', 'publico', 'funil', 'peca:<tema_id>', 'anuncio', 'stories:<fase>'. */
  chave: string;
  /** Quem criou o nó: a campanha (projetado) ou o canvas (a pessoa pôs e a ponte levou para a campanha). */
  origem: "campanha" | "canvas";
  /** Assinatura dos campos projetados na última passada (a pessoa editou = difere). */
  hash: string;
}

export type DestinoDaSugestao = "campanha" | "canvas";

export interface SugestaoDaPonte {
  id: string;
  campanha_id: string;
  projeto_id: string | null;
  /** Para onde iria: 'campanha' (o canvas sugere) ou 'canvas' (a campanha sugere). */
  destino: DestinoDaSugestao;
  chave: string;
  rotulo: string;
  valor_atual: unknown;
  valor_sugerido: unknown;
  situacao: "aberta" | "aceita" | "recusada" | "superada";
  created_at: string;
}

export interface ResumoDaSincronia {
  nos_novos: number;
  nos_atualizados: number;
  pecas_novas: number;
  campos_preenchidos: number;
  sugestoes: number;
}

/** mesa_campanhas.sincronia */
export interface SincroniaDaCampanha {
  projeto_id?: string | null;
  ultima_em?: string | null;
  lado?: "campanha" | "canvas" | "ambos" | null;
  resumo?: Partial<ResumoDaSincronia>;
  avisos?: string[];
}

export interface EstadoDaPonte {
  ligada: boolean;
  campanha: { id: string; nome: string; client_id: string } | null;
  projeto: { id: string; nome: string; versao: number } | null;
  sincronia: SincroniaDaCampanha;
  sugestoes: SugestaoDaPonte[];
}

export interface ResultadoDaSincronia {
  estado: EstadoDaPonte;
  resumo: ResumoDaSincronia;
  avisos: string[];
}

/** Estado da ponte pela campanha (tela da campanha) ou pelo projeto (canvas). */
export const lerEstadoDaPonte = (alvo: { campanhaId?: string; projetoId?: string }) =>
  chamarFuncao<EstadoDaPonte>("ponte-lab-campanha", {
    acao: "estado",
    ...(alvo.campanhaId ? { campanha_id: alvo.campanhaId } : {}),
    ...(alvo.projetoId ? { projeto_id: alvo.projetoId } : {}),
  });

/** Roda os dois sentidos agora (sem IA, sem custo). */
export const sincronizarAgora = (campanhaId: string) =>
  chamarFuncao<ResultadoDaSincronia>("ponte-lab-campanha", { acao: "sincronizar", campanha_id: campanhaId });

/** Garante o canvas da campanha no Laboratório e devolve o projeto (para abrir /laboratorio?projeto=<id>). */
export const abrirCampanhaNoLab = (campanhaId: string) =>
  chamarFuncao<{ projeto_id: string; criado: boolean }>("ponte-lab-campanha", { acao: "abrir_no_lab", campanha_id: campanhaId });

/** Liga um projeto do Laboratório a uma campanha já existente (do mesmo cliente). */
export const ligarProjetoACampanha = (projetoId: string, campanhaId: string) =>
  chamarFuncao<ResultadoDaSincronia>("ponte-lab-campanha", { acao: "ligar", projeto_id: projetoId, campanha_id: campanhaId });

/** Solta a ligação (nada é apagado nos dois lados). */
export const desligarProjeto = (projetoId: string) =>
  chamarFuncao<{ ok: true }>("ponte-lab-campanha", { acao: "desligar", projeto_id: projetoId });

/**
 * Monta a campanha a partir do canvas (o projeto precisa ter cliente). Sem confirmado, a função devolve 409
 * confirmar_custo com a estimativa (o BotaoComCusto/Custo da tela mostra antes e confirma).
 */
export const montarCampanhaDoCanvas = (projetoId: string, confirmado = false) =>
  chamarFuncao<{ campanha_id: string; custo_usd: number; projeto_id: string }>("ponte-lab-campanha", {
    acao: "montar_campanha",
    projeto_id: projetoId,
    ...(confirmado ? { confirmado: true } : {}),
  });

/** Aceitar aplica a sugestão no lado de destino; recusar só fecha. */
export const decidirSugestao = (id: string, aceitar: boolean) =>
  chamarFuncao<{ sugestao: SugestaoDaPonte; estado: EstadoDaPonte }>("ponte-lab-campanha", { acao: "sugestao_decidir", id, aceitar });

/** Chaves do react-query das duas telas. */
export const chavesDaPonte = {
  porCampanha: (campanhaId: string) => ["ponte", "campanha", campanhaId] as const,
  porProjeto: (projetoId: string) => ["ponte", "projeto", projetoId] as const,
};

/** Rótulo curto para o selo do nó no canvas e para a lista de sugestões. */
export function rotuloDaChave(chave: string): string {
  if (chave === "cliente") return "Cliente";
  if (chave === "marca") return "Marca";
  if (chave === "oferta") return "Oferta";
  if (chave === "publico") return "Público";
  if (chave === "funil") return "Funil";
  if (chave === "anuncio") return "Anúncio";
  if (chave.indexOf("produto:") === 0) return "Produto";
  if (chave.indexOf("peca:") === 0) return "Peça da campanha";
  if (chave.indexOf("stories:") === 0) return "Stories da fase";
  return "Campanha";
}

/** A marca de sincronia de um nó (ou null quando o nó é só do canvas). */
export function sincDoNo(dados: unknown): SincDoNo | null {
  const d = dados && typeof dados === "object" ? (dados as Record<string, unknown>) : null;
  const s = d && d.sinc && typeof d.sinc === "object" ? (d.sinc as Record<string, unknown>) : null;
  if (!s || typeof s.campanha_id !== "string" || typeof s.chave !== "string") return null;
  return { campanha_id: s.campanha_id, chave: s.chave, origem: s.origem === "canvas" ? "canvas" : "campanha", hash: typeof s.hash === "string" ? s.hash : "" };
}

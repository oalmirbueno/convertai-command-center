/**
 * O agente da campanha entende o selo (frente SEL, 30/09): "melhora o selo",
 * "usa a logo como selo", "esse selo aqui" (com a imagem anexada).
 *
 * O Jev (Choice) diz o que a mensagem pede (_shared/selo-da-campanha.ts,
 * perguntaDoPedidoDoSelo). Aqui mora o cartão, puro (sem Deno e sem banco):
 * - usar a logo e usar o anexo: sem custo e com volta, vão direto (regra 6
 *   de _shared/acoes-do-agente.ts): o cartão chega feito, com Desfazer;
 * - melhorar: custa uma imagem, então o cartão pede Confirmar com o custo
 *   antes; confirmado, a versão nova vira o selo, com Desfazer.
 * O Desfazer volta o selo de antes (desfazer_acao_agente, operação
 * selo_trocar ou selo_melhorar, com selo_id_antes).
 */
import { type AcaoDoAgente, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";
import type { IntencaoDoSelo } from "../_shared/selo-da-campanha.ts";

export type PedidoDoSeloNaConversa = { intencao: IntencaoDoSelo; pedido: string; anexos: string[] };

export const OPERACOES_DO_SELO = ["selo_trocar", "selo_melhorar"] as const;

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** Linha para o estrategista: o selo é feito à parte (cartão), ele não mexe em identidade.selo por isso. */
export function blocoDoSeloParaOEstrategista(intencao: IntencaoDoSelo): string {
  if (intencao === "nenhuma") return "";
  const oQue = intencao === "melhorar"
    ? "melhorar o selo (o painel prepara com o custo e a equipe confirma)"
    : intencao === "usar_logo"
    ? "usar a logo da marca como selo (o painel já trocou, com Desfazer)"
    : intencao === "usar_anexo"
    ? "usar a imagem anexada como o selo (o painel já trocou, com Desfazer)"
    : "gerar opções novas de selo (a equipe gera na seção Selo, com o custo antes)";
  return `SELO: este pedido é para ${oQue}. Não mude identidade.selo por causa disso e não diga que desenhou nada. Se o pedido ensinar um gosto duradouro sobre o selo (ex.: "nada de selo genérico dourado"), escreva essa regra.`;
}

/**
 * O cartão do selo na conversa. `feito`: a troca já aconteceu (logo ou
 * anexo), com o selo de antes para o Desfazer. Sem `feito`: a proposta do
 * Melhorar, com o custo antes do Confirmar.
 */
export function acaoDoSeloNaConversa(
  campanha: { id: string; nome: string; client_id: string; selo_id?: string | null },
  p: PedidoDoSeloNaConversa & { custoUsd?: number | null },
  opcoes: { userId: string; feito?: { versao_id: string; rotulo: string; selo_id_antes: string | null; aviso?: string | null } | null; id?: string },
): AcaoDoAgente | null {
  const id = opcoes.id || `selo-${Date.now().toString(36)}`;
  const agora = new Date().toISOString();
  const base = { tipo: TIPO_DA_ACAO as typeof TIPO_DA_ACAO, agente: "mes", id, ignorados: [] as string[], recusados: [] as AcaoDoAgente["recusados"] };
  if ((p.intencao === "usar_logo" || p.intencao === "usar_anexo") && opcoes.feito) {
    const f = opcoes.feito;
    return {
      ...base,
      resumo: p.intencao === "usar_logo" ? `Troquei o selo da campanha "${umaLinha(campanha.nome, 80)}" pela logo da marca.` : `Troquei o selo da campanha "${umaLinha(campanha.nome, 80)}" pela imagem que você mandou.`,
      itens: [{ ref: "s1", alvo_id: campanha.id, titulo: "Selo da campanha", detalhe: f.selo_id_antes ? "o de antes fica no histórico" : "a campanha não tinha selo", operacao: "selo_trocar", rotulo: "trocar", para: f.versao_id, para_rotulo: f.rotulo }],
      contexto: { campanha_id: campanha.id, client_id: campanha.client_id, tipo: "selo_na_conversa" },
      executada_em: agora,
      executada_por: opcoes.userId,
      executada_direto: true,
      resultados: [{ ref: "s1", alvo_id: campanha.id, titulo: "Selo da campanha", operacao: "selo_trocar", ok: true, ...(f.aviso ? { motivo: f.aviso } : {}), desfazer: { selo_id_antes: f.selo_id_antes } }],
    };
  }
  if (p.intencao === "melhorar") {
    if (!campanha.selo_id) return null;
    return {
      ...base,
      resumo: `Melhorar o selo da campanha "${umaLinha(campanha.nome, 80)}": ${umaLinha(p.pedido, 160)}`,
      itens: [{
        ref: "s1",
        alvo_id: campanha.id,
        titulo: "Selo da campanha",
        detalhe: p.anexos.length ? `com ${p.anexos.length} ${p.anexos.length === 1 ? "referência" : "referências"}` : "a versão nova vira o selo; a de hoje fica no histórico",
        operacao: "selo_melhorar",
        rotulo: "melhorar",
        para: umaLinha(p.pedido, 600),
        para_rotulo: "versão nova",
      }],
      contexto: { campanha_id: campanha.id, client_id: campanha.client_id, tipo: "selo_na_conversa", selo_id: campanha.selo_id, referencias: p.anexos.slice(0, 3) },
      custo_estimado_usd: typeof p.custoUsd === "number" && p.custoUsd > 0 ? p.custoUsd : null,
    };
  }
  return null;
}

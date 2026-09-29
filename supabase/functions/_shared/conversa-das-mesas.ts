/**
 * Conversa dos agentes das mesas de mídia (frente AG2, 29/09/2026): Mesa Foto,
 * Mesa Vídeos, Mesa Edição, Mesa Publicidade, Mesa Roteiros e Estilo.
 *
 * Duas peças que todos esses agentes repetiam, cada um do seu jeito:
 *
 * 1. `gravarTroca`: grava a pergunta e a resposta em agente_mensagens.
 *    - Em insert de várias linhas, a coluna que falta vai como null (não usa
 *      o default). `anexos` é NOT NULL: sem ele, as DUAS linhas eram recusadas
 *      e a mensagem sumia (bug achado no agente de contexto em 29/09).
 *    - O erro nunca é engolido: vai para o log e volta para quem chama. Sem a
 *      linha do agente, o cartão de ação não tem onde morar (Confirmar e
 *      Desfazer procuram a proposta pela mensagem).
 *    - Quando o lote falha, tenta uma vez linha a linha: a resposta do agente
 *      já foi cobrada e, se a ação já foi feita na hora, a prova e o Desfazer
 *      moram nela.
 *
 * 2. `referenciaDoPedido`: "essa", "a segunda", "todas", "a última". Quando o
 *    pedido aponta um item sem dizer qual, o Jev (Choice) escolhe entre os
 *    apelidos da etapa (o que está na tela, com a ordem de lá). O resultado
 *    vai para o modelo como um fato ("'a segunda' = a2"), e o modelo continua
 *    livre para perguntar quando a escolha veio incerta. Sem Jev, nada muda.
 *
 * Módulo sem Supabase direto (recebe o cliente) e sem Deno fora do Jev:
 * roda no vitest.
 */
import { jevPerguntar, type RespostaJev } from "./jev.ts";
import { registrarFalha } from "./falha-registrada.ts";

// deno-lint-ignore no-explicit-any
type ServicoMinimo = { from: (tabela: string) => any };

export type LinhaDaTroca = { conteudo: string; anexos?: unknown[] | null; uso_id?: string | null };

export type TrocaGravada = {
  /** Id da linha do usuário (null quando não gravou). */
  usuarioId: string | null;
  /** Id da linha do agente: é por ele que o Confirmar acha a proposta. */
  agenteId: string | null;
  /** Motivo curto quando alguma linha não foi gravada (vai para a tela como aviso). */
  erro: string | null;
};

/** Anexos sempre como lista (NOT NULL no banco). */
export function anexosSeguros(a: unknown): unknown[] {
  return Array.isArray(a) ? a : [];
}

/**
 * Grava a pergunta e a resposta (nessa ordem, com 1 ms de diferença para a
 * ordem da conversa ser estável). Nunca lança.
 */
export async function gravarTroca(
  servico: ServicoMinimo,
  p: { conversaId: string; clientId: string; usuario: LinhaDaTroca; agente: LinhaDaTroca; onde: string; agora?: number },
): Promise<TrocaGravada> {
  const base = typeof p.agora === "number" ? p.agora : Date.now();
  const linha = (papel: "usuario" | "agente", l: LinhaDaTroca, i: number) => ({
    conversa_id: p.conversaId,
    client_id: p.clientId,
    criado_em: new Date(base + i).toISOString(),
    papel,
    conteudo: String(l.conteudo || "").slice(0, 20_000),
    anexos: anexosSeguros(l.anexos),
    uso_id: l.uso_id || null,
  });
  const linhas = [linha("usuario", p.usuario, 0), linha("agente", p.agente, 1)];
  try {
    const { data, error } = await servico.from("agente_mensagens").insert(linhas).select("id, papel");
    if (!error) {
      const lista = (data as { id: string; papel: string }[] | null) ?? [];
      const u = lista.find((m) => m.papel === "usuario");
      const a = lista.find((m) => m.papel === "agente");
      return { usuarioId: u ? String(u.id) : null, agenteId: a ? String(a.id) : null, erro: a ? null : "a resposta não voltou do banco" };
    }
    registrarFalha(`${p.onde}: conversa não gravada em lote (tentando linha a linha)`, error, { conversa_id: p.conversaId });
  } catch (e) {
    registrarFalha(`${p.onde}: conversa não gravada em lote (tentando linha a linha)`, e, { conversa_id: p.conversaId });
  }
  // Uma tentativa linha a linha: sem laço.
  const um = async (l: Record<string, unknown>): Promise<{ id: string | null; erro: string | null }> => {
    try {
      const { data, error } = await servico.from("agente_mensagens").insert(l).select("id").single();
      if (error || !data) return { id: null, erro: registrarFalha(`${p.onde}: linha da conversa não gravada`, error || "sem retorno", { conversa_id: p.conversaId, papel: l.papel }) };
      return { id: String((data as { id: string }).id), erro: null };
    } catch (e) {
      return { id: null, erro: registrarFalha(`${p.onde}: linha da conversa não gravada`, e, { conversa_id: p.conversaId, papel: l.papel }) };
    }
  };
  const u = await um(linhas[0]);
  const a = await um(linhas[1]);
  return { usuarioId: u.id, agenteId: a.id, erro: a.erro || u.erro };
}

/** Frase para a tela quando a conversa não ficou guardada. */
export const AVISO_SEM_REGISTRO = "A resposta chegou, mas não ficou guardada na conversa. Os cartões desta resposta não podem ser confirmados; peça de novo.";

// ------------------------------------------------------------------ "essa", "a segunda", "todas"

export type ItemReferivel = { ref: string; titulo: string; detalhe?: string | null };

export type ReferenciaDoPedido = {
  /** Apelidos escolhidos (um item, ou todos os da lista). */
  refs: string[];
  /** "um" = um item; "todas" = todos os da lista. */
  alcance: "um" | "todas";
  /** Probabilidade da opção escolhida (0 a 1). */
  probabilidade: number;
  /** Abaixo do limiar: o modelo deve confirmar com uma pergunta curta. */
  incerta: boolean;
  fonte: "jev";
};

/** Palavras que apontam sem dizer qual. Sem elas, não vale a chamada. */
const APONTA = /\b(ess[ae]s?|est[ae]s?|isso|isto|aquel[ae]s?|aquilo|dela|dele|nela|nele|a mesma|o mesmo|primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|quint[ao]|sext[ao]|[úu]ltim[ao]|pen[úu]ltim[ao]|todas|todos|tudo|cada uma|cada um|a de cima|a de baixo|a outra|o outro)\b/i;

/** O pedido aponta um item sem dizer qual? (regra barata antes do Jev). */
export function pedidoAponta(texto: unknown): boolean {
  return APONTA.test(String(texto == null ? "" : texto));
}

/** Máximo de itens que vão como opção (o Choice fica bom com poucas opções claras). */
export const MAX_OPCOES_DA_REFERENCIA = 12;
export const LIMIAR_DA_REFERENCIA = 0.6;

const TODAS = "todas_da_lista";
const NENHUM = "nenhum_item";

/**
 * Resolve "essa/a segunda/todas" contra a lista da etapa (na ordem da tela).
 * `ultimaResposta` é a última fala do agente: "a segunda" costuma apontar a
 * lista que ele acabou de dar. Devolve null quando o pedido não aponta, a
 * lista está vazia, o Jev escolheu "nenhum" ou está fora do ar.
 */
export async function referenciaDoPedido(
  pedido: string,
  itens: ItemReferivel[],
  opcoes: { agente: string; ultimaResposta?: string | null; selecionados?: string[]; chave?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = { agente: "agente" },
): Promise<ReferenciaDoPedido | null> {
  const texto = String(pedido || "").trim();
  const lista = itens.filter((i) => i && i.ref).slice(0, MAX_OPCOES_DA_REFERENCIA);
  if (!texto || !lista.length || !pedidoAponta(texto)) return null;
  const criteria: Record<string, string> = {};
  lista.forEach((i, n) => {
    criteria[i.ref] = `o item ${n + 1} da lista: "${String(i.titulo).slice(0, 120)}"${i.detalhe ? ` (${String(i.detalhe).slice(0, 120)})` : ""}`;
  });
  if (lista.length > 1) criteria[TODAS] = "todos os itens da lista de uma vez (\"todas\", \"todos\", \"cada uma\")";
  criteria[NENHUM] = "o pedido não aponta nenhum item desta lista, ou aponta algo que não está nela";
  try {
    const r = await jevPerguntar(
      {
        state: {
          pedido: texto.slice(0, 1500),
          agente: opcoes.agente,
          ultima_resposta_do_agente: String(opcoes.ultimaResposta || "").slice(0, 1200) || null,
          itens_na_ordem_da_tela: lista.map((i, n) => ({ posicao: n + 1, apelido: i.ref, titulo: i.titulo, detalhe: i.detalhe || null })),
          selecionados_na_tela: (opcoes.selecionados || []).slice(0, 12),
        },
        questions: {
          alvo: {
            type: "choice",
            instructions:
              "A equipe falou com o agente usando uma referência sem nome (\"essa\", \"a segunda\", \"a última\", \"todas\"). Qual item de `itens_na_ordem_da_tela` o `pedido` quer dizer? \"Essa\"/\"esta\" costuma ser o item selecionado na tela ou o último citado na `ultima_resposta_do_agente`; posição (\"a segunda\") conta na ordem da lista.",
            criteria,
          },
        },
      },
      { chave: opcoes.chave, fetchImpl: opcoes.fetchImpl, timeoutMs: opcoes.timeoutMs ?? 5_000 },
    );
    return lerEscolha(r.answers.alvo, lista);
  } catch (e) {
    registrarFalha(`${opcoes.agente}: referência do pedido sem Jev (o modelo decide sozinho)`, e);
    return null;
  }
}

/** Lê a resposta do Choice (exportada para o teste). */
export function lerEscolha(r: RespostaJev | undefined, lista: ItemReferivel[]): ReferenciaDoPedido | null {
  const escolha = r && typeof r.choice === "string" ? r.choice : "";
  if (!escolha || escolha === NENHUM) return null;
  const p = r && r.probabilities && typeof r.probabilities[escolha] === "number" ? r.probabilities[escolha] : typeof r?.confidence === "number" ? r.confidence : 0;
  if (escolha === TODAS) return { refs: lista.map((i) => i.ref), alcance: "todas", probabilidade: p, incerta: p < LIMIAR_DA_REFERENCIA, fonte: "jev" };
  if (!lista.some((i) => i.ref === escolha)) return null;
  return { refs: [escolha], alcance: "um", probabilidade: p, incerta: p < LIMIAR_DA_REFERENCIA, fonte: "jev" };
}

/** Linha para o sistema do modelo (vazia quando não há referência). */
export function blocoDaReferencia(r: ReferenciaDoPedido | null, itens: ItemReferivel[]): string {
  if (!r || !r.refs.length) return "";
  const nomes = r.refs.slice(0, 12).map((ref) => {
    const i = itens.find((x) => x.ref === ref);
    return i ? `${ref} ("${String(i.titulo).slice(0, 80)}")` : ref;
  }).join(", ");
  const quem = r.alcance === "todas" ? `todos os itens da lista: ${nomes}` : nomes;
  return r.incerta
    ? `\nREFERÊNCIA DO PEDIDO (incerta): o pedido provavelmente fala de ${quem}. Se a ação depender disso, confirme com UMA pergunta curta com as opções, antes de propor.`
    : `\nREFERÊNCIA DO PEDIDO: quando a equipe diz "essa", "a segunda", "todas" ou parecido, está falando de ${quem}. Use esse(s) apelido(s) na ação.`;
}

/**
 * A conversa dos agentes da Mesa nunca perde a mensagem (29/09: "o agente de
 * contexto não responde, a mensagem some").
 *
 * - O pedido é gravado ANTES da IA. Se nem isso grava, o erro volta na hora
 *   (nada foi gasto) e a tela devolve o texto ao campo.
 * - Se a IA falha, o pedido gravado sai (soltarPedido) e o erro volta: a tela
 *   devolve o texto ao campo e o reenvio não duplica.
 * - A resposta é gravada com uma segunda tentativa; se ainda falhar, quem
 *   chama devolve a resposta com aviso (a tela a mantém e diz que não ficou
 *   guardada), nunca some calada.
 *
 * E o que o agente precisa para entender "esse", "o de ontem", "todos":
 * - a data de hoje em São Paulo, com o dia da semana;
 * - o histórico com os registros do painel (o que foi confirmado, desfeito)
 *   e o estado dos cartões de cada resposta, colados à resposta do agente.
 *
 * Sem Deno: o Vitest lê este arquivo. O banco chega por parâmetro.
 */

// deno-lint-ignore no-explicit-any
export type BancoDaConversa = { from: (tabela: string) => any };

export class ErroDaConversa extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** Hoje em São Paulo: data ISO e a frase para o prompt. */
export function hojeParaOAgente(agora: Date = new Date()): { data: string; texto: string } {
  let data: string;
  try {
    data = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  } catch {
    data = new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  }
  const d = new Date(`${data}T12:00:00Z`);
  const dia = DIAS[d.getUTCDay()];
  const ontem = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return { data, texto: `HOJE: ${dia}, ${br(data)} (${data}). Ontem foi ${br(ontem)}. Datas relativas ("amanhã", "sexta", "o de ontem") partem daqui.` };
}

type LinhaDaMensagem = { id?: string | null; papel: string; conteudo: string | null; anexos?: unknown; criado_em?: string | null };

/** Estado curto de cada cartão da resposta, para o agente saber o que já aconteceu. */
export function resumoDosCartoes(anexos: unknown): string {
  if (!Array.isArray(anexos)) return "";
  const partes: string[] = [];
  for (const a of anexos) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (!o) continue;
    const tipo = String(o.tipo || "");
    if (tipo !== "acao_agente" && tipo !== "acao_agenda" && tipo !== "gerar_conteudos" && tipo !== "criar_conteudos") continue;
    const estado = o.desfeita_em ? "desfeito" : o.parada_em ? "parado no meio" : o.executada_em ? "feito" : o.descartada_em ? "cancelado" : "esperando confirmação";
    const resumo = String(o.resumo || "").replace(/\s+/g, " ").trim().slice(0, 200);
    partes.push(`${resumo || "ação"} (${estado})`);
  }
  if (!partes.length) return "";
  return `\n[Cartões desta resposta: ${partes.join("; ")}]`;
}

/**
 * O histórico no formato do modelo, do mais antigo ao mais novo, alternando
 * pedido e resposta. O registro do painel ("3 feitos", "ação desfeita") vira
 * nota colada à resposta anterior do agente (não é pedido da equipe).
 * `excluir`: o id do pedido que acabou de ser gravado (vai à parte).
 */
export function historicoParaOModelo(
  linhas: LinhaDaMensagem[] | null | undefined,
  opcoes: { excluir?: string | null; max?: number; maxChars?: number } = {},
): Array<{ papel: "usuario" | "agente"; conteudo: string }> {
  const max = opcoes.max ?? 16;
  const maxChars = opcoes.maxChars ?? 2000;
  const ordenadas = (linhas || []).filter((l) => l && (!opcoes.excluir || l.id !== opcoes.excluir));
  const saida: Array<{ papel: "usuario" | "agente"; conteudo: string }> = [];
  for (const l of ordenadas) {
    const texto = String(l.conteudo || "").trim();
    if (l.papel === "sistema") {
      const ultima = saida[saida.length - 1];
      if (ultima && ultima.papel === "agente" && texto) ultima.conteudo = `${ultima.conteudo}\n[Registro do painel depois: ${texto.slice(0, 300)}]`;
      continue;
    }
    if (!texto) continue;
    const papel: "usuario" | "agente" = l.papel === "agente" ? "agente" : "usuario";
    const conteudo = papel === "agente" ? `${texto.slice(0, maxChars)}${resumoDosCartoes(l.anexos)}` : texto.slice(0, maxChars);
    saida.push({ papel, conteudo });
  }
  return saida.slice(-max);
}

/** Grava o pedido antes da IA. Lança ErroDaConversa (503) quando não grava: nada foi gasto. */
export async function gravarPedidoAntes(
  db: BancoDaConversa,
  linha: { conversa_id: string; client_id: string; conteudo: string; anexos?: unknown[]; criado_em?: string },
): Promise<{ id: string; criado_em: string }> {
  const criado_em = linha.criado_em || new Date().toISOString();
  const { data, error } = await db
    .from("agente_mensagens")
    .insert({ conversa_id: linha.conversa_id, client_id: linha.client_id, papel: "usuario", conteudo: linha.conteudo, anexos: linha.anexos ?? [], criado_em })
    .select("id")
    .single();
  if (error || !data) {
    console.error("conversa-segura: pedido nao gravado", { client_id: linha.client_id, erro: error ? String(error.message || error.code || "") .slice(0, 200) : "sem linha" });
    throw new ErroDaConversa(503, "pedido_nao_gravado", "A mensagem não foi guardada, então nada foi feito. Ela voltou para o campo: tente de novo.");
  }
  return { id: String((data as { id: string }).id), criado_em };
}

/** A IA falhou: o pedido gravado sai (a tela devolve o texto ao campo e o reenvio não duplica). Nunca lança. */
export async function soltarPedido(db: BancoDaConversa, id: string | null | undefined, clientId: string): Promise<void> {
  if (!id) return;
  try {
    await db.from("agente_mensagens").delete().eq("id", id).eq("client_id", clientId).eq("papel", "usuario");
  } catch {
    // o pedido fica na conversa; melhor que sumir
  }
}

/**
 * Grava a resposta do agente (uma segunda tentativa se a primeira falhar).
 * Devolve o id, ou null com o motivo no log: quem chama avisa a tela.
 */
export async function gravarResposta(
  db: BancoDaConversa,
  linha: { conversa_id: string; client_id: string; conteudo: string; anexos?: unknown[]; uso_id?: string | null; depoisDe?: string | null },
): Promise<string | null> {
  const base = linha.depoisDe ? new Date(linha.depoisDe).getTime() : Date.now();
  const criado_em = new Date(Math.max(Date.now(), (Number.isFinite(base) ? base : Date.now()) + 1)).toISOString();
  const registro = { conversa_id: linha.conversa_id, client_id: linha.client_id, papel: "agente", conteudo: linha.conteudo, anexos: linha.anexos ?? [], uso_id: linha.uso_id ?? null, criado_em };
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const { data, error } = await db.from("agente_mensagens").insert(registro).select("id").single();
      if (!error && data) return String((data as { id: string }).id);
      console.error("conversa-segura: resposta nao gravada", { client_id: linha.client_id, tentativa, erro: error ? String(error.message || error.code || "").slice(0, 200) : "sem linha" });
    } catch (e) {
      console.error("conversa-segura: resposta nao gravada", { client_id: linha.client_id, tentativa, erro: e instanceof Error ? e.message.slice(0, 200) : "desconhecido" });
    }
  }
  return null;
}

export const AVISO_RESPOSTA_NAO_GUARDADA = "A resposta chegou, mas não ficou guardada na conversa. Copie o que precisar: ao reabrir, ela não aparece.";

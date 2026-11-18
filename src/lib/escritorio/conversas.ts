import { DONO, type Conversa, type Leitura, type Mensagem, type Sala } from "./tipos";

/**
 * Conversas do Escritório: as contas da lista da esquerda (com quem é, o
 * último recado e o que o dono ainda não leu), sem tela.
 */

type MensagemParaContar = Pick<Mensagem, "id" | "conversa_id" | "de_slug">;

/** Os ids das mensagens que este leitor já leu. */
export function idsLidosPor(leituras: readonly Leitura[], leitor: string = DONO): Set<string> {
  const lidos = new Set<string>();
  for (const l of leituras) if (l.leitor_slug === leitor) lidos.add(l.mensagem_id);
  return lidos;
}

/**
 * Não lidas por conversa: mensagem que não é do dono e não tem a linha do
 * dono em escritorio_leituras. A leitura de outro agente não conta.
 */
export function naoLidasPorConversa(mensagens: readonly MensagemParaContar[], leituras: readonly Leitura[]): Map<string, number> {
  const lidos = idsLidosPor(leituras);
  const mapa = new Map<string, number>();
  for (const m of mensagens) {
    if (m.de_slug === DONO || lidos.has(m.id)) continue;
    mapa.set(m.conversa_id, (mapa.get(m.conversa_id) ?? 0) + 1);
  }
  return mapa;
}

/** Quantas mensagens o dono ainda não leu, somando todas as conversas. */
export function totalDeNaoLidas(mensagens: readonly MensagemParaContar[], leituras: readonly Leitura[]): number {
  let total = 0;
  for (const n of naoLidasPorConversa(mensagens, leituras).values()) total += n;
  return total;
}

/** A mensagem mais recente de cada conversa. */
export function ultimaPorConversa<T extends Pick<Mensagem, "conversa_id" | "created_at">>(mensagens: readonly T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const m of mensagens) {
    const atual = mapa.get(m.conversa_id);
    if (!atual || String(m.created_at) > String(atual.created_at)) mapa.set(m.conversa_id, m);
  }
  return mapa;
}

/** Uma linha só, cortada com reticências. */
export function trecho(corpo: string | null | undefined, max = 90): string {
  const limpo = String(corpo || "").replace(/\s+/g, " ").trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1).trimEnd()}…` : limpo;
}

/** A mais recente primeiro (ultima_em). */
export function ordenarConversas<T extends Pick<Conversa, "ultima_em">>(conversas: readonly T[]): T[] {
  return [...conversas].sort((a, b) => (String(a.ultima_em) < String(b.ultima_em) ? 1 : String(a.ultima_em) > String(b.ultima_em) ? -1 : 0));
}

/** Quem participa da conversa direta, fora o dono, na ordem em que aparece. */
export function participantes(mensagens: readonly Pick<Mensagem, "de_slug" | "para_slug">[]): string[] {
  const vistos: string[] = [];
  for (const m of mensagens) {
    for (const slug of [m.de_slug, m.para_slug]) {
      if (slug && slug !== DONO && vistos.indexOf(slug) < 0) vistos.push(slug);
    }
  }
  return vistos;
}

/** Com quem é a conversa: o nome da sala, ou o agente (os dois agentes, quando o dono só assiste). */
export function comQuem(
  conversa: Pick<Conversa, "tipo" | "grupo_id" | "criada_por">,
  mensagens: readonly Pick<Mensagem, "de_slug" | "para_slug">[],
  nomeDoAgente: (slug: string) => string,
  salas: readonly Pick<Sala, "id" | "nome">[],
): string {
  if (conversa.tipo === "grupo") return salas.find((s) => s.id === conversa.grupo_id)?.nome ?? "Sala";
  const quem = participantes(mensagens);
  if (quem.length > 0) return quem.map(nomeDoAgente).join(" e ");
  return conversa.criada_por && conversa.criada_por !== DONO ? nomeDoAgente(conversa.criada_por) : "Conversa";
}

export interface LinhaDaConversa {
  id: string;
  tipo: string;
  /** Com quem (agente) ou em qual sala. */
  titulo: string;
  assunto: string | null;
  /** O último recado, com quem falou na frente. */
  ultimo: string;
  ultimaEm: string;
  naoLidas: number;
}

/** A lista da esquerda, pronta para desenhar: ordenada, com título, último recado e não lidas. */
export function linhasDasConversas(
  conversas: readonly Conversa[],
  mensagens: readonly Mensagem[],
  leituras: readonly Leitura[],
  nomeDoAgente: (slug: string) => string,
  salas: readonly Pick<Sala, "id" | "nome">[],
): LinhaDaConversa[] {
  const naoLidas = naoLidasPorConversa(mensagens, leituras);
  const ultimas = ultimaPorConversa(mensagens);
  const porConversa = new Map<string, Mensagem[]>();
  for (const m of mensagens) {
    const lista = porConversa.get(m.conversa_id);
    if (lista) lista.push(m);
    else porConversa.set(m.conversa_id, [m]);
  }
  return ordenarConversas(conversas).map((c) => {
    const ultima = ultimas.get(c.id);
    return {
      id: c.id,
      tipo: c.tipo,
      titulo: comQuem(c, porConversa.get(c.id) ?? [], nomeDoAgente, salas),
      assunto: c.assunto?.trim() || null,
      ultimo: ultima ? `${nomeDoAgente(ultima.de_slug)}: ${trecho(ultima.corpo)}` : "",
      ultimaEm: c.ultima_em,
      naoLidas: naoLidas.get(c.id) ?? 0,
    };
  });
}

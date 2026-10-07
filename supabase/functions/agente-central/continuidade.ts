import { MARCADOR_CONFIRMADO, type PerguntaDoAgente } from "./regras.ts";

export type RespostaGuardada = { pergunta: string; resposta: string; em: string };
const chave = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Última resposta prevalece. O diário mantém o histórico integral fora deste recorte. */
export function juntarRespostas(antigas: unknown, novas: RespostaGuardada[]): RespostaGuardada[] {
  const vistas = new Set<string>();
  return [...novas, ...(Array.isArray(antigas) ? antigas : [])].filter((r): r is RespostaGuardada => {
    if (!r || typeof r.pergunta !== "string" || typeof r.resposta !== "string" || !r.resposta.trim()) return false;
    const k = chave(r.pergunta) === "contexto livre do dono" ? `${chave(r.pergunta)}:${chave(r.resposta)}` : chave(r.pergunta);
    if (!k || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  }).slice(0, 100);
}

/** Separado do recorte do dossiê: avanços volumosos não podem esconder as decisões. */
export function contextoDasRespostas(dossie: string, respostas: RespostaGuardada[]): string {
  const inicio = dossie.indexOf(MARCADOR_CONFIRMADO);
  const secao = inicio < 0 ? "" : dossie.slice(inicio + MARCADOR_CONFIRMADO.length).split(/\n## /)[0].trim();
  return ["RESPOSTAS JÁ REGISTRADAS DO DONO. Use-as; não peça a mesma informação com outras palavras. Datas e escopo continuam valendo. Só pergunte novamente se houver uma mudança concreta e cite essa mudança.",
    ...respostas.map((r) => `${r.em}: ${r.pergunta}\nResposta: ${r.resposta}`), secao].filter(Boolean).join("\n").slice(0, 14000);
}

/** Barreira determinística complementar à análise semântica do modelo. */
export function perguntasAindaAbertas(perguntas: PerguntaDoAgente[], respostas: RespostaGuardada[]): PerguntaDoAgente[] {
  const respondidas = new Set(respostas.map((r) => chave(r.pergunta)));
  return perguntas.filter((p) => !respondidas.has(chave(p.pergunta)));
}

/** Identificador estável por envio: repetir uma tentativa não duplica o diário. */
export async function idDaResposta(clientId: string, envio: string, texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([clientId, envio, texto])));
  const h = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function guardarEConferirResposta(conteudo: string, porta: {
  inserir: () => PromiseLike<{ error: { code?: string } | null }>;
  reler: () => PromiseLike<{ data: { content: string | null } | null; error: unknown }>;
}): Promise<void> {
  const { error } = await porta.inserir();
  if (error && error.code !== "23505") throw new Error("Não consegui guardar suas respostas. Nada foi publicado; tente novamente.");
  const prova = await porta.reler();
  if (prova.error || prova.data?.content !== conteudo) throw new Error("Não consegui confirmar suas respostas na memória. Nada foi publicado.");
}

/**
 * Hermes real ao lado do Gestor (Central de Autonomia, 08/10/2026).
 *
 * A função fala com a ponte do painel no servidor do Hermes
 * (integrations/hermes-operational/painel_ponte.mjs), que repassa um conjunto
 * fechado de chamadas para a API de sessões do próprio Hermes. URL e token
 * ficam só no servidor (HERMES_PAINEL_URL e HERMES_PAINEL_TOKEN, no ambiente
 * ou no cofre do painel). Sem eles: `configurada: false`, nada simulado.
 *
 * Contexto compartilhado: ao enviar, a tela pode mandar referências (cliente,
 * projeto, tarefa); vão como uma linha de referência no começo da mensagem,
 * nunca conteúdo privado de outras conversas.
 */

import { chave } from "../../_shared/chaves.ts";

export class ErroDoHermes extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) { super(mensagem); }
}

const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
/** Sessões de conversa (o resto são rotinas: cron, kanban, subagente...). */
export const ORIGENS_DE_CONVERSA = new Set(["desktop", "api_server", "cli"]);
/** O Hermes recebe texto e imagens (conteúdo multimodal da API de sessões); arquivos de texto vão no corpo. */
export const MAX_TEXTO_AO_HERMES = 58_000;

export function imagensParaOHermes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((u): u is string => typeof u === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u) && u.length <= 2_500_000).slice(0, 4);
}

async function configuracao(): Promise<{ url: string; token: string } | null> {
  const url = (await chave("HERMES_PAINEL_URL")).trim().replace(/\/+$/, "") || "https://hermes.aceleriq.com.br";
  const token = (await chave("HERMES_PAINEL_TOKEN")).trim();
  return token ? { url, token } : null;
}

async function ponte(caminho: string, opcoes: { method?: string; body?: unknown; tempo?: number } = {}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const c = await configuracao();
  if (!c) throw new ErroDoHermes(409, "ponte_nao_configurada", "A ponte com as sessões do Hermes ainda não foi ligada.");
  let r: Response;
  try {
    r = await fetch(`${c.url}/painel-api${caminho}`, {
      method: opcoes.method || "GET",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
      signal: AbortSignal.timeout(opcoes.tempo || 25_000),
    });
  } catch {
    throw new ErroDoHermes(502, "hermes_fora", "Não consegui falar com o Hermes agora.");
  }
  const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.status === 401) throw new ErroDoHermes(502, "ponte_recusou", "A ponte do Hermes recusou o token do painel.");
  if (r.status === 403) throw new ErroDoHermes(403, "sessao_privada", "Essa sessão é privada e não abre no painel.");
  if (r.status === 404) throw new ErroDoHermes(404, "nao_encontrado", "Sessão não encontrada no Hermes.");
  if (r.status === 409) throw new ErroDoHermes(409, String(json?.error || "conflito"), String(json?.mensagem || "O Hermes não aceitou agora."));
  if (r.status >= 400) throw new ErroDoHermes(502, String(json?.error || "hermes_erro"), "O Hermes respondeu com erro.");
  return { status: r.status, json };
}

const idDa = (v: unknown) => {
  const s = String(v ?? "");
  if (!ID.test(s)) throw new ErroDoHermes(400, "sessao_invalida", "Sessão inválida.");
  return encodeURIComponent(s);
};

/** Linha de referência do contexto do painel (só nomes e ids do OS). */
export function linhaDeContexto(c: { cliente?: { id: string; nome: string } | null; projeto?: { id: string; nome: string } | null; tarefa?: { id: string; titulo: string } | null } | null | undefined): string {
  if (!c) return "";
  const partes = [
    c.cliente ? `cliente ${c.cliente.nome} (${c.cliente.id})` : "",
    c.projeto ? `projeto ${c.projeto.nome} (${c.projeto.id})` : "",
    c.tarefa ? `tarefa ${c.tarefa.titulo} (${c.tarefa.id})` : "",
  ].filter(Boolean);
  return partes.length ? `[Contexto do painel Aceleriq: ${partes.join(" · ")}. Confira no MCP antes de agir.]` : "";
}

export async function hermesAcao(acao: string, corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (acao === "hermes_estado") {
    const c = await configuracao();
    if (!c) return { configurada: false };
    try {
      const r = await ponte("/saude", { tempo: 10_000 });
      return { configurada: true, ok: !!r.json?.ok, hermes: r.json?.hermes ?? null };
    } catch (e) {
      return { configurada: true, ok: false, erro: e instanceof Error ? e.message : "falha" };
    }
  }
  if (acao === "hermes_sessoes") {
    const busca = encodeURIComponent(String(corpo.busca ?? "").slice(0, 80));
    const r = (await ponte(`/sessoes?limite=100${busca ? `&busca=${busca}` : ""}`)).json || {};
    const origem = String(corpo.origem || "todas");
    const lista = Array.isArray(r.sessoes) ? (r.sessoes as Array<{ origem?: string }>) : [];
    const filtrada = origem === "conversas" ? lista.filter((x) => ORIGENS_DE_CONVERSA.has(String(x.origem))) : origem === "rotinas" ? lista.filter((x) => !ORIGENS_DE_CONVERSA.has(String(x.origem))) : lista;
    return { sessoes: filtrada.slice(0, 60) };
  }
  if (acao === "hermes_sessao") return (await ponte(`/sessoes/${idDa(corpo.sessao_id)}/mensagens?limite=120`)).json || {};
  if (acao === "hermes_estado_da_sessao") return (await ponte(`/sessoes/${idDa(corpo.sessao_id)}/estado`)).json || {};
  if (acao === "hermes_criar") return (await ponte("/sessoes", { method: "POST", body: { titulo: String(corpo.titulo ?? "").slice(0, 100) } })).json || {};
  if (acao === "hermes_continuar") return (await ponte(`/sessoes/${idDa(corpo.sessao_id)}/continuar`, { method: "POST" })).json || {};
  if (acao === "hermes_enviar") {
    const texto = String(corpo.texto ?? "").trim().slice(0, MAX_TEXTO_AO_HERMES);
    if (!texto) throw new ErroDoHermes(400, "texto_vazio", "Escreva a mensagem para o Hermes.");
    const ctx = linhaDeContexto(corpo.contexto as Parameters<typeof linhaDeContexto>[0]);
    const imagens = imagensParaOHermes(corpo.imagens);
    return (await ponte(`/sessoes/${idDa(corpo.sessao_id)}/enviar`, { method: "POST", body: { texto: ctx ? `${ctx}\n\n${texto}` : texto, imagens }, tempo: 40_000 })).json || {};
  }
  throw new ErroDoHermes(400, "acao_desconhecida", "Ação do Hermes desconhecida.");
}

export const ACOES_DO_HERMES = ["hermes_estado", "hermes_sessoes", "hermes_sessao", "hermes_estado_da_sessao", "hermes_criar", "hermes_continuar", "hermes_enviar"];

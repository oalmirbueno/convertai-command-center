/**
 * Teste de chave de verdade, só leitura e sem custo (frente CHV, 01/10/2026).
 *
 * Cada provedor é chamado numa rota de consulta que não gasta: listar modelos,
 * ler a conta, a assinatura ou o saldo. Endpoints conferidos na documentação
 * em 01/10/2026 e sondados com chave falsa (status de recusa anotado ao lado):
 * - OpenRouter: GET /api/v1/key (uso e limite) e GET /api/v1/credits (saldo;
 *   a doc nova pede chave de gestão, então 401/403 ali não invalida) [401];
 * - OpenAI: GET /v1/models [401]; Anthropic: GET /v1/models [401];
 * - Gemini: GET /v1beta/models com x-goog-api-key [400 "API key not valid"];
 * - ElevenLabs: GET /v1/user/subscription (caracteres usados e limite) [401];
 * - fal: GET /v1/models/pricing (pede chave) [401] e GET /v1/account/billing
 *   ?expand=credits (saldo; só chave de administrador);
 * - TypeSafe: POST /v1/systemone com corpo vazio: 401 = recusada, 422 = a
 *   chave passou e o corpo foi recusado (nada roda, nada é cobrado);
 * - Resend: GET /domains [400 "API key is invalid"; 401 restricted_api_key =
 *   chave só de envio, que vale];
 * - Vercel: GET /v2/user [403 invalidToken];
 * - Runway: GET /v1/organization (creditBalance) [401];
 * - HeyGen: GET /v3/users/me (saldo da carteira ou créditos) [401];
 * - Higgsfield: GET /requests/<id que não existe>/status: 404 = a chave passou [401];
 * - GitHub: GET /user [401];
 * - AWS: STS GetCallerIdentity assinado (SigV4), que nunca é cobrado e
 *   funciona sem permissão nenhuma [403 InvalidClientTokenId/SignatureDoesNotMatch].
 *
 * Regra dura: nada do que o provedor responde em texto vai para a tela ou o
 * banco (a OpenAI devolve o começo da chave na mensagem de erro). Só o status
 * e campos numéricos conhecidos. A mensagem é sempre nossa.
 */

import type { IdDoProvedor, NumerosDoProvedor } from "./catalogo.ts";

export type EstadoDoTeste = "valida" | "invalida" | "nao_testada";

export interface ResultadoDoTeste {
  estado: EstadoDoTeste;
  mensagem: string;
  numeros: NumerosDoProvedor;
  http: number | null;
}

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export const TIMEOUT_DO_TESTE_MS = 8_000;

/** AbortSignal.timeout quando existe (Deno, navegadores novos); sem ele, sem prazo (jsdom). */
function prazo(ms: number): AbortSignal | undefined {
  const fabrica = (AbortSignal as unknown as { timeout?: (n: number) => AbortSignal }).timeout;
  return typeof fabrica === "function" ? fabrica.call(AbortSignal, ms) : undefined;
}


interface Resposta {
  status: number;
  json: unknown;
  texto: string;
}

async function pedir(buscar: Buscar, url: string, init: RequestInit): Promise<Resposta> {
  const r = await buscar(url, { ...init, signal: prazo(TIMEOUT_DO_TESTE_MS) });
  const texto = await r.text().catch(() => "");
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json, texto: texto.slice(0, 2000) };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(Number(v)) ? Number(v) : null);
const curto = (v: unknown, max = 40): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

const valida = (mensagem: string, numeros: NumerosDoProvedor, http: number): ResultadoDoTeste => ({ estado: "valida", mensagem, numeros, http });
const invalida = (http: number, mensagem = "O provedor recusou a chave."): ResultadoDoTeste => ({ estado: "invalida", mensagem, numeros: {}, http });
const semTeste = (mensagem: string, http: number | null = null): ResultadoDoTeste => ({ estado: "nao_testada", mensagem, numeros: {}, http });

/** Leitura padrão do status: 2xx vale, 401/403 recusa, 429 e 5xx não deu para testar. */
function porStatus(status: number, okMsg = "Chave válida."): ResultadoDoTeste | null {
  if (status >= 200 && status < 300) return valida(okMsg, {}, status);
  if (status === 401 || status === 403) return invalida(status);
  if (status === 429) return semTeste("O provedor pediu calma (429). Tente de novo em um minuto.", status);
  if (status >= 500) return semTeste(`O provedor está fora do ar agora (${status}). Tente de novo mais tarde.`, status);
  return null;
}

type Testador = (valores: Record<string, string>, buscar: Buscar) => Promise<ResultadoDoTeste>;

const TESTADORES: Record<IdDoProvedor, Testador> = {
  async openrouter(v, buscar) {
    const h = { Authorization: `Bearer ${v.OPENROUTER_API_KEY}` };
    const k = await pedir(buscar, "https://openrouter.ai/api/v1/key", { method: "GET", headers: h });
    const base = porStatus(k.status);
    if (!base || base.estado !== "valida") return base || semTeste(`O OpenRouter respondeu ${k.status}.`, k.status);
    const d = obj(obj(k.json).data);
    const numeros: NumerosDoProvedor = {};
    const limite = num(d.limit);
    const restante = num(d.limit_remaining);
    const usado = num(d.usage);
    if (limite !== null && usado !== null) numeros.uso = { rotulo: "Limite da chave", usado, limite, unidade: "usd" };
    // Saldo da conta: /credits (pode pedir chave de gestão). Sem ele, o que resta no limite da chave.
    let saldo: number | null = null;
    try {
      const c = await pedir(buscar, "https://openrouter.ai/api/v1/credits", { method: "GET", headers: h });
      if (c.status >= 200 && c.status < 300) {
        const dc = obj(obj(c.json).data);
        const total = num(dc.total_credits);
        const gasto = num(dc.total_usage);
        if (total !== null && gasto !== null) saldo = Math.max(0, total - gasto);
      }
    } catch {
      /* só o saldo fica de fora */
    }
    if (saldo === null && restante !== null) saldo = restante;
    if (saldo !== null) numeros.saldo_usd = saldo;
    else numeros.sem_saldo_pela_api = true;
    if (d.is_free_tier === true) numeros.conta = "conta gratuita";
    return valida(saldo !== null && saldo < 1 ? "Chave válida, mas o crédito está acabando." : "Chave válida.", numeros, k.status);
  },

  async openai(v, buscar) {
    const r = await pedir(buscar, "https://api.openai.com/v1/models", { method: "GET", headers: { Authorization: `Bearer ${v.OPENAI_API_KEY}` } });
    const base = porStatus(r.status);
    if (!base) return semTeste(`A OpenAI respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const lista = Array.isArray(obj(r.json).data) ? (obj(r.json).data as unknown[]) : [];
    return valida("Chave válida.", { sem_saldo_pela_api: true, uso: { rotulo: "Modelos liberados", usado: lista.length, unidade: "itens" } }, r.status);
  },

  async anthropic(v, buscar) {
    const r = await pedir(buscar, "https://api.anthropic.com/v1/models?limit=100", {
      method: "GET",
      headers: { "x-api-key": v.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    });
    const base = porStatus(r.status);
    if (!base) return semTeste(`A Anthropic respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const lista = Array.isArray(obj(r.json).data) ? (obj(r.json).data as unknown[]) : [];
    return valida("Chave válida.", { sem_saldo_pela_api: true, uso: { rotulo: "Modelos liberados", usado: lista.length, unidade: "itens" } }, r.status);
  },

  async gemini(v, buscar) {
    const r = await pedir(buscar, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { method: "GET", headers: { "x-goog-api-key": v.GEMINI_API_KEY } });
    if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(r.texto)) return invalida(r.status);
    const base = porStatus(r.status);
    if (!base) return semTeste(`O Google respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const lista = Array.isArray(obj(r.json).models) ? (obj(r.json).models as unknown[]) : [];
    return valida("Chave válida.", { sem_saldo_pela_api: true, uso: { rotulo: "Modelos liberados", usado: lista.length, unidade: "itens" } }, r.status);
  },

  async typesafe(v, buscar) {
    // Corpo vazio de propósito: a chave é conferida antes do corpo; nada roda.
    const r = await pedir(buscar, "https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${v.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.status === 422 || r.status === 400) return valida("Chave válida.", { sem_saldo_pela_api: true }, r.status);
    const base = porStatus(r.status);
    return base || semTeste(`A TypeSafe respondeu ${r.status}.`, r.status);
  },

  async fal(v, buscar) {
    const h = { Authorization: `Key ${v.FAL_KEY}` };
    const r = await pedir(buscar, "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev", { method: "GET", headers: h });
    const base = porStatus(r.status);
    if (!base) return semTeste(`O fal respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const numeros: NumerosDoProvedor = {};
    try {
      const b = await pedir(buscar, "https://api.fal.ai/v1/account/billing?expand=credits", { method: "GET", headers: h });
      const saldo = b.status >= 200 && b.status < 300 ? num(obj(obj(b.json).credits).current_balance) : null;
      if (saldo !== null) numeros.saldo_usd = saldo;
      else numeros.sem_saldo_pela_api = true;
      const conta = curto(obj(b.json).username);
      if (conta) numeros.conta = conta;
    } catch {
      numeros.sem_saldo_pela_api = true;
    }
    return valida("Chave válida.", numeros, r.status);
  },

  async elevenlabs(v, buscar) {
    const r = await pedir(buscar, "https://api.elevenlabs.io/v1/user/subscription", { method: "GET", headers: { "xi-api-key": v.ELEVENLABS_API_KEY } });
    if (r.status === 401 && /missing_permissions/i.test(r.texto)) {
      return valida("Chave válida, sem permissão de ler a assinatura.", { sem_saldo_pela_api: true }, r.status);
    }
    const base = porStatus(r.status);
    if (!base) return semTeste(`A ElevenLabs respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const d = obj(r.json);
    const usado = num(d.character_count);
    const limite = num(d.character_limit);
    const numeros: NumerosDoProvedor = { sem_saldo_pela_api: true };
    if (usado !== null) numeros.uso = { rotulo: "Caracteres", usado, limite, unidade: "caracteres" };
    const plano = curto(d.tier);
    if (plano) numeros.conta = plano;
    const quase = usado !== null && limite !== null && limite > 0 && usado / limite >= 0.9;
    return valida(quase ? "Chave válida, mas os caracteres do mês estão acabando." : "Chave válida.", numeros, r.status);
  },

  async runway(v, buscar) {
    const r = await pedir(buscar, "https://api.dev.runwayml.com/v1/organization", {
      method: "GET",
      headers: { Authorization: `Bearer ${v.RUNWAYML_API_SECRET}`, "X-Runway-Version": "2024-11-06" },
    });
    const base = porStatus(r.status);
    if (!base) return semTeste(`A Runway respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const creditos = num(obj(r.json).creditBalance);
    // 1 crédito da Runway = US$ 0,01.
    const numeros: NumerosDoProvedor = creditos !== null ? { saldo_usd: creditos / 100, saldo_texto: `${Math.round(creditos)} créditos` } : { sem_saldo_pela_api: true };
    return valida("Chave válida.", numeros, r.status);
  },

  async heygen(v, buscar) {
    const r = await pedir(buscar, "https://api.heygen.com/v3/users/me", { method: "GET", headers: { "X-Api-Key": v.HEYGEN_API_KEY, Accept: "application/json" } });
    const base = porStatus(r.status);
    if (!base) return semTeste(`A HeyGen respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const raiz = obj(r.json);
    const d = Object.keys(obj(raiz.data)).length ? obj(raiz.data) : raiz;
    const tipo = curto(d.billing_type);
    const numeros: NumerosDoProvedor = {};
    const carteira = num(obj(d.wallet).remaining_balance);
    const creditos = num(obj(obj(obj(d.subscription).credits).premium_credits).remaining);
    const gastoUso = num(obj(d.usage_based).spending_current_usd);
    if (carteira !== null) numeros.saldo_usd = carteira;
    else if (creditos !== null) numeros.saldo_texto = `${Math.round(creditos)} créditos`;
    else numeros.sem_saldo_pela_api = true;
    if (gastoUso !== null) numeros.uso = { rotulo: "Gasto no ciclo", usado: gastoUso, unidade: "usd" };
    if (tipo) numeros.conta = tipo === "wallet" ? "carteira" : tipo === "subscription" ? "assinatura" : tipo === "usage_based" ? "por uso" : tipo;
    return valida("Chave válida.", numeros, r.status);
  },

  async higgsfield(v, buscar) {
    if (!v.HIGGSFIELD_API_KEY || !v.HIGGSFIELD_API_SECRET) return semTeste("A Higgsfield precisa do id da chave e do segredo.");
    const r = await pedir(buscar, "https://api.higgsfield.ai/requests/00000000-0000-4000-8000-000000000000/status", {
      method: "GET",
      headers: { Authorization: `Key ${v.HIGGSFIELD_API_KEY}:${v.HIGGSFIELD_API_SECRET}` },
    });
    // O pedido não existe de propósito: 404 (ou 422) quer dizer que a chave passou.
    if (r.status === 404 || r.status === 422 || r.status === 400) return valida("Chave válida.", { sem_saldo_pela_api: true }, r.status);
    const base = porStatus(r.status);
    if (base && base.estado === "valida") return valida("Chave válida.", { sem_saldo_pela_api: true }, r.status);
    return base || semTeste(`A Higgsfield respondeu ${r.status}.`, r.status);
  },

  async resend(v, buscar) {
    const r = await pedir(buscar, "https://api.resend.com/domains", { method: "GET", headers: { Authorization: `Bearer ${v.RESEND_API_KEY}` } });
    if (r.status === 401 && /restricted_api_key/i.test(r.texto)) {
      return valida("Chave válida (só envio de e-mail).", { sem_saldo_pela_api: true }, r.status);
    }
    if (r.status === 400 && /api key is invalid/i.test(r.texto)) return invalida(r.status);
    const base = porStatus(r.status);
    if (!base) return semTeste(`A Resend respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const lista = Array.isArray(obj(r.json).data) ? (obj(r.json).data as unknown[]) : [];
    const verificados = lista.filter((x) => obj(x).status === "verified").length;
    return valida(
      lista.length && !verificados ? "Chave válida, mas nenhum domínio verificado." : "Chave válida.",
      { sem_saldo_pela_api: true, uso: { rotulo: "Domínios verificados", usado: verificados, limite: lista.length, unidade: "itens" } },
      r.status,
    );
  },

  async vercel(v, buscar) {
    const r = await pedir(buscar, "https://api.vercel.com/v2/user", { method: "GET", headers: { Authorization: `Bearer ${v.VERCEL_TOKEN}` } });
    const base = porStatus(r.status);
    if (!base) return semTeste(`A Vercel respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const u = obj(obj(r.json).user);
    const conta = curto(u.username);
    return valida("Chave válida.", { sem_saldo_pela_api: true, ...(conta ? { conta: `@${conta}` } : {}) }, r.status);
  },

  async openart() {
    // Entrada pronta: o OpenArt ainda não tem API pública (só MCP com login da conta).
    return semTeste("O OpenArt ainda não tem API pública para testar. A chave fica guardada para quando entrar.");
  },

  async aws(v, buscar) {
    if (!v.REMOTION_AWS_ACCESS_KEY_ID || !v.REMOTION_AWS_SECRET_ACCESS_KEY) return semTeste("A AWS precisa do id da chave e da chave secreta.");
    const consulta = "Action=GetCallerIdentity&Version=2011-06-15";
    const cab = await assinarSigV4({ id: v.REMOTION_AWS_ACCESS_KEY_ID, segredo: v.REMOTION_AWS_SECRET_ACCESS_KEY, regiao: "us-east-1", servico: "sts", host: "sts.us-east-1.amazonaws.com", consulta });
    const r = await pedir(buscar, `https://sts.us-east-1.amazonaws.com/?${consulta}`, { method: "GET", headers: cab });
    if (r.status === 403 || r.status === 401) return invalida(r.status);
    const base = porStatus(r.status);
    if (!base) return semTeste(`A AWS respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    // Só o número da conta (12 dígitos), nunca o texto da resposta.
    const conta = (r.texto.match(/<Account>(\d{12})<\/Account>/) || [])[1];
    return valida("Chave válida.", { sem_saldo_pela_api: true, ...(conta ? { conta: `conta ${conta}` } : {}) }, r.status);
  },

  async github(v, buscar) {
    const r = await pedir(buscar, "https://api.github.com/user", {
      method: "GET",
      headers: { Authorization: `Bearer ${v.SECOND_BRAIN_GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "aceleriq-painel" },
    });
    const base = porStatus(r.status);
    if (!base) return semTeste(`O GitHub respondeu ${r.status}.`, r.status);
    if (base.estado !== "valida") return base;
    const conta = curto(obj(r.json).login);
    return valida("Chave válida.", { sem_saldo_pela_api: true, ...(conta ? { conta: `@${conta}` } : {}) }, r.status);
  },
};

async function hmac(chave: BufferSource, texto: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
}

async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Cabeçalhos AWS SigV4 de um GET sem corpo (`consulta` já em ordem e codificada; só o teste de chave usa). */
export async function assinarSigV4(o: { id: string; segredo: string; regiao: string; servico: string; host: string; consulta: string; agora?: Date }): Promise<Record<string, string>> {
  const quando = (o.agora || new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dia = quando.slice(0, 8);
  const assinados = "host;x-amz-date";
  const canonico = ["GET", "/", o.consulta, `host:${o.host}`, `x-amz-date:${quando}`, "", assinados, await sha256Hex("")].join("\n");
  const escopo = `${dia}/${o.regiao}/${o.servico}/aws4_request`;
  const aAssinar = ["AWS4-HMAC-SHA256", quando, escopo, await sha256Hex(canonico)].join("\n");
  let k = await hmac(new TextEncoder().encode(`AWS4${o.segredo}`), dia);
  k = await hmac(k, o.regiao);
  k = await hmac(k, o.servico);
  k = await hmac(k, "aws4_request");
  const assinatura = hex(await hmac(k, aAssinar));
  return { "X-Amz-Date": quando, Authorization: `AWS4-HMAC-SHA256 Credential=${o.id}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}` };
}

/**
 * Testa as chaves de um provedor. `valores` = {NOME: segredo}. Nunca lança:
 * rede fora ou tempo esgotado viram "não testada". A saída não contém a
 * chave (`semAChave` confere de novo, por garantia).
 */
export async function testarChave(id: IdDoProvedor, valores: Record<string, string>, buscar: Buscar): Promise<ResultadoDoTeste> {
  const testador = TESTADORES[id];
  if (!testador) return semTeste("Este provedor ainda não tem teste.");
  let r: ResultadoDoTeste;
  try {
    r = await testador(valores, buscar);
  } catch (e) {
    const tempo = e instanceof Error && /timeout|abort/i.test(`${e.name} ${e.message}`);
    r = semTeste(tempo ? "O provedor demorou demais para responder. Tente de novo." : "Não foi possível falar com o provedor agora.");
  }
  return semAChave(r, valores);
}

/** Garante que nenhum segredo (nem pedaço de 8+ caracteres dele) aparece no resultado. */
export function semAChave<T>(r: T, valores: Record<string, string>): T {
  const segredos = Object.values(valores).filter((s) => typeof s === "string" && s.length >= 8);
  if (!segredos.length) return r;
  const texto = JSON.stringify(r);
  const vaza = segredos.some((s) => {
    for (let i = 0; i + 8 <= s.length; i += 4) if (texto.indexOf(s.slice(i, i + 8)) >= 0) return true;
    return false;
  });
  if (!vaza) return r;
  return { estado: (r as unknown as ResultadoDoTeste).estado, mensagem: "Resultado escondido: continha parte da chave.", numeros: {}, http: (r as unknown as ResultadoDoTeste).http } as unknown as T;
}

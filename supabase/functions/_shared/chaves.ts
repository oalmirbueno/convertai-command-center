// Chaves de provedor (frente CHV): ambiente da função primeiro; sem ele, o cofre
// do painel (Vault, RPC chaves_do_cofre, service_role), em cache. Nunca loga o valor.
// Sem import: roda nas funções e no vitest. Código síncrono usa chaveCarregada
// depois de `await carregarChaves([...])`. Doc: chaves-admin/index.ts.

/** Mesma lista do CHECK de public.chaves_cofre. */
export const NOMES_DAS_CHAVES = [
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "ELEVENLABS_API_KEY", "FAL_KEY", "TYPESAFE_API_KEY",
  "RESEND_API_KEY", "VERCEL_TOKEN", "RUNWAYML_API_SECRET", "HEYGEN_API_KEY", "HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET",
  "SECOND_BRAIN_GITHUB_TOKEN", "OPENART_API_KEY", "REMOTION_AWS_ACCESS_KEY_ID", "REMOTION_AWS_SECRET_ACCESS_KEY",
] as const;
export type NomeDaChave = (typeof NOMES_DAS_CHAVES)[number];
export const CHAVES_DE_VIDEO: NomeDaChave[] = ["FAL_KEY", "RUNWAYML_API_SECRET", "HEYGEN_API_KEY", "HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET"];

export const TTL_MS = 180_000;
export const TTL_VAZIO_MS = 60_000;
const TTL_FALHA_MS = 15_000;

const cache = new Map<string, { valor: string; ate: number }>();

export interface OpcoesDoCofre {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  url?: string;
  chaveDeServico?: string;
  ambiente?: (nome: string) => string | undefined;
  agora?: () => number;
}

function amb(nome: string, o: OpcoesDoCofre = {}): string {
  try {
    if (o.ambiente) return String(o.ambiente(nome) || "").trim();
    const d = (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno;
    return String((d && d.env && d.env.get(nome)) || "").trim();
  } catch {
    return "";
  }
}

async function doCofre(nomes: string[], o: OpcoesDoCofre): Promise<Record<string, string>> {
  const base = (o.url ?? amb("SUPABASE_URL", o)).replace(/\/+$/, "");
  const sr = o.chaveDeServico ?? amb("SUPABASE_SERVICE_ROLE_KEY", o);
  if (!base || !sr) return {};
  const t = (AbortSignal as unknown as { timeout?: (n: number) => AbortSignal }).timeout;
  const r = await (o.fetch ?? fetch)(`${base}/rest/v1/rpc/chaves_do_cofre`, {
    method: "POST",
    headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _nomes: nomes }),
    signal: typeof t === "function" ? t.call(AbortSignal, 5000) : undefined,
  });
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`o cofre respondeu ${r.status}`);
  }
  const d = ((await r.json()) || {}) as Record<string, unknown>;
  const s: Record<string, string> = {};
  for (const k of Object.keys(d)) if (typeof d[k] === "string" && String(d[k]).trim()) s[k] = String(d[k]).trim();
  return s;
}

/** Busca de uma vez o que falta no ambiente e no cache. Nunca lança. */
export async function carregarChaves(nomes: readonly string[], o: OpcoesDoCofre = {}): Promise<void> {
  const agora = o.agora ? o.agora() : Date.now();
  const faltam = Array.from(new Set(nomes)).filter((n) => /^[A-Z][A-Z0-9_]{1,63}$/.test(n) && !amb(n, o) && !((cache.get(n)?.ate ?? 0) > agora));
  if (!faltam.length) return;
  try {
    const lidos = await doCofre(faltam, o);
    for (const n of faltam) cache.set(n, { valor: lidos[n] || "", ate: agora + (lidos[n] ? TTL_MS : TTL_VAZIO_MS) });
  } catch (e) {
    console.warn("chaves: cofre indisponível", { nomes: faltam, motivo: e instanceof Error ? e.message.slice(0, 120) : "erro" });
    for (const n of faltam) cache.set(n, { valor: cache.get(n)?.valor || "", ate: agora + TTL_FALHA_MS });
  }
}

/** A chave em uso: ambiente, depois o cofre. "" quando não há. */
export async function chave(nome: string, o: OpcoesDoCofre = {}): Promise<string> {
  if (amb(nome, o)) return amb(nome, o);
  await carregarChaves([nome], o);
  return cache.get(nome)?.valor || "";
}

/** Leitura síncrona depois de carregarChaves (o valor carregado vale até a próxima carga). */
export const chaveCarregada = (nome: string, o: OpcoesDoCofre = {}): string => amb(nome, o) || cache.get(nome)?.valor || "";

export const origemDaChave = (nome: string, o: OpcoesDoCofre = {}): "servidor" | "painel" | null =>
  amb(nome, o) ? "servidor" : cache.get(nome)?.valor ? "painel" : null;

export function esquecerChaves(nomes?: readonly string[]): void {
  if (!nomes) cache.clear();
  else nomes.forEach((n) => cache.delete(n));
}

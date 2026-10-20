/** API pública Kiwify, somente leitura. Nenhuma confirmação libera acesso nesta versão. */
export type Credenciais = {
  client_id: string;
  client_secret: string;
  account_id: string;
};
type Buscar = (url: string, init: RequestInit) => Promise<Response>;
const BASE = "https://public-api.kiwify.com/v1";
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function credenciais(v: Record<string, unknown>): Credenciais {
  for (const k of ["client_id", "client_secret", "account_id"])
    if (
      typeof v[k] !== "string" ||
      !String(v[k]).trim() ||
      String(v[k]).length > 1024 ||
      /[\r\n]/.test(String(v[k]))
    )
      throw Error("credenciais_invalidas");
  return {
    client_id: String(v.client_id).trim(),
    client_secret: String(v.client_secret).trim(),
    account_id: String(v.account_id).trim(),
  };
}
export async function conectar(c: Credenciais, buscar: Buscar) {
  const r = await buscar(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw Error("credenciais_recusadas");
  const t = objeto(await r.json());
  if (
    typeof t.access_token !== "string" ||
    t.token_type !== "Bearer" ||
    typeof t.scope !== "string" ||
    !t.scope.split(/\s+/).includes("sales") ||
    !t.scope.split(/\s+/).includes("stats")
  )
    throw Error("permissoes_insuficientes");
  const headers = {
    Authorization: `Bearer ${t.access_token}`,
    "x-kiwify-account-id": c.account_id,
    accept: "application/json",
  };
  const conta = await buscar(`${BASE}/account-details`, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!conta.ok) throw Error("conta_nao_confirmada");
  const a = objeto(await conta.json());
  if (a.id !== c.account_id) throw Error("conta_nao_confirmada");
  return {
    headers,
    nome:
      typeof a.company_name === "string"
        ? a.company_name.slice(0, 180)
        : "Conta Kiwify",
  };
}
export async function conferirVenda(
  pedido: string,
  headers: Record<string, string>,
  buscar: Buscar,
) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pedido)) throw Error("pedido_invalido");
  const r = await buscar(`${BASE}/sales/${encodeURIComponent(pedido)}`, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw Error("venda_nao_confirmada");
  const v = objeto(await r.json());
  const p = objeto(v.product);
  const c = objeto(v.customer);
  if (
    v.id !== pedido ||
    typeof p.id !== "string" ||
    !p.id ||
    typeof c.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) ||
    typeof v.status !== "string" ||
    !["paid", "refunded", "chargedback", "waiting_payment", "pending"].includes(
      v.status,
    )
  )
    throw Error("venda_nao_confirmada");
  return {
    pedido,
    produto: p.id,
    estado: v.status,
    email: c.email.trim().toLowerCase(),
  };
}

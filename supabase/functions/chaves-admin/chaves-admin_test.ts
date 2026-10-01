/**
 * Prova de ponta a ponta da função chaves-admin (frente CHV, 01/10/2026),
 * rodando a função de verdade no Deno com o Supabase e os provedores falsos.
 *
 *   npx --yes deno test --allow-env --allow-read supabase/functions/chaves-admin/chaves-admin_test.ts
 *
 * Prova: só admin passa; a chave enviada nunca volta em resposta nenhuma nem
 * vai para o console; a chave recusada pelo provedor só é gravada com
 * confirmar; o que vai para o banco é o segredo (para o Vault) e o resto sem
 * ele; remover pede confirmar.
 */

const CHAVE = "hg_CHAVE_SECRETA_DE_TESTE_0123456789";
const SERVICO = "service-role-de-teste";

Deno.env.set("SUPABASE_URL", "https://projeto-falso.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICO);
for (const n of ["HEYGEN_API_KEY", "FAL_KEY", "OPENROUTER_API_KEY"]) Deno.env.delete(n);

type Pedido = { url: string; metodo: string; corpo: string; cabecalhos: Record<string, string> };
const pedidos: Pedido[] = [];
const console_: string[] = [];
let papel: "admin" | "team" = "admin";
let heygenAceita = false;
const banco: { salvos: unknown[]; testes: unknown[]; removidos: unknown[] } = { salvos: [], testes: [], removidos: [] };

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  const cab: Record<string, string> = {};
  new Headers(init.headers || (entrada instanceof Request ? entrada.headers : undefined)).forEach((v, k) => (cab[k] = v));
  const corpo = typeof init.body === "string" ? init.body : "";
  pedidos.push({ url, metodo: String(init.method || "GET"), corpo, cabecalhos: cab });
  if (url.includes("/auth/v1/user")) return resposta(200, { id: "u-1", email: "almir@exemplo.com", aud: "authenticated", role: "authenticated" });
  if (url.includes("/rest/v1/rpc/has_role")) return resposta(200, papel === "admin");
  if (url.includes("/rest/v1/profiles")) return resposta(200, { full_name: "Almir" });
  if (url.includes("/rest/v1/rpc/chaves_admin_listar")) return resposta(200, { cofre: [], testes: [], gasto_mes: { heygen: 1.5 }, eventos: [] });
  if (url.includes("/rest/v1/rpc/chaves_admin_salvar")) {
    banco.salvos.push(JSON.parse(corpo));
    return resposta(200, { provedor: "heygen", nomes: ["HEYGEN_API_KEY"], trocada: false, estado: "invalida" });
  }
  if (url.includes("/rest/v1/rpc/chaves_admin_registrar_teste")) {
    banco.testes.push(JSON.parse(corpo));
    return resposta(200, {});
  }
  if (url.includes("/rest/v1/rpc/chaves_admin_remover")) {
    banco.removidos.push(JSON.parse(corpo));
    return resposta(200, { provedor: "heygen", nomes: ["HEYGEN_API_KEY"] });
  }
  if (url.includes("/rest/v1/rpc/chaves_do_cofre")) return resposta(200, {});
  if (url.startsWith("https://api.heygen.com/v3/users/me")) {
    // Provedor que ecoa a chave na recusa: ela não pode chegar à resposta.
    return heygenAceita ? resposta(200, { data: { billing_type: "wallet", wallet: { remaining_balance: 42.5 } } }) : resposta(401, { error: { message: `bad key ${CHAVE}` } });
  }
  return resposta(404, {});
}) as typeof fetch;

for (const m of ["log", "warn", "error", "info", "debug"] as const) {
  // deno-lint-ignore no-explicit-any
  (console as any)[m] = (...a: unknown[]) => console_.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
}

let atender: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, "serve", {
  configurable: true,
  writable: true,
  value: (h: (req: Request) => Promise<Response>) => {
    atender = h;
    return { finished: Promise.resolve(), shutdown: async () => {} };
  },
});
await import("./index.ts");

async function chamar(corpo: Record<string, unknown>) {
  const r = await atender!(new Request("http://local/chaves-admin", { method: "POST", headers: { Authorization: "Bearer token-de-sessao", "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
  return { status: r.status, texto: await r.text() };
}

function igual(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
function verdade(v: unknown, msg: string) {
  if (!v) throw new Error(msg);
}

Deno.test("quem não é admin recebe 403 e nada é lido nem gravado", async () => {
  papel = "team";
  const r = await chamar({ acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: CHAVE } });
  igual(r.status, 403, "status");
  verdade(r.texto.includes("somente_admin"), "código");
  verdade(!pedidos.some((p) => p.url.includes("heygen.com") || p.url.includes("chaves_admin_salvar")), "não testou nem gravou");
  papel = "admin";
});

Deno.test("listar devolve 14 linhas, sem segredo, com o gasto do mês", async () => {
  const r = await chamar({ acao: "listar" });
  igual(r.status, 200, "status");
  const q = JSON.parse(r.texto);
  igual(q.linhas.length, 14, "linhas");
  igual(q.linhas.find((l: { id: string }) => l.id === "heygen").mes_usd, 1.5, "gasto");
});

Deno.test("chave recusada: não grava sem confirmar; com confirmar grava; a chave nunca volta", async () => {
  heygenAceita = false;
  const a = await chamar({ acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: CHAVE } });
  igual(a.status, 200, "status");
  const ja = JSON.parse(a.texto);
  igual([ja.salva, ja.precisa_confirmar, ja.teste.estado], [false, true, "invalida"], "pede confirmar");
  igual(banco.salvos.length, 0, "nada gravado");
  const b = await chamar({ acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: CHAVE }, confirmar: true });
  igual(JSON.parse(b.texto).salva, true, "gravou");
  igual(banco.salvos.length, 1, "uma gravação");
  const gravado = banco.salvos[0] as { _valores: Record<string, string>; _teste: unknown; _ator_nome: string };
  igual(gravado._valores, { HEYGEN_API_KEY: CHAVE }, "o segredo vai só no _valores (para o Vault)");
  verdade(!JSON.stringify(gravado._teste).includes(CHAVE.slice(3, 15)), "o teste gravado não leva a chave");
  igual(gravado._ator_nome, "Almir", "quem trocou");
  for (const r of [a, b]) verdade(!r.texto.includes(CHAVE) && !r.texto.includes(CHAVE.slice(3, 15)), "resposta sem a chave");
});

Deno.test("chave aceita: testa antes, grava com o saldo e devolve só os 4 últimos", async () => {
  heygenAceita = true;
  const r = await chamar({ acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: CHAVE } });
  const j = JSON.parse(r.texto);
  igual([j.salva, j.teste.estado, j.teste.numeros.saldo_usd], [true, "valida", 42.5], "válida com saldo");
  const gravado = banco.salvos[banco.salvos.length - 1] as { _teste: { final_chave: string } };
  igual(gravado._teste.final_chave, CHAVE.slice(-4), "só o final");
  verdade(!r.texto.includes(CHAVE.slice(0, -4)), "resposta sem a chave");
  const pedidoAoProvedor = pedidos.filter((p) => p.url.startsWith("https://api.heygen.com"));
  verdade(pedidoAoProvedor.every((p) => p.metodo === "GET"), "teste só com GET");
});

Deno.test("remover pede confirmar", async () => {
  const sem = await chamar({ acao: "remover", provedor: "heygen" });
  igual(sem.status, 400, "sem confirmar");
  igual(banco.removidos.length, 0, "nada removido");
  const com = await chamar({ acao: "remover", provedor: "heygen", confirmar: true });
  igual(com.status, 200, "com confirmar");
  igual((banco.removidos[0] as { _ator_nome: string })._ator_nome, "Almir", "quem removeu");
});

Deno.test("campo de outro provedor e chave com espaço são recusados", async () => {
  const outro = await chamar({ acao: "salvar", provedor: "heygen", valores: { FAL_KEY: "fal-chave-qualquer" } });
  igual(outro.status, 400, "campo de outro provedor");
  const espaco = await chamar({ acao: "salvar", provedor: "heygen", valores: { HEYGEN_API_KEY: "abc def ghi jkl" } });
  igual(espaco.status, 400, "espaço no meio");
});

Deno.test("nada do console leva a chave nem a chave de serviço", () => {
  const tudo = console_.join("\n");
  verdade(!tudo.includes(CHAVE) && !tudo.includes(CHAVE.slice(3, 15)), "console sem a chave");
  verdade(!tudo.includes(SERVICO), "console sem a chave de serviço");
});

import { conectar, conferirVenda, credenciais } from "./cliente.ts";
const c = {
  client_id: "id-sintetico",
  client_secret: "segredo-sintetico-sem-valor",
  account_id: "conta-sintetica",
};
function afirmar(v: unknown) {
  if (!v) throw Error("Verificação falhou");
}
async function recusa(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw Error("Deveria recusar");
}
const resposta = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
Deno.test(
  "OAuth usa formulário e lê a conta correta, sem expor segredo no retorno",
  async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const r = await conectar(c, async (url, init) => {
      pedidos.push({ url, init });
      return pedidos.length === 1
        ? resposta({
            access_token: "token-sintetico",
            token_type: "Bearer",
            scope: "stats sales",
          })
        : resposta({ id: c.account_id, company_name: "Empresa de teste" });
    });
    afirmar(pedidos[0].url.endsWith("/oauth/token"));
    afirmar(pedidos[0].init.body instanceof URLSearchParams);
    afirmar(pedidos[1].url.endsWith("/account-details"));
    afirmar(
      (pedidos[1].init.headers as Record<string, string>)[
        "x-kiwify-account-id"
      ] === c.account_id,
    );
    afirmar(!JSON.stringify(r).includes(c.client_secret));
  },
);
Deno.test(
  "conexão não aceita conta divergente nem credencial sem leitura de vendas",
  async () => {
    await recusa(() =>
      conectar(c, async (url) =>
        url.endsWith("/oauth/token")
          ? resposta({
              access_token: "t",
              token_type: "Bearer",
              scope: "stats sales",
            })
          : resposta({ id: "outra-conta" }),
      ),
    );
    await recusa(() =>
      conectar(c, async () =>
        resposta({ access_token: "t", token_type: "Bearer", scope: "stats" }),
      ),
    );
  },
);
Deno.test(
  "venda exige pedido, produto, estado reconhecido e comprador válidos",
  async () => {
    const r = await conferirVenda("pedido-teste", {}, async () =>
      resposta({
        id: "pedido-teste",
        product: { id: "produto-teste" },
        customer: { email: " PESSOA@example.invalid ".trim() },
        status: "paid",
      }),
    );
    afirmar(r.estado === "paid" && r.email === "pessoa@example.invalid");
    await recusa(() =>
      conferirVenda("pedido-teste", {}, async () =>
        resposta({
          id: "outro",
          product: { id: "p" },
          customer: { email: "a@b.invalid" },
          status: "paid",
        }),
      ),
    );
    await recusa(() =>
      conferirVenda("pedido-teste", {}, async () =>
        resposta({
          id: "pedido-teste",
          product: { id: "p" },
          customer: { email: "a@b.invalid" },
          status: "parcial",
        }),
      ),
    );
  },
);
Deno.test(
  "não monta URL com identificador arbitrário e rejeita cabeçalho injetado",
  async () => {
    let chamado = false;
    await recusa(() =>
      conferirVenda("../account", {}, async () => {
        chamado = true;
        return resposta({});
      }),
    );
    afirmar(!chamado);
    let negou = false;
    try {
      credenciais({ ...c, account_id: "id\r\nOutro: valor" });
    } catch {
      negou = true;
    }
    afirmar(negou);
  },
);

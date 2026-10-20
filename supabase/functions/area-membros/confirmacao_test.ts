import { autorizaDownload, confirmarAsaas } from "./confirmacao.ts";
function assert(v: unknown, msg = "Falhou") {
  if (!v) throw new Error(msg);
}
const response = (v: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(v), { status }));
Deno.test(
  "Asaas confere pagamento e comprador por GET antes de liberar",
  async () => {
    const chamadas: string[] = [];
    const c = await confirmarAsaas(
      "pay_teste",
      "credencial-sintetica",
      async (url, init) => {
        assert(init.method === "GET");
        chamadas.push(url);
        return url.includes("/payments/")
          ? response({
              id: "pay_teste",
              customer: "cus_teste",
              status: "RECEIVED",
              externalReference: "produto-teste",
            })
          : response({ id: "cus_teste", email: "PESSOA@example.invalid" });
      },
    );
    assert(
      c.estado === "pago" &&
        c.email === "pessoa@example.invalid" &&
        chamadas.length === 2,
    );
  },
);
Deno.test("Asaas não confunde autorização com pagamento recebido", async () => {
  let negou = false;
  try {
    await confirmarAsaas("pay_teste", "credencial-sintetica", () =>
      response({
        id: "pay_teste",
        customer: "cus_teste",
        status: "AUTHORIZED",
        externalReference: "p",
      }),
    );
  } catch {
    negou = true;
  }
  assert(negou);
});
Deno.test("Asaas recusa identidade de comprador divergente", async () => {
  let negou = false;
  try {
    await confirmarAsaas("pay_teste", "credencial-sintetica", (url) =>
      url.includes("/payments/")
        ? response({
            id: "pay_teste",
            customer: "cus_teste",
            status: "RECEIVED",
            externalReference: "p",
          })
        : response({ id: "cus_outra", email: "outra@example.invalid" }),
    );
  } catch {
    negou = true;
  }
  assert(negou);
});
Deno.test("Asaas não usa identificador como endereço arbitrário", async () => {
  let chamado = false,
    negou = false;
  try {
    await confirmarAsaas("https://interno/", "credencial-sintetica", () => {
      chamado = true;
      return response({});
    });
  } catch {
    negou = true;
  }
  assert(negou && !chamado);
});
Deno.test("Asaas mantém pendente e distingue reembolso", async () => {
  for (const [status, estado] of [
    ["PENDING", "pendente"],
    ["REFUNDED", "reembolsado"],
    ["CHARGEBACK_REQUESTED", "contestado"],
  ]) {
    const c = await confirmarAsaas(
      "pay_teste",
      "credencial-sintetica",
      (url) =>
        url.includes("/payments/")
          ? response({
              id: "pay_teste",
              customer: "cus_teste",
              status,
              externalReference: "p",
            })
          : response({ id: "cus_teste", email: "pessoa@example.invalid" }),
    );
    assert(c.estado === estado);
  }
});
Deno.test("Asaas sem configuração não consulta nem concede", async () => {
  let chamado = false,
    negou = false;
  try {
    await confirmarAsaas("pay_teste", "", () => {
      chamado = true;
      return response({});
    });
  } catch {
    negou = true;
  }
  assert(negou && !chamado);
});
Deno.test("API de arquivo recusa download quando não permitido", () => {
  assert(!autorizaDownload(false, true));
  assert(autorizaDownload(false, false));
  assert(autorizaDownload(true, true));
});

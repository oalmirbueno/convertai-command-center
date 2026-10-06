import { gerarVideo, type BaseDaFuncao } from "./geracao.ts";

for (const [nome, id, codigo] of [
  ["UUID inválido", "invalido", "criativo_invalido"],
  ["criativo de outro cliente ou inexistente", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "criativo_inexistente"],
]) {
  Deno.test(`Ads: recusa ${nome} antes de chamar o provedor`, async () => {
    const consultas: unknown[] = [];
    const builder = {
      select: () => builder,
      eq: (campo: string, valor: unknown) => { consultas.push([campo, valor]); return builder; },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    let autorizado = false;
    const b: BaseDaFuncao = {
      garantirAcesso: async (cliente) => { if (cliente !== "cliente-autorizado") throw new Error("cliente errado"); autorizado = true; },
      servico: () => ({ from: (tabela: string) => { if (!autorizado || tabela !== "ads_criativos") throw new Error("acesso inesperado"); return builder; } }) as unknown as ReturnType<BaseDaFuncao["servico"]>,
      erro: (_status, code) => new Error(code),
      json: () => { throw new Error("não deve gerar"); },
      auditar: async () => { throw new Error("não deve gerar"); },
      userId: "usuario", admin: false,
    };
    let recebido = "";
    try { await gerarVideo(b, { client_id: "cliente-autorizado", ads_criativo_id: id, motor: "higgsfield-cinema-4" }); }
    catch (e) { recebido = (e as Error).message; }
    if (recebido !== codigo) throw new Error(`Esperado ${codigo}; recebido ${recebido}`);
    if (codigo === "criativo_inexistente" && !consultas.some((q) => JSON.stringify(q) === '["client_id","cliente-autorizado"]')) throw new Error("faltou isolamento por cliente");
  });
}

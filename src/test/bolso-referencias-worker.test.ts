// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as regras from "../../supabase/functions/bolso/regras";

const js = transpileModule(readFileSync(resolve(__dirname, "../../supabase/functions/bolso/index.ts"), "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
const apiJs = transpileModule(readFileSync(resolve(__dirname, "../lib/bolso/api.ts"), "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
const U = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const J = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";
const A = "55555555-5555-4555-8555-555555555555";
const BYTES = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==", "base64"));
const REF = { id: R, user_id: U, campanha_id: C, caminho: `${U}/${C}/referencias/${R}.png`, nome: "produto.png", mime: "image/png", bytes: BYTES.length, confirmada_em: "2026-10-27", removida_em: null };
const ARTE = { id: A, user_id: U, campanha_id: C, caminho: `${U}/${C}/${A}.png` };

function worker(opcoes: { referencia?: Record<string, unknown>; imagemInvalida?: boolean; ajuste?: boolean; originalDeOutro?: boolean; erroRegistro?: { code: string; message: string; details?: string } } = {}) {
  const ref = { ...REF, ...opcoes.referencia };
  const consultas: { tabela: string; filtros: [string, string, unknown][]; patch?: Record<string, unknown> }[] = [];
  const imagem = vi.fn(async () => ({ ok: true, bytes: BYTES }));
  const storage = {
    download: vi.fn(async (_caminho: string) => ({ data: new Blob([opcoes.imagemInvalida ? new Uint8Array([1, 2, 3]) : BYTES]), error: null })),
    createSignedUrl: vi.fn(async (caminho: string) => ({ data: { signedUrl: `https://storage.example.invalid/${caminho}?token=isolado` }, error: null })),
    createSignedUploadUrl: vi.fn(async () => ({ data: { token: "upload-apenas-este-arquivo" }, error: null })),
    upload: vi.fn(async () => ({ error: null })),
  };
  let pegou = false;
  const rpc = vi.fn(async (nome: string, args?: Record<string, unknown>) => {
    if (nome === "bolso_trabalho_pegar") {
      if (pegou) return { data: null, error: null };
      pegou = true;
      return { data: {
        job: { id: J, user_id: U, campanha_id: C, tipo: "imagem", formato: "feed_1x1", provedor: "openrouter", tentativa: 1,
          natureza: opcoes.ajuste ? "ajuste" : "imagem", entrada: { referencias: [R], ...(opcoes.ajuste ? { ajuste: "Fundo claro", arte_origem: A } : {}) } },
        marca: { nome: "Doceria" }, briefing: { tipo: "venda", produto: "Bolo" }, versao: { mensagem: "Seu bolo", texto: "Peça seu bolo", cta: "Peça pelo WhatsApp" },
      }, error: null };
    }
    if (nome === "bolso_trabalho_falhar") return { data: { estado: "falhou" }, error: null };
    if (nome === "bolso_trabalho_concluir") return { data: { estado: "concluido" }, error: null };
    throw new Error(`RPC inesperada ${nome}: ${Object.keys(args || {}).join(",")}`);
  });
  const from = (tabela: string) => {
    const consulta: typeof consultas[number] = { tabela, filtros: [] };
    consultas.push(consulta);
    const linhas = tabela === "bolso_referencias" ? [ref] : [{ ...ARTE, ...(opcoes.originalDeOutro ? { user_id: "outro-dono" } : {}) }];
    const resultado = () => linhas.filter((r) => consulta.filtros.every(([op, campo, v]) => {
      const atual = (r as Record<string, unknown>)[campo];
      return op === "in" ? (v as unknown[]).includes(atual) : op === "not" ? atual !== v : atual === v;
    }));
    const query: Record<string, unknown> = {
      select: () => query,
      update: (patch: Record<string, unknown>) => { consulta.patch = patch; return query; },
      eq: (campo: string, v: unknown) => { consulta.filtros.push(["eq", campo, v]); return query; },
      is: (campo: string, v: unknown) => { consulta.filtros.push(["is", campo, v]); return query; },
      not: (campo: string, _op: string, v: unknown) => { consulta.filtros.push(["not", campo, v]); return query; },
      in: (campo: string, v: unknown[]) => { consulta.filtros.push(["in", campo, v]); return query; },
      maybeSingle: async () => ({ data: resultado()[0] || null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: resultado(), error: null }).then(ok),
    };
    return query;
  };
  const usuarioRpc = vi.fn(async (nome: string) => ({ data: nome === "bolso_referencia_registrar" ? ref : true, error: nome === "bolso_referencia_registrar" ? opcoes.erroRegistro || null : null }));
  const usuario = { auth: { getUser: async () => ({ data: { user: { id: U } }, error: null }) }, rpc: usuarioRpc };
  const deps: Record<string, unknown> = {
    "npm:@supabase/supabase-js@2": { createClient: (_url: string, chave: string) => chave === "anon" ? usuario : { rpc, from, storage: { from: () => storage } } },
    "../_shared/chaves.ts": { chave: async () => undefined },
    "./provedores.ts": { configuracaoOpenrouterDoServidor: async () => ({}), openrouter: () => ({ imagem }) },
    "./regras.ts": regras,
  };
  let handler!: (req: Request) => Promise<Response>;
  new Function("exports", "require", "Deno", js)({}, (nome: string) => {
    if (!(nome in deps)) throw new Error(`Dependência inesperada: ${nome}`);
    return deps[nome];
  }, { env: { get: (nome: string) => nome === "SUPABASE_ANON_KEY" ? "anon" : "isolado" }, serve: (h: typeof handler) => { handler = h; } });
  const chamar = (body: Record<string, unknown>) => handler(new Request("https://isolado.invalid/bolso", { method: "POST", headers: { authorization: "Bearer sessao-isolada" }, body: JSON.stringify(body) }));
  return { chamar, storage, imagem, rpc, consultas, usuarioRpc };
}

describe("worker de referências privadas", () => {
  it.each([
    ["Há envios em andamento. Envios interrompidos liberam espaço após 15 minutos.", "referencias_pendentes", /aguarde 15 minutos/i],
    ["Use até três referências por campanha", "limite_referencias", /Remova uma delas/i],
  ])("limite conhecido chega à interface com orientação segura: %s", async (message, codigo, orientacao) => {
    const w = worker({ erroRegistro: { code: "53400", message: String(message), details: "SQL privado que não deve sair" } });
    const response = await w.chamar({ acao: "preparar_referencia", campanha_id: C, nome: "produto.png", mime: "image/png", bytes: BYTES.length });
    expect(response.status).toBe(409);
    expect(await response.clone().json()).toEqual({ erro: codigo });
    expect(w.storage.createSignedUploadUrl).not.toHaveBeenCalled();
    const api: { enviarReferencia?: (campanha: string, arquivo: File) => Promise<unknown>; erroDoBolso?: (erro: unknown) => string } = {};
    const upload = vi.fn();
    new Function("exports", "require", apiJs)(api, () => ({ supabase: {
      functions: { invoke: async () => ({ data: null, error: { message: "Edge function returned a non-2xx status code", context: response } }) },
      storage: { from: () => ({ uploadToSignedUrl: upload }) },
    } }));
    const erro = await api.enviarReferencia!(C, new File([BYTES], "produto.png", { type: "image/png" })).catch((e: unknown) => e);
    expect(api.erroDoBolso!(erro)).toMatch(orientacao as RegExp);
    expect(api.erroDoBolso!(erro)).not.toMatch(/SQL|privado|Edge function/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("erro desconhecido com o mesmo código SQL continua genérico", async () => {
    const w = worker({ erroRegistro: { code: "53400", message: "Erro interno com dados privados", details: "Tabela interna" } });
    const response = await w.chamar({ acao: "preparar_referencia", campanha_id: C, nome: "produto.png", mime: "image/png", bytes: BYTES.length });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ erro: "referencia_nao_permitida" });
    expect(w.storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it.each([{ user_id: "outra-conta" }, { campanha_id: "outra-campanha" }, { removida_em: "2026-10-27" }, { confirmada_em: null }])("não gera nem assina referência fora do contrato: %j", async (referencia) => {
    const w = worker({ referencia });
    expect(await (await w.chamar({ acao: "processar_fila" })).json()).toEqual({ processados: [{ job_id: J, estado: "falhou" }] });
    expect(w.imagem).not.toHaveBeenCalled();
    expect(w.storage.createSignedUrl).not.toHaveBeenCalled();
    expect(w.rpc.mock.calls.find(([nome]) => nome === "bolso_trabalho_falhar")?.[1]).toMatchObject({ _definitiva: true });
  });

  it("valida bytes antes do fornecedor e usa só URLs assinadas de 180 segundos", async () => {
    const w = worker();
    expect(await (await w.chamar({ acao: "processar_fila" })).json()).toEqual({ processados: [{ job_id: J, estado: "concluido" }] });
    expect(w.storage.download).toHaveBeenCalledWith(REF.caminho);
    expect(w.storage.createSignedUrl).toHaveBeenCalledWith(REF.caminho, 180);
    expect(w.imagem).toHaveBeenCalledWith(expect.objectContaining({ referencias: [`https://storage.example.invalid/${REF.caminho}?token=isolado`] }));
    expect(w.rpc.mock.calls.map(([nome]) => nome)).toEqual(["bolso_trabalho_pegar", "bolso_trabalho_concluir", "bolso_trabalho_pegar"]);
  });

  it("arquivo inválido falha antes de gerar ou assinar referência", async () => {
    const w = worker({ imagemInvalida: true });
    await w.chamar({ acao: "processar_fila" });
    expect(w.imagem).not.toHaveBeenCalled();
    expect(w.storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("ajuste carrega primeiro a arte original do dono e depois a referência de produto", async () => {
    const w = worker({ ajuste: true });
    await w.chamar({ acao: "processar_fila" });
    expect(w.storage.download.mock.calls.map(([caminho]) => caminho)).toEqual([ARTE.caminho, REF.caminho]);
    expect(w.imagem).toHaveBeenCalledTimes(1);
    const outro = worker({ ajuste: true, originalDeOutro: true });
    await outro.chamar({ acao: "processar_fila" });
    expect(outro.imagem).not.toHaveBeenCalled();
  });

  it("só confirma o upload depois de conferir dono, tamanho e MIME real", async () => {
    const w = worker({ referencia: { confirmada_em: null } });
    const res = await w.chamar({ acao: "confirmar_referencia", referencia_id: R });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmada: true });
    expect(w.consultas.find((c) => c.patch)?.patch?.confirmada_em).toEqual(expect.any(String));
    const invalido = worker({ imagemInvalida: true });
    expect((await invalido.chamar({ acao: "confirmar_referencia", referencia_id: R })).status).toBe(400);
    expect(invalido.consultas.some((c) => c.patch)).toBe(false);
    const outro = worker({ referencia: { user_id: "outra-conta" } });
    expect((await outro.chamar({ acao: "confirmar_referencia", referencia_id: R })).status).toBe(404);
    expect(outro.storage.download).not.toHaveBeenCalled();
  });

  it("não assina upload para caminho que não pertence ao dono e campanha autenticados", async () => {
    const w = worker({ referencia: { caminho: `outro/${C}/referencias/${R}.png` } });
    expect((await w.chamar({ acao: "preparar_referencia", campanha_id: C, nome: "produto.png", mime: "image/png", bytes: BYTES.length })).status).toBe(403);
    expect(w.storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

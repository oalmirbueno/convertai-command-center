// @vitest-environment node
// Contrato pago com fetch isolado: esta suíte nunca chama a OpenAI nem lê o ambiente real.
import { describe, expect, it, vi } from "vitest";
import { configuracaoOpenaiDoServidor, custoEstimadoPeloUso, openai, type Contexto } from "../../supabase/functions/bolso/provedores";
import { mimeReal, openaiPronta } from "../../supabase/functions/bolso/regras";

const CONFIG = { habilitado: "sim", chave: "credencial-de-teste", modeloTexto: "gpt-4.1-mini", modeloImagem: "gpt-image-2" };
const CONTEXTO: Contexto = {
  marca: { nome: "Doceria A", cores: ["#113355"], tom: "acolhedor" },
  briefing: { tipo: "venda", produto: "Bolo de pote", cta: "Peça no direct", condicoes: "" },
  versao: { mensagem: "Uma pausa mais doce.", texto: "Legenda preservada fora da arte.", cta: "Peça no direct", direcao_visual: "Um bolo de pote sobre a mesa." },
  formato: "feed_1x1",
};
const COPY = { mensagem: "Uma pausa mais doce.", texto: "Escolha seu bolo de pote e peça no direct.", cta: "Peça no direct", aplicacao: "Instagram", direcao_visual: "Um bolo de pote sobre a mesa." };
const USO_TEXTO = { prompt_tokens: 2000, completion_tokens: 1200, prompt_tokens_details: { cached_tokens: 500 } };
const USO_IMAGEM = { input_tokens: 2000, input_tokens_details: { text_tokens: 2000, image_tokens: 0 }, output_tokens: 1760 };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const texto = (usage: unknown = USO_TEXTO) => Response.json({ choices: [{ message: { content: JSON.stringify(COPY) } }], usage });
const imagem = (usage: unknown = USO_IMAGEM) => Response.json({ data: [{ b64_json: PNG }], usage });

describe("credencial server-side com gate dedicado", () => {
  it("não lê credenciais nem chama o fornecedor quando só a chave compartilhada existe", async () => {
    const dados: Record<string, string> = { OPENAI_API_KEY: "chave-compartilhada" };
    const ler = vi.fn((nome: string) => dados[nome]);
    const config = configuracaoOpenaiDoServidor(ler);
    const buscar = vi.fn<typeof fetch>();
    expect(openaiPronta(config).ok).toBe(false);
    expect(await openai(config, buscar).texto(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
    expect(await openai(config, buscar).imagem(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
    expect(ler.mock.calls.flat()).not.toContain("OPENAI_API_KEY");
    expect(ler.mock.calls.flat()).not.toContain("BOLSO_OPENAI_API_KEY");
    expect(buscar).not.toHaveBeenCalled();
  });

  it("prefere a dedicada e só consulta OPENAI_API_KEY se a dedicada estiver vazia", () => {
    const dados: Record<string, string> = { BOLSO_OPENAI_HABILITADO: "sim", BOLSO_OPENAI_MODELO_TEXTO: "gpt-4.1-mini", BOLSO_OPENAI_MODELO_IMAGEM: "gpt-image-2", BOLSO_OPENAI_API_KEY: " dedicada ", OPENAI_API_KEY: " compartilhada " };
    const ler = vi.fn((nome: string) => dados[nome]);
    expect(configuracaoOpenaiDoServidor(ler).chave).toBe("dedicada");
    expect(ler.mock.calls.flat()).not.toContain("OPENAI_API_KEY");
    dados.BOLSO_OPENAI_API_KEY = " ";
    ler.mockClear();
    expect(configuracaoOpenaiDoServidor(ler).chave).toBe("compartilhada");
    expect(ler.mock.calls.flat()).toEqual(["BOLSO_OPENAI_HABILITADO", "BOLSO_OPENAI_MODELO_TEXTO", "BOLSO_OPENAI_MODELO_IMAGEM", "BOLSO_OPENAI_API_KEY", "OPENAI_API_KEY"]);
  });

  it("recusa modelo encerrado, modelos arbitrários e chave vazia sem gastar", async () => {
    const buscar = vi.fn<typeof fetch>();
    for (const config of [{ ...CONFIG, modeloImagem: "gpt-image-1" }, { ...CONFIG, modeloImagem: "modelo-do-cliente" }, { ...CONFIG, modeloTexto: "outro" }, { ...CONFIG, chave: " " }]) {
      expect((await openai(config, buscar).imagem(CONTEXTO)).ok).toBe(false);
      expect((await openai(config, buscar).texto(CONTEXTO)).ok).toBe(false);
    }
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("contrato das chamadas OpenAI do Bolso", () => {
  it("gera uma imagem com tamanho e qualidade explícitos, texto exato e uso medido", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(imagem());
    const r = await openai(CONFIG, buscar).imagem(CONTEXTO);
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: "gpt-image-2", size: "1024x1024", quality: "medium", n: 1, output_format: "png", background: "opaque" });
    expect(body.response_format).toBeUndefined();
    expect(body.prompt).toContain("DIREÇÃO CRIATIVA DA CAMPANHA");
    expect(JSON.parse(body.prompt.split("\n").at(-1)).textos_exatos).toEqual({ headline: CONTEXTO.versao!.mensagem, cta: CONTEXTO.versao!.cta });
    expect(body.prompt).not.toContain(CONTEXTO.versao!.texto);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("Esperava imagem");
    expect(mimeReal(r.bytes)).toBe("image/png");
    expect(r.custo).toEqual({ modelo: "gpt-image-2", custo_usd: 0.0628 });
  });

  it("mantém texto JSON, máximo 1200 tokens, valida os 5 campos e contabiliza cache declarado", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(texto());
    const r = await openai(CONFIG, buscar).texto(CONTEXTO);
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: "gpt-4.1-mini", max_tokens: 1200, response_format: { type: "json_object" } });
    expect(r).toEqual({ ok: true, conteudo: COPY, custo: { modelo: "gpt-4.1-mini", custo_usd: 0.00257 } });
  });

  it("uso ausente não inventa custo zero nem perde uma entrega válida", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValueOnce(texto(null)).mockResolvedValueOnce(imagem(null));
    const p = openai(CONFIG, buscar);
    for (const r of [await p.texto(CONTEXTO), await p.imagem(CONTEXTO)]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.custo).toBeUndefined();
    }
  });

  it.each([400, 401, 429, 500])("erro %s mantém classificação e não devolve corpo sensível nem repete", async (status) => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("detalhe com credencial-de-teste e prompt privado", { status })));
    const p = openai(CONFIG, buscar);
    for (const r of [await p.texto(CONTEXTO), await p.imagem(CONTEXTO)]) {
      expect(r).toMatchObject({ ok: false, definitiva: status !== 429 && status < 500 });
      expect(JSON.stringify(r)).not.toMatch(/credencial-de-teste|prompt privado/);
    }
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("rede ou timeout fica incerto, sem tentativa automática", async () => {
    const buscar = vi.fn<typeof fetch>().mockRejectedValue(new Error("credencial-de-teste"));
    const r = await openai(CONFIG, buscar).imagem(CONTEXTO);
    expect(r).toEqual({ ok: false, definitiva: false, incerto: true, motivo: "Sem resposta do fornecedor de imagem." });
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});

describe("estimativa pelo uso retornado", () => {
  it("conta imagem e texto de entrada sem desconto de cache na Images API direta", () => {
    const uso = { input_tokens: 2200, input_tokens_details: { text_tokens: 2000, image_tokens: 200, cached_tokens: 200 }, output_tokens: 1770, output_tokens_details: { image_tokens: 1760, text_tokens: 10 } };
    expect(custoEstimadoPeloUso("imagem", "gpt-image-2", uso)).toEqual({ modelo: "gpt-image-2", custo_usd: 0.0644 });
    expect(custoEstimadoPeloUso("texto", "gpt-4.1-mini", { prompt_tokens: 2000, completion_tokens: 1200 })).toEqual({ modelo: "gpt-4.1-mini", custo_usd: 0.00272 });
  });

  it("recusa metadados ausentes, negativos, fracionários, não finitos ou incoerentes", () => {
    for (const uso of [null, {}, { ...USO_IMAGEM, input_tokens: 2001 }, { ...USO_IMAGEM, output_tokens: -1 }, { ...USO_IMAGEM, output_tokens: 0.5 }, { ...USO_IMAGEM, output_tokens: Infinity }, { ...USO_IMAGEM, output_tokens: Number.MAX_SAFE_INTEGER }, { ...USO_IMAGEM, output_tokens_details: { image_tokens: 1760, text_tokens: 3 } }]) {
      expect(custoEstimadoPeloUso("imagem", "gpt-image-2", uso)).toBeUndefined();
    }
    expect(custoEstimadoPeloUso("texto", "gpt-4.1-mini", { ...USO_TEXTO, prompt_tokens_details: { cached_tokens: 2001 } })).toBeUndefined();
    expect(custoEstimadoPeloUso("imagem", "gpt-image-1", USO_IMAGEM)).toBeUndefined();
  });
});

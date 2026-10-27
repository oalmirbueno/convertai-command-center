// @vitest-environment node
// Transporte e contratos isolados: nenhuma chamada real, credencial ou carteira Mesa.
import { describe, expect, it, vi } from "vitest";
import { configuracaoOpenrouterDoServidor, custoInformadoOpenrouter, openrouter, type Contexto } from "../../supabase/functions/bolso/provedores";
import { mimeReal, openrouterPronto, type Formato } from "../../supabase/functions/bolso/regras";

const CONFIG = { habilitado: "sim", chave: "dedicada-de-teste", modeloTexto: "openai/gpt-4.1-mini", modeloImagem: "google/gemini-3.1-flash-image" };
const COPY = { mensagem: "Uma pausa mais doce.", texto: "Escolha seu bolo de pote e peça no direct.", cta: "Peça no direct", aplicacao: "Instagram", direcao_visual: "Um bolo de pote sobre a mesa." };
const CONTEXTO: Contexto = {
  marca: { nome: "Doceria A", cores: ["#113355"], tom: "acolhedor" },
  briefing: { tipo: "venda", produto: "Bolo de pote", cta: "Peça no direct", condicoes: "" },
  versao: COPY, formato: "feed_1x1",
};
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const texto = (usage: unknown = { cost: 0.001234567 }) => Response.json({ choices: [{ message: { content: JSON.stringify(COPY) } }], usage });
const imagem = (usage: unknown = { cost: 0.065 }) => Response.json({ data: [{ b64_json: PNG }], usage });

describe("OpenRouter exclusivo do servidor e ativação explícita", () => {
  it("gate desligado não lê chaves nem consulta o cofre ou fornecedor", async () => {
    const dados: Record<string, string> = { OPENROUTER_API_KEY: "empresarial", BOLSO_OPENROUTER_USAR_CHAVE_EMPRESA: "sim" };
    const ler = vi.fn((nome: string) => dados[nome]);
    const cofre = vi.fn(async () => "do-cofre");
    const config = await configuracaoOpenrouterDoServidor(ler, cofre);
    const buscar = vi.fn<typeof fetch>();
    expect(openrouterPronto(config).ok).toBe(false);
    expect(await openrouter(config, buscar).texto(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
    expect(await openrouter(config, buscar).imagem(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
    expect(ler.mock.calls.flat()).not.toContain("OPENROUTER_API_KEY");
    expect(ler.mock.calls.flat()).not.toContain("BOLSO_OPENROUTER_API_KEY");
    expect(cofre).not.toHaveBeenCalled();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("prefere dedicada e não faz fallback empresarial sem a opção explícita", async () => {
    const dados: Record<string, string> = { BOLSO_OPENROUTER_HABILITADO: "sim", BOLSO_OPENROUTER_API_KEY: " dedicada ", OPENROUTER_API_KEY: "empresarial" };
    const ler = vi.fn((nome: string) => dados[nome]);
    const cofre = vi.fn(async () => "cofre");
    expect((await configuracaoOpenrouterDoServidor(ler, cofre)).chave).toBe("dedicada");
    dados.BOLSO_OPENROUTER_API_KEY = " ";
    ler.mockClear();
    expect((await configuracaoOpenrouterDoServidor(ler, cofre)).chave).toBe("");
    expect(ler.mock.calls.flat()).not.toContain("OPENROUTER_API_KEY");
    expect(cofre).not.toHaveBeenCalled();
  });

  it("empresa autorizada lê primeiro o ambiente e depois o cofre se necessário", async () => {
    const dados: Record<string, string> = { BOLSO_OPENROUTER_HABILITADO: "sim", BOLSO_OPENROUTER_USAR_CHAVE_EMPRESA: "sim", OPENROUTER_API_KEY: " empresarial " };
    const cofre = vi.fn(async () => " cofre ");
    expect((await configuracaoOpenrouterDoServidor((n) => dados[n], cofre)).chave).toBe("empresarial");
    expect(cofre).not.toHaveBeenCalled();
    delete dados.OPENROUTER_API_KEY;
    expect((await configuracaoOpenrouterDoServidor((n) => dados[n], cofre)).chave).toBe("cofre");
    expect(cofre).toHaveBeenCalledTimes(1);
    dados.BOLSO_OPENROUTER_API_KEY = "dedicada";
    expect((await configuracaoOpenrouterDoServidor((n) => dados[n], cofre)).chave).toBe("dedicada");
    expect(cofre).toHaveBeenCalledTimes(1);
  });

  it("exige os dois modelos aprovados e não aceita modelo do navegador", async () => {
    const buscar = vi.fn<typeof fetch>();
    for (const config of [
      { ...CONFIG, chave: " " }, { ...CONFIG, modeloTexto: undefined }, { ...CONFIG, modeloImagem: undefined },
      { ...CONFIG, modeloTexto: "openai/modelo-arbitrario" }, { ...CONFIG, modeloImagem: "https://outro.invalid" },
    ]) {
      expect(openrouterPronto(config).ok).toBe(false);
      expect(await openrouter(config, buscar).texto(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
      expect(await openrouter(config, buscar).imagem(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
    }
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("texto e imagem OpenRouter do Bolso", () => {
  it("solicita texto JSON com contexto do próprio membro e registra o custo comunicado", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(texto());
    const r = await openrouter(CONFIG, buscar).texto(CONTEXTO);
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: CONFIG.modeloTexto, stream: false, max_tokens: 1200, response_format: { type: "json_object" } });
    expect(body.messages[0].content).toContain("CAMPANHA ANTES DA ARTE");
    expect(body.messages[1].content).toContain(CONTEXTO.marca.nome);
    expect(r).toEqual({ ok: true, conteudo: COPY, custo: { modelo: CONFIG.modeloTexto, custo_usd: 0.001235 } });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it.each<[Formato, string]>([["feed_1x1", "1:1"], ["feed_4x5", "4:5"], ["stories_9x16", "9:16"]])("preserva a proporção %s em uma imagem 1K", async (formato, ratio) => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(imagem());
    const r = await openrouter(CONFIG, buscar).imagem({ ...CONTEXTO, formato });
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: CONFIG.modeloImagem, resolution: "1K", aspect_ratio: ratio, n: 1 });
    expect(JSON.parse(body.prompt.split("\n").at(-1)).textos_exatos).toEqual({ headline: COPY.mensagem, cta: COPY.cta });
    expect(body.prompt).not.toContain(COPY.texto);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("Esperava imagem");
    expect(mimeReal(r.bytes)).toBe("image/png");
    expect(r.custo).toEqual({ modelo: CONFIG.modeloImagem, custo_usd: 0.065 });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("não inventa custo a partir de tokens, nem transforma metadado ausente em zero", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValueOnce(texto({ prompt_tokens: 100, completion_tokens: 50 })).mockResolvedValueOnce(imagem(null));
    const p = openrouter(CONFIG, buscar);
    for (const r of [await p.texto(CONTEXTO), await p.imagem(CONTEXTO)]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.custo).toBeUndefined();
    }
  });

  it.each([
    { data: [{ url: "https://arquivo-privado.invalid/imagem.png" }] },
    { data: [{ b64_json: "data:image/png;base64," + PNG }] },
    { data: [{ b64_json: btoa("conteudo que nao e imagem") }] },
    { data: [{ b64_json: "!!!!" }] },
    { data: [] },
  ])("rejeita imagem inválida sem buscar URLs arbitrárias", async (payload) => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    expect(await openrouter(CONFIG, buscar).imagem(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("recusa imagem maior que 10 MB antes da conversão", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: "A".repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 4) }] }));
    expect(await openrouter(CONFIG, buscar).imagem(CONTEXTO)).toMatchObject({ ok: false, definitiva: true, motivo: expect.stringContaining("10 MB") });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("valida o conteúdo e rejeita condição comercial inventada", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ ...COPY, texto: "Peça por R$ 99" }) } }] }));
    expect(await openrouter(CONFIG, buscar).texto(CONTEXTO)).toMatchObject({ ok: false, definitiva: true });
  });

  it.each([400, 401, 402, 403, 429, 500, 503])("classifica HTTP %s sem vazar corpo ou repetir a chamada", async (status) => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(async () => new Response("dedicada-de-teste e dados privados", { status }));
    const p = openrouter(CONFIG, buscar);
    for (const r of [await p.texto(CONTEXTO), await p.imagem(CONTEXTO)]) {
      expect(r).toMatchObject({ ok: false, definitiva: status !== 429 && status < 500 });
      expect(JSON.stringify(r)).not.toMatch(/dedicada-de-teste|dados privados/);
    }
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("falha de transporte mantém o resultado incerto sem tentativa automática", async () => {
    const buscar = vi.fn<typeof fetch>().mockRejectedValue(new Error("falha com dado privado"));
    const p = openrouter(CONFIG, buscar);
    for (const r of [await p.texto(CONTEXTO), await p.imagem(CONTEXTO)]) {
      expect(r).toMatchObject({ ok: false, definitiva: false, incerto: true });
      expect(JSON.stringify(r)).not.toContain("dado privado");
    }
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("timeout depois dos headers mantém texto e imagem incertos", async () => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(async () => {
      const resposta = new Response(null, { status: 200 });
      vi.spyOn(resposta, "json").mockRejectedValue(new DOMException("interrompido", "AbortError"));
      return resposta;
    });
    const p = openrouter(CONFIG, buscar);
    for (const r of [await p.texto(CONTEXTO), await p.imagem(CONTEXTO)]) {
      expect(r).toMatchObject({ ok: false, definitiva: false, incerto: true });
    }
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});

describe("custo real informado, separado do preço em créditos", () => {
  it("aceita custo zero somente se explicitamente informado, com precisão da tabela", () => {
    expect(custoInformadoOpenrouter(CONFIG.modeloImagem, { cost: 0 })).toEqual({ modelo: CONFIG.modeloImagem, custo_usd: 0 });
    expect(custoInformadoOpenrouter(CONFIG.modeloTexto, { cost: 0.0123456 })).toEqual({ modelo: CONFIG.modeloTexto, custo_usd: 0.012346 });
  });
  it.each([undefined, null, {}, { cost: "0.1" }, { cost: -1 }, { cost: NaN }, { cost: Infinity }, { cost: 1_000_000 }, { cost: 999999.9999999 }])("não inventa custo quando inválido ou ausente: %j", (uso) => {
    expect(custoInformadoOpenrouter(CONFIG.modeloTexto, uso)).toBeUndefined();
  });
});

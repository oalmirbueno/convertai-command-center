// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { openrouter, type Contexto } from "../../supabase/functions/bolso/provedores";
import { MODELO_COPY, MODELO_ESTRUTURA, validarBriefingGerado } from "../../supabase/functions/bolso/criativo";

const CONFIG = { habilitado: "sim", chave: "isolada-de-teste", modeloTexto: "openai/gpt-4.1-mini", modeloImagem: "google/gemini-3.1-flash-image" };
const BRIEFING = { tipo: "venda" as const, produto: "Bolo de pote", objetivo: "Apresentar os sabores", canal: "Instagram", condicoes: "", cta: "Peça pelo WhatsApp", publico: "", diferencial: "" };
const COPY = { mensagem: "Sua pausa merece um doce.", texto: "Conheça os sabores de bolo de pote. Peça pelo WhatsApp.", cta: BRIEFING.cta, aplicacao: "Instagram", direcao_visual: "Bolo de pote em destaque." };
const CTX: Contexto = { marca: { nome: "Doceria", cores: ["#ff2211"] }, briefing: BRIEFING, versao: COPY, formato: "feed_1x1" };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const resposta = (conteudo: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) } }], usage: { cost: 0.012 } });

describe("estrutura Sol e copy Terra com custo e contexto limitados", () => {
  it("usa Sol explícito para briefing, preserva escolhas do membro e retorna proposta validada", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(resposta({ ...BRIEFING, cta: "Mande um direct", produto: "Outro produto" }));
    const resultado = await openrouter(CONFIG, buscar).briefing!({ ...CTX, natureza: "briefing", entrada: { ideia: "Quero apresentar os sabores para quem passa pelo bairro." } });
    const body = JSON.parse(buscar.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model: MODELO_ESTRUTURA, max_tokens: 1200, provider: { allow_fallbacks: false }, reasoning: { effort: "low" }, response_format: { type: "json_object" } });
    expect(body.models).toBeUndefined();
    expect(resultado).toEqual({ ok: true, briefing: BRIEFING, custo: { modelo: MODELO_ESTRUTURA, custo_usd: 0.012 } });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("usa Terra para legenda humana com CTA específico, sem tocar o modelo legado", async () => {
    const buscar = vi.fn<typeof fetch>().mockImplementation(async () => resposta(COPY));
    const provedor = openrouter(CONFIG, buscar);
    expect(await provedor.texto({ ...CTX, natureza: "legenda" })).toEqual({ ok: true, conteudo: COPY, custo: { modelo: MODELO_COPY, custo_usd: 0.012 } });
    const body = JSON.parse(buscar.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model: MODELO_COPY, max_tokens: 1200, provider: { allow_fallbacks: false } });
    expect(body.messages[0].content).toContain("conversando com um cliente");
    expect(body.messages[1].content).toContain(BRIEFING.cta);
    await provedor.texto(CTX);
    expect(JSON.parse(buscar.mock.calls[1][1]!.body as string).model).toBe(CONFIG.modeloTexto);
    await openrouter({ ...CONFIG, modeloTexto: MODELO_COPY }, buscar).texto(CTX);
    const legadoAtualizado = JSON.parse(buscar.mock.calls[2][1]!.body as string);
    expect(legadoAtualizado).toMatchObject({ model: MODELO_COPY, reasoning: { effort: "none" }, provider: { allow_fallbacks: false } });
    expect(legadoAtualizado.messages[0].content).toContain("conversando com um cliente");
  });

  it("não paga uma chamada com ideia vazia, ideia longa ou contexto acima do teto", async () => {
    const buscar = vi.fn<typeof fetch>();
    const provedor = openrouter(CONFIG, buscar);
    for (const ideia of ["", "a".repeat(1501)]) {
      expect(await provedor.briefing!({ ...CTX, entrada: { ideia } })).toMatchObject({ ok: false, definitiva: true });
    }
    expect(await provedor.briefing!({ ...CTX, marca: { nome: "a".repeat(16001) }, entrada: { ideia: "Apresentar o produto" } })).toMatchObject({ ok: false, definitiva: true });
    expect(await provedor.texto({ ...CTX, natureza: "legenda", marca: { nome: "a".repeat(16001) } })).toMatchObject({ ok: false, definitiva: true });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("recusa condições comerciais inventadas e não inventa campos ausentes", () => {
    expect(validarBriefingGerado({ ...BRIEFING, condicoes: "50% de desconto" }, BRIEFING, "Apresentar os sabores").ok).toBe(false);
    expect(validarBriefingGerado({ ...BRIEFING, diferencial: "Entrega em 2 horas" }, BRIEFING, "Apresentar os sabores").ok).toBe(false);
    expect(validarBriefingGerado({ produto: "Bolo" }, BRIEFING, "Ideia").ok).toBe(false);
    expect(validarBriefingGerado({ ...BRIEFING, condicoes: "R$ 20" }, BRIEFING, "Preço: R$ 20")).toMatchObject({ ok: true, briefing: { condicoes: "R$ 20" } });
    expect(validarBriefingGerado(BRIEFING, BRIEFING, "Apresentar os sabores")).toMatchObject({ ok: true, briefing: { publico: "", diferencial: "" } });
  });

  it("timeout de briefing fica incerto e não faz fallback nem segunda chamada", async () => {
    const buscar = vi.fn<typeof fetch>().mockRejectedValue(new Error("segredo-isolado"));
    expect(await openrouter(CONFIG, buscar).briefing!({ ...CTX, entrada: { ideia: "Apresentar os sabores" } })).toEqual({ ok: false, definitiva: false, incerto: true, motivo: "Sem resposta do fornecedor de briefing." });
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});

describe("referências multimodais e ajustes geram imagem de verdade", () => {
  it("envia URLs assinadas em input_references, com original primeiro e uma imagem por pedido", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: PNG }], usage: { cost: 0.065 } }));
    const referencias = ["https://storage.example.invalid/original?token=teste", "https://storage.example.invalid/produto?token=teste"];
    const resultado = await openrouter(CONFIG, buscar).imagem({ ...CTX, natureza: "ajuste", entrada: { ajuste: "Troque o fundo por uma mesa clara", arte_origem: "arte-existente" }, referencias });
    expect(resultado).toMatchObject({ ok: true, custo: { modelo: CONFIG.modeloImagem, custo_usd: 0.065 } });
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ n: 1, resolution: "1K", aspect_ratio: "1:1", provider: { allow_fallbacks: false }, input_references: referencias.map((url) => ({ type: "image_url", image_url: { url } })) });
    expect(body.prompt).toContain("Edite a primeira imagem de referência");
    expect(body.prompt).toContain("Troque o fundo por uma mesa clara");
    expect(body.prompt).not.toContain("token=teste");
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("não simula ajuste quando a arte original não foi resolvida pelo servidor", async () => {
    const buscar = vi.fn<typeof fetch>();
    expect(await openrouter(CONFIG, buscar).imagem({ ...CTX, natureza: "ajuste", entrada: { ajuste: "Fundo claro" } })).toMatchObject({ ok: false, definitiva: true });
    expect(await openrouter(CONFIG, buscar).imagem({ ...CTX, natureza: "imagem", referencias: Array(5).fill("https://storage.example.invalid/foto") })).toMatchObject({ ok: false, definitiva: true });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("ajuste conserva os textos originais sem introduzir marca, oferta ou preço da campanha atual", async () => {
    const buscar = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: PNG }] }));
    await openrouter(CONFIG, buscar).imagem({ ...CTX,
      marca: { nome: "Marca alterada depois" },
      briefing: { ...BRIEFING, produto: "Outro produto atual", condicoes: "R$ 999" },
      versao: { ...COPY, mensagem: "Seu bolo por R$ 20" },
      natureza: "ajuste", entrada: { ajuste: "Fundo claro", arte_origem: "original" },
      referencias: ["https://storage.example.invalid/original?token=teste"],
    });
    const body = JSON.parse(buscar.mock.calls[0][1]!.body as string);
    expect(body.prompt).toContain("Seu bolo por R$ 20");
    expect(body.prompt).not.toMatch(/Marca alterada depois|Outro produto atual|R\$ 999/);
    expect(body.prompt).toContain("Não crie uma nova campanha");
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ehApelidoDoOpenRouter,
  type ModeloOpenRouterBruto,
  niveisDeRaciocinio,
  recursosDoOpenRouter,
} from "../../supabase/functions/_shared/recursos-dos-modelos";
import { capacidadesNaTela, lancadoHaPouco, raciocinioQueVale } from "@/lib/mesa/recursos-na-tela";
import {
  aplicarMudancas,
  melhorDoPapel,
  mudancasDaRecomendacao,
  MODELOS_DE_IMAGEM_DO_LOTE_NOVO,
  MODELOS_DE_TEXTO_DO_LOTE_NOVO,
  MODELOS_DO_LOTE_NOVO,
  RECOMENDACOES_POR_PAPEL,
  recomendadoDoPapel,
  vezesOPreco,
} from "@/lib/mesa/modelo-por-papel";
import {
  betasDoCorpoAnthropic,
  corpoAnthropic,
  corpoOpenAi,
  corpoOpenRouter,
  dominiosDaBusca,
  fontesDaAnthropic,
  fontesDaOpenAi,
  fontesDoOpenRouter,
  usarCache,
  versaoDaBuscaAnthropic,
} from "../../supabase/functions/_shared/corpo-dos-provedores";
import {
  casoLigado,
  dentroDoTeto,
  dominioPermitido,
  montarDominios,
  motivoParaRecusarNoNavegador,
  normalizarPedidoDoNavegador,
  normalizarUrlPublica,
  objetivoPedeAcaoProibida,
  podeDigitar,
  podeExecutar,
  podeParar,
  urlDeLoginOuPagamento,
} from "../../supabase/functions/computador-do-agente/modulos/navegador";
import { SeletorDeModelo, SeletorDeRaciocinio } from "@/components/mesa/Seletores";
import { aprovacaoVencida, COLUNAS_DA_LISTA, intervaloDaLista, resumoDoResultado, tarefaDaLinha, tarefaAtiva } from "@/lib/agentes/navegadorApi";
import type { ModeloIa } from "@/lib/mesa/api";

/**
 * Frente MOD (30/09/2026): modelos novos no catálogo, o melhor modelo por
 * papel, raciocínio, cache, esquema e busca web nativa no ia-motor, e as
 * travas do navegador do agente (computer use). O navegador de verdade e as
 * RPCs no banco têm testes próprios em workers/computador/testes.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const lista = JSON.parse(ler("src/test/fixtures/openrouter-modelos-2026-09-29.json")) as ModeloOpenRouterBruto[];
const doOr = (id: string) => lista.find((m) => m.id === id) as ModeloOpenRouterBruto;

const lista30 = JSON.parse(ler("src/test/fixtures/openrouter-modelos-2026-09-30.json")) as ModeloOpenRouterBruto[];

describe("lote novo (MOD2, lista pública do OpenRouter lida ao vivo em 30/09)", () => {
  it("cada modelo do lote existe, não é lote nem apelido, faz ferramentas e JSON estrito e é de texto", () => {
    expect(MODELOS_DE_TEXTO_DO_LOTE_NOVO.length).toBe(8);
    for (const id of MODELOS_DE_TEXTO_DO_LOTE_NOVO) {
      const slug = id.replace(/^openrouter:/, "");
      const m = lista30.find((x) => x.id === slug);
      expect(m, slug).toBeTruthy();
      expect(ehApelidoDoOpenRouter(m as ModeloOpenRouterBruto), slug).toBe(false);
      expect(slug.indexOf(":batch"), slug).toBe(-1);
      const r = recursosDoOpenRouter(m as ModeloOpenRouterBruto);
      expect(r.ferramentas, slug).toBe(true);
      expect(r.esquema_estrito, slug).toBe(true);
      expect(((m as ModeloOpenRouterBruto).architecture?.output_modalities || []).indexOf("text"), slug).toBeGreaterThanOrEqual(0);
    }
  });

  it("lote de imagem (01/10): cada um tem provedor, edita com 3 ou mais referências e custa até US$ 0,08 por imagem", () => {
    // preco_media_no_catalogo: preço por imagem (qualidade média, 1K) que ia_modelos tinha em 01/10 (SELECT).
    type Img = { id: string; created: number; endpoints: number; refs_max: number | null; preco_media_no_catalogo: number | null; precos: Array<{ billable: string; unit: string; cost_usd: number; variant?: string }> };
    const imagens = JSON.parse(ler("src/test/fixtures/openrouter-imagens-2026-10-01.json")) as Img[];
    expect(MODELOS_DE_IMAGEM_DO_LOTE_NOVO.length).toBe(4);
    expect(MODELOS_DO_LOTE_NOVO).toEqual(MODELOS_DE_TEXTO_DO_LOTE_NOVO.concat(MODELOS_DE_IMAGEM_DO_LOTE_NOVO));
    for (const id of MODELOS_DE_IMAGEM_DO_LOTE_NOVO) {
      const m = imagens.find((x) => `openrouter:${x.id}` === id) as Img;
      expect(m, id).toBeTruthy();
      expect(m.endpoints, id).toBeGreaterThan(0);
      expect(m.refs_max || 0, id).toBeGreaterThanOrEqual(3);
      expect(m.precos.some((p) => p.billable === "output_image" && p.cost_usd > 0), id).toBe(true);
      expect(m.preco_media_no_catalogo, id).toBeGreaterThan(0);
      expect(m.preco_media_no_catalogo as number, id).toBeLessThanOrEqual(0.08);
    }
    // MAI-Image 2.6 Flash cobra por token: US$ 0,019 por 1K tokens de imagem de saída, metade do 2.6.
    const flash = imagens.find((x) => x.id === "microsoft/mai-image-2.6-flash") as Img;
    const cheio = imagens.find((x) => x.id === "microsoft/mai-image-2.6") as Img;
    const saidaDe = (m: Img) => (m.precos.find((p) => p.billable === "output_image") as { cost_usd: number }).cost_usd;
    expect(saidaDe(flash) * 2).toBeLessThanOrEqual(saidaDe(cheio));
    // Os que ficam de fora, pelo motivo escrito em modelo-por-papel.ts.
    expect((imagens.find((x) => x.id === "recraft/recraft-v4.1-flash") as Img).refs_max == null).toBe(true);
    expect((imagens.find((x) => x.id === "inclusionai/ming-image-0.1-design") as Img).precos.every((p) => p.cost_usd === 0)).toBe(true);
    expect((imagens.find((x) => x.id === "meta/muse-image") as Img).endpoints).toBe(0);
    for (const fora of ["openrouter:recraft/recraft-v4.1-flash", "openrouter:inclusionai/ming-image-0.1-design", "openrouter:meta/muse-image"]) expect(MODELOS_DO_LOTE_NOVO).not.toContain(fora);
    // O padrão do papel imagem não muda.
    expect(melhorDoPapel("imagem")).toBe("openrouter:openai/gpt-image-2.5-sunburst");
  });

  it("vezesOPreco: Luna para Sonnet 5.5 é 20 vezes o preço por token; imagem não compara", () => {
    const luna = { tipo: "texto", preco_entrada_1m: 0.1, preco_saida_1m: 0.5 };
    const sonnet = { tipo: "texto", preco_entrada_1m: "2", preco_saida_1m: "10" };
    expect(vezesOPreco(luna, sonnet)).toBe(20);
    expect(vezesOPreco(sonnet, luna)).toBe(0.05);
    expect(vezesOPreco(null, sonnet)).toBeNull();
    expect(vezesOPreco({ tipo: "imagem" }, sonnet)).toBeNull();
    expect(vezesOPreco({ tipo: "texto", preco_entrada_1m: null, preco_saida_1m: null }, sonnet)).toBeNull();
  });

  it("o \"-pro\" da OpenAI fica de fora do lote (mesmo modelo, raciocínio que gasta muito mais)", () => {
    expect(lista30.find((x) => x.id === "openai/gpt-6.1-sol-pro")).toBeTruthy();
    expect(MODELOS_DO_LOTE_NOVO).not.toContain("openrouter:openai/gpt-6.1-sol-pro");
  });

  it("o que a escolha por papel usa bate com a lista ao vivo: Sonnet 5.5 à frente do Opus 5.5 na estratégia pelo índice e pelo preço", () => {
    const sonnet = recursosDoOpenRouter(lista30.find((x) => x.id === "anthropic/claude-sonnet-5.5") as ModeloOpenRouterBruto);
    const opus = recursosDoOpenRouter(lista30.find((x) => x.id === "anthropic/claude-opus-5.5") as ModeloOpenRouterBruto);
    expect(sonnet.indice_inteligencia).toBe(56);
    expect(opus.indice_inteligencia).toBe(57.6);
    expect(sonnet.lancado_em).toBe("2026-09-28");
    expect(recursosDoOpenRouter(lista30.find((x) => x.id === "openai/gpt-6.1-sol") as ModeloOpenRouterBruto).lancado_em).toBe("2026-09-29");
    expect(recursosDoOpenRouter(lista30.find((x) => x.id === "xiaomi/mimo-v2.6-pro") as ModeloOpenRouterBruto).video_entrada).toBe(true);
  });
});

describe("sincronizador: lê as capacidades novas do OpenRouter (lista pública de 29/09)", () => {
  it("Claude Opus 5.5: ferramentas, esquema estrito, visão, PDF, raciocínio obrigatório com padrão, cache de 5 min e 1 h, busca e lançamento", () => {
    const r = recursosDoOpenRouter(doOr("anthropic/claude-opus-5.5"));
    expect(r).toMatchObject({
      ferramentas: true,
      json: true,
      esquema_estrito: true,
      visao: true,
      arquivos: true,
      raciocinio_obrigatorio: true,
      raciocinio_padrao: "high",
      verbosidade: true,
      busca_web_usd: 0.01,
      cache_escrita_1m: 5,
      cache_escrita_1h_1m: 8,
      saida_max: 128000,
      lancado_em: "2026-09-22",
      indice_inteligencia: 57.6,
      fonte: "openrouter",
    });
    expect(niveisDeRaciocinio(doOr("anthropic/claude-opus-5.5"))).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("GPT-6.1 Sol (29/09) sem 'none'; GPT-6 Luna com 'none' e sem obrigatório; Gemini 3.8 Flash lê áudio e vídeo", () => {
    const sol = recursosDoOpenRouter(doOr("openai/gpt-6.1-sol"));
    expect(sol.lancado_em).toBe("2026-09-29");
    expect(sol.raciocinio_obrigatorio).toBe(true);
    expect(niveisDeRaciocinio(doOr("openai/gpt-6.1-sol"))).not.toContain("none");
    expect(niveisDeRaciocinio(doOr("openai/gpt-6-luna"))[0]).toBe("none");
    expect(recursosDoOpenRouter(doOr("openai/gpt-6-luna")).raciocinio_obrigatorio).toBe(false);
    const gemini = recursosDoOpenRouter(doOr("google/gemini-3.8-flash"));
    expect(gemini.audio_entrada && gemini.video_entrada).toBe(true);
    expect(gemini.saida_max).toBe(65536);
  });

  it("apelido '~.../...-latest' e variante ':batch' não entram (o conversor do ia-motor pula os dois)", () => {
    expect(ehApelidoDoOpenRouter(doOr("~anthropic/claude-opus-latest"))).toBe(true);
    expect(ehApelidoDoOpenRouter(doOr("anthropic/claude-opus-5.5"))).toBe(false);
    const motor = ler("supabase/functions/_shared/ia-motor.ts");
    expect(motor).toContain('if (!slug || slug.includes(":") || slug.startsWith("openrouter/")) return null;');
    expect(motor).toContain("if (ehApelidoDoOpenRouter(o)) return null;");
    expect(motor).toContain('recursos: tipo === "texto" ? recursosDoOpenRouter(o) : null,');
  });

  it("a RPC grava recursos sem apagar o que existe; o catálogo da tela e o gateway leem a coluna", () => {
    const sql = ler("supabase/migrations/20260930320000_modelos_e_recursos.sql");
    expect(sql).toContain("recursos = COALESCE(EXCLUDED.recursos, m.recursos),");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS recursos jsonb");
    const conflito = sql.slice(sql.indexOf("ON CONFLICT (id) DO UPDATE SET"), sql.indexOf("RETURNING (xmax = 0)"));
    expect(conflito).not.toMatch(/\bativo\s*=/);
    expect(conflito).not.toMatch(/\bpadrao_para\s*=/);
    expect(ler("src/lib/mesa/api.ts")).toContain("conferido_em, criado_em, recursos\";");
    expect(ler("supabase/functions/ia-gateway/index.ts")).toContain("let { data, error } = await ler(`${colunas}, recursos`);");
  });
});

describe("o melhor modelo por papel", () => {
  const cat = (ligados: string[], padroes: Record<string, string> = {}) =>
    RECOMENDACOES_POR_PAPEL.reduce<string[]>((a, r) => a.concat(r.candidatos), [])
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .map((id) => ({
        id,
        tipo: /gpt-image/.test(id) ? "imagem" : "texto",
        ativo: ligados.indexOf(id) >= 0,
        disponivel: true,
        padrao_para: Object.keys(padroes).filter((p) => padroes[p] === id),
      }));

  it("cobre os papéis de sempre e os 9 novos, mais leitura, imagem, estrategista e diretor de arte", () => {
    const papeis = RECOMENDACOES_POR_PAPEL.map((r) => r.papel);
    for (const p of ["estrategista", "diretor_arte", "imagem", "leitura", "contexto", "estrategista_rapido", "proposta", "contrato", "briefing", "conselho", "identidade", "naming", "site", "motion", "documento"]) {
      expect(papeis).toContain(p);
    }
    expect(melhorDoPapel("proposta")).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(melhorDoPapel("estrategista")).toBe("openrouter:anthropic/claude-sonnet-5.5");
    expect(melhorDoPapel("conselho")).toBe("openrouter:openai/gpt-6.1-sol");
    expect(melhorDoPapel("leitura")).toBe("openrouter:openai/gpt-6-luna");
  });

  it("só usa modelo ligado; sem candidato ligado o papel não muda", () => {
    const c = cat(["openrouter:anthropic/claude-opus-5.5", "openrouter:openai/gpt-6-luna"], { estrategista: "openrouter:openai/gpt-6-sol" });
    expect(recomendadoDoPapel(c, "estrategista")).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(recomendadoDoPapel(c, "imagem")).toBeNull();
    const mud = mudancasDaRecomendacao(c);
    expect(mud.find((m) => m.papel === "imagem")).toBeUndefined();
    expect(mud.find((m) => m.papel === "estrategista")).toEqual({ papel: "estrategista", de: "openrouter:openai/gpt-6-sol", para: "openrouter:anthropic/claude-opus-5.5" });
  });

  it("aplicar deixa cada papel num modelo só e não mexe no que já segue a recomendação", () => {
    const c = cat(["openrouter:anthropic/claude-sonnet-5.5", "openrouter:anthropic/claude-opus-5.5"], { estrategista: "openrouter:anthropic/claude-opus-5.5", proposta: "openrouter:anthropic/claude-opus-5.5" });
    const mud = mudancasDaRecomendacao(c);
    expect(mud.find((m) => m.papel === "proposta")).toBeUndefined();
    const finais = aplicarMudancas(c, mud);
    expect(finais["openrouter:anthropic/claude-opus-5.5"]).not.toContain("estrategista");
    expect(finais["openrouter:anthropic/claude-opus-5.5"]).toContain("proposta");
    expect(finais["openrouter:anthropic/claude-sonnet-5.5"]).toContain("estrategista");
  });
});

describe("ia-motor: raciocínio, cache de prompt, esquema e busca web nativa", () => {
  const grande = "contexto do cliente ".repeat(300);
  const base = { sistema: "Você é o estrategista.", mensagens: [{ papel: "usuario" as const, conteudo: "Oi" }] };
  const esquema = { nome: "plano", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } };

  it("Anthropic: pensamento adaptativo com output_config.effort e o esquema em output_config.format", () => {
    const c = corpoAnthropic("claude-opus-5-5", { ...base, raciocinio: "max", esquemaJson: esquema });
    expect(c.thinking).toEqual({ type: "adaptive" });
    expect(c.output_config).toEqual({ effort: "max", format: { type: "json_schema", schema: esquema.schema } });
    expect(c.system).toBe("Você é o estrategista.");
  });

  it("Anthropic: cache do system quando o prompt é grande (5 min), 1 h quando pedido, nada quando desligado", () => {
    expect(usarCache({ sistema: "curto" })).toBe(false);
    const c = corpoAnthropic("claude-sonnet-5-5", { ...base, sistema: grande });
    expect(c.system).toEqual([{ type: "text", text: grande, cache_control: { type: "ephemeral" } }]);
    const hora = corpoAnthropic("claude-sonnet-5-5", { ...base, sistema: grande, cachePrompt: "1h" });
    expect((hora.system as Array<{ cache_control: unknown }>)[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(corpoAnthropic("claude-sonnet-5-5", { ...base, sistema: grande, cachePrompt: false }).system).toBe(grande);
  });

  it("Anthropic: busca web de servidor com chamada direta, domínios e local do Brasil; fontes das citações", () => {
    const c = corpoAnthropic("claude-opus-5-5", { ...base, pesquisaWeb: true, dominiosWeb: ["https://www.ibge.gov.br/x", "sebrae.com.br", "lixo"] });
    expect(c.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" }, allowed_domains: ["ibge.gov.br", "sebrae.com.br"] }]);
    const fontes = fontesDaAnthropic([
      { type: "text", text: "A", citations: [{ type: "web_search_result_location", url: "https://ibge.gov.br/a", title: "IBGE", cited_text: "dado" }] },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://sebrae.com.br/b", title: "Sebrae" }, { type: "web_search_result", url: "https://ibge.gov.br/a", title: "IBGE" }] },
    ]);
    expect(fontes).toEqual([{ url: "https://ibge.gov.br/a", titulo: "IBGE", trecho: "dado" }, { url: "https://sebrae.com.br/b", titulo: "Sebrae" }]);
  });

  it("Anthropic (MOD2): versão da busca pelo modelo e fallbacks \"default\" com o cabeçalho certo", () => {
    expect(versaoDaBuscaAnthropic("claude-opus-5-5")).toBe("web_search_20260209");
    expect(versaoDaBuscaAnthropic("claude-sonnet-5-5")).toBe("web_search_20260209");
    expect(versaoDaBuscaAnthropic("claude-opus-4-6")).toBe("web_search_20260209");
    expect(versaoDaBuscaAnthropic("anthropic/claude-sonnet-5.5")).toBe("web_search_20260209");
    expect(versaoDaBuscaAnthropic("claude-fable-5-1")).toBe("web_search_20250305");
    expect(versaoDaBuscaAnthropic("claude-haiku-4-5")).toBe("web_search_20250305");
    expect(versaoDaBuscaAnthropic("claude-opus-4-5")).toBe("web_search_20250305");
    const fable = corpoAnthropic("claude-fable-5-1", { ...base, pesquisaWeb: true });
    expect((fable.tools as Array<{ type: string }>)[0].type).toBe("web_search_20250305");
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]) {
      const c = corpoAnthropic(id, base);
      expect(c.fallbacks, id).toBe("default");
      expect(betasDoCorpoAnthropic(c), id).toBe("server-side-fallback-2026-07-01");
    }
    const antigo = corpoAnthropic("claude-sonnet-5", base);
    expect(antigo.fallbacks).toBeUndefined();
    expect(betasDoCorpoAnthropic(antigo)).toBe("");
    // O motor manda o cabeçalho que o corpo pede.
    expect(ler("supabase/functions/_shared/ia-motor.ts")).toContain("cabecalhosAnthropic(chave, betasDoCorpoAnthropic(corpo))");
  });

  it("OpenAI: reasoning.effort, text.format estrito, web_search com filtros e as fontes consultadas", () => {
    const c = corpoOpenAi("gpt-6.1-sol", { ...base, raciocinio: "xhigh", esquemaJson: esquema, pesquisaWeb: true, dominiosWeb: ["sebrae.com.br"] });
    expect(c.reasoning).toEqual({ effort: "xhigh" });
    expect(c.text).toEqual({ format: { type: "json_schema", name: "plano", schema: esquema.schema, strict: true } });
    expect(c.tools).toEqual([{ type: "web_search", user_location: { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" }, search_context_size: "medium", filters: { allowed_domains: ["sebrae.com.br"] } }]);
    expect(c.include).toEqual(["web_search_call.action.sources"]);
    expect(c.store).toBe(false);
    const fontes = fontesDaOpenAi({
      output: [
        { type: "web_search_call", action: { sources: [{ url: "https://b.com/", title: "B" }] } },
        { type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url: "https://a.com/", title: "A" }] }] },
      ],
    });
    expect(fontes.map((f) => f.url)).toEqual(["https://a.com/", "https://b.com/"]);
  });

  it("OpenRouter: raciocínio unificado, esquema só em provedor que cumpre, cache só no Claude e busca pela ferramenta de servidor", () => {
    const claude = corpoOpenRouter("anthropic/claude-opus-5.5", { ...base, sistema: grande, raciocinio: "high", esquemaJson: esquema, pesquisaWeb: true });
    expect(claude.reasoning).toEqual({ effort: "high" });
    expect(claude.response_format).toEqual({ type: "json_schema", json_schema: { name: "plano", strict: true, schema: esquema.schema } });
    expect(claude.provider).toEqual({ require_parameters: true });
    expect((claude.messages as Array<{ content: unknown }>)[0].content).toEqual([{ type: "text", text: grande, cache_control: { type: "ephemeral" } }]);
    expect(claude.tools).toEqual([{ type: "openrouter:web_search", parameters: { engine: "auto", max_results: 5, max_uses: 5, user_location: { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" } } }]);
    expect(claude.plugins).toBeUndefined();
    const gpt = corpoOpenRouter("openai/gpt-6.1-sol", { ...base, sistema: grande });
    expect((gpt.messages as Array<{ content: unknown }>)[0].content).toBe(grande);
    expect(fontesDoOpenRouter({ choices: [{ message: { annotations: [{ type: "url_citation", url_citation: { url: "https://c.com/", title: "C", content: "trecho" } }] } }] })).toEqual([{ url: "https://c.com/", titulo: "C", trecho: "trecho" }]);
  });

  it("o motor cobra a escrita de cache pelo preço publicado (ou 1,25x e 2x), devolve as fontes e continua o pause_turn", () => {
    const motor = ler("supabase/functions/_shared/ia-motor.ts");
    expect(motor).toContain("const pw = r.cache_escrita_1m != null ? num(r.cache_escrita_1m) : pe * 1.25;");
    expect(motor).toContain("const pw1h = r.cache_escrita_1h_1m != null ? num(r.cache_escrita_1h_1m) : pe * 2;");
    expect(motor).toContain("if (r.fontes.length) saida.fontes = r.fontes;");
    expect(motor).toContain('if (data.stop_reason !== "pause_turn") break;');
    expect(motor).toContain("const busca = num(u.buscasWeb) * custoDaBuscaWeb(m);");
    expect(dominiosDaBusca(["HTTPS://WWW.Exemplo.com.br/a/b", "exemplo.com.br", ""])).toEqual(["exemplo.com.br"]);
  });
});

describe("raciocínio na tela: o nível acompanha o modelo novo", () => {
  const modelo = (raciocinio: string[], padrao?: string): ModeloIa => ({
    id: "x", provedor: "openrouter", modelo_api: "x", tipo: "texto", rotulo: "X", preco_entrada_1m: 1, preco_saida_1m: 1, preco_cache_1m: null, preco_imagem: null,
    raciocinio, padrao_para: [], ativo: true, recursos: padrao ? { raciocinio_padrao: padrao } : null,
  });

  it("raciocinioQueVale: aceito fica; 'none' num modelo que sempre pensa sobe para o mais perto; vazio usa o padrão do provedor", () => {
    expect(raciocinioQueVale(modelo(["low", "medium", "high"]), "medium")).toBe("medium");
    expect(raciocinioQueVale(modelo(["low", "medium", "high", "xhigh", "max"]), "none")).toBe("low");
    expect(raciocinioQueVale(modelo(["low", "medium", "high"], "high"), "")).toBe("high");
    expect(raciocinioQueVale(modelo(["low", "high"]), "max")).toBe("high");
    expect(raciocinioQueVale(modelo([]), "max")).toBe("");
  });

  it("SeletorDeRaciocinio troca sozinho o nível que o modelo não aceita e marca o padrão", async () => {
    const mudou = vi.fn();
    function Tela() {
      const [v, setV] = useState("none");
      return h(SeletorDeRaciocinio, { modelo: modelo(["low", "medium", "high", "xhigh", "max"], "high"), valor: v, onChange: (n: string) => { mudou(n); setV(n); } });
    }
    const r = render(h(Tela));
    await waitFor(() => expect(mudou).toHaveBeenCalledWith("low"));
    expect(mudou).toHaveBeenCalledTimes(1);
    expect(r.container.textContent).toContain("Baixo");
  });

  it("sem modelo (catálogo carregando) a escolha guardada não se perde", async () => {
    const mudou = vi.fn();
    render(h(SeletorDeRaciocinio, { modelo: null, valor: "max", onChange: mudou }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mudou).not.toHaveBeenCalled();
  });

  it("capacidades e 'novo' na tela, com a linha antiga caindo no que o catálogo já sabia", () => {
    expect(capacidadesNaTela({ raciocinio: ["low"], modalidades: { entrada: ["text", "image"] }, recursos: null })).toEqual({ visao: true, ferramentas: false, raciocinio: true, json: false });
    expect(capacidadesNaTela({ raciocinio: [], recursos: { ferramentas: true, json: true, visao: false } })).toEqual({ visao: false, ferramentas: true, raciocinio: false, json: true });
    const agora = Date.parse("2026-09-30T12:00:00Z");
    expect(lancadoHaPouco({ recursos: { lancado_em: "2026-09-29" } }, agora)).toBe(true);
    expect(lancadoHaPouco({ recursos: { lancado_em: "2026-07-24" } }, agora)).toBe(false);
  });
});

describe("lista do seletor de modelo: ícones, 'novo' e a dica (MOD2, 01/10)", () => {
  const linha = (id: string, extra: Partial<ModeloIa>): ModeloIa => ({
    id, provedor: "openrouter", modelo_api: id, tipo: "texto", rotulo: id.toUpperCase(), preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: [], padrao_para: [], ativo: true, recursos: null, ...extra,
  });

  it("aberta, cada item traz o que o modelo faz e o 'novo'; fechado, o campo mostra só nome e preço", async () => {
    const antes = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    try {
      const novo = linha("novo-1", {
        raciocinio: ["low", "high"], contexto_tokens: 1000000,
        recursos: { visao: true, ferramentas: true, json: true, lancado_em: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) },
      });
      const antigo = linha("antigo-1", { recursos: { lancado_em: "2025-01-01" } });
      render(h(SeletorDeModelo, { catalogo: [novo, antigo], tipo: "texto", valor: "novo-1", onChange: () => {} }));
      const campo = screen.getByRole("combobox");
      expect(campo.textContent).toContain("NOVO-1");
      expect(campo.textContent).not.toMatch(/novo$/);
      fireEvent.keyDown(campo, { key: "Enter" });
      const itens = await screen.findAllByRole("option");
      expect(itens).toHaveLength(2);
      const [a, b] = itens;
      expect(a.getAttribute("data-modelo-novo")).toBe("sim");
      expect(a.getAttribute("title")).toBe("vê imagem, usa ferramentas, raciocina, responde em JSON, contexto de 1 mi tokens");
      expect(a.querySelector(".lucide-eye")).not.toBeNull();
      expect(a.querySelector(".lucide-wrench")).not.toBeNull();
      expect(a.querySelector(".lucide-brain")).not.toBeNull();
      expect(a.textContent).toContain("novo");
      expect(b.getAttribute("data-modelo-novo")).toBeNull();
      expect(b.querySelector("svg.lucide-eye, svg.lucide-wrench, svg.lucide-brain")).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = antes;
    }
  });

  it("Seletores não importa o índice de @/components/sistema: o índice puxa o PreencherComIA, que puxa Seletores, e o ciclo travava a Mesa Proposta nos testes", () => {
    const seletores = ler("src/components/mesa/Seletores.tsx");
    expect(seletores).not.toMatch(/from\s+["']@\/components\/sistema["']/);
    // O outro lado do ciclo continua existindo; por isso a trava acima.
    expect(ler("src/components/sistema/PreencherComIA.tsx")).toMatch(/from\s+["']@\/components\/mesa\/Seletores["']/);
  });
});

describe("travas do navegador do agente (computer use)", () => {
  const pedido = (o: Record<string, unknown>) => normalizarPedidoDoNavegador({ caso: "captura_site", url: "https://estudio.com.br/", origem: "mesa_site", ...o });

  it("sem o Confirmar do dono não roda", () => {
    expect(podeExecutar({ estado: "aguardando_dono", aprovado_por: null, aprovado_em: null })).toBe(false);
    expect(podeExecutar({ estado: "aprovada", aprovado_por: null, aprovado_em: null })).toBe(false);
    expect(podeExecutar({ estado: "aprovada", aprovado_por: "dono", aprovado_em: "2026-09-30T10:00:00Z" })).toBe(true);
    expect(podeExecutar({ estado: "executando", aprovado_por: "dono", aprovado_em: "2026-09-30T10:00:00Z" })).toBe(true);
    const fn = ler("supabase/functions/computador-do-agente/index.ts");
    expect(fn).toContain("Só o dono confirma tarefa do navegador do agente.");
    expect(fn).toContain('estado: "aguardando_dono",');
  });

  it("domínio fora da lista é recusado; subdomínio da lista passa; IP, localhost e senha na URL não entram", () => {
    const p = { ...pedido({}), dominios: ["outro.com.br"] };
    expect(motivoParaRecusarNoNavegador(p, false)).toMatch(/lista de domínios/);
    expect(dominioPermitido("https://loja.estudio.com.br/x", ["estudio.com.br"])).toBe(true);
    expect(dominioPermitido("https://estudio.com.br.golpe.com/", ["estudio.com.br"])).toBe(false);
    expect(dominioPermitido("https://golpeestudio.com.br/", ["estudio.com.br"])).toBe(false);
    expect(normalizarUrlPublica("http://127.0.0.1/admin")).toBeNull();
    expect(normalizarUrlPublica("https://localhost:3000")).toBeNull();
    expect(normalizarUrlPublica("https://user:pass@site.com.br/")).toBeNull();
    expect(normalizarUrlPublica("file:///etc/passwd")).toBeNull();
    expect(normalizarUrlPublica("estudio.com.br/portfolio")).toBe("https://estudio.com.br/portfolio");
    expect(montarDominios("https://www.estudio.com.br/", "cdn.estudio.com.br, 10.0.0.1, x")).toEqual(["estudio.com.br", "cdn.estudio.com.br"]);
  });

  it("pedido com senha, login ou pagamento é recusado", () => {
    expect(motivoParaRecusarNoNavegador(pedido({ caso: "conferir_post", objetivo: "entre na conta do cliente com a senha dele" }), false)).toMatch(/login, senha, pagamento/);
    expect(motivoParaRecusarNoNavegador(pedido({ url: "https://estudio.com.br/login" }), false)).toMatch(/login/);
    expect(motivoParaRecusarNoNavegador(pedido({ url: "https://estudio.com.br/painel?access_token=abc123" }), false)).toMatch(/token/);
    expect(urlDeLoginOuPagamento("https://accounts.google.com/signin")).toBe(true);
    expect(urlDeLoginOuPagamento("https://loja.com.br/checkout/pagamento")).toBe(true);
    expect(urlDeLoginOuPagamento("https://estudio.com.br/contato")).toBe(false);
    expect(objetivoPedeAcaoProibida("senha: 1234")).toBe(true);
    expect(podeDigitar("senha: 1234")).toBe(false);
    expect(podeDigitar("cliente@email.com")).toBe(false);
    expect(podeDigitar("fotografia de casamento curitiba")).toBe(true);
  });

  it("captura e conferência ligadas; coleta com modelo pronta e desligada até a variável; teto e Parar", () => {
    expect(casoLigado("captura_site", false)).toBe(true);
    expect(casoLigado("conferir_post", false)).toBe(true);
    expect(casoLigado("coleta_publica", false)).toBe(false);
    expect(motivoParaRecusarNoNavegador(pedido({ caso: "coleta_publica", objetivo: "preços públicos da página inicial" }), false)).toMatch(/Pronto e desligado/);
    expect(motivoParaRecusarNoNavegador(pedido({ caso: "coleta_publica", objetivo: "preços públicos da página inicial" }), true)).toBeNull();
    expect(motivoParaRecusarNoNavegador(pedido({}), false)).toBeNull();
    expect(dentroDoTeto({ passos: 5, custoUsd: 0 }, { passos: 6, custoUsd: 0 })).toBe(true);
    expect(dentroDoTeto({ passos: 6, custoUsd: 0 }, { passos: 6, custoUsd: 0 })).toBe(false);
    expect(dentroDoTeto({ passos: 2, custoUsd: 1.2 }, { passos: 25, custoUsd: 1 })).toBe(false);
    expect(podeParar("executando", "equipe", true)).toBe(true);
    expect(podeParar("executando", "equipe", false)).toBe(false);
    expect(podeParar("feita", "admin", false)).toBe(false);
    expect(resumoDoResultado({ caso: "conferir_post", estado: "feita", resultado: { no_ar: true }, motivo: null })).toBe("No ar.");
  });

  it("lista leve: 5 s só executando, 60 s com aprovada esperando, nada sem tarefa viva; sem provas nem resultado inteiro", () => {
    const agora = Date.parse("2026-10-01T12:00:00Z");
    expect(intervaloDaLista([{ estado: "executando" }, { estado: "aprovada" }])).toBe(5_000);
    expect(intervaloDaLista([{ estado: "aprovada" }])).toBe(60_000);
    expect(intervaloDaLista([{ estado: "aprovada", vencida: true }])).toBe(false);
    expect(intervaloDaLista([{ estado: "aguardando_dono" }, { estado: "feita" }])).toBe(false);
    expect(intervaloDaLista([])).toBe(false);
    expect(aprovacaoVencida({ estado: "aprovada", aprovado_em: "2026-09-30T11:00:00Z" }, agora)).toBe(true);
    expect(aprovacaoVencida({ estado: "aprovada", aprovado_em: "2026-09-30T13:00:00Z" }, agora)).toBe(false);
    expect(aprovacaoVencida({ estado: "executando", aprovado_em: "2026-09-01T00:00:00Z" }, agora)).toBe(false);
    expect(COLUNAS_DA_LISTA).not.toMatch(/(^|, )(provas|resultado|\*)(,|$)/);
    expect(COLUNAS_DA_LISTA).toContain("r_resumo:resultado->>resumo");
    const t = tarefaDaLinha({ id: "x", estado: "aprovada", aprovado_em: "2026-09-29T00:00:00Z", caso: "captura_site", r_capturas: [{ tela: "computador" }], r_no_ar: null } as never, agora);
    expect(t.vencida).toBe(true);
    expect(tarefaAtiva(t)).toBe(false);
    expect(t.resultado).toEqual({ capturas: [{ tela: "computador" }] });
    expect(resumoDoResultado(t)).toMatch(/venceu/);
    const feita = tarefaDaLinha({ id: "y", estado: "feita", caso: "conferir_post", r_no_ar: false, r_motivo: "A página diz que o conteúdo não está disponível." } as never, agora);
    expect(resumoDoResultado(feita)).toBe("Fora do ar. A página diz que o conteúdo não está disponível.");
  });

  it("a função fica atrás do JWT e as janelas do painel abrem no centro (sem gaveta)", () => {
    expect(ler("supabase/config.toml")).toContain("[functions.computador-do-agente]\n    verify_jwt = true");
    const tela = ler("src/components/agentes/NavegadorDoAgente.tsx");
    expect((tela.match(/<JanelaCentral/g) || []).length).toBe(3);
    expect(tela).not.toContain("SheetContent");
    const modelos = ler("src/components/mesa/ModelosDeIa.tsx");
    expect(modelos).toContain("<JanelaCentral");
    expect(modelos).not.toContain("SheetContent");
  });
});

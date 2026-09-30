import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { custosDoTexto } from "../../workers/motor-codigo/lib/medidor";
import { zipar } from "../../workers/motor-codigo/lib/zip";
import { cssDaMarca } from "../../workers/motor-codigo/lib/projeto";
import { configDoOpencode } from "../../workers/motor-codigo/lib/config-opencode";

/**
 * Frente SIT (30/09): peças puras do worker do motor (workers/motor-codigo):
 * o medidor do custo real do OpenRouter, o zip, o CSS da marca e a
 * configuração fechada do opencode.
 */

describe("medidor do custo real", () => {
  it("lê usage.cost da resposta inteira e do último evento do stream", () => {
    expect(custosDoTexto('{"id":"x","usage":{"prompt_tokens":10,"cost":0.00123}}')).toEqual([0.00123]);
    const stream = ['data: {"choices":[{"delta":{"content":"oi"}}]}', "", 'data: {"choices":[],"usage":{"cost":0.0042}}', "", "data: [DONE]"].join("\n");
    expect(custosDoTexto(stream)).toEqual([0.0042]);
    expect(custosDoTexto("data: {quebrado")).toEqual([]);
  });
});

describe("zip do código", () => {
  it("monta um zip válido (assinaturas, nomes em UTF-8 e conteúdo que volta igual)", () => {
    const texto = "export const oi = 'olá';\n".repeat(50);
    const z = Buffer.from(zipar([{ nome: "site/src/a.ts", bytes: new Uint8Array(Buffer.from(texto)) }, { nome: "site/public/x.bin", bytes: new Uint8Array([1, 2, 3]) }], new Date(2026, 8, 30, 10, 0, 0)));
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 22 + 10)).toBe(2);
    const metodo = z.readUInt16LE(8);
    const tamanho = z.readUInt32LE(18);
    const nomeLen = z.readUInt16LE(26);
    expect(z.slice(30, 30 + nomeLen).toString("utf8")).toBe("site/src/a.ts");
    const corpo = z.slice(30 + nomeLen, 30 + nomeLen + tamanho);
    expect(metodo).toBe(8);
    expect(inflateRawSync(corpo).toString("utf8")).toBe(texto);
  });
});

describe("CSS da marca e configuração do opencode", () => {
  it("destaque é a cor primária; DNA quase preto dá fundo escuro e texto claro", () => {
    const css = cssDaMarca({ paleta: [{ hex: "#00D52B", papel: "primária e destaque" }, { hex: "#111111", papel: "secundária e fundo" }, { hex: "#F7F7F7", papel: "fundo e texto sobre" }], dna: { atributos: [{ id: "quase_preto" }] } });
    expect(css).toMatch(/--cor-destaque: #00d52b;/);
    expect(css).toMatch(/--cor-fundo: #111111;/);
    expect(css).toMatch(/--cor-texto: #f5f5f3;/);
    const claro = cssDaMarca({ paleta: [{ hex: "#880516", papel: "primária" }, { hex: "#FFFFFF", papel: "fundo" }], dna: { atributos: [{ id: "claro_editorial" }] } });
    expect(claro).toMatch(/--cor-fundo: #ffffff;/);
    expect(claro).toMatch(/--cor-texto: #111111;/);
  });

  it("o opencode recebe só o modelo escolhido, com o preço do catálogo, e permissões fechadas", () => {
    const c = configDoOpencode({ id: "m", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_000_000 }, "http://127.0.0.1:9/api/v1") as any;
    expect(c.model).toBe("openrouter/deepseek/deepseek-v4-flash");
    expect(c.enabled_providers).toEqual(["openrouter"]);
    expect(c.provider.openrouter.options).toEqual({ apiKey: "{env:OPENROUTER_API_KEY}", baseURL: "http://127.0.0.1:9/api/v1" });
    expect(c.provider.openrouter.models["deepseek/deepseek-v4-flash"].cost).toEqual({ input: 0.0763, output: 0.1526, cache_read: 0.01526 });
    expect(c.permission.webfetch).toBe("deny");
    // SPM (revisão): pasta de fora negada, com "*" primeiro; só as skills do vendor liberadas (anexos das skills).
    expect(c.permission.external_directory["*"]).toBe("deny");
    expect(Object.keys(c.permission.external_directory)[0]).toBe("*");
    expect(c.permission.bash["*"]).toBe("deny");
    expect(c.permission.bash["npm run checar"]).toBe("allow");
    expect(JSON.stringify(c)).not.toMatch(/sk-or-/);
    // SPM (30/09): "*" negado vem PRIMEIRO (a última regra que casa vence; com ele no fim o bash sumia),
    // o conferir da seção liberado, sem pergunta nem subagente, e as skills do construir por padrão.
    expect(Object.keys(c.permission.bash)[0]).toBe("*");
    expect(c.permission.bash["node scripts/conferir.mjs*"]).toBe("allow");
    expect(c.permission.question).toBe("deny");
    expect(c.permission.task).toBe("deny");
    expect(c.permission.skill["*"]).toBe("deny");
    expect(c.permission.skill["writing-plans"]).toBe("allow");
    // Revisão da SPM: o pacote aprovado é o desenho; brainstorming não entra no construir.
    expect(c.permission.skill.brainstorming).toBeUndefined();
    expect(c.permission.skill["using-git-worktrees"]).toBeUndefined();
    // A edição é liberada, menos a casca e o que roda na máquina.
    expect(c.permission.edit["*"]).toBe("allow");
    expect(c.permission.edit["package.json"]).toBe("deny");
    expect(c.permission.edit["scripts/*"]).toBe("deny");
    // Integração UIM + SPM: a skill da casa (ui-ux-pro-max) e as skills do superpowers vendorizado.
    expect(c.skills.paths.length).toBe(2);
  });
});

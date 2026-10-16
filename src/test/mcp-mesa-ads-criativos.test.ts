import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";
import { acaoPermitida, laminasDoTrabalho, prazoDaAcao } from "../../supabase/functions/_shared/mcp-mesas-ponte";

/**
 * MCP 2.12 (pedido do dono em 16/10/2026): os agentes do Paperclip gravavam
 * briefing na Mesa Ads, mas travavam no plano e na arte ("faltam as
 * ferramentas de criação de plano e geração de arte no Estúdio Ads"). O
 * caminho é o mesmo da tela: plano_gerar, criativos_produzir, a fila do
 * Estúdio (enfileirar) e o pacote do gestor (pacote_enviar). Mexer na conta
 * da Meta continua fora da ponte.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const acoes = ler("supabase/functions/_shared/mcp-mesas-acoes.ts");

const NOVAS = [
  "aceleriq_mesa_ads_plano_gerar",
  "aceleriq_mesa_ads_criativos_produzir",
  "aceleriq_mesa_ads_arte_gerar",
  "aceleriq_mesa_ads_entregar_ao_gestor",
];
const PAGAS = ["aceleriq_mesa_ads_plano_gerar", "aceleriq_mesa_ads_criativos_produzir", "aceleriq_mesa_ads_arte_gerar"];

/** O trecho da definição da ferramenta, do nome até o fim da chamada ferramentaDeMesa(...). */
function definicao(nome: string): string {
  const i = tools.indexOf(`  '${nome}',\n`);
  expect(i).toBeGreaterThan(0);
  const fim = tools.indexOf("\n);\n", i);
  expect(fim).toBeGreaterThan(i);
  return tools.slice(i, fim);
}

describe("Mesa Ads pelo MCP: plano, criativos, arte e gestor", () => {
  it("versão 2.12 com as quatro ferramentas, escopo mesas:write e no registro", () => {
    const [maior, menor] = MCP_VERSION.split(".").map(Number);
    expect(maior > 2 || (maior === 2 && menor >= 12)).toBe(true);
    const registro = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["), tools.indexOf("export const TOOLS: readonly ToolDefinition[]"));
    for (const nome of NOVAS) {
      expect(tools).toContain(`${nome}: 'mesas:write'`);
      expect(definicao(nome)).not.toMatch(/[–—]/);
    }
    for (const v of ["adsPlanoGerarTool,", "adsCriativosProduzirTool,", "adsArteGerarTool,", "adsEntregarAoGestorTool,"]) {
      expect(registro).toContain(v);
    }
  });

  it("o mapa do painel aponta as quatro na Mesa Ads", () => {
    const linha = tools.split("\n").find((l) => l.includes("area: 'Mesa Ads', rota: '/mesa-ads'")) ?? "";
    for (const nome of NOVAS) expect(linha).toContain(nome);
  });

  it("a ponte abre só o caminho da tela; conta da Meta e geração fora da fila continuam fechadas", () => {
    expect(acaoPermitida("mesa-ads", "plano_gerar")).toBe(true);
    expect(acaoPermitida("mesa-ads", "criativos_produzir")).toBe(true);
    expect(acaoPermitida("mesa-ads", "pacote_enviar")).toBe(true);
    expect(acaoPermitida("estudio-arte", "enfileirar")).toBe(true);
    expect(acaoPermitida("mesa-ads", "conta_acao_executar")).toBe(false);
    expect(acaoPermitida("mesa-ads", "conta_montagem_ativar")).toBe(false);
    expect(acaoPermitida("mesa-ads", "gerenciador_acao")).toBe(false);
    expect(acaoPermitida("estudio-arte", "gerar_card")).toBe(false);
    expect(acaoPermitida("estudio-arte", "publicacao_agora")).toBe(false);
  });

  it("plano e criativos esperam a IA; a fila e o pacote respondem na hora", () => {
    expect(prazoDaAcao("mesa-ads", "plano_gerar")).toBeGreaterThan(300_000);
    expect(prazoDaAcao("mesa-ads", "criativos_produzir")).toBeGreaterThan(300_000);
    expect(prazoDaAcao("estudio-arte", "enfileirar")).toBe(60_000);
    expect(prazoDaAcao("mesa-ads", "pacote_enviar")).toBe(60_000);
  });

  it("o que gasta IA exige confirmar_custo; a entrega ao gestor não gasta", () => {
    for (const nome of PAGAS) expect(definicao(nome)).toContain("confirmar_custo: z.literal(true)");
    expect(definicao("aceleriq_mesa_ads_entregar_ao_gestor")).not.toContain("confirmar_custo");
  });

  it("criativos vão um ângulo por chamada (a tela também chama um por vez)", () => {
    // O id do ângulo é curto ("a1", "a2"), dado pelo plano.
    expect(definicao("aceleriq_mesa_ads_criativos_produzir")).toContain("angulo_id: ID_DO_ANGULO");
  });

  it("lâminas do trabalho: o que já tem arte e o que falta gerar", () => {
    const trabalho = {
      tipo: "ads",
      direcao: { cards: [{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }] },
      cards: [
        { ordem: 1, versao: 1, storage_path: "a.png" },
        { ordem: 1, versao: 2, storage_path: "b.png" },
        { ordem: 3, versao: 1, storage_path: "" },
      ],
    };
    expect(laminasDoTrabalho(trabalho)).toEqual({ ordens: [1, 2, 3], com_arte: [1], sem_arte: [2, 3] });
    expect(laminasDoTrabalho({ direcao: null, cards: null })).toEqual({ ordens: [], com_arte: [], sem_arte: [] });
  });

  it("arte só de criativo de anúncio, e o gestor só recebe criativo com toda a arte pronta", () => {
    expect(acoes).toContain("falha('nao_e_anuncio'");
    expect(acoes).toContain("falha('criativos_sem_arte'");
    // Pela fila do Estúdio, com a conferência e a autocorreção da tela.
    expect(acoes).toContain("chamarMesa('estudio-arte', 'enfileirar'");
    expect(acoes).toContain("chamarMesa('mesa-ads', 'pacote_enviar'");
    expect(acoes).toContain("criar_tarefa: true");
  });
});

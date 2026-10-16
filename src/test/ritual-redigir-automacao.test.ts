import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";

/**
 * Texto do ritual por automação (MCP 2.10.0, 14/10/2026): o n8n e o Hermes pedem o MESMO texto da Central
 * sem login de pessoa e sem efeito colateral. Nada é gravado; o texto volta marcado como proposta automática.
 */
const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("aceleriq_ritual_redigir", () => {
  const tools = ler("supabase/functions/_shared/mcp-tools.ts");
  const modulo = ler("supabase/functions/mcp-server/modulos/ritual-automatico.ts");
  const codigo = modulo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("registrada no MCP 2.10 com escopo de escrita de relatório (gasta modelo pago)", () => {
    expect(MCP_VERSION).toBe("2.12.1");
    expect(tools).toContain("aceleriq_ritual_redigir: 'reports:write'");
    expect(tools).toContain("name: 'aceleriq_ritual_redigir'");
    expect(tools).toContain("  ritualRedigirTool,\n");
    expect(ler("supabase/functions/mcp-server/mcp_test.ts")).toContain("'aceleriq_ritual_redigir',");
  });

  it("usa o mesmo escritor, contexto, estado real e julgamentos da Central", () => {
    expect(codigo).toContain("from '../../ritual-writer/escritor.ts'");
    expect(codigo).toContain("escreverRitual(");
    expect(codigo).toContain("lerContextoDoRitual(");
    expect(codigo).toContain("lerEstadoReal(");
    expect(codigo).toContain("julgarDaCentral(");
    expect(codigo).toContain("superpoderesPara(banco, { agente: 'rituais.escritor' })");
  });

  it("confere o escopo da chave e o cliente antes de ler qualquer coisa", () => {
    const acesso = codigo.indexOf("assertClientAccess(ctx, input.client_id)");
    const existe = codigo.indexOf("exigirClienteExistente(");
    const primeiraLeitura = codigo.indexOf(".from('profiles')");
    expect(acesso).toBeGreaterThan(0);
    expect(existe).toBeGreaterThan(acesso);
    expect(primeiraLeitura).toBeGreaterThan(existe);
  });

  it("não grava relatório, não cria tarefa e não reforça promessas", () => {
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(codigo).not.toContain("reforcarPromessas");
    expect(codigo).not.toMatch(/\.rpc\(/);
  });

  it("devolve o texto como proposta automática, nunca confirmada pelo dono", () => {
    expect(codigo).toContain("origem: 'automacao'");
    expect(codigo).toContain("confirmado_pelo_dono: false");
    expect(codigo).toContain("Nada foi gravado");
  });
});

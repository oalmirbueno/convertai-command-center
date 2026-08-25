import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O funil comercial no MCP: leitura, e só leitura.
 *
 * A auditoria encontrou o buraco: o CRM inteiro era invisível para os
 * agentes — nenhuma tool tocava commercial_leads. A entrada dele no
 * catálogo tem réguas duras: escopo próprio registrado em TODAS as pontas,
 * invisível para chave restrita a cliente, campo vazio dito como "não
 * confirmado", e nenhuma escrita. Cada régua aqui quebraria em silêncio.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

describe("o funil comercial entra no MCP somente como leitura", () => {
  it("a tool existe, e no catalogo, e o servico devolve nao_confirmado no vazio", () => {
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    expect(tools).toContain("'aceleriq_list_opportunities'");
    expect(tools).toContain("listOpportunitiesTool,");
    // Filtros pelas tres classes + o estado visivel de nao confirmado.
    expect(tools).toContain("'cliente_atual', 'upsell', 'novo_prospect', 'sem_classe'");

    const servico = ler("supabase/functions/_shared/aceleriq-read-services.ts");
    expect(servico).toContain("export async function listOpportunities");
    expect(servico).toContain("'nao_confirmado'");
    // So leitura: o servico nunca insere, atualiza ou apaga no funil.
    const corpo = servico.slice(
      servico.indexOf("export async function listOpportunities"),
      servico.indexOf("export async function listClients"),
    );
    expect(corpo).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("area interna: chave restrita a cliente recebe lista vazia, nunca o funil", () => {
    const servico = ler("supabase/functions/_shared/aceleriq-read-services.ts");
    const corpo = servico.slice(
      servico.indexOf("export async function listOpportunities"),
      servico.indexOf("export async function listClients"),
    );
    expect(corpo).toContain("if (!ctx.dataScope.unrestricted)");
    // E a tool NAO entra na lista de tools liberadas para principal
    // restrito: ausencia ali e negacao por padrao.
    const seguranca = ler("supabase/functions/_shared/mcp-security.ts");
    const lista = seguranca.slice(
      seguranca.indexOf("CLIENT_SCOPED_LEGACY_TOOLS"),
      seguranca.indexOf("CLIENT_SCOPED_LEGACY_TOOL_SET"),
    );
    expect(lista).not.toContain("aceleriq_list_opportunities");
  });

  it("o escopo commercial:read esta registrado em todas as pontas", () => {
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    expect(tools).toContain("| 'commercial:read'");
    expect(tools).toContain("'commercial:read': { title: 'Comercial — leitura'");
    expect(tools).toContain("aceleriq_list_opportunities: 'commercial:read'");
    // O guarda-chuva aceleriq:read expande para ele nas DUAS tabelas de
    // expansao — uma so atualizada e chave antiga perde o funil.
    const expansaoTools = tools.slice(tools.indexOf("SCOPE_EXPANSIONS"));
    expect(expansaoTools).toContain("'commercial:read',");
    const auth = ler("supabase/functions/_shared/mcp-auth.ts");
    expect(auth).toContain("'commercial:read'");
    const seguranca = ler("supabase/functions/_shared/mcp-security.ts");
    expect(seguranca).toContain("'commercial:read',");
    const metadata = ler("supabase/functions/mcp-oauth-metadata/index.ts");
    expect(metadata).toContain("'commercial:read',");
  });

  it("a versao subiu junto nos dois lugares", () => {
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    const metadata = ler("supabase/functions/mcp-oauth-metadata/index.ts");
    const naFerramenta = tools.match(/version: '(\d+\.\d+\.\d+)'/);
    const noMetadata = metadata.match(/MCP_VERSION = '(\d+\.\d+\.\d+)'/);
    expect(naFerramenta?.[1]).toBe(noMetadata?.[1]);
    // Piso, nao pino: 1.21.0 trouxe o comercial; versoes futuras nao quebram.
    const [maior, menor] = (naFerramenta?.[1] || "0.0.0").split(".").map(Number);
    expect(maior > 1 || (maior === 1 && menor >= 21)).toBe(true);
  });
});

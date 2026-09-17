import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CRM (2026-09-17): três defeitos e um acesso.
 *
 * 1. Coluna do funil sem rolagem: dez leads em "Novo" empurravam a página.
 * 2. Edição que "não salvava": o botão ficava no meio da janela e fechar no X
 *    descartava tudo em silêncio. Nas 24h anteriores o banco não recebeu
 *    NENHUMA atualização de lead, só criações.
 * 3. Salvar apagava dado: o corpo inteiro ia no update e todo campo ausente
 *    (próxima ação, empresa, contato) virava null.
 * 4. O MCP só listava oportunidades; agora tem o CRM inteiro (1.44.0).
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const kanban = ler("src/components/comercial/FunilKanban.tsx");
const pagina = ler("src/pages/AdminComercial.tsx");
const lib = ler("src/lib/comercial.ts");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const servico = ler("supabase/functions/_shared/aceleriq-commercial-services.ts");
const auth = ler("supabase/functions/_shared/mcp-auth.ts");
const seguranca = ler("supabase/functions/_shared/mcp-security.ts");
const metadata = ler("supabase/functions/mcp-oauth-metadata/index.ts");

describe("o funil rola por dentro da coluna", () => {
  it("a coluna tem altura máxima e a lista de cartões rola sozinha", () => {
    expect(kanban).toContain("flex max-h-[calc(100dvh-15rem)] min-h-[12rem]");
    expect(kanban).toContain("min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain");
  });

  it("o alvo de soltar fica fora da rolagem, sempre visível", () => {
    const lista = kanban.indexOf("overflow-y-auto overscroll-contain");
    const alvo = kanban.indexOf('{isOver ? "soltar aqui"');
    const fimDaLista = kanban.indexOf("</div>", kanban.indexOf("))}", lista));
    expect(alvo).toBeGreaterThan(fimDaLista);
  });
});

describe("editar um lead salva de verdade", () => {
  it("fechar a janela com edição pendente salva em vez de descartar", () => {
    expect(pagina).toContain("const sujo = JSON.stringify(form) !== formInicial;");
    expect(pagina).toContain("if (lead && sujo && !salvando) {");
    expect(pagina).toContain("<Dialog open onOpenChange={(aberto) => { if (!aberto) void fechar(); }}>");
  });

  it("a barra de salvar fica grudada no pé da janela e a tela mostra o motivo da recusa", () => {
    expect(pagina).toContain('className="sticky bottom-0 z-10');
    expect(pagina).toContain("ultimoErroDoComercial()");
  });

  it("o update grava só os campos mandados e acusa quando a política recusa em silêncio", () => {
    const fn = lib.slice(lib.indexOf("export async function salvarLead("), lib.indexOf("export async function moverLead("));
    expect(fn).toContain("const mandados = new Set(Object.keys(lead));");
    expect(fn).toContain(".update(parcial as never)");
    expect(fn).not.toContain(".update(corpo as never)");
    expect(fn).toContain('.select("id");');
    expect(fn).toContain("Sua conta não tem permissão para editar este lead.");
  });
});

describe("o MCP tem o CRM inteiro na 1.44.0", () => {
  const NOVAS = [
    "aceleriq_get_opportunity", "aceleriq_create_opportunity", "aceleriq_update_opportunity",
    "aceleriq_move_opportunity", "aceleriq_add_opportunity_note", "aceleriq_archive_opportunity",
    "aceleriq_list_commercial_activities", "aceleriq_create_commercial_activity",
    "aceleriq_complete_commercial_activity", "aceleriq_list_commercial_organizations",
    "aceleriq_upsert_commercial_organization", "aceleriq_upsert_commercial_contact",
  ];
  const registro = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["), tools.indexOf("export const TOOLS: readonly ToolDefinition[]"));

  it("as doze tools existem, estão registradas e têm escopo granular de comercial", () => {
    for (const nome of NOVAS) {
      expect(tools).toContain(`'${nome}'`);
      expect(tools).toMatch(new RegExp(`${nome}: 'commercial:(read|write)'`));
    }
    for (const variavel of ["getOpportunityTool", "createOpportunityTool", "updateOpportunityTool", "moveOpportunityTool", "addOpportunityNoteTool", "archiveOpportunityTool", "listCommercialActivitiesTool", "createCommercialActivityTool", "completeCommercialActivityTool", "listCommercialOrganizationsTool", "upsertCommercialOrganizationTool", "upsertCommercialContactTool"]) {
      expect(registro).toContain(`  ${variavel},`);
    }
  });

  it("o escopo commercial:write está em todas as pontas, como o de leitura", () => {
    expect(tools).toContain("| 'commercial:write'");
    expect(tools).toContain("'commercial:write': { title: 'Comercial — escrita'");
    expect(tools).toContain("'editorial:write', 'clients:write', 'commercial:write',");
    expect(auth).toContain("'editorial:write','commercial:write']");
    expect(seguranca).toContain("'commercial:write',");
    expect(metadata).toContain("'commercial:read', 'commercial:write',");
  });

  it("toda função do serviço recusa credencial restrita a cliente", () => {
    const funcoes = servico.match(/export async function \w+\([^)]*ctx: AuthContext\) \{\n  soDaCasa\(ctx\);/g) ?? [];
    expect(funcoes.length).toBe(12);
    expect(servico).toContain("esta credencial e restrita a cliente e nao alcanca o CRM");
  });

  it("mover repete as regras da tela: perdido pede motivo, fechamento carimba data, toda passagem vira evento", () => {
    const fn = servico.slice(servico.indexOf("export async function moveOpportunity("), servico.indexOf("export async function addOpportunityNote("));
    expect(fn).toContain("if (para === 'perdido' && (!motivo || motivo.length < 3))");
    expect(fn).toContain("closed_at: fechou ? new Date().toISOString() : null");
    expect(fn).toContain("kind: 'stage', from_stage: lead.stage, to_stage: para");
  });

  it("editar pelo MCP também grava só o que veio, e criar nunca nasce fechado", () => {
    expect(servico).toContain("const tem = (k: keyof OpportunityInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;");
    expect(servico).toContain("input.stage !== 'ganho' && input.stage !== 'perdido' ? input.stage : 'novo'");
  });

  it("arquivar se anuncia destrutivo; as leituras são readOnly", () => {
    const arq = tools.slice(tools.indexOf("'aceleriq_archive_opportunity'"), tools.indexOf("const listCommercialActivitiesTool"));
    expect(arq).toContain("archiveOpportunity, true,");
    expect(tools).toContain("destructiveHint: destrutiva");
  });
});

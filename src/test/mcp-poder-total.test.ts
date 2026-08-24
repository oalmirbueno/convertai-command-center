import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const bundle = ler("supabase/functions/mcp/index.ts");
const indexFonte = ler("src/lib/mcp/index.ts");
const toolsRico = ler("supabase/functions/_shared/mcp-tools.ts");
const writeServices = ler("supabase/functions/_shared/mcp-write-services.ts");

/**
 * O relato do dono: "o MCP está muito limitado — não faz projeto, não
 * atualiza dossiê, não faz praticamente nada". Eram dois problemas:
 *
 * 1. O servidor pequeno (functions/mcp) tinha 9 ferramentas, e duas que as
 *    próprias instruções prometiam (get_client_journal, register_client_update)
 *    existiam SÓ no bundle — uma sessão antiga editou o arquivo gerado e
 *    esqueceu a fonte. Como o bundle é regenerado a partir da fonte, o
 *    próximo build as apagaria em silêncio.
 * 2. Nenhum dos dois servidores criava projeto.
 *
 * 1.5.0 completa a escrita nos dois e este arquivo guarda as fronteiras.
 */

const nomesDeFerramentas = (fonte: string) =>
  new Set([...fonte.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]));

describe("fonte e bundle do MCP pequeno andam juntos", () => {
  it("o conjunto de ferramentas é IDÊNTICO nos dois arquivos", () => {
    // O teste que teria pegado a divergência do diário um build antes.
    const daFonte = new Set<string>();
    for (const arquivo of readdirSync(resolve(raiz, "src/lib/mcp/tools"))) {
      for (const nome of nomesDeFerramentas(ler(`src/lib/mcp/tools/${arquivo}`))) {
        daFonte.add(nome);
      }
    }
    const doBundle = nomesDeFerramentas(bundle);
    expect([...daFonte].sort()).toEqual([...doBundle].sort());
  });

  it("as duas ferramentas de diário agora existem na fonte", () => {
    expect(ler("src/lib/mcp/tools/register-client-update.ts")).toContain('"register_client_update"');
    expect(ler("src/lib/mcp/tools/get-client-journal.ts")).toContain('"get_client_journal"');
    expect(indexFonte).toContain("registerClientUpdateTool");
    expect(indexFonte).toContain("getClientJournalTool");
  });

  it("versão 1.5.0 nos dois, registrando as quinze ferramentas", () => {
    expect(indexFonte).toContain('version: "1.5.0"');
    expect(bundle).toContain('version: "1.5.0"');
    for (const tool of ["createProjectTool", "updateProjectTool", "updateTaskTool", "completeTaskTool"]) {
      expect(indexFonte).toContain(tool);
    }
    for (const tool of ["create_project_default", "update_project_default", "update_task_default", "complete_task_default"]) {
      expect(bundle).toContain(tool);
    }
  });
});

describe("criar projeto tem fronteira de dinheiro nos dois servidores", () => {
  it("o pequeno cria só o operacional, com escopo de cliente e datas reais", () => {
    const fonte = ler("src/lib/mcp/tools/create-project.ts");
    expect(fonte).toContain("resolveMcpClientScope");
    expect(fonte).toContain("mcpScopeAllowsClient");
    expect(fonte).toContain("isValidIsoDate");
    expect(fonte).toContain('status: "planning"');
    // Cobrança nunca passa pelo INSERT: sem billing_mode, sem total_value.
    // (o comentário do arquivo pode citar os nomes; o payload não.)
    const payload = fonte.slice(fonte.indexOf(".insert({"), fonte.indexOf("}).select"));
    expect(payload.length).toBeGreaterThan(50);
    expect(payload).not.toContain("billing_mode");
    expect(payload).not.toContain("total_value");
  });

  it("o rico valida que client_id é cliente vivo e recusa datas invertidas", () => {
    expect(writeServices).toContain("export async function createProject(");
    expect(writeServices).toContain("client_id must be a client");
    expect(writeServices).toContain("'deadline must be >= start_date'");
    const trecho = writeServices.slice(
      writeServices.indexOf("export async function createProject("),
      writeServices.indexOf("export const updateProjectSchema"),
    );
    expect(trecho).not.toContain("billing_mode");
    expect(trecho).not.toContain("total_value");
    expect(trecho).toContain("replayIdempotent");
  });

  it("o rico registra a ferramenta com escopo de escrita de projetos", () => {
    expect(toolsRico).toContain("aceleriq_create_project: 'projects:write'");
    expect(toolsRico).toContain("name: 'aceleriq_create_project'");
    expect(toolsRico.replace(/\r\n/g, "\n")).toContain("  createProjectTool,\n  updateProjectTool,");
    // Piso, não número exato: pinar a versão faria este teste quebrar em
    // toda entrega legítima seguinte (o alinhamento entre as duas pontas
    // fica com painel-conversa.test.ts).
    const versao = toolsRico.match(/version: '(\d+)\.(\d+)\.\d+'/);
    expect(versao).toBeTruthy();
    expect(Number(versao![2])).toBeGreaterThanOrEqual(15);
  });
});

describe("corrigir e concluir sem sujar o Kanban", () => {
  it("update_task move status e kanban_status juntos", () => {
    // O Kanban lê kanban_status; só status atualizado esconderia a mudança.
    const fonte = ler("src/lib/mcp/tools/update-task.ts");
    expect(fonte).toContain("patch.status = status");
    expect(fonte).toContain("patch.kanban_status = status");
    expect(fonte).toContain("normalizeTaskStatus");
    // Trocar de projeto é decisão de painel.
    expect(fonte).not.toContain("project_id:");
  });

  it("complete_task recusa concluir de novo", () => {
    const fonte = ler("src/lib/mcp/tools/complete-task.ts");
    expect(fonte).toContain('existente.status === "done"');
    expect(fonte).toContain('{ status: "done", kanban_status: "done" }');
  });

  it("update_project não alcança cliente, cobrança nem marca", () => {
    const fonte = ler("src/lib/mcp/tools/update-project.ts");
    for (const proibido of ["client_id", "billing_mode", "total_value", "brand"]) {
      const lista = fonte.slice(fonte.indexOf("const CAMPOS"), fonte.indexOf("] as const"));
      expect(lista).not.toContain(`"${proibido}"`);
    }
  });
});

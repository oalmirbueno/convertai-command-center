import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Versão 1.41.0: cinco tools novas no MCP.
 *
 * Cada teste pina uma REGRA: o nome está registrado (definido E na lista),
 * o escopo é o da vizinha, e a regra de exclusão do servidor é a MESMA do
 * painel — a regex de "tarefa de pedido do cliente" tem que ser idêntica nos
 * dois lados, senão o painel recusa o que o MCP apaga.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const escrita = ler("supabase/functions/_shared/mcp-write-services.ts");
const leitura = ler("supabase/functions/_shared/aceleriq-read-services.ts");
const seguranca = ler("supabase/functions/_shared/mcp-security.ts");
const metadata = ler("supabase/functions/mcp-oauth-metadata/index.ts");

const NOVAS = [
  "aceleriq_delete_task",
  "aceleriq_link_project_to_client",
  "aceleriq_register_dossier_progress",
  "aceleriq_get_cycle_status",
  "aceleriq_get_agenda_status",
] as const;

const registro = tools.slice(
  tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["),
  tools.indexOf("export const TOOLS: readonly ToolDefinition[]"),
);

describe("as cinco tools da 1.41.0 existem", () => {
  it("cada nome está definido e entra na lista RAW_TOOLS", () => {
    for (const nome of NOVAS) {
      expect(tools).toContain(`'${nome}'`);
    }
    for (const variavel of [
      "deleteTaskTool",
      "linkProjectToClientTool",
      "registerDossierProgressTool",
      "getCycleStatusTool",
      "getAgendaStatusTool",
    ]) {
      expect(tools).toContain(`const ${variavel}`);
      expect(registro).toContain(`  ${variavel},`);
    }
  });

  it("a versão subiu para 1.41.0 nos dois arquivos", () => {
    expect(tools).toContain("version: MCP_VERSION");
    expect(metadata).toContain("import { MCP_VERSION } from '../_shared/mcp-release.ts'");
  });

  it("todo inputSchema novo fecha com additionalProperties:false", () => {
    for (const nome of NOVAS) {
      const inicio = tools.indexOf(`'${nome}'`);
      const trecho = tools.slice(inicio, inicio + 4000);
      const fim = trecho.indexOf("handler:");
      expect(trecho.slice(0, fim)).toContain("additionalProperties: false");
    }
  });
});

describe("os escopos são os das vizinhas", () => {
  it("delete_task escreve tarefas; link_project_to_client escreve projetos; agenda lê editorial", () => {
    expect(tools).toContain("aceleriq_delete_task: 'tasks:write'");
    expect(tools).toContain("aceleriq_link_project_to_client: 'projects:write'");
    expect(tools).toContain("aceleriq_get_agenda_status: 'editorial:read'");
  });

  it("register_dossier_progress usa o mesmo escopo de upsert_current_dossier", () => {
    const upsert = tools.slice(tools.indexOf("name: 'aceleriq_upsert_current_dossier'"));
    const progresso = tools.slice(tools.indexOf("name: 'aceleriq_register_dossier_progress'"));
    const escopoDe = (t: string) => t.match(/scopes: (\[[^\]]*\]|[A-Z_]+)/)?.[1];
    expect(escopoDe(upsert)).toBe("['clients:write']");
    expect(escopoDe(progresso)).toBe(escopoDe(upsert));
  });

  it("get_cycle_status usa o mesmo escopo de get_weekly_cycle", () => {
    const semanal = tools.slice(tools.indexOf("name: 'aceleriq_get_weekly_cycle'"));
    const situacao = tools.slice(tools.indexOf("name: 'aceleriq_get_cycle_status'"));
    const escopoDe = (t: string) => t.match(/scopes: (\[[^\]]*\]|[A-Z_]+)/)?.[1];
    expect(escopoDe(semanal)).toBe("['projects:read']");
    expect(escopoDe(situacao)).toBe(escopoDe(semanal));
  });

  it("delete_task se anuncia destrutiva; as leituras são readOnly", () => {
    const del = tools.slice(tools.indexOf("name: 'aceleriq_delete_task'"), tools.indexOf("name: 'aceleriq_delete_task'") + 800);
    expect(del).toContain("destructiveHint: true");
    const ciclo = tools.slice(tools.indexOf("name: 'aceleriq_get_cycle_status'"), tools.indexOf("name: 'aceleriq_get_cycle_status'") + 1200);
    expect(ciclo).toContain("annotations: READ_ANNOTATIONS");
    // getAgendaStatusTool nasce de makeRead, que aplica READ_ANNOTATIONS.
    expect(tools).toContain("const getAgendaStatusTool = makeRead(");
  });

  it("chave restrita a cliente alcança só o que tem fronteira de cliente, como as vizinhas", () => {
    const lista = seguranca.slice(
      seguranca.indexOf("export const CLIENT_SCOPED_LEGACY_TOOLS"),
      seguranca.indexOf("const CLIENT_SCOPED_LEGACY_TOOL_SET"),
    );
    // Vizinhas de update/complete_task e list_editorial_calendar estão na lista.
    expect(lista).toContain("'aceleriq_delete_task'");
    expect(lista).toContain("'aceleriq_get_agenda_status'");
    // Vizinhas de upsert_current_dossier e get_weekly_cycle NÃO estão; mover
    // projeto entre clientes é operação da casa.
    expect(lista).not.toContain("aceleriq_register_dossier_progress");
    expect(lista).not.toContain("aceleriq_get_cycle_status");
    expect(lista).not.toContain("aceleriq_link_project_to_client");
  });
});

describe("delete_task repete a regra do painel", () => {
  it("a regex de tarefa de pedido do cliente é idêntica à do frontend", () => {
    const frontend = ler("src/lib/requestTaskWorkflow.ts");
    const regexDoPainel = frontend.match(/SIGNED_SOURCE_PATTERN =\s*(\/.+\/i);/)?.[1];
    const regexDoServidor = escrita.match(/CLIENT_REQUEST_SOURCE_PATTERN =\s*(\/.+\/i);/)?.[1];
    expect(regexDoPainel).toBeTruthy();
    expect(regexDoServidor).toBe(regexDoPainel);
  });

  it("recusa publicação agendada ou no ar com a mensagem que orienta", () => {
    const fn = escrita.slice(escrita.indexOf("export async function deleteTask("));
    expect(fn).toContain(".from('editorial_post_internal')");
    expect(fn).toContain(".in('status', ['scheduled', 'published'])");
    expect(fn).toContain("Cancele o agendamento na agenda antes de excluir a tarefa.");
    expect(fn).toContain("arquive a pauta se não quiser mais vê-la.");
    expect(fn).toContain("Desvincule e reabra o pedido em vez de excluir.");
  });

  it("depois de excluir, bloqueia o vínculo de operador e registra no diário", () => {
    const fn = escrita.slice(escrita.indexOf("export async function deleteTask("));
    expect(fn).toContain(".from('tasks').delete()");
    expect(fn).toContain(".from('operator_task_links')");
    expect(fn).toContain("status: 'blocked'");
    expect(fn).toContain("Tarefa excluída via MCP");
    expect(fn).toContain("kind: 'ciclo'");
    expect(fn).toContain("registro: 'descartada'");
    expect(fn).toContain("via: 'mcp'");
  });
});

describe("as outras escritas e leituras", () => {
  it("link_project_to_client exige cliente ativo com papel client e registra a origem", () => {
    const fn = escrita.slice(escrita.indexOf("export async function linkProjectToClient("));
    expect(fn).toContain("r.role === 'client'");
    expect(fn).toContain(".update({ client_id: input.client_id })");
    expect(fn).toContain("kind: 'nota'");
    expect(fn).toContain("Projeto vinculado:");
    expect(fn).toContain("from_client_id: projeto.client_id");
  });

  it("register_dossier_progress chama a RPC do banco e lê o dossiê geral", () => {
    const fn = escrita.slice(escrita.indexOf("export async function registerDossierProgress("));
    expect(fn).toContain(".rpc('dossie_registrar_avancos', { _client_id: input.client_id })");
    expect(fn).toContain(".eq('dossier_type', 'contexto')");
    expect(fn).toContain(".is('project_id', null)");
  });

  it("get_cycle_status cruza etapas, plano congelado e tarefas ciclo:*", () => {
    const fn = leitura.slice(leitura.indexOf("export async function getCycleStatus("));
    // A semana default nasce do fuso da operação, não do relógio do servidor.
    const helper = leitura.slice(leitura.indexOf("function hojeEmSaoPaulo("), leitura.indexOf("function segundaDaSemana("));
    expect(helper).toContain("timeZone: 'America/Sao_Paulo'");
    expect(fn).toContain("segundaDaSemana(opts.week_start ?? hojeEmSaoPaulo())");
    expect(fn).toContain("'step, done_at, done_by, auto, proof'");
    expect(fn).toContain(".eq('kind', 'ciclo_semana')");
    expect(fn).toContain(".like('source', 'ciclo:%')");
  });

  it("get_agenda_status entrega os quatro recortes e o diagnóstico", () => {
    const fn = leitura.slice(leitura.indexOf("export async function getAgendaStatus("));
    expect(fn).toContain(".eq('status', 'scheduled')");
    expect(fn).toContain(".eq('status', 'published')");
    expect(fn).toContain(".eq('production_status', 'ready')");
    expect(fn).toContain(".is('primary_file_id', null)");
    expect(fn).toContain("agenda vazia");
    expect(fn).toContain("conteúdo pronto na gaveta");
    expect(fn).toContain("agenda coberta até");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260824120000_dossie_estado_atual.sql");
const writeServices = ler("supabase/functions/_shared/mcp-write-services.ts");
const readServices = ler("supabase/functions/_shared/aceleriq-read-services.ts");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const metadata = ler("supabase/functions/mcp-oauth-metadata/index.ts");
const card = ler("src/components/admin/DossieDoCliente.tsx");

/**
 * A correção estrutural do dossiê, para TODOS os clientes.
 *
 * O relato: o card do painel escolhia "o registro mais novo dentro de uma
 * lista de tipos" de project_memory, e o upsert cumulativo não mantinha
 * estado — dossiê velho aparecia como atual e atualização nova sumia da
 * tela. O desenho novo tem duas camadas: project_memory segue como
 * HISTÓRIA intocável; client_dossiers guarda o ESTADO ATUAL com um único
 * is_current por chave, versão sequencial, supersede não destrutivo e
 * bloqueio de regressão. Estes testes guardam cada fronteira do desenho.
 */

describe("a tabela de estado atual", () => {
  it("um e só um atual por chave, garantido por índice e não por disciplina", () => {
    expect(migration).toContain("create unique index if not exists client_dossiers_um_atual");
    expect(migration).toContain("where is_current");
    // project_id nulo normalizado: null não colide com null em índice único.
    expect(migration).toContain("coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)");
  });

  it("replay de idempotência também é índice, não convenção", () => {
    expect(migration).toContain("client_dossiers_idempotencia");
    expect(migration).toContain("where idempotency_key is not null");
  });

  it("cliente nunca lê: dossiê é interno por RLS e por metadata", () => {
    expect(migration).toContain('"equipe le dossies"');
    // Só as quatro funções da equipe; nenhuma policy de escrita — escreve-se
    // apenas pelo RPC transacional.
    for (const papel of ["admin", "manager", "design", "traffic"]) {
      expect(migration).toContain(`'${papel}'::public.app_role`);
    }
    expect(migration).not.toContain("for insert");
    expect(migration).not.toContain("for update using");
    expect(migration).toContain("jsonb_build_object('client_visible', false)");
  });
});

describe("o RPC transacional de atualização", () => {
  it("supersede preserva: a versão velha é marcada, nunca apagada", () => {
    expect(migration).toContain("set is_current = false");
    expect(migration).toContain("superseded_at = now()");
    expect(migration).toContain("superseded_by = _novo.id");
    expect(migration).not.toContain("delete from public.client_dossiers");
  });

  it("regressão é bloqueada por expected_version, com conflito explícito", () => {
    // Atualização antiga nunca substitui a mais nova em silêncio: quem
    // escreve declara a versão que leu; mundo mudou = erro, não retrocesso.
    expect(migration).toContain("version_conflict");
    expect(migration).toContain("coalesce(_atual.version, 0) <> _expected_version");
  });

  it("a primeira gravação também vira fila, não corrida", () => {
    // for update não segura linha que não existe; o advisory lock da chave
    // serializa até o primeiro insert de cada cliente.
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("for update");
  });

  it("versão nova aponta a anterior e soma um", () => {
    expect(migration).toContain("coalesce(_atual.version, 0) + 1");
    expect(migration).toContain("prior_version_id");
  });

  it("só serviço ou equipe executam; anon não", () => {
    expect(migration).toContain("not_allowed: somente equipe atualiza dossie");
    expect(migration).toMatch(/revoke execute on function public\.upsert_current_dossier[\s\S]{0,200}from anon/);
  });
});

describe("a migração dos dossiês existentes", () => {
  it("semeia o atual do registro mais recente sem apagar nada", () => {
    expect(migration).toContain("distinct on (pm.client_id)");
    expect(migration).toContain("order by pm.client_id, pm.created_at desc");
    expect(migration).toContain("on conflict do nothing");
    expect(migration).not.toContain("delete from public.project_memory");
    expect(migration).not.toContain("update public.project_memory");
  });

  it("guarda de onde veio e ignora clientes removidos", () => {
    expect(migration).toContain("origem_project_memory_id");
    expect(migration).toContain("p.deleted_at is null");
  });
});

describe("as ferramentas do MCP rico", () => {
  it("upsert_current_dossier existe, com escopo próprio e motivo obrigatório", () => {
    expect(tools).toContain("name: 'aceleriq_upsert_current_dossier'");
    expect(tools).toContain("aceleriq_upsert_current_dossier: 'clients:write'");
    expect(writeServices).toContain("change_reason: z.string().trim().min(3).max(400),");
    expect(writeServices).toContain("rpc('upsert_current_dossier'");
  });

  it("o serviço traduz o conflito de versão em resposta, não em acidente", () => {
    expect(writeServices).toContain("if (msg.includes('version_conflict')) throw new WriteError('conflict', msg)");
  });

  it("a leitura par usa a chave canônica e devolve a versão para a próxima escrita", () => {
    expect(tools).toContain("name: 'aceleriq_get_current_dossier'");
    expect(readServices).toContain(".eq('is_current', true)");
    expect(readServices).toContain("current_version:");
    // Nunca por título, nunca o primeiro da lista.
    expect(readServices).not.toContain(".order('title'");
  });

  it("o dossiê completo do cliente inclui o estado atual canônico", () => {
    expect(readServices).toContain("current_dossiers: dossieAtual");
  });

  it("a auditoria global existe, é leitura pura e exige credencial sem restrição", () => {
    expect(tools).toContain("name: 'aceleriq_audit_integrity'");
    expect(readServices).toContain("audit requires an unrestricted principal");
    const trecho = readServices.slice(readServices.indexOf("export async function auditIntegrity"));
    expect(trecho).not.toContain(".update(");
    expect(trecho).not.toContain(".insert(");
    expect(trecho).not.toContain(".delete(");
  });

  it("upsert_project_memory avisa que não mantém estado atual", () => {
    expect(tools).toContain("NÃO mantém o estado atual do dossiê");
  });

  it("o escopo novo é anunciado onde o OAuth o descobre", () => {
    expect(tools).toContain("'clients:write'");
    expect(metadata).toContain("'clients:write'");
    // E entra na expansão do agregado, para as credenciais existentes.
    const expansao = tools.slice(tools.indexOf("'aceleriq:write': ["), tools.indexOf("];", tools.indexOf("'aceleriq:write': [")));
    expect(expansao).toContain("'clients:write'");
  });
});

describe("arquivar em vez de apagar, e todo arquivamento tem volta", () => {
  it("não existe exclusão definitiva de projeto ou tarefa no MCP", () => {
    // A regra da governança: o destrutivo vira arquivamento. O que sai da
    // vista continua no banco, com data de saída e caminho de retorno.
    const trecho = writeServices.slice(
      writeServices.indexOf("export async function archiveProject"),
      writeServices.indexOf("// ─── upsert_current_dossier"),
    );
    expect(trecho).not.toContain(".delete()");
    expect(trecho).toContain("deleted_at: new Date().toISOString()");
    expect(trecho).toContain("deleted_at: null");
  });

  it("arquivar e restaurar recusam o estado que já vale", () => {
    // Sem isso, arquivar duas vezes sobrescreveria a data original e a
    // história de quando o projeto saiu de vista se perderia.
    expect(writeServices).toContain("'project is already archived'");
    expect(writeServices).toContain("'project is not archived'");
    expect(writeServices).toContain("'task is not done; nothing to reopen'");
  });

  it("reabrir move status e kanban_status juntos", () => {
    const trecho = writeServices.slice(writeServices.indexOf("export async function reopenTask"));
    expect(trecho).toContain("{ status: destino, kanban_status: destino }");
  });

  it("as três ferramentas existem com escopo e motivo obrigatório", () => {
    for (const nome of ["aceleriq_archive_project", "aceleriq_restore_project", "aceleriq_reopen_task"]) {
      expect(tools).toContain(`name: '${nome}'`);
    }
    expect(tools).toContain("aceleriq_archive_project: 'projects:write'");
    expect(tools).toContain("aceleriq_reopen_task: 'tasks:write'");
    // Arquivar é o único que se anuncia destrutivo — restaurar e reabrir
    // devolvem coisas, não tiram.
    expect(tools).toContain("{ ...WRITE_ANNOTATIONS, destructiveHint: true }");
    expect(writeServices).toContain("reason: z.string().trim().min(3).max(400),");
  });
});

describe("o card do painel lê a chave canônica", () => {
  it("consulta client_dossiers com is_current antes de qualquer heurística", () => {
    const posCanonica = card.indexOf('from("client_dossiers")');
    const posLegado = card.indexOf('from("project_memory")');
    expect(posCanonica).toBeGreaterThan(-1);
    expect(posLegado).toBeGreaterThan(posCanonica);
    expect(card).toContain('.eq("is_current", true)');
    expect(card).toContain(".maybeSingle()");
  });

  it("mostra a data real da última atualização e a versão", () => {
    expect(card).toContain("atual?.updated_at ?? atual?.effective_at");
    expect(card).toContain("v{atual.version}");
  });

  it("o refresh invalida o card E o histórico", () => {
    expect(card).toContain('queryClient.invalidateQueries({ queryKey: chave })');
    expect(card).toContain('"dossie-historico"');
  });

  it("o histórico completo abre na própria caixa", () => {
    expect(card).toContain("Ver histórico");
    expect(card).toContain('.order("version", { ascending: false })');
  });
});

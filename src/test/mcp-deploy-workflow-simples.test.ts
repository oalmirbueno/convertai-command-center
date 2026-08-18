import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wf = readFileSync(
  resolve(__dirname, "../..", ".github/workflows/deploy-supabase-mcp.yml"),
  "utf8",
);

/**
 * O deploy do MCP nunca tinha rodado — nem uma vez. Morria em 12 segundos na
 * primeira checagem, com "Source relation: not-authorized", que soa como
 * problema de permissão e era campo vazio: exigia 7 variáveis preenchidas à
 * mão no ambiente production, e nenhuma estava lá.
 *
 * A correção deduz do próprio repositório o que é público e versionado. O
 * limite disso é o assunto destes testes: tentei também tornar opcionais a
 * conferência do ledger e a verificação autenticada pós-deploy, e um teste do
 * projeto barrou — com razão. Aquelas duas provam que o MCP subiu funcionando,
 * e continuam obrigatórias.
 */

describe("o que o workflow deduz sozinho", () => {
  it("lê o project id e a URL pública do arquivo versionado", () => {
    expect(wf).toContain("Derive public deployment configuration");
    expect(wf).toContain("config/public-env.production.json");
    expect(wf).toContain("VITE_SUPABASE_PROJECT_ID");
  });

  it("monta as URLs do MCP a partir do project id", () => {
    // À mão, essas quatro divergem com o tempo; derivadas, não têm como.
    expect(wf).toContain("MCP_RESOURCE_URL=${MCP_RESOURCE_URL:-$base/functions/v1/mcp-server}");
    expect(wf).toContain("MCP_AUTH_ISSUER=${MCP_AUTH_ISSUER:-$base/auth/v1}");
    expect(wf).toContain("MCP_OAUTH_METADATA_URL=${MCP_OAUTH_METADATA_URL:-$base");
  });

  it("o que estiver declarado no ambiente continua ganhando", () => {
    // A dedução é rede de segurança, não substituição de configuração.
    expect(wf).toContain('project_id="${SUPABASE_PROJECT_ID:-$do_repo_project}"');
    expect(wf).toContain('app_url="${APP_PUBLIC_URL:-$do_repo_app_url}"');
  });

  it("a dedução acontece antes da autorização, que depende dela", () => {
    expect(wf.indexOf("Derive public deployment configuration")).toBeLessThan(
      wf.indexOf("Authorize release or rollback target"),
    );
  });

  it("ainda valida o formato do project id antes de usar", () => {
    expect(wf).toContain('[[ "$project_id" =~ ^[a-z0-9]{20}$ ]]');
  });
});

describe("nada do que prova o deploy foi afrouxado", () => {
  it("o token de acesso do Supabase continua obrigatório", () => {
    // É a única coisa que ninguém deduz: sem ele não existe permissão para
    // publicar no projeto de outra pessoa.
    expect(wf).toContain('test -n "$SUPABASE_ACCESS_TOKEN"');
  });

  it("a conferência do ledger de migrations continua exigida", () => {
    expect(wf).toContain('test -n "$SUPABASE_DB_PASSWORD"');
  });

  it("a verificação autenticada pós-deploy continua exigida", () => {
    // Tentei torná-la opcional para encurtar a configuração. Um teste do
    // projeto (database-deploy-workflow) barrou, e estava certo: é ela que
    // prova que o MCP subiu respondendo de verdade.
    expect(wf).toContain('test -n "$MCP_SMOKE_TOKEN"');
    expect(wf).toContain("--require-authenticated");
  });

  it("as travas de origem do código seguem de pé", () => {
    expect(wf).toContain('test "$EVENT_REF" = "refs/heads/main"');
    expect(wf).toContain('test "$TARGET_SHA" = "$remote_main_sha"');
    expect(wf).toContain('test "$RELEASE_CONFIRMATION" = "DEPLOY_MCP_PRODUCTION"');
  });

  it("a lista de funções publicáveis não mudou", () => {
    expect(wf).toContain("supabase functions deploy mcp-server");
    expect(wf).toContain("supabase functions deploy mcp-oauth-metadata");
  });
});

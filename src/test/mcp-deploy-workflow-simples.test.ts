import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wf = readFileSync(
  resolve(__dirname, "../..", ".github/workflows/deploy-supabase-mcp.yml"),
  "utf8",
);

/**
 * O deploy do MCP nunca tinha rodado: exigia 7 variáveis e 5 segredos
 * configurados à mão, e morria em 12 segundos na primeira checagem vazia.
 *
 * A simplificação tem um limite claro, e é ele que estes testes guardam: pode
 * DEDUZIR o que é público e versionado, e pode PULAR uma verificação que
 * depende de segredo ausente — desde que registre o que pulou. O que não pode,
 * em hipótese alguma, é seguir em silêncio ou dispensar o token de acesso.
 */

describe("o que o workflow deduz sozinho", () => {
  it("lê o project id e a URL pública do arquivo versionado", () => {
    expect(wf).toContain("Derive public deployment configuration");
    expect(wf).toContain("config/public-env.production.json");
    expect(wf).toContain("VITE_SUPABASE_PROJECT_ID");
  });

  it("monta as URLs do MCP a partir do project id", () => {
    // À mão, essas quatro URLs divergem com o tempo; derivadas, não têm como.
    expect(wf).toContain("MCP_RESOURCE_URL=${MCP_RESOURCE_URL:-$base/functions/v1/mcp-server}");
    expect(wf).toContain("MCP_AUTH_ISSUER=${MCP_AUTH_ISSUER:-$base/auth/v1}");
  });

  it("o que estiver configurado no ambiente continua ganhando", () => {
    // A dedução é rede de segurança, não substituição de configuração.
    expect(wf).toContain('project_id="${SUPABASE_PROJECT_ID:-$from_repo_project}"');
  });

  it("ainda valida o formato do project id antes de usar", () => {
    expect(wf).toContain('[[ "$project_id" =~ ^[a-z0-9]{20}$ ]]');
  });
});

describe("o que pode ser pulado, e como", () => {
  it("sem senha do banco, a conferência do ledger é pulada com aviso", () => {
    expect(wf).toContain("status=pulado-sem-senha-do-banco");
    expect(wf).toMatch(/::warning::Sem SUPABASE_DB_PASSWORD/);
  });

  it("sem os segredos de smoke, a verificação autenticada é pulada com aviso", () => {
    expect(wf).toContain("authenticated=pulada");
    expect(wf).toMatch(/::warning::Sem os segredos MCP_SMOKE_/);
  });

  it("o resumo mostra o que foi pulado, em vez de esconder", () => {
    // Pular calado seria pior que falhar: daria a impressão de verificado.
    expect(wf).toContain("OAUTH_PREFLIGHT_DETAIL");
    expect(wf).toContain("Authenticated smoke:");
  });

  it("com os segredos presentes, a verificação forte continua obrigatória", () => {
    expect(wf).toContain('SMOKE_AUTH_FLAG="--require-authenticated"');
    expect(wf).toContain("authenticated=conferida");
  });
});

describe("o que NUNCA pode ser dispensado", () => {
  it("o token de acesso do Supabase continua obrigatório", () => {
    // É a única coisa que ninguém pode deduzir nem pular: sem ele não existe
    // permissão para publicar no projeto de outra pessoa.
    expect(wf).toContain('test -n "$SUPABASE_ACCESS_TOKEN"');
  });

  it("as travas de origem do código seguem de pé", () => {
    expect(wf).toContain('test "$EVENT_REF" = "refs/heads/main"');
    expect(wf).toContain('test "$TARGET_SHA" = "$remote_main_sha"');
    expect(wf).toContain('test "$RELEASE_CONFIRMATION" = "DEPLOY_MCP_PRODUCTION"');
  });

  it("a lista de funções que podem ser publicadas não mudou", () => {
    expect(wf).toContain("supabase functions deploy mcp-server");
    expect(wf).toContain("supabase functions deploy mcp-oauth-metadata");
  });
});

describe("a flag do smoke nunca é usada sem ser definida", () => {
  it("todo passo que usa a variável a define antes", () => {
    // Um erro meu na primeira tentativa: a flag foi trocada no comando antes
    // do bloco que a define existir, o que deixaria o workflow quebrado.
    const passos = wf.split(/^ {6}- name: /m);
    for (const passo of passos) {
      if (passo.includes("$SMOKE_AUTH_FLAG")) {
        expect(passo).toContain("SMOKE_AUTH_FLAG=");
      }
    }
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Conectar anúncios vira o mesmo clique que conecta o Instagram.
 *
 * São dois desenhos para o mesmo Business Manager, e o dos anúncios é o
 * pior: criar usuário do sistema, atribuir ativo por ativo, gerar token,
 * copiar antes que suma, colar no painel — por conta. O do Instagram é um
 * login e uma tela de consentimento.
 *
 * O login que já existe termina guardando um token de usuário de longa
 * duração. Com `ads_read`, esse mesmo token já lê as contas de anúncio.
 * Não faltava infraestrutura: faltava aproveitar o que já passa pela mão.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(raiz, "supabase/migrations/20260828100000_anuncios_pelo_mesmo_login.sql"), "utf8",
);
const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const meta = readFileSync(resolve(raiz, "supabase/functions/social-meta-oauth/meta.ts"), "utf8");
const edge = readFileSync(resolve(raiz, "supabase/functions/social-meta-oauth/index.ts"), "utf8");

describe("anuncios entram pelo login que ja funciona", () => {
  it("ads_read e PEDIDA, nunca exigida", () => {
    // Quem decide o que aparece no consentimento e a configuracao do
    // Login for Business. Exigir ads_read aqui faria TODA conexao de
    // Instagram falhar se ela nao estivesse ligada la, inclusive as que
    // funcionam hoje.
    expect(meta).toContain('META_OPTIONAL_SCOPES = ["ads_read"]');
    expect(meta).not.toMatch(/META_REQUIRED_SCOPES = \[[^\]]*ads_read/);
    expect(meta).toContain("[...META_REQUIRED_SCOPES, ...META_OPTIONAL_SCOPES]");
  });

  it("so colhe se a permissao veio de fato", () => {
    expect(edge).toContain('permissions.granted.includes("ads_read")');
  });

  it("falhar nos anuncios NAO derruba a conexao do Instagram", () => {
    // A pessoa veio conectar rede social. Quebrar o principal por causa
    // do acessorio troca um problema por outro pior.
    const bloco = edge.slice(edge.indexOf('permissions.granted.includes("ads_read")'));
    expect(bloco.slice(0, 900)).toContain("try {");
    expect(bloco.slice(0, 900)).toContain("} catch (error) {");
  });

  it("o token guardado vale para a carteira inteira", () => {
    // external_account_id nulo em ads_tokens ja significava isso: era o
    // desenho que ninguem conseguia alimentar sem o usuario do sistema.
    expect(codigo).toContain("values (null, _secret_id");
  });

  it("token igual nao gira o que ja funciona", () => {
    // Sem isto, cada reconexao de Instagram revogaria e recriaria o token
    // de anuncios a toa.
    expect(codigo).toContain("if _igual then");
    expect(codigo).toContain("'mudou', false");
  });

  it("a porta e estreita: so o servico grava por esse caminho", () => {
    // save_meta_ads_token exige admin na sessao, e no login nao ha sessao.
    // Reaproveita-la exigiria afrouxar a regra de quem grava token.
    expect(codigo).toContain("from anon, authenticated");
    expect(codigo).toContain("to service_role");
  });

  it("a listagem mostra, mas nao casa conta com cliente sozinha", () => {
    // Casar por nome parecido poria o investimento de um cliente no
    // relatorio de outro, e dinheiro trocado de dono so aparece no fim
    // do mes.
    const fn = codigo.slice(codigo.indexOf("ads_contas_conhecidas"));
    expect(fn).not.toMatch(/insert into|update public\./i);
    expect(fn).toContain("tem_token_da_carteira");
  });
});

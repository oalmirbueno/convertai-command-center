import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Um token da agência cobre todas as contas de Instagram.
 *
 * Antes, cada conta precisava do próprio grant, com o próprio token no
 * cofre: doze contas, doze conexões, doze tokens que expiram em doze
 * momentos diferentes. O lado dos anúncios já resolvia isso — em
 * ads_tokens, external_account_id nulo significa "vale para todas".
 *
 * O que torna a troca possível sem adivinhar nada: nas nove contas
 * conectadas hoje, external_accounts.external_id é idêntico ao
 * provider_resource_id do grant. O painel já sabe o id de cada Instagram.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(raiz, "supabase/migrations/20260828090000_um_token_da_agencia_para_o_social.sql"), "utf8",
);
const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const hook = readFileSync(resolve(raiz, "src/hooks/useSocialMetrics.ts"), "utf8");
const tela = readFileSync(resolve(raiz, "src/pages/AdminMetricas.tsx"), "utf8");

describe("um token, todas as contas", () => {
  it("o token vai para o cofre, nao para a tabela", () => {
    expect(codigo).toContain("vault.create_secret");
    expect(codigo).toContain("access_token_secret_id uuid not null");
    // A tabela guarda o ID do segredo. O segredo em si nunca fica nela.
    // A busca e limitada ao CREATE TABLE: fora dele, "access_token text"
    // aparece como TIPO DE RETORNO da funcao que resolve o token, o que e
    // outra coisa e nao guarda nada.
    const tabela = codigo.slice(
      codigo.indexOf("create table if not exists social_private.social_agency_tokens"),
      codigo.indexOf(");", codigo.indexOf("social_agency_tokens (")),
    );
    expect(tabela).not.toMatch(/access_token\s+text/);
    expect(tabela).toContain("access_token_secret_id");
  });

  it("so administrador guarda o token", () => {
    expect(codigo).toContain("has_role(auth.uid(), 'admin'::public.app_role)");
    expect(codigo).toContain("somente administrador pode guardar o token social");
  });

  it("um token ativo por vez, e o anterior e revogado", () => {
    expect(codigo).toContain("social_agency_token_unico_ativo");
    expect(codigo).toContain("set revoked_at = now()");
  });

  it("o grant da propria conta GANHA do token da agencia", () => {
    // Cliente que roda fora do Business Manager da agencia continua como
    // esta. Ligar o token novo nao desfaz conexao que ja funciona.
    const fn = codigo.slice(codigo.indexOf("autopublish_account_token"));
    expect(fn).toContain("and not exists (");
    expect(fn).toContain("from social_private.external_account_grants as g");
  });

  it("conta sem external_id nao resolve pela agencia", () => {
    // Sem o id do Instagram nao ha o que consultar, e inventar um daria
    // numero de outra conta no relatorio de um cliente.
    expect(codigo).toContain("account.external_id is not null");
  });

  it("a descoberta do Business Manager e SO LEITURA", () => {
    // Casar conta por nome parecido gravaria o Instagram de um cliente na
    // ficha de outro, e o relatorio inteiro passa a mentir sem erro algum.
    const fn = codigo.slice(codigo.indexOf("social_contas_do_business_manager"));
    expect(fn).not.toMatch(/update public\.external_accounts/i);
    expect(fn).not.toMatch(/insert into public\.external_accounts/i);
  });

  it("o formato de volta do atualizar-agora NAO muda", () => {
    // A funcao ja existia e a tela le week_start, dispatched e parsed para
    // montar a mensagem. Trocar a forma faria dispatched virar indefinido
    // e a tela dizer "tudo em dia" logo apos disparar trinta chamadas.
    expect(codigo).toContain("'week_start'");
    expect(codigo).toContain("'dispatched'");
    expect(codigo).toContain("'parsed'");
    expect(hook).toContain("week_start: string; dispatched: number; parsed: number");
  });

  it("a tela guarda o token e limpa o campo depois", () => {
    // Token que fica na tela vaza por print de reuniao e por ombro alheio.
    expect(tela).toContain("saveMetaSocialToken");
    expect(tela).toContain('setToken("")');
    expect(tela).toContain('type="password"');
  });
});

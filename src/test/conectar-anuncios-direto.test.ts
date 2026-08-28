import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Conectar anúncios ganha porta própria, sem encostar no Instagram.
 *
 * A versão anterior colhia o acesso de anúncios DE CARONA na conexão de
 * rede social, o que obrigava a reconectar uma conta que já funciona só
 * para pegar outra coisa. Se a reconexão desse errado, ele perderia as
 * duas em vez de nenhuma.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(raiz, "supabase/migrations/20260828110000_conectar_anuncios_direto.sql"), "utf8",
);
const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const edge = readFileSync(resolve(raiz, "supabase/functions/social-meta-oauth/index.ts"), "utf8");
const lib = readFileSync(resolve(raiz, "src/lib/socialMetaOAuth.ts"), "utf8");
const callback = readFileSync(resolve(raiz, "src/pages/MetaOAuthCallback.tsx"), "utf8");
const tela = readFileSync(resolve(raiz, "src/pages/AdminAds.tsx"), "utf8");
const social = readFileSync(
  resolve(raiz, "src/components/editorial/EditorialAccountSetup.tsx"), "utf8",
);

describe("a porta de anuncios e independente", () => {
  it("tem sessao propria, nao reaproveita a do social", () => {
    // A sessao social exige cliente e projeto, coisas que um token de
    // carteira inteira nao tem. Forcar um cliente qualquer so para
    // preencher o campo criaria um registro que diz uma coisa e significa
    // outra.
    expect(codigo).toContain("social_private.ads_oauth_sessions");
    expect(codigo).toContain("ads_oauth_create_session");
    expect(codigo).toContain("ads_oauth_consume_session");
  });

  it("o state e aleatorio e de USO UNICO", () => {
    expect(codigo).toContain("encode(gen_random_bytes(32), 'hex')");
    // Validar e marcar na MESMA consulta: em dois passos sobraria uma
    // fresta entre um e outro.
    expect(codigo).toContain("set consumed_at = now()");
    expect(codigo).toContain("and consumed_at is null");
  });

  it("sessao esquecida expira em uma hora", () => {
    expect(codigo).toContain("created_at < now() - interval '1 hour'");
    expect(codigo).toContain("created_at > now() - interval '1 hour'");
  });

  it("o retorno de anuncios NAO grava recurso de Instagram", () => {
    const fn = edge.slice(
      edge.indexOf("async function handleAdsComplete"),
      edge.indexOf("Deno.serve"),
    );
    expect(fn).not.toContain("social_meta_oauth_store_resources");
    expect(fn).toContain("save_meta_ads_token_from_login");
  });

  it("recusa se a permissao de anuncios nao veio", () => {
    // Guardar um token sem ads_read daria uma conexao que parece feita e
    // nao le nada, e o erro so apareceria na primeira coleta vazia.
    expect(edge).toContain('!permissions.granted.includes("ads_read")');
    expect(edge).toContain("META_ADS_PERMISSION_MISSING");
  });

  it("a volta sabe de qual login veio, pela marca presa ao state", () => {
    // Chave fixa confundiria dois logins abertos ao mesmo tempo.
    expect(lib).toContain('const MARCA_ANUNCIOS = "aceleriq-meta-oauth-anuncios:"');
    expect(lib).toContain("MARCA_ANUNCIOS + state");
    expect(callback).toContain("ehLoginDeAnuncios(state)");
  });

  it("armazenamento bloqueado nao impede a conexao", () => {
    const bloco = lib.slice(lib.indexOf("export function marcarLoginDeAnuncios"));
    expect(bloco.slice(0, 400)).toContain("catch");
  });

  it("a tela do social ignora o retorno de anuncios", () => {
    // Sem isto, ela tentaria gravar contas de Instagram a partir de um
    // retorno que nao tem nenhuma.
    expect(social).toContain('if (message.alvo === "anuncios") return;');
  });

  it("a mensagem carrega o discriminante, em vez de adivinhar pela forma", () => {
    expect(lib).toContain('alvo: "anuncios"');
    expect(lib).toContain('alvo?: "social"');
  });

  it("a tela de anuncios tem o botao e escuta o resultado", () => {
    expect(tela).toContain("startAdsOAuth");
    expect(tela).toContain("Conectar com a Meta");
    expect(tela).toContain('msg.alvo !== "anuncios"');
    // O caminho antigo de colar token continua ali: o novo adiciona, nao
    // substitui.
    expect(tela).toContain("Ou cole um token");
    expect(tela).toContain("saveMetaAdsToken");
  });
});

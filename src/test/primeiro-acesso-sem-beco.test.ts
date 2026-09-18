import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Caso Rd Ar (2026-09-18): o link de primeiro acesso saiu por e-mail e pelo
 * grupo, o cliente abriu e a tela ficou preta. Ninguém sabia se a página tinha
 * rodado, e a única saída era falar com a equipe. Regras pinadas aqui:
 *
 * 1. A tela nunca fica preta: a casca em HTML puro mostra "Abrindo o painel"
 *    e transforma qualquer falha de carregamento em aviso com botão.
 * 2. Arquivo que não baixou recarrega sozinho (no máximo duas vezes).
 * 3. Link colado com espaço ou maiúscula continua valendo.
 * 4. Quem cai em "link inválido" pede o link de novo ali mesmo, e o reenvio
 *    manda o MESMO link enquanto ele vale (nunca mata o que já está no WhatsApp).
 * 5. Abrir o link deixa rastro no banco (last_validated_at), para a equipe
 *    provar se a página chegou a falar com o servidor.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const html = ler("index.html");
const pagina = ler("src/pages/FirstAccess.tsx");
const funcao = ler("supabase/functions/client-first-access/index.ts");
const migracao = ler("supabase/migrations/20260918140000_primeiro_acesso_sem_beco.sql");

function scriptsInline(origem: string): string[] {
  return Array.from(origem.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g), (m) => m[1]);
}

describe("a casca do painel nunca fica preta", () => {
  it("mostra 'Abrindo o painel' fora do #root e esconde quando o app monta", () => {
    expect(html).toContain('<div id="app-boot"');
    expect(html).toContain("Abrindo o painel...");
    expect(html).toContain("animation:app-boot-in .01s .5s both");
    expect(html).toContain("function hideBoot()");
  });

  it("arquivo que não baixou recarrega sozinho, no máximo duas vezes, furando o cache", () => {
    expect(html).toContain('tag === "SCRIPT" || tag === "LINK"');
    expect(html).toContain('"aceleriq-boot-retries"');
    expect(html).toContain("if (count >= 2) return false;");
    expect(html).toContain('"v=" + new Date().getTime()');
    expect(html).toContain('window.addEventListener("unhandledrejection"');
  });

  it("erro ao iniciar, navegador antigo e link dentro de outro app têm aviso próprio", () => {
    expect(html).toContain("O painel não conseguiu abrir");
    expect(html).toContain("Navegador desatualizado");
    expect(html).toContain("Invalid regular expression");
    expect(html).toContain("Abrir no navegador");
    expect(html).toContain(String.raw`WhatsApp|Line\/|Twitter|Snapchat|GSA\/|; wv\)`);
    expect(html).not.toContain("deste computador");
  });

  it("os scripts inline continuam em JavaScript antigo (rodam em qualquer navegador)", async () => {
    const acorn = await import("acorn");
    const scripts = scriptsInline(html);
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const corpo of scripts) {
      expect(() => acorn.parse(corpo, { ecmaVersion: 5 })).not.toThrow();
    }
  });
});

describe("primeiro acesso sem beco sem saída", () => {
  it("o token aceita espaço, quebra de linha e maiúscula (link colado do WhatsApp)", () => {
    expect(pagina).toContain(String.raw`(params.get("token") || "").replace(/\s+/g, "").toLowerCase()`);
    expect(funcao).toContain(String.raw`body.token.replace(/\s+/g, "").toLowerCase()`);
  });

  it("link inválido, já usado ou demorado oferece receber o link de novo por e-mail", () => {
    expect(pagina.split("{reenviar}")).toHaveLength(4);
    expect(pagina).toContain('body: { action: "resend", email }');
    expect(pagina).toContain("Se este e-mail estiver cadastrado, o link chega em instantes.");
  });

  it("o reenvio responde sempre igual, respeita 10 minutos e reaproveita o link que ainda vale", () => {
    expect(funcao).toContain('if (action === "resend") {');
    expect(funcao).toContain("const RESEND_COOLDOWN_MINUTES = 10;");
    expect(funcao).toContain("const RESEND_MIN_REMAINING_HOURS = 24;");
    expect(funcao).toContain('admin.rpc("first_access_resend_lookup_service"');
    expect(funcao).toContain("if (lookup?.recently_sent === true) return ok;");
    expect(funcao).toContain('const reusable = lookup?.token_status === "available"');
    // Quem já criou a senha recebe o e-mail sem link (aponta para o login).
    expect(funcao).toContain("if (!lookup?.used_at) {");
    // A função pública nunca lê tabelas direto: só RPC privada.
    expect(funcao).not.toContain('.from("profiles")');
    expect(funcao).not.toMatch(/admin\s*\.from\(/);
    const rpc = ler("supabase/migrations/20260918150000_reenvio_do_primeiro_acesso_por_rpc.sql");
    expect(rpc).toContain("r.role = 'client'::public.app_role");
    expect(rpc).toContain("l.template_name = 'client-welcome'");
    expect(rpc).toContain("interval '10 minutes'");
    expect(rpc).toContain("GRANT EXECUTE ON FUNCTION public.first_access_resend_lookup_service(text) TO service_role;");
  });

  it("abrir o link deixa rastro no banco, sem gastar tentativa", () => {
    expect(migracao).toContain("ADD COLUMN IF NOT EXISTS last_validated_at timestamptz");
    expect(migracao).toContain("SET last_validated_at = now()");
    expect(migracao).not.toContain("attempts = t.attempts + 1");
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.first_access_state_service(p_profile_id uuid)");
    expect(migracao).toContain("GRANT EXECUTE ON FUNCTION public.first_access_state_service(uuid) TO service_role;");
  });
});

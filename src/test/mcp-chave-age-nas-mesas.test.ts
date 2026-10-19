import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 19/10/2026, autorizado pelo dono por escrito: "então ligue para tudo funcionar e não ficar
 * travado". Em 17/10 a conexão OAuth do Paperclip foi trocada por uma de chave e toda ação nas
 * mesas (criativo, arte, entrega, briefing) voltava "exige OAuth". Agora a chave de API age nas
 * mesas com a sessão de quem a criou, desde que essa pessoa seja admin ou gestor da equipe.
 */

const raiz = resolve(__dirname, "../..");
const acoes = readFileSync(resolve(raiz, "supabase/functions/_shared/mcp-mesas-acoes.ts"), "utf8");
const ponte = readFileSync(resolve(raiz, "supabase/functions/_shared/mcp-mesas-ponte.ts"), "utf8");

describe("a chave do agente age nas mesas em nome do dono", () => {
  it("só dono admin ou gestor empresta a sessão; chave sem dono continua só lendo", () => {
    expect(acoes).toContain("const PAPEIS_QUE_EMPRESTAM_A_SESSAO = ['admin', 'manager'];");
    expect(acoes).toContain("ctx.dataScope?.source === 'api_key' && ctx.dataScope.principalUserId");
    expect(acoes).toContain("ctx.dataScope?.source !== 'oauth'");
  });

  it("a sessão é do dono (link mágico do servidor + verificação), guardada até perto de vencer", () => {
    expect(acoes).toContain("auth.admin.generateLink({ type: 'magiclink', email })");
    expect(acoes).toContain("auth.verifyOtp({ token_hash: hash, type: 'magiclink' })");
    expect(acoes).toContain("validoAte > Date.now() + 5 * 60_000");
  });

  it("a mesa continua recebendo a sessão de uma pessoa, nunca a chave de serviço, e o token não vai para log", () => {
    expect(acoes).toContain("Authorization: `Bearer ${token}`");
    expect(acoes).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(acoes).not.toMatch(/console\.(log|error|warn)\([^)]*(token|hash|email)/);
  });

  it("o aviso explica a regra nova", () => {
    expect(ponte).toContain("dono da chave");
  });
});

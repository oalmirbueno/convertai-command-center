import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  casarContas,
  conferirDebugToken,
  contasParaAplicar,
  escolherConcessao,
  formatoDoToken,
  juntarPaginas,
  paginaSemToken,
  prazoDaMeta,
  validadeDaConcessao,
  type ContaDoPainel,
} from "../../supabase/functions/meta-usuario-do-sistema/regras";
import { conexaoVencida, textoDoPrazo } from "@/lib/config/metaUsuarioDoSistema";

const AGORA = new Date("2026-10-27T12:00:00Z");
const APP = "1234567890";
const TOKEN_PAGINA = "EAAPaginaTokenFalso0123456789abcdef";

const ESCOPOS = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
  "instagram_manage_comments",
];

const debugBom = {
  app_id: APP,
  type: "SYSTEM_USER",
  is_valid: true,
  expires_at: 0,
  data_access_expires_at: 0,
  user_id: "61595520027340",
  scopes: ESCOPOS,
};

function conta(over: Partial<ContaDoPainel>): ContaDoPainel {
  return {
    external_account_id: "00000000-0000-4000-8000-000000000001",
    client_id: "c1",
    cliente: "Mirante",
    platform: "instagram",
    external_id: "17841418994476351",
    handle: "@miranteluzfloripa",
    display_name: "Mirante",
    connection_status: "connected",
    expires_at: "2026-11-04T16:51:42Z",
    data_access_expires_at: "2026-11-04T16:51:42Z",
    concessao: { origem: "oauth_usuario", status: "active", access_token_expires_at: null, data_access_expires_at: "2026-11-04T16:51:42Z" },
    tem_projeto: true,
    ...over,
  };
}

describe("conferência do token (debug_token)", () => {
  it("aprova token de usuário do sistema, do nosso app, sem prazo e com as permissões", () => {
    const c = conferirDebugToken(debugBom, APP);
    expect(c.aprovado).toBe(true);
    expect(c.nuncaVence).toBe(true);
    expect(c.expiraEm).toBeNull();
    expect(c.metaUserId).toBe("61595520027340");
    expect(c.faltando).toEqual([]);
    expect(c.recomendadosFaltando).toEqual([]);
  });

  it("recusa outro app, token de pessoa, token com prazo e permissão faltando", () => {
    expect(conferirDebugToken({ ...debugBom, app_id: "999" }, APP).aprovado).toBe(false);
    expect(conferirDebugToken({ ...debugBom, type: "USER" }, APP).problemas.join(" ")).toMatch(/não é de usuário do sistema/);
    const comPrazo = conferirDebugToken({ ...debugBom, data_access_expires_at: 1793720000 }, APP);
    expect(comPrazo.aprovado).toBe(false);
    expect(comPrazo.acessoAosDadosExpiraEm).not.toBeNull();
    const semPublicar = conferirDebugToken({ ...debugBom, scopes: ESCOPOS.filter((e) => e !== "instagram_content_publish") }, APP);
    expect(semPublicar.faltando).toEqual(["instagram_content_publish"]);
    expect(semPublicar.aprovado).toBe(false);
    expect(conferirDebugToken({ ...debugBom, is_valid: false }, APP).valido).toBe(false);
  });

  it("recomendadas faltando avisam mas não bloqueiam", () => {
    const c = conferirDebugToken({ ...debugBom, scopes: ESCOPOS.slice(0, 5) }, APP);
    expect(c.aprovado).toBe(true);
    expect(c.recomendadosFaltando).toEqual(["instagram_manage_insights", "business_management", "instagram_manage_comments"]);
  });

  it("prazo da Meta: 0 ou ausente é sem prazo", () => {
    expect(prazoDaMeta(0)).toBeNull();
    expect(prazoDaMeta(undefined)).toBeNull();
    expect(prazoDaMeta(1793720000)).toBe(new Date(1793720000 * 1000).toISOString());
  });
});

describe("páginas que o token enxerga", () => {
  it("junta me/accounts e BM sem repetir e sem perder token nem Instagram", () => {
    const paginas = juntarPaginas([
      { origem: "me_accounts", paginas: [{ id: "949409194912310", name: "Mirante", access_token: TOKEN_PAGINA }] },
      { origem: "client_pages", paginas: [{ id: "949409194912310", name: "Mirante", instagram_business_account: { id: "17841418994476351", username: "miranteluzfloripa" } }, { id: "abc" }] },
    ]);
    expect(paginas).toHaveLength(1);
    expect(paginas[0].token).toBe(TOKEN_PAGINA);
    expect(paginas[0].instagram?.id).toBe("17841418994476351");
    expect(paginas[0].origens).toEqual(["me_accounts", "client_pages"]);
  });

  it("a versão para a tela não leva o token", () => {
    const [p] = juntarPaginas([{ origem: "me_accounts", paginas: [{ id: "1", name: "X", access_token: TOKEN_PAGINA }] }]);
    expect(JSON.stringify(paginaSemToken(p))).not.toContain(TOKEN_PAGINA);
    expect(paginaSemToken(p).tem_token_de_pagina).toBe(true);
  });
});

describe("casamento com as contas do painel", () => {
  const paginas = juntarPaginas([
    {
      origem: "me_accounts",
      paginas: [
        { id: "949409194912310", name: "Mirante", access_token: TOKEN_PAGINA, instagram_business_account: { id: "17841418994476351", username: "miranteluzfloripa", name: "Mirante Luz" } },
        { id: "1332971173229881", name: "Sem token" },
      ],
    },
  ]);

  it("casa Instagram pelo instagram_business_account e Facebook pelo id da página", () => {
    const itens = casarContas(paginas, [
      conta({}),
      conta({ external_account_id: "00000000-0000-4000-8000-000000000002", platform: "facebook", external_id: "949409194912310", handle: null }),
    ], AGORA);
    expect(itens.map((i) => i.motivo)).toEqual(["casa", "casa"]);
    expect(itens[0].concessao_atual.vence_em).toBe("2026-11-04T16:51:42.000Z");
    expect(itens[0].concessao_atual.dias_para_vencer).toBe(8);
    expect(itens[0].concessao_atual.vencida).toBe(false);
  });

  it("não casa por nome, marca sem token, sem projeto e já no usuário do sistema", () => {
    const itens = casarContas(paginas, [
      conta({ external_account_id: "a", external_id: "999", display_name: "Mirante" }),
      conta({ external_account_id: "b", platform: "facebook", external_id: "1332971173229881" }),
      conta({ external_account_id: "c", tem_projeto: false }),
      conta({ external_account_id: "d", concessao: { origem: "usuario_do_sistema", status: "active", access_token_expires_at: null, data_access_expires_at: null }, expires_at: null, data_access_expires_at: null }),
    ], AGORA);
    const porId = Object.fromEntries(itens.map((i) => [i.external_account_id, i]));
    expect(porId.a.motivo).toBe("nao_encontrada");
    expect(porId.a.encontrada).toBe(false);
    expect(porId.b.motivo).toBe("sem_token_de_pagina");
    expect(porId.c.motivo).toBe("sem_projeto");
    expect(porId.d.motivo).toBe("ja_no_usuario_do_sistema");
    expect(porId.d.concessao_atual.vence_em).toBeNull();
    expect(itens.filter((i) => i.pode_aplicar)).toHaveLength(0);
  });

  it("quem vence primeiro aparece primeiro", () => {
    const itens = casarContas(paginas, [
      conta({ external_account_id: "tarde", concessao: { origem: "oauth_usuario", status: "active", data_access_expires_at: "2027-01-07T00:00:00Z" } }),
      conta({ external_account_id: "cedo" }),
    ], AGORA);
    expect(itens.map((i) => i.external_account_id)).toEqual(["cedo", "tarde"]);
  });

  it("aplicar leva só as casadas (ou as escolhidas) com o token de página e o id do Instagram", () => {
    const contas = [
      conta({}),
      conta({ external_account_id: "00000000-0000-4000-8000-000000000002", platform: "facebook", external_id: "949409194912310", handle: null }),
      conta({ external_account_id: "x", external_id: "999" }),
    ];
    const itens = casarContas(paginas, contas, AGORA);
    const todas = contasParaAplicar(itens, paginas, contas);
    expect(todas).toHaveLength(2);
    const ig = todas.find((t) => t.instagram_user_id)!;
    expect(ig).toMatchObject({ page_id: "949409194912310", instagram_user_id: "17841418994476351", handle: "miranteluzfloripa", page_access_token: TOKEN_PAGINA });
    const fb = todas.find((t) => !t.instagram_user_id)!;
    expect(fb.page_id).toBe("949409194912310");
    expect(contasParaAplicar(itens, paginas, contas, ["00000000-0000-4000-8000-000000000002"])).toHaveLength(1);
  });
});

describe("validade e escolha da concessão", () => {
  it("prazo nulo conta como válido e usuário do sistema nunca avisa", () => {
    const sistema = validadeDaConcessao({ origem: "usuario_do_sistema", status: "active", access_token_expires_at: null, data_access_expires_at: null }, AGORA);
    expect(sistema).toMatchObject({ valida: true, venceEm: null, vencida: false, avisar: false, origem: "usuario_do_sistema" });
  });

  it("login perto de vencer avisa, vencido não vale, revogado não vale", () => {
    const perto = validadeDaConcessao({ origem: "oauth_usuario", status: "active", data_access_expires_at: "2026-11-04T16:51:42Z" }, AGORA);
    expect(perto).toMatchObject({ valida: true, avisar: true, diasParaVencer: 8 });
    const longe = validadeDaConcessao({ origem: "oauth_usuario", status: "active", data_access_expires_at: "2027-01-07T00:00:00Z" }, AGORA);
    expect(longe.avisar).toBe(false);
    expect(validadeDaConcessao({ status: "active", data_access_expires_at: "2026-10-01T00:00:00Z" }, AGORA)).toMatchObject({ valida: false, vencida: true });
    expect(validadeDaConcessao({ status: "superseded", data_access_expires_at: null }, AGORA).valida).toBe(false);
    expect(validadeDaConcessao(null, AGORA).valida).toBe(false);
  });

  it("o menor prazo entre token e acesso aos dados manda", () => {
    const v = validadeDaConcessao({ status: "active", access_token_expires_at: "2026-11-01T00:00:00Z", data_access_expires_at: "2026-12-01T00:00:00Z" }, AGORA);
    expect(v.venceEm).toBe("2026-11-01T00:00:00.000Z");
  });

  it("escolhe usuário do sistema válido; senão o login que vence mais tarde; vencida nunca", () => {
    const login1 = { id: "l1", origem: "oauth_usuario", status: "active", data_access_expires_at: "2026-11-10T00:00:00Z" };
    const login2 = { id: "l2", origem: "oauth_usuario", status: "active", data_access_expires_at: "2026-12-10T00:00:00Z" };
    const vencida = { id: "v", origem: "oauth_usuario", status: "active", data_access_expires_at: "2026-10-01T00:00:00Z" };
    const sistema = { id: "s", origem: "usuario_do_sistema", status: "active", data_access_expires_at: null, access_token_expires_at: null };
    expect(escolherConcessao([login1, sistema, login2], AGORA)?.id).toBe("s");
    expect(escolherConcessao([login1, login2, vencida], AGORA)?.id).toBe("l2");
    expect(escolherConcessao([vencida, { ...sistema, status: "revoked" }], AGORA)).toBeNull();
  });
});

describe("token colado e aviso do painel", () => {
  it("aceita só o formato de token, sem espaço", () => {
    expect(formatoDoToken("  EAAB" + "x".repeat(40) + "  ")).toBe("EAAB" + "x".repeat(40));
    expect(formatoDoToken("curto")).toBeNull();
    expect(formatoDoToken("EAAB xx" + "x".repeat(40))).toBeNull();
    expect(formatoDoToken(123)).toBeNull();
  });

  it("conexão com prazo nulo não acusa vencida", () => {
    expect(conexaoVencida({ expires_at: null, data_access_expires_at: null }, AGORA)).toBe(false);
    expect(conexaoVencida({ expires_at: "2026-10-01T00:00:00Z" }, AGORA)).toBe(true);
    expect(conexaoVencida({ expires_at: null, data_access_expires_at: "2026-10-26T00:00:00Z" }, AGORA)).toBe(true);
    expect(conexaoVencida(undefined, AGORA)).toBe(false);
    expect(textoDoPrazo(null, AGORA)).toBe("não vence");
    expect(textoDoPrazo("2026-11-04T16:51:42Z", AGORA)).toMatch(/^vence em 8 dias/);
  });
});

describe("contrato da migration e da função", () => {
  const sql = readFileSync("supabase/migrations/20261027235000_meta_usuario_do_sistema.sql", "utf8");
  const fn = readFileSync("supabase/functions/meta-usuario-do-sistema/index.ts", "utf8");

  it("origem nova em check idempotente e concessão do sistema sem prazo", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'oauth_usuario'");
    expect(sql).toContain("CHECK (origem IN ('oauth_usuario', 'usuario_do_sistema'))");
    expect(sql).toMatch(/origem <> 'usuario_do_sistema'\s+OR \(access_token_expires_at IS NULL AND data_access_expires_at IS NULL\)/);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS social_private.meta_usuario_do_sistema_trocas");
  });

  it("conexão aplicada fica sem prazo e a antiga vira superseded sem revogar segredo", () => {
    expect(sql).toMatch(/expires_at = NULL,\s+data_access_expires_at = NULL,/);
    const bloco = sql.slice(sql.indexOf("SET status = 'superseded', updated_at = now()"), sql.indexOf("RETURN jsonb_build_object(\n    'lote_id'"));
    expect(bloco).not.toContain("revoke_meta_secret");
    expect(bloco).not.toContain("cleanup_meta_grant");
  });

  it("toda RPC nova é só da service_role e confere o admin", () => {
    for (const nome of ["guardar", "aplicar", "desfazer"]) {
      const corpo = sql.slice(sql.indexOf(`FUNCTION public.meta_usuario_do_sistema_${nome}(`));
      expect(corpo.slice(0, 2500)).toContain("public.has_role(_actor_id, 'admin'::public.app_role)");
    }
    const grants = sql.match(/GRANT EXECUTE ON FUNCTION [^;]+;/g) || [];
    expect(grants.length).toBe(7);
    for (const g of grants) expect(g).toMatch(/TO service_role;$/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO authenticated/);
  });

  it("a função de borda exige admin e não loga nem devolve token", () => {
    expect(fn).toContain('_role: "admin"');
    expect(fn).not.toMatch(/console\.(log|error|warn)\([^)]*token/);
    expect(fn).toContain('console.error("meta-usuario-do-sistema", JSON.stringify({ acao, codigo: erro.codigo, status: erro.status }))');
    expect(fn).toContain("paginas.map(paginaSemToken)");
  });
});

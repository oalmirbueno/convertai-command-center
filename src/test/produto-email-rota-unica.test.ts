import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { destinoDoInicio, esperaPagamento, fraseDoPedido, lerPedido, proximoPasso, semLancamento, valorSugerido } from "@/lib/produto/email-pedidos";
import { resumirZona, type RegistroDaCloudflare } from "../../supabase/functions/produto-email/modulos/cloudflare";
import { dcValido, resumirZoho } from "../../supabase/functions/produto-email/modulos/zoho";
import { estadoDaCaixa, lerMensagens } from "../../supabase/functions/produto-email/modulos/caixa";

/**
 * E-mail profissional numa rota só (18/11/2026). O comportamento do banco é testado em PGlite
 * (supabase/testes/email_rota_unica_runner.mjs, 50 cenários); aqui ficam as regras puras da tela,
 * as conferências da Cloudflare e do Zoho, a caixa oficial e as convenções que não podem voltar.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const pedido = (x: Record<string, unknown> = {}) =>
  lerPedido({ id: "p1", conta_id: "c1", tipo: "migracao", dominio: "prix.com.br", caixas: "7", origem: "pagina", estado: "novo", valor_migracao: "597", valor_mensal: "69.70", pago_em: null, criado_em: "2026-11-18T12:00:00Z", ...x });

describe("a entrada (pedido)", () => {
  it("lê os números do banco e sugere o valor certo para marcar pago", () => {
    const p = pedido();
    expect(p.caixas).toBe(7);
    expect(valorSugerido(p)).toBe(597);
    expect(valorSugerido(pedido({ tipo: "novo" }))).toBe(69.7);
  });

  it("só pede pagamento enquanto está novo ou aguardando, e sem pago_em", () => {
    expect(esperaPagamento(pedido())).toBe(true);
    expect(esperaPagamento(pedido({ estado: "aguardando_pagamento" }))).toBe(true);
    expect(esperaPagamento(pedido({ estado: "em_andamento", pago_em: "x" }))).toBe(false);
    expect(esperaPagamento(pedido({ estado: "cancelado" }))).toBe(false);
  });

  it("diz o próximo passo de cada entrada", () => {
    expect(proximoPasso(pedido())).toMatch(/marcar como pago/);
    expect(proximoPasso(pedido({ extra_id: "e1" }))).toMatch(/cobrança do extra/);
    expect(proximoPasso(pedido({ estado: "pago", pago_em: "x", dominio_id: null }))).toMatch(/Falta o domínio/);
    expect(proximoPasso(pedido({ estado: "em_andamento", pago_em: "x", dominio_id: "d1", etapas_feitas: 3, etapas_total: 8 }))).toBe("Migrando: 3 de 8 etapas.");
  });

  it("cortesia e já lançado não pedem valor", () => {
    expect(semLancamento("cortesia")).toBe(true);
    expect(semLancamento("ja_lancado")).toBe(true);
    expect(semLancamento("pix")).toBe(false);
  });
});

describe("o cliente no /app", () => {
  it("quem só tem o e-mail cai direto no E-mail; quem tem o CRM fica no Início", () => {
    expect(destinoDoInicio({ conta: { email_ativo: true }, crm: false })).toBe("/app/email");
    expect(destinoDoInicio({ conta: { email_ativo: true }, crm: true })).toBeNull();
    expect(destinoDoInicio({ conta: { email_ativo: false }, crm: false })).toBeNull();
    expect(destinoDoInicio({ conta: null, crm: false })).toBeNull();
  });

  it("explica o pedido em português, sem travessão", () => {
    const frases = ["novo", "aguardando_pagamento", "pago", "cancelado"].map((estado) =>
      fraseDoPedido({ id: "p", tipo: "migracao", dominio: null, caixas: 1, estado: estado as never, valor_migracao: 0, valor_mensal: 0, pago_em: null, criado_em: "" }),
    );
    for (const f of frases) {
      expect(f).not.toBeNull();
      expect(`${f!.titulo} ${f!.texto}`).not.toMatch(/[—–]/);
    }
    expect(fraseDoPedido(null)).toBeNull();
  });
});

describe("conferência na Cloudflare", () => {
  const zona = { id: "z1", name: "prix.com.br", status: "active", name_servers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"] };
  const certos: RegistroDaCloudflare[] = [
    { type: "MX", name: "prix.com.br", content: "mx.zoho.com", priority: 10 },
    { type: "MX", name: "prix.com.br", content: "mx2.zoho.com", priority: 20 },
    { type: "MX", name: "prix.com.br", content: "mx3.zoho.com", priority: 50 },
    { type: "TXT", name: "prix.com.br", content: '"v=spf1 include:zoho.com ~all"' },
    { type: "TXT", name: "prix.com.br", content: "zoho-verification=zb123.zmverify.zoho.com" },
    { type: "TXT", name: "zmail._domainkey.prix.com.br", content: `v=DKIM1; k=rsa; p=${"B".repeat(80)}` },
    { type: "TXT", name: "_dmarc.prix.com.br", content: "v=DMARC1; p=none; rua=mailto:admin@prix.com.br" },
  ];

  it("zona certa passa em tudo", () => {
    const r = resumirZona(zona, certos, { dominio: "prix.com.br", provedor: "zoho" });
    expect(r.ok).toBe(true);
    expect(r.itens.every((i) => i.situacao === "ok")).toBe(true);
  });

  it("aponta proxy ligado, SPF duplicado, MX antigo e DKIM faltando (as armadilhas da Prix)", () => {
    const ruins: RegistroDaCloudflare[] = [
      { type: "MX", name: "prix.com.br", content: "mx.uol.com.br", priority: 10, proxied: false },
      { type: "A", name: "mail.prix.com.br", content: "1.2.3.4", proxied: true },
      { type: "TXT", name: "prix.com.br", content: "v=spf1 include:uol.com.br ~all" },
      { type: "TXT", name: "prix.com.br", content: "v=spf1 include:zoho.com ~all" },
    ];
    const r = resumirZona({ ...zona, status: "pending" }, ruins, { dominio: "prix.com.br", provedor: "zoho" });
    const por = Object.fromEntries(r.itens.map((i) => [i.chave, i.situacao]));
    expect(r.ok).toBe(false);
    expect(por).toMatchObject({ zona: "alerta", proxy: "falta", mx: "alerta", spf: "falta", dkim: "falta", dmarc: "falta" });
    expect(r.proxied_email).toBe(1);
  });
});

describe("conferência no Zoho", () => {
  it("resume caixas, apelidos e avisa o limite do gratuito", () => {
    const usuarios = Array.from({ length: 6 }, (_, i) => ({ primaryEmailAddress: `p${i}@prix.com.br`, displayName: `P${i}`, role: i === 0 ? "super_admin" : "member" }));
    usuarios[1] = { ...usuarios[1], emailAddress: [{ mailId: "vendas@prix.com.br", isAlias: true }] } as never;
    const r = resumirZoho({ orgId: "123", plano: "free", usuarios, dominio: { verificationStatus: true, dkimstatus: true, dkimDetailList: [{ selector: "zmail", isDefault: true, isVerified: true }] }, nomeDoDominio: "prix.com.br" });
    expect(r.ok).toBe(true);
    expect(r.usuarios).toBe(6);
    expect(r.caixas[0].admin).toBe(true);
    expect(r.caixas[1].apelidos).toEqual(["vendas@prix.com.br"]);
    expect(r.avisos.join(" ")).toMatch(/5 usuários/);
    expect(r.avisos.join(" ")).toMatch(/sem IMAP/);
    expect(r.dominio).toMatchObject({ verificado: true, dkim: true, seletor: "zmail" });
  });

  it("domínio fora da organização não passa", () => {
    const r = resumirZoho({ orgId: "123", usuarios: [], dominio: null, nomeDoDominio: "prix.com.br" });
    expect(r.ok).toBe(false);
    expect(r.avisos[0]).toMatch(/não apareceu/);
  });

  it("região desconhecida volta para zoho.com", () => {
    expect(dcValido("eu")).toBe("eu");
    expect(dcValido("xx")).toBe("com");
  });
});

describe("caixa oficial da Aceleriq", () => {
  it("nasce desligada e diz o custo; só liga com a decisão do dono, domínio e token", () => {
    const off = estadoDaCaixa({ flag: undefined, temToken: true, temDominio: true });
    expect(off.ligada).toBe(false);
    expect(off.custo.por_usuario_mes).toMatch(/R\$/);
    expect(estadoDaCaixa({ flag: "sim", temToken: false, temDominio: true }).motivo).toMatch(/token/);
    expect(estadoDaCaixa({ flag: "sim", temToken: true, temDominio: false }).motivo).toMatch(/domínio/);
    expect(estadoDaCaixa({ flag: "sim", temToken: true, temDominio: true }).ligada).toBe(true);
  });

  it("lê as mensagens sem o corpo", () => {
    const m = lerMensagens([{ messageId: "1", fromAddress: "a@b.com", subject: "Oi", summary: "resumo", receivedTime: "1763467200000", status: "0" }, { semId: true }]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: "1", de: "a@b.com", assunto: "Oi", lida: false });
    expect(Object.keys(m[0])).not.toContain("content");
  });
});

describe("rota única e convenções", () => {
  it("o /app não tem mais um segundo formulário de pedido: aponta para /email/pedir", () => {
    const tela = ler("src/components/produto/EmailDoProduto.tsx");
    expect(tela).toContain('to="/email/pedir"');
    expect(tela).not.toMatch(/pedirEmail\(/);
  });

  it("o pedido vira entrada e o negócio no Comercial só nasce com entrada nova", () => {
    const fn = ler("supabase/functions/produto/index.ts");
    const corpo = fn.slice(fn.indexOf("async function pedirEmail"), fn.indexOf("// ------------------------------------------------------------------ e-mail"));
    expect(corpo).toContain("produto_email_registrar_pedido");
    expect(corpo.indexOf("if (!r.novo)")).toBeGreaterThan(0);
    expect(corpo.indexOf("if (!r.novo)")).toBeLessThan(corpo.indexOf("commercial_leads"));
  });

  it("o domínio nasce pela entrada paga: a casa não tem mais o botão de novo domínio solto", () => {
    const casa = ler("src/components/produto/casa/EmailDaCasa.tsx");
    expect(casa).toContain("<EntradasDeEmail");
    expect(casa).not.toContain("data-novo-dominio");
  });

  it("nenhum segredo no front, no banco ou nos módulos", () => {
    const sql = ler("supabase/migrations/20261118170000_produto_email_rota_unica.sql");
    expect(sql).toContain("vault.create_secret");
    expect(sql).not.toMatch(/add column if not exists \w*(token|senha|secret)/i);
    for (const p of ["src/lib/produto/email-pedidos.ts", "src/components/produto/casa/IntegracaoDoDominio.tsx", "supabase/functions/produto-email/index.ts"]) {
      expect(ler(p)).not.toMatch(/(sk_live|1000\.[0-9a-f]{20,}\.[0-9a-f]{20,}|cfat_|CLOUDFLARE_API_TOKEN\s*=\s*["'])/);
    }
  });

  it("a migration nova não redefine as funções que outro lote está mudando", () => {
    const sql = ler("supabase/migrations/20261118170000_produto_email_rota_unica.sql");
    expect(sql).not.toMatch(/create or replace function public\.produto_estado\(/);
    expect(sql).not.toMatch(/create or replace function public\.produto_conta_liberada\(/);
  });

  it("texto ao cliente sem travessão", () => {
    for (const p of ["src/components/produto/EmailDoProduto.tsx", "src/lib/produto/email-pedidos.ts", "src/components/produto/casa/EntradasDeEmail.tsx", "src/components/produto/casa/CaixaDaAceleriq.tsx", "src/components/produto/casa/IntegracaoDoDominio.tsx"]) {
      expect(ler(p)).not.toMatch(/[—–]/);
    }
  });
});

describe("SPF do Zoho", () => {
  it("aceita o pedido de hoje (include:zohomail.com) e o antigo (include:zoho.com)", async () => {
    const { avaliar } = await import("../../supabase/functions/produto/modulos/dns");
    const base = { dominio: "prix.com.br", provedor: "zoho" as const, seletor: "zmail", mx: ["10 mx.zoho.com"], dkim: [], dmarc: [], agora: new Date("2026-11-18T12:00:00Z") };
    const spf = (txt: string) => avaliar({ ...base, txt: [txt] }).itens.find((i) => i.chave === "spf")!.estado;
    expect(spf("v=spf1 include:zohomail.com include:spf.whservidor.com ?all")).toBe("certo");
    expect(spf("v=spf1 include:zoho.com ~all")).toBe("certo");
    expect(spf("v=spf1 include:_spf.google.com ~all")).toBe("atencao");
    const zona = { id: "z", name: "prix.com.br", status: "active", name_servers: [] };
    const r = resumirZona(zona, [{ type: "TXT", name: "prix.com.br", content: "v=spf1 include:zohomail.com ~all" }], { dominio: "prix.com.br", provedor: "zoho" });
    expect(r.itens.find((i) => i.chave === "spf")!.situacao).toBe("ok");
  });
});

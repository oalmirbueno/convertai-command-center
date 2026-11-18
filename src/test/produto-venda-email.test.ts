import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caixasValidas, contaDoEmail, corpoDoPedido, dominioLimpo, dominioPessoal, dominioValido, precosProntos, RASCUNHO_VAZIO } from "@/lib/produto/venda-email";
import { mensalidadePrevista } from "@/lib/produto/api";

const PRECOS = { email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9, email_migracao: 597 };
const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

describe("venda do e-mail: a conta por caixa", () => {
  it("até as caixas incluídas, a mensalidade é a do banco", () => {
    expect(contaDoEmail(PRECOS, 1).mensal).toBe(39.9);
    expect(contaDoEmail(PRECOS, 5)).toMatchObject({ extras: 0, mensal: 39.9, migracao: 597, primeiroMes: 636.9 });
  });

  it("cada caixa além das incluídas soma a caixa adicional", () => {
    expect(contaDoEmail(PRECOS, 6)).toMatchObject({ extras: 1, mensal: 54.8 });
    expect(contaDoEmail(PRECOS, 12)).toMatchObject({ extras: 7, mensal: 144.2 });
  });

  it("a página faz a mesma conta da mensalidade do produto", () => {
    [1, 5, 6, 9, 30].forEach((caixas) => {
      const doProduto = mensalidadePrevista({ plano: { nome: "Starter", preco_usuario: 49.9, email_caixas_incluidas: 0 }, usuarios: 0, crm: false, email: true, caixas, config: PRECOS });
      expect(contaDoEmail(PRECOS, caixas).mensal).toBe(doProduto.total);
    });
  });

  it("número de caixas fora do aceito cai no padrão ou no teto", () => {
    expect(caixasValidas("7")).toBe(7);
    expect(caixasValidas("abc", 5)).toBe(5);
    expect(caixasValidas(0, 3)).toBe(3);
    expect(caixasValidas(9999)).toBe(200);
  });

  it("sem mensalidade no banco, a página não mostra preço", () => {
    expect(precosProntos(null)).toBe(false);
    expect(precosProntos({ ...PRECOS, email_mensal: 0 })).toBe(false);
    expect(precosProntos(PRECOS)).toBe(true);
  });
});

describe("venda do e-mail: o domínio e o pedido", () => {
  it("endereço de site ou de e-mail vira só o domínio", () => {
    expect(dominioLimpo(" https://www.SuaEmpresa.com.br/contato?x=1 ")).toBe("suaempresa.com.br");
    expect(dominioLimpo("joao@suaempresa.com.br")).toBe("suaempresa.com.br");
    expect(dominioLimpo("suaempresa.com.br.")).toBe("suaempresa.com.br");
  });

  it("só domínio com cara de domínio passa, e e-mail pessoal é apontado", () => {
    expect(dominioValido("suaempresa.com.br")).toBe(true);
    expect(dominioValido("minha-loja.app")).toBe(true);
    expect(dominioValido("suaempresa")).toBe(false);
    expect(dominioValido("sua empresa.com")).toBe(false);
    expect(dominioPessoal(dominioLimpo("fulano@gmail.com"))).toBe(true);
    expect(dominioPessoal("suaempresa.com.br")).toBe(false);
  });

  it("o corpo do pedido leva domínio limpo, caixas e de onde veio", () => {
    const corpo = corpoDoPedido({ ...RASCUNHO_VAZIO, dominio: "WWW.SuaEmpresa.com.br", caixas: 8, observacao: "Hoje está na Locaweb." });
    expect(corpo).toEqual({ dominio: "suaempresa.com.br", caixas: 8, observacao: "Hoje está na Locaweb. Pedido feito pela página /email." });
    const semDominio = corpoDoPedido({ ...RASCUNHO_VAZIO, dominio: "qualquer.com", semDominio: true });
    expect(semDominio.dominio).toBe("");
    expect(semDominio.observacao).toContain("Ainda não tem domínio.");
  });
});

describe("venda do e-mail: convenções da página", () => {
  const pagina = ler("src/pages/EmailLanding.tsx");
  const pedido = ler("src/pages/EmailPedir.tsx");
  // Só as regras: os comentários do arquivo citam o que ele evita.
  const css = ler("src/pages/email-landing.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("nenhum preço escrito na página: tudo vem de produto_precos", () => {
    expect(pagina).not.toMatch(/R\$\s*\d/);
    expect(pedido).not.toMatch(/R\$\s*\d/);
    expect(pagina).toContain("lerPrecos");
  });

  it("não promete provedor nem espaço que o banco não informa", () => {
    expect(pagina).not.toMatch(/zoho|google workspace|microsoft 365|\b\d+\s?gb\b/i);
  });

  it("sem travessão no texto das páginas", () => {
    expect(pagina).not.toMatch(/[—–]/);
    expect(pedido).not.toMatch(/[—–]/);
  });

  it("o pedido usa as ações que já existem e não fala com a cobrança", () => {
    expect(pedido).toContain("pedirEmail");
    expect(pedido).toContain("criarConta");
    expect(pedido).not.toMatch(/assinar\(|asaas|checkout|cobrarMigracao/i);
  });

  it("CSS que roda em navegador antigo: sem clamp, sem inset, sem aspect-ratio", () => {
    expect(css).not.toMatch(/clamp\(|[^-]inset:|aspect-ratio|\bdvh\b/);
    // Toda grade com `gap` declara antes o `grid-gap` que o Safari 11 entende.
    const gaps = css.match(/^\s*gap:/gm) || [];
    const gridGaps = css.match(/^\s*grid-gap:/gm) || [];
    expect(gridGaps.length).toBe(gaps.length);
  });

  it("quem pede menos movimento recebe a versão suave e a entrada por rolagem depende do JS", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/\.el-anim \.el-r\s*\{/);
    expect(css).not.toMatch(/^\.el-r\s*\{/m);
    expect(pagina).toContain("IntersectionObserver");
    expect(pagina).not.toMatch(/useScroll|addEventListener\("scroll"/);
  });

  it("as rotas públicas existem e a migration abre os preços ao visitante", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/email" element={<EmailLanding />} />');
    expect(app).toContain('<Route path="/email/pedir" element={<EmailPedir />} />');
    expect(ler("supabase/migrations/20261113180000_produto_precos_na_pagina_publica.sql")).toContain("grant execute on function public.produto_precos() to anon");
  });
});

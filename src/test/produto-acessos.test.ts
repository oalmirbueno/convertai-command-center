// 19/11/2026: acessos dos clientes (link de entrada por empresa) e Minha caixa (a casa entra com a senha).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invocar = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) }, rpc: vi.fn(), from: vi.fn() } }));

import { caixasParaEntrar, linkDeEntrada, linkDoWhatsApp, mensagemDeEntrada, provedorDeLeitura, situacaoDoAcesso, temAcesso } from "@/lib/produto/acessos";
import { abertaPelaCasa, correio, entrarPelaCasa, sairPelaCasa } from "@/lib/produto/email-central";
import { provedorPelaCasa, senhaDaCasa } from "../../supabase/functions/produto-correio/modulos/adaptador";

const CONTA = "0f1e2d3c-4b5a-4968-8776-655443322110";

describe("link de entrada", () => {
  it("abre o login do produto certo com o identificador da empresa, sem senha", () => {
    expect(linkDeEntrada(CONTA, "crm")).toBe(`https://aceleriq.online/login?next=%2Fapp&empresa=${CONTA}`);
    expect(linkDeEntrada(CONTA, "correio", "https://x.test/")).toBe(`https://x.test/login?next=%2Fcorreio&empresa=${CONTA}`);
    expect(linkDeEntrada("nao-e-uuid", "crm")).toBe("https://aceleriq.online/login?next=%2Fapp");
  });
  it("a mensagem do WhatsApp leva o link e nunca a palavra senha com valor", () => {
    const m = mensagemDeEntrada({ empresa: "Prix", destino: "correio", link: "https://l" });
    expect(m).toContain("no seu e-mail da Prix");
    expect(m).toContain("https://l");
    expect(mensagemDeEntrada({ empresa: "Prix", destino: "crm", link: "https://l", primeiroAcesso: true })).toContain("vale uma vez");
  });
  it("WhatsApp: telefone brasileiro ganha o 55; sem telefone, abre para escolher", () => {
    expect(linkDoWhatsApp("(47) 99999-0000", "oi")).toBe("https://wa.me/5547999990000?text=oi");
    expect(linkDoWhatsApp("", "a b")).toBe("https://wa.me/?text=a%20b");
    expect(linkDoWhatsApp("123", "x")).toBe("https://wa.me/?text=x");
  });
});

describe("quem já entrou", () => {
  const p = (estado: string) => ({ id: estado + Math.random(), nome: "", email: "", papel: "usuario" as const, estado, entrou_em: null });
  it("conta ativos e convites e resume a situação", () => {
    expect(situacaoDoAcesso([p("ativo"), p("ativo")]).situacao).toBe("todos");
    expect(situacaoDoAcesso([p("ativo"), p("convidado")])).toMatchObject({ total: 2, entraram: 1, esperando: 1, situacao: "parte" });
    expect(situacaoDoAcesso([p("convidado")]).situacao).toBe("ninguem");
    expect(situacaoDoAcesso([p("removido")]).situacao).toBe("sem_pessoas");
  });
  it("entram na tela as empresas com CRM ou e-mail", () => {
    expect(temAcesso({ crm_ativo: true, email_ativo: false, dominios: 0 })).toBe(true);
    expect(temAcesso({ crm_ativo: false, email_ativo: false, dominios: 1 })).toBe(true);
    expect(temAcesso({ crm_ativo: false, email_ativo: false, dominios: 0 })).toBe(false);
  });
});

describe("caixas que a casa pode abrir", () => {
  it("só caixa criada, com o nome da empresa, e pronta quando há provedor de leitura", () => {
    const dominios = [
      { id: "d1", provedor: "migadu", correio_provedor: "nenhum" },
      { id: "d2", provedor: "zoho", correio_provedor: "nenhum" },
    ] as never;
    const caixas = [
      { id: "c1", dominio_id: "d1", conta_id: "a", endereco: "b@x.com", tipo: "caixa", estado: "ativa" },
      { id: "c2", dominio_id: "d2", conta_id: "a", endereco: "a@y.com", tipo: "caixa", estado: "criada" },
      { id: "c3", dominio_id: "d1", conta_id: "a", endereco: "apelido@x.com", tipo: "apelido", estado: "ativa" },
      { id: "c4", dominio_id: "d1", conta_id: "a", endereco: "pedida@x.com", tipo: "caixa", estado: "pedida" },
    ] as never;
    const r = caixasParaEntrar(caixas, dominios, { a: "Prix" });
    expect(r.map((c) => [c.endereco, c.pronta, c.empresa])).toEqual([["a@y.com", false, "Prix"], ["b@x.com", true, "Prix"]]);
    expect(provedorDeLeitura({ provedor: "zoho", correio_provedor: "imap" })).toBe("imap");
  });
  it("a função lê pelo mesmo provedor e só aceita senha de 1 a 200 caracteres", () => {
    expect(provedorPelaCasa("nenhum", "migadu")).toBe("migadu");
    expect(provedorPelaCasa("zoho", "migadu")).toBe("zoho");
    expect(provedorPelaCasa(null, "zoho")).toBe("nenhum");
    expect(senhaDaCasa("abc")).toBe("abc");
    expect(senhaDaCasa("")).toBe("");
    expect(senhaDaCasa(123)).toBe("");
    expect(senhaDaCasa("x".repeat(201))).toBe("");
  });
});

describe("Minha caixa: a senha só na memória da aba", () => {
  beforeEach(() => {
    invocar.mockReset();
    sairPelaCasa();
  });
  it("entra, manda a senha junto em cada pedido daquela caixa e esquece ao sair", async () => {
    invocar.mockResolvedValueOnce({ data: { ok: true, endereco: "b@x.com" }, error: null });
    await entrarPelaCasa("c1", "s3gr3do");
    expect(invocar.mock.calls[0][1].body).toEqual({ acao: "entrar_pela_casa", caixa_id: "c1", senha_da_casa: "s3gr3do" });
    expect(abertaPelaCasa("c1")).toBe(true);
    invocar.mockResolvedValueOnce({ data: { mensagens: [] }, error: null });
    await correio.listar("c1", "INBOX");
    expect(invocar.mock.calls[1][1].body).toMatchObject({ acao: "listar", caixa_id: "c1", senha_da_casa: "s3gr3do" });
    invocar.mockResolvedValueOnce({ data: { mensagens: [] }, error: null });
    await correio.listar("outra", "INBOX");
    expect(invocar.mock.calls[2][1].body.senha_da_casa).toBeUndefined();
    sairPelaCasa("c1");
    expect(abertaPelaCasa("c1")).toBe(false);
  });
  it("senha errada não fica guardada", async () => {
    invocar.mockResolvedValueOnce({ data: null, error: { message: "x", context: { clone: () => ({ json: async () => ({ error: "senha_recusada", mensagem: "A senha não confere com esta caixa." }) }) } } });
    await expect(entrarPelaCasa("c1", "errada")).rejects.toThrow("A senha não confere");
    expect(abertaPelaCasa("c1")).toBe(false);
  });
  it("nada de armazenamento nem log da senha", () => {
    const fonte = readFileSync("src/lib/produto/email-central.ts", "utf8");
    const trecho = fonte.slice(fonte.indexOf("const senhasDaCasa"), fonte.indexOf("async function chamarCorreio"));
    expect(trecho).not.toMatch(/localStorage|sessionStorage|console\./);
    const funcao = readFileSync("supabase/functions/produto-correio/index.ts", "utf8");
    expect(funcao).not.toMatch(/console\.[a-z]+\([^)]*senha/i);
    expect(funcao).toContain('registrarPelaCasa(contaDaCasa, u, "correio_aberto_pela_casa", { caixa: caixa.id })');
  });
});

describe("rota e menu", () => {
  it("a tela tem rota própria só para admin e entra no menu", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
    expect(app).toContain('<Route path="/produto/acessos" element={<>{profile?.role === "admin" ? <AcessosDosClientes />');
    expect(layout).toContain('{ title: "Acessos dos clientes", url: "/produto/acessos"');
    expect(layout).toContain('{ title: "Minha caixa", url: "/produto/acessos/caixa"');
  });
});

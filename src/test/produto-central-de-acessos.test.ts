// 19/11/2026: central de acessos (Pessoas e caixas): senha nova, cofre, link por e-mail, extra do cliente e rolagem.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invocar = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) }, rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() } }));

import {
  caixasDaCentral,
  central,
  enderecoNoDominio,
  filtrarNaCentral,
  fraseDoExtra,
  lerPessoas,
  mandarLinkPorEmail,
  pedidoConvidar,
  pedidoCriarCaixa,
  pedidoDefinirSenha,
  pedidoRedefinirSenhaDaCaixa,
  ultimoAcessoLegivel,
} from "@/lib/produto/central-de-acessos";
import { ajusteDoExtraCrm, gerarSenhaForte, leituraDoEnvio, problemaDaSenha, quantidadeDoExtraCrm, valorDoExtraCrm, valorDoExtraDeEmail } from "../../supabase/functions/produto/modulos/acessos";
import type { CaixaDeEmail, DominioDeEmail } from "@/lib/produto/api";

const ler = (p: string) => readFileSync(p, "utf8");
const TELA = ler("src/components/produto/casa/PessoasECaixas.tsx");
const LIB = ler("src/lib/produto/central-de-acessos.ts");
const PAGINA = ler("src/pages/AcessosDosClientes.tsx");
const FN_PRODUTO = ler("supabase/functions/produto/index.ts");
const FN_EMAIL = ler("supabase/functions/produto-email/index.ts");
const MIG = ler("supabase/migrations/20261119210000_produto_central_de_acessos.sql");

beforeEach(() => {
  invocar.mockReset();
  rpc.mockReset();
});

describe("senha forte", () => {
  it("gera 16 caracteres com os quatro tipos e passa na conferência dos dois lados", () => {
    for (let i = 0; i < 50; i++) {
      const s = gerarSenhaForte();
      expect(s).toHaveLength(16);
      expect(/[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s)).toBe(true);
      expect(problemaDaSenha(s)).toBeNull();
    }
    expect(new Set(Array.from({ length: 30 }, () => gerarSenhaForte())).size).toBe(30);
  });
  it("recusa senha curta, com espaço ou de um tipo só, sem repetir a senha na frase", () => {
    expect(problemaDaSenha("")).toContain("Digite");
    expect(problemaDaSenha("Ab1!")).toContain("10");
    expect(problemaDaSenha("abc def 123 XYZ")).toContain("espaço");
    const fraca = "aaaaaaaaaaaa";
    expect(problemaDaSenha(fraca)).not.toContain(fraca);
    expect(problemaDaSenha("Senhaforte123")).toBeNull();
  });
});

describe("extra de CRM do cliente acompanha a equipe", () => {
  it("entrar só cobra quando não há lugar livre; sair tira um usuário, nunca abaixo de quem fica", () => {
    expect(quantidadeDoExtraCrm({ atual: 2, pessoasDepois: 3, mudanca: "entrou" })).toBe(3);
    expect(quantidadeDoExtraCrm({ atual: 5, pessoasDepois: 3, mudanca: "entrou" })).toBe(5);
    expect(quantidadeDoExtraCrm({ atual: 3, pessoasDepois: 2, mudanca: "saiu" })).toBe(2);
    expect(quantidadeDoExtraCrm({ atual: 5, pessoasDepois: 1, mudanca: "saiu" })).toBe(4);
    expect(quantidadeDoExtraCrm({ atual: 1, pessoasDepois: 0, mudanca: "saiu" })).toBe(1);
  });
  it("valor: 49,90 por usuário do plano, e o desconto dado à mão continua", () => {
    expect(valorDoExtraCrm({ quantidadeAtual: 2, valorAtual: 99.8, quantidadeNova: 3, precoDoPlano: 49.9 })).toBe(149.7);
    expect(valorDoExtraCrm({ quantidadeAtual: 0, valorAtual: 0, quantidadeNova: 1, precoDoPlano: 49.9 })).toBe(49.9);
    expect(valorDoExtraCrm({ quantidadeAtual: 2, valorAtual: 80, quantidadeNova: 3, precoDoPlano: 49.9 })).toBe(120);
  });
  it("sem mudança não mexe no extra", () => {
    expect(ajusteDoExtraCrm({ quantidadeAtual: 5, valorAtual: 249.5, pessoasDepois: 3, mudanca: "entrou", precoDoPlano: 49.9 })).toBeNull();
    expect(ajusteDoExtraCrm({ quantidadeAtual: 2, valorAtual: 99.8, pessoasDepois: 3, mudanca: "entrou", precoDoPlano: 49.9 })).toEqual({ quantidade: 3, valor: 149.7 });
  });
  it("a função produto ajusta pelo caminho da ficha (quantidade no extra e valor pelo extra_editar, com a sessão do dono)", () => {
    expect(FN_PRODUTO).toContain('comoDono.from("client_extras").update({ quantidade: ajuste.quantidade })');
    expect(FN_PRODUTO).toContain('comoDono.rpc("extra_editar"');
    expect(FN_PRODUTO).toContain('ajustarExtraDoCrm(ch, contaId, "entrou", ocupados + 1)');
    expect(FN_PRODUTO).toContain('ajustarExtraDoCrm(ch, r.conta_id, "saiu", r.pessoas)');
  });
});

describe("extra de e-mail do cliente acompanha as caixas", () => {
  const base = { caixasNoMensal: 3, precoDaCaixaExtra: 14.9 };
  it("só a caixa além das do mensal soma ou tira", () => {
    expect(valorDoExtraDeEmail({ ...base, valorAtual: 59.9, caixasAntes: 2, mudanca: "entrou" })).toBeNull();
    expect(valorDoExtraDeEmail({ ...base, valorAtual: 59.9, caixasAntes: 3, mudanca: "entrou" })).toBe(74.8);
    expect(valorDoExtraDeEmail({ ...base, valorAtual: 74.8, caixasAntes: 4, mudanca: "saiu" })).toBe(59.9);
    expect(valorDoExtraDeEmail({ ...base, valorAtual: 59.9, caixasAntes: 3, mudanca: "saiu" })).toBeNull();
  });
  it("a frase do Financeiro", () => {
    expect(fraseDoExtra({ extra_id: "x", quantidade: 3, valor: 149.7 }, "crm")).toMatch(/3 usuários, R\$\s?149,70/);
    expect(fraseDoExtra(null, "crm")).toBeNull();
  });
});

describe("link por e-mail", () => {
  it("a falha do domínio de envio vira frase clara com a saída (copiar o link)", () => {
    const r = leituraDoEnvio("dlq", "The mail.aceleriq.online domain is not verified");
    expect(r.situacao).toBe("falhou");
    expect(r.frase).toContain("não está verificado no Resend");
    expect(r.frase).toContain("Copie o link");
    expect(leituraDoEnvio("sent", null).situacao).toBe("enviado");
    expect(leituraDoEnvio("pending", null).situacao).toBe("na_fila");
  });
  it("manda e confere a fila até sair do 'na fila'", async () => {
    invocar
      .mockResolvedValueOnce({ data: { enviado: true, message_id: "m1" }, error: null })
      .mockResolvedValueOnce({ data: { situacao: "na_fila", frase: "fila" }, error: null })
      .mockResolvedValueOnce({ data: { situacao: "falhou", frase: "O e-mail não saiu: x." }, error: null });
    const r = await mandarLinkPorEmail("p1", 0, 3);
    expect(r.situacao).toBe("falhou");
    expect(invocar.mock.calls[0]).toEqual(["produto", { body: { acao: "admin_enviar_link", membro_id: "p1" } }]);
    expect(invocar.mock.calls[1][1].body).toEqual({ acao: "admin_estado_do_envio", message_id: "m1" });
  });
});

describe("pedidos", () => {
  it("adicionar pessoa: e-mail limpo, sem mandar na hora e com o link de volta", () => {
    expect(pedidoConvidar({ conta_id: "c", email: " Ana@X.COM ", nome: " Ana ", papel: "usuario" })).toEqual({ acao: "admin_convidar", conta_id: "c", email: "ana@x.com", nome: "Ana", papel: "usuario", enviar: false, com_link: true });
  });
  it("senha vai só no corpo do pedido à função certa", async () => {
    expect(pedidoDefinirSenha("m", "Xy9!aaaaaaaa")).toEqual({ acao: "admin_definir_senha", membro_id: "m", senha: "Xy9!aaaaaaaa" });
    expect(pedidoRedefinirSenhaDaCaixa("c", "s", true)).toEqual({ acao: "caixa_redefinir_senha", caixa_id: "c", senha: "s", so_guardar: true });
    expect(pedidoCriarCaixa({ dominio_id: "d", endereco: "a@b.com", senha: "s", pessoa: " Ana " })).toEqual({ acao: "caixa_criar", dominio_id: "d", endereco: "a@b.com", senha: "s", pessoa: "Ana" });
    invocar.mockResolvedValueOnce({ data: { definida: true }, error: null });
    await central.definirSenha("m", "Xy9!aaaaaaaa");
    expect(invocar).toHaveBeenCalledWith("produto", { body: { acao: "admin_definir_senha", membro_id: "m", senha: "Xy9!aaaaaaaa" } });
    invocar.mockResolvedValueOnce({ data: { senha: "segredo" }, error: null });
    await central.mostrarSenha("c1");
    expect(invocar).toHaveBeenLastCalledWith("produto-email", { body: { acao: "caixa_mostrar_senha", caixa_id: "c1" } });
  });
  it("erro da função nunca carrega o corpo (a senha)", async () => {
    invocar.mockResolvedValueOnce({ data: null, error: { message: "x", context: { clone: () => ({ json: async () => ({ error: "senha_fraca", mensagem: "Fraca." }) }) } } });
    const e = await central.definirSenha("m", "SenhaSecreta123!").catch((x) => x);
    expect(String(e.message)).toBe("Fraca.");
    expect(JSON.stringify(e)).not.toContain("SenhaSecreta123!");
  });
});

describe("a senha nunca vai para armazenamento, URL nem log", () => {
  it("tela e biblioteca não usam storage, console nem senha em endereço", () => {
    for (const fonte of [TELA, LIB]) {
      expect(fonte).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(fonte).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(fonte).not.toMatch(/[?&]senha=/);
    }
  });
  it("as funções não registram a senha: histórico e erro só com ids", () => {
    expect(FN_PRODUTO).toContain('registrar(membro.conta_id, ch.userId, "senha_definida_pela_casa", { membro: id, login_criado: criado })');
    expect(FN_PRODUTO).not.toMatch(/console\.[a-z]+\([^)]*senha/);
    expect(FN_EMAIL).not.toMatch(/console\.[a-z]+\([^)]*senha/);
    expect(FN_EMAIL).toContain('"senha_da_caixa_vista", { caixa: caixa.id, endereco: caixa.endereco }');
    expect(FN_EMAIL).toContain("semSenha(erro.message, senha)");
    expect(FN_EMAIL).toContain('"Cache-Control": "no-store"');
    // A resposta de definir senha não devolve a senha.
    expect(FN_PRODUTO).toContain("return json({ definida: true, email: membro.email, login_criado: criado });");
  });
  it("só o dono: a função produto exige o papel admin do painel e o banco só deixa a chave de serviço achar o login", () => {
    expect(FN_PRODUTO).toMatch(/async function adminDefinirSenha[\s\S]{0,80}exigirDono\(ch\)/);
    expect(MIG).toContain("grant execute on function public.produto_auth_usuario_por_email(text) to service_role;");
    expect(MIG).toContain("revoke all on function public.produto_admin_remover_membro(uuid, uuid) from public, anon, authenticated;");
    expect(MIG).toContain("if not public.produto_dono() then");
  });
});

describe("listas", () => {
  it("lê as pessoas sem confiar no formato e tira quem saiu", () => {
    const l = lerPessoas([{ id: "1", conta_id: "c", empresa: "Prix", nome: "Ana", email: "a@x", papel: "admin", estado: "ativo", tem_login: true, ultimo_acesso: "2026-11-19T10:00:00Z" }, { id: "2", estado: "removido" }, null]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ papel: "admin", estado: "ativo", tem_login: true });
  });
  it("caixas: só caixa de verdade, com o cofre e a empresa", () => {
    const dominios = [{ id: "d", conta_id: "c", dominio: "prix.com", provedor: "migadu" }] as unknown as DominioDeEmail[];
    const caixas = [
      { id: "1", dominio_id: "d", conta_id: "c", endereco: "ana@prix.com", pessoa: "Ana", tipo: "caixa", estado: "ativa", tem_segredo: true },
      { id: "2", dominio_id: "d", conta_id: "c", endereco: "vendas@prix.com", pessoa: "", tipo: "apelido", estado: "ativa" },
      { id: "3", dominio_id: "d", conta_id: "c", endereco: "x@prix.com", pessoa: "", tipo: "caixa", estado: "removida" },
    ] as unknown as CaixaDeEmail[];
    const r = caixasDaCentral(caixas, dominios, { c: "Prix" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ empresa: "Prix", guardada: true, provedor: "migadu", pronta: true });
  });
  it("busca e filtro por empresa", () => {
    const l = [{ conta_id: "a", empresa: "Prix", nome: "Ana" }, { conta_id: "b", empresa: "Stop", nome: "Bia" }];
    expect(filtrarNaCentral(l, { busca: "bia", empresa: "", campos: (x) => [x.nome] })).toHaveLength(1);
    expect(filtrarNaCentral(l, { busca: "", empresa: "a", campos: (x) => [x.nome] })[0].nome).toBe("Ana");
  });
  it("endereço novo e último acesso", () => {
    expect(enderecoNoDominio("Ana.Lima", "prix.com")).toBe("ana.lima@prix.com");
    expect(enderecoNoDominio("ana lima", "prix.com")).toBeNull();
    const agora = Date.parse("2026-11-19T15:00:00Z");
    expect(ultimoAcessoLegivel(null, agora)).toBe("Nunca entrou");
    expect(ultimoAcessoLegivel("2026-11-19T12:00:00Z", agora)).toBe("Hoje");
    expect(ultimoAcessoLegivel("2026-11-18T12:00:00Z", agora)).toBe("Ontem");
    expect(ultimoAcessoLegivel("2026-11-15T12:00:00Z", agora)).toBe("Há 4 dias");
  });
});

describe("rolagem nos cartões", () => {
  it("cada lista rola dentro do seu cartão só de 1024 px para cima (rolagem.longa), sem altura presa no celular", () => {
    expect(TELA).toContain('juntar("min-w-0 px-2 pb-2 sm:px-3", rolagem.longa)');
    expect(PAGINA).toContain('juntar("min-w-0 px-4 pb-3 sm:px-5", rolagem.longa)');
    for (const fonte of [TELA, PAGINA]) {
      // Nada de max-h/overflow sem o prefixo lg: (prenderia o dedo no celular).
      expect(fonte).not.toMatch(/(^|[\s"'`])max-h-\[[^\]]+\][^"'`]*\boverflow-y-auto/);
    }
  });
  it("a aba Pessoas e caixas está na rota /produto/acessos/pessoas", () => {
    expect(PAGINA).toContain('pedida === "pessoas" ? "pessoas"');
    expect(PAGINA).toContain("`/produto/acessos/${v}`");
  });
});

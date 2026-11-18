import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// O módulo fala com o banco; aqui só as contas e a leitura, então o cliente do Supabase fica de mentira.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import {
  avisoDoCrmLigado,
  conferirCrm,
  erroDeCrmRepetido,
  formInicialDoCrm,
  lerCrmDoCliente,
  mudarFormDoCrm,
  situacaoDoCrm,
  ultimoDiaDoAcesso,
  valorSugeridoDoCrm,
} from "@/lib/crmPeloPlano";

// 18/11/2026 (dono): "colocar ali na entrada também como produto, e eu marcando como pago ali já libera o
// uso do CRM; o acesso ao painel é um, o acesso ao CRM é outro; o CRM é por usuário mensal, sem duplicidade".
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");
const PLANOS = [
  { id: "starter", nome: "Starter", preco_usuario: 49.9 },
  { id: "pro", nome: "Pro", preco_usuario: 89.9 },
];

describe("valor sugerido do CRM", () => {
  it("usuários vezes o preço por usuário do plano, em centavos certos", () => {
    expect(valorSugeridoDoCrm(3, 49.9)).toBe(149.7);
    expect(valorSugeridoDoCrm(7, 89.9)).toBe(629.3);
    expect(valorSugeridoDoCrm(1, 0.1)).toBe(0.1);
  });
  it("sem usuário ou sem preço não sugere nada", () => {
    expect(valorSugeridoDoCrm(0, 49.9)).toBe(0);
    expect(valorSugeridoDoCrm(Number("abc"), 49.9)).toBe(0);
    expect(valorSugeridoDoCrm(3, 0)).toBe(0);
  });
  it("o formulário começa no primeiro plano com um usuário e já com o valor", () => {
    expect(formInicialDoCrm(PLANOS)).toEqual({ planoId: "starter", usuarios: "1", valor: "49,90", email: "", nome: "" });
  });
  it("trocar plano ou usuários recalcula; o valor digitado à mão fica até mexer de novo nos dois", () => {
    let f = formInicialDoCrm(PLANOS);
    f = mudarFormDoCrm(f, "usuarios", "4", PLANOS);
    expect(f.valor).toBe("199,60");
    f = mudarFormDoCrm(f, "planoId", "pro", PLANOS);
    expect(f.valor).toBe("359,60");
    f = mudarFormDoCrm(f, "valor", "300,00", PLANOS);
    f = mudarFormDoCrm(f, "email", "ana@loja.com", PLANOS);
    expect(f.valor).toBe("300,00");
    f = mudarFormDoCrm(f, "usuarios", "5", PLANOS);
    expect(f.valor).toBe("449,50");
  });
});

describe("conferência do formulário do CRM", () => {
  const base = { planoId: "starter", usuarios: 3, valor: 149.7, email: "ana@loja.com", emailObrigatorio: true, loginDoPainel: "contato@loja.com" };
  it("tudo certo passa", () => {
    expect(conferirCrm(base)).toBeNull();
  });
  it("e-mail de quem administra é obrigatório quando ainda não tem ninguém", () => {
    expect(conferirCrm({ ...base, email: "  " })).toBe("Diga o e-mail de quem vai administrar o CRM.");
    expect(conferirCrm({ ...base, email: "", emailObrigatorio: false })).toBeNull();
    expect(conferirCrm({ ...base, email: "ana@" })).toContain("inválido");
  });
  it("o login geral do painel não vira usuário do CRM", () => {
    expect(conferirCrm({ ...base, email: " Contato@Loja.com " })).toContain("separado do painel");
    expect(conferirCrm({ ...base, email: "contato@loja.com", loginDoPainel: null })).toBeNull();
  });
  it("usuários de 1 a 500, inteiro", () => {
    expect(conferirCrm({ ...base, usuarios: 0 })).toBe("Usuários vai de 1 a 500.");
    expect(conferirCrm({ ...base, usuarios: 501 })).toBe("Usuários vai de 1 a 500.");
    expect(conferirCrm({ ...base, usuarios: 2.5 })).toBe("Usuários vai de 1 a 500.");
    expect(conferirCrm({ ...base, usuarios: 1 })).toBeNull();
    expect(conferirCrm({ ...base, usuarios: 500 })).toBeNull();
  });
  it("não contrata menos do que as pessoas que já estão no CRM, e precisa de valor e plano", () => {
    expect(conferirCrm({ ...base, usuarios: 2, ocupados: 3 })).toContain("já tem 3 pessoas");
    expect(conferirCrm({ ...base, valor: 0 })).toBe("Diga o valor por mês.");
    expect(conferirCrm({ ...base, planoId: "" })).toBe("Escolha o plano do CRM.");
  });
});

describe("estado do CRM na linha do extra", () => {
  const crm = (o: Record<string, unknown> = {}) => lerCrmDoCliente({
    conta_id: "c1", nome: "Loja", estado: "suspensa", cobranca_por: "plano", extra_id: "e1", plano_id: "starter",
    usuarios_contratados: 3, acesso_ate: null, liberada: false, usuarios_ativos: 1, convites: 1,
    equipe: [{ id: "m1", nome: "Ana", email: "ana@loja.com", papel: "admin", estado: "ativo" }, { id: "m2", nome: "Bia", email: "bia@loja.com", papel: "usuario", estado: "convidado" }],
    assinatura_no_cartao: false, ...o,
  });
  const extra = { id: "e1", status: "ativo" };

  it("lê o que o banco devolve e null quando não tem CRM", () => {
    expect(lerCrmDoCliente(null)).toBeNull();
    expect(lerCrmDoCliente({})).toBeNull();
    const c = crm();
    expect(c?.cobranca_por).toBe("plano");
    expect(c?.equipe).toHaveLength(2);
    expect(lerCrmDoCliente({ conta_id: "x", usuarios_contratados: "4" })?.usuarios_contratados).toBe(4);
  });
  it("sem pagamento: aguardando, com os usuários usados dos contratados", () => {
    const s = situacaoDoCrm(crm(), extra);
    expect(s).toMatchObject({ ligado: true, rotulo: "Aguardando pagamento", tom: "espera", temAdmin: true, ocupados: 2, cartao: false });
    expect(s.usuarios).toBe("2 de 3 usuários em uso · 1 convite pendente");
  });
  it("pago: liberado até o último dia do acesso (horário de Brasília)", () => {
    // O banco grava o instante em que acaba: 06/12 00:00 em Brasília. O último dia é 05/12.
    expect(ultimoDiaDoAcesso("2026-12-06T03:00:00+00:00")).toBe("05/12");
    const s = situacaoDoCrm(crm({ estado: "ativa", liberada: true, acesso_ate: "2026-12-06T03:00:00+00:00" }), extra);
    expect(s).toMatchObject({ rotulo: "Liberado até 05/12", tom: "ok" });
  });
  it("encerrado: o extra saiu ou a conta voltou para a assinatura", () => {
    expect(situacaoDoCrm(crm({ cobranca_por: "assinatura", estado: "cancelada", liberada: true, acesso_ate: "2026-12-06T03:00:00+00:00" }), { id: "e1", status: "encerrado" }).rotulo).toBe("Encerrado, acesso até 05/12");
    expect(situacaoDoCrm(crm({ cobranca_por: "assinatura", estado: "suspensa" }), { id: "e1", status: "encerrado" }).rotulo).toBe("Encerrado");
    expect(situacaoDoCrm(null, { id: "e9", status: "encerrado" }).rotulo).toBe("Encerrado");
  });
  it("extra que ainda não é o da conta: não ligado; pago no cartão avisa", () => {
    expect(situacaoDoCrm(null, extra)).toMatchObject({ ligado: false, rotulo: "CRM ainda não ligado", usuarios: null });
    expect(situacaoDoCrm(crm({ extra_id: null, cobranca_por: "assinatura", assinatura_no_cartao: true }), extra)).toMatchObject({ ligado: false, cartao: true });
  });
});

describe("aviso depois de ligar e erros do banco", () => {
  it("aguardando o pagamento ou já liberado", () => {
    expect(avisoDoCrmLigado({ conta_id: "c", membro_id: "m", estado: "suspensa", acesso_ate: null, liberada: false, convite_enviado: true }, "Ana@Loja.com"))
      .toBe("CRM ligado. Convite enviado para ana@loja.com. O acesso libera quando você marcar a cobrança como paga.");
    expect(avisoDoCrmLigado({ conta_id: "c", membro_id: null, estado: "ativa", acesso_ate: "2026-12-06T03:00:00+00:00", liberada: true, convite_enviado: false }, ""))
      .toBe("CRM ligado. Liberado até 05/12.");
  });
  it("segundo CRM vivo do mesmo cliente vira frase clara", () => {
    expect(erroDeCrmRepetido({ code: "23505", message: 'duplicate key value violates unique constraint "client_extras_um_crm_vivo"' })).toContain("já tem um CRM ativo");
    expect(erroDeCrmRepetido({ message: "outra coisa" })).toBeNull();
  });
});

describe("telas", () => {
  const EXTRAS = ler("src/components/clientes/ExtrasDoCliente.tsx");
  const ENTRADA = ler("src/components/finance/NewIncomeModal.tsx");
  const API = ler("src/lib/produto/api.ts");
  it("a função do produto liga o CRM e a ficha lê o estado pelo banco", () => {
    expect(API).toContain('acao: "admin_crm_pelo_plano"');
    expect(ler("src/lib/crmPeloPlano.ts")).toContain('rpc("produto_crm_do_cliente"');
    expect(EXTRAS).toContain("Abrir no admin do produto");
    expect(EXTRAS).toContain("ligarCrmPeloPlano(");
  });
  it("a Nova entrada oferece o CRM ao lado do suporte e cria o extra pelo banco", () => {
    expect(ENTRADA).toContain("Tem CRM");
    expect(ENTRADA).toContain('categoria: "crm"');
    expect(ENTRADA).toContain("Termine na ficha do cliente, em Extras e produtos.");
    expect(ENTRADA).not.toMatch(/from\("billing"\)\.(insert|update|delete)/);
  });
  it("a linha de ajuda do e-mail separa o CRM do painel", () => {
    expect(ler("src/lib/crmPeloPlano.ts")).toContain("É a pessoa que entra no CRM. O login geral do painel continua só para o painel.");
  });
});

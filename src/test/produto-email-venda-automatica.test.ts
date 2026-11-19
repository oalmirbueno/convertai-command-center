import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  apagarCobrancaNoAsaas,
  contaDaReferencia,
  contaDaReferenciaDoEmail,
  criarCobrancaAvulsa,
  descricaoDaEntrada,
  mesQueVem,
  referenciaDoEmail,
} from "../../supabase/functions/produto/modulos/asaas";
import { assinarEmailDepoisDoPagamento } from "../../supabase/functions/produto/modulos/email-venda";
import {
  RASCUNHO_VAZIO,
  contaDoEmail,
  contaDoPedido,
  corpoDoPedido,
  documentoDoPagador,
  ofertasDoTipo,
  ofertasEscolhidas,
  tipoDoRascunho,
} from "@/lib/produto/venda-email";

const raiz = resolve(__dirname, "../..");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");
const CONTA = "10000000-0000-4000-8000-00000000000a";

type Linha = Record<string, unknown>;

/** Um banco falso com o pedaço do cliente do Supabase que a venda usa. */
function bancoFalso(tabelas: Record<string, Linha[]>, rpc: Record<string, unknown> = {}) {
  const escritas: Array<{ tabela: string; tipo: string; linha: Linha }> = [];
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let limite = Infinity;
    const linhas = () => (tabelas[tabela] || []).filter((l) => filtros.every((f) => f(l))).slice(0, limite);
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.indexOf(l[c]) >= 0), q),
      order: () => q,
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => ({ data: linhas()[0] || null, error: null }),
      then: (ok: (r: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: linhas(), error: null }).then(ok),
      upsert: async (linha: Linha) => {
        escritas.push({ tabela, tipo: "upsert", linha });
        const lista = (tabelas[tabela] = tabelas[tabela] || []);
        const i = lista.findIndex((l) => l.conta_id === linha.conta_id);
        if (i >= 0) lista[i] = { ...lista[i], ...linha };
        else lista.push(linha);
        return { error: null };
      },
      insert: async (linha: Linha) => (escritas.push({ tabela, tipo: "insert", linha }), { error: null }),
    };
    return q;
  };
  return { db: { from, rpc: async (f: string) => ({ data: rpc[f] ?? null, error: null }) }, escritas };
}

/** Um Asaas falso: guarda as chamadas e responde a assinatura. */
function asaasFalso(existente: Linha | null = null) {
  const chamadas: Array<{ metodo: string; url: string; corpo: Linha | null }> = [];
  const buscar = async (url: string, init?: RequestInit) => {
    const metodo = String(init?.method || "GET");
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Linha) : null;
    chamadas.push({ metodo, url, corpo });
    if (metodo === "GET" && url.indexOf("/v3/subscriptions?externalReference=") >= 0) {
      return new Response(JSON.stringify({ data: existente ? [existente] : [] }), { status: 200 });
    }
    if (metodo === "POST" && url.endsWith("/v3/subscriptions")) {
      return new Response(JSON.stringify({ id: "sub_novo1", customer: corpo?.customer, value: corpo?.value, nextDueDate: corpo?.nextDueDate, status: "ACTIVE", externalReference: corpo?.externalReference }), { status: 200 });
    }
    if (metodo === "POST" && url.endsWith("/v3/payments")) {
      return new Response(JSON.stringify({ id: "pay_1", customer: corpo?.customer, value: corpo?.value, status: "PENDING", dueDate: corpo?.dueDate, invoiceUrl: "https://sandbox.asaas.com/i/1", externalReference: corpo?.externalReference }), { status: 200 });
    }
    if (metodo === "DELETE") return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  return { buscar, chamadas };
}

const PEDIDO_PAGO = { id: "p1", conta_id: CONTA, estado: "em_andamento", pago_em: "2026-11-19", extra_id: null };
const CALCULO = { itens_mensais: [{ chave: "email", nome: "E-mail profissional", quantidade: 1, unitario: 39.9 }, { chave: "oferta_dominio_gerenciado", nome: "Domínio gerenciado", quantidade: 1, unitario: 14.9 }] };

describe("datas e referências da venda do e-mail", () => {
  it("a mensalidade começa no mesmo dia do mês que vem, e o fim do mês não pula", () => {
    expect(mesQueVem("2026-11-19")).toBe("2026-12-19");
    expect(mesQueVem("2026-12-15")).toBe("2027-01-15");
    expect(mesQueVem("2027-01-31")).toBe("2027-02-28");
  });

  it("a referência do e-mail não se confunde com a do CRM", () => {
    expect(referenciaDoEmail(CONTA)).toBe(`email:${CONTA}`);
    expect(contaDaReferenciaDoEmail(`email:${CONTA}`)).toBe(CONTA);
    expect(contaDaReferencia(`email:${CONTA}`)).toBeNull();
    expect(contaDaReferenciaDoEmail(`conta:${CONTA}`)).toBeNull();
    expect(contaDaReferenciaDoEmail("email:qualquer")).toBeNull();
  });

  it("a fatura do pedido leva a marca e cada item", () => {
    expect(descricaoDaEntrada([{ chave: "migracao", nome: "Migração do e-mail", quantidade: 1, unitario: 597, total: 597 }, { chave: "email", nome: "E-mail profissional, 1º mês", quantidade: 1, unitario: 39.9, total: 39.9 }]))
      .toBe("Aceleriq · Migração do e-mail · E-mail profissional, 1º mês");
  });
});

describe("a cobrança única do pedido no Asaas", () => {
  it("abre com Pix, boleto ou cartão, a referência do pedido e a volta ao painel", async () => {
    const a = asaasFalso();
    const pg = await criarCobrancaAvulsa("$aact_hmlg_teste", a.buscar, { clienteId: "cus_1", valor: 748.8, descricao: "x", referencia: `conta:${CONTA}:migracao`, vencimento: "2026-11-22", voltarPara: "https://aceleriq.online/app/email?pagamento=ok" });
    const corpo = a.chamadas[0].corpo as Linha;
    expect(a.chamadas[0].url.indexOf("api-sandbox.asaas.com") >= 0).toBe(true);
    expect(corpo.billingType).toBe("UNDEFINED");
    expect(corpo.externalReference).toBe(`conta:${CONTA}:migracao`);
    expect(corpo.callback).toEqual({ successUrl: "https://aceleriq.online/app/email?pagamento=ok", autoRedirect: true });
    expect(pg.link).toBe("https://sandbox.asaas.com/i/1");
  });

  it("apaga só id de cobrança válido", async () => {
    const a = asaasFalso();
    expect(await apagarCobrancaNoAsaas("$aact_hmlg_teste", a.buscar, "qualquer")).toBe(false);
    expect(a.chamadas.length).toBe(0);
    expect(await apagarCobrancaNoAsaas("$aact_hmlg_teste", a.buscar, "pay_123")).toBe(true);
  });
});

describe("a mensalidade do e-mail nasce sozinha depois do pagamento", () => {
  it("cria a assinatura do mês que vem com o e-mail e as ofertas mensais", async () => {
    const { db, escritas } = bancoFalso({ produto_email_pedidos: [PEDIDO_PAGO], produto_contas: [{ id: CONTA, estado: "teste" }] }, { produto_email_cobranca_do_pedido: CALCULO });
    const a = asaasFalso();
    const r = await assinarEmailDepoisDoPagamento(db, "$aact_hmlg_teste", a.buscar, { contaId: CONTA, clienteId: "cus_1", agora: new Date("2026-11-19T15:00:00Z") });
    expect(r).toMatchObject({ feito: "criada", assinatura_id: "sub_novo1", valor: 54.8, proximo_vencimento: "2026-12-19" });
    const post = a.chamadas.find((c) => c.metodo === "POST") as { corpo: Linha };
    expect(post.corpo).toMatchObject({ customer: "cus_1", billingType: "UNDEFINED", value: 54.8, cycle: "MONTHLY", nextDueDate: "2026-12-19", externalReference: `email:${CONTA}` });
    const guardada = escritas.find((e) => e.tabela === "produto_email_assinaturas") as { linha: Linha };
    expect(guardada.linha).toMatchObject({ conta_id: CONTA, asaas_assinatura_id: "sub_novo1", estado: "ativa", valor_mensal: 54.8 });
  });

  it("o aviso repetido não cria outra assinatura", async () => {
    const { db } = bancoFalso({ produto_email_assinaturas: [{ conta_id: CONTA, asaas_assinatura_id: "sub_ja", estado: "ativa", valor_mensal: 54.8 }] });
    const a = asaasFalso();
    const r = await assinarEmailDepoisDoPagamento(db, "$aact_hmlg_teste", a.buscar, { contaId: CONTA, clienteId: "cus_1" });
    expect(r).toMatchObject({ feito: "ja_existia", assinatura_id: "sub_ja" });
    expect(a.chamadas.length).toBe(0);
  });

  it("se o banco perdeu a linha, acha a assinatura que já está no Asaas pela referência", async () => {
    const { db } = bancoFalso({ produto_email_pedidos: [PEDIDO_PAGO], produto_contas: [{ id: CONTA, estado: "teste" }] }, { produto_email_cobranca_do_pedido: CALCULO });
    const a = asaasFalso({ id: "sub_antiga", value: 54.8, status: "ACTIVE", externalReference: `email:${CONTA}`, nextDueDate: "2026-12-19" });
    const r = await assinarEmailDepoisDoPagamento(db, "$aact_hmlg_teste", a.buscar, { contaId: CONTA, clienteId: "cus_1" });
    expect(r).toMatchObject({ feito: "ja_existia", assinatura_id: "sub_antiga" });
    expect(a.chamadas.some((c) => c.metodo === "POST")).toBe(false);
  });

  it("cliente da Aceleriq (mensal no extra) e cortesia não ganham assinatura", async () => {
    for (const [pedido, conta] of [[{ ...PEDIDO_PAGO, extra_id: "e1" }, { id: CONTA, estado: "ativa" }], [PEDIDO_PAGO, { id: CONTA, estado: "cortesia" }]] as const) {
      const { db } = bancoFalso({ produto_email_pedidos: [pedido], produto_contas: [conta] }, { produto_email_cobranca_do_pedido: CALCULO });
      const a = asaasFalso();
      expect((await assinarEmailDepoisDoPagamento(db, "$aact_hmlg_teste", a.buscar, { contaId: CONTA, clienteId: "cus_1" })).feito).toBe("cobrada_fora");
      expect(a.chamadas.length).toBe(0);
    }
  });

  it("sem mensalidade (e-mail incluído no plano) não cria nada", async () => {
    const { db } = bancoFalso({ produto_email_pedidos: [PEDIDO_PAGO], produto_contas: [{ id: CONTA, estado: "teste" }] }, { produto_email_cobranca_do_pedido: { itens_mensais: [] } });
    const a = asaasFalso();
    expect((await assinarEmailDepoisDoPagamento(db, "$aact_hmlg_teste", a.buscar, { contaId: CONTA, clienteId: "cus_1" })).feito).toBe("sem_mensalidade");
    expect(a.chamadas.length).toBe(0);
  });
});

describe("a conta do pedido na tela (a mesma regra do banco)", () => {
  const ofertas = [
    { id: "dominio_gerenciado", nome: "Domínio gerenciado", descricao: "", cobranca: "mensal" as const, valor: 14.9, mostra_em: "ambos" as const, marcada: true },
    { id: "site_cuidado", nome: "Site hospedado e cuidado", descricao: "", cobranca: "mensal" as const, valor: 69, mostra_em: "ambos" as const, marcada: false },
    { id: "backup_antigo", nome: "Backup do e-mail antigo", descricao: "", cobranca: "unica" as const, valor: 97, mostra_em: "migracao" as const, marcada: false },
  ];
  const precos = { email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9, email_migracao: 597 };

  it("sem mexer, valem as que já vêm marcadas; a escolha da pessoa troca", () => {
    expect(ofertasEscolhidas(ofertas, { ...RASCUNHO_VAZIO })).toEqual(["dominio_gerenciado"]);
    expect(ofertasEscolhidas(ofertas, { ...RASCUNHO_VAZIO, ofertas: ["site_cuidado", "backup_antigo"] })).toEqual(["site_cuidado", "backup_antigo"]);
  });

  it("no e-mail novo a oferta só da migração some, mesmo marcada", () => {
    const r = { ...RASCUNHO_VAZIO, semEmail: true, ofertas: ["backup_antigo", "site_cuidado"] };
    expect(tipoDoRascunho(r)).toBe("novo");
    expect(ofertasDoTipo(ofertas, "novo").map((o) => o.id)).toEqual(["dominio_gerenciado", "site_cuidado"]);
    expect(ofertasEscolhidas(ofertas, r)).toEqual(["site_cuidado"]);
  });

  it("hoje: migração, 1º mês e ofertas; depois: e-mail e ofertas mensais", () => {
    const c = contaDoPedido(contaDoEmail(precos, 7), ofertas, ["dominio_gerenciado", "backup_antigo"], "migracao");
    expect(c.hoje).toBe(Math.round((597 + 39.9 + 2 * 14.9 + 14.9 + 97) * 100) / 100);
    expect(c.mensal).toBe(Math.round((39.9 + 2 * 14.9 + 14.9) * 100) / 100);
    const novo = contaDoPedido(contaDoEmail(precos, 1), ofertas, ["site_cuidado"], "novo");
    expect(novo).toMatchObject({ hoje: 108.9, mensal: 108.9 });
    expect(novo.linhas.some((l) => l.nome.indexOf("Migração") >= 0)).toBe(false);
  });

  it("o pedido leva o tipo e as ofertas para o servidor", () => {
    expect(corpoDoPedido({ ...RASCUNHO_VAZIO, dominio: "Empresa.com.br", semEmail: true }, ["site_cuidado"])).toMatchObject({ dominio: "empresa.com.br", tipo: "novo", ofertas: ["site_cuidado"] });
    expect(corpoDoPedido({ ...RASCUNHO_VAZIO, dominio: "empresa.com.br" })).not.toHaveProperty("ofertas");
  });

  it("CPF e CNPJ só passam no tamanho certo", () => {
    expect(documentoDoPagador("123.456.789-09")).toBe("12345678909");
    expect(documentoDoPagador("12.345.678/0001-90")).toBe("12345678000190");
    expect(documentoDoPagador("123")).toBeNull();
  });

  it("a tela mostra as ofertas, o total de hoje e o mensal, e só cobra com a cobrança ligada", () => {
    const tela = ler("src/pages/EmailPedir.tsx");
    expect(tela).toContain("data-ofertas-do-pedido");
    expect(tela).toContain("data-total-hoje");
    expect(tela).toContain("data-mensal-depois");
    expect(tela).toMatch(/if \(pagaAgora\) \{[\s\S]{0,200}pagarEmail\(/);
    expect(tela).not.toMatch(/—/);
  });
});

describe("o aviso do Asaas e a função do produto", () => {
  const aviso = ler("supabase/functions/produto-asaas-webhook/index.ts");
  const produto = ler("supabase/functions/produto/index.ts");

  it("o aviso separa a mensalidade do e-mail da do CRM", () => {
    expect(aviso).toContain("contaDaAssinaturaDoEmail");
    expect(aviso).toContain('tipo: dono.tipo === "email" ? "mensalidade" : dono.tipo');
    expect(aviso).toContain("assinarEmailDepoisDoPagamento(db, token, fetch");
    // A mensalidade do e-mail atrasada avisa a casa, mas não corta o e-mail na fase 1.
    expect(aviso).toMatch(/perdeuOPagamento && dono\.tipo === "email"[\s\S]{0,200}produto_email_assinaturas/);
  });

  it("o cliente só paga sozinho com a cobrança geral ligada; a casa gera o link sempre", () => {
    expect(produto).toMatch(/async function pagarEmail[\s\S]{0,200}pagamentosLigados\(\)/);
    expect(produto).toMatch(/async function adminCobrarEntradaEmail[\s\S]{0,120}exigirDono\(ch\)/);
    expect(produto).toContain("pagar_email: pagarEmail");
    expect(produto).toContain("admin_cobrar_entrada_email: adminCobrarEntradaEmail");
  });

  it("a fatura do pedido usa a referência que o gatilho do banco já entende", () => {
    expect(produto).toMatch(/cobrarEntradaDoEmail[\s\S]*referencia: `conta:\$\{contaId\}:migracao`/);
  });
});

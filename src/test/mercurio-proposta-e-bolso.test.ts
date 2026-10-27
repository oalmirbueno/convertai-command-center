import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O Mercúrio conduz até o contrato (MCP 2.23, 28/10/2026): o rascunho de proposta do lead (preço do catálogo,
 * moeda no investimento, verba só nas notas), a proposta em rascunho para o lead que já é cliente, o pedido que
 * espera o cliente ser criado, e o Aceleriq de Bolso que só libera com pagamento confirmado por pessoa ou gateway.
 * O banco é um falso em memória com as chamadas do supabase-js usadas pelo serviço.
 */

type Linha = Record<string, any>;
const banco: Record<string, Linha[]> = {};
let seq = 0;
let respostaDaRpc: { data: unknown; error: unknown } = { data: null, error: null };
const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];

function consulta(tabela: string) {
  const filtros: Array<(l: Linha) => boolean> = [];
  let modo: "select" | "insert" | "update" = "select";
  let carga: Linha | null = null;
  let contar = false;
  let cabeca = false;
  let limite = Infinity;
  const linhas = () => (banco[tabela] = banco[tabela] || []);
  const casa = (l: Linha) => filtros.every((f) => f(l));
  const b: any = {
    select(_c?: string, o?: { count?: string; head?: boolean }) {
      if (o && o.count) contar = true;
      if (o && o.head) cabeca = true;
      return b;
    },
    insert(obj: Linha) { modo = "insert"; carga = obj; return b; },
    update(obj: Linha) { modo = "update"; carga = obj; return b; },
    eq(c: string, v: unknown) { filtros.push((l) => l[c] === v); return b; },
    neq(c: string, v: unknown) { filtros.push((l) => l[c] !== v); return b; },
    is(c: string, v: unknown) { filtros.push((l) => (l[c] ?? null) === v); return b; },
    in(c: string, vs: unknown[]) { filtros.push((l) => vs.indexOf(l[c]) >= 0); return b; },
    gte(c: string, v: string) { filtros.push((l) => String(l[c]) >= v); return b; },
    like(c: string, v: string) { const p = v.replace(/%$/, ""); filtros.push((l) => String(l[c] ?? "").indexOf(p) === 0); return b; },
    order() { return b; },
    limit(n: number) { limite = n; return b; },
    maybeSingle() { return Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })); },
    single() { return Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })); },
    then(ok: any, erro: any) { return Promise.resolve(exec()).then(ok, erro); },
  };
  function exec(): { data: any; error: any; count?: number } {
    if (modo === "insert") {
      const nova: Linha = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, created_at: new Date().toISOString(), criado_em: new Date().toISOString(), ...(carga as Linha) };
      if (tabela === "commercial_pedidos_proposta" && nova.situacao === "aguardando_cliente" && linhas().some((l) => l.lead_id === nova.lead_id && l.situacao === "aguardando_cliente")) {
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      }
      linhas().push(nova);
      return { data: [nova], error: null };
    }
    if (modo === "update") {
      const alvo = linhas().filter(casa);
      alvo.forEach((l) => Object.assign(l, carga));
      return { data: alvo, error: null };
    }
    const r = linhas().filter(casa);
    if (contar && cabeca) return { data: null, error: null, count: r.length };
    return { data: r.slice(0, limite), error: null, count: r.length };
  }
  return b;
}

vi.mock("../../supabase/functions/_shared/aceleriq-read-services.ts", () => ({
  db: () => ({
    from: (t: string) => consulta(t),
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return Promise.resolve(respostaDaRpc);
    },
  }),
  isUuid: (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
  READ_LIMITS: { queryTimeoutMs: 5000 },
}));

import {
  aplicarPedidoNaProposta,
  itensDoPlano,
  itemManual,
  juntarItens,
  montarRascunhoDoLead,
} from "../../supabase/functions/_shared/proposta-do-lead";
import { blocoDoTipo, MODELO_PADRAO_ACELERIQ, conteudoDoModelo } from "../../supabase/functions/_shared/proposta-modelo";
import {
  BOLSO_ANUAL_CENTAVOS,
  checkoutDoBolso,
  comercialBolsoLiberar,
  comercialBolsoPedir,
  comercialPedirProposta,
} from "../../supabase/functions/mcp-server/modulos/comercial-conduzir";
import { FERRAMENTAS_POR_AREA, REGRAS_DE_ACAO } from "../../supabase/functions/mcp-server/modulos/guia-do-painel";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";

const ctx = { dataScope: { unrestricted: true }, keyName: "hermes", scopes: ["admin"] } as any;
const restrito = { dataScope: { unrestricted: false }, keyName: "cliente", scopes: [] } as any;
const LEAD = "11111111-1111-4111-8111-111111111111";
const LEAD_CLIENTE = "22222222-2222-4222-8222-222222222222";
const CLIENTE = "33333333-3333-4333-8333-333333333333";
const PLANO = "44444444-4444-4444-8444-444444444444";
const SERVICO = "55555555-5555-4555-8555-555555555555";
const POLITICA = "66666666-6666-4666-8666-666666666666";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

beforeEach(() => {
  for (const k of Object.keys(banco)) delete banco[k];
  rpcs.length = 0;
  respostaDaRpc = { data: null, error: null };
  banco.commercial_leads = [
    { id: LEAD, name: "Ana", company: "Clínica Sorriso", email: "ana@sorriso.com.br", whatsapp: "5541999990000", stage: "diagnostico", won_client_id: null, archived_at: null },
    { id: LEAD_CLIENTE, name: "Bruno", company: "Pet Feliz", email: null, whatsapp: "5541988880000", stage: "proposta", won_client_id: CLIENTE, archived_at: null },
  ];
  banco.financial_plans = [{ id: PLANO, name: "Aceleração", description: "Social e tráfego", archived_at: null }];
  banco.financial_plan_versions = [{ plan_id: PLANO, is_active: true, final_amount: 847, billing_period: "monthly", setup_fee: 300, valid_from: "2026-10-01" }];
  banco.proposta_servicos = [{ id: SERVICO, nome: "Site institucional", descricao: "Até 5 páginas", preco: 2500, recorrencia: "unico", horas: null, arquivado_em: null }];
  banco.bolso_politicas = [{ id: POLITICA, versao: 2, estado: "aprovado", teste: false, dados: { creditos_iniciais: 100, validade_meses: 12 } }];
});

describe("rascunho da proposta a partir do lead", () => {
  const pedido = { negocio: "Clínica odontológica em Curitiba", dor: "Agenda vazia nas terças", verba: "uns 2 mil por mês", palavras_do_cliente: ["Ninguém marca pela internet"] };

  it("a dor vai para o desafio, a verba só para as notas e real não grava moeda", () => {
    const itens = itensDoPlano({ id: PLANO, name: "Aceleração" }, { final_amount: 847, billing_period: "monthly", setup_fee: 300 });
    expect(itens.map((i) => [i.nome, i.valor_unitario, i.recorrencia, i.origem])).toEqual([
      ["Aceleração", 847, "mensal", "plano"],
      ["Implantação Aceleração", 300, "unico", "plano"],
    ]);
    const r = montarRascunhoDoLead({ modelo: MODELO_PADRAO_ACELERIQ, lead: { name: "Ana", company: "Clínica Sorriso" }, pedido, itens, operador: "mercurio", hoje: "2026-10-28" });
    expect(r.titulo).toBe("Proposta para Clínica Sorriso");
    const desafio = blocoDoTipo(r.conteudo, "desafio").dados;
    expect(desafio.texto).toBe("Agenda vazia nas terças");
    expect(desafio.palavras_do_cliente).toEqual(["Ninguém marca pela internet"]);
    expect(blocoDoTipo(r.conteudo, "investimento").dados.moeda).toBeUndefined();
    expect(JSON.stringify(r.conteudo)).not.toContain("2 mil");
    expect(r.notas).toContain("uns 2 mil por mês");
    expect(r.total).toBe("R$ 300,00 + R$ 847,00 por mês");
  });

  it("exterior: a moeda fica em investimento.dados.moeda e o valor do agente vira pendência", () => {
    const itens = juntarItens(itemManual({ nome: "Gestão de redes", valor: 197, recorrencia: "mensal" }));
    const r = montarRascunhoDoLead({ modelo: MODELO_PADRAO_ACELERIQ, lead: { name: "Luis" }, pedido: { ...pedido, moeda: "USD" }, itens, operador: "mercurio", hoje: "2026-10-28" });
    expect(blocoDoTipo(r.conteudo, "investimento").dados.moeda).toBe("USD");
    expect(r.total).toBe("US$ 197,00 por mês");
    expect(r.pendencias.join(" ")).toContain("Gestão de redes");
    expect(r.notas).toContain("dólar");
  });

  it("a Mesa leva capa, desafio e moeda do pedido para a proposta nova", () => {
    const r = montarRascunhoDoLead({ modelo: MODELO_PADRAO_ACELERIQ, lead: { name: "Luis" }, pedido: { ...pedido, moeda: "EUR" }, itens: [], operador: "mercurio", hoje: "2026-10-28" });
    const nova = aplicarPedidoNaProposta(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), { conteudo: r.conteudo });
    expect(blocoDoTipo(nova, "investimento").dados.moeda).toBe("EUR");
    expect(blocoDoTipo(nova, "desafio").dados.texto).toBe("Agenda vazia nas terças");
    expect(blocoDoTipo(nova, "capa").dados.projeto).toBe("Clínica odontológica em Curitiba");
    expect(aplicarPedidoNaProposta(nova, { conteudo: null })).toBe(nova);
  });
});

describe("aceleriq_comercial_pedir_proposta", () => {
  const base = { negocio: "Clínica odontológica", dor: "Agenda vazia" };

  it("lead sem ficha: guarda o rascunho, avisa a Caixa e não há link público", async () => {
    const r: any = await comercialPedirProposta({ ...base, lead_id: LEAD, plano_id: PLANO, servico_ids: [SERVICO] }, ctx);
    expect(r).toMatchObject({ criado: true, situacao: "aguardando_cliente", proposta: null, link_publico: null, link_mesa: `/mesa-proposta?lead=${LEAD}` });
    expect(banco.propostas || []).toHaveLength(0);
    const pedido = banco.commercial_pedidos_proposta[0];
    expect(pedido.itens.map((i: any) => i.valor_unitario)).toEqual([847, 300, 2500]);
    expect(banco.commercial_handoffs).toHaveLength(1);
    expect(banco.commercial_handoffs[0]).toMatchObject({ tipo: "avancou", lead_id: LEAD });
    expect(pedido.handoff_id).toBe(banco.commercial_handoffs[0].id);
    // De novo: devolve o mesmo, sem duplicar.
    const de_novo: any = await comercialPedirProposta({ ...base, lead_id: LEAD }, ctx);
    expect(de_novo).toMatchObject({ ja_existia: true, pedido_id: pedido.id });
    expect(banco.commercial_pedidos_proposta).toHaveLength(1);
  });

  it("lead que já é cliente: proposta em rascunho na Mesa com número; o link público só depois do envio", async () => {
    const r: any = await comercialPedirProposta({ ...base, lead_id: LEAD_CLIENTE, plano_id: PLANO }, ctx);
    expect(banco.propostas).toHaveLength(1);
    const p = banco.propostas[0];
    expect(p).toMatchObject({ client_id: CLIENTE, lead_id: LEAD_CLIENTE, total_mensal: 847, total_unico: 300, criado_por: null });
    expect(p.numero).toMatch(/^\d{4}-001$/);
    expect(p.contexto.notas).toContain("Agenda vazia");
    expect(r).toMatchObject({ situacao: "rascunho_criado", link_publico: null });
    expect(r.link_mesa).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${p.id}`);
    expect(banco.proposta_eventos[0]).toMatchObject({ tipo: "criada", proposta_id: p.id });
    // O Almir enviou: chamar de novo devolve o link público.
    Object.assign(p, { status: "enviada", token: "a".repeat(64) });
    const depois: any = await comercialPedirProposta({ ...base, lead_id: LEAD_CLIENTE }, ctx);
    expect(depois.ja_existia).toBe(true);
    expect(depois.link_publico).toMatch(/\/proposta\/a{64}$/);
  });

  it("catálogo é em reais: US$ com plano do Financeiro recusa; credencial de cliente não alcança", async () => {
    await expect(comercialPedirProposta({ ...base, lead_id: LEAD, moeda: "USD", plano_id: PLANO }, ctx)).rejects.toThrow(/itens_manuais/);
    await expect(comercialPedirProposta({ ...base, lead_id: LEAD }, restrito)).rejects.toThrow(/area interna/);
  });
});

describe("Aceleriq de Bolso pelo Mercúrio", () => {
  it("o pedido leva a política aprovada e R$ 97; checkout desligado não manda link", async () => {
    const r: any = await comercialBolsoPedir({ lead_id: LEAD }, ctx);
    expect(r).toMatchObject({ criado: true, situacao: "aguardando_pagamento", email: "ana@sorriso.com.br", valor: "R$ 97,00", checkout: { ligado: false, url: null } });
    expect(banco.commercial_bolso_pedidos[0]).toMatchObject({ politica_id: POLITICA, valor_centavos: BOLSO_ANUAL_CENTAVOS, moeda: "BRL", produto: "anual" });
    expect(r.regra).toMatch(/Comprovante/);
    expect(banco.commercial_handoffs[0].dados.bolso_pedido_id).toBe(r.pedido_id);
    const de_novo: any = await comercialBolsoPedir({ lead_id: LEAD }, ctx);
    expect(de_novo.ja_existia).toBe(true);
    expect(banco.commercial_bolso_pedidos).toHaveLength(1);
  });

  it("sem política aprovada não vende; sem e-mail pede o e-mail", async () => {
    await expect(comercialBolsoPedir({ lead_id: LEAD_CLIENTE }, ctx)).rejects.toThrow(/email/);
    banco.bolso_politicas[0].estado = "rascunho";
    await expect(comercialBolsoPedir({ lead_id: LEAD }, ctx)).rejects.toThrow(/politica comercial aprovada/);
  });

  it("checkout pronto: só https, com o e-mail preenchido", () => {
    expect(checkoutDoBolso("ana@x.com", "")).toBeNull();
    expect(checkoutDoBolso("ana@x.com", "http://pay.kiwify.com.br/abc")).toBeNull();
    expect(checkoutDoBolso("ana@x.com", "https://pay.kiwify.com.br/abc")).toBe("https://pay.kiwify.com.br/abc?email=ana%40x.com");
    expect(checkoutDoBolso("ana@x.com", "https://pay.kiwify.com.br/abc?ref=1")).toBe("https://pay.kiwify.com.br/abc?ref=1&email=ana%40x.com");
  });

  it("liberar só pela RPC do banco: sem pagamento confirmado não libera e pede para não insistir", async () => {
    const p: any = await comercialBolsoPedir({ lead_id: LEAD }, ctx);
    respostaDaRpc = { data: { liberado: false, motivo: "pagamento_nao_confirmado" }, error: null };
    const r: any = await comercialBolsoLiberar({ lead_id: LEAD }, ctx);
    expect(rpcs[0]).toEqual({ nome: "comercial_bolso_liberar_por_agente", args: { _pedido: p.pedido_id, _operador: "mercurio" } });
    expect(r).toMatchObject({ liberado: false, motivo: "pagamento_nao_confirmado", nao_insistir: true });
    respostaDaRpc = { data: { liberado: false, motivo: "conta_ausente" }, error: null };
    expect(((await comercialBolsoLiberar({ pedido_id: p.pedido_id }, ctx)) as any).orientacao).toMatch(/criar a conta/);
    respostaDaRpc = { data: { liberado: true, ja_liberado: false, direito_id: "d-1" }, error: null };
    const ok: any = await comercialBolsoLiberar({ pedido_id: p.pedido_id }, ctx);
    expect(ok).toMatchObject({ liberado: true, direito_id: "d-1" });
    expect(ok.mensagem_sugerida).toMatch(/\/membros/);
  });
});

describe("banco: quem confirma e quem libera", () => {
  const sql = ler("supabase/migrations/20261028090000_mercurio_proposta_e_bolso.sql");

  it("é a migration mais nova e só acrescenta", () => {
    const nomes = readdirSync(resolve(__dirname, "../../supabase/migrations")).filter((n: string) => /^\d{14}_/.test(n)).sort();
    expect(nomes[nomes.length - 1]).toBe("20261028090000_mercurio_proposta_e_bolso.sql");
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b|ALTER TABLE public\.(propostas|bolso_|vendas_|commercial_leads)/i);
  });

  it("a confirmação humana é só da administração e o agente só libera com a chave de serviço", () => {
    const confirmar = sql.slice(sql.indexOf("CREATE FUNCTION public.comercial_bolso_confirmar_pagamento"), sql.indexOf("CREATE FUNCTION public.comercial_bolso_liberar_por_agente"));
    expect(confirmar).toContain("public.has_role(a, 'admin'::public.app_role)");
    expect(confirmar).toContain("confirmacao_origem = 'pessoa'");
    const agente = sql.slice(sql.indexOf("CREATE FUNCTION public.comercial_bolso_liberar_por_agente"));
    expect(agente).toContain("PERFORM bolso_privado.exigir_servico();");
    expect(agente).toContain("e.tipo = 'compra_aprovada'");
    expect(agente).toContain("'reembolso', 'chargeback', 'cancelamento'");
    expect(agente).not.toContain("confirmacao_origem = 'pessoa'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.comercial_bolso_liberar_por_agente(uuid, text) TO service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.comercial_bolso_liberar_por_agente(uuid, text) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("bolso_privado.conceder(u, 'anual', v_origem, v_ref, p.politica_id, now(), _ator)");
    expect(sql).not.toMatch(/comprovante_(url|path|imagem)|image\/|base64/i);
  });
});

describe("MCP 2.23 com as ferramentas do Mercúrio até o contrato", () => {
  const novas = ["aceleriq_comercial_pedir_proposta", "aceleriq_comercial_bolso_pedir", "aceleriq_comercial_bolso_liberar"];

  it("cada ferramenta existe com escopo de escrita do comercial, no guia e no roteiro; versão 2.23", () => {
    expect(MCP_VERSION).toBe("2.23.0");
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    const lista = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["));
    const doc = ler("docs/comercial/MERCURIO.md");
    for (const nome of novas) {
      expect(tools, nome).toContain(`  ${nome}: 'commercial:write',`);
      const variavel = (tools.match(new RegExp("const (\\w+) = ferramentaDoCrm\\(\\s*'" + nome + "'")) || [])[1];
      expect(variavel, nome).toBeTruthy();
      expect(lista, nome).toContain(`  ${variavel},`);
      expect(FERRAMENTAS_POR_AREA.comercial).toContain(nome);
      expect(doc).toContain(nome);
    }
    expect(REGRAS_DE_ACAO.join(" ")).toContain("Comprovante em imagem nunca libera");
    expect(doc.indexOf("—")).toBe(-1);
  });

  it("nada de lookbehind nem \\p{} nos arquivos novos (Safari 11)", () => {
    for (const p of ["supabase/functions/_shared/proposta-do-lead.ts", "supabase/functions/mcp-server/modulos/comercial-conduzir.ts", "src/components/comercial/CaixaDoComercial.tsx", "src/lib/comercial/mercurio.ts"]) {
      const t = ler(p);
      expect(t, p).not.toMatch(/\(\?<[=!]/);
      expect(t, p).not.toMatch(/\\p\{/);
    }
  });
});

/** Leituras locais com portas falsas. Nenhuma rede, cobrança, licença ou dado real. */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { catalogoDaCasa, lerCrmDaCasa, lerMembrosDaCasa, resumoDasEtapas, type ContextoDaCasa } from "./integracoes-da-casa.ts";
import { ErroHttp } from "./comum.ts";
import type { NoDoCanvas } from "./modulos/regras.ts";

const OPERADOR = "11111111-1111-4111-8111-111111111111";
const CLIENTE_A = "22222222-2222-4222-8222-222222222222";
const CLIENTE_B = "33333333-3333-4333-8333-333333333333";
const PRODUTO_A = "44444444-4444-4444-8444-444444444444";
const PRODUTO_B = "55555555-5555-4555-8555-555555555555";
const ctx = (cliente: string | null = CLIENTE_A): ContextoDaCasa => ({ token: "teste-sem-rede", projeto: { client_id: cliente }, userId: OPERADOR });
const no = (tipo: NoDoCanvas["tipo"], dados: Record<string, unknown>): NoDoCanvas => ({ id: "no-teste", tipo, dados, x: 0, y: 0 });
type Registro = Record<string, unknown>;
type Chamada = { nome: string; args?: Registro; filtros?: Array<[string, string, unknown]>; colunas?: string };
type Resposta = { data: unknown; error: unknown };

function porta(o: {
  admin?: boolean;
  clientePermitido?: boolean;
  role?: string | null;
  tabelas?: Record<string, Registro[]>;
  erroTabela?: string;
  responderCrm?: (args: Registro) => unknown;
} = {}) {
  const chamadas: Chamada[] = [];
  const tabela = (nome: string) => {
    const c: Chamada = { nome, filtros: [] };
    chamadas.push(c);
    let teto = Infinity;
    const resposta = (): Resposta => {
      let dados = o.tabelas?.[nome] || (nome === "user_roles" ? o.role === null ? [] : [{ user_id: OPERADOR, role: o.role || "admin" }] : []);
      for (const [operacao, coluna, valor] of c.filtros || []) {
        if (operacao === "eq" || operacao === "is") dados = dados.filter((x) => x[coluna] === valor);
        if (operacao === "neq") dados = dados.filter((x) => x[coluna] !== valor);
      }
      return { data: dados.slice(0, teto), error: o.erroTabela === nome ? new Error("falha simulada") : null };
    };
    const q = {
      select: (colunas: string) => { c.colunas = colunas; return q; },
      eq: (coluna: string, valor: unknown) => { c.filtros!.push(["eq", coluna, valor]); return q; },
      neq: (coluna: string, valor: unknown) => { c.filtros!.push(["neq", coluna, valor]); return q; },
      is: (coluna: string, valor: unknown) => { c.filtros!.push(["is", coluna, valor]); return q; },
      order: (_coluna: string) => q,
      limit: (n: number) => { teto = n; return q; },
      maybeSingle: () => { const r = resposta(); return Promise.resolve({ ...r, data: (r.data as unknown[])[0] || null }); },
      then: <T>(ok: (r: Resposta) => T, falha?: (e: unknown) => T) => Promise.resolve(resposta()).then(ok, falha),
    };
    return q;
  };
  const banco = {
    from: tabela,
    rpc: (nome: string, args: Registro = {}) => {
      chamadas.push({ nome, args });
      if (nome === "membros_admin") return Promise.resolve({ data: o.admin !== false, error: null });
      if (nome === "can_access_client") return Promise.resolve({ data: o.clientePermitido !== false, error: null });
      if (nome === "membros_ferramentas_admin") return Promise.resolve({ data: o.responderCrm?.(args) || {}, error: null });
      throw new Error(`RPC inesperada: ${nome}`);
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: OPERADOR } }, error: null }) },
  } as unknown as SupabaseClient;
  return { banco, chamadas };
}

Deno.test("casa: só CRM e membros têm catálogo nativo, sem consulta em outros nós", async () => {
  const p = porta();
  const erro = await assertRejects(() => catalogoDaCasa(ctx(), no("copy", {}), p.banco), ErroHttp);
  assertEquals(erro.status, 400);
  assertEquals(p.chamadas, []);
});

Deno.test("casa: sem JWT não cria cliente Supabase nem consulta catálogo ou biblioteca", async () => {
  const semSessao = { ...ctx(), token: "" };
  assertEquals((await assertRejects(() => catalogoDaCasa(semSessao, no("crm", {})), ErroHttp)).status, 401);
  assertEquals((await assertRejects(() => lerMembrosDaCasa(semSessao, no("area_membros", { plataforma: "painel", produto_membros_id: PRODUTO_A })), ErroHttp)).status, 401);
});

Deno.test("casa: designer sem administração de membros não lê catálogo nem biblioteca", async () => {
  const p = porta({ admin: false, role: "design" });
  for (const tipo of ["crm", "area_membros"] as const) {
    const erro = await assertRejects(() => catalogoDaCasa(ctx(), no(tipo, {}), p.banco), ErroHttp);
    assertEquals(erro.status, 403);
  }
  const erro = await assertRejects(() => lerMembrosDaCasa(ctx(), no("area_membros", { plataforma: "painel", produto_membros_id: PRODUTO_A }), p.banco), ErroHttp);
  assertEquals(erro.codigo, "membros_sem_administracao");
  assert(p.chamadas.every((c) => c.nome === "membros_admin"));
});

Deno.test("casa: catálogo mínimo exclui arquivados e só oferece CRM ativo", async () => {
  const p = porta({ tabelas: {
    membros_produtos: [{ id: PRODUTO_A, titulo: "CRM", estado: "publicado", segredo: "não devolver" }, { id: PRODUTO_B, titulo: "Curso", estado: "publicado" }, { id: "antigo", titulo: "Antigo", estado: "arquivado" }],
    membros_ferramentas: [{ produto_id: PRODUTO_A, motor: "crm", ativo: true }, { produto_id: PRODUTO_B, motor: "crm", ativo: false }],
  } });
  assertEquals(await catalogoDaCasa(ctx(), no("crm", {}), p.banco), [{ id: PRODUTO_A, titulo: "CRM", estado: "publicado" }]);
  assertEquals((await catalogoDaCasa(ctx(), no("area_membros", {}), p.banco)).length, 2);
  assert(!JSON.stringify(await catalogoDaCasa(ctx(), no("crm", {}), p.banco)).includes("segredo"));
});

Deno.test("casa: modo sem conexão nativa não faz chamadas", async () => {
  const p = porta();
  assertEquals(await lerCrmDaCasa(ctx(), no("crm", {}), p.banco), null);
  assertEquals(await lerMembrosDaCasa(ctx(), no("area_membros", { plataforma: "hotmart_club" }), p.banco), null);
  assertEquals(p.chamadas, []);
});

Deno.test("casa: CRM agência recusa designer e lista vazia de papéis antes dos leads", async () => {
  for (const role of ["design", null]) {
    const p = porta({ role });
    const erro = await assertRejects(() => lerCrmDaCasa(ctx(), no("crm", { crm_origem: "agencia" }), p.banco), ErroHttp);
    assertEquals(erro.codigo, "crm_agencia_sem_acesso");
    assertEquals(p.chamadas.map((x) => x.nome), ["user_roles"]);
  }
});

Deno.test("casa: CRM agência permite admin e gestor, agrega só estágio e exclui arquivados", async () => {
  for (const role of ["admin", "manager"]) {
    const p = porta({ role, tabelas: { commercial_leads: [{ id: 1, stage: "Novo", archived_at: null, email: "privado@example.invalid" }, { id: 2, stage: "Novo", archived_at: null }, { id: 3, stage: "Fechado", archived_at: "ontem" }] } });
    const r = await lerCrmDaCasa(ctx(), no("crm", { crm_origem: "agencia", produto_crm_id: PRODUTO_B }), p.banco);
    assertEquals(r!.json.origem, "agencia");
    assertEquals(r!.json.oportunidades, 2);
    assertEquals(r!.json.etapas, { Novo: 2 });
    assert(!JSON.stringify(r).includes("privado@example.invalid"));
    assert(p.chamadas.every((c) => c.nome === "user_roles" || c.nome === "commercial_leads"));
    assertEquals(p.chamadas.find((c) => c.nome === "commercial_leads")!.colunas, "stage");
  }
});

Deno.test("casa: CRM agência declara amostra quando há mais de mil oportunidades", async () => {
  const p = porta({ tabelas: { commercial_leads: Array.from({ length: 1005 }, (_, id) => ({ id, stage: "Novo", archived_at: null })) } });
  const r = await lerCrmDaCasa(ctx(), no("crm", { crm_origem: "agencia" }), p.banco);
  assertEquals(r!.json.oportunidades, 1000);
  assertEquals(r!.json.amostra, true);
  assert(r!.texto.includes("amostra"));
});

Deno.test("casa: CRM cliente exige cliente do projeto, acesso original e administração de membros", async () => {
  const n = no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A });
  const ausente = porta();
  assertEquals((await assertRejects(() => lerCrmDaCasa(ctx(null), n, ausente.banco), ErroHttp)).codigo, "crm_cliente_ausente");
  assertEquals(ausente.chamadas, []);
  const proibido = porta({ clientePermitido: false });
  assertEquals((await assertRejects(() => lerCrmDaCasa(ctx(), n, proibido.banco), ErroHttp)).codigo, "crm_cliente_sem_acesso");
  assertEquals(proibido.chamadas.map((c) => c.nome), ["can_access_client"]);
  const designer = porta({ admin: false });
  assertEquals((await assertRejects(() => lerCrmDaCasa(ctx(), n, designer.banco), ErroHttp)).codigo, "membros_sem_administracao");
  assertEquals(designer.chamadas.map((c) => c.nome), ["can_access_client", "membros_admin"]);
});

Deno.test("casa: CRM cliente usa titular do projeto e produto exatos, sem dados administrativos no contexto", async () => {
  const contatos = [{ user_id: CLIENTE_A, produto_id: PRODUTO_A, arquivado: false }, { user_id: CLIENTE_A, produto_id: PRODUTO_A, arquivado: true }, { user_id: CLIENTE_B, produto_id: PRODUTO_A, arquivado: false }, { user_id: CLIENTE_A, produto_id: PRODUTO_B, arquivado: false }];
  const negocios = [{ ...contatos[0], estagio: "Novo" }, { ...contatos[1], estagio: "Antigo" }, { ...contatos[2], estagio: "Outro cliente" }, { ...contatos[3], estagio: "Outro produto" }];
  const p = porta({ tabelas: { membros_ferramentas: [{ produto_id: PRODUTO_A, motor: "crm", ativo: true }, { produto_id: PRODUTO_B, motor: "crm", ativo: true }], profiles: [{ id: CLIENTE_A, company_name: "Cliente A" }, { id: CLIENTE_B, company_name: "Cliente B" }] }, responderCrm: (args) => ({ contatos: contatos.filter((c) => c.user_id === args._usuario && c.produto_id === args._produto), negocios: negocios.filter((c) => c.user_id === args._usuario && c.produto_id === args._produto), licencas: [{ email: "privado@example.invalid" }], exclusoes: [{ segredo: "fora do contexto" }] }) });
  const r = await lerCrmDaCasa(ctx(), no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A, user_id: CLIENTE_B, client_id: CLIENTE_B }), p.banco);
  assertEquals(r!.json.client_id, CLIENTE_A);
  assertEquals(r!.json.produto_id, PRODUTO_A);
  assertEquals(r!.json.contatos, 1);
  assertEquals(r!.json.negocios, 1);
  assertEquals(r!.json.etapas, { Novo: 1 });
  assert(r!.texto.includes("CRM de Cliente A"));
  assertEquals(p.chamadas.find((c) => c.nome === "membros_ferramentas_admin")!.args, { _usuario: CLIENTE_A, _produto: PRODUTO_A });
  assert(!JSON.stringify(r).includes("licencas") && !JSON.stringify(r).includes("privado") && !JSON.stringify(r).includes("exclusoes"));
  const outro = await lerCrmDaCasa(ctx(CLIENTE_B), no("crm", { crm_origem: "cliente", produto_crm_id: PRODUTO_A }), p.banco);
  assert(outro!.texto.includes("Cliente B"));
  assertEquals(outro!.json.etapas, { "Outro cliente": 1 });
});

Deno.test("casa: produto inválido ou ferramenta CRM inativa nunca consulta dados dos titulares", async () => {
  for (const produto_crm_id of ["inválido", PRODUTO_A]) {
    const p = porta({ tabelas: { membros_ferramentas: [{ produto_id: PRODUTO_A, motor: "crm", ativo: false }] } });
    await assertRejects(() => lerCrmDaCasa(ctx(), no("crm", { crm_origem: "cliente", produto_crm_id }), p.banco), ErroHttp);
    assert(!p.chamadas.some((c) => c.nome === "membros_ferramentas_admin"));
  }
});

Deno.test("casa: biblioteca usa somente o produto selecionado e escapa todo conteúdo no HTML", async () => {
  const p = porta({ tabelas: {
    membros_produtos: [{ id: PRODUTO_A, titulo: '<script>titulo</script>', descricao: '<img src=x onerror="alert(1)">', estado: "publicado" }, { id: PRODUTO_B, titulo: "Não misturar", estado: "publicado" }],
    membros_modulos: [{ id: "mod1", produto_id: PRODUTO_A, titulo: "Módulo <A>" }, { id: "mod2", produto_id: PRODUTO_B, titulo: "Outro produto" }],
    membros_materiais: [{ id: "m1", produto_id: PRODUTO_A, modulo_id: "mod1", titulo: '<svg onload="alert(2)">', tipo: '<a href="javascript:x">' }, { id: "m2", produto_id: PRODUTO_A, modulo_id: null, titulo: "Material & apoio", tipo: "pdf" }, { id: "m3", produto_id: PRODUTO_B, modulo_id: "mod2", titulo: "Não misturar", tipo: "video" }],
  } });
  const r = await lerMembrosDaCasa(ctx(), no("area_membros", { plataforma: "painel", produto_membros_id: PRODUTO_A }), p.banco);
  assertEquals(r!.json.produto_id, PRODUTO_A);
  assertEquals((r!.json.modulos as unknown[]).length, 1);
  assertEquals((r!.json.materiais as unknown[]).length, 2);
  assert(!r!.html.includes("<script>") && !r!.html.includes("<img src=x") && !r!.html.includes("<svg onload"));
  assert(r!.html.includes("&lt;script&gt;") && r!.html.includes("Material &amp; apoio"));
  assert(!r!.html.includes("Não misturar"));
  assert(r!.html.includes(`https://aceleriq.online/membros?produto=${PRODUTO_A}`));
  assert(p.chamadas.every((c) => ["membros_admin", "membros_produtos", "membros_modulos", "membros_materiais"].includes(c.nome)));
  for (const c of p.chamadas.filter((c) => c.nome === "membros_modulos" || c.nome === "membros_materiais")) assert(c.filtros!.some(([op, chave, valor]) => op === "eq" && chave === "produto_id" && valor === PRODUTO_A));
});

Deno.test("casa: estágios sem valor e chave __proto__ continuam agregados seguros", () => {
  const r = resumoDasEtapas([{ estagio: "__proto__" }, { estagio: "Novo" }, { estagio: "" }, { estagio: null }], "estagio");
  assertEquals(r.__proto__, 1);
  assertEquals(r["Sem etapa"], 2);
  assertEquals(Object.getPrototypeOf(r), null);
});

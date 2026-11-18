/**
 * Ensaio do webhook da Meta com banco falso e rede falsa (14/11/2026): o caminho inteiro de
 * produto-meta/index.ts, sem Supabase e sem chamar a Meta.
 *
 *   deno test supabase/functions/produto-meta/ensaio_test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { atender, type Dependencias } from "./index.ts";
import { assinarCorpo } from "../_shared/meta-leads-do-crm.ts";
import type { Contexto, LeadCriado } from "./modulos/tipos.ts";

const CHAVE = "0123456789abcdef0123456789abcdef";
const SEGREDO = "segredo-do-app-0123456789abcdef";
const TOKEN = "EAAB" + "t".repeat(60);
const PAGINA = "111222333444";
const FORMULARIO = "555666777888";
const BASE = "https://exemplo.supabase.co/functions/v1/produto-meta";

interface Registro {
  id: string;
  leadgen_id: string;
  situacao: string;
  lead_id: string | null;
  criado_em: string;
  erro: string | null;
  de_teste: boolean;
  dados: Record<string, unknown> | null;
}

function montar(mudancas: Record<string, unknown> = {}, opcoes: { gestor?: boolean; graph?: (url: string) => Response | null } = {}) {
  const integracao: Record<string, unknown> = {
    conta_id: "conta-1", ativo: true, modo: "real", verify_token: "verificacao-123", liberada: true, empresa: "Consórcio Exemplo", nicho: "consorcio",
    pagina_id: PAGINA, formularios: [], app_secret: SEGREDO, token: TOKEN, wa_phone_id: null, wa_waba_id: null, wa_numero: null, wa_token: TOKEN,
    templates: {}, idioma: "pt_BR", pontuacao: {}, followup_horas: [24, 72],
    ...mudancas,
  };
  const registros: Registro[] = [];
  const rpcs: string[] = [];
  const criacoes: Array<Record<string, unknown>> = [];
  const errosDaConexao: Array<string | null> = [];
  const chamadas: Array<{ url: string; autorizacao: string }> = [];
  const entregues: Array<{ ctx: Contexto; lead: LeadCriado }> = [];
  const whatsapp: unknown[][] = [];
  const agora = new Date("2026-11-14T15:00:00.000Z");

  const rpc = (nome: string, args: Record<string, unknown> = {}) => {
    rpcs.push(nome);
    if (nome === "crm_integracao_por_chave") return Promise.resolve({ data: args._chave === CHAVE ? integracao : null, error: null });
    if (nome === "crm_meta_lead_registrar") {
      const ja = registros.filter((r) => r.leadgen_id === args._leadgen_id)[0];
      if (ja) return Promise.resolve({ data: { novo: false, id: ja.id }, error: null });
      const novo: Registro = { id: `registro-${registros.length + 1}`, leadgen_id: String(args._leadgen_id), situacao: "recebido", lead_id: null, criado_em: agora.toISOString(), erro: null, de_teste: args._de_teste === true, dados: null };
      registros.push(novo);
      return Promise.resolve({ data: { novo: true, id: novo.id }, error: null });
    }
    if (nome === "crm_meta_lead_falhou") {
      const r = registros.filter((x) => x.id === args._registro)[0];
      if (r) {
        r.situacao = String(args._situacao);
        r.erro = String(args._erro);
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (nome === "crm_meta_lead_criar") {
      const r = registros.filter((x) => x.id === args._registro)[0];
      const dados = args._dados as Record<string, unknown>;
      criacoes.push(dados);
      r.lead_id = `lead-${criacoes.length}`;
      r.situacao = "criado";
      r.dados = dados;
      const frio = dados.faixa === "frio";
      return Promise.resolve({
        data: { lead_id: r.lead_id, repetido: false, faixa: dados.faixa, nota: dados.nota, owner_id: frio ? null : "vendedor-1", na_fila: false, nutricao: frio, vendedor: frio ? null : { user_id: "vendedor-1", nome: "Ana", whatsapp: "5547988887777" } },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: { message: "rpc desconhecida" } });
  };

  // O pouco de `from(...)` que a função usa: ler a situação de um registro e anotar o último erro da conexão.
  const from = (tabela: string) => {
    const consulta: Record<string, unknown> = {};
    let alvo = "";
    const elo = {
      select: () => elo,
      update: (v: Record<string, unknown>) => {
        if (tabela === "crm_integracoes") errosDaConexao.push(v.ultimo_erro as string | null);
        return elo;
      },
      eq: (_coluna: string, valor: string) => {
        alvo = valor;
        return elo;
      },
      like: () => elo,
      maybeSingle: () => {
        const r = registros.filter((x) => x.id === alvo)[0];
        return Promise.resolve({ data: r ? { situacao: r.situacao, lead_id: r.lead_id, criado_em: r.criado_em } : null, error: null });
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: consulta, error: null }).then(ok),
    };
    return elo;
  };

  const leadDaGraph = (id: string) => ({
    id, created_time: "2026-11-14T14:59:00+0000", ad_id: "120210000000001", ad_name: "Anúncio carta imóvel", adset_id: "120210000000002",
    campaign_id: "120210000000003", campaign_name: "Campanha imóvel", form_id: FORMULARIO, platform: "ig",
    field_data: [
      { name: "full_name", values: ["Maria Souza"] },
      { name: "phone_number", values: ["+5547999991111"] },
      { name: "email", values: ["maria@exemplo.com"] },
      { name: "qual_bem_você_quer?", values: ["Imóvel"] },
      { name: "valor_da_carta", values: ["R$ 200 a 300 mil"] },
      { name: "parcela_que_cabe_no_bolso", values: ["R$ 1.800"] },
      { name: "em_quanto_tempo_pretende_usar?", values: ["De 3 a 12 meses"] },
      { name: "tem_valor_para_lance_ou_entrada?", values: ["Sim"] },
    ],
  });

  const buscar = ((entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    chamadas.push({ url, autorizacao: String((init?.headers as Record<string, string> | undefined)?.Authorization || "") });
    const proprio = opcoes.graph ? opcoes.graph(url) : null;
    if (proprio) return Promise.resolve(proprio);
    if (url.indexOf(`/${FORMULARIO}?fields=name`) >= 0) return Promise.resolve(Response.json({ name: "Formulário carta de imóvel", id: FORMULARIO }));
    const id = (url.split("?")[0].split("/").pop() || "").trim();
    return Promise.resolve(Response.json(leadDaGraph(id)));
  }) as typeof fetch;

  const pessoa = {
    rpc: (nome: string) => {
      rpcs.push(`pessoa:${nome}`);
      if (opcoes.gestor === false) return Promise.resolve({ data: null, error: { code: "42501", message: "Só o gerente ou quem administra a empresa vê as integrações." } });
      return Promise.resolve({ data: { existe: true, webhook_chave: CHAVE, ativo: integracao.ativo, modo: integracao.modo }, error: null });
    },
  };

  const d: Dependencias = {
    servico: { rpc, from } as unknown as SupabaseClient,
    comoPessoa: () => pessoa as unknown as SupabaseClient,
    buscar,
    agora: () => agora,
    versaoDaGraph: "v26.0",
    whats: {
      aoCriarLead: (ctx, lead) => {
        entregues.push({ ctx, lead });
        return Promise.resolve();
      },
      tratarWhatsapp: (_ctx, entradas) => {
        whatsapp.push(entradas);
        return Promise.resolve();
      },
    },
    depois: (trabalho) => trabalho.then(() => undefined),
  };
  return { d, integracao, registros, rpcs, criacoes, chamadas, entregues, whatsapp, errosDaConexao };
}

const corpoDeLead = (leadgen: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ object: "page", entry: [{ id: PAGINA, time: 1763132400, changes: [{ field: "leadgen", value: { leadgen_id: leadgen, page_id: PAGINA, form_id: FORMULARIO, adgroup_id: "120210000000002", ad_id: "120210000000001", created_time: 1763132340, ...extra } }] }] });

async function entregar(d: Dependencias, corpo: string, assinatura?: string | null, chave = CHAVE): Promise<Response> {
  const cabecalhos: Record<string, string> = { "Content-Type": "application/json" };
  const valor = assinatura === undefined ? await assinarCorpo(corpo, SEGREDO) : assinatura;
  if (valor) cabecalhos["X-Hub-Signature-256"] = valor;
  return atender(new Request(`${BASE}/${chave}`, { method: "POST", headers: cabecalhos, body: corpo }), d);
}

const daGraphDoLead = (chamadas: Array<{ url: string; autorizacao: string }>, leadgen: string) => chamadas.filter((c) => c.url.indexOf(`/${leadgen}?`) >= 0);

Deno.test("GET: a conferência da Meta devolve o desafio só com o verify_token da empresa", async () => {
  const { d } = montar({ ativo: false });
  const certo = await atender(new Request(`${BASE}/${CHAVE}?hub.mode=subscribe&hub.verify_token=verificacao-123&hub.challenge=1158201444`), d);
  assertEquals(certo.status, 200);
  assertEquals(await certo.text(), "1158201444");
  const errado = await atender(new Request(`${BASE}/${CHAVE}?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=1158201444`), d);
  assertEquals(errado.status, 403);
  assert((await errado.text()).indexOf("1158201444") < 0);
  const semChave = await atender(new Request(`${BASE}/${"f".repeat(32)}?hub.mode=subscribe&hub.verify_token=verificacao-123&hub.challenge=1`), d);
  assertEquals(semChave.status, 404);
  const malformada = await atender(new Request(`${BASE}/abc?hub.mode=subscribe&hub.verify_token=verificacao-123&hub.challenge=1`), d);
  assertEquals(malformada.status, 404);
});

Deno.test("POST com assinatura errada, ausente ou empresa sem segredo: 401 e nada acontece", async () => {
  const m = montar();
  const corpo = corpoDeLead("1234567890123456");
  for (const assinatura of [await assinarCorpo(corpo, "outro-segredo-de-app-000000000"), await assinarCorpo(corpo + " ", SEGREDO), "sha256=abc", null]) {
    const r = await entregar(m.d, corpo, assinatura);
    assertEquals(r.status, 401);
    assertEquals(await r.json(), { error: "assinatura" });
  }
  assertEquals(m.registros.length, 0);
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.rpcs.filter((n) => n !== "crm_integracao_por_chave"), []);

  const semSegredo = montar({ app_secret: null });
  assertEquals((await entregar(semSegredo.d, corpo)).status, 401);
  assertEquals(semSegredo.registros.length, 0);
});

Deno.test("POST certo no modo real: busca o lead, pontua, cria o negócio e entrega ao WhatsApp", async () => {
  const m = montar();
  const r = await entregar(m.d, corpoDeLead("1234567890123456"));
  assertEquals(r.status, 200);
  const resposta = await r.text();
  assertEquals(JSON.parse(resposta), { ok: true, leads: 1, criados: 1, repetidos: 0, ignorados: 0, erros: 0, whatsapp: 0 });

  // A leitura na Graph API: uma chamada, com os campos pedidos, o token só no cabeçalho.
  const leituras = daGraphDoLead(m.chamadas, "1234567890123456");
  assertEquals(leituras.length, 1);
  assert(leituras[0].url.indexOf("https://graph.facebook.com/v26.0/1234567890123456?fields=") === 0);
  assert(leituras[0].url.indexOf("field_data") > 0 && leituras[0].url.indexOf("campaign_name") > 0);
  assertEquals(leituras[0].autorizacao, `Bearer ${TOKEN}`);
  for (const c of m.chamadas) assert(c.url.indexOf(TOKEN) < 0 && c.url.indexOf("access_token") < 0, "token fora do endereço");

  // O negócio: contato, respostas normalizadas, nota das regras do consórcio e a origem.
  assertEquals(m.criacoes.length, 1);
  const dados = m.criacoes[0] as Record<string, any>;
  assertEquals(dados.nome, "Maria Souza");
  assertEquals(dados.whatsapp, "5547999991111");
  assertEquals(dados.email, "maria@exemplo.com");
  assertEquals(dados.bem, "imovel");
  assertEquals(dados.respostas, { bem: "imovel", valor_carta: 250000, parcela: 1800, prazo: "de_3_a_12_meses", lance: "sim" });
  assertEquals(dados.campos, { tipo_de_bem: "imovel", prazo_meses: 8 });
  assertEquals(dados.valor_avulso, 250000);
  assertEquals(dados.valor_mensal, 1800);
  assertEquals(dados.nota, 91);
  assertEquals(dados.faixa, "quente");
  assertEquals(dados.origem, { form_id: FORMULARIO, form_name: "Formulário carta de imóvel", ad_id: "120210000000001", ad_name: "Anúncio carta imóvel", adset_id: "120210000000002", campaign_id: "120210000000003", campaign_name: "Campanha imóvel", plataforma: "instagram" });
  assertEquals(m.registros[0].situacao, "criado");
  assertEquals(m.registros[0].de_teste, false);

  // O módulo do WhatsApp recebe o lead uma vez, com o vendedor do rodízio.
  assertEquals(m.entregues.length, 1);
  assertEquals(m.entregues[0].lead, {
    lead_id: "lead-1", nome: "Maria Souza", whatsapp: "5547999991111", faixa: "quente", nota: 91, motivos: dados.motivos,
    respostas: dados.respostas, repetido: false, na_fila: false, nutricao: false,
    vendedor: { user_id: "vendedor-1", nome: "Ana", whatsapp: "5547988887777" }, origem: { campanha: "Campanha imóvel", formulario: "Formulário carta de imóvel" },
  });
  assertEquals(m.entregues[0].ctx.integracao.modo, "real");

  // Nada de token ou segredo na resposta nem no que foi gravado.
  assert(resposta.indexOf(TOKEN) < 0 && resposta.indexOf(SEGREDO) < 0);
  assert(JSON.stringify(m.criacoes).indexOf(TOKEN) < 0 && JSON.stringify(m.registros).indexOf(TOKEN) < 0);
});

Deno.test("POST repetido: a Meta reenviou o mesmo aviso e nada se repete", async () => {
  const m = montar();
  const corpo = corpoDeLead("1234567890123457");
  assertEquals((await entregar(m.d, corpo)).status, 200);
  const de_novo = await entregar(m.d, corpo);
  assertEquals(de_novo.status, 200);
  assertEquals(await de_novo.json(), { ok: true, leads: 1, criados: 0, repetidos: 1, ignorados: 0, erros: 0, whatsapp: 0 });
  assertEquals(m.registros.length, 1);
  assertEquals(m.criacoes.length, 1);
  assertEquals(m.entregues.length, 1);
  assertEquals(daGraphDoLead(m.chamadas, "1234567890123457").length, 1);
});

Deno.test("modo teste: o aviso fica registrado e a rede não é chamada", async () => {
  const m = montar({ modo: "teste" });
  const r = await entregar(m.d, corpoDeLead("1234567890123458"));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: true, leads: 1, criados: 0, repetidos: 0, ignorados: 1, erros: 0, whatsapp: 0 });
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.criacoes.length, 0);
  assertEquals(m.entregues.length, 0);
  assertEquals(m.registros.length, 1);
  assertEquals(m.registros[0].situacao, "ignorado");
  assert(String(m.registros[0].erro).indexOf("Modo teste") === 0);
  // A assinatura continua valendo no modo teste.
  assertEquals((await entregar(m.d, corpoDeLead("1234567890123459"), "sha256=" + "0".repeat(64))).status, 401);
});

Deno.test("desligado: responde 200 e não faz nada, com ou sem assinatura", async () => {
  for (const mudanca of [{ ativo: false }, { liberada: false }]) {
    const m = montar(mudanca);
    for (const assinatura of [undefined, null]) {
      const r = await entregar(m.d, corpoDeLead("1234567890123460"), assinatura);
      assertEquals(r.status, 200);
      assertEquals(await r.json(), { ok: true, desligado: true });
    }
    assertEquals(m.registros.length, 0);
    assertEquals(m.chamadas.length, 0);
    assertEquals(m.entregues.length, 0);
    assertEquals(m.rpcs.filter((n) => n !== "crm_integracao_por_chave"), []);
  }
});

Deno.test("chave de ninguém, corpo que não é JSON e método errado", async () => {
  const m = montar();
  const corpo = corpoDeLead("1234567890123461");
  assertEquals((await entregar(m.d, corpo, undefined, "f".repeat(32))).status, 404);
  assertEquals((await entregar(m.d, "isto não é json")).status, 400);
  assertEquals((await atender(new Request(`${BASE}/${CHAVE}`, { method: "DELETE" }), m.d)).status, 405);
  assertEquals((await atender(new Request(`${BASE}/${CHAVE}/mais/coisa`, { method: "POST", body: corpo }), m.d)).status, 404);
  assertEquals(m.registros.length, 0);
});

Deno.test("lead de outra Página ou de formulário fora da lista: registrado como ignorado, sem buscar na Meta", async () => {
  const outraPagina = montar({ pagina_id: "999888777666" });
  const r1 = await entregar(outraPagina.d, corpoDeLead("1234567890123462"));
  assertEquals((await r1.json()).ignorados, 1);
  assertEquals(outraPagina.chamadas.length, 0);
  assertEquals(outraPagina.registros[0].situacao, "ignorado");

  const outroFormulario = montar({ formularios: ["4242424242"] });
  const r2 = await entregar(outroFormulario.d, corpoDeLead("1234567890123463"));
  assertEquals((await r2.json()).ignorados, 1);
  assertEquals(outroFormulario.chamadas.length, 0);

  const naLista = montar({ formularios: [FORMULARIO] });
  assertEquals((await (await entregar(naLista.d, corpoDeLead("1234567890123464"))).json()).criados, 1);
});

Deno.test("Meta fora do ar: 503 para ela reenviar, e o reenvio cria o negócio", async () => {
  let fora = true;
  const m = montar({}, { graph: (url) => (fora && url.indexOf("/1234567890123465?") >= 0 ? Response.json({ error: { message: "Service temporarily unavailable", code: 2, is_transient: true } }, { status: 503 }) : null) });
  const corpo = corpoDeLead("1234567890123465");
  const primeira = await entregar(m.d, corpo);
  assertEquals(primeira.status, 503);
  assertEquals((await primeira.json()).de_novo, 1);
  assertEquals(m.registros[0].situacao, "erro");
  assertEquals(m.criacoes.length, 0);
  assert(String(m.errosDaConexao[0]).indexOf("Lead da Meta:") === 0);

  fora = false;
  const segunda = await entregar(m.d, corpo);
  assertEquals(segunda.status, 200);
  assertEquals((await segunda.json()).criados, 1);
  assertEquals(m.registros.length, 1);
  assertEquals(m.registros[0].situacao, "criado");
  assertEquals(m.entregues.length, 1);
});

Deno.test("token recusado: erro que precisa de gente, 200 para a Meta e mensagem sem o token", async () => {
  const m = montar({}, { graph: (url) => (url.indexOf("/1234567890123466?") >= 0 ? Response.json({ error: { message: `Error validating access token ${TOKEN}`, type: "OAuthException", code: 190 } }, { status: 400 }) : null) });
  const r = await entregar(m.d, corpoDeLead("1234567890123466"));
  assertEquals(r.status, 200);
  assertEquals((await r.json()).erros, 1);
  assertEquals(m.registros[0].situacao, "erro");
  assert(String(m.registros[0].erro).indexOf("token da Página") > 0);
  assert(JSON.stringify(m.registros).indexOf(TOKEN) < 0 && JSON.stringify(m.errosDaConexao).indexOf(TOKEN) < 0);
  assertEquals(m.criacoes.length, 0);
});

Deno.test("campo recusado pela Meta: a leitura repete só com os campos básicos", async () => {
  const m = montar({}, { graph: (url) => (url.indexOf("/1234567890123467?") >= 0 && url.indexOf("campaign_name") > 0 ? Response.json({ error: { message: "(#100) Tried accessing nonexisting field (campaign_name) on node type (Lead)", code: 100 } }, { status: 400 }) : null) });
  const r = await entregar(m.d, corpoDeLead("1234567890123467"));
  assertEquals((await r.json()).criados, 1);
  const leituras = daGraphDoLead(m.chamadas, "1234567890123467");
  assertEquals(leituras.length, 2);
  assert(leituras[1].url.endsWith("?fields=id,created_time,ad_id,form_id,field_data"));
});

Deno.test("entradas de WhatsApp do mesmo endereço vão para o módulo do WhatsApp", async () => {
  const m = montar();
  const entrada = { id: "999000111222", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages: [{ id: "wamid.A", from: "5547999991111", type: "text", text: { body: "Tenho interesse" } }] } }] };
  const r = await entregar(m.d, JSON.stringify({ object: "whatsapp_business_account", entry: [entrada] }));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: true, leads: 0, criados: 0, repetidos: 0, ignorados: 0, erros: 0, whatsapp: 1 });
  assertEquals(m.whatsapp, [[entrada]]);
  assertEquals(m.registros.length, 0);
  // Sem assinatura, a mensagem não chega ao módulo.
  const sem = montar();
  assertEquals((await entregar(sem.d, JSON.stringify({ object: "whatsapp_business_account", entry: [entrada] }), null)).status, 401);
  assertEquals(sem.whatsapp.length, 0);
});

Deno.test("simular: só gestor, lead de teste pelo caminho inteiro, sem rede e sempre em modo teste", async () => {
  const m = montar({ modo: "real" });
  const pedir = (d: Dependencias, corpo: unknown, jwt: string | null = "jwt-da-pessoa") =>
    atender(new Request(`${BASE}/simular`, { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(corpo) }), d);

  const r = await pedir(m.d, { faixa: "morno", bem: "moto" });
  assertEquals(r.status, 201);
  const lido = await r.json();
  assertEquals(lido.ok, true);
  assertEquals(lido.resultado.faixa, "morno");
  assertEquals(lido.resultado.vendedor, { user_id: "vendedor-1", nome: "Ana", whatsapp: "5547988887777" });
  assertEquals(lido.resultado.na_fila, false);
  assertEquals(lido.resultado.nutricao, false);
  assert(String(lido.resultado.nome).indexOf("Teste ") === 0);
  assertEquals(m.chamadas.length, 0);
  assertEquals(m.registros.length, 1);
  assertEquals(m.registros[0].de_teste, true);
  assert(m.registros[0].leadgen_id.indexOf("teste_") === 0);
  assertEquals((m.criacoes[0] as Record<string, any>).bem, "moto");
  // Mesmo com a empresa em modo real, o módulo do WhatsApp recebe a conexão em modo teste.
  assertEquals(m.entregues.length, 1);
  assertEquals(m.entregues[0].ctx.integracao.modo, "teste");
  assertEquals(m.integracao.modo, "real");

  const frio = await (await pedir(m.d, { faixa: "frio" })).json();
  assertEquals(frio.resultado.faixa, "frio");
  assertEquals(frio.resultado.nutricao, true);
  assertEquals(frio.resultado.vendedor, null);

  assertEquals((await pedir(m.d, {}, null)).status, 401);
  const semPermissao = montar({}, { gestor: false });
  const negado = await pedir(semPermissao.d, {});
  assertEquals(negado.status, 403);
  assertEquals((await negado.json()).error, "sem_permissao");
  assertEquals(semPermissao.registros.length, 0);
  assertEquals((await atender(new Request(`${BASE}/simular`, { method: "GET", headers: { Authorization: "Bearer x" } }), m.d)).status, 405);
});

Deno.test("OPTIONS responde ao pré-voo do navegador (o simulador é chamado pela tela)", async () => {
  const { d } = montar();
  const r = await atender(new Request(`${BASE}/simular`, { method: "OPTIONS" }), d);
  assertEquals(r.status, 200);
  assert(String(r.headers.get("Access-Control-Allow-Headers")).indexOf("authorization") >= 0);
});

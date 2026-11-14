/**
 * Ensaio do robô de WhatsApp do CRM (14/11/2026): banco falso (só as RPCs) e fetch falso.
 * Mostra que em modo teste NADA sai para a Meta e que, em modo real, só sai pela Cloud API,
 * com o token no cabeçalho e fora de qualquer registro.
 *
 *   deno test --no-check=remote supabase/functions/produto-meta-rotina/ensaio_test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Contexto, Integracao, LeadCriado } from "../produto-meta/modulos/tipos.ts";
import { aoCriarLead, tratarWhatsapp, type Banco } from "../produto-meta/modulos/whatsapp.ts";
import { rodar } from "./index.ts";

const CONTA = "aaaaaaaa-0000-4000-8000-000000000001";
const LEAD = "11111111-2222-4333-8444-555555555555";
const OUTRO = "22222222-2222-4333-8444-555555555555";
const TOKEN = "EAAGtokenSecretoDoEnsaio0123456789abcdef";
const FONE_DO_LEAD = "5541988887777";
const FONE_DO_VENDEDOR = "5541999990001";

interface Envio { id: string; conta_id: string; lead_id: string | null; para: string; destino: string; corpo: Record<string, unknown>; chave: string; situacao: string; tentativas: number; erro: string | null; reservado: boolean }

/** Um banco de mentira que responde às RPCs da migration 20261114110000 (e às duas da 20261114100000 que o robô usa). */
function bancoFalso(integracao: Integracao) {
  const nucleo = (t: string) => t.replace(/\D/g, "").slice(-8);
  const leads: Record<string, Record<string, unknown>> = {};
  const conversas: Record<string, Record<string, unknown>> = {};
  const envios: Envio[] = [];
  const recebidas = new Set<string>();
  const mensagens: Array<{ lead_id: string; direcao: string; texto: string }> = [];
  const parou = new Set<string>();
  const chamadas: string[] = [];
  const avancos: Array<Record<string, unknown>> = [];
  let filaParaDistribuir: Array<{ lead_id: string; conta_id: string }> = [];
  let vendedorNaJanela = false;
  const vendedor = { user_id: "v1", nome: "Vic Souza", whatsapp: FONE_DO_VENDEDOR };

  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {
    crm_integracao_da_conta: () => integracao,
    crm_whats_contexto: (a) => {
      const l = leads[String(a._lead)];
      if (!l) return null;
      return { lead: l, vendedor: l.owner_id ? { ...vendedor, na_janela: vendedorNaJanela } : null, conversa: conversas[String(a._lead)] || null, parou: parou.has(nucleo(String(l.telefone))) };
    },
    crm_whats_conversa_salvar: (a) => {
      conversas[String(a._lead)] = JSON.parse(JSON.stringify({ ...(a._estado as Record<string, unknown>), telefone: a._telefone }));
      return null;
    },
    crm_whats_enfileirar: (a) => {
      if (a._destino === "lead" && parou.has(nucleo(String(a._para)))) return { novo: false, bloqueado: true };
      if (envios.some((e) => e.chave === a._chave)) return { novo: false, id: null };
      const id = `e${envios.length + 1}`;
      envios.push({ id, conta_id: String(a._conta), lead_id: (a._lead as string) || null, para: String(a._para), destino: String(a._destino), corpo: a._corpo as Record<string, unknown>, chave: String(a._chave), situacao: "pendente", tentativas: 0, erro: null, reservado: false });
      return { novo: true, id };
    },
    crm_whats_envios_pegar: (a) => {
      const pegos = envios.filter((e) => e.situacao === "pendente" && !e.reservado && (!a._conta || e.conta_id === a._conta));
      pegos.forEach((e) => (e.reservado = true));
      return pegos.map((e) => {
        const c = e.lead_id ? conversas[e.lead_id] : null;
        const naJanela = e.destino === "lead" ? !!c && typeof c.janela_ate === "string" && new Date(c.janela_ate).getTime() > Date.now() : vendedorNaJanela;
        return { id: e.id, conta_id: e.conta_id, lead_id: e.lead_id, para: e.para, destino: e.destino, corpo: e.corpo, chave: e.chave, tentativas: e.tentativas, na_janela: naJanela };
      });
    },
    crm_whats_envio_resultado: (a) => {
      const e = envios.filter((x) => x.id === a._id)[0];
      if (!e || e.situacao !== "pendente") return null;
      e.tentativas += 1;
      e.erro = (a._erro as string) || null;
      if (a._situacao === "de_novo") e.reservado = false;
      else e.situacao = String(a._situacao);
      if ((a._situacao === "enviado" || a._situacao === "simulado") && e.destino === "lead" && e.lead_id) {
        mensagens.push({ lead_id: e.lead_id, direcao: "saida", texto: `${a._situacao === "simulado" ? "[Simulado, não saiu] " : ""}${e.corpo._texto}` });
      }
      return null;
    },
    crm_whats_entrada: (a) => {
      const id = String(a._wa_message_id);
      if (recebidas.has(id)) return { nova: false };
      recebidas.add(id);
      const de = nucleo(String(a._telefone));
      const eVendedor = de === nucleo(FONE_DO_VENDEDOR);
      if (eVendedor) vendedorNaJanela = true;
      const leadId = Object.keys(conversas).filter((k) => nucleo(String(conversas[k].telefone)) === de)[0] || null;
      if (leadId && a._texto) mensagens.push({ lead_id: leadId, direcao: "entrada", texto: String(a._texto) });
      return { nova: true, vendedor: eVendedor ? { user_id: vendedor.user_id, nome: vendedor.nome } : null, lead_id: leadId, parou: parou.has(de) };
    },
    crm_whats_entrada_desfazer: (a) => {
      recebidas.delete(String(a._wa_message_id));
      return null;
    },
    crm_whats_status_falhou: () => null,
    crm_whats_parar: (a) => {
      parou.add(nucleo(String(a._telefone)));
      envios.filter((e) => e.destino === "lead" && e.situacao === "pendente").forEach((e) => (e.situacao = "erro"));
      if (a._confirmacao) envios.push({ id: `e${envios.length + 1}`, conta_id: String(a._conta), lead_id: String(a._lead), para: String(a._telefone), destino: "lead", corpo: a._confirmacao as Record<string, unknown>, chave: `lead:${a._lead}:parou`, situacao: "pendente", tentativas: 0, erro: null, reservado: false });
      return null;
    },
    crm_whats_followups_pegar: () => [],
    crm_fila_distribuir: () => {
      const saida = filaParaDistribuir;
      filaParaDistribuir = [];
      saida.forEach((d) => (leads[d.lead_id].owner_id = vendedor.user_id));
      return saida;
    },
    crm_lead_requalificar: (a) => {
      const l = leads[String(a._lead)];
      l.nota = a._nota;
      l.faixa = a._faixa;
      return { lead_id: a._lead, faixa: a._faixa, owner_id: l.owner_id, na_fila: !l.owner_id, vendedor: l.owner_id ? vendedor : null };
    },
    crm_lead_avancar: (a) => {
      avancos.push(a);
      return { ok: true, etapa: "contato" };
    },
  };

  const db: Banco = {
    rpc(nome, argumentos = {}) {
      chamadas.push(nome);
      const f = rpcs[nome];
      if (!f) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `sem a função ${nome}` } });
      return Promise.resolve({ data: JSON.parse(JSON.stringify(f(argumentos) ?? null)), error: null });
    },
  };
  const novoLead = (id: string, telefone: string, comVendedor: boolean) => {
    leads[id] = { id, conta_id: CONTA, nome: "João da Carta", telefone, nota: 76, faixa: "quente", etapa: "novo", owner_id: comVendedor ? vendedor.user_id : null, na_fila: !comVendedor, nutricao: false, valor_mensal: 1800, valor_avulso: 300000, campanha: "HS Imóvel Nov", formulario: "Consórcio imóvel", arquivado: false };
  };
  return { db, leads, conversas, envios, mensagens, chamadas, avancos, novoLead, porNaFila: (leadId: string) => filaParaDistribuir.push({ lead_id: leadId, conta_id: CONTA }) };
}

const integracao = (modo: "teste" | "real", extra: Partial<Integracao> = {}): Integracao => ({
  conta_id: CONTA, ativo: true, modo, verify_token: "v", liberada: true, empresa: "HS Consórcios", nicho: "consorcio", pagina_id: "123456789", formularios: [],
  app_secret: "s", token: TOKEN, wa_phone_id: "555000111", wa_waba_id: null, wa_numero: null, wa_token: TOKEN,
  templates: { lead: "crm_boas_vindas", vendedor: "crm_aviso_vendedor", followup: "crm_retomada", nutricao: "crm_nutricao" }, idioma: "pt_BR", pontuacao: {}, followup_horas: [24, 72], ...extra,
});

const leadCriado = (id: string, telefone: string, comVendedor: boolean): LeadCriado => ({
  lead_id: id, nome: "João da Carta", whatsapp: telefone, faixa: "quente", nota: 76, motivos: [], respostas: { bem: "imovel", valor_carta: 300000, parcela: 1800, prazo: "de_3_a_12_meses" },
  repetido: false, na_fila: !comVendedor, nutricao: false, vendedor: comVendedor ? { user_id: "v1", nome: "Vic Souza", whatsapp: FONE_DO_VENDEDOR } : null, origem: { campanha: "HS Imóvel Nov", formulario: "Consórcio imóvel" },
});

let contador = 0;
const webhook = (de: string, conteudo: Record<string, unknown>) => {
  contador += 1;
  return [{ messaging_product: "whatsapp", metadata: { phone_number_id: "555000111" }, messages: [{ from: de, id: `wamid.${contador}`, timestamp: String(Math.floor(Date.now() / 1000)), ...conteudo }] }];
};
const texto = (de: string, corpo: string) => webhook(de, { type: "text", text: { body: corpo } });
const botao = (de: string, id: string, titulo: string) => webhook(de, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: titulo } } });
const lista = (de: string, id: string, titulo: string) => webhook(de, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: titulo } } });

/** Troca o fetch do mundo por um que conta as chamadas (e nunca fala com a rede de verdade). */
async function comRedeFalsa<T>(resposta: () => Response, trabalho: (chamadas: Array<{ url: string; pedido: RequestInit }>) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const chamadas: Array<{ url: string; pedido: RequestInit }> = [];
  globalThis.fetch = ((url: string | URL | Request, pedido?: RequestInit) => {
    chamadas.push({ url: String(url), pedido: pedido || {} });
    return Promise.resolve(resposta());
  }) as typeof fetch;
  try {
    return await trabalho(chamadas);
  } finally {
    globalThis.fetch = original;
  }
}

/** Guarda tudo o que foi para o console durante o trabalho. */
async function ouvindoOConsole<T>(trabalho: () => Promise<T>): Promise<{ valor: T; dito: string }> {
  const originais = { log: console.log, error: console.error, warn: console.warn };
  const dito: string[] = [];
  const guarda = (...partes: unknown[]) => void dito.push(partes.map(String).join(" "));
  console.log = guarda;
  console.error = guarda;
  console.warn = guarda;
  try {
    return { valor: await trabalho(), dito: dito.join("\n") };
  } finally {
    Object.assign(console, originais);
  }
}

Deno.test("modo teste: a conversa inteira acontece, tudo fica simulado e NADA sai para a Meta", async () => {
  const b = bancoFalso(integracao("teste"));
  b.novoLead(LEAD, FONE_DO_LEAD, true);
  const ctx = (): Contexto => ({ servico: b.db as unknown as SupabaseClient, integracao: integracao("teste"), agora: new Date() });

  await comRedeFalsa(() => new Response("{}", { status: 500 }), async (rede) => {
    await aoCriarLead(ctx(), leadCriado(LEAD, FONE_DO_LEAD, true));
    assertEquals(b.envios.map((e) => `${e.chave.replace(LEAD, "L")}=${e.situacao}`), ["lead:L:boas-vindas=simulado"]);
    assertEquals(b.conversas[LEAD].etapa, "inicio");

    await tratarWhatsapp(ctx(), texto(FONE_DO_LEAD, "Pode perguntar"));
    assertEquals(b.conversas[LEAD].etapa, "perguntando");
    assertEquals(b.conversas[LEAD].pergunta, "lance");
    await tratarWhatsapp(ctx(), botao(FONE_DO_LEAD, "r:lance:sim", "Sim"));
    await tratarWhatsapp(ctx(), texto(FONE_DO_LEAD, "ganho uns 5 mil"));
    await tratarWhatsapp(ctx(), lista(FONE_DO_LEAD, "r:capacidade:2000", "R$ 800 a 2 mil"));

    // Requalificou (nota nova) e passou ao vendedor: o lead sabe quem chama, o vendedor recebe o resumo.
    assertEquals(b.leads[LEAD].nota, 91);
    assertEquals(b.conversas[LEAD].etapa, "passado");
    assertEquals(b.envios.map((e) => e.chave.replace(LEAD, "L")), ["lead:L:boas-vindas", "lead:L:p:lance:0", "lead:L:p:renda:0", "lead:L:p:capacidade:0", "lead:L:consultor", "vend:L:aviso"]);
    const aviso = b.envios.filter((e) => e.chave === `vend:${LEAD}:aviso`)[0];
    assertEquals(aviso.para, FONE_DO_VENDEDOR);
    assertEquals(aviso.corpo.type, "template");
    assert(String(aviso.corpo._texto).includes("https://wa.me/5541988887777?text="));

    // O vendedor toca em "Atendi": o negócio anda e ele recebe a confirmação.
    await tratarWhatsapp(ctx(), webhook(FONE_DO_VENDEDOR, { type: "button", button: { payload: `crm:${LEAD}:atendi`, text: "Atendi" } }));
    assertEquals(b.avancos, [{ _lead: LEAD, _acao: "atendi", _telefone: FONE_DO_VENDEDOR }]);
    const confirmacao = b.envios[b.envios.length - 1];
    assertEquals(confirmacao.destino, "vendedor");
    assert(String(confirmacao.corpo._texto).includes("Em contato"));

    // A mesma entrega repetida pela Meta não é tratada duas vezes.
    const antes = b.envios.length;
    const repetida = texto(FONE_DO_LEAD, "oi?");
    await tratarWhatsapp(ctx(), repetida);
    const depois = b.envios.length;
    await tratarWhatsapp(ctx(), repetida);
    assertEquals(b.envios.length, depois);
    assertEquals(depois, antes + 1);

    // A rotina também roda em modo teste sem sair nada.
    const resumo = await rodar(b.db, { agora: new Date() });
    assertEquals(resumo.enviados, 0);

    assertEquals(rede.length, 0, "em modo teste a rede não é chamada nenhuma vez");
    assert(b.envios.length >= 8);
    assert(b.envios.every((e) => e.situacao === "simulado"), "todo envio fica simulado");
    assert(b.mensagens.filter((m) => m.direcao === "saida").every((m) => m.texto.startsWith("[Simulado, não saiu] ")));
    assert(b.mensagens.filter((m) => m.direcao === "entrada").length >= 4, "o que o lead disse entra na conversa do negócio");
  });
});

Deno.test("sem número ou sem token do WhatsApp, mesmo em modo real, nada sai", async () => {
  for (const falta of [{ wa_phone_id: null }, { wa_token: null }] as Array<Partial<Integracao>>) {
    const i = integracao("real", falta);
    const b = bancoFalso(i);
    b.novoLead(LEAD, FONE_DO_LEAD, true);
    await comRedeFalsa(() => new Response("{}", { status: 200 }), async (rede) => {
      await aoCriarLead({ servico: b.db as unknown as SupabaseClient, integracao: i, agora: new Date() }, leadCriado(LEAD, FONE_DO_LEAD, true));
      assertEquals(rede.length, 0);
      assertEquals(b.envios.map((e) => e.situacao), ["simulado"]);
    });
  }
});

Deno.test("modo real: sai só pela Cloud API, com o token no cabeçalho e fora dos registros", async () => {
  const i = integracao("real");
  const b = bancoFalso(i);
  b.novoLead(LEAD, FONE_DO_LEAD, true);
  const ctx: Contexto = { servico: b.db as unknown as SupabaseClient, integracao: i, agora: new Date() };

  const { dito } = await ouvindoOConsole(() =>
    comRedeFalsa(() => new Response(JSON.stringify({ messages: [{ id: "wamid.SAIU" }] }), { status: 200 }), async (rede) => {
      await aoCriarLead(ctx, leadCriado(LEAD, FONE_DO_LEAD, true));
      assertEquals(rede.length, 1);
      assertEquals(rede[0].url, "https://graph.facebook.com/v27.0/555000111/messages");
      assert(!rede[0].url.includes(TOKEN), "o token não vai no endereço");
      assertEquals((rede[0].pedido.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
      const corpo = JSON.parse(String(rede[0].pedido.body));
      assertEquals(corpo.type, "template");
      assertEquals(corpo.to, FONE_DO_LEAD);
      assertEquals(corpo.template.name, "crm_boas_vindas");
      assert(!("_texto" in corpo), "as chaves internas não vão para a Meta");
      assertEquals(b.envios[0].situacao, "enviado");

      // A mesma chamada de novo (o webhook repetiu o lead) não manda outra vez.
      await aoCriarLead(ctx, leadCriado(LEAD, FONE_DO_LEAD, true));
      assertEquals(rede.length, 1);
    }));
  assert(!dito.includes(TOKEN));

  // Token recusado: vira erro, sem o token no erro nem no console.
  const b2 = bancoFalso(i);
  b2.novoLead(OUTRO, "5541977776666", true);
  const { dito: dito2 } = await ouvindoOConsole(() =>
    comRedeFalsa(() => new Response(JSON.stringify({ error: { message: `Invalid OAuth access token ${TOKEN}`, code: 190 } }), { status: 401 }), async (rede) => {
      await aoCriarLead({ ...ctx, servico: b2.db as unknown as SupabaseClient }, leadCriado(OUTRO, "5541977776666", true));
      assertEquals(rede.length, 1);
      assertEquals(b2.envios[0].situacao, "erro");
    }));
  assert(!dito2.includes(TOKEN));
  assert(!JSON.stringify(b2.envios).includes(TOKEN), "o token não é gravado no erro do envio");
  assert(String(b2.envios[0].erro).includes("Token do WhatsApp recusado"));
});

Deno.test("modo real: fora da janela a pergunta com botões não sai, e a rotina avisa o vendedor de quem saiu da fila", async () => {
  const i = integracao("real");
  const b = bancoFalso(i);
  b.novoLead(LEAD, FONE_DO_LEAD, false);
  const ctx: Contexto = { servico: b.db as unknown as SupabaseClient, integracao: i, agora: new Date() };

  await comRedeFalsa(() => new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }), async (rede) => {
    await aoCriarLead(ctx, leadCriado(LEAD, FONE_DO_LEAD, false));
    await tratarWhatsapp(ctx, texto(FONE_DO_LEAD, "pode"));
    await tratarWhatsapp(ctx, botao(FONE_DO_LEAD, "r:lance:nao", "Não"));
    await tratarWhatsapp(ctx, lista(FONE_DO_LEAD, "r:renda:6000", "R$ 3 mil a 6 mil"));
    await tratarWhatsapp(ctx, lista(FONE_DO_LEAD, "r:capacidade:800", "R$ 300 a 800"));
    // Na fila: o lead foi avisado de que um consultor vai chamar; nenhum vendedor ainda.
    assertEquals(b.conversas[LEAD].etapa, "qualificado");
    assert(b.envios.some((e) => e.chave === `lead:${LEAD}:aguarde` && e.situacao === "enviado"));
    assert(!b.envios.some((e) => e.destino === "vendedor"));
    const antes = rede.length;

    // Alguém entrou no expediente: a rotina distribui e avisa o vendedor (template, ele está fora da janela).
    b.porNaFila(LEAD);
    const resumo = await rodar(b.db, { agora: new Date() });
    assertEquals(resumo.distribuidos, 1);
    assertEquals(b.conversas[LEAD].etapa, "passado");
    const aviso = b.envios.filter((e) => e.chave === `vend:${LEAD}:aviso`)[0];
    assertEquals(aviso.situacao, "enviado");
    const pedidos = rede.slice(antes).map((c) => JSON.parse(String(c.pedido.body)));
    const aoVendedor = pedidos.filter((p) => p.to === FONE_DO_VENDEDOR)[0];
    assertEquals(aoVendedor.type, "template");
    assertEquals(aoVendedor.template.components.length, 5);

    // A janela do lead fechou antes de um envio que não é template: ele não sai.
    b.conversas[LEAD].janela_ate = new Date(Date.now() - 60000).toISOString();
    await b.db.rpc("crm_whats_enfileirar", { _conta: CONTA, _lead: LEAD, _para: FONE_DO_LEAD, _destino: "lead", _corpo: { messaging_product: "whatsapp", to: FONE_DO_LEAD, type: "text", text: { body: "atrasada" }, _texto: "atrasada" }, _chave: "lead:atrasada" });
    const chamadasAntes = rede.length;
    await rodar(b.db, { agora: new Date() });
    assertEquals(rede.length, chamadasAntes);
    const atrasada = b.envios.filter((e) => e.chave === "lead:atrasada")[0];
    assertEquals(atrasada.situacao, "erro");
    assert(String(atrasada.erro).includes("janela de 24 h"));
  });
});

Deno.test("pedido de parar: encerra e nada mais é enfileirado para o lead", async () => {
  const i = integracao("teste");
  const b = bancoFalso(i);
  b.novoLead(LEAD, FONE_DO_LEAD, true);
  const ctx: Contexto = { servico: b.db as unknown as SupabaseClient, integracao: i, agora: new Date() };
  await comRedeFalsa(() => new Response("{}", { status: 200 }), async (rede) => {
    await aoCriarLead(ctx, leadCriado(LEAD, FONE_DO_LEAD, true));
    await tratarWhatsapp(ctx, texto(FONE_DO_LEAD, "PARAR"));
    assert(b.chamadas.includes("crm_whats_parar"));
    assertEquals(b.conversas[LEAD].etapa, "encerrado");
    const quantos = b.envios.length;
    await tratarWhatsapp(ctx, texto(FONE_DO_LEAD, "oi"));
    assertEquals(b.envios.length, quantos);
    assertEquals(rede.length, 0);
  });
});

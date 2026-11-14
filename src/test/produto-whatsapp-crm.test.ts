// Robô de WhatsApp do CRM da empresa (rodada 3, 14/11/2026): corpos da Cloud API, leitura do webhook,
// máquina de estados da conversa, aviso ao vendedor e modo teste.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REGRAS_DO_CONSORCIO } from "../../supabase/functions/_shared/pontuacao-do-crm";
import {
  casarTextoLivre,
  confirmacaoAoVendedor,
  corpoDeBotoes,
  corpoDeLista,
  corpoDeTemplate,
  corpoDeTexto,
  corpoInterativo,
  corpoParaAMeta,
  dinheiroCurto,
  enderecoDasMensagens,
  envioAoVendedor,
  estadoInicial,
  lerBotaoDoVendedor,
  lerEntradas,
  lerRespostaDoWhatsapp,
  lerValor,
  linkDoWhatsapp,
  montarPergunta,
  naJanela,
  pediuParaParar,
  perguntasDoRobo,
  proximoPasso,
  resumoParaOVendedor,
  semToken,
  telefoneParaEnvio,
  templatesNecessarios,
  VERSAO_DA_GRAPH_DO_WHATSAPP,
  type ConfigDoRobo,
  type CorpoDaMeta,
  type EstadoDaConversa,
  type Evento,
  type Passo,
} from "../../supabase/functions/_shared/whatsapp-do-crm";
import { enviarUm, type EnvioDaFila } from "../../supabase/functions/produto-meta/modulos/whatsapp";

const LEAD = "11111111-2222-3333-4444-555555555555";
const T0 = Date.parse("2026-11-16T12:00:00.000Z");
const em = (horas: number) => new Date(T0 + horas * 3600000).toISOString();
const regras = REGRAS_DO_CONSORCIO;
const VIC = { nome: "Vic Souza", whatsapp: "5541999990001" };
const RESPOSTAS_DO_FORMULARIO = { bem: "imovel", valor_carta: 300000, parcela: 1800, prazo: "de_3_a_12_meses" };

const cfg = (horas: number, extra: Partial<ConfigDoRobo> = {}): ConfigDoRobo => ({
  agora: em(horas),
  empresa: "HS Consórcios",
  idioma: "pt_BR",
  templates: { lead: "crm_boas_vindas", vendedor: "crm_aviso_vendedor", followup: "crm_retomada", nutricao: "crm_nutricao" },
  followup_horas: [24, 72],
  lead: { id: LEAD, nome: "João da Carta", telefone: "5541988887777", nota: 76, faixa: "quente", campanha: "HS Imóvel Nov" },
  vendedor: null,
  ...extra,
});

const interativo = (c: CorpoDaMeta) => c.interactive as { type: string; body: { text: string }; action: { buttons?: Array<{ reply: { id: string; title: string } }>; button?: string; sections?: Array<{ rows: Array<{ id: string; title: string }> }> } };
const template = (c: CorpoDaMeta) => c.template as { name: string; language: { code: string }; components?: Array<{ type: string; sub_type?: string; index?: string; parameters: Array<{ type: string; text?: string; payload?: string }> }> };

/** Roda uma sequência de eventos, cada um na sua hora, e devolve todos os passos. */
function conversa(passos: Array<[number, Evento, Partial<ConfigDoRobo>?]>, respostas: Record<string, unknown> = RESPOSTAS_DO_FORMULARIO): Passo[] {
  let estado: EstadoDaConversa = estadoInicial(respostas, em(passos[0][0]));
  return passos.map(([hora, evento, extra]) => {
    const p = proximoPasso(estado, evento, regras, cfg(hora, extra));
    estado = p.estado;
    return p;
  });
}

describe("corpos da Cloud API", () => {
  it("usa a versão atual da Graph e o endereço de mensagens do número", () => {
    expect(VERSAO_DA_GRAPH_DO_WHATSAPP).toBe("v27.0");
    expect(enderecoDasMensagens("555000111")).toBe("https://graph.facebook.com/v27.0/555000111/messages");
    expect(enderecoDasMensagens("555000111", "lixo")).toBe("https://graph.facebook.com/v27.0/555000111/messages");
    expect(() => enderecoDasMensagens("abc")).toThrow();
  });

  it("monta o texto", () => {
    expect(corpoDeTexto("5541988887777", "Olá")).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "5541988887777", type: "text", text: { preview_url: false, body: "Olá" } });
  });

  it("monta o template com variáveis limpas e os botões de resposta rápida com payload", () => {
    const c = corpoDeTemplate("5541988887777", "crm_aviso_vendedor", "pt_BR", ["João\nda Carta", "", "a    b"], ["crm:x:atendi", "crm:x:vendeu"]);
    expect(c.type).toBe("template");
    const t = template(c);
    expect(t.name).toBe("crm_aviso_vendedor");
    expect(t.language).toEqual({ code: "pt_BR" });
    expect(t.components![0]).toEqual({ type: "body", parameters: [{ type: "text", text: "João da Carta" }, { type: "text", text: "não informado" }, { type: "text", text: "a b" }] });
    expect(t.components![1]).toEqual({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "crm:x:atendi" }] });
    expect(t.components![2].index).toBe("1");
    expect(template(corpoDeTemplate("5541988887777", "simples", "pt_BR")).components).toBeUndefined();
  });

  it("monta botões (até 3, título com até 20 caracteres e sem repetir)", () => {
    const c = corpoDeBotoes("5541988887777", "Tem lance?", [
      { id: "a", titulo: "Um título muito comprido demais" }, { id: "b", titulo: "Não" }, { id: "c", titulo: "Não" }, { id: "d", titulo: "Sobra" },
    ]);
    const i = interativo(c);
    expect(c.type).toBe("interactive");
    expect(i.type).toBe("button");
    expect(i.body.text).toBe("Tem lance?");
    expect(i.action.buttons).toHaveLength(3);
    expect(i.action.buttons!.every((b) => b.reply.title.length <= 20)).toBe(true);
    expect(new Set(i.action.buttons!.map((b) => b.reply.title)).size).toBe(3);
    expect(i.action.buttons![0].reply.id).toBe("a");
  });

  it("monta lista (até 10 linhas, título com até 24 e botão com até 20)", () => {
    const opcoes = Array.from({ length: 12 }, (_, n) => ({ id: `o${n}`, titulo: `Opção número ${n} bem comprida mesmo` }));
    const i = interativo(corpoDeLista("5541988887777", "Escolha", "Um botão comprido demais para caber", opcoes));
    expect(i.type).toBe("list");
    expect(i.action.button!.length).toBeLessThanOrEqual(20);
    expect(i.action.sections![0].rows).toHaveLength(10);
    expect(i.action.sections![0].rows.every((r) => r.title.length <= 24)).toBe(true);
    expect(interativo(corpoInterativo("5541988887777", "x", opcoes.slice(0, 3))).type).toBe("button");
    expect(interativo(corpoInterativo("5541988887777", "x", opcoes.slice(0, 4))).type).toBe("list");
  });

  it("fora da janela só sai template; as chaves internas nunca vão para a Meta", () => {
    const texto = { ...corpoDeTexto("5541988887777", "oi"), _texto: "oi" };
    expect(corpoParaAMeta(texto, true)).toEqual(corpoDeTexto("5541988887777", "oi"));
    expect(corpoParaAMeta(texto, false)).toBeNull();
    const reserva = corpoDeTemplate("5541988887777", "crm_aviso_vendedor", "pt_BR", ["a"]);
    const comReserva = { ...corpoDeLista("5541988887777", "resumo", "Marcar", [{ id: "a", titulo: "A" }]), _reserva: reserva, _texto: "resumo" };
    expect(corpoParaAMeta(comReserva, true)!.type).toBe("interactive");
    expect(corpoParaAMeta(comReserva, true)).not.toHaveProperty("_reserva");
    expect(corpoParaAMeta(comReserva, false)).toEqual(reserva);
    expect(corpoParaAMeta({ ...reserva, _texto: "x" }, false)).toEqual(reserva);
  });

  it("lê a resposta da Meta: enviado, tentar de novo e erro definitivo, sem vazar o token", () => {
    const token = "EAAGsegredoDoWhatsApp0123456789abcdef";
    expect(lerRespostaDoWhatsapp(200, { messages: [{ id: "wamid.ABC" }] })).toEqual({ ok: true, id: "wamid.ABC" });
    const ritmo = lerRespostaDoWhatsapp(429, { error: { message: "Rate limit hit", code: 130429 } }, token);
    expect(ritmo).toMatchObject({ ok: false, definitivo: false });
    const fora = lerRespostaDoWhatsapp(500, null, token);
    expect(fora).toMatchObject({ ok: false, definitivo: false });
    const semTemplate = lerRespostaDoWhatsapp(404, { error: { message: "Template name does not exist", code: 132001 } }, token);
    expect(semTemplate).toMatchObject({ ok: false, definitivo: true });
    const recusado = lerRespostaDoWhatsapp(401, { error: { message: `Invalid OAuth access token ${token}`, code: 190 } }, token);
    expect(recusado).toMatchObject({ ok: false, definitivo: true });
    expect(JSON.stringify([ritmo, fora, semTemplate, recusado])).not.toContain("EAAG");
    expect(semToken(`Bearer ${token} access_token=${token}`, token)).not.toContain("segredo");
  });

  it("normaliza o telefone para o envio", () => {
    expect(telefoneParaEnvio("+55 (41) 98888-7777")).toBe("5541988887777");
    expect(telefoneParaEnvio("41988887777")).toBe("5541988887777");
    expect(telefoneParaEnvio("123")).toBeNull();
    expect(telefoneParaEnvio(null)).toBeNull();
  });
});

describe("leitura do webhook", () => {
  const valor = {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "554130001000", phone_number_id: "555000111" },
    contacts: [{ profile: { name: "João" }, wa_id: "5541988887777" }],
    messages: [
      { from: "5541988887777", id: "wamid.1", timestamp: "1794830400", type: "text", text: { body: "Pode perguntar" } },
      { from: "5541988887777", id: "wamid.2", timestamp: "1794830460", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "r:lance:sim", title: "Sim" } } },
      { from: "5541988887777", id: "wamid.3", timestamp: "1794830520", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "r:renda:6000", title: "R$ 3 mil a 6 mil" } } },
      { from: "5541999990001", id: "wamid.4", timestamp: "1794830580", type: "button", button: { payload: `crm:${LEAD}:atendi`, text: "Atendi" } },
      { from: "5541988887777", id: "wamid.5", timestamp: "1794830640", type: "audio", audio: { id: "x" } },
      { from: "5541988887777", id: "wamid.1", timestamp: "1794830400", type: "text", text: { body: "repetida" } },
    ],
    statuses: [
      { id: "wamid.S1", status: "delivered", recipient_id: "5541988887777" },
      { id: "wamid.S2", status: "failed", recipient_id: "5541988887777", errors: [{ code: 131026, title: "Message undeliverable" }] },
    ],
  };
  const corpoDoWebhook = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: valor }] }] };

  it("lê texto, botão, lista, botão de template e outros tipos, sem repetir", () => {
    const { mensagens, status } = lerEntradas(corpoDoWebhook);
    expect(mensagens.map((m) => m.tipo)).toEqual(["texto", "botao", "lista", "botao", "outro"]);
    expect(mensagens[0]).toMatchObject({ id: "wamid.1", de: "5541988887777", texto: "Pode perguntar", opcao: null, nome: "João", phone_id: "555000111" });
    expect(mensagens[0].quando).toBe(new Date(1794830400000).toISOString());
    expect(mensagens[1]).toMatchObject({ opcao: "r:lance:sim", texto: "Sim" });
    expect(mensagens[2]).toMatchObject({ opcao: "r:renda:6000", texto: "R$ 3 mil a 6 mil" });
    expect(mensagens[3]).toMatchObject({ de: "5541999990001", opcao: `crm:${LEAD}:atendi`, texto: "Atendi" });
    expect(status).toHaveLength(2);
    expect(status[1]).toMatchObject({ id: "wamid.S2", status: "failed" });
    expect(status[1].erro).toContain("131026");
  });

  it("aceita o corpo inteiro, as entradas, as mudanças, os valores ou a mensagem solta", () => {
    for (const forma of [corpoDoWebhook, corpoDoWebhook.entry, corpoDoWebhook.entry[0].changes, [valor], valor]) {
      expect(lerEntradas(forma).mensagens).toHaveLength(5);
    }
    expect(lerEntradas([valor.messages[0]]).mensagens).toHaveLength(1);
    expect(lerEntradas([{ field: "account_update", value: valor }]).mensagens).toHaveLength(0);
    expect(lerEntradas(null).mensagens).toHaveLength(0);
    expect(lerEntradas("lixo").mensagens).toHaveLength(0);
  });
});

describe("perguntas e texto livre", () => {
  it("pergunta o que falta para a pontuação mais renda e capacidade, no máximo 4", () => {
    expect(perguntasDoRobo(RESPOSTAS_DO_FORMULARIO, regras)).toEqual(["lance", "renda", "capacidade"]);
    // Faltando quase tudo: duas do formulário, depois renda e capacidade (que responde também à parcela).
    expect(perguntasDoRobo({ bem: "moto" }, regras)).toEqual(["valor_carta", "prazo", "renda", "capacidade"]);
    expect(perguntasDoRobo({ ...RESPOSTAS_DO_FORMULARIO, lance: "sim", renda: 5000, capacidade: 900 }, regras)).toEqual([]);
  });

  it("monta as perguntas com botões ou lista conforme o número de opções", () => {
    const lance = montarPergunta("lance", regras)!;
    expect(lance.opcoes.map((o) => o.id)).toEqual(["r:lance:sim", "r:lance:nao"]);
    expect(lance.opcoes.map((o) => o.titulo)).toEqual(["Sim", "Não"]);
    const renda = montarPergunta("renda", regras)!;
    expect(renda.opcoes.map((o) => o.titulo)).toEqual(["Até R$ 3 mil", "R$ 3 mil a 6 mil", "R$ 6 mil a 10 mil", "Acima de R$ 10 mil"]);
    expect(renda.opcoes.every((o) => o.titulo.length <= 20)).toBe(true);
    // A capacidade usa as faixas de "parcela" da empresa.
    expect(montarPergunta("capacidade", regras)!.opcoes.map((o) => o.titulo)).toEqual(["Até R$ 300", "R$ 300 a 800", "R$ 800 a 2 mil", "Acima de R$ 2 mil"]);
    expect(montarPergunta("bem", regras)!.opcoes).toHaveLength(6);
    expect(montarPergunta("nao_existe", regras)).toBeNull();
  });

  it("lê valores em dinheiro", () => {
    expect(lerValor("uns 4 mil")).toBe(4000);
    expect(lerValor("R$ 3.500,00")).toBe(3500);
    expect(lerValor("2,5k")).toBe(2500);
    expect(lerValor("1.5 mil")).toBe(1500);
    expect(lerValor("1 milhão")).toBe(1000000);
    expect(lerValor("800")).toBe(800);
    expect(lerValor("não sei")).toBeNull();
    expect(dinheiroCurto(1800)).toBe("R$ 1,8 mil");
    expect(dinheiroCurto(300)).toBe("R$ 300");
    expect(dinheiroCurto(300000)).toBe("R$ 300 mil");
  });

  it("casa texto livre por palavra-chave, número e prazo", () => {
    const lance = montarPergunta("lance", regras)!;
    expect(casarTextoLivre("Tenho sim!", lance)).toEqual({ valor: "sim", titulo: "Sim" });
    expect(casarTextoLivre("não tenho", lance)).toEqual({ valor: "nao", titulo: "Não" });
    expect(casarTextoLivre("NÃO", lance)!.valor).toBe("nao");
    expect(casarTextoLivre("2", lance)!.valor).toBe("nao");
    expect(casarTextoLivre("talvez", lance)).toBeNull();
    expect(casarTextoLivre("", lance)).toBeNull();
    const renda = montarPergunta("renda", regras)!;
    expect(casarTextoLivre("ganho uns 4 mil", renda)).toEqual({ valor: 4000, titulo: "R$ 4 mil" });
    expect(casarTextoLivre("R$ 3 mil a 6 mil", renda)).toEqual({ valor: 6000, titulo: "R$ 3 mil a 6 mil" });
    expect(casarTextoLivre("quero continuar", renda)).toBeNull();
    const bem = montarPergunta("bem", regras)!;
    expect(casarTextoLivre("quero um apartamento", bem)!.valor).toBe("imovel");
    expect(casarTextoLivre("uma moto", bem)!.valor).toBe("moto");
    const prazo = montarPergunta("prazo", regras)!;
    expect(casarTextoLivre("uns 6 meses", prazo)!.valor).toBe("de_3_a_12_meses");
    expect(casarTextoLivre("daqui 2 anos", prazo)!.valor).toBe("mais_de_12_meses");
    expect(casarTextoLivre("mês que vem, 1 mes", prazo)!.valor).toBe("menos_de_3_meses");
  });

  it("reconhece o pedido de parar", () => {
    for (const t of ["parar", "PARAR", "Sair", "não quero", "Não quero mais receber isso", "pare de mandar mensagem", "Parar mensagens", "não tenho interesse"]) expect(pediuParaParar(t)).toBe(true);
    for (const t of ["não", "não tenho lance", "quero continuar", "para quando?", "sim", ""]) expect(pediuParaParar(t)).toBe(false);
    expect(pediuParaParar("", "parar")).toBe(true);
  });
});

describe("máquina de estados: do lead novo até o vendedor", () => {
  it("lead quente ou morno: boas-vindas por template na hora e follow-up marcado para 24 h", () => {
    const [p] = conversa([[0, { tipo: "lead_criado", faixa: "quente" }]]);
    expect(p.estado.etapa).toBe("inicio");
    expect(p.estado.proximo_followup_em).toBe(em(24));
    expect(p.envios).toHaveLength(1);
    expect(p.envios[0]).toMatchObject({ chave: `lead:${LEAD}:boas-vindas`, destino: "lead", para: "5541988887777" });
    const t = template(p.envios[0].corpo);
    expect(t.name).toBe("crm_boas_vindas");
    expect(t.components![0].parameters.map((x) => x.text)).toEqual(["João", "HS Consórcios", "imóvel"]);
    expect(t.components).toHaveLength(1);
    expect(p.avisarVendedor).toBeUndefined();
  });

  it("lead frio: template de nutrição se existir e nada de vendedor", () => {
    const [p] = conversa([[0, { tipo: "lead_criado", faixa: "frio", nutricao: true }]]);
    expect(p.estado.etapa).toBe("nutricao");
    expect(p.estado.proximo_followup_em).toBeNull();
    expect(p.envios.map((e) => e.chave)).toEqual([`lead:${LEAD}:nutricao`]);
    expect(template(p.envios[0].corpo).name).toBe("crm_nutricao");
    expect(p.envios.some((e) => e.destino === "vendedor")).toBe(false);
    const [sem] = conversa([[0, { tipo: "lead_criado", faixa: "frio" }, { templates: {} }]]);
    expect(sem.estado.etapa).toBe("nutricao");
    expect(sem.envios).toHaveLength(0);
  });

  it("sem template de boas-vindas nada sai; sem telefone a conversa nem começa", () => {
    const [sem] = conversa([[0, { tipo: "lead_criado", faixa: "quente" }, { templates: {} }]]);
    expect(sem.envios).toHaveLength(0);
    expect(sem.estado.etapa).toBe("inicio");
    const [mudo] = conversa([[0, { tipo: "lead_criado", faixa: "quente" }, { lead: { id: LEAD, nome: "Sem Fone", telefone: null } }]]);
    expect(mudo.envios).toHaveLength(0);
    expect(mudo.encerrar).toBe(true);
  });

  it("o lead responde: uma pergunta por vez com botões, requalifica para quente e passa ao vendedor", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [1, { tipo: "mensagem", texto: "Pode perguntar" }],
      [1.1, { tipo: "mensagem", texto: "Sim", opcao: "r:lance:sim" }],
      [1.2, { tipo: "mensagem", texto: "ganho uns 4 mil" }],
      [1.3, { tipo: "mensagem", texto: "R$ 800 a 2 mil", opcao: "r:capacidade:2000" }],
      [1.3, { tipo: "requalificado", faixa: "quente", nota: 91, vendedor: VIC }, { vendedor: VIC, lead: { id: LEAD, nome: "João da Carta", telefone: "5541988887777", nota: 91, faixa: "quente", campanha: "HS Imóvel Nov" } }],
    ]);
    // A resposta abre a janela de 24 h e a primeira pergunta sai com botões.
    expect(p[1].estado).toMatchObject({ etapa: "perguntando", pergunta: "lance", janela_ate: em(25), ultima_do_lead_em: em(1), followups: 0 });
    expect(p[1].envios).toHaveLength(1);
    expect(p[1].envios[0].chave).toBe(`lead:${LEAD}:p:lance:0`);
    expect(interativo(p[1].envios[0].corpo).action.buttons!.map((b) => b.reply.id)).toEqual(["r:lance:sim", "r:lance:nao"]);
    // Renda e capacidade têm 4 faixas: lista.
    expect(p[2].estado.pergunta).toBe("renda");
    expect(interativo(p[2].envios[0].corpo).type).toBe("list");
    expect(interativo(p[2].envios[0].corpo).action.sections![0].rows).toHaveLength(4);
    expect(p[3].estado.pergunta).toBe("capacidade");
    expect(p[3].estado.respostas.renda).toBe(4000);
    // Acabaram as perguntas: nota nova, sem envio até o banco dizer quem atende.
    expect(p[4].envios).toHaveLength(0);
    expect(p[4].estado.etapa).toBe("qualificado");
    expect(p[4].estado.proximo_followup_em).toBeNull();
    expect(p[4].requalificar).toMatchObject({ nota: 91, faixa: "quente" });
    expect(p[4].requalificar!.motivos).toContain("Lance ou entrada: 15");
    expect(p[4].requalificar!.campos).toEqual({ lance: "Sim", renda_mensal: "R$ 4 mil", capacidade_de_pagamento: "R$ 800 a 2 mil" });
    // Uma pergunta por mensagem, e nunca mais de 4.
    expect(p.slice(1, 5).reduce((n, x) => n + x.envios.length, 0)).toBe(3);
    // Passagem: o lead sabe quem vai chamar e recebe o contato; o vendedor recebe o resumo com os botões.
    const fim = p[5];
    expect(fim.estado.etapa).toBe("passado");
    expect(fim.avisarVendedor).toBe(true);
    expect(fim.estado.vendedor_avisado_em).toBe(em(1.3));
    const aoLead = fim.envios.filter((e) => e.destino === "lead")[0];
    expect(aoLead.chave).toBe(`lead:${LEAD}:consultor`);
    expect(aoLead.texto).toContain("Vic");
    expect(aoLead.texto).toContain("https://wa.me/5541999990001");
    const aoVendedor = fim.envios.filter((e) => e.destino === "vendedor")[0];
    expect(aoVendedor).toMatchObject({ chave: `vend:${LEAD}:aviso`, para: "5541999990001" });
    const t = template(aoVendedor.corpo);
    expect(t.name).toBe("crm_aviso_vendedor");
    const variaveis = t.components![0].parameters.map((x) => x.text);
    expect(variaveis.slice(0, 7)).toEqual(["João da Carta", "Imóvel", "R$ 300 mil", "R$ 1,8 mil", "De 3 a 12 meses", "91 (quente)", "HS Imóvel Nov"]);
    expect(variaveis[7]).toMatch(/^https:\/\/wa\.me\/5541988887777\?text=/);
    expect(t.components!.slice(1).map((c) => c.parameters[0].payload)).toEqual([`crm:${LEAD}:atendi`, `crm:${LEAD}:simulacao`, `crm:${LEAD}:vendeu`, `crm:${LEAD}:sem_resposta`]);
  });

  it("requalifica para frio: nutrição, agradece dentro da janela e não avisa vendedor", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "morno" }],
      [1, { tipo: "mensagem", texto: "oi" }],
      [1.1, { tipo: "mensagem", texto: "uns 20 mil" }],
      [1.2, { tipo: "mensagem", opcao: "r:prazo:menos_de_3_meses" }],
      [1.3, { tipo: "mensagem", opcao: "r:renda:3000" }],
      [1.4, { tipo: "mensagem", opcao: "r:capacidade:300" }],
      [1.4, { tipo: "requalificado", faixa: "frio", vendedor: null }],
    ], { bem: "moto" });
    expect(p[1].estado.pergunta).toBe("valor_carta");
    expect(p[2].estado.respostas.valor_carta).toBe(20000);
    expect(p[5].requalificar).toMatchObject({ faixa: "frio" });
    // A capacidade respondeu também à parcela que faltava.
    expect(p[5].estado.respostas.parcela).toBe(300);
    expect(p[6].estado.etapa).toBe("nutricao");
    expect(p[6].envios.map((e) => e.chave)).toEqual([`lead:${LEAD}:nutricao-texto`]);
    expect(p[6].avisarVendedor).toBeUndefined();
  });

  it("na fila: pergunta normalmente, avisa o lead que um consultor vai chamar e o vendedor só quando a fila distribui", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "morno" }],
      [1, { tipo: "mensagem", texto: "pode" }],
      [1.1, { tipo: "mensagem", opcao: "r:lance:nao" }],
      [1.2, { tipo: "mensagem", opcao: "r:renda:6000" }],
      [1.3, { tipo: "mensagem", opcao: "r:capacidade:800" }],
      [1.3, { tipo: "requalificado", faixa: "morno", vendedor: null }],
      [2, { tipo: "distribuido", vendedor: VIC }, { vendedor: VIC }],
    ]);
    expect(p[5].estado.etapa).toBe("qualificado");
    expect(p[5].envios.map((e) => e.chave)).toEqual([`lead:${LEAD}:aguarde`]);
    expect(p[5].envios.some((e) => e.destino === "vendedor")).toBe(false);
    expect(p[6].estado.etapa).toBe("passado");
    expect(p[6].envios.map((e) => e.chave)).toEqual([`lead:${LEAD}:consultor`, `vend:${LEAD}:aviso`]);
    // Distribuição antes do fim das perguntas não avisa ninguém: o aviso sai quando qualificar.
    const cedo = conversa([[0, { tipo: "lead_criado", faixa: "morno" }], [1, { tipo: "distribuido", vendedor: VIC }, { vendedor: VIC }]]);
    expect(cedo[1].envios).toHaveLength(0);
    expect(cedo[1].estado.etapa).toBe("inicio");
  });

  it("texto livre que não casa: repete uma vez com os botões e, na segunda, segue para a próxima", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [1, { tipo: "mensagem", texto: "oi" }],
      [1.1, { tipo: "mensagem", texto: "talvez" }],
      [1.2, { tipo: "mensagem", texto: "sei lá" }],
    ]);
    expect(p[2].estado.pergunta).toBe("lance");
    expect(p[2].envios[0].chave).toBe(`lead:${LEAD}:p:lance:1`);
    expect(p[2].envios[0].texto).toContain("Não consegui entender");
    expect(interativo(p[2].envios[0].corpo).action.buttons).toHaveLength(2);
    expect(p[3].estado.pergunta).toBe("renda");
    expect(p[3].estado.respostas.lance).toBe("");
    expect(p[3].envios[0].chave).toBe(`lead:${LEAD}:p:renda:0`);
  });

  it("depois de passado, o lead que escreve é encaminhado ao consultor uma vez só", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [1, { tipo: "mensagem", texto: "oi" }],
      [1.1, { tipo: "mensagem", opcao: "r:lance:sim" }],
      [1.2, { tipo: "mensagem", opcao: "r:renda:6000" }],
      [1.3, { tipo: "mensagem", opcao: "r:capacidade:800" }],
      [1.3, { tipo: "requalificado", faixa: "quente", vendedor: VIC }, { vendedor: VIC }],
      [3, { tipo: "mensagem", texto: "alguém aí?" }, { vendedor: VIC }],
      [4, { tipo: "mensagem", texto: "oi?" }, { vendedor: VIC }],
    ]);
    expect(p[6].envios.map((e) => e.chave)).toEqual([`lead:${LEAD}:redireciona`]);
    expect(p[6].envios[0].texto).toContain("https://wa.me/5541999990001");
    expect(p[7].envios).toHaveLength(0);
  });
});

describe("máquina de estados: silêncio, parar e janela", () => {
  it("sem resposta: follow-up em 24 h e 72 h por template e depois encerra", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [23, { tipo: "tempo" }],
      [24, { tipo: "tempo" }],
      [50, { tipo: "tempo" }],
      [72, { tipo: "tempo" }],
      [95, { tipo: "tempo" }],
      [96, { tipo: "tempo" }],
    ]);
    expect(p[1].envios).toHaveLength(0);
    expect(p[2].envios).toHaveLength(1);
    expect(template(p[2].envios[0].corpo).name).toBe("crm_retomada");
    expect(template(p[2].envios[0].corpo).components![0].parameters.map((x) => x.text)).toEqual(["João", "imóvel"]);
    expect(p[2].estado).toMatchObject({ followups: 1, proximo_followup_em: em(72), etapa: "inicio" });
    expect(p[3].envios).toHaveLength(0);
    expect(p[4].envios).toHaveLength(1);
    expect(p[4].estado).toMatchObject({ followups: 2, proximo_followup_em: em(96) });
    expect(p[4].envios[0].chave).not.toBe(p[2].envios[0].chave);
    expect(p[5].envios).toHaveLength(0);
    expect(p[6].envios).toHaveLength(0);
    expect(p[6].encerrar).toBe(true);
    expect(p[6].estado).toMatchObject({ etapa: "encerrado", proximo_followup_em: null });
    expect(p[6].requalificar).toBeUndefined();
  });

  it("o número de follow-ups segue o tamanho da lista; sem template de retomada encerra no primeiro prazo", () => {
    const um = conversa([[0, { tipo: "lead_criado", faixa: "quente" }, { followup_horas: [12] }], [12, { tipo: "tempo" }, { followup_horas: [12] }], [36, { tipo: "tempo" }, { followup_horas: [12] }]]);
    expect(um[0].estado.proximo_followup_em).toBe(em(12));
    expect(um[1].envios).toHaveLength(1);
    expect(um[2].encerrar).toBe(true);
    const semTemplate = { templates: { lead: "crm_boas_vindas" } };
    const sem = conversa([[0, { tipo: "lead_criado", faixa: "quente" }, semTemplate], [24, { tipo: "tempo" }, semTemplate]]);
    expect(sem[1].envios).toHaveLength(0);
    expect(sem[1].encerrar).toBe(true);
  });

  it("quem respondeu uma parte e sumiu: retomada, e no fim é requalificado com o que disse e vai ao vendedor", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [1, { tipo: "mensagem", texto: "oi" }],
      [1, { tipo: "mensagem", opcao: "r:lance:sim" }],
      [25, { tipo: "tempo" }],
      [73, { tipo: "tempo" }],
      [97, { tipo: "tempo" }],
      [97, { tipo: "requalificado", faixa: "quente", vendedor: VIC }, { vendedor: VIC }],
    ]);
    expect(p[2].estado.proximo_followup_em).toBe(em(25));
    expect(p[3].envios).toHaveLength(1);
    expect(p[3].estado.proximo_followup_em).toBe(em(73));
    expect(p[4].envios).toHaveLength(1);
    expect(p[5].requalificar).toMatchObject({ faixa: "quente", nota: 91 });
    expect(p[5].estado.etapa).toBe("qualificado");
    // A janela do lead fechou: só o vendedor recebe (por template).
    expect(p[6].envios.map((e) => e.chave)).toEqual([`vend:${LEAD}:aviso`]);
    expect(p[6].envios[0].corpo.type).toBe("template");
    expect(p[6].estado.etapa).toBe("passado");
  });

  it("quem volta depois da retomada continua de onde parou, sem gastar a tentativa", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [1, { tipo: "mensagem", texto: "oi" }],
      [25, { tipo: "tempo" }],
      [26, { tipo: "mensagem", texto: "Quero continuar" }],
      [26.1, { tipo: "mensagem", texto: "talvez" }],
    ]);
    expect(p[3].estado).toMatchObject({ etapa: "perguntando", pergunta: "lance", followups: 0, proximo_followup_em: em(50) });
    expect(p[3].envios).toHaveLength(1);
    expect(p[3].envios[0].texto).toContain("Vamos continuar");
    expect(p[4].envios[0].chave).toBe(`lead:${LEAD}:p:lance:1`);
    // Conversa encerrada por silêncio reabre se o lead escrever.
    const volta = conversa([[0, { tipo: "lead_criado", faixa: "quente" }, { templates: { lead: "x" } }], [24, { tipo: "tempo" }, { templates: { lead: "x" } }], [200, { tipo: "mensagem", texto: "oi, ainda dá?" }]]);
    expect(volta[1].estado.etapa).toBe("encerrado");
    expect(volta[2].estado).toMatchObject({ etapa: "perguntando", pergunta: "lance" });
  });

  it("pedido de parar: encerra, marca e nunca mais manda", () => {
    const p = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [1, { tipo: "mensagem", texto: "oi" }],
      [1.1, { tipo: "mensagem", texto: "PARAR" }],
      [2, { tipo: "mensagem", texto: "oi de novo" }],
      [30, { tipo: "tempo" }],
    ]);
    expect(p[2]).toMatchObject({ parar: true, encerrar: true });
    expect(p[2].estado).toMatchObject({ etapa: "encerrado", pergunta: null, proximo_followup_em: null });
    expect(p[2].envios.map((e) => e.chave)).toEqual([`lead:${LEAD}:parou`]);
    expect(p[3].envios).toHaveLength(0);
    expect(p[3].estado.etapa).toBe("encerrado");
    expect(p[4].envios).toHaveLength(0);
    // O botão "Parar mensagens" do template de boas-vindas também para.
    const botao = conversa([[0, { tipo: "lead_criado", faixa: "quente" }], [1, { tipo: "mensagem", texto: "Parar mensagens" }]]);
    expect(botao[1].parar).toBe(true);
  });

  it("janela de 24 h: fora dela o lead só recebe template", () => {
    const p = conversa([[0, { tipo: "lead_criado", faixa: "quente" }], [1, { tipo: "mensagem", texto: "oi" }]]);
    expect(naJanela(p[0].estado, em(0))).toBe(false);
    expect(naJanela(p[1].estado, em(24.9))).toBe(true);
    expect(naJanela(p[1].estado, em(25))).toBe(false);
    // Tudo o que a máquina manda ao lead fora da janela é template.
    const tudo = conversa([[0, { tipo: "lead_criado", faixa: "quente" }], [24, { tipo: "tempo" }], [72, { tipo: "tempo" }], [96, { tipo: "tempo" }]]);
    const enviados = tudo.reduce<CorpoDaMeta[]>((l, x) => l.concat(x.envios.map((e) => e.corpo)), []);
    expect(enviados.length).toBe(3);
    expect(enviados.every((c) => c.type === "template" && corpoParaAMeta(c, false) !== null)).toBe(true);
    // E a pergunta com botões (que não é template) é barrada na saída se a janela fechar antes do envio.
    expect(corpoParaAMeta(p[1].envios[0].corpo, false)).toBeNull();
  });
});

describe("vendedor: resumo, link e botões", () => {
  const lead = { id: LEAD, nome: "João da Carta", telefone: "41988887777", nota: 82, faixa: "quente" as const, campanha: "HS Imóvel Nov" };

  it("monta o resumo e o link wa.me com a primeira frase pronta", () => {
    const r = resumoParaOVendedor(lead, VIC, "HS Consórcios", { ...RESPOSTAS_DO_FORMULARIO, lance: "sim", renda: 4000 }, regras);
    expect(r.variaveis.slice(0, 7)).toEqual(["João da Carta", "Imóvel", "R$ 300 mil", "R$ 1,8 mil", "De 3 a 12 meses", "82 (quente)", "HS Imóvel Nov"]);
    expect(r.link).toBe(linkDoWhatsapp("5541988887777", r.frase));
    expect(decodeURIComponent(r.link.split("?text=")[1])).toBe("Olá, João! Aqui é Vic, da HS Consórcios. Vi seu interesse em imóvel e vou te ajudar. Podemos falar agora?");
    for (const pedaco of ["João da Carta", "Nota: 82 (quente)", "Bem: Imóvel", "Valor: R$ 300 mil", "Parcela: R$ 1,8 mil", "Prazo: De 3 a 12 meses", "Lance ou entrada: Sim", "Renda mensal: R$ 4 mil", "Campanha: HS Imóvel Nov", r.link]) expect(r.texto).toContain(pedaco);
    // Sem dado, a variável do template nunca vai vazia.
    expect(resumoParaOVendedor({ id: LEAD, nome: "Ana", telefone: "5541977776666" }, VIC, "HS", {}, regras).variaveis.every((v) => v.length > 0)).toBe(true);
  });

  it("dentro da janela do vendedor sai a mensagem com a lista de ações e o template de reserva; fora, o template", () => {
    const dentro = envioAoVendedor(cfg(0, { vendedor: { ...VIC, na_janela: true } }), RESPOSTAS_DO_FORMULARIO, regras)!;
    expect(dentro.corpo.type).toBe("interactive");
    expect(interativo(dentro.corpo).action.sections![0].rows.map((x) => x.title)).toEqual(["Atendi", "Simulação feita", "Vendeu", "Não respondeu"]);
    expect(interativo(dentro.corpo).action.sections![0].rows[0].id).toBe(`crm:${LEAD}:atendi`);
    expect((dentro.corpo._reserva as CorpoDaMeta).type).toBe("template");
    const fora = envioAoVendedor(cfg(0, { vendedor: VIC }), RESPOSTAS_DO_FORMULARIO, regras)!;
    expect(fora.corpo.type).toBe("template");
    // Sem template e fora da janela não há como avisar; vendedor sem WhatsApp também não.
    expect(envioAoVendedor(cfg(0, { vendedor: VIC, templates: {} }), {}, regras)).toBeNull();
    expect(envioAoVendedor(cfg(0, { vendedor: { nome: "Val", whatsapp: null } }), {}, regras)).toBeNull();
  });

  it("lê o toque do vendedor (crm:<lead_id>:<acao>) e responde curto", () => {
    expect(lerBotaoDoVendedor(`crm:${LEAD}:simulacao`)).toEqual({ lead_id: LEAD, acao: "simulacao" });
    expect(lerBotaoDoVendedor(`crm:${LEAD}:sem_resposta`)).toEqual({ lead_id: LEAD, acao: "sem_resposta" });
    expect(lerBotaoDoVendedor(`crm:${LEAD}:apagar`)).toBeNull();
    expect(lerBotaoDoVendedor("crm:123:atendi")).toBeNull();
    expect(lerBotaoDoVendedor("r:lance:sim")).toBeNull();
    expect(lerBotaoDoVendedor(null)).toBeNull();
    expect(confirmacaoAoVendedor({ ok: true, etapa: "contato" }, "João", "atendi")).toBe("Anotado: João agora está em Em contato.");
    expect(confirmacaoAoVendedor({ ok: true, etapa: "proposta" }, "João", "simulacao")).toContain("Proposta");
    expect(confirmacaoAoVendedor({ ok: true, etapa: "ganho" }, "João", "vendeu")).toContain("ganha");
    expect(confirmacaoAoVendedor({ ok: true, etapa: "proposta", sem_mudanca: true }, "João", "atendi")).toContain("já estava em Proposta");
    expect(confirmacaoAoVendedor({ ok: true, etapa: "contato" }, "João", "sem_resposta")).toContain("não respondeu");
    expect(confirmacaoAoVendedor({ ok: false, motivo: "nao_e_o_responsavel" }, "João", "atendi")).toContain("não está com você");
    expect(confirmacaoAoVendedor(null, "João", "atendi")).toContain("Não consegui");
  });
});

describe("envio: modo teste, janela e segredo", () => {
  const envio = (corpo: CorpoDaMeta, naJanelaAgora = true): EnvioDaFila => ({ id: "e1", conta_id: "c1", lead_id: LEAD, para: "5541988887777", destino: "lead", corpo, chave: "k", tentativas: 0, na_janela: naJanelaAgora });
  const TOKEN = "EAAGtokenDoWhatsAppDeTeste0123456789";
  const integracao = (extra: Record<string, unknown> = {}) => ({
    conta_id: "c1", ativo: true, modo: "real", verify_token: "v", liberada: true, empresa: "HS", nicho: "consorcio", pagina_id: null, formularios: [],
    app_secret: null, token: null, wa_phone_id: "555000111", wa_waba_id: null, wa_numero: null, wa_token: TOKEN, templates: {}, idioma: "pt_BR", pontuacao: {}, followup_horas: [24, 72], ...extra,
  }) as never;
  const boasVindas = corpoDeTemplate("5541988887777", "crm_boas_vindas", "pt_BR", ["João", "HS", "imóvel"]);

  it("em modo teste, ou sem número ou token, é simulado e a rede não é chamada", async () => {
    const rede = vi.fn();
    for (const i of [integracao({ modo: "teste" }), integracao({ wa_phone_id: null }), integracao({ wa_token: null })]) {
      expect(await enviarUm(envio({ ...boasVindas, _texto: "x" }), i, rede as never)).toEqual({ situacao: "simulado" });
    }
    expect(rede).not.toHaveBeenCalled();
  });

  it("integração desligada ou mensagem fora da janela sem template não saem", async () => {
    const rede = vi.fn();
    expect((await enviarUm(envio(boasVindas), integracao({ ativo: false }), rede as never)).situacao).toBe("erro");
    expect((await enviarUm(envio(boasVindas), null, rede as never)).situacao).toBe("erro");
    expect((await enviarUm(envio(corpoDeTexto("5541988887777", "oi"), false), integracao(), rede as never)).situacao).toBe("erro");
    expect((await enviarUm(envio(corpoDeTexto("5541988887777", "oi"), false), integracao({ modo: "teste" }), rede as never)).situacao).toBe("erro");
    expect(rede).not.toHaveBeenCalled();
  });

  it("em modo real chama a Cloud API com o token no cabeçalho e sem as chaves internas", async () => {
    const rede = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 }));
    const r = await enviarUm(envio({ ...boasVindas, _texto: "interno" }), integracao(), rede as never);
    expect(r).toEqual({ situacao: "enviado", id: "wamid.OK" });
    const [url, pedido] = rede.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v27.0/555000111/messages");
    expect(url).not.toContain(TOKEN);
    expect((pedido.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(pedido.body))).toEqual(boasVindas);
    expect(String(pedido.body)).not.toContain("interno");
  });

  it("falha passageira volta para a fila, erro definitivo não, e o token nunca aparece no erro", async () => {
    const limite = await enviarUm(envio(boasVindas), integracao(), (async () => new Response(JSON.stringify({ error: { message: "Too many", code: 130429 } }), { status: 429 })) as never);
    expect(limite.situacao).toBe("de_novo");
    const caiu = await enviarUm(envio(boasVindas), integracao(), (async () => { throw new Error(`rede caiu ${TOKEN}`); }) as never);
    expect(caiu.situacao).toBe("de_novo");
    const recusado = await enviarUm(envio(boasVindas), integracao(), (async () => new Response(JSON.stringify({ error: { message: `Bad token ${TOKEN}`, code: 190 } }), { status: 401 })) as never);
    expect(recusado.situacao).toBe("erro");
    expect(JSON.stringify([limite, caiu, recusado])).not.toContain(TOKEN);
  });
});

describe("contratos", () => {
  const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

  it("lista os 4 templates que a empresa precisa criar, com variáveis e botões", () => {
    const lista = templatesNecessarios();
    expect(lista.map((t) => t.chave)).toEqual(["lead", "vendedor", "followup", "nutricao"]);
    lista.forEach((t) => {
      expect(t.nome).toMatch(/^[a-z0-9_]{1,120}$/);
      expect(t.idioma).toBe("pt_BR");
      // Cada variável do corpo tem exemplo, e o corpo não começa nem termina com variável.
      const usadas = (t.corpo.match(/\{\{\d+\}\}/g) || []).length;
      expect(usadas).toBe(t.variaveis.length);
      expect(t.corpo.startsWith("{{")).toBe(false);
      expect(t.corpo.endsWith("}}")).toBe(false);
      expect(t.corpo.length).toBeLessThanOrEqual(1024);
      expect(t.botoes.every((b) => b.length <= 25)).toBe(true);
      expect(`${t.corpo}${t.observacao}${t.titulo}`).not.toMatch(/[–—]/);
    });
    const vendedor = lista.filter((t) => t.chave === "vendedor")[0];
    expect(vendedor.botoes).toEqual(["Atendi", "Simulação feita", "Vendeu", "Não respondeu"]);
    expect(vendedor.variaveis).toHaveLength(8);
    expect(vendedor.categoria).toBe("UTILITY");
  });

  it("o código do robô não usa lookbehind, não tem travessão e o arquivo puro não toca em Deno nem em rede", () => {
    const puro = ler("supabase/functions/_shared/whatsapp-do-crm.ts");
    const modulo = ler("supabase/functions/produto-meta/modulos/whatsapp.ts");
    const rotina = ler("supabase/functions/produto-meta-rotina/index.ts");
    for (const fonte of [puro, modulo, rotina]) {
      expect(fonte).not.toMatch(/\(\?<[=!]/);
      expect(fonte).not.toMatch(/[–—]/);
      expect(fonte).not.toMatch(/console\.(log|error)\([^)]*(wa_token|token\b(?!\]))/);
    }
    expect(puro).not.toMatch(/Deno\.|fetch\(|npm:|createClient/);
    // O módulo só fala com o banco por RPC, e todo envio passa pela fila.
    expect(modulo).not.toMatch(/\.from\(/);
    expect(modulo).toContain("crm_whats_enfileirar");
    expect(modulo).toContain("crm_whats_envio_resultado");
    expect(rotina).toContain("CRON_SECRET");
    expect(rotina).toContain("crm_fila_distribuir");
    expect(rotina).toContain("crm_whats_followups_pegar");
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.produto-meta-rotina\]\s+verify_jwt = true/);
  });

  it("a migration da rotina é só do serviço, com search_path vazio, e agenda a cada 2 minutos onde há pg_cron e pg_net", () => {
    const sql = ler("supabase/migrations/20261114110000_crm_whats_rotina.sql");
    const funcoes = sql.match(/create or replace function public\.crm_whats_\w+/g) || [];
    expect(funcoes.length).toBe(11);
    expect((sql.match(/set search_path = ''/g) || []).length).toBe(funcoes.length);
    expect(sql).toMatch(/revoke all on function public\.%s from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.%s to service_role/);
    expect(sql).toContain("'crm-whats-rotina-2min', '*/2 * * * *'");
    expect(sql).toMatch(/extname = 'pg_cron'[\s\S]+extname = 'pg_net'/);
    expect(sql).toContain("for update skip locked");
    expect(sql).not.toMatch(/drop table|truncate/i);
  });
});

describe("lead que já chega quente", () => {
  it("o vendedor é avisado na hora, sem esperar o robô, e o frio nunca gera aviso", () => {
    const vendedor = { nome: "Vic Souza", whatsapp: "5541999990001", na_janela: false };
    const [quente] = conversa([[0, { tipo: "lead_criado", faixa: "quente" }, { vendedor }]]);
    expect(quente.avisarVendedor).toBe(true);
    expect(quente.envios.some((e) => e.destino === "vendedor")).toBe(true);
    expect(quente.envios.some((e) => e.destino === "lead")).toBe(true);
    expect(quente.estado.etapa).toBe("inicio");
    const [morno] = conversa([[0, { tipo: "lead_criado", faixa: "morno" }, { vendedor }]]);
    expect(morno.envios.some((e) => e.destino === "vendedor")).toBe(false);
    const [frio] = conversa([[0, { tipo: "lead_criado", faixa: "frio", nutricao: true }, { vendedor }]]);
    expect(frio.envios.some((e) => e.destino === "vendedor")).toBe(false);
  });

  it("quente que estava na fila avisa o vendedor assim que o rodízio entrega", () => {
    const vendedor = { nome: "Val Lima", whatsapp: "5541999990002", na_janela: false };
    const passos = conversa([
      [0, { tipo: "lead_criado", faixa: "quente" }],
      [10, { tipo: "distribuido", vendedor }],
    ]);
    expect(passos[0].envios.some((e) => e.destino === "vendedor")).toBe(false);
    expect(passos[1].avisarVendedor).toBe(true);
    expect(passos[1].envios.some((e) => e.destino === "vendedor")).toBe(true);
  });
});

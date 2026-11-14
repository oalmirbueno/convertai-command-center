// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import {
  assinarCorpo,
  assinaturaConfere,
  CAMPOS_DO_LEAD,
  chaveDaResposta,
  conferirDesafio,
  conferirOrigem,
  dadosDoNegocio,
  decidirRegistro,
  ehLeadDeTeste,
  enderecoDoLead,
  leadDeTeste,
  lerBem,
  lerErroDaGraph,
  lerLance,
  lerPrazo,
  lerValor,
  lerWebhook,
  normalizarLead,
  origemDoLead,
} from "../../supabase/functions/_shared/meta-leads-do-crm";
import { lerRegras, pontuar, REGRAS_DO_CONSORCIO, REGRAS_GERAIS } from "../../supabase/functions/_shared/pontuacao-do-crm";
import { conversaoDeTeste, leadgenDaConversao, montarEventoDaMeta, sha256Hex, type ConversaoDaFila } from "../../supabase/functions/_shared/conversoes-da-meta";

/**
 * Lead do formulário da Meta no CRM da empresa (14/11/2026): as funções puras que o webhook
 * (supabase/functions/produto-meta), a tela e o envio de conversões compartilham.
 */

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");
const campo = (name: string, ...values: string[]) => ({ name, values });

describe("assinatura do webhook (X-Hub-Signature-256)", () => {
  const segredo = "0123456789abcdef0123456789abcdef";
  const corpo = '{"object":"page","entry":[{"id":"111222333444","changes":[{"field":"leadgen","value":{"leadgen_id":"1234567890123456"}}]}]}';

  it("a assinatura é o HMAC SHA-256 do corpo cru com o segredo do app", async () => {
    const esperado = "sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex");
    expect(await assinarCorpo(corpo, segredo)).toBe(esperado);
    expect(await assinarCorpo(new TextEncoder().encode(corpo), segredo)).toBe(esperado);
    expect(await assinaturaConfere(corpo, esperado, segredo)).toBe(true);
    expect(await assinaturaConfere(new TextEncoder().encode(corpo), esperado.toUpperCase().replace("SHA256=", "sha256="), segredo)).toBe(true);
  });

  it("acento no corpo: vale o byte que chegou, não o texto reescrito", async () => {
    const comAcento = '{"nome":"João"}';
    const esperado = "sha256=" + createHmac("sha256", segredo).update(Buffer.from(comAcento, "utf8")).digest("hex");
    expect(await assinaturaConfere(new TextEncoder().encode(comAcento), esperado, segredo)).toBe(true);
    // O mesmo JSON com o acento escapado tem outros bytes e outra assinatura.
    expect(await assinaturaConfere('{"nome":"Jo\\u00e3o"}', esperado, segredo)).toBe(false);
  });

  it("recusa segredo errado, corpo mexido, cabeçalho ausente ou malformado e empresa sem segredo", async () => {
    const certa = await assinarCorpo(corpo, segredo);
    expect(await assinaturaConfere(corpo, certa, "outro-segredo-qualquer-0000")).toBe(false);
    expect(await assinaturaConfere(corpo + " ", certa, segredo)).toBe(false);
    expect(await assinaturaConfere(corpo, null, segredo)).toBe(false);
    expect(await assinaturaConfere(corpo, "", segredo)).toBe(false);
    expect(await assinaturaConfere(corpo, certa.replace("sha256=", "sha1="), segredo)).toBe(false);
    expect(await assinaturaConfere(corpo, certa.slice(0, -2), segredo)).toBe(false);
    expect(await assinaturaConfere(corpo, certa.slice(0, -1) + (certa.slice(-1) === "0" ? "1" : "0"), segredo)).toBe(false);
    expect(await assinaturaConfere(corpo, certa, "")).toBe(false);
    expect(await assinaturaConfere(corpo, certa, null)).toBe(false);
  });

  it("a conferência do endereço devolve o desafio só com o token da empresa", () => {
    const busca = (q: string) => new URLSearchParams(q);
    expect(conferirDesafio(busca("hub.mode=subscribe&hub.verify_token=abc123&hub.challenge=998877"), "abc123")).toEqual({ ok: true, desafio: "998877" });
    expect(conferirDesafio(busca("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=998877"), "abc123").ok).toBe(false);
    expect(conferirDesafio(busca("hub.mode=unsubscribe&hub.verify_token=abc123&hub.challenge=1"), "abc123").ok).toBe(false);
    expect(conferirDesafio(busca("hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), "").ok).toBe(false);
    expect(conferirDesafio(busca("hub.mode=subscribe&hub.verify_token=abc123"), "abc123").ok).toBe(false);
  });
});

describe("leitura do corpo do webhook", () => {
  it("avisos de leadgen com os ids como texto, sem repetir o mesmo lead no mesmo corpo", () => {
    const r = lerWebhook({
      object: "page",
      entry: [
        {
          id: "111222333444",
          time: 1763000000,
          changes: [
            { field: "leadgen", value: { leadgen_id: "1234567890123456", page_id: "111222333444", form_id: "555666777888", adgroup_id: "777", ad_id: 120210000000001, created_time: 1763000001 } },
            { field: "leadgen", value: { leadgen_id: "1234567890123456", page_id: "111222333444", form_id: "555666777888" } },
            { field: "feed", value: { item: "post" } },
            { field: "leadgen", value: { leadgen_id: "abc" } },
            { field: "leadgen", value: { leadgen_id: "9876543210987654" } },
          ],
        },
      ],
    });
    expect(r.objeto).toBe("page");
    expect(r.whatsapp).toEqual([]);
    expect(r.leads).toEqual([
      { leadgen_id: "1234567890123456", form_id: "555666777888", page_id: "111222333444", ad_id: "120210000000001", adgroup_id: "777", created_time: 1763000001 },
      // Sem page_id no aviso, vale o id da entrada (a Página).
      { leadgen_id: "9876543210987654", form_id: null, page_id: "111222333444", ad_id: null, adgroup_id: null, created_time: null },
    ]);
  });

  it("entradas de WhatsApp saem separadas e sem interpretação", () => {
    const entrada = { id: "999000111222", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages: [{ id: "wamid.X", from: "5547999991111", text: { body: "oi" } }] } }] };
    const r = lerWebhook({ object: "whatsapp_business_account", entry: [entrada] });
    expect(r.leads).toEqual([]);
    expect(r.whatsapp).toEqual([entrada]);
  });

  it("corpo estranho não derruba e não vira lead", () => {
    for (const corpo of [null, undefined, 7, "texto", [], {}, { object: "page" }, { object: "instagram", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "1234567890123456" } }] }] }, { object: "page", entry: [null, { changes: "x" }, { changes: [null, { field: "leadgen" }] }] }]) {
      const r = lerWebhook(corpo);
      expect(r.leads).toEqual([]);
      expect(r.whatsapp).toEqual([]);
    }
  });

  it("no máximo 50 avisos por chamada", () => {
    const changes = Array.from({ length: 80 }, (_, i) => ({ field: "leadgen", value: { leadgen_id: String(1000000000000000 + i) } }));
    expect(lerWebhook({ object: "page", entry: [{ id: "111222333444", changes }] }).leads.length).toBe(50);
  });
});

describe("tratar ou não o aviso (a Meta repete)", () => {
  it("Página e formulário têm que ser os da empresa; lista vazia vale todos", () => {
    const aviso = { page_id: "111222333444", form_id: "555666777888" };
    expect(conferirOrigem(aviso, { pagina_id: "111222333444", formularios: [] })).toBe("ok");
    expect(conferirOrigem(aviso, { pagina_id: "111222333444", formularios: ["555666777888", "1"] })).toBe("ok");
    expect(conferirOrigem(aviso, { pagina_id: "999", formularios: [] })).toBe("outra_pagina");
    expect(conferirOrigem(aviso, { pagina_id: "111222333444", formularios: ["4242424242"] })).toBe("outro_formulario");
    expect(conferirOrigem({ page_id: "111222333444", form_id: null }, { pagina_id: "111222333444", formularios: ["4242424242"] })).toBe("outro_formulario");
    expect(conferirOrigem({ page_id: null, form_id: null }, { pagina_id: "111222333444", formularios: [] })).toBe("outra_pagina");
    // Sem Página salva (ainda em teste), qualquer Página passa.
    expect(conferirOrigem(aviso, { pagina_id: null, formularios: null })).toBe("ok");
  });

  it("aviso novo segue; o que já virou negócio, foi ignorado ou é repetido para", () => {
    const agora = new Date("2026-11-14T12:00:00Z").getTime();
    expect(decidirRegistro({ novo: true }, agora)).toBe("processar");
    expect(decidirRegistro({ novo: false, situacao: "criado", lead_id: "l1" }, agora)).toBe("repetido");
    expect(decidirRegistro({ novo: false, situacao: "repetido", lead_id: "l1" }, agora)).toBe("repetido");
    expect(decidirRegistro({ novo: false, situacao: "ignorado" }, agora)).toBe("repetido");
    expect(decidirRegistro({ novo: false }, agora)).toBe("repetido");
  });

  it("o reenvio de um aviso que deu erro é a nova tentativa; o que caiu no meio volta depois de um minuto", () => {
    const agora = new Date("2026-11-14T12:00:00Z").getTime();
    expect(decidirRegistro({ novo: false, situacao: "erro", lead_id: null }, agora)).toBe("processar");
    expect(decidirRegistro({ novo: false, situacao: "erro", lead_id: "l1" }, agora)).toBe("repetido");
    expect(decidirRegistro({ novo: false, situacao: "recebido", criado_em: "2026-11-14T11:59:50Z" }, agora)).toBe("repetido");
    expect(decidirRegistro({ novo: false, situacao: "recebido", criado_em: "2026-11-14T11:58:00Z" }, agora)).toBe("processar");
    expect(decidirRegistro({ novo: false, situacao: "recebido", criado_em: "data ruim" }, agora)).toBe("repetido");
  });
});

describe("leitura do lead na Graph API", () => {
  it("o endereço leva os campos e nunca o token", () => {
    const e = enderecoDoLead("1234567890123456", "v26.0");
    expect(e).toBe(`https://graph.facebook.com/v26.0/1234567890123456?fields=${CAMPOS_DO_LEAD.join(",")}`);
    expect(e).not.toMatch(/access_token/);
    for (const c of ["field_data", "created_time", "ad_id", "ad_name", "adset_id", "campaign_id", "campaign_name", "form_id", "platform"]) expect(CAMPOS_DO_LEAD).toContain(c);
    expect(() => enderecoDoLead("teste_abc", "v26.0")).toThrow();
    expect(() => enderecoDoLead("1234567890123456", "v26.0/../x")).toThrow();
  });

  it("erro da Meta vira frase curta, sem token, e diz se vale a Meta reenviar", () => {
    const token = "EAAB" + "z".repeat(40);
    expect(lerErroDaGraph(400, { error: { message: "Invalid OAuth access token.", code: 190 } }, token)).toMatchObject({ definitivo: true, campoRecusado: false });
    expect(lerErroDaGraph(403, { error: { message: "(#200) Requires leads_retrieval", code: 200 } }, token).erro).toContain("leads_retrieval");
    expect(lerErroDaGraph(500, null, token).definitivo).toBe(false);
    expect(lerErroDaGraph(429, null, token).definitivo).toBe(false);
    expect(lerErroDaGraph(400, { error: { message: "limite", code: 4 } }, token).definitivo).toBe(false);
    expect(lerErroDaGraph(400, { error: { message: "(#100) Tried accessing nonexisting field (ad_name) on node type (Lead)", code: 100 } }, token).campoRecusado).toBe(true);
    expect(lerErroDaGraph(400, { error: { message: "Unsupported get request. Object with ID '1' does not exist, cannot be loaded due to missing permissions", code: 100, error_subcode: 33 } }, token)).toMatchObject({ definitivo: true, campoRecusado: false });
    const comToken = lerErroDaGraph(400, { error: { message: `falhou com ${token}`, code: 999 } }, token);
    expect(comToken.erro).not.toContain(token);
  });

  it("a origem junta o aviso e o lead, só com o que existe", () => {
    const aviso = { leadgen_id: "1234567890123456", form_id: "555666777888", page_id: "111222333444", ad_id: "1201", adgroup_id: "1202", created_time: 1 };
    expect(origemDoLead({ ad_name: "  Anúncio  carta ", campaign_id: "1203", campaign_name: "Campanha imóvel", platform: "ig", adset_id: "1299" }, aviso, "Formulário carta")).toEqual({
      form_id: "555666777888", form_name: "Formulário carta", ad_id: "1201", ad_name: "Anúncio carta", adset_id: "1299", campaign_id: "1203", campaign_name: "Campanha imóvel", plataforma: "instagram",
    });
    expect(origemDoLead({}, null, "")).toEqual({});
    expect(origemDoLead({ platform: "fb" }, aviso, null)).toEqual({ form_id: "555666777888", ad_id: "1201", adset_id: "1202", plataforma: "facebook" });
  });
});

describe("valores, bem, prazo e lance escritos de qualquer jeito", () => {
  it("valor em reais, com faixa virando o ponto médio", () => {
    expect(lerValor("R$ 150.000,00")).toBe(150000);
    expect(lerValor("150 mil")).toBe(150000);
    expect(lerValor("80k")).toBe(80000);
    expect(lerValor("1,5 milhão")).toBe(1500000);
    expect(lerValor("R$ 100 a 200 mil")).toBe(150000);
    expect(lerValor("de_100_mil_a_200_mil")).toBe(150000);
    expect(lerValor("R$ 800 a R$ 1.200")).toBe(1000);
    expect(lerValor("Até R$ 700,00")).toBe(700);
    expect(lerValor("acima_de_500_mil")).toBe(500000);
    expect(lerValor("2.500")).toBe(2500);
    expect(lerValor("1200.50")).toBe(1200.5);
    expect(lerValor("12x de R$ 500")).toBe(500);
    expect(lerValor(900)).toBe(900);
    expect(lerValor("não sei")).toBeNull();
    expect(lerValor("")).toBeNull();
  });

  it("bem pela palavra, com acento e maiúscula", () => {
    expect(lerBem("Imóvel")).toBe("imovel");
    expect(lerBem("CASA PRÓPRIA")).toBe("imovel");
    expect(lerBem("apartamento_na_planta")).toBe("imovel");
    expect(lerBem("Automóvel")).toBe("carro");
    expect(lerBem("Carro novo")).toBe("carro");
    expect(lerBem("Moto")).toBe("moto");
    expect(lerBem("Caminhão")).toBe("pesados");
    expect(lerBem("Máquinas agrícolas")).toBe("pesados");
    expect(lerBem("Viagem, Reforma")).toBe("servicos");
    expect(lerBem("Barco")).toBe("outros");
    expect(lerBem("")).toBeNull();
    // Toda chave que sai daqui existe nas regras do consórcio.
    const regra = REGRAS_DO_CONSORCIO.criterios.filter((c) => c.campo === "bem")[0] as any;
    for (const v of ["Imóvel", "Carro", "Moto", "Caminhão", "Serviços", "Barco"]) expect(Object.keys(regra.pontos)).toContain(lerBem(v));
  });

  it("prazo cai em uma das três chaves da regra", () => {
    expect(lerPrazo("Menos de 3 meses")).toEqual({ chave: "menos_de_3_meses", meses: 3 });
    expect(lerPrazo("até 3 meses")!.chave).toBe("menos_de_3_meses");
    expect(lerPrazo("De 3 a 12 meses")).toEqual({ chave: "de_3_a_12_meses", meses: 8 });
    expect(lerPrazo("de_3_a_12_meses")!.chave).toBe("de_3_a_12_meses");
    expect(lerPrazo("6 meses")).toEqual({ chave: "de_3_a_12_meses", meses: 6 });
    expect(lerPrazo("1 ano")!.chave).toBe("de_3_a_12_meses");
    expect(lerPrazo("mais_de_12_meses")!.chave).toBe("mais_de_12_meses");
    expect(lerPrazo("Mais de 1 ano")!.chave).toBe("mais_de_12_meses");
    expect(lerPrazo("1 a 2 anos")).toEqual({ chave: "mais_de_12_meses", meses: 18 });
    expect(lerPrazo("6 meses a 1 ano")!.chave).toBe("de_3_a_12_meses");
    expect(lerPrazo("30 dias")!.chave).toBe("menos_de_3_meses");
    expect(lerPrazo("Imediato")).toEqual({ chave: "menos_de_3_meses", meses: null });
    expect(lerPrazo("Sem pressa")!.chave).toBe("mais_de_12_meses");
    expect(lerPrazo("Médio prazo")!.chave).toBe("de_3_a_12_meses");
    expect(lerPrazo("depende")).toBeNull();
  });

  it("lance: sim, não ou o valor", () => {
    expect(lerLance("Sim")).toEqual({ chave: "sim", valor: null });
    expect(lerLance("sim,_tenho_fgts")).toEqual({ chave: "sim", valor: null });
    expect(lerLance("Não")).toEqual({ chave: "nao", valor: null });
    expect(lerLance("Não tenho")).toEqual({ chave: "nao", valor: null });
    expect(lerLance("Sem entrada")).toEqual({ chave: "nao", valor: null });
    expect(lerLance("Tenho R$ 20 mil")).toEqual({ chave: "sim", valor: 20000 });
    expect(lerLance("0")).toEqual({ chave: "nao", valor: null });
    expect(lerLance("talvez")).toBeNull();
  });

  it("a chave da pergunta própria sai sem acento, sem pontuação e sem começar por número", () => {
    expect(chaveDaResposta("Qual é a sua cidade?")).toBe("qual_e_a_sua_cidade");
    expect(chaveDaResposta("1. Você já tem consórcio?")).toBe("voce_ja_tem_consorcio");
    expect(chaveDaResposta("x".repeat(90)).length).toBe(40);
  });
});

describe("normalização das respostas do formulário (consórcio)", () => {
  const consorcio = { nicho: "consorcio" };

  it("formulário 1: as perguntas em português como a Meta entrega (chave com acento e interrogação)", () => {
    const r = normalizarLead(
      [
        campo("full_name", "Maria  Souza"),
        campo("phone_number", "+5547999991111"),
        campo("email", " Maria@Exemplo.com "),
        campo("qual_bem_você_quer?", "Imóvel"),
        campo("valor_da_carta", "R$ 100 a 200 mil"),
        campo("parcela_que_cabe_no_bolso", "R$ 1.200"),
        campo("em_quanto_tempo_pretende_usar?", "De 3 a 12 meses"),
        campo("tem_valor_para_lance_ou_entrada?", "Sim"),
      ],
      consorcio,
    );
    expect(r.nome).toBe("Maria Souza");
    expect(r.whatsapp).toBe("5547999991111");
    expect(r.email).toBe("maria@exemplo.com");
    expect(r.respostas).toEqual({ bem: "imovel", valor_carta: 150000, parcela: 1200, prazo: "de_3_a_12_meses", lance: "sim" });
    expect(r.campos).toEqual({ tipo_de_bem: "imovel", prazo_meses: 8 });
    expect(r.notas.split("\n")).toEqual(["Em quanto tempo pretende usar: De 3 a 12 meses", "Tem valor para lance ou entrada: Sim"]);
    expect(pontuar(r.respostas, REGRAS_DO_CONSORCIO)).toMatchObject({ nota: 83, faixa: "quente", forcouNutricao: false });
  });

  it("formulário 2: nome em duas partes, telefone sem o 55, perguntas em maiúsculas e respostas pela chave da opção", () => {
    const r = normalizarLead(
      [
        campo("first_name", "João"),
        campo("last_name", "Pereira"),
        campo("phone", "(47) 98888-2222"),
        campo("TIPO DE CARTA", "AUTOMÓVEL"),
        campo("Valor do crédito", "80k"),
        campo("Quanto pode pagar por mês?", "até R$ 700,00"),
        campo("Quando pretende comprar?", "mais_de_12_meses"),
        campo("Possui FGTS ou valor de entrada?", "Não tenho"),
      ],
      consorcio,
    );
    expect(r.nome).toBe("João Pereira");
    expect(r.whatsapp).toBe("5547988882222");
    expect(r.email).toBeNull();
    expect(r.respostas).toEqual({ bem: "carro", valor_carta: 80000, parcela: 700, prazo: "mais_de_12_meses", lance: "nao" });
    expect(r.campos).toEqual({ tipo_de_bem: "carro", prazo_meses: 12 });
    expect(pontuar(r.respostas, REGRAS_DO_CONSORCIO)).toMatchObject({ nota: 67, faixa: "quente" });
  });

  it("formulário 3: quer para já (nutrição), caminhão, lance em reais, renda e uma pergunta própria", () => {
    const r = normalizarLead(
      [
        campo("full_name", "Transportes Silva"),
        campo("phone_number", "+55 (47) 3333-4444"),
        campo("cidade", "Brusque"),
        campo("qual_o_bem?", "Caminhão"),
        campo("carta_de_crédito_desejada", "1,5 milhão"),
        campo("valor_da_parcela", "R$ 5.000 a R$ 7.000"),
        campo("para_quando_precisa_do_bem?", "Imediato"),
        campo("valor_de_lance", "Tenho R$ 200 mil"),
        campo("renda_mensal", "R$ 25.000,00"),
      ],
      consorcio,
    );
    expect(r.whatsapp).toBe("554733334444");
    expect(r.respostas).toEqual({ cidade: "brusque", bem: "pesados", valor_carta: 1500000, parcela: 6000, prazo: "menos_de_3_meses", lance: "sim", renda: 25000 });
    expect(r.campos).toEqual({ tipo_de_bem: "pesados", lance: 200000 });
    expect(r.notas).toContain("Cidade: Brusque");
    expect(r.notas).toContain("Renda mensal: R$ 25.000,00");
    const nota = pontuar(r.respostas, REGRAS_DO_CONSORCIO);
    expect(nota.faixa).toBe("frio");
    expect(nota.forcouNutricao).toBe(true);
  });

  it("formulário 4: telefone e e-mail inválidos não entram, resposta que não dá para ler fica só nas notas", () => {
    const r = normalizarLead(
      [
        campo("nome_completo", "  ana   lima "),
        campo("whatsapp", "123"),
        campo("e-mail", "ana@"),
        campo("Qual consórcio você procura?", "Moto"),
        campo("Valor", "de_20_mil_a_40_mil"),
        campo("Mensalidade", "300 a 500"),
        campo("Prazo", "6 meses"),
        campo("Lance", "talvez"),
      ],
      consorcio,
    );
    expect(r.nome).toBe("ana lima");
    expect(r.whatsapp).toBeNull();
    expect(r.email).toBeNull();
    // "talvez" não vira resposta: o robô do WhatsApp ainda pode perguntar do lance.
    expect(r.respostas).toEqual({ bem: "moto", valor_carta: 30000, parcela: 400, prazo: "de_3_a_12_meses" });
    expect(r.campos).toEqual({ tipo_de_bem: "moto", prazo_meses: 6 });
    expect(r.notas).toContain("Whatsapp: 123");
    expect(r.notas).toContain("E-mail: ana@");
    expect(r.notas).toContain("Lance: talvez");
    expect(pontuar(r.respostas, REGRAS_DO_CONSORCIO)).toMatchObject({ nota: 42, faixa: "morno" });
  });

  it("formulário 5: campos de trabalho da Meta, resposta de múltipla escolha e sem pressa", () => {
    const r = normalizarLead(
      [
        campo("full_name", "Carlos"),
        campo("work_phone_number", "047 3333-4444"),
        campo("work_email", "c@empresa.com.br"),
        campo("objetivo_do_consórcio", "Viagem", "Reforma"),
        campo("quanto_de_crédito_você_precisa?", "R$ 25.000"),
        campo("tem_urgência?", "Sem pressa"),
      ],
      consorcio,
    );
    expect(r.whatsapp).toBe("554733334444");
    expect(r.email).toBe("c@empresa.com.br");
    expect(r.respostas).toEqual({ bem: "servicos", valor_carta: 25000, prazo: "mais_de_12_meses" });
    expect(pontuar(r.respostas, REGRAS_DO_CONSORCIO)).toMatchObject({ nota: 35, faixa: "frio", forcouNutricao: false });
  });

  it("formulário 6: chaves curtas que o anunciante definiu e respostas pela chave da opção", () => {
    const r = normalizarLead(
      [campo("nome", "Bia Reis"), campo("telefone", "47 99777 6655"), campo("bem", "apartamento_na_planta"), campo("valor_carta", "acima_de_500_mil"), campo("parcela", "2.500"), campo("prazo", "1_a_2_anos"), campo("lance", "sim,_tenho_fgts")],
      consorcio,
    );
    expect(r.nome).toBe("Bia Reis");
    expect(r.whatsapp).toBe("5547997776655");
    expect(r.respostas).toEqual({ bem: "imovel", valor_carta: 500000, parcela: 2500, prazo: "mais_de_12_meses", lance: "sim" });
    expect(pontuar(r.respostas, REGRAS_DO_CONSORCIO)).toMatchObject({ nota: 100, faixa: "quente" });
  });

  it("as chaves e os valores de respostas casam com as regras do consórcio", () => {
    const r = normalizarLead(leadDeTeste({ nicho: "consorcio", faixa: "quente", agora: 1763100000000 }).lead.field_data, consorcio);
    for (const c of REGRAS_DO_CONSORCIO.criterios) {
      const v = r.respostas[c.campo];
      expect(v, c.campo).toBeDefined();
      if (c.tipo === "opcao") expect(Object.keys(c.pontos), c.campo).toContain(v);
      else expect(typeof v, c.campo).toBe("number");
    }
    // Com todas as respostas, a pontuação explica os cinco critérios.
    expect(pontuar(r.respostas, lerRegras({}, "consorcio")).motivos.length).toBe(5);
  });

  it("entrada estranha não derruba: sem lista, item sem nome, valor que não é texto", () => {
    expect(normalizarLead(null, consorcio)).toEqual({ nome: "", whatsapp: null, email: null, respostas: {}, campos: {}, notas: "" });
    const r = normalizarLead([null, 7, { name: "", values: ["x"] }, { name: "full_name" }, { name: "full_name", values: [null, { a: 1 }] }, { name: "email", values: "solto@exemplo.com" }, { name: "idade", values: [42] }], consorcio);
    expect(r).toEqual({ nome: "", whatsapp: null, email: "solto@exemplo.com", respostas: { idade: 42 }, campos: {}, notas: "Idade: 42" });
  });

  it("notas e respostas têm teto (o banco guarda até 16 KB por lead)", () => {
    const muitas = Array.from({ length: 60 }, (_, i) => campo(`pergunta própria número ${i} ${"x".repeat(80)}`, "resposta ".repeat(60)));
    const r = normalizarLead(muitas, consorcio);
    expect(r.notas.length).toBeLessThanOrEqual(1800);
    expect(Object.keys(r.respostas).length).toBeLessThanOrEqual(30);
    expect(JSON.stringify(dadosDoNegocio(r, { nota: 0, faixa: "frio", motivos: [] }, {})).length).toBeLessThan(12000);
  });
});

describe("normalização das respostas do formulário (outros ramos)", () => {
  it("formulário 7: imobiliária. Só nome, telefone e e-mail têm lugar; o resto vai para notas e respostas pela chave", () => {
    const r = normalizarLead(
      [
        campo("full_name", "Pedro Antunes"),
        campo("email", "pedro@exemplo.com"),
        campo("phone_number", "+5548991234567"),
        campo("qual_bairro_você_procura?", "Centro"),
        campo("valor_do_imóvel", "R$ 450.000"),
        campo("vai_financiar?", "Sim"),
        // Em outro ramo, "bem" e "lance" não são do consórcio: ficam como pergunta própria.
        campo("lance", "Sim"),
      ],
      { nicho: "imobiliaria" },
    );
    expect(r.nome).toBe("Pedro Antunes");
    expect(r.whatsapp).toBe("5548991234567");
    expect(r.email).toBe("pedro@exemplo.com");
    expect(r.respostas).toEqual({ qual_bairro_voce_procura: "centro", valor_do_imovel: 450000, vai_financiar: "sim", lance: "sim" });
    expect(r.campos).toEqual({});
    expect(r.notas.split("\n")).toEqual(["Qual bairro você procura: Centro", "Valor do imóvel: R$ 450.000", "Vai financiar: Sim", "Lance: Sim"]);
  });

  it("formulário 8: sem ramo, com as chaves das regras gerais (valor, prazo, decisor), a nota sai", () => {
    const r = normalizarLead([campo("nome", "Lia"), campo("celular", "11 91234-5678"), campo("valor", "R$ 8.000"), campo("prazo", "Este mês"), campo("decisor", "Sim")], {});
    expect(r.whatsapp).toBe("5511912345678");
    expect(r.respostas).toEqual({ valor: 8000, prazo: "este_mes", decisor: "sim" });
    expect(pontuar(r.respostas, REGRAS_GERAIS)).toMatchObject({ nota: 90, faixa: "quente" });
    expect(dadosDoNegocio(r, pontuar(r.respostas, REGRAS_GERAIS), {}).valor_avulso).toBe(8000);
  });
});

describe("o que vai para crm_meta_lead_criar", () => {
  it("contato, bem para o rodízio, carta como valor avulso, parcela como mensal, nota e origem", () => {
    const lead = normalizarLead(leadDeTeste({ nicho: "consorcio", faixa: "quente", bem: "carro", agora: 1763100000000 }).lead.field_data, { nicho: "consorcio" });
    const nota = pontuar(lead.respostas, REGRAS_DO_CONSORCIO);
    const d = dadosDoNegocio(lead, nota, { form_name: "Formulário carta", campaign_name: "Campanha" }) as any;
    expect(d.nome).toBe(lead.nome);
    expect(d.whatsapp).toMatch(/^55[0-9]{10,11}$/);
    expect(d.bem).toBe("carro");
    expect(d.valor_avulso).toBe(250000);
    expect(d.valor_mensal).toBe(1800);
    expect(d.campos.tipo_de_bem).toBe("carro");
    expect(d.nota).toBe(nota.nota);
    expect(d.faixa).toBe("quente");
    expect(d.motivos).toEqual(nota.motivos);
    expect(d.origem).toEqual({ form_name: "Formulário carta", campaign_name: "Campanha" });
    expect(d.respostas).toEqual(lead.respostas);
  });
});

describe("lead de teste do botão Simular lead", () => {
  it("consórcio: cada faixa pedida sai com as regras padrão, para qualquer bem", () => {
    for (const faixa of ["quente", "morno", "frio"] as const) {
      for (const bem of ["imovel", "carro", "moto", "pesados", "servicos", "outros"]) {
        const t = leadDeTeste({ nicho: "consorcio", faixa, bem, agora: 1763100000000 });
        const r = normalizarLead(t.lead.field_data, { nicho: "consorcio" });
        expect(r.respostas.bem, `${faixa} ${bem}`).toBe(bem);
        expect(pontuar(r.respostas, REGRAS_DO_CONSORCIO).faixa, `${faixa} ${bem}`).toBe(faixa);
      }
    }
  });

  it("outros ramos: cada faixa pedida sai com as regras gerais", () => {
    for (const faixa of ["quente", "morno", "frio"] as const) {
      const r = normalizarLead(leadDeTeste({ nicho: "saude", faixa, agora: 1763100000000 }).lead.field_data, { nicho: "saude" });
      expect(pontuar(r.respostas, REGRAS_GERAIS).faixa, faixa).toBe(faixa);
    }
  });

  it("o id não se confunde com um lead de verdade, cabe no banco e o contato muda a cada teste", () => {
    const a = leadDeTeste({ nicho: "consorcio", agora: 1763100000000 });
    const b = leadDeTeste({ nicho: "consorcio", agora: 1763100012345 });
    expect(a.aviso.leadgen_id).toMatch(/^[A-Za-z0-9_:-]{3,60}$/);
    expect(a.aviso.leadgen_id).not.toMatch(/^[0-9]+$/);
    expect(ehLeadDeTeste(a.aviso.leadgen_id)).toBe(true);
    expect(ehLeadDeTeste("1234567890123456")).toBe(false);
    expect(a.aviso.leadgen_id).not.toBe(b.aviso.leadgen_id);
    const ra = normalizarLead(a.lead.field_data, { nicho: "consorcio" });
    const rb = normalizarLead(b.lead.field_data, { nicho: "consorcio" });
    expect(ra.nome).toMatch(/^Teste /);
    expect(ra.whatsapp).toMatch(/^55479[0-9]{8}$/);
    expect(ra.whatsapp).not.toBe(rb.whatsapp);
    expect(ra.email).toMatch(/@exemplo\.com$/);
    expect(ra.email).not.toBe(rb.email);
    // Sem faixa pedida, sai quente; bem desconhecido cai em imóvel.
    expect(pontuar(ra.respostas, REGRAS_DO_CONSORCIO).faixa).toBe("quente");
    expect(normalizarLead(leadDeTeste({ nicho: "consorcio", bem: "???", agora: 1 }).lead.field_data, { nicho: "consorcio" }).respostas.bem).toBe("imovel");
  });
});

describe("eventos de conversão do lead do formulário da Meta", () => {
  const base: ConversaoDaFila = {
    id: "33333333-3333-3333-3333-333333333333",
    conta_id: "c",
    lead_id: "44444444-4444-4444-4444-444444444444",
    evento: "QualifiedLead",
    valor: 0,
    dados: { leadgen_id: "1234567890123456", plataforma: "facebook", form_id: "555666777888", formulario: "Formulário carta", utm_source: "meta", utm_medium: "lead_ads" },
    tentativas: 0,
    criado_em: "2026-11-14T12:00:00.000Z",
    nome: "Maria Souza",
    email: "maria@exemplo.com",
    whatsapp: "5547999991111",
  };
  const agora = new Date("2026-11-14T12:05:00.000Z").getTime();

  it("QualifiedLead: evento de CRM com o lead_id da Meta sem hash", async () => {
    const e = (await montarEventoDaMeta(base, agora)) as any;
    expect(e.event_name).toBe("QualifiedLead");
    expect(e.action_source).toBe("system_generated");
    expect(e.event_id).toBe(base.id);
    expect(e.event_time).toBe(Math.floor(new Date(base.criado_em).getTime() / 1000));
    expect(e.user_data.lead_id).toBe(1234567890123456);
    expect(e.custom_data.event_source).toBe("crm");
    expect(e.custom_data.lead_event_source).toBe("Aceleriq CRM");
    expect(e.custom_data.value).toBeUndefined();
    // O resto dos identificadores continua com hash; nada de navegador, IP ou página.
    expect(e.user_data.em).toEqual([await sha256Hex("maria@exemplo.com")]);
    expect(e.user_data.ph).toEqual([await sha256Hex("5547999991111")]);
    expect(e.user_data.client_user_agent).toBeUndefined();
    expect(e.event_source_url).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/maria@|99999/);
  });

  it("SimulationCompleted e Purchase levam o valor em reais e o mesmo lead_id", async () => {
    const simulacao = (await montarEventoDaMeta({ ...base, evento: "SimulationCompleted", valor: "250000.00" }, agora)) as any;
    expect(simulacao.event_name).toBe("SimulationCompleted");
    expect(simulacao.user_data.lead_id).toBe(1234567890123456);
    expect(simulacao.custom_data).toEqual({ currency: "BRL", value: 250000, event_source: "crm", lead_event_source: "Aceleriq CRM" });
    const venda = (await montarEventoDaMeta({ ...base, evento: "Purchase", valor: 180000 }, agora)) as any;
    expect(venda.event_name).toBe("Purchase");
    expect(venda.action_source).toBe("system_generated");
    expect(venda.user_data.lead_id).toBe(1234567890123456);
    expect(venda.custom_data).toEqual({ currency: "BRL", value: 180000, event_source: "crm", lead_event_source: "Aceleriq CRM" });
  });

  it("lead_id que não cabe como número inteiro vai como texto, sem perder dígito", async () => {
    const e = (await montarEventoDaMeta({ ...base, dados: { leadgen_id: "12345678901234567" } }, agora)) as any;
    expect(e.user_data.lead_id).toBe("12345678901234567");
    expect(JSON.stringify(e)).toContain("12345678901234567");
  });

  it("negócio que não veio do formulário da Meta continua no formato antigo, sem lead_id", async () => {
    const venda = (await montarEventoDaMeta({ ...base, evento: "Purchase", valor: 8000, dados: { fbclid: "IwAR0abcdefghij", clicado_em: "1763000000000" } }, agora)) as any;
    expect(venda.user_data.lead_id).toBeUndefined();
    expect(venda.user_data.fbc).toBe("fb.1.1763000000000.IwAR0abcdefghij");
    const lead = (await montarEventoDaMeta({ ...base, evento: "Lead", dados: { navegador: "Mozilla/5.0", pagina: "https://app.exemplo.com/f/abc" } }, agora)) as any;
    expect(lead.action_source).toBe("website");
    expect(lead.user_data.lead_id).toBeUndefined();
  });

  it("lead simulado pela tela não tem lead_id e é reconhecido para não ir à Meta", async () => {
    const id = leadDeTeste({ nicho: "consorcio", agora: 1763100000000 }).aviso.leadgen_id;
    expect(leadgenDaConversao({ leadgen_id: id })).toBe("");
    expect(conversaoDeTeste({ leadgen_id: id })).toBe(true);
    expect(conversaoDeTeste({ leadgen_id: "1234567890123456" })).toBe(false);
    expect(conversaoDeTeste({})).toBe(false);
    expect(conversaoDeTeste(null)).toBe(false);
    const e = (await montarEventoDaMeta({ ...base, dados: { leadgen_id: id } }, agora)) as any;
    expect(e.user_data.lead_id).toBeUndefined();
  });
});

describe("contratos dos arquivos", () => {
  it("a função do webhook não confere JWT (quem chama é a Meta) e o envio de conversões continua conferindo", () => {
    const config = ler("supabase/config.toml");
    expect(config).toMatch(/\[functions\.produto-meta\]\s+verify_jwt = false/);
    expect(config).toMatch(/\[functions\.produto-conversoes\]\s+verify_jwt = true/);
  });

  it("o arquivo compartilhado é puro e sem recurso que o Safari 11 não tem", () => {
    const codigo = ler("supabase/functions/_shared/meta-leads-do-crm.ts");
    expect(codigo).not.toMatch(/\(\?<[=!]/);
    expect(codigo).not.toMatch(/\\p\{/);
    expect(codigo).not.toMatch(/\.at\(/);
    expect(codigo).not.toMatch(/\?\.|\?\?/);
    expect(codigo).not.toMatch(/—/);
    expect(codigo).not.toMatch(/\bDeno\.|\bfetch\(|from "npm:|console\./);
  });

  it("o webhook confere a assinatura antes de tratar, não põe o token no endereço e não registra segredo", () => {
    const index = ler("supabase/functions/produto-meta/index.ts");
    expect(index.indexOf("assinaturaConfere(cru")).toBeGreaterThan(0);
    expect(index.indexOf("assinaturaConfere(cru")).toBeLessThan(index.indexOf("lerWebhook(corpo)"));
    expect(index).toContain("await req.arrayBuffer()");
    expect(index).not.toMatch(/access_token/);
    expect(index).toContain("Authorization: `Bearer ${token}`");
    for (const linha of index.split("\n").filter((l) => l.indexOf("console.") >= 0)) {
      expect(linha).not.toMatch(/app_secret|verify_token|integracao\.token\b(?! \|\|)|jwt/);
    }
    // A empresa vem só da chave do endereço; nada do corpo escolhe a conta.
    expect(index).not.toMatch(/corpo\.conta_id|pedido\.conta_id/);
    expect(index).toContain('{ ...integracao, modo: "teste" }');
  });

  it("as etapas do lead da Meta saem sem depender da lista de eventos, e lead de teste sai da fila", () => {
    const envio = ler("supabase/functions/produto-conversoes/index.ts");
    expect(envio).toContain('const SEMPRE_SAEM = ["QualifiedLead", "SimulationCompleted"]');
    expect(envio).toContain("SEMPRE_SAEM.indexOf(c.evento) < 0 && conexao.eventos.indexOf(c.evento) < 0");
    expect(envio).toContain("conversaoDeTeste(c.dados)");
  });
});

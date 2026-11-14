import { describe, expect, it } from "vitest";
import {
  PASSOS_DA_META,
  REGRAS_DO_CONSORCIO,
  REGRAS_GERAIS,
  TEMPLATES,
  TEMPLATES_SUGERIDOS,
  ajustarCortes,
  bensDasRegras,
  chaveDoTexto,
  conferir,
  destinoDoLead,
  ehOPadrao,
  enderecoDoWebhook,
  erroDasRegras,
  erroDoExpediente,
  faltaParaLigarDeVerdade,
  formatarExpediente,
  fraseDaSimulacao,
  idDaMetaValido,
  lerExpediente,
  lerFormularios,
  lerIntegracaoDoBanco,
  lerPrazos,
  lerRegras,
  lerSimulacao,
  limparWhatsapp,
  linhaDoSegredo,
  noExpediente,
  nomeDaFaixaDeValor,
  nomeDaOpcao,
  nomeDeTemplateValido,
  pontuar,
  prazoLegivel,
  respostasDeExemplo,
  segredoPareceValido,
  simularNota,
  situacaoDaIntegracao,
  whatsappLegivel,
  whatsappValido,
  type Vendedor,
} from "@/lib/produto/integracoes";
import { templatesNecessarios } from "../../supabase/functions/_shared/whatsapp-do-crm";

/**
 * Leads da Meta e WhatsApp (14/11/2026): as contas que a tela faz sozinha.
 * O que não pode quebrar sem ninguém ver: o segredo nunca entra no que a tela
 * guarda, a conferência para ligar de verdade é a mesma do banco e a nota do
 * simulador é a do servidor (o mesmo `pontuar`).
 */

const CHAVE = "0123456789abcdef0123456789abcdef";
const VAZIA = lerIntegracaoDoBanco(null);
const CONECTADA = lerIntegracaoDoBanco({
  existe: true,
  ativo: true,
  modo: "real",
  webhook_chave: CHAVE,
  verify_token: "abc123abc123abc123abc123",
  pagina_id: "123456789012345",
  formularios: ["111112222233333"],
  tem_app_secret: true,
  tem_token: true,
  token_final: "9ZxQ",
  wa_phone_id: "555554444433333",
  wa_waba_id: "999998888877777",
  tem_wa_token: false,
  templates: { lead: "crm_boas_vindas", outro: "x", vendedor: "" },
  followup_horas: [24, 72],
  numeros: { leads_7_dias: "12", na_fila: 2, em_nutricao: 3, envios_pendentes: 1, envios_com_erro: 0 },
});

const vendedor = (p: Partial<Vendedor>): Vendedor => ({
  membro_id: "m1", user_id: "u1", nome: "Ana", papel: "usuario", cargo: "", estado: "ativo", recebe_leads: true, bens: [], expediente: {}, whatsapp: "5541999990000", no_expediente: true, ultimo_lead_em: null, ...p,
});

describe("a conexão lida do banco", () => {
  it("nasce desligada e em teste, sem endereço", () => {
    expect(VAZIA.existe).toBe(false);
    expect(VAZIA.ativo).toBe(false);
    expect(VAZIA.modo).toBe("teste");
    expect(VAZIA.webhook_chave).toBeNull();
    expect(VAZIA.followup_horas).toEqual([]);
    expect(VAZIA.numeros.leads_7_dias).toBe(0);
    expect(situacaoDaIntegracao(VAZIA)).toBe("desligada");
  });

  it("converte números e descarta template desconhecido ou vazio", () => {
    expect(CONECTADA.numeros.leads_7_dias).toBe(12);
    expect(CONECTADA.templates).toEqual({ lead: "crm_boas_vindas" });
    expect(situacaoDaIntegracao(CONECTADA)).toBe("real");
    expect(situacaoDaIntegracao({ ativo: true, modo: "teste" })).toBe("teste");
    expect(situacaoDaIntegracao({ ativo: false, modo: "real" })).toBe("desligada");
  });

  it("não guarda segredo nenhum, mesmo que o banco mandasse", () => {
    const i = lerIntegracaoDoBanco({ token: "EAAGsegredoMuitoLongo123456", app_secret: "abcdef0123456789abcdef", wa_token: "EAAGoutro1234567890", tem_token: true, token_final: "3456" });
    const texto = JSON.stringify(i);
    expect(texto).not.toContain("EAAG");
    expect(texto).not.toContain("abcdef0123456789abcdef");
    expect(Object.keys(i)).not.toContain("token");
    expect(Object.keys(i)).not.toContain("app_secret");
    expect(Object.keys(i)).not.toContain("wa_token");
  });
});

describe("endereço do webhook", () => {
  it("monta com a chave da empresa na função produto-meta", () => {
    expect(enderecoDoWebhook(CHAVE, "https://x.supabase.co/functions/v1")).toBe(`https://x.supabase.co/functions/v1/produto-meta/${CHAVE}`);
    expect(enderecoDoWebhook(CHAVE)).toBe(`https://ci-placeholder.supabase.co/functions/v1/produto-meta/${CHAVE}`);
  });

  it("sem chave válida não inventa endereço", () => {
    expect(enderecoDoWebhook(null)).toBe("");
    expect(enderecoDoWebhook("simular")).toBe("");
    expect(enderecoDoWebhook("../outra")).toBe("");
  });
});

describe("o que falta para ligar de verdade", () => {
  it("vazia: faltam os três da Meta (a regra do banco)", () => {
    expect(faltaParaLigarDeVerdade(VAZIA).map((x) => x.chave)).toEqual(["pagina", "token", "segredo"]);
    expect(conferir(VAZIA).every((x) => !x.feito)).toBe(true);
  });

  it("conectada: nada impede; o token da Meta serve para o WhatsApp", () => {
    expect(faltaParaLigarDeVerdade(CONECTADA)).toEqual([]);
    const itens = conferir(CONECTADA);
    expect(itens.filter((x) => x.chave === "wa_token")[0].feito).toBe(true);
    // Só o de boas-vindas não basta: o aviso ao vendedor também é template.
    expect(itens.filter((x) => x.chave === "template")[0].feito).toBe(false);
    expect(conferir({ ...CONECTADA, templates: { lead: "crm_boas_vindas", vendedor: "crm_aviso_vendedor" } }).filter((x) => x.chave === "template")[0].feito).toBe(true);
    expect(itens.filter((x) => x.obrigatorio).every((x) => x.parte === "meta")).toBe(true);
  });

  it("vendedores só entram na lista depois de lidos", () => {
    expect(conferir(CONECTADA).some((x) => x.parte === "vendedores")).toBe(false);
    const sem = conferir(CONECTADA, []);
    expect(sem.filter((x) => x.chave === "vendedor")[0].feito).toBe(false);
    expect(sem.filter((x) => x.chave === "aviso")[0].feito).toBe(false);
    const com = conferir(CONECTADA, [vendedor({}), vendedor({ membro_id: "m2", whatsapp: null })]);
    expect(com.filter((x) => x.chave === "vendedor")[0].feito).toBe(true);
    expect(com.filter((x) => x.chave === "aviso")[0].feito).toBe(false);
    // Convidado e quem não recebe não contam.
    expect(conferir(CONECTADA, [vendedor({ user_id: null, estado: "convidado" }), vendedor({ recebe_leads: false })]).filter((x) => x.chave === "vendedor")[0].feito).toBe(false);
  });
});

describe("segredos e identificadores", () => {
  it("o segredo salvo vira uma linha, nunca o valor", () => {
    expect(linhaDoSegredo(true, "9ZxQ")).toBe("Salvo, termina em 9ZxQ");
    expect(linhaDoSegredo(true, null)).toBe("Salvo no cofre");
    expect(linhaDoSegredo(false, "9ZxQ")).toBe("");
  });

  it("confere o que foi colado como o banco confere", () => {
    expect(segredoPareceValido("EAAGm0PX4ZCpsBAKZC_abc.def|123-x")).toBe(true);
    expect(segredoPareceValido("curto")).toBe(false);
    expect(segredoPareceValido("tem espaco no meio 1234567890")).toBe(false);
    expect(idDaMetaValido("123456789012345")).toBe(true);
    expect(idDaMetaValido("")).toBe(true);
    expect(idDaMetaValido("12ab")).toBe(false);
    expect(nomeDeTemplateValido("crm_boas_vindas")).toBe(true);
    expect(nomeDeTemplateValido("Boas Vindas")).toBe(false);
  });

  it("lê os formulários aceitos sem repetir e só com números", () => {
    expect(lerFormularios("111112222233333, 111112222233333\n44444555556666 ; abc 12")).toEqual(["111112222233333", "44444555556666"]);
    expect(lerFormularios("")).toEqual([]);
  });

  it("prazos de follow-up: de 1 a 240 h, em ordem, no máximo três", () => {
    expect(lerPrazos(["72", "24", "", "abc", "0", "999"])).toEqual([24, 72]);
    expect(lerPrazos([48, 24, 24, 120, 6])).toEqual([6, 24, 48]);
    expect(prazoLegivel(24)).toBe("24 h");
    expect(prazoLegivel(72)).toBe("3 dias");
  });
});

describe("expediente", () => {
  it("vazio ou incompleto é sempre", () => {
    expect(formatarExpediente({})).toBe("Sempre");
    expect(formatarExpediente(null)).toBe("Sempre");
    expect(formatarExpediente({ inicio: "09:00" })).toBe("Sempre");
    expect(lerExpediente({ inicio: "9h", fim: "18:00" })).toEqual({});
  });

  it("escreve os dias de um jeito que se lê", () => {
    expect(formatarExpediente({ dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00" })).toBe("Seg a sex, 09:00 às 18:00");
    expect(formatarExpediente({ dias: [6, 1, 3], inicio: "08:00", fim: "12:00" })).toBe("Seg, qua e sáb, 08:00 às 12:00");
    expect(formatarExpediente({ dias: [6, 7], inicio: "10:00", fim: "14:00" })).toBe("Sáb e dom, 10:00 às 14:00");
    expect(formatarExpediente({ dias: [], inicio: "08:00", fim: "20:00" })).toBe("Todos os dias, 08:00 às 20:00");
    expect(formatarExpediente({ dias: [1, 2, 3, 4, 5, 6, 7], inicio: "08:00", fim: "20:00" })).toBe("Todos os dias, 08:00 às 20:00");
  });

  it("recusa o que o banco recusaria", () => {
    expect(erroDoExpediente({})).toBeNull();
    expect(erroDoExpediente({ dias: [1], inicio: "09:00", fim: "18:00" })).toBeNull();
    expect(erroDoExpediente({ inicio: "18:00", fim: "09:00" })).toMatch(/depois/);
    expect(erroDoExpediente({ inicio: "09:00" })).toMatch(/início e o fim/);
  });

  it("no expediente agora, no horário de Brasília (a conta do banco)", () => {
    const util = { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00" };
    // 13/11/2026 é sexta. 15:00 UTC = 12:00 em Brasília.
    expect(noExpediente(util, new Date("2026-11-13T15:00:00Z"))).toBe(true);
    // 21:00 UTC = 18:00 em Brasília: o fim não entra.
    expect(noExpediente(util, new Date("2026-11-13T21:00:00Z"))).toBe(false);
    // 02:00 UTC de sábado ainda é sexta 23:00 em Brasília: fora do horário.
    expect(noExpediente(util, new Date("2026-11-14T02:00:00Z"))).toBe(false);
    // Sábado ao meio-dia: fora dos dias.
    expect(noExpediente(util, new Date("2026-11-14T15:00:00Z"))).toBe(false);
    expect(noExpediente({}, new Date("2026-11-14T15:00:00Z"))).toBe(true);
  });

  it("WhatsApp do vendedor: só números, com país", () => {
    expect(limparWhatsapp("(41) 99999-0000")).toBe("5541999990000");
    expect(limparWhatsapp("+55 41 99999-0000")).toBe("5541999990000");
    expect(whatsappValido("41 99999-0000")).toBe(true);
    expect(whatsappValido("")).toBe(true);
    expect(whatsappValido("9999")).toBe(false);
    expect(whatsappLegivel("5541999990000")).toBe("+55 41 99999-0000");
    expect(whatsappLegivel(null)).toBe("");
  });
});

describe("pontuação na tela", () => {
  it("a nota simulada é a do servidor, com o máximo e o que falta responder", () => {
    const respostas = { bem: "imovel", valor_carta: 200000, parcela: 2500, prazo: "mais_de_12_meses", lance: "sim" };
    const s = simularNota(respostas, REGRAS_DO_CONSORCIO);
    expect(s.nota).toBe(pontuar(respostas, REGRAS_DO_CONSORCIO).nota);
    expect(s.nota).toBe(100);
    expect(s.faixa).toBe("quente");
    expect(s.maximo).toBe(100);
    expect(s.semResposta).toEqual([]);
    const vazio = simularNota({}, REGRAS_DO_CONSORCIO);
    expect(vazio.nota).toBe(40);
    expect(vazio.faixa).toBe("morno");
    expect(vazio.motivos).toEqual(["Sem respostas para pontuar ainda"]);
    expect(vazio.semResposta.length).toBe(REGRAS_DO_CONSORCIO.criterios.length);
  });

  it("resposta marcada para a nutrição esfria qualquer nota", () => {
    const s = simularNota({ bem: "imovel", valor_carta: 200000, parcela: 2500, prazo: "menos_de_3_meses", lance: "sim" }, REGRAS_DO_CONSORCIO);
    expect(s.forcouNutricao).toBe(true);
    expect(s.faixa).toBe("frio");
    expect(s.motivos.join(" ")).toContain("nutrição");
  });

  it("os exemplos caem na faixa pedida, nos dois padrões", () => {
    for (const regras of [REGRAS_DO_CONSORCIO, REGRAS_GERAIS]) {
      for (const faixa of ["quente", "morno", "frio"] as const) {
        expect(pontuar(respostasDeExemplo(regras, faixa), regras).faixa, faixa).toBe(faixa);
      }
    }
  });

  it("os bens das etiquetas do vendedor saem das regras", () => {
    expect(bensDasRegras(REGRAS_DO_CONSORCIO)).toEqual(["imovel", "carro", "moto", "pesados", "servicos", "outros"]);
    expect(bensDasRegras(REGRAS_GERAIS)).toEqual([]);
  });

  it("nomes que o dono lê", () => {
    expect(nomeDaOpcao("imovel")).toBe("Imóvel");
    expect(nomeDaOpcao("nao")).toBe("Não");
    expect(nomeDaOpcao("menos_de_3_meses")).toBe("Menos de 3 meses");
    expect(chaveDoTexto("  Renda Mensal (R$) ")).toBe("renda_mensal_r");
    expect(chaveDoTexto("Já é cliente?")).toBe("ja_e_cliente");
    const faixas = [{ ate: 40000, pontos: 5 }, { ate: 150000, pontos: 12 }, { pontos: 20 }];
    expect(nomeDaFaixaDeValor(faixas, 0)).toBe("Até 40.000");
    expect(nomeDaFaixaDeValor(faixas, 1)).toBe("De 40.001 a 150.000");
    expect(nomeDaFaixaDeValor(faixas, 2)).toBe("Acima de 150.000");
  });

  it("os cortes nunca se cruzam", () => {
    expect(ajustarCortes({ quente: 65, morno: 40 }, "quente")).toEqual({ quente: 65, morno: 40 });
    expect(ajustarCortes({ quente: 30, morno: 40 }, "quente")).toEqual({ quente: 30, morno: 29 });
    expect(ajustarCortes({ quente: 65, morno: 80 }, "morno")).toEqual({ quente: 81, morno: 80 });
    expect(ajustarCortes({ quente: 500, morno: -3 }, "quente")).toEqual({ quente: 100, morno: 0 });
  });

  it("sabe quando é o padrão do ramo e quando deixou de ser", () => {
    expect(ehOPadrao(REGRAS_DO_CONSORCIO, "consorcio")).toBe(true);
    expect(ehOPadrao(REGRAS_DO_CONSORCIO, "imobiliaria")).toBe(false);
    expect(ehOPadrao(lerRegras({}, "consorcio"), "consorcio")).toBe(true);
    expect(ehOPadrao({ ...REGRAS_DO_CONSORCIO, cortes: { quente: 70, morno: 40 } }, "consorcio")).toBe(false);
  });

  it("não deixa salvar regra que não pontua", () => {
    expect(erroDasRegras(REGRAS_DO_CONSORCIO)).toBeNull();
    expect(erroDasRegras({ criterios: [], cortes: { quente: 65, morno: 40 } })).toMatch(/pelo menos um/);
    expect(erroDasRegras({ criterios: [{ tipo: "opcao", campo: "x", rotulo: "X", pontos: { sim: 0 } }], cortes: { quente: 65, morno: 40 } })).toMatch(/pontos/);
    const repetido = REGRAS_DO_CONSORCIO.criterios.concat([REGRAS_DO_CONSORCIO.criterios[0]]);
    expect(erroDasRegras({ criterios: repetido, cortes: { quente: 65, morno: 40 } })).toMatch(/diferente/);
  });
});

describe("atividade e simulador", () => {
  it("diz para onde o lead foi", () => {
    const base = { situacao: "criado" as const, vendedor: null, fila_desde: null, nutricao: false, erro: null };
    expect(destinoDoLead({ ...base, vendedor: "Ana" })).toBe("Ana");
    expect(destinoDoLead({ ...base, fila_desde: "2026-11-13T12:00:00Z" })).toBe("Na fila");
    expect(destinoDoLead({ ...base, nutricao: true })).toBe("Nutrição");
    expect(destinoDoLead({ ...base, situacao: "erro", erro: "Token recusado" })).toBe("Token recusado");
    expect(destinoDoLead({ ...base, situacao: "repetido" })).toBe("Já estava no funil");
  });

  it("lê a resposta do simulador em qualquer formato razoável", () => {
    expect(lerSimulacao({ nota: 82, faixa: "quente", vendedor: { nome: "Ana" }, na_fila: false })).toEqual({ nome: null, nota: 82, faixa: "quente", vendedor: "Ana", na_fila: false, nutricao: false });
    expect(lerSimulacao({ resultado: { nota: 20, faixa: "frio", nutricao: true } }).nutricao).toBe(true);
    expect(lerSimulacao(null)).toEqual({ nome: null, nota: null, faixa: null, vendedor: null, na_fila: false, nutricao: false });
    expect(fraseDaSimulacao(lerSimulacao({ nota: 82, faixa: "quente", vendedor: "Ana" }))).toBe("Lead quente, nota 82. Foi para Ana.");
    expect(fraseDaSimulacao(lerSimulacao({ nota: 50, faixa: "morno", na_fila: true }))).toBe("Lead morno, nota 50. Ninguém no expediente: ficou na fila.");
    expect(fraseDaSimulacao(lerSimulacao({}))).toBe("Lead de teste criado.");
  });
});

describe("textos da tela", () => {
  const tudo = PASSOS_DA_META.concat(TEMPLATES_SUGERIDOS.map((t) => `${t.rotulo} ${t.texto} ${t.variaveis.join(" ")}`)).join("\n");

  it("a lista de templates é a do servidor (mesmo nome, texto e botões)", () => {
    const doServidor = templatesNecessarios();
    expect(TEMPLATES_SUGERIDOS.map((t) => [t.chave, t.nome, t.texto, t.botoes])).toEqual(doServidor.map((t) => [t.chave, t.nome, t.corpo, t.botoes]));
    expect(TEMPLATES_SUGERIDOS.filter((t) => t.chave === "vendedor")[0].botoes.length).toBe(4);
  });

  it("um template sugerido para cada mensagem, com as variáveis numeradas em ordem", () => {
    expect(TEMPLATES_SUGERIDOS.map((t) => t.chave)).toEqual(Array.from(TEMPLATES));
    for (const t of TEMPLATES_SUGERIDOS) {
      expect(nomeDeTemplateValido(t.nome), t.nome).toBe(true);
      const usadas = (t.texto.match(/\{\{\d+\}\}/g) || []).map((v) => Number(v.replace(/\D/g, "")));
      expect(usadas, t.chave).toEqual(t.variaveis.map((_, n) => n + 1));
      expect(t.texto.length, t.chave).toBeLessThanOrEqual(1024);
    }
  });

  it("o passo a passo fala do campo leadgen e das permissões de leads", () => {
    expect(tudo).toContain("leadgen");
    expect(tudo).toContain("leads_retrieval");
    expect(PASSOS_DA_META.length).toBeLessThanOrEqual(7);
  });

  it("sem travessão e sem emoji", () => {
    expect(tudo).not.toMatch(/[—–]/);
    expect(tudo).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
  });
});

import { describe, expect, it } from "vitest";
import {
  blocoDoTipo,
  comBloco,
  conteudoDoModelo,
  hashDaProposta,
  MODELO_PADRAO_ACELERIQ,
  normalizarItens,
  totaisDosItens,
} from "../../supabase/functions/_shared/proposta-modelo";
import {
  ajustarPelaMargem,
  aplicarValoresNoConteudo,
  avisosDosPacotes,
  barrasDoCronograma,
  blocoDasProvas,
  camposDaProposta,
  camposDoBloco,
  comparativoDosPacotes,
  corDoTextoSobre,
  custoDaHora,
  custosDoFinanceiro,
  diferencasDoConteudo,
  diferencasDosItens,
  esquemaDoTom,
  followupDaProposta,
  itemDoServico,
  itensDoPacote,
  lerHeadlines,
  lerMargem,
  lerPacotesDoJev,
  margemDosItens,
  mensagemDoFollowup,
  mesclarPorChaves,
  nomeSeguroDeArquivo,
  normalizarAnexos,
  normalizarPacotes,
  normalizarPagamento,
  normalizarParametros,
  normalizarProva,
  normalizarServico,
  normalizarVisual,
  notasDoResumo,
  pacotesDasEscolhas,
  pacotesParaGravar,
  parametrosComFinanceiro,
  perguntasDosPacotes,
  precoDaHora,
  precoPorHoras,
  provaPodeEntrar,
  resumoDosPacotes,
  semanasDoMarco,
  textoDaOpcao,
  valorDaOpcao,
  valoresDasChaves,
} from "../../supabase/functions/_shared/proposta-comercial";

/**
 * Frente PRO2: as regras novas da proposta, sem banco nem IA. Biblioteca,
 * hora técnica ligada ao Financeiro, 3 pacotes, pagamento, provas com
 * autorização, visual, anexos, cronograma, follow-up, comparar versões e o
 * "Preencher com IA" (campos, aplicar e desfazer).
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const PARAMETROS = normalizarParametros({ custos_fixos_mes: 9000, pro_labore_mes: 6000, horas_produtivas_mes: 100, impostos_pct: 6, margem_pct: 24 });

describe("biblioteca de serviços", () => {
  it("serviço precisa de nome e preço; mensal pela unidade; vira item com o preço da biblioteca", () => {
    expect(normalizarServico({ nome: "", preco: 10 })).toBeNull();
    expect(normalizarServico({ nome: "Site", preco: "x" })).toBeNull();
    const s = normalizarServico({ id: "22222222-2222-4222-8222-222222222222", nome: "Gestão de redes", preco: 1800, unidade: "mes", horas: 20, entregaveis: ["12 posts", "", "4 reels"] })!;
    expect(s.recorrencia).toBe("mensal");
    expect(s.entregaveis).toEqual(["12 posts", "4 reels"]);
    const item = itemDoServico(s, 2, "b1");
    expect(item).toMatchObject({ id: "b1", nome: "Gestão de redes", quantidade: 2, valor_unitario: 1800, recorrencia: "mensal", origem: "servico", horas: 20, biblioteca_id: s.id });
  });

  it("item antigo continua igual (horas e biblioteca só entram quando existem) e o hash de proposta antiga não muda", async () => {
    const [velho] = normalizarItens([{ id: "i1", nome: "Site", valor_unitario: 4000 }]);
    expect(Object.keys(velho)).not.toContain("horas");
    expect(Object.keys(velho)).not.toContain("biblioteca_id");
    const c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    const semNada = await hashDaProposta({ conteudo: c, itens: [velho], validade_ate: "2026-10-15" });
    const comVazios = await hashDaProposta({ conteudo: c, itens: [velho], validade_ate: "2026-10-15", pacotes: {}, pagamento: undefined, anexos: [] });
    expect(comVazios).toBe(semNada);
    const comPagamento = await hashDaProposta({ conteudo: c, itens: [velho], validade_ate: "2026-10-15", pagamento: normalizarPagamento({ opcoes: [{ tipo: "a_vista", desconto_pct: 5 }] }) });
    expect(comPagamento).not.toBe(semNada);
  });
});

describe("hora técnica ligada ao Financeiro", () => {
  it("soma as regras de saída ativas no valor mensal; pró-labore à parte; entrada e vencida ficam de fora", () => {
    const f = custosDoFinanceiro(
      [
        { direction: "expense", kind: "fixed_cost", amount: 3000, frequency: "monthly", is_active: true },
        { direction: "expense", kind: "fixed_cost", amount: 12000, frequency: "annual", is_active: true },
        { direction: "expense", kind: "pro_labore", amount: 6000, frequency: "monthly", is_active: true },
        { direction: "income", kind: "recurring", amount: 9999, frequency: "monthly", is_active: true },
        { direction: "expense", kind: "fixed_cost", amount: 500, frequency: "monthly", is_active: false },
        { direction: "expense", kind: "fixed_cost", amount: 700, frequency: "monthly", is_active: true, ends_on: "2026-01-31" },
      ],
      "2026-09-30",
    );
    expect(f).toEqual({ custos_fixos_mes: 4000, pro_labore_mes: 6000, regras: 3 });
    // Sem regra de pró-labore no Financeiro, fica o digitado.
    const p = parametrosComFinanceiro(normalizarParametros({ pro_labore_mes: 5000 }), { custos_fixos_mes: 4000, pro_labore_mes: 0, regras: 1 });
    expect(p.custos_fixos_mes).toBe(4000);
    expect(p.pro_labore_mes).toBe(5000);
  });

  it("custo da hora, preço com impostos e margem, e preço de um trabalho arredondado para cima", () => {
    expect(custoDaHora(PARAMETROS)).toBe(150);
    expect(precoDaHora(PARAMETROS)).toBe(214.29);
    expect(precoPorHoras(10, PARAMETROS)).toBe(2150);
    expect(normalizarParametros({ margem_pct: 200, impostos_pct: -3, horas_produtivas_mes: 0 })).toMatchObject({ margem_pct: 80, impostos_pct: 0, horas_produtivas_mes: 1 });
  });

  it("margem real dos itens com horas; ajuste pela margem pedida muda só quem tem horas", () => {
    const itens = normalizarItens([
      { id: "a", nome: "Site", valor_unitario: 4000, horas: 20 },
      { id: "b", nome: "Hospedagem", valor_unitario: 300 },
    ]);
    const m = margemDosItens(itens, PARAMETROS);
    expect(m.itens_com_horas).toBe(1);
    expect(m.itens_sem_horas).toBe(1);
    expect(m.margem_pct).toBe(19);
    const r = ajustarPelaMargem(itens, PARAMETROS, 34);
    expect(r.mudados).toEqual([{ id: "a", nome: "Site", antes: 4000, depois: 5000 }]);
    expect(r.sem_horas).toEqual(["Hospedagem"]);
    expect(r.itens.find((i) => i.id === "b")!.valor_unitario).toBe(300);
    expect(margemDosItens(r.itens, PARAMETROS).margem_pct).toBe(34);
  });

  it("lê a margem como a equipe escreve", () => {
    expect(lerMargem("30%")).toBe(30);
    expect(lerMargem("margem de 35")).toBe(35);
    expect(lerMargem("0,4")).toBe(40);
    expect(lerMargem("90")).toBeNull();
    expect(lerMargem("sem número")).toBeNull();
  });
});

describe("três pacotes", () => {
  const itens = normalizarItens([
    { id: "a", nome: "Identidade", valor_unitario: 3000 },
    { id: "b", nome: "Site", valor_unitario: 4000 },
    { id: "c", nome: "Gestão de redes", valor_unitario: 1800, recorrencia: "mensal" },
  ]);
  const pacotes = { ativo: true, niveis: { a: "essencial", b: "recomendado", c: "completo" }, destaque: "recomendado" };

  it("são cumulativos pelo nível de cada item; item sem nível entra no essencial", () => {
    const p = normalizarPacotes(pacotes, itens);
    expect(itensDoPacote(itens, p, "essencial").map((i) => i.id)).toEqual(["a"]);
    expect(itensDoPacote(itens, p, "recomendado").map((i) => i.id)).toEqual(["a", "b"]);
    expect(itensDoPacote(itens, p, "completo").map((i) => i.id)).toEqual(["a", "b", "c"]);
    const r = resumoDosPacotes(itens, pacotes);
    expect(r.map((x) => [x.nivel, x.totais.unico, x.totais.mensal, x.destaque])).toEqual([
      ["essencial", 3000, 0, false],
      ["recomendado", 7000, 0, true],
      ["completo", 7000, 1800, false],
    ]);
    expect(normalizarPacotes({ ativo: true }, itens).niveis).toEqual({ a: "essencial", b: "essencial", c: "essencial" });
  });

  it("comparativo por item, avisos quando dois pacotes são iguais, e desligado não vai para o hash", () => {
    expect(comparativoDosPacotes(itens, pacotes)[1]).toEqual({ id: "b", nome: "Site", em: { essencial: false, recomendado: true, completo: true } });
    expect(avisosDosPacotes(itens, pacotes)).toEqual([]);
    expect(avisosDosPacotes(itens, { ativo: true })).toEqual(expect.arrayContaining(["Essencial e Recomendado têm os mesmos itens."]));
    expect(resumoDosPacotes(itens, { ...pacotes, ativo: false })).toEqual([]);
    expect(pacotesParaGravar({ ...pacotes, ativo: false }, itens)).toEqual({});
  });

  it("Jev: uma Choice por serviço sobre o mesmo estado, com a opção 'fora'", () => {
    const candidatos = [
      { id: "a", nome: "Identidade", descricao: "", preco: 3000, recorrencia: "unico" as const },
      { id: "33333333-3333-4333-8333-333333333333", nome: "Tráfego pago", descricao: "Gestão de anúncios", preco: 2000, recorrencia: "mensal" as const },
    ];
    const pedido = perguntasDosPacotes(candidatos, { cliente: "Loja da Joana", objetivo: "Vender mais pelo Instagram", material: "A cliente quer uma marca nova." });
    expect(Object.keys(pedido.questions)).toEqual(["s0", "s1"]);
    expect(pedido.questions.s1.type).toBe("choice");
    expect(Object.keys(pedido.questions.s1.criteria)).toEqual(["essencial", "recomendado", "completo", "fora"]);
    expect(JSON.stringify(pedido.questions.s1.instructions)).toContain("`servicos[1]`");
    expect((pedido.state as { servicos: Array<{ preco: string }> }).servicos[1].preco).toBe("R$ 2.000,00");
    const lidos = lerPacotesDoJev(candidatos, { s0: { choice: "essencial", confidence: 0.9 }, s1: { choice: "completo", confidence: 0.6 } });
    expect(lidos.sem_resposta).toBe(0);
    const r = pacotesDasEscolhas([itens[0]], lidos.escolhas, {});
    expect(r.pacotes.ativo).toBe(true);
    expect(r.entraram).toEqual(["Tráfego pago"]);
    const novo = r.itens.find((i) => i.nome === "Tráfego pago")!;
    expect(novo.valor_unitario).toBe(2000);
    expect(novo.biblioteca_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(r.pacotes.niveis[novo.id]).toBe("completo");
    // Sem resposta do Jev: fica de fora e conta.
    expect(lerPacotesDoJev(candidatos, null).sem_resposta).toBe(2);
  });
});

describe("pagamento", () => {
  const t = totaisDosItens(normalizarItens([{ nome: "Site", valor_unitario: 6000 }, { nome: "Redes", valor_unitario: 1500, recorrencia: "mensal" }]));

  it("à vista com desconto só no único; parcelado com e sem entrada; mensal", () => {
    const [vista, parcelado, entrada, mensal] = normalizarPagamento({
      opcoes: [
        { tipo: "a_vista", desconto_pct: 5 },
        { tipo: "parcelado", parcelas: 3 },
        { id: "entrada", tipo: "parcelado", parcelas: 4, entrada_pct: 25 },
        { tipo: "mensal" },
        { tipo: "invalido" },
      ],
    }).opcoes;
    expect(valorDaOpcao(vista, t).total_unico).toBe(5700);
    expect(textoDaOpcao(vista, t)).toBe("À vista com 5% de desconto: R$ 5.700,00 + R$ 1.500,00 por mês");
    expect(textoDaOpcao(parcelado, t)).toBe("Parcelado: 3x de R$ 2.000,00 + R$ 1.500,00 por mês");
    expect(valorDaOpcao(entrada, t)).toMatchObject({ entrada: 1500, parcelas: 3, parcela: 1500 });
    expect(textoDaOpcao(mensal, t)).toBe("Mensal: R$ 1.500,00 por mês, com R$ 6.000,00 na implantação");
    expect(normalizarPagamento({ opcoes: [{ tipo: "parcelado", parcelas: 99, desconto_pct: 90 }] }).opcoes[0]).toMatchObject({ parcelas: 24, desconto_pct: 50 });
  });
});

describe("provas com autorização", () => {
  it("só entra o que tem autorização registrada; o resto volta contado", () => {
    const ok = normalizarProva({ tipo: "case", titulo: "Loja X", texto: "Marca nova", autorizado: true, autorizacao: "e-mail da Ana em 12/09" });
    const semRegistro = normalizarProva({ tipo: "depoimento", nome: "Bia", texto: "Ótimo trabalho", autorizado: true, autorizacao: "" });
    const naoAutorizado = normalizarProva({ tipo: "depoimento", nome: "Caio", cargo: "Sócio", empresa: "Caio ME", texto: "Recomendo", autorizado: false });
    expect(normalizarProva({ tipo: "depoimento", nome: "Sem texto" })).toBeNull();
    expect(provaPodeEntrar(ok)).toBe(true);
    expect(provaPodeEntrar(semRegistro)).toBe(false);
    const r = blocoDasProvas([ok, semRegistro, naoAutorizado]);
    expect(r.dados.cases).toEqual([{ titulo: "Loja X", texto: "Marca nova", link: "" }]);
    expect(r.dados.depoimentos).toEqual([]);
    expect(r.sem_autorizacao).toBe(2);
  });
});

describe("visual, anexos e cronograma", () => {
  it("tema do cliente só com cor; hex curto vira longo; texto legível sobre a cor", () => {
    expect(normalizarVisual({ tema: "cliente", cores: [] }).tema).toBe("aceleriq");
    expect(normalizarVisual({ tema: "cliente", cores: [{ hex: "#F0A" }, "nada", "#112233"] })).toEqual({ tema: "cliente", cores: ["#ff00aa", "#112233"] });
    expect(normalizarVisual({ tema: "inventado" }).tema).toBe("aceleriq");
    expect(corDoTextoSobre("#ffffff")).toBe("#0b0d0c");
    expect(corDoTextoSobre("#101010")).toBe("#ffffff");
  });

  it("anexo: link http(s) ou arquivo na pasta de propostas do cliente; nome de arquivo seguro", () => {
    const a = normalizarAnexos(
      [
        { id: "1", tipo: "link", titulo: "Portfólio", url: "https://behance.net/x" },
        { id: "2", tipo: "link", url: "javascript:alert(1)" },
        { id: "3", tipo: "arquivo", titulo: "Apresentação", caminho: `${CLIENTE}/propostas/p1/deck.pdf` },
        { id: "4", tipo: "arquivo", caminho: `outro/propostas/p1/deck.pdf` },
        { id: "5", tipo: "arquivo", caminho: `${CLIENTE}/propostas/../segredo.pdf` },
      ],
      CLIENTE,
    );
    expect(a.map((x) => x.id)).toEqual(["1", "3"]);
    expect(nomeSeguroDeArquivo("Apresentação Final (v2).PDF")).toBe("apresentacao-final-v2-.pdf");
  });

  it("semanas lidas do marco viram barras na linha do tempo", () => {
    expect(semanasDoMarco("Semana 1")).toEqual({ inicio: 1, fim: 1 });
    expect(semanasDoMarco("semanas 2 a 4")).toEqual({ inicio: 2, fim: 4 });
    expect(semanasDoMarco("sem 3-5")).toEqual({ inicio: 3, fim: 5 });
    expect(semanasDoMarco("depois da aprovação")).toBeNull();
    const g = barrasDoCronograma([
      { titulo: "Kickoff", quando: "semana 1" },
      { titulo: "Criação", quando: "semanas 2 a 3" },
      { titulo: "Entrega", quando: "semana 4" },
      { titulo: "Suporte", quando: "depois" },
    ]);
    expect(g.total_semanas).toBe(4);
    expect(g.barras[1]).toMatchObject({ esquerda: 25, largura: 50 });
    expect(g.barras[3].esquerda).toBeNull();
  });
});

describe("follow-up", () => {
  const base = { status: "vista", enviada_em: "2026-09-20T12:00:00Z", vista_em: "2026-09-25T12:00:00Z", validade_ate: "2026-10-20", ultimo_followup_em: null };

  it("vista sem resposta, não aberta e vencendo; espera 3 dias depois do último; fechada não lembra", () => {
    expect(followupDaProposta(base, "2026-09-26")).toBeNull();
    expect(followupDaProposta(base, "2026-09-28")).toMatchObject({ situacao: "viu_sem_resposta", dias: 3 });
    expect(followupDaProposta({ ...base, status: "enviada", vista_em: null }, "2026-09-23")).toMatchObject({ situacao: "nao_abriu", dias: 3 });
    expect(followupDaProposta({ ...base, validade_ate: "2026-09-29" }, "2026-09-28")).toMatchObject({ situacao: "vence_logo", dias: 1 });
    expect(followupDaProposta({ ...base, ultimo_followup_em: "2026-09-27T10:00:00Z" }, "2026-09-28")).toBeNull();
    expect(followupDaProposta({ ...base, ultimo_followup_em: "2026-09-24T10:00:00Z" }, "2026-09-28")).not.toBeNull();
    for (const status of ["aceita", "recusada", "rascunho", "expirada"]) expect(followupDaProposta({ ...base, status }, "2026-09-28")).toBeNull();
  });

  it("mensagem pronta com o primeiro nome e o link, sem travessão", () => {
    const m = mensagemDoFollowup({ contato: "Joana Lima", titulo: "Redes", link: "https://x.test/proposta/abc", validade: "2026-10-20", situacao: "viu_sem_resposta" });
    expect(m).toContain("Oi, Joana.");
    expect(m).toContain("https://x.test/proposta/abc");
    expect(m).not.toMatch(/[—–]/);
    expect(mensagemDoFollowup({ contato: "", titulo: "Redes", link: "L", validade: "2026-10-20", situacao: "vence_logo" })).toContain("20/10/2026");
  });
});

describe("Preencher com IA e comparar versões", () => {
  const c = comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "Mais pedidos pelo Instagram", subtitulo: "", projeto: "Redes" } });

  it("campos por bloco: mercado, provas e quem somos ficam de fora; a regra do número vai na dica", () => {
    const chaves = camposDaProposta(c).map((x) => x.chave);
    expect(chaves).toContain("capa.headline");
    expect(chaves).toContain("processo.etapas");
    expect(chaves.some((k) => /^(mercado|provas|quem_somos)\./.test(k))).toBe(false);
    expect(camposDoBloco(blocoDoTipo(c, "capa"))[0].dica).toMatch(/Nunca invente número/);
    const tom = esquemaDoTom(camposDoBloco(blocoDoTipo(c, "processo")));
    expect(tom.schema.properties).toEqual({ etapas: { type: "array", items: { type: "string" } } });
  });

  it("aplicar valores por chave, com a régua do número sem origem; desfazer com os valores de antes", () => {
    const r = aplicarValoresNoConteudo(
      c,
      {
        "capa.subtitulo": "Uma marca que vende sozinha",
        "processo.etapas": ["Imersão | Conversa com o time", "Entrega | Arquivos finais"],
        "desafio.texto": "A loja vende pouco. As vendas vão subir 300% em 2 meses.",
        "mercado.resumo": "não entra",
        "chave.estranha": "x",
      },
      "notas da reunião sem números",
    );
    expect(blocoDoTipo(r.conteudo, "capa").dados.subtitulo).toBe("Uma marca que vende sozinha");
    expect(blocoDoTipo(r.conteudo, "processo").dados.etapas).toEqual([
      { titulo: "Imersão", texto: "Conversa com o time" },
      { titulo: "Entrega", texto: "Arquivos finais" },
    ]);
    expect(blocoDoTipo(r.conteudo, "desafio").dados.texto).toBe("A loja vende pouco.");
    expect(r.tiradas.length).toBe(1);
    expect(blocoDoTipo(r.conteudo, "mercado").dados.resumo).toBe("");
    const antes = valoresDasChaves(c, ["capa.subtitulo"]);
    expect(blocoDoTipo(aplicarValoresNoConteudo(r.conteudo, antes).conteudo, "capa").dados.subtitulo).toBe("");
  });

  it("diferenças campo a campo (vazio marcado) e aplicar só as escolhidas", () => {
    const proposto = aplicarValoresNoConteudo(c, { "capa.subtitulo": "Novo subtítulo", "capa.headline": "Outra headline" }).conteudo;
    const d = diferencasDoConteudo(c, proposto);
    expect(d.map((x) => [x.chave, x.estava_vazio])).toEqual([
      ["capa.headline", false],
      ["capa.subtitulo", true],
    ]);
    const so = mesclarPorChaves(c, proposto, ["capa.subtitulo"]);
    expect(blocoDoTipo(so, "capa").dados).toMatchObject({ headline: "Mais pedidos pelo Instagram", subtitulo: "Novo subtítulo" });
    const oculto = comBloco(c, "processo", { visivel: false });
    expect(diferencasDoConteudo(c, oculto).map((x) => x.chave)).toEqual(["processo.visivel"]);
  });

  it("itens entre versões: entrou, mudou e saiu", () => {
    const a = normalizarItens([{ id: "1", nome: "Site", valor_unitario: 4000 }, { id: "2", nome: "Logo", valor_unitario: 1500 }]);
    const b = normalizarItens([{ id: "1", nome: "Site", valor_unitario: 4500 }, { id: "3", nome: "Redes", valor_unitario: 1800 }]);
    expect(diferencasDosItens(a, b)).toEqual(["Mudou: Site (1 x R$ 4.000,00 para 1 x R$ 4.500,00)", "Entrou: Redes (1 x R$ 1.800,00)", "Saiu: Logo"]);
  });

  it("resumo da reunião em notas sem número inventado; headlines sem número e sem repetir", () => {
    const origem = "A Joana disse que fatura 20 mil por mês e quer lançar em novembro.";
    const r = notasDoResumo({ objetivo: "Lançar a marca nova", dores: ["Vende pouco", "Cresce 50% ao ano"], pedidos: ["Site"], prazos: ["novembro"], orcamento_citado: "", decisores: ["Joana"], falas: ["fatura 20 mil por mês"], pendencias: [] }, origem);
    expect(r.notas).toContain("Objetivo: Lançar a marca nova");
    expect(r.notas).toContain("- fatura 20 mil por mês");
    expect(r.notas).not.toContain("50%");
    expect(r.tiradas.length).toBe(1);
    expect(lerHeadlines({ opcoes: ["Sua marca pronta para vender.", "Sua marca pronta para vender", "300% mais vendas já", "Clientes novos toda semana"] }, "")).toEqual(["Sua marca pronta para vender", "Clientes novos toda semana"]);
  });
});

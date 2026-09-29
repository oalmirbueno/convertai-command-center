import { describe, expect, it } from "vitest";
import {
  aplicarGeracao,
  blocoDoTipo,
  blocosParaMostrar,
  comBloco,
  conteudoDoModelo,
  conteudoSemNumeroInventado,
  hashDaProposta,
  lerValor,
  mensagemDoWhatsApp,
  MODELO_PADRAO_ACELERIQ,
  modeloDaProposta,
  motivoParaNaoAceitar,
  normalizarConteudo,
  normalizarItens,
  numeroDaProposta,
  numerosDoTexto,
  pendenciasDaProposta,
  reais,
  somarDias,
  statusEfetivo,
  textoDoEmail,
  textoDoTotal,
  TIPOS_DE_BLOCO,
  totaisDosItens,
  validarAceite,
  validadeVencida,
  hojeEmSaoPaulo,
} from "../../supabase/functions/_shared/proposta-modelo";

const FONTE = { titulo: "Pesquisa setorial", url: "https://exemplo.org/pesquisa", data: "2026-08" };

describe("blocos da proposta", () => {
  it("o conteúdo tem sempre os 12 blocos na ordem, um de cada, e ignora tipo estranho", () => {
    const c = normalizarConteudo({ blocos: [{ tipo: "investimento", dados: {} }, { tipo: "capa", dados: { headline: "Mais clientes pelo Instagram" } }, { tipo: "invasor" }, { tipo: "capa", dados: { headline: "repetida" } }] });
    expect(c.blocos.map((b) => b.tipo)).toEqual([...TIPOS_DE_BLOCO]);
    expect(blocoDoTipo(c, "capa").dados.headline).toBe("Mais clientes pelo Instagram");
  });

  it("o modelo padrão da Aceleriq monta as condições, o processo e os próximos passos, sem travessão", () => {
    const c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    expect(blocoDoTipo(c, "investimento").dados.condicoes).toContain("50%");
    expect(blocoDoTipo(c, "processo").dados.etapas).toHaveLength(4);
    expect(JSON.stringify(c)).not.toMatch(/[—–]/);
  });

  it("bloco oculto ou vazio não aparece na página; capa, investimento e próximos passos sempre aparecem", () => {
    let c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    c = comBloco(c, "processo", { visivel: false });
    const tipos = blocosParaMostrar(c).map((b) => b.tipo);
    expect(tipos).not.toContain("processo");
    expect(tipos).not.toContain("mercado");
    expect(tipos).toContain("capa");
    expect(tipos).toContain("investimento");
    expect(tipos).toContain("proximos_passos");
  });

  it("o texto perde o travessão ao normalizar", () => {
    const c = normalizarConteudo({ blocos: [{ tipo: "solucao", dados: { texto: "Marca forte — vendas previsíveis" } }] });
    expect(blocoDoTipo(c, "solucao").dados.texto).toBe("Marca forte, vendas previsíveis");
  });

  it("salvar como modelo leva a estrutura e os textos da agência, não o texto do cliente", () => {
    let c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    c = comBloco(c, "desafio", { dados: { texto: "A loja da Maria vende pouco", palavras_do_cliente: ["ninguém me acha"], compromisso: "Compromisso" } });
    const m = modeloDaProposta(c, "Identidade", 10);
    const desafio = m.blocos.find((b) => b.tipo === "desafio")!;
    expect(desafio.dados).toEqual({ compromisso: "Compromisso" });
    expect(m.validade_dias).toBe(10);
  });
});

describe("preço a partir dos itens", () => {
  it("lê o valor como a equipe escreve", () => {
    expect(lerValor("1.500,00")).toBe(1500);
    expect(lerValor("R$ 2 mil")).toBe(2000);
    expect(lerValor("4,5k")).toBe(4500);
    expect(lerValor("1500.5")).toBe(1500.5);
    expect(lerValor("abc")).toBeNull();
    expect(lerValor("-3")).toBeNull();
  });

  it("soma único e mensal separados, com quantidade, e escreve em reais", () => {
    const itens = normalizarItens([
      { nome: "Identidade visual", valor_unitario: 4500, quantidade: 1, recorrencia: "unico" },
      { nome: "Gestão de redes", valor_unitario: "1.800,00", quantidade: 1, recorrencia: "mensal" },
      { nome: "Post extra", valor_unitario: 150, quantidade: 4, recorrencia: "unico" },
      { nome: "", valor_unitario: 10 },
      { nome: "Sem valor", valor_unitario: "x" },
    ]);
    expect(itens).toHaveLength(3);
    const t = totaisDosItens(itens);
    expect(t).toEqual({ unico: 5100, mensal: 1800, itens: 3 });
    expect(reais(5100)).toBe("R$ 5.100,00");
    expect(textoDoTotal(t)).toBe("R$ 5.100,00 + R$ 1.800,00 por mês");
  });

  it("ids repetidos de item ganham sufixo (Desfazer e remover não se misturam)", () => {
    const itens = normalizarItens([{ id: "a", nome: "Um", valor_unitario: 1 }, { id: "a", nome: "Dois", valor_unitario: 2 }]);
    expect(itens.map((i) => i.id)).toEqual(["a", "a-2"]);
  });
});

describe("validade e status", () => {
  it("vence no dia seguinte à validade (dia de São Paulo)", () => {
    expect(validadeVencida("2026-10-10", "2026-10-10")).toBe(false);
    expect(validadeVencida("2026-10-10", "2026-10-11")).toBe(true);
    expect(somarDias("2026-09-30", 15)).toBe("2026-10-15");
    // 01:00 UTC do dia 1 ainda é dia 30 em São Paulo.
    expect(hojeEmSaoPaulo(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09-30");
  });

  it("enviada ou vista depois da validade é expirada; aceita continua aceita", () => {
    expect(statusEfetivo("enviada", "2026-09-01", "2026-09-30")).toBe("expirada");
    expect(statusEfetivo("vista", "2026-09-01", "2026-09-30")).toBe("expirada");
    expect(statusEfetivo("aceita", "2026-09-01", "2026-09-30")).toBe("aceita");
    expect(statusEfetivo("qualquer", null, "2026-09-30")).toBe("rascunho");
  });

  it("só aceita o que foi enviado e está na validade", () => {
    expect(motivoParaNaoAceitar({ status: "enviada", validade_ate: "2026-10-15" }, "2026-10-01")).toBeNull();
    expect(motivoParaNaoAceitar({ status: "vista", validade_ate: "2026-10-15" }, "2026-10-15")).toBeNull();
    expect(motivoParaNaoAceitar({ status: "vista", validade_ate: "2026-10-15" }, "2026-10-16")).toMatch(/validade/);
    expect(motivoParaNaoAceitar({ status: "rascunho", validade_ate: "2026-10-15" }, "2026-10-01")).toMatch(/não foi enviada/);
    expect(motivoParaNaoAceitar({ status: "aceita", validade_ate: "2026-10-15" }, "2026-10-01")).toMatch(/já foi aceita/);
  });

  it("o aceite pede nome, e-mail válido e a caixa marcada", () => {
    expect(validarAceite({ nome: "Jo", email: "a@b.co", aceito: true })).toMatch(/nome/);
    expect(validarAceite({ nome: "Joana Lima", email: "joana@", aceito: true })).toMatch(/e-mail/);
    expect(validarAceite({ nome: "Joana Lima", email: "joana@loja.com.br", aceito: false })).toMatch(/caixa/);
    expect(validarAceite({ nome: "Joana Lima", email: "joana@loja.com.br", aceito: true })).toBeNull();
  });

  it("número da proposta com o ano e 3 dígitos", () => {
    expect(numeroDaProposta(2026, 7)).toBe("2026-007");
  });

  it("pendências: sem itens e sem headline bloqueiam; sem reunião só avisa", () => {
    const c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    const p = pendenciasDaProposta({ conteudo: c, itens: [], validade_ate: "2026-10-15", contexto: {} }, "2026-10-01");
    expect(p.filter((x) => x.bloqueia).map((x) => x.chave).sort()).toEqual(["headline", "itens"]);
    expect(p.find((x) => x.chave === "reuniao")!.bloqueia).toBe(false);
    const vencida = pendenciasDaProposta({ conteudo: c, itens: [], validade_ate: "2026-09-01", contexto: {} }, "2026-10-01");
    expect(vencida.find((x) => x.chave === "validade")!.bloqueia).toBe(true);
  });

  it("o hash muda quando muda o texto enviado", async () => {
    const c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    const itens = normalizarItens([{ nome: "Site", valor_unitario: 4000 }]);
    const h1 = await hashDaProposta({ conteudo: c, itens, validade_ate: "2026-10-15" });
    const h2 = await hashDaProposta({ conteudo: c, itens, validade_ate: "2026-10-15" });
    const h3 = await hashDaProposta({ conteudo: c, itens: normalizarItens([{ nome: "Site", valor_unitario: 4100 }]), validade_ate: "2026-10-15" });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("mensagens de envio com o link e a validade, sem travessão", () => {
    const w = mensagemDoWhatsApp({ contato: "Joana Lima", titulo: "Identidade visual", link: "https://painel/proposta/abc", validade: "2026-10-15" });
    expect(w).toContain("Oi, Joana.");
    expect(w).toContain("https://painel/proposta/abc");
    expect(w).toContain("15/10/2026");
    expect(w).not.toMatch(/[—–]/);
    expect(textoDoEmail({ contato: "", titulo: "Site", link: "https://x/proposta/1", validade: null })).toContain("Aceitar");
  });
});

describe("o agente não inventa número (modelo falso)", () => {
  const origem = "Transcrição: a cliente disse que vende 40 peças por mês e quer chegar a 60. Orçamento de 5 mil.";

  it("conta como número o que é afirmação (porcentagem, dinheiro, milhar), não ano nem contagem pequena", () => {
    expect(numerosDoTexto("Em 2026, 3 frentes")).toEqual([]);
    expect(numerosDoTexto("88% das marcas e R$ 3 mil")).toEqual(["88%", "R$ 3 mil"]);
  });

  it("dado de mercado sem fonte sai; com fonte fica; achado com número inventado vira pergunta; número da reunião fica", () => {
    const atual = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    const doModeloFalso = {
      capa: { headline: "Venda 3x mais em 30 dias", subtitulo: "Sua loja no topo", projeto: "Redes" },
      desafio: { texto: "Hoje a loja vende 40 peças por mês. A meta é chegar a 60. O mercado cresce 35% ao ano.", palavras_do_cliente: ["ninguém me acha no Instagram"], compromisso: "Nosso compromisso é método." },
      diagnostico: {
        achados: [
          { titulo: "Perfil parado", texto: "O perfil não posta há semanas.", fonte: null },
          { titulo: "Concorrência", texto: "Os concorrentes faturam 2 milhões por ano.", fonte: null },
          { titulo: "Busca local", texto: "72% buscam no Google Maps.", fonte: FONTE },
        ],
      },
      mercado: {
        resumo: "Mercado local competitivo.",
        concorrentes: [
          { nome: "Loja A", faz_bem: "fotos", oportunidade: "atendimento", fonte: FONTE },
          { nome: "Loja Inventada", faz_bem: "tudo", oportunidade: "nada", fonte: { titulo: "", url: "", data: "" } },
        ],
        dados: [
          { rotulo: "Consumidores que pesquisam online", valor: "64%", fonte: FONTE, trecho: "64% pesquisam online" },
          { rotulo: "Crescimento do setor", valor: "18%", fonte: { titulo: "blog", url: "blog sem link", data: "ontem" }, trecho: "" },
        ],
        faixa_de_preco: { texto: "De R$ 1.500 a R$ 4.000 por mês", fonte: { titulo: "", url: "", data: "" } },
      },
      solucao: { texto: "Vamos organizar o perfil.", frentes: [] },
      entregaveis: { itens: [], nao_inclui: [] },
      processo: { etapas: [] },
      cronograma: { marcos: [], observacao: "" },
      investimento: { intangiveis: ["Estratégia"], condicoes: "", observacao: "" },
      proximos_passos: { passos: ["Aceite"], chamada: "Vamos?" },
      perguntas: ["Qual o prazo desejado?"],
      resumo: "Proposta escrita.",
    };
    const r = aplicarGeracao(atual, doModeloFalso, origem, { hoje: "2026-09-30" });
    const capa = blocoDoTipo(r.conteudo, "capa").dados;
    const desafio = blocoDoTipo(r.conteudo, "desafio").dados;
    const diag = blocoDoTipo(r.conteudo, "diagnostico").dados;
    const mercado = blocoDoTipo(r.conteudo, "mercado").dados;
    // "3x" e "30 dias" não estão no material: a headline inventada sai.
    expect(capa.headline).toBe("");
    // Número da reunião (40 e 60) fica; o 35% inventado sai.
    expect(desafio.texto).toContain("40 peças");
    expect(desafio.texto).toContain("60");
    expect(desafio.texto).not.toContain("35%");
    expect(diag.achados.map((a) => a.titulo)).toEqual(["Perfil parado", "Busca local"]);
    expect(mercado.dados.map((d) => d.valor)).toEqual(["64%"]);
    expect(mercado.concorrentes.map((c) => c.nome)).toEqual(["Loja A"]);
    expect(mercado.faixa_de_preco).toBeNull();
    expect(mercado.pesquisado_em).toBe("2026-09-30");
    // Condição vazia do modelo: fica a do dono.
    expect(blocoDoTipo(r.conteudo, "investimento").dados.condicoes).toContain("50%");
    // O que saiu vira pergunta ("confirme ou mande a fonte").
    expect(r.tiradas.join(" ")).toContain("35%");
    expect(r.tiradas.join(" ")).toContain("2 milhões");
    expect(r.tiradas.join(" ")).toContain("Loja Inventada");
    expect(r.perguntas[0]).toBe("Qual o prazo desejado?");
    expect(r.perguntas.some((p) => p.indexOf("Confirme ou mande a fonte") === 0)).toBe(true);
  });

  it("a pesquisa mexe só no mercado; provas e quem somos nunca vêm do modelo", () => {
    let atual = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    atual = comBloco(atual, "capa", { dados: { headline: "Headline da equipe", subtitulo: "", projeto: "" } });
    const r = aplicarGeracao(atual, { capa: { headline: "Outra", subtitulo: "", projeto: "" }, mercado: { resumo: "Resumo", concorrentes: [], dados: [], faixa_de_preco: null }, provas: { cases: [{ titulo: "Case inventado" }] } }, "", { somente: ["mercado"], hoje: "2026-09-30" });
    expect(blocoDoTipo(r.conteudo, "capa").dados.headline).toBe("Headline da equipe");
    expect(blocoDoTipo(r.conteudo, "mercado").dados.resumo).toBe("Resumo");
    expect(blocoDoTipo(r.conteudo, "provas").dados.cases).toEqual([]);
  });

  it("a régua também serve de aviso na Revisão (número digitado sem origem)", () => {
    let c = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    c = comBloco(c, "solucao", { dados: { texto: "Vamos dobrar o alcance. Resultado de 200% garantido.", frentes: [] } });
    expect(conteudoSemNumeroInventado(c, "").tiradas).toEqual(["Resultado de 200% garantido."]);
  });
});

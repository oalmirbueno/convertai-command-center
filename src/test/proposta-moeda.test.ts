// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  aplicarGeracao,
  blocoDoTipo,
  conteudoDoModelo,
  dinheiro,
  modeloDaProposta,
  moedaDoConteudo,
  normalizarModelo,
  reais,
  textoDoTotal,
  type DadosDoBloco,
} from "../../supabase/functions/_shared/proposta-modelo";
import { textoDaOpcao, type OpcaoDePagamento } from "../../supabase/functions/_shared/proposta-comercial";
import { normalizarProposta } from "@/components/mesa-proposta/propostaApi";

/**
 * Moeda na Mesa Proposta (26/10/2026): a proposta para cliente no exterior
 * escreve os valores em dólar ou euro. A moeda mora no bloco de investimento
 * do modelo, vai para a proposta criada dele e volta para o modelo salvo da
 * proposta. Sem moeda, tudo continua em reais.
 */

const MODELO_EXTERIOR = normalizarModelo({
  nome: "Exterior (dólar e euro)",
  validade_dias: 7,
  condicoes: "Transferência internacional.",
  blocos: [
    { tipo: "capa", titulo: "Capa", visivel: true, dados: {} },
    { tipo: "investimento", titulo: "Investimento", visivel: true, dados: { moeda: "USD", observacao: "Valores em dólar americano." } },
  ],
});

const T = { unico: 297, mensal: 497, itens: 2 };

describe("proposta: moeda", () => {
  it("formata em real, dólar e euro com a escrita brasileira", () => {
    expect(dinheiro(1234.5)).toBe("R$ 1.234,50");
    expect(reais(1234.5)).toBe("R$ 1.234,50");
    expect(dinheiro(1234.5, "USD")).toBe("US$ 1.234,50");
    expect(dinheiro(447, "EUR")).toBe("€ 447,00");
  });

  it("o total e as opções de pagamento saem na moeda da proposta, e em reais por padrão", () => {
    expect(textoDoTotal(T)).toBe("R$ 297,00 + R$ 497,00 por mês");
    expect(textoDoTotal(T, "USD")).toBe("US$ 297,00 + US$ 497,00 por mês");
    const mensal: OpcaoDePagamento = { id: "m", tipo: "mensal", desconto_pct: 0, entrada_pct: 0, parcelas: 1, observacao: "" };
    expect(textoDaOpcao(mensal, T, "USD")).toBe("Mensal: US$ 497,00 por mês, com US$ 297,00 na implantação");
    expect(textoDaOpcao(mensal, T)).toBe("Mensal: R$ 497,00 por mês, com R$ 297,00 na implantação");
  });

  it("a moeda vem do modelo, fica na proposta e volta ao salvar como modelo", () => {
    const conteudo = conteudoDoModelo(MODELO_EXTERIOR);
    expect(moedaDoConteudo(conteudo)).toBe("USD");
    const de_volta = modeloDaProposta(conteudo, "Cópia", 7);
    const inv = de_volta.blocos.find((b) => b.tipo === "investimento")!;
    expect((inv.dados as DadosDoBloco["investimento"]).moeda).toBe("USD");
  });

  it("a geração por IA não troca nem apaga a moeda do dono", () => {
    const conteudo = conteudoDoModelo(MODELO_EXTERIOR);
    const r = aplicarGeracao(conteudo, { investimento: { intangiveis: ["Painel"], condicoes: "", observacao: "", moeda: "BRL" } }, "", { somente: ["investimento"] });
    expect((blocoDoTipo(r.conteudo, "investimento").dados as DadosDoBloco["investimento"]).moeda).toBe("USD");
  });

  it("moeda inválida ou ausente vira real, e proposta antiga continua igual", () => {
    const sem = conteudoDoModelo(normalizarModelo({ nome: "x", blocos: [{ tipo: "investimento", titulo: "Investimento", visivel: true, dados: { moeda: "JPY" } }] }));
    expect(moedaDoConteudo(sem)).toBe("BRL");
    expect("moeda" in blocoDoTipo(sem, "investimento").dados).toBe(false);
  });

  it("a proposta da tela carrega a moeda", () => {
    const p = normalizarProposta({ id: "p1", client_id: "c1", conteudo: conteudoDoModelo(MODELO_EXTERIOR), itens: [] });
    expect(p && p.moeda).toBe("USD");
    const br = normalizarProposta({ id: "p2", client_id: "c1", conteudo: { blocos: [] }, itens: [] });
    expect(br && br.moeda).toBe("BRL");
  });
});

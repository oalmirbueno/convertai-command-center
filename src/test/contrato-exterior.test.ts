// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extensoNaMoeda,
  formatarValor,
  lerMoeda,
  montarContrato,
  moedaNoContrato,
  podeCongelar,
  SERVICOS_DO_CONTRATO,
  SERVICOS_RECORRENTES,
  valoresComPadrao,
  valoresDoCliente,
  variaveisDoContrato,
  type DadosDaAgencia,
  type ServicoDoContrato,
  type Valores,
} from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-v1";
import { MODELOS_EXTRAS_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-extras-v1";
import { BLOCO_EXTERIOR_V1, MODELOS_EXTERIOR_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-exterior-v1";
import { servicosPorPalavras } from "../../supabase/functions/contratos/regras";

/**
 * Serviço "Cliente no exterior" (26/10/2026): bloco bilíngue, valores do
 * contrato inteiro em dólar ou euro com o extenso na mesma moeda, entrada no
 * quadro-resumo e documento do país no lugar do CPF/CNPJ.
 */

const MODELOS = [...MODELOS_V1, ...MODELOS_EXTRAS_V1, ...MODELOS_EXTERIOR_V1];

const AGENCIA: DadosDaAgencia = {
  razao_social: "Aceleriq Marketing Ltda",
  nome_fantasia: "Aceleriq",
  cnpj: "12.345.678/0001-90",
  endereco: "Rua das Flores, 100, Bacacheri",
  cidade: "Curitiba",
  uf: "PR",
  representante: "Almir Bueno",
  representante_cpf: "",
  email: "contato@aceleriq.com.br",
  foro: "Curitiba/PR",
};

function completos(servicos: ServicoDoContrato[], extra: Valores = {}): Valores {
  const base: Valores = {
    ...valoresDoCliente({ nome: "Carla Cleaning LLC", documento: "EIN 12-3456789", endereco: "100 Main St, Kissimmee, FL", email: "carla@carlacleaning.com", representante: "Carla Souza" }),
    inicio: "2026-11-03",
    valor_hora_extra: "40",
    valor_mensal: "497",
    vencimento_dia: "10",
    vigencia_meses: "12",
    ext_pais: "Estados Unidos, Kissimmee (FL)",
    ext_conta_anuncios: "act_0000000000",
    forma_pagamento: "transferência internacional",
    ...extra,
  };
  return valoresComPadrao(variaveisDoContrato(MODELOS, servicos), base);
}

const montar = (servicos: ServicoDoContrato[], valores: Valores) =>
  montarContrato({ modelos: MODELOS, servicos, valores, agencia: AGENCIA, numero: "CT-2026-0100", versao: 1, data: "2026-10-26" });

describe("contrato: cliente no exterior", () => {
  it("é um serviço mensal da lista, com direitos e padrões do bloco", () => {
    expect(SERVICOS_DO_CONTRATO).toContain("exterior");
    expect(SERVICOS_RECORRENTES).toContain("exterior");
    expect(BLOCO_EXTERIOR_V1.chave).toBe("bloco_exterior");
    const nomes = variaveisDoContrato(MODELOS, ["exterior"]).map((v) => v.nome);
    expect(nomes).toEqual(expect.arrayContaining(["ext_moeda", "ext_valor_entrada", "valor_mensal", "vencimento_dia", "direitos_exterior"]));
    const v = completos(["exterior"]);
    expect(v.ext_moeda).toBe("USD");
    expect(v.ext_valor_entrada).toBe("297");
  });

  it("escreve os valores em dólar, com o extenso em dólar, e a entrada no quadro-resumo", () => {
    const m = montar(["exterior"], completos(["exterior"]));
    expect(m.texto).toContain("Entrada: US$ 297,00 (duzentos e noventa e sete dólares americanos), paga antes do início.");
    expect(m.texto).toContain("Mensal: US$ 497,00 (quatrocentos e noventa e sete dólares americanos) por mês");
    expect(m.texto).toContain("documento EIN 12-3456789");
    expect(m.texto).toContain("This annex is written in Portuguese");
    expect(m.texto).not.toContain("R$ 497");
    expect(m.texto).toContain("hora técnica de US$ 40,00");
    expect(podeCongelar(m).pode).toBe(true);
  });

  it("em euro, o extenso vira euros e cêntimos", () => {
    const m = montar(["exterior"], completos(["exterior"], { ext_moeda: "EUR", ext_valor_entrada: "267", valor_mensal: "447,50" }));
    expect(m.texto).toContain("Entrada: € 267,00 (duzentos e sessenta e sete euros)");
    expect(m.texto).toContain("€ 447,50 (quatrocentos e quarenta e sete euros e cinquenta cêntimos)");
  });

  it("sem o serviço exterior, nada muda: continua em reais", () => {
    const v = valoresComPadrao(variaveisDoContrato(MODELOS, ["mensalista"]), {
      ...valoresDoCliente({ nome: "Padaria", documento: "11.222.333/0001-81", endereco: "Rua A, 1", email: "a@b.com" }),
      inicio: "2026-10-01", valor_hora_extra: "180", valor_mensal: "3500", vencimento_dia: "10", vigencia_meses: "12",
      mensal_pacote: "20 peças", mensal_vigencia_minima_meses: "3",
    });
    const m = montar(["mensalista"], v);
    expect(m.texto).toContain("R$ 3.500,00 (três mil e quinhentos reais)");
    expect(m.texto).not.toContain("US$");
    expect(m.texto).not.toContain("Entrada:");
  });

  it("formatação e leitura de valor na moeda", () => {
    expect(moedaNoContrato(1234.5, "USD")).toBe("US$ 1.234,50");
    expect(moedaNoContrato(1234.5, "BRL")).toBe("R$ 1.234,50");
    expect(extensoNaMoeda(1, "USD")).toBe("um dólar americano");
    expect(extensoNaMoeda(1_000_000, "EUR")).toBe("um milhão de euros");
    expect(lerMoeda("US$ 497")).toBe(497);
    expect(lerMoeda("€ 447,50")).toBe(447.5);
    expect(formatarValor({ nome: "x", rotulo: "x", tipo: "moeda" }, "10")).toBe("R$ 10,00 (dez reais)");
  });

  it("as palavras de sempre acham o serviço quando o dono fala do exterior", () => {
    expect(servicosPorPalavras("contrato para cliente nos EUA, em dólar")).toContain("exterior");
    expect(servicosPorPalavras("cliente em Portugal, contrato bilíngue")).toContain("exterior");
    expect(servicosPorPalavras("gestão de instagram para padaria")).not.toContain("exterior");
  });

  it("o seed da migration tem o mesmo texto do arquivo (fonte única) e amplia a CHECK", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261026170000_contrato_exterior.sql"), "utf8");
    expect(sql).toContain("'mensalista', 'exterior'");
    for (const m of MODELOS_EXTERIOR_V1) {
      expect(sql).toContain(`'${m.chave}'`);
      for (const c of m.clausulas) expect(sql, `${m.chave}:${c.chave}`).toContain(`'${c.texto.replace(/'/g, "''")}'`);
    }
    expect((sql.match(/ON CONFLICT \(chave, versao\) DO NOTHING;/g) || []).length).toBe(MODELOS_EXTERIOR_V1.length);
    for (const m of MODELOS_EXTERIOR_V1) for (const c of m.clausulas) expect(/[—–]/.test(c.texto), `${m.chave}:${c.chave}`).toBe(false);
  });
});

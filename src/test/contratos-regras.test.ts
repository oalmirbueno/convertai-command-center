// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  alvosDoAgente,
  blocoDosAlvosDoContrato,
  diffDoItem,
  lerJulgamentoDoPedido,
  lerServicos,
  mapearProposta,
  normalizarAcoesDosContratos,
  perguntaDosIncertos,
  perguntasDoPedido,
  regrasDasOperacoes,
  servicosPorPalavras,
  valorPedido,
  valoresDaProposta,
  type ContextoDasRegras,
} from "../../supabase/functions/contratos/regras";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { montarContrato, valoresComPadrao, variaveisDoContrato, type VariavelDoModelo } from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1 } from "../../supabase/functions/_shared/contrato-modelo-v1";

/**
 * Frente CON (30/09): o Jev escolhe os blocos pela explicação do dono, a
 * proposta aceita vira contrato, e o agente nunca reescreve cláusula sem a
 * diferença no cartão (Confirmar e Desfazer).
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const CONTRATO = "22222222-2222-4222-8222-222222222222";

describe("contratos: o Jev escolhe os blocos", () => {
  it("uma pergunta por serviço, direitos em Choice e mudança de cláusula só com contrato aberto", () => {
    const sem = perguntasDoPedido({ comContrato: false });
    expect(Object.keys(sem).filter((k) => k.indexOf("servico_") === 0)).toHaveLength(8);
    expect(sem.direitos.type).toBe("choice");
    expect(Object.keys((sem.direitos as { criteria: Record<string, unknown> }).criteria)).toEqual(["cessao", "licenca", "nao_diz"]);
    expect(sem.muda_clausula).toBeUndefined();
    expect(perguntasDoPedido({ comContrato: true }).muda_clausula.type).toBe("noul");
  });

  it("lê as probabilidades: acima de 0,6 entra, entre 0,35 e 0,6 vira pergunta", () => {
    const j = lerJulgamentoDoPedido({
      servico_social: { noul: 0.93 },
      servico_trafego: { noul: 0.48 },
      servico_site: { noul: 0.05 },
      direitos: { choice: "licenca", confidence: 0.82 },
      muda_clausula: { noul: 0.7 },
    }, "texto");
    expect(j.escolhidos).toEqual(["social"]);
    expect(j.incertos).toEqual(["trafego"]);
    expect(j.direitos).toBe("licenca");
    expect(j.mudaClausula).toBe(true);
    expect(j.fonte).toBe("jev");
    expect(perguntaDosIncertos(j.incertos)).toBe("Inclui também Tráfego pago?");
  });

  it("sem Jev, valem as palavras de sempre", () => {
    const j = lerJulgamentoDoPedido(null, "Gestão do Instagram e uma landing page de captação");
    expect(j.fonte).toBe("palavras");
    expect(j.escolhidos).toEqual(expect.arrayContaining(["social", "site"]));
    expect(servicosPorPalavras("anúncios no Meta Ads")).toEqual(["trafego"]);
    expect(lerServicos("social, site, xyz")).toEqual(["social", "site"]);
  });
});

describe("contratos: proposta aceita vira contrato", () => {
  it("lê a proposta e o evento aceita, com nomes de coluna diferentes", () => {
    const p = mapearProposta(
      { id: "p1", cliente_id: CLIENTE, codigo: "PR-12", titulo: "Site novo", itens: [{ nome: "Site institucional", valor: 6000 }], valor_total: "8.460,00", condicoes: "3x no boleto" },
      [{ tipo: "enviada" }, { evento: "aceita", criado_em: "2026-09-29T10:00:00Z" }],
    )!;
    expect(p.aceita).toBe(true);
    expect(p.clientId).toBe(CLIENTE);
    expect(p.numero).toBe("PR-12");
    expect(p.valorTotal).toBe(8460);
    expect(p.itensTexto).toContain("Site institucional");
    expect(valoresDaProposta(p, ["site"])).toEqual({ proposta_numero: "PR-12", valor_total: "8460", condicoes_pagamento: "3x no boleto" });
  });

  it("proposta sem aceite não vira contrato", () => {
    expect(mapearProposta({ id: "p2", client_id: CLIENTE, status: "enviada" }, [{ tipo: "enviada" }])!.aceita).toBe(false);
    expect(mapearProposta(null, [])).toBeNull();
  });

  it("serviço mensal usa o valor da proposta como mensalidade", () => {
    const p = mapearProposta({ id: "p3", client_id: CLIENTE, status: "aceita", total: 3500 }, [])!;
    expect(valoresDaProposta(p, ["social"])).toEqual({ valor_mensal: "3500" });
  });
});

function contexto(extra: Partial<ContextoDasRegras> = {}): { ctx: ContextoDasRegras; alvos: ReturnType<typeof alvosDoAgente> } {
  const vars = variaveisDoContrato(MODELOS_V1, ["design"]);
  const valores = valoresComPadrao(vars, {});
  const m = montarContrato({ modelos: MODELOS_V1, servicos: ["design"], valores, agencia: { razao_social: "A", nome_fantasia: "", cnpj: "1", endereco: "R", cidade: "L", uf: "PR", representante: "X", representante_cpf: "", email: "", foro: "L" }, numero: "CT-1", versao: 1, data: "2026-09-30" });
  const porNome: Record<string, VariavelDoModelo> = {};
  m.variaveis.forEach((v) => (porNome[v.nome] = v));
  const clausulas: ContextoDasRegras["clausulas"] = {};
  m.clausulas.forEach((c) => (clausulas[c.chave] = { atual: c.texto_modelo, modelo: c.texto_modelo }));
  const ctx: ContextoDasRegras = { agenciaFaltando: [], rascunho: true, variaveis: porNome, servicosAtuais: ["design"], clausulas, ...extra };
  const alvos = alvosDoAgente({ clientId: CLIENTE, contratoId: CONTRATO, servicosAtuais: ["design"], variaveis: m.variaveis, valores, faltando: m.faltando.map((f) => f.nome), clausulas: m.clausulas });
  return { ctx, alvos };
}

describe("contratos: operações do agente", () => {
  it("o prompt só leva apelidos, nunca o id", () => {
    const { alvos } = contexto();
    const bloco = blocoDosAlvosDoContrato(alvos);
    expect(bloco).toContain("n1 | novo contrato para este cliente");
    expect(bloco).toContain("s7 | Design pontual");
    expect(bloco).not.toContain(CONTRATO);
    expect(bloco).not.toContain(CLIENTE);
  });

  it("sem dados da agência, criar contrato é recusado com o motivo", () => {
    const { ctx, alvos } = contexto({ agenciaFaltando: ["CNPJ", "comarca do foro"] });
    const a = normalizarAcoesDosContratos({ resumo: "Criar", itens: [{ operacao: "criar_contrato", ref: "n1", para: "social" }] }, alvos, ctx, { contratoId: null, clientId: CLIENTE })!;
    expect(a.itens).toHaveLength(0);
    expect(a.recusados[0].motivo).toContain("Faltam os dados da agência: CNPJ, comarca do foro");
  });

  it("preencher converte o valor e recusa o inválido; vai direto quando claro", () => {
    const { ctx, alvos } = contexto();
    const ref = alvos.variaveis.find((v) => v.dados && v.dados.nome === "valor_total")!.ref;
    const refEscolha = alvos.variaveis.find((v) => v.dados && v.dados.nome === "portfolio")!.ref;
    const a = normalizarAcoesDosContratos({ resumo: "Preencher", itens: [{ operacao: "preencher", ref, para: "R$ 2.500,00" }, { operacao: "preencher", ref: refEscolha, para: "Não" }] }, alvos, ctx, { contratoId: CONTRATO, clientId: CLIENTE })!;
    expect(a.itens.map((i) => i.para)).toEqual(["2500", "nao"]);
    expect(podeExecutarDireto(a, regrasDasOperacoes(ctx), { pedidoClaro: true }).direto).toBe(true);
    const ruim = normalizarAcoesDosContratos({ resumo: "x", itens: [{ operacao: "preencher", ref, para: "muito" }] }, alvos, ctx, { contratoId: CONTRATO, clientId: CLIENTE });
    // Valor inválido não vira item (sem nada para confirmar, não há cartão).
    expect(ruim ? ruim.itens.length : 0).toBe(0);
    expect(valorPedido({ nome: "d", rotulo: "d", tipo: "data" }, "2026-13-40")).toBeNull();
  });

  it("reescrever cláusula nunca vai direto e leva a diferença no cartão", () => {
    const { ctx, alvos } = contexto();
    const k = alvos.clausulas.find((c) => c.dados && c.dados.chave === "bloco_design:producao")!;
    const novo = "A impressão fica por conta do CONTRATANTE, com acompanhamento da CONTRATADA sem custo adicional.";
    const a = normalizarAcoesDosContratos({ resumo: "Reescrever", itens: [{ operacao: "alterar_clausula", ref: k.ref, para: novo }] }, alvos, ctx, { contratoId: CONTRATO, clientId: CLIENTE })!;
    expect(a.itens).toHaveLength(1);
    expect(podeExecutarDireto(a, regrasDasOperacoes(ctx), { pedidoClaro: true }).direto).toBe(false);
    const d = diffDoItem(a, a.itens[0])!;
    expect(d.depois).toBe(novo);
    expect(d.partes.some((x) => x.tipo === "entrou")).toBe(true);
    expect(d.partes.some((x) => x.tipo === "saiu")).toBe(true);
  });

  it("sem a diferença no cartão, a reescrita não tem o que executar (diff obrigatório)", () => {
    const { ctx, alvos } = contexto();
    const k = alvos.clausulas[0];
    const a = normalizarAcoesDosContratos({ resumo: "x", itens: [{ operacao: "alterar_clausula", ref: k.ref, para: "Texto novo da cláusula inteira, bem diferente." }] }, alvos, ctx, { contratoId: CONTRATO, clientId: CLIENTE })!;
    const semDiff = { ...a, contexto: { contract_id: CONTRATO } };
    expect(diffDoItem(semDiff, a.itens[0])).toBeNull();
  });

  it("contrato congelado: nada muda pelo agente", () => {
    const { ctx, alvos } = contexto({ rascunho: false });
    const ref = alvos.variaveis[0].ref;
    const a = normalizarAcoesDosContratos({ resumo: "x", itens: [{ operacao: "preencher", ref, para: "Fulano" }] }, alvos, ctx, { contratoId: CONTRATO, clientId: CLIENTE })!;
    expect(a.itens).toHaveLength(0);
    expect(a.recusados[0].motivo).toContain("versão nova");
  });
});

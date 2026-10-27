import { describe, expect, it } from "vitest";
import { direcaoCriativaParaImagem, METODO_CRIATIVO_DA_CAMPANHA, rotasVisuaisParaOPrompt, textosExatosParaArte } from "../../supabase/functions/_shared/motor-criativo-campanha";
import { pedidoDeImagem, pedidoDeTexto, validarConteudo } from "../../supabase/functions/bolso/regras";
import { copyQueConverteParaOPrompt, CONHECIMENTO_CRIATIVO_QUE_CONVERTE } from "../../supabase/functions/mesa-ads/modulos/conhecimento-criativo";

const marca = { nome: "Marca do membro", publico: "negócios locais", cores: ["#00A500"] };
const briefing = { tipo: "orcamento" as const, produto: "Campanha de lançamento", diferencial: "Planejamento e direção criativa", cta: "Peça um orçamento" };

describe("núcleo criativo compartilhado, com adaptadores e dados separados", () => {
  it("Bolso e Mesa Ads recebem o mesmo método no pedido; sistema global não cresce", () => {
    expect(pedidoDeTexto(marca, briefing).sistema).toContain(METODO_CRIATIVO_DA_CAMPANHA);
    expect(copyQueConverteParaOPrompt()).toContain(METODO_CRIATIVO_DA_CAMPANHA);
    expect(CONHECIMENTO_CRIATIVO_QUE_CONVERTE).not.toContain(METODO_CRIATIVO_DA_CAMPANHA);
    expect(METODO_CRIATIVO_DA_CAMPANHA).toContain("só resultados reais de campanha");
  });

  it("arte completa usa somente textos exatos escolhidos, sem a legenda ou propriedades extras", () => {
    const imagem = pedidoDeImagem(marca, briefing, { mensagem: "Uma campanha. Uma direção.", cta: "Peça um orçamento", texto: "Legenda fora da arte" }, "feed_4x5");
    const dados = JSON.parse(imagem.split("\n").at(-1)!);
    expect(dados.textos_exatos).toEqual({ headline: "Uma campanha. Uma direção.", cta: "Peça um orçamento" });
    expect(imagem).not.toContain("Legenda fora da arte");
    expect(imagem).toContain(direcaoCriativaParaImagem({ formato: "feed_4x5", semTipografia: false }));
    const marcaComDadosExtras = { ...marca, segredo_de_outro_modulo: "não incluir" };
    const pedido = pedidoDeTexto(marcaComDadosExtras, { ...briefing, crm: "não incluir" } as typeof briefing);
    expect(pedido.usuario).not.toContain("não incluir");
  });

  it("limites preservam histórico sem resumir texto e aceitam exatamente o limite", () => {
    expect(textosExatosParaArte({ mensagem: "h".repeat(80), cta: "c".repeat(50) })).toEqual({ headline: "h".repeat(80), cta: "c".repeat(50) });
    expect(textosExatosParaArte({ mensagem: "h".repeat(81), cta: "Peça" })).toBeNull();
    expect(textosExatosParaArte({ mensagem: "Título", cta: "c".repeat(51) })).toBeNull();
    expect(textosExatosParaArte({ mensagem: "  " })).toBeNull();
    expect(pedidoDeImagem(marca, briefing, { mensagem: "h".repeat(81) }, "feed_4x5")).toContain("sem tipografia");
  });

  it("variantes mudam mecanismo visual, preservando direção escolhida e tom sóbrio", () => {
    const rotas = rotasVisuaisParaOPrompt(5);
    expect(rotas).toContain("metáfora visual");
    expect(rotas).toContain("detalhe cotidiano");
    expect(rotas).toContain("escala inesperada");
    expect(rotas).toContain("demonstração");
    expect(rotas).toContain("contraste de contexto");
    const sobrio = rotasVisuaisParaOPrompt(3, { sobrio: true, preservarPrimeira: true });
    expect(sobrio).toContain("Variação 1: desenvolva o gancho e a direção já escolhidos");
    expect(sobrio).not.toContain("escala inesperada;");
    expect(rotasVisuaisParaOPrompt(Infinity)).not.toContain("Variação 2");
    expect(rotasVisuaisParaOPrompt(99)).not.toContain("Variação 9");
  });

  it("preserva fotos autorizadas no motor comum sem permitir inventar pessoas ou endossos", () => {
    const direcao = direcaoCriativaParaImagem({ formato: "feed_4x5" });
    expect(direcao).toContain("somente quando uma referência autorizada for fornecida");
    expect(direcao).toContain("não invente uma identidade reconhecível");
    expect(direcao).toContain("Nunca atribua endosso ou depoimento");
    expect(pedidoDeImagem(marca, briefing, { mensagem: "Uma campanha", cta: "Peça" }, "feed_4x5")).toContain("Não use logotipos de terceiros nem pessoas reais identificáveis");
  });

  it("aceita escala de composição e mantém a conferência comercial na direção e na copy", () => {
    const base = { mensagem: "Uma campanha", texto: "Peça um orçamento" };
    expect(validarConteudo({ ...base, direcao_visual: "Uma xícara em escala 3x maior sobre uma mesa." }, briefing).ok).toBe(true);
    for (const direcao_visual of ["Escreva em 3x", "Escreva até 3x", "3x de R$ 12", "escala 3x sem juros", "escala 3x maior e headline R$ 12"]) {
      expect(validarConteudo({ ...base, direcao_visual }, briefing).ok).toBe(false);
    }
    expect(validarConteudo({ ...base, texto: "Pague em 3x" }, briefing).ok).toBe(false);
    expect(validarConteudo({ ...base, texto: "Pague em 3x" }, { ...briefing, condicoes: "3 parcelas" }).ok).toBe(true);
  });

  it.each([
    ["R$ 12", "R$ 19"], ["R$ 12,90", "R$ 12,99"], ["R$ 1.200", "R$ 1.250"],
    ["1,5%", "1,9%"], ["12 dias", "19 dias"], ["3x de R$ 12", "9x de R$ 12"], ["3 parcelas", "3 parcelas sem juros"],
  ])("recusa alterar condição confirmada %s para %s", (condicoes, texto) => {
    expect(validarConteudo({ mensagem: "Campanha", texto: condicoes }, { ...briefing, condicoes }).ok).toBe(true);
    expect(validarConteudo({ mensagem: "Campanha", texto }, { ...briefing, condicoes }).ok).toBe(false);
  });
});

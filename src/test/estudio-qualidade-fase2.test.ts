import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acabamentoDaConferencia,
  LEITURA_DO_ACABAMENTO,
  LIMIAR_DO_ACABAMENTO,
  perguntasDeAcabamento,
  REGRA_TEXTO_INTEIRO,
} from "../../supabase/functions/estudio-arte/qualidade-da-lamina";
import { decidirAutocorrecao } from "../../supabase/functions/estudio-arte/autocorrecao";

/**
 * Qualidade da lâmina, fase 2 (23/10). Regra de ouro do dono: o aprovado não
 * pode piorar. Fixa que os pedidos antigos continuam com os mesmos blocos
 * obrigatórios (texto exato, marca e logo, foto real intacta, logo pelo
 * código), que a fase 2 só acrescenta, e que a conferência mais esperta só
 * avisa (a autocorreção continua só com erro objetivo).
 */

const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/estudio-arte/index.ts"), "utf8");
const direcao = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/direcao-arte.ts"), "utf8");
const corpoDe = (nome: string) => {
  const i = fonte.indexOf(`function ${nome}(`);
  const fim = fonte.indexOf("\n}\n", i);
  return fonte.slice(i, fim);
};

describe("os pedidos antigos continuam com os mesmos blocos obrigatórios", () => {
  const r = corpoDe("regrasDeRender");

  it("REGRAS FINAIS: texto exato, logo (gerar, manter, sem logo), anexos e proibições seguem iguais", () => {
    for (const linha of [
      '"REGRAS FINAIS (valem sobre tudo acima)"',
      "`- ${REGRA_TEXTO_NA_ARTE}`",
      '`- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "${card.texto_exato}"`',
      '"- Logo: a que já está na imagem 1 fica exatamente como está, no mesmo lugar e no mesmo tamanho.',
      '"- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só."',
      '"- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca."',
      "`- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): ${anexos.join(\"; \")}.`",
      '"- Sem travessão no texto."',
    ]) {
      expect(r).toContain(linha);
    }
  });

  it("a linha nova vem DEPOIS do texto exato e antes da logo (só acrescenta, nada sai do lugar)", () => {
    const iTexto = r.indexOf("- Escreva exatamente este texto");
    const iNova = r.indexOf("REGRA_TEXTO_INTEIRO,");
    const iLogo = r.indexOf('"- Logo: a que já está na imagem 1');
    expect(iTexto).toBeGreaterThan(0);
    expect(iNova).toBeGreaterThan(iTexto);
    expect(iLogo).toBeGreaterThan(iNova);
    // A linha nova reforça, não contradiz: nada de mudar fonte, cor, estilo, logo ou foto.
    expect(REGRA_TEXTO_INTEIRO).not.toMatch(/fonte|paleta|estilo|logo|foto/i);
    expect(REGRA_TEXTO_INTEIRO.startsWith("- ")).toBe(true);
  });

  it("foto real intacta e logo colada pelo código continuam no servidor", () => {
    // Foto fixa: o original volta alinhado por cima (só o texto e a logo mudam).
    expect(fonte).not.toContain("devolverOriginalAlinhado(baseFoto");
    // 27/10 (dono): sem colar nada por cima: a arte da foto real é a imagem inteira do gerador.
    expect(fonte).toContain("Foto real (27/10/2026");
    // A logo colada pelo código numa versão antiga fica protegida no ajuste.
    expect(fonte).toContain("const protegidas: Area[] = marcaDaVersao.logo_no_codigo ? [c] : [];");
    // A vitrine de logos dos parceiros continua colada pelo código.
    expect(fonte).toContain("const r = await colarVitrineNaArte(pngFinal, vitrinePedida, t.client_id);");
  });

  it("o padrão de design, as proibições e o modelo de imagem não mudaram (nada da fase 2 em direcao-arte.ts)", () => {
    expect(direcao).toContain('"PADRÃO DE DESIGN (técnicas que valem em toda lâmina)"');
    expect(direcao).toContain("- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão");
    expect(direcao).not.toContain("REGRA_TEXTO_INTEIRO");
    // O gerador segue o modelo do trabalho e a qualidade escolhida.
    expect(fonte).toContain("carregarModelo(t.modelo_imagem_id!, \"imagem\")");
    expect(fonte).not.toContain("qualidade_maxima");
  });
});

describe("conferência mais esperta: acabamento só como aviso", () => {
  it("o leitor só ganha uma frase no fim (o esquema da leitura não muda)", () => {
    expect(fonte).toContain("sistema: `${SISTEMA_LEITURA}${LEITURA_DO_ACABAMENTO}`,");
    expect(fonte).toContain('required: ["texto_lido", "descricao_visual", "logo_presente"],');
    expect(LEITURA_DO_ACABAMENTO.startsWith(" ")).toBe(true);
    expect(LEITURA_DO_ACABAMENTO).toContain("descricao_visual");
  });

  it("perguntas na mesma chamada do Jev; a da logo só com logo esperada e vista", () => {
    expect(Object.keys(perguntasDeAcabamento({ esperaLogo: false, logoPresente: true }))).toEqual(["acabamento_texto", "acabamento_anatomia"]);
    expect(Object.keys(perguntasDeAcabamento({ esperaLogo: true, logoPresente: false }))).toEqual(["acabamento_texto", "acabamento_anatomia"]);
    expect(Object.keys(perguntasDeAcabamento({ esperaLogo: true, logoPresente: true }))).toEqual(["acabamento_texto", "acabamento_anatomia", "acabamento_logo"]);
    for (const q of Object.values(perguntasDeAcabamento({ esperaLogo: true, logoPresente: true }))) {
      expect(q!.type).toBe("noul");
      expect(q!.instructions).toContain("`arte_gerada.descricao_visual`");
    }
    const v = corpoDe("verificar");
    // Uma chamada só ao Jev na conferência (as perguntas novas entram nela).
    expect(v.match(/await jevPerguntar\(/g) ?? []).toHaveLength(1);
    expect(v.indexOf("perguntasDeAcabamento(")).toBeLessThan(v.indexOf("await jevPerguntar("));
  });

  it("probabilidade vira achado e aviso só acima do limiar; sem resposta, nada inventado", () => {
    const prob = (r: unknown) => (typeof r === "number" ? r : null);
    const perguntadas = perguntasDeAcabamento({ esperaLogo: true, logoPresente: true });
    const a = acabamentoDaConferencia({ acabamento_texto: 0.8, acabamento_anatomia: 0.2, acabamento_logo: LIMIAR_DO_ACABAMENTO }, prob, perguntadas);
    expect(a.texto).toEqual({ probabilidade: 0.8, achou: true });
    expect(a.anatomia).toEqual({ probabilidade: 0.2, achou: false });
    expect(a.logo).toEqual({ probabilidade: LIMIAR_DO_ACABAMENTO, achou: true });
    expect(a.avisos).toHaveLength(2);
    const vazio = acabamentoDaConferencia({}, prob, perguntasDeAcabamento({ esperaLogo: false, logoPresente: null }));
    expect(vazio).toEqual({ texto: { probabilidade: null, achou: null }, anatomia: { probabilidade: null, achou: null }, avisos: [] });
  });

  it("a autocorreção não lê o acabamento: mesmo com todos os avisos, só corrige com erro objetivo", () => {
    const base = { pendente: false, texto_lido: "Texto certo", ortografia_ok: true, identidade: null, logo_ok: true };
    const acabamento = { texto: { probabilidade: 0.9, achou: true }, anatomia: { probabilidade: 0.9, achou: true }, avisos: ["x", "y"] };
    const semErro = decidirAutocorrecao({ ...base, acabamento } as never, { ads: false, textoExato: "Texto certo" });
    expect(semErro.precisa).toBe(false);
    expect(decidirAutocorrecao(base as never, { ads: false, textoExato: "Texto certo" })).toEqual(semErro);
    // A decisão (autocorrecao.ts) não ganhou nada da fase 2.
    const autocorrecao = readFileSync(resolve(__dirname, "../../supabase/functions/estudio-arte/autocorrecao.ts"), "utf8");
    expect(autocorrecao).not.toContain("v.acabamento");
    expect(autocorrecao).not.toContain("qualidade-da-lamina");
  });
});

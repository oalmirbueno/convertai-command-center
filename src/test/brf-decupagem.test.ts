import { describe, expect, it } from "vitest";
import { MODELOS_DE_FABRICA } from "../../supabase/functions/_shared/briefing-modelos";
import {
  aplicarNoContexto,
  desfazerNoContexto,
  dividirEmTrechos,
  entradaDaDecupagem,
  estadoDaDecupagem,
  lerDecupagem,
  perguntasDaDecupagem,
  porCategoria,
  sugestoesParaOContexto,
  termosCandidatos,
  type RespostaDaDecupagem,
} from "../../supabase/functions/_shared/briefing-decupagem";

/**
 * Frente BRF: decupagem do briefing com um Jev falso. O código separa o que
 * a regra do modelo já resolve e monta as perguntas; o "Jev" responde; a
 * leitura junta tudo e vira sugestão para o contexto, com Desfazer.
 */

const modelo = MODELOS_DE_FABRICA.identidade;
const respostas = {
  empresa: "Padaria Aurora",
  historia: "Começamos em 2012 como uma padaria de bairro em Curitiba. Hoje fazemos pão de fermentação natural e cafés especiais.",
  produtos: "Pão de fermentação natural, bolos caseiros e café especial.",
  diferenciais: "Fermentação natural de 48 horas, ingredientes locais",
  tipoDeCliente: "Pessoas (B2C)",
  perfilDoCliente: "Famílias do bairro Água Verde que valorizam comida de verdade.",
  dorDoCliente: "Não encontram pão sem conservante perto de casa.",
  eixoSerio: 4,
  atributos: ["Acolhedor", "Natural"],
  naoQuer: "Nada de visual industrial ou frio.",
  referencias: [{ link: "https://pinterest.com/pin/123", nota: "tons terrosos" }, { link: "https://exemplo.com.br" }, { anexo_id: "ax1" }],
  concorrentes: ["https://padariavizinha.com.br"],
  temLogo: "Sim",
  motivoDaMudanca: "O logo atual parece de supermercado.",
  mensagemDoLogo: "Tradição, calor do forno, bairro",
  algoMais: "Queremos abrir uma segunda loja no ano que vem. A fachada nova precisa ficar pronta antes.",
};
const anexos = [{ id: "ax1", campo: "referencias", categoria: "referencias", nome: "moodboard.jpg" }];

/** Jev falso: responde por id de pergunta, como a API real (choice com probabilities; noul com número). */
function jevFalso(entrada: ReturnType<typeof entradaDaDecupagem>): Record<string, RespostaDaDecupagem> {
  const r: Record<string, RespostaDaDecupagem> = {};
  entrada.trechos.forEach((t, i) => {
    if (/segunda loja/i.test(t.texto)) r[`t${i}`] = { choice: "objetivo", confidence: 0.8, probabilities: { objetivo: 0.8, nenhum: 0.2 } };
    else if (/fermentação natural/i.test(t.texto)) r[`t${i}`] = { choice: "palavra_chave", confidence: 0.7, probabilities: { palavra_chave: 0.7 } };
    else if (/fachada/i.test(t.texto)) r[`t${i}`] = { choice: "restricao", confidence: 0.3, probabilities: { restricao: 0.3, objetivo: 0.25 } };
    else r[`t${i}`] = { choice: "nenhum", confidence: 0.9, probabilities: { nenhum: 0.9 } };
  });
  entrada.termos.forEach((t, i) => {
    r[`k${i}`] = { noul: /fermentação|natural|padaria|bairro/.test(t) ? 0.9 : 0.1 };
  });
  r.tom = { choice: "acolhedor", confidence: 0.77 };
  return r;
}

describe("decupagem do briefing (Jev falso)", () => {
  const entrada = entradaDaDecupagem(modelo, respostas, anexos);

  it("a regra do modelo resolve referência, escala, escolha e campos com categoria, sem Jev", () => {
    const porCat = (c: string) => entrada.regra.filter((r) => r.categoria === c).map((r) => r.texto);
    expect(porCat("referencia")).toEqual(expect.arrayContaining(["https://pinterest.com/pin/123 (tons terrosos)", "moodboard.jpg", "Concorrente: https://padariavizinha.com.br"]));
    expect(porCat("tom")).toEqual(expect.arrayContaining(["Mais descontraído (4 de 5)", "Acolhedor", "Natural"]));
    expect(porCat("publico")).toEqual(expect.arrayContaining(["Pessoas (B2C)", "Famílias do bairro Água Verde que valorizam comida de verdade"]));
    expect(porCat("dor")).toEqual(expect.arrayContaining(["Não encontram pão sem conservante perto de casa", "O logo atual parece de supermercado"]));
    expect(porCat("restricao")).toContain("Nada de visual industrial ou frio");
    // Resposta aberta sem categoria vai para o Jev trecho a trecho.
    expect(entrada.trechos.map((t) => t.campo)).toEqual(expect.arrayContaining(["historia", "produtos", "algoMais"]));
    expect(entrada.termos.length).toBeGreaterThan(0);
  });

  it("monta as perguntas no formato do Jev: Choice por trecho (com 'nenhum'), Noul por termo e o tom", () => {
    const q = perguntasDaDecupagem(entrada);
    expect(q.t0.type).toBe("choice");
    expect(Object.keys((q.t0 as { criteria: Record<string, string> }).criteria)).toEqual(expect.arrayContaining(["dor", "publico", "restricao", "objetivo", "tom", "palavra_chave", "nenhum"]));
    expect(q.k0.type).toBe("noul");
    expect(q.tom.type).toBe("choice");
    expect(q.t0.instructions).toContain("`trechos[0].texto`");
    const estado = estadoDaDecupagem(modelo, respostas, entrada, anexos);
    expect(estado.trechos).toHaveLength(entrada.trechos.length);
    expect(estado.briefing.respostas.length).toBeGreaterThan(5);
  });

  it("lê as respostas do Jev: aceita a categoria com confiança, ignora 'nenhum' e o incerto", () => {
    const d = lerDecupagem(entrada, jevFalso(entrada));
    const textos = (c: string) => d.itens.filter((i) => i.categoria === c).map((i) => i.texto);
    expect(textos("objetivo")).toContain("Queremos abrir uma segunda loja no ano que vem");
    expect(textos("palavra_chave").some((t) => /fermentação natural/i.test(t))).toBe(true);
    expect(textos("restricao")).not.toContain("A fachada nova precisa ficar pronta antes");
    expect(d.tom_de_voz).toBe("Acolhedor e cuidadoso");
    expect(d.itens.filter((i) => i.fonte === "jev").every((i) => typeof i.confianca === "number")).toBe(true);
    expect(porCategoria(d.itens)[0].categoria).toBe("palavra_chave");
  });

  it("sem Jev (fora do ar), fica só a regra do modelo, sem inventar nada", () => {
    const d = lerDecupagem(entrada, null);
    expect(d.itens.every((i) => i.fonte === "regra")).toBe(true);
    expect(d.tom_de_voz).toBeNull();
  });

  it("vira sugestão para o contexto: preenche o vazio, troca só com escolha, soma diferenciais", () => {
    const d = lerDecupagem(entrada, jevFalso(entrada));
    const contexto = { negocio: "Padaria", diferenciais: ["Atendimento"] };
    const s = sugestoesParaOContexto({ modelo, respostas, decupagem: d, contexto, briefingId: "b1" });
    const por = (c: string) => s.find((x) => x.campo === c)!;
    expect(por("negocio").modo).toBe("substituir");
    expect(por("negocio").padrao).toBe(false);
    expect(por("publico").modo).toBe("preencher");
    expect(por("publico").padrao).toBe(true);
    expect(por("oferta").valor).toContain("Pão de fermentação natural");
    expect(por("diferenciais").modo).toBe("juntar");
    expect(por("diferenciais").valor).toEqual(["Atendimento", "Fermentação natural de 48 horas", "ingredientes locais"]);
    expect(String(por("tom_de_voz").valor)).toMatch(/^Acolhedor e cuidadoso\. Atributos: acolhedor, natural\.$/);
    const pontos = por("decupagem_do_briefing").valor as Record<string, unknown>;
    expect(pontos.briefing_id).toBe("b1");
    expect((pontos.referencias as string[]).length).toBe(4);
  });

  it("Confirmar grava só o escolhido; Desfazer volta o que não mudou depois", () => {
    const d = lerDecupagem(entrada, jevFalso(entrada));
    const contexto = { negocio: "Padaria", tom_de_voz: "" };
    const s = sugestoesParaOContexto({ modelo, respostas, decupagem: d, contexto, briefingId: "b1" });
    const escolhidas = s.filter((x) => x.campo === "publico" || x.campo === "tom_de_voz");
    const { novo, aplicadas } = aplicarNoContexto(contexto, escolhidas);
    expect(novo.negocio).toBe("Padaria");
    expect(novo.publico).toContain("Famílias do bairro");
    // Alguém mexeu no público depois: o Desfazer não pisa.
    const mexido = { ...novo, publico: "Editado à mão" };
    const r = desfazerNoContexto(mexido, aplicadas);
    expect(r.voltaram).toEqual(["tom_de_voz"]);
    expect(r.mantidos.map((m) => m.campo)).toEqual(["publico"]);
    expect(r.novo.tom_de_voz).toBe("");
    expect(r.novo.publico).toBe("Editado à mão");
    // Campo que não existia antes some no Desfazer.
    const r2 = desfazerNoContexto(novo, aplicadas);
    expect("publico" in r2.novo).toBe(false);
  });
});

describe("partes do texto", () => {
  it("divide a resposta em trechos sem cortar palavra", () => {
    expect(dividirEmTrechos("Primeira frase aqui. Segunda frase também!\nTerceira linha com ideia")).toEqual(["Primeira frase aqui", "Segunda frase também", "Terceira linha com ideia"]);
    expect(dividirEmTrechos("")).toEqual([]);
  });

  it("termos candidatos saem das próprias respostas, sem palavras vazias", () => {
    const t = termosCandidatos(["Pão de fermentação natural. Fermentação natural de verdade, pão artesanal."]);
    expect(t[0]).toBe("fermentação natural");
    expect(t).not.toContain("para");
    expect(t).not.toContain("de");
  });
});

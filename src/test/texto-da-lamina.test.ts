import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ chamar: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/mesa/api", async (original) => {
  const real = await original<typeof import("@/lib/mesa/api")>();
  return { ...real, chamarFuncao: (...args: unknown[]) => mock.chamar(...args) };
});
vi.mock("sonner", () => ({ toast: mock.toast }));

/**
 * Frente R5 (26/09), Estúdio. Dono: "quando gerar a arte, ele já refinar e
 * encurtar o conteúdo, senão fica textão; ou divide em partes e não deixa só
 * em um lugar; ajuda na continuação e dinâmica do carrossel, pra não ficar
 * sempre fixo de um lado, na mesma coisa."
 * 1. Enxugar na geração: só acima do limite do papel, uma chamada, guardada.
 * 2. Dividir em partes dentro da lâmina, por tipo de texto, sem reescrever.
 * 3. Posição que varia na série, sem repetir a vizinha e respeitando o assunto.
 * 4. Sugestão de dividir em 2 lâminas (com confirmação e Desfazer).
 * 5. Ligação no servidor e na tela; registro em _shared/motores.ts.
 */

import {
  aplicarTextoNaGeracao,
  blocoDoTextoEmPartes,
  type BlocoDaLamina,
  caminhoDoTexto,
  cortarNaGeracao,
  dividirEmPartes,
  dividirLaminaEmDuas,
  enxugarNaGeracao,
  intocaveis,
  juntarLaminas,
  type LaminaDoTexto,
  mantemOriginal,
  papelNaGeracao,
  passaNaGeracao,
  precisaEnxugarNaGeracao,
  sugestaoDeDividirEmDuas,
  textoDaSugestaoDeDividir,
  textoDoEnxuto,
  type TrabalhoParaDividir,
} from "../../supabase/functions/estudio-arte/texto-da-lamina";
import {
  aplicarPosicao,
  blocoDoArranjoDividido,
  espelharTexto,
  ladoDaImagem,
  type LaminaDaSerie,
  planoDePosicoes,
  zonaExtraDoTexto,
} from "../../supabase/functions/estudio-arte/posicao-na-serie";
import { blocosDoTexto, layoutPadrao, type ZonaTexto } from "../../supabase/functions/_shared/direcao-arte";
import { contarPalavras, LIMITE_DA_CAPA, LIMITE_DO_ESTATICO } from "../../supabase/functions/_shared/menos-texto-nas-laminas";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import EstudioTextoDaLamina, { TEXTO_VAI_ENXUGAR } from "@/components/mesa/EstudioTextoDaLamina";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const palavras = (t: string) => t.normalize("NFC").toLowerCase().replace(/[^0-9a-zà-ÿ]+/g, " ").trim().split(" ").filter(Boolean);
const mesmas = (a: string, b: string) => expect(palavras(a).slice().sort()).toEqual(palavras(b).slice().sort());

const APOIO_LONGO =
  "Quem responde o cliente em até cinco minutos passa confiança e fecha mais vendas no mês. Quem demora um dia inteiro perde o cliente para o concorrente que respondeu primeiro. Por isso vale montar respostas prontas para as perguntas mais comuns.";
const laminaLonga = (ordem = 3, funcao = "conteudo"): LaminaDoTexto => ({
  ordem,
  funcao,
  texto_exato: `Responda em 5 minutos\n${APOIO_LONGO}`,
  blocos: [
    { papel: "headline", texto: "Responda em 5 minutos" },
    { papel: "apoio", texto: APOIO_LONGO },
  ],
});
const laminaCurta = (ordem = 3): LaminaDoTexto => ({
  ordem,
  funcao: "conteudo",
  texto_exato: "Responda rápido\nO cliente decide em minutos.",
  blocos: [
    { papel: "headline", texto: "Responda rápido" },
    { papel: "apoio", texto: "O cliente decide em minutos." },
  ],
});
const palavrasDe = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i + 1}`).join(" ");

// ------------------------------------------------------------------ 1. enxugar na geração

describe("1. Enxugar na geração: só acima do limite do papel", () => {
  it("papel pela posição e limites de hoje (capa, miolo, fechamento, estático)", () => {
    expect(papelNaGeracao(1, 5, "capa")).toBe("capa");
    expect(papelNaGeracao(3, 5, "conteudo")).toBe("miolo");
    expect(papelNaGeracao(5, 5, "conteudo")).toBe("fechamento");
    expect(papelNaGeracao(1, 1, "capa")).toBe("estatico");
    expect(passaNaGeracao(laminaCurta(), 5)).toBe(false);
    expect(passaNaGeracao(laminaLonga(), 5)).toBe(true);
    // Capa: até LIMITE_DA_CAPA palavras; estático: até LIMITE_DO_ESTATICO.
    expect(passaNaGeracao({ ordem: 1, funcao: "capa", texto_exato: palavrasDe(LIMITE_DA_CAPA) }, 5)).toBe(false);
    expect(passaNaGeracao({ ordem: 1, funcao: "capa", texto_exato: palavrasDe(LIMITE_DA_CAPA + 1) }, 5)).toBe(true);
    expect(passaNaGeracao({ ordem: 1, funcao: "capa", texto_exato: palavrasDe(LIMITE_DO_ESTATICO) }, 1)).toBe(false);
    expect(passaNaGeracao({ ordem: 1, funcao: "capa", texto_exato: palavrasDe(LIMITE_DO_ESTATICO + 1) }, 1)).toBe(true);
  });

  it("capa com versão, anúncio e texto que a equipe mandou manter não enxugam", () => {
    const capa: LaminaDoTexto = { ordem: 1, funcao: "capa", texto_exato: palavrasDe(20) };
    expect(precisaEnxugarNaGeracao({ card: capa, total: 5 })).toBe(true);
    expect(precisaEnxugarNaGeracao({ card: capa, total: 5, capaComVersao: true })).toBe(false);
    expect(precisaEnxugarNaGeracao({ card: laminaLonga(), total: 5, ads: true })).toBe(false);
    expect(precisaEnxugarNaGeracao({ card: laminaCurta(), total: 5 })).toBe(false);
    const mantida = { ...laminaLonga(), texto_na_geracao: { original: laminaLonga().texto_exato, texto: "x", manter: true } };
    expect(mantemOriginal(mantida)).toBe(true);
    expect(precisaEnxugarNaGeracao({ card: mantida, total: 5 })).toBe(false);
    // Texto mudou depois de "manter": a regra volta a valer.
    expect(precisaEnxugarNaGeracao({ card: { ...mantida, texto_exato: `${mantida.texto_exato} Mais uma frase.` }, total: 5 })).toBe(true);
  });

  it("uma chamada; refazer com o mesmo texto usa o guardado (não paga de novo); curto não chama", async () => {
    const mem = new Map<string, Record<string, unknown>>();
    const escrever = vi.fn(async () => ({
      json: { blocos: [{ papel: "headline", texto: "Responda em 5 minutos" }, { papel: "apoio", texto: "Resposta rápida passa confiança e fecha mais vendas." }] },
      custoUsd: 0.0021,
    }));
    const deps = {
      pasta: "c1/estudio/leituras",
      lerGuardado: async (p: string) => mem.get(p) ?? null,
      guardar: async (p: string, v: unknown) => {
        mem.set(p, v as Record<string, unknown>);
      },
      escrever,
      agora: () => "2026-09-26T12:00:00.000Z",
    };
    const r1 = await enxugarNaGeracao({ card: laminaLonga(), total: 5 }, deps);
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(r1).not.toBeNull();
    expect(r1!.origem).toBe("redator");
    expect(r1!.aviso).toBeNull();
    expect(r1!.custoUsd).toBeCloseTo(0.0021);
    expect(r1!.texto).toBe("Responda em 5 minutos\nResposta rápida passa confiança e fecha mais vendas.");
    expect(r1!.registro.original).toBe(laminaLonga().texto_exato);
    expect(r1!.registro.palavras_depois).toBeLessThan(r1!.registro.palavras_antes);
    expect(mem.has(caminhoDoTexto("c1/estudio/leituras", "miolo", 37, laminaLonga().texto_exato!))).toBe(true);

    const r2 = await enxugarNaGeracao({ card: laminaLonga(), total: 5 }, deps);
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(r2!.guardado).toBe(true);
    expect(r2!.custoUsd).toBe(0);
    expect(r2!.texto).toBe(r1!.texto);

    expect(await enxugarNaGeracao({ card: laminaCurta(), total: 5 }, deps)).toBeNull();
    expect(escrever).toHaveBeenCalledTimes(1);
  });

  it("o que não pode mudar: número, preço, nome e CTA; sem laço (corta no fim de frase e avisa)", () => {
    const blocos: BlocoDaLamina[] = [
      { papel: "headline", texto: "Plano de R$ 49,90" },
      { papel: "apoio", texto: "O plano da Aceleriq cobre 30 dias de acompanhamento com relatório semanal e reunião mensal com a equipe inteira para revisar tudo." },
    ];
    expect(intocaveis(blocos)).toEqual(expect.arrayContaining(["R$ 49,90", "30", "Aceleriq"]));
    // Título Com Maiúscula Em Tudo não vira nome intocável.
    expect(intocaveis([{ papel: "headline", texto: "Como Vender Mais No Instagram" }])).toEqual([]);

    const card: LaminaDoTexto = { ordem: 3, funcao: "conteudo", texto_exato: blocos.map((b) => b.texto).join("\n"), blocos: blocos.concat([{ papel: "apoio", texto: palavrasDe(20) + "." }]) };
    card.texto_exato = card.blocos!.map((b) => b.texto).join("\n");
    // Perdeu o preço: cai no corte do original, com aviso.
    const semPreco = aplicarTextoNaGeracao(card, 5, { blocos: [{ papel: "headline", texto: "Plano mensal" }, { papel: "apoio", texto: "A Aceleriq acompanha 30 dias." }] });
    expect(semPreco.origem).toBe("corte");
    expect(semPreco.aviso).toContain("R$ 49,90");
    expect(semPreco.texto).toContain("R$ 49,90");
    expect(passaNaGeracao({ ...card, texto_exato: semPreco.texto, blocos: semPreco.blocos }, 5)).toBe(false);
    // Manteve tudo e ainda passa: corta a resposta no fim de frase, com aviso.
    const longa = aplicarTextoNaGeracao(card, 5, {
      blocos: [{ papel: "headline", texto: "Plano de R$ 49,90" }, { papel: "apoio", texto: `A Aceleriq acompanha 30 dias. ${palavrasDe(30)}.` }],
    });
    expect(longa.origem).toBe("redator");
    expect(longa.aviso).toContain("cortado no fim de frase");
    expect(passaNaGeracao({ ...card, texto_exato: longa.texto, blocos: longa.blocos }, 5)).toBe(false);

    // Fechamento: o CTA volta exatamente como era, mesmo se o redator mexer nele.
    const fechamento: LaminaDoTexto = {
      ordem: 5,
      funcao: "cta",
      texto_exato: `Fale com a gente\n${palavrasDe(25)}.\nChame no WhatsApp`,
      blocos: [{ papel: "headline", texto: "Fale com a gente" }, { papel: "apoio", texto: `${palavrasDe(25)}.` }, { papel: "cta", texto: "Chame no WhatsApp" }],
    };
    const r = aplicarTextoNaGeracao(fechamento, 5, { blocos: [{ papel: "headline", texto: "Fale com a gente" }, { papel: "apoio", texto: "Resposta no mesmo dia." }, { papel: "cta", texto: "Clique aqui" }] });
    expect(r.origem).toBe("redator");
    expect(r.blocos.filter((b) => b.papel === "cta")).toEqual([{ papel: "cta", texto: "Chame no WhatsApp" }]);
    expect(r.texto).not.toContain("Clique aqui");
  });

  it("redator fora do ar: corte do original, com aviso, sem guardar", async () => {
    const guardar = vi.fn(async () => undefined);
    const r = await enxugarNaGeracao(
      { card: laminaLonga(), total: 5 },
      { pasta: "c1", lerGuardado: async () => null, guardar, escrever: async () => { throw new Error("fora"); } },
    );
    expect(r!.origem).toBe("corte");
    expect(r!.aviso).toContain("não respondeu");
    expect(r!.custoUsd).toBe(0);
    expect(guardar).not.toHaveBeenCalled();
    expect(passaNaGeracao({ ...laminaLonga(), texto_exato: r!.texto, blocos: r!.blocos }, 5)).toBe(false);
    // O corte guarda a headline inteira e só frases inteiras do apoio.
    const cortados = cortarNaGeracao(laminaLonga(), 5);
    expect(cortados[0]).toEqual({ papel: "headline", texto: "Responda em 5 minutos" });
    expect(cortados.slice(1).every((b) => /[.!?]$/.test(b.texto))).toBe(true);
  });

  it("a tela: frase do enxuto só enquanto o texto é o enxuto e não mandaram manter", () => {
    const registro = { original: "a b c d", texto: "a b", palavras_antes: 4, palavras_depois: 2, aviso: null };
    expect(textoDoEnxuto({ ordem: 2, texto_exato: "a b", texto_na_geracao: registro })).toBe("Enxugado ao gerar: de 4 para 2 palavras.");
    expect(textoDoEnxuto({ ordem: 2, texto_exato: "outro", texto_na_geracao: registro })).toBeNull();
    expect(textoDoEnxuto({ ordem: 2, texto_exato: "a b", texto_na_geracao: { ...registro, manter: true } })).toBeNull();
    expect(textoDoEnxuto({ ordem: 2, texto_exato: "a b" })).toBeNull();
  });
});

// ------------------------------------------------------------------ 2. dividir em partes

describe("2. Dividir em partes dentro da lâmina (em código, por tipo de texto)", () => {
  const confere = (blocos: BlocoDaLamina[]) => {
    const p = dividirEmPartes(blocos)!;
    expect(p).not.toBeNull();
    // Só divide: as palavras continuam as mesmas (a conferência compara palavras).
    mesmas([p.titulo, p.abertura, ...p.partes, p.apoio].filter(Boolean).join(" "), blocos.map((b) => b.texto).join(" ").replace(/[•]/g, " "));
    expect(p.partes.length).toBeGreaterThanOrEqual(2);
    expect(p.partes.length).toBeLessThanOrEqual(4);
    return p;
  };

  it("lista com marcadores: uma parte por item", () => {
    const p = confere([{ papel: "headline", texto: "3 sinais de alerta" }, { papel: "apoio", texto: "• Preço sem valor\n• Atendimento lento\n• Nenhum pós-venda" }]);
    expect(p.forma).toBe("lista");
    expect(p.partes).toEqual(["Preço sem valor", "Atendimento lento", "Nenhum pós-venda"]);
  });

  it("enumeração com abertura: os itens viram as partes", () => {
    const p = confere([{ papel: "headline", texto: "Por que as vendas travam" }, { papel: "apoio", texto: "Três sinais: preço sem valor, atendimento lento e falta de pós-venda." }]);
    expect(p.forma).toBe("lista");
    expect(p.abertura).toBe("Três sinais:");
    expect(p.partes).toEqual(["preço sem valor", "atendimento lento", "e falta de pós-venda."]);
  });

  it("passos marcados no texto", () => {
    const p = confere([{ papel: "headline", texto: "Como organizar" }, { papel: "apoio", texto: "Primeiro, organize o estoque. Depois, publique as ofertas. Por fim, meça o resultado." }]);
    expect(p.forma).toBe("passos");
    expect(p.partes).toHaveLength(3);
    expect(p.partes[1]).toMatch(/^Depois/);
  });

  it("comparação (antes e depois): uma metade de cada lado", () => {
    const p = confere([{ papel: "headline", texto: "O que muda" }, { papel: "apoio", texto: "Antes: você respondia em dois dias. Depois: responde em cinco minutos e vende mais." }]);
    expect(p.forma).toBe("comparacao");
    expect(p.partes).toHaveLength(2);
    expect(p.partes[1]).toMatch(/^Depois/);
  });

  it("dois argumentos (duas frases) e frase longa com conjunção", () => {
    const duas = confere([
      { papel: "headline", texto: "Confiança vende" },
      { papel: "apoio", texto: "Quem responde rápido passa confiança para o cliente. Quem passa confiança fecha mais vendas no mês." },
    ]);
    expect(duas.forma).toBe("argumentos");
    const uma = confere([
      { papel: "headline", texto: "Confiança vende" },
      { papel: "apoio", texto: "Quem responde rápido passa confiança para o cliente e quem passa confiança fecha mais vendas no fim do mês" },
    ]);
    expect(uma.forma).toBe("argumentos");
    expect(uma.partes[1]).toMatch(/^e /);
  });

  it("texto que cabe num bloco não divide; o bloco só entra no miolo", () => {
    expect(dividirEmPartes(laminaCurta().blocos!)).toBeNull();
    expect(dividirEmPartes([{ papel: "headline", texto: "Só o título" }])).toBeNull();
    const blocos: BlocoDaLamina[] = [{ papel: "headline", texto: "3 sinais" }, { papel: "apoio", texto: "• Preço sem valor\n• Atendimento lento\n• Nenhum pós-venda" }];
    const bloco = blocoDoTextoEmPartes({ ordem: 3, total: 5, blocos, componente: "checklist", zona: "coluna-esquerda" });
    expect(bloco).toContain("TEXTO EM PARTES (lâmina 3 de 5)");
    expect(bloco).toContain("não vai num parágrafo único num canto");
    expect(bloco).toContain('1) "Preço sem valor" 2) "Atendimento lento" 3) "Nenhum pós-venda"');
    expect(bloco).toContain("item do checklist");
    expect(bloco).toContain("empilhadas na coluna");
    expect(bloco).not.toContain("—");
    expect(blocoDoTextoEmPartes({ ordem: 1, total: 5, blocos })).toBe("");
    expect(blocoDoTextoEmPartes({ ordem: 2, total: 2, blocos })).toBe("");
    expect(blocoDoTextoEmPartes({ ordem: 3, total: 5, blocos: laminaCurta().blocos! })).toBe("");
    // Comparação lado a lado; arranjo dividido na faixa de baixo; cena fixa sem caixa.
    const comp: BlocoDaLamina[] = [{ papel: "headline", texto: "O que muda" }, { papel: "apoio", texto: "Antes: você respondia em dois dias. Depois: responde em cinco minutos e vende mais." }];
    expect(blocoDoTextoEmPartes({ ordem: 2, total: 5, blocos: comp, componente: "colunas_comparacao" })).toContain("lado a lado");
    expect(blocoDoTextoEmPartes({ ordem: 2, total: 5, blocos, dividido: true })).toContain("na faixa de baixo");
    expect(blocoDoTextoEmPartes({ ordem: 2, total: 5, blocos, cenaFixa: true })).toContain("sem caixa nem painel atrás");
  });
});

// ------------------------------------------------------------------ 3. posição na série

const serieDoRoteiro = (total: number): LaminaDaSerie[] =>
  Array.from({ length: total }, (_, i) => {
    const ordem = i + 1;
    const funcao = ordem === 1 ? "capa" : ordem === total ? "cta" : "conteudo";
    return { ordem, funcao, layout: layoutPadrao(funcao, ordem, total) };
  });

describe("3. Posição que varia na série (modo normal, também sem referência)", () => {
  it("o assunto pela descrição da imagem; o que fala do texto não conta", () => {
    expect(ladoDaImagem({ imagem: "fotografia vertical na metade direita, sangrando pela borda", ponto_focal: "divisão assimétrica entre texto e imagem" })).toBe("direita");
    expect(ladoDaImagem({ imagem: "fotografia ou objeto do assunto na metade inferior", ponto_focal: "headline no topo e imagem na base" })).toBe("base");
    expect(ladoDaImagem({ imagem: "fotografia ampla ocupando os dois terços de cima", ponto_focal: "imagem no alto, texto ancorado na base" })).toBe("topo");
    expect(ladoDaImagem({ imagem: "produto no canto inferior direito", ponto_focal: "" })).toBe("ambiguo");
    expect(ladoDaImagem({ imagem: "elemento gráfico em tom suave", ponto_focal: "o texto à direita" })).toBeNull();
    expect(espelharTexto("Fotografia na metade direita, olhando para a esquerda", "h")).toBe("Fotografia na metade esquerda, olhando para a direita");
    expect(espelharTexto("imagem no alto, texto ancorado na base; terço superior", "v")).toBe("imagem embaixo, texto ancorado no topo; terço inferior");
  });

  it("roteiro padrão (tudo à esquerda): a série passa a alternar, sem repetir a vizinha; capa e fechamento ficam", () => {
    const cards = serieDoRoteiro(5);
    const plano = planoDePosicoes(cards);
    expect(plano.map((p) => p.zona)).toEqual(["base-esquerda", "topo-centro", "coluna-esquerda", "base-direita", "centro"]);
    expect(plano[0].fixa && !plano[0].mudou).toBe(true);
    expect(plano[4].fixa && !plano[4].mudou).toBe(true);
    for (let i = 1; i < plano.length; i++) {
      expect(plano[i].zona).not.toBe(plano[i - 1].zona);
      expect(plano[i].eixo).not.toBe(plano[i - 1].eixo);
    }
    // Não fica tudo do mesmo lado.
    expect(new Set(plano.map((p) => p.lado)).size).toBeGreaterThanOrEqual(3);
    // Mudou de lado no vertical: a descrição da imagem vai junto (o assunto não fica embaixo do texto).
    const l4 = aplicarPosicao(cards[3] as LaminaDaSerie & { [k: string]: unknown }, plano[3], 5) as LaminaDaSerie;
    expect(l4.layout!.zona_texto).toBe("base-direita");
    expect(l4.layout!.imagem).toBe(cards[3].layout!.imagem);
  });

  it("série longa: nenhuma lâmina repete a zona ou o eixo da anterior e o mesmo lado não aparece 3 vezes seguidas", () => {
    for (const total of [3, 4, 6, 8, 10]) {
      const plano = planoDePosicoes(serieDoRoteiro(total));
      for (let i = 1; i < plano.length; i++) {
        expect(plano[i].zona, `total ${total}, lâmina ${i + 1}`).not.toBe(plano[i - 1].zona);
        expect(plano[i].eixo, `total ${total}, lâmina ${i + 1}`).not.toBe(plano[i - 1].eixo);
        if (i >= 2 && plano[i].lado !== "centro") {
          expect(plano[i].lado === plano[i - 1].lado && plano[i - 1].lado === plano[i - 2].lado, `total ${total}, lâmina ${i + 1}`).toBe(false);
        }
      }
    }
  });

  it("respeita o ponto focal: com o assunto à direita, o texto só vai para a direita espelhando a descrição", () => {
    const cards: LaminaDaSerie[] = [
      { ordem: 1, funcao: "capa", layout: { ...layoutPadrao("capa", 1, 4), zona_texto: "coluna-esquerda" } },
      { ordem: 2, funcao: "conteudo", layout: { ...layoutPadrao("conteudo", 3, 4), imagem: "fotografia vertical na metade direita, sangrando pela borda", ponto_focal: "divisão assimétrica entre texto e imagem" } },
      { ordem: 3, funcao: "conteudo", layout: layoutPadrao("conteudo", 2, 4) },
      { ordem: 4, funcao: "cta", layout: layoutPadrao("cta", 4, 4) },
    ];
    const plano = planoDePosicoes(cards);
    expect(plano[1].zona).toBe("coluna-direita");
    expect(plano[1].espelho).toBe("h");
    const l2 = aplicarPosicao(cards[1] as LaminaDaSerie & { [k: string]: unknown }, plano[1], 4) as LaminaDaSerie & { posicao_na_serie?: unknown; composicao?: string };
    expect(l2.layout!.imagem).toBe("fotografia vertical na metade esquerda, sangrando pela borda");
    expect(l2.composicao).toContain("coluna direita");
    expect(l2.posicao_na_serie).toMatchObject({ zona: "coluna-direita", espelho: "h", de: { zona: "coluna-esquerda" } });
    // Assunto ambíguo: a zona da direção fica.
    const ambiguo = planoDePosicoes([cards[0], { ...cards[1], layout: { ...cards[1].layout, imagem: "produto no canto inferior direito" } }, cards[2], cards[3]]);
    expect(ambiguo[1].zona).toBe(normalizada(cards[1]));
  });

  it("ficam como estão: foto, referência própria, contínuo, anúncio, carrossel de 2 e a lâmina já decidida", () => {
    const cards = serieDoRoteiro(5);
    const comFoto = cards.map((c) => (c.ordem === 2 ? { ...c, imagens_ids: ["f1"] } : c.ordem === 4 ? { ...c, referencias_ids: ["r1"] } : c));
    const plano = planoDePosicoes(comFoto);
    expect(plano[1]).toMatchObject({ fixa: true, mudou: false, zona: "topo-esquerda" });
    expect(plano[3]).toMatchObject({ fixa: true, mudou: false, zona: "base-esquerda" });
    expect(planoDePosicoes(cards, { continuo: true }).every((p) => p.fixa && !p.mudou)).toBe(true);
    expect(planoDePosicoes(cards, { ads: true }).every((p) => p.fixa && !p.mudou)).toBe(true);
    expect(planoDePosicoes(serieDoRoteiro(2)).every((p) => !p.mudou)).toBe(true);
  });

  it("idempotente: gravar a decisão e planejar de novo dá o mesmo (lâminas em paralelo concordam)", () => {
    const cards = serieDoRoteiro(6);
    const plano = planoDePosicoes(cards);
    const gravadas = cards.map((c, i) => (plano[i].mudou ? aplicarPosicao(c as LaminaDaSerie & { [k: string]: unknown }, plano[i], 6) : c)) as LaminaDaSerie[];
    const de_novo = planoDePosicoes(gravadas);
    expect(de_novo.map((p) => p.zona)).toEqual(plano.map((p) => p.zona));
    expect(de_novo.every((p) => !p.mudou)).toBe(true);
    // Gravando uma lâmina só (a 3), as outras continuam com a mesma decisão.
    const umaSo = cards.map((c, i) => (i === 2 && plano[i].mudou ? aplicarPosicao(c as LaminaDaSerie & { [k: string]: unknown }, plano[i], 6) : c)) as LaminaDaSerie[];
    expect(planoDePosicoes(umaSo).map((p) => p.zona)).toEqual(plano.map((p) => p.zona));
  });

  it("arranjo dividido: título no alto, apoio na faixa de baixo (também na área da correção)", () => {
    const cards: LaminaDaSerie[] = [
      { ordem: 1, funcao: "capa", layout: { ...layoutPadrao("capa", 1, 5), zona_texto: "topo-esquerda" } },
      { ordem: 2, funcao: "conteudo", layout: { ...layoutPadrao("conteudo", 5, 5), zona_texto: "base-esquerda", imagem: "elemento gráfico em tom suave", ponto_focal: "a palavra-chave" } },
      { ordem: 3, funcao: "conteudo", layout: { ...layoutPadrao("conteudo", 5, 5), zona_texto: "centro", imagem: "elemento gráfico em tom suave", ponto_focal: "a palavra-chave" } },
      { ordem: 4, funcao: "conteudo", layout: { ...layoutPadrao("conteudo", 5, 5), zona_texto: "coluna-esquerda", imagem: "elemento gráfico em tom suave", ponto_focal: "a palavra-chave" } },
      { ordem: 5, funcao: "cta", layout: { ...layoutPadrao("cta", 5, 5), zona_texto: "coluna-direita" } },
    ];
    const plano = planoDePosicoes(cards);
    for (let i = 1; i < plano.length; i++) expect(plano[i].eixo).not.toBe(plano[i - 1].eixo);
    const card = { ordem: 3, funcao: "conteudo", layout: { zona_texto: "topo-centro" }, posicao_na_serie: { zona: "topo-centro", dividido: true } };
    expect(zonaExtraDoTexto(card)).toBe("base-centro");
    expect(zonaExtraDoTexto({ ...card, layout: { zona_texto: "centro" } })).toBeNull();
    const bloco = blocoDoArranjoDividido({ ordem: 3, total: 5 });
    expect(bloco).toContain("ARRANJO DIVIDIDO");
    expect(bloco).toContain("faixa de baixo");
    expect(bloco).not.toContain("—");
  });
});

const normalizada = (c: LaminaDaSerie) => (c.layout && c.layout.zona_texto) as ZonaTexto;

// ------------------------------------------------------------------ 4. dividir em 2 lâminas

const trabalhoDe = (cards: LaminaDoTexto[], versoes: number[]): TrabalhoParaDividir => ({
  direcao: { cards: cards.map((c) => ({ ...c, layout: layoutPadrao(String(c.funcao), c.ordem, cards.length) })), versoes_arquivadas: [{ ordem: 3, versao: 1 }] },
  cards: versoes.map((o) => ({ ordem: o, versao: 2, storage_path: `v${o}.png` })),
});
const deps = {
  blocosDe: (t: string, f: string) => blocosDoTexto(t, f) as BlocoDaLamina[],
  layoutDe: (f: string, o: number, total: number) => {
    const layout = layoutPadrao(f, o, total);
    return { layout, composicao: `Texto em ${layout.zona_texto}`, ilustracao: layout.imagem };
  },
};

describe("4. Sugerir dividir em 2 lâminas (sem fazer sozinho)", () => {
  it("só a lâmina que não cabe e tem mais de uma ideia; a capa e o curto não", () => {
    const s = sugestaoDeDividirEmDuas(laminaLonga(2), 5)!;
    expect(s).not.toBeNull();
    expect(s.primeira.split("\n")[0]).toBe("Responda em 5 minutos");
    mesmas(`${s.primeira} ${s.segunda}`, laminaLonga(2).texto_exato!);
    // As metades ficam equilibradas.
    expect(Math.abs(contarPalavras(s.primeira) - contarPalavras(s.segunda))).toBeLessThan(contarPalavras(laminaLonga().texto_exato!) / 2);
    expect(sugestaoDeDividirEmDuas(laminaCurta(2), 5)).toBeNull();
    expect(sugestaoDeDividirEmDuas({ ...laminaLonga(1), funcao: "capa" }, 5)).toBeNull();
    expect(sugestaoDeDividirEmDuas(laminaLonga(1), 1)).toBeNull();
    expect(textoDaSugestaoDeDividir([3])).toBe("Lâmina 3: dá para dividir em 2 (ferramenta Lâmina).");
    expect(textoDaSugestaoDeDividir([2, 4])).toBe("Lâminas 2 e 4: dá para dividir em 2 (ferramenta Lâmina).");
    expect(textoDaSugestaoDeDividir([])).toBeNull();
  });

  it("no fechamento, o CTA vai para a lâmina nova (a última)", () => {
    const fechamento: LaminaDoTexto = {
      ordem: 4,
      funcao: "cta",
      texto_exato: `Fale com a gente\n${APOIO_LONGO}\nChame no WhatsApp`,
      blocos: [{ papel: "headline", texto: "Fale com a gente" }, { papel: "apoio", texto: APOIO_LONGO }, { papel: "cta", texto: "Chame no WhatsApp" }],
    };
    const s = sugestaoDeDividirEmDuas(fechamento, 4)!;
    expect(s.primeira).not.toContain("Chame no WhatsApp");
    expect(s.segunda.split("\n").pop()).toBe("Chame no WhatsApp");
  });

  it("dividir cria a lâmina seguinte, anda as de depois com as versões; juntar desfaz", () => {
    const cards: LaminaDoTexto[] = [
      { ordem: 1, funcao: "capa", texto_exato: "Venda mais no WhatsApp" },
      laminaLonga(2),
      { ordem: 3, funcao: "conteudo", texto_exato: "Use respostas prontas\nGanhe tempo." },
      { ordem: 4, funcao: "cta", texto_exato: "Fale com a gente\nChame no WhatsApp" },
    ];
    const t = trabalhoDe(cards, [1, 2, 3, 4]);
    const r = dividirLaminaEmDuas(t, 2, deps);
    expect(r.nova).toBe(3);
    const novos = r.patch.direcao.cards;
    expect(novos.map((c) => c.ordem)).toEqual([1, 2, 3, 4, 5]);
    expect(novos[2]).toMatchObject({ ordem: 3, funcao: "conteudo", dividida_de: 2 });
    expect(novos[3].texto_exato).toBe("Use respostas prontas\nGanhe tempo.");
    expect(novos[4]).toMatchObject({ ordem: 5, funcao: "cta" });
    expect(r.patch.cards.map((v) => v.ordem)).toEqual([1, 2, 4, 5]);
    expect(r.patch.cards.find((v) => v.storage_path === "v3.png")!.ordem).toBe(4);
    expect(r.patch.direcao.versoes_arquivadas).toEqual([{ ordem: 4, versao: 1 }]);
    mesmas(`${novos[1].texto_exato} ${novos[2].texto_exato}`, laminaLonga(2).texto_exato!);

    const volta = juntarLaminas({ direcao: r.patch.direcao, cards: r.patch.cards }, 2, deps);
    expect(volta.patch.direcao.cards.map((c) => [c.ordem, c.texto_exato, c.funcao])).toEqual(t.direcao.cards.map((c) => [c.ordem, c.texto_exato, c.funcao]));
    expect(volta.patch.direcao.cards[1].blocos).toEqual(laminaLonga(2).blocos);
    expect(volta.patch.cards).toEqual(t.cards);
    expect(volta.patch.direcao.versoes_arquivadas).toEqual([{ ordem: 3, versao: 1 }]);
    // Com arte na lâmina nova, juntar recusa (a equipe decide pela tela).
    expect(() => juntarLaminas({ direcao: r.patch.direcao, cards: r.patch.cards.concat([{ ordem: 3, versao: 1 }]) }, 2, deps)).toThrow(/já tem arte/);
  });

  it("recusa com o motivo: contínuo, lâmina que cabe e 20 lâminas", () => {
    const cards: LaminaDoTexto[] = [{ ordem: 1, funcao: "capa", texto_exato: "Capa" }, laminaLonga(2), { ordem: 3, funcao: "cta", texto_exato: "Fim" }];
    expect(() => dividirLaminaEmDuas({ ...trabalhoDe(cards, []), direcao: { ...trabalhoDe(cards, []).direcao, carrossel_infinito: true } }, 2, deps)).toThrow(/contínuo/);
    expect(() => dividirLaminaEmDuas(trabalhoDe([cards[0], laminaCurta(2), cards[2]], []), 2, deps)).toThrow(/não tem como dividir/);
    const vinte = Array.from({ length: 20 }, (_, i) => (i === 1 ? laminaLonga(2) : { ordem: i + 1, funcao: i === 0 ? "capa" : i === 19 ? "cta" : "conteudo", texto_exato: "Curto" }));
    expect(() => dividirLaminaEmDuas(trabalhoDe(vinte, []), 2, deps)).toThrow(/20 lâminas/);
  });
});

// ------------------------------------------------------------------ 5. ligação

describe("5. Ligação no servidor e na tela", () => {
  const servidor = ler("supabase/functions/estudio-arte/index.ts");
  const corpoDe = (nome: string) => {
    const i = servidor.indexOf(`async function ${nome}(`);
    const resto = servidor.slice(i);
    const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\nconst ACOES/);
    return resto.slice(0, fim + 10);
  };

  it("gerarCard: enxuga depois da tipografia, a posição entra antes da zona do texto, o custo vai na versão", () => {
    const g = corpoDe("gerarCard");
    const enxuga = g.indexOf("const textoNaGeracao = ads ? null : await textoDaLaminaNaGeracao(t, card,");
    expect(enxuga).toBeGreaterThan(g.indexOf("if (!tipografia) throw new ErroEstudio(SEM_TIPOGRAFIA.status"));
    expect(enxuga).toBeLessThan(g.indexOf("const [foto] = card.imagens_ids?.length"));
    const posicao = g.indexOf("if (posicaoDaSerie) cardDoPrompt = posicaoDaSerie.card;");
    expect(posicao).toBeGreaterThan(0);
    expect(posicao).toBeLessThan(g.indexOf("const zonaDoTexto = normalizarLayout(cardDoPrompt.layout"));
    expect(g).toContain("!replicar && !ads && !baseFoto && !recorteNaLamina && !elementos.length && !panorama ? await posicaoDaLaminaNaSerie(t, cardDoPrompt)");
    expect((g.match(/custoExtraUsd: textoNaGeracao \? textoNaGeracao\.custoUsd : 0,/g) || []).length).toBe(5);
    // Os blocos novos ficam antes da variação (a ordem que outros testes fixam continua).
    expect(g.indexOf("partesDaLamina ? blocoDoTextoEmPartes({")).toBeLessThan(g.indexOf("blocoDeVariacao(versoesAntes, !!baseFoto || !!recorteNaLamina"));
    expect(g).toContain("...(textoNaGeracao ? { texto_na_geracao: textoNaGeracao.resumo } : {}),");
  });

  it("helpers: grava na direção só se o texto não mudou; ação com confirmação; preparar sugere dividir", () => {
    const t = corpoDe("textoDaLaminaNaGeracao");
    expect(t).toContain('String(c.texto_exato || "") === original ? trocar(c) : c');
    expect(t).toContain("custo_usd: arred(num(x.custo_usd) + custo)");
    const a = corpoDe("textoDaLamina");
    expect(a.indexOf('corpo.confirmado !== true')).toBeLessThan(a.indexOf("dividirLaminaEmDuas(alvo, ordem, deps)"));
    expect(a).toContain("await filaDoTrabalhoAndando(t)");
    expect(a).toContain('toolName: "estudio_texto_da_lamina"');
    expect(servidor).toContain("texto_da_lamina: textoDaLamina,");
    expect(servidor).toContain("miolo_enxuto: mioloEnxuto, miolo_longo: mioloLongo, dividir_em_duas: dividirEmDuas");
    expect(servidor).toContain("const extra = zonaExtraDoTexto(card as CardDirecao & { posicao_na_serie?: unknown });");
  });

  it("tela: o custo da chamada curta entra no Gerar; o aviso e o dividir ficam na ferramenta Lâmina", () => {
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("precisaEnxugarNaGeracao({ card: c as unknown as LaminaDoTexto, total: cardsDaDirecao.length, capaComVersao: ultimas.has(1) })");
    expect(aba).toContain("tokensEntrada: TAMANHO_DO_ENXUGAR.entrada");
    expect(aba).toContain("<EstudioTextoDaLamina");
    expect(aba).toContain("textoDaSugestaoDeDividir(r && r.dividir_em_duas)");
    const tela = ler("src/components/mesa/EstudioTextoDaLamina.tsx");
    expect(tela).toContain('pedir("dividir", { confirmado: true })');
    expect(tela).toContain('label: "Desfazer"');
    expect(tela).toContain('pedir("voltar_original")');
    expect(tela).not.toContain("—");
  });

  it("registro em _shared/motores.ts", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.filter((x) => x.id === "texto_da_lamina")[0];
    expect(m).toBeTruthy();
    for (const trecho of m.ligacao.trechos) expect(servidor).toContain(trecho);
    expect(`${m.pedido} ${m.o_que} ${m.intocado}`).not.toContain("—");
  });
});

// ------------------------------------------------------------------ 6. tela

describe("6. Tela: aviso na ferramenta Lâmina, dividir com confirmação e Desfazer", () => {
  beforeEach(() => {
    mock.chamar.mockReset();
    Object.values(mock.toast).forEach((f) => f.mockReset());
  });

  it("lâmina curta: nada aparece", () => {
    const { container } = render(h(EstudioTextoDaLamina, { trabalhoId: "t1", card: laminaCurta(2) as any, total: 5, capaComVersao: true, onMudou: () => undefined }));
    expect(container.textContent).toBe("");
  });

  it("lâmina longa: avisa que enxuga ao gerar; dividir mostra a prévia e só divide ao confirmar; o aviso traz o Desfazer", async () => {
    const onMudou = vi.fn();
    mock.chamar.mockResolvedValue({ trabalho: {}, ordem: 2, nova: 3 });
    render(h(EstudioTextoDaLamina, { trabalhoId: "t1", card: laminaLonga(2) as any, total: 5, capaComVersao: true, onMudou }));
    expect(screen.getByText(TEXTO_VAI_ENXUGAR)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dividir em 2 lâminas/ }));
    // Prévia das duas lâminas; nada foi chamado ainda.
    expect(screen.getByText("Lâmina 3 (nova)")).toBeTruthy();
    expect(mock.chamar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Dividir$/ }));
    await waitFor(() => expect(mock.chamar).toHaveBeenCalledTimes(1));
    expect(mock.chamar.mock.calls[0]).toEqual(["estudio-arte", { acao: "texto_da_lamina", trabalho_id: "t1", ordem: 2, operacao: "dividir", confirmado: true }]);
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
    const [titulo, opcoes] = mock.toast.success.mock.calls[0];
    expect(titulo).toBe("Lâmina 2 dividida em 2");
    expect(opcoes.action.label).toBe("Desfazer");
    opcoes.action.onClick();
    await waitFor(() => expect(mock.chamar).toHaveBeenCalledTimes(2));
    expect(mock.chamar.mock.calls[1][1]).toMatchObject({ operacao: "juntar", ordem: 2 });
  });

  it("lâmina enxugada ao gerar: mostra quanto saiu e Voltar ao original chama a ação", async () => {
    const onMudou = vi.fn();
    mock.chamar.mockResolvedValue({ trabalho: {} });
    const card = { ordem: 2, funcao: "conteudo", texto_exato: "Responda em 5 minutos\nResposta rápida vende.", texto_na_geracao: { original: laminaLonga(2).texto_exato, texto: "Responda em 5 minutos\nResposta rápida vende.", palavras_antes: 45, palavras_depois: 7, aviso: null } };
    render(h(EstudioTextoDaLamina, { trabalhoId: "t1", card, total: 5, capaComVersao: true, onMudou }));
    expect(screen.getByText("Enxugado ao gerar: de 45 para 7 palavras.")).toBeTruthy();
    expect(screen.queryByText(TEXTO_VAI_ENXUGAR)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Voltar ao original/ }));
    await waitFor(() => expect(mock.chamar).toHaveBeenCalledTimes(1));
    expect(mock.chamar.mock.calls[0][1]).toMatchObject({ acao: "texto_da_lamina", operacao: "voltar_original", ordem: 2 });
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it("contínuo não oferece dividir", () => {
    render(h(EstudioTextoDaLamina, { trabalhoId: "t1", card: laminaLonga(2) as any, total: 5, capaComVersao: true, continuo: true, onMudou: () => undefined }));
    expect(screen.queryByRole("button", { name: /Dividir em 2 lâminas/ })).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O servidor do motor importa o motor de IA (npm:) e o contexto completo (banco): no teste, os dois são falsos.
vi.mock("../../supabase/functions/_shared/ia-motor.ts", () => ({
  cobrarJev: vi.fn(async () => ({ custoUsd: 0.0002 })),
}));
vi.mock("../../supabase/functions/_shared/contexto-completo-da-marca.ts", () => ({
  contextoCompletoParaPrompt: vi.fn(async () => {
    throw new Error("sem banco no teste");
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { conferirCopies, type PedidoDaConferencia } from "../../supabase/functions/_shared/motor-de-copy-servidor";
import { JevErro, type ResultadoJev } from "../../supabase/functions/_shared/jev";
import {
  blocoDoMotor,
  conferirCopy,
  limparCopy,
  ofertaDosFatos,
  TETO_DA_OFERTA,
  temTravessao,
} from "../../supabase/functions/_shared/motor-de-copy";
import { legendaDoItem } from "../../supabase/functions/agente-calendario/modulos/legenda-do-item";
import { avisoComAsFrasesDaCasa, roteiroPeloMotorDeCopy } from "../../supabase/functions/mesa-roteiros/modulos/roteiro-pela-casa";
import type { Roteiro } from "../../supabase/functions/_shared/roteiro-modelo";
import { estimarCusto, estimarLocal, parteDaConferenciaDoJev, type ModeloIa } from "@/lib/mesa/api";

const TRAVESSAO = String.fromCharCode(0x2014);
const MEIA_RISCA = String.fromCharCode(0x2013);

describe("motor de copy: travessão sem destruir faixa de horário e de preço", () => {
  it("deixa o meia-risca colado (9h-18h, seg-sex, R$ 50-80) e troca o travessão", () => {
    const faixa = `Atendimento seg${MEIA_RISCA}sex, 9h${MEIA_RISCA}18h. Preços de R$ 50${MEIA_RISCA}80.`;
    const r = limparCopy(faixa, "legenda");
    expect(r.texto).toBe(faixa);
    expect(r.ajustes).toEqual([]);
    expect(temTravessao(faixa)).toBe(false);
    expect(conferirCopy(`${faixa}\nAgende pelo WhatsApp.`, "legenda").problemas.map((p) => p.tipo)).not.toContain("travessao");
  });

  it("troca o travessão em qualquer lugar e o meia-risca só entre espaços ou no começo da linha", () => {
    const r = limparCopy(`Seu carro ${TRAVESSAO} e você${TRAVESSAO}também.\n${MEIA_RISCA} item da lista\nAntes ${MEIA_RISCA} depois, das 9h${MEIA_RISCA}18h.`, "legenda");
    expect(r.texto).toBe("Seu carro, e você, também.\nitem da lista\nAntes, depois, das 9h" + MEIA_RISCA + "18h.");
    expect(r.ajustes).toContain("travessão trocado por vírgula");
    expect(temTravessao(`A ${MEIA_RISCA} B`)).toBe(true);
    expect(temTravessao(`${MEIA_RISCA} começo`)).toBe(true);
    expect(conferirCopy(`Oferta ${TRAVESSAO} agende já.`, "legenda").problemas.map((p) => p.tipo)).toContain("travessao");
  });
});

describe("motor de copy: promessa sem falso positivo", () => {
  const promessas = (t: string) => conferirCopy(`${t}\nChame no WhatsApp.`, "legenda").problemas.filter((p) => p.tipo === "promessa");

  it("endereço, ordinal e cura de alimento ou de obra não são promessa", () => {
    expect(promessas("Rua das Flores, nº 1, Centro")).toEqual([]);
    expect(promessas("Agende no 1º dia do mês")).toEqual([]);
    expect(promessas("Agende no dia 1 de outubro")).toEqual([]);
    expect(promessas("O processo de cura do pernil leva 12 meses")).toEqual([]);
    expect(promessas("A cura do concreto pede 28 dias")).toEqual([]);
    expect(promessas("Queijo com cura de 60 dias")).toEqual([]);
  });

  it("superlativo e cura no sentido de saúde continuam promessa", () => {
    expect(promessas("A número 1 em Curitiba")).toHaveLength(1);
    expect(promessas("Somos o nº 1 do Brasil")).toHaveLength(1);
    expect(promessas("O melhor da cidade")).toHaveLength(1);
    expect(promessas("A cura da ansiedade em 7 dias")).toHaveLength(1);
    expect(promessas("Vamos curar a dor nas costas")).toHaveLength(1);
    expect(promessas("Cura definitiva para a queda")).toHaveLength(1);
    expect(promessas("Um milagre para a pele")).toHaveLength(1);
  });
});

describe("motor de copy: legenda do item do Mês e oferta dos fatos", () => {
  it("limpa a legenda e só cobra CTA quando o item não tem um", () => {
    const comCta = legendaDoItem(`No mundo de hoje ${TRAVESSAO} tudo muda.`, true);
    expect(comCta.texto).toBe("No mundo de hoje, tudo muda.");
    const tipos = comCta.avisos.join(" ");
    expect(tipos).toContain("Legenda: Clichê de IA");
    expect(tipos).not.toContain("Sem CTA");
    expect(legendaDoItem("Troca de óleo no Bacacheri.", false).avisos.join(" ")).toContain("Legenda: Sem CTA claro");
    expect(legendaDoItem("", false)).toEqual({ texto: "", avisos: [] });
  });

  it("monta a oferta com os fatos na ordem, sem vazio e no teto", () => {
    const o = ofertaDosFatos([
      ["Projeto", "Site da Thainá"],
      ["Itens e valores", [{ nome: "Gestão de Instagram", valor_unitario: 1500 }]],
      ["Vazio", ""],
      ["Lista vazia", []],
      ["Nada", null],
      ["Reunião", "x".repeat(5000)],
    ]);
    const linhas = o.split("\n");
    expect(linhas[0]).toBe("Projeto: Site da Thainá");
    expect(linhas[1]).toContain("Gestão de Instagram");
    expect(linhas[1]).toContain("1500");
    expect(linhas).toHaveLength(3);
    expect(o.length).toBeLessThanOrEqual(TETO_DA_OFERTA);
  });

  it("com texto previsto, a variação 1 parte dele e as outras contam a mesma ideia", () => {
    const b = blocoDoMotor({ canal: "legenda", objetivo: "venda", variacoes: 3, partirDoPrevisto: true });
    expect(b).toContain("a variação 1 parte dele");
    expect(b).not.toContain("Ideias diferentes entre si");
    expect(blocoDoMotor({ canal: "legenda", objetivo: "venda", variacoes: 3 })).toContain("Ideias diferentes entre si");
  });
});

describe("motor de copy no servidor: conferirCopies", () => {
  const boa = "Troca de óleo em 30 minutos no Bacacheri.\nVocê espera tomando um café.\nChame no WhatsApp e agende.";
  const media = "Revisão completa do seu carro com checklist.\nAgende pelo WhatsApp.";
  const arriscada = "Resultados garantidos na revisão.\nAgende pelo WhatsApp.";
  const cobranca = { clientId: "c-1", tarefa: "estudio" as const };

  const resposta = (answers: Record<string, unknown>): ResultadoJev => ({ answers: answers as ResultadoJev["answers"], usage: { input_tokens: 4000 }, modelo: "jev" });

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { Deno?: unknown }).Deno;
  });

  it("ordena pela nota, manda o alerta para o fim, soma o custo e pergunta tudo numa chamada", async () => {
    const jev = vi.fn(async () =>
      resposta({
        voz_0: { score: 2 }, forca_0: { score: 2 }, inventa_0: { noul: 0.1 }, promessa_0: { noul: 0.1 }, cliche_0: { noul: 0.1 },
        voz_1: { score: 4 }, forca_1: { score: 4 }, inventa_1: { noul: 0.1 }, promessa_1: { noul: 0.1 }, cliche_1: { noul: 0.1 },
        voz_2: { score: 4 }, forca_2: { score: 4 }, inventa_2: { noul: 0.9 }, promessa_2: { noul: 0.9 }, cliche_2: { noul: 0.1 },
      }),
    );
    const cobrar = vi.fn(async () => ({ custoUsd: 0.00017 }));
    const r = await conferirCopies({ textos: [media, boa, arriscada], canal: "legenda", objetivo: "venda", cobranca, jev: jev as PedidoDaConferencia["jev"], cobrar, oferta: "Troca de óleo e revisão" });
    expect(jev).toHaveBeenCalledTimes(1);
    const pedido = (jev.mock.calls[0] as unknown as [{ state: { oferta: string; copies: Record<string, string> }; questions: Record<string, unknown> }])[0];
    expect(Object.keys(pedido.questions)).toHaveLength(15);
    expect(pedido.state.oferta).toBe("Troca de óleo e revisão");
    expect(Object.keys(pedido.state.copies)).toEqual(["c0", "c1", "c2"]);
    expect(r.ordem).toEqual([1, 0, 2]);
    expect(r.conferencias[2].alerta).toBe(true);
    expect(r.custo_usd).toBe(0.00017);
    expect(cobrar).toHaveBeenCalledTimes(1);
    expect(r.jev_erro).toBeNull();
  });

  it("quando o Jev lança, a ordem sai pela conferência em código, com jev_erro e o aviso", async () => {
    const jev = vi.fn(async () => {
      throw new JevErro("jev_http", "402 sem crédito", 402);
    });
    const cobrar = vi.fn();
    const r = await conferirCopies({ textos: [arriscada, boa], canal: "legenda", objetivo: "venda", cobranca, jev: jev as unknown as PedidoDaConferencia["jev"], cobrar: cobrar as unknown as PedidoDaConferencia["cobrar"] });
    expect(r.jev_erro).toBe("jev_http");
    expect(r.custo_usd).toBe(0);
    expect(cobrar).not.toHaveBeenCalled();
    // A promessa garantida é pega pelo código e vai para o fim mesmo sem o Jev.
    expect(r.ordem).toEqual([1, 0]);
    expect(r.conferencias[0].alerta).toBe(true);
    expect(r.conferencias[0].avisos.join(" ")).toContain("O Jev não respondeu");
    expect(console.error).toHaveBeenCalled();
  });

  it("sem a chave do Jev no servidor, cai na conferência em código e diz o motivo", async () => {
    (globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } };
    const r = await conferirCopies({ textos: [boa], canal: "legenda", objetivo: "venda", cobranca });
    expect(r.jev_erro).toBe("jev_sem_chave");
    expect(r.conferencias[0].nota).toBe(100);
    expect(r.ordem).toEqual([0]);
  });

  it("limpa antes de conferir e não chama o Jev sem texto", async () => {
    const jev = vi.fn();
    const r = await conferirCopies({ textos: ["", ""], canal: "legenda", objetivo: "venda", cobranca, jev: jev as unknown as PedidoDaConferencia["jev"] });
    expect(jev).not.toHaveBeenCalled();
    expect(r.conferencias.every((c) => c.nota === 0)).toBe(true);
    const limpo = await conferirCopies({ textos: [`Oi ${TRAVESSAO} tudo bem? Chame no WhatsApp. #promo #oficina`], canal: "legenda", objetivo: "venda", cobranca, semHashtags: true, semJev: true });
    expect(limpo.textos[0]).toBe("Oi, tudo bem? Chame no WhatsApp.");
    expect(limpo.conferencias[0].ajustes.length).toBeGreaterThan(0);
  });
});

describe("Roteiros: a conferência em código vale sem o Jev", () => {
  const roteiro = {
    titulo: "T",
    tipo: "reels",
    objetivo: "venda",
    ganchos: [{ texto: `No mundo de hoje ${TRAVESSAO} tudo muda`, promessa: "" }],
    gancho_escolhido: 0,
    blocos: [{ fala: "Resultados garantidos para você." }],
    cta: "Chame no WhatsApp",
    legenda: "Legenda sem chamada nenhuma.",
  } as unknown as Roteiro;

  it("limpa a fala e a legenda e aponta clichê, promessa e legenda sem CTA", () => {
    const r = roteiroPeloMotorDeCopy(roteiro);
    expect(r.roteiro.ganchos[0].texto).toBe("No mundo de hoje, tudo muda");
    const frases = r.frases.join(" ");
    expect(frases).toContain("Fala: Clichê de IA");
    expect(frases).toContain("Fala: Promessa proibida");
    expect(frases).toContain("Legenda: Sem CTA claro");
  });

  it("sem o Jev (null), as frases da casa viram o aviso; com o Jev, entram sem repetir", () => {
    expect(avisoComAsFrasesDaCasa(null, [])).toBeNull();
    expect(avisoComAsFrasesDaCasa(null, ["Fala: x"])).toEqual({ retencao: null, clareza: null, promessa_cumprida: null, frases: ["Fala: x"] });
    const doJev = { retencao: 4, clareza: 4, promessa_cumprida: 0.9, frases: ["Fala: x"] };
    expect(avisoComAsFrasesDaCasa(doJev, ["Fala: x", "Legenda: y"])!.frases).toEqual(["Fala: x", "Legenda: y"]);
    expect(doJev.frases).toEqual(["Fala: x"]);
  });
});

describe("estimativa: a conferência do Jev entra no custo antes do Confirmar", () => {
  const catalogo = [{ id: "m-1", tipo: "texto", provedor: "openai", preco_entrada_1m: 1, preco_saida_1m: 2 } as unknown as ModeloIa];

  it("soma a parte fixa do Jev sem precisar dele no catálogo", async () => {
    const semJev = estimarLocal([{ modeloId: "m-1", tipo: "texto", tokensEntrada: 1_000_000, tokensSaida: 0 }], catalogo);
    const comJev = estimarLocal([{ modeloId: "m-1", tipo: "texto", tokensEntrada: 1_000_000, tokensSaida: 0 }, parteDaConferenciaDoJev()], catalogo);
    expect(semJev).toBe(1);
    expect(comJev).toBe(1.0005);
    expect(await estimarCusto([parteDaConferenciaDoJev()])).toBe(0.0005);
  });
});

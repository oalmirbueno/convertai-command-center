import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ABERTURA_DOS_SUPERPODERES,
  AGENTES_COM_SUPERPODERES,
  agenteComSuperpoderes,
  COMMIT_DO_SUPERPOWERS,
  comMetodosUsados,
  IDS_DOS_METODOS,
  type IdDoMetodo,
  juntarMetodoAoSistema,
  LICENCA_DO_SUPERPOWERS,
  MESAS_DOS_SUPERPODERES,
  mesasComOMetodo,
  metodosDesligados,
  ORDEM_DE_CORTE,
  ROTULOS_DOS_METODOS,
  SKILL_DE_ORIGEM,
  SKILLS_DO_SUPERPOWERS,
  SKILLS_LIBERADAS_NO_MOTOR,
  TETO_DO_AGENTE_RAPIDO,
  TETO_DOS_SUPERPODERES,
  TEXTOS_DO_ENTENDER,
  TEXTOS_DOS_METODOS,
  VERSAO_DO_SUPERPOWERS,
} from "../../supabase/functions/_shared/superpoderes-catalogo";
import {
  afirmaConclusao,
  anexoDoMetodo,
  AVISO_SEM_PROVA,
  conferirProva,
  escolhaPorMomento,
  escolhaPorPalavras,
  escolherMetodos,
  fecharComMetodo,
  lerEscolhaDoJev,
  limparCacheDosSuperpoderes,
  montarSuperpoderes,
  PERGUNTAS_DO_METODO,
  registrarMetodoSemUso,
  superpoderesPara,
} from "../../supabase/functions/_shared/superpoderes";
import { montarComTeto } from "../../supabase/functions/_shared/conhecimento-dos-agentes";

/**
 * Frente SPP (30/09/2026): o método da casa (adaptado de obra/superpowers,
 * MIT) em todos os agentes. Este teste cobra as regras puras: montagem com o
 * teto de 2.400, abertura e prova sempre, ordem de corte, escolha pelo código,
 * pelo Jev e pela reserva, a conferência da prova (só aviso), o anexo, o liga
 * e desliga por mesa e a atribuição da licença.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const TODOS = IDS_DOS_METODOS.slice() as IdDoMetodo[];
const semProva = TODOS.filter((m) => m !== "prova");

afterEach(() => {
  limparCacheDosSuperpoderes();
  vi.restoreAllMocks();
});

/** Banco falso: só a tabela das chaves e a RPC do uso. */
function bancoFalso(linhas: Array<{ mesa: string; metodo: string; ligado: boolean }> | Error = []) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const db = {
    from: (t: string) => ({
      select: async () => {
        if (linhas instanceof Error) return { data: null, error: linhas };
        return { data: t === "superpoderes_das_mesas" ? linhas : [], error: null };
      },
    }),
    rpc,
  };
  return { db, rpc };
}

/** Jev falso: responde o que o teste mandar, e guarda o estado recebido. */
function jevFalso(respostas: Record<string, unknown>) {
  return vi.fn(async () => ({ answers: respostas as Record<string, never> }));
}

const jevDe = (caminho: string, confianca: number, noul: Partial<Record<"falhou" | "ajuste_recebido" | "revisar" | "varias_frentes" | "acao_cara", number>> = {}) => ({
  caminho: { choice: caminho, confidence: confianca },
  falhou: { noul: noul.falhou ?? 0.05 },
  ajuste_recebido: { noul: noul.ajuste_recebido ?? 0.05 },
  revisar: { noul: noul.revisar ?? 0.05 },
  varias_frentes: { noul: noul.varias_frentes ?? 0.05 },
  acao_cara: { noul: noul.acao_cara ?? 0.05 },
});

describe("montagem: teto, abertura e prova sempre, ordem de corte", () => {
  it("o pior caso (3 blocos mais longos, entender grande) cabe em 2.400", () => {
    const pior = montarSuperpoderes({ caminho: "grande", ids: semProva, fonte: "codigo" })!;
    expect(pior.tamanho).toBeLessThanOrEqual(TETO_DOS_SUPERPODERES);
    expect(pior.texto.length).toBe(pior.tamanho);
    // Toda combinação de até 3 extras em qualquer caminho cabe.
    for (const caminho of ["conversa", "pequeno", "grande", "viabilidade"] as const) {
      for (let a = 0; a < semProva.length; a++) {
        for (let b = a + 1; b < semProva.length; b++) {
          for (let c = b + 1; c < semProva.length; c++) {
            const m = montarSuperpoderes({ caminho, ids: [semProva[a], semProva[b], semProva[c]], fonte: "jev" })!;
            expect(m.tamanho, `${caminho}: ${semProva[a]}, ${semProva[b]}, ${semProva[c]}`).toBeLessThanOrEqual(TETO_DOS_SUPERPODERES);
          }
        }
      }
    }
  });

  it("abertura e prova sempre entram, mesmo sem nenhum bloco pedido e mesmo com a prova desligada", () => {
    const m = montarSuperpoderes({ caminho: "conversa", ids: [], fonte: "regra" }, { desligados: ["prova"] })!;
    expect(m.ids).toEqual(["prova"]);
    expect(m.texto.startsWith(ABERTURA_DOS_SUPERPODERES)).toBe(true);
    expect(m.texto).toContain(TEXTOS_DOS_METODOS.prova);
  });

  it("no máximo 3 blocos além da prova: saem os de menor prioridade (frentes, aceite, revisor, plano...)", () => {
    const m = montarSuperpoderes({ caminho: "grande", ids: semProva, fonte: "codigo" })!;
    expect(m.ids.filter((x) => x !== "prova")).toHaveLength(3);
    // As 3 de maior prioridade: causa, receber, entender (a ordem de corte é frentes, aceite, revisor, plano, entender, receber, causa).
    expect(new Set(m.ids)).toEqual(new Set(["prova", "causa", "receber", "entender"]));
    expect(ORDEM_DE_CORTE).toEqual(["frentes", "aceite", "revisor", "plano", "entender", "receber", "causa"]);
  });

  it("passando do teto, sai inteiro o de menor prioridade, nunca no meio; a prova nunca sai", () => {
    const m = montarSuperpoderes({ caminho: "grande", ids: ["entender", "plano", "causa"], fonte: "jev" }, { teto: 1_600 })!;
    expect(m.tamanho).toBeLessThanOrEqual(1_600);
    expect(m.ids).toContain("prova");
    expect(m.ids).not.toContain("plano");
    for (const id of m.ids) expect(m.texto).toContain(id === "entender" ? TEXTOS_DO_ENTENDER.grande : TEXTOS_DOS_METODOS[id]);
    // Teto menor que abertura e prova: sem método (a chamada segue sem).
    expect(montarSuperpoderes({ caminho: "pequeno", ids: [], fonte: "regra" }, { teto: 300 })).toBeNull();
  });

  it("agente rápido (lançador): teto de 1.200 respeitado", () => {
    const m = montarSuperpoderes({ caminho: "grande", ids: ["entender", "frentes", "causa"], fonte: "jev" }, { teto: TETO_DO_AGENTE_RAPIDO })!;
    expect(m.tamanho).toBeLessThanOrEqual(TETO_DO_AGENTE_RAPIDO);
    expect(m.ids).toContain("prova");
  });

  it("a variante do [entender] segue o caminho, e só uma entra", () => {
    for (const [caminho, texto] of [["grande", TEXTOS_DO_ENTENDER.grande], ["pequeno", TEXTOS_DO_ENTENDER.pequeno], ["viabilidade", TEXTOS_DO_ENTENDER.viabilidade]] as const) {
      const m = montarSuperpoderes({ caminho, ids: ["entender"], fonte: "jev" })!;
      expect(m.texto).toContain(texto);
      expect(m.texto.match(/\[entender\]/g)).toHaveLength(1);
    }
  });

  it("mesma regra de montarComTeto (blocos inteiros, corta o de menor prioridade primeiro)", () => {
    const blocos = (["entender", "plano", "causa", "prova"] as IdDoMetodo[]).map((id) => ({ id, texto: id === "entender" ? TEXTOS_DO_ENTENDER.grande : TEXTOS_DOS_METODOS[id], corte: id === "prova" ? 99 : ORDEM_DE_CORTE.indexOf(id) }));
    const teto = 1_600 - ABERTURA_DOS_SUPERPODERES.length - 2;
    const deles = montarComTeto(blocos, teto, "");
    const nosso = montarSuperpoderes({ caminho: "grande", ids: ["entender", "plano", "causa"], fonte: "codigo" }, { teto: 1_600 })!;
    expect(new Set(nosso.ids)).toEqual(new Set(deles.ids));
    expect(deles.cortados).toEqual(["plano", "entender"]);
    expect(nosso.ids).toEqual(["prova", "causa"]);
  });

  it("a chave da mesa tira o método desligado, menos a prova", () => {
    const m = montarSuperpoderes({ caminho: "grande", ids: ["entender", "plano", "aceite"], fonte: "jev" }, { desligados: ["plano", "prova"] })!;
    expect(m.ids).toEqual(["prova", "entender", "aceite"]);
  });
});

describe("escolha pelo código (momento conhecido)", () => {
  const todos = TODOS;
  it.each([
    ["gerar", "grande", ["aceite", "revisor", "prova"]],
    ["ajustar", "pequeno", ["receber", "aceite", "prova"]],
    ["reprovado", "pequeno", ["receber", "causa", "prova"]],
    ["falhou", "pequeno", ["causa", "prova"]],
    ["revisar", "pequeno", ["revisor", "prova"]],
    ["lote", "grande", ["plano", "frentes", "aceite", "revisor", "prova"]],
  ] as const)("%s", (momento, caminho, ids) => {
    const e = escolhaPorMomento(momento, todos)!;
    expect(e.fonte).toBe("codigo");
    expect(e.caminho).toBe(caminho);
    expect(e.ids).toEqual(ids);
  });

  it("conversa não é do código; e só entra o que o agente pode receber", () => {
    expect(escolhaPorMomento("conversa", todos)).toBeNull();
    expect(escolhaPorMomento("gerar", ["aceite", "prova"])!.ids).toEqual(["aceite", "prova"]);
    expect(escolhaPorMomento("gerar", ["prova"])!.ids).toEqual(["prova"]);
  });
});

describe("reserva por palavras (sem Jev), em 12 frases reais", () => {
  const casos: Array<[string, Partial<{ caminho: string; tem: IdDoMetodo[]; nao: IdDoMetodo[] }>]> = [
    ["o que você acha da legenda do post de ontem?", { tem: ["revisor"], nao: ["plano"] }],
    ["qual o melhor horário para postar?", { caminho: "conversa", nao: ["entender", "receber"] }],
    ["troca a cor do título para verde", { caminho: "pequeno", tem: ["entender", "receber"] }],
    ["não gostei do gancho, refaz mais direto", { tem: ["receber"] }],
    ["deu erro ao gerar a imagem da capa", { tem: ["causa"] }],
    ["o roteiro saiu diferente do que eu pedi", { tem: ["causa"] }],
    ["gera a campanha de dia dos pais com 6 peças", { caminho: "grande", tem: ["entender", "aceite", "plano"] }],
    ["monta o plano do mês inteiro de outubro e gera as artes", { caminho: "grande", tem: ["plano"] }],
    ["dá pra fazer um vídeo animado com a logo? quanto custa?", { caminho: "viabilidade", nao: ["plano", "aceite"] }],
    ["revisa a proposta antes de mandar para o cliente", { tem: ["revisor"] }],
    ["1. cria a bio nova\n2. gera as capas dos destaques", { tem: ["frentes"] }],
    ["publica o post e depois manda o relatório", { tem: ["plano", "frentes"] }],
  ];
  it.each(casos)("%s", (frase, esperado) => {
    const e = escolhaPorPalavras(frase, TODOS);
    expect(e.fonte).toBe("regra");
    expect(e.ids).toContain("prova");
    if (esperado.caminho) expect(e.caminho).toBe(esperado.caminho);
    for (const id of esperado.tem || []) expect(e.ids, `${frase}: ${id}`).toContain(id);
    for (const id of esperado.nao || []) expect(e.ids, `${frase}: sem ${id}`).not.toContain(id);
  });
});

describe("o Jev escolhe nas conversas (limiares da política)", () => {
  it("caminho grande: entender e aceite; revisor só em peça grande; plano com ação cara >= 0,5", () => {
    expect(lerEscolhaDoJev(jevDe("grande", 0.9), TODOS).ids).toEqual(["entender", "aceite", "prova"]);
    expect(lerEscolhaDoJev(jevDe("grande", 0.9), TODOS, { pecaGrande: true }).ids).toEqual(["entender", "aceite", "revisor", "prova"]);
    expect(lerEscolhaDoJev(jevDe("grande", 0.9, { acao_cara: 0.5 }), TODOS).ids).toEqual(["entender", "aceite", "plano", "prova"]);
    expect(lerEscolhaDoJev(jevDe("grande", 0.9, { acao_cara: 0.49 }), TODOS).ids).not.toContain("plano");
  });

  it("os Noul em 0,6: causa, receber, revisor e frentes", () => {
    const e = lerEscolhaDoJev(jevDe("pequeno", 0.8, { falhou: 0.6, ajuste_recebido: 0.61, revisar: 0.7, varias_frentes: 0.6 }), TODOS);
    expect(e.ids).toEqual(expect.arrayContaining(["causa", "receber", "revisor", "frentes", "prova"]));
    const abaixo = lerEscolhaDoJev(jevDe("pequeno", 0.8, { falhou: 0.59, ajuste_recebido: 0.59, revisar: 0.59, varias_frentes: 0.59 }), TODOS);
    expect(abaixo.ids).toEqual(["entender", "prova"]);
    expect(abaixo.probabilidades).toMatchObject({ falhou: 0.59, caminho_pequeno: 0.8 });
  });

  it("confiança do caminho abaixo de 0,5 vale pequeno; só vira grande com ação cara", () => {
    expect(lerEscolhaDoJev(jevDe("grande", 0.4), TODOS).caminho).toBe("pequeno");
    expect(lerEscolhaDoJev(jevDe("grande", 0.4, { acao_cara: 0.8 }), TODOS).caminho).toBe("grande");
    expect(lerEscolhaDoJev(jevDe("conversa", 0.9), TODOS).ids).toEqual(["prova"]);
    expect(lerEscolhaDoJev(jevDe("viabilidade", 0.9), TODOS).ids).toEqual(["entender", "prova"]);
  });

  it("uma chamada só, com Choice e um Noul por método, estado sem id e teto de 3,5 s", async () => {
    const perguntar = jevFalso(jevDe("grande", 0.9, { acao_cara: 0.9 }));
    const e = await escolherMetodos("gera a campanha de outubro", { mesa: "Mesa Roteiros", oQueFaz: "roteiros", padrao: TODOS, ultimaResposta: "ok" }, { perguntar });
    expect(perguntar).toHaveBeenCalledTimes(1);
    const [arg, op] = perguntar.mock.calls[0] as unknown as [{ state: Record<string, unknown>; questions: Record<string, { type: string }> }, { timeoutMs: number }];
    expect(Object.keys(arg.questions).sort()).toEqual(["acao_cara", "ajuste_recebido", "caminho", "falhou", "revisar", "varias_frentes"]);
    expect(arg.questions.caminho.type).toBe("choice");
    expect(Object.keys(arg.state)).toEqual(["pedido", "mesa", "o_que_a_mesa_faz", "ultima_resposta_do_agente", "erro_recente"]);
    expect(op.timeoutMs).toBe(3_500);
    expect(e.fonte).toBe("jev");
    expect(e.ids).toEqual(expect.arrayContaining(["entender", "aceite", "plano", "prova"]));
    // Cache de 5 minutos: o mesmo pedido não pergunta de novo.
    await escolherMetodos("gera a campanha de outubro", { mesa: "Mesa Roteiros", oQueFaz: "roteiros", padrao: TODOS }, { perguntar });
    expect(perguntar).toHaveBeenCalledTimes(1);
  });

  it("Jev fora (tempo estourado): vale a reserva por palavras e a falha vai para o log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const perguntar = vi.fn(async () => {
      const e = new Error("Jev nao respondeu a tempo");
      (e as Error & { codigo: string }).codigo = "jev_timeout";
      throw e;
    });
    const e = await escolherMetodos("deu erro ao gerar a capa", { mesa: "Estúdio", oQueFaz: "artes", padrao: TODOS }, { perguntar });
    expect(e.fonte).toBe("regra");
    expect(e.ids).toContain("causa");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("superpoderes: jev não escolheu o método"), expect.objectContaining({ codigo: "jev_timeout" }));
  });

  it("as perguntas não têm travessão e cada instrução é completa", () => {
    for (const [k, q] of Object.entries(PERGUNTAS_DO_METODO)) {
      expect(String(q.instructions), k).not.toMatch(/[—–]/);
      expect(String(q.instructions).length, k).toBeGreaterThan(30);
    }
  });
});

describe("cada agente de cada mesa recebe o bloco certo para o tipo de pedido", () => {
  it("todas as mesas têm agente, e todo agente pode receber a prova", () => {
    const mesas = new Set(AGENTES_COM_SUPERPODERES.map((a) => a.mesa));
    for (const m of MESAS_DOS_SUPERPODERES) expect(mesas.has(m.id), m.id).toBe(true);
    for (const a of AGENTES_COM_SUPERPODERES) expect(a.metodos, a.id).toContain("prova");
    expect(new Set(AGENTES_COM_SUPERPODERES.map((a) => a.id)).size).toBe(AGENTES_COM_SUPERPODERES.length);
  });

  const pedidos: Array<{ tipo: string; jev: Record<string, unknown>; momento: "gerar" | "ajustar" | "falhou" | "revisar" | "lote"; esperado: IdDoMetodo[] }> = [
    { tipo: "conversa", jev: jevDe("conversa", 0.9), momento: "revisar", esperado: [] },
    { tipo: "pedido pequeno", jev: jevDe("pequeno", 0.9), momento: "ajustar", esperado: ["entender"] },
    { tipo: "peça grande com custo", jev: jevDe("grande", 0.9, { acao_cara: 0.9 }), momento: "gerar", esperado: ["entender", "aceite", "plano"] },
    { tipo: "algo falhou", jev: jevDe("pequeno", 0.9, { falhou: 0.9 }), momento: "falhou", esperado: ["entender", "causa"] },
    { tipo: "ajuste recebido", jev: jevDe("pequeno", 0.9, { ajuste_recebido: 0.9 }), momento: "ajustar", esperado: ["entender", "receber"] },
    { tipo: "várias frentes", jev: jevDe("pequeno", 0.9, { varias_frentes: 0.9 }), momento: "lote", esperado: ["entender", "frentes"] },
  ];

  for (const a of AGENTES_COM_SUPERPODERES) {
    it(`${a.id} (${a.escolha})`, async () => {
      for (const p of pedidos) {
        limparCacheDosSuperpoderes();
        const { db } = bancoFalso([]);
        const perguntar = jevFalso(p.jev);
        const m = await superpoderesPara(db, a.escolha === "jev" ? { agente: a.id, pedido: `pedido: ${p.tipo}` } : { agente: a.id, momento: p.momento }, { perguntar });
        expect(m, `${a.id} / ${p.tipo}`).not.toBeNull();
        const teto = a.teto ?? TETO_DOS_SUPERPODERES;
        expect(m!.tamanho, `${a.id} / ${p.tipo}`).toBeLessThanOrEqual(teto);
        expect(m!.ids, `${a.id} / ${p.tipo}`).toContain("prova");
        expect(m!.texto.startsWith(ABERTURA_DOS_SUPERPODERES)).toBe(true);
        // Nada fora do que o agente pode receber.
        for (const id of m!.ids) expect(a.metodos, `${a.id} / ${p.tipo}: ${id}`).toContain(id);
        if (a.escolha === "jev") {
          expect(perguntar, a.id).toHaveBeenCalledTimes(1);
          expect(m!.fonte).toBe("jev");
          // O que o tipo de pedido pede e o agente pode receber entra, pela prioridade (até 3 além da prova) e até o teto do agente.
          // Tipadas como IdDoMetodo[]: o filtro sem "prova" estreitaria o tipo e o typecheck:test reclamaria no indexOf e no concat.
          const pedidos: IdDoMetodo[] = lerEscolhaDoJev(p.jev as never, a.metodos, { pecaGrande: a.pecaGrande }).ids.filter((id) => id !== "prova");
          const top3: IdDoMetodo[] = pedidos.slice().sort((x, y) => ORDEM_DE_CORTE.indexOf(y) - ORDEM_DE_CORTE.indexOf(x)).slice(0, 3);
          const esperado = p.esperado.filter((id) => a.metodos.indexOf(id) >= 0 && top3.indexOf(id) >= 0);
          const cabe = teto === TETO_DOS_SUPERPODERES;
          if (cabe) {
            expect(m!.ids.slice().sort(), `${a.id} / ${p.tipo}`).toEqual(top3.concat(["prova"]).sort());
            for (const id of esperado) expect(m!.ids, `${a.id} / ${p.tipo}: ${id}`).toContain(id);
          }
          // O núcleo de cada tipo de pedido chega sempre que o agente pode receber (é o de maior prioridade).
          if (p.tipo === "algo falhou" && a.metodos.indexOf("causa") >= 0) expect(m!.ids, a.id).toContain("causa");
          if (p.tipo === "ajuste recebido" && a.metodos.indexOf("receber") >= 0) expect(m!.ids, a.id).toContain("receber");
          if (p.tipo === "conversa") expect(m!.ids, a.id).toEqual(["prova"]);
          if (esperado.indexOf("entender") >= 0 && m!.ids.indexOf("entender") >= 0) {
            expect(m!.texto).toContain(p.tipo === "peça grande com custo" ? TEXTOS_DO_ENTENDER.grande : TEXTOS_DO_ENTENDER.pequeno);
          }
        } else {
          expect(perguntar, a.id).not.toHaveBeenCalled();
          expect(m!.fonte).toBe("codigo");
          const doMomento = escolhaPorMomento(p.momento, a.metodos)!.ids;
          expect(m!.ids.slice().sort(), `${a.id} / ${p.momento}`).toEqual(doMomento.slice().sort());
        }
      }
    });
  }

  it("agente fora do catálogo: sem método, com o log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await superpoderesPara(bancoFalso().db, { agente: "nao.existe", pedido: "x" })).toBeNull();
    expect(log).toHaveBeenCalled();
  });
});

describe("liga e desliga por mesa", () => {
  it("sem linha = ligado; a linha da mesa vence a '*'; a prova nunca desliga", () => {
    expect(metodosDesligados([], "roteiros")).toEqual([]);
    const linhas = [
      { mesa: "*", metodo: "frentes", ligado: false },
      { mesa: "roteiros", metodo: "frentes", ligado: true },
      { mesa: "roteiros", metodo: "plano", ligado: false },
      { mesa: "roteiros", metodo: "prova", ligado: false },
    ];
    expect(metodosDesligados(linhas, "roteiros")).toEqual(["plano"]);
    expect(metodosDesligados(linhas, "ads")).toEqual(["frentes"]);
    const plano = mesasComOMetodo(linhas, "plano");
    expect(plano.total).toBeGreaterThan(5);
    expect(plano.ligadas).toBe(plano.total - 1);
    expect(mesasComOMetodo(linhas, "prova").ligadas).toBe(mesasComOMetodo(linhas, "prova").total);
  });

  it("superpoderesPara lê a chave da mesa (cache de 60 s) e tira o que a mesa desligou", async () => {
    const { db } = bancoFalso([{ mesa: "roteiros", metodo: "entender", ligado: false }, { mesa: "*", metodo: "plano", ligado: false }]);
    const espiao = vi.spyOn(db, "from");
    const perguntar = jevFalso(jevDe("grande", 0.9, { acao_cara: 0.9 }));
    const m = await superpoderesPara(db, { agente: "roteiros.agente", pedido: "gera a campanha" }, { perguntar });
    expect(m!.ids).toEqual(["prova", "aceite"]);
    // Outra mesa: a linha "*" desliga o plano, o entender segue ligado.
    const ads = await superpoderesPara(db, { agente: "ads.plano", pedido: "gera a campanha" }, { perguntar });
    expect(ads!.ids).toEqual(expect.arrayContaining(["prova", "entender", "aceite"]));
    expect(ads!.ids).not.toContain("plano");
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("sem a tabela (migration ainda não aplicada): tudo ligado e a falha no log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await superpoderesPara(bancoFalso(new Error("relation does not exist")).db, { agente: "roteiros.roteirista", momento: "gerar" });
    expect(m!.ids).toEqual(["prova", "aceite"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("chaves das mesas não lidas"), expect.anything());
  });
});

describe("prova antes de dizer pronto (só aviso, sem laço)", () => {
  it.each([
    ["Pronto. Gerei as 3 artes do carrossel.", true],
    ["Salvei o briefing e enviei para a equipe.", true],
    ["Já está publicado no Instagram.", true],
    ["Feito, o título foi atualizado.", true],
    ["Corrigi a legenda da lâmina 2.", true],
  ])("afirma: %s", (t, sim) => expect(afirmaConclusao(t)).toBe(sim));

  it.each([
    "Vou gerar as 3 artes depois que você confirmar.",
    "Posso gerar a campanha? O custo aparece no cartão.",
    "A lista está pronta para você confirmar.",
    "Montei o cartão com as 4 mudanças; o custo aparece nele.",
    "Ainda não gerei nada: falta a foto do produto.",
    "Quer que eu prepare as opções?",
  ])("não afirma: %s", (t) => expect(afirmaConclusao(t)).toBe(false));

  // Revisão 30/09: relato de status (voz passiva com sujeito, passado) e texto entregue na própria resposta não são
  // "feito sem ação". Antes davam true e o Jev era chamado à toa (até 2,5 s) e colava o aviso na resposta errada.
  it.each([
    "Esta semana foram publicados 3 posts e a proposta foi enviada ao cliente na terça.",
    "O post de terça já está agendado para 18h.",
    "A campanha de outubro ficou pronta na semana passada.",
    "o destaque de serviços foi criado em agosto",
    "Criei abaixo uma estrutura de roteiro em 3 atos, com gancho, virada e CTA.",
    "Reescrevi o gancho do roteiro 2; veja as 3 versões.",
    "Gerei 3 opções de título para você escolher:",
    "Na semana passada publiquei os 3 posts do mês.",
    "Segue o texto: Corrigi a legenda seria assim.",
  ])("relato ou texto entregue, não afirma: %s", (t) => expect(afirmaConclusao(t)).toBe(false));

  it.each([
    ["Agendei o post de terça para as 18h.", true],
    ["Pronto, salvei a nova bio no perfil.", true],
    ["Criei a pasta Campanha de outubro no Workspace.", true],
    ["Já foi publicado.", true],
  ])("ação do próprio agente nesta resposta ainda afirma: %s", (t, sim) => expect(afirmaConclusao(t)).toBe(sim));

  it("conferirProva: diz pronto sem ação feita (ou com todas falhando) pede o aviso", () => {
    expect(conferirProva("Gerei o roteiro.", { acaoFeita: false })).toEqual({ ok: false, aviso: AVISO_SEM_PROVA });
    expect(conferirProva("Gerei o roteiro.", { acaoFeita: true, resultados: [{ ok: true }] })).toEqual({ ok: true, aviso: null });
    expect(conferirProva("Gerei o roteiro.", { acaoFeita: true, resultados: [{ ok: false }] }).ok).toBe(false);
    expect(conferirProva("Vou gerar o roteiro.", { acaoFeita: false })).toEqual({ ok: true, aviso: null });
    expect(AVISO_SEM_PROVA).not.toMatch(/[—–]/);
  });

  it("fecharComMetodo: na suspeita o Jev confere (Noul afirma_feito, 2,5 s); a resposta ganha o aviso e a prova é gravada", async () => {
    const { db, rpc } = bancoFalso();
    const m = montarSuperpoderes({ caminho: "pequeno", ids: ["entender"], fonte: "jev" })!;
    const perguntar = jevFalso({ afirma_feito: { noul: 0.93 } });
    const r = await fecharComMetodo(db, { usoId: "uso-1", metodo: m, resposta: "Pronto, gerei as artes.", declarados: ["entender", "prova"], acaoFeita: false }, { perguntar });
    expect(r.resposta).toBe(`Pronto, gerei as artes. ${AVISO_SEM_PROVA}`);
    expect(r.anexo).toEqual({ tipo: "metodo_usado", ids: ["prova", "entender"], fonte: "declarado", caminho: "pequeno", prova: "faltou", versao: m.versao });
    const [, op] = perguntar.mock.calls[0] as unknown as [unknown, { timeoutMs: number }];
    expect(op.timeoutMs).toBe(2_500);
    await new Promise((x) => setTimeout(x, 0));
    expect(rpc).toHaveBeenCalledWith("ia_uso_marcar_metodo", expect.objectContaining({ _uso_id: "uso-1", _prova: "faltou" }));
  });

  it("o Jev diz que não afirmou (limiar 0,7): nada muda; sem Jev, vale o código", async () => {
    const m = montarSuperpoderes({ caminho: "pequeno", ids: [], fonte: "jev" })!;
    const nao = await fecharComMetodo(bancoFalso().db, { usoId: null, metodo: m, resposta: "Pronto para você decidir: gerei duas ideias de gancho aqui.", declarados: [], acaoFeita: false }, { perguntar: jevFalso({ afirma_feito: { noul: 0.4 } }) });
    expect(nao.resposta).not.toContain(AVISO_SEM_PROVA);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const semJev = await fecharComMetodo(bancoFalso().db, { usoId: null, metodo: m, resposta: "Salvei a nova bio.", declarados: undefined, acaoFeita: false }, { perguntar: vi.fn(async () => { throw new Error("fora"); }) });
    expect(semJev.resposta).toContain(AVISO_SEM_PROVA);
    expect(semJev.anexo!.fonte).toBe("injetado");
    // Sem método (agente sem superpoderes): a resposta passa igual e não há anexo.
    expect(await fecharComMetodo(bancoFalso().db, { usoId: null, metodo: null, resposta: "Pronto.", declarados: [], acaoFeita: false })).toEqual({ resposta: "Pronto.", anexo: null });
  });

  it("relato de status não chama o Jev: nada de espera nem de aviso", async () => {
    const m = montarSuperpoderes({ caminho: "conversa", ids: [], fonte: "jev" })!;
    const perguntar = jevFalso({ afirma_feito: { noul: 0.95 } });
    const r = await fecharComMetodo(bancoFalso().db, { usoId: "uso-2", metodo: m, resposta: "Esta semana foram publicados 3 posts e o de terça já está agendado.", declarados: [], acaoFeita: false }, { perguntar });
    expect(perguntar).not.toHaveBeenCalled();
    expect(r.resposta).not.toContain(AVISO_SEM_PROVA);
  });

  it("sem usoId (cadeia antiga e reserva): o método e a prova vão para o registro sem uso, com o cliente", async () => {
    const { db, rpc } = bancoFalso();
    const m = { ...montarSuperpoderes({ caminho: "pequeno", ids: ["entender"], fonte: "jev" })!, agente: "workspace.agente" };
    const cliente = "11111111-2222-4333-8444-555555555555";
    await fecharComMetodo(db, { usoId: null, metodo: m, resposta: "Certo, organizo assim que você confirmar.", declarados: undefined, acaoFeita: false, clientId: cliente });
    await new Promise((x) => setTimeout(x, 0));
    expect(rpc).toHaveBeenCalledWith("superpoderes_registrar_sem_uso", {
      _agente: "workspace.agente", _metodos: m.ids, _fonte: "jev", _prova: "nao_se_aplica", _versao: m.versao, _client_id: cliente,
    });
    expect(rpc).not.toHaveBeenCalledWith("ia_uso_marcar_metodo", expect.anything());
    // Com usoId, só a prova no ia_usos (o chamarTexto já gravou os métodos): nada no registro sem uso.
    rpc.mockClear();
    await fecharComMetodo(db, { usoId: "uso-3", metodo: m, resposta: "Certo.", declarados: undefined, acaoFeita: false, clientId: cliente });
    await new Promise((x) => setTimeout(x, 0));
    expect(rpc).toHaveBeenCalledWith("ia_uso_marcar_metodo", expect.objectContaining({ _uso_id: "uso-3" }));
    expect(rpc).not.toHaveBeenCalledWith("superpoderes_registrar_sem_uso", expect.anything());
  });

  it("registrarMetodoSemUso: sem método ou sem agente não grava; cliente inválido vira null; erro vai para o log", async () => {
    const { db, rpc } = bancoFalso();
    await registrarMetodoSemUso(db, { metodo: null });
    await registrarMetodoSemUso(db, { metodo: montarSuperpoderes({ caminho: "conversa", ids: [], fonte: "codigo" }) });
    expect(rpc).not.toHaveBeenCalled();
    const m = { ...montarSuperpoderes({ caminho: "conversa", ids: [], fonte: "codigo" })!, agente: "rituais.coach" };
    await registrarMetodoSemUso(db, { metodo: m, clientId: "x; drop" });
    expect(rpc).toHaveBeenCalledWith("superpoderes_registrar_sem_uso", expect.objectContaining({ _agente: "rituais.coach", _client_id: null, _prova: null }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const quebrado = { from: bancoFalso().db.from, rpc: vi.fn(async () => ({ data: null, error: { message: "sem permissão" } })) };
    await registrarMetodoSemUso(quebrado, { metodo: m });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("método sem uso de IA não registrado"), expect.anything());
  });
});

describe("o anexo 'Método: ...'", () => {
  const m = montarSuperpoderes({ caminho: "grande", ids: ["entender", "plano"], fonte: "jev" })!;
  it("cruza o declarado com o injetado (como o Segui cruza com as regras)", () => {
    expect(anexoDoMetodo(m, ["plano", "frentes", "PROVA"], { ok: true, seAplica: true })!.ids).toEqual(["prova", "plano"]);
    expect(anexoDoMetodo(m, undefined, null)!).toMatchObject({ ids: ["prova", "entender", "plano"], fonte: "injetado", prova: "nao_se_aplica" });
    expect(anexoDoMetodo(m, [], null)).toBeNull();
    expect(anexoDoMetodo(m, [], { ok: false, seAplica: true })!.prova).toBe("faltou");
    expect(anexoDoMetodo(null, ["prova"], null)).toBeNull();
  });

  it("o esquema ganha metodos_usados em properties e required, sem mudar o original", () => {
    const original = { nome: "x", schema: { type: "object", additionalProperties: false, required: ["resposta"], properties: { resposta: { type: "string" } } } };
    const novo = comMetodosUsados(original) as typeof original;
    expect(novo.schema.required).toEqual(["resposta", "metodos_usados"]);
    expect(Object.keys(novo.schema.properties)).toEqual(["resposta", "metodos_usados"]);
    expect(original.schema.required).toEqual(["resposta"]);
    expect((comMetodosUsados(novo) as typeof original).schema.required).toEqual(["resposta", "metodos_usados"]);
  });
});

describe("textos, rótulos, licença e atribuição", () => {
  it("sem travessão e sem emoji nos textos novos; cada bloco começa com o id entre colchetes", () => {
    const textos = [ABERTURA_DOS_SUPERPODERES, ...Object.values(TEXTOS_DOS_METODOS), ...Object.values(TEXTOS_DO_ENTENDER)];
    for (const t of textos) {
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
    for (const id of TODOS) expect(TEXTOS_DOS_METODOS[id].startsWith(`[${id}]`), id).toBe(true);
    for (const p of ["supabase/functions/_shared/superpoderes-catalogo.ts", "supabase/functions/_shared/superpoderes.ts"]) expect(ler(p), p).not.toMatch(/[—–]/);
  });

  it("os rótulos com as palavras do dono e a skill de origem de cada método", () => {
    expect(ROTULOS_DOS_METODOS).toMatchObject({ entender: "brainstorm", plano: "plano", prova: "verificação", causa: "depuração" });
    for (const id of TODOS) {
      expect(SKILL_DE_ORIGEM[id].length, id).toBeGreaterThan(0);
      for (const s of SKILL_DE_ORIGEM[id]) expect(SKILLS_DO_SUPERPOWERS[s], `${id} -> ${s}`).toBeDefined();
    }
  });

  it("as 15 skills da v6.4.2, e as liberadas do motor são 6 (revisão da SPM: brainstorming, executing-plans e requesting-code-review negadas)", () => {
    expect(Object.keys(SKILLS_DO_SUPERPOWERS)).toHaveLength(15);
    const liberadas = new Set(Object.values(SKILLS_LIBERADAS_NO_MOTOR).flat());
    expect(liberadas.size).toBe(6);
    expect(Object.keys(SKILLS_LIBERADAS_NO_MOTOR).sort()).toEqual(["ajustar", "construir"]);
    for (const s of liberadas) expect(SKILLS_DO_SUPERPOWERS[s].motor, s).toBe("liberada");
    const negadas = Object.keys(SKILLS_DO_SUPERPOWERS).filter((s) => SKILLS_DO_SUPERPOWERS[s].motor === "negada");
    expect(negadas).toHaveLength(9);
    for (const s of negadas) expect(SKILLS_DO_SUPERPOWERS[s].motivo_no_motor, s).toBeTruthy();
    ["brainstorming", "executing-plans", "requesting-code-review"].forEach((s) => expect(SKILLS_DO_SUPERPOWERS[s].motor, s).toBe("negada"));
  });

  it("a atribuição MIT está no catálogo, na abertura que o agente recebe e no aviso da licença", () => {
    const catalogo = ler("supabase/functions/_shared/superpoderes-catalogo.ts");
    expect(catalogo).toContain("obra/superpowers");
    expect(catalogo).toContain("licença MIT, Copyright (c) 2025 Jesse Vincent");
    expect(catalogo).toContain("docs/licencas/superpowers-MIT.txt");
    expect(ABERTURA_DOS_SUPERPODERES).toContain("adaptado de obra/superpowers, licença MIT");
    expect(LICENCA_DO_SUPERPOWERS).toBe("MIT (Copyright (c) 2025 Jesse Vincent)");
    const licenca = ler("docs/licencas/superpowers-MIT.txt");
    expect(licenca).toContain("MIT License");
    expect(licenca).toContain("Copyright (c) 2025 Jesse Vincent");
    expect(licenca).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
    expect(licenca).toContain(COMMIT_DO_SUPERPOWERS);
    expect(licenca).toContain(VERSAO_DO_SUPERPOWERS);
    expect(ler("docs/motores/REPOSITORIOS.md")).toContain("[obra/superpowers](https://github.com/obra/superpowers)");
    expect(ler("supabase/functions/_shared/superpoderes.ts")).toContain("licença MIT, Copyright (c) 2025 Jesse Vincent");
  });

  it("junta o método no fim do sistema; sem método, byte a byte o mesmo", () => {
    const s = "SISTEMA DO AGENTE\ncom regras";
    expect(juntarMetodoAoSistema(s, null)).toBe(s);
    expect(juntarMetodoAoSistema(s, undefined)).toBe(s);
    expect(juntarMetodoAoSistema(s, { texto: "   " })).toBe(s);
    expect(juntarMetodoAoSistema(s, { texto: "MÉTODO" })).toBe(`${s}\n\nMÉTODO`);
    expect(agenteComSuperpoderes("roteiros.agente")!.mesa).toBe("roteiros");
  });
});

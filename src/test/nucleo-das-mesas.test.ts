// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  conferirApresentacao, leiturasEscolhidas, LEITURAS_PREVIAS, MARCA_CONFERIDA, perguntasDasLeituras,
} from "../../supabase/functions/_shared/nucleo-das-mesas";
import { separarResposta } from "../../supabase/functions/_shared/resposta-em-partes";

const fontes = [{ apelido: "L1", ferramenta: "ler_briefing" as const, argumento: "", texto: "Negócio: Casa dos Assados. Verba: R$ 1.000 por mês. Endereço: não informado." }];

/** Jev de mentira: devolve o veredito de cada afirmação pela ordem. */
const jevQueResponde = (vereditos: string[]) => (async (_url: unknown, init?: { body?: string }) => {
  const corpo = JSON.parse(String(init?.body || "{}"));
  const answers: Record<string, unknown> = {};
  Object.keys(corpo.questions).forEach((id, i) => {
    const v = vereditos[i] || "nao_diz";
    answers[id] = { choice: v, probabilities: { sustenta: v === "sustenta" ? 0.9 : 0.05, contradiz: 0.05, nao_diz: v === "sustenta" ? 0.05 : 0.9 } };
  });
  return new Response(JSON.stringify({ answers, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
}) as unknown as typeof fetch;

const quadro = (blocos: unknown[]) => "```aceleriq-blocos\n" + JSON.stringify({ blocos }) + "\n```";

describe("núcleo das Mesas: leituras prévias", () => {
  it("um Noul por leitura, sem as que o agente já faz", () => {
    const q = perguntasDasLeituras(["ler_briefing", "ler_dossie"]);
    expect(Object.keys(q)).toEqual(["ler_briefing", "ler_dossie"]);
    expect(q.ler_briefing.type).toBe("noul");
    expect(Object.keys(perguntasDasLeituras())).toHaveLength(LEITURAS_PREVIAS.length);
  });

  it("escolhe só acima do limiar, as mais prováveis primeiro, no máximo 3", () => {
    expect(leiturasEscolhidas({
      ler_briefing: { noul: 0.97 }, ler_contexto_da_mesa: { noul: 0.7 }, ler_agenda: { noul: 0.2 },
      ler_metricas: { noul: 0.55 }, ler_cerebro: { noul: 0.6 }, ler_dossie: { noul: 0.1 },
    })).toEqual(["ler_briefing", "ler_contexto_da_mesa", "ler_cerebro"]);
    expect(leiturasEscolhidas(null)).toEqual([]);
  });
});

describe("núcleo das Mesas: conferência dos quadros", () => {
  it("linha que não bate com a leitura sai; o resto volta marcado como conferido", async () => {
    const texto = `Li o briefing.\n\n${quadro([{ tipo: "tabela", titulo: "Briefing", colunas: ["Item", "Situação"], linhas: [["Verba", "R$ 1.000/mês"], ["Cardápio", "R$ 45 o frango"]], fontes: ["L1"] }])}\n\nFalta o endereço.`;
    const r = await conferirApresentacao(texto, fontes, { agente: "teste", chave: "x", fetchImpl: jevQueResponde(["sustenta", "nao_diz"]) });
    expect(r.quadros).toBe(1);
    expect(r.texto).toContain("```" + MARCA_CONFERIDA);
    expect(r.texto).not.toContain("R$ 45");
    expect(r.recusados.join(" ")).toMatch(/1 linha não bateu/);
    // A tela desenha o quadro conferido sem precisar da lista de fontes.
    const tela = separarResposta(r.texto);
    const blocos = tela.partes.filter((p) => p.tipo === "blocos");
    expect(blocos).toHaveLength(1);
    expect(tela.partes.some((p) => p.tipo === "texto" && /Falta o endereço/.test(p.texto))).toBe(true);
    // A fonte chega à tela com o nome da leitura.
    expect(JSON.stringify(blocos[0])).toContain("Briefing (L1)");
  });

  it("marca de conferido escrita pelo modelo é rebaixada e conferida de novo", async () => {
    const falso = "```" + MARCA_CONFERIDA + "\n" + JSON.stringify({ blocos: [{ tipo: "metricas", itens: [{ rotulo: "Seguidores", valor: 9999 }], fontes: ["L1"] }] }) + "\n```";
    const r = await conferirApresentacao(falso, fontes, { agente: "teste", chave: "x", fetchImpl: jevQueResponde(["nao_diz"]) });
    expect(r.quadros).toBe(0);
    expect(r.texto).not.toContain("9999");
  });

  it("fluxo fica como proposta; entrega e progresso saem; número sem leitura sai", async () => {
    const texto = quadro([
      { tipo: "fluxo", titulo: "Próximos passos", natureza: "registro", passos: [{ id: "a", rotulo: "Pedir endereço", estado: "concluido" }, { id: "b", rotulo: "Montar cardápio" }], ligacoes: [{ de: "a", para: "b" }] },
      { tipo: "progresso", titulo: "x", etapas: [{ rotulo: "y", estado: "concluido" }] },
      { tipo: "metricas", itens: [{ rotulo: "Alcance", valor: 10 }], fontes: ["L7"] },
    ]);
    const r = await conferirApresentacao(texto, fontes, { agente: "teste", chave: "x", fetchImpl: jevQueResponde([]) });
    expect(r.quadros).toBe(1);
    const json = JSON.parse(r.texto.split("```" + MARCA_CONFERIDA)[1].split("```")[0]);
    expect(json.blocos[0].tipo).toBe("fluxo");
    expect(json.blocos[0].natureza).toBe("proposta");
    expect(json.blocos[0].passos.every((p: { estado: string }) => p.estado === "planejado")).toBe(true);
    expect(r.recusados.join(" ")).toMatch(/progresso sem conferência/);
  });

  it("sem Jev, quadro com número sai (nunca entra sem conferir)", async () => {
    const quebrado = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    const r = await conferirApresentacao(quadro([{ tipo: "tabela", colunas: ["A"], linhas: [["Verba R$ 1.000"]], fontes: ["L1"] }]), fontes, { agente: "teste", chave: "x", fetchImpl: quebrado });
    expect(r.quadros).toBe(0);
  });

  it("texto sem quadro passa intacto", async () => {
    const r = await conferirApresentacao("Só conversa.\n\nSegunda linha.", fontes, { agente: "teste" });
    expect(r).toEqual({ texto: "Só conversa.\n\nSegunda linha.", recusados: [], quadros: 0 });
  });
});

describe("tela: quadro comum continua sem número", () => {
  it("tabela com número fora da marca de conferido não desenha", () => {
    const r = separarResposta(quadro([{ tipo: "tabela", colunas: ["A", "B"], linhas: [["x", 1]], fontes: ["L1"] }]));
    expect(r.partes.filter((p) => p.tipo === "blocos")).toHaveLength(0);
  });
});

describe("pedido ao Hermes pelas Mesas", () => {
  it("só encaminha quando a equipe pede com todas as letras", async () => {
    const { pedeAoHermes } = await import("../../supabase/functions/_shared/pedido-ao-hermes");
    expect(pedeAoHermes("Peça ao Hermes para abrir o perfil do Google e conferir o horário")).toBe(true);
    expect(pedeAoHermes("manda pro hermes publicar")).toBe(true);
    expect(pedeAoHermes("Como está o pedido do Hermes?")).toBe(false);
    expect(pedeAoHermes("Peça uma arte nova")).toBe(false);
  });

  it("o quadro dos pedidos é conferido pelo código e a tela desenha o progresso", async () => {
    const { quadroDosPedidos } = await import("../../supabase/functions/_shared/pedido-ao-hermes");
    const q = quadroDosPedidos([
      { tarefaId: "t1", linkId: "l1", titulo: "Hermes: conferir horário no Google", status: "review", ultimo: null, evidencia: "print do perfil", proximo: null, bloqueio: null, criado: "2026-10-09T10:00:00Z" },
      { tarefaId: "t2", linkId: "l2", titulo: "Hermes: abrir conta", status: "queued", ultimo: null, evidencia: null, proximo: null, bloqueio: null, criado: "2026-10-09T11:00:00Z" },
    ]);
    const tela = separarResposta(`Está assim:\n\n${q}`);
    const blocos = tela.partes.filter((p) => p.tipo === "blocos");
    expect(blocos).toHaveLength(1);
    const b = (blocos[0] as { blocos: Array<{ tipo: string; etapas: Array<{ estado: string }> }> }).blocos[0];
    expect(b.tipo).toBe("progresso");
    expect(b.etapas.map((e) => e.estado)).toEqual(["aguardando_aprovacao", "planejado"]);
  });
});

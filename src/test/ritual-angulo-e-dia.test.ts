import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ANGULOS_DO_RITUAL,
  angulosDasVersoes,
  blocoDoDiaPrioritario,
  formulasDeMolde,
  instrucaoDoAngulo,
} from "../../supabase/functions/ritual-writer/modulos/angulo-e-dia";
import { escreverRitual, montarPedidoAoEscritor, pontosDaVersao, SYSTEM_PROMPT } from "../../supabase/functions/ritual-writer/escritor";

/**
 * 23/10/2026 (dono): "as mensagens que estão saindo estão muito ruins, muito repetitivas e sem o contexto;
 * melhore a inteligência e o motor, mas mantenha rápido; e o Dia Prioritário de alguns clientes não aparece".
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

// Mensagem real de 21/10 (o esqueleto que saiu igual para 12 clientes).
const DE_21_10 = "Boa tarde, Thiélo. Na segunda, combinamos avançar com as peças prontas.\n\nNa semana de 15 a 21/10, os anúncios trouxeram 4 contatos, contra 10 de 08 a 14/10. A semana foi pior; a gente vai ajustar os anúncios ativos até 23/10.\n\nAté sexta, a gente confere a validade e a publicação em data útil. Tudo no painel: aceleriq.online";

describe("ângulo de abertura escolhido pelo código", () => {
  const segunda = new Date("2026-10-19T12:00:00Z");
  const quarta = new Date("2026-10-21T12:00:00Z");

  it("as versões A e B nunca começam pelo mesmo ângulo", () => {
    const [a, b] = angulosDasVersoes("cliente-1", "meio_semana", quarta);
    expect(a).not.toBe(b);
    expect(ANGULOS_DO_RITUAL).toContain(a);
  });

  it("o mesmo cliente muda de ângulo entre segunda e quarta, e clientes diferentes no mesmo dia não começam todos iguais", () => {
    expect(angulosDasVersoes("cliente-1", "rota_semana", segunda)[0]).not.toBe(angulosDasVersoes("cliente-1", "meio_semana", quarta)[0]);
    const ids = ["d3dacbac", "52f2efb6", "6a847578", "e590497e", "39ebda82", "eb1270a5", "5ae0705e", "bad69252", "8801caa5", "3d08338c", "3ba9540c"];
    const primeiros = new Set(ids.map((id) => angulosDasVersoes(id, "meio_semana", quarta)[0]));
    expect(primeiros.size).toBeGreaterThanOrEqual(3);
  });

  it("a versão B continua marcada e a abertura proíbe a retomada burocrática", () => {
    expect(instrucaoDoAngulo("pelo próximo passo", "B")).toContain("VERSÃO B");
    expect(instrucaoDoAngulo("pelo próximo passo", "A")).toContain('nada de "Na segunda combinamos"');
  });
});

describe("molde e bastidor tiram pontos", () => {
  it("a mensagem de 21/10 é pega pelas fórmulas", () => {
    expect(formulasDeMolde(DE_21_10)).toEqual(expect.arrayContaining([
      'abre retomando "na segunda combinamos"',
      '"a semana foi pior/melhor"',
      '"até sexta, a gente"',
      '"validade" (bastidor)',
      '"data útil" (bastidor)',
    ]));
  });

  it("entre duas versões, a sem molde ganha", () => {
    const limpa = "Boa tarde, Thiélo. A peça \"O cuidado aparece\" entra no ar amanhã e mostra para quem procura poda o cuidado da Verzelo com cada árvore.\n\nOs anúncios trouxeram menos contatos porque a verba da campanha de poda acabou na terça; ela volta hoje com R$ 20 por dia.\n\nTudo no painel: aceleriq.online";
    expect(pontosDaVersao(limpa, "meio_semana", [])).toBeGreaterThan(pontosDaVersao(DE_21_10, "meio_semana", []));
  });

  it("o prompt não dita mais o esqueleto linha a linha e pede o porquê", () => {
    expect(SYSTEM_PROMPT).not.toContain("Linha 1: cumprimento");
    expect(SYSTEM_PROMPT).toContain("26. SEM MOLDE E SEM BASTIDOR");
    expect(SYSTEM_PROMPT).toContain("27. CONTEXTO DO NEGÓCIO");
    expect(SYSTEM_PROMPT).toContain("COMO ESTÁ INDO, COM O PORQUÊ");
  });
});

describe("escritor com ângulo, nome e Dia Prioritário", () => {
  const resposta = (body: string) => ({ texto: JSON.stringify({ title: "t", body, next_steps: "x", sem_novidade: false, alertas: [], tarefas_sugeridas: [] }), modelo: "m", rotulo: "m", raciocinio: null, reserva: null, custoUsd: 0, usage: null, usoId: null });
  const pedido = { ritual: "meio_semana", clientName: "Casa Dos Assados", contactName: "", facts: "fatos", clientId: "d3dacbac", agora: new Date("2026-10-21T12:00:00Z"), diaPrioritario: "DIA PRIORITÁRIO DO CLIENTE: toda segunda" };

  it("cada versão leva o seu ângulo, sem chamada de IA a mais", async () => {
    const escrever = vi.fn().mockResolvedValue(resposta("Boa tarde! Texto curto. Tudo no painel: aceleriq.online"));
    await escreverRitual(pedido, escrever as never, vi.fn(async () => null));
    expect(escrever).toHaveBeenCalledTimes(2);
    const [a, b] = angulosDasVersoes("d3dacbac", "meio_semana", pedido.agora);
    expect(String(escrever.mock.calls[0][0].usuario)).toContain(a);
    expect(String(escrever.mock.calls[1][0].usuario)).toContain(b);
  });

  it("sem nome de contato, cumprimenta sem nome; e o Dia Prioritário vai no pedido", () => {
    const u = montarPedidoAoEscritor(pedido);
    expect(u).toContain("cumprimente sem nome");
    expect(u).not.toContain("use o nome do negócio");
    expect(u).toContain("DIA PRIORITÁRIO DO CLIENTE: toda segunda");
  });
});

describe("Dia Prioritário no escritor", () => {
  const quinta = new Date("2026-10-22T15:00:00Z"); // quinta, 22/10, em São Paulo

  it("só o confirmado entra; provisório e não se aplica ficam de fora", () => {
    expect(blocoDoDiaPrioritario({ dia: 2, situacao: "provisorio" }, quinta)).toBe("");
    expect(blocoDoDiaPrioritario({ dia: null, situacao: "nao_aplicavel" }, quinta)).toBe("");
    expect(blocoDoDiaPrioritario(null, quinta)).toBe("");
  });

  it("diz o dia certo e quando é o próximo", () => {
    expect(blocoDoDiaPrioritario({ dia: 4, situacao: "confirmado" }, quinta)).toContain("toda quinta (o próximo é HOJE)");
    expect(blocoDoDiaPrioritario({ dia: 5, situacao: "confirmado" }, quinta)).toContain("é nesta sexta");
    expect(blocoDoDiaPrioritario({ dia: 1, situacao: "confirmado" }, quinta)).toContain("é na próxima segunda");
  });

  it("o contexto lê o dia do cliente e os três escritores recebem", () => {
    expect(ler("supabase/functions/ritual-writer/contexto.ts")).toContain('db.from("cliente_dia_prioritario").select("dia, situacao")');
    expect(ler("supabase/functions/ritual-writer/index.ts")).toContain("diaPrioritario: contexto?.diaPrioritario,");
    expect(ler("supabase/functions/mcp-server/modulos/ritual-automatico.ts")).toContain("diaPrioritario: contexto?.diaPrioritario,");
    expect(ler("supabase/functions/agente-central/index.ts").split("diaPrioritario: contexto.diaPrioritario").length - 1).toBe(2);
  });
});

describe("Dia Prioritário à vista no celular", () => {
  it("recolhido no celular, o cartão vira uma linha (não some em Mais detalhes)", () => {
    const tela = ler("src/components/client/ClientJourneyDashboard.tsx");
    expect(tela).toContain("compacto={recolhidoNoCelular}");
    expect(tela).not.toMatch(/\{!recolhidoNoCelular && \(\s*<CartaoDoDiaPrioritario/);
    expect(ler("src/components/dia-prioritario/CartaoDoDiaPrioritario.tsx")).toContain("data-compacto");
  });
});

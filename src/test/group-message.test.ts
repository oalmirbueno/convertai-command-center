import { describe, expect, it } from "vitest";
import { buildGroupMessageText, type GroupMessageContext } from "@/lib/groupMessage";

/**
 * As três mensagens da semana saíam com o MESMO corpo e só a saudação trocada
 * — o cliente mostrou os prints. Estes testes guardam a correção de verdade:
 * cada momento tem um trabalho, e com os mesmos fatos os três textos saem
 * DIFERENTES por consequência, não por sorteio de frases.
 */

const base: GroupMessageContext = {
  clientName: "Preserva Eco",
  greeting: "Bom dia",
  entregasSemana: ["seu vizinho vai te agradecer", "o que separar antes de sair de casa"],
  entregasDesdeSegunda: ["o que separar antes de sair de casa"],
  aguardandoOk: [],
  publicadasSemana: 1,
  proximasAgendadas: ["21/08", "23/08"],
  cicloFeito: ["conteúdo da semana criado", "posts agendados"],
  avulsosFeitos: ["gravação no ponto de coleta"],
  frentes: ["Estruturação Digital Bacacheri 2026"],
  contextoRecente: "Definimos priorizar a série de vizinhança no orgânico",
  proximoPasso: "Subir a campanha de conversas na primeira quinzena",
  anuncios: {
    campanhasNoAr: 1,
    investidoSemana: 84.5,
    resultadosSemana: 9,
    nomeDoResultado: "conversas iniciadas",
  },
};

describe("cada momento tem um trabalho próprio", () => {
  const abertura = buildGroupMessageText(base, "abertura");
  const meio = buildGroupMessageText(base, "meio");
  const fim = buildGroupMessageText(base, "fechamento");

  it("com os mesmos fatos, os três corpos saem diferentes", () => {
    // Era exatamente o defeito dos prints: corpo idêntico, saudação trocada.
    const corpo = (texto: string) => texto.split("\n").slice(1).join("\n");
    expect(corpo(abertura)).not.toBe(corpo(meio));
    expect(corpo(meio)).not.toBe(corpo(fim));
    expect(corpo(abertura)).not.toBe(corpo(fim));
  });

  it("a abertura conta o plano: calendário, campanha e contexto", () => {
    expect(abertura).toContain("21/08");
    expect(abertura).toContain("campanha segue no ar");
    // O contexto vivo substitui o genérico "seguimos trabalhando em X".
    expect(abertura).toContain("priorizar a série de vizinhança");
    expect(abertura).not.toContain("Seguimos trabalhando em");
  });

  it("o meio conta o movimento desde segunda, incluindo ciclo e avulsos", () => {
    expect(meio).toContain("desde segunda");
    // A frase começa maiúscula na mensagem; o que importa é o nome estar lá.
    expect(meio).toMatch(/que separar antes de sair de casa/i);
    expect(meio).toContain("conteúdo da semana criado");
    expect(meio).toContain("gravação no ponto de coleta");
    // E o dinheiro dos anúncios com o resultado pelo nome.
    expect(meio).toContain("9 conversas iniciadas");
  });

  it("o fechamento faz o balanço e aponta o próximo passo", () => {
    // A intenção é a mesma; a sexta virou narrativa e as palavras mudaram
    // com ela. O que não pode faltar: o que rendeu, para onde vamos, e o
    // fecho cordial.
    expect(fim).toContain("o que foi feito, o que rendeu");
    expect(fim).toContain("Subir a campanha de conversas");
    expect(fim).toContain("Já preparado para a próxima semana");
    expect(fim).toContain("Bom fim de semana");
  });
});

describe("regras de tom que valem nos três momentos", () => {
  const vazio: GroupMessageContext = {
    clientName: "Mirante",
    greeting: "Boa tarde",
    entregasSemana: [],
    entregasDesdeSegunda: [],
    aguardandoOk: [],
    publicadasSemana: 0,
    proximasAgendadas: [],
    cicloFeito: [],
    avulsosFeitos: [],
    frentes: ["Conteúdo e Reservas"],
  };

  it("semana sem entrega vira construção, nunca vazio ou pendência", () => {
    for (const momento of ["abertura", "meio", "fechamento"] as const) {
      const texto = buildGroupMessageText(vazio, momento);
      expect(texto).not.toMatch(/pendente|atrasad|parado|nenhuma entrega|não houve/i);
      expect(texto.length).toBeGreaterThan(60);
    }
  });

  it("o que espera o cliente aparece pelo que destrava, não como cobrança", () => {
    const comPendencia = { ...vazio, aguardandoOk: ["arte do reservatório"] };
    const meio = buildGroupMessageText(comPendencia, "meio");
    // A palavra mudou ("com o sim, o resto da semana anda"), a intenção não:
    // o pedido mostra o GANHO de aprovar, nunca vira cobrança.
    expect(meio).toContain("com o sim");
    expect(meio).not.toMatch(/aguardando você|não recebemos/i);
  });

  it("sem campanha, nenhuma linha de anúncio é inventada", () => {
    const texto = buildGroupMessageText(vazio, "fechamento");
    expect(texto).not.toMatch(/anúncio|campanha|investido/i);
  });

  it("nunca sai jargão nem contagem seca de materiais", () => {
    const texto = buildGroupMessageText(base, "fechamento");
    expect(texto).not.toMatch(/\bCTR\b|\bCPC\b|\bCPM\b|impress/i);
    expect(texto).not.toMatch(/\d+ entrega\(s\)/);
  });

  it("o rodapé aponta o painel nos três momentos", () => {
    for (const momento of ["abertura", "meio", "fechamento"] as const) {
      expect(buildGroupMessageText(base, momento)).toContain("aceleriq.online");
    }
  });
});

describe("a mensagem muda quando o painel muda", () => {
  it("dossiê atualizado troca a linha de contexto da abertura", () => {
    const antes = buildGroupMessageText(base, "abertura");
    const depois = buildGroupMessageText(
      { ...base, contextoRecente: "Nova fase: campanha de conversas aprovada e no ar" },
      "abertura",
    );
    expect(antes).not.toBe(depois);
    expect(depois).toContain("campanha de conversas aprovada");
  });

  it("avulso marcado no ciclo entra na mensagem de quarta", () => {
    const sem = buildGroupMessageText({ ...base, avulsosFeitos: [] }, "meio");
    const com = buildGroupMessageText(base, "meio");
    expect(sem).not.toContain("gravação no ponto de coleta");
    expect(com).toContain("gravação no ponto de coleta");
  });
});

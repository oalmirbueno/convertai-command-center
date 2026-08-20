import { describe, expect, it } from "vitest";
import { buildGroupMessageText, type GroupMessageContext } from "@/lib/groupMessage";
import { porqueDaSemana, contarRotina, rotinaEmLinguagemDeCliente } from "@/lib/rotinaDoCliente";

/**
 * As mensagens eram três ou quatro linhas soltas. O dono pediu contexto que
 * faça o cliente imergir: o que já fizemos, POR QUE aquilo, onde estamos e
 * para onde vamos — e, na sexta, o resultado e o que já está preparado para a
 * semana seguinte.
 */

const FEITAS = [
  { area: "social" as const, step: 1 },
  { area: "social" as const, step: 2 },
  { area: "social" as const, step: 6 },
];

const base: GroupMessageContext = {
  clientName: "Preserva Eco", greeting: "Boa tarde",
  entregasSemana: ["Carrossel Manutenção"], entregasDesdeSegunda: [],
  aguardandoOk: [], publicadasSemana: 3,
  proximasAgendadas: ["25/08", "27/08"],
  cicloFeito: rotinaEmLinguagemDeCliente(FEITAS),
  porqueDaSemana: porqueDaSemana(FEITAS),
  avulsosFeitos: ["a gravação na loja"], frentes: ["Estruturação Digital"],
  pautasProntas: ["Carrossel de setembro"],
  contextoRecente: "O projeto está ativo, com 70% de progresso registrado.",
  proximoPasso: "ativar a mídia assim que a verba for aprovada",
  anuncios: null,
};

const abertura = () => buildGroupMessageText(base, "abertura");
const fechamento = () => buildGroupMessageText(base, "fechamento");

describe("a segunda situa e aponta o caminho", () => {
  it("abre pelo retrato, não pela tarefa", () => {
    // O cliente precisa se situar antes de ouvir o que vem.
    const texto = abertura();
    expect(texto).toContain("*Onde estamos*");
    expect(texto.indexOf("*Onde estamos*")).toBeLessThan(texto.indexOf("*Para onde vamos*"));
  });

  it("tem os três tempos da linha do tempo", () => {
    const texto = abertura();
    for (const bloco of ["*Onde estamos*", "*O que já está garantido*", "*Para onde vamos*"]) {
      expect(texto, `faltou ${bloco}`).toContain(bloco);
    }
  });

  it("diz o porquê, não só o que", () => {
    expect(abertura()).toContain("Na prática:");
  });

  it("nenhum bloco abre com conector solto", () => {
    // "E o foco combinado…" abrindo uma seção: o conector é do join, não da
    // frase.
    for (const linha of abertura().split("\n")) {
      expect(linha).not.toMatch(/^E o /);
      expect(linha).not.toMatch(/^e /);
    }
  });
});

describe("a sexta fecha o arco", () => {
  it("conta o feito, o resultado, onde ficamos e o que vem", () => {
    const texto = fechamento();
    for (const bloco of [
      "*O que foi feito*", "*O que isso rendeu*",
      "*Onde isso nos deixa*", "*Já preparado para a próxima semana*",
    ]) {
      expect(texto, `faltou ${bloco}`).toContain(bloco);
    }
  });

  it("explica o motivo do trabalho", () => {
    expect(fechamento()).toContain("Isso importa porque");
  });

  it("o que foi feito vem em linhas, não em parágrafo corrido", () => {
    // Emendado com vírgulas, virava uma frase com dois "e" que ninguém lê
    // até o fim no celular.
    const bloco = fechamento().split("*O que foi feito*")[1].split("\n\n")[0];
    expect(bloco.split("\n").filter((l) => l.startsWith("• ")).length).toBeGreaterThan(1);
  });

  it("nunca termina sem apontar adiante", () => {
    // Sexta sem próximo passo deixa a sensação de que nada continua.
    expect(fechamento()).toContain("Já preparado para a próxima semana");
  });

  it("sem nada registrado, reconhece em vez de inventar", () => {
    const vazio = buildGroupMessageText(
      { ...base, entregasSemana: [], cicloFeito: [], avulsosFeitos: [],
        publicadasSemana: 0, proximasAgendadas: [], pautasProntas: [],
        proximoPasso: null, porqueDaSemana: null, contextoRecente: null },
      "fechamento",
    );
    expect(vazio).toContain("construção interna");
    expect(vazio).not.toContain("*O que foi feito*");
  });
});

describe("o texto não erra o português", () => {
  it("não adivinha o gênero do nome que o cliente deu à peça", () => {
    // "a arte ... está pronto" era o erro; sem adjetivo não há concordância
    // para errar.
    const texto = buildGroupMessageText(
      { ...base, aguardandoOk: ["a arte do Dia do Cliente"] },
      "abertura",
    );
    expect(texto).toContain("está esperando seu ok");
    expect(texto).not.toContain("está pronto esperando");
  });

  it("o motivo serve à segunda e à sexta", () => {
    // Escrito preso a um momento ("a semana já começa"), ficava errado na
    // sexta, quando a semana está acabando.
    const motivo = porqueDaSemana(FEITAS);
    expect(motivo).toBeTruthy();
    expect(motivo).not.toMatch(/semana já começa/);
  });

  it("cada etapa contada tem frase, e o motivo é opcional", () => {
    for (const etapa of contarRotina(FEITAS)) {
      expect(etapa.frase.length).toBeGreaterThan(0);
      expect(typeof etapa.porque).toBe("string");
    }
  });
});

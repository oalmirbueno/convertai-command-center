import { describe, expect, it } from "vitest";
import {
  entradaConcluida, evidenciasDe, jornadaDaEntrada, ondeEstaNaEntrada,
  type EvidenciasDaEntrada,
} from "@/lib/cycleJourney";
import { ordenarPelaUrgencia, type Pendencia } from "@/lib/cycleSuggest";
import { situacaoVazia, type SituacaoDoCliente } from "@/lib/cycleSituation";

/**
 * O pedido: "quando entra cliente, reconhecer e fazer o processo completo
 * — cliente iniciou, criar estratégia, montar as conexões, criar o
 * calendário editorial, as primeiras artes, agendar, quando campanha
 * deixar tudo certo. Um processo, e não repetido, com base no que foi
 * cadastrado no cliente."
 *
 * O trilho antigo era quatro frases fixas com caixinha para marcar. Marcar
 * dependia de alguém lembrar — e o painel JÁ SABE se o briefing voltou, se
 * a conta conectou, se subiu arte. Caixinha que repete o que o banco sabe
 * é trabalho dobrado, e mente na primeira vez que alguém esquece.
 */

const nada: EvidenciasDaEntrada = {
  briefingRespondido: false,
  contaSocialConectada: false,
  contaAdsConectada: false,
  estrategiaEscrita: false,
  calendarioMontado: false,
  primeirasArtes: false,
  primeiroAgendamento: false,
  campanhaNoAr: false,
  acompanhamentoComecou: false,
};

describe("a sequência sai do que o cliente contratou", () => {
  it("quem só tem social nunca vê etapa de campanha", () => {
    const etapas = jornadaDaEntrada(nada, { social: true, trafego: false });
    const chaves = etapas.map((e) => e.chave);
    expect(chaves).not.toContain("campanha");
    expect(chaves).not.toContain("conexao-ads");
    expect(chaves).toContain("calendario");
  });

  it("quem só tem tráfego não recebe calendário nem artes", () => {
    const etapas = jornadaDaEntrada(nada, { social: false, trafego: true });
    const chaves = etapas.map((e) => e.chave);
    expect(chaves).toContain("conexao-ads");
    expect(chaves).toContain("campanha");
    expect(chaves).not.toContain("calendario");
    expect(chaves).not.toContain("primeiras-artes");
  });

  it("quem tem os dois recebe a jornada inteira, na ordem de dependência", () => {
    const chaves = jornadaDaEntrada(nada, { social: true, trafego: true })
      .map((e) => e.chave);
    // Não adianta montar calendário sem estratégia, nem agendar sem arte.
    expect(chaves.indexOf("estrategia")).toBeLessThan(chaves.indexOf("calendario"));
    expect(chaves.indexOf("primeiras-artes")).toBeLessThan(chaves.indexOf("primeiro-agendamento"));
    expect(chaves[0]).toBe("briefing");
  });
});

describe("cada etapa fecha por evidência, não por marcação", () => {
  it("briefing respondido fecha a primeira sozinho", () => {
    const etapas = jornadaDaEntrada(
      { ...nada, briefingRespondido: true },
      { social: true, trafego: false },
    );
    expect(etapas.find((e) => e.chave === "briefing")?.feita).toBe(true);
  });

  it("a primeira aberta é a de hoje, e só ela mostra como fecha", () => {
    // Mostrar sete instruções ao mesmo tempo é o que deixa qualquer um
    // perdido: a de hoje se destaca, o resto fica visível e quieto.
    const etapas = jornadaDaEntrada(
      { ...nada, briefingRespondido: true },
      { social: true, trafego: false },
    );
    const atuais = etapas.filter((e) => e.atual);
    expect(atuais).toHaveLength(1);
    // Depois do briefing, o próximo passo é o grupo com as boas-vindas —
    // resposta direta do dono sobre a ordem real de trabalho.
    expect(atuais[0].chave).toBe("grupo-boas-vindas");
    expect(atuais[0].comoFecha.length).toBeGreaterThan(10);
  });

  it("com tudo feito, não sobra etapa atual e a entrada está concluída", () => {
    const tudo: EvidenciasDaEntrada = {
      briefingRespondido: true, contaSocialConectada: true, contaAdsConectada: true,
      estrategiaEscrita: true, calendarioMontado: true, primeirasArtes: true,
      primeiroAgendamento: true, campanhaNoAr: true, acompanhamentoComecou: true,
    };
    const etapas = jornadaDaEntrada(tudo, { social: true, trafego: true });
    expect(etapas.some((e) => e.atual)).toBe(false);
    expect(entradaConcluida(etapas)).toBe(true);
    expect(ondeEstaNaEntrada(etapas)).toContain("Entrada completa");
  });

  it("a frase do card diz onde ele está agora", () => {
    const etapas = jornadaDaEntrada(
      { ...nada, briefingRespondido: true, estrategiaEscrita: true },
      { social: true, trafego: false },
    );
    const frase = ondeEstaNaEntrada(etapas);
    expect(frase).toContain("2 de");
    expect(frase).toContain("agora:");
  });
});

describe("a evidência vem da situação real do painel", () => {
  const comSituacao = (p: Partial<SituacaoDoCliente>) =>
    evidenciasDe({
      situacao: { ...situacaoVazia("c1"), ...p },
      briefingRespondido: false, contaSocialConectada: false,
      contaAdsConectada: false, temDossie: false,
    });

  it("pauta sem arte já conta como calendário montado", () => {
    // O calendário existe; o que falta é a arte, e isso é a etapa
    // seguinte. Marcar o calendário como não feito faria voltar um passo.
    const ev = comSituacao({ pautasSemArte: 3 });
    expect(ev.calendarioMontado).toBe(true);
    expect(ev.primeirasArtes).toBe(false);
  });

  it("arte esperando aprovação já conta como primeira arte", () => {
    // Ela existe e está no painel: o que falta é o cliente responder.
    expect(comSituacao({ aguardandoAprovacao: 1 }).primeirasArtes).toBe(true);
  });

  it("post publicado conta como agendamento feito", () => {
    // Quem já publicou obviamente passou pelo agendar.
    expect(comSituacao({ publicadosNaSemana: 2 }).primeiroAgendamento).toBe(true);
  });

  it("campanha no ar fecha a etapa de campanha", () => {
    expect(comSituacao({ campanhasAtivas: 1 }).campanhaNoAr).toBe(true);
    expect(comSituacao({ campanhasTotal: 3, campanhasAtivas: 0 }).campanhaNoAr).toBe(false);
  });
});

describe("a fila move: quem pede ação sobe", () => {
  const p = (g: "urgente" | "atencao"): Pendencia =>
    ({ chave: g, texto: "", gravidade: g, viraEtapa: true });

  it("urgência manda mais que contagem de etapa", () => {
    // Um cliente com 5 de 6 e a conexão caída importa mais hoje do que um
    // com 1 de 6 e tudo em ordem.
    const ordem = ordenarPelaUrgencia(
      [
        { nome: "quase pronto mas quebrado", pend: [p("urgente")], feitas: 5 },
        { nome: "atrasado mas em ordem", pend: [], feitas: 1 },
      ],
      (i) => ({ pendencias: i.pend, feitas: i.feitas, nome: i.nome }),
    );
    expect(ordem[0].nome).toBe("quase pronto mas quebrado");
  });

  it("entre iguais em urgência, quem fez menos sobe", () => {
    const ordem = ordenarPelaUrgencia(
      [
        { nome: "B", pend: [], feitas: 4 },
        { nome: "A", pend: [], feitas: 1 },
      ],
      (i) => ({ pendencias: i.pend, feitas: i.feitas, nome: i.nome }),
    );
    expect(ordem[0].nome).toBe("A");
  });

  it("urgente vem antes de atenção, e atenção antes de limpo", () => {
    const ordem = ordenarPelaUrgencia(
      [
        { nome: "limpo", pend: [], feitas: 0 },
        { nome: "atencao", pend: [p("atencao")], feitas: 0 },
        { nome: "urgente", pend: [p("urgente")], feitas: 0 },
      ],
      (i) => ({ pendencias: i.pend, feitas: i.feitas, nome: i.nome }),
    );
    expect(ordem.map((i) => i.nome)).toEqual(["urgente", "atencao", "limpo"]);
  });

  it("a ordem é estável: mesma entrada, mesma saída", () => {
    // Ordem que muda sozinha entre dois renders faz o card fugir do dedo.
    const itens = [
      { nome: "C", pend: [p("urgente")], feitas: 2 },
      { nome: "A", pend: [p("urgente")], feitas: 2 },
      { nome: "B", pend: [], feitas: 2 },
    ];
    const ler = (i: typeof itens[number]) =>
      ({ pendencias: i.pend, feitas: i.feitas, nome: i.nome });
    expect(ordenarPelaUrgencia(itens, ler).map((i) => i.nome))
      .toEqual(ordenarPelaUrgencia(itens, ler).map((i) => i.nome));
  });
});

import { describe, expect, it } from "vitest";
import { oQueEsperarDoDossie, resumoDoDossie, soVidaReal, trechoDoContexto } from "@/lib/contextoDoCliente";
import { rotinaEmLinguagemDeCliente, temTraducao } from "@/lib/rotinaDoCliente";
import { CYCLES } from "@/lib/cycleDefs";

/**
 * O que chegava ao cliente era bastidor da agência, não notícia dele.
 *
 * Na abertura: "Por dentro: Atualização de quarta-feira: 19/08/2026 FONTES
 * CONSULTADAS Painel Aceleriq: cadastro, projetos, dossiê completo…" — a lista
 * de fontes que a IA consultou, cortada no meio de uma palavra.
 *
 * No meio da semana: "já saíram conteúdo da semana criado e subir no painel" —
 * nomes de etapa do checklist interno, no imperativo.
 */

// Dossiês REAIS de produção, com a estrutura que a rotina do GPT escreve.
const PRESERVA = `DOSSIÊ DE CONTEXTO - PRESERVA ECO

Data: 20/08/2026
Cliente: Angela Lustoza
Marca: Preserva Eco
Natureza: franquia; a Aceleriq faz o marketing da unidade do Bacacheri
Client ID: 5ae0705e-6f8c-40f1-b076-867fd2ab3178
Project ID: af1eee4d-4d17-4593-accf-e28df1e70ff9

ONDE ESTAMOS

Em 20/08/2026, o projeto está ativo, com 70% de progresso registrado. A mídia ainda não foi ativada.

PRÓXIMOS PASSOS

Ativar a mídia assim que a verba for aprovada.`;

const MIRANTE = `# Atualização de contexto e histórico - Mirante Luz Floripa - 19/08/2026

## Status atual

O projeto segue ativo, com 83% de progresso no painel. A semana de Tráfego Pago de 17/08 está fechada em 6 de 6 etapas.`;

const VERZELO = `DOSSIÊ DE CONTEXTO — VERZELO
Atualização de quarta-feira: 19/08/2026

FONTES CONSULTADAS

Painel Aceleriq: cadastro, projetos, dossiê completo, calendário editorial, tarefas.

ONDE ESTAMOS

O site institucional está concluído, com entrega registrada em 23/07/2026.`;

describe("o dossiê entrega a situação, não a ficha técnica", () => {
  it("acha a seção que diz onde o cliente está — em vida real", () => {
    // "70% de progresso registrado" é contabilidade do painel, não vida do
    // negócio: a porcentagem sai e a frase continua de pé com o que é real.
    const texto = resumoDoDossie(PRESERVA);
    expect(texto).toContain("está ativo");
    expect(texto).toContain("A mídia ainda não foi ativada");
    expect(texto).not.toContain("70%");
    expect(texto).not.toContain("progresso");
    expect(resumoDoDossie(VERZELO)).toContain("site institucional está concluído");
  });

  it("entende cabeçalho em markdown também", () => {
    // Um dos clientes recebe o dossiê em markdown ("## Status atual").
    const texto = resumoDoDossie(MIRANTE);
    expect(texto).toContain("segue ativo");
    expect(texto).not.toContain("83%");
    expect(texto).not.toContain("#");
  });

  it("a lista de fontes que a IA consultou não é assunto do cliente", () => {
    const texto = resumoDoDossie(VERZELO);
    expect(texto).not.toContain("FONTES CONSULTADAS");
    expect(texto).not.toContain("Painel Aceleriq: cadastro");
  });

  it("identificadores internos nunca saem do painel", () => {
    // O pior vazamento possível numa mensagem de WhatsApp.
    const texto = resumoDoDossie(PRESERVA);
    expect(texto).not.toContain("Client ID");
    expect(texto).not.toContain("5ae0705e");
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("para na próxima seção, sem misturar assuntos", () => {
    // Emendar "ONDE ESTAMOS" com "PRÓXIMOS PASSOS" produz o texto confuso.
    expect(resumoDoDossie(PRESERVA)).not.toContain("Ativar a mídia");
  });

  it("corta no fim de uma frase, não no meio de uma palavra", () => {
    const texto = resumoDoDossie(PRESERVA, 60);
    expect(texto.length).toBeLessThanOrEqual(62);
    expect(texto).toMatch(/[.;!?…]$/);
  });

  it("nota curta continua sendo lida como sempre", () => {
    // A leitura nova não pode estragar o que já funcionava.
    const nota = { kind: "nota", title: "Cliente pediu pausa nos anúncios", content: "" };
    expect(trechoDoContexto(nota)).toBe("Cliente pediu pausa nos anúncios");
  });
});

describe("a rotina é contada na língua do cliente", () => {
  it("traduz a etapa em vez de repetir a ordem de serviço", () => {
    const ditas = rotinaEmLinguagemDeCliente([{ area: "social", step: 1 }]);
    expect(ditas).toEqual(["o conteúdo da semana ficou pronto"]);
    expect(ditas.join(" ")).not.toContain("artes e legendas");
  });

  it("etapa que é puro bastidor não vira frase", () => {
    // "Conectar e conferir a conta no painel" não é notícia para o cliente.
    expect(rotinaEmLinguagemDeCliente([{ area: "social", step: 3 }])).toEqual([]);
  });

  it("não repete a mesma frase por duas frentes", () => {
    const ditas = rotinaEmLinguagemDeCliente([
      { area: "social", step: 1 },
      { area: "social", step: 1 },
    ]);
    expect(ditas).toHaveLength(1);
  });

  it("toda etapa do ciclo tem decisão explícita de tradução", () => {
    // Etapa nova sem decisão cairia calada da mensagem; o teste força a
    // escolha na hora de criar a etapa.
    for (const area of ["social", "trafego"] as const) {
      for (const etapa of CYCLES[area].steps) {
        expect(temTraducao(etapa), `sem decisão para: ${etapa}`).toBe(true);
      }
    }
  });

  it("etapa fora da faixa não quebra a mensagem", () => {
    expect(rotinaEmLinguagemDeCliente([{ area: "social", step: 99 }])).toEqual([]);
  });
});

describe("vida real: o negócio, não o painel", () => {
  it("a oração interna sai e a frase continua de pé", () => {
    expect(
      soVidaReal("O projeto está ativo, com 70% de progresso registrado e fase de lançamento no método do painel."),
    ).toBe("O projeto está ativo.");
  });

  it("frase que é só checklist sai inteira", () => {
    // "6 de 6 etapas" não tem metade aproveitável para o cliente.
    expect(
      soVidaReal("A semana de Tráfego Pago de 17/08 está fechada em 6 de 6 etapas. Os carrosséis foram publicados."),
    ).toBe("Os carrosséis foram publicados.");
  });

  it("data não é confundida com contagem de etapas", () => {
    // "20/08" tem dígito-barra-dígito como "6/6"; sem fronteiras, frases
    // legítimas com data sumiam da mensagem.
    expect(soVidaReal("A entrega foi registrada em 23/07/2026.")).toContain("23/07/2026");
  });

  it("o que esperar vem da seção de futuro, também em vida real", () => {
    const dossie = "ONDE ESTAMOS\n\nTudo certo.\n\nPRÓXIMOS PASSOS\n\nAtivar a mídia assim que a verba for aprovada, com 20% de folga no método.";
    const texto = oQueEsperarDoDossie(dossie);
    expect(texto).toContain("Ativar a mídia");
    expect(texto).not.toContain("método");
    expect(texto).not.toContain("20%");
  });

  it("dossiê sem seção de futuro devolve vazio em vez de inventar", () => {
    expect(oQueEsperarDoDossie("ONDE ESTAMOS\n\nTudo certo.")).toBe("");
  });
});

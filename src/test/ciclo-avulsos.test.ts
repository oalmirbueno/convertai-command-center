import { describe, expect, it } from "vitest";
import { pendenciasDoAvulso, type SituacaoDoAvulso } from "@/lib/cycleAvulsos";

/**
 * A resposta do dono sobre o que denuncia entrega avulsa travada:
 * "dias parado na mesma etapa, projeto vencido, confusão do que fazer e
 * por onde começar e seguir".
 *
 * Entrega avulsa esfria em silêncio: não tem semana que a puxe de volta,
 * então "sem avanço" não aparece em lugar nenhum sozinho.
 */

const agora = "2026-08-24T12:00:00Z";
const situacao = (p: Partial<SituacaoDoAvulso>): SituacaoDoAvulso => ({
  clientId: "c1", ultimaMarcacao: null, prazo: null, ...p,
});

describe("parado na mesma etapa", () => {
  it("7 dias sem marcar nada é urgente", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({ ultimaMarcacao: "2026-08-16T12:00:00Z" }),
      feitas: 2, total: 5, proximaEtapa: "Aprovar o layout", agoraIso: agora,
    });
    expect(p.find((x) => x.chave === "parado")?.gravidade).toBe("urgente");
    expect(p.find((x) => x.chave === "parado")?.texto).toContain("8 dias");
  });

  it("4 dias é esfriando, ainda não urgente", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({ ultimaMarcacao: "2026-08-20T11:00:00Z" }),
      feitas: 2, total: 5, proximaEtapa: null, agoraIso: agora,
    });
    expect(p.find((x) => x.chave === "esfriando")?.gravidade).toBe("atencao");
  });

  it("marcou ontem: nenhum alarme de parada", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({ ultimaMarcacao: "2026-08-23T12:00:00Z" }),
      feitas: 2, total: 5, proximaEtapa: null, agoraIso: agora,
    });
    expect(p.map((x) => x.chave)).not.toContain("parado");
    expect(p.map((x) => x.chave)).not.toContain("esfriando");
  });
});

describe("prazo do projeto", () => {
  it("vencido com entrega aberta é urgente e diz há quantos dias", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({ prazo: "2026-08-20", ultimaMarcacao: "2026-08-23T12:00:00Z" }),
      feitas: 3, total: 5, proximaEtapa: null, agoraIso: agora,
    });
    expect(p.find((x) => x.chave === "prazo-vencido")?.texto).toContain("venceu há 4 dias");
  });

  it("prazo chegando com muita etapa aberta avisa antes de vencer", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({ prazo: "2026-08-27", ultimaMarcacao: "2026-08-23T12:00:00Z" }),
      feitas: 1, total: 5, proximaEtapa: null, agoraIso: agora,
    });
    const item = p.find((x) => x.chave === "prazo-apertando")!;
    expect(item.texto).toContain("Faltam 3 dias");
    expect(item.texto).toContain("4 etapas");
  });

  it("entrega completa não acusa nada, nem com prazo vencido", () => {
    // Terminou: o prazo virou história, não pendência.
    const p = pendenciasDoAvulso({
      situacao: situacao({ prazo: "2026-08-01" }),
      feitas: 5, total: 5, proximaEtapa: null, agoraIso: agora,
    });
    expect(p).toEqual([]);
  });
});

describe("por onde começar e seguir", () => {
  it("nada marcado ainda: o primeiro passo vem pelo nome", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({}),
      feitas: 0, total: 5, proximaEtapa: "Levantar o briefing do site", agoraIso: agora,
    });
    expect(p.find((x) => x.chave === "nao-comecou")?.texto)
      .toContain("levantar o briefing do site");
  });

  it("travado no meio: o próximo passo acompanha o alarme", () => {
    // "Parado há 8 dias" sem dizer o que fazer é diagnóstico sem receita.
    const p = pendenciasDoAvulso({
      situacao: situacao({ ultimaMarcacao: "2026-08-16T12:00:00Z" }),
      feitas: 2, total: 5, proximaEtapa: "Publicar a primeira versão", agoraIso: agora,
    });
    expect(p.find((x) => x.chave === "proximo-passo")?.texto)
      .toContain("publicar a primeira versão");
  });

  it("em dia e andando, a lista fica vazia", () => {
    const p = pendenciasDoAvulso({
      situacao: situacao({ ultimaMarcacao: "2026-08-23T12:00:00Z", prazo: "2026-09-20" }),
      feitas: 3, total: 5, proximaEtapa: "Ajustes finais", agoraIso: agora,
    });
    expect(p).toEqual([]);
  });
});

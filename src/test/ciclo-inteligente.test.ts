import { describe, expect, it } from "vitest";
import {
  etapasQueGiram,
  leituraDaCarteira,
  pendenciasDoCliente,
  textoDaEtapa,
  type Pendencia,
} from "@/lib/cycleSuggest";
import { situacaoVazia, type SituacaoDoCliente } from "@/lib/cycleSituation";

/**
 * O relato: "o ciclo está repetindo a mesma tarefa, e às vezes algo nada a
 * ver. Tem que ter contexto e ser inteligente. Tem que puxar do painel se
 * tem arte agendada, se tem conteúdo pronto, e me lembrar — tipo a central
 * de controle que não me faz esquecer."
 *
 * O ciclo antigo sorteava três tarefas de um acervo, determinístico por
 * semana, e não sabia NADA do painel. Podia mandar "planejar os stories"
 * para quem tinha sete artes paradas em aprovação há cinco dias, e não
 * dizer nada sobre a aprovação — a tarefa não era errada, era irrelevante.
 *
 * E o comentário do módulo prometia "não repetir o que ele já viu nas
 * últimas semanas": promessa que o código nunca cumpriu, porque o sorteio
 * não recebia o histórico.
 */

const situacao = (parcial: Partial<SituacaoDoCliente>): SituacaoDoCliente => ({
  ...situacaoVazia("c1"),
  ...parcial,
});

describe("a semana em branco é vista antes de acontecer", () => {
  it("nada agendado é urgente, e o texto diz que há arte esperando", () => {
    // O buraco mais silencioso: não dá erro em lugar nenhum, a semana só
    // passa em branco.
    const p = pendenciasDoCliente(situacao({ agendados: 0, artesProntas: 3 }), "social");
    const semAgenda = p.find((x) => x.chave === "sem-agenda")!;
    expect(semAgenda.gravidade).toBe("urgente");
    expect(semAgenda.texto).toContain("3 artes prontas esperando");
  });

  it("agenda de um post só vira atenção, não urgência", () => {
    const p = pendenciasDoCliente(situacao({ agendados: 1, artesProntas: 1 }), "social");
    expect(p.find((x) => x.chave === "agenda-curta")?.gravidade).toBe("atencao");
    expect(p.find((x) => x.chave === "sem-agenda")).toBeUndefined();
  });

  it("post que passou da hora e não foi ao ar é urgente", () => {
    // Some do futuro sem ir para o passado: ninguém percebe sozinho.
    const p = pendenciasDoCliente(situacao({ perderamAData: 2, agendados: 3 }), "social");
    const perdido = p.find((x) => x.chave === "perderam-data")!;
    expect(perdido.gravidade).toBe("urgente");
    expect(perdido.texto).toContain("2 posts passaram da hora");
  });
});

describe("aprovação parada tem prazo, não é sempre urgente", () => {
  it("parada há 4 dias vira urgência e etapa do checklist", () => {
    const p = pendenciasDoCliente(
      situacao({ aguardandoAprovacao: 2, aprovacaoParadaDias: 4, agendados: 3, artesProntas: 1 }),
      "social",
    );
    const ap = p.find((x) => x.chave === "aprovacao-parada")!;
    expect(ap.gravidade).toBe("urgente");
    expect(ap.viraEtapa).toBe(true);
    expect(ap.texto).toContain("há 4 dias");
  });

  it("enviada ontem é só acompanhamento, e não ocupa etapa", () => {
    // Cobrar aprovação de ontem é ruído: o cliente ainda nem olhou.
    const p = pendenciasDoCliente(
      situacao({ aguardandoAprovacao: 1, aprovacaoParadaDias: 1, agendados: 3, artesProntas: 1 }),
      "social",
    );
    const ap = p.find((x) => x.chave === "aprovacao-parada")!;
    expect(ap.gravidade).toBe("atencao");
    expect(ap.viraEtapa).toBe(false);
  });

  it("arte com alteração pedida e não refeita é urgente", () => {
    const p = pendenciasDoCliente(
      situacao({ artesRecusadas: 1, agendados: 3, artesProntas: 1 }),
      "social",
    );
    expect(p.find((x) => x.chave === "recusadas")?.gravidade).toBe("urgente");
  });
});

describe("cliente em dia não inventa pendência", () => {
  it("com agenda cheia, arte pronta e diário recente, a lista fica vazia", () => {
    const p = pendenciasDoCliente(
      situacao({
        agendados: 4,
        artesProntas: 2,
        ultimoDiario: new Date().toISOString(),
      }),
      "social",
    );
    expect(p).toEqual([]);
  });

  it("tráfego não herda pendência de social", () => {
    // Agenda vazia é problema de conteúdo, não de anúncio. Herdar seria
    // exatamente a queixa de "algo nada a ver".
    const p = pendenciasDoCliente(
      situacao({ agendados: 0, artesProntas: 0, campanhasTotal: 2, campanhasAtivas: 2 }),
      "trafego",
    );
    expect(p.map((x) => x.chave)).not.toContain("sem-agenda");
    expect(p.map((x) => x.chave)).not.toContain("sem-arte");
  });
});

describe("tráfego pago tem os buracos dele", () => {
  it("sem campanha nenhuma no painel, desconfia da conexão", () => {
    // Zero campanha quase nunca é "não fizemos": é conta desconectada.
    const p = pendenciasDoCliente(situacao({ campanhasTotal: 0 }), "trafego");
    expect(p[0].chave).toBe("sem-campanha-cadastrada");
    expect(p[0].texto).toContain("não estar conectada");
  });

  it("campanhas cadastradas mas nenhuma no ar é urgente", () => {
    const p = pendenciasDoCliente(
      situacao({ campanhasTotal: 4, campanhasAtivas: 0 }),
      "trafego",
    );
    const item = p.find((x) => x.chave === "nenhuma-ativa")!;
    expect(item.gravidade).toBe("urgente");
    expect(item.texto).toContain("4 campanhas");
  });

  it("verba zerada só alarma se houver campanha no ar", () => {
    // Carteira vazia com tudo pausado é estado normal de quem parou.
    const rodando = pendenciasDoCliente(
      situacao({ campanhasTotal: 2, campanhasAtivas: 2, saldoVerba: 0 }),
      "trafego",
    );
    expect(rodando.map((x) => x.chave)).toContain("verba-zerada");

    const parado = pendenciasDoCliente(
      situacao({ campanhasTotal: 2, campanhasAtivas: 0, saldoVerba: 0 }),
      "trafego",
    );
    expect(parado.map((x) => x.chave)).not.toContain("verba-zerada");
  });

  it("dado de campanha parado há dias vira atenção", () => {
    // Coleta quebrada envelhece os números sem avisar, e a decisão da
    // semana sai de dado velho.
    const p = pendenciasDoCliente(
      situacao({ campanhasTotal: 2, campanhasAtivas: 2, diasSemDadoDeCampanha: 5 }),
      "trafego",
    );
    expect(p.find((x) => x.chave === "dado-parado")?.texto).toContain("5 dias");
  });

  it("tráfego em dia não inventa pendência", () => {
    const p = pendenciasDoCliente(
      situacao({
        campanhasTotal: 3, campanhasAtivas: 3, saldoVerba: 500,
        diasSemDadoDeCampanha: 0, ultimoDiario: new Date().toISOString(),
      }),
      "trafego",
    );
    expect(p).toEqual([]);
  });
});

describe("o Kanban denuncia nas duas frentes", () => {
  it("tarefa vencida é urgente, em social e em tráfego", () => {
    for (const area of ["social", "trafego"] as const) {
      const p = pendenciasDoCliente(
        situacao({
          tarefasAtrasadas: 2, agendados: 3, artesProntas: 1,
          campanhasTotal: 1, campanhasAtivas: 1,
          ultimoDiario: new Date().toISOString(),
        }),
        area,
      );
      const item = p.find((x) => x.chave === "tarefa-atrasada")!;
      expect(item.gravidade).toBe("urgente");
      expect(item.texto).toContain("2 tarefas");
    }
  });

  it("tarefa sem dono só ocupa etapa quando vira monte", () => {
    // Uma tarefa solta é normal; três é sintoma de trabalho sem dono.
    const uma = pendenciasDoCliente(situacao({
      tarefasSemDono: 1, agendados: 3, artesProntas: 1,
      ultimoDiario: new Date().toISOString(),
    }), "social");
    expect(uma.find((x) => x.chave === "tarefa-sem-dono")?.viraEtapa).toBe(false);

    const tres = pendenciasDoCliente(situacao({
      tarefasSemDono: 3, agendados: 3, artesProntas: 1,
      ultimoDiario: new Date().toISOString(),
    }), "social");
    expect(tres.find((x) => x.chave === "tarefa-sem-dono")?.viraEtapa).toBe(true);
  });
});

describe("pauta no calendário sem arte", () => {
  it("é o buraco entre 'planejei' e 'existe conteúdo'", () => {
    // O calendário parece cheio e não há o que publicar.
    const p = pendenciasDoCliente(situacao({
      pautasSemArte: 4, agendados: 3, artesProntas: 1,
      ultimoDiario: new Date().toISOString(),
    }), "social");
    const item = p.find((x) => x.chave === "pauta-sem-arte")!;
    expect(item.gravidade).toBe("urgente");
    expect(item.texto).toContain("4 pautas");
    expect(textoDaEtapa(item)).toContain("Anexar a arte");
  });

  it("uma ou duas é acompanhamento, não urgência", () => {
    const p = pendenciasDoCliente(situacao({
      pautasSemArte: 1, agendados: 3, artesProntas: 1,
      ultimoDiario: new Date().toISOString(),
    }), "social");
    expect(p.find((x) => x.chave === "pauta-sem-arte")?.gravidade).toBe("atencao");
  });
});

describe("a realidade vem antes do acervo", () => {
  it("pendências ocupam as etapas primeiro", () => {
    const pend: Pendencia[] = [
      { chave: "sem-agenda", texto: "x", gravidade: "urgente", viraEtapa: true },
      { chave: "recusadas", texto: "y", gravidade: "urgente", viraEtapa: true },
    ];
    const etapas = etapasQueGiram({
      pendencias: pend,
      acervo: ["Tarefa de acervo A", "Tarefa de acervo B", "Tarefa de acervo C"],
      usadasAntes: [],
      quantidade: 3,
    });
    expect(etapas[0]).toBe("Agendar os posts da semana");
    expect(etapas[1]).toBe("Refazer a arte que o cliente pediu para mudar");
    expect(etapas[2]).toBe("Tarefa de acervo A");
  });

  it("pendência que é só aviso não vira etapa", () => {
    const etapas = etapasQueGiram({
      pendencias: [{ chave: "aprovacao-parada", texto: "x", gravidade: "atencao", viraEtapa: false }],
      acervo: ["Acervo A", "Acervo B", "Acervo C"],
      usadasAntes: [],
      quantidade: 3,
    });
    expect(etapas).toEqual(["Acervo A", "Acervo B", "Acervo C"]);
  });

  it("o acervo não repete o que apareceu nas últimas semanas", () => {
    // A promessa que o código antigo fazia no comentário e não cumpria.
    const etapas = etapasQueGiram({
      pendencias: [],
      acervo: ["Já vista 1", "Já vista 2", "Nova A", "Nova B", "Nova C"],
      usadasAntes: ["Já vista 1", "Já vista 2"],
      quantidade: 3,
    });
    expect(etapas).toEqual(["Nova A", "Nova B", "Nova C"]);
  });

  it("se o acervo inteiro já foi visto, prefere repetir a ficar vazio", () => {
    // Checklist com buraco é pior que checklist com repetição.
    const etapas = etapasQueGiram({
      pendencias: [],
      acervo: ["A", "B", "C"],
      usadasAntes: ["A", "B", "C"],
      quantidade: 3,
    });
    expect(etapas).toEqual(["A", "B", "C"]);
  });

  it("pendência repete de propósito enquanto o problema existir", () => {
    // Diferente do acervo: a agenda vazia continua vazia na semana
    // seguinte, e sumir da lista seria esconder o problema.
    const pend: Pendencia[] = [
      { chave: "sem-agenda", texto: "x", gravidade: "urgente", viraEtapa: true },
    ];
    const semana1 = etapasQueGiram({ pendencias: pend, acervo: ["A", "B", "C"], usadasAntes: [], quantidade: 3 });
    const semana2 = etapasQueGiram({
      pendencias: pend, acervo: ["A", "B", "C"],
      usadasAntes: semana1, quantidade: 3,
    });
    expect(semana2[0]).toBe("Agendar os posts da semana");
  });
});

describe("a leitura da carteira responde 'está tudo certo?'", () => {
  it("sem pendência nenhuma, diz que está tudo certo", () => {
    const r = leituraDaCarteira([
      { nome: "A", pendencias: [] },
      { nome: "B", pendencias: [] },
    ]);
    expect(r.frase).toContain("tudo certo");
    expect(r.emDia).toBe(2);
  });

  it("conta cada cliente uma vez só, pela pior pendência dele", () => {
    // Um cliente com três urgências é UM cliente que pede ação, não três.
    const r = leituraDaCarteira([
      { nome: "A", pendencias: [
        { chave: "a", texto: "", gravidade: "urgente", viraEtapa: true },
        { chave: "b", texto: "", gravidade: "urgente", viraEtapa: true },
        { chave: "c", texto: "", gravidade: "atencao", viraEtapa: true },
      ] },
      { nome: "B", pendencias: [{ chave: "d", texto: "", gravidade: "atencao", viraEtapa: true }] },
      { nome: "C", pendencias: [] },
    ]);
    expect(r.urgentes).toBe(1);
    expect(r.emAtencao).toBe(1);
    expect(r.emDia).toBe(1);
    expect(r.frase).toContain("1 cliente pede ação hoje");
  });
});

describe("tarefa se liga ao cliente pelo projeto, nunca direto", () => {
  it("nem a situação do ciclo nem o dossiê filtram tasks por client_id", async () => {
    // `tasks` NAO tem client_id — so project_id. Filtrar direto e um erro
    // que o PostgREST rejeita e o catch engole: a contagem volta zero e
    // ninguem percebe. Era o caso do dossie do MCP, que devolvia
    // tasks_open sempre vazio, e de uma primeira versao deste modulo.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");

    const situacao = readFileSync(resolve(raiz, "src/lib/cycleSituation.ts"), "utf8");
    const trechoTarefas = situacao.slice(situacao.indexOf('.from("projects")'));
    expect(trechoTarefas).toMatch(/tasks\(status/);
    expect(situacao).not.toMatch(/from\("tasks"\)[\s\S]{0,160}in\("client_id"/);

    const dossie = readFileSync(
      resolve(raiz, "supabase/functions/_shared/aceleriq-read-services.ts"), "utf8",
    );
    expect(dossie).not.toMatch(/from\('tasks'\)[\s\S]{0,200}\.eq\('client_id'/);
    expect(dossie).toContain("projects!inner(client_id)");
  });
});

describe("a pendência vira tarefa, não reclamação", () => {
  it("cada chave conhecida vira uma ação para fazer", () => {
    // "2 posts passaram da hora" é diagnóstico; "reagendar os posts" é o
    // que cabe num checklist.
    const chaves = ["perderam-data", "recusadas", "aprovacao-parada", "sem-agenda", "sem-arte"];
    for (const chave of chaves) {
      const texto = textoDaEtapa({ chave, texto: "cru", gravidade: "urgente", viraEtapa: true });
      expect(texto).not.toBe("cru");
      expect(texto.length).toBeGreaterThan(10);
    }
  });
});

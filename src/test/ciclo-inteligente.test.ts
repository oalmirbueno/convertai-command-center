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

describe("a régua do dono: a semana atual tem que ser melhor", () => {
  const emDia = {
    campanhasTotal: 2, campanhasAtivas: 2, saldoVerba: 500,
    diasSemDadoDeCampanha: 0, ultimoDiario: new Date().toISOString(),
  };

  it("menos leads que a semana anterior, com verba rodando, é urgente", () => {
    const p = pendenciasDoCliente(situacao({
      ...emDia, gasto7d: 300, gastoAnterior: 300, leads7d: 4, leadsAnterior: 9,
    }), "trafego");
    const item = p.find((x) => x.chave === "semana-pior")!;
    expect(item.gravidade).toBe("urgente");
    expect(item.texto).toContain("4 leads (antes 9)");
    expect(item.texto).toContain("custo por lead");
  });

  it("sem verba nas duas janelas, queda de lead não acusa", () => {
    // Sem gasto, menos lead é consequência, não sintoma: acusar seria o
    // falso positivo que faz o operador ignorar os avisos.
    const p = pendenciasDoCliente(situacao({
      ...emDia, gasto7d: 0, gastoAnterior: 0, leads7d: 0, leadsAnterior: 8,
    }), "trafego");
    expect(p.map((x) => x.chave)).not.toContain("semana-pior");
  });

  it("gastar sem gerar lead nenhum é urgente por si só", () => {
    const p = pendenciasDoCliente(situacao({
      ...emDia, gasto7d: 250, gastoAnterior: 200, leads7d: 0, leadsAnterior: 0,
    }), "trafego");
    expect(p.find((x) => x.chave === "verba-sem-lead")?.texto).toContain("R$250");
  });

  it("semana melhor não gera aviso nenhum", () => {
    const p = pendenciasDoCliente(situacao({
      ...emDia, gasto7d: 300, gastoAnterior: 300, leads7d: 12, leadsAnterior: 8,
    }), "trafego");
    expect(p).toEqual([]);
  });

  it("criativo saturado aponta a campanha pelo nome", () => {
    // "Renovar o criativo" sem dizer QUAL obriga a abrir o gerenciador
    // para descobrir — o aviso já entrega o alvo.
    const p = pendenciasDoCliente(situacao({
      ...emDia, frequenciaMaxima: 4.2, campanhaSaturada: "Promo Agosto",
    }), "trafego");
    const item = p.find((x) => x.chave === "criativo-saturado")!;
    expect(item.texto).toContain("Promo Agosto");
    expect(item.texto).toContain("4.2");
  });

  it("frequência saudável não acusa saturação", () => {
    const p = pendenciasDoCliente(situacao({
      ...emDia, frequenciaMaxima: 2.1, campanhaSaturada: "Promo",
    }), "trafego");
    expect(p.map((x) => x.chave)).not.toContain("criativo-saturado");
  });
});

describe("as compras da semana têm a régua do dono", () => {
  it("zero compra com lead chegando aponta a conversa, não o anúncio", async () => {
    const { leituraDasCompras } = await import("@/lib/cycleVendas");
    expect(leituraDasCompras(0, 7)).toContain("não está convertendo");
    expect(leituraDasCompras(0, 0)).toBe("0 compras registradas nesta semana");
  });

  it("uma ou duas ainda é pouco; três já é resultado", async () => {
    // A régua que ele ditou: 0 é ruim, 1-2 é pouco.
    const { leituraDasCompras } = await import("@/lib/cycleVendas");
    expect(leituraDasCompras(1, 5)).toContain("ainda pouco");
    expect(leituraDasCompras(2, 5)).toContain("ainda pouco");
    expect(leituraDasCompras(3, 5)).toBe("3 compras na semana");
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

describe("clicar no card revela mais do que o card mostrava", () => {
  it("a folha recebe a lista COMPLETA de pendencias e a jornada", async () => {
    // O relato: "ao clicar no card do cliente nao mudou nada". O card
    // mostra as duas piores pendencias; a folha que abre mostrava a mesma
    // tela de sempre. Quem clica veio ver TUDO.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");

    expect(folha).toContain("O painel está pedindo");
    // A lista da folha nao corta em duas como a do card.
    expect(folha).toContain("pendencias.map((p) =>");
    // Vazia diz "em dia" com todas as letras - a confirmacao que mata a
    // pulga atras da orelha, em vez de sumir em silencio.
    expect(folha).toContain("Tudo em dia por aqui");
    expect(folha).toContain("Entrada do cliente");
    // E a pagina realmente entrega os dados ao abrir a folha.
    expect(pagina).toContain("pendencias={");
    expect(pagina).toContain("jornada={");
  });
});

describe("post publicado NUNCA aparece como pendente", () => {
  const agora = new Date("2026-08-25T12:00:00Z").getTime();
  const seteDias = agora - 7 * 86_400_000;

  it("status published sem published_at era o aviso eterno - o caso do dono", async () => {
    // O relato: "tem post que foi postado mas no ciclo ainda parece
    // pendente". A baixa antiga marcava status published sem preencher
    // published_at; o contador julgava so pelas datas e acusava "perdeu a
    // data" PARA SEMPRE. O status e a palavra final.
    const { registrarPublicacao, situacaoVazia } = await import("@/lib/cycleSituation");
    const s = situacaoVazia("c1");
    registrarPublicacao(s, {
      status: "published", published_at: null,
      scheduled_at: "2026-08-24T10:00:00Z",
    }, agora, seteDias);
    expect(s.perderamAData).toBe(0);
    expect(s.publicadosNaSemana).toBe(1);
  });

  it("publicado com data conta na semana; antigo nao conta mas nao acusa", async () => {
    const { registrarPublicacao, situacaoVazia } = await import("@/lib/cycleSituation");
    const s = situacaoVazia("c1");
    registrarPublicacao(s, { status: "published", published_at: "2026-08-23T10:00:00Z", scheduled_at: null }, agora, seteDias);
    registrarPublicacao(s, { status: "published", published_at: "2026-07-01T10:00:00Z", scheduled_at: null }, agora, seteDias);
    expect(s.publicadosNaSemana).toBe(1);
    expect(s.perderamAData).toBe(0);
  });

  it("agendado para o futuro conta na agenda com o proximo dia", async () => {
    const { registrarPublicacao, situacaoVazia } = await import("@/lib/cycleSituation");
    const s = situacaoVazia("c1");
    registrarPublicacao(s, { status: "scheduled", published_at: null, scheduled_at: "2026-08-27T18:00:00Z" }, agora, seteDias);
    registrarPublicacao(s, { status: "scheduled", published_at: null, scheduled_at: "2026-08-26T09:00:00Z" }, agora, seteDias);
    expect(s.agendados).toBe(2);
    expect(s.proximoAgendado).toBe("2026-08-26T09:00:00Z");
  });

  it("agendado para tras e SEM publicar e o unico que acusa", async () => {
    const { registrarPublicacao, situacaoVazia } = await import("@/lib/cycleSituation");
    const s = situacaoVazia("c1");
    registrarPublicacao(s, { status: "scheduled", published_at: null, scheduled_at: "2026-08-23T10:00:00Z" }, agora, seteDias);
    expect(s.perderamAData).toBe(1);
  });
});

describe("as etapas da semana saem da realidade, congeladas", () => {
  it("a pendencia carrega o alvo pelo nome e a tela onde se resolve", () => {
    const p = pendenciasDoCliente(situacao({
      tarefasAtrasadas: 8,
      tarefasAtrasadasNomes: ["Arte do lancamento", "Legenda da promo", "Reel de terca"],
      agendados: 3, artesProntas: 1, ultimoDiario: new Date().toISOString(),
    }), "social");
    const item = p.find((x) => x.chave === "tarefa-atrasada")!;
    // "8 atrasadas" sem dizer QUAIS obriga a cacar no Kanban.
    expect(item.detalhes).toEqual(["Arte do lancamento", "Legenda da promo", "Reel de terca"]);
    expect(item.rota).toBe("/kanban");
  });

  it("com posts agendados ou publicados, 'nenhuma arte' NAO aparece", () => {
    // O relato do dono, literal: "fala nenhuma arte pronta sendo que ja
    // esta ate agendado". Cliente com agenda armada obviamente teve arte;
    // acusar ali e a mentira que faz o cockpit perder a confianca.
    const agendado = pendenciasDoCliente(situacao({
      artesProntas: 0, aguardandoAprovacao: 0, agendados: 4,
      ultimoDiario: new Date().toISOString(),
    }), "social");
    expect(agendado.map((x) => x.chave)).not.toContain("sem-arte");

    const publicou = pendenciasDoCliente(situacao({
      artesProntas: 0, aguardandoAprovacao: 0, agendados: 0, publicadosNaSemana: 2,
      ultimoDiario: new Date().toISOString(),
    }), "social");
    expect(publicou.map((x) => x.chave)).not.toContain("sem-arte");

    // Sem arte E sem agenda E sem publicacao: ai sim, de verdade.
    const vazio = pendenciasDoCliente(situacao({
      artesProntas: 0, aguardandoAprovacao: 0, agendados: 0, publicadosNaSemana: 0,
    }), "social");
    expect(vazio.map((x) => x.chave)).toContain("sem-arte");
  });

  it("o plano da semana existe como modulo congelavel", async () => {
    // A peca que faltava: o motor de pendencias existia e as etapas do
    // checklist continuavam saindo do sorteio antigo. O plano nasce da
    // realidade e CONGELA, porque a marcacao guarda so o numero da etapa
    // e rotulo que muda no meio da semana faria o historico mentir.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const plano = readFileSync(resolve(raiz, "src/lib/cycleWeekPlan.ts"), "utf8");
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");
    expect(plano).toContain('"ciclo_semana"');
    expect(pagina).toContain("congelarPlano(");
    expect(pagina).toContain("rotuloDoPlano(");
    // O rotulo do plano manda; o sorteio vira reserva.
    expect(pagina).toMatch(/rotuloDoPlano\(String\(client.id\), step\)[\s\S]{0,80}\?\? stepLabelForWeek/);
  });
});

describe("o holofote: uma acao por vez, como num jogo", () => {
  it("o card destaca a proxima etapa com botao de concluir", async () => {
    // "preencheu aquilo vem outro, ate fechar - igual nos games, da a
    // sensacao de avanco e realmente avanca". O holofote mostra UMA acao
    // com o rotulo real; concluir chama a proxima da mesma leva.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");
    expect(pagina).toContain("Agora · {doneCount + 1} de {clientTotal}");
    expect(pagina).toContain("stepLabelOf(client, nextStep)");
    // Fechou tudo: celebra e o cliente sai da fila (gaveta de fechados).
    expect(pagina).toContain("Semana fechada 🎉");
    // A trilha numerada continua: a sequencia guia, nao prende.
    expect(pagina).toContain("stepButton(index + 1, false)");
  });

  it("o plano e dinamico ate a primeira marcacao girante, depois trava", async () => {
    // "atualiza conforme": pendencia nova entra, resolvida sai - ate
    // alguem marcar. Dai o rotulo congela, porque a marcacao guarda so o
    // numero e trocar o texto depois faria o historico mentir.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");
    const plano = readFileSync(resolve(raiz, "src/lib/cycleWeekPlan.ts"), "utf8");
    expect(pagina).toContain("nenhumaGiranteMarcada");
    expect(pagina).toContain("substituirPlano({");
    expect(plano).toContain("export async function substituirPlano");
  });
});

describe("tres frentes, cada uma uma fila sequencial", () => {
  it("o card mostra 3 filas no lugar de 6 botoes, e cada Feito avanca a fila", async () => {
    // O pedido: "ao inves de 6 opcoes deixe 3; cada fila e uma frente da
    // semana; preencheu a primeira tarefa, segue para a segunda". O
    // avanco e REAL: cada Feito marca a etapa persistida de verdade -
    // nada simulado, nada de achismo.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");

    // As frentes moram em cycleDefs: card e folha mostram as MESMAS
    // filas, e em dois lugares uma divergiria no primeiro conserto.
    const defs = readFileSync(resolve(raiz, "src/lib/cycleDefs.ts"), "utf8");
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    expect(pagina).toContain("FRENTES_DA_SEMANA");
    expect(folha).toContain("FRENTES_DA_SEMANA");
    for (const frente of ["Produção", "Painel", "Publicação"]) {
      expect(defs).toContain(`nome: "${frente}"`);
    }
    // A folha destaca a proxima de cada fila e convida a concluir.
    expect(folha).toContain("agora: toque para concluir");
    // Cada fila destaca a primeira etapa ABERTA dela - concluiu, a
    // proxima da mesma fila assume.
    expect(pagina).toContain("frente.steps.find((s) => !etapaFeita(client, s))");
    // Fila completa vira selo, nao some da vista: fechar frente e
    // conquista visivel.
    expect(pagina).toContain("fechada");
    // O Feito marca a etapa real, pelo mesmo caminho de sempre.
    expect(pagina).toContain("void toggle(client, aberta)");
    // As frentes cobrem exatamente os 6 passos persistidos, sem buraco.
    expect(defs).toContain("steps: [1, 2]");
    expect(defs).toContain("steps: [3, 4]");
    expect(defs).toContain("steps: [5, 6]");
  });

  it("avulso segue com o holofote unico: uma entrega, uma fila", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");
    expect(pagina).toContain("avulso && nextStep &&");
  });
});

describe("cada pendencia cai na fila da frente dela", () => {
  it("agendar vai para Publicacao, arte para Producao, diario para Painel", async () => {
    // As capturas do dono mostraram "Agendar os posts" na fila Painel e
    // "Criar as artes" em Publicacao: a etapa certa na fila errada le
    // como bagunca. O slot agora segue o ASSUNTO da pendencia.
    const { etapasPorSlot } = await import("@/lib/cycleSuggest");
    const etapas = etapasPorSlot({
      pendencias: [
        { chave: "sem-agenda", texto: "", gravidade: "urgente", viraEtapa: true },
        { chave: "sem-arte", texto: "", gravidade: "urgente", viraEtapa: true },
        { chave: "diario-parado", texto: "", gravidade: "atencao", viraEtapa: true },
      ],
      acervoPorSlot: { 2: "Acervo P", 3: "Acervo M", 5: "Acervo Pub" },
      usadasAntes: [],
      slots: [2, 3, 5],
    });
    // Ordem devolvida: [slot2, slot3, slot5].
    expect(etapas[0]).toBe("Criar as artes da semana");
    expect(etapas[1]).toBe("Escrever no diário o que foi feito");
    expect(etapas[2]).toBe("Agendar os posts da semana");
  });

  it("pendencia sem casa pega slot livre; acervo fecha os buracos", async () => {
    const { etapasPorSlot } = await import("@/lib/cycleSuggest");
    const etapas = etapasPorSlot({
      pendencias: [
        // duas da mesma frente: a segunda nao cabe no slot 5 e vai ao livre
        { chave: "sem-agenda", texto: "", gravidade: "urgente", viraEtapa: true },
        { chave: "perderam-data", texto: "", gravidade: "urgente", viraEtapa: true },
      ],
      acervoPorSlot: { 2: "Acervo P", 3: "Acervo M", 5: "Acervo Pub" },
      usadasAntes: [],
      slots: [2, 3, 5],
    });
    expect(etapas[2]).toBe("Agendar os posts da semana");
    expect(etapas).toContain("Reagendar os posts que perderam a data");
    // O slot que sobrou vem do acervo, nao fica vazio.
    expect(etapas.every((e) => e.length > 0)).toBe(true);
  });

  it("sem pendencia nenhuma, cada slot usa o proprio acervo", async () => {
    const { etapasPorSlot } = await import("@/lib/cycleSuggest");
    const etapas = etapasPorSlot({
      pendencias: [],
      acervoPorSlot: { 2: "Acervo P", 3: "Acervo M", 5: "Acervo Pub" },
      usadasAntes: [],
      slots: [2, 3, 5],
    });
    expect(etapas).toEqual(["Acervo P", "Acervo M", "Acervo Pub"]);
  });

  it("o placar do que falta e a celebracao vivem na folha", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raiz = resolve(__dirname, "../..");
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    expect(folha).toContain("faltam ${clientTotal - doneSteps.length}");
    expect(folha).toContain("todas feitas");
    expect(folha).toContain("Semana fechada 🎉 Todas as frentes");
  });
});


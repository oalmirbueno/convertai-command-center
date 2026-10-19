import { describe, expect, it } from "vitest";
import {
  detectarAchados,
  detectarAnuncioSemLead,
  detectarAprovacaoParada,
  detectarCarteiraIaSemSaldo,
  detectarCobrancaAtrasada,
  detectarLeadsParados,
  detectarPropostasSemRetorno,
  detectarRitualPendente,
  detectarSemPostNaSemana,
  detectarVerbaZerada,
  ordenarAchados,
  ritualDevidoHoje,
  type Achado,
  type DadosDosAchados,
} from "@/components/achados/detectores";
import { LIMITE_DO_LEAD_PARADO } from "@/components/achados/detectores";
import { ESTAGIOS_ABERTOS } from "@/lib/comercial";

/**
 * Achados (20/10/2026): cada detector é função pura (dados → achado). Aqui,
 * dados de exemplo para cada um, o caso zero (não mostra), a ação certa e a
 * ordem por urgência e valor. A frase vem sem o número: o número é o
 * destaque grande do cartão.
 */

// Terça, 20/10/2026, meio-dia local.
const AGORA = new Date("2026-10-20T12:00:00").getTime();
const diasAtras = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

const base = (extra: Partial<DadosDosAchados> = {}): DadosDosAchados => ({
  agora: AGORA,
  hoje: "2026-10-20",
  segunda: "2026-10-19",
  clientes: [
    { id: "acerbi", nome: "Acerbi Carnes", recorrente: true, social: true },
    { id: "mirante", nome: "Mirante Luz", recorrente: true, social: true },
    { id: "avulso", nome: "Projeto Avulso", recorrente: false, social: false },
  ],
  ...extra,
});

describe("lead parado no CRM", () => {
  const lead = (id: string, estagio: string, dias: number, extra: Record<string, unknown> = {}) => ({
    id, nome: id, estagio, atualizadoEm: diasAtras(dias), ultimoEventoEm: null, proximoPassoEm: null, valorMensal: 1000, valorUnico: 0, clienteId: null, ...extra,
  });

  it("conta quem passou do limite da etapa e manda abrir o CRM", () => {
    const a = detectarLeadsParados(base({ leads: [lead("a", "novo", 3), lead("b", "proposta", 6), lead("c", "diagnostico", 3)] }))!;
    expect(a.numero).toBe(2);
    expect(a.frase).toBe("leads parados no CRM há 3+ dias");
    expect(a.acao).toEqual({ rotulo: "Abrir o CRM", rota: "/comercial/crm" });
    // Lead em proposta parado é urgente; o valor somado ordena.
    expect(a.tom).toBe("urgente");
    expect(a.valor).toBe(2000);
  });

  it("evento recente no histórico ou próximo passo agendado tiram o lead da lista", () => {
    const leads = [
      lead("a", "contato", 10, { ultimoEventoEm: diasAtras(1) }),
      lead("b", "contato", 10, { proximoPassoEm: "2026-10-22" }),
      lead("c", "ganho", 30),
    ];
    expect(detectarLeadsParados(base({ leads }))).toBeNull();
  });

  it("cada etapa aberta do funil tem limite (e só elas: o hook lê o CRM por estas chaves)", () => {
    expect(Object.keys(LIMITE_DO_LEAD_PARADO).sort()).toEqual([...ESTAGIOS_ABERTOS].sort());
  });

  it("sem dado (sem acesso) ou sem lead: não mostra", () => {
    expect(detectarLeadsParados(base({ leads: null }))).toBeNull();
    expect(detectarLeadsParados(base({ leads: [] }))).toBeNull();
  });
});

describe("proposta sem retorno", () => {
  const proposta = (id: string, followup: any) => ({ id, clienteId: "acerbi", titulo: "Redes", totalUnico: 3000, totalMensal: 1500, followup, endereco: `/mesa-proposta?client=acerbi&proposta=${id}&etapa=acompanhar` });

  it("uma proposta: a ação abre o follow-up pronto da Mesa Proposta", () => {
    const a = detectarPropostasSemRetorno(base({ propostas: [proposta("p1", { situacao: "viu_sem_resposta", dias: 5 }), proposta("p2", null)] }))!;
    expect(a.numero).toBe(1);
    expect(a.frase).toBe("proposta sem retorno há 5+ dias");
    expect(a.acao).toEqual({ rotulo: "Preparar follow-up", rota: "/mesa-proposta?client=acerbi&proposta=p1&etapa=acompanhar" });
    expect(a.valor).toBe(4500);
  });

  it("várias: lista de follow-ups; vencendo vira urgente", () => {
    const a = detectarPropostasSemRetorno(base({ propostas: [proposta("p1", { situacao: "nao_abriu", dias: 3 }), proposta("p2", { situacao: "vence_logo", dias: 1 })] }))!;
    expect(a.numero).toBe(2);
    expect(a.acao.rota).toBe("/clientes?propostas=1");
    expect(a.tom).toBe("urgente");
  });

  it("caso zero: nenhuma com follow-up", () => {
    expect(detectarPropostasSemRetorno(base({ propostas: [proposta("p1", null)] }))).toBeNull();
  });
});

describe("cliente com Social sem post na semana", () => {
  it("conta quem não tem post agendado ou publicado de segunda a domingo", () => {
    const publicacoes = [
      { clienteId: "acerbi", status: "scheduled", agendadaEm: "2026-10-23T15:00:00", publicadaEm: null },
      // Da semana passada e rascunho não contam.
      { clienteId: "mirante", status: "published", agendadaEm: "2026-10-15T15:00:00", publicadaEm: "2026-10-15T15:00:00" },
      { clienteId: "mirante", status: "draft", agendadaEm: "2026-10-21T15:00:00", publicadaEm: null },
    ];
    const a = detectarSemPostNaSemana(base({ publicacoes }))!;
    expect(a.numero).toBe(1);
    expect(a.clientes).toEqual(["mirante"]);
    expect(a.acao).toEqual({ rotulo: "Abrir a Agenda", rota: "/calendario?client=mirante" });
  });

  it("caso zero: todos com post", () => {
    const publicacoes = ["acerbi", "mirante"].map((c) => ({ clienteId: c, status: "published", agendadaEm: null, publicadaEm: "2026-10-19T18:00:00" }));
    expect(detectarSemPostNaSemana(base({ publicacoes }))).toBeNull();
    expect(detectarSemPostNaSemana(base({ publicacoes: null }))).toBeNull();
  });
});

describe("aprovação parada", () => {
  it("um cliente: copia o lembrete pronto para o grupo", () => {
    const aprovacoes = [
      { id: "f1", clienteId: "acerbi", nomeDoArquivo: "reel_vitrine.mp4", criadoEm: diasAtras(6) },
      { id: "f2", clienteId: "acerbi", nomeDoArquivo: "arte_promo.png", criadoEm: diasAtras(2) },
    ];
    const a = detectarAprovacaoParada(base({ aprovacoes }))!;
    expect(a.numero).toBe(1);
    expect(a.frase).toBe("material parado na aprovação do cliente há 5+ dias");
    expect(a.acao.rotulo).toBe("Copiar lembrete");
    expect(a.acao.copiar).toContain("Oi, Acerbi!");
    expect(a.acao.copiar).toContain("Reel vitrine está esperando seu ok");
    expect(a.acao.rota).toBeUndefined();
  });

  it("vários clientes: abre as aprovações; mais de 7 dias é urgente", () => {
    const aprovacoes = [
      { id: "f1", clienteId: "acerbi", nomeDoArquivo: "a.png", criadoEm: diasAtras(9) },
      { id: "f2", clienteId: "mirante", nomeDoArquivo: "b.png", criadoEm: diasAtras(5) },
    ];
    const a = detectarAprovacaoParada(base({ aprovacoes }))!;
    expect(a.acao).toEqual({ rotulo: "Abrir aprovações", rota: "/aprovacoes" });
    expect(a.tom).toBe("urgente");
  });

  it("caso zero: nada parado há mais de 4 dias", () => {
    expect(detectarAprovacaoParada(base({ aprovacoes: [{ id: "f", clienteId: "acerbi", nomeDoArquivo: "x", criadoEm: diasAtras(4) }] }))).toBeNull();
  });
});

describe("anúncios", () => {
  const dia = (clienteId: string, campanhaId: string, d: string, gasto: number, leads: number) => ({ clienteId, campanhaId, dia: d, gasto, leads });

  it("campanha gastando sem lead em 7 dias", () => {
    const anuncios = [dia("acerbi", "c1", "2026-10-18", 80, 0), dia("acerbi", "c1", "2026-10-19", 70, 0), dia("acerbi", "c2", "2026-10-19", 50, 3)];
    const a = detectarAnuncioSemLead(base({ anuncios }))!;
    expect(a.numero).toBe(1);
    expect(a.frase).toContain("campanha gastou");
    expect(a.frase).toContain("150");
    expect(a.acao).toEqual({ rotulo: "Abrir anúncios", rota: "/anuncios" });
    expect(a.valor).toBe(150);
    expect(detectarAnuncioSemLead(base({ anuncios: [dia("acerbi", "c2", "2026-10-19", 50, 3)] }))).toBeNull();
  });

  it("verba zerada com campanha no ar: aviso pronto para copiar", () => {
    const a = detectarVerbaZerada(base({ verbas: [{ clienteId: "acerbi", saldo: 0 }, { clienteId: "mirante", saldo: 200 }], anuncios: [dia("acerbi", "c1", "2026-10-19", 30, 1)] }))!;
    expect(a.numero).toBe(1);
    expect(a.tom).toBe("urgente");
    expect(a.acao.copiar).toContain("verba dos anúncios chegou a zero");
    // Sem campanha gastando, saldo zero não é achado.
    expect(detectarVerbaZerada(base({ verbas: [{ clienteId: "acerbi", saldo: 0 }], anuncios: [] }))).toBeNull();
  });
});

describe("carteira de IA", () => {
  it("sem saldo e com uso nos últimos 30 dias", () => {
    const carteirasIa = [
      { clienteId: "acerbi", saldoUsd: -0.4, atualizadoEm: diasAtras(2) },
      { clienteId: "mirante", saldoUsd: 0, atualizadoEm: diasAtras(90) },
      { clienteId: "avulso", saldoUsd: 0, atualizadoEm: diasAtras(1) },
    ];
    const a = detectarCarteiraIaSemSaldo(base({ carteirasIa }))!;
    expect(a.numero).toBe(1);
    expect(a.acao).toEqual({ rotulo: "Recarregar na Mesa", rota: "/mesa?client=acerbi" });
    expect(detectarCarteiraIaSemSaldo(base({ carteirasIa: [{ clienteId: "acerbi", saldoUsd: 5, atualizadoEm: diasAtras(1) }] }))).toBeNull();
  });
});

describe("cobrança atrasada", () => {
  const cobranca = (clienteId: string, vencimento: string, valor: number, tipo = "monthly") => ({ clienteId, status: "pending", tipo, vencimento, valor });

  it("um cliente: copia a mensagem de cobrança pronta", () => {
    const a = detectarCobrancaAtrasada(base({ cobrancas: [cobranca("acerbi", "2026-10-10", 1500), cobranca("acerbi", "2026-10-30", 1500), cobranca("acerbi", "2026-10-01", 900, "ads_recharge")] }))!;
    expect(a.numero).toBe(1);
    expect(a.valor).toBe(1500);
    expect(a.acao.rotulo).toBe("Copiar cobrança");
    expect(a.acao.copiar).toContain("Oi, Acerbi!");
    expect(a.acao.copiar).toContain("10/10");
  });

  it("vários clientes: abre o financeiro", () => {
    const a = detectarCobrancaAtrasada(base({ cobrancas: [cobranca("acerbi", "2026-10-10", 1500), cobranca("mirante", "2026-10-12", 800)] }))!;
    expect(a.numero).toBe(2);
    expect(a.acao).toEqual({ rotulo: "Abrir financeiro", rota: "/financeiro" });
  });

  it("caso zero: nada vencido", () => {
    expect(detectarCobrancaAtrasada(base({ cobrancas: [cobranca("acerbi", "2026-10-25", 1500)] }))).toBeNull();
  });
});

describe("ritual da semana", () => {
  it("o ritual devido segue o dia: segunda abre, quarta checa, sexta fecha", () => {
    expect(ritualDevidoHoje("2026-10-19").chave).toBe("segunda");
    expect(ritualDevidoHoje("2026-10-20")).toMatchObject({ chave: "segunda", diasDeAtraso: 1 });
    expect(ritualDevidoHoje("2026-10-21").chave).toBe("quarta");
    expect(ritualDevidoHoje("2026-10-23").chave).toBe("sexta");
    expect(ritualDevidoHoje("2026-10-25").chave).toBe("sexta");
  });

  it("conta os recorrentes sem o ritual do dia e leva ao gerador", () => {
    const a = detectarRitualPendente(base({ rituaisFeitos: [{ clienteId: "acerbi", ritual: "segunda" }] }))!;
    expect(a.numero).toBe(1);
    expect(a.frase).toBe("cliente sem a Rota da Semana enviada");
    expect(a.acao).toEqual({ rotulo: "Gerar", rota: "/central" });
    expect(a.extra).toEqual({ ritual: "rota_semana" });
    expect(a.tom).toBe("urgente");
  });

  it("caso zero: todos com o ritual feito", () => {
    expect(detectarRitualPendente(base({ rituaisFeitos: [{ clienteId: "acerbi", ritual: "segunda" }, { clienteId: "mirante", ritual: "segunda" }] }))).toBeNull();
  });
});

describe("juntar os achados", () => {
  it("só número maior que zero, urgente antes, e dinheiro em jogo desempata", () => {
    const dados = base({
      cobrancas: [{ clienteId: "acerbi", status: "pending", tipo: "monthly", vencimento: "2026-10-10", valor: 1500 }],
      rituaisFeitos: [{ clienteId: "acerbi", ritual: "segunda" }, { clienteId: "mirante", ritual: "segunda" }],
      aprovacoes: [{ id: "f", clienteId: "mirante", nomeDoArquivo: "x.png", criadoEm: diasAtras(5) }],
      publicacoes: [],
    });
    const lista = detectarAchados(dados);
    expect(lista.map((a) => a.id)).toEqual(["cobranca-atrasada", "sem-post-na-semana", "aprovacao-parada"]);
    expect(lista.every((a) => a.numero > 0)).toBe(true);
  });

  it("com cliente em foco, tudo fala só dele", () => {
    const dados = base({
      cobrancas: [
        { clienteId: "acerbi", status: "pending", tipo: "monthly", vencimento: "2026-10-10", valor: 1500 },
        { clienteId: "mirante", status: "pending", tipo: "monthly", vencimento: "2026-10-10", valor: 900 },
      ],
      publicacoes: [{ clienteId: "acerbi", status: "scheduled", agendadaEm: "2026-10-22T10:00:00", publicadaEm: null }],
      clienteEmFoco: "acerbi",
    });
    const lista = detectarAchados(dados);
    expect(lista.map((a) => a.id)).toEqual(["cobranca-atrasada"]);
    expect(lista[0].numero).toBe(1);
    expect(lista[0].acao.rotulo).toBe("Copiar cobrança");
  });

  it("ordenar: tom, depois valor, depois número", () => {
    const a = (id: string, tom: Achado["tom"], valor: number, numero = 1): Achado => ({ id, tom, valor, numero, frase: id, acao: { rotulo: "x", rota: "/" }, clientes: [], ajuda: "" });
    expect(ordenarAchados([a("c", "atencao", 0, 9), a("b", "urgente", 10), a("a", "urgente", 500)]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

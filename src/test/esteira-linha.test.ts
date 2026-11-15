import { describe, expect, it } from "vitest";
import {
  CLIENTES_COM_DIA_PRIORITARIO_SUSPENSO_TEMPORARIAMENTE, aprovacaoDoClienteDispensada, clienteContaComoDiaPrioritario, dataDaPeca, decidirEtapa, diaCivilEmSP,
  diaPrioritarioDefinido, diasDaSemana, linkDoCartao, meiaNoiteEmSP, montarGrade, msAteProximaMeiaNoiteSP, podeAbrirEstudio, rotuloDaSemana,
  rotuloDoFormato, segundaDaSemana, somarDias, textoDaRevisaoInterna, type PecaFato, type RevisaoInterna,
} from "@/lib/esteiraLinha/esteiraLinha";
import { juntarPecas, revisaoDoTrabalho, type LinhasDaEsteiraLinha } from "@/lib/esteiraLinha/esteiraLinhaFatos";
import { dataEmSP } from "@/lib/diaPrioritario";

/**
 * Esteira em linha do tempo (fase 1): a etapa do cartão, o dia da peça no
 * fuso de São Paulo, o destaque e o alerta do dia prioritário e o link.
 */

// Semana de 16/11/2026 (segunda) a 22/11/2026 (domingo).
const SEGUNDA = "2026-11-16";

function peca(extra: Partial<PecaFato> = {}): PecaFato {
  return {
    chave: "post:p1",
    clientId: "c1",
    titulo: "Peça",
    contentType: "static",
    post: { id: "p1", production_status: "draft", archived_at: null, temArquivo: false },
    publicacoes: [],
    tarefa: null,
    trabalho: null,
    arquivos: [],
    ...extra,
  };
}
const pub = (status: string, scheduled_at: string | null = null, published_at: string | null = null) => ({ status, scheduled_at, published_at });
const comArquivo = { id: "p1", production_status: "ready", archived_at: null, temArquivo: true };

describe("etapa do cartão", () => {
  it("publicado é no ar; agendado é agendado; publicado ganha de agendado", () => {
    expect(decidirEtapa(peca({ publicacoes: [pub("published", null, "2026-11-17T12:00:00Z")] }))).toEqual({ etapa: "no_ar", rotulo: "No ar" });
    expect(decidirEtapa(peca({ publicacoes: [pub("scheduled", "2026-11-17T12:00:00Z")] }))).toEqual({ etapa: "agendado", rotulo: "Agendado" });
    expect(decidirEtapa(peca({ publicacoes: [pub("scheduled", "2026-11-18T12:00:00Z"), pub("published", null, "2026-11-17T12:00:00Z")] }))?.etapa).toBe("no_ar");
  });

  it("aprovado e ainda não agendado fica em aprovação com o texto Aprovado", () => {
    const aprovada = peca({ post: comArquivo, arquivos: [{ approval_status: "approved", agency_approval_status: "approved" }], publicacoes: [pub("planned", "2026-11-17T12:00:00Z")] });
    expect(decidirEtapa(aprovada)).toEqual({ etapa: "aprovacao", rotulo: "Aprovado" });
    expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status: "todo", due_date: "2026-11-17" }, trabalho: { status: "entregue", entrega_status: "aprovado", temArquivo: true } }))).toEqual({ etapa: "aprovacao", rotulo: "Aprovado" });
  });

  it("aguardando o cliente: pelo arquivo ou pela entrega do Estúdio", () => {
    expect(decidirEtapa(peca({ post: comArquivo, arquivos: [{ approval_status: "pending", agency_approval_status: "approved" }] }))).toEqual({ etapa: "aprovacao", rotulo: "Aguardando o cliente" });
    expect(decidirEtapa(peca({ trabalho: { status: "entregue", entrega_status: "aguardando_cliente", temArquivo: true } }))).toEqual({ etapa: "aprovacao", rotulo: "Aguardando o cliente" });
  });

  it("revisão só com sinal real da agência; sem sinal não inventa revisão", () => {
    expect(decidirEtapa(peca({ post: comArquivo, arquivos: [{ approval_status: "none", agency_approval_status: "pending" }] }))?.etapa).toBe("revisao");
    expect(decidirEtapa(peca({ trabalho: { status: "entregue", entrega_status: "aguardando_agencia", temArquivo: true } }))?.etapa).toBe("revisao");
    // Agência ainda pendente no mesmo arquivo: a peça não chegou ao cliente.
    expect(decidirEtapa(peca({ post: comArquivo, arquivos: [{ approval_status: "pending", agency_approval_status: "pending" }] }))?.etapa).toBe("revisao");
    expect(decidirEtapa(peca({ post: comArquivo, arquivos: [{ approval_status: "none", agency_approval_status: "not_requested" }] }))?.etapa).toBe("arte");
  });

  it("arte: só trabalho do Estúdio, post em produção ou pronto com arquivo; reprovado volta para a arte", () => {
    expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status: "todo", due_date: "2026-11-17" }, trabalho: { status: "gerando", entrega_status: null, temArquivo: false } }))).toEqual({ etapa: "arte", rotulo: "Arte" });
    expect(decidirEtapa(peca({ post: { id: "p1", production_status: "production", archived_at: null, temArquivo: false } }))?.etapa).toBe("arte");
    expect(decidirEtapa(peca({ post: comArquivo }))?.etapa).toBe("arte");
    expect(decidirEtapa(peca({ post: comArquivo, arquivos: [{ approval_status: "rejected", agency_approval_status: "approved" }] }))).toEqual({ etapa: "arte", rotulo: "Ajustes na arte" });
    expect(decidirEtapa(peca({ trabalho: { status: "entregue", entrega_status: "reprovado", temArquivo: true } }))?.etapa).toBe("arte");
  });

  it("pauta: post em rascunho, pronto sem arquivo ou só a tarefa", () => {
    expect(decidirEtapa(peca())).toEqual({ etapa: "pauta", rotulo: "Pauta" });
    expect(decidirEtapa(peca({ post: { id: "p1", production_status: "ready", archived_at: null, temArquivo: false } }))?.etapa).toBe("pauta");
    expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status: "todo", due_date: "2026-11-17" } }))?.etapa).toBe("pauta");
  });

  it("tarefa concluída sem post, trabalho ou arquivo não volta para a pauta: fica em arte como Concluída", () => {
    const soTarefa = (status: string) => peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status, due_date: "2026-11-17" } });
    expect(decidirEtapa(soTarefa("done"))).toEqual({ etapa: "arte", rotulo: "Concluída" });
    expect(decidirEtapa(soTarefa("completed"))).toEqual({ etapa: "arte", rotulo: "Concluída" });
    expect(decidirEtapa(soTarefa("todo"))).toEqual({ etapa: "pauta", rotulo: "Pauta" });
    expect(decidirEtapa(soTarefa("in_progress"))?.etapa).toBe("pauta");
    // Estágios mais avançados continuam ganhando da tarefa concluída.
    expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status: "done", due_date: "2026-11-17" }, trabalho: { status: "entregue", entrega_status: "aguardando_cliente", temArquivo: true } }))?.rotulo).toBe("Aguardando o cliente");
    expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status: "done", due_date: "2026-11-17" }, trabalho: { status: "gerando", entrega_status: null, temArquivo: false } }))).toEqual({ etapa: "arte", rotulo: "Arte" });
    expect(decidirEtapa(peca({ tarefa: { id: "t1", status: "done", due_date: "2026-11-17" }, publicacoes: [pub("published", null, "2026-11-17T12:00:00Z")] }))?.etapa).toBe("no_ar");
  });

  it("arquivado e cancelado não têm etapa; publicação cancelada é ignorada", () => {
    expect(decidirEtapa(peca({ post: { id: "p1", production_status: "ready", archived_at: "2026-11-01T00:00:00Z", temArquivo: true } }))).toBeNull();
    expect(decidirEtapa(peca({ post: { id: "p1", production_status: "cancelled", archived_at: null, temArquivo: false } }))).toBeNull();
    expect(decidirEtapa(peca({ post: null, tarefa: { id: "t1", status: "cancelled", due_date: "2026-11-17" } }))).toBeNull();
    expect(decidirEtapa(peca({ publicacoes: [pub("cancelled", "2026-11-17T12:00:00Z", "2026-11-17T12:00:00Z")] }))?.etapa).toBe("pauta");
  });
});

describe("dia da peça (America/Sao_Paulo)", () => {
  it("instante UTC cai no dia certo de São Paulo; data pura não muda", () => {
    // 01:30 UTC de 18/11 ainda é 22:30 de 17/11 em São Paulo.
    expect(diaCivilEmSP("2026-11-18T01:30:00Z")).toBe("2026-11-17");
    // 23:30 de 17/11 no fuso -05:00 já é 01:30 de 18/11 em São Paulo.
    expect(diaCivilEmSP("2026-11-17T23:30:00-05:00")).toBe("2026-11-18");
    expect(diaCivilEmSP("2026-11-17")).toBe("2026-11-17");
    expect(diaCivilEmSP(null)).toBeNull();
    expect(diaCivilEmSP("sem data")).toBeNull();
  });

  it("ordem: publicado em, agendado para, planejado com data, prazo da tarefa; sem data não entra", () => {
    const tarefa = { id: "t1", status: "todo", due_date: "2026-11-20" };
    expect(dataDaPeca(peca({ tarefa, publicacoes: [pub("scheduled", "2026-11-19T15:00:00Z"), pub("published", "2026-11-18T15:00:00Z", "2026-11-18T01:30:00Z")] }))).toBe("2026-11-17");
    expect(dataDaPeca(peca({ tarefa, publicacoes: [pub("planned", "2026-11-16T15:00:00Z"), pub("scheduled", "2026-11-19T15:00:00Z")] }))).toBe("2026-11-19");
    expect(dataDaPeca(peca({ tarefa, publicacoes: [pub("planned", "2026-11-18T15:00:00Z")] }))).toBe("2026-11-18");
    expect(dataDaPeca(peca({ tarefa, publicacoes: [pub("planned"), pub("cancelled", "2026-11-16T15:00:00Z")] }))).toBe("2026-11-20");
    expect(dataDaPeca(peca())).toBeNull();
  });

  it("semana: segunda a domingo da semana corrente em São Paulo", () => {
    // Domingo 22/11 às 23:30 em São Paulo (02:30 UTC de segunda) ainda é a semana do dia 16.
    expect(segundaDaSemana(new Date("2026-11-23T02:30:00Z"))).toBe("2026-11-16");
    expect(segundaDaSemana(new Date("2026-11-23T03:30:00Z"))).toBe("2026-11-23");
    expect(segundaDaSemana(new Date("2026-11-18T15:00:00Z"))).toBe(SEGUNDA);
    expect(diasDaSemana(SEGUNDA).map((d) => d.rotulo)).toEqual(["Seg 16", "Ter 17", "Qua 18", "Qui 19", "Sex 20", "Sáb 21", "Dom 22"]);
    expect(somarDias(SEGUNDA, -7)).toBe("2026-11-09");
    expect(somarDias("2026-11-30", 6)).toBe("2026-12-06");
    expect(rotuloDaSemana(SEGUNDA)).toBe("16 a 22 de novembro de 2026");
    expect(rotuloDaSemana("2026-11-30")).toBe("30 de novembro a 6 de dezembro de 2026");
  });
});

describe("relógio da meia-noite em São Paulo", () => {
  it("a meia-noite de SP é 03:00 UTC (Brasil sem horário de verão), calculada pelo fuso", () => {
    expect(meiaNoiteEmSP("2026-11-19").toISOString()).toBe("2026-11-19T03:00:00.000Z");
    expect(meiaNoiteEmSP("2026-01-01").toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  it("um instante antes da meia-noite cai no dia seguinte em poucos milissegundos", () => {
    // 23:59:59.500 de 18/11 em São Paulo.
    const quaseMeiaNoite = new Date("2026-11-19T02:59:59.500Z");
    expect(dataEmSP(quaseMeiaNoite)).toBe("2026-11-18");
    const espera = msAteProximaMeiaNoiteSP(quaseMeiaNoite);
    expect(espera).toBe(500);
    expect(dataEmSP(new Date(quaseMeiaNoite.getTime() + espera))).toBe("2026-11-19");
  });

  it("logo após a meia-noite aponta para a meia-noite seguinte (~24h) e nunca devolve zero", () => {
    const recemVirado = new Date("2026-11-19T03:00:00.250Z");
    expect(dataEmSP(recemVirado)).toBe("2026-11-19");
    expect(msAteProximaMeiaNoiteSP(recemVirado)).toBe(24 * 60 * 60_000 - 250);
    expect(msAteProximaMeiaNoiteSP(new Date("2026-11-19T03:00:00.000Z"))).toBe(24 * 60 * 60_000);
    expect(msAteProximaMeiaNoiteSP(new Date("2026-11-18T15:00:00Z"))).toBe(12 * 60 * 60_000);
  });
});

describe("dia prioritário", () => {
  it("só vale dia útil com situação de dia definido", () => {
    expect(diaPrioritarioDefinido({ client_id: "c1", dia: 2, situacao: "confirmado" })).toBe(2);
    expect(diaPrioritarioDefinido({ client_id: "c1", dia: 4, situacao: "provisorio" })).toBe(4);
    expect(diaPrioritarioDefinido({ client_id: "c1", dia: 2, situacao: "nao_aplicavel" })).toBeNull();
    expect(diaPrioritarioDefinido({ client_id: "c1", dia: null, situacao: "confirmado" })).toBeNull();
    expect(diaPrioritarioDefinido({ client_id: "c1", dia: 6, situacao: "confirmado" })).toBeNull();
    expect(diaPrioritarioDefinido(undefined)).toBeNull();
  });

  it("destaca o dia; alerta só no dia prioritário vazio; sem alerta para não se aplica ou dia nulo", () => {
    const faixas = montarGrade({
      segunda: SEGUNDA,
      clientes: [{ id: "c2", nome: "Beta" }, { id: "c1", nome: "Alfa" }, { id: "c3", nome: "Gama" }, { id: "c4", nome: "Delta" }],
      diasPrioritarios: [
        { client_id: "c1", dia: 2, situacao: "confirmado" },
        { client_id: "c2", dia: 3, situacao: "confirmado" },
        { client_id: "c3", dia: 2, situacao: "nao_aplicavel" },
        { client_id: "c4", dia: null, situacao: "confirmado" },
      ],
      pecas: [
        peca({ clientId: "c1", publicacoes: [pub("scheduled", "2026-11-17T15:00:00Z")] }),
        peca({ chave: "post:p2", clientId: "c2", post: { id: "p2", production_status: "draft", archived_at: null, temArquivo: false }, publicacoes: [pub("planned", "2026-11-19T15:00:00Z")] }),
      ],
    });
    // Uma faixa por cliente, em ordem alfabética, mesmo sem peça.
    expect(faixas.map((f) => f.nome)).toEqual(["Alfa", "Beta", "Delta", "Gama"]);
    const [alfa, beta, delta, gama] = faixas;
    expect(alfa.diaPrioritario).toBe(2);
    expect(alfa.nomeDoDiaPrioritario).toBe("terça-feira");
    expect(alfa.celulas[1]).toMatchObject({ data: "2026-11-17", prioritario: true, alerta: false });
    expect(alfa.celulas[1].cartoes).toHaveLength(1);
    expect(alfa.celulas.filter((c) => c.prioritario)).toHaveLength(1);
    // Beta tem peça na quinta, mas o dia prioritário (quarta) está vazio.
    expect(beta.celulas[2]).toMatchObject({ data: "2026-11-18", prioritario: true, alerta: true });
    expect(beta.celulas[3].cartoes).toHaveLength(1);
    expect(beta.celulas[3].alerta).toBe(false);
    for (const faixa of [delta, gama]) {
      expect(faixa.diaPrioritario).toBeNull();
      expect(faixa.celulas.some((c) => c.prioritario || c.alerta)).toBe(false);
    }
  });
});

describe("cliente pausado não conta como dia prioritário", () => {
  const RD_AR = "52f2efb6-9928-4074-b8e2-bc972baf1f6a";
  it("a lista temporária tem a RD AR; status de pausa também tira o dia; active fora da lista conta", () => {
    expect(CLIENTES_COM_DIA_PRIORITARIO_SUSPENSO_TEMPORARIAMENTE.has(RD_AR)).toBe(true);
    expect(clienteContaComoDiaPrioritario({ id: RD_AR, planStatus: "active" })).toBe(false);
    expect(clienteContaComoDiaPrioritario({ id: "c1", planStatus: "active" })).toBe(true);
    expect(clienteContaComoDiaPrioritario({ id: "c1" })).toBe(true);
    for (const status of ["standby", "paused", "pausado", "inactive", "Paused "]) {
      expect(clienteContaComoDiaPrioritario({ id: "c1", planStatus: status })).toBe(false);
    }
  });

  it("na grade: faixa presente, sem destaque e sem alerta, mesmo com dia definido e célula vazia", () => {
    const faixas = montarGrade({
      segunda: SEGUNDA,
      clientes: [
        { id: "c1", nome: "Alfa", planStatus: "active" },
        { id: RD_AR, nome: "Rd Ar Climatização", planStatus: "active" },
        { id: "c5", nome: "Standby Ltda", planStatus: "standby" },
      ],
      diasPrioritarios: [
        { client_id: "c1", dia: 2, situacao: "confirmado" },
        { client_id: RD_AR, dia: 2, situacao: "confirmado" },
        { client_id: "c5", dia: 3, situacao: "confirmado" },
      ],
      pecas: [],
    });
    expect(faixas.map((f) => f.nome)).toEqual(["Alfa", "Rd Ar Climatização", "Standby Ltda"]);
    const [alfa, rdAr, standby] = faixas;
    // Alfa (active, fora da lista): alerta como hoje.
    expect(alfa.diaPrioritario).toBe(2);
    expect(alfa.celulas[1]).toMatchObject({ prioritario: true, alerta: true });
    // RD AR e standby: a faixa continua, mas sem dia prioritário, destaque ou alerta.
    for (const faixa of [rdAr, standby]) {
      expect(faixa.celulas).toHaveLength(7);
      expect(faixa.diaPrioritario).toBeNull();
      expect(faixa.nomeDoDiaPrioritario).toBe("");
      expect(faixa.celulas.some((c) => c.prioritario || c.alerta)).toBe(false);
    }
  });
});

describe("grade", () => {
  it("peça sem data, de outra semana, arquivada ou cancelada não entra", () => {
    const faixas = montarGrade({
      segunda: SEGUNDA,
      clientes: [{ id: "c1", nome: "Alfa" }],
      diasPrioritarios: [],
      pecas: [
        peca({ chave: "post:sem-data" }),
        peca({ chave: "post:outra-semana", publicacoes: [pub("scheduled", "2026-11-24T15:00:00Z")] }),
        peca({ chave: "post:arquivado", post: { id: "p9", production_status: "ready", archived_at: "2026-11-01T00:00:00Z", temArquivo: true }, publicacoes: [pub("scheduled", "2026-11-17T15:00:00Z")] }),
        peca({ chave: "post:so-cancelada", publicacoes: [pub("cancelled", "2026-11-17T15:00:00Z")] }),
        peca({ chave: "post:vale", titulo: "Vale", contentType: "carousel", publicacoes: [pub("scheduled", "2026-11-18T01:30:00Z")] }),
      ],
    });
    const cartoes = faixas[0].celulas.flatMap((c) => c.cartoes.map((k) => `${c.data}:${k.chave}`));
    // 01:30 UTC de quarta é terça à noite em São Paulo.
    expect(cartoes).toEqual(["2026-11-17:post:vale"]);
    expect(faixas[0].celulas[1].cartoes[0]).toMatchObject({ titulo: "Vale", formato: "Carrossel", etapa: "agendado", rotuloDaEtapa: "Agendado", destino: "agenda" });
  });

  it("formato em português", () => {
    expect(["static", "story", "carousel", "reel"].map(rotuloDoFormato)).toEqual(["Post", "Story", "Carrossel", "Reel"]);
    expect(rotuloDoFormato(null)).toBe("Conteúdo");
  });
});

describe("link do cartão", () => {
  const tarefa = { id: "t1", status: "todo", due_date: "2026-11-17" };
  const trabalho = { status: "pronto", entrega_status: null, temArquivo: true };
  it("com post abre a Agenda no conteúdo, mesmo com trabalho do Estúdio", () => {
    expect(linkDoCartao(peca())).toBe("/calendario?client=c1&content=p1");
    expect(linkDoCartao(peca({ tarefa, trabalho }))).toBe("/calendario?client=c1&content=p1");
  });
  it("sem post e com trabalho do Estúdio abre o Estúdio na tarefa; só tarefa abre a Agenda do cliente", () => {
    expect(linkDoCartao(peca({ post: null, tarefa, trabalho }))).toBe("/mesa?client=c1&aba=estudio&task=t1");
    expect(linkDoCartao(peca({ post: null, tarefa }))).toBe("/calendario?client=c1");
  });
});

describe("juntar as linhas em peças", () => {
  const linhas = (extra: Partial<LinhasDaEsteiraLinha> = {}): LinhasDaEsteiraLinha => ({ posts: [], publicacoes: [], tarefas: [], vinculos: [], trabalhos: [], arquivos: [], ...extra });
  const tarefa = (id: string, extra: Record<string, unknown> = {}) => ({ id, client_id: "c1", title: `Tarefa ${id}`, status: "todo", due_date: "2026-11-17", delivery_type: "reel", source: null, ...extra });
  const post = (id: string, extra: Record<string, unknown> = {}) => ({ id, client_id: "c1", title: `Post ${id}.png`, content_type: "static", production_status: "ready", primary_file_id: null, archived_at: null, ...extra });

  it("tarefa que já virou post ativo não aparece duas vezes e empresta prazo e trabalho ao post", () => {
    const pecas = juntarPecas(linhas({
      posts: [post("p1", { primary_file_id: "f1" })],
      tarefas: [tarefa("t1")],
      vinculos: [{ post_id: "p1", task_id: "t1" }],
      trabalhos: [{ task_id: "t1", post_id: null, client_id: "c1", status: "entregue", entrega_status: "aguardando_cliente", file_ids: ["f2"] }],
      arquivos: [{ id: "f1", approval_status: "none", agency_approval_status: "approved" }, { id: "f2", approval_status: "pending", agency_approval_status: "approved" }],
    }));
    expect(pecas.map((p) => p.chave)).toEqual(["post:p1"]);
    expect(pecas[0].titulo).toBe("Post p1");
    expect(pecas[0].tarefa?.due_date).toBe("2026-11-17");
    expect(pecas[0].arquivos).toHaveLength(2);
    expect(decidirEtapa(pecas[0])?.rotulo).toBe("Aguardando o cliente");
    expect(dataDaPeca(pecas[0])).toBe("2026-11-17");
  });

  it("tarefa de conteúdo sem post vira peça; tarefa que não é conteúdo e pedido de cliente ficam de fora", () => {
    const pecas = juntarPecas(linhas({
      tarefas: [tarefa("t1"), tarefa("t2", { delivery_type: "traffic" }), tarefa("t3", { source: "client_request" }), tarefa("t4", { delivery_type: "carousel" })],
      trabalhos: [{ task_id: "t4", post_id: null, client_id: "c1", status: "pronto", entrega_status: null, file_ids: [] }],
    }));
    expect(pecas.map((p) => p.chave)).toEqual(["task:t1", "task:t4"]);
    expect(pecas[0].contentType).toBe("reel");
    expect(decidirEtapa(pecas[0])?.etapa).toBe("pauta");
    expect(decidirEtapa(pecas[1])?.etapa).toBe("arte");
    expect(linkDoCartao(pecas[1])).toBe("/mesa?client=c1&aba=estudio&task=t4");
  });

  it("post arquivado some e devolve a tarefa; publicação cancelada não conta", () => {
    const pecas = juntarPecas(linhas({
      posts: [post("p1", { archived_at: "2026-11-01T00:00:00Z" }), post("p2")],
      tarefas: [tarefa("t1")],
      vinculos: [{ post_id: "p1", task_id: "t1" }],
      publicacoes: [
        { id: "u1", post_id: "p2", client_id: "c1", file_id: null, status: "cancelled", scheduled_at: "2026-11-17T15:00:00Z", published_at: null, permalink: null },
        { id: "u2", post_id: "p2", client_id: "c1", file_id: null, status: "scheduled", scheduled_at: "2026-11-19T15:00:00Z", published_at: null, permalink: null },
      ],
    }));
    const visiveis = pecas.filter((p) => decidirEtapa(p));
    expect(visiveis.map((p) => p.chave).sort()).toEqual(["post:p2", "task:t1"]);
    const p2 = pecas.find((p) => p.chave === "post:p2")!;
    expect(p2.publicacoes).toHaveLength(1);
    expect(dataDaPeca(p2)).toBe("2026-11-19");
  });
});

// ------------------------------------------------------------------ fase 2

const tarefaT1 = { id: "t1", status: "todo", due_date: "2026-11-17" };
const revisao = (decisao: RevisaoInterna["decisao"], extra: Partial<RevisaoInterna> = {}): RevisaoInterna => ({ decisao, em: "2026-11-15T00:04:00Z", por: "u9", porNome: null, ...extra });

describe("Double-Gate: a agência vem antes do cliente (P2 da fase 1)", () => {
  it("entrega aguardando o cliente com o portão da agência pendente no arquivo fica em Revisão", () => {
    const p = peca({ trabalho: { status: "entregue", entrega_status: "aguardando_cliente", temArquivo: true }, arquivos: [{ approval_status: "pending", agency_approval_status: "pending" }] });
    expect(decidirEtapa(p)).toEqual({ etapa: "revisao", rotulo: "Revisão da agência" });
  });

  it("um arquivo com o cliente e outro ainda com a agência: a peça fica em Revisão", () => {
    const p = peca({ post: comArquivo, arquivos: [{ approval_status: "pending", agency_approval_status: "approved" }, { approval_status: "none", agency_approval_status: "pending" }] });
    expect(decidirEtapa(p)).toEqual({ etapa: "revisao", rotulo: "Revisão da agência" });
    // A ordem dos arquivos não muda a resposta.
    expect(decidirEtapa({ ...p, arquivos: [...p.arquivos].reverse() })?.etapa).toBe("revisao");
  });

  it("com a agência resolvida, o pedido ao cliente volta a aparecer; estágios seguintes continuam ganhando", () => {
    expect(decidirEtapa(peca({ trabalho: { status: "entregue", entrega_status: "aguardando_cliente", temArquivo: true }, arquivos: [{ approval_status: "pending", agency_approval_status: "approved" }] }))?.rotulo).toBe("Aguardando o cliente");
    expect(decidirEtapa(peca({ publicacoes: [pub("scheduled", "2026-11-17T12:00:00Z")], arquivos: [{ approval_status: "none", agency_approval_status: "pending" }] }))?.etapa).toBe("agendado");
  });
});

describe("tarefa concluída ligada a post em rascunho (P2 da fase 1)", () => {
  it("post em rascunho sem arte, com tarefa concluída, continua Pauta; tarefa concluída sem post continua Concluída", () => {
    for (const status of ["done", "completed"]) {
      expect(decidirEtapa(peca({ tarefa: { id: "t1", status, due_date: "2026-11-17" } }))).toEqual({ etapa: "pauta", rotulo: "Pauta" });
      expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: { id: "t1", status, due_date: "2026-11-17" } }))).toEqual({ etapa: "arte", rotulo: "Concluída" });
    }
  });
});

describe("carimbo da revisão interna", () => {
  const trabalho = (entrega_status: string | null, r: RevisaoInterna | null) => ({ status: "entregue", entrega_status, temArquivo: true, revisao: r });

  it("aprovada pela equipe: Revisado pela agência, ainda na etapa de revisão", () => {
    expect(decidirEtapa(peca({ trabalho: trabalho("aguardando_agencia", revisao("aprovado")), arquivos: [{ approval_status: "none", agency_approval_status: "approved" }] }))).toEqual({ etapa: "revisao", rotulo: "Revisado pela agência" });
    // Sem pedido de envio registrado no trabalho, o carimbo sozinho sustenta a etapa.
    expect(decidirEtapa(peca({ post: null, chave: "task:t1", tarefa: tarefaT1, trabalho: { status: "pronto", entrega_status: null, temArquivo: false, revisao: revisao("aprovado") } }))).toEqual({ etapa: "revisao", rotulo: "Revisado pela agência" });
  });

  it("o portão da agência no arquivo manda: pendente continua Revisão da agência, mesmo com carimbo de aprovado", () => {
    expect(decidirEtapa(peca({ trabalho: trabalho("aguardando_agencia", revisao("aprovado")), arquivos: [{ approval_status: "none", agency_approval_status: "pending" }] }))).toEqual({ etapa: "revisao", rotulo: "Revisão da agência" });
  });

  it("ajuste pedido volta para a arte com o rótulo da agência, com ou sem rejeição no arquivo", () => {
    const ajuste = { etapa: "arte", rotulo: "Ajuste pedido pela agência" };
    expect(decidirEtapa(peca({ trabalho: trabalho("reprovado", revisao("ajuste")), arquivos: [{ approval_status: "none", agency_approval_status: "rejected" }] }))).toEqual(ajuste);
    expect(decidirEtapa(peca({ trabalho: trabalho("aguardando_agencia", revisao("ajuste")), arquivos: [{ approval_status: "none", agency_approval_status: "pending" }] }))).toEqual(ajuste);
    expect(decidirEtapa(peca({ trabalho: trabalho(null, revisao("ajuste")) }))).toEqual(ajuste);
    // Sem carimbo, a rejeição continua com o texto da fase 1.
    expect(decidirEtapa(peca({ trabalho: trabalho("reprovado", null) }))).toEqual({ etapa: "arte", rotulo: "Ajustes na arte" });
  });

  it("nunca vira aprovação do cliente: Aguardando o cliente e Aprovado só vêm do pedido e da resposta dele", () => {
    const revisada = peca({ trabalho: trabalho("aguardando_agencia", revisao("aprovado")), arquivos: [{ approval_status: "none", agency_approval_status: "approved" }] });
    expect(decidirEtapa(revisada)?.etapa).not.toBe("aprovacao");
    expect(decidirEtapa(peca({ trabalho: trabalho("aguardando_cliente", revisao("aprovado")), arquivos: [{ approval_status: "pending", agency_approval_status: "approved" }] }))).toEqual({ etapa: "aprovacao", rotulo: "Aguardando o cliente" });
    expect(decidirEtapa(peca({ trabalho: trabalho("aprovado", revisao("aprovado")), arquivos: [{ approval_status: "approved", agency_approval_status: "approved" }] }))).toEqual({ etapa: "aprovacao", rotulo: "Aprovado" });
    // O carimbo também não segura o que já andou.
    expect(decidirEtapa(peca({ trabalho: trabalho("agendado", revisao("ajuste")), publicacoes: [pub("scheduled", "2026-11-17T12:00:00Z")] }))?.etapa).toBe("agendado");
  });

  it("o texto do carimbo traz quem e quando, no horário de São Paulo", () => {
    expect(textoDaRevisaoInterna(null)).toBeNull();
    expect(textoDaRevisaoInterna(revisao("aprovado", { porNome: "Ana" }))).toBe("Revisão interna: aprovada por Ana em 14/11, 21:04");
    expect(textoDaRevisaoInterna(revisao("ajuste", { em: null }))).toBe("Revisão interna: ajuste pedido");
    const [faixa] = montarGrade({
      clientes: [{ id: "c1", nome: "Alfa" }], diasPrioritarios: [], segunda: SEGUNDA,
      pecas: [peca({ post: null, chave: "task:t1", tarefa: tarefaT1, trabalho: { status: "entregue", entrega_status: "aguardando_agencia", temArquivo: true, revisao: revisao("aprovado", { porNome: "Ana" }) } })],
    });
    const cartao = faixa.celulas[1].cartoes[0];
    expect(cartao.rotuloDaEtapa).toBe("Revisado pela agência");
    expect(cartao.revisao).toContain("por Ana");
  });

  it("carimbo de arte antiga não vale; a leitura leva o carimbo e o portão do arquivo para a peça", () => {
    const base = { task_id: "t1", post_id: null, client_id: "c1", status: "entregue", entrega_status: "aguardando_agencia", file_ids: ["f2"], revisado_por: "u9", revisado_em: "2026-11-15T00:04:00Z", revisao_decisao: "aprovado" };
    expect(revisaoDoTrabalho({ ...base, revisao_arquivo_id: "f2" })?.decisao).toBe("aprovado");
    expect(revisaoDoTrabalho({ ...base, revisao_arquivo_id: "f1" })).toBeNull();
    expect(revisaoDoTrabalho({ ...base, revisao_arquivo_id: null })).toBeNull();
    expect(revisaoDoTrabalho({ ...base, file_ids: [], revisao_arquivo_id: null })?.decisao).toBe("aprovado");
    expect(revisaoDoTrabalho({ ...base, revisao_decisao: "qualquer", revisao_arquivo_id: "f2" })).toBeNull();

    const [p] = juntarPecas({
      posts: [], publicacoes: [], vinculos: [],
      tarefas: [{ id: "t1", client_id: "c1", title: "Reel", status: "todo", due_date: "2026-11-17", delivery_type: "reel", source: null }],
      trabalhos: [{ ...base, revisao_arquivo_id: "f2" }],
      arquivos: [{ id: "f2", approval_status: "none", agency_approval_status: "approved", agency_reviewed_by: "u9", agency_reviewed_at: "2026-11-15T00:04:00Z" }],
      revisores: [{ id: "u9", full_name: "Ana" }],
    });
    expect(p.trabalho?.revisao).toEqual({ decisao: "aprovado", em: "2026-11-15T00:04:00Z", por: "u9", porNome: "Ana" });
    expect(p.arquivos[0].agency_reviewed_by).toBe("u9");
    expect(decidirEtapa(p)?.rotulo).toBe("Revisado pela agência");
  });
});

describe("link do cartão para quem não abre o Estúdio (P2 da fase 1)", () => {
  const trabalho = { status: "pronto", entrega_status: null, temArquivo: true };
  it("tráfego não é mandado para /mesa: vai para a Agenda do cliente", () => {
    expect(podeAbrirEstudio("admin") && podeAbrirEstudio("manager") && podeAbrirEstudio("design")).toBe(true);
    expect(podeAbrirEstudio("traffic") || podeAbrirEstudio(null) || podeAbrirEstudio("client")).toBe(false);
    const p = peca({ post: null, chave: "task:t1", tarefa: tarefaT1, trabalho });
    expect(linkDoCartao(p, { podeAbrirEstudio: false })).toBe("/calendario?client=c1");
    expect(linkDoCartao(p, { podeAbrirEstudio: true })).toBe("/mesa?client=c1&aba=estudio&task=t1");
    // Com post o destino já era a Agenda e não muda.
    expect(linkDoCartao(peca({ tarefa: tarefaT1, trabalho }), { podeAbrirEstudio: false })).toBe("/calendario?client=c1&content=p1");
    const grade = (pode: boolean) => montarGrade({ clientes: [{ id: "c1", nome: "Alfa" }], diasPrioritarios: [], segunda: SEGUNDA, pecas: [p], podeAbrirEstudio: pode })[0].celulas[1].cartoes[0];
    expect(grade(false)).toMatchObject({ link: "/calendario?client=c1", destino: "agenda" });
    expect(grade(true)).toMatchObject({ link: "/mesa?client=c1&aba=estudio&task=t1", destino: "estudio" });
  });
});

describe("regra de aprovação do cliente no cadastro (Softy)", () => {
  const SOFTY = "3d08338c-0c3b-453f-a64f-79a55c5711e8";
  it("só o valor exato dispensada conta", () => {
    expect(aprovacaoDoClienteDispensada({ modoAprovacao: "dispensada" })).toBe(true);
    for (const modo of ["portal", "", null, undefined, "Dispensada", "qualquer"]) expect(aprovacaoDoClienteDispensada({ modoAprovacao: modo })).toBe(false);
  });

  it("o modo vira aviso na faixa e não pula etapa: as etapas são as mesmas de qualquer cliente", () => {
    const pecasDe = (clientId: string): PecaFato[] => [
      peca({ clientId, chave: `${clientId}:a`, titulo: "A", post: null, tarefa: tarefaT1, trabalho: { status: "entregue", entrega_status: "aguardando_agencia", temArquivo: true, revisao: revisao("aprovado") }, arquivos: [{ approval_status: "none", agency_approval_status: "approved" }] }),
      peca({ clientId, chave: `${clientId}:b`, titulo: "B", post: null, tarefa: tarefaT1, trabalho: { status: "entregue", entrega_status: "aguardando_cliente", temArquivo: true }, arquivos: [{ approval_status: "pending", agency_approval_status: "approved" }] }),
    ];
    const faixas = montarGrade({
      clientes: [{ id: SOFTY, nome: "Softy Móveis", modoAprovacao: "dispensada" }, { id: "c1", nome: "Alfa", modoAprovacao: "portal" }, { id: "c2", nome: "Beta" }],
      pecas: [...pecasDe(SOFTY), ...pecasDe("c1")], diasPrioritarios: [], segunda: SEGUNDA,
    });
    const softy = faixas.find((f) => f.clientId === SOFTY)!;
    const alfa = faixas.find((f) => f.clientId === "c1")!;
    expect(softy.aprovacaoDoClienteDispensada).toBe(true);
    expect(alfa.aprovacaoDoClienteDispensada).toBe(false);
    expect(faixas.find((f) => f.clientId === "c2")!.aprovacaoDoClienteDispensada).toBe(false);
    const etapas = (f: typeof softy) => f.celulas[1].cartoes.map((c) => `${c.etapa}:${c.rotuloDaEtapa}`);
    expect(etapas(softy)).toEqual(["revisao:Revisado pela agência", "aprovacao:Aguardando o cliente"]);
    expect(etapas(softy)).toEqual(etapas(alfa));
  });
});

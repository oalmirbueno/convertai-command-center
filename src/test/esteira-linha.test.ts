import { describe, expect, it } from "vitest";
import {
  dataDaPeca, decidirEtapa, diaCivilEmSP, diaPrioritarioDefinido, diasDaSemana, linkDoCartao, montarGrade, rotuloDaSemana,
  rotuloDoFormato, segundaDaSemana, somarDias, type PecaFato,
} from "@/lib/esteiraLinha/esteiraLinha";
import { juntarPecas, type LinhasDaEsteiraLinha } from "@/lib/esteiraLinha/esteiraLinhaFatos";

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

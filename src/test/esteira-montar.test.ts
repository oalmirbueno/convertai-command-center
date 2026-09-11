import { describe, expect, it } from "vitest";
import { itensDaFrente, montarEsteira } from "@/lib/esteira/esteiraMontar";
import type { FatosDoCliente, PostFato } from "@/lib/esteira/esteiraTipos";

const HOJE = new Date("2026-09-11T12:00:00Z");

function fatos(over: Partial<FatosDoCliente>): FatosDoCliente {
  return {
    clientId: "c1",
    criadoEm: "2026-01-01T00:00:00Z",
    servicos: { social: true, trafego: false },
    posts: [],
    tarefas: [],
    campanhas: [],
    saldoVerba: null,
    checklists: [],
    marcos: [],
    conexoes: [{ provider: "instagram", status: "connected" }],
    metricas: [],
    briefingRespondido: true,
    dossieResumo: null,
    onboardingHas: {},
    estados: {},
    rituais: [],
    oculto: { areas: [], ate: null },
    ...over,
  };
}

function post(over: Partial<PostFato>): PostFato {
  return {
    id: "p1",
    titulo: "Post",
    productionStatus: "ready",
    criadoEm: "2026-09-01T00:00:00Z",
    temArte: true,
    aprovCliente: "approved",
    aprovAgencia: "approved",
    aprovPedidaEm: null,
    temLegenda: true,
    publicacoes: [],
    ...over,
  };
}

describe("esteira: cliente em operacao (cenario Acerbi)", () => {
  const f = fatos({
    posts: [
      post({ id: "a", titulo: "Decisão", publicacoes: [{ status: "published", scheduledAt: null, publishedAt: "2026-09-09" }] }),
      post({ id: "b", titulo: "Antes de investir", publicacoes: [{ status: "scheduled", scheduledAt: "2026-09-16T12:00:00Z", publishedAt: null }] }),
      post({ id: "c", titulo: "Preço não é chute", publicacoes: [{ status: "scheduled", scheduledAt: "2026-09-23T12:00:00Z", publishedAt: null }] }),
      post({ id: "d", titulo: "Oficina Gestão do tempo", productionStatus: "production", aprovCliente: "rejected" }),
    ],
    metricas: [
      { accountId: "acc", weekStart: "2026-09-07", reach: 174, followers: 500, interactions: 6 },
      { accountId: "acc", weekStart: "2026-08-31", reach: 247, followers: 500, interactions: 27 },
      { accountId: "acc", weekStart: "2026-08-24", reach: 164, followers: 500, interactions: 9 },
    ],
  });
  const e = montarEsteira(f, HOJE);

  it("nao mostra onboarding para quem ja publica", () => {
    expect(e.onboardingCompleto).toBe(true);
    expect(e.itens.some((i) => i.fonte === "onboarding")).toBe(false);
  });

  it("aponta a arte recusada pelo nome, como urgente", () => {
    const it = e.itens.find((i) => i.key === "post:d:refazer");
    expect(it?.titulo).toBe("Oficina Gestão do tempo");
    expect(it?.passo).toBe("Cliente recusou, refazer e reenviar");
    expect(it?.gravidade).toBe("urgente");
  });

  it("post publicado e post agendado nao geram item", () => {
    expect(e.itens.some((i) => i.key.startsWith("post:a"))).toBe(false);
    expect(e.itens.some((i) => i.key.startsWith("post:b"))).toBe(false);
  });

  it("agenda com 2 posts em 14 dias esta em dia", () => {
    expect(e.itens.some((i) => i.fonte === "agenda")).toBe(false);
  });

  it("entrega a comparacao de alcance pronta, sem virar tarefa", () => {
    const reach = e.insights.find((i) => i.key.startsWith("reach:"));
    expect(reach?.atual).toBe(174);
    expect(reach?.anteriores).toEqual([247, 164]);
    expect(reach?.variacao).toBe(-30);
    expect(reach?.tendencia).toBe("cai");
    expect(e.itens.some((i) => /alcance/i.test(i.passo))).toBe(false);
  });
});

describe("esteira: cliente recem-entrado (cenario Rds Clima)", () => {
  const f = fatos({
    criadoEm: "2026-09-09T00:00:00Z",
    servicos: { social: true, trafego: true },
    conexoes: [],
    briefingRespondido: true,
  });
  const e = montarEsteira(f, HOJE);

  it("monta o onboarding pelo que falta, na ordem", () => {
    const chaves = e.itens.filter((i) => i.fonte === "onboarding").map((i) => i.key);
    expect(chaves).toEqual(["onb:nome", "onb:logo", "onb:identidade", "onb:instagram", "onb:portfolio", "onb:grupo", "onb:anuncios"]);
    expect(e.onboardingCompleto).toBe(false);
  });

  it("logo fica travado atras do nome, instagram atras da identidade", () => {
    expect(e.itens.find((i) => i.key === "onb:logo")?.bloqueadoPor).toBe("Nome");
    expect(e.itens.find((i) => i.key === "onb:instagram")?.bloqueadoPor).toBe("Identidade visual");
    expect(e.itens.find((i) => i.key === "onb:nome")?.bloqueadoPor).toBeUndefined();
  });

  it("nao fala de agenda vazia nem de anuncios enquanto o onboarding esta aberto", () => {
    expect(e.itens.some((i) => i.fonte === "agenda")).toBe(false);
    expect(e.itens.some((i) => i.fonte === "anuncio")).toBe(false);
  });

  it("'ja tem' marcado a mao fecha o passo e destrava o seguinte", () => {
    const e2 = montarEsteira({ ...f, onboardingHas: { nome: true } }, HOJE);
    expect(e2.itens.some((i) => i.key === "onb:nome")).toBe(false);
    expect(e2.itens.find((i) => i.key === "onb:logo")?.bloqueadoPor).toBeUndefined();
  });
});

describe("esteira: elos do post", () => {
  it("segue a esteira arte -> agencia -> cliente -> legenda -> agenda", () => {
    const casos: Array<[Partial<PostFato>, string]> = [
      [{ temArte: false }, "post:p1:arte"],
      [{ aprovAgencia: "pending" }, "post:p1:revisar"],
      [{ aprovCliente: "pending", aprovPedidaEm: "2026-09-10T00:00:00Z" }, "post:p1:aprovacao"],
      [{ aprovCliente: null }, "post:p1:enviar"],
      [{ temLegenda: false }, "post:p1:legenda"],
      [{}, "post:p1:agenda"],
      [{ publicacoes: [{ status: "failed", scheduledAt: "2026-09-10T00:00:00Z", publishedAt: null }] }, "post:p1:repostar"],
      [{ publicacoes: [{ status: "scheduled", scheduledAt: "2026-09-05T00:00:00Z", publishedAt: null }] }, "post:p1:nao-publicou"],
    ];
    for (const [over, esperado] of casos) {
      const e = montarEsteira(fatos({ posts: [post(over)] }), HOJE);
      expect(e.itens.map((i) => i.key)).toContain(esperado);
    }
  });

  it("aprovacao parada ha 3+ dias vira urgente", () => {
    const e = montarEsteira(fatos({ posts: [post({ aprovCliente: "pending", aprovPedidaEm: "2026-09-07T00:00:00Z" })] }), HOJE);
    expect(e.itens.find((i) => i.key === "post:p1:aprovacao")?.gravidade).toBe("urgente");
  });

  it("agenda vazia so aparece para quem tem social e onboarding fechado", () => {
    const e = montarEsteira(fatos({ posts: [post({ publicacoes: [{ status: "published", scheduledAt: null, publishedAt: "2026-09-01" }] })] }), HOJE);
    expect(e.itens.find((i) => i.key === "agenda:vazia")?.gravidade).toBe("urgente");
  });
});

describe("esteira: marcacao humana e frentes", () => {
  it("feito sai da lista e vai para feitos; adiado e ignorado somem", () => {
    const f = fatos({
      posts: [post({ id: "x", temArte: false }), post({ id: "y", temArte: false }), post({ id: "z", temArte: false })],
      estados: { "post:x:arte": { status: "done", note: null, doneAt: null }, "post:y:arte": { status: "snoozed", note: null, doneAt: null }, "post:z:arte": { status: "ignored", note: "fora do escopo", doneAt: null } },
    });
    const e = montarEsteira(f, HOJE);
    expect(e.itens.some((i) => i.key.startsWith("post:"))).toBe(false);
    expect(e.feitos.map((i) => i.key)).toEqual(["post:x:arte"]);
  });

  it("trafego nao herda item de social, mas ve o geral", () => {
    const f = fatos({
      servicos: { social: true, trafego: true },
      conexoes: [{ provider: "instagram", status: "connected" }, { provider: "meta_ads", status: "connected" }],
      posts: [post({ id: "s", temArte: false })],
      tarefas: [{ id: "t", titulo: "Ligar para o cliente", status: "todo", dueDate: "2026-09-01", assignedTo: null, source: null, updatedAt: null }],
      campanhas: [{ id: "c", nome: "Campanha X", ativa: true, diario: [] }],
    });
    const e = montarEsteira(f, HOJE);
    const trafego = itensDaFrente(e, "trafego").map((i) => i.key);
    expect(trafego).toContain("task:t");
    expect(trafego).toContain("camp:c:parado");
    expect(trafego.some((k) => k.startsWith("post:"))).toBe(false);
    const social = itensDaFrente(e, "social").map((i) => i.key);
    expect(social).toContain("post:s:arte");
    expect(social.some((k) => k.startsWith("camp:"))).toBe(false);
  });

  it("tarefas: atrasada, desta semana, proxima semana; concluida na semana vira feito automatico", () => {
    const f = fatos({
      tarefas: [
        { id: "a", titulo: "Atrasada", status: "todo", dueDate: "2026-09-01", assignedTo: "u", source: null, updatedAt: null },
        { id: "b", titulo: "Desta semana", status: "todo", dueDate: "2026-09-12", assignedTo: "u", source: null, updatedAt: null },
        { id: "c", titulo: "Proxima semana", status: "todo", dueDate: "2026-09-16", assignedTo: "u", source: null, updatedAt: null },
        { id: "d", titulo: "Longe e com dono", status: "todo", dueDate: "2026-10-30", assignedTo: "u", source: null, updatedAt: null },
        { id: "e", titulo: "Feita agora", status: "done", dueDate: null, assignedTo: "u", source: null, updatedAt: "2026-09-10T12:00:00Z" },
        { id: "f", titulo: "Feita mes passado", status: "done", dueDate: null, assignedTo: "u", source: null, updatedAt: "2026-08-01T12:00:00Z" },
      ],
    });
    const e = montarEsteira(f, HOJE, "2026-09-07");
    const porKey = Object.fromEntries(e.itens.map((i) => [i.key, i]));
    expect(porKey["task:a"]?.gravidade).toBe("urgente");
    expect(porKey["task:b"]?.passo).toBe("Entregar até 12/09");
    expect(porKey["task:c"]?.passo).toBe("Próxima semana, 16/09");
    expect(porKey["task:d"]).toBeUndefined();
    expect(e.feitos.map((i) => i.key)).toEqual(["task:e"]);
    expect(e.feitos[0].estado?.auto).toBe(true);
  });

  it("post publicado nesta semana entra em feitos pelo painel", () => {
    const f = fatos({ posts: [post({ id: "p", titulo: "Decisão", publicacoes: [{ status: "published", scheduledAt: null, publishedAt: "2026-09-09T15:00:00Z" }] })] });
    const e = montarEsteira(f, HOJE, "2026-09-07");
    expect(e.feitos.find((i) => i.key === "post:p:publicado")?.passo).toBe("Publicado");
    expect(e.feitos[0].estado?.auto).toBe(true);
    expect(e.itens.some((i) => i.key.startsWith("post:p"))).toBe(false);
  });

  it("rituais comecam em branco e refletem o que foi marcado", () => {
    const e = montarEsteira(fatos({ rituais: [{ key: "segunda", source: "central", doneAt: "2026-09-07T10:00:00Z" }] }), HOJE);
    expect(e.rituais.map((r) => [r.key, r.feito])).toEqual([["segunda", true], ["quarta", false], ["sexta", false]]);
    expect(e.rituais[0].fonte).toBe("central");
  });
});

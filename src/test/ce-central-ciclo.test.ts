import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { metasComoTexto, ritmoSemanal, situacaoDasMetas } from "../../supabase/functions/_shared/metas-de-seguidores";
import {
  BRIEF_POR_RITUAL,
  blocoDeComunicacao,
  expressoesDeRobo,
  REGRAS_DE_COMUNICACAO,
  regrasDoRitual,
  semTravessao,
} from "../../supabase/functions/_shared/comunicacao-com-cliente";
import { canalPelaRegra, julgarDaCentral, promessasComoTexto, provaPelaRegra } from "../../supabase/functions/_shared/julgamentos-da-central";
import { estadoRealComoTexto, lerEstadoReal, periodosDe, tendenciaDosAnuncios } from "../../supabase/functions/_shared/estado-real-do-cliente";
import { chaveDaPromessa, dependeDoCliente, reforcarPromessas, segundaDaSemana } from "../../supabase/functions/ritual-writer/reforco";
import { escolhaDoModelo, escreverComModeloDaCentral, MODELOS_DA_CENTRAL as MODELOS_DO_SERVIDOR } from "../../supabase/functions/_shared/modelo-da-central";
import { escreverRitual, lerRespostaDoEscritor, montarPedidoAoEscritor } from "../../supabase/functions/ritual-writer/escritor";
import { filtrarJaFeitos, jaFeito, lerFeitosAntes } from "../../supabase/functions/esteira-semana/feitos";
import { MODELOS_DA_CENTRAL as MODELOS_DA_TELA, corpoDoModelo, rotuloDoModelo } from "@/components/central/modeloDaCentral";
import { montarEsteira } from "@/lib/esteira/esteiraMontar";
import { origemDoItem } from "@/lib/esteira/esteiraAcoes";
import type { FatosDoCliente } from "@/lib/esteira/esteiraTipos";
import { extrasDoRitual, promessasDoRitual } from "@/components/central/ritualAvisos";

const ler = (arq: string) => readFileSync(resolve(process.cwd(), arq), "utf8");
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

/** Banco de mentira com as cadeias do supabase-js que os leitores usam. */
function bancoFalso(tabelas: Record<string, unknown[] | Error>, registro: Array<{ tabela: string; op: string; dados?: unknown }> = []) {
  const construtor = (tabela: string) => {
    const resposta = () => {
      const v = tabelas[tabela];
      return v instanceof Error ? { data: null, error: { message: v.message, code: "XX000" } } : { data: v ?? [], error: null };
    };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "lt", "neq", "in", "is", "order", "limit", "or", "contains"]) q[m] = () => q;
    q.range = () => Promise.resolve(resposta());
    q.maybeSingle = () => Promise.resolve({ data: (resposta().data as unknown[] | null)?.[0] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, erro);
    q.insert = (dados: unknown) => { registro.push({ tabela, op: "insert", dados }); return Promise.resolve({ error: null }); };
    q.update = (dados: unknown) => {
      registro.push({ tabela, op: "update", dados });
      const u: Record<string, unknown> = {};
      u.eq = () => Promise.resolve({ error: null });
      return u;
    };
    return q;
  };
  return { from: construtor, rpc: vi.fn(async () => ({ data: 2, error: null })) };
}

describe("metas de seguidores", () => {
  const serie = [
    { quando: "2026-09-06", seguidores: 940 },
    { quando: "2026-09-13", seguidores: 980 },
    { quando: "2026-09-20", seguidores: 1010 },
    { quando: "2026-09-27", seguidores: 1050 },
  ];
  const metas = [
    { id: "m1", meta: 1000, prazo: null, criado_em: "2026-08-01T00:00:00Z" },
    { id: "m2", meta: 1500, prazo: "2026-11-30", criado_em: "2026-08-01T00:00:00Z" },
  ];

  it("reconhece a meta batida uma vez e aponta a próxima cadastrada com previsão", () => {
    const s = situacaoDasMetas(metas, serie, { agora: new Date("2026-09-28T12:00:00Z") });
    expect(s.batidas.map((b) => b.meta)).toEqual([1000]);
    expect(s.paraComemorar.map((b) => b.id)).toEqual(["m1"]);
    expect(s.proxima).toMatchObject({ id: "m2", meta: 1500, faltam: 450 });
    expect(ritmoSemanal(serie)).toBeCloseTo(36.7, 1);
    expect(s.proxima?.previsao).toBeTruthy();
    const txt = metasComoTexto(s);
    expect(txt).toContain("META BATIDA E AINDA NÃO COMEMORADA: 1.000 seguidores");
    expect(txt).toContain("PRÓXIMA META (a cadastrada): 1.500 seguidores; faltam 450");
  });

  it("meta já comemorada numa mensagem enviada não se comemora de novo", () => {
    const s = situacaoDasMetas(metas, serie, { agora: new Date("2026-09-28T12:00:00Z"), reconhecidas: ["m1"] });
    expect(s.paraComemorar).toEqual([]);
    expect(metasComoTexto(s)).toContain("já comemorada em mensagem anterior");
  });

  it("meta cadastrada abaixo do número atual não vira comemoração", () => {
    const s = situacaoDasMetas([{ id: "m0", meta: 500, prazo: null, criado_em: "2026-09-01T00:00:00Z" }], serie, { agora: new Date("2026-09-28T12:00:00Z") });
    expect(s.batidas).toHaveLength(1);
    expect(s.paraComemorar).toEqual([]);
    expect(metasComoTexto(s)).toContain("NÃO invente um número");
  });

  it("sem meta cadastrada, nada de meta na mensagem; arquivada não conta", () => {
    expect(metasComoTexto(situacaoDasMetas([], serie))).toBe("");
    expect(situacaoDasMetas([{ ...metas[0], arquivada_em: "2026-09-02T00:00:00Z" }], serie).temMeta).toBe(false);
  });
});

describe("ofício de agência (conhecimento com fonte)", () => {
  it("toda regra tem fonte pública e cada ritual tem o seu recorte", () => {
    expect(REGRAS_DE_COMUNICACAO.length).toBeGreaterThanOrEqual(15);
    for (const r of REGRAS_DE_COMUNICACAO) expect(r.fonte).toMatch(/^https:\/\//);
    expect(regrasDoRitual("marco_90").some((r) => r.id === "marco-de-90-dias")).toBe(true);
    expect(regrasDoRitual("meio_semana").some((r) => r.id === "marco-de-90-dias")).toBe(false);
    expect(blocoDeComunicacao("radar_aceleriq")).toContain("previsão simples do próximo período");
    expect(BRIEF_POR_RITUAL.radar_aceleriq).toContain("BALANÇO DO MÊS");
  });

  it("tira travessão e acusa expressão de robô", () => {
    expect(semTravessao(`Campanha no ar ${EM} e rodando`)).toBe("Campanha no ar, e rodando");
    expect(semTravessao(`semana 14${EN}18/09`)).toBe("semana 14 a 18/09");
    expect(expressoesDeRobo("Espero que esteja bem! Seguimos firmes na otimização.")).toEqual(["espero que esteja bem", "seguimos firmes", "otimização"]);
  });
});

describe("julgamentos: campanha da Mesa e promessas", () => {
  it("campanha da Mesa só é paga quando o texto ou um anúncio no ar dizem", () => {
    expect(canalPelaRegra({ id: "1", nome: "Mouse em Giro", objetivo: "Gerar consultas pelo WhatsApp", pedido: "queima de estoque" }, [])).toBeNull();
    expect(canalPelaRegra({ id: "2", nome: "Primavera", objetivo: "Impulsionar com verba de R$ 30 por dia" }, [])?.canal).toBe("paga");
    expect(canalPelaRegra({ id: "3", nome: "Semana do Hóspede", objetivo: "x" }, ["Semana do Hóspede | Conversas"])?.canal).toBe("paga");
    expect(canalPelaRegra({ id: "4", nome: "Posts do perfil", objetivo: "Conteúdo orgânico, sem verba" }, [])?.canal).toBe("organica");
  });

  it("sem Jev: campanha indefinida e promessa sem prova fica em andamento; com prova óbvia, cumprida", async () => {
    const r = await julgarDaCentral({
      cliente: "Stop",
      campanhas: [{ id: "c1", nome: "Mouse em Giro", objetivo: "consultas" }],
      anunciosNoAr: [],
      promessas: [
        { id: "p1", texto: "Publicar o carrossel do mouse em giro na quarta", feitaEm: "2026-09-19T12:00:00.000Z" },
        { id: "p2", texto: "Montar o calendário de outubro", feitaEm: "2026-09-19T12:00:00.000Z" },
      ],
      evidencias: [{ quando: "2026-09-24T12:00:00.000Z", texto: "Publicado: carrossel do mouse em giro" }],
    }, null);
    expect(r.campanhas[0]).toMatchObject({ canal: "indefinida", fonte: "sem_jev" });
    expect(r.promessas.map((p) => p.situacao)).toEqual(["cumprida", "em_andamento"]);
    expect(promessasComoTexto(r.promessas)).toContain("EM ANDAMENTO");
  });

  it("com Jev: uma chamada só, Choice aponta a evidência que prova; confirmada pelo dono vale como cumprida", async () => {
    const perguntar = vi.fn(async (pedido: { questions: Record<string, unknown> }) => {
      expect(Object.keys(pedido.questions).sort()).toEqual(["canal_0", "prova_0"]);
      return { answers: { canal_0: { choice: "organica", probabilities: { organica: 0.82 } }, prova_0: { choice: "e1", probabilities: { e1: 0.9 } } }, usage: null, modelo: "jev" };
    });
    const r = await julgarDaCentral({
      cliente: "Stop",
      campanhas: [{ id: "c1", nome: "Mouse em Giro", objetivo: "consultas" }],
      anunciosNoAr: [],
      promessas: [
        { id: "p1", texto: "Deixar pronta a peça da oferta de outubro", feitaEm: "2026-09-19T12:00:00.000Z" },
        { id: "p2", texto: "Revisar as legendas", feitaEm: "2026-09-19T12:00:00.000Z" },
      ],
      evidencias: [{ quando: "2026-09-22T12:00:00.000Z", texto: "Cliente aprovou: Carrossel outubro" }],
      confirmadasPeloDono: new Set(["p2"]),
    }, perguntar as never);
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(r.campanhas[0]).toMatchObject({ canal: "organica", fonte: "jev" });
    expect(r.promessas[0]).toMatchObject({ situacao: "cumprida", fonte: "jev" });
    expect(r.promessas[1]).toMatchObject({ situacao: "cumprida", fonte: "dono" });
    expect(provaPelaRegra("Montar o calendário de outubro", [{ quando: "x", texto: "Calendário de outubro montado" }])).toBeTruthy();
  });
});

describe("estado real do cliente (leitor único no servidor)", () => {
  const agora = new Date("2026-09-28T15:00:00Z");
  const tabelas = {
    profiles: [{ id: "c1", company_name: "Stop Informatica", created_at: "2026-05-01T00:00:00Z", services_config: { social: true, trafego: true } }],
    social_metrics_weekly: [
      { external_account_id: "a", week_start: "2026-09-21", week_end: "2026-09-27", followers: 1050, reach: 3000, total_interactions: 90 },
      { external_account_id: "a", week_start: "2026-09-14", week_end: "2026-09-20", followers: 1010, reach: 2000, total_interactions: 80 },
      { external_account_id: "a", week_start: "2026-09-07", week_end: "2026-09-13", followers: 985, reach: 1900, total_interactions: 70 },
    ],
    editorial_publications: [{ id: "e1", platform: "instagram", status: "published", published_at: "2026-09-25T15:00:00Z", editorial_posts: { title: "Reels do mouse" } }],
    editorial_posts: [],
    mesa_campanhas: [{ id: "mc1", nome: "Mouse em Giro", status: "gravada", objetivo: "consultas", periodo_inicio: "2026-09-24", periodo_fim: "2026-10-15", atualizado_em: "2026-09-24T00:00:00Z" }],
    ads_campaigns: [{ name: "Conversas | WhatsApp", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: 20 }],
    ads_campaign_daily: [
      { campaign_name: "Conversas | WhatsApp", day: "2026-09-26", spend: 70, actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: 7 }] },
      { campaign_name: "Conversas | WhatsApp", day: "2026-09-18", spend: 70, actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: 4 }] },
    ],
    ads_sales: [], ads_rotina_acoes: [], ads_analises: [], ads_wallet: [{ balance: 150 }],
    projects: [{ id: "p1", name: "Social", status: "active", updated_at: "2026-09-20T00:00:00Z" }],
    tasks: [
      { id: "t1", title: "Legenda do reels", status: "done", due_date: "2026-09-24", updated_at: "2026-09-24T10:00:00Z", source: "portal", priority: "high" },
      { id: "t2", title: "Relatório de setembro", status: "todo", due_date: "2026-09-20", updated_at: "2026-09-10T10:00:00Z", source: "portal", priority: "medium" },
    ],
    milestones: [],
    social_metas_seguidores: [{ id: "m1", meta: 1000, prazo: null, criado_em: "2026-08-01T00:00:00Z", arquivada_em: null }, { id: "m2", meta: 1500, prazo: null, criado_em: "2026-08-01T00:00:00Z", arquivada_em: null }],
    reports: [],
    social_post_metrics: [
      { media_id: "m1", media_type: "VIDEO", caption: "Mouse em giro por R$ 9,90", posted_at: "2026-09-24T15:00:00Z", reach: 1240, saved: 12, shares: 5 },
      { media_id: "m2", media_type: "IMAGE", caption: "Suporte técnico", posted_at: "2026-09-17T15:00:00Z", reach: 300, saved: 1, shares: 0 },
    ],
  };

  it("separa orgânico, campanhas da Mesa e anúncios pagos, com período exato", async () => {
    const e = await lerEstadoReal(bancoFalso(tabelas), "c1", { agora });
    expect(e.periodos.semana).toEqual({ de: "2026-09-22", ate: "2026-09-28" });
    expect(e.pago.semana).toMatchObject({ gasto: 70, contatos: 7 });
    expect(e.pago.semanaAnterior).toMatchObject({ gasto: 70, contatos: 4 });
    expect(tendenciaDosAnuncios(e)).toBe("melhor");
    expect(e.operacao.tarefasAtrasadas.map((t) => t.titulo)).toEqual(["Relatório de setembro"]);
    expect(e.metas.paraComemorar.map((m) => m.id)).toEqual(["m1"]);
    const txt = estadoRealComoTexto(e, { ritual: "prova_movimento", canais: [{ id: "mc1", rotulo: "orgânica (conteúdo do perfil, sem verba)" }] });
    expect(txt).toContain("PERÍODOS: semana = 22/09 a 28/09");
    expect(txt).toContain("CONTEÚDO ORGÂNICO");
    expect(txt).toContain("Reels do mouse (25/09)");
    expect(txt).toContain("Posts no perfil (lidos do Instagram, inclui o que o cliente postou): 1 na semana, 1 na anterior.");
    expect(txt).toContain('"Mouse em giro por R$ 9,90" (vídeo, 24/09): 1.240 pessoas, 12 salvaram, 5 compartilharam');
    expect(txt).toContain('"Mouse em Giro" (gravada, 24/09 a 15/10): canal orgânica');
    expect(txt).toContain("ANÚNCIOS PAGOS");
    expect(txt).toContain("R$ 70 investidos, 7 contatos (custo por contato R$ 10)");
    // A campanha da Mesa não aparece como anúncio.
    const pago = txt.slice(txt.indexOf("ANÚNCIOS PAGOS"));
    expect(pago.split("\n\n")[0]).not.toContain("Mouse em Giro");
    expect(txt).toContain("META BATIDA E AINDA NÃO COMEMORADA");
    expect(txt).toContain("semana MELHOR que a anterior");
    expect(txt).not.toContain(EM);
  });

  it("fonte que falha vira aviso; tabela nova ainda não instalada não é erro", async () => {
    const e = await lerEstadoReal(bancoFalso({ ...tabelas, ads_campaign_daily: new Error("sem permissão"), social_metas_seguidores: [] }), "c1", { agora });
    expect(e.avisos.some((a) => a.startsWith("anúncios por dia"))).toBe(true);
    expect(periodosDe(agora).mesAnterior.de).toBe("2026-07-31");
  });
});

describe("reforço da promessa sem prova", () => {
  const agora = new Date("2026-09-28T15:00:00Z");
  it("promessa da semana passada vira tarefa urgente com a chave; de novo não duplica; aviso uma vez", async () => {
    expect(segundaDaSemana(agora)).toBe("2026-09-28");
    const reg: Array<{ tabela: string; op: string; dados?: unknown }> = [];
    const db = bancoFalso({}, reg);
    const servico = bancoFalso({});
    const id = chaveDaPromessa("abcdef12-0000-0000-0000-000000000000", "Montar o calendário de outubro");
    expect(id).toMatch(/^central:promessa:abcdef12:/);
    const r = await reforcarPromessas(db, servico, {
      clientId: "c1", clienteNome: "Stop", projetoId: "p1", usuarioId: "u1", agora,
      promessas: [
        { id, texto: "Montar o calendário de outubro", feitaEm: "2026-09-26T12:00:00.000Z" },
        { id: "central:promessa:x:hoje", texto: "Algo combinado hoje", feitaEm: "2026-09-28T12:00:00.000Z" },
      ],
      existentes: [],
    });
    expect(r.criadas).toEqual(["Montar o calendário de outubro"]);
    expect(reg[0]).toMatchObject({ tabela: "tasks", op: "insert", dados: { priority: "urgent", source: id, status: "todo", due_date: "2026-09-28" } });
    expect(servico.rpc).toHaveBeenCalledTimes(1);
    expect(servico.rpc.mock.calls[0][0]).toBe("avisar_equipe_do_cliente");

    const reg2: typeof reg = [];
    const r2 = await reforcarPromessas(bancoFalso({}, reg2), servico, {
      clientId: "c1", clienteNome: "Stop", projetoId: "p1", usuarioId: "u1", agora,
      promessas: [{ id, texto: "Montar o calendário de outubro", feitaEm: "2026-09-26T12:00:00.000Z" }],
      existentes: [{ id: "t9", source: id, status: "todo", priority: "urgent" }],
    });
    expect(r2.criadas).toEqual([]);
    expect(r2.reforcadas).toEqual([]);
    expect(reg2).toEqual([]);
    expect(servico.rpc).toHaveBeenCalledTimes(1);
  });

  it("tarefa existente abaixo de urgente é escalada; o que depende do cliente vira confirmação", async () => {
    const reg: Array<{ tabela: string; op: string; dados?: unknown }> = [];
    const r = await reforcarPromessas(bancoFalso({}, reg), null, {
      clientId: "c1", clienteNome: "Stop", projetoId: "p1", usuarioId: "u1", agora,
      promessas: [{ id: "k1", texto: "Revisar legendas", feitaEm: "2026-09-25T12:00:00.000Z" }, { id: "k2", texto: "Aprovando as artes até terça, elas entram no ar", feitaEm: "2026-09-25T12:00:00.000Z" }],
      existentes: [{ id: "t1", source: "k1", status: "todo", priority: "high" }],
    });
    expect(r.reforcadas).toEqual(["Revisar legendas"]);
    expect(reg[0]).toMatchObject({ op: "update", dados: { priority: "urgent" } });
    expect(dependeDoCliente("Aprovando as artes até terça")).toBe(true);
    expect(String((reg[1].dados as Record<string, unknown>).title)).toMatch(/^Confirmar com o cliente:/);
  });
});

describe("modelo: GPT-6 Luna com raciocínio máximo, reserva uma vez", () => {
  it("a lista da tela é a mesma do servidor e o padrão é Luna max", () => {
    expect(MODELOS_DA_TELA.map((m) => m.id)).toEqual(MODELOS_DO_SERVIDOR.map((m) => m.id));
    expect(escolhaDoModelo()).toEqual({ modelo: "openrouter:openai/gpt-6-luna", raciocinio: "max" });
    expect(escolhaDoModelo("qualquer", "absurdo")).toEqual({ modelo: "openrouter:openai/gpt-6-luna", raciocinio: "max" });
    expect(corpoDoModelo(null)).toEqual({ modelo: "openrouter:openai/gpt-6-luna", raciocinio: "max" });
    expect(rotuloDoModelo("openrouter:openai/gpt-6-luna")).toBe("GPT-6 Luna");
    expect(rotuloDoModelo("gpt-4.1")).toBe("GPT-4.1 (antigo)");
  });

  it("motor sem saldo cai uma vez no GPT-4.1 e avisa; o legado nem chama o motor", async () => {
    const motor = vi.fn(async () => { throw Object.assign(new Error("x"), { codigo: "saldo_insuficiente" }); });
    const legado = vi.fn(async () => ({ texto: "{\"body\":\"oi\"}", modelo: "gpt-4.1", usage: null }));
    const r = await escreverComModeloDaCentral({ clientId: "c1", sistema: "s", usuario: "u" }, { motor, legado });
    expect(motor).toHaveBeenCalledTimes(1);
    expect(motor.mock.calls[0][0]).toMatchObject({ modeloId: "openrouter:openai/gpt-6-luna", raciocinio: "max" });
    expect(legado).toHaveBeenCalledTimes(1);
    expect(r?.reserva).toContain("sem saldo na carteira de IA do cliente");
    const motor2 = vi.fn();
    await escreverComModeloDaCentral({ clientId: "c1", sistema: "s", usuario: "u", escolha: { modelo: "legado:gpt-4.1", raciocinio: "max" } }, { motor: motor2 as never, legado });
    expect(motor2).not.toHaveBeenCalled();
  });
});

describe("escritor: estado real antes dos fatos, texto sem travessão", () => {
  it("o pedido põe ofício, estado real e promessas antes dos fatos do painel", () => {
    const t = montarPedidoAoEscritor({ ritual: "prova_movimento", clientName: "Stop", contactName: "Ana", facts: "FATOS", estado: "ESTADO REAL DO CLIENTE x", promessas: "O QUE FOI PROMETIDO y" });
    expect(t.indexOf("OFÍCIO DE AGÊNCIA")).toBeLessThan(t.indexOf("ESTADO REAL DO CLIENTE"));
    expect(t.indexOf("ESTADO REAL DO CLIENTE")).toBeLessThan(t.indexOf("O QUE FOI PROMETIDO"));
    expect(t.indexOf("O QUE FOI PROMETIDO")).toBeLessThan(t.indexOf("FATOS DO PAINEL"));
    expect(t).toContain("TOM DE GENTE");
  });

  it("lê a resposta, tira travessão e devolve o modelo e as expressões de robô", async () => {
    const resposta = JSON.stringify({ title: `Semana ${EM} fechada`, body: `Boa tarde, Ana.\nEspero que esteja bem ${EM} a campanha rodou.\n\n*O que vem agora*\nNa segunda a gente sobe o vídeo.`, next_steps: "" });
    expect(lerRespostaDoEscritor(resposta)?.body).not.toContain(EM);
    const escrever = vi.fn(async () => ({ texto: resposta, modelo: "openrouter:openai/gpt-6-luna", rotulo: "GPT-6 Luna", raciocinio: "max", custoUsd: 0.01, reserva: null }));
    const r = await escreverRitual({ ritual: "prova_movimento", clientName: "Stop", contactName: "Ana", facts: "f", clientId: "c1" }, escrever as never);
    expect(r?.model).toBe("openrouter:openai/gpt-6-luna");
    expect(r?.robo).toEqual(["espero que esteja bem"]);
    expect(r?.next_steps).toContain("Na segunda a gente sobe o vídeo");
    expect(r?.title).toBe("Semana, fechada");
  });
});

describe("o que a gente finaliza não volta", () => {
  it("o plano da semana sabe o que já foi feito (e o desfeito deixa de valer)", async () => {
    const db = bancoFalso({ project_memory: [
      { title: "Desfeito · Gravar reels da vitrine", created_at: "2026-09-25T10:00:00Z", kind: "ciclo" },
      { title: "Feito · Gravar reels da vitrine", created_at: "2026-09-24T10:00:00Z", kind: "ciclo" },
      { title: "Feito · Montar calendário de outubro", created_at: "2026-09-23T10:00:00Z", kind: "acao" },
      { title: "Nota solta", created_at: "2026-09-23T10:00:00Z", kind: "ciclo" },
    ] });
    const feitos = await lerFeitosAntes(db, "c1", new Date("2026-09-28T12:00:00Z"));
    expect(feitos.map((f) => f.titulo)).toEqual(["Montar calendário de outubro"]);
    expect(jaFeito({ titulo: "Calendário de outubro montado", passo: "fechar as datas" }, feitos)).toBeTruthy();
    expect(jaFeito({ titulo: "Gravar reels da vitrine", passo: "" }, feitos)).toBeNull();
  });

  it("na dúvida o Jev decide (uma chamada), e sem Jev o passo fica", async () => {
    const feitos = [{ titulo: "Revisar a bio do Instagram com a oferta nova", quando: "2026-09-22T10:00:00Z" }];
    const propostos = [
      { titulo: "Ajustar bio do perfil", passo: "colocar a oferta de outubro na bio do Instagram" },
      { titulo: "Gravar reels da vitrine", passo: "dois vídeos curtos" },
    ];
    const perguntar = vi.fn(async () => ({ answers: { feito_0: { choice: "f1", probabilities: { f1: 0.8 } } }, usage: null, modelo: "jev" }));
    const r = await filtrarJaFeitos(propostos, feitos, perguntar as never);
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect(r.novos.map((x) => x.titulo)).toEqual(["Gravar reels da vitrine"]);
    expect(r.removidos[0]).toMatchObject({ fonte: "jev" });
    const semJev = await filtrarJaFeitos(propostos, feitos, null);
    expect(semJev.novos).toHaveLength(2);
  });

  const base: FatosDoCliente = {
    clientId: "c1", criadoEm: "2026-01-01T00:00:00Z", servicos: { social: true, trafego: false }, posts: [], tarefas: [], campanhas: [], contasAds: [], vendas: [],
    saldoVerba: null, checklists: [], marcos: [], conexoes: [{ provider: "instagram", status: "connected" }], metricas: [], briefingRespondido: true, dossieResumo: null,
    onboardingHas: {}, estados: {}, rituais: [], oculto: { areas: [], ate: null },
  };

  it("tarefa marcada feita numa semana anterior fica em feitos (não volta como atrasada)", () => {
    const f: FatosDoCliente = {
      ...base,
      tarefas: [{ id: "t1", titulo: "Continuar produção de conteúdos", status: "doing", dueDate: "2026-08-07", assignedTo: "u", source: null, updatedAt: "2026-09-08T00:00:00Z" }],
      estadosAnteriores: { "task:t1": { doneAt: "2026-09-23T20:28:41Z", weekStart: "2026-09-21" } },
    };
    const e = montarEsteira(f, new Date("2026-09-28T12:00:00Z"), "2026-09-28");
    expect(e.itens.some((i) => i.key === "task:t1")).toBe(false);
    const feito = e.feitos.find((i) => i.key === "task:t1");
    expect(feito?.fatos.join(" ")).toContain("Ainda aberta no Kanban");
  });

  it("feito na esteira fecha a origem: tarefa e marco têm id; plano e post não", () => {
    expect(origemDoItem({ key: "task:abc", fonte: "tarefa" })).toEqual({ tipo: "tarefa", id: "abc" });
    expect(origemDoItem({ key: "marco:m1", fonte: "marco" })).toEqual({ tipo: "marco", id: "m1" });
    expect(origemDoItem({ key: "task:mais", fonte: "tarefa" })).toBeNull();
    expect(origemDoItem({ key: "dossie:x", fonte: "checklist" })).toBeNull();
    const acoes = ler("src/lib/esteira/esteiraAcoes.ts");
    expect(acoes).toContain('update({ status: "done", kanban_status: "done" })');
    expect(acoes).toContain("await reabrirOrigem(item);");
  });
});

describe("contratos da Central (frente CE)", () => {
  const central = ler("src/pages/AdminExperience.tsx");
  const writer = ler("supabase/functions/ritual-writer/index.ts");

  it("as três escritas da Central mandam o modelo escolhido", () => {
    expect((central.match(/\.\.\.corpoDoModelo\(escolhaDoModelo\)/g) || []).length).toBe(3);
    expect(central).toContain("<SeletorDeModelo escolha={escolhaDoModelo} onMudar={setEscolhaDoModelo} />");
    expect(central).toContain("<PromessasDoRascunho metricas={r.metrics} />");
  });

  it("o escritor lê o estado real, julga com o Jev, reforça e responde com fôlego", () => {
    expect(writer).toContain("lerEstadoReal(db, clientId");
    expect(writer).toContain("julgarDaCentral(");
    expect(writer).toContain("reforcarPromessas(db, admin");
    expect(writer).toContain("return respostaComFolego(async () => {");
    expect(writer).toContain("metas_reconhecidas: estado ? estado.metas.paraComemorar.map((m) => m.id) : []");
  });

  it("o rascunho guarda promessas, metas comemoradas e o raciocínio", () => {
    const extras = extrasDoRitual({ promessas: [{ texto: "x", situacao: "cumprida", prova: "p" }], metas_reconhecidas: ["m1"], raciocinio: "max" });
    expect(extras).toMatchObject({ metas_reconhecidas: ["m1"], raciocinio: "max" });
    expect(promessasDoRitual({ promessas: [{ texto: "y", situacao: "outra" }] })[0].situacao).toBe("em_andamento");
  });

  it("nada de travessão nos textos novos de tela e de prompt", () => {
    for (const arq of [
      "src/components/central/SeletorDeModelo.tsx", "src/components/central/modeloDaCentral.ts", "src/components/central/PromessasDoRascunho.tsx",
      "src/components/esteira/MetasDeSeguidores.tsx", "supabase/functions/_shared/comunicacao-com-cliente.ts", "supabase/functions/_shared/estado-real-do-cliente.ts",
      "supabase/functions/_shared/metas-de-seguidores.ts", "supabase/functions/_shared/julgamentos-da-central.ts", "supabase/functions/ritual-writer/reforco.ts",
    ]) {
      const t = ler(arq);
      expect(t.includes(EM) || t.includes(EN)).toBe(false);
    }
  });

  it("src novo sem lookbehind nem \\p{} (Safari 11)", () => {
    for (const arq of ["src/components/central/SeletorDeModelo.tsx", "src/components/central/modeloDaCentral.ts", "src/components/esteira/MetasDeSeguidores.tsx", "supabase/functions/_shared/metas-de-seguidores.ts", "src/lib/buscaCompleta.ts"]) {
      const t = ler(arq);
      expect(t).not.toMatch(/\(\?<[=!]/);
      expect(t).not.toMatch(/\\p\{/);
      expect(t).not.toMatch(/\(\?<[a-z]/i);
    }
  });
});

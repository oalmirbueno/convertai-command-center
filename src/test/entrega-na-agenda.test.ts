// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estadoDaPublicacao,
  horarioSugerido,
  laminaCitada,
  legendaComHashtags,
  linkDoAjusteNoEstudio,
  localParaIso,
  marcarAjustesAtendidos,
  payloadComData,
  pedidoDeAjustePendente,
  planoDaSincronizacao,
  problemaNoHorario,
  publicacaoDaPeca,
  regraDePublicacao,
  uuidEstavel,
  type PecaEntregue,
  type PostExistente,
} from "../../supabase/functions/_shared/entrega-na-agenda";
import {
  confirmarDataDaPeca,
  desfazerDataDaPeca,
  ErroDaAgenda,
  sincronizarPecaNaAgenda,
} from "../../supabase/functions/estudio-arte/agenda-da-entrega";

/**
 * Frente EA (27/09): entregar leva a peça para a Agenda (mesmo post, sem
 * duplicar), a data é confirmada pelo dono, só publica com aprovação do
 * cliente + data confirmada, falha não entra em laço e o pedido de ajuste do
 * cliente abre o Estúdio no mesmo trabalho.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const UUIDV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const peca = (extra: Partial<PecaEntregue> = {}): PecaEntregue => ({
  trabalhoId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  titulo: "Dia das crianças",
  fileIds: ["f1", "f2", "f3"],
  legenda: "Legenda do Estúdio",
  hashtags: ["#pets", "#banho"],
  objetivo: "Arte do Estúdio (Mesa do cliente). Conceito.",
  rodada: 1,
  ...extra,
});

const conta = { id: "55555555-5555-4555-8555-555555555555", platform: "instagram" };

const postExistente = (extra: Partial<PostExistente> = {}): PostExistente => ({
  id: "66666666-6666-4666-8666-666666666666",
  version: 3,
  client_id: peca().clientId,
  project_id: peca().projectId,
  primary_file_id: null,
  title: "Pauta",
  content_type: "carousel",
  objective: null,
  default_caption: null,
  production_status: "draft",
  internal: { idempotency_key: "77777777-7777-4777-8777-777777777777", task_id: peca().taskId, responsible_id: null, internal_notes: null, revision_of_post_id: null },
  publications: [],
  ...extra,
});

const pubPlanejada = (extra: Record<string, unknown> = {}) => ({
  id: "88888888-8888-4888-8888-888888888888",
  version: 1,
  status: "planned",
  platform: "instagram",
  external_account_id: conta.id,
  file_id: null,
  caption: "velha",
  first_comment: null,
  alt_text: null,
  scheduled_at: null as string | null,
  scheduled_timezone: "America/Sao_Paulo",
  idempotency_key: "99999999-9999-4999-8999-999999999999",
  ...extra,
});

// ------------------------------------------------------------------ banco de mentira

type Linha = Record<string, unknown>;

/** Supabase de mentira: tabelas em memória (leitura) e RPCs gravadas (escrita). */
function bancoFalso(tabelas: Record<string, Linha[]>, respostas: Record<string, (args: Linha, n: number) => { data?: unknown; error?: unknown }> = {}) {
  const chamadas: { nome: string; args: Linha }[] = [];
  const consulta = (tabela: string) => {
    let linhas = (tabelas[tabela] || []).slice();
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { linhas = linhas.filter((l) => vs.indexOf(l[c]) >= 0); return q; },
      is: (c: string, v: unknown) => { linhas = linhas.filter((l) => (l[c] ?? null) === v); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      then: (ok: (r: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
    };
    return q;
  };
  const cliente = {
    from: (t: string) => consulta(t),
    rpc: async (nome: string, args: Linha) => {
      chamadas.push({ nome, args });
      const n = chamadas.filter((c) => c.nome === nome).length;
      const r = respostas[nome] ? respostas[nome](args, n) : { data: { post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", version: 1 } };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { cliente: cliente as never, chamadas };
}

// ------------------------------------------------------------------ 1. entregar → agenda

describe("entregar cria ou atualiza o mesmo item da Agenda", () => {
  it("sem post: cria com chave estável da peça (a mesma entrega gera a mesma chave)", async () => {
    const a = await planoDaSincronizacao(peca(), null, { conta, arquivoAtualEditavel: false });
    const b = await planoDaSincronizacao(peca(), null, { conta, arquivoAtualEditavel: false });
    expect(a.acao).toBe("criar");
    expect(a.payload?.idempotency_key).toBe(b.payload?.idempotency_key);
    expect(a.payload?.mutation_id).toBe(b.payload?.mutation_id);
    expect(String(a.payload?.idempotency_key)).toMatch(UUIDV4);
    expect(a.payload?.task_id).toBe(peca().taskId);
    expect(a.payload?.production_status).toBe("ready");
  });

  it("mídias na ordem das lâminas: a capa é o arquivo principal; carrossel ou estático pelo número de lâminas", async () => {
    const c = await planoDaSincronizacao(peca(), null, { conta, arquivoAtualEditavel: false });
    expect(c.payload?.primary_file_id).toBe("f1");
    expect(c.payload?.content_type).toBe("carousel");
    const e = await planoDaSincronizacao(peca({ fileIds: ["so"] }), null, { conta, arquivoAtualEditavel: false });
    expect(e.payload?.content_type).toBe("static");
    const post = postExistente({ primary_file_id: "f1", publications: [pubPlanejada()] });
    const p = payloadComData(post, pubPlanejada().id, "2026-10-01T14:30:00.000Z", "m", { delivery_mode: "manual", asset_file_ids: ["f1", "f2", "f3"] });
    expect((p.publications as Linha[])[0].asset_file_ids).toEqual(["f1", "f2", "f3"]);
  });

  it("carrossel acima de 10 lâminas não entra (limite do Instagram)", async () => {
    const r = await planoDaSincronizacao(peca({ fileIds: Array.from({ length: 11 }, (_, i) => `f${i}`) }), null, { conta, arquivoAtualEditavel: false });
    expect(r.acao).toBe("bloqueado");
  });

  it("legenda com as hashtags no fim, sem repetir as que já estão no texto", async () => {
    expect(legendaComHashtags("Texto #pets", ["#pets", "#banho"])).toBe("Texto #pets\n\n#banho");
    const c = await planoDaSincronizacao(peca(), null, { conta, arquivoAtualEditavel: false });
    expect(c.payload?.default_caption).toBe("Legenda do Estúdio\n\n#pets #banho");
    expect((c.payload?.publications as Linha[])[0].caption).toBe("Legenda do Estúdio\n\n#pets #banho");
  });

  it("nasce sem data: a data só entra quando o dono confirma", async () => {
    const c = await planoDaSincronizacao(peca(), null, { conta, arquivoAtualEditavel: false });
    const pubs = c.payload?.publications as Linha[];
    expect(pubs).toHaveLength(1);
    expect(pubs[0].scheduled_at).toBeNull();
    expect(pubs[0].external_account_id).toBe(conta.id);
    // Caminho comum da Agenda: sem delivery_mode/asset_file_ids na criação.
    expect("delivery_mode" in pubs[0]).toBe(false);
  });

  it("post da pauta (sem arte) é ATUALIZADO, não duplicado: mesmo id, mesma chave, publicação reaproveitada", async () => {
    const existente = postExistente({ publications: [pubPlanejada({ scheduled_at: "2026-10-01T14:30:00.000Z" })] });
    const r = await planoDaSincronizacao(peca(), existente, { conta, arquivoAtualEditavel: false });
    expect(r.acao).toBe("atualizar");
    expect(r.payload?.id).toBe(existente.id);
    expect(r.expectedVersion).toBe(3);
    expect(r.payload?.idempotency_key).toBe(existente.internal!.idempotency_key);
    const pubs = r.payload?.publications as Linha[];
    expect(pubs).toHaveLength(1);
    expect(pubs[0].id).toBe(pubPlanejada().id);
    expect(pubs[0].scheduled_at).toBe("2026-10-01T14:30:00.000Z");
  });

  it("entregar de novo a mesma arte não regrava nada (idempotente)", async () => {
    const legenda = legendaComHashtags("Legenda do Estúdio", ["#pets", "#banho"]);
    const existente = postExistente({ primary_file_id: "f1", title: "Dia das crianças", default_caption: legenda, content_type: "carousel" });
    const r = await planoDaSincronizacao(peca(), existente, { conta, arquivoAtualEditavel: false });
    expect(r.acao).toBe("nada");
  });

  it("reentrega depois do ajuste: a arte anterior está em aprovação, nasce a revisão do mesmo item com a mesma conta e data", async () => {
    const existente = postExistente({ primary_file_id: "velho", publications: [pubPlanejada({ scheduled_at: "2026-10-01T14:30:00.000Z" })] });
    const r = await planoDaSincronizacao(peca({ rodada: 2, fileIds: ["n1", "n2"] }), existente, { conta, arquivoAtualEditavel: false });
    expect(r.acao).toBe("revisao");
    expect(r.payload?.revision_of_post_id).toBe(existente.id);
    expect(r.postAnteriorId).toBe(existente.id);
    const pub = (r.payload?.publications as Linha[])[0];
    expect(pub.scheduled_at).toBe("2026-10-01T14:30:00.000Z");
    expect(pub.external_account_id).toBe(conta.id);
    // Rodada nova, chave nova: a revisão não colide com o post da rodada 1.
    const r1 = await planoDaSincronizacao(peca(), null, { conta, arquivoAtualEditavel: false });
    expect(r.payload?.idempotency_key).not.toBe(r1.payload?.idempotency_key);
  });

  it("post já agendado ou publicado com outra arte: não troca sozinho (trava contra publicar a peça errada)", async () => {
    for (const status of ["scheduled", "published"]) {
      const existente = postExistente({ primary_file_id: "outra", publications: [pubPlanejada({ status })] });
      const r = await planoDaSincronizacao(peca(), existente, { conta, arquivoAtualEditavel: true });
      expect(r.acao).toBe("bloqueado");
      expect(r.payload).toBeUndefined();
    }
  });

  it("sem conta do Instagram no projeto: o post entra sem publicação e o aviso diz o motivo", async () => {
    const r = await planoDaSincronizacao(peca(), null, { conta: null, arquivoAtualEditavel: false });
    expect(r.acao).toBe("criar");
    expect(r.payload?.publications).toEqual([]);
    expect(r.aviso).toMatch(/conta do Instagram/);
  });

  it("uuidEstavel tem a forma de UUID versão 4 (a captura da Agenda exige)", async () => {
    expect(await uuidEstavel("x")).toMatch(UUIDV4);
    expect(await uuidEstavel("x")).toBe(await uuidEstavel("x"));
    expect(await uuidEstavel("x")).not.toBe(await uuidEstavel("y"));
  });
});

// ------------------------------------------------------------------ 2. data proposta

describe("Publicar em: data proposta e conferida", () => {
  it("dia da peça + melhor horário do cliente; sem métrica, o horário fixo; sem nada, 09:00", () => {
    expect(horarioSugerido({ diaDaPeca: "2026-10-05", hoje: "2026-09-27", agoraHHMM: "10:00", melhorHora: "18:00", horaFixa: "09:00" })).toEqual({ dia: "2026-10-05", hora: "18:00" });
    expect(horarioSugerido({ diaDaPeca: "2026-10-05", hoje: "2026-09-27", agoraHHMM: "10:00", horaFixa: "08:30" })).toEqual({ dia: "2026-10-05", hora: "08:30" });
    expect(horarioSugerido({ diaDaPeca: "2026-10-05", hoje: "2026-09-27", agoraHHMM: "10:00" })).toEqual({ dia: "2026-10-05", hora: "09:00" });
  });

  it("dia que já passou vira hoje; horário de hoje que já passou vira amanhã", () => {
    expect(horarioSugerido({ diaDaPeca: "2026-09-20", hoje: "2026-09-27", agoraHHMM: "08:00", melhorHora: "11:30" })).toEqual({ dia: "2026-09-27", hora: "11:30" });
    expect(horarioSugerido({ diaDaPeca: "2026-09-20", hoje: "2026-09-27", agoraHHMM: "12:00", melhorHora: "11:30" })).toEqual({ dia: "2026-09-28", hora: "11:30" });
  });

  it("converte o horário local de São Paulo para UTC", () => {
    expect(localParaIso("2026-10-05", "11:30", "America/Sao_Paulo")).toBe("2026-10-05T14:30:00.000Z");
  });

  it("recusa horário no passado (menos de 2 minutos à frente), exceto Publicar agora", () => {
    const agora = new Date("2026-09-27T12:00:00.000Z");
    expect(problemaNoHorario("2026-09-27T12:01:00.000Z", agora)).toMatch(/2 minutos/);
    expect(problemaNoHorario("2026-09-27T13:00:00.000Z", agora)).toBeNull();
    expect(problemaNoHorario(null, agora, { agoraMesmo: true })).toBe("Escolha a data e o horário.");
    expect(problemaNoHorario("2026-09-27T12:01:00.000Z", agora, { agoraMesmo: true })).toBeNull();
  });
});

// ------------------------------------------------------------------ 3. estados

describe("estados da publicação da peça", () => {
  const agora = new Date("2026-09-27T12:00:00.000Z");
  const f = (iso: string) => iso.slice(0, 16);
  const base = { status: "entregue", post_id: "p1" };

  it("aguardando aprovação do cliente (com e sem data confirmada)", () => {
    const sem = estadoDaPublicacao({ trabalho: { ...base, entrega_status: "aguardando_cliente" }, publicacao: pubPlanejada(), agora, formatar: f });
    expect(sem.codigo).toBe("aguardando_aprovacao");
    expect(sem.detalhe).toMatch(/Data a confirmar/);
    const com = estadoDaPublicacao({ trabalho: { ...base, entrega_status: "aguardando_cliente" }, publicacao: pubPlanejada({ scheduled_at: "2026-10-01T14:30:00.000Z" }), agora, formatar: f });
    expect(com.detalhe).toMatch(/Publica em 2026-10-01T14:30/);
  });

  it("aprovado, agendado para dd/mm hh:mm", () => {
    const e = estadoDaPublicacao({ trabalho: { ...base, entrega_status: "agendado" }, publicacao: { status: "scheduled", scheduled_at: "2026-10-01T14:30:00.000Z" }, agora, formatar: f });
    expect(e.codigo).toBe("agendado");
    expect(e.detalhe).toBe("Aprovado, agendado para 2026-10-01T14:30.");
  });

  it("aprovado sem data pede a confirmação", () => {
    const e = estadoDaPublicacao({ trabalho: { ...base, entrega_status: "aprovado", aprovado_em: "2026-09-27T11:00:00.000Z" }, publicacao: pubPlanejada(), agora });
    expect(e.codigo).toBe("aprovado_sem_data");
  });

  it("aprovado depois do horário, sem 'publicar assim que aprovar': pede nova data", () => {
    const e = estadoDaPublicacao({
      trabalho: { ...base, entrega_status: "aprovado", aprovado_em: "2026-09-27T11:00:00.000Z", publicar_ao_aprovar: false },
      publicacao: pubPlanejada({ scheduled_at: "2026-09-27T09:00:00.000Z" }),
      agora,
    });
    expect(e.codigo).toBe("aprovado_depois_do_horario");
  });

  it("publicado com link e falhou com o motivo do motor", () => {
    const pub = estadoDaPublicacao({ trabalho: base, publicacao: { status: "published", scheduled_at: null, published_at: "2026-09-27T11:00:00.000Z", permalink: "https://instagram.com/p/x" }, agora });
    expect(pub.codigo).toBe("publicado");
    expect(pub.link).toBe("https://instagram.com/p/x");
    const falha = estadoDaPublicacao({ trabalho: base, publicacao: { status: "failed", scheduled_at: null }, motor: { stage: "failed", last_error: "Token expirado" }, agora });
    expect(falha.codigo).toBe("falhou");
    expect(falha.detalhe).toBe("Falhou: Token expirado");
  });

  it("entregue e fora da Agenda mostra o motivo", () => {
    const e = estadoDaPublicacao({ trabalho: { status: "entregue", agenda_aviso: "Sem conta" }, publicacao: null, agora });
    expect(e.codigo).toBe("fora_da_agenda");
    expect(e.detalhe).toBe("Sem conta");
  });
});

// ------------------------------------------------------------------ 4. regra de publicação

describe("só publica com aprovação do cliente e data confirmada", () => {
  const agora = new Date("2026-09-27T12:00:00.000Z");
  it("sem aprovação nunca publica", () => {
    expect(regraDePublicacao({ aprovadoEm: null, quando: "2026-09-28T12:00:00.000Z", confirmado: true, publicarAoAprovar: true, agora }).publica).toBe(false);
  });
  it("sem data confirmada não publica", () => {
    expect(regraDePublicacao({ aprovadoEm: "2026-09-27T10:00:00.000Z", quando: null, confirmado: false, publicarAoAprovar: true, agora }).motivo).toBe("sem_data");
  });
  it("aprovado antes do horário: publica no horário", () => {
    const r = regraDePublicacao({ aprovadoEm: "2026-09-27T10:00:00.000Z", quando: "2026-09-28T12:00:00.000Z", confirmado: true, publicarAoAprovar: false, agora });
    expect(r).toEqual({ publica: true, quando: "2026-09-28T12:00:00.000Z", motivo: "publica" });
  });
  it("aprovado depois do horário: só com 'publicar assim que aprovar', logo em seguida", () => {
    const tarde = { aprovadoEm: "2026-09-27T11:59:00.000Z", quando: "2026-09-27T09:00:00.000Z", confirmado: true, agora };
    expect(regraDePublicacao({ ...tarde, publicarAoAprovar: false }).motivo).toBe("aprovado_depois_do_horario");
    const sim = regraDePublicacao({ ...tarde, publicarAoAprovar: true });
    expect(sim.publica).toBe(true);
    expect(sim.quando).toBe("2026-09-27T12:01:00.000Z");
  });
  it("aprovação até 5 minutos depois do horário ainda vale como no horário", () => {
    const r = regraDePublicacao({ aprovadoEm: "2026-09-27T11:03:00.000Z", quando: "2026-09-27T11:00:00.000Z", confirmado: true, publicarAoAprovar: false, agora });
    expect(r.publica).toBe(true);
  });
});

// ------------------------------------------------------------------ 5. função do estúdio (banco de mentira)

describe("ações de publicação da peça", () => {
  // Ids com forma de UUID: a função confere antes de ler o banco.
  const P1 = "a1111111-1111-4111-8111-111111111111";
  const F1 = "b1111111-1111-4111-8111-111111111111";
  const F2 = "b2222222-2222-4222-8222-222222222222";
  const N1 = "c1111111-1111-4111-8111-111111111111";
  const N2 = "c2222222-2222-4222-8222-222222222222";
  const VELHO = "d1111111-1111-4111-8111-111111111111";
  const tabelasBase = (pub: Linha, arquivo: Linha) => ({
    editorial_post_internal: [{ post_id: P1, task_id: "t1", revision_of_post_id: null, idempotency_key: "77777777-7777-4777-8777-777777777777", responsible_id: null, internal_notes: null }],
    editorial_posts: [{ id: P1, version: 4, client_id: "c1", project_id: "pr1", primary_file_id: F1, title: "Dia", content_type: "carousel", objective: "o", default_caption: "leg", production_status: "ready", archived_at: null }],
    editorial_publications: [{ id: "pub1", version: 2, post_id: P1, platform: "instagram", external_account_id: "acc", file_id: null, caption: "leg", first_comment: null, alt_text: null, scheduled_timezone: "America/Sao_Paulo", ...pub }],
    editorial_publication_internal: [{ publication_id: "pub1", idempotency_key: "99999999-9999-4999-8999-999999999999" }],
    files: [{ id: F1, parent_file_id: null, archived_at: null, status: "ready", ...arquivo }],
    external_account_connections: [{ external_account_id: "acc", connection_status: "connected", automation_enabled: true }],
  });
  const trabalho = { id: "w1", client_id: "c1", task_id: "t1", status: "entregue", file_ids: [F1, F2], legenda: "leg", post_id: P1 };
  const pendente = { agency_approval_status: "approved", locked_at: "2026-09-27T10:00:00Z", visibility: "approval", approval_status: "pending" };
  const aprovado = { ...pendente, approval_status: "approved" };
  const agora = new Date("2026-09-27T12:00:00.000Z");

  it("confirmar data sem aprovação grava a data e a publicação continua planejada (o banco agenda quando o cliente aprovar)", async () => {
    const db = bancoFalso(tabelasBase({ status: "planned", scheduled_at: null }, pendente));
    const r = await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1" }, agora);
    expect(r.status).toBe("planned");
    expect(db.chamadas).toHaveLength(1);
    const payload = db.chamadas[0].args.p_payload as Linha;
    expect(db.chamadas[0].nome).toBe("save_editorial_post");
    expect((payload.publications as Linha[])[0].scheduled_at).toBe("2026-10-01T14:30:00.000Z");
    expect("delivery_mode" in (payload.publications as Linha[])[0]).toBe(false);
  });

  it("confirmar data com a arte aprovada vai com as lâminas na ordem (caminho aprovado agenda)", async () => {
    const db = bancoFalso(tabelasBase({ status: "planned", scheduled_at: null }, aprovado));
    const r = await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1" }, agora);
    expect(r.status).toBe("scheduled");
    const pub = ((db.chamadas[0].args.p_payload as Linha).publications as Linha[])[0];
    expect(pub.asset_file_ids).toEqual([F1, F2]);
    expect(pub.delivery_mode).toBe("automatic");
  });

  it("reagendar uma publicação já agendada usa a transição oficial no mesmo card", async () => {
    const db = bancoFalso(tabelasBase({ status: "scheduled", scheduled_at: "2026-09-30T12:00:00.000Z" }, aprovado));
    await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1" }, agora);
    expect(db.chamadas.map((c) => c.nome)).toEqual(["transition_editorial_publication"]);
    expect(db.chamadas[0].args.p_action).toBe("schedule");
  });

  it("Publicar agora sem aprovação do cliente é recusado e nada é chamado", async () => {
    const db = bancoFalso(tabelasBase({ status: "planned", scheduled_at: null }, pendente));
    await expect(confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: null, agoraMesmo: true, mutationId: "m" }, agora)).rejects.toMatchObject({ codigo: "sem_aprovacao" });
    expect(db.chamadas).toHaveLength(0);
  });

  it("Publicar agora aprovado marca para daqui a 1 minuto", async () => {
    const db = bancoFalso(tabelasBase({ status: "planned", scheduled_at: null }, aprovado));
    const r = await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: null, agoraMesmo: true, mutationId: "m" }, agora);
    expect(r.quando).toBe("2026-09-27T12:01:00.000Z");
  });

  it("trava de publicação dupla: publicado não reagenda e falhou não reagenda (usa Tentar de novo)", async () => {
    for (const [status, codigo] of [["published", "ja_publicado"], ["failed", "publicacao_falhou"]]) {
      const db = bancoFalso(tabelasBase({ status, scheduled_at: "2026-09-27T09:00:00.000Z" }, aprovado));
      await expect(confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m" }, agora)).rejects.toMatchObject({ codigo });
      expect(db.chamadas).toHaveLength(0);
    }
  });

  it("falha do banco não entra em laço: uma chamada, erro com a frase, sem nova tentativa", async () => {
    const db = bancoFalso(tabelasBase({ status: "planned", scheduled_at: null }, pendente), {
      save_editorial_post: () => ({ error: { message: "publication account is inactive, unsupported or not linked to the project" } }),
    });
    const erro = await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m" }, agora).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaAgenda);
    expect(erro.message).toMatch(/conta do Instagram/);
    expect(db.chamadas).toHaveLength(1);
  });

  it("desfazer agendamento de uma publicação agendada: cancelar, reabrir e tirar a data", async () => {
    const tabelas = tabelasBase({ status: "scheduled", scheduled_at: "2026-09-30T12:00:00.000Z" }, aprovado);
    const db = bancoFalso(tabelas, {
      transition_editorial_publication: (args) => {
        // O banco de mentira acompanha a transição para a releitura.
        tabelas.editorial_publications[0].status = args.p_action === "cancel" ? "cancelled" : "planned";
        tabelas.editorial_publications[0].version = Number(tabelas.editorial_publications[0].version) + 1;
        return { data: { version: tabelas.editorial_publications[0].version } };
      },
    });
    const r = await desfazerDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, "m");
    expect(db.chamadas.map((c) => `${c.nome}:${c.args.p_action || ""}`)).toEqual([
      "transition_editorial_publication:cancel",
      "transition_editorial_publication:reopen",
      "save_editorial_post:",
    ]);
    expect(((db.chamadas[2].args.p_payload as Linha).publications as Linha[])[0].scheduled_at).toBeNull();
    expect(r.quando).toBeNull();
  });

  it("sincronizar: revisão cancela o plano do post anterior antes de criar o novo (sem card duplicado)", async () => {
    const tabelas = {
      tasks: [{ id: "t1", project_id: "pr1", title: "Dia", deleted_at: null }],
      files: [
        { id: N1, file_name: "Dia", caption: "leg nova", description: "o", visibility: "internal", approval_status: "none", agency_approval_status: "not_requested", locked_at: null, parent_file_id: null, archived_at: null, status: "ready" },
        { id: VELHO, visibility: "approval", approval_status: "rejected", agency_approval_status: "approved", locked_at: "x" },
      ],
      editorial_post_internal: [{ post_id: P1, task_id: "t1", revision_of_post_id: null, idempotency_key: "77777777-7777-4777-8777-777777777777", responsible_id: null, internal_notes: null }],
      editorial_posts: [{ id: P1, version: 4, client_id: "c1", project_id: "pr1", primary_file_id: VELHO, title: "Dia", content_type: "carousel", objective: "o", default_caption: "leg", production_status: "ready", archived_at: null, created_at: "2026-09-20" }],
      editorial_publications: [{ id: "pub1", version: 2, post_id: P1, status: "planned", platform: "instagram", external_account_id: "acc", file_id: null, caption: "leg", first_comment: null, alt_text: null, scheduled_at: "2026-10-01T14:30:00.000Z", scheduled_timezone: "America/Sao_Paulo" }],
      editorial_publication_internal: [{ publication_id: "pub1", idempotency_key: "99999999-9999-4999-8999-999999999999" }],
      project_external_accounts: [{ project_id: "pr1", client_id: "c1", external_account_id: "acc" }],
      external_accounts: [{ id: "acc", platform: "instagram", status: "active", client_id: "c1" }],
      external_account_connections: [],
    };
    const db = bancoFalso(tabelas);
    const r = await sincronizarPecaNaAgenda({ db: db.cliente, doChamador: db.cliente, userId: "u" }, { id: "w1", client_id: "c1", task_id: "t1", status: "entregue", file_ids: [N1, N2], legenda: "leg nova", entrega_rodada: 2, post_id: P1 });
    expect(r.acao).toBe("revisao");
    const saves = db.chamadas.filter((c) => c.nome === "save_editorial_post");
    expect(saves).toHaveLength(2);
    expect((saves[0].args.p_payload as Linha).id).toBe(P1);
    expect((saves[0].args.p_payload as Linha).publications).toEqual([]);
    expect((saves[1].args.p_payload as Linha).revision_of_post_id).toBe(P1);
    expect(((saves[1].args.p_payload as Linha).publications as Linha[])[0].scheduled_at).toBe("2026-10-01T14:30:00.000Z");
  });

  it("publicacaoDaPeca escolhe a do Instagram viva", () => {
    const p = publicacaoDaPeca([
      pubPlanejada({ id: "fb", platform: "facebook" }),
      pubPlanejada({ id: "ig-cancelada", status: "cancelled" }),
      pubPlanejada({ id: "ig" }),
    ]);
    expect(p?.id).toBe("ig");
  });
});

// ------------------------------------------------------------------ 6. ajuste pedido pelo cliente

describe("ajuste pedido pelo cliente abre o Estúdio no mesmo trabalho", () => {
  it("lâmina citada pelo cliente (marcada no portal ou escrita)", () => {
    expect(laminaCitada("Lâmina 3: trocar a foto")).toBe(3);
    expect(laminaCitada("no slide 2 o preço está errado")).toBe(2);
    expect(laminaCitada("Na capa, aumentar o título")).toBe(1);
    expect(laminaCitada("Trocar a cor de tudo")).toBeNull();
  });

  it("pedido pendente, atendido na reentrega com histórico", () => {
    const lista = [
      { evento_id: "e1", texto: "antigo", atendido_em: "2026-09-20T10:00:00Z" },
      { evento_id: "e2", texto: "Lâmina 2: título maior" },
    ];
    expect(pedidoDeAjustePendente(lista)).toMatchObject({ evento_id: "e2", lamina: 2 });
    const marcados = marcarAjustesAtendidos(lista, { em: "2026-09-27T12:00:00Z", por: "u1", rodada: 2 });
    expect(marcados[0].atendido_em).toBe("2026-09-20T10:00:00Z");
    expect(marcados[1]).toMatchObject({ atendido_em: "2026-09-27T12:00:00Z", atendido_por: "u1", atendido_na_rodada: 2 });
    expect(pedidoDeAjustePendente(marcados)).toBeNull();
  });

  it("a Agenda mostra 'Ajuste pedido pelo cliente' com o texto e a lâmina", () => {
    const e = estadoDaPublicacao({
      trabalho: { status: "pronto", post_id: "p1", entrega_status: "reprovado", ajustes_do_cliente: [{ evento_id: "e2", texto: "Lâmina 2: título maior" }] },
      publicacao: pubPlanejada(),
      agora: new Date(),
    });
    expect(e.codigo).toBe("ajuste_pedido");
    expect(e.detalhe).toBe('Ajuste pedido pelo cliente (lâmina 2): "Lâmina 2: título maior"');
  });

  it("o link abre a Mesa > Estúdio pela tarefa (mesmo trabalho), na lâmina, com o pedido do cliente", () => {
    expect(linkDoAjusteNoEstudio("c1", "t1", 3)).toBe("/mesa?client=c1&aba=estudio&task=t1&ajuste=cliente&lamina=3");
    expect(linkDoAjusteNoEstudio("c1", "t1", null)).toBe("/mesa?client=c1&aba=estudio&task=t1&ajuste=cliente");
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toContain('parametros.get("ajuste") === "cliente"');
    expect(estudio).toContain("instrucaoInicial={instrucaoDoCliente && instrucaoDoCliente.ordem === cardSelecionado.ordem");
    expect(ler("src/components/mesa/CardDoEstudio.tsx")).toContain("useState(instrucaoInicial || \"\")");
  });

  it("reenvio depois do ajuste: entregue de novo, falta enviar (sem trabalho novo)", () => {
    const e = estadoDaPublicacao({ trabalho: { status: "entregue", post_id: "p2", entrega_status: "reprovado" }, publicacao: pubPlanejada(), agora: new Date() });
    expect(e.detalhe).toBe("Ajuste feito. Falta enviar ao cliente.");
  });

  it("o portal manda a lâmina marcada no começo do pedido", () => {
    expect(ler("src/pages/ClientApprovals.tsx")).toContain("feedbackLamina > 0 ? `Lâmina ${feedbackLamina}: ${feedbackText.trim()}` : feedbackText");
  });
});

// ------------------------------------------------------------------ 7. contratos da função e das telas

describe("contratos", () => {
  const estudio = ler("supabase/functions/estudio-arte/index.ts");
  const agenda = ler("supabase/functions/estudio-arte/agenda-da-entrega.ts");

  it("entregar leva para a Agenda sem desfazer a entrega quando a Agenda falha", () => {
    expect(estudio).toContain("const agenda = await levarParaAgenda(ch, gravado);");
    expect(estudio).toContain("async function levarParaAgenda(ch: Chamador, t: Trabalho): Promise<ResumoDaAgenda>");
    // Anúncio não vai para a Agenda de posts.
    expect(estudio).toContain("if (ehAds(t) || t.status !== \"entregue\"");
  });

  it("as ações de publicação existem e só admin ou gestor confirma, publica ou desfaz", () => {
    for (const acao of ["agenda_sincronizar: agendaSincronizar", "publicacao_confirmar:", "publicacao_agora:", "publicacao_desfazer: publicacaoDesfazer"]) {
      expect(estudio).toContain(acao);
    }
    expect(estudio).toContain("await exigirQuemPublica(ch);");
    expect(estudio).toContain('toolName: ferramenta, origin: "mesa:estudio-arte"');
  });

  it("nada publica direto na Meta: só as RPCs da Agenda (o ciclo do banco publica)", () => {
    expect(agenda).not.toMatch(/graph\.facebook\.com|media_publish|autopublish_jobs/);
    const rpcs = agenda.match(/rpc\("([a-z_]+)"/g) || [];
    for (const r of rpcs) expect(['rpc("save_editorial_post"', 'rpc("transition_editorial_publication"', 'rpc("archive_editorial_post"']).toContain(r);
  });

  it("a Agenda abre o item certo: o card do post da peça mostra a publicação da Mesa", () => {
    const sheet = ler("src/components/editorial/EditorialDetailSheet.tsx");
    expect(sheet).toContain("<PublicacaoDaMesaNaAgenda");
    expect(sheet).toContain("postId={post.post.id}");
    const bloco = ler("src/components/mesa/PublicacaoDaPeca.tsx");
    expect(bloco).toContain('.eq("post_id", postId)');
    expect(ler("src/components/mesa/AbaEntrega.tsx")).toContain("return `/calendario?client=${clientId}&content=${t.post_id}");
  });

  it("sem regex moderna nos arquivos novos da tela", () => {
    for (const p of ["src/components/mesa/PublicacaoDaPeca.tsx", "supabase/functions/_shared/entrega-na-agenda.ts"]) {
      const t = ler(p);
      expect(t).not.toContain("(?<=");
      expect(t).not.toContain("(?<!");
      expect(t).not.toMatch(/\\p\{/);
      expect(t).not.toMatch(/\(\?<[a-z]/i);
    }
  });
});

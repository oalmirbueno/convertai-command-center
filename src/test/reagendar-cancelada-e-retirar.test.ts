import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  caminhoDoMesmoCliente,
  conferenciaDoLink,
  podeRetirarDaAprovacao,
  referenciaDeAuditoria,
  validadeDoLink,
  type NoParaLink,
} from "../../supabase/functions/mcp-server/modulos/workspace-link-regras";
import { contaTravadaNaCadeia, payloadComPerfis, planoDaSincronizacao, type PecaEntregue, type PostExistente } from "../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import { MAX_CADEIA_DE_REVISOES, contasCanceladasPorPessoa } from "../../supabase/functions/estudio-arte/agenda-da-entrega";

const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

const no = (extra: Partial<NoParaLink> = {}): NoParaLink => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "file",
  scope: "client",
  client_id: "22222222-2222-4222-8222-222222222222",
  storage_path: "client/22222222-2222-4222-8222-222222222222/arte.png",
  name: "arte.png",
  mime: "image/png",
  size_bytes: 1200,
  thumb_path: "client/22222222-2222-4222-8222-222222222222/arte.png.mini.jpg",
  ...extra,
});

describe("link assinado do Workspace", () => {
  const permite = (id: string) => id === "22222222-2222-4222-8222-222222222222";

  it("aceita o arquivo do cliente e a auditoria fica no id, sem URL", () => {
    const r = conferenciaDoLink(no(), permite, false);
    expect(r.ok).toBe(true);
    expect(referenciaDeAuditoria(no().id)).toBe(`workspace_nodes:${no().id}`);
    expect(referenciaDeAuditoria(no().id)).not.toMatch(/https?:|signed/i);
    expect(validadeDoLink(undefined, 600)).toBe(600);
    expect(validadeDoLink(120, 600)).toBe(120);
    expect(() => validadeDoLink(10, 600)).toThrow(/60/);
  });

  it("recusa pasta, blob vazio, outro cliente e nó global de quem não é admin", () => {
    expect(conferenciaDoLink(no({ kind: "folder" }), permite, true).ok).toBe(false);
    expect(conferenciaDoLink(no({ storage_path: null }), permite, true).ok).toBe(false);
    expect(conferenciaDoLink(no({ client_id: "33333333-3333-4333-8333-333333333333" }), permite, false)).toMatchObject({ ok: false, fora: true });
    expect(conferenciaDoLink(no({ storage_path: "client/33333333-3333-4333-8333-333333333333/outro.png", thumb_path: null }), permite, true)).toMatchObject({ ok: false, fora: true });
    expect(conferenciaDoLink(no({ scope: "global", client_id: null, storage_path: "agencia/manual.pdf", thumb_path: null }), permite, false)).toMatchObject({ ok: false, fora: true });
    expect(conferenciaDoLink(no({ scope: "global", client_id: null, storage_path: "agencia/manual.pdf", thumb_path: null }), permite, true).ok).toBe(true);
    expect(caminhoDoMesmoCliente("client/22222222-2222-4222-8222-222222222222/a.png", "22222222-2222-4222-8222-222222222222", false)).toBe(true);
    expect(validadeDoLink(undefined, 9000)).toBe(3600);
  });

  it("a ferramenta assina o bucket workspace e não grava a URL na auditoria", () => {
    const fonte = ler("supabase/functions/mcp-server/modulos/workspace-e-perfis.ts");
    expect(fonte).toContain("from(BUCKET_WORKSPACE).createSignedUrl");
    expect(fonte).toContain("LIMITS.signedDownloadTtlSec");
    expect(fonte).toContain("referenciaDeAuditoria(confere.no.id)");
    expect(fonte).not.toContain("resultRefHolder.value = assinado");
    expect(fonte).toContain("name: 'aceleriq_workspace_link_arquivo'");
    expect(fonte).toContain("scopes: ['workspace:read']");
  });
});

describe("retirar da aprovação", () => {
  const pendente = { visibility: "approval", approval_status: "pending", parent_file_id: null, archived_at: null, locked_at: null };

  it("só o que o cliente ainda não decidiu e está visível", () => {
    expect(podeRetirarDaAprovacao(pendente)).toBe(true);
    expect(podeRetirarDaAprovacao({ ...pendente, approval_status: "approved" })).toBe(false);
    expect(podeRetirarDaAprovacao({ ...pendente, visibility: "internal" })).toBe(false);
    expect(podeRetirarDaAprovacao({ ...pendente, locked_at: "2026-11-01" })).toBe(false);
    expect(podeRetirarDaAprovacao({ ...pendente, parent_file_id: "raiz" })).toBe(false);
  });

  it("a migration volta ao rascunho interno, grava o evento e não apaga", () => {
    const sql = ler("supabase/migrations/20261111143100_retirar_arquivo_da_aprovacao.sql");
    expect(sql).toContain("'approval_withdrawn'");
    expect(sql).toContain("visibility = 'internal'");
    expect(sql).toContain("approval_status = 'none'");
    expect(sql).toContain("agency_approval_status = 'not_requested'");
    expect(sql).toContain("locked_at = NULL");
    expect(sql).toContain("can_manage_client");
    expect(sql).toContain("sent_for_approval_file_id = NULL");
    expect(sql).not.toMatch(/DELETE FROM public\.files/i);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.withdraw_file_client_approval(uuid) TO authenticated");
  });

  it("o botão fica na tela do arquivo e só para admin ou gestor", () => {
    const arquivos = ler("src/pages/AdminFiles.tsx");
    const aprovacoes = ler("src/pages/AdminApprovals.tsx");
    const workspace = ler("src/pages/Workspace.tsx");
    expect(arquivos).toContain("Retirar da aprovação");
    expect(arquivos).toContain("canReviewAndRelease && podeRetirarDaAprovacao(previewFile)");
    expect(aprovacoes).toContain("canReviewAndRelease && podeRetirarDaAprovacao(previewFile)");
    expect(workspace).toContain('profile?.role === "admin" || profile?.role === "manager"');
    expect(workspace).toContain("Retirar da aprovação");
  });
});

describe("reaproveitar publicação cancelada", () => {
  it("o save reusa a linha cancelada e o reopen aceita arte publicável", () => {
    const sql = ler("supabase/migrations/20261111143000_reabrir_publicacao_cancelada.sql");
    expect(sql).toContain("reabrir_cancelada");
    expect(sql).toContain("editorial_can_publish_client");
    expect(sql).toContain("cancelled publication stays cancelled");
    expect(sql).toContain("scheduled_at = NULL");
    expect(sql).toContain("_revision_of_post_id");
    expect(sql).toContain("included_in_approval_snapshot = false");
    expect(sql).toContain("reagendar_publicacao_cancelada");
    expect(sql).toContain("FOR UPDATE OF publication");
    expect(sql).toContain("editorial_file_is_publishable_media");
    expect(sql).toContain("'publication_reopened'");
    expect(sql).not.toMatch(/DROP INDEX[^;]*editorial_publications_post_account_key/i);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.save_editorial_post_unlocked/i);
  });

  it("a entrega não cria publicação para conta que já tem uma cancelada", async () => {
    const peca: PecaEntregue = {
      trabalhoId: "11111111-1111-4111-8111-111111111111",
      clientId: "c",
      projectId: "p",
      taskId: "t",
      titulo: "Novo",
      fileIds: ["f2"],
      legenda: "outra",
      rodada: 2,
    };
    const post = {
      id: "a1111111-1111-4111-8111-111111111111",
      version: 2,
      client_id: "c",
      project_id: "p",
      primary_file_id: "f1",
      title: "Velho",
      content_type: "static",
      objective: null,
      default_caption: "leg",
      production_status: "ready",
      internal: { idempotency_key: "k", task_id: "t", responsible_id: null, internal_notes: null, revision_of_post_id: null },
      publications: [{
        id: "b1111111-1111-4111-8111-111111111111",
        version: 4,
        status: "cancelled",
        platform: "instagram",
        external_account_id: "e1111111-1111-4111-8111-111111111111",
        file_id: null,
        caption: "leg",
        first_comment: null,
        alt_text: null,
        scheduled_at: null,
        scheduled_timezone: "America/Sao_Paulo",
        idempotency_key: "d1111111-1111-4111-8111-111111111111",
      }],
    } as PostExistente;
    const plano = await planoDaSincronizacao(peca, post, {
      conta: { id: "e1111111-1111-4111-8111-111111111111", platform: "instagram" },
      arquivoAtualEditavel: true,
    });
    expect(plano.acao).toBe("atualizar");
    expect(plano.payload?.publications).toEqual([]);
    expect(plano.aviso).toMatch(/cancelada/);
  });

  it("payloadComPerfis não reaproveita a cancelada", async () => {
    const post = {
      id: "a1111111-1111-4111-8111-111111111111",
      version: 2,
      client_id: "c",
      project_id: "p",
      primary_file_id: "f",
      title: "t",
      content_type: "static",
      objective: null,
      default_caption: "leg",
      production_status: "ready",
      internal: null,
      publications: [{
        id: "b1111111-1111-4111-8111-111111111111",
        version: 4,
        status: "cancelled",
        platform: "instagram",
        external_account_id: "e1111111-1111-4111-8111-111111111111",
        file_id: null,
        caption: "leg",
        first_comment: null,
        alt_text: null,
        scheduled_at: null,
        scheduled_timezone: "America/Sao_Paulo",
        idempotency_key: "d1111111-1111-4111-8111-111111111111",
      }],
    } as PostExistente;
    const payload = await payloadComPerfis(post, {
      trabalhoId: "w1",
      rodada: 1,
      perfis: [{ id: "e1111111-1111-4111-8111-111111111111", platform: "instagram", automatico: false }],
      quando: "2026-11-12T14:00:00.000Z",
      mutationId: "m",
    });
    const pubs = payload.publications as Array<{ id: string | null }>;
    expect(pubs[0].id).toBeNull();
  });
});

describe("rodada 4: só cancelamento de pessoa trava, na cadeia de revisões", () => {
  const CONTA = "e1111111-1111-4111-8111-111111111111";
  const A = "a1111111-1111-4111-8111-111111111111";
  const B = "a2222222-2222-4222-8222-222222222222";
  const peca: PecaEntregue = {
    trabalhoId: "11111111-1111-4111-8111-111111111111",
    clientId: "c",
    projectId: "p",
    taskId: "t",
    titulo: "Novo",
    fileIds: ["f2"],
    legenda: "outra",
    rodada: 3,
  };
  const pub = (extra: Record<string, unknown> = {}) => ({
    id: "b1111111-1111-4111-8111-111111111111",
    version: 4,
    status: "cancelled",
    platform: "instagram",
    external_account_id: CONTA,
    file_id: null,
    caption: "leg",
    first_comment: null,
    alt_text: null,
    scheduled_at: null,
    scheduled_timezone: "America/Sao_Paulo",
    idempotency_key: "d1111111-1111-4111-8111-111111111111",
    ...extra,
  });
  const post = (extra: Partial<PostExistente> = {}): PostExistente => ({
    id: B,
    version: 2,
    client_id: "c",
    project_id: "p",
    primary_file_id: "f1",
    title: "Velho",
    content_type: "static",
    objective: null,
    default_caption: "leg",
    production_status: "ready",
    internal: { idempotency_key: "k", task_id: "t", responsible_id: null, internal_notes: null, revision_of_post_id: A },
    publications: [],
    ...extra,
  });

  /** Leitura de mentira com as mesmas formas que o supabase-js devolve. */
  const leitor = (tabelas: Record<string, Record<string, unknown>[]>) => {
    const consulta = (t: string) => {
      let linhas = (tabelas[t] || []).slice();
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] === v); return q; },
        in: (c: string, vs: unknown[]) => { linhas = linhas.filter((l) => vs.includes(l[c])); return q; },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (ok: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
      };
      return q;
    };
    return { from: consulta } as never;
  };
  const evento = (publication_id: string, reason: string | null, created_at = "2026-11-11T10:00:00Z") => ({
    publication_id,
    event_type: "publication_cancelled",
    metadata: reason ? { reason } : { failure_reason: "cancelada de proposito" },
    created_at,
  });

  it("a migration nova filtra o motivo da limpeza, sobe a cadeia e preserva a marca no save aprovado", () => {
    const sql = ler("supabase/migrations/20261111150000_cancelada_so_por_pessoa_na_cadeia.sql");
    expect(sql).toContain("FUNCTION public.editorial_conta_cancelada_por_pessoa(");
    expect(sql).toContain("WITH RECURSIVE cadeia");
    expect(sql).toContain("internal.revision_of_post_id");
    expect(sql).toContain("'removed_from_plan', 'removed_from_approved_media_plan'");
    expect(sql).toContain("event.event_type = 'publication_cancelled'");
    expect(sql).toContain("save_editorial_post_unlocked(jsonb,integer)");
    expect(sql).toContain("save_approved_editorial_post_unlocked(jsonb,integer)");
    expect(sql).toContain("CASE WHEN source.value->>'reabrir_cancelada' = 'true' THEN true END");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.editorial_conta_cancelada_por_pessoa(uuid, uuid, uuid)");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.editorial_conta_cancelada_por_pessoa/i);
    // A 143000 continua igual: a correção é aditiva.
    expect(ler("supabase/migrations/20261111143000_reabrir_publicacao_cancelada.sql")).not.toContain("editorial_conta_cancelada_por_pessoa");
  });

  it("B1: a limpeza da revisão (removed_from_plan) não conta como cancelamento de pessoa", async () => {
    const db = leitor({
      editorial_post_internal: [{ post_id: B, revision_of_post_id: null }],
      editorial_publications: [{ id: "p1", post_id: B, status: "cancelled", external_account_id: CONTA }],
      editorial_events: [evento("p1", "removed_from_plan")],
    });
    expect((await contasCanceladasPorPessoa(db, B, null))?.canceladas).toEqual([]);
    // Revisão de um post sem planejada, com a conta só limpa: a revisão cria a publicação.
    const plano = await planoDaSincronizacao(peca, post({ publications: [pub()], contas_canceladas_por_pessoa: [] }), {
      conta: { id: CONTA, platform: "instagram" },
      arquivoAtualEditavel: false,
    });
    expect(plano.acao).toBe("revisao");
    expect((plano.payload?.publications as Array<{ external_account_id: string }>)[0].external_account_id).toBe(CONTA);
    expect(plano.aviso).toBeNull();
  });

  it("cancelamento de pessoa conta, e o mais novo decide (empate: a pessoa)", async () => {
    const db = leitor({
      editorial_post_internal: [],
      editorial_publications: [{ id: "p1", post_id: B, status: "cancelled", external_account_id: CONTA }],
      editorial_events: [evento("p1", "removed_from_plan"), evento("p1", null)],
    });
    expect((await contasCanceladasPorPessoa(db, B, null))?.canceladas).toEqual([CONTA]);
    const semEvento = leitor({ editorial_publications: [{ id: "p1", post_id: B, status: "cancelled", external_account_id: CONTA }] });
    expect((await contasCanceladasPorPessoa(semEvento, B, null))?.canceladas).toEqual([CONTA]);
  });

  it("B2: A cancelada de propósito → B sem publicação → a revisão C não cria a conta", async () => {
    const db = leitor({
      editorial_post_internal: [{ post_id: A, revision_of_post_id: null }, { post_id: B, revision_of_post_id: A }],
      editorial_publications: [{ id: "pa", post_id: A, status: "cancelled", external_account_id: CONTA }],
      editorial_events: [evento("pa", null)],
    });
    const naCadeia = (await contasCanceladasPorPessoa(db, B, A))?.canceladas;
    expect(naCadeia).toEqual([CONTA]);
    const opcoes = { conta: { id: CONTA, platform: "instagram" }, arquivoAtualEditavel: false };
    const revisao = await planoDaSincronizacao(peca, post({ contas_canceladas_por_pessoa: naCadeia ?? [] }), opcoes);
    expect(revisao.acao).toBe("revisao");
    expect(revisao.payload?.revision_of_post_id).toBe(B);
    expect(revisao.payload?.publications).toEqual([]);
    expect(revisao.aviso).toMatch(/cancelada/);
    // B ainda editável: atualiza o mesmo post, também sem a conta.
    const mesmo = await planoDaSincronizacao(peca, post({ contas_canceladas_por_pessoa: naCadeia ?? [] }), { ...opcoes, arquivoAtualEditavel: true });
    expect(mesmo.acao).toBe("atualizar");
    expect(mesmo.payload?.publications).toEqual([]);
    expect(mesmo.aviso).toMatch(/cancelada/);
  });

  it("na cadeia, o post mais novo com linha na conta decide (o admin reabriu em B)", async () => {
    const db = leitor({
      editorial_post_internal: [{ post_id: B, revision_of_post_id: A }],
      editorial_publications: [
        { id: "pa", post_id: A, status: "cancelled", external_account_id: CONTA },
        { id: "pb", post_id: B, status: "cancelled", external_account_id: CONTA },
      ],
      editorial_events: [evento("pa", null), evento("pb", "removed_from_plan")],
    });
    expect((await contasCanceladasPorPessoa(db, "a3333333-3333-4333-8333-333333333333", B))?.canceladas).toEqual([]);
  });

  // Cadeia de n posts: post(0) é o mais novo; post(n-1) é a raiz.
  const idDoPost = (i: number) => `c${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`;
  const cadeiaLonga = (n: number) => Array.from({ length: n }, (_, i) => ({
    post_id: idDoPost(i),
    revision_of_post_id: i + 1 < n ? idDoPost(i + 1) : null,
  }));

  it("cadeia longa: a cancelada na raiz segue travando além do teto antigo (64)", async () => {
    const n = 100;
    const db = leitor({
      editorial_post_internal: cadeiaLonga(n),
      editorial_publications: [{ id: "raiz", post_id: idDoPost(n - 1), status: "cancelled", external_account_id: CONTA }],
      editorial_events: [evento("raiz", null)],
    });
    const lido = await contasCanceladasPorPessoa(db, idDoPost(0), idDoPost(1));
    expect(lido).toEqual({ canceladas: [CONTA], livres: [], incompleta: false });
  });

  it("busca que bate no teto falha fechada: a conta não decidida conta como travada", async () => {
    const OUTRA = "e2222222-2222-4222-8222-222222222222";
    const db = leitor({
      editorial_post_internal: cadeiaLonga(5),
      editorial_publications: [
        { id: "raiz", post_id: idDoPost(4), status: "cancelled", external_account_id: CONTA },
        { id: "viva", post_id: idDoPost(0), status: "planned", external_account_id: OUTRA },
      ],
      editorial_events: [evento("raiz", null)],
    });
    // Teto 2: lê os níveis 0, 1 e 2; a raiz (nível 4) fica de fora.
    const curto = await contasCanceladasPorPessoa(db, idDoPost(0), idDoPost(1), 2);
    expect(curto).toEqual({ canceladas: [], livres: [OUTRA], incompleta: true });
    const comCurto = post({ contas_canceladas_por_pessoa: curto!.canceladas, contas_livres_na_cadeia: curto!.livres, cadeia_incompleta: true });
    expect(contaTravadaNaCadeia(comCurto, CONTA)).toBe(true);
    expect(contaTravadaNaCadeia(comCurto, OUTRA)).toBe(false);
    // O plano da entrega não cria a conta que a busca incompleta não decidiu.
    const plano = await planoDaSincronizacao(peca, comCurto, { conta: { id: CONTA, platform: "instagram" }, arquivoAtualEditavel: false });
    expect(plano.payload?.publications).toEqual([]);
    expect(plano.aviso).toMatch(/cancelada/);
    // Teto que cobre a cadeia: mesma resposta, completa.
    expect(await contasCanceladasPorPessoa(db, idDoPost(0), idDoPost(1), 4)).toEqual({ canceladas: [CONTA], livres: [OUTRA], incompleta: false });
    // Sem nada cancelado, a busca completa libera; a incompleta não.
    const limpa = leitor({ editorial_post_internal: cadeiaLonga(5), editorial_publications: [] });
    expect((await contasCanceladasPorPessoa(limpa, idDoPost(0), idDoPost(1), 4))?.incompleta).toBe(false);
    const incompleta = await contasCanceladasPorPessoa(limpa, idDoPost(0), idDoPost(1), 2);
    expect(contaTravadaNaCadeia(post({ contas_canceladas_por_pessoa: incompleta!.canceladas, contas_livres_na_cadeia: incompleta!.livres, cadeia_incompleta: incompleta!.incompleta }), CONTA)).toBe(true);
    expect(MAX_CADEIA_DE_REVISOES).toBe(256);
  });

  it("ciclo na cadeia encerra a busca sem marcar incompleta", async () => {
    const db = leitor({
      editorial_post_internal: [{ post_id: A, revision_of_post_id: B }, { post_id: B, revision_of_post_id: A }],
      editorial_publications: [],
    });
    expect(await contasCanceladasPorPessoa(db, B, A, 1)).toEqual({ canceladas: [], livres: [], incompleta: false });
  });

  it("a migration de ajuste trava a troca de conta e percorre a cadeia inteira", () => {
    const sql = ler("supabase/migrations/20261111150100_cancelada_troca_de_conta_e_cadeia_longa.sql");
    expect(sql).not.toContain("\r");
    expect(sql).toContain("FUNCTION public.editorial_conta_cancelada_na_cadeia(");
    expect(sql).toContain("NOT (internal.revision_of_post_id = ANY(cadeia.caminho))");
    expect(sql).toContain("ELSE (SELECT incompleta.valor FROM incompleta)");
    expect(sql).toContain("_existing_publication.external_account_id IS DISTINCT FROM _account.id");
    expect(sql).toContain("'public.save_editorial_post_unlocked(jsonb,integer)'");
    expect(sql).toContain("'public.save_approved_editorial_post_unlocked(jsonb,integer)'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.editorial_conta_cancelada_na_cadeia(uuid, uuid, uuid, integer)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.editorial_conta_cancelada_por_pessoa(uuid, uuid, uuid)");
    expect(sql).not.toMatch(/GRANT EXECUTE/i);
    expect(sql).toContain("SET search_path TO ''");
    // A 150000 continua igual: a correção é aditiva.
    expect(ler("supabase/migrations/20261111150000_cancelada_so_por_pessoa_na_cadeia.sql")).toContain("cadeia.nivel < 64");
  });

  it("o admin que marca a conta cancelada na cadeia manda reabrir_cancelada só nela", async () => {
    const payload = await payloadComPerfis(post(), {
      trabalhoId: "w1",
      rodada: 1,
      perfis: [
        { id: CONTA, platform: "instagram", automatico: false },
        { id: "e2222222-2222-4222-8222-222222222222", platform: "facebook", automatico: false },
      ],
      quando: "2026-11-12T14:00:00.000Z",
      mutationId: "m",
      reabrir: [CONTA],
    });
    const pubs = payload.publications as Array<Record<string, unknown>>;
    expect(pubs[0].reabrir_cancelada).toBe(true);
    expect(pubs[1]).not.toHaveProperty("reabrir_cancelada");
    const semMarca = await payloadComPerfis(post(), {
      trabalhoId: "w1",
      rodada: 1,
      perfis: [{ id: CONTA, platform: "instagram", automatico: false }],
      quando: "2026-11-12T14:00:00.000Z",
      mutationId: "m",
    });
    expect((semMarca.publications as Array<Record<string, unknown>>)[0]).not.toHaveProperty("reabrir_cancelada");
  });
});

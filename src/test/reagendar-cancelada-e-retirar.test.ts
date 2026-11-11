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
import { payloadComPerfis, planoDaSincronizacao, type PecaEntregue, type PostExistente } from "../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";

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

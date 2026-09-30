import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmarDataDaPeca, contaDoProjeto, perfisDaPeca } from "../../supabase/functions/estudio-arte/agenda-da-entrega";

/**
 * Achado E06 (30/09): external_account_connections nega tudo ao service_role
 * (migration 20260731175633). O Estúdio lia a tabela pela chave de serviço,
 * o erro 42501 era engolido e a entrega saía sempre "manual". Agora as
 * conexões vêm pelo JWT de quem chamou (a RLS can_access_client continua
 * valendo) e a falha vai para o log.
 */

type Linha = Record<string, unknown>;
const P1 = "a1111111-1111-4111-8111-111111111111";
const F1 = "b1111111-1111-4111-8111-111111111111";
const IG = "e1111111-1111-4111-8111-111111111111";
const IG_DUPLICADA = "e2222222-2222-4222-8222-222222222222";
const SHA = "a".repeat(64);
const NEGADO = { code: "42501", message: "permission denied for table external_account_connections" };

/** Cliente falso: `negar` devolve erro para as tabelas listadas (como o banco faz com o service_role). */
function clienteFalso(tabelas: Record<string, Linha[]>, negar: string[] = []) {
  const lidas: string[] = [];
  const chamadas: { nome: string; args: Linha }[] = [];
  const consulta = (tabela: string) => {
    lidas.push(tabela);
    const erro = negar.indexOf(tabela) >= 0 ? NEGADO : null;
    let linhas = erro ? [] : (tabelas[tabela] || []).slice();
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { linhas = linhas.filter((l) => vs.indexOf(l[c]) >= 0); return q; },
      is: (c: string, v: unknown) => { linhas = linhas.filter((l) => (l[c] ?? null) === v); return q; },
      or: (expr: string) => {
        const id = /id\.eq\.([0-9a-f-]+)/.exec(expr)?.[1];
        linhas = linhas.filter((l) => l.id === id || l.parent_file_id === id);
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: erro ? null : linhas[0] ?? null, error: erro }),
      then: (ok: (r: { data: Linha[] | null; error: unknown }) => unknown) => Promise.resolve({ data: erro ? null : linhas, error: erro }).then(ok),
    };
    return q;
  };
  const cliente = {
    from: (t: string) => consulta(t),
    rpc: async (nome: string, args: Linha) => {
      chamadas.push({ nome, args });
      return { data: { post_id: P1, version: 5 }, error: null };
    },
  };
  return { cliente: cliente as never, lidas, chamadas };
}

const tabelas = (): Record<string, Linha[]> => ({
  tasks: [{ id: "t1", project_id: "pr1", title: "Dia", deleted_at: null }],
  editorial_post_internal: [{ post_id: P1, task_id: "t1", revision_of_post_id: null, idempotency_key: "77777777-7777-4777-8777-777777777777", responsible_id: null, internal_notes: null }],
  editorial_posts: [{ id: P1, version: 4, client_id: "c1", project_id: "pr1", primary_file_id: F1, title: "Dia", content_type: "static", objective: "o", default_caption: "leg", production_status: "ready", archived_at: null, created_at: "2026-09-27T00:00:00Z" }],
  editorial_publications: [{ id: "pub1", post_id: P1, status: "planned", platform: "instagram", external_account_id: IG, file_id: null, caption: "leg", first_comment: null, alt_text: null, scheduled_at: null, scheduled_timezone: "America/Sao_Paulo", version: 1 }],
  editorial_publication_internal: [{ publication_id: "pub1", idempotency_key: "99999999-9999-4999-8999-999999999991" }],
  files: [{ id: F1, parent_file_id: null, archived_at: null, status: "ready", sha256: SHA, agency_approval_status: "approved", locked_at: "2026-09-27T10:00:00Z", visibility: "approval", approval_status: "approved" }],
  project_external_accounts: [IG_DUPLICADA, IG].map((id) => ({ project_id: "pr1", client_id: "c1", external_account_id: id })),
  // A conta duplicada (sem conexão) vem primeiro, como em CME/Acerbi e Aceleriq.
  external_accounts: [
    { id: IG_DUPLICADA, client_id: "c1", platform: "instagram", status: "active", display_name: "CME antigo", handle: null },
    { id: IG, client_id: "c1", platform: "instagram", status: "active", display_name: "CME", handle: "cmeacerbi2025" },
  ],
  external_account_connections: [{ external_account_id: IG, connection_status: "connected", automation_enabled: true, expires_at: null }],
});

const trabalho = { id: "w1", client_id: "c1", task_id: "t1", status: "entregue", file_ids: [F1], legenda: "leg", post_id: P1, entrega_rodada: 1 };
const agora = new Date("2026-09-28T12:00:00.000Z");

describe("E06: conexões das contas pelo JWT de quem chamou", () => {
  afterEach(() => vi.restoreAllMocks());

  it("contaDoProjeto: com o serviço negado, a conta conectada continua escolhida e automática", async () => {
    const servico = clienteFalso(tabelas(), ["external_account_connections"]);
    const chamador = clienteFalso(tabelas());
    const conta = await contaDoProjeto(servico.cliente, chamador.cliente, "pr1", "c1");
    expect(conta).toMatchObject({ id: IG, automatica: true });
    expect(servico.lidas).not.toContain("external_account_connections");
    expect(chamador.lidas).toEqual(["external_account_connections"]);
  });

  it("perfisDaPeca: o automático vem do chamador; sem o leitor, cai no mesmo cliente (compatível)", async () => {
    const servico = clienteFalso(tabelas(), ["external_account_connections"]);
    const chamador = clienteFalso(tabelas());
    const r = await perfisDaPeca(servico.cliente, trabalho, chamador.cliente);
    expect(r.perfis.map((p) => [p.id, p.automatico])).toEqual([[IG_DUPLICADA, false], [IG, true]]);
    const unico = clienteFalso(tabelas());
    const r2 = await perfisDaPeca(unico.cliente, trabalho);
    expect(r2.perfis.find((p) => p.id === IG)?.automatico).toBe(true);
  });

  it("confirmarDataDaPeca (sem perfis): aprovada com a conta automática grava delivery_mode automatic", async () => {
    const servico = clienteFalso(tabelas(), ["external_account_connections"]);
    const chamador = clienteFalso(tabelas());
    await confirmarDataDaPeca({ db: servico.cliente, doChamador: chamador.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1" }, agora);
    expect(chamador.chamadas).toHaveLength(1);
    const pubs = (chamador.chamadas[0].args.p_payload as Linha).publications as Linha[];
    expect(pubs[0].delivery_mode).toBe("automatic");
  });

  it("confirmarDataDaPeca (com perfis): o Instagram conectado sai automático", async () => {
    const servico = clienteFalso(tabelas(), ["external_account_connections"]);
    const chamador = clienteFalso(tabelas());
    await confirmarDataDaPeca({ db: servico.cliente, doChamador: chamador.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1", perfis: [IG] }, agora);
    const pubs = (chamador.chamadas[0].args.p_payload as Linha).publications as Linha[];
    expect(pubs.map((p) => [p.external_account_id, p.delivery_mode])).toEqual([[IG, "automatic"]]);
  });

  it("erro na leitura do chamador: vai para o log e a entrega segue manual, sem travar", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const servico = clienteFalso(tabelas());
    const chamador = clienteFalso(tabelas(), ["external_account_connections"]);
    const conta = await contaDoProjeto(servico.cliente, chamador.cliente, "pr1", "c1");
    expect(conta).toMatchObject({ id: IG_DUPLICADA, automatica: false });
    await confirmarDataDaPeca({ db: servico.cliente, doChamador: chamador.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1" }, agora);
    const pubs = (chamador.chamadas[0].args.p_payload as Linha).publications as Linha[];
    expect(pubs[0].delivery_mode).toBe("manual");
    const mensagens = log.mock.calls.map((c) => String(c[0]));
    expect(mensagens.some((m) => m.indexOf("estudio-arte: conexões da conta não lidas") === 0)).toBe(true);
    expect(JSON.stringify(log.mock.calls)).toContain("permission denied");
  });

  it("nada de GRANT ao service_role, e as leituras das conexões passam pelo leitor do chamador", () => {
    const agenda = readFileSync(resolve(process.cwd(), "supabase/functions/estudio-arte/agenda-da-entrega.ts"), "utf8");
    const publicacao = readFileSync(resolve(process.cwd(), "supabase/functions/estudio-arte/publicacao-da-peca.ts"), "utf8");
    expect(agenda.match(/from\("external_account_connections"\)/g) || []).toHaveLength(1);
    expect(agenda).toContain("contaDoProjeto(ctx.db, ctx.doChamador, item.project_id, t.client_id)");
    expect(agenda).toContain("contaPorId(ctx.doChamador, pub.external_account_id)");
    expect(agenda).toContain("perfisDaPeca(ctx.db, t, ctx.doChamador)");
    expect(publicacao).toContain("perfisDaPeca(d.servico(), t, ch.doChamador)");
    const migrations = readFileSync(resolve(process.cwd(), "supabase/migrations/20260731175633_meta_oauth_foundation.sql"), "utf8");
    expect(migrations).toMatch(/REVOKE ALL ON public\.external_account_connections\s+FROM PUBLIC, anon, authenticated, service_role;/);
  });
});

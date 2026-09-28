import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Frente AP (28/09): aprovação instantânea para o cliente, aprovou → Agenda
 * (com data agenda; sem data pergunta data, perfil e se vai postar) e o
 * comentário do cliente vira pendência entendida (Jev), sem gerar sozinho.
 */

const canais: { nome: string; ouvintes: { filtro: Record<string, unknown>; fn: () => void }[]; status?: (s: string) => void }[] = [];
const removidos: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (nome: string) => {
      const c = { nome, ouvintes: [] as { filtro: Record<string, unknown>; fn: () => void }[], status: undefined as undefined | ((s: string) => void) };
      canais.push(c);
      const api = {
        on: (_t: string, filtro: Record<string, unknown>, fn: () => void) => {
          c.ouvintes.push({ filtro, fn });
          return api;
        },
        subscribe: (cb?: (s: string) => void) => {
          c.status = cb;
          return api;
        },
        __nome: nome,
      };
      return api;
    },
    removeChannel: (api: { __nome: string }) => {
      removidos.push(api.__nome);
      return Promise.resolve("ok");
    },
    from: () => ({}),
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const entender = vi.fn();
vi.mock("@/lib/mesa/api", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    entenderPedidosDoCliente: (...a: unknown[]) => entender(...a),
    marcarPedidoVisto: vi.fn(() => Promise.resolve({ trabalho_id: "w1" })),
  };
});

import { CHAVES_DOS_ARQUIVOS, ESPERA_AO_VIVO_MS, canaisAbertosDosArquivos, filtroDosArquivos, useArquivosAoVivo } from "@/hooks/useArquivosAoVivo";
import {
  comentarioDaAprovacaoPendente,
  horarioDoConteudo,
  payloadComPerfis,
  planoDaSincronizacao,
  pedidoDeAjustePendente,
  perfisValidos,
  rotuloDoPerfil,
  type PostExistente,
} from "../../supabase/functions/_shared/entrega-na-agenda";
import {
  CONFIANCA_MINIMA,
  entendimentoDoPedido,
  estadoDoPedido,
  formatoDoEstudio,
  perguntasDoPedido,
  resumoDoPedido,
} from "../../supabase/functions/_shared/pedido-do-cliente";
import { confirmarDataDaPeca, perfisDaPeca } from "../../supabase/functions/estudio-arte/agenda-da-entrega";
import { dataInicialDaAprovada, perfisIniciais } from "@/components/mesa/AprovadasSemData";
import { entregaDaArteAprovada } from "@/lib/editorialEntregaAprovada";
import PedidoDoCliente, { aplicacaoDoPedido, pedidoParaMostrar } from "@/components/mesa/PedidoDoCliente";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const CLIENTE = "22222222-2222-4222-8222-222222222222";

// ------------------------------------------------------------------ A. aprovação instantânea

describe("A. o cliente vê na hora o que a equipe enviou", () => {
  beforeEach(() => {
    canais.length = 0;
    removidos.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("filtro do canal: pelo cliente, senão pelo projeto; id inválido não escuta", () => {
    expect(filtroDosArquivos(CLIENTE)).toBe(`client_id=eq.${CLIENTE}`);
    expect(filtroDosArquivos(null, CLIENTE)).toBe(`project_id=eq.${CLIENTE}`);
    expect(filtroDosArquivos("x' or 1=1")).toBeNull();
    expect(filtroDosArquivos()).toBeNull();
  });

  it("escuta só INSERT e UPDATE de files do cliente e relê aprovações, documentos e dashboard em 300 ms", () => {
    const qc = new QueryClient();
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const um = renderHook(() => useArquivosAoVivo(CLIENTE), { wrapper });
    const dois = renderHook(() => useArquivosAoVivo(CLIENTE), { wrapper });
    // Duas telas do mesmo cliente dividem um canal.
    expect(canais).toHaveLength(1);
    expect(canaisAbertosDosArquivos()).toBe(1);
    const c = canais[0];
    expect(c.ouvintes.map((o) => o.filtro.event).sort()).toEqual(["INSERT", "UPDATE"]);
    for (const o of c.ouvintes) {
      expect(o.filtro).toMatchObject({ schema: "public", table: "files", filter: `client_id=eq.${CLIENTE}` });
    }
    // Carrossel: raiz e filhas mudam juntas = uma releitura só.
    c.ouvintes[1].fn();
    c.ouvintes[1].fn();
    c.ouvintes[0].fn();
    expect(invalidar).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(ESPERA_AO_VIVO_MS);
    });
    expect(invalidar).toHaveBeenCalledTimes(CHAVES_DOS_ARQUIVOS.length);
    expect(invalidar.mock.calls.map((x) => (x[0] as { queryKey: string[] }).queryKey[0]).sort()).toEqual(["client-delivered-files", "client-pending-approvals", "files"]);
    um.unmount();
    expect(removidos).toHaveLength(0);
    dois.unmount();
    expect(removidos).toHaveLength(1);
    expect(canaisAbertosDosArquivos()).toBe(0);
  });

  it("reconectou: relê o que mudou no meio tempo", () => {
    const qc = new QueryClient();
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const h = renderHook(() => useArquivosAoVivo(CLIENTE), { wrapper });
    canais[0].status?.("SUBSCRIBED");
    act(() => {
      vi.advanceTimersByTime(ESPERA_AO_VIVO_MS);
    });
    expect(invalidar).not.toHaveBeenCalled();
    canais[0].status?.("SUBSCRIBED");
    act(() => {
      vi.advanceTimersByTime(ESPERA_AO_VIVO_MS);
    });
    expect(invalidar).toHaveBeenCalled();
    h.unmount();
  });

  it("useFiles e o painel do cliente ligam o tempo real; o intervalo de 20 s fica como rede", () => {
    const dados = ler("src/hooks/useSupabaseData.ts");
    expect(dados).toMatch(/useArquivosAoVivo\(clientId, projectId, !!user\)/);
    expect(dados).toMatch(/refetchInterval: 20000/);
    expect(ler("src/components/client/dashboardHelpers.ts")).toMatch(/useArquivosAoVivo\(clientId, null, !!user\)/);
  });

  it("SQL AP-01: files entra no Realtime sem mexer na RLS (nada de policy nova nem grant a anon)", () => {
    const sql = ler("supabase/migrations/20260928060000_aprovacao_e_agenda_automaticas.sql");
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.files/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/i);
    expect(sql).not.toMatch(/can_access_client\s*\(/);
  });
});

// ------------------------------------------------------------------ B. aprovou → Agenda

type Linha = Record<string, unknown>;
const P1 = "a1111111-1111-4111-8111-111111111111";
const F1 = "b1111111-1111-4111-8111-111111111111";
const F2 = "b2222222-2222-4222-8222-222222222222";
const IG = "e1111111-1111-4111-8111-111111111111";
const IG2 = "e2222222-2222-4222-8222-222222222222";
const FB = "f1111111-1111-4111-8111-111111111111";
const OUTRA = "f9999999-9999-4999-8999-999999999999";

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const chamadas: { nome: string; args: Linha }[] = [];
  const consulta = (tabela: string) => {
    let linhas = (tabelas[tabela] || []).slice();
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
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      then: (ok: (r: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
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
  return { cliente: cliente as never, chamadas };
}

const SHA = "a".repeat(64);
const tabelas = (pubs: Linha[], arquivo: Linha) => ({
  tasks: [{ id: "t1", project_id: "pr1" }],
  editorial_post_internal: [{ post_id: P1, task_id: "t1", revision_of_post_id: null, idempotency_key: "77777777-7777-4777-8777-777777777777", responsible_id: null, internal_notes: null }],
  editorial_posts: [{ id: P1, version: 4, client_id: "c1", project_id: "pr1", primary_file_id: F1, title: "Dia", content_type: "carousel", objective: "o", default_caption: "leg", production_status: "ready", archived_at: null, created_at: "2026-09-27T00:00:00Z" }],
  editorial_publications: pubs.map((p) => ({ post_id: P1, file_id: null, caption: "leg", first_comment: null, alt_text: null, scheduled_timezone: "America/Sao_Paulo", version: 1, ...p })),
  editorial_publication_internal: pubs.map((p) => ({ publication_id: p.id, idempotency_key: "99999999-9999-4999-8999-99999999999" + String(p.id).slice(-1) })),
  files: [
    { id: F1, parent_file_id: null, archived_at: null, status: "ready", sha256: SHA, ...arquivo },
    { id: F2, parent_file_id: F1, archived_at: null, status: "ready", sha256: SHA },
  ],
  project_external_accounts: [IG, IG2, FB].map((id) => ({ project_id: "pr1", client_id: "c1", external_account_id: id })),
  external_accounts: [
    { id: IG, client_id: "c1", platform: "instagram", status: "active", display_name: "CME", handle: "cmeacerbi2025" },
    { id: IG2, client_id: "c1", platform: "instagram", status: "active", display_name: "CME antigo", handle: null },
    { id: FB, client_id: "c1", platform: "facebook", status: "active", display_name: "CME Acerbi", handle: null },
    // Conta de outra marca (outro projeto) nunca aparece.
    { id: OUTRA, client_id: "c1", platform: "instagram", status: "active", display_name: "Acerbi", handle: "acerbi" },
  ],
  external_account_connections: [{ external_account_id: IG, connection_status: "connected", automation_enabled: true, expires_at: null }],
});
const trabalho = { id: "w1", client_id: "c1", task_id: "t1", status: "entregue", file_ids: [F1, F2], legenda: "leg", post_id: P1, entrega_rodada: 1 };
const pendente = { agency_approval_status: "approved", locked_at: "2026-09-27T10:00:00Z", visibility: "approval", approval_status: "pending" };
const aprovado = { ...pendente, approval_status: "approved" };
const agora = new Date("2026-09-28T12:00:00.000Z");
const planejada = (id: string, conta: string, extra: Linha = {}) => ({ id, status: "planned", platform: conta === FB ? "facebook" : "instagram", external_account_id: conta, scheduled_at: null, ...extra });

describe("B. aprovou → Agenda com data, perfil e se vai postar", () => {
  it("perfis da peça: só os do projeto (a marca), Instagram primeiro, automático só com automação ligada", async () => {
    const db = bancoFalso(tabelas([planejada("pub1", IG)], aprovado));
    const r = await perfisDaPeca(db.cliente, trabalho);
    expect(r.projectId).toBe("pr1");
    expect(r.perfis.map((p) => p.id)).toEqual([IG, IG2, FB]);
    expect(r.perfis.find((p) => p.id === OUTRA)).toBeUndefined();
    expect(r.perfis.map((p) => p.automatico)).toEqual([true, false, false]);
    expect(r.perfis.map((p) => p.escolhido)).toEqual([true, false, false]);
    expect(rotuloDoPerfil(r.perfis[0])).toBe("@cmeacerbi2025");
    expect(rotuloDoPerfil(r.perfis[2])).toBe("CME Acerbi (Facebook)");
  });

  it("aprovada sem data: confirmar com Instagram + Facebook agenda os dois na data, lâminas na ordem, FB manual", async () => {
    const db = bancoFalso(tabelas([planejada("pub1", IG)], aprovado));
    const r = await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1", perfis: [IG, FB] }, agora);
    expect(db.chamadas).toHaveLength(1);
    const payload = db.chamadas[0].args.p_payload as Linha;
    const pubs = payload.publications as Linha[];
    expect(pubs.map((p) => p.external_account_id)).toEqual([IG, FB]);
    expect(pubs[0].id).toBe("pub1"); // a publicação que já existia continua
    expect(pubs[1].id).toBeNull(); // a página nova nasce com chave estável
    expect(String(pubs[1].idempotency_key)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(pubs.every((p) => p.scheduled_at === "2026-10-01T14:30:00.000Z")).toBe(true);
    expect(pubs.map((p) => p.delivery_mode)).toEqual(["automatic", "manual"]);
    expect(pubs[0].asset_file_ids).toEqual([F1, F2]);
    expect(db.chamadas[0].args.p_expected_version).toBe(4);
    expect(r.post_id).toBe(P1);
  });

  it("perfil que sai não vai no payload (a Agenda cancela a planejada); perfil de outra marca é ignorado", async () => {
    const db = bancoFalso(tabelas([planejada("pub1", IG), planejada("pub2", IG2)], pendente));
    await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m1", perfis: [IG2, OUTRA] }, agora);
    const pubs = (db.chamadas[0].args.p_payload as Linha).publications as Linha[];
    expect(pubs.map((p) => p.id)).toEqual(["pub2"]);
    // Sem aprovação, nada de lâminas congeladas: o banco agenda quando o cliente aprovar.
    expect("delivery_mode" in pubs[0]).toBe(false);
  });

  it("nenhum perfil válido recusa (usar Não vai postar); agendada com outro conjunto recusa", async () => {
    const db = bancoFalso(tabelas([planejada("pub1", IG)], aprovado));
    await expect(
      confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m", perfis: [OUTRA] }, agora),
    ).rejects.toMatchObject({ codigo: "sem_perfil" });
    const db2 = bancoFalso(tabelas([planejada("pub1", IG, { status: "scheduled", scheduled_at: "2026-09-30T12:00:00Z" })], aprovado));
    await expect(
      confirmarDataDaPeca({ db: db2.cliente, doChamador: db2.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m", perfis: [IG, FB] }, agora),
    ).rejects.toMatchObject({ codigo: "perfis_agendados" });
  });

  it("agendada com o mesmo perfil: segue o reagendar de sempre (transição oficial)", async () => {
    const db = bancoFalso(tabelas([planejada("pub1", IG, { status: "scheduled", scheduled_at: "2026-09-30T12:00:00Z" })], aprovado));
    await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m", perfis: [IG] }, agora);
    expect(db.chamadas[0].nome).toBe("transition_editorial_publication");
  });

  it("sem sha256 nas lâminas o Instagram vai manual (o envio automático exige)", async () => {
    const t = tabelas([planejada("pub1", IG)], aprovado);
    (t.files[1] as Linha).sha256 = null;
    const db = bancoFalso(t);
    await confirmarDataDaPeca({ db: db.cliente, doChamador: db.cliente, userId: "u" }, trabalho, { quando: "2026-10-01T14:30:00.000Z", mutationId: "m", perfis: [IG] }, agora);
    expect(((db.chamadas[0].args.p_payload as Linha).publications as Linha[])[0].delivery_mode).toBe("manual");
  });

  it("payloadComPerfis e perfisValidos: sem repetir, só da lista", async () => {
    expect(perfisValidos([IG, IG, "x", FB], [{ id: IG }, { id: FB }])).toEqual([IG, FB]);
    const post = { id: P1, version: 1, client_id: "c1", project_id: "pr1", primary_file_id: F1, title: "t", content_type: "static", objective: null, default_caption: "leg", production_status: "ready", internal: null, publications: [] } as PostExistente;
    const a = await payloadComPerfis(post, { trabalhoId: "w1", rodada: 1, perfis: [{ id: IG, platform: "instagram", automatico: true }], quando: null, mutationId: "m" });
    const b = await payloadComPerfis(post, { trabalhoId: "w1", rodada: 1, perfis: [{ id: IG, platform: "instagram", automatico: true }], quando: null, mutationId: "m" });
    expect((a.publications as Linha[])[0].idempotency_key).toBe((b.publications as Linha[])[0].idempotency_key);
  });

  it("diálogo: abre na data proposta ainda à frente; senão no dia da peça com o melhor horário; perfis que o post já tem", () => {
    const agoraLocal = new Date("2026-09-28T12:00:00.000Z"); // 09:00 em São Paulo
    expect(dataInicialDaAprovada({ publicar_em: "2026-09-29T13:00:00.000Z", dia: "2026-09-29", file_ids: [F1] }, "18:00", agoraLocal)).toBe("2026-09-29T10:00");
    // Proposta que já passou: o dia da peça (já passou também) vira hoje, no melhor horário.
    expect(dataInicialDaAprovada({ publicar_em: "2026-09-20T13:00:00.000Z", dia: "2026-09-20", file_ids: [F1] }, "18:00", agoraLocal)).toBe("2026-09-28T18:00");
    expect(perfisIniciais([{ id: IG, platform: "instagram", nome: "", handle: null, automatico: true, escolhido: false }, { id: FB, platform: "facebook", nome: "", handle: null, automatico: false, escolhido: true }])).toEqual([FB]);
    expect(perfisIniciais([{ id: FB, platform: "facebook", nome: "", handle: null, automatico: false, escolhido: false }, { id: IG, platform: "instagram", nome: "", handle: null, automatico: true, escolhido: false }])).toEqual([IG]);
  });

  it("o Estúdio mostra 'sem data' na faixa de pautas e o aviso leva ao diálogo (&publicar=)", () => {
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toMatch(/<AprovadasSemData \/>/);
    const sql = ler("supabase/migrations/20260928060000_aprovacao_e_agenda_automaticas.sql");
    expect(sql).toMatch(/falta a data/);
    expect(sql).toMatch(/&publicar=/);
    // Um fato, um aviso: "aprovou e agendou" guarda a chave do "agendado" da mesma data.
    expect(sql).toMatch(/'agendado:' \|\| _pub_id::text \|\| ':' \|\| floor\(extract\(epoch FROM _quando\)\)::bigint::text/);
    expect(ler("supabase/migrations/20260927020000_entrega_na_agenda.sql")).toMatch(/'agendado:' \|\| NEW\.id::text \|\| ':' \|\| floor\(extract\(epoch FROM NEW\.scheduled_at\)\)::bigint::text/);
  });
});

// ------------------------------------------------------------------ C. comentário do cliente entendido

describe("C. o comentário do cliente vira pendência entendida (Jev), sem gerar", () => {
  it("perguntas ao Jev: duas Choices na mesma chamada, com 'outro' e 'nenhum' para o que não cabe", () => {
    const q = perguntasDoPedido();
    expect(Object.keys(q)).toEqual(["tipo", "formato"]);
    expect(q.tipo.type).toBe("choice");
    expect(Object.keys(q.tipo.criteria)).toEqual(["troca_de_formato", "ajuste_de_texto", "troca_de_foto", "ajuste_visual", "aprovacao_com_ressalva", "outro"]);
    expect(Object.keys(q.formato.criteria)).toContain("nenhum");
    const e = estadoDoPedido({ texto: "prefiro em carrossel", decisao: "aprovado", formatoAtual: "stories_9x16", laminas: 1 });
    expect(e.decisao).toBe("aprovado");
    expect(e.peca.formato_atual).toBe("post estático (uma lâmina), 9:16 (stories)");
  });

  it("'faz em story' → troca de formato para stories; Aplicar troca a proporção sem gerar", () => {
    const e = entendimentoDoPedido(
      { tipo: { choice: "troca_de_formato", confidence: 0.91 }, formato: { choice: "stories", confidence: 0.88 } },
      { lamina: null, modelo: "jev-1", agora: new Date("2026-09-28T12:00:00Z") },
    );
    expect(e).toMatchObject({ tipo: "troca_de_formato", formato: "stories", resumo: "Quer em stories (9:16)", confianca: 0.91 });
    expect(formatoDoEstudio(e.formato)).toBe("stories_9x16");
    expect(aplicacaoDoPedido(e, "feed_4x5", false)).toEqual({ tipo: "formato", formato: "stories_9x16" });
    // Já está em 9:16: nada a aplicar.
    expect(aplicacaoDoPedido(e, "stories_9x16", false)).toBeNull();
  });

  it("'prefiro em carrossel' vai para o diretor (precisa replanejar); texto abre a lâmina", () => {
    const c = entendimentoDoPedido({ tipo: { choice: "troca_de_formato", confidence: 0.8 }, formato: { choice: "carrossel", confidence: 0.9 } }, { lamina: null, modelo: "jev" });
    expect(c.resumo).toBe("Quer em carrossel");
    expect(aplicacaoDoPedido(c, "feed_4x5", false)).toEqual({ tipo: "diretor" });
    const t = entendimentoDoPedido({ tipo: { choice: "ajuste_de_texto", confidence: 0.8 }, formato: { choice: "carrossel", confidence: 0.9 } }, { lamina: 2, modelo: "jev" });
    expect(t.formato).toBeNull(); // pergunta especulativa: só vale para troca de formato
    expect(t.resumo).toBe("Ajustar o texto na lâmina 2");
    expect(aplicacaoDoPedido(t, "feed_4x5", true)).toEqual({ tipo: "lamina" });
  });

  it("resposta fraca ou fora da lista vira 'pedido do cliente' (o texto dele continua na tela)", () => {
    const fraca = entendimentoDoPedido({ tipo: { choice: "troca_de_foto", confidence: CONFIANCA_MINIMA - 0.01 } }, { lamina: null, modelo: "jev" });
    expect(fraca.tipo).toBe("outro");
    expect(entendimentoDoPedido({ tipo: { choice: "inventado", confidence: 0.99 } }, { lamina: null, modelo: "jev" }).tipo).toBe("outro");
    expect(resumoDoPedido("aprovacao_com_ressalva", null, null)).toBe("Aprovou com uma observação");
  });

  it("comentário da aprovação não vira pedido de ajuste (não reabre nada); tem pendência própria até 'Visto'", () => {
    const lista = [
      { evento_id: "e1", texto: "ok, mas posta de manhã", decisao: "aprovado" },
    ];
    expect(pedidoDeAjustePendente(lista)).toBeNull();
    expect(comentarioDaAprovacaoPendente(lista)?.evento_id).toBe("e1");
    expect(comentarioDaAprovacaoPendente([{ ...lista[0], visto_em: "2026-09-28T12:00:00Z" }])).toBeNull();
    expect(pedidoParaMostrar({ id: "w1", status: "entregue", entrega_status: "aprovado", ajustes_do_cliente: lista })?.tipo).toBe("aprovado");
  });

  it("na peça: entende sozinho ao aparecer e Aplicar só troca o formato (nada é gerado)", async () => {
    entender.mockResolvedValueOnce({
      trabalho_id: "w1",
      entendidos: 1,
      pedidos: [{ evento_id: "e9", texto: "faz em story", decisao: "ajuste", entendido: { tipo: "troca_de_formato", formato: "stories", confianca: 0.9, resumo: "Quer em stories (9:16)", em: "x", modelo: "jev" } }],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mudar = vi.fn();
    const diretor = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <PedidoDoCliente
          trabalho={{ id: "w1", status: "pronto", entrega_status: "reprovado", ajustes_do_cliente: [{ evento_id: "e9", texto: "faz em story", decisao: "ajuste" }] }}
          lamina={null}
          formatoAtual="feed_4x5"
          ocupado={false}
          onAplicarNaLamina={vi.fn()}
          onPedirAoDiretor={diretor}
          onMudarFormato={mudar}
          onAbrirEntrega={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(entender).toHaveBeenCalledWith("w1");
    expect(await screen.findByText("Troca de formato")).toBeTruthy();
    expect(screen.getByText("Quer em stories (9:16)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Trocar para 9:16/ }));
    expect(mudar).toHaveBeenCalledWith("stories_9x16");
    fireEvent.click(screen.getByRole("button", { name: "Pedir ao diretor" }));
    expect(diretor.mock.calls[0][0]).toMatch(/faz em story/);
  });

  it("a chave do Jev fica só no servidor (a tela chama a função estudio-arte)", () => {
    expect(ler("src/components/mesa/PedidoDoCliente.tsx")).not.toMatch(/TYPESAFE|typesafe\.ai/);
    expect(ler("supabase/functions/estudio-arte/publicacao-da-peca.ts")).toMatch(/jevPerguntar/);
  });
});

// ------------------------------------------------------------------ D. bug da Agenda (28/09): conta, data e data do conteúdo

describe("D. na Agenda o post do Estúdio agenda igual a um post normal", () => {
  it("reprodução: a ficha só oferecia 'Programar publicação' sem publicação nenhuma; agora também com o plano só planejado", () => {
    const ficha = ler("src/components/editorial/EditorialDetailSheet.tsx");
    // O post do Estúdio nasce com UMA publicação planejada: a regra antiga escondia conta e data.
    expect(ficha).not.toMatch(/\{post\.publications\.length === 0 && \(/);
    expect(ficha).toMatch(/\{podeProgramarInline && \(/);
    expect(ficha).toMatch(/publication\.status === "planned" \|\| publication\.status === "cancelled"/);
    // As contas carregam para esse caso (antes: só sem publicação).
    expect(ficha).toMatch(/open && post !== null && podeProgramarInline/);
    // Abre com a conta e a data da planejada, e a arte aprovada vai com as lâminas.
    expect(ficha).toMatch(/setInlineAccountId\(planejadaDoPlano\.publication\.external_account_id/);
    expect(ficha).toMatch(/entregaDaArteAprovada\(fresh, inlineAccountId/);
  });

  it("reprodução: a janela Agendar prendia a conta da publicação planejada do Estúdio; agora só a agendada fica presa", () => {
    const janela = ler("src/components/editorial/EditorialScheduleDialog.tsx");
    expect(janela).toMatch(/lockedIds = activePlans\s*\.filter\(\(\{ publication \}\) => publication\.status !== "planned"\)/);
    expect(janela).toMatch(/\.filter\(\(\[, bundle\]\) => bundle\.publication\.status !== "planned"\)/);
    // Planejada com a data do conteúdo continua livre para agendar.
    expect(janela).not.toMatch(/!publication\.scheduled_at &&\s*Boolean\(internal\?\.idempotency_key\)/);
  });

  it("arte aprovada: vai com todas as lâminas na ordem; automático só com conta ligada e automação", async () => {
    const raiz = { id: "r", file_name: "Carrossel (1/3)", parent_file_id: null };
    const ler3 = async () => [
      { id: "c3", file_name: "Carrossel (3/3)", parent_file_id: "r" },
      raiz,
      { id: "c2", file_name: "Carrossel (2/3)", parent_file_id: "r" },
    ];
    const aprovado = { visibility: "approval", approval_status: "approved", agency_approval_status: "approved", locked_at: "x", status: "ready", archived_at: null, parent_file_id: null };
    const bundle = { post: { production_status: "ready", primary_file_id: "r" }, primaryFile: aprovado as never };
    const auto = await entregaDaArteAprovada(bundle, "ig", [{ id: "ig", connection_status: "connected", automation_enabled: true }], ler3);
    expect(auto).toEqual({ delivery_mode: "automatic", asset_file_ids: ["r", "c2", "c3"] });
    const manual = await entregaDaArteAprovada(bundle, "ig", [{ id: "ig", connection_status: "connected", automation_enabled: false }], ler3);
    expect(manual?.delivery_mode).toBe("manual");
    const pendente = { post: { production_status: "ready", primary_file_id: "r" }, primaryFile: { ...aprovado, approval_status: "pending" } as never };
    expect(await entregaDaArteAprovada(pendente, "ig", [], ler3)).toBeNull();
  });
});

describe("D. a publicação nasce na data do conteúdo, não no dia da criação", () => {
  it("dia da pauta com o melhor horário; pauta passada ou horário de hoje já passado fica sem data (nunca empurra para hoje)", () => {
    expect(horarioDoConteudo({ diaDaPeca: "2026-10-07", hoje: "2026-09-28", agoraHHMM: "09:00", melhorHora: "18:30" })).toEqual({ dia: "2026-10-07", hora: "18:30" });
    expect(horarioDoConteudo({ diaDaPeca: "2026-10-07", hoje: "2026-09-28", agoraHHMM: "09:00", horaFixa: "11:00" })).toEqual({ dia: "2026-10-07", hora: "11:00" });
    expect(horarioDoConteudo({ diaDaPeca: "2026-09-25", hoje: "2026-09-28", agoraHHMM: "09:00", melhorHora: "18:00" })).toBeNull();
    expect(horarioDoConteudo({ diaDaPeca: "2026-09-28", hoje: "2026-09-28", agoraHHMM: "17:50", melhorHora: "18:00" })).toBeNull();
    expect(horarioDoConteudo({ diaDaPeca: "2026-09-28", hoje: "2026-09-28", agoraHHMM: "09:00", melhorHora: "18:00" })).toEqual({ dia: "2026-09-28", hora: "18:00" });
    expect(horarioDoConteudo({ diaDaPeca: null, hoje: "2026-09-28", agoraHHMM: "09:00" })).toBeNull();
  });

  it("entregar: a publicação nova e a planejada sem data ganham a data do conteúdo, ainda planejadas", async () => {
    const peca = {
      trabalhoId: "11111111-1111-4111-8111-111111111111", clientId: "c", projectId: "p", taskId: "t", titulo: "T",
      fileIds: ["f1", "f2"], legenda: "l", hashtags: [], objetivo: null, rodada: 1,
    };
    const conta = { id: "55555555-5555-4555-8555-555555555555", platform: "instagram" };
    const q = "2026-10-07T21:30:00.000Z";
    const nova = await planoDaSincronizacao(peca, null, { conta, arquivoAtualEditavel: false, quando: q });
    expect((nova.payload?.publications as Linha[])[0].scheduled_at).toBe(q);
    expect("delivery_mode" in (nova.payload?.publications as Linha[])[0]).toBe(false);
    const semData = await planoDaSincronizacao(peca, null, { conta, arquivoAtualEditavel: false });
    expect((semData.payload?.publications as Linha[])[0].scheduled_at).toBeNull();
    const existente = {
      id: "66666666-6666-4666-8666-666666666666", version: 2, client_id: "c", project_id: "p", primary_file_id: null, title: "x", content_type: "carousel",
      objective: null, default_caption: null, production_status: "draft",
      internal: { idempotency_key: "77777777-7777-4777-8777-777777777777", task_id: "t", responsible_id: null, internal_notes: null, revision_of_post_id: null },
      publications: [
        { id: "a", version: 1, status: "planned", platform: "instagram", external_account_id: conta.id, file_id: null, caption: null, first_comment: null, alt_text: null, scheduled_at: null, scheduled_timezone: null, idempotency_key: "99999999-9999-4999-8999-999999999999" },
        { id: "b", version: 1, status: "planned", platform: "facebook", external_account_id: "fb", file_id: null, caption: null, first_comment: null, alt_text: null, scheduled_at: "2026-10-09T12:00:00.000Z", scheduled_timezone: null, idempotency_key: "99999999-9999-4999-8999-999999999998" },
      ],
    };
    const r = await planoDaSincronizacao(peca, existente, { conta, arquivoAtualEditavel: false, quando: q });
    const pubs = r.payload?.publications as Linha[];
    expect(pubs.find((p) => p.id === "a")?.scheduled_at).toBe(q);
    // A data que alguém já escolheu não é trocada.
    expect(pubs.find((p) => p.id === "b")?.scheduled_at).toBe("2026-10-09T12:00:00.000Z");
  });

  it("a função da entrega pede a data do conteúdo; o backfill só mexe no que ainda espera o cliente", () => {
    const idx = ler("supabase/functions/estudio-arte/index.ts");
    expect(idx).toMatch(/sincronizarPecaNaAgenda\(contextoDaAgenda\(ch\), t, \{ quando: naData \}\)/);
    const sql = ler("supabase/migrations/20260928060100_estudio_data_do_conteudo.sql");
    expect(sql).toMatch(/entrega_status IN \('aguardando_cliente', 'aguardando_agencia'\)/);
    expect(sql).toMatch(/pu\.status = 'planned' AND pu\.scheduled_at IS NULL/);
    expect(sql).toMatch(/tk\.due_date >= \(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date/);
  });

  it("Agendar no Estúdio: a mesma janela curta, só para quem agenda e com a arte entregue", () => {
    const b = ler("src/components/mesa/AgendarDoEstudio.tsx");
    expect(b).toMatch(/<JanelaDaAprovada/);
    expect(b).toMatch(/!podeRecarregar \|\| !trabalho \|\| trabalho\.status !== "entregue"/);
  });
});

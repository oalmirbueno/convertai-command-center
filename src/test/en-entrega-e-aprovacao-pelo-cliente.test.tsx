import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Frente EN (28/09): entregar com três opções no Estúdio (pronto para agendar,
 * enviar para aprovação, só Arquivos), também em lote, e o admin aprovando
 * pelo cliente na Agenda, na tela de Aprovações e no Estúdio.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({}),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => Promise.resolve("ok"),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn() } }));

import {
  corpoDaConclusao,
  corpoDoEntregar,
  entregarComModo,
  entregarVarias,
  opcoesDaEntrega,
  prontaParaEntregar,
  resumoDoLote,
} from "@/lib/mesa/entregaComOpcoes";
import { aprovarPeloCliente, motivoDaRecusaDaAprovacao, NOTA_DO_AVAL, podeAprovarPeloCliente } from "@/lib/fileApprovalActions";
import EstudioEntrega from "@/components/mesa/EstudioEntrega";
import {
  acoesDaEntregaComOpcoes,
  dataParaAgendarAgora,
  motivoDaAprovacao,
  type DepsDaEntrega,
  type TrabalhoDaEntrega,
} from "../../supabase/functions/estudio-arte/entrega-com-opcoes";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

afterEach(() => {
  cleanup();
  rpc.mockReset();
  window.sessionStorage.clear();
});

describe("entregaComOpcoes: as três opções", () => {
  it("design não tem o pronto para agendar; admin e gestor têm as três", () => {
    expect(opcoesDaEntrega(true).map((o) => o.modo)).toEqual(["pronto", "aprovacao", "arquivos"]);
    expect(opcoesDaEntrega(false).map((o) => o.modo)).toEqual(["aprovacao", "arquivos"]);
  });

  it("Só Arquivos entrega sem Agenda; mostrar ao cliente só vale no Só Arquivos", () => {
    expect(corpoDoEntregar("t", "arquivos")).toEqual({ acao: "entregar", trabalho_id: "t", sem_agenda: true });
    expect(corpoDoEntregar("t", "pronto")).toEqual({ acao: "entregar", trabalho_id: "t" });
    expect(corpoDaConclusao("t", "arquivos", true)).toEqual({ acao: "entrega_concluir", trabalho_id: "t", modo: "arquivos", mostrar_ao_cliente: true });
    expect(corpoDaConclusao("t", "pronto", true)).toEqual({ acao: "entrega_concluir", trabalho_id: "t", modo: "pronto" });
  });

  it("pronto: entrega e conclui (aprova e agenda); aprovação: usa o envio de sempre", async () => {
    const chamadas: Record<string, unknown>[] = [];
    const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
      chamadas.push(corpo);
      if (corpo.acao === "entrega_concluir") return { trabalho_id: "t", modo: "pronto", agendado: { quando: "2026-10-01T12:00:00.000Z", status: "scheduled" } } as never;
      return { trabalho_id: "t" } as never;
    });
    const enviar = vi.fn(async () => [{ trabalho_id: "t", ok: true, estado: "aguardando_cliente" }]);
    const r = await entregarComModo("t", "pronto", {}, { chamar, enviar });
    expect(chamadas.map((c) => c.acao)).toEqual(["entregar", "entrega_concluir"]);
    expect(r).toMatchObject({ ok: true, agendadoPara: "2026-10-01T12:00:00.000Z", precisaData: false });
    expect(enviar).not.toHaveBeenCalled();

    const r2 = await entregarComModo("t", "aprovacao", {}, { chamar, enviar });
    expect(enviar).toHaveBeenCalledWith(["t"]);
    expect(r2).toMatchObject({ ok: true, estado: "aguardando_cliente" });
  });

  it("entrega em partes continua sozinha; falha não lança (o lote segue)", async () => {
    let vezes = 0;
    const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
      if (corpo.acao === "entregar" && vezes++ === 0) throw Object.assign(new Error("parte"), { codigo: "entrega_em_partes" });
      if (corpo.acao === "entrega_concluir") throw new Error("Só admin ou gestor com acesso ao cliente aprova por ele.");
      return {} as never;
    });
    const r = await entregarComModo("t", "pronto", {}, { chamar });
    expect(vezes).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Entregue em Arquivos, mas a aprovação pelo cliente falhou");
  });

  it("lote: uma de cada vez, com resumo (agendadas, sem data, falhas)", async () => {
    const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
      if (corpo.acao !== "entrega_concluir") return {} as never;
      if (corpo.trabalho_id === "a") return { agendado: { quando: "2026-10-01T12:00:00Z", status: "scheduled" } } as never;
      if (corpo.trabalho_id === "b") return { precisa_data: true, motivo: "A data do conteúdo já passou." } as never;
      throw new Error("recusado");
    });
    const passos: number[] = [];
    const r = await entregarVarias(["a", "b", "c"], "pronto", {}, { chamar }, (f) => passos.push(f));
    expect(passos).toEqual([1, 2, 3]);
    const resumo = resumoDoLote(r);
    expect(resumo.tudoCerto).toBe(false);
    expect(resumo.titulo).toBe("2 de 3 entregues");
    expect(resumo.detalhe).toContain("1 agendada");
    expect(resumo.detalhe).toContain('1 aprovada sem data (ficam em "sem data")');
  });

  it("pronta para entregar: todas as lâminas com arte, nunca anúncio", () => {
    expect(prontaParaEntregar({ direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] }, cards: [{ ordem: 1 }, { ordem: 2 }] })).toBe(true);
    expect(prontaParaEntregar({ direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] }, cards: [{ ordem: 1 }] })).toBe(false);
    expect(prontaParaEntregar({ tipo: "ads", direcao: { cards: [{ ordem: 1 }] }, cards: [{ ordem: 1 }] })).toBe(false);
    expect(prontaParaEntregar({ status: "entregue", file_ids: ["f"] })).toBe(true);
    expect(prontaParaEntregar(null)).toBe(false);
  });
});

describe("aprovar pelo cliente (front)", () => {
  it("chama a RPC nova com a nota do aval", async () => {
    rpc.mockResolvedValueOnce({ data: { file_id: "f", estado: "aprovado", aprovado_por: "Almir" }, error: null });
    await expect(aprovarPeloCliente("f")).resolves.toMatchObject({ estado: "aprovado" });
    expect(rpc).toHaveBeenCalledWith("aprovar_pelo_cliente", { p_file_id: "f", p_nota: NOTA_DO_AVAL });
    expect(NOTA_DO_AVAL).toBe("aval do cliente ao admin");
  });

  it("só oferece o que ainda espera aprovação; o erro do banco vira frase", () => {
    expect(podeAprovarPeloCliente({ visibility: "internal", agency_approval_status: "not_requested", approval_status: "none" })).toBe(true);
    expect(podeAprovarPeloCliente({ visibility: "approval", agency_approval_status: "approved", approval_status: "pending" })).toBe(true);
    expect(podeAprovarPeloCliente({ visibility: "approval", approval_status: "approved" })).toBe(false);
    expect(podeAprovarPeloCliente({ visibility: "approval", approval_status: "rejected" })).toBe(false);
    expect(podeAprovarPeloCliente({ visibility: "client_shared", agency_approval_status: "approved" })).toBe(false);
    expect(podeAprovarPeloCliente({ parent_file_id: "p" })).toBe(false);
    expect(motivoDaRecusaDaAprovacao({ message: "só admin ou gestor aprova pelo cliente" })).toBe("Só admin ou gestor com acesso ao cliente aprova por ele.");
    expect(motivoDaRecusaDaAprovacao({ message: "Could not find the function public.aprovar_pelo_cliente" })).toContain("migration EN-01");
  });

  it("a Agenda, as Aprovações e o Estúdio usam a RPC nova", () => {
    const folha = ler("src/components/editorial/EditorialDetailSheet.tsx");
    expect(folha).toContain("await aprovarPeloCliente(fileId, NOTA_DO_AVAL)");
    expect(folha).not.toContain('recordOfflineClientApproval(fileId, Number(file.version ?? 1), "grupo")');
    const aprovacoes = ler("src/pages/AdminApprovals.tsx");
    expect(aprovacoes).toContain("await aprovarPeloCliente(f.id, NOTA_DO_AVAL)");
    expect(aprovacoes).toContain("Aprovar pelo cliente");
    const servidor = ler("supabase/functions/estudio-arte/entrega-com-opcoes.ts");
    expect(servidor).toContain('ch.doChamador.rpc("aprovar_pelo_cliente"');
  });
});

describe("EstudioEntrega: um seletor, um botão, a explicação no ?", () => {
  const base = {
    id: "t", task_id: "k", status: "pronto", direcao: { cards: [{ ordem: 1 }] }, modelo_imagem_id: null, qualidade: null,
    cards: [{ ordem: 1, versao: 1, storage_path: "a" }], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "",
  };
  const props = (extra: Record<string, unknown> = {}) => ({
    trabalho: base as never,
    laminasFeitas: 1,
    laminasTotal: 1,
    legendaEscrita: true,
    ehDesign: false,
    entregando: false,
    enviando: false,
    ocupado: false,
    erroDoEnvio: null,
    linkArquivos: "/arquivos",
    linkAgenda: null,
    onEntregar: vi.fn(),
    onEnviar: vi.fn(),
    ...extra,
  });
  const montar = (p: Record<string, unknown>) => render(h(MemoryRouter, null, h(EstudioEntrega, p as never)));

  beforeEach(() => window.sessionStorage.clear());

  it("admin: três opções; pronto para agendar entrega no modo pronto", () => {
    const p = props();
    montar(p);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Pronto para agendar", "Enviar para aprovação", "Só Arquivos"]);
    fireEvent.click(screen.getByRole("radio", { name: /Pronto para agendar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Disponibilizar pronto para agendar/ }));
    expect(p.onEntregar).toHaveBeenCalledWith("pronto", false);
  });

  it("Só Arquivos com mostrar ao cliente", () => {
    const p = props();
    montar(p);
    fireEvent.click(screen.getByRole("radio", { name: /Só Arquivos/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Mostrar ao cliente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Só entregar em Arquivos/ }));
    expect(p.onEntregar).toHaveBeenCalledWith("arquivos", true);
  });

  it("design: sem o pronto para agendar e sem mostrar ao cliente", () => {
    const p = props({ ehDesign: true });
    montar(p);
    expect(screen.queryByRole("radio", { name: /Pronto para agendar/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Só Arquivos/ }));
    expect(screen.queryByRole("checkbox", { name: /Mostrar ao cliente/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Só entregar em Arquivos/ }));
    expect(p.onEntregar).toHaveBeenCalledWith("arquivos", false);
  });

  it("entregue esperando o cliente: o admin aprova pelo cliente e agenda", () => {
    const onAprovarPeloCliente = vi.fn();
    montar(props({ trabalho: { ...base, status: "entregue", file_ids: ["f"], entrega_status: "aguardando_cliente" }, onAprovarPeloCliente }));
    fireEvent.click(screen.getByRole("button", { name: /Aprovar pelo cliente e agendar/ }));
    expect(onAprovarPeloCliente).toHaveBeenCalled();
    cleanup();
    montar(props({ trabalho: { ...base, status: "entregue", file_ids: ["f"], entrega_status: "aprovado" }, onAprovarPeloCliente }));
    expect(screen.queryByRole("button", { name: /Aprovar pelo cliente e agendar/ })).toBeNull();
  });
});

describe("estudio-arte: entrega_concluir", () => {
  const agora = new Date("2026-09-28T12:00:00Z");
  it("a data que vale é a primeira à frente (publicação, proposta, conteúdo)", () => {
    expect(dataParaAgendarAgora(["2026-09-28T10:00:00Z", "2026-09-30T12:00:00Z"], agora)).toBe("2026-09-30T12:00:00Z");
    expect(dataParaAgendarAgora([null, undefined, "2026-09-28T12:01:00Z"], agora)).toBeNull();
    expect(motivoDaAprovacao({ message: "este material foi reprovado e a decisão é final" })).toContain("reprovado");
  });

  type Chamada = { fn: string; args: unknown };
  const montarDeps = (t: Partial<TrabalhoDaEntrega>, opcoes: { pub?: Record<string, unknown> | null; papel?: "admin" | "design"; erroRpc?: string } = {}) => {
    const chamadas: Chamada[] = [];
    const trabalho = { id: "t", client_id: "c", task_id: "k", status: "entregue", file_ids: ["f1", "f2"], legenda: null, post_id: "11111111-2222-4333-8444-555555555555", agenda_sincronizada_em: "x", ...t } as TrabalhoDaEntrega;
    const POST = "11111111-2222-4333-8444-555555555555";
    const pubs = opcoes.pub === null ? [] : [{ id: "66666666-2222-4333-8444-555555555555", version: 1, status: "planned", platform: "instagram", external_account_id: "conta", scheduled_at: "2026-10-02T12:00:00Z", ...(opcoes.pub || {}) }];
    const resultados: Record<string, { lista: unknown; um: unknown }> = {
      editorial_post_internal: { lista: [{ post_id: POST, revision_of_post_id: null }], um: null },
      editorial_posts: { lista: [{ id: POST }], um: { id: POST, version: 1, client_id: "c", project_id: "pr", primary_file_id: "f1", title: "x", content_type: "carousel", objective: null, default_caption: null, production_status: "ready", archived_at: null } },
      editorial_publications: { lista: pubs, um: null },
      editorial_publication_internal: { lista: [], um: null },
    };
    const consulta = (tabela: string) => {
      const r = resultados[tabela] || { lista: [], um: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "order", "limit", "or", "not"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: r.um, error: null });
      q.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve({ data: r.lista, error: null }).then(ok, falha);
      return q;
    };
    const doChamador = {
      rpc: async (fn: string, args: unknown) => {
        chamadas.push({ fn, args });
        if (opcoes.erroRpc) return { data: null, error: { message: opcoes.erroRpc } };
        return { data: fn === "aprovar_pelo_cliente" ? { estado: "aprovado", aprovado_por: "Almir" } : null, error: null };
      },
    };
    const mudancas: Record<string, unknown>[] = [];
    const deps: DepsDaEntrega = {
      json: (b) => new Response(JSON.stringify(b)),
      erro: (status, codigo, mensagem) => Object.assign(new Error(mensagem), { status, codigo }),
      servico: () => ({ from: consulta }) as never,
      trabalhoComAcesso: async () => trabalho,
      lerTrabalho: async () => trabalho,
      mutarTrabalho: async (_id, mudar) => {
        mudancas.push(mudar({ ...trabalho, publicacao_dispensada_em: null } as never));
        return trabalho;
      },
      exigirQuemPublica: async () => {
        if (opcoes.papel === "design") throw new Error("Só admin ou gestor confirma a data e publica.");
      },
      contextoDaAgenda: () => ({}) as never,
      levarParaAgenda: async () => {
        chamadas.push({ fn: "levarParaAgenda", args: null });
        return { ok: true, post_id: "p", aviso: null, publicar_em: null };
      },
      agendar: async (_ch, id, quando) => {
        chamadas.push({ fn: "agendar", args: { id, quando } });
        return { quando, status: "scheduled" };
      },
      dataDoConteudo: async () => null,
      comHistorico: (h, linha) => (Array.isArray(h) ? h : []).concat([linha]),
    };
    const ch = { userId: "u", token: "tk", doChamador } as never;
    return { acao: acoesDaEntregaComOpcoes(deps).acoes.entrega_concluir, ch, chamadas, mudancas };
  };

  it("pronto: aprova pelo cliente (JWT de quem chamou) e agenda na data da publicação", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-28T12:00:00Z"), toFake: ["Date"] });
    try {
      const { acao, ch, chamadas } = montarDeps({});
      const corpo = await (await acao(ch, { trabalho_id: "t", modo: "pronto" })).json();
      expect(chamadas[0]).toEqual({ fn: "aprovar_pelo_cliente", args: { p_file_id: "f1", p_nota: "aval do cliente ao admin" } });
      expect(chamadas[1]).toEqual({ fn: "agendar", args: { id: "t", quando: "2026-10-02T12:00:00Z" } });
      expect(corpo).toMatchObject({ modo: "pronto", precisa_data: false, agendado: { status: "scheduled" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("pronto com a data só no trabalho: a data vai antes da aprovação (um fato, um aviso) e agenda depois", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-28T12:00:00Z"), toFake: ["Date"] });
    try {
      const { acao, ch, chamadas } = montarDeps({ publicar_em: "2026-10-03T13:00:00Z" }, { pub: { scheduled_at: null } });
      const corpo = await (await acao(ch, { trabalho_id: "t", modo: "pronto" })).json();
      expect(chamadas.map((c) => c.fn)).toEqual(["agendar", "aprovar_pelo_cliente", "agendar"]);
      expect(chamadas[0].args).toEqual({ id: "t", quando: "2026-10-03T13:00:00Z" });
      expect(corpo).toMatchObject({ precisa_data: false, agendado: { quando: "2026-10-03T13:00:00Z" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("pronto sem data que sirva: aprova e pede a data (não agenda)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T12:00:00Z"), toFake: ["Date"] });
    try {
      const { acao, ch, chamadas } = montarDeps({});
      const corpo = await (await acao(ch, { trabalho_id: "t", modo: "pronto" })).json();
      expect(chamadas.map((c) => c.fn)).toEqual(["aprovar_pelo_cliente"]);
      expect(corpo).toMatchObject({ precisa_data: true, agendado: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("pronto: design não aprova pelo cliente; recusa do banco vira 409 com frase", async () => {
    const d = montarDeps({}, { papel: "design" });
    await expect(d.acao(d.ch, { trabalho_id: "t", modo: "pronto" })).rejects.toThrow(/Só admin ou gestor/);
    expect(d.chamadas).toEqual([]);
    const r = montarDeps({}, { erroRpc: "este material foi reprovado e a decisão é final" });
    await expect(r.acao(r.ch, { trabalho_id: "t", modo: "pronto" })).rejects.toMatchObject({ status: 409, codigo: "aprovacao_recusada" });
  });

  it("arquivos: sem post e não vai postar; mostrar ao cliente libera como disponível", async () => {
    const a = montarDeps({});
    await a.acao(a.ch, { trabalho_id: "t", modo: "arquivos" });
    expect(a.chamadas).toEqual([]);
    expect(a.mudancas[0]).toHaveProperty("publicacao_dispensada_em");
    expect(a.mudancas[0]).not.toHaveProperty("entrega_status");
    const b = montarDeps({});
    const corpo = await (await b.acao(b.ch, { trabalho_id: "t", modo: "arquivos", mostrar_ao_cliente: true })).json();
    expect(b.chamadas).toEqual([{ fn: "admin_release_file_now", args: { p_file_id: "f1", p_mode: "client_shared" } }]);
    expect(b.mudancas[0]).toMatchObject({ entrega_status: "aprovado" });
    expect(corpo).toMatchObject({ mostrado_ao_cliente: true });
  });

  it("entregar com sem_agenda não cria post; a ação nova está registrada", () => {
    const f = ler("supabase/functions/estudio-arte/index.ts");
    expect(f).toContain("const semAgenda = corpo.sem_agenda === true;");
    expect(f).toContain("const agenda = semAgenda ? null : await levarParaAgenda(ch, gravado);");
    expect(f).toContain("...acoesDaEntregaComOpcoes({");
  });
});

describe("SQL EN-01", () => {
  const sql = ler("supabase/migrations/20260928080000_aprovar_pelo_cliente.sql");
  it("security definer, só admin e gestor, sem anon, nota fora do feedback", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.aprovar_pelo_cliente(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toMatch(/has_role\(_actor, 'admin'::public\.app_role\)\s+OR public\.has_role\(_actor, 'manager'::public\.app_role\)/);
    expect(sql).toContain("NOT public.can_access_client(_file.client_id)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.aprovar_pelo_cliente(uuid, text) FROM PUBLIC, anon;");
    expect(sql).toContain("'channel', 'equipe'");
    expect(sql).not.toMatch(/DROP POLICY|DISABLE ROW LEVEL SECURITY|can_access_client\(_client_id uuid\)/);
  });
  it("histórico e aviso: em nome do cliente", () => {
    expect(sql).toContain("' em nome do cliente: '");
    expect(sql).toContain("aprovou \"' || _titulo || '\" em nome do cliente'");
  });
});

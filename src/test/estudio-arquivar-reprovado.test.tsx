import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({}),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => Promise.resolve("ok"),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn() } }));

import {
  arquivarTrabalhoReprovado,
  CHAVE_DO_ARQUIVO_DA_REPROVACAO,
  ErroDoArquivo,
  estadoDoArquivo,
  patchDoArquivo,
  recusaDoArquivo,
  trabalhoArquivado,
  type DependenciasDoArquivo,
  type TrabalhoParaArquivo,
} from "../../supabase/functions/_shared/arquivo-da-reprovacao";
import { arteRapidaDa, ehArteRapida } from "../../supabase/functions/estudio-arte/modulos/arte-rapida";
import { artesDoHistorico } from "@/components/mesa/arteRapidaApi";
import { situacaoDoItem } from "@/components/mesa/EstudioSituacao";
import { corpoDoArquivarReprovado, corpoDoReabrir } from "@/components/mesa/estudioUtil";
import EstudioEntrega from "@/components/mesa/EstudioEntrega";

/**
 * 24/11/2026: arquivar só internamente a entrega reprovada do Estúdio (social padrão, com ou sem
 * item, e arte rápida). Ids fictícios.
 */

const CLIENTE = "00000000-0000-4000-8000-0000000000c1";
const OUTRO = "00000000-0000-4000-8000-0000000000c2";
const ID = "00000000-0000-4000-8000-0000000000a1";

type Linha = TrabalhoParaArquivo & Record<string, unknown>;

const social = (extra: Partial<Linha> = {}): Linha => ({
  id: ID,
  client_id: CLIENTE,
  task_id: null,
  tipo: "social",
  origem: "mesa",
  status: "pronto",
  entrega_status: "reprovado",
  entrega_rodada: 2,
  post_id: null,
  file_ids: ["f1"],
  direcao: { conceito: "x", carrossel_infinito: false, cards: [{ ordem: 1 }], reaberturas: [{ em: "a" }] },
  atualizado_em: "2026-11-24T10:00:00.000Z",
  ...extra,
});

const rapida = (extra: Partial<Linha> = {}): Linha =>
  social({
    direcao: { conceito: "x", carrossel_infinito: false, cards: [{ ordem: 1, texto_exato: "Título" }], arte_rapida: { pedido: "p", titulo: "t", arquivos: [], documentos: [], avisos: [], criada_em: "2026-11-01" } },
    ...extra,
  });

/** Banco de mentira: uma linha, trava por atualizado_em e entrega_status (como o UPDATE do estudio-arte). */
function bancoFalso(inicial: Linha, opcoes: { acesso?: boolean; antesDeGravar?: (linha: Linha, n: number) => Linha | null } = {}) {
  let linha = structuredClone(inicial);
  let relogio = 0;
  const gravacoes: Array<Record<string, unknown>> = [];
  const auditoria: Array<{ desfazer: boolean; mudou: boolean; ok: boolean; codigo?: string }> = [];
  const deps: DependenciasDoArquivo<Linha> = {
    lerComAcesso: async (id) => {
      if (id !== linha.id) throw new ErroDoArquivo(404, "trabalho_inexistente", "não achou");
      if (opcoes.acesso === false) throw new ErroDoArquivo(403, "sem_acesso_ao_cliente", "sem acesso");
      return structuredClone(linha);
    },
    reler: async () => structuredClone(linha),
    gravarSeIgual: async (t, patch) => {
      const n = gravacoes.length;
      gravacoes.push(patch);
      const mexida = opcoes.antesDeGravar?.(linha, n);
      if (mexida) linha = mexida;
      if (linha.atualizado_em !== t.atualizado_em || linha.client_id !== t.client_id || linha.entrega_status !== "reprovado") return null;
      relogio += 1;
      linha = { ...linha, ...patch, atualizado_em: `2026-11-24T10:00:0${relogio}.000Z` };
      return structuredClone(linha);
    },
    agora: () => "2026-11-24T12:00:00.000Z",
    auditar: async (r) => { auditoria.push({ desfazer: r.desfazer, mudou: r.mudou, ok: r.ok, codigo: r.codigo }); },
  };
  return { deps, gravacoes, auditoria, atual: () => linha };
}

afterEach(() => cleanup());

describe("leitura do estado arquivado (uma regra para servidor, MCP e tela)", () => {
  it("reconhece o marcador legado da arte rápida em qualquer situação", () => {
    const t = rapida({ entrega_status: "aprovado" });
    (t.direcao as Record<string, Record<string, unknown>>).arte_rapida.arquivada_em = "2026-10-01T00:00:00Z";
    expect(estadoDoArquivo(t)).toMatchObject({ arquivado: true, origem: "arte_rapida", arquivado_em: "2026-10-01T00:00:00Z" });
  });

  it("o marcador novo vale só na mesma rodada e com a entrega ainda reprovada", () => {
    const marcado = { ...social(), direcao: { ...(social().direcao as object), [CHAVE_DO_ARQUIVO_DA_REPROVACAO]: { arquivado_em: "2026-11-24T12:00:00Z", arquivado_por: "u", rodada: 2, motivo: null } } };
    expect(trabalhoArquivado(marcado)).toBe(true);
    // Reabrir sobe a rodada: volta para a lista sem desarquivar.
    expect(estadoDoArquivo({ ...marcado, entrega_rodada: 3 })).toMatchObject({ arquivado: false, marcador_antigo: true });
    // Reentregue e aprovada: o marcador não vale mais.
    expect(trabalhoArquivado({ ...marcado, entrega_status: "aguardando_cliente" })).toBe(false);
    expect(trabalhoArquivado({ ...marcado, entrega_status: "aprovado" })).toBe(false);
  });

  it("sem marcador, direção vazia ou estranha: não arquivado", () => {
    expect(trabalhoArquivado(social())).toBe(false);
    expect(trabalhoArquivado({ direcao: null, entrega_status: "reprovado" })).toBe(false);
    expect(trabalhoArquivado({ direcao: { [CHAVE_DO_ARQUIVO_DA_REPROVACAO]: "x" }, entrega_status: "reprovado" })).toBe(false);
    expect(trabalhoArquivado({ direcao: { arte_rapida: null }, entrega_status: "reprovado" })).toBe(false);
  });
});

describe("quem pode ser arquivado", () => {
  it("só a entrega reprovada; anúncio e Laboratório ficam fora", () => {
    expect(recusaDoArquivo(social())).toBeNull();
    expect(recusaDoArquivo(social({ task_id: "00000000-0000-4000-8000-0000000000t1" }))).toBeNull();
    expect(recusaDoArquivo(rapida())).toBeNull();
    for (const s of [null, "aguardando_agencia", "aguardando_cliente", "aprovado", "agendado", "precisa_de_atencao"]) {
      expect(recusaDoArquivo(social({ entrega_status: s }))?.codigo).toBe("nao_reprovado");
    }
    expect(recusaDoArquivo(social({ tipo: "ads" }))?.codigo).toBe("anuncio");
    expect(recusaDoArquivo(social({ origem: "laboratorio" }))?.codigo).toBe("laboratorio");
  });
});

describe("o patch mexe só no marcador dentro de direcao", () => {
  it("social sem item: só a chave nova, o resto da direção intacto e nunca vira arte rápida", () => {
    const t = social();
    const p = patchDoArquivo(t, { desfazer: false, agora: "2026-11-24T12:00:00Z", por: "u1", motivo: "  cliente desistiu  " });
    expect(Object.keys(p)).toEqual(["direcao"]);
    expect(p.direcao[CHAVE_DO_ARQUIVO_DA_REPROVACAO]).toEqual({ arquivado_em: "2026-11-24T12:00:00Z", arquivado_por: "u1", rodada: 2, motivo: "cliente desistiu" });
    const { [CHAVE_DO_ARQUIVO_DA_REPROVACAO]: _m, ...resto } = p.direcao;
    expect(resto).toEqual(t.direcao);
    expect("arte_rapida" in p.direcao).toBe(false);
    expect(ehArteRapida(p.direcao)).toBe(false);
  });

  it("arte rápida: usa o marcador que ela já tinha, compatível com o histórico e o normalizador", () => {
    const t = rapida();
    const p = patchDoArquivo(t, { desfazer: false, agora: "2026-11-24T12:00:00Z", por: "u1" });
    expect(CHAVE_DO_ARQUIVO_DA_REPROVACAO in p.direcao).toBe(false);
    const a = arteRapidaDa(p.direcao);
    expect(a?.arquivada_em).toBe("2026-11-24T12:00:00Z");
    expect(a?.pedido).toBe("p");
    // A lista da arte rápida (o leitor antigo) já tira a arquivada.
    expect(artesDoHistorico([{ ...t, direcao: p.direcao } as never])).toHaveLength(0);
    expect(artesDoHistorico([t as never])).toHaveLength(1);
  });

  it("desfazer tira os dois marcadores", () => {
    const comNovo = { ...social(), direcao: patchDoArquivo(social(), { desfazer: false, agora: "x", por: null }).direcao };
    expect(patchDoArquivo(comNovo, { desfazer: true, agora: "y", por: null }).direcao[CHAVE_DO_ARQUIVO_DA_REPROVACAO]).toBeNull();
    const comLegado = { ...rapida(), direcao: patchDoArquivo(rapida(), { desfazer: false, agora: "x", por: null }).direcao };
    expect(arteRapidaDa(patchDoArquivo(comLegado, { desfazer: true, agora: "y", por: null }).direcao)?.arquivada_em).toBeNull();
  });
});

describe("a ação: privilégio, idempotência, reversão e corrida", () => {
  it("arquiva o social reprovado sem item, grava uma vez e audita", async () => {
    const b = bancoFalso(social());
    const r = await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" });
    expect(r).toMatchObject({ arquivado: true, ja_estava: false });
    expect(b.gravacoes).toHaveLength(1);
    expect(Object.keys(b.gravacoes[0])).toEqual(["direcao"]);
    // Nada de task_id, post_id, status, entrega_status, file_ids.
    expect(b.atual()).toMatchObject({ task_id: null, post_id: null, status: "pronto", entrega_status: "reprovado", file_ids: ["f1"] });
    expect(b.auditoria).toEqual([{ desfazer: false, mudou: true, ok: true, codigo: undefined }]);
  });

  it("idempotente: arquivar de novo não grava; desfazer volta; desfazer de novo não grava", async () => {
    const b = bancoFalso(social());
    await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" });
    const de_novo = await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" });
    expect(de_novo).toMatchObject({ arquivado: true, ja_estava: true });
    expect(b.gravacoes).toHaveLength(1);
    const volta = await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1", desfazer: true });
    expect(volta).toMatchObject({ arquivado: false, ja_estava: false });
    expect(trabalhoArquivado(b.atual())).toBe(false);
    const volta2 = await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1", desfazer: true });
    expect(volta2.ja_estava).toBe(true);
    expect(b.gravacoes).toHaveLength(2);
  });

  it("sem acesso ao cliente: recusa antes de qualquer gravação", async () => {
    const b = bancoFalso(social({ client_id: OUTRO }), { acesso: false });
    await expect(arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" })).rejects.toMatchObject({ status: 403 });
    expect(b.gravacoes).toHaveLength(0);
  });

  it("não reprovado (aprovado, agendado, aguardando): 409 e nada gravado", async () => {
    for (const s of ["aprovado", "agendado", "aguardando_cliente"]) {
      const b = bancoFalso(social({ entrega_status: s }));
      await expect(arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" })).rejects.toMatchObject({ status: 409, codigo: "nao_reprovado" });
      expect(b.gravacoes).toHaveLength(0);
      expect(b.auditoria[0]).toMatchObject({ ok: false, codigo: "nao_reprovado" });
    }
  });

  it("corrida com a aprovação: o UPDATE não casa, relê, vê aprovado e recusa sem gravar", async () => {
    const b = bancoFalso(social(), {
      antesDeGravar: (l, n) => (n === 0 ? { ...l, entrega_status: "aprovado", atualizado_em: "2026-11-24T10:00:09.000Z" } : null),
    });
    await expect(arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" })).rejects.toMatchObject({ codigo: "nao_reprovado" });
    expect(b.atual().entrega_status).toBe("aprovado");
    expect(trabalhoArquivado(b.atual())).toBe(false);
    expect(CHAVE_DO_ARQUIVO_DA_REPROVACAO in (b.atual().direcao as object)).toBe(false);
  });

  it("com o atualizado_em visto pela tela: qualquer mudança no meio é 409 trabalho_mudou", async () => {
    const b = bancoFalso(social({ atualizado_em: "2026-11-24T10:05:00.000Z" }));
    await expect(arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1", esperado_atualizado_em: "2026-11-24T10:00:00.000Z" }))
      .rejects.toMatchObject({ status: 409, codigo: "trabalho_mudou" });
    expect(b.gravacoes).toHaveLength(0);
  });

  it("com o atualizado_em visto: perder a corrida para outra edição também é 409, sem segunda gravação", async () => {
    const b = bancoFalso(social(), {
      antesDeGravar: (l, n) => (n === 0 ? { ...l, legenda: "nova", atualizado_em: "2026-11-24T10:00:09.000Z" } : null),
    });
    await expect(arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1", esperado_atualizado_em: "2026-11-24T10:00:00.000Z" }))
      .rejects.toMatchObject({ codigo: "trabalho_mudou" });
    expect(b.gravacoes).toHaveLength(1);
  });

  it("sem atualizado_em visto (MCP): outra edição no meio, ainda reprovado, relê e grava por cima do novo", async () => {
    const b = bancoFalso(social(), {
      antesDeGravar: (l, n) => (n === 0 ? { ...l, legenda: "nova", atualizado_em: "2026-11-24T10:00:09.000Z" } : null),
    });
    const r = await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" });
    expect(r.arquivado).toBe(true);
    expect(b.gravacoes).toHaveLength(2);
    expect(b.atual().legenda).toBe("nova");
  });

  it("corrida sem fim: desiste com conflito_de_gravacao", async () => {
    let n = 0;
    const b = bancoFalso(social(), { antesDeGravar: (l) => ({ ...l, atualizado_em: `2026-11-24T11:00:0${++n}.000Z` }) });
    await expect(arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" })).rejects.toMatchObject({ codigo: "conflito_de_gravacao" });
    expect(trabalhoArquivado(b.atual())).toBe(false);
  });

  it("arte rápida reprovada arquivada antes pelo rapida_arquivar: reconhece e desarquiva pelo mesmo marcador", async () => {
    const t = rapida();
    (t.direcao as Record<string, Record<string, unknown>>).arte_rapida.arquivada_em = "2026-10-01T00:00:00Z";
    const b = bancoFalso(t);
    expect((await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1" })).ja_estava).toBe(true);
    const r = await arquivarTrabalhoReprovado(b.deps, { trabalho_id: ID, por: "u1", desfazer: true });
    expect(r.arquivado).toBe(false);
    expect(arteRapidaDa(b.atual().direcao)?.arquivada_em).toBeNull();
    expect(ehArteRapida(b.atual().direcao)).toBe(true);
  });
});

describe("tela", () => {
  it("corpo da chamada leva o atualizado_em visto e não é o reabrir", () => {
    expect(corpoDoArquivarReprovado({ id: ID, atualizado_em: "2026-11-24T10:00:00Z" })).toEqual({ acao: "reprovado_arquivar", trabalho_id: ID, desfazer: false, esperado_atualizado_em: "2026-11-24T10:00:00Z" });
    expect(corpoDoArquivarReprovado({ id: ID }, true)).toEqual({ acao: "reprovado_arquivar", trabalho_id: ID, desfazer: true });
    expect(corpoDoReabrir(ID)).toEqual({ acao: "reabrir", trabalho_id: ID });
  });

  it("selo do item: reprovada arquivada; sem marcador continua ajuste pedido", () => {
    const t = social({ task_id: "k", cards: [] }) as never;
    expect(situacaoDoItem(t, null, false).rotulo).toBe("ajuste pedido");
    const arquivado = { ...social({ task_id: "k", cards: [] }), direcao: patchDoArquivo(social(), { desfazer: false, agora: "x", por: null }).direcao } as never;
    expect(situacaoDoItem(arquivado, null, false)).toEqual({ rotulo: "reprovada, arquivada", tom: "neutro" });
  });

  const props = (trabalho: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    trabalho: { cards: [], legenda: null, custo_usd: 0, modelo_imagem_id: null, qualidade: null, ...trabalho } as never,
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

  it("reprovada: o botão arquiva; arquivada: desarquiva; sem reprovação ou sem a ação: nada", () => {
    const onArquivarReprovado = vi.fn();
    montar(props(social(), { onArquivarReprovado }));
    fireEvent.click(screen.getByRole("button", { name: /Arquivar reprovada/ }));
    expect(onArquivarReprovado).toHaveBeenCalledWith(false);
    cleanup();

    const arquivado = { ...social(), direcao: patchDoArquivo(social(), { desfazer: false, agora: "x", por: null }).direcao };
    montar(props(arquivado, { onArquivarReprovado }));
    fireEvent.click(screen.getByRole("button", { name: /Desarquivar/ }));
    expect(onArquivarReprovado).toHaveBeenLastCalledWith(true);
    cleanup();

    montar(props(social({ entrega_status: "aprovado", status: "entregue" }), { onArquivarReprovado }));
    expect(screen.queryByRole("button", { name: /Arquivar reprovada/ })).toBeNull();
    cleanup();

    montar(props(social()));
    expect(screen.queryByRole("button", { name: /Arquivar reprovada/ })).toBeNull();
  });

  it("gerando: o botão fica desligado", () => {
    montar(props(social(), { onArquivarReprovado: vi.fn(), ocupado: true }));
    expect((screen.getByRole("button", { name: /Arquivar reprovada/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

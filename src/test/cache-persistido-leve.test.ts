import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { removeOldestQuery, type PersistedClient } from "@tanstack/react-query-persist-client";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, loading: false }) }));

import {
  CHAVE_DO_CACHE,
  ESPERA_ENTRE_GRAVACOES_MS,
  PRAZO_DA_LEITURA_MS,
  __zerarCotaParaTeste,
  criarIdb,
  criarPersister,
  criarQueryClient,
  devePersistir,
  opcoesDePersistencia,
  serializarCache,
  type Idb,
} from "@/lib/mesa/cachePersistido";

/**
 * Cache guardado no navegador sem travar a tela (EX-01, 30/09).
 * Antes: localStorage (teto de ~5 MB) e JSON.stringify do cache inteiro a
 * cada evento do cache (no máximo 1 por segundo); com a cota cheia, um
 * stringify inteiro por consulta tirada. O sino (a cada 30 s) disparava tudo
 * de novo. Agora: IndexedDB, grava só quando algo guardável muda, cada dado é
 * serializado uma vez, e a cota cheia corta de uma vez as mesmas consultas.
 */

type Chave = unknown[];

function texto(n: number, semente: number) {
  let s = "";
  while (s.length < n) s += `Direção de arte ${semente++ % 97} com luz lateral e fundo claro. `;
  return s.slice(0, n);
}

function itensDoMes(total: number, cliente: string) {
  const itens: unknown[] = [];
  let usado = 0;
  for (let k = 0; usado < total; k++) {
    const item = { id: `${cliente}-${k}`, trabalho: { direcao: { texto: texto(20_000, k) }, cards: [{ id: `c${k}`, texto: texto(10_000, k + 1) }] } };
    usado += JSON.stringify(item).length;
    itens.push(item);
  }
  return { itens, roteiros: {}, trabalhos: {} };
}

/** IndexedDB de mentira: guarda na memória e conta as gravações. */
function idbFalso(opcoes: { travarLeitura?: boolean; falharGravacao?: boolean } = {}) {
  const dados: { valor?: string } = {};
  const conta = { gravacoes: 0, apagou: 0 };
  const idb: Idb = {
    ler: () => (opcoes.travarLeitura ? new Promise<string | undefined>(() => undefined) : Promise.resolve(dados.valor)),
    gravar: (t) => {
      conta.gravacoes += 1;
      if (opcoes.falharGravacao) return Promise.reject(new Error("cota"));
      dados.valor = t;
      return Promise.resolve();
    },
    apagar: () => {
      conta.apagou += 1;
      dados.valor = undefined;
      return Promise.resolve();
    },
  };
  return { idb, dados, conta };
}

function montarCliente(qc = criarQueryClient()) {
  qc.setQueryData(["mesa", "itens-do-mes", "c1", "2026-09-01"], { itens: [{ id: "a", titulo: "Post" }], roteiros: {}, trabalhos: {} });
  qc.setQueryData(["clients", "u", "admin"], [{ id: "c1", company_name: "Cliente" }]);
  return qc;
}

beforeEach(() => {
  localStorage.clear();
  __zerarCotaParaTeste();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("o texto gravado é o mesmo de antes", () => {
  it("montado por partes, lê igual a JSON.stringify({ ...cliente, buster })", () => {
    const qc = montarCliente();
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [{ id: "p", estado: "na_fila", n: 1.5, ok: true, nada: null }] });
    const { buster } = opcoesDePersistencia();
    const consultas = qc
      .getQueryCache()
      .getAll()
      .filter(devePersistir)
      .map((q) => ({ state: q.state, queryKey: q.queryKey, queryHash: q.queryHash, dehydratedAt: 123 }));
    const cliente = { buster: "velho", timestamp: 456, clientState: { mutations: [], queries: consultas } } as unknown as PersistedClient;
    const novo = JSON.parse(serializarCache(cliente));
    const antigo = JSON.parse(JSON.stringify({ ...cliente, buster }));
    expect(novo).toEqual(antigo);
  });
});

describe("só grava quando algo guardável muda", () => {
  it("a mesma consulta com o mesmo dado não grava duas vezes; o sino não dispara gravação", async () => {
    vi.useFakeTimers();
    const falso = idbFalso();
    const qc = montarCliente();
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister: criarPersister({ idb: falso.idb }) });
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [] });
    await vi.advanceTimersByTimeAsync(ESPERA_ENTRE_GRAVACOES_MS + 10);
    expect(falso.conta.gravacoes).toBe(1);
    // O sino relê 20 vezes (não vai para o navegador) e a fila volta igual.
    const fila = qc.getQueryData(["mesa", "fila-de-geracao"]);
    for (let i = 0; i < 20; i++) {
      qc.setQueryData(["notifications", "u"], [{ id: `n${i}` }]);
      qc.setQueryData(["mesa", "fila-de-geracao"], fila);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(falso.conta.gravacoes).toBe(1);
    // A fila mudou de verdade: grava de novo, uma vez.
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [{ id: "p1" }] });
    await vi.advanceTimersByTimeAsync(ESPERA_ENTRE_GRAVACOES_MS + 10);
    expect(falso.conta.gravacoes).toBe(2);
    const guardado = JSON.parse(falso.dados.valor as string) as PersistedClient;
    expect(guardado.clientState.queries.map((q) => q.queryKey[1])).toContain("fila-de-geracao");
    expect(guardado.clientState.queries.some((q) => q.queryKey[0] === "notifications")).toBe(false);
    desliga();
  });

  it("aba escondida: a gravação pendente sai na hora", async () => {
    vi.useFakeTimers();
    const falso = idbFalso();
    const qc = montarCliente();
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister: criarPersister({ idb: falso.idb }) });
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [{ id: "x" }] });
    expect(falso.conta.gravacoes).toBe(0);
    window.dispatchEvent(new Event("pagehide"));
    expect(falso.conta.gravacoes).toBe(1);
    desliga();
  });
});

describe("IndexedDB e a reserva no localStorage", () => {
  it("gravou no IndexedDB: o guardado antigo do localStorage sai (libera os 4 a 5 MB)", async () => {
    vi.useFakeTimers();
    localStorage.setItem(CHAVE_DO_CACHE, "{\"antigo\":true}");
    const falso = idbFalso();
    const persister = criarPersister({ idb: falso.idb });
    const qc = montarCliente();
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister });
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [] });
    await vi.advanceTimersByTimeAsync(ESPERA_ENTRE_GRAVACOES_MS + 10);
    expect(falso.conta.gravacoes).toBe(1);
    expect(localStorage.getItem(CHAVE_DO_CACHE)).toBeNull();
    const lido = (await persister.restoreClient()) as PersistedClient;
    expect(lido.clientState.queries.length).toBe(3);
    desliga();
  });

  it("leitura travada devolve vazio dentro do prazo e a sessão segue no localStorage", async () => {
    vi.useFakeTimers();
    const falso = idbFalso({ travarLeitura: true });
    const persister = criarPersister({ idb: falso.idb });
    let lido: unknown = "esperando";
    void Promise.resolve(persister.restoreClient()).then((v) => (lido = v));
    await vi.advanceTimersByTimeAsync(PRAZO_DA_LEITURA_MS - 100);
    expect(lido).toBe("esperando");
    await vi.advanceTimersByTimeAsync(200);
    expect(lido).toBeUndefined();
    const qc = montarCliente();
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister });
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [] });
    await vi.advanceTimersByTimeAsync(ESPERA_ENTRE_GRAVACOES_MS + 10);
    expect(falso.conta.gravacoes).toBe(0);
    expect(localStorage.getItem(CHAVE_DO_CACHE)).toContain("fila-de-geracao");
    desliga();
  });

  it("abertura do IndexedDB que nunca responde (Safari 14): a leitura não prende a tela", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("indexedDB", { open: () => ({}) });
    const idb = criarIdb();
    expect(idb).not.toBeNull();
    const persister = criarPersister({ idb });
    let lido: unknown = "esperando";
    void Promise.resolve(persister.restoreClient()).then((v) => (lido = v));
    await vi.advanceTimersByTimeAsync(PRAZO_DA_LEITURA_MS + 50);
    expect(lido).toBeUndefined();
  });

  it("sem IndexedDB (jsdom, aba anônima antiga): grava e lê no localStorage", async () => {
    vi.useFakeTimers();
    expect(criarIdb()).toBeNull();
    const persister = criarPersister({ idb: criarIdb() });
    const qc = montarCliente();
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister });
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [] });
    await vi.advanceTimersByTimeAsync(ESPERA_ENTRE_GRAVACOES_MS + 10);
    expect(localStorage.getItem(CHAVE_DO_CACHE)).toContain("itens-do-mes");
    const lido = (await persister.restoreClient()) as PersistedClient;
    expect(lido.clientState.queries.length).toBe(3);
    desliga();
  });

  it("IndexedDB que não grava: passa para o localStorage na hora", async () => {
    vi.useFakeTimers();
    const falso = idbFalso({ falharGravacao: true });
    const qc = montarCliente();
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister: criarPersister({ idb: falso.idb }) });
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [] });
    await vi.advanceTimersByTimeAsync(ESPERA_ENTRE_GRAVACOES_MS + 10);
    expect(falso.conta.gravacoes).toBe(1);
    expect(localStorage.getItem(CHAVE_DO_CACHE)).toContain("fila-de-geracao");
    desliga();
  });
});

describe("reserva cheia: corte de uma vez, as mesmas consultas do laço antigo", () => {
  async function consultasGuardadas(persisterDe: () => import("@tanstack/react-query-persist-client").Persister, trocarFila: boolean) {
    const qc = criarQueryClient();
    const chaves: Chave[] = [
      ["mesa", "itens-do-mes", "c1", "2026-09-01"],
      ["mesa", "itens-do-mes", "c2", "2026-09-01"],
      ["mesa", "itens-do-mes", "c3", "2026-09-01"],
    ];
    [3_100_000, 1_900_000, 1_200_000].forEach((t, i) => {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 10, i)));
      qc.setQueryData(chaves[i], itensDoMes(t, `c${i}`));
    });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 11)));
    qc.setQueryData(["clients", "u", "admin"], [{ id: "c1" }]);
    const desliga = persistQueryClientSubscribe({ queryClient: qc, ...opcoesDePersistencia(), persister: persisterDe() });
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [] });
    await vi.advanceTimersByTimeAsync(4000);
    const primeiro = gravar.mock.calls.filter((c) => c[0] === CHAVE_DO_CACHE).length;
    gravar.mockClear();
    if (trocarFila) {
      qc.setQueryData(["mesa", "fila-de-geracao"], { pedidos: [{ id: "novo" }] });
      await vi.advanceTimersByTimeAsync(4000);
    }
    const segundo = gravar.mock.calls.filter((c) => c[0] === CHAVE_DO_CACHE).length;
    const guardado = JSON.parse(localStorage.getItem(CHAVE_DO_CACHE) || "null") as PersistedClient | null;
    desliga();
    gravar.mockRestore();
    return { primeiro, segundo, chaves: guardado ? guardado.clientState.queries.map((q) => JSON.stringify(q.queryKey)).sort() : [] };
  }

  it("guarda as mesmas consultas que o removeOldestQuery; no máximo 2 gravações no 1º ciclo e 1 depois", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const antigo = await consultasGuardadas(
      () => {
        const base = createSyncStoragePersister({ storage: window.localStorage, key: CHAVE_DO_CACHE, throttleTime: 1000, retry: removeOldestQuery });
        return base;
      },
      false,
    );
    localStorage.clear();
    const novo = await consultasGuardadas(() => criarPersister({ idb: null }), true);
    // eslint-disable-next-line no-console
    console.log(`[EX-01] cota cheia: antes ${antigo.primeiro} gravações; agora ${novo.primeiro} no 1º ciclo e ${novo.segundo} no seguinte; guardadas=${novo.chaves.join(" ")}`);
    expect(antigo.chaves.length).toBeGreaterThan(0);
    expect(novo.chaves).toEqual(antigo.chaves);
    expect(novo.primeiro).toBeLessThanOrEqual(2);
    expect(novo.segundo).toBe(1);
  });
});

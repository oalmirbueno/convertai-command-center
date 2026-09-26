import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fila de geração no servidor (frente G, 26/09). Bug do dono: "estou gerando
 * para um cliente, abro outro cliente e, quando volto, ele parou".
 *
 * Fixa: a regra dos passos (fila-de-geracao.ts da estudio-arte) contra um
 * banco de mentira com a mesma semântica da RPC estudio_fila_pegar (teto
 * global, teto por trabalho, só de quem pediu, trava com validade e
 * tentativas); dois clientes em paralelo; retomada depois de queda com teto;
 * nada processado duas vezes; e, na tela, que a fila continua depois de
 * desmontar (o andamento vem do servidor, não do componente).
 */

const mock = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mock.from, rpc: vi.fn(), functions: { invoke: mock.invoke }, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import {
  etapaNaRetomada,
  LIMITES_DA_FILA,
  ordensDoPedido,
  processarUmPasso,
  proximoPasso,
  type DependenciasDaFila,
  type EtapaDaFila,
  type ItemDaFila,
  type ResultadoDoPasso,
} from "../../supabase/functions/estudio-arte/fila-de-geracao";
import {
  andamentoDaFila,
  enfileirarLaminas,
  esquecerSemFila,
  geracoesPorCliente,
  mudancasDaFila,
  normalizarItens,
  precisaDeEmpurrao,
  useFilaDoTrabalho,
  type ItemNaFila,
} from "@/lib/mesa/filaDeGeracao";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------ banco de mentira

type Linha = ItemDaFila & { trava_ate: number | null; proxima_em: number; criado_em: number };

/** Mesma regra da RPC estudio_fila_pegar do G-01 (sem SQL): serve para testar a corrente inteira. */
class BancoDaFila {
  linhas: Linha[] = [];
  relogio = 0;
  versoes: Record<string, number> = {};
  seq = 0;

  pedir(o: { client: string; trabalho: string; ordens: number[]; usuario: string; paralelo?: number; corrigir?: boolean }) {
    const lote = `lote-${++this.seq}`;
    o.ordens.forEach((ordem, i) => {
      if (this.linhas.some((l) => l.trabalho_id === o.trabalho && l.ordem === ordem && (l.status === "fila" || l.status === "rodando"))) return;
      this.linhas.push({
        id: `${o.trabalho}#${ordem}#${++this.seq}`,
        client_id: o.client,
        trabalho_id: o.trabalho,
        ordem,
        lote_id: lote,
        status: "fila",
        etapa: "gerar",
        paralelo: o.paralelo ?? LIMITES_DA_FILA.PARALELO_NORMAL,
        corrigir_sozinho: !!o.corrigir,
        rodadas: 0,
        tentativas: 0,
        max_tentativas: LIMITES_DA_FILA.MAX_TENTATIVAS,
        passos: 0,
        versoes_antes: null,
        trava_token: null,
        custo_usd: 0,
        pedido_por: o.usuario,
        marca_id: null,
        trava_ate: null,
        proxima_em: this.relogio + i,
        criado_em: this.relogio + i,
      });
    });
  }

  rodando() {
    return this.linhas.filter((l) => l.status === "rodando" && (l.trava_ate ?? 0) >= this.relogio);
  }

  pegar(token: string, usuario: string): ItemDaFila | null {
    const agora = this.relogio;
    for (const l of this.linhas) {
      if (l.status === "rodando" && (l.trava_ate ?? 0) < agora && l.tentativas + 1 >= l.max_tentativas) {
        Object.assign(l, { status: "erro", erro_codigo: "tentativas_esgotadas", trava_token: null, trava_ate: null });
      }
    }
    if (this.rodando().length >= LIMITES_DA_FILA.GLOBAL) return null;
    const candidatos = this.linhas
      .filter((f) => f.pedido_por === usuario)
      .filter((f) => (f.status === "fila" && f.proxima_em <= agora) || (f.status === "rodando" && (f.trava_ate ?? 0) < agora))
      .filter((f) => this.rodando().filter((a) => a.trabalho_id === f.trabalho_id).length < f.paralelo)
      .sort((a, b) => a.proxima_em - b.proxima_em || a.criado_em - b.criado_em || a.ordem - b.ordem);
    const r = candidatos[0];
    if (!r) return null;
    if (r.status === "rodando") r.tentativas += 1;
    r.status = "rodando";
    r.trava_token = token;
    r.trava_ate = agora + LIMITES_DA_FILA.TRAVA_SEGUNDOS * 1000;
    return { ...r };
  }

  gravar(item: ItemDaFila, token: string, campos: Record<string, unknown>): boolean {
    const l = this.linhas.find((x) => x.id === item.id);
    if (!l || l.trava_token !== token) return false;
    const c = { ...campos } as Record<string, unknown>;
    if (typeof c.proxima_em === "string") c.proxima_em = Date.parse(c.proxima_em as string);
    Object.assign(l, c);
    return true;
  }

  deps(usuario: string, executar: (etapa: EtapaDaFila, item: ItemDaFila) => Promise<ResultadoDoPasso>): DependenciasDaFila {
    return {
      pegar: async (token) => this.pegar(token, usuario),
      versoes: async (item) => this.versoes[`${item.trabalho_id}#${item.ordem}`] || 0,
      gravar: async (item, token, campos) => this.gravar(item, token, campos),
      executar,
      pararLote: async (item, codigo) => {
        for (const l of this.linhas) if (l.lote_id === item.lote_id && l.status === "fila" && (l.etapa === "gerar" || l.etapa === "fundo")) Object.assign(l, { status: "cancelado", erro_codigo: codigo });
      },
      agora: () => new Date(this.relogio),
    };
  }
}

/** Gerador de mentira: cada "gerar" cria uma versão e custa 0,04; conferir custa 0,01. */
function iaDeMentira(banco: BancoDaFila, chamadas: string[]) {
  return async (etapa: EtapaDaFila, item: ItemDaFila): Promise<ResultadoDoPasso> => {
    chamadas.push(`${etapa}:${item.trabalho_id}#${item.ordem}`);
    if (etapa === "gerar") {
      const k = `${item.trabalho_id}#${item.ordem}`;
      banco.versoes[k] = (banco.versoes[k] || 0) + 1;
      return { ok: true, corpo: { custo_usd: 0.04 } };
    }
    return { ok: true, corpo: { custo_usd: 0.01, autocorrecao: { precisa: false } } };
  };
}

const item = (extra: Partial<ItemDaFila> = {}): ItemDaFila => ({
  id: "i1", client_id: "c1", trabalho_id: "t1", ordem: 1, lote_id: "l1", status: "rodando", etapa: "gerar", paralelo: 2,
  corrigir_sozinho: false, rodadas: 0, tentativas: 0, max_tentativas: 3, passos: 0, versoes_antes: 0, trava_token: "k",
  custo_usd: 0, pedido_por: "u1", marca_id: null, ...extra,
});

const agora = new Date("2026-09-26T12:00:00Z");

// ------------------------------------------------------------ regra dos passos

describe("regra dos passos (fila-de-geracao.ts)", () => {
  it("gerar ok segue para conferir, soma o custo e solta a trava", () => {
    const { mudanca } = proximoPasso(item(), "gerar", { ok: true, corpo: { custo_usd: 0.04 } }, agora);
    expect(mudanca).toMatchObject({ status: "fila", etapa: "conferir", custo_usd: 0.04, trava_token: null, passos: 1 });
  });

  it("conferir ok termina; com erro achado e Corrigir sozinho, UMA correção só", () => {
    expect(proximoPasso(item({ etapa: "conferir" }), "conferir", { ok: true, corpo: { autocorrecao: { precisa: false } } }, agora).mudanca.status).toBe("feito");
    const achou = { ok: true as const, corpo: { autocorrecao: { precisa: true } } };
    expect(proximoPasso(item({ etapa: "conferir" }), "conferir", achou, agora).mudanca).toMatchObject({ status: "feito", aviso: expect.any(String) });
    expect(proximoPasso(item({ etapa: "conferir", corrigir_sozinho: true }), "conferir", achou, agora).mudanca.etapa).toBe("corrigir");
    const depois = proximoPasso(item({ etapa: "corrigir", corrigir_sozinho: true }), "corrigir", { ok: true, corpo: { corrigido: true } }, agora).mudanca;
    expect(depois).toMatchObject({ etapa: "conferir", rodadas: 1 });
    // Já corrigiu uma vez: a segunda conferência com erro fecha, sem laço.
    expect(proximoPasso(item({ etapa: "conferir", corrigir_sozinho: true, rodadas: 1 }), "conferir", achou, agora).mudanca.status).toBe("feito");
  });

  it("contínuo: fundo pendente prepara o fundo; fundo ocupado espera 20 s sem gastar tentativa", () => {
    expect(proximoPasso(item(), "gerar", { ok: false, codigo: "fundo_pendente", mensagem: "" }, agora).mudanca.etapa).toBe("fundo");
    const espera = proximoPasso(item({ etapa: "fundo" }), "fundo", { ok: false, codigo: "fundo_em_andamento", mensagem: "" }, agora).mudanca;
    expect(espera).toMatchObject({ status: "fila", etapa: "fundo", tentativas: 0 });
    expect(Date.parse(espera.proxima_em) - agora.getTime()).toBe(LIMITES_DA_FILA.ESPERA_DO_FUNDO_S * 1000);
    expect(proximoPasso(item({ etapa: "fundo" }), "fundo", { ok: true, corpo: { pendente: false } }, agora).mudanca.etapa).toBe("gerar");
  });

  it("sem saldo para o lote inteiro; erro depois da IA não repete (repetir cobraria de novo)", () => {
    const saldo = proximoPasso(item(), "gerar", { ok: false, codigo: "saldo_insuficiente", mensagem: "sem saldo" }, agora);
    expect(saldo.mudanca.status).toBe("erro");
    expect(saldo.pararLote).toBe("saldo_insuficiente");
    const interno = proximoPasso(item(), "gerar", { ok: false, codigo: "erro_interno", mensagem: "x" }, agora);
    expect(interno.mudanca.status).toBe("erro");
    expect(interno.pararLote).toBeNull();
  });

  it("falha de leitura repete com espera crescente e teto de tentativas", () => {
    const r1 = proximoPasso(item(), "gerar", { ok: false, codigo: "trabalho_indisponivel", mensagem: "" }, agora).mudanca;
    expect(r1).toMatchObject({ status: "fila", tentativas: 1 });
    expect(Date.parse(r1.proxima_em) - agora.getTime()).toBe(30_000);
    const r2 = proximoPasso(item({ tentativas: 2 }), "gerar", { ok: false, codigo: "trabalho_indisponivel", mensagem: "" }, agora).mudanca;
    expect(r2.status).toBe("erro");
  });

  it("conferência que falha não derruba a lâmina já gerada e cobrada", () => {
    const m = proximoPasso(item({ etapa: "conferir" }), "conferir", { ok: false, codigo: "jev_indisponivel", mensagem: "" }, agora).mudanca;
    expect(m).toMatchObject({ status: "feito", aviso: expect.stringContaining("conferência") });
  });

  it("teto de passos: o fundo esperando para sempre vira erro registrado", () => {
    const m = proximoPasso(item({ etapa: "fundo", passos: LIMITES_DA_FILA.MAX_PASSOS - 1 }), "fundo", { ok: false, codigo: "fundo_em_andamento", mensagem: "" }, agora).mudanca;
    expect(m).toMatchObject({ status: "erro", erro_codigo: "passos_esgotados" });
  });

  it("ordens do pedido: só as da direção, sem repetir, na ordem pedida", () => {
    expect(ordensDoPedido([3, "1", 3, 9, 1.5, null, 2], [1, 2, 3])).toEqual([3, 1, 2]);
    expect(ordensDoPedido("1,2", [1, 2])).toEqual([]);
  });
});

// ------------------------------------------------------------ corrente inteira

/** Roda a corrente como a função faz: cada passo termina e chama o próximo; o relógio anda. */
async function rodarAteAcabar(banco: BancoDaFila, deps: DependenciasDaFila, limite = 200) {
  let maxRodando = 0;
  for (let volta = 0; volta < limite; volta++) {
    // Até o teto global ao mesmo tempo: pega vários, depois grava todos.
    const pegos: Array<Promise<unknown>> = [];
    for (let i = 0; i < LIMITES_DA_FILA.GLOBAL + 2; i++) {
      const p = processarUmPasso(deps, `tok-${volta}-${i}`);
      pegos.push(p);
    }
    maxRodando = Math.max(maxRodando, banco.rodando().length);
    const r = await Promise.all(pegos);
    banco.relogio += 1000;
    if (r.every((x) => x === null) && !banco.linhas.some((l) => l.status === "fila" || l.status === "rodando")) break;
  }
  return maxRodando;
}

describe("fila no servidor: vários clientes, retomada e trava", () => {
  it("dois clientes em paralelo: as duas filas andam juntas e terminam, dentro do teto global", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1, 2, 3, 4], usuario: "u1" });
    banco.pedir({ client: "B", trabalho: "TB", ordens: [1, 2, 3], usuario: "u1" });
    const deps = banco.deps("u1", iaDeMentira(banco, chamadas));

    // Primeira volta: já pega lâminas dos dois clientes (2 de A pelo teto do trabalho, 1 de B pelo global).
    const primeiros = await Promise.all([0, 1, 2, 3].map((i) => processarUmPasso(deps, `p${i}`)));
    const clientesNaPrimeira = new Set(primeiros.filter(Boolean).map((p) => (p as { item: ItemDaFila }).item.client_id));
    expect(clientesNaPrimeira).toEqual(new Set(["A", "B"]));

    const maxRodando = await rodarAteAcabar(banco, deps);
    expect(maxRodando).toBeLessThanOrEqual(LIMITES_DA_FILA.GLOBAL);
    expect(banco.linhas.every((l) => l.status === "feito")).toBe(true);
    // Cada lâmina gerada UMA vez e conferida UMA vez.
    expect(chamadas.filter((c) => c.indexOf("gerar:") === 0).sort()).toEqual(["gerar:TA#1", "gerar:TA#2", "gerar:TA#3", "gerar:TA#4", "gerar:TB#1", "gerar:TB#2", "gerar:TB#3"]);
    expect(chamadas.filter((c) => c.indexOf("conferir:") === 0)).toHaveLength(7);
    // Custo por lâmina, como antes (0,04 gerar + 0,01 conferir).
    for (const l of banco.linhas) expect(l.custo_usd).toBeCloseTo(0.05);
  });

  it("contínuo: uma lâmina de cada vez no mesmo trabalho, na ordem", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "A", trabalho: "TC", ordens: [1, 2, 3], usuario: "u1", paralelo: 1 });
    const deps = banco.deps("u1", iaDeMentira(banco, chamadas));
    const r = await Promise.all([processarUmPasso(deps, "a"), processarUmPasso(deps, "b")]);
    expect(r.filter(Boolean)).toHaveLength(1);
    await rodarAteAcabar(banco, deps);
    expect(chamadas.filter((c) => c.indexOf("gerar:") === 0)).toEqual(["gerar:TC#1", "gerar:TC#2", "gerar:TC#3"]);
  });

  it("só processa o que a própria pessoa pediu (o passo roda com o login dela)", async () => {
    const banco = new BancoDaFila();
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    const deps = banco.deps("u2", iaDeMentira(banco, []));
    expect(await processarUmPasso(deps, "x")).toBeNull();
  });

  it("não processa duas vezes: a mesma lâmina não é pega por dois ao mesmo tempo e o passo velho não grava", async () => {
    const banco = new BancoDaFila();
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" }); // pedido repetido não entra
    expect(banco.linhas).toHaveLength(1);
    const a = banco.pegar("tok-a", "u1");
    const b = banco.pegar("tok-b", "u1");
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    // Trava venceu (worker caiu) e outro pegou: o passo velho não consegue gravar por cima.
    banco.relogio += (LIMITES_DA_FILA.TRAVA_SEGUNDOS + 1) * 1000;
    const c = banco.pegar("tok-c", "u1");
    expect(c && c.tentativas).toBe(1);
    expect(banco.gravar(a as ItemDaFila, "tok-a", { status: "feito" })).toBe(false);
    expect(banco.gravar(c as ItemDaFila, "tok-c", { status: "feito" })).toBe(true);
  });

  it("retomada depois de queda: com teto de tentativas e sem gerar (e cobrar) de novo o que já saiu", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    // Queda 1: o gerar terminou (versão nova) mas o worker caiu antes de gravar.
    const p1 = banco.pegar("t1", "u1") as ItemDaFila;
    banco.gravar(p1, "t1", { versoes_antes: 0 });
    banco.versoes["TA#1"] = 1;
    banco.relogio += (LIMITES_DA_FILA.TRAVA_SEGUNDOS + 1) * 1000;
    const deps = banco.deps("u1", iaDeMentira(banco, chamadas));
    const r = await processarUmPasso(deps, "t2");
    expect(r && r.etapa).toBe("conferir");
    expect(chamadas).toEqual(["conferir:TA#1"]);
    expect(banco.linhas[0].status).toBe("feito");
  });

  it("queda repetida vira erro registrado depois de 3 tentativas (sem laço)", () => {
    const banco = new BancoDaFila();
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    let pegadas = 0;
    for (let i = 0; i < 10; i++) {
      if (banco.pegar(`q${i}`, "u1")) pegadas++;
      banco.relogio += (LIMITES_DA_FILA.TRAVA_SEGUNDOS + 1) * 1000;
    }
    expect(pegadas).toBe(LIMITES_DA_FILA.MAX_TENTATIVAS);
    expect(banco.linhas[0]).toMatchObject({ status: "erro", erro_codigo: "tentativas_esgotadas" });
  });

  it("etapaNaRetomada só pula o gerar quando a versão nova apareceu depois da queda", () => {
    expect(etapaNaRetomada(item({ tentativas: 1, versoes_antes: 2 }), 3)).toBe("conferir");
    expect(etapaNaRetomada(item({ tentativas: 1, versoes_antes: 2 }), 2)).toBe("gerar");
    expect(etapaNaRetomada(item({ tentativas: 0, versoes_antes: 2 }), 3)).toBe("gerar");
  });

  it("sem saldo: o resto do lote sai da fila junto", async () => {
    const banco = new BancoDaFila();
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1, 2, 3], usuario: "u1", paralelo: 1 });
    const deps = banco.deps("u1", async () => ({ ok: false, codigo: "saldo_insuficiente", mensagem: "sem saldo" }));
    await processarUmPasso(deps, "s");
    expect(banco.linhas.map((l) => l.status)).toEqual(["erro", "cancelado", "cancelado"]);
  });
});

// ------------------------------------------------------------ tela

const linhaDaTela = (extra: Partial<ItemNaFila> & { id: string; ordem: number }): ItemNaFila => ({
  client_id: "A", trabalho_id: "TA", lote_id: "l", status: "fila", etapa: "gerar", rodadas: 0, tentativas: 0, custo_usd: 0,
  pedido_por: "u1", proxima_em: "2026-09-26T12:00:00Z", trava_ate: null, criado_em: "2026-09-26T12:00:00Z",
  iniciado_em: null, concluido_em: null, erro_codigo: null, erro_mensagem: null, aviso: null, ...extra,
});

describe("andamento lido do servidor", () => {
  it("vira o mesmo indicador da prancheta (fila, gerando, conferindo)", () => {
    const a = andamentoDaFila([
      linhaDaTela({ id: "1", ordem: 1, status: "rodando", iniciado_em: "2026-09-26T12:00:05Z" }),
      linhaDaTela({ id: "2", ordem: 2 }),
      linhaDaTela({ id: "3", ordem: 3, status: "fila", etapa: "conferir", iniciado_em: "2026-09-26T12:00:05Z" }),
      linhaDaTela({ id: "4", ordem: 4, status: "feito" }),
    ]);
    expect(a[1].etapa).toBe("gerando");
    expect(a[2].etapa).toBe("fila");
    expect(a[3].etapa).toBe("conferindo");
    expect(a[4]).toBeUndefined();
  });

  it("mudanças: lâmina pronta avança; erro avisa; primeira leitura só avisa erro recente", () => {
    const antes = [linhaDaTela({ id: "1", ordem: 1, status: "rodando" }), linhaDaTela({ id: "2", ordem: 2, status: "rodando" })];
    const depois = [
      linhaDaTela({ id: "1", ordem: 1, status: "fila", etapa: "conferir" }),
      linhaDaTela({ id: "2", ordem: 2, status: "erro", concluido_em: new Date().toISOString() }),
    ];
    expect(mudancasDaFila(antes, depois).map((m) => m.tipo)).toEqual(["avancou", "falhou"]);
    expect(mudancasDaFila(null, depois).map((m) => m.tipo)).toEqual(["falhou"]);
    expect(mudancasDaFila(null, [linhaDaTela({ id: "3", ordem: 3, status: "erro", concluido_em: "2026-01-01T00:00:00Z" })])).toEqual([]);
  });

  it("vigia: só empurra o passo parado de quem está logado", () => {
    const agoraMs = Date.parse("2026-09-26T12:10:00Z");
    const parada = linhaDaTela({ id: "1", ordem: 1, proxima_em: "2026-09-26T12:00:00Z" });
    expect(precisaDeEmpurrao([parada], "u1", agoraMs)).toBe(true);
    expect(precisaDeEmpurrao([parada], "u2", agoraMs)).toBe(false);
    expect(precisaDeEmpurrao([linhaDaTela({ id: "2", ordem: 1, proxima_em: "2026-09-26T12:09:50Z" })], "u1", agoraMs)).toBe(false);
    expect(precisaDeEmpurrao([linhaDaTela({ id: "3", ordem: 1, status: "rodando", trava_ate: "2026-09-26T12:15:00Z" })], "u1", agoraMs)).toBe(false);
    expect(precisaDeEmpurrao([linhaDaTela({ id: "4", ordem: 1, status: "rodando", trava_ate: "2026-09-26T12:05:00Z" })], "u1", agoraMs)).toBe(true);
  });

  it("Gerando em N clientes: um por cliente, com o link de volta ao trabalho", () => {
    const g = geracoesPorCliente(
      [
        linhaDaTela({ id: "1", ordem: 1, client_id: "A", trabalho_id: "TA", status: "rodando" }),
        linhaDaTela({ id: "2", ordem: 2, client_id: "A", trabalho_id: "TA" }),
        linhaDaTela({ id: "3", ordem: 1, client_id: "B", trabalho_id: "TB" }),
        linhaDaTela({ id: "4", ordem: 1, client_id: "C", trabalho_id: "TC", status: "feito" }),
      ],
      { A: "Padaria", B: "Ótica" },
      { TA: { task_id: "k1", tipo: "social" }, TB: { task_id: null, tipo: "ads" } },
    );
    expect(g).toEqual([
      { client_id: "A", nome: "Padaria", laminas: 2, gerando: 1, link: "/mesa?client=A&aba=estudio&task=k1" },
      { client_id: "B", nome: "Ótica", laminas: 1, gerando: 0, link: "/mesa-ads?client=B&etapa=estudio" },
    ]);
  });
});

/** Tabela estudio_fila de mentira no supabase-js (select encadeado). */
function tabelaDaFila(linhas: () => unknown[]) {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "in", "order"]) cadeia[m] = () => cadeia;
  cadeia.limit = () => Promise.resolve({ data: linhas(), error: null });
  return cadeia;
}

function Prancheta({ trabalhoId }: { trabalhoId: string }) {
  const fila = useFilaDoTrabalho(trabalhoId);
  const ordens = Object.keys(fila.andamento);
  return <p>{ordens.length ? ordens.map((o) => `${o}:${fila.andamento[Number(o)].etapa}`).join(" ") : "livre"}</p>;
}

describe("a fila continua depois de desmontar a tela", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    esquecerSemFila();
  });

  it("desmontar não cancela nada; montar de novo mostra o que andou no servidor", async () => {
    let servidor: unknown[] = [
      { id: "1", client_id: "A", trabalho_id: "TA", ordem: 1, lote_id: "l", status: "rodando", etapa: "gerar", criado_em: "2026-09-26T12:00:00Z", iniciado_em: "2026-09-26T12:00:01Z" },
      { id: "2", client_id: "A", trabalho_id: "TA", ordem: 2, lote_id: "l", status: "fila", etapa: "gerar", criado_em: "2026-09-26T12:00:00Z" },
    ];
    mock.from.mockImplementation((t: string) => (t === "estudio_fila" ? tabelaDaFila(() => servidor) : tabelaDaFila(() => [])));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const vista = render(<QueryClientProvider client={qc}><Prancheta trabalhoId="TA" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("1:gerando 2:fila")).toBeTruthy());

    // Tela cheia / outro card / outro cliente: a tela some.
    vista.unmount();
    expect(mock.invoke).not.toHaveBeenCalled();

    // Enquanto isso o servidor andou: a 1 está conferindo, a 2 gerando.
    servidor = [
      { ...(servidor[0] as object), status: "fila", etapa: "conferir" },
      { ...(servidor[1] as object), status: "rodando", iniciado_em: "2026-09-26T12:02:00Z" },
    ];
    await act(async () => { await qc.invalidateQueries(); });
    const volta = render(<QueryClientProvider client={qc}><Prancheta trabalhoId="TA" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("1:conferindo 2:gerando")).toBeTruthy());
    volta.unmount();
  });

  it("sem a fila no ar, enfileirar devolve null e a tela gera do jeito antigo (degradado)", async () => {
    mock.invoke.mockResolvedValue({ data: { error: "acao_desconhecida" }, error: null });
    expect(await enfileirarLaminas("TA", [1], false)).toBeNull();
    // Não pergunta de novo a cada lâmina.
    expect(await enfileirarLaminas("TA", [2], false)).toBeNull();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });

  it("com a fila no ar, enfileirar devolve os itens e não gera na tela", async () => {
    mock.invoke.mockResolvedValue({ data: { lote_id: "l", itens: [{ id: "1", trabalho_id: "TA", ordem: 1, status: "fila" }], ja_na_fila: [] }, error: null });
    const r = await enfileirarLaminas("TA", [1], false);
    expect(r && r.itens.map((i) => i.ordem)).toEqual([1]);
    expect(mock.invoke).toHaveBeenCalledWith("estudio-arte", expect.objectContaining({ body: expect.objectContaining({ acao: "enfileirar", ordens: [1] }) }));
  });

  it("normaliza linhas tortas sem quebrar", () => {
    expect(normalizarItens([null, { id: 1 }, { id: "a", trabalho_id: "t", ordem: "2", custo_usd: "0.05" }]).map((i) => [i.ordem, i.custo_usd])).toEqual([[2, 0.05]]);
  });
});

describe("ligações na tela", () => {
  it("Estúdio e arte do criativo geram pela fila primeiro, com o caminho antigo de reserva", () => {
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toContain("const naFila = await fila.enfileirar(ordens, corrigirSozinho);");
    expect(estudio).toContain("const naFila = await fila.enfileirar([ordem], corrigirSozinho);");
    expect(estudio).toContain("const andamento: Record<number, AndamentoDaLamina> = { ...fila.andamento, ...andamentoLocal };");
    const ads = ler("src/components/mesa-ads/ArteDoCriativo.tsx");
    expect(ads).toContain("const naFila = await filaDoServidor.enfileirar(ordens, corrigirSozinho);");
    expect(ler("src/components/AppLayout.tsx")).toContain("<IndicadorDeGeracoes userId={user?.id} />");
  });

  it("a função: enfileirar responde na hora; o passo roda em segundo plano com o login de quem pediu", () => {
    const f = ler("supabase/functions/estudio-arte/index.ts");
    expect(f).toContain("  enfileirar,\n  cancelar_fila: cancelarFila,\n  processar_fila: processarFila,");
    expect(f).toContain("if (!emSegundoPlano(passo)) await passo;");
    expect(f).toContain("Authorization: `Bearer ${token}`");
    // A conferência de acesso ao cliente continua em todo passo (nada de pular).
    expect(f).toContain('const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });');
    expect(f).not.toMatch(/ACOES_LONGAS = new Set\([^)]*processar_fila/);
  });
});

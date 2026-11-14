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
  assentarLotesEncerrados,
  AVISO_ESPERANDO_A_CAPA,
  capaLiberouAsOutras,
  decidirPreso,
  esperaDoChute,
  etapaNaRetomada,
  LIMITES_DA_FILA,
  ordensDoPedido,
  processarUmPasso,
  proximoPasso,
  statusDoTrabalhoEmProducao,
  vigiarFila,
  type ArteDaLamina,
  type DependenciasDaFila,
  type DependenciasDaVigia,
  type DependenciasDoAssento,
  type EtapaDaFila,
  type ItemDaFila,
  type ItemPreso,
  type ResultadoDoPasso,
} from "../../supabase/functions/estudio-arte/fila-de-geracao";
import {
  concluirPedido,
  LIMITES_DO_SEGUNDO_PLANO,
  novoPedido,
  pedeSegundoPlano,
  pedidoVivo as pedidoVivoNoServidor,
  pulsarPedido,
  registrarPedido,
  type PedidosDoTrabalho,
} from "../../supabase/functions/estudio-arte/segundo-plano";
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
import {
  andamentoDosPedidos,
  AVISO_DA_ARTE_RECUPERADA,
  chamarEmSegundoPlano,
  pedidosDaDirecao,
  SEM_PULSO_MS,
  type DependenciasDoAcompanhamento,
  type PedidosNaTela,
} from "@/lib/mesa/segundoPlano";
import { desdeDaEtapa, progressoQueSoAvanca, RETOMADA_MS } from "@/components/mesa/andamentoEstavel";
import { gerandoDeVerdade, situacaoDoTrabalho } from "@/components/mesa-ads/loteDoEstudio";
import { ErroDaMesa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------ banco de mentira

type Linha = ItemDaFila & {
  trava_ate: number | null;
  proxima_em: number;
  criado_em: number;
  atualizado_em: number;
  aviso?: string | null;
  erro_codigo?: string | null;
  /** Relógio do banco (a RPC) ou ISO (a mudança que o passo grava). */
  concluido_em?: number | string | null;
};

const DOZE_HORAS_MS = 12 * 60 * 60 * 1000;

/** Mesma regra da RPC estudio_fila_pegar do G-01 (sem SQL): serve para testar a corrente inteira. */
class BancoDaFila {
  linhas: Linha[] = [];
  relogio = 0;
  versoes: Record<string, number> = {};
  /** Hora (relógio do banco) em que a versão mais nova de cada lâmina foi gravada. */
  versoesEm: Record<string, number> = {};
  /** Status do trabalho e as lâminas da direção dele (só o que o assento do fim do lote lê). */
  trabalhos: Record<string, { status: string; direcao: number[] }> = {};
  seq = 0;

  /** A arte da lâmina foi gravada no trabalho agora (o que o gerar faz antes de fechar o passo). */
  gravarArte(trabalho: string, ordem: number) {
    const k = `${trabalho}#${ordem}`;
    this.versoes[k] = (this.versoes[k] || 0) + 1;
    this.versoesEm[k] = this.relogio;
  }

  /** A vigia do servidor (chave de serviço): vê as linhas "rodando" de TODAS as pessoas. */
  vigia(lerArte = true): DependenciasDaVigia {
    return {
      presos: async () => this.linhas.filter((l) => l.status === "rodando").map((l): ItemPreso => ({
        ...l,
        trava_ate: l.trava_ate === null ? null : new Date(l.trava_ate).toISOString(),
        atualizado_em: new Date(l.atualizado_em).toISOString(),
      })),
      arte: async (item): Promise<ArteDaLamina | null> => {
        if (!lerArte) return null;
        const k = `${item.trabalho_id}#${item.ordem}`;
        return { versoes: this.versoes[k] || 0, ultima_em: this.versoesEm[k] === undefined ? null : new Date(this.versoesEm[k]).toISOString() };
      },
      aplicar: async (item, campos) => {
        const l = this.linhas.find((x) => x.id === item.id);
        if (!l || l.status !== "rodando" || l.trava_token !== item.trava_token) return false;
        const c = { ...campos } as Record<string, unknown>;
        if (typeof c.proxima_em === "string") c.proxima_em = Date.parse(c.proxima_em as string);
        if (typeof c.atualizado_em === "string") c.atualizado_em = Date.parse(c.atualizado_em as string);
        Object.assign(l, c);
        return true;
      },
      agora: () => new Date(this.relogio),
    };
  }

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
        atualizado_em: this.relogio + i,
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
        Object.assign(l, { status: "erro", erro_codigo: "tentativas_esgotadas", trava_token: null, trava_ate: null, concluido_em: agora });
      }
      // Pedido esquecido na fila por mais de 12 h sai dela. A RPC não devolve de qual trabalho era.
      if (l.status === "fila" && l.criado_em < agora - DOZE_HORAS_MS) {
        Object.assign(l, { status: "cancelado", erro_codigo: "expirou", concluido_em: agora });
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
    r.atualizado_em = agora;
    return { ...r };
  }

  gravar(item: ItemDaFila, token: string, campos: Record<string, unknown>): boolean {
    const l = this.linhas.find((x) => x.id === item.id);
    if (!l || l.trava_token !== token) return false;
    const c = { ...campos } as Record<string, unknown>;
    if (typeof c.proxima_em === "string") c.proxima_em = Date.parse(c.proxima_em as string);
    if (typeof c.atualizado_em === "string") c.atualizado_em = Date.parse(c.atualizado_em as string);
    Object.assign(l, c);
    return true;
  }

  /** O assento do fim do lote, com a mesma guarda do assentarTrabalho da função (só "gerando", só sem linha ativa). */
  assentar(trabalho: string) {
    const t = this.trabalhos[trabalho];
    if (!t || t.status !== "gerando") return;
    if (this.linhas.some((l) => l.trabalho_id === trabalho && (l.status === "fila" || l.status === "rodando"))) return;
    const comArte = t.direcao.filter((ordem) => (this.versoes[`${trabalho}#${ordem}`] || 0) > 0);
    t.status = statusDoTrabalhoEmProducao({ ordensDaDirecao: t.direcao, ordensComArte: comArte, geracaoAtiva: false });
  }

  assento(): DependenciasDoAssento {
    const fechadaEm = (l: Linha) => (typeof l.concluido_em === "string" ? Date.parse(l.concluido_em) : l.concluido_em ?? NaN);
    return {
      encerrados: async (desde) => this.linhas
        .filter((l) => (l.status === "erro" || l.status === "cancelado") && fechadaEm(l) >= Date.parse(desde))
        .sort((a, b) => fechadaEm(b) - fechadaEm(a))
        .map((l) => l.trabalho_id),
      gerando: async (ids) => ids.filter((id) => this.trabalhos[id] && this.trabalhos[id].status === "gerando"),
      assentar: async (id) => this.assentar(id),
      agora: () => new Date(this.relogio),
    };
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
      banco.gravarArte(item.trabalho_id, item.ordem);
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
    // 14/11 (SKC, lâmina 5): a função morreu na PRIMEIRA tentativa depois de gravar a arte. Versão a mais com a
    // contagem do gerar aberto já prova que a arte saiu: não gera (não cobra) de novo, mesmo com tentativas 0.
    expect(etapaNaRetomada(item({ tentativas: 0, versoes_antes: 2 }), 3)).toBe("conferir");
    // Sem gerar aberto (contagem vazia) ou em outra etapa, nada muda.
    expect(etapaNaRetomada(item({ tentativas: 0, versoes_antes: null }), 3)).toBe("gerar");
    expect(etapaNaRetomada(item({ etapa: "fundo", versoes_antes: 2 }), 3)).toBe("fundo");
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
    // 14/11: linha "rodando" de OUTRA pessoa com a trava vencida também pede a chamada (a vigia do servidor limpa
    // o que ficou preso de todo mundo); com a trava viva, ou vencida há instantes, não.
    expect(precisaDeEmpurrao([linhaDaTela({ id: "5", ordem: 1, status: "rodando", trava_ate: "2026-09-26T12:05:00Z" })], "u2", agoraMs)).toBe(true);
    expect(precisaDeEmpurrao([linhaDaTela({ id: "6", ordem: 1, status: "rodando", trava_ate: "2026-09-26T12:09:50Z" })], "u2", agoraMs)).toBe(false);
    expect(precisaDeEmpurrao([linhaDaTela({ id: "7", ordem: 1, status: "rodando", trava_ate: "2026-09-26T12:15:00Z" })], "u2", agoraMs)).toBe(false);
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
    expect(estudio).toContain("const andamento: Record<number, AndamentoDaLamina> = { ...fila.andamento, ...pedidos.andamento, ...andamentoLocal };");
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

// ====================================================================== 14/11/2026
//
// Instabilidade do Estúdio (função morta por "CPU Time exceeded", ajuste que "parava no meio", trabalhos
// presos em "gerando", cronômetro que voltava a zero). Casos reais do diagnóstico:
// - SKC, lâmina 5: arte gravada às 20:45:13Z, "CPU Time exceeded" às 20:45:14Z; a linha ficou "rodando/gerar",
//   tentativas 0, até alguém chamar a fila de novo.
// - Preserva Eco e Verzelo: lote de 5 lâminas numa direção de 7; a fila acabou e o trabalho ficou "gerando".

const TRAVA_MS = LIMITES_DA_FILA.TRAVA_SEGUNDOS * 1000;
const preso = (extra: Partial<ItemPreso> = {}): ItemPreso => ({
  ...item({ versoes_antes: 0 }),
  trava_ate: new Date(agora.getTime() + 60_000).toISOString(),
  atualizado_em: new Date(agora.getTime() - 120_000).toISOString(),
  ...extra,
});
const haSegundos = (s: number) => new Date(agora.getTime() - s * 1000).toISOString();

describe("vigia: o que ficou preso em rodando (função morta por limite de CPU)", () => {
  it("a função morreu depois de gravar a arte, na primeira tentativa: vai para a conferência e NUNCA gera de novo", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "SKC", trabalho: "T", ordens: [5], usuario: "u1" });
    const p = banco.pegar("morto", "u1") as ItemDaFila;
    banco.gravar(p, "morto", { versoes_antes: 0 });
    banco.gravarArte("T", 5); // card-5-v1.png gravado...
    // ...e a função morreu no segundo seguinte: nada fechou o passo. Tentativas 0, etapa gerar, rodando.
    expect(banco.linhas[0]).toMatchObject({ status: "rodando", etapa: "gerar", tentativas: 0, versoes_antes: 0 });

    // Dentro da folga a vigia espera a função viva gravar a linha.
    banco.relogio += 10_000;
    expect(await vigiarFila(banco.vigia())).toEqual([]);

    // Passou a folga e a trava ainda nem venceu (7 min): a vigia já resolve, sem esperar a trava.
    banco.relogio += LIMITES_DA_FILA.GRACA_DA_ARTE_S * 1000;
    expect(banco.relogio).toBeLessThan(TRAVA_MS);
    const feitas = await vigiarFila(banco.vigia());
    expect(feitas.map((f) => f.acao)).toEqual(["conferir"]);
    expect(banco.linhas[0]).toMatchObject({ status: "fila", etapa: "conferir", tentativas: 0, trava_token: null, versoes_antes: null });

    // A corrente segue: só a conferência roda. Nenhum gerar (nenhuma cobrança) a mais.
    const deps = banco.deps("u1", iaDeMentira(banco, chamadas));
    await rodarAteAcabar(banco, deps);
    expect(chamadas).toEqual(["conferir:T#5"]);
    expect(banco.versoes["T#5"]).toBe(1);
    expect(banco.linhas[0].status).toBe("feito");
    // O passo morto, se acordasse, não grava por cima.
    expect(banco.gravar(p, "morto", { status: "fila", etapa: "gerar" })).toBe(false);
  });

  it("mesma queda sem a vigia (linha devolvida à fila à mão, tentativas 0): o passo vai para conferir, não gera", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "SKC", trabalho: "T", ordens: [5], usuario: "u1" });
    const p = banco.pegar("morto", "u1") as ItemDaFila;
    banco.gravar(p, "morto", { versoes_antes: 0 });
    banco.gravarArte("T", 5);
    Object.assign(banco.linhas[0], { status: "fila", trava_token: null, trava_ate: null });
    const r = await processarUmPasso(banco.deps("u1", iaDeMentira(banco, chamadas)), "novo");
    expect(r && r.etapa).toBe("conferir");
    expect(chamadas).toEqual(["conferir:T#5"]);
  });

  it("retomada de um gerar aberto sem conseguir ler o trabalho: não gera às cegas, repete com espera", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "A", trabalho: "T", ordens: [1], usuario: "u1" });
    const p = banco.pegar("morto", "u1") as ItemDaFila;
    banco.gravar(p, "morto", { versoes_antes: 0 });
    banco.gravarArte("T", 1); // a arte saiu (e foi cobrada) e a função morreu sem fechar o passo
    banco.relogio += TRAVA_MS + 1000;
    const deps = banco.deps("u1", iaDeMentira(banco, chamadas));
    const semLeitura = { ...deps, versoes: async () => { throw new Error("banco fora do ar"); } };
    const r = await processarUmPasso(semLeitura, "novo");
    expect(chamadas).toEqual([]);
    expect(r && r.mudanca).toMatchObject({ status: "fila", etapa: "gerar", tentativas: 2 });
    // O gerar continua aberto: a contagem de antes dele fica na linha (sem ela, a arte já gravada viraria o ponto de partida).
    expect(r && r.mudanca.versoes_antes).toBe(0);
    expect(banco.linhas[0]).toMatchObject({ status: "fila", etapa: "gerar", versoes_antes: 0, trava_token: null });

    // Tentativa seguinte, com a leitura de volta: a arte já existe, então confere. Nenhum gerar (nenhuma cobrança) a mais.
    banco.relogio = banco.linhas[0].proxima_em;
    const r2 = await processarUmPasso(deps, "novo-2");
    expect(r2 && r2.etapa).toBe("conferir");
    expect(chamadas).toEqual(["conferir:T#1"]);
    expect(banco.versoes["T#1"]).toBe(1);
    expect(banco.linhas[0]).toMatchObject({ status: "feito", versoes_antes: null });
  });

  it("o gerar aberto guarda a contagem enquanto repete no gerar; fechar ou avançar de etapa zera", () => {
    const aberto = item({ versoes_antes: 2 });
    const falha = (codigo: string, extra: Partial<ItemDaFila> = {}) => proximoPasso({ ...aberto, ...extra }, "gerar", { ok: false, codigo, mensagem: "" }, agora).mudanca;
    // Repete no gerar (leitura que falhou, espera da capa): a contagem fica.
    for (const codigo of ["trabalho_indisponivel", "acesso_indisponivel", "arquivo_indisponivel", "capa_pendente"]) {
      expect(falha(codigo)).toMatchObject({ status: "fila", etapa: "gerar", versoes_antes: 2 });
    }
    // Sem contagem (gerar novo), nada é inventado.
    expect(falha("capa_pendente", { versoes_antes: null }).versoes_antes).toBeNull();
    // Avançou de verdade (conferir) ou mudou de etapa (preparar o fundo): zera.
    expect(proximoPasso(aberto, "gerar", { ok: true, corpo: {} }, agora).mudanca).toMatchObject({ etapa: "conferir", versoes_antes: null });
    expect(falha("fundo_pendente")).toMatchObject({ etapa: "fundo", versoes_antes: null });
    // Fechou (erro depois da IA, tentativas no fim, teto de passos): zera.
    expect(falha("erro_interno")).toMatchObject({ status: "erro", versoes_antes: null });
    expect(falha("trabalho_indisponivel", { tentativas: 2 })).toMatchObject({ status: "erro", versoes_antes: null });
    expect(falha("capa_pendente", { passos: LIMITES_DA_FILA.MAX_PASSOS - 1 })).toMatchObject({ status: "erro", versoes_antes: null });
    // Fora do gerar a contagem nunca fica (conferência que repete não carrega nada).
    expect(proximoPasso(item({ etapa: "fundo", versoes_antes: 2 }), "fundo", { ok: false, codigo: "fundo_em_andamento", mensagem: "" }, agora).mudanca.versoes_antes).toBeNull();
  });

  it("gerar aberto que cai na espera da capa: a arte que o passo antigo gravou atrasado não é gerada (nem cobrada) de novo", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "A", trabalho: "T", ordens: [3], usuario: "u1" });
    // Passo lento: abriu o gerar (contagem 0), a trava venceu e ele segue gerando do lado dele.
    const lento = banco.pegar("lento", "u1") as ItemDaFila;
    banco.gravar(lento, "lento", { versoes_antes: 0 });
    banco.relogio += TRAVA_MS + 1000;
    // Retomada: ainda sem arte nova, e a capa do trabalho voltou a gerar. A lâmina espera, com a contagem do gerar aberto.
    const ia = iaDeMentira(banco, chamadas);
    let capaPronta = false;
    const deps = banco.deps("u1", async (etapa, i) => (etapa === "gerar" && !capaPronta ? { ok: false, codigo: "capa_pendente", mensagem: "" } : ia(etapa, i)));
    await processarUmPasso(deps, "t2");
    expect(banco.linhas[0]).toMatchObject({ status: "fila", etapa: "gerar", aviso: AVISO_ESPERANDO_A_CAPA, versoes_antes: 0 });
    // O passo lento termina agora: grava a arte, mas não fecha a linha (a trava já é de outro).
    banco.gravarArte("T", 3);
    expect(banco.gravar(lento, "lento", { status: "fila", etapa: "conferir", versoes_antes: null })).toBe(false);
    // Volta seguinte, com a capa pronta: a arte daquele gerar já existe, então confere. Nenhum gerar a mais.
    capaPronta = true;
    banco.relogio = banco.linhas[0].proxima_em;
    const r = await processarUmPasso(deps, "t3");
    expect(r && r.etapa).toBe("conferir");
    expect(chamadas).toEqual(["conferir:T#3"]);
    expect(banco.versoes["T#3"]).toBe(1);
  });

  it("trava vencida sem arte nova: volta para a fila com a tentativa contada e espera crescente; no teto vira erro", () => {
    const vencida = { trava_ate: haSegundos(5) };
    const r1 = decidirPreso(preso(vencida), { versoes: 0, ultima_em: null }, agora);
    expect(r1 && r1.acao).toBe("repetir");
    expect(r1 && r1.campos).toMatchObject({ status: "fila", tentativas: 1, trava_token: null, trava_ate: null });
    expect(Date.parse(String(r1 && r1.campos.proxima_em)) - agora.getTime()).toBe(30_000);
    const r2 = decidirPreso(preso({ ...vencida, tentativas: 1 }), { versoes: 0, ultima_em: null }, agora);
    expect(Date.parse(String(r2 && r2.campos.proxima_em)) - agora.getTime()).toBe(60_000);
    // Tentativas esgotadas: erro registrado, com mensagem clara, sem gerar de novo.
    const r3 = decidirPreso(preso({ ...vencida, tentativas: 2 }), { versoes: 0, ultima_em: null }, agora);
    expect(r3 && r3.acao).toBe("erro");
    expect(r3 && r3.campos).toMatchObject({ status: "erro", erro_codigo: "tentativas_esgotadas", trava_token: null });
    expect(String(r3 && r3.campos.erro_mensagem)).toContain("nenhuma arte nova foi gravada");
  });

  it("trava vencida na conferência ou na correção: a arte existe, então fecha como feita com aviso (nunca erro, nunca gerar)", () => {
    const vencida = { trava_ate: haSegundos(5), versoes_antes: null };
    expect(decidirPreso(preso({ ...vencida, etapa: "conferir" }), null, agora)).toMatchObject({ acao: "repetir", campos: { status: "fila", tentativas: 1 } });
    const fim = decidirPreso(preso({ ...vencida, etapa: "conferir", tentativas: 2 }), null, agora);
    expect(fim).toMatchObject({ acao: "feito", campos: { status: "feito", aviso: expect.stringContaining("conferência") } });
    expect(decidirPreso(preso({ ...vencida, etapa: "corrigir", tentativas: 2 }), null, agora)).toMatchObject({ acao: "feito" });
  });

  it("abandonada (trava vencida há mais de 30 min, painel fechado): não fica eterna", () => {
    const velha = { trava_ate: haSegundos(LIMITES_DA_FILA.ABANDONO_S + 60) };
    // Sem arte nova: erro registrado.
    expect(decidirPreso(preso(velha), { versoes: 0, ultima_em: null }, agora)).toMatchObject({ acao: "erro", campos: { erro_codigo: "abandonado" } });
    // Com a arte gravada: feita com aviso (ninguém vai conferir), nunca erro e nunca gerar.
    expect(decidirPreso(preso(velha), { versoes: 1, ultima_em: haSegundos(4000) }, agora)).toMatchObject({ acao: "feito", campos: { status: "feito" } });
    // Fundo abandonado também sai.
    expect(decidirPreso(preso({ ...velha, etapa: "fundo", versoes_antes: null }), null, agora)).toMatchObject({ acao: "erro" });
  });

  it("não mexe no passo vivo, nem decide às cegas quando o trabalho não pôde ser lido", () => {
    // Trava válida, sem arte nova: vivo.
    expect(decidirPreso(preso(), { versoes: 0, ultima_em: null }, agora)).toBeNull();
    // Arte acabou de sair (10 s) e a trava é válida: a função viva fecha o passo sozinha.
    expect(decidirPreso(preso(), { versoes: 1, ultima_em: haSegundos(10) }, agora)).toBeNull();
    // Trava vencida num gerar aberto sem leitura do trabalho: espera a próxima volta (não manda gerar de novo).
    expect(decidirPreso(preso({ trava_ate: haSegundos(5) }), null, agora)).toBeNull();
    // Fila, feito e erro não são com a vigia.
    expect(decidirPreso(preso({ status: "fila" }), null, agora)).toBeNull();
  });

  it("a trava vencida de OUTRA pessoa também é limpa (a RPC só olha as de quem chamou)", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    banco.pedir({ client: "B", trabalho: "TB", ordens: [1], usuario: "u1" });
    const a = banco.pegar("morto-a", "u1") as ItemDaFila;
    const b = banco.pegar("morto-b", "u1") as ItemDaFila;
    banco.gravar(a, "morto-a", { versoes_antes: 0 });
    banco.gravar(b, "morto-b", { versoes_antes: 0 });
    banco.gravarArte("TB", 1); // a de B gravou a arte antes de morrer; a de A, não.
    banco.relogio += TRAVA_MS + 1000;

    // Quem chama o processar_fila agora é u2 (outro painel aberto): primeiro a vigia, depois o passo dele.
    const feitas = await vigiarFila(banco.vigia());
    expect(feitas.map((f) => `${f.item.trabalho_id}:${f.acao}`).sort()).toEqual(["TA:repetir", "TB:conferir"]);
    expect(await processarUmPasso(banco.deps("u2", iaDeMentira(banco, chamadas)), "de-u2")).toBeNull();
    expect(chamadas).toEqual([]);
    const [la, lb] = banco.linhas;
    expect(la).toMatchObject({ status: "fila", etapa: "gerar", tentativas: 1, trava_token: null });
    expect(la.proxima_em - banco.relogio).toBe(30_000);
    expect(lb).toMatchObject({ status: "fila", etapa: "conferir", trava_token: null });

    // Quando u1 volta, a corrente dele retoma: A gera UMA vez (não tinha arte), B só confere.
    banco.relogio += 31_000;
    await rodarAteAcabar(banco, banco.deps("u1", iaDeMentira(banco, chamadas)));
    expect(chamadas.filter((c) => c.indexOf("gerar:") === 0)).toEqual(["gerar:TA#1"]);
    expect(chamadas.filter((c) => c.indexOf("conferir:") === 0).sort()).toEqual(["conferir:TA#1", "conferir:TB#1"]);
    expect(banco.linhas.every((l) => l.status === "feito")).toBe(true);
  });

  it("função morrendo sempre: no máximo 3 tentativas pela vigia e depois erro (sem laço, sem painel de quem pediu)", async () => {
    const banco = new BancoDaFila();
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    const acoes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const p = banco.pegar(`q${i}`, "u1");
      if (p) banco.gravar(p, `q${i}`, { versoes_antes: 0 });
      banco.relogio += TRAVA_MS + 1000;
      for (const f of await vigiarFila(banco.vigia())) acoes.push(f.acao);
      banco.relogio += 120_000;
    }
    expect(acoes).toEqual(["repetir", "repetir", "erro"]);
    expect(banco.linhas[0]).toMatchObject({ status: "erro", erro_codigo: "tentativas_esgotadas" });
  });

  it("a vigia perde para o passo vivo que fechou no meio (grava só se a trava ainda é a mesma)", async () => {
    const banco = new BancoDaFila();
    banco.pedir({ client: "A", trabalho: "TA", ordens: [1], usuario: "u1" });
    const p = banco.pegar("vivo", "u1") as ItemDaFila;
    banco.relogio += TRAVA_MS + 1000;
    const deps = banco.vigia();
    const lidos = await deps.presos();
    // Entre a leitura e a gravação da vigia, o passo fechou e outro pegou a linha.
    banco.gravar(p, "vivo", { status: "fila", etapa: "conferir", trava_token: null, trava_ate: null });
    banco.pegar("outro", "u1");
    expect(await deps.aplicar(lidos[0], { status: "erro" })).toBe(false);
    expect(banco.linhas[0]).toMatchObject({ status: "rodando", etapa: "conferir", trava_token: "outro" });
  });
});

describe("espera da capa, novas tentativas e a corrente", () => {
  it("capa_pendente espera 15 s com o motivo gravado e a contagem do gerar aberto; o passo que avança zera a contagem", () => {
    const m = proximoPasso(item({ ordem: 3, versoes_antes: 0 }), "gerar", { ok: false, codigo: "capa_pendente", mensagem: "" }, agora).mudanca;
    expect(m).toMatchObject({ status: "fila", etapa: "gerar", tentativas: 0, aviso: AVISO_ESPERANDO_A_CAPA, versoes_antes: 0 });
    expect(Date.parse(m.proxima_em) - agora.getTime()).toBe(LIMITES_DA_FILA.ESPERA_DA_CAPA_S * 1000);
    // A espera da capa não ganha chute próprio: é a capa que solta as outras ao sair do gerar.
    expect(esperaDoChute(m, agora)).toBeNull();
    expect(proximoPasso(item({ versoes_antes: 0 }), "gerar", { ok: true, corpo: {} }, agora).mudanca.versoes_antes).toBeNull();
  });

  it("a capa que sai do gerar (com arte, com erro ou cancelada) solta quem esperava; as outras lâminas, não", () => {
    const capa = item({ ordem: 1 });
    expect(capaLiberouAsOutras(capa, "gerar", proximoPasso(capa, "gerar", { ok: true, corpo: {} }, agora).mudanca)).toBe(true);
    expect(capaLiberouAsOutras(capa, "gerar", proximoPasso(capa, "gerar", { ok: false, codigo: "erro_interno", mensagem: "" }, agora).mudanca)).toBe(true);
    // Capa que vai repetir (leitura falhou) ou preparar o fundo ainda não saiu do gerar.
    expect(capaLiberouAsOutras(capa, "gerar", proximoPasso(capa, "gerar", { ok: false, codigo: "trabalho_indisponivel", mensagem: "" }, agora).mudanca)).toBe(false);
    expect(capaLiberouAsOutras(capa, "gerar", proximoPasso(capa, "gerar", { ok: false, codigo: "fundo_pendente", mensagem: "" }, agora).mudanca)).toBe(false);
    expect(capaLiberouAsOutras(capa, "conferir", proximoPasso(item({ ordem: 1, etapa: "conferir" }), "conferir", { ok: true, corpo: {} }, agora).mudanca)).toBe(false);
    expect(capaLiberouAsOutras(item({ ordem: 2 }), "gerar", proximoPasso(item({ ordem: 2 }), "gerar", { ok: true, corpo: {} }, agora).mudanca)).toBe(false);
  });

  it("fundo ocupado e nova tentativa ganham um chute na hora certa (a corrente não depende do painel aberto)", () => {
    const fundo = proximoPasso(item({ etapa: "fundo" }), "fundo", { ok: false, codigo: "fundo_em_andamento", mensagem: "" }, agora).mudanca;
    expect(esperaDoChute(fundo, agora)).toBe(LIMITES_DA_FILA.ESPERA_DO_FUNDO_S * 1000);
    const repete = proximoPasso(item(), "gerar", { ok: false, codigo: "trabalho_indisponivel", mensagem: "" }, agora).mudanca;
    expect(repete.aviso).toBe("Nova tentativa (2 de 3)");
    expect(esperaDoChute(repete, agora)).toBe(30_000);
    // Linha fechada ou que anda já: sem chute com espera.
    expect(esperaDoChute(proximoPasso(item(), "gerar", { ok: true, corpo: {} }, agora).mudanca, agora)).toBeNull();
    expect(esperaDoChute(proximoPasso(item({ etapa: "conferir" }), "conferir", { ok: true, corpo: {} }, agora).mudanca, agora)).toBeNull();
  });
});

describe("fim do lote: o trabalho não fica gerando", () => {
  it("5 de 7 com arte e nada mais na fila (Preserva Eco, Verzelo): dirigido; com outra lâmina gerando: gerando; completo: pronto", () => {
    const direcao = [1, 2, 3, 4, 5, 6, 7];
    expect(statusDoTrabalhoEmProducao({ ordensDaDirecao: direcao, ordensComArte: [1, 2, 3, 4, 5], geracaoAtiva: false })).toBe("dirigido");
    expect(statusDoTrabalhoEmProducao({ ordensDaDirecao: direcao, ordensComArte: [1, 2, 3], geracaoAtiva: true })).toBe("gerando");
    expect(statusDoTrabalhoEmProducao({ ordensDaDirecao: direcao, ordensComArte: [1, 1, 2, 3, 4, 5, 6, 7], geracaoAtiva: true })).toBe("pronto");
    // Versão de lâmina que saiu da direção não completa nada.
    expect(statusDoTrabalhoEmProducao({ ordensDaDirecao: [1, 2], ordensComArte: [1, 9], geracaoAtiva: false })).toBe("dirigido");
  });

  it("a última lâmina expira na fila (12 h) sem passar por passo nenhum: o trabalho sai de gerando, sem erro e sem gerar", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    const deps = banco.deps("u1", iaDeMentira(banco, chamadas));
    // T: lâminas 1 e 2 com arte; a 3 ficou esquecida na fila (painel de quem pediu fechado).
    banco.trabalhos.T = { status: "gerando", direcao: [1, 2, 3] };
    banco.gravarArte("T", 1);
    banco.gravarArte("T", 2);
    banco.pedir({ client: "A", trabalho: "T", ordens: [3], usuario: "u9" });
    // Antigo: "gerando" de antes, sem linha nenhuma na fila. Não é com esta regra.
    banco.trabalhos.Antigo = { status: "gerando", direcao: [1, 2] };
    banco.relogio += DOZE_HORAS_MS + 60_000;
    // V: uma lâmina foi parada agora e a outra segue na fila. O lote não acabou.
    banco.trabalhos.V = { status: "gerando", direcao: [1, 2] };
    banco.pedir({ client: "B", trabalho: "V", ordens: [1, 2], usuario: "u9" });
    Object.assign(banco.linhas[1], { status: "cancelado", erro_codigo: "cancelado_pela_equipe", concluido_em: banco.relogio });

    // u1 chama a fila e não tem nada: a pegada expira a linha de T e não devolve nada. Era aqui que T ficava preso.
    expect(await processarUmPasso(deps, "t1")).toBeNull();
    expect(banco.linhas[0]).toMatchObject({ status: "cancelado", erro_codigo: "expirou" });
    expect(await vigiarFila(banco.vigia())).toEqual([]);
    expect(banco.trabalhos.T.status).toBe("gerando");

    // Sem item para pegar, a função confere os lotes encerrados fora do passo.
    expect((await assentarLotesEncerrados(banco.assento())).sort()).toEqual(["T", "V"]);
    expect(banco.trabalhos.T.status).toBe("dirigido");
    // Com linha ainda na fila, o trabalho segue gerando; o antigo fica como está.
    expect(banco.trabalhos.V.status).toBe("gerando");
    expect(banco.trabalhos.Antigo.status).toBe("gerando");
    // Nada foi gerado, e a linha expirada não virou outra coisa.
    expect(chamadas).toEqual([]);
    expect(banco.versoes["T#3"]).toBeUndefined();
    expect(banco.linhas[0]).toMatchObject({ status: "cancelado", erro_codigo: "expirou" });
    // De novo: nada a fazer com T (já assentado).
    expect(await assentarLotesEncerrados(banco.assento())).toEqual(["V"]);
  });

  it("a RPC fecha a linha com as tentativas no fim: o trabalho também sai de gerando; com todas as lâminas, pronto", async () => {
    const banco = new BancoDaFila();
    const chamadas: string[] = [];
    banco.trabalhos.T = { status: "gerando", direcao: [1, 2] };
    banco.gravarArte("T", 1);
    banco.pedir({ client: "A", trabalho: "T", ordens: [2], usuario: "u9" });
    const p = banco.pegar("morto", "u9") as ItemDaFila;
    // A arte saiu, a função morreu, e a linha gastou as tentativas sem ninguém conseguir ler o trabalho.
    banco.gravar(p, "morto", { versoes_antes: 0, tentativas: 2 });
    banco.gravarArte("T", 2);
    banco.relogio += TRAVA_MS + 1000;
    expect(await vigiarFila(banco.vigia(false))).toEqual([]);
    expect(await processarUmPasso(banco.deps("u1", iaDeMentira(banco, chamadas)), "t1")).toBeNull();
    expect(banco.linhas[0]).toMatchObject({ status: "erro", erro_codigo: "tentativas_esgotadas" });
    expect(await assentarLotesEncerrados(banco.assento())).toEqual(["T"]);
    // O status vem das lâminas com arte, não do erro da linha.
    expect(banco.trabalhos.T.status).toBe("pronto");
    expect(chamadas).toEqual([]);
  });

  it("lote encerrado fora do passo: só dentro da janela, sem repetir trabalho, e a falha de um não para os outros", async () => {
    const lidos: string[][] = [];
    const assentados: string[] = [];
    const deps = (encerrados: string[], gerando: string[]): DependenciasDoAssento => ({
      encerrados: async (desde) => {
        expect(agora.getTime() - Date.parse(desde)).toBe(LIMITES_DA_FILA.JANELA_DO_ASSENTO_S * 1000);
        return encerrados;
      },
      gerando: async (ids) => (lidos.push(ids), gerando),
      assentar: async (id) => {
        if (id === "quebra") throw new Error("banco fora do ar");
        assentados.push(id);
      },
      agora: () => agora,
    });
    // Nenhuma linha fechada na janela: não lê trabalho nenhum.
    expect(await assentarLotesEncerrados(deps([], ["x"]))).toEqual([]);
    expect(lidos).toEqual([]);
    expect(await assentarLotesEncerrados(deps(["a", "quebra", "a", "", "b", "c"], ["c", "quebra", "a", "fora"]))).toEqual(["a", "quebra", "c"]);
    expect(lidos).toEqual([["a", "quebra", "b", "c"]]);
    expect(assentados).toEqual(["a", "c"]);
    // Teto por volta.
    const muitos = Array.from({ length: LIMITES_DA_FILA.MAX_ASSENTOS + 30 }, (_, i) => `t${i}`);
    expect(await assentarLotesEncerrados(deps(muitos, muitos))).toHaveLength(LIMITES_DA_FILA.MAX_ASSENTOS);
  });

  it("Mesa Ads: status gerando antigo, sem gravação recente, não aparece como geração ativa", () => {
    const agoraMs = Date.parse("2026-11-14T21:00:00Z");
    const base = { id: "t", direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] }, cards: [{ ordem: 1, versao: 1, storage_path: "a" }] };
    const com = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as Parameters<typeof situacaoDoTrabalho>[0];
    // Verzelo em 14/11: "gerando" desde 19:43:43Z, fila feita. Às 21:00 não é geração em andamento.
    expect(gerandoDeVerdade({ status: "gerando", atualizado_em: "2026-11-14T19:43:43Z" }, agoraMs)).toBe(false);
    expect(situacaoDoTrabalho(com({ status: "gerando", atualizado_em: "2026-11-14T19:43:43Z" }), null, agoraMs)).toBe("sem_arte");
    // Gravação recente (lote andando): gerando.
    expect(situacaoDoTrabalho(com({ status: "gerando", atualizado_em: "2026-11-14T20:58:00Z" }), null, agoraMs)).toBe("gerando");
    // O andamento local do lote continua valendo mais.
    expect(situacaoDoTrabalho(com({ status: "dirigido", atualizado_em: "2026-11-14T19:00:00Z" }), "gerando", agoraMs)).toBe("gerando");
  });

  it("a função: status pelo fim do lote, na gravação da versão, no fecho da linha, no cancelar e na vigia", () => {
    const f = ler("supabase/functions/estudio-arte/index.ts");
    expect(f).toContain("status: statusDepoisDeGerar(atual, [nova], geracaoAtiva),");
    expect(f).toContain("if (p.gravou && linhaFechada(p.mudanca.status)) await assentarTrabalho(item.trabalho_id);");
    expect(f).toContain("if ((data ?? []).length) await assentarTrabalho(t.id);");
    expect(f).toContain("for (const id of fechados) await assentarTrabalho(id);");
    // Sem passo para pegar: confere os lotes que a RPC encerrou sozinha (expirados, tentativas no fim), sem gerar.
    const processar = f.slice(f.indexOf("async function processarFila("), f.indexOf("// ------------------------------------- ações da lâmina em segundo plano"));
    expect(processar).toContain("if (!item) {\n");
    expect(processar.indexOf("const assento = assentarEncerradosForaDoPasso();")).toBeGreaterThan(processar.indexOf("if (!item) {"));
    expect(processar.indexOf("const assento = assentarEncerradosForaDoPasso();")).toBeLessThan(processar.indexOf("return json({ processando: null });"));
    const assento = f.slice(f.indexOf("function dependenciasDoAssento("), f.indexOf("async function vigiarAntesDePegar("));
    expect(assento).toContain('.in("status", ["erro", "cancelado"])');
    expect(assento).toContain('.gte("concluido_em", desde)');
    expect(assento).toContain('.in("id", trabalhos).eq("status", "gerando")');
    expect(assento).toContain("assentar: assentarTrabalho,");
    expect(assento).not.toMatch(/\.(update|insert|delete|upsert)\(/);
    // Só mexe em trabalho "gerando" e só se ninguém gravou no meio.
    expect(f).toContain('.update({ status }).eq("id", trabalhoId).eq("status", "gerando").eq("atualizado_em", t.atualizado_em);');
    // Nenhum caminho deixa mais o trabalho "gerando" sem geração ativa.
    expect(f).not.toContain('? "pronto" : "gerando"');
    expect(f).not.toContain('x.cards.length ? "gerando" : "dirigido"');
  });
});

describe("progresso só avança", () => {
  it("o início da lâmina é o do servidor: releitura, nova tentativa e espera da capa não recomeçam o cronômetro", () => {
    const inicio = "2026-11-14T20:32:14Z";
    const gerando = linhaDaTela({ id: "1", ordem: 5, status: "rodando", iniciado_em: inicio, criado_em: "2026-11-14T20:32:00Z" });
    const a = andamentoDaFila([gerando]);
    expect(a[5]).toEqual({ etapa: "gerando", desde: Date.parse(inicio) });
    // Esperando a capa: "na fila" com o motivo, e o MESMO início (ao voltar a gerar, o cronômetro segue).
    const esperando = andamentoDaFila([{ ...gerando, status: "fila", aviso: AVISO_ESPERANDO_A_CAPA, proxima_em: "2026-11-14T20:33:00Z" }]);
    expect(esperando[5]).toEqual({ etapa: "fila", desde: Date.parse(inicio), detalhe: AVISO_ESPERANDO_A_CAPA });
    // Função morta, tentativa contada, de volta à fila e depois rodando de novo: o início não muda.
    const repetindo = andamentoDaFila([{ ...gerando, status: "fila", tentativas: 1, aviso: "Nova tentativa (2 de 3)" }]);
    const deNovo = andamentoDaFila([{ ...gerando, status: "rodando", tentativas: 1, aviso: null }]);
    expect(repetindo[5].desde).toBe(Date.parse(inicio));
    expect(deNovo[5]).toEqual({ etapa: "gerando", desde: Date.parse(inicio) });
    // Na conferência também.
    expect(andamentoDaFila([{ ...gerando, status: "fila", etapa: "conferir" }])[5]).toEqual({ etapa: "conferindo", desde: Date.parse(inicio) });
    // Ainda não começou: conta do pedido (criado_em), nunca da hora da leitura.
    expect(andamentoDaFila([linhaDaTela({ id: "2", ordem: 6, criado_em: "2026-11-14T20:32:00Z" })])[6].desde).toBe(Date.parse("2026-11-14T20:32:00Z"));
    // Linha sem data nenhuma: o início fica o da primeira leitura (não muda a cada releitura).
    const semData = linhaDaTela({ id: "sem-data", ordem: 7, status: "rodando", criado_em: "" });
    const primeira = andamentoDaFila([semData])[7].desde;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 90_000);
      expect(andamentoDaFila([semData])[7].desde).toBe(primeira);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marcar a etapa na tela nunca zera um início conhecido (etapa anterior, servidor ou tentativa que falhou)", () => {
    const t0 = 1_000_000;
    const agoraMs = t0 + 200_000;
    // Entre etapas: segue.
    expect(desdeDaEtapa({ antes: { etapa: "ajustando", desde: t0 }, etapa: "conferindo", agora: agoraMs })).toBe(t0);
    // O servidor já conhece o início (fila ou pedido em segundo plano): vale ele, não a hora do clique.
    expect(desdeDaEtapa({ etapa: "conferindo", servidor: t0 + 5_000, agora: agoraMs })).toBe(t0 + 5_000);
    // Ajuste falhou e a pessoa tenta de novo em seguida: o cronômetro continua.
    expect(desdeDaEtapa({ etapa: "ajustando", retomada: { desde: t0, em: agoraMs - 10_000 }, agora: agoraMs })).toBe(t0);
    // Tentativa antiga (passou a janela) ou primeira vez: conta do agora.
    expect(desdeDaEtapa({ etapa: "ajustando", retomada: { desde: t0, em: agoraMs - RETOMADA_MS - 1 }, agora: agoraMs })).toBe(agoraMs);
    expect(desdeDaEtapa({ etapa: "gerando", agora: agoraMs })).toBe(agoraMs);
    // Sair da fila começa a contar; voltar para a fila não herda cronômetro.
    expect(desdeDaEtapa({ antes: { etapa: "fila", desde: t0 }, etapa: "gerando", agora: agoraMs })).toBe(agoraMs);
    expect(desdeDaEtapa({ antes: { etapa: "gerando", desde: t0 }, etapa: "fila", agora: agoraMs })).toBe(agoraMs);
  });

  it("lâminas com arte: releitura atrasada não recua nem zera; leitura mais nova vale como veio", () => {
    const chave = "t1:1,2,3,4,5,6,7";
    let visto = progressoQueSoAvanca(null, { chave, feitas: 3, total: 7, lidoEm: 1000 });
    visto = progressoQueSoAvanca(visto, { chave, feitas: 5, total: 7, lidoEm: 2000 });
    expect(visto.feitas).toBe(5);
    // Resposta fora de ordem (leitura de antes): fica em 5, não volta para 3 nem para 0.
    expect(progressoQueSoAvanca(visto, { chave, feitas: 3, total: 7, lidoEm: 1500 }).feitas).toBe(5);
    expect(progressoQueSoAvanca(visto, { chave, feitas: 0, total: 7, lidoEm: 500 }).feitas).toBe(5);
    // A mesma leitura de novo (retentativa, releitura): igual.
    expect(progressoQueSoAvanca(visto, { chave, feitas: 5, total: 7, lidoEm: 2000 }).feitas).toBe(5);
    // Leitura mais nova com menos (versão desfeita de verdade): vale.
    expect(progressoQueSoAvanca(visto, { chave, feitas: 4, total: 7, lidoEm: 3000 }).feitas).toBe(4);
    // Outra direção ou outro trabalho: recomeça de verdade.
    expect(progressoQueSoAvanca(visto, { chave: "t1:1,2,3", feitas: 1, total: 3, lidoEm: 100 }).feitas).toBe(1);
    // Nunca passa do total.
    expect(progressoQueSoAvanca(visto, { chave, feitas: 9, total: 7, lidoEm: 4000 }).feitas).toBe(7);
  });
});

// ------------------------------------------------------------ ajuste em segundo plano

const T0 = Date.parse("2026-11-14T20:50:00Z");
const noServidor = (o: { ordem?: number; id?: string; em?: number } = {}) =>
  novoPedido({ id: o.id || "p1", acao: "ajustar_card", ordem: o.ordem ?? 1, por: "u1", versoes_antes: 2 }, new Date(o.em ?? T0));

/** Banco e relógio de mentira para acompanhar um pedido: cada leitura anda 2,5 s. */
function acompanhamentoDeMentira(leituras: Array<PedidosDoTrabalho | Error>, versoes: number | null = 2) {
  let agoraMs = T0;
  let i = 0;
  const lidas: number[] = [];
  const deps: DependenciasDoAcompanhamento = {
    ler: async () => {
      lidas.push(agoraMs);
      const l = leituras[Math.min(i++, leituras.length - 1)];
      if (l instanceof Error) throw l;
      return pedidosDaDirecao(l);
    },
    versoes: async () => versoes,
    esperar: async (m) => { agoraMs += m; },
    agora: () => agoraMs,
  };
  return { deps, lidas, andar: (m: number) => { agoraMs += m; } };
}

describe("ajuste em segundo plano: a função responde na hora e a tela acompanha pelo banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("servidor: só as ações da lâmina com segundo_plano; a lâmina com pedido vivo não aceita outro (não cobra duas vezes)", () => {
    expect(pedeSegundoPlano("ajustar_card", { segundo_plano: true })).toBe(true);
    expect(pedeSegundoPlano("conferir_card", { segundo_plano: true })).toBe(true);
    expect(pedeSegundoPlano("ajustar_card", {})).toBe(false);
    expect(pedeSegundoPlano("gerar_card", { segundo_plano: true })).toBe(false);
    expect(pedeSegundoPlano("processar_fila", { segundo_plano: true })).toBe(false);

    const primeiro = registrarPedido({}, noServidor(), new Date(T0));
    expect(primeiro.ok).toBe(true);
    const pedidos = (primeiro as { pedidos: PedidosDoTrabalho }).pedidos;
    // Segundo clique na mesma lâmina 20 s depois: recusado. Outra lâmina: entra.
    const segundo = registrarPedido(pedidos, noServidor({ id: "p2", em: T0 + 20_000 }), new Date(T0 + 20_000));
    expect(segundo).toMatchObject({ ok: false, ocupada: { id: "p1" } });
    expect(registrarPedido(pedidos, noServidor({ id: "p3", ordem: 2 }), new Date(T0 + 20_000)).ok).toBe(true);
    // Com pulso, segue vivo; sem pulso há mais de 75 s (função morta), a lâmina aceita outro pedido.
    const comPulso = pulsarPedido(pedidos, 1, "p1", new Date(T0 + 60_000)) as PedidosDoTrabalho;
    expect(pedidoVivoNoServidor(comPulso.l1, new Date(T0 + 120_000))).toBe(true);
    expect(pedidoVivoNoServidor(pedidos.l1, new Date(T0 + 120_000))).toBe(false);
    expect(registrarPedido(pedidos, noServidor({ id: "p4", em: T0 + 120_000 }), new Date(T0 + 120_000)).ok).toBe(true);
    // Pulso de pedido que não é mais o da lâmina não grava nada.
    expect(pulsarPedido(pedidos, 1, "outro", new Date(T0))).toBeNull();
  });

  it("servidor: o pedido fecha com o corpo da ação, sem o trabalho inteiro; erro fica com o código e os detalhes", () => {
    const pedidos = (registrarPedido({}, noServidor(), new Date(T0)) as { pedidos: PedidosDoTrabalho }).pedidos;
    const feito = concluirPedido(pedidos, 1, "p1", { ordem: 1, versao: 3, custo_usd: 0.074, trabalho: { id: "t", cards: new Array(50).fill({}) } }, new Date(T0 + 40_000)) as PedidosDoTrabalho;
    expect(feito.l1).toMatchObject({ status: "feito", resultado: { ordem: 1, versao: 3, custo_usd: 0.074 } });
    expect(feito.l1.resultado).not.toHaveProperty("trabalho");
    const erro = concluirPedido(pedidos, 1, "p1", { error: "ajuste_proposta", mensagem: "Proponho...", proposta: "trocar o fundo por azul", custo_usd: 0.002, status_http: 409 }, new Date(T0 + 9_000)) as PedidosDoTrabalho;
    expect(erro.l1).toMatchObject({ status: "erro", resultado: { error: "ajuste_proposta", proposta: "trocar o fundo por azul" } });
    // O pedido saiu da lâmina (outro entrou): o resultado velho não grava por cima.
    expect(concluirPedido(pedidos, 1, "velho", { ok: true }, new Date(T0))).toBeNull();
  });

  it("os limites do servidor e da tela são os mesmos", () => {
    expect(SEM_PULSO_MS).toBe(LIMITES_DO_SEGUNDO_PLANO.SEM_PULSO_S * 1000);
    expect(LIMITES_DO_SEGUNDO_PLANO.PULSO_S * 3).toBeLessThanOrEqual(LIMITES_DO_SEGUNDO_PLANO.SEM_PULSO_S);
  });

  it("tela: o ajuste é aceito na hora (202) e o resultado vem do banco, sem depender da resposta aberta até o fim", async () => {
    const pedido = noServidor();
    // A função responde NA HORA só com o pedido aceito: nenhum corpo de ajuste, nenhum fôlego.
    mock.invoke.mockResolvedValue({ data: { em_segundo_plano: true, pedido: { id: "p1", acao: "ajustar_card", ordem: 1, desde: pedido.desde, prazo: pedido.prazo, versoes_antes: 2 } }, error: null });
    const rodando = { l1: pedido };
    const pronto = concluirPedido(rodando, 1, "p1", { ordem: 1, versao: 3, custo_usd: 0.074, aviso_da_acao: "Confira a logo." }, new Date(T0 + 7_000)) as PedidosDoTrabalho;
    const banco = acompanhamentoDeMentira([rodando, rodando, pronto]);

    const r = await chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "troque o fundo" }, banco.deps);

    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledWith("estudio-arte", expect.objectContaining({ body: expect.objectContaining({ acao: "ajustar_card", segundo_plano: true, instrucao: "troque o fundo" }) }));
    // O corpo é o que a chamada direta devolveria (custo e aviso), lido do banco na terceira leitura.
    expect(r).toMatchObject({ ordem: 1, versao: 3, custo_usd: 0.074, aviso_da_acao: "Confira a logo." });
    expect(banco.lidas).toHaveLength(3);
  });

  it("tela: erro do ajuste chega igual ao da chamada direta (mesmo código e detalhes, ex.: a proposta do pedido vago)", async () => {
    const pedido = noServidor();
    mock.invoke.mockResolvedValue({ data: { em_segundo_plano: true, pedido: { id: "p1", acao: "ajustar_card", ordem: 1, desde: pedido.desde, prazo: pedido.prazo, versoes_antes: 2 } }, error: null });
    const erro = concluirPedido({ l1: pedido }, 1, "p1", { error: "ajuste_proposta", mensagem: "Proponho: fundo azul. Aplico assim?", proposta: "fundo azul", custo_usd: 0.002, status_http: 409 }, new Date(T0 + 5_000)) as PedidosDoTrabalho;
    const banco = acompanhamentoDeMentira([erro]);
    const falha = await chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "melhora" }, banco.deps).catch((e) => e);
    expect(falha).toBeInstanceOf(ErroDaMesa);
    expect(falha).toMatchObject({ codigo: "ajuste_proposta", message: "Proponho: fundo azul. Aplico assim?", detalhes: { proposta: "fundo azul", custo_usd: 0.002 } });
  });

  it("tela: função morta DEPOIS de gravar a arte: segue como feito, sem pedir (nem cobrar) de novo", async () => {
    const pedido = noServidor();
    mock.invoke.mockResolvedValue({ data: { em_segundo_plano: true, pedido: { id: "p1", acao: "ajustar_card", ordem: 1, desde: pedido.desde, prazo: pedido.prazo, versoes_antes: 2 } }, error: null });
    // O pedido nunca fecha nem dá pulso (CPU Time exceeded); a versão 3 já está no trabalho.
    const banco = acompanhamentoDeMentira([{ l1: pedido }], 3);
    const r = await chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "x" }, banco.deps);
    expect(r).toMatchObject({ recuperado_do_banco: true, aviso_da_acao: AVISO_DA_ARTE_RECUPERADA });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    // Desistiu pelo pulso (75 s), não pelo prazo de 7 minutos.
    const esperou = banco.lidas[banco.lidas.length - 1] - T0;
    expect(esperou).toBeGreaterThan(SEM_PULSO_MS);
    expect(esperou).toBeLessThan(SEM_PULSO_MS + 10_000);
  });

  it("tela: função morta ANTES de gravar: a falha é a mesma de antes (funcao_interrompida), sem ficar presa", async () => {
    const pedido = noServidor();
    mock.invoke.mockResolvedValue({ data: { em_segundo_plano: true, pedido: { id: "p1", acao: "ajustar_card", ordem: 1, desde: pedido.desde, prazo: pedido.prazo, versoes_antes: 2 } }, error: null });
    const banco = acompanhamentoDeMentira([{ l1: pedido }], 2);
    const falha = await chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "x" }, banco.deps).catch((e) => e);
    expect(falha).toMatchObject({ codigo: "funcao_interrompida", detalhes: { causa: "sem_pulso", pedido: "p1" } });
  });

  it("tela: leitura do banco que falha só atrasa; pedido com pulso segue sendo esperado além dos 75 s", async () => {
    const pedido = noServidor();
    mock.invoke.mockResolvedValue({ data: { em_segundo_plano: true, pedido: { id: "p1", acao: "ajustar_card", ordem: 1, desde: pedido.desde, prazo: pedido.prazo, versoes_antes: 2 } }, error: null });
    const leituras: Array<PedidosDoTrabalho | Error> = [new Error("rede")];
    // 60 leituras (150 s) com o pulso sempre recente, depois fecha.
    let vivo: PedidosDoTrabalho = { l1: pedido };
    for (let i = 1; i <= 60; i++) {
      vivo = pulsarPedido(vivo, 1, "p1", new Date(T0 + i * 2_500)) as PedidosDoTrabalho;
      leituras.push(vivo);
    }
    leituras.push(concluirPedido(vivo, 1, "p1", { ordem: 1, versao: 3, custo_usd: 0.05 }, new Date(T0 + 155_000)) as PedidosDoTrabalho);
    const banco = acompanhamentoDeMentira(leituras);
    const r = await chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "x" }, banco.deps);
    expect(r).toMatchObject({ versao: 3 });
    expect(banco.lidas[banco.lidas.length - 1] - T0).toBeGreaterThan(SEM_PULSO_MS * 2);
  });

  it("tela: com a função antiga no ar (sem segundo plano), a resposta já é o corpo final e nada muda", async () => {
    mock.invoke.mockResolvedValue({ data: { ordem: 1, versao: 3, custo_usd: 0.05 }, error: null });
    const banco = acompanhamentoDeMentira([{}]);
    expect(await chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "x" }, banco.deps)).toEqual({ ordem: 1, versao: 3, custo_usd: 0.05 });
    expect(banco.lidas).toHaveLength(0);
    // E o erro direto continua igual.
    mock.invoke.mockResolvedValue({ data: { error: "instrucao_vazia", mensagem: "Descreva o ajuste que você quer." }, error: null });
    await expect(chamarEmSegundoPlano("estudio-arte", { acao: "ajustar_card", trabalho_id: "t1", ordem: 1, instrucao: "" }, banco.deps)).rejects.toMatchObject({ codigo: "instrucao_vazia" });
  });

  it("tela: o andamento do pedido vem do banco com o início do pedido (reabrir a tela não zera) e some quando a função morre", () => {
    const pedidos: PedidosNaTela = pedidosDaDirecao({
      l1: noServidor(),
      l3: { ...noServidor({ id: "p3", ordem: 3 }), acao: "conferir_card" },
      l4: concluirPedido({ l4: noServidor({ id: "p4", ordem: 4 }) }, 4, "p4", { ok: true }, new Date(T0 + 1000))!.l4,
      lixo: { id: 1 },
    });
    const a = andamentoDosPedidos(pedidos, T0 + 30_000);
    expect(a).toEqual({ 1: { etapa: "ajustando", desde: T0 }, 3: { etapa: "conferindo", desde: T0 } });
    // A mesma leitura mais tarde, sem pulso: o pedido morto não segura a lâmina como "ajustando".
    expect(andamentoDosPedidos(pedidos, T0 + SEM_PULSO_MS + 1)).toEqual({});
  });

  it("ligações: a função aceita em segundo plano antes do fôlego, e a tela do Estúdio ajusta, confere e corrige por ele", () => {
    const f = ler("supabase/functions/estudio-arte/index.ts");
    expect(f).toContain("if (pedeSegundoPlano(acao, corpo) && temSegundoPlano()) {");
    expect(f.indexOf("if (pedeSegundoPlano(acao, corpo) && temSegundoPlano()) {")).toBeLessThan(f.indexOf("return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();"));
    expect(f).toContain("return json({ em_segundo_plano: true, pedido: pedidoParaATela(pedido) }, 202);");
    expect(f).toContain("if (!emSegundoPlano(trabalho)) await trabalho;");
    // O acesso ao cliente é conferido antes de aceitar; a ação roda a mesma de sempre.
    expect(f).toContain("const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));\n  const ordem = lerOrdem(corpo);\n  const agora = new Date();\n  const pedido = novoPedido(");
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toContain('const a = await chamarEmSegundoPlano<any>("estudio-arte", {\n        acao: "ajustar_card",');
    expect(estudio).toContain('conferir: () => chamarEmSegundoPlano<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalhoId, ordem }),');
    expect(estudio).toContain('chamarEmSegundoPlano<any>("estudio-arte", { acao: "corrigir_card", trabalho_id: trabalhoId, ordem, pedido_da_equipe: pedidoDaEquipe || undefined }),');
    expect(estudio).not.toMatch(/chamarFuncao<any>\("estudio-arte", \{\s*acao: "ajustar_card"/);
    expect(ler("src/components/mesa-ads/ArteDoCriativo.tsx")).not.toMatch(/chamarFuncao<any>\("estudio-arte", \{\s*acao: "ajustar_card"/);
  });
});

describe("a corrente da fila na função (14/11)", () => {
  it("a vigia roda antes de pegar o passo; um passo por invocação; o chute não aborta a próxima invocação", () => {
    const f = ler("supabase/functions/estudio-arte/index.ts");
    const processar = f.slice(f.indexOf("async function processarFila("), f.indexOf("// ------------------------------------- ações da lâmina em segundo plano"));
    expect(processar.indexOf("await vigiarAntesDePegar();")).toBeGreaterThan(0);
    expect(processar.indexOf("await vigiarAntesDePegar();")).toBeLessThan(processar.indexOf("await deps.pegar(token);"));
    // Um passo só por invocação: um processarItem, e o próximo sai por chute (outra invocação).
    expect(processar.match(/processarItem\(/g)).toHaveLength(1);
    expect(processar).toContain("chutarFila(ch.token, chutes);");
    const chute = f.slice(f.indexOf("function chutarFila("), f.indexOf("function itemDaFila("));
    expect(chute).not.toContain("AbortSignal");
    expect(chute).toContain('body: JSON.stringify({ acao: "processar_fila" }),');
    // A vigia usa a chave de serviço e olha as linhas de todas as pessoas (sem filtro por quem pediu).
    const vigia = f.slice(f.indexOf("function dependenciasDaVigia("), f.indexOf("async function assentarTrabalho("));
    expect(vigia).toContain('.eq("status", "rodando")');
    expect(vigia).not.toContain("pedido_por");
  });
});

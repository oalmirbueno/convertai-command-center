import { describe, expect, it } from "vitest";
import {
  ENVIO_A_CADA_MS,
  MotorDoCronometro,
  OCIOSIDADE_MS,
  areaDaRota,
  chaveDaFila,
  mesDeSaoPaulo,
  type Armazenamento,
  type ResultadoDoEnvio,
  type TrechoParaEnvio,
} from "@/lib/cronometro/motor";

/**
 * Cronômetro por cliente (frente CR, 28/09). Pedido do dono: "trabalhando num
 * cliente, conta o tempo daquele cliente; ao sair trava; ao ir para outro
 * começa o outro, sem misturar; ao voltar retoma; zera todo começo de mês".
 * Aqui o relógio anda na mão: nada de espera de verdade.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function memoria(): Armazenamento & { dados: Record<string, string> } {
  const dados: Record<string, string> = {};
  return {
    dados,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null),
    setItem: (k, v) => {
      dados[k] = String(v);
    },
    removeItem: (k) => {
      delete dados[k];
    },
  };
}

interface Cenario {
  relogio: { agora: number };
  arm: ReturnType<typeof memoria>;
  envios: Array<{ trecho: TrechoParaEnvio; urgente: boolean }>;
  resposta: { valor: ResultadoDoEnvio };
}

function cenario(inicio = Date.UTC(2026, 8, 28, 13, 0, 0)): Cenario {
  return { relogio: { agora: inicio }, arm: memoria(), envios: [], resposta: { valor: "ok" } };
}

let seq = 0;
function motor(c: Cenario, aba = "aba-1") {
  return new MotorDoCronometro({
    agora: () => c.relogio.agora,
    armazenamento: c.arm,
    enviar: (trecho, urgente) => {
      c.envios.push({ trecho, urgente });
      return Promise.resolve(c.resposta.valor);
    },
    gerarId: () => `trecho-${++seq}`,
    aba,
    usuario: "pessoa-1",
  });
}

/** Anda o relógio de segundo em segundo, batendo em todos os motores. */
function andar(c: Cenario, motores: MotorDoCronometro[], segundos: number, mexendo: MotorDoCronometro | null = null) {
  for (let i = 0; i < segundos; i++) {
    c.relogio.agora += 1000;
    if (mexendo) mexendo.interacao();
    for (const m of motores) m.batida();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Último envio de cada trecho (o que o banco guarda: vale a versão maior). */
function noBanco(c: Cenario): Record<string, TrechoParaEnvio> {
  const porId: Record<string, TrechoParaEnvio> = {};
  for (const e of c.envios) {
    const atual = porId[e.trecho.id];
    if (!atual || e.trecho.versao > atual.versao) porId[e.trecho.id] = e.trecho;
  }
  return porId;
}

function somaDoCliente(c: Cenario, cliente: string): number {
  return Object.values(noBanco(c))
    .filter((t) => t.client_id === cliente)
    .reduce((s, t) => s + t.segundos, 0);
}

describe("onde conta", () => {
  it("só nas rotas de trabalho de cliente; Dashboard, Financeiro, Config e a própria central nunca", () => {
    expect(areaDaRota("/mesa")).toBe("mesa");
    expect(areaDaRota("/mesa-ads")).toBe("mesa-ads");
    expect(areaDaRota("/mesa-foto")).toBe("mesa-foto");
    expect(areaDaRota("/mesa-videos")).toBe("mesa-videos");
    expect(areaDaRota("/mesa-edicao")).toBe("mesa-edicao");
    expect(areaDaRota("/central")).toBe("central");
    expect(areaDaRota("/ciclo/revisao")).toBe("ciclo");
    expect(areaDaRota("/workspace")).toBe("workspace");
    expect(areaDaRota("/arquivos")).toBe("arquivos");
    expect(areaDaRota("/calendario")).toBe("agenda");
    expect(areaDaRota("/clientes")).toBe("clientes");
    expect(areaDaRota(`/clientes/${A}`)).toBe("clientes");
    for (const fora of ["/dashboard", "/financeiro", "/financeiro/projecao", "/config", "/comercial", "/comercial/crm", "/horas", "/equipe", "/perfil", "/novidades", "/"]) {
      expect(areaDaRota(fora)).toBeNull();
    }
  });

  it("sem cliente, fora de área ou pessoa que não é da equipe: não soma nada", () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: null, area: "mesa" });
    andar(c, [m], 30, m);
    m.definirContexto({ ativo: true, cliente: A, area: null });
    andar(c, [m], 30, m);
    m.definirContexto({ ativo: false, cliente: A, area: "mesa" });
    andar(c, [m], 30, m);
    expect(m.trechoAberto()).toBeNull();
    expect(m.instantaneo().contando).toBe(false);
    m.sair();
    expect(c.envios).toHaveLength(0);
  });
});

describe("troca de cliente", () => {
  it("conta o cliente em foco; trocar fecha o trecho e começa o outro, sem misturar; voltar retoma", async () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 90, m);
    expect(m.instantaneo()).toMatchObject({ cliente: A, contando: true, motivo: "contando" });
    const primeiro = m.trechoAberto()!;
    expect(primeiro.cliente).toBe(A);

    m.definirContexto({ ativo: true, cliente: B, area: "mesa-foto" });
    andar(c, [m], 40, m);
    expect(m.trechoAberto()!.cliente).toBe(B);
    expect(m.trechoAberto()!.id).not.toBe(primeiro.id);

    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 20, m);
    m.sair();
    await flush();

    expect(somaDoCliente(c, A)).toBe(110);
    expect(somaDoCliente(c, B)).toBe(40);
    // Nenhum trecho mistura dois clientes.
    for (const t of Object.values(noBanco(c))) expect([A, B]).toContain(t.client_id);
    expect(Object.values(noBanco(c)).filter((t) => t.client_id === A)).toHaveLength(2);
  });

  it("a mesma chamada repetida só sobe a versão (o banco guarda a maior)", async () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 200, m);
    m.sair();
    await flush();
    const doTrecho = c.envios.map((e) => e.trecho.versao);
    for (let i = 1; i < doTrecho.length; i++) expect(doTrecho[i]).toBeGreaterThan(doTrecho[i - 1]);
    expect(somaDoCliente(c, A)).toBe(200);
  });
});

describe("carga no banco", () => {
  it("envia no máximo uma vez por minuto enquanto conta, e na hora que fecha", async () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 10 * 60, m);
    // 10 minutos contando: 10 envios, não 600.
    expect(c.envios.length).toBeLessThanOrEqual(10);
    expect(c.envios.length).toBeGreaterThanOrEqual(9);
    m.sair();
    await flush();
    expect(c.envios.length).toBeLessThanOrEqual(11);
    expect(ENVIO_A_CADA_MS).toBe(60_000);
  });

  it("envio que falhou não repete em laço: vai para a fila e sobe na próxima janela", async () => {
    const c = cenario();
    const m = motor(c);
    c.resposta.valor = "falhou";
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 30, m);
    m.definirContexto({ ativo: true, cliente: B, area: "mesa" });
    await flush();
    const tentativas = c.envios.length;
    expect(JSON.parse(c.arm.dados[chaveDaFila("pessoa-1")])).toHaveLength(1);
    // Nos próximos segundos, nada de nova tentativa do trecho que falhou.
    andar(c, [m], 20, m);
    await flush();
    expect(c.envios.filter((e) => e.trecho.client_id === A)).toHaveLength(tentativas);
    // Na janela seguinte, sobe da fila (uma vez).
    c.resposta.valor = "ok";
    andar(c, [m], 60, m);
    await flush();
    expect(c.envios.filter((e) => e.trecho.client_id === A).length).toBe(tentativas + 1);
    expect(c.arm.dados[chaveDaFila("pessoa-1")]).toBeUndefined();
  });
});

describe("pausa sozinho", () => {
  it("5 minutos sem interação pausam, e o tempo parado não conta; mexer retoma", async () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 120, m); // 2 min trabalhando
    andar(c, [m], OCIOSIDADE_MS / 1000 + 60, null); // 6 min parado
    expect(m.instantaneo()).toMatchObject({ contando: false, motivo: "ociosa" });
    expect(m.trechoAberto()).toBeNull();
    m.interacao();
    andar(c, [m], 30, m);
    expect(m.instantaneo().contando).toBe(true);
    m.sair();
    await flush();
    // 2 min antes + 30 s depois; os 6 min parados ficaram de fora.
    expect(somaDoCliente(c, A)).toBe(150);
  });

  it("aba escondida pausa na hora (e envia com pressa); ao voltar, retoma", async () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 45, m);
    m.definirVisibilidade(false);
    expect(m.instantaneo()).toMatchObject({ contando: false, motivo: "escondida" });
    expect(c.envios[c.envios.length - 1]).toMatchObject({ urgente: true });
    andar(c, [m], 600, null);
    m.definirVisibilidade(true);
    andar(c, [m], 15, m);
    expect(m.instantaneo().contando).toBe(true);
    m.sair();
    await flush();
    expect(somaDoCliente(c, A)).toBe(60);
  });

  it("computador que dormiu com a aba aberta não conta o buraco", async () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 20, m);
    c.relogio.agora += 40 * 60_000; // dormiu 40 min
    m.interacao();
    m.batida();
    andar(c, [m], 10, m);
    m.sair();
    await flush();
    expect(somaDoCliente(c, A)).toBe(30);
  });
});

describe("várias abas contam uma vez só", () => {
  it("duas abas abertas no mesmo cliente: só uma conta; mexer na outra passa a vez", async () => {
    const c = cenario();
    const m1 = motor(c, "aba-1");
    const m2 = motor(c, "aba-2");
    m1.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    m2.definirContexto({ ativo: true, cliente: A, area: "mesa-foto" });
    andar(c, [m1, m2], 60, m1);
    const contando1 = m1.instantaneo().contando;
    const contando2 = m2.instantaneo().contando;
    expect(contando1 !== contando2).toBe(true);
    expect(m1.instantaneo().contando).toBe(true);
    expect(m2.instantaneo().motivo).toBe("outra-aba");

    // A pessoa passa a mexer na segunda janela.
    andar(c, [m1, m2], 60, m2);
    expect(m2.instantaneo().contando).toBe(true);
    expect(m1.instantaneo().motivo).toBe("outra-aba");
    m1.sair();
    m2.sair();
    await flush();
    // 120 s de relógio, 120 s contados (uma vez só), nunca 240.
    expect(somaDoCliente(c, A)).toBeGreaterThanOrEqual(118);
    expect(somaDoCliente(c, A)).toBeLessThanOrEqual(120);
  });

  it("a aba que conta fechou sem avisar: o trecho guardado sobe pela próxima aba", async () => {
    const c = cenario();
    const m1 = motor(c, "aba-1");
    m1.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m1], 50, m1); // antes do primeiro envio
    expect(c.envios).toHaveLength(0);
    c.relogio.agora += 30_000; // a posse venceu
    const m2 = motor(c, "aba-2");
    m2.definirContexto({ ativo: true, cliente: B, area: "mesa" });
    andar(c, [m2], 61, m2);
    await flush();
    expect(somaDoCliente(c, A)).toBeGreaterThanOrEqual(48);
  });
});

describe("virada do mês", () => {
  it("o trecho corta na virada; o mês novo começa do zero e o anterior fica no histórico", async () => {
    // 30/09 23:59:00 em São Paulo = 01/10 02:59:00 UTC.
    const c = cenario(Date.UTC(2026, 9, 1, 2, 59, 0));
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    const pedidoSetembro = m.pedidoDeBase()!;
    expect(pedidoSetembro.mes).toBe("2026-09-01");
    expect(m.definirBase(pedidoSetembro, 3600)).toBe(true);
    andar(c, [m], 30, m);
    expect(m.instantaneo()).toMatchObject({ mes: "2026-09-01", segundosDoMes: 3630 });
    andar(c, [m], 60, m); // passa da meia-noite
    const agora = m.instantaneo();
    expect(agora.mes).toBe("2026-10-01");
    expect(agora.baseConhecida).toBe(false);
    expect(agora.segundosDoMes).toBe(30);
    m.sair();
    await flush();
    const trechos = Object.values(noBanco(c));
    const porMes: Record<string, number> = {};
    for (const t of trechos) porMes[mesDeSaoPaulo(Date.parse(t.inicio))] = (porMes[mesDeSaoPaulo(Date.parse(t.inicio))] || 0) + t.segundos;
    expect(porMes).toEqual({ "2026-09-01": 60, "2026-10-01": 30 });
    // Nenhum trecho atravessa a hora cheia.
    for (const t of trechos) expect(Math.floor(Date.parse(t.inicio) / 3600_000)).toBe(Math.floor((Date.parse(t.fim) - 1) / 3600_000));
  });

  it("base do banco que chegou depois de um trecho fechar é pedida de novo (não conta duas vezes)", () => {
    const c = cenario();
    const m = motor(c);
    m.definirContexto({ ativo: true, cliente: A, area: "mesa" });
    andar(c, [m], 5, m);
    const pedido = m.pedidoDeBase()!;
    m.definirContexto({ ativo: true, cliente: A, area: "workspace" });
    expect(m.definirBase(pedido, 999)).toBe(false);
    const outro = m.pedidoDeBase()!;
    expect(m.definirBase(outro, 100)).toBe(true);
    andar(c, [m], 10, m);
    expect(m.instantaneo().segundosDoMes).toBe(110);
  });
});

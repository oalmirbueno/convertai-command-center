import { createElement as h, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente SPV (revisão de 30/09): a edição da prévia vira um trabalho
 * "conteudo" por vez. Com dezenas deles, a lista do motor (30 trabalhos)
 * perdia os construir: a Construção oferecia reconstruir tudo, a prévia
 * voltava para "Ainda não construída" e o checklist dizia que o site não foi
 * construído. Agora o servidor manda só os de código, e o último "conteudo"
 * à parte; a tela também filtra (função antiga no ar).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { trabalhosDoProjeto, ultimoConteudo } from "../../supabase/functions/_shared/motor-fila";
import { comAEdicaoDaPrevia, previaAtual, secoesConstruidas, trabalhosDeCodigo, useTrabalhos } from "@/components/mesa-site/siteApi";
import { normalizarTrabalho, type TrabalhoDoMotor } from "../../supabase/functions/_shared/motor-codigo";
import { estadoDasSecoes, estadoDoMotor } from "../../supabase/functions/mesa-site/modulos/site-previa";

type Linha = Record<string, any>;
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

/** Banco falso com o pedaço do PostgREST que a fila usa (eq, neq, order, limit). */
function banco(linhas: Linha[]) {
  return {
    from: () => {
      const filtros: Array<(l: Linha) => boolean> = [];
      let limite = Infinity;
      let ordem: { c: string; asc: boolean } | null = null;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
        neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
        order: (c: string, o?: { ascending?: boolean }) => ((ordem = { c, asc: !o || o.ascending !== false }), q),
        limit: (n: number) => ((limite = n), q),
        then: (ok: (r: unknown) => unknown) => {
          const achadas = linhas.filter((l) => filtros.every((f) => f(l)));
          if (ordem) {
            const { c, asc } = ordem;
            achadas.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
          }
          return Promise.resolve({ data: achadas.slice(0, limite), error: null }).then(ok);
        },
      };
      return q;
    },
  } as any;
}

const trabalho = (id: string, tipo: string, estado: string, minuto: number, extra: Linha = {}): Linha => ({
  id,
  client_id: CLIENTE,
  marca_id: null,
  mesa: "site",
  projeto: "landing-33333333",
  referencia_tipo: "site",
  referencia_id: SITE,
  tipo,
  estado,
  modelo: null,
  instrucao: "",
  teto_usd: 0,
  estimativa_usd: 0,
  custo_usd: 0,
  preview_url: null,
  preview_expira_em: null,
  commit: null,
  commit_anterior: null,
  zip_path: null,
  resultado: {},
  erro: null,
  executor: null,
  pego_em: null,
  terminado_em: null,
  criado_em: `2026-09-30T${String(10 + Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}:00Z`,
  ...extra,
});

/** 1 construir antigo com 2 seções prontas e 31 edições da prévia depois dele. */
function filaCheia(): Linha[] {
  const l: Linha[] = [trabalho("b1", "construir", "feito", 0, { commit: "abc1234", resultado: { secoes_pedidas: ["hero", "faq"], secoes: ["hero", "faq"] }, terminado_em: "2026-09-30T10:05:00Z" })];
  for (let i = 1; i <= 31; i++) l.push(trabalho(`k${i}`, "conteudo", "feito", 10 + i, { commit: `c${i}`, preview_url: i === 31 ? "https://nova.trycloudflare.com" : null }));
  return l;
}

beforeEach(() => mock.invoke.mockReset());

describe("a fila do motor sem as edições da prévia", () => {
  it("31 'conteudo' depois de 1 construir: a lista de 30 ainda tem o construir e as seções prontas", async () => {
    const db = banco(filaCheia());
    const lista = await trabalhosDoProjeto(db, CLIENTE, SITE);
    expect(lista.map((t) => t.id)).toEqual(["b1"]);
    expect(secoesConstruidas(lista)).toEqual(["hero", "faq"]);
    expect(estadoDasSecoes(lista, ["hero", "faq", "contato"])).toEqual({ hero: "pronta", faq: "pronta", contato: "pendente" });
    const ultimo = await ultimoConteudo(db, CLIENTE, SITE);
    expect(ultimo && ultimo.id).toBe("k31");
    // A prévia do motor sai do "conteudo" mais novo (o endereço do túnel mais recente).
    expect(previaAtual(comAEdicaoDaPrevia({ trabalhos: lista, conteudo: ultimo }))!.preview_url).toBe("https://nova.trycloudflare.com");
  });

  it("o último 'conteudo' entra na lista da prévia na posição pela data, sem reordenar o resto", () => {
    const n = (l: Linha) => normalizarTrabalho(l) as TrabalhoDoMotor;
    const lista = [n(trabalho("r2", "revisar", "feito", 50)), n(trabalho("b1", "construir", "feito", 10))];
    const c = n(trabalho("k1", "conteudo", "na_fila", 30));
    expect(comAEdicaoDaPrevia({ trabalhos: lista, conteudo: c }).map((t) => t.id)).toEqual(["r2", "k1", "b1"]);
    expect(comAEdicaoDaPrevia({ trabalhos: lista, conteudo: n(trabalho("k2", "conteudo", "na_fila", 90)) }).map((t) => t.id)).toEqual(["k2", "r2", "b1"]);
    expect(comAEdicaoDaPrevia({ trabalhos: lista, conteudo: n(trabalho("k0", "conteudo", "na_fila", 1)) }).map((t) => t.id)).toEqual(["r2", "b1", "k0"]);
    expect(comAEdicaoDaPrevia(null)).toEqual([]);
    expect(trabalhosDeCodigo([c, lista[0]]).map((t) => t.id)).toEqual(["r2"]);
  });

  it("o estado do motor diz quando o que espera é só a edição da prévia (sem tom de erro)", () => {
    const n = (l: Linha) => normalizarTrabalho(l) as TrabalhoDoMotor;
    const so = estadoDoMotor(null, [n(trabalho("k1", "conteudo", "na_fila", 30))]);
    expect(so).toMatchObject({ codigo: "sem_worker", tom: "atencao", fila: 1 });
    expect(so.detalhe).toMatch(/A edição da prévia chega ao site do motor quando ele ligar/);
    const vivo = { nome: "agencia", visto_em: new Date().toISOString(), versao: "v", capacidades: {} };
    expect(estadoDoMotor(vivo, [n(trabalho("k1", "conteudo", "na_fila", 30))])).toMatchObject({ codigo: "na_fila", rotulo: "Levando a edição da prévia ao site do motor" });
    // Com um construir esperando também, volta a ser pedido na fila.
    expect(estadoDoMotor(null, [n(trabalho("k1", "conteudo", "na_fila", 30)), n(trabalho("b1", "construir", "na_fila", 10))])).toMatchObject({ tom: "erro", detalhe: "2 pedidos esperam na fila até ele ligar." });
  });
});

describe("a tela lê a lista do motor", () => {
  const embrulho = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => h(QueryClientProvider, { client: qc }, children);
  };

  it("função nova: os de código na lista e o último 'conteudo' à parte", async () => {
    const cheia = filaCheia();
    mock.invoke.mockResolvedValue({ data: { trabalhos: [cheia[0]], conteudo: cheia[31], executor: null, executor_vivo: false, custo_usd: 0 }, error: null });
    const { result } = renderHook(() => useTrabalhos(CLIENTE, SITE), { wrapper: embrulho() });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!.trabalhos.map((t) => t.id)).toEqual(["b1"]);
    expect(result.current.data!.conteudo!.id).toBe("k31");
    expect(mock.invoke).toHaveBeenCalledWith("motor-codigo", expect.objectContaining({ body: expect.objectContaining({ acao: "listar", client_id: CLIENTE, site_id: SITE }) }));
  });

  it("função antiga no ar (o 'conteudo' ainda vem na lista): a tela separa igual", async () => {
    const velha = filaCheia().slice().reverse().slice(0, 30);
    mock.invoke.mockResolvedValue({ data: { trabalhos: velha.concat([filaCheia()[0]]), executor: null, executor_vivo: false, custo_usd: 0 }, error: null });
    const { result } = renderHook(() => useTrabalhos(CLIENTE, SITE), { wrapper: embrulho() });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!.trabalhos.map((t) => t.tipo)).toEqual(["construir"]);
    expect(result.current.data!.conteudo!.id).toBe("k31");
  });
});

import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A campanha no canvas do Laboratório, lado das Campanhas (25/10/2026, ponte Laboratório ↔ Campanhas):
 * - o bloco Canvas: sem canvas, "Montar o canvas" cria pela ponte e abre o projeto no Laboratório; ligado,
 *   mostra a última sincronia e o que entrou e "Sincronizar agora" roda os dois sentidos;
 * - as sugestões do canvas para a campanha (aceitar aplica, recusar fecha) e o aviso das da campanha para o
 *   canvas, com o link para decidir no Laboratório;
 * - o selo "no canvas" na lista e o contador no botão da barra;
 * - o tempo real: a campanha, a série e as sugestões relidas quando o canvas mexe; desinscreve ao sair.
 */

const mock = vi.hoisted(() => ({
  sugestoes: [] as unknown[],
  canais: [] as Array<{ nome: string; ouvintes: Array<{ filtro: Record<string, unknown>; fn: () => void }>; inscrito: boolean }>,
  removidos: [] as string[],
  abrir: vi.fn(),
  sincronizar: vi.fn(),
  decidir: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = () => b;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: tabela === "ponte_sugestoes" ? mock.sugestoes : [], error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => consulta(t),
      functions: { invoke: vi.fn() },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      channel: (nome: string) => {
        const c = { nome, ouvintes: [] as Array<{ filtro: Record<string, unknown>; fn: () => void }>, inscrito: false } as any;
        c.on = (_tipo: string, filtro: Record<string, unknown>, fn: () => void) => {
          c.ouvintes.push({ filtro, fn });
          return c;
        };
        c.subscribe = () => {
          c.inscrito = true;
          return c;
        };
        mock.canais.push(c);
        return c;
      },
      removeChannel: (c: { nome: string }) => {
        mock.removidos.push(c.nome);
        return Promise.resolve();
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/ponte/ponteApi", () => ({
  abrirCampanhaNoLab: mock.abrir,
  sincronizarAgora: mock.sincronizar,
  decidirSugestao: mock.decidir,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaCanvas, { BotaoDoCanvas, SeloNoCanvas, chaveDasPecas, chaveDasSugestoes, enderecoDoProjeto, lerSincronia, useTempoRealDaCampanha, valorLegivel } from "@/components/mesa/CampanhaCanvas";
import { chaves, type Campanha } from "@/components/mesa/mesaV4Api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMP = "d7140376-0000-4000-8000-000000000009";
const PROPOSTA = "22222222-2222-4222-8222-222222222229";
const PROJETO = "33333333-3333-4333-8333-333333333339";

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

const campanha = (sincronia: Record<string, unknown> = {}) =>
  ({ id: CAMP, client_id: CLIENTE, nome: "Halloween do PC", proposta_id: PROPOSTA, status: "planejada", briefing: {}, sincronia }) as unknown as Campanha;

const ligada = () => campanha({ projeto_id: PROJETO, ultima_em: "2026-10-25T15:30:00Z", resumo: { pecas_novas: 2, campos_preenchidos: 3 }, avisos: [] });

function Onde() {
  const l = useLocation();
  return h("span", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}

function montar(filho: any, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    h(MemoryRouter, { initialEntries: ["/mesa"] },
      h(QueryClientProvider, { client: qc },
        h(TooltipProvider, null,
          h(MesaProvider, { valor: valorDaMesa(), children: h(Routes, null, h(Route, { path: "*", element: h("div", null, filho, h(Onde)) })) })))),
  );
  return qc;
}

beforeEach(() => {
  mock.sugestoes = [];
  mock.canais = [];
  mock.removidos = [];
  mock.abrir.mockReset();
  mock.sincronizar.mockReset();
  mock.decidir.mockReset();
});

describe("regras do bloco Canvas", () => {
  it("lê a sincronia da ponte em forma fixa e nunca quebra", () => {
    expect(lerSincronia(ligada())).toEqual({ projetoId: PROJETO, ultima: "2026-10-25T15:30:00Z", pecasNovas: 2, camposPreenchidos: 3, avisos: [] });
    expect(lerSincronia(campanha({ resumo: "x", avisos: [1, " ", "Canvas cheio"] }))).toEqual({ projetoId: null, ultima: null, pecasNovas: 0, camposPreenchidos: 0, avisos: ["Canvas cheio"] });
    expect(lerSincronia({ id: CAMP } as Campanha)).toMatchObject({ projetoId: null });
  });

  it("endereço do Laboratório e valores legíveis", () => {
    expect(enderecoDoProjeto(PROJETO)).toBe(`/laboratorio?aba=projetos&projeto=${PROJETO}`);
    expect(valorLegivel(null)).toBe("vazio");
    expect(valorLegivel(["Pizza", "Combo"])).toBe("Pizza, Combo");
    expect(valorLegivel({ nome: "Plano Pro" })).toBe("Plano Pro");
  });
});

describe("bloco Canvas na campanha", () => {
  it("sem canvas: Montar o canvas cria pela ponte e abre o projeto no Laboratório", async () => {
    mock.abrir.mockResolvedValue({ projeto_id: PROJETO, criado: true });
    montar(h(CampanhaCanvas, { campanha: campanha() }));
    expect(screen.getByText("Ainda sem canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Montar o canvas/ }));
    await waitFor(() => expect(mock.abrir).toHaveBeenCalledWith(CAMP));
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe(`/laboratorio?aba=projetos&projeto=${PROJETO}`));
  });

  it("ligado: mostra o que entrou e Sincronizar agora roda a ponte", async () => {
    mock.sincronizar.mockResolvedValue({ estado: {}, resumo: {}, avisos: [] });
    montar(h(CampanhaCanvas, { campanha: ligada() }));
    expect(screen.getByText(/No Laboratório · sincronizado/)).toBeTruthy();
    expect(screen.getByText(/2 peças novas vieram do canvas · 3 campos vazios preenchidos/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sincronizar agora/ }));
    await waitFor(() => expect(mock.sincronizar.mock.calls).toEqual([[CAMP]]));
    expect(screen.getByRole("button", { name: /Abrir no Laboratório/ })).toBeTruthy();
  });

  it("sugestões do canvas: aceitar aplica, recusar fecha; as da campanha para o canvas viram aviso com link", async () => {
    mock.sugestoes = [
      { id: "s1", campanha_id: CAMP, projeto_id: PROJETO, destino: "campanha", chave: "briefing.oferta", rotulo: "Oferta da campanha", valor_atual: "Exorcismo R$ 89", valor_sugerido: "Exorcismo R$ 79 com limpeza", situacao: "aberta", created_at: "x" },
      { id: "s2", campanha_id: CAMP, projeto_id: PROJETO, destino: "campanha", chave: "briefing.publico", rotulo: "Público", valor_atual: null, valor_sugerido: "Gamers de Curitiba", situacao: "aberta", created_at: "x" },
      { id: "s3", campanha_id: CAMP, projeto_id: PROJETO, destino: "canvas", chave: "no:n4.dados.titulo", rotulo: "Título da oferta no canvas", valor_atual: "a", valor_sugerido: "b", situacao: "aberta", created_at: "x" },
    ];
    mock.decidir.mockResolvedValue({ sugestao: {}, estado: {} });
    montar(h(CampanhaCanvas, { campanha: ligada() }));
    const lista = await screen.findByRole("list", { name: "Sugestões do canvas para a campanha" });
    expect(within(lista).getAllByRole("listitem").length).toBe(2);
    expect(within(lista).getByText("Exorcismo R$ 79 com limpeza")).toBeTruthy();
    expect(within(lista).getByText("vazio")).toBeTruthy();
    fireEvent.click(within(lista).getByRole("button", { name: "Aceitar: Oferta da campanha" }));
    await waitFor(() => expect(mock.decidir).toHaveBeenCalledWith("s1", true));
    fireEvent.click(within(lista).getByRole("button", { name: "Recusar: Público" }));
    await waitFor(() => expect(mock.decidir).toHaveBeenCalledWith("s2", false));
    expect(screen.getByText(/A campanha tem 1 sugestão para o canvas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decidir no Laboratório" }));
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe(`/laboratorio?aba=projetos&projeto=${PROJETO}`));
  });

  it("botão da barra conta as sugestões do canvas e o selo da lista só aparece com canvas ligado", async () => {
    mock.sugestoes = [{ id: "s1", campanha_id: CAMP, projeto_id: PROJETO, destino: "campanha", chave: "x", rotulo: "X", valor_atual: null, valor_sugerido: "y", situacao: "aberta", created_at: "x" }];
    const ir = vi.fn();
    montar(h("div", null, h(BotaoDoCanvas, { campanha: ligada(), onIr: ir }), h(SeloNoCanvas, { campanha: ligada() }), h("span", { "data-testid": "sem" }, h(SeloNoCanvas, { campanha: campanha() }))));
    const botao = await screen.findByRole("button", { name: "Canvas: 1 sugestão do canvas" });
    fireEvent.click(botao);
    expect(ir).toHaveBeenCalled();
    expect(screen.getAllByText("no canvas").length).toBe(1);
    expect(screen.getByTestId("sem").textContent).toBe("");
  });
});

describe("tempo real da campanha", () => {
  function Ouvinte({ c }: { c: Campanha }) {
    useTempoRealDaCampanha(c);
    return null;
  }

  it("escuta a campanha, a série e as sugestões; cada mudança relê as chaves; desinscreve ao sair", async () => {
    const qc = new QueryClient();
    const relidas: string[] = [];
    const original = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((f: { queryKey: unknown[] }) => {
      relidas.push(JSON.stringify(f.queryKey));
      return original(f as never);
    }) as typeof qc.invalidateQueries;
    const tela = render(
      h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa(), children: h(Ouvinte, { c: ligada() }) }))),
    );
    await waitFor(() => expect(mock.canais.length).toBe(1));
    const canal = mock.canais[0];
    expect(canal.inscrito).toBe(true);
    const filtros = canal.ouvintes.map((o) => `${o.filtro.table}:${o.filtro.filter}`);
    expect(filtros).toEqual([`mesa_campanhas:id=eq.${CAMP}`, `ponte_sugestoes:campanha_id=eq.${CAMP}`, `calendario_propostas:id=eq.${PROPOSTA}`]);

    canal.ouvintes[2].fn();
    expect(relidas).toContain(JSON.stringify(chaves.proposta(PROPOSTA)));
    expect(relidas).toContain(JSON.stringify(chaveDasPecas(CLIENTE, CAMP)));
    canal.ouvintes[0].fn();
    expect(relidas).toContain(JSON.stringify(chaves.campanhas(CLIENTE)));
    canal.ouvintes[1].fn();
    expect(relidas).toContain(JSON.stringify(chaveDasSugestoes(CAMP)));

    tela.unmount();
    expect(mock.removidos).toEqual([`campanha-ponte:${CAMP}`]);
  });
});

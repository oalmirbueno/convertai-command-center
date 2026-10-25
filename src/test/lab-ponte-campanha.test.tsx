import { useCallback, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ponte Laboratório ↔ Campanhas, lado do canvas (25/10/2026, dono: "o laboratório do canvas sincronize com a área
 * campanhas ... atualizações e movimento de ambos os lados já atualiza as duas frentes ... sempre complementando
 * e nunca substituindo"):
 * - normalizarCanvas preserva dados.sinc (a marca da ponte);
 * - a mescla de três vias: o que é da pessoa fica, o nó da campanha vem do servidor, o novo dos dois lados entra;
 * - o selo "da campanha" e "na campanha" no nó do quadro;
 * - a faixa Campanha: ligada (link, Sincronizar agora, sugestões com Aceitar) e solta (Montar com custo antes, Ligar).
 */

const ponte = vi.hoisted(() => ({
  lerEstadoDaPonte: vi.fn(),
  sincronizarAgora: vi.fn(),
  montarCampanhaDoCanvas: vi.fn(),
  decidirSugestao: vi.fn(),
  ligarProjetoACampanha: vi.fn(),
  desligarProjeto: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia = (): any => {
    const c: any = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [{ id: "camp-2", nome: "Natal da loja", status: "planejada", periodo_inicio: "2026-12-01", periodo_fim: "2026-12-24" }], error: null }) : c),
      apply: () => c,
    });
    return c;
  };
  const canal: any = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      from: () => cadeia(),
      rpc: () => cadeia(),
      channel: () => canal,
      removeChannel: () => undefined,
      functions: { invoke: vi.fn() },
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x" }, error: null }), createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
    },
  };
});
vi.mock("@/lib/ponte/ponteApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, ...ponte };
});

import QuadroDoLab from "@/components/laboratorio/QuadroDoLab";
import FaixaDaCampanha, { custoDoMontar, frasesDoResumo, rotaDaCampanha } from "@/components/laboratorio/FaixaDaCampanha";
import { normalizarCanvas, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { canvasDiferente, mesclarCanvas, rotuloDaSinc, seloDaSinc, sincDoNo } from "@/lib/laboratorio/sincronia";
import { ErroDaMesa } from "@/lib/mesa/api";

const CAMP = "11111111-2222-4333-8444-555555555555";
const CLIENTE = "aaaaaaaa-0000-4000-8000-0000000000c1";
const PROJETO = "aaaaaaaa-0000-4000-8000-000000000001";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!(globalThis as any).DOMMatrixReadOnly) {
    (globalThis as any).DOMMatrixReadOnly = class {
      m22 = 1;
    };
  }
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
});

const sinc = (chave: string, origem: "campanha" | "canvas" = "campanha") => ({ campanha_id: CAMP, chave, origem, hash: "h1" });

// ------------------------------------------------------------------ regras puras

describe("marca da ponte e mescla (regras puras)", () => {
  it("normalizarCanvas preserva dados.sinc e completa o resto do padrão", () => {
    const c = normalizarCanvas({ nos: [{ id: "o1", tipo: "oferta", x: 1, y: 2, dados: { titulo: "Combo", sinc: sinc("oferta") } }], ligacoes: [] });
    expect(c.nos[0].dados.sinc).toEqual(sinc("oferta"));
    expect(c.nos[0].dados.titulo).toBe("Combo");
    expect(sincDoNo(c.nos[0])).toMatchObject({ chave: "oferta", origem: "campanha" });
  });

  it("selo e rótulo dizem o que o nó é na campanha", () => {
    expect(seloDaSinc(sincDoNo({ dados: { sinc: sinc("peca:c3") } }))).toMatchObject({ texto: "da campanha" });
    expect(seloDaSinc(sincDoNo({ dados: { sinc: sinc("peca:c3", "canvas") } }))!.texto).toBe("na campanha");
    expect(rotuloDaSinc(sinc("peca:c3"))).toContain("peça c3");
    expect(rotuloDaSinc(sinc("fase:lancamento"))).toContain("fase lancamento");
    expect(seloDaSinc(sincDoNo({ dados: {} }))).toBeNull();
  });

  it("mescla: o da pessoa fica, o da campanha vem do servidor, o novo dos dois lados entra, o apagado aqui fica apagado", () => {
    const vista = { x: 10, y: 20, zoom: 0.8 };
    const base: CanvasDoLab = {
      nos: [
        { id: "p1", tipo: "contexto", x: 0, y: 0, dados: { texto: "antes" } },
        { id: "o1", tipo: "oferta", x: 300, y: 0, dados: { titulo: "Combo", sinc: sinc("oferta") } },
        { id: "p2", tipo: "contexto", x: 0, y: 200, dados: { texto: "vai sair" } },
      ],
      ligacoes: [{ id: "l1", de: "p1", para: "o1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const local: CanvasDoLab = {
      nos: [
        { id: "p1", tipo: "contexto", x: 0, y: 0, dados: { texto: "mudei aqui" } },
        { id: "o1", tipo: "oferta", x: 320, y: 40, dados: { titulo: "Combo", sinc: sinc("oferta") } },
        { id: "novo_aqui", tipo: "copy", x: 600, y: 0, dados: { formato: "legenda" } },
      ],
      ligacoes: [{ id: "l1", de: "p1", para: "o1" }, { id: "l2", de: "o1", para: "novo_aqui" }],
      viewport: vista,
    };
    const remoto: CanvasDoLab = {
      nos: [
        { id: "p1", tipo: "contexto", x: 0, y: 0, dados: { texto: "antes" } },
        { id: "o1", tipo: "oferta", x: 300, y: 0, dados: { titulo: "Combo de Natal", sinc: { ...sinc("oferta"), hash: "h2" } } },
        { id: "p2", tipo: "contexto", x: 0, y: 200, dados: { texto: "vai sair" } },
        { id: "c3", tipo: "carrossel", x: 900, y: 0, dados: { tema: "Peça nova", sinc: sinc("peca:c3") } },
      ],
      ligacoes: [{ id: "l1", de: "p1", para: "o1" }, { id: "l3", de: "o1", para: "c3" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const m = mesclarCanvas(base, { ...local, nos: local.nos }, remoto);
    const por = (id: string) => m.nos.filter((n) => n.id === id)[0];
    expect(por("p1").dados.texto).toBe("mudei aqui");
    expect(por("o1").dados.titulo).toBe("Combo de Natal");
    expect(por("o1").x).toBe(320); // a posição na tela é da pessoa
    expect(por("novo_aqui")).toBeTruthy();
    expect(por("c3")).toBeTruthy();
    // p2 foi apagado aqui? Não: p2 não estava no local, estava na base e no remoto sem mudança: fica apagado.
    expect(por("p2")).toBeUndefined();
    expect(m.ligacoes.map((l) => `${l.de}>${l.para}`).sort()).toEqual(["o1>c3", "o1>novo_aqui", "p1>o1"]);
    expect(m.viewport).toEqual(vista);
    expect(canvasDiferente(m, remoto)).toBe(true);
    expect(canvasDiferente(normalizarCanvas(remoto), normalizarCanvas(JSON.parse(JSON.stringify(remoto))))).toBe(false);
  });

  it("nó da campanha que sumiu no servidor sai; nó da pessoa sem mudança acompanha o servidor (a ponte marcou sinc)", () => {
    const base: CanvasDoLab = {
      nos: [
        { id: "o1", tipo: "oferta", x: 0, y: 0, dados: { sinc: sinc("oferta") } },
        { id: "k1", tipo: "carrossel", x: 300, y: 0, dados: { tema: "Meu carrossel" } },
      ],
      ligacoes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const remoto: CanvasDoLab = {
      nos: [{ id: "k1", tipo: "carrossel", x: 300, y: 0, dados: { tema: "Meu carrossel", sinc: sinc("peca:c9", "canvas") } }],
      ligacoes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const m = mesclarCanvas(base, base, remoto);
    expect(m.nos.map((n) => n.id)).toEqual(["k1"]);
    expect(sincDoNo(m.nos[0])).toMatchObject({ chave: "peca:c9", origem: "canvas" });
  });

  it("frases do resumo, rota da campanha e custo do montar", () => {
    expect(frasesDoResumo({ nos_novos: 2, pecas_novas: 1, campos_preenchidos: 0 })).toBe("2 nós novos, 1 peça nova");
    expect(rotaDaCampanha(CLIENTE, CAMP)).toBe(`/mesa?client=${CLIENTE}&aba=campanhas&campanha=${CAMP}`);
    expect(custoDoMontar(new ErroDaMesa("confirmar_custo", "Confirme", { total_usd: 0.42 }))).toBe(0.42);
    expect(custoDoMontar(new ErroDaMesa("outro", "x", {}))).toBeNull();
  });
});

// ------------------------------------------------------------------ selo no quadro

function montarQuadro(canvas: CanvasDoLab) {
  function Teste() {
    const [c, setC] = useState<CanvasDoLab>(canvas);
    const atual = useRef(c);
    const mudar = useCallback((fn: (x: CanvasDoLab) => CanvasDoLab) => {
      const novo = fn(atual.current);
      atual.current = novo;
      setC(novo);
    }, []);
    return (
      <div style={{ width: 1200, height: 800 }}>
        <QuadroDoLab canvas={c} execucoes={{}} selecionado={null} rodandoNo={null} onSelecionar={() => undefined} onMudarCanvas={mudar} onTentarLigar={() => null} onRodar={() => undefined} onSoltar={() => undefined} onViewport={() => undefined} projetoId={PROJETO} />
      </div>
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReactFlowProvider>
        <Teste />
      </ReactFlowProvider>
    </QueryClientProvider>,
  );
}

describe("selo da campanha no nó do quadro", () => {
  it("o nó que veio da campanha mostra 'da campanha' e o que virou peça mostra 'na campanha'; o nó solto não tem selo", async () => {
    montarQuadro({
      nos: [
        { id: "o1", tipo: "oferta", x: 0, y: 0, dados: { titulo: "Combo", sinc: sinc("oferta") } },
        { id: "k1", tipo: "carrossel", x: 400, y: 0, dados: { tema: "Meu carrossel", sinc: sinc("peca:c9", "canvas") } },
        { id: "s1", tipo: "contexto", x: 800, y: 0, dados: { texto: "solto" } },
      ],
      ligacoes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    await waitFor(() => expect(document.querySelector('[data-no-do-quadro="o1"]')).toBeTruthy());
    const o1 = document.querySelector('[data-no-do-quadro="o1"]') as HTMLElement;
    const selo = o1.querySelector("[data-selo-da-campanha]") as HTMLElement;
    expect(selo.textContent).toContain("da campanha");
    expect(selo.getAttribute("title")).toContain("a oferta da campanha");
    expect((document.querySelector('[data-no-do-quadro="k1"] [data-selo-da-campanha]') as HTMLElement).textContent).toContain("na campanha");
    expect(document.querySelector('[data-no-do-quadro="s1"] [data-selo-da-campanha]')).toBeNull();
  });
});

// ------------------------------------------------------------------ faixa Campanha

function montarFaixa(clienteId: string | null) {
  const aoMudar = vi.fn();
  const antes = vi.fn(() => Promise.resolve());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <FaixaDaCampanha projetoId={PROJETO} clienteId={clienteId} antesDeChamar={antes} aoMudarCanvas={aoMudar} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { aoMudar, antes };
}

const sugestao = (destino: "canvas" | "campanha", id: string) => ({ id, campanha_id: CAMP, projeto_id: PROJETO, destino, chave: "oferta", rotulo: "Oferta", valor_atual: "Combo", valor_sugerido: "Combo de Natal", situacao: "aberta", created_at: "x" });

beforeEach(() => {
  Object.values(ponte).forEach((f) => f.mockReset());
});

describe("faixa Campanha no editor", () => {
  it("ligada: link para a campanha, estado, Sincronizar agora e Aceitar a sugestão da campanha", async () => {
    const estado = {
      ligada: true,
      campanha: { id: CAMP, nome: "Black Friday", client_id: CLIENTE },
      projeto: { id: PROJETO, nome: "Canvas BF", versao: 3 },
      sincronia: { ultima_em: new Date().toISOString(), resumo: { nos_novos: 3, pecas_novas: 2 } },
      sugestoes: [sugestao("canvas", "s1"), sugestao("campanha", "s2")],
    };
    ponte.lerEstadoDaPonte.mockResolvedValue(estado);
    ponte.sincronizarAgora.mockResolvedValue({ estado, resumo: { nos_novos: 1, nos_atualizados: 0, pecas_novas: 0, campos_preenchidos: 2, sugestoes: 0 }, avisos: [] });
    ponte.decidirSugestao.mockResolvedValue({ sugestao: { ...sugestao("canvas", "s1"), situacao: "aceita" }, estado: { ...estado, sugestoes: [sugestao("campanha", "s2")] } });
    const { aoMudar, antes } = montarFaixa(CLIENTE);
    const faixa = await screen.findByRole("region", { name: "Campanha deste canvas" });
    expect(faixa.getAttribute("data-faixa-da-campanha")).toBe("ligada");
    const link = within(faixa).getByRole("link", { name: "Black Friday" });
    expect(link.getAttribute("href")).toBe(rotaDaCampanha(CLIENTE, CAMP));
    expect(within(faixa).getByText(/3 nós novos, 2 peças novas/)).toBeTruthy();
    expect(within(faixa).getByText(/1 sugestão do canvas espera na campanha/)).toBeTruthy();

    fireEvent.click(within(faixa).getByRole("button", { name: /Sincronizar agora/ }));
    await waitFor(() => expect(ponte.sincronizarAgora).toHaveBeenCalledWith(CAMP));
    expect(antes).toHaveBeenCalled();
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());

    const lista = within(faixa).getByRole("list", { name: "Sugestões da campanha para o canvas" });
    expect(within(lista).getByText("Combo de Natal")).toBeTruthy();
    fireEvent.click(within(lista).getByRole("button", { name: /Aceitar: Oferta/ }));
    await waitFor(() => expect(ponte.decidirSugestao).toHaveBeenCalledWith("s1", true));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Sugestões da campanha para o canvas" })).toBeNull());
  });

  it("solta com cliente: Montar mostra o custo antes e só monta confirmado; Ligar lista as campanhas do cliente", async () => {
    ponte.lerEstadoDaPonte.mockResolvedValue({ ligada: false, campanha: null, projeto: { id: PROJETO, nome: "Canvas", versao: 1 }, sincronia: {}, sugestoes: [] });
    ponte.montarCampanhaDoCanvas.mockImplementation((_id: string, confirmado?: boolean) =>
      confirmado ? Promise.resolve({ campanha_id: CAMP, custo_usd: 0.42, projeto_id: PROJETO }) : Promise.reject(new ErroDaMesa("confirmar_custo", "Confirme o custo", { total_usd: 0.42 })),
    );
    ponte.ligarProjetoACampanha.mockResolvedValue({ estado: undefined, resumo: { nos_novos: 4 }, avisos: [] });
    const { aoMudar } = montarFaixa(CLIENTE);
    const faixa = await screen.findByRole("region", { name: "Campanha deste canvas" });
    expect(faixa.getAttribute("data-faixa-da-campanha")).toBe("solta");

    fireEvent.click(within(faixa).getByRole("button", { name: /Montar campanha a partir deste canvas/ }));
    await waitFor(() => expect(ponte.montarCampanhaDoCanvas).toHaveBeenCalledWith(PROJETO, false));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText(/Montar a campanha a partir do canvas/)).toBeTruthy();
    expect(ponte.montarCampanhaDoCanvas).toHaveBeenCalledTimes(1);
    const confirmar = document.querySelector("[data-confirmar-custo]") as HTMLElement;
    expect(confirmar.textContent).toContain("0,42");
    fireEvent.click(confirmar);
    await waitFor(() => expect(ponte.montarCampanhaDoCanvas).toHaveBeenCalledWith(PROJETO, true));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());

    fireEvent.click(within(faixa).getByRole("button", { name: /Ligar a uma campanha/ }));
    const ligar = await screen.findByRole("button", { name: "Ligar à campanha Natal da loja" });
    fireEvent.click(ligar);
    await waitFor(() => expect(ponte.ligarProjetoACampanha).toHaveBeenCalledWith(PROJETO, "camp-2"));
  });

  it("sem cliente: pede o cliente e não oferece Montar; ponte fora do ar: a faixa some", async () => {
    ponte.lerEstadoDaPonte.mockResolvedValue({ ligada: false, campanha: null, projeto: null, sincronia: {}, sugestoes: [] });
    montarFaixa(null);
    const faixa = await screen.findByRole("region", { name: "Campanha deste canvas" });
    expect(within(faixa).queryByRole("button", { name: /Montar campanha/ })).toBeNull();
    expect(within(faixa).getByText(/Escolha o cliente no Canvas Studio/)).toBeTruthy();
  });

  it("a ponte não responde: a faixa não aparece e o editor segue", async () => {
    ponte.lerEstadoDaPonte.mockRejectedValue(new Error("função fora do ar"));
    montarFaixa(CLIENTE);
    await waitFor(() => expect(ponte.lerEstadoDaPonte).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("region", { name: "Campanha deste canvas" })).toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

const linha = {
  id: "cartao-colorido",
  nome: "Cartão de visita · colorido",
  categoria: "cartao",
  tags: ["cartao"],
  largura: 2300,
  altura: 1650,
  largura_trabalho: 1280,
  altura_trabalho: 918,
  luminancia_media: 0.9,
  ativo: true,
  slots: [{ indice: 1, papel: "arte", nome: "x", so_px: [1024, 663], area_segura: [0, 0, 1, 1], luminancia_superficie: 0.9, px_na_tela: 700 }],
  caminhos: {
    alta: { base: "a/b.jpg", vazio: "a/v.jpg", ganho: "a/g.png", uv: "a/u.png", mapa: "a/m.png" },
    trabalho: { base: "t/b.jpg", vazio: "t/v.jpg", ganho: "t/g.png", uv: "t/u.png", mapa: "t/m.png" },
    thumb: "thumb.jpg",
  },
};

const sugerir = vi.fn();
// Kit estável entre renders (o hook real devolve o mesmo objeto do cache); semKit liga o caso sem logo.
const kits = vi.hoisted(() => ({
  semKit: false,
  comKit: { data: { client_id: "c", paleta: [{ nome: "Verde", hex: "#0a7", papel: "primaria" }] } },
  vazio: { data: null },
  marcas: { data: [] as unknown[] },
}));

vi.mock("@/lib/mockups/api", async () => {
  const { normalizarMockup } = await vi.importActual<typeof import("@/lib/mockups/catalogo")>("@/lib/mockups/catalogo");
  return {
    lerCatalogoDeMockups: vi.fn(async () => ({ itens: [normalizarMockup(linha)], semBanco: false })),
    lerTexturas: vi.fn(async () => []),
    lerAplicacoes: vi.fn(async () => []),
    urlAssinada: vi.fn(async () => "blob:thumb"),
    carregarImagem: vi.fn(),
    liberarCamadas: vi.fn(),
    sugerirMockups: (...a: unknown[]) => sugerir(...a),
    salvarAplicacao: vi.fn(),
    enviarParaArquivos: vi.fn(),
    estimarCena: vi.fn(async () => ({ estimativa_usd: 0.04, modelo_id: "m", modelo_nome: "m" })),
    gerarCena: vi.fn(),
  };
});
vi.mock("@/lib/mockups/renderizar", () => ({
  carregarLogos: vi.fn(async () => []),
  paraBlob: vi.fn(),
  renderizarMockup: vi.fn(() => new Promise(() => {})),
  slotDaCena: vi.fn(),
}));
vi.mock("@/components/mesa/contextoDoCliente", () => ({ useKitDoCliente: () => (kits.semKit ? kits.vazio : kits.comKit) }));
vi.mock("@/lib/mesa/marcas", () => ({ useMarcasDoCliente: () => kits.marcas }));

import EstudioDeMockups from "@/components/mesa-identidade/EstudioDeMockups";
import { liberarCamadas } from "@/lib/mockups/api";
import { paraBlob, renderizarMockup } from "@/lib/mockups/renderizar";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EstudioDeMockups clientId="11111111-1111-4111-8111-111111111111" marcaId={null} />
    </QueryClientProvider>,
  );
}

describe("estúdio de mockups na tela", () => {
  beforeEach(() => {
    sugerir.mockReset();
    try {
      window.localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
  });

  it("abre na sequência com as 5 etapas e as categorias com contagem", async () => {
    montar();
    expect(await screen.findByText("Onde mostrar a marca")).toBeTruthy();
    for (const e of ["Categorias", "Sugestão", "Aplicar", "Fachada e redes", "Enviar"]) expect(screen.getAllByText(e).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Cartão/ })).toBeTruthy();
  });

  it("Sugerir chama o Jev pela função e marca os sugeridos", async () => {
    sugerir.mockResolvedValue({ sugestoes: [{ mockup_id: "cartao-colorido", nota: 2.6, confianca: 0.8 }], segmento: "padaria", aviso: null, custo_usd: 0 });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Sugerir mockups/ }));
    await waitFor(() => expect(sugerir).toHaveBeenCalledTimes(1));
    const pedido = sugerir.mock.calls[0][0] as { candidatos: Array<{ id: string }> };
    expect(pedido.candidatos.map((c) => c.id)).toEqual(["cartao-colorido"]);
    expect(await screen.findByText(/Aplicar a marca em 1/)).toBeTruthy();
    expect(await screen.findByText(/nota 3.6 de 4/)).toBeTruthy();
  });

  it("sem Jev a tela segue com a sequência e mostra o motivo", async () => {
    sugerir.mockRejectedValue(new Error("typesafe_529"));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Sugerir mockups/ }));
    expect(await screen.findByText(/Sem sugestão agora: typesafe_529/)).toBeTruthy();
  });

  it("sem kit e sem logo, o lote monta cada mockup uma vez e termina (CT-02)", async () => {
    // Antes: logos.data undefined + `|| []` = lista nova a cada render; o efeito do lote
    // recomeçava a cada setProntos e remontava o 1º mockup sem parar ("Montando" para sempre).
    kits.semKit = true;
    const montarMockup = vi.mocked(renderizarMockup);
    montarMockup.mockReset();
    montarMockup.mockImplementation(async () => ({ canvas: {} as HTMLCanvasElement, escolhas: [], webgl: false }));
    vi.mocked(paraBlob).mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    vi.mocked(liberarCamadas).mockClear();
    const url = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const antes = { criar: url.createObjectURL, revogar: url.revokeObjectURL };
    url.createObjectURL = vi.fn(() => "blob:previa");
    url.revokeObjectURL = vi.fn();
    try {
      const tela = montar();
      fireEvent.click(await screen.findByRole("button", { name: "Escolher à mão" }));
      // ~3 s em fatias (o lote espera 250 ms antes de começar e cada volta é assíncrona).
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
      }
      expect(montarMockup).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Montando")).toBeNull();
      expect(screen.getByText("O kit desta marca está sem logo: os mockups saem só com as cores.")).toBeTruthy();
      // Ao sair do estúdio, as camadas de trabalho do mockup montado são soltas (CT-03).
      tela.unmount();
      expect(liberarCamadas).toHaveBeenCalledWith(expect.objectContaining({ base: "t/b.jpg", mapa: "t/m.png" }));
      expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:previa");
    } finally {
      url.createObjectURL = antes.criar;
      url.revokeObjectURL = antes.revogar;
      kits.semKit = false;
      montarMockup.mockReset();
      montarMockup.mockImplementation(() => new Promise(() => {}));
    }
  }, 30000);

  it("o código segue o piso de compatibilidade (sem gap em flex, sem aspect-ratio)", () => {
    for (const arq of ["src/components/mesa-identidade/EstudioDeMockups.tsx", "src/components/mesa-identidade/EditorDeCena.tsx"]) {
      const fonte = readFileSync(arq, "utf8");
      expect(fonte).not.toMatch(/aspect-\[|aspect-video|aspect-square|aspectRatio/);
      const flexComGap = fonte.split("\n").filter((l) => /className="[^"]*\bflex\b[^"]*\bgap-/.test(l));
      expect(flexComGap).toEqual([]);
    }
  });
});

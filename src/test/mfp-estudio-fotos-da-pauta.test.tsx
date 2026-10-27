import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FolderOpen, GalleryHorizontal, Layers, Package } from "lucide-react";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";

const m = vi.hoisted(() => ({
  chamarFuncao: vi.fn(),
  salvarCanvas: vi.fn(),
  gerarNoCanvas: vi.fn(),
  preparar: vi.fn(),
  fotos: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) })) })) } }));
vi.mock("@/components/mesa/MesaContexto", async (original) => ({
  ...(await original<object>()),
  useMesa: () => ({ clientId: "c1", catalogo: [], atualizarCusto: vi.fn(), saldoUsd: null }),
  useMarcaDaMesa: () => ({ marca: { id: "m1" }, marcas: [] }),
  useUrlDaMesa: () => ({ data: "https://example.test/f.jpg" }),
  ImagemDaMesa: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock("@/components/mesa/Custo", () => ({
  BotaoComCusto: ({ rotulo, executar, aoConcluir, disabled, partes }: { rotulo: string; executar: () => Promise<unknown>; aoConcluir?: (r: unknown) => void; disabled?: boolean; partes: () => unknown }) =>
    <button type="button" disabled={disabled} onClick={async () => { partes(); const r = await executar(); aoConcluir?.(r); }}>{rotulo}</button>,
  useAvisarErro: () => vi.fn(),
}));
vi.mock("@/components/mesa/Seletores", () => ({ SeletorDeModelo: () => null }));
vi.mock("@/lib/mesa/api", async (original) => ({ ...(await original<object>()), chamarFuncao: m.chamarFuncao, padraoPara: () => ({ id: "img-1" }) }));
vi.mock("@/components/mesa-foto/fotoApi", async (original) => ({
  ...(await original<object>()),
  useFotos: () => ({ data: m.fotos, isLoading: false }),
  useBiblioteca: () => ({ data: [
    { id: "est-1", tipo: "prompt", categoria: "estilo", titulo: "Editorial claro", tags: [], destaque: false, storage_path: "x.png", imagem_url: null, miniatura_url: null, uso: "", prompt_pt: "" },
    { id: "est-2", tipo: "prompt", categoria: "luz", titulo: "Fim de tarde", tags: [], destaque: true, storage_path: "y.png", imagem_url: null, miniatura_url: null, uso: "", prompt_pt: "" },
  ], isLoading: false }),
  useKits: () => ({ data: [{ id: "k1", nome: "Sérum", refs: [{ imagem_id: "a" }] }] }),
  acrescentarFotos: vi.fn(),
  invalidarFotos: vi.fn(),
}));
vi.mock("@/components/mesa-foto/Comuns", async (original) => ({
  ...(await original<object>()),
  MiniaturaDaFoto: ({ foto }: { foto: { nome: string } }) => <img alt={foto.nome} />,
  useMesaFoto: () => ({ kitId: "k1" }),
}));
vi.mock("@/components/mesa-foto/EtapaBiblioteca", () => ({ ImagemDaBiblioteca: ({ item }: { item: { titulo: string } }) => <img alt={item.titulo} />, temImagem: () => true }));
vi.mock("@/components/mesa-foto/SeletorDeFotos", () => ({ default: () => null }));
vi.mock("@/components/mesa-foto/AcoesProDaFoto", () => ({ default: () => null }));
vi.mock("@/components/mesa-foto/EscolhaDoProduto", () => ({ default: () => <p>Produto: Sérum</p>, capaDoKit: () => null }));
vi.mock("@/components/mesa-foto/EscolhaDoModeloDaFoto", () => ({ default: ({ onEscolher }: { onEscolher: (p: unknown) => void }) => <button type="button" onClick={() => onEscolher({ tipo: "persona", id: "p1", nome: "Ana" })}>Escolher Ana</button> }));
vi.mock("@/components/mesa-foto/modelosApi", async (original) => ({ ...(await original<object>()), usePersonas: () => ({ data: [{ id: "p1", nome: "Ana", versao: 3, ancora_imagem_id: "anc", status: "pronta" }] }), useImagensDaPersona: () => ({ data: [] }) }));
vi.mock("@/components/mesa-foto/clonesApi", async (original) => ({ ...(await original<object>()), useClones: () => ({ data: [] }) }));
vi.mock("@/components/mesa-foto/canvasApi", async (original) => ({ ...(await original<object>()), salvarCanvas: m.salvarCanvas, gerarNoCanvas: m.gerarNoCanvas, useCanvases: () => ({ data: [] }) }));
vi.mock("@/components/mesa-foto/agendaApi", async (original) => ({ ...(await original<object>()), prepararPostDeFotos: m.preparar, useItensParaFotos: () => ({ data: [] }), invalidarPostsDeFotos: vi.fn() }));
vi.mock("@/components/sistema/JanelaCentral", () => ({ default: ({ aberta, children }: { aberta: boolean; children: ReactNode }) => (aberta ? <div>{children}</div> : null) }));
vi.mock("@/components/mesa/ImagemComZoom", () => ({ default: ({ alt }: { alt: string }) => <div role="img" aria-label={`Prévia: ${alt}`} /> }));

import { BancadaDeFotos } from "@/components/mesa/BancadaDaPauta";
import GerarFotosDaPauta from "@/components/mesa/GerarFotosDaPauta";
import ProdutoEModeloDaPauta from "@/components/mesa/ProdutoEModeloDaPauta";
import CarrosselDaPauta from "@/components/mesa/CarrosselDaPauta";
import { MontarOPost } from "@/components/mesa-foto/EtapaAgenda";

const foto = (id: string, nome: string, extra: Partial<FotoDoAcervo> = {}): FotoDoAcervo => ({ id, client_id: "c1", nome, storage_bucket: "mesa", storage_path: `c1/${id}.jpg`, origem: "mesa", pasta: null, categoria: null, tags: [], descricao: null, ativa: true, derivada_de: null, gerada: false, modo: null, kit_id: null, aprovada: true, largura: 1080, altura: 1350, criado_em: "2026-10-01T00:00:00Z", referencia_web: false, ...extra });
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const comCache = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  sessionStorage.clear();
  localStorage.clear();
  m.fotos = [foto(A, "Sala antes"), foto(B, "Sala depois"), foto("c", "Produto", { largura: 600, altura: 750 })];
});

const principais = [
  { id: "acervo", nome: "Acervo", icone: FolderOpen },
  { id: "produto", nome: "Produto + modelo", icone: Package },
  { id: "carrossel", nome: "Carrossel", icone: GalleryHorizontal },
];

describe("Estúdio da pauta de fotos: 4 ações claras", () => {
  it("mostra Gerar, Acervo, Produto + modelo e Carrossel; as avulsas vão para Mais ferramentas", () => {
    const abrir = vi.fn();
    render(<BancadaDeFotos titulo="Pauta" fotos={[]} principais={principais} extras={[{ id: "combinar", nome: "Combinar produtos e cenários", icone: Layers, onAbrir: abrir }]}><p>painéis</p></BancadaDeFotos>);
    const trilho = screen.getByRole("navigation", { name: "Ferramentas do estúdio" });
    const nomes = within(trilho).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(nomes.slice(0, 4)).toEqual(["Gerar", "Acervo", "Produto + modelo", "Carrossel"]);
    expect(nomes).not.toContain("Combinar produtos e cenários");
    fireEvent.click(within(trilho).getByRole("button", { name: "Mais ferramentas" }));
    fireEvent.click(screen.getByRole("button", { name: "Combinar produtos e cenários" }));
    expect(abrir).toHaveBeenCalled();
  });
});

describe("Gerar manda contexto, estilo e referências com papel", () => {
  it("o corpo leva a direção da pauta, o estilo escolhido e antes/depois marcados", async () => {
    m.chamarFuncao.mockResolvedValue({ imagem: foto("nova", "Foto nova", { gerada: true, aprovada: false }), custo_usd: 0.04, avisos: [] });
    const onFotos = vi.fn();
    comCache(<GerarFotosDaPauta taskId="t1" titulo="Reforma da sala" direcao={{ tema: "Reforma da sala", cenario: "sala clara" }} referencias={[{ imagem_id: B, papel: "depois" }, { imagem_id: A, papel: "antes" }]} onReferencias={vi.fn()} onFotos={onFotos} />);
    expect(screen.getByRole("radiogroup", { name: "Estilo da foto" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Editorial claro/ }));
    expect(screen.getByText(/Antes e depois: a foto sai como comparação fiel/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Gerar/ }));
    await waitFor(() => expect(m.chamarFuncao).toHaveBeenCalled());
    const [funcao, corpo] = m.chamarFuncao.mock.calls[0];
    expect(funcao).toBe("mesa-foto");
    expect(corpo).toMatchObject({ acao: "foto_da_pauta_gerar", client_id: "c1", task_id: "t1", titulo: "Reforma da sala", guia: { modo: "biblioteca", prompt_id: "est-1" }, modelo_imagem_id: "img-1", formato: "4:5", marca_id: "m1" });
    expect(corpo.pedido).toMatch(/sala clara/);
    expect(corpo.referencias).toEqual([{ imagem_id: B, papel: "depois" }, { imagem_id: A, papel: "antes" }]);
    await waitFor(() => expect(onFotos).toHaveBeenCalledWith(["nova"]));
  });

  it("trocar o papel de uma referência chega na lista", () => {
    const onReferencias = vi.fn();
    comCache(<GerarFotosDaPauta taskId="t1" titulo="Pauta" referencias={[{ imagem_id: A, papel: "produto" }]} onReferencias={onReferencias} onFotos={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Papel de Sala antes" }), { target: { value: "antes" } });
    expect(onReferencias).toHaveBeenCalledWith([{ imagem_id: A, papel: "antes" }]);
  });
});

describe("Produto + modelo chama o motor do Combinar", () => {
  it("monta o Canvas com o produto e a modelo e gera pelo motor escolhido", async () => {
    m.salvarCanvas.mockImplementation(async (c: object) => ({ ...c, id: "cv1" }));
    m.gerarNoCanvas.mockResolvedValue({ imagem: foto("comb", "Combinação", { gerada: true }) });
    const onFotos = vi.fn();
    comCache(<ProdutoEModeloDaPauta taskId="t1" titulo="Sérum no balcão" onFotos={onFotos} />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Combinar" }));
    await waitFor(() => expect(m.gerarNoCanvas).toHaveBeenCalledTimes(1));
    const canvas = m.salvarCanvas.mock.calls[0][0] as { nos: { tipo: string; dados: Record<string, unknown> }[] };
    expect(canvas.nos.find((n) => n.tipo === "produto")?.dados.kit_id).toBe("k1");
    expect(canvas.nos.find((n) => n.tipo === "modelo")?.dados).toMatchObject({ modelo_id: "p1", versao: 3 });
    expect(String(canvas.nos.find((n) => n.tipo === "texto")?.dados.texto)).toMatch(/Sérum no balcão/);
    expect(m.gerarNoCanvas).toHaveBeenCalledWith(expect.objectContaining({ canvasId: "cv1", motorId: "img-1", qualidade: "alta" }));
    await waitFor(() => expect(onFotos).toHaveBeenCalledWith(["comb"]));
  });
});

describe("Carrossel monta e entrega", () => {
  it("reordena, define capa e avisa foto abaixo da alta qualidade", () => {
    const onOrdem = vi.fn();
    render(<CarrosselDaPauta fotos={m.fotos as FotoDoAcervo[]} onOrdem={onOrdem} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 lâminas. A primeira é a capa. 1 abaixo de 1080 px.");
    fireEvent.click(screen.getByRole("button", { name: "Usar lâmina 3 como capa" }));
    expect(onOrdem).toHaveBeenLastCalledWith(["c", A, B]);
    fireEvent.click(screen.getByRole("button", { name: "Mover lâmina 1 para depois" }));
    expect(onOrdem).toHaveBeenLastCalledWith([B, A, "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Tirar lâmina 2" }));
    expect(onOrdem).toHaveBeenLastCalledWith([A, "c"]);
  });

  it("no Estúdio, a ordem do carrossel é a que vai para a Agenda", async () => {
    m.preparar.mockResolvedValue({ trabalho: { id: "tr1", cards: [] }, task: { id: "t1" }, recusadas: [], avisos: [], item_criado: false });
    const onPronto = vi.fn();
    comCache(<MontarOPost fotosIniciais={[A, B]} post={null} taskInicial="t1" destinoFixo estudio={{ taskId: "t1", onSelecionadas: vi.fn(), titulo: "Pauta", principais }} onPronto={onPronto} onCancelar={vi.fn()} />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Ferramentas do estúdio" })).getByRole("button", { name: "Carrossel" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar lâmina 2 como capa" }));
    fireEvent.click(screen.getByRole("button", { name: /Preparar na Agenda/ }));
    await waitFor(() => expect(m.preparar).toHaveBeenCalledTimes(1));
    expect(m.preparar.mock.calls[0][0]).toMatchObject({ clientId: "c1", imagemIds: [B, A], taskId: "t1" });
    await waitFor(() => expect(onPronto).toHaveBeenCalledWith("tr1", "t1"));
  });
});

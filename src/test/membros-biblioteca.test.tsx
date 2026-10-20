import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AreaDeMembros from "@/pages/AreaDeMembros";
import type { Catalogo, Produto } from "@/lib/membros/modelo";
const mocks = vi.hoisted(() => ({
  catalogo: vi.fn(),
  materiais: vi.fn(),
  arquivo: vi.fn(),
  progresso: vi.fn(),
  logout: vi.fn(),
  role: "member",
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "usuario" },
    profile: { role: mocks.role },
    logout: mocks.logout,
  }),
}));
vi.mock("@/lib/membros/api", () => ({
  carregarCatalogo: mocks.catalogo,
  carregarMateriais: mocks.materiais,
  abrirArquivo: mocks.arquivo,
  gravarProgresso: mocks.progresso,
  reiniciarTeste: vi.fn(),
  mensagemDoErro: () => "Falha de conexão. Tente novamente.",
}));
vi.mock("@/lib/membros/aprendizado", () => ({
  carregarLista: vi.fn(async () => []),
  carregarFunil: vi.fn(async () => []),
  favoritar: vi.fn(async () => {}),
  carregarComunidade: vi.fn(async () => []),
  salvarConversa: vi.fn(async () => {}),
}));
vi.mock("@/components/membros/PdfSeguro", () => ({
  default: ({ titulo }: { titulo: string }) => (
    <section aria-label={`Leitor de PDF: ${titulo}`}>
      PDF lido dentro da biblioteca
    </section>
  ),
}));
const produto = (v: Partial<Produto> = {}): Produto => ({
  id: "p",
  titulo: "Kit de marca",
  descricao: "Documentos para trabalhar sua marca",
  categoria: "Kits",
  formato: "Arquivos",
  capa_url: null,
  estado: "publicado",
  gratuito: false,
  destaque: true,
  checkout_url: "https://example.com/oferta",
  condicoes: "Prazo definido na compra",
  ordem: 0,
  origens: [],
  progresso: 0,
  ultimo_material: null,
  ...v,
});
function montar(inicio = "/membros") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <QueryClientProvider client={qc}>
        <AreaDeMembros />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.role = "member";
  mocks.catalogo.mockResolvedValue({
    produtos: [produto()],
    pendentes: [],
  } satisfies Catalogo);
  mocks.materiais.mockResolvedValue({ materiais: [], progresso: [] });
});
describe("biblioteca integrada", () => {
  it("abre mesma biblioteca na visão do cliente sem salvar progresso", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({
      pessoa: { id: "cliente", nome: "Cliente de teste" },
      produtos: [produto({ origens: ["manual"] })],
      pendentes: [],
    });
    mocks.materiais.mockResolvedValue({
      materiais: [
        {
          id: "m",
          produto_id: "p",
          titulo: "Guia",
          tipo: "texto",
          texto: "Conteúdo autorizado",
          arquivo: null,
          permite_download: false,
          ordem: 0,
        },
      ],
      progresso: [],
    });
    montar("/membros?visao=cliente&produto=p");
    expect(await screen.findByText("Conteúdo autorizado")).toBeInTheDocument();
    expect(mocks.catalogo).toHaveBeenCalledWith("cliente", undefined);
    expect(mocks.materiais).toHaveBeenCalledWith("p", "cliente", undefined);
    expect(
      screen.getByRole("button", { name: "Marcar como concluído" }),
    ).toBeDisabled();
    expect(mocks.progresso).not.toHaveBeenCalled();
    expect(screen.getByText("Visão de Cliente de teste")).toBeInTheDocument();
  });
  it("mostra estado vazio sem inventar produtos", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [], pendentes: [] });
    montar();
    expect(
      await screen.findByText("Sua biblioteca começa aqui"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Explorar produtos")).not.toBeInTheDocument();
  });
  it("mantém conteúdo bloqueado sem buscar materiais", async () => {
    montar("/membros?produto=p");
    expect(
      await screen.findByRole("link", { name: "Ver oferta no checkout" }),
    ).toHaveAttribute("href", "https://example.com/oferta");
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(screen.getByText("Painel Aceleriq").closest("a")).toHaveAttribute(
      "href",
      "/solucoes",
    );
  });
  it("não convida comprador a comprar novamente", async () => {
    mocks.catalogo.mockResolvedValue({
      produtos: [produto({ origens: ["compra"] })],
      pendentes: [],
    });
    montar("/membros?produto=p");
    expect(
      await screen.findByText(
        "Os materiais deste produto ainda não estão disponíveis.",
      ),
    ).toBeInTheDocument();
    expect(mocks.materiais).toHaveBeenCalledWith("p", undefined, undefined);
    expect(
      screen.queryByRole("link", { name: "Ver oferta no checkout" }),
    ).not.toBeInTheDocument();
  });
  it("mostra pendência de pagamento real recebida", async () => {
    mocks.catalogo.mockResolvedValue({
      produtos: [produto()],
      pendentes: [{ produto_id: "p", estado: "pendente" }],
    });
    montar("/membros?produto=p");
    expect(await screen.findByText(/Pagamento pendente/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Ver oferta no checkout" }),
    ).not.toBeInTheDocument();
  });
  it("mostra erro recuperável em vez de biblioteca vazia", async () => {
    mocks.catalogo.mockRejectedValue(new Error("rede"));
    montar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falha de conexão",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(mocks.catalogo).toHaveBeenCalledTimes(2));
  });
  it("busca sem resultados pode ser limpa", async () => {
    montar();
    await screen.findByPlaceholderText("Buscar na biblioteca");
    fireEvent.change(screen.getByPlaceholderText("Buscar na biblioteca"), {
      target: { value: "inexistente" },
    });
    expect(screen.getByText("Nenhum produto encontrado")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Limpar busca"));
    expect(screen.getByText("Conhecer produto")).toBeInTheDocument();
  });
  it("não mostra administração para membro", async () => {
    montar();
    await screen.findByText("Conhecer produto");
    expect(
      screen.queryByRole("link", { name: "Administrar biblioteca" }),
    ).not.toBeInTheDocument();
  });
  it("produto removido tem saída clara pela URL direta", async () => {
    montar("/membros?produto=removido");
    expect(
      await screen.findByText("Este produto está indisponível."),
    ).toBeInTheDocument();
  });
  it("material de texto pode ser concluído sem download", async () => {
    mocks.catalogo.mockResolvedValue({
      produtos: [produto({ origens: ["compra"] })],
      pendentes: [],
    });
    mocks.materiais.mockResolvedValue({
      materiais: [
        {
          id: "m",
          produto_id: "p",
          titulo: "Guia",
          tipo: "texto",
          texto: "Conteúdo autorizado",
          arquivo: null,
          permite_download: false,
          ordem: 0,
        },
      ],
      progresso: [],
    });
    mocks.progresso.mockResolvedValue(undefined);
    montar("/membros?produto=p");
    expect(await screen.findByText("Conteúdo autorizado")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Marcar como concluído" }),
    );
    await waitFor(() =>
      expect(mocks.progresso).toHaveBeenCalledWith("m", 0, 0, true, undefined),
    );
    expect(
      screen.queryByRole("button", { name: "Baixar arquivo" }),
    ).not.toBeInTheDocument();
  });
  it("testa como membro sem links de administração e salva no progresso separado", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({
      produtos: [produto({ origens: ["manual"] })],
      pendentes: [],
    });
    mocks.materiais.mockResolvedValue({
      materiais: [
        {
          id: "m",
          produto_id: "p",
          titulo: "Aula de teste",
          tipo: "texto",
          texto: "Leitura liberada",
          arquivo: null,
          permite_download: false,
          ordem: 0,
        },
      ],
      progresso: [],
    });
    montar("/membros?modo=cliente&produto=p");
    expect(await screen.findByText("Leitura liberada")).toBeInTheDocument();
    expect(mocks.catalogo).toHaveBeenCalledWith(undefined, {
      teste: true,
      bloqueado: false,
    });
    expect(mocks.materiais).toHaveBeenCalledWith("p", undefined, {
      teste: true,
      bloqueado: false,
    });
    expect(screen.queryByText("Painel Aceleriq")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Administrar biblioteca" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Marcar como concluído" }),
    );
    await waitFor(() =>
      expect(mocks.progresso).toHaveBeenCalledWith("m", 0, 0, true, {
        teste: true,
        bloqueado: false,
      }),
    );
  });
  it("troca para bloqueio sem reutilizar materiais do teste liberado", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockImplementation((_previa, teste) =>
      Promise.resolve({
        produtos: [produto({ origens: teste?.bloqueado ? [] : ["manual"] })],
        pendentes: [],
      }),
    );
    montar("/membros?modo=cliente");
    await screen.findByText("Continuar na biblioteca");
    fireEvent.click(screen.getByRole("button", { name: "Simular bloqueio" }));
    await screen.findByText("Conhecer produto");
    expect(mocks.catalogo).toHaveBeenLastCalledWith(undefined, {
      teste: true,
      bloqueado: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Conhecer produto" }));
    await screen.findByRole("link", { name: "Ver oferta no checkout" });
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.arquivo).not.toHaveBeenCalled();
  });
  it("retoma o vídeo e preserva os segundos ao pausar no teste de cliente", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({
      produtos: [produto({ origens: ["manual"] })],
      pendentes: [],
    });
    mocks.materiais.mockResolvedValue({
      materiais: [
        {
          id: "v",
          produto_id: "p",
          titulo: "Vídeo",
          tipo: "video",
          texto: "",
          arquivo: "privado/video.mp4",
          permite_download: false,
          ordem: 0,
        },
      ],
      progresso: [
        { material_id: "v", posicao: 20, duracao: 75, concluido: false },
      ],
    });
    mocks.arquivo.mockResolvedValue({
      url: "https://example.invalid/video.mp4",
      expira_em: "2026-10-20",
    });
    montar("/membros?modo=cliente&produto=p");
    await screen.findByText("Vídeo", { selector: "h2" });
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 75, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(20);
    video.currentTime = 31;
    fireEvent.pause(video);
    await waitFor(() =>
      expect(mocks.progresso).toHaveBeenCalledWith("v", 31, 75, false, {
        teste: true,
        bloqueado: false,
      }),
    );
    expect(mocks.arquivo).toHaveBeenCalledWith("v", false, undefined, {
      teste: true,
      bloqueado: false,
    });
    expect(
      screen.queryByRole("button", { name: "Baixar arquivo" }),
    ).not.toBeInTheDocument();
  });
  it("solicita o download permitido no mesmo modo de cliente", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({
      produtos: [produto({ origens: ["manual"] })],
      pendentes: [],
    });
    mocks.materiais.mockResolvedValue({
      materiais: [
        {
          id: "d",
          produto_id: "p",
          titulo: "Guia para baixar",
          tipo: "arquivo",
          texto: "",
          arquivo: "privado/guia.pdf",
          permite_download: true,
          ordem: 0,
        },
      ],
      progresso: [],
    });
    mocks.arquivo.mockResolvedValue({
      url: "https://example.invalid/guia.pdf",
      expira_em: "2026-10-20",
    });
    const clique = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    montar("/membros?modo=cliente&produto=p");
    expect(
      await screen.findByRole("region", {
        name: "Leitor de PDF: Guia para baixar",
      }),
    ).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: "Baixar arquivo" }),
    );
    await waitFor(() =>
      expect(mocks.arquivo).toHaveBeenCalledWith("d", true, undefined, {
        teste: true,
        bloqueado: false,
      }),
    );
    expect(clique).toHaveBeenCalled();
    clique.mockRestore();
  });
});

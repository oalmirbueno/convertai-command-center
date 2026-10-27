import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
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
  usuario: "usuario",
  ferramentas: vi.fn(),
  sessao: vi.fn(),
  crm: vi.fn(),
  lista: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: mocks.usuario },
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
  carregarLista: mocks.lista,
  carregarFunil: vi.fn(async () => []),
  favoritar: vi.fn(async () => {}),
  carregarComunidade: vi.fn(async () => []),
  salvarConversa: vi.fn(async () => {}),
}));
vi.mock("@/lib/membros/ferramentas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/membros/ferramentas")>()),
  listarFerramentas: mocks.ferramentas,
  obterProvaCompartilhada: async () => "prova-do-teste",
  abrirSessaoFerramenta: mocks.sessao,
  operarCrm: mocks.crm,
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
function montar(inicio = "/membros", qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })) {
  return { qc, ...render(
    <MemoryRouter initialEntries={[inicio]}>
      <QueryClientProvider client={qc}>
        <AreaDeMembros />
      </QueryClientProvider>
    </MemoryRouter>,
  ) };
}
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.role = "member";
  mocks.usuario = "usuario";
  mocks.ferramentas.mockResolvedValue([]);
  mocks.lista.mockResolvedValue([]);
  mocks.sessao.mockResolvedValue({ conflito: false });
  mocks.crm.mockResolvedValue({ contatos: [], negocios: [] });
  mocks.catalogo.mockResolvedValue({
    produtos: [produto()],
    pendentes: [],
  } satisfies Catalogo);
  mocks.materiais.mockResolvedValue({ materiais: [], progresso: [] });
});
describe("biblioteca integrada", () => {
  const produtoCrm = (origens: Produto["origens"] = []) => produto({
    id: "crm", titulo: "CRM privado", categoria: "Ferramentas", formato: "CRM",
    origens, em_venda: false,
  });
  const ferramentaCrm = (fim: string | null = "2037-10-21T12:00:00Z") => ({
    produto_id: "crm", titulo: "CRM privado", motor: "crm", capa_url: null, fim,
    disponivel: true,
  });
  it("o cartão usa a licença própria e abre diretamente o CRM sem conceder acesso aos materiais", async () => {
    const p = produtoCrm();
    mocks.catalogo.mockResolvedValue({ produtos: [p], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "CRM privado · Licença ativa" }));
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(mocks.sessao).toHaveBeenCalledWith("crm", "prova-do-teste", false);
    expect(mocks.crm).toHaveBeenCalledWith("crm", "prova-do-teste");
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.arquivo).not.toHaveBeenCalled();
    expect(p.origens).toEqual([]);
    expect(mocks.ferramentas).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Voltar às ferramentas" }));
    await screen.findByRole("button", { name: "Abrir ferramenta" });
    expect(mocks.ferramentas).toHaveBeenCalledTimes(1);
  });
  it("o destaque abre o motor pela licença, e não pelo privilégio de administrador", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm(["administracao"])], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir ferramenta" }));
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(mocks.materiais).not.toHaveBeenCalled();
  });
  it("o acesso ao acervo ou o perfil admin não substituem uma licença suspensa", async () => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm(["administracao"])], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm(null)]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "CRM privado · Sem licença ativa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A licença desta ferramenta não está liberada ou venceu");
    expect(mocks.sessao).not.toHaveBeenCalled();
    expect(mocks.crm).not.toHaveBeenCalled();
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.arquivo).not.toHaveBeenCalled();
  });
  it("não oferece abertura enquanto a licença é conferida nem usa materiais da URL antiga", async () => {
    let concluir: ((dados: ReturnType<typeof ferramentaCrm>[]) => void) | undefined;
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    montar("/membros?produto=crm");
    expect(await screen.findByRole("button", { name: "CRM privado · Conferindo acesso…" })).toBeDisabled();
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.sessao).not.toHaveBeenCalled();
    await act(async () => concluir?.([ferramentaCrm()]));
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(mocks.materiais).not.toHaveBeenCalled();
  });
  it("falha fechada se não conseguir consultar a licença e permite tentar novamente", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockRejectedValue(new Error("rede"));
    montar("/membros?produto=crm");
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível conferir as licenças");
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.sessao).not.toHaveBeenCalled();
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    fireEvent.click(screen.getByRole("button", { name: "Conferir licenças novamente" }));
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(mocks.ferramentas).toHaveBeenCalledTimes(2);
  });
  it("minha lista usa a mesma licença e a mesma consulta do início", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    mocks.lista.mockResolvedValue(["crm"]);
    montar();
    await screen.findByRole("button", { name: "CRM privado · Licença ativa" });
    fireEvent.click(screen.getByRole("button", { name: "Minha lista" }));
    fireEvent.click(await screen.findByRole("button", { name: "CRM privado · Licença ativa" }));
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(mocks.ferramentas).toHaveBeenCalledTimes(1);
    expect(mocks.materiais).not.toHaveBeenCalled();
  });
  it("a busca do topo volta do CRM para a biblioteca sem alterar acessos", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm(), produto()], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    montar("/membros?ferramenta=crm");
    await screen.findByRole("button", { name: "Novo negócio" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar produtos" }), {
      target: { value: "Kit de marca" },
    });

    expect(await screen.findByRole("heading", { name: "Resultados da busca" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo negócio" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar produtos" })).toHaveValue("Kit de marca");
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.catalogo).toHaveBeenCalledTimes(1);
    expect(mocks.ferramentas).toHaveBeenCalledTimes(1);
    expect(mocks.sessao).toHaveBeenCalledWith("crm", "prova-do-teste", false);
  });
  it.each([
    "/membros",
    "/membros?modo=cliente&bloqueado=1",
    "/membros?visao=cliente",
  ])("a marca retorna ao início e preserva o contexto de %s", async (inicio) => {
    mocks.role = "admin";
    montar(inicio);
    await screen.findByText("Conhecer produto");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar produtos" }), {
      target: { value: "inexistente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Minha lista" }));
    expect(screen.getByRole("heading", { name: "Minha lista" })).toBeInTheDocument();

    const marca = screen.getByRole("link", { name: "Biblioteca Aceleriq" });
    expect(marca).toHaveAttribute("href", inicio);
    fireEvent.click(marca);

    expect(await screen.findByRole("heading", { name: "Sua biblioteca" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Minha lista" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar produtos" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Conhecer produto" })).toBeInTheDocument();
    expect(mocks.catalogo).toHaveBeenCalledTimes(1);
    expect(mocks.progresso).not.toHaveBeenCalled();
  });
  it("remove o CRM aberto quando a licença é suspensa e recupera o acesso após reativar", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    const tela = montar();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir ferramenta" }));
    await screen.findByRole("button", { name: "Novo negócio" });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm(null)]);
    await act(async () => { await tela.qc.invalidateQueries({ queryKey: ["membros", "ferramentas"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Seus dados continuam guardados");
    expect(screen.queryByRole("button", { name: "Novo negócio" })).not.toBeInTheDocument();
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    await act(async () => { await tela.qc.invalidateQueries({ queryKey: ["membros", "ferramentas"] }); });
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(mocks.arquivo).not.toHaveBeenCalled();
  });
  it.each(["2020-10-21T12:00:00Z", "inválida"])("não abre CRM com prazo %s", async (fim) => {
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm(fim)]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "CRM privado · Sem licença ativa" }));
    await screen.findByRole("alert");
    expect(mocks.sessao).not.toHaveBeenCalled();
    expect(mocks.materiais).not.toHaveBeenCalled();
  });
  it.each(["/membros?visao=outro", "/membros?modo=cliente"])("não aplica licença própria à prévia %s", async (url) => {
    mocks.role = "admin";
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    montar(url);
    await screen.findByText("Conhecer produto");
    fireEvent.click(screen.getByRole("button", { name: "Ferramentas" }));
    expect(await screen.findByText("Ferramentas disponíveis na conta do próprio titular.")).toBeInTheDocument();
    expect(mocks.ferramentas).not.toHaveBeenCalled();
    expect(mocks.sessao).not.toHaveBeenCalled();
    expect(mocks.crm).not.toHaveBeenCalled();
  });
  it("não reaproveita a licença da primeira conta depois de trocar o titular", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [produtoCrm()], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([ferramentaCrm()]);
    const primeira = montar();
    await screen.findByRole("button", { name: "CRM privado · Licença ativa" });
    primeira.unmount();
    mocks.usuario = "outro-titular";
    mocks.ferramentas.mockResolvedValue([ferramentaCrm(null)]);
    montar("/membros", primeira.qc);
    await screen.findByRole("button", { name: "CRM privado · Sem licença ativa" });
    expect(screen.queryByRole("button", { name: "Abrir ferramenta" })).not.toBeInTheDocument();
    expect(mocks.ferramentas).toHaveBeenCalledTimes(2);
    expect(mocks.sessao).not.toHaveBeenCalled();
  });
  it("mantém cursos comuns e guias da Próxima Resposta no leitor de conteúdo", async () => {
    mocks.catalogo.mockResolvedValue({ produtos: [produto({ origens: ["compra"] })], pendentes: [] });
    mocks.ferramentas.mockResolvedValue([{ ...ferramentaCrm(), produto_id: "p", motor: "proxima_resposta" }]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Continuar na biblioteca" }));
    await screen.findByText("Os materiais deste produto ainda não estão disponíveis.");
    expect(mocks.materiais).toHaveBeenCalledWith("p", undefined, undefined);
    expect(mocks.sessao).not.toHaveBeenCalled();
  });
  it.each([
    { conteudo: "curso", consulta: "pendente", url: "/membros" },
    { conteudo: "curso", consulta: "com erro", url: "/membros?produto=p" },
    { conteudo: "guia da Próxima Resposta", consulta: "pendente", url: "/membros?produto=p" },
    { conteudo: "guia da Próxima Resposta", consulta: "com erro", url: "/membros" },
  ])("preserva $conteudo já liberado com consulta de ferramentas $consulta", async ({ conteudo, consulta, url }) => {
    mocks.catalogo.mockResolvedValue({ produtos: [produto({ origens: ["compra"] })], pendentes: [] });
    let concluir: ((dados: ReturnType<typeof ferramentaCrm>[]) => void) | undefined;
    if (consulta === "pendente")
      mocks.ferramentas.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    else mocks.ferramentas.mockRejectedValue(new Error("rede"));
    montar(url);
    if (!url.includes("produto="))
      fireEvent.click(await screen.findByRole("button", { name: "Continuar na biblioteca" }));
    await screen.findByText("Os materiais deste produto ainda não estão disponíveis.");
    expect(mocks.materiais).toHaveBeenCalledWith("p", undefined, undefined);
    expect(mocks.sessao).not.toHaveBeenCalled();
    expect(mocks.crm).not.toHaveBeenCalled();
    if (concluir) {
      const dados = conteudo === "curso" ? [] : [{ ...ferramentaCrm(), produto_id: "p", motor: "proxima_resposta" }];
      await act(async () => concluir?.(dados));
    }
  });
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
  it("o menu da conta preserva o destino do membro e fecha por Escape", async () => {
    montar();
    await screen.findByText("Conhecer produto");
    const conta = screen.getByLabelText("Opções da conta de Minha conta");
    fireEvent.click(conta);
    expect(screen.getByRole("link", { name: "Painel Aceleriq" })).toHaveAttribute("href", "/solucoes");
    expect(screen.queryByRole("link", { name: "Administrar biblioteca" })).not.toBeInTheDocument();

    const sair = screen.getByRole("button", { name: "Sair da conta" });
    fireEvent.keyDown(sair, { key: "Escape" });
    expect(sair).not.toBeVisible();
    expect(conta).toHaveFocus();
    expect(mocks.logout).not.toHaveBeenCalled();
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

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FerramentasDoMembro from "@/components/membros/FerramentasDoMembro";
const m = vi.hoisted(() => ({
  listar: vi.fn(),
  sessao: vi.fn(),
  crm: vi.fn(),
  responder: vi.fn(),
  excluir: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "titular" } }),
}));
vi.mock("@/lib/membros/api", () => ({
  mensagemDoErro: (e: Error) => e.message,
}));
vi.mock("@/lib/membros/ferramentas", () => ({
  listarFerramentas: m.listar,
  abrirSessaoFerramenta: m.sessao,
  obterProvaCompartilhada: async () => "prova-de-teste",
  operarCrm: m.crm,
  proximaResposta: m.responder,
  pedirExclusaoCrm: m.excluir,
}));
function montar(leitura = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FerramentasDoMembro somenteLeitura={leitura} conhecer={() => {}} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.listar.mockResolvedValue([
    {
      produto_id: "p",
      titulo: "CRM privado",
      motor: "crm",
      fim: "2027-10-20T12:00:00Z",
    },
  ]);
  m.crm.mockResolvedValue({ contatos: [], negocios: [] });
  m.sessao.mockResolvedValue({ conflito: false });
});
afterEach(cleanup);
describe("ferramentas individuais", () => {
  it("mantém o pedido de exclusão acessível se a ferramenta sair do catálogo", async () => {
    m.listar.mockResolvedValue([
      {
        produto_id: "p",
        titulo: "CRM privado",
        motor: "crm",
        fim: null,
        disponivel: false,
      },
    ]);
    montar();
    expect(
      await screen.findByText("Ferramenta indisponível"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abrir ferramenta" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Meus dados"));
    fireEvent.click(
      screen.getByRole("button", { name: "Solicitar exclusão dos meus dados" }),
    );
    await waitFor(() => expect(m.excluir).toHaveBeenCalledWith("p"));
  });
  it("não consulta dados do próprio admin quando está vendo outra pessoa", () => {
    montar(true);
    expect(m.listar).not.toHaveBeenCalled();
    expect(screen.getByText(/conta do próprio titular/)).toBeInTheDocument();
  });
  it("exige a troca explícita de dispositivo antes de consultar o CRM", async () => {
    m.sessao
      .mockResolvedValueOnce({
        conflito: true,
        mensagem: "Aberta em outro dispositivo",
      })
      .mockResolvedValue({ conflito: false });
    montar();
    fireEvent.click(
      await screen.findByRole("button", { name: "Abrir ferramenta" }),
    );
    expect(
      await screen.findByText("Aberta em outro dispositivo"),
    ).toBeInTheDocument();
    expect(m.crm).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Continuar neste dispositivo" }),
    );
    await screen.findByRole("button", { name: "Novo negócio" });
    expect(m.sessao).toHaveBeenLastCalledWith("p", "prova-de-teste", true);
    expect(m.crm).toHaveBeenCalledWith("p", "prova-de-teste");
  });
  it("salva contato e refaz a consulta sem recarregar a página", async () => {
    let salvo = false;
    m.crm.mockImplementation(async (_p, _prova, acao) => {
      if (acao === "salvar_contato") salvo = true;
      return {
        contatos: salvo
          ? [
              {
                id: "c",
                nome: "Empresa local",
                empresa: "",
                email: "",
                telefone: "",
                notas: "",
                arquivado: false,
                versao: 1,
              },
            ]
          : [],
        negocios: [],
      };
    });
    montar();
    fireEvent.click(
      await screen.findByRole("button", { name: "Abrir ferramenta" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Contatos" }));
    fireEvent.click(screen.getByRole("button", { name: "Novo contato" }));
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Empresa local" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar" }),
    );
    await waitFor(() =>
      expect(m.crm).toHaveBeenCalledWith(
        "p",
        "prova-de-teste",
        "salvar_contato",
        expect.objectContaining({ nome: "Empresa local" }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Empresa local" }),
    ).toBeInTheDocument();
  });
  it("licença vencida mostra retenção e permite pedir exclusão sem abrir o CRM", async () => {
    m.listar.mockResolvedValue([
      { produto_id: "p", titulo: "CRM privado", motor: "crm", fim: null },
    ]);
    montar();
    await screen.findByRole("button", { name: "Ver produto" });
    fireEvent.click(screen.getByText("Meus dados"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Solicitar exclusão dos meus dados",
      }),
    );
    await waitFor(() => expect(m.excluir).toHaveBeenCalledWith("p"));
    expect(m.crm).not.toHaveBeenCalled();
  });
});

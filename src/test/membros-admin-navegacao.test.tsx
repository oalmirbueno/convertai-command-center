import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminMembros from "@/pages/AdminMembros";

vi.mock("@/lib/membros/api", () => ({
  carregarAdmin: async () => ({ produtos: [], materiais: [], pessoas: [], acessos: [], modulos: [], funil: [], beneficios: [], vinculos: [], checklist: [], historico: [], processamentos: [], planos: [], integracoes: [] }),
  mensagemDoErro: () => "Não foi possível carregar.",
  salvarLinha: vi.fn(),
  reprocessarEvento: vi.fn(),
}));
vi.mock("@/components/membros/bolso/AdminBolso", () => ({ default: () => <section aria-label="Aceleriq de Bolso">Estúdio administrativo</section> }));
vi.mock("@/components/membros/EditorDoCurso", () => ({ default: () => <div>Editor de aulas</div> }));
vi.mock("@/components/membros/PessoasEFunil", () => ({ default: () => <div>Gestão de acessos</div>, EditorFunil: () => <div>Recomendações</div> }));
vi.mock("@/components/membros/ConfiguracaoKiwify", () => ({ default: () => null }));
vi.mock("@/components/membros/ChecklistLancamento", () => ({ default: () => null }));
vi.mock("@/components/membros/CanaisDoProduto", () => ({ default: () => null }));
vi.mock("@/components/membros/AdminFerramentas", () => ({ default: () => <div>Ferramentas administrativas</div> }));
vi.mock("@/lib/membros/capas", () => ({ enviarCapa: vi.fn() }));

function LocalAtual() {
  const local = useLocation();
  return <output aria-label="Endereço atual">{local.search}</output>;
}
function montar(endereco: string) {
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AdminMembros />
        <LocalAtual />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("navegação e aparência da administração dos membros", () => {
  it("abre o Bolso por link direto e preserva outros parâmetros ao trocar de seção", async () => {
    montar("/membros/administrar?secao=bolso&origem=biblioteca");
    expect(await screen.findByRole("region", { name: "Aceleriq de Bolso" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Pessoas e acessos/ }));
    expect(await screen.findByText("Gestão de acessos")).toBeVisible();
    expect(screen.getByRole("status", { name: "Endereço atual" })).toHaveTextContent("secao=acessos&origem=biblioteca");
  });

  it("usa a mesma preferência visual da biblioteca e restaura o tema global ao sair", async () => {
    localStorage.setItem("aceleriq_membros_aparencia", "escuro");
    const tela = montar("/membros/administrar?secao=bolso");
    await screen.findByRole("region", { name: "Aceleriq de Bolso" });
    expect(document.documentElement).toHaveAttribute("data-membros-tema", "escuro");
    fireEvent.click(screen.getByRole("button", { name: "Usar tema claro" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-membros-tema", "claro"));
    expect(localStorage.getItem("aceleriq_membros_aparencia")).toBe("claro");
    tela.unmount();
    expect(document.documentElement).not.toHaveAttribute("data-membros-tema");
  });
});

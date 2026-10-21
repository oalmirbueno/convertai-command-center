import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminFerramentas from "@/components/membros/AdminFerramentas";
import type { AdminFerramentas as DadosFerramentas } from "@/lib/membros/ferramentas";
import type { DadosAdmin } from "@/lib/membros/api";

const m = vi.hoisted(() => ({
  carregar: vi.fn(),
  suspender: vi.fn(),
  reativar: vi.fn(),
  revogar: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "administrador" } }),
}));
vi.mock("@/components/sistema", () => ({
  AjudaRecolhida: ({ rotulo }: { rotulo: string }) => (
    <button aria-label={rotulo}>?</button>
  ),
}));
vi.mock("@/components/membros/CrmDoMembro", () => ({
  QuadroCrm: () => <div>CRM em acompanhamento</div>,
}));
vi.mock("@/lib/membros/ferramentas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/membros/ferramentas")>()),
  carregarAdminFerramentas: m.carregar,
  suspenderLicencaCrm: m.suspender,
  reativarLicencaCrm: m.reativar,
  revogarLicenca: m.revogar,
}));

const fimOriginal = "2037-10-21T12:00:00Z";
let ferramentas: DadosFerramentas;
const admin: DadosAdmin = {
  modulos: [], funil: [], materiais: [], acessos: [], beneficios: [],
  vinculos: [], checklist: [], historico: [], processamentos: [], planos: [],
  integracoes: [],
  pessoas: [{ id: "titular", full_name: "Titular do teste", email: "teste@example.invalid" }],
  produtos: [{
    id: "produto-crm", titulo: "CRM do teste", descricao: "", categoria: "Ferramentas",
    formato: "", capa_url: null, estado: "publicado", gratuito: false, destaque: false,
    checkout_url: null, condicoes: "", ordem: 1,
  }],
};
function montar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminFerramentas dados={admin} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  ferramentas = {
    ferramentas: [{ produto_id: "produto-crm", motor: "crm", ativo: true }],
    licencas: [{
      id: "licenca-original", produto_id: "produto-crm", user_id: "titular",
      titular: "Titular do teste", email: "teste@example.invalid", origem: "validacao_manual",
      confirmado_em: "2026-10-21T12:00:00Z", fim: fimOriginal,
      revogado_em: null, suspenso_em: null,
    }],
    contatos: [{ id: "contato-salvo", nome: "Contato salvo", empresa: "", email: "", telefone: "", notas: "", arquivado: false, versao: 1 }],
    negocios: [{ id: "negocio-salvo", titulo: "Negócio salvo", contato_id: "contato-salvo", estagio: "proposta", valor: 123.45, proxima_acao: "Retornar", proxima_data: null, notas: "", arquivado: false, versao: 1 }],
    exclusoes: [],
  };
  m.carregar.mockImplementation(async () => structuredClone(ferramentas));
  m.suspender.mockImplementation(async () => {
    ferramentas.licencas[0].suspenso_em = "2026-10-21T14:00:00Z";
  });
  m.reativar.mockImplementation(async () => {
    ferramentas.licencas[0].suspenso_em = null;
  });
});
afterEach(cleanup);

describe("suspensão temporária da licença do CRM na administração", () => {
  it("suspende e reativa a mesma licença, atualiza a tabela e preserva validade e dados", async () => {
    const registrosOriginais = structuredClone({ contatos: ferramentas.contatos, negocios: ferramentas.negocios });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Suspender licença" }));
    expect(await screen.findByText("Suspensa")).toBeInTheDocument();
    expect(m.suspender).toHaveBeenCalledExactlyOnceWith("licenca-original");
    expect(screen.getByRole("status")).toHaveTextContent("Licença suspensa. Os dados e a validade original foram preservados.");
    fireEvent.click(screen.getByRole("button", { name: "Reativar licença" }));
    await screen.findByRole("button", { name: "Suspender licença" });
    expect(screen.getByText("Liberado")).toBeInTheDocument();
    expect(m.reativar).toHaveBeenCalledExactlyOnceWith("licenca-original");
    expect(screen.getByRole("status")).toHaveTextContent("Licença reativada. Os dados e a validade original foram preservados.");
    expect(ferramentas.licencas).toHaveLength(1);
    expect(ferramentas.licencas[0]).toMatchObject({ fim: fimOriginal, revogado_em: null, suspenso_em: null });
    expect({ contatos: ferramentas.contatos, negocios: ferramentas.negocios }).toEqual(registrosOriginais);
    expect(screen.getByText(new Date(fimOriginal).toLocaleDateString("pt-BR"))).toBeInTheDocument();
    expect(m.revogar).not.toHaveBeenCalled();
  });

  it("bloqueia cliques repetidos enquanto a suspensão está sendo salva", async () => {
    let concluir: (() => void) | undefined;
    m.suspender.mockImplementation(() => new Promise<void>((resolve) => { concluir = resolve; }));
    montar();
    const botao = await screen.findByRole("button", { name: "Suspender licença" });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(botao).toBeDisabled();
    expect(m.suspender).toHaveBeenCalledTimes(1);
    concluir?.();
    await waitFor(() => expect(botao).toBeEnabled());
  });

  it("mantém a licença liberada e mostra o erro se a suspensão falhar", async () => {
    m.suspender.mockRejectedValue({ code: "42501" });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Suspender licença" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem acesso a este conteúdo.");
    expect(screen.getByText("Liberado")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suspender licença" })).toBeEnabled();
  });

  it("mantém a suspensão sem falso sucesso se a reativação for recusada pelo prazo", async () => {
    ferramentas.licencas[0].suspenso_em = "2026-10-21T14:00:00Z";
    m.reativar.mockRejectedValue({ code: "22023", message: "Esta licença venceu ou ainda não começou." });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Reativar licença" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta licença venceu ou ainda não começou.");
    expect(screen.getByText("Suspensa")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(m.suspender).not.toHaveBeenCalled();
  });

  it.each([
    { titulo: "vencida", fim: "2020-10-21T12:00:00Z", revogado_em: null, esperado: "Vencida" },
    { titulo: "revogada", fim: fimOriginal, revogado_em: "2026-10-21T13:00:00Z", esperado: "Revogado" },
    { titulo: "sem validade", fim: null, revogado_em: null, esperado: "Vencida" },
    { titulo: "com data inválida", fim: "data inválida", revogado_em: null, esperado: "Vencida" },
  ])("não oferece reativação nem renovação para licença $titulo", async ({ fim, revogado_em, esperado }) => {
    Object.assign(ferramentas.licencas[0], { fim, revogado_em, suspenso_em: "2026-10-21T14:00:00Z" });
    montar();
    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspender licença" })).not.toBeInTheDocument();
  });

  it("não oferece suspensão ou reativação antes do início da licença", async () => {
    ferramentas.licencas[0].confirmado_em = "2036-10-21T12:00:00Z";
    montar();
    expect(await screen.findByText("Não iniciada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspender licença" })).not.toBeInTheDocument();
  });

  it("preserva a revogação existente de outras ferramentas", async () => {
    ferramentas.ferramentas[0].motor = "proxima_resposta";
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar licença" }));
    await waitFor(() => expect(m.revogar).toHaveBeenCalledExactlyOnceWith("licenca-original"));
    expect(screen.queryByRole("button", { name: "Suspender licença" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(m.suspender).not.toHaveBeenCalled();
    expect(m.reativar).not.toHaveBeenCalled();
  });
});

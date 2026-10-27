import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminBolso from "@/components/membros/bolso/AdminBolso";
import type { VisaoAdmin } from "@/lib/bolso/api";

const api = vi.hoisted(() => ({
  ler: vi.fn(), aprovar: vi.fn(), arquivar: vi.fn(), conceder: vi.fn(),
  criar: vi.fn(), processar: vi.fn(), reconciliar: vi.fn(), configurar: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "conta-autenticada", email: "admin@example.invalid" } }),
}));
vi.mock("@/lib/bolso/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bolso/api")>()),
  lerVisaoAdmin: api.ler,
  lerOfertasAdmin: async () => [],
  aprovarPolitica: api.aprovar,
  arquivarPolitica: api.arquivar,
  concederAcesso: api.conceder,
  criarPolitica: api.criar,
  processarFila: api.processar,
  reconciliar: api.reconciliar,
  salvarConfig: api.configurar,
}));

const pessoas = [
  { id: "conta-autenticada", full_name: "Almir do teste", email: "admin@example.invalid" },
  { id: "perfil-homonimo", full_name: "Almir do teste", email: "cliente@example.invalid" },
];
let visao: VisaoAdmin;
let qc: QueryClient;

function politica(estado: "rascunho" | "aprovado" = "aprovado"): VisaoAdmin["politicas"][number] {
  return {
    id: "politica-real", versao: 1, estado, teste: false, nota: "Validação privada, sem cobrança.",
    dados: { creditos_iniciais: 12, tarifa_texto: 1, tarifa_imagem: 5, validade_meses: 12, formatos: ["feed_1x1"] },
    aprovado_em: estado === "aprovado" ? "2026-10-27T12:00:00Z" : null,
  };
}

async function montar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={qc}><AdminBolso pessoas={pessoas} /></QueryClientProvider>);
  return screen.findByRole("form", { name: "Conceder acesso ao Bolso" });
}

function selecionar(formulario: HTMLElement, pessoa = "conta-autenticada") {
  fireEvent.change(within(formulario).getByRole("combobox", { name: "Pessoa" }), { target: { value: pessoa } });
  fireEvent.change(within(formulario).getByRole("combobox", { name: "Política" }), { target: { value: "politica-real" } });
}

async function abrirConcessao(formulario: HTMLElement) {
  fireEvent.click(within(formulario).getByRole("button", { name: "Conceder acesso" }));
  return screen.findByRole("alertdialog", { name: "Confirmar concessão de acesso" });
}

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom 20 não implementa randomUUID; o navegador de produção usa Web Crypto.
  vi.stubGlobal("crypto", { randomUUID });
  visao = {
    config: {
      modulo_exposto: false, geracao_real: false, pagamentos: false, modo_simulado: false, kill_switch: false,
      limites: { paralelo_por_usuario: 1, pedidos_por_dia_usuario: 2, teto_global_dia: 2 }, destino_agencia: null,
    },
    politicas: [politica()], incertos: [], fila: 0, direitos: 0, eventos_pendentes: 0,
  };
  api.ler.mockImplementation(async () => structuredClone(visao));
  api.aprovar.mockImplementation(async (id: string) => {
    const alvo = visao.politicas.find((p) => p.id === id)!;
    alvo.estado = "aprovado";
    alvo.aprovado_em = "2026-10-27T13:00:00Z";
  });
  api.conceder.mockImplementation(async () => {
    visao.direitos += 1;
    return "direito-criado";
  });
  api.configurar.mockImplementation(async (alteracao: Partial<VisaoAdmin["config"]>) => {
    visao.config = { ...visao.config, ...alteracao };
    return structuredClone(visao.config);
  });
});

afterEach(() => {
  cleanup();
  qc?.clear();
  vi.unstubAllGlobals();
});

describe("administração de acessos ao Aceleriq de Bolso", () => {
  it("orienta a aprovação e impede concessão sem política real aprovada", async () => {
    visao.politicas = [politica("rascunho")];
    const formulario = await montar();
    expect(within(formulario).getByText("Aprove uma política para liberar o acesso real.")).toBeVisible();
    expect(within(formulario).getByRole("combobox", { name: "Política" })).toBeDisabled();
    expect(within(formulario).getByRole("button", { name: "Conceder acesso" })).toBeDisabled();
    fireEvent.click(within(formulario).getByRole("button", { name: "Usar minha conta" }));
    fireEvent.submit(formulario);
    expect(api.conceder).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancela a aprovação sem alterar a política e seleciona a versão somente após confirmação e atualização", async () => {
    visao.politicas = [politica("rascunho")];
    const formulario = await montar();
    fireEvent.click(within(formulario).getByRole("button", { name: "Revisar política V1" }));
    let dialogo = await screen.findByRole("alertdialog", { name: "Aprovar política V1?" });
    expect(dialogo).toHaveTextContent("12 créditos reais");
    expect(dialogo).toHaveTextContent("12 meses");
    expect(dialogo).toHaveTextContent("não concede acessos nem ativa pagamentos");
    expect(api.aprovar).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(api.aprovar).not.toHaveBeenCalled();
    expect(visao.politicas[0].estado).toBe("rascunho");

    fireEvent.click(within(formulario).getByRole("button", { name: "Revisar política V1" }));
    dialogo = await screen.findByRole("alertdialog", { name: "Aprovar política V1?" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aprovar política" }));
    await waitFor(() => expect(within(formulario).getByRole("combobox", { name: "Política" })).toHaveValue("politica-real"));
    expect(api.aprovar).toHaveBeenCalledExactlyOnceWith("politica-real");
    expect(api.ler).toHaveBeenCalledTimes(2);
    expect(api.conceder).not.toHaveBeenCalled();
    expect(api.configurar).not.toHaveBeenCalled();
    expect(within(formulario).getByRole("button", { name: "Conceder acesso" })).toBeDisabled();
  });

  it("não libera nem seleciona a política quando a aprovação é recusada pelo servidor", async () => {
    visao.politicas = [politica("rascunho")];
    api.aprovar.mockRejectedValue({ code: "42501", message: "Aprovação não autorizada." });
    const formulario = await montar();
    fireEvent.click(within(formulario).getByRole("button", { name: "Revisar política V1" }));
    const dialogo = await screen.findByRole("alertdialog", { name: "Aprovar política V1?" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aprovar política" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Aprovação não autorizada.");
    expect(within(formulario).getByRole("combobox", { name: "Política" })).toHaveValue("");
    expect(within(formulario).getByRole("button", { name: "Conceder acesso" })).toBeDisabled();
    expect(api.conceder).not.toHaveBeenCalled();
  });

  it("distingue minha conta de um perfil homônimo e permite cancelar a concessão", async () => {
    const formulario = await montar();
    fireEvent.change(within(formulario).getByRole("combobox", { name: "Pessoa" }), { target: { value: "perfil-homonimo" } });
    fireEvent.click(within(formulario).getByRole("button", { name: "Usar minha conta" }));
    fireEvent.change(within(formulario).getByRole("combobox", { name: "Política" }), { target: { value: "politica-real" } });
    expect(within(formulario).getByRole("combobox", { name: "Pessoa" })).toHaveValue("conta-autenticada");
    expect(within(formulario).getByRole("option", { name: "Minha conta · admin@example.invalid" })).toBeInTheDocument();
    expect(within(formulario).getByRole("option", { name: "Almir do teste · cliente@example.invalid" })).toBeInTheDocument();
    const dialogo = await abrirConcessao(formulario);
    expect(dialogo).toHaveTextContent("Minha conta (admin@example.invalid)");
    expect(dialogo).not.toHaveTextContent("cliente@example.invalid");
    expect(dialogo).toHaveTextContent("12 créditos reais pela política V1");
    expect(dialogo).toHaveTextContent("validade de 12 meses");
    expect(dialogo).toHaveTextContent("não faz nenhuma cobrança");
    expect(api.conceder).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.conceder).not.toHaveBeenCalled();
    expect(visao.direitos).toBe(0);
  });

  it("concede ao UUID escolhido e limpa a seleção após sucesso sem ativar pagamentos", async () => {
    const formulario = await montar();
    selecionar(formulario);
    const dialogo = await abrirConcessao(formulario);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    expect(await screen.findByText("Acesso concedido a Minha conta.")).toHaveAttribute("role", "status");
    expect(api.conceder).toHaveBeenCalledExactlyOnceWith("conta-autenticada", "anual", "politica-real", expect.stringMatching(/^manual-[\da-f-]{36}$/));
    expect(within(formulario).getByRole("combobox", { name: "Pessoa" })).toHaveValue("");
    expect(within(formulario).getByRole("combobox", { name: "Política" })).toHaveValue("");
    expect(within(formulario).getByRole("button", { name: "Conceder acesso" })).toBeDisabled();
    expect(api.configurar).not.toHaveBeenCalled();
    expect(visao.config.pagamentos).toBe(false);
    expect(visao.direitos).toBe(1);
  });

  it("mantém a referência da mesma intenção ao repetir depois de uma falha e mostra o erro junto ao formulário", async () => {
    api.conceder.mockRejectedValueOnce(new Error("Failed to fetch"));
    const formulario = await montar();
    selecionar(formulario);
    let dialogo = await abrirConcessao(formulario);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    expect(await within(formulario).findByRole("alert")).toHaveTextContent("Sem conexão.");
    const referencia = api.conceder.mock.calls[0][3];
    expect(within(formulario).getByRole("combobox", { name: "Pessoa" })).toHaveValue("conta-autenticada");
    dialogo = await abrirConcessao(formulario);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    await screen.findByText("Acesso concedido a Minha conta.");
    expect(api.conceder).toHaveBeenCalledTimes(2);
    expect(api.conceder.mock.calls[1]).toEqual(["conta-autenticada", "anual", "politica-real", referencia]);
    expect(visao.direitos).toBe(1);
  });

  it("não duplica a requisição com clique duplo nem novo envio enquanto ela está em andamento", async () => {
    let concluir!: (id: string) => void;
    api.conceder.mockImplementation(() => new Promise<string>((resolve) => { concluir = resolve; }));
    const formulario = await montar();
    selecionar(formulario);
    const dialogo = await abrirConcessao(formulario);
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar acesso" });
    act(() => {
      fireEvent.click(confirmar);
      fireEvent.click(confirmar);
      fireEvent.submit(formulario);
    });
    expect(api.conceder).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(formulario).getByRole("button", { name: "Concedendo…" })).toBeDisabled();
    await act(async () => { concluir("direito-criado"); });
    await screen.findByText("Acesso concedido a Minha conta.");
    expect(api.conceder).toHaveBeenCalledTimes(1);
  });

  it("cria outra intenção somente ao escolher outra pessoa após uma falha", async () => {
    api.conceder.mockRejectedValueOnce(new Error("Failed to fetch"));
    const formulario = await montar();
    selecionar(formulario);
    let dialogo = await abrirConcessao(formulario);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    await within(formulario).findByRole("alert");
    const anterior = api.conceder.mock.calls[0][3];
    fireEvent.change(within(formulario).getByRole("combobox", { name: "Pessoa" }), { target: { value: "perfil-homonimo" } });
    dialogo = await abrirConcessao(formulario);
    expect(dialogo).toHaveTextContent("Almir do teste (cliente@example.invalid)");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    await screen.findByText("Acesso concedido a Almir do teste.");
    expect(api.conceder.mock.calls[1][0]).toBe("perfil-homonimo");
    expect(api.conceder.mock.calls[1][3]).not.toBe(anterior);
  });

  it("trata referência já registrada como conferência pendente, sem fingir sucesso ou trocar a referência", async () => {
    api.conceder.mockRejectedValue({ code: "22023", message: "Esta referência já foi usada" });
    const formulario = await montar();
    selecionar(formulario);
    let dialogo = await abrirConcessao(formulario);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    expect(await within(formulario).findByRole("alert")).toHaveTextContent("Confira o acesso da pessoa antes de fazer uma nova concessão.");
    expect(screen.queryByText("Acesso concedido a Minha conta.")).not.toBeInTheDocument();
    const referencia = api.conceder.mock.calls[0][3];
    dialogo = await abrirConcessao(formulario);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar acesso" }));
    await waitFor(() => expect(api.conceder).toHaveBeenCalledTimes(2));
    expect(api.conceder.mock.calls[1][3]).toBe(referencia);
    expect(visao.direitos).toBe(0);
  });

  it("só ativa geração real após confirmação e não modifica pagamentos", async () => {
    await montar();
    const geracao = screen.getByRole("switch", { name: "Geração real (OpenRouter)" });
    expect(geracao).toHaveAttribute("aria-checked", "false");
    fireEvent.click(geracao);
    let dialogo = await screen.findByRole("alertdialog", { name: "Ativar geração real (openrouter)?" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(api.configurar).not.toHaveBeenCalled();
    expect(geracao).toHaveAttribute("aria-checked", "false");
    fireEvent.click(geracao);
    dialogo = await screen.findByRole("alertdialog", { name: "Ativar geração real (openrouter)?" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar ativação" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Geração real (OpenRouter)" })).toHaveAttribute("aria-checked", "true"));
    expect(api.configurar).toHaveBeenCalledExactlyOnceWith({ geracao_real: true });
    expect(screen.queryByRole("switch", { name: "Eventos de pagamento" })).toBeNull();
    expect(visao.config.pagamentos).toBe(false);
  });
});

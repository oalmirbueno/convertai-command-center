import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createElement as h, type ReactNode } from "react";

/**
 * Frente UXS (30/09/2026): o documento de entrega mais curto do rascunho ao
 * cliente, sem perder função.
 * - Linha com a ação do estado (Gerar, Mandar, Ver) e o status à vista no celular.
 * - Uma janela para conferir e mandar: Enviar pede Confirmar (o de sempre) e
 *   só então libera; a janela não fecha e o WhatsApp vem depois.
 * - Arquivar na hora, com Desfazer; "Arquivados (n)" com Desarquivar.
 * - Agenda mensal grava ao mudar, com Desfazer, e não grava por cima antes de ler.
 * - Novo documento nasce preenchido no caso comum.
 */

const lib = vi.hoisted(() => ({
  lerDocumentosDaEntrega: vi.fn(),
  liberarDocumento: vi.fn(),
  arquivarDocumento: vi.fn(),
  lerAgendas: vi.fn(),
  salvarAgenda: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const projetos = vi.hoisted(() => ({ lista: [] as Array<{ id: string; name: string; client_id: string }> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { company_name: "Padaria Aurora", phone: "41999990000" }, error: null }) }) }) }),
    storage: { from: vi.fn() },
  },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/shared/FilePreviewContent", () => ({ default: ({ fileName }: { fileName: string }) => h("div", { "data-previa": fileName }, `Prévia de ${fileName}`) }));
vi.mock("@/components/mesa/MesaContexto", () => ({ ImagemDaMesa: () => null, useCatalogo: () => ({ data: [] }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useProjects: () => ({ data: projetos.lista, isLoading: false }) }));
vi.mock("@/lib/documentos/registrarEntrega", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/documentos/registrarEntrega")>();
  return {
    ...real,
    lerDocumentosDaEntrega: (...a: unknown[]) => lib.lerDocumentosDaEntrega(...a),
    liberarDocumento: (...a: unknown[]) => lib.liberarDocumento(...a),
    arquivarDocumento: (...a: unknown[]) => lib.arquivarDocumento(...a),
    lerAgendas: (...a: unknown[]) => lib.lerAgendas(...a),
    salvarAgenda: (...a: unknown[]) => lib.salvarAgenda(...a),
  };
});

import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import DocumentosDaEntrega from "@/components/documentos/DocumentosDaEntrega";
import NovoDocumento from "@/components/documentos/NovoDocumento";
import { hojeEmSaoPaulo, inicioDoMesEmSaoPaulo } from "@/lib/documentos/registrarEntrega";

const ARQUIVO = { id: "f1", file_name: "registro-da-entrega-0003.pdf", file_url: "u", storage_bucket: "files", storage_path: "c1/r.pdf", mime_type: "application/pdf", extension: "pdf", visibility: "internal", approval_status: null, agency_approval_status: null, archived_at: null };
const doc = (extra: Record<string, unknown> = {}) => ({
  id: "d1",
  client_id: "c1",
  marca_id: null,
  tipo: "mes_de_pautas",
  referencia: "2026-09",
  titulo: "Entrega de setembro",
  numero: 3,
  versao: 1,
  status: "gerado",
  file_id: "f1",
  avisos: [],
  custo_usd: 0,
  criado_em: "2026-10-01T10:00:00Z",
  gerado_em: "2026-10-01T10:00:00Z",
  arquivo: ARQUIVO,
  tem_rascunho: true,
  ...extra,
});

function montar(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, filho))));
}

beforeEach(() => {
  Object.values(lib).forEach((f) => f.mockReset());
  Object.values(toastMock).forEach((f) => f.mockReset());
  localStorage.clear();
  projetos.lista = [];
  lib.lerAgendas.mockResolvedValue([]);
  lib.arquivarDocumento.mockImplementation(async (id: string, sim: boolean) => doc({ id, arquivado_em: sim ? "agora" : null }));
});

describe("lista de documentos: a ação do estado e o status no celular", () => {
  it("Pendente: Gerar; Gerado: Mandar; com o cliente: Ver; status e avisos na linha de apoio", async () => {
    lib.lerDocumentosDaEntrega.mockResolvedValue({
      documentos: [
        doc({ id: "d0", titulo: "Projeto do site", status: "pendente", file_id: null, arquivo: null, numero: null }),
        doc(),
        doc({ id: "d2", titulo: "Entrega de agosto", status: "em_aprovacao", avisos: ["a", "b"] }),
      ],
      arquivados: 0,
    });
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    const pendente = (await screen.findByText("Projeto do site")).closest("li") as HTMLElement;
    expect(within(pendente).getByRole("button", { name: /Gerar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mandar Entrega de setembro" })).toBeInTheDocument();
    const enviado = screen.getByText("Entrega de agosto").closest("li") as HTMLElement;
    expect(within(enviado).getByRole("button", { name: "Ver Entrega de agosto" })).toBeInTheDocument();
    // O status vem primeiro na linha de apoio (só no celular), depois os avisos e o número.
    const apoio = within(enviado).getByText(/2 avisos/);
    expect(apoio.textContent).toMatch(/^Em aprovação · 2 avisos · Nº 0003 · Mês de pautas · /);
    expect(within(enviado).getByText(/^Em aprovação/, { selector: "span" }).className).toContain("sm:hidden");
  });

  it("vazio: diz o próximo passo com Novo documento; carregando mostra esqueleto", async () => {
    let responder: (v: unknown) => void = () => {};
    lib.lerDocumentosDaEntrega.mockImplementation(() => new Promise((r) => (responder = r)));
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    expect(screen.getByLabelText("Carregando documentos")).toBeInTheDocument();
    await act(async () => responder({ documentos: [], arquivados: 0 }));
    expect(await screen.findByText("Nenhum documento ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Novo documento/ })).toBeInTheDocument();
  });
});

describe("conferir e mandar: uma janela, o Confirmar de sempre e o WhatsApp depois", () => {
  it("Enviar abre o Confirmar; só depois libera; a janela fica e vira \"Liberado\" com o WhatsApp", async () => {
    lib.lerDocumentosDaEntrega.mockResolvedValue({ documentos: [doc()], arquivados: 0 });
    lib.liberarDocumento.mockResolvedValue(doc({ status: "em_aprovacao" }));
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mandar Entrega de setembro" }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Prévia de registro-da-entrega-0003.pdf")).toBeInTheDocument();
    // Antes de liberar, o WhatsApp não aparece (a mensagem pede para aprovar no painel).
    expect(within(janela).queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    fireEvent.click(within(janela).getByRole("button", { name: /Enviar para aprovação/ }));
    const confirmar = await screen.findByRole("alertdialog");
    expect(lib.liberarDocumento).not.toHaveBeenCalled();
    fireEvent.click(within(confirmar).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(lib.liberarDocumento).toHaveBeenCalledWith("d1", "approval", expect.stringContaining("confira e aprove")));
    expect(await screen.findByText("Liberado. Agora mande a mensagem.")).toBeInTheDocument();
    const wa = screen.getByRole("link", { name: /WhatsApp/ }) as HTMLAnchorElement;
    expect(wa.href).toContain("https://wa.me/5541999990000?text=");
    expect(wa.className).toContain("bg-primary");
    expect(screen.queryByRole("button", { name: /Enviar para aprovação/ })).toBeNull();
    expect(screen.queryByLabelText("Pedir aprovação")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cancelar no Confirmar não libera nada", async () => {
    lib.lerDocumentosDaEntrega.mockResolvedValue({ documentos: [doc()], arquivados: 0 });
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mandar Entrega de setembro" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Enviar para aprovação/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(lib.liberarDocumento).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Enviar para aprovação/ })).toBeInTheDocument();
  });

  it("já com o cliente: só ver e reenviar a mensagem registrada, sem liberar de novo", async () => {
    lib.lerDocumentosDaEntrega.mockResolvedValue({ documentos: [doc({ status: "no_portal", mensagem_envio: "Olá, segue o registro de setembro." })], arquivados: 0 });
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver Entrega de setembro" }));
    const janela = await screen.findByRole("dialog");
    expect((within(janela).getByLabelText("Mensagem para o cliente") as HTMLTextAreaElement).value).toBe("Olá, segue o registro de setembro.");
    expect(within(janela).getByRole("link", { name: /WhatsApp/ })).toBeInTheDocument();
    expect(within(janela).queryByRole("button", { name: /Enviar para aprovação|Disponibilizar no portal/ })).toBeNull();
    expect(within(janela).queryByRole("button", { name: /Gerar de novo/ })).toBeNull();
  });
});

describe("arquivar com Desfazer e os arquivados", () => {
  it("Arquivar é na hora (sem Confirmar) e o aviso traz Desfazer", async () => {
    lib.lerDocumentosDaEntrega.mockResolvedValue({ documentos: [doc()], arquivados: 0 });
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    fireEvent.keyDown(await screen.findByRole("button", { name: "Mais ações de Entrega de setembro" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Arquivar" }));
    await waitFor(() => expect(lib.arquivarDocumento).toHaveBeenCalledWith("d1", true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const [texto, opcoes] = toastMock.success.mock.calls[0];
    expect(texto).toBe("Arquivado. O PDF continua em Arquivos.");
    act(() => opcoes.action.onClick());
    await waitFor(() => expect(lib.arquivarDocumento).toHaveBeenCalledWith("d1", false));
  });

  it("Arquivados (n) aparece com a lista ativa vazia, só lê ao abrir e desarquiva", async () => {
    lib.lerDocumentosDaEntrega.mockImplementation(async (_c: string, o?: { arquivados?: boolean }) =>
      o && o.arquivados ? { documentos: [doc({ id: "d7", titulo: "Entrega de julho", arquivado_em: "2026-09-01" })], arquivados: null } : { documentos: [], arquivados: 1 },
    );
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    const linha = await screen.findByRole("button", { name: "Arquivados (1)" });
    expect(lib.lerDocumentosDaEntrega).toHaveBeenCalledTimes(1);
    fireEvent.click(linha);
    await waitFor(() => expect(lib.lerDocumentosDaEntrega).toHaveBeenCalledWith("c1", { arquivados: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Desarquivar Entrega de julho" }));
    await waitFor(() => expect(lib.arquivarDocumento).toHaveBeenCalledWith("d7", false));
  });
});

describe("agenda mensal grava ao mudar", () => {
  const abrirAgenda = async () => {
    lib.lerDocumentosDaEntrega.mockResolvedValue({ documentos: [], arquivados: 0 });
    montar(h(DocumentosDaEntrega, { clientId: "c1" }));
    fireEvent.click(await screen.findByRole("button", { name: /Documento mensal automático/ }));
  };

  it("junta interruptor e dia numa gravação só, com Desfazer; o botão Salvar agenda saiu", async () => {
    lib.salvarAgenda.mockImplementation(async (p: Record<string, unknown>) => ({ id: "ag1", ...p }));
    await abrirAgenda();
    const ligar = await screen.findByLabelText("Montar o rascunho todo mês");
    await waitFor(() => expect(ligar).not.toBeDisabled());
    expect(screen.queryByRole("button", { name: /Salvar agenda/ })).toBeNull();
    fireEvent.click(ligar);
    fireEvent.change(screen.getByLabelText("Dia do mês"), { target: { value: "5" } });
    await waitFor(() => expect(lib.salvarAgenda).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(lib.salvarAgenda).toHaveBeenCalledWith({ clientId: "c1", marcaId: null, ligada: true, dia: 5, modelo: "mensal" });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const [, opcoes] = toastMock.success.mock.calls[0];
    expect(opcoes.id).toBe("documentos-agenda-c1");
    act(() => opcoes.action.onClick());
    await waitFor(() => expect(lib.salvarAgenda).toHaveBeenLastCalledWith({ clientId: "c1", marcaId: null, ligada: false, dia: 3, modelo: "mensal" }));
  });

  it("enquanto a agenda não chegou, nada muda (e a linha de estado não diz desligado)", async () => {
    lib.lerAgendas.mockImplementation(() => new Promise(() => {}));
    await abrirAgenda();
    expect(await screen.findByLabelText("Montar o rascunho todo mês")).toBeDisabled();
    expect(screen.queryByText("desligado")).toBeNull();
  });

  it("gravação que falha volta a tela e mostra o motivo", async () => {
    lib.salvarAgenda.mockRejectedValue(new Error("sem rede"));
    await abrirAgenda();
    const ligar = await screen.findByLabelText("Montar o rascunho todo mês");
    await waitFor(() => expect(ligar).not.toBeDisabled());
    fireEvent.click(ligar);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByLabelText("Montar o rascunho todo mês")).not.toBeChecked());
  });
});

describe("novo documento nasce preenchido", () => {
  it("hoje e o dia 1 do mês no horário de São Paulo (depois das 21h não pula o dia)", () => {
    expect(hojeEmSaoPaulo(new Date("2026-10-01T01:30:00Z"))).toBe("2026-09-30");
    expect(inicioDoMesEmSaoPaulo(new Date("2026-10-01T01:30:00Z"))).toBe("2026-09-01");
    expect(hojeEmSaoPaulo(new Date("2026-10-01T12:00:00Z"))).toBe("2026-10-01");
  });

  it("projeto único vem escolhido; sem projeto, o apoio leva a criar um", async () => {
    projetos.lista = [{ id: "p1", name: "Site novo", client_id: "c1" }, { id: "p9", name: "De outro", client_id: "c2" }];
    const comecar = vi.fn();
    const { unmount } = montar(h(NovoDocumento, { aberto: true, onFechar: vi.fn(), clientId: "c1", onComecar: comecar }));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "projeto" } });
    expect((screen.getByLabelText("Projeto") as HTMLSelectElement).value).toBe("p1");
    fireEvent.click(screen.getByRole("button", { name: "Abrir o rascunho" }));
    expect(comecar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "projeto", referencia: "p1" }));
    unmount();
    projetos.lista = [];
    montar(h(NovoDocumento, { aberto: true, onFechar: vi.fn(), clientId: "c1", onComecar: vi.fn() }));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "projeto" } });
    expect(screen.getByRole("link", { name: "Criar projeto" })).toHaveAttribute("href", "/projetos");
    expect(screen.getByRole("button", { name: "Abrir o rascunho" })).toBeDisabled();
  });

  it("campanha: o período já vem do dia 1 até hoje", () => {
    montar(h(NovoDocumento, { aberto: true, onFechar: vi.fn(), clientId: "c1", onComecar: vi.fn() }));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "campanha" } });
    expect((screen.getByLabelText("De") as HTMLInputElement).value).toBe(inicioDoMesEmSaoPaulo());
    expect((screen.getByLabelText("Até") as HTMLInputElement).value).toBe(hojeEmSaoPaulo());
    expect(screen.getByRole("button", { name: "Abrir o rascunho" })).not.toBeDisabled();
  });
});

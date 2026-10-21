import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EntradaDaExportacao } from "@/lib/laboratorio/exportar";

const m = vi.hoisted(() => ({ baixar: vi.fn(), docx: vi.fn(async () => new Blob(["teste"])), pdf: vi.fn(async () => new Blob(["%PDF-1.7"], { type: "application/pdf" })), imprimir: vi.fn(), erro: vi.fn(), sucesso: vi.fn() }));
vi.mock("@/lib/laboratorio/exportar", async (original) => ({ ...(await original<typeof import("@/lib/laboratorio/exportar")>()), baixarDocumentoDoLab: m.baixar, docxDoProjeto: m.docx, imprimirDocumentoDoLab: m.imprimir }));
vi.mock("@/lib/laboratorio/exportarPdf", () => ({ pdfDoProjeto: m.pdf }));
vi.mock("sonner", () => ({ toast: { success: m.sucesso, error: m.erro } }));
vi.mock("@/components/sistema", async (original) => ({ ...(await original<typeof import("@/components/sistema")>()), JanelaCentral: ({ aberta, children }: { aberta: boolean; children: React.ReactNode }) => aberta ? <div role="dialog">{children}</div> : null }));
import ExportarProjeto from "@/components/laboratorio/ExportarProjeto";

const canvas = { nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
const entrada: EntradaDaExportacao = { projeto: { id: "p1", nome: "Funil do café", client_id: null, cliente_nome: "", contexto: "Briefing completo", canvas, total_nos: 0, versao: 1, status: "ativo", updated_at: "2026-10-21T12:00:00Z", previa_url: "" }, canvas, execucoes: [] };

describe("exportação pelo botão do Laboratório", () => {
  it("baixa PDF, DOCX, Markdown e JSON e mantém a impressão separada", async () => {
    render(<ExportarProjeto {...entrada} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar documentação do projeto" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    await waitFor(() => expect(m.baixar).toHaveBeenCalledWith(expect.any(Blob), "funil-do-cafe-documentacao.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Baixar Word (.docx)" }));
    await waitFor(() => expect(m.baixar).toHaveBeenCalledWith(expect.any(Blob), "funil-do-cafe-documentacao.docx"));
    fireEvent.click(screen.getByRole("button", { name: "Baixar Markdown" }));
    await waitFor(() => expect(m.baixar).toHaveBeenCalledWith(expect.any(Blob), "funil-do-cafe-documentacao.md"));
    fireEvent.click(screen.getByRole("button", { name: "Baixar base (.json)" }));
    await waitFor(() => expect(m.baixar).toHaveBeenCalledWith(expect.any(Blob), "funil-do-cafe-documentacao.json"));
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(m.imprimir).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Funil do café", markdown: expect.stringContaining("Briefing completo") }));
    expect(m.pdf).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Funil do café" }));
  });

  it("não deixa exportar enquanto o editor pede para aguardar", () => {
    render(<ExportarProjeto {...entrada} disabled />);
    expect(screen.getByRole("button", { name: "Exportar documentação do projeto" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explica o bloqueio de pop-up sem anunciar um PDF baixado", () => {
    m.imprimir.mockImplementationOnce(() => { throw new Error("Permita a abertura da janela de impressão e tente novamente."); });
    render(<ExportarProjeto {...entrada} />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar documentação do projeto" }));
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(m.erro).toHaveBeenCalledWith("Permita a abertura da janela de impressão e tente novamente.");
  });
});

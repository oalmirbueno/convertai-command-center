import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prepararEntrada, incluirConcluidas } from "@/lib/cadernoExecucao";
import { destinoDaEvidencia } from "@/lib/execucaoApresentacao";
import { progressDetail } from "../../supabase/functions/_shared/operator-progress-detail";
import { imagensDasReferencias, sincronizarReferenciasDoWorkspace } from "../../supabase/functions/_shared/referencias-workspace";
import { fotosOriginaisDoAjuste, pedidoDiretoNoAjuste } from "../../supabase/functions/estudio-arte/identidade-no-ajuste";
import EvidenciaVisual from "@/components/execucao/EvidenciaVisual";
vi.mock("@/components/shared/FilePreviewContent", () => ({ default: ({ fileName }: { fileName: string }) => <div>Visualização: {fileName}</div> }));
const id = "00000000-0000-0000-0000-000000000001";

describe("Caderno e comprovação", () => {
  it("transforma somente identificador explícito de arquivo em anexo, conserva texto e evita duplicar", () => {
    const url = `aceleriq-file://${id}`;
    const body = `Resultado conferido. file_id: ${id}. Tarefa: ${id}`;
    const r = prepararEntrada(body, [{ name: "Resultado real", url }]);
    expect(r.anexos).toEqual([{ name: "Resultado real", url }]);
    expect(r.texto).toContain("Resultado conferido");
    expect(r.texto).not.toContain(id);
    expect(prepararEntrada(`Tarefa: ${id}`).anexos).toEqual([]);
    expect(body).toContain(id);
  });
  it("abre a imagem em diálogo interno, sem navegar nem abrir outra aba", () => {
    cleanup();
    render(<QueryClientProvider client={new QueryClient()}><EvidenciaVisual url="https://example.com/prova.png" nome="Resultado" /></QueryClientProvider>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver Resultado" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Visualização: https://example.com/prova.png")).toBeInTheDocument();
  });
  it("concluídas incluem vínculos encerrados mesmo com a preferência de escondê-los", () => {
    expect(incluirConcluidas("done", false)).toBe(true);
    expect(incluirConcluidas("in_progress", false)).toBe(false);
  });
  it("aceita arquivo organizado e rejeita caminho fora do contrato", () => {
    const url = `workspace://client/${id}/${id}.png`;
    expect(destinoDaEvidencia(url)).toBe("privado");
    expect(progressDetail({ attachments: [{ name: "Foto", url }] }).attachments).toHaveLength(1);
    expect(destinoDaEvidencia("workspace://client/../../private")).toBeNull();
  });
});

describe("Referências reais do Workspace", () => {
  it("inclui subpastas de referências e exclui fotos fora delas, sem entrar em ciclos", () => {
    const node = (id: string, parent_id: string | null, kind: string, name: string, path: string | null = null) => ({ id, parent_id, kind, name, storage_path: path, mime: path ? "image/png" : null });
    const nodes = [node("refs", null, "folder", "Referências de Design"), node("sub", "refs", "folder", "Capas"), node("foto", "sub", "file", "Capa.png", "client/x/a.png"), node("outra", null, "file", "Retrato.png", "client/x/b.png"), node("loop", "loop", "folder", "Outra")];
    expect(imagensDasReferencias(nodes).map(n => n.id)).toEqual(["foto"]);
  });
  it("não importa referências gerais em uma marca secundária", async () => {
    const db = { from: vi.fn() };
    await sincronizarReferenciasDoWorkspace(db, id, { principal: false });
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("Fidelidade durante ajustes", () => {
  it("retoma a foto original da versão e não usa rosto que não foi aplicado", () => {
    const foto = { bucket: "workspace", caminho: `client/${id}/pessoa.jpg` };
    expect(fotosOriginaisDoAjuste({ fotos_usadas: [foto] })[0]).toMatchObject(foto);
    expect(fotosOriginaisDoAjuste({ aplicado: false, fotos_usadas: [foto] })).toEqual([]);
    expect(fotosOriginaisDoAjuste({ fotos_usadas: [{ bucket: "secrets", caminho: "a" }, { bucket: "mesa", caminho: "../a" }] })).toEqual([]);
  });
  it("leva pedido original e regras ao gerador, acima da interpretação", () => {
    const p = pedidoDiretoNoAjuste("Mantenha o rosto e clareie o fundo", "Ajustar iluminação", "Sem filtro roxo");
    expect(p).toContain("Mantenha o rosto e clareie o fundo");
    expect(p).toContain("Sem filtro roxo");
    expect(p.indexOf("Mantenha")).toBeLessThan(p.indexOf("Ajustar iluminação"));
  });
});

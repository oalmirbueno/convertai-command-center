import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CanvasStudio from "@/components/laboratorio/CanvasStudio";
const m = vi.hoisted(() => ({ planejar: vi.fn() }));
vi.mock("@/lib/laboratorio/api", () => ({ planejar: m.planejar }));
vi.mock("@/components/laboratorio/PerguntasGuiadas", () => ({ default: () => null }));
vi.mock("@/components/laboratorio/CaixaDoPedido", async () => {
  const { forwardRef } = await import("react");
  return {
  ATALHOS_DO_CANVAS: [],
  default: forwardRef<HTMLTextAreaElement, { valor: string; onMudar: (v: string) => void; onEnviar: () => void; extra: React.ReactNode }>((props, ref) => <div><textarea ref={ref} aria-label="Pedido" value={props.valor} onChange={(e) => props.onMudar(e.target.value)} /><button onClick={props.onEnviar}>Enviar</button>{props.extra}</div>),
  };
});
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.planejar.mockResolvedValue({ perguntas: [], operacoes: [{ op: "criar", tipo: "copy", id: "texto" }], resposta: "Fluxo montado", recusadas: [], canvas_previsto: null, custo_usd: 0, modo: "simples" });
});

function montar(falhas = false) {
  const construir = vi.fn(() => ({ feitas: 1, falhas: falhas ? [{ recibo: "texto", motivo: "Não aplicado" }] : [], novos: 1, idsParaGerar: ["texto"] }));
  const gerar = vi.fn(async () => undefined);
  render(<CanvasStudio projetoId="projeto" nosNoQuadro={0} clienteId={null} clientes={[]} onCliente={() => undefined} antesDePlanejar={async () => undefined} onConstruir={construir} onDesfazer={null} onGerar={gerar} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Pedido" }), { target: { value: "Escreva uma legenda" } });
  return { construir, gerar };
}

describe("Canvas Studio: do pedido à geração", () => {
  it("monta e encaminha somente os nós alterados para conferir o custo", async () => {
    const r = montar();
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(r.gerar).toHaveBeenCalledWith(["texto"]));
    expect(r.construir).toHaveBeenCalledOnce();
    expect(r.construir.mock.invocationCallOrder[0]).toBeLessThan(r.gerar.mock.invocationCallOrder[0]);
  });
  it("só montar continua sem pedir geração", async () => {
    const r = montar();
    fireEvent.click(screen.getByRole("button", { name: "Montar e gerar" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(r.construir).toHaveBeenCalledOnce());
    expect(r.gerar).not.toHaveBeenCalled();
  });
  it("não executa uma construção aplicada parcialmente", async () => {
    const r = montar(true);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(r.construir).toHaveBeenCalledOnce());
    expect(r.gerar).not.toHaveBeenCalled();
  });
});

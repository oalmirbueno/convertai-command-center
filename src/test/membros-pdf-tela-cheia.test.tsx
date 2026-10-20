import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const pdf = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    destroy: async () => {},
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        getTextContent: async () => ({ items: [{ str: "Página de teste" }] }),
        render: (options: { canvas: HTMLCanvasElement }) => {
          pdf.render(options.canvas);
          return { promise: Promise.resolve(), cancel: () => {} };
        },
      }),
    }),
  }),
}));
// A portal can attach after its parent's effect, as observed in Chrome.
vi.mock("@/components/ui/dialog", async () => {
  const { useEffect, useState } = await import("react");
  const Passthrough = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Dialog: Passthrough,
    DialogTitle: Passthrough,
    DialogDescription: Passthrough,
    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => setReady(true), 0);
        return () => clearTimeout(timer);
      }, []);
      return ready ? <div role="dialog">{children}</div> : null;
    },
  };
});
import PdfSeguro from "@/components/membros/PdfSeguro";
const scrollOriginal = HTMLElement.prototype.scrollTo;

beforeEach(() => {
  pdf.render.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([37, 80, 68, 70]));
          controller.close();
        },
      }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollTo = scrollOriginal;
});

it("desenha em cada canvas novo, mesmo com o portal de tela cheia atrasado, sem exigir zoom", async () => {
  render(
    <PdfSeguro url="https://example.test/guia.pdf" titulo="Guia de teste" />,
  );
  await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(1));
  const normal = screen.getByLabelText("Página 1 de 1 de Guia de teste");
  fireEvent.click(
    screen.getByRole("button", { name: "Abrir PDF em tela cheia" }),
  );
  await screen.findByRole("dialog");
  const full = screen.getByLabelText("Página 1 de 1 de Guia de teste");
  expect(full).not.toBe(normal);
  await waitFor(() => expect(pdf.render).toHaveBeenLastCalledWith(full), {
    timeout: 500,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Sair da tela cheia do PDF" }),
  );
  const restored = screen.getByLabelText("Página 1 de 1 de Guia de teste");
  await waitFor(() => expect(pdf.render).toHaveBeenLastCalledWith(restored));
  expect(pdf.render).toHaveBeenCalledTimes(3);
});

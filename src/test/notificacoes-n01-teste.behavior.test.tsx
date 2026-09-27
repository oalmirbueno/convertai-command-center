import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Testar avisos" (frente N): o admin dispara um aviso para si mesmo e vê o
 * caminho dele em cada canal, sem mandar nada a cliente.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
vi.mock("@/lib/avisosDoNavegador", () => ({ estadoDosAvisos: () => "pedir" }));

import TesteDeAvisos from "@/components/avisos/TesteDeAvisos";

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

describe("Testar avisos", () => {
  it("dispara, mostra o sino na hora e o e-mail quando sai da fila", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "notificacoes_teste_disparar") {
        return Promise.resolve({ data: { notification_id: "n1", criado: true, email_pedido: true, email_destino: "ac***@gmail.com" }, error: null });
      }
      return Promise.resolve({ data: { sino: { criado: true }, email: { pedido: true, http_status: 200, envio_status: "sent" } }, error: null });
    });
    render(<TesteDeAvisos idsNoSino={["n1"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Testar avisos" }));
    expect(await screen.findByText("Chegou no sino.")).toBeInTheDocument();
    expect(screen.getByText("Desligado. Use Ativar avisos no navegador.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Enviado para ac***@gmail.com.")).toBeInTheDocument(), { timeout: 5000 });
    expect(rpc).toHaveBeenCalledWith("notificacoes_teste_resultado", { _notification_id: "n1" });
    expect(screen.getByRole("button", { name: "Testar avisos" })).not.toBeDisabled();
  });

  it("sem o SQL aplicado, diz o que falta em vez de quebrar", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function public.notificacoes_teste_disparar() does not exist" } });
    render(<TesteDeAvisos idsNoSino={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Testar avisos" }));
    expect(await screen.findByText(/falta aplicar o N-01/)).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Briefing público no formato do sistema de design: um formulário só, com as
 * mesmas regras de antes (obrigatórias conferidas antes de enviar, respostas
 * salvas no aparelho com a mesma chave, envio só conta com true do servidor).
 */

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
  },
}));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(), webhooks: { processDiagnostic: "x" } }));

const montar = async () => {
  const { default: BriefingPublic } = await import("@/pages/BriefingPublic");
  return render(
    <MemoryRouter initialEntries={["/briefing/tok-teste"]}>
      <Routes>
        <Route path="/briefing/:token" element={<BriefingPublic />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("briefing público (formulário único)", () => {
  beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome === "briefing_public_get") return Promise.resolve({ data: [{ id: "b1", submitted: false }], error: null });
      if (nome === "briefing_public_submit") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("mostra as perguntas com rótulo e não envia sem as obrigatórias", async () => {
    await montar();
    const nome = await screen.findByLabelText(/Qual é o nome da sua empresa/i);
    expect(nome).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviar diagnóstico/i }));
    expect(await screen.findAllByText("Responda esta pergunta.")).not.toHaveLength(0);
    expect(rpc).not.toHaveBeenCalledWith("briefing_public_submit", expect.anything());
  });

  it("guarda as respostas no aparelho com a chave de antes", async () => {
    await montar();
    const nome = await screen.findByLabelText(/Qual é o nome da sua empresa/i);
    fireEvent.change(nome, { target: { value: "Padaria do Zé" } });
    await waitFor(() => {
      const salvo = JSON.parse(localStorage.getItem("briefing_answers_tok-teste") || "{}");
      expect(salvo.companyName).toBe("Padaria do Zé");
    });
  });

  it("volta com as respostas salvas e avisa que dá para continuar", async () => {
    localStorage.setItem("briefing_answers_tok-teste", JSON.stringify({ companyName: "Estúdio Verde" }));
    await montar();
    expect(await screen.findByDisplayValue("Estúdio Verde")).toBeInTheDocument();
    expect(screen.getByText(/continue de onde parou/i)).toBeInTheDocument();
  });
});

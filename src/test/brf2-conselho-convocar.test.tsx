import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente BRF2: convocar o conselho com preset por tema, modo rápido, todos
 * com o mesmo modelo, pauta e elenco salvo. O custo estimado usa o modo e o
 * pedido de convocação leva o modo, os critérios do preset e a pauta.
 */

const estimar = vi.fn();
const convocar = vi.fn();
const salvar = vi.fn();

const arquivos = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", file_name: "briefing-site.pdf", folder: "operacionais", created_at: "2026-09-29T10:00:00Z" }];
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  ["select", "eq", "is", "order", "limit"].forEach((k) => (cadeia[k] = () => cadeia));
  (cadeia as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: arquivos, error: null }).then(ok);
  return { supabase: { from: vi.fn(() => cadeia), channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/MesaContexto", () => ({
  useCatalogo: () => ({ data: ["m1", "m2"].map((id) => ({ id, ativo: true, tipo: "texto", provedor: "openai", modelo_api: id, rotulo: id, padrao_para: id === "m1" ? ["conselho"] : [] })), isLoading: false }),
}));
vi.mock("@/components/mesa/Seletores", () => ({
  SeletorDeModelo: ({ valor, onChange, rotulo }: { valor: string; onChange: (v: string) => void; rotulo: string }) =>
    h("select", { "aria-label": rotulo, value: valor, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, h("option", { value: "" }, "-"), h("option", { value: "m1" }, "M1"), h("option", { value: "m2" }, "M2")),
}));
vi.mock("@/lib/conselho/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/conselho/api")>();
  return {
    ...real,
    lerCatalogoDoConselho: async () => ({
      especialistas: [
        { id: "estrategista_marca", nome: "Estrategista de marca", area: "Marca", visao: "", criterio: "" },
        { id: "copywriter", nome: "Copywriter", area: "Texto", visao: "", criterio: "" },
        { id: "comercial", nome: "Comercial", area: "Venda", visao: "", criterio: "" },
        { id: "cetico", nome: "Cético", area: "Advogado do diabo", visao: "", criterio: "" },
        { id: "gestao_crise", nome: "Gestão de crise", area: "Reputação", visao: "", criterio: "" },
      ],
      padrao: ["comercial", "estrategista_marca", "copywriter", "cetico"],
      criterios: ["responde à pergunta", "viável", "coerente"],
      limites: { min_especialistas: 2, max_especialistas: 6, min_rodadas: 2, max_rodadas: 4, teto_maximo_usd: 50 },
      modelo_padrao: "m1",
      presets: [
        { id: "crise", nome: "Crise", especialistas: ["gestao_crise", "estrategista_marca", "copywriter", "comercial", "cetico"], criterios: ["protege a confiança", "responde rápido", "tom humano"], modo: "rapido", rodadas: 2, tema: "Resposta à crise", pergunta: "O que a marca deve fazer agora?" },
      ],
      modos: [{ id: "rapido", rotulo: "Rápido", rodadas: 2 }, { id: "padrao", rotulo: "Padrão", rodadas: null }, { id: "profundo", rotulo: "Profundo", rodadas: 4 }],
    }),
    estimarConselho: (p: unknown) => estimar(p),
    convocarConselho: (p: unknown) => convocar(p),
    listarElencos: async () => [],
    salvarElenco: (p: unknown) => salvar(p),
    useSessoesDoConselho: () => ({ data: [], refetch: vi.fn() }),
  };
});

import ConvocarConselho from "@/components/conselho/ConvocarConselho";

beforeEach(() => {
  estimar.mockReset();
  convocar.mockReset();
  salvar.mockReset();
  estimar.mockImplementation(async (p: { modo: string }) => ({ estimativa: { por_rodada: [], total_usd: p.modo === "rapido" ? 0.05 : 0.4 }, teto_sugerido_usd: p.modo === "rapido" ? 0.07 : 0.52 }));
  convocar.mockResolvedValue({ sessao: { id: "s9" }, estimativa: { total_usd: 0.05 } });
  salvar.mockResolvedValue({ id: "e1" });
  localStorage.clear();
});

describe("convocar o conselho (frente BRF2)", () => {
  it("preset de crise: elenco, modo rápido (2 rodadas) e a pergunta modelo; convocar leva modo, critérios e pauta", async () => {
    const abrir = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(ConvocarConselho, { clientId: "c1", origem: "mesa-proposta", temaInicial: "Proposta da Acerbi", onAbrir: abrir })));
    fireEvent.click(await screen.findByRole("button", { name: "Crise" }));
    expect(screen.getByRole("button", { name: /Gestão de crise/ })).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Pergunta") as HTMLTextAreaElement).value).toBe("O que a marca deve fazer agora?");
    expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Resposta à crise: Proposta da Acerbi");
    await waitFor(() => expect(estimar).toHaveBeenLastCalledWith(expect.objectContaining({ modo: "rapido", rodadas: 2 })));
    await screen.findByText("Custo estimado US$ 0,05");
    // Todos com o mesmo modelo.
    fireEvent.change(screen.getByLabelText("Todos com o mesmo modelo"), { target: { value: "m2" } });
    await waitFor(() => expect(estimar).toHaveBeenLastCalledWith(expect.objectContaining({ modelos: { gestao_crise: "m2", estrategista_marca: "m2", copywriter: "m2", comercial: "m2", cetico: "m2" } })));
    // Pauta com um item e um anexo do cliente.
    fireEvent.click(screen.getByRole("button", { name: /Pauta e anexos/ }));
    fireEvent.change(screen.getByLabelText("Itens da pauta"), { target: { value: "O post apagado\nResposta nos comentários" } });
    fireEvent.click(await screen.findByLabelText(/briefing-site\.pdf/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Convocar o conselho/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Convocar o conselho/ }));
    await waitFor(() => expect(convocar).toHaveBeenCalledTimes(1));
    expect(convocar.mock.calls[0][0]).toMatchObject({
      modo: "rapido",
      rodadas: 2,
      criterios: ["protege a confiança", "responde rápido", "tom humano"],
      pauta: { itens: ["O post apagado", "Resposta nos comentários"], anexos: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] },
      especialistas: ["gestao_crise", "estrategista_marca", "copywriter", "comercial", "cetico"],
    });
    expect(abrir).toHaveBeenCalledWith("s9");
  });

  it("salvar o elenco leva quem entra, os modelos, o modo e se é da agência", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(ConvocarConselho, { clientId: "c1", origem: "mesa-proposta", temaInicial: "Proposta", onAbrir: vi.fn() })));
    await screen.findByRole("button", { name: /Comercial/ });
    fireEvent.change(screen.getByLabelText("Nome do elenco para salvar"), { target: { value: "Time comercial" } });
    fireEvent.click(screen.getByLabelText("Para a agência toda"));
    fireEvent.click(screen.getByRole("button", { name: /Salvar elenco/ }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", nome: "Time comercial", especialistas: ["comercial", "estrategista_marca", "copywriter", "cetico"], modo: "padrao", rodadas: 4, daAgencia: true })));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Frente BRF: o link público por tipo (modelo, dado já sabido para
 * confirmar, salvar parcial por chave, validade, envio único com trava e
 * pedido de reabertura) e a janela de gerar o link na equipe.
 */

const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    functions: { invoke },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(), webhooks: { processDiagnostic: "x" } }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "c1", company_name: "Padaria Aurora" }] }), useProjects: () => ({ data: [] }) }));

const TOKEN = "0f0e6c8a-1111-4222-8333-444455556666";

const montar = async () => {
  const { default: BriefingPublic } = await import("@/pages/BriefingPublic");
  return render(
    <MemoryRouter initialEntries={[`/briefing/${TOKEN}`]}>
      <Routes>
        <Route path="/briefing/:token" element={<BriefingPublic />} />
      </Routes>
    </MemoryRouter>,
  );
};

const aberto = (extra: Record<string, unknown> = {}) => ({
  id: "b1",
  submitted: false,
  expirado: false,
  responses: {},
  modelo: "site",
  modelo_conteudo: null,
  prefill: { empresa: "Padaria Aurora" },
  cliente_nome: "Padaria Aurora",
  tem_cliente: false,
  expira_em: "2099-01-01T00:00:00Z",
  anexos: [],
  equipe: false,
  ...extra,
});

describe("link público por tipo", () => {
  beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
  });

  it("abre o modelo do link (site) com o dado já sabido para confirmar", async () => {
    rpc.mockImplementation((nome: string) => (nome === "briefing_public_get" ? Promise.resolve({ data: aberto(), error: null }) : Promise.resolve({ data: { ok: true }, error: null })));
    await montar();
    expect(await screen.findByText("Briefing do site")).toBeInTheDocument();
    expect(screen.getAllByText("Padaria Aurora").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Está certo/i })).toBeInTheDocument();
    expect(screen.getByText("Tipo de site")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Loja virtual" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar briefing/i })).toBeInTheDocument();
  });

  it("salva parcial no servidor só com as chaves que mudaram", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rpc.mockImplementation((nome: string, args: any) => {
      if (nome === "briefing_public_get") return Promise.resolve({ data: aberto(), error: null });
      if (nome === "briefing_public_save") return Promise.resolve({ data: { ok: true, salvo_em: "2026-09-30T12:00:00Z", respostas: args._mudancas }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    await montar();
    const campo = await screen.findByLabelText(/Conte a história da empresa/i);
    fireEvent.change(campo, { target: { value: "Padaria de bairro desde 2012" } });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("briefing_public_save", { _token: TOKEN, _mudancas: { historia: "Padaria de bairro desde 2012" } }));
    await waitFor(() => expect(screen.getByText(/Salvo às/)).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("link expirado diz que expirou e não mostra o formulário", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: { id: "b1", submitted: false, expirado: true, modelo: "site", expira_em: "2026-09-01T00:00:00Z", cliente_nome: "Padaria Aurora" }, error: null }));
    await montar();
    expect(await screen.findByText("Este link expirou")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar/i })).toBeNull();
  });

  it("depois de enviado fica travado e pede reabertura pela RPC", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "briefing_public_get") return Promise.resolve({ data: aberto({ submitted: true, enviado_em: "2026-09-30T12:00:00Z", responses: { historia: "Padaria de bairro" } }), error: null });
      if (nome === "briefing_public_pedir_reabertura") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    await montar();
    expect(await screen.findByText("Padaria de bairro")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Conte a história/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Pedir reabertura/i }));
    fireEvent.change(screen.getByLabelText(/O que você quer mudar/i), { target: { value: "Trocar as referências" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar pedido/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("briefing_public_pedir_reabertura", { _token: TOKEN, _motivo: "Trocar as referências" }));
    expect(await screen.findByText(/Reabertura pedida em/)).toBeInTheDocument();
  });

  it("envio único: recusado porque já foi enviado em outra tela, mostra o travado (não finge sucesso)", async () => {
    let lidas = 0;
    rpc.mockImplementation((nome: string) => {
      if (nome === "briefing_public_get") {
        lidas += 1;
        return Promise.resolve({ data: lidas === 1 ? aberto({ modelo: "diagnostico", prefill: {} }) : aberto({ modelo: "diagnostico", prefill: {}, submitted: true, responses: { companyName: "Aurora" } }), error: null });
      }
      if (nome === "briefing_public_submit") return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    // Diagnóstico todo respondido no aparelho (formato antigo).
    localStorage.setItem(
      `briefing_answers_${TOKEN}`,
      JSON.stringify({
        companyName: "Aurora", segment: "Varejo", companyAge: "1 a 3 anos", companyDescription: "Pães", digitalPresence: ["Instagram"], paidTraffic: "Nunca investi",
        digitalLevel: "Boa · funciona, mas quero escalar", objectives: ["Aumentar vendas"], expectedResults: "Primeiros leads e contatos", biggestChallenge: "Concorrência",
        idealClient: "Famílias", region: "Estadual", howClientsFind: ["WhatsApp"], budget: "Ainda não sei",
      }),
    );
    await montar();
    fireEvent.click(await screen.findByRole("button", { name: /Enviar diagnóstico/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("briefing_public_submit", expect.objectContaining({ _token: TOKEN })));
    expect(await screen.findByRole("button", { name: /Pedir reabertura/i })).toBeInTheDocument();
    expect(screen.queryByText("Diagnóstico enviado")).toBeNull();
  });
});

describe("gerar o link na equipe", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("gera pelo servidor com o modelo escolhido e entrega link, WhatsApp e texto do grupo", async () => {
    invoke.mockResolvedValue({
      data: { briefing: { id: "b9", token: TOKEN, expira_em: "2026-10-30T12:00:00Z", modelo: "video" }, caminho: `/briefing/${TOKEN}`, cliente: "Padaria Aurora", telefone: "41999990000", prefill_campos: ["empresa"] },
      error: null,
    });
    const { default: GerarLinkDoBriefing } = await import("@/components/briefing/GerarLinkDoBriefing");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GerarLinkDoBriefing open onClose={() => {}} clientId="c1" modelo="video" />
      </QueryClientProvider>,
    );
    expect((screen.getByLabelText(/Tipo de briefing/i) as HTMLSelectElement).value).toBe("video");
    fireEvent.change(screen.getByLabelText(/Validade/i), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar link/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("briefing-agente", { body: expect.objectContaining({ acao: "gerar_link", client_id: "c1", modelo: "video", validade_dias: 15 }) }));
    const link = await screen.findByDisplayValue(`https://app.example.com/briefing/${TOKEN}`);
    expect(link).toBeInTheDocument();
    const wa = screen.getByRole("link", { name: /WhatsApp/i }) as HTMLAnchorElement;
    expect(wa.href).toContain("https://wa.me/5541999990000?text=");
    expect(decodeURIComponent(wa.href)).toContain("briefing de vídeo e motion");
    expect(screen.getByRole("button", { name: /Texto do grupo/i })).toBeInTheDocument();
  });
});

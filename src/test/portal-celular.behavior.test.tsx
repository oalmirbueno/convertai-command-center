import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Portal do cliente no celular (16/10/2026, dono: "cara de aplicativo, menos
 * informação, sem tela se mexendo"). Abaixo de 640 px:
 * - Início: saudação curta, cartões do que importa agora e o resto recolhido
 *   em "Mais detalhes";
 * - Aprovações: um item por vez (os pendentes primeiro), Aprovar e Pedir
 *   ajuste no pé, setas e contador para passar ao próximo;
 * - Pedidos: lista de app que abre numa folha, "Novo pedido" fixo no pé.
 * De 640 px para cima continua tudo como antes.
 */

const larguraOriginal = window.innerWidth;
function largura(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: px });
}

const pedidos = [
  { id: "p1", client_id: "c1", title: "Ajuste na bio", description: "Trocar o horário de atendimento", priority: "normal", status: "new", created_at: "2026-09-24T10:00:00Z" },
  { id: "p2", client_id: "c1", title: "Foto de capa", description: "Fachada nova", priority: "low", status: "completed", created_at: "2026-09-10T10:00:00Z" },
];

const arquivos = [
  { id: "a1", file_name: "post-aprovado.png", file_url: "https://x/a1.png", visibility: "approval", requires_approval: true, status: "ready", approval_status: "approved", version: 1, created_at: "2026-10-01T10:00:00Z", project: { name: "Social" } },
  { id: "a2", file_name: "post-novo.png", file_url: "https://x/a2.png", visibility: "approval", requires_approval: true, status: "ready", approval_status: "pending", version: 1, created_at: "2026-10-10T10:00:00Z", project: { name: "Social" } },
];

const painel = {
  activeProjects: [{ id: "pr1", name: "Social", project_type: "social_media", status: "active" }],
  doneProjects: [],
  milestones: [],
  completedMilestonesCount: 0,
  totalMilestones: 0,
  pendingFiles: [{ id: "a2", file_name: "post-novo.png", project: { name: "Social" } }],
  deliveredFiles: [{ id: "d1", file_name: "entrega-um.png", created_at: "2026-10-02T10:00:00Z", project: { name: "Social" } }],
  approvedFiles: 1,
  totalFiles: 2,
  contentPublications: [],
  latestReport: null,
  clientProfile: { plan_status: "active" },
  clientPendingBilling: [],
  projects: [],
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c1" }, profile: { id: "c1", role: "client", full_name: "Marina Souza", company_name: "Aurora" } }),
}));
vi.mock("@/hooks/useClientIdentity", () => ({
  useClientIdentity: () => ({ clientId: "c1", isImpersonating: false, profile: { id: "c1" } }),
}));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(), webhooks: { clientRequest: "x" } }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta: any = {
    select: () => consulta,
    eq: () => consulta,
    order: () => Promise.resolve({ data: pedidos, error: null }),
    insert: () => Promise.resolve({ error: null }),
  };
  return { supabase: { from: () => consulta, functions: { invoke: () => Promise.resolve({ data: null, error: null }) } } };
});
vi.mock("@/hooks/useSupabaseData", () => ({
  useFiles: () => ({ data: arquivos, isLoading: false }),
}));
vi.mock("@/hooks/useFileApprovalDecision", () => ({
  useFileApprovalDecision: () => ({ decide: vi.fn(), submitting: false, isReadOnly: false }),
}));
vi.mock("@/hooks/useEditorialCalendar", () => ({
  useEditorialApprovalPreview: () => ({ data: [], isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/fileUrls", () => ({
  mediaKindFromFile: () => "image",
  isCarouselAssetGroup: () => false,
  resolveFileUrl: () => Promise.resolve("https://x/y.png"),
  useResolvedFileUrl: () => ({ url: "https://x/y.png" }),
}));
vi.mock("@/components/shared/FilePreviewContent", () => ({ default: () => <div>prévia</div> }));
vi.mock("@/components/client/dashboardHelpers", async () => {
  const real: any = await vi.importActual("@/components/client/dashboardHelpers");
  return {
    ...real,
    useClientDashboardData: () => ({ loadingProjects: false, errorProjects: false, refetchProjects: vi.fn(), data: painel }),
  };
});
vi.mock("@/components/dia-prioritario/CartaoDoDiaPrioritario", () => ({ default: ({ compacto }: { compacto?: boolean }) => <div>{compacto ? "Dia Prioritário em uma linha" : "Seu Dia Prioritário"}</div> }));
vi.mock("@/components/shared/ProjectJournal", () => ({ default: () => <div>Diário</div> }));

import ClientRequests from "@/pages/ClientRequests";
import ClientApprovals from "@/pages/ClientApprovals";
import ClientJourneyDashboard from "@/components/client/ClientJourneyDashboard";

function montar(no: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  largura(375);
});
afterEach(() => {
  cleanup();
  largura(larguraOriginal);
});

describe("Portal no celular: Início como aplicativo", () => {
  it("saudação curta, aprovar em destaque e o resto recolhido em Mais detalhes", async () => {
    montar(<ClientJourneyDashboard clientId="c1" clientName="Marina Souza" onSelectProject={() => {}} />);
    expect(screen.getByRole("heading", { name: "Olá, Marina" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aprovar agora/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Onde estamos/ })).toBeInTheDocument();
    // Recolhido: nem a faixa de números nem as entregas; o Dia Prioritário fica numa linha (23/10: antes sumia).
    expect(screen.queryByText("Entregas recentes")).not.toBeInTheDocument();
    expect(screen.getByText("Dia Prioritário em uma linha")).toBeInTheDocument();
    expect(screen.queryByText("Seu Dia Prioritário")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mais detalhes/ }));
    expect(await screen.findByText("Entregas recentes")).toBeInTheDocument();
    expect(screen.getByText("Seu Dia Prioritário")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Menos detalhes/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("no computador continua como antes", () => {
    largura(1280);
    montar(<ClientJourneyDashboard clientId="c1" clientName="Marina Souza" onSelectProject={() => {}} />);
    expect(screen.getByRole("heading", { name: "Bem-vindo de volta, Marina" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mais detalhes/ })).not.toBeInTheDocument();
    expect(screen.getByText("Entregas recentes")).toBeInTheDocument();
  });
});

describe("Portal no celular: Aprovações um item por vez", () => {
  it("o pendente vem primeiro, com Aprovar e Pedir ajuste no pé; a seta passa para o próximo", () => {
    montar(<ClientApprovals />);
    const visor = screen.getByRole("region", { name: "Aprovação" });
    expect(within(visor).getByText("1 de 2")).toBeInTheDocument();
    expect(within(visor).getByText("post-novo.png")).toBeInTheDocument();
    expect(within(visor).getByRole("button", { name: /Aprovar/ })).toBeEnabled();
    expect(within(visor).getByRole("button", { name: "Pedir ajuste" })).toBeEnabled();
    fireEvent.click(within(visor).getByRole("button", { name: "Próximo item" }));
    expect(within(visor).getByText("2 de 2")).toBeInTheDocument();
    expect(within(visor).getByText("post-aprovado.png")).toBeInTheDocument();
    expect(within(visor).queryByRole("button", { name: /^Aprovar$/ })).not.toBeInTheDocument();
  });

  it("Aprovar abre a confirmação de sempre (a decisão continua no mesmo caminho)", async () => {
    montar(<ClientApprovals />);
    fireEvent.click(within(screen.getByRole("region", { name: "Aprovação" })).getByRole("button", { name: /Aprovar/ }));
    expect(await screen.findByText("Confirmar aprovação?")).toBeInTheDocument();
  });

  it("no computador continua a grade de cartões", () => {
    largura(1280);
    montar(<ClientApprovals />);
    expect(screen.queryByRole("region", { name: "Aprovação" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver post-novo.png" })).toBeInTheDocument();
  });
});

describe("Portal no celular: Pedidos como lista de app", () => {
  it("a linha abre o pedido numa folha e o Novo pedido fica um só, no pé", async () => {
    montar(<ClientRequests />);
    const linha = await screen.findByRole("button", { name: /Ajuste na bio/ });
    // Lista enxuta: a descrição não aparece na linha.
    expect(screen.queryByText("Trocar o horário de atendimento")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Novo pedido/ })).toHaveLength(1);
    fireEvent.click(linha);
    const folha = await screen.findByRole("dialog");
    expect(within(folha).getByText("Trocar o horário de atendimento")).toBeInTheDocument();
    fireEvent.click(within(folha).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

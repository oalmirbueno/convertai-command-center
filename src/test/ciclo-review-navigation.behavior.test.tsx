import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configure } from "@testing-library/react";

// A tela inteira (rotas com import preguicoso) e montada em cada caso; na
// suite completa, com a maquina cheia, o findBy de 1s estourava e o teste
// falhava sem defeito. Folga, nao afrouxo: as assercoes continuam iguais.
configure({ asyncUtilTimeout: 8_000 });
vi.setConfig({ testTimeout: 60_000 });
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppRoutes } from "@/App";
import type { ReviewReport } from "@/lib/centralReview";
import type { ClienteDaEsteira } from "@/hooks/useEsteira";
import type { FatosDoCliente } from "@/lib/esteira/esteiraTipos";
import { montarEsteira } from "@/lib/esteira/esteiraMontar";

const state = vi.hoisted(() => ({
  role: "admin", signedIn: true, clients: [] as { id: string; company_name: string; plan_status: string; services_config: { social: boolean } }[],
  cycleClients: [] as ClienteDaEsteira[], reports: [] as ReviewReport[], invoke: vi.fn(),
  empty: [] as never[], dossiers: new Map(), now: new Date("2026-09-14T15:00:00Z"),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.signedIn ? { id: "operator" } : null, profile: { role: state.role, full_name: "Operador" }, loading: false }) }));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: state.clients }), useProjects: () => ({ data: state.empty }) }));
vi.mock("@/hooks/useFinancialData", () => ({ useBilling: () => ({ data: state.empty }) }));
vi.mock("@/hooks/useSocialMetrics", async (importOriginal) => ({ ...await importOriginal<object>(), useSocialMetricsWeekly: () => ({ data: state.empty }) }));
vi.mock("@/hooks/useAdsMetrics", () => ({ useAdsCampaigns: () => ({ data: state.empty }), useAdsDaily: () => ({ data: state.empty }) }));
vi.mock("@/hooks/useNow", () => ({ useNow: () => state.now }));
vi.mock("@/hooks/usePwaProfile", () => ({ usePwaProfile: () => undefined }));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotoDe: () => null }) }));
vi.mock("@/hooks/useEsteira", () => ({ useEsteira: () => ({ clientes: state.cycleClients, carregando: false, atualizando: false, erro: null, recarregar: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: state.invoke } } }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), refetchQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "exp-reports" ? state.reports : queryKey[0] === "exp-dossies" ? state.dossiers : state.empty, isLoading: false }),
}));
vi.mock("@/lib/esteira/esteiraAcoes", async (importOriginal) => ({ ...await importOriginal<object>(), lerPlanoDaSemana: vi.fn().mockResolvedValue(null) }));
vi.mock("@/components/central/CentralReviewQueue", () => ({ default: ({ reports }: { reports: ReviewReport[] }) => <section aria-label="Fila compartilhada">{reports.map(report => <p key={report.id}>{report.title}</p>)}</section> }));
vi.mock("@/pages/Login", () => ({ default: () => <h1>Login</h1> }));

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search}</output>; }
function mount(path: string) { return render(<MemoryRouter initialEntries={[path]}><AppRoutes /><Location /></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.role = "admin"; state.signedIn = true;
  state.clients = ["a", "b"].map(id => ({ id, company_name: `Cliente ${id.toUpperCase()}`, plan_status: "active", services_config: { social: true } }));
  state.reports = state.clients.map(client => ({ id: `report-${client.id}`, client_id: client.id, title: `Ritual ${client.company_name}`, status: "draft", summary: "Mensagem conferida", next_steps: "Próxima ação", review_version: 1, created_at: "2026-09-14T15:00:00Z", metrics: { central_review_source: { dossier_id: "synthetic" } } }));
  state.cycleClients = state.clients.map(client => {
    const facts: FatosDoCliente = { clientId: client.id, criadoEm: "2026-01-01", servicos: { social: true, trafego: false }, posts: [], tarefas: [], campanhas: [], contasAds: [], vendas: [], saldoVerba: null, checklists: [], marcos: [], conexoes: [], metricas: [], briefingRespondido: true, dossieResumo: null, onboardingHas: {}, estados: {}, rituais: [], oculto: { areas: [], ate: null } };
    return { id: client.id, nome: client.company_name, avatarUrl: null, tipo: "recurring", fatos: facts, esteira: montarEsteira(facts, new Date("2026-09-14T15:00:00Z"), "2026-09-14") };
  });
});

describe("Entrada da revisão no Ciclo", () => {
  it("abre a fila compartilhada pelo Ciclo sem gerar mensagens", async () => {
    mount("/ciclo"); fireEvent.click(await screen.findByRole("link", { name: "Revisão por cliente" }));
    expect(await screen.findByRole("heading", { name: "Ciclo · Revisão por cliente" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/ciclo/revisao");
    expect(screen.getByRole("region", { name: "Fila compartilhada" })).toHaveTextContent("Ritual Cliente A");
    expect(screen.getByRole("region", { name: "Fila compartilhada" })).toHaveTextContent("Ritual Cliente B");
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it("abre a revisão do cliente escolhido e permite voltar à carteira inteira", async () => {
    mount("/ciclo"); fireEvent.click(await screen.findByRole("button", { name: /Cliente A/ }));
    const link = await screen.findByRole("link", { name: "Revisar rituais deste cliente" });
    expect(link).toHaveAttribute("href", "/ciclo/revisao?client=a"); fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Ciclo · Revisão por cliente" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Fila compartilhada" })).toHaveTextContent("Ritual Cliente A");
    expect(screen.getByRole("region", { name: "Fila compartilhada" })).not.toHaveTextContent("Ritual Cliente B");
    fireEvent.click(screen.getByRole("link", { name: "Ver todos os clientes" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Fila compartilhada" })).toHaveTextContent("Ritual Cliente B"));
  });
  it("mantém o retorno de login no destino exato da revisão", async () => {
    state.signedIn = false; mount("/ciclo/revisao?client=a");
    expect(await screen.findByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fciclo%2Frevisao%3Fclient%3Da");
  });
  it("não oferece a revisão administrativa para manager e fecha acesso direto", async () => {
    state.role = "manager"; mount("/ciclo/revisao");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/ciclo$/));
    expect(screen.queryByRole("link", { name: "Revisão por cliente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ciclo · Revisão por cliente" })).not.toBeInTheDocument();
  });
});

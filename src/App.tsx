import { Toaster as Sonner } from "@/components/ui/sonner";
import { lazy, Suspense, type ReactNode } from "react";
import DownloadProgressOverlay from "@/components/shared/DownloadProgressOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AppLayout from "@/components/AppLayout";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

const Login = lazy(() => import("@/pages/Login"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const ClientDashboard = lazy(() => import("@/pages/ClientDashboard"));
const Kanban = lazy(() => import("@/pages/Kanban"));
const Clients = lazy(() => import("@/pages/Clients"));
const AdminFiles = lazy(() => import("@/pages/AdminFiles"));
const AdminApprovals = lazy(() => import("@/pages/AdminApprovals"));
const ClientDocuments = lazy(() => import("@/pages/ClientDocuments"));
const ClientApprovals = lazy(() => import("@/pages/ClientApprovals"));
const AdminRequests = lazy(() => import("@/pages/AdminRequests"));
const ClientRequests = lazy(() => import("@/pages/ClientRequests"));
const Team = lazy(() => import("@/pages/Team"));
const BriefingPublic = lazy(() => import("@/pages/BriefingPublic"));
const QuizPublicPage = lazy(() => import("@/pages/QuizPublicPage"));
const AdminBriefings = lazy(() => import("@/pages/AdminBriefings"));
const Projects = lazy(() => import("@/pages/Projects"));
const AdminFinanceiro = lazy(() => import("@/pages/AdminFinanceiro"));
const AdminComercial = lazy(() => import("@/pages/AdminComercial"));
const AdminProjection = lazy(() => import("@/pages/AdminProjection"));
const AdminExecucao = lazy(() => import("@/pages/AdminExecucao"));
const AdminMetricas = lazy(() => import("@/pages/AdminMetricas"));
const AdminAds = lazy(() => import("@/pages/AdminAds"));
const AdminCiclo = lazy(() => import("@/pages/AdminCiclo"));
const ClientFinanceiro = lazy(() => import("@/pages/ClientFinanceiro"));
const AdminReports = lazy(() => import("@/pages/AdminReports"));
const ClientReports = lazy(() => import("@/pages/ClientReports"));
const TimelinePage = lazy(() => import("@/pages/TimelinePage"));
const AdminReportCreate = lazy(() => import("@/pages/AdminReportCreate"));
const ReportDetail = lazy(() => import("@/pages/ReportDetail"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AdminViewAsClient = lazy(() => import("@/pages/AdminViewAsClient"));
const ApiDocs = lazy(() => import("@/pages/ApiDocs"));
const AdminQuizSubmissions = lazy(() => import("@/pages/AdminQuizSubmissions"));
const AdminBackfillPage = lazy(() => import("@/pages/AdminBackfillPage"));
const ClientVaultPage = lazy(() => import("@/pages/ClientVaultPage"));
const Workspace = lazy(() => import("@/pages/Workspace"));
const AdminExperience = lazy(() => import("@/pages/AdminExperience"));
const ClientJourneyUpdates = lazy(() => import("@/pages/ClientJourneyUpdates"));
const UnsubscribePage = lazy(() => import("@/pages/UnsubscribePage"));
const FirstAccess = lazy(() => import("@/pages/FirstAccess"));
const AdminContracts = lazy(() => import("@/pages/AdminContracts"));
const EditorialCalendar = lazy(() => import("@/pages/EditorialCalendar"));
const ContractPublic = lazy(() => import("@/pages/ContractPublic"));
const WorkspaceInboxPublic = lazy(() => import("@/pages/WorkspaceInboxPublic"));
const OAuthConsent = lazy(() => import("@/pages/OAuthConsent"));
const MetaOAuthCallback = lazy(() => import("@/pages/MetaOAuthCallback"));
const MCPConnect = lazy(() => import("@/pages/MCPConnect"));
const Novidades = lazy(() => import("@/pages/Novidades"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden bg-background">
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex h-40 w-40 rounded-full bg-primary/12 blur-2xl" />
        {/* Aceleracao: a marca entra em velocidade da esquerda, com rastro de
            movimento, e freia suave na posicao. Sem piscar, sem elementos extras. */}
        <span
          aria-hidden="true"
          className="absolute right-[55%] top-[38%] h-[2px] w-24 rounded-full bg-primary/60 animate-[speedline_0.7s_ease-out_both]"
        />
        <span
          aria-hidden="true"
          className="absolute right-[52%] top-[58%] h-[2px] w-16 rounded-full bg-primary/35 animate-[speedline_0.7s_0.08s_ease-out_both]"
        />
        <img
          src={aceleriqLogo}
          alt="Aceleriq"
          className="brand-logo relative h-24 w-auto animate-[accelIn_0.75s_cubic-bezier(0.16,1,0.3,1)_both] drop-shadow-[0_0_28px_hsl(var(--primary)/0.35)]"
        />
      </div>
      <style>{`
        @keyframes accelIn {
          0%   { transform: translateX(-160px) skewX(-8deg); opacity: 0; filter: blur(6px); }
          55%  { transform: translateX(10px) skewX(2deg); opacity: 1; filter: blur(0.5px); }
          100% { transform: translateX(0) skewX(0); opacity: 1; filter: blur(0); }
        }
        @keyframes speedline {
          0%   { transform: translateX(-140px) scaleX(1.4); opacity: 0; }
          30%  { opacity: 1; }
          100% { transform: translateX(60px) scaleX(0.2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Rota exclusiva da equipe. O cliente que digitar a URL na mao volta para o
 * painel dele, sem ver nenhuma tela interna da agencia. O RLS ja protege os
 * dados; esta trava evita expor a casca administrativa.
 */
function StaffRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  const isStaff =
    profile?.role === "admin" ||
    ["design", "traffic", "manager"].includes(profile?.role || "");
  if (!isStaff) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Rota do Departamento Comercial.
 *
 * Mais estreita que StaffRoute de propósito: design e tráfego são equipe,
 * mas operam entrega — funil, metas e investimento de marketing são gestão.
 * Esta é a ÚNICA régua de quem entra no comercial no lado do app; o RLS das
 * tabelas repete a mesma no banco, que é quem de fato protege o dado. Se um
 * dia existir um papel "comercial", ele se soma aqui e na política, e em
 * mais lugar nenhum.
 */
function ComercialRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  const podeVer = profile?.role === "admin" || profile?.role === "manager";
  if (!podeVer) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      {/* Compatibility alias for projects that still use Lovable's consent URL. */}
      <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
      <Route path="/briefing/:token" element={<BriefingPublic />} />
      <Route path="/contrato/:token" element={<ContractPublic />} />
      <Route path="/inbox/:token" element={<WorkspaceInboxPublic />} />
      <Route path="/quiz/:token" element={<QuizPublicPage />} />
      <Route path="/unsubscribe" element={<UnsubscribePage />} />
      <Route path="/conectar-mcp" element={<MCPConnect />} />
      <Route path="/primeiro-acesso" element={<FirstAccess />} />
      <Route path="/oauth/meta/callback" element={<ProtectedRoute><MetaOAuthCallback /></ProtectedRoute>} />

      <Route path="/dashboard" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminDashboard /> : <ClientDashboard />}</AppLayout></ProtectedRoute>} />
      <Route path="/projetos" element={<ProtectedRoute><AppLayout><Projects /></AppLayout></ProtectedRoute>} />
      <Route path="/briefings" element={<ProtectedRoute><StaffRoute><AppLayout><AdminBriefings /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/kanban" element={<ProtectedRoute><StaffRoute><AppLayout><Kanban /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/execucao" element={<ProtectedRoute><StaffRoute><AppLayout><AdminExecucao /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/metricas" element={<ProtectedRoute><StaffRoute><AppLayout><AdminMetricas /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/anuncios" element={<ProtectedRoute><StaffRoute><AppLayout><AdminAds /></AppLayout></StaffRoute></ProtectedRoute>} />
      {/* Ciclo roda fora do AppLayout: é um aplicativo à parte, abre em tela
          cheia e usa toda a largura no celular. Duas URLs servem a mesma
          tela: /ciclo pelo painel e /ciclo.html quando aberto pelo ícone do
          aplicativo instalado. */}
      <Route path="/ciclo" element={<ProtectedRoute><StaffRoute><AdminCiclo /></StaffRoute></ProtectedRoute>} />
      {/* Endereço antigo do app instalado: leva para o atual. */}
      <Route path="/ciclo.html" element={<Navigate to="/ciclo" replace />} />
      <Route path="/calendario" element={<ProtectedRoute><AppLayout><EditorialCalendar /></AppLayout></ProtectedRoute>} />
      <Route path="/clientes" element={<ProtectedRoute><StaffRoute><AppLayout><Clients /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/equipe" element={<ProtectedRoute><StaffRoute><AppLayout><Team /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/arquivos" element={<ProtectedRoute><StaffRoute><AppLayout><AdminFiles /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/config" element={<ProtectedRoute><StaffRoute><AppLayout><SettingsPage /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/pedidos" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminRequests /> : <ClientRequests />}</AppLayout></ProtectedRoute>} />
      <Route path="/documentos" element={<ProtectedRoute><AppLayout><ClientDocuments /></AppLayout></ProtectedRoute>} />
      <Route path="/perfil" element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
      <Route path="/aprovacoes" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminApprovals /> : <ClientApprovals />}</AppLayout></ProtectedRoute>} />
      <Route path="/relatorios" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminReports /> : <ClientReports />}</AppLayout></ProtectedRoute>} />
      <Route path="/relatorios/novo" element={<ProtectedRoute><StaffRoute><AppLayout><AdminReportCreate /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/relatorios/:id" element={<ProtectedRoute><AppLayout><ReportDetail /></AppLayout></ProtectedRoute>} />
      <Route path="/timeline" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <TimelinePage /> : <Navigate to="/dashboard" replace />}</AppLayout></ProtectedRoute>} />
      <Route path="/ver-como-cliente" element={<ProtectedRoute><StaffRoute><AppLayout><AdminViewAsClient /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/financeiro" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminFinanceiro /> : <ClientFinanceiro />}</AppLayout></ProtectedRoute>} />
      <Route path="/comercial" element={<ProtectedRoute><ComercialRoute><AppLayout><AdminComercial /></AppLayout></ComercialRoute></ProtectedRoute>} />
      {/* Cada area do departamento tem endereco proprio: o menu aponta
          direto para ela, o voltar do navegador funciona e o link pode
          ser mandado para alguem. */}
      <Route path="/comercial/:aba" element={<ProtectedRoute><ComercialRoute><AppLayout><AdminComercial /></AppLayout></ComercialRoute></ProtectedRoute>} />
      <Route path="/financeiro/projecao" element={<ProtectedRoute><StaffRoute><AppLayout><AdminProjection /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/api-docs" element={<ProtectedRoute><StaffRoute><AppLayout><ApiDocs /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/admin/quiz" element={<ProtectedRoute><StaffRoute><AppLayout><AdminQuizSubmissions /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/admin/backfill" element={<ProtectedRoute><StaffRoute><AppLayout><AdminBackfillPage /></AppLayout></StaffRoute></ProtectedRoute>} />
      <Route path="/cofre" element={<ProtectedRoute><AppLayout><ClientVaultPage /></AppLayout></ProtectedRoute>} />
      <Route path="/workspace" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <Workspace /> : <Navigate to="/dashboard" replace />}</AppLayout></ProtectedRoute>} />
      <Route path="/central" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminExperience /> : <Navigate to="/dashboard" replace />}</AppLayout></ProtectedRoute>} />
      <Route path="/onde-estamos" element={<ProtectedRoute><AppLayout><ClientJourneyUpdates /></AppLayout></ProtectedRoute>} />
      <Route path="/novidades" element={<ProtectedRoute><AppLayout><Novidades /></AppLayout></ProtectedRoute>} />
      <Route path="/contratos" element={<ProtectedRoute><StaffRoute><AppLayout><AdminContracts /></AppLayout></StaffRoute></ProtectedRoute>} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Sonner />
        <DownloadProgressOverlay />
        <AuthProvider>
          <ImpersonationProvider profile={null} clientId={null}>
            <ConfirmDialogProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </ConfirmDialogProvider>
          </ImpersonationProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

import { Toaster as Sonner } from "@/components/ui/sonner";
import { lazy, Suspense, type ReactNode } from "react";
import DownloadProgressOverlay from "@/components/shared/DownloadProgressOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
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
const AdminProjection = lazy(() => import("@/pages/AdminProjection"));
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
const UnsubscribePage = lazy(() => import("@/pages/UnsubscribePage"));
const FirstAccess = lazy(() => import("@/pages/FirstAccess"));
const AdminContracts = lazy(() => import("@/pages/AdminContracts"));
const EditorialCalendar = lazy(() => import("@/pages/EditorialCalendar"));
const ContractPublic = lazy(() => import("@/pages/ContractPublic"));
const WorkspaceInboxPublic = lazy(() => import("@/pages/WorkspaceInboxPublic"));
const OAuthConsent = lazy(() => import("@/pages/OAuthConsent"));
const MetaOAuthCallback = lazy(() => import("@/pages/MetaOAuthCallback"));
const MCPConnect = lazy(() => import("@/pages/MCPConnect"));

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
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="relative flex items-center justify-center">
        {/* halo pulsante */}
        <span className="absolute inline-flex h-40 w-40 rounded-full bg-primary/15 blur-2xl animate-[ping_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
        <span className="absolute inline-flex h-24 w-24 rounded-full bg-primary/25 blur-xl animate-[ping_2.2s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
        {/* logo com respiração suave */}
        <img
          src={aceleriqLogo}
          alt="Aceleriq"
          className="relative h-24 w-auto drop-shadow-[0_0_28px_hsl(var(--primary)/0.55)] animate-[breathe_1.8s_ease-in-out_infinite]"
        />
      </div>
      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1);    opacity: .95; filter: drop-shadow(0 0 22px hsl(var(--primary)/.45)); }
          50%      { transform: scale(1.06); opacity: 1;   filter: drop-shadow(0 0 38px hsl(var(--primary)/.75)); }
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
      <Route path="/briefings" element={<ProtectedRoute><AppLayout><AdminBriefings /></AppLayout></ProtectedRoute>} />
      <Route path="/kanban" element={<ProtectedRoute><AppLayout><Kanban /></AppLayout></ProtectedRoute>} />
      <Route path="/calendario" element={<ProtectedRoute><AppLayout><EditorialCalendar /></AppLayout></ProtectedRoute>} />
      <Route path="/clientes" element={<ProtectedRoute><AppLayout><Clients /></AppLayout></ProtectedRoute>} />
      <Route path="/equipe" element={<ProtectedRoute><AppLayout><Team /></AppLayout></ProtectedRoute>} />
      <Route path="/arquivos" element={<ProtectedRoute><AppLayout><AdminFiles /></AppLayout></ProtectedRoute>} />
      <Route path="/config" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="/pedidos" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminRequests /> : <ClientRequests />}</AppLayout></ProtectedRoute>} />
      <Route path="/documentos" element={<ProtectedRoute><AppLayout><ClientDocuments /></AppLayout></ProtectedRoute>} />
      <Route path="/perfil" element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
      <Route path="/aprovacoes" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminApprovals /> : <ClientApprovals />}</AppLayout></ProtectedRoute>} />
      <Route path="/relatorios" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminReports /> : <ClientReports />}</AppLayout></ProtectedRoute>} />
      <Route path="/relatorios/novo" element={<ProtectedRoute><AppLayout><AdminReportCreate /></AppLayout></ProtectedRoute>} />
      <Route path="/relatorios/:id" element={<ProtectedRoute><AppLayout><ReportDetail /></AppLayout></ProtectedRoute>} />
      <Route path="/timeline" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <TimelinePage /> : <Navigate to="/dashboard" replace />}</AppLayout></ProtectedRoute>} />
      <Route path="/ver-como-cliente" element={<ProtectedRoute><AppLayout><AdminViewAsClient /></AppLayout></ProtectedRoute>} />
      <Route path="/financeiro" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminFinanceiro /> : <ClientFinanceiro />}</AppLayout></ProtectedRoute>} />
      <Route path="/financeiro/projecao" element={<ProtectedRoute><AppLayout><AdminProjection /></AppLayout></ProtectedRoute>} />
      <Route path="/api-docs" element={<ProtectedRoute><AppLayout><ApiDocs /></AppLayout></ProtectedRoute>} />
      <Route path="/admin/quiz" element={<ProtectedRoute><AppLayout><AdminQuizSubmissions /></AppLayout></ProtectedRoute>} />
      <Route path="/admin/backfill" element={<ProtectedRoute><AppLayout><AdminBackfillPage /></AppLayout></ProtectedRoute>} />
      <Route path="/cofre" element={<ProtectedRoute><AppLayout><ClientVaultPage /></AppLayout></ProtectedRoute>} />
      <Route path="/workspace" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <Workspace /> : <Navigate to="/dashboard" replace />}</AppLayout></ProtectedRoute>} />
      <Route path="/central" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminExperience /> : <Navigate to="/dashboard" replace />}</AppLayout></ProtectedRoute>} />
      <Route path="/contratos" element={<ProtectedRoute><AppLayout><AdminContracts /></AppLayout></ProtectedRoute>} />

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
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ImpersonationProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

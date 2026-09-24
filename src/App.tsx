import { Toaster as Sonner } from "@/components/ui/sonner";
import { lazy, Suspense, type ReactNode } from "react";
import DownloadProgressOverlay from "@/components/shared/DownloadProgressOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { criarQueryClient, LimpezaDoCacheAoTrocarDeUsuario, opcoesDePersistencia } from "@/lib/mesa/cachePersistido";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AppLayout from "@/components/AppLayout";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
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
const AdminEsteira = lazy(() => import("@/pages/AdminEsteira"));
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
const MesaDoCliente = lazy(() => import("@/pages/MesaDoCliente"));
const MesaAds = lazy(() => import("@/pages/MesaAds"));

// Padrões do painel e o cache da Mesa guardado no navegador: ver
// src/lib/mesa/cachePersistido.ts (o que vai, por quanto tempo e para quem).
const queryClient = criarQueryClient();
const persistencia = opcoesDePersistencia();

/** Página nova ainda baixando: o menu e o topo ficam; só o conteúdo pulsa. */
function EsqueletoDaPagina() {
  return (
    <div aria-busy="true" aria-label="Abrindo a página" className="space-y-4 pb-10">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted/80" />
      <div className="h-[45vh] animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

/** Enquanto a Mesa baixa: o menu fica, e a tela já tem o desenho dela. */
function EsqueletoDaMesa() {
  return (
    <div aria-busy="true" aria-label="Abrindo a Mesa" className="space-y-5 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="h-8 w-52 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 w-full animate-pulse rounded-lg bg-muted sm:ml-auto sm:w-[280px]" />
      </div>
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-10 animate-pulse rounded-xl bg-muted" />
      <div className="h-[55vh] animate-pulse rounded-xl bg-muted/70" />
    </div>
  );
}

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
  const { user, profile, profileError, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  // Usuário já conhecido e papel ainda a caminho: espera. Decidir agora
  // tratava a equipe como cliente (menu de cliente e a Mesa jogando para o
  // /dashboard na carga da página). Erro de perfil tem tela própria.
  if (!profile && !profileError) return <LoadingScreen />;
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

/**
 * Perfil do usuário logado não veio do servidor depois das tentativas. Abrir
 * o painel assim mostraria a tela de cliente para o dono (papel nulo cai no
 * padrão); melhor uma tela honesta com o botão de tentar de novo.
 */
function ProfileErrorScreen() {
  const { retryProfile, logout } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center bg-background">
      <img src={aceleriqLogo} alt="Aceleriq" className="brand-logo h-20 w-auto opacity-90" />
      <p className="text-lg font-semibold text-foreground">Não conseguimos carregar o seu perfil</p>
      <p className="max-w-[420px] text-sm leading-relaxed text-muted-foreground">
        O servidor não respondeu a tempo. Confira a internet e tente de novo; a sua sessão continua válida.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => { void retryProfile(); }}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
        >
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={() => { void logout(); }}
          className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/50 transition-colors cursor-pointer bg-transparent"
        >
          Sair
        </button>
      </div>
    </div>
  );
}

export function AppRoutes() {
  const { user, profile, loading, profileError } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user && !profile && profileError) return <ProfileErrorScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}>
      {/* Erro de render numa tela fica contido nela (RouteErrorBoundary);
          o AppErrorBoundary do main.tsx continua sendo a rede do boot. */}
      <RouteErrorBoundary>
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

      {/* Ciclo roda fora do AppLayout: é um aplicativo à parte, abre em tela
          cheia e usa toda a largura no celular. Duas URLs servem a mesma
          tela: /ciclo pelo painel e /ciclo.html quando aberto pelo ícone do
          aplicativo instalado. */}
      {/* /ciclo e a Esteira (le o estado real). O Ciclo anterior fica em
          /ciclo-antigo para comparacao e retorno rapido. */}
      <Route path="/ciclo" element={<ProtectedRoute><StaffRoute><AdminEsteira /></StaffRoute></ProtectedRoute>} />
      <Route path="/ciclo/revisao" element={<ProtectedRoute><StaffRoute>{profile?.role === "admin" ? <AdminExperience cycleReview /> : <Navigate to="/ciclo" replace />}</StaffRoute></ProtectedRoute>} />
      <Route path="/ciclo-antigo" element={<ProtectedRoute><StaffRoute><AdminCiclo /></StaffRoute></ProtectedRoute>} />
      {/* Endereço antigo do app instalado: leva para o atual. */}
      <Route path="/ciclo.html" element={<Navigate to="/ciclo" replace />} />
      {/* Casca do painel montada UMA vez (24/09/2026): antes cada rota montava o
          próprio AppLayout e a troca de página desmontava menu e topo, parecendo
          que o painel reiniciava. As páginas trocam dentro do Outlet, e o
          carregamento de página nova fica só na área do conteúdo. */}
      <Route element={<ProtectedRoute><AppLayout><Suspense fallback={<EsqueletoDaPagina />}><Outlet /></Suspense></AppLayout></ProtectedRoute>}>
        <Route path="/dashboard" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminDashboard /> : <ClientDashboard />}</>} />
        <Route path="/projetos" element={<Projects />} />
        <Route path="/briefings" element={<StaffRoute><AdminBriefings /></StaffRoute>} />
        <Route path="/kanban" element={<StaffRoute><Kanban /></StaffRoute>} />
        <Route path="/execucao" element={<StaffRoute><AdminExecucao /></StaffRoute>} />
        <Route path="/metricas" element={<StaffRoute><AdminMetricas /></StaffRoute>} />
        <Route path="/anuncios" element={<StaffRoute><AdminAds /></StaffRoute>} />
        <Route path="/calendario" element={<EditorialCalendar />} />
        <Route path="/clientes" element={<StaffRoute><Clients /></StaffRoute>} />
        <Route path="/equipe" element={<StaffRoute><Team /></StaffRoute>} />
        <Route path="/arquivos" element={<StaffRoute><AdminFiles /></StaffRoute>} />
        <Route path="/config" element={<StaffRoute><SettingsPage /></StaffRoute>} />
        <Route path="/pedidos" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminRequests /> : <ClientRequests />}</>} />
        <Route path="/documentos" element={<ClientDocuments />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/aprovacoes" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminApprovals /> : <ClientApprovals />}</>} />
        <Route path="/relatorios" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminReports /> : <ClientReports />}</>} />
        <Route path="/relatorios/novo" element={<StaffRoute><AdminReportCreate /></StaffRoute>} />
        <Route path="/relatorios/:id" element={<ReportDetail />} />
        <Route path="/timeline" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <TimelinePage /> : <Navigate to="/dashboard" replace />}</>} />
        <Route path="/ver-como-cliente" element={<StaffRoute><AdminViewAsClient /></StaffRoute>} />
        <Route path="/financeiro" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminFinanceiro /> : <ClientFinanceiro />}</>} />
        <Route path="/comercial" element={<ComercialRoute><AdminComercial /></ComercialRoute>} />
        {/* Cada area do departamento tem endereco proprio: o menu aponta
            direto para ela, o voltar do navegador funciona e o link pode
            ser mandado para alguem. */}
        <Route path="/comercial/:aba" element={<ComercialRoute><AdminComercial /></ComercialRoute>} />
        <Route path="/financeiro/projecao" element={<StaffRoute><AdminProjection /></StaffRoute>} />
        <Route path="/api-docs" element={<StaffRoute><ApiDocs /></StaffRoute>} />
        <Route path="/admin/quiz" element={<StaffRoute><AdminQuizSubmissions /></StaffRoute>} />
        <Route path="/admin/backfill" element={<StaffRoute><AdminBackfillPage /></StaffRoute>} />
        <Route path="/cofre" element={<ClientVaultPage />} />
        <Route path="/workspace" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <Workspace /> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa do cliente: calendário e estúdio de arte com IA. Só admin,
            gestor e design; tráfego e cliente voltam para o painel. */}
        {/* Suspense próprio: enquanto a Mesa baixa, o menu continua na tela e
            aparece o esqueleto dela, não a tela cheia de carregando. */}
        <Route path="/mesa" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaDoCliente /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Ads: criativos de anúncio (docs/mesa-ads/SPEC.md). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-ads" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaAds /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        <Route path="/central" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminExperience /> : <Navigate to="/dashboard" replace />}</>} />
        <Route path="/onde-estamos" element={<ClientJourneyUpdates />} />
        <Route path="/novidades" element={<Novidades />} />
        <Route path="/contratos" element={<StaffRoute><AdminContracts /></StaffRoute>} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </RouteErrorBoundary>
    </Suspense>
  );
}

const App = () => (
  <PersistQueryClientProvider client={queryClient} persistOptions={persistencia}>
    <ThemeProvider>
      <TooltipProvider>
        <Sonner />
        <DownloadProgressOverlay />
        <AuthProvider>
          <LimpezaDoCacheAoTrocarDeUsuario />
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
  </PersistQueryClientProvider>
);

export default App;

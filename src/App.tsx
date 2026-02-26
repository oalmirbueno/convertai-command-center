import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";
import ClientDashboard from "@/pages/ClientDashboard";
import Kanban from "@/pages/Kanban";
import Clients from "@/pages/Clients";
import AdminFiles from "@/pages/AdminFiles";
import AdminApprovals from "@/pages/AdminApprovals";
import ClientDocuments from "@/pages/ClientDocuments";
import ClientApprovals from "@/pages/ClientApprovals";
import AdminRequests from "@/pages/AdminRequests";
import ClientRequests from "@/pages/ClientRequests";
import Team from "@/pages/Team";
import BriefingPublic from "@/pages/BriefingPublic";
import AdminBriefings from "@/pages/AdminBriefings";
import Projects from "@/pages/Projects";
import AdminFinanceiro from "@/pages/AdminFinanceiro";
import ClientFinanceiro from "@/pages/ClientFinanceiro";
import AdminReports from "@/pages/AdminReports";
import ClientReports from "@/pages/ClientReports";
import TimelinePage from "@/pages/TimelinePage";
import AdminReportCreate from "@/pages/AdminReportCreate";
import ReportDetail from "@/pages/ReportDetail";
import ProfilePage from "@/pages/ProfilePage";
import SettingsPage from "@/pages/SettingsPage";
import AppLayout from "@/components/AppLayout";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <img src={aceleriqLogo} alt="Aceleriq" className="h-20 w-auto animate-pulse" />
      <p className="text-xs text-muted-foreground">Carregando...</p>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/briefing/:token" element={<BriefingPublic />} />

      <Route path="/dashboard" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminDashboard /> : <ClientDashboard />}</AppLayout></ProtectedRoute>} />
      <Route path="/projetos" element={<ProtectedRoute><AppLayout><Projects /></AppLayout></ProtectedRoute>} />
      <Route path="/briefings" element={<ProtectedRoute><AppLayout><AdminBriefings /></AppLayout></ProtectedRoute>} />
      <Route path="/kanban" element={<ProtectedRoute><AppLayout><Kanban /></AppLayout></ProtectedRoute>} />
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
      <Route path="/timeline" element={<ProtectedRoute><AppLayout><TimelinePage /></AppLayout></ProtectedRoute>} />
      <Route path="/financeiro" element={<ProtectedRoute><AppLayout>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminFinanceiro /> : <ClientFinanceiro />}</AppLayout></ProtectedRoute>} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

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
import Placeholder from "@/pages/Placeholder";
import SeedPage from "@/pages/SeedPage";
import AppLayout from "@/components/AppLayout";

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center animate-pulse">
        <span className="text-base font-bold text-primary-foreground">C</span>
      </div>
      <p className="text-xs text-muted-foreground">Carregando...</p>
    </div>
  );
}

function AppRoutes() {
  const { user, authState } = useAuth();

  // NEVER redirect during loading - just show spinner
  if (authState === "loading") {
    return <LoadingScreen />;
  }

  // Not authenticated - show login on all routes
  if (authState === "unauthenticated") {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // Authenticated - show app
  return (
    <AppLayout>
      <Routes>
        <Route path="/dashboard" element={user?.role === "admin" ? <AdminDashboard /> : <ClientDashboard />} />
        <Route path="/projetos" element={<Placeholder title="Projetos" />} />
        {user?.role === "admin" && (
          <>
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/equipe" element={<Placeholder title="Equipe" />} />
            <Route path="/ia-planner" element={<Placeholder title="IA Planner" />} />
            <Route path="/arquivos" element={<Placeholder title="Arquivos" />} />
            <Route path="/config" element={<Placeholder title="Configurações" />} />
            <Route path="/admin/seed" element={<SeedPage />} />
          </>
        )}
        {user?.role === "client" && (
          <>
            <Route path="/acompanhamento" element={<Placeholder title="Acompanhamento" />} />
            <Route path="/pedidos" element={<Placeholder title="Pedidos" />} />
            <Route path="/documentos" element={<Placeholder title="Documentos" />} />
            <Route path="/perfil" element={<Placeholder title="Perfil" />} />
          </>
        )}
        <Route path="/aprovacoes" element={<Placeholder title="Aprovações" />} />
        <Route path="/relatorios" element={<Placeholder title="Relatórios" />} />
        <Route path="/timeline" element={<Placeholder title="Timeline" />} />
        <Route path="/financeiro" element={<Placeholder title="Financeiro" />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
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

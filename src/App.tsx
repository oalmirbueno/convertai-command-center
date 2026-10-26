import { Toaster as Sonner } from "@/components/ui/sonner";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { agendarPreCargaEmSegundoPlano } from "@/lib/appRefresh";
import { preCarregarModulo } from "@/lib/lazyComPreCarga";
import { chaveDaEtapa, MESAS_DO_PAINEL } from "@/lib/mesa/preCarga";
import DownloadProgressOverlay from "@/components/shared/DownloadProgressOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { criarQueryClient, LimpezaDoCacheAoTrocarDeUsuario, opcoesDePersistencia } from "@/lib/mesa/cachePersistido";
import { PaginaMesaAds, PaginaMesaDoCliente, PaginaMesaFoto } from "@/lib/mesa/preCarga";
import { PaginaMesaVideos } from "@/lib/mesa/preCarga";
import { PaginaMesaEdicao } from "@/lib/mesa/preCarga";
import { PaginaMesaPublicidade } from "@/lib/mesa/preCarga";
import { PaginaMesaRoteiros } from "@/lib/mesa/preCarga";
import { PaginaMesaIdentidade } from "@/lib/mesa/preCarga";
import { PaginaMesaProposta } from "@/lib/mesa/preCarga";
import { PaginaMesaSite } from "@/lib/mesa/preCarga";
import { PaginaLaboratorio } from "@/lib/mesa/preCarga";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AppLayout from "@/components/AppLayout";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import { rotaPublicaPorToken } from "@/lib/preCargaDoBoot";
import { CronometroProvider } from "@/components/cronometro/CronometroProvider";
import aceleriqLogo from "@/assets/logo-aceleriq-256.png";

type CarregarModulo = () => Promise<unknown>;

/**
 * Telas sob demanda com o import() guardado (16/10). O mesmo import() serve o
 * lazy da rota e a pré-carga em segundo plano (preCargaDaEquipe): depois de
 * uma publicação os pedaços antigos somem da hospedagem, e a tela que já
 * estava na memória abre sem depender deles.
 */
const IMPORTS_DAS_ROTAS: CarregarModulo[] = [];
const rotas = {
  lazy: ((carregar: Parameters<typeof lazy>[0]) => {
    IMPORTS_DAS_ROTAS.push(carregar);
    return lazy(carregar);
  }) as typeof lazy,
};

const Login = rotas.lazy(() => import("@/pages/Login"));
const AreaDeMembros = rotas.lazy(() => import("@/pages/AreaDeMembros"));
const AdminMembros = rotas.lazy(() => import("@/pages/AdminMembros"));
const SolucoesAceleriq = rotas.lazy(() => import("@/pages/SolucoesAceleriq"));
const ResetPassword = rotas.lazy(() => import("@/pages/ResetPassword"));
const AdminDashboard = rotas.lazy(() => import("@/pages/AdminDashboard"));
const ClientDashboard = rotas.lazy(() => import("@/pages/ClientDashboard"));
const Kanban = rotas.lazy(() => import("@/pages/Kanban"));
const Clients = rotas.lazy(() => import("@/pages/Clients"));
const AdminFiles = rotas.lazy(() => import("@/pages/AdminFiles"));
const AdminApprovals = rotas.lazy(() => import("@/pages/AdminApprovals"));
const ClientDocuments = rotas.lazy(() => import("@/pages/ClientDocuments"));
const ClientApprovals = rotas.lazy(() => import("@/pages/ClientApprovals"));
const AdminRequests = rotas.lazy(() => import("@/pages/AdminRequests"));
const ClientRequests = rotas.lazy(() => import("@/pages/ClientRequests"));
const Team = rotas.lazy(() => import("@/pages/Team"));
const BriefingPublic = rotas.lazy(() => import("@/pages/BriefingPublic"));
const QuizPublicPage = rotas.lazy(() => import("@/pages/QuizPublicPage"));
const AdminBriefings = rotas.lazy(() => import("@/pages/AdminBriefings"));
const Projects = rotas.lazy(() => import("@/pages/Projects"));
const AdminFinanceiro = rotas.lazy(() => import("@/pages/AdminFinanceiro"));
// Frente CFO (30/09): o campo próprio do agente financeiro. Só admin.
const FinanceiroCFO = rotas.lazy(() => import("@/pages/FinanceiroCFO"));
const AdminComercial = rotas.lazy(() => import("@/pages/AdminComercial"));
const AdminProjection = rotas.lazy(() => import("@/pages/AdminProjection"));
const AdminExecucao = rotas.lazy(() => import("@/pages/AdminExecucao"));
const AdminMetricas = rotas.lazy(() => import("@/pages/AdminMetricas"));
const AdminAds = rotas.lazy(() => import("@/pages/AdminAds"));
const AnunciosHoje = rotas.lazy(() => import("@/pages/AnunciosHoje"));
const MensagensDaSemana = rotas.lazy(() => import("@/pages/MensagensDaSemana"));
// 26/10: a tela Hoje (um resumo por dia dos agentes; destino do aviso diário do sino).
const Hoje = rotas.lazy(() => import("@/pages/Hoje"));
const AdminCiclo = rotas.lazy(() => import("@/pages/AdminCiclo"));
const AdminEsteira = rotas.lazy(() => import("@/pages/AdminEsteira"));
const ClientFinanceiro = rotas.lazy(() => import("@/pages/ClientFinanceiro"));
const AdminReports = rotas.lazy(() => import("@/pages/AdminReports"));
const ClientReports = rotas.lazy(() => import("@/pages/ClientReports"));
const TimelinePage = rotas.lazy(() => import("@/pages/TimelinePage"));
const AdminReportCreate = rotas.lazy(() => import("@/pages/AdminReportCreate"));
const ReportDetail = rotas.lazy(() => import("@/pages/ReportDetail"));
const ProfilePage = rotas.lazy(() => import("@/pages/ProfilePage"));
const SettingsPage = rotas.lazy(() => import("@/pages/SettingsPage"));
const BaseDosAgentes = rotas.lazy(() => import("@/pages/BaseDosAgentes"));
const AdminViewAsClient = rotas.lazy(() => import("@/pages/AdminViewAsClient"));
const ApiDocs = rotas.lazy(() => import("@/pages/ApiDocs"));
const AdminQuizSubmissions = rotas.lazy(() => import("@/pages/AdminQuizSubmissions"));
const AdminBackfillPage = rotas.lazy(() => import("@/pages/AdminBackfillPage"));
const ClientVaultPage = rotas.lazy(() => import("@/pages/ClientVaultPage"));
const Workspace = rotas.lazy(() => import("@/pages/Workspace"));
const AdminExperience = rotas.lazy(() => import("@/pages/AdminExperience"));
const ClientJourneyUpdates = rotas.lazy(() => import("@/pages/ClientJourneyUpdates"));
const UnsubscribePage = rotas.lazy(() => import("@/pages/UnsubscribePage"));
const FirstAccess = rotas.lazy(() => import("@/pages/FirstAccess"));
const AdminContracts = rotas.lazy(() => import("@/pages/AdminContracts"));
const EditorialCalendar = rotas.lazy(() => import("@/pages/EditorialCalendar"));
const ContractPublic = rotas.lazy(() => import("@/pages/ContractPublic"));
// Frente IDV (30/09): página pública do brandbook por link (retrato publicado pela equipe, revogável).
const BrandbookPublico = rotas.lazy(() => import("@/pages/BrandbookPublico"));
const VotacaoDeNomes = rotas.lazy(() => import("@/pages/VotacaoDeNomes"));
const PropostaPublica = rotas.lazy(() => import("@/pages/PropostaPublica"));
const WorkspaceInboxPublic = rotas.lazy(() => import("@/pages/WorkspaceInboxPublic"));
const OAuthConsent = rotas.lazy(() => import("@/pages/OAuthConsent"));
const MetaOAuthCallback = rotas.lazy(() => import("@/pages/MetaOAuthCallback"));
const MCPConnect = rotas.lazy(() => import("@/pages/MCPConnect"));
const Novidades = rotas.lazy(() => import("@/pages/Novidades"));
const AdminHoras = rotas.lazy(() => import("@/pages/AdminHoras"));
// O hub das mesas era import fixo e levava o seletor de clientes da Mesa para
// o primeiro arquivo de todo mundo, até do /login (medido em 18/10).
const Mesas = rotas.lazy(() => import("@/pages/Mesas"));
// As três mesas baixam antes do clique (painel ocioso, mouse no link) e a
// etapa que vai abrir baixa junto com a página: src/lib/mesa/preCarga.ts.
const MesaDoCliente = PaginaMesaDoCliente;
const MesaAds = PaginaMesaAds;
const MesaFoto = PaginaMesaFoto;
const MesaVideos = PaginaMesaVideos;
const MesaEdicao = PaginaMesaEdicao;
const MesaPublicidade = PaginaMesaPublicidade;
const MesaRoteiros = PaginaMesaRoteiros;
const MesaIdentidade = PaginaMesaIdentidade;
const MesaProposta = PaginaMesaProposta;
const MesaSite = PaginaMesaSite;
const Laboratorio = PaginaLaboratorio;

const PAGINAS_DAS_MESAS = [
  PaginaMesaDoCliente, PaginaMesaAds, PaginaMesaFoto, PaginaMesaVideos, PaginaMesaEdicao, PaginaMesaPublicidade,
  PaginaMesaRoteiros, PaginaMesaIdentidade, PaginaMesaProposta, PaginaMesaSite, PaginaLaboratorio,
];

/**
 * O que a equipe baixa em segundo plano depois que o painel abre: todas as
 * telas das rotas e, para quem usa as mesas, as páginas e as etapas delas
 * (pelas mesmas chaves do lazyComPreCarga, então a etapa abre sem esqueleto).
 */
function preCargaDaEquipe(usaMesas: boolean): CarregarModulo[] {
  const lista: CarregarModulo[] = IMPORTS_DAS_ROTAS.slice();
  if (!usaMesas) return lista;
  for (const pagina of PAGINAS_DAS_MESAS) lista.push(pagina.preCarregar);
  for (const caminho of Object.keys(MESAS_DO_PAINEL) as Array<keyof typeof MESAS_DO_PAINEL>) {
    const mesa = MESAS_DO_PAINEL[caminho];
    for (const etapa of Object.keys(mesa.etapas)) {
      lista.push(() => preCarregarModulo(chaveDaEtapa(caminho, etapa), mesa.etapas[etapa]));
    }
    const pecas = { ...(mesa.sempre || {}), ...(mesa.semCliente || {}) };
    for (const nome of Object.keys(pecas)) {
      lista.push(() => preCarregarModulo(`${mesa.prefixo}/${nome}`, pecas[nome]));
    }
  }
  return lista;
}

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

/** A biblioteca não concede entrada no painel. A barreira de dados também existe no banco. */
export function OperationalRoute({children}:{children:ReactNode}) {
  const {profile}=useAuth();
  if (!profile || !["admin","client","design","traffic","manager"].includes(profile.role)) return <Navigate to="/membros" replace/>;
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
      <p className="text-[20px] leading-7 font-semibold text-foreground">Não conseguimos carregar o seu perfil</p>
      <p className="max-w-[420px] text-[13px] leading-relaxed text-muted-foreground">
        O servidor não respondeu a tempo. Confira a internet e tente de novo; a sua sessão continua válida.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => { void retryProfile(); }}
          className="rounded-xl bg-primary px-5 py-2.5 text-[13px] leading-5 font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
        >
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={() => { void logout(); }}
          className="rounded-xl border border-border px-5 py-2.5 text-[13px] leading-5 font-medium text-foreground hover:border-primary/50 transition-colors cursor-pointer bg-transparent"
        >
          Sair
        </button>
      </div>
    </div>
  );
}

export function AppRoutes() {
  const { user, profile, loading, profileError } = useAuth();
  const { pathname } = useLocation();
  // 16/10: trocar de tela NUNCA recarrega o painel ("cliquei no cliente e ele reiniciou"). Versão nova
  // no meio do uso só acende o ícone do topo (AppLayout); a recarga sai quando a pessoa clica nele.
  // Equipe logada: com o painel aberto e o navegador ocioso, as telas baixam em segundo plano, para a
  // navegação não depender dos pedaços desta versão que a próxima publicação apaga (src/lib/appRefresh.ts).
  const papel = profile?.role || "";
  const daEquipe = !!user && ["admin", "manager", "design", "traffic"].includes(papel);
  const usaMesas = ["admin", "manager", "design"].includes(papel);
  useEffect(() => {
    if (!daEquipe) return;
    return agendarPreCargaEmSegundoPlano(() => preCargaDaEquipe(usaMesas));
  }, [daEquipe, usaMesas]);
  // Link público por token (contrato, briefing, proposta...) não precisa de
  // login: abre sem esperar a sessão, que com o token vencido podia segurar a
  // logo até 8 s. A árvore abaixo é a MESMA com loading verdadeiro ou falso,
  // então a página não remonta quando o login responde e nada do que foi
  // digitado se perde. /login, /oauth/consent e /primeiro-acesso ficam na
  // trava: leem o loading.
  const publica = rotaPublicaPorToken(pathname);
  if (loading && !publica) return <LoadingScreen />;
  if (!publica && user && !profile && profileError) return <ProfileErrorScreen />;

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
      <Route path="/marca/:token" element={<BrandbookPublico />} />
      <Route path="/nomes/:token" element={<VotacaoDeNomes />} />
      <Route path="/proposta/:token" element={<PropostaPublica />} />
      <Route path="/inbox/:token" element={<WorkspaceInboxPublic />} />
      <Route path="/quiz/:token" element={<QuizPublicPage />} />
      <Route path="/unsubscribe" element={<UnsubscribePage />} />
      <Route path="/conectar-mcp" element={<MCPConnect />} />
      <Route path="/primeiro-acesso" element={<FirstAccess />} />
      <Route path="/membros" element={<ProtectedRoute><AreaDeMembros /></ProtectedRoute>} />
      <Route path="/membros/administrar" element={<ProtectedRoute>{profile?.role==="admin"?<AdminMembros/>:<Navigate to="/membros" replace/>}</ProtectedRoute>} />
      <Route path="/solucoes" element={<SolucoesAceleriq />} />
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
      <Route element={<ProtectedRoute><OperationalRoute><AppLayout><Suspense fallback={<EsqueletoDaPagina />}><Outlet /></Suspense></AppLayout></OperationalRoute></ProtectedRoute>}>
        <Route path="/dashboard" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminDashboard /> : <ClientDashboard />}</>} />
        <Route path="/projetos" element={<Projects />} />
        <Route path="/briefings" element={<StaffRoute><AdminBriefings /></StaffRoute>} />
        <Route path="/kanban" element={<StaffRoute><Kanban /></StaffRoute>} />
        <Route path="/execucao" element={<StaffRoute><AdminExecucao /></StaffRoute>} />
        <Route path="/base-dos-agentes" element={<StaffRoute><BaseDosAgentes /></StaffRoute>} />
        <Route path="/metricas" element={<StaffRoute><AdminMetricas /></StaffRoute>} />
        <Route path="/anuncios" element={<StaffRoute><AdminAds /></StaffRoute>} />
        {/* 26/10: boletim do Hermes, mudanças nas contas e o que precisa do dono, numa página só. */}
        <Route path="/anuncios/hoje" element={<StaffRoute><AnunciosHoje /></StaffRoute>} />
        <Route path="/hoje" element={<StaffRoute><Hoje /></StaffRoute>} />
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
        <Route path="/financeiro/cfo" element={<>{profile?.role === "admin" ? <FinanceiroCFO /> : <Navigate to="/financeiro" replace />}</>} />
        {/* Horas e custos (frente CR): tempo por cliente, custo de IA, entregas e capacidade. Só admin e gestor; o RPC repete a trava. */}
        <Route path="/horas" element={<>{profile?.role === "admin" || profile?.role === "manager" ? <AdminHoras /> : <Navigate to="/dashboard" replace />}</>} />
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
        {/* Mesa Foto: estúdio fotográfico (docs/mesa-foto/CONTRATO.md). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-foto" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaFoto /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Vídeos: gerar cenas e vídeos com IA (docs/mesa-videos/CONTRATO.md). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-videos" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaVideos /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Edição: subir vídeos de fora, organizar e editar (frente E2; função mesa-videos). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-edicao" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaEdicao /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Publicidade: dirige campanhas de produto (kit publicidade; supabase/functions/mesa-publicidade). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-publicidade" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaPublicidade /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Roteiros: agenda, roteiro, revisão salva e PDF (supabase/functions/mesa-roteiros). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-roteiros" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaRoteiros /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Identidade: identidade visual, naming e brandbook (supabase/functions/mesa-identidade, frente IDV). Mesmos papéis e o mesmo esqueleto da Mesa. */}
        <Route path="/mesa-identidade" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaIdentidade /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Proposta (frente PRO): proposta comercial com link e aceite (supabase/functions/mesa-proposta). Só admin e gestor, a régua do Comercial. */}
        <Route path="/mesa-proposta" element={<>{["admin", "manager"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaProposta /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* Mesa Site (frente SIT): criador de sites com o motor de código (supabase/functions/mesa-site e motor-codigo; worker em workers/motor-codigo). Mesmos papéis das mesas de criação. */}
        <Route path="/mesa-site" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaSite /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        {/* 19/10/2026: Mesa Motion retirada a pedido do dono; o endereço antigo cai no hub das mesas. */}
        <Route path="/mesa-motion" element={<Navigate to="/mesas" replace />} />
        {/* Laboratório (19/10/2026): projetos em canvas, estúdio livre, logos e arquivos livres (supabase/functions/laboratorio). Mesmos papéis das mesas de criação. */}
        <Route path="/laboratorio" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><Laboratorio /></Suspense> : <Navigate to="/dashboard" replace />}</>} />
        <Route path="/mesas" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Mesas /> : <Navigate to="/dashboard" replace />}</>} />
        <Route path="/central" element={<>{profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "") ? <AdminExperience /> : <Navigate to="/dashboard" replace />}</>} />
        {/* 26/10: as mensagens dos rituais da semana numa tela só (só o admin aprova). */}
        <Route path="/central/mensagens" element={<>{profile?.role === "admin" ? <MensagensDaSemana /> : <Navigate to="/central" replace />}</>} />
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
                {/* Cronômetro por cliente no painel inteiro (inclusive o Ciclo, fora da casca). */}
                <CronometroProvider>
                  <AppRoutes />
                </CronometroProvider>
              </BrowserRouter>
            </ConfirmDialogProvider>
          </ImpersonationProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </PersistQueryClientProvider>
);

export default App;

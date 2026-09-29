import { lazy, Suspense, useState, useRef, useEffect, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useSupabaseData";
import { useAvisosEmTempoReal, useContagemDeNaoLidas } from "@/hooks/useAvisos";
import NotificationsPanel from "@/components/NotificationsPanel";
import { avisoParaMostrar, mostrarAvisoNoNavegador } from "@/lib/avisosDoNavegador";
import { safeInternalPath, safePublicPostUrl } from "@/lib/internalNavigation";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import Lancador from "@/components/lancador/Lancador";
import IndicadorDeGeracoes from "@/components/geracao/IndicadorDeGeracoes";
import { EVENTO_ABRIR_AGENTE, type PedidoParaAbrirAgente } from "@/lib/lancador";
import { adminTourSteps, clientTourSteps, teamTourSteps, getPageTour, pageTours } from "@/components/onboarding/tourConfigs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, LogOut, Menu, X, MoreHorizontal, Search, Zap, Sun, Moon, Sparkles, Bot } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard, FolderOpen, Columns3, Users, UsersRound, CheckSquare,
  BarChart3, GitBranch, DollarSign, FileArchive, Settings,
  Eye, ShoppingBag, FileText, UserCircle, ClipboardList, KeyRound, FileSignature, HardDrive, CalendarDays,
  HeartPulse, Megaphone, Briefcase, Target, KanbanSquare, CalendarClock, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import aceleriqLogo from "@/assets/logo-aceleriq-256.png";
import MobileBottomNav from "@/components/MobileBottomNav";
import BuscaDoPainel, { type PaginaDaBusca } from "@/components/casca/BuscaDoPainel";
import { usePreCargaOciosaDasMesas } from "@/lib/mesa/preCarga";
import { quandoOcioso } from "@/lib/lazyComPreCarga";
import CronometroDoTopo from "@/components/cronometro/CronometroDoTopo";

// O assistente de voz traz o leitor de PDF e as animações (mais de 1 MB de
// código): fora da abertura do painel, baixa logo depois, sem segurar a tela.
const VoiceAssistant = lazy(() => import("@/components/admin/VoiceAssistant"));


interface NavItem {
  title: string;
  url: string;
  icon: React.FC<{ className?: string }>;
  /** Item de gestão: só admin e manager enxergam. */
  soGestao?: boolean;
  /** Acende só na rota exata. Sem isto, a entrada "/comercial" ficaria
      acesa em todas as áreas do departamento ao mesmo tempo. */
  fimExato?: boolean;
}

const adminMainNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Kanban", url: "/kanban", icon: Columns3 },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Clientes", url: "/clientes", icon: Users },
];

// O menu "mais" agrupado por tema: 18 itens numa lista corrida obrigavam a
// ler tudo para achar qualquer coisa. Os grupos seguem a pergunta de quem
// procura: "onde opero a semana", "onde vejo resultado", "onde administro".
// O Quiz saiu do menu (a rota continua viva para quem tem o link): era uma
// ferramenta pontual ocupando espaço de todo dia.
const adminMoreGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operação da semana",
    items: [
      { title: "Central", url: "/central", icon: HeartPulse },
      { title: "Ciclo", url: "/ciclo", icon: CheckSquare },
      { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
      { title: "Execução da equipe", url: "/execucao", icon: Bot },
      { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
      { title: "Briefings", url: "/briefings", icon: FileText },
    ],
  },
  {
    label: "Resultados",
    items: [
      { title: "Métricas", url: "/metricas", icon: BarChart3 },
      { title: "Anúncios", url: "/anuncios", icon: Megaphone },
      { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
      { title: "Timeline", url: "/timeline", icon: GitBranch },
    ],
  },
  {
    // Área própria, e não um item dentro de Gestão: o comercial conversa com
    // o financeiro e o completa, mas é outro departamento — quem procura o
    // funil não procura em "Gestão". Só admin e manager entram: design e
    // tráfego são equipe, mas operam entrega.
    label: "Comercial",
    items: [
      { title: "Visão geral", url: "/comercial", icon: Briefcase, soGestao: true, fimExato: true },
      { title: "CRM", url: "/comercial/crm", icon: KanbanSquare, soGestao: true },
      { title: "Agenda", url: "/comercial/agenda", icon: CalendarClock, soGestao: true },
      { title: "Metas", url: "/comercial/metas", icon: Target, soGestao: true },
      { title: "Campanhas", url: "/comercial/campanhas", icon: Megaphone, soGestao: true },
      { title: "Marketing", url: "/comercial/marketing", icon: Sparkles, soGestao: true },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Equipe", url: "/equipe", icon: UsersRound },
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
      // Horas e custos (frente CR): tempo por cliente, custo de IA e capacidade. Só admin e gestor.
      { title: "Horas e custos", url: "/horas", icon: Timer, soGestao: true },
      { title: "Arquivos", url: "/arquivos", icon: FileArchive },
      { title: "Workspace", url: "/workspace", icon: HardDrive },
      { title: "Cofre", url: "/cofre", icon: KeyRound },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Novidades", url: "/novidades", icon: Sparkles },
      { title: "Config", url: "/config", icon: Settings },
      { title: "API", url: "/api-docs", icon: Zap },
    ],
  },
];

/**
 * O menu conforme o papel.
 *
 * A peneira mora aqui, num lugar só, porque o menu tem duas saídas — os
 * grupos do desktop e a lista corrida do celular. Filtrar em cada uma
 * deixaria o item aparecendo em uma delas no primeiro conserto distraído.
 * A trava de verdade é a rota e o RLS; isto é para não oferecer porta que
 * não abre.
 */
const gruposPorPapel = (podeGestao: boolean) =>
  adminMoreGroups
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => podeGestao || !item.soGestao),
    }))
    .filter((grupo) => grupo.items.length > 0);

/**
 * Barra do topo de 768 a 1023 px (notebook estreito, tablet deitado): cabem
 * só os primeiros links; o resto entra no "...". Prioridade do lado direito:
 * avatar sempre; lançador, sino, busca (ícone) e o indicador de gerações
 * ficam; o tema vai para o menu do perfil. De 1024 para cima, tudo na barra.
 */
const LINKS_NO_TOPO_ESTREITO = 3;

const clientMainNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Onde Estamos", url: "/onde-estamos", icon: HeartPulse },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
];

const clientMoreNav: NavItem[] = [
  { title: "Novidades", url: "/novidades", icon: Sparkles },
  { title: "Cofre", url: "/cofre", icon: KeyRound },
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
  { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
  { title: "Documentos", url: "/documentos", icon: FileText },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Perfil", url: "/perfil", icon: UserCircle },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourMode, setTourMode] = useState<"full" | "page">("full");
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const role = profile?.role || "client";
  const isAdmin = role === "admin";
  const isTeam = ["design", "traffic", "manager"].includes(role);
  const isAdminOrTeam = isAdmin || isTeam;
  const podeGestao = isAdmin || role === "manager";
  const gruposDoMenu = gruposPorPapel(podeGestao);
  const mainNav = isAdminOrTeam ? adminMainNav : clientMainNav;
  const moreNav = isAdminOrTeam
    ? gruposDoMenu.flatMap((grupo) => grupo.items)
    : clientMoreNav;
  const { data: notifData } = useNotifications();
  // Quem usa as mesas já tem o código delas antes do clique (src/lib/mesa/preCarga.ts).
  usePreCargaOciosaDasMesas(["admin", "manager", "design"].includes(role));
  // O botão do assistente entra depois da primeira pintura, com o navegador ocioso.
  const [vozNaTela, setVozNaTela] = useState(false);
  useEffect(() => quandoOcioso(() => setVozNaTela(true), 3000), []);
  // Lançador único (canto inferior direito): o agente abre por ele, pelo
  // Alt+A ou pelo evento EVENTO_ABRIR_AGENTE (qualquer tela, com contexto).
  const [agenteAberto, setAgenteAberto] = useState(false);
  const [pedidoDoAgente, setPedidoDoAgente] = useState<(PedidoParaAbrirAgente & { vez: number }) | null>(null);
  const abrirAgente = useCallback(() => { setVozNaTela(true); setAgenteAberto(true); }, []);
  useEffect(() => {
    if (!isAdmin) return;
    const ouvir = (e: Event) => {
      const d = ((e as CustomEvent).detail || {}) as PedidoParaAbrirAgente;
      setPedidoDoAgente({ ...d, vez: Date.now() });
      abrirAgente();
    };
    window.addEventListener(EVENTO_ABRIR_AGENTE, ouvir);
    return () => window.removeEventListener(EVENTO_ABRIR_AGENTE, ouvir);
  }, [isAdmin, abrirAgente]);
  // Sino em tempo real e contagem de verdade (antes: só entre os 30 carregados).
  useAvisosEmTempoReal();
  const { data: contagemNaoLidas } = useContagemDeNaoLidas();
  const unreadCount = typeof contagemNaoLidas === "number"
    ? contagemNaoLidas
    : (notifData || []).filter((n: any) => !n.read).length;

  // Aviso do navegador para a equipe: o sino so e visto por quem olha para
  // ele. A marca d'agua comeca no aviso mais novo ja carregado, para nao
  // disparar tudo o que estava pendente ao abrir o painel.
  const marcaDeAvisos = useRef<string | null>(null);
  useEffect(() => {
    if (!isAdminOrTeam || !notifData) return;
    const lista = notifData as Array<{ id: string; message: string; link?: string | null; created_at: string; read?: boolean }>;
    if (marcaDeAvisos.current === null) {
      marcaDeAvisos.current = lista.reduce((m, n) => (n.created_at > m ? n.created_at : m), "");
      return;
    }
    const aviso = avisoParaMostrar(lista, marcaDeAvisos.current);
    if (!aviso) return;
    marcaDeAvisos.current = aviso.marca;
    mostrarAvisoNoNavegador(aviso, (link) => {
      const destino = safeInternalPath(link);
      if (destino) navigate(destino);
      // Post no ar: o aviso leva ao Instagram, como o clique no sino.
      else { const publico = safePublicPostUrl(link); if (publico) window.open(publico, "_blank", "noopener,noreferrer"); }
    });
  }, [notifData, isAdminOrTeam, navigate]);

  const fullTourSteps = isAdmin ? adminTourSteps : isTeam ? teamTourSteps : clientTourSteps;

  // Page-specific tour
  const pageSteps = getPageTour(location.pathname, role);
  const pageTourConfig = pageTours.find(p => location.pathname.startsWith(p.route));
  const activeTourSteps = tourMode === "page" && pageSteps ? pageSteps : fullTourSteps;

  // Auto-start tour on first visit (using DB flag)
  useEffect(() => {
    if (profile && !profile.onboarding_done) {
      const timer = setTimeout(() => setTourOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  // O aviso de "cliente acessou" mora SÓ no AuthContext, preso ao evento
  // real de entrada (SIGNED_IN). O aviso que morava aqui era um segundo
  // remetente para o mesmo fato, com trava por ABA (sessionStorage é por
  // aba): cada aba nova, cada reabertura do PWA, disparava outro — foi
  // assim que um login da cliente virou 16 avisos, em dois textos
  // diferentes. Um fato, um remetente.

  const handleTourClose = useCallback(() => {
    setTourOpen(false);
    if (user) {
      supabase.from("profiles").update({ onboarding_done: true } as any).eq("id", user.id).then();
    }
  }, [user]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    // Esc fecha o "mais" e o menu do perfil (teclado).
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      setMoreOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", tecla);
    };
  }, []);

  // Busca de página (lupa da barra e Ctrl+K): o mesmo menu, já filtrado pelo papel.
  const [buscaAberta, setBuscaAberta] = useState(false);
  const paginasDaBusca: PaginaDaBusca[] = [
    ...mainNav.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: "Principal" })),
    ...(isAdminOrTeam
      ? gruposDoMenu.flatMap((grupo) => grupo.items.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: grupo.label })))
      : clientMoreNav.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: "Mais" }))),
  ];

  // Um lançador só, em dois lugares da casca: barra do topo (768 px para
  // cima) e barra de baixo (celular). Nada flutua sobre o conteúdo.
  const propsDoLancador = {
    papel: (isAdminOrTeam ? "equipe" : "cliente") as "equipe" | "cliente",
    podeUsarAgente: isAdmin,
    onAbrirAgente: abrirAgente,
    passosDaTela: pageSteps,
    rotuloDaTela: pageTourConfig?.label,
    onTourDaTela: pageSteps ? () => { setTourMode("page"); setTourOpen(true); } : null,
    onTourCompleto: () => { setTourMode("full"); setTourOpen(true); },
  };

  return (
    <div className="min-h-screen bg-background tech-grid-bg" data-tour="welcome">
      {/* Floating TopNav. data-casca: o modo foco (src/lib/modoFoco.ts + index.css) esconde a barra, o que flutua e tira o recuo do conteúdo. */}
      <nav data-casca="topo" className="dark fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] md:w-[calc(100%-3rem)] max-w-[1792px] z-50 h-[52px] rounded-xl flex items-center px-3 gap-2 lg:px-4 lg:gap-4 text-foreground"
        style={{
          top: 'calc(env(safe-area-inset-top) + 12px)',
          background: 'rgba(17, 17, 19, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(39, 39, 42, 0.5)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Clip the square bitmap's transparent padding to the navbar so it
            cannot intercept clicks on the page below. Keep menus unclipped. */}
        <div className="flex h-full items-center shrink-0 overflow-hidden">
          <img src={aceleriqLogo} alt="Aceleriq" className="h-28 w-auto" />
        </div>

        {/* Center: Nav links (desktop) */}
        {/* De 768 a 1023 cabem os LINKS_NO_TOPO_ESTREITO primeiros; o resto vai para o "..." (sem corte nem rolagem lateral). */}
        <div className="hidden md:flex min-w-0 items-center gap-1 flex-1 justify-center">
          {mainNav.map((item, indice) => {
            const tourId = item.url.replace("/", "nav-");
            return (
              <NavLink
                key={item.url}
                to={item.url}
                data-tour={tourId}
                className={({ isActive }) => cn(
                  "relative whitespace-nowrap px-2 lg:px-3 py-1.5 text-[13px] rounded-md transition-colors",
                  indice >= LINKS_NO_TOPO_ESTREITO && "hidden lg:block",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {({ isActive }) => (
                  <>
                    {item.title}
                    {isActive && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}

          {/* More dropdown */}
          <div className="relative" ref={moreRef} data-tour="nav-more">
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-label="Mais páginas"
              aria-expanded={moreOpen}
              className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-56 max-h-[70vh] overflow-y-auto rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in"
                style={{ transformOrigin: 'top center' }}
              >
                {/* 768 a 1023: os links principais que não couberam na barra. */}
                {mainNav.length > LINKS_NO_TOPO_ESTREITO && (
                  <div className="mb-1 border-b border-border pb-1 lg:hidden" data-links-que-nao-couberam="">
                    {mainNav.slice(LINKS_NO_TOPO_ESTREITO).map((item) => (
                      <NavLink
                        key={item.url}
                        to={item.url}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) => cn(
                          "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors",
                          isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        )}
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        {item.title}
                      </NavLink>
                    ))}
                  </div>
                )}
                {/* Cliente não tem grupos: a lista dele é curta e direta. */}
                {isAdminOrTeam ? (
                  gruposDoMenu.map((group) => (
                    <div key={group.label} className="mb-1 last:mb-0">
                      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                        {group.label}
                      </p>
                      {group.items.map((item) => (
                        <NavLink
                          key={item.url}
                          to={item.url}
                          end={item.fimExato}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) => cn(
                            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors",
                            isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                          )}
                        >
                          <item.icon className="w-3.5 h-3.5" />
                          {item.title}
                        </NavLink>
                      ))}
                    </div>
                  ))
                ) : (
                  moreNav.map((item) => (
                    <NavLink
                      key={item.url}
                      to={item.url}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors",
                        isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <item.icon className="w-3.5 h-3.5" />
                      {item.title}
                    </NavLink>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile: centered Studio launcher (staff only) */}
        <div className="flex-1 md:hidden flex items-center justify-center">
          {isAdminOrTeam && (
            <button
              type="button"
              onClick={() => {
                // Flag persistente: se o StudioPanel ainda não montou, ele lê a flag no mount.
                (window as any).__studioOpenPending = true;
                const fire = () => window.dispatchEvent(new Event("studio:open"));
                if (location.pathname !== "/workspace") {
                  navigate("/workspace");
                  // Retry curto para cobrir o tempo de mount do painel.
                  window.setTimeout(fire, 60);
                  window.setTimeout(fire, 220);
                  window.setTimeout(fire, 500);
                } else {
                  fire();
                }
              }}
              className="h-8 px-3 rounded-full bg-primary/15 hover:bg-primary/25 text-primary text-[12px] font-medium inline-flex items-center gap-1.5 border border-primary/30"
              aria-label="Abrir Studio"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Studio
            </button>
          )}
        </div>

        {/* Right: Icons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Cronômetro por cliente (frente CR): o cliente em foco e o tempo do mês nele; clicar abre Horas e custos. */}
          {isAdminOrTeam && <CronometroDoTopo podeAbrirCentral={podeGestao} />}
          {/* "Gerando em N clientes": só aparece com geração na fila do servidor (frente G). */}
          {isAdminOrTeam && <IndicadorDeGeracoes userId={user?.id} />}
          <button
            type="button"
            onClick={() => setBuscaAberta(true)}
            aria-label="Buscar página (Ctrl+K)"
            title="Buscar página (Ctrl+K)"
            className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="w-4 h-4" />
          </button>
          {/* Lançador (768 px para cima): agente, ajuda da tela, tour e atalhos na barra, nunca flutuando. Cliente: o "?". */}
          <Lancador variante="topo" className="hidden md:block" {...propsDoLancador} />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            data-prioridade-no-topo="tema"
            className="w-8 h-8 flex md:hidden lg:flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            data-tour="nav-notifications"
            aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
            className="relative w-8 h-8 hidden md:flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setNotifOpen(true)}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center px-1 tabular-nums">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* User dropdown */}
          <div className="relative" ref={userRef} data-tour="nav-user">
            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-label="Menu do perfil"
              aria-expanded={userMenuOpen}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="w-7 h-7 cursor-pointer">
                <AvatarFallback className="bg-primary/15 text-primary text-[11px] font-semibold">
                  {profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0,2)}
                </AvatarFallback>
              </Avatar>
            </button>
            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <p className="text-[12px] font-medium text-foreground">{profile?.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{profile?.role === "admin" ? "Administrador" : profile?.company_name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); navigate("/perfil"); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  <UserCircle className="w-3.5 h-3.5" />
                  Meu perfil
                </button>
                {/* 768 a 1023: o tema sai da barra e mora aqui. */}
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); toggleTheme(); }}
                  data-tema-no-menu=""
                  className="hidden md:flex lg:hidden items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  {theme === "dark" ? "Tema claro" : "Tema escuro"}
                </button>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair
                </button>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            type="button"
            aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileMenuOpen}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </nav>

      {/* Mobile overlay menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/90 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div
            className="absolute inset-x-0 mx-3 rounded-xl bg-popover border border-border shadow-lg animate-fade-in flex flex-col"
            style={{
              top: 'calc(env(safe-area-inset-top) + 72px)',
              bottom: 'calc(env(safe-area-inset-bottom) + 72px)',
              maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 144px)',
            }}
          >
            <div className="overflow-y-auto p-3" style={{ WebkitOverflowScrolling: 'touch' }}>
              {[...mainNav, ...moreNav].map((item) => (
                <NavLink
                  key={item.url}
                  to={item.url}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) => cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-colors",
                    isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.title}
                </NavLink>
              ))}
              <div className="border-t border-border mt-2 pt-2">
                <button
                  onClick={() => { setMobileMenuOpen(false); logout(); }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main
        className={cn(
          "fixed inset-x-0 top-[calc(env(safe-area-inset-top)+80px)] bottom-[calc(env(safe-area-inset-bottom)+72px)] z-0 mx-auto w-full overflow-y-auto overflow-x-hidden px-4 md:static md:px-6 md:pt-[calc(env(safe-area-inset-top)+80px)] md:pb-[calc(env(safe-area-inset-bottom)+96px)] md:overflow-visible",
          // Tela larga em todas as páginas, igual às mesas: com 1280/1400 px o painel
          // ficava espremido com espaço vazio dos lados (dono, 23/09 e 26/09).
          "max-w-[1840px]",
        )}
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        data-tour="finish"
        data-casca="conteudo"
      >
        {children}
      </main>

      <div data-casca="rodape">
        <MobileBottomNav
          unreadCount={unreadCount}
          onOpenNotifications={() => setNotifOpen(true)}
          lancador={<Lancador variante="barra" {...propsDoLancador} />}
        />
      </div>


      <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} />
      <BuscaDoPainel aberto={buscaAberta} onAbertoChange={setBuscaAberta} paginas={paginasDaBusca} />

      {/* Onboarding Tour */}
      <OnboardingTour
        steps={activeTourSteps}
        isOpen={tourOpen}
        onClose={handleTourClose}
        storageKey="onboarding_done"
      />

      <div data-casca="flutuante">
        {/* O lançador mora nas barras (topo e barra de baixo): aqui fica só o painel do agente. */}
        {isAdmin && vozNaTela && (
          <Suspense fallback={null}>
            <VoiceAssistant aberto={agenteAberto} onAbertoChange={setAgenteAberto} pedido={pedidoDoAgente} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

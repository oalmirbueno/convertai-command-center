import { useState, useRef, useEffect, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useSupabaseData";
import { notifyAdmin } from "@/lib/notifyHelpers";
import NotificationsPanel from "@/components/NotificationsPanel";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import HelpButton from "@/components/onboarding/HelpButton";
import { adminTourSteps, clientTourSteps, teamTourSteps, getPageTour, pageTours } from "@/components/onboarding/tourConfigs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, LogOut, Menu, X, MoreHorizontal, Search, Zap, Sun, Moon, Sparkles } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard, FolderOpen, Columns3, Users, UsersRound, CheckSquare,
  BarChart3, GitBranch, DollarSign, FileArchive, Settings,
  Eye, ShoppingBag, FileText, UserCircle, ClipboardList, KeyRound, FileSignature, HardDrive, CalendarDays,
  HeartPulse, Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import aceleriqLogo from "@/assets/logo-aceleriq.png";
import VoiceAssistant from "@/components/admin/VoiceAssistant";
import MobileBottomNav from "@/components/MobileBottomNav";


interface NavItem {
  title: string;
  url: string;
  icon: React.FC<{ className?: string }>;
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
    label: "Gestão",
    items: [
      { title: "Equipe", url: "/equipe", icon: UsersRound },
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
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

// A lista plana continua existindo: o menu do celular percorre tudo de uma vez.
const adminMoreNav: NavItem[] = adminMoreGroups.flatMap((group) => group.items);

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
  const mainNav = isAdminOrTeam ? adminMainNav : clientMainNav;
  const moreNav = isAdminOrTeam ? adminMoreNav : clientMoreNav;
  const { data: notifData } = useNotifications();
  const unreadCount = (notifData || []).filter((n: any) => !n.read).length;

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

  // Notify admin when a client or team member accesses the panel (once per session)
  useEffect(() => {
    if (!user || !profile || profile.role === "admin") return;
    const key = `login_notified_${user.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    const roleLabel = profile.role === "client" ? "Cliente" : "Equipe";
    const name = profile.full_name || profile.email;
    const company = profile.company_name ? ` (${profile.company_name})` : "";

    // Use notifyAdmin edge fn (service role) so non-staff clients can notify admin (RLS-safe)
    notifyAdmin(
      `🔑 ${roleLabel} "${name}"${company} acessou o painel`,
      "update",
      profile.role === "client" ? "/clientes" : "/equipe"
    );
  }, [user, profile]);

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
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-background tech-grid-bg" data-tour="welcome">
      {/* Floating TopNav */}
      <nav className="dark fixed left-1/2 -translate-x-1/2 w-[95%] max-w-[1400px] z-50 h-[52px] rounded-xl flex items-center px-4 gap-4 text-foreground"
        style={{
          top: 'calc(env(safe-area-inset-top) + 12px)',
          background: 'rgba(17, 17, 19, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(39, 39, 42, 0.5)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Left: Logo */}
        <div className="flex items-center shrink-0">
          <img src={aceleriqLogo} alt="Aceleriq" className="h-28 w-auto" />
        </div>

        {/* Center: Nav links (desktop) */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {mainNav.map((item) => {
            const tourId = item.url.replace("/", "nav-");
            return (
              <NavLink
                key={item.url}
                to={item.url}
                data-tour={tourId}
                className={({ isActive }) => cn(
                  "relative px-3 py-1.5 text-[13px] rounded-md transition-colors",
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
              onClick={() => setMoreOpen(!moreOpen)}
              className="px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-56 max-h-[70vh] overflow-y-auto rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in"
                style={{ transformOrigin: 'top center' }}
              >
                {/* Cliente não tem grupos: a lista dele é curta e direta. */}
                {isAdminOrTeam ? (
                  adminMoreGroups.map((group) => (
                    <div key={group.label} className="mb-1 last:mb-0">
                      <p className="px-3 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                        {group.label}
                      </p>
                      {group.items.map((item) => (
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
          <button className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            data-tour="nav-notifications"
            className="relative w-8 h-8 hidden md:flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setNotifOpen(true)}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center px-1 notif-badge">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* User dropdown */}
          <div className="relative" ref={userRef} data-tour="nav-user">
            <button onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <Avatar className="w-7 h-7 cursor-pointer">
                <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                  {profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0,2)}
                </AvatarFallback>
              </Avatar>
            </button>
            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <p className="text-xs font-medium text-foreground">{profile?.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{profile?.role === "admin" ? "Administrador" : profile?.company_name}</p>
                </div>
                <button
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
          location.pathname === "/calendario"
            ? "max-w-[1400px]"
            : "max-w-[1280px]",
        )}
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        data-tour="finish"
      >
        {children}
      </main>

      <MobileBottomNav unreadCount={unreadCount} onOpenNotifications={() => setNotifOpen(true)} />


      <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} />

      {/* Onboarding Tour */}
      <OnboardingTour
        steps={activeTourSteps}
        isOpen={tourOpen}
        onClose={handleTourClose}
        storageKey="onboarding_done"
      />

      {/* Help button to restart tour */}
      {!tourOpen && (
        <HelpButton
          onFullTour={() => { setTourMode("full"); setTourOpen(true); }}
          onPageTour={pageSteps ? () => { setTourMode("page"); setTourOpen(true); } : null}
          pageTourLabel={pageTourConfig?.label}
        />
      )}

      <VoiceAssistant />
    </div>
  );
}

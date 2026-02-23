import { useState, useRef, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { notifications } from "@/data/mockData";
import NotificationsPanel from "@/components/NotificationsPanel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, LogOut, Menu, X, MoreHorizontal, Search } from "lucide-react";
import {
  LayoutDashboard, FolderOpen, Columns3, Users, UsersRound, CheckSquare,
  Sparkles, BarChart3, GitBranch, DollarSign, FileArchive, Settings,
  Eye, ShoppingBag, FileText, UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  url: string;
  icon: React.FC<{ className?: string }>;
}

const adminMainNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Kanban", url: "/kanban", icon: Columns3 },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Equipe", url: "/equipe", icon: UsersRound },
];

const adminMoreNav: NavItem[] = [
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
  { title: "IA Planner", url: "/ia-planner", icon: Sparkles },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
  { title: "Timeline", url: "/timeline", icon: GitBranch },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Arquivos", url: "/arquivos", icon: FileArchive },
  { title: "Config", url: "/config", icon: Settings },
];

const clientMainNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Acompanhamento", url: "/acompanhamento", icon: Eye },
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
];

const clientMoreNav: NavItem[] = [
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
  { title: "Timeline", url: "/timeline", icon: GitBranch },
  { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
  { title: "Documentos", url: "/documentos", icon: FileText },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Perfil", url: "/perfil", icon: UserCircle },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const mainNav = user?.role === "admin" ? adminMainNav : clientMainNav;
  const moreNav = user?.role === "admin" ? adminMoreNav : clientMoreNav;
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Floating TopNav */}
      <nav className="fixed top-3 left-1/2 -translate-x-1/2 w-[95%] max-w-[1400px] z-50 h-[52px] rounded-xl flex items-center px-4 gap-4"
        style={{
          background: 'rgba(17, 17, 19, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(39, 39, 42, 0.5)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Left: Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">C</span>
          </div>
          <span className="font-semibold text-[15px] text-foreground hidden sm:inline">ConvertAI</span>
        </div>

        {/* Center: Nav links (desktop) */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {mainNav.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
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
          ))}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className="px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-52 rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in"
                style={{ transformOrigin: 'top center' }}
              >
                {moreNav.map((item) => (
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
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mobile hamburger */}
        <div className="flex-1 md:hidden" />

        {/* Right: Icons */}
        <div className="flex items-center gap-1 shrink-0">
          <button className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <Search className="w-4 h-4" />
          </button>
          <button
            className="relative w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setNotifOpen(true)}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
            )}
          </button>

          {/* User dropdown */}
          <div className="relative" ref={userRef}>
            <button onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <Avatar className="w-7 h-7 cursor-pointer">
                <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                  {user?.avatar}
                </AvatarFallback>
              </Avatar>
            </button>
            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <p className="text-xs font-medium text-foreground">{user?.name}</p>
                  <p className="text-[11px] text-muted-foreground">{user?.role === "admin" ? "Administrador" : user?.company}</p>
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
          <div className="absolute inset-x-0 top-[68px] mx-3 rounded-xl bg-popover border border-border p-3 shadow-lg animate-fade-in">
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
      )}

      {/* Content */}
      <main className="pt-20 pb-8 px-4 md:px-6 max-w-[1280px] mx-auto">
        {children}
      </main>

      <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} />
    </div>
  );
}

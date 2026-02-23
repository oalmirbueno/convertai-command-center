import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { notifications } from "@/data/mockData";
import NotificationsPanel from "@/components/NotificationsPanel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bell, LogOut, Menu, X, ChevronsLeft, ChevronsRight } from "lucide-react";
import {
  LayoutDashboard, FolderOpen, Columns3, Users, UsersRound, CheckSquare,
  Sparkles, BarChart3, GitBranch, DollarSign, FileArchive, Settings,
  Eye, ShoppingBag, FileText, UserCircle,
} from "lucide-react";

interface NavItem {
  title: string;
  url: string;
  icon: React.FC<{ className?: string }>;
  section?: string;
}

const adminNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, section: "main" },
  { title: "Projetos", url: "/projetos", icon: FolderOpen, section: "main" },
  { title: "Kanban", url: "/kanban", icon: Columns3, section: "main" },
  { title: "Clientes", url: "/clientes", icon: Users, section: "main" },
  { title: "Equipe", url: "/equipe", icon: UsersRound, section: "manage" },
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare, section: "manage" },
  { title: "IA Planner", url: "/ia-planner", icon: Sparkles, section: "manage" },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3, section: "tools" },
  { title: "Timeline", url: "/timeline", icon: GitBranch, section: "tools" },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign, section: "tools" },
  { title: "Arquivos", url: "/arquivos", icon: FileArchive, section: "tools" },
  { title: "Config", url: "/config", icon: Settings, section: "tools" },
];

const clientNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, section: "main" },
  { title: "Meus Projetos", url: "/projetos", icon: FolderOpen, section: "main" },
  { title: "Acompanhamento", url: "/acompanhamento", icon: Eye, section: "main" },
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare, section: "manage" },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3, section: "manage" },
  { title: "Timeline", url: "/timeline", icon: GitBranch, section: "manage" },
  { title: "Pedidos", url: "/pedidos", icon: ShoppingBag, section: "tools" },
  { title: "Documentos", url: "/documentos", icon: FileText, section: "tools" },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign, section: "tools" },
  { title: "Perfil", url: "/perfil", icon: UserCircle, section: "tools" },
];

const sections = ["main", "manage", "tools"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navItems = user?.role === "admin" ? adminNav : clientNav;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const sidebarWidth = collapsed ? "w-16" : "w-60";
  const mainMargin = collapsed ? "lg:ml-16" : "lg:ml-60";

  const renderNavItems = (items: NavItem[]) => {
    const grouped: Record<string, NavItem[]> = {};
    items.forEach((item) => {
      const s = item.section || "main";
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(item);
    });

    return sections.map((section, si) => {
      const group = grouped[section];
      if (!group) return null;
      return (
        <div key={section}>
          {si > 0 && <div className="separator-fade mx-3 my-3" />}
          <div className="space-y-0.5">
            {group.map((item) => (
              <Tooltip key={item.url} delayDuration={collapsed ? 0 : 1000}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={item.url}
                    className={`nav-icon-shift flex items-center gap-3 rounded-lg text-[13px] text-sidebar-foreground hover:text-foreground transition-all relative ${collapsed ? "justify-center px-0 py-2.5 mx-2" : "px-3 py-2.5"}`}
                    activeClassName="text-primary !text-primary"
                  >
                    {/* Active bar indicator */}
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary opacity-0 transition-opacity [.active_&]:opacity-100" />
                    <item.icon className="nav-icon w-4 h-4 shrink-0 transition-transform" />
                    {!collapsed && <span>{item.title}</span>}
                  </NavLink>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="bg-card border-border text-xs">
                    {item.title}
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen flex bg-background dot-bg noise-overlay">
      {/* Sidebar Desktop */}
      <aside className={`hidden lg:flex flex-col ${sidebarWidth} fixed inset-y-0 left-0 z-40 transition-all duration-300`}
        style={{ background: 'rgba(8, 8, 16, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        {/* Logo */}
        <div className={`flex items-center gap-2.5 h-14 ${collapsed ? "justify-center px-2" : "px-5"}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 glow-sm">
            <span className="text-sm font-bold text-primary-foreground">C</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-foreground text-sm tracking-tight">
              Convert<span className="text-gradient">AI</span>
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {renderNavItems(navItems)}
        </nav>

        {/* Collapse toggle */}
        <div className="separator-fade mx-3" />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center py-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>

        {/* Footer */}
        <div className="separator-fade mx-3" />
        <div className={`p-3 ${collapsed ? "flex justify-center" : ""}`}>
          <div className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
            <Avatar className="w-7 h-7 shrink-0">
              <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                {user?.avatar}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{user?.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.role === "admin" ? "Admin" : user?.company}</p>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7 text-muted-foreground hover:text-foreground" onClick={logout}>
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className={`flex-1 ${mainMargin} flex flex-col min-h-screen transition-all duration-300`}>
        {/* Invisible header — only icons floating top-right */}
        <header className="sticky top-0 z-30 flex items-center justify-between px-4 lg:px-8 h-14">
          <div className="flex items-center gap-3 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <span className="text-[10px] font-bold text-primary-foreground">C</span>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setNotifOpen(true)}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accent text-[9px] font-bold text-accent-foreground flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </Button>
            <Avatar className="w-7 h-7 lg:ml-1">
              <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                {user?.avatar}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Mobile Nav Overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
            <aside className="absolute left-0 inset-y-0 w-64 p-4 space-y-1 overflow-y-auto animate-fade-in-left"
              style={{ background: 'rgba(8, 8, 16, 0.95)', backdropFilter: 'blur(20px)' }}
            >
              <div className="flex items-center gap-2.5 mb-6">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <span className="text-sm font-bold text-primary-foreground">C</span>
                </div>
                <span className="font-semibold text-foreground text-sm">Convert<span className="text-gradient">AI</span></span>
              </div>
              {navItems.map((item) => (
                <NavLink
                  key={item.url}
                  to={item.url}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] text-sidebar-foreground hover:text-foreground transition-colors"
                  activeClassName="text-primary"
                >
                  <item.icon className="w-4 h-4" />
                  {item.title}
                </NavLink>
              ))}
              <div className="separator-fade my-4" />
              <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground text-sm" onClick={logout}>
                <LogOut className="w-4 h-4" />
                Sair
              </Button>
            </aside>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 px-4 lg:px-8 pb-8">
          {children}
        </main>
      </div>

      <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} />
    </div>
  );
}

import { NavLink } from "react-router-dom";
import { LayoutDashboard, HardDrive, Bell, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  unreadCount: number;
  onOpenNotifications: () => void;
}

/**
 * Mobile-only bottom navigation. App-style tab bar with safe-area support.
 * O Studio agora abre pelo botão no topo (TopBar), não pelo tab bar.
 */
export default function MobileBottomNav({ unreadCount, onOpenNotifications }: Props) {
  const tabBase =
    "flex-1 flex flex-col items-center justify-center gap-0.5 h-full text-[10px] font-medium transition-colors";

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegação principal"
    >
      <div className="flex items-stretch h-14 max-w-[560px] mx-auto">
        <NavLink
          to="/dashboard"
          className={({ isActive }) => cn(tabBase, isActive ? "text-primary" : "text-muted-foreground")}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>Início</span>
        </NavLink>

        <NavLink
          to="/projetos"
          className={({ isActive }) => cn(tabBase, isActive ? "text-primary" : "text-muted-foreground")}
        >
          <FolderOpen className="w-5 h-5" />
          <span>Projetos</span>
        </NavLink>

        <NavLink
          to="/workspace"
          className={({ isActive }) => cn(tabBase, isActive ? "text-primary" : "text-muted-foreground")}
        >
          <HardDrive className="w-5 h-5" />
          <span>Workspace</span>
        </NavLink>

        <button
          type="button"
          onClick={onOpenNotifications}
          className={cn(tabBase, "text-muted-foreground relative")}
        >
          <div className="relative">
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[16px] h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center px-1">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          <span>Alertas</span>
        </button>
      </div>
    </nav>
  );
}

import { useState } from "react";
import { useNotifications } from "@/hooks/useSupabaseData";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Bell, CreditCard, Package, CheckCircle, BarChart3, FolderOpen, ListChecks, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

function getNotifIcon(type: string) {
  switch (type) {
    case "approval": return { icon: <CheckCircle className="w-4 h-4" />, bg: "bg-primary/10 text-primary" };
    case "request": return { icon: <Package className="w-4 h-4" />, bg: "bg-info/10 text-info" };
    case "project": case "update": return { icon: <FolderOpen className="w-4 h-4" />, bg: "bg-success/10 text-success" };
    case "billing": return { icon: <CreditCard className="w-4 h-4" />, bg: "bg-warning/10 text-warning" };
    case "task": return { icon: <ListChecks className="w-4 h-4" />, bg: "bg-info/10 text-info" };
    case "report": return { icon: <BarChart3 className="w-4 h-4" />, bg: "bg-accent/50 text-accent-foreground" };
    default: return { icon: <Bell className="w-4 h-4" />, bg: "bg-secondary text-muted-foreground" };
  }
}

function getLinkLabel(notif: any): string {
  if (!notif.link) return "Abrir";
  if (notif.link.includes("/aprovacoes")) return "Ver Arquivo";
  if (notif.link.includes("/projetos") || notif.link.includes("/dashboard")) return "Ver Projeto";
  if (notif.link.includes("/relatorios")) return "Ver Relatório";
  if (notif.link.includes("/financeiro")) return "Ver Financeiro";
  if (notif.link.includes("/pedidos")) return "Ver Pedido";
  if (notif.link.includes("/kanban")) return "Ver Tarefas";
  return "Abrir";
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)}h`;
  if (seconds < 172800) return "ontem";
  if (seconds < 604800) return `há ${Math.floor(seconds / 86400)} dias`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function groupNotifications(notifs: any[]) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: { label: string; items: any[] }[] = [];
  const todayItems = notifs.filter(n => isSameDay(new Date(n.created_at), today));
  const yesterdayItems = notifs.filter(n => isSameDay(new Date(n.created_at), yesterday));
  const weekItems = notifs.filter(n => {
    const d = new Date(n.created_at);
    return !isSameDay(d, today) && !isSameDay(d, yesterday) && (today.getTime() - d.getTime()) < 7 * 86400000;
  });
  const olderItems = notifs.filter(n => (today.getTime() - new Date(n.created_at).getTime()) >= 7 * 86400000);

  if (todayItems.length) groups.push({ label: "Hoje", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "Ontem", items: yesterdayItems });
  if (weekItems.length) groups.push({ label: "Esta semana", items: weekItems });
  if (olderItems.length) groups.push({ label: "Anteriores", items: olderItems });

  return groups;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NotificationsPanel({ open, onOpenChange }: Props) {
  const { data: notifications } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "unread">("all");

  const handleClick = async (n: any) => {
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (n.link) {
      navigate(n.link);
      onOpenChange(false);
    }
  };

  const markAllRead = async () => {
    const unread = (notifications || []).filter((n: any) => !n.read);
    if (unread.length === 0) return;
    for (const n of unread) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    }
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    toast.success("Todas marcadas como lidas");
  };

  const unreadCount = (notifications || []).filter((n: any) => !n.read).length;
  const displayNotifs = tab === "unread"
    ? (notifications || []).filter((n: any) => !n.read)
    : (notifications || []);
  const groups = groupNotifications(displayNotifs);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[370px] sm:max-w-[370px] bg-card border-l border-border p-0 flex flex-col [&>button.absolute]:hidden"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <SheetHeader className="px-4 pt-3 pb-3 shrink-0 border-b border-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Fechar notificações"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <SheetTitle className="label-sm text-foreground truncate">Notificações</SheetTitle>
          </div>
        </SheetHeader>

        {/* Tabs + Mark all */}
        <div className="px-5 pb-3 space-y-3 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setTab("all")}
              className={`text-[12px] px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                tab === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setTab("unread")}
              className={`text-[12px] px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                tab === "unread" ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Não lidas{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </button>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-primary hover:underline cursor-pointer bg-transparent border-none ml-auto">
                Marcar todas como lidas
              </button>
            )}
          </div>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma notificação.</p>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{group.label}</p>
                </div>
                {group.items.map((n: any) => {
                  const { icon, bg } = getNotifIcon(n.notification_type);
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={`px-5 py-3.5 cursor-pointer transition-colors ${
                        n.read ? "hover:bg-secondary/30" : "bg-primary/5 hover:bg-primary/10"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] leading-snug ${n.read ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                            {n.message}
                          </p>
                          <p className="text-[11px] text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                          {n.link && (
                            <p className="text-[11px] text-primary mt-1">{getLinkLabel(n)} →</p>
                          )}
                        </div>
                        {!n.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

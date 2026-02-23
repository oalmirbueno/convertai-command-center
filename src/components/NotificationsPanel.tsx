import { useNotifications } from "@/hooks/useSupabaseData";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Bell, FileText, CreditCard, Package, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

const typeIcons: Record<string, React.FC<{ className?: string }>> = {
  approval: CheckCircle,
  report: FileText,
  billing: CreditCard,
  request: Package,
  update: Bell,
  system: Bell,
  task: Bell,
};

const typeColors: Record<string, string> = {
  approval: "text-primary",
  report: "text-info",
  billing: "text-warning",
  request: "text-success",
  update: "text-foreground",
  system: "text-muted-foreground",
  task: "text-info",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NotificationsPanel({ open, onOpenChange }: Props) {
  const { data: notifications } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
  };

  const unreadCount = (notifications || []).filter((n: any) => !n.read).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[340px] sm:max-w-[340px] bg-card border-l border-border">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="label-sm text-foreground">Notificações</SheetTitle>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-primary hover:underline cursor-pointer bg-transparent border-none">
                Marcar todas como lidas
              </button>
            )}
          </div>
        </SheetHeader>
        <div className="space-y-0">
          {(!notifications || notifications.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma notificação.</p>
          ) : (
            notifications.map((n: any, i: number) => {
              const Icon = typeIcons[n.notification_type] || Bell;
              return (
                <div key={n.id}>
                  {i > 0 && <div className="border-t border-border" />}
                  <div
                    className={`flex items-start gap-3 py-3 cursor-pointer hover:bg-secondary/30 px-1 rounded ${n.read ? "opacity-40" : ""}`}
                    onClick={() => handleClick(n)}
                  >
                    {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-info shrink-0 mt-2" />}
                    {n.read && <div className="w-1.5 shrink-0" />}
                    <div className={`mt-0.5 ${typeColors[n.notification_type] || "text-muted-foreground"}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground/50 mt-1">
                        {new Date(n.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

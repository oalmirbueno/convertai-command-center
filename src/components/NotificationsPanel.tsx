import { notifications } from "@/data/mockData";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Bell, FileText, CreditCard, Package, CheckCircle } from "lucide-react";

const typeIcons: Record<string, React.FC<{ className?: string }>> = {
  aprovação: CheckCircle,
  relatório: FileText,
  cobrança: CreditCard,
  pedido: Package,
};

const typeGlowColors: Record<string, string> = {
  aprovação: "text-primary",
  relatório: "text-info",
  cobrança: "text-warning",
  pedido: "text-success",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NotificationsPanel({ open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-80 sm:max-w-xs border-l border-border/30"
        style={{ background: 'rgba(8, 8, 16, 0.9)', backdropFilter: 'blur(24px)' }}
      >
        <SheetHeader className="pb-4">
          <SheetTitle className="text-foreground flex items-center gap-2 text-sm">
            <Bell className="w-4 h-4 text-primary" />
            Notificações
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-0">
          {notifications.map((n, i) => {
            const Icon = typeIcons[n.type] || Bell;
            return (
              <div key={n.id}>
                {i > 0 && <div className="separator-fade mx-0 my-0" />}
                <div className={`flex items-start gap-3 py-3 ${n.read ? "opacity-40" : ""}`}>
                  {/* Unread cyan dot */}
                  {!n.read && (
                    <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-2" />
                  )}
                  {n.read && <div className="w-1.5 shrink-0" />}

                  <div className={`mt-0.5 ${typeGlowColors[n.type]} opacity-60`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{n.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground opacity-40 mt-1">{n.time}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

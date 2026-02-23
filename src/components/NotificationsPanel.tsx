import { notifications } from "@/data/mockData";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Bell, FileText, CreditCard, Package, CheckCircle } from "lucide-react";

const typeIcons: Record<string, React.FC<{ className?: string }>> = {
  aprovação: CheckCircle,
  relatório: FileText,
  cobrança: CreditCard,
  pedido: Package,
};

const typeColors: Record<string, string> = {
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
      <SheetContent side="right" className="bg-card border-border/50 w-full sm:max-w-md">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Notificações
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-3">
          {notifications.map((n) => {
            const Icon = typeIcons[n.type] || Bell;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-xl transition-colors ${
                  n.read ? "opacity-60" : "bg-secondary/40"
                }`}
              >
                <div className={`mt-0.5 ${typeColors[n.type]}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{n.time}</p>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

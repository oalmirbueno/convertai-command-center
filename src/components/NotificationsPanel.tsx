import { useState } from "react";
import { useNotifications } from "@/hooks/useSupabaseData";
import { useAvisosNaoLidos, useContagemDeNaoLidas, marcarTodasComoLidas } from "@/hooks/useAvisos";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertTriangle, ArrowLeft, BarChart3, Bell, Bot, Briefcase, CheckCircle, CreditCard, FileArchive,
  FolderOpen, Instagram, ListChecks, Package,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { safeInternalPath, safePublicPostUrl } from "@/lib/internalNavigation";
import { toast } from "sonner";
import { estadoDosAvisos, pedirPermissaoDeAvisos, type EstadoDoAviso } from "@/lib/avisosDoNavegador";
import { categoriaDoAviso, rotuloDoLink } from "@/lib/avisos/rotulos";
import TesteDeAvisos from "@/components/avisos/TesteDeAvisos";
import { AjudaRecolhida, SeletorCompacto, botao, juntar, texto } from "@/components/sistema";

function getNotifIcon(type: string) {
  switch (categoriaDoAviso(type)) {
    case "decisao": return { icon: <CheckCircle className="w-4 h-4" />, bg: "bg-primary/10 text-primary" };
    case "pedido": return { icon: <Package className="w-4 h-4" />, bg: "bg-info/10 text-info" };
    case "projeto": return { icon: <FolderOpen className="w-4 h-4" />, bg: "bg-success/10 text-success" };
    case "cobranca": return { icon: <CreditCard className="w-4 h-4" />, bg: "bg-warning/10 text-warning" };
    case "tarefa": return { icon: <ListChecks className="w-4 h-4" />, bg: "bg-info/10 text-info" };
    case "relatorio": return { icon: <BarChart3 className="w-4 h-4" />, bg: "bg-accent/50 text-accent-foreground" };
    // Post no ar: o aviso que leva para fora do painel merece cara própria.
    case "publicacao": return { icon: <Instagram className="w-4 h-4" />, bg: "bg-success/10 text-success" };
    case "entrega": return { icon: <FileArchive className="w-4 h-4" />, bg: "bg-success/10 text-success" };
    case "alerta": return { icon: <AlertTriangle className="w-4 h-4" />, bg: "bg-warning/10 text-warning" };
    case "agente": return { icon: <Bot className="w-4 h-4" />, bg: "bg-secondary text-muted-foreground" };
    case "comercial": return { icon: <Briefcase className="w-4 h-4" />, bg: "bg-info/10 text-info" };
    default: return { icon: <Bell className="w-4 h-4" />, bg: "bg-secondary text-muted-foreground" };
  }
}

function getLinkLabel(notif: any): string {
  return rotuloDoLink(notif?.link);
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
  const { user, profile } = useAuth();
  const { data: notifications } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [avisosDoNavegador, setAvisosDoNavegador] = useState<EstadoDoAviso>(() => estadoDosAvisos());
  const { data: contagem } = useContagemDeNaoLidas();
  const { data: naoLidas } = useAvisosNaoLidos(open && tab === "unread");
  const papel = profile?.role || "client";
  const eEquipe = ["admin", "manager", "design", "traffic"].includes(papel);
  const eAdmin = papel === "admin";

  const handleClick = async (n: any) => {
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    const destination = safeInternalPath(n.link);
    if (destination) {
      navigate(destination);
      onOpenChange(false);
      return;
    }
    // Publicação no ar: abre o post em outra aba. noopener/noreferrer para
    // que a página aberta não ganhe referência à janela do painel.
    const publicPost = safePublicPostUrl(n.link);
    if (publicPost) {
      window.open(publicPost, "_blank", "noopener,noreferrer");
      onOpenChange(false);
    }
  };

  // Uma chamada só, e marca TODAS as pendentes (antes: uma chamada por aviso,
  // e só as que estavam entre as 30 carregadas).
  const markAllRead = async () => {
    if (!user?.id || unreadCount === 0) return;
    try {
      await marcarTodasComoLidas(user.id);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Todas marcadas como lidas");
    } catch {
      toast.error("Não consegui marcar agora. Tente de novo.");
    }
  };

  const listaCarregada = notifications || [];
  const unreadCount = typeof contagem === "number"
    ? contagem
    : listaCarregada.filter((n: any) => !n.read).length;
  const displayNotifs = tab === "unread"
    ? (naoLidas || listaCarregada.filter((n: any) => !n.read))
    : listaCarregada;
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
            <SheetTitle className={juntar(texto.tituloSecao, "truncate")}>Notificações</SheetTitle>
          </div>
        </SheetHeader>

        {/* Filtro (segmentado do sistema, sem pílulas verdes) e "marcar todas" na mesma linha */}
        <div className="px-5 pb-3 pt-3 space-y-3 shrink-0">
          <div className="flex min-w-0 items-center">
            <SeletorCompacto
              rotulo="Filtrar notificações"
              modo="segmentado"
              valor={tab}
              onEscolher={(v) => setTab(v as typeof tab)}
              opcoes={[
                { valor: "all", rotulo: "Todas" },
                { valor: "unread", rotulo: "Não lidas", contador: unreadCount > 0 ? unreadCount : null },
              ]}
            />
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className={juntar(botao.discreto, "ml-auto h-8 px-2 text-[12px] text-primary hover:text-primary")}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          {/* Aviso fora do painel: o sino nao alcanca quem esta em outra aba.
              O e-mail ja sai sozinho para a equipe; aqui e o aviso na tela. */}
          {eEquipe && avisosDoNavegador === "pedir" && (
            <div className="flex min-w-0 items-center">
              <button
                type="button"
                onClick={async () => {
                  const estado = await pedirPermissaoDeAvisos();
                  setAvisosDoNavegador(estado);
                  if (estado === "ligado") toast.success("Avisos do navegador ligados. Você recebe o aviso mesmo em outra aba.");
                  else if (estado === "bloqueado") toast.error("O navegador bloqueou os avisos. Libere nas configurações do site.");
                }}
                className={juntar(botao.secundario, "h-8 min-w-0 px-3 text-[12px] text-primary")}
              >
                <span className="truncate">Ativar avisos no navegador</span>
              </button>
              <AjudaRecolhida className="ml-1.5" rotulo="Sobre os avisos do navegador">
                Aprovações e pedidos de clientes aparecem na tela mesmo com o painel em outra aba. Por e-mail eles já chegam.
              </AjudaRecolhida>
            </div>
          )}
          {eEquipe && avisosDoNavegador === "bloqueado" && (
            <div className="flex min-w-0 items-center">
              <p className="min-w-0 truncate text-[11px] text-muted-foreground">Avisos do navegador bloqueados neste site.</p>
              <AjudaRecolhida className="ml-1.5" rotulo="Sobre os avisos bloqueados">
                Os avisos importantes continuam chegando por e-mail. Para ligar de novo, libere as notificações nas configurações do site.
              </AjudaRecolhida>
            </div>
          )}
          {eAdmin && <TesteDeAvisos idsNoSino={listaCarregada.map((n: any) => n.id)} />}
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {groups.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Nenhuma notificação.</p>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-5 py-2">
                  <p className={juntar(texto.etiqueta, "text-muted-foreground")}>{group.label}</p>
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
                            <p className="text-[11px] text-primary mt-1">{getLinkLabel(n)}</p>
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

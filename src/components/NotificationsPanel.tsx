import ContextoDoAviso, { destinoOperacional } from "@/components/execucao/ContextoDoAviso";
import { useState } from "react";
import { useAvisosPorArea, marcarAreaComoLida, marcarTiposComoLidos, type AreaDosAvisos } from "@/hooks/useAvisosPorArea";

import { useAuth } from "@/contexts/AuthContext";
import {
  AlertTriangle, BarChart3, Bell, Bot, Briefcase, CheckCircle, ChevronDown, CreditCard, FileArchive,
  FolderOpen, Instagram, ListChecks, Megaphone, Package, Sunrise,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { safeInternalPath, safePublicPostUrl } from "@/lib/internalNavigation";
import { toast } from "sonner";
import { estadoDosAvisos, pedirPermissaoDeAvisos, type EstadoDoAviso } from "@/lib/avisosDoNavegador";
import { agruparAvisos, avisoPedeDecisao, categoriaDoAviso, rotuloDoLink, rotuloDoTipoDoAviso, tiposDaCategoria, type CategoriaDoAviso, type GrupoDeAvisos } from "@/lib/avisos/rotulos";
import TesteDeAvisos from "@/components/avisos/TesteDeAvisos";
import { AjudaRecolhida, JanelaCentral, SeletorCompacto, botao, juntar, texto } from "@/components/sistema";

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
    case "anuncios": return { icon: <Megaphone className="w-4 h-4" />, bg: "bg-primary/10 text-primary" };
    // 26/10: o resumo do dia (um por dia) leva à tela Hoje.
    case "resumo": return { icon: <Sunrise className="w-4 h-4" />, bg: "bg-primary/10 text-primary" };
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NotificationsPanel({ open, onOpenChange }: Props) {
  const { user, profile } = useAuth();
  const [area, setArea] = useState<AreaDosAvisos>("painel");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [avisosDoNavegador, setAvisosDoNavegador] = useState<EstadoDoAviso>(() => estadoDosAvisos());
  const { data: avisos, isError, refetch } = useAvisosPorArea(area, tab === "unread", open);
  const papel = profile?.role || "client";
  const eEquipe = ["admin", "manager", "design", "traffic"].includes(papel);
  const eAdmin = papel === "admin";

  const handleClick = async (n: any) => {
    if (!n.read) {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      if (error) toast.error("O aviso abriu, mas não foi possível marcá-lo como lido.");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    const destination = safeInternalPath(typeof n.link === "string" ? destinoOperacional(n.link) : n.link);
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
      await marcarAreaComoLida(user.id, area);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(`Avisos de ${area === "agentes" ? "agentes" : area === "comercial" ? "comercial" : "painel"} marcados como lidos`);
    } catch {
      toast.error("Não consegui marcar agora. Tente de novo.");
    }
  };

  const listaCarregada = avisos?.lista || [];
  const unreadCount = avisos?.naoLidas || 0;
  // 26/10: grupos por tipo; o que pede decisão vem primeiro e é o único em destaque.
  const groups = agruparAvisos(listaCarregada as Array<{ id: string; notification_type?: string | null; read?: boolean | null; created_at?: string | null }>);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const grupoAberto = (g: GrupoDeAvisos<unknown>) => (abertos[g.categoria] !== undefined ? abertos[g.categoria] : g.pedeDecisao || g.itens.length <= 3);
  const marcarGrupo = async (g: GrupoDeAvisos<unknown>) => {
    if (!user?.id || g.naoLidos === 0) return;
    const tipos = g.tipos.concat(tiposDaCategoria(g.categoria as CategoriaDoAviso).filter((t) => g.tipos.indexOf(t) < 0));
    try {
      await marcarTiposComoLidos(user.id, area, tipos);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(`${g.nome}: marcados como lidos`);
    } catch {
      toast.error("Não consegui marcar agora. Tente de novo.");
    }
  };

  return (
    // Janela central (30/09, dono: "qualquer pop-up abrir no centro e não na
    // lateral"): o filtro fica no cabeçalho fixo e só a lista rola.
    <JanelaCentral
      aberta={open}
      onMudar={onOpenChange}
      largura="md"
      icone={<Bell className="h-4 w-4" />}
      titulo="Notificações"
      rotuloDoFechar="Fechar notificações"
      semEspaco
      abaixoDoTitulo={
        // Filtro (segmentado do sistema, sem pílulas verdes) e "marcar todas" na mesma linha.
        <div className="space-y-3">
          {eEquipe && <SeletorCompacto rotulo="Área das notificações" modo="segmentado" valor={area} onEscolher={v => setArea(v as AreaDosAvisos)} opcoes={[{ valor: "painel", rotulo: "Painel" }, { valor: "agentes", rotulo: "Agentes e execução" }, { valor: "comercial", rotulo: "Comercial" }]} />}
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
                Marcar esta aba como lida
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
      }
    >
        {/* Lista: a única rolagem da janela */}
        <div className="pb-2">
          {isError ? <button type="button" className="m-5 text-[13px] text-warning" onClick={() => void refetch()}>Não foi possível ler os avisos. Tentar novamente</button> : groups.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Nenhuma notificação.</p>
          ) : (
            groups.map((group) => {
              const aberto = grupoAberto(group);
              return (
              <section key={group.categoria} aria-label={group.nome} data-grupo-do-sino={group.categoria} className="border-b border-border/50 last:border-b-0">
                <div className="flex min-w-0 items-center px-5 py-2">
                  <button type="button" aria-expanded={aberto} onClick={() => setAbertos((x) => ({ ...x, [group.categoria]: !aberto }))} className="flex min-w-0 flex-1 items-center text-left">
                    <ChevronDown className={juntar("mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !aberto && "-rotate-90")} aria-hidden="true" />
                    <span className={juntar(texto.etiqueta, "min-w-0 truncate", group.pedeDecisao ? "text-primary" : "text-muted-foreground")}>{group.nome}</span>
                    <span className={juntar(texto.etiqueta, "ml-1.5 shrink-0 tabular-nums text-muted-foreground")}>{group.naoLidos > 0 ? `${group.naoLidos} não ${group.naoLidos === 1 ? "lido" : "lidos"}` : group.itens.length}</span>
                  </button>
                  {group.naoLidos > 0 && (
                    <button type="button" onClick={() => void marcarGrupo(group)} className={juntar(botao.discreto, "ml-2 h-7 shrink-0 px-2 text-[12px]")} title={`Marcar todos de ${group.nome} como lidos`} aria-label={`Marcar todos de ${group.nome} como lidos`}>
                      Marcar todos como lidos
                    </button>
                  )}
                </div>
                {aberto && group.itens.map((n: any) => {
                  const { icon, bg } = getNotifIcon(n.notification_type);
                  const destaque = !n.read && avisoPedeDecisao(n.notification_type);
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleClick(n)}
                      data-pede-decisao={destaque ? "" : undefined}
                      className={`px-5 py-3 cursor-pointer transition-colors ${
                        destaque ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-secondary/30"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bg}`} title={rotuloDoTipoDoAviso(n.notification_type) || undefined}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] leading-snug ${n.read ? "text-muted-foreground" : destaque ? "text-foreground font-medium" : "text-foreground"}`}>
                            {n.message}
                          </p>
                          {area === "agentes" && n.link && <ContextoDoAviso link={n.link} />}
                          <p className="text-[11px] text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                          {n.link && (
                            <p className="text-[11px] text-primary mt-1">{getLinkLabel(n)}</p>
                          )}
                        </div>
                        {!n.read && <div className={`w-2 h-2 rounded-full shrink-0 mt-2 ${destaque ? "bg-primary" : "bg-muted-foreground/40"}`} />}
                      </div>
                    </div>
                  );
                })}
              </section>
              );
            })
          )}
        </div>
    </JanelaCentral>
  );
}

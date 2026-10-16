import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  LayoutGrid,
  HeartPulse,
  CheckSquare,
  CalendarDays,
  Users,
  Columns3,
  Megaphone,
  MoreHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

/** Um destino da barra de baixo ou da folha "Mais". */
export interface DestinoDoCelular {
  title: string;
  url: string;
  icon: React.FC<{ className?: string }>;
  /** Acende só na rota exata (ex.: "/comercial" não acende nas abas dele). */
  fimExato?: boolean;
}

/**
 * Barra de baixo no celular (16/10/2026, dono: "cara de aplicativo, mais
 * clean, mais fácil de mexer"): 4 destinos do dia a dia por papel + "Mais".
 * O resto do menu, a busca, o tema, o Studio e o lançador (Aceleriq e ajuda)
 * moram na folha "Mais", que sobe de baixo. Nada flutua sobre o conteúdo.
 * Os avisos (sino) ficam no topo do celular, para não repetir aqui.
 */
export function destinosDaBarra(papel: string): DestinoDoCelular[] {
  const inicio: DestinoDoCelular = { title: "Início", url: "/dashboard", icon: LayoutDashboard };
  const agenda: DestinoDoCelular = { title: "Agenda", url: "/calendario", icon: CalendarDays };
  if (papel === "admin" || papel === "manager") {
    return [inicio, { title: "Central", url: "/central", icon: HeartPulse }, agenda, { title: "Clientes", url: "/clientes", icon: Users }];
  }
  if (papel === "design") {
    return [inicio, { title: "Mesas", url: "/mesas", icon: LayoutGrid }, agenda, { title: "Kanban", url: "/kanban", icon: Columns3 }];
  }
  if (papel === "traffic") {
    return [inicio, { title: "Anúncios", url: "/anuncios", icon: Megaphone }, agenda, { title: "Kanban", url: "/kanban", icon: Columns3 }];
  }
  return [inicio, { title: "Onde estamos", url: "/onde-estamos", icon: HeartPulse }, { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare }, agenda];
}

/** A rota atual está num destino da barra? (senão o "Mais" fica aceso). */
export function rotaNaBarra(pathname: string, destinos: DestinoDoCelular[]): boolean {
  const rota = (pathname || "/").replace(/\/+$/, "") || "/";
  return destinos.some((d) => rota === d.url || (!d.fimExato && rota.indexOf(`${d.url}/`) === 0));
}

interface Props {
  /** Quantos avisos não lidos (o sino mora no topo do celular; aqui só acende o "Mais" se precisar). */
  unreadCount?: number;
  /** Mantido por compatibilidade: o sino do celular agora fica no topo. */
  onOpenNotifications?: () => void;
  /** Lançador (agente, ajuda, tour): mora no pé da folha "Mais". */
  lancador?: ReactNode;
  maisAberto: boolean;
  onMaisAberto: (aberto: boolean) => void;
  /** O resto do menu, em grupos (já filtrado pelo papel). */
  grupos: Array<{ label: string; items: DestinoDoCelular[] }>;
  /** Quem está usando (nome, papel) e o que está contando agora: topo da folha. */
  perfil?: ReactNode;
  /** Atalhos em ícone no pé da folha (busca, tema, Studio). */
  ferramentas?: ReactNode;
  /** Última linha da folha (perfil e sair). */
  fim?: ReactNode;
}

const ITEM_DA_BARRA =
  "toque-compacto flex h-full min-w-0 flex-1 flex-col items-center justify-center text-[11px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function IconeDaBarra({ ativo, children }: { ativo: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mb-0.5 inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors",
        ativo ? "bg-primary/15 text-primary" : "",
      )}
    >
      {children}
    </span>
  );
}

export default function MobileBottomNav({ lancador, maisAberto, onMaisAberto, grupos, perfil, ferramentas, fim }: Props) {
  const { profile } = useAuth();
  const location = useLocation();
  const destinos = destinosDaBarra(profile?.role || "client");
  const maisAceso = maisAberto || !rotaNaBarra(location.pathname, destinos);

  // Trocar de tela fecha a folha (o toque num item já navega).
  useEffect(() => {
    onMaisAberto(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navegação principal"
        data-barra-de-baixo=""
      >
        <div className="mx-auto flex h-14 max-w-[560px] items-stretch">
          {destinos.map((d) => (
            <NavLink
              key={d.url}
              to={d.url}
              end={d.fimExato}
              className={({ isActive }) => cn(ITEM_DA_BARRA, isActive ? "text-foreground" : "text-muted-foreground")}
            >
              {({ isActive }) => (
                <>
                  <IconeDaBarra ativo={isActive}>
                    <d.icon className="h-5 w-5" />
                  </IconeDaBarra>
                  <span className="max-w-full truncate px-0.5">{d.title}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => onMaisAberto(!maisAberto)}
            aria-label="Mais: menu, busca, tema e ajuda"
            aria-expanded={maisAberto}
            aria-haspopup="dialog"
            data-botao-mais=""
            className={cn(ITEM_DA_BARRA, maisAceso ? "text-foreground" : "text-muted-foreground")}
          >
            <IconeDaBarra ativo={maisAceso}>
              <MoreHorizontal className="h-5 w-5" />
            </IconeDaBarra>
            <span>Mais</span>
          </button>
        </div>
      </nav>

      <DialogPrimitive.Root open={maisAberto} onOpenChange={onMaisAberto}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 md:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            data-folha-de-baixo=""
            data-folha-mais=""
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-xl border-t border-border bg-card text-foreground outline-none supports-[height:1dvh]:max-h-[88dvh] md:hidden"
          >
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" data-alca="" />
            <div className="flex min-w-0 shrink-0 items-center px-4 pb-2 pt-2">
              <DialogPrimitive.Title className="sr-only">Mais</DialogPrimitive.Title>
              <div className="min-w-0 flex-1">{perfil}</div>
              <DialogPrimitive.Close
                aria-label="Fechar"
                className="toque-compacto ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <nav aria-label="Mais páginas" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3" data-lista-do-mais="">
              {grupos.map((grupo) => (
                <div key={grupo.label} className="pt-3 first:pt-1">
                  <p className="px-1 pb-1 text-[12px] font-medium leading-4 text-muted-foreground">{grupo.label}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {grupo.items.map((item) => (
                      <NavLink
                        key={item.url}
                        to={item.url}
                        end={item.fimExato}
                        onClick={() => onMaisAberto(false)}
                        className={({ isActive }) =>
                          cn(
                            "flex h-11 min-w-0 items-center rounded-md px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActive ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )
                        }
                      >
                        <item.icon className="mr-2.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">{item.title}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
              {fim ? <div className="mt-3 border-t border-border pt-2">{fim}</div> : null}
            </nav>
            {(ferramentas || lancador) && (
              <div
                className="grid shrink-0 grid-cols-4 border-t border-border"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                data-ferramentas-do-mais=""
              >
                {ferramentas}
                {lancador ? <div className="relative flex h-16 min-w-0">{lancador}</div> : null}
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

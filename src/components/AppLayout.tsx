import { lazy, Suspense, useState, useRef, useEffect, useLayoutEffect, useCallback, useSyncExternalStore } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useSupabaseData";
import { useAvisosEmTempoReal, useContagemDeNaoLidas } from "@/hooks/useAvisos";
import NotificationsPanel from "@/components/NotificationsPanel";
import { avisoParaMostrar, mostrarAvisoNoNavegador } from "@/lib/avisosDoNavegador";
import { safeInternalPath, safePublicPostUrl } from "@/lib/internalNavigation";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import Lancador from "@/components/lancador/Lancador";
import { PedidoDeAcessoPelaUrl } from "@/components/acesso/JanelaDoPedidoDeAcesso";
import { EVENTO_ABRIR_AGENTE, type PedidoParaAbrirAgente } from "@/lib/lancador";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bell, LogOut, MoreHorizontal, Search, Zap, Sun, Moon, Sparkles, Bot, RefreshCw } from "lucide-react";
import { assinarVersaoNova, atualizarAgora, versaoNovaPendente } from "@/lib/appRefresh";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutGrid, GraduationCap, BookOpen, LayoutDashboard, FolderOpen, Columns3, Users, UsersRound, CheckSquare,
  BarChart3, GitBranch, DollarSign, FileArchive, Settings,
  Eye, ShoppingBag, FileText, UserCircle, ClipboardList, KeyRound, FileSignature, HardDrive, CalendarDays,
  HeartPulse, Megaphone, Briefcase, Target, KanbanSquare, CalendarClock, Timer, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import aceleriqLogo from "@/assets/logo-aceleriq-256.png";
import MobileBottomNav, { destinosDaBarra, type DestinoDoCelular } from "@/components/MobileBottomNav";
import { rotuloDoLugar } from "@/lib/navegacao/lugares";
import BuscaDoPainel, { type PaginaDaBusca } from "@/components/casca/BuscaDoPainel";
import { usePreCargaOciosaDasMesas } from "@/lib/mesa/preCarga";
import { lazyDiscreto, preCarregarModulo, quandoOcioso } from "@/lib/lazyComPreCarga";
import CronometroDoTopo from "@/components/cronometro/CronometroDoTopo";
import VoltarParaOndeEstava from "@/components/navegacao/VoltarParaOndeEstava";

// O assistente de voz traz o leitor de PDF e as animações (mais de 1 MB de
// código): fora da abertura do painel, baixa logo depois, sem segurar a tela.
const VoiceAssistant = lazy(() => import("@/components/admin/VoiceAssistant"));

// 18/10 (painel otimizado): o indicador de geração (e a fila e a API da Mesa
// que ele puxa) sai do primeiro arquivo e chega quando o navegador fica ocioso.
// Só a equipe vê; para o cliente o arquivo nem baixa. Ver lazyDiscreto.
// Medido: a janela do pedido de acesso e o painel de avisos ficam fixos de
// propósito. Fora do primeiro arquivo, os componentes pequenos do sistema que
// eles usam grudavam (piso de tamanho) em pedaços de outras telas, e o /login
// e quase toda rota passaram a baixar mais do que a abertura economizava.
const IndicadorDeGeracoes = lazyDiscreto("casca/geracoes", () => import("@/components/geracao/IndicadorDeGeracoes"));

// Os roteiros do tour (cerca de 30 KB de texto) também chegam no ocioso: o
// lançador só os mostra quando abre, e o tour automático pede na hora.
type RoteirosDoTour = typeof import("@/components/onboarding/tourConfigs");
const carregarRoteirosDoTour = () => preCarregarModulo("casca/roteiros-do-tour", () => import("@/components/onboarding/tourConfigs")) as unknown as Promise<RoteirosDoTour>;
let roteirosDoTour: RoteirosDoTour | null = null;
function useRoteirosDoTour(precisaJa: boolean): RoteirosDoTour | null {
  const [roteiros, setRoteiros] = useState<RoteirosDoTour | null>(roteirosDoTour);
  useEffect(() => {
    if (roteiros) return;
    let vivo = true;
    const baixar = () => {
      carregarRoteirosDoTour().then((m) => {
        roteirosDoTour = m;
        if (vivo) setRoteiros(m);
      }, () => undefined);
    };
    if (precisaJa) {
      baixar();
      return () => { vivo = false; };
    }
    const cancelar = quandoOcioso(baixar);
    return () => { vivo = false; cancelar(); };
  }, [roteiros, precisaJa]);
  return roteiros;
}


/**
 * Ícone discreto de versão nova no topo. Trocar de tela nunca recarrega o
 * painel (src/lib/appRefresh.ts); a versão nova entra quando a pessoa clica.
 */
export function BotaoVersaoNova() {
  const versaoNova = useSyncExternalStore(assinarVersaoNova, versaoNovaPendente, versaoNovaPendente);
  if (!versaoNova) return null;
  return (
    <button
      type="button"
      onClick={() => { atualizarAgora(); }}
      aria-label="Nova versão do painel: clique para atualizar"
      title="Nova versão do painel: clique para atualizar"
      className="relative w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RefreshCw className="w-4 h-4" />
      <span aria-hidden="true" className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
    </button>
  );
}

/**
 * Celular (< 768 px, a mesma faixa do `md:` da casca). A casca do celular
 * (topo enxuto, barra de baixo e folha "Mais") e a do computador (barra
 * flutuante) não ficam as duas montadas: o que tem estado (gerações,
 * cronômetro, "voltar para onde estava") monta uma vez só. Sem matchMedia
 * (teste, navegador antigo) vale o computador. Safari 11 não tem
 * addEventListener na MediaQueryList: usa addListener.
 */
const CONSULTA_DO_CELULAR = "(max-width: 767px)";
function ehCelularAgora(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(CONSULTA_DO_CELULAR).matches;
}
export function useEhCelular(): boolean {
  const [celular, setCelular] = useState(ehCelularAgora);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(CONSULTA_DO_CELULAR);
    const mudou = () => setCelular(mq.matches);
    mudou();
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", mudou);
    else if (typeof mq.addListener === "function") mq.addListener(mudou);
    return () => {
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", mudou);
      else if (typeof mq.removeListener === "function") mq.removeListener(mudou);
    };
  }, []);
  return celular;
}

/**
 * Nome curto da tela para o topo do celular: o item do menu que melhor casa
 * com a rota (o mais longo), senão o nome do lugar, senão "Aceleriq".
 */
export function tituloDaTela(pathname: string, paginas: Array<{ title: string; url: string }>): string {
  const rota = (pathname || "/").replace(/\/+$/, "") || "/";
  let melhor: { title: string; url: string } | null = null;
  for (const p of paginas) {
    if (rota === p.url || rota.indexOf(`${p.url}/`) === 0) {
      if (!melhor || p.url.length > melhor.url.length) melhor = p;
    }
  }
  if (melhor) return melhor.url === "/comercial" ? "Comercial" : melhor.title;
  return rotuloDoLugar(rota, "") || "Aceleriq";
}

interface NavItem {
  title: string;
  url: string;
  icon: React.FC<{ className?: string }>;
  /** Item de gestão: só admin e manager enxergam. */
  soGestao?: boolean;
  soCriacao?: boolean;
  /** Acende só na rota exata. Sem isto, a entrada "/comercial" ficaria
      acesa em todas as áreas do departamento ao mesmo tempo. */
  fimExato?: boolean;
}

const adminMainNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Kanban", url: "/kanban", icon: Columns3 },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Clientes", url: "/clientes", icon: Users },
];

// O menu "mais" agrupado por tema: 18 itens numa lista corrida obrigavam a
// ler tudo para achar qualquer coisa. Os grupos seguem a pergunta de quem
// procura: "onde opero a semana", "onde vejo resultado", "onde administro".
// O Quiz saiu do menu (a rota continua viva para quem tem o link): era uma
// ferramenta pontual ocupando espaço de todo dia.
const adminMoreGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operação da semana",
    items: [
      { title: "Central", url: "/central", icon: HeartPulse },
      { title: "Mesas", url: "/mesas", icon: LayoutGrid, soCriacao: true },
      // 17/10: o que cada agente sabe (o dono ensina e a pesquisa semanal complementa).
      { title: "Base dos agentes", url: "/base-dos-agentes", icon: GraduationCap, soCriacao: true },
      // Laboratório (19/10/2026): trabalhos avulsos com ou sem cliente (admin, gestor e design).
      { title: "Laboratório", url: "/laboratorio", icon: FlaskConical, soCriacao: true },
      { title: "Ciclo", url: "/ciclo", icon: CheckSquare },
      { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
      { title: "Execução da equipe", url: "/execucao", icon: Bot },
      { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
      { title: "Briefings", url: "/briefings", icon: FileText },
    ],
  },
  {
    label: "Resultados",
    items: [
      { title: "Métricas", url: "/metricas", icon: BarChart3 },
      { title: "Anúncios", url: "/anuncios", icon: Megaphone },
      { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
      { title: "Timeline", url: "/timeline", icon: GitBranch },
    ],
  },
  {
    // Área própria, e não um item dentro de Gestão: o comercial conversa com
    // o financeiro e o completa, mas é outro departamento — quem procura o
    // funil não procura em "Gestão". Só admin e manager entram: design e
    // tráfego são equipe, mas operam entrega.
    label: "Comercial",
    items: [
      { title: "Visão geral", url: "/comercial", icon: Briefcase, soGestao: true, fimExato: true },
      { title: "CRM", url: "/comercial/crm", icon: KanbanSquare, soGestao: true },
      { title: "Agenda", url: "/comercial/agenda", icon: CalendarClock, soGestao: true },
      { title: "Metas", url: "/comercial/metas", icon: Target, soGestao: true },
      { title: "Campanhas", url: "/comercial/campanhas", icon: Megaphone, soGestao: true },
      { title: "Marketing", url: "/comercial/marketing", icon: Sparkles, soGestao: true },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Equipe", url: "/equipe", icon: UsersRound },
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
      // Horas e custos (frente CR): tempo por cliente, custo de IA e capacidade. Só admin e gestor.
      { title: "Horas e custos", url: "/horas", icon: Timer, soGestao: true },
      { title: "Arquivos", url: "/arquivos", icon: FileArchive },
      { title: "Workspace", url: "/workspace", icon: HardDrive },
      { title: "Cofre", url: "/cofre", icon: KeyRound },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Área de membros", url: "/membros", icon: BookOpen },
      { title: "Novidades", url: "/novidades", icon: Sparkles },
      { title: "Config", url: "/config", icon: Settings },
      { title: "API", url: "/api-docs", icon: Zap },
    ],
  },
];

/**
 * O menu conforme o papel.
 *
 * A peneira mora aqui, num lugar só, porque o menu tem duas saídas — os
 * grupos do desktop e a lista corrida do celular. Filtrar em cada uma
 * deixaria o item aparecendo em uma delas no primeiro conserto distraído.
 * A trava de verdade é a rota e o RLS; isto é para não oferecer porta que
 * não abre.
 */
const gruposPorPapel = (podeGestao: boolean, podeCriacao = true) =>
  adminMoreGroups
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => (podeGestao || !item.soGestao) && (podeCriacao || !item.soCriacao)),
    }))
    .filter((grupo) => grupo.items.length > 0);

/**
 * Barra do topo de 768 a 1023 px (notebook estreito, tablet deitado): cabem
 * só os primeiros links; o resto entra no "...". Prioridade do lado direito:
 * avatar sempre; lançador, sino, busca (ícone) e o indicador de gerações
 * ficam; o tema vai para o menu do perfil. De 1024 para cima, tudo na barra.
 */
const LINKS_NO_TOPO_ESTREITO = 3;

const clientMainNav: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Onde Estamos", url: "/onde-estamos", icon: HeartPulse },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
];

const clientMoreNav: NavItem[] = [
  { title: "Área de membros", url: "/membros", icon: BookOpen },
  { title: "Novidades", url: "/novidades", icon: Sparkles },
  { title: "Cofre", url: "/cofre", icon: KeyRound },
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
  { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
  { title: "Documentos", url: "/documentos", icon: FileText },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Perfil", url: "/perfil", icon: UserCircle },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  // Celular (16/10/2026): a folha "Mais" da barra de baixo substitui o menu em gaveta do topo.
  const celular = useEhCelular();
  const [maisAberto, setMaisAberto] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourMode, setTourMode] = useState<"full" | "page">("full");
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const role = profile?.role || "client";
  const isAdmin = role === "admin";
  const isTeam = ["design", "traffic", "manager"].includes(role);
  const isAdminOrTeam = isAdmin || isTeam;
  const podeGestao = isAdmin || role === "manager";
  const gruposDoMenu = gruposPorPapel(podeGestao, podeGestao || role === "design");
  const mainNav = isAdminOrTeam ? adminMainNav : clientMainNav;
  const moreNav = isAdminOrTeam
    ? gruposDoMenu.flatMap((grupo) => grupo.items)
    : clientMoreNav;
  const { data: notifData } = useNotifications();
  // Quem usa as mesas já tem o código delas antes do clique (src/lib/mesa/preCarga.ts).
  usePreCargaOciosaDasMesas(["admin", "manager", "design"].includes(role));
  // O botão do assistente entra depois da primeira pintura, com o navegador ocioso.
  const [vozNaTela, setVozNaTela] = useState(false);
  useEffect(() => quandoOcioso(() => setVozNaTela(true), 3000), []);
  // Lançador único (canto inferior direito): o agente abre por ele, pelo
  // Alt+A ou pelo evento EVENTO_ABRIR_AGENTE (qualquer tela, com contexto).
  const [agenteAberto, setAgenteAberto] = useState(false);
  const [pedidoDoAgente, setPedidoDoAgente] = useState<(PedidoParaAbrirAgente & { vez: number }) | null>(null);
  const abrirAgente = useCallback(() => { setVozNaTela(true); setAgenteAberto(true); setMaisAberto(false); }, []);
  useEffect(() => {
    if (!isAdmin) return;
    const ouvir = (e: Event) => {
      const d = ((e as CustomEvent).detail || {}) as PedidoParaAbrirAgente;
      setPedidoDoAgente({ ...d, vez: Date.now() });
      abrirAgente();
    };
    window.addEventListener(EVENTO_ABRIR_AGENTE, ouvir);
    return () => window.removeEventListener(EVENTO_ABRIR_AGENTE, ouvir);
  }, [isAdmin, abrirAgente]);
  // Sino em tempo real e contagem de verdade (antes: só entre os 30 carregados).
  useAvisosEmTempoReal();
  const { data: contagemNaoLidas } = useContagemDeNaoLidas();
  const unreadCount = typeof contagemNaoLidas === "number"
    ? contagemNaoLidas
    : (notifData || []).filter((n: any) => !n.read).length;

  // Aviso do navegador para a equipe: o sino so e visto por quem olha para
  // ele. A marca d'agua comeca no aviso mais novo ja carregado, para nao
  // disparar tudo o que estava pendente ao abrir o painel.
  const marcaDeAvisos = useRef<string | null>(null);
  useEffect(() => {
    if (!isAdminOrTeam || !notifData) return;
    const lista = notifData as Array<{ id: string; message: string; link?: string | null; created_at: string; read?: boolean }>;
    if (marcaDeAvisos.current === null) {
      marcaDeAvisos.current = lista.reduce((m, n) => (n.created_at > m ? n.created_at : m), "");
      return;
    }
    const aviso = avisoParaMostrar(lista, marcaDeAvisos.current);
    if (!aviso) return;
    marcaDeAvisos.current = aviso.marca;
    mostrarAvisoNoNavegador(aviso, (link) => {
      const destino = safeInternalPath(link);
      if (destino) navigate(destino);
      // Post no ar: o aviso leva ao Instagram, como o clique no sino.
      else { const publico = safePublicPostUrl(link); if (publico) window.open(publico, "_blank", "noopener,noreferrer"); }
    });
  }, [notifData, isAdminOrTeam, navigate]);

  const roteiros = useRoteirosDoTour(tourOpen || Boolean(profile && !profile.onboarding_done));
  const fullTourSteps = !roteiros ? [] : isAdmin ? roteiros.adminTourSteps : isTeam ? roteiros.teamTourSteps : roteiros.clientTourSteps;

  // Page-specific tour
  const pageSteps = roteiros ? roteiros.getPageTour(location.pathname, role) : null;
  const pageTourConfig = roteiros?.pageTours.find(p => location.pathname.startsWith(p.route));
  const activeTourSteps = tourMode === "page" && pageSteps ? pageSteps : fullTourSteps;

  // Auto-start tour on first visit (using DB flag)
  useEffect(() => {
    if (profile && !profile.onboarding_done) {
      const timer = setTimeout(() => setTourOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  // O aviso de "cliente acessou" mora SÓ no AuthContext, preso ao evento
  // real de entrada (SIGNED_IN). O aviso que morava aqui era um segundo
  // remetente para o mesmo fato, com trava por ABA (sessionStorage é por
  // aba): cada aba nova, cada reabertura do PWA, disparava outro — foi
  // assim que um login da cliente virou 16 avisos, em dois textos
  // diferentes. Um fato, um remetente.

  const handleTourClose = useCallback(() => {
    setTourOpen(false);
    if (user) {
      supabase.from("profiles").update({ onboarding_done: true } as any).eq("id", user.id).then();
    }
  }, [user]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    // Esc fecha o "mais" e o menu do perfil (teclado).
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      setMoreOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", tecla);
    };
  }, []);

  // Busca de página (lupa da barra e Ctrl+K): o mesmo menu, já filtrado pelo papel.
  const [buscaAberta, setBuscaAberta] = useState(false);
  const paginasDaBusca: PaginaDaBusca[] = [
    ...mainNav.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: "Principal" })),
    ...(isAdminOrTeam
      ? gruposDoMenu.flatMap((grupo) => grupo.items.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: grupo.label })))
      : clientMoreNav.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: "Mais" }))),
  ];

  // Um lançador só, em dois lugares da casca: barra do topo (768 px para
  // cima) e barra de baixo (celular). Nada flutua sobre o conteúdo.
  const propsDoLancador = {
    papel: (isAdminOrTeam ? "equipe" : "cliente") as "equipe" | "cliente",
    podeUsarAgente: isAdmin,
    onAbrirAgente: abrirAgente,
    passosDaTela: pageSteps,
    rotuloDaTela: pageTourConfig?.label,
    // O tour sai da folha "Mais" do celular: a folha fecha para o tour aparecer.
    onTourDaTela: pageSteps ? () => { setMaisAberto(false); setTourMode("page"); setTourOpen(true); } : null,
    onTourCompleto: () => { setMaisAberto(false); setTourMode("full"); setTourOpen(true); },
  };

  // Studio (equipe): abre no Workspace. No celular o atalho mora na folha "Mais".
  const abrirStudio = () => {
    setMaisAberto(false);
    // Flag persistente: se o StudioPanel ainda não montou, ele lê a flag no mount.
    (window as any).__studioOpenPending = true;
    const fire = () => window.dispatchEvent(new Event("studio:open"));
    if (location.pathname !== "/workspace") {
      navigate("/workspace");
      // Retry curto para cobrir o tempo de mount do painel.
      window.setTimeout(fire, 60);
      window.setTimeout(fire, 220);
      window.setTimeout(fire, 500);
    } else {
      fire();
    }
  };

  // ── Casca do celular (16/10/2026) ──
  // Barra de baixo: 4 destinos por papel + "Mais". A folha "Mais" leva o resto
  // do menu (sem repetir o que já está na barra), a busca, o tema, o Studio e
  // o lançador. O topo do celular fica só com a logo (ou o nome da tela, ao
  // rolar), o voltar, a busca e o sino.
  const naBarra = destinosDaBarra(role).map((d) => d.url);
  // Cliente: o Perfil já tem o atalho no pé da folha; não repete na lista.
  const foraDaBarra = (item: NavItem) => naBarra.indexOf(item.url) < 0 && (isAdminOrTeam || item.url !== "/perfil");
  const gruposDoCelular: Array<{ label: string; items: DestinoDoCelular[] }> = (isAdminOrTeam
    ? [{ label: "Principal", items: mainNav }, ...gruposDoMenu]
    : [{ label: "Principal", items: mainNav }, { label: "Mais", items: clientMoreNav }]
  )
    .map((grupo) => ({ label: grupo.label, items: grupo.items.filter(foraDaBarra) }))
    .filter((grupo) => grupo.items.length > 0);
  const tituloDoTopo = tituloDaTela(location.pathname, paginasDaBusca);
  const iniciais = (profile?.full_name || "").split(" ").map((n) => n[0]).join("").slice(0, 2);
  const papelLegivel = isAdmin ? "Administrador" : role === "manager" ? "Gestor" : role === "design" ? "Design" : role === "traffic" ? "Tráfego" : profile?.company_name || "Cliente";

  // A área de conteúdo é quem rola no celular: trocar de tela começa no topo
  // (antes a tela nova abria no meio, na altura em que a anterior estava).
  // Antes da pintura; quem guarda a própria rolagem devolve depois (timers).
  const conteudoRef = useRef<HTMLElement>(null);
  const [rolou, setRolou] = useState(false);
  useLayoutEffect(() => {
    const el = conteudoRef.current;
    if (el && el.scrollTop > 0) el.scrollTop = 0;
    setRolou(false);
  }, [location.pathname]);
  const aoRolarConteudo = useCallback((e: React.UIEvent<HTMLElement>) => {
    const passou = e.currentTarget.scrollTop > 56;
    setRolou((antes) => (antes === passou ? antes : passou));
  }, []);
  // Voltou para o computador com a folha aberta: fecha (ela só existe no celular).
  useEffect(() => {
    if (!celular) setMaisAberto(false);
  }, [celular]);

  const ferramentaDoMais = "toque-compacto flex h-16 min-w-0 flex-col items-center justify-center text-[11px] font-medium leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const linhaDoMais = "flex h-11 w-full min-w-0 items-center rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="min-h-screen bg-background tech-grid-bg" data-tour="welcome">
      {/* Floating TopNav. data-casca: o modo foco (src/lib/modoFoco.ts + index.css) esconde a barra, o que flutua e tira o recuo do conteúdo. */}
      {/* Só de 768 px para cima (16/10/2026): o celular tem o topo enxuto logo abaixo. */}
      {!celular && <nav data-casca="topo" className="dark fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] md:w-[calc(100%-3rem)] max-w-[1792px] z-50 h-[52px] rounded-xl flex items-center px-3 gap-2 lg:px-4 lg:gap-4 text-foreground"
        style={{
          top: 'calc(env(safe-area-inset-top) + 12px)',
          background: 'rgba(17, 17, 19, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(39, 39, 42, 0.5)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Clip the square bitmap's transparent padding to the navbar so it
            cannot intercept clicks on the page below. Keep menus unclipped. */}
        <div className="flex h-full items-center shrink-0 overflow-hidden">
          <img src={aceleriqLogo} alt="Aceleriq" className="h-28 w-auto" />
        </div>

        {/* Center: Nav links (desktop) */}
        {/* De 768 a 1023 cabem os LINKS_NO_TOPO_ESTREITO primeiros; o resto vai para o "..." (sem corte nem rolagem lateral). */}
        <div className="hidden md:flex min-w-0 items-center gap-1 flex-1 justify-center">
          {mainNav.map((item, indice) => {
            const tourId = item.url.replace("/", "nav-");
            return (
              <NavLink
                key={item.url}
                to={item.url}
                data-tour={tourId}
                className={({ isActive }) => cn(
                  "relative whitespace-nowrap px-2 lg:px-3 py-1.5 text-[13px] rounded-md transition-colors",
                  indice >= LINKS_NO_TOPO_ESTREITO && "hidden lg:block",
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
            );
          })}

          {/* More dropdown */}
          <div className="relative" ref={moreRef} data-tour="nav-more">
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-label="Mais páginas"
              aria-expanded={moreOpen}
              className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-56 max-h-[70vh] overflow-y-auto rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in"
                style={{ transformOrigin: 'top center' }}
              >
                {/* 768 a 1023: os links principais que não couberam na barra. */}
                {mainNav.length > LINKS_NO_TOPO_ESTREITO && (
                  <div className="mb-1 border-b border-border pb-1 lg:hidden" data-links-que-nao-couberam="">
                    {mainNav.slice(LINKS_NO_TOPO_ESTREITO).map((item) => (
                      <NavLink
                        key={item.url}
                        to={item.url}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) => cn(
                          "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors",
                          isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        )}
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        {item.title}
                      </NavLink>
                    ))}
                  </div>
                )}
                {/* Cliente não tem grupos: a lista dele é curta e direta. */}
                {isAdminOrTeam ? (
                  gruposDoMenu.map((group) => (
                    <div key={group.label} className="mb-1 last:mb-0">
                      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold text-muted-foreground/70">
                        {group.label}
                      </p>
                      {group.items.map((item) => (
                        <NavLink
                          key={item.url}
                          to={item.url}
                          end={item.fimExato}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) => cn(
                            "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors",
                            isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                          )}
                        >
                          <item.icon className="w-3.5 h-3.5" />
                          {item.title}
                        </NavLink>
                      ))}
                    </div>
                  ))
                ) : (
                  moreNav.map((item) => (
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
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Icons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Voltar para onde eu estava (29/09): o lugar anterior num toque, com a lista dos últimos. */}
          {isAdminOrTeam && <VoltarParaOndeEstava />}
          {/* Cronômetro por cliente (frente CR): o cliente em foco e o tempo do mês nele; clicar abre Horas e custos. */}
          {isAdminOrTeam && <CronometroDoTopo podeAbrirCentral={podeGestao} />}
          {/* "Gerando em N clientes": só aparece com geração na fila do servidor (frente G). */}
          {isAdminOrTeam && <IndicadorDeGeracoes userId={user?.id} />}
          {/* Versão nova publicada com o painel aberto (16/10): só este ícone avisa; recarrega quando a pessoa clicar. */}
          <BotaoVersaoNova />
          <button
            type="button"
            onClick={() => setBuscaAberta(true)}
            aria-label="Buscar página (Ctrl+K)"
            title="Buscar página (Ctrl+K)"
            className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="w-4 h-4" />
          </button>
          {/* Lançador (768 px para cima): agente, ajuda da tela, tour e atalhos na barra, nunca flutuando. Cliente: o "?". */}
          <Lancador variante="topo" className="hidden md:block" {...propsDoLancador} />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            data-prioridade-no-topo="tema"
            className="w-8 h-8 flex md:hidden lg:flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            data-tour="nav-notifications"
            aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
            className="relative w-8 h-8 hidden md:flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setNotifOpen(true)}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center px-1 tabular-nums">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* User dropdown */}
          <div className="relative" ref={userRef} data-tour="nav-user">
            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-label="Menu do perfil"
              aria-expanded={userMenuOpen}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="w-7 h-7 cursor-pointer">
                <AvatarFallback className="bg-primary/15 text-primary text-[11px] font-semibold">
                  {profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0,2)}
                </AvatarFallback>
              </Avatar>
            </button>
            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 rounded-xl bg-popover border border-border p-1.5 shadow-lg animate-fade-in">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <p className="text-[12px] font-medium text-foreground">{profile?.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{profile?.role === "admin" ? "Administrador" : profile?.company_name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); navigate("/perfil"); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  <UserCircle className="w-3.5 h-3.5" />
                  Meu perfil
                </button>
                {/* 768 a 1023: o tema sai da barra e mora aqui. */}
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); toggleTheme(); }}
                  data-tema-no-menu=""
                  className="hidden md:flex lg:hidden items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  {theme === "dark" ? "Tema claro" : "Tema escuro"}
                </button>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair
                </button>
              </div>
            )}
          </div>

          {/* Fim da direita. O menu do celular mora na folha "Mais" da barra de baixo (16/10/2026). */}
        </div>
      </nav>}

      {/* Topo do celular (16/10/2026, dono: "cara de aplicativo, mais clean"): barra
          cheia, colada no alto, na cor do tema. Esquerda: voltar (quando há para onde)
          e a logo, que vira o nome da tela quando o título da página sai de vista ao
          rolar. Direita: só o que é de agora (gerações, versão nova), a busca e o sino.
          Menu, perfil, tema, Studio e ajuda ficam na folha "Mais" (barra de baixo). */}
      {celular && (
        <header
          data-casca="topo"
          data-topo-do-celular=""
          className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background md:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="flex h-[52px] min-w-0 items-center px-2">
            {isAdminOrTeam && <VoltarParaOndeEstava compacto />}
            <div className="relative ml-2 h-full min-w-0 flex-1">
              <div
                aria-hidden={rolou ? "true" : undefined}
                className={cn("absolute inset-0 flex items-center overflow-hidden transition-opacity duration-200", rolou ? "opacity-0" : "opacity-100")}
              >
                <img src={aceleriqLogo} alt="Aceleriq" className="logo-do-topo -ml-2 h-24 w-auto max-w-none" />
              </div>
              <p
                aria-hidden={rolou ? undefined : "true"}
                className={cn("absolute inset-0 flex min-w-0 items-center transition-opacity duration-200", rolou ? "opacity-100" : "opacity-0")}
                data-titulo-do-topo=""
              >
                <span className="min-w-0 truncate text-[15px] font-semibold leading-[22px] text-foreground">{tituloDoTopo}</span>
              </p>
            </div>
            <div className="ml-1 flex shrink-0 items-center">
              {isAdminOrTeam && <IndicadorDeGeracoes userId={user?.id} />}
              <BotaoVersaoNova />
              <button
                type="button"
                onClick={() => setBuscaAberta(true)}
                aria-label="Buscar página"
                className="toque-compacto flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Search className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setNotifOpen(true)}
                aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
                className="toque-compacto relative flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Content */}
      {/* Celular: camada fixa entre o topo (52 px) e a barra de baixo (56 px), com
          rolagem própria e sem elástico puxando a casca (overscroll contido). */}
      <main
        ref={conteudoRef}
        onScroll={celular ? aoRolarConteudo : undefined}
        className={cn(
          "fixed inset-x-0 top-[calc(env(safe-area-inset-top)+52px)] bottom-[calc(env(safe-area-inset-bottom)+56px)] z-0 mx-auto w-full overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 md:static md:px-6 md:pt-[calc(env(safe-area-inset-top)+80px)] md:pb-[calc(env(safe-area-inset-bottom)+96px)] md:overflow-visible",
          // Tela larga em todas as páginas, igual às mesas: com 1280/1400 px o painel
          // ficava espremido com espaço vazio dos lados (dono, 23/09 e 26/09).
          "max-w-[1840px]",
        )}
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        data-tour="finish"
        data-casca="conteudo"
      >
        {children}
      </main>

      <div data-casca="rodape">
        <MobileBottomNav
          unreadCount={unreadCount}
          onOpenNotifications={() => setNotifOpen(true)}
          lancador={<Lancador variante="barra" {...propsDoLancador} />}
          maisAberto={maisAberto}
          onMaisAberto={setMaisAberto}
          grupos={gruposDoCelular}
          perfil={
            <div className="flex min-w-0 items-center">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-primary/15 text-[12px] font-semibold text-primary">{iniciais}</AvatarFallback>
              </Avatar>
              <div className="ml-3 min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-5 text-foreground">{profile?.full_name}</p>
                <p className="truncate text-[12px] leading-4 text-muted-foreground">{papelLegivel}</p>
              </div>
              {/* Cronômetro por cliente (frente CR): no celular mora aqui, fora do topo. */}
              {isAdminOrTeam && celular && maisAberto && <div className="ml-2 flex shrink-0 items-center"><CronometroDoTopo podeAbrirCentral={podeGestao} /></div>}
            </div>
          }
          ferramentas={
            <>
              <button type="button" className={ferramentaDoMais} onClick={() => { setMaisAberto(false); setBuscaAberta(true); }}>
                <Search className="mb-0.5 h-5 w-5" aria-hidden="true" />
                Buscar
              </button>
              <button type="button" className={ferramentaDoMais} onClick={toggleTheme} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}>
                {theme === "dark" ? <Sun className="mb-0.5 h-5 w-5" aria-hidden="true" /> : <Moon className="mb-0.5 h-5 w-5" aria-hidden="true" />}
                {theme === "dark" ? "Claro" : "Escuro"}
              </button>
              {isAdminOrTeam ? (
                <button type="button" className={ferramentaDoMais} onClick={abrirStudio} aria-label="Abrir Studio">
                  <Sparkles className="mb-0.5 h-5 w-5" aria-hidden="true" />
                  Studio
                </button>
              ) : (
                <button type="button" className={ferramentaDoMais} onClick={() => { setMaisAberto(false); navigate("/perfil"); }}>
                  <UserCircle className="mb-0.5 h-5 w-5" aria-hidden="true" />
                  Perfil
                </button>
              )}
            </>
          }
          fim={
            <>
              {isAdminOrTeam && (
                <button type="button" className={linhaDoMais} onClick={() => { setMaisAberto(false); navigate("/perfil"); }}>
                  <UserCircle className="mr-2.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Meu perfil
                </button>
              )}
              <button type="button" className={linhaDoMais} onClick={() => { setMaisAberto(false); logout(); }}>
                <LogOut className="mr-2.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Sair
              </button>
            </>
          }
        />
      </div>


      <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} />
      <PedidoDeAcessoPelaUrl />
      <BuscaDoPainel aberto={buscaAberta} onAbertoChange={setBuscaAberta} paginas={paginasDaBusca} />

      {/* Onboarding Tour */}
      <OnboardingTour
        steps={activeTourSteps}
        isOpen={tourOpen}
        onClose={handleTourClose}
        storageKey="onboarding_done"
      />

      <div data-casca="flutuante">
        {/* O lançador mora nas barras (topo e barra de baixo): aqui fica só o painel do agente. */}
        {isAdmin && vozNaTela && (
          <Suspense fallback={null}>
            <VoiceAssistant aberto={agenteAberto} onAbertoChange={setAgenteAberto} pedido={pedidoDoAgente} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

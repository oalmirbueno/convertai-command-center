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
import { Bell, ChevronDown, LogOut, Search, Zap, Sun, Moon, Sparkles, Bot, RefreshCw, Repeat } from "lucide-react";
import { assinarVersaoNova, atualizarAgora, versaoNovaPendente } from "@/lib/appRefresh";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutGrid, GraduationCap, BookOpen, Boxes, LayoutDashboard, FolderOpen, Columns3, Users, UsersRound, CheckSquare,
  BarChart3, GitBranch, DollarSign, FileArchive, Settings,
  Eye, ShoppingBag, FileText, UserCircle, ClipboardList, KeyRound, FileSignature, HardDrive, CalendarDays,
  HeartPulse, Megaphone, Newspaper, MessagesSquare, Sunrise, Briefcase, Target, KanbanSquare, CalendarClock, Timer, FlaskConical, CircleDollarSign, CalendarRange, Library, MessageCircle, Workflow,
  Activity, Building2, Mail, Inbox, Tags, Wallet, Globe, MonitorSmartphone, MailOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useContagemDeMensagensProntas } from "@/hooks/useMensagensDaSemana";
import aceleriqLogo from "@/assets/logo-aceleriq-256.png";
import MobileBottomNav, { destinosDaBarra, type DestinoDoCelular } from "@/components/MobileBottomNav";
import { rotuloDoLugar } from "@/lib/navegacao/lugares";
import BuscaDoPainel, { type PaginaDaBusca } from "@/components/casca/BuscaDoPainel";
import { semItensOcultos } from "@/lib/navegacao/itensOcultosDoMenu";
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
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-10 md:w-10 xl:h-11 xl:w-11"
    >
      <RefreshCw className="w-4 h-4" />
      <span aria-hidden="true" className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
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
  if (melhor) return melhor.url === "/comercial" ? "Comercial" : melhor.url === "/freela" ? "Freela" : melhor.title;
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
  /** Só o admin enxerga (decisão que só o dono toma). */
  soAdmin?: boolean;
  /** Número ao lado do nome (ex.: mensagens prontas para aprovar). */
  contador?: number;
}

// 14/11/2026: o que não se usa sai do menu por uma lista só
// (src/lib/navegacao/itensOcultosDoMenu.ts). As quatro listas abaixo passam
// pela mesma peneira, e delas saem o menu do computador, a folha "Mais" do
// celular e a busca: o item escondido não reaparece em nenhuma saída. A rota
// continua viva em App.tsx; para o item voltar, basta tirá-lo daquela lista.
const adminMainNav: NavItem[] = semItensOcultos([
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  { title: "Kanban", url: "/kanban", icon: Columns3 },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Clientes", url: "/clientes", icon: Users },
]);

// O menu "mais" agrupado por tema: 18 itens numa lista corrida obrigavam a
// ler tudo para achar qualquer coisa. Os grupos seguem a pergunta de quem
// procura: "onde opero a semana", "onde vejo resultado", "onde administro".
// O Quiz saiu do menu (a rota continua viva para quem tem o link): era uma
// ferramenta pontual ocupando espaço de todo dia.
const adminMoreGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    // 26/10 (dono: "mais enxuto, mais direto"): a área de agentes no topo, começando pelo Hoje
    // (um resumo por dia, destino do aviso diário do sino).
    label: "Agentes",
    items: [
      { title: "Hoje", url: "/hoje", icon: Sunrise },
      { title: "Execução da equipe", url: "/execucao", icon: Bot },
      // 18/11/2026: Escritório dos agentes (organograma, conversas entre agentes, salas, automações, acessos e regras).
      { title: "Escritório", url: "/escritorio", icon: Building2 },
      // 18/11/2026: Central de Skills e segundo cérebro para todos os agentes.
      { title: "Skills e cérebro", url: "/skills", icon: Library },
      // 19/11/2026: Central de Automações (n8n: fluxos, saúde, execuções e o botão ligar/desligar do dono).
      { title: "Automações", url: "/automacoes", icon: Workflow },
    ],
  },
  {
    // 18/11/2026 (dono: "está tudo misturado"): a conversa com os clientes ganhou área própria,
    // separada da produção da semana.
    label: "Clientes",
    items: [
      // 18/11: os grupos de WhatsApp dos clientes ao vivo (quem espera resposta, resumo do dia e a conversa).
      { title: "Grupos dos clientes", url: "/grupos", icon: MessageCircle },
      // 26/10: as mensagens dos rituais da semana, de todos os clientes, numa tela só (com o contador).
      { title: "Mensagens da semana", url: "/central/mensagens", icon: MessagesSquare, soAdmin: true },
      { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
      { title: "Briefings", url: "/briefings", icon: FileText },
    ],
  },
  {
    label: "Operação da semana",
    items: [
      { title: "Central", url: "/central", icon: HeartPulse, fimExato: true },
      { title: "Mesas", url: "/mesas", icon: LayoutGrid, soCriacao: true },
      // 17/10: o que cada agente sabe (o dono ensina e a pesquisa semanal complementa).
      { title: "Base dos agentes", url: "/base-dos-agentes", icon: GraduationCap, soCriacao: true },
      // Laboratório (19/10/2026): trabalhos avulsos com ou sem cliente (admin, gestor e design).
      { title: "Laboratório", url: "/laboratorio", icon: FlaskConical, soCriacao: true },
      { title: "Ciclo", url: "/ciclo", icon: Repeat },
      // 14/11/2026: linha do tempo das peças por cliente e por dia (só leitura).
      { title: "Esteira", url: "/esteira", icon: CalendarRange },
      { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
    ],
  },
  {
    label: "Resultados",
    items: [
      { title: "Métricas", url: "/metricas", icon: BarChart3 },
      // 26/10: o boletim do Hermes e as mudanças nas contas, com um aviso no sino por boletim.
      { title: "Anúncios hoje", url: "/anuncios/hoje", icon: Newspaper },
      { title: "Anúncios", url: "/anuncios", icon: Megaphone, fimExato: true },
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
      // 18/11: "CRM de vendas" (o funil da Aceleriq), para não confundir com o CRM vendido em Produtos.
      { title: "CRM de vendas", url: "/comercial/crm", icon: KanbanSquare, soGestao: true },
      { title: "Agenda", url: "/comercial/agenda", icon: CalendarClock, soGestao: true },
      { title: "Metas", url: "/comercial/metas", icon: Target, soGestao: true },
      { title: "Campanhas", url: "/comercial/campanhas", icon: Megaphone, soGestao: true },
      { title: "Marketing", url: "/comercial/marketing", icon: Sparkles, soGestao: true },
    ],
  },
  {
    // Mesa Freela (MVP): o canal de aquisição ao lado da agência. Área própria,
    // colada no Comercial; a mesma régua (só admin e manager) e a aba na URL.
    label: "Freela",
    items: [
      { title: "Contatos", url: "/freela", icon: Users, soGestao: true, fimExato: true },
      { title: "Propostas", url: "/freela/propostas", icon: FileSignature, soGestao: true },
      { title: "Projetos", url: "/freela/projetos", icon: Briefcase, soGestao: true },
      { title: "Caixa", url: "/freela/caixa", icon: CircleDollarSign, soGestao: true },
    ],
  },
  {
    // 18/11/2026 (dono: "separar a gestão de cada um"): o CRM vendido tem a sua área, cada aba
    // da tela /produto/crm com a sua entrada.
    label: "Produto CRM",
    items: [
      { title: "Visão geral", url: "/produto/crm", icon: Activity, soAdmin: true, fimExato: true },
      { title: "Empresas", url: "/produto/crm/empresas", icon: Building2, soAdmin: true },
      { title: "Planos e preços", url: "/produto/crm/precos", icon: Tags, soAdmin: true },
      { title: "Faturamento", url: "/produto/crm/faturamento", icon: Wallet, soAdmin: true },
      // 19/11/2026: o link de entrada de cada cliente, quem já entrou e os convites (CRM e e-mail).
      { title: "Acessos dos clientes", url: "/produto/acessos", icon: KeyRound, soAdmin: true, fimExato: true },
    ],
  },
  {
    // 18/11/2026: o e-mail profissional à parte do CRM (tela /produto/email).
    label: "Produto E-mail",
    items: [
      { title: "Central", url: "/produto/email", icon: HeartPulse, soAdmin: true, fimExato: true },
      { title: "Entradas e migrações", url: "/produto/email/entradas", icon: Mail, soAdmin: true },
      { title: "Caixa da Aceleriq", url: "/produto/email/caixa", icon: Inbox, soAdmin: true },
      // 19/11/2026: entrar numa caixa (da Aceleriq ou de um cliente) com a senha e ver como o cliente vê.
      { title: "Minha caixa", url: "/produto/acessos/caixa", icon: MailOpen, soAdmin: true },
      { title: "Preços", url: "/produto/email/precos", icon: Tags, soAdmin: true },
    ],
  },
  {
    // 19/11/2026: domínios e sites dos clientes num lugar só (tela /produto/dominios).
    label: "Domínios e sites",
    items: [
      { title: "Domínios", url: "/produto/dominios", icon: Globe, soAdmin: true, fimExato: true },
      { title: "Sites", url: "/produto/dominios/sites", icon: MonitorSmartphone, soAdmin: true },
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
      items: semItensOcultos(grupo.items).filter((item) => (podeGestao || !item.soGestao) && (podeCriacao || !item.soCriacao)),
    }))
    .filter((grupo) => grupo.items.length > 0);

/**
 * Barra do topo de 768 a 1023 px (notebook estreito, tablet deitado): cabem
 * só os primeiros links; o resto entra no "...". Prioridade do lado direito:
 * avatar sempre; lançador, sino, busca (ícone) e o indicador de gerações
 * ficam; o tema vai para o menu do perfil. De 1024 para cima, tudo na barra.
 */
const LINKS_NO_TOPO_ESTREITO = 3;
const LINKS_NO_TOPO_MEDIO = 5;

/**
 * B2 (15/11/2026): as pílulas do menu do topo. A ativa é o VERDE VIVO da marca com letra quase preta
 * (o contraste se resolve na letra, nunca apagando o verde); a parada é a pílula de cartão.
 */
const PILULA_ATIVA_DO_TOPO = "bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_hsl(var(--primary)/0.7)]";
const PILULA_PARADA_DO_TOPO = "border border-border bg-card text-muted-foreground shadow-card hover:border-foreground/20 hover:text-foreground";
const LINHA_DO_MAIS_DO_TOPO = "group flex h-10 min-w-0 items-center rounded-full pl-1.5 pr-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LINHA_ATIVA_DO_MAIS = "bg-primary font-medium text-primary-foreground";
const LINHA_PARADA_DO_MAIS = "text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * v4 (15/11/2026): atalhos do trilho lateral do computador largo. Só URLs: o item (nome, ícone,
 * regra de papel, contador) vem do menu de verdade; URL que o papel não enxerga simplesmente não aparece.
 */
const ATALHOS_DO_TRILHO_DA_EQUIPE: Array<{ label: string; urls: string[] }> = [
  { label: "Dia a dia", urls: ["/hoje", "/central", "/mesas", "/esteira", "/ciclo", "/aprovacoes"] },
  { label: "Resultado e gestão", urls: ["/metricas", "/anuncios", "/comercial", "/financeiro", "/equipe"] },
  { label: "Sistema", urls: ["/workspace", "/config"] },
];
const ATALHOS_DO_TRILHO_DO_CLIENTE: Array<{ label: string; urls: string[] }> = [
  { label: "Meu espaço", urls: ["/aprovacoes", "/pedidos", "/financeiro", "/cofre"] },
  { label: "Mais", urls: ["/membros", "/novidades", "/perfil"] },
];

const clientMainNav: NavItem[] = semItensOcultos([
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Onde Estamos", url: "/onde-estamos", icon: HeartPulse },
  { title: "Projetos", url: "/projetos", icon: FolderOpen },
  // 05/11/2026 (dono): tudo o que a Aceleriq entrega fica documentado aqui; escondido em "Mais", parecia que tinha sumido.
  { title: "Documentos", url: "/documentos", icon: FileText },
  { title: "Agenda", url: "/calendario", icon: CalendarDays },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
]);

const clientMoreNav: NavItem[] = semItensOcultos([
  // 13/11/2026: o produto CRM e E-mail é um lugar à parte; daqui o cliente entra nele.
  { title: "CRM e E-mail", url: "/app", icon: Boxes },
  { title: "Área de membros", url: "/membros", icon: BookOpen },
  { title: "Novidades", url: "/novidades", icon: Sparkles },
  { title: "Cofre", url: "/cofre", icon: KeyRound },
  { title: "Aprovações", url: "/aprovacoes", icon: CheckSquare },
  { title: "Pedidos", url: "/pedidos", icon: ShoppingBag },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Perfil", url: "/perfil", icon: UserCircle },
]);

/**
 * O menu de um papel, já peneirado: os links da barra, os grupos do "mais" da
 * equipe e a lista do "mais". É daqui que saem o menu do computador, a folha
 * "Mais" do celular e a busca de página. Função pura, exportada para os
 * testes conferirem o menu montado.
 */
export function menuDoPapel(role: string): { principal: NavItem[]; grupos: Array<{ label: string; items: NavItem[] }>; mais: NavItem[] } {
  const isAdmin = role === "admin";
  if (!isAdmin && !["design", "traffic", "manager"].includes(role)) {
    return { principal: clientMainNav, grupos: [], mais: clientMoreNav };
  }
  const podeGestao = isAdmin || role === "manager";
  // 26/10: item só do admin (soAdmin).
  const grupos = gruposPorPapel(podeGestao, podeGestao || role === "design")
    .map((grupo) => ({ ...grupo, items: grupo.items.filter((item) => isAdmin || !item.soAdmin) }))
    .filter((grupo) => grupo.items.length > 0);
  return { principal: adminMainNav, grupos, mais: grupos.flatMap((grupo) => grupo.items) };
}

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
  const mensagensProntas = useContagemDeMensagensProntas();
  // O menu do papel (menuDoPapel) mais o contador das mensagens prontas (26/10).
  const menu = menuDoPapel(role);
  const gruposDoMenu = menu.grupos.map((grupo) => ({
    ...grupo,
    items: grupo.items.map((item) => (item.url === "/central/mensagens" ? { ...item, contador: mensagensProntas } : item)),
  }));
  const mainNav = menu.principal;
  const moreNav = isAdminOrTeam
    ? gruposDoMenu.flatMap((grupo) => grupo.items)
    : menu.mais;
  // v4: trilho lateral. Sai do MESMO menu já peneirado (papel e itens ocultos): só entra o que o
  // papel enxerga, na ordem desta lista, em até três pílulas (dia a dia, resultado e gestão, sistema).
  const trilho = (isAdminOrTeam ? ATALHOS_DO_TRILHO_DA_EQUIPE : ATALHOS_DO_TRILHO_DO_CLIENTE)
    .map((grupo) => ({
      label: grupo.label,
      items: grupo.urls
        .map((url) => moreNav.find((item) => item.url === url))
        .filter((item): item is NavItem => !!item),
    }))
    .filter((grupo) => grupo.items.length > 0);
  // B2: a tela aberta mora no "Mais"? (o item de URL mais longa que casa com a rota, e nenhum link da barra casa)
  const rotaAtual = (location.pathname || "/").replace(/\/+$/, "") || "/";
  const casaComARota = (item: NavItem) => rotaAtual === item.url || (!item.fimExato && rotaAtual.indexOf(`${item.url}/`) === 0);
  const ativoNoMais: NavItem | null = mainNav.some(casaComARota)
    ? null
    : moreNav.filter(casaComARota).sort((a, b) => b.url.length - a.url.length)[0] || null;
  const IconeDoMais = ativoNoMais ? ativoNoMais.icon : LayoutGrid;
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
    // No computador quem rola é a janela (hotfix): também volta ao topo.
    if (window.scrollY > 0) window.scrollTo(0, 0);
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
  const linhaDoMais = "flex h-11 w-full min-w-0 items-center rounded-full px-3.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="min-h-screen bg-background tech-grid-bg" data-tour="welcome">
      {/* Floating TopNav. data-casca: o modo foco (src/lib/modoFoco.ts + index.css) esconde a barra, o que flutua e tira o recuo do conteúdo. */}
      {/* Só de 768 px para cima (16/10/2026): o celular tem o topo enxuto logo abaixo. */}
      {!celular && <nav data-casca="topo" data-topo-em-pilulas="" className="fixed inset-x-0 top-0 z-50 bg-background/85 text-foreground backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* B2 (15/11/2026, dono: "menu do topo idêntico à referência"): sem barra em volta. Logo, cada link na sua
            pílula (a ativa é o verde vivo com letra escura), a busca em pílula e os ícones em círculos, direto no fundo. */}
        <div className="relative mx-auto grid h-[76px] w-full max-w-[1840px] grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 px-6 xl:gap-3">
        {/* Clip the square bitmap's transparent padding to the navbar so it
            cannot intercept clicks on the page below. Keep menus unclipped. */}
        {/* v4: três colunas (logo | links | ícones). Os links ficam parados no centro mesmo
            quando o lado direito ganha ou perde um ícone (cronômetro, gerações, versão nova). */}
        <NavLink to="/dashboard" aria-label="Aceleriq: início" className="-ml-3 flex h-[50px] w-[104px] min-w-0 items-center overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:mr-1">
          <img src={aceleriqLogo} alt="Aceleriq" width={112} height={112} decoding="async" className="logo-do-topo h-28 w-28 max-w-none shrink-0" />
        </NavLink>

        {/* Center: Nav links (desktop) */}
        {/* De 768 a 1023 cabem os LINKS_NO_TOPO_ESTREITO primeiros; o resto vai para o "..." (sem corte nem rolagem lateral). */}
        <div className="hidden md:flex min-w-0 items-center gap-1 flex-1 justify-center">
          {/* B2: uma pílula por link (ícone + nome de 1280 px para cima); a ativa é o verde vivo da marca com letra escura. */}
          <div className="flex min-w-0 items-center [&>*+*]:ml-1.5 xl:[&>*+*]:ml-2" data-trilho-do-menu="">
          {mainNav.map((item, indice) => {
            const tourId = item.url.replace("/", "nav-");
            return (
              <NavLink
                key={item.url}
                to={item.url}
                data-tour={tourId}
                className={({ isActive }) => cn(
                  "relative inline-flex h-10 items-center whitespace-nowrap px-3 lg:px-3.5 text-[13px] font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:h-11 xl:px-4 xl:text-[14px]",
                  indice >= LINKS_NO_TOPO_ESTREITO && "hidden lg:inline-flex",
                  // B2: de 1024 a 1279 cabem 5 pílulas; a 6ª (cliente) entra no "Mais" só nessa faixa.
                  indice >= LINKS_NO_TOPO_MEDIO && "lg:max-xl:!hidden",
                  isActive ? PILULA_ATIVA_DO_TOPO : PILULA_PARADA_DO_TOPO
                )}
              >
                {() => (
                  <>
                    <item.icon className="mr-2 hidden h-4 w-4 shrink-0 desk:block" />
                    {item.title}
                  </>
                )}
              </NavLink>
            );
          })}

          {/* More dropdown */}
          <div ref={moreRef} data-tour="nav-more">
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-label="Mais páginas"
              aria-expanded={moreOpen}
              data-botao-mais-do-topo=""
              className={cn(
                "inline-flex h-10 max-w-[200px] items-center whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:px-3.5 xl:h-11 xl:px-4 xl:text-[14px]",
                ativoNoMais ? PILULA_ATIVA_DO_TOPO : moreOpen ? "bg-foreground text-background" : PILULA_PARADA_DO_TOPO,
              )}
            >
              {/* Quando a tela aberta mora no "Mais", a pílula verde leva o nome dela: sempre há um item aceso no topo. */}
              <IconeDoMais className="mr-2 hidden h-4 w-4 shrink-0 desk:block" />
              <span className="min-w-0 truncate">{ativoNoMais ? ativoNoMais.title : "Mais"}</span>
              <ChevronDown className={cn("ml-1.5 h-3.5 w-3.5 shrink-0 transition-transform duration-200", moreOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {moreOpen && (
              <div
                data-painel-do-mais=""
                className={cn(
                  "absolute left-6 top-full -mt-1 max-h-[80vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-3 shadow-pop animate-fade-in",
                  isAdminOrTeam ? "w-[min(1080px,calc(100%-3rem))]" : "w-72",
                )}
                style={{ transformOrigin: 'top left' }}
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
                          LINHA_DO_MAIS_DO_TOPO,
                          isActive ? LINHA_ATIVA_DO_MAIS : LINHA_PARADA_DO_MAIS
                        )}
                      >
                        <span aria-hidden="true" className="mr-2.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground group-aria-[current=page]:bg-black/10 group-aria-[current=page]:text-inherit"><item.icon className="h-3.5 w-3.5" /></span>
                        {item.title}
                      </NavLink>
                    ))}
                  </div>
                )}
                {mainNav.length > LINKS_NO_TOPO_MEDIO && (
                  <div className="mb-1 hidden border-b border-border pb-1 lg:max-xl:block" data-links-que-nao-couberam="medio">
                    {mainNav.slice(LINKS_NO_TOPO_MEDIO).map((item) => (
                      <NavLink key={item.url} to={item.url} onClick={() => setMoreOpen(false)} className={({ isActive }) => cn(LINHA_DO_MAIS_DO_TOPO, isActive ? LINHA_ATIVA_DO_MAIS : LINHA_PARADA_DO_MAIS)}>
                        <span aria-hidden="true" className="mr-2.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground group-aria-[current=page]:bg-black/10 group-aria-[current=page]:text-inherit"><item.icon className="h-3.5 w-3.5" /></span>
                        {item.title}
                      </NavLink>
                    ))}
                  </div>
                )}
                {/* Cliente não tem grupos: a lista dele é curta e direta. */}
                {isAdminOrTeam ? (
                  <div className="columns-2 gap-3 lg:columns-3 xl:columns-4" data-grupos-do-mais="">
                  {gruposDoMenu.map((group) => (
                    <div key={group.label} className="mb-3 break-inside-avoid rounded-md bg-muted/50 p-1.5">
                      <p className="px-2.5 pb-1.5 pt-1.5 text-[12px] font-semibold text-foreground">
                        {group.label}
                      </p>
                      {group.items.map((item) => (
                        <NavLink
                          key={item.url}
                          to={item.url}
                          end={item.fimExato}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) => cn(
                            LINHA_DO_MAIS_DO_TOPO,
                            isActive ? LINHA_ATIVA_DO_MAIS : LINHA_PARADA_DO_MAIS
                          )}
                        >
                          <span aria-hidden="true" className="mr-2.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground group-aria-[current=page]:bg-black/10 group-aria-[current=page]:text-inherit"><item.icon className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0 truncate">{item.title}</span>
                          {item.contador ? <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold tabular-nums text-background" aria-label={`${item.contador} para aprovar`}>{item.contador}</span> : null}
                        </NavLink>
                      ))}
                    </div>
                  ))}
                  </div>
                ) : (
                  moreNav.map((item) => (
                    <NavLink
                      key={item.url}
                      to={item.url}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) => cn(
                        LINHA_DO_MAIS_DO_TOPO,
                        isActive ? LINHA_ATIVA_DO_MAIS : LINHA_PARADA_DO_MAIS
                      )}
                    >
                      <span aria-hidden="true" className="mr-2.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground group-aria-[current=page]:bg-black/10 group-aria-[current=page]:text-inherit"><item.icon className="h-3.5 w-3.5" /></span>
                      {item.title}
                    </NavLink>
                  ))
                )}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Right: Icons */}
        <div className="col-start-3 flex min-w-0 items-center justify-end gap-1.5 xl:gap-2" data-direita-do-topo="">
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
            data-busca-do-topo=""
            className={cn(
              "group order-first hidden h-10 items-center rounded-full border border-border bg-card p-1 text-foreground shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex xl:h-11",
              // Com largura vira a pílula "Buscar página" (o cliente tem um link a mais na barra: só de 1600 px para cima).
              isAdminOrTeam ? "desk:ml-2 desk:mr-auto desk:max-w-[260px] desk:flex-1" : "min-[1600px]:ml-2 min-[1600px]:mr-auto min-[1600px]:max-w-[260px] min-[1600px]:flex-1",
            )}
          >
            {/* Como na referência: a lupa num círculo e, com largura, o convite ao lado. */}
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-foreground group-hover:text-background xl:h-9 xl:w-9"><Search className="h-4 w-4" /></span>
            <span aria-hidden="true" className={cn("ml-2.5 hidden min-w-0 flex-1 truncate text-left text-[13px] text-muted-foreground", isAdminOrTeam ? "desk:block" : "min-[1600px]:block")}>Buscar página</span>
            <kbd aria-hidden="true" className={cn("mr-2 hidden shrink-0 rounded-full bg-muted px-2 py-0.5 font-outfit text-[11px] font-medium text-muted-foreground", isAdminOrTeam ? "min-[1560px]:block" : "min-[1600px]:block")}>Ctrl K</kbd>
          </button>
          {/* Lançador (768 px para cima): agente, ajuda da tela, tour e atalhos na barra, nunca flutuando. Cliente: o "?". */}
          <Lancador variante="topo" className="hidden md:block" {...propsDoLancador} />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            data-prioridade-no-topo="tema"
className="w-8 h-8 flex md:hidden lg:flex items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card hover:bg-foreground hover:text-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring !h-10 !w-10 shrink-0 xl:!h-11 xl:!w-11"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            data-tour="nav-notifications"
            aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
            className="relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card transition-colors hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex xl:h-11 xl:w-11"
            onClick={() => setNotifOpen(true)}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center px-1 tabular-nums ring-2 ring-background">
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
              className="flex shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="h-10 w-10 cursor-pointer xl:h-11 xl:w-11">
                <AvatarFallback className="bg-primary text-primary-foreground text-[13px] font-semibold">
                  {profile?.full_name?.split(" ").map(n => n[0]).join("").slice(0,2)}
                </AvatarFallback>
              </Avatar>
            </button>
            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-56 rounded-lg bg-popover border border-border p-2 shadow-pop animate-fade-in">
                <div className="px-3 py-2 border-b border-border mb-1">
                  <p className="text-[12px] font-medium text-foreground">{profile?.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{papelLegivel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); navigate("/perfil"); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <UserCircle className="w-3.5 h-3.5" />
                  Meu perfil
                </button>
                {/* 768 a 1023: o tema sai da barra e mora aqui. */}
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); toggleTheme(); }}
                  data-tema-no-menu=""
                  className="hidden md:flex lg:hidden items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  {theme === "dark" ? "Tema claro" : "Tema escuro"}
                </button>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair
                </button>
              </div>
            )}
          </div>

          {/* Fim da direita. O menu do celular mora na folha "Mais" da barra de baixo (16/10/2026). */}
        </div>
        </div>
      </nav>}

      {/* v4: trilho lateral de atalhos (computador largo, 1440 x 720 para cima; ver index.css).
          Pílulas verticais flutuantes com os lugares de todo dia que ficavam atrás do "...":
          o mesmo menu, já peneirado pelo papel. O ativo é o círculo de tinta. */}
      {!celular && trilho.length > 0 && (
        <aside data-casca="topo" data-trilho-lateral="" aria-label="Atalhos" className="fixed left-6 z-40 flex-col" style={{ top: "calc(env(safe-area-inset-top) + 96px)" }}>
          {trilho.map((grupo, g) => (
            <nav key={grupo.label} aria-label={grupo.label} className={cn("flex flex-col items-center rounded-full border border-border bg-card p-1.5 shadow-card [&>*+*]:mt-1", g > 0 && "mt-3")}>
              {grupo.items.map((item) => (
                <NavLink
                  key={item.url}
                  to={item.url}
                  end={item.fimExato}
                  title={item.title}
                  aria-label={item.title}
                  className={({ isActive }) => cn(
                    "relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.contador ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-bold tabular-nums text-background ring-2 ring-card">{item.contador > 9 ? "9+" : item.contador}</span> : null}
                </NavLink>
              ))}
            </nav>
          ))}
        </aside>
      )}

      {/* Topo do celular (16/10/2026, dono: "cara de aplicativo, mais clean"): barra
          cheia, colada no alto, na cor do tema. Esquerda: voltar (quando há para onde)
          e a logo, que vira o nome da tela quando o título da página sai de vista ao
          rolar. Direita: só o que é de agora (gerações, versão nova), a busca e o sino.
          Menu, perfil, tema, Studio e ajuda ficam na folha "Mais" (barra de baixo). */}
      {celular && (
        <header
          data-casca="topo"
          data-topo-do-celular=""
          className="fixed inset-x-0 top-0 z-40 bg-background md:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="flex h-[52px] min-w-0 items-center px-2">
            {isAdminOrTeam && <VoltarParaOndeEstava compacto />}
            <div className="relative ml-2 h-full min-w-0 flex-1">
              <div
                aria-hidden={rolou ? "true" : undefined}
                className={cn("absolute inset-0 flex items-center overflow-hidden transition-opacity duration-200", rolou ? "opacity-0" : "opacity-100")}
              >
                <img src={aceleriqLogo} alt="Aceleriq" width={96} height={96} decoding="async" className="logo-do-topo -ml-2 h-24 w-24 max-w-none shrink-0" />
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
                className="toque-compacto ml-1.5 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => setNotifOpen(true)}
                aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
                className="toque-compacto relative ml-1.5 mr-1 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground ring-2 ring-background">
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
          "fixed inset-x-0 top-[calc(env(safe-area-inset-top)+52px)] bottom-[calc(env(safe-area-inset-bottom)+56px)] z-0 mx-auto w-full overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 md:static md:px-6 md:pt-[calc(env(safe-area-inset-top)+88px)] md:pb-[calc(env(safe-area-inset-bottom)+96px)] md:overflow-visible",
          // Tela larga em todas as páginas, igual às mesas: com 1280/1400 px o painel
          // ficava espremido com espaço vazio dos lados (dono, 23/09 e 26/09).
          // Hotfix 15/11: a janela volta a rolar no computador (o <main> como rolador
          // empurrava os sticky da Mesa 88 px para baixo e espremia a tela).
          "max-w-[1840px]",
        )}
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        data-tour="finish"
        data-casca="conteudo"
        data-com-trilho={!celular && trilho.length > 0 ? "" : undefined}
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

import { matchPath } from "react-router-dom";
import { preCarregarMesa } from "@/lib/mesa/preCarga";
import { redeEconomica } from "@/lib/lazyComPreCarga";
import { safeStorage } from "@/lib/safeStorage";

/**
 * O código da tela começa a baixar junto com o login (PERF-B06, 30/09/2026).
 *
 * Antes eram três passos em fila: o arquivo principal, depois a sessão e o
 * perfil (0,2 a 0,3 s daqui até o Supabase, e até 8 s com o token vencido), e
 * só então o código da tela (100 a 270 KB comprimidos). Agora, assim que o
 * arquivo principal roda, a tela do endereço já começa a baixar em paralelo.
 *
 * São os mesmos import() das rotas do App.tsx: o navegador baixa o arquivo uma
 * vez só e o lazy() da rota encontra o módulo pronto. O teste
 * src/test/pre-carga-do-boot.test.tsx confere que os caminhos batem.
 *
 * Nunca decide o que a pessoa vê: só adianta o download. A tela continua
 * decidida pela sessão e pelo perfil vindos do servidor.
 */

type Carregar = () => Promise<unknown>;

/** Links públicos por token: abrem sem esperar o login (AppRoutes). */
const PAGINAS_PUBLICAS: Record<string, Carregar> = {
  "/briefing/:token": () => import("@/pages/BriefingPublic"),
  "/contrato/:token": () => import("@/pages/ContractPublic"),
  "/marca/:token": () => import("@/pages/BrandbookPublico"),
  "/nomes/:token": () => import("@/pages/VotacaoDeNomes"),
  "/proposta/:token": () => import("@/pages/PropostaPublica"),
  "/inbox/:token": () => import("@/pages/WorkspaceInboxPublic"),
  "/quiz/:token": () => import("@/pages/QuizPublicPage"),
};

export const ROTAS_PUBLICAS_POR_TOKEN: readonly string[] = Object.keys(PAGINAS_PUBLICAS);

/** O endereço é um link público por token (contrato, briefing, proposta...)? */
export function rotaPublicaPorToken(pathname: string): boolean {
  return paginaPublica(pathname) !== null;
}

function paginaPublica(pathname: string): Carregar | null {
  for (const padrao of ROTAS_PUBLICAS_POR_TOKEN) {
    if (matchPath(padrao, pathname)) return PAGINAS_PUBLICAS[padrao];
  }
  return null;
}

const carregarLogin: Carregar = () => import("@/pages/Login");

/**
 * Telas com login mais abertas direto pelo endereço (favorito, app instalado,
 * link no WhatsApp). "equipe" e "cliente" são as que dependem do papel; sem a
 * dica do papel guardada, nada baixa (baixar as duas seria desperdício).
 */
type TelaComLogin = { todos?: Carregar; equipe?: Carregar; cliente?: Carregar };

const PAINEL: TelaComLogin = {
  equipe: () => import("@/pages/AdminDashboard"),
  cliente: () => import("@/pages/ClientDashboard"),
};

const TELAS_COM_LOGIN: Record<string, TelaComLogin> = {
  "/": PAINEL,
  "/dashboard": PAINEL,
  "/pedidos": { equipe: () => import("@/pages/AdminRequests"), cliente: () => import("@/pages/ClientRequests") },
  "/aprovacoes": { equipe: () => import("@/pages/AdminApprovals"), cliente: () => import("@/pages/ClientApprovals") },
  "/relatorios": { equipe: () => import("@/pages/AdminReports"), cliente: () => import("@/pages/ClientReports") },
  "/financeiro": { equipe: () => import("@/pages/AdminFinanceiro"), cliente: () => import("@/pages/ClientFinanceiro") },
  "/ciclo": { equipe: () => import("@/pages/AdminEsteira") },
  "/kanban": { equipe: () => import("@/pages/Kanban") },
  "/execucao": { equipe: () => import("@/pages/AdminExecucao") },
  "/clientes": { equipe: () => import("@/pages/Clients") },
  "/central": { equipe: () => import("@/pages/AdminExperience") },
  "/projetos": { todos: () => import("@/pages/Projects") },
  "/calendario": { todos: () => import("@/pages/EditorialCalendar") },
  "/onde-estamos": { todos: () => import("@/pages/ClientJourneyUpdates") },
};

/** Onde o Supabase guarda a sessão neste navegador (mesma regra do supabase-js). */
function chaveDaSessao(): string | null {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!url) return null;
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

/** Há sessão guardada? E de quem (para achar a dica do papel)? */
function sessaoGuardada(): { uid: string | null } | null {
  const chave = chaveDaSessao();
  if (!chave) return null;
  const bruto = safeStorage.get(chave);
  if (!bruto) return null;
  try {
    const sessao = JSON.parse(bruto) as { user?: { id?: unknown } } | null;
    const uid = sessao && sessao.user && typeof sessao.user.id === "string" ? sessao.user.id : null;
    return { uid };
  } catch {
    return { uid: null };
  }
}

/** Chave da dica do papel, gravada pelo AuthContext quando o perfil chega. */
export const chaveDoPapel = (uid: string) => `aceleriq:papel:${uid}`;

function papelGuardado(uid: string | null): string | null {
  if (!uid) return null;
  return safeStorage.get(chaveDoPapel(uid));
}

function ladoDoPapel(papel: string | null): "equipe" | "cliente" | null {
  if (papel === "client") return "cliente";
  if (papel === "admin" || papel === "manager" || papel === "design" || papel === "traffic") return "equipe";
  return null;
}

/** Os mesmos papéis que as rotas das mesas aceitam no App.tsx (a Proposta é mais estreita, mas é rara). */
const PAPEIS_DAS_MESAS = ["admin", "manager", "design"];

const baixar = (carregar: Carregar) => {
  // Falha aqui não derruba nada: a rota pede o mesmo arquivo quando abrir.
  carregar().catch(() => undefined);
};

export type PreCargaDoBoot = "publica" | "login" | "mesa" | "tela" | null;

/**
 * Chamada uma vez no boot (src/main.tsx), antes do primeiro desenho. Devolve
 * o que começou a baixar (para os testes).
 */
export function preCarregarTelaDoEndereco(
  local: { pathname: string; search: string } = window.location,
): PreCargaDoBoot {
  try {
    const pathname = (local.pathname || "/").replace(/\/+$/, "") || "/";

    // O que a pessoa com certeza vai ver: baixa mesmo em rede econômica.
    const publica = paginaPublica(pathname);
    if (publica) {
      baixar(publica);
      return "publica";
    }
    if (pathname === "/login") {
      baixar(carregarLogin);
      return "login";
    }

    const ehMesa = /^\/mesa(-[a-z]+)?$/.test(pathname);
    const tela = TELAS_COM_LOGIN[pathname];
    if (!ehMesa && !tela) return null;

    const sessao = sessaoGuardada();
    // Sem sessão guardada, a rota protegida manda para o /login.
    if (!sessao) {
      baixar(carregarLogin);
      return "login";
    }

    // Daqui para baixo é adiantamento que pode não ser usado: respeita a
    // economia de dados, como a pré-carga ociosa das mesas.
    if (redeEconomica()) return null;
    const papel = papelGuardado(sessao.uid);

    if (ehMesa) {
      if (!papel || PAPEIS_DAS_MESAS.indexOf(papel) < 0) return null;
      preCarregarMesa(pathname + (local.search || ""));
      return "mesa";
    }
    const lado = ladoDoPapel(papel);
    const carregar = tela.todos || (lado ? tela[lado] : undefined);
    if (!carregar) return null;
    baixar(carregar);
    return "tela";
  } catch {
    return null;
  }
}

import { lazy, Profiler, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Route, Routes, UNSAFE_NavigationContext, UNSAFE_RouteContext, type Location, type To } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Carregando, botao, juntar } from "@/components/sistema";
import { ContainerDaArea } from "@/components/sistema/ContainerDaArea";
import {
  PaginaMesaAds, PaginaMesaDoCliente, PaginaMesaEdicao, PaginaMesaFoto, PaginaMesaIdentidade, PaginaMesaMotion,
  PaginaMesaProposta, PaginaMesaPublicidade, PaginaMesaRoteiros, PaginaMesaSite, PaginaMesaVideos, preCarregarMesa,
} from "@/lib/mesa/preCarga";

/**
 * Ferramenta do painel aberta DENTRO da Central, nativa (09/10/2026).
 *
 * Antes era um iframe com ?embutido=1: o app inteiro subia de novo dentro do
 * quadro (scripts, sessão, consultas, casca), cerca de 10 s para a Mesa do
 * Cliente na produção. Agora a própria página (o mesmo módulo das rotas,
 * src/lib/mesa/preCarga.ts) é renderizada na mesma árvore do React: mesma
 * sessão, mesmo cache do React Query, sem casca repetida.
 *
 * Roteador em memória: a página lê ?client= e troca de etapa pelo endereço
 * dela, que mora aqui (não no endereço da Central). <Routes location> dá a
 * localização; o navegador próprio (NavigationContext) segura push/replace,
 * e o RouteContext zerado faz as rotas casarem a partir da raiz (a Central
 * está dentro da rota /execucao).
 */

type Pagina = ComponentType<Record<string, never>>;

const Workspace = lazy(() => import("@/pages/Workspace"));
const Kanban = lazy(() => import("@/pages/Kanban"));
const EditorialCalendar = lazy(() => import("@/pages/EditorialCalendar"));
const AdminFiles = lazy(() => import("@/pages/AdminFiles"));
const Clients = lazy(() => import("@/pages/Clients"));
const Projects = lazy(() => import("@/pages/Projects"));
const AdminComercial = lazy(() => import("@/pages/AdminComercial"));

/** As rotas que abrem dentro da Central (o resto abre em aba nova). */
export const ROTAS_NATIVAS: Array<{ caminho: string; Pagina: Pagina }> = [
  { caminho: "/mesa", Pagina: PaginaMesaDoCliente as unknown as Pagina },
  { caminho: "/mesa-ads", Pagina: PaginaMesaAds as unknown as Pagina },
  { caminho: "/mesa-foto", Pagina: PaginaMesaFoto as unknown as Pagina },
  { caminho: "/mesa-videos", Pagina: PaginaMesaVideos as unknown as Pagina },
  { caminho: "/mesa-edicao", Pagina: PaginaMesaEdicao as unknown as Pagina },
  { caminho: "/mesa-publicidade", Pagina: PaginaMesaPublicidade as unknown as Pagina },
  { caminho: "/mesa-roteiros", Pagina: PaginaMesaRoteiros as unknown as Pagina },
  { caminho: "/mesa-identidade", Pagina: PaginaMesaIdentidade as unknown as Pagina },
  { caminho: "/mesa-proposta", Pagina: PaginaMesaProposta as unknown as Pagina },
  { caminho: "/mesa-site", Pagina: PaginaMesaSite as unknown as Pagina },
  { caminho: "/mesa-motion", Pagina: PaginaMesaMotion as unknown as Pagina },
  { caminho: "/workspace", Pagina: Workspace as unknown as Pagina },
  { caminho: "/kanban", Pagina: Kanban as unknown as Pagina },
  { caminho: "/calendario", Pagina: EditorialCalendar as unknown as Pagina },
  { caminho: "/arquivos", Pagina: AdminFiles as unknown as Pagina },
  { caminho: "/clientes", Pagina: Clients as unknown as Pagina },
  { caminho: "/projetos", Pagina: Projects as unknown as Pagina },
  { caminho: "/comercial/:aba", Pagina: AdminComercial as unknown as Pagina },
];

/** O caminho abre nativo na Central? (mesmo critério do roteador abaixo). */
export function abreNativo(caminho: string): boolean {
  const p = caminho.split(/[?#]/)[0];
  return ROTAS_NATIVAS.some((r) => (r.caminho.includes(":") ? p.startsWith(r.caminho.split("/:")[0] + "/") : p === r.caminho));
}

/** Baixa o código da ferramenta antes do clique (mouse em cima do atalho). */
export function preCarregarFerramenta(caminho: string) {
  if (caminho.startsWith("/mesa")) { try { preCarregarMesa(caminho); } catch { /* pré-carga é só atalho */ } }
}

let contador = 0;
function localDe(to: To, atual: Location, state?: unknown): Location {
  const alvo = typeof to === "string" ? to : `${to.pathname || atual.pathname}${to.search || ""}${to.hash || ""}`;
  const base = new URL(atual.pathname + atual.search, "http://central.local");
  const u = new URL(alvo, base);
  contador += 1;
  return { pathname: u.pathname, search: u.search, hash: u.hash, state: state ?? null, key: `ferramenta-${contador}` };
}

/** Tempos de abertura (para achar o que é lento): window.__temposDaCentral e o console. */
export type TempoDeAbertura = { caminho: string; ateAparecer: number; renderizacao: number; quando: string };
function registrarTempo(t: TempoDeAbertura) {
  try {
    const w = window as unknown as { __temposDaCentral?: TempoDeAbertura[] };
    w.__temposDaCentral = [...(w.__temposDaCentral || []).slice(-30), t];
    console.info(`[Central] ${t.caminho} apareceu em ${t.ateAparecer} ms (render ${t.renderizacao} ms)`);
  } catch { /* medida é só diagnóstico */ }
}

function Aparecida({ aoAparecer }: { aoAparecer: () => void }) {
  useEffect(() => { aoAparecer(); }, [aoAparecer]);
  return null;
}

/**
 * A ferramenta nativa. `caminho` é o endereço inicial (com ?client=); a
 * navegação dentro dela fica aqui. `abertoEm` (performance.now do clique) mede
 * quanto demorou para aparecer.
 */
export default function FerramentaNativa({ caminho, abertoEm, aoMudarCaminho }: { caminho: string; abertoEm?: number; aoMudarCaminho?: (caminho: string) => void }) {
  const inicial = useMemo(() => localDe(caminho, { pathname: "/", search: "", hash: "", state: null, key: "raiz" }), [caminho]);
  const [pilha, setPilha] = useState<Location[]>([inicial]);
  const [indice, setIndice] = useState(0);
  const local = pilha[indice] || inicial;
  const atual = useRef(local);
  atual.current = local;
  const hospedeiro = useRef<HTMLDivElement>(null);
  const renderizou = useRef(0);
  const medido = useRef(false);

  useEffect(() => { aoMudarCaminho?.(`${local.pathname}${local.search}`); }, [local, aoMudarCaminho]);

  const navegacao = useMemo(() => ({
    basename: "",
    static: false,
    useTransitions: undefined,
    future: {},
    navigator: {
      createHref: (to: To) => (typeof to === "string" ? to : `${to.pathname || ""}${to.search || ""}${to.hash || ""}`),
      encodeLocation: (to: To) => { const l = localDe(to, atual.current); return { pathname: l.pathname, search: l.search, hash: l.hash }; },
      go: (n: number) => setIndice((i) => Math.max(0, Math.min(i + n, pilha.length - 1))),
      push: (to: To, state?: unknown) => {
        const novo = localDe(to, atual.current, state);
        setPilha((p) => [...p.slice(0, indice + 1), novo].slice(-30));
        setIndice((i) => Math.min(i + 1, 29));
      },
      replace: (to: To, state?: unknown) => {
        const novo = localDe(to, atual.current, state);
        setPilha((p) => p.map((x, k) => (k === indice ? novo : x)));
      },
    },
  }), [indice, pilha.length]);

  const aoAparecer = () => {
    if (medido.current) return;
    medido.current = true;
    const ms = Math.round(performance.now() - (abertoEm ?? performance.now()));
    // Um respiro para somar as renderizações da primeira montagem.
    window.setTimeout(() => registrarTempo({ caminho: local.pathname, ateAparecer: ms, renderizacao: Math.round(renderizou.current), quando: new Date().toISOString() }), 1500);
  };

  const conteudo: ReactNode = (
    <Routes location={local}>
      {ROTAS_NATIVAS.map(({ caminho: c, Pagina }) => (
        <Route key={c} path={c} element={<><Pagina /><Aparecida aoAparecer={aoAparecer} /></>} />
      ))}
      <Route path="*" element={<ForaDaCentral caminho={`${local.pathname}${local.search}`} />} />
    </Routes>
  );

  return (
    <div ref={hospedeiro} className="h-full min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-6 md:px-6" data-ferramenta-nativa="">
      <ContainerDaArea.Provider value={hospedeiro}>
        <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
          <UNSAFE_NavigationContext.Provider value={navegacao}>
            <Profiler id={caminho} onRender={(_id, _fase, duracao) => { renderizou.current += duracao; }}>
              <Suspense fallback={<div className="pt-4"><Carregando linhas={5} rotulo="Abrindo a ferramenta" /></div>}>{conteudo}</Suspense>
            </Profiler>
          </UNSAFE_NavigationContext.Provider>
        </UNSAFE_RouteContext.Provider>
      </ContainerDaArea.Provider>
    </div>
  );
}

/** Endereço que não abre dentro da Central: o painel abre em aba nova (nada some da conversa). */
function ForaDaCentral({ caminho }: { caminho: string }) {
  return (
    <div className="flex flex-col items-start gap-2 py-6 text-[13px]">
      <p className="text-muted-foreground">Esta parte do painel abre fora da Central.</p>
      <a href={caminho} target="_blank" rel="noreferrer" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Abrir em aba nova</a>
    </div>
  );
}

import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Brush, FolderOpen, Home, Maximize2, Minimize2, Palette, Workflow } from "lucide-react";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import Etapas, { type ItemDeEtapa } from "@/components/sistema/Etapas";
import { Carregando } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, espaco, juntar, larguraDaMesa } from "@/components/sistema/estilos";
import { useModoFoco } from "@/lib/modoFoco";
import { useSemRolagemDaPagina } from "@/lib/laboratorio/semRolagemDaPagina";
import { useClientesDoLab } from "@/components/laboratorio/Seletores";
import { ChipDeCreditos } from "@/components/laboratorio/CreditosDoLab";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import "@/components/laboratorio/telaCheiaDoLab.css";

/**
 * Laboratório (/laboratorio, só equipe de criação: admin, gestor e design),
 * 19/10/2026. Área livre para trabalhos avulsos, com ou sem cliente, com a
 * inteligência das mesas (contrato em Aceleriq-Laboratorio/ESPEC-LABORATORIO.md):
 *
 * - Início: uma caixa de pedido (vira projeto no canvas), fluxos e recentes.
 * - Projetos: canvas de nós com agente do projeto, Rodar com custo antes.
 * - Estúdio livre: arte rápida e carrossel (frente própria, estudio-livre/).
 * - Logos: variações de logo com a escolha do Jev.
 * - Arquivos: o workspace global em "Laboratório".
 *
 * Cliente é opcional: "Livre" usa a carteira da agência. Com cliente, usa a
 * marca e a carteira dele, mas o resultado fica aqui e não vai para a Mesa.
 * Endereço: /laboratorio?aba=projetos&projeto=<id>
 *
 * Tela cheia (v2, 20/10/2026): em TODAS as abas, um botão só ícone liga o
 * modo foco (src/lib/modoFoco.ts: some a casca do painel) e a área ocupa a
 * janela inteira; no canvas, o próprio editor cobre a janela. Esc sai.
 * 21/10: a casca some em qualquer largura (telaCheiaDoLab.css; antes o topo e
 * a barra de baixo do celular ficavam por cima) e a área segura do iPhone fica
 * de fora do conteúdo.
 */

// Mesma chave da pré-carga (src/lib/mesa/preCarga.ts, PaginaLaboratorio): a Início abre sem esqueleto.
const AbaInicio = lazyComPreCarga("laboratorio/inicio", () => import("@/components/laboratorio/AbaInicio"));
const AbaProjetos = lazy(() => import("@/components/laboratorio/AbaProjetos"));
const AbaLogos = lazy(() => import("@/components/laboratorio/AbaLogos"));
const AbaArquivos = lazy(() => import("@/components/laboratorio/AbaArquivos"));
const EstudioLivre = lazy(() => import("@/components/laboratorio/estudio-livre/EstudioLivre"));

export const ABAS_DO_LABORATORIO = [
  { valor: "inicio", rotulo: "Início" },
  { valor: "projetos", rotulo: "Projetos" },
  { valor: "estudio", rotulo: "Estúdio livre" },
  { valor: "logos", rotulo: "Logos" },
  { valor: "arquivos", rotulo: "Arquivos" },
] as const;

type Aba = (typeof ABAS_DO_LABORATORIO)[number]["valor"];

const ICONES: Record<Aba, JSX.Element> = {
  inicio: <Home className="h-4 w-4" />,
  projetos: <Workflow className="h-4 w-4" />,
  estudio: <Palette className="h-4 w-4" />,
  logos: <Brush className="h-4 w-4" />,
  arquivos: <FolderOpen className="h-4 w-4" />,
};

const AJUDAS: Record<Aba, string> = {
  inicio: "Escreva o pedido: o agente monta o projeto no canvas, sem gerar nada. Você confere e roda com o custo à vista.",
  projetos: "Cada projeto é um canvas de nós. Ligue os nós, ajuste no inspetor e rode um nó ou tudo, sempre vendo o custo antes.",
  estudio: "Arte rápida e carrossel sem passar pela Mesa do cliente.",
  logos: "Gera variações de logo; o Jev escolhe a melhor e explica por quê.",
  arquivos: "Tudo o que o Laboratório gera, em Livres ou na pasta do cliente.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Laboratorio() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba");
  const aba: Aba = ABAS_DO_LABORATORIO.some((a) => a.valor === abaUrl) ? (abaUrl as Aba) : "inicio";
  const projetoUrl = params.get("projeto");
  const projeto = projetoUrl && (UUID.test(projetoUrl) || /^[A-Za-z0-9_-]{1,64}$/.test(projetoUrl)) ? projetoUrl : null;
  const [clienteGuardado, setCliente] = useEstadoDaTela<string>("laboratorio:cliente", "");
  const clientes = useClientesDoLab();
  // Vindo do seletor de mesas (?client=<id>), abre com o cliente da outra mesa; senão, o último escolhido aqui.
  const clienteDaUrl = params.get("client");
  const clienteId = clienteDaUrl && UUID.test(clienteDaUrl) ? clienteDaUrl : clienteGuardado && UUID.test(clienteGuardado) ? clienteGuardado : null;
  const [cheia, setCheia] = useState(false);
  useModoFoco("laboratorio", cheia);
  useSemRolagemDaPagina(cheia);
  useEffect(() => {
    if (!cheia) return;
    const tecla = (e: KeyboardEvent) => {
      // O editor usa o Esc antes (sai primeiro do "canvas em tela cheia"); com janela aberta, o Esc é dela.
      if ((e.key === "Escape" || e.key === "Esc") && !e.defaultPrevented && !document.querySelector('[role="dialog"], [role="alertdialog"]')) setCheia(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cheia]);
  // Com um projeto aberto, o botão fica na barra do editor (o canvas cobre a janela).
  const noCanvas = aba === "projetos" && !!projeto;

  const ir = (nova: Aba, extra: Record<string, string | null> = {}) => {
    const p = new URLSearchParams(params);
    p.set("aba", nova);
    if (nova !== "projetos") p.delete("projeto");
    Object.keys(extra).forEach((k) => {
      const v = extra[k];
      if (v) p.set(k, v);
      else p.delete(k);
    });
    setParams(p);
  };
  const abrirProjeto = (id: string | null) => ir("projetos", { projeto: id });
  const mudarCliente = (id: string | null) => {
    setCliente(id || "");
    if (params.get("client")) {
      const p = new URLSearchParams(params);
      p.delete("client");
      setParams(p, { replace: true });
    }
  };

  const itens: ItemDeEtapa[] = ABAS_DO_LABORATORIO.map((a) => ({ valor: a.valor, rotulo: a.rotulo, icone: ICONES[a.valor], ajuda: AJUDAS[a.valor], dados: { "data-aba-do-lab": a.valor } }));

  return (
    <div
      className={juntar(cheia && !noCanvas ? "fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background px-4 py-3" : larguraDaMesa, espaco.pagina)}
      style={cheia && !noCanvas ? { paddingTop: "calc(env(safe-area-inset-top) + 12px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" } : undefined}
      data-pagina-laboratorio=""
      data-tela-cheia={cheia ? "" : undefined}
    >
      <CabecalhoDePagina
        titulo="Laboratório"
        ajuda="Trabalhos avulsos com ou sem cliente, com a inteligência das mesas. Nada gera sem o custo à vista e o seu confirmar; o que sai fica em Arquivos e não entra na Mesa do cliente."
        aoLado={<Etapas itens={itens} valor={aba} onEscolher={(v) => ir(v as Aba)} rotulo="Abas do Laboratório" soIcone />}
        acoes={
          <>
            {/* Créditos do Laboratório (20/10): carteira + saldo; abre a janela com carregar e extrato. */}
            <ChipDeCreditos />
            {noCanvas ? null : (
              <button type="button" className={botao.icone} onClick={() => setCheia(!cheia)} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"} title={cheia ? "Sair da tela cheia (Esc)" : "Tela cheia"} aria-pressed={cheia} data-tela-cheia-do-lab="">
                {cheia ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </>
        }
      />
      <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo" />}>
        {aba === "inicio" && <AbaInicio clienteId={clienteId} onCliente={mudarCliente} clientes={clientes} onAbrirProjeto={(id) => abrirProjeto(id)} />}
        {aba === "projetos" && <AbaProjetos projetoAberto={projeto} onAbrir={abrirProjeto} clienteId={clienteId} clientes={clientes} telaCheia={cheia} onTelaCheia={setCheia} />}
        {/* 19/10 (dono): o Estúdio começa Livre, sem o cliente lembrado das outras abas; o cliente se escolhe nele. */}
        {aba === "estudio" && <EstudioLivre />}
        {aba === "logos" && <AbaLogos clienteId={clienteId} onCliente={mudarCliente} clientes={clientes} onVerArquivos={() => ir("arquivos")} />}
        {aba === "arquivos" && <AbaArquivos />}
      </Suspense>
    </div>
  );
}

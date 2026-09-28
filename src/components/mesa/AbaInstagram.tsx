import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, CalendarDays, ChevronDown, Facebook, FolderOpen, Instagram, ListChecks, Plus, RefreshCw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AreaDeTrabalho, { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { gravarEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useQueryClient } from "@tanstack/react-query";
import { botao, juntar, superficie, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import PreviaDoPerfil, { ROTULO_DA_FONTE } from "./instagram/PreviaDoPerfil";
import PreviaDaPagina from "./instagram/PreviaDaPagina";
import BioENome from "./instagram/BioENome";
import GeradorDeDestaques from "./instagram/GeradorDeDestaques";
import SugestaoDeDestaques, { useSugestaoDeDestaques } from "./instagram/SugestaoDeDestaques";
import PlanoDaGrade from "./instagram/PlanoDaGrade";
import MetricasDoPerfil from "./instagram/MetricasDoPerfil";
import TelaDoCliente, { ehParte, proximosPosts, type ParteDoPainel } from "./instagram/ColunaDoCliente";
import DetalheDoPost from "./instagram/DetalheDoPost";
import { usePlanejamento } from "./instagram/usePlanejamento";
import { useFonteDaMarca } from "./instagram/fonteDaMarca";
import OutrasRedes from "./instagram/OutrasRedes";
import AgenteDoInstagram from "./instagram/AgenteDoInstagram";
import {
  horaDaLeitura,
  marcaDaAba,
  preCarregarConta,
  preCarregarPagina,
  useAtualizarPainel,
  usePaginaDoFacebook,
  usePainelDoInstagram,
  usePerfilAoVivo,
  type AnaliseDaBio,
  type ItemDaGradeNaAba,
  type PainelDoInstagram,
} from "./instagram/instagramApi";
import { destaquesLimpos, type DestaqueProposto } from "../../../supabase/functions/_shared/conhecimento-perfil-instagram";
import { ehBloco, ehRede, REDES_SOCIAIS, type ChaveDaRede } from "../../../supabase/functions/_shared/instagram-do-cliente";

/**
 * Aba Redes da Mesa (frente IG; rodada 2 em 28/09: nome "Redes", tudo a um
 * clique e sem a página inteira rolando). O endereço segue aba=instagram.
 *
 * No computador a aba tem a altura da janela e cada coluna rola por dentro:
 * - topo: as contas do cliente (Instagram e páginas do Facebook, mais outra
 *   rede) e os atalhos do cliente (resumo, próximos posts, agenda, pastas e
 *   arquivos), que abrem numa gaveta ali dentro, sem sair da aba;
 * - esquerda: a prévia em tempo real (relida ao abrir e a cada 3 minutos),
 *   com Publicado ou Simulação e a leitura no topo, e a grade logo abaixo;
 * - direita: as ferramentas (Bio e nome, Destaques, Grade e simulador,
 *   Métricas), uma por vez, cada uma com blocos que recolhem.
 * O agente fica ao lado (gaveta no celular) e sempre deixa o caminho. No
 * celular tudo empilha e a página rola normal.
 * Endereço: /mesa?client=<id>&aba=instagram[&bloco=bio|destaques|grade|metricas|perfil|redes]
 */

type Ferramenta = "bio" | "destaques" | "grade" | "metricas";
const FERRAMENTAS: Array<{ valor: Ferramenta; rotulo: string }> = [
  { valor: "bio", rotulo: "Bio e nome" },
  { valor: "destaques", rotulo: "Destaques" },
  { valor: "grade", rotulo: "Grade e simulador" },
  { valor: "metricas", rotulo: "Métricas" },
];
const ehFerramenta = (v: unknown): v is Ferramenta => FERRAMENTAS.some((f) => f.valor === v);

/** O que está aberto no topo: uma conta do Instagram, uma página do Facebook ou outra rede. */
type Alvo = { tipo: "instagram"; id: string | null } | { tipo: "facebook"; id: string } | { tipo: "rede"; rede: ChaveDaRede };

export function lerAlvo(v: string | null | undefined): Alvo {
  const s = String(v || "");
  if (s.indexOf("fb:") === 0 && s.length > 3) return { tipo: "facebook", id: s.slice(3) };
  if (s.indexOf("rede:") === 0 && ehRede(s.slice(5))) return { tipo: "rede", rede: s.slice(5) as ChaveDaRede };
  if (s.indexOf("ig:") === 0) return { tipo: "instagram", id: s.slice(3) || null };
  return { tipo: "instagram", id: null };
}

function Chip({ ativo, onClick, icone, children, rotulo }: { ativo: boolean; onClick: () => void; icone?: ReactNode; children: ReactNode; rotulo?: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className={juntar(
        "toque-compacto mr-1 inline-flex h-8 max-w-[168px] shrink-0 items-center rounded-full border px-2.5 text-[12.5px] transition-colors",
        ativo ? "border-primary bg-primary/10 font-medium text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {icone ? <span className="mr-1.5 shrink-0" aria-hidden="true">{icone}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** Rótulo pequeno do grupo (Instagram, Facebook, Outras): some no celular. */
function Grupo({ rotulo, children, primeiro = false }: { rotulo: string; children: ReactNode; primeiro?: boolean }) {
  return (
    <div className={juntar("flex shrink-0 items-center", primeiro ? "" : "ml-1 border-l border-border pl-2")} role="group" aria-label={rotulo}>
      <span className="mr-1.5 hidden text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground xl:inline">{rotulo}</span>
      {children}
    </div>
  );
}

function Contas({
  painel,
  alvo,
  onAlvo,
  onOutraMarca,
  onPreCarregar,
}: {
  painel: PainelDoInstagram | null;
  alvo: Alvo;
  onAlvo: (a: string) => void;
  /** Conta de outra marca: troca a marca da Mesa e já abre aquela conta. */
  onOutraMarca: (marcaId: string, alvo: string) => void;
  onPreCarregar: (alvo: string) => void;
}) {
  const contas = painel ? painel.contas : [];
  const paginas = painel ? painel.paginas : [];
  const idIg = alvo.tipo === "instagram" ? alvo.id || (painel ? painel.conta_id : null) : null;
  const guardadas = painel ? painel.redes.adicionadas : [];
  const redesExtras = REDES_SOCIAIS.filter((r) => r.valor !== "instagram" && r.valor !== "facebook" && (guardadas.some((g) => g.rede === r.valor) || (alvo.tipo === "rede" && alvo.rede === r.valor)));
  const outras = REDES_SOCIAIS.filter((r) => r.valor !== "instagram" && redesExtras.indexOf(r) < 0 && !(r.valor === "facebook" && paginas.length));
  const marca = painel ? painel.marca : null;
  const outrasMarcas = painel ? painel.outras_marcas : [];
  return (
    <div className="flex min-w-0 flex-1 items-center">
    <div
      className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:thin] [-webkit-mask-image:linear-gradient(to_right,black_94%,transparent)] [mask-image:linear-gradient(to_right,black_94%,transparent)]"
      data-contas-do-cliente=""
    >
      <div className="flex w-max items-center py-0.5 pr-4" role="tablist" aria-label="Contas e redes do cliente">
        <Grupo rotulo={marca ? marca.nome : "Instagram"} primeiro>
          {contas.length === 0 && (
            <Chip ativo={alvo.tipo === "instagram"} onClick={() => onAlvo("ig:")} icone={<Instagram className="h-3.5 w-3.5" />} rotulo="Instagram">
              {marca ? "Sem Instagram" : "Instagram"}
            </Chip>
          )}
          {contas.map((c) => (
            <span key={c.id} onMouseEnter={() => onPreCarregar(`ig:${c.id}`)} onFocus={() => onPreCarregar(`ig:${c.id}`)}>
              <Chip ativo={alvo.tipo === "instagram" && idIg === c.id} onClick={() => onAlvo(`ig:${c.id}`)} icone={<Instagram className="h-3.5 w-3.5" />} rotulo={`Instagram @${c.username}`}>
                @{c.username}
              </Chip>
            </span>
          ))}
          {paginas.map((p) => (
            <span key={p.id} onMouseEnter={() => onPreCarregar(`fb:${p.id}`)} onFocus={() => onPreCarregar(`fb:${p.id}`)}>
              <Chip ativo={alvo.tipo === "facebook" && alvo.id === p.id} onClick={() => onAlvo(`fb:${p.id}`)} icone={<Facebook className="h-3.5 w-3.5" />} rotulo={`Facebook ${p.nome}`}>
                {p.nome}
              </Chip>
            </span>
          ))}
        </Grupo>
        {outrasMarcas.map((m) => (
          <Grupo key={m.id} rotulo={m.nome}>
            {m.contas.map((c) => (
              <Chip key={c.id} ativo={false} onClick={() => onOutraMarca(m.id, `ig:${c.id}`)} icone={<Instagram className="h-3.5 w-3.5" />} rotulo={`${m.nome}: Instagram @${c.username} (abre a marca ${m.nome})`}>
                @{c.username}
              </Chip>
            ))}
            {m.paginas.map((p) => (
              <Chip key={p.id} ativo={false} onClick={() => onOutraMarca(m.id, `fb:${p.id}`)} icone={<Facebook className="h-3.5 w-3.5" />} rotulo={`${m.nome}: Facebook ${p.nome} (abre a marca ${m.nome})`}>
                {p.nome}
              </Chip>
            ))}
            {!m.contas.length && !m.paginas.length && <span className="px-2 text-[12px] text-muted-foreground">sem conta ligada</span>}
          </Grupo>
        ))}
        <Grupo rotulo="Outras">
          {redesExtras.map((r) => (
            <Chip key={r.valor} ativo={alvo.tipo === "rede" && alvo.rede === r.valor} onClick={() => onAlvo(`rede:${r.valor}`)} rotulo={r.rotulo}>
              {r.rotulo}
            </Chip>
          ))}
          {outras.length > 0 && (
            <label className="inline-flex shrink-0 items-center">
              <span className="sr-only">Adicionar outra rede</span>
              <Plus className="-mr-6 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <select
                className="toque-compacto h-8 w-[96px] rounded-full border border-dashed border-border bg-background pl-7 pr-2 text-[12.5px] text-muted-foreground"
                value=""
                onChange={(e) => e.target.value && onAlvo(`rede:${e.target.value}`)}
                aria-label="Adicionar outra rede"
              >
                <option value="">Rede</option>
                {outras.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.rotulo}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Grupo>
      </div>
    </div>
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={juntar(botao.barra, "ml-1 h-8 shrink-0 px-2")} aria-label="Todas as contas e redes" title="Todas as contas e redes">
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1 hidden desk:inline">Todas</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-2">
        <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{marca ? marca.nome : "Contas"}</p>
        {contas.map((c) => (
          <button key={c.id} type="button" onClick={() => onAlvo(`ig:${c.id}`)} className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
            <Instagram className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate">@{c.username}</span>
          </button>
        ))}
        {paginas.map((p) => (
          <button key={p.id} type="button" onClick={() => onAlvo(`fb:${p.id}`)} className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
            <Facebook className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate">{p.nome}</span>
          </button>
        ))}
        {outrasMarcas.map((m) => (
          <div key={m.id} className="mt-1 border-t border-border pt-1">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{m.nome}</p>
            {m.contas.map((c) => (
              <button key={c.id} type="button" onClick={() => onOutraMarca(m.id, `ig:${c.id}`)} className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
                <Instagram className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">@{c.username}</span>
              </button>
            ))}
            {m.paginas.map((p) => (
              <button key={p.id} type="button" onClick={() => onOutraMarca(m.id, `fb:${p.id}`)} className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
                <Facebook className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">{p.nome}</span>
              </button>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
    </div>
  );
}

function AtalhosDoCliente({ painel, vista, onAbrir }: { painel: PainelDoInstagram | null; vista: ParteDoPainel | null; onAbrir: (p: ParteDoPainel) => void }) {
  const proximos = painel ? proximosPosts(painel.grade.itens, new Date(), 99).length : 0;
  const atalhos: Array<{ parte: ParteDoPainel; rotulo: string; icone: ReactNode }> = [
    { parte: "resumo", rotulo: "Resumo", icone: <Building2 className="h-3.5 w-3.5" /> },
    { parte: "proximos", rotulo: "Próximos", icone: <ListChecks className="h-3.5 w-3.5" /> },
    { parte: "agenda", rotulo: "Agenda", icone: <CalendarDays className="h-3.5 w-3.5" /> },
    { parte: "arquivos", rotulo: "Arquivos", icone: <FolderOpen className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="ml-2 flex shrink-0 items-center border-l border-border pl-2" role="group" aria-label="Cliente">
      {atalhos.map((a) => (
        <button
          key={a.parte}
          type="button"
          className={juntar(botao.barra, "ml-0.5 h-8 px-2", vista === a.parte ? "bg-muted text-foreground" : "")}
          onClick={() => onAbrir(a.parte)}
          title={a.rotulo}
          aria-label={a.rotulo}
          aria-pressed={vista === a.parte}
        >
          <span aria-hidden="true">{a.icone}</span>
          <span className="ml-1 hidden whitespace-nowrap xl:inline" aria-hidden="true">
            {a.rotulo}
          </span>
          {a.parte === "proximos" && proximos > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10.5px] font-semibold tabular-nums text-primary" aria-hidden="true">
              {proximos}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Coluna com cabeçalho fixo e corpo que rola por dentro no computador. */
function Coluna({ cabecalho, children, rotulo, memoria }: { cabecalho: ReactNode; children: ReactNode; rotulo: string; memoria: string }) {
  return (
    <section className={juntar(superficie.painel, "mb-3 flex min-w-0 flex-col lg:mb-0 lg:min-h-0")} aria-label={rotulo}>
      <div className="shrink-0 border-b border-border px-3 py-2">{cabecalho}</div>
      <RegiaoRolavel rotulo={rotulo} memoria={memoria} sobre="cartao" className="px-3 py-3">
        {children}
      </RegiaoRolavel>
    </section>
  );
}

export default function AbaInstagram() {
  const { clientId, clientName, podeRecarregar } = useMesa();
  const [params, setParams] = useSearchParams();
  // Tudo que fica guardado no navegador é por cliente e marca (Acerbi e CME nunca se misturam).
  const escopo = `${clientId}:${marcaDaAba(clientId)}`;
  const queryClient = useQueryClient();
  const fonteDaMarca = useFonteDaMarca(clientId);
  const [alvoBruto, setAlvoBruto] = useEstadoDaTela<string>(`mesa:instagram:alvo:${escopo}`, "ig:");
  const alvo = lerAlvo(alvoBruto);
  const contaEscolhida = alvo.tipo === "instagram" ? alvo.id : null;
  const [contaGuardada, setContaGuardada] = useEstadoDaTela<string | null>(`mesa:instagram:conta:${escopo}`, null);
  const contaPedida = contaEscolhida || contaGuardada;
  const painel = usePainelDoInstagram(clientId, contaPedida);
  const atualizar = useAtualizarPainel(clientId, contaPedida);
  const dados = painel.data || null;
  const contaId = dados ? dados.conta_id : contaPedida;

  const aoVivo = usePerfilAoVivo(clientId, contaId, dados ? dados.perfil : null, painel.dataUpdatedAt || Date.now());
  const perfil = aoVivo.data || (dados ? dados.perfil : null);
  const pagina = usePaginaDoFacebook(clientId, alvo.tipo === "facebook" ? alvo.id : null);

  const [ferramenta, setFerramenta] = useEstadoDaTela<Ferramenta>(`mesa:instagram:ferramenta:${clientId}`, "bio", { validar: ehFerramenta });
  const [modoDaPrevia, setModoDaPrevia] = useEstadoDaTela<"publicado" | "simulacao">(`mesa:instagram:previa:${clientId}`, "publicado", { validar: (v) => v === "publicado" || v === "simulacao" });
  const [lista, setLista] = useEstadoDaTela<DestaqueProposto[]>(`mesa:instagram:destaques:${escopo}:${contaPedida || "principal"}`, [], { validar: (v) => Array.isArray(v) });
  const [pedido, setPedido] = useState<{ texto: string; n: number } | null>(null);
  const [postAberto, setPostAberto] = useState<ItemDaGradeNaAba | null>(null);
  const local = useLocation();
  const navigate = useNavigate();

  // Tela cheia do cliente (Resumo, Próximos, Agenda, Arquivos): o estado mora no endereço (&vista=).
  const vistaUrl = params.get("vista");
  const vista: ParteDoPainel | null = ehParte(vistaUrl) ? vistaUrl : null;
  const abrirVista = (v: ParteDoPainel) => {
    const next = new URLSearchParams(params);
    next.set("vista", v);
    if (vista) setParams(next, { replace: true, state: local.state });
    else setParams(next, { state: { vistaDaAbaRedes: true } });
  };
  const voltarDaVista = () => {
    const st = local.state as { vistaDaAbaRedes?: boolean } | null;
    if (st && st.vistaDaAbaRedes) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete("vista");
      setParams(next, { replace: true });
    }
  };

  const escolherAlvo = (a: string) => {
    setAlvoBruto(a);
    const novo = lerAlvo(a);
    if (novo.tipo === "instagram") setContaGuardada(novo.id);
  };

  // ?bloco= (o caminho do agente): abre a ferramenta certa; o parâmetro sai do endereço.
  const blocoUrl = params.get("bloco");
  useEffect(() => {
    if (!blocoUrl) return;
    if (ehBloco(blocoUrl)) {
      if (blocoUrl === "redes") setAlvoBruto("rede:facebook");
      else if (alvo.tipo !== "instagram") setAlvoBruto("ig:");
      if (ehFerramenta(blocoUrl)) setFerramenta(blocoUrl);
      if (blocoUrl === "perfil") setModoDaPrevia("publicado");
    }
    const next = new URLSearchParams(params);
    next.delete("bloco");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocoUrl]);

  // A sugestão de destaques sai ao abrir a aba (qualquer ferramenta aberta) e vira bolinha na prévia.
  const sugestao = useSugestaoDeDestaques({
    clientId,
    escopo: `${escopo}:${contaId || "principal"}`,
    contaId,
    lista,
    capas: dados ? dados.capas : [],
    pronto: !!dados,
    onUsar: (l) => setLista(destaquesLimpos(l)),
  });

  // O planejamento da grade: um rascunho de datas só, que o simulador e a Agenda usam juntos.
  const itensDaGrade = useMemo(() => (dados ? dados.grade.itens : []), [dados]);
  const plano = usePlanejamento({ clientId, escopo, itens: itensDaGrade, onMudou: () => void atualizar.reler() });
  const naSimulacao = plano.naSimulacao;

  const usarDestaques = (l: DestaqueProposto[]) => {
    setLista(destaquesLimpos(l));
    setFerramenta("destaques");
  };
  const pedirAoAgente = (t: string) => {
    abrirLateralDaArea();
    setPedido({ texto: t, n: Date.now() });
  };

  const lateral = (
    <AgenteDoInstagram
      mensagens={dados ? dados.mensagens : []}
      contaId={contaId}
      pedido={pedido}
      onMensagens={(m) => atualizar.mudar((p) => ({ ...p, mensagens: m }))}
      onUsarDestaques={usarDestaques}
    />
  );

  const lido = alvo.tipo === "facebook" ? (pagina.data ? pagina.data.lido_em : null) : perfil ? perfil.lido_em : null;
  const lendo = alvo.tipo === "facebook" ? pagina.isFetching : aoVivo.isFetching || painel.isFetching;
  const reler = () => {
    if (alvo.tipo === "facebook") void pagina.refetch();
    else void aoVivo.refetch();
  };

  const cabecalhoDaPrevia = (
    <div className="flex min-w-0 flex-wrap items-center justify-between" data-topo-da-previa="">
      {alvo.tipo === "instagram" ? (
        <SeletorCompacto
          rotulo="Como ver o perfil"
          valor={modoDaPrevia}
          onEscolher={(v) => setModoDaPrevia(v === "simulacao" ? "simulacao" : "publicado")}
          opcoes={[
            { valor: "publicado", rotulo: "Publicado" },
            { valor: "simulacao", rotulo: "Simulação", contador: dados ? naSimulacao.length : null },
          ]}
        />
      ) : (
        <span className={texto.rotulo}>Página do Facebook</span>
      )}
      <span className="flex items-center">
        <span className={juntar(texto.auxiliar, "mr-1 tabular-nums")} aria-live="polite" title={perfil && alvo.tipo === "instagram" ? ROTULO_DA_FONTE[perfil.fonte] : undefined}>
          {lendo ? "lendo..." : lido ? `lido às ${horaDaLeitura(lido)}` : ""}
        </span>
        <button type="button" className={botao.icone} onClick={reler} disabled={lendo} aria-label="Ler de novo agora" title="Ler de novo agora (relê sozinho a cada 3 minutos)">
          <RefreshCw className={juntar("h-4 w-4", lendo ? "animate-spin" : "")} />
        </button>
      </span>
    </div>
  );

  const ferramentaAtual = FERRAMENTAS.find((f) => f.valor === ferramenta) || FERRAMENTAS[0];

  return (
    <AreaDeTrabalho memoria="mesa-instagram" rotuloDaLateral="Agente das redes" rotuloDoPrincipal="Redes do cliente" principalRolavel={false} lateral={lateral}>
      <div className="flex min-w-0 flex-col pb-4 lg:h-full lg:min-h-0 lg:pb-0" data-aba-redes="">
        <div className="shrink-0">
          <div className={juntar(superficie.painel, "mb-2 flex min-w-0 items-center px-2 py-1")} data-topo-da-aba="">
            <Contas
              painel={dados}
              alvo={alvo}
              onAlvo={(a) => {
                escolherAlvo(a);
                if (vista) voltarDaVista();
              }}
              onOutraMarca={(marcaId, a) => {
                // A conta abre já na outra marca: o alvo fica guardado no escopo dela antes de trocar.
                gravarEstadoDaTela(`mesa:instagram:alvo:${clientId}:${marcaId}`, a);
                const next = new URLSearchParams(params);
                next.set("marca", marcaId);
                next.delete("vista");
                next.delete("task");
                next.delete("campanha");
                setParams(next);
              }}
              onPreCarregar={(a) => {
                const x = lerAlvo(a);
                if (x.tipo === "instagram") preCarregarConta(queryClient, clientId, x.id);
                else if (x.tipo === "facebook") preCarregarPagina(queryClient, clientId, x.id);
              }}
            />
            <AtalhosDoCliente painel={dados} vista={vista} onAbrir={abrirVista} />
          </div>
          {dados && dados.aviso_sql && <p className="mb-2 rounded-md bg-warning/10 px-3 py-1.5 text-[12px] leading-5 text-foreground">{dados.aviso_sql}</p>}
        </div>

        {painel.isLoading && <Carregando forma="aba" rotulo="Lendo as redes do cliente" />}
        {painel.isError && !dados && (
          <EstadoDeErro
            titulo="Não foi possível abrir a aba Redes."
            descricao={textoDoErro(painel.error)}
            acao={
              <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void painel.refetch()}>
                Tentar de novo
              </button>
            }
          />
        )}

        {dados && vista && (
          <div className="min-w-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <TelaDoCliente
              clientId={clientId}
              vista={vista}
              onVista={abrirVista}
              onVoltar={voltarDaVista}
              painel={perfil ? { ...dados, perfil } : dados}
              plano={plano}
              podePublicar={podeRecarregar}
              onMudou={() => void atualizar.reler()}
              onSimular={(s2) => {
                plano.adicionarSimulado(s2);
                setModoDaPrevia("simulacao");
                setFerramenta("grade");
                voltarDaVista();
              }}
            />
          </div>
        )}

        {dados && !vista && alvo.tipo === "rede" && (
          <div className="mt-1 min-h-0 lg:flex lg:flex-1 lg:flex-col">
            <Coluna rotulo="Outra rede" memoria={`mesa:instagram:rede:${clientId}`} cabecalho={<span className={texto.rotulo}>{(REDES_SOCIAIS.find((r) => r.valor === alvo.rede) || REDES_SOCIAIS[0]).rotulo}</span>}>
              <OutrasRedes rede={alvo.rede} painel={dados} onMudou={() => void atualizar.reler()} />
            </Coluna>
          </div>
        )}

        {dados && !vista && alvo.tipo !== "rede" && perfil && (
          <div className="mt-1 min-w-0 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
            <Coluna rotulo="Prévia" memoria={`mesa:instagram:previa:${clientId}:${alvoBruto}`} cabecalho={cabecalhoDaPrevia}>
              {alvo.tipo === "facebook" ? (
                <PreviaDaPagina pagina={pagina.data} carregando={pagina.isLoading} />
              ) : (
                <>
                  <PreviaDoPerfil
                    perfil={perfil}
                    capas={dados.capas}
                    lista={lista}
                    corDaMarca={dados.kit.paleta[0] ? dados.kit.paleta[0].hex : null}
                    fonteDaMarca={fonteDaMarca.familia}
                    planejados={naSimulacao}
                    simulando={modoDaPrevia === "simulacao"}
                    onMover={plano.moverPorId}
                    onAbrir={setPostAberto}
                    travado={plano.travaDoItem}
                  />
                  {perfil.aviso && <p className={juntar(texto.auxiliar, "mx-auto mt-2 max-w-[420px] leading-5")}>{perfil.aviso}</p>}
                </>
              )}
            </Coluna>

            {alvo.tipo === "facebook" ? (
              <Coluna rotulo="Facebook" memoria={`mesa:instagram:fb:${clientId}`} cabecalho={<span className={texto.rotulo}>O que a API do Facebook permite</span>}>
                <OutrasRedes rede="facebook" painel={dados} onMudou={() => void atualizar.reler()} />
              </Coluna>
            ) : (
              <Coluna
                rotulo={ferramentaAtual.rotulo}
                memoria={`mesa:instagram:ferramenta:${clientId}:${ferramenta}`}
                cabecalho={
                  <SeletorCompacto
                    rotulo="Ferramenta"
                    valor={ferramenta}
                    onEscolher={(v) => ehFerramenta(v) && setFerramenta(v)}
                    listaQuandoNaoCabe
                    opcoes={FERRAMENTAS.map((f) => ({
                      valor: f.valor,
                      rotulo: f.rotulo,
                      contador: f.valor === "grade" ? plano.ordenados.length || null : f.valor === "destaques" ? dados.capas.length || null : null,
                    }))}
                  />
                }
              >
                {ferramenta === "bio" && (
                  <BioENome perfil={perfil} analise={dados.bio_analise} onAnalise={(a: AnaliseDaBio) => atualizar.mudar((p) => ({ ...p, bio_analise: a }))} />
                )}
                {ferramenta === "destaques" && (
                  <div className="min-w-0 space-y-3">
                    <SugestaoDeDestaques sugestao={sugestao} lista={lista} onUsar={(l) => setLista(destaquesLimpos(l))} />
                    <GeradorDeDestaques
                      contaId={contaId}
                      paleta={dados.kit.paleta}
                      logo={dados.kit.logo}
                      capas={dados.capas}
                      lista={lista}
                      onLista={setLista}
                      onNovaCapa={(c) => atualizar.mudar((p) => ({ ...p, capas: p.capas.filter((x) => x.id !== c.id).concat([c]) }))}
                      onArquivada={(id) => atualizar.mudar((p) => ({ ...p, capas: p.capas.filter((x) => x.id !== id) }))}
                      onPedirAoAgente={() => pedirAoAgente("Proponha os destaques do perfil (nome curto e ícone de cada um), na ordem certa para quem chega.")}
                      nomeDoCliente={clientName}
                      escopo={`${escopo}:${contaId || "principal"}`}
                    />
                  </div>
                )}
                {ferramenta === "grade" && (
                  <PlanoDaGrade plano={plano} podePublicar={podeRecarregar} onVerNaPrevia={() => setModoDaPrevia("simulacao")} onMudou={() => void atualizar.reler()} />
                )}
                {ferramenta === "metricas" && <MetricasDoPerfil clientId={clientId} contaId={contaId} />}
              </Coluna>
            )}
          </div>
        )}
      </div>

      <DetalheDoPost item={postAberto} plano={plano} onFechar={() => setPostAberto(null)} podePublicar={podeRecarregar} onMudou={() => void atualizar.reler()} />
    </AreaDeTrabalho>
  );
}

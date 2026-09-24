import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Calculator, Check, ChevronsUpDown, KeyRound, ListOrdered, Loader2, Plus, Search, Settings2, Sparkles, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, usd, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { montarFila, useFilaDePrioridades, type AbaDaMesa } from "@/lib/mesa/fila";
import TrocaDeMesas from "@/components/mesa-foto/TrocaDeMesas";

/**
 * Mesa do cliente (/mesa, só equipe: admin, gestor e design).
 *
 * Traz para dentro do painel o calendário e a arte que eram feitos fora.
 * Cinco abas em sequência (Contexto, Mês, Campanhas, Estúdio, Entrega) e uma
 * barra fina fixa no topo (pedido do dono em 23/09, noite: sem o título
 * grande, tudo numa faixa só): seletor de cliente com busca, as etapas e o
 * saldo e o gasto pequenos, com recarga, modelos e chaves em botões curtos. Endereço completo:
 * /mesa?client=<id>&aba=estudio&task=<id>&mes=AAAA-MM-01
 * (na aba Campanhas: &campanha=<id>, ou &hype=<n> para abrir a campanha nova
 * a partir do hype n da busca mais recente)
 *
 * Painéis da equipe no mesmo topo (pedido do dono em 24/09): &painel=prioridades
 * (fila do que fazer, também a entrada da Mesa sem cliente) e &painel=custos
 * (custos de produção, só admin e gestor; o cliente nunca vê a Mesa).
 *
 * Abre rápido (pedido do dono em 23/09): o cliente sai do endereço na hora,
 * sem esperar a lista de clientes; cada aba baixa só quando é aberta (as
 * outras vêm em tempo ocioso, logo depois); e o que já foi lido volta do
 * cache guardado no navegador (src/lib/mesa/cachePersistido.ts).
 */

// Cada aba em arquivo próprio: a Mesa pinta o cabeçalho e a barra sem
// esperar o código do Estúdio, que é o maior.
const carregarContexto = () => import("@/components/mesa/AbaContexto");
const carregarMes = () => import("@/components/mesa/AbaMes");
const carregarCampanhas = () => import("@/components/mesa/AbaCampanhas");
const carregarEstudio = () => import("@/components/mesa/AbaEstudio");
const carregarEntrega = () => import("@/components/mesa/AbaEntrega");
const AbaContexto = lazy(carregarContexto);
const AbaMes = lazy(carregarMes);
const AbaCampanhas = lazy(carregarCampanhas);
const AbaEstudio = lazy(carregarEstudio);
const AbaEntrega = lazy(carregarEntrega);
// Janelas do admin: só baixam na primeira vez que abrem.
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));
// Painéis da equipe: fila de prioridades e custos de produção.
const FilaDePrioridades = lazy(() => import("@/components/mesa/FilaDePrioridades"));
const PainelDeCustos = lazy(() => import("@/components/mesa/PainelDeCustos"));

const ABAS = [
  { valor: "contexto", rotulo: "Contexto" },
  { valor: "mes", rotulo: "Mês" },
  { valor: "campanhas", rotulo: "Campanhas" },
  { valor: "estudio", rotulo: "Estúdio" },
  { valor: "entrega", rotulo: "Entrega" },
] as const;

type Aba = (typeof ABAS)[number]["valor"];

const MES_VALIDO = /^\d{4}-\d{2}-01$/;
const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Onde a pessoa parou em cada cliente (aba, mês e item), para "continuar de
 * onde parou" ao trocar de cliente e voltar. Guarda também o nome, para o
 * cabeçalho já abrir com ele antes da lista de clientes chegar. Fica no
 * navegador; se o armazenamento estiver bloqueado, a Mesa só abre no começo.
 */
interface OndeParou {
  aba?: string | null;
  mes?: string | null;
  task?: string | null;
  nome?: string | null;
}

const chaveOnde = (clientId: string) => `mesa:onde:${clientId}`;

function lerOnde(clientId: string): OndeParou | null {
  try {
    const bruto = window.localStorage.getItem(chaveOnde(clientId));
    if (!bruto) return null;
    const v = JSON.parse(bruto);
    if (!v || typeof v !== "object") return null;
    return {
      aba: ABAS.some((a) => a.valor === v.aba) ? String(v.aba) : null,
      mes: typeof v.mes === "string" && MES_VALIDO.test(v.mes) ? v.mes : null,
      task: typeof v.task === "string" && v.task ? v.task : null,
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return null;
  }
}

function gravarOnde(clientId: string, onde: OndeParou) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify(onde));
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}

/** Pede ao navegador para rodar quando estiver ocioso (setTimeout onde não há). */
function quandoOcioso(fn: () => void): () => void {
  const w = window as any;
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn, { timeout: 4000 });
    return () => {
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

/** Espaço da aba enquanto o código dela chega: o resto da Mesa não pisca. */
function EsqueletoDaAba() {
  return (
    <div aria-busy="true" aria-label="Abrindo a etapa" className="space-y-3">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted sm:w-1/3" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/80" />
      <div className="h-[45vh] animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

// ------------------------------------------------------------------ topo

export interface ClienteDaLista {
  id: string;
  nome: string;
}

const semAcento = (t: string) =>
  (t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Clientes que batem com a busca (sem acento), os que começam com ela primeiro. */
export function filtrarClientes(clientes: ClienteDaLista[], busca: string): ClienteDaLista[] {
  const termo = semAcento(busca);
  if (!termo) return clientes;
  const comeco: ClienteDaLista[] = [];
  const meio: ClienteDaLista[] = [];
  for (const c of clientes) {
    const nome = semAcento(c.nome);
    const i = nome.indexOf(termo);
    if (i === 0 || nome.indexOf(` ${termo}`) >= 0) comeco.push(c);
    else if (i > 0) meio.push(c);
  }
  return comeco.concat(meio);
}

/**
 * Seletor de cliente compacto: botão do tamanho do nome e, ao abrir, busca
 * com a lista rolando por dentro. Setas escolhem, Enter abre, Esc fecha.
 */
export function SeletorDeCliente({
  clientes,
  valor,
  nome,
  carregando,
  onEscolher,
}: {
  clientes: ClienteDaLista[];
  valor: string;
  nome: string;
  carregando: boolean;
  onEscolher: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const lista = useRef<HTMLUListElement>(null);
  const filtrados = useMemo(() => filtrarClientes(clientes, busca), [clientes, busca]);

  useEffect(() => {
    if (!aberto) return;
    setBusca("");
    const i = clientes.findIndex((c) => c.id === valor);
    setAtivo(i >= 0 ? i : 0);
  }, [aberto, clientes, valor]);

  // Mantém o item ativo à vista quando anda com as setas.
  useEffect(() => {
    const el = lista.current ? (lista.current.querySelector(`[data-indice="${ativo}"]`) as HTMLElement | null) : null;
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {
        /* navegador antigo: segue sem rolar */
      }
    }
  }, [ativo]);

  const escolher = (id: string) => {
    setAberto(false);
    if (id !== valor) onEscolher(id);
  };

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((a) => Math.min(filtrados.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtrados[ativo] || filtrados[0];
      if (c) escolher(c.id);
    }
  };

  const rotulo = valor ? nome || "Carregando..." : carregando ? "Carregando clientes..." : "Escolha o cliente";

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={aberto}
          aria-haspopup="listbox"
          aria-label={valor ? `Cliente: ${rotulo}. Trocar de cliente` : "Escolher o cliente"}
          className="flex h-8 min-w-0 max-w-full items-center rounded-lg border border-border bg-card px-2.5 text-left text-[13px] font-semibold text-foreground transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-w-[240px]"
        >
          <Building2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={`min-w-0 flex-1 truncate ${valor ? "" : "font-normal text-muted-foreground"}`}>{rotulo}</span>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[320px] p-0">
        <div className="flex items-center border-b border-border px-2.5">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setAtivo(0);
            }}
            onKeyDown={teclas}
            placeholder="Buscar cliente"
            aria-label="Buscar cliente"
            aria-controls="mesa-lista-de-clientes"
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul id="mesa-lista-de-clientes" ref={lista} role="listbox" aria-label="Clientes" className="max-h-[50vh] overflow-y-auto overscroll-contain p-1">
          {carregando && clientes.length === 0 && (
            <li className="flex items-center px-2 py-3 text-[12.5px] text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Carregando clientes...
            </li>
          )}
          {!carregando && filtrados.length === 0 && <li className="px-2 py-3 text-[12.5px] text-muted-foreground">Nenhum cliente com essa busca.</li>}
          {filtrados.map((c, i) => (
            <li key={c.id} role="option" aria-selected={c.id === valor} data-indice={i}>
              <button
                type="button"
                onClick={() => escolher(c.id)}
                onMouseMove={() => setAtivo(i)}
                className={`flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[13px] ${
                  i === ativo ? "bg-muted text-foreground" : "text-foreground/90"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                {c.id === valor && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const TAREFAS: Record<string, string> = {
  calendario: "Calendário",
  estudio: "Estúdio",
  conversa: "Conversa",
  leitura_referencia: "Leitura de referência",
  verificacao: "Conferência",
};

/** Modelos que não moram no catálogo de IA (o Jev é cobrado à parte). */
const ROTULOS_FORA_DO_CATALOGO: Record<string, string> = {
  "typesafe:jev-latest": "Jev (notas e conferências)",
};

const botaoPequeno =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Saldo e gasto do mês numa linha curta. Tocar abre o detalhe (por modelo,
 * por tarefa, previsão pelo plano); recarregar e os atalhos de admin ficam
 * em botões pequenos ao lado.
 */
export function CustoCompacto({
  saldoUsd,
  consumo,
  previsao,
  carregando,
  podeRecarregar,
  isAdmin,
  onRecarregar,
  onChaves,
  onModelos,
}: {
  saldoUsd: number | null;
  consumo: ConsumoDoMes | null;
  previsao: PrevisaoDoPlano | null;
  carregando: boolean;
  podeRecarregar: boolean;
  isAdmin: boolean;
  onRecarregar: () => void;
  onChaves: () => void;
  onModelos: () => void;
}) {
  const negativo = saldoUsd !== null && saldoUsd < 0;
  const baixo = saldoUsd !== null && !!previsao && previsao.custo_por_post_usd > 0 && saldoUsd < previsao.custo_por_post_usd;
  const alerta = negativo || baixo;
  return (
    <div className="flex min-w-0 shrink-0 items-center">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Saldo e gasto do mês"
            className="inline-flex h-8 min-w-0 items-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Wallet className={`mr-1.5 h-3.5 w-3.5 shrink-0 ${alerta ? "text-destructive" : ""}`} />
            <strong className={`font-semibold tabular-nums ${negativo ? "text-destructive" : "text-foreground"}`}>
              {carregando && saldoUsd === null ? <Loader2 className="inline h-3 w-3 animate-spin" /> : saldoUsd === null ? "?" : usd(saldoUsd)}
            </strong>
            {alerta && <span className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-label={negativo ? "saldo negativo" : "saldo baixo"} />}
            <span className="ml-2 hidden whitespace-nowrap sm:inline">
              mês <span className="font-medium tabular-nums text-foreground">{usd((consumo && consumo.total_usd) || 0)}</span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[340px] p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted px-2.5 py-2">
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Saldo</p>
              <p className={`text-[15px] font-semibold tabular-nums ${negativo ? "text-destructive" : "text-foreground"}`}>{saldoUsd === null ? "?" : usd(saldoUsd)}</p>
            </div>
            <div className="rounded-lg bg-muted px-2.5 py-2">
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Gasto do mês</p>
              <p className="text-[15px] font-semibold tabular-nums text-foreground">{usd((consumo && consumo.total_usd) || 0)}</p>
            </div>
          </div>
          {alerta && (
            <p className="mt-2 rounded-lg bg-warning/15 px-2.5 py-1.5 text-[11.5px] text-foreground">
              {negativo ? "Saldo negativo." : "Saldo baixo: não cobre um post pelo custo médio."}
              {podeRecarregar ? " Recarregue para seguir gerando." : ""}
            </p>
          )}
          {previsao && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {previsao.posts_por_mes ? `Plano ${previsao.posts_por_mes} posts` : "Por post"}:{" "}
              <strong className="font-semibold text-foreground">
                ≈ {usd(previsao.previsao_mes_usd != null ? previsao.previsao_mes_usd : previsao.custo_por_post_usd)}
              </strong>
              {previsao.posts_que_o_saldo_cobre != null ? ` · o saldo cobre ${previsao.posts_que_o_saldo_cobre}` : ""}
            </p>
          )}
          <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Por modelo</p>
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
            {((consumo && consumo.por_modelo) || []).length === 0 && <li className="text-[12px] text-muted-foreground">Nada gasto neste mês.</li>}
            {((consumo && consumo.por_modelo) || []).map((m) => (
              <li key={m.modelo_id} className="flex items-baseline justify-between text-[12px]">
                <span className="mr-3 min-w-0 truncate">
                  {m.rotulo || ROTULOS_FORA_DO_CATALOGO[m.modelo_id] || m.modelo_id} <span className="text-muted-foreground">· {m.usos}x</span>
                </span>
                <span className="shrink-0 font-medium">{usd(m.custo_usd)}</span>
              </li>
            ))}
          </ul>
          {((consumo && consumo.por_tarefa) || []).length > 0 && (
            <>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Por tarefa</p>
              <ul className="mt-1.5 space-y-1">
                {((consumo && consumo.por_tarefa) || []).map((t) => (
                  <li key={t.tarefa} className="flex items-baseline justify-between text-[12px]">
                    <span className="mr-3 min-w-0 truncate">
                      {TAREFAS[t.tarefa] || t.tarefa} <span className="text-muted-foreground">· {t.usos}x</span>
                    </span>
                    <span className="shrink-0 font-medium">{usd(t.custo_usd)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!!(consumo && consumo.recargas_usd) && <p className="mt-3 text-[11.5px] text-muted-foreground">Recargas no mês: {usd(consumo!.recargas_usd)}</p>}
        </PopoverContent>
      </Popover>
      {podeRecarregar && (
        <button type="button" onClick={onRecarregar} className={botaoPequeno} aria-label="Recarregar carteira" title="Recarregar carteira">
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1 hidden xl:inline">Recarregar</span>
        </button>
      )}
      {isAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={botaoPequeno} aria-label="Modelos de IA e chaves" title="Modelos de IA e chaves">
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-52 p-1">
            <button type="button" onClick={onModelos} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
              <Sparkles className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Modelos de IA
            </button>
            <button type="button" onClick={onChaves} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
              <KeyRound className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Chaves e cotas
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ página

export default function MesaDoCliente() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const abaUrl = params.get("aba") as Aba | null;
  const aba: Aba = ABAS.some((a) => a.valor === abaUrl) ? (abaUrl as Aba) : "contexto";
  const tarefaId = params.get("task");
  const mesUrl = params.get("mes") || "";
  const mes = MES_VALIDO.test(mesUrl) ? mesUrl : inicioDoMes();
  const campanhaBruta = params.get("campanha") || "";
  const campanhaUrl = UUID_VALIDO.test(campanhaBruta) ? campanhaBruta : null;
  const hypeBruto = params.get("hype");
  const hypeUrl = hypeBruto !== null && /^\d{1,2}$/.test(hypeBruto) ? Number(hypeBruto) : null;

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const podeRecarregar = role === "admin" || role === "manager";
  // Custos de produção: admin e gestor (a RPC confere de novo no banco).
  const podeVerCustos = role === "admin" || role === "manager";
  const painelUrl = params.get("painel");
  const painel: "prioridades" | "custos" | null =
    painelUrl === "custos" && podeVerCustos ? "custos" : painelUrl === "prioridades" ? "prioridades" : null;

  const clientes = useMemo(
    () =>
      ((clientesQuery.data || []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesQuery.data],
  );
  const clienteNaLista = clientes.find((c) => c.id === clientIdUrl) || null;

  // A lista pode estar velha (cliente criado agora, cache do navegador):
  // antes de dizer que o cliente do endereço não existe, relê uma vez.
  const [conferido, setConferido] = useState<{ id: string; em: number } | null>(null);
  const listaPronta = clientesQuery.isSuccess;
  useEffect(() => {
    if (!clientIdUrl || !listaPronta || clienteNaLista || clientesQuery.isFetching) return;
    if (conferido && conferido.id === clientIdUrl) return;
    setConferido({ id: clientIdUrl, em: clientesQuery.dataUpdatedAt });
    void clientesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdUrl, listaPronta, clienteNaLista, clientesQuery.isFetching]);
  const naoEstaNaLista =
    listaPronta &&
    !clienteNaLista &&
    !clientesQuery.isFetching &&
    !!conferido &&
    conferido.id === clientIdUrl &&
    clientesQuery.dataUpdatedAt > conferido.em;

  // O cliente sai do endereço na hora: nada espera a lista de clientes.
  // Endereço com id inválido, ou fora da lista depois de reler, volta ao seletor.
  const clientId = clientIdUrl && UUID_VALIDO.test(clientIdUrl) && !naoEstaNaLista ? clientIdUrl : "";
  const ondeGuardado = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (ondeGuardado && ondeGuardado.nome) || "";

  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: substituir });
  };

  // Trocar de cliente volta para a aba, o mês e o item em que parou nele.
  const trocarCliente = (id: string) => {
    const onde = lerOnde(id);
    mudar({ client: id, aba: (onde && onde.aba) || "contexto", mes: (onde && onde.mes) || null, task: (onde && onde.task) || null, campanha: null, hype: null, painel: null });
  };

  // Da fila de prioridades direto para a aba certa do cliente certo.
  const abrirDaFila = (id: string, abaDaAcao: AbaDaMesa, mesDaAcao: string | null) => {
    mudar({ client: id, aba: abaDaAcao, mes: mesDaAcao, task: null, campanha: null, hype: null, painel: null });
  };

  const alternarPainel = (p: "prioridades" | "custos") => mudar({ painel: painel === p ? null : p });

  // Fila da equipe: a mesma consulta alimenta o número do botão e a tela.
  const filaDoTopo = useFilaDePrioridades(clientes, clientesQuery.isSuccess);
  const urgentes = useMemo(() => (filaDoTopo.data ? montarFila(filaDoTopo.data).resumo.agora : 0), [filaDoTopo.data]);
  const mostrarFila = painel === "prioridades" || (!clientId && painel === null);

  // Endereço só com o cliente (sem aba): abre onde parou da última vez.
  useEffect(() => {
    if (!clientId || params.get("aba")) return;
    const onde = lerOnde(clientId);
    if (onde && onde.aba) mudar({ aba: onde.aba, mes: onde.mes || null, task: onde.task || null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Guarda onde parou sempre que a aba, o mês ou o item mudam.
  useEffect(() => {
    if (!clientId || !abaUrl) return;
    gravarOnde(clientId, {
      aba,
      mes: MES_VALIDO.test(mesUrl) ? mesUrl : null,
      task: tarefaId || null,
      nome: nomeDoCliente || null,
    });
  }, [clientId, abaUrl, aba, mesUrl, tarefaId, nomeDoCliente]);

  // Depois da primeira pintura, com o navegador ocioso, baixa as outras abas:
  // trocar de etapa não espera download.
  useEffect(
    () =>
      quandoOcioso(() => {
        for (const carregar of [carregarContexto, carregarMes, carregarCampanhas, carregarEstudio, carregarEntrega]) {
          carregar().catch(() => {
            /* sem rede agora: baixa quando a aba abrir */
          });
        }
      }),
    [],
  );

  const mesAtual = inicioDoMes();

  // Saldo, consumo e previsão: duas leituras (o saldo vem no consumo e na
  // previsão; a RPC só de saldo saiu).
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });

  // Mesma chave que a aba Entrega usa: salvar o plano lá atualiza a barra.
  const previsao = useQuery({
    queryKey: ["mesa", "previsao", clientId],
    enabled: !!clientId,
    queryFn: () => lerPrevisao(clientId),
  });

  const numeroOuNulo = (v: unknown) => (v === undefined || v === null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const saldoUsd =
    numeroOuNulo(consumo.data ? consumo.data.saldo_usd : null) ?? numeroOuNulo(previsao.data ? previsao.data.saldo_usd : null);

  const atualizarCusto = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "consumo", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
  };

  const abrirChaves = () => {
    setChavesUsadas(true);
    setChavesAbertas(true);
  };
  const abrirModelos = () => {
    setModelosUsados(true);
    setModelosAbertos(true);
  };

  const valor: MesaValor | null = clientId
    ? {
        clientId,
        clientName: nomeDoCliente,
        userId: user?.id || null,
        isAdmin,
        podeRecarregar,
        saldoUsd,
        catalogo: catalogo.data || [],
        catalogoCarregando: catalogo.isLoading,
        atualizarCusto,
        abrirRecarga: () => setRecargaAberta(true),
        abrirChaves,
        abrirModelos,
        versaoCarteira,
      }
    : null;

  return (
    // Fundo sólido próprio: a grade do fundo do painel não aparece através das
    // superfícies semitransparentes da Mesa (pedido do dono em 23/09).
    <div className="relative isolate -mx-4 space-y-5 bg-background px-4 pb-10 md:-mx-6 md:px-6">
      {/* Barra fina e fixa: cliente, etapas e custo numa faixa só. No
          celular a página rola dentro do main (top-0); no computador rola a
          janela, abaixo do cabeçalho de 80px. O nav "Etapas da Mesa" é o que
          o Estúdio e o Contexto medem para saber onde a barra termina. */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background px-4 py-2 md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
        <h1 className="sr-only">Mesa do cliente</h1>
        <div className="flex min-w-0 flex-wrap items-center lg:flex-nowrap">
          <div className="mr-2 min-w-0 flex-1 lg:flex-none">
            <SeletorDeCliente
              clientes={clientes}
              valor={clientId}
              nome={nomeDoCliente}
              carregando={clientesQuery.isLoading}
              onEscolher={trocarCliente}
            />
          </div>
          {clientId && (
            <nav
              aria-label="Etapas da Mesa"
              className="order-last mt-2 grid w-full grid-cols-5 gap-0.5 rounded-lg bg-muted p-0.5 lg:order-none lg:mx-3 lg:mt-0 lg:flex lg:w-auto lg:min-w-0 lg:flex-1"
            >
              {ABAS.map((a, i) => (
                <button
                  key={a.valor}
                  type="button"
                  onClick={() => mudar({ aba: a.valor, hype: null, painel: null })}
                  aria-current={aba === a.valor && !painel ? "page" : undefined}
                  className={`min-w-0 truncate rounded-md px-1 py-1.5 text-[12px] font-medium transition-colors lg:flex-1 lg:px-2 ${
                    aba === a.valor && !painel ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="mr-1 hidden text-[10.5px] text-muted-foreground sm:inline">{i + 1}</span>
                  {a.rotulo}
                </button>
              ))}
            </nav>
          )}
          <div className={`flex shrink-0 items-center ${clientId ? "" : "ml-auto"}`}>
            <button
              type="button"
              onClick={() => alternarPainel("prioridades")}
              aria-pressed={mostrarFila}
              aria-label={urgentes > 0 ? `Prioridades: ${urgentes} para agora` : "Prioridades"}
              title="Prioridades"
              className={`${botaoPequeno} ${mostrarFila ? "bg-muted text-foreground" : ""}`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              <span className="ml-1 hidden xl:inline">Prioridades</span>
              {urgentes > 0 && (
                <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10.5px] font-semibold leading-4 text-destructive-foreground tabular-nums">{urgentes}</span>
              )}
            </button>
            {podeVerCustos && (
              <button
                type="button"
                onClick={() => alternarPainel("custos")}
                aria-pressed={painel === "custos"}
                aria-label="Custos de produção"
                title="Custos de produção"
                className={`${botaoPequeno} ${painel === "custos" ? "bg-muted text-foreground" : ""}`}
              >
                <Calculator className="h-3.5 w-3.5" />
                <span className="ml-1 hidden xl:inline">Custos</span>
              </button>
            )}
          </div>
          {clientId && <TrocaDeMesas atual="mesa" clientId={clientId} />}
          {clientId && (
            <CustoCompacto
              saldoUsd={saldoUsd}
              consumo={consumo.data || null}
              previsao={previsao.data || null}
              carregando={consumo.isLoading}
              podeRecarregar={podeRecarregar}
              isAdmin={isAdmin}
              onRecarregar={() => setRecargaAberta(true)}
              onChaves={abrirChaves}
              onModelos={abrirModelos}
            />
          )}
        </div>
      </header>

      {!clientId && !painel && <p className="text-[12.5px] text-muted-foreground">Escolha um cliente para abrir a mesa dele.</p>}

      {mostrarFila && (
        <Suspense fallback={<EsqueletoDaAba />}>
          <FilaDePrioridades clientes={clientes} clientesProntos={clientesQuery.isSuccess} onAbrir={abrirDaFila} />
        </Suspense>
      )}

      {painel === "custos" && (
        <Suspense fallback={<EsqueletoDaAba />}>
          <PainelDeCustos key={clientId || "todos"} clientes={clientes} clienteInicial={clientId || null} />
        </Suspense>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <div key={valor.clientId} className={painel ? "hidden" : "min-w-0"}>
            <Suspense fallback={<EsqueletoDaAba />}>
              {aba === "contexto" && <AbaContexto />}
              {aba === "mes" && (
                <AbaMes
                  onAbrirNoEstudio={(taskId, mesDoItem) => mudar({ aba: "estudio", task: taskId, mes: mesDoItem })}
                  onCriarCampanha={(indice) => mudar({ aba: "campanhas", hype: String(indice), campanha: null })}
                />
              )}
              {aba === "campanhas" && (
                <AbaCampanhas
                  campanhaId={campanhaUrl}
                  onCampanha={(id) => mudar({ campanha: id, hype: null }, true)}
                  hypeIndice={hypeUrl}
                  onLimparHype={() => mudar({ hype: null }, true)}
                  onAbrirNoEstudio={(taskId, mesDoItem) => mudar({ aba: "estudio", task: taskId, mes: mesDoItem || null, hype: null })}
                />
              )}
              {aba === "estudio" && (
                <AbaEstudio
                  mes={mes}
                  onMes={(m) => mudar({ mes: m, task: null })}
                  tarefaId={tarefaId}
                  onTarefa={(id) => mudar({ task: id })}
                />
              )}
              {aba === "entrega" && (
                <AbaEntrega mes={mes} onMes={(m) => mudar({ mes: m })} onAbrir={(id) => mudar({ aba: "estudio", task: id })} />
              )}
            </Suspense>
          </div>

          {podeRecarregar && (
            <DialogoDeRecarga
              aberto={recargaAberta}
              onOpenChange={setRecargaAberta}
              clientId={valor.clientId}
              clientName={valor.clientName}
              onRecarregado={(saldoNovo) => {
                // A recarga devolve o saldo novo: a barra muda na hora, sem
                // esperar a releitura do consumo e da previsão.
                if (typeof saldoNovo === "number") {
                  queryClient.setQueryData<ConsumoDoMes>(["mesa", "consumo", clientId, mesAtual], (c) => ({ ...(c || {}), saldo_usd: saldoNovo }));
                  queryClient.setQueryData<PrevisaoDoPlano>(["mesa", "previsao", clientId], (p) => (p ? { ...p, saldo_usd: saldoNovo } : p));
                }
                atualizarCusto();
                // Avisos de saldo insuficiente que estavam na tela somem.
                setVersaoCarteira((v) => v + 1);
              }}
              sugestaoUsd={previsao.data?.recarga_sugerida_usd ?? null}
            />
          )}
          {isAdmin && (chavesUsadas || modelosUsados) && (
            <Suspense fallback={null}>
              {chavesUsadas && (
                <ChavesECotas aberto={chavesAbertas} onOpenChange={setChavesAbertas} clientId={valor.clientId} clientName={valor.clientName} />
              )}
              {modelosUsados && <ModelosDeIa aberto={modelosAbertos} onOpenChange={setModelosAbertos} />}
            </Suspense>
          )}
        </MesaProvider>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Award,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Gem,
  Heart,
  Lightbulb,
  Loader2,
  Lock,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Plus,
  Radar,
  Send,
  Shuffle,
  Sparkles,
  Target,
  TrendingUp,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import type { FotoDoCliente as Foto } from "@/lib/fotoDoCliente";
import { RADAR_LENSES, type RadarIdea, type RadarLens } from "@/lib/radarIdeas";
import { useModoFoco } from "@/lib/modoFoco";
import {
  AjudaRecolhida,
  BalaoDaConversa,
  CompositorDoAgente,
  EstadoVazio,
  JanelaCentral,
  MensagensDoAgente,
  Secao,
  botao,
  campoTexto,
  conversa,
  etiqueta,
  foco,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";

/**
 * Radar de ideias da Central (16/10/2026, dono: "algo mais bonito, mais visual
 * mesmo, com o carrossel passando por lado... com ideia, com imagens também" e
 * "conversar ali com o agente para a gente conseguir trabalhar em cima daquelas
 * ideias e evoluir").
 *
 * Apresentacional: quem hospeda (AdminExperience) passa as ideias, os clientes
 * e as imagens reais recentes de cada um. Em cima, a foto de cada cliente que
 * tem ideia (filtra); embaixo, um carrossel com um cartão grande por ideia. A
 * conversa para evoluir a ideia abre numa janela central e chama a edge
 * function radar-ideas com action "evoluir".
 *
 * 16/10/2026, rodada 2 (dono: "um ícone de tela cheia, para focar melhor... quando quiser,
 * voltar" e "se eu clicar numa ideia, abrir ela, ter mais ideias e evoluir com a gente. Dá
 * para trazer mais Reels aqui também"): o botão de tela cheia liga o modo foco do painel
 * (some o topo e o que flutua; volta pelo botão, pelo Esc ou ao sair da aba). Tocar no
 * cartão abre a ideia grande na janela central, com a conversa ao lado e os atalhos "Mais
 * ideias como esta" (variações que entram no radar por onNovasIdeias) e "Ideias de Reels".
 *
 * Compatibilidade (Safari 11 / Chrome 64): sem gap em flex (margens), sem
 * aspect-ratio, scrollTo só quando existe. O carrossel rola por dentro dele;
 * a página nunca rola de lado (min-w-0 em toda a cadeia).
 */

export interface ClienteDoRadar {
  id: string;
  nome: string;
  foto?: Foto | null;
}

export interface PropsDoRadarDeIdeias {
  ideias: RadarIdea[];
  clientes: ClienteDoRadar[];
  /** URLs de imagens reais recentes por cliente (capa do cartão). Pode vir vazio. */
  imagensPorCliente?: Record<string, string[]>;
  /** Seletor de cliente + "Gerar ideias com IA" (na linha do título). */
  controles?: ReactNode;
  onLevarAoCliente: (ideia: RadarIdea) => void;
  onAbrirPerfil: (clientId: string) => void;
  /** A conversa aplicou uma versão nova: troque a antiga pela nova no estado. */
  onIdeiaEvoluida: (ideiaAntiga: RadarIdea, ideiaNova: RadarIdea) => void;
  /** "Mais ideias como esta": a equipe tocou no + de uma variação. Ponha as ideias no estado do radar. */
  onNovasIdeias?: (clienteId: string, ideias: RadarIdea[]) => void;
  className?: string;
}

/** A ideia no formato da edge function radar-ideas (geração e "evoluir"). */
export interface IdeiaDoServidor {
  titulo: string;
  descricao: string;
  por_que_agora: string;
  passos: string[];
  sinal: string;
  interno_oferta: string;
  interno_faixa_min: number;
  interno_faixa_max: number;
  interno_esforco: "baixo" | "medio" | "alto";
}

/** Atalhos da ideia aberta: o "evoluir" com `pedido` devolve variações ou Reels. */
export type PedidoDaIdeia = "variacoes" | "reels";

/** Um Reel sugerido para executar a ideia. */
export interface ReelDaIdeia {
  gancho: string;
  cena: string;
  legenda: string;
}

export interface MensagemDaIdeia {
  papel: "usuario" | "agente";
  texto: string;
  /** Só na tela (não vão ao servidor): o que o agente trouxe nos atalhos. */
  variacoes?: RadarIdea[];
  reels?: ReelDaIdeia[];
}

const ICONE_DA_LENTE: Record<RadarLens, LucideIcon> = {
  essencia: Gem,
  antecipacao: Lightbulb,
  tendencia: TrendingUp,
  encantamento: Heart,
  prova: Award,
};

/** Fundo da capa sem imagem: gradiente suave por lente. */
const FUNDO_DA_LENTE: Record<RadarLens, string> = {
  essencia: "bg-gradient-to-br from-primary/25 via-primary/10 to-muted",
  antecipacao: "bg-gradient-to-br from-warning/25 via-warning/10 to-muted",
  tendencia: "bg-gradient-to-br from-info/25 via-info/10 to-muted",
  encantamento: "bg-gradient-to-br from-destructive/20 via-primary/10 to-muted",
  prova: "bg-gradient-to-br from-success/25 via-primary/10 to-muted",
};

const ESFORCO: Record<IdeiaDoServidor["interno_esforco"], string> = { baixo: "baixo", medio: "médio", alto: "alto" };

/** O cliente da ideia: o id da ideia começa com o id do cliente ("<cliente>:<jogada>"). */
export function clienteDaIdeia(ideia: RadarIdea): string {
  return ideia.id.split(":")[0];
}

/** O título sem o "Nome do cliente: " do começo (o cartão já mostra o cliente). */
export function tituloSemCliente(titulo: string, nome?: string | null): string {
  const prefixo = nome ? `${nome}: ` : "";
  return prefixo && titulo.indexOf(prefixo) === 0 ? titulo.slice(prefixo.length) : titulo;
}

const reais = (n: number) => {
  try {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  } catch {
    return `R$ ${Math.round(n)}`;
  }
};

/** RadarIdea → formato do servidor (o que vai no body do "evoluir"). */
export function ideiaParaServidor(ideia: RadarIdea, nomeDoCliente?: string | null): IdeiaDoServidor {
  return {
    titulo: tituloSemCliente(ideia.title, nomeDoCliente),
    descricao: ideia.pitch,
    por_que_agora: ideia.whyNow,
    passos: ideia.moves.slice(),
    sinal: ideia.signal,
    interno_oferta: ideia.internal.offer,
    interno_faixa_min: ideia.internal.range[0],
    interno_faixa_max: ideia.internal.range[1],
    interno_esforco: ideia.internal.effort,
  };
}

/**
 * Resposta do servidor → RadarIdea, mantendo o id (o "Levar ao cliente" e a
 * troca no estado continuam apontando para a mesma ideia), a lente e o momento.
 */
export function ideiaDoServidor(bruta: unknown, base: RadarIdea, nomeDoCliente?: string | null): RadarIdea | null {
  if (!bruta || typeof bruta !== "object") return null;
  const r = bruta as Record<string, unknown>;
  const s = (v: unknown, reserva: string) => (typeof v === "string" && v.trim() ? v.trim() : reserva);
  const titulo = s(r.titulo, tituloSemCliente(base.title, nomeDoCliente));
  const descricao = s(r.descricao, "");
  if (!descricao) return null;
  const prefixo = nomeDoCliente && base.title.indexOf(`${nomeDoCliente}: `) === 0 ? `${nomeDoCliente}: ` : "";
  const passos = Array.isArray(r.passos) ? r.passos.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 6) : [];
  const min = Number(r.interno_faixa_min);
  const max = Number(r.interno_faixa_max);
  const esforco = r.interno_esforco === "baixo" || r.interno_esforco === "alto" || r.interno_esforco === "medio" ? r.interno_esforco : base.internal.effort;
  return {
    ...base,
    source: "ia",
    title: `${prefixo}${titulo}`,
    pitch: descricao,
    whyNow: s(r.por_que_agora, base.whyNow),
    moves: passos.length ? passos : base.moves,
    signal: s(r.sinal, base.signal),
    internal: {
      offer: s(r.interno_oferta, base.internal.offer),
      range: [Number.isFinite(min) && min >= 0 ? min : base.internal.range[0], Number.isFinite(max) && max >= 0 ? max : base.internal.range[1]],
      effort: esforco,
    },
  };
}

/**
 * Variações do servidor → RadarIdea novas (até 3), do mesmo cliente e da mesma lente, com id
 * próprio ("<cliente>:var-<momento>-<n>") para entrarem no radar sem trocar a ideia de origem.
 */
export function variacoesDoServidor(brutas: unknown, base: RadarIdea, nomeDoCliente?: string | null, momento: number = Date.now()): RadarIdea[] {
  if (!Array.isArray(brutas)) return [];
  const clientId = clienteDaIdeia(base);
  const saida: RadarIdea[] = [];
  for (const bruta of brutas) {
    if (saida.length >= 3) break;
    const r = bruta && typeof bruta === "object" ? (bruta as Record<string, unknown>) : null;
    if (!r || typeof r.titulo !== "string" || !r.titulo.trim()) continue;
    const n = saida.length;
    const nova = ideiaDoServidor(r, { ...base, id: `${clientId}:var-${momento}-${n}`, moment: "", score: base.score - 1 - n }, nomeDoCliente);
    if (nova) saida.push(nova);
  }
  return saida;
}

/** Reels do servidor (até 4), com gancho e cena obrigatórios. */
export function reelsDoServidor(brutos: unknown): ReelDaIdeia[] {
  if (!Array.isArray(brutos)) return [];
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return brutos
    .map((b) => {
      const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      return { gancho: txt(r.gancho, 200), cena: txt(r.cena, 500), legenda: txt(r.legenda, 300) };
    })
    .filter((r) => r.gancho && r.cena)
    .slice(0, 4);
}

// ───────────────────────── Cartão de uma ideia ─────────────────────────

function CapaDaIdeia({ ideia, imagem, cliente }: { ideia: RadarIdea; imagem?: string; cliente?: ClienteDoRadar }) {
  const [quebrou, setQuebrou] = useState(false);
  useEffect(() => setQuebrou(false), [imagem]);
  const Icone = ICONE_DA_LENTE[ideia.lens] || Radar;
  const lente = RADAR_LENSES[ideia.lens];
  const comImagem = !!imagem && !quebrou;
  return (
    <div className={juntar("relative h-36 w-full shrink-0 overflow-hidden sm:h-40", comImagem ? "bg-muted" : FUNDO_DA_LENTE[ideia.lens])} data-capa={comImagem ? "imagem" : "gradiente"}>
      {comImagem ? (
        <img src={imagem} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setQuebrou(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-foreground/25" aria-hidden="true">
          <Icone className="h-14 w-14" strokeWidth={1.25} />
        </span>
      )}
      {comImagem && <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" aria-hidden="true" />}
      <span className={juntar(etiqueta, "absolute left-3 top-3 bg-background/90 text-foreground")}>
        {ideia.source === "ia" ? <Sparkles className="mr-1 h-3 w-3 text-primary" aria-hidden="true" /> : <Icone className="mr-1 h-3 w-3 text-primary" aria-hidden="true" />}
        {ideia.source === "ia" ? "IA + web" : lente ? lente.label : "Ideia"}
      </span>
      {cliente && (
        <span className="absolute bottom-2.5 left-3 right-3 flex min-w-0 items-center">
          <FotoDoCliente nome={cliente.nome} foto={cliente.foto || null} tamanho="sm" className="ring-2 ring-background" />
          <span className={juntar("ml-2 min-w-0 truncate text-[12px] font-medium", comImagem ? "text-white" : "text-foreground")}>{cliente.nome}</span>
        </span>
      )}
    </div>
  );
}

function CartaoDaIdeia({
  ideia,
  posicao,
  total,
  cliente,
  imagem,
  onLevar,
  onAbrir,
  onPerfil,
}: {
  ideia: RadarIdea;
  posicao: number;
  total: number;
  cliente?: ClienteDoRadar;
  imagem?: string;
  onLevar: () => void;
  /** Abre a ideia grande (com a conversa). */
  onAbrir: () => void;
  onPerfil: () => void;
}) {
  const [aberto, setAberto] = useState<"agora" | "sinal" | null>(null);
  const titulo = tituloSemCliente(ideia.title, cliente?.nome);
  const [low, high] = ideia.internal.range;
  const alternar = (qual: "agora" | "sinal") => setAberto((a) => (a === qual ? null : qual));
  return (
    <article
      aria-roledescription="ideia"
      aria-label={`${posicao} de ${total}: ${titulo}`}
      data-ideia={ideia.id}
      onClick={(e) => {
        // Tocar no cartão abre a ideia; os controles de dentro fazem só o deles.
        const alvo = e.target as HTMLElement | null;
        if (alvo && typeof alvo.closest === "function" && alvo.closest("button, a, summary, details, input, textarea, select")) return;
        onAbrir();
      }}
      // 16/10/2026 (dono, celular: "carrossel, um cartão por tela"): abaixo de 640 px o cartão ocupa o
      // trilho inteiro e o deslize para em cada um (snap-always); só os 2 primeiros passos à vista.
      className={juntar(superficie.painel, "mr-3 flex w-full min-w-0 shrink-0 cursor-pointer snap-start snap-always flex-col overflow-hidden transition-colors last:mr-0 hover:border-primary/40 sm:mr-4 sm:w-[360px] sm:snap-normal lg:w-[400px]")}
    >
      <CapaDaIdeia ideia={ideia} imagem={imagem} cliente={cliente} />
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <h3 className={juntar(texto.tituloSecao, "line-clamp-2")} title={titulo}>
          <button type="button" onClick={onAbrir} className={juntar("rounded text-left hover:text-primary", foco)}>
            {titulo}
          </button>
        </h3>
        <p className={juntar(texto.corpo, "mt-1.5 line-clamp-2 text-foreground/85")} title={ideia.pitch}>{ideia.pitch}</p>

        {ideia.moves.length > 0 && (
          <ol className="mt-3 min-w-0 space-y-1.5" aria-label="Passos">
            {ideia.moves.slice(0, 4).map((passo, i) => (
              <li key={`${i}-${passo}`} className={juntar("flex min-w-0 items-start", i >= 2 && "max-sm:hidden")}>
                <span className="mr-2 mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary" aria-hidden="true">
                  {i + 1}
                </span>
                <span className={juntar(texto.auxiliar, "line-clamp-2 min-w-0 leading-5")}>{passo}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="-m-1 mt-2 flex min-w-0 flex-wrap items-center [&>*]:m-1">
          <button type="button" className={juntar(botao.barra, aberto === "agora" && "bg-muted text-foreground")} aria-expanded={aberto === "agora"} onClick={() => alternar("agora")}>
            <Clock className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Por que agora
          </button>
          <button type="button" className={juntar(botao.barra, aberto === "sinal" && "bg-muted text-foreground")} aria-expanded={aberto === "sinal"} onClick={() => alternar("sinal")}>
            <Target className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Sinal
          </button>
        </div>
        {aberto === "agora" && (
          <div className={juntar(superficie.poco, "mt-1.5 px-3 py-2 text-[12px] leading-5 text-muted-foreground")} data-aberto="agora">
            {ideia.moment && <p className="mb-1 text-foreground/80">{ideia.moment}</p>}
            <p>{ideia.whyNow}</p>
          </div>
        )}
        {aberto === "sinal" && (
          <div className={juntar(superficie.poco, "mt-1.5 px-3 py-2 text-[12px] leading-5 text-muted-foreground")} data-aberto="sinal">
            <p>{ideia.signal}</p>
          </div>
        )}

        <details className="group mt-2 min-w-0">
          <summary className={juntar("inline-flex cursor-pointer list-none items-center rounded-md px-1 text-[12px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden", foco)}>
            <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
            Só a equipe
          </summary>
          <div className="mt-1.5 flex min-w-0 items-start rounded-md bg-warning/[0.07] px-3 py-2 text-[12px] leading-5 text-muted-foreground">
            <p className="min-w-0 flex-1">
              Pode virar: <span className="text-foreground/80">{ideia.internal.offer}</span>
              {high > 0 && ` · ${reais(low)} a ${reais(high)}`} · esforço {ESFORCO[ideia.internal.effort] || ideia.internal.effort}
            </p>
            <AjudaRecolhida className="ml-1" rotulo="Sobre a faixa de valor">
              Você decide se cobra, quanto cobra ou se entrega como cortesia. A faixa é só um ponto de partida e nada disso vai para o cliente.
            </AjudaRecolhida>
          </div>
        </details>

        <div className="-m-1 mt-auto flex min-w-0 flex-wrap items-center pt-4 [&>*]:m-1">
          <button type="button" onClick={onLevar} className={botao.primario}>
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Levar ao cliente
          </button>
          <button type="button" onClick={onAbrir} className={botao.discreto} aria-label="Evoluir com o agente">
            <MessagesSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            <span className="sm:hidden">Evoluir</span>
            <span className="hidden sm:inline">Evoluir com o agente</span>
          </button>
          <button type="button" onClick={onPerfil} className={juntar(botao.icone, "ml-auto")} aria-label={`Ver perfil de ${cliente?.nome || "cliente"}`} title="Ver perfil do cliente">
            <UserCircle className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

// ───────────────────────── A ideia aberta (com a conversa) ─────────────────────────

const ATALHOS = ["Mais ousada", "Mais barata de executar", "Em formato de vídeo", "Passos mais concretos"];

const TEXTO_DO_PEDIDO: Record<PedidoDaIdeia, string> = {
  variacoes: "Mais ideias como esta",
  reels: "Ideias de Reels",
};

function NumeroDoPasso({ n }: { n: number }) {
  return (
    <span className="mr-2 mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary" aria-hidden="true">
      {n}
    </span>
  );
}

/** Variações que o agente trouxe, dentro do balão dele: tocar no + põe a ideia no radar. */
function VariacoesNaConversa({ variacoes, nome, onAdicionar }: { variacoes: RadarIdea[]; nome?: string; onAdicionar?: (ideia: RadarIdea) => void }) {
  const [adicionadas, setAdicionadas] = useState<Record<string, true>>({});
  return (
    <ul className="mt-2 space-y-2" aria-label="Variações da ideia" data-variacoes="">
      {variacoes.map((v) => {
        const titulo = tituloSemCliente(v.title, nome);
        const feita = !!adicionadas[v.id];
        return (
          <li key={v.id} className="flex min-w-0 items-start border-t border-border/60 pt-2 first:border-t-0 first:pt-0" data-variacao={v.id}>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{titulo}</p>
              <p className="mt-0.5 line-clamp-3 text-[13px] text-muted-foreground" title={v.pitch}>
                {v.pitch}
              </p>
            </div>
            {onAdicionar && (
              <button
                type="button"
                disabled={feita}
                onClick={() => {
                  onAdicionar(v);
                  setAdicionadas((a) => ({ ...a, [v.id]: true }));
                }}
                aria-label={feita ? `${titulo} já está no radar` : `Adicionar ao radar: ${titulo}`}
                title={feita ? "Já está no radar" : "Adicionar ao radar"}
                className={juntar(botao.icone, "ml-2 disabled:text-primary disabled:opacity-100")}
              >
                {feita ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Reels sugeridos, dentro do balão do agente: gancho, o que mostrar e a legenda curta. */
function ReelsNaConversa({ reels }: { reels: ReelDaIdeia[] }) {
  return (
    <ol className="mt-2 space-y-2" aria-label="Ideias de Reels" data-reels="">
      {reels.map((r, i) => (
        <li key={`${i}-${r.gancho}`} className="flex min-w-0 items-start border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
          <Clapperboard className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{r.gancho}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{r.cena}</p>
            {r.legenda && <p className="mt-0.5 text-[13px] italic text-foreground/70">{r.legenda}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A ideia aberta em tela grande (16/10/2026, dono: "se eu clicar numa ideia, abrir ela, ter
 * mais ideias e evoluir com a gente. Dá para trazer mais Reels aqui também"). À esquerda (em
 * cima, no celular) a ideia inteira com os dois atalhos; à direita (embaixo) a conversa com o
 * agente. "Mais ideias como esta" e "Ideias de Reels" chamam o mesmo "evoluir" com `pedido`, e
 * a resposta chega na conversa (as variações com o + para entrar no radar).
 */
function IdeiaAberta({
  ideia,
  cliente,
  imagem,
  onFechar,
  onAplicar,
  onNovasIdeias,
}: {
  ideia: RadarIdea;
  cliente?: ClienteDoRadar;
  imagem?: string;
  onFechar: () => void;
  onAplicar: (nova: RadarIdea) => void;
  onNovasIdeias?: (clienteId: string, ideias: RadarIdea[]) => void;
}) {
  const [mensagens, setMensagens] = useState<MensagemDaIdeia[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [proposta, setProposta] = useState<RadarIdea | null>(null);
  const fimDaConversa = useRef<HTMLDivElement | null>(null);
  const vista = proposta || ideia;
  const nome = cliente?.nome;
  const clientId = clienteDaIdeia(ideia);
  const [low, high] = vista.internal.range;

  useEffect(() => {
    const el = fimDaConversa.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens, carregando]);

  const enviar = async (textoDoPedido: string, pedido?: PedidoDaIdeia) => {
    const fala = textoDoPedido.trim();
    if (!fala || carregando) return;
    const historico: MensagemDaIdeia[] = [...mensagens, { papel: "usuario", texto: fala }];
    setMensagens(historico);
    if (!pedido) setRascunho("");
    setErro("");
    setCarregando(true);
    try {
      const { data, error } = await supabase.functions.invoke("radar-ideas", {
        body: {
          action: "evoluir",
          client_id: clientId,
          ideia: ideiaParaServidor(vista, nome),
          // Só a fala vai ao servidor (as listas que o agente trouxe ficam aqui).
          mensagens: historico.map((m) => ({ papel: m.papel, texto: m.texto })),
          ...(pedido ? { pedido } : {}),
        },
      });
      if (error) throw new Error(error.message || "O agente não respondeu.");
      if (data?.error) throw new Error(String(data.error));
      const resposta = typeof data?.resposta === "string" && data.resposta.trim() ? data.resposta.trim() : pedido ? "Aqui estão." : "Ajustei a ideia.";
      const variacoes = pedido === "variacoes" ? variacoesDoServidor(data?.variacoes, vista, nome) : [];
      const reels = pedido === "reels" ? reelsDoServidor(data?.reels) : [];
      setMensagens((m) => [...m, { papel: "agente", texto: resposta, ...(variacoes.length ? { variacoes } : {}), ...(reels.length ? { reels } : {}) }]);
      // Com pedido a ideia não muda; sem pedido, a versão nova fica pronta para aplicar.
      if (!pedido) {
        const nova = ideiaDoServidor(data?.ideia, vista, nome);
        if (nova) setProposta(nova);
      }
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível falar com o agente agora.");
    } finally {
      setCarregando(false);
    }
  };

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void enviar(rascunho);
    }
  };

  const titulo = tituloSemCliente(vista.title, nome);
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      titulo={nome || "Ideia do radar"}
      icone={<Radar className="h-4 w-4" />}
      ajuda="A ideia inteira e a conversa com o agente do Radar. Ele relê o contexto real do cliente (dossiê, entregas, Instagram). Mais ideias como esta traz variações (o + põe a variação no radar); Ideias de Reels traz Reels para executar a ideia. Nada muda na ideia até você tocar em Aplicar."
      rotuloDaAjuda="Como funciona"
      largura="tela"
      corpo="fixo"
      semEspaco
      classeDoCorpo="lg:flex-row"
      data-ideia-aberta=""
      data-conversa-da-ideia=""
      rodape={
        <>
          <button type="button" onClick={onFechar} className={botao.discreto}>
            Fechar
          </button>
          <button type="button" disabled={!proposta || carregando} onClick={() => proposta && onAplicar(proposta)} className={botao.primario}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Aplicar esta versão
          </button>
        </>
      }
    >
      {/* A ideia: em cima no celular (até 45% da altura, rola por dentro); à esquerda no computador. */}
      <div
        className="max-h-[45%] min-w-0 shrink-0 overflow-y-auto overscroll-contain border-b border-border lg:max-h-none lg:w-[55%] lg:shrink-0 lg:border-b-0 lg:border-r"
        data-ideia-atual=""
      >
        <div className="hidden lg:block">
          <CapaDaIdeia ideia={vista} imagem={imagem} />
        </div>
        <div className="px-4 py-3 sm:px-5 lg:py-4">
          <span className={juntar(etiqueta, proposta ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{proposta ? "Nova versão" : "Ideia atual"}</span>
          <p className={juntar(texto.tituloSecao, "mt-1.5 lg:text-[18px] lg:leading-7")}>{titulo}</p>
          <p className={juntar(texto.corpo, "mt-1 text-foreground/85")}>{vista.pitch}</p>

          <div className="-m-1 mt-3 flex min-w-0 flex-wrap items-center [&>*]:m-1">
            <button type="button" disabled={carregando} onClick={() => void enviar(TEXTO_DO_PEDIDO.variacoes, "variacoes")} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}>
              <Shuffle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {TEXTO_DO_PEDIDO.variacoes}
            </button>
            <button type="button" disabled={carregando} onClick={() => void enviar(TEXTO_DO_PEDIDO.reels, "reels")} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}>
              <Clapperboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {TEXTO_DO_PEDIDO.reels}
            </button>
          </div>

          {vista.moves.length > 0 && (
            <ol className="mt-3 space-y-1.5" aria-label="Passos">
              {vista.moves.map((passo, i) => (
                <li key={`${i}-${passo}`} className="flex min-w-0 items-start">
                  <NumeroDoPasso n={i + 1} />
                  <span className={juntar(texto.auxiliar, "min-w-0 leading-5")}>{passo}</span>
                </li>
              ))}
            </ol>
          )}
          <p className={juntar(texto.auxiliar, "mt-3 leading-5")}>
            <Clock className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
            <span className="sr-only">Por que agora: </span>
            <span>{vista.moment ? `${vista.moment} ${vista.whyNow}` : vista.whyNow}</span>
          </p>
          <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>
            <Target className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
            <span className="sr-only">Sinal: </span>
            <span>{vista.signal}</span>
          </p>
          <details className="mt-2 min-w-0">
            <summary className={juntar("inline-flex cursor-pointer list-none items-center rounded-md px-1 text-[12px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden", foco)}>
              <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
              Só a equipe
            </summary>
            <p className="mt-1.5 rounded-md bg-warning/[0.07] px-3 py-2 text-[12px] leading-5 text-muted-foreground">
              Pode virar: <span className="text-foreground/80">{vista.internal.offer}</span>
              {high > 0 && ` · ${reais(low)} a ${reais(high)}`} · esforço {ESFORCO[vista.internal.effort] || vista.internal.effort}
            </p>
          </details>
        </div>
      </div>

      {/* A conversa: embaixo no celular, à direita no computador. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MensagensDoAgente ref={fimDaConversa} rotulo="Conversa sobre a ideia">
          {mensagens.length === 0 && !carregando && <p className={conversa.apoio}>Diga o que mudar. O agente devolve a ideia reescrita.</p>}
          {mensagens.map((m, i) => (
            <BalaoDaConversa key={i} de={m.papel === "usuario" ? "usuario" : "agente"}>
              <p className="whitespace-pre-wrap">{m.texto}</p>
              {m.variacoes && m.variacoes.length > 0 && (
                <VariacoesNaConversa variacoes={m.variacoes} nome={nome} onAdicionar={onNovasIdeias ? (v) => onNovasIdeias(clientId, [v]) : undefined} />
              )}
              {m.reels && m.reels.length > 0 && <ReelsNaConversa reels={m.reels} />}
            </BalaoDaConversa>
          ))}
          {carregando && (
            <BalaoDaConversa de="agente">
              <span className="inline-flex items-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Relendo o cliente...
              </span>
            </BalaoDaConversa>
          )}
        </MensagensDoAgente>

        <CompositorDoAgente>
          {erro && (
            <p role="alert" className="text-[12px] text-destructive">
              {erro}
            </p>
          )}
          {mensagens.length === 0 && (
            <div className="-m-1 flex min-w-0 flex-wrap [&>*]:m-1">
              {ATALHOS.map((a) => (
                <button key={a} type="button" disabled={carregando} onClick={() => void enviar(a)} className={juntar(botao.barra, "border border-border")}>
                  {a}
                </button>
              ))}
            </div>
          )}
          <div className="flex min-w-0 items-end">
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={aoTeclar}
              rows={2}
              placeholder="Ex.: deixa mais simples, com foco no Instagram"
              aria-label="Mensagem para o agente"
              className={juntar(campoTexto, "min-h-[44px] flex-1 resize-none")}
            />
            <button
              type="button"
              onClick={() => void enviar(rascunho)}
              disabled={!rascunho.trim() || carregando}
              aria-label="Enviar"
              title="Enviar"
              className={juntar(botao.primario, "ml-2 w-9 px-0")}
            >
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </CompositorDoAgente>
      </div>
    </JanelaCentral>
  );
}

// ───────────────────────── O Radar ─────────────────────────

export default function RadarDeIdeias({
  ideias,
  clientes,
  imagensPorCliente = {},
  controles,
  onLevarAoCliente,
  onAbrirPerfil,
  onIdeiaEvoluida,
  onNovasIdeias,
  className = "",
}: PropsDoRadarDeIdeias) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const [atual, setAtual] = useState(0);
  const [aberta, setAberta] = useState<RadarIdea | null>(null);
  const [focoLigado, setFocoLigado] = useState(false);
  const trilho = useRef<HTMLDivElement | null>(null);

  // Tela cheia = modo foco do painel (some o topo e o que flutua). Desliga ao sair da aba (desmontar).
  useModoFoco("radar-de-ideias", focoLigado);
  useEffect(() => {
    if (!focoLigado) return;
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      // Esc com a ideia aberta fecha só a janela.
      if (e.defaultPrevented || document.querySelector("[data-janela-central]")) return;
      setFocoLigado(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [focoLigado]);

  const clientePorId = useMemo(() => {
    const m: Record<string, ClienteDoRadar> = {};
    for (const c of clientes) m[c.id] = c;
    return m;
  }, [clientes]);

  // Clientes com ideia, na ordem em que aparecem as ideias (a mais forte primeiro).
  const clientesComIdeia = useMemo(() => {
    const contagem: Record<string, number> = {};
    const ordem: string[] = [];
    for (const ideia of ideias) {
      const id = clienteDaIdeia(ideia);
      if (!(id in contagem)) {
        contagem[id] = 0;
        ordem.push(id);
      }
      contagem[id] += 1;
    }
    return ordem.map((id) => ({ cliente: clientePorId[id] || { id, nome: "Cliente" }, total: contagem[id] }));
  }, [ideias, clientePorId]);

  // Filtro de um cliente que não tem mais ideia volta para "Todos".
  const filtroValido = filtro && clientesComIdeia.some((c) => c.cliente.id === filtro) ? filtro : null;
  const visiveis = useMemo(() => (filtroValido ? ideias.filter((i) => clienteDaIdeia(i) === filtroValido) : ideias), [ideias, filtroValido]);
  const total = visiveis.length;
  const posicao = Math.min(atual, Math.max(0, total - 1));

  // Capa: as imagens do cliente se revezam entre as ideias dele.
  const capas = useMemo(() => {
    const vez: Record<string, number> = {};
    const out: Record<string, string | undefined> = {};
    for (const ideia of ideias) {
      const id = clienteDaIdeia(ideia);
      const lista = imagensPorCliente[id] || [];
      const k = vez[id] || 0;
      vez[id] = k + 1;
      out[ideia.id] = lista.length ? lista[k % lista.length] : undefined;
    }
    return out;
  }, [ideias, imagensPorCliente]);

  const rolarAte = (i: number) => {
    const el = trilho.current;
    const alvo = el ? (el.children[i] as HTMLElement | undefined) : undefined;
    if (!el || !alvo) return;
    const left = alvo.offsetLeft;
    try {
      if (typeof el.scrollTo === "function") el.scrollTo({ left, behavior: "smooth" });
      else el.scrollLeft = left;
    } catch {
      el.scrollLeft = left;
    }
  };

  const ir = (i: number) => {
    if (total === 0) return;
    const n = Math.max(0, Math.min(total - 1, i));
    setAtual(n);
    rolarAte(n);
  };

  const filtrar = (id: string | null) => {
    setFiltro(id);
    setAtual(0);
    const el = trilho.current;
    if (el) el.scrollLeft = 0;
  };

  // Deslizar no celular (ou rolar de lado no touchpad) atualiza o indicador.
  const aoRolar = () => {
    const el = trilho.current;
    if (!el || el.children.length === 0) return;
    let melhor = 0;
    let menor = Infinity;
    for (let i = 0; i < el.children.length; i += 1) {
      const d = Math.abs((el.children[i] as HTMLElement).offsetLeft - el.scrollLeft);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    }
    // No fim do trilho o último cartão pode não encostar à esquerda.
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 && el.scrollWidth > el.clientWidth) melhor = el.children.length - 1;
    if (melhor !== posicao) setAtual(melhor);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      ir(posicao + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      ir(posicao - 1);
    }
  };

  const clienteDaAberta = aberta ? clientePorId[clienteDaIdeia(aberta)] : undefined;
  const chip = (ativo: boolean) =>
    juntar(
      "toque-compacto mr-2 inline-flex h-11 shrink-0 items-center rounded-full border py-1 pl-1 pr-3 text-[12px] font-medium transition-colors last:mr-0",
      ativo ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      foco,
    );

  return (
    <Secao
      titulo="Radar de ideias"
      descricao={ideias.length > 0 ? `${ideias.length} ${ideias.length === 1 ? "ideia" : "ideias"}` : undefined}
      ajuda="O Radar é o ritual de antecipação da carteira recorrente: uma vez por mês a Aceleriq chega com uma ideia de diferenciação que o cliente até já pensou em fazer e nunca executou. Cada ideia nasce do momento real dele. A faixa de valor fica em Só a equipe e nunca entra na mensagem do cliente. Toque numa ideia para abrir: dá para conversar com o agente, pedir mais ideias como ela e ideias de Reels. O ícone de tela cheia esconde o topo do painel; volta pelo mesmo ícone ou Esc."
      acao={
        <>
          {controles}
          <button
            type="button"
            onClick={() => setFocoLigado((f) => !f)}
            aria-pressed={focoLigado}
            aria-label={focoLigado ? "Sair da tela cheia" : "Tela cheia"}
            title={focoLigado ? "Sair da tela cheia (Esc)" : "Tela cheia"}
            className={botao.icone}
            data-tela-cheia-do-radar=""
          >
            {focoLigado ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        </>
      }
      className={juntar("min-w-0", className)}
      corpoClassName="min-w-0"
      data-radar-de-ideias=""
    >
      {ideias.length === 0 ? (
        <EstadoVazio icone={<Radar className="h-5 w-5" />} titulo="Nenhuma ideia no radar agora." descricao="As ideias do mês aparecem aqui por cliente." />
      ) : (
        <div className="min-w-0">
          {/* Clientes com ideia: tocar filtra. */}
          <div className="flex min-w-0 items-center">
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por cliente">
              <button type="button" aria-pressed={!filtroValido} onClick={() => filtrar(null)} className={juntar(chip(!filtroValido), "pl-3")}>
                Todos
                <span className="ml-1.5 tabular-nums text-muted-foreground">{ideias.length}</span>
              </button>
              {clientesComIdeia.map(({ cliente, total: n }) => (
                <button
                  key={cliente.id}
                  type="button"
                  aria-pressed={filtroValido === cliente.id}
                  aria-label={`${cliente.nome}, ${n} ${n === 1 ? "ideia" : "ideias"}`}
                  title={cliente.nome}
                  onClick={() => filtrar(filtroValido === cliente.id ? null : cliente.id)}
                  className={chip(filtroValido === cliente.id)}
                >
                  <FotoDoCliente nome={cliente.nome} foto={cliente.foto || null} tamanho="sm" />
                  <span className="ml-2 max-w-[140px] truncate">{cliente.nome}</span>
                  <span className="ml-1.5 tabular-nums text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
            <div className="ml-2 hidden shrink-0 items-center sm:flex">
              <button type="button" onClick={() => ir(posicao - 1)} disabled={posicao <= 0} aria-label="Ideia anterior" title="Ideia anterior" className={juntar(botao.icone, "disabled:opacity-40")}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => ir(posicao + 1)} disabled={posicao >= total - 1} aria-label="Próxima ideia" title="Próxima ideia" className={juntar(botao.icone, "ml-1 disabled:opacity-40")}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* O carrossel: rola por dentro dele, um cartão por ideia. */}
          <div
            ref={trilho}
            onScroll={aoRolar}
            onKeyDown={aoTeclar}
            tabIndex={0}
            role="region"
            aria-roledescription="carrossel"
            aria-label="Ideias do radar"
            data-carrossel=""
            className={juntar("relative mt-3 flex min-w-0 snap-x snap-mandatory items-stretch overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:thin]", foco)}
          >
            {visiveis.map((ideia, i) => {
              const id = clienteDaIdeia(ideia);
              return (
                <CartaoDaIdeia
                  key={ideia.id}
                  ideia={ideia}
                  posicao={i + 1}
                  total={total}
                  cliente={clientePorId[id]}
                  imagem={capas[ideia.id]}
                  onLevar={() => onLevarAoCliente(ideia)}
                  onAbrir={() => setAberta(ideia)}
                  onPerfil={() => onAbrirPerfil(id)}
                />
              );
            })}
          </div>

          {/* Onde estou: pontos (até 12) e "2 de 7". */}
          <div className="mt-1 flex min-w-0 items-center justify-center" data-indicador="">
            {total > 1 && total <= 12 && (
              <div className="mr-3 flex items-center">
                {visiveis.map((ideia, i) => (
                  <button
                    key={ideia.id}
                    type="button"
                    onClick={() => ir(i)}
                    aria-label={`Ir para a ideia ${i + 1}`}
                    aria-current={i === posicao ? "true" : undefined}
                    className={juntar("toque-compacto mx-0.5 flex h-4 items-center justify-center", foco)}
                  >
                    <span className={juntar("block h-1.5 rounded-full transition-all", i === posicao ? "w-5 bg-primary" : "w-1.5 bg-border")} />
                  </button>
                ))}
              </div>
            )}
            <span className={juntar(texto.auxiliar, "tabular-nums")} aria-live="polite">
              {total > 0 ? `${posicao + 1} de ${total}` : ""}
            </span>
          </div>
        </div>
      )}

      {aberta && (
        <IdeiaAberta
          key={aberta.id}
          ideia={aberta}
          cliente={clienteDaAberta}
          imagem={capas[aberta.id]}
          onFechar={() => setAberta(null)}
          onAplicar={(nova) => {
            onIdeiaEvoluida(aberta, nova);
            setAberta(null);
            toast.success("Ideia atualizada.");
          }}
          onNovasIdeias={
            onNovasIdeias
              ? (clienteId, novas) => {
                  onNovasIdeias(clienteId, novas);
                  toast.success(novas.length === 1 ? "Ideia adicionada ao radar." : "Ideias adicionadas ao radar.");
                }
              : undefined
          }
        />
      )}
    </Secao>
  );
}

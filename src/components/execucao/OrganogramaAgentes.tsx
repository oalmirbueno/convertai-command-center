import { useEffect, useRef, useState } from "react";
import { Bot, Crown, Expand, Minimize, Minus, Network, Plus, ScanSearch } from "lucide-react";
import { Secao, juntar, superficie, useEstadoDaTela } from "@/components/sistema";
import TituloRecolhivel from "@/components/sistema/TituloRecolhivel";
import { cn } from "@/lib/utils";

/**
 * A pirâmide da casa: quem manda, quem coordena, quem executa.
 *
 * O dono no topo, o Hermes como porta de entrada (é por ele que a
 * conversa chega e volta), o coordenador no meio e os operadores na base,
 * separados por função.
 *
 * SOBRE AS SUPERFÍCIES, que é onde a versão anterior falhava: este tema é
 * escuro-primeiro, com fundo em 5% de luz, cartão em 10% e muted em 13%.
 * Um `bg-muted/20` ali vira 13% a um quinto de opacidade sobre 5% — some.
 * Por isso aqui toda superfície é SÓLIDA e a hierarquia visual se faz por
 * degraus de elevação (fundo → cartão → grupo → agente), não por opacidade.
 * Cor translúcida fica só onde é enfeite pequeno sobre superfície sólida:
 * selo, monograma, barra de acento.
 *
 * AO VIVO (17/10, pedido do dono: "ver eles trabalhando, o que está
 * acontecendo"): cada cartão diz o que o agente está fazendo agora e há
 * quanto tempo; quem trabalha pulsa e tem a barra correndo embaixo; a faixa
 * "Movimentação agora" lista o que acabou de acontecer. Os dados já se
 * renovam a cada 10 s na página; o relógio daqui só atualiza o "há X min".
 *
 * SEM VAZAR: os coordenadores quebram linha (antes eram uma fila só, e com
 * os 7 que vieram do Paperclip o primeiro ia para fora da tela). No
 * computador há zoom e tela cheia para ver a casa inteira de uma vez.
 *
 * Uma honestidade que o desenho precisa carregar: o painel NÃO dispara o
 * agente sozinho. Não existe canal do painel para dentro do Hermes; o que
 * existe é o comando pronto para colar no grupo.
 */

export interface NoDoOrganograma {
  id: string;
  nome: string;
  papel: string;
  nivel: "dono" | "gateway" | "coordenador" | "operador";
  ativo?: boolean;
  emAndamento?: number;
  feitas?: number;
  bloqueadas?: number;
  /** Função do agente. É ela que agrupa a base da pirâmide. */
  area?: string | null;
  /** Nome de quem coordena. Vazio = responde direto ao Hermes. */
  chefe?: string | null;
  /** O que o agente está fazendo agora (execução aberta ou tarefa em andamento). */
  agora?: string | null;
  /** Desde quando (última batida da execução ou atualização da tarefa). */
  agoraDesde?: string | null;
  /** A última execução do agente, para quem está parado. */
  ultimaVez?: string | null;
}

/** Uma linha da faixa "Movimentação agora". */
export interface MovimentoDoOrganograma {
  id: string;
  agenteId: string;
  agente: string;
  texto: string;
  quando: string;
  tom: "andamento" | "feito" | "bloqueado" | "outro";
}

/** As iniciais do nome, para o cartão ter um rosto em vez de só texto. */
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** "agora", "há 4 min", "há 2 h", "há 3 d". */
export function haQuanto(iso: string | null | undefined, agora: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((agora - t) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/* Um acento por área, estável: a mesma função sempre recebe a mesma cor,
   porque a chave é o nome e não a posição na lista. Cor que dança a cada
   agente novo cadastrado destreinaria o olho de quem usa todo dia. */
const ACENTOS = [
  "bg-primary", "bg-info", "bg-success", "bg-warning", "bg-destructive",
] as const;
function acentoDaArea(area: string) {
  let soma = 0;
  for (let i = 0; i < area.length; i += 1) soma = (soma + area.charCodeAt(i)) % 9973;
  return ACENTOS[soma % ACENTOS.length];
}

/** Zoom do computador: de 50% a 150%, de 10 em 10. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const limitarZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));

/* O movimento: o ponto que desce pelo tronco, a barra que corre embaixo de
   quem trabalha e a entrada suave de cada linha nova na faixa. */
const ESTILO_DO_MOVIMENTO = `
@keyframes organograma-fluxo { 0% { transform: translateY(-4px); opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(var(--organograma-altura, 20px)); opacity: 0; } }
@keyframes organograma-barra { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
@keyframes organograma-entra { 0% { transform: translateY(-6px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
.organograma-fluxo { animation: organograma-fluxo 1.6s ease-in infinite; }
.organograma-barra { animation: organograma-barra 1.8s ease-in-out infinite; }
.organograma-entra { animation: organograma-entra 0.45s ease-out both; }
`;

export default function OrganogramaAgentes({
  nos,
  aoAbrir,
  nomeDoDono,
  movimentos = [],
}: {
  nos: NoDoOrganograma[];
  aoAbrir: (no: NoDoOrganograma) => void;
  nomeDoDono: string;
  movimentos?: MovimentoDoOrganograma[];
}) {
  const coordenadores = nos.filter((n) => n.nivel === "coordenador");
  const operadores = nos.filter((n) => n.nivel === "operador");

  // Agrupa por função, preservando a ordem em que os agentes chegaram (a
  // consulta já vem ordenada por display_order). Quem ainda não tem área
  // vai para o fim, num grupo com nome honesto em vez de sumir da tela.
  const porArea = new Map<string, NoDoOrganograma[]>();
  for (const o of operadores) {
    const chave = o.area?.trim() || "Sem área definida";
    const atual = porArea.get(chave);
    if (atual) atual.push(o);
    else porArea.set(chave, [o]);
  }
  const areas = [...porArea.entries()].sort(([a], [b]) =>
    a === "Sem área definida" ? 1 : b === "Sem área definida" ? -1 : a.localeCompare(b, "pt-BR"),
  );

  const total = operadores.length + coordenadores.length;
  const ativos = [...operadores, ...coordenadores].filter((o) => o.ativo !== false).length;
  const trabalhando = [...operadores, ...coordenadores].reduce((s, o) => s + (o.emAndamento ?? 0), 0);
  const trabalhaAgora = (no: NoDoOrganograma) => (no.emAndamento ?? 0) > 0 || Boolean(no.agora);
  const agentesTrabalhando = [...operadores, ...coordenadores].filter(trabalhaAgora).length;

  // Tudo recolhe (SISTEMA.md 4.3): cada função recolhe e volta; a escolha
  // fica guardada (sair e voltar mantém).
  const [fechadas, setFechadas] = useEstadoDaTela<Record<string, boolean>>("execucao:organograma:fechadas", {}, {
    validar: (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v),
  });
  const [zoom, setZoom] = useEstadoDaTela<number>("execucao:organograma:zoom", 1, {
    validar: (v) => typeof v === "number" && v >= ZOOM_MIN && v <= ZOOM_MAX,
  });

  // O relógio do "há X min": a cada 30 s, sem buscar nada de novo.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Tela cheia (só no computador): a casa inteira, sem o resto do painel.
  const palcoRef = useRef<HTMLDivElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const aoMudar = () => setTelaCheia(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", aoMudar);
    document.addEventListener("webkitfullscreenchange", aoMudar);
    return () => {
      document.removeEventListener("fullscreenchange", aoMudar);
      document.removeEventListener("webkitfullscreenchange", aoMudar);
    };
  }, []);
  const alternarTelaCheia = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) void doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    const el = palcoRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen();
    else el.webkitRequestFullscreen?.();
  };

  // "Ajustar": o zoom que faz a pirâmide caber na largura da tela.
  const conteudoRef = useRef<HTMLDivElement>(null);
  const ajustarNaTela = () => {
    const palco = palcoRef.current;
    const conteudo = conteudoRef.current;
    if (!palco || !conteudo) return;
    const larguraNatural = conteudo.scrollWidth / (zoom || 1);
    const alturaNatural = conteudo.scrollHeight / (zoom || 1);
    const porLargura = (palco.clientWidth - 16) / larguraNatural;
    const porAltura = telaCheia ? (window.innerHeight - 120) / alturaNatural : porLargura;
    setZoom(limitarZoom(Math.min(1, porLargura, porAltura)));
  };

  const Caixa = ({
    no,
    destaque,
    acento,
  }: {
    no: NoDoOrganograma;
    destaque?: "dono" | "gateway";
    acento?: string;
  }) => {
    const numeros = [
      { valor: no.emAndamento ?? 0, cor: "text-info", titulo: "em andamento" },
      { valor: no.feitas ?? 0, cor: "text-success", titulo: "feitas" },
      { valor: no.bloqueadas ?? 0, cor: "text-destructive", titulo: "bloqueadas" },
    ].filter((n) => n.valor > 0);
    const trabalha = !destaque && trabalhaAgora(no);
    const travado = !destaque && (no.bloqueadas ?? 0) > 0;
    const parado = !destaque && !trabalha && no.ativo !== false;

    return (
      <button
        type="button"
        onClick={() => aoAbrir(no)}
        title={no.papel}
        data-trabalhando={trabalha ? "" : undefined}
        /* Cartão com função (item do organograma): a superfície do sistema,
           com a borda tingida só no dono, no Hermes e em quem trabalha. */
        className={juntar(
          superficie.painel,
          "group relative w-full overflow-hidden text-left transition-colors",
          "hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          destaque === "dono" ? "border-primary/50" : destaque === "gateway" ? "border-info/50" : trabalha ? "border-info/60" : "",
        )}
      >
        {/* A barra de acento à esquerda: é ela que agrupa visualmente sem
            precisar tingir o fundo inteiro, que é o que sumia no escuro. */}
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            destaque === "dono" ? "bg-primary"
              : destaque === "gateway" ? "bg-info"
                : acento ?? "bg-border",
          )}
          aria-hidden
        />

        <div className="flex items-start p-3 pl-4">
          <span
            className={cn(
              "relative mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold",
              destaque === "dono"
                ? "bg-primary/20 text-primary"
                : destaque === "gateway"
                  ? "bg-info/20 text-info"
                  : "bg-secondary text-foreground",
            )}
          >
            {destaque === "dono" ? (
              <Crown className="h-4 w-4" />
            ) : destaque === "gateway" ? (
              <Network className="h-4 w-4" />
            ) : (
              iniciais(no.nome)
            )}
            {/* Quem trabalha pulsa: dá para ver de longe quem está em ação. */}
            {trabalha && (
              <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-info" />
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center [&>*+*]:ml-1.5">
              {/* Ponto de estado: azul trabalhando, verde pronto, vermelho
                  travado, cinza pausado. Uma bolinha lê mais rápido que a
                  palavra no canto. */}
              {no.nivel !== "dono" && no.nivel !== "gateway" && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    no.ativo === false ? "bg-muted-foreground" : travado ? "bg-destructive" : trabalha ? "bg-info" : "bg-success",
                  )}
                  aria-hidden
                />
              )}
              <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
                {no.nome}
              </p>
              {no.nivel === "coordenador" && (
                <span className="shrink-0 rounded bg-primary/20 px-1.5 py-px text-[11px] font-medium text-primary">
                  coordena
                </span>
              )}
            </div>
            {trabalha && no.agora ? (
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-foreground" data-agora="">
                <span className="font-medium text-info">Agora: </span>{no.agora}
              </p>
            ) : (
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                {no.papel}
              </p>
            )}
            {trabalha && no.agoraDesde ? (
              <p className="mt-1 text-[11px] tabular-nums text-info">trabalhando · {haQuanto(no.agoraDesde, agora)}</p>
            ) : parado && no.ultimaVez ? (
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">livre · última vez {haQuanto(no.ultimaVez, agora)}</p>
            ) : null}
            {no.chefe && (
              <p className="mt-1 flex items-center truncate text-[11px] text-muted-foreground">
                <Bot className="mr-1 h-2.5 w-2.5 shrink-0" />
                responde a {no.chefe}
              </p>
            )}
          </div>
        </div>

        {numeros.length > 0 && (
          <div className="flex flex-wrap items-center border-t border-border px-3 py-1.5 pl-4 [&>*]:mr-2.5">
            {numeros.map((n) => (
              <span key={n.titulo} className="flex items-baseline text-[11px] [&>*+*]:ml-1">
                <strong className={cn("text-[11px] font-bold tabular-nums", n.cor)}>{n.valor}</strong>
                <span className="text-muted-foreground">{n.titulo}</span>
              </span>
            ))}
          </div>
        )}

        {no.ativo === false && (
          <div className="border-t border-border bg-secondary px-3 py-1 pl-4 text-[11px] font-medium text-muted-foreground">
            pausado
          </div>
        )}

        {/* A barra que corre embaixo de quem está trabalhando. */}
        {trabalha && (
          <span className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-full overflow-hidden" aria-hidden>
            <span className="organograma-barra absolute inset-y-0 left-0 w-1/3 rounded-full bg-info" />
          </span>
        )}
      </button>
    );
  };

  /* Tronco vertical: cor sólida. A versão anterior usava gradiente para
     border/40, que no escuro terminava em nada e cortava a linha no meio.
     Com trabalho na casa, um ponto desce pelo tronco: é a ordem chegando. */
  const Tronco = ({ alto = "h-5", vivo = false }: { alto?: string; vivo?: boolean }) => (
    <div className={cn("mx-auto w-px bg-border", "relative", alto)} aria-hidden>
      {vivo && (
        <span className="organograma-fluxo absolute -left-[2px] top-0 h-[5px] w-[5px] rounded-full bg-info" />
      )}
    </div>
  );
  const vivo = trabalhando > 0 || agentesTrabalhando > 0;

  const TOM_DO_MOVIMENTO: Record<MovimentoDoOrganograma["tom"], string> = {
    andamento: "bg-info",
    feito: "bg-success",
    bloqueado: "bg-destructive",
    outro: "bg-muted-foreground",
  };
  const abrirPorId = (id: string) => {
    const no = nos.find((n) => n.id === id);
    if (no) aoAbrir(no);
  };

  const botaoDoPalco = "flex h-8 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

  /*
   * Sem caixa em volta (sistema de design: nada de cartão dentro de cartão).
   * O resumo é a linha do título; cada agente é UM cartão sólido sobre o
   * fundo; as funções se separam por espaço e pela barra de acento do
   * título, não por outra caixa.
   */
  return (
    /* A seção do sistema (recolhe sozinha): título, o resumo em números como
       linha de estado e a explicação no "?". */
    <Secao
      titulo="Hierarquia da operação"
      data-organograma=""
      descricao={
        <span className="-mx-1 inline-flex flex-wrap items-center [&>*]:mx-1">
          <span><strong className="tabular-nums text-foreground">{total}</strong> {total === 1 ? "agente" : "agentes"}</span>
          <span><strong className="tabular-nums text-foreground">{areas.length}</strong> {areas.length === 1 ? "função" : "funções"}</span>
          <span><strong className="tabular-nums text-success">{ativos}</strong> ativos</span>
          {agentesTrabalhando > 0 && (
            <span className="inline-flex items-center">
              <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-info" aria-hidden />
              <strong className="tabular-nums text-info">{agentesTrabalhando}</strong>&nbsp;trabalhando agora
            </span>
          )}
          {trabalhando > 0 && (
            <span><strong className="tabular-nums text-info">{trabalhando}</strong> em andamento</span>
          )}
        </span>
      }
      ajuda={
        <>
          Toque em qualquer um para ver o contexto e copiar o comando de acionamento.
          Quem organiza esta hierarquia é o Hermes, pelo próprio MCP, e o painel
          redesenha na hora. Quem está trabalhando pulsa e mostra o que faz agora;
          a tela se atualiza sozinha a cada 10 segundos. No computador, use o zoom
          ou a tela cheia para ver a casa inteira.
          O painel não dispara o agente sozinho: quem conversa com ele é o grupo.
        </>
      }
    >
      <style>{ESTILO_DO_MOVIMENTO}</style>

      <div
        ref={palcoRef}
        data-palco-do-organograma=""
        className={cn("min-w-0", telaCheia && "overflow-auto bg-background p-6")}
      >
        {/* Zoom e tela cheia: só no computador (no celular a tela já é a pirâmide em pé). */}
        <div className="mb-3 hidden items-center justify-end lg:flex" role="toolbar" aria-label="Zoom da hierarquia">
          <button type="button" className={botaoDoPalco} onClick={() => setZoom((z) => limitarZoom(z - 0.1))} disabled={zoom <= ZOOM_MIN} aria-label="Diminuir o zoom" title="Diminuir o zoom">
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" className={cn(botaoDoPalco, "w-14 text-[12px] tabular-nums")} onClick={() => setZoom(1)} aria-label="Voltar ao tamanho normal" title="Voltar ao tamanho normal">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className={botaoDoPalco} onClick={() => setZoom((z) => limitarZoom(z + 0.1))} disabled={zoom >= ZOOM_MAX} aria-label="Aumentar o zoom" title="Aumentar o zoom">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className={cn(botaoDoPalco, "ml-1")} onClick={ajustarNaTela} aria-label="Caber na tela" title="Caber na tela">
            <ScanSearch className="h-4 w-4" />
          </button>
          <button type="button" className={cn(botaoDoPalco, "ml-1")} onClick={alternarTelaCheia} aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"} title={telaCheia ? "Sair da tela cheia" : "Tela cheia"}>
            {telaCheia ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>

        <div ref={conteudoRef} className="min-w-0" style={{ zoom }}>
          {/* O que acabou de acontecer, do mais novo para o mais antigo. */}
          {movimentos.length > 0 && (
            <section aria-label="Movimentação agora" data-movimentacao="" className="mb-5 min-w-0">
              <p className="mb-1.5 inline-flex items-center text-[12px] font-semibold text-foreground">
                <span className="relative mr-1.5 flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
                </span>
                Movimentação agora
              </p>
              <ul className="grid min-w-0 gap-1 lg:grid-cols-2">
                {movimentos.map((m) => (
                  <li key={m.id} className="organograma-entra min-w-0">
                    <button
                      type="button"
                      onClick={() => abrirPorId(m.agenteId)}
                      className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-secondary"
                    >
                      <span className={cn("mr-2 h-1.5 w-1.5 shrink-0 rounded-full", TOM_DO_MOVIMENTO[m.tom])} aria-hidden />
                      <span className="mr-1.5 shrink-0 font-semibold text-foreground">{m.agente}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.texto}</span>
                      <span className="ml-2 shrink-0 tabular-nums text-[11px] text-muted-foreground">{haQuanto(m.quando, agora)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-col items-center">
            <div className="w-full max-w-[16rem]">
              <Caixa
                no={{ id: "dono", nome: nomeDoDono, papel: "Dono da operação · decide e aprova", nivel: "dono" }}
                destaque="dono"
              />
            </div>
            <Tronco vivo={vivo} />
            <div className="w-full max-w-[16rem]">
              <Caixa
                no={{
                  id: "hermes",
                  nome: "Hermes",
                  papel: "Porta de entrada · recebe, organiza e responde no grupo",
                  nivel: "gateway",
                }}
                destaque="gateway"
              />
            </div>

            {coordenadores.length > 0 && (
              <>
                <Tronco vivo={vivo} />
                {/* Quebram linha e ficam centralizados: uma fila só vazava
                    para os lados quando havia muitos coordenadores. */}
                <div className="-m-1 flex w-full min-w-0 flex-wrap justify-center" data-coordenadores="">
                  {coordenadores.map((c) => (
                    <div key={c.id} className="m-1 w-full min-w-0 sm:w-[15rem]">
                      <Caixa no={c} acento="bg-primary" />
                    </div>
                  ))}
                </div>
              </>
            )}

            <Tronco alto="h-4" vivo={vivo} />

            {/* A base, separada por FUNÇÃO. As áreas saem do banco, então um
                agente novo do Hermes aparece aqui sozinho, no grupo certo, sem
                ninguém mexer em código. */}
            <div className="w-full min-w-0 space-y-5">
              {areas.map(([area, doGrupo]) => {
                const acento = acentoDaArea(area);
                const emAndamento = doGrupo.reduce((s, o) => s + (o.emAndamento ?? 0), 0);
                const fechada = Boolean(fechadas[area]);
                return (
                  <section key={area} aria-label={area} className="min-w-0">
                    <div className={cn("flex min-w-0 items-center", !fechada && "mb-2")}>
                      <span className={cn("mr-2 h-3.5 w-1 shrink-0 rounded-full", acento)} aria-hidden />
                      <TituloRecolhivel
                        titulo={area}
                        recolhido={fechada}
                        onAlternar={() => setFechadas((atual) => ({ ...atual, [area]: !fechada }))}
                        className="mr-2 shrink"
                      />
                      <span className="mr-2 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {doGrupo.length}
                      </span>
                      {emAndamento > 0 && (
                        <span className="shrink-0 text-[12px] tabular-nums text-info">
                          {emAndamento} em andamento
                        </span>
                      )}
                    </div>
                    {!fechada && (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {doGrupo.map((o) => <Caixa key={o.id} no={o} acento={acento} />)}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Secao>
  );
}

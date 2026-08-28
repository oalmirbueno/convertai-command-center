import { Bot, Crown, Network, Sparkles } from "lucide-react";
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
}

/** As iniciais do nome, para o cartão ter um rosto em vez de só texto. */
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
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

export default function OrganogramaAgentes({
  nos,
  aoAbrir,
  nomeDoDono,
}: {
  nos: NoDoOrganograma[];
  aoAbrir: (no: NoDoOrganograma) => void;
  nomeDoDono: string;
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
  const trabalhando = operadores.reduce((s, o) => s + (o.emAndamento ?? 0), 0);

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

    return (
      <button
        type="button"
        onClick={() => aoAbrir(no)}
        title={no.papel}
        className={cn(
          "group relative w-full overflow-hidden rounded-xl border text-left transition-all",
          "hover:-translate-y-px hover:border-primary/60 hover:shadow-lg hover:shadow-black/20",
          destaque === "dono"
            ? "border-primary/50 bg-card"
            : destaque === "gateway"
              ? "border-info/50 bg-card"
              : "border-border bg-card",
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

        <div className="flex items-start gap-2.5 p-3 pl-4">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10.5px] font-bold",
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
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {/* Ponto de estado: verde vivo, cinza parado. Uma bolinha lê
                  mais rápido que a palavra "inativo" no canto. */}
              {no.nivel !== "dono" && no.nivel !== "gateway" && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    no.ativo === false ? "bg-muted-foreground" : "bg-success",
                  )}
                  aria-hidden
                />
              )}
              <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
                {no.nome}
              </p>
              {no.nivel === "coordenador" && (
                <span className="shrink-0 rounded-md bg-primary/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                  coordena
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
              {no.papel}
            </p>
            {no.chefe && (
              <p className="mt-1 flex items-center gap-1 truncate text-[9.5px] text-muted-foreground">
                <Bot className="h-2.5 w-2.5 shrink-0" />
                responde a {no.chefe}
              </p>
            )}
          </div>
        </div>

        {numeros.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-1.5 pl-4">
            {numeros.map((n) => (
              <span key={n.titulo} className="flex items-baseline gap-1 text-[9.5px]">
                <strong className={cn("text-[11px] font-bold tabular-nums", n.cor)}>{n.valor}</strong>
                <span className="text-muted-foreground">{n.titulo}</span>
              </span>
            ))}
          </div>
        )}

        {no.ativo === false && (
          <div className="border-t border-border bg-secondary px-3 py-1 pl-4 text-[9.5px] font-medium text-muted-foreground">
            pausado
          </div>
        )}
      </button>
    );
  };

  /* Tronco vertical: cor sólida. A versão anterior usava gradiente para
     border/40, que no escuro terminava em nada e cortava a linha no meio. */
  const Tronco = ({ alto = "h-5" }: { alto?: string }) => (
    <div className={cn("mx-auto w-px bg-border", alto)} aria-hidden />
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-secondary px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20">
            <Network className="h-3.5 w-3.5 text-primary" />
          </span>
          <p className="text-[11.5px] font-bold uppercase tracking-wider text-foreground">
            Hierarquia da operação
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
          <span><strong className="tabular-nums text-foreground">{total}</strong> {total === 1 ? "agente" : "agentes"}</span>
          <span className="text-border">·</span>
          <span><strong className="tabular-nums text-foreground">{areas.length}</strong> {areas.length === 1 ? "função" : "funções"}</span>
          <span className="text-border">·</span>
          <span><strong className="tabular-nums text-success">{ativos}</strong> ativos</span>
          {trabalhando > 0 && (
            <>
              <span className="text-border">·</span>
              <span><strong className="tabular-nums text-info">{trabalhando}</strong> em andamento</span>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-col items-center p-4">
        <div className="w-full max-w-[16rem]">
          <Caixa
            no={{ id: "dono", nome: nomeDoDono, papel: "Dono da operação · decide e aprova", nivel: "dono" }}
            destaque="dono"
          />
        </div>
        <Tronco />
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
            <Tronco />
            <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col sm:auto-cols-[14rem]">
              {coordenadores.map((c) => <Caixa key={c.id} no={c} acento="bg-primary" />)}
            </div>
          </>
        )}

        <Tronco alto="h-4" />

        {/* A base, separada por FUNÇÃO. As áreas saem do banco, então um
            agente novo do Hermes aparece aqui sozinho, no grupo certo, sem
            ninguém mexer em código. */}
        <div className="w-full space-y-2.5">
          {areas.map(([area, doGrupo]) => {
            const acento = acentoDaArea(area);
            const emAndamento = doGrupo.reduce((s, o) => s + (o.emAndamento ?? 0), 0);
            return (
              <section key={area} className="overflow-hidden rounded-xl border border-border bg-secondary">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className={cn("h-3.5 w-1 shrink-0 rounded-full", acento)} aria-hidden />
                  <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-foreground">
                    {area}
                  </h3>
                  <span className="rounded-md bg-card px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
                    {doGrupo.length}
                  </span>
                  {emAndamento > 0 && (
                    <span className="text-[9.5px] font-semibold tabular-nums text-info">
                      {emAndamento} em andamento
                    </span>
                  )}
                </div>
                <div className="grid gap-2 p-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {doGrupo.map((o) => <Caixa key={o.id} no={o} acento={acento} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <footer className="flex items-start gap-2 border-t border-border bg-secondary px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        <span>
          Toque em qualquer um para ver o contexto e copiar o comando de acionamento.
          Quem organiza esta hierarquia é o Hermes, pelo próprio MCP, e o painel
          redesenha na hora. O painel não dispara o agente sozinho: quem conversa
          com ele é o grupo.
        </span>
      </footer>
    </div>
  );
}

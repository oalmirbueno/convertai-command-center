import { Bot, Crown, Network } from "lucide-react";
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

  // Tudo recolhe (SISTEMA.md 4.3): cada função recolhe e volta; a escolha
  // fica guardada (sair e voltar mantém).
  const [fechadas, setFechadas] = useEstadoDaTela<Record<string, boolean>>("execucao:organograma:fechadas", {}, {
    validar: (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v),
  });

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
        /* Cartão com função (item do organograma): a superfície do sistema,
           com a borda tingida só no dono e no Hermes. */
        className={juntar(
          superficie.painel,
          "group relative w-full overflow-hidden text-left transition-colors",
          "hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          destaque === "dono" ? "border-primary/50" : destaque === "gateway" ? "border-info/50" : "",
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
              "mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold",
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
            <div className="flex items-center [&>*+*]:ml-1.5">
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
                <span className="shrink-0 rounded bg-primary/20 px-1.5 py-px text-[11px] font-medium text-primary">
                  coordena
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
              {no.papel}
            </p>
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
      </button>
    );
  };

  /* Tronco vertical: cor sólida. A versão anterior usava gradiente para
     border/40, que no escuro terminava em nada e cortava a linha no meio. */
  const Tronco = ({ alto = "h-5" }: { alto?: string }) => (
    <div className={cn("mx-auto w-px bg-border", alto)} aria-hidden />
  );

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
          {trabalhando > 0 && (
            <span><strong className="tabular-nums text-info">{trabalhando}</strong> em andamento</span>
          )}
        </span>
      }
      ajuda={
        <>
          Toque em qualquer um para ver o contexto e copiar o comando de acionamento.
          Quem organiza esta hierarquia é o Hermes, pelo próprio MCP, e o painel
          redesenha na hora. O painel não dispara o agente sozinho: quem conversa
          com ele é o grupo.
        </>
      }
    >

      <div className="flex flex-col items-center">
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
        <div className="w-full space-y-5">
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
    </Secao>
  );
}

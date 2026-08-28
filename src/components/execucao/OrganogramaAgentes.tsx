import { Bot, Crown, Network, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A pirâmide da casa: quem manda, quem coordena, quem executa.
 *
 * O dono no topo, o Hermes como porta de entrada (é por ele que a
 * conversa chega e volta), o coordenador no meio e os operadores na base,
 * separados por função.
 *
 * O desenho leva a sério uma coisa: organograma que não mostra as LINHAS
 * não é organograma, é uma grade de cartões com um título em cima. Cada
 * nível se liga ao seguinte por tronco e por barra horizontal, e cada
 * grupo da base desce do seu próprio ramo. Num telefone a pirâmide seria
 * ilegível de tão apertada, então lá ela vira uma coluna com a mesma
 * ordem de leitura e os mesmos vínculos escritos no cartão.
 *
 * Uma honestidade que o desenho precisa carregar: o painel NÃO dispara o
 * agente sozinho. Não existe canal do painel para dentro do Hermes; o que
 * existe é o comando pronto para colar no grupo. Um botão chamado
 * "acionar" que na verdade copia texto seria uma promessa falsa, então
 * ele se chama o que é.
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

  const ativos = operadores.filter((o) => o.ativo !== false).length;
  const trabalhando = operadores.reduce((s, o) => s + (o.emAndamento ?? 0), 0);

  const Caixa = ({
    no,
    destaque,
  }: {
    no: NoDoOrganograma;
    destaque?: "dono" | "gateway";
  }) => {
    const numeros = [
      { valor: no.emAndamento ?? 0, tom: "text-info", titulo: "em andamento" },
      { valor: no.feitas ?? 0, tom: "text-success", titulo: "feitas" },
      { valor: no.bloqueadas ?? 0, tom: "text-destructive", titulo: "bloqueadas" },
    ].filter((n) => n.valor > 0);

    return (
      <button
        type="button"
        onClick={() => aoAbrir(no)}
        title={no.papel}
        className={cn(
          "group w-full rounded-xl border bg-card p-2.5 text-left transition-all",
          "hover:-translate-y-px hover:border-primary/50 hover:shadow-sm",
          destaque === "dono" && "border-primary/40 bg-primary/[0.05]",
          destaque === "gateway" && "border-info/40 bg-info/[0.04]",
          !destaque && "border-border",
          no.ativo === false && "opacity-60",
        )}
      >
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold",
              destaque === "dono"
                ? "bg-primary/15 text-primary"
                : destaque === "gateway"
                  ? "bg-info/15 text-info"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {destaque === "dono" ? (
              <Crown className="h-3.5 w-3.5" />
            ) : destaque === "gateway" ? (
              <Network className="h-3.5 w-3.5" />
            ) : (
              iniciais(no.nome)
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
                {no.nome}
              </p>
              {no.nivel === "coordenador" && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-semibold text-primary">
                  coordena
                </span>
              )}
              {no.ativo === false && (
                <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">inativo</span>
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
              {no.papel}
            </p>
            {no.chefe && (
              <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground/70">
                responde a {no.chefe}
              </p>
            )}
          </div>
        </div>

        {numeros.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {numeros.map((n) => (
              <span
                key={n.titulo}
                className={cn(
                  "rounded-md bg-muted/60 px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums",
                  n.tom,
                )}
              >
                {n.valor} {n.titulo}
              </span>
            ))}
          </div>
        )}
      </button>
    );
  };

  /* Tronco vertical e barra horizontal: são eles que transformam cartões
     soltos numa estrutura. Some no telefone, onde a leitura é em coluna. */
  const Tronco = ({ alto = "h-5" }: { alto?: string }) => (
    <div className={cn("mx-auto w-px bg-gradient-to-b from-border to-border/40", alto)} />
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Hierarquia da operação
        </p>
        <p className="text-[10.5px] text-muted-foreground">
          <strong className="tabular-nums text-foreground">{operadores.length + coordenadores.length}</strong>{" "}
          {operadores.length + coordenadores.length === 1 ? "agente" : "agentes"} ·{" "}
          <strong className="tabular-nums text-foreground">{areas.length}</strong>{" "}
          {areas.length === 1 ? "função" : "funções"} ·{" "}
          <strong className="tabular-nums text-foreground">{ativos}</strong> ativos
          {trabalhando > 0 && (
            <> · <span className="font-semibold text-info tabular-nums">{trabalhando} em andamento</span></>
          )}
        </p>
      </div>

      <div className="flex flex-col items-center">
        <div className="w-full max-w-[15rem]">
          <Caixa
            no={{ id: "dono", nome: nomeDoDono, papel: "Dono da operação · decide e aprova", nivel: "dono" }}
            destaque="dono"
          />
        </div>
        <Tronco />
        <div className="w-full max-w-[15rem]">
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
            <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col sm:auto-cols-[13rem]">
              {coordenadores.map((c) => <Caixa key={c.id} no={c} />)}
            </div>
          </>
        )}

        <Tronco alto="h-4" />

        {/* A base, separada por FUNÇÃO. Com quatro agentes uma grade solta
            bastava; a partir do quinto, saber que Vértice e Prisma fazem
            coisas diferentes é o que faz o desenho valer. As áreas saem do
            banco, então um agente novo do Hermes aparece aqui sozinho, no
            grupo certo, sem ninguém mexer em código. */}
        <div className="w-full space-y-3">
          {areas.map(([area, doGrupo]) => (
            <div key={area} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-3 w-0.5 shrink-0 rounded-full bg-primary/60" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">
                  {area}
                </p>
                <span className="text-[9.5px] tabular-nums text-muted-foreground">
                  {doGrupo.length} {doGrupo.length === 1 ? "agente" : "agentes"}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {doGrupo.map((o) => <Caixa key={o.id} no={o} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        <span>
          Toque em qualquer um para ver o contexto e copiar o comando de acionamento.
          Quem organiza esta hierarquia é o Hermes, pelo próprio MCP, e o painel
          redesenha na hora. O painel não dispara o agente sozinho: quem conversa
          com ele é o grupo.
        </span>
      </p>
    </div>
  );
}

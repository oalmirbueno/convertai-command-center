import { useMemo, useState } from "react";
import { Bot, ChevronDown, Clock, PauseCircle, ShieldAlert, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { esperandoVoce, precisaDecisao } from "@/lib/precisaDecisao";

/**
 * O escritório: cada agente como uma pessoa, e o que ela está fazendo agora.
 *
 * A queixa: "vejo eles trabalhando mas não sei direito o que é pra quem".
 * O quadro anterior mostrava colunas de estado — bom para auditar, ruim
 * para entender. Quem chega quer a resposta de um relance: quem está
 * ocupado, com o quê, para qual cliente, e o que está parado esperando
 * uma decisão minha.
 *
 * A ordem não é alfabética nem hierárquica de propósito: quem PRECISA DE
 * VOCÊ vem primeiro. Uma lista organizada pelo organograma seria bonita e
 * inútil — o que trava o dia fica no meio dela.
 */

export interface AgenteNoEscritorio {
  id: string;
  display_name: string;
  role: string;
  area?: string | null;
  status: string;
  is_coordinator?: boolean;
  last_run_at?: string | null;
}

export interface TrabalhoDoAgente {
  operator_id: string;
  status: string;
  last_action?: string | null;
  next_step?: string | null;
  approval_required?: boolean | null;
  kanban_task_id?: string | null;
  painel_task_id?: string | null;
  updated_at?: string | null;
}

/** Quanto cada estado pesa na hora de decidir quem aparece primeiro. */
const PESO = { blocked: 0, awaiting_input: 1, review: 2, in_progress: 3, queued: 4, done: 5 } as const;

/** O estado que MANDA no cartão do agente: o mais urgente que ele tem. */
export function estadoQueManda(trabalhos: readonly TrabalhoDoAgente[]): string | null {
  let melhor: string | null = null;
  let peso = 99;
  for (const t of trabalhos) {
    const p = (PESO as Record<string, number>)[t.status];
    if (p !== undefined && p < peso) { peso = p; melhor = t.status; }
  }
  return melhor;
}

/**
 * A ordem do escritório: quem espera por você primeiro.
 *
 * Empate resolve pelo trabalho mais recente — entre dois agentes travados,
 * o que mexeu agora é o que ainda está quente.
 */
export function ordenarEscritorio(
  agentes: readonly AgenteNoEscritorio[],
  porAgente: Map<string, TrabalhoDoAgente[]>,
): AgenteNoEscritorio[] {
  return [...agentes].sort((a, b) => {
    const ea = estadoQueManda(porAgente.get(a.id) ?? []);
    const eb = estadoQueManda(porAgente.get(b.id) ?? []);
    // Sem trabalho nenhum vai para o fim: ocioso não disputa atenção.
    const pa = ea === null ? 90 : (PESO as Record<string, number>)[ea];
    const pb = eb === null ? 90 : (PESO as Record<string, number>)[eb];
    if (pa !== pb) return pa - pb;
    const ta = (porAgente.get(a.id) ?? [])[0]?.updated_at ?? "";
    const tb = (porAgente.get(b.id) ?? [])[0]?.updated_at ?? "";
    return String(tb).localeCompare(String(ta));
  });
}

/**
 * As áreas, ordenadas pela urgência de quem está dentro delas.
 *
 * Agrupar por área sem ordenar por urgência traria de volta o problema
 * que o Escritório resolve: a área que trava o dia ficaria no meio da
 * lista, em ordem alfabética, ao lado de uma área ociosa.
 *
 * Área sem nome vira "Sem área": inventar um rótulo bonito esconderia
 * que o organograma está incompleto.
 */
export function agruparPorArea(
  agentes: readonly AgenteNoEscritorio[],
  porAgente: Map<string, TrabalhoDoAgente[]>,
): Array<{ area: string; agentes: AgenteNoEscritorio[]; urgencia: number }> {
  const mapa = new Map<string, AgenteNoEscritorio[]>();
  for (const a of ordenarEscritorio(agentes, porAgente)) {
    const area = (a.area || "").trim() || "Sem área";
    const atual = mapa.get(area);
    if (atual) atual.push(a);
    else mapa.set(area, [a]);
  }
  return [...mapa.entries()]
    .map(([area, lista]) => {
      const pesos = lista.map((a) => {
        const e = estadoQueManda(porAgente.get(a.id) ?? []);
        return e === null ? 90 : (PESO as Record<string, number>)[e];
      });
      return { area, agentes: lista, urgencia: Math.min(...pesos, 90) };
    })
    .sort((a, b) => a.urgencia - b.urgencia || a.area.localeCompare(b.area));
}

const FRASE: Record<string, string> = {
  blocked: "travado, precisa de você",
  awaiting_input: "esperando algo seu",
  review: "entregou, esperando revisão",
  in_progress: "trabalhando agora",
  queued: "com tarefa na fila",
  done: "entregou tudo",
};

const TOM: Record<string, string> = {
  blocked: "border-destructive/50 bg-destructive/[0.06]",
  awaiting_input: "border-warning/50 bg-warning/[0.06]",
  review: "border-warning/40 bg-warning/[0.05]",
  in_progress: "border-info/40 bg-info/[0.05]",
  queued: "border-border bg-card",
  done: "border-success/30 bg-success/[0.04]",
};

const PONTO: Record<string, string> = {
  blocked: "bg-destructive",
  awaiting_input: "bg-warning",
  review: "bg-warning",
  in_progress: "bg-info",
  queued: "bg-muted-foreground",
  done: "bg-success",
};

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }) : "";

export default function Escritorio({
  agentes,
  trabalhos,
  tarefas,
  humanos,
  aoAbrirAgente,
  aoAbrirTarefa,
}: {
  agentes: AgenteNoEscritorio[];
  trabalhos: TrabalhoDoAgente[];
  /** task_id -> { title, project, assigned_to } */
  tarefas: Map<string, any>;
  /** profile_id -> nome */
  humanos: Map<string, string>;
  aoAbrirAgente: (a: AgenteNoEscritorio) => void;
  aoAbrirTarefa: (taskId: string) => void;
}) {
  const porAgente = useMemo(() => {
    const m = new Map<string, TrabalhoDoAgente[]>();
    for (const t of trabalhos) {
      const atual = m.get(t.operator_id);
      if (atual) atual.push(t);
      else m.set(t.operator_id, [t]);
    }
    return m;
  }, [trabalhos]);

  const areas = useMemo(() => agruparPorArea(agentes, porAgente), [agentes, porAgente]);

  /*
   * Área sem trabalho nasce recolhida.
   *
   * Nove áreas abertas de uma vez, a maioria sem nada acontecendo, é o que
   * fazia a tela parecer cheia sem informar. Recolhido continua contando
   * quantos agentes tem — some o cartão, não o fato.
   *
   * Guardo as ABERTAS por escolha: uma área que ganhar trabalho amanhã
   * abre sozinha, em vez de ficar escondida por um estado que não a
   * conhecia.
   */
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({});

  /*
   * A escolha da pessoa vale nos DOIS sentidos.
   *
   * Minha versão anterior só guardava as áreas ABERTAS, e o padrão
   * ("tem trabalho → aberta") era um OU. Numa área com trabalho o padrão
   * ganhava sempre e o clique de recolher não fazia nada — o botão
   * existia e não obedecia, que é pior do que não existir.
   *
   * Agora `escolhas` guarda true/false explícito; o padrão só decide onde
   * ninguém escolheu, para uma área nova não nascer escondida.
   */
  const estaAberta = (area: string, urgencia: number) =>
    escolhas[area] ?? urgencia < 90;
  const alternar = (area: string, urgencia: number) =>
    setEscolhas((atual) => ({ ...atual, [area]: !(atual[area] ?? urgencia < 90) }));

  const esperandoVoce = useMemo(
    () => trabalhos.filter(
      // Concluido nao espera nada, mesmo que tenha esperado no passado.
      (t) => esperandoVoce(t),
    ).length,
    [trabalhos],
  );

  return (
    <div className="space-y-3">
      {/* A frase que resume o dia. Um número sozinho não diz o que fazer. */}
      <div className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
        <p className="text-[12.5px] text-foreground">
          {esperandoVoce > 0 ? (
            <>
              <strong className="font-mono">{esperandoVoce}</strong>{" "}
              {esperandoVoce === 1 ? "trabalho está" : "trabalhos estão"} parado esperando uma
              decisão sua. Eles aparecem primeiro na lista.
            </>
          ) : (
            <>Nada está parado esperando você. O que estiver em andamento segue sozinho.</>
          )}
        </p>
      </div>

      {areas.map(({ area, agentes: doGrupo, urgencia }) => {
        const aberta = estaAberta(area, urgencia);
        return (
        <div key={area} className="space-y-2">
          {/* O nome da área, discreto: separa sem competir com os cartões. */}
          <button
            type="button"
            onClick={() => alternar(area, urgencia)}
            aria-expanded={aberta}
            className="flex w-full items-center gap-2 text-left"
          >
            <ChevronDown className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
              !aberta && "-rotate-90",
            )} />
            <span className="h-3 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">{area}</span>
            <span className="text-[10px] text-muted-foreground">
              {doGrupo.length} {doGrupo.length === 1 ? "agente" : "agentes"}
              {!aberta && urgencia >= 90 && " · sem trabalho agora"}
            </span>
          </button>
          {aberta && (

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {doGrupo.map((a) => {
          const meus = porAgente.get(a.id) ?? [];
          const estado = estadoQueManda(meus);
          const pausado = a.status !== "active";
          // A tarefa que representa o agente agora: a do estado que manda.
          const foco = meus.find((t) => t.status === estado);
          const idTarefa = foco?.kanban_task_id || foco?.painel_task_id || null;
          const tarefa = idTarefa ? tarefas.get(String(idTarefa)) : null;
          const cliente = tarefa?.project?.client;
          const responsavel = tarefa?.assigned_to
            ? humanos.get(String(tarefa.assigned_to))
            : null;

          return (
            <div
              key={a.id}
              className={cn(
                "rounded-xl border p-3 transition-colors",
                pausado ? "border-border bg-card opacity-60" : (TOM[estado ?? "queued"] ?? "border-border bg-card"),
              )}
            >
              <button
                type="button"
                onClick={() => aoAbrirAgente(a)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {a.display_name}
                    </span>
                    {a.is_coordinator && (
                      <span className="rounded-full bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">
                        coordena
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {a.role}
                  </span>
                </span>
                {!pausado && estado && (
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", PONTO[estado])} />
                )}
              </button>

              {/* A frase de estado, em português de gente. */}
              <p className="mt-2 text-[11.5px] font-medium text-foreground/90">
                {pausado
                  ? "pausado por você"
                  : estado
                    ? FRASE[estado]
                    : "sem tarefa no momento"}
              </p>

              {/* PARA QUEM. Era isto que faltava para o quadro fazer sentido. */}
              {tarefa && (
                <button
                  type="button"
                  onClick={() => idTarefa && aoAbrirTarefa(String(idTarefa))}
                  className="mt-1.5 block w-full rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-left transition-colors hover:border-primary/50"
                >
                  <span className="block truncate text-[11.5px] text-foreground">{tarefa.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {cliente && (
                      <span className="font-medium text-foreground/80">
                        {cliente.company_name || cliente.full_name}
                      </span>
                    )}
                    {tarefa.project?.name && <span>{tarefa.project.name}</span>}
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-2.5 w-2.5" />
                      {responsavel || "sem responsável"}
                    </span>
                    {tarefa.due_date && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {tarefa.due_date}
                      </span>
                    )}
                  </span>
                </button>
              )}

              {foco?.next_step && (
                <p className="mt-1.5 line-clamp-2 text-[10.5px] text-muted-foreground">
                  próximo: {foco.next_step}
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {meus.some((t) => precisaDecisao(t)) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                    <ShieldAlert className="h-2.5 w-2.5" /> aprovação
                  </span>
                )}
                {pausado && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    <PauseCircle className="h-2.5 w-2.5" /> pausado
                  </span>
                )}
                {meus.length > 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{meus.length - 1} outra{meus.length - 1 > 1 ? "s" : ""}
                  </span>
                )}
                <span className="ml-auto text-[9.5px] text-muted-foreground">
                  {a.last_run_at ? quando(a.last_run_at) : "nunca executou"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

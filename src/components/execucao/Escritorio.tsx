import { useMemo } from "react";
import { Bot, ChevronDown, Clock, PauseCircle, ShieldAlert, UserRound } from "lucide-react";
import { esperandoVoce, precisaDecisao } from "@/lib/precisaDecisao";
import { etiqueta, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";

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

/** A cor da frase de estado: o que trava grita, o que anda informa. */
const TOM: Record<string, string> = {
  blocked: "text-destructive",
  awaiting_input: "text-warning",
  review: "text-warning",
  in_progress: "text-info",
  queued: "text-muted-foreground",
  done: "text-success",
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
   * conhecia. A escolha fica guardada no navegador (sair e voltar mantém).
   */
  const [escolhas, setEscolhas] = useEstadoDaTela<Record<string, boolean>>("execucao:escritorio:areas", {}, {
    validar: (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v),
  });

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

  const totalEsperandoVoce = useMemo(
    () => trabalhos.filter(
      // Concluido nao espera nada, mesmo que tenha esperado no passado.
      (t) => esperandoVoce(t),
    ).length,
    [trabalhos],
  );

  return (
    <div className="min-w-0 space-y-4">
      {/* A frase que resume o dia. Um número sozinho não diz o que fazer. */}
      <p className={juntar(texto.corpo, "flex items-start")}>
        <span
          className={juntar("mr-2 mt-1.5 h-2 w-2 shrink-0 rounded-full", totalEsperandoVoce > 0 ? "bg-warning" : "bg-success")}
          aria-hidden="true"
        />
        <span className="min-w-0">
          {totalEsperandoVoce > 0 ? (
            <>
              <strong className="font-semibold tabular-nums">{totalEsperandoVoce}</strong>{" "}
              {totalEsperandoVoce === 1 ? "trabalho está" : "trabalhos estão"} parado esperando uma
              decisão sua. Eles aparecem primeiro na lista.
            </>
          ) : (
            <>Nada está parado esperando você. O que estiver em andamento segue sozinho.</>
          )}
        </span>
      </p>

      {areas.map(({ area, agentes: doGrupo, urgencia }) => {
        const aberta = estaAberta(area, urgencia);
        return (
        <section key={area} aria-label={area} className="min-w-0">
          {/* O nome da área, discreto: separa sem competir com a lista. */}
          <button
            type="button"
            onClick={() => alternar(area, urgencia)}
            aria-expanded={aberta}
            className={juntar("flex w-full min-w-0 items-center rounded-md py-1 text-left", foco)}
          >
            <ChevronDown className={juntar(
              "mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              !aberta && "-rotate-90",
            )} aria-hidden="true" />
            <span className="mr-2 h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="mr-2 min-w-0 truncate text-[13px] font-semibold text-foreground">{area}</span>
            <span className={juntar(texto.auxiliar, "shrink-0")}>
              {doGrupo.length} {doGrupo.length === 1 ? "agente" : "agentes"}
              {!aberta && urgencia >= 90 && " · sem trabalho agora"}
            </span>
          </button>
          {aberta && (
            <ul className={juntar(superficie.painel, "mt-2 divide-y divide-border overflow-hidden")}>
              {doGrupo.map((a) => {
                const meus = porAgente.get(a.id) ?? [];
                const estado = estadoQueManda(meus);
                const pausado = a.status !== "active";
                // A tarefa que representa o agente agora: a do estado que manda.
                const emFoco = meus.find((t) => t.status === estado);
                const idTarefa = emFoco?.kanban_task_id || emFoco?.painel_task_id || null;
                const tarefa = idTarefa ? tarefas.get(String(idTarefa)) : null;
                const cliente = tarefa?.project?.client;
                const responsavel = tarefa?.assigned_to
                  ? humanos.get(String(tarefa.assigned_to))
                  : null;

                return (
                  <li key={a.id} className={juntar("min-w-0 px-3.5 py-3", pausado && "opacity-60")}>
                    <div className="flex min-w-0 items-start">
                      <button
                        type="button"
                        onClick={() => aoAbrirAgente(a)}
                        className={juntar("flex min-w-0 flex-1 items-center rounded-md text-left", foco)}
                      >
                        <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center">
                            <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                              {a.display_name}
                            </span>
                            {a.is_coordinator && (
                              <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>
                                coordena
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {a.role}
                            {/* A frase de estado, em português de gente. */}
                            <span className="mx-1" aria-hidden="true">·</span>
                            <span className={juntar("font-medium", pausado ? "text-muted-foreground" : estado ? TOM[estado] : "text-muted-foreground")}>
                              {pausado
                                ? "pausado por você"
                                : estado
                                  ? FRASE[estado]
                                  : "sem tarefa no momento"}
                            </span>
                          </span>
                        </span>
                      </button>
                      <span className="ml-3 flex shrink-0 flex-col items-end">
                        <span className="flex items-center">
                          {meus.some((t) => precisaDecisao(t)) && (
                            <span className={juntar(etiqueta, "mr-1 bg-warning/15 text-warning")}>
                              <ShieldAlert className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> aprovação
                            </span>
                          )}
                          {pausado && (
                            <span className={juntar(etiqueta, "mr-1 bg-muted text-muted-foreground")}>
                              <PauseCircle className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> pausado
                            </span>
                          )}
                          {!pausado && estado && (
                            <span className={juntar("h-2 w-2 rounded-full", PONTO[estado])} aria-hidden="true" />
                          )}
                        </span>
                        <span className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          {a.last_run_at ? quando(a.last_run_at) : "nunca executou"}
                        </span>
                      </span>
                    </div>

                    {/* PARA QUEM. Era isto que faltava para o quadro fazer sentido. */}
                    {tarefa && (
                      <button
                        type="button"
                        onClick={() => idTarefa && aoAbrirTarefa(String(idTarefa))}
                        className={juntar(superficie.poco, "mt-2 block w-full min-w-0 px-2.5 py-1.5 text-left transition-colors hover:bg-muted", foco)}
                      >
                        <span className="block truncate text-[12.5px] text-foreground">{tarefa.title}</span>
                        <span className="-mx-1 mt-0.5 flex flex-wrap items-center text-[11px] text-muted-foreground [&>*]:mx-1">
                          {cliente && (
                            <span className="font-medium text-foreground/80">
                              {cliente.company_name || cliente.full_name}
                            </span>
                          )}
                          {tarefa.project?.name && <span>{tarefa.project.name}</span>}
                          <span className="inline-flex items-center">
                            <UserRound className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
                            {responsavel || "sem responsável"}
                          </span>
                          {tarefa.due_date && (
                            <span className="inline-flex items-center tabular-nums">
                              <Clock className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> {tarefa.due_date}
                            </span>
                          )}
                        </span>
                      </button>
                    )}

                    {(emFoco?.next_step || meus.length > 1) && (
                      <p className="mt-1.5 flex min-w-0 text-[11.5px] text-muted-foreground">
                        {emFoco?.next_step && <span className="mr-2 min-w-0 flex-1 truncate">próximo: {emFoco.next_step}</span>}
                        {meus.length > 1 && (
                          <span className="ml-auto shrink-0">
                            +{meus.length - 1} outra{meus.length - 1 > 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        );
      })}
    </div>
  );
}

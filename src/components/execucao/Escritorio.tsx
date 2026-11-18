import { limparTecnico } from "@/lib/cadernoExecucao";
import { nomeDaTarefaDoBanco } from "@/lib/nomeDaTarefa";
import { useMemo } from "react";
import { Clock, ShieldAlert, UserRound } from "lucide-react";
import { esperandoVoce, precisaDecisao } from "@/lib/precisaDecisao";
import { etiqueta, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import TituloRecolhivel from "@/components/sistema/TituloRecolhivel";
import { ProgressBar } from "@/components/ds";
import { AvatarComPresenca, BarraSegmentada, PilhaDeAvatares, TrioDeNumeros, type Segmento } from "@/components/execucao/Visuais";

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
  in_progress: "trabalho em andamento",
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
  pendencias,
}: {
  pendencias?: number;
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
    () => pendencias ?? trabalhos.filter(
      // Concluido nao espera nada, mesmo que tenha esperado no passado.
      (t) => esperandoVoce(t),
    ).length,
    [trabalhos, pendencias],
  );

  /* Rodada v4 (15/11/2026): a equipe num relance, como nas referências (pilha de avatares, trio de
     números e barra segmentada da carga). Tudo sai dos mesmos trabalhos que desenham os cartões. */
  const conta = (...estados: string[]) => trabalhos.filter((t) => estados.includes(t.status)).length;
  const ativos = agentes.filter((a) => a.status === "active").length;
  const carga: Segmento[] = [
    { rotulo: "Travadas", valor: conta("blocked", "awaiting_input"), tom: "perigo" },
    { rotulo: "Em revisão", valor: conta("review"), tom: "aviso" },
    { rotulo: "Andando", valor: conta("in_progress"), tom: "info" },
    { rotulo: "Na fila", valor: conta("queued"), hachura: true },
    { rotulo: "Feitas", valor: conta("done"), tom: "sucesso" },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <section aria-label="Resumo da equipe" className={juntar(superficie.painel, "min-w-0 p-5 sm:p-6")}>
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-center">
            <PilhaDeAvatares nomes={agentes.map((a) => a.display_name)} max={5} tamanho={36} />
            <p className="ml-3 min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-5 text-foreground">{agentes.length} {agentes.length === 1 ? "agente" : "agentes"}<span className="font-normal text-muted-foreground"> · {ativos} {ativos === 1 ? "ativo" : "ativos"}</span></span>
              {/* A frase que resume o dia. Um número sozinho não diz o que fazer. */}
              <span className="mt-0.5 flex min-w-0 items-start text-[12px] leading-4 text-muted-foreground">
                <span className={juntar("mr-1.5 mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", totalEsperandoVoce > 0 ? "bg-warning" : "bg-success")} aria-hidden="true" />
                <span className="min-w-0">
                  {totalEsperandoVoce > 0 ? (
                    <>
                      <strong className="font-semibold tabular-nums text-foreground">{totalEsperandoVoce}</strong>{" "}
                      {totalEsperandoVoce === 1 ? "trabalho está" : "trabalhos estão"} parado esperando uma
                      decisão sua
                    </>
                  ) : (
                    <>Nada está parado esperando você</>
                  )}
                </span>
              </span>
            </p>
          </div>
          <TrioDeNumeros
            itens={[
              { rotulo: "Esperando você", valor: totalEsperandoVoce, tom: totalEsperandoVoce > 0 ? "text-warning" : "text-foreground" },
              { rotulo: "Andando", valor: conta("in_progress") },
              { rotulo: "Feitas", valor: conta("done") },
            ]}
          />
        </div>
        <BarraSegmentada rotulo="Carga da equipe por estado" itens={carga} className="mt-5 max-sm:overflow-x-auto max-sm:pb-1" />
      </section>

      <div className="grid gap-x-5 gap-y-6 lg:grid-cols-2 2xl:grid-cols-3">
      {areas.map(({ area, agentes: doGrupo, urgencia }) => {
        const aberta = estaAberta(area, urgencia);
        const larga = aberta && doGrupo.length > 2;
        return (
        <section key={area} aria-label={area} className={juntar("min-w-0", larga && "lg:col-span-2 2xl:col-span-3")}>
          {/* O nome da área, discreto: separa sem competir com a lista. O
              título recolhe pelo componente do sistema (setinha + título); a
              contagem fica à vista nos dois estados. */}
          <div className="flex min-w-0 items-center px-1">
            <TituloRecolhivel
              titulo={area}
              recolhido={!aberta}
              onAlternar={() => alternar(area, urgencia)}
              className="mr-2 shrink"
            />
            <span className={juntar(texto.auxiliar, "min-w-0 shrink truncate")}>
              {doGrupo.length} {doGrupo.length === 1 ? "agente" : "agentes"}
              {!aberta && urgencia >= 90 && " · sem trabalho agora"}
            </span>
            {!aberta && <PilhaDeAvatares nomes={doGrupo.map((a) => a.display_name)} max={3} tamanho={24} className="ml-auto pl-2" />}
          </div>
          {area === "Sem área" && aberta && <p className="mt-1 px-1 text-[12px] text-muted-foreground">Abra o agente e escolha a área dele no topo do perfil.</p>}
          {aberta && (
            <ul tabIndex={0} aria-label={`Agentes de ${area}`} className={juntar("mt-3 grid gap-3 rounded-lg pr-1 [scrollbar-width:thin] lg:max-h-[65vh] lg:overflow-y-auto lg:overscroll-contain", doGrupo.length === 2 && "sm:grid-cols-2", doGrupo.length > 2 && "sm:grid-cols-2 xl:grid-cols-3")}>
              {doGrupo.map((a, indice) => {
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
                const contaDoAgente = (...st: string[]) => meus.filter((t) => st.includes(t.status)).length;
                const feitas = contaDoAgente("done");
                const pedacos = [
                  [contaDoAgente("blocked", "awaiting_input"), "travada", "text-destructive"],
                  [contaDoAgente("review"), "em revisão", "text-warning"],
                  [contaDoAgente("in_progress", "queued"), "andando", "text-info"],
                ].filter(([n]) => Number(n) > 0) as Array<[number, string, string]>;

                return (
                  <li key={a.id} className={juntar(superficie.painel, "flex min-w-0 flex-col p-4 sm:p-5", pausado && "opacity-60")}>
                    <div className="flex min-w-0 items-center">
                      <button
                        type="button"
                        onClick={() => aoAbrirAgente(a)}
                        className={juntar("flex min-w-0 flex-1 items-center rounded-md text-left", foco)}
                      >
                        <AvatarComPresenca nome={a.display_name} ativo={!pausado} tom={indice} className="mr-3" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center">
                            <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-foreground">
                              {a.display_name}
                            </span>
                            {a.is_coordinator && (
                              <span className={juntar(etiqueta, "ml-1.5 shrink-0 bg-primary/10 text-primary")}>
                                coordena
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[12px] leading-4 text-muted-foreground">{a.role}</span>
                        </span>
                      </button>
                      <span className="ml-3 shrink-0 text-right text-[11px] leading-4 tabular-nums text-muted-foreground" title="Última execução">
                        {a.last_run_at ? quando(a.last_run_at) : "nunca executou"}
                      </span>
                    </div>

                    {/* O estado, numa pílula só (ponto + frase), e os selos que pedem você. */}
                    <p className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className={juntar("inline-flex min-w-0 items-center rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium leading-4", pausado ? "text-muted-foreground" : estado ? TOM[estado] : "text-muted-foreground")}>
                        <span className={juntar("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", pausado ? "bg-muted-foreground/50" : estado ? PONTO[estado] : "bg-muted-foreground/50")} aria-hidden="true" />
                        <span className="truncate">{pausado ? "pausado por você" : estado ? FRASE[estado] : "sem tarefa no momento"}</span>
                      </span>
                      {meus.some((t) => precisaDecisao(t)) && (
                        <span className={juntar(etiqueta, "bg-warning/15 text-warning")}>
                          <ShieldAlert className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> aprovação
                        </span>
                      )}
                    </p>

                    {!tarefa && emFoco?.last_action && <p className="mt-3 line-clamp-2 text-[13px] text-foreground/85">{limparTecnico(String(emFoco.last_action))}</p>}
                    {/* PARA QUEM. Era isto que faltava para o quadro fazer sentido. */}
                    {tarefa && (
                      <button
                        type="button"
                        onClick={() => idTarefa && aoAbrirTarefa(String(idTarefa))}
                        className={juntar("mt-3 block w-full min-w-0 rounded-md bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-muted", foco)}
                      >
                        {/* 26/10: "Área · assunto" (o cliente vem logo abaixo); o código ACE fica no detalhe da tarefa. */}
                        <span className="block truncate text-[13px] font-medium text-foreground" title={nomeDaTarefaDoBanco(tarefa, { agente: a.display_name }).texto}>{nomeDaTarefaDoBanco(tarefa, { agente: a.display_name }).semCliente}</span>
                        <span className="-mx-1 mt-0.5 flex min-w-0 items-center text-[11px] text-muted-foreground [&>*]:mx-1">
                          {cliente && <span className="min-w-0 truncate font-medium text-foreground/80">{cliente.company_name || cliente.full_name}</span>}
                          {responsavel && <span className="inline-flex min-w-0 shrink items-center"><UserRound className="mr-1 h-2.5 w-2.5 shrink-0" aria-hidden="true" /><span className="truncate">{responsavel}</span></span>}
                          {tarefa.due_date && <span className="inline-flex shrink-0 items-center tabular-nums"><Clock className="mr-1 h-2.5 w-2.5" aria-hidden="true" />{String(tarefa.due_date).split("-").reverse().slice(0, 2).join("/")}</span>}
                        </span>
                      </button>
                    )}

                    {/* A carga do agente: o que já entregou do que tem na mão. */}
                    {meus.length > 0 && (
                      <div className="mt-auto pt-4">
                        <ProgressBar value={feitas} max={meus.length} height={6} tone={1} label={`${feitas} de ${meus.length} feitas`} />
                        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 text-[12px] leading-4 text-muted-foreground">
                          {pedacos.map(([n, r, tom]) => <span key={r}><span className={juntar("font-semibold tabular-nums", tom)}>{n}</span> {r}</span>)}
                          <span className="ml-auto tabular-nums"><span className="font-semibold text-foreground">{feitas}</span>/{meus.length}</span>
                        </p>
                      </div>
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
    </div>
  );
}

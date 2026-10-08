import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ExternalLink, FileText, HelpCircle, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveFileUrl, mediaKindFromFile, fileExtension } from "@/lib/fileUrls";
import { comandoDaAprovacao, estadoDaExecucao } from "@/lib/execucaoApresentacao";
import { centralReviewError } from "@/lib/centralReview";
import { syncClientRequestStatusForTask } from "@/lib/requestTaskWorkflow";
import { Carregando, EstadoDeErro, botao, campo, campoTexto, etiqueta, juntar, texto } from "@/components/sistema";

/**
 * Objeto aberto na Central de Autonomia (08/10/2026).
 *
 * O Gestor cria ou cita uma coisa (tarefa, memória, aprovação, projeto,
 * arquivo, publicação, execução de agente) e o dono abre aqui, no painel
 * lateral, nativo: nada de iframe nem da página inteira do app dentro do app.
 * Tudo é lido com a sessão de quem está logado (RLS vale). As decisões de
 * aprovação passam pelo mesmo mecanismo oficial das Aprovações explicadas.
 */

export type ObjetoAberto = {
  tipo: "tarefa" | "memoria_agente" | "memoria_projeto" | "aprovacao" | "projeto" | "arquivo" | "publicacao" | "vinculo";
  id: string;
  titulo?: string | null;
  client_id?: string | null;
};

type AbrirFerramenta = (caminho: string, rotulo: string) => void;
type AbrirDiario = (linkId: string, titulo?: string) => void;

type PropsDoObjeto = {
  objeto: ObjetoAberto;
  aoFechar: () => void;
  aoAbrirFerramenta?: AbrirFerramenta;
  aoAbrirDiario?: AbrirDiario;
};

type PropsDaVista = {
  id: string;
  client_id?: string | null;
  informarTitulo: (t: string) => void;
  aoAbrirFerramenta?: AbrirFerramenta;
  aoAbrirDiario?: AbrirDiario;
  abrir: (o: ObjetoAberto) => void;
};

const ROTULO_DO_TIPO: Record<ObjetoAberto["tipo"], string> = {
  tarefa: "Tarefa",
  memoria_agente: "Memória do agente",
  memoria_projeto: "Memória do projeto",
  aprovacao: "Aprovação",
  projeto: "Projeto",
  arquivo: "Arquivo",
  publicacao: "Publicação",
  vinculo: "Execução",
};

const NAO_ENCONTRADO = "Não encontrei este item (pode ter sido apagado ou você não tem acesso).";

// ------------------------------------------------------------------ utilidades

const db = () => supabase as any;

async function lerUma<T>(consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const r = await consulta;
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? null) as T | null;
}

async function lerVarias<T>(consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const r = await consulta;
  if (r.error) throw new Error(r.error.message);
  return (Array.isArray(r.data) ? r.data : []) as T[];
}

const mensagemDoErro = (e: unknown) => (e instanceof Error ? e.message : String(e || "Tente novamente."));

const dataHora = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Data pura (AAAA-MM-DD) sem passar pelo fuso: 2026-10-08 é 08/10/2026 em qualquer lugar. */
const dataSimples = (d?: string | null) => {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

const tamanho = (bytes?: number | null) => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
};

type Pessoa = { company_name?: string | null; full_name?: string | null } | null | undefined;
const nomeDoCliente = (p: Pessoa) => p?.company_name || p?.full_name || null;

const linkWeb = (url?: string | null) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

function invalidarTudo(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["objeto-central"] });
  void qc.invalidateQueries({ queryKey: ["central-autonomia"] });
}

// ------------------------------------------------------------------ peças de tela

function Ajuda({ texto: dica }: { texto: string }) {
  return (
    <span role="img" title={dica} aria-label={dica} className="ml-1 inline-flex shrink-0 cursor-help items-center text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

/** Uma linha de dado; só aparece com conteúdo (linha vazia é ruído). */
function Linha({ rotulo, children }: { rotulo: string; children?: ReactNode }) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return (
    <div className="flex min-w-0 items-baseline py-1 text-[12px] leading-5">
      <span className="mr-2 w-24 shrink-0 text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 flex-1 break-words text-foreground [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

function Acoes({ children }: { children: ReactNode }) {
  return <div className="-m-1 mt-3 flex min-w-0 flex-wrap items-center [&>*]:m-1">{children}</div>;
}

const BOTAO_PEQUENO = juntar(botao.secundario, "h-8 px-3 text-[12px]");
const BOTAO_PRINCIPAL = juntar(botao.primario, "h-8 px-3 text-[12px]");

function BotaoDaFerramenta({ rotulo, caminho, nome, aoAbrir }: { rotulo: string; caminho: string; nome: string; aoAbrir?: AbrirFerramenta }) {
  if (!aoAbrir) return null;
  return (
    <button type="button" className={BOTAO_PEQUENO} onClick={() => aoAbrir(caminho, nome)}>
      <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      {rotulo}
    </button>
  );
}

function Pilula({ classe, children }: { classe: string; children: ReactNode }) {
  return <span className={juntar(etiqueta, classe)}>{children}</span>;
}

/** Texto longo com corte e "ver mais". */
function TextoLongo({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [aberto, setAberto] = useState(false);
  const longo = valor.length > 360 || valor.split("\n").length > 6;
  return (
    <div className="mt-3 min-w-0">
      <span className={texto.rotulo}>{rotulo}</span>
      <div className={juntar("mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]", longo && !aberto && "line-clamp-6")}>{valor}</div>
      {longo && (
        <button type="button" onClick={() => setAberto((v) => !v)} className="mt-1 text-[12px] font-medium text-primary hover:underline">
          {aberto ? "ver menos" : "ver mais"}
        </button>
      )}
    </div>
  );
}

function NaoEncontrado() {
  return <p className={juntar(texto.auxiliar, "px-1 py-2 leading-5")}>{NAO_ENCONTRADO}</p>;
}

/** Os três estados da leitura no lugar do conteúdo. Devolve null quando há dado. */
function estadoDaLeitura(q: { isLoading: boolean; isError: boolean; error: unknown; data: unknown }, rotulo: string): ReactNode | null {
  if (q.isLoading) return <Carregando linhas={3} rotulo={rotulo} />;
  if (q.isError) return <EstadoDeErro titulo="Não consegui abrir este item." descricao={mensagemDoErro(q.error)} />;
  if (!q.data) return <NaoEncontrado />;
  return null;
}

function useTitulo(informar: (t: string) => void, titulo: string | null | undefined) {
  useEffect(() => {
    if (titulo) informar(titulo);
  }, [titulo, informar]);
}

// ------------------------------------------------------------------ tarefa

const STATUS_DA_TAREFA: Record<string, { rotulo: string; classe: string }> = {
  backlog: { rotulo: "Backlog", classe: "bg-muted text-muted-foreground" },
  todo: { rotulo: "A fazer", classe: "bg-secondary text-secondary-foreground" },
  doing: { rotulo: "Em andamento", classe: "bg-primary/10 text-primary" },
  review: { rotulo: "Em revisão", classe: "bg-warning/15 text-warning" },
  done: { rotulo: "Concluída", classe: "bg-success/15 text-success" },
};
/** Daqui só se move entre estes. Concluir é na revisão, com a prova da entrega. */
const STATUS_EDITAVEIS = ["backlog", "todo", "doing", "review"] as const;
const PRIORIDADE: Record<string, string> = { urgent: "Urgente", high: "Alta", medium: "Média", low: "Baixa" };

function StatusDaTarefa({ status }: { status: string }) {
  const s = STATUS_DA_TAREFA[status] || { rotulo: status, classe: "bg-muted text-muted-foreground" };
  return <Pilula classe={s.classe}>{s.rotulo}</Pilula>;
}

type Tarefa = {
  id: string; title: string; status: string; priority: string | null; due_date: string | null;
  description: string | null; deleted_at: string | null; project_id: string; source: string | null;
  project?: { id: string; name: string; client_id: string; client?: Pessoa } | null;
};
type ExecucaoDaTarefa = {
  id: string; status: string; last_action: string | null; next_step: string | null; block_reason: string | null;
  updated_at: string; operator?: { display_name?: string | null } | null;
};

function VerTarefa({ id, informarTitulo, aoAbrirFerramenta, aoAbrirDiario }: PropsDaVista) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["objeto-central", "tarefa", id],
    queryFn: () => lerUma<Tarefa>(db().from("tasks")
      .select("id,title,status,priority,due_date,description,deleted_at,project_id,source,project:projects!tasks_project_id_fkey(id,name,client_id,client:profiles!projects_client_id_fkey(company_name,full_name))")
      .eq("id", id).maybeSingle()),
  });
  const execucoes = useQuery({
    queryKey: ["objeto-central", "tarefa", id, "execucoes"],
    enabled: !!q.data,
    queryFn: () => lerVarias<ExecucaoDaTarefa>(db().from("operator_task_links")
      .select("id,status,last_action,next_step,block_reason,updated_at,operator:internal_operators!operator_task_links_operator_id_fkey(display_name)")
      .eq("kanban_task_id", id).order("updated_at", { ascending: false }).limit(10)),
  });
  const tarefa = q.data;
  useTitulo(informarTitulo, tarefa?.title);
  const [prazo, setPrazo] = useState<string | null>(null);
  const prazoAtual = (tarefa?.due_date || "").slice(0, 10);
  const prazoNoCampo = prazo ?? prazoAtual;

  const salvarStatus = useMutation({
    mutationFn: async (novo: string) => {
      if (!tarefa) throw new Error("Atualize a tarefa antes de mudar.");
      if (!(STATUS_EDITAVEIS as readonly string[]).includes(novo)) throw new Error("Concluir é feito na revisão, com a prova da entrega.");
      const anterior = tarefa.status;
      const r = await lerUma<{ id: string }>(db().from("tasks").update({ status: novo, kanban_status: novo })
        .eq("id", tarefa.id).eq("status", anterior).select("id").maybeSingle());
      if (!r) throw new Error("A tarefa mudou ou você não tem acesso. Atualize e tente de novo.");
      // Mesmo cuidado do Kanban: tarefa nascida de pedido do cliente leva o pedido junto.
      try {
        await syncClientRequestStatusForTask({ taskId: tarefa.id, projectId: tarefa.project_id, source: tarefa.source, taskStatus: novo });
      } catch {
        await db().from("tasks").update({ status: anterior, kanban_status: anterior }).eq("id", tarefa.id).eq("status", novo);
        throw new Error("O pedido do cliente não sincronizou; a mudança foi desfeita.");
      }
      return novo;
    },
    onSuccess: (novo) => {
      invalidarTudo(qc);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`Movida para ${STATUS_DA_TAREFA[novo]?.rotulo || novo}.`);
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const salvarPrazo = useMutation({
    mutationFn: async (valor: string) => {
      if (!tarefa) throw new Error("Atualize a tarefa antes de mudar.");
      if (valor && !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error("Data inválida.");
      const r = await lerUma<{ id: string }>(db().from("tasks").update({ due_date: valor || null }).eq("id", tarefa.id).select("id").maybeSingle());
      if (!r) throw new Error("A tarefa mudou ou você não tem acesso. Atualize e tente de novo.");
      return valor;
    },
    onSuccess: (valor) => {
      setPrazo(null);
      invalidarTudo(qc);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(valor ? `Prazo salvo: ${dataSimples(valor)}.` : "Prazo removido.");
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const estado = estadoDaLeitura(q, "Abrindo a tarefa");
  if (estado || !tarefa) return <>{estado}</>;
  const naLixeira = !!tarefa.deleted_at;
  const editavel = !naLixeira && (STATUS_EDITAVEIS as readonly string[]).includes(tarefa.status);
  const cliente = nomeDoCliente(tarefa.project?.client);
  const ocupado = salvarStatus.isPending || salvarPrazo.isPending;

  return (
    <div className="min-w-0">
      <p className="break-words text-[15px] font-semibold leading-[22px] text-foreground [overflow-wrap:anywhere]">{tarefa.title}</p>
      <div className="-m-0.5 mt-1.5 flex flex-wrap items-center [&>*]:m-0.5">
        <StatusDaTarefa status={tarefa.status} />
        {naLixeira && <Pilula classe="bg-destructive/15 text-destructive">Na lixeira</Pilula>}
      </div>

      <div className="mt-2">
        <Linha rotulo="Prioridade">{tarefa.priority ? PRIORIDADE[tarefa.priority] || tarefa.priority : null}</Linha>
        <Linha rotulo="Prazo">{dataSimples(tarefa.due_date)}</Linha>
        <Linha rotulo="Projeto">{tarefa.project?.name ? `${tarefa.project.name}${cliente ? ` · ${cliente}` : ""}` : cliente}</Linha>
      </div>

      {editavel && (
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "flex items-center")}>
              Status
              <Ajuda texto="Concluir é feito na revisão, com a prova da entrega." />
            </span>
            <select
              aria-label="Status da tarefa"
              value={tarefa.status}
              disabled={ocupado}
              onChange={(e) => salvarStatus.mutate(e.target.value)}
              className={juntar(campo, "mt-1 h-8 text-[12px]")}
            >
              {STATUS_EDITAVEIS.map((s) => <option key={s} value={s}>{STATUS_DA_TAREFA[s].rotulo}</option>)}
            </select>
          </label>
          <div className="min-w-0">
            <label className={texto.rotulo} htmlFor={`prazo-${tarefa.id}`}>Prazo</label>
            <div className="mt-1 flex min-w-0 items-center">
              <input
                id={`prazo-${tarefa.id}`}
                type="date"
                aria-label="Prazo da tarefa"
                value={prazoNoCampo}
                disabled={ocupado}
                onChange={(e) => setPrazo(e.target.value)}
                className={juntar(campo, "h-8 min-w-0 flex-1 text-[12px]")}
              />
              <button
                type="button"
                disabled={ocupado || prazoNoCampo === prazoAtual}
                onClick={() => salvarPrazo.mutate(prazoNoCampo)}
                className={juntar(BOTAO_PEQUENO, "ml-1.5")}
              >
                {salvarPrazo.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {tarefa.description?.trim() && <TextoLongo rotulo="Descrição" valor={tarefa.description} />}

      <Acoes>
        <BotaoDaFerramenta rotulo="Abrir no Kanban" caminho={`/kanban?task=${encodeURIComponent(tarefa.id)}`} nome="Kanban" aoAbrir={aoAbrirFerramenta} />
      </Acoes>

      {!!execucoes.data?.length && (
        <div className="mt-4 min-w-0 border-t border-border/60 pt-3">
          <span className={texto.rotulo}>Execuções de agentes</span>
          <ul className="mt-1.5 space-y-2">
            {execucoes.data.map((v) => (
              <li key={v.id} className="min-w-0 rounded-md bg-muted/50 px-2.5 py-2">
                <div className="flex min-w-0 items-center">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{v.operator?.display_name || "Agente"}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{estadoDaExecucao(v.status)}</span>
                </div>
                <Linha rotulo="Última ação">{v.last_action}</Linha>
                <Linha rotulo="Próximo passo">{v.next_step}</Linha>
                <Linha rotulo="Bloqueio">{v.block_reason}</Linha>
                {aoAbrirDiario && (
                  <button type="button" className={juntar(BOTAO_PEQUENO, "mt-1")} onClick={() => aoAbrirDiario(v.id, tarefa.title)}>
                    <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Diário
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ memória do agente

type MemoriaDoAgente = {
  id: string; agente: string; tipo: string; texto: string; area: string | null; categoria: string | null;
  fonte: string | null; evidencia: string | null; criado_por: string | null; ativa: boolean; criado_em: string;
  origem: string | null; motivo: string | null; client_id: string;
};

function VerMemoriaDoAgente({ id, informarTitulo }: PropsDaVista) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["objeto-central", "memoria_agente", id],
    queryFn: () => lerUma<MemoriaDoAgente>(db().from("agente_memoria")
      .select("id,agente,tipo,texto,area,categoria,fonte,evidencia,criado_por,ativa,criado_em,origem,motivo,client_id")
      .eq("id", id).maybeSingle()),
  });
  const m = q.data;
  useTitulo(informarTitulo, m?.texto ? m.texto.slice(0, 80) : null);
  const alternar = useMutation({
    mutationFn: async (ativa: boolean) => {
      const r = await lerUma<{ id: string }>(db().from("agente_memoria").update({ ativa }).eq("id", id).select("id").maybeSingle());
      if (!r) throw new Error("Não consegui mudar esta memória (sem acesso ou apagada).");
      return ativa;
    },
    onSuccess: (ativa) => {
      invalidarTudo(qc);
      toast.success(ativa ? "Memória reativada." : "Memória desativada. O agente deixa de usar.");
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });
  const estado = estadoDaLeitura(q, "Abrindo a memória");
  if (estado || !m) return <>{estado}</>;
  const evidencia = linkWeb(m.evidencia);
  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe="bg-secondary text-secondary-foreground">{m.tipo}</Pilula>
        <Pilula classe={m.ativa ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}>{m.ativa ? "Ativa" : "Desativada"}</Pilula>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{m.texto}</p>
      <div className="mt-2">
        <Linha rotulo="Agente">{m.agente}</Linha>
        <Linha rotulo="Área">{m.area}</Linha>
        <Linha rotulo="Categoria">{m.categoria}</Linha>
        <Linha rotulo="Fonte">{m.fonte}</Linha>
        <Linha rotulo="Evidência">{evidencia ? <a href={evidencia} target="_blank" rel="noreferrer" className="break-all text-primary underline">{m.evidencia}</a> : m.evidencia}</Linha>
        <Linha rotulo="Motivo">{m.motivo}</Linha>
        <Linha rotulo="Criada por">{m.criado_por || m.origem}</Linha>
        <Linha rotulo="Criada em">{dataHora(m.criado_em)}</Linha>
      </div>
      <Acoes>
        <button type="button" className={BOTAO_PEQUENO} disabled={alternar.isPending} onClick={() => alternar.mutate(!m.ativa)}>
          {alternar.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {m.ativa ? "Desativar" : "Reativar"}
        </button>
      </Acoes>
    </div>
  );
}

// ------------------------------------------------------------------ memória do projeto

type MemoriaDoProjeto = {
  id: string; kind: string; title: string | null; content: string; source: string; metadata: unknown;
  created_at: string; client_id: string; project_id: string | null; tags: string[] | null;
};

function resumoDosMetadados(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const saida: string[] = [];
  for (const [chave, valor] of Object.entries(meta as Record<string, unknown>)) {
    if (saida.length >= 6) break;
    if (valor === null || valor === undefined || valor === "") continue;
    if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
      const v = String(valor);
      saida.push(`${chave}: ${v.length > 80 ? `${v.slice(0, 80)}…` : v}`);
    }
  }
  return saida;
}

function VerMemoriaDoProjeto({ id, client_id, informarTitulo, aoAbrirFerramenta }: PropsDaVista) {
  const q = useQuery({
    queryKey: ["objeto-central", "memoria_projeto", id],
    queryFn: () => lerUma<MemoriaDoProjeto>(db().from("project_memory")
      .select("id,kind,title,content,source,metadata,created_at,client_id,project_id,tags")
      .eq("id", id).maybeSingle()),
  });
  const m = q.data;
  useTitulo(informarTitulo, m ? m.title || m.content.slice(0, 80) : null);
  const estado = estadoDaLeitura(q, "Abrindo a memória");
  if (estado || !m) return <>{estado}</>;
  const cliente = m.client_id || client_id;
  const meta = resumoDosMetadados(m.metadata);
  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe="bg-secondary text-secondary-foreground">{m.kind}</Pilula>
        {(m.tags || []).slice(0, 6).map((t) => <Pilula key={t} classe="bg-muted text-muted-foreground">{t}</Pilula>)}
      </div>
      {m.title && <p className="mt-2 break-words text-[13px] font-medium leading-5 [overflow-wrap:anywhere]">{m.title}</p>}
      <TextoLongo rotulo="Conteúdo" valor={m.content} />
      <div className="mt-2">
        <Linha rotulo="Fonte">{m.source}</Linha>
        <Linha rotulo="Criada em">{dataHora(m.created_at)}</Linha>
        {meta.length > 0 && <Linha rotulo="Detalhes">{meta.join(" · ")}</Linha>}
      </div>
      {cliente && (
        <Acoes>
          <BotaoDaFerramenta rotulo="Abrir a Mesa do cliente" caminho={`/mesa?client=${encodeURIComponent(cliente)}&aba=contexto`} nome="Mesa do Cliente" aoAbrir={aoAbrirFerramenta} />
        </Acoes>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ aprovação

type Aprovacao = Record<string, any> & {
  id: string; o_que: string; por_que: string; status: string; action_kind: string; origin: string;
  payload: Record<string, any> | null; payload_version: number; valid_until: string | null; created_at: string;
  decided_at: string | null; decision_note: string | null; executed_at: string | null; client?: Pessoa;
};

const STATUS_DA_APROVACAO: Record<string, { rotulo: string; classe: string }> = {
  pendente: { rotulo: "Pendente", classe: "bg-warning/15 text-warning" },
  adiado: { rotulo: "Adiada", classe: "bg-muted text-muted-foreground" },
  aprovado: { rotulo: "Aprovada", classe: "bg-success/15 text-success" },
  rejeitado: { rotulo: "Rejeitada", classe: "bg-destructive/15 text-destructive" },
  alteracoes_pedidas: { rotulo: "Alterações pedidas", classe: "bg-secondary text-secondary-foreground" },
  expirado: { rotulo: "Vencida", classe: "bg-muted text-muted-foreground" },
};

const ROTULO_DA_ACAO: Record<string, string> = {
  publicar: "Publicar", agendar: "Agendar", enviar_mensagem: "Enviar mensagem", contatar_cliente: "Contatar cliente",
  criar_proposta: "Criar proposta", enviar_contrato: "Enviar contrato", ativar_campanha: "Ativar campanha",
  alterar_orcamento: "Alterar orçamento", gastar: "Gastar", alterar_financeiro: "Alterar financeiro",
  alterar_permissoes: "Alterar permissões", exportar_dados: "Exportar dados", excluir_dados: "Excluir dados",
  mudar_estrategia: "Mudar estratégia", alterar_responsavel: "Alterar responsável", promover_autonomia: "Promover autonomia",
};

const AVISO_DO_ESCOPO = "Aprovar registra a decisão nesta versão. Enviar ou publicar é uma etapa à parte.";

function VerAprovacao({ id, informarTitulo, aoAbrirDiario }: PropsDaVista) {
  const qc = useQueryClient();
  const chaves = useRef(new Map<string, string>());
  const [nota, setNota] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const q = useQuery({
    queryKey: ["objeto-central", "aprovacao", id],
    queryFn: () => lerUma<Aprovacao>(db().from("operator_approvals")
      .select("*, client:profiles!operator_approvals_client_id_fkey(company_name,full_name)")
      .eq("id", id).maybeSingle()),
  });
  const a = q.data;
  useTitulo(informarTitulo, a?.o_que);

  const decidir = useMutation({
    mutationFn: async (decisao: "aprovado" | "rejeitado" | "alteracoes_pedidas") => {
      if (!a) throw new Error("Atualize o pedido antes de decidir.");
      const comentario = nota.trim();
      if (decisao !== "aprovado" && !comentario) throw new Error("Escreva um comentário para explicar a decisão.");
      const identidade = JSON.stringify([a.id, a.payload_version, decisao, comentario]);
      if (!chaves.current.has(identidade)) chaves.current.set(identidade, crypto.randomUUID());
      const comando = comandoDaAprovacao(a, decisao, comentario, chaves.current.get(identidade)!);
      const { data, error } = await db().rpc(comando.rpc, comando.args);
      if (error) throw new Error(error.message);
      return { data, decisao };
    },
    onSuccess: ({ decisao }) => {
      setConfirmando(false);
      setNota("");
      invalidarTudo(qc);
      void qc.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] });
      void qc.invalidateQueries({ queryKey: ["central-review-approvals"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(
        decisao === "aprovado"
          ? "Aprovado. O envio ainda precisa ser executado e confirmado."
          : decisao === "rejeitado"
            ? "Rejeitado. Fica registrado o porquê."
            : "Alterações pedidas. Vem uma nova versão do pedido.",
      );
    },
    onError: (e) => toast.error(centralReviewError(e)),
  });

  const estado = estadoDaLeitura(q, "Abrindo o pedido");
  if (estado || !a) return <>{estado}</>;
  const st = STATUS_DA_APROVACAO[a.status] || { rotulo: a.status, classe: "bg-muted text-muted-foreground" };
  const relatorio = a.payload?.report as Record<string, any> | undefined;
  const destino = a.payload?.destination as Record<string, any> | undefined;
  const daCentral = a.origin === "central" || !!a.report_id;
  const aberta = ["pendente", "adiado"].includes(a.status) && !a.executed_at;
  const cliente = nomeDoCliente(a.client);
  const blocosDoRelatorio: Array<[string, unknown]> = daCentral
    ? [["Mensagem", relatorio?.summary ?? a.payload?.message], ["Destaques", relatorio?.highlights], ["Próximos passos", relatorio?.next_steps ?? a.payload?.next_steps]]
    : [];

  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe={st.classe}>{st.rotulo}</Pilula>
        <Pilula classe="bg-secondary text-secondary-foreground">{ROTULO_DA_ACAO[a.action_kind] || a.action_kind}</Pilula>
        {a.executed_at && <Pilula classe="bg-success/15 text-success">Enviado</Pilula>}
      </div>
      <p className="mt-2 break-words text-[15px] font-semibold leading-[22px] [overflow-wrap:anywhere]">{a.o_que}</p>
      {a.por_que && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground/85 [overflow-wrap:anywhere]">{a.por_que}</p>}

      <div className="mt-2">
        <Linha rotulo="Cliente">{cliente}</Linha>
        <Linha rotulo="Origem">{a.origin === "central" ? "Central do cliente" : a.origin}</Linha>
        <Linha rotulo="Destino">{a.destino}</Linha>
        <Linha rotulo="Risco">{a.risco}</Linha>
        <Linha rotulo="Versão">{String(a.payload_version)}</Linha>
        <Linha rotulo="Pedido em">{dataHora(a.created_at)}</Linha>
        <Linha rotulo="Válida até">{dataHora(a.valid_until)}</Linha>
        <Linha rotulo="Decidida em">{dataHora(a.decided_at)}</Linha>
        <Linha rotulo="Nota">{a.decision_note}</Linha>
      </div>

      {daCentral && (
        <section className="mt-3 min-w-0 rounded-md bg-muted/50 px-3 py-2.5" aria-label="Conteúdo para aprovação">
          <p className="truncate text-[13px] font-semibold">{String(relatorio?.title || "Mensagem para o cliente")}</p>
          <Linha rotulo="Canal">{destino?.channel === "whatsapp" ? "WhatsApp" : destino?.channel === "portal" ? "Portal do cliente" : null}</Linha>
          <Linha rotulo="Para">{typeof destino?.recipient === "string" ? destino.recipient : null}</Linha>
          {blocosDoRelatorio.map(([nome, valor]) => typeof valor === "string" && valor.trim() ? (
            <div key={nome} className="mt-2 min-w-0">
              <span className={texto.rotulo}>{nome}</span>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 [overflow-wrap:anywhere]">{valor}</p>
            </div>
          ) : null)}
          {!(typeof (relatorio?.summary ?? a.payload?.message) === "string" && String(relatorio?.summary ?? a.payload?.message).trim()) && (
            <p className="mt-2 text-[12px] text-warning">A mensagem ainda não foi preparada.</p>
          )}
        </section>
      )}

      {aberta && (
        <div className="mt-3 min-w-0">
          <label className="block">
            <span className={juntar(texto.rotulo, "flex items-center")}>
              Comentário
              <Ajuda texto="Obrigatório para rejeitar ou pedir alterações." />
            </span>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              aria-label="Comentário da decisão"
              placeholder="O que mudar, ou por que rejeitar"
              className={juntar(campoTexto, "mt-1 min-h-[64px] text-[12px]")}
            />
          </label>
          {confirmando ? (
            <div className="mt-2 min-w-0 rounded-md bg-primary/10 px-3 py-2.5">
              <p className="text-[12px] leading-5 text-foreground">{AVISO_DO_ESCOPO}</p>
              <Acoes>
                <button type="button" className={BOTAO_PRINCIPAL} disabled={decidir.isPending} onClick={() => decidir.mutate("aprovado")}>
                  {decidir.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  Confirmar aprovação
                </button>
                <button type="button" className={BOTAO_PEQUENO} disabled={decidir.isPending} onClick={() => setConfirmando(false)}>Cancelar</button>
              </Acoes>
            </div>
          ) : (
            <Acoes>
              <button type="button" className={BOTAO_PRINCIPAL} disabled={decidir.isPending} onClick={() => setConfirmando(true)}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Aprovar
              </button>
              <button
                type="button"
                className={juntar(botao.perigo, "h-8 px-3 text-[12px]")}
                disabled={decidir.isPending}
                onClick={() => (nota.trim() ? decidir.mutate("rejeitado") : toast.error("Escreva um comentário para explicar a rejeição."))}
              >
                Rejeitar
              </button>
              <button
                type="button"
                className={BOTAO_PEQUENO}
                disabled={decidir.isPending}
                onClick={() => (nota.trim() ? decidir.mutate("alteracoes_pedidas") : toast.error("Diga o que alterar no comentário."))}
              >
                Pedir alterações
              </button>
            </Acoes>
          )}
        </div>
      )}

      {a.task_link_id && aoAbrirDiario && (
        <Acoes>
          <button type="button" className={BOTAO_PEQUENO} onClick={() => aoAbrirDiario(a.task_link_id, a.o_que)}>
            <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Abrir diário
          </button>
        </Acoes>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ projeto

const STATUS_DO_PROJETO: Record<string, string> = { planning: "Planejamento", active: "Ativo", review: "Revisão", paused: "Pausado", done: "Concluído" };

type Projeto = {
  id: string; name: string; status: string; client_id: string; created_at: string; updated_at: string;
  deleted_at: string | null; client?: Pessoa;
};
type TarefaDoProjeto = { id: string; title: string; status: string; due_date: string | null; updated_at: string };

function VerProjeto({ id, informarTitulo, aoAbrirFerramenta, abrir }: PropsDaVista) {
  const q = useQuery({
    queryKey: ["objeto-central", "projeto", id],
    queryFn: () => lerUma<Projeto>(db().from("projects")
      .select("id,name,status,client_id,created_at,updated_at,deleted_at,client:profiles!projects_client_id_fkey(company_name,full_name)")
      .eq("id", id).maybeSingle()),
  });
  const tarefas = useQuery({
    queryKey: ["objeto-central", "projeto", id, "tarefas"],
    enabled: !!q.data,
    queryFn: () => lerVarias<TarefaDoProjeto>(db().from("tasks")
      .select("id,title,status,due_date,updated_at")
      .eq("project_id", id).is("deleted_at", null).order("updated_at", { ascending: false }).limit(1000)),
  });
  const p = q.data;
  useTitulo(informarTitulo, p?.name);
  const estado = estadoDaLeitura(q, "Abrindo o projeto");
  if (estado || !p) return <>{estado}</>;
  const lista = tarefas.data || [];
  const contagem = STATUS_EDITAVEIS.map((s) => [s, lista.filter((t) => t.status === s).length] as const);
  const recentes = lista.slice(0, 8);
  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe="bg-secondary text-secondary-foreground">{STATUS_DO_PROJETO[p.status] || p.status}</Pilula>
        {p.deleted_at && <Pilula classe="bg-destructive/15 text-destructive">Na lixeira</Pilula>}
      </div>
      <div className="mt-2">
        <Linha rotulo="Cliente">{nomeDoCliente(p.client)}</Linha>
        <Linha rotulo="Criado em">{dataHora(p.created_at)}</Linha>
        <Linha rotulo="Atualizado">{dataHora(p.updated_at)}</Linha>
      </div>

      <div className="mt-3">
        <span className={texto.rotulo}>Tarefas abertas</span>
        {tarefas.isLoading ? (
          <Carregando linhas={1} rotulo="Contando as tarefas" className="mt-1" />
        ) : tarefas.isError ? (
          <EstadoDeErro titulo="Não consegui ler as tarefas." descricao={mensagemDoErro(tarefas.error)} className="mt-1" />
        ) : (
          <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {contagem.map(([s, n]) => (
              <div key={s} className="min-w-0 rounded-md bg-muted/50 px-2 py-1.5">
                <p className="text-[15px] font-semibold tabular-nums leading-5">{n}</p>
                <p className="truncate text-[11px] text-muted-foreground">{STATUS_DA_TAREFA[s].rotulo}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {recentes.length > 0 && (
        <div className="mt-3 min-w-0">
          <span className={texto.rotulo}>Recentes</span>
          <ul className="-mx-2 mt-1 min-w-0">
            {recentes.map((t) => (
              <li key={t.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => abrir({ tipo: "tarefa", id: t.id, titulo: t.title, client_id: p.client_id })}
                  className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                  <span className="ml-2 shrink-0"><StatusDaTarefa status={t.status} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Acoes>
        <BotaoDaFerramenta rotulo="Kanban do projeto" caminho={`/kanban?client=${encodeURIComponent(p.client_id)}&project=${encodeURIComponent(p.id)}`} nome="Kanban" aoAbrir={aoAbrirFerramenta} />
        <BotaoDaFerramenta rotulo="Arquivos" caminho={`/arquivos?client=${encodeURIComponent(p.client_id)}&project=${encodeURIComponent(p.id)}`} nome="Arquivos" aoAbrir={aoAbrirFerramenta} />
      </Acoes>
    </div>
  );
}

// ------------------------------------------------------------------ arquivo

type Arquivo = {
  id: string; file_name: string; mime_type: string | null; file_type: string | null; extension: string | null;
  size_bytes: number | null; file_url: string; storage_bucket: string | null; storage_path: string | null;
  client_id: string; created_at: string; archived_at: string | null;
};

const EXTENSOES_DE_TEXTO = ["txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "html", "htm", "srt", "vtt", "yml", "yaml"];

function tipoDaPrevia(a: Arquivo): "imagem" | "video" | "audio" | "pdf" | "texto" | "outro" {
  const mime = (a.mime_type || "").toLowerCase();
  const ext = fileExtension(a.file_name, a.file_url, a.extension);
  if (mime.startsWith("text/") || mime === "application/json" || EXTENSOES_DE_TEXTO.includes(ext)) return "texto";
  if (mime === "application/pdf") return "pdf";
  const kind = mediaKindFromFile(a.file_name, a.file_url, a.mime_type || a.file_type, a.extension);
  if (kind === "image") return "imagem";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "pdf") return "pdf";
  return "outro";
}

function VerArquivo({ id, informarTitulo, aoAbrirFerramenta }: PropsDaVista) {
  const q = useQuery({
    queryKey: ["objeto-central", "arquivo", id],
    queryFn: () => lerUma<Arquivo>(db().from("files")
      .select("id,file_name,mime_type,file_type,extension,size_bytes,file_url,storage_bucket,storage_path,client_id,created_at,archived_at")
      .eq("id", id).maybeSingle()),
  });
  const a = q.data;
  useTitulo(informarTitulo, a?.file_name);
  // Só pelo resolveFileUrl: arquivo privado vem assinado com a sessão de quem lê.
  const url = useQuery({
    queryKey: ["objeto-central", "arquivo", id, "url"],
    enabled: !!a,
    staleTime: 30 * 60_000,
    queryFn: () => resolveFileUrl({ fileUrl: a!.file_url, storageBucket: a!.storage_bucket, storagePath: a!.storage_path }),
  });
  const previa = a ? tipoDaPrevia(a) : "outro";
  const conteudo = useQuery({
    queryKey: ["objeto-central", "arquivo", id, "texto"],
    enabled: !!url.data && previa === "texto",
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const r = await fetch(url.data!);
      if (!r.ok) throw new Error(`O arquivo não abriu (${r.status}).`);
      const t = await r.text();
      return t.length > 20_000 ? `${t.slice(0, 20_000)}\n…` : t;
    },
  });
  const estado = estadoDaLeitura(q, "Abrindo o arquivo");
  if (estado || !a) return <>{estado}</>;
  const ext = fileExtension(a.file_name, a.file_url, a.extension);
  const endereco = url.data || "";

  let corpo: ReactNode = null;
  if (url.isLoading) corpo = <Carregando linhas={2} rotulo="Preparando a prévia" />;
  else if (url.isError || !endereco) corpo = <EstadoDeErro titulo="Não consegui gerar o link do arquivo." descricao={url.isError ? mensagemDoErro(url.error) : undefined} />;
  else if (previa === "imagem") corpo = <img src={endereco} alt={a.file_name} className="block h-auto max-w-full rounded-md bg-muted/50" />;
  else if (previa === "video") corpo = <video src={endereco} controls preload="metadata" className="block w-full max-w-full rounded-md bg-muted/50" />;
  else if (previa === "audio") corpo = <audio src={endereco} controls preload="metadata" className="block w-full" />;
  else if (previa === "pdf") corpo = <iframe src={endereco} title={`Prévia de ${a.file_name}`} className="block h-[70vh] min-h-[320px] w-full rounded-md border border-border bg-background" />;
  else if (previa === "texto") {
    corpo = conteudo.isLoading ? <Carregando linhas={2} rotulo="Lendo o texto" />
      : conteudo.isError ? <EstadoDeErro titulo="Não consegui ler o texto." descricao={mensagemDoErro(conteudo.error)} />
        : <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-[12px] leading-5 [overflow-wrap:anywhere]">{conteudo.data}</pre>;
  } else corpo = <p className={texto.auxiliar}>Sem prévia para este tipo de arquivo.</p>;

  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe="bg-secondary text-secondary-foreground">{(ext || a.mime_type || a.file_type || "arquivo").toLowerCase()}</Pilula>
        {a.archived_at && <Pilula classe="bg-muted text-muted-foreground">Arquivado</Pilula>}
      </div>
      <div className="mt-2">
        <Linha rotulo="Tipo">{a.mime_type || a.file_type}</Linha>
        <Linha rotulo="Tamanho">{tamanho(a.size_bytes)}</Linha>
        <Linha rotulo="Enviado em">{dataHora(a.created_at)}</Linha>
      </div>
      <div className="mt-3 min-w-0">{corpo}</div>
      <Acoes>
        {endereco && (
          <a href={endereco} target="_blank" rel="noreferrer" download={a.file_name} className={BOTAO_PEQUENO}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Baixar
          </a>
        )}
        {a.client_id && <BotaoDaFerramenta rotulo="Abrir no Workspace" caminho={`/workspace?client=${encodeURIComponent(a.client_id)}`} nome="Workspace" aoAbrir={aoAbrirFerramenta} />}
      </Acoes>
    </div>
  );
}

// ------------------------------------------------------------------ publicação

const PLATAFORMA: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", google_business: "Google Business" };
const STATUS_DA_PUBLICACAO: Record<string, string> = { planned: "Planejado", scheduled: "Agendado", published: "Publicado", failed: "Falhou", cancelled: "Cancelado" };
const STATUS_DA_PRODUCAO: Record<string, string> = { draft: "Rascunho", production: "Em produção", ready: "Pronto", cancelled: "Cancelado" };

type Post = {
  id: string; title: string; production_status: string; content_type: string; default_caption: string | null;
  client_id: string; project_id: string; created_at: string; archived_at: string | null;
};
type Publicacao = {
  id: string; platform: string; status: string; scheduled_at: string | null; published_at: string | null;
  permalink: string | null; caption: string | null;
};
const COLUNAS_DO_POST = "id,title,production_status,content_type,default_caption,client_id,project_id,created_at,archived_at";

function VerPublicacao({ id, client_id, informarTitulo, aoAbrirFerramenta }: PropsDaVista) {
  const q = useQuery({
    queryKey: ["objeto-central", "publicacao", id],
    queryFn: async () => {
      let post = await lerUma<Post>(db().from("editorial_posts").select(COLUNAS_DO_POST).eq("id", id).maybeSingle());
      if (!post) {
        // O Gestor pode citar a publicação (uma rede) em vez do post: subir ao post dela.
        const pub = await lerUma<{ post_id: string }>(db().from("editorial_publications").select("post_id").eq("id", id).maybeSingle());
        if (pub?.post_id) post = await lerUma<Post>(db().from("editorial_posts").select(COLUNAS_DO_POST).eq("id", pub.post_id).maybeSingle());
      }
      if (!post) return null;
      const publicacoes = await lerVarias<Publicacao>(db().from("editorial_publications")
        .select("id,platform,status,scheduled_at,published_at,permalink,caption")
        .eq("post_id", post.id).order("scheduled_at", { ascending: true }));
      return { post, publicacoes };
    },
  });
  useTitulo(informarTitulo, q.data?.post.title);
  const estado = estadoDaLeitura(q, "Abrindo a publicação");
  if (estado || !q.data) return <>{estado}</>;
  const { post, publicacoes } = q.data;
  const legenda = publicacoes.find((p) => p.caption?.trim())?.caption || post.default_caption;
  const cliente = post.client_id || client_id;
  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe="bg-secondary text-secondary-foreground">{STATUS_DA_PRODUCAO[post.production_status] || post.production_status}</Pilula>
        <Pilula classe="bg-muted text-muted-foreground">{post.content_type}</Pilula>
        {post.archived_at && <Pilula classe="bg-muted text-muted-foreground">Arquivado</Pilula>}
      </div>
      {publicacoes.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {publicacoes.map((p) => {
            const link = linkWeb(p.permalink);
            return (
              <li key={p.id} className="min-w-0 rounded-md bg-muted/50 px-2.5 py-2">
                <div className="flex min-w-0 items-center">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{PLATAFORMA[p.platform] || p.platform}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{STATUS_DA_PUBLICACAO[p.status] || p.status}</span>
                </div>
                <Linha rotulo="Agendada">{dataHora(p.scheduled_at)}</Linha>
                <Linha rotulo="Publicada">{dataHora(p.published_at)}</Linha>
                {link && (
                  <a href={link} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center text-[12px] font-medium text-primary hover:underline">
                    <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />Ver na rede
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={juntar(texto.auxiliar, "mt-2")}>Ainda sem rede agendada.</p>
      )}
      {legenda?.trim() && <TextoLongo rotulo="Legenda" valor={legenda} />}
      {cliente && (
        <Acoes>
          <BotaoDaFerramenta rotulo="Abrir no Calendário" caminho={`/calendario?client=${encodeURIComponent(cliente)}`} nome="Calendário" aoAbrir={aoAbrirFerramenta} />
        </Acoes>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ vínculo (execução de agente)

type Vinculo = {
  id: string; status: string; last_action: string | null; last_evidence: string | null; next_step: string | null;
  block_reason: string | null; updated_at: string; kanban_task_id: string | null; operator?: { display_name?: string | null } | null;
};

function VerVinculo({ id, informarTitulo, aoAbrirDiario }: PropsDaVista) {
  const q = useQuery({
    queryKey: ["objeto-central", "vinculo", id],
    queryFn: async () => {
      const v = await lerUma<Vinculo>(db().from("operator_task_links")
        .select("id,status,last_action,last_evidence,next_step,block_reason,updated_at,kanban_task_id,operator:internal_operators!operator_task_links_operator_id_fkey(display_name)")
        .eq("id", id).maybeSingle());
      if (!v) return null;
      // kanban_task_id não tem chave estrangeira: a tarefa vem numa leitura à parte.
      const t = v.kanban_task_id ? await lerUma<{ id: string; title: string }>(db().from("tasks").select("id,title").eq("id", v.kanban_task_id).maybeSingle()) : null;
      return { vinculo: v, tarefa: t?.title || null };
    },
  });
  const agente = q.data?.vinculo.operator?.display_name || "Agente";
  useTitulo(informarTitulo, q.data ? q.data.tarefa || `Execução de ${agente}` : null);
  const estado = estadoDaLeitura(q, "Abrindo a execução");
  if (estado || !q.data) return <>{estado}</>;
  const { vinculo: v, tarefa } = q.data;
  const evidencia = linkWeb(v.last_evidence);
  return (
    <div className="min-w-0">
      <div className="-m-0.5 flex flex-wrap items-center [&>*]:m-0.5">
        <Pilula classe={v.status === "blocked" || v.status === "failed" ? "bg-destructive/15 text-destructive" : v.status === "done" ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground"}>{estadoDaExecucao(v.status)}</Pilula>
      </div>
      <div className="mt-2">
        <Linha rotulo="Agente">{agente}</Linha>
        <Linha rotulo="Tarefa">{tarefa}</Linha>
        <Linha rotulo="Última ação">{v.last_action}</Linha>
        <Linha rotulo="Evidência">{evidencia ? <a href={evidencia} target="_blank" rel="noreferrer" className="break-all text-primary underline">{v.last_evidence}</a> : v.last_evidence}</Linha>
        <Linha rotulo="Próximo passo">{v.next_step}</Linha>
        <Linha rotulo="Bloqueio">{v.block_reason}</Linha>
        <Linha rotulo="Atualizado">{dataHora(v.updated_at)}</Linha>
      </div>
      {aoAbrirDiario && (
        <Acoes>
          <button type="button" className={BOTAO_PRINCIPAL} onClick={() => aoAbrirDiario(v.id, tarefa || undefined)}>
            <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Abrir diário
          </button>
        </Acoes>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ painel

const VISTAS: Record<ObjetoAberto["tipo"], (p: PropsDaVista) => JSX.Element> = {
  tarefa: VerTarefa,
  memoria_agente: VerMemoriaDoAgente,
  memoria_projeto: VerMemoriaDoProjeto,
  aprovacao: VerAprovacao,
  projeto: VerProjeto,
  arquivo: VerArquivo,
  publicacao: VerPublicacao,
  vinculo: VerVinculo,
};

function PainelDoObjeto({ objeto, aoFechar, aoAbrirFerramenta, aoAbrirDiario }: PropsDoObjeto) {
  // Do projeto se abre uma tarefa dele sem sair do painel; "Voltar" desempilha.
  const [pilha, setPilha] = useState<ObjetoAberto[]>([]);
  const [titulos, setTitulos] = useState<Record<string, string>>({});
  const atual = pilha.length ? pilha[pilha.length - 1] : objeto;
  const chaveAtual = `${atual.tipo}:${atual.id}`;
  const anterior = pilha.length > 1 ? pilha[pilha.length - 2] : pilha.length === 1 ? objeto : null;
  const informarAtual = useCallback(
    (t: string) => setTitulos((s) => (s[chaveAtual] === t ? s : { ...s, [chaveAtual]: t })),
    [chaveAtual],
  );
  const titulo = titulos[chaveAtual] || atual.titulo || ROTULO_DO_TIPO[atual.tipo];
  const tituloAnterior = anterior ? titulos[`${anterior.tipo}:${anterior.id}`] || anterior.titulo || ROTULO_DO_TIPO[anterior.tipo] : "";
  const Vista = VISTAS[atual.tipo];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-border/60 px-3 py-2">
        {anterior && (
          <button
            type="button"
            onClick={() => setPilha((s) => s.slice(0, -1))}
            className={juntar(botao.barra, "mr-1.5 max-w-[40%] px-1.5")}
            aria-label={`Voltar para ${tituloAnterior}`}
            title={tituloAnterior}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Voltar</span>
          </button>
        )}
        <span className="mr-2 shrink-0 text-[11px] font-medium text-muted-foreground">{ROTULO_DO_TIPO[atual.tipo]}</span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={titulo}>{titulo}</p>
        <button type="button" onClick={aoFechar} className={juntar(botao.icone, "ml-1 h-7 w-7")} aria-label="Fechar">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
        <Vista
          key={chaveAtual}
          id={atual.id}
          client_id={atual.client_id}
          informarTitulo={informarAtual}
          aoAbrirFerramenta={aoAbrirFerramenta}
          aoAbrirDiario={aoAbrirDiario}
          abrir={(o) => setPilha((s) => [...s, o])}
        />
      </div>
    </div>
  );
}

export default function ObjetoDaCentral(props: PropsDoObjeto): JSX.Element {
  // Outro objeto aberto de fora zera a pilha e os títulos do painel.
  return <PainelDoObjeto key={`${props.objeto.tipo}:${props.objeto.id}`} {...props} />;
}

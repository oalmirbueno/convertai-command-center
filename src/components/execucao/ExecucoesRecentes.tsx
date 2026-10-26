import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { nomeDaTarefa } from "@/lib/nomeDaTarefa";
import { Activity, CheckCircle2, Clock, MessageSquare } from "lucide-react";
import { estadoDaExecucao, falhaDaExecucao } from "@/lib/execucaoApresentacao";
import { leituraSimples } from "@/lib/cadernoExecucao";
import { botao, juntar, superficie } from "@/components/sistema";
import EvidenciaVisual from "./EvidenciaVisual";
import LeituraEmBlocos from "./LeituraEmBlocos";
import DestravarAqui from "./DestravarAqui";

/** Execuções que pedem a mão do dono: travada, esperando resposta, falhou ou entrega para conferir. */
const PRECISA_DE_DESTRAVE = ["blocked", "awaiting_input", "failed", "review"];
const ROTULO_DESTRAVADA: Record<string, string> = {
  responder: "Respondida por você",
  pode_seguir: "Liberada por você",
  concluir: "Concluída por você",
  encerrar: "Encerrada por você",
};

/** Execuções desenhadas por vez (26/10): o resto entra por "Mostrar mais". */
const LOTE = 40;

/**
 * 26/10 (dono: "quando eu clico em Trabalho, nossa, ela pesa, trava"): o detalhe de cada execução
 * (leitura em blocos, provas, destravar) era montado mesmo FECHADO, para as 200: cada prova
 * fechada já pedia o arquivo e a assinatura dele. Agora o detalhe só existe depois de aberto.
 */
function Linha({ aberta: abertaDeInicio, className, cabecalho, alvo, children }: { aberta: boolean; className: string; cabecalho: ReactNode; alvo?: Ref<HTMLDetailsElement>; children: () => ReactNode }) {
  const [aberta, setAberta] = useState(abertaDeInicio);
  useEffect(() => { if (abertaDeInicio) setAberta(true); }, [abertaDeInicio]);
  // O estado manda no "open" (o clique no resumo troca na hora; o evento toggle do navegador chega depois).
  return <details open={aberta} ref={alvo} className={className}>
    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-muted/30" onClick={(e) => { e.preventDefault(); setAberta((a) => !a); }}>
      {cabecalho}
    </summary>
    {aberta ? children() : null}
  </details>;
}

function ExecucoesRecentes({ runs, agentes, vinculos, tarefas, destaque, aoConversar }: {
  runs: Record<string, any>[]; agentes: { id: string; display_name: string; area?: string | null }[];
  vinculos: Record<string, any>[]; tarefas: Map<string, any>; destaque?: string | null;
  aoConversar: (id: string, titulo?: string) => void;
}) {
  const alvo = useRef<HTMLDetailsElement>(null);
  const [limite, setLimite] = useState(LOTE);
  // Rola até a execução do link UMA vez (antes rolava de novo a cada releitura da lista).
  const rolouPara = useRef<string | null>(null);
  useEffect(() => {
    if (!destaque || rolouPara.current === destaque || !alvo.current) return;
    rolouPara.current = destaque;
    alvo.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [destaque, runs.length]);
  const agentePorId = useMemo(() => new Map(agentes.map((a) => [a.id, a])), [agentes]);
  const vinculoPorId = useMemo(() => new Map(vinculos.map((v) => [v.id, v])), [vinculos]);
  if (!runs.length) return <p className="text-[13px] text-muted-foreground">Nenhuma execução neste recorte.</p>;
  const posicaoDoDestaque = destaque ? runs.findIndex((r) => r.id === destaque) : -1;
  const ate = Math.max(limite, posicaoDoDestaque + 1);
  const visiveis = runs.length > ate ? runs.slice(0, ate) : runs;
  const faltam = runs.length - visiveis.length;
  // 15/10 (dono: "está bem confusa, não consigo entender o que é"): linha do tempo por dia; cada execução numa linha, o detalhe ao abrir.
  const diaDe = (r: Record<string, any>) => new Date(r.heartbeat_at || r.started_at).toLocaleDateString("pt-BR");
  const hoje = new Date().toLocaleDateString("pt-BR");
  const ontem = new Date(Date.now() - 86_400_000).toLocaleDateString("pt-BR");
  const rotuloDoDia = (dia: string) => (dia === hoje ? "Hoje" : dia === ontem ? "Ontem" : dia.slice(0, 5));
  const porDia = new Map<string, Record<string, any>[]>();
  for (const r of visiveis) { const d = diaDe(r); const lista = porDia.get(d); if (lista) lista.push(r); else porDia.set(d, [r]); }
  return <div className="space-y-5">{[...porDia.entries()].map(([dia, doDia]) => <section key={dia} aria-label={`Execuções de ${rotuloDoDia(dia)}`}>
    <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{rotuloDoDia(dia)}</p>
    <div className="space-y-1.5">{doDia.map(r => {
    const agente = agentePorId.get(r.operator_id);
    const v = r.task_link_id ? vinculoPorId.get(r.task_link_id) : undefined;
    const tarefa = tarefas.get(v?.kanban_task_id || v?.painel_task_id);
    const d = r.detail || {};
    // 26/10: com tarefa, "Área · assunto" (o cliente vai ao lado); sem tarefa, só o assunto sem o código ACE.
    const nome = nomeDaTarefa({ titulo: d.title || tarefa?.title || d.action || v?.last_action || "Execução sem título informado", cliente: tarefa?.project?.client?.company_name || tarefa?.project?.client?.full_name || d.client_name, tipoDeEntrega: tarefa?.delivery_type, agente: agente?.display_name });
    const titulo = tarefa ? nome.semCliente : nome.assunto;
    const cliente = tarefa?.project?.client;
    const nomeCliente = cliente?.company_name || cliente?.full_name || d.client_name;
    const provas = Array.isArray(d.attachments) ? d.attachments : [];
    const ruim = ["failed", "timeout"].includes(r.status);
    // 19/10: rodada fechada pelo agente (fim_da_rodada) não é tarefa concluída; a tarefa segue na fila.
    const rodada = r.status === "done" && d.fim_da_rodada === true;
    // 19/10 (dono: "uma área que destrava tudo por ali"): resolvida pelo dono no próprio cartão.
    const destravada = d.destravado && typeof d.destravado === "object" ? d.destravado as { acao?: string; texto?: string | null } : null;
    const precisaDestravar = PRECISA_DE_DESTRAVE.includes(r.status) && !destravada;
    const emBlocos = () => !!d.summary && leituraSimples(String(d.summary)).secoes.length > 0;
    return <Linha key={r.id} aberta={r.id === destaque} alvo={r.id === destaque ? alvo : undefined} className={juntar(superficie.painel, "group overflow-hidden", r.id === destaque && "ring-1 ring-primary")} cabecalho={<>
        {r.status === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Activity className={juntar("h-4 w-4 shrink-0", ruim ? "text-warning" : "text-muted-foreground")} />}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold" title={agente?.display_name || "Agente"} aria-hidden="true">{(agente?.display_name || "A").slice(0, 1)}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{titulo}</p><p className="truncate text-[12px] text-muted-foreground">{agente?.display_name || "Agente"}{nomeCliente ? ` · ${nomeCliente}` : " · operação interna"} · {new Date(r.heartbeat_at || r.started_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p></div>
        <span className={juntar("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", ruim ? "bg-warning/15 text-warning" : r.status === "done" && !rodada ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{destravada ? ROTULO_DESTRAVADA[destravada.acao || ""] || "Resolvida por você" : rodada ? "Rodada concluída" : estadoDaExecucao(r.status)}</span>
      </>}>{() => <div className="max-h-[50vh] space-y-3 overflow-y-auto border-t border-border/60 p-4">
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Clock className="h-3 w-3" />Último registro: {new Date(r.heartbeat_at || r.started_at).toLocaleString("pt-BR")}</p>
        {d.action && <p className="whitespace-pre-wrap text-[13px] font-medium">{d.action}</p>}
        {/* 19/10 (dono: "quando vem assim fica muito confuso"): FEITO / TRAVADO / PRÓXIMO PASSO em blocos, o travado primeiro. */}
        {d.summary && <LeituraEmBlocos texto={d.summary} />}
        {precisaDestravar && <DestravarAqui runId={r.id} motivo={[d.summary, r.error, d.action].filter(Boolean).join(" ")} revisao={r.status === "review"} />}
        {destravada && <p className="flex items-start rounded-lg bg-success/5 px-3 py-2 text-[13px] text-foreground/90"><CheckCircle2 className="mr-1.5 mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{ROTULO_DESTRAVADA[destravada.acao || ""] || "Resolvida por você"}{destravada.texto ? `: ${destravada.texto}` : "."}</span></p>}
        {emBlocos() && <details className="text-[12px] text-muted-foreground"><summary className="cursor-pointer">Ver o texto original do agente</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{d.summary}</pre></details>}
        {d.page_url && <EvidenciaVisual url={d.page_url} nome="Página consultada" />}
        {r.error && <p className="text-[13px] text-warning">{falhaDaExecucao(r.error)}</p>}
        {(d.evidence || v?.last_evidence) && <EvidenciaVisual url={d.evidence || v.last_evidence} />}
        {provas.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{provas.map((a: any, i: number) => typeof a.url === "string" && <EvidenciaVisual key={i} url={a.url} nome={a.name || "Comprovação"} />)}</div>}
        {!emBlocos() && (d.next_step || v?.next_step) && <p className="text-[13px]"><strong>Próximo passo:</strong> {d.next_step || v.next_step}</p>}
        {r.task_link_id ? <button type="button" className={botao.discreto} onClick={() => aoConversar(r.task_link_id, titulo)}><MessageSquare className="mr-1.5 h-3.5 w-3.5" />Abrir o diário</button> : <p className="text-[12px] text-muted-foreground">O agente ainda não vinculou esta execução a uma tarefa.{precisaDestravar ? " Responda acima: a tarefa nasce na hora, na fila dele." : " O registro permanece disponível aqui."}</p>}
        <details><summary className="cursor-pointer text-[11px] text-muted-foreground">Identificador técnico</summary><code className="break-all text-[11px]">{r.run_key}</code></details>
      </div>}</Linha>;
  })}</div>
  </section>)}
  {faltam > 0 && <button type="button" onClick={() => setLimite(ate + LOTE)} className={juntar(botao.secundario, "h-9 w-full px-3 text-[12px]")}>Mostrar mais {Math.min(LOTE, faltam)} de {faltam}</button>}
  </div>;
}

/* Memorizado: a tela da Execução redesenha a cada releitura e esta lista só muda quando os dados dela mudam. */
export default memo(ExecucoesRecentes);

import EvidenciaVisual from "./EvidenciaVisual";
import { contextoDoPedido } from '@/lib/carteiraOperacao';
import { useEffect, useRef, useState } from "react";
import { leituraSimples, prepararEntrada, tituloDoCaderno, type TomDaSecao } from "@/lib/cadernoExecucao";
import { anexarNoCaderno } from "@/lib/arquivosDoCaderno";
import { chamarFuncao } from "@/lib/mesa/api";
import TarefaDoCaderno from "./TarefaDoCaderno";
import DefinirResponsavel from "./DefinirResponsavel";
import ProvaDaEntrega from "./ProvaDaEntrega";
import { oQueFoiFeito, tipoDaEntrega } from "@/lib/execucaoHumana";
import ChatDoHermes from "./central/ChatDoHermes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, Check, CheckCircle2, ChevronDown, CircleDot, Clock3, Loader2, Lock, Paperclip, RotateCcw, Send, Sparkles, ThumbsDown, ThumbsUp, UserRound, X } from "lucide-react";
import { Carregando, EstadoVazio, SeletorCompacto, botao, campoTexto, etiqueta, juntar, texto as estiloTexto, useEstadoDaTela, superficie } from "@/components/sistema";

/**
 * O diário da execução: onde o dono participa de verdade.
 *
 * Cada entrada tem autor, tipo e hora, e o agente lê pelo MCP antes de continuar. Nada daqui vai
 * para cliente ou canal externo: é caderno interno, e a tabela não alimenta nenhum envio.
 *
 * 16/10/2026 (dono: "vem muito poluído... deixa mais intuitivo, com imagens"; "quando escrever algo
 * já tem que entender"; "não tem algo tipo concluir, aprovar ou não aprovar"; "posso estar trocando
 * o humano aqui também"):
 * - faixa de decisão no topo conforme a situação (aprovar e concluir, pedir ajuste, reprovar,
 *   responder e destravar) e o responsável humano, que se troca ali;
 * - cada entrada em leitura simples (sem ids nem códigos), com as imagens em miniatura e os blocos
 *   "feito / em andamento / próximo / travado" do agente; o registro original fica guardado;
 * - o campo de escrever entende o tipo (Jev, no servidor) e mostra antes de registrar; aprovar e
 *   reprovar nunca acontecem sozinhos: viram botão.
 */

const TIPOS_HUMANOS = [
  { id: "comentario", rotulo: "Comentário" },
  { id: "instrucao", rotulo: "Instrução" },
  { id: "correcao", rotulo: "Correção" },
  { id: "decisao", rotulo: "Decisão" },
  { id: "resposta_insumo", rotulo: "Resposta" },
  { id: "pedido_revisao", rotulo: "Pedir revisão" },
  { id: "contexto", rotulo: "Contexto" },
] as const;

/** Nome de gente para cada tipo do diário (antes aparecia "pedido_insumo", "resposta insumo"...). */
const NOME_DO_TIPO: Record<string, string> = {
  comentario: "Comentário", instrucao: "Instrução", decisao: "Decisão", contexto: "Contexto",
  evidencia: "Comprovação", correcao: "Correção", aprovacao: "Aprovado", rejeicao: "Reprovado",
  pedido_revisao: "Pediu revisão", pedido_insumo: "Precisa de algo seu", resposta_insumo: "Resposta",
};

const TOM_DO_TIPO: Record<string, string> = {
  instrucao: "bg-primary/15 text-primary",
  decisao: "bg-success/15 text-success",
  aprovacao: "bg-success/15 text-success",
  evidencia: "bg-success/10 text-success",
  correcao: "bg-warning/15 text-warning",
  pedido_insumo: "bg-warning/15 text-warning",
  pedido_revisao: "bg-warning/15 text-warning",
  rejeicao: "bg-destructive/15 text-destructive",
};

/** O que o dono lê logo depois de registrar: o que vai acontecer com a fala dele. */
const ENTENDI: Record<string, string> = {
  comentario: "Registrei como comentário. Fica na conversa; o agente lê, mas não muda o rumo por isso.",
  instrucao: "Registrei como instrução. O agente segue isso na próxima rodada desta tarefa.",
  correcao: "Registrei como correção. O agente refaz o ponto apontado antes de seguir.",
  decisao: "Registrei como decisão. O rumo fica fechado e o agente segue por ele.",
  resposta_insumo: "Registrei como resposta. O agente tem o que pediu e pode continuar.",
  pedido_revisao: "Registrei o pedido de revisão. A entrega volta para conferência.",
  contexto: "Registrei como contexto. Vale para esta tarefa daqui em diante.",
};

const TOM_DA_SECAO: Record<TomDaSecao, { cor: string; Icone: typeof Check; nome?: string }> = {
  feito: { cor: "text-success", Icone: CheckCircle2 },
  andamento: { cor: "text-primary", Icone: CircleDot },
  proximo: { cor: "text-muted-foreground", Icone: ArrowRight },
  travado: { cor: "text-warning", Icone: Lock },
  nota: { cor: "text-muted-foreground", Icone: CircleDot },
};

const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  queued: { rotulo: "Na fila", cor: "bg-muted text-muted-foreground" },
  in_progress: { rotulo: "Em andamento", cor: "bg-primary/15 text-primary" },
  review: { rotulo: "Esperando sua revisão", cor: "bg-warning/15 text-warning" },
  awaiting_input: { rotulo: "Esperando algo seu", cor: "bg-warning/15 text-warning" },
  blocked: { rotulo: "Travada", cor: "bg-destructive/15 text-destructive" },
  done: { rotulo: "Concluída", cor: "bg-success/15 text-success" },
};

type Entrada = {
  id: string;
  entry_type: string;
  title: string | null;
  body: string;
  attachments: Array<{ name?: string; url?: string }>;
  author_kind: "humano" | "operador";
  author_id: string | null;
  operator_id: string | null;
  created_at: string;
};

type Vinculo = { id: string; status: string; block_reason: string | null; next_step: string | null; approval_required: boolean | null; last_evidence: string | null; operator_id: string | null; kanban_task_id: string | null; painel_task_id: string | null };
type Leitura = { tipo: string; confianca: number; acao: "aprovar" | "reprovar" | null; fonte: "jev" | "palpite" };
type Modo = null | "ajuste" | "reprovar" | "destravar";

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const inicial = (nome: string) => (nome.trim()[0] || "?").toUpperCase();

/** Links no meio do texto viram "abrir (site)" clicável, em vez do endereço inteiro. */
function ComLinks({ texto }: { texto: string }) {
  return <>{texto.split(/(https?:\/\/[^\s;,)]+)/).map((parte, i) => {
    if (i % 2 === 0) return parte;
    let site = parte;
    try { site = new URL(parte).hostname.replace(/^www\./, ""); } catch { /* fica o endereço */ }
    return <a key={i} href={parte} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">abrir ({site})</a>;
  })}</>;
}

/** Uma entrada do diário em leitura simples: resumo, imagens e os blocos do agente. */
function EntradaDoDiario({ e, autor, doHumano, aoResponder }: { e: Entrada; autor: string; doHumano: boolean; aoResponder: (e: Entrada) => void }) {
  const [aberta, setAberta] = useState(false);
  const documento = prepararEntrada(e.body, e.attachments || []);
  const leitura = leituraSimples(e.body);
  const imagens = documento.anexos;
  const pedeAlgo = !doHumano && e.entry_type === "pedido_insumo";
  return (
    <article className={juntar("rounded-xl p-4", doHumano ? "ml-auto max-w-[85%] bg-primary/10" : "bg-card", pedeAlgo && "ring-1 ring-warning/50")}>
      <header className="flex min-w-0 items-center gap-2 text-[12px]">
        <span className={juntar("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold", doHumano ? "bg-primary/20 text-primary" : "bg-muted text-foreground")} aria-hidden="true">{inicial(autor)}</span>
        <span className="min-w-0 truncate font-semibold text-foreground">{autor}</span>
        <span className={juntar(etiqueta, TOM_DO_TIPO[e.entry_type] || "bg-muted text-muted-foreground")}>{NOME_DO_TIPO[e.entry_type] || e.entry_type.replace(/_/g, " ")}</span>
        <span className="ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground">{quando(e.created_at)}</span>
      </header>
      {e.title && <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-foreground">{tituloDoCaderno(e.title)}</h3>}
      <p className="mt-1.5 whitespace-pre-line text-[14px] leading-6 text-foreground/90">{leitura.resumo ? <ComLinks texto={leitura.resumo} /> : "Atualização sem texto."}</p>
      {imagens.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {imagens.map((a, i) => <EvidenciaVisual key={i} url={a.url!} nome={a.name || "Comprovação"} compacto />)}
        </div>
      )}
      {aberta && (
        <div className="mt-3 space-y-2.5 border-t border-border/60 pt-3">
          {leitura.secoes.map((s, i) => {
            const t = TOM_DA_SECAO[s.tom];
            return (
              <div key={i} className="flex gap-2.5">
                <t.Icone className={juntar("mt-0.5 h-4 w-4 shrink-0", t.cor)} aria-hidden="true" />
                <p className="min-w-0 text-[13px] leading-6"><span className={juntar("font-medium", t.cor)}>{s.rotulo}: </span><span className="text-foreground/90"><ComLinks texto={s.texto} /></span></p>
              </div>
            );
          })}
          <details className="text-[12px] text-muted-foreground"><summary className="cursor-pointer">Ver o registro técnico (como o agente escreveu)</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{e.body}</pre></details>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {leitura.temMais && <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => setAberta((v) => !v)} aria-expanded={aberta}><ChevronDown className={juntar("mr-1 h-3.5 w-3.5 transition-transform", aberta && "rotate-180")} />{aberta ? "Mostrar menos" : "Ler tudo"}</button>}
        <button type="button" className={juntar(pedeAlgo ? botao.secundario : botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => aoResponder(e)}>{pedeAlgo ? "Responder ao pedido" : "Responder"}</button>
      </div>
    </article>
  );
}

export default function DiarioDaExecucao({
  linkId,
  titulo,
  nomesDeAgentes,
  aberto,
  aoFechar,
  contextoInicial,
  textoInicial,
  substituirRascunho = false,
  abaInicial,
}: {
  /** Abrir já numa aba (ex.: "hermes", vindo da galeria da entrega). */
  abaInicial?: string;
  linkId: string | null;
  titulo?: string;
  /** operator_id -> display_name, resolvido pela página que já tem os operadores. */
  nomesDeAgentes: Map<string, string>;
  aberto: boolean;
  aoFechar: () => void;
  contextoInicial?: { cliente: { id: string; nome: string }; pedido: string };
  /** Texto pronto sem cliente (pedido geral do Gestor). Não sobrescreve rascunho guardado. */
  textoInicial?: string;
  /** O pedido pronto (Gestor) entra no lugar do rascunho guardado, como instrução. */
  substituirRascunho?: boolean;
}) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  // Rascunho guardado por vínculo: fechar o diário ou sair da tela não apaga.
  const [tipoManual, setTipoManual] = useEstadoDaTela<string>(`execucao:diario:tipo:${linkId || ""}`, "", {
    validar: (v) => v === "" || (typeof v === "string" && TIPOS_HUMANOS.some((t) => t.id === v)),
  });
  const [tituloEntrada, setTituloEntrada] = useEstadoDaTela<string>(`execucao:diario:titulo:${linkId || ""}${contextoInicial ? `:${contextoInicial.cliente.id}` : ''}`, "");
  const [texto, setTexto] = useEstadoDaTela<string>(`execucao:diario:texto:${linkId || ""}${contextoInicial ? `:${contextoInicial.cliente.id}` : ''}`, contextoInicial?.pedido || textoInicial || "");
  const [anexos, setAnexos] = useState<Array<{ name: string; url: string }>>([]);
  const [subindo, setSubindo] = useState(false);
  const [aba, setAba] = useState("diario");
  const [limite, setLimite] = useState(40);
  const [modo, setModo] = useState<Modo>(null);
  const [leitura, setLeitura] = useState<{ texto: string; l: Leitura } | null>(null);
  const [entendi, setEntendi] = useState<string | null>(null);
  const [trocarResponsavel, setTrocarResponsavel] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setAnexos([]); setAba(abaInicial || "diario"); setLimite(40); setModo(null); setEntendi(null); }, [linkId, contextoInicial?.cliente.id, abaInicial]);
  useEffect(() => {
    if (!aberto || !substituirRascunho) return;
    const pronto = contextoInicial?.pedido || textoInicial || "";
    if (pronto) { setTexto(pronto); setTipoManual("instrucao"); }
  }, [aberto, substituirRascunho, linkId, contextoInicial?.pedido, textoInicial]);
  useEffect(() => { if (!entendi) return; const t = setTimeout(() => setEntendi(null), 9_000); return () => clearTimeout(t); }, [entendi]);

  const vinculo = useQuery({
    queryKey: ['diario-vinculo', linkId], enabled: aberto && !!linkId, refetchInterval: 15_000,
    queryFn: async () => {
      const l = await (supabase as any).from('operator_task_links').select('id,status,block_reason,next_step,approval_required,last_evidence,operator_id,kanban_task_id,painel_task_id').eq('id', linkId!).single();
      if (l.error) throw l.error;
      return l.data as Vinculo;
    },
  });
  const contexto = useQuery({
    queryKey: ['diario-contexto', linkId], enabled: aberto && !!linkId, staleTime: 60_000,
    queryFn: async () => {
      const l = await supabase.from('operator_task_links').select('kanban_task_id,painel_task_id').eq('id', linkId!).single();
      if (l.error) throw l.error;
      const id = l.data.kanban_task_id || l.data.painel_task_id;
      if (!id) return null;
      const t = await supabase.from('tasks').select('id,title,assigned_to,delivery_type,project:projects!tasks_project_id_fkey(id,name,client:profiles!projects_client_id_fkey(id,company_name,full_name))').eq('id', id).maybeSingle();
      // Tarefa apagada no Kanban e caso normal (o vinculo nao tem FK dura): sem contexto, sem 406.
      if (t.error) throw t.error;
      return (t.data ?? null) as any;
    },
  });
  const responsavel = useQuery({
    queryKey: ['diario-responsavel', contexto.data?.assigned_to], enabled: !!contexto.data?.assigned_to, staleTime: 5 * 60_000,
    queryFn: async () => (await supabase.from('profiles').select('full_name').eq('id', contexto.data!.assigned_to).maybeSingle()).data?.full_name || null,
  });

  const { data: entradas = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["diario", linkId, limite],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_participations")
        .select("id, entry_type, title, body, attachments, author_kind, author_id, operator_id, created_at")
        .eq("task_link_id", linkId)
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) throw new Error(error.message);
      return (data || []) as Entrada[];
    },
    enabled: aberto && Boolean(linkId),
    refetchInterval: 8_000,
  });

  /* Nomes dos autores humanos, resolvidos uma vez. */
  const humanIds = [...new Set(entradas.map((e) => e.author_id).filter(Boolean))] as string[];
  const { data: nomesHumanos = new Map() } = useQuery({
    queryKey: ["diario-autores", humanIds.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles").select("id, full_name").in("id", humanIds);
      if (error) throw new Error(error.message);
      const m = new Map<string, string>();
      for (const p of data || []) m.set(String(p.id), p.full_name || "pessoa");
      return m;
    },
    enabled: humanIds.length > 0,
  });
  const nomeDoAutor = (e: Entrada) => e.author_kind === "humano"
    ? (e.author_id === user?.id ? (profile?.full_name || "Você") : nomesHumanos.get(String(e.author_id)) || "pessoa")
    : nomesDeAgentes.get(String(e.operator_id)) || "Agente";
  const agente = vinculo.data?.operator_id ? nomesDeAgentes.get(String(vinculo.data.operator_id)) || "Agente" : null;
  const ultimaDoAgente = entradas.find((e) => e.author_kind === "operador");

  // O que a fala quer dizer, lido enquanto o dono escreve (pausa de 1,2 s) e mostrado antes de registrar.
  const textoLimpo = texto.trim();
  useEffect(() => {
    if (!aberto || modo || tipoManual || textoLimpo.length < 8 || leitura?.texto === textoLimpo) return;
    const t = setTimeout(async () => {
      try {
        const r = await chamarFuncao<{ leitura: Leitura }>("gestor-aceleriq", {
          acao: "entender_fala", texto: textoLimpo, vinculo_id: linkId,
          contexto: { tarefa: contexto.data?.title || titulo || null, situacao: SITUACAO[vinculo.data?.status || ""]?.rotulo || null, ultima_do_agente: ultimaDoAgente ? leituraSimples(ultimaDoAgente.body).resumo : null },
        });
        setLeitura({ texto: textoLimpo, l: r.leitura });
      } catch { /* sem leitura: registra como comentário, e o dono pode escolher o tipo */ }
    }, 1_200);
    return () => clearTimeout(t);
  }, [aberto, modo, tipoManual, textoLimpo, linkId]);
  const leituraAtual = leitura && leitura.texto === textoLimpo ? leitura.l : null;
  const tipoFinal = tipoManual || (leituraAtual && TIPOS_HUMANOS.some((t) => t.id === leituraAtual.tipo) ? leituraAtual.tipo : "comentario");

  const subirArquivo = async (file: File) => {
    setSubindo(true);
    try {
      if (!linkId || !user) throw new Error("Abra uma tarefa para anexar.");
      const v = await supabase.from("operator_task_links").select("operator_id").eq("id", linkId).single();
      if (v.error) throw v.error;
      const anexo = await anexarNoCaderno(file, linkId, user.id, nomesDeAgentes.get(v.data.operator_id) || "Agente");
      setAnexos(a => [...a, anexo]);
      void queryClient.invalidateQueries({ queryKey: ["workspace-nodes"] });
    } catch (e) {
      toast.error(`Não subiu: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubindo(false);
    }
  };

  /** A fala do dono para o Hermes fica no diário, assinada por ele (o Hermes registra o que for combinado com a assinatura dele). */
  const registrarFalaComHermes = async (fala: string) => {
    if (!linkId || !user) return;
    const { error } = await (supabase as any).from("operator_participations").insert({
      task_link_id: linkId, author_kind: "humano", author_id: user.id, entry_type: "comentario",
      title: "Conversa com o Hermes", body: fala.slice(0, 8000), attachments: [],
    });
    if (error) toast.error(`A conversa seguiu, mas a sua fala não ficou no diário: ${error.message}`);
    else void queryClient.invalidateQueries({ queryKey: ["diario", linkId] });
  };

  const limparCompositor = () => { setTexto(""); setTituloEntrada(""); setAnexos([]); setTipoManual(""); setLeitura(null); setModo(null); };
  const atualizarTelas = () => {
    void queryClient.invalidateQueries({ queryKey: ["diario", linkId] });
    void queryClient.invalidateQueries({ queryKey: ["diario-vinculo", linkId] });
    void queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
    void queryClient.invalidateQueries({ queryKey: ["execucao-pedidos"] });
  };

  const gravarEntrada = async (entryType: string, corpo: string, tituloDaEntrada?: string | null) => {
    const { error } = await (supabase as any).from("operator_participations").insert({
      task_link_id: linkId,
      author_kind: "humano",
      author_id: user!.id,
      entry_type: entryType,
      title: tituloDaEntrada ?? (tituloEntrada.trim() || null),
      body: contextoInicial ? contextoDoPedido(contextoInicial.cliente, corpo) : corpo,
      attachments: anexos,
    });
    if (error) throw new Error(error.message);
  };

  const enviar = useMutation({
    mutationFn: async () => {
      if (!textoLimpo && !anexos.length) throw new Error("Escreva ou anexe um arquivo.");
      await gravarEntrada(tipoFinal, textoLimpo || "Arquivos adicionados à tarefa.");
      return tipoFinal;
    },
    onSuccess: (t) => { limparCompositor(); atualizarTelas(); setEntendi(ENTENDI[t] || "Registrado. O agente lê na próxima rodada."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  /** Aprovar, pedir ajuste, reprovar, destravar ou concluir: muda a situação e deixa o porquê no diário. */
  const decidir = useMutation({
    mutationFn: async (d: { tipo: "aprovar" | "ajuste" | "reprovar" | "destravar" | "concluir"; texto?: string }) => {
      if (!linkId || !user) throw new Error("Abra uma tarefa para decidir.");
      const quem = profile?.full_name || "a equipe";
      const fala = (d.texto || "").trim();
      const plano = {
        aprovar: { status: "done", nota: `Aprovado por ${quem}.`, entrada: "aprovacao", corpo: fala || "Aprovado. Pode concluir." },
        concluir: { status: "done", nota: `Concluída por ${quem}.`, entrada: "decisao", corpo: fala || "Concluída pela equipe." },
        ajuste: { status: "in_progress", nota: `Ajuste pedido por ${quem}: ${fala}`.slice(0, 900), entrada: "pedido_revisao", corpo: fala },
        reprovar: { status: "in_progress", nota: `Reprovado por ${quem}: ${fala}`.slice(0, 900), entrada: "rejeicao", corpo: fala },
        destravar: { status: "in_progress", nota: `Resposta de ${quem}: ${fala}`.slice(0, 900), entrada: "resposta_insumo", corpo: fala },
      }[d.tipo];
      if ((d.tipo === "ajuste" || d.tipo === "reprovar" || d.tipo === "destravar") && !fala && !anexos.length) throw new Error("Escreva o que precisa (ou anexe) antes de enviar.");
      const { data, error } = await (supabase as any).rpc("operator_human_action", {
        _link_id: linkId, _new_status: plano.status, _note: plano.nota, _resolve_approval: d.tipo === "aprovar" || d.tipo === "concluir",
      });
      if (error) throw new Error(error.message);
      await gravarEntrada(plano.entrada, plano.corpo || "Arquivos adicionados à tarefa.");
      return { tipo: d.tipo, status: (Array.isArray(data) ? data[0] : data)?.status as string | undefined };
    },
    onSuccess: (r) => {
      limparCompositor(); atualizarTelas();
      setEntendi(r.tipo === "aprovar" || r.tipo === "concluir"
        ? (r.status === "done" ? "Feito: tarefa concluída e aprovada." : "Aprovado. Como ainda não há comprovação, ela foi para revisão antes de fechar.")
        : r.tipo === "ajuste" ? "Ajuste pedido. A tarefa voltou para o agente com o que você escreveu."
          : r.tipo === "reprovar" ? "Reprovado. A tarefa voltou para o agente refazer."
            : "Respondido. A tarefa foi destravada e o agente continua daqui.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const status = vinculo.data?.status || "";
  const situacao = SITUACAO[status];
  const esperaRevisao = status === "review" || !!vinculo.data?.approval_required;
  const travada = status === "blocked" || status === "awaiting_input";
  const motivo = travada ? leituraSimples(vinculo.data?.block_reason || "").resumo : null;
  const agora = !travada && vinculo.data?.next_step ? leituraSimples(vinculo.data.next_step).resumo : null;
  const ocupado = enviar.isPending || decidir.isPending || subindo;
  const entrarNoModo = (m: Modo) => { setModo(m); setAba("diario"); setTimeout(() => campo.current?.focus(), 50); };
  const enviarAgora = () => {
    if (ocupado) return;
    if (modo === "ajuste") decidir.mutate({ tipo: "ajuste", texto: textoLimpo });
    else if (modo === "reprovar") decidir.mutate({ tipo: "reprovar", texto: textoLimpo });
    else if (modo === "destravar") decidir.mutate({ tipo: "destravar", texto: textoLimpo });
    else if (textoLimpo || anexos.length) enviar.mutate();
  };
  const arquivos = [...new Map(entradas.flatMap(e => prepararEntrada(e.body, e.attachments || []).anexos.map(a => [a.url, { ...a, autor: nomeDoAutor(e), quando: e.created_at }] as const))).values()];
  const MODO_ROTULO: Record<Exclude<Modo, null>, { titulo: string; dica: string; botao: string }> = {
    ajuste: { titulo: "Pedindo ajuste", dica: "Diga o que mudar. A tarefa volta para o agente com isso.", botao: "Enviar ajuste" },
    reprovar: { titulo: "Reprovando a entrega", dica: "Diga por que não serve. A tarefa volta para refazer.", botao: "Reprovar e devolver" },
    destravar: { titulo: "Respondendo para destravar", dica: "Mande o que o agente pediu (texto, link ou arquivo).", botao: "Responder e destravar" },
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[97vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b border-border px-5 pb-2 pt-3 pr-12">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DialogTitle className={juntar(estiloTexto.tituloSecao, "min-w-0 truncate text-left")}>{titulo || "Caderno da execução"}</DialogTitle>
            <DialogDescription className="sr-only">
              {contextoInicial ? `Pedido para ${contextoInicial.cliente.nome} · conversa compartilhada com a coordenação` : 'Conversa, trabalho e comprovantes no mesmo lugar.'}
            </DialogDescription>
            {contextoInicial && <span className="truncate text-[12px] leading-4 text-primary">Para {contextoInicial.cliente.nome}</span>}
            {!contextoInicial && contexto.data && <span className="truncate text-[12px] leading-4 text-primary">{contexto.data.project?.client?.company_name || contexto.data.project?.client?.full_name || 'Cliente não informado'} · {contexto.data.project?.name || contexto.data.title}</span>}
            {!contextoInicial && contexto.isError && <button className="text-[12px] leading-4 text-warning" onClick={() => void contexto.refetch()}>Conferir cliente e projeto</button>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
            {situacao && <span className={juntar(etiqueta, "h-6 px-2", situacao.cor)}>{situacao.rotulo}</span>}
            {agente && <span className="inline-flex items-center gap-1 text-muted-foreground"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{agente}</span>}
            {contexto.data?.id && (
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setTrocarResponsavel(true)} title="Trocar o responsável humano">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />{responsavel.data || "Sem responsável humano"}<span className="text-primary">· trocar</span>
              </button>
            )}
            <nav aria-label="Conteúdo da tarefa" className="ml-auto flex shrink-0 gap-0.5">
              {[["diario", "Diário"], ...(linkId ? [["hermes", "Conversar com o Hermes"]] : []), ["tarefa", "Checklist"], ["arquivos", `Arquivos${arquivos.length ? ` (${arquivos.length})` : ""}`]].map(([id, label]) => <button key={id} type="button" aria-pressed={aba === id} className={juntar("h-7 rounded-md px-2.5 text-[12px] transition-colors", aba === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setAba(id)}>{label}</button>)}
            </nav>
          </div>
        </div>

        {/* Faixa de decisão: o que esta tarefa espera do dono agora, com o botão da ação. */}
        {linkId && vinculo.data && status !== "done" && (esperaRevisao || travada || agora) && (
          <div className={juntar("flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2.5", esperaRevisao ? "bg-warning/5" : travada ? "bg-destructive/5" : "bg-muted/30")} data-faixa-de-decisao="">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
              {esperaRevisao ? <Clock3 className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" /> : travada ? <Lock className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              <span className="min-w-0">
                <span className="font-medium">{esperaRevisao ? "Esta entrega espera a sua decisão." : travada ? "Travada: " : "Agora: "}</span>
                <span className="text-muted-foreground">{esperaRevisao ? " Olhe o diário e as imagens, e decida." : travada ? (motivo || "o agente precisa de algo seu para continuar.") : agora}</span>
              </span>
            </span>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {esperaRevisao && <>
                <button type="button" disabled={ocupado} className={juntar(botao.perigo, "h-8 px-3 text-[13px]")} onClick={() => entrarNoModo("reprovar")}><ThumbsDown className="mr-1.5 h-3.5 w-3.5" />Reprovar</button>
                <button type="button" disabled={ocupado} className={juntar(botao.secundario, "h-8 px-3 text-[13px]")} onClick={() => entrarNoModo("ajuste")}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Pedir ajuste</button>
                <button type="button" disabled={ocupado} className={juntar(botao.primario, "h-8 px-3 text-[13px]")} onClick={() => decidir.mutate({ tipo: "aprovar", texto: textoLimpo })}>{decidir.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />}Aprovar e concluir</button>
              </>}
              {travada && <button type="button" disabled={ocupado} className={juntar(botao.primario, "h-8 px-3 text-[13px]")} onClick={() => entrarNoModo("destravar")}>Responder e destravar</button>}
              {!esperaRevisao && !travada && <button type="button" disabled={ocupado} className={juntar(botao.secundario, "h-8 px-3 text-[13px]")} onClick={() => decidir.mutate({ tipo: "concluir" })}><Check className="mr-1.5 h-3.5 w-3.5" />Concluir</button>}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-5 py-5">
          {aba === "hermes" && linkId ? (
            // 15/10 (dono: "conversar em linguagem natural; pode ser o Hermes aqui"): o Hermes de verdade,
            // numa sessão desta execução, já com cliente, projeto e tarefa; o combinado vai para o diário.
            <div className="-mx-5 -my-5 flex h-[calc(100%+2.5rem)] min-h-0 flex-col">
              <ChatDoHermes
                key={linkId}
                chaveDaSessao={`execucao:diario:hermes:${linkId}`}
                tituloDaSessao={`Diário · ${String(contexto.data?.title || titulo || "execução").slice(0, 80)}`}
                contexto={{
                  cliente: (() => { const c = contexto.data?.project?.client; return c?.id ? { id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") } : null; })(),
                  projeto: (() => { const p = contexto.data?.project; return p?.id ? { id: String(p.id), nome: String(p.name || "Projeto") } : null; })(),
                  tarefa: contexto.data?.id ? { id: String(contexto.data.id), titulo: String(contexto.data.title || "") } : null,
                  vinculo: { id: linkId, titulo: String(contexto.data?.title || titulo || "execução") },
                }}
                aoEnviado={(t) => { void registrarFalaComHermes(t); }}
                className="h-full min-h-0"
              />
            </div>
          ) : aba === "tarefa" && linkId ? <TarefaDoCaderno key={linkId} linkId={linkId} /> : aba === "arquivos" && isLoading ? <Carregando linhas={3} rotulo="Carregando arquivos" /> : aba === "arquivos" && isError ? <div role="alert"><p>Não foi possível ler os arquivos da tarefa.</p><button className={botao.secundario} onClick={() => void refetch()}>Tentar de novo</button></div> : aba === "arquivos" ? (
            <div className="mx-auto max-w-5xl">
              {arquivos.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {arquivos.map(a => (
                    <figure key={a.url} className="min-w-0">
                      <EvidenciaVisual url={a.url!} nome={a.name || "Arquivo da tarefa"} compacto />
                      <figcaption className="mt-1 truncate px-0.5 text-[11px] text-muted-foreground">{a.autor} · {quando(a.quando)}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : <EstadoVazio compacto titulo="Nenhum arquivo ainda." descricao="Os agentes colocam aqui as imagens e comprovações do trabalho. Você também pode anexar pelo diário." />}
              {entradas.length >= limite && <button className={juntar(botao.secundario, "mt-4")} onClick={() => setLimite(n => n + 80)}>Buscar arquivos anteriores</button>}
            </div>
          ) : isLoading ? (
            <Carregando linhas={3} rotulo="Carregando o diário" />
          ) : isError ? (
            // Frente AG3: a leitura que falha não finge "Ainda não há entradas".
            <div className="space-y-2" role="alert">
              <p className="text-[13px] text-destructive">Não consegui ler o diário agora.</p>
              <button type="button" onClick={() => void refetch()} className={botao.secundario}>Tentar de novo</button>
            </div>
          ) : entradas.length === 0 ? (
            <EstadoVazio
              compacto
              titulo="Ainda não há entradas."
              descricao="Escreva abaixo: o agente desta tarefa lê antes de continuar."
            />
          ) : (
            <div className="mx-auto max-w-4xl space-y-3">
              {contextoInicial && <p className="text-[12px] leading-4 text-muted-foreground">Histórico da coordenação · pode incluir outros clientes</p>}
              {/* 16/10 (dono: "já trazer o print, a imagem correta, o PDF, para eu aprovar com contexto"):
                  em revisão, a entrega vem primeiro, grande, com o que é e a prova que abre aqui mesmo. */}
              {linkId && esperaRevisao && (
                <section aria-label="Entrega para aprovar" className={juntar(superficie.painel, "overflow-hidden border-warning/40")}>
                  <p className="border-b border-border px-4 py-2.5 text-[13px] font-medium">{oQueFoiFeito({ status: "review", tipo: tipoDaEntrega(contexto.data?.delivery_type, contexto.data?.title || titulo), temProva: Boolean(vinculo.data?.last_evidence) })}</p>
                  <div className="mx-auto max-w-2xl"><ProvaDaEntrega linkId={linkId} ultimaProva={vinculo.data?.last_evidence} aoConversar={() => setAba("hermes")} /></div>
                </section>
              )}
              {entradas.map((e) => (
                <EntradaDoDiario key={e.id} e={e} autor={nomeDoAutor(e)} doHumano={e.author_kind === "humano"} aoResponder={(x) => {
                  setTituloEntrada(`Sobre: ${tituloDoCaderno(x.title)}`);
                  if (x.entry_type === "pedido_insumo" && travada) entrarNoModo("destravar");
                  else setTimeout(() => campo.current?.focus(), 50);
                }} />
              ))}
              {entradas.length >= limite && <button className={botao.secundario} onClick={() => setLimite(n => n + 40)}>Carregar atualizações anteriores</button>}
            </div>
          )}
        </div>

        {/* O compositor: escreve do jeito do dono; o tipo é entendido e mostrado antes de registrar. */}
        <div className={juntar("shrink-0 space-y-2 border-t border-border px-5 py-3", aba === "hermes" && "hidden")}>
          {entendi && (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{entendi}</span>
              <button type="button" aria-label="Fechar aviso" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => setEntendi(null)}><X className="h-3.5 w-3.5" /></button>
            </p>
          )}
          {modo && (
            <p className={juntar("flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]", modo === "reprovar" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
              <span className="font-medium">{MODO_ROTULO[modo].titulo}.</span><span className="min-w-0 flex-1 text-foreground/80">{MODO_ROTULO[modo].dica}</span>
              <button type="button" className="shrink-0 text-[12px] underline-offset-2 hover:underline" onClick={() => setModo(null)}>Cancelar</button>
            </p>
          )}
          {tituloEntrada && (
            <p className="flex min-w-0 items-center text-[12px] text-muted-foreground">
              <span className="min-w-0 truncate">{tituloEntrada}</span>
              <button type="button" className="ml-2 shrink-0 hover:text-foreground" onClick={() => setTituloEntrada("")} aria-label="Tirar o título">×</button>
            </p>
          )}
          <label className="block">
            <span className="sr-only">Mensagem para o agente desta tarefa</span>
            <textarea
              ref={campo}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviarAgora(); } }}
              placeholder={modo ? MODO_ROTULO[modo].dica : `Fale com ${contextoInicial ? "a coordenação" : agente || "o agente"} do seu jeito: peça, corrija, decida ou responda. Eu entendo o tipo e mostro antes de registrar.`}
              rows={Math.min(8, Math.max(2, texto.split("\n").length))}
              className={juntar(campoTexto, "min-h-[56px] resize-none")}
            />
          </label>
          {anexos.length > 0 && (
            <div className="-m-0.5 flex flex-wrap [&>*]:m-0.5">
              {anexos.map((a, i) => (
                <span key={i} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[12px] text-foreground">
                  <Paperclip className="mr-1 h-3 w-3" aria-hidden="true" /> {a.name}
                  <button type="button" aria-label={`Tirar ${a.name}`} className="ml-1 text-muted-foreground hover:text-destructive" onClick={() => setAnexos((x) => x.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {!modo && (textoLimpo.length >= 8 || tipoManual) && (
              <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground" data-tipo-entendido={tipoFinal}>
                {tipoManual ? "Vai como" : leituraAtual ? (leituraAtual.fonte === "jev" ? "Entendi como" : "Parece") : "Lendo…"}
                <SeletorCompacto rotulo="Tipo da mensagem" valor={tipoFinal} onEscolher={setTipoManual} modo="lista" opcoes={TIPOS_HUMANOS.map((t) => ({ valor: t.id, rotulo: t.rotulo }))} />
              </span>
            )}
            <label className={juntar(botao.discreto, "cursor-pointer", subindo && "pointer-events-none opacity-60")}>
              {subindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Anexar imagem ou arquivo
              <input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArquivo(f); e.target.value = ""; }} />
            </label>
            <div className="ml-auto flex gap-1.5">
              {!modo && leituraAtual?.acao === "aprovar" && esperaRevisao && (
                <button type="button" disabled={ocupado} onClick={() => decidir.mutate({ tipo: "aprovar", texto: textoLimpo })} className={juntar(botao.primario, "bg-success hover:bg-success/90")}><ThumbsUp className="mr-1.5 h-3.5 w-3.5" />Aprovar e concluir</button>
              )}
              {!modo && leituraAtual?.acao === "reprovar" && esperaRevisao && (
                <button type="button" disabled={ocupado} onClick={() => decidir.mutate({ tipo: "reprovar", texto: textoLimpo })} className={botao.perigo}><ThumbsDown className="mr-1.5 h-3.5 w-3.5" />Reprovar e devolver</button>
              )}
              <button
                type="button"
                disabled={ocupado || (!textoLimpo && !anexos.length)}
                onClick={enviarAgora}
                className={juntar(modo || !(leituraAtual?.acao && esperaRevisao) ? botao.primario : botao.secundario)}
              >
                {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {modo ? MODO_ROTULO[modo].botao : leituraAtual?.acao && esperaRevisao ? "Só registrar" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
      <DefinirResponsavel
        taskId={trocarResponsavel ? (contexto.data?.id ?? null) : null}
        tituloDaTarefa={contexto.data?.title}
        responsavelAtual={contexto.data?.assigned_to ?? null}
        aberto={trocarResponsavel}
        aoFechar={() => { setTrocarResponsavel(false); void contexto.refetch(); }}
      />
    </Dialog>
  );
}

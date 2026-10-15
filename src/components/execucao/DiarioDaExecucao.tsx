import EvidenciaVisual from "./EvidenciaVisual";
import { contextoDoPedido } from '@/lib/carteiraOperacao';
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepararEntrada, tituloDoCaderno } from "@/lib/cadernoExecucao";
import { anexarNoCaderno } from "@/lib/arquivosDoCaderno";
import TarefaDoCaderno from "./TarefaDoCaderno";
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
import { Bot, Loader2, Paperclip, Send, User } from "lucide-react";
import { Carregando, EstadoVazio, SeletorCompacto, botao, campoTexto, etiqueta, juntar, texto as estiloTexto, useEstadoDaTela } from "@/components/sistema";

/**
 * O diário da execução: onde o dono participa de verdade.
 *
 * Até aqui a tela era vitrine — o agente trabalhava e o Almir olhava.
 * Instrução ia por fora (grupo, chat) e se perdia da trilha; depois
 * ninguém sabia POR QUE o agente mudou de rumo. O diário coloca a
 * conversa no mesmo registro da execução: cada entrada tem autor, tipo e
 * hora, e o agente lê pelo MCP antes de continuar.
 *
 * Nada daqui vai para cliente ou canal externo. É caderno interno, e a
 * separação é estrutural: a tabela não alimenta nenhum envio.
 */

/* Os tipos que um humano escreve. Aprovação e rejeição formais ficam no
   painel de aprovações — aqui seria fácil confundir um "aprovo" de
   conversa com uma aprovação de payload, e essa confusão custa caro. */
const TIPOS_HUMANOS = [
  { id: "comentario", rotulo: "Comentário" },
  { id: "instrucao", rotulo: "Instrução" },
  { id: "decisao", rotulo: "Decisão" },
  { id: "contexto", rotulo: "Contexto" },
  { id: "correcao", rotulo: "Correção" },
  { id: "resposta_insumo", rotulo: "Resposta a insumo" },
  { id: "pedido_revisao", rotulo: "Pedir revisão" },
] as const;

const TOM_DO_TIPO: Record<string, string> = {
  instrucao: "bg-primary/15 text-primary",
  decisao: "bg-success/15 text-success",
  correcao: "bg-warning/15 text-warning",
  pedido_insumo: "bg-warning/15 text-warning",
  pedido_revisao: "bg-warning/15 text-warning",
  rejeicao: "bg-destructive/15 text-destructive",
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

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function DiarioDaExecucao({
  linkId,
  titulo,
  nomesDeAgentes,
  aberto,
  aoFechar,
  contextoInicial,
  textoInicial,
  substituirRascunho = false,
}: {
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
  const [tipo, setTipo] = useEstadoDaTela<string>(`execucao:diario:tipo:${linkId || ""}`, "comentario", {
    validar: (v) => typeof v === "string" && TIPOS_HUMANOS.some((t) => t.id === v),
  });
  const [tituloEntrada, setTituloEntrada] = useEstadoDaTela<string>(`execucao:diario:titulo:${linkId || ""}${contextoInicial ? `:${contextoInicial.cliente.id}` : ''}`, "");
  const [texto, setTexto] = useEstadoDaTela<string>(`execucao:diario:texto:${linkId || ""}${contextoInicial ? `:${contextoInicial.cliente.id}` : ''}`, contextoInicial?.pedido || textoInicial || "");
  const [anexos, setAnexos] = useState<Array<{ name: string; url: string }>>([]);
  const [subindo, setSubindo] = useState(false);
  const [aba, setAba] = useState("diario");
  const [limite, setLimite] = useState(40);
  useEffect(() => { setAnexos([]); setAba("diario"); setLimite(40); }, [linkId, contextoInicial?.cliente.id]);
  useEffect(() => {
    if (!aberto || !substituirRascunho) return;
    const pronto = contextoInicial?.pedido || textoInicial || "";
    if (pronto) { setTexto(pronto); setTipo("instrucao"); }
  }, [aberto, substituirRascunho, linkId, contextoInicial?.pedido, textoInicial]);
  const contexto = useQuery({
    queryKey: ['diario-contexto', linkId], enabled: aberto && !!linkId, staleTime: 60_000,
    queryFn: async () => {
      const l = await supabase.from('operator_task_links').select('kanban_task_id,painel_task_id').eq('id', linkId!).single();
      if (l.error) throw l.error;
      const id = l.data.kanban_task_id || l.data.painel_task_id;
      if (!id) return null;
      const t = await supabase.from('tasks').select('id,title,project:projects!tasks_project_id_fkey(id,name,client:profiles!projects_client_id_fkey(id,company_name,full_name))').eq('id', id).single();
      if (t.error) throw t.error;
      return t.data;
    },
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

  const subirArquivo = async (file: File) => {
    setSubindo(true);
    try {
      if (!linkId || !user) throw new Error("Abra uma tarefa para anexar.");
      const vinculo = await supabase.from("operator_task_links").select("operator_id").eq("id", linkId).single();
      if (vinculo.error) throw vinculo.error;
      const anexo = await anexarNoCaderno(file, linkId, user.id, nomesDeAgentes.get(vinculo.data.operator_id) || "Agente");
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

  const enviar = useMutation({
    mutationFn: async () => {
      if (!texto.trim() && !anexos.length) throw new Error("Escreva ou anexe um arquivo.");
      const { error } = await (supabase as any).from("operator_participations").insert({
        task_link_id: linkId,
        author_kind: "humano",
        author_id: user!.id,
        entry_type: tipo,
        title: tituloEntrada.trim() || null,
        body: contextoInicial ? contextoDoPedido(contextoInicial.cliente, texto.trim() || "Arquivos adicionados à tarefa.") : texto.trim() || "Arquivos adicionados à tarefa.",
        attachments: anexos,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setTexto(""); setTituloEntrada(""); setAnexos([]);
      queryClient.invalidateQueries({ queryKey: ["diario", linkId] });
      toast.success("Registrado. O Hermes acompanha as novas mensagens desta tarefa.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      {/* 15/10 (dono: "está muito pequena essa parte de leitura"): janela mais larga, cabeçalho e abas numa linha, compositor de chat. */}
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[97vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3 pr-12">
          <DialogTitle className={juntar(estiloTexto.tituloSecao, "min-w-0 truncate text-left")}>{titulo || "Caderno da execução"}</DialogTitle>
          <DialogDescription className="sr-only">
            {contextoInicial ? `Pedido para ${contextoInicial.cliente.nome} · conversa compartilhada com a coordenação` : 'Conversa, trabalho e comprovantes no mesmo lugar.'}
          </DialogDescription>
          {contextoInicial && <span className="truncate text-xs text-primary">Para {contextoInicial.cliente.nome}</span>}
          {!contextoInicial && contexto.data && <span className="truncate text-xs text-primary">{contexto.data.project?.client?.company_name || contexto.data.project?.client?.full_name || 'Cliente não informado'} · {contexto.data.project?.name || contexto.data.title}</span>}
          {!contextoInicial && contexto.isError && <button className="text-xs text-warning" onClick={() => void contexto.refetch()}>Conferir cliente e projeto</button>}
          <nav aria-label="Conteúdo da tarefa" className="ml-auto flex shrink-0 gap-0.5">
            {[["diario", "Diário"], ...(linkId ? [["hermes", "Conversar com o Hermes"]] : []), ["tarefa", "Tarefa e checklist"], ["arquivos", "Arquivos"]].map(([id, label]) => <button key={id} type="button" aria-pressed={aba === id} className={juntar("h-7 rounded-md px-2.5 text-[12px] transition-colors", aba === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setAba(id)}>{label}</button>)}
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-5 py-5">
          {aba === "hermes" && linkId ? (
            // 15/10 (dono: "conversar em linguagem natural; pode ser o Hermes aqui; já registra tudo automaticamente"):
            // o Hermes de verdade, numa sessão desta execução; o que for combinado ele registra no diário, assinado por ele.
            <div className="-mx-5 -my-5 flex h-[calc(100%+2.5rem)] min-h-0 flex-col">
              <ChatDoHermes
                key={linkId}
                chaveDaSessao={`execucao:diario:hermes:${linkId}`}
                tituloDaSessao={`Diário · ${String((contexto.data as { title?: string } | null)?.title || titulo || "execução").slice(0, 80)}`}
                contexto={{
                  cliente: (() => { const c = (contexto.data as any)?.project?.client; return c?.id ? { id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") } : null; })(),
                  projeto: (() => { const p = (contexto.data as any)?.project; return p?.id ? { id: String(p.id), nome: String(p.name || "Projeto") } : null; })(),
                  tarefa: (contexto.data as any)?.id ? { id: String((contexto.data as any).id), titulo: String((contexto.data as any).title || "") } : null,
                  vinculo: { id: linkId, titulo: String((contexto.data as { title?: string } | null)?.title || titulo || "execução") },
                }}
                aoEnviado={(t) => { void registrarFalaComHermes(t); }}
                className="h-full min-h-0"
              />
            </div>
          ) : aba === "tarefa" && linkId ? <TarefaDoCaderno key={linkId} linkId={linkId} /> : aba === "arquivos" && isLoading ? <Carregando linhas={3} rotulo="Carregando arquivos" /> : aba === "arquivos" && isError ? <div role="alert"><p>Não foi possível ler os arquivos da tarefa.</p><button className={botao.secundario} onClick={() => void refetch()}>Tentar de novo</button></div> : aba === "arquivos" ? <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
            {[...new Map(entradas.flatMap(e => prepararEntrada(e.body, e.attachments || []).anexos).map(a => [a.url, a])).values()].map(a => <EvidenciaVisual key={a.url} url={a.url!} nome={a.name || "Arquivo da tarefa"} />)}
            {!entradas.some(e => prepararEntrada(e.body, e.attachments || []).anexos.length) && <p className="text-sm text-muted-foreground">Anexe os materiais na conversa abaixo. Eles ficam no Workspace, organizados por agente e tarefa.</p>}
            {entradas.length >= limite && <button className={botao.secundario} onClick={() => setLimite(n => n + 80)}>Buscar arquivos anteriores</button>}
          </div> : isLoading ? (
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
              descricao="Uma instrução sua aqui chega ao agente pelo MCP, sem depender de ninguém colar contexto no grupo."
            />
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
            <p className="text-xs text-muted-foreground">{contextoInicial ? 'Histórico da coordenação · pode incluir outros clientes' : 'Atualizações mais recentes primeiro'}</p>
            {entradas.map((e) => {
              const documento = prepararEntrada(e.body, e.attachments || []);
              const doHumano = e.author_kind === "humano";
              const autor = doHumano
                ? (e.author_id === user?.id ? (profile?.full_name || "Você") : nomesHumanos.get(String(e.author_id)) || "pessoa")
                : nomesDeAgentes.get(String(e.operator_id)) || "operador";
              return (
                <div
                  key={e.id}
                  className={juntar(
                    "rounded-xl p-4",
                    doHumano ? "ml-auto max-w-[85%] bg-primary/10" : "bg-card",
                  )}
                >
                  <div className="flex min-w-0 items-center text-[11.5px]">
                    {doHumano
                      ? <User className="mr-1.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                      : <Bot className="mr-1.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="mr-1.5 min-w-0 truncate font-semibold text-foreground">{autor}</span>
                    <span className={juntar(
                      etiqueta,
                      TOM_DO_TIPO[e.entry_type] || "bg-muted text-muted-foreground",
                    )}>
                      {e.entry_type.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground">{quando(e.created_at)}</span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-foreground">{tituloDoCaderno(e.title)}</h3>
                  <div className="prose prose-sm dark:prose-invert mt-3 max-w-none break-words leading-7 prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                      p: ({ children }) => <div className="my-2">{children}</div>,
                      a: ({ href, children }) => href ? <EvidenciaVisual url={href} nome={String(children)} /> : <span>{children}</span>,
                      img: ({ src, alt }) => src ? <EvidenciaVisual url={src} nome={alt || "Imagem do trabalho"} /> : null,
                    }}>{documento.texto}</ReactMarkdown>
                  </div>
                  {documento.anexos.length > 0 && <div className="mt-4 space-y-4">{documento.anexos.map((a, i) => <EvidenciaVisual key={i} url={a.url!} nome={a.name || "Comprovação"} />)}</div>}
                  {documento.temDetalhes && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Registro original</summary><pre className="mt-2 whitespace-pre-wrap break-words">{e.body}</pre></details>}
                  <button className={juntar(botao.discreto, "mt-3")} onClick={() => { setTipo("comentario"); setTituloEntrada(`Sobre: ${tituloDoCaderno(e.title)}`); }}>Comentar esta atualização</button>
                </div>
              );
            })}
            {entradas.length >= limite && <button className={botao.secundario} onClick={() => setLimite(n => n + 40)}>Carregar atualizações anteriores</button>}
            </div>
          )}
        </div>

        {/* O compositor. Tipo primeiro: uma INSTRUÇÃO manda, um COMENTÁRIO
            conversa, e o agente trata diferente, então a escolha não pode
            ser um detalhe escondido. O rascunho fica guardado por vínculo. */}
        <div className={juntar("shrink-0 space-y-2 border-t border-border px-5 py-3", aba === "hermes" && "hidden")}>
          {tituloEntrada && (
            <p className="flex min-w-0 items-center text-[12px] text-muted-foreground">
              <span className="min-w-0 truncate">{tituloEntrada}</span>
              <button type="button" className="ml-2 shrink-0 hover:text-foreground" onClick={() => setTituloEntrada("")} aria-label="Tirar o título">×</button>
            </p>
          )}
          <label className="block">
            <span className="sr-only">Texto da entrada</span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && (texto.trim() || anexos.length) && !enviar.isPending && !subindo) { e.preventDefault(); enviar.mutate(); } }}
              placeholder={tipo === "instrucao"
                ? `Fale com ${contextoInicial ? "a coordenação" : "o agente"} do seu jeito: o que fazer, ajustar ou parar… (Ctrl+Enter envia)`
                : "Escreva aqui… (Ctrl+Enter envia)"}
              rows={Math.min(8, Math.max(2, texto.split("\n").length))}
              className={juntar(campoTexto, "min-h-[56px] resize-none")}
            />
          </label>
          {anexos.length > 0 && (
            <div className="-m-0.5 flex flex-wrap [&>*]:m-0.5">
              {anexos.map((a, i) => (
                <span key={i} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11.5px] text-foreground">
                  <Paperclip className="mr-1 h-3 w-3" aria-hidden="true" /> {a.name}
                  <button
                    type="button"
                    aria-label={`Tirar ${a.name}`}
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    onClick={() => setAnexos((x) => x.filter((_, j) => j !== i))}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <SeletorCompacto
              rotulo="Tipo da entrada"
              valor={tipo}
              onEscolher={setTipo}
              modo="lista"
              opcoes={TIPOS_HUMANOS.map((t) => ({ valor: t.id, rotulo: t.rotulo }))}
            />
            <label className={juntar(
              botao.discreto,
              "cursor-pointer",
              subindo && "pointer-events-none opacity-60",
            )}>
              {subindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              anexar
              <input
                type="file"
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArquivo(f); e.target.value = ""; }}
              />
            </label>
            <button
              type="button"
              disabled={enviar.isPending || subindo || (!texto.trim() && !anexos.length)}
              onClick={() => enviar.mutate()}
              className={juntar(botao.primario, "ml-auto")}
            >
              {enviar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Registrar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
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
import { Carregando, EstadoVazio, SeletorCompacto, botao, campo, campoTexto, etiqueta, juntar, texto as estiloTexto, useEstadoDaTela } from "@/components/sistema";

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
}: {
  linkId: string | null;
  titulo?: string;
  /** operator_id -> display_name, resolvido pela página que já tem os operadores. */
  nomesDeAgentes: Map<string, string>;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  // Rascunho guardado por vínculo: fechar o diário ou sair da tela não apaga.
  const [tipo, setTipo] = useEstadoDaTela<string>(`execucao:diario:tipo:${linkId || ""}`, "comentario", {
    validar: (v) => typeof v === "string" && TIPOS_HUMANOS.some((t) => t.id === v),
  });
  const [tituloEntrada, setTituloEntrada] = useEstadoDaTela<string>(`execucao:diario:titulo:${linkId || ""}`, "");
  const [texto, setTexto] = useEstadoDaTela<string>(`execucao:diario:texto:${linkId || ""}`, "");
  const [anexos, setAnexos] = useState<Array<{ name: string; url: string }>>([]);
  const [subindo, setSubindo] = useState(false);

  const { data: entradas = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["diario", linkId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_participations")
        .select("id, entry_type, title, body, attachments, author_kind, author_id, operator_id, created_at")
        .eq("task_link_id", linkId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data || []) as Entrada[];
    },
    enabled: aberto && Boolean(linkId),
    refetchInterval: 20_000,
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
      // Frente AG3 (29/09): o balde "files" é privado e só aceita caminho com dono (cliente ou tarefa).
      // Antes ia para execucao/<vínculo>/, a regra do Storage recusava e o link público nunca abria.
      // Agora vai para task-attachments/<tarefa>/execucao/ e o anexo guarda files://caminho (o link
      // assinado é pedido na hora de abrir; o agente lê o mesmo caminho pelo MCP).
      const { data: vinculo, error: erroVinculo } = await (supabase as any)
        .from("operator_task_links").select("kanban_task_id, painel_task_id").eq("id", linkId).maybeSingle();
      if (erroVinculo) throw new Error(erroVinculo.message);
      const tarefa = vinculo ? (vinculo.kanban_task_id || vinculo.painel_task_id) : null;
      if (!tarefa) throw new Error("Este vínculo não tem tarefa: anexo precisa de uma tarefa para ficar guardado.");
      const ext = file.name.split(".").pop() || "bin";
      const path = `task-attachments/${tarefa}/execucao/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) throw new Error(error.message);
      setAnexos((a) => [...a, { name: file.name, url: `files://${path}` }]);
    } catch (e) {
      toast.error(`Não subiu: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubindo(false);
    }
  };

  /** Abre o anexo: caminho privado (files://) pede um link assinado curto; link antigo abre como estava. */
  const abrirAnexo = async (url: string) => {
    if (!url.startsWith("files://")) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const { data, error } = await supabase.storage.from("files").createSignedUrl(url.slice("files://".length), 600);
    if (error || !data?.signedUrl) {
      toast.error(`Não abriu o anexo: ${error?.message || "tente de novo"}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const enviar = useMutation({
    mutationFn: async () => {
      if (!texto.trim()) throw new Error("Escreva o texto da entrada.");
      const { error } = await (supabase as any).from("operator_participations").insert({
        task_link_id: linkId,
        author_kind: "humano",
        author_id: user!.id,
        entry_type: tipo,
        title: tituloEntrada.trim() || null,
        body: texto.trim(),
        attachments: anexos,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setTexto(""); setTituloEntrada(""); setAnexos([]);
      queryClient.invalidateQueries({ queryKey: ["diario", linkId] });
      toast.success("Registrado no diário. O agente lê pelo MCP na próxima leitura.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b border-border px-5 pb-3 pt-5 pr-12">
          <DialogTitle className={juntar(estiloTexto.tituloSecao, "text-left")}>Diário da execução</DialogTitle>
          <DialogDescription className={juntar(estiloTexto.auxiliar, "mt-1 truncate text-left")}>
            {titulo || "Conversa interna entre você e o agente, na trilha da tarefa."}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-5 py-4">
          {isLoading ? (
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
            entradas.map((e) => {
              const doHumano = e.author_kind === "humano";
              const autor = doHumano
                ? (e.author_id === user?.id ? (profile?.full_name || "Você") : nomesHumanos.get(String(e.author_id)) || "pessoa")
                : nomesDeAgentes.get(String(e.operator_id)) || "operador";
              return (
                <div
                  key={e.id}
                  className={juntar(
                    "rounded-md px-3 py-2.5",
                    doHumano ? "bg-primary/10" : "bg-muted/50",
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
                  {e.title && <p className="mt-1 text-[13px] font-semibold text-foreground">{e.title}</p>}
                  {/* Texto INTEIRO, sem truncar: instrução cortada vira instrução errada. */}
                  <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground/90">
                    {e.body}
                  </p>
                  {Array.isArray(e.attachments) && e.attachments.length > 0 && (
                    <div className="-m-0.5 mt-1 flex flex-wrap [&>*]:m-0.5">
                      {e.attachments.map((a, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => void abrirAnexo(String(a.url || ""))}
                          className="inline-flex items-center rounded-md border border-border bg-transparent px-2 py-0.5 text-[11.5px] text-primary hover:underline"
                        >
                          <Paperclip className="mr-1 h-3 w-3" aria-hidden="true" /> {a.name || "anexo"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* O compositor. Tipo primeiro: uma INSTRUÇÃO manda, um COMENTÁRIO
            conversa, e o agente trata diferente, então a escolha não pode
            ser um detalhe escondido. O rascunho fica guardado por vínculo. */}
        <div className="shrink-0 space-y-2 border-t border-border px-5 py-3">
          <div className="flex min-w-0 items-center">
            <SeletorCompacto
              rotulo="Tipo da entrada"
              valor={tipo}
              onEscolher={setTipo}
              modo="lista"
              opcoes={TIPOS_HUMANOS.map((t) => ({ valor: t.id, rotulo: t.rotulo }))}
            />
            <label className="ml-2 min-w-0 flex-1">
              <span className="sr-only">Título (opcional)</span>
              <input
                value={tituloEntrada}
                onChange={(e) => setTituloEntrada(e.target.value)}
                placeholder="Título (opcional)"
                className={campo}
              />
            </label>
          </div>
          <label className="block">
            <span className="sr-only">Texto da entrada</span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={tipo === "instrucao"
                ? "O que o agente deve fazer (ou parar de fazer)…"
                : "Escreva aqui…"}
              rows={3}
              className={juntar(campoTexto, "min-h-[72px] resize-y")}
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
          <div className="flex items-center">
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
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArquivo(f); e.target.value = ""; }}
              />
            </label>
            <button
              type="button"
              disabled={enviar.isPending || !texto.trim()}
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

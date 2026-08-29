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
import { cn } from "@/lib/utils";

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
  const [tipo, setTipo] = useState<string>("comentario");
  const [tituloEntrada, setTituloEntrada] = useState("");
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<Array<{ name: string; url: string }>>([]);
  const [subindo, setSubindo] = useState(false);

  const { data: entradas = [], isLoading } = useQuery({
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
      // O mesmo balde que o resto do painel usa; caminho carimbado com o
      // vínculo para o anexo nunca ficar órfão de contexto.
      const ext = file.name.split(".").pop() || "bin";
      const path = `execucao/${linkId}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("files").getPublicUrl(path);
      setAnexos((a) => [...a, { name: file.name, url: data.publicUrl }]);
    } catch (e) {
      toast.error(`Não subiu: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubindo(false);
    }
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
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogTitle className="text-[15px]">Diário da execução</DialogTitle>
        <DialogDescription className="text-[11.5px]">
          {titulo || "Conversa interna entre você e o agente, na trilha da tarefa."}
        </DialogDescription>

        <div className="space-y-2">
          {isLoading ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">carregando…</p>
          ) : entradas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
              Ainda não há entradas. Uma <strong>instrução</strong> sua aqui chega ao agente
              pelo MCP — sem depender de ninguém colar contexto no grupo.
            </p>
          ) : (
            entradas.map((e) => {
              const doHumano = e.author_kind === "humano";
              const autor = doHumano
                ? (e.author_id === user?.id ? (profile?.full_name || "Você") : nomesHumanos.get(String(e.author_id)) || "pessoa")
                : nomesDeAgentes.get(String(e.operator_id)) || "operador";
              return (
                <div
                  key={e.id}
                  className={cn(
                    "rounded-xl border p-2.5",
                    doHumano ? "border-primary/30 bg-primary/[0.07]" : "border-border bg-card",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                    {doHumano
                      ? <User className="h-3 w-3 text-primary" />
                      : <Bot className="h-3 w-3 text-muted-foreground" />}
                    <span className="font-semibold text-foreground">{autor}</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold",
                      TOM_DO_TIPO[e.entry_type] || "bg-secondary text-muted-foreground",
                    )}>
                      {e.entry_type.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto text-muted-foreground">{quando(e.created_at)}</span>
                  </div>
                  {e.title && <p className="mt-1 text-[12px] font-semibold text-foreground">{e.title}</p>}
                  {/* Texto INTEIRO, sem truncar: instrução cortada vira instrução errada. */}
                  <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-foreground/90">
                    {e.body}
                  </p>
                  {Array.isArray(e.attachments) && e.attachments.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.attachments.map((a, i) => (
                        <a
                          key={i}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-0.5 text-[10px] text-primary hover:underline"
                        >
                          <Paperclip className="h-3 w-3" /> {a.name || "anexo"}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* O compositor. Tipo primeiro: uma INSTRUÇÃO manda, um COMENTÁRIO
            conversa, e o agente trata diferente — então a escolha não pode
            ser um detalhe escondido. */}
        <div className="rounded-xl border border-border bg-card p-2.5">
          <div className="flex flex-wrap gap-1">
            {TIPOS_HUMANOS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTipo(t.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  tipo === t.id
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
          <input
            value={tituloEntrada}
            onChange={(e) => setTituloEntrada(e.target.value)}
            placeholder="Título (opcional)"
            className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60"
          />
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={tipo === "instrucao"
              ? "O que o agente deve fazer (ou parar de fazer)…"
              : "Escreva aqui…"}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground/60"
          />
          {anexos.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {anexos.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-0.5 text-[10px] text-foreground">
                  <Paperclip className="h-3 w-3" /> {a.name}
                  <button type="button" className="text-muted-foreground hover:text-destructive"
                    onClick={() => setAnexos((x) => x.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <label className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground",
              subindo && "pointer-events-none opacity-60",
            )}>
              {subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
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
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {enviar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Registrar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

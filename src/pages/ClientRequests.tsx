import { useEffect, useState } from "react";
import JanelaDoCelular from "@/components/sistema/JanelaDoCelular";
import { useAuth } from "@/contexts/AuthContext";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { notifyAdmin } from "@/lib/notifyHelpers";
import {
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

const statusBadge: Record<string, { cls: string; label: string }> = {
  new: { cls: "bg-info/10 text-info", label: "Aberto" },
  open: { cls: "bg-info/10 text-info", label: "Aberto" },
  in_progress: { cls: "bg-warning/10 text-warning", label: "Em Andamento" },
  done: { cls: "bg-success/10 text-success", label: "Concluído" },
  completed: { cls: "bg-success/10 text-success", label: "Concluído" },
};

const priorityBadge: Record<string, { cls: string; label: string }> = {
  low: { cls: "bg-muted text-muted-foreground", label: "Baixa" },
  normal: { cls: "bg-secondary text-foreground", label: "Normal" },
  medium: { cls: "bg-secondary text-foreground", label: "Média" },
  high: { cls: "bg-warning/10 text-warning", label: "Alta" },
  urgent: { cls: "bg-destructive/10 text-destructive", label: "Urgente" },
};

/** Grupo do filtro: aberto, em andamento ou concluído. */
const grupoDoStatus = (s: string) => (s === "in_progress" ? "andamento" : s === "done" || s === "completed" ? "concluidos" : "abertos");
const FILTROS = ["todos", "abertos", "andamento", "concluidos"];

export default function ClientRequests() {
  const { user, profile } = useAuth();
  const { clientId, isImpersonating } = useClientIdentity();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Rascunho do pedido: fechar a janela ou sair da tela não apaga o que já foi escrito.
  const [title, setTitle] = useEstadoDaTela<string>(`pedido:rascunho:titulo:${clientId || ""}`, "");
  const [description, setDescription] = useEstadoDaTela<string>(`pedido:rascunho:descricao:${clientId || ""}`, "");
  const [priority, setPriority] = useState("normal");
  const [filtro, setFiltro] = useEstadoDaTela<string>("pedidos:filtro", "todos", { validar: (v) => typeof v === "string" && FILTROS.indexOf(v) >= 0 });

  const { data: requests, isLoading, isError, refetch } = useQuery({
    queryKey: ["client-requests", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_requests")
        .select("id, client_id, project_id, title, description, priority, status, created_at, updated_at")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!clientId,
    refetchInterval: 15_000,
  });

  const handleCreate = async () => {
    if (isImpersonating) {
      toast.error("O modo de visualização do cliente é somente leitura");
      return;
    }
    if (!title.trim() || !description.trim()) {
      toast.error("Preencha título e descrição");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("client_requests").insert({
        client_id: clientId!,
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      if (error) throw error;

      // Aviso para a equipe pela função de servidor (chave de serviço): o
      // cliente não tem permissão de RLS para inserir em notifications, e o
      // insert direto falhava em silêncio. Mesmo caminho do RequestButton.
      await notifyAdmin(
        `Novo pedido de ${profile?.company_name || profile?.full_name}: ${title.trim()}`,
        "request",
        "/pedidos",
      );

      toast.success("Pedido enviado");
      queryClient.invalidateQueries({ queryKey: ["client-requests"] });

      // Fire webhook
      fireWebhook(webhooks.clientRequest, {
        request_id: crypto.randomUUID(),
        client_id: clientId!,
        client_name: profile?.full_name || '',
        company: profile?.company_name || '',
        title: title.trim(),
        description: description.trim(),
        priority,
      });

      setCreateOpen(false);
      setTitle("");
      setDescription("");
      setPriority("normal");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar pedido");
    }
    setSaving(false);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  const todos = requests || [];
  const contagem = { todos: todos.length, abertos: 0, andamento: 0, concluidos: 0 } as Record<string, number>;
  todos.forEach((r: any) => {
    contagem[grupoDoStatus(r.status)] += 1;
  });
  const visiveis = filtro === "todos" ? todos : todos.filter((r: any) => grupoDoStatus(r.status) === filtro);
  const emAberto = contagem.abertos + contagem.andamento;
  // No celular as 4 opções não cabem lado a lado sem cortar: vira lista.

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina
        titulo="Pedidos"
        descricao={todos.length ? `${emAberto} em aberto de ${todos.length}` : undefined}
        ajuda="Peça um ajuste ou algo novo para a equipe. Cada pedido mostra em que pé está: aberto, em andamento ou concluído."
        acoes={
          !isImpersonating && (
            <button type="button" onClick={() => setCreateOpen(true)} className={botao.primario} aria-label="Novo pedido">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Novo pedido</span>
            </button>
          )
        }
      />

      {todos.length > 0 && (
        <SeletorCompacto
          rotulo="Filtrar pedidos"
          valor={filtro}
          onEscolher={setFiltro}
          modo="segmentado"
          listaQuandoNaoCabe
          opcoes={[
            { valor: "todos", rotulo: "Todos", contador: contagem.todos },
            { valor: "abertos", rotulo: "Abertos", contador: contagem.abertos },
            { valor: "andamento", rotulo: "Andamento", contador: contagem.andamento },
            { valor: "concluidos", rotulo: "Concluídos", contador: contagem.concluidos },
          ]}
        />
      )}

      {isLoading ? (
        <Carregando linhas={3} rotulo="Carregando pedidos" />
      ) : isError && todos.length === 0 ? (
        <EstadoDeErro
          titulo="Não foi possível carregar os pedidos."
          acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
        />
      ) : todos.length === 0 ? (
        <EstadoVazio
          icone={<MessageSquarePlus className="h-5 w-5" />}
          titulo={isImpersonating ? "Este cliente ainda não possui pedidos." : "Nenhum pedido ainda"}
          descricao={isImpersonating ? undefined : "Precisa de um ajuste ou de algo novo? Faça seu primeiro pedido."}
          acao={!isImpersonating && (
            <button type="button" onClick={() => setCreateOpen(true)} className={botao.primario}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Novo pedido
            </button>
          )}
        />
      ) : visiveis.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhum pedido neste filtro." />
      ) : (
        <ul className={juntar(superficie.painel, "divide-y divide-border")} aria-label="Seus pedidos">
          {visiveis.map((r: any) => {
            const status = statusBadge[r.status] || statusBadge.new;
            const prio = priorityBadge[r.priority] || priorityBadge.normal;
            return (
              <li key={r.id} className="min-w-0 px-4 py-3.5 sm:px-5">
                <div className="flex min-w-0 items-start justify-between">
                  <p className="mr-3 min-w-0 flex-1 text-[14px] font-medium leading-5 text-foreground [overflow-wrap:anywhere]">{r.title}</p>
                  <span className={juntar(etiqueta, "mt-0.5", status.cls)}>{status.label}</span>
                </div>
                {r.description && <p className={juntar(texto.corpo, "mt-1 text-muted-foreground [overflow-wrap:anywhere]")}>{r.description}</p>}
                <p className={juntar(texto.auxiliar, "mt-1.5")}>
                  {formatDate(r.created_at)}
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  Prioridade {prio.label.toLowerCase()}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Novo pedido: janela do sistema (nasce no body, por cima da barra de baixo). */}
      <JanelaDoCelular
        aberta={createOpen && !isImpersonating}
        titulo="Novo pedido"
        onFechar={() => setCreateOpen(false)}
        classeDoCorpo="space-y-4 px-5 py-4"
        rodape={
          <div className="flex items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
            <button type="button" onClick={() => setCreateOpen(false)} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={handleCreate} disabled={saving} className={botao.primario}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {saving ? "Enviando..." : "Enviar pedido"}
            </button>
          </div>
        }
      >
          <CampoDeFormulario rotulo="Título" obrigatorio>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Ajuste na bio do Instagram" className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="O que você precisa" obrigatorio apoio="Quanto mais detalhe, mais rápido a equipe resolve.">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Descreva o que precisa" className={juntar(campoTexto, "resize-none")} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Prioridade">
            <select value={priority} onChange={e => setPriority(e.target.value)} className={campo}>
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </CampoDeFormulario>
      </JanelaDoCelular>
    </div>
  );
}

import { useEffect, useState } from "react";
import JanelaDoCelular from "@/components/sistema/JanelaDoCelular";
import { useAuth } from "@/contexts/AuthContext";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, MessageSquarePlus, ChevronRight } from "lucide-react";
import { useTelaPequena } from "@/components/client/useTelaPequena";
import { toast } from "sonner";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  espaco,
  foco,
  juntar,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { Card, Chip, PageHeader, StatusPill, type Tone } from "@/components/ds";
import { Bolha, type TomDaBolha } from "@/components/client/pecasOusadas";

const statusBadgeBase: Record<string, { cls: string; label: string }> = {
  new: { cls: "bg-info/10 text-info", label: "Aberto" },
  open: { cls: "bg-info/10 text-info", label: "Aberto" },
  in_progress: { cls: "bg-warning/10 text-warning", label: "Em Andamento" },
  done: { cls: "bg-success/10 text-success", label: "Concluído" },
  completed: { cls: "bg-success/10 text-success", label: "Concluído" },
};

/** O tom da pílula de estado de cada situação (a aparência; o rótulo vem do mapa acima). */
const tomDoStatus: Record<string, Tone> = { new: "info", open: "info", in_progress: "warning", done: "success", completed: "success" };
const statusBadge: Record<string, { tone: Tone; label: string }> = {};
Object.keys(statusBadgeBase).forEach((k) => {
  statusBadge[k] = { tone: tomDoStatus[k] || "info", label: statusBadgeBase[k].label };
});

const tomDaBolhaDoStatus: Record<Tone, TomDaBolha> = { info: "info", warning: "alerta", success: "sucesso", danger: "perigo", accent: "marca", neutral: "neutro" };

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
  // Celular (16/10/2026): lista de app (título e uma linha de apoio); o pedido
  // abre numa folha que sobe de baixo, e o "Novo pedido" fica fixo no pé.
  const pequena = useTelaPequena();
  const [pedidoAberto, setPedidoAberto] = useState<any>(null);

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

      // O aviso da equipe (sino e e-mail) nasce no banco, no gatilho de
      // client_requests (client_request_avisa_equipe): um fato, um aviso.

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
    <div className={espaco.pagina}>
      <PageHeader
        title="Pedidos"
        subtitle={todos.length ? `${emAberto} em aberto de ${todos.length}` : undefined}
        help="Peça um ajuste ou algo novo para a equipe. Cada pedido mostra em que pé está: aberto, em andamento ou concluído."
        actions={
          (todos.length > 0 || !isImpersonating) && (
            <>
              {/* O filtro sobe para a linha do título (seletor pequeno não ganha linha própria). */}
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
              {!isImpersonating && !(pequena && todos.length > 0) && (
                <button type="button" onClick={() => setCreateOpen(true)} className={botao.primario} aria-label="Novo pedido">
                  <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Novo pedido</span>
                </button>
              )}
            </>
          )
        }
      />

      {/* Celular: os três números numa faixa só; tocar filtra (tocar de novo volta para todos). */}
      {!isLoading && pequena && todos.length > 0 && (
        <div role="group" aria-label="Resumo dos pedidos" className="grid min-w-0 grid-cols-3 gap-2">
          {([
            { chave: "abertos", rotulo: "Abertos", classe: "bg-accent-solid text-on-accent", apagado: "text-on-accent/80" },
            { chave: "andamento", rotulo: "Andamento", classe: "bg-foreground text-background", apagado: "text-background/70" },
            { chave: "concluidos", rotulo: "Concluídos", classe: "bg-card text-foreground shadow-sm", apagado: "text-muted-foreground" },
          ] as const).map((n) => (
            <button
              key={n.chave}
              type="button"
              aria-pressed={filtro === n.chave}
              onClick={() => setFiltro(filtro === n.chave ? "todos" : n.chave)}
              className={juntar("flex min-w-0 flex-col rounded-[20px] px-3.5 py-3 text-left transition-transform active:scale-[0.98]", n.classe, filtro === n.chave && "ring-2 ring-ring ring-offset-2 ring-offset-background", foco)}
            >
              <span className="text-[26px] font-semibold leading-8 tabular-nums tracking-[-0.02em]">{contagem[n.chave]}</span>
              <span className={juntar("min-w-0 truncate text-[12px] font-medium leading-4", n.apagado)}>{n.rotulo}</span>
            </button>
          ))}
        </div>
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
        <Card flush>
        <ul className="min-w-0 divide-y divide-border/70 px-2 py-2 sm:px-3" aria-label="Seus pedidos">
          {visiveis.map((r: any) => {
            const status = statusBadge[r.status] || statusBadge.new;
            const prio = priorityBadge[r.priority] || priorityBadge.normal;
            if (pequena) {
              return (
                <li key={r.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setPedidoAberto(r)}
                    className={juntar("flex min-h-[64px] w-full min-w-0 items-center rounded-md px-2 py-3.5 text-left transition-colors active:bg-muted/60", foco)}
                  >
                    <Bolha tom={tomDaBolhaDoStatus[status.tone]} className="mr-3"><MessageSquarePlus className="h-4 w-4" /></Bolha>
                    <span className="min-w-0 flex-1">
                      <span className="block min-w-0 text-[14px] font-medium leading-5 text-foreground line-clamp-2 [overflow-wrap:anywhere]">{r.title}</span>
                      <span className="mt-1.5 flex min-w-0 items-center">
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>
                          {formatDate(r.created_at)}
                          {(r.priority === "high" || r.priority === "urgent") && ` · ${prio.label}`}
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              );
            }
            return (
              <li key={r.id} className="flex min-w-0 items-start rounded-lg px-3 py-4 transition-colors hover:bg-muted/60">
                <Bolha tom={tomDaBolhaDoStatus[status.tone]} className="mr-4"><MessageSquarePlus className="h-4 w-4" /></Bolha>
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 text-[15px] font-medium leading-5 text-foreground [overflow-wrap:anywhere]">{r.title}</p>
                  {r.description && <p className={juntar(texto.corpo, "mt-1 text-muted-foreground [overflow-wrap:anywhere]")}>{r.description}</p>}
                  <p className={juntar(texto.auxiliar, "mt-2 flex min-w-0 items-center")}>
                    {formatDate(r.created_at)}
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    Prioridade {prio.label.toLowerCase()}
                  </p>
                </div>
                <span className="ml-4 flex shrink-0 items-center">
                  {(r.priority === "high" || r.priority === "urgent") && <Chip tone={r.priority === "urgent" ? "danger" : "warning"} className="mr-2">{prio.label}</Chip>}
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </span>
              </li>
            );
          })}
        </ul>
        </Card>
      )}

      {/* Celular: "Novo pedido" fixo no pé, ao alcance do polegar. */}
      {pequena && !isImpersonating && todos.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3">
          <button type="button" onClick={() => setCreateOpen(true)} className={juntar(botao.primario, "h-12 w-full text-[14px]")}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Novo pedido
          </button>
        </div>
      )}

      {/* Pedido aberto (celular): a folha com o texto inteiro. */}
      <JanelaDoCelular
        aberta={pequena && !!pedidoAberto}
        titulo={pedidoAberto?.title || "Pedido"}
        onFechar={() => setPedidoAberto(null)}
        classeDoCorpo="space-y-3 px-4 py-4 break-words"
      >
        {pedidoAberto && (
          <>
            <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
              <StatusPill tone={(statusBadge[pedidoAberto.status] || statusBadge.new).tone}>{(statusBadge[pedidoAberto.status] || statusBadge.new).label}</StatusPill>
              <span className={texto.auxiliar}>
                {formatDate(pedidoAberto.created_at)} · Prioridade {(priorityBadge[pedidoAberto.priority] || priorityBadge.normal).label.toLowerCase()}
              </span>
            </div>
            <p className="text-[15px] font-semibold leading-6 text-foreground">{pedidoAberto.title}</p>
            {pedidoAberto.description && <p className={juntar(texto.corpo, "whitespace-pre-line text-muted-foreground")}>{pedidoAberto.description}</p>}
          </>
        )}
      </JanelaDoCelular>

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

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, FolderArchive, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import { botao, juntar, lista as estiloDeLista } from "@/components/sistema/estilos";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { supabase } from "@/integrations/supabase/client";
import { dataCurta, textoDoErro } from "@/lib/mesa/api";
import { filtrarPorMarca } from "@/lib/mesa/marcas";
import { useFiltroDaMarca, useMesa } from "./MesaContexto";
import { restaurarDaFaixa } from "./arquivarDaFaixa";
import { formatoDoItem } from "./EstudioLista";
import type { ItemDoMes } from "./useItensDoMes";

/**
 * Arquivados da faixa de pautas (frente AE-2, 28/09). Dono: "uma área
 * Arquivados onde dê para ver o que foi arquivado, restaurar e apagar de vez
 * o que não quero mais".
 *
 * - Arquivado = tarefa com deleted_at (o mesmo arquivar do Mês).
 * - Restaurar = restaurar_item_agenda (o mesmo do "Desfazer"), com o post
 *   da Agenda que saiu junto.
 * - Apagar de vez = excluirTarefa (src/lib/taskDelete.ts), o mesmo excluir
 *   do Kanban e do Ciclo: a tarefa não tem outra exclusão lógica além do
 *   deleted_at, que já é o arquivar. Mesmas travas: pedido do cliente e
 *   publicação agendada ou no ar não saem; aqui também a arte aprovada ou
 *   agendada. O trabalho do Estúdio fica guardado (a ligação vira nula).
 */

export const chaveDosArquivados = (clientId: string) => ["mesa", "arquivados-da-faixa", clientId] as const;

interface Arquivada extends ItemDoMes {
  deleted_at: string;
  source: string | null;
}

async function lerArquivados(clientId: string): Promise<Arquivada[]> {
  const { data: projetos, error } = await (supabase as any).from("projects").select("id").eq("client_id", clientId).is("deleted_at", null);
  if (error) throw error;
  const ids = ((projetos || []) as { id: string }[]).map((p) => p.id);
  if (!ids.length) return [];
  const { data, error: erroTarefas } = await (supabase as any)
    .from("tasks")
    .select("id, title, due_date, delivery_type, status, project_id, deleted_at, source")
    .in("project_id", ids)
    .not("deleted_at", "is", null)
    .in("delivery_type", ["carousel", "static", "design"])
    .order("deleted_at", { ascending: false })
    .limit(60);
  if (erroTarefas) throw erroTarefas;
  return ((data || []) as Arquivada[]).filter((t) => !!t.deleted_at);
}

/** O post da Agenda ligado à tarefa que ficou arquivado junto (para o restaurar devolver). */
async function postArquivadoDa(taskId: string): Promise<string | null> {
  const { data } = await (supabase as any).from("editorial_post_internal").select("post_id").eq("task_id", taskId);
  const ids = ((data || []) as { post_id: string }[]).map((l) => l.post_id).filter(Boolean);
  if (!ids.length) return null;
  const { data: posts } = await (supabase as any).from("editorial_posts").select("id, archived_at").in("id", ids);
  const arquivado = ((posts || []) as { id: string; archived_at: string | null }[]).filter((p) => !!p.archived_at)[0];
  return arquivado ? arquivado.id : null;
}

/** Arte aprovada ou agendada trava o apagar (a aprovação do cliente não pode sumir). */
async function arteTravada(clientId: string, taskId: string): Promise<boolean> {
  const { data } = await (supabase as any).from("estudio_trabalhos").select("entrega_status").eq("client_id", clientId).eq("task_id", taskId).limit(5);
  return ((data || []) as { entrega_status: string | null }[]).some((w) => w.entrega_status === "aprovado" || w.entrega_status === "agendado");
}

export default function ArquivadosDaFaixa({ onMudou }: { onMudou: () => void }) {
  const { clientId } = useMesa();
  const filtro = useFiltroDaMarca();
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const lista = useQuery({ queryKey: chaveDosArquivados(clientId), enabled: aberto, queryFn: () => lerArquivados(clientId) });
  // Marca por projeto (Acerbi e CME): só os arquivados da marca aberta.
  const itens = filtrarPorMarca(lista.data || [], filtro);

  const tirarDaLista = (id: string) =>
    queryClient.setQueryData<Arquivada[]>(chaveDosArquivados(clientId), (l) => (l || []).filter((x) => x.id !== id));

  const restaurar = async (t: Arquivada) => {
    setOcupado(t.id);
    try {
      const postId = await postArquivadoDa(t.id).catch(() => null);
      const r = await restaurarDaFaixa(clientId, { taskId: t.id, titulo: t.title, memoriaId: null, postId });
      tirarDaLista(t.id);
      onMudou();
      toast.success(`De volta na faixa: ${t.title}`, { description: r && r.aviso ? r.aviso : undefined });
    } catch (e) {
      toast.error("Não voltou", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const apagar = async (t: Arquivada) => {
    const ok = await confirmar({
      title: `Apagar de vez "${t.title}"?`,
      description: "A pauta some do painel e não dá para desfazer. A arte feita no Estúdio fica guardada nos arquivos.",
      confirmLabel: "Apagar de vez",
      destructive: true,
    });
    if (!ok) return;
    setOcupado(t.id);
    try {
      if (await arteTravada(clientId, t.id)) {
        toast.warning("Não foi apagada", { description: "A arte desta pauta já foi aprovada ou agendada. Ela fica arquivada para a aprovação não se perder." });
        return;
      }
      // Carrega só na hora de apagar (o excluir do Kanban puxa a sincronização com o Ops).
      const { excluirTarefa } = await import("@/lib/taskDelete");
      const r = await excluirTarefa({ id: t.id, title: t.title, source: t.source, project_id: t.project_id });
      if (!r.ok) {
        toast.warning("Não foi apagada", { description: r.mensagem });
        return;
      }
      tirarDaLista(t.id);
      onMudou();
      toast.success(`Apagada de vez: ${t.title}`);
    } catch (e) {
      toast.error("Não foi apagada", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={juntar(botao.icone, "my-1")}
        aria-label="Arquivados"
        title="Arquivados: restaurar ou apagar de vez"
        data-abrir-arquivados=""
      >
        <FolderArchive className="h-4 w-4" aria-hidden="true" />
      </button>
      <JanelaCentral
        aberta={aberto}
        onMudar={setAberto}
        largura="md"
        corpo="fixo"
        semEspaco
        icone={<FolderArchive className="h-4 w-4" />}
        titulo="Pautas arquivadas"
        ajuda="Restaurar volta a pauta para a faixa e o mês. Apagar de vez não dá para desfazer."
      >
          <RegiaoRolavel modo="sempre" classeDeFora="min-h-0 flex-1" className="p-3" sobre="cartao" rotulo="Pautas arquivadas">
            {lista.isLoading && <p className="flex items-center text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Lendo os arquivados…</p>}
            {lista.isError && <p className="rounded-md bg-destructive/10 p-2.5 text-[13px]">{textoDoErro(lista.error)}</p>}
            {lista.isSuccess && !itens.length && <p className="py-8 text-center text-[12px] text-muted-foreground">Nenhuma pauta arquivada.</p>}
            {/* 16/10/2026 (dono: "só o ícone, sem bordas"): uma linha por pauta, ações em ícone à direita. */}
            <ul className={juntar(estiloDeLista.aberta, estiloDeLista.divisoria)} aria-label="Pautas arquivadas">
              {itens.map((t) => (
                <li key={t.id} className={estiloDeLista.linha} data-arquivada={t.id}>
                  <div className="mr-2 min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{t.title}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {dataCurta(t.due_date)} · {formatoDoItem(t)} · arquivada em {dataCurta(t.deleted_at)}
                    </p>
                  </div>
                  <button type="button" className={botao.icone} aria-label="Restaurar" title="Restaurar: volta para a faixa e o mês" onClick={() => void restaurar(t)} disabled={ocupado !== null}>
                    {ocupado === t.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <button type="button" className={juntar(botao.icone, "ml-0.5 hover:text-destructive")} aria-label="Apagar de vez" title="Apagar de vez (não dá para desfazer)" onClick={() => void apagar(t)} disabled={ocupado !== null}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </RegiaoRolavel>
      </JanelaCentral>
    </>
  );
}

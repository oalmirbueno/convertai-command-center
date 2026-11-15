import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import EditorialDetailSheet from "@/components/editorial/EditorialDetailSheet";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import TarefaDaExecucao from "@/components/execucao/TarefaDaExecucao";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useEditorialPostDetail } from "@/hooks/useEditorialCalendar";
import { useProjects, useTeamMembers } from "@/hooks/useSupabaseData";
import { getEditorialPermissions } from "@/lib/editorial";
import { podeAbrirEstudio, type CartaoDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";

/*
 * O painel da peça, aberto NA PRÓPRIA Esteira (pedido do Almir, 14/11/2026,
 * 21h54: "tudo dentro no mesmo lugar"). Não é uma ficha nova: com post, é a
 * mesma ficha da Agenda (EditorialDetailSheet: arte, legenda, status,
 * aprovação do cliente e as ações que ela já tem); sem post, é a mesma
 * janela da tarefa do Kanban e da Execução (TaskDetailDrawer, lida inteira
 * antes de abrir). Fechar recarrega a grade: o que mudou ali aparece aqui.
 */

interface Props {
  cartao: CartaoDaEsteira;
  nomeDoCliente: string;
  /** Fecha o painel (a tela tira o cartão aberto). */
  aoFechar: () => void;
  /** Algo pode ter mudado no painel: a grade relê. */
  aoMudar: () => void;
}

/** Enquanto a ficha é lida: o mesmo véu da janela da tarefa (TarefaDaExecucao). */
function Abrindo({ aoFechar }: { aoFechar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="status" aria-label="Abrindo a peça" onClick={aoFechar}>
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
    </div>
  );
}

function FichaDoPost({ cartao, nomeDoCliente, aoFechar, aoMudar, papel, isImpersonating }: Props & { papel: string | null | undefined; isImpersonating: boolean }) {
  const navigate = useNavigate();
  const detalhe = useEditorialPostDetail(cartao.postId ?? null, cartao.clientId ?? null, { forceClientView: isImpersonating });
  const projetos = useProjects();
  const equipe = useTeamMembers();
  const post = detalhe.data?.posts?.[0] ?? null;
  const permissoes = getEditorialPermissions(papel);
  const fechar = () => {
    aoFechar();
    aoMudar();
  };

  useEffect(() => {
    if (detalhe.isError) {
      toast.error("Não foi possível abrir a peça agora. Tente de novo.");
      aoFechar();
    } else if (detalhe.isSuccess && !post) {
      toast.error("Esta peça não existe mais ou você não tem acesso a ela.");
      aoFechar();
    }
  }, [detalhe.isError, detalhe.isSuccess, post]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!post) return detalhe.isError ? null : <Abrindo aoFechar={aoFechar} />;

  const nomeDoProjeto = (projetos.data as Array<{ id: string; name?: string | null }> | undefined)?.find((p) => p.id === post.post.project_id)?.name || "Projeto";
  const responsavel = post.internal?.responsible_id
    ? (equipe.data as Array<{ id: string; full_name?: string | null }> | undefined)?.find((m) => m.id === post.internal?.responsible_id)?.full_name ?? null
    : null;
  // "Editar" e "Nova versão" são ações explícitas: levam à Agenda já aberta na peça, onde o editor mora.
  const irParaAAgenda = () => navigate(cartao.link);

  return (
    <EditorialDetailSheet
      open
      post={post}
      clientName={nomeDoCliente}
      projectName={nomeDoProjeto}
      responsibleName={responsavel}
      canEdit={permissoes.canEdit}
      canPublish={permissoes.canPublish}
      isImpersonating={isImpersonating}
      onOpenChange={(aberto) => {
        if (!aberto) fechar();
      }}
      onEdit={irParaAAgenda}
      onCreateRevision={irParaAAgenda}
      onArchived={fechar}
      mesaHref={
        post.internal?.task_id && podeAbrirEstudio(papel)
          ? `/mesa?client=${encodeURIComponent(post.post.client_id)}&aba=estudio&task=${encodeURIComponent(post.internal.task_id)}`
          : null
      }
    />
  );
}

function JanelaDaTarefa({ cartao, aoFechar, aoMudar, papel }: Props & { papel: string | null | undefined }) {
  const projetos = useProjects();
  const equipe = useTeamMembers();
  const fechar = () => {
    aoFechar();
    aoMudar();
  };
  return (
    <TarefaDaExecucao
      // Só o id, de propósito: sem a tarefa inteira a janela não abre (com título, a
      // TarefaDaExecucao abriria a linha parcial, e salvar apagaria prazo e responsável).
      tarefa={{ id: String(cartao.taskId) }}
      aoFechar={fechar}
      desenhar={(completa) => (
        <TaskDetailDrawer
          task={completa}
          onClose={fechar}
          teamMembers={(equipe.data as unknown[] | undefined) ?? []}
          projects={(projetos.data as unknown[] | undefined) ?? []}
          readOnly={!getEditorialPermissions(papel).canEdit}
        />
      )}
    />
  );
}

export default function PainelDaPeca(props: Props) {
  const { profile } = useAuth();
  const { isImpersonating } = useImpersonation();
  // Vendo como cliente, a ficha segue as regras do cliente (como na Agenda).
  const papel = isImpersonating ? "client" : profile?.role;
  const { cartao } = props;
  return (
    // `contents`: o invólucro não vira caixa na coluna da página (a ficha e a janela flutuam).
    <div className="contents" data-painel-da-peca={cartao.chave}>
      {cartao.postId ? (
        <FichaDoPost {...props} papel={papel} isImpersonating={Boolean(isImpersonating)} />
      ) : cartao.taskId ? (
        <JanelaDaTarefa {...props} papel={papel} />
      ) : null}
    </div>
  );
}
